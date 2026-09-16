#!/usr/bin/env python3
"""Compute % drift between two aggregates snapshots.

Used by the refresh workflow to decide whether to write a full commit
message ("Auto-refresh: ...") or a heartbeat commit ("chore: heartbeat").
Threshold matches the Zotero workflow: 2%.
"""
from __future__ import annotations

import argparse
import json
import sys
from pathlib import Path


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--prev", required=True)
    ap.add_argument("--curr", required=True)
    ap.add_argument("--output", default="/tmp/diff.txt")
    ap.add_argument("--pct-file", default="/tmp/diff_pct.txt")
    args = ap.parse_args()

    prev_path = Path(args.prev)
    curr_path = Path(args.curr)
    if not prev_path.exists() or not curr_path.exists():
        Path(args.pct_file).write_text("100")
        Path(args.output).write_text("First run — no previous snapshot\n")
        print("No previous snapshot; treat as 100% delta")
        return 0

    prev = json.loads(prev_path.read_text())
    curr = json.loads(curr_path.read_text())

    keys = ["scholars", "publications_total", "authorship_links",
            "grad_degree_episodes", "publications_headline_five",
            "publications_itaukei_associated_headline"]

    max_pct = 0.0
    lines = []
    for k in keys:
        p = prev.get("totals", {}).get(k, 0)
        c = curr.get("totals", {}).get(k, 0)
        if p == 0:
            pct = 100.0 if c else 0.0
        else:
            pct = 100.0 * abs(c - p) / p
        max_pct = max(max_pct, pct)
        lines.append(f"  {k}: {p} → {c} ({pct:+.2f}%)")

    Path(args.pct_file).write_text(f"{max_pct:.2f}")
    Path(args.output).write_text("\n".join(lines) + "\n")
    print(f"Max drift: {max_pct:.2f}%")
    for line in lines:
        print(line)
    return 0


if __name__ == "__main__":
    sys.exit(main())
