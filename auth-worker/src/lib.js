/* Building blocks for the sign-in service: Google ID-token checks, authenticator (TOTP) codes, signed sessions
   and GitHub App installation tokens. Uses only Web Crypto, so it runs on Cloudflare Workers and in Node for tests. */

const enc = new TextEncoder(), dec = new TextDecoder();
export const b64url = bytes => { let s = ""; for (const b of new Uint8Array(bytes)) s += String.fromCharCode(b); return btoa(s).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "") };
export const b64urlToBytes = s => { s = String(s).replace(/-/g, "+").replace(/_/g, "/"); while (s.length % 4) s += "="; return Uint8Array.from(atob(s), c => c.charCodeAt(0)) };
const parseJSON = bytes => JSON.parse(dec.decode(bytes));

/* constant-time string comparison for signatures */
export function sameString(a, b) {
  a = String(a); b = String(b); let d = a.length ^ b.length;
  for (let i = 0; i < Math.max(a.length, b.length); i++) d |= (a.charCodeAt(i) || 0) ^ (b.charCodeAt(i) || 0);
  return d === 0;
}

/* ---------- Google ID token (from "Sign in with Google") ---------- */
let jwksCache = null, jwksAt = 0;
async function googleKeys(force) {
  if (!force && jwksCache && Date.now() - jwksAt < 3600e3) return jwksCache;
  const r = await fetch("https://www.googleapis.com/oauth2/v3/certs");
  jwksCache = (await r.json()).keys || []; jwksAt = Date.now(); return jwksCache;
}
/* Returns the token's claims when it is a genuine, unexpired Google ID token issued for clientId with a verified
   email; otherwise null. getKeys can be replaced in tests. */
export async function verifyGoogleIdToken(idToken, clientId, getKeys = googleKeys) {
  try {
    const parts = String(idToken || "").split(".");
    if (parts.length !== 3) return null;
    const header = parseJSON(b64urlToBytes(parts[0])), claims = parseJSON(b64urlToBytes(parts[1]));
    if (header.alg !== "RS256" || !header.kid) return null;
    let jwk = (await getKeys(false)).find(k => k.kid === header.kid);
    if (!jwk) jwk = (await getKeys(true)).find(k => k.kid === header.kid);
    if (!jwk) return null;
    const key = await crypto.subtle.importKey("jwk", {kty: jwk.kty, n: jwk.n, e: jwk.e, alg: "RS256", ext: true}, {name: "RSASSA-PKCS1-v1_5", hash: "SHA-256"}, false, ["verify"]);
    const ok = await crypto.subtle.verify("RSASSA-PKCS1-v1_5", key, b64urlToBytes(parts[2]), enc.encode(parts[0] + "." + parts[1]));
    if (!ok) return null;
    const now = Date.now() / 1000;
    if (!["accounts.google.com", "https://accounts.google.com"].includes(claims.iss)) return null;
    if (claims.aud !== clientId) return null;
    if (!(claims.exp > now) || (claims.iat && claims.iat > now + 300)) return null;
    if (claims.email_verified !== true && claims.email_verified !== "true") return null;
    return claims;
  } catch (e) { return null }
}

/* ---------- authenticator codes (TOTP, RFC 6238: SHA-1, 30 s, 6 digits) ---------- */
export function base32ToBytes(s) {
  const A = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567"; let bits = 0, val = 0; const out = [];
  for (const c of String(s).replace(/[\s=]/g, "").toUpperCase()) {
    const i = A.indexOf(c); if (i < 0) throw new Error("bad base32");
    val = ((val << 5) | i) & 0x1fff; bits += 5;
    if (bits >= 8) { out.push((val >>> (bits - 8)) & 255); bits -= 8 }
  }
  return new Uint8Array(out);
}
export async function totpAt(secretB32, step, digits = 6) {
  const key = await crypto.subtle.importKey("raw", base32ToBytes(secretB32), {name: "HMAC", hash: "SHA-1"}, false, ["sign"]);
  const msg = new ArrayBuffer(8), v = new DataView(msg);
  v.setUint32(0, Math.floor(step / 2 ** 32)); v.setUint32(4, step >>> 0);
  const h = new Uint8Array(await crypto.subtle.sign("HMAC", key, msg)), o = h[h.length - 1] & 15;
  const n = ((h[o] & 127) << 24) | (h[o + 1] << 16) | (h[o + 2] << 8) | h[o + 3];
  return String(n % 10 ** digits).padStart(digits, "0");
}
/* Accepts the current code and the ones either side of it, to allow for a phone clock that is slightly off. */
export async function checkTotp(secretB32, code, now = Date.now()) {
  code = String(code || "").replace(/\s/g, "");
  if (!/^\d{6}$/.test(code)) return false;
  const step = Math.floor(now / 30000);
  let ok = false;
  for (const d of [-1, 0, 1]) if (sameString(await totpAt(secretB32, step + d), code)) ok = true;
  return ok;
}

/* ---------- signed sessions ---------- */
async function hmac(secret, data) {
  const key = await crypto.subtle.importKey("raw", enc.encode(secret), {name: "HMAC", hash: "SHA-256"}, false, ["sign"]);
  return b64url(await crypto.subtle.sign("HMAC", key, enc.encode(data)));
}
export async function makeSession(secret, email, ms, version = "1") {
  const body = b64url(enc.encode(JSON.stringify({e: email, x: Date.now() + ms, v: version})));
  return body + "." + await hmac(secret, body);
}
/* Returns the session data when the signature is valid, it has not expired and its version matches; otherwise null. */
export async function readSession(secret, token, version = "1") {
  try {
    const [body, sig, extra] = String(token || "").split(".");
    if (!body || !sig || extra !== undefined) return null;
    if (!sameString(sig, await hmac(secret, body))) return null;
    const d = parseJSON(b64urlToBytes(body));
    if (!(d.x > Date.now()) || d.v !== version) return null;
    return d;
  } catch (e) { return null }
}

/* ---------- payment screenshots ---------- */
/* Website order IDs look like GA-261113-K7Q4 (shop initials, date, four characters). Screenshots are accepted only
   for IDs dated within the last few days, so old or made-up IDs cannot be used to fill the repository. */
export function recentOrderNo(no, now = Date.now()) {
  const m = /^[A-Z]{1,4}-(\d{2})(\d{2})(\d{2})-[0-9A-Z]{4}$/.exec(String(no || ""));
  if (!m) return false;
  const t = Date.UTC(2000 + +m[1], +m[2] - 1, +m[3]);
  return now - t < 4 * 864e5 && t - now < 2 * 864e5;
}
/* "jpg" or "png" when the base64 data starts like one of those images; otherwise "". */
export function imageKind(b64) {
  const s = String(b64 || "");
  if (!/^[A-Za-z0-9+/]{16}/.test(s)) return "";
  const h = atob(s.slice(0, 16));
  if (h.charCodeAt(0) === 0xFF && h.charCodeAt(1) === 0xD8 && h.charCodeAt(2) === 0xFF) return "jpg";
  if (h.slice(0, 4) === "\x89PNG") return "png";
  return "";
}
/* Short random text without look-alike characters, for file names. */
export const randomId = n => Array.from(crypto.getRandomValues(new Uint8Array(n)), b => "abcdefghijkmnpqrstuvwxyz23456789"[b % 32]).join("");

/* ---------- GitHub App installation tokens ---------- */
function pemToDer(pem) { return Uint8Array.from(atob(String(pem).replace(/-----[^-]+-----/g, "").replace(/\s/g, "")), c => c.charCodeAt(0)) }
/* A 9-minute JWT that identifies the GitHub App itself; the private key must be PKCS#8 ("BEGIN PRIVATE KEY"). */
export async function appJwt(privateKeyPem, issuer) {
  const key = await crypto.subtle.importKey("pkcs8", pemToDer(privateKeyPem), {name: "RSASSA-PKCS1-v1_5", hash: "SHA-256"}, false, ["sign"]);
  const now = Math.floor(Date.now() / 1000);
  const h = b64url(enc.encode(JSON.stringify({alg: "RS256", typ: "JWT"})));
  const p = b64url(enc.encode(JSON.stringify({iat: now - 60, exp: now + 540, iss: issuer})));
  return h + "." + p + "." + b64url(await crypto.subtle.sign("RSASSA-PKCS1-v1_5", key, enc.encode(h + "." + p)));
}
/* A 1-hour token limited to the given repositories with Contents read/write. */
export async function installationToken({privateKeyPem, issuer, owner, repos, userAgent = "giftoria-auth"}) {
  const H = {Authorization: "Bearer " + await appJwt(privateKeyPem, issuer), Accept: "application/vnd.github+json", "User-Agent": userAgent};
  const inst = await fetch(`https://api.github.com/repos/${owner}/${repos[0]}/installation`, {headers: H});
  if (!inst.ok) throw new Error("installation lookup failed: " + inst.status);
  const id = (await inst.json()).id;
  const r = await fetch(`https://api.github.com/app/installations/${id}/access_tokens`, {method: "POST", headers: {...H, "Content-Type": "application/json"},
    body: JSON.stringify({repositories: repos, permissions: {contents: "write", metadata: "read"}})});
  if (!r.ok) throw new Error("token request failed: " + r.status);
  const t = await r.json();
  return {token: t.token, exp: Date.parse(t.expires_at)};
}
