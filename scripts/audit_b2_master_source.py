#!/usr/bin/env python3
"""
B2 Master-source audit — Graduate Degrees + Institutions.

Reads the live authoritative Master sheet and reports every data quality
issue that would corrupt the V2 Panel B2 country -> university drilldown.

Outputs (all under docs/):
  b2_audit_graduate_degrees.csv     — one row per raw Graduate Degrees row
                                       with parsed fields + validation flags
  b2_audit_graduate_degrees.md      — summary of Graduate Degrees issues
  b2_audit_institutions.csv         — one row per raw Institutions row with
                                       validation flags
  b2_audit_institutions.md          — summary of Institutions issues
  b2_audit_fiji_universities.md     — current correct Fiji university list

Uses only exact header names (`Degree ID`, `Scholar ID`, ...) as required
by the docx. No positional guessing.
"""
from __future__ import annotations
import csv
import json
import re
import subprocess
import sys
from collections import Counter
from pathlib import Path

SID = "1nJvMWLS8jnCOKtRoqdDpEW3s3j9TSAclXBO1txVFxdg"

# --- Completion-status normalizer ---------------------------------------
# The docx requires an explicit normalizer that also treats
# "Completed / year unresolved" as completed. Anything else — In progress,
# Current, blank, or unresolved — is excluded.
COMPLETED_PATTERNS = [
    re.compile(r"^completed(\s*[\/,;\-].*)?$", re.I),
    re.compile(r"^completed\s*/\s*year\s*unresolved$", re.I),
    re.compile(r"^completed\s*[\-,]\s*year\s*unresolved$", re.I),
    re.compile(r"^complete$", re.I),
    re.compile(r"^conferred(\s+.*)?$", re.I),
    re.compile(r"^awarded(\s+.*)?$", re.I),
    re.compile(r"^graduated(\s+.*)?$", re.I),
    re.compile(r"^finished(\s+.*)?$", re.I),
]

EXCLUDED_COMPLETION = re.compile(
    r"^(in\s*progress|current|withdrawn|discontinued|deferred|"
    r"submitted|not\s+completed|abandoned|pending|unknown)",
    re.I,
)


def is_completed(status: str) -> tuple[bool, str]:
    s = (status or "").strip()
    if not s:
        return False, "blank"
    if EXCLUDED_COMPLETION.match(s):
        return False, f"excluded: {s!r}"
    for pat in COMPLETED_PATTERNS:
        if pat.match(s):
            return True, s
    return False, f"unresolved: {s!r}"


# --- Degree stage normalizer ---------------------------------------------
def normalize_stage(stage: str) -> str:
    s = (stage or "").strip().lower()
    if not s:
        return ""
    if "master" in s or s.startswith("m."):
        return "Masters"
    if "phd" in s or "doctor" in s or s.startswith("ph.d") or s.startswith("d."):
        return "PhD"
    return ""


# --- Discipline-shaped strings that must never appear as universities ---
_DISCIPLINE_KEYWORDS = re.compile(
    r"(accounting|agriculture|horticulture|breadfruit|natural\s+products|"
    r"soil\s+science|agroforestry|nitrogen[-\s]?fixing|marine\s+natural|"
    r"chemistry\s+of|toxicology|philosophy|linguistics)",
    re.I,
)

_UNI_KEYWORDS = re.compile(
    r"\b(univ|college|institute|polytechnic|school\s+of|academy)\b",
    re.I,
)

_KNOWN_COUNTRIES = {
    "Fiji", "Australia", "New Zealand", "United States", "USA", "United Kingdom",
    "UK", "Canada", "Japan", "Samoa", "Papua New Guinea", "Solomon Islands",
    "Vanuatu", "Tonga", "Kiribati", "Nauru", "Marshall Islands", "Micronesia",
    "France", "Germany", "Netherlands", "Sweden", "Norway", "Switzerland",
    "South Korea", "China", "Taiwan", "Singapore", "Malaysia", "Thailand",
    "India", "Philippines", "Cook Islands", "Niue", "Tuvalu", "Palau",
    "American Samoa", "New Caledonia", "Hawaii", "United States of America",
    "Federated States of Micronesia",
}


def looks_like_country(name: str) -> bool:
    return name in _KNOWN_COUNTRIES


def looks_like_university(name: str) -> bool:
    return bool(_UNI_KEYWORDS.search(name or ""))


def looks_like_discipline(name: str) -> bool:
    return bool(_DISCIPLINE_KEYWORDS.search(name or ""))


def fetch(rng: str) -> list[list[str]]:
    p = {"spreadsheetId": SID, "range": rng}
    r = subprocess.run(
        ["gws", "sheets", "spreadsheets", "values", "get", "--params", json.dumps(p)],
        capture_output=True, text=True, check=True,
    )
    return json.loads(r.stdout).get("values", [])


def rows_as_dicts(sheet: str, header_row: int, last_col: str) -> list[dict]:
    values = fetch(f"{sheet}!A{header_row}:{last_col}9999")
    if not values:
        return []
    headers = values[0]
    out = []
    for r in values[1:]:
        r = r + [""] * (len(headers) - len(r))
        d = dict(zip(headers, r))
        # skip fully blank rows
        if not any((v or "").strip() for v in r):
            continue
        out.append(d)
    return out


def audit_graduate_degrees(repo: Path) -> tuple[list[dict], dict]:
    rows = rows_as_dicts("Graduate Degrees", 4, "Y")
    print(f"Graduate Degrees rows loaded: {len(rows)}", file=sys.stderr)
    flagged: list[dict] = []
    stats = Counter()

    seen_degree_ids: Counter = Counter()
    for r in rows:
        seen_degree_ids[r.get("Degree ID", "").strip()] += 1

    for r in rows:
        did = (r.get("Degree ID") or "").strip()
        sid = (r.get("Scholar ID") or "").strip()
        stage_raw = (r.get("Degree Stage") or "").strip()
        stage = normalize_stage(stage_raw)
        cuni = (r.get("C_Uni name") or "").strip()
        ouni = (r.get("O_Uni name") or "").strip()
        country = (r.get("Country") or "").strip()
        field = (r.get("Field / Discipline") or "").strip()
        qual = (r.get("Degree / Qualification") or "").strip()
        comp_raw = (r.get("Completion Status") or "").strip()
        completed, comp_note = is_completed(comp_raw)

        flags = []
        if not did:
            flags.append("blank_degree_id")
        if seen_degree_ids.get(did, 0) > 1:
            flags.append(f"duplicate_degree_id({seen_degree_ids[did]})")
        if not sid:
            flags.append("blank_scholar_id")
        if not stage:
            flags.append(f"stage_unresolved({stage_raw!r})")
        if not cuni and completed and stage:
            flags.append("blank_cuni_on_qualifying_row")
        if cuni and looks_like_discipline(cuni):
            flags.append(f"cuni_looks_like_discipline({cuni!r})")
        if cuni and looks_like_country(cuni):
            flags.append(f"cuni_is_a_country({cuni!r})")
        if country and looks_like_university(country) and not looks_like_country(country):
            flags.append(f"country_is_a_university({country!r})")
        if country and not looks_like_country(country) and completed and stage:
            flags.append(f"country_unresolved({country!r})")
        if not country and completed and stage:
            flags.append("blank_country_on_qualifying_row")

        qualifying = bool(stage) and completed
        stats["total"] += 1
        if qualifying:
            stats["qualifying"] += 1
            if stage == "Masters":
                stats["qualifying_masters"] += 1
            elif stage == "PhD":
                stats["qualifying_phd"] += 1
        if flags:
            stats["flagged"] += 1

        flagged.append({
            "Degree ID": did,
            "Scholar ID": sid,
            "Scholar Name": (r.get("Scholar Name") or "").strip(),
            "Degree Stage (raw)": stage_raw,
            "Degree Stage (normalized)": stage,
            "Degree / Qualification": qual,
            "Field / Discipline": field,
            "C_Uni name": cuni,
            "O_Uni name": ouni,
            "Country": country,
            "City": (r.get("City") or "").strip(),
            "Completion Status (raw)": comp_raw,
            "Completion Status (parsed)": "completed" if completed else comp_note,
            "Qualifying for B2": "Y" if qualifying else "",
            "Flags": "; ".join(flags),
        })
    return flagged, dict(stats)


def audit_institutions(repo: Path) -> tuple[list[dict], dict]:
    rows = rows_as_dicts("Institutions", 4, "J")
    print(f"Institutions rows loaded: {len(rows)}", file=sys.stderr)
    flagged: list[dict] = []
    stats = Counter()
    hdrs_seen = set()
    for r in rows:
        for k in r:
            hdrs_seen.add(k)
    print(f"Institution columns: {sorted(hdrs_seen)}", file=sys.stderr)

    # We do not know the exact institution-column names yet; discover them:
    def get(r, *names, default=""):
        for n in names:
            if n in r and r[n] not in ("", None):
                return r[n]
        return default

    for r in rows:
        name = get(r, "Institution", "Institution Name", "Name").strip()
        country = get(r, "Country").strip()
        lat_raw = get(r, "Latitude", "Lat", "lat").strip()
        lon_raw = get(r, "Longitude", "Long", "Lng", "lng").strip()
        raw_id_col = get(r, "Institution ID", "ID", "Institute ID", "Inst ID").strip()

        flags = []
        # GEO-* contamination — the whole row cell content of the first column
        first_col_val = ""
        for k in r:
            first_col_val = r[k]
            break
        if raw_id_col.upper().startswith("GEO-") or first_col_val.upper().startswith("GEO-"):
            flags.append("GEO_contamination_not_an_institution")
        if not name:
            flags.append("blank_name")
        if name and looks_like_discipline(name):
            flags.append(f"name_looks_like_discipline({name!r})")
        if country and not looks_like_country(country):
            flags.append(f"country_unresolved({country!r})")
        try:
            lat = float(lat_raw) if lat_raw else None
        except ValueError:
            lat = None
            flags.append(f"lat_unparseable({lat_raw!r})")
        try:
            lon = float(lon_raw) if lon_raw else None
        except ValueError:
            lon = None
            flags.append(f"lon_unparseable({lon_raw!r})")
        if lat is not None and not (-90 <= lat <= 90):
            flags.append(f"lat_out_of_range({lat})")
        if lon is not None and not (-180 <= lon <= 180):
            flags.append(f"lon_out_of_range({lon})")

        stats["total"] += 1
        if flags:
            stats["flagged"] += 1

        flagged.append({
            "Institution": name,
            "Country": country,
            "Latitude": lat_raw,
            "Longitude": lon_raw,
            "Flags": "; ".join(flags),
        })
    return flagged, dict(stats)


def write_csv(rows: list[dict], path: Path) -> None:
    if not rows:
        path.write_text("", encoding="utf-8")
        return
    with path.open("w", newline="", encoding="utf-8") as f:
        w = csv.DictWriter(f, fieldnames=list(rows[0].keys()))
        w.writeheader()
        w.writerows(rows)


def main() -> int:
    repo = Path(__file__).resolve().parent.parent
    docs = repo / "docs"
    docs.mkdir(exist_ok=True)

    gd, gd_stats = audit_graduate_degrees(repo)
    write_csv(gd, docs / "b2_audit_graduate_degrees.csv")

    ins, ins_stats = audit_institutions(repo)
    write_csv(ins, docs / "b2_audit_institutions.csv")

    # Fiji university list (canonical C_Uni name) from qualifying rows
    fiji_unis: Counter[str] = Counter()
    fiji_stage: Counter[tuple[str, str]] = Counter()
    fiji_flags: list[str] = []
    for r in gd:
        if r["Qualifying for B2"] != "Y":
            continue
        if r["Country"] != "Fiji":
            continue
        cuni = r["C_Uni name"]
        if not cuni:
            fiji_flags.append(f"blank cuni on Degree ID {r['Degree ID']}")
            continue
        fiji_unis[cuni] += 1
        fiji_stage[(cuni, r["Degree Stage (normalized)"])] += 1

    md_lines = [
        "# B2 Master-source audit — Graduate Degrees + Institutions",
        "",
        "Source: authoritative Master sheet",
        f"(`{SID}`), read via gws CLI.",
        "",
        "## Graduate Degrees summary",
        "",
        f"- Rows: **{gd_stats.get('total', 0)}**",
        f"- Rows flagged with validation issues: **{gd_stats.get('flagged', 0)}**",
        f"- Rows qualifying for B2 (completed Masters or PhD): "
        f"**{gd_stats.get('qualifying', 0)}**",
        f"  - Masters: **{gd_stats.get('qualifying_masters', 0)}**",
        f"  - PhD: **{gd_stats.get('qualifying_phd', 0)}**",
        "",
        "See `b2_audit_graduate_degrees.csv` for every row with its flags.",
        "",
        "### Top validation flag types",
        "",
    ]
    flag_hist: Counter[str] = Counter()
    for r in gd:
        for f in (r["Flags"] or "").split("; "):
            f = f.strip()
            if not f:
                continue
            # collapse parametric flags to their base name
            base = re.sub(r"\(.+\)$", "", f)
            flag_hist[base] += 1
    for f, n in flag_hist.most_common():
        md_lines.append(f"- `{f}`: {n}")

    md_lines += [
        "",
        "## Institutions summary",
        "",
        f"- Rows: **{ins_stats.get('total', 0)}**",
        f"- Rows flagged: **{ins_stats.get('flagged', 0)}**",
        "",
        "See `b2_audit_institutions.csv` for every row with its flags.",
        "",
        "### Top validation flag types",
        "",
    ]
    ins_flag_hist: Counter[str] = Counter()
    for r in ins:
        for f in (r["Flags"] or "").split("; "):
            f = f.strip()
            if not f:
                continue
            base = re.sub(r"\(.+\)$", "", f)
            ins_flag_hist[base] += 1
    for f, n in ins_flag_hist.most_common():
        md_lines.append(f"- `{f}`: {n}")

    md_lines += [
        "",
        "## Fiji university list (canonical C_Uni name, qualifying rows only)",
        "",
        f"Total qualifying Fiji-country episodes: "
        f"**{sum(fiji_unis.values())}**  ",
        f"Distinct validated Fiji universities: **{len(fiji_unis)}**",
        "",
        "| University | Masters | PhD | Total |",
        "| :-- | --: | --: | --: |",
    ]
    for uni in sorted(fiji_unis, key=lambda u: (-fiji_unis[u], u)):
        m = fiji_stage.get((uni, "Masters"), 0)
        p = fiji_stage.get((uni, "PhD"), 0)
        md_lines.append(f"| {uni} | {m} | {p} | {m + p} |")
    md_lines.append("")

    if fiji_flags:
        md_lines.append("### Fiji rows with blank C_Uni (excluded from B2):")
        for m in fiji_flags:
            md_lines.append(f"- {m}")
        md_lines.append("")

    (docs / "b2_audit_summary.md").write_text(
        "\n".join(md_lines), encoding="utf-8"
    )
    print(f"Wrote {docs / 'b2_audit_graduate_degrees.csv'}")
    print(f"Wrote {docs / 'b2_audit_institutions.csv'}")
    print(f"Wrote {docs / 'b2_audit_summary.md'}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
