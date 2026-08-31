#!/usr/bin/env python3
"""Sister clone of scripts/decrypt_data.py for the Samoa Scholar Database.

Reads AES-GCM-encrypted data/samoa-*.json.enc back to plaintext. Same wire
format as samoa_encrypt_data.py. NEVER touches non-Samoa jurisdictions.
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

# Match samoa_encrypt_data.TARGETS
TARGETS = [
    "samoa-districts.geojson",
    "samoa-world-universities.json",
    "samoa-workplace-coords.json",
    "samoa-uni-country-overrides.json",
    "samoa-auto-resolved.json",
    "samoa-last-master-sync.json",
    "samoa-scholar-insights.json",
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

_FORBIDDEN_PREFIXES = ("itaukei-", "tongan-", "tonga-", "solomon-")


def _get_passcode() -> bytes:
    pw = os.environ.get("VAVELAB_SAMOA_PASSCODE")
    if not pw:
        raise SystemExit(
            "VAVELAB_SAMOA_PASSCODE not set. Refusing to decrypt without a passcode."
        )
    return pw.encode("utf-8")


def _refuse_cross_system(name: str) -> None:
    if any(name.startswith(p) for p in _FORBIDDEN_PREFIXES):
        raise SystemExit(
            f"REFUSING TO DECRYPT {name!r}: this looks like a non-Samoa target."
        )


def _derive_key(passcode: bytes, salt: bytes) -> bytes:
    kdf = PBKDF2HMAC(
        algorithm=hashes.SHA256(),
        length=32,
        salt=salt,
        iterations=ITERATIONS,
    )
    return kdf.derive(passcode)


def decrypt_one(name: str, passcode: bytes) -> Path:
    _refuse_cross_system(name)
    src = DATA_DIR / (name + ".enc")
    if not src.exists():
        raise FileNotFoundError(f"Ciphertext not found: {src}")
    data = src.read_bytes()
    if data[:4] != MAGIC:
        raise ValueError(f"{src}: bad magic (not an IVAV blob)")
    salt = data[4:20]
    iv = data[20:32]
    ct = data[32:]
    key = _derive_key(passcode, salt)
    aes = AESGCM(key)
    plaintext = aes.decrypt(iv, ct, None)
    out = DATA_DIR / name
    out.write_bytes(plaintext)
    return out


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--all", action="store_true", help="Decrypt every known TARGETS file.")
    ap.add_argument("files", nargs="*", help="Specific filenames to decrypt.")
    args = ap.parse_args()

    pw = _get_passcode()
    names = TARGETS if args.all else args.files
    if not names:
        ap.print_help()
        return 2

    ok = 0
    for name in names:
        try:
            out = decrypt_one(name, pw)
            print(f"decrypted -> {out.relative_to(ROOT)}")
            ok += 1
        except FileNotFoundError as e:
            print(f"skip: {e}", file=sys.stderr)
        except Exception as e:
            print(f"error: {name}: {e}", file=sys.stderr)
    print(f"\n{ok}/{len(names)} decrypted.")
    return 0 if ok else 1


if __name__ == "__main__":
    sys.exit(main())
