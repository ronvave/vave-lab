/* Administrative registry, checked 2026-10-03 against Vanuatu DLA.
 * Area councils belong to provinces. An island parent is NOT inferred.
 * Municipal jurisdictions are separate from physical islands/provinces.
 */
(function(root){
  'use strict';
  const provinces=['Torba','Sanma','Penama','Malampa','Shefa','Tafea'];
  const colors={Torba:'#496a9c',Sanma:'#007d83',Penama:'#80703a',Malampa:'#a0543c',Shefa:'#87639d',Tafea:'#486c49',Unclassified:'#858a90'};
  const councils={
    Torba:['Torres','Ureparapara','Motalava','Mota','East Vanualava','West Vanualava','East Gaua','West Gaua','Merelava-Merig'],
    Sanma:['Northwest Santo','West Santo','South Santo One (1)','South Santo Two (2)','Southeast Santo','Canal Fanafo','East Santo','Big Bay Coast','Big Bay Inland','West Malo','East Malo'],
    Penama:['North Pentecost','Central Pentecost One (CP1)','Central Pentecost Two (CP2)','South Pentecost','South Maewo','North Maewo','South Ambae','East Ambae','North Ambae','West Ambae'],
    Malampa:['Northwest Malekula','Northeast Malekula','Central Malekula','Southeast Malekula','Southwest Malekula','South Malekula','North Ambrym','West Ambrym','Southeast Ambrym','Paama'],
    Shefa:['North Efate','Eratap','East Efate','Northwest Efate','Mele','Ifira','Tanvasoko','Erakor','Pango','Emau','Nguna-Pele','Varsu','Vermaul','Vermali','Yarsu','Tongoa','Tongariki-Buninga','Makira-Mataso','Emae'],
    Tafea:['North Tanna','East Tanna','Central Tanna','West Tanna','Southwest Tanna','South Tanna','Southeast Tanna','Aneityum','North Erromango','South Erromango','Aniwa','Futuna']
  };
  const islands={Torba:['Banks Islands','Torres Group'],Sanma:['Espiritu Santo','Malo','Aore'],Penama:['Pentecost','Ambae','Maewo'],Malampa:['Malekula','Ambrym','Paama'],Shefa:['Shepherds Islands','Epi','Efate'],Tafea:['Tanna','Aneityum','Futuna','Erromango','Aniwa']};
  // Panel F: individual islands with resident cases in VNSO's 2020 census.
  // Source: https://microdata.pacificdata.org/index.php/catalog/769/variable/F17/V1059?name=island
  // Province membership: census geographic codes and province island lists.
  // Separate from the administrative council registry used elsewhere.
  const inhabitedIslands = {"Torba": ["Gaua", "Hiu", "Kwakea", "Loh", "Mere Lava", "Merig", "Metoma", "Mota", "Mota Lava", "Rah", "Tegua", "Toga", "Ureparapara", "Vanua Lava"], "Sanma": ["Aese", "Aore", "Araki", "Bokissa", "Espiritu Santo", "Le Tharo", "Malo", "Malokilikili", "Mavea", "Tangoa", "Tangisi", "Tutuba"], "Penama": ["Ambae", "Maewo", "Pentecost"], "Malampa": ["Akhamb", "Ambrym", "Atchin", "Avokh", "Awei", "Lembong", "Malekula", "Norsup", "Paama", "Rano", "Tomman", "Uliveo", "Uri", "Uripiv", "Vao", "Wala"], "Shefa": ["Buninga", "Efate", "Emae", "Emau", "Epi", "Hideaway", "Ifira", "Lamen", "Lelepa", "Makira", "Mataso", "Moso", "Nguna", "Pele", "Tongoa", "Tongariki"], "Tafea": ["Aneityum", "Aniwa", "Erromango", "Futuna", "Tanna"]};
  const islandAliases = {santo:'Espiritu Santo',hiw:'Hiu',lo:'Loh',ra:'Rah',motalava:'Mota Lava',vanualava:'Vanua Lava',merelava:'Mere Lava',malakula:'Malekula',uluveo:'Uliveo',avock:'Avokh',emao:'Emau',makura:'Makira',anatom:'Aneityum',aoba:'Ambae'};
  const islandKey = v => String(v || '').normalize('NFD').replace(/[\u0300-\u036f]/g,'').replace(/\s+island$/i,'').trim().toLowerCase();
  function island(v) { const k=islandKey(v);return islandAliases[k] || Object.values(inhabitedIslands).flat().find(n=>islandKey(n)===k) || clean(v); }
  function scholarIslands(profile) { return [...new Set(String(profile && profile.paternalIsland || '').split(/[;|,]/).map(island).filter(Boolean))]; }
  const municipalities=[{name:'Port Vila',island:'Efate'},{name:'Luganville',island:'Espiritu Santo'},{name:'Lenakel',island:'Tanna'}];
  const clean=v=>String(v??'').trim();
  function province(v){return provinces.find(p=>p.toLowerCase()===clean(v).toLowerCase())||clean(v);}
  function country(v){const x=clean(v);return ({Nauru:'Naoero',Naoero:'Naoero',USA:'United States','United States of America':'United States',UK:'United Kingdom'})[x]||x;}
  function council(v){return clean(v).replace(/\s+area council$/i,'');}
  const api={provinces,colors,councils,islands,inhabitedIslands,island,scholarIslands,municipalities,province,country,council,
    sources:{provinces:'https://dla.gov.vu/index.php/about-us/provinces',councils:'https://dla.gov.vu/index.php/about-us/area-councils'},checked:'2026-10-03'};
  root.VanuatuGeography=api;if(typeof module==='object')module.exports=api;
})(typeof window==='object'?window:globalThis);
