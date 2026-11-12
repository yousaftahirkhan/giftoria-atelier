/* Shared by the storefront and the super admin: catalogue lists, product drawings and formatting helpers. */
"use strict";
const $ = id => document.getElementById(id);

const CATS = [["bouquet","Bouquets"],["box","Flower boxes"],["choco","Chocolate bouquets"],["mini","Single stems"],["pots","Potted flowers"],["key","Keychains & charms"],["hair","Hair accessories"],["jewel","Gajray & jewellery"],["decor","Home & car decor"],["hamper","Gift hampers"]];
const CATN = Object.fromEntries(CATS);
const OCCS = [["birthday","Birthday"],["eid","Eid"],["shaadi","Weddings & mehndi"],["anniversary","Anniversary"],["graduation","Graduation"],["love","For someone special"]];
const OCCN = Object.fromEntries(OCCS);

/* Every section the shop data can hold, so a missing one never breaks a page. */
const SHOP_DEFAULTS = {shop:{name:"Shop",city:"",wa:"",delLocal:0,freeAbove:0,advancePct:50},reg:{},social:{},pay:{},slides:[],promo:{},about:{},policies:{},addons:[],reviews:[],gallery:[],products:[]};
function normalizeShop(S){
  S = S && typeof S === "object" ? S : {};
  for (const k in SHOP_DEFAULTS) if (S[k] == null) S[k] = JSON.parse(JSON.stringify(SHOP_DEFAULTS[k]));
  return S;
}

/* ---------- drawings (for anything without a photo) ---------- */
function shade(hex,amt){if(!/^#[0-9a-f]{6}$/i.test(hex))return hex;const n=parseInt(hex.slice(1),16);let r=(n>>16)+amt,g=((n>>8)&255)+amt,b=(n&255)+amt;
  r=Math.max(0,Math.min(255,r));g=Math.max(0,Math.min(255,g));b=Math.max(0,Math.min(255,b));return "#"+((1<<24)|(r<<16)|(g<<8)|b).toString(16).slice(1)}
function head(shape,x,y,s,c,center){
  const d=shade(c,-35);
  if(shape==="tulip")return `<g transform="translate(${x} ${y}) scale(${s})"><path d="M-11 -2 C-12 -16 -6 -22 -5 -22 L0 -12 L5 -22 C6 -22 12 -16 11 -2 C9 9 -9 9 -11 -2Z" fill="${c}" stroke="${d}" stroke-width="1.4"/><path d="M0 -12 L0 6" stroke="${d}" stroke-width="1.2"/></g>`;
  if(shape==="rose")return `<g transform="translate(${x} ${y}) scale(${s})"><circle r="12" fill="${c}"/><path d="M-8 0 A8 8 0 1 1 6 -5 M-4 1 A4.5 4.5 0 1 1 3 -2 M-1 0 A1.5 1.5 0 1 1 0 -1" fill="none" stroke="${d}" stroke-width="1.6" stroke-linecap="round"/></g>`;
  const n=shape==="sun"?14:9, pr=shape==="sun"?[5,11]:[4.5,10], cc=center||(shape==="sun"?"#6B3F1D":"#F7D154");
  let p="";for(let i=0;i<n;i++)p+=`<ellipse cx="0" cy="-${pr[1]}" rx="${pr[0]}" ry="${pr[1]}" transform="rotate(${i*360/n})" fill="${c}" stroke="${d}" stroke-width="1"/>`;
  return `<g transform="translate(${x} ${y}) scale(${s})">${p}<circle r="${shape==="sun"?7:5}" fill="${cc}"/></g>`;
}
const stem="var(--stem)";
function bouquetSVG(a){
  const n=a.colors.length, base={x:100,y:178};
  const pos=[];const rows=n<=1?[1]:n<=3?[n]:n<=5?[2,3]:n<=7?[3,4]:n<=9?[2,3,4]:[3,4,5];
  let k=0;rows.forEach((cnt,ri)=>{const y=40+ri*26+(rows.length===1?20:0);const w=(cnt-1)*30;for(let i=0;i<cnt&&k<n;i++,k++)pos.push({x:100-w/2+i*30+(ri%2?0:4),y})});
  let stems="",heads="";
  pos.forEach((p,i)=>{stems+=`<path d="M${p.x} ${p.y} Q${(p.x+base.x)/2} ${(p.y+base.y)/2+10} ${base.x+(i-n/2)*1.2} ${base.y}" stroke="${stem}" stroke-width="3" fill="none" stroke-linecap="round"/>`;
    const shape=a.shape==="mix"?["daisy","tulip","rose","sun"][i%4]:a.shape;heads+=head(shape,p.x,p.y,n===1?1.7:1,a.colors[i])});
  const leaf=n===1?`<path d="M100 130 C80 118 72 128 70 138 C84 140 94 136 100 130Z" fill="${stem}"/>`:"";
  const wrap=a.wrap?`<path d="M52 112 L148 112 L112 182 L88 182Z" fill="${a.wrap}" stroke="#D9C7CF" stroke-width="1.5"/><path d="M52 112 L88 182 M148 112 L112 182" stroke="#E6D6DD" stroke-width="1"/><path d="M90 150 C78 140 76 160 90 154 M110 150 C122 140 124 160 110 154" fill="none" stroke="#C2365F" stroke-width="3"/><circle cx="100" cy="152" r="4" fill="#C2365F"/>`:"";
  return `<svg viewBox="0 0 200 200" aria-hidden="true">${stems}${leaf}${wrap}${heads}</svg>`;
}
function keySVG(a){
  const ring=`<circle cx="100" cy="34" r="16" fill="none" stroke="#A9A2AD" stroke-width="4"/><path d="M100 50 L100 70" stroke="#A9A2AD" stroke-width="3" stroke-dasharray="4 3"/>`;
  if(a.kind==="keybouquet"){
    let s=`<path d="M92 120 L100 160 M100 120 L100 160 M108 120 L100 160" stroke="${stem}" stroke-width="3"/><path d="M86 138 L114 138 L106 164 L94 164Z" fill="#FFF4F7" stroke="#D9C7CF"/>`;
    s+=head("daisy",86,108,1,a.colors[0])+head("tulip",114,108,1,a.colors[2])+head("rose",100,92,1,a.colors[1]);
    return `<svg viewBox="0 0 200 200" aria-hidden="true">${ring}<path d="M100 70 L100 84" stroke="#A9A2AD" stroke-width="3"/>${s}</svg>`;
  }
  return `<svg viewBox="0 0 200 200" aria-hidden="true">${ring}${head(a.shape,100,112,2.4,a.colors[0],a.center)}</svg>`;
}
function boxSVG(a){
  let h="";const c=a.colors;for(let r=0;r<3;r++)for(let i=0;i<3;i++){const k=r*3+i;h+=head("rose",70+i*30,88+r*16-(r?0:4),1.05,c[k%c.length])}
  return `<svg viewBox="0 0 200 200" aria-hidden="true"><path d="M48 100 L152 100 L146 176 Q100 184 54 176Z" fill="${a.box||"#2B2B33"}"/><path d="M48 100 L152 100" stroke="#C99A2E" stroke-width="3"/>${h}<path d="M88 150 h24" stroke="#C99A2E" stroke-width="2"/></svg>`;
}
function gajraSVG(a){
  let h="";for(let i=0;i<14;i++){const t=i/14*Math.PI*2;h+=head("daisy",100+Math.cos(t)*58,100+Math.sin(t)*58,.75,a.colors[i%2],"#F5B823")}
  return `<svg viewBox="0 0 200 200" aria-hidden="true"><circle cx="100" cy="100" r="58" fill="none" stroke="${stem}" stroke-width="3"/>${h}<path d="M100 160 C92 176 84 182 80 190 M100 160 C108 176 116 182 120 190" stroke="#C2365F" stroke-width="3" fill="none"/></svg>`;
}
const DEFAULT_ART={bouquet:{kind:"bouquet",shape:"mix",colors:["#F7B5CD","#C7B2F0","#F9DD8C","#BFE3D0","#F28AB2"],wrap:"#FFFFFF"},
  box:{kind:"box",colors:["#F28AB2","#F7B5CD"],box:"#2B2B33"},key:{kind:"key",shape:"daisy",colors:["#F7B5CD"]},mini:{kind:"bouquet",shape:"tulip",colors:["#F28AB2"],wrap:null},
  hamper:{kind:"bouquet",shape:"daisy",colors:["#F9DD8C","#F28AB2","#A9D6F5"],wrap:"#FFF4F7"},jewel:{kind:"gajra",colors:["#FFFFFF","#F9DD8C"]},
  choco:{kind:"bouquet",shape:"mix",colors:["#F7B5CD","#C7B2F0","#FFFFFF","#F7B5CD"],wrap:"#FBE3EC"},pots:{kind:"bouquet",shape:"tulip",colors:["#F28AB2","#F7B5CD","#F9C59A"],wrap:"#FFFFFF"},
  hair:{kind:"key",shape:"daisy",colors:["#F7B5CD"]},decor:{kind:"gajra",colors:["#FFFFFF","#F28AB2"]}};
function drawArt(a){a=a||DEFAULT_ART.bouquet;return a.kind==="box"?boxSVG(a):a.kind==="gajra"?gajraSVG(a):a.kind==="bouquet"?bouquetSVG(a):keySVG(a)}
const LOGO=`<svg viewBox="-20 -30 40 40" aria-hidden="true"><path d="M-17 8 L-17 -10 A17 17 0 0 1 17 -10 L17 8Z" fill="var(--emerald)"/>${head("tulip",0,-2,.95,"#F7B5CD")}</svg>`;

/* ---------- formatting ---------- */
const esc=s=>String(s==null?"":s).replace(/[&<>"']/g,c=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c]));
/* Photos are stored as paths inside the site (images/...). Pages in a sub-folder set data-base="../" on <html>.
   The admin keeps photos chosen but not yet published in PENDING_PHOTOS (path -> data URL). */
const ASSET_BASE=document.documentElement.dataset.base||"";
const PENDING_PHOTOS=new Map();
const photoSrc=ph=>!ph?"":/^(data:|https?:|blob:)/i.test(ph)?ph:PENDING_PHOTOS.has(ph)?PENDING_PHOTOS.get(ph):ASSET_BASE+ph;
const visual=(p,alt)=>p.photo?`<img src="${esc(photoSrc(p.photo))}" alt="${esc(alt==null?p.name:alt)}" loading="lazy">`:drawArt(p.art||DEFAULT_ART[p.cat]);
const rs=n=>"Rs "+(Math.round(Number(n))||0).toLocaleString("en-PK");
const num=s=>Number(String(s||"").replace(/[^\d]/g,""))||0;
const intl=p=>{let d=String(p||"").replace(/\D/g,"");if(d.startsWith("0"))d="92"+d.slice(1);return d};
const fmtDate=s=>{if(!s)return "";const d=new Date(s+"T00:00:00");return isNaN(d)?s:d.toLocaleDateString("en-PK",{day:"numeric",month:"short",year:"numeric"})};
const safeUrl=u=>/^https?:\/\//i.test(u||"")?u:"";
let toastTimer;function toast(t){const el=$("toast");el.textContent=t;el.hidden=false;clearTimeout(toastTimer);toastTimer=setTimeout(()=>el.hidden=true,2600)}

/* Delivery areas offered at checkout. The owner can change the list in the admin (Business info). */
const DEFAULT_AREAS=["Abdali Road", "Bahadurpur", "Bohar Gate", "Bosan Road", "Buch Executive Villas", "BZU / Zakariya Town", "Cantt", "Chowk Kumharan", "Chowk Shaheedan", "Chungi No. 9", "Citi Housing", "Daulat Gate", "Delhi Gate", "Dera Adda", "DHA Multan", "Double Phatak", "Fatima Jinnah Town", "Garden Town", "Ghanta Ghar", "Gulgasht Colony", "Haram Gate", "Hassan Parwana Colony", "Hussain Agahi", "Katchery Road", "Khanewal Road", "Kotla Tolay Khan", "LMQ Road", "Lohari Gate", "Masoom Shah Road", "Mattital Road", "MDA Chowk", "Model Town", "Mumtazabad", "Naqshband Colony", "Nawan Shehar", "New Multan", "Nishtar Road", "Northern Bypass", "Officers Colony", "Old Shujabad Road", "Pak Gate", "Peer Khurshid Colony", "Qadirpur Raan", "Qasim Bela", "Rashidabad", "Royal Orchard", "Sameejabad", "Shah Rukn-e-Alam Colony", "Shah Shams Colony", "Shalimar Colony", "Sher Shah Road", "Shujabad Road", "Suraj Miani", "Vehari Road", "Wapda Town"];
const shopAreas=S=>Array.isArray(S.shop.areas)&&S.shop.areas.length?S.shop.areas:DEFAULT_AREAS;

/* Payment accounts the owner lists in the admin (Payment & delivery). Rows without a number are not shown. */
const PAY_METHODS=["JazzCash","Easypaisa","MCB Bank","Meezan Bank","HBL","UBL","Bank Alfalah","Allied Bank","Bank Al Habib","Other bank"];
function payAccounts(S){const p=S.pay||{};
  if(Array.isArray(p.accounts))return p.accounts.filter(a=>a&&String(a.number||"").trim()).map(a=>({k:a.method||"Bank transfer",v:String(a.number).trim(),who:String(a.title||"").trim()}));
  const a=[];if(p.jazz)a.push({k:"JazzCash",v:p.jazz,who:p.jazzName});if(p.easy)a.push({k:"Easypaisa",v:p.easy,who:p.easyName});
  if(p.iban)a.push({k:p.bank||"Bank transfer",v:p.iban,who:p.bankName});return a}

/* Order IDs look like GA-261112-K7Q4: shop initials, order date (YYMMDD) and four random characters
   without look-alikes (no O/0, I/1, L), so customers can read them out on a call. */
function makeOrderNo(shopName){
  const ini=(shopName||"").split(/\s+/).map(w=>w[0]||"").join("").replace(/[^A-Za-z]/g,"").slice(0,3).toUpperCase()||"OR";
  const d=new Date(),p=n=>String(n).padStart(2,"0");
  const A="23456789ABCDEFGHJKMNPQRSTUVWXYZ",r=crypto.getRandomValues(new Uint8Array(4));
  return `${ini}-${String(d.getFullYear()).slice(2)}${p(d.getMonth()+1)}${p(d.getDate())}-${Array.from(r,b=>A[b%A.length]).join("")}`;
}
