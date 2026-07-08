#!/usr/bin/env python3
"""Encrypt the plaintext JSON data files with a shared passcode.

The database page's client-side JS decrypts them via WebCrypto after a
successful lock-screen entry. Format used by both sides:

  file bytes = magic (4)  ||  salt (16)  ||  iv (12)  ||  ciphertext+tag

  magic         = b"IVAV" (marks a Vave-Lab encrypted blob, version 1)
  salt          = random bytes fed to PBKDF2-SHA256 (200k iterations) to
                  derive a 256-bit AES key from the passcode. Salt is
                  SHARED across every file in a given build so the JS
                  side only pays the PBKDF2 cost once per session.
  iv            = per-file random 96-bit nonce for AES-GCM
  ciphertext+tag= AES-GCM(key, iv, plaintext) \u2014 includes the 16-byte tag

Passcode comes from the VAVELAB_PASSCODE env variable at build time.
Never commit the passcode.
"""
from __future__ import annotations

import json
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

# Every file the database JS fetches. Anything not on this list stays
# plaintext (public map geometry is fine to leave open).
TARGETS = [
    "itaukei-zotero-snapshot.json",
    "world-universities.json",
    "fiji-provinces.json",
    "scholar-profiles.json",
    "last-sync.json",
    "itaukei-graduate-studies.json",
    "scholar-insights.json",
    # Also encrypt the province GeoJSON so nobody can enumerate scholars
    # by joining lat/lng to villages. Small, negligible cost.
    "fiji-provinces.geojson",
]


def derive_key(passcode: str, salt: bytes) -> bytes:
    kdf = PBKDF2HMAC(
        algorithm=hashes.SHA256(),
        length=32,
        salt=salt,
        iterations=ITERATIONS,
    )
    return kdf.derive(passcode.encode("utf-8"))


def encrypt_body(plaintext: bytes, key: bytes) -> bytes:
    iv = os.urandom(12)
    aes = AESGCM(key)
    ct = aes.encrypt(iv, plaintext, associated_data=None)
    return iv + ct


def main() -> int:
    passcode = os.environ.get("VAVELAB_PASSCODE")
    if not passcode:
        print("ERROR: set VAVELAB_PASSCODE in the environment.", file=sys.stderr)
        return 1

    # One salt + one derived key per build. The JS side does PBKDF2 exactly
    # once per session and reuses the resulting key across every .enc file.
    salt = os.urandom(16)
    key = derive_key(passcode, salt)
    header = MAGIC + salt  # 20 bytes, prepended to every file

    missing: list[str] = []
    for name in TARGETS:
        src = DATA_DIR / name
        if not src.exists():
            missing.append(name)
            continue
        dst = DATA_DIR / (name + ".enc")
        plaintext = src.read_bytes()
        body = encrypt_body(plaintext, key)
        blob = header + body
        dst.write_bytes(blob)
        print(
            f"  encrypted {name} \u2192 {name}.enc "
            f"({len(plaintext):>7,} B \u2192 {len(blob):>7,} B)"
        )

    if missing:
        print("\nWARNING: skipped (not found):", ", ".join(missing), file=sys.stderr)
    return 0


if __name__ == "__main__":
    sys.exit(main())
