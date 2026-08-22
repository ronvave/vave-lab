#!/usr/bin/env python3
"""Dump every worksheet of the iTaukei_Master_file Google Sheet as raw JSON
to /tmp/master-file-dump/<sheet>.json for offline transformer development.

Only run this once per session (or when the Master file changes materially).
It uses `gws` CLI with pre-configured Google Drive credentials.

Usage:
    python3 scripts/dump_master_file.py
"""
from __future__ import annotations

import json
import subprocess
import sys
from pathlib import Path

SPREADSHEET_ID = "1nJvMWLS8jnCOKtRoqdDpEW3s3j9TSAclXBO1txVFxdg"
OUT_DIR = Path("/tmp/master-file-dump")

# (sheet name, header row 1-indexed) — header row differs per sheet
SHEETS = [
    ("README", None),
    ("Scholars", 4),
    ("Part-iTaukei", 4),
    ("Dashboard", None),  # summary sheet, structured differently
    ("Review Queue", 4),
    ("Graduate Degrees", 4),
    ("Non-Completed Degrees", 4),
    ("Scholarships & Funding", 4),
    ("Awards & Honours", 4),
    ("Positions", 4),
    ("M>PhD mobility", 4),
    ("Mobility Summary", None),
    ("Deep Dive Summary", None),
    ("ICCR Cohort Audit", None),
    ("Publications", 4),  # row 3 is group labels, row 4 is real header
    ("Authorship", 4),
    ("Degree Publication Metrics", None),
    ("Research Geography", 4),
    ("Institution Publication Requirements", None),
    ("Institutions", 4),
    ("Source Register", None),
    ("Lookups", None),
    ("Change Log", None),
    ("Coauthor Network", None),
    ("Vanua Evidence Audit", None),
    ("Diplomatic Scholarship Audit", None),
    ("USP Thesis Audit", None),
    ("USP Graduation Audit", None),
    ("FNU Thesis Audit", None),
]


def fetch_sheet(sheet_name: str) -> list[list]:
    """Fetch entire sheet as list of rows via gws CLI."""
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
            f"gws exit {result.returncode} on {sheet_name!r}:\n"
            f"STDOUT:\n{result.stdout}\nSTDERR:\n{result.stderr}"
        )
    return json.loads(result.stdout).get("values", [])


def main() -> int:
    OUT_DIR.mkdir(parents=True, exist_ok=True)
    manifest = {}
    for sheet_name, header_row in SHEETS:
        try:
            rows = fetch_sheet(sheet_name)
        except RuntimeError as e:
            print(f"[ERR] {sheet_name}: {e}", file=sys.stderr)
            continue
        safe = sheet_name.replace("/", "_").replace(">", "gt").replace(" ", "_")
        payload = {
            "sheet_name": sheet_name,
            "header_row": header_row,
            "row_count": len(rows),
            "rows": rows,
        }
        out = OUT_DIR / f"{safe}.json"
        out.write_text(json.dumps(payload, ensure_ascii=False))
        manifest[sheet_name] = {"row_count": len(rows), "file": out.name}
        print(f"[OK]  {sheet_name:40s} {len(rows):5d} rows -> {out.name}")

    (OUT_DIR / "_manifest.json").write_text(
        json.dumps(manifest, ensure_ascii=False, indent=2)
    )
    print(f"\nWrote {len(manifest)} sheets to {OUT_DIR}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
