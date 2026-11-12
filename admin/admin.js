/* Super admin. Signs in with a GitHub access token, then:
   - content (products, homepage, business, payments) is edited here and published as one commit to the
     website repository: data/shop.json plus any new photos under images/;
   - orders are kept in orders.json in a separate private repository, so customer details never go public. */
"use strict";
const CFG = window.ADMIN_CONFIG || {};
const GH_OWNER = CFG.owner || location.hostname.split(".")[0];
const REPO = CFG.repo || location.pathname.split("/").filter(Boolean)[0] || "giftoria-atelier";
const BRANCH = CFG.branch || "main";
const ORDERS_REPO = CFG.ordersRepo || "giftoria-orders";
const SITE = `/repos/${GH_OWNER}/${REPO}`, ORD = `/repos/${GH_OWNER}/${ORDERS_REPO}`;
const TOKEN_KEY = "ga-admin-token";

document.querySelectorAll(".logoArt").forEach(el => el.innerHTML = LOGO);
$("hRepo").textContent = REPO; $("hOrders").textContent = ORDERS_REPO; $("ordersRepoName").textContent = ORDERS_REPO;

let TOKEN = "";
let S = normalizeShop({});

/* ---------- GitHub API ---------- */
class GHError extends Error { constructor(status, msg) { super(msg); this.status = status } }
/* In "app" mode (Google + authenticator sign-in) the token comes from the sign-in service and lasts 1 hour;
   it is renewed from the signed session shortly before it runs out, or once if GitHub rejects it. */
async function gh(path, opts = {}) {
  if (MODE === "app" && TOKEN_EXP - Date.now() < 5 * 60e3) await refreshAppToken();
  try { return await ghOnce(path, opts) }
  catch (e) { if (MODE === "app" && e.status === 401) { await refreshAppToken(); return ghOnce(path, opts) } throw e }
}
async function ghOnce(path, {method = "GET", body, raw} = {}) {
  let r;
  try {
    r = await fetch("https://api.github.com" + path, {method, cache: "no-store",
      headers: {Authorization: "Bearer " + TOKEN, Accept: raw ? "application/vnd.github.raw+json" : "application/vnd.github+json", ...(body ? {"Content-Type": "application/json"} : {})},
      body: body ? JSON.stringify(body) : undefined});
  } catch (e) { throw new GHError(0, "No internet connection. Check your connection and try again.") }
  if (!r.ok) { let m = ""; try { m = (await r.json()).message || "" } catch (e) {} throw new GHError(r.status, m) }
  if (r.status === 204) return null;
  return raw ? r.text() : r.json();
}
function errText(e) {
  if (!e || e.status == null) return "Something went wrong. Please try again.";
  if (e.status === 0) return e.message;
  if (e.status === 401) return "Your sign-in has expired or is not valid. Sign out and sign in again.";
  if (e.status === 403) return /rate limit/i.test(e.message) ? "GitHub is busy. Please wait a minute and try again." : "This token is not allowed to make changes. On GitHub, set the token's Contents permission to Read and write.";
  if (e.status === 404) return "The shop's repository could not be opened with this token. Check the token's repository access.";
  if (e.status === 409 || e.status === 422) return "Another change was saved at the same time. Please try again.";
  return "Something went wrong (" + e.status + "). Please try again.";
}
function b64encUtf8(str) { const bytes = new TextEncoder().encode(str); let bin = ""; for (let i = 0; i < bytes.length; i += 0x8000) bin += String.fromCharCode.apply(null, bytes.subarray(i, i + 0x8000)); return btoa(bin) }
function b64decUtf8(b64) { const bin = atob(String(b64).replace(/\s/g, "")); const bytes = new Uint8Array(bin.length); for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i); return new TextDecoder().decode(bytes) }

/* ---------- sign in / out ----------
   Main route: "Sign in with GitHub". GitHub checks the password and authenticator code, the sign-in service
   (auth-worker/) swaps GitHub's one-time code for an 8-hour token and sends it back here in the URL fragment.
   Fallback: a fine-grained access token pasted into the form. */
const EXP_KEY = "ga-admin-exp", STATE_KEY = "ga-oauth-state";
const ADMINS = (CFG.admins || [GH_OWNER]).map(s => String(s).toLowerCase());
const store = k => { try { return localStorage.getItem(k) || sessionStorage.getItem(k) || "" } catch (e) { return "" } };
const storedToken = () => { const exp = +store(EXP_KEY); if (exp && Date.now() > exp) { dropToken(); return "" } return store(TOKEN_KEY) };
const dropToken = () => { try { [TOKEN_KEY, EXP_KEY].forEach(k => { localStorage.removeItem(k); sessionStorage.removeItem(k) }) } catch (e) {} };
const keepToken = (t, remember, expiresAt) => { dropToken(); try { const s = remember ? localStorage : sessionStorage; s.setItem(TOKEN_KEY, t); if (expiresAt) s.setItem(EXP_KEY, String(expiresAt)) } catch (e) {} };
let ORDERS_OK = false;

async function signIn(t, mode = "user") {
  TOKEN = t; MODE = mode;
  if (mode === "user") {
    const me = await gh("/user");
    if (!ADMINS.includes(String(me.login).toLowerCase())) { const e = new GHError(403, "not admin"); e.notAdmin = me.login; throw e }
  }
  await gh(SITE);
  try { await gh(ORD); ORDERS_OK = true } catch (e) { ORDERS_OK = false }
  await loadContent();
  $("booting").hidden = true; $("signin").hidden = true; $("app").hidden = false;
  const h = location.hash.slice(1); selectTab(TABS.includes(h) ? h : "orders");
  loadOrders();
}
const signInError = e => e && e.notAdmin ? `The GitHub account ${e.notAdmin} is not allowed to manage this shop.` : e && e.status === 401 ? "Your sign-in has expired. Please sign in again." : errText(e);
function showSignin(msg, where = "google") {
  TOKEN = ""; MODE = "user"; $("booting").hidden = true; $("app").hidden = true; $("signin").hidden = false;
  $("gMsg").textContent = where === "google" ? msg || "" : ""; $("ghMsg").textContent = where === "github" ? msg || "" : "";
  $("signMsg").textContent = ""; $("tok").value = "";
  if (!CFG.githubAppClientId || !CFG.authUrl) $("ghSignin").hidden = true;
  if (!CFG.googleClientId || !CFG.authUrl) { $("gSignin").hidden = true; $("otherWays").open = true }
  if (where === "github") $("otherWays").open = true;
}

/* ---------- Google + authenticator sign-in ---------- */
const SESSION_KEY = "ga-admin-session", SESSION_EXP_KEY = "ga-admin-session-exp";
let MODE = "user", TOKEN_EXP = 0, SESSION = "", gCred = null;
const loadSession = () => { const s = store(SESSION_KEY), x = +store(SESSION_EXP_KEY); if (s && x > Date.now()) return s; dropSession(); return "" };
const dropSession = () => { try { [SESSION_KEY, SESSION_EXP_KEY].forEach(k => { localStorage.removeItem(k); sessionStorage.removeItem(k) }) } catch (e) {} };
const keepSession = (s, exp, remember) => { dropSession(); try { const st = remember ? localStorage : sessionStorage; st.setItem(SESSION_KEY, s); st.setItem(SESSION_EXP_KEY, String(exp)) } catch (e) {} };
async function authPost(path, body) {
  let r;
  try { r = await fetch(CFG.authUrl.replace(/\/$/, "") + path, {method: "POST", cache: "no-store", headers: {"Content-Type": "application/json"}, body: JSON.stringify(body)}) }
  catch (e) { throw new GHError(0, "No internet connection. Check your connection and try again.") }
  const d = await r.json().catch(() => ({}));
  if (!r.ok) { const e = new GHError(r.status, d.error || ""); e.code = d.error; throw e }
  return d;
}
async function refreshAppToken() {
  const d = await authPost("/token", {session: SESSION});
  TOKEN = d.token; TOKEN_EXP = d.token_exp; return d;
}
function initGoogle() {
  if (!CFG.googleClientId || !CFG.authUrl) return;
  const go = () => {
    google.accounts.id.initialize({client_id: CFG.googleClientId, callback: onGoogle, auto_select: false, ux_mode: "popup", itp_support: true});
    google.accounts.id.renderButton($("gBtn"), {theme: "filled_black", size: "large", shape: "pill", text: "signin_with", logo_alignment: "left", width: 300});
  };
  if (window.google && google.accounts && google.accounts.id) return go();
  let n = 0; const t = setInterval(() => {
    if (window.google && google.accounts && google.accounts.id) { clearInterval(t); go() }
    else if (++n > 75) { clearInterval(t); $("gMsg").textContent = "Google sign-in could not load. Check your connection and reload the page." }
  }, 200);
}
function onGoogle(resp) {
  gCred = resp && resp.credential; let email = "";
  try { email = JSON.parse(atob(gCred.split(".")[1].replace(/-/g, "+").replace(/_/g, "/"))).email || "" } catch (e) {}
  $("gEmail").textContent = email || "your Google account";
  $("gStep1").hidden = true; $("gStep2").hidden = false; $("gMsg").textContent = ""; $("otp").value = ""; $("otp").focus();
}
$("gRestart").onclick = () => { gCred = null; $("gStep2").hidden = true; $("gStep1").hidden = false; $("gMsg").textContent = ""; try { google.accounts.id.disableAutoSelect() } catch (e) {} };
$("otp").addEventListener("input", () => { $("otp").value = $("otp").value.replace(/\D/g, "").slice(0, 6) });
const LOGIN_ERR = {
  bad_code: "That code is not correct. Use the newest code in your authenticator app and check that your phone's time is set automatically.",
  google_invalid: "Your Google sign-in has expired. Select \"Use a different Google account\" and sign in again.",
  not_allowed: "This Google account is not allowed to manage this shop.",
  too_many: "Too many wrong codes. Please wait 15 minutes and try again."
};
$("gStep2").addEventListener("submit", async e => {
  e.preventDefault();
  const code = $("otp").value.replace(/\D/g, "");
  if (code.length !== 6) { $("gMsg").textContent = "Enter the 6-digit code from your authenticator app."; return }
  $("otpBtn").disabled = true; $("otpBtn").textContent = "Checking…"; $("gMsg").textContent = "";
  try {
    const d = await authPost("/login", {id_token: gCred, code, remember: $("trust").checked});
    SESSION = d.session; keepSession(d.session, d.session_exp, $("trust").checked); TOKEN_EXP = d.token_exp; dropToken();
    await signIn(d.token, "app");
  } catch (err) {
    $("gMsg").textContent = LOGIN_ERR[err.code] || signInError(err);
    if (err.code === "google_invalid" || err.code === "not_allowed") { gCred = null; $("gStep2").hidden = true; $("gStep1").hidden = false }
    if (err.code === "bad_code") { $("otp").value = ""; $("otp").focus() }
  } finally { $("otpBtn").disabled = false; $("otpBtn").textContent = "Verify and sign in" }
});
$("ghBtn").onclick = () => {
  const state = Array.from(crypto.getRandomValues(new Uint8Array(16)), b => b.toString(16).padStart(2, "0")).join("");
  try { sessionStorage.setItem(STATE_KEY, state) } catch (e) {}
  $("ghBtn").disabled = true; $("ghMsg").textContent = "";
  location.href = "https://github.com/login/oauth/authorize?" + new URLSearchParams({client_id: CFG.githubAppClientId, redirect_uri: CFG.authUrl.replace(/\/$/, "") + "/callback", state});
};
/* Reads the sign-in result the service put in the URL fragment, then removes it from the address bar. */
function takeAuthReturn() {
  const h = new URLSearchParams(location.hash.slice(1));
  if (!h.has("token") && !h.has("auth_error")) return null;
  history.replaceState(null, "", location.pathname);
  let expected = ""; try { expected = sessionStorage.getItem(STATE_KEY) || ""; sessionStorage.removeItem(STATE_KEY) } catch (e) {}
  if (!expected || h.get("state") !== expected) return {error: "Sign-in could not be confirmed. Please try again."};
  const err = h.get("auth_error");
  if (err) return {error: err === "denied" ? "Sign-in was cancelled." : err === "not_allowed" ? "This GitHub account is not allowed to manage this shop." : "Sign-in did not complete. Please try again."};
  return {token: h.get("token"), expiresAt: Date.now() + (Math.max(60, +h.get("expires_in") || 28800) - 60) * 1000};
}
$("signinForm").addEventListener("submit", async e => {
  e.preventDefault();
  const t = $("tok").value.trim();
  if (!t) { $("signMsg").textContent = "Paste your access token."; return }
  $("signBtn").disabled = true; $("signBtn").textContent = "Signing in…"; $("signMsg").textContent = "";
  try { await signIn(t); keepToken(t, $("remember").checked) }
  catch (err) { TOKEN = ""; $("signMsg").textContent = err && err.status === 401 ? "This access token is not valid or has expired. Check it and try again." : signInError(err) }
  finally { $("signBtn").disabled = false; $("signBtn").textContent = "Sign in with token" }
});
$("signOut").onclick = () => {
  if (dirty && !confirm("You have unpublished changes. Sign out and discard them?")) return;
  dirty = false; dropToken(); dropSession(); try { google.accounts.id.disableAutoSelect() } catch (e) {}
  history.replaceState(null, "", location.pathname); location.reload();
};

/* ---------- tabs ---------- */
const TABS = ["orders", "products", "home", "business", "pay"];
function selectTab(t) {
  document.querySelectorAll(".tab").forEach(x => x.setAttribute("aria-selected", x.dataset.tab === t));
  TABS.forEach(k => $("tab-" + k).hidden = k !== t);
  $("saveBar").hidden = t === "orders";
  history.replaceState(null, "", "#" + t); scrollTo(0, 0);
}
document.querySelectorAll(".tab").forEach(b => b.onclick = () => selectTab(b.dataset.tab));

/* =====================================================================
   ORDERS (private repository: orders.json)
   ===================================================================== */
const STATUS = [["new","Awaiting payment"],["paid","Payment approved"],["making","In progress"],["sent","Out for delivery"],["done","Delivered"],["cancel","Cancelled"]];
const STATUS_LBL = Object.fromEntries(STATUS);
const FILTERS = [["open","Active"],["new","Awaiting payment"],["paid","Payment approved"],["making","In progress"],["sent","Out for delivery"],["done","Delivered"],["all","All"]];
let ORDERS = [], ordersSha = null, oFilter = "open", parsed = null, ordersBusy = false;

$("oFilter").innerHTML = FILTERS.map(([k, l]) => `<button class="chip" data-f="${k}" aria-pressed="${k === oFilter}">${l}</button>`).join("");
$("oFilter").addEventListener("click", e => { const b = e.target.closest("[data-f]"); if (!b) return; oFilter = b.dataset.f;
  $("oFilter").querySelectorAll(".chip").forEach(c => c.setAttribute("aria-pressed", c === b)); renderOrders() });
$("oSearch").addEventListener("input", () => renderOrders());
$("oRefresh").onclick = () => loadOrders(true);
document.addEventListener("visibilitychange", () => { if (!document.hidden && TOKEN && !$("tab-orders").hidden) loadOrders() });
/* Website orders arrive on their own; check for new ones every minute while the Orders tab is open. */
setInterval(() => { if (!document.hidden && TOKEN && !$("tab-orders").hidden && !ordersBusy) loadOrders() }, 60e3);

async function fetchOrders() {
  try {
    const f = await gh(`${ORD}/contents/orders.json`);
    const text = f.content ? b64decUtf8(f.content) : b64decUtf8((await gh(`${ORD}/git/blobs/${f.sha}`)).content);
    const list = JSON.parse(text || "[]");
    return {list: Array.isArray(list) ? list : [], sha: f.sha};
  } catch (e) { if (e.status === 404) return {list: [], sha: null}; throw e }
}
async function loadOrders(manual) {
  $("ordersOff").hidden = ORDERS_OK;
  if (!ORDERS_OK) { $("oList").innerHTML = `<div class="empty-box">Orders cannot be saved until order storage is connected.</div>`; renderStats(); return }
  if (!ORDERS.length && !ordersSha) $("oList").innerHTML = `<div class="empty-box">Loading orders…</div>`;
  try { const r = await fetchOrders(); ORDERS = r.list; ordersSha = r.sha; renderOrders(); if (manual) toast("Orders are up to date") }
  catch (e) { $("oList").innerHTML = `<div class="empty-box">Orders could not load. ${esc(errText(e))}</div>` }
}
/* Applies a change to the latest orders.json and saves it; if another device saved first, reloads and retries once. */
async function mutateOrders(fn, message) {
  if (ordersBusy) { toast("Saving the previous change. Please wait."); return false }
  ordersBusy = true;
  try {
    for (let attempt = 0; attempt < 2; attempt++) {
      const next = fn(ORDERS.map(o => ({...o})));
      try {
        const r = await gh(`${ORD}/contents/orders.json`, {method: "PUT", body: {message, content: b64encUtf8(JSON.stringify(next, null, 1) + "\n"), ...(ordersSha ? {sha: ordersSha} : {})}});
        ORDERS = next; ordersSha = r.content.sha; renderOrders(); return true;
      } catch (e) {
        if ((e.status === 409 || e.status === 422) && attempt === 0) { const r = await fetchOrders(); ORDERS = r.list; ordersSha = r.sha; continue }
        throw e;
      }
    }
  } catch (e) { toast(errText(e)); return false }
  finally { ordersBusy = false }
  return false;
}
/* WhatsApp message telling the customer about their order's current status. */
function statusText(o, status) {
  const shop = S.shop.name || "our shop", hi = `Hello ${o.name || ""},`, id = `Tracking ID: *${o.no}*`;
  const site = location.origin + location.pathname.replace(/admin\/[^/]*$/, ""), track = `Track your order: ${site}#track=${encodeURIComponent(o.no)}`;
  const bal = o.rest ? `Balance to pay on delivery: *${rs(o.rest)}*` : "Your order is fully paid.";
  const T = {
    paid: [`${hi} we have received your payment${o.adv ? " of " + rs(o.adv) : ""}. Thank you!`, "", `*Your order is confirmed.* ${id}`, bal, "", "We have started making your order by hand and will update you when it is out for delivery."],
    making: [`${hi} your order is now being made by hand.`, "", id, "We will message you as soon as it is out for delivery."],
    sent: [`${hi} your order is *out for delivery* today by inDrive.`, "", id, o.rest ? `Balance due: *${rs(o.rest)}*, plus the inDrive fare for the rider.` : "Your order is fully paid. Please keep the inDrive fare ready for the rider.", "Please keep your phone nearby so the rider can reach you."],
    done: [`${hi} your order has been *delivered*. Thank you for shopping with ${shop}!`, "", id, "We would love to see a photo or hear your feedback. Reply here any time."],
    cancel: [`${hi} your order ${o.no} has been cancelled.`, "", "If you have any questions or this is a mistake, please reply to this message."]
  }[status];
  if (!T) return "";
  return [...T, ...(status === "cancel" || status === "done" ? [] : ["", track]), "", `— ${shop}`].join("\n");
}
const statusLink = (o, st) => `https://wa.me/${intl(o.phone)}?text=${encodeURIComponent(statusText(o, st))}`;

/* WhatsApp message to the customer with the advance due and the shop's payment accounts. */
function paymentText(o) {
  const acc = payAccounts(S), shop = S.shop.name || "our shop";
  const L = [`Hello ${o.name || ""}, thank you for your order with ${shop}.`, "", `Tracking ID: *${o.no}*`, `Total: ${rs(o.tot)}`, `*Advance due: ${rs(o.adv)}*`, ""];
  if (acc.length) { L.push("Please send the advance to any one of these accounts:"); acc.forEach(a => L.push(`• ${a.k}: ${a.v}${a.who ? " (" + a.who + ")" : ""}`)) }
  else L.push("We will share our account details with you shortly.");
  L.push("", "After paying, please share the payment screenshot in this chat. We will confirm your order once the payment is checked.");
  const site = location.origin + location.pathname.replace(/admin\/[^/]*$/, "");
  L.push("", `Track your order: ${site}#track=${encodeURIComponent(o.no)}`);
  return L.join("\n");
}
function renderStats() {
  const now = new Date(), m = now.getMonth(), y = now.getFullYear();
  $("stCount").textContent = ORDERS.filter(o => o.status !== "cancel").length;
  $("stPending").textContent = ORDERS.filter(o => o.status === "new").length;
  $("stMonth").textContent = rs(ORDERS.filter(o => { const d = new Date(o.at); return o.status !== "cancel" && d.getMonth() === m && d.getFullYear() === y }).reduce((s, o) => s + (o.tot || 0), 0));
}
function renderFilterCounts() {
  const n = k => ORDERS.filter(o => k === "all" || (k === "open" ? !["done", "cancel"].includes(o.status) : o.status === k)).length;
  $("oFilter").querySelectorAll("[data-f]").forEach(b => { const k = b.dataset.f; b.textContent = `${FILTERS.find(f => f[0] === k)[1]} (${n(k)})` });
}
function renderOrders() {
  renderStats(); renderFilterCounts();
  ORDERS.sort((a, b) => (b.at || 0) - (a.at || 0));
  const q = $("oSearch").value.trim().toLowerCase(), qd = q.replace(/\D/g, "");
  const list = (q ? ORDERS : ORDERS.filter(o => oFilter === "all" || (oFilter === "open" ? !["done", "cancel"].includes(o.status) : o.status === oFilter)))
    .filter(o => !q || [o.no, o.name, o.phone, o.city].join(" ").toLowerCase().includes(q) || (qd.length >= 4 && String(o.phone).replace(/\D/g, "").includes(qd)));
  $("oList").innerHTML = list.length ? list.map(o => `<div class="ocard" data-s="${esc(o.status)}">
    <div class="ohead"><span class="no">${esc(o.no)}${o.source === "website" ? ` <span class="src">Website</span>` : ""}</span><span class="sub">${new Date(o.at).toLocaleDateString("en-PK", {day: "numeric", month: "short"})}${o.needTxt ? " · needed by " + esc(o.needTxt) : ""}</span></div>
    <div><b>${esc(o.name || "—")}</b> <span class="sub">· ${esc(o.phone)} · ${esc(o.city)}</span></div>
    ${o.addr ? `<div class="sub">${o.area ? esc(o.area) + " · " : ""}${esc(o.addr)}</div>` : ""}
    ${o.items && o.items.length ? `<ul class="oitems">${o.items.map(i => `<li>${esc(i.name)} × ${i.qty}</li>`).join("")}</ul>` : ""}
    ${o.card ? `<div class="sub">Card: ${esc(o.card)}</div>` : ""}${o.note ? `<div class="sub">Note: ${esc(o.note)}</div>` : ""}
    <div class="omoney"><span>Total <b>${rs(o.tot)}</b></span>${o.adv ? `<span>Advance <b>${rs(o.adv)}</b></span><span>Balance <b>${rs(o.rest)}</b></span>` : ""}</div>
    ${o.status === "new" ? `<div class="banner warn" style="display:flex;flex-wrap:wrap;gap:10px;align-items:center;justify-content:space-between"><span>Approve only after you have checked the payment screenshot on WhatsApp.</span><button class="btn em" data-approve="${esc(o.no)}" style="padding:8px 16px">✓ Approve payment</button></div>` : ""}
    <div class="ofoot">
      <select data-st="${esc(o.no)}" aria-label="Status">${STATUS.map(([k, l]) => `<option value="${k}"${k === o.status ? " selected" : ""}>${l}</option>`).join("")}</select>
      ${o.phone ? `<a class="sm green" href="https://wa.me/${intl(o.phone)}" target="_blank" rel="noopener">WhatsApp</a>` : ""}
      ${o.phone && o.status === "new" && o.adv ? `<a class="sm green" href="https://wa.me/${intl(o.phone)}?text=${encodeURIComponent(paymentText(o))}" target="_blank" rel="noopener">Send payment details</a>` : ""}
      ${o.phone && o.status !== "new" ? `<a class="sm green" href="${statusLink(o, o.status)}" target="_blank" rel="noopener">Send update: ${esc(STATUS_LBL[o.status])}</a>` : ""}
      <button class="sm red" data-odel="${esc(o.no)}">Delete</button>
    </div></div>`).join("")
    : `<div class="empty-box">${q ? "No order found for this tracking ID, name or phone number. If the customer ordered on WhatsApp only, add it with the box at the bottom." : ORDERS.length ? "No orders with this status." : "No orders yet. Orders placed on the website appear here automatically."}</div>`;
}
$("oList").addEventListener("change", async e => {
  const s = e.target.closest("[data-st]"); if (!s) return; const no = s.dataset.st, st = s.value;
  if (await mutateOrders(list => list.map(o => o.no === no ? {...o, status: st} : o), `Order ${no}: ${STATUS_LBL[st]}`)) toast(st === "new" ? "Status: " + STATUS_LBL[st] : `Status: ${STATUS_LBL[st]}. Tap "Send update" to tell the customer.`);
  else renderOrders();
});
$("oList").addEventListener("click", async e => {
  const ap = e.target.closest("[data-approve]"), del = e.target.closest("[data-odel]");
  if (ap) { ap.disabled = true; const no = ap.dataset.approve, ord = ORDERS.find(o => o.no === no);
    const win = ord && ord.phone ? window.open("", "_blank") : null;
    if (await mutateOrders(list => list.map(o => o.no === no ? {...o, status: "paid", approvedAt: Date.now()} : o), `Order ${no}: payment approved`)) {
      if (win) { win.location.href = statusLink(ord, "paid"); toast("Payment approved. Send the confirmation in WhatsApp.") } else toast("Payment approved for " + no);
    } else { ap.disabled = false; if (win) win.close() }
    return }
  if (del) { if (del.dataset.sure !== "1") { del.dataset.sure = "1"; del.textContent = "Confirm delete"; return }
    const no = del.dataset.odel; if (await mutateOrders(list => list.filter(o => o.no !== no), `Delete order ${no}`)) toast("Order deleted") }
});

/* Reads a WhatsApp order message (the format the storefront sends) back into fields. */
function parseOrder(raw) {
  const t = raw.replace(/\*/g, "").replace(/\r/g, "");
  const g = re => { const m = t.match(re); return m ? m[1].trim() : "" };
  const items = []; t.split("\n").forEach(l => { const m = l.match(/^\s*[•\-]\s*(.+?)\s+[x×]\s*(\d+)\s*(?:=|—|–|-)\s*Rs\.?\s*([\d,]+)/i); if (m) { const q = +m[2]; items.push({name: m[1].trim(), qty: q, price: Math.round(num(m[3]) / q)}) } });
  const o = {no: g(/(?:Order|Tracking ID)\s*[—–\-:#*]*\s*\*?([A-Z]{1,4}-(?:\d{4}-\d{2,5}|\d{6}-[0-9A-Z]{4}))/i).toUpperCase(), items,
    del: num(g(/(?:^|\n)\s*Delivery:\s*Rs\.?\s*([\d,]+)/i)), tot: num(g(/(?:^|\n)\s*Total:\s*Rs\.?\s*([\d,]+)/i)), adv: num(g(/Advance[^:\n]*:\s*Rs\.?\s*([\d,]+)/i)),
    name: g(/(?:Naam|Name):\s*(.+)/i), phone: g(/Phone:\s*(.+)/i), city: g(/City:\s*(.+)/i), addr: g(/Address:\s*(.+)/i), area: g(/Area:\s*(.+)/i),
    needTxt: g(/(?:Kab chahiye|Needed by):\s*(.+)/i), card: g(/Card(?: message)?:\s*(.+)/i), note: g(/Note:\s*(.+)/i)};
  if (!o.tot && items.length) o.tot = items.reduce((s, i) => s + i.price * i.qty, 0) + o.del;
  if (!o.no) o.no = makeOrderNo(S.shop.name);
  o.rest = Math.max(0, o.tot - o.adv);
  return (o.name || o.phone || items.length) ? o : null;
}
$("pasteRead").onclick = () => {
  parsed = parseOrder($("pasteBox").value);
  if (!parsed) { $("pastePreview").innerHTML = `<p class="msg err" style="text-align:left">No order was found in this message. Paste the customer's full order message.</p>`; $("pasteSave").disabled = true; return }
  const dup = ORDERS.some(o => o.no === parsed.no);
  $("pastePreview").innerHTML = `<div class="preview"><b>${esc(parsed.no)}</b> · ${esc(parsed.name)} · ${esc(parsed.phone)}<br>${parsed.items.map(i => esc(i.name) + " × " + i.qty).join(", ") || "No items found"}<br>Total ${rs(parsed.tot)}${parsed.adv ? ` · Advance ${rs(parsed.adv)}` : ""}${dup ? `<br><b style="color:var(--rose)">This order is already saved. Saving again will replace it.</b>` : ""}</div>`;
  $("pasteSave").disabled = !ORDERS_OK;
};
$("pasteSave").onclick = async () => {
  if (!parsed || !ORDERS_OK) return; $("pasteSave").disabled = true;
  const o = {...parsed, status: parsed.adv ? "new" : "paid", at: Date.now()};
  if (await mutateOrders(list => [o, ...list.filter(x => x.no !== o.no)], `Add order ${o.no}`)) {
    $("pasteBox").value = ""; $("pastePreview").innerHTML = ""; parsed = null; toast("Order " + o.no + " saved");
  } else $("pasteSave").disabled = false;
};

/* =====================================================================
   CONTENT (website repository: data/shop.json + images/)
   ===================================================================== */
let baseSha = null, loadedImgs = new Set(), dirty = false, saving = false, editVer = 0, editing = null, editId = null, pending = null;
const M = $("manager");
const getPath = (o, p) => p.split(".").reduce((a, k) => a == null ? a : a[k], o);
function setPath(o, p, v) { const ks = p.split("."); let a = o; for (let i = 0; i < ks.length - 1; i++) { if (a[ks[i]] == null) a[ks[i]] = /^\d+$/.test(ks[i + 1]) ? [] : {}; a = a[ks[i]] } a[ks[ks.length - 1]] = v }
function imgPaths(D) {
  const out = new Set(), add = v => { if (typeof v === "string" && v.startsWith("images/")) out.add(v) };
  D.products.forEach(p => add(p.photo)); D.slides.forEach(s => add(s && s.photo)); add(D.promo.photo); add(D.about.photo); (D.gallery || []).forEach(add);
  return out;
}
async function loadContent() {
  const ref = await gh(`${SITE}/git/ref/heads/${BRANCH}`);
  const sha = ref.object.sha;
  const raw = await gh(`${SITE}/contents/data/shop.json?ref=${sha}`, {raw: true});
  S = normalizeShop(JSON.parse(raw)); baseSha = sha; loadedImgs = imgPaths(S);
  if (!Array.isArray(S.pay.accounts)) { const p = S.pay;
    S.pay = {accounts: [{method: "JazzCash", title: p.jazzName || "", number: p.jazz || ""}, {method: "Easypaisa", title: p.easyName || "", number: p.easy || ""},
      {method: "MCB Bank", title: "", number: ""}, {method: "Meezan Bank", title: "", number: ""}]};
    if (p.iban) S.pay.accounts.push({method: PAY_METHODS.includes(p.bank) ? p.bank : "Other bank", title: p.bankName || "", number: p.iban}) }
  $("pEditor").hidden = true; editing = null; pending = null;
  setClean(); fillBinds(); renderList();
}

function markDirty() { editVer++; dirty = true; $("saveSt").textContent = "Unpublished changes"; $("saveSt").className = "st dirty"; $("saveAll").disabled = false; $("discardAll").hidden = false }
function setClean(msg) { dirty = false; $("saveSt").textContent = msg || "All changes published"; $("saveSt").className = "st"; $("saveAll").disabled = true; $("discardAll").hidden = true }
window.addEventListener("beforeunload", e => { if (dirty) { e.preventDefault(); e.returnValue = "" } });

$("saveAll").onclick = async () => {
  if (saving) return; saving = true; const ver = editVer;
  $("saveAll").disabled = true; $("discardAll").disabled = true; $("saveSt").textContent = "Publishing…"; $("saveSt").className = "st";
  try {
    const head = (await gh(`${SITE}/git/ref/heads/${BRANCH}`)).object.sha;
    if (head !== baseSha) {
      const cmp = await gh(`${SITE}/compare/${baseSha}...${head}`);
      if ((cmp.files || []).some(f => f.filename === "data/shop.json")) {
        const err = new Error("conflict"); err.conflict = true; throw err;
      }
    }
    const commit = await gh(`${SITE}/git/commits/${head}`);
    const used = imgPaths(S), tree = [];
    for (const path of used) {
      if (loadedImgs.has(path) || !PENDING_PHOTOS.has(path)) continue;
      const blob = await gh(`${SITE}/git/blobs`, {method: "POST", body: {content: PENDING_PHOTOS.get(path).split(",")[1], encoding: "base64"}});
      tree.push({path, mode: "100644", type: "blob", sha: blob.sha});
    }
    for (const path of loadedImgs) if (!used.has(path)) tree.push({path, mode: "100644", type: "blob", sha: null});
    tree.push({path: "data/shop.json", mode: "100644", type: "blob", content: JSON.stringify(S, null, 1) + "\n"});
    const t = await gh(`${SITE}/git/trees`, {method: "POST", body: {base_tree: commit.tree.sha, tree}});
    const c = await gh(`${SITE}/git/commits`, {method: "POST", body: {message: "Update shop content", tree: t.sha, parents: [head]}});
    await gh(`${SITE}/git/refs/heads/${BRANCH}`, {method: "PATCH", body: {sha: c.sha}});
    baseSha = c.sha; loadedImgs = used;
    if (editVer === ver) setClean("Published. The website updates in about a minute."); else markDirty();
    toast("Published");
  } catch (e) {
    $("saveAll").disabled = false; $("saveSt").className = "st dirty";
    $("saveSt").textContent = e.conflict ? "The website was changed from another device. Select Discard to load the latest version, then make your changes again." : "Not published. " + errText(e);
  } finally { saving = false; $("discardAll").disabled = false }
};
$("discardAll").onclick = async () => {
  if (!confirm("Discard all unpublished changes and load the live version?")) return;
  try { await loadContent(); toast("Changes discarded") } catch (e) { toast(errText(e)) }
};

/* photos: resized in the browser, kept as pending until the next publish */
async function shrink(file, max) {
  try { const bmp = await createImageBitmap(file); const s = Math.min(1, max / Math.max(bmp.width, bmp.height));
    const c = document.createElement("canvas"); c.width = Math.round(bmp.width * s); c.height = Math.round(bmp.height * s);
    c.getContext("2d").drawImage(bmp, 0, 0, c.width, c.height);
    return await new Promise(r => c.toBlob(b => r(b || file), "image/jpeg", .85)) } catch (e) { return file }
}
const toDataURL = b => new Promise((res, rej) => { const r = new FileReader(); r.onload = () => res(r.result); r.onerror = rej; r.readAsDataURL(b) });
async function storePhoto(file, max, name) {
  const blob = await shrink(file, max);
  const ext = {"image/jpeg": "jpg", "image/png": "png", "image/webp": "webp"}[blob.type];
  if (!ext) throw new Error("type");
  const path = `images/${name}-${Date.now().toString(36)}${Math.random().toString(36).slice(2, 5)}.${ext}`;
  PENDING_PHOTOS.set(path, await toDataURL(blob));
  return path;
}
const PHOTO_ERR = "Could not use this photo. Please choose a JPG or PNG photo.";

$("b-po").innerHTML = `<option value="">Whole shop</option>` + OCCS.map(([k, l]) => `<option value="${k}">${l}</option>`).join("");
$("pCat").innerHTML = CATS.map(([k, l]) => `<option value="${k}">${l}</option>`).join("");
$("pOcc").innerHTML = OCCS.map(([k, l]) => `<label class="toggle" for="po_${k}"><input type="checkbox" id="po_${k}" value="${k}"> ${l}</label>`).join("");

function warns() {
  const r = S.reg || {}; $("regWarn").hidden = !!(r.business || r.regNo || r.ntn);
  $("payWarn").hidden = !(+S.shop.advancePct) || payAccounts(S).length > 0;
  $("exampleNote").hidden = !S.products.some(p => p.sample || (!p.photo && p.art));
  $("shopName").textContent = S.shop.name || "Shop";
}
$("areasBox").addEventListener("input", () => { S.shop.areas = [...new Set($("areasBox").value.split("\n").map(a => a.trim()).filter(Boolean))]; changed() });
function fillBinds() { $("areasBox").value = shopAreas(S).join("\n"); M.querySelectorAll("[data-b]").forEach(el => { const v = getPath(S, el.dataset.b); if (el.type === "checkbox") el.checked = !!v; else el.value = v == null ? "" : v }); fillThumbs(); renderSlideEd(); renderLists(); renderGalEd(); warns() }
function fillThumbs() { M.querySelectorAll("[data-thumb]").forEach(el => { const v = getPath(S, el.dataset.thumb); el.innerHTML = v ? `<img src="${esc(photoSrc(v))}" alt="">` : "—" }) }
function changed() { warns(); markDirty() }
M.addEventListener("input", e => {
  const el = e.target;
  if (el.dataset.b) { const v = el.type === "checkbox" ? el.checked : el.hasAttribute("data-n") ? Math.max(0, +el.value || 0) : el.value; setPath(S, el.dataset.b, v); changed(); return }
  if (el.dataset.qp != null) { const p = S.products[+el.dataset.qp]; if (!p) return; p.price = Math.max(0, Math.round(+el.value || 0)); if (p.was && p.was <= p.price) p.was = 0; changed(); return }
  if (el.dataset.li) { const [path, i, k, isNum] = el.dataset.li.split("|"); getPath(S, path)[+i][k] = isNum ? Math.max(0, +el.value || 0) : el.value; changed() }
});
M.addEventListener("change", async e => {
  const el = e.target;
  if (el.dataset.qph != null && el.files[0]) { const p = S.products[+el.dataset.qph]; toast("Preparing photo…");
    try { p.photo = await storePhoto(el.files[0], 1200, "products/" + p.id); delete p.art; delete p.sample; renderList(); changed(); toast("Photo updated. Publish to make it live.") } catch (err) { toast(PHOTO_ERR) } el.value = ""; return }
  if (el.dataset.ph && el.files[0]) { toast("Preparing photo…");
    try { setPath(S, el.dataset.ph, await storePhoto(el.files[0], 1400, "site/" + el.dataset.ph.replace(/\./g, "-"))); fillThumbs(); changed(); toast("Photo added. Publish to make it live.") } catch (err) { toast(PHOTO_ERR) } el.value = "" }
});
M.addEventListener("click", e => {
  const rm = e.target.closest("[data-phrm]"), la = e.target.closest("[data-ladd]"), ld = e.target.closest("[data-ldel]"), gd = e.target.closest("[data-gdel]");
  if (rm) { setPath(S, rm.dataset.phrm, ""); fillThumbs(); changed() }
  if (la) { let arr = getPath(S, la.dataset.ladd); if (!arr) { setPath(S, la.dataset.ladd, []); arr = getPath(S, la.dataset.ladd) } arr.push(la.dataset.ladd === "pay.accounts" ? {method: "Other bank"} : {}); renderLists(); changed() }
  if (ld) { const [path, i] = ld.dataset.ldel.split("|"); getPath(S, path).splice(+i, 1); renderLists(); changed() }
  if (gd) { S.gallery.splice(+gd.dataset.gdel, 1); renderGalEd(); changed() }
});

function renderSlideEd() {
  while (S.slides.length < 3) S.slides.push({});
  $("slideEd").innerHTML = S.slides.slice(0, 3).map((s, i) => `<div style="display:flex;flex-direction:column;gap:8px;${i ? "border-top:1px solid var(--line);padding-top:14px" : ""}">
    <b>Slide ${i + 1}</b>
    <div class="two"><label class="fld" for="sl${i}k">Kicker line<input id="sl${i}k" data-b="slides.${i}.kicker" maxlength="40"></label><label class="fld" for="sl${i}t">Heading<input id="sl${i}t" data-b="slides.${i}.title" maxlength="60"></label></div>
    <label class="fld" for="sl${i}x">Text<input id="sl${i}x" data-b="slides.${i}.text" maxlength="140"></label>
    <div class="two"><label class="fld" for="sl${i}b">Button<input id="sl${i}b" data-b="slides.${i}.btn" maxlength="24"></label>
      <label class="fld" for="sl${i}c">Button links to<select id="sl${i}c" data-b="slides.${i}.cat"><option value="all">Whole shop</option>${CATS.map(([k, l]) => `<option value="${k}">${l}</option>`).join("")}</select></label></div>
    <div class="phrow"><span class="thumb" data-thumb="slides.${i}.photo"></span><label class="sm">Change photo<input type="file" accept="image/*" data-ph="slides.${i}.photo"></label><button class="sm red" type="button" data-phrm="slides.${i}.photo">Remove</button></div>
  </div>`).join("");
  $("slideEd").querySelectorAll("[data-b]").forEach(el => { const v = getPath(S, el.dataset.b); el.value = v == null ? (el.tagName === "SELECT" ? "all" : "") : v });
  fillThumbs();
}
const LISTS = {reviews: [["name", "Name"], ["city", "City"], ["text", "Review"]], addons: [["name", "Add-on name"], ["price", "Price (Rs, 0 = free)", "n"]],
  "pay.accounts": [["method", "Bank / wallet", "s"], ["title", "Account title"], ["number", "Account number / IBAN"]]};
function renderLists() {
  M.querySelectorAll("[data-list]").forEach(box => { const path = box.dataset.list, arr = getPath(S, path) || [], fs = LISTS[path];
    box.innerHTML = arr.length ? arr.map((it, i) => `<div class="lrow" style="--n:${fs.length}">${fs.map(([k, l, t]) => { const id = `li_${path.replace(/\./g, "_")}_${i}_${k}`, li = `${path}|${i}|${k}|${t === "n" ? 1 : ""}`;
      return `<label class="fld" for="${id}">${l}${t === "s" ? `<select id="${id}" data-li="${li}">${PAY_METHODS.map(m => `<option${m === it[k] ? " selected" : ""}>${esc(m)}</option>`).join("")}</select>` : `<input id="${id}" ${t === "n" ? 'type="number" min="0" step="10"' : ""} data-li="${li}" value="${esc(it[k] ?? "")}">`}</label>` }).join("")}<button class="sm red" type="button" data-ldel="${path}|${i}" aria-label="Remove">×</button></div>`).join("")
      : `<p class="hint">Nothing added yet.</p>` });
}
function renderGalEd() {
  $("galEd").innerHTML = (S.gallery || []).map((ph, i) => `<div><img src="${esc(photoSrc(ph))}" alt=""><button type="button" data-gdel="${i}" aria-label="Remove">×</button></div>`).join("") || `<p class="hint">No photos yet.</p>`;
}
$("galAdd").addEventListener("change", async e => {
  const fs = [...e.target.files]; if (!fs.length) return; toast("Preparing " + fs.length + " photo" + (fs.length > 1 ? "s" : "") + "…");
  let bad = 0; for (const f of fs) { try { S.gallery.push(await storePhoto(f, 1000, "gallery/photo")) } catch (err) { bad++ } }
  e.target.value = ""; renderGalEd(); changed(); toast(bad ? bad + " photo(s) could not be used. Use JPG or PNG." : "Photos added. Publish to make them live.");
});

/* products */
function renderList() {
  $("pCount").textContent = S.products.length;
  $("pList").innerHTML = S.products.length ? S.products.map((p, i) => `<div class="prow"><div class="mini">${visual(p, "")}</div>
    <div style="min-width:0"><div class="nm">${esc(p.name)}</div><div class="sub">${rs(p.price)}${p.was > p.price ? " (sale)" : ""} · ${esc(CATN[p.cat] || "")}${p.best ? " · Bestseller" : ""}${p.soldOut ? " · <b>Sold out</b>" : ""}${p.photo ? (p.sample ? ` · <span class="sample-flag">sample photo</span>` : "") : " · no photo"}</div></div>
    <div class="acts"><input class="qp" type="number" min="0" step="10" inputmode="numeric" data-qp="${i}" value="${p.price}" aria-label="Price for ${esc(p.name)}"><label class="sm">Photo<input type="file" accept="image/*" data-qph="${i}"></label><button class="sm" type="button" data-up="${i}" ${i === 0 ? "disabled" : ""} aria-label="Move up">↑</button><button class="sm" type="button" data-ed="${i}">Edit</button><button class="sm red" type="button" data-del="${i}">Delete</button></div></div>`).join("")
    : `<p class="hint">No products yet. Select "+ New product".</p>`;
}
$("pList").addEventListener("click", e => {
  const b = e.target.closest("button"); if (!b) return;
  if (b.dataset.ed != null) openEditor(+b.dataset.ed);
  else if (b.dataset.up != null) { const i = +b.dataset.up; [S.products[i - 1], S.products[i]] = [S.products[i], S.products[i - 1]]; afterP() }
  else if (b.dataset.del != null) { if (b.dataset.sure !== "1") { b.dataset.sure = "1"; b.textContent = "Confirm?"; return }
    S.products.splice(+b.dataset.del, 1); $("pEditor").hidden = true; editing = null; afterP(); toast("Product deleted. Publish to make it live.") }
});
function afterP() { renderList(); changed() }
function setDrop(src) { $("pDrop").querySelector("img")?.remove(); $("pDropTxt").hidden = !!src;
  if (src) { const im = document.createElement("img"); im.src = src; im.alt = ""; $("pDrop").appendChild(im) } }
function openEditor(i) {
  editing = i; pending = null; const p = i == null ? {cat: "bouquet", occ: []} : S.products[i];
  editId = i == null ? "p" + Date.now().toString(36) : p.id;
  $("pEdTitle").textContent = i == null ? "New product" : "Edit product";
  $("pName").value = p.name || ""; $("pPrice").value = p.price ?? ""; $("pWas").value = p.was || ""; $("pCat").value = p.cat || "bouquet";
  $("pSpec").value = p.spec || ""; $("pDesc").value = p.desc || ""; $("pBest").checked = !!p.best; $("pIsNew").checked = !!p.isNew; $("pOut").checked = !!p.soldOut;
  $("pOcc").querySelectorAll("input").forEach(c => c.checked = (p.occ || []).includes(c.value)); $("pMsg").textContent = "";
  setDrop(p.photo ? photoSrc(p.photo) : "");
  $("pEditor").hidden = false; $("pEditor").scrollIntoView({behavior: "smooth", block: "start"}); $("pName").focus({preventScroll: true});
}
$("pNewBtn").onclick = () => openEditor(null);
$("pCancel").onclick = () => { $("pEditor").hidden = true; editing = null; pending = null };
$("pPhoto").addEventListener("change", async e => {
  const f = e.target.files[0]; if (!f) return;
  $("pMsg").textContent = ""; $("pSave").disabled = true; $("pSave").textContent = "Preparing photo…";
  setDrop(URL.createObjectURL(f));
  try { pending = await storePhoto(f, 1200, "products/" + editId) } catch (err) { $("pMsg").textContent = PHOTO_ERR; pending = null; setDrop("") }
  $("pSave").disabled = false; $("pSave").textContent = "✓ Save product"; e.target.value = "";
});
$("pSave").onclick = () => {
  const name = $("pName").value.trim(), price = Math.round(+$("pPrice").value), was = Math.round(+$("pWas").value) || 0;
  if (!name) { $("pMsg").textContent = "Enter a product name."; return }
  if (!(price > 0)) { $("pMsg").textContent = "Enter a price as a number, for example 1450."; return }
  if (was && was <= price) { $("pMsg").textContent = "The original price must be higher than the current price, or left blank."; return }
  const base = editing == null ? {id: editId, added: Date.now()} : S.products[editing];
  const p = {...base, name, price, was: was || 0, cat: $("pCat").value, spec: $("pSpec").value.trim(), desc: $("pDesc").value.trim(),
    best: $("pBest").checked, isNew: $("pIsNew").checked, soldOut: $("pOut").checked, occ: [...$("pOcc").querySelectorAll("input:checked")].map(c => c.value)};
  if (pending) { p.photo = pending; delete p.art; delete p.sample }
  if (editing == null) S.products.unshift(p); else S.products[editing] = p;
  $("pEditor").hidden = true; editing = null; pending = null; afterP(); toast("Product saved. Publish to make it live.");
};

/* ---------- start ---------- */
(async () => {
  initGoogle();
  const ret = takeAuthReturn();
  if (ret && ret.error) { showSignin(ret.error, "github"); return }
  if (ret && ret.token) { dropSession(); keepToken(ret.token, true, ret.expiresAt) }
  SESSION = loadSession();
  if (SESSION) {
    try { MODE = "app"; await refreshAppToken(); await signIn(TOKEN, "app"); return }
    catch (e) { if (e.status === 401) dropSession(); SESSION = ""; showSignin(e.status === 401 ? "Your sign-in has expired. Please sign in again." : errText(e)); return }
  }
  const t = storedToken();
  if (!t) { showSignin(); return }
  try { await signIn(t) }
  catch (e) { if (e.status === 401 || e.notAdmin) dropToken(); showSignin(signInError(e), "github") }
})();
