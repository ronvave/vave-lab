/* Explicitly reviewed pairs are validated in VanuatuModel before crossing
 * this narrow compatibility bridge into the preserved flanked chord. */
(function(root){'use strict';
 function rows(records,scholars){const ids=new Set(scholars.map(s=>s['Scholar ID'])),seen=new Set(),valid=[],excluded=[],rejected=[];for(const r of records){if(!/^VAN-S\d{4,}$/.test(r.scholar_id||'')||!ids.has(r.scholar_id)){rejected.push(r);continue;}if(!r.m_uni||!r.p_uni||!r.m_country||!r.p_country){excluded.push(r);continue;}const key=JSON.stringify(r);if(seen.has(key))continue;seen.add(key);valid.push(r);}return {rows:valid,excluded,rejected,duplicates:[]};}
 root.VanuatuMobility={rows};if(typeof module==='object')module.exports=root.VanuatuMobility;
})(typeof window==='object'?window:globalThis);
