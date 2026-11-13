/* Giftoria Atelier: sign-in service for the super admin.

   Main sign-in (POST /login): the owner signs in with Google, then types the 6-digit code from their authenticator
   app. This service checks that the Google ID token is genuine and belongs to an allowed email, checks the code, and
   returns (a) a signed session that lasts 12 hours, or 30 days on a trusted device, and (b) a 1-hour GitHub token
   limited to the two shop repositories. POST /token swaps a valid session for a fresh 1-hour token.

   Alternative sign-in (GET /callback): "Sign in with GitHub". GitHub checks the password and authenticator code;
   this service swaps GitHub's one-time code for an 8-hour user token and returns it in the URL fragment.

   Website orders: POST /proof stores the customer's payment screenshot and POST /order stores the order, both in
   the private orders repository, so they appear in the super admin.

   Settings: wrangler.toml [vars] and Cloudflare secrets (marked *):
     ADMIN_URL, SITE_ORIGINS (other addresses the shop is served from), REPO_OWNER, SITE_REPO, ORDERS_REPO, GOOGLE_CLIENT_ID, GITHUB_CLIENT_ID, ALLOWED_USERS, SESSION_VERSION
     ALLOWED_EMAILS*, TOTP_SECRET*, SESSION_SECRET*, GITHUB_APP_PRIVATE_KEY*, GITHUB_CLIENT_SECRET*
   Changing SESSION_VERSION signs everyone out.                                                                     */
import {verifyGoogleIdToken, checkTotp, makeSession, readSession, installationToken, recentOrderNo, imageKind, randomId} from "./lib.js";

const UA = "giftoria-auth";
const SHORT = 12 * 3600e3, LONG = 30 * 864e5;

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    if (request.method === "OPTIONS") return new Response(null, {status: 204, headers: cors(request, env)});
    try {
      if (url.pathname === "/login" && request.method === "POST") return await login(request, env);
      if (url.pathname === "/token" && request.method === "POST") return await refresh(request, env);
      if (url.pathname === "/order" && request.method === "POST") return await placeOrder(request, env);
      if (url.pathname === "/proof" && request.method === "POST") return await saveProof(request, env);
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
  const origin = request.headers.get("Origin");
  const allowed = [new URL(env.ADMIN_URL).origin, ...String(env.SITE_ORIGINS || "").split(",").map(x => x.trim()).filter(Boolean)];
  return allowed.includes(origin) ? {"Access-Control-Allow-Origin": origin, "Access-Control-Allow-Methods": "POST, OPTIONS", "Access-Control-Allow-Headers": "Content-Type", "Access-Control-Max-Age": "86400", Vary: "Origin"} : {};
}
function reply(request, env, body, status = 200) {
  return new Response(JSON.stringify(body), {status, headers: {"content-type": "application/json", "cache-control": "no-store", ...cors(request, env)}});
}
const allowedEmails = env => String(env.ALLOWED_EMAILS || "").toLowerCase().split(",").map(s => s.trim()).filter(Boolean);
/* GitHub tokens last an hour; one is reused while it has more than 15 minutes left, which saves signing a new
   request for every order. */
let cachedToken = null;
async function repoToken(env) {
  if (cachedToken && cachedToken.exp - Date.now() > 15 * 60e3) return cachedToken;
  cachedToken = await installationToken({privateKeyPem: env.GITHUB_APP_PRIVATE_KEY, issuer: env.GITHUB_CLIENT_ID, owner: env.REPO_OWNER, repos: [env.SITE_REPO, env.ORDERS_REPO], userAgent: UA});
  return cachedToken;
}

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

/* ---------- orders from the website ----------
   POST /order stores a customer's order in orders.json in the private orders repository, so it appears in the
   super admin without pasting the WhatsApp message. It is rate-limited per visitor. */
const hits = new Map();
function limited(request, key, max) {
  const ip = request.headers.get("CF-Connecting-IP") || "?", k = key + ":" + ip, now = Date.now();
  const list = (hits.get(k) || []).filter(t => now - t < 3600e3); list.push(now); hits.set(k, list);
  return list.length > max;
}
const str = (v, n) => String(v == null ? "" : v).replace(/[\u0000-\u001f]/g, " ").trim().slice(0, n);
const money = v => Math.max(0, Math.min(1e7, Math.round(Number(v) || 0)));
const digits = v => String(v || "").replace(/\D/g, "");
const ghHeaders = token => ({Authorization: "Bearer " + token, Accept: "application/vnd.github+json", "Content-Type": "application/json", "User-Agent": UA});
const ordersUrl = env => `https://api.github.com/repos/${env.REPO_OWNER}/${env.ORDERS_REPO}`;
async function readOrders(env, token) {
  const r = await fetch(ordersUrl(env) + "/contents/orders.json", {headers: ghHeaders(token)});
  if (r.status === 404) return {list: [], sha: null};
  if (!r.ok) throw new Error("orders read " + r.status);
  const f = await r.json();
  let b64 = f.content;
  if (!b64) b64 = (await (await fetch(ordersUrl(env) + "/git/blobs/" + f.sha, {headers: ghHeaders(token)})).json()).content;
  const text = new TextDecoder().decode(Uint8Array.from(atob(b64.replace(/\s/g, "")), c => c.charCodeAt(0)));
  const list = JSON.parse(text || "[]");
  return {list: Array.isArray(list) ? list : [], sha: f.sha};
}
function b64utf8(s) { const b = new TextEncoder().encode(s); let x = ""; for (let i = 0; i < b.length; i += 0x8000) x += String.fromCharCode.apply(null, b.subarray(i, i + 0x8000)); return btoa(x) }
async function placeOrder(request, env) {
  if (limited(request, "order", 10)) return reply(request, env, {error: "too_many"}, 429);
  const o = (await request.json().catch(() => ({}))).order || {};
  const no = str(o.no, 20).toUpperCase();
  if (!/^[A-Z]{1,4}-(?:\d{4}-\d{2,5}|\d{6}-[0-9A-Z]{4})$/.test(no)) return reply(request, env, {error: "bad_order"}, 400);
  const items = (Array.isArray(o.items) ? o.items : []).slice(0, 30).map(i => ({name: str(i.name, 80), qty: Math.max(1, Math.min(99, Math.round(+i.qty || 1))), price: money(i.price)})).filter(i => i.name);
  const phone = str(o.phone, 20);
  if (!items.length || !str(o.name, 80) || digits(phone).length < 10) return reply(request, env, {error: "bad_order"}, 400);
  const pct = Math.min(100, money(o.pct));
  /* the payment screenshot uploaded during checkout (POST /proof); only a file named after this order is accepted */
  const proof = typeof o.proof === "string" && new RegExp("^proofs/" + no + "-[a-z0-9]{6}\\.(?:jpg|png)$").test(o.proof) ? o.proof : "";
  const rec = {no, items, sub: money(o.sub), addT: money(o.addT), del: money(o.del), tot: money(o.tot), adv: money(o.adv), rest: money(o.rest), pct,
    name: str(o.name, 80), phone, city: str(o.city, 40), area: str(o.area, 80), addr: str(o.addr, 300), needTxt: str(o.needTxt, 60), need: /^\d{4}-\d{2}-\d{2}$/.test(String(o.need || "")) ? o.need : "", card: str(o.card, 200), note: str(o.note, 200),
    proofs: proof ? [{p: proof, k: pct >= 100 ? "full" : "advance", at: Date.now()}] : [], proofLater: !proof && o.proofLater === true,
    status: money(o.adv) > 0 ? "new" : "paid", at: Date.now(), source: "website"};
  const token = (await repoToken(env)).token;
  for (let attempt = 0; attempt < 3; attempt++) {
    const {list, sha} = await readOrders(env, token);
    if (list.some(x => x.no === no)) return reply(request, env, {ok: true, no});
    const body = {message: "New website order " + no, content: b64utf8(JSON.stringify([rec, ...list], null, 1) + "\n"), ...(sha ? {sha} : {})};
    const w = await fetch(ordersUrl(env) + "/contents/orders.json", {method: "PUT", headers: ghHeaders(token), body: JSON.stringify(body)});
    if (w.ok) return reply(request, env, {ok: true, no});
    if (w.status !== 409 && w.status !== 422) throw new Error("orders write " + w.status);
  }
  return reply(request, env, {error: "busy"}, 503);
}

/* ---------- payment screenshots from the website ----------
   POST /proof {no, image} stores the customer's payment screenshot (base64 JPEG or PNG, about 1 MB at most) in the
   private orders repository as proofs/<order ID>-<random>.jpg while they are still on the checkout form. The order
   sent afterwards refers to it by that path. A new file is written every time, so nothing can be overwritten. */
const PROOF_MAX = 1400000; // base64 characters
async function saveProof(request, env) {
  if (limited(request, "proof", 15)) return reply(request, env, {error: "too_many"}, 429);
  if (+(request.headers.get("content-length") || 0) > PROOF_MAX + 4000) return reply(request, env, {error: "too_large"}, 413);
  const b = await request.json().catch(() => ({}));
  const no = str(b.no, 20).toUpperCase();
  if (!recentOrderNo(no)) return reply(request, env, {error: "bad_order"}, 400);
  const data = String(b.image || "").replace(/^data:image\/[a-z]+;base64,/, "");
  if (data.length > PROOF_MAX) return reply(request, env, {error: "too_large"}, 413);
  const ext = data.length > 600 ? imageKind(data) : "";
  if (!ext) return reply(request, env, {error: "bad_image"}, 400);
  const path = `proofs/${no}-${randomId(6)}.${ext}`;
  const token = (await repoToken(env)).token;
  const w = await fetch(ordersUrl(env) + "/contents/" + path, {method: "PUT", headers: ghHeaders(token), body: JSON.stringify({message: "Payment screenshot for " + no, content: data})});
  if (!w.ok) throw new Error("proof write " + w.status);
  return reply(request, env, {ok: true, path});
}
