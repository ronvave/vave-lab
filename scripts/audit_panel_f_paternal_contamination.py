#!/usr/bin/env python3
"""
Panel F paternal-geography contamination audit.

Reads the DEPLOYED scholars snapshot (data/itaukei-master-scholars.json.enc)
because that is what the live V2 dashboard actually consumes. The live
Master sheet may be a few edits ahead of the snapshot, but the deployed
contamination is what matters until the next refresh.

Simulates BOTH the pre-fix adapter (paternal-with-maternal-fallback merged
into flat village/island fields, plus effectivePaternalProvince=paternal||
maternal) AND the post-fix adapter (strict paternal only), and flags every
scholar whose Panel F identity line would leak maternal-side data.

Reproduces the V2 formatScholarGeography() behavior in Python so the audit
uses the exact same sentinel scrubbing and mainland-island suppression as
the deployed JS.

Writes:
  docs/panel_f_paternal_contamination.csv
  docs/panel_f_paternal_contamination.md
"""
from __future__ import annotations
import csv
import json
import re
import sys
from pathlib import Path
from typing import Any

from cryptography.hazmat.primitives import hashes
from cryptography.hazmat.primitives.kdf.pbkdf2 import PBKDF2HMAC
from cryptography.hazmat.primitives.ciphers.aead import AESGCM

MAGIC = b"IVAV"
PASSCODE = "Arachnid1!"

# Matches the JS _SENTINELS in js/master-file-adapter.js cleanSentinel_
_ADAPTER_SENTINELS = {"", "unclassified", "unknown", "n/a", "na", "-"}
# Matches the JS _GEO_SENTINELS in js/itaukei-database-master.js
_GEO_SENTINELS_RE = re.compile(
    r"^(unclassified|unknown|n/?a|na|null|undefined|none|-|\.|_)$", re.I
)
_MAINLAND_ISLANDS = re.compile(r"^(viti\s*levu|vanua\s*levu)$", re.I)


def _adapter_clean(cell: Any) -> str:
    if cell is None:
        return ""
    s = str(cell).strip()
    if s.lower() in _ADAPTER_SENTINELS:
        return ""
    return s


def _formatter_clean(v: Any) -> str:
    s = "" if v is None else str(v).strip()
    if not s:
        return ""
    if _GEO_SENTINELS_RE.match(s):
        return ""
    return s


def _normalize_island_stem(v: str) -> str:
    return re.sub(r"\s+(is\.?|island)$", "", v, flags=re.I).strip()


def format_scholar_geography(village: str, island: str, province: str) -> str:
    v = _formatter_clean(village)
    i = _formatter_clean(island)
    p = _formatter_clean(province)
    if i and _MAINLAND_ISLANDS.match(i):
        i = ""
    island_stem = _normalize_island_stem(i) if i else ""
    vlg_part = (v + " vlg") if v else ""
    isl_part = (island_stem + " Is") if island_stem else ""
    prov_part = (p + " Province") if p else ""
    if vlg_part and prov_part:
        locality = (vlg_part + " (" + isl_part + ")") if isl_part else vlg_part
        return locality + ", " + prov_part + "."
    if vlg_part and isl_part:
        return vlg_part + " (" + isl_part + ")"
    if vlg_part:
        return vlg_part
    if isl_part and prov_part:
        return isl_part + ", " + prov_part + "."
    if prov_part:
        return prov_part + "."
    if isl_part:
        return isl_part
    return ""


def _pre_fix_flat_fields(row: dict[str, Any]) -> tuple[str, str, str]:
    """Simulate the OLD adapter's flat `village`/`island`/`province` outputs.
    Old adapter logic:
      village = cleanSentinel_(Village Paternal) || cleanSentinel_(Village Maternal)
      island  = cleanSentinel_(Island  Paternal) || cleanSentinel_(Island  Maternal)
      effectivePaternalProvince = paternal || maternal  (also fell back)
    """
    v = _adapter_clean(row.get("Village Paternal")) or _adapter_clean(
        row.get("Village Maternal")
    )
    i = _adapter_clean(row.get("Island Paternal")) or _adapter_clean(
        row.get("Island Maternal")
    )
    p_pat = _adapter_clean(row.get("Province Paternal"))
    p_mat = _adapter_clean(row.get("Province Maternal"))
    p = p_pat or p_mat
    return v, i, p


def _post_fix_flat_fields(row: dict[str, Any]) -> tuple[str, str, str]:
    """Simulate the FIXED adapter (paternal-only for Panel F identity)."""
    return (
        _adapter_clean(row.get("Village Paternal")),
        _adapter_clean(row.get("Island Paternal")),
        _adapter_clean(row.get("Province Paternal")),
    )


def _derive_key(passcode: str, salt: bytes) -> bytes:
    kdf = PBKDF2HMAC(
        algorithm=hashes.SHA256(), length=32, salt=salt, iterations=200000
    )
    return kdf.derive(passcode.encode("utf-8"))


def _decrypt(path: Path) -> bytes:
    blob = path.read_bytes()
    assert blob[:4] == MAGIC, f"bad magic in {path}"
    salt = blob[4:20]
    iv = blob[20:32]
    body = blob[32:]
    key = _derive_key(PASSCODE, salt)
    aes = AESGCM(key)
    return aes.decrypt(iv, body, associated_data=None)


def _load_scholars_from_snapshot(repo: Path) -> list[dict]:
    enc = repo / "data" / "itaukei-master-scholars.json.enc"
    plaintext = _decrypt(enc)
    data = json.loads(plaintext)
    if isinstance(data, dict) and "scholars" in data:
        return data["scholars"]
    if isinstance(data, list):
        return data
    raise SystemExit(f"unexpected shape: {type(data).__name__}")


def main() -> int:
    repo = Path(__file__).resolve().parent.parent
    docs = repo / "docs"
    docs.mkdir(exist_ok=True)

    scholars = _load_scholars_from_snapshot(repo)
    print(f"Loaded {len(scholars)} scholar rows from deployed snapshot",
          file=sys.stderr)

    contaminated: list[dict[str, str]] = []
    csv_rows: list[dict[str, str]] = []

    for s in scholars:
        sid = (s.get("Scholar ID") or "").strip()
        if not sid:
            continue
        name = (s.get("Scholar Name") or "").strip()

        pv_pre, pi_pre, pp_pre = _pre_fix_flat_fields(s)
        pv_post, pi_post, pp_post = _post_fix_flat_fields(s)

        before = format_scholar_geography(pv_pre, pi_pre, pp_pre)
        after = format_scholar_geography(pv_post, pi_post, pp_post)

        mv = _adapter_clean(s.get("Village Maternal"))
        mi = _adapter_clean(s.get("Island Maternal"))
        mp = _adapter_clean(s.get("Province Maternal"))

        maternal_village_leaked = bool(mv) and pv_pre == mv and pv_post != mv
        maternal_island_leaked = bool(mi) and pi_pre == mi and pi_post != mi
        maternal_province_leaked = bool(mp) and pp_pre == mp and pp_post != mp

        display_diff = before != after

        row = {
            "scholar_id": sid,
            "name": name,
            "paternal_village": _adapter_clean(s.get("Village Paternal")),
            "paternal_island": _adapter_clean(s.get("Island Paternal")),
            "paternal_province": _adapter_clean(s.get("Province Paternal")),
            "maternal_village": mv,
            "maternal_island": mi,
            "maternal_province": mp,
            "before_display": before,
            "after_display": after,
            "display_diff": "Y" if display_diff else "",
            "maternal_village_leaked": "Y" if maternal_village_leaked else "",
            "maternal_island_leaked": "Y" if maternal_island_leaked else "",
            "maternal_province_leaked": "Y" if maternal_province_leaked else "",
        }
        csv_rows.append(row)
        if display_diff:
            contaminated.append(row)

    csv_path = docs / "panel_f_paternal_contamination.csv"
    with csv_path.open("w", newline="", encoding="utf-8") as f:
        if csv_rows:
            w = csv.DictWriter(f, fieldnames=list(csv_rows[0].keys()))
            w.writeheader()
            w.writerows(csv_rows)

    md_path = docs / "panel_f_paternal_contamination.md"
    md_lines = [
        "# Panel F paternal-geography contamination audit — 2026-08-25",
        "",
        "Source: deployed snapshot `data/itaukei-master-scholars.json.enc`.",
        "",
        f"Total scholars scanned: **{len(csv_rows)}**",
        f"Scholars whose pre-fix Panel F line differed from the fixed"
        f" paternal-only line: **{len(contaminated)}**",
        "",
        "## Affected scholars (before → after)",
        "",
        "| Scholar ID | Name | Before (buggy) | After (fixed) | Leaked field(s) |",
        "| :-- | :-- | :-- | :-- | :-- |",
    ]
    for r in contaminated:
        leaks = []
        if r["maternal_village_leaked"]:
            leaks.append("village")
        if r["maternal_island_leaked"]:
            leaks.append("island")
        if r["maternal_province_leaked"]:
            leaks.append("province")
        md_lines.append(
            f"| {r['scholar_id']} | {r['name']} | "
            f"{r['before_display'] or '(empty)'} | "
            f"{r['after_display'] or '(empty)'} | "
            f"{', '.join(leaks) if leaks else '\u2014'} |"
        )
    md_lines.append("")
    md_lines.append("The `leaked field(s)` column names the fields where the "
                    "buggy adapter took a maternal-side value because the "
                    "paternal-side cell was blank or a sentinel "
                    "(`Unclassified`, `Unknown`, `N/A`, `-`).")
    md_path.write_text("\n".join(md_lines), encoding="utf-8")

    print(f"Wrote {csv_path} ({len(csv_rows)} rows)")
    print(f"Wrote {md_path} ({len(contaminated)} affected scholars)")
    return 0


if __name__ == "__main__":
    sys.exit(main())
