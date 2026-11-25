/* Vanuatu dashboard access, matching the Fiji/Tonga demo-gate behaviour.
 *
 *   1. Dev device: localStorage.vavelab_dev = '1' opens the dashboard and
 *      shows "Share demo view". Ron marks a device by entering the owner or
 *      collaborator password at the Admin prompt (Ctrl+Alt+D, Alt+Shift+A,
 *      or triple-click the padlock), or by visiting with ?dev=1.
 *   2. Demo link: "Share demo view" mints a signed 2-hour #demo= token.
 *      "End demo" (revealed with the Admin prompt) revokes it through
 *      data/vanuatu-revoked-demos.json, using the GitHub token saved in Admin.
 *   3. Collaborator password: unchanged; it opens the encrypted snapshots.
 *   4. #view= viewer links and ?preview=1 sample previews still work.
 *
 * Trade-off (approved by Ron, 2026-11-25): like the other country
 * dashboards, the key for data/vanuatu-embedded.viewer.enc and the demo
 * signing key are embedded below, so a determined viewer with devtools can
 * recover the data. That copy is rebuilt by .github/workflows/
 * regional-viewer-link.yml (scripts/regional_viewer_access.py). The real
 * Vanuatu passwords are still never embedded. Admin pages keep the old
 * password-only behaviour. */
(function(w){
'use strict';
const B=w.VanuatuBundle,KEY='vavelab_vanuatu_view_password';
let started=false;
const forcedPreview=new URLSearchParams(location.search).get('preview')==='1';
const isAdminPage=/\/admin-/.test(location.pathname);
const DEMO_TTL_MS=2*60*60*1000,DEV_FLAG_KEY='vavelab_dev',GH_TOKEN_KEY='vavelab_gh_token';
const REVOKE_PATH='data/vanuatu-revoked-demos.json',EMBED_PATH='data/vanuatu-embedded.viewer.enc';
const EMBED_KEY=atob('NW9OdlNIcVdQRzgxQmdpSkJ2eVMxenRXZEJNSmNaeV8yeUdfVUtqQ1E1dw==');
const DEMO_SIGN_KEY_B64='icRux1bvBmPTsJJkXNYQmnxGrO9rP8jfzFeRlCF0NIU=';
let mode='public',activeToken=null;
  function injectShellStyles() {
    if (document.getElementById('demo-gate-styles')) return;
    var css = ''
      + '.demo-gate-shell{min-height:calc(100vh - 120px);display:flex;align-items:center;justify-content:center;padding:48px 24px;background:linear-gradient(180deg,#f8f5f0 0%,#efe8dc 60%,#e8ded0 100%);}'
      + '.demo-gate-shell__panel{width:100%;max-width:520px;background:#fff;border:1px solid rgba(15,57,33,0.12);border-radius:14px;padding:36px 32px 30px;box-shadow:0 20px 50px -22px rgba(15,57,33,0.28),0 6px 16px -8px rgba(15,57,33,0.14);text-align:center;}'
      + '.demo-gate-shell__badge{display:inline-flex;align-items:center;justify-content:center;width:52px;height:52px;border-radius:14px;background:rgba(14,116,144,0.10);color:#0F3921;margin:0 auto 18px;}'
      + '.demo-gate-shell__title{font-family:"Cormorant Garamond",Georgia,serif;font-weight:600;font-size:1.9rem;line-height:1.15;margin:0 0 12px;color:#0F3921;letter-spacing:-0.01em;}'
      + '.demo-gate-shell__body{margin:0 0 8px;color:#28251d;font-size:1rem;line-height:1.6;}'
      + '.demo-gate-shell__foot{margin:22px 0 0;color:#7a8880;font-size:0.85rem;}'
      + '.demo-gate-shell__foot a{color:#0E7490;text-decoration:underline;text-underline-offset:3px;}'
      + '.demo-gate-shell__reason{margin:14px 0 0;padding:10px 14px;background:#fdf1e6;color:#8B3A0F;border-radius:8px;font-size:0.9rem;text-align:left;}'
      + '.demo-gate-shell__form{display:flex;gap:10px;margin:20px auto 4px;max-width:390px;}'
      + '.demo-gate-shell__input{min-width:0;flex:1;padding:12px 14px;border:1px solid rgba(15,57,33,.28);border-radius:9px;background:#fff;color:#172019;font:inherit;}'
      + '.demo-gate-shell__input:focus{outline:3px solid rgba(14,116,144,.18);border-color:#0E7490;}'
      + '.demo-gate-shell__submit{padding:12px 18px;border:0;border-radius:9px;background:#0F3921;color:#fff;font:inherit;font-weight:700;cursor:pointer;}'
      + '.demo-gate-shell__submit:hover{background:#12442a;}'
      + '.demo-gate-shell__error{min-height:1.4em;margin:8px 0 0;color:#8B3A0F;font-size:.9rem;}'
      + 'body.demo-gate-locked main > *:not(.demo-gate-shell){display:none !important;}'
      // Demo controls (Share demo view / End demo / countdown).
      + '.demo-gate-controls{position:fixed;bottom:16px;right:16px;display:flex;flex-direction:row;align-items:stretch;gap:8px;z-index:9999;font-family:"DM Sans",system-ui,sans-serif;}'
      + '.demo-gate-controls button{padding:10px 16px;font-size:0.85rem;font-weight:600;border-radius:999px;border:1px solid rgba(15,57,33,0.20);background:#fff;color:#0F3921;cursor:pointer;box-shadow:0 6px 16px -8px rgba(15,57,33,0.20);transition:background 0.15s ease,transform 0.05s ease;}'
      + '.demo-gate-controls button:hover{background:#f5efe4;}'
      + '.demo-gate-controls button:active{transform:translateY(1px);}'
      + '.demo-gate-controls button.is-primary{background:#0F3921;color:#fff;border-color:#0F3921;}'
      + '.demo-gate-controls button.is-primary:hover{background:#12442a;}'
      + '.demo-gate-controls button.is-danger{background:#8B3A0F;color:#fff;border-color:#8B3A0F;}'
      + '.demo-gate-controls button.is-danger:hover{background:#6E2E0B;}'
      + '.demo-gate-controls__timer{display:inline-flex;align-items:center;padding:10px 14px;font-size:0.82rem;font-weight:600;color:#0F3921;background:#fff;border:1px solid rgba(15,57,33,0.20);border-radius:999px;box-shadow:0 6px 16px -8px rgba(15,57,33,0.20);font-variant-numeric:tabular-nums;}'
      + '.demo-gate-toast{position:fixed;bottom:70px;right:16px;padding:10px 14px;background:#0F3921;color:#fff;border-radius:8px;font-family:"DM Sans",system-ui,sans-serif;font-size:0.88rem;font-weight:500;box-shadow:0 8px 20px -8px rgba(15,57,33,0.35);z-index:9999;max-width:320px;line-height:1.4;}'
      + '.demo-gate-toast--error{background:#8B3A0F;}';
    var style = document.createElement('style');
    style.id = 'demo-gate-styles';
    style.textContent = css;
    document.head.appendChild(style);
  }

  function buildShellHtml(reason) {
    var reasonBlock = reason ? '<p class="demo-gate-shell__reason">' + reason + '</p>' : '';
    return ''
      + '<section class="demo-gate-shell" role="region" aria-label="Preview access">'
      +   '<div class="demo-gate-shell__panel">'
      +     '<div class="demo-gate-shell__badge" aria-hidden="true">'
      +       '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" width="28" height="28"><rect x="4" y="10" width="16" height="10" rx="2"/><path d="M8 10V7a4 4 0 0 1 8 0v3"/></svg>'
      +     '</div>'
      +     '<h1 class="demo-gate-shell__title">Vanuatu Scholar Dashboard</h1>'
      +     '<p class="demo-gate-shell__body">Enter the collaborator password to view the dashboard.</p>'
      +     reasonBlock
      +     '<form class="demo-gate-shell__form" data-collaborator-form>'
      +       '<input class="demo-gate-shell__input" data-collaborator-password type="password" autocomplete="current-password" placeholder="Password" aria-label="Collaborator password" required>'
      +       '<button class="demo-gate-shell__submit" type="submit">View dashboard</button>'
      +     '</form>'
      +     '<p class="demo-gate-shell__error" data-collaborator-error role="alert" aria-live="polite"></p>'
      +     '<p class="demo-gate-shell__foot">Curated by <a href="https://ronvave.github.io/vave-lab/" target="_blank" rel="noopener">Prof. Ron Vave</a> \u00b7 University of Hawai\u02bbi at M\u0101noa</p>'
      +   '</div>'
      + '</section>';
  }


function saved(){try{return localStorage.getItem(KEY)||'';}catch{return '';}}
function remember(value){try{value?localStorage.setItem(KEY,value):localStorage.removeItem(KEY);}catch{}}
async function restore(){const value=saved();if(!value||forcedPreview)return false;try{await B.load(value);return true;}catch{remember('');return false;}}

// ── Helpers ──────────────────────────────────────────────────────────
const enc=new TextEncoder(),dec=new TextDecoder();
const b64uEncode=b=>{let s='';b.forEach(x=>s+=String.fromCharCode(x));return btoa(s).replace(/\+/g,'-').replace(/\//g,'_').replace(/=+$/,'');};
const b64uDecode=t=>{t=t.replace(/-/g,'+').replace(/_/g,'/');while(t.length%4)t+='=';return Uint8Array.from(atob(t),c=>c.charCodeAt(0));};
const randomHex=n=>Array.from(crypto.getRandomValues(new Uint8Array(n)),x=>x.toString(16).padStart(2,'0')).join('');
async function openSealed(bytes,secret){
 const a=new Uint8Array(bytes);if(dec.decode(a.slice(0,4))!=='IVAV')throw Error('format');
 const seed=await crypto.subtle.importKey('raw',enc.encode(secret),'PBKDF2',false,['deriveKey']);
 const key=await crypto.subtle.deriveKey({name:'PBKDF2',salt:a.slice(4,20),iterations:200000,hash:'SHA-256'},seed,{name:'AES-GCM',length:256},false,['decrypt']);
 return JSON.parse(dec.decode(await crypto.subtle.decrypt({name:'AES-GCM',iv:a.slice(20,32)},key,a.slice(32))));
}
// Unlock with the copy whose key is embedded above (dev device / demo link).
async function loadEmbedded(){
 const r=await fetch(EMBED_PATH+'?t='+Date.now(),{cache:'no-store'});
 if(!r.ok)throw Error('The Vanuatu demo copy is not available yet.');
 B.use(await openSealed(await r.arrayBuffer(),EMBED_KEY));
}
let signKey=null;
async function getSignKey(){return signKey||(signKey=await crypto.subtle.importKey('raw',Uint8Array.from(atob(DEMO_SIGN_KEY_B64),c=>c.charCodeAt(0)),{name:'HMAC',hash:'SHA-256'},false,['sign','verify']));}
async function mintToken(){const now=Date.now(),payload={v:1,iss:now,exp:now+DEMO_TTL_MS,jti:randomHex(8)},pb=enc.encode(JSON.stringify(payload));const sig=new Uint8Array(await crypto.subtle.sign('HMAC',await getSignKey(),pb));return {payload,raw:b64uEncode(pb)+'.'+b64uEncode(sig)};}
async function verifyToken(raw){try{const [p,g]=raw.split('.');if(!p||!g)return null;const pb=b64uDecode(p);if(!await crypto.subtle.verify('HMAC',await getSignKey(),b64uDecode(g),pb))return null;const payload=JSON.parse(dec.decode(pb));return payload&&payload.v===1&&typeof payload.exp==='number'?{payload,raw}:null;}catch{return null;}}
async function revoked(jti){try{const r=await fetch(REVOKE_PATH+'?t='+Date.now(),{cache:'no-store'});if(!r.ok)return false;const d=await r.json();return Array.isArray(d.jtis)&&d.jtis.includes(jti);}catch{return false;}}
function hashParts(){return (location.hash||'').replace(/^#/,'').split('&').filter(Boolean);}
function readToken(){const p=hashParts().find(kv=>kv.indexOf('demo=')===0);return p?decodeURIComponent(p.slice(5)):null;}
function setToken(raw){const parts=hashParts().filter(kv=>kv.indexOf('demo=')!==0);if(raw)parts.unshift('demo='+encodeURIComponent(raw));history.replaceState(null,'',location.pathname+location.search+(parts.length?'#'+parts.join('&'):''));}
function isDev(){try{return localStorage.getItem(DEV_FLAG_KEY)==='1';}catch{return false;}}
function setDev(on){try{on?localStorage.setItem(DEV_FLAG_KEY,'1'):localStorage.removeItem(DEV_FLAG_KEY);}catch{}}
function handleDevOptIn(){const q=new URLSearchParams(location.search),v=q.get('dev');if(v!=='1'&&v!=='0')return;setDev(v==='1');q.delete('dev');const qs=q.toString();history.replaceState(null,'',location.pathname+(qs?'?'+qs:'')+location.hash);}
function toast(msg,isError){injectShellStyles();const el=document.createElement('div');el.className='demo-gate-toast'+(isError?' demo-gate-toast--error':'');el.textContent=msg;document.body.appendChild(el);setTimeout(()=>{el.style.transition='opacity .3s ease';el.style.opacity='0';setTimeout(()=>el.remove(),350);},isError?4500:2500);}

// ── Controls (Share demo view / End demo / countdown) ────────────────
function shareControls(){
 injectShellStyles();
 if(document.getElementById('demo-gate-controls')||readToken())return;
 const wrap=document.createElement('div');wrap.id='demo-gate-controls';wrap.className='demo-gate-controls';
 wrap.innerHTML='<button type="button" class="is-primary" data-demo-share title="Generate a 2-hour demo URL and copy it to clipboard">Share demo view</button>';
 document.body.appendChild(wrap);
 wrap.querySelector('button').addEventListener('click',async()=>{
  wrap.style.display='none';
  try{const t=await mintToken();setToken(t.raw);const url=location.origin+location.pathname+location.search+location.hash;
   try{await navigator.clipboard.writeText(url);toast('URL copied to clipboard.');}catch{toast('URL is in the address bar (clipboard copy blocked).');}
   setTimeout(()=>location.reload(),600);
  }catch(e){wrap.style.display='';toast('Could not create URL: '+e.message,true);}
 });
}
let countdown=null;
function fmt(ms){const t=Math.max(0,Math.floor(ms/1000)),h=Math.floor(t/3600),m=Math.floor(t%3600/60),s=t%60;return h?h+'h '+String(m).padStart(2,'0')+'m':m+':'+String(s).padStart(2,'0');}
function startCountdown(){
 clearInterval(countdown);if(!activeToken)return;
 const tick=()=>{const left=activeToken.payload.exp-Date.now(),el=document.querySelector('[data-demo-timer]');
  if(left<=0){if(el)el.textContent='Demo expired';clearInterval(countdown);setTimeout(()=>location.reload(),1200);return;}
  if(el)el.textContent='Demo \u00b7 '+fmt(left);};
 tick();countdown=setInterval(tick,1000);
}
async function endControls(){
 if(document.getElementById('demo-gate-controls')?.querySelector('[data-demo-end]'))return;
 document.getElementById('demo-gate-controls')?.remove();
 if(!activeToken){const raw=readToken();activeToken=raw&&await verifyToken(raw);if(!activeToken){toast('Token in URL is not valid.',true);return;}}
 injectShellStyles();
 const wrap=document.createElement('div');wrap.id='demo-gate-controls';wrap.className='demo-gate-controls';
 wrap.innerHTML='<span class="demo-gate-controls__timer" data-demo-timer></span><button type="button" class="is-danger" data-demo-end title="End the demo and revoke the URL for everyone">End demo</button>';
 document.body.appendChild(wrap);
 const btn=wrap.querySelector('[data-demo-end]');
 btn.addEventListener('click',async()=>{btn.disabled=true;btn.textContent='Ending\u2026';
  try{await revoke(activeToken.payload.jti);toast('Demo ended. This URL will no longer work.');setToken(null);setTimeout(()=>location.reload(),900);}
  catch(e){btn.disabled=false;btn.textContent='End demo';toast('Could not revoke: '+e.message,true);}});
 startCountdown();
}
async function revoke(jti){
 const token=localStorage.getItem(GH_TOKEN_KEY);if(!token)throw Error('No GitHub token stored. Save one in the Admin page first.');
 const api='https://api.github.com/repos/ronvave/vave-lab/contents/'+REVOKE_PATH,h={Authorization:'Bearer '+token,Accept:'application/vnd.github+json'};
 let sha=null,content={jtis:[]};const g=await fetch(api,{headers:h});
 if(g.ok){const d=await g.json();sha=d.sha;try{content=JSON.parse(atob(d.content.replace(/\n/g,'')));}catch{}}else if(g.status!==404)throw Error('GitHub fetch failed: '+g.status);
 if(!Array.isArray(content.jtis))content.jtis=[];if(!content.jtis.includes(jti))content.jtis.push(jti);content.updatedAt=new Date().toISOString();
 const body={message:'demo: revoke Vanuatu token '+jti,content:btoa(JSON.stringify(content,null,2))};if(sha)body.sha=sha;
 const p=await fetch(api,{method:'PUT',headers:{...h,'Content-Type':'application/json'},body:JSON.stringify(body)});
 if(!p.ok)throw Error('GitHub PUT failed: '+p.status);
}
// Admin prompt: the owner or collaborator password marks this device as
// Ron's dev device (or reveals End demo during a live demo link).
async function adminPrompt(){
 const entered=w.prompt('Admin passcode:');if(entered===null)return;
 const before=B.current();
 try{await B.load(entered);}catch{if(before)B.use(before);toast('Wrong passcode.',true);return;}
 if(before)B.use(before);
 if(readToken()){await endControls();toast('End-demo controls revealed.');return;}
 remember(entered);setDev(true);location.replace(location.pathname+location.hash);
}
let keysWired=false;
function wireAdminKeys(){
 if(keysWired||isAdminPage)return;keysWired=true;
 document.addEventListener('keydown',e=>{const k=e.key==='D'||e.key==='d'||e.code==='KeyD',a=e.key==='A'||e.key==='a'||e.code==='KeyA';
  if((e.ctrlKey&&e.altKey&&!e.shiftKey&&!e.metaKey&&k)||(e.altKey&&e.shiftKey&&!e.ctrlKey&&!e.metaKey&&a)){e.preventDefault();adminPrompt();}});
}
function wireBadge(gate){
 if(isAdminPage)return;const badge=gate.querySelector('.demo-gate-shell__badge');if(!badge)return;
 let clicks=0,t=null;badge.addEventListener('click',()=>{clicks++;clearTimeout(t);t=setTimeout(()=>clicks=0,900);if(clicks>=3){clicks=0;adminPrompt();}});
}
function controls(){if(!isAdminPage&&mode==='dev')shareControls();}
function notice(){
 if(!B.isPreview())return;
 const n=document.createElement('aside');n.id='vanuatu-preview-notice';n.style.cssText='padding:16px 20px;margin:16px 0;background:#fff4d9;border:1px solid #c8a84b;border-radius:8px;color:#062f35;font:14px/1.6 system-ui';
 n.innerHTML='<strong>Vanuatu Scholar Dashboard — pre-launch demo</strong><br>This dashboard has not yet launched. These fictional example records show the layout, not the Vanuatu database. Have an owner or collaborator password? <a href="vanuatu-research-database-master.html">Enter your password to view the dashboard</a>.';
 document.querySelector('main')?.prepend(n);
}
// Time-limited viewer link (#view=<key>): opens a separate viewer copy of the
// approved viewing data, encrypted with a viewer-only key. GitHub deletes the
// copy when the link expires. Returns true when unlocked, a message when the
// link no longer works, or ''.
async function viewerLink(){
 const m=/(?:^|[#&])view=([A-Za-z0-9_-]{24,})/.exec(location.hash);if(!m)return '';
 try{
  const meta=await fetch('data/vanuatu-viewer-access.json?t='+Date.now(),{cache:'no-store'}).then(r=>r.ok?r.json():null);
  if(!meta)return 'This viewer link has ended. Please ask for a new link.';
  if(Date.now()>=meta.expiresMs)return 'This viewer link has expired. Please ask for a new link.';
  const r=await fetch('data/vanuatu-collaborator-bundle.viewer.enc?t='+Date.now(),{cache:'no-store'});
  if(!r.ok)return 'This viewer link has ended. Please ask for a new link.';
  B.use(await openSealed(await r.arrayBuffer(),m[1]));
  return true;
 }catch{return 'This viewer link is not valid.';}
}
// Demo link (#demo=<token>): true when unlocked, a message when not, or ''.
async function demoLink(){
 const raw=readToken();if(!raw)return '';
 const t=await verifyToken(raw);
 if(!t)return 'This demo link is not valid.';
 if(t.payload.exp<Date.now())return 'This demo link has expired.';
 if(await revoked(t.payload.jti))return 'This demo link has ended.';
 try{await loadEmbedded();}catch(e){return e.message;}
 activeToken=t;mode='demo';startCountdown();return true;
}
async function boot(cb){
 if(started)return;started=true;
 const main=document.querySelector('main');if(!main)return;
 const children=[...main.children];children.forEach(x=>x.hidden=true);
 const finish=()=>{main.querySelector('.demo-gate-shell')?.remove();document.body.classList.remove('demo-gate-locked');children.forEach(x=>x.hidden=false);notice();controls();cb();};
 if(!isAdminPage){handleDevOptIn();wireAdminKeys();}
 if(forcedPreview){B.preview();mode='preview';finish();return;}
 const viewer=await viewerLink();
 if(viewer===true){mode='viewer';finish();return;}
 if(!isAdminPage&&isDev()){
  try{if(!B.current()&&!await restore())await loadEmbedded();mode='dev';finish();return;}catch{}
 }
 const demo=isAdminPage?'':await demoLink();
 if(demo===true){finish();return;}
 if(B.current()||await restore()){mode='collaborator';finish();return;}
 injectShellStyles();
 const wrap=document.createElement('div');wrap.innerHTML=buildShellHtml(viewer||demo||'');const gate=wrap.firstElementChild;
 main.append(gate);gate.querySelector('input').focus();wireBadge(gate);
 gate.querySelector('form').onsubmit=async e=>{e.preventDefault();const input=gate.querySelector('input[type=password]'),button=gate.querySelector('button[type=submit]');button.disabled=true;try{await B.load(input.value);remember(input.value);input.value='';mode='collaborator';finish();}catch(err){gate.querySelector('[data-collaborator-error]').textContent=err.message;button.disabled=false;}};
}
w.dbGate={boot,fetchJson:B.fetchJson,isUnlocked:()=>!!B.current(),tryUnlockFromStorage:restore,unlockEmbeddedRead:()=>{},getMode:()=>B.isPreview()?'preview':mode,isDev:()=>mode==='dev',isDemo:()=>mode==='demo'||B.isPreview()};w.demoGate=w.dbGate;
})(window);
