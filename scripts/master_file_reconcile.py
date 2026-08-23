#!/usr/bin/env python3
"""
Reconciliation tests for the Master-file transformer output.

Reads the Master-file Dashboard worksheet (the authoritative QA sheet
maintained by Ron in the source Google Sheet) and verifies that the
transformer's computed aggregates match. Any discrepancy is reported;
--strict causes exit 1 so CI can preserve the last valid snapshot.

Usage:
    python3 scripts/master_file_reconcile.py --snapshot-dir=data
    python3 scripts/master_file_reconcile.py --snapshot-dir=data --strict
    python3 scripts/master_file_reconcile.py --snapshot-dir=/tmp/master-out --local
"""
from __future__ import annotations

import argparse
import json
import os
import re
import subprocess
import sys
from pathlib import Path

from master_file_config import HEADLINE_PUBLICATION_TYPES, SPREADSHEET_ID

DASHBOARD_SHEET = "Dashboard"


# -----------------------------------------------------------------------------
# Fetch Dashboard sheet (Google Sheet source of truth for reconciliation)
# -----------------------------------------------------------------------------


def fetch_dashboard_production() -> list[list]:
    from google.oauth2 import service_account  # type: ignore
    from googleapiclient.discovery import build  # type: ignore

    info = json.loads(os.environ["GOOGLE_SERVICE_ACCOUNT_JSON"])
    creds = service_account.Credentials.from_service_account_info(
        info, scopes=["https://www.googleapis.com/auth/spreadsheets.readonly"]
    )
    svc = build("sheets", "v4", credentials=creds, cache_discovery=False)
    resp = (
        svc.spreadsheets()
        .values()
        .get(
            spreadsheetId=SPREADSHEET_ID,
            range=DASHBOARD_SHEET,
            majorDimension="ROWS",
            valueRenderOption="FORMATTED_VALUE",
        )
        .execute()
    )
    return resp.get("values", [])


def fetch_dashboard_gws() -> list[list]:
    params = json.dumps(
        {
            "spreadsheetId": SPREADSHEET_ID,
            "range": DASHBOARD_SHEET,
            "majorDimension": "ROWS",
            "valueRenderOption": "FORMATTED_VALUE",
        }
    )
    r = subprocess.run(
        ["gws", "sheets", "spreadsheets", "values", "get", "--params", params],
        capture_output=True,
        text=True,
        check=False,
    )
    if r.returncode != 0:
        raise RuntimeError(f"gws exit {r.returncode}: {r.stderr[:500]}")
    return json.loads(r.stdout).get("values", [])


def fetch_dashboard_local(dump_dir: Path) -> list[list]:
    return json.loads((dump_dir / "Dashboard.json").read_text()).get("rows", [])


# -----------------------------------------------------------------------------
# Parse the Dashboard sheet into structured expected values
# -----------------------------------------------------------------------------


def parse_dashboard(rows: list[list]) -> dict:
    """Extract expected values from the Master-file Dashboard worksheet.

    Current layout (audited 2026-08-23 against the live Dashboard tab). Row
    numbers are the 1-indexed sheet rows; parenthetical indices are the
    0-indexed positions this parser uses.

      row  4 (idx  3): header  — 'Active iTaukei scholars' | ... | 'Female' | ... | 'Male' | ... | 'Gender unknown / verify'
      row  5 (idx  4): values  — [0]=scholars, [3]=female, [5]=male, [7]=gender unknown
      row  7 (idx  6): header  — 'Graduate degree episodes' | ... | 'International degree episodes' | ... | 'Funding episodes' | ... | 'Award episodes'
      row  8 (idx  7): values  — [0]=grad episodes, [3]=international, [5]=funding, [7]=awards
      row 10 (idx  9): header  — 'Publication records' | ... | 'Authorship bridge links' | ... | 'Scholars with exact links' | ... | 'Current position records'
      row 11 (idx 10): values  — [0]=pubs, [3]=authorship, [5]=scholars w/link, [7]=current positions

      Postgraduate Degrees by Gender (unchanged):
      row 37 (idx 36): header  — 'Status' | 'Male' | 'Female' | 'Total'
      row 38 (idx 37): Completed Master's | M | F | T
      row 39 (idx 38): Completed PhD | M | F | T
      row 42 (idx 41): PhD currently in progress | M | F | T
      row 44 (idx 43): Both completed Master's + completed PhD | M | F | T

      Publication-type breakdown (five headline categories):
      row 49 (idx 48): header — 'Publication type' | 'All publications' | 'iTaukei publications' | 'iTaukei Male' | 'iTaukei Female' | 'Lead author Male' | 'Lead author Female' | 'Co-author Male' | 'Co-author Female'
      row 51-55 (idx 50-54): Journal Article, Master's Thesis, PhD Thesis, Book Chapter, Book
      row 56 (idx 55): Total

    Note: the Dashboard has no explicit 'non-iTaukei' column; the reconciler's
    'publications_non_itaukei_only_headline' expected value is derived as
    (All publications - iTaukei publications) on the total row.
    """

    def cell(r: int, c: int) -> str:
        if r >= len(rows) or c >= len(rows[r]):
            return ""
        return str(rows[r][c] or "").strip()

    def num(r: int, c: int) -> int:
        v = cell(r, c)
        v = re.sub(r"[,\s]", "", v)
        return int(v) if v.isdigit() else 0

    out = {}

    # Top KPI block — row 5 (index 4). Values sit at cols 0/3/5/7.
    out["scholars"] = num(4, 0)
    out["scholars_female"] = num(4, 3)
    out["scholars_male"] = num(4, 5)
    out["scholars_gender_other"] = num(4, 7)

    # Row 8 (index 7): grad episodes, international, funding, awards at cols 0/3/5/7.
    out["grad_degree_episodes"] = num(7, 0)
    out["grad_degree_international"] = num(7, 3)
    out["funding_episodes"] = num(7, 5)
    out["award_episodes"] = num(7, 7)

    # Row 11 (index 10): pubs, authorship, scholars-w-link, positions at cols 0/3/5/7.
    out["publications_total"] = num(10, 0)
    out["authorship_links"] = num(10, 3)
    out["scholars_with_authorship_link"] = num(10, 5)
    out["current_positions"] = num(10, 7)

    # Grad stats rows 38/39/42/44 (indices 37/38/41/43). Layout unchanged.
    out["completed_masters_male"] = num(37, 1)
    out["completed_masters_female"] = num(37, 2)
    out["completed_masters_total"] = num(37, 3)
    out["completed_phd_male"] = num(38, 1)
    out["completed_phd_female"] = num(38, 2)
    out["completed_phd_total"] = num(38, 3)
    out["phd_current_male"] = num(41, 1)
    out["phd_current_female"] = num(41, 2)
    out["phd_current_total"] = num(41, 3)
    out["both_masters_and_phd_male"] = num(43, 1)
    out["both_masters_and_phd_female"] = num(43, 2)
    out["both_masters_and_phd_total"] = num(43, 3)

    # Publication-type breakdown — rows 51-55 (indices 50-54).
    # Col 1 = All publications, col 2 = iTaukei publications (total).
    # non_itaukei is derived as (all - itaukei); the Dashboard has no explicit column.
    by_type = {}
    row_map = {
        "Journal Article": 50,
        "Master's Thesis": 51,
        "PhD Thesis": 52,
        "Book Chapter": 53,
        "Book": 54,
    }
    for t, r in row_map.items():
        all_pubs = num(r, 1)
        itaukei = num(r, 2)
        by_type[t] = {
            "all": all_pubs,
            "non_itaukei": max(all_pubs - itaukei, 0),
            "itaukei": itaukei,
        }
    out["by_publication_type_headline"] = by_type

    # Totals row 56 (index 55). Col 1 = All, col 2 = iTaukei total.
    # publications_non_itaukei_only_headline is derived (Dashboard has no such column).
    total_all = num(55, 1)
    total_itaukei = num(55, 2)
    out["publications_headline_five"] = total_all
    out["publications_itaukei_associated_headline"] = total_itaukei
    out["publications_non_itaukei_only_headline"] = max(total_all - total_itaukei, 0)

    return out


# -----------------------------------------------------------------------------
# Compare
# -----------------------------------------------------------------------------


def compare(computed: dict, expected: dict) -> list[tuple[str, int, int]]:
    """Return list of (key, expected, computed) tuples for mismatches."""
    mismatches = []
    totals = computed["totals"]
    checks = [
        ("scholars", expected["scholars"], totals["scholars"]),
        ("scholars_female", expected["scholars_female"], totals["scholars_female"]),
        ("scholars_male", expected["scholars_male"], totals["scholars_male"]),
        (
            "publications_total",
            expected["publications_total"],
            totals["publications_total"],
        ),
        (
            "publications_headline_five",
            expected["publications_headline_five"],
            totals["publications_headline_five"],
        ),
        (
            "publications_itaukei_associated_headline",
            expected["publications_itaukei_associated_headline"],
            totals["publications_itaukei_associated_headline"],
        ),
        (
            "publications_non_itaukei_only_headline",
            expected["publications_non_itaukei_only_headline"],
            totals["publications_non_itaukei_only_headline"],
        ),
        ("authorship_links", expected["authorship_links"], totals["authorship_links"]),
        (
            "scholars_with_authorship_link",
            expected["scholars_with_authorship_link"],
            totals["scholars_with_authorship_link"],
        ),
        (
            "grad_degree_episodes",
            expected["grad_degree_episodes"],
            totals["grad_degree_episodes"],
        ),
        (
            "grad_degree_international",
            expected["grad_degree_international"],
            totals["grad_degree_international"],
        ),
    ]
    for key, exp, got in checks:
        if exp != got:
            mismatches.append((key, exp, got))

    # Per-publication-type
    for t in HEADLINE_PUBLICATION_TYPES:
        exp = expected["by_publication_type_headline"][t]["all"]
        got = computed["by_publication_type_headline"][t]["all"]
        if exp != got:
            mismatches.append((f"pubtype:{t}:all", exp, got))
        exp = expected["by_publication_type_headline"][t]["itaukei"]
        got = computed["by_publication_type_headline"][t]["itaukei"]
        if exp != got:
            mismatches.append((f"pubtype:{t}:itaukei", exp, got))

    # Grad stats
    gs = computed["grad_stats"]
    grad_checks = [
        ("completed_masters_total", expected["completed_masters_total"], gs["master_completed"]["total"]),
        ("completed_phd_total", expected["completed_phd_total"], gs["phd_completed"]["total"]),
        ("phd_current_total", expected["phd_current_total"], gs["phd_in_progress"]["total"]),
        (
            "both_masters_and_phd_total",
            expected["both_masters_and_phd_total"],
            gs["both_master_and_phd_completed"]["total"],
        ),
    ]
    for key, exp, got in grad_checks:
        if exp != got:
            mismatches.append((key, exp, got))
    return mismatches


# -----------------------------------------------------------------------------
# CLI
# -----------------------------------------------------------------------------


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--snapshot-dir", default="data")
    ap.add_argument("--strict", action="store_true", help="Exit 1 on any mismatch")
    ap.add_argument("--tolerance", type=int, default=0, help="Max allowed drift per metric")
    ap.add_argument(
        "--mode",
        choices=("production", "gws", "local"),
        default="production",
    )
    ap.add_argument("--dump-dir", default="/tmp/master-file-dump")
    args = ap.parse_args()

    if args.mode == "production":
        rows = fetch_dashboard_production()
    elif args.mode == "gws":
        rows = fetch_dashboard_gws()
    else:
        rows = fetch_dashboard_local(Path(args.dump_dir))

    expected = parse_dashboard(rows)
    aggs_path = Path(args.snapshot_dir) / "itaukei-master-aggregates.json"
    computed = json.loads(aggs_path.read_text())

    mismatches = compare(computed, expected)
    if args.tolerance > 0:
        mismatches = [m for m in mismatches if abs(m[1] - m[2]) > args.tolerance]

    print(f"Reconciliation checks: {len(expected)} expected values")
    if not mismatches:
        print("✓ All reconciliation checks PASSED")
        return 0
    print(f"✗ {len(mismatches)} mismatches:")
    for key, exp, got in mismatches:
        print(f"  {key}: expected={exp} computed={got} drift={got - exp:+d}")
    return 1 if args.strict else 0


if __name__ == "__main__":
    sys.exit(main())
