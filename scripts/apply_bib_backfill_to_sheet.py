#!/usr/bin/env python3
"""Apply the bibliographic-lead-author backfill to the Publications sheet.

Steps:
  1. Insert two new columns at position V (index 21) via batchUpdate insertDimension.
  2. Write header row 4 for the two new columns.
  3. Batch-write column V + W for every resolved publication row (matched by
     column A Publication ID).
  4. Append two Change Log entries with actor
     'Perplexity AI / B4 bibliographic-lead-author backfill'.

Loop guard: this script is one-shot; if any step returns nonzero, stop and
surface the error. Do NOT wrap gws in a retry loop.
"""
from __future__ import annotations
import csv
import datetime as dt
import json
import subprocess
import sys
from pathlib import Path

SPREADSHEET_ID = "1nJvMWLS8jnCOKtRoqdDpEW3s3j9TSAclXBO1txVFxdg"
PUB_SHEET_ID = 1009
CHANGELOG_SHEET_ID = 1015
BACKFILL_JSON = "/tmp/bib-backfill.json"


def gws(cmd_argv: list[str], params: dict | None = None, json_body: dict | None = None) -> dict:
    """Run a gws subcommand and return parsed JSON stdout."""
    argv = ["gws"] + cmd_argv
    if params is not None:
        argv += ["--params", json.dumps(params)]
    if json_body is not None:
        argv += ["--json", json.dumps(json_body)]
    body_len = len(argv[-1]) if json_body is not None else 0
    print("$ " + " ".join(argv[:3]) + f" (params keys: {list(params.keys()) if params else []}, body bytes: {body_len})")
    r = subprocess.run(argv, capture_output=True, text=True)
    if r.returncode != 0:
        print("STDERR:", r.stderr, file=sys.stderr)
        raise SystemExit(f"gws call failed with exit {r.returncode}")
    if not r.stdout.strip():
        return {}
    return json.loads(r.stdout)


def col_letter(idx0: int) -> str:
    """0-indexed column → A1 letter."""
    s = ""
    n = idx0
    while True:
        s = chr(ord("A") + (n % 26)) + s
        n = n // 26 - 1
        if n < 0:
            break
    return s


def main() -> int:
    backfill = json.loads(Path(BACKFILL_JSON).read_text())
    print(f"Backfill entries: {len(backfill)}")

    # Idempotency check: is column V already 'Bibliographic Lead Author'?
    print("Checking current header at V4/W4 …")
    hdr_check = gws(
        ["sheets", "spreadsheets", "values", "get"],
        params={
            "spreadsheetId": SPREADSHEET_ID,
            "range": "Publications!V4:W4",
        },
    )
    hdr_now = hdr_check.get("values", [[]])[0] if hdr_check.get("values") else []
    already_inserted = (
        len(hdr_now) >= 2
        and hdr_now[0] == "Bibliographic Lead Author"
        and hdr_now[1] == "Bibliographic Author Count"
    )

    if not already_inserted:
        # Step 1 — insert two columns at position V (index 21, 0-based).
        print("Step 1: insert two new columns at V (index 21) …")
        gws(
            ["sheets", "spreadsheets", "batchUpdate"],
            params={"spreadsheetId": SPREADSHEET_ID},
            json_body={
                "requests": [
                    {
                        "insertDimension": {
                            "range": {
                                "sheetId": PUB_SHEET_ID,
                                "dimension": "COLUMNS",
                                "startIndex": 21,
                                "endIndex": 23,
                            },
                            "inheritFromBefore": True,
                        }
                    }
                ]
            },
        )
        print("  ✓ inserted")

        # Step 2 — write header row 4 for the two new columns.
        print("Step 2: write header row for V4 & W4 …")
        gws(
            ["sheets", "spreadsheets", "values", "update"],
            params={
                "spreadsheetId": SPREADSHEET_ID,
                "range": "Publications!V4:W4",
                "valueInputOption": "RAW",
            },
            json_body={"values": [["Bibliographic Lead Author", "Bibliographic Author Count"]]},
        )
        print("  ✓ header written")
    else:
        print("Steps 1+2 already applied — skipping insert + header write.")

    # Step 3 — batch-write V + W for every backfilled key.
    # First fetch column A (Publication IDs) so we know which sheet row each
    # key lives on. Skip rows 1–4 (title, spacers, headers).
    print("Step 3: batch-write column V + W for resolved keys …")
    col_a = gws(
        ["sheets", "spreadsheets", "values", "get"],
        params={
            "spreadsheetId": SPREADSHEET_ID,
            "range": "Publications!A1:A6000",
            "majorDimension": "COLUMNS",
        },
    )["values"][0]
    row_by_key: dict[str, int] = {}
    for i, v in enumerate(col_a, start=1):
        if i < 5:
            continue
        vs = (v or "").strip()
        if vs:
            row_by_key[vs] = i

    # Build a single batchUpdate values payload with per-row ranges. Google
    # Sheets API caps a single request at 1 000 000 cells but our payload is
    # small (~5 400 cells worst case). Use one range per row for correctness.
    data = []
    hits = 0
    misses = 0
    for key, rec in backfill.items():
        r = row_by_key.get(key)
        if not r:
            misses += 1
            continue
        data.append(
            {
                "range": f"Publications!V{r}:W{r}",
                "values": [[rec["lead"], int(rec["count"])]],
            }
        )
        hits += 1
    print(f"  Rows to write: {hits}; keys not found on sheet: {misses}")
    if misses:
        # Not fatal — could be Master JSON rows that were subsequently removed
        # from the Sheet. Log a sample and continue.
        missing = [k for k in list(backfill.keys())[:10] if k not in row_by_key]
        print(f"  Sample missing keys: {missing[:5]}")

    # Chunk to keep each gws --json argv below Linux argv (E2BIG) limit.
    # Each row is ~150-250 bytes serialized; keep chunks under ~50 KB argv.
    CHUNK = 200
    for i in range(0, len(data), CHUNK):
        chunk = data[i : i + CHUNK]
        print(f"  Writing chunk {i}..{i+len(chunk)-1} ({len(chunk)} rows)…")
        gws(
            ["sheets", "spreadsheets", "values", "batchUpdate"],
            params={"spreadsheetId": SPREADSHEET_ID},
            json_body={
                "valueInputOption": "RAW",
                "data": chunk,
            },
        )
    print(f"  ✓ wrote {hits} rows to columns V/W")

    # Step 4 — Change Log entries. Read current Change Log to find the next
    # empty row and derive the next row-ID sequence.
    print("Step 4: append Change Log entries …")
    cl = gws(
        ["sheets", "spreadsheets", "values", "get"],
        params={
            "spreadsheetId": SPREADSHEET_ID,
            "range": "Change Log!A1:J600",
            "majorDimension": "ROWS",
        },
    ).get("values", [])
    # Header at row 4 for consistency with Publications; find next empty row after.
    next_row = 1
    for i, r in enumerate(cl, start=1):
        if any((c or "").strip() for c in r):
            next_row = i + 1
    print(f"  Next Change Log row: {next_row}")

    # Determine header schema
    hdr = None
    for r in cl[:6]:
        if r and (r[0] or "").strip().lower().startswith("change"):
            hdr = r
            break
    if not hdr:
        # fall back to header row 4 assumption
        hdr = cl[3] if len(cl) > 3 else []
    print(f"  Change Log header: {hdr}")

    ts_id = dt.datetime.now(dt.timezone.utc).strftime("%Y%m%d")
    today = dt.date.today().strftime("%Y-%m-%d")
    actor = "Perplexity AI / B4 bibliographic-lead-author backfill"
    resolved_count = sum(1 for v in backfill.values() if v["source"] == "bibtex")
    unresolved_csv = Path("/home/user/workspace/vave-lab/data/full-authors-unresolved.csv")
    unresolved_count = sum(1 for _ in unresolved_csv.open()) - 1 if unresolved_csv.exists() else 0

    # Change Log is 5 columns: Version | Date | Change | Scope / Impact | Source
    entries = [
        [
            f"B4-bib-lead-author-schema-{ts_id}",
            today,
            (
                "Inserted new columns V 'Bibliographic Lead Author' and W 'Bibliographic Author Count' on Publications "
                "(position 22-23); Fiji province one-hot columns shifted right by two. Authorship worksheet unchanged "
                "and remains the authoritative Scholar-ID linkage for every iTaukei lead/co-author, including scholars "
                "without Masters or PhD records."
            ),
            "Publications sheet schema (columns V, W added); V2 Panel B4 citation now sources the true bibliographic lead author.",
            actor,
        ],
        [
            f"B4-bib-lead-author-backfill-bibtex-{ts_id}",
            today,
            (
                f"Backfilled {resolved_count} publications' Bibliographic Lead Author (Last, First) and Bibliographic Author Count "
                f"from iTaukei-Academic-Research_14Aug2026-9pm.bib (author field only; edited volumes left unresolved). "
                f"Bibliographic Author Count is the true author total from the BibTeX record and is never inferred from "
                f"the iTaukei Authorship or Co-Auth Scholar IDs fields. {unresolved_count} publications remain unresolved "
                f"(edited volumes, proceedings, older items not in the .bib) and are listed in data/full-authors-unresolved.csv."
            ),
            f"Publications columns V, W populated for {resolved_count} rows; unresolved list at data/full-authors-unresolved.csv.",
            actor,
        ],
    ]

    # Append entries — use values.append so Sheets auto-extends the grid.
    gws(
        ["sheets", "spreadsheets", "values", "append"],
        params={
            "spreadsheetId": SPREADSHEET_ID,
            "range": "Change Log!A:E",
            "valueInputOption": "RAW",
            "insertDataOption": "INSERT_ROWS",
        },
        json_body={"values": entries},
    )
    print(f"  ✓ appended {len(entries)} Change Log rows")

    print("Done.")
    return 0


if __name__ == "__main__":
    sys.exit(main())
