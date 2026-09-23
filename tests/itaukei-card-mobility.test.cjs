/* Run with node tests/itaukei-card-mobility.test.cjs. No private fixtures written. */
const fs = require('node:fs');
const vm = require('node:vm');
const crypto = require('node:crypto');
const assert = require('node:assert/strict');
const path = require('node:path');
process.chdir(path.resolve(__dirname, '..'));
const source = p => fs.readFileSync(p, 'utf8');
const gateSource = source('js/demo-gate.js');
const pass = Buffer.from(gateSource.match(/BAKED_PASSCODE = atob\('([^']+)'/)[1], 'base64');
const cache = new Map();
async function fetchJson(url) {
  if (cache.has(url)) return cache.get(url);
  const bytes = fs.readFileSync(url + '.enc');
  assert.equal(bytes.subarray(0, 4).toString(), 'IVAV');
  const key = crypto.pbkdf2Sync(pass, bytes.subarray(4, 20), 200000, 32, 'sha256');
  const decipher = crypto.createDecipheriv('aes-256-gcm', key, bytes.subarray(20, 32));
  decipher.setAuthTag(bytes.subarray(-16));
  const data = JSON.parse(Buffer.concat([decipher.update(bytes.subarray(32, -16)), decipher.final()]));
  cache.set(url, data);
  return data;
}
(async () => {
  const window = {dbGate: {fetchJson}};
  const context = vm.createContext({window, console, fetch: async () => ({ok:false}), URLSearchParams, setTimeout});
  vm.runInContext(source('js/master-file-adapter.js'), context);
  // Exercise the actual options selected by the dashboard (also used by s.html).
  const dashboard = source('js/itaukei-database-master.js');
  const call = dashboard.match(/const bundle = await (window\.MasterFileAdapter\.load\([^;]+);/)[1];
  const bundle = await vm.runInContext('(async () => '+call+')()', context);
  const enrichment = await fetchJson('data/scholar-enrichment.json');
  const insights = await fetchJson('data/scholar-insights-master.json');
  const profiles = bundle.profiles.scholars;
  require('./itaukei-work-countries.test.cjs')(profiles);
  const profilesById = new Map(profiles.map(p => [p.scholarId, p]));
  let photos = 0, summaries = 0;
  for (const s of bundle.master.scholars) {
    const sid = s['Scholar ID'], extras = enrichment.scholars[sid];
    if (extras?.photo) {
      assert.equal(profilesById.get(sid)?.photo, s['Photo URL'] || extras.photo, sid+' lost its photo');
      photos++;
    }
    if (insights.scholars[sid]?.summaryHtml) {
      assert.equal(bundle.insightsDoc.byScholarId[sid].summaryHtml, insights.scholars[sid].summaryHtml);
      assert.deepEqual(bundle.insightsDoc.byScholarId[sid].keywords, insights.scholars[sid].keywords);
      summaries++;
    }
  }
  assert(photos > 0 && summaries > 0, 'Approved Admin content must not be empty');
  assert(profilesById.get('ITK-S0315')?.photo, 'Joeli photo');
  assert(bundle.insightsDoc.byScholarId['ITK-S0315']?.summaryHtml, 'Joeli insight');
  // Execute the real B3 loader against the encrypted snapshot. Both ID columns
  // deliberately remain present: a legacy number must never override Scholar ID.
  const chord = source('itaukei-chord-flanked.html');
  const init = chord.slice(chord.indexOf('async function init(){'), chord.indexOf('// ---- upload wiring'));
  const statusEl = {textContent:''}; let drawn;
  Object.assign(context, {
    location:{search:'?embedded=1'}, currentUnsd:{}, statusEl,
    document:{body:{classList:{toggle(){}}}, querySelectorAll(){return []}, getElementById(){return null}},
    buildModel(rows){return {flows:rows,uni_list:[...new Set(rows.flatMap(r=>[r.m_uni,r.p_uni]))]};},
    draw(model){drawn=model;}
  });
  window.parent = {dbGate:{fetchJson, isUnlocked:()=>true}};
  await vm.runInContext(init+';init()',context);
  const expected = bundle.master.mobility.filter(r => r.m_uni && r.p_uni && r.m_country && r.p_country && !/^(not found|unknown|unresolved|n\/a|unsure)$/i.test(r.m_uni.trim()) && !/^(not found|unknown|unresolved|n\/a|unsure)$/i.test(r.p_uni.trim()));
  assert.equal(drawn?.flows.length, expected.length, 'B3 silently dropped mobility rows');
  assert(expected.length > 2);
  assert.equal(drawn.excludedPathways, bundle.master.mobility.filter(r=>r.m_uni && r.p_uni).length - expected.length);
  for (const row of drawn.flows) {
    assert(!/^(Nursing|MA Education;|Agriculture \/ Horticulture|Contemporary migration)/i.test(row.m_uni));
    assert(!/^(Nursing|MA Education;|Agriculture \/ Horticulture|Contemporary migration)/i.test(row.p_uni));
  }
  assert.equal(drawn.flows.find(r=>r.scholar_id==='ITK-S0081').m_uni, 'Lancaster University');
  assert.equal(drawn.flows.find(r=>r.scholar_id==='ITK-S0057').p_uni, 'University of New South Wales');
  const people = new Map(bundle.master.scholars.map(s=>[s['Scholar ID'],s]));
  expected.forEach((r,i)=>assert.equal(drawn.flows[i].scholar,people.get(r['Scholar ID'])['Scholar Name']));
  // Exercise the production model: institution aliases must merge, and Taiwan
  // must contribute to Asia rather than an unclassified extra region.
  const modelContext = vm.createContext({rows:drawn.flows});
  const constants = chord.slice(chord.indexOf('const SHORT ='), chord.indexOf('/* ---- 2. EMBEDDED FALLBACK'));
  const modelSource = chord.slice(chord.indexOf('function buildModel('), chord.indexOf('/* ---- 3b. TOOLTIP'));
  const actual = vm.runInContext(constants + modelSource + ';buildModel(rows,EMBEDDED_UNSD)',modelContext);
  assert.equal(actual.uni_list.length, drawn.uni_list.length);
  assert(actual.uni_list.every(u=>u.region !== 'Other'), 'Unclassified university geography');
  assert.equal(actual.uni_list.filter(u=>u.full==='University of New South Wales').length,1);
  assert(actual.uni_list.filter(u=>u.country==='Taiwan').every(u=>u.region==='Asia'));
  console.log('Model totals:',new Set(actual.flows.map(f=>f.scholar_id)).size,'scholars,',actual.uni_list.length,'universities,',new Set(actual.uni_list.map(u=>u.country)).size,'countries,',new Set(actual.uni_list.map(u=>u.region)).size,'regions.');
  assert(source('scripts/master_file_config.py').split('MOBILITY_PUBLIC_FIELDS = [')[1].split(']')[0].includes('"Scholar ID"'), 'Next sync would strip the canonical ID');
  // Preserve the no-dashboard-flash guard on shared links.
  const share = source('s.html');
  assert.match(share,/visibility:hidden/);
  assert.match(share,/profile-ready/);
  console.log(`PASS: ${photos} saved photos, ${summaries} research summaries, ${drawn.flows.length} mobility rows / ${drawn.uni_list.length} universities, shared-page guard.`);
})().catch(e=>{console.error(e);process.exitCode=1;});

// Run filter semantics in both existing deployment validation workflows.
require('./itaukei-mobility-filters.test.cjs');
