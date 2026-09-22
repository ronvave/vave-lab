"""B4: mirror Dashboard unique-Scholar-ID formulas before degree deduplication."""
from datetime import datetime, timezone
import re


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
