const fs=require('node:fs'),vm=require('node:vm'),assert=require('node:assert/strict');
const context=vm.createContext({COUNTRY_ALIAS:{USA:'United States of America'}});
vm.runInContext(fs.readFileSync('js/itaukei-mobility-filters.js','utf8'),context);
const base={unis:{F:{country:'Fiji',region:'Oceania'},A:{country:'Australia',region:'Oceania'},N:{country:'New Zealand',region:'Oceania'},U:{country:'USA',region:'Americas'}},
 flows:[{scholar_id:'1',source:'F',target:'A'},{scholar_id:'2',source:'A',target:'N'},{scholar_id:'3',source:'A',target:'A'},{scholar_id:'4',source:'U',target:'F'}],
 uni_list:[{uni:'F',n:1},{uni:'A',n:2},{uni:'N',n:3},{uni:'U',n:4}]};
const state={stage:'either',regions:new Set(['Oceania','Americas']),countries:new Set(['Australia'])};
function ids(stage,expected){state.stage=stage;const result=context.filterMobilityModel(base,state);assert.deepEqual(Array.from(result.flows,f=>f.scholar_id),expected);return result;}
ids('masters',['2','3']);const phd=ids('phd',['1','3']);
assert.deepEqual(Array.from(phd.uni_list,u=>u.uni),['F','A'],'counterpart endpoint retained');
ids('either',['1','2','3']);ids('both',['3']);
state.countries.add('New Zealand');ids('both',['2','3']);
state.countries=new Set(['Fiji','Australia','New Zealand','United States of America']);ids('either',['1','2','3','4']);
state.regions.clear();assert.equal(ids('either',[]).emptySelection,true);
state.regions.add('Oceania');state.countries.clear();ids('either',[]);
state.countries.add('United States of America');assert.equal(ids('either',[]).emptySelection,false);
state.regions.add('Americas');const usa=ids('either',['4']);assert.equal(usa.uni_list[1].n,4,'stable numbering');
assert.equal(base.flows.length,4,'source unchanged');
base.unis.X={country:'Germany',region:'Europe'};base.uni_list.push({uni:'X',n:5});base.flows.push({scholar_id:'5',source:'X',target:'A'});
state.regions=new Set(['Europe']);state.countries=new Set(['Germany']);ids('either',['5']);
console.log('PASS: degree matching, country unions, region scope, full endpoints, empty states, stable IDs, new records.');
