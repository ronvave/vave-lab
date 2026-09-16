#!/usr/bin/env python3
"""
Merge LLM-generated per-scholar enrichments into data/scholar-insights.json.

Companion to build_scholar_insights.py. That script builds keywords/summaries
from publication titles via rule-based n-grams (offline, cheap). This script
takes the same insights file and OVERLAYS admin/LLM-generated entries onto it,
so the card renderer picks up the richer content.

Enrichment JSON schema — /tmp/scholar_enrichments/<slug>.json
{
  "name": "Last, First",
  "keywords": ["...", "...", ...],       # 4-8 diverse
  "summary": "<p-safe html with <a href=...> inline links>",
  "summaryFormat": "html",
  "summarySources": [                     # 2+ authoritative sources
    {"title": "...", "url": "https://..."},
    ...
  ],
  "enrichmentSource": "llm-web-search",
  "enrichmentModel": "...",
  "enrichmentDate": "ISO8601"
}

Merge rules
-----------
* NEVER overwrite an entry with source="admin-paste" or source="admin-approved".
* NEVER overwrite an entry that already has summaryFormat="html" from a prior
  admin/LLM run UNLESS --force is passed.
* Preserve the existing entry's "signature", "publicationCount", "regeneratedAt"
  if present (they belong to the offline builder and should not change).

Usage
-----
    python3 scripts/enrich_scholar_insights.py --enrichments-dir /tmp/scholar_enrichments
    VAVELAB_PASSCODE=... python3 scripts/enrich_scholar_insights.py --reencrypt
"""
from __future__ import annotations
import argparse
import json
import os
import subprocess
import sys
from datetime import datetime, timezone
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
DATA = ROOT / "data"
INSIGHTS_PATH = DATA / "scholar-insights.json"


def merge(enrichments_dir: Path, force: bool = False) -> tuple[int, int, int]:
    if not INSIGHTS_PATH.exists():
        print(f"error: {INSIGHTS_PATH} does not exist. Decrypt it first.", file=sys.stderr)
        sys.exit(2)

    doc = json.loads(INSIGHTS_PATH.read_text())
    insights = doc.get("insights") or {}

    added = updated = skipped = 0
    files = sorted(enrichments_dir.glob("*.json"))
    for fp in files:
        e = json.loads(fp.read_text())
        name = e.get("name")
        if not name:
            print(f"skip {fp.name}: no name", file=sys.stderr)
            continue

        prev = insights.get(name) or {}
        prev_source = (prev.get("enrichmentSource") or prev.get("source") or "").lower()

        # Guard: never clobber admin curation
        if prev_source in ("admin-paste", "admin-approved") and not force:
            print(f"skip {name}: existing entry is {prev_source!r} (use --force)")
            skipped += 1
            continue
        if prev.get("summaryFormat") == "html" and prev_source not in ("llm-web-search", "") and not force:
            print(f"skip {name}: existing html summary from {prev_source!r} (use --force)")
            skipped += 1
            continue

        merged = dict(prev)  # preserve signature, publicationCount, etc.
        merged["keywords"] = e.get("keywords") or []
        merged["summary"] = e.get("summary") or ""
        merged["summaryFormat"] = "html"
        merged["summarySources"] = e.get("summarySources") or []
        merged["enrichmentSource"] = e.get("enrichmentSource", "llm-web-search")
        merged["enrichmentModel"] = e.get("enrichmentModel", "")
        merged["enrichmentDate"] = e.get("enrichmentDate") or datetime.now(timezone.utc).isoformat(timespec="seconds")

        if name in insights:
            updated += 1
        else:
            added += 1
        insights[name] = merged

    doc["insights"] = insights
    doc["generatedAt"] = datetime.now(timezone.utc).isoformat(timespec="seconds")
    INSIGHTS_PATH.write_text(json.dumps(doc, indent=2, ensure_ascii=False))
    return added, updated, skipped


def reencrypt():
    if not os.environ.get("VAVELAB_PASSCODE"):
        print("VAVELAB_PASSCODE not set; skipping re-encryption.", file=sys.stderr)
        return
    subprocess.run(
        [sys.executable, str(ROOT / "scripts" / "encrypt_data.py"), "scholar-insights.json"],
        check=True,
    )


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--enrichments-dir", default="/tmp/scholar_enrichments",
                    help="Directory of per-scholar enrichment JSON files")
    ap.add_argument("--force", action="store_true",
                    help="Overwrite entries even if admin-curated")
    ap.add_argument("--reencrypt", action="store_true",
                    help="Re-encrypt data/scholar-insights.json after merge")
    args = ap.parse_args()

    src = Path(args.enrichments_dir)
    if not src.exists():
        print(f"error: enrichments dir {src} does not exist", file=sys.stderr)
        sys.exit(2)

    a, u, s = merge(src, force=args.force)
    print(f"merged: {a} added, {u} updated, {s} skipped")

    if args.reencrypt:
        reencrypt()


if __name__ == "__main__":
    main()
