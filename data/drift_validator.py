"""Collection-membership drift validator for the Zotero snapshot.

The Zotero paged /items/top endpoint occasionally returns items whose
collections[] field is short by one or more collection keys — even
when the per-item /items/{key} endpoint returns the correct list.
This module reconciles a freshly-pulled items list against the
authoritative /collections/{key}/items?format=keys listing and
repairs any drift by re-fetching offending items individually.

The core function reconcile_drift() is dependency-injected on its
network callables so it can be unit-tested with in-memory fixtures.
"""
from __future__ import annotations

import time


def reconcile_drift(items, collections, *,
                    key_fetcher,
                    item_fetcher,
                    api_delay: float = 0.20,
                    max_collections: int = 400,
                    max_items: int = 500,
                    log=print):
    """Repair collections[] drift on `items` in place.

    Args:
      items: list of snapshot item dicts. Each has "key" and
        "collections" (list of collection keys).
      collections: list of collection dicts. Each has "key" and
        "name" (and other fields ignored here).
      key_fetcher: callable(collection_key) -> list[str] of item keys.
      item_fetcher: callable(item_key) -> dict or None. When a dict,
        must have a "data" key with a "collections" list.
      api_delay: seconds to sleep between remote calls.
      max_collections / max_items: hard caps to prevent runaway loops.
      log: printer for progress lines.

    Returns:
      {"repaired_items": int, "repaired_collections": int,
       "skipped_collections": int, "drift_report": list[(key, name, recon, auth)]}
    """
    item_by_key = {it["key"]: it for it in items}
    kept_keys = set(item_by_key)

    reconstructed: dict[str, set[str]] = {c["key"]: set() for c in collections}
    for it in items:
        for col_key in it.get("collections") or []:
            if col_key in reconstructed:
                reconstructed[col_key].add(it["key"])

    repaired_items = 0
    repaired_collections = 0
    skipped_collections = 0
    drift_report: list[tuple[str, str, int, int]] = []

    for idx, col in enumerate(collections):
        if idx >= max_collections:
            log(f"  ! stopped after {max_collections} collections; extend cap if this fires")
            break
        if repaired_items >= max_items:
            log(f"  ! repair budget of {max_items} items exhausted")
            break

        col_key = col["key"]
        try:
            authoritative = set(key_fetcher(col_key))
        except Exception as e:
            log(f"  ! {col_key} ({col['name']!r}): key-list fetch failed: {e}")
            skipped_collections += 1
            continue
        if api_delay:
            time.sleep(api_delay)

        # Restrict to items we actually retained (drops attachments/notes).
        authoritative_top = authoritative & kept_keys
        missing = authoritative_top - reconstructed[col_key]
        if not missing:
            continue

        drift_report.append((col_key, col["name"], len(reconstructed[col_key]), len(authoritative_top)))
        log(f"  drift  {col_key} ({col['name']!r}): reconstructed={len(reconstructed[col_key])} "
            f"authoritative={len(authoritative_top)} \u2192 repairing {len(missing)} item(s)")

        for item_key in missing:
            if repaired_items >= max_items:
                break
            target = item_by_key.get(item_key)
            if target is None:
                # Item exists in the collection on the server but wasn't in
                # our /items/top pull (e.g. added between paged calls). Skip;
                # a subsequent refresh will pick it up.
                continue
            fresh = item_fetcher(item_key)
            if api_delay:
                time.sleep(api_delay)
            if not fresh:
                continue
            fresh_cols = fresh.get("data", {}).get("collections") or []
            merged = sorted(set(target.get("collections") or []) | set(fresh_cols))
            if merged != (target.get("collections") or []):
                target["collections"] = merged
                for c in merged:
                    if c in reconstructed:
                        reconstructed[c].add(item_key)
                repaired_items += 1
        repaired_collections += 1

    return {
        "repaired_items": repaired_items,
        "repaired_collections": repaired_collections,
        "skipped_collections": skipped_collections,
        "drift_report": drift_report,
    }
