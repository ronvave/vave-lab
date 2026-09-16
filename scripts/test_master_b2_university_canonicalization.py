#!/usr/bin/env python3
"""Regression tests for Panel B2 university canonicalization."""
from pathlib import Path
import sys
sys.path.insert(0, str(Path(__file__).resolve().parent))
from master_b2_worldpoints import (
    canonicalize_university_name, university_match_key, build_worldpoints
)

def row(did, university, stage):
    return {
        "Degree ID": did, "Scholar ID": "TON-" + did,
        "Scholar Name": "Scholar " + did, "Degree Stage": stage,
        "C_Uni name": university, "Country": "New Zealand",
        "Completion Status": "Completed"
    }

assert canonicalize_university_name(
    "Te Herenga Waka—Victoria University of Wellington"
) == "Victoria University of Wellington"
assert university_match_key("The University of Auckland (UOA)") == \
       university_match_key("University of Auckland")

payload, excluded = build_worldpoints([
    row("1", "Victoria University of Wellington", "Masters"),
    row("2", "Te Herenga Waka—Victoria University of Wellington", "PhD"),
], Path(__file__).resolve().parent.parent)
assert not excluded
points = payload["worldPoints"]
assert len(points) == 1
assert points[0]["university"] == "Victoria University of Wellington"
assert len(points[0]["mastersScholars"]) == 1
assert len(points[0]["phdScholars"]) == 1
assert payload["totals"]["universities"] == 1
assert payload["totals"]["total"] == 2
print("Panel B2 university canonicalization: PASS")
