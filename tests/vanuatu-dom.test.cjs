/* Simulated DOM integration. No rendered-browser/layout pass is claimed. */
const fs=require('node:fs'),assert=require('node:assert/strict');
const {JSDOM}=require(process.env.VANUATU_JSDOM_PATH||'jsdom');
const tick=()=>new Promise(resolve=>setTimeout(resolve,0));
function create(file,url,scripts){
 const dom=new JSDOM(fs.readFileSync(file,'utf8'),{url,runScripts:'outside-only'}),w=dom.window;
 w.HTMLElement.prototype.scrollIntoView=function(){};w.HTMLDialogElement.prototype.showModal=function(){this.open=true;};w.HTMLDialogElement.prototype.close=function(){this.open=false;};w.confirm=()=>true;w.fetch=async()=>({ok:false,status:404});
 for(const script of scripts)w.eval(fs.readFileSync('js/'+script+'.js','utf8'));
 return dom;
}
(async()=>{
 const scripts=['vanuatu-geography','vanuatu-model','vanuatu-dashboard-model','vanuatu-config','vanuatu-preview-data','vanuatu-database-adapter','vanuatu-database-master'];
 const dom=create('vanuatu-research-database-master.html','https://example.invalid/vanuatu-research-database-master.html?preview=1',scripts),w=dom.window,d=w.document;
 assert.equal(d.getElementById('dashboard').hidden,false);assert(d.getElementById('release-notice').textContent.includes('FICTIONAL'));assert.equal(d.querySelectorAll('.scholar').length,3);
 d.getElementById('province').value='Penama';d.getElementById('province').dispatchEvent(new w.Event('change'));assert.equal(d.querySelectorAll('.scholar').length,1);assert(d.querySelector('.scholar h3').textContent.includes('Example Scholar A'));
 d.getElementById('basis').value='paternal';d.getElementById('basis').dispatchEvent(new w.Event('change'));assert.equal(d.querySelectorAll('.scholar').length,0);
 d.getElementById('all-reset').click();assert.equal(d.querySelectorAll('.scholar').length,3);
 d.getElementById('study-country').value='New Zealand';d.getElementById('study-country').dispatchEvent(new w.Event('change'));assert.equal(d.querySelectorAll('.scholar').length,1);assert(d.getElementById('items').textContent.includes('community-led'));
 d.getElementById('all-reset').click();d.getElementById('pub-type').value='Report';d.getElementById('pub-type').dispatchEvent(new w.Event('change'));assert.equal(d.querySelectorAll('#items .item').length,1);assert(d.getElementById('items').textContent.includes('learning across'));
 d.querySelector('[data-expand="panel-b3"]').click();assert(d.getElementById('panel-b3').classList.contains('expanded'));d.querySelector('[data-expand="panel-b3"]').click();assert(!d.getElementById('panel-b3').classList.contains('expanded'));
 d.getElementById('lock').click();assert.equal(d.getElementById('access').hidden,false);assert.equal(d.querySelectorAll('.scholar').length,0);assert.equal(w.dbGate.isUnlocked(),false);
 dom.window.close();
 const shared=create('vanuatu-research-database-master.html','https://example.invalid/vanuatu-research-database-master.html?preview=1&scholar=VAN-S9001',scripts);assert.equal(shared.window.document.querySelectorAll('.scholar').length,1);assert.equal(shared.window.document.getElementById('panel-g').hidden,false);shared.window.close();
 const admin=create('admin-vanuatu-master.html','https://example.invalid/admin-vanuatu-master.html?preview=1',['vanuatu-geography','vanuatu-model','vanuatu-dashboard-model','vanuatu-config','vanuatu-preview-data','admin-vanuatu-master']);
 const ad=admin.window.document;assert.equal(ad.getElementById('admin-workspace').hidden,false);assert(ad.getElementById('admin-banner').textContent.includes('FICTIONAL'));ad.querySelector('[data-record]').click();assert(ad.getElementById('admin-editor').open);assert(ad.getElementById('editor-save').disabled);ad.getElementById('editor-close').click();
 ad.querySelector('[data-tab="degrees"]').click();assert(ad.getElementById('admin-table').textContent.includes('VAN-D9001'));ad.querySelector('[data-record]').click();assert.equal(ad.getElementById('editor-id').textContent,'VAN-D9001');assert(ad.getElementById('editor-save').disabled);admin.window.close();
 console.log('PASS: simulated DOM preview, linked filters, reset, expansion, lock, scoped profiles, Admin tables and read-only editing.');
})().catch(e=>{console.error(e);process.exitCode=1;});
