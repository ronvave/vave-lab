"""Build the complete Hawaiʻi Apps Script source (one paste-over file).

Same composition as scripts/build_samoa_submission_bundle.py (verifier +
backend + shared event intake + attachment parser/analysis + review v5), with
a small Hawaiʻi Master adapter. The Hawaiʻi Master follows the Tonga layout
(Tonga-style five-column Change Log, Role Status, HAW-DEG / HAW-POS ids), so
only these differences are handled:

* Hawaiʻi column headers (Moku, Ahupuaʻa, Island ...) are translated to the
  names the Tonga-derived code uses when a header row is read, so every write
  lands in the right Hawaiʻi column. The map comes from
  scripts/country_kit/governance_dump.py (the same mapping the dashboard
  refresh uses).
* The geography queue tab in the Hawaiʻi Master is named
  'Publication Geography Submissio' (31-character name from the workbook
  import). The code uses that tab. Its header row is replaced only while the
  tab has no data rows.
* New Graduate Degree rows use HAW-DEG#### (the existing Hawaiʻi format).
* Approving a publication-location suggestion is switched off until the
  Hawaiʻi Research Geography tab has its island / moku layout; rejecting
  still works. Public submissions stay off until the owner enables them.

No private configuration is included. Usage:
    python3 scripts/build_hawaii_submission_bundle.py OUT.gs
"""
from pathlib import Path
import argparse
import json
import sys

p = argparse.ArgumentParser()
p.add_argument('output')
p.add_argument('--headers', default=str(Path(__file__).resolve().parent / 'country_kit' / 'hawaii_master_headers.json'),
               help='row-4 headers snapshot of the Hawaiʻi Master (no data)')
args = p.parse_args()
root = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(root / 'scripts' / 'country_kit'))
from governance_dump import ALIASES  # noqa: E402
from generate_country import rename  # noqa: E402
from kitlib import load_country  # noqa: E402

cfg = load_country('hawaii')
tonga_headers = json.loads((root / 'scripts/country_kit/tonga_headers.json').read_text())
hi_headers = json.loads(Path(args.headers).read_text())
GEO_TAB = 'Publication Geography Submissio'
assert GEO_TAB in hi_headers, 'geography queue tab not found in the Hawaiʻi Master snapshot'

SHEETS = ['Scholars', 'Positions', 'Graduate Degrees', 'Research Geography', 'Publications', 'Authorship']
hmap = {}
for sheet in SHEETS:
    S = [h for h in hi_headers[sheet][3] if h]
    m = {}
    for t in tonga_headers[sheet][3]:
        if not t:
            continue
        tn = rename(t, cfg, 'js')
        if tn in S or t in S:
            continue
        a = next((x for x in ALIASES.get(t, []) if x in S and x not in m), None)
        if a:
            m[a] = tn
    taken = set(m.values())
    assert not any(h in taken and h not in m for h in S), (sheet, [h for h in S if h in taken and h not in m])
    if m:
        hmap[sheet] = m

adapter = '''
// ===================== HAWAIʻI MASTER ADAPTER =====================
// A few Hawaiʻi Master columns have their own names (Moku, Ahupuaʻa, Island).
// Header rows are translated to the names this code uses (Hawaiʻi header ->
// name in code) so every read and write lands in the right Hawaiʻi column.
// Generated from the same mapping the dashboard refresh uses
// (scripts/country_kit/governance_dump.py).
var HAWAII_HEADER_MAP_ = ''' + json.dumps(hmap, ensure_ascii=False, indent=1) + ''';
function hawaiiCanonHeaders_(sheetName, arr) {
  var m = HAWAII_HEADER_MAP_[sheetName] || {};
  return (arr || []).map(function (h) { var s = String(h == null ? '' : h).trim(); return Object.prototype.hasOwnProperty.call(m, s) ? m[s] : s; });
}
function hawaiiMasterHeader_(sheetName, field) {
  var m = HAWAII_HEADER_MAP_[sheetName] || {};
  for (var k in m) if (m[k] === field) return k;
  return field;
}
// Empty queue tabs from the Hawaiʻi workbook template carry older headers.
// Only when the tab has no data rows below row 4, replace its header row.
function hawaiiResetEmptyQueueHeaders_(sh, headers) {
  if (!sh || sh.getLastRow() > 4) return;
  var n = Math.max(sh.getLastColumn(), headers.length);
  var cur = sh.getRange(4, 1, 1, n).getDisplayValues()[0];
  if (cur.slice(0, headers.length).join('|') === headers.join('|') && !cur.slice(headers.length).some(String)) return;
  sh.getRange(4, 1, 1, n).clearContent();
  sh.getRange(4, 1, 1, headers.length).setValues([headers]);
}
'''


def sub_once(text, old, new, count=1, label=''):
    n = text.count(old)
    assert n == count, f'{label or old[:60]!r}: expected {count}, found {n}'
    return text.replace(old, new)


backend = (root / 'apps-script/deployed/hawaii-submissions-v1.gs').read_text()
backend = sub_once(backend,
    "var headerVals = sheet.getRange(wsCfg.headerRow || 4, 1, 1, lastCol).getValues()[0] || [];",
    "var headerVals = hawaiiCanonHeaders_('Scholars', sheet.getRange(wsCfg.headerRow || 4, 1, 1, lastCol).getValues()[0] || []);")
backend = sub_once(backend,
    "var headerVals = sheet.getRange(headerRow, 1, 1, lastCol).getValues()[0] || [];",
    "var headerVals = hawaiiCanonHeaders_(sheet.getName(), sheet.getRange(headerRow, 1, 1, lastCol).getValues()[0] || []);", 2)
backend = sub_once(backend,
    "var headers = sh ? sh.getRange(4, 1, 1, sh.getLastColumn()).getDisplayValues()[0].map(function (h) { return String(h || '').trim(); }) : [];",
    "var headers = sh ? hawaiiCanonHeaders_('Positions', sh.getRange(4, 1, 1, sh.getLastColumn()).getDisplayValues()[0]) : [];")
backend = sub_once(backend,
    "var h=sh.getRange(4,1,1,n).getDisplayValues()[0];\n  var rows=sh.getLastRow()>4?",
    "var h=hawaiiCanonHeaders_(name,sh.getRange(4,1,1,n).getDisplayValues()[0]);\n  var rows=sh.getLastRow()>4?")
# Change Log shows the Hawaiʻi column name (e.g. Moku Paternal)
backend = sub_once(backend,
    "  var change  = 'edit: ' + worksheet + '.' + field;",
    "  field = hawaiiMasterHeader_(worksheet, field);\n  var change  = 'edit: ' + worksheet + '.' + field;")
# Geography queue: the existing Hawaiʻi tab name
backend = sub_once(backend, "var GEO_SUBMISSION_SHEET = 'Publication Geography Submissions';",
                   "var GEO_SUBMISSION_SHEET = '" + GEO_TAB + "'; // tab name in the Hawaiʻi Master (31 characters)")
# Empty template queue tabs: refresh header rows before the strict checks
backend = sub_once(backend,
    "  var current=sh.getRange(4,1,1,SCHOLAR_BLOCKLIST_HEADERS.length).getDisplayValues()[0];",
    "  hawaiiResetEmptyQueueHeaders_(sh,SCHOLAR_BLOCKLIST_HEADERS);\n  var current=sh.getRange(4,1,1,SCHOLAR_BLOCKLIST_HEADERS.length).getDisplayValues()[0];")
backend = sub_once(backend,
    "  var current = sh.getRange(4, 1, 1, SCHOLAR_SUBMISSION_HEADERS.length).getDisplayValues()[0];",
    "  hawaiiResetEmptyQueueHeaders_(sh, SCHOLAR_SUBMISSION_HEADERS);\n  var current = sh.getRange(4, 1, 1, SCHOLAR_SUBMISSION_HEADERS.length).getDisplayValues()[0];")
backend = sub_once(backend,
    "  var h=sh.getRange(4,1,1,GEO_SUBMISSION_HEADERS.length).getDisplayValues()[0];",
    "  hawaiiResetEmptyQueueHeaders_(sh,GEO_SUBMISSION_HEADERS);\n  var h=sh.getRange(4,1,1,GEO_SUBMISSION_HEADERS.length).getDisplayValues()[0];")
# Location approvals stay off until Research Geography has its Hawaiʻi layout
backend = sub_once(backend,
    "function hawaiiAddGeo_(ss,o,selectedKeys){\n",
    "function hawaiiAddGeo_(ss,o,selectedKeys){\n"
    "  throw new Error('Publication location suggestions cannot be approved yet. The Hawaiʻi Research Geography tab needs its island and moku layout first. You can reject the suggestion or leave it in the queue.');\n")

review = (root / 'apps-script/hawaii-review-v5.gs').read_text()
review = sub_once(review, "kind==='degree'?'HAW-D':'HAW-POS'", "kind==='degree'?'HAW-DEG':'HAW-POS'")

verifier = (root / 'apps-script/vendor/tonga-jwt.gs').read_text().replace('TongaJWT', 'HawaiiJWT')
events = (root / 'apps-script/news-events.gs').read_text()
analysis = ((root / 'js/hawaii-attachment-parser.js').read_text() + '\n'
            + (root / 'apps-script/hawaii-attachment-analysis.gs').read_text() + '\n' + review)

out = ('// Complete Hawaiʻi review backend v5 (one file). Paste over the whole Code.gs.\n'
       '// Private settings live in Project Settings > Script Properties, never in this file.\n'
       + verifier + '\n' + adapter + '\n' + backend + '\n' + events + '\n' + analysis)
assert 'TongaJWT' not in out
Path(args.output).write_text(out)
print(args.output, len(out))
