(function(root){
  'use strict';
  const G=root.VanuatuGeography||(typeof require==='function'?require('./vanuatu-geography.js'):null);
  const text=v=>String(v??'').trim();
  const yes=v=>v===true||/^(true|yes|1)$/i.test(text(v));
  const unique=a=>[...new Set(a.filter(Boolean))];
  const types=['Journal Article','Book','Book Chapter',"Master's Thesis",'PhD Thesis','Report'];
  function type(v){const s=text(v).toLowerCase();if(/^(master[’']?s?|masters) thesis$/.test(s))return "Master's Thesis";if(/^(phd|doctoral|doctorate) thesis$/.test(s))return 'PhD Thesis';return types.find(t=>t.toLowerCase()===s)||text(v);}
  function eligible(r,identity=false){return text(r[identity?'Identity Verification Status':'Verification Status'])==='Verified'&&yes(r['Public Display Approved']);}
  function level(d){return /master/i.test(d['Degree Level']||'')?'masters':/phd|doctor/i.test(d['Degree Level']||'')?'phd':'other';}
  function affiliation(s,basis='either',field='Province'){
    return unique((basis==='either'?['Paternal','Maternal']:[basis==='maternal'?'Maternal':'Paternal']).map(side=>text(s[side+' '+field])).map(v=>field==='Province'?G.province(v):v));
  }
  function safeURL(v){try{const u=new URL(text(v),typeof location==='object'?location.href:'https://ronvave.github.io/vave-lab/');return ['https:','http:'].includes(u.protocol)?u.href:'';}catch{return '';}}
  function build(bundle){
    if(bundle.country!=='Vanuatu'||bundle.schemaVersion!==1)throw Error('Not a supported Vanuatu snapshot.');
    const t=bundle.tables||{},fields=bundle.fields||{},can=(table,required)=>required.every(f=>(fields[table]||[]).includes(f));
    const scholars=t.Scholars||[],byScholar=new Map(scholars.map(s=>[s['Scholar ID'],s]));
    const degrees=(t['Graduate Degrees']||[]).filter(d=>byScholar.has(d['Scholar ID']));
    const pubs=(t.Publications||[]).filter(p=>types.includes(type(p['Publication Type'])));
    const byPub=new Map(pubs.map(p=>[p['Publication ID'],p]));
    const authors=(t.Authorship||[]).filter(a=>byScholar.has(a['Scholar ID'])&&byPub.has(a['Publication ID']));
    const geography=(t['Research Geography']||[]).filter(g=>byPub.has(g['Publication ID']));
    const completed=degrees.filter(d=>text(d['Completion Status'])==='Completed'&&['masters','phd'].includes(level(d)));
    const coverage={degrees:can('Graduate Degrees',['Degree ID','Scholar ID','Degree Level','Completion Status']),publications:can('Publications',['Publication ID','Publication Type','Title']),authorship:can('Authorship',['Publication ID','Scholar ID','Author Position']),geography:can('Research Geography',['Publication ID','Country','Province']),community:can('Scholars',['Paternal Province','Maternal Province']),gender:can('Scholars',['Gender'])};
    return {bundle,scholars,byScholar,degrees,completed,pubs,byPub,authors,geography,coverage};
  }
  function counts(m){return {scholars:m.scholars.length,publications:m.coverage.publications?m.pubs.length:null,masters:m.coverage.degrees?m.completed.filter(d=>level(d)==='masters').length:null,phd:m.coverage.degrees?m.completed.filter(d=>level(d)==='phd').length:null,countries:m.coverage.degrees?unique(m.completed.map(d=>G.country(d['University Country']))).length:null};}
  function authorClass(m,pid){const a=m.authors.filter(r=>r['Publication ID']===pid);return a.some(r=>Number(r['Author Position'])===1||yes(r['Lead / First Author?']))?'lead':a.length?'coauthor':'unlinked';}
  function publicationIds(m,sid){return unique(m.authors.filter(a=>a['Scholar ID']===sid).map(a=>a['Publication ID']));}
  function filtered(m,f={}){
    const ids=m.scholars.filter(s=>(!f.province||affiliation(s,f.basis).includes(f.province))&&(!f.island||affiliation(s,f.basis,'Island').includes(f.island))&&(!f.locality||affiliation(s,f.basis,'Area Council / Locality').includes(f.locality))&&(!f.village||affiliation(s,f.basis,'Village / Community').includes(f.village))&&(!f.country||m.completed.some(d=>d['Scholar ID']===s['Scholar ID']&&G.country(d['University Country'])===f.country))&&(!f.institution||m.completed.some(d=>d['Scholar ID']===s['Scholar ID']&&d['Canonical University Name (C_Uni)']===f.institution))&&(!f.discipline||f.discipline.split(';').every(q=>text(s['Primary Discipline / Field']).toLowerCase().includes(q.trim().toLowerCase())))&&(!f.scholarSearch||text(s['Scholar Name']).toLowerCase().includes(f.scholarSearch.toLowerCase()))).map(s=>s['Scholar ID']);
    const idSet=new Set(ids),linked=!!(f.province||f.island||f.locality||f.village||f.country||f.institution||f.discipline||f.scholarSearch);
    const eligiblePids=new Set(m.authors.filter(a=>idSet.has(a['Scholar ID'])).map(a=>a['Publication ID']));
    const pubs=m.pubs.filter(p=>(!linked||eligiblePids.has(p['Publication ID']))&&(!f.type||type(p['Publication Type'])===f.type)&&(!f.itemSearch||text(p.Title+' '+p['Authors — Full Ordered List']).toLowerCase().includes(f.itemSearch.toLowerCase()))&&(!f.yearFrom||Number(p.Year)>=Number(f.yearFrom))&&(!f.yearTo||Number(p.Year)<=Number(f.yearTo))&&(!f.authorship||authorClass(m,p['Publication ID'])===f.authorship));
    return {scholars:m.scholars.filter(s=>idSet.has(s['Scholar ID'])),pubs};
  }
  function groups(rows,key,id){const out=new Map();for(const r of rows){for(const k of unique([].concat(key(r)||'Unclassified'))){if(!out.has(k))out.set(k,new Set());out.get(k).add(id(r));}}return [...out].map(([name,set])=>({name,count:set.size})).sort((a,b)=>b.count-a.count||a.name.localeCompare(b.name));}
  function mobility(m){
    const out=[],seen=new Set(),excluded=[];
    for(const r of m.bundle.tables['Study Pathways']||[]){
      const a=m.degrees.find(d=>d['Degree ID']===r["Master's Degree ID"]),b=m.degrees.find(d=>d['Degree ID']===r['PhD Degree ID']);
      if(!a||!b||a['Scholar ID']!==r['Scholar ID']||b['Scholar ID']!==r['Scholar ID']||level(a)!=='masters'||level(b)!=='phd'||a['Completion Status']!=='Completed'||!['Completed','Ongoing','In progress'].includes(b['Completion Status'])){excluded.push(r['Pathway ID']);continue;}
      const key=JSON.stringify([r['Scholar ID'],a['Degree ID'],b['Degree ID']]);if(seen.has(key))continue;seen.add(key);
      out.push({scholar_id:r['Scholar ID'],scholar:m.byScholar.get(r['Scholar ID'])['Scholar Name'],m_uni:a['Canonical University Name (C_Uni)'],p_uni:b['Canonical University Name (C_Uni)'],m_country:G.country(a['University Country']),p_country:G.country(b['University Country']),m_year:a['Completion Year'],p_year:b['Completion Year']});
    }return {rows:out,excluded};
  }
  function bibtex(p){const clean=v=>text(v).replace(/\\/g,'\\textbackslash{}').replace(/[{}]/g,c=>'\\'+c).replace(/[\r\n]+/g,' ');const kind=type(p['Publication Type']),tag=kind.includes('Thesis')?'phdthesis':kind==='Book'?'book':kind==='Book Chapter'?'incollection':kind==='Report'?'techreport':'article';return '@'+tag+'{'+text(p['Publication ID']).replace(/[^\w-]/g,'')+',\n'+[['title',p.Title],['author',p['Authors — Full Ordered List']],['year',p.Year],['doi',p.DOI],['url',safeURL(p['Primary URL'])]].filter(x=>x[1]).map(([k,v])=>'  '+k+' = {'+clean(v)+'}').join(',\n')+'\n}';}
  const api={text,yes,unique,types,type,eligible,level,affiliation,safeURL,build,counts,authorClass,publicationIds,filtered,groups,mobility,bibtex};root.VanuatuModel=api;if(typeof module==='object')module.exports=api;
})(typeof window==='object'?window:globalThis);
