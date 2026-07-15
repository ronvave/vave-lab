"""Unit tests for the Zotero snapshot drift validator.

The validator's job is to detect and repair the case where the paged
/items/top endpoint returns an item with a shortened collections[]
list, then re-fetch that item directly and merge the true list back
in. These tests exercise every branch with in-memory fixtures — no
network required.
"""
import sys
from pathlib import Path

REPO = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(REPO / "data"))

from drift_validator import reconcile_drift  # noqa: E402


def _make_key_fetcher(mapping):
    """key_fetcher stub: returns the item-key list for a collection."""
    def fetch(col_key):
        return list(mapping.get(col_key, []))
    return fetch


def _make_item_fetcher(mapping):
    """item_fetcher stub: returns {'data': {'collections': [...]}}."""
    def fetch(item_key):
        cols = mapping.get(item_key)
        return {"data": {"collections": cols}} if cols is not None else None
    return fetch


def test_no_drift_reports_zero_repairs():
    items = [
        {"key": "A1", "collections": ["C1"]},
        {"key": "A2", "collections": ["C1", "C2"]},
    ]
    collections = [
        {"key": "C1", "name": "Fiji"},
        {"key": "C2", "name": "Ba"},
    ]
    stats = reconcile_drift(
        items, collections,
        key_fetcher=_make_key_fetcher({"C1": ["A1", "A2"], "C2": ["A2"]}),
        item_fetcher=_make_item_fetcher({}),
        api_delay=0, log=lambda *_: None,
    )
    assert stats["repaired_items"] == 0
    assert stats["repaired_collections"] == 0
    assert stats["skipped_collections"] == 0
    assert stats["drift_report"] == []


def test_drift_on_one_item_gets_repaired():
    # A2 is missing C2 in the local snapshot but the authoritative
    # list says C2 contains {A1, A2}. The per-item fetcher returns
    # the correct collections list for A2.
    items = [
        {"key": "A1", "collections": ["C1", "C2"]},
        {"key": "A2", "collections": ["C1"]},  # missing C2
    ]
    collections = [
        {"key": "C1", "name": "Fiji"},
        {"key": "C2", "name": "Ba"},
    ]
    stats = reconcile_drift(
        items, collections,
        key_fetcher=_make_key_fetcher({"C1": ["A1", "A2"], "C2": ["A1", "A2"]}),
        item_fetcher=_make_item_fetcher({"A2": ["C1", "C2"]}),
        api_delay=0, log=lambda *_: None,
    )
    assert stats["repaired_items"] == 1
    assert stats["repaired_collections"] == 1
    # The item was mutated in place with the merged list.
    a2 = next(it for it in items if it["key"] == "A2")
    assert a2["collections"] == ["C1", "C2"]
    # Drift report captures reconstructed vs authoritative counts.
    assert stats["drift_report"] == [("C2", "Ba", 1, 2)]


def test_multiple_drifts_across_collections():
    items = [
        {"key": "A1", "collections": ["C1"]},          # missing C3
        {"key": "A2", "collections": ["C1"]},          # missing C2
        {"key": "A3", "collections": ["C2", "C3"]},
    ]
    collections = [
        {"key": "C1", "name": "Fiji"},
        {"key": "C2", "name": "Ba"},
        {"key": "C3", "name": "Serua"},
    ]
    stats = reconcile_drift(
        items, collections,
        key_fetcher=_make_key_fetcher({
            "C1": ["A1", "A2"],
            "C2": ["A2", "A3"],
            "C3": ["A1", "A3"],
        }),
        item_fetcher=_make_item_fetcher({
            "A1": ["C1", "C3"],
            "A2": ["C1", "C2"],
        }),
        api_delay=0, log=lambda *_: None,
    )
    assert stats["repaired_items"] == 2
    assert stats["repaired_collections"] == 2
    a1 = next(it for it in items if it["key"] == "A1")
    a2 = next(it for it in items if it["key"] == "A2")
    assert a1["collections"] == ["C1", "C3"]
    assert a2["collections"] == ["C1", "C2"]


def test_missing_local_item_is_skipped_not_synthesised():
    # Collection says A99 belongs, but A99 isn't in items. We must NOT
    # attempt to synthesise it — a subsequent refresh will pick it up.
    items = [{"key": "A1", "collections": ["C1"]}]
    collections = [{"key": "C1", "name": "Fiji"}]
    stats = reconcile_drift(
        items, collections,
        key_fetcher=_make_key_fetcher({"C1": ["A1", "A99"]}),
        item_fetcher=_make_item_fetcher({"A99": ["C1"]}),
        api_delay=0, log=lambda *_: None,
    )
    # A99 was already filtered out (not in kept_keys), so no missing set,
    # no repair attempts, no drift report entry.
    assert stats["repaired_items"] == 0
    assert stats["drift_report"] == []


def test_key_fetcher_error_marks_skipped_not_crashed():
    items = [{"key": "A1", "collections": ["C1"]}]
    collections = [
        {"key": "C1", "name": "Fiji"},
        {"key": "BAD", "name": "Errored"},
    ]
    def key_fetcher(col_key):
        if col_key == "BAD":
            raise RuntimeError("simulated 429")
        return ["A1"]
    stats = reconcile_drift(
        items, collections,
        key_fetcher=key_fetcher,
        item_fetcher=_make_item_fetcher({}),
        api_delay=0, log=lambda *_: None,
    )
    assert stats["skipped_collections"] == 1
    assert stats["repaired_items"] == 0


def test_item_fetcher_returning_none_does_not_repair():
    items = [
        {"key": "A1", "collections": ["C1", "C2"]},
        {"key": "A2", "collections": ["C1"]},  # missing C2
    ]
    collections = [
        {"key": "C1", "name": "Fiji"},
        {"key": "C2", "name": "Ba"},
    ]
    stats = reconcile_drift(
        items, collections,
        key_fetcher=_make_key_fetcher({"C1": ["A1", "A2"], "C2": ["A1", "A2"]}),
        item_fetcher=lambda _k: None,  # every fetch fails
        api_delay=0, log=lambda *_: None,
    )
    assert stats["repaired_items"] == 0
    # But drift was still detected and reported.
    assert stats["drift_report"] == [("C2", "Ba", 1, 2)]


def test_repair_budget_cap():
    items = [
        {"key": f"A{i}", "collections": ["C1"]}
        for i in range(1, 6)  # 5 items, all missing C2
    ]
    collections = [
        {"key": "C1", "name": "Fiji"},
        {"key": "C2", "name": "Ba"},
    ]
    stats = reconcile_drift(
        items, collections,
        key_fetcher=_make_key_fetcher({"C1": [f"A{i}" for i in range(1, 6)],
                                       "C2": [f"A{i}" for i in range(1, 6)]}),
        item_fetcher=_make_item_fetcher({f"A{i}": ["C1", "C2"] for i in range(1, 6)}),
        api_delay=0, max_items=2, log=lambda *_: None,
    )
    assert stats["repaired_items"] == 2


def test_max_collections_cap_stops_early():
    items = [{"key": "A1", "collections": []}]
    collections = [
        {"key": f"C{i}", "name": f"col{i}"} for i in range(10)
    ]
    calls = []
    def key_fetcher(col_key):
        calls.append(col_key)
        return []
    stats = reconcile_drift(
        items, collections,
        key_fetcher=key_fetcher,
        item_fetcher=_make_item_fetcher({}),
        api_delay=0, max_collections=3, log=lambda *_: None,
    )
    assert len(calls) == 3
    assert stats["repaired_items"] == 0


def test_ancestor_collection_gets_reconstructed_too():
    # Realistic case: our Panel B3 case. Serua is missing from an item's
    # collections[], but so is its parent RNKFUZ6M (which the app reads
    # via ancestry). When we merge the fresh collections list back in,
    # BOTH the leaf key and the parent key should end up in the item.
    items = [
        {"key": "ZGZ3ZDWL", "collections": []},  # completely bare
    ]
    collections = [
        {"key": "RNKFUZ6M", "name": "Fiji provinces (root)"},
        {"key": "K8V7L5QJ", "name": "Serua"},
    ]
    stats = reconcile_drift(
        items, collections,
        key_fetcher=_make_key_fetcher({
            "RNKFUZ6M": ["ZGZ3ZDWL"],
            "K8V7L5QJ": ["ZGZ3ZDWL"],
        }),
        item_fetcher=_make_item_fetcher({
            "ZGZ3ZDWL": ["K8V7L5QJ", "RNKFUZ6M"],
        }),
        api_delay=0, log=lambda *_: None,
    )
    assert stats["repaired_items"] == 1  # only one item needed repair
    # Only one drift report entry: after the first collection's repair
    # the item's collections list includes both keys, so the second
    # collection sees no drift. This is the desired short-circuit.
    assert stats["repaired_collections"] == 1
    item = items[0]
    assert set(item["collections"]) == {"K8V7L5QJ", "RNKFUZ6M"}


if __name__ == "__main__":
    tests = [
        test_no_drift_reports_zero_repairs,
        test_drift_on_one_item_gets_repaired,
        test_multiple_drifts_across_collections,
        test_missing_local_item_is_skipped_not_synthesised,
        test_key_fetcher_error_marks_skipped_not_crashed,
        test_item_fetcher_returning_none_does_not_repair,
        test_repair_budget_cap,
        test_max_collections_cap_stops_early,
        test_ancestor_collection_gets_reconstructed_too,
    ]
    passed = 0
    for t in tests:
        try:
            t()
            print(f"PASS  {t.__name__}")
            passed += 1
        except AssertionError as e:
            print(f"FAIL  {t.__name__}: {e}")
        except Exception as e:
            print(f"ERROR {t.__name__}: {type(e).__name__}: {e}")
    print(f"\n{passed}/{len(tests)} tests passed")
    sys.exit(0 if passed == len(tests) else 1)
