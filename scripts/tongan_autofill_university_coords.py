#!/usr/bin/env python3
"""Autofill missing Tongan Master university coordinates via Nominatim.

Every refresh compares canonical universities in Graduate Degrees with
Lookups!L:P. Missing names (or names with blank/invalid coordinates) are
geocoded conservatively and written back to Lookups. Only results classified
as a university/college are accepted; unresolved names remain blank for human
review rather than falling back to a city centre.
"""
from __future__ import annotations

import json
import os
import time
import urllib.parse
import urllib.request
from datetime import date

from google.oauth2 import service_account
from googleapiclient.discovery import build

SHEET_ID = "1lh6wOFcg2GiFe2YylgxM5cvLOdumdbCrHDLQk87rjRI"
SCOPES = ["https://www.googleapis.com/auth/spreadsheets"]
USER_AGENT = "vave-lab-tongan-university-geocoder/1.0 (research dashboard)"


def valid_coord(lng, lat) -> bool:
    try:
        return -180 <= float(lng) <= 180 and -90 <= float(lat) <= 90
    except (TypeError, ValueError):
        return False


def geocode(name: str, country: str):
    query = f"{name}, {country}" if country else name
    url = "https://nominatim.openstreetmap.org/search?" + urllib.parse.urlencode({
        "q": query, "format": "jsonv2", "limit": 5, "addressdetails": 1,
    })
    req = urllib.request.Request(url, headers={"User-Agent": USER_AGENT})
    with urllib.request.urlopen(req, timeout=30) as response:
        results = json.load(response)
    for hit in results:
        category = str(hit.get("category") or hit.get("class") or "").lower()
        kind = str(hit.get("type") or "").lower()
        if category == "amenity" and kind in {"university", "college"}:
            return float(hit["lon"]), float(hit["lat"]), hit.get("display_name", "")
    return None


def main() -> int:
    info = json.loads(os.environ["GOOGLE_SERVICE_ACCOUNT_JSON"])
    creds = service_account.Credentials.from_service_account_info(info, scopes=SCOPES)
    sheets = build("sheets", "v4", credentials=creds, cache_discovery=False).spreadsheets()
    values = sheets.values().batchGet(
        spreadsheetId=SHEET_ID,
        ranges=["'Graduate Degrees'!H5:J1000", "Lookups!L5:P1000"],
    ).execute().get("valueRanges", [])
    degrees = values[0].get("values", []) if values else []
    lookup_rows = values[1].get("values", []) if len(values) > 1 else []

    needed: dict[str, str] = {}
    for row in degrees:
        name = str(row[0] if len(row) > 0 else "").strip()
        country = str(row[2] if len(row) > 2 else "").strip()
        if name:
            needed.setdefault(name, country)

    lookup: dict[str, tuple[int, list]] = {}
    for offset, row in enumerate(lookup_rows, start=5):
        name = str(row[0] if row else "").strip()
        if name:
            lookup[name] = (offset, row)

    writes = []
    next_row = max([row for row, _ in lookup.values()] + [4]) + 1
    for name, country in sorted(needed.items()):
        existing = lookup.get(name)
        if existing:
            row_num, row = existing
            lng = row[2] if len(row) > 2 else ""
            lat = row[3] if len(row) > 3 else ""
            if valid_coord(lng, lat):
                continue
        else:
            row_num = next_row
            next_row += 1

        hit = geocode(name, country)
        time.sleep(1.1)  # Nominatim public-use rate limit
        if not hit:
            print(f"[WARN] no university-grade geocode result: {name} ({country})")
            continue
        lng, lat, display = hit
        source = f"OpenStreetMap Nominatim auto-resolved {date.today().isoformat()}; {display}"
        writes.append({"range": f"Lookups!L{row_num}:P{row_num}", "values": [[name, country, lng, lat, source]]})
        print(f"[OK] {name}: {lat}, {lng}")

    if writes:
        sheets.values().batchUpdate(
            spreadsheetId=SHEET_ID,
            body={"valueInputOption": "USER_ENTERED", "data": writes},
        ).execute()
    print(f"[OK] university coordinate autofill wrote {len(writes)} row(s)")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
