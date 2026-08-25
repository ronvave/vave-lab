"""Fixups after repair_dashboard_c2.py:

1. Correct the iTaukei Report row (r85) — the province formulas hard-coded
   the pre-insertion header row (`B$78`) instead of the post-insertion one
   (`B$79`).
2. Extend the Total-row SUM ranges on r72 and r86 to include the new
   Report row (Google Sheets did NOT auto-extend `=SUM(B66:B70)` when the
   Report row was inserted at r71 because the Total was BELOW the range).
"""

import json
import subprocess
import sys

SPREADSHEET_ID = "1nJvMWLS8jnCOKtRoqdDpEW3s3j9TSAclXBO1txVFxdg"


def gws(command, params=None, body=None):
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


def build_it_prov(prov_ref, type_cell):
    return (
        "=LET(x,IFNA(UNIQUE(FILTER("
        "'Research Geography'!$B$5:$B$2000,"
        "'Research Geography'!$E$5:$E$2000=\"Fiji\","
        f"'Research Geography'!$F$5:$F$2000={prov_ref}$79,"
        "REGEXMATCH('Research Geography'!$L$5:$L$2000,\"^Verified\"),"
        "XLOOKUP('Research Geography'!$B$5:$B$2000,"
        "Publications!$A$5:$A$9999,Publications!$C$5:$C$9999,\"\")="
        f"{type_cell},"
        "(COUNTIF(Authorship!$D$5:$D$4996,'Research Geography'!$B$5:$B$2000)+"
        "COUNTIF('Researcher Authorship'!$D$5:$D$2000,'Research Geography'!$B$5:$B$2000))>0"
        ")),\"\"),SUMPRODUCT(N(x<>\"\")))"
    )


def main():
    named = [("B",), ("C",), ("D",), ("E",), ("F",),
             ("H",), ("I",), ("J",), ("K",), ("L",),
             ("N",), ("O",), ("P",), ("Q",)]

    data = []

    # ------------------------------------------------------------------
    # Fix 1: iTaukei Report row (r85). Change hard-coded $78 → $79.
    # ------------------------------------------------------------------
    for (col,) in named:
        data.append({
            "range": f"Dashboard!{col}85",
            "values": [[build_it_prov(col, "$A85")]],
        })

    # ------------------------------------------------------------------
    # Fix 2: Total row SUM ranges. All-auth Total is at r72; iTaukei
    # Total is at r86. Extend each SUM to include the Report row.
    # ------------------------------------------------------------------
    total_cols_all = ["B", "C", "D", "E", "F", "G", "H", "I", "J", "K", "L",
                      "M", "N", "O", "P", "Q", "R", "S", "T", "U"]
    for col in total_cols_all:
        data.append({
            "range": f"Dashboard!{col}72",
            "values": [[f"=SUM({col}66:{col}71)"]],
        })
    for col in total_cols_all:
        data.append({
            "range": f"Dashboard!{col}86",
            "values": [[f"=SUM({col}80:{col}85)"]],
        })

    result = gws(
        ["gws", "sheets", "spreadsheets", "values", "batchUpdate"],
        params={"spreadsheetId": SPREADSHEET_ID},
        body={"valueInputOption": "USER_ENTERED", "data": data},
    )
    print(f"Applied {len(data)} cell fixups. Updated: {result.get('totalUpdatedCells', '?')} cells.")


if __name__ == "__main__":
    main()
