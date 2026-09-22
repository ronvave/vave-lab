/* Run with jsdom available (NODE_PATH may point to its installation). */
const {JSDOM}=require('jsdom');const fs=require('fs');const assert=require('node:assert/strict');
const html=fs.readFileSync('itaukei-research-database-master.html','utf8');
const panel=html.match(/<section[^>]+id="graduate-disciplines"[\s\S]*?<\/section>/)[0];
const dom=new JSDOM(panel,{runScripts:'outside-only'});const w=dom.window,d=w.document;
w.eval(fs.readFileSync('js/itaukei-short-disciplines.js','utf8'));
const model={version:1,generatedAt:'2026-09-22T00:00:00Z',rows:[{discipline:'Social sciences',male:1,female:1,masters:2,phd:1,total:2}],overall:{male:1,female:1,masters:2,phd:1,total:2},allCompleted:3,allMasters:3};
const hydrate=m=>w.dispatchEvent(new w.CustomEvent('vavelab:master-hydrated',{detail:{master:{aggregates:{shortDisciplines:m}}}}));
hydrate(model);assert.equal(d.querySelectorAll('tbody tr').length,1);assert.equal(d.querySelector('table').hidden,false);assert.match(d.querySelector('#short-disciplines-caption').textContent,/2 of the 3 unique scholars/);
d.querySelector('[data-discipline-view="degree"]').click();assert.match(d.querySelector('thead').textContent,/Completed Master’sCompleted PhD/);assert.equal(d.querySelector('tfoot tr').lastElementChild.textContent,'2');assert.match(d.querySelector('#short-disciplines-caption').textContent,/2 of the 3 completed Master's scholars/);
hydrate({...model,allMasters:4});assert.equal(d.querySelector('[data-discipline-view="degree"]').getAttribute('aria-pressed'),'true');assert.match(d.querySelector('#short-disciplines-caption').textContent,/2 of the 4/);
hydrate(null);assert.match(d.querySelector('[role="status"]').textContent,/last loaded data/);assert.equal(d.querySelector('table').hidden,false);
hydrate({...model,rows:[]});assert.equal(d.querySelector('table').hidden,true);assert.match(d.querySelector('[role="status"]').textContent,/No completed degrees/);
const labels=[...html.matchAll(/data-panel="(B\d+)"/g)].map(m=>m[1]);assert.deepEqual(labels.slice(-5),['B1','B2','B3','B4','B5']);assert.equal((html.match(/id="db-map-b3"/g)||[]).length,1);
dom.window.close();console.log('PASS: toggle, captions, unique totals, empty/error states, refresh selection and B1–B5 order');
