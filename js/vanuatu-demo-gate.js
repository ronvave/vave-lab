/* Vanuatu-only remembered viewing access. No credentials are embedded in source
 * or shared URLs; the public preview contains fictional records only. */
(function(w){
'use strict';
const B=w.VanuatuBundle,KEY='vavelab_vanuatu_view_password';
let started=false;
const forcedPreview=new URLSearchParams(location.search).get('preview')==='1';
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
 if(!B.isPreview()){const forget=document.createElement('button');forget.type='button';forget.textContent='Forget this device';forget.style.cssText='padding:10px 16px;border-radius:999px;border:1px solid #0F3921;background:white;color:#0F3921;cursor:pointer';forget.onclick=()=>{remember('');B.clear();location.reload();};wrap.append(forget);}
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
 const gate=document.createElement('section');gate.className='demo-gate-shell';gate.setAttribute('aria-label','Pre-launch access');gate.style.cssText='max-width:520px;padding:36px 32px;margin:48px auto;text-align:center;border:1px solid var(--color-border,#e2e0d4);border-radius:14px;background:var(--color-bg,#fff);box-shadow:0 20px 50px -22px rgba(15,57,33,.28)';
 gate.innerHTML='<h1 style="font-family:var(--font-display,Georgia)">Vanuatu Scholar Dashboard</h1><p>This dashboard has not yet launched.</p><p>Enter your owner or collaborator password to view it.</p><form><input aria-label="Vanuatu password" placeholder="Password" type="password" autocomplete="current-password" required style="max-width:100%;box-sizing:border-box;padding:12px;border:1px solid #c9c5b0;border-radius:9px"><button type="submit" class="btn btn--primary" style="margin:8px;padding:12px">View dashboard</button><label style="display:block;margin:12px"><input type="checkbox" data-remember checked> Remember access on this device</label></form><p role="status" data-gate-status></p>';
 main.append(gate);
 gate.querySelector('form').onsubmit=async e=>{e.preventDefault();const input=gate.querySelector('input[type=password]'),button=gate.querySelector('button[type=submit]');button.disabled=true;try{await B.load(input.value);remember(gate.querySelector('[data-remember]').checked?input.value:'');input.value='';finish();}catch(err){gate.querySelector('[data-gate-status]').textContent=err.message;button.disabled=false;}};
}
w.dbGate={boot,fetchJson:B.fetchJson,isUnlocked:()=>!!B.current(),tryUnlockFromStorage:restore,unlockEmbeddedRead:()=>{},getMode:()=>B.isPreview()?'preview':B.current()?'collaborator':'public',isDev:()=>false,isDemo:()=>B.isPreview()};w.demoGate=w.dbGate;
})(window);
