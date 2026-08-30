#!/usr/bin/env python3
"""Sister clone of scripts/encrypt_data.py for the Solomon Islands Scholar Database.

Encrypt the plaintext JSON data files with the Solomon Islands-specific passcode
(distinct from the iTaukei/Solomon Islands/Solomon Islands sister system's). Never touches data/itaukei-* targets.

The database page's client-side JS decrypts them via WebCrypto after a
successful lock-screen entry. Format used by both sides:

  file bytes = magic (4)  ||  salt (16)  ||  iv (12)  ||  ciphertext+tag

  magic         = b"IVAV" (marks a Vave-Lab encrypted blob, version 1)
  salt          = per-file random bytes fed to PBKDF2-SHA256 (200k iters)
                  to derive the 256-bit AES key from the passcode. Each
                  .enc file is fully self-describing: readers derive the
                  key from (passcode, salt-from-this-file). There is NO
                  shared-salt invariant across files — writers (this
                  script, the admin browser, workflows) can encrypt any
                  single file independently with a fresh salt and every
                  other file stays decryptable.
  iv            = per-file random 96-bit nonce for AES-GCM
  ciphertext+tag= AES-GCM(key, iv, plaintext) — includes the 16-byte tag

Passcode comes from the VAVELAB_SOLOMON_PASSCODE env variable (distinct
from the iTaukei/Solomon Islands/Solomon Islands sister system's VAVELAB_PASSCODE). Never commit it.

CLI:
  python scripts/solomon_encrypt_data.py              # encrypt every known
                                                    #   target whose
                                                    #   plaintext exists
  python scripts/solomon_encrypt_data.py solomon-scholar-profiles.json  # encrypt only
                                                        #   the listed
                                                        #   files
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

# Every file the database JS fetches. Anything not on this list stays
# plaintext (public map geometry is fine to leave open).
TARGETS = [
    "solomon-zotero-snapshot.json",
    "solomon-world-universities.json",
    "solomon-islands-provinces.json",
    "solomon-scholar-profiles.json",
    "solomon-last-sync.json",
    "solomon-graduate-studies.json",
    "solomon-scholar-insights.json",
    "solomon-workplace-coords.json",
    "solomon-islands-provinces.geojson",
    "solomon-uni-country-overrides.json",
    "solomon-auto-resolved.json",
    "solomon-body-composition.json",
    # ==== Master-file V2 preview snapshots ====
    "solomon-master-scholars.json",
    "solomon-master-publications.json",
    "solomon-master-authorship.json",
    "solomon-master-researcher-authorship.json",
    "solomon-master-grad-degrees.json",
    "solomon-master-mobility.json",
    "solomon-master-geography.json",
    "solomon-master-geography-coordinates.json",
    "solomon-master-aggregates.json",
    "solomon-master-worldpoints.json",
    "solomon-body-composition-master.json",
    "solomon-last-master-sync.json",
    # ==== Additional Master-file sheets with no direct Tongan/iTaukei
    #      equivalent (Solomon-specific rosters/registers) ====
    "solomon-master-institutions.json",
    "solomon-master-researchers.json",
    "solomon-master-awards.json",
    "solomon-master-funding.json",
    "solomon-master-positions.json",
]


def derive_key(passcode: str, salt: bytes) -> bytes:
    kdf = PBKDF2HMAC(
        algorithm=hashes.SHA256(),
        length=32,
        salt=salt,
        iterations=ITERATIONS,
    )
    return kdf.derive(passcode.encode("utf-8"))


def encrypt_one(name: str, passcode: str) -> bool:
    """Encrypt a single plaintext file with its own fresh random salt.

    Returns True if the file was encrypted, False if the plaintext was
    missing (caller decides whether that's a warning or an error).
    """
    src = DATA_DIR / name
    if not src.exists():
        return False
    salt = os.urandom(16)
    key = derive_key(passcode, salt)
    iv = os.urandom(12)
    aes = AESGCM(key)
    plaintext = src.read_bytes()
    body = aes.encrypt(iv, plaintext, associated_data=None)
    blob = MAGIC + salt + iv + body
    dst = DATA_DIR / (name + ".enc")
    dst.write_bytes(blob)
    print(
        f"  encrypted {name} \u2192 {name}.enc "
        f"({len(plaintext):>7,} B \u2192 {len(blob):>7,} B, "
        f"salt={salt.hex()[:8]}\u2026)"
    )
    return True


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument(
        "names",
        nargs="*",
        help=(
            "File names under data/ to encrypt (e.g. scholar-profiles.json). "
            "If omitted, encrypts every known target whose plaintext exists."
        ),
    )
    args = ap.parse_args()

    passcode = os.environ.get("VAVELAB_SOLOMON_PASSCODE")
    if not passcode:
        print("ERROR: set VAVELAB_SOLOMON_PASSCODE in the environment.", file=sys.stderr)
        return 1

    if args.names:
        names = args.names
        # Validate the caller isn't sneaking in an unknown target.
        unknown = [n for n in names if n not in TARGETS]
        if unknown:
            print(
                f"ERROR: unknown target(s): {', '.join(unknown)}\n"
                f"Known: {', '.join(TARGETS)}",
                file=sys.stderr,
            )
            return 2
    else:
        names = TARGETS

    missing: list[str] = []
    for name in names:
        if not encrypt_one(name, passcode):
            missing.append(name)

    if missing:
        print(
            "\nWARNING: skipped (plaintext not found): " + ", ".join(missing),
            file=sys.stderr,
        )
    return 0


if __name__ == "__main__":
    sys.exit(main())
