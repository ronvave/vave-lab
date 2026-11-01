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


# Research-field descriptions for the co-authorship research groups. Written from the shared
# publication titles of each group in the combined, Indigenous-only network (all years).
# The page labels a detected group with the field whose anchor scholars it holds (2 or more).
FIELDS = [
    dict(label='Marine resources and fisheries', anchors=['ITK-S0126', 'ITK-S0315', 'ITK-S0266', 'ITK-S0312', 'ITK-S0058'],
         desc='Indigenous fishing knowledge, women fishers and food security, sea turtles, locally managed marine areas, coral rehabilitation and the livelihoods of coastal communities in Fiji.'),
    dict(label='Biodiversity and ecology', anchors=['ITK-S0292', 'ITK-S0135', 'ITK-S0293', 'ITK-S0040', 'ITK-S0341', 'ITK-S0167'],
         desc='Field biology in Fiji: new species (damselflies, marine bacteria), moths and birds, mangrove carbon and land-cover change, invasive species lists and forest wildlife. Field-science papers carry long author lists, so this is the most tightly knit group.'),
    dict(label='Indigenous economy and development', anchors=['ITK-S0331', 'ITK-S0057', 'ITK-S0195', 'ITK-S0262', 'ITK-S0213'],
         desc='Indigenous agricultural innovation, climate finance and carbon markets, the blue economy and deep-sea mining, Indigenous accounting, culture and diabetes, and the Pacific media. Its papers reach into several other fields, which places it at the centre of the network.'),
    dict(label='Infectious disease and sanitation', anchors=['ITK-S0191', 'ITK-S0385', 'ITK-S0181', 'ITK-S0433', 'ITK-S0229'],
         desc='Public health and microbiology in Fiji: antimicrobial resistance in hospitals, meningococcal outbreaks, COVID-19 vaccine response, latrines and water contamination, and climate-sensitive water-related diseases.'),
    dict(label='Nutrition and health policy', anchors=['ITK-S0339', 'ITK-S0128', 'ITK-S0199', 'ITK-S0209'],
         desc='Salt and sugar intake, sugar-sweetened beverage taxes, diabetes care, food insecurity and diets during COVID-19, with Indigenous Pacific research methods and tourism research.'),
    dict(label='Education and Indigenous knowledge', anchors=['ITK-S0132', 'ITK-S0352', 'ITK-S0144'],
         desc='Teacher education and culturally inclusive teaching in Fiji, rural and remote schools, Indigenous Fijian knowledge of the vanua, mentoring, and traditional ecological knowledge.'),
    dict(label='Climate, water and education', anchors=['ITK-S0313', 'ITK-S0189', 'ITK-S0091'],
         desc='Climate change and Indigenous wellbeing, water security and sea-level rise, loss and damage, traditional food preservation for disasters, and climate change in Fijian education.'),
    dict(label='Talanoa, vā and higher education', anchors=['TNG-S0071', 'TNG-S0165', 'TNG-S0243', 'TNG-S0051', 'TNG-S0087'],
         desc='Indigenising research through talanoa and vā, Indigenous academics in the diaspora, Tongan leadership, social work and youth justice, and reports on kava policy, labour mobility and cultural adoption. Fijian scholars join through social work and wellbeing research.'),
    dict(label='Tongan philosophy and arts', anchors=['TNG-S0092', 'TNG-S0009', 'TNG-S0002', 'TNG-S0252', 'TNG-S0006'],
         desc='Tongan tā-vā (time-space) philosophy, sung and danced poetry, performance art, language shift, Tongan identity in global sport, and Pacific Indigenous perspectives in health research teaching.'),
    dict(label='Solomon education and governance', anchors=['SOL-S0009', 'SOL-S0038', 'SOL-S0006', 'SOL-S0035', 'SOL-S0041', 'SOL-S0008'],
         desc='School leadership education, environmental peacebuilding, sport and national unity, elections, oral research methods and student resilience in Solomon Islands. Fijian and Tongan education scholars join through Pacific leadership and talanoa research, making it the most international group.'),
    dict(label='Solomon health and water', anchors=['SOL-S0070', 'SOL-S0015', 'SOL-S0014', 'SOL-S0069'],
         desc='Dengue vector surveillance, rural water safety and faith-based water management, child health nursing and hospital care in Solomon Islands.'),
    dict(label='Solomon conservation', anchors=['SOL-S0025', 'SOL-S0005', 'SOL-S0045', 'SOL-S0063'],
         desc='Indigenous perspectives on conserving endemic species, new bird records, and small-scale fisheries under the 30 by 30 target.'),
    dict(label='Pacific health in Aotearoa', anchors=['TNG-S0057', 'TNG-S0043', 'TNG-S0082', 'TNG-S0045'],
         desc='Co-designing gout education resources with Pacific people in Aotearoa New Zealand.'),
    dict(label='Science and ICT education', anchors=['ITK-S0008', 'ITK-S0042', 'ITK-S0291'],
         desc='Teaching science and the use of ICT in Fijian education.'),
    dict(label='Ocean and education in Tonga', anchors=['TNG-S0099', 'TNG-S0149', 'TNG-S0150'],
         desc="Ocean zoning in coastal Tonga and migrant women's views of secondary education."),
]


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
    data = dict(schema=1, countries=list(CODES), people=people, ext=ext, pubs=out_pubs, coverage=coverage, fields=FIELDS)
    raw = json.dumps(data, ensure_ascii=False, separators=(',', ':')).encode()
    return dict(gz=base64.b64encode(gzip.compress(raw, 9, mtime=0)).decode(), n=len(people), pubs=len(out_pubs), ext=len(ext))
