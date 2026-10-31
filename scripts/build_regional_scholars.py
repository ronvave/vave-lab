#!/usr/bin/env python3
"""Build the Regional Pacific Scholars aggregate bundle from country Master files.

Read-only. Never writes to any Master spreadsheet.

Input : a directory of per-country JSON dumps produced by ``--pull`` (Sheets
        API via the authenticated ``gws`` CLI) or by a CI step using the
        service account. Each dump is {"titles": [...], "data": {sheet: rows}}.
Output: data/regional-scholars.json  (PLAINTEXT — gitignored, never commit).
        Encrypt with scripts/encrypt_data.py-compatible IVAV format before
        publishing (see docs/REGIONAL-SCHOLARS-DASHBOARD.md).

Counting rules (documented in the page's Methodology dialog):
  Scholars  = unique Scholar IDs on each country's included roster.
  Master's  = completed Master's degree records held by included scholars.
  PhDs      = completed PhD / doctorate records (professional doctorates are
              included and reported separately) held by included scholars.
  A person with both degrees counts once as a scholar and in both degree totals.
"""
from __future__ import annotations

import argparse
import json
import re
import subprocess
import sys
import unicodedata
from collections import Counter, defaultdict
from datetime import datetime, timezone
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT / 'scripts'))
from master_short_disciplines import SHORT_DISCIPLINES, fiji_short_discipline  # noqa: E402

# Spreadsheet IDs live only in this build script / CI, never in the client bundle.
COUNTRIES = [
    # code, display name, spreadsheet id, dashboard url (None = no dashboard yet), dashboard status
    ('FJI', 'Fiji', '1nJvMWLS8jnCOKtRoqdDpEW3s3j9TSAclXBO1txVFxdg', 'itaukei-research-database-master.html', 'live'),
    ('TON', 'Tonga', '1lh6wOFcg2GiFe2YylgxM5cvLOdumdbCrHDLQk87rjRI', 'tongan-research-database-master.html', 'live'),
    ('SLB', 'Solomon Islands', '1um6pHKriEhbtvmkm7e8E1j0_Zt9A-oYpY88fuPoAmFY', 'solomon-islands-research-database-master.html', 'live'),
    ('WSM', 'Samoa', '1X-RZSWKbzG-oY7anCYaR54Ev8h2G8yl0SXy6jMNhCHQ', None, 'development'),
    ('VUT', 'Vanuatu', '1jfS6Yqyy559kLdoeKW4F4t8RhyBooXpCiwOMukxpPW0', 'vanuatu-research-database-master.html', 'live'),
    ('TUV', 'Tuvalu', '1jvRz1HHK90_6Uk3junJHPS03NqUuGfHO1JUQSpjz2wA', None, 'none'),
    ('KIR', 'Kiribati', '15gmd0Q7NostzeSAZg27fpIoGUDYCE64kGSbYoh-RjqE', None, 'none'),
    ('PLW', 'Palau', '1aBvlPZfivXMRcG2UfWCojIC_BBBloZHf2khA5qnlHzE', None, 'none'),
    ('COK', 'Cook Islands', '1oPBnQHzjRNnmzS5_md5Lagmk_jQorqCRd3zhyKM1iC8', None, 'none'),
    ('MHL', 'Marshall Islands', '1Ys80AYWishhDSDZFG5B49MfDJopgCmLR3dbSCJqtB5w', None, 'none'),
    ('FSM', 'Federated States of Micronesia', '1UYhthbTDVosC6_6zcwXH_k2WNjTo1ijs2oYQe8FOzqI', None, 'none'),
]

# October 5 2026, 9 am HST checkpoint (from the tabulated summary image).
OCT5 = {
    'FJI': dict(pubs=3633, indig=1951, masters=355, phd=133),
    'TON': dict(pubs=3353, indig=700, masters=187, phd=145),
    'SLB': dict(pubs=411, indig=408, masters=80, phd=39),
    'WSM': dict(pubs=384, indig=293, masters=40, phd=46),
    'VUT': dict(pubs=249, indig=92, masters=74, phd=23),
    'TUV': dict(pubs=88, indig=88, masters=25, phd=12),
    'KIR': dict(pubs=80, indig=80, masters=20, phd=13),
    'PLW': dict(pubs=58, indig=58, masters=19, phd=6),
    'COK': dict(pubs=84, indig=84, masters=48, phd=20),
    'MHL': dict(pubs=64, indig=64, masters=39, phd=10),
    'FSM': dict(pubs=37, indig=37, masters=23, phd=14),
}

DISCIPLINE_COUNTRIES = ('FJI', 'TON', 'VUT')  # approved scope for Fields of Research

# Pacific Island countries / territories (physical campus location). AU & NZ excluded.
PACIFIC = {
    'fiji', 'samoa', 'tonga', 'vanuatu', 'solomon islands', 'papua new guinea', 'kiribati',
    'tuvalu', 'nauru', 'palau', 'marshall islands', 'federated states of micronesia',
    'micronesia', 'cook islands', 'niue', 'tokelau', 'new caledonia', 'french polynesia',
    'wallis and futuna', 'guam', 'northern mariana islands', 'american samoa',
}
NORTH_AMERICA = {'united states', 'canada', 'usa', 'united states of america'}
EUROPE = {'united kingdom', 'sweden', 'malta', 'france', 'portugal', 'norway', 'germany',
          'netherlands', 'ireland', 'italy', 'spain', 'belgium', 'denmark', 'finland',
          'switzerland', 'austria', 'scotland', 'england', 'wales'}
ASIA = {'japan', 'taiwan', 'india', 'south korea', 'korea', 'china', 'indonesia', 'singapore',
        'thailand', 'philippines', 'malaysia', 'türkiye', 'turkey', 'hong kong', 'vietnam'}
# Institution-name fallbacks when the country cell holds a university name.
INSTITUTION_REGION = [
    (r'south pacific.*alafua|alafua', 'Pacific', 'Samoa'),
    (r'university of the south pacific', 'Pacific', None),  # multi-campus: campus unresolved
    (r"christ'?s university in pacific", 'Pacific', 'Tonga'),
    (r'pavia', 'Europe', 'Italy'),
    (r'tacoma|washington', 'North America', 'United States'),
]

# Headline publication categories, matching each country's own Master
# Dashboard sheet: Fiji uses six (incl. Report); every other country uses five.
ELIGIBLE_PUB = {
    'journal article': 'Journal article', 'master s thesis': "Master's thesis",
    'phd thesis': 'PhD thesis', 'book chapter': 'Book chapter', 'book': 'Book',
}
FIJI_EXTRA_PUB = {'report': 'Report'}


def vanuatu_short_discipline(d):
    """Exact port of js/vanuatu-dashboard-model.js shortDiscipline()."""
    c = SHORT_DISCIPLINES
    lab = {'theo': c[0], 'edu': c[1], 'health': c[2], 'eng': c[3], 'life': c[4], 'hum': c[5], 'soc': c[6], 'earth': c[7]}

    def match(x):
        if re.search(r'theolog|religio|divinity', x): return lab['theo']
        if re.search(r'education|teaching|pedagog', x): return lab['edu']
        if re.search(r'health|medicin|medical|nurs|clinical|epidemi|dentist|pharmac', x): return lab['health']
        if re.search(r'oceanograph|geolog|geophys|earth science|atmospheric|meteorolog', x): return lab['earth']
        if re.search(r'engineer|technology|comput|planning|architecture|information system', x): return lab['eng']
        if re.search(r'environment|ecolog|biolog|agricultur|marine science|fisher|natural science|climate', x): return lab['life']
        if re.search(r'linguistic|literature|language|history|philosophy|humanities|arts', x) and 'social sciences' not in x: return lab['hum']
        if re.search(r'social|sociolog|anthropolog|business|commerce|econom|law|legal|finance|policy|politic|development|tourism|management|pacific islands', x) and 'humanities and social' not in x: return lab['soc']
        return ''
    return match(str(d.get('Field / Discipline') or '').strip().lower()) or match(str(d.get('Broad Discipline') or '').strip().lower())


def short_discipline(code, r):
    if code == 'VUT':
        return vanuatu_short_discipline(r)
    if code in ('FJI', 'TON'):
        return fiji_short_discipline({'Short Discipline': r.get('Short Discipline'),
                                      'Field / Discipline': r.get('Field / Discipline'),
                                      'Broad discipline': r.get('Broad discipline') or r.get('Broad Discipline')})
    return ''


def norm(s):
    return str(s or '').strip()


def fold(s):
    s = unicodedata.normalize('NFKD', norm(s)).encode('ascii', 'ignore').decode().lower()
    return re.sub(r'[^a-z0-9]+', ' ', s).strip()


def table(dump, sheet, key):
    rows = dump['data'].get(sheet, [])
    for i, r in enumerate(rows[:10]):
        if r and norm(r[0]) == key:
            h = r
            return [dict(zip(h, rr + [''] * (len(h) - len(rr)))) for rr in rows[i + 1:] if rr and norm(rr[0])]
    return []


def first(r, *keys):
    for k in keys:
        v = norm(r.get(k))
        if v:
            return v
    return ''


def gender(v):
    v = fold(v)
    if v in ('female', 'fefine', 'fafine', 'marama', 'woman', 'f'):
        return 'female'
    if v in ('male', 'tangata', 'tane', 'turaga', 'man', 'm'):
        return 'male'
    return 'unknown'


def level(r):
    v = fold(first(r, 'Degree Stage', 'Stage', 'Degree Level'))
    if v.startswith('master'):
        return 'M'
    if 'professional doctorate' in v:
        return 'PD'
    if v.startswith('phd') or 'doctor' in v:
        return 'P'
    return ''


def completed(r):
    v = fold(r.get('Completion Status'))
    return v.startswith('completed') or v.startswith('awarded')


def destination(r):
    raw = first(r, 'University Country', 'Country')
    uni = first(r, 'Canonical University Name (C_Uni)', 'C_Uni name', 'Institution Name (Current)',
                'Current Institution Name', 'O_Uni name', 'Original University Name (O_Uni)')
    c = fold(raw)
    if c in ('', 'not yet verified', 'unresolved', 'unknown'):
        return 'Unknown', '', uni
    if c in ('australia',):
        return 'Australia', 'Australia', uni
    if c in ('new zealand', 'aotearoa new zealand', 'aotearoa'):
        return 'New Zealand', 'New Zealand', uni
    if c in PACIFIC:
        if c == 'micronesia':
            raw = 'Federated States of Micronesia'
        return 'Pacific', raw, uni
    if c in NORTH_AMERICA:
        return 'North America', 'United States' if c != 'canada' else 'Canada', uni
    if c in EUROPE:
        return 'Europe', raw, uni
    if c in ASIA:
        return 'Asia', raw, uni
    for pat, region, ctry in INSTITUTION_REGION:
        if re.search(pat, fold(raw)):
            return region, ctry or '', raw if not uni else uni
    return 'Other', raw, uni


def year_of(v):
    m = re.search(r'(19|20)\d{2}', norm(v))
    return int(m.group(0)) if m else None


def roster(code, dump):
    S = table(dump, 'Scholars', 'Scholar ID')
    excluded_reason = Counter()
    keep = []
    part_ids = set()
    for sheet in dump['data']:
        if sheet.startswith('Part-'):
            part_ids |= {norm(r.get('Scholar ID')) for r in table(dump, sheet, 'Scholar ID')}
    for r in S:
        sid = norm(r.get('Scholar ID'))
        if not re.match(r'^[A-Z]{3}-S\d+$', sid):
            excluded_reason['malformed Scholar ID'] += 1
            continue
        if code == 'FJI':
            if sid in part_ids:
                excluded_reason['Part-iTaukei roster'] += 1
                continue
        elif code == 'TON':
            if 'excluded from indigenous tongan counts' in fold(r.get('Roster Tier')):
                excluded_reason['Retained profile; excluded from Indigenous Tongan counts'] += 1
                continue
        elif code in ('SLB', 'WSM'):
            if fold(r.get('Inclusion Status')) != 'included':
                excluded_reason['Inclusion Status not Included'] += 1
                continue
        else:
            if fold(r.get('Identity Verification Status')) != 'verified' or fold(r.get('Review Status')) == 'excluded':
                excluded_reason['Identity not Verified / Excluded'] += 1
                continue
        keep.append(r)
    return keep, excluded_reason


def build_country(code, name, dump):
    scholars, excl = roster(code, dump)
    ids = {norm(r['Scholar ID']) for r in scholars}
    G = table(dump, 'Graduate Degrees', 'Degree ID')
    degs, seen = [], set()
    orphan = 0
    for r in G:
        did = norm(r.get('Degree ID'))
        if did in seen:
            continue
        seen.add(did)
        if fold(r.get('Verification Status')) == 'excluded':
            continue
        lv = level(r)
        if not lv or not completed(r):
            continue
        if norm(r.get('Scholar ID')) not in ids:
            orphan += 1
            continue
        degs.append((lv, r))
    m = sum(1 for lv, _ in degs if lv == 'M')
    p = sum(1 for lv, _ in degs if lv == 'P')
    pd = sum(1 for lv, _ in degs if lv == 'PD')
    holders_m = len({norm(r['Scholar ID']) for lv, r in degs if lv == 'M'})
    holders_p = len({norm(r['Scholar ID']) for lv, r in degs if lv in ('P', 'PD')})
    both = len({norm(r['Scholar ID']) for lv, r in degs if lv == 'M'} & {norm(r['Scholar ID']) for lv, r in degs if lv in ('P', 'PD')})

    g = Counter(gender(r.get('Gender')) for r in scholars)

    # Destinations (degree grain)
    dest = Counter()
    dest_unis = defaultdict(Counter)
    for lv, r in degs:
        region, ctry, uni = destination(r)
        y = year_of(first(r, 'Finish / Completion Year', 'Completion Year', 'Graduation Year', 'End Year', 'Year / Status'))
        dest[(region, 'P' if lv in ('P', 'PD') else 'M', (y // 10 * 10) if y else 0)] += 1
        dest_unis[region][ctry or '(country unresolved)'] += 1

    # Disciplines (approved scope only)
    disc = None
    if code in DISCIPLINE_COUNTRIES:
        disc = {'M': Counter(), 'P': Counter()}
        for lv, r in degs:
            cat = short_discipline(code, r) or 'Unknown / unmapped'
            disc['P' if lv in ('P', 'PD') else 'M'][cat] += 1

    # Publications
    P = table(dump, 'Publications', 'Publication ID / BibTeX Key') or table(dump, 'Publications', 'Publication ID')
    pubs = {}
    ptype_counts = Counter()
    for r in P:
        pid = norm(r.get('Publication ID / BibTeX Key') or r.get('Publication ID'))
        if not pid or pid in pubs:
            continue
        t = fold(first(r, 'Publication Type', 'Type'))
        if code == 'WSM' and fold(r.get('V2 Inclusion Flag')) != 'included':
            continue
        if fold(r.get('Verification Status')) == 'excluded' or fold(r.get('Dedup Status')) == 'duplicate':
            continue
        label = ELIGIBLE_PUB.get(t) or (FIJI_EXTRA_PUB.get(t) if code == 'FJI' else None)
        if not label:
            ptype_counts['(excluded type) ' + (t or 'blank')] += 1
            continue
        ptype_counts[label] += 1
        doi = fold(r.get('DOI')).replace('https doi org ', '').replace('doi ', '')
        y = year_of(r.get('Year'))
        key = ('doi:' + doi) if doi else ('t:' + fold(r.get('Title'))[:120] + '|' + str(y or ''))
        pubs[pid] = dict(year=y, key=key)
    A = table(dump, 'Authorship', 'Authorship ID')
    linked = set()
    publishing = set()
    for r in A:
        if fold(r.get('Verification Status')) == 'excluded':
            continue
        pid = norm(r.get('Publication ID / BibTeX Key') or r.get('Publication ID'))
        if norm(r.get('Scholar ID')) in ids and pid in pubs:
            linked.add(pid)
            publishing.add(norm(r.get('Scholar ID')))
    pg = Counter(gender(r.get('Gender')) for r in scholars if norm(r['Scholar ID']) in publishing)

    # Search index — public-facing, minimal fields only. No gender, geography,
    # genealogy, notes, evidence, share tokens or contact details.
    deg_by = defaultdict(list)
    for lv, r in degs:
        deg_by[norm(r['Scholar ID'])].append((lv, r))
    index = []
    for r in scholars:
        if 'Public Display Approved' in r and fold(r.get('Public Display Approved')) == 'false':
            continue
        sid = norm(r['Scholar ID'])
        nm = first(r, 'Scholar Name', 'Display Name')
        if code in ('FJI',) and ',' in nm:  # Fiji stores "Family, Given"
            fam, giv = [x.strip() for x in nm.split(',', 1)]
            disp = f'{giv} {fam}'
        else:
            disp = nm
        lvls = sorted({('P' if lv in ('P', 'PD') else 'M') for lv, _ in deg_by[sid]})
        unis = sorted({destination(x)[2] for _, x in deg_by[sid] if destination(x)[2]})
        fields = sorted({norm(x.get('Field / Discipline') or x.get('Field')) for _, x in deg_by[sid] if norm(x.get('Field / Discipline') or x.get('Field'))})
        sd = sorted({short_discipline(code, x) for _, x in deg_by[sid]} - {''})
        index.append(dict(id=sid, n=disp, k=nm, c=code, d=lvls, f=fields[:4], s=sd, u=unis[:4]))

    years = Counter(v['year'] for pid, v in pubs.items() if pid in linked and v['year'])
    return dict(
        code=code, name=name,
        scholars=len(ids), masters=m, phd=p + pd, profDoc=pd,
        mastersHolders=holders_m, phdHolders=holders_p, bothHolders=both,
        degreesOutsideRoster=orphan, excludedRoster=dict(excl),
        gender=dict(female=g['female'], male=g['male'], unknown=g['unknown']),
        pubGender=dict(female=pg['female'], male=pg['male'], unknown=pg['unknown']),
        pubsIndexed=len(pubs), pubsIndigenous=len(linked), pubTypes=dict(ptype_counts),
        pubYears={str(k): v for k, v in sorted(years.items())},
        destinations=[dict(r=k[0], l=k[1], dec=k[2], n=v) for k, v in sorted(dest.items())],
        destinationCountries={k: dict(v) for k, v in dest_unis.items()},
        disciplines=({lv: dict(c) for lv, c in disc.items()} if disc else None),
        _pubkeys=[(pubs[pid]['key'], pubs[pid]['year'], pid in linked) for pid in pubs],
        index=index,
    )


CC2 = {'New Zealand': 'NZ', 'Australia': 'AU', 'United Kingdom': 'UK', 'United States': 'US', 'Canada': 'CA',
       'Fiji': 'FJ', 'France': 'FR', 'Malta': 'MT', 'Papua New Guinea': 'PG'}


def firsts(code, name, dump):
    """Earliest completed Master's and PhD per gender (Pacific Firsts timeline).

    Mirrors the country dashboards' Panel D rule: completed Master's / PhD
    records (professional doctorates excluded) dated by the completion-year
    column, gender from the Scholars sheet (never inferred). Ties on the
    earliest year are kept as `also`. Display name = first given + family.
    """
    scholars, _ = roster(code, dump)
    S = {norm(r['Scholar ID']): r for r in scholars}
    cand = defaultdict(list)
    for r in table(dump, 'Graduate Degrees', 'Degree ID'):
        sid = norm(r.get('Scholar ID'))
        if sid not in S or not completed(r) or level(r) not in ('M', 'P'):
            continue
        y = year_of(first(r, 'Finish / Completion Year', 'Completion Year', 'Graduation Year', 'End Year'))
        g = gender(S[sid].get('Gender'))
        if not y or g == 'unknown':
            continue
        s = S[sid]
        given, fam = first(s, 'Given Names'), first(s, 'Family Name')
        person = f"{given.split()[0]} {fam}" if given and fam else first(s, 'Scholar Name', 'Display Name')
        _, ctry, uni = destination(r)
        ctry = ctry or first(r, 'University Country', 'Country')
        cand[(level(r), g)].append(dict(year=y, person=person, uni=uni, uc=CC2.get(ctry, ctry)))
    out = []
    for (lv, g), L in cand.items():
        L.sort(key=lambda x: (x['year'], x['person']))
        tied = [x for x in L if x['year'] == L[0]['year']]
        stage = 'masters' if lv == 'M' else 'phd'
        title = 'Dr' if stage == 'phd' else ('Mr' if g == 'male' else 'Ms')
        fmt_p = lambda x: dict(person=f"{title} {x['person']}", uni=x['uni'], uc=x['uc'])
        out.append(dict(code=code, country=name, stage=stage, gender=g, year=tied[0]['year'],
                        **fmt_p(tied[0]), also=[fmt_p(x) for x in tied[1:]]))
    return out


def _sa_clients():
    """Service-account clients for CI (read-only scopes)."""
    import os
    raw = os.environ.get('REGIONAL_GOOGLE_SERVICE_ACCOUNT_JSON')
    if not raw:
        return None
    from google.oauth2.service_account import Credentials
    from googleapiclient.discovery import build
    creds = Credentials.from_service_account_info(json.loads(raw), scopes=[
        'https://www.googleapis.com/auth/spreadsheets.readonly',
        'https://www.googleapis.com/auth/drive.metadata.readonly'])
    return build('sheets', 'v4', credentials=creds, cache_discovery=False), build('drive', 'v3', credentials=creds, cache_discovery=False)


def pull_sa(dump_dir: Path, sheets, drive):
    dump_dir.mkdir(parents=True, exist_ok=True)
    meta = {}
    for code, name, sid, *_ in COUNTRIES:
        titles = [s['properties']['title'] for s in sheets.spreadsheets().get(spreadsheetId=sid, fields='sheets.properties.title').execute()['sheets']]
        want = [t for t in titles if t in ('Scholars', 'Graduate Degrees', 'Publications', 'Authorship', 'Positions', 'Institutions', 'News') or t.startswith('Part-')]
        vr = sheets.spreadsheets().values().batchGet(spreadsheetId=sid, ranges=want).execute()['valueRanges']
        json.dump({'titles': titles, 'data': {t: v.get('values', []) for t, v in zip(want, vr)}}, open(dump_dir / f'{code}.json', 'w'))
        meta[code] = drive.files().get(fileId=sid, fields='modifiedTime,name', supportsAllDrives=True).execute()
        print('pulled', code, flush=True)
    json.dump(meta, open(dump_dir / 'meta.json', 'w'), indent=1)


def pull(dump_dir: Path):
    sa = _sa_clients()
    if sa:
        return pull_sa(dump_dir, *sa)
    dump_dir.mkdir(parents=True, exist_ok=True)
    meta = {}
    for code, name, sid, *_ in COUNTRIES:
        info = json.loads(subprocess.run(['gws', 'sheets', 'spreadsheets', 'get', '--params', json.dumps(
            {'spreadsheetId': sid, 'fields': 'sheets.properties.title'})], capture_output=True, text=True, check=True).stdout)
        titles = [s['properties']['title'] for s in info['sheets']]
        want = [t for t in titles if t in ('Scholars', 'Graduate Degrees', 'Publications', 'Authorship', 'Positions', 'Institutions', 'News') or t.startswith('Part-')]
        vr = json.loads(subprocess.run(['gws', 'sheets', 'spreadsheets', 'values', 'batchGet', '--params', json.dumps(
            {'spreadsheetId': sid, 'ranges': want})], capture_output=True, text=True, check=True).stdout)['valueRanges']
        f = json.loads(subprocess.run(['gws', 'drive', 'files', 'get', '--params', json.dumps(
            {'fileId': sid, 'fields': 'modifiedTime,name'})], capture_output=True, text=True, check=True).stdout)
        json.dump({'titles': titles, 'data': {t: v.get('values', []) for t, v in zip(want, vr)}},
                  open(dump_dir / f'{code}.json', 'w'))
        meta[code] = f
        print('pulled', code, flush=True)
    json.dump(meta, open(dump_dir / 'meta.json', 'w'), indent=1)


def directory_section(dumps):
    """Regional scholar directory, gzip + base64 inside the encrypted bundle."""
    import base64, gzip
    from regional_directory import build_directory
    d = build_directory(dumps, COUNTRIES)
    raw = json.dumps(d, ensure_ascii=False, separators=(',', ':')).encode()
    return dict(gz=base64.b64encode(gzip.compress(raw, 9, mtime=0)).decode(), n=len(d['scholars']))


def news_section(dumps):
    """Panel A2 "Celebrating Pasifika scholars" stories (all 11 countries)."""
    import regional_news
    return regional_news.build(dumps, COUNTRIES, sys.modules[__name__])


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('--dump-dir', default='/tmp/regional-masters')
    ap.add_argument('--pull', action='store_true', help='re-read Master files via gws first')
    ap.add_argument('--out', default=str(ROOT / 'data' / 'regional-scholars.json'))
    a = ap.parse_args()
    d = Path(a.dump_dir)
    if a.pull:
        pull(d)
    meta = json.load(open(d / 'meta.json'))
    countries, sources, first_list, dumps = [], [], [], {}
    from regional_positions import build_positions, card_positions
    from regional_universities import build_study_map
    for code, name, sid, url, status in COUNTRIES:
        fp = d / f'{code}.json'
        if not fp.exists():
            sources.append(dict(code=code, name=name, status='Not yet connected'))
            continue
        dump = json.load(open(fp))
        dumps[code] = dump
        c = build_country(code, name, dump)
        first_list.extend(firsts(code, name, dump))
        c.update(dashboard=url, dashboardStatus=status, oct5=OCT5.get(code))
        countries.append(c)
        sources.append(dict(code=code, name=name, file=meta[code]['name'],
                            modified=meta[code]['modifiedTime'], status='Connected (read-only)'))
    # Regional deduplication across countries (DOI, else title+year)
    allkeys, indkeys, years = set(), set(), Counter()
    for c in countries:
        for k, y, lk in c.pop('_pubkeys'):
            allkeys.add(k)
            if lk and k not in indkeys:
                indkeys.add(k)
                if y:
                    years[y] += 1
    out = dict(
        generated=datetime.now(timezone.utc).isoformat(timespec='seconds'),
        schema=1,
        disciplineCategories=list(SHORT_DISCIPLINES),
        disciplineCountries=list(DISCIPLINE_COUNTRIES),
        sources=sources,
        countries=countries,
        regional=dict(uniquePubs=len(allkeys), uniqueIndigenousPubs=len(indkeys),
                      indigenousPubYears={str(k): v for k, v in sorted(years.items())}),
        firsts=sorted(first_list, key=lambda m: (m['year'], m['code'], m['stage'], m['gender'])),
        positions=build_positions(dumps),
        posCards=card_positions(dumps),
        directory=directory_section(dumps),
        studyMap=build_study_map(dumps, COUNTRIES),
        news=news_section(dumps),
    )
    Path(a.out).write_text(json.dumps(out, ensure_ascii=False, separators=(',', ':')))
    print('wrote', a.out, len(Path(a.out).read_bytes()), 'bytes')
    for c in countries:
        print(f"{c['code']}: scholars={c['scholars']} M={c['masters']} PhD={c['phd']} (prof {c['profDoc']}) "
              f"pubs={c['pubsIndexed']} indig={c['pubsIndigenous']} outside={c['degreesOutsideRoster']} idx={len(c['index'])}")
    print('regional', out['regional']['uniquePubs'], out['regional']['uniqueIndigenousPubs'])


if __name__ == '__main__':
    main()
