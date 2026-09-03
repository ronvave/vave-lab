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

    Current layout (audited 2026-08-25 against the live Dashboard tab). Row
    numbers are the 1-indexed sheet rows; parenthetical indices are the
    0-indexed positions this parser uses.

      row  4 (idx  3): header  — 'Active iTaukei scholars' | ... | 'Female' | ... | 'Male' | ... | 'Gender unknown / verify'
      row  5 (idx  4): values  — [0]=scholars, [3]=female, [5]=male, [7]=gender unknown
      row  7 (idx  6): header  — 'Graduate degree episodes' | ... | 'International degree episodes' | ... | 'Funding episodes' | ... | 'Award episodes'
      row  8 (idx  7): values  — [0]=grad episodes, [3]=international, [5]=funding, [7]=awards
      row 10 (idx  9): header  — 'Publication records' | ... | 'Authorship bridge links' | ... | 'Scholars with exact links' | ... | 'Current position records'
      row 11 (idx 10): values  — layout shifted 2026-08-24 when the header
                        gained two spacer cells before 'Scholars with exact
                        links' and before 'Current position records'. We
                        now locate each value by header label in row 10
                        rather than hard-coding column indices, so the
                        reconciler self-heals if columns move again.

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

    def find_label_col(header_row: int, needle: str) -> int:
        """Return the 0-indexed column of the first cell in `header_row`
        whose stripped, case-folded text matches `needle` (also stripped
        and case-folded). Returns -1 if not found. Used so we can locate
        row-11 values by their row-10 header rather than by fragile
        column indices — the Dashboard has already reflowed once.
        """
        wanted = needle.strip().casefold()
        if header_row >= len(rows):
            return -1
        for i, v in enumerate(rows[header_row]):
            if str(v or "").strip().casefold() == wanted:
                return i
        return -1

    def find_label_row(needle: str, col: int = 0, start: int = 0) -> int:
        """Locate an exact label instead of relying on fragile row numbers."""
        wanted = needle.strip().casefold()
        for r in range(max(start, 0), len(rows)):
            if cell(r, col).casefold() == wanted:
                return r
        return -1

    def find_value_near(value_row: int, start_col: int, end_col: int) -> int:
        """Scan `value_row` from `start_col` to `end_col` inclusive and
        return the first numeric value found (commas/whitespace stripped).
        Returns 0 if nothing numeric is present.

        This exists because the Dashboard's row-10 headers are visually
        centered over merged ranges but the underlying value cell can
        sit one column to the right of its header — e.g. 'Scholars with
        exact links' has its header at col 6 but its value at col 7
        (audited 2026-08-25). Matching header column alone would read
        the empty col-6 cell and report 0. Widening the scan to the
        adjacent columns fixes that without over-reaching into the
        next block, because the Dashboard uses blank spacer columns
        as visual separators.
        """
        if value_row >= len(rows):
            return 0
        row = rows[value_row]
        lo = max(0, start_col)
        hi = min(len(row) - 1, end_col)
        for c in range(lo, hi + 1):
            v = str(row[c] or "").strip()
            v = re.sub(r"[,\s]", "", v)
            if v.isdigit():
                return int(v)
        return 0

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

    # Row 11 (index 10): pubs, authorship, scholars-w-link, positions.
    # Locate each value by its row-10 header label, then scan a small
    # column window (header ± 2) on row 11 for the first numeric cell.
    # The window handles two Dashboard quirks that hard-coded column
    # indices can't survive:
    #   1. Column-order drift when Ron reflows the block.
    #   2. Header vs value being offset by one cell inside merged
    #      header ranges (e.g. 'Scholars with exact links' header at
    #      col 6, value at col 7 as of 2026-08-25).
    # We compute the window from each label's neighbours so the scan
    # never leaks past an adjacent block.
    row11_labels = [
        ("publications_total", "Publication records"),
        ("authorship_links", "Authorship bridge links"),
        ("scholars_with_authorship_link", "Scholars with exact links"),
        ("current_positions", "Current position records"),
    ]
    header_cols = {key: find_label_col(9, label) for key, label in row11_labels}
    for i, (key, label) in enumerate(row11_labels):
        col = header_cols[key]
        if col < 0:
            print(
                f"[reconcile] WARN: Dashboard row-10 header '{label}' not found; "
                f"'{key}' will parse as 0 and trigger a reconcile mismatch.",
                file=sys.stderr,
            )
            out[key] = 0
            continue
        # Right edge of this label's window = (next label's column - 1),
        # or col + 2 if this is the last label. Left edge = col itself
        # (values never appear to the LEFT of their own header).
        next_cols = [
            header_cols[k] for k, _ in row11_labels[i + 1:]
            if header_cols[k] >= 0
        ]
        right = (min(next_cols) - 1) if next_cols else col + 2
        out[key] = find_value_near(10, col, right)

    # Graduate statistics. Locate the labels dynamically: explanatory rows may
    # be inserted above this block without changing the data contract.
    grad_labels = {
        "completed_masters": "Completed Master's",
        "completed_phd": "Completed PhD",
        "phd_current": "PhD currently in progress",
        "both_masters_and_phd": "Both completed Master's + completed PhD",
    }
    for key, label in grad_labels.items():
        r = find_label_row(label)
        if r < 0:
            print(
                f"[reconcile] WARN: Dashboard graduate label '{label}' not found; "
                f"'{key}' values will parse as 0.",
                file=sys.stderr,
            )
        out[f"{key}_male"] = num(r, 1) if r >= 0 else 0
        out[f"{key}_female"] = num(r, 2) if r >= 0 else 0
        out[f"{key}_total"] = num(r, 3) if r >= 0 else 0

    # Publication-type breakdown. Find the unique header containing both
    # 'Publication type' and 'All publications', then locate labels beneath it.
    # Col 1 = All publications, col 2 = iTaukei publications (total).
    # non_itaukei is derived as (all - itaukei); the Dashboard has no explicit column.
    by_type = {}
    publication_header_row = next(
        (
            r for r in range(len(rows))
            if cell(r, 0).casefold() == "publication type"
            and cell(r, 1).casefold() == "all publications"
        ),
        -1,
    )
    publication_rows = {}
    for t in HEADLINE_PUBLICATION_TYPES:
        r = find_label_row(t, start=publication_header_row + 1)
        publication_rows[t] = r
        if r < 0:
            print(
                f"[reconcile] WARN: Dashboard publication label '{t}' not found; "
                "values will parse as 0.",
                file=sys.stderr,
            )
        all_pubs = num(r, 1) if r >= 0 else 0
        itaukei = num(r, 2) if r >= 0 else 0
        by_type[t] = {
            "all": all_pubs,
            "non_itaukei": max(all_pubs - itaukei, 0),
            "itaukei": itaukei,
        }
    out["by_publication_type_headline"] = by_type

    # The totals row immediately follows the last headline publication row.
    # publications_non_itaukei_only_headline is derived (Dashboard has no such column).
    last_type_row = max(publication_rows.values(), default=-1)
    total_row = find_label_row("Total", start=last_type_row + 1)
    total_all = num(total_row, 1) if total_row >= 0 else 0
    total_itaukei = num(total_row, 2) if total_row >= 0 else 0
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
