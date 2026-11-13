/* Super admin. Signs in with Google + an authenticator code (or GitHub), then:
   - orders and the customers' payment screenshots are kept in a separate private repository (orders.json and
     proofs/), so customer details never go public; new orders play a chime while this page is open;
   - content (products, homepage, business, payments) is edited here and published as one commit to the
     website repository: data/shop.json plus any new photos under images/. */
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
async function ghOnce(path, {method = "GET", body, raw, blob} = {}) {
  let r;
  try {
    r = await fetch("https://api.github.com" + path, {method, cache: "no-store",
      headers: {Authorization: "Bearer " + TOKEN, Accept: raw || blob ? "application/vnd.github.raw+json" : "application/vnd.github+json", ...(body ? {"Content-Type": "application/json"} : {})},
      body: body ? JSON.stringify(body) : undefined});
  } catch (e) { throw new GHError(0, "No internet connection. Check your connection and try again.") }
  if (!r.ok) { let m = ""; try { m = (await r.json()).message || "" } catch (e) {} throw new GHError(r.status, m) }
  if (r.status === 204) return null;
  return blob ? r.arrayBuffer() : raw ? r.text() : r.json();
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
    ME = me.login;
  }
  await gh(SITE);
  try { await gh(ORD); ORDERS_OK = true } catch (e) { ORDERS_OK = false }
  await loadContent();
  $("booting").hidden = true; $("signin").hidden = true; $("app").hidden = false; renderMe(); renderBell();
  const h = location.hash.slice(1); selectTab(TABS.includes(h) ? h : "orders");
  loadOrders().finally(poll);
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
  TOKEN = d.token; TOKEN_EXP = d.token_exp; if (d.email) ME = d.email; return d;
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
/* After Google, the sign-in service says what comes next: the usual 6-digit code, or, for someone signing in for the
   first time, setting up their authenticator app with a QR code. */
async function onGoogle(resp) {
  gCred = resp && resp.credential; let email = "";
  try { email = JSON.parse(atob(gCred.split(".")[1].replace(/-/g, "+").replace(/_/g, "/"))).email || "" } catch (e) {}
  $("gMsg").textContent = "Checking your account…";
  let d;
  try { d = await authPost("/login", {id_token: gCred}) }
  catch (err) { gCred = null; $("gMsg").textContent = LOGIN_ERR[err.code] || signInError(err); return }
  $("gMsg").textContent = "";
  $("setupBox").hidden = !d.setup;
  $("otpHint").innerHTML = d.setup ? `Then type the 6-digit code the app shows for <b>Giftoria Atelier</b> to finish.`
    : `Signed in as <b>${esc(email || "your Google account")}</b>. Enter the 6-digit code from your authenticator app.`;
  if (d.setup) { $("setupKey").textContent = String(d.secret || "").replace(/(.{4})/g, "$1 ").trim(); drawQr(d.otpauth) }
  $("gStep1").hidden = true; $("gStep2").hidden = false; $("otp").value = ""; $("otp").focus();
}
/* The QR code is drawn in the browser by a small library from cdnjs (checked against its published hash). */
const QR_SRC = "https://cdnjs.cloudflare.com/ajax/libs/qrcode-generator/1.4.4/qrcode.min.js", QR_SRI = "sha384-mZT2gIty7ZDdOGkxfP6joZcYdMW1Jvj9dRlfpTmaJAKKXTqzygtB22k7FLe+KZC1";
let qrLib = null;
function loadQrLib() {
  return qrLib || (qrLib = new Promise((res, rej) => {
    if (window.qrcode) return res(window.qrcode);
    const sc = document.createElement("script"); sc.src = QR_SRC; sc.integrity = QR_SRI; sc.crossOrigin = "anonymous";
    sc.onload = () => window.qrcode ? res(window.qrcode) : rej(new Error("qr")); sc.onerror = () => { qrLib = null; rej(new Error("qr")) };
    document.head.appendChild(sc);
  }));
}
async function drawQr(text) {
  const box = $("setupQr"); box.innerHTML = `<span class="hint">Loading the QR code…</span>`;
  try { const qr = (await loadQrLib())(0, "M"); qr.addData(text); qr.make(); box.innerHTML = qr.createSvgTag(5, 2) }
  catch (e) { box.innerHTML = `<span class="hint">The QR code could not load. Use the setup key below instead.</span>` }
}
$("gRestart").onclick = () => { gCred = null; $("gStep2").hidden = true; $("gStep1").hidden = false; $("setupBox").hidden = true; $("gMsg").textContent = ""; try { google.accounts.id.disableAutoSelect() } catch (e) {} };
$("otp").addEventListener("input", () => { $("otp").value = $("otp").value.replace(/\D/g, "").slice(0, 6) });
const LOGIN_ERR = {
  bad_code: "That code is not correct. Use the newest code in your authenticator app and check that your phone's time is set automatically.",
  google_invalid: "Your Google sign-in has expired. Select \"Use a different Google account\" and sign in again.",
  not_allowed: "This Google account is not allowed to manage this shop.",
  too_many: "Too many wrong codes. Please wait 15 minutes and try again.",
  invite_expired: "Your invitation has expired. Ask the shop owner to choose Invite again on the Access page.",
  busy: "Please try again in a moment."
};
$("gStep2").addEventListener("submit", async e => {
  e.preventDefault();
  const code = $("otp").value.replace(/\D/g, "");
  if (code.length !== 6) { $("gMsg").textContent = "Enter the 6-digit code from your authenticator app."; return }
  $("otpBtn").disabled = true; $("otpBtn").textContent = "Checking…"; $("gMsg").textContent = "";
  try {
    const d = await authPost("/login", {id_token: gCred, code, remember: $("trust").checked});
    SESSION = d.session; keepSession(d.session, d.session_exp, $("trust").checked); TOKEN_EXP = d.token_exp; ME = d.email || ME; dropToken();
    await signIn(d.token, "app");
  } catch (err) {
    $("gMsg").textContent = LOGIN_ERR[err.code] || signInError(err);
    if (["google_invalid", "not_allowed", "invite_expired"].includes(err.code)) { gCred = null; $("gStep2").hidden = true; $("gStep1").hidden = false; $("setupBox").hidden = true }
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
function signOutNow(force) {
  if (force !== true && dirty && !confirm("You have unpublished changes. Sign out and discard them?")) return;
  dirty = false; dropToken(); dropSession(); try { google.accounts.id.disableAutoSelect() } catch (e) {}
  history.replaceState(null, "", location.pathname); location.reload();
}
$("signOut").onclick = signOutNow; $("signOut2").onclick = signOutNow;

/* ---------- sections ---------- */
const TABS = ["orders", "products", "home", "business", "pay", "access"];
const PAGES = {
  orders: ["Orders", "Website orders arrive here on their own, with the customer's payment screenshot."],
  products: ["Products", "What customers can order: photos, prices, categories and stock."],
  home: ["Homepage", "Announcement, slides, promo banner, photos, reviews and your story."],
  business: ["Business info", "Shop details, delivery areas, contact numbers and policies."],
  pay: ["Payments & delivery", "The advance, the accounts customers pay into, and cart add-ons."],
  access: ["Access", "Who can sign in to this admin, and how to hand the shop to someone else."]
};
function selectTab(t) {
  document.querySelectorAll(".tab").forEach(x => x.setAttribute("aria-selected", x.dataset.tab === t));
  TABS.forEach(k => $("tab-" + k).hidden = k !== t);
  $("saveBar").hidden = t === "orders" || t === "access";
  const short = document.querySelector(`.tab[data-tab="${t}"] .t`).textContent;
  $("pageTitle").innerHTML = `<span class="tl">${esc(PAGES[t][0])}</span><span class="ts">${esc(short)}</span>`; $("pageSub").textContent = PAGES[t][1];
  closePops(); history.replaceState(null, "", "#" + t); scrollTo(0, 0);
  if (t === "access") loadAccessList();
}
document.addEventListener("click", e => { const g = e.target.closest("[data-goto]"); if (g && TABS.includes(g.dataset.goto)) selectTab(g.dataset.goto) });
document.querySelectorAll(".tab").forEach(b => b.onclick = () => selectTab(b.dataset.tab));

/* ---------- menus, dialogs, signed-in account ---------- */
function closePops() { [["alertPop", "bellBtn"], ["morePop", "moreBtn"]].forEach(([p, b]) => { $(p).hidden = true; $(b).setAttribute("aria-expanded", "false") }) }
function togglePop(p, b) { const open = $(p).hidden; closePops(); if (open) { $(p).hidden = false; $(b).setAttribute("aria-expanded", "true") } return open }
$("bellBtn").onclick = e => { e.stopPropagation(); if (togglePop("alertPop", "bellBtn")) renderBell() };
$("moreBtn").onclick = e => { e.stopPropagation(); togglePop("morePop", "moreBtn") };
document.addEventListener("click", e => { if (!e.target.closest(".popwrap")) closePops() });
let modal = null;
function openModal(id) { closeModal(); closePops(); modal = $(id); $("scrim").hidden = false; modal.hidden = false; const c = modal.querySelector("[data-mclose]"); if (c) c.focus() }
function closeModal() { if (modal) modal.hidden = true; modal = null; $("scrim").hidden = true }
$("scrim").onclick = closeModal;
document.querySelectorAll("[data-mclose]").forEach(b => b.onclick = closeModal);
document.addEventListener("keydown", e => { if (e.key === "Escape") { closeModal(); closePops() } });
let ME = "";
function renderMe() { const m = ME || "Owner"; $("meMail").textContent = m; $("meMail2").textContent = "Signed in as " + m; $("meAv").textContent = (m.replace(/[^A-Za-z]/g, "")[0] || "G").toUpperCase() }

/* ---------- new order alerts ----------
   Orders are checked every 20 seconds (every minute while the tab is in the background). An order this device has
   not seen yet plays a two-note chime, shows a banner and puts the count in the tab title; when the page is not in
   front, a desktop notification can show too. Browsers allow sound only after the first tap on the page, so the
   bell shows a dot until then. */
const BASE_TITLE = document.title, SOUND_KEY = "ga-alert-sound", SEEN_KEY = "ga-seen-orders", POLL_MS = 20e3;
const SVG_BELL = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M6 16v-5a6 6 0 0 1 12 0v5l1.5 2h-15z"/><path d="M10 20a2 2 0 0 0 4 0"/></svg>';
const AC = window.AudioContext || window.webkitAudioContext, ALERTED = new Set();
let soundOn = store(SOUND_KEY) !== "off", actx = null, SEEN = null, pollT = null;
function audio() { if (!actx && AC) { try { actx = new AC() } catch (e) { actx = null } } return actx }
const audioBlocked = () => soundOn && !!AC && (!actx || actx.state !== "running");
function unlockAudio() { if (!soundOn || (actx && actx.state === "running")) return; const a = audio(); if (a) a.resume().then(() => { renderBell(); renderAlert() }, () => {}) }
["pointerdown", "keydown", "touchend"].forEach(ev => document.addEventListener(ev, unlockAudio, {capture: true, passive: true}));
/* A soft two-note bell, played twice (about two seconds). */
function chime(force) {
  if (!soundOn && !force) return false;
  const a = audio(); if (!a || a.state !== "running") return false;
  const t0 = a.currentTime + .04, out = a.createGain(); out.gain.value = .6; out.connect(a.destination);
  [[0, 880], [.14, 1318.5], [.66, 880], [.8, 1318.5]].forEach(([d, f]) => [[1, .42, 1.1], [2, .1, .5], [3, .04, .3]].forEach(([h, v, len]) => {
    const o = a.createOscillator(), g = a.createGain(), st = t0 + d;
    o.type = "sine"; o.frequency.value = f * h;
    g.gain.setValueAtTime(.0001, st); g.gain.exponentialRampToValueAtTime(v, st + .015); g.gain.exponentialRampToValueAtTime(.0001, st + len);
    o.connect(g); g.connect(out); o.start(st); o.stop(st + len + .05);
  }));
  return true;
}
/* Phones vibrate too, once the page has been tapped (browsers block it before that). */
function buzz() { try { if (navigator.vibrate && navigator.userActivation && navigator.userActivation.hasBeenActive) navigator.vibrate([180, 90, 180]) } catch (e) {} }
function notifyDesktop(list) {
  if (!("Notification" in window) || Notification.permission !== "granted" || (!document.hidden && document.hasFocus())) return;
  const o = list[0], title = list.length > 1 ? `${list.length} new orders` : `New order ${o.no}`;
  const body = list.length > 1 ? list.slice(0, 4).map(x => `${x.no} · ${x.name || "Customer"} · ${rs(x.tot)}`).join("\n") : `${o.name || "Customer"} · ${rs(o.tot)}${o.needTxt ? " · needed by " + o.needTxt : ""}`;
  try { const n = new Notification(title, {body, icon: "../assets/icon.svg", tag: "ga-new-orders"}); n.onclick = () => { window.focus(); n.close(); viewNew() } } catch (e) {}
}
function loadSeen() { try { const a = JSON.parse(localStorage.getItem(SEEN_KEY) || "null"); return Array.isArray(a) ? new Set(a) : null } catch (e) { return null } }
function saveSeen() { try { localStorage.setItem(SEEN_KEY, JSON.stringify([...SEEN].slice(-800))) } catch (e) {} }
const unseen = () => SEEN ? ORDERS.filter(o => !SEEN.has(o.no) && ACTIVE.includes(o.status)) : [];
function markSeen(nos) {
  if (!SEEN) return; let ch = false;
  nos.forEach(n => { if (n && !SEEN.has(n)) { SEEN.add(n); ch = true } });
  if (!ch) return; saveSeen(); renderAlert();
  nos.forEach(n => { const c = cardEl(n); if (c) { c.classList.remove("is-new"); const t = c.querySelector(".t-new"); if (t) t.remove() } });
}
/* Called after every load: the first time on a new device, everything already there counts as seen. */
function noticeNew() {
  if (!SEEN) { SEEN = loadSeen(); if (!SEEN) { SEEN = new Set(ORDERS.map(o => o.no)); saveSeen() } }
  const fresh = unseen().filter(o => !ALERTED.has(o.no));
  fresh.forEach(o => ALERTED.add(o.no));
  renderAlert();
  if (fresh.length) { chime(); buzz(); notifyDesktop(fresh) }
}
function renderAlert() {
  const list = unseen(), n = list.length;
  document.title = (n ? `(${n}) New order${n > 1 ? "s" : ""} · ` : "") + BASE_TITLE;
  $("newAlert").hidden = !n; if (!n) return;
  const o = list[0];
  $("newAlert").innerHTML = `<span class="na-ic">${SVG_BELL}</span>
    <div class="na-t"><b>${n > 1 ? n + " new orders" : "New order " + esc(o.no)}</b>
      <span>${n > 1 ? list.slice(0, 3).map(x => esc(x.no) + " · " + esc(x.name || "Customer")).join("<br>") + (n > 3 ? "<br>…" : "") : `${esc(o.name || "Customer")} · ${rs(o.tot)}${(o.proofs || []).length ? " · payment screenshot attached" : ""}`}</span>
      ${audioBlocked() ? `<span class="na-snd">Tap anywhere on the page once to allow the alert sound.</span>` : ""}</div>
    <div class="na-a"><button class="btn em md" type="button" data-na="view">View order${n > 1 ? "s" : ""}</button><button class="x" type="button" data-na="hide" aria-label="Dismiss">×</button></div>`;
}
function viewNew() {
  const list = unseen(); if (!list.length) return;
  selectTab("orders"); setFilter(list.some(o => o.status === "new") ? "new" : "open");
  const first = list[0].no; markSeen(list.map(o => o.no));
  const c = cardEl(first); if (c) { c.scrollIntoView({behavior: "smooth", block: "start"}); c.classList.add("flash"); setTimeout(() => c.classList.remove("flash"), 1700) }
}
$("newAlert").addEventListener("click", e => { const b = e.target.closest("[data-na]"); if (!b) return; if (b.dataset.na === "view") viewNew(); else markSeen(unseen().map(o => o.no)) });
function renderBell() {
  const blocked = audioBlocked();
  $("bellBtn").classList.toggle("muted", !soundOn); $("bellDot").hidden = !blocked;
  $("alertSound").checked = soundOn; $("alertSoundSt").textContent = soundOn ? "Sound on" : "Sound off";
  $("soundHint").textContent = !soundOn ? "New orders will not make a sound." : !AC ? "This browser cannot play the alert sound." : blocked ? "Tap anywhere on this page once so the browser allows the sound." : "A chime plays when a new order arrives.";
  const np = "Notification" in window ? Notification.permission : "unsupported";
  $("alertNotif").hidden = np === "unsupported"; $("alertNotif").disabled = np !== "default";
  $("alertNotif").textContent = np === "granted" ? "Notifications are on" : np === "denied" ? "Notifications blocked" : "Turn on notifications";
}
$("alertSound").onchange = () => { soundOn = $("alertSound").checked; try { localStorage.setItem(SOUND_KEY, soundOn ? "on" : "off") } catch (e) {} if (soundOn) unlockAudio(); renderBell(); renderAlert() };
$("alertTest").onclick = () => { const a = audio(); if (!a) { toast("This browser cannot play sounds."); return } a.resume().then(() => { chime(true); renderBell(); renderAlert() }, () => toast("The browser blocked the sound. Tap the page and try again.")) };
$("alertNotif").onclick = async () => {
  try {
    const perm = await Notification.requestPermission();
    if (perm === "granted") { try { new Notification("Order alerts are on", {body: "A notification appears here when a new order arrives.", icon: "../assets/icon.svg"}) } catch (e) { toast("This browser shows alerts only inside the page. The sound still works.") } }
    else toast("Notifications are blocked. You can allow them in the browser's site settings.");
  } catch (e) {}
  renderBell();
};
function setLive(on, why) {
  $("liveSt").classList.toggle("off", !on); $("liveTxt").textContent = on ? "Live" : "Offline";
  $("liveSt").title = on ? "Checked for new orders at " + new Date().toLocaleTimeString("en-GB", {hour: "2-digit", minute: "2-digit"}) + ". It checks every 20 seconds." : (why || "Orders could not be checked");
}
function poll() { clearTimeout(pollT); pollT = setTimeout(async () => { if (TOKEN && ORDERS_OK && !ordersBusy) await loadOrders(); refreshTimes(); poll() }, document.hidden ? 60e3 : POLL_MS) }
document.addEventListener("visibilitychange", () => { if (!document.hidden && TOKEN && ORDERS_OK && !$("app").hidden) { loadOrders(); poll() } });

/* =====================================================================
   ORDERS (private repository: orders.json; payment screenshots in proofs/)
   With a 50% advance: new (payment to check) → paid (being made) → ready (photo sent, balance asked)
   → full (paid in full) → sent (rider on the way) → done. With full payment upfront: new → paid → sent → done.
   ===================================================================== */
const STATUS = {new: ["Payment to check", "s-new"], paid: ["Being made", "s-paid"], making: ["Being made", "s-paid"], ready: ["Balance due", "s-ready"],
  full: ["Ready to send", "s-full"], sent: ["Out for delivery", "s-sent"], done: ["Delivered", "s-done"], cancel: ["Cancelled", "s-cancel"]};
const ACTIVE = ["new", "paid", "making", "ready", "full", "sent"], PROG = ["paid", "making", "ready", "full"];
const FILTERS = [["open", "Active", o => ACTIVE.includes(o.status) || refundDue(o)], ["new", "To check", o => o.status === "new"], ["prog", "In progress", o => PROG.includes(o.status)],
  ["sent", "Out for delivery", o => o.status === "sent"], ["done", "Delivered", o => o.status === "done"], ["cancel", "Cancelled", o => o.status === "cancel"], ["all", "All", () => true]];
const PROOF_KIND = {advance: "Advance", balance: "Balance", full: "Payment"};
const SVG_PHONE = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M5 4h4l2 5-3 2a11 11 0 0 0 5 5l2-3 5 2v4a2 2 0 0 1-2 2A16 16 0 0 1 3 6a2 2 0 0 1 2-2"/></svg>';
const SVG_WA = '<svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><path d="M12 3a9 9 0 0 0-7.8 13.5L3 21l4.6-1.2A9 9 0 1 0 12 3z"/></svg>';
const SVG_PLUS = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" aria-hidden="true"><path d="M12 5v14M5 12h14"/></svg>';
let ORDERS = [], ordersSha = null, oFilter = "open", parsed = null, ordersBusy = false, ordersLoaded = false, renderPending = false;
const balanceDue = o => o.rest > 0 && !o.balAt;
/* What the customer has paid so far (the advance, or everything once the balance is in). Customers pay the advance
   before placing the order, so an order still waiting for the check can already have money attached. */
const paidSoFar = o => o.balAt ? (o.tot || 0) : (o.adv || 0);
const refundDue = o => o.status === "cancel" && o.refund > 0 && !o.refundAt;
const cardEl = no => $("oList").querySelector(`.ocard[data-no="${CSS.escape(no)}"]`);
const telHref = p => "tel:" + String(p || "").replace(/[^\d+]/g, "");

$("oFilter").addEventListener("click", e => { const b = e.target.closest("[data-f]"); if (b) setFilter(b.dataset.f) });
document.querySelector(".kpis").addEventListener("click", e => { const k = e.target.closest("[data-kf]"); if (k) setFilter(k.dataset.kf) });
function setFilter(k) { oFilter = k; $("oSearch").value = ""; renderOrders() }
$("oSearch").addEventListener("input", () => renderOrders());
$("oRefresh").onclick = () => loadOrders(true);
$("addOrderBtn").onclick = () => { openModal("pasteModal"); setTimeout(() => $("pasteBox").focus(), 30) };

async function fetchOrders() {
  try {
    const f = await gh(`${ORD}/contents/orders.json`);
    const text = f.content ? b64decUtf8(f.content) : b64decUtf8((await gh(`${ORD}/git/blobs/${f.sha}`)).content);
    const list = JSON.parse(text || "[]");
    return {list: Array.isArray(list) ? list : [], sha: f.sha};
  } catch (e) { if (e.status === 404) return {list: [], sha: null}; throw e }
}
const editingList = () => { const a = document.activeElement; return !!(a && $("oList").contains(a) && /^(INPUT|TEXTAREA|SELECT)$/.test(a.tagName)) };
$("oList").addEventListener("focusout", () => setTimeout(() => { if (renderPending && !editingList()) renderOrders() }, 0));
async function loadOrders(manual) {
  $("ordersOff").hidden = ORDERS_OK;
  if (!ORDERS_OK) { $("oList").innerHTML = `<div class="empty-box"><b>Orders are not connected</b>Orders cannot be saved until order storage is connected.</div>`; renderStats(); setLive(false, "Order storage is not connected"); return }
  if (!ordersLoaded) $("oList").innerHTML = `<div class="empty-box">Loading orders…</div>`;
  try {
    const r = await fetchOrders(); setLive(true);
    if (!ordersLoaded || r.sha !== ordersSha) {
      ORDERS = r.list; ordersSha = r.sha; ordersLoaded = true; noticeNew();
      if (editingList()) renderPending = true; else renderOrders();
    } else refreshTimes();
    if (manual) toast("Orders are up to date");
  } catch (e) {
    setLive(false, errText(e));
    if (!ordersLoaded) $("oList").innerHTML = `<div class="empty-box"><b>Orders could not load</b>${esc(errText(e))}</div>`;
    if (manual) toast(errText(e));
  }
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
        ORDERS = next; ordersSha = r.content.sha; noticeNew(); renderOrders(); return true;
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
  const shop = S.shop.name || "our shop", hi = o.name ? `Hello ${o.name},` : "Hello,", id = `Order ID: *${o.no}*`;
  const accts = payAccounts(S).map(a => `• ${a.k}: ${a.v}${a.who ? ` (${a.who})` : ""}`);
  const T = {
    paid: o.rest > 0
      ? [`${hi} we have received your advance of *${rs(o.adv)}*. Thank you!`, "", `*Your order is confirmed.* ${id}`, "", "We have started making your order by hand. When it is ready, we will send you a photo of it here.", `The remaining *${rs(o.rest)}* is paid after you have seen the photo, before we send it with the rider.`]
      : [`${hi} we have received your payment of *${rs(o.adv || o.tot)}*. Thank you!`, "", `*Your order is confirmed and fully paid.* ${id}`, "", "We have started making your order by hand and will message you when it is on its way."],
    ready: [`${hi} *your order is ready!* We are sending you a photo of it here.`, "", id, "", `Please pay the remaining *${rs(o.rest)}*${accts.length ? " to one of these accounts:" : "."}`, ...accts, "", "Then send the payment screenshot in this chat. We will book your inDrive rider as soon as we receive it."],
    full: [`${hi} we have received the remaining *${rs(o.rest)}*. Thank you!`, "", id, "Your order is now fully paid. We are booking your inDrive rider and will send you the details shortly."],
    sent: [`${hi} good news! *Your order is ready* and has been handed to our inDrive rider. It is on its way to you.`, "", id,
      ...(o.rider ? ["", "*Rider details*", `Name: ${o.rider.name}`, `Phone: ${o.rider.phone}`, ...(o.rider.vehicle ? [`Vehicle: ${o.rider.vehicle}`] : []), ""] : [""]),
      balanceDue(o) ? `Remaining to pay: *${rs(o.rest)}*. Please pay it to one of our accounts and send the screenshot here.` : "Your order is fully paid. Please keep the inDrive fare ready for the rider.",
      "Please keep your phone nearby so the rider can reach you.", "", "*Once you receive your order, please reply here to let us know it has reached you safely.*"],
    done: [`${hi} your order has been *delivered*. Thank you for shopping with ${shop}!`, "", id, "We would love to see a photo or hear your feedback. Reply here any time."],
    cancel: [`${hi} we are sorry, your order has been *cancelled*.`, "", id, ...(o.cancelReason ? [`Reason: ${o.cancelReason}`] : []), "",
      ...(o.refund > 0 ? [`*We will refund your payment of ${rs(o.refund)} within 24 hours* to the account you paid from. If you would like it sent to a different account, please reply with the details.`, ""] : []),
      "If you have any questions, please reply to this message."],
    refunded: [`${hi} we have refunded *${rs(o.refund)}* for your cancelled order. Please check your account.`, "", id, "", "We are sorry this order did not work out, and we would be glad to make something for you another time."]
  }[status];
  if (!T) return "";
  return [...T, "", `— ${shop}`].join("\n");
}
const statusLink = (o, st) => `https://wa.me/${intl(o.phone)}?text=${encodeURIComponent(statusText(o, st))}`;

function renderStats() {
  const now = new Date(), m = now.getMonth(), y = now.getFullYear(), sum = (l, k) => l.reduce((t, o) => t + (+o[k] || 0), 0);
  const chk = ORDERS.filter(o => o.status === "new"), prog = ORDERS.filter(o => PROG.includes(o.status)), sent = ORDERS.filter(o => o.status === "sent");
  const bal = prog.filter(balanceDue), month = ORDERS.filter(o => { const d = new Date(o.at); return o.status !== "cancel" && d.getMonth() === m && d.getFullYear() === y });
  const refunds = ORDERS.filter(refundDue), rfTxt = refunds.length ? `${refunds.length} refund${refunds.length > 1 ? "s" : ""} due` : "";
  $("kCheck").textContent = chk.length;
  $("kCheckS").textContent = chk.length ? rs(chk.reduce((t, o) => t + (o.adv || o.tot || 0), 0)) + " to confirm" + (rfTxt ? " · " + rfTxt : "") : rfTxt || "All payments checked";
  $("kpiCheck").classList.toggle("hot", chk.length + refunds.length > 0);
  $("kProg").textContent = prog.length; $("kProgS").textContent = bal.length ? rs(sum(bal, "rest")) + " balance due" : prog.length ? "No balance due" : "Nothing in progress";
  $("kSent").textContent = sent.length; $("kSentS").textContent = sent.length ? "With inDrive riders" : "None on the road";
  $("kMonth").textContent = rs(sum(month, "tot")); $("kMonthS").textContent = `${month.length} order${month.length === 1 ? "" : "s"} in ${now.toLocaleDateString("en-GB", {month: "long"})}`;
  $("navCount").textContent = chk.length + refunds.length; $("navCount").hidden = !(chk.length + refunds.length);
}
function renderFilters() {
  $("oFilter").innerHTML = FILTERS.map(([k, l, f]) => `<button type="button" data-f="${k}" aria-pressed="${k === oFilter}">${l}<span class="n">${ORDERS.filter(f).length}</span></button>`).join("");
}
function ago(t) {
  const sec = Math.max(0, (Date.now() - t) / 1000);
  if (sec < 60) return "Just now"; if (sec < 3600) return Math.floor(sec / 60) + " min ago"; if (sec < 86400) return Math.floor(sec / 3600) + " h ago";
  return new Date(t).toLocaleDateString("en-GB", {day: "numeric", month: "short"});
}
const fullTime = t => new Date(t).toLocaleString("en-GB", {day: "numeric", month: "short", year: "numeric", hour: "numeric", minute: "2-digit", hour12: true});
function refreshTimes() { $("oList").querySelectorAll("time[data-at]").forEach(el => { el.textContent = ago(+el.dataset.at) }) }
/* Needed today or tomorrow and not on its way yet. */
function isUrgent(o) {
  if (!o.need || !["new", "paid", "making", "ready", "full"].includes(o.status)) return false;
  const d = new Date(o.need + "T00:00:00"), t = new Date(); t.setHours(0, 0, 0, 0);
  return (d - t) / 864e5 <= 1;
}
function stepsHtml(o) {
  if (o.status === "cancel") return "";
  const bal = o.rest > 0, names = bal ? ["Payment", "Making", "Balance", "On the way", "Delivered"] : ["Payment", "Making", "On the way", "Delivered"];
  const at = {new: 0, paid: 1, making: 1, ready: 2, full: bal ? 3 : 2, sent: bal ? 3 : 2, done: names.length}[o.status] ?? 0;
  return `<ol class="oc-steps" aria-label="Order progress">${names.map((n, i) => `<li class="${i < at ? "done" : i === at ? "cur" : ""}">${n}</li>`).join("")}</ol>`;
}
function hintText(o) {
  switch (o.status) {
    case "new": return (o.proofs || []).length ? "Check that the money has arrived in your JazzCash, Easypaisa or bank app before approving. Screenshots can be edited."
      : o.proofLater ? "The customer will send the payment screenshot on WhatsApp. Add it here when it arrives." : "No payment screenshot yet. Ask the customer on WhatsApp, then add it here.";
    case "paid": case "making": return balanceDue(o) ? "When it is ready, send the customer a photo in WhatsApp and ask for the balance." : "When it is ready, book an inDrive rider and send the rider's details.";
    case "ready": return `Waiting for the remaining ${rs(o.rest)}. Check it in your app before confirming.`;
    case "full": return "Paid in full. Book an inDrive rider and send the rider's details.";
    case "sent": return "On the way. Mark it delivered when the customer confirms.";
    case "done": return o.deliveredAt ? "Delivered " + fullTime(o.deliveredAt) + "." : "Delivered.";
    case "cancel": return refundDue(o) ? `Send ${rs(o.refund)} back to the customer from your JazzCash, Easypaisa or bank app, then confirm it here.` : "";
    default: return "";
  }
}
const actBtn = (act, label, main) => main ? `<button class="btn em md" type="button" data-act="${act}">${label}</button>` : `<button class="sm" type="button" data-act="${act}">${label}</button>`;
function actionsHtml(o) {
  const A = [];
  if (ACTIVE.includes(o.status)) A.push(`<button class="link-btn" type="button" data-act="cancel">Cancel order</button>`);
  if (o.status === "new") A.push(actBtn("approve", `✓ Approve ${o.rest > 0 ? "advance" : "payment"}`, true));
  else if (o.status === "paid" || o.status === "making") { if (balanceDue(o)) A.push(actBtn("balance", "Balance already paid"), actBtn("ready", "Order ready · ask for balance", true)); else A.push(actBtn("rider", "Assign inDrive rider", true)) }
  else if (o.status === "ready") A.push(actBtn("remind", "Send reminder"), actBtn("balance", "✓ Balance received", true));
  else if (o.status === "full") A.push(actBtn("rider", "Assign inDrive rider", true));
  else if (o.status === "sent") A.push(actBtn("rider", "Change rider"), actBtn("delivered", "✓ Mark delivered", true));
  else if (refundDue(o)) A.push(actBtn("refunded", "✓ Refund sent", true));
  return A.join("");
}
function payHtml(o) {
  const live = o.status !== "cancel", approved = !["new", "cancel"].includes(o.status);
  const tag = (ok, wait) => !live ? "<span></span>" : ok ? `<i class="ok">Received</i>` : `<i class="wait">${wait}</i>`;
  const rows = [`<div class="pr tot"><span>Total</span><b>${rs(o.tot)}</b><span></span></div>`];
  if (o.rest > 0) rows.push(`<div class="pr"><span>Advance${o.pct ? ` (${o.pct}%)` : ""}</span><b>${rs(o.adv)}</b>${tag(approved, "To check")}</div>`,
    `<div class="pr"><span>Balance</span><b>${rs(o.rest)}</b>${tag(!!o.balAt, o.status === "ready" ? "Asked" : "Later")}</div>`);
  else rows.push(`<div class="pr"><span>${o.adv ? "Paid upfront" : "Payment"}</span><b>${rs(o.adv || o.tot)}</b>${tag(approved, "To check")}</div>`);
  if (o.refund > 0) rows.push(`<div class="pr"><span>Refund</span><b>${rs(o.refund)}</b>${o.refundAt ? `<i class="ok">Sent</i>` : `<i class="wait">Due</i>`}</div>`);
  const pics = (o.proofs || []).map(x => { const k = PROOF_KIND[x.k] || "Payment"; return `<button type="button" class="pf" data-pview="${esc(x.p)}" title="View the ${k.toLowerCase()} screenshot"><img data-proof="${esc(x.p)}" alt="${k} screenshot"><span>${k}</span></button>` }).join("");
  const kind = o.status === "new" ? (o.rest > 0 ? "advance" : "full") : "balance";
  const add = (o.status === "new" || (["paid", "making", "ready"].includes(o.status) && balanceDue(o))) ? `<label class="pf add" title="Add a payment screenshot"><input type="file" accept="image/*" data-pfadd="${kind}" aria-label="Add the ${kind} payment screenshot">${SVG_PLUS}<span>${kind === "balance" ? "Balance" : "Add"}</span></label>` : "";
  const none = !pics && o.status === "new" ? `<span class="pf-none">No screenshot yet</span>` : "";
  return rows.join("") + (pics || add ? `<div class="proofs" style="align-items:center">${pics}${add}${none}</div>` : "");
}
function orderCard(o) {
  const [lbl, cls] = refundDue(o) ? ["Refund due", "s-ready"] : STATUS[o.status] || [o.status, ""], isNew = !!SEEN && !SEEN.has(o.no) && ACTIVE.includes(o.status), urgent = isUrgent(o), r = o.rider, act = ACTIVE.includes(o.status);
  const items = (o.items || []).map(i => `<li><span>${esc(i.name)} <span class="q">× ${i.qty}</span></span><span>${rs(i.price * i.qty)}</span></li>`).join("");
  return `<article class="ocard${isNew ? " is-new" : ""}" data-no="${esc(o.no)}" data-s="${esc(o.status)}">
  <header class="oc-h"><div class="oc-id"><b class="no">${esc(o.no)}</b>${isNew ? `<span class="tag t-new">New</span>` : ""}<span class="tag">${o.source === "website" ? "Website" : "WhatsApp"}</span>${urgent ? `<span class="tag t-urgent">Urgent</span>` : ""}</div>
    <div class="oc-meta"><span class="pill ${cls}">${esc(lbl)}</span><time data-at="${+o.at || 0}" title="${esc(fullTime(o.at))}">${ago(o.at)}</time></div></header>
  ${stepsHtml(o)}
  <div class="oc-grid">
    <section class="oc-cust"><span class="lbl">Customer</span><b class="nm">${esc(o.name || "—")}</b>
      ${o.phone ? `<div class="ct"><a href="${esc(telHref(o.phone))}">${SVG_PHONE}${esc(o.phone)}</a><a class="wa" href="https://wa.me/${intl(o.phone)}" target="_blank" rel="noopener">${SVG_WA}WhatsApp</a></div>` : ""}
      ${o.addr || o.area ? `<div class="addr">${esc([o.area, o.addr].filter(Boolean).join(" · "))}</div>` : ""}
      ${o.needTxt ? `<div class="need${urgent ? " urgent" : ""}">Needed by <b>${esc(o.needTxt)}</b></div>` : ""}</section>
    <section class="oc-items"><span class="lbl">Items</span>${items ? `<ul>${items}</ul>` : `<span class="sub">No items listed</span>`}
      ${o.card ? `<p class="note">Card: ${esc(o.card)}</p>` : ""}${o.note ? `<p class="note">Note: ${esc(o.note)}</p>` : ""}</section>
    <section class="oc-pay"><span class="lbl">Payment</span>${payHtml(o)}</section>
  </div>
  ${r ? `<div class="oc-note rider-info">inDrive rider <b>${esc(r.name)}</b> · <a href="${esc(telHref(r.phone))}">${esc(r.phone)}</a>${r.vehicle ? " · " + esc(r.vehicle) : ""}</div>` : ""}
  ${o.status === "cancel" ? `<div class="oc-note cancel-info">Cancelled${o.cancelReason ? ": " + esc(o.cancelReason) : ""}${o.refund > 0 ? (o.refundAt ? ` · ${rs(o.refund)} refunded on ${esc(fullTime(o.refundAt))}` : ` · refund of ${rs(o.refund)} to send`) : ""}</div>` : ""}
  ${act || o.status === "done" || refundDue(o) ? `<footer class="oc-f"><span class="oc-hint">${esc(hintText(o))}</span><div class="oc-acts">${actionsHtml(o)}</div></footer>` : ""}
  ${act ? `<div class="oc-form" data-form="rider" hidden>
    <div class="three">
      <label class="fld">Rider name<input data-rf="name" maxlength="40" value="${esc(r ? r.name : "")}" placeholder="Ali Raza" autocomplete="off"></label>
      <label class="fld">Rider phone<input data-rf="phone" inputmode="tel" maxlength="20" value="${esc(r ? r.phone : "")}" placeholder="0300 1234567" autocomplete="off"></label>
      <label class="fld">Vehicle<input data-rf="vehicle" maxlength="40" value="${esc(r ? r.vehicle : "")}" placeholder="Suzuki Alto · LEB-1234" autocomplete="off"></label>
    </div>
    <div class="oc-fa"><button class="btn em md" type="button" data-act="rsave">Save and send on WhatsApp</button><button class="sm" type="button" data-act="close">Close</button></div>
  </div>
  <div class="oc-form cancel" data-form="cancel" hidden>
    <label class="fld">Reason for cancelling (sent to the customer)<input data-creason maxlength="160" placeholder="e.g. We cannot make it by your date" autocomplete="off"></label>
    ${o.adv > 0 ? `<label class="toggle"><input type="checkbox" data-crefund${o.status !== "new" || (o.proofs || []).length ? " checked" : ""}> Refund the ${rs(paidSoFar(o))} they paid</label>
    <p class="hint">Untick this if the money never reached your account, for example when a screenshot turns out to be fake.</p>` : ""}
    <div class="oc-fa"><button class="btn md danger" type="button" data-act="cancelgo">Cancel order and tell the customer</button><button class="sm" type="button" data-act="close">Keep order</button></div>
  </div>` : ""}
</article>`;
}
function emptyHtml(q) {
  if (q) return `<div class="empty-box"><b>No order found</b>Nothing matches “${esc(q)}”. If the customer ordered on WhatsApp only, use Add order.</div>`;
  if (!ORDERS.length) return `<div class="empty-box"><b>No orders yet</b>Orders placed on the website appear here on their own, with an alert sound.</div>`;
  return `<div class="empty-box"><b>Nothing here</b>No orders with this status.</div>`;
}
/* Re-draws the list; any rider or cancel form that is open keeps what was typed in it. */
function renderOrders() {
  renderPending = false;
  const keep = {};
  $("oList").querySelectorAll(".ocard").forEach(c => { const f = [...c.querySelectorAll("[data-form]")].find(x => !x.hidden); if (f) keep[c.dataset.no] = [f.dataset.form, [...f.querySelectorAll("input")].map(i => i.type === "checkbox" ? i.checked : i.value)] });
  renderStats(); renderFilters();
  ORDERS.sort((a, b) => (b.at || 0) - (a.at || 0));
  const q = $("oSearch").value.trim().toLowerCase(), qd = q.replace(/\D/g, ""), f = (FILTERS.find(x => x[0] === oFilter) || FILTERS[0])[2];
  const list = (q ? ORDERS : ORDERS.filter(f)).filter(o => !q || [o.no, o.name, o.phone, o.area, o.city].join(" ").toLowerCase().includes(q) || (qd.length >= 4 && String(o.phone).replace(/\D/g, "").includes(qd)));
  $("oList").innerHTML = list.length ? list.map(orderCard).join("") : emptyHtml(q);
  for (const [no, [form, vals]] of Object.entries(keep)) {
    const c = cardEl(no), el = c && c.querySelector(`[data-form="${form}"]`); if (!el) continue;
    el.hidden = false; el.querySelectorAll("input").forEach((i, n) => { if (vals[n] == null) return; if (i.type === "checkbox") i.checked = vals[n]; else i.value = vals[n] });
  }
  wireThumbs();
}
$("oList").addEventListener("click", e => {
  const card = e.target.closest(".ocard"); if (!card) return;
  const o = ORDERS.find(x => x.no === card.dataset.no); if (!o) return;
  markSeen([o.no]);
  const pv = e.target.closest("[data-pview]"); if (pv) { openProof(o, pv.dataset.pview); return }
  const b = e.target.closest("[data-act]"); if (b) doAct(b.dataset.act, o, b, card);
});
function doAct(act, o, b, card) {
  const no = o.no, form = k => card && card.querySelector(`[data-form="${k}"]`);
  if (act === "rider" || act === "cancel") {
    const f = form(act); if (!f) return; const show = f.hidden;
    card.querySelectorAll("[data-form]").forEach(x => x.hidden = true); f.hidden = !show;
    if (show) { f.querySelector("input").focus({preventScroll: true}); f.scrollIntoView({block: "nearest", behavior: "smooth"}) }
    return;
  }
  if (act === "close") { b.closest("[data-form]").hidden = true; return }
  if (act === "remind") { window.open(statusLink(o, "ready"), "_blank", "noopener"); return }
  if (act === "approve") return step(b, o, {status: "paid", approvedAt: Date.now()}, "paid", `Order ${no}: ${o.rest > 0 ? "advance" : "payment"} approved`, `${o.rest > 0 ? "Advance" : "Payment"} approved. Send the confirmation in WhatsApp.`);
  if (act === "ready") return step(b, o, {status: "ready", readyAt: Date.now()}, "ready", `Order ${no}: ready, balance requested`, "Now send the photo of the finished order in the same WhatsApp chat.");
  if (act === "balance") return step(b, o, {status: "full", balAt: Date.now()}, "full", `Order ${no}: balance received`, "Balance received. Book the inDrive rider next.");
  if (act === "delivered") return step(b, o, {status: "done", deliveredAt: Date.now()}, null, `Order ${no}: delivered`, "Marked as delivered.");
  if (act === "rsave") {
    const f = form("rider"), val = k => f.querySelector(`[data-rf="${k}"]`).value.trim(), rider = {name: val("name"), phone: val("phone"), vehicle: val("vehicle")};
    if (!rider.name || rider.phone.replace(/\D/g, "").length < 10) { toast("Enter the rider's name and a valid phone number."); return }
    return step(b, o, {rider, status: "sent", sentAt: Date.now()}, "sent", `Order ${no}: rider ${rider.name}, out for delivery`, "Rider saved. Send the details to the customer in WhatsApp.");
  }
  if (act === "cancelgo") {
    const f = form("cancel"), reason = f.querySelector("[data-creason]").value.trim(), rf = f.querySelector("[data-crefund]");
    if (!reason) { toast("Please write the reason for cancelling."); return }
    const refund = rf && rf.checked ? paidSoFar(o) : 0;
    return step(b, o, {status: "cancel", prevStatus: o.status, cancelReason: reason, cancelledAt: Date.now(), refund}, "cancel", `Order ${no}: cancelled (${reason})${refund ? ", refund " + rs(refund) + " due" : ""}`,
      refund ? "Order cancelled. Send the message in WhatsApp, then refund the money and tap Refund sent." : "Order cancelled. Send the message to the customer in WhatsApp.");
  }
  if (act === "refunded") {
    return step(b, o, {refundAt: Date.now()}, "refunded", `Order ${no}: refund of ${rs(o.refund)} sent`, "Refund recorded. Send the confirmation in WhatsApp.");
  }
}
/* Saves a status change, then opens the customer's WhatsApp chat with the matching message. The tab is opened
   straight away, inside the click, so the browser does not block it. */
async function step(b, o, patch, msgKey, commitMsg, done) {
  const win = msgKey && o.phone ? window.open("", "_blank") : null; if (b) b.disabled = true;
  if (await mutateOrders(list => list.map(x => x.no === o.no ? {...x, ...patch} : x), commitMsg)) {
    const ord = ORDERS.find(x => x.no === o.no);
    if (win && ord) win.location.href = statusLink(ord, msgKey);
    toast(done);
  } else { if (b) b.disabled = false; if (win) win.close() }
}

/* ---------- payment screenshots (private repository, proofs/) ---------- */
const PROOF_URL = new Map();
function proofUrl(path) {
  if (!PROOF_URL.has(path)) PROOF_URL.set(path, gh(`${ORD}/contents/${path.split("/").map(encodeURIComponent).join("/")}`, {blob: true})
    .then(buf => URL.createObjectURL(new Blob([buf], {type: /\.png$/i.test(path) ? "image/png" : "image/jpeg"})))
    .catch(e => { PROOF_URL.delete(path); throw e }));
  return PROOF_URL.get(path);
}
const thumbIO = "IntersectionObserver" in window ? new IntersectionObserver(es => es.forEach(en => { if (en.isIntersecting) { thumbIO.unobserve(en.target); loadThumb(en.target) } }), {rootMargin: "300px"}) : null;
function loadThumb(img) { proofUrl(img.dataset.proof).then(u => { img.src = u }).catch(() => { const b = img.closest(".pf"); if (b) b.classList.add("broken") }) }
function wireThumbs() { if (thumbIO) thumbIO.disconnect(); $("oList").querySelectorAll("img[data-proof]").forEach(img => thumbIO ? thumbIO.observe(img) : loadThumb(img)) }
function openProof(o, path) {
  const x = (o.proofs || []).find(y => y.p === path) || {}, kind = PROOF_KIND[x.k] || "Payment";
  $("lbTitle").textContent = kind + " screenshot";
  $("lbSub").textContent = `${o.no} · ${o.name || "Customer"} · ${x.k === "balance" ? "balance " + rs(o.rest) : o.rest > 0 ? "advance " + rs(o.adv) : rs(o.adv || o.tot)}`;
  const img = $("lbImg"); img.removeAttribute("src"); img.alt = "Loading the screenshot…";
  const can = o.status === "new" ? ["approve", `✓ Approve ${o.rest > 0 ? "advance" : "payment"}`] : o.status === "ready" && x.k === "balance" ? ["balance", "✓ Balance received"] : null;
  $("lbFoot").innerHTML = can ? `<p class="hint">Before you approve, check that this payment has arrived in your JazzCash, Easypaisa or bank app. A screenshot on its own is not proof.</p><button class="btn em md" type="button" data-lbact="${can[0]}" data-no="${esc(o.no)}">${can[1]}</button>` : "";
  openModal("lightbox");
  proofUrl(path).then(u => { if (!$("lightbox").hidden) { img.src = u; img.alt = kind + " screenshot" } }).catch(e => { img.alt = "The screenshot could not load. " + errText(e) });
}
$("lbFoot").addEventListener("click", e => { const b = e.target.closest("[data-lbact]"); if (!b) return; const o = ORDERS.find(x => x.no === b.dataset.no); if (!o) return; doAct(b.dataset.lbact, o, b, cardEl(o.no)); closeModal() });
/* The owner can add a screenshot the customer sent on WhatsApp (an order taken on WhatsApp, or the balance). */
$("oList").addEventListener("change", async e => {
  const inp = e.target.closest("[data-pfadd]"); if (!inp || !inp.files[0]) return;
  const no = inp.closest(".ocard").dataset.no, kind = inp.dataset.pfadd, file = inp.files[0]; inp.value = "";
  if (ordersBusy) { toast("Saving the previous change. Please wait."); return }
  toast("Uploading the screenshot…");
  try {
    const blob = await toJpeg(file, 1600, .82), path = `proofs/${no}-${kind[0]}${randId(5)}.jpg`;
    await gh(`${ORD}/contents/${path}`, {method: "PUT", body: {message: `Order ${no}: ${kind} payment screenshot`, content: await blobB64(blob)}});
    PROOF_URL.set(path, Promise.resolve(URL.createObjectURL(blob)));
    if (await mutateOrders(list => list.map(o => o.no === no ? {...o, proofs: [...(o.proofs || []), {p: path, k: kind, at: Date.now()}]} : o), `Order ${no}: ${kind} screenshot added`)) toast("Screenshot added");
  } catch (err) { toast(err && err.status != null ? errText(err) : "Could not use this file. Please choose a JPG or PNG screenshot.") }
});

/* ---------- orders that came only on WhatsApp ---------- */
/* Reads a WhatsApp order message (the format the storefront sends) back into fields. */
function parseOrder(raw) {
  const t = raw.replace(/\*/g, "").replace(/\r/g, "");
  const g = re => { const m = t.match(re); return m ? m[1].trim() : "" };
  const items = []; t.split("\n").forEach(l => { const m = l.match(/^\s*[•\-]\s*(.+?)\s+[x×]\s*(\d+)\s*(?:=|—|–|-)\s*Rs\.?\s*([\d,]+)/i); if (m) { const q = +m[2]; items.push({name: m[1].trim(), qty: q, price: Math.round(num(m[3]) / q)}) } });
  const o = {no: g(/(?:Order ID|Tracking ID|Order)\s*[—–\-:#*]*\s*\*?([A-Z]{1,4}-(?:\d{4}-\d{2,5}|\d{6}-[0-9A-Z]{4}))/i).toUpperCase(), items,
    del: num(g(/(?:^|\n)\s*Delivery:\s*Rs\.?\s*([\d,]+)/i)), tot: num(g(/(?:^|\n)\s*Total:\s*Rs\.?\s*([\d,]+)/i)), adv: num(g(/(?:Advance[^:\n]*|Paying in full now|Paid in full|Full payment):\s*Rs\.?\s*([\d,]+)/i)),
    pct: num(g(/Advance[^(\n]*\((\d{1,3})%\)/i)),
    name: g(/(?:Naam|Name):\s*(.+)/i), phone: g(/Phone:\s*(.+)/i), city: g(/City:\s*(.+)/i), addr: g(/Address:\s*(.+)/i), area: g(/Area:\s*(.+)/i),
    needTxt: g(/(?:Kab chahiye|Needed by):\s*(.+)/i), need: (() => { const m = g(/Needed by:\s*(\d{1,2} \w{3} \d{4})/i); const d = m ? new Date(m) : null; return d && !isNaN(d) ? `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}` : "" })(), card: g(/Card(?: message)?:\s*(.+)/i), note: g(/Note:\s*(.+)/i)};
  if (!o.tot && items.length) o.tot = items.reduce((sum, i) => sum + i.price * i.qty, 0) + o.del;
  if (!o.no) o.no = makeOrderNo(S.shop.name);
  o.rest = Math.max(0, o.tot - o.adv);
  if (!o.pct && o.adv) o.pct = o.rest ? Math.round(o.adv / o.tot * 100) : 100;
  return (o.name || o.phone || items.length) ? o : null;
}
$("pasteRead").onclick = () => {
  parsed = parseOrder($("pasteBox").value);
  if (!parsed) { $("pastePreview").innerHTML = `<p class="msg err" style="text-align:left">No order was found in this message. Paste the customer's full order message.</p>`; $("pasteSave").disabled = true; return }
  const dup = ORDERS.some(o => o.no === parsed.no);
  $("pastePreview").innerHTML = `<div class="preview"><b>${esc(parsed.no)}</b> · ${esc(parsed.name)} · ${esc(parsed.phone)}<br>${parsed.items.map(i => esc(i.name) + " × " + i.qty).join(", ") || "No items found"}<br>Total ${rs(parsed.tot)}${parsed.adv ? ` · ${parsed.rest ? "Advance" : "Paid"} ${rs(parsed.adv)}` : ""}${dup ? `<br><b style="color:var(--rose)">This order is already saved. Saving again will replace it.</b>` : ""}</div>`;
  $("pasteSave").disabled = !ORDERS_OK;
};
$("pasteSave").onclick = async () => {
  if (!parsed || !ORDERS_OK) return; $("pasteSave").disabled = true;
  const o = {...parsed, status: parsed.adv ? "new" : "paid", at: Date.now()};
  markSeen([o.no]);
  if (await mutateOrders(list => [o, ...list.filter(x => x.no !== o.no)], `Add order ${o.no}`)) {
    $("pasteBox").value = ""; $("pastePreview").innerHTML = ""; parsed = null; closeModal(); setFilter("open"); toast("Order " + o.no + " saved");
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
  const noTitle = [...new Set((S.pay.accounts || []).filter(a => a && a.active !== false && String(a.number || "").trim() && !String(a.title || "").trim()).map(a => a.method || "a payment method"))];
  $("titleWarn").hidden = !noTitle.length; $("titleWarnList").textContent = noTitle.join(" and ");
  $("exampleNote").hidden = !S.products.some(p => p.sample || (!p.photo && p.art));
  $("shopName").innerHTML = wordmark(S.shop.name);
}
$("areasBox").addEventListener("input", () => { S.shop.areas = [...new Set($("areasBox").value.split("\n").map(a => a.trim()).filter(Boolean))]; changed() });
function fillBinds() { $("areasBox").value = shopAreas(S).join("\n"); M.querySelectorAll("[data-b]").forEach(el => { const v = getPath(S, el.dataset.b); if (el.type === "checkbox") el.checked = !!v; else el.value = v == null ? "" : v }); fillThumbs(); renderSlideEd(); renderLists(); renderGalEd(); warns() }
function fillThumbs() { M.querySelectorAll("[data-thumb]").forEach(el => { const v = getPath(S, el.dataset.thumb); el.innerHTML = v ? `<img src="${esc(photoSrc(v))}" alt="">` : "—" }) }
function changed() { warns(); markDirty() }
M.addEventListener("input", e => {
  const el = e.target;
  if (el.dataset.b) { const v = el.type === "checkbox" ? el.checked : el.hasAttribute("data-n") ? Math.max(0, +el.value || 0) : el.value; setPath(S, el.dataset.b, v); changed(); return }
  if (el.dataset.qp != null) { const p = S.products[+el.dataset.qp]; if (!p) return; p.price = Math.max(0, Math.round(+el.value || 0)); if (p.was && p.was <= p.price) p.was = 0; changed(); return }
  if (el.dataset.li) { const [path, i, k, kind] = el.dataset.li.split("|");
    if (kind === "b") { getPath(S, path)[+i][k] = el.checked; const row = el.closest(".lrow"); row.classList.toggle("off", !el.checked); row.querySelector(".switch .st").textContent = el.checked ? "Active" : "Inactive" }
    else getPath(S, path)[+i][k] = kind === "1" ? Math.max(0, +el.value || 0) : el.value;
    changed() }
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
  if (la) { let arr = getPath(S, la.dataset.ladd); if (!arr) { setPath(S, la.dataset.ladd, []); arr = getPath(S, la.dataset.ladd) } arr.push(la.dataset.ladd === "pay.accounts" ? {method: "JazzCash", title: "", number: "", active: true} : {}); renderLists(); changed() }
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
  "pay.accounts": [["method", "Payment method", "s"], ["title", "Account title"], ["number", "Account number / IBAN"], ["active", "Status", "b"]]};
function renderLists() {
  M.querySelectorAll("[data-list]").forEach(box => { const path = box.dataset.list, arr = getPath(S, path) || [], fs = LISTS[path];
    box.innerHTML = arr.length ? arr.map((it, i) => `<div class="lrow${fs.some(f => f[2] === "b") && it.active === false ? " off" : ""}" style="--n:${fs.length}">${fs.map(([k, l, t]) => { const id = `li_${path.replace(/\./g, "_")}_${i}_${k}`, li = `${path}|${i}|${k}|${t === "n" ? 1 : t === "b" ? "b" : ""}`;
      if (t === "b") { const on = it[k] !== false; return `<div class="fld">${l}<label class="switch" for="${id}"><input type="checkbox" id="${id}" data-li="${li}"${on ? " checked" : ""}><span class="knob" aria-hidden="true"></span><span class="st">${on ? "Active" : "Inactive"}</span></label></div>` }
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

/* =====================================================================
   ACCESS: who can sign in. The list is kept by the sign-in service (auth-worker, POST /access), which signs it and
   stores each person's authenticator secret encrypted, so it can only be changed from here.
   ===================================================================== */
let ACCESS = null, accBusy = false;
const ADMIN_LINK = "https://giftoria-atelier.pages.dev/admin/";
const ACC_ERR = {bad_email: "Enter a valid Google email address, for example name@gmail.com.", exists: "This email already has access.",
  too_many_people: "Up to 10 people can have access.", last_admin: "You can't remove the last person who can sign in. Add someone else first.",
  not_found: "This person no longer has access. The list has been refreshed.", busy: "Someone changed the list at the same time. Please try again.",
  session_expired: "Your sign-in has expired. Sign out and sign in again.", mode: "Sign in with Google to change who has access."};
const fmtDay = t => new Date(t).toLocaleDateString("en-GB", {day: "numeric", month: "short", year: "numeric"});
const accessCall = (op, extra) => MODE === "app" && SESSION ? authPost("/access", {session: SESSION, op, ...extra}) : Promise.reject(Object.assign(new Error("mode"), {code: "mode"}));
async function loadAccessList() {
  const app = MODE === "app" && !!SESSION;
  $("accessOff").hidden = app; $("accAdd").hidden = !app; $("accRefresh").hidden = !app;
  if (!app) { $("accList").innerHTML = `<p class="hint">Sign in with Google to see who has access.</p>`; return }
  if (!ACCESS) $("accList").innerHTML = `<p class="hint">Loading…</p>`;
  try { ACCESS = await accessCall("list"); renderAccess() }
  catch (e) { $("accList").innerHTML = `<p class="msg err" style="text-align:left">${esc(ACC_ERR[e.code] || errText(e))}</p>` }
}
function renderAccess() {
  const A = ACCESS; if (!A) return;
  const active = A.users.filter(u => u.status === "active").length;
  $("accCount").textContent = A.users.length;
  $("accList").innerHTML = A.users.map(u => {
    const me = u.email === A.me, nm = u.name || u.email.split("@")[0];
    const pill = u.status === "active" ? `<span class="pill s-sent">Active</span>` : u.status === "expired" ? `<span class="pill s-cancel">Invitation expired</span>` : `<span class="pill s-new">Waiting for first sign-in</span>`;
    const note = u.status === "active" ? (u.activatedAt ? "Set up on " + fmtDay(u.activatedAt) : "Original owner account")
      : u.status === "expired" ? "Invited on " + fmtDay(u.added) + ". Invite again to give them another 14 days."
      : `Invited on ${fmtDay(u.added)}${u.addedBy ? " by " + u.addedBy : ""}. Expires on ${fmtDay(u.added + 14 * 864e5)}.`;
    const reset = u.status === "active" ? `<button class="sm" type="button" data-acc="reset">New authenticator</button>` : u.status === "expired" ? `<button class="sm" type="button" data-acc="reset">Invite again</button>` : "";
    const last = u.status === "active" && active <= 1;
    return `<div class="acc-row" data-email="${esc(u.email)}">
      <span class="av" aria-hidden="true">${esc((nm.replace(/[^A-Za-z]/g, "")[0] || "?").toUpperCase())}</span>
      <div class="acc-t"><b>${esc(nm)}${me ? ` <span class="tag">You</span>` : ""}</b><span class="em">${esc(u.email)}</span><span class="sub">${esc(note)}</span></div>
      ${pill}
      <div class="acc-a">${reset}<button class="sm red" type="button" data-acc="remove"${last ? ` disabled title="The last person who can sign in cannot be removed"` : ""}>Remove</button></div>
    </div>`;
  }).join("") || `<p class="hint">Nobody yet.</p>`;
}
$("accRefresh").onclick = () => { ACCESS = null; loadAccessList() };
$("accCopy").onclick = () => navigator.clipboard.writeText(ADMIN_LINK).then(() => toast("Admin link copied")).catch(() => toast("Copy this link: " + ADMIN_LINK));
$("accAdd").addEventListener("submit", async e => {
  e.preventDefault(); if (accBusy) return;
  const email = $("accEmail").value.trim(), name = $("accName").value.trim();
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(email)) { $("accMsg").textContent = ACC_ERR.bad_email; $("accEmail").focus(); return }
  accBusy = true; $("accAddBtn").disabled = true; $("accMsg").textContent = "";
  try { ACCESS = await accessCall("add", {email, name}); renderAccess(); $("accEmail").value = ""; $("accName").value = ""; toast("Access given. Now send them the admin link.") }
  catch (err) { $("accMsg").textContent = ACC_ERR[err.code] || errText(err) }
  finally { accBusy = false; $("accAddBtn").disabled = false }
});
/* Remove and New authenticator ask for a second tap before they act. */
$("accList").addEventListener("click", async e => {
  const b = e.target.closest("[data-acc]"); if (!b || b.disabled || accBusy) return;
  const email = b.closest(".acc-row").dataset.email, op = b.dataset.acc, me = !!ACCESS && email === ACCESS.me;
  if (b.dataset.sure !== "1") {
    const old = b.textContent; b.dataset.sure = "1";
    b.textContent = op === "remove" ? (me ? "Remove me? Tap again" : "Tap again to remove") : old === "Invite again" ? "Tap again to invite" : "Tap again to confirm";
    setTimeout(() => { if (b.isConnected && b.dataset.sure === "1") { b.dataset.sure = ""; b.textContent = old } }, 4000);
    return;
  }
  accBusy = true; b.disabled = true;
  try {
    ACCESS = await accessCall(op, {email}); renderAccess();
    if (me) { toast(op === "remove" ? "Your access was removed. Signing you out…" : "Signing you out. Sign in again to scan your new code."); setTimeout(() => signOutNow(true), 1600); return }
    toast(op === "remove" ? "Access removed for " + email : b.textContent.includes("invite") ? "Invitation renewed for 14 days" : "Done. They scan a new code at their next sign-in.");
  } catch (err) { toast(ACC_ERR[err.code] || errText(err)); if (err.code === "not_found") { ACCESS = null; loadAccessList() } }
  finally { accBusy = false; if (b.isConnected) b.disabled = false }
});

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
