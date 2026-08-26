#!/usr/bin/env python3
"""
Build V2 Panel B2's world-points payload from the authoritative Master
Graduate Degrees data.

The V2 Panel B2 dashboard (js/itaukei-database-master.js renderWorldPanel /
renderWorldMap) previously loaded its country -> university -> scholar
hierarchy from `data/itaukei-graduate-studies.json`, which is derived from
the Zotero collection tree and therefore misses many degrees and inherits
Zotero's collection tagging quirks. This module rebuilds the same payload
shape *strictly* from Master Graduate Degrees so B2 is driven by the
authoritative source.

Payload shape (same as `worldPoints` in itaukei-graduate-studies.json so
the JS renderer needs minimal changes):

    {
        "generatedAt": "2026-08-25T…Z",
        "worldPoints": [
            {
                "country": "Fiji",
                "iso": "FJ",
                "region": "Pacific",
                "university": "University of the South Pacific",
                "lat": -18.15,
                "lng": 178.44,
                "phdScholars":     ["Scholar Name", …],   # deduped, name order
                "mastersScholars": ["Scholar Name", …],
                "unknownScholars": [],                     # never populated
                "degrees": [
                    {"degreeId":"DEG-…","scholarId":"ITK-…","stage":"Masters",
                     "qualification":"MSc","field":"…","year":"2018",
                     "completionStatus":"Completed"},
                    …
                ]
            },
            …
        ],
        "totals": {"countries":N, "universities":M, "scholars":K,
                   "masters":X, "phd":Y, "total":X+Y},
        "excluded": [
            {"degreeId":"…","reason":"cuni_looks_like_discipline",…},
            …
        ]
    }

Design principles enforced (verbatim from
Perplexity_V2_B2_Country_University_Drilldown_Repair_Prompt.docx):

1. Fields are pulled by exact header names. No positional guessing.
2. Only completed Master's and PhD/Doctorate episodes count. A
   dedicated `is_completed()` normalizer treats
   `Completed / year unresolved` (with slash, hyphen, or comma) as
   completed but excludes `In progress`, `Current`, blank, and
   substring-shaped fakes.
3. Discipline-shaped `C_Uni name` values (e.g.
   `Agriculture / Horticulture / Breadfruit Propagation`) are rejected.
4. `O_Uni name` never contributes a distinct university.
5. Rows failing validation are excluded from the payload and written to
   `docs/b2_excluded_rows.md` for review.
6. Country and university names never swap: an aggregation key is a
   validated country string; a university row is a validated
   institution string.
7. Institution coordinates come from `data/world-universities.json`
   (canonical) with a curated alias map for the ~5 near-duplicates.
   Missing coordinates leave the map marker off but never remove the
   university row from the drilldown list.

Callers: `scripts/master_file_transformer.py` (production) and the
one-off `scripts/build_b2_worldpoints.py` (local check / audit).
"""
from __future__ import annotations

import json
import re
from collections import Counter, defaultdict
from datetime import datetime, timezone
from pathlib import Path
from typing import Any


# ---------------------------------------------------------------------------
# Validation helpers — verbatim contract from the docx.
# ---------------------------------------------------------------------------

# Completion status
_COMPLETED_ALLOW = [
    re.compile(r"^completed$", re.I),
    re.compile(r"^completed\s*[\/,\-]\s*year\s*unresolved$", re.I),
    re.compile(r"^completed\s*[\/,\-]\s*details\s+unresolved$", re.I),
    re.compile(r"^completed(\s+\S+)*$", re.I),  # "Completed — official …"
    re.compile(r"^complete$", re.I),
    re.compile(r"^conferred(\s+.*)?$", re.I),
    re.compile(r"^awarded(\s+.*)?$", re.I),
    re.compile(r"^graduated(\s+.*)?$", re.I),
    re.compile(r"^finished(\s+.*)?$", re.I),
]
_COMPLETED_BLOCK = re.compile(
    r"^(in\s*progress|current|withdrawn|discontinued|deferred|"
    r"submitted|not\s+completed|abandoned|pending|unknown|"
    r"in\s+preparation)",
    re.I,
)


def is_completed(status: str) -> bool:
    """Return True only if the string represents a completed degree.

    Explicitly accepts `Completed / year unresolved` (docx requirement).
    """
    s = (status or "").strip()
    if not s:
        return False
    if _COMPLETED_BLOCK.match(s):
        return False
    return any(p.match(s) for p in _COMPLETED_ALLOW)


# Degree stage
def normalize_stage(stage: str) -> str:
    s = (stage or "").strip().lower()
    if not s:
        return ""
    if "master" in s or s.startswith("m."):
        return "Masters"
    if "phd" in s or "doctor" in s or s.startswith("ph.d") or s.startswith("d."):
        return "PhD"
    return ""


# Discipline detection — reject C_Uni values shaped like a field description.
# Signals a discipline: (a) contains ' / ' segments with lowercase phrases,
# (b) contains none of the "university" keywords, (c) contains discipline
# keywords ("Accounting", "Agriculture", "Chemistry", etc.).
# Word-start boundary only: "University" must match even though it has
# letters after "univ". Use \b at the start of each keyword and either
# \b or nothing at the end (so "University" and "Universities" both hit).
_UNI_KEYWORDS_RE = re.compile(
    r"\b(univ(?:ersity|ersities|ersit\w*)?|college|institute|"
    r"polytechnic|academy|school\s+of|seminary|wānanga|wananga|IMO)\b",
    re.I,
)
_DISCIPLINE_KEYWORDS_RE = re.compile(
    r"(accounting|agriculture|horticulture|breadfruit|natural\s+products|"
    r"soil\s+science|agroforestry|nitrogen[-\s]?fixing|marine\s+natural|"
    r"chemistry|toxicology|philosophy|linguistics|materials\s+science|"
    r"microplastics|environmental\s+pollution|environmental\s+science|"
    r"engineering\s+/|psychology|domestic\s+violence)",
    re.I,
)


def looks_like_discipline(name: str) -> bool:
    s = (name or "").strip()
    if not s:
        return False
    # If it has a canonical university keyword AND no obvious discipline
    # slash-structure, it's a real university (e.g. "Institute of Marine
    # Sciences at USP" would be fine — but Master doesn't actually have
    # such rows).
    has_uni_kw = bool(_UNI_KEYWORDS_RE.search(s))
    has_disc_kw = bool(_DISCIPLINE_KEYWORDS_RE.search(s))
    has_slash = " / " in s
    if has_uni_kw and not has_disc_kw:
        return False
    if has_disc_kw and not has_uni_kw:
        return True
    if has_slash and not has_uni_kw:
        # e.g. "Marine Natural Products / Natural Products Chemistry"
        return True
    return False


def looks_like_not_a_university(name: str) -> bool:
    """Catch obvious placeholders like `not found` or `TBD`."""
    s = (name or "").strip().lower()
    return s in {"not found", "tbd", "unknown", "n/a", "na", "-", "."}


# Country validation — keep it permissive; we do NOT want to reject a
# legitimate country because our whitelist is stale. Instead we reject
# only clearly wrong shapes:
#   - contains uppercase university-word ("University", "College" …)
#   - is a compound descriptor ("Fiji / United Nations regional office")
#   - starts with a citation key like "nailevu_negotiating_2017"
# Known-country whitelist for shifted-cell detection. Any C_Uni_country
# value outside this whitelist and outside the extended fallback set is
# treated as a suspect shifted-cell value (e.g. a discipline that landed
# in the Country column) and the row is excluded. The whitelist is a
# strict superset of every legitimate Country value observed in Master
# Graduate Degrees; when Ron adds a new country it can be appended here.
_KNOWN_COUNTRIES: set[str] = {
    # Pacific
    "Fiji", "Samoa", "American Samoa", "Tonga", "Vanuatu", "Solomon Islands",
    "Papua New Guinea", "Kiribati", "Tuvalu", "Nauru", "Palau",
    "Federated States of Micronesia", "Marshall Islands", "Cook Islands",
    "Niue", "Tokelau", "French Polynesia", "New Caledonia", "Wallis and Futuna",
    "Guam", "Northern Mariana Islands", "Pitcairn Islands",
    # Anglosphere & Europe common
    "Australia", "New Zealand", "United Kingdom", "UK", "Great Britain",
    "United States", "United States of America", "USA", "US",
    "Canada", "Ireland", "Malta", "Portugal", "Spain", "France",
    "Germany", "Netherlands", "Belgium", "Sweden", "Norway", "Denmark",
    "Finland", "Iceland", "Italy", "Switzerland", "Austria", "Poland",
    "Czech Republic", "Czechia", "Hungary", "Greece", "Turkey", "Russia",
    # Asia
    "Japan", "South Korea", "Republic of Korea", "North Korea", "China",
    "Taiwan", "Hong Kong", "Macau", "Singapore", "Malaysia", "Indonesia",
    "Philippines", "Thailand", "Vietnam", "Cambodia", "Laos", "Myanmar",
    "India", "Pakistan", "Bangladesh", "Sri Lanka", "Nepal", "Bhutan",
    "Maldives", "Mongolia", "Kazakhstan", "Uzbekistan",
    # Americas
    "Mexico", "Brazil", "Argentina", "Chile", "Peru", "Colombia", "Venezuela",
    "Ecuador", "Bolivia", "Uruguay", "Paraguay", "Cuba", "Jamaica",
    "Trinidad and Tobago", "Barbados", "Bahamas", "Dominican Republic",
    "Haiti", "Puerto Rico", "Guyana", "Suriname",
    # Africa & Middle East (kept broad)
    "South Africa", "Egypt", "Morocco", "Kenya", "Nigeria", "Ghana",
    "Ethiopia", "Tanzania", "Uganda", "Zimbabwe", "Zambia", "Botswana",
    "Namibia", "Mozambique", "Madagascar", "Mauritius", "Seychelles",
    "Israel", "United Arab Emirates", "UAE", "Saudi Arabia", "Qatar",
    "Kuwait", "Iran", "Iraq", "Jordan", "Lebanon", "Syria",
}


def is_valid_country(name: str) -> bool:
    s = (name or "").strip()
    if not s:
        return False
    if _UNI_KEYWORDS_RE.search(s):
        return False
    if "/" in s and re.search(r"international|regional|un(fpa)?", s, re.I):
        return False
    if re.match(r"^[a-z0-9_]+_[a-z0-9_]+", s):
        # Citation-key shape
        return False
    # Shifted-cell guard: countries with a discipline-word signature
    # ("Nursing", "Agriculture", "Chemistry", "Environmental", "Marine …")
    # landing in the Country column mean the row's cells are misaligned.
    # Reject any value not in the extended whitelist that ALSO fires a
    # discipline signal or is a suspicious single common noun.
    if s in _KNOWN_COUNTRIES:
        return True
    if _DISCIPLINE_KEYWORDS_RE.search(s):
        return False
    # A single lowercase-first common English noun (e.g. "Nursing",
    # "Education", "Business", "Engineering") landing in Country is
    # almost always a shifted-cells symptom. Reject bare one-word values
    # that are not in the whitelist and match a broader discipline list.
    _COMMON_DISCIPLINE_WORDS = {
        "nursing", "education", "business", "engineering", "medicine",
        "law", "arts", "science", "sciences", "humanities", "management",
        "economics", "commerce", "public health", "health", "anthropology",
        "sociology", "geography", "history", "biology", "chemistry",
        "physics", "mathematics", "statistics", "development studies",
        "policy", "planning", "finance", "accounting",
        # Region/continent words sometimes shifted in
        "oceania", "asia", "europe", "africa", "americas", "pacific",
    }
    if s.lower() in _COMMON_DISCIPLINE_WORDS:
        return False
    return True


# ---------------------------------------------------------------------------
# Coordinate lookup — canonical from world-universities.json, plus alias
# corrections for the small number of near-duplicate names we found.
# ---------------------------------------------------------------------------

# Master C_Uni name -> world-universities name (only where they disagree).
UNI_ALIAS_TO_WU: dict[str, str] = {
    "Australian National University": "Australian National University (ANU)",
    "Christ's University of Pacific": "Christ's University in Pacific",
    "University of Hawaiʻi at Mānoa": "University of Hawaii",
    "UNSW Sydney": "University of New South Wales",
    "University of New South Wales (ADFA)": "University of New South Wales",
    "KDI School of Public Policy and Management":
        "Korean Development Institute (KDI)",
    # Same-institution renames encoded in the Master (docx note).
    "Pacific Theological College": "Pasifika Communities University",
    "Fiji School of Medicine": "Fiji National University",
    # Curly-apostrophe / word-order / trailing-comma variants that resolve
    # to the canonical world-universities.json name.
    "Japan Women\u2019s University": "Japan Women's University",
    "Universitas Atma Jaya Yogyakarta": "Atma Jaya University Yogyakarta",
    "University of Occupational and Environmental Health, Japan":
        "University of Occupational and Environmental Health",
}


# Country -> ISO2 + region hint. Kept short; only used for the map marker
# tooltip. We fall back to whatever the graduate-studies pipeline already
# knew; the JS renderer already handles missing iso/region.
COUNTRY_META: dict[str, tuple[str, str]] = {
    "Fiji": ("FJ", "Pacific"),
    "Australia": ("AU", "Oceania"),
    "New Zealand": ("NZ", "Oceania"),
    "United States of America": ("US", "Americas"),
    "United States": ("US", "Americas"),
    "USA": ("US", "Americas"),
    "United Kingdom": ("GB", "Europe"),
    "UK": ("GB", "Europe"),
    "Japan": ("JP", "Asia"),
    "India": ("IN", "Asia"),
    "China": ("CN", "Asia"),
    "Taiwan": ("TW", "Asia"),
    "Malaysia": ("MY", "Asia"),
    "Singapore": ("SG", "Asia"),
    "Indonesia": ("ID", "Asia"),
    "South Korea": ("KR", "Asia"),
    "Portugal": ("PT", "Europe"),
    "Malta": ("MT", "Europe"),
    "Italy": ("IT", "Europe"),
    "Germany": ("DE", "Europe"),
    "Netherlands": ("NL", "Europe"),
    "Sweden": ("SE", "Europe"),
    "Norway": ("NO", "Europe"),
    "Trinidad and Tobago": ("TT", "Americas"),
    "Canada": ("CA", "Americas"),
    "Papua New Guinea": ("PG", "Oceania"),
    "Samoa": ("WS", "Oceania"),
    "Vanuatu": ("VU", "Oceania"),
    "Solomon Islands": ("SB", "Oceania"),
    "Tonga": ("TO", "Oceania"),
    "France": ("FR", "Europe"),
}


def load_uni_coords(repo: Path) -> dict[str, dict[str, Any]]:
    """Return {university_name: {lat, lng, country}} from
    data/world-universities.json (plaintext, before encryption)."""
    src = repo / "data" / "world-universities.json"
    if not src.exists():
        return {}
    data = json.loads(src.read_text(encoding="utf-8"))
    out = {}
    for u in data.get("universities", []):
        name = u.get("name")
        loc = u.get("location")
        if not name or not loc or len(loc) != 2:
            continue
        out[name] = {
            "lat": loc[0],
            "lng": loc[1],
            "country": u.get("country"),
            "city": u.get("city"),
        }
    return out


# Country-specific campus overrides for multi-campus universities.
# When a scholar's country differs from the primary campus country, use the
# regional campus coord instead. Value: (lat, lng, city).
_CAMPUS_OVERRIDES: dict[tuple[str, str], tuple[float, float, str]] = {
    # USP Alafua Campus, Apia — School of Agriculture and Food Technology.
    # Coord from Mapcarta / OpenStreetMap: -13.8607, -171.7929.
    ("University of the South Pacific", "Samoa"): (
        -13.8607, -171.7929, "Alafua Campus, Apia",
    ),
    # USP Emalus Campus, Port Vila — School of Law.
    ("University of the South Pacific", "Vanuatu"): (
        -17.7375, 168.3120, "Emalus Campus, Port Vila",
    ),
    # USP Solomon Islands Campus, Honiara.
    ("University of the South Pacific", "Solomon Islands"): (
        -9.4457, 159.9583, "Honiara Campus, Honiara",
    ),
    # USP Tonga Campus, Nuku'alofa.
    ("University of the South Pacific", "Tonga"): (
        -21.1394, -175.2018, "Nuku'alofa Campus, Nuku'alofa",
    ),
}


def lookup_uni_coords(
    canonical_name: str,
    coords: dict[str, dict[str, Any]],
    country: str | None = None,
) -> dict[str, Any] | None:
    # Country-aware campus override takes precedence.
    if country:
        override = _CAMPUS_OVERRIDES.get((canonical_name, country))
        if override:
            lat, lng, city = override
            return {"lat": lat, "lng": lng, "country": country, "city": city}
    if canonical_name in coords:
        return coords[canonical_name]
    alias = UNI_ALIAS_TO_WU.get(canonical_name)
    if alias and alias in coords:
        return coords[alias]
    return None


# ---------------------------------------------------------------------------
# Main builder
# ---------------------------------------------------------------------------

def build_worldpoints(
    grad_degrees: list[dict], repo: Path
) -> tuple[dict, list[dict]]:
    """Aggregate Master Graduate Degrees into the Panel B2 worldPoints payload.

    Returns (payload_dict, excluded_rows).
    """
    coords_map = load_uni_coords(repo)
    excluded: list[dict] = []

    # Bucket by (country, university).
    # Each bucket accumulates scholar names per stage AND raw degree records.
    # Note: mastersScholars / phdScholars are NOT deduplicated per bucket.
    # Panel B2 KPI tiles compute Masters and PhD totals as
    # Σ len(mastersScholars) and Σ len(phdScholars) across all points
    # (js/itaukei-database-master.js renderWorldPanel). Deduping here
    # would undercount episodes when a scholar has two Master's at the
    # same C_Uni. The distinct-scholar KPI ("scholars") is computed as
    # a Set over the names, so listing a name twice is safe.
    Bucket = lambda: {
        "phdScholars": [],
        "mastersScholars": [],
        "unknownScholars": [],
        "degrees": [],
    }
    buckets: dict[tuple[str, str], dict] = defaultdict(Bucket)

    stage_counter: Counter[str] = Counter()
    scholar_set: set[str] = set()

    for r in grad_degrees:
        did = (r.get("Degree ID") or "").strip()
        sid = (r.get("Scholar ID") or "").strip()
        sname = (r.get("Scholar Name") or "").strip()
        stage_raw = (r.get("Degree Stage") or "").strip()
        stage = normalize_stage(stage_raw)
        cuni = (r.get("C_Uni name") or "").strip()
        country = (r.get("Country") or "").strip()
        qual = (r.get("Degree / Qualification") or "").strip()
        field = (r.get("Field / Discipline") or "").strip()
        comp_raw = (r.get("Completion Status") or "").strip()
        year_status = (r.get("Year / Status") or "").strip()

        # Filter: must be Masters or PhD
        if not stage:
            continue

        # Filter: must be completed (docx: "Completed / year unresolved" IS
        # completed, must count)
        if not is_completed(comp_raw):
            continue

        reasons = []
        if not cuni:
            reasons.append("blank_c_uni_name")
        elif looks_like_discipline(cuni):
            reasons.append("c_uni_looks_like_discipline")
        elif looks_like_not_a_university(cuni):
            reasons.append("c_uni_is_placeholder")
        if not country:
            reasons.append("blank_country")
        elif not is_valid_country(country):
            reasons.append("country_shape_invalid")

        if reasons:
            excluded.append({
                "degreeId": did,
                "scholarId": sid,
                "scholarName": sname,
                "stage": stage,
                "qualification": qual,
                "field": field,
                "cUni": cuni,
                "country": country,
                "reasons": reasons,
            })
            continue

        key = (country, cuni)
        bucket = buckets[key]
        bucket["degrees"].append({
            "degreeId": did,
            "scholarId": sid,
            "scholarName": sname,
            "stage": stage,
            "qualification": qual,
            "field": field,
            "year": year_status,
            "completionStatus": comp_raw,
        })
        stage_counter[stage] += 1
        scholar_set.add(sid or sname)

        # Scholar-name lists are episode-shaped: one entry per counted
        # degree, so Σ lengths matches the docx-required episode total.
        if stage == "PhD" and sname:
            bucket["phdScholars"].append(sname)
        elif stage == "Masters" and sname:
            bucket["mastersScholars"].append(sname)

    # Convert buckets to worldPoints list
    world_points: list[dict] = []
    for (country, cuni), bucket in buckets.items():
        iso, region = COUNTRY_META.get(country, ("", ""))
        coord = lookup_uni_coords(cuni, coords_map, country=country)
        point = {
            "country": country,
            "iso": iso,
            "region": region,
            "university": cuni,
            "lat": coord["lat"] if coord else None,
            "lng": coord["lng"] if coord else None,
            "city": (coord or {}).get("city", ""),
            "phdScholars": sorted(bucket["phdScholars"]),  # duplicates kept; see Bucket comment
            "mastersScholars": sorted(bucket["mastersScholars"]),  # duplicates kept
            "unknownScholars": [],  # never populated — Master is authoritative
            "degrees": bucket["degrees"],
        }
        world_points.append(point)

    world_points.sort(
        key=lambda p: (p["country"], p["university"])
    )

    # Totals
    countries = {p["country"] for p in world_points}
    universities = {(p["country"], p["university"]) for p in world_points}
    totals = {
        "countries": len(countries),
        "universities": len(universities),
        "scholars": len(scholar_set),
        "masters": stage_counter["Masters"],
        "phd": stage_counter["PhD"],
        "total": stage_counter["Masters"] + stage_counter["PhD"],
    }

    payload = {
        "generatedAt": datetime.now(timezone.utc).isoformat(),
        "source": "master:Graduate Degrees",
        "worldPoints": world_points,
        "totals": totals,
        "excludedCount": len(excluded),
    }
    return payload, excluded


# ---------------------------------------------------------------------------
# CLI entrypoint — used from CI transformer script.
# ---------------------------------------------------------------------------
def write_worldpoints(
    grad_degrees: list[dict], repo: Path, out_path: Path,
    excluded_md_path: Path | None = None,
) -> dict:
    payload, excluded = build_worldpoints(grad_degrees, repo)
    out_path.write_text(
        json.dumps(payload, ensure_ascii=False, indent=2),
        encoding="utf-8",
    )
    if excluded_md_path is not None:
        lines = [
            "# Panel B2 — excluded rows (Master Graduate Degrees)",
            "",
            f"Total excluded rows: **{len(excluded)}**",
            "",
            "These rows failed schema validation and are not fed into"
            " Panel B2's country / university drill-down.",
            "",
            "| Degree ID | Scholar ID | Scholar | Stage | C_Uni |"
            " Country | Reasons |",
            "| :-- | :-- | :-- | :-- | :-- | :-- | :-- |",
        ]
        for e in excluded:
            reasons = ", ".join(e["reasons"])
            lines.append(
                f"| {e['degreeId']} | {e['scholarId']} | {e['scholarName']} "
                f"| {e['stage']} | {e['cUni']!r} | {e['country']!r} "
                f"| {reasons} |"
            )
        excluded_md_path.write_text("\n".join(lines), encoding="utf-8")
    return payload


if __name__ == "__main__":
    # Standalone build path — reads the already-materialized
    # data/itaukei-master-grad-degrees.json so it can be run without any
    # Google credentials.
    import sys
    repo = Path(__file__).resolve().parent.parent
    src = repo / "data" / "itaukei-master-grad-degrees.json"
    if not src.exists():
        # Try decrypting the .enc form.
        from cryptography.hazmat.primitives import hashes
        from cryptography.hazmat.primitives.kdf.pbkdf2 import PBKDF2HMAC
        from cryptography.hazmat.primitives.ciphers.aead import AESGCM
        MAGIC = b"IVAV"
        pw = "Arachnid1!"
        enc = src.with_suffix(".json.enc")
        if not enc.exists():
            print(f"missing {src} and {enc}", file=sys.stderr)
            sys.exit(2)
        b = enc.read_bytes()
        assert b[:4] == MAGIC
        salt = b[4:20]; iv = b[20:32]; body = b[32:]
        kdf = PBKDF2HMAC(
            algorithm=hashes.SHA256(), length=32, salt=salt, iterations=200000
        )
        key = kdf.derive(pw.encode("utf-8"))
        plaintext = AESGCM(key).decrypt(iv, body, associated_data=None)
        grad_degrees = json.loads(plaintext)
    else:
        grad_degrees = json.loads(src.read_text(encoding="utf-8"))

    out = repo / "data" / "itaukei-master-worldpoints.json"
    excluded_md = repo / "docs" / "b2_excluded_rows.md"
    excluded_md.parent.mkdir(exist_ok=True)
    payload = write_worldpoints(grad_degrees, repo, out, excluded_md)
    totals = payload["totals"]
    print(
        f"Wrote {out}  |  countries={totals['countries']}  "
        f"universities={totals['universities']}  "
        f"scholars={totals['scholars']}  "
        f"M={totals['masters']}  P={totals['phd']}  "
        f"excluded={payload['excludedCount']}"
    )
    print(f"Wrote {excluded_md}")
