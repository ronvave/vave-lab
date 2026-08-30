#!/usr/bin/env python3
"""Sister clone of scripts/decrypt_data.py for the Tongan Scholar Database.

Decrypt one or more .enc data files back to plaintext.

Used by the GitHub Actions refresh workflow to bootstrap gitignored files
(fiji-provinces.geojson, world-universities.json, etc.) that the refresh
scripts need but that no longer ship in the repo as plaintext.

Blob format matches scripts/encrypt_data.py:

  file bytes = magic(4) || salt(16) || iv(12) || ciphertext+tag

Usage:
  # Decrypt everything on the TARGETS list (if the .enc exists)
  VAVELAB_TONGAN_PASSCODE=... python3 scripts/tongan_decrypt_data.py --all

  # Decrypt a specific file
  VAVELAB_TONGAN_PASSCODE=... python3 scripts/tongan_decrypt_data.py tonga-districts.geojson
"""
from __future__ import annotations

import argparse
import os
import sys
from pathlib import Path

from cryptography.hazmat.primitives import hashes
from cryptography.hazmat.primitives.kdf.pbkdf2 import PBKDF2HMAC
from cryptography.hazmat.primitives.ciphers.aead import AESGCM

MAGIC = b"IVAV"
ITERATIONS = 200_000

ROOT = Path(__file__).resolve().parent.parent
DATA_DIR = ROOT / "data"

# Kept in sync with encrypt_data.py so --all works symmetrically.
TARGETS = [
    "tongan-zotero-snapshot.json",
    "tongan-world-universities.json",
    "tonga-districts.json",
    "tongan-scholar-profiles.json",
    "tongan-last-sync.json",
    "tongan-graduate-studies.json",
    "tongan-scholar-insights.json",
    "tonga-districts.geojson",
    "tongan-workplace-coords.json",
    "tongan-uni-country-overrides.json",
    "tongan-auto-resolved.json",
    "tongan-master-scholars.json",
    "tongan-master-publications.json",
    "tongan-master-authorship.json",
    "tongan-master-grad-degrees.json",
    "tongan-master-mobility.json",
    "tongan-master-geography.json",
    "tongan-master-geography-coordinates.json",
    "tongan-master-aggregates.json",
    "tongan-master-worldpoints.json",
    "tongan-last-master-sync.json",
]


def derive_key(passcode: str, salt: bytes) -> bytes:
    kdf = PBKDF2HMAC(
        algorithm=hashes.SHA256(),
        length=32,
        salt=salt,
        iterations=ITERATIONS,
    )
    return kdf.derive(passcode.encode("utf-8"))


def decrypt_blob(blob: bytes, passcode: str) -> bytes:
    if len(blob) < 4 + 16 + 12 + 16 or blob[:4] != MAGIC:
        raise ValueError("not a Vave-Lab encrypted blob")
    salt = blob[4:20]
    iv = blob[20:32]
    ct = blob[32:]
    key = derive_key(passcode, salt)
    return AESGCM(key).decrypt(iv, ct, associated_data=None)


def decrypt_one(name: str, passcode: str) -> bool:
    src = DATA_DIR / (name + ".enc")
    dst = DATA_DIR / name
    if not src.exists():
        print(f"  skip {name}: no {src.name}", file=sys.stderr)
        return False
    plaintext = decrypt_blob(src.read_bytes(), passcode)
    dst.write_bytes(plaintext)
    print(f"  decrypted {src.name} \u2192 {name} ({len(plaintext):>7,} B)")
    return True


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("names", nargs="*", help="File names under data/ to decrypt")
    ap.add_argument("--all", action="store_true", help="Decrypt every known target")
    args = ap.parse_args()

    passcode = os.environ.get("VAVELAB_TONGAN_PASSCODE")
    if not passcode:
        print("ERROR: set VAVELAB_TONGAN_PASSCODE in the environment.", file=sys.stderr)
        return 1

    names = TARGETS if args.all else args.names
    if not names:
        ap.print_usage()
        return 2

    ok = 0
    missing = 0
    for name in names:
        src = DATA_DIR / (name + ".enc")
        if not src.exists():
            missing += 1
        if decrypt_one(name, passcode):
            ok += 1
    print(f"decrypted {ok}/{len(names)} file(s)")
    # In --all mode, tolerate a target that hasn't been encrypted yet
    # (bootstrap case for new files like data/auto-resolved.json).
    # Individual-name invocations still fail loudly.
    if args.all:
        return 0 if ok + missing == len(names) else 1
    return 0 if ok == len(names) else 1


if __name__ == "__main__":
    sys.exit(main())
