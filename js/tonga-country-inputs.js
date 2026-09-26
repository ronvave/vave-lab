/* Tonga publication country editor. Drafts stay on this device, per scholar/publication. */
(function(){
'use strict';
window.TongaCountryInputs=function(parent,key,onChange){
 const root=document.createElement('fieldset');root.className='tonga-country-editor';parent.append(root);
 const legend=document.createElement('legend');legend.textContent='Other countries or areas';root.append(legend);
 const help=document.createElement('p');help.textContent='Choose one country or area per field from the UN M49 list, which includes territories.';root.append(help);
 const countLabel=document.createElement('label');countLabel.textContent='How many countries or areas would you like to add?';root.append(countLabel);
 const count=document.createElement('input');count.type='number';count.min='0';count.max='50';count.step='1';count.value='0';countLabel.append(count);
 const rowsHost=document.createElement('div');root.append(rowsHost);
 const add=document.createElement('button');add.type='button';add.textContent='Add another country';root.append(add);
 const storage=document.createElement('p');storage.className='meta';storage.setAttribute('role','status');root.append(storage);
 const storageKey='tonga-country-draft-v1:'+key;let rows=[],seq=0;
 function values(){return rows.map(r=>r.input.value);}
 function save(){try{localStorage.setItem(storageKey,JSON.stringify(values()));storage.textContent='Draft saved on this device. Invalid entries are not submitted.';}catch(_){storage.textContent='Draft could not be saved on this device. Keep this page open to retain your entries.';}}
 function changed(){count.value=rows.length;add.disabled=rows.length>=50;save();onChange();}
 function validate(r){const text=r.input.value.trim(),valid=!text||!!TongaCountries.resolve(text);r.input.setAttribute('aria-invalid',String(!valid));r.error.textContent=valid?'':'Choose a country from the list. This entry will not be submitted; its draft saving status is shown below.';return valid;}
 function row(value=''){
  if(rows.length>=50)return;
  const host=document.createElement('div');host.className='tonga-country-row';rowsHost.append(host);
  const label=document.createElement('label');label.textContent='Country or area';host.append(label);
  const input=document.createElement('input');input.type='text';input.autocomplete='off';input.value=value;label.append(input);
  const id='country-'+crypto.randomUUID();input.setAttribute('list',id);const list=document.createElement('datalist');list.id=id;host.append(list);
  const error=document.createElement('span');error.id=id+'-error';error.className='tonga-country-error';error.setAttribute('aria-live','polite');input.setAttribute('aria-describedby',error.id);host.append(error);
  const remove=document.createElement('button');remove.type='button';remove.textContent='Remove';remove.setAttribute('aria-label','Remove this country field');host.append(remove);
  const r={host,input,error};rows.push(r);
  function suggest(){list.replaceChildren(...TongaCountries.suggest(input.value).map(c=>{const o=document.createElement('option');o.value=c.name;return o;}));}
  input.oninput=()=>{suggest();if(input.getAttribute('aria-invalid')==='true')validate(r);changed();};
  input.onblur=()=>{const c=TongaCountries.resolve(input.value);if(c)input.value=c.name;validate(r);changed();};
  remove.onclick=()=>{if(input.value.trim()&&!confirm('Remove this country entry from the draft?'))return;rows=rows.filter(x=>x!==r);host.remove();changed();};suggest();if(value)validate(r);
 }
 count.onchange=()=>{const n=Number(count.value);if(!Number.isInteger(n)||n<0||n>50){count.value=rows.length;return;}
  if(n<rows.length&&rows.slice(n).some(r=>r.input.value.trim())&&!confirm('Remove the last '+(rows.length-n)+' country fields and their draft entries?')){count.value=rows.length;return;}
  while(rows.length>n)rows.pop().host.remove();while(rows.length<n)row();changed();};
 add.onclick=()=>{row();changed();rows.at(-1)?.input.focus();};
 try{const draft=JSON.parse(localStorage.getItem(storageKey)||'[]');if(Array.isArray(draft))draft.slice(0,50).filter(x=>typeof x==='string').forEach(v=>row(v));}catch(_){}
 count.value=rows.length;
 return {root,values:()=>[...new Map(rows.map(r=>TongaCountries.resolve(r.input.value)).filter(Boolean).map(c=>[c.m49,c])).values()].map(c=>c.name),
  invalid:()=>rows.filter(r=>r.input.value.trim()&&!TongaCountries.resolve(r.input.value)).map(r=>r.input.value),
  validate:()=>rows.forEach(validate),
  submitted(){rows.filter(r=>TongaCountries.resolve(r.input.value)).forEach(r=>{r.host.remove();});rows=rows.filter(r=>!TongaCountries.resolve(r.input.value));count.value=rows.length;save();},
  restore(){if(rows.length){storage.textContent='Draft restored from this device. Only valid countries will be submitted.';onChange();}}
 };
};
})();
