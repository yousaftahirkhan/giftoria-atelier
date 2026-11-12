/* Giftoria Atelier: sign-in service for the super admin ("Sign in with GitHub").

   GitHub checks the owner's password and authenticator code, then sends the browser here with a one-time code.
   This worker swaps the code for a short-lived GitHub user token (about 8 hours) using the GitHub App's client secret,
   which must never be in the public website. It accepts only the GitHub accounts listed in ALLOWED_USERS, then returns
   the token to the admin page in the URL fragment, which browsers never send to any server.

   Settings (wrangler.toml / Cloudflare secrets):
     ADMIN_URL            the super admin page the browser returns to
     ALLOWED_USERS        comma-separated GitHub usernames allowed to manage the shop
     GITHUB_CLIENT_ID     the GitHub App's client ID
     GITHUB_CLIENT_SECRET the GitHub App's client secret (secret)                                                  */

const UA = "giftoria-auth";

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    if (url.pathname === "/callback") return callback(url, env);
    if (url.pathname === "/") return new Response("Giftoria Atelier admin sign-in service.", {headers: {"content-type": "text/plain; charset=utf-8"}});
    return new Response("Not found", {status: 404});
  }
};

function back(env, params) {
  return new Response(null, {status: 302, headers: {
    Location: env.ADMIN_URL + "#" + new URLSearchParams(params).toString(),
    "Cache-Control": "no-store",
    "Referrer-Policy": "no-referrer"
  }});
}

async function revoke(env, token) {
  await fetch(`https://api.github.com/applications/${env.GITHUB_CLIENT_ID}/token`, {
    method: "DELETE",
    headers: {Authorization: "Basic " + btoa(env.GITHUB_CLIENT_ID + ":" + env.GITHUB_CLIENT_SECRET), Accept: "application/vnd.github+json", "Content-Type": "application/json", "User-Agent": UA},
    body: JSON.stringify({access_token: token})
  }).catch(() => {});
}

async function callback(url, env) {
  const code = url.searchParams.get("code");
  const state = (url.searchParams.get("state") || "").slice(0, 100);
  if (url.searchParams.get("error")) return back(env, {auth_error: "denied", state});
  if (!code) return back(env, {auth_error: "missing_code", state});

  const res = await fetch("https://github.com/login/oauth/access_token", {
    method: "POST",
    headers: {Accept: "application/json", "Content-Type": "application/json", "User-Agent": UA},
    body: JSON.stringify({client_id: env.GITHUB_CLIENT_ID, client_secret: env.GITHUB_CLIENT_SECRET, code})
  });
  const tok = await res.json().catch(() => ({}));
  if (!tok.access_token) return back(env, {auth_error: "exchange_failed", state});

  const who = await fetch("https://api.github.com/user", {headers: {Authorization: "Bearer " + tok.access_token, Accept: "application/vnd.github+json", "User-Agent": UA}});
  const user = who.ok ? await who.json() : null;
  const allowed = String(env.ALLOWED_USERS || "").toLowerCase().split(",").map(s => s.trim()).filter(Boolean);
  if (!user || !allowed.includes(String(user.login).toLowerCase())) {
    await revoke(env, tok.access_token);
    return back(env, {auth_error: "not_allowed", state});
  }
  return back(env, {token: tok.access_token, expires_in: String(tok.expires_in || 28800), state});
}
