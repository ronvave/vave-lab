#!/usr/bin/env python3
"""Regional scholar directory section for the encrypted regional bundle.

Read-only: works on the per-country Master dumps already loaded by
build_regional_scholars.py. Output goes ONLY into the encrypted bundle.

Who appears (decision 2026-10-19):
  * the country's included roster (same rules as every other regional panel), and
  * where a Master file has a "Public Display Approved" column, only rows marked TRUE.
    Countries without that column (Fiji, Tonga, Solomon Islands, Samoa) are
    included because those scholars are already shown on their own dashboards.

What a card carries: display name, salutation, country, gender (for the filter),
paternal home village / island (and the Fiji / Tonga / Solomon Islands / Vanuatu
local label), current role, workplace and its country, completed degrees, study
regions, workplace sector, validated ORCID / Google Scholar links, the same
profile / photo / institution / department URLs the country cards use from the
Master file (https only) and linked publications. Photos and links that live in
the country dashboards' encrypted enrichment files are added in CI by
regional_card_extras.py (key `cardExtras`). Never included: share tokens, contact details, notes, evidence,
maternal geography, clans, birth years, spreadsheet IDs.
"""
from __future__ import annotations

import re
from collections import Counter, defaultdict

import build_regional_scholars as b

norm, fold, first = b.norm, b.fold, b.first

# Local labels — only these four countries (user decision). Values are the
# canonical spellings used by the live country dashboards.
TON_DIV = {'tongatapu': 'Tongatapu', 'vava u': "Vava'u", 'ha apai': "Ha'apai", 'eua': "'Eua",
           'ongo niua': 'Ongo Niua', 'niuas': 'Ongo Niua', 'niua': 'Ongo Niua'}
SLB_PROV = {fold(x): x for x in ('Central', 'Choiseul', 'Guadalcanal', 'Isabel', 'Makira-Ulawa',
                                  'Malaita', 'Rennell-Bellona', 'Temotu', 'Western')}
VUT_PROV = {fold(x): x for x in ('Torba', 'Sanma', 'Penama', 'Malampa', 'Shefa', 'Tafea')}
FJI_CONF = {'burebasaga': 'Burebasaga', 'kubuna': 'Kubuna', 'tovata': 'Tovata'}

BAD = {'', 'unclassified', 'unknown', 'not yet verified', 'unresolved', 'n a', 'na', 'none', 'tbc', 'tbd', 'not recorded'}

# Work-country name -> ISO 3166-1 alpha-2 (flag only; unknown names get no flag).
ISO2 = {
    'fiji': 'fj', 'tonga': 'to', 'solomon islands': 'sb', 'samoa': 'ws', 'vanuatu': 'vu', 'tuvalu': 'tv',
    'kiribati': 'ki', 'palau': 'pw', 'cook islands': 'ck', 'marshall islands': 'mh',
    'federated states of micronesia': 'fm', 'micronesia': 'fm', 'papua new guinea': 'pg', 'nauru': 'nr',
    'niue': 'nu', 'new caledonia': 'nc', 'french polynesia': 'pf', 'american samoa': 'as', 'guam': 'gu',
    'new zealand': 'nz', 'aotearoa new zealand': 'nz', 'australia': 'au', 'united states': 'us',
    'usa': 'us', 'united states of america': 'us', 'canada': 'ca', 'united kingdom': 'gb', 'uk': 'gb',
    'england': 'gb', 'scotland': 'gb', 'japan': 'jp', 'china': 'cn', 'taiwan': 'tw', 'india': 'in',
    'south korea': 'kr', 'singapore': 'sg', 'philippines': 'ph', 'indonesia': 'id', 'malaysia': 'my',
    'thailand': 'th', 'france': 'fr', 'germany': 'de', 'netherlands': 'nl', 'sweden': 'se',
    'norway': 'no', 'italy': 'it', 'spain': 'es', 'switzerland': 'ch', 'ireland': 'ie', 'malta': 'mt',
    'portugal': 'pt', 'belgium': 'be', 'denmark': 'dk', 'austria': 'at', 'finland': 'fi',
}
PRETTY = {'usa': 'United States', 'united states of america': 'United States', 'uk': 'United Kingdom',
          'aotearoa new zealand': 'New Zealand', 'micronesia': 'Federated States of Micronesia'}

TERTIARY = re.compile(r'universit|college|polytechnic|wananga|wānanga|institute of technology|seminary|'
                      r'school of medicine|medical school|law school|\bUSP\b|\bFNU\b|\bNUS\b|\bSINU\b|\bUPNG\b', re.I)

# Publication types -> card chip keys (same as the country cards) + BibTeX type.
PUBTYPE = {
    'journal article': 'journalArticle', 'article': 'journalArticle', 'book chapter': 'bookSection',
    'book section': 'bookSection', 'chapter': 'bookSection', 'book': 'book', 'phd thesis': 'thesisPhd',
    'doctoral thesis': 'thesisPhd', 'phdthesis': 'thesisPhd', 'master s thesis': 'thesisMasters',
    'masters thesis': 'thesisMasters', 'mastersthesis': 'thesisMasters', 'report': 'report',
    'techreport': 'report', 'technical report': 'report',
}
TYPE_WORDS = {'journal article', 'book chapter', 'book', 'report', 'thesis', 'phd thesis', 'master s thesis',
              'conference paper', 'article', 'misc', 'other', 'book section', 'incollection'}
HTTPS = re.compile(r'^https://[^\s"\'<>]{4,580}$', re.I)
ORCID_RE = re.compile(r'(\d{4}-\d{4}-\d{4}-\d{3}[\dX])')


def ok(v):
    v = norm(v)
    return v if fold(v) not in BAD and not v.startswith('#') else ''


def col(r, *pats, exclude=()):
    """First non-placeholder value whose column name matches all regexes in a pattern tuple."""
    for p in pats:
        for k in r:
            if re.search(p, k, re.I) and not any(re.search(x, k, re.I) for x in exclude):
                v = ok(r.get(k))
                if v:
                    return v
    return ''


def display_name(code, r):
    nm = first(r, 'Scholar Name', 'Display Name')
    if code == 'FJI' and ',' in nm:
        fam, giv = [x.strip() for x in nm.split(',', 1)]
        return f'{giv} {fam}'
    return nm


def salutation(r):
    v = first(r, 'Title / Salutation', 'Title/Salutation', 'Salutation')
    return v if 0 < len(v) <= 24 and fold(v) not in BAD else ''


LEAD_TITLE = re.compile(r"^((?:(?:prof\.?|professor|dr\.?|doctor|associate|assoc\.?|assistant|emeritus|emerita|revd\.?|rev\.?|reverend)\s+)+)(?=\S)", re.I)


TITLE_CANON = {'prof': 'prof', 'professor': 'prof', 'dr': 'dr', 'doctor': 'dr', 'assoc': 'assoc',
               'associate': 'assoc', 'assistant': 'asst', 'rev': 'rev', 'revd': 'rev', 'reverend': 'rev'}


def title_set(text):
    return {TITLE_CANON[w] for w in re.findall(r"[a-z]+", fold(text)) if w in TITLE_CANON}


def split_lead_title(name):
    m = LEAD_TITLE.match(name or '')
    if not m:
        return '', name
    rest = name[m.end():].strip()
    return (m.group(1).strip(), rest) if rest else ('', name)


def deceased(r):
    return fold(first(r, 'Alive / Deceased', 'Alive/Deceased', 'Vital Status', 'Living Status')) == 'deceased'


def retired(r):
    """Scholars!Retired ticked (TRUE). Deceased scholars show the memorial instead."""
    v = r.get('Retired')
    return v is True or fold(norm(v)) in ('true', 'yes', 'y', '1')


def year4(v):
    v = norm(v)
    return int(v) if re.fullmatch(r'\d{4}', v) and 1800 <= int(v) <= 2100 else None


def tidy_place(v):
    return re.sub(r'\s*;\s*', ' / ', ok(v))


def geography(code, r):
    """(line, loc) — paternal home village line and the local-label key (or '')."""
    loc, parts = '', []
    if code == 'FJI':
        conf = FJI_CONF.get(fold(r.get('Paternal Confederacy')), '')
        loc = conf
        v, p = tidy_place(r.get('Village Paternal')), ok(r.get('Province Paternal'))
        parts = [v, f'{p} Province' if p else '']
    elif code == 'TON':
        loc = TON_DIV.get(fold(r.get('Paternal Island Division')), '')
        parts = [tidy_place(r.get('Village/Town Paternal (Kolo)'))]
        if not loc:
            parts.append(ok(r.get('Paternal Island Division')))
    elif code in ('SLB', 'VUT'):
        prov_raw = ok(r.get('Paternal Province/City Area') if code == 'SLB' else r.get('Paternal Province'))
        table = SLB_PROV if code == 'SLB' else VUT_PROV
        loc = table.get(fold(prov_raw), '')
        isl = ok(r.get('Paternal Specific Island') if code == 'SLB' else r.get('Paternal Island'))
        vil = tidy_place(r.get('Paternal Village/Community') if code == 'SLB' else r.get('Paternal Village / Community'))
        parts = [vil, re.sub(r'\s*;\s*', ' / ', isl)]
        if prov_raw and not loc:
            parts.append(prov_raw)
    elif code == 'WSM':
        parts = [tidy_place(r.get('Village (Paternal)')), ok(r.get('Specific Island (Paternal)'))]
    else:
        vil = col(r, r'^Paternal .*Village')
        isl = col(r, r'^Paternal .*(Island|Atoll|State)', exclude=(r'Group',))
        parts = [tidy_place(vil), isl]
    seen, out = set(), []
    for p in parts:
        if p and fold(p) not in seen:
            seen.add(fold(p))
            out.append(p)
    return ', '.join(out), loc


def work_country(v):
    f = fold(v)
    if f in ISO2:
        return PRETTY.get(f, norm(v)), ISO2[f]
    return '', ''


def build_directory(dumps, country_meta):
    scholars, pubs, pub_index = [], [], {}
    counts = Counter()
    for code, dump in dumps.items():
        roster, _ = b.roster(code, dump)
        inst_names = {}
        for r in b.table(dump, 'Institutions', 'Institution ID'):
            inst_names[norm(r.get('Institution ID'))] = first(r, 'Canonical Name', 'Canonical Institution (C_Uni)', 'Original Name / Alias')
        # Degrees per scholar
        deg_by = defaultdict(list)
        for r in b.table(dump, 'Graduate Degrees', 'Degree ID'):
            if fold(r.get('Verification Status')) == 'excluded':
                continue
            lv = b.level(r)
            if lv and b.completed(r):
                deg_by[norm(r.get('Scholar ID'))].append((lv, r))
        # Publications
        P = b.table(dump, 'Publications', 'Publication ID / BibTeX Key') or b.table(dump, 'Publications', 'Publication ID')
        local = {}
        for r in P:
            pid = norm(r.get('Publication ID / BibTeX Key') or r.get('Publication ID'))
            if not pid or pid in local:
                continue
            if code == 'WSM' and fold(r.get('V2 Inclusion Flag')) != 'included':
                continue
            if fold(r.get('Verification Status')) == 'excluded' or fold(r.get('Dedup Status')) == 'duplicate':
                continue
            if 'Public Display Approved' in r and fold(r.get('Public Display Approved')) == 'false':
                continue
            title = norm(r.get('Title'))
            if not title:
                continue
            t = PUBTYPE.get(fold(first(r, 'Publication Type', 'Type', 'Entry Type')), 'other')
            y = b.year_of(r.get('Year'))
            doi = norm(r.get('DOI'))
            m = re.search(r'10\.\d{4,9}/\S+', doi)
            doi = m.group(0).rstrip('.,;') if m else ''
            authors = first(r, 'Authors — Full Ordered List', 'Authors as Published', 'Authors (as-published string)')
            n_auth = 0
            if not authors:
                authors = norm(r.get('Bibliographic Lead Author'))
                try:
                    n_auth = int(float(norm(r.get('Bibliographic Author Count')) or 0))
                except ValueError:
                    n_auth = 0
            bad = (fold(title) in TYPE_WORDS or re.match(r'^(doi:|title-year:|10\.\d{4})', title, re.I)
                   or re.match(r'^(doi:|title-year:)', authors, re.I)
                   or (norm(r.get('Year')) and not y))
            key = ('doi:' + doi.lower()) if doi else ('t:' + fold(title) + '|' + str(y or ''))
            if key not in pub_index:
                pub_index[key] = len(pubs)
                pubs.append(dict(
                    t=t, ti=title[:400], y=y or None, a=authors[:400], more=1 if n_auth > 1 else 0,
                    j=first(r, 'Journal / Book Title', 'Container / Journal', 'Journal/Publisher', 'Journal / Publisher')[:200],
                    pb=first(r, 'Publisher / Institution / School', 'Publisher / Institution')[:200],
                    doi=doi, u=first(r, 'URL', 'Primary URL') if not doi else '', x=1 if bad else 0))
            local[pid] = pub_index[key]
        auth = defaultdict(set)
        fa = defaultdict(set)
        for r in b.table(dump, 'Authorship', 'Authorship ID'):
            if fold(r.get('Verification Status')) == 'excluded':
                continue
            pid = norm(r.get('Publication ID / BibTeX Key') or r.get('Publication ID'))
            sid = norm(r.get('Scholar ID'))
            if pid not in local:
                continue
            auth[sid].add(local[pid])
            flag = fold(first(r, 'Is First Author?', 'Is First Author', 'Lead / First Author?', 'First Author Flag'))
            if flag in ('true', 'yes', 'y', '1') or norm(r.get('Author Position')) == '1':
                fa[sid].add(local[pid])

        for r in roster:
            if 'Public Display Approved' in r and fold(r.get('Public Display Approved')) != 'true':
                counts[(code, 'not approved')] += 1
                continue
            sid = norm(r['Scholar ID'])
            line, loc = geography(code, r)
            inst = first(r, 'Current Institution')
            if not inst:
                inst = inst_names.get(first(r, 'Current Institution ID'), '')
            inst = ok(inst)
            role = ok(first(r, 'Current Title / Role', 'Current Role'))
            if len(role) < 3:
                role = ''
            dept = ok(first(r, 'Current Department / Unit', 'Department', 'Current Department'))
            wc, iso = work_country(first(r, 'Institution Country', 'Current Country'))
            wr = b.destination({'University Country': wc})[0] if wc else ''
            wr = '' if wr in ('Unknown', 'Other') else wr
            # Memorial years (deceased scholars only), same 4-digit rule as the
            # country cards (master-file-adapter parseYearOrNull_).
            yb = yd = None
            if deceased(r):
                yb = year4(first(r, 'Year of Birth', 'Birth Year'))
                yd = year4(first(r, 'Year of Death', 'Death Year'))
            degs = deg_by.get(sid, [])
            lv = sorted({'P' if x in ('P', 'PD') else 'M' for x, _ in degs})
            dests = [b.destination(x) for _, x in degs]
            regions = sorted({d[0] for d in dests} - {'Unknown', 'Other'})
            study_c = sorted({f'{d[0]}|{d[1]}' for d in dests if d[0] not in ('Unknown', 'Other') and d[1]})
            disc = sorted({b.short_discipline(code, x) for _, x in degs} - {''}) if code in b.DISCIPLINE_COUNTRIES else []
            field = ok(first(r, 'Primary Discipline / Field', 'Primary Discipline'))
            if len(field) > 80:
                field = ''
            sector = ('University or tertiary' if TERTIARY.search(inst) else 'Other workplace') if inst else 'Not recorded'
            orcid_m = ORCID_RE.search(first(r, 'ORCID / Researcher ID', 'ORCID'))
            gs = first(r, 'Google Scholar URL', 'Google Scholar')
            gs = gs if re.match(r'https?://scholar\.google\.[a-z.]+/citations\?', gs) else ''
            g = b.gender(r.get('Gender'))
            # Same Master columns the country cards link from (https only).
            pu = first(r, 'Personal/Official Profile URL') if code == 'SLB' else (
                first(r, 'Official Profile URL') if code == 'WSM' else first(r, 'Current Profile URL'))
            pu = pu if HTTPS.match(pu) else ''
            ph = first(r, 'Photo URL')
            ph = ph if HTTPS.match(ph) else ''
            iu, du = first(r, 'Institution URL'), first(r, 'Department URL')
            iu, du = (iu if HTTPS.match(iu) else ''), (du if HTTPS.match(du) else '')
            ps = sorted(auth.get(sid, set()))
            rec = dict(id=sid, c=code, n=display_name(code, r))
            # Title shown once, before the name: a leading academic / clerical
            # title inside the Master name ("Professor X", "Revd Dr X") is
            # moved out of the name, the Master salutation wins when present,
            # and a stand-alone "Professor" is shown as "Prof" like other cards.
            # Titles later in a name (e.g. Samoan matai title + Dr) are kept.
            lead, rec['n'] = split_lead_title(rec['n'])
            sal = salutation(r) or lead
            sal = re.sub(r'(?i)^professor$', 'Prof', sal.strip())
            # Samoan names often carry the title after the matai title
            # ("Folasāitu Professor Julia Ioane"): keep that order, show
            # "Professor" as "Prof", and drop a salutation it would repeat.
            mid = title_set(rec['n'])
            if mid:
                rec['n'] = re.sub(r'(?<!Associate )(?<!Assistant )\bProfessor\b', 'Prof', rec['n'])
                if sal and title_set(sal) <= mid:
                    sal = ''
            if sal:   # drop salutation parts already in the name ("Sir", "Adi", matai titles)
                name_words = {fold(w) for w in rec['n'].split()[:3]}
                sal = ' / '.join(t for t in re.split(r'\s*/\s*', sal) if fold(t) not in name_words)
            fam = ok(r.get('Family Name')) or ok(r.get('Preferred Family Name')) or rec['n'].split()[-1]
            if not rec['n']:
                continue
            opt = dict(sal=sal, g={'female': 'F', 'male': 'M'}.get(g, ''), dec=1 if deceased(r) else 0, ret=1 if retired(r) and not deceased(r) else 0,
                       geo=line, loc=loc, role=role, inst=inst, dept=dept, wc=wc, iso=iso, d=lv, r=regions,
                       s=disc, fld=field, sec=sector, wr=wr, sc=study_c, yb=yb, yd=yd, orcid=orcid_m.group(1) if orcid_m else '', gs=gs,
                       p=ps, fa=len(fa.get(sid, set()) & set(ps)), f=sorted(fa.get(sid, set()) & set(ps)), pu=pu, ph=ph, iu=iu, du=du)
            rec.update({k: v for k, v in opt.items() if v not in ('', [], 0, None)})
            rec['_k'] = fold(fam) + ' ' + fold(rec['n'])
            scholars.append(rec)
            counts[(code, 'included')] += 1
    # Keep only publications linked to an included scholar, then re-index.
    used = sorted({i for sc in scholars for i in sc.get('p', [])})
    remap = {old: new for new, old in enumerate(used)}
    pubs = [{k: v for k, v in pubs[i].items() if v not in ('', None, 0)} for i in used]
    for sc in scholars:
        if 'p' in sc:
            sc['p'] = [remap[i] for i in sc['p']]
        if 'f' in sc:  # first-authored publications (Panel F badge)
            sc['f'] = [remap[i] for i in sc['f']]
    meta = {code: dict(included=counts[(code, 'included')], notApproved=counts[(code, 'not approved')]) for code in dumps}
    order = [c[0] for c in country_meta]
    scholars.sort(key=lambda s: (order.index(s['c']), s.pop('_k')))
    return dict(schema=1, scholars=scholars, pubs=pubs, coverage=meta)
