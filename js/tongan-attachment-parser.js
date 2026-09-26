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
 });return{proposals:proposals,sections:sections};}
var api={plain:plain,norm:norm,doi:doi,bibliography:bibliography,cv:cv};root.TongaAttachmentParser=api;if(typeof module!=='undefined')module.exports=api;
})(typeof globalThis!=='undefined'?globalThis:this);
