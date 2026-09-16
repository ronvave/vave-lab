#!/usr/bin/env python3
"""End-to-end test: fake a new country in Zotero, verify auto-resolver heals it.

Runs the full refresh-graduate-studies.py pipeline against a doctored
snapshot that contains:

  * a synthetic country collection (Netherlands)
  * a synthetic university collection (Leiden University) under it
  * a synthetic thesis item filed into the university collection

Neither the country nor the university appears in the hardcoded
COUNTRY_ISO / UNIVERSITY_COORDS / COUNTRY_REGION dicts, so this
exercises the auto-resolver end-to-end.

Assertions:

  1. Refresh exits 0 under VAVELAB_STRICT_COVERAGE=1 (build not blocked).
  2. worldPoints contains a Netherlands entry with a valid ISO2,
     region, lat, lng, and the synthetic PhD scholar.
  3. output["autoResolved"] contains provenance URLs for both the
     country and the university.

Usage:
    VAVELAB_PASSCODE='Arachnid1!' python3 scripts/test_auto_resolve.py

Exit code:
    0  test passed
    1  test failed (assertion or refresh error)

Design notes:
    * Runs in a temp dir under /tmp so it never mutates the real
      data/ files. The refresh script is invoked with an env var
      that points it at the temp workspace.
    * Uses subprocess so the test really exercises the CLI entry
      point that CI + the 3-hourly cron use. No monkey-patching.
    * Deliberately uses Netherlands + Leiden (not Portugal or Japan
      etc.) because they are currently absent from the hardcoded
      dicts as of 2026-07-19. If either gets added, edit
      TEST_COUNTRY / TEST_UNIVERSITY below to a different real one.
    * The auto-resolver hits three external services. If the CI
      runner is offline or those services rate-limit, the test
      fails loudly \u2014 that's the right behavior (the whole point of
      the test is to verify the resolver still works).
"""
from __future__ import annotations

import json
import os
import shutil
import subprocess
import sys
import tempfile
from pathlib import Path

REPO = Path(__file__).resolve().parents[1]

# Pick a country + university that:
#   1. Are NOT in COUNTRY_ISO / UNIVERSITY_COORDS / COUNTRY_REGION.
#   2. ARE in restcountries.com (real country).
#   3. ARE in Wikipedia with coordinates (real university).
# Netherlands + Leiden University satisfies all three as of 2026-07-19.
# Verified: https://en.wikipedia.org/wiki/Leiden_University has coords.
TEST_COUNTRY = "Netherlands"
TEST_UNIVERSITY = "Leiden University"
TEST_SCHOLAR = "Test Scholar (auto-resolve)"
TEST_YEAR = 2025

# Keys use recognisable prefixes so they can't collide with real Zotero keys.
FAKE_COUNTRY_KEY = "TESTCOU1"
FAKE_UNI_KEY     = "TESTUNI1"
FAKE_ITEM_KEY    = "TESTITEM"


def log(msg: str, indent: int = 0) -> None:
    print(("  " * indent) + msg, flush=True)


def fail(msg: str) -> None:
    log(f"FAIL: {msg}")
    sys.exit(1)


def load_snapshot() -> dict:
    """Decrypt (if needed) and load the current Zotero snapshot."""
    snap_path = REPO / "data" / "itaukei-zotero-snapshot.json"
    if not snap_path.exists():
        log("Snapshot not decrypted; running scripts/decrypt_data.py...")
        r = subprocess.run(
            [sys.executable, str(REPO / "scripts" / "decrypt_data.py"),
             "itaukei-zotero-snapshot.json"],
            env={**os.environ, "PYTHONDONTWRITEBYTECODE": "1"},
            capture_output=True, text=True,
        )
        if r.returncode != 0:
            fail(f"decrypt failed: {r.stderr}")
    return json.loads(snap_path.read_text())


def inject_fake_country(snap: dict) -> dict:
    """Return a modified snapshot with a synthetic country + uni + thesis."""
    snap = json.loads(json.dumps(snap))  # deep copy

    # Root of the country/university tree. Use the same fixed key the
    # refresh script uses (THESIS_ROOT_KEY = '9XHGQJE6' in
    # data/refresh-graduate-studies.py). Loading the constant from that
    # module keeps the test in lockstep if the key ever changes.
    import importlib.util
    spec = importlib.util.spec_from_file_location(
        "_rg", REPO / "data" / "refresh-graduate-studies.py")
    _rg = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(_rg)

    root_key = None
    by_key = {c["key"]: c for c in snap["collections"]}
    if _rg.THESIS_ROOT_KEY in by_key:
        root_key = _rg.THESIS_ROOT_KEY
    else:
        for c in snap["collections"]:
            if c.get("name") in _rg.THESIS_ROOT_NAME_CANDIDATES:
                root_key = c["key"]
                break
    if not root_key:
        fail(f"could not locate country-tree root collection "
             f"(key={_rg.THESIS_ROOT_KEY!r})")

    log(f"root collection: {root_key}")

    # Add fake country collection.
    snap["collections"].append({
        "key": FAKE_COUNTRY_KEY,
        "name": TEST_COUNTRY,
        "parent": root_key,
        "numItems": 0,
    })
    # Add fake university collection under it.
    snap["collections"].append({
        "key": FAKE_UNI_KEY,
        "name": TEST_UNIVERSITY,
        "parent": FAKE_COUNTRY_KEY,
        "numItems": 1,
    })
    # Add fake thesis item filed into the university collection.
    snap["items"].append({
        "key": FAKE_ITEM_KEY,
        "itemType": "thesis",
        "title": f"[TEST] Synthetic PhD thesis for auto-resolver E2E test",
        "creators": [TEST_SCHOLAR],
        "year": TEST_YEAR,
        "date": str(TEST_YEAR),
        "publicationTitle": "",
        "university": TEST_UNIVERSITY,
        "thesisType": "PhD",
        "thesisLevel": "phd",
        "DOI": "",
        "url": "",
        "collections": [FAKE_UNI_KEY],
        "tags": [],
    })
    log(f"injected: country={TEST_COUNTRY!r} uni={TEST_UNIVERSITY!r} "
        f"scholar={TEST_SCHOLAR!r}")
    return snap


def run_refresh(workspace: Path) -> dict:
    """Run refresh-graduate-studies.py against the doctored workspace."""
    # The refresh script uses paths relative to __file__; caller
    # (main) has already copied code + data into `workspace` and
    # overwritten the snapshot with the doctored copy.

    # Delete any cached auto-resolved entries so the test really hits
    # the network each time. (A cached hit from a prior test run would
    # bypass the assertion about provenance URLs.)
    cache = workspace / "data" / "auto-resolved.json"
    if cache.exists():
        cache.unlink()
        log("cleared prior auto-resolved cache")

    log("running refresh-graduate-studies.py under STRICT_COVERAGE=1...")
    env = {
        **os.environ,
        "VAVELAB_STRICT_COVERAGE": "1",
        # Skip the re-encrypt step (needs VAVELAB_PASSCODE but we don't
        # want the test to write .enc files).
        "VAVELAB_PASSCODE": "",
        "PYTHONDONTWRITEBYTECODE": "1",
    }
    # Drop VAVELAB_PASSCODE (empty is falsy so the re-encrypt is skipped).
    env.pop("VAVELAB_DISABLE_AUTO_RESOLVE", None)

    r = subprocess.run(
        [sys.executable, str(workspace / "data" / "refresh-graduate-studies.py")],
        capture_output=True, text=True, env=env, cwd=workspace,
    )
    log(f"refresh exit code: {r.returncode}")
    if r.stdout:
        log("--- stdout ---")
        for line in r.stdout.splitlines():
            log(line, indent=1)
    if r.stderr:
        log("--- stderr ---")
        for line in r.stderr.splitlines():
            log(line, indent=1)
    if r.returncode != 0:
        fail(f"refresh exited {r.returncode} under STRICT_COVERAGE=1 \u2014 "
             f"resolver did NOT heal the fake country")
    out_path = workspace / "data" / "itaukei-graduate-studies.json"
    if not out_path.exists():
        fail(f"expected output file missing: {out_path}")
    return json.loads(out_path.read_text())


def assert_healed(output: dict) -> None:
    """Assert the resolver healed the injected country + university."""
    # 1. Netherlands should appear in worldPoints with a full row.
    nl_points = [p for p in output["worldPoints"] if p["country"] == TEST_COUNTRY]
    if not nl_points:
        fail(f"{TEST_COUNTRY!r} not present in worldPoints \u2014 "
             f"the fake country was dropped, not resolved")

    p = nl_points[0]
    log(f"worldPoints[{TEST_COUNTRY}]: {p}")

    if not p.get("iso"):
        fail(f"worldPoints[{TEST_COUNTRY}] missing 'iso' \u2014 country ISO "
             f"was NOT auto-resolved")
    if p.get("iso") != "NL":
        fail(f"worldPoints[{TEST_COUNTRY}] iso={p.get('iso')!r}, "
             f"expected 'NL'")

    if p.get("lat") is None or p.get("lng") is None:
        fail(f"worldPoints[{TEST_COUNTRY}] missing lat/lng \u2014 university "
             f"coords were NOT auto-resolved")

    if p.get("region") in (None, "Other"):
        fail(f"worldPoints[{TEST_COUNTRY}] region={p.get('region')!r}, "
             f"expected 'Europe'")

    if TEST_SCHOLAR not in p.get("phdScholars", []):
        fail(f"worldPoints[{TEST_COUNTRY}] phdScholars missing "
             f"{TEST_SCHOLAR!r}: {p.get('phdScholars')}")

    # 2. output["autoResolved"] should contain provenance URLs.
    ar = output.get("autoResolved")
    if not ar:
        fail("output.autoResolved is missing \u2014 resolver ran but did "
             "not record its work")
    log(f"autoResolved.countries: {list(ar.get('countries', {}).keys())}")
    log(f"autoResolved.universities: {list(ar.get('universities', {}).keys())}")

    if TEST_COUNTRY not in ar.get("countries", {}):
        fail(f"autoResolved.countries missing {TEST_COUNTRY!r}")
    if TEST_UNIVERSITY not in ar.get("universities", {}):
        fail(f"autoResolved.universities missing {TEST_UNIVERSITY!r}")

    country_hit = ar["countries"][TEST_COUNTRY]
    uni_hit     = ar["universities"][TEST_UNIVERSITY]
    for label, hit in (("country", country_hit), ("university", uni_hit)):
        src = hit.get("source")
        if not src or not src.startswith("http"):
            fail(f"autoResolved.{label} missing valid 'source' URL: {hit}")
        log(f"{label} provenance: {src}")

    # 3. Totals should count the fake country.
    totals = output.get("totals", {})
    if TEST_SCHOLAR not in [s for s in output.get("scholars", {}).keys()]:
        fail(f"scholars roll-up missing {TEST_SCHOLAR!r}")
    log(f"totals: {totals}")


def main() -> int:
    log("=" * 72)
    log("AUTO-RESOLVER E2E TEST")
    log(f"country: {TEST_COUNTRY} | university: {TEST_UNIVERSITY}")
    log("=" * 72)

    snap = load_snapshot()
    log(f"loaded snapshot: {len(snap['items'])} items, "
        f"{len(snap['collections'])} collections")

    doctored = inject_fake_country(snap)

    with tempfile.TemporaryDirectory(prefix="vave-lab-test-") as tmp:
        ws = Path(tmp)
        # Copy code + data into the workspace, then overwrite the
        # snapshot with our doctored copy.
        for name in ("data", "scripts"):
            shutil.copytree(REPO / name, ws / name, dirs_exist_ok=True)
        (ws / "data" / "itaukei-zotero-snapshot.json").write_text(
            json.dumps(doctored, ensure_ascii=False))

        output = run_refresh(ws)
        assert_healed(output)

    log("")
    log("=" * 72)
    log("PASS: auto-resolver healed the injected country end-to-end")
    log("=" * 72)
    return 0


if __name__ == "__main__":
    sys.exit(main())
