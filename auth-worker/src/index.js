/* Giftoria Atelier: sign-in service for the super admin.

   Main sign-in (POST /login): the owner signs in with Google, then types the 6-digit code from their authenticator
   app. This service checks that the Google ID token is genuine and belongs to an allowed email, checks the code, and
   returns (a) a signed session that lasts 12 hours, or 30 days on a trusted device, and (b) a 1-hour GitHub token
   limited to the two shop repositories. POST /token swaps a valid session for a fresh 1-hour token.

   Alternative sign-in (GET /callback): "Sign in with GitHub". GitHub checks the password and authenticator code;
   this service swaps GitHub's one-time code for an 8-hour user token and returns it in the URL fragment.

   Settings: wrangler.toml [vars] and Cloudflare secrets (marked *):
     ADMIN_URL, REPO_OWNER, SITE_REPO, ORDERS_REPO, GOOGLE_CLIENT_ID, GITHUB_CLIENT_ID, ALLOWED_USERS, SESSION_VERSION
     ALLOWED_EMAILS*, TOTP_SECRET*, SESSION_SECRET*, GITHUB_APP_PRIVATE_KEY*, GITHUB_CLIENT_SECRET*
   Changing SESSION_VERSION signs everyone out.                                                                     */
import {verifyGoogleIdToken, checkTotp, makeSession, readSession, installationToken} from "./lib.js";

const UA = "giftoria-auth";
const SHORT = 12 * 3600e3, LONG = 30 * 864e5;

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    if (request.method === "OPTIONS") return new Response(null, {status: 204, headers: cors(request, env)});
    try {
      if (url.pathname === "/login" && request.method === "POST") return await login(request, env);
      if (url.pathname === "/token" && request.method === "POST") return await refresh(request, env);
      if (url.pathname === "/callback") return await githubCallback(url, env);
      if (url.pathname === "/") return new Response("Giftoria Atelier admin sign-in service.", {headers: {"content-type": "text/plain; charset=utf-8"}});
    } catch (e) {
      console.error(e && e.stack || e);
      return reply(request, env, {error: "server_error"}, 500);
    }
    return new Response("Not found", {status: 404});
  }
};

function cors(request, env) {
  const origin = request.headers.get("Origin"), allowed = new URL(env.ADMIN_URL).origin;
  return origin === allowed ? {"Access-Control-Allow-Origin": origin, "Access-Control-Allow-Methods": "POST, OPTIONS", "Access-Control-Allow-Headers": "Content-Type", "Access-Control-Max-Age": "86400", Vary: "Origin"} : {};
}
function reply(request, env, body, status = 200) {
  return new Response(JSON.stringify(body), {status, headers: {"content-type": "application/json", "cache-control": "no-store", ...cors(request, env)}});
}
const allowedEmails = env => String(env.ALLOWED_EMAILS || "").toLowerCase().split(",").map(s => s.trim()).filter(Boolean);
const repoToken = env => installationToken({privateKeyPem: env.GITHUB_APP_PRIVATE_KEY, issuer: env.GITHUB_CLIENT_ID, owner: env.REPO_OWNER, repos: [env.SITE_REPO, env.ORDERS_REPO], userAgent: UA});

/* Slows down code guessing: at most 8 wrong codes per account in 15 minutes (per Cloudflare instance). A Google
   sign-in to an allowed account is already needed before any code is checked. */
const attempts = new Map();
function tooMany(email) {
  const now = Date.now(), list = (attempts.get(email) || []).filter(t => now - t < 15 * 60e3);
  attempts.set(email, list); return list.length >= 8;
}
const noteFailure = email => attempts.set(email, [...(attempts.get(email) || []), Date.now()]);

async function login(request, env) {
  const b = await request.json().catch(() => ({}));
  const g = await verifyGoogleIdToken(b.id_token, env.GOOGLE_CLIENT_ID);
  if (!g) return reply(request, env, {error: "google_invalid"}, 401);
  const email = String(g.email).toLowerCase();
  if (!allowedEmails(env).includes(email)) return reply(request, env, {error: "not_allowed"}, 403);
  if (tooMany(email)) return reply(request, env, {error: "too_many"}, 429);
  if (!await checkTotp(env.TOTP_SECRET, b.code)) { noteFailure(email); return reply(request, env, {error: "bad_code"}, 401) }
  attempts.delete(email);
  const ms = b.remember ? LONG : SHORT;
  const session = await makeSession(env.SESSION_SECRET, email, ms, env.SESSION_VERSION || "1");
  const t = await repoToken(env);
  return reply(request, env, {session, session_exp: Date.now() + ms, token: t.token, token_exp: t.exp, email});
}

async function refresh(request, env) {
  const b = await request.json().catch(() => ({}));
  const s = await readSession(env.SESSION_SECRET, b.session, env.SESSION_VERSION || "1");
  if (!s || !allowedEmails(env).includes(s.e)) return reply(request, env, {error: "session_expired"}, 401);
  const t = await repoToken(env);
  return reply(request, env, {token: t.token, token_exp: t.exp, email: s.e});
}

/* ---------- "Sign in with GitHub" ---------- */
function back(env, params) {
  return new Response(null, {status: 302, headers: {Location: env.ADMIN_URL + "#" + new URLSearchParams(params).toString(), "Cache-Control": "no-store", "Referrer-Policy": "no-referrer"}});
}
async function revoke(env, token) {
  await fetch(`https://api.github.com/applications/${env.GITHUB_CLIENT_ID}/token`, {method: "DELETE",
    headers: {Authorization: "Basic " + btoa(env.GITHUB_CLIENT_ID + ":" + env.GITHUB_CLIENT_SECRET), Accept: "application/vnd.github+json", "Content-Type": "application/json", "User-Agent": UA},
    body: JSON.stringify({access_token: token})}).catch(() => {});
}
async function githubCallback(url, env) {
  const code = url.searchParams.get("code"), state = (url.searchParams.get("state") || "").slice(0, 100);
  if (url.searchParams.get("error")) return back(env, {auth_error: "denied", state});
  if (!code) return back(env, {auth_error: "missing_code", state});
  const res = await fetch("https://github.com/login/oauth/access_token", {method: "POST",
    headers: {Accept: "application/json", "Content-Type": "application/json", "User-Agent": UA},
    body: JSON.stringify({client_id: env.GITHUB_CLIENT_ID, client_secret: env.GITHUB_CLIENT_SECRET, code})});
  const tok = await res.json().catch(() => ({}));
  if (!tok.access_token) return back(env, {auth_error: "exchange_failed", state});
  const who = await fetch("https://api.github.com/user", {headers: {Authorization: "Bearer " + tok.access_token, Accept: "application/vnd.github+json", "User-Agent": UA}});
  const user = who.ok ? await who.json() : null;
  const allowed = String(env.ALLOWED_USERS || "").toLowerCase().split(",").map(s => s.trim()).filter(Boolean);
  if (!user || !allowed.includes(String(user.login).toLowerCase())) { await revoke(env, tok.access_token); return back(env, {auth_error: "not_allowed", state}) }
  return back(env, {token: tok.access_token, expires_in: String(tok.expires_in || 28800), state});
}
