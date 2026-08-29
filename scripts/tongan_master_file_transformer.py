#!/usr/bin/env python3
"""
Tongan Master File → sanitized JSON snapshots
===============================================

Sister clone of scripts/master_file_transformer.py (iTaukei). Reads the
Tongan Scholars Master Sheet via a service-account, sanitizes each
worksheet against a public-field allowlist, and writes plaintext JSON to
data/tongan-master-*.json. The encryption step
(scripts/tongan_encrypt_data.py) converts these to .enc for commit.

Runs from CI (.github/workflows/refresh-tongan-master-file.yml), on the
same 2-hour schedule as the iTaukei workflow, and on manual dispatch from
the Tongan Admin Panel's "Refresh from Sheet" / "Force refresh" buttons.

Contract:
- Reads the Tongan Master Sheet via google-api-python-client + service-
  account JSON (env: GOOGLE_SERVICE_ACCOUNT_JSON = raw JSON string of key).
- Writes sanitized JSON to /workspace/data/tongan-master-*.json.
- On any validation failure: preserves last valid snapshot, logs the
  discrepancy, exits with code that keeps the old .enc unchanged.
- Never publishes private fields (see tongan_master_file_config.py allowlists).
- Never uses O_Uni for aggregations — only C_Uni.
- Never infers Tongan identity from surname; only via Authorship bridge.
- NEVER touches data/itaukei-* files or the iTaukei sheet — additive-only
  sister implementation.

Usage:
    export GOOGLE_SERVICE_ACCOUNT_JSON="$(cat sa-key.json)"
    python3 scripts/tongan_master_file_transformer.py
    python3 scripts/tongan_master_file_transformer.py --local  # reads from /tmp dump

    # Reconciliation-only (compare against Dashboard sheet, do not write):
    python3 scripts/tongan_master_file_transformer.py --check-only
"""
from __future__ import annotations

import argparse
import json
import os
import shutil
import subprocess
import sys
import tempfile
import time
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

from tongan_master_file_config import (
    ALL_FIJI_GEOGRAPHY_LABELS,
    AUTHORSHIP_PUBLIC_FIELDS,
    AWARD_PUBLIC_FIELDS,
    CONFEDERACIES,
    FUNDING_PUBLIC_FIELDS,
    GRAD_DEGREE_PUBLIC_FIELDS,
    HEADLINE_PUBLICATION_TYPES,
    MOBILITY_PUBLIC_FIELDS,
    OUTPUT_FILES,
    POSITION_PUBLIC_FIELDS,
    PROVINCE_FIJI_UNSPECIFIED,
    PROVINCE_TO_CONFEDERACY,
    PROVINCE_UNSURE,
    PROVINCES,
    PUBLICATION_PUBLIC_FIELDS,
    RESEARCHER_AUTHORSHIP_PUBLIC_FIELDS,
    SCHOLAR_PUBLIC_FIELDS,
    SHEETS,
    SPREADSHEET_ID,
)

# -----------------------------------------------------------------------------
# Sheet fetching — production (service account) or local (from dumped JSON)
# -----------------------------------------------------------------------------


def fetch_sheet_production(sheet_name: str) -> list[list]:
    """Fetch a worksheet via google-api-python-client + service account.
    Env var GOOGLE_SERVICE_ACCOUNT_JSON must contain the raw JSON key.
    """
    # Lazy import so --local mode doesn't require these deps
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
    """Load a worksheet from a local /tmp dump created by dump_master_file.py."""
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
    if len(rows) < header_row_1indexed:
        return [], []
    headers = [str(h).strip() for h in rows[header_row_1indexed - 1]]
    data_rows = rows[first_data_row_1indexed - 1 :]
    dicts: list[dict[str, Any]] = []
    for row in data_rows:
        if not row or all((c is None or str(c).strip() == "") for c in row):
            continue
        # Pad/truncate to header length
        padded = list(row) + [""] * (len(headers) - len(row))
        d = {h: padded[i] for i, h in enumerate(headers)}
        dicts.append(d)
    return headers, dicts


def sanitize(dicts: list[dict], allowlist: list[str]) -> list[dict]:
    """Keep only allowlisted fields; drop everything else. This is the
    primary confidentiality gate."""
    return [{k: d.get(k, "") for k in allowlist} for d in dicts]


def as_int(v: Any) -> int:
    """Best-effort int parse (empty/invalid → 0). Handles '1', '1.0', ' 3 '."""
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


# -----------------------------------------------------------------------------
# Per-sheet extractors
# -----------------------------------------------------------------------------


def extract_scholars(rows: list[list]) -> list[dict]:
    """Sanitized scholar records. Adds derived fields:
    - effective_paternal_province: falls back to maternal if paternal blank
    - effective_confederacy: from effective_paternal_province via lookup
    """
    _, dicts = rows_to_dicts(
        rows, SHEETS["Scholars"]["header_row"], SHEETS["Scholars"]["first_data"]
    )
    clean = sanitize(dicts, SCHOLAR_PUBLIC_FIELDS)
    for s in clean:
        prov = (s.get("Province Paternal") or "").strip()
        if not prov or prov.lower() == "unclassified":
            prov = (s.get("Province Maternal") or "").strip()
        s["effective_paternal_province"] = prov or "Unclassified"
        s["effective_confederacy"] = PROVINCE_TO_CONFEDERACY.get(
            s["effective_paternal_province"], "Unclassified"
        )
    return clean


def extract_publications(rows: list[list]) -> list[dict]:
    _, dicts = rows_to_dicts(
        rows, SHEETS["Publications"]["header_row"], SHEETS["Publications"]["first_data"]
    )
    clean = sanitize(dicts, PUBLICATION_PUBLIC_FIELDS)
    # Normalize year + boolean fields + one-hot province fields
    # NOTE: province columns in the Publications sheet are stored as
    # 'Yes'/'' text values (not 1/0). Use is_truthy to normalise to bools,
    # then keep numeric 0/1 in the output for compatibility with any
    # frontend that reads the raw column value.
    for p in clean:
        p["Year"] = as_int(p.get("Year"))
        for label in ALL_FIJI_GEOGRAPHY_LABELS:
            p[label] = 1 if is_truthy(p.get(label)) else 0
        # Aggregate: which provinces (and which confederacies) this pub is
        # associated with. Multi-province pubs are legitimate.
        p["_provinces"] = [prov for prov in PROVINCES if p.get(prov)]
        p["_confederacies"] = sorted(
            {PROVINCE_TO_CONFEDERACY[prov] for prov in p["_provinces"]}
        )
        p["_fiji_unspecified"] = bool(p.get(PROVINCE_FIJI_UNSPECIFIED))
        p["_fiji_unsure"] = bool(p.get(PROVINCE_UNSURE))
        # Bibliographic-authorship fields (from BibTeX/Zotero, not the
        # Authorship worksheet). Empty string when unresolved; the adapter
        # falls back to the Authorship-derived lead in that case.
        p["_bib_lead"] = (p.get("Bibliographic Lead Author") or "").strip()
        bac = p.get("Bibliographic Author Count")
        p["_bib_author_count"] = as_int(bac) if bac not in ("", None) else None
    return clean


def extract_authorship(rows: list[list]) -> list[dict]:
    _, dicts = rows_to_dicts(
        rows, SHEETS["Authorship"]["header_row"], SHEETS["Authorship"]["first_data"]
    )
    clean = sanitize(dicts, AUTHORSHIP_PUBLIC_FIELDS)
    for a in clean:
        a["Author Position"] = as_int(a.get("Author Position"))
        a["Is First Author?"] = is_truthy(a.get("Is First Author?"))
        # Lead-author rule (guide §8): Author Position == 1 OR Is First Author? true
        a["_is_lead"] = a["Author Position"] == 1 or a["Is First Author?"]
    return clean


def extract_grad_degrees(rows: list[list]) -> list[dict]:
    _, dicts = rows_to_dicts(
        rows,
        SHEETS["Graduate Degrees"]["header_row"],
        SHEETS["Graduate Degrees"]["first_data"],
    )
    return sanitize(dicts, GRAD_DEGREE_PUBLIC_FIELDS)


def extract_part_tongan_ids(rows: list[list]) -> set[str]:
    """Return the set of Scholar IDs listed on the Part-Tongan sheet.

    Tongan identity is patrilineal (same rule as the iTaukei system).
    Scholars whose father is not Tongan (mother is) are recorded here and
    must be excluded from every V2 dashboard surface: map popups,
    university drilldowns, scholar tables, KPI counts, aggregates,
    publications, discipline breakdowns, and mobility flows. The
    transformer only needs the Scholar ID column.
    """
    _, dicts = rows_to_dicts(
        rows,
        SHEETS["Part-Tongan"]["header_row"],
        SHEETS["Part-Tongan"]["first_data"],
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
        SHEETS["M>PhD mobility"]["header_row"],
        SHEETS["M>PhD mobility"]["first_data"],
    )
    clean = sanitize(dicts, MOBILITY_PUBLIC_FIELDS)
    for m in clean:
        for k in ("m_lon", "m_lat", "p_lon", "p_lat"):
            s = str(m.get(k, "")).strip()
            try:
                m[k] = float(s) if s else None
            except (ValueError, TypeError):
                m[k] = None
        for k in ("m_year", "p_year"):
            m[k] = as_int(m.get(k)) or None
    return clean


def extract_researcher_authorship(rows: list[list]) -> list[dict]:
    """Non-iTaukei researcher authorship links (ITK-R IDs).

    Panel C2's iTaukei view treats a publication as iTaukei-associated if it
    has EITHER a Scholar-level link (`Authorship`) OR a Researcher-level link
    here. The two sheets share the same shape but different ID namespaces.
    """
    _, dicts = rows_to_dicts(
        rows,
        SHEETS["Researcher Authorship"]["header_row"],
        SHEETS["Researcher Authorship"]["first_data"],
    )
    clean = sanitize(dicts, RESEARCHER_AUTHORSHIP_PUBLIC_FIELDS)
    for a in clean:
        a["Author Position"] = as_int(a.get("Author Position"))
        a["Is First Author?"] = is_truthy(a.get("Is First Author?"))
        a["_is_lead"] = a["Author Position"] == 1 or a["Is First Author?"]
    return clean


def extract_geography(rows: list[list]) -> list[dict]:
    _, dicts = rows_to_dicts(
        rows,
        SHEETS["Research Geography"]["header_row"],
        SHEETS["Research Geography"]["first_data"],
    )
    keep = [
        "Geography Record ID",
        "Publication ID / BibTeX Key",
        "Scholar ID (optional)",
        "Geography Type",
        "Country",
        "Fiji Province",
        "District",
        "Village / Site",
        "Confederacy (auto from Province)",
        # Required by the Panel-C2 geography repair: the adapter filters to
        # verified Fiji rows using this predicate:
        #   startswith("Verified", case-insensitive) OR == "Strong".
        "Verification",
    ]
    return sanitize(dicts, keep)


def extract_awards(rows: list[list]) -> list[dict]:
    _, dicts = rows_to_dicts(rows, 4, 5)
    return sanitize(dicts, AWARD_PUBLIC_FIELDS)


def extract_funding(rows: list[list]) -> list[dict]:
    _, dicts = rows_to_dicts(rows, 4, 5)
    return sanitize(dicts, FUNDING_PUBLIC_FIELDS)


def extract_positions(rows: list[list]) -> list[dict]:
    _, dicts = rows_to_dicts(rows, 4, 5)
    return sanitize(dicts, POSITION_PUBLIC_FIELDS)


# -----------------------------------------------------------------------------
# Aggregate/KPI computation — the numbers the dashboard displays
# -----------------------------------------------------------------------------


def compute_aggregates(
    scholars: list[dict],
    publications: list[dict],
    authorship: list[dict],
    grad_degrees: list[dict],
    mobility: list[dict],
    researcher_authorship: list[dict] | None = None,
) -> dict:
    """Compute every headline/panel aggregate. These map to the QA
    reference values in the Master-file Dashboard sheet."""
    researcher_authorship = researcher_authorship or []

    # ----- Publications: iTaukei-associated bridge -----
    # A publication is iTaukei-associated iff it has ≥1 link in either the
    # `Authorship` sheet (Scholar ID in `Scholars`) OR the `Researcher
    # Authorship` sheet (ITK-R researcher; guide §8 extension for the C2
    # geography repair). Never infer from author names/affiliations.
    scholar_ids = {s["Scholar ID"] for s in scholars if s.get("Scholar ID")}
    pubs_with_itaukei_link: dict[str, set[str]] = {}
    for a in authorship:
        pid = a.get("Publication ID / BibTeX Key")
        sid = a.get("Scholar ID")
        if pid and sid and sid in scholar_ids:
            pubs_with_itaukei_link.setdefault(pid, set()).add(sid)

    pubs_with_researcher_link: dict[str, set[str]] = {}
    for a in researcher_authorship:
        pid = a.get("Publication ID / BibTeX Key")
        rid = a.get("Researcher ID")
        if pid and rid:
            pubs_with_researcher_link.setdefault(pid, set()).add(rid)

    for p in publications:
        pid = p.get("Publication ID / BibTeX Key")
        linked = pubs_with_itaukei_link.get(pid, set())
        researcher_linked = pubs_with_researcher_link.get(pid, set())
        p["_linked_scholar_ids"] = sorted(linked)
        p["_linked_researcher_ids"] = sorted(researcher_linked)
        p["_is_itaukei_associated"] = bool(linked) or bool(researcher_linked)

    # ----- Publication-type breakdown (headline 5 types only) -----
    headline_pubs = [
        p for p in publications if p.get("Publication Type") in HEADLINE_PUBLICATION_TYPES
    ]
    by_type = {t: {"all": 0, "itaukei": 0, "non_itaukei": 0} for t in HEADLINE_PUBLICATION_TYPES}
    for p in headline_pubs:
        t = p["Publication Type"]
        by_type[t]["all"] += 1
        if p["_is_itaukei_associated"]:
            by_type[t]["itaukei"] += 1
        else:
            by_type[t]["non_itaukei"] += 1

    # ----- Fiji geography (2 parallel tables per guide §10) -----
    fiji_geo_all = _build_fiji_geo_table(publications)
    fiji_geo_itaukei = _build_fiji_geo_table(
        [p for p in publications if p["_is_itaukei_associated"]]
    )

    # ----- Grad-degree stats (guide §14: from Graduate Degrees ONLY,
    # not from Publications) -----
    grad_stats = _compute_grad_stats(grad_degrees, scholars)

    # ----- Scholars-with-any-link (Authorship reach) -----
    scholars_with_link = set()
    for a in authorship:
        sid = a.get("Scholar ID")
        if sid and sid in scholar_ids:
            scholars_with_link.add(sid)

    # ----- Headline KPIs -----
    totals = {
        "scholars": len(scholars),
        # Tonga's Gender enum is stored on the Master sheet as the literal
        # Tongan terms 'Tangata' (male) and 'Fefine' (female) per user
        # decision — not 'Male'/'Female'. The aggregate KEY NAMES stay in
        # English (scholars_female/scholars_male) to match the iTaukei
        # schema the dashboard JS already expects; only the underlying
        # comparison values differ.
        "scholars_female": sum(1 for s in scholars if (s.get("Gender") or "").strip() == "Fefine"),
        "scholars_male": sum(1 for s in scholars if (s.get("Gender") or "").strip() == "Tangata"),
        "scholars_gender_other": sum(
            1
            for s in scholars
            if (s.get("Gender") or "").strip() not in {"Fefine", "Tangata", ""}
        ),
        "scholars_gender_blank": sum(
            1 for s in scholars if not (s.get("Gender") or "").strip()
        ),
        "publications_total": len(publications),
        "publications_headline_five": len(headline_pubs),
        "publications_itaukei_associated": sum(
            1 for p in publications if p["_is_itaukei_associated"]
        ),
        "publications_itaukei_associated_headline": sum(
            1 for p in headline_pubs if p["_is_itaukei_associated"]
        ),
        "publications_non_itaukei_only_headline": sum(
            1 for p in headline_pubs if not p["_is_itaukei_associated"]
        ),
        "authorship_links": len(authorship),
        "scholars_with_authorship_link": len(scholars_with_link),
        "grad_degree_episodes": len(grad_degrees),
        "grad_degree_international": sum(
            1 for g in grad_degrees if is_truthy(g.get("International from Tonga?"))
        ),
        "mobility_records": len(mobility),
    }

    return {
        "totals": totals,
        "by_publication_type_headline": by_type,
        "fiji_geo_all": fiji_geo_all,
        "fiji_geo_itaukei": fiji_geo_itaukei,
        "grad_stats": grad_stats,
    }


def _build_fiji_geo_table(pubs: list[dict]) -> dict:
    """Build the province × publication-type crosstab (headline 5 only)."""
    table = {
        t: {label: 0 for label in ALL_FIJI_GEOGRAPHY_LABELS}
        for t in HEADLINE_PUBLICATION_TYPES
    }
    for p in pubs:
        t = p.get("Publication Type")
        if t not in HEADLINE_PUBLICATION_TYPES:
            continue
        for label in ALL_FIJI_GEOGRAPHY_LABELS:
            if p.get(label):
                table[t][label] += int(p[label])
    # Confederacy roll-ups
    conf_totals = {c: 0 for c in CONFEDERACIES}
    for t in HEADLINE_PUBLICATION_TYPES:
        for prov, count in table[t].items():
            if prov in PROVINCE_TO_CONFEDERACY:
                conf_totals[PROVINCE_TO_CONFEDERACY[prov]] += count
    return {"table": table, "confederacy_totals": conf_totals}


def _compute_grad_stats(grad_degrees: list[dict], scholars: list[dict]) -> dict:
    """iTaukei-scholar-unique grad-stat counts (per guide §14).
    Counts by Scholar ID (unique scholars), not by degree row."""
    itaukei_ids = {s["Scholar ID"] for s in scholars}
    # Per scholar: has any completed Master's? has any completed PhD?
    #             has any in-progress PhD?
    master_completed: set[str] = set()
    phd_completed: set[str] = set()
    phd_inprogress: set[str] = set()
    for g in grad_degrees:
        sid = g.get("Scholar ID")
        if not sid or sid not in itaukei_ids:
            continue
        stage = (g.get("Degree Stage") or "").strip().lower()
        status = (g.get("Completion Status") or "").strip().lower()
        # Stage detection: "Master's", "Masters", "Master" all count as master;
        # "PhD", "PhD/Doctorate", "Doctorate" all count as PhD.
        is_master = "master" in stage
        is_phd = "phd" in stage or "doctor" in stage
        # Status detection: "Completed" and any "Completed \u2014 ..." variant
        # count as completed. "In progress" and "Current" count as in-progress.
        is_completed = status.startswith("completed")
        is_in_progress = status.startswith("in progress") or status == "current" or status == "ongoing"
        if is_master and is_completed:
            master_completed.add(sid)
        elif is_phd and is_completed:
            phd_completed.add(sid)
        elif is_phd and is_in_progress:
            phd_inprogress.add(sid)

    # Gender split
    gender_by_id = {s["Scholar ID"]: s.get("Gender", "") for s in scholars}

    def gendered(ids: set[str]) -> dict:
        return {
            "total": len(ids),
            "male": sum(1 for i in ids if gender_by_id.get(i) == "Tangata"),
            "female": sum(1 for i in ids if gender_by_id.get(i) == "Fefine"),
        }

    return {
        "master_completed": gendered(master_completed),
        "phd_completed": gendered(phd_completed),
        "phd_in_progress": gendered(phd_inprogress),
        "both_master_and_phd_completed": gendered(master_completed & phd_completed),
    }


# -----------------------------------------------------------------------------
# Panel C1 body-composition — gendered per-type breakdown
# -----------------------------------------------------------------------------

# Panel C1 (itaukei-body-composition.html) expects an aggregate JSON with the
# shape { Woman: {...}, Man: {...} }, one dict per gender. Each dict carries
# the gender's scholar count plus one integer per publication-type key in
# HEADLINE_PUBLICATION_TYPES. The five keys mirror the JS TYPES array in the
# HTML file (masters, phd, journal, book, bookSection).
#
# Convention (matches the Master Dashboard row 51-55 columns 3 (iTaukei Male)
# and 4 (iTaukei Female)):
#   * A publication is credited to "Man" iff at least one linked iTaukei
#     scholar has Gender="Male".
#   * A publication is credited to "Woman" iff at least one linked iTaukei
#     scholar has Gender="Female".
# Mixed-gender publications (an iTaukei male + iTaukei female co-author) are
# counted in BOTH columns because the two Dashboard columns are non-exclusive
# by design and let each figure's total reflect that gender's honest
# scholarly contribution rather than a mutually-exclusive partition.
#
# JS key -> Master-file Publication Type
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
    """Return {Woman, Man} payload for data/body-composition-master.json.

    Reads the same Master snapshot the rest of the dashboard uses, so C1
    stays in step with the Dashboard sheet on every 2h refresh instead of
    being a hand-committed one-off.
    """
    gender_by_sid = {}
    for s in scholars:
        sid = s.get("Scholar ID")
        g = (s.get("Gender") or "").strip()
        if sid:
            gender_by_sid[sid] = g

    # Publication ID -> set of linked iTaukei Scholar IDs (already restricted
    # to iTaukei-V2 scholars because the transformer excludes Part-iTaukei
    # rows upstream and authorship rows only survive when their Scholar ID
    # resolves inside `scholars`).
    scholar_ids = {s.get("Scholar ID") for s in scholars if s.get("Scholar ID")}
    pub_to_sids: dict[str, set[str]] = {}
    for a in authorship:
        pid = a.get("Publication ID / BibTeX Key")
        sid = a.get("Scholar ID")
        if pid and sid and sid in scholar_ids:
            pub_to_sids.setdefault(pid, set()).add(sid)

    payload: dict[str, dict] = {
        "Woman": {"scholars": 0},
        "Man":   {"scholars": 0},
    }
    for js_key in C1_TYPE_MAP:
        payload["Woman"][js_key] = 0
        payload["Man"][js_key] = 0

    for s in scholars:
        g = (s.get("Gender") or "").strip()
        if g == "Fefine":
            payload["Woman"]["scholars"] += 1
        elif g == "Tangata":
            payload["Man"]["scholars"] += 1

    # Reverse: which JS keys does each Master Publication Type belong to.
    master_to_js = {v: k for k, v in C1_TYPE_MAP.items()}
    for p in publications:
        ptype = p.get("Publication Type")
        js_key = master_to_js.get(ptype)
        if not js_key:
            continue
        pid = p.get("Publication ID / BibTeX Key")
        sids = pub_to_sids.get(pid, set())
        if not sids:
            continue
        linked_genders = {gender_by_sid.get(sid, "") for sid in sids}
        if "Tangata" in linked_genders:
            payload["Man"][js_key] += 1
        if "Fefine" in linked_genders:
            payload["Woman"][js_key] += 1

    # Provenance so downstream readers can tell fresh vs stale at a glance.
    payload["_meta"] = {
        "source": "iTaukei_Master_file",
        "generator": "scripts/master_file_transformer.py",
        "convention": (
            "Non-exclusive gender columns: a publication is counted in both "
            "Man and Woman when co-authored by iTaukei scholars of both "
            "genders. Matches Master Dashboard row 51-55 columns 3-4."
        ),
        "generatedAt": datetime.now(timezone.utc).isoformat(),
    }
    return payload


# -----------------------------------------------------------------------------
# Main pipeline
# -----------------------------------------------------------------------------


def run(
    fetch_fn,
    out_dir: Path,
    check_only: bool = False,
) -> tuple[bool, dict]:
    """Run the transformer. Returns (success, aggregates)."""
    started = datetime.now(timezone.utc).isoformat()
    log = lambda msg: print(f"[{time.strftime('%H:%M:%S')}] {msg}", flush=True)

    log("Fetching Scholars...")
    scholars_all = extract_scholars(fetch_fn("Scholars"))
    log(f"  → {len(scholars_all)} scholars (pre Part-Tongan filter)")

    log("Fetching Part-Tongan exclusion set...")
    part_tongan_ids = extract_part_tongan_ids(fetch_fn("Part-Tongan"))
    log(f"  → {len(part_tongan_ids)} Part-Tongan Scholar IDs excluded")
    # Tongan identity is patrilineal. Scholars whose father is not Tongan
    # are stored on the Part-Tongan sheet and must be excluded from every
    # V2 dashboard surface. Some of these IDs may never appear on the main
    # Scholars sheet but do appear on Graduate Degrees — so we filter
    # grad_degrees and authorship by ID as well.
    scholars = [s for s in scholars_all if s.get("Scholar ID") not in part_tongan_ids]
    if len(scholars) != len(scholars_all):
        log(f"  → filtered Scholars: {len(scholars_all)} → {len(scholars)}")

    log("Fetching Publications...")
    publications = extract_publications(fetch_fn("Publications"))
    log(f"  → {len(publications)} publications")
    # Defensive scrub: strip Part-Tongan IDs from lead/co-author ID fields.
    # `Linked Tongan Scholar Count` is recomputed off the filtered Authorship
    # bridge downstream, so we only need to remove ID references here.
    if part_tongan_ids:
        for p in publications:
            lead = str(p.get("Auth_Lead Scholar ID") or "").strip()
            if lead in part_tongan_ids:
                p["Auth_Lead Scholar ID"] = ""
            co = str(p.get("Co-Auth_Scholar IDs") or "").strip()
            if co:
                kept = [x.strip() for x in co.split(";") if x.strip() and x.strip() not in part_tongan_ids]
                p["Co-Auth_Scholar IDs"] = "; ".join(kept)

    log("Fetching Authorship bridge...")
    authorship_all = extract_authorship(fetch_fn("Authorship"))
    authorship = [a for a in authorship_all if a.get("Scholar ID") not in part_tongan_ids]
    log(f"  → {len(authorship)} authorship links (pre-filter {len(authorship_all)})")

    log("Fetching Researcher Authorship bridge...")
    researcher_authorship = extract_researcher_authorship(
        fetch_fn("Researcher Authorship")
    )
    log(f"  → {len(researcher_authorship)} researcher authorship links")

    log("Fetching Graduate Degrees...")
    grad_degrees_all = extract_grad_degrees(fetch_fn("Graduate Degrees"))
    grad_degrees = [g for g in grad_degrees_all if g.get("Scholar ID") not in part_tongan_ids]
    log(f"  → {len(grad_degrees)} degree episodes (pre-filter {len(grad_degrees_all)})")

    # ------------------------------------------------------------------
    # De-duplicate near-identical Master's / PhD rows.
    #
    # The Master sheet occasionally carries two rows for the same scholar,
    # same qualification, at the same university (e.g. Nanise J. Young:
    # DEG-0046 MA 2005 with a thesis title, and DEG-0047 MA 2011 with no
    # thesis title). The V2 dashboard would then show her name twice in
    # the UH popup Masters section. Ron 2026-08-26: hide DEG-0047 until
    # the thesis title for the 2011 MA is recovered; do not touch the
    # sheet.
    #
    # Dedup key: (Scholar ID, Degree Stage, C_Uni name, Degree /
    # Qualification). When multiple rows share that key, keep the one
    # with the most information filled in (non-empty thesis > empty
    # thesis; then earliest completion year). Different qualifications
    # at the same university stay (Nacanieli Rika legitimately holds an
    # MA + MBA + MCom at USP).
    # ------------------------------------------------------------------
    def _grad_dedup_key(g: dict) -> tuple:
        return (
            (g.get("Scholar ID") or "").strip(),
            (g.get("Degree Stage") or "").strip(),
            (g.get("C_Uni name") or "").strip(),
            (g.get("Degree / Qualification") or "").strip(),
        )

    def _grad_row_rank(g: dict) -> tuple:
        # Lower tuple sorts FIRST: prefer rows with a thesis title, then
        # the earliest completion year, then stable Degree ID order.
        has_thesis = 1 if (g.get("Thesis / Research Title") or "").strip() else 0
        year_raw = (g.get("Finish / Completion Year")
                    or g.get("Year / Status")
                    or "").strip()
        try:
            year_num = int(year_raw)
        except (TypeError, ValueError):
            year_num = 9999
        return (-has_thesis, year_num, g.get("Degree ID") or "")

    _grad_by_key: dict[tuple, dict] = {}
    _grad_dupe_log: list[dict] = []
    for g in grad_degrees:
        k = _grad_dedup_key(g)
        # Skip incomplete keys (missing Scholar ID or Uni) — leave as-is.
        if not k[0] or not k[2]:
            _grad_by_key[(id(g),)] = g  # unique dummy key
            continue
        prev = _grad_by_key.get(k)
        if prev is None:
            _grad_by_key[k] = g
        else:
            keep, drop = (g, prev) if _grad_row_rank(g) < _grad_row_rank(prev) else (prev, g)
            _grad_by_key[k] = keep
            _grad_dupe_log.append({
                "scholar": drop.get("Scholar Name"),
                "kept":    keep.get("Degree ID"),
                "dropped": drop.get("Degree ID"),
                "stage":   drop.get("Degree Stage"),
                "uni":     drop.get("C_Uni name"),
                "qual":    drop.get("Degree / Qualification"),
            })
    grad_degrees = list(_grad_by_key.values())
    if _grad_dupe_log:
        log(f"  → dedup: dropped {len(_grad_dupe_log)} near-duplicate grad-degree row(s)")
        for d in _grad_dupe_log:
            log(f"      dropped {d['dropped']} (kept {d['kept']}): {d['scholar']} — {d['stage']} {d['qual']} @ {d['uni']}")

    log("Fetching M>PhD mobility...")
    mobility_all = extract_mobility(fetch_fn("M>PhD mobility"))
    mobility = [m for m in mobility_all if m.get("Scholar ID") not in part_tongan_ids]
    log(f"  → {len(mobility)} mobility records (pre-filter {len(mobility_all)})")

    log("Fetching Research Geography...")
    geography_all = extract_geography(fetch_fn("Research Geography"))
    geography = [
        g for g in geography_all
        if str(g.get("Scholar ID (optional)") or "").strip() not in part_tongan_ids
    ]
    log(f"  → {len(geography)} geography records (pre-filter {len(geography_all)})")

    log("Computing aggregates...")
    aggregates = compute_aggregates(
        scholars, publications, authorship, grad_degrees, mobility,
        researcher_authorship=researcher_authorship,
    )
    t = aggregates["totals"]
    log(f"  → scholars={t['scholars']} pubs={t['publications_total']} "
        f"headline5={t['publications_headline_five']} "
        f"Tongan-assoc-headline={t['publications_itaukei_associated_headline']}")

    if check_only:
        log("Check-only mode; no files written.")
        return True, aggregates

    out_dir.mkdir(parents=True, exist_ok=True)
    _write_json(out_dir / "tongan-master-scholars.json", scholars)
    _write_json(out_dir / "tongan-master-publications.json", publications)
    _write_json(out_dir / "tongan-master-authorship.json", authorship)
    _write_json(
        out_dir / "tongan-master-researcher-authorship.json",
        researcher_authorship,
    )
    _write_json(out_dir / "tongan-master-grad-degrees.json", grad_degrees)
    _write_json(out_dir / "tongan-master-mobility.json", mobility)
    _write_json(out_dir / "tongan-master-geography.json", geography)
    _write_json(out_dir / "tongan-master-aggregates.json", aggregates)

    # ----------------------------------------------------------------
    # Panel C1 body-composition (gendered per-type breakdown)
    # ----------------------------------------------------------------
    # tongan-body-composition.html?src=master reads this file. Rebuilding
    # it on every refresh keeps the two Tangata/Fefine silhouettes in step
    # with the Master Dashboard instead of drifting from a stale one-off
    # snapshot.
    log("Building Panel C1 body-composition payload...")
    body_comp = compute_body_composition_master(scholars, publications, authorship)
    _write_json(out_dir / "tongan-body-composition-master.json", body_comp)
    log(
        f"  → C1 payload: Woman scholars={body_comp['Woman']['scholars']}, "
        f"Man scholars={body_comp['Man']['scholars']}, "
        f"Woman pubs={sum(body_comp['Woman'][k] for k in C1_TYPE_MAP)}, "
        f"Man pubs={sum(body_comp['Man'][k] for k in C1_TYPE_MAP)}"
    )

    # ----------------------------------------------------------------
    # Panel B2 Master-derived world-points payload
    # ----------------------------------------------------------------
    # Builds the country → university → scholar drill-down for Panel
    # B2 ("Tongan Graduates — Global Database") strictly from Master
    # Graduate Degrees. See scripts/master_b2_worldpoints.py for the
    # validation contract enforced there (reused unchanged — out_path /
    # excluded_md_path are already parameterized).
    from master_b2_worldpoints import write_worldpoints
    log("Building Panel B2 world-points from Master Graduate Degrees...")
    excluded_md = out_dir.parent / "docs" / "b2_tongan_excluded_rows.md"
    excluded_md.parent.mkdir(exist_ok=True)

    # master_b2_worldpoints.load_uni_coords() hardcodes reading
    # <repo>/data/world-universities.json (the shared, iTaukei-scoped,
    # do-not-touch coordinate file — encrypted under VAVELAB_PASSCODE,
    # which the Tongan workflow does not have). The Tongan-scoped
    # counterpart lives at data/tongan-world-universities.json (encrypted
    # under VAVELAB_TONGAN_PASSCODE, already decrypted to plaintext by
    # the workflow's bootstrap step). To reuse write_worldpoints()
    # unchanged, stage a throwaway repo dir whose data/world-universities
    # .json is that Tongan file, and pass IT as `repo=` instead of the
    # real repo root. This is additive-only: scripts/master_b2_worldpoints
    # .py is never modified.
    tongan_uni_coords_src = out_dir / "tongan-world-universities.json"
    b2_repo = out_dir.parent
    b2_tmp_dir = None
    if tongan_uni_coords_src.exists():
        b2_tmp_dir = Path(tempfile.mkdtemp(prefix="tongan-b2-repo-"))
        (b2_tmp_dir / "data").mkdir(parents=True, exist_ok=True)
        shutil.copy(
            tongan_uni_coords_src,
            b2_tmp_dir / "data" / "world-universities.json",
        )
        b2_repo = b2_tmp_dir
        log(
            f"  → using Tongan university-coordinates file "
            f"({tongan_uni_coords_src.name}) for B2 lat/lng lookup"
        )
    else:
        log(
            "  → WARNING: data/tongan-world-universities.json not found; "
            "B2 worldPoints will have no lat/lng (map will be empty)"
        )

    try:
        b2_payload = write_worldpoints(
            grad_degrees,
            repo=b2_repo,
            out_path=out_dir / "tongan-master-worldpoints.json",
            excluded_md_path=excluded_md,
        )
    finally:
        if b2_tmp_dir is not None:
            shutil.rmtree(b2_tmp_dir, ignore_errors=True)
    b2_totals = b2_payload["totals"]
    log(
        f"  → B2 payload: countries={b2_totals['countries']}, "
        f"universities={b2_totals['universities']}, "
        f"scholars={b2_totals['scholars']}, "
        f"M={b2_totals['masters']}, P={b2_totals['phd']}, "
        f"excluded={b2_payload['excludedCount']}"
    )

    # last-sync
    last_sync = {
        "startedAt": started,
        "finishedAt": datetime.now(timezone.utc).isoformat(),
        "spreadsheetId": SPREADSHEET_ID,
        "counts": t,
        "source": "Tongan_Master_file",
    }
    _write_json(out_dir / "tongan-last-master-sync.json", last_sync)

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
        default="/tmp/master-file-dump",
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
