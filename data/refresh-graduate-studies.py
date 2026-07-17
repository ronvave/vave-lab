#!/usr/bin/env python3
"""Extract iTaukei graduate-studies info from the Zotero snapshot.

Panel A ("World-iTaukei graduate studies") is powered by this file's output,
data/itaukei-graduate-studies.json.

Source of truth
---------------
The Zotero collection tree
    iTaukei Thesis by Country/Universities (key: 9XHGQJE6)
       ├── Australia
       │     ├── University of Sydney
       │     ├── Australian National University (ANU)
       │     └── ...
       ├── Canada
       │     └── ...
       └── ...

Every thesis in any leaf sub-collection of that tree is treated as an
iTaukei-graduate work. The scholar name comes from the item's first
creator (Zotero surface form: "Last, First" or "First Last"), the
university comes from the leaf collection name, and the country comes
from the country-level parent (or grand-parent, for UK → England/Scotland
buckets).

Previously the script only counted theses whose author had a personal
sub-collection under "iTaukei authors (>2 papers)" — this missed every
one-degree scholar and dropped ~230 theses. It also relied on a hardcoded
university → country dict; the tree gives us both directly.

Output: data/itaukei-graduate-studies.json  (public dashboard reads this).
"""

import json
import os
import re
import sys
from datetime import datetime, timezone
from pathlib import Path

REPO = Path(__file__).resolve().parent.parent
SNAP = REPO / "data" / "itaukei-zotero-snapshot.json"
OUT = REPO / "data" / "itaukei-graduate-studies.json"
# world-universities.json is the canonical coordinate source. If a university
# has an entry there, we use those coords instead of (or in addition to) the
# hardcoded UNIVERSITY_COORDS dict below. Keeps the two datasets in sync so a
# new Japan uni in world-universities.json immediately gets plotted here.
WORLD_UNIS = REPO / "data" / "world-universities.json"

# Root of the country/university tree in Zotero. This is the canonical
# source of truth for which theses are iTaukei-graduate work.
# Match by stable Zotero key first (survives renames like the B2- prefix
# convention), then fall back to name matching for legacy snapshots.
THESIS_ROOT_KEY = "9XHGQJE6"
THESIS_ROOT_NAME_CANDIDATES = (
    "B2-iTaukei Thesis by Country/Universities",
    "iTaukei Thesis by Country/Universities",
)

# ISO2 codes for each country-level collection under THESIS_ROOT_NAME.
COUNTRY_ISO = {
    "Australia":       "AU",
    "Canada":          "CA",
    "China":           "CN",
    "Fiji":            "FJ",
    "Germany":         "DE",
    "India":           "IN",
    "Indonesia":       "ID",
    "Malta":           "MT",
    "New Zealand":     "NZ",
    "Papua New Guinea": "PG",
    "Philippines":     "PH",
    "Portugal":        "PT",
    "South Korea":     "KR",
    "Sweden":          "SE",
    "United Kingdom":  "GB",
    "USA":             "US",
    "Japan":           "JP",
    # UK sub-buckets — resolve back to GB.
    "England":         "GB",
    "Scotland":        "GB",
    "Wales":           "GB",
    "Northern Ireland":"GB",
}

# Display label used in country pills. Same as the collection name unless we
# want a slightly different presentation.
#
# We collapse every UK variant to a single "UK" display label so the world
# map, the by-country list, and the Countries / Universities of study filter
# all treat theses from England, Scotland, Wales, Northern Ireland, and the
# older "United Kingdom" collection as one country. The `countryCollection`
# field on each record still preserves the original Zotero collection name,
# so region-level drill-down remains possible if we ever add it.
COUNTRY_DISPLAY = {
    "United Kingdom":  "UK",
    "England":         "UK",
    "Scotland":        "UK",
    "Wales":           "UK",
    "Northern Ireland":"UK",
}

# Rough campus coordinates for every university that appears (or is likely
# to appear) as a leaf collection under the thesis tree. Only used to place
# a circle on the Leaflet world map. Add new rows here when Ron adds a new
# university leaf to Zotero — the JSON build will still work without a
# coord entry, but the university won't show on the map (only in the panel).
UNIVERSITY_COORDS = {
    # Fiji
    "University of the South Pacific":       (-18.148, 178.446),
    "Fiji National University":              (-18.152, 178.437),
    "University of Fiji":                    (-17.667, 177.450),
    # New Zealand
    "Massey University":                     (-40.383, 175.612),
    "University of Otago":                   (-45.865, 170.514),
    "University of Auckland":                (-36.852, 174.769),
    "University of Waikato":                 (-37.788, 175.320),
    "Victoria University of Wellington":     (-41.290, 174.767),
    "University of Canterbury":              (-43.523, 172.583),
    "Te Whare Wānanga o Awanuiārangi":       (-37.984, 176.982),
    "AUT University":                        (-36.853, 174.766),
    # Australia
    "Australian National University (ANU)":  (-35.278, 149.119),
    "Australian National University":        (-35.278, 149.119),
    "University of New South Wales":         (-33.917, 151.231),
    "UNSW Sydney":                           (-33.917, 151.231),
    "University of Sydney":                  (-33.888, 151.187),
    "University of Queensland":              (-27.497, 153.014),
    "The University of Queensland":          (-27.497, 153.014),
    "Monash University":                     (-37.914, 145.135),
    "University of Melbourne":               (-37.797, 144.961),
    "University of Wollongong":              (-34.406, 150.877),
    "Deakin University":                     (-38.199, 144.302),
    "La Trobe University":                   (-37.720, 145.048),
    "Charles Sturt University":              (-35.084, 147.325),
    "James Cook University":                 (-19.328, 146.759),
    "University of Tasmania":                (-42.902, 147.328),
    "Curtin University":                     (-32.005, 115.894),
    "University of Adelaide":                (-34.921, 138.604),
    "Griffith University":                   (-27.560, 153.052),
    "Western Sydney University":             (-33.774, 150.907),
    "University of Western Sydney":          (-33.774, 150.907),
    "University of Sunshine Coast":          (-26.719, 153.058),
    "University of the Sunshine Coast":      (-26.719, 153.058),
    "Royal Melbourne Institute of Technology": (-37.808, 144.964),
    "Melbourne College of Divinity":         (-37.798, 144.973),
    "Macquarie University":                  (-33.775, 151.115),
    "Victoria University":                   (-37.799, 144.881),
    "University of Canberra":                (-35.239, 149.084),
    "Murdoch University":                    (-32.070, 115.837),
    "University of Newcastle":               (-32.892, 151.706),   # Australia (NSW)
    "University of New England":             (-30.489, 151.652),
    "Queensland University of Technology":   (-27.478, 153.028),
    # USA
    "University of Hawaiʻi at Mānoa":        (21.297, -157.816),
    "University of Hawaii at Manoa":         (21.297, -157.816),
    "University of Hawaii":                  (21.297, -157.816),
    "University of Oregon":                  (44.045, -123.075),
    "University of California":              (37.871, -122.259),
    "Andrews University":                    (41.988, -86.335),
    "Vanderbilt University":                 (36.148, -86.803),
    "Brown University":                      (41.826, -71.402),
    "Brigham Young University":              (40.253, -111.658),
    # Canada
    "University of British Columbia":        (49.267, -123.253),
    "Royal Roads University":                (48.435, -123.474),
    # UK
    "University of Sussex":                  (50.866, -0.087),
    "University of Cambridge":               (52.204, 0.117),
    "University of Oxford":                  (51.755, -1.254),
    "University College London":             (51.524, -0.134),
    "University of Edinburgh":               (55.944, -3.188),
    "University of Central England":         (52.507, -1.898),
    "University of Bradford":                (53.792, -1.756),
    "University of Reading":                 (51.442, -0.945),
    "University of East Anglia":             (52.622, 1.242),
    "University of Wolverhampton":           (52.588, -2.128),
    "Cranfield Institute of Technology":     (52.072, -0.629),
    "University of Newcastle upon Tyne":     (54.980, -1.615),
    "Bournemouth University":                (50.742, -1.898),
    "Lancaster University":                  (54.010, -2.786),
    "University of Essex":                   (51.878, 0.947),
    "University of Southampton":             (50.937, -1.396),
    "University of Birmingham":              (52.451, -1.930),
    "Loughborough University":               (52.766, -1.226),
    "University of Nottingham":              (52.938, -1.196),
    "University of London":                  (51.522, -0.129),
    "University of Aberdeen":                (57.164, -2.099),
    # Germany
    "University of Bremen":                  (53.108, 8.851),
    # Malta
    "University of Malta":                   (35.902, 14.484),
    # Philippines
    "University of the Philippines":         (14.653, 121.070),
    # Portugal
    "University of Porto":                   (41.147, -8.616),
    # South Korea
    "Yonsei University":                     (37.565, 126.938),
    "Korean Development Institute (KDI)":    (37.362, 127.107),
    # Sweden
    "Lund University":                       (55.712, 13.194),
    # Indonesia
    "Bogor Agricultural University":         (-6.560, 106.725),
    # Japan
    "Kagoshima University":                  (31.581, 130.545),
    "University of Tokyo":                   (35.712, 139.762),
    "Kyoto University":                      (35.0261, 135.7807),
    "Tohoku University":                     (38.256, 140.842),
    "Sophia University":                     (35.684, 139.734),
    "University of Tsukuba":                 (36.108, 140.101),
    "Tokyo Medical and Dental University":   (35.7024, 139.7645),
    # Papua New Guinea
    "Papua New Guinea University of Technology": (-6.6640, 146.9865),
    # India
    "Mangalore University":                  (12.816, 74.928),
    # China
    "Tsinghua University":                   (40.001, 116.326),
    # New Zealand — additions
    "Auckland University of Technology":     (-36.853, 174.766),
    # Japan — additions
    "Hokkaido University":                   (43.073, 141.339),
}


def load_world_universities():
    """Return two dicts sourced from world-universities.json:

        coords[name]  -> (lat, lng)
        country[name] -> "Japan" | "Fiji" | ...

    world-universities.json is the canonical lookup for the dashboard's world
    map, so mirroring its data keeps the two datasets in sync. When a name
    appears both here and in UNIVERSITY_COORDS below, world-universities.json
    wins (it is easier to edit and reviewed alongside the map data).

    The country map lets us salvage theses that are tagged onto the thesis
    tree root without a country sub-collection — e.g. items filed directly
    under "iTaukei Thesis by Country/Universities" whose only country signal
    is the free-text university field. Previously those got silently dropped.
    """
    if not WORLD_UNIS.exists():
        return {}, {}
    try:
        wu = json.loads(WORLD_UNIS.read_text())
    except Exception as e:
        print(f"WARN: could not read {WORLD_UNIS.name}: {e}", file=sys.stderr)
        return {}, {}
    coords, country = {}, {}
    for u in wu.get("universities", []):
        name = u.get("name")
        if not name:
            continue
        loc = u.get("location")
        if loc and len(loc) >= 2:
            try:
                coords[name] = (float(loc[0]), float(loc[1]))
            except (TypeError, ValueError):
                pass
        c = u.get("country")
        if c:
            country[name] = c
    return coords, country


# thesisType strings from Zotero can be anything the author typed. Classify.
PHD_RX     = re.compile(r"\b(phd|ph\.d|d\.phil|doctoral|dissertation|doctorate|doctor of|doctor in)\b", re.I)
MASTERS_RX = re.compile(
    r"\b(m\.?a\.?|m\.?s\.?c\.?|m\.?ed|m\.?eng|m\.?phil|m\.?res|mba|mia|mmis|mst|mlitt|mlis|m\.?l\.?i\.?s|masters?|master's|master of|master in|m\.?tech)\b",
    re.I,
)


def classify(thesis_type: str, title: str = "") -> str:
    haystack = f"{thesis_type} {title}"
    if not haystack.strip():
        return "unknown"
    if PHD_RX.search(haystack):
        return "phd"
    if MASTERS_RX.search(haystack):
        return "masters"
    return "unknown"


def resolve_name(creator: str) -> str:
    """Normalize a creator string to a stable display name.

    Zotero surfaces creators as either "Last, First" or "First Last". We keep
    whichever form the author entered but strip whitespace and collapse
    multiple spaces so the scholar aggregation dedupes reliably.
    """
    if not creator:
        return ""
    return re.sub(r"\s+", " ", creator).strip()


def build_country_and_university_maps(collections):
    """Return two dicts from a Zotero collections list.

    country_of[key]     -> "Fiji" | "Australia" | ...   (name of the country-level ancestor)
    university_of[key]  -> "University of the South Pacific" | ...
                           (name of the leaf university collection; None for
                            country-only membership like the direct '_Australia' items)
    """
    by_key = {c["key"]: c for c in collections}
    # The thesis-country root lives under the top-level 'Thesis' collection
    # in Ron's Zotero group. Match by stable key first so panel-prefix
    # renames (e.g. adding a 'B2-' prefix) don't break the workflow; fall
    # back to any known display name for older snapshots.
    root = by_key.get(THESIS_ROOT_KEY)
    if not root:
        root = next((c for c in collections if c.get("name") in THESIS_ROOT_NAME_CANDIDATES), None)
    if not root:
        raise SystemExit(
            "ERROR: cannot find thesis-country root in snapshot "
            f"(key={THESIS_ROOT_KEY!r}, tried names={THESIS_ROOT_NAME_CANDIDATES!r})"
        )

    # Countries = direct children of the root.
    countries = {c["key"]: c["name"] for c in collections if c.get("parent") == root["key"]}

    # Walk the whole tree; for each descendant record the country (root child)
    # and the leaf university (deepest node whose parent is inside the tree
    # but which itself has no children). For UK sub-buckets (England /
    # Scotland) the "country" stays "United Kingdom".
    tree_keys = set(countries)
    tree_keys.add(root["key"])
    changed = True
    while changed:
        changed = False
        for c in collections:
            if c.get("parent") in tree_keys and c["key"] not in tree_keys:
                tree_keys.add(c["key"])
                changed = True

    country_of = {}
    university_of = {}
    has_children = {c.get("parent") for c in collections if c.get("parent")}

    for k in tree_keys:
        if k == root["key"]:
            continue
        # Walk up to find country-level ancestor (direct child of root).
        cur = by_key[k]
        chain = [cur]
        while cur.get("parent") and cur["parent"] != root["key"]:
            cur = by_key.get(cur["parent"])
            if not cur:
                break
            chain.append(cur)
        if not cur or cur.get("parent") != root["key"]:
            continue
        country_of[k] = cur["name"]

        # A leaf that has no children is a university (or a country-only bucket).
        # We flag as university iff (a) it has no children AND (b) it is not the country node itself.
        node = by_key[k]
        if node["key"] not in has_children and node["key"] != cur["key"]:
            university_of[k] = node["name"]

    return country_of, university_of, root["key"], root.get("name", ""), tree_keys


def main() -> None:
    snap = json.loads(SNAP.read_text())
    items = snap.get("items", [])
    cols  = snap.get("collections", [])

    country_of, university_of, root_key, root_name, tree_keys = build_country_and_university_maps(cols)

    # world-universities.json is the canonical coord lookup; it overrides the
    # hardcoded UNIVERSITY_COORDS below so we don't have to edit two files
    # when a new country/university is added to the map. The country map is
    # also used to salvage items whose Zotero tags miss a country parent.
    wu_coords, wu_country = load_world_universities()

    unknown_countries    = set()
    unknown_universities = set()

    # ------------------------------------------------------------------
    #  Build a scholar-level roll-up and a (country, university) roll-up.
    # ------------------------------------------------------------------
    scholars = {}   # name -> {"masters": [rec, ...], "phd": [...], "unknown": [...]}
    # (country, university) -> {"phd": set(names), "masters": set(names), "unknown": set(names), "records": [rec, ...]}
    by_uni = {}

    for item in items:
        if item.get("itemType") != "thesis":
            continue
        item_cols = set(item.get("collections") or [])
        # We only want items inside the country/university tree.
        member = item_cols & tree_keys
        if not member:
            continue

        # Pick the most specific membership for country + university.
        # (An item can be tagged into both a university leaf and its country parent.)
        # Prefer a university-level tag; fall back to a country-only tag.
        picked_uni = None
        picked_country = None
        for k in member:
            if k in university_of:
                picked_uni = university_of[k]
                picked_country = country_of.get(k)
                break
        if picked_uni is None:
            # No university leaf — use the country-only tag.
            for k in member:
                if k in country_of and country_of[k] not in (None,):
                    picked_country = country_of[k]
                    break

        # Fall back: use the university free-text field in the Zotero item.
        if picked_uni is None and item.get("university"):
            picked_uni = item["university"].strip()

        # If Zotero didn't put the item under a country sub-collection, try to
        # infer the country from world-universities.json using the picked_uni.
        # (Prevents theses tagged directly on the tree root from being dropped.)
        if picked_country is None and picked_uni:
            picked_country = wu_country.get(picked_uni)

        if picked_country is None:
            # Genuine unknown — no country sub-collection and no university
            # lookup match. Skip.
            continue

        iso = COUNTRY_ISO.get(picked_country)
        if not iso:
            unknown_countries.add(picked_country)

        # Prefer world-universities.json; fall back to the hardcoded dict.
        coords = None
        if picked_uni:
            coords = wu_coords.get(picked_uni) or UNIVERSITY_COORDS.get(picked_uni)
        if picked_uni and not coords:
            unknown_universities.add(picked_uni)

        level = classify(item.get("thesisType") or "", item.get("title") or "")

        # Prefer first creator as the "scholar" the thesis belongs to.
        creators = item.get("creators") or []
        scholar_name = resolve_name(creators[0]) if creators else "(unknown author)"

        # Extract year
        year_val = item.get("year")
        if not year_val:
            m = re.search(r"\b(19|20)\d{2}\b", str(item.get("date") or ""))
            year_val = int(m.group(0)) if m else None

        record = {
            "level": level,
            "thesisType": item.get("thesisType") or "",
            "university": picked_uni,
            "iso": iso,
            "country": COUNTRY_DISPLAY.get(picked_country, picked_country),
            "countryCollection": picked_country,
            "lat": coords[0] if coords else None,
            "lng": coords[1] if coords else None,
            "year": year_val,
            "title": item.get("title") or "",
            "zoteroKey": item.get("key"),
        }

        bucket = scholars.setdefault(scholar_name, {"masters": [], "phd": [], "unknown": []})
        bucket[level].append(record)

        if picked_uni:
            k = (iso, record["country"], picked_uni, record["lat"], record["lng"])
            uni_bucket = by_uni.setdefault(k, {"phd": set(), "masters": set(), "unknown": set(), "records": []})
            uni_bucket[level].add(scholar_name)
            uni_bucket["records"].append(record)

    # ------------------------------------------------------------------
    #  Scholar profile: pick a headline masters + phd (latest year that
    #  we can attach a country to; else latest year).
    # ------------------------------------------------------------------
    profiles = {}
    for name, entries in scholars.items():
        def pick(level: str):
            arr = entries.get(level) or []
            if not arr:
                return None
            arr_sorted = sorted(
                arr,
                key=lambda r: (r["country"] is not None, r["year"] or 0),
                reverse=True,
            )
            return arr_sorted[0]

        profiles[name] = {
            "masters": pick("masters"),
            "phd":     pick("phd"),
            "all":     entries.get("masters", []) + entries.get("phd", []) + entries.get("unknown", []),
        }

    # ------------------------------------------------------------------
    #  World-map points: one per (country, university) combo. We keep the
    #  full deduped scholar lists so the panel can show "16 Masters, 4 PhD"
    #  and drill into each name.
    # ------------------------------------------------------------------
    world_points = []
    for (iso, country, uni, lat, lng), buckets in by_uni.items():
        world_points.append({
            "iso": iso,
            "country": country,
            "university": uni,
            "lat": lat,
            "lng": lng,
            "phdScholars":     sorted(buckets["phd"]),
            "mastersScholars": sorted(buckets["masters"]),
            "unknownScholars": sorted(buckets["unknown"]),
            "phdCount":     len(buckets["phd"]),
            "mastersCount": len(buckets["masters"]),
            "unknownCount": len(buckets["unknown"]),
            # 'total' now counts theses (records), not distinct scholars, so
            # a scholar with both an MA and PhD at the same uni is counted
            # twice. The panel uses this for the "Total" pill; use the
            # phd/mastersScholars lists when you want distinct-scholar counts.
            "total": len(buckets["records"]),
            "thesesCount": len(buckets["records"]),
            "scholarsCount": len(buckets["phd"] | buckets["masters"] | buckets["unknown"]),
        })
    world_points.sort(key=lambda r: (-r["total"], r["country"], r["university"]))

    # ------------------------------------------------------------------
    #  Emit
    # ------------------------------------------------------------------
    output = {
        "generatedAt": datetime.now(timezone.utc).isoformat(),
        "sourceSnapshot": snap.get("generatedAt"),
        "source": {
            "rootCollection": root_name,
            "rootCollectionKey": root_key,
            "url": f"https://www.zotero.org/groups/{snap.get('source', {}).get('groupId', '')}/collections/{root_key}/collection",
        },
        "scholars": profiles,
        "worldPoints": world_points,
        "totals": {
            "theses":   sum(p["total"] for p in world_points)
                        + sum(len(v["unknown"]) + len(v["masters"]) + len(v["phd"])
                              for k, v in by_uni.items() if False),  # kept for schema stability
            "thesesTracked": sum(p["thesesCount"] for p in world_points),
            "scholars": len(profiles),
            "universities": len({(p["country"], p["university"]) for p in world_points}),
            "countries":    len({p["country"] for p in world_points}),
        },
        "unknownCountries":    sorted(unknown_countries),
        "unknownUniversities": sorted(unknown_universities),
    }

    OUT.write_text(json.dumps(output, indent=2, ensure_ascii=False) + "\n")

    print(f"scholars: {len(profiles)}")
    print(f"world-map points: {len(world_points)}")
    print(f"theses tracked: {output['totals']['thesesTracked']}")
    print(f"universities: {output['totals']['universities']}")
    print(f"countries: {output['totals']['countries']}")

    # ------------------------------------------------------------------
    # Coverage gaps — surface loudly.
    #
    # A university without coordinates renders in the Panel B2 by-country
    # list but has NO bubble on the world map (silent visualization gap).
    # A country without an ISO2 code drops the ISO field from every one of
    # its universities — which may break flag icons or downstream joins.
    #
    # Both are recoverable by editing COUNTRY_ISO / UNIVERSITY_COORDS at the
    # top of this file. Docs: docs/DATA-COVERAGE-GAPS.md.
    #
    # In CI (VAVELAB_STRICT_COVERAGE=1) these become fatal so a silent map
    # regression can't ship. Locally the script only warns.
    # ------------------------------------------------------------------
    strict = os.environ.get("VAVELAB_STRICT_COVERAGE") == "1"
    gap_exit = 0
    if unknown_countries:
        gap_exit = 1
        print("")
        print("=" * 72)
        print(f"WARNING: {len(unknown_countries)} country/countries without an ISO mapping")
        print("Fix: add to COUNTRY_ISO in data/refresh-graduate-studies.py")
        print("See docs/DATA-COVERAGE-GAPS.md")
        print("=" * 72)
        for c in sorted(unknown_countries):
            print(f"  - {c!r}")
    if unknown_universities:
        gap_exit = 1
        print("")
        print("=" * 72)
        print(f"WARNING: {len(unknown_universities)} university/universities without coordinates")
        print("These render in the country list but WILL NOT show a bubble on the map.")
        print("Fix: add to UNIVERSITY_COORDS in data/refresh-graduate-studies.py")
        print("See docs/DATA-COVERAGE-GAPS.md for a checklist and coordinate sources.")
        print("=" * 72)
        for u in sorted(unknown_universities):
            print(f"  - {u!r}")
    if gap_exit and strict:
        print("")
        print("VAVELAB_STRICT_COVERAGE=1 — failing build until gaps are resolved.")
        sys.exit(2)


def _reencrypt_if_configured():
    import os, subprocess, sys
    here = os.path.dirname(os.path.abspath(__file__))
    root = os.path.dirname(here)
    enc = os.path.join(root, "scripts", "encrypt_data.py")
    if os.environ.get("VAVELAB_PASSCODE"):
        print("Re-encrypting data files\u2026")
        subprocess.run([sys.executable, enc], check=True)
    else:
        print("NOTE: VAVELAB_PASSCODE not set \u2014 skipped re-encryption. Run "
              "`VAVELAB_PASSCODE=\u2026 python3 scripts/encrypt_data.py` before committing.")


if __name__ == "__main__":
    main()
    _reencrypt_if_configured()
