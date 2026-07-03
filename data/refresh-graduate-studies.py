#!/usr/bin/env python3
"""Extract iTaukei graduate-studies info from the Zotero snapshot.

For every iTaukei scholar (sub-collection of 'iTaukei authors (>3 papers)'),
we scan the thesis items in that scholar's collection and pull out:
  * Masters degree info  (thesisType starts with MA / MSc / Masters / MPhil)
  * PhD degree info      (thesisType starts with PhD / Doctoral)
  * The university
  * The country (looked up from UNIVERSITY_COUNTRY below)

Only theses that appear in a scholar's iTaukei sub-collection count as
"iTaukei graduate work" — so if Ron only wants theses by research + published
papers, curating the collection in Zotero is where that filter is enforced.

Output: data/itaukei-graduate-studies.json (public dashboard reads this).
"""

import json
import re
import sys
from datetime import datetime, timezone
from pathlib import Path

REPO = Path(__file__).resolve().parent.parent
SNAP = REPO / "data" / "itaukei-zotero-snapshot.json"
OUT = REPO / "data" / "itaukei-graduate-studies.json"

# University -> ISO country + display label + rough lat/lng for the world map.
# Only the Pacific-region / Commonwealth universities iTaukei scholars actually
# attend. Add rows here whenever a new university appears in Ron's Zotero.
UNIVERSITY_COUNTRY = {
    # Fiji
    "University of the South Pacific":       ("FJ", "Fiji",         -18.148, 178.446),
    "Fiji National University":              ("FJ", "Fiji",         -18.152, 178.437),
    # New Zealand
    "Massey University":                     ("NZ", "New Zealand",  -40.383, 175.612),
    "University of Otago":                   ("NZ", "New Zealand",  -45.865, 170.514),
    "University of Auckland":                ("NZ", "New Zealand",  -36.852, 174.769),
    "University of Waikato":                 ("NZ", "New Zealand",  -37.788, 175.320),
    "Victoria University of Wellington":     ("NZ", "New Zealand",  -41.290, 174.767),
    "University of Canterbury":              ("NZ", "New Zealand",  -43.523, 172.583),
    "AUT University":                        ("NZ", "New Zealand",  -36.853, 174.766),
    # Australia
    "Australian National University":        ("AU", "Australia",    -35.278, 149.119),
    "University of New South Wales":         ("AU", "Australia",    -33.917, 151.231),
    "UNSW Sydney":                           ("AU", "Australia",    -33.917, 151.231),
    "University of Sydney":                  ("AU", "Australia",    -33.888, 151.187),
    "University of Queensland":              ("AU", "Australia",    -27.497, 153.014),
    "The University of Queensland":          ("AU", "Australia",    -27.497, 153.014),
    "Monash University":                     ("AU", "Australia",    -37.914, 145.135),
    "University of Melbourne":               ("AU", "Australia",    -37.797, 144.961),
    "University of Wollongong":              ("AU", "Australia",    -34.406, 150.877),
    "Deakin University":                     ("AU", "Australia",    -38.199, 144.302),
    "La Trobe University":                   ("AU", "Australia",    -37.720, 145.048),
    "Charles Sturt University":              ("AU", "Australia",    -35.084, 147.325),
    "James Cook University":                 ("AU", "Australia",    -19.328, 146.759),
    "University of Tasmania":                ("AU", "Australia",    -42.902, 147.328),
    "Curtin University":                     ("AU", "Australia",    -32.005, 115.894),
    "University of Adelaide":                ("AU", "Australia",    -34.921, 138.604),
    "Griffith University":                   ("AU", "Australia",    -27.560, 153.052),
    "Western Sydney University":             ("AU", "Australia",    -33.774, 150.907),
    "University of Sunshine Coast":          ("AU", "Australia",    -26.719, 153.058),
    "University of the Sunshine Coast":      ("AU", "Australia",    -26.719, 153.058),
    # USA
    "University of Hawaiʻi at Mānoa":       ("US", "USA",           21.297, -157.816),
    "University of Hawaii at Manoa":         ("US", "USA",           21.297, -157.816),
    "University of Oregon":                  ("US", "USA",           44.045, -123.075),
    "University of California":              ("US", "USA",           37.871, -122.259),
    # UK
    "University of Sussex":                  ("GB", "UK",            50.866, -0.087),
    "University of Cambridge":               ("GB", "UK",            52.204, 0.117),
    "University of Oxford":                  ("GB", "UK",            51.755, -1.254),
    "University College London":             ("GB", "UK",            51.524, -0.134),
    "University of Edinburgh":               ("GB", "UK",            55.944, -3.188),
    # Germany
    "University of Bremen":                  ("DE", "Germany",       53.108, 8.851),
    # Japan
    "Kagoshima University":                  ("JP", "Japan",         31.581, 130.545),
    "University of Tokyo":                   ("JP", "Japan",         35.712, 139.762),
    # Canada
    "University of British Columbia":        ("CA", "Canada",        49.267, -123.253),
}

# thesisType strings from Zotero can be anything the author typed. Classify.
PHD_RX      = re.compile(r"\b(phd|ph\.d|d\.phil|doctoral|dissertation|doctorate)\b", re.I)
MASTERS_RX  = re.compile(r"\b(m\.?a\.?|m\.?s\.?c\.?|m\.?phil|masters?|m\.?tech)\b", re.I)


def classify(thesis_type: str) -> str:
    """Return 'phd', 'masters', or 'unknown'."""
    if not thesis_type:
        return "unknown"
    t = thesis_type.strip()
    if PHD_RX.search(t):
        return "phd"
    if MASTERS_RX.search(t):
        return "masters"
    return "unknown"


def lookup_country(uni: str):
    """Return (iso, country, lat, lng) or None if we don't know this uni."""
    if not uni:
        return None
    key = uni.strip()
    hit = UNIVERSITY_COUNTRY.get(key)
    if hit:
        return hit
    # Try a fuzzy startswith on the map keys — Zotero often has trailing
    # location like "University of Hawaiʻi at Mānoa, Honolulu"
    for k, v in UNIVERSITY_COUNTRY.items():
        if key.lower().startswith(k.lower()) or k.lower() in key.lower():
            return v
    return None


def main() -> None:
    snap = json.loads(SNAP.read_text())
    items = snap.get("items", [])
    cols = snap.get("collections", [])

    root = next((c for c in cols if c["name"] == "iTaukei authors (>3 papers)"), None)
    if not root:
        print("ERROR: root collection missing", file=sys.stderr)
        sys.exit(1)

    itaukei_subs = [c for c in cols if c.get("parent") == root["key"]]
    key_to_name = {c["key"]: c["name"] for c in itaukei_subs}
    itaukei_col_keys = set(key_to_name)

    # For each scholar, list every thesis in their sub-collection
    scholars = {}
    unknown_universities = set()

    for item in items:
        if item.get("itemType") != "thesis":
            continue
        item_cols = set(item.get("collections") or [])
        scholar_hits = item_cols & itaukei_col_keys
        if not scholar_hits:
            continue

        uni = (item.get("university") or "").strip()
        thesis_type = (item.get("thesisType") or "").strip()
        year = item.get("year") or item.get("date") or ""
        # Extract just the year portion if the date is a full string
        m = re.search(r"\b(19|20)\d{2}\b", str(year))
        year_val = int(m.group(0)) if m else None

        level = classify(thesis_type)
        country_row = lookup_country(uni) if uni else None
        if uni and not country_row:
            unknown_universities.add(uni)

        record = {
            "level": level,
            "thesisType": thesis_type,
            "university": uni,
            "iso": country_row[0] if country_row else None,
            "country": country_row[1] if country_row else None,
            "lat": country_row[2] if country_row else None,
            "lng": country_row[3] if country_row else None,
            "year": year_val,
            "title": item.get("title") or "",
        }

        for col_key in scholar_hits:
            name = key_to_name[col_key]
            bucket = scholars.setdefault(name, {"masters": [], "phd": [], "unknown": []})
            bucket[level].append(record)

    # For each scholar: pick a primary masters and a primary phd (latest year)
    profiles = {}
    for name, entries in scholars.items():
        def pick(level: str):
            arr = entries.get(level) or []
            if not arr:
                return None
            # Prefer entries with known country, then latest year
            arr_sorted = sorted(
                arr,
                key=lambda r: (r["country"] is not None, r["year"] or 0),
                reverse=True,
            )
            return arr_sorted[0]

        profiles[name] = {
            "masters": pick("masters"),
            "phd": pick("phd"),
            "all": entries.get("masters", []) + entries.get("phd", []) + entries.get("unknown", []),
        }

    # World-map aggregation: (iso, university) -> list of scholar names
    by_uni = {}
    for name, prof in profiles.items():
        for role in ("masters", "phd"):
            rec = prof.get(role)
            if not rec or not rec.get("iso"):
                continue
            k = (rec["iso"], rec["country"], rec["university"], rec["lat"], rec["lng"])
            by_uni.setdefault(k, {"phd": [], "masters": []})[role].append(name)

    world_points = []
    for (iso, country, uni, lat, lng), buckets in by_uni.items():
        world_points.append({
            "iso": iso,
            "country": country,
            "university": uni,
            "lat": lat,
            "lng": lng,
            "phdScholars": sorted(buckets["phd"]),
            "mastersScholars": sorted(buckets["masters"]),
            "total": len(buckets["phd"]) + len(buckets["masters"]),
        })
    world_points.sort(key=lambda r: (-r["total"], r["country"], r["university"]))

    output = {
        "generatedAt": datetime.now(timezone.utc).isoformat(),
        "sourceSnapshot": snap.get("generatedAt"),
        "scholars": profiles,
        "worldPoints": world_points,
        "unknownUniversities": sorted(unknown_universities),
    }

    OUT.write_text(json.dumps(output, indent=2, ensure_ascii=False) + "\n")

    print(f"scholars with graduate work: {len(profiles)}")
    print(f"world-map points: {len(world_points)}")
    if unknown_universities:
        print("Universities with no country mapping (add to UNIVERSITY_COUNTRY):")
        for u in sorted(unknown_universities):
            print(f"  - {u!r}")


if __name__ == "__main__":
    main()
