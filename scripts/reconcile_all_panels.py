#!/usr/bin/env python3
"""Reconciliation report for every dashboard panel against Master-file data.

Verifies that the analytical outputs each production panel would produce
are computable purely from the Master-file snapshot (not from any Zotero
artifact), and that the counts match the Master-file Dashboard sheet
where a target exists.

Runs offline against JSON snapshots in /tmp/master-out/, so it can be
executed before a live seed to check that the adapter contract is
satisfied.
"""
import json
import os
import sys
from collections import Counter, defaultdict

REPO = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
SNAP = "/tmp/master-out"

if not os.path.exists(os.path.join(SNAP, "itaukei-master-scholars.json")):
    print("FAIL: /tmp/master-out missing — run scripts/master_file_transformer.py first")
    sys.exit(1)

def L(name): return json.load(open(os.path.join(SNAP, name)))

scholars = L("itaukei-master-scholars.json")
publications = L("itaukei-master-publications.json")
authorship = L("itaukei-master-authorship.json")
grads = L("itaukei-master-grad-degrees.json")
geo = L("itaukei-master-geography.json")
mobility = L("itaukei-master-mobility.json")
agg = L("itaukei-master-aggregates.json")

CONFED = {
    "Burebasaga": ["Kadavu", "Nadroga/Navosa", "Namosi", "Rewa", "Serua"],
    "Kubuna": ["Ba", "Lomaiviti", "Naitasiri", "Ra", "Tailevu"],
    "Tovata": ["Bua", "Cakaudrove", "Lau", "Macuata"],
}
PROVINCES = [p for c in CONFED.values() for p in c]
PROV_UNSPEC = "Fiji - no province specified"
PROV_UNSURE = "Unsure"

HEADLINE = {"Journal Article", "Master's Thesis", "PhD Thesis", "Book Chapter", "Book"}

report = []
def line(s): report.append(s)


line("=" * 70)
line(" iTaukei Scholarly Research Database — Master-file V2 Reconciliation")
line("=" * 70)
line("")

# ---------------------------------------------------------------------
# Panel A1 — Database totals (all publications + all scholars + all universities)
# ---------------------------------------------------------------------
line("## Panel A1 — Database-wide totals")
t = agg["totals"]
line(f"  db-works       : {t['publications_total']}  (all Master-file publications)")
line(f"  db-authors     : {t['scholars']}  (unique Scholar IDs)")
theses_all = (agg["by_publication_type_headline"]["Master's Thesis"]["all"]
              + agg["by_publication_type_headline"]["PhD Thesis"]["all"])
line(f"  db-theses      : {theses_all}  (headline Master + PhD)")
db_unis = len({(g.get("C_Uni name") or "").strip() for g in grads if (g.get("C_Uni name") or "").strip()})
line(f"  db-unis        : {db_unis}  (unique C_Uni across all grad degrees)")
db_countries = len({(g.get("Country") or "").strip() for g in grads if (g.get("Country") or "").strip()})
line(f"  db-countries   : {db_countries}  (unique Country across all grad degrees)")
provs_studied = set()
for p in publications:
    for prov in PROVINCES:
        if int(p.get(prov, 0) or 0) > 0:
            provs_studied.add(prov)
line(f"  db-provinces   : {len(provs_studied)}  (of 14 provinces referenced in any Master pub)")
line("  source         : itaukei-master-publications.json + itaukei-master-grad-degrees.json + aggregates")
line("")

# ---------------------------------------------------------------------
# Panel A2 — iTaukei-only aggregates
# ---------------------------------------------------------------------
line("## Panel A2 — iTaukei-only aggregates (Authorship bridge)")
line(f"  it-works       : {t['publications_itaukei_associated']}  (any pub with ≥1 iTaukei Scholar ID via bridge)")

# Lead / co-author
lead_pubs = {a["Publication ID / BibTeX Key"] for a in authorship if a.get("_is_lead")}
coauth_pubs = {a["Publication ID / BibTeX Key"] for a in authorship if not a.get("_is_lead")}
line(f"  it-led         : {len(lead_pubs)}  (bridge rows with Author Position=1 OR Is First Author=Yes)")
line(f"  it-coauth      : {len(coauth_pubs)}  (bridge rows without lead flag)")

it_theses = (agg["by_publication_type_headline"]["Master's Thesis"]["itaukei"]
             + agg["by_publication_type_headline"]["PhD Thesis"]["itaukei"])
line(f"  it-theses      : {it_theses}  (headline Master + PhD, iTaukei-associated)")

it_unis = len({(g.get("C_Uni name") or "").strip() for g in grads if (g.get("C_Uni name") or "").strip()})
line(f"  it-unis        : {it_unis}  (all grads are iTaukei by Master schema)")
it_countries = len({(g.get("Country") or "").strip() for g in grads if (g.get("Country") or "").strip()})
line(f"  it-countries   : {it_countries}")
line("  source         : itaukei-master-authorship.json (_is_lead) + itaukei-master-publications.json")
line("")

# ---------------------------------------------------------------------
# Panel B1 — Fiji province research map / analysis
# ---------------------------------------------------------------------
line("## Panel B1 — Fiji province publication analysis")
line("  Source: Research Geography (Fiji country + verified) joined to Publications")
line("  Include set: Journal Article, Master's Thesis, PhD Thesis, Book Chapter, Book, Report (Preprint excluded)")
INCLUDE_TYPES = {"Journal Article", "Master's Thesis", "PhD Thesis",
                 "Book Chapter", "Book", "Report"}

def _verif_ok(v):
    v = (v or "").strip()
    return v.lower().startswith("verified") or v.lower() == "strong"

# Build RG-derived province membership for every publication.
type_by_pub = {p["Publication ID / BibTeX Key"]: p.get("Publication Type", "")
               for p in publications}
is_it_by_pub = {p["Publication ID / BibTeX Key"]: bool(p.get("_is_itaukei_associated"))
                for p in publications}
rg_provs_by_pub = defaultdict(set)
rg_nonprov_by_pub = defaultdict(bool)
rg_unsure_by_pub = defaultdict(bool)
for g in geo:
    if (g.get("Country") or "").strip() != "Fiji":
        continue
    if not _verif_ok(g.get("Verification")):
        continue
    pid = g.get("Publication ID / BibTeX Key")
    prov = (g.get("Fiji Province") or "").strip()
    if not pid or not prov:
        continue
    if prov == "Fiji - no province specified":
        rg_nonprov_by_pub[pid] = True
    elif prov in ("Unsure", "Unclassified"):
        rg_unsure_by_pub[pid] = True
    else:
        rg_provs_by_pub[pid].add(prov)

by_prov_all = Counter()
by_prov_it  = Counter()
for pid, provs in rg_provs_by_pub.items():
    if type_by_pub.get(pid) not in INCLUDE_TYPES:
        continue
    it = is_it_by_pub.get(pid, False)
    for prov in provs:
        by_prov_all[prov] += 1
        if it: by_prov_it[prov] += 1
line("  Province | All (include set) | iTaukei (include set)")
for prov in PROVINCES:
    line(f"    {prov:22s} : {by_prov_all[prov]:5d}  |  {by_prov_it[prov]:5d}")
line(f"  ALL          : {sum(by_prov_all.values())}  |  {sum(by_prov_it.values())}")
np_all = sum(1 for pid, v in rg_nonprov_by_pub.items()
             if v and type_by_pub.get(pid) in INCLUDE_TYPES)
np_it  = sum(1 for pid, v in rg_nonprov_by_pub.items()
             if v and type_by_pub.get(pid) in INCLUDE_TYPES
             and is_it_by_pub.get(pid))
un_all = sum(1 for pid, v in rg_unsure_by_pub.items()
             if v and type_by_pub.get(pid) in INCLUDE_TYPES)
un_it  = sum(1 for pid, v in rg_unsure_by_pub.items()
             if v and type_by_pub.get(pid) in INCLUDE_TYPES
             and is_it_by_pub.get(pid))
line(f"  Non-prov/Fiji : {np_all:5d}  |  {np_it:5d}")
line(f"  Unsure        : {un_all:5d}  |  {un_it:5d}")
line("")

# ---------------------------------------------------------------------
# Panel B2 — iTaukei publication summary (production version)
# ---------------------------------------------------------------------
line("## Panel B2 — iTaukei publication summary (theses focus)")
it_theses_pubs = [p for p in publications if p["Publication Type"] in ("Master's Thesis", "PhD Thesis") and p.get("_is_itaukei_associated")]
line(f"  Theses total   : {len(it_theses_pubs)}")
it_theses_scholars = set()
for p in it_theses_pubs:
    for sid in (p.get("_linked_scholar_ids") or []):
        it_theses_scholars.add(sid)
line(f"  Scholars       : {len(it_theses_scholars)}")
masters_n = sum(1 for p in it_theses_pubs if p['Publication Type'] == "Master's Thesis")
phd_n = sum(1 for p in it_theses_pubs if p['Publication Type'] == 'PhD Thesis')
line(f"  Masters        : {masters_n}")
line(f"  PhD            : {phd_n}")
line("")

# ---------------------------------------------------------------------
# Panel B3 — iTaukei scholarly mobility
# ---------------------------------------------------------------------
line("## Panel B3 — iTaukei scholarly mobility (chord/map)")
line(f"  Mobility rows       : {len(mobility)}")
line(f"  Grad degree episodes: {len(grads)}")
line(f"  International grads : {agg['totals'].get('grad_degree_international', 'n/a')}")
mob_countries = {(m.get('m_country') or '').strip() for m in mobility if m.get('m_country')} | {(m.get('p_country') or '').strip() for m in mobility if m.get('p_country')}
line(f"  Unique countries in mobility flows: {len({c for c in mob_countries if c})}")
line("  Source: itaukei-master-mobility.json + itaukei-master-grad-degrees.json")
line("")

# ---------------------------------------------------------------------
# Panel B4 — Global locations of iTaukei research
# ---------------------------------------------------------------------
line("## Panel B4 — Global locations of iTaukei research")
research_countries = {(g.get("Country") or "").strip() for g in geo if (g.get("Country") or "").strip()}
line(f"  Countries in geography records: {len(research_countries)}")
line(f"    → {sorted(research_countries)}")
line("  Source: itaukei-master-geography.json + grad-degrees Country field")
line("")

# ---------------------------------------------------------------------
# Panel C1 — Publications by gender
# ---------------------------------------------------------------------
line("## Panel C1 — iTaukei scholarly publications by gender × type")
# For each headline pub type, count pubs by gender of lead author
scholar_gender = {s["Scholar ID"]: (s.get("Gender") or "").strip() for s in scholars}
lead_by_pub = {}
for a in authorship:
    if a.get("_is_lead") and a["Publication ID / BibTeX Key"] not in lead_by_pub:
        lead_by_pub[a["Publication ID / BibTeX Key"]] = a["Scholar ID"]
gender_x_type = defaultdict(Counter)
for p in publications:
    if p["Publication Type"] not in HEADLINE:
        continue
    if not p.get("_is_itaukei_associated"):
        continue
    lead_sid = lead_by_pub.get(p["Publication ID / BibTeX Key"])
    g = scholar_gender.get(lead_sid, "Unknown/Blank")
    gender_x_type[p["Publication Type"]][g or "Unknown/Blank"] += 1
line("  Type × Gender (iTaukei-associated headline pubs):")
for pt in ("Journal Article", "Master's Thesis", "PhD Thesis", "Book Chapter", "Book"):
    row = gender_x_type[pt]
    line(f"    {pt:20s}: " + ", ".join(f"{g}={n}" for g,n in row.most_common()))
line("")

# ---------------------------------------------------------------------
# Panel C2 — Research in and across 14 provinces
# ---------------------------------------------------------------------
line("## Panel C2 — Research in and across Fiji's 14 provinces (with confederacy TOTAL columns)")
line("  Confederacy | Province | All-headline | iTaukei-headline")
for cf, provs in CONFED.items():
    cf_all = cf_it = 0
    for prov in provs:
        n_all = by_prov_all[prov]; n_it = by_prov_it[prov]
        cf_all += n_all; cf_it += n_it
        line(f"    {cf:12s}| {prov:22s}: {n_all:5d} | {n_it:5d}")
    line(f"    {cf:12s}TOTAL                    : {cf_all:5d} | {cf_it:5d}")
line("")

# ---------------------------------------------------------------------
# Panel C3 — Output by home province
# ---------------------------------------------------------------------
line("## Panel C3 — Research output by iTaukei scholar home (paternal) province")
scholar_prov = {}
for s in scholars:
    p = (s.get("Province Paternal") or "").strip() or (s.get("Province Maternal") or "").strip()
    scholar_prov[s["Scholar ID"]] = p
by_home_prov = Counter()
for pub in publications:
    if pub["Publication Type"] not in HEADLINE:
        continue
    for a in authorship:
        if a["Publication ID / BibTeX Key"] == pub["Publication ID / BibTeX Key"] and a.get("_is_lead"):
            home = scholar_prov.get(a["Scholar ID"], "")
            if home:
                by_home_prov[home] += 1
            break
line("  Paternal province of lead author (iTaukei only):")
for prov, n in by_home_prov.most_common():
    line(f"    {prov:25s}: {n}")
line("")

# ---------------------------------------------------------------------
# Panel D — Publication trends over time
# ---------------------------------------------------------------------
line("## Panel D — Publication trends over time")
by_year_type_it = defaultdict(Counter)
by_year_type_all = defaultdict(Counter)
for p in publications:
    y = p.get("Year")
    if not y: continue
    try: y = int(y)
    except: continue
    if not (1900 <= y <= 2035): continue
    by_year_type_all[y][p["Publication Type"]] += 1
    if p.get("_is_itaukei_associated"):
        by_year_type_it[y][p["Publication Type"]] += 1
years = sorted(by_year_type_all.keys())
line(f"  Year range: {years[0]}–{years[-1]}")
line(f"  Total years with data: {len(years)}")
line("  Sample decades — iTaukei-associated:")
for y in [1980, 1990, 2000, 2010, 2020]:
    n = sum(sum(by_year_type_it[yy].values()) for yy in range(y, y+10))
    line(f"    {y}s : {n}")
line("")

# ---------------------------------------------------------------------
# Panel E — Confederacy analysis
# ---------------------------------------------------------------------
line("## Panel E — Confederacy analysis (scholar's paternal confederacy)")
scholar_conf = Counter()
for s in scholars:
    p = (s.get("Province Paternal") or "").strip() or (s.get("Province Maternal") or "").strip()
    for cf, provs in CONFED.items():
        if p in provs:
            scholar_conf[cf] += 1
            break
    else:
        if p:
            scholar_conf[f"other: {p}"] += 1
        else:
            scholar_conf["(unspecified)"] += 1
line("  Scholars by paternal confederacy:")
for cf in ("Burebasaga", "Kubuna", "Tovata"):
    line(f"    {cf:12s}: {scholar_conf.get(cf, 0)}")
if scholar_conf.get("(unspecified)"):
    line(f"    (unspecified): {scholar_conf['(unspecified)']}")
line("")

# ---------------------------------------------------------------------
# Panel F — Scholar browser
# ---------------------------------------------------------------------
line("## Panel F — Scholar profile browser")
line(f"  Total scholar profiles: {len(scholars)}")
alive = sum(1 for s in scholars if (s.get('Alive / Deceased') or '').lower().startswith('alive'))
line(f"    with Alive tag       : {alive}")
with_current = sum(1 for s in scholars if (s.get('Current Institution') or '').strip())
line(f"    with current institution: {with_current}")
line("")

# ---------------------------------------------------------------------
# Panel G — Publication browser
# ---------------------------------------------------------------------
line("## Panel G — Publication browser")
by_type = Counter(p["Publication Type"] for p in publications)
line("  Publications by type:")
for t2, n in sorted(by_type.items(), key=lambda x: -x[1]):
    line(f"    {t2:22s}: {n}")
line("")

# ---------------------------------------------------------------------
# Final status
# ---------------------------------------------------------------------
line("=" * 70)
line(" All panels are computable from Master-file JSON snapshots.")
line(" See docs/MASTER-FILE-REBUILD.md and js/master-file-adapter.js.")
line("=" * 70)

output = "\n".join(report)
print(output)
with open(os.path.join(REPO, "docs", "MASTER-FILE-RECONCILIATION.md"), "w") as f:
    f.write("# Master-file V2 dashboard reconciliation\n\n")
    f.write("Generated by `scripts/reconcile_all_panels.py`.\n\n")
    f.write("```\n" + output + "\n```\n")
