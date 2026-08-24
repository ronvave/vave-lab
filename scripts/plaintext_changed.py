#!/usr/bin/env python3
"""Compare freshly-transformed Master-file plaintext against the previous
snapshot's decrypted plaintext and print the names that actually changed.

Why this exists
---------------
`scripts/encrypt_data.py` intentionally uses a fresh random salt per
`.enc` file (see the module docstring in that file for the rationale).
That means the encrypted bytes always differ across runs even when the
plaintext is byte-identical — so the refresh workflow used to commit
every 2 hours regardless of whether the Master file changed. Two-hourly
salt rewrites of `scholar-enrichment.json.enc` /
`scholar-insights-master.json.enc` also collided with in-flight Admin V2
saves and caused 409 sha-race errors.

The fix is to compare *plaintext* content and only re-encrypt files
whose plaintext bytes actually changed. Salt drift stays invisible to
the outside world: no `.enc` rewrite, no new git sha, no commit, no
GitHub Pages redeploy for uploaded readers, and Admin V2 modal shas stay
valid for the whole editing window.

Contract
--------
For each name given, this script compares:

    <curr-dir>/<name>   (freshly produced by master_file_transformer.py)
    <prev-dir>/<name>   (the previous run's decrypted snapshot)

and prints the names whose bytes differ, one per line. Missing prev
files are treated as changed (bootstrap / first run). Missing curr
files are an error.

Usage
-----
    python3 scripts/plaintext_changed.py \\
        --prev-dir=/tmp/prev \\
        --curr-dir=data \\
        itaukei-master-scholars.json \\
        itaukei-master-publications.json \\
        ...

Prints changed names to stdout; prints a human-readable summary to
stderr. Exit code is always 0 unless a *current* file is missing.

Design notes
------------
Compares raw bytes because JSON serialisation is deterministic in the
transformer (stable key order, no timestamps in the payload). If the
transformer ever starts embedding a `generated_at` timestamp we would
need to strip that before comparing; the transformer today does NOT do
that (verified 2026-08-24), and if it ever changes, a matching diff
filter belongs in this file, not in the workflow.
"""
from __future__ import annotations

import argparse
import sys
from pathlib import Path


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--prev-dir", required=True, help="Directory holding the previous run's decrypted plaintext")
    ap.add_argument("--curr-dir", required=True, help="Directory holding the just-transformed plaintext")
    ap.add_argument("names", nargs="+", help="File names to compare")
    args = ap.parse_args()

    prev_dir = Path(args.prev_dir)
    curr_dir = Path(args.curr_dir)

    changed: list[str] = []
    unchanged: list[str] = []
    missing_prev: list[str] = []
    missing_curr: list[str] = []

    for name in args.names:
        curr = curr_dir / name
        prev = prev_dir / name
        if not curr.exists():
            missing_curr.append(name)
            continue
        if not prev.exists():
            missing_prev.append(name)
            changed.append(name)
            continue
        if curr.read_bytes() == prev.read_bytes():
            unchanged.append(name)
        else:
            changed.append(name)

    # Human-readable summary on stderr
    print(
        f"plaintext_changed: {len(changed)} changed, "
        f"{len(unchanged)} unchanged, "
        f"{len(missing_prev)} first-run, "
        f"{len(missing_curr)} missing-current",
        file=sys.stderr,
    )
    if unchanged:
        print("  unchanged: " + ", ".join(unchanged), file=sys.stderr)
    if changed:
        print("  changed:   " + ", ".join(changed), file=sys.stderr)
    if missing_prev:
        print("  first-run: " + ", ".join(missing_prev), file=sys.stderr)
    if missing_curr:
        print("  MISSING CURRENT (fatal): " + ", ".join(missing_curr), file=sys.stderr)

    # Machine-readable list on stdout
    for name in changed:
        print(name)

    return 1 if missing_curr else 0


if __name__ == "__main__":
    sys.exit(main())
