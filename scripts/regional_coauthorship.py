"""Co-authorship network section for the Regional bundle (Fiji, Tonga, Solomon Islands, Vanuatu).

Read-only. Called by build_regional_scholars.py with the country Master dumps.
Output (gzip + base64 inside the encrypted Regional bundle):

  people : [[scholarId, countryCode, name], ...]   Indigenous scholars shown on the
           Regional directory (same roster and Public Display rules).
  ext    : [name, ...]                              outside co-authors, from the author
           lists (matched by family name + first initial).
  pubs   : [[type, year, title, [people idx], [ext idx], partial, authorCount], ...]
           Six main publication types only, deduplicated across countries by DOI,
           else title + year (same key as the Regional directory). partial = 1 when
           the Master holds only the lead author, so outside co-authors are incomplete.
  coverage: per country counts of linked publications and how many have full author lists.
"""
from __future__ import annotations

import base64
import gzip
import json
import re
from collections import Counter, defaultdict

import build_regional_scholars as b
import regional_directory as rd

CODES = ('FJI', 'TON', 'SLB', 'VUT')
MAIN = {'journalArticle', 'bookSection', 'book', 'report', 'thesisMasters', 'thesisPhd'}
norm, fold, first = b.norm, b.fold, b.first
TITLES = re.compile(r'^(dr|prof|professor|rev|mr|mrs|ms|sir|hon)\.?\s+', re.I)


def split_authors(s):
    s = norm(s)
    if not s:
        return []
    s = re.sub(r'\s*(,|;)?\s*(et al\.?|and others)\s*$', '', s, flags=re.I)
    if ';' in s:
        parts = s.split(';')
    elif re.search(r'\s+and\s+', s):
        parts = re.split(r'\s+and\s+', s)
    elif s.count(',') >= 2 and not re.search(r',\s*[A-Z]\.?$', s):
        # "First Last, First Last, ..." (no family-name-first pairs)
        parts = s.split(',') if all(len(p.split()) >= 2 for p in s.split(',')) else [s]
    else:
        parts = [s]
    out = []
    for p in parts:
        p = TITLES.sub('', norm(p).strip(' .,&'))
        if len(p) >= 2 and not re.match(r'^(others|et al|doi:|title-year:|https?:)', p, re.I) and not re.search(r'\d', p):
            out.append(p)
    return out


def name_key(n):
    """(family, first initial) from 'Family, Given' or 'Given Family'."""
    n = TITLES.sub('', norm(n))
    if ',' in n:
        fam, giv = n.split(',', 1)
    else:
        toks = n.split()
        if not toks:
            return None
        fam, giv = toks[-1], ' '.join(toks[:-1])
    fam = re.sub(r'[^a-z\- ]', '', fold(fam)).strip()
    giv = re.sub(r'[^a-z ]', '', fold(giv)).strip()
    if not fam:
        return None
    return fam, (giv[:1] if giv else '')


def display(n):
    n = TITLES.sub('', norm(n))
    if ',' in n:
        fam, giv = n.split(',', 1)
        n = f'{giv.strip()} {fam.strip()}'.strip()
    return re.sub(r'\s+', ' ', n)[:80]


def build(dumps, country_meta):
    dumps = {c: d for c, d in dumps.items() if c in CODES}
    directory = rd.build_directory(dumps, [m for m in country_meta if m[0] in CODES])
    approved = {s['id']: s for s in directory['scholars'] if s['c'] in CODES}
    people, pidx = [], {}
    for sid, s in approved.items():
        pidx[sid] = len(people)
        people.append([sid, s['c'], s['n']])

    pubs, pub_index = [], {}
    ext, ext_index, ext_forms = [], {}, defaultdict(Counter)
    coverage = {}
    for code in CODES:
        dump = dumps.get(code)
        if not dump:
            continue
        local = {}
        P = b.table(dump, 'Publications', 'Publication ID / BibTeX Key') or b.table(dump, 'Publications', 'Publication ID')
        for r in P:
            pid = norm(r.get('Publication ID / BibTeX Key') or r.get('Publication ID'))
            if not pid or pid in local:
                continue
            if fold(r.get('Verification Status')) == 'excluded' or fold(r.get('Dedup Status')) == 'duplicate':
                continue
            if 'Public Display Approved' in r and fold(r.get('Public Display Approved')) == 'false':
                continue
            title = norm(r.get('Title'))
            t = rd.PUBTYPE.get(fold(first(r, 'Publication Type', 'Type', 'Entry Type')), 'other')
            if not title or t not in MAIN or fold(title) in rd.TYPE_WORDS or re.match(r'^(doi:|title-year:|10\.\d{4})', title, re.I):
                continue
            y = b.year_of(r.get('Year'))
            if norm(r.get('Year')) and not y:
                continue
            m = re.search(r'10\.\d{4,9}/\S+', norm(r.get('DOI')))
            doi = m.group(0).rstrip('.,;').lower() if m else ''
            key = ('doi:' + doi) if doi else ('t:' + fold(title) + '|' + str(y or ''))
            full = first(r, 'Authors — Full Ordered List', 'Authors as Published', 'Authors (as-published string)')
            try:
                n_auth = int(float(norm(r.get('Bibliographic Author Count')) or 0))
            except ValueError:
                n_auth = 0
            names = split_authors(full)
            partial = 0
            if not names:
                lead = first(r, 'Bibliographic Lead Author', 'Lead Author Name')
                names = split_authors(lead)[:1]
                partial = 1 if n_auth > 1 else 0
            if key not in pub_index:
                pub_index[key] = len(pubs)
                pubs.append(dict(t=t, y=y or None, ti=title[:180], db=set(), names=[], partial=partial,
                                 n=max(n_auth, len(names)), codes=set()))
            p = pubs[pub_index[key]]
            # Keep the most complete author list seen for this publication.
            if len(names) > len(p['names']) or (p['partial'] and not partial and names):
                p['names'], p['partial'] = names, partial
            p['n'] = max(p['n'], n_auth, len(names))
            local[pid] = pub_index[key]
        # Authorship links (database scholars) and the names they were recorded under.
        for r in b.table(dump, 'Authorship', 'Authorship ID'):
            if fold(r.get('Verification Status')) == 'excluded':
                continue
            pid = norm(r.get('Publication ID / BibTeX Key') or r.get('Publication ID'))
            sid = norm(r.get('Scholar ID'))
            if pid not in local or sid not in pidx:
                continue
            p = pubs[local[pid]]
            p['db'].add(sid)
            p['codes'].add(code)
            p.setdefault('rec', defaultdict(set))[sid].add(first(r, 'Author Name as Recorded', 'Author Name as Published'))

    # Outside co-authors: author-list names that are not the linked database scholars.
    out_pubs = []
    cov = {c: Counter() for c in CODES}
    for p in pubs:
        if not p['db']:
            continue
        mine = set()
        fams = Counter()
        for sid in p['db']:
            for n in list(p.get('rec', {}).get(sid, ())) + [approved[sid]['n']]:
                k = name_key(n)
                if k:
                    mine.add(k)
                    fams[k[0]] += 1
                    # Family names written last in multi-part names ("Given Middle Family").
                    for tok in k[0].split():
                        fams[tok] += 1
        ex = []
        for n in p['names']:
            k = name_key(n)
            if not k:
                continue
            # Skip the linked scholars themselves (same family name as a linked scholar).
            if k in mine or k[0] in fams or any(t in fams for t in k[0].split()):
                continue
            if k not in ext_index:
                ext_index[k] = len(ext)
                ext.append(None)
            ext_forms[k][display(n)] += 1
            if ext_index[k] not in ex:
                ex.append(ext_index[k])
        for c in p['codes']:
            cov[c]['pubs'] += 1
            cov[c]['partial' if p['partial'] else 'full'] += 1
            if p['partial']:
                cov[c]['partialMulti'] += 1
        out_pubs.append([p['t'], p['y'], p['ti'], sorted(pidx[s] for s in p['db']), ex, p['partial'], p['n']])
    for k, i in ext_index.items():
        ext[i] = ext_forms[k].most_common(1)[0][0]
    coverage = {c: dict(cov[c]) for c in CODES}
    data = dict(schema=1, countries=list(CODES), people=people, ext=ext, pubs=out_pubs, coverage=coverage)
    raw = json.dumps(data, ensure_ascii=False, separators=(',', ':')).encode()
    return dict(gz=base64.b64encode(gzip.compress(raw, 9, mtime=0)).decode(), n=len(people), pubs=len(out_pubs), ext=len(ext))
