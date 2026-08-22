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
    Layout (as of v0.2):
      row 5:  Active iTaukei scholars, (blank), Female, (blank), Male, (blank), Gender unknown
              → row 5 vals cell 0/2/4/6 are the totals
      row 8:  Grad degrees, (blank), International, (blank), Funding, (blank), Awards
      row 11: Publications, Authorship links, Scholars w/ exact links, Current positions
      row 38: Completed Master's | Male | Female | Total
      row 39: Completed PhD | Male | Female | Total
      row 42: PhD currently in progress ...
      row 44: Both completed Master's + PhD ...
      row 51-55: Publication type breakdown (headline 5)
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

    # Top KPI block — row 5 (index 4) has scholars/female/male/unknown
    # Rows are 1-indexed in the sheet, 0-indexed here.
    out["scholars"] = num(4, 0)
    out["scholars_female"] = num(4, 2)
    out["scholars_male"] = num(4, 4)
    out["scholars_gender_other"] = num(4, 6)

    # Row 8 (index 7): grad episodes, international, funding, awards
    out["grad_degree_episodes"] = num(7, 0)
    out["grad_degree_international"] = num(7, 2)
    out["funding_episodes"] = num(7, 4)
    out["award_episodes"] = num(7, 6)

    # Row 11 (index 10): pubs, authorship, scholars-w-link, positions
    out["publications_total"] = num(10, 0)
    out["authorship_links"] = num(10, 2)
    out["scholars_with_authorship_link"] = num(10, 4)
    out["current_positions"] = num(10, 6)

    # Grad stats rows 37, 38, 41, 43 (indices 37-43)
    # Row 37 = "Completed Master's | 153 | 150 | 303"
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

    # Publication-type breakdown (headline 5) — rows 50-54 (indices 50-54)
    # Journal Article | 1083 | 423 | 660 | ...
    by_type = {}
    row_map = {
        "Journal Article": 50,
        "Master's Thesis": 51,
        "PhD Thesis": 52,
        "Book Chapter": 53,
        "Book": 54,
    }
    for t, r in row_map.items():
        by_type[t] = {
            "all": num(r, 1),
            "non_itaukei": num(r, 2),
            "itaukei": num(r, 3),
        }
    out["by_publication_type_headline"] = by_type

    # Totals row 55
    out["publications_headline_five"] = num(55, 1)
    out["publications_non_itaukei_only_headline"] = num(55, 2)
    out["publications_itaukei_associated_headline"] = num(55, 3)

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
