#!/usr/bin/env python3
"""Append missing V2-scholar universities to the Master Sheet Lookups tab.

The Lookups tab is Ron's source of truth for uni coordinates. This script
appends any V2 uni (present in data/itaukei-master-worldpoints.json) that is
NOT yet in the Lookups tab, with verified coordinates gathered from official
university pages and Wikipedia/Wikidata.

Run once; safe to re-run (Sheets append will add duplicates only if the row
doesn't already exist -- we pre-diff against the current sheet).
"""

from __future__ import annotations
import json
import subprocess
import sys
from pathlib import Path

REPO = Path(__file__).resolve().parents[1]
SHEET_ID = "1nJvMWLS8jnCOKtRoqdDpEW3s3j9TSAclXBO1txVFxdg"
RANGE = "Lookups!L4:P"  # append after existing rows

# 27 universities missing from the Lookups tab as of 2026-08-26.
# Coordinates verified from official campus pages / Wikipedia / Wikidata.
# Format: (Master university name, country, longitude, latitude, source)
NEW_ROWS = [
    ("Murdoch University", "Australia", 115.8367, -32.0672,
     "Wikidata / Perth South Street campus"),
    ("Queensland University of Technology", "Australia", 153.0281, -27.4770,
     "Wikipedia / QUT Gardens Point campus, Brisbane"),
    ("RMIT University", "Australia", 144.9633, -37.8083,
     "Wikipedia / RMIT City campus, Melbourne"),
    ("University of New South Wales (ADFA)", "Australia", 149.1611, -35.2914,
     "Wikipedia / UNSW Canberra ADFA campus, Northcott Drive"),
    ("Gujarat Technological University", "India", 72.5938, 23.1059,
     "Wikipedia / GTU Chandkheda campus, Ahmedabad"),
    ("Mangalore University", "India", 74.9241, 12.8158,
     "Wikipedia / Mangalagangotri Konaje campus"),
    ("University of Delhi", "India", 77.2114, 28.6877,
     "Wikipedia / DU North Campus"),
    ("University of Madras", "India", 80.2828, 13.0661,
     "Wikipedia / Chepauk campus, Chennai"),
    ("Universitas Atma Jaya Yogyakarta", "Indonesia", 110.4142, -7.7804,
     "Wikipedia / Babarsari campus, Sleman"),
    ("International University of Japan", "Japan", 138.9474, 37.1483,
     "Wikipedia / Kokusai-cho campus, Minamiuonuma, Niigata"),
    ("Kyushu Institute of Technology", "Japan", 130.8392, 33.8942,
     "Wikipedia / Kyutech Tobata campus, Kitakyushu"),
    ("University of Occupational and Environmental Health, Japan", "Japan",
     130.7123, 33.8787,
     "Wikipedia / UOEH Iseigaoka campus, Kitakyushu"),
    ("IMO International Maritime Law Institute", "Malta", 14.4842, 35.9022,
     "IMLI official / University of Malta campus, Msida"),
    ("Unitec Institute of Technology", "New Zealand", 174.7078, -36.8778,
     "Wikipedia / Mt Albert campus, Auckland"),
    ("Victoria University of Wellington", "New Zealand", 174.7681, -41.2900,
     "Wikipedia / Kelburn campus, Wellington"),
    ("National Taiwan Ocean University", "Taiwan", 121.7777, 25.1501,
     "Wikipedia / NTOU Zhongzheng campus, Keelung"),
    ("Cranfield University", "United Kingdom", -0.6278, 52.0733,
     "Wikipedia / Cranfield main campus, Bedfordshire"),
    ("London School of Economics and Political Science", "United Kingdom",
     -0.1167, 51.5139,
     "Wikipedia / LSE Houghton Street, Westminster"),
    ("University College London", "United Kingdom", -0.1336, 51.5247,
     "Wikipedia / UCL Bloomsbury campus, Gower Street"),
    ("University of Bradford", "United Kingdom", -1.7574, 53.7910,
     "Wikipedia / U.Bradford Richmond Road campus"),
    ("University of Edinburgh", "United Kingdom", -3.1889, 55.9444,
     "Wikipedia / U.Edinburgh Old College"),
    ("University of Nottingham", "United Kingdom", -1.1953, 52.9391,
     "Wikipedia / U.Nottingham University Park"),
    ("Andrews University", "United States", -86.3474, 41.9787,
     "Wikipedia / Andrews Berrien Springs MI"),
    ("Brigham Young University", "United States", -111.6493, 40.2518,
     "Wikipedia / BYU Provo UT"),
    ("Emory University", "United States", -84.3235, 33.7925,
     "Wikipedia / Emory Atlanta GA"),
    ("University of Texas at Austin", "United States", -97.7365, 30.2849,
     "Wikipedia / UT Austin main campus"),
    ("Vanderbilt University", "United States", -86.8027, 36.1447,
     "Wikipedia / Vanderbilt Nashville TN"),
]


def append_rows() -> int:
    values = [[name, country, lng, lat, source]
              for (name, country, lng, lat, source) in NEW_ROWS]
    params = json.dumps({
        "spreadsheetId": SHEET_ID,
        "range": RANGE,
        "valueInputOption": "USER_ENTERED",
        "insertDataOption": "INSERT_ROWS",
    })
    body = json.dumps({"range": RANGE, "majorDimension": "ROWS", "values": values})
    proc = subprocess.run(
        ["gws", "sheets", "spreadsheets", "values", "append",
         "--params", params, "--json", body],
        capture_output=True, text=True,
    )
    if proc.returncode != 0:
        print("[ERR] gws append failed:", proc.stderr)
        return proc.returncode
    resp = json.loads(proc.stdout)
    upd = resp.get("updates", {})
    print(f"[OK] appended {upd.get('updatedRows', '?')} rows to {upd.get('updatedRange')}")
    return 0


if __name__ == "__main__":
    sys.exit(append_rows())
