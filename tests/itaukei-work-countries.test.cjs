/* Pure classification fixtures plus every current adapter profile. No data writes. */
const fs = require('node:fs');
const vm = require('node:vm');
const assert = require('node:assert/strict');
const source = fs.readFileSync('js/itaukei-database-master.js', 'utf8');
const helpers = source.slice(source.indexOf('  const WORK_COUNTRY_RULES = ['), source.indexOf('  function buildConfProvTree()'));
const filterStart = source.indexOf('    if (state.scholarWorkCountry) {', source.indexOf('// Country/University of work'));
const filterCode = source.slice(filterStart, source.indexOf('\n\n    // Recompute', filterStart));

module.exports = function checkWorkLocations(profiles) {
  const state = {scholarProfilesByName: new Map()};
  const api = vm.runInNewContext(helpers + ';({canonicalWorkCountry,scholarWorkCountry,scholarWorkInstitutions,stripCountrySuffix,buildWorkTree})', {state});
  const fixtures = [
    [{institutionCountry:'Tetra Tech International Development',institution:'Associate Director for Climate and Disaster, Indo-Pacific'}, 'Indo-Pacific', 'Tetra Tech International Development'],
    [{institutionCountry:'Pacific Disability Forum',institution:'Chief Executive Officer'}, 'Fiji', 'Pacific Disability Forum'],
    [{institutionCountry:'United Nations Development Programme (UNDP) Pacific Office',institution:'Programme Analyst — Resilience and Climate Change'}, 'Fiji', 'United Nations Development Programme (UNDP) Pacific Office'],
    [{institutionCountry:'Methodist Church in Fiji and Rotuma'}, 'Fiji', 'Methodist Church in Fiji and Rotuma'],
    [{institutionCountry:'University of Fiji'}, 'Fiji', 'University of Fiji'],
    [{institutionCountry:'University of the South Pacific'}, 'Fiji', 'University of the South Pacific'],
    [{institutionCountry:'Fiji National University'}, 'Fiji', 'Fiji National University'],
    [{institutionCountry:'Green Environmental Services (GES) Fiji'}, 'Fiji', 'Green Environmental Services (GES) Fiji'],
    [{institution:'Example Institute (Germany)', institutionCountry:'Example Institute'}, 'Germany', 'Example Institute'],
    [{institution:'University of Auckland', institutionCountry:' NZ '}, 'New Zealand', 'University of Auckland'],
    [{institution:'Example Institute (Cuba)'}, 'Cuba', 'Example Institute'],
    [{institution:'Example Institute, Australia'}, 'Australia', 'Example Institute'],
    [{institution:'Employer (American Samoa)'}, 'American Samoa', 'Employer'],
    [{institution:'Fiji National University', institutionCountry:'Australia'}, 'Australia', 'Fiji National University'],
    [{institution:'Unknown Employer (Research Division)'}, '', 'Unknown Employer (Research Division)'],
    [{institution:'Unknown Employer, Research Division'}, '', 'Unknown Employer, Research Division'],
    [{institution:'Conservation Group (CG)', institutionCountry:'Fiji'}, 'Fiji', 'Conservation Group (CG)'],
    [{institutionCountry:'toString'}, '', null]
  ];
  fixtures.forEach(([p, country, institution]) => {
    assert.equal(api.scholarWorkCountry(p), country, JSON.stringify(p));
    if (institution) assert(api.scholarWorkInstitutions(p).includes(institution));
  });
  for (const [alias, country] of [[' UK ', 'United Kingdom'], ['United States', 'USA'], ['PNG','Papua New Guinea'], ['Guam','Guam (USA territory)']]) {
    assert.equal(api.canonicalWorkCountry(alias), country);
  }
  console.log('Work university input audit:', JSON.stringify([...new Set(profiles.flatMap(api.scholarWorkInstitutions))].sort()));
  const all = [...profiles, ...fixtures.map(f=>f[0])];
  const before = JSON.stringify(all);
  state.scholarProfilesByName = new Map(all.map((p,i)=>[String(i),p]));
  const tree = api.buildWorkTree();
  const rows = all.map((p,i)=>({name:String(i)}));
  const enrichedByName = state.scholarProfilesByName;
  const runFilter = (country, institution) => vm.runInNewContext(filterCode+';rows', {
    state:{scholarWorkCountry:country,scholarWorkUni:institution},
    rows, enrichedByName, ...api
  });
  for (const [country, institutions] of tree) {
    assert.equal(api.canonicalWorkCountry(country), country, 'Invalid first-level country');
    const expected = rows.filter(r=>api.scholarWorkCountry(enrichedByName.get(r.name))===country);
    assert.deepEqual(Array.from(runFilter(country,''),r=>r.name), expected.map(r=>r.name));
    for (const institution of institutions) {
      const matches = runFilter(country,institution);
      assert(matches.length > 0, 'Dead institution submenu: '+institution);
      assert.deepEqual(Array.from(matches,r=>r.name), expected.filter(r=>api.scholarWorkInstitutions(enrichedByName.get(r.name)).includes(institution)).map(r=>r.name));
    }
  }
  assert.equal(runFilter('', '').length, rows.length, 'Reset changed population');
  assert.equal(JSON.stringify(all), before, 'Classification mutated scholar data');
  const invalid = [...new Set(profiles.map(p=>String(p.institutionCountry||'').trim()).filter(c=>c && !api.canonicalWorkCountry(c)))];
  console.log('Work-country audit: noncanonical source values', JSON.stringify(invalid));
  console.log('Work-country audit: resolutions', JSON.stringify(invalid.map(value=>({
    value, countries:[...new Set(profiles.filter(p=>String(p.institutionCountry||'').trim()===value).map(api.scholarWorkCountry))]
  }))));
  console.log('Work-country audit: unresolved institution labels', JSON.stringify([...new Set(profiles.filter(p=>!api.scholarWorkCountry(p)).map(p=>p.institution||p.institutionCountry).filter(Boolean))]));
  console.log('PASS: work-country fixtures and',profiles.length,'current profiles; country/institution filters, counts, reset and source preservation.');
};
