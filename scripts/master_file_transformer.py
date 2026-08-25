#!/usr/bin/env python3
"""
Master File → sanitized JSON snapshots
======================================

Reads the iTaukei_Master_file Google Sheet via a service-account,
sanitizes each worksheet against a public-field allowlist, and writes
plaintext JSON to data/*.json. The encryption step (scripts/encrypt_data.py)
converts these to .enc for commit.

Runs from CI (.github/workflows/refresh-master-file.yml) every 2 hours.

Contract:
- Reads Master file via google-api-python-client + service-account JSON
  (env: GOOGLE_SERVICE_ACCOUNT_JSON = raw JSON string of key).
- Writes sanitized JSON to /workspace/data/*.json.
- On any validation failure: preserves last valid snapshot, logs the
  discrepancy, exits with code that keeps the old .enc unchanged.
- Never publishes private fields (see master_file_config.py allowlists).
- Never uses O_Uni for aggregations — only C_Uni.
- Never infers iTaukei identity from surname; only via Authorship bridge.

Usage:
    export GOOGLE_SERVICE_ACCOUNT_JSON="$(cat sa-key.json)"
    python3 scripts/master_file_transformer.py
    python3 scripts/master_file_transformer.py --local  # reads from /tmp dump

    # Reconciliation-only (compare against Dashboard sheet, do not write):
    python3 scripts/master_file_transformer.py --check-only
"""
from __future__ import annotations

import argparse
import json
import os
import subprocess
import sys
import time
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

from master_file_config import (
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
        "scholars_female": sum(1 for s in scholars if (s.get("Gender") or "").strip() == "Female"),
        "scholars_male": sum(1 for s in scholars if (s.get("Gender") or "").strip() == "Male"),
        "scholars_gender_other": sum(
            1
            for s in scholars
            if (s.get("Gender") or "").strip() not in {"Female", "Male", ""}
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
            1 for g in grad_degrees if is_truthy(g.get("International from Fiji?"))
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
            "male": sum(1 for i in ids if gender_by_id.get(i) == "Male"),
            "female": sum(1 for i in ids if gender_by_id.get(i) == "Female"),
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


def run(
    fetch_fn,
    out_dir: Path,
    check_only: bool = False,
) -> tuple[bool, dict]:
    """Run the transformer. Returns (success, aggregates)."""
    started = datetime.now(timezone.utc).isoformat()
    log = lambda msg: print(f"[{time.strftime('%H:%M:%S')}] {msg}", flush=True)

    log("Fetching Scholars...")
    scholars = extract_scholars(fetch_fn("Scholars"))
    log(f"  → {len(scholars)} scholars")

    log("Fetching Publications...")
    publications = extract_publications(fetch_fn("Publications"))
    log(f"  → {len(publications)} publications")

    log("Fetching Authorship bridge...")
    authorship = extract_authorship(fetch_fn("Authorship"))
    log(f"  → {len(authorship)} authorship links")

    log("Fetching Researcher Authorship bridge...")
    researcher_authorship = extract_researcher_authorship(
        fetch_fn("Researcher Authorship")
    )
    log(f"  → {len(researcher_authorship)} researcher authorship links")

    log("Fetching Graduate Degrees...")
    grad_degrees = extract_grad_degrees(fetch_fn("Graduate Degrees"))
    log(f"  → {len(grad_degrees)} degree episodes")

    log("Fetching M>PhD mobility...")
    mobility = extract_mobility(fetch_fn("M>PhD mobility"))
    log(f"  → {len(mobility)} mobility records")

    log("Fetching Research Geography...")
    geography = extract_geography(fetch_fn("Research Geography"))
    log(f"  → {len(geography)} geography records")

    log("Computing aggregates...")
    aggregates = compute_aggregates(
        scholars, publications, authorship, grad_degrees, mobility,
        researcher_authorship=researcher_authorship,
    )
    t = aggregates["totals"]
    log(f"  → scholars={t['scholars']} pubs={t['publications_total']} "
        f"headline5={t['publications_headline_five']} "
        f"iTaukei-assoc-headline={t['publications_itaukei_associated_headline']}")

    if check_only:
        log("Check-only mode; no files written.")
        return True, aggregates

    out_dir.mkdir(parents=True, exist_ok=True)
    _write_json(out_dir / "itaukei-master-scholars.json", scholars)
    _write_json(out_dir / "itaukei-master-publications.json", publications)
    _write_json(out_dir / "itaukei-master-authorship.json", authorship)
    _write_json(
        out_dir / "itaukei-master-researcher-authorship.json",
        researcher_authorship,
    )
    _write_json(out_dir / "itaukei-master-grad-degrees.json", grad_degrees)
    _write_json(out_dir / "itaukei-master-mobility.json", mobility)
    _write_json(out_dir / "itaukei-master-geography.json", geography)
    _write_json(out_dir / "itaukei-master-aggregates.json", aggregates)

    # last-sync
    last_sync = {
        "startedAt": started,
        "finishedAt": datetime.now(timezone.utc).isoformat(),
        "spreadsheetId": SPREADSHEET_ID,
        "counts": t,
        "source": "iTaukei_Master_file",
    }
    _write_json(out_dir / "last-master-sync.json", last_sync)

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
