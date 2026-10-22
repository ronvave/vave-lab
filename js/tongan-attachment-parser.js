/* Deterministic attachment extraction. No external AI service or inferred geography. */
(function(root){
'use strict';
function plain(s){return String(s||'').replace(/\\["'`^~=.]\s*\{?([A-Za-z])\}?/g,'$1').replace(/\\(?:textit|textbf|emph|url)\s*/g,'').replace(/[{}]/g,'').replace(/\\([&%_$#])/g,'$1').replace(/\s+/g,' ').trim();}
function norm(s){return plain(s).normalize('NFD').replace(/[\u0300-\u036f]/g,'').toLowerCase().replace(/[^a-z0-9]/g,'');}
function doi(s){return String(s||'').trim().replace(/^https?:\/\/(?:dx\.)?doi\.org\//i,'').replace(/^doi:\s*/i,'').toLowerCase().replace(/[.,;]+$/,'');}
function record(f,key,type,source){
 var types={article:'Journal Article',book:'Book',inbook:'Book Chapter',incollection:'Book Chapter',inproceedings:'Conference Paper',conference:'Conference Paper',phdthesis:'PhD Thesis',mastersthesis:"Master's Thesis",techreport:'Report',report:'Report',JOUR:'Journal Article',BOOK:'Book',CHAP:'Book Chapter',CONF:'Conference Paper',RPRT:'Report',THES:'Other Thesis'};
 var authors=Array.isArray(f.author)?f.author:String(f.author||'').split(/\s+and\s+/i);
 return {key:key,type:type,publicationType:types[type]||'',title:plain(f.title),year:String(f.year||f.date||'').match(/\b(?:19|20)\d{2}\b/)?.[0]||'',authors:authors.map(plain).filter(Boolean),doi:doi(f.doi),url:plain(f.url),venue:plain(f.journal||f.booktitle),publisher:plain(f.publisher||f.school||f.institution),source:source,warnings:[]};
}
function bib(text){
 var out=[],warnings=[],i=0,macros={jan:'January',feb:'February',mar:'March',apr:'April',may:'May',jun:'June',jul:'July',aug:'August',sep:'September',oct:'October',nov:'November',dec:'December'};
 function ws(){while(i<text.length){if(/\s|,/.test(text[i]))i++;else if(text[i]==='%'){while(i<text.length&&text[i]!=='\n')i++;}else break;}}
 function value(){ws();var val='',parts=0;do{if(parts++)i++;ws();var c=text[i],s='',depth=0;
  if(c==='{'||c==='"'){var open=c,end=c==='{'?'}':'"';i++;depth=open==='{'?1:0;var done=false;
   while(i<text.length){c=text[i++];if(c==='\\'&&i<text.length){s+=c+text[i++];continue;}if(open==='{'){if(c==='{')depth++;if(c==='}'){depth--;if(depth===0){done=true;break;}}
   }else {if(c==='{')depth++;if(c==='}')depth--;if(c==='"'&&depth===0){done=true;break;}}s+=c;}
   if(!done)throw Error('Unclosed BibTeX value');
  }else{var start=i;while(i<text.length&&!/[\s,#})]/.test(text[i]))i++;s=text.slice(start,i);if(macros[s.toLowerCase()]!==undefined)s=macros[s.toLowerCase()];else if(s&&!/^\d+$/.test(s))warnings.push('Unresolved BibTeX macro: '+s);}
  val+=s;ws();
 }while(text[i]==='#');return val;}
 // Parse entry boundaries with balanced braces, including quoted/nested values.
 while(i<text.length){var at=text.indexOf('@',i);if(at<0)break;i=at+1;var m=/^[a-z]+/i.exec(text.slice(i));if(!m){i++;continue;}var type=m[0].toLowerCase();i+=m[0].length;ws();var open=text[i++];if(open!=='{'&&open!=='('){warnings.push('Malformed entry near '+at);continue;}var end=open==='{'?'}':')';
  try{
   if(type==='comment'||type==='preamble'){var depth=1;while(i<text.length&&depth){var ch=text[i++];if(ch===open)depth++;if(ch===end)depth--;}continue;}
   if(type==='string'){ws();var nm=/^[\w:-]+/.exec(text.slice(i));if(!nm)throw Error('Invalid string macro');i+=nm[0].length;ws();if(text[i++]!=='=')throw Error('Invalid macro');macros[nm[0].toLowerCase()]=value();if(text[i]===end)i++;continue;}
   var start=i;while(i<text.length&&text[i]!==','&&text[i]!==end)i++;var key=text.slice(start,i).trim();if(text[i]!==',')throw Error('Missing fields in '+key);i++;var f={};
   while(i<text.length){ws();if(text[i]===end){i++;break;}var k=/^[\w-]+/.exec(text.slice(i));if(!k)throw Error('Invalid field in '+key);i+=k[0].length;ws();if(text[i++]!=='=')throw Error('Missing = in '+key);f[k[0].toLowerCase()]=value();}
   out.push(record(f,key,type,'BibTeX record '+key));
  }catch(e){warnings.push(e.message);i=Math.max(i,at+1);}
 }
 return {records:out,warnings:warnings};
}
function tagged(text,enw){var out=[],f={},type='',key='',last='',warnings=[];
 function finish(){if(Object.keys(f).length)out.push(record(f,key||String(out.length+1),type,(enw?'EndNote':'RIS')+' record '+(out.length+1)));f={};last='';}
 var map=enw?{A:'author',T:'title',D:'year',J:'journal',B:'booktitle',I:'publisher',R:'doi',U:'url'}:{AU:'author',A1:'author',TI:'title',T1:'title',PY:'year',Y1:'year',JO:'journal',JF:'journal',T2:'journal',PB:'publisher',DO:'doi',UR:'url'};
 text.split(/\r?\n/).forEach(function(line){var m=enw?/^%([A-Z0-9])\s+(.*)$/.exec(line):/^([A-Z0-9]{2})\s{2}-\s?(.*)$/.exec(line);
  if(!m){if(!line.trim()&&enw)finish();else if(last&&line.trim()){if(last==='author')f.author[f.author.length-1]+=' '+line.trim();else f[last]+=' '+line.trim();}return;}
  var tag=m[1],v=m[2].trim();if(tag===(enw?'0':'TY')){finish();type=enw?({'Journal Article':'JOUR','Book':'BOOK','Book Section':'CHAP','Conference Paper':'CONF','Report':'RPRT','Thesis':'THES'}[v]||v):v;return;}if(tag==='ER'){finish();return;}last=map[tag]||'';if(!last)return;if(last==='author')(f.author||(f.author=[])).push(v);else f[last]=v;
 });finish();return{records:out,warnings:warnings};}
function bibliography(text,name){if(text.length>2000000)throw Error('Bibliography exceeds 2 MB analysis limit');var result=/\.enw$/i.test(name)||/^%0 /m.test(text)?tagged(text,true):/\.ris$/i.test(name)||/^TY  -/m.test(text)?tagged(text,false):bib(text);if(!result.records.length)throw Error('No readable bibliography records found; inspect the original file');if(result.records.length>500)throw Error('More than 500 records; split this bibliography before analysis');return result;}
function cv(pages){var proposals=[],sections=[],section='Overview';
 pages.forEach(function(page){var lines=String(page.text||'').split(/\n/).map(x=>x.trim()).filter(Boolean),body=lines.join('\n');
  lines.forEach(function(line,i){var heading=line.replace(/\s/g,'').toUpperCase();if(/^(ACADEMICAPPOINTMENTS|EDUCATION|PUBLICATIONS|CONFERENCES|TEACHINGEXPERIENCE|RESEARCHEXPERIENCE|HONORS&AWARDS|HONOURS&AWARDS|GRANTS,SCHOLARSHIPS&FELLOWSHIPS|ACADEMICSERVICE|WORKEXPERIENCE)$/.test(heading))section=plain(line.replace(/\b([A-Z])\s(?=[A-Z]\b)/g,'$1'));
   if(/academic\s*appointments/i.test(section)&&/\b\d{4}\s*[–—-]\s*(Present|Current)\b/i.test(line)){
    var institution=line.replace(/^.*?\b\d{4}\s*[–—-]\s*(?:Present|Current)\s*/i,'').trim(),roles=lines.slice(i+1,i+3).filter(x=>/professor|dean|lecturer|director|researcher|fellow/i.test(x)&&!/^\d/.test(x));
    if(institution)proposals.push({key:'institution',value:institution,source:'CV page '+page.page,evidence:lines.slice(i,i+3).join('\n')});
    if(roles.length)proposals.push({key:'title',value:roles.join('; '),source:'CV page '+page.page,evidence:lines.slice(i,i+3).join('\n')});
   }
   if(/education/i.test(section)&&/\b(?:Ph\.?D\.?|Doctor|M\.?Ed\.?|M\.?A\.?\b|M\.?S\.?\b|Master)/i.test(line)){
    var prev=lines[i-1]||'',dates=prev.match(/\b(?:19|20)\d{2}\b/g),prefix=/Ph\.?D\.?|Doctor/i.test(line)?'phd':'masters';
    if(dates&&dates.length===2){proposals.push({key:prefix+'_year',value:dates[1],source:'CV page '+page.page,evidence:prev+'\n'+line});}
   }
  });
  sections.push({page:page.page,section:section,excerpt:body.slice(0,20000)});
 });var structured=cvStructured(pages);return{proposals:proposals,sections:sections,degrees:structured.degrees,positions:structured.positions,publications:structured.publications};}
/* v5 structured CV reading. Deterministic rules only; every record keeps its page and source lines.
 * Nothing here is written anywhere: the backend turns records into reviewer proposals. */
var CV_HEADINGS=[
 ['education',/^(education|educational background|academic qualifications?|qualifications?|degrees?|tertiary education|academic background|education and training|academic training)$/],
 ['positions',/^(academic appointments?|appointments?|academic positions?|positions?( held)?|employment( history)?|professional (experience|appointments?|employment)|work (experience|history)|career( history)?|experience|research experience|teaching experience|current positions?|previous positions?|professional positions?)$/],
 ['leadership',/^(leadership( roles| positions| experience)?|administrative (roles|positions|experience|appointments?)|academic leadership|service|university service|professional service|academic service)$/],
 ['publications',/^((selected |recent |peer[- ]reviewed |refereed )?publications?( list)?|(peer[- ]reviewed |refereed )?(journal )?articles?|books?( and monographs)?|monographs?|book chapters?|chapters? in (edited )?books?|edited (books|volumes)|reports?( and working papers)?|technical reports?|conference (papers|proceedings|presentations)|research outputs?|scholarly (works|outputs)|publications and outputs)$/],
 ['other',/^(awards?|honou?rs?( and awards)?|awards and honou?rs|grants?|funding|grants and funding|fellowships?|scholarships?( and fellowships)?|referees?|references?|skills|languages?|memberships?|professional memberships?|teaching|courses taught|supervision|students supervised|community (service|engagement)|consultanc(y|ies)|media|interests|personal (details|information)|contact( details)?|presentations?|invited (talks|presentations)|conferences?)$/]
];
function cvHeading(line){var t=String(line||'').trim();if(!t||t.length>70||/\b(19|20)\d{2}\b/.test(t))return '';
 if(/^[A-Z](\s[A-Z&,]){3,}/.test(t))t=t.replace(/\s(?=\S)/g,function(m,i){return /[A-Za-z&,]/.test(t[i-1])&&/[A-Za-z&,]/.test(t[i+1])&&t[i+2]!==undefined&&t[i+2]!==' '&&t[i-2]!==undefined&&t[i-2]!==' '?'':m;});
 var k=t.replace(/^[\dIVXivx]+[.)]\s*/,'').replace(/[:.\s]+$/,'').replace(/\s+/g,' ').replace(/\s*&\s*/g,' and ').toLowerCase().replace(/[‘’ʻ]/g,"'");
 var squashed=k.replace(/\s/g,'');for(var i=0;i<CV_HEADINGS.length;i++){var re=CV_HEADINGS[i][1];if(re.test(k)||re.test(squashed))return CV_HEADINGS[i][0];}
 for(i=0;i<CV_HEADINGS.length;i++){var src=CV_HEADINGS[i][1].source.replace(/ /g,'').replace(/\[- \]/g,'-?');if(new RegExp(src).test(squashed))return CV_HEADINGS[i][0];}
 return '';}
var YEAR=/\b(19[5-9]\d|20[0-4]\d)\b/g;
var RANGE=/\b(19[5-9]\d|20[0-4]\d)\s*(?:[–—-]|to|until)\s*((?:19[5-9]\d|20[0-4]\d)|present|current|now|date|ongoing)\b|\b(?:since|from)\s+(19[5-9]\d|20[0-4]\d)\b|\b(19[5-9]\d|20[0-4]\d)\s*[–—-]\s*(?=$|[,;)\]])/i;
var INST=/\b(universit(y|ies|é|at)|college|institute|institut|polytechnic|academy|ministry|government|council|commission|foundation|trust|bank|museum|hospital|agency|corporation|company|ltd|inc\.?|organi[sz]ation|association|society|secretariat|programme for|united nations|unesco|unicef|undp|world bank|spc|sprep|forum|church|board|authority|office of|centre|center|school|laboratory|library|archives)\b/i;
var STRONG_INST=/\b(universit(y|ies|é|at)|college|institute|institut|polytechnic|academy|ministry|government|council|commission|foundation|trust|bank|museum|hospital|agency|corporation|company|ltd|organi[sz]ation|association|society|secretariat|united nations|unesco|unicef|undp|world bank|forum|church|board|authority)\b/i;
var DEPT=/\b(school of|faculty of|department of|dept\.?|division of|centre for|center for|institute of|institute for|college of|unit|programme|program|discipline of|graduate school)\b/i;
var TITLE=/\b(professor|lecturer|tutor|fellow|researcher|research (associate|assistant|officer)|director|dean|head|chair(person)?|coordinator|manager|officer|teacher|principal|scientist|advis[eo]r|consultant|editor|assistant|associate|president|vice[- ]?chancellor|chancellor|provost|registrar|librarian|curator|analyst|specialist|instructor|postdoc(toral)?|minister|secretary|ceo|chief|founder|member|faculty|affiliate|scholar|nurse|lawyer|priest|reverend|counsellor|counselor)\b/i;
var LEAD=/\b(head|dean|director|chair(person)?|president|vice[- ]?chancellor|chancellor|provost|pro[- ]vice|deputy|coordinator|editor(-in-chief)?|chief|ceo|founder|principal|leader|lead)\b/i;
var DEGREE=/\b(Ph\.?\s?D\.?|D\.?\s?Phil\.?|Ed\.?\s?D\.?|D\.?\s?Ed\.?|DBA|Dr\.?\s?P\.?H|Doctor(?:ate)? of [A-Z][A-Za-z]+(?: [A-Z][A-Za-z]+)?|Doctorate|M\.?\s?Phil\.?|M\.?\s?A\.?(?=[\s,(]|$)|M\.?\s?Sc\.?|M\.?\s?S\.?(?=[\s,(]|$)|M\.?\s?Ed\.?|M\.?\s?B\.?\s?A\.?(?=[\s,(]|$)|M\.?\s?P\.?\s?H\.?(?=[\s,(]|$)|LL\.?\s?M\.?|M\.?\s?Com\.?|M\.?\s?Arts|M\.?\s?F\.?\s?A\.?(?=[\s,(]|$)|M\.?\s?P\.?\s?A\.?(?=[\s,(]|$)|M\.?\s?S\.?\s?W\.?(?=[\s,(]|$)|M\.?\s?Div\.?|M\.?\s?Th\.?|M\.?\s?Res\.?|M\.?\s?Litt\.?|Master(?:'s|s)?(?: of| in)? [A-Z][A-Za-z]+(?: [A-Z][A-Za-z]+){0,3}|Master(?:'s)? degree)/;
var UNDERGRAD_LINE=/^\s*(?:(?:19|20)\d{2}\s*[–—-]?\s*(?:(?:19|20)\d{2})?\s*)?(B\.?\s?A\.?\b|B\.?\s?Sc|B\.?\s?Ed|B\.?\s?Com|LL\.?\s?B|Bachelor|Diploma|Certificate|Postgraduate (Diploma|Certificate)|PGDip|Grad\.?\s?Dip)/i;
var NOT_GRAD=/\b(bachelor|b\.?\s?a\.?\b|b\.?\s?sc|b\.?\s?ed|diploma|certificate|high school|secondary)\b/i;
function cvCountry(text){if(typeof root.TongaCountries==='undefined'||!root.TongaCountries)return '';var parts=String(text||'').split(/[,;()]|\s[–—-]\s/).map(function(x){return x.trim();}).filter(Boolean);
 for(var i=parts.length-1;i>=0;i--){var c=root.TongaCountries.resolve(parts[i]);if(c)return c.name;}
 var aliases={'usa':'United States of America','u.s.a.':'United States of America','us':'United States of America','u.s.':'United States of America','united states':'United States of America','uk':'United Kingdom of Great Britain and Northern Ireland','u.k.':'United Kingdom of Great Britain and Northern Ireland','united kingdom':'United Kingdom of Great Britain and Northern Ireland','england':'United Kingdom of Great Britain and Northern Ireland','scotland':'United Kingdom of Great Britain and Northern Ireland','wales':'United Kingdom of Great Britain and Northern Ireland','nz':'New Zealand','aotearoa':'New Zealand','hawaii':'United States of America',"hawai'i":'United States of America','hawaiʻi':'United States of America'};
 for(i=parts.length-1;i>=0;i--){var a=aliases[parts[i].toLowerCase()];if(a){var r=root.TongaCountries.resolve(a);return r?r.name:a;}}
 return '';}
function cvClean(s){return plain(String(s||'').replace(/^[•▪●◦·*\-–—]\s*/,'').replace(/\s+/g,' ')).replace(/^[,;:–—-]+|[,;:–—-]+$/g,'').trim();}
function cvParts(text){return String(text||'').split(/\s*[,;|]\s*|\s+[–—]\s+|\s{2,}|\n/).map(cvClean).filter(Boolean);}
function cvRank(title){var t=String(title||'').toLowerCase();if(/adjunct/.test(t))return '';
 if(/assistant clinical professor/.test(t))return 'Assistant Clinical Professor';if(/research professor/.test(t))return 'Research Professor';
 if(/associate professor/.test(t))return 'Associate Professor';if(/assistant professor/.test(t))return 'Assistant Professor';if(/\bprofessor\b/.test(t)&&!/emerit|visiting/.test(t))return 'Professor';
 if(/senior lecturer/.test(t))return 'Senior Lecturer';if(/\blecturer\b/.test(t)&&!/assistant|guest|part[- ]time/.test(t))return 'Lecturer';
 if(/\bresearch fellow\b/.test(t)&&!/post/.test(t))return 'Research Fellow';if(/research associate/.test(t))return 'Research Associate';if(/research affiliate/.test(t))return 'Research Affiliate';return '';}
function cvPosition(entry){
 var text=entry.lines.join('\n'),m=RANGE.exec(text);if(!m)return null;
 var start=m[1]||m[3]||m[4],endRaw=m[2]||'',current=/present|current|now|date|ongoing/i.test(endRaw)||!!m[3]||(!!m[4]&&!m[2]),end=/^\d{4}$/.test(endRaw)?endRaw:'';
 var rest=text.replace(m[0],' ').replace(/\(\s*\)/g,' ');var parts=cvParts(rest).filter(function(p){return !/^(19|20)\d{2}$/.test(p)&&!/^(present|current)$/i.test(p);});
 var institution='',department='',titles=[],country='';
 parts.forEach(function(p){if(!country){var c=cvCountry(p);if(c&&c.toLowerCase()===p.toLowerCase().replace(/[.]/g,'')||c&&p.length<25&&!INST.test(p)){country=c;return;}}
  if(/^(school|faculty|department|dept\.?|division|centre|center|discipline|graduate school|office|unit|programme|program) (of|for)\b/i.test(p)&&!department){department=p;return;}
  if(TITLE.test(p)&&!STRONG_INST.test(p.replace(/\b(of|at|in)\b.*$/i,''))&&p.length<=120){var at=/^(.*?)\s+(?:at|,)\s+(.*(universit|college|institute|polytechnic).*)$/i.exec(p);if(at){titles.push(at[1]);if(!institution)institution=at[2];return;}titles.push(p);return;}
  if(DEPT.test(p)&&!/universit(y|ies)|polytechnic/i.test(p)&&!department){department=p;return;}
  if(INST.test(p)&&!institution){institution=p;return;}
  if(DEPT.test(p)&&!department){department=p;return;}
 });
 if(!institution&&department&&/universit|college|polytechnic/i.test(department)){institution=department;department='';}
 if(!titles.length||!institution)return null;
 var title=titles.filter(function(t,i){return titles.indexOf(t)===i;}).slice(0,3).join('; ');var lead=titles.filter(function(t){return LEAD.test(t);}).join('; ');
 return {title:title.slice(0,300),institution:institution.slice(0,300),department:department.slice(0,300),country:country||cvCountry(text),startYear:start||'',endYear:end,current:current,leadershipTitle:lead.slice(0,300),rank:cvRank(title),source:'CV page '+entry.page,evidence:text.slice(0,1200)};
}
function cvDegree(entry){
 var text=entry.lines.join('\n'),line=entry.lines.find(function(l){return DEGREE.test(l);})||'',m=DEGREE.exec(line);if(!m)return null;
 var name=m[0].replace(/\s+/g,' ').trim();if(NOT_GRAD.test(line.slice(0,m.index))&&!/master|doctor|ph\.?d/i.test(name))return null;
 var level=/ph\.?\s?d|d\.?\s?phil|ed\.?\s?d|d\.?\s?ed|dba|dr\.?\s?p|doctor/i.test(name)?'phd':'master';
 var after=line.slice(m.index+m[0].length),field='';var fm=/^\s*(?:\(([^)]+)\)|(?:in|of)\s+([^,;(]+)|,?\s+([A-Z][A-Za-z&' -]{3,60})\s*$)/i.exec(after);if(fm)field=cvClean(fm[1]||fm[2]||fm[3]);if(/universit|college|institute/i.test(field))field='';
 if(!field){var nm=/(?:of|in)\s+([A-Z][A-Za-z &]+)$/.exec(name);if(nm&&!/^(Arts|Science|Philosophy)$/.test(nm[1]))field=nm[1];}
 var parts=cvParts(text.replace(/\((?:expected|anticipated|in progress|ongoing|current|candidate)[^)]*\)?/ig,' ').replace(RANGE,' ').replace(YEAR,' ').replace(/\(\s*\)/g,' ')),university='',city='',country='',thesis='';
 parts.forEach(function(p){if(/^(thesis|dissertation|title)\b/i.test(p)){thesis=cvClean(p.replace(/^(thesis|dissertation|title)\s*(title)?\s*[:\-–]?\s*/i,'').replace(/^["“]|["”]$/g,''));return;}
  if(!university&&/universit(y|ies|é|at)|college|institute|polytechnic|school of|academy/i.test(p)&&!DEGREE.test(p)){university=p;return;}
  var c=cvCountry(p);if(c&&!country&&p.length<40){country=c;return;}
  if(university&&!city&&/^[A-Z][a-zA-Z' .-]{2,30}$/.test(p)&&!DEGREE.test(p)&&p!==field&&!TITLE.test(p))city=p;});
 var q=/["“]([^"”]{8,400})["”]/.exec(text);if(!thesis&&q)thesis=q[1].trim();
 var progress=/expected|in progress|ongoing|candidate|candidature|current(ly)?|present|anticipated|forthcoming|abd\b/i.test(text);
 var years=(text.match(YEAR)||[]),r=RANGE.exec(text),year=r&&/^\d{4}$/.test(r[2]||'')?r[2]:(years.length?years[years.length-1]:''),startYear=r?(r[1]||r[3]||''):(years.length>1?years[0]:'');if(startYear===year)startYear='';
 if(progress){year='';}
 return {level:level,degreeName:name.slice(0,200),field:field.slice(0,200),university:university.slice(0,300),city:city.slice(0,100),country:country||cvCountry(text),year:year,startYear:startYear,completion:progress?'In progress':'Completed',thesisTitle:thesis.slice(0,500),source:'CV page '+entry.page,evidence:text.slice(0,1200)};
}
var PUB_START=/^(\[\d+\]|\d{1,3}[.)]|[•▪●◦·*])\s+|^[A-ZĀĒĪŌŪ][A-Za-zÀ-ÿĀ-ž'’ʻ\-]+,\s+(?:[A-Z]\.|[A-Z][a-z]+)/;
function cvPublication(text,page){
 var t=cvClean(text.replace(/^(\[\d+\]|\d{1,3}[.)])\s+/,'')),d=/\b10\.\d{4,9}\/[^\s"<>]+/i.exec(t),url=/https?:\/\/\S+/i.exec(t);
 var ym=/\((19[5-9]\d|20[0-4]\d)[a-z]?\)|(?:^|[.,]\s)(19[5-9]\d|20[0-4]\d)[a-z]?[.,]/.exec(t),year=ym?(ym[1]||ym[2]):'';if(!year){var any=t.match(YEAR);year=any?any[any.length-1]:'';}
 if(!year&&!d)return null;
 var authors='',title='',venue='',rest='';
 var q=/["“]([^"”]{8,400}?)[.,]?["”]/.exec(t);
 if(ym){authors=t.slice(0,ym.index).replace(/[.,\s]+$/,'');rest=t.slice(ym.index+ym[0].length).replace(/^[.,\s]+/,'');}
 if(q){title=q[1];venue=t.slice(q.index+q[0].length).replace(/^[.,\s]+/,'');if(!authors)authors=t.slice(0,q.index).replace(/[.,\s]+$/,'').replace(/\b(19|20)\d{2}[a-z]?\.?$/,'').trim();}
 else if(rest){var dot=/^(.{8,400}?)[.?!]\s+(?=[A-Z(])/.exec(rest+' X');title=dot?dot[1]:rest;venue=dot?rest.slice(dot[0].length-0).trim():'';}
 title=cvClean(title).replace(/[.]$/,'');if(!title||title.length<8)return null;
 venue=cvClean(venue.replace(/https?:\/\/\S+/g,'').replace(/\b(doi:?\s*)?10\.\d{4,9}\/\S+/ig,''));
 var type='';if(/\b(In|In:)\s.+\(eds?\.?\)|\(eds?\.?\)|\bedited by\b|\bchapter\b/i.test(venue))type='Book Chapter';else if(/conference|proceedings|symposium|congress|workshop/i.test(venue))type='Conference Paper';else if(/\breport\b|working paper|policy brief|technical paper|discussion paper/i.test(t))type='Report';else if(/\bph\.?d\.? (thesis|dissertation)|doctoral (thesis|dissertation)/i.test(t))type='PhD Thesis';else if(/master'?s? thesis|\bm\.?a\.? thesis/i.test(t))type="Master's Thesis";else if(/\d+\s*\(\d+\)|\bvol\.?\s*\d+|\bno\.?\s*\d+|:\s*\d+\s*[–-]\s*\d+|\b\d+\s*,\s*\d+\s*[–-]\s*\d+/i.test(venue)||d)type='Journal Article';else if(/press|publish|books\b/i.test(venue))type='Book';
 var list=authors.replace(/\bet al\.?/i,'').replace(/,?\s*(?:&|\band\b)\s*/g,'; ').split(/\s*;\s*|,\s(?=[A-ZĀĒĪŌŪ][A-Za-zÀ-ÿĀ-ž'’ʻ\-]+,\s?[A-Z](?:\.|\b|$))/).map(function(x){return cvClean(x.replace(/[.,]$/,''));}).filter(function(x){return x&&x.length<80;});
 var publisher='',pm=/([A-Z][A-Za-z'’ʻ .-]{1,40}):\s*([^.:]{2,120})\.?\s*$/.exec(venue.replace(/\s*\(pp?\.[^)]*\)/,''));if(pm&&type!=='Journal Article')publisher=pm[2].trim();
 if(type==='Book Chapter'){var bm=/\((?:eds?|editors?)\.?\)\s*,?\s*([^.(]+)/i.exec(venue)||/\bIn:?\s+([^.(]+)/.exec(venue);if(bm)venue=bm[1].trim();}
 else if(publisher&&type!=='Journal Article')venue='';
 var venueName=venue.split(/,\s*\d|\s\d+\s*\(|\.\s/)[0].replace(/^In:?\s+/i,'').trim();
 return {key:'cv-'+page+'-'+norm(title).slice(0,40),type:'cv',publicationType:type,title:title.slice(0,1000),year:year,authors:list.slice(0,60),doi:d?doi(d[0]):'',url:url?url[0].replace(/[.,;)]+$/,''):'',venue:venueName.slice(0,500),publisher:publisher.slice(0,300),source:'CV page '+page,evidence:t.slice(0,1500),warnings:[]};
}
function cvStructured(pages){
 var bySection={education:[],positions:[],leadership:[],publications:[],other:[]},section='';
 pages.forEach(function(page){String(page.text||'').split(/\n/).map(function(x){return x.replace(/\s+$/,'');}).filter(function(x){return x.trim();}).forEach(function(line){var h=cvHeading(line);if(h){section=h;return;}if(section)bySection[section].push({page:page.page,text:line.trim()});});});
 var degrees=[],positions=[],publications=[],seen={};
 var ed=bySection.education,i,first=ed.findIndex(function(l){return DEGREE.test(l.text)||UNDERGRAD_LINE.test(l.text)||(l.text.match(YEAR)||[]).length;}),headerFirst=first>=0&&!DEGREE.test(ed[first].text)&&!UNDERGRAD_LINE.test(ed[first].text)&&(ed[first].text.match(YEAR)||[]).length>0;
 for(i=0;i<ed.length;i++){if(!DEGREE.test(ed[i].text)||UNDERGRAD_LINE.test(ed[i].text)&&!/master|doctor|ph\.?d/i.test(ed[i].text))continue;var lines=[];
  if(headerFirst&&i>0&&!DEGREE.test(ed[i-1].text)&&!UNDERGRAD_LINE.test(ed[i-1].text))lines.push(ed[i-1].text);lines.push(ed[i].text);
  for(var j=i+1;j<ed.length&&j<=i+3;j++){var t=ed[j].text;if(DEGREE.test(t)||UNDERGRAD_LINE.test(t))break;if(headerFirst&&(t.match(YEAR)||[]).length&&j+1<ed.length&&(DEGREE.test(ed[j+1].text)||UNDERGRAD_LINE.test(ed[j+1].text)))break;lines.push(t);}
  var g=cvDegree({page:ed[i].page,lines:lines});if(g){var k=g.level+'|'+norm(g.degreeName)+'|'+g.year+'|'+norm(g.university);if(!seen[k]){seen[k]=1;degrees.push(g);}}}
 ['positions','leadership'].forEach(function(sec){var ls=bySection[sec],idx=[];ls.forEach(function(l,i){if(RANGE.test(l.text))idx.push(i);});
  var atStart=idx.filter(function(i){var m=RANGE.exec(ls[i].text);return m&&m.index<=2;}).length*2>=idx.length;
  idx.forEach(function(i,n){var lines=[];
   if(atStart){lines.push(ls[i].text);for(var j=i+1;j<ls.length&&j<=i+3&&(n+1>=idx.length||j<idx[n+1]);j++)lines.push(ls[j].text);}
   else{var from=Math.max(n?idx[n-1]+1:0,i-2);for(var j=from;j<=i;j++)lines.push(ls[j].text);}
   var p=cvPosition({page:ls[i].page,lines:lines});if(p){var k=norm(p.title)+'|'+norm(p.institution)+'|'+p.startYear;if(!seen[k]){seen[k]=1;positions.push(p);}}});});
 var pl=bySection.publications,buf=null;function flush(){if(buf){var r=cvPublication(buf.text,buf.page);if(r){var k=r.doi||norm(r.title)+'|'+r.year;if(!seen[k]){seen[k]=1;publications.push(r);}}}buf=null;}
 pl.forEach(function(l){var starts=PUB_START.test(l.text)&&(!buf||/[.)"”]$|\d$|\S+\/\S+$/.test(buf.text));if(!buf||starts){flush();buf={page:l.page,text:l.text};}else buf.text+=' '+l.text;});flush();
 return {degrees:degrees.slice(0,20),positions:positions.slice(0,60),publications:publications.slice(0,300)};
}
var api={plain:plain,norm:norm,doi:doi,bibliography:bibliography,cv:cv,cvStructured:cvStructured,cvHeading:cvHeading,cvRank:cvRank};root.TongaAttachmentParser=api;if(typeof module!=='undefined')module.exports=api;
})(typeof globalThis!=='undefined'?globalThis:this);
