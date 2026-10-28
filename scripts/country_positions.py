"""University positions snapshot for a country dashboard (Fiji, Tonga).

Reads the country's Positions sheet (header row 4, data from row 5), keeps
rows for scholars on the dashboard roster, publishes only allow-listed
fields, and tags each row with the same canonical roles the regional
dashboard uses (scripts/regional_positions.py), so country and regional
counts agree.

Never published: Evidence / Notes, Source URL, Last Verified.
"""
from __future__ import annotations

import re
from datetime import datetime, timezone

import regional_positions as rp

# Confidentiality gate: only these sheet columns leave the Master file.
POSITION_PUBLIC_FIELDS = [
    "Position ID",
    "Scholar ID",
    "Institution",
    "Country",
    "Department / Unit",
    "Academic / Professional Title (verbatim)",
    "Standardized Academic Rank",
    "Leadership Title (verbatim)",
    "Standardized Leadership Category",
    "Role Status",
    "Start Year",
    "End Year",
]


def _s(v) -> str:
    return re.sub(r"\s+", " ", str(v or "")).strip()


def hidden(v) -> bool:
    """Positions!'Public Display Approved' hides a position from scholar cards
    only when it is explicitly FALSE / No. Blank means shown."""
    if v is False:
        return True
    return _s(v).lower() in ("false", "no", "n", "0")


def _gender(v) -> str:
    v = _s(v).lower()
    if v in ("female", "f", "woman", "women", "fefine", "marama"):  # Tongan: Fefine / Tangata
        return "f"
    if v in ("male", "m", "man", "men", "tangata", "turaga"):
        return "m"
    return ""


def build(position_dicts: list[dict], scholars: list[dict], source: str, generator: str) -> dict:
    """position_dicts: Positions sheet rows as dicts (header row 4).
    scholars: the dashboard's already-filtered Scholars list."""
    roster = {}
    for s in scholars:
        sid = _s(s.get("Scholar ID")).upper()
        if sid:
            roster[sid] = dict(n=rp._disp(_s(s.get("Scholar Name") or s.get("Display Name"))), g=_gender(s.get("Gender")))
    rows = []
    for d in position_dicts:
        pub = {k: _s(d.get(k)) for k in POSITION_PUBLIC_FIELDS}
        sid = pub["Scholar ID"].upper()
        if not pub["Position ID"] or sid not in roster:
            continue
        verb, std, ltit = pub["Academic / Professional Title (verbatim)"], pub["Standardized Academic Rank"], pub["Leadership Title (verbatim)"]
        inst, dept = pub["Institution"], pub["Department / Unit"]
        status = pub["Role Status"].lower()
        current = status.startswith("current") or status in ("true", "yes", "y")
        he = bool(rp.HE.search(inst)) or bool(rp.HE.search(dept))
        leads, rank = rp.classify(dict(verb=verb, std=std, ltit=ltit, inst=inst, he=he))
        row = dict(
            id=pub["Position ID"], sid=sid,
            title=verb or std, lead=ltit if ltit and ltit.lower() not in verb.lower() else "",
            inst=inst, country=pub["Country"], dept=dept,
            cur=current, start=pub["Start Year"], end=pub["End Year"],
            roles=leads + ([rank] if rank else []),
        )
        # Kept in the snapshot so the Update info form can list it, but not
        # shown on the scholar card (the scholar unticked it).
        if hidden(d.get("Public Display Approved")):
            row["hide"] = True
        rows.append(row)
    used = {r["sid"] for r in rows}
    return dict(
        _meta=dict(
            source=source, generator=generator,
            generatedAt=datetime.now(timezone.utc).isoformat(),
            note="Positions sheet rows for scholars on this dashboard's roster. Roles use the regional dashboard's classifier; leadership counts only at higher-education institutions.",
        ),
        lead=[[k, label] for k, label, _ in rp.LEAD],
        rank=[[k, label] for k, label, _ in rp.RANK],
        roster=len(roster),
        scholars={sid: roster[sid] for sid in sorted(used)},
        gender={g: sum(1 for v in roster.values() if v["g"] == g) for g in ("f", "m")},
        rows=rows,
    )
