/* Tonga-only paired mobility model. Source: M>PhD mobility, never employment.
 * The source's documented population is completed Master's + completed/ongoing PhD.
 * A missing degree episode is not evidence of non-completion; incomplete dates
 * are retained. Each distinct recorded pair has the reference ribbon weight 1.
 */
(function(root){
  'use strict';
  const text=v=>String(v == null ? '' : v).trim();
  const country=v=>({'USA':'United States','United States of America':'United States',
    'UK':'United Kingdom','United Kingdom of Great Britain and Northern Ireland':'United Kingdom'}[text(v)] || text(v));
  const institution=v=>text(v).replace(/\s+/g,' ');
  const known=v=>!!v && !/^(not found|unknown|unresolved|n\/a|unsure|#REF!)$/i.test(v)
    && /university|universität|college|institute|school|polytechnic/i.test(v);
  function rows(mobility,scholars,degrees){
    const people=new Map(scholars.map(s=>[text(s['Scholar ID']),s]));
    const byDegree=new Map(degrees.map(d=>[text(d['Degree ID']),d]));
    const result=[],excluded=[],rejected=[],duplicates=[]; const seen=new Set();
    for(const r of mobility){
      // During the rolling export, accept an already canonical legacy value.
      // A numeric legacy ID is never converted into a TNG-S identifier.
      const sid=text(r['Scholar ID'] || r.scholar_id),person=people.get(sid);
      if(!/^TNG-S\d+$/.test(sid) || !person){rejected.push({id:sid,reason:'not in eligible Tonga roster'});continue;}
      const m=byDegree.get(text(r["Master's Degree ID"]))||{},p=byDegree.get(text(r['PhD Degree ID']))||{};
      // If explicit degree links are supplied, do not accept a cross-scholar
      // join or a known population conflict. The current sheet has no links.
      if([m,p].some(d=>d['Scholar ID'] && text(d['Scholar ID'])!==sid) ||
        (m['Completion Status'] && !/^completed\b/i.test(text(m['Completion Status']))) ||
        (p['Completion Status'] && !/^(completed|in.progress|ongoing|current|enrolled|candidate)\b/i.test(text(p['Completion Status'])))){
        rejected.push({id:sid,reason:'degree link/status conflict'});continue;
      }
      const row={scholar_id:sid,scholar:person['Scholar Name']||person['Display Name']||sid,
        m_uni:institution(r.m_uni || m['C_Uni name']),p_uni:institution(r.p_uni || p['C_Uni name']),
        m_country:country(r.m_country || m.Country),p_country:country(r.p_country || p.Country),
        m_year:r.m_year || m['Finish / Completion Year'] || '',p_year:r.p_year || p['Finish / Completion Year'] || '',
        // Titles are private in Tonga's mobility export. Do not reintroduce them.
        m_title:'',p_title:''};
      const key=JSON.stringify([sid,row.m_uni,row.p_uni,row.m_country,row.p_country,row.m_year,row.p_year,
        text(r.m_in),text(r.p_in),text(r["Master's Degree ID"]),text(r['PhD Degree ID'])]);
      if(seen.has(key)){duplicates.push({id:sid,key});continue;} seen.add(key);
      if(!known(row.m_uni)||!known(row.p_uni)||!row.m_country||!row.p_country){
        excluded.push({id:sid,reason:'institution/country unresolved'});continue;
      }
      result.push(row);
    }
    return {rows:result,excluded,rejected,duplicates};
  }
  root.TonganMobility={rows};
  if(typeof module==='object' && module.exports)module.exports=root.TonganMobility;
})(typeof window==='object'?window:globalThis);
