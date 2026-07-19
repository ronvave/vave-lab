#!/usr/bin/env python3
"""Decrypt one or more .enc data files back to plaintext.

Used by the GitHub Actions refresh workflow to bootstrap gitignored files
(fiji-provinces.geojson, world-universities.json, etc.) that the refresh
scripts need but that no longer ship in the repo as plaintext.

Blob format matches scripts/encrypt_data.py:

  file bytes = magic(4) || salt(16) || iv(12) || ciphertext+tag

Usage:
  # Decrypt everything on the TARGETS list (if the .enc exists)
  VAVELAB_PASSCODE=... python3 scripts/decrypt_data.py --all

  # Decrypt a specific file
  VAVELAB_PASSCODE=... python3 scripts/decrypt_data.py fiji-provinces.geojson
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
    "itaukei-zotero-snapshot.json",
    "world-universities.json",
    "fiji-provinces.json",
    "scholar-profiles.json",
    "last-sync.json",
    "itaukei-graduate-studies.json",
    "scholar-insights.json",
    "fiji-provinces.geojson",
    "workplace-coords.json",
    "uni-country-overrides.json",
    # Auto-resolver cache — see encrypt_data.py comment.
    "auto-resolved.json",
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

    passcode = os.environ.get("VAVELAB_PASSCODE")
    if not passcode:
        print("ERROR: set VAVELAB_PASSCODE in the environment.", file=sys.stderr)
        return 1

    names = TARGETS if args.all else args.names
    if not names:
        ap.print_usage()
        return 2

    ok = 0
    for name in names:
        if decrypt_one(name, passcode):
            ok += 1
    print(f"decrypted {ok}/{len(names)} file(s)")
    return 0 if ok == len(names) else 1


if __name__ == "__main__":
    sys.exit(main())
