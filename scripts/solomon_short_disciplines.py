"""Panel B4: completed-degree discipline counts for the Solomon Islander roster.

The Solomon Graduate Degrees sheet has no Short Discipline column; most
Broad Discipline values already use the eight short categories. Others are
mapped explicitly or classified with the shared Fiji/Tonga fallback rules.
"""
import re

from master_short_disciplines import SHORT_DISCIPLINES, build_short_disciplines, fiji_short_discipline

BROAD_ALIASES = {
    'theology': 'Theology and religious studies',
    'business and economics': 'Social sciences',
    'business and management': 'Social sciences',
    'law and governance': 'Social sciences',
}


def solomon_short_discipline(degree):
    broad = str(degree.get('Broad Discipline') or '').strip()
    if broad in SHORT_DISCIPLINES:
        return broad
    if broad.casefold() in BROAD_ALIASES:
        return BROAD_ALIASES[broad.casefold()]
    return fiji_short_discipline({'Field / Discipline': degree.get('Field/Discipline'),
                                  'Broad discipline': broad})


def build_solomon_short_disciplines(degrees, scholars):
    roster = {str(s.get('Scholar ID') or '').strip(): dict(s) for s in scholars
              if str(s.get('Scholar ID') or '').strip()}
    for scholar in roster.values():
        g = str(scholar.get('Gender') or '').strip().casefold()
        scholar['Gender'] = {'male': 'Male', 'female': 'Female'}.get(g, '')
    eligible, orphans = [], set()
    for degree in degrees:
        sid = str(degree.get('Scholar ID') or '').strip()
        stage = str(degree.get('Stage') or degree.get('Degree Stage') or '').strip()
        stage = stage.replace('\u2019', "'").casefold()
        stage = {"master's": "Master's", 'masters': "Master's", 'phd': 'PhD/Doctorate',
                 'phd/doctorate': 'PhD/Doctorate', 'doctorate': 'PhD/Doctorate'}.get(stage)
        if not stage or not re.match(r'^Completed', str(degree.get('Completion Status') or '').strip(), re.I):
            continue
        if sid not in roster:
            if sid:
                orphans.add(sid)
            continue
        eligible.append({**degree, 'Scholar ID': sid, 'Degree Stage': stage,
                         'Short Discipline': solomon_short_discipline(degree)})
    model = build_short_disciplines(eligible, list(roster.values()))
    model['excludedOrphanScholars'] = len(orphans)
    model['unclassifiedScholars'] = model['allCompleted'] - model['overall']['total']
    model['unknownGenderScholars'] = model['overall']['total'] - model['overall']['male'] - model['overall']['female']
    return model
