#!/usr/bin/env python3
"""One-shot repair of nameAliases in scholar-profiles.json.

Ron reported two related bugs:

1. Esther Batiri-Williams appears twice on the public dashboard even
   though the admin table only shows one row. Root cause: the Zotero
   sub-collection "Batiri-Williams, Esther" (word order flipped from the
   canonical profile "Williams, Esther Batiri") had no alias entry, and
   the public deriveScholarRows() iterates BOTH sub-collections AND
   profiles, so the sub-collection emitted a duplicate card.

2. Nine "variant groups" that Ron has merged repeatedly keep coming back.
   Root cause: nameAliases contained 13 multi-hop chains and 2 cycles
   (King, Temalesi V. ↔ Vere; Navia, Miliana self-loop). The single-hop
   resolvers in admin.js and itaukei-database.js only follow one edge,
   so a chain A → B → C leaves A folded into B but never into C, keeping
   already-merged pairs visible in the variant panel. Additionally,
   trailing-period Zotero variants (Carlton, Lauren H vs Carlton, Lauren
   H.) had no aliases at all — apparently Ron's earlier merges of those
   never persisted.

This script:

- transitive-closes every alias chain so aliases become {source → final
  target} in one hop, and every entry is a fixed point of the map.
- breaks cycles using a best-canonical scoring heuristic that mirrors
  admin.js's detectVariantGroups: fully-typed given name > initial-only,
  is-canonical-scholar > not, longer > shorter, alpha tie-break.
- drops self-loops (aliases pointing at themselves).
- scans Zotero sub-collections under the iTaukei-authors root, and adds
  direct aliases from any sub-collection name to a canonical scholar
  profile whose token set (surname parts + given tokens) matches — this
  fixes the Batiri-Williams duplicate specifically.
- auto-aliases trailing-period Zotero variants: for every Zotero creator
  string ending in a bare letter (e.g. "Carlton, Lauren H"), if the same
  string with a trailing period ("Carlton, Lauren H.") also appears as a
  creator, alias the dotless form to the dotted form. Skips if either
  side already has an alias.

Run with --dry-run to preview.

The admin push flow re-uploads the entire scholar-profiles.json.enc after
every merge, so future merges will pick up wherever this repair leaves
off. The paired JS changes (transitive resolveAlias + chain-collapse at
merge time) prevent this pathology from recurring.
"""
from __future__ import annotations

import argparse
import json
import re
import sys
from pathlib import Path

HERE = Path(__file__).resolve().parent
ROOT = HERE.parent
PROFILES = ROOT / "data" / "scholar-profiles.json"
SNAPSHOT = ROOT / "data" / "itaukei-zotero-snapshot.json"

HYPH_RE = re.compile(r"[\u2010\u2011\u2013\u2212]")


def canonical_form(raw: str) -> str | None:
    """Normalise a raw creator string to "Last, First"."""
    if not isinstance(raw, str):
        return None
    s = HYPH_RE.sub("-", raw).strip()
    if not s:
        return None
    if "," in s:
        return s
    toks = s.split()
    if len(toks) < 2:
        return None
    return f"{toks[-1]}, {' '.join(toks[:-1])}"


def first_tokens(name: str) -> list[str]:
    """Return lowercase given-name tokens (strip trailing dots)."""
    if "," not in name:
        return []
    _, first = name.split(",", 1)
    return [t.strip(".").lower() for t in first.strip().split() if t.strip(".")]


def surname_tokens(name: str) -> list[str]:
    """Return lowercase surname tokens, splitting on hyphens too."""
    surname = name.split(",", 1)[0] if "," in name else name.split()[-1]
    parts = re.split(r"[-\s]+", surname)
    return [p.strip().lower() for p in parts if p.strip()]


def score_name(name: str, canonical_scholars: set) -> tuple:
    """Larger tuple wins."""
    toks = first_tokens(name)
    fully_typed = 1 if any(len(t) > 1 for t in toks) else 0
    is_scholar = 1 if name in canonical_scholars else 0
    # Prefer longer names when everything else is equal.
    length = len(name)
    # Stable alpha tie-break: earlier alphabetically wins (so we negate ord).
    tiebreak = -ord(name[0]) if name else 0
    return (fully_typed, is_scholar, length, tiebreak)


def collapse_aliases(aliases: dict, canonical_scholars: set) -> dict:
    """Transitive closure + cycle break + self-loop drop.

    Returns a new dict where every entry maps source → final canonical
    target, all in one hop, with no cycles or self-loops.
    """
    # Detect cycles first; for each cycle pick a best member as canonical,
    # rewrite every cycle member (except the winner) to point at the winner,
    # and drop the winner's own outgoing alias so it becomes a fixed point.

    def walk(start: str) -> tuple[list[str], str]:
        """Follow chain from `start`. Return (path_including_start, terminal)."""
        path = []
        cur = start
        seen = set()
        while cur in aliases and cur not in seen:
            seen.add(cur)
            path.append(cur)
            cur = aliases[cur]
        path.append(cur)
        return path, cur

    resolved_target: dict[str, str] = {}
    # Discover cycles and pre-populate resolved_target for their members.
    for start in list(aliases.keys()):
        if start in resolved_target:
            continue
        # Walk until we hit a fixed point or a node already in the path.
        path = [start]
        seen_idx = {start: 0}
        cur = aliases[start]
        cycle_at = None
        while True:
            if cur in seen_idx:
                cycle_at = seen_idx[cur]
                break
            if cur not in aliases:
                # Chain terminates at a non-alias node.
                path.append(cur)
                cur = None
                break
            seen_idx[cur] = len(path)
            path.append(cur)
            cur = aliases[cur]
        if cycle_at is not None:
            cycle = path[cycle_at:]
            winner = max(cycle, key=lambda n: score_name(n, canonical_scholars))
            for member in path[:cycle_at]:
                resolved_target[member] = winner
            for member in cycle:
                resolved_target[member] = winner
        else:
            terminal = path[-1]
            for member in path[:-1]:
                resolved_target[member] = terminal

    # Now build the new alias map: skip self-loops.
    new_aliases: dict[str, str] = {}
    for variant, target in resolved_target.items():
        if variant == target:
            continue  # self-loop, drop
        new_aliases[variant] = target
    return new_aliases


def find_period_variant_pairs(snapshot: dict, aliases: dict) -> list:
    """Find (dotless, dotted) creator-string pairs that are unambiguous
    trailing-period variants of each other. Skips any pair where either
    side already has an alias set."""
    seen_names = set()
    for item in snapshot.get("items", []):
        for c in item.get("creators") or []:
            if isinstance(c, str):
                raw = c
            elif isinstance(c, dict):
                raw = c.get("name") or f"{c.get('lastName','')}, {c.get('firstName','')}"
            else:
                continue
            can = canonical_form(raw)
            if can:
                seen_names.add(can)
    pairs = []
    for name in seen_names:
        if name.endswith("."):
            continue
        twin = name + "."
        if twin in seen_names and name not in aliases and twin not in aliases:
            pairs.append((name, twin))
    return pairs


def find_subcollection_scholar_mismatches(snapshot: dict, canonical_scholars: set, aliases: dict) -> list:
    """Match Zotero sub-collections under the iTaukei-authors root to
    canonical scholar profiles by token set. Returns (subcol_name,
    scholar_name) pairs whose token sets match but names differ, and no
    alias exists yet."""
    # Locate iTaukei-authors root
    cols = snapshot.get("collections") or []
    # The iTaukei-authors root historically has variants like
    # "iTaukei authors (>2 papers)" — match anything starting with
    # "itaukei authors" (case-insensitive) that sits at the top level.
    root_keys = []
    for c in cols:
        name = (c.get("name") or "").strip().lower()
        if name.startswith("itaukei authors") or name in ("itaukei-authors",):
            root_keys.append(c.get("key"))
    if not root_keys:
        return []
    sub_names = [c.get("name", "").strip() for c in cols if c.get("parent") in root_keys]

    def toks_of(name: str) -> frozenset:
        return frozenset(surname_tokens(name) + first_tokens(name))

    scholar_token_map: dict[frozenset, list[str]] = {}
    for s in canonical_scholars:
        scholar_token_map.setdefault(toks_of(s), []).append(s)

    out = []
    for sub in sub_names:
        if not sub or sub in canonical_scholars:
            continue
        # Already aliased? skip
        if sub in aliases:
            continue
        sub_tokens = toks_of(sub)
        if len(sub_tokens) < 2:
            continue
        matches = scholar_token_map.get(sub_tokens)
        if matches and len(matches) == 1:
            out.append((sub, matches[0]))
    return out


def main():
    ap = argparse.ArgumentParser(description=__doc__)
    ap.add_argument("--dry-run", action="store_true", help="report only, don't write")
    args = ap.parse_args()

    profiles = json.loads(PROFILES.read_text())
    snapshot = json.loads(SNAPSHOT.read_text())

    aliases_before: dict = dict(profiles.get("nameAliases") or {})
    canonical_scholars = {s.get("name", "") for s in profiles.get("scholars", []) if s.get("name")}

    print(f"Loaded {len(aliases_before)} aliases and {len(canonical_scholars)} canonical scholars")
    print()

    # 1. Transitive closure + cycle break + self-loop drop.
    aliases_after = collapse_aliases(aliases_before, canonical_scholars)

    # 2. Add sub-collection→profile aliases for name-order mismatches.
    subcol_pairs = find_subcollection_scholar_mismatches(snapshot, canonical_scholars, aliases_after)
    for variant, target in subcol_pairs:
        aliases_after[variant] = target

    # 3. Auto-alias trailing-period variants.
    period_pairs = find_period_variant_pairs(snapshot, aliases_after)
    for variant, target in period_pairs:
        aliases_after[variant] = target

    # ------------------------------------------------------------------
    # Report
    # ------------------------------------------------------------------
    all_keys = set(aliases_before.keys()) | set(aliases_after.keys())
    changed = []
    for k in sorted(all_keys, key=str.lower):
        before = aliases_before.get(k)
        after = aliases_after.get(k)
        if before != after:
            changed.append((k, before, after))

    print(f"Chains collapsed / cycles broken / self-loops dropped: "
          f"{sum(1 for k, b, a in changed if b is not None and a is not None and b != a)}")
    print(f"Self-loops removed: {sum(1 for k, b, a in changed if a is None)}")
    print(f"Sub-collection aliases added: {len(subcol_pairs)}")
    print(f"Trailing-period pair aliases added: {len(period_pairs)}")
    print(f"Total alias changes: {len(changed)}")
    print()

    if changed:
        print("=== BEFORE → AFTER ===")
        for k, b, a in changed:
            if b is None:
                print(f"  + {k!r} -> {a!r}   (new)")
            elif a is None:
                print(f"  - {k!r} was -> {b!r}   (removed self-loop)")
            else:
                print(f"  ~ {k!r}: {b!r} -> {a!r}")
        print()

    if args.dry_run:
        print("(dry-run — no files written)")
        return

    profiles["nameAliases"] = dict(sorted(aliases_after.items(), key=lambda kv: kv[0].lower()))
    PROFILES.write_text(json.dumps(profiles, indent=2, ensure_ascii=False) + "\n")
    print(f"Wrote {PROFILES} with {len(aliases_after)} aliases.")


if __name__ == "__main__":
    main()
