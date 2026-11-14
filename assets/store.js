/* Storefront: customers browse, add to cart and place the order on WhatsApp. Nothing here edits the shop;
   all content comes from data/shop.json, which the super admin (admin/) publishes. */
"use strict";
/* The shop's sign-in service also receives orders and saves them privately for the super admin. */
const ORDER_API = "https://giftoria-auth.giftoria-atelier.workers.dev";
let S = normalizeShop({});
const findP = id => S.products.find(p => p.id === id);
$("logoArt").innerHTML = LOGO; $("logoArt2").innerHTML = LOGO;

/* ---------- this device's cart, wishlist and past orders ---------- */
let cart = {}, wish = [], addSel = {}, myOrders = [];
const load = (k, d) => { try { return JSON.parse(localStorage.getItem(k) || "null") || d } catch (e) { return d } };
const save = (k, v) => { try { localStorage.setItem(k, JSON.stringify(v)) } catch (e) {} };
cart = load("gd-cart", {}); wish = load("gd-wish", []); myOrders = load("gd-orders", []);
const persist = () => { save("gd-cart", cart); save("gd-wish", wish) };
const F = {cat: "all", occ: "", q: "", sort: "feat"};

/* ---------- page render ---------- */
/* AI sample photos carry a visible tag until the owner replaces them with real photos. */
const SAMPLE_TAG = `<span class="sample-tag">Sample photo</span>`;
function refPhoto(o){if(!o)return null;if(o.photo)return{src:o.photo,sample:false};const p=o.ref&&findP(o.ref);return p&&p.photo?{src:p.photo,sample:!!p.sample}:null}
const refImg=(o,alt,fallback,attrs)=>{const r=refPhoto(o);return r?`<img src="${esc(photoSrc(r.src))}" alt="${esc(alt)}"${attrs||""}>${r.sample?SAMPLE_TAG:""}`:fallback};
function card(p){
  const inW=wish.includes(p.id);
  const badge=p.soldOut?`<span class="badge out">Sold out</span>`:p.was>p.price?`<span class="badge sale">${Math.round((1-p.price/p.was)*100)}% off</span>`:p.isNew?`<span class="badge new">New</span>`:p.best?`<span class="badge best">Bestseller</span>`:"";
  return `<article class="card" data-pid="${esc(p.id)}">
    <div style="position:relative"><button class="pic" data-qv="${esc(p.id)}" aria-label="View ${esc(p.name)}">${visual(p)}</button>${badge}${p.photo&&p.sample?SAMPLE_TAG:""}
    <button class="heart" data-wish="${esc(p.id)}" aria-pressed="${inW}" aria-label="Wishlist">${inW?"♥":"♡"}</button></div>
    <div class="body"><span class="cat">${esc(CATN[p.cat]||"")}</span><h3><button class="ttl" type="button" data-qv="${esc(p.id)}">${esc(p.name)}</button></h3><span class="sub">${esc(p.spec)}</span>
      <div class="prices"><span class="price">${rs(p.price)}</span>${p.was>p.price?`<span class="was">${rs(p.was)}</span>`:""}</div></div>
    <div class="acts">${actsHtml(p)}</div>
  </article>`;
}
const actsHtml=p=>(p.soldOut?`<button class="add" disabled>Sold out</button>`:cart[p.id]?`<div class="stepper" role="group" aria-label="Quantity of ${esc(p.name)}"><button type="button" data-step-id="${esc(p.id)}" data-step-d="-1" aria-label="Remove one">−</button><span aria-live="polite">${cart[p.id]} in cart</span><button type="button" data-step-id="${esc(p.id)}" data-step-d="1" aria-label="Add one">+</button></div>`:`<button class="add" data-add="${esc(p.id)}">Add to cart</button>`)+`<button class="qv" data-qv="${esc(p.id)}">View</button>`;
/* After a tap on Add to cart, + / − or the heart, only that product's cards change. Nothing else on the page is
   redrawn, so the page and the sideways rows stay exactly where the customer is (important on iPhones). */
function refreshItem(id){
  const p=findP(id);
  if(p)document.querySelectorAll(`.card[data-pid="${CSS.escape(id)}"]`).forEach(c=>{
    const had=c.querySelector(".acts").contains(document.activeElement),wasStep=!!(document.activeElement&&document.activeElement.dataset&&document.activeElement.dataset.stepD);
    c.querySelector(".acts").innerHTML=actsHtml(p);
    const h=c.querySelector(".heart"),w=wish.includes(id);h.setAttribute("aria-pressed",String(w));h.textContent=w?"♥":"♡";
    if(had){const b=c.querySelector(wasStep?"[data-step-d=\"1\"]":"[data-step-d=\"1\"],[data-add]");if(b)b.focus({preventScroll:true})}
  });
  renderCart();renderWish();if(!$("qvModal").hidden&&qvId)openQV(qvId,true);
}
let slideI=0,slideT=null;
function renderHero(){
  const sl=S.slides.filter(s=>s&&s.title);
  if(!sl.length){$("slides").innerHTML="";$("dots").innerHTML="";return}
  slideI=Math.min(slideI,sl.length-1);
  $("slides").innerHTML=sl.map((s,i)=>`<div class="slide"${i===slideI?"":" hidden"}>
    <div>${s.kicker?`<span class="hand">${esc(s.kicker)}</span>`:""}<h1>${esc(s.title)}</h1>${s.text?`<p>${esc(s.text)}</p>`:""}
      <div style="display:flex;gap:10px;flex-wrap:wrap"><button class="btn rose" data-goshop="${esc(s.cat||"all")}" data-goocc="${esc(s.occ||"")}">${esc(s.btn||"Shop now")}</button></div></div>
    <div class="arch hero-art">${refImg(s,s.title,drawArt(s.art),i===slideI?' fetchpriority="high" decoding="async"':' loading="lazy" decoding="async"')}</div></div>`).join("");
  $("dots").innerHTML=sl.length>1?sl.map((_,i)=>`<button data-dot="${i}" aria-label="Slide ${i+1}" aria-current="${i===slideI}"></button>`).join("")+`<span class="arrows"><button class="ib" data-step="-1" aria-label="Previous slide">‹</button><button class="ib" data-step="1" aria-label="Next slide">›</button></span>`:"";
  clearInterval(slideT);
  if(sl.length>1&&!matchMedia("(prefers-reduced-motion: reduce)").matches)slideT=setInterval(()=>goSlide(slideI+1),6500);
}
function goSlide(i){const n=S.slides.filter(s=>s&&s.title).length;if(!n)return;slideI=(i+n)%n;
  document.querySelectorAll("#slides .slide").forEach((el,k)=>el.hidden=k!==slideI);
  document.querySelectorAll("#dots [data-dot]").forEach((el,k)=>el.setAttribute("aria-current",k===slideI))}
$("dots").addEventListener("click",e=>{const d=e.target.closest("[data-dot]"),s=e.target.closest("[data-step]");
  if(d)goSlide(+d.dataset.dot);if(s)goSlide(slideI+ +s.dataset.step);clearInterval(slideT)});

const OCC_ART={birthday:{kind:"bouquet",shape:"daisy",colors:["#F28AB2","#F9DD8C","#A9D6F5","#F28AB2","#F9DD8C"],wrap:"#FFF4F7"},eid:{kind:"bouquet",shape:"mix",colors:["#BFE3D0","#F9DD8C","#FFFFFF","#BFE3D0"],wrap:"#E7F2EA"},
  shaadi:{kind:"gajra",colors:["#FFFFFF","#F28AB2"]},anniversary:{kind:"bouquet",shape:"rose",colors:["#D3304F","#E0485F","#D3304F"],wrap:"#FFF4F7"},
  graduation:{kind:"bouquet",shape:"sun",colors:["#F5B823","#F7C948","#F5B823"],wrap:"#EFE3D0"},love:{kind:"box",colors:["#D3304F","#E0485F"],box:"#2B2B33"}};
/* Only categories and occasions that have products are offered to customers. */
const liveCats=()=>CATS.filter(([k])=>S.products.some(p=>p.cat===k));
const liveOccs=()=>OCCS.filter(([k])=>S.products.some(p=>(p.occ||[]).includes(k)));
function renderOccasions(){
  const used=new Set();
  $("occs").innerHTML=liveOccs().map(([k,l])=>{const n=S.products.filter(p=>(p.occ||[]).includes(k)).length;
    const cands=S.products.filter(p=>(p.occ||[]).includes(k)&&p.photo);const ph=cands.find(p=>!used.has(p.id))||cands[0];if(ph)used.add(ph.id);
    return `<button class="occ" data-goshop="all" data-goocc="${k}"><div class="arch">${ph?`<img src="${esc(photoSrc(ph.photo))}" alt="" loading="lazy">${ph.sample?SAMPLE_TAG:""}`:drawArt(OCC_ART[k])}</div><b>${l}</b><span>${n} items</span></button>`}).join("");
}
function renderShelves(){
  const best=S.products.filter(p=>p.best&&!p.soldOut);
  $("bestSec").hidden=!best.length;$("best").innerHTML=best.map(card).join("");
  const nw=S.products.slice().sort((a,b)=>(b.added||0)-(a.added||0)).slice(0,8);
  $("newSec").hidden=!nw.length;$("newest").innerHTML=nw.map(card).join("");
}
function renderPromo(){
  const p=S.promo||{};$("promoSec").hidden=!p.title;
  $("promo").innerHTML=p.title?`<div class="txt"><span class="hand" style="color:inherit;font-size:26px;opacity:.9">${esc(OCCN[p.occ]||"Featured collection")}</span><h2>${esc(p.title)}</h2>${p.text?`<p>${esc(p.text)}</p>`:""}<button class="btn" data-goshop="all" data-goocc="${esc(p.occ||"")}">${esc(p.btn||"Explore")}</button></div>
    <div class="img">${refImg(p,p.title,drawArt(OCC_ART[p.occ]||DEFAULT_ART.bouquet),' loading="lazy" decoding="async"')}</div>`:"";
}
function renderShop(){
  $("catChips").innerHTML=[["all","All"],...liveCats()].map(([k,l])=>`<button class="chip" data-cat="${k}" aria-pressed="${F.cat===k}">${l}</button>`).join("");
  $("occSel").innerHTML=`<option value="">All occasions</option>`+liveOccs().map(([k,l])=>`<option value="${k}"${F.occ===k?" selected":""}>${l}</option>`).join("");
  const q=F.q.toLowerCase();
  let list=S.products.filter(p=>(F.cat==="all"||p.cat===F.cat)&&(!F.occ||(p.occ||[]).includes(F.occ))&&(!q||(p.name+" "+(p.spec||"")+" "+(p.desc||"")+" "+(CATN[p.cat]||"")).toLowerCase().includes(q)));
  if(F.sort==="new")list.sort((a,b)=>(b.added||0)-(a.added||0));
  if(F.sort==="low")list.sort((a,b)=>a.price-b.price);
  if(F.sort==="high")list.sort((a,b)=>b.price-a.price);
  $("shopCount").textContent=list.length+" items";
  $("grid").innerHTML=list.length?list.map(card).join(""):`<div class="empty-box">No items match these filters. <button class="link" data-goshop="all" data-goocc="">View all</button></div>`;
}
$("catChips").addEventListener("click",e=>{const b=e.target.closest("[data-cat]");if(b){F.cat=b.dataset.cat;renderShop()}});
$("occSel").onchange=e=>{F.occ=e.target.value;renderShop()};
$("sortSel").onchange=e=>{F.sort=e.target.value;renderShop()};
$("q").addEventListener("input",e=>{F.q=e.target.value.trim();renderShop()});
function goShop(cat,occ){closeMega();F.cat=cat||"all";F.occ=occ||"";F.q="";$("q").value="";renderShop();show(null);$("shop").scrollIntoView({behavior:"smooth"})}

/* ---------- category menu: picture tiles, side menu and desktop dropdown ---------- */
function catInfo(){
  return CATS.map(([k,l])=>{const items=S.products.filter(p=>p.cat===k),live=items.filter(p=>!p.soldOut);
    const pick=live.find(p=>p.photo&&p.best)||live.find(p=>p.photo)||items.find(p=>p.photo)||items[0];
    return {k,l,n:items.length,from:live.length?Math.min(...live.map(p=>p.price)):0,pick}}).filter(c=>c.n);
}
const catPic=c=>c.pick?(c.pick.photo?`<img src="${esc(photoSrc(c.pick.photo))}" alt="" loading="lazy">`:drawArt(c.pick.art||DEFAULT_ART[c.k])):drawArt(DEFAULT_ART[c.k]);
const customWa=()=>"https://wa.me/"+intl(S.shop.wa)+"?text="+encodeURIComponent("Hello! I would like a custom design from "+(S.shop.name||"your shop")+".");
function renderCategories(){
  $("cats").innerHTML=catInfo().map(c=>`<button class="cattile" type="button" data-goshop="${c.k}" data-goocc="">
      <span class="ph">${catPic(c)}${c.pick&&c.pick.photo&&c.pick.sample?SAMPLE_TAG:""}</span>
      <span class="cap"><b>${esc(c.l)}</b><span>${c.n} item${c.n>1?"s":""}${c.from?" · from "+rs(c.from):""}</span></span></button>`).join("")
    +`<a class="cattile custom" href="${esc(customWa())}" target="_blank" rel="noopener"><span class="ph"><svg width="44" height="44" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M12 20s-7-4.5-7-10a4 4 0 0 1 7-2.6A4 4 0 0 1 19 10c0 5.5-7 10-7 10z"/><path d="M12 9v4M10 11h4"/></svg></span>
      <span class="cap"><b>Custom design</b><span>Your colours, your idea. Ask on WhatsApp</span></span></a>`;
}
function renderMenu(){
  const cats=catInfo();
  $("menuCats").innerHTML=cats.map(c=>`<button type="button" class="menu-cat" data-goshop="${c.k}" data-goocc=""><span class="th">${catPic(c)}</span><span class="t"><b>${esc(c.l)}</b><span>${c.n} item${c.n>1?"s":""}${c.from?" · from "+rs(c.from):""}</span></span><span class="go">›</span></button>`).join("");
  $("menuOccs").innerHTML=liveOccs().map(([k,l])=>`<button class="chip" type="button" data-goshop="all" data-goocc="${k}">${l}</button>`).join("");
  $("megaGrid").innerHTML=cats.map(c=>`<button type="button" class="mega-tile" data-goshop="${c.k}" data-goocc=""><span class="th">${catPic(c)}</span><b>${esc(c.l)}</b><span>${c.n} item${c.n>1?"s":""}</span></button>`).join("")
    +`<a class="mega-tile" href="${esc(customWa())}" target="_blank" rel="noopener"><span class="th custom">+</span><b>Custom design</b><span>Ask on WhatsApp</span></a>`;
  $("menuWa").href="https://wa.me/"+intl(S.shop.wa)+"?text="+encodeURIComponent("Hello! I have a question about "+(S.shop.name||"your shop")+".");
}
function closeMega(){$("mega").hidden=true;$("megaBtn").setAttribute("aria-expanded","false")}
$("megaBtn").onclick=e=>{e.stopPropagation();const open=$("mega").hidden;$("mega").hidden=!open;$("megaBtn").setAttribute("aria-expanded",String(open))};
document.addEventListener("click",e=>{if(!$("mega").hidden&&!e.target.closest("#mega")&&!e.target.closest("#megaBtn"))closeMega()});
$("openMenu").onclick=()=>show($("menuDrawer"));
$("menuDrawer").addEventListener("click",e=>{const m=e.target.closest("[data-menu]");if(!m)return;const k=m.dataset.menu;
  if(k==="orders")return show($("ordersDrawer"));if(k==="wish")return show($("wishDrawer"));
  show(null);$(k==="howto"?"howto":"contact").scrollIntoView({behavior:"smooth"})});

function renderRail(){$("rail").innerHTML=liveCats().map(([k,l])=>`<button data-goshop="${k}" data-goocc="">${l}</button>`).join("")+liveOccs().slice(0,3).map(([k,l])=>`<button data-goshop="all" data-goocc="${k}">${l}</button>`).join("")}
function renderGallery(){
  const g=S.gallery||[];$("gallerySec").hidden=!g.length;
  $("gallery").innerHTML=g.map(ph=>`<div><img src="${esc(photoSrc(ph))}" alt="A recent order" loading="lazy"></div>`).join("");
  const ig=safeUrl(S.social.insta);$("instaLink").hidden=!ig;if(ig)$("instaLink").href=ig;
}
function renderReviews(){
  const r=(S.reviews||[]).filter(x=>x.text);$("revSec").hidden=!r.length;
  $("reviews").innerHTML=r.map(x=>`<figure class="rev"><q>${esc(x.text)}</q><span>${esc(x.name||"Customer")}${x.city?" · "+esc(x.city):""}</span></figure>`).join("");
}
function renderStory(){
  const a=S.about||{};$("story").hidden=!a.title&&!a.text;
  $("storyTitle").textContent=a.title||"";$("storyText").textContent=a.text||"";$("storySig").textContent=a.sign||S.reg.owner||"";
  $("storyArt").innerHTML=refImg(a,S.shop.name,null,' loading="lazy" decoding="async"')||drawArt({kind:"bouquet",shape:"tulip",colors:["#F7B5CD","#F28AB2","#E86A9A","#F28AB2","#F7B5CD"],wrap:"#FFFFFF"});
}
function renderChrome(){
  const s=S.shop,pct=+s.advancePct||0;
  document.title=(s.name||"Shop")+" | Handmade flowers and gifts";
  $("announce").textContent=s.announce||"";$("announce").parentElement.hidden=!s.announce;
  $("shopName").innerHTML=wordmark(s.name);$("footName").innerHTML=wordmark(s.name);
  $("footAbout").textContent=s.footAbout||"";
  $("trustDelT").textContent="Delivery across "+(s.city||"Multan");
  {const cur=$("fArea").value||load("gd-cust",{}).fArea||"";
   $("fArea").innerHTML=`<option value="">Select your area</option>`+shopAreas(S).map(a=>`<option${a===cur?" selected":""}>${esc(a)}</option>`).join("")+`<option value="Other"${cur==="Other"?" selected":""}>Other area (write it in the address)</option>`}
  const part=pct>0&&pct<100;
  $("trustPayT").textContent=pct?(pct>=100?"Full payment upfront":pct+"% advance"):"Cash on delivery";
  $("trustPay").textContent=pct?(part?"The rest after you see your order":(payAccounts(S).map(a=>a.k).join(", ")||"JazzCash, Easypaisa, bank")):"Pay on delivery";
  $("how2t").textContent=pct?(part?`Pay ${pct}% and upload the screenshot`:"Pay and upload the screenshot"):"Place your order";
  $("how2").textContent=pct?`Enter your details, pay ${part?"the advance":"the full amount"} to one of our accounts and add the screenshot. Your order then opens in WhatsApp, ready to send.`:"Enter your details. Your order opens in WhatsApp, ready to send.";
  $("how3t").textContent=part?"See it before you pay the rest":"We confirm and make it";
  $("how3").textContent=part?`We confirm on WhatsApp, make your order by hand and send you a photo of it. Then you pay the remaining ${100-pct}%.`:"We check your payment, confirm your order on WhatsApp and make it by hand.";
  const wa="https://wa.me/"+intl(s.wa)+"?text="+encodeURIComponent("Hello! I have a question about "+(s.name||"your shop")+".");
  $("waFloat").href=wa;$("waFloat").hidden=!intl(s.wa);
  const soc=[["insta","Instagram"],["fb","Facebook"],["tiktok","TikTok"]].filter(([k])=>safeUrl(S.social[k]));
  $("social").innerHTML=soc.map(([k,l])=>`<a href="${esc(safeUrl(S.social[k]))}" target="_blank" rel="noopener">${l}</a>`).join("")+(intl(s.wa)?`<a href="${esc(wa)}" target="_blank" rel="noopener">WhatsApp</a>`:"");
  $("footCats").innerHTML=liveCats().map(([k,l])=>`<li><button class="fl" data-goshop="${k}" data-goocc="">${l}</button></li>`).join("");
  const fc=[];if(s.wa)fc.push("WhatsApp: "+s.wa);if(s.phone)fc.push("Call: "+s.phone);if(s.email)fc.push(s.email);if(s.address)fc.push(s.address);if(s.hours)fc.push(s.hours);
  $("footContact").innerHTML=fc.map(x=>`<li>${esc(x)}</li>`).join("")||`<li>${esc(s.city||"")}</li>`;
  const r=S.reg||{};
  $("copy").textContent="© "+new Date().getFullYear()+" "+(r.business||s.name||"")+(r.since?" · Since "+r.since:"");
  const rp=[];if(r.business&&r.business!==s.name)rp.push("Registered as "+r.business);if(r.regNo)rp.push("Reg. No. "+r.regNo);if(r.ntn)rp.push("NTN "+r.ntn);if(r.address)rp.push(r.address);
  $("regLine").textContent=rp.join(" · ");
  const boxes=[];
  if(s.wa)boxes.push(`<div class="cbox"><span class="k">WhatsApp</span><span class="v">${esc(s.wa)}</span><span class="s">Orders, custom designs and questions</span><a class="btn wa" style="align-self:start;margin-top:6px" href="${esc(wa)}" target="_blank" rel="noopener">Start a chat</a></div>`);
  if(s.phone||s.email)boxes.push(`<div class="cbox"><span class="k">Call / Email</span>${s.phone?`<span class="v">${esc(s.phone)}</span>`:""}${s.email?`<span class="v">${esc(s.email)}</span>`:""}</div>`);
  boxes.push(`<div class="cbox"><span class="k">Based in</span><span class="v">${esc(s.address||s.city||"Multan")}</span><span class="s">${esc(s.hours||"")}${s.hours?"\n":""}Delivery by inDrive within ${esc(s.city||"Multan")}. You pay the rider's fare on delivery.</span></div>`);
  if(soc.length)boxes.push(`<div class="cbox"><span class="k">Social</span><span class="s">New designs appear here first</span><div class="social">${soc.map(([k,l])=>`<a class="sm" href="${esc(safeUrl(S.social[k]))}" target="_blank" rel="noopener">${l}</a>`).join("")}</div></div>`);
  $("contactBoxes").innerHTML=boxes.join("");
}
function renderAll(){renderChrome();renderRail();renderCategories();renderMenu();renderHero();renderOccasions();renderShelves();renderPromo();renderShop();renderGallery();renderReviews();renderStory();renderCart();renderWish();renderMyOrders()}

/* ---------- global clicks: add, wish, quick view, navigation ---------- */
document.addEventListener("click",e=>{
  const a=e.target.closest("[data-add]"),w=e.target.closest("[data-wish]"),q=e.target.closest("[data-qv]"),g=e.target.closest("[data-goshop]"),pol=e.target.closest("[data-policy]");
  const stp=e.target.closest("[data-step-id]");
  if(stp){const id=stp.dataset.stepId;cart[id]=(cart[id]||0)+ +stp.dataset.stepD;if(cart[id]<=0){delete cart[id];toast("Removed from cart")}persist();refreshItem(id);return}
  if(a){const p=findP(a.dataset.add);if(!p||p.soldOut)return;cart[p.id]=(cart[p.id]||0)+1;persist();refreshItem(p.id);toast(p.name+" added to cart");return}
  if(w){const id=w.dataset.wish;wish=wish.includes(id)?wish.filter(x=>x!==id):[...wish,id];persist();refreshItem(id);toast(wish.includes(id)?"Saved to wishlist":"Removed from wishlist");return}
  if(q){openQV(q.dataset.qv);return}
  if(g){goShop(g.dataset.goshop,g.dataset.goocc);return}
  if(pol){openPolicy(pol.dataset.policy)}
});
function refreshProducts(){renderShelves();renderShop();renderCart();renderWish();if(!$("qvModal").hidden&&qvId)openQV(qvId,true)}
let qvId=null;
function openQV(id,keep){
  const p=findP(id);if(!p)return;qvId=id;
  $("qvCat").textContent=CATN[p.cat]||"";
  $("qvBody").innerHTML=`<div class="pic" style="border-radius:18px">${visual(p)}${p.photo&&p.sample?SAMPLE_TAG:""}</div>
    <div style="display:flex;flex-direction:column;gap:12px;min-width:0">
      <h2>${esc(p.name)}</h2>
      <div class="prices" style="padding:0"><span class="price" style="font-size:24px">${rs(p.price)}</span>${p.was>p.price?`<span class="was">${rs(p.was)}</span>`:""}</div>
      ${p.spec?`<div class="sub" style="font-size:15px">${esc(p.spec)}</div>`:""}
      ${p.desc?`<p>${esc(p.desc)}</p>`:""}
      ${(p.occ||[]).length?`<div class="chips">${p.occ.map(o=>`<span class="chip" style="cursor:default">${esc(OCCN[o]||o)}</span>`).join("")}</div>`:""}
      <p class="note">Each piece is handmade, so colour and size may vary slightly. Add your preferred colours in the order note.</p>
      <div style="display:flex;gap:8px;flex-wrap:wrap">
        ${p.soldOut?`<button class="btn dark" disabled>Sold out</button>`:`<button class="btn rose" data-add="${esc(p.id)}">${cart[p.id]?"✓ Added ("+cart[p.id]+") · add another":"Add to cart"}</button>`}
        <button class="btn ghost" data-wish="${esc(p.id)}">${wish.includes(p.id)?"♥ Saved":"♡ Save to wishlist"}</button>
      </div>
      ${p.soldOut?"":`<button class="link" style="align-self:start" id="qvCart">View cart →</button>`}
    </div>`;
  if(!keep)show($("qvModal"));
  const qc=$("qvCart");if(qc)qc.onclick=()=>openCart();
}
const POL_T={howto:"How to order",refund:"Refunds & returns",terms:"Terms & conditions",privacy:"Privacy policy"};
function openPolicy(k){$("polTitle").textContent=POL_T[k]||"";$("polBody").textContent=(S.policies||{})[k]||"Coming soon.";show($("polModal"))}

function renderWish(){
  const ids=wish.filter(id=>findP(id));
  $("wishCount").textContent=ids.length;$("wishCount").hidden=!ids.length;
  $("wishBody").innerHTML=ids.length?ids.map(id=>{const p=findP(id);return `<div class="line"><div class="mini">${visual(p,"")}</div><div><div class="nm">${esc(p.name)}</div><div class="sub">${rs(p.price)}</div></div>
    <div style="display:flex;gap:6px">${p.soldOut?"":`<button class="sm" data-add="${esc(id)}">Add to cart</button>`}<button class="sm red" data-wish="${esc(id)}" aria-label="Remove">×</button></div></div>`}).join("")
    :`<div class="empty">Your wishlist is empty. Tap ♡ on any product to save it.</div>`;
}

/* ---------- cart → order ---------- */
function cleanCart(){for(const id of Object.keys(cart)){const p=findP(id);if(!p||p.soldOut)delete cart[id]}}
function totals(){
  const sub=Object.entries(cart).reduce((s,[id,q])=>s+(findP(id)?.price||0)*q,0);
  const adds=(S.addons||[]).filter((a,i)=>addSel[i]&&a.name);
  const addT=adds.reduce((s,a)=>s+(+a.price||0),0);
  const base=sub+addT;
  const del=0; /* delivery is booked on inDrive; the customer pays the rider's fare, so it is not in the total */
  const shopPct=Math.min(100,Math.max(0,+S.shop.advancePct||0));
  const tot=base+del, pct=shopPct;
  const adv=pct>=100?tot:Math.ceil(tot*pct/100/10)*10;
  return{sub,adds,addT,del,tot,pct,adv,rest:tot-adv};
}
function renderCart(){
  cleanCart();const ids=Object.keys(cart);const n=ids.reduce((s,id)=>s+cart[id],0);
  $("cartCount").textContent=n;$("cartCount").hidden=!n;
  $("cartFloat").hidden=!n;$("checkoutBtn").disabled=!n;$("cartFloatTxt").innerHTML=`<b class="cf-n">${n}</b><span class="cf-l">View cart</span>`;$("cartFloat").setAttribute("aria-label",`View cart, ${n} item${n>1?"s":""}, ${rs(ids.reduce((s,id)=>s+(findP(id)?.price||0)*cart[id],0))}`);
  $("lines").innerHTML=ids.length?ids.map(id=>{const p=findP(id);return `<div class="line"><div class="mini">${visual(p,"")}</div>
    <div><div class="nm">${esc(p.name)}</div><div class="sub">${rs(p.price)} each</div></div>
    <div class="qty"><button data-d="-1" data-id="${esc(id)}" aria-label="Decrease">−</button><span>${cart[id]}</span><button data-d="1" data-id="${esc(id)}" aria-label="Increase">+</button><button class="rm" data-rm="${esc(id)}" aria-label="Remove ${esc(p.name)}"><svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M4 7h16M10 11v6M14 11v6M6 7l1 13h10l1-13M9 7V4h6v3"/></svg></button></div></div>`}).join("")
    :`<div class="empty">Your cart is empty. Browse the collection to add a bouquet or keychain.</div>`;
  const ad=(S.addons||[]).map((a,i)=>a.name?`<label class="addon" for="ad${i}"><input type="checkbox" id="ad${i}" data-ad="${i}"${addSel[i]?" checked":""}><span>${esc(a.name)}</span><b class="sub">${+a.price?"+ "+rs(a.price):"Free"}</b></label>`:"").join("");
  $("addonBox").innerHTML=ad?`<div class="fld" style="font-size:13px">Add a little extra</div>${ad}`:"";$("addonBox").hidden=!ad||!ids.length;
  const t=totals();
  $("tSub").textContent=rs(t.sub);$("tAddRow").hidden=!t.adds.length;$("tAdd").textContent=rs(t.addT);
  $("tDel").textContent="Paid to rider";$("tTot").textContent=rs(t.tot);
  renderCheckoutPay(t);
  $("tAdvRow").hidden=!t.pct;$("tAdvLbl").textContent=t.pct>=100?"Due now (full payment)":`Advance due now (${t.pct}%)`;$("tAdv").textContent=rs(t.adv);
  $("tRestRow").hidden=!(t.pct&&t.rest>0);$("tRest").textContent=rs(t.rest);
}
$("lines").addEventListener("click",e=>{const rm=e.target.closest("button[data-rm]");
  if(rm){const p=findP(rm.dataset.rm);delete cart[rm.dataset.rm];persist();refreshItem(rm.dataset.rm);toast((p?p.name:"Item")+" removed from cart");return}
  const b=e.target.closest("button[data-d]");if(!b)return;const id=b.dataset.id;
  cart[id]+=+b.dataset.d;if(cart[id]<=0)delete cart[id];persist();refreshItem(id)});
$("addonBox").addEventListener("change",e=>{const c=e.target.closest("[data-ad]");if(!c)return;addSel[c.dataset.ad]=c.checked;renderCart()});
{const d=load("gd-cust",{});["fName","fPhone","fAddr"].forEach(k=>{if(d[k])$(k).value=d[k]})}

let ORDER=null;
function buildOrder(){
  const t=totals(),no=draftNo();
  const items=Object.entries(cart).map(([id,q])=>{const p=findP(id);return{name:p.name,qty:q,price:p.price}});
  t.adds.forEach(a=>items.push({name:"Add-on: "+a.name,qty:1,price:+a.price||0}));
  return {no,items,...t,proof:PROOF.state==="done"&&PROOF.no===no?PROOF.path:"",proofLater:PROOF.state==="skip",name:$("fName").value.trim(),phone:$("fPhone").value.trim(),city:S.shop.city||"Multan",
    area:$("fArea").value==="Other"?"":$("fArea").value,addr:$("fAddr").value.trim(),need:$("fDate").value,needTxt:`${fmtDate($("fDate").value)}, ${$("fTime").value}`,note:"",card:""};
}
/* The shop's super admin reads this exact message format back in (Orders → Add an order from WhatsApp). */
function orderText(o){
  const day=new Date().toLocaleDateString("en-GB",{day:"numeric",month:"short",year:"numeric"});
  const L=[`*${S.shop.name} | New Order*`,`Order ID: *${o.no}*`,`Date: ${day}`,"","*Items*"];
  o.items.forEach(i=>L.push(`• ${i.name} × ${i.qty} — ${rs(i.price*i.qty)}`));
  L.push("",`*Total: ${rs(o.tot)}*`);
  if(o.pct){
    if(o.pct>=100)L.push(`${o.proof?"Paid in full":"Full payment"}: ${rs(o.adv)}`);
    else L.push(`Advance${o.proof?" paid":""} (${o.pct}%): ${rs(o.adv)}`,`Remaining after the photo: ${rs(o.rest)}`);
    if(o.proof)L.push("Payment screenshot: uploaded with the order");else if(o.proofLater)L.push("Payment screenshot: I will send it in this chat");
  }
  if(!o.pct)L.push(`Payment: cash on delivery (${rs(o.tot)})`);
  L.push("","*Delivery details*",`Name: ${o.name}`,`Phone: ${o.phone}`,`City: ${o.city}`,...(o.area?[`Area: ${o.area}`]:[]),`Address: ${o.addr}`);
  L.push(`Delivery: by inDrive, fare paid to the rider`);
  if(o.need)L.push(`Needed by: ${o.needTxt||fmtDate(o.need)}`);
  if(o.card)L.push(`Card message: ${o.card}`);
  if(o.note)L.push(`Note: ${o.note}`);
  return L.join("\n");
}
const setMsg=(id,t,err)=>{$(id).textContent=t;$(id).className="msg"+(err?" err":"")};
function check(){
  if(!Object.keys(cart).length)return "Please add an item to your cart.";
  if(!$("fName").value.trim())return "Please enter your name.";
  if($("fPhone").value.replace(/\D/g,"").length<10)return "Please enter a valid phone number, e.g. 0312 3456789.";
  if(!$("fArea").value)return "Please select your area.";
  if(!$("fDate").value)return "Please choose the date you need it.";
  if(!$("fAddr").value.trim())return "Please enter your delivery address.";
  const t=totals();
  if(proofNeeded(t)){
    if(PROOF.state==="busy")return "Your screenshot is still uploading. Please wait a moment.";
    if(PROOF.state!=="done"&&PROOF.state!=="skip")return `Please pay ${rs(t.adv)} and upload the payment screenshot.`;
  }
  return "";
}
function showPay(){
  const o=ORDER,part=o.pct>0&&o.pct<100,acc=payAccounts(S);
  $("cartTitle").textContent="Order "+o.no;
  $("placedS").innerHTML=`Order ID <b>${esc(o.no)}</b>. Tap <b>Send</b> in WhatsApp so we receive your order.`;
  $("receipt").innerHTML=`<div class="sub">Order ID</div><div class="ono">${esc(o.no)}</div><hr>
    ${o.items.map(i=>`<div class="r"><span>${esc(i.name)} × ${i.qty}</span><span>${rs(i.price*i.qty)}</span></div>`).join("")}
    <div class="r"><span>Delivery (inDrive)</span><span>Paid to rider</span></div><hr>
    <div class="r" style="font-weight:800"><span>Total</span><span>${rs(o.tot)}</span></div>
    ${o.pct?(part?`<div class="r"><span>Advance (${o.pct}%)${o.proof?" · paid":""}</span><span>${rs(o.adv)}</span></div><div class="r sub"><span>Remaining, after you see the photo</span><span>${rs(o.rest)}</span></div>`
      :`<div class="r"><span>${o.proof?"Paid in full":"Full payment"}</span><span>${rs(o.adv)}</span></div>`):""}
    <div class="r sub"><span>${esc(o.name)} · ${esc(o.phone)}</span><span>${esc(o.area||o.city)}</span></div>
    ${o.need?`<div class="r sub"><span>Needed by</span><span>${esc(o.needTxt||fmtDate(o.need))}</span></div>`:""}`;
  const steps=[];
  if(o.pct&&!o.proof&&acc.length)steps.push(["Send your payment screenshot",`Pay ${rs(o.adv)} to one of the accounts below and send the screenshot in our WhatsApp chat.`]);
  if(o.pct)steps.push(["We check your payment","Then we confirm your order on WhatsApp."]);
  steps.push(["We make it by hand",part?"When it is ready, we send you a photo of it.":"Every piece is made to order for you."]);
  if(part)steps.push([`You pay the remaining ${rs(o.rest)}`,"Once you have seen the photo. Then we book your inDrive rider."]);
  steps.push(["Delivered to your door",o.pct?"An inDrive rider brings it to you. You pay the rider's fare.":`An inDrive rider brings it to you. You pay ${rs(o.tot)} in cash, plus the rider's fare.`]);
  $("nextSteps").innerHTML=steps.map(([b,t])=>`<li><b>${esc(b)}</b><span>${esc(t)}</span></li>`).join("");
  const showAcc=!!(o.pct&&!o.proof&&acc.length);$("accts").hidden=!showAcc;
  $("accts").innerHTML=showAcc?acc.map((a,i)=>`<div class="acct"><div style="min-width:0"><div class="k">${esc(a.k)}</div><div class="v" id="acv${i}">${esc(a.v)}</div>${a.who?`<div class="sub">Account title: <b>${esc(a.who)}</b></div>`:""}</div><button class="sm" type="button" data-cp="${i}">Copy</button></div>`).join(""):"";
  $("waBtn").href=waLink(o);
  setStep("pay");setMsg("msg2","");
}
/* ---------- checkout payment: amount, accounts, the customer's screenshot and our promises ----------
   The screenshot is uploaded as soon as it is chosen (while the customer finishes the form), so "Place order"
   can open WhatsApp straight away. It is saved privately for the super admin under a draft order ID. */
let DRAFT_NO=null,PROOF={state:"none"},proofSeq=0;
const draftNo=()=>DRAFT_NO||(DRAFT_NO=makeOrderNo(S.shop.name));
const proofNeeded=t=>!!(t.pct&&payAccounts(S).length);
const ICON_OK=`<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M5 12.5l4.5 4.5L19 7.5"/></svg>`;
const ICON_IMG=`<svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect x="3" y="3" width="18" height="18" rx="3"/><circle cx="9" cy="9" r="2"/><path d="M21 15l-5-5L5 21"/></svg>`;
function renderCheckoutPay(t){
  const acc=payAccounts(S),part=t.pct>0&&t.pct<100;
  $("checkoutPay").hidden=!t.pct;if(!t.pct)return;
  $("cpTitle").textContent=part?`Pay ${t.pct}% advance now`:"Pay in full now";
  $("cpAmt").textContent=rs(t.adv);
  $("cpNote").innerHTML=(acc.length?`Send <b>${rs(t.adv)}</b> to any one account below, then upload the screenshot.`:"We will send our payment details on WhatsApp.")
    +(part?` The remaining <b>${rs(t.rest)}</b> is paid after we send you a photo of your finished order.`:"");
  $("cpAccts").innerHTML=acc.map((a,i)=>`<div class="acct"><div style="min-width:0"><div class="k">${esc(a.k)}</div><div class="v" id="cpv${i}">${esc(a.v)}</div>${a.who?`<div class="sub">Account title: <b>${esc(a.who)}</b></div>`:""}</div><button class="sm" type="button" data-cpc="${i}">Copy</button></div>`).join("")
    +(acc.some(a=>a.who)?`<p class="note small">Your payment app shows the account title before you confirm. Check that it matches.</p>`:"");
  $("proofBox").hidden=!acc.length;if(acc.length)renderProof();
  $("cpAssure").innerHTML=["We confirm your payment on WhatsApp, with your order ID.",...(part?["You see a photo of your finished order before you pay the rest."]:[]),
    `If we cannot deliver on your date, your ${part?"advance":"payment"} is refunded in full.`].map(x=>`<li>${ICON_OK}<span>${x}</span></li>`).join("");
}
function renderProof(){
  const p=PROOF,pic=p.url?`<img src="${esc(p.url)}" alt="Your payment screenshot">`:`<span class="ph">${ICON_IMG}</span>`;
  if(p.state==="none"){$("proofBox").innerHTML=`<button type="button" class="proof-pick" data-proof="pick">${ICON_IMG}<span><b>Upload payment screenshot</b><small>After paying, take a screenshot of the confirmation and add it here.</small></span></button>`;return}
  if(p.state==="skip"){$("proofBox").innerHTML=`<div class="proof-row"><span class="ph">${ICON_IMG}</span><div class="pr-t"><b>Screenshot on WhatsApp</b><small>Send it in our WhatsApp chat after placing your order.</small></div><button type="button" class="sm" data-proof="pick">Upload now</button></div>`;return}
  const T={busy:["Uploading your screenshot…","Please keep this page open."],done:["Screenshot uploaded","We check it before confirming your order."],error:["Upload failed",p.err||"Check your connection and try again."]}[p.state];
  $("proofBox").innerHTML=`<div class="proof-row ${p.state}">${pic}<div class="pr-t"><b>${T[0]}</b><small>${esc(T[1])}</small></div>${p.state==="busy"?`<span class="spin" aria-hidden="true"></span>`:`<button type="button" class="sm" data-proof="pick">${p.state==="done"?"Change":"Try again"}</button>`}</div>`
    +(p.state==="error"?`<button type="button" class="link proof-skip" data-proof="skip">Can't upload? Send the screenshot on WhatsApp instead</button>`:"");
}
$("proofBox").addEventListener("click",e=>{const b=e.target.closest("[data-proof]");if(!b)return;
  if(b.dataset.proof==="pick"){$("fProof").value="";$("fProof").click()}
  else if(b.dataset.proof==="skip"){proofSeq++;PROOF={state:"skip"};renderProof();setMsg("msg","")}});
$("fProof").addEventListener("change",()=>{const f=$("fProof").files[0];if(f)uploadProof(f)});
async function uploadProof(file){
  const id=++proofSeq,no=draftNo();
  if(PROOF.url)URL.revokeObjectURL(PROOF.url);
  PROOF={state:"busy"};renderProof();setMsg("msg","");
  try{
    let b=await toJpeg(file,1600,.82);if(b.size>900000)b=await toJpeg(file,1200,.72);
    if(id!==proofSeq)return;
    PROOF.url=URL.createObjectURL(b);renderProof();
    const ctl=new AbortController(),tm=setTimeout(()=>ctl.abort(),45000);
    let r;try{r=await fetch(ORDER_API+"/proof",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({no,image:await blobB64(b)}),signal:ctl.signal})}finally{clearTimeout(tm)}
    const d=await r.json().catch(()=>({}));
    if(id!==proofSeq)return;
    if(!r.ok||!d.path)throw new Error(d.error||"upload");
    PROOF={state:"done",url:PROOF.url,path:d.path,no};
  }catch(e){
    if(id!==proofSeq)return;
    const m=e&&e.message;
    PROOF={state:"error",url:PROOF.url,err:m==="decode"?"This file could not be opened. Please choose a JPG or PNG screenshot.":m==="too_large"?"This image is too large. Please choose the screenshot again.":m==="too_many"?"Too many uploads. Please wait a few minutes and try again.":"Check your connection and try again."};
  }
  renderProof();
}
$("cpAccts").addEventListener("click",e=>{const b=e.target.closest("[data-cpc]");if(!b)return;const el=$("cpv"+b.dataset.cpc);
  navigator.clipboard.writeText(el.textContent).then(()=>toast("Account number copied")).catch(()=>{const r=document.createRange();r.selectNodeContents(el);const s=getSelection();s.removeAllRanges();s.addRange(r);toast("Number selected. Copy it manually.")})});
$("accts").addEventListener("click",e=>{const b=e.target.closest("[data-cp]");if(!b)return;const el=$("acv"+b.dataset.cp);
  navigator.clipboard.writeText(el.textContent).then(()=>toast("Account number copied")).catch(()=>{const r=document.createRange();r.selectNodeContents(el);const s=getSelection();s.removeAllRanges();s.addRange(r);toast("Number selected. Copy it manually.")})});
const waLink=o=>"https://wa.me/"+intl(S.shop.wa)+"?text="+encodeURIComponent(typeof o==="string"?o:orderText(o));
/* "Place order" is a real link: the click handler checks the form, creates the order and points the link at the
   shop's WhatsApp chat before the browser follows it, so one tap places the order and opens the chat. */
$("confirmBtn").addEventListener("click",e=>{
  const err=check();if(err){e.preventDefault();setMsg("msg",err,true);if(/screenshot/.test(err))$("checkoutPay").scrollIntoView({behavior:"smooth",block:"center"});return}setMsg("msg","");
  save("gd-cust",{fName:$("fName").value,fPhone:$("fPhone").value,fArea:$("fArea").value,fAddr:$("fAddr").value});
  ORDER=buildOrder();$("confirmBtn").href=waLink(ORDER);rememberOrder(ORDER);sendOrder(ORDER);
  DRAFT_NO=null;proofSeq++;PROOF={state:"none"};showPay();
});
$("waBtn").addEventListener("click",()=>setMsg("msg2","Opening WhatsApp. If it does not open, copy the message and send it to "+S.shop.wa+"."));
$("copyBtn").onclick=()=>navigator.clipboard.writeText(orderText(ORDER)).then(()=>setMsg("msg2","Message copied. Paste it in a WhatsApp chat with "+S.shop.wa+"."))
  .catch(()=>{setMsg("msg2","Could not copy. Select the text below and copy it.",true);
    let ta=$("fallbackTxt");if(!ta){ta=document.createElement("textarea");ta.id="fallbackTxt";ta.rows=8;$("payStep").appendChild(ta)}ta.value=orderText(ORDER);ta.select()});
/* The drawer has three steps: cart (items and add-ons) → details (delivery form, place order) → pay (receipt). */
let STEP="cart";
function setStep(s){STEP=s;
  $("cartTitle").textContent=s==="cart"?"Your cart":s==="details"?"Delivery details":$("cartTitle").textContent;
  $("cartStep").hidden=s!=="cart";$("detailsStep").hidden=s!=="details";$("payStep").hidden=s!=="pay";$("cartTotals").hidden=s==="pay";
  $("checkoutBtn").hidden=s!=="cart";$("confirmBtn").hidden=s!=="details";$("confirmNote").hidden=s!=="details";setMsg("msg","");$("cartTotals").classList.toggle("compact",s==="details");
  const b=$("drawer").querySelector(s==="details"?"#detailsStep":"#cartStep");if(b)b.scrollTop=0}
function backToCart(){setStep("cart")}
{const t=new Date(),p=n=>String(n).padStart(2,"0");$("fDate").min=`${t.getFullYear()}-${p(t.getMonth()+1)}-${p(t.getDate())}`}
$("checkoutBtn").onclick=()=>{if(!Object.keys(cart).length){setMsg("msg","Please add an item to your cart.",true);return}setStep("details");setTimeout(()=>$("fName").focus(),50)};
$("toCartBtn").onclick=()=>setStep("cart");
const openCart=()=>{if(STEP!=="pay")setStep("cart");show($("drawer"))};
$("newOrderBtn").onclick=()=>{cart={};addSel={};persist();ORDER=null;DRAFT_NO=null;proofSeq++;PROOF={state:"none"};refreshProducts();backToCart();toast("Cart cleared")};

/* Saves the order for the shop. WhatsApp still opens either way, so a network problem never blocks the customer. */
function sendOrder(o){
  try{fetch(ORDER_API+"/order",{method:"POST",keepalive:true,headers:{"Content-Type":"application/json"},
    body:JSON.stringify({order:o})}).catch(()=>{})}catch(e){}
}

/* ---------- my orders: orders placed from this device ---------- */
function rememberOrder(o){
  myOrders=[{no:o.no,phone:o.phone,at:Date.now(),items:o.items,tot:o.tot,adv:o.adv,pct:o.pct,cart:{...cart},text:orderText(o)},...myOrders.filter(x=>x.no!==o.no)].slice(0,20);
  save("gd-orders",myOrders);renderMyOrders();
}
function renderMyOrders(){
  $("orderCount").textContent=myOrders.length;$("orderCount").hidden=!myOrders.length;
  $("ordersBody").innerHTML=myOrders.length?`<p class="note">Orders placed on this device. We confirm every order on WhatsApp.</p>`+myOrders.map((o,i)=>`<div class="myo">
      <div class="ohead"><span class="no">${esc(o.no)}</span><span class="sub">${new Date(o.at).toLocaleDateString("en-PK",{day:"numeric",month:"short",year:"numeric"})}</span></div>
      <ul>${(o.items||[]).map(it=>`<li>${esc(it.name)} × ${it.qty}</li>`).join("")}</ul>
      <div class="sub">Total <b>${rs(o.tot)}</b>${o.pct?` · Advance ${rs(o.adv)}`:""}</div>
      <div class="acts"><a class="sm green" href="${esc(waLink(o.text||""))}" target="_blank" rel="noopener">Send on WhatsApp again</a><button class="sm" type="button" data-reorder="${i}">Order again</button></div>
    </div>`).join("")+`<button class="sm red" type="button" id="clearOrders" style="align-self:start">Clear this list</button>`
    :`<div class="empty">No orders yet. Orders you place on this device appear here.</div>`;
}
$("ordersBody").addEventListener("click",e=>{
  const r=e.target.closest("[data-reorder]");
  if(r){const o=myOrders[+r.dataset.reorder];if(!o)return;let added=0;
    for(const [id,q] of Object.entries(o.cart||{})){const p=findP(id);if(p&&!p.soldOut){cart[id]=(cart[id]||0)+q;added++}}
    persist();refreshProducts();backToCart();
    if(added){show($("drawer"));toast("Items added to your cart")}else toast("These items are no longer available");return}
  if(e.target.closest("#clearOrders")){myOrders=[];save("gd-orders",myOrders);renderMyOrders()}
});


/* ---------- overlays ---------- */
let openPanel=null;
function show(panel){if(openPanel)openPanel.hidden=true;openPanel=panel;$("scrim").hidden=!panel;if(panel){panel.hidden=false;const c=panel.querySelector("[data-close]");if(c)c.focus()}}
$("openCart").onclick=openCart;
$("cartFloat").onclick=openCart;
$("openWish").onclick=()=>show($("wishDrawer"));
$("openOrders").onclick=()=>show($("ordersDrawer"));
$("openSearch").onclick=()=>{show(null);$("shop").scrollIntoView({behavior:"smooth"});setTimeout(()=>$("q").focus(),400)};
$("scrim").onclick=()=>show(null);
document.querySelectorAll("[data-close]").forEach(b=>b.onclick=()=>show(null));
document.addEventListener("keydown",e=>{if(e.key==="Escape"){show(null);closeMega()}});

/* ---------- search engines: business details and products as structured data ----------
   Products are listed only once they have a real photo (AI sample photos are left out). */
function renderSchema(){
  const s=S.shop,base="https://giftoria-atelier.pages.dev/",soc=["insta","fb","tiktok"].map(k=>safeUrl(S.social[k])).filter(Boolean);
  const biz={"@context":"https://schema.org","@type":"Florist","name":s.name,"url":base,"logo":base+"assets/icon-512.png","image":base+"assets/share.jpg",
    "description":s.footAbout||"","address":{"@type":"PostalAddress","addressLocality":s.city||"Multan","addressCountry":"PK",...(s.address?{"streetAddress":s.address}:{})},
    "areaServed":{"@type":"City","name":s.city||"Multan"},"currenciesAccepted":"PKR",...(payAccounts(S).length?{"paymentAccepted":payAccounts(S).map(a=>a.k).join(", ")}:{}),
    ...(intl(s.wa)?{"telephone":"+"+intl(s.wa)}:{}),...(s.email?{"email":s.email}:{}),...(soc.length?{"sameAs":soc}:{})};
  const real=S.products.filter(p=>p.photo&&!p.sample);
  const data=[biz];
  if(real.length)data.push({"@context":"https://schema.org","@type":"ItemList","name":"Products","itemListElement":real.map((p,i)=>({"@type":"ListItem","position":i+1,
    "item":{"@type":"Product","name":p.name,"image":new URL(photoSrc(p.photo),base).href,"description":p.desc||p.spec||p.name,"category":CATN[p.cat]||"",
      "offers":{"@type":"Offer","price":String(p.price),"priceCurrency":"PKR","availability":"https://schema.org/"+(p.soldOut?"OutOfStock":"InStock"),"url":base+"#shop"}}}))});
  let el=$("ldjson");if(!el){el=document.createElement("script");el.type="application/ld+json";el.id="ldjson";document.head.appendChild(el)}
  el.textContent=JSON.stringify(data);
}

/* ---------- start: load the published shop data ---------- */
(async()=>{
  try{
    S=normalizeShop(await (window.__shop||fetch("data/shop.json?v="+Date.now(),{cache:"no-store"}).then(r=>{if(!r.ok)throw new Error(r.status);return r.json()})));applyMenu(S);
  }catch(e){$("loader").hidden=true;$("loadErr").hidden=false;return}
  $("loader").hidden=true;$("app").hidden=false;
  renderAll();renderSchema();
  addEventListener("load",()=>setTimeout(()=>document.querySelectorAll("#slides img[loading=lazy]").forEach(i=>i.loading="eager"),1500));
  if(location.hash&&location.hash.length>1){const t=document.getElementById(location.hash.slice(1));if(t)t.scrollIntoView()}
})();
