(function(root){
  'use strict';
  let bundle=null;
  async function decrypt(bytes,password){
    const a=new Uint8Array(bytes);if(new TextDecoder().decode(a.slice(0,4))!=='IVAV')throw Error('Unsupported snapshot format.');
    const seed=await crypto.subtle.importKey('raw',new TextEncoder().encode(password),'PBKDF2',false,['deriveKey']);
    const key=await crypto.subtle.deriveKey({name:'PBKDF2',salt:a.slice(4,20),iterations:200000,hash:'SHA-256'},seed,{name:'AES-GCM',length:256},false,['decrypt']);
    return JSON.parse(new TextDecoder().decode(await crypto.subtle.decrypt({name:'AES-GCM',iv:a.slice(20,32)},key,a.slice(32))));
  }
  async function load(password){
    const response=await fetch(root.VANUATU_CONFIG.snapshot,{cache:'no-store'});
    if(!response.ok)throw Error(response.status===404?'Vanuatu snapshots have not been activated yet. Preview the layout or configure the refresh workflow.':'Snapshot unavailable ('+response.status+').');
    let next;try{next=await decrypt(await response.arrayBuffer(),password);}catch{throw Error('Unable to unlock this Vanuatu snapshot. Check the Vanuatu collaborator password.');}
    root.VanuatuModel.build(next);bundle=next;return bundle;
  }
  function use(next){root.VanuatuModel.build(next);bundle=next;return bundle;}
  function clear(){bundle=null;}
  // Compatibility bridge for the inherited flanked chord renderer. Only the
  // current sanitized Vanuatu bundle is exposed; no other country's fallback.
  const dbGate={isUnlocked:()=>!!bundle,fetchJson:async path=>{
    if(!bundle)throw Error('Unlock the Vanuatu dashboard first.');
    if(path==='data/vanuatu-master-mobility.json')return root.VanuatuModel.mobility(root.VanuatuModel.build(bundle)).rows;
    if(path==='data/vanuatu-master-scholars.json')return bundle.tables.Scholars;
    if(path==='data/vanuatu-master-grad-degrees.json')return bundle.tables['Graduate Degrees']||[];
    throw Error('Unsupported Vanuatu data resource.');
  }};
  root.VanuatuAdapter={load,use,clear,decrypt};root.dbGate=dbGate;
})(window);
