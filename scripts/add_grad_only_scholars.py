#!/usr/bin/env python3
"""Backfill scholar-profiles.json with the graduate-studies-only scholars,
AND copy each scholar's masters/phd degree metadata from graduate-studies
onto their profile when the profile hasn't captured it yet.

Context — the graduate-studies pipeline (data/itaukei-graduate-studies.json)
lists every iTaukei scholar with at least one thesis in Zotero. Historically
scholar-profiles.json only held the curated leaderboard (>2 papers), so many
Masters-only or thesis-only scholars had no profile record. That meant the
scholar-mobility spreadsheet (`itaukei_scholar_mobility.xlsx`) couldn't
attach a paternal province to their rows, and future admin-dashboard edits
had no anchor.

Memorial fields (deceased / yearOfBirth / yearOfDeath) are OPTIONAL and
never populated by this script — they are edited exclusively via the admin
dashboard's “Memorial (deceased scholars)” section. New stubs simply omit
them (treated as “living” by the public renderer). If an existing profile
already has them set, this script leaves them untouched.

This script does two things:

1. Adds a stub profile row for every grad-only scholar so the join stops
   leaking. Empty province / institution / photo — the admin dashboard
   fills those in over time.

2. Backfills `masters` and `phd` degree objects onto every profile (new
   stubs AND older stubs where the fields are still None/empty) using
   whatever graduate-studies has for the same person. This is the fix for
   the "Countries of study" filter on the public dashboard — that combo
   only shows a country if at least one profile's `masters.country` or
   `phd.country` names it, so scholars whose degrees were only known via
   the world-map pipeline (e.g. China / India grad students) were invisible.
   The copy is one-way and idempotent: it only writes when the profile
   field is empty. Admin-entered edits are never overwritten.

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


# Which fields to lift out of a graduate-studies degree record and drop onto
# the profile. We intentionally keep this narrow — the profile is admin-
# owned and only needs the identity fields that the public dashboard's
# study filters and mobility spreadsheet read. Coordinates and ISO codes
# stay in graduate-studies where they belong.
_DEGREE_FIELDS = ("level", "thesisType", "university", "country")

# Country-name normalization applied when we write a country string onto a
# profile degree. This mirrors data/refresh-graduate-studies.py's
# COUNTRY_DISPLAY map so the two pipelines stay in lockstep — without this,
# a scholar whose thesis Zotero collection is named "England" or "United
# Kingdom" would show up as a distinct country on the public dashboard's
# "Countries / Universities of study" filter, splitting one country into
# three. Keep this in sync with COUNTRY_DISPLAY in refresh-graduate-studies.
_COUNTRY_DISPLAY = {
    "United Kingdom":  "UK",
    "England":         "UK",
    "Scotland":        "UK",
    "Wales":           "UK",
    "Northern Ireland":"UK",
}


def _canonical_country(name):
    if not isinstance(name, str):
        return name
    return _COUNTRY_DISPLAY.get(name.strip(), name.strip() or name)


def _degree_from_grad(grad_deg):
    """Project a graduate-studies degree dict onto the fields we store on
    the profile. Returns None if the input is missing or has no country.
    Country names are normalized via _canonical_country so UK variants
    (England / Scotland / Wales / United Kingdom) collapse to "UK"."""
    if not grad_deg or not isinstance(grad_deg, dict):
        return None
    country = (grad_deg.get("country") or "").strip()
    if not country:
        return None
    out = {k: grad_deg.get(k) for k in _DEGREE_FIELDS if grad_deg.get(k)}
    out["country"] = _canonical_country(out["country"])
    return out


def _profile_degree_empty(prof_deg):
    """True when the profile has no meaningful degree data yet. Treats
    None, missing, and empty-dict as empty; also treats a dict with no
    country as empty (a country-less degree is not useful for the
    Countries-of-study filter)."""
    if not prof_deg:
        return True
    if not isinstance(prof_deg, dict):
        return True
    return not (prof_deg.get("country") or "").strip()


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--apply", action="store_true",
                    help="write changes to scholar-profiles.json (default: dry run)")
    args = ap.parse_args()

    profiles = json.loads(PROFILE_PATH.read_text())
    grad = json.loads(GRAD_PATH.read_text())

    existing_names = {s["name"] for s in profiles["scholars"]}
    aliases: dict[str, str] = profiles.get("nameAliases") or {}

    # Fast lookup: canonical-profile-name -> profile object (mutable).
    profile_by_name = {s["name"]: s for s in profiles["scholars"]}

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

    # Graduate-studies keys `scholars` as a name -> {masters, phd, ...} dict
    # (see data/refresh-graduate-studies.py). Iterating the mapping lets us
    # attach the degree metadata to whichever profile the name resolves to,
    # whether that's an existing profile, an alias, or a new stub we're
    # about to add in this run.
    grad_scholars = grad["scholars"] if isinstance(grad["scholars"], dict) else {
        n: {} for n in grad["scholars"]
    }

    degree_backfills: list[tuple[str, str, str]] = []  # (profile_name, degree, source)

    # One-shot normalization: fix any existing profile whose degree country
    # is still "England" / "Scotland" / "Wales" / "United Kingdom" so the
    # public dashboard's country pills collapse them into a single "UK"
    # bucket. This runs on every invocation and is a no-op once every
    # variant has been rewritten. Only the `country` string changes;
    # the university and thesisType stay untouched.
    country_normalizations: list[tuple[str, str, str, str]] = []
    for prof in profiles["scholars"]:
        for key in ("masters", "phd"):
            deg = prof.get(key)
            if not isinstance(deg, dict):
                continue
            old = (deg.get("country") or "").strip()
            if not old:
                continue
            new = _canonical_country(old)
            if new != old:
                deg["country"] = new
                country_normalizations.append((prof["name"], key, old, new))

    def apply_degree_backfill(target_profile: dict, grad_rec: dict, grad_name: str) -> None:
        """Write `masters` and `phd` from graduate-studies onto the profile
        wherever the profile has an empty field. Records what we changed."""
        for key in ("masters", "phd"):
            src = _degree_from_grad(grad_rec.get(key))
            if src is None:
                continue
            if _profile_degree_empty(target_profile.get(key)):
                target_profile[key] = src
                degree_backfills.append((target_profile["name"], key, grad_name))

    for grad_key, grad_rec in grad_scholars.items():
        c = _clean(grad_key)
        existing = c if c in existing_names else resolves_to_existing(c)
        if existing:
            if c in existing_names:
                already_canonical.append(c)
            else:
                resolved.append((c, existing))
            # Even when the profile already existed, opportunistically
            # backfill its degree metadata from graduate-studies.
            target = profile_by_name.get(existing)
            if target is not None:
                apply_degree_backfill(target, grad_rec or {}, c)
            continue
        # Genuinely new — build the profile stub
        canonical = flip_first_last(c) if "," not in c else c
        # Guard against a same-batch duplicate (two grad keys mapping to same canonical)
        if canonical in {row["name"] for row in to_add}:
            resolved.append((c, canonical + "  [in this batch]"))
            # Attach degrees to the earlier stub too.
            earlier = next((row for row in to_add if row["name"] == canonical), None)
            if earlier is not None:
                apply_degree_backfill(earlier, grad_rec or {}, c)
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
        apply_degree_backfill(stub, grad_rec or {}, c)
        to_add.append(stub)
        profile_by_name[canonical] = stub  # future iterations can find it

    print(f"grad-studies scholars total : {len(grad_scholars)}")
    print(f"already in profiles          : {len(already_canonical)}")
    print(f"resolved via alias/flip      : {len(resolved)}")
    print(f"NEW stubs to add             : {len(to_add)}")
    print(f"degree backfills (masters/phd): {len(degree_backfills)}")
    print(f"country normalizations       : {len(country_normalizations)}")
    if country_normalizations:
        for pname, key, old, new in country_normalizations:
            print(f"    {pname:40s} {key:8s} {old!r:20s} -> {new!r}")
    if degree_backfills:
        # Country-level summary so Ron can eyeball which study countries
        # just came online.
        from collections import Counter
        by_country: Counter[str] = Counter()
        for pname, key, _src in degree_backfills:
            prof = profile_by_name.get(pname) or {}
            deg = prof.get(key) or {}
            country = (deg.get("country") or "").strip() or "(unknown)"
            by_country[country] += 1
        print("  by country:")
        for c, n in by_country.most_common():
            print(f"    {c:30s} {n}")

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

    # Dry run vs write. In dry-run mode we still ran apply_degree_backfill
    # against the in-memory profile objects, but since we won't write the
    # file below, no on-disk state changes.
    if not args.apply:
        print("\n(dry run — pass --apply to write)")
        return

    profiles["scholars"].extend(to_add)
    profiles["scholars"].sort(key=lambda s: s["name"].lower())

    PROFILE_PATH.write_text(json.dumps(profiles, indent=2, ensure_ascii=False) + "\n")
    print(f"\nwrote {PROFILE_PATH}  ({len(profiles['scholars'])} scholars total,"
          f" {len(degree_backfills)} degree backfills applied)")


if __name__ == "__main__":
    main()
