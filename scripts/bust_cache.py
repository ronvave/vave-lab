#!/usr/bin/env python3
"""Content-hash cache-busting for the vave-lab static site.

Why this exists
---------------
GitHub Pages sends long-lived `Cache-Control` headers on `js/*.js` and
`css/*.css`, so a returning visitor can keep running stale JavaScript
against a freshly-updated `.html`. That mismatch is exactly what caused
the July 2026 "Fiji click zooms to Sapporo" incident — the browser had
new HTML (with the KPI tile row) but the old `itaukei-database.js`
under `?v=20260712-09` still in the disk cache.

Historically the site used a `?v=YYYYMMDD-NN` query string that had to
be bumped by hand on every JS/CSS edit. That never survived contact
with real edits: several files were unversioned entirely, and the ones
that were versioned only got bumped when the human editor remembered.

This script fixes that by replacing every hand-maintained version
string with a hash of the referenced file's bytes:

    <script src="js/itaukei-database.js?v=a1b2c3d4">

The hash re-computes automatically whenever the file changes, so any
edit to `js/itaukei-database.js` produces a new URL and forces every
browser (including cached ones) to refetch.

Coverage
--------
Rewrites references matching either shape (with any existing `?v=...`
query):

    <script src="js/<path>"[ ...]></script>
    <link ... href="css/<path>"[ ...]/>

across every `*.html` at the repo root. Vendor/CDN URLs (anything with
`http://` or `https://`) are ignored.

Usage
-----
    # Update every HTML file in-place
    python3 scripts/bust_cache.py

    # Fail (exit 1) if anything is out of date — used in CI + the
    # pre-commit hook so stale hashes cannot ship
    python3 scripts/bust_cache.py --check

    # Only look at specific HTML files (for the pre-commit hook)
    python3 scripts/bust_cache.py --check path/to/foo.html

Exit codes
----------
    0  all hashes up to date, or --check passed
    1  --check found stale/missing hashes
    2  a referenced JS/CSS file does not exist on disk
"""
from __future__ import annotations

import argparse
import hashlib
import re
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent

# Match <script src="js/..."> and <link ... href="css/...">. The `?v=...`
# suffix, if present, is captured separately so we can drop it before
# appending the fresh hash. Only local paths ("js/..." or "css/...") are
# rewritten — vendor CDNs are untouched.
SCRIPT_RE = re.compile(
    r'(<script\b[^>]*\bsrc=")(js/[^"?#]+)(\?v=[^"]*)?(")',
    re.IGNORECASE,
)
LINK_RE = re.compile(
    r'(<link\b[^>]*\bhref=")(css/[^"?#]+)(\?v=[^"]*)?(")',
    re.IGNORECASE,
)


def _hash_file(rel_path: str) -> str:
    """Return the first 8 hex chars of sha256(file_bytes)."""
    p = ROOT / rel_path
    if not p.is_file():
        print(f"[bust_cache] ERROR: {rel_path} not found on disk", file=sys.stderr)
        sys.exit(2)
    h = hashlib.sha256(p.read_bytes()).hexdigest()
    return h[:8]


def _rewrite(html: str) -> str:
    def sub_script(m: re.Match) -> str:
        pre, path, _old_v, post = m.group(1), m.group(2), m.group(3), m.group(4)
        return f"{pre}{path}?v={_hash_file(path)}{post}"

    def sub_link(m: re.Match) -> str:
        pre, path, _old_v, post = m.group(1), m.group(2), m.group(3), m.group(4)
        return f"{pre}{path}?v={_hash_file(path)}{post}"

    html = SCRIPT_RE.sub(sub_script, html)
    html = LINK_RE.sub(sub_link, html)
    return html


def _targets(argv: list[str]) -> list[Path]:
    if argv:
        return [ROOT / a for a in argv]
    return sorted(ROOT.glob("*.html"))


def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    ap.add_argument(
        "--check",
        action="store_true",
        help="Do not write. Exit 1 if any HTML would change.",
    )
    ap.add_argument("html", nargs="*", help="Specific HTML files (default: all *.html)")
    args = ap.parse_args()

    stale: list[str] = []
    changed: list[str] = []

    for path in _targets(args.html):
        if not path.is_file():
            continue
        original = path.read_text(encoding="utf-8")
        updated = _rewrite(original)
        if updated == original:
            continue
        if args.check:
            stale.append(str(path.relative_to(ROOT)))
        else:
            path.write_text(updated, encoding="utf-8")
            changed.append(str(path.relative_to(ROOT)))

    if args.check:
        if stale:
            print(
                "[bust_cache] stale cache-bust hashes in:\n  "
                + "\n  ".join(stale)
                + "\nRun `python3 scripts/bust_cache.py` and commit the result.",
                file=sys.stderr,
            )
            return 1
        print("[bust_cache] all hashes up to date.")
        return 0

    if changed:
        print("[bust_cache] rewrote:\n  " + "\n  ".join(changed))
    else:
        print("[bust_cache] no changes.")
    return 0


if __name__ == "__main__":
    sys.exit(main())
