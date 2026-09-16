// Run milestone selection against live Master data (batchGet snapshot at
// /tmp/panelD-live.json). Prints the four milestones exactly as Panel D
// will now render them.

const fs = require('fs');
const data = JSON.parse(fs.readFileSync('/tmp/panelD-live.json', 'utf8'));
const [scholarsRange, gradRange] = data.valueRanges;

function rowsToObjects(range) {
  // Master worksheets carry one or two title/description banner rows above
  // the real header. Skip any leading rows that are single-column banners.
  const values = range.values.slice();
  while (values.length && values[0].length <= 1) values.shift();
  const [head, ...rows] = values;
  return rows.map(r => Object.fromEntries(head.map((h, i) => [h, r[i] == null ? '' : r[i]])));
}
const scholars = rowsToObjects(scholarsRange);
const degrees = rowsToObjects(gradRange);

const gender = new Map(scholars.map(s => [s['Scholar ID'], s.Gender || '']));
const family = new Map(scholars.map(s => [s['Scholar ID'], s['Family Name'] || '']));
const given = new Map(scholars.map(s => [s['Scholar ID'], s['Given Names'] || '']));
const name = new Map(scholars.map(s => [s['Scholar ID'], s['Scholar Name'] || '']));

const isMasters = row => /master/i.test(String(row['Degree Stage'] || ''));
const isPhd = row => /phd|doctor/i.test(String(row['Degree Stage'] || ''));
const isCompleted = row => String(row['Completion Status'] || '').trim().toLowerCase().startsWith('completed');
function pyear(v) { const m = /\d{4}/.exec(String(v || '')); return m ? parseInt(m[0], 10) : null; }
function titleFor(stage, gen) {
  if (stage === 'phd') return 'Dr.';
  if (stage === 'masters' && gen === 'Male') return 'Mr.';
  if (stage === 'masters' && gen === 'Female') return 'Ms';
  return '';
}
function firstGiven(g) { return (g || '').trim().split(/\s+/)[0] || ''; }
function CC(country) {
  const map = { 'New Zealand': 'NZ', 'United Kingdom': 'UK', Fiji: 'FJ', 'United States': 'US', 'United States of America': 'US', Australia: 'AU' };
  return map[String(country || '').trim()] || '';
}
function clean(v) {
  const t = String(v == null ? '' : v).trim();
  return t && t.toLowerCase() !== 'unclassified' ? t : '';
}
const paternal = new Map(scholars.map(s => [s['Scholar ID'], {
  village:     clean(s['Village Paternal']),
  district:    clean(s['District Paternal']),
  province:    clean(s['Province Paternal']),
  confederacy: clean(s['Paternal Confederacy'])
}]));
function composePaternal(info) {
  const top = [];
  if (info.village)  top.push(`${info.village} vlg`);
  if (info.district) top.push(`${info.district} District`);
  const bot = [];
  if (info.province) bot.push(`${info.province} Province`);
  if (info.confederacy) bot.push(`(${info.confederacy})`);
  let topLine = top.join(', ');
  if (topLine && bot.length) topLine = `${topLine},`;
  return { topLine, bottomLine: bot.join(' ') };
}

const completed = degrees.filter(r => isCompleted(r) && (isMasters(r) || isPhd(r)))
  .map(row => ({ row, year: pyear(row['Finish / Completion Year']) })).filter(e => e.year != null);

const defs = [
  { key: 'firstMaleMasters', stage: 'masters', gender: 'Male', label: 'First male Masters' },
  { key: 'firstFemaleMasters', stage: 'masters', gender: 'Female', label: 'First female Masters' },
  { key: 'firstMalePhD', stage: 'phd', gender: 'Male', label: 'First male PhD' },
  { key: 'firstFemalePhD', stage: 'phd', gender: 'Female', label: 'First female PhD' },
];

console.log('Panel D milestones (from live Master, applying the shipped mf38 rules):\n');
for (const def of defs) {
  const cands = completed
    .filter(({ row }) => (def.stage === 'masters' ? isMasters(row) : isPhd(row)) && gender.get(row['Scholar ID']) === def.gender)
    .sort((a, b) => a.year - b.year || (name.get(a.row['Scholar ID']) || '').localeCompare(name.get(b.row['Scholar ID']) || ''));
  if (!cands.length) { console.log(`${def.label}: (none)`); continue; }
  const c = cands[0];
  const sid = c.row['Scholar ID'];
  const cUni = String(c.row['C_Uni name'] || '').trim();
  const oUni = String(c.row['O_Uni name'] || '').trim();
  const canonical = cUni || oUni;
  const renamed = !!(oUni && cUni && cUni !== oUni);
  const cc = CC(c.row.Country);
  const title = titleFor(def.stage, def.gender);
  const public_ = `${firstGiven(given.get(sid))} ${family.get(sid)}`.trim();
  console.log(`${def.year}: ${def.label}`
    .replace(/^undefined: /, ''));
  console.log(`  Year:            ${c.year}`);
  console.log(`  Scholar ID:      ${sid}`);
  console.log(`  Canonical name:  ${name.get(sid)}`);
  console.log(`  Public label:    ${title} ${public_}`);
  console.log(`  Degree:          ${c.row['Degree / Qualification'] || c.row['Degree Stage']}`);
  console.log(`  C_Uni:           ${cUni}`);
  console.log(`  O_Uni:           ${oUni}`);
  console.log(`  Display uni:     ${canonical}${renamed ? '*' : ''} (${cc || '??'})`);
  console.log(`  uniRenamed:      ${renamed}`);
  const pat = composePaternal(paternal.get(sid) || {});
  console.log(`  Line 4 (paternal top):    ${pat.topLine || '(none)'}`);
  console.log(`  Line 5 (paternal bottom): ${pat.bottomLine || '(none)'}`);
  console.log(`  Annotation:      ${c.year}: ${def.label} — ${title} ${public_} — ${canonical}${renamed ? '*' : ''} (${cc})`);
  console.log('');
}

// Renamed institutions → footnote
const rows = [];
for (const def of defs) {
  const cands = completed
    .filter(({ row }) => (def.stage === 'masters' ? isMasters(row) : isPhd(row)) && gender.get(row['Scholar ID']) === def.gender)
    .sort((a, b) => a.year - b.year || (name.get(a.row['Scholar ID']) || '').localeCompare(name.get(b.row['Scholar ID']) || ''));
  if (!cands.length) continue;
  const c = cands[0];
  const cUni = String(c.row['C_Uni name'] || '').trim();
  const oUni = String(c.row['O_Uni name'] || '').trim();
  if (oUni && cUni && cUni !== oUni) rows.push({ cUni, oUni });
}
console.log('Footnote lines that will render under the chart:');
if (!rows.length) console.log('  (none)');
for (const r of rows) console.log(`  * ${r.cUni} (formerly recorded as ${r.oUni}).`);
