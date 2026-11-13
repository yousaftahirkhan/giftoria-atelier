/* The order service end to end, with GitHub replaced by a fake: payment screenshot upload (POST /proof) and the
   order that refers to it (POST /order). Run: node --test auth-worker/test */
import test from "node:test";
import assert from "node:assert/strict";
import worker from "../src/index.js";

const SITE = "https://giftoria-atelier.pages.dev";
async function pemKey() {
  const k = await crypto.subtle.generateKey({name: "RSASSA-PKCS1-v1_5", modulusLength: 2048, publicExponent: new Uint8Array([1, 0, 1]), hash: "SHA-256"}, true, ["sign", "verify"]);
  const der = new Uint8Array(await crypto.subtle.exportKey("pkcs8", k.privateKey));
  return "-----BEGIN PRIVATE KEY-----\n" + btoa(String.fromCharCode(...der)) + "\n-----END PRIVATE KEY-----";
}
/* A fake GitHub: remembers files written to the orders repository. */
function fakeGithub() {
  const files = new Map(), log = [];
  globalThis.fetch = async (url, opt = {}) => {
    const u = new URL(url), m = opt.method || "GET", body = opt.body ? JSON.parse(opt.body) : null;
    log.push([m, u.pathname]);
    const json = (o, s = 200) => new Response(JSON.stringify(o), {status: s, headers: {"content-type": "application/json"}});
    if (u.pathname === "/repos/o/site/installation") return json({id: 7});
    if (u.pathname === "/app/installations/7/access_tokens") return json({token: "inst-token", expires_at: new Date(Date.now() + 3600e3).toISOString()}, 201);
    const f = u.pathname.match(/^\/repos\/o\/orders\/contents\/(.+)$/);
    if (f) {
      const path = decodeURIComponent(f[1]);
      if (m === "GET") return files.has(path) ? json({sha: "s" + files.get(path).length, content: files.get(path)}) : json({message: "Not Found"}, 404);
      if (m === "PUT") { files.set(path, body.content); return json({content: {sha: "s1"}}, 201) }
    }
    return json({message: "unexpected " + u.pathname}, 500);
  };
  return {files, log};
}
const env = async () => ({ADMIN_URL: SITE + "/admin/", SITE_ORIGINS: "https://yousaftahirkhan.github.io", REPO_OWNER: "o", SITE_REPO: "site", ORDERS_REPO: "orders",
  GITHUB_CLIENT_ID: "Iv1.test", GITHUB_APP_PRIVATE_KEY: await pemKey()});
const post = (path, body, ip) => new Request("https://svc.example" + path, {method: "POST", headers: {"Content-Type": "application/json", Origin: SITE, "CF-Connecting-IP": ip || "1.2.3.4"}, body: JSON.stringify(body)});
const today = () => { const d = new Date(), p = n => String(n).padStart(2, "0"); return `GA-${String(d.getFullYear()).slice(2)}${p(d.getMonth() + 1)}${p(d.getDate())}-K7Q4` };
const JPEG = btoa(String.fromCharCode(0xFF, 0xD8, 0xFF, 0xE0, ...new Array(900).fill(65)));

test("payment screenshot is stored privately and linked to the order", async () => {
  const gh = fakeGithub(), E = await env(), no = today();
  const r = await worker.fetch(post("/proof", {no, image: "data:image/jpeg;base64," + JPEG}), E);
  assert.equal(r.status, 200);
  assert.equal(r.headers.get("Access-Control-Allow-Origin"), SITE);
  const {path} = await r.json();
  assert.match(path, new RegExp("^proofs/" + no + "-[a-z0-9]{6}\\.jpg$"));
  assert.equal(gh.files.get(path), JPEG, "stored as sent, without the data: prefix");

  const order = {no, items: [{name: "Pink Tulip Bouquet", qty: 1, price: 1450}], tot: 1450, adv: 730, rest: 720, pct: 50, name: "Test Buyer", phone: "0300 1234567", proof: path};
  const o = await worker.fetch(post("/order", {order}), E);
  assert.equal(o.status, 200);
  const saved = JSON.parse(Buffer.from(gh.files.get("orders.json"), "base64").toString("utf8"));
  assert.equal(saved[0].no, no);
  assert.equal(saved[0].status, "new");
  assert.deepEqual(saved[0].proofs.map(p => [p.p, p.k]), [[path, "advance"]]);
});

test("screenshots: bad data, old IDs and other orders' files are refused", async () => {
  const gh = fakeGithub(), E = await env(), no = today();
  assert.equal((await worker.fetch(post("/proof", {no, image: btoa("<script>alert(1)</script>".repeat(60))}, "5.5.5.1"), E)).status, 400, "not an image");
  assert.equal((await worker.fetch(post("/proof", {no: "GA-240101-K7Q4", image: JPEG}, "5.5.5.2"), E)).status, 400, "old order ID");
  assert.equal((await worker.fetch(post("/proof", {no: "../../x", image: JPEG}, "5.5.5.3"), E)).status, 400, "path in ID");
  assert.equal((await worker.fetch(post("/proof", {no, image: "A".repeat(1500000)}, "5.5.5.4"), E)).status, 413, "too large");
  assert.equal([...gh.files.keys()].length, 0, "nothing written");
  const order = {no, items: [{name: "Rose Box", qty: 1, price: 2800}], tot: 2800, adv: 1400, rest: 1400, pct: 50, name: "Test Buyer", phone: "0300 1234567", proof: "proofs/GA-261101-ZZZZ-abcdef.jpg"};
  await worker.fetch(post("/order", {order}, "5.5.5.5"), E);
  const saved = JSON.parse(Buffer.from(gh.files.get("orders.json"), "base64").toString("utf8"));
  assert.deepEqual(saved[0].proofs, [], "a screenshot named for another order is not linked");
});

test("full payment upfront: the screenshot is filed as the full payment", async () => {
  const gh = fakeGithub(), E = await env(), no = today().replace("K7Q4", "F9P2");
  const {path} = await (await worker.fetch(post("/proof", {no, image: JPEG}, "6.6.6.6"), E)).json();
  await worker.fetch(post("/order", {order: {no, items: [{name: "Sunflower Trio", qty: 1, price: 1250}], tot: 1250, adv: 1250, rest: 0, pct: 100, name: "Test", phone: "0300 1234567", proof: path}}, "6.6.6.6"), E);
  const saved = JSON.parse(Buffer.from(gh.files.get("orders.json"), "base64").toString("utf8"));
  assert.equal(saved[0].proofs[0].k, "full");
});
