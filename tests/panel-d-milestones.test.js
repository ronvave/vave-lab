// Regression tests for Panel D milestone derivation.
// Node-only: no DOM. Exercises the pure selection + naming logic against
// synthetic fixtures. Run with: node tests/panel-d-milestones.test.js

'use strict';

function pass(msg) { console.log(`  [PASS] ${msg}`); }
function fail(msg) { console.error(`  [FAIL] ${msg}`); process.exitCode = 1; }
function assertEq(actual, expected, msg) {
  if (actual === expected) return pass(`${msg}: ${JSON.stringify(actual)}`);
  fail(`${msg}: expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`);
}

// -------- Replicated pure helpers (must stay in sync with itaukei-database-master.js) --------
const isMasters = row => /master/i.test(String(row['Degree Stage'] || ''));
const isPhd = row => /phd|doctor/i.test(String(row['Degree Stage'] || ''));
const isCompleted = row => String(row['Completion Status'] || '').trim().toLowerCase().startsWith('completed');
function pyear(v) {
  const m = /\d{4}/.exec(String(v || ''));
  return m ? parseInt(m[0], 10) : null;
}
function shortenPublicName(givenNames, familyName, fallback) {
  const firstGiven = (givenNames || '').trim().split(/\s+/)[0] || '';
  if (firstGiven && familyName) return `${firstGiven} ${familyName}`;
  return fallback || '';
}
function titleFor(stage, gender) {
  if (stage === 'phd') return 'Dr.';
  if (stage === 'masters') { if (gender === 'Male') return 'Mr.'; if (gender === 'Female') return 'Ms'; }
  return '';
}
function pickMilestone(defs, scholars, gradDegrees) {
  const gender = new Map(scholars.map(s => [s['Scholar ID'], s.Gender || '']));
  const family = new Map(scholars.map(s => [s['Scholar ID'], s['Family Name'] || '']));
  const given = new Map(scholars.map(s => [s['Scholar ID'], s['Given Names'] || '']));
  const name = new Map(scholars.map(s => [s['Scholar ID'], s['Scholar Name'] || '']));
  const completedDated = gradDegrees.filter(r => isCompleted(r) && (isMasters(r) || isPhd(r)))
    .map(row => ({ row, year: pyear(row['Finish / Completion Year']) })).filter(e => e.year != null);
  return defs.map(def => {
    const candidates = completedDated
      .filter(({ row }) => (def.stage === 'masters' ? isMasters(row) : isPhd(row)) && gender.get(row['Scholar ID']) === def.gender)
      .map(({ row, year }) => ({
        year, scholarId: row['Scholar ID'],
        name: name.get(row['Scholar ID']) || '',
        familyName: family.get(row['Scholar ID']) || '',
        givenNames: given.get(row['Scholar ID']) || '',
        cUni: row['C_Uni name'] || '', oUni: row['O_Uni name'] || '',
        country: row.Country || ''
      }))
      .sort((a, b) => a.year - b.year || a.name.localeCompare(b.name));
    if (!candidates.length) return null;
    const chosen = candidates[0];
    const title = titleFor(def.stage, def.gender);
    const publicPerson = shortenPublicName(chosen.givenNames, chosen.familyName, chosen.name);
    const personLine = [title, publicPerson].filter(Boolean).join(' ');
    const uniRenamed = !!(chosen.oUni && chosen.cUni && chosen.oUni !== chosen.cUni);
    return { def: def.key, ...chosen, publicPerson, personLine, uniRenamed };
  });
}

// -------- Test 1: public-name shortening --------
console.log('\n[1] Public-name shortening');
assertEq(shortenPublicName('Rusiate Raibosa', 'Nayacakalou'), 'Rusiate Nayacakalou',
  'Two given names → drop middle');
assertEq(shortenPublicName('Veikila C.', 'Vuki'), 'Veikila Vuki',
  'Initial → dropped');
assertEq(shortenPublicName('Joeli', 'Veitayaki'), 'Joeli Veitayaki',
  'Single given name → unchanged');
assertEq(shortenPublicName('  Rusiate   Raibosa  ', 'Nayacakalou'), 'Rusiate Nayacakalou',
  'Whitespace collapse');
assertEq(shortenPublicName('', 'Vuki', 'Vuki, Veikila C.'), 'Vuki, Veikila C.',
  'Missing given → fallback to raw name');

// -------- Test 2: same scholar occupies two milestones --------
console.log('\n[2] Same scholar (Nayacakalou) occupies both male Master\'s and male PhD');
const scholars = [
  { 'Scholar ID': 'ITK-S0162', 'Scholar Name': 'Nayacakalou, Rusiate Raibosa', Gender: 'Male', 'Family Name': 'Nayacakalou', 'Given Names': 'Rusiate Raibosa' },
  { 'Scholar ID': 'ITK-S0372', 'Scholar Name': 'Vusoniwailala, Lasarusa', Gender: 'Male', 'Family Name': 'Vusoniwailala', 'Given Names': 'Lasarusa' },
];
const degrees = [
  { 'Scholar ID': 'ITK-S0162', 'Degree Stage': "Master's", 'Completion Status': 'Completed', 'Finish / Completion Year': '1956', 'C_Uni name': 'University of Auckland', 'O_Uni name': 'University of New Zealand — Auckland University College', Country: 'New Zealand' },
  { 'Scholar ID': 'ITK-S0162', 'Degree Stage': 'PhD/Doctorate', 'Completion Status': 'Completed', 'Finish / Completion Year': '1963', 'C_Uni name': 'University of London', 'O_Uni name': 'University of London', Country: 'United Kingdom' },
  { 'Scholar ID': 'ITK-S0372', 'Degree Stage': "Master's", 'Completion Status': 'Completed', 'Finish / Completion Year': '1978', 'C_Uni name': 'University of Hawaiʻi at Mānoa', 'O_Uni name': 'University of Hawaiʻi at Mānoa', Country: 'United States' },
];
const defs = [
  { key: 'firstMaleMasters', stage: 'masters', gender: 'Male' },
  { key: 'firstMalePhD', stage: 'phd', gender: 'Male' },
];
const picks = pickMilestone(defs, scholars, degrees);
assertEq(picks[0].scholarId, 'ITK-S0162', 'Male Master\'s → Nayacakalou');
assertEq(picks[0].year, 1956, 'Male Master\'s year → 1956');
assertEq(picks[0].personLine, 'Mr. Rusiate Nayacakalou', 'Male Master\'s public label');
assertEq(picks[0].uniRenamed, true, 'Male Master\'s uniRenamed=true (Auckland renamed)');
assertEq(picks[1].scholarId, 'ITK-S0162', 'Male PhD → Nayacakalou');
assertEq(picks[1].year, 1963, 'Male PhD year → 1963');
assertEq(picks[1].personLine, 'Dr. Rusiate Nayacakalou', 'Male PhD public label (Dr., stage-driven)');
assertEq(picks[1].uniRenamed, false, 'Male PhD uniRenamed=false (London unchanged)');

// -------- Test 3: non-completed does NOT displace completed --------
console.log('\n[3] Non-completed degree cannot beat a completed milestone');
const withInProg = degrees.concat([
  { 'Scholar ID': 'ITK-S0999', 'Degree Stage': "Master's", 'Completion Status': 'In progress', 'Finish / Completion Year': '1900', 'C_Uni name': 'Fake U', 'O_Uni name': 'Fake U', Country: 'Fiji' },
]);
const withInProgScholars = scholars.concat([{ 'Scholar ID': 'ITK-S0999', 'Scholar Name': 'Ghost, Test', Gender: 'Male', 'Family Name': 'Ghost', 'Given Names': 'Test' }]);
const picks2 = pickMilestone(defs, withInProgScholars, withInProg);
assertEq(picks2[0].scholarId, 'ITK-S0162', 'In-progress 1900 does NOT displace 1956 completed');

// -------- Test 4: "Completed / year unresolved" without a year is excluded --------
console.log('\n[4] Completed-but-undated does not qualify as milestone earliest');
const undated = [
  { 'Scholar ID': 'ITK-S0162', 'Degree Stage': "Master's", 'Completion Status': 'Completed / year unresolved', 'Finish / Completion Year': '', 'C_Uni name': 'University of Auckland', 'O_Uni name': 'University of Auckland', Country: 'New Zealand' },
  { 'Scholar ID': 'ITK-S0372', 'Degree Stage': "Master's", 'Completion Status': 'Completed', 'Finish / Completion Year': '1978', 'C_Uni name': 'UHM', 'O_Uni name': 'UHM', Country: 'United States' },
];
const picks3 = pickMilestone([{ key: 'firstMaleMasters', stage: 'masters', gender: 'Male' }], scholars, undated);
assertEq(picks3[0].scholarId, 'ITK-S0372', 'Undated Completed → falls through to 1978 dated');

// -------- Test 5: institution source comes from qualifying-degree row --------
console.log('\n[5] Master\'s annotation uses Master\'s institution, PhD annotation uses PhD institution');
assertEq(picks[0].cUni, 'University of Auckland', 'Master\'s row → Auckland');
assertEq(picks[1].cUni, 'University of London', 'PhD row → London');

// -------- Test 6: missing/unclassified country degrades gracefully --------
console.log('\n[6] Missing country → empty (not fabricated)');
const missCountry = [{ 'Scholar ID': 'ITK-S0162', 'Degree Stage': "Master's", 'Completion Status': 'Completed', 'Finish / Completion Year': '1956', 'C_Uni name': 'University of Auckland', 'O_Uni name': 'University of Auckland', Country: '' }];
const picks4 = pickMilestone([{ key: 'firstMaleMasters', stage: 'masters', gender: 'Male' }], scholars, missCountry);
assertEq(picks4[0].country, '', 'Blank country stays blank');

console.log('\nDone.');
