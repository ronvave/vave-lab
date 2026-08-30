#!/usr/bin/env python3
"""
Solomon Islands Master File -> sanitized JSON snapshots
=========================================================

Sister clone of scripts/tongan_master_file_transformer.py (Tongan) /
scripts/master_file_transformer.py (iTaukei). Reads the Solomon Islands
Scholars Master File via a service-account, sanitizes each worksheet
against a public-field allowlist, and writes plaintext JSON to
data/solomon-master-*.json. The encryption step
(scripts/solomon_encrypt_data.py) converts these to .enc for commit.

Runs from CI (.github/workflows/refresh-solomon-master-file.yml), and on
manual dispatch from the Solomon Islands Admin Panel's "Refresh from
Sheet" / "Force refresh" buttons.

Contract:
- Reads the Solomon Islands Master Sheet via google-api-python-client +
  service-account JSON (env: GOOGLE_SERVICE_ACCOUNT_JSON = raw JSON
  string of key), OR via the `gws` CLI in the agent sandbox (--mode=gws).
- Writes sanitized JSON to /workspace/data/solomon-master-*.json.
- On any validation failure: preserves last valid snapshot, logs the
  discrepancy, exits with code that keeps the old .enc unchanged.
- Never publishes private fields (see solomon_master_file_config.py
  allowlists).
- Never uses Original/historical institution-name fields for
  aggregations -- only the canonical "Institution Name (Current)".
- Never infers Solomon Islander identity from surname; only via the
  Authorship bridge (or the Researcher Authorship bridge for SOL-R IDs).
- GEOGRAPHY: Specific Island and customary fields (Clan/Tribe/Lineage,
  Customary Place, Self-identified Home/Community) are read verbatim
  from their own dedicated columns and are NEVER derived from
  Ward/Province. Honiara City is kept as its own first-level reporting
  area, never folded into Guadalcanal.
- NEVER touches data/itaukei-* or data/tongan-* files or either sister
  sheet -- additive-only sister implementation.
- The Master Sheet currently has ZERO scholar/publication/degree data
  rows (headers + controlled vocabularies only). This script must run
  correctly against that header-only state and emit valid, empty
  snapshot files -- it is expected output, not a bug, until Ron
  populates real records.

Usage:
    export GOOGLE_SERVICE_ACCOUNT_JSON="$(cat sa-key.json)"
    python3 scripts/solomon_master_file_transformer.py --mode=production

    # Agent-sandbox path (uses the `gws` CLI, api_credentials=["gws"]):
    python3 scripts/solomon_master_file_transformer.py --mode=gws

    # Local dev, reading from a /tmp dump instead of the live sheet:
    python3 scripts/solomon_master_file_transformer.py --mode=local
"""
from __future__ import annotations

import argparse
import json
import os
import re
import subprocess
import sys
import time
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

from solomon_master_file_config import (
    ALL_SOLOMON_GEOGRAPHY_LABELS,
    AUTHORSHIP_PUBLIC_FIELDS,
    AWARD_PUBLIC_FIELDS,
    FUNDING_PUBLIC_FIELDS,
    GRAD_DEGREE_PUBLIC_FIELDS,
    HEADLINE_PUBLICATION_TYPES,
    INSTITUTION_PUBLIC_FIELDS,
    MOBILITY_PUBLIC_FIELDS,
    OUTPUT_FILES,
    POSITION_PUBLIC_FIELDS,
    PROVINCE_GROUPS,
    PROVINCE_SOLOMON_UNSPECIFIED,
    PROVINCE_TO_CONFEDERACY,
    PROVINCE_UNSURE,
    PROVINCES,
    PUBLICATION_PUBLIC_FIELDS,
    RESEARCH_GEOGRAPHY_COORDINATES_PUBLIC_FIELDS,
    RESEARCH_GEOGRAPHY_PUBLIC_FIELDS,
    RESEARCHER_AUTHORSHIP_PUBLIC_FIELDS,
    RESEARCHER_PUBLIC_FIELDS,
    SCHOLAR_PUBLIC_FIELDS,
    SHEETS,
    SPREADSHEET_ID,
)

# -----------------------------------------------------------------------------
# Sheet fetching -- production (service account), gws CLI, or local dump
# -----------------------------------------------------------------------------


def fetch_sheet_production(sheet_name: str) -> list[list]:
    """Fetch a worksheet via google-api-python-client + service account.
    Env var GOOGLE_SERVICE_ACCOUNT_JSON must contain the raw JSON key.
    """
    from google.oauth2 import service_account  # type: ignore
    from googleapiclient.discovery import build  # type: ignore

    key_json = os.environ.get("GOOGLE_SERVICE_ACCOUNT_JSON")
    if not key_json:
        raise RuntimeError(
            "GOOGLE_SERVICE_ACCOUNT_JSON env var not set. "
            "Provide the service-account key JSON string."
        )
    info = json.loads(key_json)
    creds = service_account.Credentials.from_service_account_info(
        info,
        scopes=["https://www.googleapis.com/auth/spreadsheets.readonly"],
    )
    service = build("sheets", "v4", credentials=creds, cache_discovery=False)
    resp = (
        service.spreadsheets()
        .values()
        .get(
            spreadsheetId=SPREADSHEET_ID,
            range=sheet_name,
            majorDimension="ROWS",
            valueRenderOption="FORMATTED_VALUE",
            dateTimeRenderOption="FORMATTED_STRING",
        )
        .execute()
    )
    return resp.get("values", [])


def fetch_sheet_gws(sheet_name: str) -> list[list]:
    """Fetch a worksheet via `gws` CLI (agent sandbox path).
    Requires api_credentials=['gws'] on the bash tool.
    """
    params = json.dumps(
        {
            "spreadsheetId": SPREADSHEET_ID,
            "range": sheet_name,
            "majorDimension": "ROWS",
            "valueRenderOption": "FORMATTED_VALUE",
            "dateTimeRenderOption": "FORMATTED_STRING",
        }
    )
    result = subprocess.run(
        ["gws", "sheets", "spreadsheets", "values", "get", "--params", params],
        capture_output=True,
        text=True,
        check=False,
    )
    if result.returncode != 0:
        raise RuntimeError(
            f"gws exit {result.returncode} on {sheet_name!r}: {result.stderr[:500]}"
        )
    return json.loads(result.stdout).get("values", [])


def fetch_sheet_local(sheet_name: str, dump_dir: Path) -> list[list]:
    """Load a worksheet from a local /tmp dump created by a dump script."""
    safe = sheet_name.replace("/", "_").replace(">", "gt").replace(" ", "_")
    path = dump_dir / f"{safe}.json"
    if not path.exists():
        raise FileNotFoundError(f"Local dump missing: {path}")
    return json.loads(path.read_text()).get("rows", [])


# -----------------------------------------------------------------------------
# Row helpers
# -----------------------------------------------------------------------------


def rows_to_dicts(
    rows: list[list], header_row_1indexed: int, first_data_row_1indexed: int
) -> tuple[list[str], list[dict[str, Any]]]:
    """Return (headers, data_dicts) from a raw sheet payload."""
    if header_row_1indexed is None or len(rows) < header_row_1indexed:
        return [], []
    headers = [str(h).strip() for h in rows[header_row_1indexed - 1]]
    data_rows = rows[first_data_row_1indexed - 1:]
    dicts: list[dict[str, Any]] = []
    for row in data_rows:
        if not row or all((c is None or str(c).strip() == "") for c in row):
            continue
        padded = list(row) + [""] * (len(headers) - len(row))
        d = {h: padded[i] for i, h in enumerate(headers)}
        dicts.append(d)
    return headers, dicts


def sanitize(dicts: list[dict], allowlist: list[str]) -> list[dict]:
    """Keep only allowlisted fields; drop everything else. This is the
    primary confidentiality gate."""
    return [{k: d.get(k, "") for k in allowlist} for d in dicts]


def as_int(v: Any) -> int:
    """Best-effort int parse (empty/invalid -> 0). Handles '1', '1.0', ' 3 '."""
    s = str(v).strip()
    if not s:
        return 0
    try:
        return int(float(s))
    except (ValueError, TypeError):
        return 0


def is_truthy(v: Any) -> bool:
    """Best-effort truthy parse for 'Yes'/'TRUE'/'1'/'x' style cells."""
    if v is True:
        return True
    if v is False or v is None:
        return False
    s = str(v).strip().lower()
    return s in {"yes", "y", "true", "1", "x", "t"}


def clean_sentinel(v: Any) -> str:
    """Strip placeholder sentinel values ('Unclassified', 'Not yet
    verified', 'Not applicable') down to an empty string, matching the
    Lookups worksheet's 'Unknown-Value State' controlled vocabulary."""
    s = str(v or "").strip()
    if s.lower() in {"unclassified", "not yet verified", "not applicable", ""}:
        return ""
    return s


# -----------------------------------------------------------------------------
# Per-sheet extractors
# -----------------------------------------------------------------------------

SCHOLAR_ID_RE = re.compile(r"SOL-S\d{4}")


def extract_scholars(rows: list[list]) -> list[dict]:
    """Sanitized scholar records. Adds derived fields:
    - effective_paternal_province: falls back to maternal if paternal blank
    - effective_province_group: Province/City Area via the Ward lookup
    Never infers Specific Island or customary fields from geography.
    """
    _, dicts = rows_to_dicts(
        rows, SHEETS["Scholars"]["header_row"], SHEETS["Scholars"]["first_data"]
    )
    clean = sanitize(dicts, SCHOLAR_PUBLIC_FIELDS)
    clean = [
        s for s in clean
        if SCHOLAR_ID_RE.fullmatch(str(s.get("Scholar ID") or "").strip())
    ]
    for s in clean:
        ward = clean_sentinel(s.get("Paternal Ward")) or clean_sentinel(s.get("Maternal Ward"))
        province = clean_sentinel(s.get("Paternal Province/City Area")) or clean_sentinel(
            s.get("Maternal Province/City Area")
        )
        s["effective_paternal_ward"] = ward or "Unclassified"
        s["effective_province_group"] = (
            province or PROVINCE_TO_CONFEDERACY.get(ward, "Unclassified")
        )
        # Specific Island and customary fields are NEVER derived from
        # Ward/Province -- read-through only, defensive re-affirmation.
        s["effective_specific_island"] = clean_sentinel(
            s.get("Paternal Specific Island")
        ) or clean_sentinel(s.get("Maternal Specific Island"))
    return clean


def extract_publications(rows: list[list]) -> list[dict]:
    _, dicts = rows_to_dicts(
        rows, SHEETS["Publications"]["header_row"], SHEETS["Publications"]["first_data"]
    )
    clean = sanitize(dicts, PUBLICATION_PUBLIC_FIELDS)
    for p in clean:
        raw_type = str(p.get("Type") or "").strip()
        type_key = " ".join(raw_type.lower().split())
        if type_key in {"phd thesis", "doctoral thesis", "doctorate thesis"}:
            p["Type"] = "PhD Thesis"
        elif type_key in {"master's thesis", "masters thesis", "master thesis"}:
            p["Type"] = "Master's Thesis"
        elif type_key in {"other thesis", "thesis"}:
            p["Type"] = "Other Thesis"
        elif type_key == "journal article / protocol":
            p["Type"] = "Journal Article"
        elif type_key in {"book chapter", "encyclopedia entry", "encyclopedia entry / book chapter"}:
            p["Type"] = "Book Chapter"
        elif type_key in {"book", "edited book", "book / monograph", "monograph"}:
            p["Type"] = "Book"
        elif type_key in {"report", "research report", "professional / technical report"}:
            p["Type"] = "Report"
        p["Year"] = as_int(p.get("Year"))
        for label in ALL_SOLOMON_GEOGRAPHY_LABELS:
            p[label] = 1 if is_truthy(p.get(label)) else 0
        p["_provinces"] = [prov for prov in PROVINCES if p.get(prov)]
        p["_solomon_unspecified"] = bool(p.get(PROVINCE_SOLOMON_UNSPECIFIED))
        p["_solomon_unsure"] = bool(p.get(PROVINCE_UNSURE))
    return clean


def extract_authorship(rows: list[list]) -> list[dict]:
    _, dicts = rows_to_dicts(
        rows, SHEETS["Authorship"]["header_row"], SHEETS["Authorship"]["first_data"]
    )
    clean = sanitize(dicts, AUTHORSHIP_PUBLIC_FIELDS)
    for a in clean:
        a["Author Position"] = as_int(a.get("Author Position"))
        a["Is First Author"] = is_truthy(a.get("Is First Author"))
        a["_is_lead"] = a["Author Position"] == 1 or a["Is First Author"]
    return clean


def extract_researcher_authorship(rows: list[list]) -> list[dict]:
    """Non-Solomon-Islander researcher authorship links (SOL-R IDs).

    Panel C2's Solomon Islands view treats a publication as
    Solomon-Islander-associated if it has EITHER a Scholar-level link
    (`Authorship`) OR a Researcher-level link here.
    """
    _, dicts = rows_to_dicts(
        rows,
        SHEETS["Researcher Authorship"]["header_row"],
        SHEETS["Researcher Authorship"]["first_data"],
    )
    clean = sanitize(dicts, RESEARCHER_AUTHORSHIP_PUBLIC_FIELDS)
    for a in clean:
        a["Author Position"] = as_int(a.get("Author Position"))
        a["_is_lead"] = a["Author Position"] == 1
    return clean


def extract_grad_degrees(rows: list[list]) -> list[dict]:
    _, dicts = rows_to_dicts(
        rows,
        SHEETS["Graduate Degrees"]["header_row"],
        SHEETS["Graduate Degrees"]["first_data"],
    )
    return sanitize(dicts, GRAD_DEGREE_PUBLIC_FIELDS)


def extract_part_solomon_islander_ids(rows: list[list]) -> set[str]:
    """Return the set of Scholar IDs listed on the Part-Solomon Islander
    sheet. These carry PSI-S IDs (a separate namespace) and must be
    excluded from every V2 dashboard surface reserved for the core
    Scholar (SOL-S) roster."""
    _, dicts = rows_to_dicts(
        rows,
        SHEETS["Part-Solomon Islander"]["header_row"],
        SHEETS["Part-Solomon Islander"]["first_data"],
    )
    ids: set[str] = set()
    for d in dicts:
        sid = str(d.get("Scholar ID") or "").strip()
        if sid:
            ids.add(sid)
    return ids


def extract_mobility(rows: list[list]) -> list[dict]:
    _, dicts = rows_to_dicts(
        rows,
        SHEETS["M>PhD Mobility"]["header_row"],
        SHEETS["M>PhD Mobility"]["first_data"],
    )
    clean = sanitize(dicts, MOBILITY_PUBLIC_FIELDS)
    for m in clean:
        m["Gap Years"] = as_int(m.get("Gap Years")) if str(m.get("Gap Years") or "").strip() else None
    return clean


def extract_geography(rows: list[list]) -> list[dict]:
    _, dicts = rows_to_dicts(
        rows,
        SHEETS["Research Geography"]["header_row"],
        SHEETS["Research Geography"]["first_data"],
    )
    clean = sanitize(dicts, RESEARCH_GEOGRAPHY_PUBLIC_FIELDS)
    for g in clean:
        for field in ("Latitude", "Longitude"):
            try:
                value = str(g.get(field) or "").strip()
                g[field] = float(value) if value else None
            except (TypeError, ValueError):
                g[field] = None
    return clean


def extract_geography_coordinates(rows: list[list]) -> list[dict]:
    """Canonical B4 marker coordinates maintained in the Master workbook."""
    _, dicts = rows_to_dicts(
        rows,
        SHEETS["Research Geography Coordinates"]["header_row"],
        SHEETS["Research Geography Coordinates"]["first_data"],
    )
    clean = sanitize(dicts, RESEARCH_GEOGRAPHY_COORDINATES_PUBLIC_FIELDS)
    for row in clean:
        for field in ("Longitude", "Latitude"):
            try:
                value = str(row.get(field) or "").strip()
                row[field] = float(value) if value else None
            except (TypeError, ValueError):
                row[field] = None
    return clean


def extract_institutions(rows: list[list]) -> list[dict]:
    _, dicts = rows_to_dicts(
        rows, SHEETS["Institutions"]["header_row"], SHEETS["Institutions"]["first_data"]
    )
    return sanitize(dicts, INSTITUTION_PUBLIC_FIELDS)


def extract_researchers(rows: list[list]) -> list[dict]:
    _, dicts = rows_to_dicts(
        rows,
        SHEETS["Solomon Islander Researchers"]["header_row"],
        SHEETS["Solomon Islander Researchers"]["first_data"],
    )
    return sanitize(dicts, RESEARCHER_PUBLIC_FIELDS)


def extract_awards(rows: list[list]) -> list[dict]:
    _, dicts = rows_to_dicts(
        rows, SHEETS["Awards & Honours"]["header_row"], SHEETS["Awards & Honours"]["first_data"]
    )
    return sanitize(dicts, AWARD_PUBLIC_FIELDS)


def extract_funding(rows: list[list]) -> list[dict]:
    _, dicts = rows_to_dicts(
        rows,
        SHEETS["Scholarships & Funding"]["header_row"],
        SHEETS["Scholarships & Funding"]["first_data"],
    )
    return sanitize(dicts, FUNDING_PUBLIC_FIELDS)


def extract_positions(rows: list[list]) -> list[dict]:
    _, dicts = rows_to_dicts(
        rows, SHEETS["Positions"]["header_row"], SHEETS["Positions"]["first_data"]
    )
    return sanitize(dicts, POSITION_PUBLIC_FIELDS)


# -----------------------------------------------------------------------------
# Aggregate/KPI computation -- the numbers the dashboard displays
# -----------------------------------------------------------------------------


def compute_aggregates(
    scholars: list[dict],
    publications: list[dict],
    authorship: list[dict],
    grad_degrees: list[dict],
    mobility: list[dict],
    researcher_authorship: list[dict] | None = None,
) -> dict:
    """Compute every headline/panel aggregate."""
    researcher_authorship = researcher_authorship or []

    scholar_ids = {s["Scholar ID"] for s in scholars if s.get("Scholar ID")}
    pubs_with_scholar_link: dict[str, set[str]] = {}
    for a in authorship:
        pid = a.get("Publication ID")
        sid = a.get("Scholar ID")
        if pid and sid and sid in scholar_ids:
            pubs_with_scholar_link.setdefault(pid, set()).add(sid)

    pubs_with_researcher_link: dict[str, set[str]] = {}
    for a in researcher_authorship:
        pid = a.get("Publication ID")
        rid = a.get("Researcher ID")
        if pid and rid:
            pubs_with_researcher_link.setdefault(pid, set()).add(rid)

    for p in publications:
        pid = p.get("Publication ID")
        linked = pubs_with_scholar_link.get(pid, set())
        researcher_linked = pubs_with_researcher_link.get(pid, set())
        p["_linked_scholar_ids"] = sorted(linked)
        p["_linked_researcher_ids"] = sorted(researcher_linked)
        p["_is_solomon_associated"] = bool(linked) or bool(researcher_linked)

    headline_pubs = [p for p in publications if p.get("Type") in HEADLINE_PUBLICATION_TYPES]
    by_type = {t: {"all": 0, "solomon": 0, "non_solomon": 0} for t in HEADLINE_PUBLICATION_TYPES}
    for p in headline_pubs:
        t = p["Type"]
        by_type[t]["all"] += 1
        if p["_is_solomon_associated"]:
            by_type[t]["solomon"] += 1
        else:
            by_type[t]["non_solomon"] += 1

    solomon_geo_all = _build_province_table(publications)
    solomon_geo_associated = _build_province_table(
        [p for p in publications if p["_is_solomon_associated"]]
    )

    grad_stats = _compute_grad_stats(grad_degrees, scholars)

    scholars_with_link: set[str] = set()
    for a in authorship:
        sid = a.get("Scholar ID")
        if sid and sid in scholar_ids:
            scholars_with_link.add(sid)

    # Gender vocabulary is "Man" / "Woman" / "Self-described (see free
    # text)" / "Not yet verified" (Lookups worksheet, pending community
    # consultation per SOLOMON-DASHBOARD-BUILD-NOTES.md). Aggregate KEY
    # NAMES stay generically named (scholars_woman/scholars_man) to match
    # the controlled vocabulary; this is NOT the Tongan Fefine/Tangata
    # scheme and NOT assumed final until Ron confirms the terms.
    totals = {
        "scholars": len(scholars),
        "scholars_woman": sum(1 for s in scholars if (s.get("Gender") or "").strip() == "Woman"),
        "scholars_man": sum(1 for s in scholars if (s.get("Gender") or "").strip() == "Man"),
        "scholars_gender_self_described": sum(
            1 for s in scholars if "self-described" in (s.get("Gender") or "").strip().lower()
        ),
        "scholars_gender_not_yet_verified": sum(
            1
            for s in scholars
            if (s.get("Gender") or "").strip() in {"", "Not yet verified"}
        ),
        "publications_total": len(publications),
        "publications_headline_five": len(headline_pubs),
        "publications_solomon_associated": sum(
            1 for p in publications if p["_is_solomon_associated"]
        ),
        "publications_solomon_associated_headline": sum(
            1 for p in headline_pubs if p["_is_solomon_associated"]
        ),
        "publications_non_solomon_only_headline": sum(
            1 for p in headline_pubs if not p["_is_solomon_associated"]
        ),
        "authorship_links": len(authorship),
        "scholars_with_authorship_link": len(scholars_with_link),
        "grad_degree_episodes": len(grad_degrees),
        "mobility_records": len(mobility),
    }

    return {
        "totals": totals,
        "by_publication_type_headline": by_type,
        "solomon_geo_all": solomon_geo_all,
        "solomon_geo_associated": solomon_geo_associated,
        "grad_stats": grad_stats,
    }


def _build_province_table(pubs: list[dict]) -> dict:
    """Build the province x publication-type crosstab (headline 5 only).
    Honiara City is kept as its own column, a sibling of the 9 provinces
    (never folded into Guadalcanal). A combined national total sums all
    10 reporting areas."""
    table = {t: {label: 0 for label in PROVINCES} for t in HEADLINE_PUBLICATION_TYPES}
    for p in pubs:
        t = p.get("Type")
        if t not in HEADLINE_PUBLICATION_TYPES:
            continue
        for label in PROVINCES:
            if p.get(label):
                table[t][label] += int(p[label])
    national_total = {
        t: sum(table[t].values()) for t in HEADLINE_PUBLICATION_TYPES
    }
    return {"table": table, "national_total": national_total}


C1_TYPE_MAP = {
    "masters":     "Master's Thesis",
    "phd":         "PhD Thesis",
    "journal":     "Journal Article",
    "book":        "Book",
    "bookSection": "Book Chapter",
}


def compute_body_composition_master(
    scholars: list[dict],
    publications: list[dict],
    authorship: list[dict],
) -> dict:
    """Return {Woman, Man} payload for data/solomon-body-composition-master.json
    (Panel C1, rendered by solomon-body-composition.html).

    Gender vocabulary is the Master Sheet's placeholder "Man"/"Woman"
    (pending community consultation -- see SOLOMON-DASHBOARD-BUILD-NOTES.md),
    not the Tongan Fefine/Tangata scheme. Mixed-gender publications are
    counted in BOTH columns (non-exclusive by design), matching the
    Tongan/iTaukei convention.
    """
    gender_by_sid = {
        s.get("Scholar ID"): (s.get("Gender") or "").strip()
        for s in scholars if s.get("Scholar ID")
    }
    scholar_ids = set(gender_by_sid.keys())
    pub_to_sids: dict[str, set[str]] = {}
    for a in authorship:
        pid = a.get("Publication ID")
        sid = a.get("Scholar ID")
        if pid and sid and sid in scholar_ids:
            pub_to_sids.setdefault(pid, set()).add(sid)

    payload: dict[str, dict] = {"Woman": {"scholars": 0}, "Man": {"scholars": 0}}
    for js_key in C1_TYPE_MAP:
        payload["Woman"][js_key] = 0
        payload["Man"][js_key] = 0

    for s in scholars:
        g = (s.get("Gender") or "").strip()
        if g == "Woman":
            payload["Woman"]["scholars"] += 1
        elif g == "Man":
            payload["Man"]["scholars"] += 1

    master_to_js = {v: k for k, v in C1_TYPE_MAP.items()}
    for p in publications:
        js_key = master_to_js.get(p.get("Type"))
        if not js_key:
            continue
        sids = pub_to_sids.get(p.get("Publication ID"), set())
        if not sids:
            continue
        linked_genders = {gender_by_sid.get(sid, "") for sid in sids}
        if "Man" in linked_genders:
            payload["Man"][js_key] += 1
        if "Woman" in linked_genders:
            payload["Woman"][js_key] += 1

    payload["_meta"] = {
        "source": "Solomon_Islands_Master_file",
        "generator": "scripts/solomon_master_file_transformer.py",
        "convention": (
            "Non-exclusive gender columns: a publication is counted in both "
            "Man and Woman when co-authored by Solomon Islander scholars of "
            "both genders. Gender vocabulary (Man/Woman) is a placeholder "
            "pending community consultation."
        ),
        "generatedAt": datetime.now(timezone.utc).isoformat(),
    }
    return payload


def _compute_grad_stats(grad_degrees: list[dict], scholars: list[dict]) -> dict:
    """Solomon-scholar-unique grad-stat counts. Counts by Scholar ID
    (unique scholars), not by degree row."""
    solomon_ids = {s["Scholar ID"] for s in scholars}
    master_completed: set[str] = set()
    phd_completed: set[str] = set()
    phd_inprogress: set[str] = set()
    for g in grad_degrees:
        sid = g.get("Scholar ID")
        if not sid or sid not in solomon_ids:
            continue
        stage = (g.get("Stage") or "").strip().lower()
        status = (g.get("Completion Status") or "").strip().lower()
        is_master = "master" in stage
        is_phd = "phd" in stage or "doctor" in stage
        is_completed = status == "completed"
        is_in_progress = status == "in progress"
        if is_master and is_completed:
            master_completed.add(sid)
        elif is_phd and is_completed:
            phd_completed.add(sid)
        elif is_phd and is_in_progress:
            phd_inprogress.add(sid)

    gender_by_id = {s["Scholar ID"]: s.get("Gender", "") for s in scholars}

    def gendered(ids: set[str]) -> dict:
        return {
            "total": len(ids),
            "man": sum(1 for i in ids if gender_by_id.get(i) == "Man"),
            "woman": sum(1 for i in ids if gender_by_id.get(i) == "Woman"),
        }

    return {
        "master_completed": gendered(master_completed),
        "phd_completed": gendered(phd_completed),
        "phd_in_progress": gendered(phd_inprogress),
        "both_master_and_phd_completed": gendered(master_completed & phd_completed),
    }


# -----------------------------------------------------------------------------
# Main pipeline
# -----------------------------------------------------------------------------


def run(fetch_fn, out_dir: Path, check_only: bool = False) -> tuple[bool, dict]:
    """Run the transformer. Returns (success, aggregates)."""
    started = datetime.now(timezone.utc).isoformat()
    log = lambda msg: print(f"[{time.strftime('%H:%M:%S')}] {msg}", flush=True)

    log("Fetching Scholars...")
    scholars_all = extract_scholars(fetch_fn("Scholars"))
    log(f"  -> {len(scholars_all)} scholars (pre Part-Solomon-Islander filter)")

    log("Fetching Part-Solomon Islander exclusion set...")
    part_ids_all = extract_part_solomon_islander_ids(fetch_fn("Part-Solomon Islander"))
    core_ids = {
        str(s.get("Scholar ID") or "").strip() for s in scholars_all
        if str(s.get("Scholar ID") or "").strip()
    }
    part_ids = part_ids_all - core_ids
    log(f"  -> {len(part_ids)} Part-Solomon-Islander-only IDs excluded")

    scholars = [s for s in scholars_all if s.get("Scholar ID") not in part_ids]
    if len(scholars) != len(scholars_all):
        log(f"  -> filtered Scholars: {len(scholars_all)} -> {len(scholars)}")

    log("Fetching Publications...")
    publications = extract_publications(fetch_fn("Publications"))
    log(f"  -> {len(publications)} publications")

    log("Fetching Authorship bridge...")
    authorship_all = extract_authorship(fetch_fn("Authorship"))
    authorship = [a for a in authorship_all if a.get("Scholar ID") not in part_ids]
    log(f"  -> {len(authorship)} authorship links (pre-filter {len(authorship_all)})")

    log("Fetching Researcher Authorship bridge...")
    researcher_authorship = extract_researcher_authorship(fetch_fn("Researcher Authorship"))
    log(f"  -> {len(researcher_authorship)} researcher authorship links")

    log("Fetching Graduate Degrees...")
    grad_degrees_all = extract_grad_degrees(fetch_fn("Graduate Degrees"))
    grad_degrees = [g for g in grad_degrees_all if g.get("Scholar ID") not in part_ids]
    log(f"  -> {len(grad_degrees)} degree episodes (pre-filter {len(grad_degrees_all)})")

    log("Fetching M>PhD Mobility...")
    mobility_all = extract_mobility(fetch_fn("M>PhD Mobility"))
    mobility = [m for m in mobility_all if m.get("Scholar ID") not in part_ids]
    log(f"  -> {len(mobility)} mobility records (pre-filter {len(mobility_all)})")

    log("Fetching Research Geography...")
    geography = extract_geography(fetch_fn("Research Geography"))
    log(f"  -> {len(geography)} geography records")

    log("Fetching Research Geography Coordinates...")
    geography_coordinates = extract_geography_coordinates(
        fetch_fn("Research Geography Coordinates")
    )
    log(f"  -> {len(geography_coordinates)} canonical geography coordinates")

    log("Fetching Institutions...")
    institutions = extract_institutions(fetch_fn("Institutions"))
    log(f"  -> {len(institutions)} institutions")

    log("Fetching Solomon Islander Researchers...")
    researchers = extract_researchers(fetch_fn("Solomon Islander Researchers"))
    log(f"  -> {len(researchers)} researchers")

    log("Fetching Awards, Funding, Positions...")
    awards = extract_awards(fetch_fn("Awards & Honours"))
    funding = extract_funding(fetch_fn("Scholarships & Funding"))
    positions = extract_positions(fetch_fn("Positions"))
    log(f"  -> {len(awards)} awards, {len(funding)} funding records, {len(positions)} positions")

    log("Computing aggregates...")
    aggregates = compute_aggregates(
        scholars, publications, authorship, grad_degrees, mobility,
        researcher_authorship=researcher_authorship,
    )
    t = aggregates["totals"]
    log(
        f"  -> scholars={t['scholars']} pubs={t['publications_total']} "
        f"headline5={t['publications_headline_five']} "
        f"solomon-assoc-headline={t['publications_solomon_associated_headline']}"
    )

    if check_only:
        log("Check-only mode; no files written.")
        return True, aggregates

    out_dir.mkdir(parents=True, exist_ok=True)
    _write_json(out_dir / "solomon-master-scholars.json", scholars)
    _write_json(out_dir / "solomon-master-publications.json", publications)
    _write_json(out_dir / "solomon-master-authorship.json", authorship)
    _write_json(out_dir / "solomon-master-researcher-authorship.json", researcher_authorship)
    _write_json(out_dir / "solomon-master-grad-degrees.json", grad_degrees)
    _write_json(out_dir / "solomon-master-mobility.json", mobility)
    _write_json(out_dir / "solomon-master-geography.json", geography)
    _write_json(out_dir / "solomon-master-geography-coordinates.json", geography_coordinates)
    _write_json(out_dir / "solomon-master-aggregates.json", aggregates)
    _write_json(out_dir / "solomon-master-institutions.json", institutions)
    _write_json(out_dir / "solomon-master-researchers.json", researchers)
    _write_json(out_dir / "solomon-master-awards.json", awards)
    _write_json(out_dir / "solomon-master-funding.json", funding)
    _write_json(out_dir / "solomon-master-positions.json", positions)

    log("Building Panel C1 body-composition payload...")
    body_comp = compute_body_composition_master(scholars, publications, authorship)
    _write_json(out_dir / "solomon-body-composition-master.json", body_comp)
    log(
        f"  -> C1 payload: Woman scholars={body_comp['Woman']['scholars']}, "
        f"Man scholars={body_comp['Man']['scholars']}"
    )

    last_sync = {
        "startedAt": started,
        "finishedAt": datetime.now(timezone.utc).isoformat(),
        "spreadsheetId": SPREADSHEET_ID,
        "counts": t,
        "source": "Solomon_Islands_Master_file",
    }
    _write_json(out_dir / "solomon-last-master-sync.json", last_sync)

    log("All snapshots written.")
    return True, aggregates


def _write_json(path: Path, obj: Any) -> None:
    tmp = path.with_suffix(path.suffix + ".tmp")
    tmp.write_text(json.dumps(obj, ensure_ascii=False, separators=(",", ":")))
    tmp.replace(path)
    print(f"  wrote {path.name} ({path.stat().st_size:,} bytes)")


# -----------------------------------------------------------------------------
# CLI
# -----------------------------------------------------------------------------


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument(
        "--mode",
        choices=("production", "gws", "local"),
        default="production",
        help="production = service-account API; gws = gws CLI; local = /tmp dump",
    )
    ap.add_argument(
        "--dump-dir",
        default="/tmp/solomon-master-file-dump",
        help="For --mode=local: directory of dumped sheet JSON files",
    )
    ap.add_argument("--out-dir", default="data", help="Output directory")
    ap.add_argument("--check-only", action="store_true")
    args = ap.parse_args()

    if args.mode == "production":
        fetch_fn = fetch_sheet_production
    elif args.mode == "gws":
        fetch_fn = fetch_sheet_gws
    else:
        dump = Path(args.dump_dir)
        fetch_fn = lambda name, _d=dump: fetch_sheet_local(name, _d)

    ok, _ = run(fetch_fn, Path(args.out_dir), check_only=args.check_only)
    return 0 if ok else 1


if __name__ == "__main__":
    sys.exit(main())
