const fs=require('fs'),assert=require('node:assert/strict'),{JSDOM}=require('jsdom');
const html=fs.readFileSync('tongan-research-database-master.html','utf8');
const script=fs.readFileSync('js/tongan-short-disciplines.js','utf8');
const model={generatedAt:'2026-09-24T00:00:00Z',rows:[{discipline:'Education',male:1,female:1,masters:2,phd:1,total:2}],overall:{male:1,female:1,masters:2,phd:1,total:2},allCompleted:3,allMasters:3};
for(const immediate of [false,true]){
 const dom=new JSDOM(html,{runScripts:'outside-only'}),w=dom.window;
 w.setTimeout=()=>0;
 const master={aggregates:{shortDisciplines:model}};
 if(immediate){w.__masterHydrated=true;w.__vavelabDbState={master};}
 w.eval(script);if(!immediate)w.dispatchEvent(new w.CustomEvent('vavelab:master-hydrated',{detail:{master}}));
 const root=w.document.querySelector('#graduate-disciplines'),table=root.querySelector('table');
 assert(root.matches('[data-panel=B4]'));assert.equal(w.document.querySelectorAll('[data-panel=B4]').length,1);
 assert(w.document.querySelector('[data-panel=B5] #db-map-b3'));
 assert.equal(root.querySelector('[aria-pressed=true]').textContent,'Gender');assert(table.tHead.textContent.includes('Female'));
 root.querySelector('[data-discipline-view=degree]').click();assert(table.tHead.textContent.includes('Completed PhD'));
 assert.equal(table.tFoot.rows[0].lastChild.textContent,'2');
 const before=table.outerHTML;w.dispatchEvent(new w.CustomEvent('vavelab:filters-changed'));assert.equal(table.outerHTML,before);
 w.dispatchEvent(new w.CustomEvent('vavelab:master-hydrated',{detail:{master:{}}}));
 assert(root.querySelector('[role=status]').textContent.includes('last loaded'));
 root.querySelector('[data-discipline-view=gender]').click();assert(root.querySelector('[role=status]').textContent.includes('last loaded'));
 const empty={...model,rows:[],overall:{male:0,female:0,masters:0,phd:0,total:0}};
 w.dispatchEvent(new w.CustomEvent('vavelab:master-hydrated',{detail:{master:{aggregates:{shortDisciplines:empty}}}}));
 assert(table.tBodies[0].textContent.includes('not yet recorded'));assert(table.tFoot.hidden);assert.equal(root.querySelector('[role=status]').textContent,'');
 dom.window.close();
}
console.log('PASS: Tonga B4 toggle, set totals, late/early hydration, independent filters, preserved stale warning, honest unclassified state and B5 map.');
