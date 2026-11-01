"""Build the complete Samoa Apps Script source (one paste-over file).

Same composition as scripts/build_tonga_submission_bundle.py (verifier +
backend + shared event intake + attachment parser/analysis + review v5), plus
a Samoa Master adapter, because the Samoa Master uses its own column names:

* Samoa column headers are translated to the names the Tonga-derived code
  uses when a header row is read, so every write lands in the right Samoa
  column. The map is generated from scripts/country_kit/governance_dump.py
  (the same mapping the dashboard refresh uses) plus a few explicit extras.
* Positions 'Current Flag' (Yes / No) is shown to the code as 'Role Status'
  (Current / Past) and translated back on write.
* Change Log rows use the Samoa 12-column layout (WSM-CHG####) at the next
  empty row, and the Admin change-log reader reads that layout.
* New Graduate Degree rows use WSM-DEG####, new geography rows WSM-GEO####.
* Empty queue tabs created by the earlier Samoa scaffold get the current
  queue headers on first use. Tabs that hold data are never rewritten.

No private configuration is included. Usage:
    python3 scripts/build_samoa_submission_bundle.py OUT.gs [--headers samoa_headers.json]
"""
from pathlib import Path
import argparse
import json
import re
import sys

p = argparse.ArgumentParser()
p.add_argument('output')
p.add_argument('--headers', default=str(Path(__file__).resolve().parent / 'country_kit' / 'samoa_master_headers.json'),
               help='row-4 headers snapshot of the Samoa Master (no data)')
args = p.parse_args()
root = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(root / 'scripts' / 'country_kit'))
from governance_dump import ALIASES  # noqa: E402
from generate_country import rename  # noqa: E402
from kitlib import load_country  # noqa: E402

cfg = load_country('samoa')
tonga_headers = json.loads((root / 'scripts/country_kit/tonga_headers.json').read_text())
samoa_headers = json.loads(Path(args.headers).read_text())

SHEETS = ['Scholars', 'Positions', 'Graduate Degrees', 'Research Geography', 'Publications', 'Authorship']
EXTRA = {
    'Scholars': {
        'Notes (internal — never public)': 'Record Notes',
        'Self-identified Home / Community': 'Self-identified Home / Community Affiliation Paternal',
    },
    'Positions': {
        'Current Flag': 'Role Status',
        'Profile URL': 'Source URL',
        'Notes': 'Evidence / Notes',
    },
    'Graduate Degrees': {
        'Notes': 'Study Date Evidence / Notes',
    },
    'Research Geography': {
        'Statistical Region': 'Statistical Region (auto from District)',
        'Notes': 'Source URL / Note',
    },
}
hmap = {}
for sheet in SHEETS:
    S = [h for h in samoa_headers[sheet][3] if h]
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
    m.update(EXTRA.get(sheet, {}))
    taken = set(m.values())
    # A Samoa header that already equals a mapped target would collide; keep the explicit mapping.
    assert not any(h in taken and h not in m for h in S), (sheet, [h for h in S if h in taken and h not in m])
    hmap[sheet] = m

adapter = '''
// ===================== SAMOA MASTER ADAPTER =====================
// The Samoa Master uses its own column names. Header rows are translated to
// the names this code uses (Samoa header -> name in code) so every read and
// write lands in the right Samoa column. Generated from the same mapping the
// dashboard refresh uses (scripts/country_kit/governance_dump.py).
var SAMOA_HEADER_MAP_ = ''' + json.dumps(hmap, ensure_ascii=False, indent=1) + ''';
function samoaCanonHeaders_(sheetName, arr) {
  var m = SAMOA_HEADER_MAP_[sheetName] || {};
  return (arr || []).map(function (h) { var s = String(h == null ? '' : h).trim(); return Object.prototype.hasOwnProperty.call(m, s) ? m[s] : s; });
}
function samoaMasterHeader_(sheetName, field) {
  var m = SAMOA_HEADER_MAP_[sheetName] || {};
  for (var k in m) if (m[k] === field) return k;
  return field;
}
// Positions: Samoa 'Current Flag' Yes / No  <->  'Role Status' Current / Past.
function samoaReadValue_(sheetName, field, v) {
  if (sheetName === 'Positions' && field === 'Role Status') {
    var s = String(v == null ? '' : v).trim();
    if (/^(yes|y|true)$/i.test(s)) return 'Current';
    if (/^(no|n|false)$/i.test(s)) return 'Past';
  }
  return v;
}
function samoaWriteValue_(sheetName, field, v) {
  if (sheetName === 'Positions' && field === 'Role Status') {
    var s = String(v == null ? '' : v).trim();
    if (/^current/i.test(s)) return 'Yes';
    if (/^(past|former)/i.test(s)) return 'No';
  }
  return v;
}
// Empty queue tabs from the earlier Samoa scaffold carry older headers.
// Only when the tab has no data rows below row 4, replace its header row.
function samoaResetEmptyQueueHeaders_(sh, headers) {
  if (!sh || sh.getLastRow() > 4) return;
  var n = Math.max(sh.getLastColumn(), headers.length);
  var cur = sh.getRange(4, 1, 1, n).getDisplayValues()[0];
  if (cur.slice(0, headers.length).join('|') === headers.join('|') && !cur.slice(headers.length).some(String)) return;
  sh.getRange(4, 1, 1, n).clearContent();
  sh.getRange(4, 1, 1, headers.length).setValues([headers]);
}
'''

change_log = r'''
function handleReadChangeLog_(params) {
  // Samoa Change Log: Change ID | Timestamp (UTC) | Editor | Sheet | Row Key (Stable ID) |
  // Field | Old Value | New Value | Reason | Source ID | Deployment Version | Client IP (hashed)
  var limit = Math.min(parseInt(params.limit, 10) || 50, 500);
  var ss = SpreadsheetApp.openById(SPREADSHEET_ID_HINT);
  var sheet = ss.getSheetByName('Change Log');
  if (!sheet) return jsonOut_({ status: 'ok', rows: [] });
  var lastRow = sheet.getLastRow(), headerRow = 4;
  if (lastRow <= headerRow) return jsonOut_({ status: 'ok', rows: [] });
  var take = Math.min(limit, lastRow - headerRow), startRow = lastRow - take + 1;
  var vals = sheet.getRange(startRow, 1, take, 12).getDisplayValues(), rows = [];
  for (var i = vals.length - 1; i >= 0; i--) {
    var v = vals[i];
    if (!String(v[0] || '').trim()) continue;
    var ws = v[3], field = v[5], key = v[4];
    rows.push({
      rowNumber: startRow + i, version: v[10] || v[0], date: v[1],
      change: 'edit: ' + ws + '.' + field,
      scope: v[2] + ' · ' + key + ' · ' + ws + '.' + field + ': ' + truncate_(v[6], 120) + ' → ' + truncate_(v[7], 120),
      source: v[8], actor: v[2], worksheet: ws, field: field, oldValue: v[6], newValue: v[7], changeId: v[0], rowKey: key
    });
  }
  var st = samoaTable_(ss, 'Scholars'), si = st.headers.indexOf('Scholar ID'), ni = st.headers.indexOf('Scholar Name');
  rows.forEach(function (r) { var m = String(r.rowKey || '').match(/^(WSM-S\d+)$/); if (!m) return; r.scholarId = m[1]; var s = st.rows.find(function (x) { return x[si] === r.scholarId; }); if (s) r.scholarName = String(s[ni] || ''); });
  return jsonOut_({ status: 'ok', rows: rows, serverTs: Date.now() });
}
'''

append_log = r'''function appendChangeLog_(ss, worksheet, sid, field, oldValue, newValue) {
  // Samoa layout, written cell by cell to the next empty row (blank cells are left untouched).
  var sheet = ss.getSheetByName('Change Log');
  if (!sheet) return; // If someone removed the tab, silently skip logging (do not fail the write).
  var last = sheet.getLastRow(), ids = last >= 5 ? sheet.getRange(5, 1, last - 4, 1).getDisplayValues() : [];
  var max = 0, used = 4;
  ids.forEach(function (r, i) { var s = String(r[0] || '').trim(); if (!s) return; used = 5 + i; var m = /^WSM-CHG(\d+)$/.exec(s); if (m) max = Math.max(max, Number(m[1])); });
  var n = String(max + 1); while (n.length < 4) n = '0' + n;
  var row = used + 1;
  if (row > sheet.getMaxRows()) sheet.insertRowsAfter(sheet.getMaxRows(), 1);
  var stamp = Utilities.formatDate(new Date(), 'UTC', 'yyyy-MM-dd HH:mm:ss');
  var cells = ['WSM-CHG' + n, stamp, ACTOR_LABEL, worksheet, sid, samoaMasterHeader_(worksheet, field),
               truncate_(samoaWriteValue_(worksheet, field, oldValue), 500), truncate_(samoaWriteValue_(worksheet, field, newValue), 500), 'Admin edit', '', SOURCE_TAG, ''];
  cells.forEach(function (v, i) { if (v !== '' && v != null) sheet.getRange(row, i + 1).setValue(samoaLiteral_(String(v))); });
}
'''


def sub_once(text, old, new, count=1, label=''):
    n = text.count(old)
    assert n == count, f'{label or old[:60]!r}: expected {count}, found {n}'
    return text.replace(old, new)


backend = (root / 'apps-script/deployed/samoa-submissions-v1.gs').read_text()
# Header reads -> Samoa canonical names
backend = sub_once(backend,
    "var headerVals = sheet.getRange(wsCfg.headerRow || 4, 1, 1, lastCol).getValues()[0] || [];",
    "var headerVals = samoaCanonHeaders_('Scholars', sheet.getRange(wsCfg.headerRow || 4, 1, 1, lastCol).getValues()[0] || []);")
backend = sub_once(backend,
    "var headerVals = sheet.getRange(headerRow, 1, 1, lastCol).getValues()[0] || [];",
    "var headerVals = samoaCanonHeaders_(sheet.getName(), sheet.getRange(headerRow, 1, 1, lastCol).getValues()[0] || []);", 2)
backend = sub_once(backend,
    "if (h) obj[h] = normalizeForRead_(all[r][k]);",
    "if (h) obj[h] = normalizeForRead_(samoaReadValue_(ws, h, all[r][k]));")
backend = sub_once(backend,
    "var currentRaw    = col ? sheet.getRange(rowInfo.row, col).getValue() : '';",
    "var currentRaw    = col ? samoaReadValue_(ws, field, sheet.getRange(rowInfo.row, col).getValue()) : '';")
backend = sub_once(backend,
    "sheet.getRange(rowInfo.row, col).setValue(samoaLiteral_(newValue));",
    "sheet.getRange(rowInfo.row, col).setValue(samoaLiteral_(samoaWriteValue_(ws, field, newValue)));")
backend = sub_once(backend,
    "var headers = sh ? sh.getRange(4, 1, 1, sh.getLastColumn()).getDisplayValues()[0].map(function (h) { return String(h || '').trim(); }) : [];",
    "var headers = sh ? samoaCanonHeaders_('Positions', sh.getRange(4, 1, 1, sh.getLastColumn()).getDisplayValues()[0]) : [];")
backend = sub_once(backend,
    "var h=sh.getRange(4,1,1,n).getDisplayValues()[0];\n  var rows=sh.getLastRow()>4?sh.getRange(5,1,sh.getLastRow()-4,n).getDisplayValues():[];",
    "var h=samoaCanonHeaders_(name,sh.getRange(4,1,1,n).getDisplayValues()[0]);\n  var rows=sh.getLastRow()>4?sh.getRange(5,1,sh.getLastRow()-4,n).getDisplayValues():[];\n"
    "  if(name==='Positions'){var rs=h.indexOf('Role Status');if(rs>=0)rows.forEach(function(r){r[rs]=samoaReadValue_('Positions','Role Status',r[rs]);});}")
# Completion years live in Samoa 'Completion Year'
backend = sub_once(backend, "field:'Year / Status',stage:'master'}", "field:'Finish / Completion Year',stage:'master'}")
backend = sub_once(backend, "field:'Year / Status',stage:'phd'}", "field:'Finish / Completion Year',stage:'phd'}")
# Research Geography: Samoa 'Statistical Region' column, WSM-GEO#### ids
backend = sub_once(backend, "'Specific Island','Island Division (auto from District)'];",
                   "'Specific Island','Statistical Region (auto from District)'];")
backend = sub_once(backend, "  var added=0;\n  candidates.forEach(function(c){",
                   "  var added=0,geoNext=Number(samoaV5NextId_(t,'Geography Record ID','WSM-GEO').slice(7));\n  candidates.forEach(function(c){")
backend = sub_once(backend, "set('Geography Record ID','GEO-'+Utilities.getUuid());",
                   "var gn=String(geoNext++);while(gn.length<4)gn='0'+gn;set('Geography Record ID','WSM-GEO'+gn);")
# Change Log (Samoa layout)
start = backend.index('function handleReadChangeLog_(params) {')
end = backend.index('// Best-effort parser for the folded Scope/Impact column')
backend = backend[:start] + change_log.strip() + '\n\n' + backend[end:]
start = backend.index('function appendChangeLog_(ss, worksheet, sid, field, oldValue, newValue) {')
end = backend.index('function truncate_(s, n) {')
backend = backend[:start] + append_log + '\n' + backend[end:]
# Empty scaffold queue tabs: refresh header rows before the strict checks
backend = sub_once(backend,
    "  var current=sh.getRange(4,1,1,SCHOLAR_BLOCKLIST_HEADERS.length).getDisplayValues()[0];",
    "  samoaResetEmptyQueueHeaders_(sh,SCHOLAR_BLOCKLIST_HEADERS);\n  var current=sh.getRange(4,1,1,SCHOLAR_BLOCKLIST_HEADERS.length).getDisplayValues()[0];")
backend = sub_once(backend,
    "  var current = sh.getRange(4, 1, 1, SCHOLAR_SUBMISSION_HEADERS.length).getDisplayValues()[0];",
    "  samoaResetEmptyQueueHeaders_(sh, SCHOLAR_SUBMISSION_HEADERS);\n  var current = sh.getRange(4, 1, 1, SCHOLAR_SUBMISSION_HEADERS.length).getDisplayValues()[0];")
backend = sub_once(backend,
    "  var h=sh.getRange(4,1,1,GEO_SUBMISSION_HEADERS.length).getDisplayValues()[0];",
    "  samoaResetEmptyQueueHeaders_(sh,GEO_SUBMISSION_HEADERS);\n  var h=sh.getRange(4,1,1,GEO_SUBMISSION_HEADERS.length).getDisplayValues()[0];")

review = (root / 'apps-script/samoa-review-v5.gs').read_text()
review = sub_once(review, "cell.setValue(samoaLiteral_(values[h]));", "cell.setValue(samoaLiteral_(samoaWriteValue_(sheetName,h,values[h])));")
review = sub_once(review, "kind==='degree'?'WSM-D':'WSM-POS'", "kind==='degree'?'WSM-DEG':'WSM-POS'")

verifier = (root / 'apps-script/vendor/tonga-jwt.gs').read_text().replace('TongaJWT', 'SamoaJWT')
events = (root / 'apps-script/news-events.gs').read_text()
analysis = ((root / 'js/samoa-attachment-parser.js').read_text() + '\n'
            + (root / 'apps-script/samoa-attachment-analysis.gs').read_text() + '\n' + review)

out = ('// Complete Samoa review backend v5 (one file). Paste over the whole Code.gs.\n'
       '// Private settings live in Project Settings > Script Properties, never in this file.\n'
       + verifier + '\n' + adapter + '\n' + backend + '\n' + events + '\n' + analysis)
assert 'TongaJWT' not in out
Path(args.output).write_text(out)
print(args.output, len(out))
