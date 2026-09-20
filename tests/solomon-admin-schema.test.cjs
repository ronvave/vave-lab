// Run with node tests/solomon-admin-schema.test.cjs; no network or live writes.
const fs=require('fs'),path=require('path'),vm=require('vm'),assert=require('node:assert/strict');
const root=path.resolve(__dirname,'..'),read=p=>fs.readFileSync(path.join(root,p),'utf8');
const backend={PropertiesService:{getScriptProperties:()=>({getProperty:()=>null})}};
vm.createContext(backend);vm.runInContext(read('apps-script/solomon-master-writeback.gs'),backend);
const schema=backend.MAPPING;
function elements(html){
 return [...html.matchAll(/<(input|select|textarea)\b([^>]*data-ws[^>]*)>/g)].map(m=>{
 const attrs=Object.fromEntries([...m[2].matchAll(/([\w-]+)="([^"]*)"/g)].map(x=>[x[1],x[2]]));
 return {value:'',tagName:m[1].toUpperCase(),options:[],getAttribute:k=>attrs[k]||'',setAttribute:(k,v)=>attrs[k]=v,attrs};
 });
}
for(const file of ['admin-solomon-islands-master.html','admin-solomon-islands-staging.html']){
 const html=read(file),els=elements(html);
 for(const e of els)assert.ok(schema.worksheets[e.attrs['data-ws']].fields[e.attrs['data-field']],e.attrs['data-field']);
 assert.match(html,/<option value="Man">Male<\/option>/);assert.match(html,/<option value="Woman">Female<\/option>/);
 assert.doesNotMatch(html,/Tangata|Fefine|Tofi|Kāinga|Haʻa|Ha'apai|Solomon Islandstapu|cultural &amp; lineage/i);
 for(const side of ['paternal','maternal']) {
 const fields=els.filter(e=>e.attrs.id?.endsWith('-'+side));assert.equal(fields.length,3);
 assert.deepEqual(fields.map(e=>e.attrs['data-field']),[`${side[0].toUpperCase()+side.slice(1)} Province/City Area`,`${side[0].toUpperCase()+side.slice(1)} Specific Island`,`${side[0].toUpperCase()+side.slice(1)} Village/Community`]);
 }
 const document={addEventListener(){},querySelectorAll:selector=>selector.includes('.me-row-input')?[]:els,getElementById:id=>els.find(e=>e.attrs.id===id)};
 const context={document,window:{}};vm.createContext(context);
 vm.runInContext(read('js/admin-solomon-master.js').replace(/\}\)\(\);\s*$/,'window.testAdmin={collectMasterChanges,renderPositionsRows,renderGradDegreesRows};})();'),context);
 const values={'me-title-salutation':'Prof','me-gender':'Man','me-title':'Associate Professor','me-institution':'SOL-I0001','me-department':'Department of Pacific Islands Studies','me-profile-url':'https://hawaii.edu/cpis/people/core-faculty/tarcisius-kabutaulaka/'};
 for(const [id,value] of Object.entries(values))document.getElementById(id).value=value;
 const changes=context.window.testAdmin.collectMasterChanges('SOL-S0001');assert.equal(changes.length,6);
 for(const c of changes){const spec=schema.worksheets[c.worksheet].fields[c.field];assert.ok(spec,c.field);if(spec.enum)assert.ok(spec.enum.includes(c.newValue));}
 for(const [fn,ws] of [['renderPositionsRows','Positions'],['renderGradDegreesRows','Graduate Degrees']]){
 const container={};context.window.testAdmin[fn]('SOL-S0001',[{rowNumber:2,fields:{}}],container);
 for(const e of elements(container.innerHTML))assert.ok(schema.worksheets[ws].fields[e.attrs['data-field']],e.attrs['data-field']);
 }
 console.log('PASS '+file+': schema, six rejected edits, geography, gender and row editors');
}
(async()=>{
 let posts=0,spreadsheetId='wrong-sheet';
 const context={window:{},localStorage:{getItem:k=>k.includes('endpoint')?'https://script.google.com/macros/s/test/exec':'test-only'},fetch:async(url,opts)=>{if(opts.method==='POST')posts++;return {json:async()=>({status:'ok',spreadsheetId})};}};
 vm.createContext(context);vm.runInContext(read('js/solomon-admin-writeback-client.js'),context);
 await assert.rejects(context.window.adminWriteback.write([]),/does not identify/);assert.equal(posts,0);
 spreadsheetId='1um6pHKriEhbtvmkm7e8E1j0_Zt9A-oYpY88fuPoAmFY';await context.window.adminWriteback.write([],{dryRun:true});assert.equal(posts,1);
 console.log('PASS: wrong-master endpoint blocked before POST; Solomon endpoint accepted');
})().catch(e=>{console.error(e);process.exit(1)});
