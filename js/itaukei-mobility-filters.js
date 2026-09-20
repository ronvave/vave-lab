/* B3 filtering projects the existing paired model; it never rewrites source data. */
function filterMobilityModel(base, state) {
  const key = c => COUNTRY_ALIAS[c] || c;
  const matches = u => state.regions.has(u.region) && state.countries.has(key(u.country));
  const flows = base.flows.filter(f => {
    const m = matches(base.unis[f.source]), p = matches(base.unis[f.target]);
    return state.stage === 'masters' ? m : state.stage === 'phd' ? p : state.stage === 'both' ? m && p : m || p;
  });
  const visible = new Set(flows.flatMap(f => [f.source, f.target]));
  return {...base, flows, uni_list:base.uni_list.filter(u => visible.has(u.uni)), filtered:true,
    emptySelection:!state.regions.size || !state.countries.size};
}
function installMobilityFilters(base) {
  const host = document.getElementById('mobility-filters');
  const key = c => COUNTRY_ALIAS[c] || c;
  const regions = [...new Set(base.uni_list.map(u => u.region))];
  const countries = [...new Set(base.uni_list.map(u => key(u.country)))].sort();
  const state = {stage:'either', regions:new Set(regions), countries:new Set(countries)};
  host.replaceChildren(); // Reinitialization also removes prior listener closures.
  const controls = document.createElement('div');
  controls.className='mobility-filter-controls';
  controls.innerHTML = '<label>Where scholars did their<select aria-label="Where scholars did their"><option value="either">Either degree</option><option value="masters">Master’s</option><option value="phd">PhD</option><option value="both">Both degrees</option></select></label>';
  for(const kind of ['regions','countries']) {
    const detail=document.createElement('details'); detail.dataset.kind=kind;
    detail.innerHTML='<summary></summary><div class="mobility-filter-menu"><div class="mobility-filter-actions"><button type="button" data-all="'+kind+'">Select all</button><button type="button" data-none="'+kind+'">Deselect all</button></div><div data-options="'+kind+'"></div></div>';
    controls.append(detail);
  }
  const reset=document.createElement('button'); reset.type='button'; reset.dataset.reset=''; reset.textContent='Reset filters'; controls.append(reset);
  const help=document.createElement('p'); help.className='mobility-filter-help'; help.textContent='Filters select scholars by study location; complete Master’s-to-PhD pathways remain visible.';
  host.append(controls,help);
  const available = () => state.regions.size ? countries.filter(c => base.uni_list.some(u => key(u.country)===c && state.regions.has(u.region))) : countries;
  function options(kind, values) {
    const container=controls.querySelector('[data-options="'+kind+'"]');
    container.replaceChildren();
    for(const value of values) {
      const label=document.createElement('label'), input=document.createElement('input');
      input.type='checkbox'; input.value=value; input.dataset.kind=kind; input.checked=state[kind].has(value);
      label.append(input,document.createTextNode(value)); container.append(label);
    }
  }
  function update() {
    for(const kind of ['regions','countries']) {
      const values=kind==='regions' ? regions : available(), n=values.filter(v=>state[kind].has(v)).length;
      controls.querySelector('[data-kind="'+kind+'"] summary').textContent=(kind==='regions'?'Select Region':'Select Country(s)')+' — '+(n && n===values.length?'All':n+' selected');
      controls.querySelectorAll('input[data-kind="'+kind+'"]').forEach(input=>{input.checked=state[kind].has(input.value);});
    }
    hideTip(); draw(filterMobilityModel(base,state));
  }
  function changeRegions(mutate) {
    const previous=available(), wasAll=previous.length && previous.every(c=>state.countries.has(c));
    mutate();
    const next=available();
    state.countries=new Set(wasAll?next:next.filter(c=>state.countries.has(c)));
    options('countries',next);
  }
  controls.addEventListener('click',event=>{
    event.stopPropagation();
    const btn=event.target.closest('button'); if(!btn)return;
    if(btn.hasAttribute('data-reset')) {
      state.stage='either'; state.regions=new Set(regions); state.countries=new Set(countries);
      controls.querySelector('select').value='either'; options('countries',countries);
      controls.querySelectorAll('details').forEach(d=>{d.open=false;});
    } else {
      const kind=btn.dataset.all||btn.dataset.none;
      const mutate=()=>{state[kind]=new Set(btn.dataset.all?(kind==='regions'?regions:available()):[]);};
      if(kind==='regions')changeRegions(mutate); else mutate();
    }
    update();
  });
  controls.addEventListener('change',event=>{
    const input=event.target;
    if(input.tagName==='SELECT')state.stage=input.value;
    else {
      const mutate=()=>{if(input.checked)state[input.dataset.kind].add(input.value);else state[input.dataset.kind].delete(input.value);};
      if(input.dataset.kind==='regions')changeRegions(mutate);else mutate();
    }
    update();
  });
  controls.addEventListener('keydown',event=>{
    const open=controls.querySelector('details[open]');
    if(event.key==='Escape' && open){event.preventDefault();event.stopPropagation();open.open=false;open.querySelector('summary').focus();}
  });
  controls.querySelectorAll('details').forEach(detail=>detail.addEventListener('toggle',()=>{
    if(detail.open)controls.querySelectorAll('details').forEach(other=>{if(other!==detail)other.open=false;});
  }));
  options('regions',regions);options('countries',countries);update();
}
