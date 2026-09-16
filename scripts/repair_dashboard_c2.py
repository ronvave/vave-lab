"""One-off: repair Panel C2 on the Master Dashboard.

Adds a "Report" row inside both the All-authorship and iTaukei-associated
province tables, and rewrites the Non-provincial/Fiji (col S) and Unsure
(col T) formulas to use Research Geography instead of the legacy
Publications AL/AM flags.

Row layout BEFORE this script runs:
    r65 headers ('Publication type' | provinces | totals | Fiji-no-prov | Unsure | Total)
    r66 Journal Article    (all authorship)
    r67 Master's Thesis
    r68 PhD Thesis
    r69 Book Chapter
    r70 Book
    r71 Total              <- Report row will be inserted BEFORE this
    r72 Confederacy summary
    ...
    r76 header block (iTaukei table)
    r77 Confederacy header
    r78 Publication type header
    r79 Journal Article    (iTaukei-associated)
    r80 Master's Thesis
    r81 PhD Thesis
    r82 Book Chapter
    r83 Book
    r84 Total              <- Report row inserted BEFORE this (post-shift index = r85)
    r85 Confederacy summary

Row layout AFTER:
    r66-70 unchanged, r71 = Report (new), r72 = Total, r73 = confed summary,
    r77-r83 unchanged (they shifted from r76-82; header block shifted),
    r84 = Book (iTaukei), r85 = Report (new, iTaukei), r86 = Total (iTaukei).

For the Non-provincial/Fiji and Unsure columns we switch the calculation
source from Publications!AL/AM Yes flag to Research Geography
Fiji Province = "Fiji - no province specified" (or "Unsure") with the
existing verified predicate. The iTaukei subset formula additionally
joins Authorship + Researcher Authorship for iTaukei linkage.

Run:
    python3 scripts/repair_dashboard_c2.py           # dry-run summary
    python3 scripts/repair_dashboard_c2.py --apply   # actually write
"""

from __future__ import annotations

import argparse
import json
import subprocess
import sys

SPREADSHEET_ID = "1nJvMWLS8jnCOKtRoqdDpEW3s3j9TSAclXBO1txVFxdg"
DASHBOARD_SHEET_ID = 1002


def gws(command: list[str], params: dict | None = None, body: dict | None = None) -> dict:
    """Run a `gws` sub-command with JSON params/body, return parsed stdout."""
    cli = command[:]
    if params is not None:
        cli += ["--params", json.dumps(params)]
    if body is not None:
        cli += ["--json", json.dumps(body)]
    r = subprocess.run(cli, capture_output=True, text=True)
    if r.returncode != 0:
        sys.stderr.write(r.stderr + "\n")
        raise SystemExit(r.returncode)
    return json.loads(r.stdout) if r.stdout.strip() else {}


PROV_HEAD = "B$65"  # first named-province column header cell (before shift, we
                    # reference the header row directly which is row 65 both before
                    # and after — inserting a row *below* 65 does not shift 65).


def build_province_formula(prov_col: str, type_cell: str) -> str:
    """Canonical formula: distinct pubs in Research Geography, Fiji, verified,
    matching this province header + this pub-type row.
    """
    return (
        "=LET(x,IFNA(UNIQUE(FILTER("
        "'Research Geography'!$B$5:$B$2000,"
        "'Research Geography'!$E$5:$E$2000=\"Fiji\","
        f"'Research Geography'!$F$5:$F$2000={prov_col}$65,"
        "REGEXMATCH('Research Geography'!$L$5:$L$2000,\"^Verified\"),"
        "XLOOKUP('Research Geography'!$B$5:$B$2000,"
        "Publications!$A$5:$A$9999,Publications!$C$5:$C$9999,\"\")="
        f"{type_cell})),\"\"),SUMPRODUCT(N(x<>\"\")))"
    )


def build_province_itaukei_formula(prov_col: str, type_cell: str) -> str:
    """Canonical iTaukei-associated formula: same RG chain + join to
    Authorship OR Researcher Authorship for iTaukei linkage."""
    return (
        "=LET(x,IFNA(UNIQUE(FILTER("
        "'Research Geography'!$B$5:$B$2000,"
        "'Research Geography'!$E$5:$E$2000=\"Fiji\","
        f"'Research Geography'!$F$5:$F$2000={prov_col}$78,"
        "REGEXMATCH('Research Geography'!$L$5:$L$2000,\"^Verified\"),"
        "XLOOKUP('Research Geography'!$B$5:$B$2000,"
        "Publications!$A$5:$A$9999,Publications!$C$5:$C$9999,\"\")="
        f"{type_cell},"
        "(COUNTIF(Authorship!$D$5:$D$4996,'Research Geography'!$B$5:$B$2000)+"
        "COUNTIF('Researcher Authorship'!$D$5:$D$2000,'Research Geography'!$B$5:$B$2000))>0"
        ")),\"\"),SUMPRODUCT(N(x<>\"\")))"
    )


def build_nonprov_all(type_cell: str) -> str:
    """Non-provincial/Fiji all-authorship: RG Fiji Province = 'Fiji - no province specified'."""
    return (
        "=LET(x,IFNA(UNIQUE(FILTER("
        "'Research Geography'!$B$5:$B$2000,"
        "'Research Geography'!$E$5:$E$2000=\"Fiji\","
        "'Research Geography'!$F$5:$F$2000=\"Fiji - no province specified\","
        "REGEXMATCH('Research Geography'!$L$5:$L$2000,\"^Verified\"),"
        "XLOOKUP('Research Geography'!$B$5:$B$2000,"
        "Publications!$A$5:$A$9999,Publications!$C$5:$C$9999,\"\")="
        f"{type_cell})),\"\"),SUMPRODUCT(N(x<>\"\")))"
    )


def build_unsure_all(type_cell: str) -> str:
    """Unsure all-authorship: RG Fiji Province = 'Unsure' OR containing 'unresolved'."""
    return (
        "=LET(x,IFNA(UNIQUE(FILTER("
        "'Research Geography'!$B$5:$B$2000,"
        "'Research Geography'!$E$5:$E$2000=\"Fiji\","
        "('Research Geography'!$F$5:$F$2000=\"Unsure\")+"
        "('Research Geography'!$F$5:$F$2000=\"Unclassified\"),"
        "REGEXMATCH('Research Geography'!$L$5:$L$2000,\"^Verified\"),"
        "XLOOKUP('Research Geography'!$B$5:$B$2000,"
        "Publications!$A$5:$A$9999,Publications!$C$5:$C$9999,\"\")="
        f"{type_cell})),\"\"),SUMPRODUCT(N(x<>\"\")))"
    )


def build_nonprov_itaukei(type_cell: str) -> str:
    """Non-provincial/Fiji iTaukei-associated: as above + iTaukei authorship."""
    return (
        "=LET(x,IFNA(UNIQUE(FILTER("
        "'Research Geography'!$B$5:$B$2000,"
        "'Research Geography'!$E$5:$E$2000=\"Fiji\","
        "'Research Geography'!$F$5:$F$2000=\"Fiji - no province specified\","
        "REGEXMATCH('Research Geography'!$L$5:$L$2000,\"^Verified\"),"
        "XLOOKUP('Research Geography'!$B$5:$B$2000,"
        "Publications!$A$5:$A$9999,Publications!$C$5:$C$9999,\"\")="
        f"{type_cell},"
        "(COUNTIF(Authorship!$D$5:$D$4996,'Research Geography'!$B$5:$B$2000)+"
        "COUNTIF('Researcher Authorship'!$D$5:$D$2000,'Research Geography'!$B$5:$B$2000))>0"
        ")),\"\"),SUMPRODUCT(N(x<>\"\")))"
    )


def build_unsure_itaukei(type_cell: str) -> str:
    return (
        "=LET(x,IFNA(UNIQUE(FILTER("
        "'Research Geography'!$B$5:$B$2000,"
        "'Research Geography'!$E$5:$E$2000=\"Fiji\","
        "('Research Geography'!$F$5:$F$2000=\"Unsure\")+"
        "('Research Geography'!$F$5:$F$2000=\"Unclassified\"),"
        "REGEXMATCH('Research Geography'!$L$5:$L$2000,\"^Verified\"),"
        "XLOOKUP('Research Geography'!$B$5:$B$2000,"
        "Publications!$A$5:$A$9999,Publications!$C$5:$C$9999,\"\")="
        f"{type_cell},"
        "(COUNTIF(Authorship!$D$5:$D$4996,'Research Geography'!$B$5:$B$2000)+"
        "COUNTIF('Researcher Authorship'!$D$5:$D$2000,'Research Geography'!$B$5:$B$2000))>0"
        ")),\"\"),SUMPRODUCT(N(x<>\"\")))"
    )


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--apply", action="store_true", help="Actually write to the sheet.")
    args = ap.parse_args()

    # ------------------------------------------------------------------
    # Step 1 — Insert two blank rows (Report rows) at r71 and r85.
    # Google Sheets `insertDimension` uses HALF-OPEN 0-indexed ranges, so
    # insertBefore row 71 (1-indexed) = startIndex 70 (0-indexed).
    #
    # We insert TOP first (r71), then BOTTOM. If we insert bottom first,
    # the top row index doesn't shift; but if we insert top first, the
    # bottom row (originally r84) shifts to r85. We handle this by doing
    # them in a single batchUpdate with the bottom insertion listed FIRST
    # (higher row index) so both indexes are relative to the original layout.
    # ------------------------------------------------------------------
    requests = [
        # ---- Insert row before r84 (iTaukei Total) ----------------------
        {
            "insertDimension": {
                "range": {
                    "sheetId": DASHBOARD_SHEET_ID,
                    "dimension": "ROWS",
                    "startIndex": 83,  # 0-indexed row 83 = 1-indexed row 84
                    "endIndex": 84,
                },
                "inheritFromBefore": True,
            }
        },
        # ---- Insert row before r71 (all-authorship Total) ---------------
        {
            "insertDimension": {
                "range": {
                    "sheetId": DASHBOARD_SHEET_ID,
                    "dimension": "ROWS",
                    "startIndex": 70,
                    "endIndex": 71,
                },
                "inheritFromBefore": True,
            }
        },
    ]

    # After both inserts, the new layout is:
    #   r66-70  (unchanged) Journal Article..Book (all-auth)
    #   r71     NEW Report row (all-auth)
    #   r72     Total (was r71); SUM auto-extended to include r71
    #   r73     Confederacy summary (was r72); '=S71' auto-updated to '=S72'
    #   ...
    #   r77-83  (all-auth block header + iTaukei block header + iTaukei table
    #            first 5 type rows shifted down by 1 from original r76-82)
    #   r79-83  iTaukei Journal..Book (was r79-83; unchanged relative)
    #   r85     NEW Report row (iTaukei)
    #   r86     Total (was r84)
    #   r87     Confederacy summary (was r85)
    #
    # Because we're using `inheritFromBefore=True`, the inserted rows copy
    # the formatting AND the formulas from the previous row (Book). We now
    # explicitly overwrite the inserted rows with the correct Report
    # content, and also rewrite the Non-provincial/Fiji + Unsure columns
    # on rows 66-71 and 79-85 to use RG.
    apply_updates(requests, args.apply, note="Insert two Report rows")

    # ------------------------------------------------------------------
    # Step 2 — Overwrite the newly-inserted Report rows and update S/T
    # cells across BOTH tables to use RG instead of Publications!AL/AM.
    # ------------------------------------------------------------------

    named_cols = [
        # (col_letter, header_ref_col_letter)
        ("B", "B"), ("C", "C"), ("D", "D"), ("E", "E"), ("F", "F"),
        ("H", "H"), ("I", "I"), ("J", "J"), ("K", "K"), ("L", "L"),
        ("N", "N"), ("O", "O"), ("P", "P"), ("Q", "Q"),
    ]

    # Row 71 (all-authorship Report). $A71 = "Report".
    row71 = ["Report"]  # A71
    for col_letter, prov_ref in named_cols[:5]:  # B..F (Burebasaga)
        row71.append(build_province_formula(prov_ref, "$A71"))
    row71.append("=SUM(B71:F71)")  # G71 Burebasaga TOTAL
    for col_letter, prov_ref in named_cols[5:10]:  # H..L (Kubuna)
        row71.append(build_province_formula(prov_ref, "$A71"))
    row71.append("=SUM(H71:L71)")  # M71 Kubuna TOTAL
    for col_letter, prov_ref in named_cols[10:14]:  # N..Q (Tovata)
        row71.append(build_province_formula(prov_ref, "$A71"))
    row71.append("=SUM(N71:Q71)")  # R71 Tovata TOTAL
    row71.append(build_nonprov_all("$A71"))  # S71 Non-provincial/Fiji
    row71.append(build_unsure_all("$A71"))   # T71 Unsure
    row71.append("=G71+M71+R71+S71+T71")     # U71 Total

    # Row 85 (iTaukei-associated Report). $A85 = "Report".
    row85 = ["Report"]  # A85
    for col_letter, prov_ref in named_cols[:5]:
        row85.append(build_province_itaukei_formula(prov_ref, "$A85"))
    row85.append("=SUM(B85:F85)")
    for col_letter, prov_ref in named_cols[5:10]:
        row85.append(build_province_itaukei_formula(prov_ref, "$A85"))
    row85.append("=SUM(H85:L85)")
    for col_letter, prov_ref in named_cols[10:14]:
        row85.append(build_province_itaukei_formula(prov_ref, "$A85"))
    row85.append("=SUM(N85:Q85)")
    row85.append(build_nonprov_itaukei("$A85"))
    row85.append(build_unsure_itaukei("$A85"))
    row85.append("=G85+M85+R85+S85+T85")

    # Non-provincial/Fiji + Unsure for existing pub-type rows in all-auth
    # table (rows 66-70; these were legacy AL/AM COUNTIFS — rewrite to RG).
    st_updates_all = []
    for r in range(66, 71):  # 66..70 inclusive
        st_updates_all.append((f"S{r}", build_nonprov_all(f"$A{r}")))
        st_updates_all.append((f"T{r}", build_unsure_all(f"$A{r}")))

    # Same for iTaukei table (rows 79-83 in the new layout — they were
    # 79-83 before too because they shifted by 0 relative to the r71
    # insertion... wait no. Let me re-think:
    #
    # ORIGINAL   -> AFTER r84 insert -> AFTER r71 insert
    # r76 hdr    -> r76 hdr          -> r77 hdr
    # r77 hdr    -> r77 hdr          -> r78 hdr
    # r78 hdr    -> r78 hdr          -> r79 hdr
    # r79 JA it  -> r79 JA it        -> r80 JA it
    # r80 MT it  -> r80 MT it        -> r81 MT it
    # r81 PhD it -> r81 PhD it       -> r82 PhD it
    # r82 BC it  -> r82 BC it        -> r83 BC it
    # r83 Book it-> r83 Book it      -> r84 Book it
    # r84 Total  -> r85 Total        -> r86 Total
    # r85 summary-> r86 summary      -> r87 summary
    #
    # And we already inserted a NEW blank Report row at 84 (before the r71
    # insertion). After the r71 insertion it shifts to r85. So r85 is the
    # iTaukei Report row.
    #
    # iTaukei pub-type rows (Journal..Book) become r80..r84.
    #
    # AND the iTaukei header for the Publication-type row moves from r78
    # to r79. So the province formulas in r80-r84 reference $A80..$A84 and
    # header at row 79 (B$79 etc), NOT B$78.

    st_updates_it = []
    for r in range(80, 85):  # 80..84 inclusive
        st_updates_it.append((f"S{r}", build_nonprov_itaukei(f"$A{r}")))
        st_updates_it.append((f"T{r}", build_unsure_itaukei(f"$A{r}")))

    # Also: the pre-existing named-province formulas in the iTaukei table
    # currently reference "B$78" (header row before shift). After both
    # inserts the header row is r79 — Google Sheets does NOT auto-update
    # $-anchored row refs across `insertDimension` when the reference is
    # to a row *at or above* the insertion, but the insertion at r71
    # (which is above the iTaukei block) *does* shift references to
    # rows >71 by +1. So B$78 auto-becomes B$79. Good.

    # Apply all cell updates in one batchUpdate valueInputOption='USER_ENTERED'.
    data = []
    for col_idx, val in enumerate(row71):
        col_letter = colnum_to_letter(col_idx + 1)  # A=1
        data.append({"range": f"Dashboard!{col_letter}71", "values": [[val]]})
    for col_idx, val in enumerate(row85):
        col_letter = colnum_to_letter(col_idx + 1)
        data.append({"range": f"Dashboard!{col_letter}85", "values": [[val]]})
    for cell, val in st_updates_all + st_updates_it:
        data.append({"range": f"Dashboard!{cell}", "values": [[val]]})

    if args.apply:
        result = gws(
            ["gws", "sheets", "spreadsheets", "values", "batchUpdate"],
            params={"spreadsheetId": SPREADSHEET_ID},
            body={"valueInputOption": "USER_ENTERED", "data": data},
        )
        print(f"Applied {len(data)} cell updates. Totals updated: "
              f"{result.get('totalUpdatedCells', '?')} cells.")
    else:
        print(f"[DRY RUN] Would apply {len(data)} cell updates:")
        for d in data[:6]:
            print(f"  {d['range']}: {d['values'][0][0][:120]}")
        print(f"  ... and {len(data) - 6} more")


def apply_updates(requests, apply: bool, note: str) -> None:
    if apply:
        gws(
            ["gws", "sheets", "spreadsheets", "batchUpdate"],
            params={"spreadsheetId": SPREADSHEET_ID},
            body={"requests": requests},
        )
        print(f"✓ {note}")
    else:
        print(f"[DRY RUN] Would send {len(requests)} batchUpdate requests: {note}")


def colnum_to_letter(n: int) -> str:
    out = ""
    while n:
        n, rem = divmod(n - 1, 26)
        out = chr(65 + rem) + out
    return out


if __name__ == "__main__":
    main()
