/* Pure country adapter: no client-side inference of identity or release approval. */
(function(root){
'use strict';
const M=root.VanuatuModel||(typeof require==='function'?require('./vanuatu-model.js'):null), G=root.VanuatuGeography||(typeof require==='function'?require('./vanuatu-geography.js'):null);
const unique=M.unique, text=M.text;
const categories=['Social sciences','Education','Health sciences','Humanities','Theology and religious studies','Life and environmental sciences','Engineering, technology and planning','Earth, ocean and atmospheric sciences'];
const colors={'Journal Article':'#e7bf51',Book:'#c14559','Book Chapter':'#dd8ea0',"Master's Thesis":'#9bc9a5','PhD Thesis':'#6fb392',Report:'#899ad1'};
function shortDiscipline(d){
 const field=text(d['Field / Discipline']).toLowerCase(), broad=text(d['Broad Discipline']).toLowerCase();
 function match(s){
  if(/theolog|religio|divinity/.test(s))return categories[4];
  if(/education|teaching|pedagog/.test(s))return categories[1];
  if(/health|medicin|medical|nurs|clinical|epidemi|dentist|pharmac/.test(s))return categories[2];
  if(/oceanograph|geolog|geophys|earth science|atmospheric|meteorolog/.test(s))return categories[7];
  if(/engineer|technology|comput|planning|architecture|information system/.test(s))return categories[6];
  if(/environment|ecolog|biolog|agricultur|marine science|fisher|natural science|climate/.test(s))return categories[5];
  if(/linguistic|literature|language|history|philosophy|humanities|arts/.test(s)&&!/social sciences/.test(s))return categories[3];
  if(/social|sociolog|anthropolog|business|commerce|econom|law|legal|finance|policy|politic|development|tourism|management|pacific islands/.test(s)&&!/humanities and social/.test(s))return categories[0];
  return '';
 }
 // Ambiguous combined broad categories require the finer field; never force them.
 return match(field)||match(broad)||'';
}
function disciplines(m){
 const rows=categories.map(name=>({name,male:new Set(),female:new Set(),unknown:new Set(),masters:new Set(),phd:new Set(),total:new Set()}));
 const all={male:new Set(),female:new Set(),unknown:new Set(),masters:new Set(),phd:new Set(),total:new Set()},unmapped=new Set();
 for(const d of m.completed){if(!['masters','phd'].includes(M.level(d)))continue;const sid=d['Scholar ID'],name=shortDiscipline(d),r=rows.find(r=>r.name===name);if(!r){unmapped.add(sid);continue;}const gender=text(m.byScholar.get(sid)?.Gender).toLowerCase(),key=gender==='male'?'male':gender==='female'?'female':'unknown';for(const target of [r,all]){target[key].add(sid);target[M.level(d)].add(sid);target.total.add(sid);}}
 return {rows:rows.sort((a,b)=>b.total.size-a.total.size),all,unmapped};
}
function region(country){const c=G.country(country);const map={Oceania:['Vanuatu','Fiji','Australia','New Zealand','Tonga','Samoa','Solomon Islands','Kiribati','Naoero','Tuvalu','Papua New Guinea','Federated States of Micronesia','Marshall Islands','Palau','Cook Islands','Niue','New Caledonia','French Polynesia','Guam','American Samoa'],Americas:['United States','Canada','Mexico','Brazil','Chile','Peru','Argentina'],Europe:['United Kingdom','France','Germany','Netherlands','Switzerland','Sweden','Norway','Denmark','Finland','Spain','Portugal','Italy','Belgium','Malta','Ireland','Austria','Poland','Czechia','Greece'],Asia:['Japan','China','India','Philippines','Indonesia','Malaysia','Singapore','Thailand','Taiwan','South Korea','Republic of Korea','Israel'],Africa:['South Africa','Kenya','Ghana','Nigeria','Egypt']};return Object.keys(map).find(k=>map[k].includes(c))||'Unclassified';}
function matchesAuth(m,p,mode){const c=M.authorClass(m,p['Publication ID']);return !mode||mode==='both'?(!mode||c!=='unlinked'):c===mode;}
function countryScope(p){if(M.yes(p['About Country?']))return 'vanuatu';if(p['About Country?']===false||/^(false|no|0)$/i.test(text(p['About Country?'])))return 'international';const f=text(p['Country Focus']);if(/(^|[;,|])\s*Vanuatu\s*($|[;,|])/i.test(f))return 'vanuatu';return 'unknown';}
function byStudy(m,pubs,field='Province'){
 const out=new Map();const put=(name,p)=>{if(!out.has(name))out.set(name,new Map());out.get(name).set(p['Publication ID'],p);};
 for(const p of pubs){const sites=m.geography.filter(g=>g['Publication ID']===p['Publication ID']&&G.country(g.Country)==='Vanuatu');if(sites.length){for(const site of sites)put(text(site[field])|| (field==='Province'?'Vanuatu-wide / no finer location stated':'Finer location not coded'),p);}else if(countryScope(p)==='vanuatu')put('Location not yet coded',p);}
 return [...out].map(([name,ps])=>({name,pubs:[...ps.values()]})).sort((a,b)=>b.pubs.length-a.pubs.length);
}
function byCommunity(m,pubs,basis='either',field='Province',auth='both'){
 const out=new Map();for(const p of pubs){const links=m.authors.filter(a=>a['Publication ID']===p['Publication ID']&&(auth==='both'||(auth==='lead'?(+a['Author Position']===1||M.yes(a['Lead / First Author?'])):!(+a['Author Position']===1||M.yes(a['Lead / First Author?'])))));for(const a of links){const locations=M.affiliation(m.byScholar.get(a['Scholar ID']),basis,field);for(const place of locations.length?locations:['Community geography not yet confirmed']){if(!out.has(place))out.set(place,new Map());out.get(place).set(p['Publication ID'],p);}}}return [...out].map(([name,ps])=>({name,pubs:[...ps.values()]})).sort((a,b)=>b.pubs.length-a.pubs.length);
}
function pathways(m){
 const explicit=M.mobility(m), rows=[...explicit.rows],excluded=[...explicit.excluded], covered=new Set(rows.map(r=>r.scholar_id));
 for(const s of m.scholars){const sid=s['Scholar ID'];if(covered.has(sid))continue;const ds=m.completed.filter(d=>d['Scholar ID']===sid),masters=ds.filter(d=>M.level(d)==='masters'),phds=ds.filter(d=>M.level(d)==='phd');if(!masters.length||!phds.length)continue;
  if(masters.length!==1||phds.length!==1){excluded.push(sid);continue;}const a=masters[0],b=phds[0],ay=Number(a['Completion Year']),by=Number(b['Completion Year']);
  if(!ay||!by||ay>by||!a['Canonical University Name (C_Uni)']||!b['Canonical University Name (C_Uni)']||!a['University Country']||!b['University Country']){excluded.push(sid);continue;}
  rows.push({scholar_id:sid,scholar:s['Scholar Name'],m_uni:a['Canonical University Name (C_Uni)'],p_uni:b['Canonical University Name (C_Uni)'],m_country:G.country(a['University Country']),p_country:G.country(b['University Country']),m_year:ay,p_year:by,pairing:'Unique completed Master’s and doctorate with consistent completion years'});
 }
 return {rows,excluded};
}
function biblical(p){
 const t=M.type(p['Publication Type']),tag=t==="Master's Thesis"?'mastersthesis':t==='PhD Thesis'?'phdthesis':t==='Book'?'book':t==='Book Chapter'?'incollection':t==='Report'?'techreport':'article';
 const clean=v=>text(v).replace(/\\/g,'\\textbackslash{}').replace(/[{}]/g,c=>'\\'+c).replace(/[\r\n]+/g,' ');
 // Semicolons are author separators; commas are retained inside author names.
 const authors=text(p['Authors — Full Ordered List']).split(/\s*;\s*/).filter(Boolean).join(' and ');
 const fields=[['title',p.Title],['author',authors],['year',p.Year],['journal',t==='Journal Article'?p['Container / Journal']:''],['booktitle',t==='Book Chapter'?p['Container / Journal']:''],[t.includes('Thesis')?'school':'publisher',p['Publisher / Institution']],['volume',p.Volume],['number',p.Issue],['pages',p.Pages],['doi',p.DOI],['url',M.safeURL(p['Primary URL']||p['Open Access URL / PDF'])]];
 return '@'+tag+'{'+text(p['Publication ID']).replace(/[^\w-]/g,'')+',\n'+fields.filter(x=>x[1]).map(([k,v])=>'  '+k+' = {'+clean(v)+'}').join(',\n')+'\n}';
}
const api={categories,colors,shortDiscipline,disciplines,region,matchesAuth,countryScope,byStudy,byCommunity,pathways,bibtex:biblical};root.VanuatuDashboardModel=api;if(typeof module==='object')module.exports=api;
})(typeof window==='object'?window:globalThis);
