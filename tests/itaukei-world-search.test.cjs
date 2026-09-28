const fs = require('node:fs'), vm = require('node:vm'), assert = require('node:assert/strict'), crypto = require('node:crypto');
const source = fs.readFileSync('js/itaukei-database-master.js', 'utf8');
function extract(name) {
 const start = source.indexOf('  function '+name+'(');
 const next = source.indexOf('\n  function ', start+1);
 return source.slice(start, next);
}
const helpers = source.slice(source.indexOf('  function worldMarkerForPoint('),source.indexOf('  function wireWorldPanel('));
const popup = source.slice(source.indexOf('    function openMarkerPopupAt('),source.indexOf('\n    // Zoom to a point',source.indexOf('    function openMarkerPopupAt(')));
const zoom = source.slice(source.indexOf('    function zoomAndPreselect('),source.indexOf('\n    // Dropdown anchored',source.indexOf('    function zoomAndPreselect(')));
const pass=Buffer.from(fs.readFileSync('js/demo-gate.js','utf8').match(/BAKED_PASSCODE = atob\('([^']+)'/)[1], 'base64');
const bytes=fs.readFileSync('data/itaukei-master-worldpoints.json.enc');
const key=crypto.pbkdf2Sync(pass,bytes.subarray(4,20),200000,32,'sha256');
const decipher=crypto.createDecipheriv('aes-256-gcm',key,bytes.subarray(20,32));
decipher.setAuthTag(bytes.subarray(-16));
const points=JSON.parse(Buffer.concat([decipher.update(bytes.subarray(32,-16)),decipher.final()])).worldPoints;
let selected, opened, hovered;
const state={};
const context=vm.createContext({state,setTimeout:fn=>fn(),MouseEvent:class {constructor(type){this.type=type;}}});
vm.runInContext(helpers+popup+zoom,context);
let cases=0;
for (const fullscreen of [false,true]) {
 state.worldMapFullscreen=fullscreen;
 const markers=points.map(p=>{
   let lng=p.lng;
   if(fullscreen) {while(lng-140>180)lng-=360;while(lng-140< -180)lng+=360;}
   const el={querySelectorAll:()=>['phdScholars','mastersScholars','unknownScholars'].flatMap(k=>(p[k]||[]).map(name=>({getAttribute:()=>name,dispatchEvent:()=>{hovered=name;},addEventListener(){}})))};
   return {_worldPoint:p,getLatLng:()=>({lat:p.lat,lng}),getPopup:()=>({getElement:()=>el}),openPopup(){opened=this;}};
 });
 state.worldLayer={getLayers:()=>markers};
 const map={setView(ll){selected=ll;}};
 for (const marker of markers) {
  const p=marker._worldPoint;
  for(const [key,level] of [['phdScholars','PhD'],['mastersScholars',"Master's"],['unknownScholars','Other']]) {
   for(const name of p[key]||[]) {
    opened=null;hovered=null;
    context.zoomAndPreselect(map,p,name,level);
    assert.equal(opened,marker,p.university+' popup');
    assert.deepEqual(selected,marker.getLatLng(),p.university+' map position');
    assert.equal(hovered,name,name+' scholar details');cases++;
   }
  }
 }
 // Overlapping coordinates must still open the selected institution.
 const first=markers[0]; const shifted={...first,_worldPoint:{...first._worldPoint,university:'Collocated institution'},getLatLng:()=>({lat:0,lng:500}),openPopup(){opened=this;}};
 markers.push(shifted);
 context.openMarkerPopupAt(map,shifted._worldPoint);
 assert.equal(opened,shifted);
 assert.deepEqual(context.worldSearchLatLng(shifted._worldPoint),shifted.getLatLng());
}
console.log('Ron matches:', points.flatMap(p=>(p.phdScholars||[]).filter(n=>/vave/i.test(n))));
assert(points.some(p=>(p.phdScholars||[]).some(n=>/vave/i.test(n))),'Ron PhD fixture present');
assert(!source.includes('m.setView([point.lat, point.lng], 6'),'degree search must not target canonical longitude');
assert(source.includes('L.latLngBounds(matches.map(worldSearchLatLng))'),'multiple search matches use rendered positions');
console.log(`PASS: ${cases} scholar-degree selections across ${points.length} universities in inline/fullscreen views, including Ron Vave; correct popup, scholar details, wrapped position and collocated institutions.`);
