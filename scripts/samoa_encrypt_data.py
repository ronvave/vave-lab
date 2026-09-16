#!/usr/bin/env python3
"""Sister clone of scripts/encrypt_data.py for the Samoa Scholar Database.

Encrypt the plaintext JSON data files with the Samoa-specific passcode
with a Samoa-only passcode. The guard at _FORBIDDEN_PREFIXES refuses to
encrypt any file whose name begins with a sister-system data-file prefix.

Wire format:

  file bytes = magic (4)  ||  salt (16)  ||  iv (12)  ||  ciphertext+tag
  magic         = b"IVAV"
  salt          = per-file random bytes for PBKDF2-SHA256 (200k iters)
  iv            = per-file random 96-bit nonce for AES-GCM
  ciphertext+tag= AES-GCM(key, iv, plaintext)

Passcode comes from VAVELAB_SAMOA_PASSCODE env variable. Never commit it.

CLI:
  python scripts/samoa_encrypt_data.py                                # encrypt every known target
  python scripts/samoa_encrypt_data.py samoa-master-scholars.json     # encrypt only listed files
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

# Every file the Samoa dashboard/admin fetches. Anything not on this list
# stays plaintext.
TARGETS = [
    # Reference / geometry
    "samoa-districts.geojson",
    "samoa-world-universities.json",
    "samoa-workplace-coords.json",
    "samoa-uni-country-overrides.json",
    "samoa-auto-resolved.json",
    # Sync state
    "samoa-last-master-sync.json",
    "samoa-scholar-insights.json",
    # Master-file V2 snapshots
    "samoa-master-scholars.json",
    "samoa-master-part-indigenous.json",
    "samoa-master-publications.json",
    "samoa-master-authorship.json",
    "samoa-master-researcher-authorship.json",
    "samoa-master-grad-degrees.json",
    "samoa-master-mobility.json",
    "samoa-master-geography.json",
    "samoa-master-geography-coordinates.json",
    "samoa-master-aggregates.json",
    "samoa-master-worldpoints.json",
    "samoa-body-composition-master.json",
]

# Guard: refuse to encrypt a file whose basename belongs to another jurisdiction.
_FORBIDDEN_PREFIXES = ("itaukei-", "tongan-", "tonga-", "solomon-")


def _refuse_cross_system(name: str) -> None:
    if any(name.startswith(p) for p in _FORBIDDEN_PREFIXES):
        raise SystemExit(
            f"REFUSING TO ENCRYPT {name!r}: this looks like a non-Samoa "
            f"target. samoa_encrypt_data.py must only write data/samoa-* files."
        )


def _get_passcode() -> bytes:
    pw = os.environ.get("VAVELAB_SAMOA_PASSCODE")
    if not pw:
        raise SystemExit(
            "VAVELAB_SAMOA_PASSCODE not set. Refusing to encrypt without a "
            "passcode. This env var is Samoa-only; do not paste any other "
            "jurisdiction's passcode here."
        )
    return pw.encode("utf-8")


def _derive_key(passcode: bytes, salt: bytes) -> bytes:
    kdf = PBKDF2HMAC(
        algorithm=hashes.SHA256(),
        length=32,
        salt=salt,
        iterations=ITERATIONS,
    )
    return kdf.derive(passcode)


def encrypt_one(name: str, passcode: bytes) -> Path:
    _refuse_cross_system(name)
    src = DATA_DIR / name
    if not src.exists():
        raise FileNotFoundError(f"Plaintext not found: {src}")
    salt = os.urandom(16)
    iv = os.urandom(12)
    key = _derive_key(passcode, salt)
    aes = AESGCM(key)
    plaintext = src.read_bytes()
    ciphertext = aes.encrypt(iv, plaintext, None)
    out = src.with_suffix(src.suffix + ".enc")
    out.write_bytes(MAGIC + salt + iv + ciphertext)
    return out


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("files", nargs="*", help="Filenames within data/ to encrypt. Default: all known TARGETS.")
    args = ap.parse_args()

    pw = _get_passcode()
    names = args.files or TARGETS
    encrypted = []
    for name in names:
        if name not in TARGETS:
            print(f"WARN: {name} not in TARGETS list; encrypting anyway (guard still applies)", file=sys.stderr)
        try:
            out = encrypt_one(name, pw)
            print(f"encrypted -> {out.relative_to(ROOT)}")
            encrypted.append(name)
        except FileNotFoundError as e:
            print(f"skip: {e}", file=sys.stderr)
    print(f"\n{len(encrypted)} file(s) encrypted.")
    return 0


if __name__ == "__main__":
    sys.exit(main())
