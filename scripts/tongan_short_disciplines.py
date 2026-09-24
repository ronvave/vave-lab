"""Completed-degree discipline counts for the confirmed Tonga Master cohort."""
from master_short_disciplines import build_short_disciplines
import re


def build_tongan_short_disciplines(degrees, scholars):
    roster = {str(s.get('Scholar ID') or '').strip(): dict(s) for s in scholars
              if re.fullmatch(r'TNG-S\d+', str(s.get('Scholar ID') or '').strip())}
    for scholar in roster.values():
        gender = str(scholar.get('Gender') or '').strip().casefold()
        scholar['Gender'] = {'tangata': 'Male', 'fefine': 'Female',
                             'male': 'Male', 'female': 'Female'}.get(gender, '')
    eligible, orphans = [], set()
    for degree in degrees:
        sid = str(degree.get('Scholar ID') or '').strip()
        stage = str(degree.get('Degree Stage') or '').strip()
        stage = stage.replace('’', "'").replace('ʻ', "'").casefold()
        stage = {"master's": "Master's", 'phd/doctorate': 'PhD/Doctorate'}.get(stage)
        if not stage or not re.match(r'^Completed', str(degree.get('Completion Status') or '').strip(), re.I):
            continue
        if sid not in roster:
            if sid:
                orphans.add(sid)
            continue
        eligible.append({**degree, 'Scholar ID': sid, 'Degree Stage': stage})
    model = build_short_disciplines(eligible, list(roster.values()))
    model['excludedOrphanScholars'] = len(orphans)
    model['unclassifiedScholars'] = model['allCompleted'] - model['overall']['total']
    model['unknownGenderScholars'] = model['overall']['total'] - model['overall']['male'] - model['overall']['female']
    return model
