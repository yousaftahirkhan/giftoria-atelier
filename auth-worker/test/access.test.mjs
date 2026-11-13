/* Who can sign in: the Access page's list, first sign-in setup, removal, new authenticator, and the safety fallback.
   Google and GitHub are replaced by fakes. Run: node --test auth-worker/test */
import test from "node:test";
import assert from "node:assert/strict";
import worker from "../src/index.js";
import {b64url, totpAt, signAccess} from "../src/lib.js";

const enc = new TextEncoder(), ADMIN = "https://giftoria-atelier.pages.dev", CLIENT = "test-client.apps.googleusercontent.com";
const SHARED = "JBSWY3DPEHPK3PXP", SECRET = "test-session-secret";
const google = await crypto.subtle.generateKey({name: "RSASSA-PKCS1-v1_5", modulusLength: 2048, publicExponent: new Uint8Array([1, 0, 1]), hash: "SHA-256"}, true, ["sign", "verify"]);
const jwk = {...(await crypto.subtle.exportKey("jwk", google.publicKey)), kid: "g1", alg: "RS256", use: "sig"};
const appKey = await crypto.subtle.generateKey({name: "RSASSA-PKCS1-v1_5", modulusLength: 2048, publicExponent: new Uint8Array([1, 0, 1]), hash: "SHA-256"}, true, ["sign", "verify"]);
const pem = "-----BEGIN PRIVATE KEY-----\n" + btoa(String.fromCharCode(...new Uint8Array(await crypto.subtle.exportKey("pkcs8", appKey.privateKey)))) + "\n-----END PRIVATE KEY-----";
async function idToken(email) {
  const now = Math.floor(Date.now() / 1000);
  const h = b64url(enc.encode(JSON.stringify({alg: "RS256", kid: "g1", typ: "JWT"})));
  const p = b64url(enc.encode(JSON.stringify({iss: "https://accounts.google.com", aud: CLIENT, email, email_verified: true, iat: now, exp: now + 3600})));
  return h + "." + p + "." + b64url(await crypto.subtle.sign("RSASSA-PKCS1-v1_5", google.privateKey, enc.encode(h + "." + p)));
}
const files = new Map(); let shaN = 0;
globalThis.fetch = async (url, opt = {}) => {
  const u = new URL(url), m = opt.method || "GET", body = opt.body ? JSON.parse(opt.body) : null;
  const json = (o, s = 200) => new Response(JSON.stringify(o), {status: s, headers: {"content-type": "application/json"}});
  if (u.hostname === "www.googleapis.com") return json({keys: [jwk]});
  if (u.pathname === "/repos/o/site/installation") return json({id: 3});
  if (u.pathname === "/app/installations/3/access_tokens") return json({token: "t", expires_at: new Date(Date.now() + 3600e3).toISOString()}, 201);
  const f = u.pathname.match(/^\/repos\/o\/orders\/contents\/(.+)$/);
  if (f) {
    const path = decodeURIComponent(f[1]), cur = files.get(path);
    if (m === "GET") return cur ? json({sha: cur.sha, content: cur.content}) : json({message: "Not Found"}, 404);
    if ((body.sha || null) !== (cur ? cur.sha : null)) return json({message: "conflict"}, 409);
    files.set(path, {sha: "s" + (++shaN), content: body.content}); return json({content: {sha: "s" + shaN}}, 201);
  }
  return json({message: "unexpected " + url}, 500);
};
const env = {ADMIN_URL: ADMIN + "/admin/", SITE_ORIGINS: "", REPO_OWNER: "o", SITE_REPO: "site", ORDERS_REPO: "orders", GITHUB_CLIENT_ID: "Iv1.t", GITHUB_APP_PRIVATE_KEY: pem,
  GOOGLE_CLIENT_ID: CLIENT, ALLOWED_EMAILS: "owner@gmail.com, shop@gmail.com", TOTP_SECRET: SHARED, SESSION_SECRET: SECRET, SESSION_VERSION: "1"};
let ip = 0;
async function call(path, body) {
  const r = await worker.fetch(new Request("https://svc.example" + path, {method: "POST", headers: {"Content-Type": "application/json", Origin: ADMIN, "CF-Connecting-IP": "9.9.9." + (++ip)}, body: JSON.stringify(body)}), env);
  return {status: r.status, body: await r.json()};
}
const codeFor = secret => totpAt(secret, Math.floor(Date.now() / 30000));
const accessFile = () => JSON.parse(Buffer.from(files.get("access.json").content, "base64").toString("utf8"));

test("the Access page: add a person, their first sign-in, new authenticator, removal", async () => {
  // before any change, the owner signs in from the Cloudflare settings with the shared authenticator
  assert.deepEqual((await call("/login", {id_token: await idToken("owner@gmail.com")})).body, {need: "code", email: "owner@gmail.com"});
  const owner = await call("/login", {id_token: await idToken("owner@gmail.com"), code: await codeFor(SHARED)});
  assert.equal(owner.status, 200);
  const S1 = owner.body.session;
  assert.equal((await call("/token", {session: S1})).status, 200);
  let list = await call("/access", {session: S1, op: "list"});
  assert.equal(list.body.managed, false);
  assert.deepEqual(list.body.users.map(u => u.email), ["owner@gmail.com", "shop@gmail.com"]);
  assert.equal((await call("/access", {session: S1, op: "add", email: "not-an-email"})).body.error, "bad_email");

  // add Sara: the list becomes managed and signed; nobody can read her setup key from the file
  list = await call("/access", {session: S1, op: "add", email: "Sara@Gmail.com", name: "Sara"});
  assert.equal(list.status, 200);
  assert.equal(list.body.managed, true);
  assert.deepEqual(list.body.users.map(u => [u.email, u.status]), [["owner@gmail.com", "active"], ["shop@gmail.com", "active"], ["sara@gmail.com", "pending"]]);
  assert.equal((await call("/access", {session: S1, op: "add", email: "sara@gmail.com"})).body.error, "exists");
  const file = accessFile();
  assert.ok(file.sig && !JSON.stringify(file).includes(SHARED), "signed, and the shared secret is stored only encrypted");

  // Sara's first sign-in: she gets her own key (the same one if she asks twice) and confirms it with a code
  const p1 = await call("/login", {id_token: await idToken("sara@gmail.com")});
  const p2 = await call("/login", {id_token: await idToken("sara@gmail.com")});
  assert.equal(p1.body.setup, true);
  assert.equal(p1.body.secret, p2.body.secret);
  assert.match(p1.body.otpauth, /^otpauth:\/\/totp\/Giftoria%20Atelier:sara%40gmail\.com\?secret=[A-Z2-7]{32}&/);
  assert.notEqual(p1.body.secret, SHARED);
  assert.equal((await call("/login", {id_token: await idToken("sara@gmail.com"), code: "000000"})).body.error, "bad_code");
  const sara = await call("/login", {id_token: await idToken("sara@gmail.com"), code: await codeFor(p1.body.secret)});
  assert.equal(sara.status, 200);
  assert.equal(sara.body.name, "Sara");
  const S2 = sara.body.session;
  assert.equal((await call("/token", {session: S2})).status, 200);
  assert.equal((await call("/login", {id_token: await idToken("sara@gmail.com"), code: await codeFor(SHARED)})).body.error, "bad_code", "the shared code is not hers");

  // the owner still uses the shared authenticator; old sessions keep working
  assert.equal((await call("/login", {id_token: await idToken("owner@gmail.com"), code: await codeFor(SHARED)})).status, 200);
  assert.equal((await call("/token", {session: S1})).status, 200);

  // new authenticator for Sara: her session ends and she sets up again
  await call("/access", {session: S1, op: "reset", email: "sara@gmail.com"});
  assert.equal((await call("/token", {session: S2})).status, 401);
  const p3 = await call("/login", {id_token: await idToken("sara@gmail.com")});
  assert.equal(p3.body.setup, true);
  assert.notEqual(p3.body.secret, p1.body.secret);

  // removal, and the last person who can sign in cannot be removed
  await call("/access", {session: S1, op: "remove", email: "shop@gmail.com"});
  assert.equal((await call("/login", {id_token: await idToken("shop@gmail.com")})).body.error, "not_allowed");
  assert.equal((await call("/access", {session: S1, op: "remove", email: "owner@gmail.com"})).body.error, "last_admin");
  // Sara finishes her new setup; now the owner may leave, and is signed out
  assert.equal((await call("/login", {id_token: await idToken("sara@gmail.com"), code: await codeFor(p3.body.secret)})).status, 200);
  assert.equal((await call("/access", {session: S1, op: "remove", email: "owner@gmail.com"})).status, 200);
  assert.equal((await call("/token", {session: S1})).status, 401);
  assert.equal((await call("/access", {session: S1, op: "list"})).status, 401);
});

test("safety: an edited list is ignored, invitations expire", async () => {
  // someone with a GitHub token adds themselves directly: the signature no longer matches, so only the original owners count
  const d = accessFile();
  d.users.push({email: "attacker@gmail.com", name: "", status: "pending", sv: 0, added: Date.now()});
  files.set("access.json", {sha: "s" + (++shaN), content: Buffer.from(JSON.stringify(d)).toString("base64")});
  assert.equal((await call("/login", {id_token: await idToken("attacker@gmail.com")})).body.error, "not_allowed");
  assert.equal((await call("/login", {id_token: await idToken("sara@gmail.com")})).body.error, "not_allowed", "back to the Cloudflare list");
  assert.deepEqual((await call("/login", {id_token: await idToken("owner@gmail.com")})).body, {need: "code", email: "owner@gmail.com"});

  // a properly signed list with a 15-day-old invitation
  const doc = {users: [{email: "owner@gmail.com", name: "", status: "active", sv: 0, added: 0}, {email: "late@gmail.com", name: "", status: "pending", sv: 0, added: Date.now() - 15 * 864e5}], updated: Date.now()};
  doc.sig = await signAccess(SECRET, doc);
  files.set("access.json", {sha: "s" + (++shaN), content: Buffer.from(JSON.stringify(doc)).toString("base64")});
  assert.equal((await call("/login", {id_token: await idToken("late@gmail.com")})).body.error, "invite_expired");
});
