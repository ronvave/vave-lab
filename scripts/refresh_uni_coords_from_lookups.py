#!/usr/bin/env python3
"""Sync canonical university coordinates from the Master Sheet 'Lookups' tab
into data/world-universities.json (plaintext). The Master Sheet is the source
of truth per Ron's instruction.

Flow:
1. Read Lookups!L4:P (rows below the header) from the Master Sheet.
2. Upsert into world-universities.json by university name, using the existing
   O_Uni→C_Uni alias map from master_b2_worldpoints (so Master-side name
   variants land on the correct WU record).
3. Report added / updated / unchanged rows.
4. After running, re-run scripts/master_b2_worldpoints.py so
   itaukei-master-worldpoints.json picks up the new coords.

Encrypt back to .enc separately with scripts/encrypt_data.py.
"""

from __future__ import annotations
import json
import os
import subprocess
import sys
from pathlib import Path

REPO = Path(__file__).resolve().parents[1]
WU_PATH = REPO / "data" / "world-universities.json"
SHEET_ID = "1nJvMWLS8jnCOKtRoqdDpEW3s3j9TSAclXBO1txVFxdg"
RANGE = "Lookups!L4:P500"


def read_lookups() -> list[dict]:
    params = json.dumps({
        "spreadsheetId": SHEET_ID,
        "range": RANGE,
        "valueRenderOption": "UNFORMATTED_VALUE",
    })
    proc = subprocess.run(
        ["gws", "sheets", "spreadsheets", "values", "get", "--params", params],
        check=True, capture_output=True, text=True,
    )
    payload = json.loads(proc.stdout)
    rows = []
    for row in payload.get("values", []):
        # pad
        row = list(row) + [""] * (5 - len(row))
        name, country, lng, lat, status = row[:5]
        if not name or lng == "" or lat == "":
            continue
        try:
            lng = float(lng)
            lat = float(lat)
        except (TypeError, ValueError):
            continue
        rows.append({
            "name": name.strip(),
            "country": (country or "").strip(),
            "lng": lng,
            "lat": lat,
            "status": (status or "").strip(),
        })
    return rows


# Master 'C_Uni' -> world-universities.json canonical name.
# Extend as new Master-side spellings emerge. Only add pairs that differ.
NAME_TO_WU = {
    # Common Master → WU aliases
    "University of Hawaiʻi at Mānoa": "University of Hawaii at Manoa",
    "University of Hawai'i at Mānoa": "University of Hawaii at Manoa",
    "University of Hawaiʻi at Manoa": "University of Hawaii at Manoa",
    "Japan Women’s University": "Japan Women's University",
    "University of New South Wales (ADFA)": "UNSW Canberra (ADFA)",
    "Universitas Atma Jaya Yogyakarta": "Atma Jaya University Yogyakarta",
    "Te Whare Wānanga o Awanuiārangi": "Te Whare Wananga o Awanuiarangi",
    "University of Occupational and Environmental Health, Japan":
        "University of Occupational and Environmental Health",
    "IMO International Maritime Law Institute": "IMO International Maritime Law Institute",
    "London School of Economics and Political Science":
        "London School of Economics and Political Science",
    "University College London": "University College London",
    "Loughborough University": "Loughborough University",
}


def canonical(name: str) -> str:
    """Best-effort normalize a Lookups name to the WU record it should upsert to."""
    return NAME_TO_WU.get(name.strip(), name.strip())


def main() -> int:
    if not WU_PATH.exists():
        print(f"[ERR] plaintext {WU_PATH} not found; decrypt first with scripts/decrypt_data.py")
        return 1

    wu = json.loads(WU_PATH.read_text())
    by_name = {u["name"]: u for u in wu["universities"]}

    lookups = read_lookups()
    print(f"[INFO] {len(lookups)} coord rows read from Lookups tab")

    added, updated, unchanged, skipped = [], [], [], []
    for row in lookups:
        target = canonical(row["name"])
        existing = by_name.get(target)
        loc = [row["lat"], row["lng"]]

        if existing is None:
            # New record: seed a minimal one so pipeline can map to a country.
            record = {
                "name": target,
                "country": row["country"],
                "location": loc,
                "source": "Master Sheet Lookups",
            }
            wu["universities"].append(record)
            by_name[target] = record
            added.append(target)
            continue

        old_loc = existing.get("location") or [None, None]
        if not old_loc or old_loc == [None, None]:
            existing["location"] = loc
            if not existing.get("country") and row["country"]:
                existing["country"] = row["country"]
            updated.append(target)
        elif abs(old_loc[0] - loc[0]) < 1e-6 and abs(old_loc[1] - loc[1]) < 1e-6:
            unchanged.append(target)
        else:
            # Coord already set in WU; keep WU value (WU is trusted city coord).
            skipped.append((target, old_loc, loc))

    WU_PATH.write_text(json.dumps(wu, indent=2, ensure_ascii=False) + "\n")

    print(f"[OK] added {len(added)}, filled coords for {len(updated)}, unchanged {len(unchanged)}")
    if added:
        print("     added: " + ", ".join(added))
    if updated:
        print("     filled: " + ", ".join(updated))
    if skipped:
        print(f"[WARN] {len(skipped)} names had different coords in WU vs Lookups (WU preserved):")
        for n, old, new in skipped[:12]:
            print(f"        {n}: WU={old} Lookups={new}")

    print("\n[NEXT] python3 scripts/master_b2_worldpoints.py")
    return 0


if __name__ == "__main__":
    sys.exit(main())
