#!/usr/bin/env python3
"""One-off backfill for Publications columns V + W.

Column V: Bibliographic Lead Author (Last, First — first author in BibTeX order)
Column W: Bibliographic Author Count (integer — total bibliographic authors)

Sources, in priority order:
  1. Uploaded BibTeX file (~2732 keys)
  2. Existing on-disk Zotero snapshot (only if VAVELAB_PASSCODE is set)
  3. Unresolved rows → data/full-authors-unresolved.csv

Actor logged in Change Log: 'Perplexity AI / B4 bibliographic-lead-author backfill'.
This script does NOT write to the Sheet — it writes /tmp/bib-backfill.json
which the Sheet-write step consumes.
"""
from __future__ import annotations
import csv
import json
import os
import re
import sys
from pathlib import Path

BIB_PATH = "/home/user/workspace/uploaded_attachments/f546453285fe41658bee6359cb361ab5/iTaukei-Academic-Research_14Aug2026-9pm.bib"
PUBS_JSON = "/home/user/workspace/vave-lab/data/itaukei-master-publications.json"
OUT_JSON = "/tmp/bib-backfill.json"
UNRESOLVED_CSV = "/home/user/workspace/vave-lab/data/full-authors-unresolved.csv"


def parse_bib(path: str) -> dict[str, tuple[str, int]]:
    """Return {key: (lead_author_last_first, author_count)} from a .bib file."""
    text = Path(path).read_text(encoding="utf-8", errors="replace")
    out: dict[str, tuple[str, int]] = {}
    # Find each @type{key, ... } block. Non-greedy match to the next @ at line-start.
    for m in re.finditer(r"@\w+\{([^,\n]+),\s*(.*?)(?=\n@|\Z)", text, re.DOTALL):
        key = m.group(1).strip()
        body = m.group(2)
        source_field = "author"
        am = re.search(r"author\s*=\s*\{(.*?)\}\s*,?\s*\n", body, re.DOTALL)
        # Do NOT fall back to 'editor' for the lead-author column. Edited
        # volumes with no 'author' field are left unresolved so Ron can decide
        # whether to cite them by editor or leave them out of the citation
        # display. Storing an editor in the 'Bibliographic Lead Author' column
        # would mislabel the semantic.
        if not am:
            continue
        raw = am.group(1)
        # Strip braces (used for name protection in BibTeX) but keep the text inside.
        raw = re.sub(r"[{}]", "", raw)
        # Normalize whitespace across possibly multi-line author fields.
        raw = re.sub(r"\s+", " ", raw).strip()
        if not raw:
            continue
        # BibTeX uses ' and ' (case-insensitive, space-delimited) as separator.
        authors = [a.strip() for a in re.split(r"\s+and\s+", raw) if a.strip()]
        if not authors:
            continue
        lead = authors[0]
        # Normalize lead to 'Last, First' form.
        # BibTeX supports either 'Last, First' or 'First Last'. If a comma is
        # present treat as already Last-First; otherwise split on last space.
        if "," in lead:
            last, first = [x.strip() for x in lead.split(",", 1)]
            lead_norm = f"{last}, {first}"
        else:
            parts = lead.split()
            if len(parts) == 1:
                lead_norm = parts[0]
            else:
                lead_norm = f"{parts[-1]}, {' '.join(parts[:-1])}"
        out[key] = (lead_norm, len(authors), source_field)
    return out


def parse_zotero_snapshot(path: str) -> dict[str, tuple[str, int]]:
    """Extract {key: (lead, count)} from a decrypted Zotero snapshot JSON.

    Returns empty dict if the file doesn't exist or can't be read.
    """
    p = Path(path)
    if not p.exists():
        return {}
    try:
        z = json.loads(p.read_text(encoding="utf-8"))
    except Exception as e:
        print(f"[zotero] could not read {path}: {e}", file=sys.stderr)
        return {}
    items = z.get("items", []) if isinstance(z, dict) else z
    out: dict[str, tuple[str, int]] = {}
    for it in items:
        key = it.get("citationKey") or it.get("key")
        if not key:
            continue
        creators = it.get("creators") or []
        if not creators:
            continue
        # Zotero snapshot creators may be strings or {creatorType, firstName, lastName}
        first = creators[0]
        if isinstance(first, str):
            if "," in first:
                last, given = [x.strip() for x in first.split(",", 1)]
                lead = f"{last}, {given}"
            else:
                parts = first.split()
                lead = f"{parts[-1]}, {' '.join(parts[:-1])}" if len(parts) > 1 else first
        elif isinstance(first, dict):
            last = (first.get("lastName") or first.get("name") or "").strip()
            given = (first.get("firstName") or "").strip()
            if last and given:
                lead = f"{last}, {given}"
            elif last:
                lead = last
            else:
                lead = (first.get("name") or "").strip()
        else:
            continue
        if lead:
            out[key] = (lead, len(creators), "author")
    return out


def main() -> int:
    pubs = json.loads(Path(PUBS_JSON).read_text())
    print(f"Master publications JSON count: {len(pubs)}")

    bib = parse_bib(BIB_PATH)
    print(f"BibTeX entries parsed: {len(bib)}")

    # Zotero snapshot fallback: only if a decrypted copy exists at a known path
    zot = {}
    for candidate in [
        "/tmp/itaukei-zotero-snapshot.json",
        "/home/user/workspace/vave-lab/data/itaukei-zotero-snapshot.json",
    ]:
        if Path(candidate).exists():
            zot = parse_zotero_snapshot(candidate)
            print(f"Zotero snapshot ({candidate}): {len(zot)} entries")
            break
    if not zot:
        print("Zotero snapshot: not available for gap-fill (only BibTeX will be used).")

    resolved = {}
    unresolved = []
    src_counts = {"bibtex-author": 0, "bibtex-editor": 0, "zotero": 0, "unresolved": 0}
    for p in pubs:
        key = p.get("Publication ID / BibTeX Key", "")
        if not key:
            continue
        if key in bib:
            lead, count, field = bib[key]
            resolved[key] = {"lead": lead, "count": count, "source": "bibtex", "field": field}
            src_counts[f"bibtex-{field}"] += 1
        elif key in zot:
            lead, count, field = zot[key]
            resolved[key] = {"lead": lead, "count": count, "source": "zotero", "field": field}
            src_counts["zotero"] += 1
        else:
            unresolved.append({
                "Publication ID / BibTeX Key": key,
                "Title": p.get("Title", ""),
                "Year": p.get("Year", ""),
                "DOI": p.get("DOI", ""),
                "URL": p.get("URL", ""),
                "Publication Type": p.get("Publication Type", ""),
            })
            src_counts["unresolved"] += 1

    print(f"Backfill breakdown: {src_counts}")

    # Write outputs
    Path(OUT_JSON).write_text(json.dumps(resolved, ensure_ascii=False, indent=2))
    print(f"Wrote {len(resolved)} resolved records → {OUT_JSON}")

    Path(UNRESOLVED_CSV).parent.mkdir(parents=True, exist_ok=True)
    with open(UNRESOLVED_CSV, "w", newline="", encoding="utf-8") as f:
        w = csv.DictWriter(
            f,
            fieldnames=[
                "Publication ID / BibTeX Key",
                "Title",
                "Year",
                "DOI",
                "URL",
                "Publication Type",
            ],
        )
        w.writeheader()
        w.writerows(unresolved)
    print(f"Wrote {len(unresolved)} unresolved records → {UNRESOLVED_CSV}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
