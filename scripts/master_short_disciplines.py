"""B4: mirror Dashboard unique-Scholar-ID formulas before degree deduplication."""
from datetime import datetime, timezone
import re


SHORT_DISCIPLINES = (
    'Theology and religious studies', 'Education', 'Health sciences',
    'Engineering, technology and planning', 'Life and environmental sciences',
    'Humanities', 'Social sciences', 'Earth, ocean and atmospheric sciences',
)


def fiji_short_discipline(degree):
    """Mirror Graduate Degrees!F5's rules without its array-spill dependency.

    Preserve recorded canonical categories; recover blank/error/noncanonical
    values from the same source fields and precedence. Unknown stays blank.
    This recovery is used only by the Fiji summary, not other countries.
    """
    recorded = str(degree.get('Short Discipline') or '').strip()
    if recorded in SHORT_DISCIPLINES:
        return recorded
    field = str(degree.get('Field / Discipline') or '').strip().lower()
    broad = str(degree.get('Broad discipline') or '').strip().lower()
    theology = r'theolog|religio|church|biblical|christian|pastoral|ecumen|methodist|anglican|faith|ministry'
    earth = r'marine|ocean|climate|atmospher|geograph|geolog|hydrolog|coastal|earth science'
    engineering = r'engineering|technology|information system|information technology|ict|computer|computing|digital|architecture|planning|gis|geomatic|survey|remote sensing|renewable energy|power|control|construction|mining'
    health = r'public health|medicine|medical|nursing|surgery|epidemi|health science|clinical|anaesth|cardiol|paediatr|obstetric|gynaec|dent|intensive care|emergency medicine|infectious|diabetes'
    if re.search(theology, field):
        return 'Theology and religious studies'
    broad_groups = {
        'education': 'Education',
        'health and welfare': 'Health sciences',
        'engineering, manufacturing and construction': 'Engineering, technology and planning',
        'information and communication technologies': 'Engineering, technology and planning',
        'agriculture, forestry, fisheries and veterinary science': 'Life and environmental sciences',
        'arts and humanities': 'Humanities',
        'social sciences, journalism and information': 'Social sciences',
        'business, administration and law': 'Social sciences',
        'services': 'Social sciences',
        'interdisciplinary or multidisciplinary studies': 'Social sciences',
    }
    if broad in broad_groups:
        return broad_groups[broad]
    if broad == 'natural sciences, mathematics and statistics':
        for pattern, category in ((earth, 'Earth, ocean and atmospheric sciences'),
                                  (engineering, 'Engineering, technology and planning'),
                                  (health, 'Health sciences')):
            if re.search(pattern, field):
                return category
        return 'Life and environmental sciences'
    for pattern, category in (
        (r'public health|medicine|medical|nursing|surgery|epidemi|health|clinical|anaesth|cardiol|paediatr|obstetric|gynaec|dent|infectious|diabetes', 'Health sciences'),
        (r'education|teaching|teacher|curriculum|pedagog|school|literacy|tvet|early childhood|educational', 'Education'),
        (engineering, 'Engineering, technology and planning'),
        (earth, 'Earth, ocean and atmospheric sciences'),
        (r'history|linguist|language|literature|archaeolog|heritage|art|museum|cultural|philosoph|humanities', 'Humanities'),
        (r'environment|ecolog|biology|agricultur|forestry|fisher|aquaculture|horticultur|animal science|veterinary|plant|entomolog|ornitholog|microbiology|food science|soil|agroforestry|crop|livestock|conservation|biodiversity|chemistry|coral reef|natural products|water quality|pollution', 'Life and environmental sciences'),
        (r'politic|law|policy|governance|sociolog|anthropolog|econom|business|development|psycholog|social|gender|international relations|public administration|accounting|finance|tourism|criminolog|demograph|diplomacy', 'Social sciences'),
    ):
        if re.search(pattern, field):
            return category
    return ''


def build_fiji_short_disciplines(degrees, scholars):
    resolved = [{**degree, 'Short Discipline': fiji_short_discipline(degree)}
                for degree in degrees]
    return build_short_disciplines(resolved, scholars)


def build_short_disciplines(degrees, scholars):
    genders = {str(s.get('Scholar ID', '')).strip(): str(s.get('Gender', '')).strip().lower() for s in scholars}
    def bucket():
        return {k: set() for k in ('total', 'male', 'female', 'masters', 'phd')}
    all_completed, all_masters = set(), set()
    overall, groups = bucket(), {}
    for degree in degrees:
        sid = str(degree.get('Scholar ID') or '').strip()
        stage = str(degree.get('Degree Stage') or '').strip()
        if not sid or stage not in ("Master's", 'PhD/Doctorate'):
            continue
        if not re.match(r'^Completed', str(degree.get('Completion Status') or '').strip(), re.I):
            continue
        all_completed.add(sid)
        key = 'masters' if stage == "Master's" else 'phd'
        if key == 'masters':
            all_masters.add(sid)
        discipline = str(degree.get('Short Discipline') or '').strip()
        if not discipline:
            continue
        for target in (overall, groups.setdefault(discipline, bucket())):
            target['total'].add(sid)
            target[key].add(sid)
            if genders.get(sid) in ('male', 'female'):
                target[genders[sid]].add(sid)
    def counts(group):
        return {key: len(ids) for key, ids in group.items()}
    rows = [{'discipline': name, **counts(group)} for name, group in groups.items()]
    rows.sort(key=lambda row: (-row['total'], row['discipline'].casefold()))
    return {'version': 1, 'generatedAt': datetime.now(timezone.utc).isoformat(),
            'rows': rows, 'overall': counts(overall),
            'allCompleted': len(all_completed), 'allMasters': len(all_masters)}
