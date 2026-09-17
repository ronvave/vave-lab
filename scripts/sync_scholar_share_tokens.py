#!/usr/bin/env python3
"""Keep direct-profile share tokens aligned with the authoritative scholar roster."""

from __future__ import annotations

import argparse
import hashlib
import json
import re
import secrets
from pathlib import Path


ID_RE = re.compile(r"^ITK-S\d{4}$")
HEX40_RE = re.compile(r"^[0-9a-f]{40}$")


def load_json(path: Path, default: dict) -> dict:
    if not path.exists():
        return default
    return json.loads(path.read_text(encoding="utf-8"))


def write_json(path: Path, value: dict) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    # Preserve the established compact, Scholar-ID insertion order so adding
    # one scholar changes only that scholar's two shard files.
    path.write_text(json.dumps(value, separators=(",", ":")), encoding="utf-8")


def scholar_ids(path: Path) -> set[str]:
    doc = load_json(path, {})
    # The Master-file transformer writes this snapshot as a JSON list.  Keep
    # support for the older {"scholars": [...]} envelope, but never call
    # .get() on a list: that would abort every refresh before deployment.
    if isinstance(doc, list):
        rows = doc
    elif isinstance(doc, dict):
        rows = doc.get("scholars", [])
    else:
        rows = []
    ids = {
        str(row.get("Scholar ID", "")).strip().upper()
        for row in rows
        if isinstance(row, dict)
    }
    invalid = sorted(sid for sid in ids if sid and not ID_RE.fullmatch(sid))
    if invalid:
        raise SystemExit("Invalid Scholar ID(s): " + ", ".join(invalid))
    return {sid for sid in ids if ID_RE.fullmatch(sid)}


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--scholars", type=Path, default=Path("data/itaukei-master-scholars.json"))
    parser.add_argument("--add-id", action="append", default=[])
    parser.add_argument("--no-prune", action="store_true")
    parser.add_argument("--data-dir", type=Path, default=Path("data"))
    args = parser.parse_args()

    roster = set()
    if args.scholars.exists():
        roster = scholar_ids(args.scholars)
    roster.update(str(sid).strip().upper() for sid in args.add_id)
    if not roster or any(not ID_RE.fullmatch(sid) for sid in roster):
        raise SystemExit("A valid authoritative scholar roster is required")

    public_dir = args.data_dir / "share-public"
    index_dir = args.data_dir / "share-index"
    public_docs = []
    tokens: dict[str, str] = {}
    for shard in range(5):
        doc = load_json(public_dir / f"{shard}.json", {"m": {}})
        public_docs.append(doc)
        tokens.update(doc.get("m", {}))

    if not args.no_prune:
        tokens = {sid: token for sid, token in tokens.items() if sid in roster}
    new_ids = []
    for sid in sorted(roster):
        token = str(tokens.get(sid, "")).lower()
        if not HEX40_RE.fullmatch(token):
            tokens[sid] = secrets.token_hex(20)
            new_ids.append(sid)

    hex_digits = "0123456789abcdef"
    private_docs = {
        shard: load_json(index_dir / f"{shard}.json", {"v": 1, "m": {}})
        for shard in hex_digits
    }

    # Preserve every existing shard and insertion order. New Scholar IDs are
    # appended to the final public shard; their reverse hash goes to its
    # natural hexadecimal shard.
    for doc in public_docs:
        doc["m"] = {
            sid: token for sid, token in doc.get("m", {}).items()
            if sid in tokens
        }
    for sid in new_ids:
        public_docs[-1]["m"][sid] = tokens[sid]

    for doc in private_docs.values():
        doc["m"] = {
            cap_hash: sid for cap_hash, sid in doc.get("m", {}).items()
            if sid in tokens
        }
    indexed_ids = {sid for doc in private_docs.values() for sid in doc["m"].values()}
    for sid, token in tokens.items():
        if sid in indexed_ids:
            continue
        cap_hash = hashlib.sha256(token.encode("ascii")).hexdigest()[:32]
        private_docs[cap_hash[0]]["m"][cap_hash] = sid

    for shard, doc in enumerate(public_docs):
        write_json(public_dir / f"{shard}.json", doc)
    for shard, doc in private_docs.items():
        write_json(index_dir / f"{shard}.json", doc)

    print(f"Share tokens synchronized for {len(tokens)} scholars.")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
