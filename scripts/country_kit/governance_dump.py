#!/usr/bin/env python3
"""Read a country Master file (governance layout) READ-ONLY and write a
Tonga-shaped local dump that the generated <key>_master_file_transformer.py
can read with --mode local.

    python3 scripts/country_kit/governance_dump.py cook --dump-dir /tmp/kit/cook-dump

Nothing is written to the Master. Rows without an ID are skipped. Fields that
the Master does not hold are left blank (never inferred).
"""
from __future__ import annotations

import argparse
import os
import json
import re
import subprocess
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
from kitlib import KIT, load_country, norm, TONGA_DIVISIONS, TONGA_DISTRICT_TO_DIV  # noqa: E402
from generate_country import rename  # noqa: E402

# Tonga header -> candidate governance headers (first match wins).
ALIASES = {
    "Title / Salutation": ["Salutation"],
    "Alive / Deceased": ["Living Status"],
    "ORCID / Researcher ID": ["ORCID"],
    "Paternal Island Division": ["Statistical Region (Paternal)", "Paternal Island Group", "Community Affiliation 1 — State"],
    "District Paternal": ["Political/Census District (Paternal)", "Paternal Island", "Community Affiliation 1 — Municipality"],
    "Specific Island Paternal": ["Specific Island (Paternal)", "Paternal Island", "Community Affiliation 1 — Island / Atoll"],
    "Clan Paternal": ["Family / ʻĀiga (Paternal)", "Paternal Island Council / Puna"],
    "Village/Town Paternal (Kolo)": ["Village (Paternal)", "Paternal Village / Tapere", "Community Affiliation 1 — Village"],
    "Maternal Island Division": ["Statistical Region (Maternal)", "Maternal Island Group", "Community Affiliation 2 — State"],
    "District Maternal": ["Political/Census District (Maternal)", "Maternal Island", "Community Affiliation 2 — Municipality"],
    "Specific Island Maternal": ["Specific Island (Maternal)", "Maternal Island", "Community Affiliation 2 — Island / Atoll"],
    "Clan Maternal": ["Family / ʻĀiga (Maternal)", "Maternal Island Council / Puna"],
    "Village/Town Maternal (Kolo)": ["Village (Maternal)", "Maternal Village / Tapere", "Community Affiliation 2 — Village"],
    "Tonga Degree Episodes": ["Home-Country Degree Episodes"],
    "Identity Source ID": ["Identity Source ID", "Identity Source URL"],
    # Graduate Degrees
    "Degree Stage": ["Stage", "Degree Level"],
    "Degree / Qualification": ["Degree Name", "Degree Name"],
    "Broad discipline": ["Broad Discipline"],
    "C_Uni name": ["Current Institution Name", "Canonical University Name (C_Uni)"],
    "O_Uni name": ["Original Institution Name", "Original University Name (O_Uni)"],
    "Country": ["University Country", "Country", "Institution Country"],
    "International from Tonga?": ["International?"],
    "Finish / Completion Year": ["Completion Year"],
    "Thesis / Research Title": ["Thesis Title", "Thesis / Dissertation Title"],
    "Thesis / Repository URL": ["Thesis URL / Handle", "Repository URL"],
    "Evidence URL 1": ["Source URL"],
    "Verification": ["Verification Status"],
    "Notes": ["Record Notes"],
    # Publications
    "Publication ID / BibTeX Key": ["Publication ID"],
    "Journal / Book Title": ["Journal / Publisher", "Container / Journal"],
    "Publisher / Institution / School": ["Publisher / Institution"],
    "URL": ["Primary URL"],
    "Tagged Tonga?": ["About Country?"],
    "Tagged Tongan?": ["Verified Indigenous Scholar Linked?"],
    "Bibliographic Lead Author": ["Lead Author Name"],
    "Deduplication Key": ["Dedup Key"],
    "Discovery / Source URL": ["Discovery URL"],
    # Authorship
    "Author Name as Recorded": ["Published Name (as printed)", "Author Name as Published"],
    "Is First Author?": ["First Author Flag", "Lead / First Author?"],
    # Positions
    "Academic / Professional Title (verbatim)": ["Title", "Title (verbatim)"],
    "Standardized Leadership Category": ["Leadership Category"],
    "Evidence / Notes": ["Evidence"],
    # Research Geography
    "District": ["Political/Census District", "Island", "Municipality"],
    "Specific Island": ["Island", "Island / Atoll"],
    "Village / Town / Site": ["Village / Tapere", "Village / Site"],
    "Island Division (auto from District)": ["Statistical Region", "Island Group", "State"],
    # Institutions
    "Institution": ["Canonical Name", "Canonical Institution (C_Uni)", "Institution"],
    # Samoa-native layout
    "Scholar Name": ["Display Name"],
    "Year of Birth": ["Birth Year"],
    "Year of Death": ["Death Year"],
    "Identity Verification Status": ["Samoan Status"],
    "Primary Discipline / Field": ["Primary Discipline"],
    "Current Title / Role": ["Current Role"],
    "Institution Country": ["Current Country"],
    "Current Department / Unit": ["Current Department"],
    "Current PG Status": ["Current Postgraduate Status"],
    "Degree Episodes": ["Total Completed Degrees"],
    "Awards Count": ["Total Awards"],
    "Linked Publication Count": ["Total Publications"],
    "First-Author Publication Count": ["Total First-Author Publications"],
    "Current Leadership Category": ["Leadership Category"],
    "Current Leadership Level": ["Leadership Level"],
    "Current Profile URL": ["Official Profile URL"],
    "Name Variants / Aliases": ["Aliases (semicolon-separated)"],
    "Field / Discipline": ["Field"],
    "Thesis / Repository URL": ["Repository URL"],
    "Publication Type": ["Type"],
    "Authors — Full Ordered List": ["Authors (as-published string)"],
    "Open Access URL": ["Full Text URL"],
    "Corresponding Author?": ["Corresponding Author Flag"],
    "Affiliation at Publication": ["Affiliation (as printed)"],
    "Match Basis": ["Match Method"],
    "Department / Unit": ["Department"],
    "Start Year": ["Start Year", "Start Date"],
    "End Year": ["End Year", "End Date"],
    "Geography Record ID": ["Geography ID"],
    "Coding Basis / Evidence": ["Evidence (quote / page / figure)"],
    "Original Name / Alias": ["Aliases (semicolon-separated, includes historical names)"],
    "Institution Type": ["Type (University / Research Institute / Government / NGO / Industry / Other)"],
    "City / Locality": ["City", "City / Locality"],
}

TONGA_SHEETS = ["Scholars", "Part-Tongan", "Graduate Degrees", "Non-Completed Degrees",
                "Scholarships & Funding", "Awards & Honours", "Positions", "M>PhD mobility",
                "Publications", "Authorship", "Researcher Authorship", "Research Geography",
                "Research Geography Coordinates", "Institutions", "News"]
GOV_SHEET = {"Part-Tongan": None}  # resolved per country (partTab)
GEO_START = "Tongatapu"


def safe(name: str) -> str:
    return name.replace("/", "_").replace(">", "gt").replace(" ", "_")


_SA_SVC = None


def _sa_service():
    """Read-only Sheets client from GOOGLE_SERVICE_ACCOUNT_JSON (GitHub Actions)."""
    global _SA_SVC
    if _SA_SVC is None:
        from google.oauth2 import service_account
        from googleapiclient.discovery import build as gbuild
        info = json.loads(os.environ["GOOGLE_SERVICE_ACCOUNT_JSON"])
        creds = service_account.Credentials.from_service_account_info(
            info, scopes=["https://www.googleapis.com/auth/spreadsheets.readonly"])
        _SA_SVC = gbuild("sheets", "v4", credentials=creds, cache_discovery=False)
    return _SA_SVC


def fetch(master_id: str, sheet: str):
    if os.environ.get("GOOGLE_SERVICE_ACCOUNT_JSON"):
        try:
            res = _sa_service().spreadsheets().values().get(
                spreadsheetId=master_id, range=sheet, majorDimension="ROWS",
                valueRenderOption="FORMATTED_VALUE").execute()
        except Exception as e:  # missing tab -> None, like the gws path
            if "Unable to parse range" in str(e):
                return None
            raise
        return res.get("values", [])
    params = json.dumps({"spreadsheetId": master_id, "range": sheet, "majorDimension": "ROWS",
                         "valueRenderOption": "FORMATTED_VALUE"})
    r = subprocess.run(["gws", "sheets", "spreadsheets", "values", "get", "--params", params],
                       capture_output=True, text=True)
    if r.returncode != 0:
        return None
    out = r.stdout
    out = out[out.find("{"):]
    return json.loads(out).get("values", [])


def tonga_pub_headers(cfg):
    h = json.loads((KIT / "tonga_headers.json").read_text())["Publications"][3]
    a = h.index(GEO_START)
    b = h.index("Tonga - no district specified")
    return h[:a] + cfg["divisionList"] + cfg["districtList"] + h[b:]


def canon_place(v, cfg):
    """Return (division, district) for a governance place value, or ('','')."""
    if not v:
        return "", ""
    aliases = {norm(k).lower(): t for k, t in cfg["geojson"].get("aliases", {}).items()}
    n = norm(v).lower()
    n = norm(aliases.get(n, v)).lower()
    for d in cfg["districtList"]:
        if norm(d).lower() == n or norm(d).split(" / ")[0].lower() == n:
            return cfg["districtToDiv"][d], d
    for dv in cfg["divisionList"]:
        if norm(dv).lower() == n:
            return dv, ""
    return "", ""


def build(key: str, dump: Path, cache=None):
    cfg = load_country(key)
    th = json.loads((KIT / "tonga_headers.json").read_text())
    dump.mkdir(parents=True, exist_ok=True)
    report = {}
    gov = {}
    for sheet in ["Scholars", cfg["partTab"], "Graduate Degrees", "Non-Completed Degrees",
                  "Scholarships & Funding", "Awards & Honours", "Positions", "Publications",
                  "Authorship", "Research Geography", "Institutions", "News"]:
        rows = (cache or {}).get(sheet)
        if rows is None:
            rows = fetch(cfg["masterId"], sheet)
        gov[sheet] = rows or []
    # Research geography per publication (for one-hot district columns)
    geo_by_pub = {}
    g = gov["Research Geography"]
    if len(g) > 4:
        gh = g[3]
        for r in g[4:]:
            d = dict(zip(gh, r))
            pid = (d.get("Publication ID") or "").strip()
            if not pid or str(d.get("Public Display Approved", "")).upper() == "FALSE":
                continue
            div, dist = canon_place(d.get("Island") or d.get("Municipality") or d.get("Island / Atoll")
                                    or d.get("Political/Census District"), cfg)
            div2, _ = canon_place(d.get("Island Group") or d.get("State") or d.get("Statistical Region"), cfg)
            geo_by_pub.setdefault(pid, set()).update(x for x in (div or div2, dist) if x)

    # Institution ID -> canonical name (Samoa-style ID-keyed Masters)
    inst_name = {}
    ig = gov["Institutions"]
    if len(ig) > 4:
        for r in ig[4:]:
            d = dict(zip(ig[3], r))
            nm = d.get("Canonical Name") or d.get("Canonical Institution (C_Uni)") or ""
            if d.get("Institution ID") and nm:
                inst_name[d["Institution ID"]] = nm

    names = {}
    sc = gov["Scholars"]
    if len(sc) > 4:
        for r in sc[4:]:
            if r and len(r) > 1:
                names[r[0]] = r[1]

    for tsheet in TONGA_SHEETS:
        gsheet = cfg["partTab"] if tsheet == "Part-Tongan" else tsheet
        header_t = tonga_pub_headers(cfg) if tsheet == "Publications" else th.get(tsheet, [[], [], [], []])[3]
        header_new = [rename(h, cfg, "other") if h not in cfg["divisionList"] + cfg["districtList"] else h
                      for h in header_t]
        src = gov.get(gsheet) or []
        out_rows = [[rename(x, cfg, "other") for x in r] for r in th.get(tsheet, [[], [], [], []])[:3]]
        while len(out_rows) < 3:
            out_rows.append([])
        out_rows.append(header_new)
        n_in = 0
        if len(src) > 4:
            sh = src[3]
            idx = {h: i for i, h in enumerate(sh)}
            for r in src[4:]:
                if not r or not str(r[0]).strip():
                    continue
                d = {h: (r[i] if i < len(r) else "") for h, i in idx.items()}
                if str(d.get("Inclusion Status", "")).strip().lower() == "excluded":
                    continue
                n_in += 1
                row = []
                for h in header_t:
                    cands = [h] + ALIASES.get(h, [])
                    v = ""
                    for c in cands:
                        if c in d and str(d[c]).strip():
                            v = d[c]
                            break
                    row.append(v)
                rec = dict(zip(header_t, row))
                # geography normalisation (lineage fields: never inferred, only canonicalised)
                for side in ("Paternal", "Maternal"):
                    dk, vk = f"District {side}", f"{side} Island Division"
                    if dk in rec:
                        div, dist = canon_place(rec[dk], cfg)
                        if not dist:
                            div2, dist2 = canon_place(rec.get(f"Specific Island {side}", ""), cfg)
                            dist = dist2 if key == "cook" else ""
                        rec[dk] = dist
                        dv, _ = canon_place(rec.get(vk, ""), cfg)
                        rec[vk] = dv or (cfg["districtToDiv"].get(dist, "") if dist else "")
                if tsheet == "Research Geography":
                    div, dist = canon_place(rec.get("District"), cfg)
                    rec["District"] = dist
                    dv, _ = canon_place(rec.get("Island Division (auto from District)"), cfg)
                    rec["Island Division (auto from District)"] = dv or div
                if tsheet == "Publications":
                    tags = geo_by_pub.get(rec.get("Publication ID / BibTeX Key", ""), set())
                    for lab in cfg["divisionList"] + cfg["districtList"]:
                        rec[lab] = "Yes" if lab in tags else ""
                if tsheet in ("Graduate Degrees", "Non-Completed Degrees"):
                    st = rec.get("Degree Stage", "")
                    if re.match(r"(?i)phd|doctor", st):
                        rec["Degree Stage"] = "PhD/Doctorate"
                    elif re.match(r"(?i)master", st):
                        rec["Degree Stage"] = "Master's"
                    if not rec.get("Year / Status") or not re.search(r"\d{4}", str(rec.get("Year / Status"))):
                        rec["Year / Status"] = rec.get("Finish / Completion Year", "")
                    intl = [k for k in rec if k.startswith("International from")]
                    for k in intl:
                        if not str(rec[k]).strip() and rec.get("Country"):
                            rec[k] = "No" if rec["Country"] == cfg["countryValue"] else "Yes"
                if "Gender" in rec and cfg.get("genderLabels"):
                    gv = str(rec["Gender"]).strip().lower()
                    gl = cfg["genderLabels"]
                    rec["Gender"] = (gl["male"] if gv in ("male", "tāne", "tane", gl["male"].lower())
                                     else gl["female"] if gv in ("female", "fafine", gl["female"].lower())
                                     else "")
                if tsheet == "Positions" and not rec.get("Role Status") and d.get("Current Flag"):
                    rec["Role Status"] = ("Current" if str(d["Current Flag"]).strip().upper() in ("TRUE", "YES", "Y", "CURRENT")
                                          else "Former")
                for ik, idk in (("Current Institution", "Current Institution ID"), ("Institution", "Institution ID")):
                    if ik in rec and not rec[ik] and inst_name.get(d.get(idk, "")):
                        rec[ik] = inst_name[d[idk]]
                if "Scholar Name" in rec and not rec["Scholar Name"]:
                    rec["Scholar Name"] = names.get(rec.get("Scholar ID", ""), "")
                if tsheet == "Scholars" and "Retired" in rec:
                    rec["Retired"] = rec.get("Retired") or ""
                out_rows.append([rec.get(h, "") for h in header_t])
        report[tsheet] = {"from": gsheet, "rows": n_in, "missingTab": not src}
        (dump / f"{safe(rename(tsheet, cfg, 'other'))}.json").write_text(
            json.dumps({"rows": out_rows}, ensure_ascii=False))
    write_lookups_and_mobility(cfg, gov, dump, report)
    (dump / "_dump-report.json").write_text(json.dumps(report, indent=1))
    return report


def _dicts(rows):
    if len(rows) <= 4:
        return []
    h = rows[3]
    return [{k: (r[i] if i < len(r) else "") for i, k in enumerate(h)} for r in rows[4:] if r and str(r[0]).strip()]


def coord_pool():
    """Public university coordinates already in the repo (OSM/Nominatim) plus
    any local Tonga preview coordinates. Keyed by a normalised name."""
    from kitlib import ROOT
    pool = {}
    def nk(x):
        return re.sub(r"[^a-z0-9]+", " ", norm(x or "").lower()).strip()
    p = ROOT / "data" / "regional-university-locations.json"
    if p.exists():
        for k, v in json.loads(p.read_text())["locations"].items():
            pool[nk(v.get("name") or k)] = (v["lat"], v["lng"])
            pool[nk(k)] = (v["lat"], v["lng"])
    for extra in ("/tmp/kit/ton/tongan-world-universities.json",):
        if Path(extra).exists():
            for u in json.loads(Path(extra).read_text()).get("universities", []):
                pool.setdefault(nk(u["name"]), tuple(u["location"]))
    wp = Path("/tmp/kit/ton/tongan-master-worldpoints.json")
    if wp.exists():
        for u in json.loads(wp.read_text()).get("worldPoints", []):
            if u.get("lat") is not None:
                pool.setdefault(nk(u["university"]), (u["lat"], u["lng"]))
    for name, ll in {"Te Herenga Waka—Victoria University of Wellington": (-41.2901, 174.7682),
                     "Victoria University of Wellington": (-41.2901, 174.7682),
                     "University of Bradford": (53.7917, -1.7653)}.items():
        pool.setdefault(nk(name), ll)
    return pool


def _g(r, *names):
    for n in names:
        v = r.get(n)
        if v:
            return v
    return ""


def write_lookups_and_mobility(cfg, gov, dump, report):
    """Lookups!University coords from Institutions, and an M>PhD mobility table
    derived from Graduate Degrees (latest Master's before each PhD)."""
    inst = _dicts(gov["Institutions"])
    by_id, by_name = {}, {}
    for r in inst:
        try:
            lat, lon = float(r.get("Latitude")), float(r.get("Longitude"))
        except (TypeError, ValueError):
            lat = lon = None
        rec = {"name": _g(r, "Canonical Institution (C_Uni)", "Canonical Name", "Original Name / Alias"),
               "country": r.get("Country", ""), "city": _g(r, "City / Locality", "City"),
               "region": r.get("Region", ""), "lat": lat, "lon": lon}
        by_id[r.get("Institution ID")] = rec
        alias = _g(r, "Aliases (semicolon-separated, includes historical names)")
        for n in [_g(r, "Canonical Institution (C_Uni)", "Canonical Name"), r.get("Original Name / Alias")] + alias.split(";"):
            if n and n.strip():
                by_name[n.strip().lower()] = rec
    pool = coord_pool()
    def nk(x):
        return re.sub(r"[^a-z0-9]+", " ", norm(x or "").lower()).strip()
    for d in _dicts(gov["Graduate Degrees"]):
        nm = _g(d, "Canonical University Name (C_Uni)", "Current Institution Name",
                "Original University Name (O_Uni)", "Original Institution Name")
        if nm and nm.strip().lower() not in by_name and d.get("Institution ID") not in by_id:
            by_name[nm.strip().lower()] = {"name": nm, "country": _g(d, "University Country", "Country"),
                                           "city": d.get("City", ""), "region": d.get("Region", ""), "lat": None, "lon": None}
    for rec in list(by_name.values()) + list(by_id.values()):
        if rec["lat"] is None and rec.get("name"):
            hit = pool.get(nk(rec["name"]))
            if hit:
                rec["lat"], rec["lon"] = hit
    missing = sorted({r["name"] for r in by_name.values() if r["lat"] is None and r.get("name")})
    report["coordsMissing"] = missing
    look = [[], [], [], ["University", "Country", "Longitude", "Latitude"]]
    seen = set()
    for rec in list(by_id.values()) + list(by_name.values()):
        if rec["lat"] is not None and rec["name"] not in seen:
            seen.add(rec["name"])
            look.append([rec["name"], rec["country"], str(rec["lon"]), str(rec["lat"])])
    (dump / "Lookups.json").write_text(json.dumps({"rows": look}, ensure_ascii=False))
    th = json.loads((KIT / "tonga_headers.json").read_text())["M>PhD mobility"][3]
    names = {r["Scholar ID"]: r for r in _dicts(gov["Scholars"])}
    degs = _dicts(gov["Graduate Degrees"])
    out = [[], [], [], th]
    by_s = {}
    for d in degs:
        by_s.setdefault(d.get("Scholar ID"), []).append(d)
    n = 0
    for sid, ds in by_s.items():
        phds = [d for d in ds if re.match(r"(?i)phd|doctor", _g(d, "Degree Level", "Stage"))]
        mas = [d for d in ds if re.match(r"(?i)master", _g(d, "Degree Level", "Stage"))]
        if not phds or not mas:
            continue
        p = sorted(phds, key=lambda d: d.get("Completion Year") or "9999")[0]
        py = p.get("Completion Year") or "9999"
        mm = [m for m in mas if (m.get("Completion Year") or "0") <= py] or mas
        m = sorted(mm, key=lambda d: d.get("Completion Year") or "0")[-1]

        def side(d):
            rec = by_id.get(d.get("Institution ID")) or by_name.get(_g(d, "Canonical University Name (C_Uni)", "Current Institution Name").strip().lower()) or {}
            return {"uni": _g(d, "Canonical University Name (C_Uni)", "Current Institution Name",
                              "Original University Name (O_Uni)", "Original Institution Name"),
                    "in": _g(d, "Field / Discipline", "Field"), "city": d.get("City") or rec.get("city", ""),
                    "country": _g(d, "University Country", "Country") or rec.get("country", ""),
                    "region": d.get("Region") or rec.get("region", ""),
                    "lon": "" if rec.get("lon") is None else str(rec["lon"]),
                    "lat": "" if rec.get("lat") is None else str(rec["lat"]),
                    "year": d.get("Completion Year", ""), "title": ""}
        ms, ps = side(m), side(p)
        sc = names.get(sid, {})
        row = {"Scholar ID": sid, "Degree(s)": "Master's > PhD", "scholar_id": sid,
               "scholar": _g(sc, "Scholar Name", "Display Name"), "last": sc.get("Family Name", ""),
               "first": sc.get("Given Names", ""), "New?": ""}
        for k, v in ms.items():
            row["m_" + k] = v
        for k, v in ps.items():
            row["p_" + k] = v
        out.append([row.get(h, "") for h in th])
        n += 1
    (dump / "MgtPhD_mobility.json").write_text(json.dumps({"rows": out}, ensure_ascii=False))
    report["M>PhD mobility"] = {"derivedFrom": "Graduate Degrees", "rows": n}
    report["Lookups"] = {"derivedFrom": "Institutions", "rows": len(look) - 4}


if __name__ == "__main__":
    ap = argparse.ArgumentParser()
    ap.add_argument("key")
    ap.add_argument("--dump-dir", required=True)
    a = ap.parse_args()
    print(json.dumps(build(a.key, Path(a.dump_dir)), indent=1))
