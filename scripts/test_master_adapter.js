/*
 * Node smoke-test for the Master-file → Zotero adapter.
 *
 * Runs the browser-shaped js/master-file-adapter.js under Node with a
 * minimal `window` shim + local plaintext master JSON files, then asserts
 * the resulting snapshot has the shape the production dashboard expects
 * and that headline counts reconcile against Master aggregates.
 */

'use strict';

const fs = require('fs');
const path = require('path');
const vm = require('vm');

const REPO = path.resolve(__dirname, '..');
const SNAP_DIR = process.env.SNAP_DIR || path.join(REPO, '..', '..', 'tmp', 'master-out');

// Resolve snap dir (Node running from repo, but master-out is /tmp/master-out).
const SNAP_CANDIDATES = [SNAP_DIR, '/tmp/master-out', path.join(REPO, 'data')];
let snapDir = null;
for (const c of SNAP_CANDIDATES) {
  if (fs.existsSync(path.join(c, 'itaukei-master-scholars.json'))) { snapDir = c; break; }
}
if (!snapDir) {
  console.error('FAIL: no master JSON snapshot found (tried ' + SNAP_CANDIDATES.join(', ') + ')');
  process.exit(2);
}
console.log('Using snapshot dir:', snapDir);

const master = {
  scholars:     JSON.parse(fs.readFileSync(path.join(snapDir, 'itaukei-master-scholars.json'), 'utf8')),
  publications: JSON.parse(fs.readFileSync(path.join(snapDir, 'itaukei-master-publications.json'), 'utf8')),
  authorship:   JSON.parse(fs.readFileSync(path.join(snapDir, 'itaukei-master-authorship.json'), 'utf8')),
  gradDegrees:  JSON.parse(fs.readFileSync(path.join(snapDir, 'itaukei-master-grad-degrees.json'), 'utf8')),
  mobility:     JSON.parse(fs.readFileSync(path.join(snapDir, 'itaukei-master-mobility.json'), 'utf8')),
  geography:    JSON.parse(fs.readFileSync(path.join(snapDir, 'itaukei-master-geography.json'), 'utf8')),
  aggregates:   JSON.parse(fs.readFileSync(path.join(snapDir, 'itaukei-master-aggregates.json'), 'utf8')),
  lastSync:     JSON.parse(fs.readFileSync(path.join(snapDir, 'last-master-sync.json'), 'utf8'))
};

// Shim browser globals for the adapter script.
const windowShim = {};
windowShim.dbGate = null;
windowShim.fetch = (url) => {
  // The adapter fetches: itaukei-master-*.json and fiji-provinces.geojson
  const name = url.split('/').pop();
  const local = path.join(snapDir, name);
  if (fs.existsSync(local)) {
    return Promise.resolve({ ok: true, json: () => Promise.resolve(JSON.parse(fs.readFileSync(local, 'utf8'))) });
  }
  const dataLocal = path.join(REPO, 'data', name);
  if (fs.existsSync(dataLocal)) {
    return Promise.resolve({ ok: true, json: () => Promise.resolve(JSON.parse(fs.readFileSync(dataLocal, 'utf8'))) });
  }
  return Promise.resolve({ ok: false, status: 404 });
};

const ctx = vm.createContext({
  window: windowShim,
  fetch: windowShim.fetch,
  console: console,
  setTimeout: setTimeout,
  Promise: Promise,
  Set: Set,
  Map: Map,
  Array: Array,
  Object: Object,
  Number: Number,
  Math: Math,
  String: String,
  Date: Date,
  JSON: JSON,
  Error: Error,
  __proto__: null
});

const adapterSrc = fs.readFileSync(path.join(REPO, 'js', 'master-file-adapter.js'), 'utf8');
vm.runInContext(adapterSrc, ctx);

if (!windowShim.MasterFileAdapter) {
  console.error('FAIL: MasterFileAdapter did not attach to window');
  process.exit(1);
}

windowShim.MasterFileAdapter.load().then((bundle) => {
  const snap = bundle.snap;
  const errors = [];
  const info = [];

  // ---- Structural assertions ----
  if (!snap || !Array.isArray(snap.items)) errors.push('snap.items missing');
  if (!snap.collections || !Array.isArray(snap.collections)) errors.push('snap.collections missing');
  info.push('items: ' + snap.items.length);
  info.push('collections: ' + snap.collections.length);

  // Expect ONE item per Master publication.
  if (snap.items.length !== master.publications.length) {
    errors.push('items count ' + snap.items.length + ' != publications ' + master.publications.length);
  }
  // Expect at least one iTaukei author root + provinces + disciplines.
  const rootNames = snap.collections.filter(c => c.parent == null).map(c => c.name);
  info.push('root collections: ' + rootNames.join(', '));
  ['iTaukei authors (>N papers)', 'By or with iTaukei authors', 'Discipline'].forEach(n => {
    if (!rootNames.includes(n)) errors.push('missing root collection: ' + n);
  });

  // ---- Reconciliation vs Master aggregates ----
  const agg = master.aggregates;
  const totals = agg.totals;

  const pubsCount = snap.items.length;
  const scholarsCount = snap.collections.filter(c => c.parent === 'ITKAROOT').length;
  info.push('scholar author-collections: ' + scholarsCount);
  if (scholarsCount !== totals.scholars) {
    errors.push('scholar-collections ' + scholarsCount + ' != agg.totals.scholars ' + totals.scholars);
  }

  // Headline-5 pub count.
  const HEADLINE = ["Journal Article", "Master's Thesis", "PhD Thesis", "Book Chapter", "Book"];
  const headlinePubs = snap.items.filter(it => HEADLINE.indexOf(it._masterPublicationType) !== -1);
  info.push('headline items: ' + headlinePubs.length);
  const expectedHeadline = HEADLINE.reduce((s, t) => s + (agg.by_publication_type_headline[t].all || 0), 0);
  if (headlinePubs.length !== expectedHeadline) {
    errors.push('headline items ' + headlinePubs.length + ' != agg headline total ' + expectedHeadline);
  }

  // iTaukei-associated count.
  const itaukeiPubs = snap.items.filter(it => it._masterITaukei);
  info.push('iTaukei-associated items: ' + itaukeiPubs.length);
  if (itaukeiPubs.length !== totals.publications_itaukei_associated) {
    errors.push('iTaukei items ' + itaukeiPubs.length + ' != agg ' + totals.publications_itaukei_associated);
  }

  // Every item has key/itemType/title.
  const bad = snap.items.filter(it => !it.key || !it.itemType);
  if (bad.length) errors.push(bad.length + ' items missing key/itemType');

  // Every item has creators array.
  const noCreators = snap.items.filter(it => !Array.isArray(it.creators));
  if (noCreators.length) errors.push(noCreators.length + ' items with non-array creators');

  // Every item has collections array.
  const noCols = snap.items.filter(it => !Array.isArray(it.collections));
  if (noCols.length) errors.push(noCols.length + ' items with non-array collections');

  // Bundle shape.
  ['snap', 'geo', 'unis', 'provFlat', 'profiles', 'sync', 'grad'].forEach(k => {
    if (!(k in bundle)) errors.push('bundle missing ' + k);
  });

  info.push('profiles.scholars: ' + bundle.profiles.scholars.length);
  info.push('grad.worldPoints: ' + bundle.grad.worldPoints.length);
  info.push('universities: ' + bundle.unis.length);

  console.log('\n=== INFO ===');
  info.forEach(i => console.log('  ' + i));
  if (errors.length) {
    console.log('\n=== ERRORS ===');
    errors.forEach(e => console.log('  ✗ ' + e));
    console.log('\nFAIL: ' + errors.length + ' assertion(s) failed');
    process.exit(1);
  }
  console.log('\n✓ All adapter assertions PASSED');
}).catch((err) => {
  console.error('Adapter load failed:', err && (err.stack || err));
  process.exit(1);
});
