/* Vanuatu-only remembered viewing access. No credentials are embedded in source
 * or shared URLs; the public preview contains fictional records only. */
(function(w){
'use strict';
const B=w.VanuatuBundle,KEY='vavelab_vanuatu_view_password';
let started=false;
const forcedPreview=new URLSearchParams(location.search).get('preview')==='1';
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
function controls(){
 if(document.getElementById('vanuatu-view-controls'))return;
 const wrap=document.createElement('div');wrap.id='vanuatu-view-controls';
 wrap.style.cssText='position:fixed;bottom:16px;right:16px;z-index:9999;display:flex;gap:8px;font:14px system-ui';
 const share=document.createElement('button');share.type='button';share.textContent='Share demo view';share.style.cssText='padding:10px 16px;border-radius:999px;border:0;background:#0F3921;color:white;font-weight:600;cursor:pointer';
 share.onclick=async()=>{const url=new URL(location.pathname,location.origin);url.searchParams.set('preview','1');try{await navigator.clipboard.writeText(url.href);share.textContent='Demo link copied';setTimeout(()=>share.textContent='Share demo view',2500);}catch{w.prompt('Copy this public demo link:',url.href);}};
 wrap.append(share);
 document.body.append(wrap);
}
function notice(){
 if(!B.isPreview())return;
 const n=document.createElement('aside');n.id='vanuatu-preview-notice';n.style.cssText='padding:16px 20px;margin:16px 0;background:#fff4d9;border:1px solid #c8a84b;border-radius:8px;color:#062f35;font:14px/1.6 system-ui';
 n.innerHTML='<strong>Vanuatu Scholar Dashboard — pre-launch demo</strong><br>This dashboard has not yet launched. These fictional example records show the layout, not the Vanuatu database. Have an owner or collaborator password? <a href="vanuatu-research-database-master.html">Enter your password to view the dashboard</a>.';
 document.querySelector('main')?.prepend(n);
}
async function boot(cb){
 if(started)return;started=true;
 const main=document.querySelector('main');if(!main)return;
 const children=[...main.children];children.forEach(x=>x.hidden=true);
 const finish=()=>{main.querySelector('.demo-gate-shell')?.remove();children.forEach(x=>x.hidden=false);notice();controls();cb();};
 if(forcedPreview){B.preview();finish();return;}
 if(B.current()||await restore()){finish();return;}
 injectShellStyles();
 const wrap=document.createElement('div');wrap.innerHTML=buildShellHtml('');const gate=wrap.firstElementChild;

 main.append(gate);gate.querySelector('input').focus();
 gate.querySelector('form').onsubmit=async e=>{e.preventDefault();const input=gate.querySelector('input[type=password]'),button=gate.querySelector('button[type=submit]');button.disabled=true;try{await B.load(input.value);remember(input.value);input.value='';finish();}catch(err){gate.querySelector('[data-collaborator-error]').textContent=err.message;button.disabled=false;}};
}
w.dbGate={boot,fetchJson:B.fetchJson,isUnlocked:()=>!!B.current(),tryUnlockFromStorage:restore,unlockEmbeddedRead:()=>{},getMode:()=>B.isPreview()?'preview':B.current()?'collaborator':'public',isDev:()=>false,isDemo:()=>B.isPreview()};w.demoGate=w.dbGate;
})(window);
