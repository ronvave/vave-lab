#!/usr/bin/env python3
"""Backfill scholar-profiles.json with the graduate-studies-only scholars.

Context — the graduate-studies pipeline (data/itaukei-graduate-studies.json)
lists every iTaukei scholar with at least one thesis in Zotero. Historically
scholar-profiles.json only held the curated leaderboard (>2 papers), so many
Masters-only or thesis-only scholars had no profile record. That meant the
scholar-mobility spreadsheet (`itaukei_scholar_mobility.xlsx`) couldn't
attach a paternal province to their rows, and future admin-dashboard edits
had no anchor.

This script adds a stub profile row for every grad-only scholar so the join
stops leaking. Empty province / institution / photo — the admin dashboard
fills those in over time.

Duplicate safety: we NEVER add a name whose canonical form (or any known
alias) already resolves to an existing profile. The check runs the same
normalization ladder the DB frontend uses:

    1. exact match on name
    2. exact match on nameAliases[name]
    3. flip 'First Last' → 'Last, First' (with Jr/Jnr/Sr/etc. handling)
       and re-check 1+2

We deliberately do NOT use a surname + first-initial 'deep-dup' fallback.
That heuristic produces false positives when a surname has two scholars
who share a first initial (e.g. Jone Lako vs Jimaima Lako, Melikiseteki
Waqa vs Malakai Waqa). The alias map already encodes Ron's manual merge
decisions — anything not caught by exact/alias/flip is treated as new.

The script is idempotent: re-running it after admin-dashboard edits will
detect scholars you've already added (e.g. via the profile editor) and
skip them. Safe to re-run after any Zotero refresh.

Run:
  VAVELAB_PASSCODE=... python3 scripts/decrypt_data.py scholar-profiles.json \\
                                                        itaukei-graduate-studies.json
  python3 scripts/add_grad_only_scholars.py            # dry run
  python3 scripts/add_grad_only_scholars.py --apply    # write to disk
  VAVELAB_PASSCODE=... python3 scripts/encrypt_data.py scholar-profiles.json
"""
from __future__ import annotations

import argparse
import json
import re
import unicodedata
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
DATA = ROOT / "data"

PROFILE_PATH = DATA / "scholar-profiles.json"
GRAD_PATH = DATA / "itaukei-graduate-studies.json"


def _clean(s: str) -> str:
    return re.sub(r"\s+", " ", (s or "").strip())


def slugify(name: str) -> str:
    """Mirror the site's slug convention — 'Vasemaca Ledua Alifereti' style
    (first + middle + last, hyphenated, lowercase, ASCII-folded)."""
    nfkd = unicodedata.normalize("NFKD", name)
    ascii_ = "".join(c for c in nfkd if not unicodedata.combining(c))
    ascii_ = re.sub(r"[^A-Za-z0-9\s\-]", "", ascii_)
    return re.sub(r"\s+", "-", ascii_.strip()).lower()


# Suffixes that stay attached to the surname when flipping 'First Last Jnr'
# into canonical 'Last Jnr, First' form. See existing profiles like
# 'Matanaicake Jnr, Semesa' — the suffix is part of the last-name field.
SURNAME_SUFFIXES = {"jr", "jr.", "jnr", "jnr.", "snr", "snr.", "sr", "sr.",
                    "ii", "iii", "iv"}


def flip_first_last(name: str) -> str:
    """'Semesa Matanaicake Jnr' → 'Matanaicake Jnr, Semesa'.

    Grabs the surname (rightmost non-suffix token) plus any trailing suffix
    tokens attached to it, and puts everything before that as the first-name
    field. Preserves existing canonical form if already 'Last, First'."""
    if "," in name:
        return name
    parts = _clean(name).split(" ")
    if len(parts) < 2:
        return name
    # Walk from the right; skip suffix tokens to find the real surname index.
    surname_idx = len(parts) - 1
    while surname_idx > 0 and parts[surname_idx].lower().rstrip(".") in SURNAME_SUFFIXES:
        surname_idx -= 1
    surname = " ".join(parts[surname_idx:])   # surname + trailing suffixes
    given = " ".join(parts[:surname_idx])
    return f"{surname}, {given}"


def split_canonical(name: str) -> tuple[str, str]:
    """'Last, First' → ('Last', 'First'). Falls back to whole-string as last."""
    if "," in name:
        last, _, first = name.partition(",")
        return _clean(last), _clean(first)
    # 'First Last' fallback
    parts = _clean(name).split(" ")
    if len(parts) < 2:
        return name, ""
    return parts[-1], " ".join(parts[:-1])


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--apply", action="store_true",
                    help="write changes to scholar-profiles.json (default: dry run)")
    args = ap.parse_args()

    profiles = json.loads(PROFILE_PATH.read_text())
    grad = json.loads(GRAD_PATH.read_text())

    existing_names = {s["name"] for s in profiles["scholars"]}
    aliases: dict[str, str] = profiles.get("nameAliases") or {}

    def resolves_to_existing(name: str) -> str | None:
        """Return canonical existing profile name if `name` already resolves
        to one, else None."""
        c = _clean(name)
        if c in existing_names:
            return c
        if c in aliases and aliases[c] in existing_names:
            return aliases[c]
        f = flip_first_last(c)
        if f in existing_names:
            return f
        if f in aliases and aliases[f] in existing_names:
            return aliases[f]
        return None

    to_add: list[dict] = []
    resolved: list[tuple[str, str]] = []
    already_canonical: list[str] = []

    for grad_key in grad["scholars"]:
        c = _clean(grad_key)
        if c in existing_names:
            already_canonical.append(c)
            continue
        existing = resolves_to_existing(c)
        if existing:
            resolved.append((c, existing))
            continue
        # Genuinely new — build the profile stub
        canonical = flip_first_last(c) if "," not in c else c
        # Guard against a same-batch duplicate (two grad keys mapping to same canonical)
        if canonical in {row["name"] for row in to_add}:
            resolved.append((c, canonical + "  [in this batch]"))
            continue
        last, first = split_canonical(canonical)
        stub = {
            "name": canonical,
            "slug": slugify(f"{first} {last}") if first else slugify(last),
            "last": last,
            "first": first,
            "salutation": "",
            "village": "",
            "paternalProvince": "",
            "institution": "",
            "institutionUrl": "",
            "googleScholarUrl": "",
            "photo": "",
        }
        to_add.append(stub)

    print(f"grad-studies scholars total : {len(grad['scholars'])}")
    print(f"already in profiles          : {len(already_canonical)}")
    print(f"resolved via alias/flip      : {len(resolved)}")
    print(f"NEW stubs to add             : {len(to_add)}")

    if resolved:
        print("\nSample of alias/flip resolutions (first 10):")
        for g, e in resolved[:10]:
            print(f"  {g!r:50} -> {e!r}")

    if to_add:
        print("\nSample of new stubs (first 10):")
        for row in to_add[:10]:
            print(f"  {row['name']!r:50} slug={row['slug']!r}")

    # Full audit dump for review
    audit_path = ROOT / "scripts" / "add_grad_only_scholars_audit.txt"
    with open(audit_path, "w") as f:
        f.write(f"grad-studies scholars total : {len(grad['scholars'])}\n")
        f.write(f"resolved via alias/flip      : {len(resolved)}\n")
        f.write(f"NEW stubs to add             : {len(to_add)}\n\n")
        f.write("=" * 78 + "\n")
        f.write("RESOLUTIONS (grad key -> existing profile canonical)\n")
        f.write("=" * 78 + "\n")
        for g, e in sorted(resolved):
            f.write(f"  {g!r:55} -> {e!r}\n")
        f.write("\n" + "=" * 78 + "\n")
        f.write("NEW STUBS (all)\n")
        f.write("=" * 78 + "\n")
        for row in sorted(to_add, key=lambda r: r["name"].lower()):
            f.write(f"  name={row['name']!r:55}  last={row['last']!r:20}  first={row['first']!r}\n")
    print(f"\naudit written to {audit_path.relative_to(ROOT)}")

    if not args.apply:
        print("\n(dry run — pass --apply to write)")
        return

    profiles["scholars"].extend(to_add)
    profiles["scholars"].sort(key=lambda s: s["name"].lower())

    PROFILE_PATH.write_text(json.dumps(profiles, indent=2, ensure_ascii=False) + "\n")
    print(f"\nwrote {PROFILE_PATH}  ({len(profiles['scholars'])} scholars total)")


if __name__ == "__main__":
    main()
