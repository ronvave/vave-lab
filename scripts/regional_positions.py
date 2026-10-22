"""Canonical university positions for the regional dashboard (Mock-ups A and D).

Reads each country's Positions (+ Institutions) sheet, keeps rows for scholars
on the included roster, and classifies every row on two axes:
  * university leadership (only at higher-education institutions; acting roles
    included; one row can carry several roles, e.g. "PVC and Dean")
  * academic rank (from the recorded/verbatim title first, then the
    standardized rank; Lecturer and Assistant Professor kept separate).
Output is per scholar: display name, gender, and which roles were ever / are
currently held, plus the institution country for each role (Mock-up B).
Counting happens client-side (unique scholars per role).
"""
import re

import build_regional_scholars as b

HE = re.compile(r"universit|college|polytechnic|institute of technology|seminary|theolog|\bUSP\b|\bSINU\b|\bNUS\b|\bFNU\b|\bAUT\b|unitec|\bTIHE\b|school of medicine|nursing school|wānanga|wananga|academy|graduate school|kolisi|\bTVET\b", re.I)
LEAD = [  # (key, label, regex) — most senior first; Pro/Deputy before VC
 ('chancellor', 'Chancellor / Pro-Chancellor', re.compile(r"(?<!vice[- ])(?<!vice )\b(pro[- ]?)?chancellor\b(?!.*vice)", re.I)),
 ('pvc', 'Pro / Deputy Vice-Chancellor', re.compile(r"\b(pro|deputy|assistant)[- ]?vice[- ]?chancellor|\bdvc\b|\bpvc\b|vice[- ]president", re.I)),
 ('vc', 'Vice-Chancellor / President', re.compile(r"\bvice[- ]?chancellor|\bpresident\b", re.I)),
 ('dean', 'Dean', re.compile(r"(?<!associate )(?<!deputy )(?<!assistant )(?<!sub-)\bdean\b", re.I)),
 ('assocdean', 'Associate / Deputy Dean', re.compile(r"\b(associate|deputy|assistant|sub-)[- ]?dean\b", re.I)),
 ('head', 'Head of School / Department', re.compile(r"(?<!deputy )(?<!acting deputy )(?<!co-)\bhead\b(?! (start|coach|teacher|girl|boy|prefect|of learning area))|department chair|\bchair(person)?,? (of )?(the )?(department|school|discipline|program)|\bchair of\b.*(department|studies)", re.I)),
 ('director', 'Director, university centre / institute', re.compile(r"\bdirector\b", re.I)),
]
RANK = [
 ('prof', 'Professor', re.compile(r"(?<!associate )(?<!assistant )(?<!assoc\. )(?<!adjunct )(?<!honorary )(?<!visiting )(?<!clinical )\bprofessor\b(?!ial fellow)|professor emerit|emerit\w* professor|distinguished professor|full professor", re.I)),
 ('assoc', 'Associate Professor', re.compile(r"(?<!honorary )(?<!adjunct )associate professor|\bassoc\. prof|\breader\b", re.I)),
 ('senlec', 'Senior Lecturer', re.compile(r"senior lecturer|principal lecturer", re.I)),
 ('asst', 'Assistant Professor', re.compile(r"assistant (clinical )?professor", re.I)),
 ('lec', 'Lecturer', re.compile(r"(?<!senior )(?<!assistant )(?<!principal )(?<!sessional )(?<!guest )\blecturer\b", re.I)),
 ('asstlec', 'Assistant Lecturer / Tutor / Teaching Assistant', re.compile(r"assistant lecturer|\btutor\b|teaching assistant|graduate assistant|teaching fellow|sessional lecturer|^fellow in\b", re.I)),
 ('rf', 'Research Fellow / Postdoc', re.compile(r"research fellow|postdoc|post-doc|research associate|senior research|research scientist", re.I)),
 ('adj', 'Adjunct / Honorary / Visiting', re.compile(r"adjunct|honorary|visiting|affiliate (faculty|professor)|professorial fellow", re.I)),
]

# Main academic ladder: a newer profile rank replaces an older current rank on this ladder only;
# adjunct and research-fellow roles can be held alongside it.
LADDER = {'prof', 'assoc', 'senlec', 'asst', 'lec', 'asstlec'}


def first(r, *ks):
    return b.first(r, *ks)

def positions(code, dump, posdump):
    sch, _ = b.roster(code, dump); S = {b.norm(r['Scholar ID']): r for r in sch}
    inst = {}
    for r in b.table(posdump, 'Institutions', 'Institution ID'):
        iid = b.norm(r.get('Institution ID'))
        if iid: inst[iid] = dict(name=first(r, 'Canonical Name', 'Canonical Institution (C_Uni)', 'Original Name / Alias'), type=first(r, 'Type', 'Type (University / Research Institute / Government / NGO / Industry / Other)', 'Institution Type'), country=first(r, 'Country'))
    out = []
    for r in b.table(posdump, 'Positions', 'Position ID'):
        sid = b.norm(r.get('Scholar ID'))
        if not b.norm(r.get('Position ID')) or sid not in S: continue
        iid = b.norm(r.get('Institution ID')); I = inst.get(iid, {})
        iname = first(r, 'Institution') or I.get('name') or ''
        if not iname and iid and not iid.startswith(code[:3]): iname = iid
        host = first(r, 'Country', 'Institution Country') or I.get('country', '')
        verb = first(r, 'Academic / Professional Title (verbatim)', 'Title', 'Title / Role', 'Title (verbatim)'); std = first(r, 'Standardized Academic Rank'); ltit = first(r, 'Leadership Title (verbatim)')
        title = ' ; '.join(x for x in [verb, std, ltit] if x)
        cur = (first(r, 'Role Status', 'Current Flag', 'Current?') or '').lower()
        current = cur in ('true', 'yes', 'current', 'y') or cur.startswith('current')
        itype = I.get('type', '')
        he = bool(HE.search(iname)) or bool(re.search(r'universit|college|polytechnic|seminary|theolog|academ', itype, re.I))
        out.append(dict(code=code, sid=sid, name=b.norm(S[sid].get('Scholar Name') or S[sid].get('Display Name')), gender=b.gender(S[sid].get('Gender')), title=title, verb=verb, std=std, ltit=ltit, inst=iname, host=host, current=current, he=he, status=cur,
                        dept=first(r, 'Department / Unit') or '', start=first(r, 'Start Year') or '', end=first(r, 'End Year') or ''))
    return out


def profile_rows(code, dump):
    """Current title on each scholar's profile (Scholars sheet), as one extra
    current position per scholar. Positions sheets lag behind profile updates
    (e.g. a promotion to Dean), so both sources are read."""
    sch, _ = b.roster(code, dump)
    inst = {}
    for r in b.table(dump, 'Institutions', 'Institution ID'):
        iid = b.norm(r.get('Institution ID'))
        if iid: inst[iid] = (first(r, 'Canonical Name', 'Canonical Institution (C_Uni)', 'Original Name / Alias'), first(r, 'Country'))
    out = []
    for s in sch:
        sid = b.norm(s.get('Scholar ID'))
        title = first(s, 'Current Title / Role', 'Current Role')
        if not sid or not title: continue
        raw = first(s, 'Current Institution', 'Current Institution ID') or ''
        iname, icountry = inst.get(raw, (raw, ''))
        host = first(s, 'Institution Country', 'Current Institution Country') or icountry
        dept = first(s, 'Current Department / Unit') or ''
        past = bool(re.search(r'\bretired\b|\bformer\b|at death|\blate\b|historical|deceased|last verified role', title, re.I))
        he = bool(HE.search(iname)) or bool(HE.search(dept)) or bool(re.search(r'faculty of|school of', title, re.I))
        out.append(dict(code=code, sid=sid, name=b.norm(s.get('Scholar Name') or s.get('Display Name')), gender=b.gender(s.get('Gender')), title=title, verb=title, std='', ltit='', inst=iname, host=host, current=not past, he=he, status='profile', src='profile'))
    return out

def classify(p):
    """Returns (list of leadership keys, highest academic rank key or None)."""
    p = dict(p, verb=re.sub(r'\s+', ' ', p.get('verb') or ''), ltit=re.sub(r'\s+', ' ', p.get('ltit') or ''), std=re.sub(r'\s+', ' ', p.get('std') or ''))
    lt = ' ; '.join(x for x in [p['verb'], p['ltit']] if x)
    leads = []
    if p['he'] and not re.search(r'student (association|union|council)|association|society', p['inst'], re.I) and not re.search(r'student|association|society|alumni|club', lt, re.I):
        for k, _, rx in LEAD:
            if rx.search(lt):
                if k == 'vc' and any(x in leads for x in ('pvc',)) and not re.search(r'(?<!pro )(?<!deputy )(?<!pro-)(?<!deputy-)\bvice[- ]?chancellor\b(?! (learning|academic|research|pacific))', re.sub(r'(pro|deputy|assistant)[- ]?vice[- ]?chancellor', '', lt, flags=re.I), re.I): continue
                if k == 'director' and leads: continue
                leads.append(k)
    rank = None
    for src in (p['verb'], p['ltit'], (p['std'] or '').split('/')[0]):
        for k, _, rx in RANK:
            if src and rx.search(src): rank = k; break
        if rank: break
    return leads, rank



def _disp(n):
    n = re.sub(r'\s+', ' ', n or '').strip()
    if ',' in n:
        fam, giv = [x.strip() for x in n.split(',', 1)]
        n = f'{giv} {fam}'
    n = re.sub(r'^(Distinguished |Emeritus |Associate |Assistant )?Professor\s+', '', n)
    return re.sub(r'(^|\s)(Dr|Prof)\.?\s+', r'\1', n).strip()


def _host(h):
    h = (re.split(r'\s*/\s*', (h or '').strip())[0] or 'Not recorded')
    return h.replace('Pacific regional', 'Regional / multi-country').replace('International', 'Regional / multi-country')


def build_positions(dumps):
    """dumps: {code: sheet dump incl. Scholars, Positions, Institutions}."""
    scholars, cov_pos, cov_sch, cov_prof = {}, {}, {}, {}
    for code, *_ in b.COUNTRIES:
        d = dumps.get(code)
        rows = positions(code, d, d) if d and d['data'].get('Positions') else []
        prof = profile_rows(code, d) if d else []
        cov_pos[code] = len(rows)
        cov_sch[code] = len({p['sid'] for p in rows})
        prof_rank = {}
        for p in prof:
            _, rk = classify(p)
            if rk and p['current']: prof_rank[p['sid']] = rk
        n_prof = set()
        for p in rows + prof:
            leads, rank = classify(p)
            roles = set(leads) | ({rank} if rank else set())
            if not roles:
                continue
            if p.get('src') == 'profile': n_prof.add(p['sid'])
            s = scholars.setdefault((code, p['sid']), dict(c=code, n=_disp(p['name']), g=p['gender'][0], r={}))
            for k in roles:
                e = s['r'].setdefault(k, dict(cur=False, h=[]))
                cur = p['current']
                # The profile's current rank supersedes an older "current" rank in the Positions sheet
                # (the older rank stays as ever held).
                if cur and k == rank and k in LADDER and p.get('src') != 'profile' and prof_rank.get(p['sid']) in LADDER and prof_rank.get(p['sid']) != rank:
                    cur = False
                e['cur'] = e['cur'] or cur
                h = _host(p['host'])
                if p.get('src') == 'profile' and h == 'Not recorded' and e['h']:
                    continue  # profile row adds no new host when the Positions sheet already has one
                if h not in e['h']:
                    e['h'].append(h)
        cov_prof[code] = len(n_prof)
    return dict(lead=[[k, l] for k, l, _ in LEAD], rank=[[k, l] for k, l, _ in RANK],
                coverage=dict(positions=cov_pos, withPositions=cov_sch, profile=cov_prof),
                scholars=sorted(scholars.values(), key=lambda s: (s['c'], s['n'])))


def _yr(v):
    v = re.sub(r'\.0$', '', b.norm(v) or '')
    return v if re.fullmatch(r'\d{4}', v) else ''


def card_positions(dumps):
    """Positions sheet rows per scholar for the regional directory cards, using the same
    allow-listed fields the country dashboard cards publish (scripts/country_positions.py):
    title, leadership title, department, institution, country, current/past, start and end year.
    Never included: Evidence / Notes, Source URL, Last Verified. Keyed by Scholar ID."""
    out = {}
    for code, *_ in b.COUNTRIES:
        d = dumps.get(code)
        if not (d and d['data'].get('Positions')):
            continue
        for p in positions(code, d, d):
            verb, std, ltit = p['verb'] or '', p['std'] or '', p['ltit'] or ''
            row = dict(t=verb or std or ltit, cur=bool(p['current']))
            if ltit and ltit != row['t'] and ltit.lower() not in verb.lower():
                row['l'] = ltit
            for k, v in (('d', p.get('dept')), ('i', p['inst']), ('c', (p['host'] or '').strip())):
                if v: row[k] = v
            s, e = _yr(p.get('start')), _yr(p.get('end'))
            if s: row['s'] = s
            if e: row['e'] = e
            if row['t'] or row.get('i'):
                out.setdefault(p['sid'], []).append(row)
    return out
