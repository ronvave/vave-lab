/* Read-only audit tab for the authenticated collaborator panel. */
(function(){
'use strict';
const tab=document.querySelector('[data-tab="master-change-log"]'),wrap=document.getElementById('review-log-entries'),status=document.getElementById('review-log-status'),refresh=document.getElementById('review-log-refresh');
let loaded=false,busy=false;
async function load(){if(busy)return;busy=true;refresh.disabled=true;status.textContent='Loading Master change log…';try{const out=await window.adminWriteback.readChangeLog(200);if(out.status!=='ok')throw Error(out.reason||out.error||'Change log unavailable');const scholars={};(out.rows||[]).forEach(r=>{if(r.scholarId&&r.scholarName)scholars[r.scholarId]={'Scholar Name':r.scholarName};});await window.TongaChangeLog.show({rows:out.rows,scholars,client:window.adminWriteback,wrap,status});loaded=true;}catch(e){status.textContent=e.message;}finally{busy=false;refresh.disabled=false;}}
tab.addEventListener('click',()=>{if(!loaded)load();});refresh.addEventListener('click',load);
})();
