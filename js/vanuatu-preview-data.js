/* Fictional, clearly labelled UI examples. Never used as a production fallback. */
(function(root){
 'use strict';
 const scholars=[
  {'Scholar ID':'VAN-S9001','Scholar Name':'Example Scholar A','Salutation':'Dr','Gender':'Female','Paternal Province':'Sanma','Paternal Island':'Espiritu Santo','Maternal Province':'Penama','Maternal Island':'Ambae','Primary Discipline / Field':'Environmental science; Climate adaptation','Current Institution':'Example University','Current Title / Role':'Researcher'},
  {'Scholar ID':'VAN-S9002','Scholar Name':'Example Scholar B','Gender':'Male','Paternal Province':'Shefa','Paternal Island':'Efate','Primary Discipline / Field':'Education'},
  {'Scholar ID':'VAN-S9003','Scholar Name':'Example Scholar C','Gender':'Unknown / verify','Maternal Province':'Tafea','Maternal Island':'Tanna','Primary Discipline / Field':'Public policy'}
 ];
 const degrees=[
  {'Degree ID':'VAN-D9001','Scholar ID':'VAN-S9001','Degree Level':"Master's",'Degree Name':'Master of Science','Broad Discipline':'Natural Sciences','Field / Discipline':'Environmental science','Canonical University Name (C_Uni)':'Example Australian University','University Country':'Australia','Completion Year':'2015','Completion Status':'Completed','Thesis / Dissertation Title':'Example climate adaptation thesis'},
  {'Degree ID':'VAN-D9002','Scholar ID':'VAN-S9001','Degree Level':'PhD / Doctorate','Degree Name':'Doctor of Philosophy','Broad Discipline':'Environmental Sciences','Field / Discipline':'Climate adaptation','Canonical University Name (C_Uni)':'Example New Zealand University','University Country':'New Zealand','Completion Year':'2022','Completion Status':'Completed','Thesis / Dissertation Title':'Example doctoral research'},
  {'Broad Discipline':'Education','Field / Discipline':'Education','Degree ID':'VAN-D9003','Scholar ID':'VAN-S9002','Degree Level':"Master's",'Canonical University Name (C_Uni)':'Example Fiji University','University Country':'Fiji','Completion Year':'2018','Completion Status':'Completed'}
 ];
 const pubs=[
  {'Publication ID':'VAN-P900001','Title':'Example: community-led climate adaptation','Publication Type':'Journal Article','Year':'2024','Authors — Full Ordered List':'Example Scholar A; Example Collaborator','Country Focus':'Vanuatu','About Country?':true},
  {'Publication ID':'VAN-P900002','Title':'Example: learning across island communities','Publication Type':'Report','Year':'2023','Authors — Full Ordered List':'Example Scholar B','Country Focus':'Vanuatu','About Country?':true},
  {'Publication ID':'VAN-P900003','Title':'Example: regional policy and resilience','Publication Type':'Book Chapter','Year':'2025','Authors — Full Ordered List':'Example Collaborator; Example Scholar C','Country Focus':'Pacific','About Country?':false}
 ];
 const authors=[{'Authorship ID':'VAN-AUTH-90001','Publication ID':'VAN-P900001','Scholar ID':'VAN-S9001','Author Position':1},{'Authorship ID':'VAN-AUTH-90002','Publication ID':'VAN-P900002','Scholar ID':'VAN-S9002','Author Position':1},{'Authorship ID':'VAN-AUTH-90003','Publication ID':'VAN-P900003','Scholar ID':'VAN-S9003','Author Position':2}];
 const geo=[{'Geography Record ID':'VAN-G90001','Publication ID':'VAN-P900001','Country':'Vanuatu','Province':'Sanma','Island':'Espiritu Santo'},{'Geography Record ID':'VAN-G90002','Publication ID':'VAN-P900002','Country':'Vanuatu','Province':'Shefa','Island':'Efate'},{'Geography Record ID':'VAN-G90003','Publication ID':'VAN-P900003','Country':'Fiji','Province':''}];
 const tables={Scholars:scholars,'Graduate Degrees':degrees,Publications:pubs,Authorship:authors,'Research Geography':geo,'Study Pathways':[{'Pathway ID':'VAN-PATH9001','Scholar ID':'VAN-S9001',"Master's Degree ID":'VAN-D9001','PhD Degree ID':'VAN-D9002'}],Institutions:[]};
 const fields=Object.fromEntries(Object.entries(tables).map(([k,v])=>[k,[...new Set(v.flatMap(r=>Object.keys(r)))]]));
 // Explicitly approved example fields even when all synthetic values are blank.
 fields.Scholars.push('Paternal Area Council / Locality','Maternal Area Council / Locality','Paternal Village / Community','Maternal Village / Community');
 root.VANUATU_PREVIEW={country:'Vanuatu',schemaVersion:1,generation:'fictional-preview',generatedAt:null,preview:true,fields,tables,theses:[],enrichment:{},notices:['FICTIONAL PREVIEW — these examples are not real scholars, publications or verified totals.']};
})(window);
