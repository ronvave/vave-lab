#!/usr/bin/env python3
"""University study map section for the encrypted regional bundle (key `studyMap`).

Read-only: uses the per-country Master dumps already loaded by
build_regional_scholars.py. Output goes ONLY into the encrypted bundle.

What it holds
-------------
* unis  : one row per (canonical university, country) with its map location.
          Locations come, in order, from the repository's university location
          files (world-universities / tongan-world-universities, decrypted in
          CI), the country Master files' Institutions sheets (Latitude /
          Longitude), and data/regional-university-locations.json (OpenStreetMap
          look-ups for the remaining universities; public place data only).
* degs  : one row per completed Master's or PhD record held by an included
          scholar: [uni index or -1, home country code, 'M' | 'P', year or 0,
          Scholar ID]. No names: the page shows a name only when that Scholar ID
          is in the Regional Scholar Directory (Public Display Approved or
          already shown on a country dashboard). Everyone else is counted only.
* degGender, discGender : aggregate counts for the gender and fields views.

Never included: contact details, notes, evidence, thesis titles, spreadsheet IDs.
"""
from __future__ import annotations

import json
import re
import unicodedata
from collections import Counter, defaultdict
from pathlib import Path

import build_regional_scholars as b
from master_b2_worldpoints import canonicalize_university_name, UNI_ALIAS_TO_WU, _CAMPUS_OVERRIDES

ROOT = Path(__file__).resolve().parent.parent
LOC_FILE = ROOT / 'data' / 'regional-university-locations.json'
# Plaintext copies of the encrypted location files (bootstrapped in CI by
# scripts/decrypt_data.py / tongan_decrypt_data.py; never committed).
PLAIN_LOCATIONS = [ROOT / 'data' / 'world-universities.json', ROOT / 'data' / 'tongan-world-universities.json',
                   Path('/tmp/uni/world-universities.json'), Path('/tmp/uni/tongan-world-universities.json')]
PLAIN_POINTS = [Path('/tmp/uni/itaukei-master-worldpoints.json'), Path('/tmp/uni/tongan-master-worldpoints.json')]

BAD_UNI = re.compile(r' / |^not\b|unverified|not yet|^unknown$|^$', re.I)

REGION_OF = {  # map-filter regions
    'Pacific': 'Pacific Islands', 'Australia': 'Australia and New Zealand', 'New Zealand': 'Australia and New Zealand',
    'North America': 'North America', 'Europe': 'Europe', 'Asia': 'Asia', 'Other': 'Other regions', 'Unknown': 'Not recorded',
}
OTHER_COUNTRY_REGION = {  # countries that destination() leaves in "Other"
    'south africa': 'Other regions', 'trinidad and tobago': 'Other regions', 'barbados': 'Other regions',
    'jamaica': 'Other regions', 'israel': 'Asia', 'turkiye': 'Europe', 'turkey': 'Europe', 'ireland': 'Europe',
}


# Same institution recorded under two names or countries across Master files.
# Explicit list only; never fuzzy matching.
SAME_INSTITUTION = {
    ('IMO International Maritime Law Institute (IMLI)', 'Malta'): ('IMO International Maritime Law Institute', 'Malta'),
    ('UNSW Sydney', 'Australia'): ('University of New South Wales', 'Australia'),
    ('University of Guam', 'United States'): ('University of Guam', 'Guam'),
    ('University of the West Indies, St. Augustine', 'Trinidad and Tobago'): ('University of the West Indies', 'Trinidad and Tobago'),
}


def key(s):
    s = unicodedata.normalize('NFKD', str(s or '')).encode('ascii', 'ignore').decode().lower()
    s = s.replace('&', ' and ')
    s = re.sub(r"['\u02bb\u2019]", '', s)
    s = re.sub(r'\bthe\b', '', s)
    return re.sub(r'[^a-z0-9]+', ' ', s).strip()


def load_locations(dumps):
    C = {}

    def add(name, lat, lng, ctry, city, src):
        try:
            lat, lng = float(lat), float(lng)
        except (TypeError, ValueError):
            return
        if not name or (lat == 0 and lng == 0):
            return
        C.setdefault(key(name), dict(lat=round(lat, 4), lng=round(lng, 4), country=ctry or '', city=city or '', src=src))

    for p in PLAIN_LOCATIONS:
        if p.exists():
            for u in json.loads(p.read_text()).get('universities', []):
                if u.get('location') and len(u['location']) == 2:
                    add(u.get('name'), *u['location'], u.get('country'), u.get('city'), 'repository')
    for p in PLAIN_POINTS:
        if p.exists():
            for w in json.loads(p.read_text()).get('worldPoints', []):
                add(w.get('university'), w.get('lat'), w.get('lng'), w.get('country'), w.get('city'), 'repository')
    for code, dump in dumps.items():
        for r in b.table(dump, 'Institutions', 'Institution ID'):
            nm = b.first(r, 'Canonical Institution (C_Uni)', 'Canonical Name', 'Original Name / Alias')
            lat, lng = b.first(r, 'Latitude'), b.first(r, 'Longitude')
            ctry, city = b.first(r, 'Country'), b.first(r, 'City / Locality', 'City')
            add(nm, lat, lng, ctry, city, 'Master Institutions')
            for al in re.split(r'[;|]', b.first(r, 'Original Name / Alias', 'Aliases (semicolon-separated, includes historical names)', 'Aliases/Historical Names')):
                add(al.strip(), lat, lng, ctry, city, 'Master Institutions')
    if LOC_FILE.exists():
        for k, v in json.loads(LOC_FILE.read_text()).get('locations', {}).items():
            if v.get('lat') is not None:
                C.setdefault(k, dict(lat=v['lat'], lng=v['lng'], country=v.get('country', ''), city=v.get('place', ''), src='OpenStreetMap'))
    return C


def find(C, uni):
    canon = canonicalize_university_name(uni)
    for cand in (uni, canon, UNI_ALIAS_TO_WU.get(canon, '')):
        k = key(cand)
        if k and k in C:
            return C[k]
    return None


def build_study_map(dumps, country_meta):
    C = load_locations(dumps)
    unis, uni_ix, degs = [], {}, []
    deg_gender = {}
    disc_gender = {}
    missing = Counter()
    for code, _name, *_ in country_meta:
        dump = dumps.get(code)
        if not dump:
            continue
        scholars, _ = b.roster(code, dump)
        S = {b.norm(r['Scholar ID']): r for r in scholars}
        seen = set()
        dg = {'M': Counter(), 'P': Counter()}
        dsg = {'M': defaultdict(Counter), 'P': defaultdict(Counter)} if code in b.DISCIPLINE_COUNTRIES else None
        for r in b.table(dump, 'Graduate Degrees', 'Degree ID'):
            did = b.norm(r.get('Degree ID'))
            if did in seen:
                continue
            seen.add(did)
            if b.fold(r.get('Verification Status')) == 'excluded':
                continue
            lv = b.level(r)
            sid = b.norm(r.get('Scholar ID'))
            if not lv or not b.completed(r) or sid not in S:
                continue
            L = 'P' if lv in ('P', 'PD') else 'M'
            g = b.gender(S[sid].get('Gender'))
            dg[L][g] += 1
            if dsg is not None:
                dsg[L][g][b.short_discipline(code, r) or 'Unknown / unmapped'] += 1
            region, ctry, uni = b.destination(r)
            y = b.year_of(b.first(r, 'Finish / Completion Year', 'Completion Year', 'Graduation Year', 'End Year', 'Year / Status')) or 0
            ix = -1
            if uni and not BAD_UNI.search(uni):
                canon = canonicalize_university_name(uni)
                if (canon, ctry) in SAME_INSTITUTION:
                    canon, ctry = SAME_INSTITUTION[(canon, ctry)]
                    region = 'Pacific' if ctry == 'Guam' else region
                loc = None
                ov = _CAMPUS_OVERRIDES.get((canon, ctry)) if ctry else None
                if ov:
                    loc = dict(lat=ov[0], lng=ov[1], city=ov[2], country=ctry, src='repository')
                elif ctry or canon != 'University of the South Pacific':
                    loc = find(C, uni)
                if not ctry:
                    ctry = (loc or {}).get('country', '') if canon != 'University of the South Pacific' else ''
                reg = REGION_OF.get(region, 'Other regions')
                if region in ('Other', 'Unknown') and ctry:
                    reg = OTHER_COUNTRY_REGION.get(b.fold(ctry), reg if region == 'Other' else 'Other regions')
                uk = (key(canon), ctry)
                if uk not in uni_ix:
                    uni_ix[uk] = len(unis)
                    unis.append(dict(n=canon, c=ctry or '', r=reg,
                                     lat=loc['lat'] if loc else None, lng=loc['lng'] if loc else None,
                                     city=(loc or {}).get('city', ''), _names=Counter()))
                ix = uni_ix[uk]
                unis[ix]['_names'][uni] += 1
                if not loc:
                    missing[(canon, ctry)] += 1
            degs.append([ix, code, L, y, sid])
        deg_gender[code] = {L: dict(female=c['female'], male=c['male'], unknown=c['unknown']) for L, c in dg.items()}
        if dsg is not None:
            disc_gender[code] = {L: {g: dict(c) for g, c in G.items()} for L, G in dsg.items()}
    for u in unis:
        u.pop('_names')
    return dict(unis=unis, degs=degs, degGender=deg_gender, discGender=disc_gender,
                unlocated=[dict(n=k[0], c=k[1], degrees=v) for k, v in missing.most_common()],
                sources='University locations: repository location files, Master Institutions sheets, and OpenStreetMap (Nominatim) look-ups.')


if __name__ == '__main__':
    import sys
    d = Path(sys.argv[1] if len(sys.argv) > 1 else '/tmp/rm-dir')
    dumps = {c[0]: json.load(open(d / f'{c[0]}.json')) for c in b.COUNTRIES if (d / f'{c[0]}.json').exists()}
    out = build_study_map(dumps, b.COUNTRIES)
    print(len(out['unis']), 'universities;', len(out['degs']), 'degrees;',
          sum(1 for x in out['degs'] if x[0] >= 0 and out['unis'][x[0]]['lat'] is not None), 'on the map')
    print('unlocated:', out['unlocated'][:40])
