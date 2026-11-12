/* Storefront: customers browse, add to cart and place the order on WhatsApp. Nothing here edits the shop;
   all content comes from data/shop.json, which the super admin (admin/) publishes. */
"use strict";
/* The shop's sign-in service also receives orders (saved privately for the super admin) and answers order tracking. */
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
const refImg=(o,alt,fallback)=>{const r=refPhoto(o);return r?`<img src="${esc(photoSrc(r.src))}" alt="${esc(alt)}">${r.sample?SAMPLE_TAG:""}`:fallback};
function card(p){
  const inW=wish.includes(p.id);
  const badge=p.soldOut?`<span class="badge out">Sold out</span>`:p.was>p.price?`<span class="badge sale">${Math.round((1-p.price/p.was)*100)}% off</span>`:p.isNew?`<span class="badge new">New</span>`:p.best?`<span class="badge best">Bestseller</span>`:"";
  return `<article class="card">
    <div style="position:relative"><button class="pic" data-qv="${esc(p.id)}" aria-label="View ${esc(p.name)}">${visual(p)}</button>${badge}${p.photo&&p.sample?SAMPLE_TAG:""}
    <button class="heart" data-wish="${esc(p.id)}" aria-pressed="${inW}" aria-label="Wishlist">${inW?"♥":"♡"}</button></div>
    <div class="body"><span class="cat">${esc(CATN[p.cat]||"")}</span><h3>${esc(p.name)}</h3><span class="sub">${esc(p.spec)}</span>
      <div class="prices"><span class="price">${rs(p.price)}</span>${p.was>p.price?`<span class="was">${rs(p.was)}</span>`:""}</div></div>
    <div class="acts">${p.soldOut?`<button class="add" disabled>Sold out</button>`:`<button class="add${cart[p.id]?" done":""}" data-add="${esc(p.id)}">${cart[p.id]?"✓ Added ("+cart[p.id]+")":"Add to cart"}</button>`}<button class="qv" data-qv="${esc(p.id)}">View</button></div>
  </article>`;
}
let slideI=0,slideT=null;
function renderHero(){
  const sl=S.slides.filter(s=>s&&s.title);
  if(!sl.length){$("slides").innerHTML="";$("dots").innerHTML="";return}
  slideI=Math.min(slideI,sl.length-1);
  $("slides").innerHTML=sl.map((s,i)=>`<div class="slide"${i===slideI?"":" hidden"}>
    <div>${s.kicker?`<span class="hand">${esc(s.kicker)}</span>`:""}<h1>${esc(s.title)}</h1>${s.text?`<p>${esc(s.text)}</p>`:""}
      <div style="display:flex;gap:10px;flex-wrap:wrap"><button class="btn rose" data-goshop="${esc(s.cat||"all")}" data-goocc="${esc(s.occ||"")}">${esc(s.btn||"Shop now")}</button></div></div>
    <div class="arch hero-art">${refImg(s,s.title,drawArt(s.art))}</div></div>`).join("");
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
function renderOccasions(){
  const used=new Set();
  $("occs").innerHTML=OCCS.map(([k,l])=>{const n=S.products.filter(p=>(p.occ||[]).includes(k)).length;
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
    <div class="img">${refImg(p,p.title,drawArt(OCC_ART[p.occ]||DEFAULT_ART.bouquet))}</div>`:"";
}
function renderShop(){
  $("catChips").innerHTML=[["all","All"],...CATS].map(([k,l])=>`<button class="chip" data-cat="${k}" aria-pressed="${F.cat===k}">${l}</button>`).join("");
  $("occSel").innerHTML=`<option value="">All occasions</option>`+OCCS.map(([k,l])=>`<option value="${k}"${F.occ===k?" selected":""}>${l}</option>`).join("");
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
function goShop(cat,occ){F.cat=cat||"all";F.occ=occ||"";F.q="";$("q").value="";renderShop();show(null);$("shop").scrollIntoView({behavior:"smooth"})}

function renderRail(){$("rail").innerHTML=CATS.map(([k,l])=>`<button data-goshop="${k}" data-goocc="">${l}</button>`).join("")+OCCS.slice(0,3).map(([k,l])=>`<button data-goshop="all" data-goocc="${k}">${l}</button>`).join("")}
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
  $("storyArt").innerHTML=refImg(a,S.shop.name,null)||drawArt({kind:"bouquet",shape:"tulip",colors:["#F7B5CD","#F28AB2","#E86A9A","#F28AB2","#F7B5CD"],wrap:"#FFFFFF"});
}
function renderChrome(){
  const s=S.shop,pct=+s.advancePct||0;
  document.title=(s.name||"Shop")+" | Handmade flowers and gifts";
  $("announce").textContent=s.announce||"";$("announce").parentElement.hidden=!s.announce;
  $("shopName").textContent=s.name||"Shop";$("footName").textContent=s.name||"";
  $("footAbout").textContent=s.footAbout||"";
  $("fCity").innerHTML=`<option value="local">${esc(s.city||"Multan")}</option>`;
  $("trustDelT").textContent="Delivery across "+(s.city||"Multan");
  $("trustPayT").textContent=pct?(pct>=100?"Full payment upfront":pct+"% advance"):"Cash on delivery";
  $("trustPay").textContent=pct?(payAccounts(S).map(a=>a.k).join(", ")||"JazzCash, Easypaisa, bank"):"Pay on delivery";
  const wa="https://wa.me/"+intl(s.wa)+"?text="+encodeURIComponent("Hello! I have a question about "+(s.name||"your shop")+".");
  $("waFloat").href=wa;$("waFloat").hidden=!intl(s.wa);
  const soc=[["insta","Instagram"],["fb","Facebook"],["tiktok","TikTok"]].filter(([k])=>safeUrl(S.social[k]));
  $("social").innerHTML=soc.map(([k,l])=>`<a href="${esc(safeUrl(S.social[k]))}" target="_blank" rel="noopener">${l}</a>`).join("")+(intl(s.wa)?`<a href="${esc(wa)}" target="_blank" rel="noopener">WhatsApp</a>`:"");
  $("footCats").innerHTML=CATS.map(([k,l])=>`<li><button class="fl" data-goshop="${k}" data-goocc="">${l}</button></li>`).join("");
  const fc=[];if(s.wa)fc.push("WhatsApp: "+s.wa);if(s.phone)fc.push("Call: "+s.phone);if(s.email)fc.push(s.email);if(s.address)fc.push(s.address);if(s.hours)fc.push(s.hours);
  $("footContact").innerHTML=fc.map(x=>`<li>${esc(x)}</li>`).join("")||`<li>${esc(s.city||"")}</li>`;
  const r=S.reg||{};
  $("copy").textContent="© "+new Date().getFullYear()+" "+(r.business||s.name||"")+(r.since?" · Since "+r.since:"");
  const rp=[];if(r.business&&r.business!==s.name)rp.push("Registered as "+r.business);if(r.regNo)rp.push("Reg. No. "+r.regNo);if(r.ntn)rp.push("NTN "+r.ntn);if(r.address)rp.push(r.address);
  $("regLine").textContent=rp.join(" · ");
  const boxes=[];
  if(s.wa)boxes.push(`<div class="cbox"><span class="k">WhatsApp</span><span class="v">${esc(s.wa)}</span><span class="s">Orders, custom designs and questions</span><a class="btn wa" style="align-self:start;margin-top:6px" href="${esc(wa)}" target="_blank" rel="noopener">Start a chat</a></div>`);
  if(s.phone||s.email)boxes.push(`<div class="cbox"><span class="k">Call / Email</span>${s.phone?`<span class="v">${esc(s.phone)}</span>`:""}${s.email?`<span class="v">${esc(s.email)}</span>`:""}</div>`);
  boxes.push(`<div class="cbox"><span class="k">Based in</span><span class="v">${esc(s.address||s.city||"Multan")}</span><span class="s">${esc(s.hours||"")}${s.hours?"\n":""}Delivery: ${rs(s.delLocal)} within ${esc(s.city||"Multan")} only${s.freeAbove?"\nFree delivery over "+rs(s.freeAbove):""}</span></div>`);
  if(soc.length)boxes.push(`<div class="cbox"><span class="k">Social</span><span class="s">New designs appear here first</span><div class="social">${soc.map(([k,l])=>`<a class="sm" href="${esc(safeUrl(S.social[k]))}" target="_blank" rel="noopener">${l}</a>`).join("")}</div></div>`);
  $("contactBoxes").innerHTML=boxes.join("");
}
function renderAll(){renderChrome();renderRail();renderHero();renderOccasions();renderShelves();renderPromo();renderShop();renderGallery();renderReviews();renderStory();renderCart();renderWish();renderMyOrders()}

/* ---------- global clicks: add, wish, quick view, navigation ---------- */
document.addEventListener("click",e=>{
  const a=e.target.closest("[data-add]"),w=e.target.closest("[data-wish]"),q=e.target.closest("[data-qv]"),g=e.target.closest("[data-goshop]"),pol=e.target.closest("[data-policy]");
  if(a){const p=findP(a.dataset.add);if(!p||p.soldOut)return;cart[p.id]=(cart[p.id]||0)+1;persist();refreshProducts();toast(p.name+" added to cart");return}
  if(w){const id=w.dataset.wish;wish=wish.includes(id)?wish.filter(x=>x!==id):[...wish,id];persist();refreshProducts();toast(wish.includes(id)?"Saved to wishlist":"Removed from wishlist");return}
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
  const qc=$("qvCart");if(qc)qc.onclick=()=>show($("drawer"));
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
  const free=S.shop.freeAbove&&base>=S.shop.freeAbove;
  const del=sub===0||free?0:(+S.shop.delLocal||0);
  const tot=base+del, pct=Math.min(100,Math.max(0,+S.shop.advancePct||0));
  const adv=pct>=100?tot:Math.ceil(tot*pct/100/10)*10;
  return{sub,adds,addT,del,tot,pct,adv,rest:tot-adv};
}
function renderCart(){
  cleanCart();const ids=Object.keys(cart);const n=ids.reduce((s,id)=>s+cart[id],0);
  $("cartCount").textContent=n;$("cartCount").hidden=!n;
  $("cartFloat").hidden=!n;$("cartFloatTxt").textContent=`View cart (${n}) · ${rs(ids.reduce((s,id)=>s+(findP(id)?.price||0)*cart[id],0))}`;
  $("lines").innerHTML=ids.length?ids.map(id=>{const p=findP(id);return `<div class="line"><div class="mini">${visual(p,"")}</div>
    <div><div class="nm">${esc(p.name)}</div><div class="sub">${rs(p.price)} each</div></div>
    <div class="qty"><button data-d="-1" data-id="${esc(id)}" aria-label="Decrease">−</button><span>${cart[id]}</span><button data-d="1" data-id="${esc(id)}" aria-label="Increase">+</button></div></div>`}).join("")
    :`<div class="empty">Your cart is empty. Browse the collection to add a bouquet or keychain.</div>`;
  const ad=(S.addons||[]).map((a,i)=>a.name?`<label class="addon" for="ad${i}"><input type="checkbox" id="ad${i}" data-ad="${i}"${addSel[i]?" checked":""}><span>${esc(a.name)}</span><b class="sub">${+a.price?"+ "+rs(a.price):"Free"}</b></label>`:"").join("");
  $("addonBox").innerHTML=ad?`<div class="fld" style="font-size:13px">Add a little extra</div>${ad}`:"";$("addonBox").hidden=!ad||!ids.length;
  const t=totals();
  $("tSub").textContent=rs(t.sub);$("tAddRow").hidden=!t.adds.length;$("tAdd").textContent=rs(t.addT);
  $("tDel").textContent=t.sub===0?"Rs 0":(t.del?rs(t.del):"Free");$("tTot").textContent=rs(t.tot);
  $("tAdvRow").hidden=!t.pct;$("tAdvLbl").textContent=t.pct>=100?"Due now (full payment)":`Advance due now (${t.pct}%)`;$("tAdv").textContent=rs(t.adv);
}
$("lines").addEventListener("click",e=>{const b=e.target.closest("button[data-d]");if(!b)return;const id=b.dataset.id;
  cart[id]+=+b.dataset.d;if(cart[id]<=0)delete cart[id];persist();refreshProducts()});
$("addonBox").addEventListener("change",e=>{const c=e.target.closest("[data-ad]");if(!c)return;addSel[c.dataset.ad]=c.checked;renderCart()});
{const d=load("gd-cust",{});["fName","fPhone","fArea","fAddr"].forEach(k=>{if(d[k])$(k).value=d[k]})}
$("fDate").min=new Date(Date.now()+864e5).toISOString().slice(0,10);

let ORDER=null;
function buildOrder(){
  const t=totals();
  const items=Object.entries(cart).map(([id,q])=>{const p=findP(id);return{name:p.name,qty:q,price:p.price}});
  t.adds.forEach(a=>items.push({name:"Add-on: "+a.name,qty:1,price:+a.price||0}));
  return {no:makeOrderNo(S.shop.name),items,...t,name:$("fName").value.trim(),phone:$("fPhone").value.trim(),city:S.shop.city||"Multan",
    area:$("fArea").value.trim(),addr:$("fAddr").value.trim(),need:$("fDate").value,note:$("fNote").value.trim(),card:$("fCard").value.trim()};
}
/* The shop's super admin reads this exact message format back in (Orders → Add an order from WhatsApp). */
const trackUrl=no=>location.origin+location.pathname.replace(/[^/]*$/,"")+"#track="+encodeURIComponent(no);
function orderText(o){
  const day=new Date().toLocaleDateString("en-GB",{day:"numeric",month:"short",year:"numeric"});
  const L=[`*${S.shop.name} | New Order*`,`Tracking ID: *${o.no}*`,`Date: ${day}`,"","*Items*"];
  o.items.forEach(i=>L.push(`• ${i.name} × ${i.qty} — ${rs(i.price*i.qty)}`));
  L.push("",`Subtotal: ${rs(o.sub+o.addT)}`,`Delivery: ${o.del?rs(o.del):"Free"}`,`*Total: ${rs(o.tot)}*`);
  if(o.pct){L.push(`Advance due (${o.pct}%): ${rs(o.adv)}`);if(o.rest>0)L.push(`Balance on delivery: ${rs(o.rest)}`)}
  L.push("","*Delivery details*",`Name: ${o.name}`,`Phone: ${o.phone}`,`City: ${o.city}`,...(o.area?[`Area: ${o.area}`]:[]),`Address: ${o.addr}`);
  if(o.need)L.push(`Needed by: ${fmtDate(o.need)}`);
  if(o.card)L.push(`Card message: ${o.card}`);
  if(o.note)L.push(`Note: ${o.note}`);
  const acc=o.pct?payAccounts(S):[];
  if(o.pct){L.push("","*Payment*");acc.forEach(a=>L.push(`${a.k}: ${a.v}${a.who?" ("+a.who+")":""}`));
    L.push(`Status: Awaiting payment. I will share the payment screenshot in this chat.`)}
  L.push("",`Track your order: ${trackUrl(o.no)}`);
  return L.join("\n");
}
const setMsg=(id,t,err)=>{$(id).textContent=t;$(id).className="msg"+(err?" err":"")};
function check(){
  if(!Object.keys(cart).length)return "Please add an item to your cart.";
  if(!$("fName").value.trim())return "Please enter your name.";
  if($("fPhone").value.replace(/\D/g,"").length<10)return "Please enter a valid phone number, e.g. 0312 3456789.";
  if(!$("fAddr").value.trim())return "Please enter your delivery address.";
  return "";
}
function showPay(){
  const o=ORDER;
  $("cartTitle").textContent="Order "+o.no;
  $("receipt").innerHTML=`<div class="sub">Order number</div><div class="ono">${esc(o.no)}</div><hr>
    ${o.items.map(i=>`<div class="r"><span>${esc(i.name)} × ${i.qty}</span><span>${rs(i.price*i.qty)}</span></div>`).join("")}
    <div class="r"><span>Delivery</span><span>${o.del?rs(o.del):"Free"}</span></div><hr>
    <div class="r" style="font-weight:800"><span>Total</span><span>${rs(o.tot)}</span></div>
    <div class="r sub"><span>${esc(o.name)} · ${esc(o.phone)}</span><span>${esc(o.city)}</span></div>
    ${o.need?`<div class="r sub"><span>Needed by</span><span>${esc(fmtDate(o.need))}</span></div>`:""}
    ${o.card?`<div class="r sub"><span>Card</span><span>${esc(o.card)}</span></div>`:""}`;
  const acc=payAccounts(S);
  if(o.pct){
    $("payBig").hidden=false;
    $("payBig").innerHTML=`<div class="sub">${o.pct>=100?"Send full payment":"Send advance"}</div><div class="amt">${rs(o.adv)}</div>${o.rest>0?`<div class="sub">Balance ${rs(o.rest)} on delivery</div>`:""}`;
    $("accts").innerHTML=acc.length?acc.map((a,i)=>`<div class="acct"><div style="min-width:0"><div class="k">${esc(a.k)}</div><div class="v" id="acv${i}">${esc(a.v)}</div>${a.who?`<div class="sub">${esc(a.who)}</div>`:""}</div><button class="sm" type="button" data-cp="${i}">Copy</button></div>`).join("")
      :`<div class="acct"><div><div class="k">Payment</div><div class="v">Account details will be shared on WhatsApp</div></div></div>`;
    $("payNote").textContent="Your order is placed but not yet confirmed. Your WhatsApp chat with us has opened with this order: tap Send there, then pay the advance and share the payment screenshot in the same chat. We confirm your order once we have checked the payment.";
  } else {
    $("payBig").hidden=true;$("accts").innerHTML="";
    $("payNote").textContent="Your WhatsApp chat with us has opened with this order. Tap Send there. You pay on delivery.";
  }
  $("waBtn").href=waLink(o);
  $("cartStep").hidden=true;$("cartTotals").hidden=true;$("payStep").hidden=false;setMsg("msg2","");
}
$("accts").addEventListener("click",e=>{const b=e.target.closest("[data-cp]");if(!b)return;const el=$("acv"+b.dataset.cp);
  navigator.clipboard.writeText(el.textContent).then(()=>toast("Account number copied")).catch(()=>{const r=document.createRange();r.selectNodeContents(el);const s=getSelection();s.removeAllRanges();s.addRange(r);toast("Number selected. Copy it manually.")})});
const waLink=o=>"https://wa.me/"+intl(S.shop.wa)+"?text="+encodeURIComponent(typeof o==="string"?o:orderText(o));
/* "Place order" is a real link: the click handler checks the form, creates the order and points the link at the
   shop's WhatsApp chat before the browser follows it, so one tap places the order and opens the chat. */
$("confirmBtn").addEventListener("click",e=>{
  const err=check();if(err){e.preventDefault();setMsg("msg",err,true);return}setMsg("msg","");
  save("gd-cust",{fName:$("fName").value,fPhone:$("fPhone").value,fArea:$("fArea").value,fAddr:$("fAddr").value});
  ORDER=buildOrder();$("confirmBtn").href=waLink(ORDER);rememberOrder(ORDER);sendOrder(ORDER);showPay();
});
$("waBtn").addEventListener("click",()=>setMsg("msg2","Opening WhatsApp. If it does not open, copy the message and send it to "+S.shop.wa+"."));
$("copyBtn").onclick=()=>navigator.clipboard.writeText(orderText(ORDER)).then(()=>setMsg("msg2","Message copied. Paste it in a WhatsApp chat with "+S.shop.wa+"."))
  .catch(()=>{setMsg("msg2","Could not copy. Select the text below and copy it.",true);
    let ta=$("fallbackTxt");if(!ta){ta=document.createElement("textarea");ta.id="fallbackTxt";ta.rows=8;$("payStep").appendChild(ta)}ta.value=orderText(ORDER);ta.select()});
function backToCart(){$("cartTitle").textContent="Your cart";$("cartStep").hidden=false;$("cartTotals").hidden=false;$("payStep").hidden=true}
$("backBtn").onclick=backToCart;
$("newOrderBtn").onclick=()=>{cart={};addSel={};persist();ORDER=null;["fNote","fDate","fCard"].forEach(k=>$(k).value="");refreshProducts();backToCart();toast("Cart cleared")};

/* Saves the order for the shop. WhatsApp still opens either way, so a network problem never blocks the customer. */
function sendOrder(o){
  try{fetch(ORDER_API+"/order",{method:"POST",keepalive:true,headers:{"Content-Type":"application/json"},
    body:JSON.stringify({order:{...o,needTxt:fmtDate(o.need)}})}).catch(()=>{})}catch(e){}
}

/* ---------- my orders: orders placed from this device ---------- */
function rememberOrder(o){
  myOrders=[{no:o.no,phone:o.phone,at:Date.now(),items:o.items,tot:o.tot,adv:o.adv,pct:o.pct,cart:{...cart},text:orderText(o)},...myOrders.filter(x=>x.no!==o.no)].slice(0,20);
  save("gd-orders",myOrders);renderMyOrders();
}
let TRACK={};
async function trackOrders(){
  const q=myOrders.filter(o=>o.phone).map(o=>({no:o.no,phone:o.phone}));if(!q.length)return;
  try{const r=await fetch(ORDER_API+"/track",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({orders:q})});
    if(r.ok){TRACK=(await r.json()).orders||{};myOrders.forEach(o=>{if(!TRACK[o.no])TRACK[o.no]={status:"",label:"Not received yet. Please send the order on WhatsApp."}});renderMyOrders()}}catch(e){}
}
function renderMyOrders(){
  $("orderCount").textContent=myOrders.length;$("orderCount").hidden=!myOrders.length;
  $("ordersBody").innerHTML=myOrders.length?`<p class="note">Orders placed on this device. We confirm every order on WhatsApp.</p>`+myOrders.map((o,i)=>`<div class="myo">
      <div class="ohead"><span class="no">${esc(o.no)}</span><span class="sub">${new Date(o.at).toLocaleDateString("en-PK",{day:"numeric",month:"short",year:"numeric"})}</span></div>
      <ul>${(o.items||[]).map(it=>`<li>${esc(it.name)} × ${it.qty}</li>`).join("")}</ul>
      <div class="sub">Total <b>${rs(o.tot)}</b>${o.pct?` · Advance ${rs(o.adv)}`:""}</div>
      <div class="ostatus" data-s="${esc((TRACK[o.no]||{}).status||"")}">${TRACK[o.no]?"Status: <b>"+esc(TRACK[o.no].label)+"</b>":"Status: checking…"}</div>
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

$("trackForm").addEventListener("submit",async e=>{
  e.preventDefault();const no=$("tNo").value.trim().toUpperCase(),phone=$("tPhone").value.trim();
  if(!ORDER_NO_RE.test(no)){$("tResult").textContent="Enter the tracking ID from your order message, e.g. GA-261112-K7Q4.";return}
  if(phone.replace(/\D/g,"").length<10){$("tResult").textContent="Enter the phone number used for the order.";return}
  $("tResult").textContent="Checking…";
  try{const r=await fetch(ORDER_API+"/track",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({orders:[{no,phone}]})});
    const t=r.ok?((await r.json()).orders||{})[no]:null;
    $("tResult").innerHTML=t?`Order <b>${esc(no)}</b>: <b>${esc(t.label)}</b>`:"No order found with this tracking ID and phone number. If you have just placed it, please make sure the WhatsApp message was sent.";
  }catch(err){$("tResult").textContent="Could not check right now. Please try again."}
});

/* ---------- overlays ---------- */
let openPanel=null;
function show(panel){if(openPanel)openPanel.hidden=true;openPanel=panel;$("scrim").hidden=!panel;if(panel){panel.hidden=false;const c=panel.querySelector("[data-close]");if(c)c.focus()}}
$("openCart").onclick=()=>show($("drawer"));
$("cartFloat").onclick=()=>show($("drawer"));
$("openWish").onclick=()=>show($("wishDrawer"));
$("openOrders").onclick=()=>{show($("ordersDrawer"));trackOrders()};
$("openSearch").onclick=()=>{show(null);$("shop").scrollIntoView({behavior:"smooth"});setTimeout(()=>$("q").focus(),400)};
$("scrim").onclick=()=>show(null);
document.querySelectorAll("[data-close]").forEach(b=>b.onclick=()=>show(null));
document.addEventListener("keydown",e=>{if(e.key==="Escape")show(null)});

/* ---------- start: load the published shop data ---------- */
(async()=>{
  try{
    const r=await fetch("data/shop.json?v="+Date.now(),{cache:"no-store"});
    if(!r.ok)throw new Error(r.status);
    S=normalizeShop(await r.json());
  }catch(e){$("loader").hidden=true;$("loadErr").hidden=false;return}
  $("loader").hidden=true;$("app").hidden=false;
  renderAll();
  const tr=(location.hash.match(/^#track=([^&]+)/)||[])[1];
  if(tr){$("tNo").value=decodeURIComponent(tr).toUpperCase();try{$("tPhone").value=load("gd-cust",{}).fPhone||""}catch(e){}show($("ordersDrawer"));trackOrders();if($("tPhone").value)$("trackForm").requestSubmit();return}
  if(location.hash&&location.hash.length>1){const t=document.getElementById(location.hash.slice(1));if(t)t.scrollIntoView()}
})();
