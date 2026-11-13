/* Checks for the sign-in building blocks. Run: node --test auth-worker/test */
import test from "node:test";
import assert from "node:assert/strict";
import {b64url, verifyGoogleIdToken, totpAt, checkTotp, makeSession, readSession, appJwt, b64urlToBytes} from "../src/lib.js";

const enc = new TextEncoder();
const CLIENT = "123-abc.apps.googleusercontent.com";

async function rsaPair() {
  return crypto.subtle.generateKey({name: "RSASSA-PKCS1-v1_5", modulusLength: 2048, publicExponent: new Uint8Array([1, 0, 1]), hash: "SHA-256"}, true, ["sign", "verify"]);
}
async function signJwt(privateKey, header, claims) {
  const h = b64url(enc.encode(JSON.stringify(header))), p = b64url(enc.encode(JSON.stringify(claims)));
  return h + "." + p + "." + b64url(await crypto.subtle.sign("RSASSA-PKCS1-v1_5", privateKey, enc.encode(h + "." + p)));
}

test("TOTP matches the RFC 6238 SHA-1 test vector", async () => {
  const secret = "GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQ"; // "12345678901234567890"
  assert.equal(await totpAt(secret, 1, 8), "94287082");          // T = 59 s
  assert.equal(await totpAt(secret, 37037036, 8), "07081804");   // T = 1111111109 s
  assert.equal(await totpAt(secret, 37037037, 8), "14050471");   // T = 1111111111 s
});

test("TOTP accepts the current and adjacent codes only", async () => {
  const secret = "JBSWY3DPEHPK3PXP", now = 1_800_000_000_000, step = Math.floor(now / 30000);
  assert.ok(await checkTotp(secret, await totpAt(secret, step), now));
  assert.ok(await checkTotp(secret, await totpAt(secret, step - 1), now));
  assert.ok(await checkTotp(secret, await totpAt(secret, step + 1), now));
  assert.ok(!(await checkTotp(secret, await totpAt(secret, step + 3), now)));
  assert.ok(!(await checkTotp(secret, "12345", now)));
  assert.ok(!(await checkTotp(secret, "abcdef", now)));
});

test("Google ID token: genuine accepted; forged, expired, wrong audience and unverified email refused", async () => {
  const good = await rsaPair(), evil = await rsaPair();
  const jwk = {...(await crypto.subtle.exportKey("jwk", good.publicKey)), kid: "k1", use: "sig", alg: "RS256"};
  const keys = async () => [jwk];
  const now = Math.floor(Date.now() / 1000);
  const base = {iss: "https://accounts.google.com", aud: CLIENT, email: "owner@gmail.com", email_verified: true, iat: now, exp: now + 3600};
  const H = {alg: "RS256", kid: "k1", typ: "JWT"};
  assert.equal((await verifyGoogleIdToken(await signJwt(good.privateKey, H, base), CLIENT, keys)).email, "owner@gmail.com");
  assert.equal(await verifyGoogleIdToken(await signJwt(evil.privateKey, H, base), CLIENT, keys), null, "forged signature");
  assert.equal(await verifyGoogleIdToken(await signJwt(good.privateKey, H, {...base, exp: now - 10}), CLIENT, keys), null, "expired");
  assert.equal(await verifyGoogleIdToken(await signJwt(good.privateKey, H, {...base, aud: "other"}), CLIENT, keys), null, "wrong audience");
  assert.equal(await verifyGoogleIdToken(await signJwt(good.privateKey, H, {...base, iss: "evil.com"}), CLIENT, keys), null, "wrong issuer");
  assert.equal(await verifyGoogleIdToken(await signJwt(good.privateKey, H, {...base, email_verified: false}), CLIENT, keys), null, "unverified email");
  assert.equal(await verifyGoogleIdToken(await signJwt(good.privateKey, {...H, alg: "none"}, base), CLIENT, keys), null, "alg none");
  const t = await signJwt(good.privateKey, H, base), [h, , s] = t.split(".");
  const tampered = h + "." + b64url(enc.encode(JSON.stringify({...base, email: "attacker@gmail.com"}))) + "." + s;
  assert.equal(await verifyGoogleIdToken(tampered, CLIENT, keys), null, "tampered claims");
  assert.equal(await verifyGoogleIdToken("garbage", CLIENT, keys), null);
});

test("sessions: valid accepted; tampered, wrong key, expired and old version refused", async () => {
  const s = await makeSession("secret-1", "owner@gmail.com", 60e3, "1");
  assert.equal((await readSession("secret-1", s, "1")).e, "owner@gmail.com");
  assert.equal(await readSession("secret-2", s, "1"), null, "wrong key");
  assert.equal(await readSession("secret-1", s, "2"), null, "old version");
  const [body, sig] = s.split(".");
  const forged = b64url(enc.encode(JSON.stringify({e: "attacker@gmail.com", x: Date.now() + 1e9, v: "1"}))) + "." + sig;
  assert.equal(await readSession("secret-1", forged, "1"), null, "tampered body");
  assert.equal(await readSession("secret-1", await makeSession("secret-1", "o@g.com", -1000, "1"), "1"), null, "expired");
  assert.equal(await readSession("secret-1", body + "." + sig + ".x", "1"), null, "extra part");
});

test("GitHub App JWT is signed with the app key and lasts under 10 minutes", async () => {
  const kp = await rsaPair();
  const der = new Uint8Array(await crypto.subtle.exportKey("pkcs8", kp.privateKey));
  const pem = "-----BEGIN PRIVATE KEY-----\n" + btoa(String.fromCharCode(...der)).match(/.{1,64}/g).join("\n") + "\n-----END PRIVATE KEY-----\n";
  const jwt = await appJwt(pem, "Iv23test");
  const [h, p, s] = jwt.split(".");
  assert.ok(await crypto.subtle.verify("RSASSA-PKCS1-v1_5", kp.publicKey, b64urlToBytes(s), enc.encode(h + "." + p)));
  const c = JSON.parse(new TextDecoder().decode(b64urlToBytes(p)));
  assert.equal(c.iss, "Iv23test");
  assert.ok(c.exp - c.iat <= 600);
});

test("payment screenshots: recent order IDs and real JPEG or PNG data only", async () => {
  const {recentOrderNo, imageKind, randomId} = await import("../src/lib.js");
  const now = Date.UTC(2026, 10, 13, 12);
  assert.ok(recentOrderNo("GA-261113-K7Q4", now));
  assert.ok(recentOrderNo("GA-261111-K7Q4", now), "two days old");
  assert.ok(recentOrderNo("GA-261114-K7Q4", now), "next day (time zones)");
  assert.ok(!recentOrderNo("GA-261101-K7Q4", now), "too old");
  assert.ok(!recentOrderNo("GA-261120-K7Q4", now), "future");
  assert.ok(!recentOrderNo("GA-1112-391", now), "old format");
  assert.ok(!recentOrderNo("GA-261113-K7Q4/../x", now));
  assert.ok(!recentOrderNo("", now));
  const b64 = bytes => btoa(String.fromCharCode(...bytes));
  assert.equal(imageKind(b64([0xFF, 0xD8, 0xFF, 0xE0, ...new Array(20).fill(1)])), "jpg");
  assert.equal(imageKind(b64([0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A, ...new Array(20).fill(0)])), "png");
  assert.equal(imageKind(b64([...enc.encode("<html><script>alert(1)</script>")])), "");
  assert.equal(imageKind("not base64 at all!!"), "");
  assert.equal(imageKind(""), "");
  assert.match(randomId(6), /^[a-z2-9]{6}$/);
  assert.notEqual(randomId(6), randomId(6));
});
