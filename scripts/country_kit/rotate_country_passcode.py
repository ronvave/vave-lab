#!/usr/bin/env python3
"""Move a country dashboard onto the owner's own data passcode.

    VAVELAB_<KEY>_PASSCODE=... python3 scripts/country_kit/rotate_country_passcode.py samoa

Same idea as scripts/rotate_regional_passcode.py, for the Tonga-style country
dashboards, which bake their data passcode into js/<key>-demo-gate.js:

1. The current passcode is read from js/<key>-demo-gate.js (BAKED_PASSCODE).
2. Every data/<key>-*.enc file is re-encrypted with the new passcode from the
   VAVELAB_<KEY>_PASSCODE secret. Files that already open with the new
   passcode are left alone, so a re-run is safe.
3. BAKED_PASSCODE (js/<key>-demo-gate.js) and VERIFIER_HASH_HEX
   (js/<key>-db-gate.js) are updated to the new passcode.
4. Optional: VAVELAB_<KEY>_COLLAB_PASSCODE replaces COLLABORATOR_PASSCODE.

Prints only "rotated" or "already rotated". No passcode or plaintext is
printed or written to disk.
"""
from __future__ import annotations

import base64
import hashlib
import os
import re
import sys
from pathlib import Path

from cryptography.hazmat.primitives import hashes
from cryptography.hazmat.primitives.ciphers.aead import AESGCM
from cryptography.hazmat.primitives.kdf.pbkdf2 import PBKDF2HMAC

ROOT = Path(__file__).resolve().parents[2]
MAGIC = b"IVAV"


def derive_key(passcode: str, salt: bytes) -> bytes:
    return PBKDF2HMAC(algorithm=hashes.SHA256(), length=32, salt=salt,
                      iterations=200_000).derive(passcode.encode("utf-8"))


def opens(blob: bytes, pw: str):
    if not blob.startswith(MAGIC):
        return None
    body = blob[len(MAGIC):]
    try:
        return AESGCM(derive_key(pw, body[:16])).decrypt(body[16:28], body[28:], None)
    except Exception:
        return None


def seal(plain: bytes, pw: str) -> bytes:
    salt, iv = os.urandom(16), os.urandom(12)
    return MAGIC + salt + iv + AESGCM(derive_key(pw, salt)).encrypt(iv, plain, None)


def main() -> int:
    key = sys.argv[1]
    KEY = key.upper()
    new = os.environ.get(f"VAVELAB_{KEY}_PASSCODE", "")
    if len(new) < 12:
        sys.exit(f"VAVELAB_{KEY}_PASSCODE secret is missing or shorter than 12 characters")
    collab = os.environ.get(f"VAVELAB_{KEY}_COLLAB_PASSCODE", "")
    if collab and len(collab) < 12:
        sys.exit(f"VAVELAB_{KEY}_COLLAB_PASSCODE is shorter than 12 characters")
    if collab and collab == new:
        sys.exit("The collaborator passcode must differ from the data passcode")

    demo = ROOT / "js" / f"{key}-demo-gate.js"
    gate = ROOT / "js" / f"{key}-db-gate.js"
    dtext = demo.read_text()
    m = re.search(r"var BAKED_PASSCODE = atob\('([^']*)'\)", dtext)
    if not m:
        sys.exit("BAKED_PASSCODE not found")
    old = base64.b64decode(m.group(1)).decode("utf-8")

    changed = False
    for f in sorted((ROOT / "data").glob(f"{key}-*.enc")):
        blob = f.read_bytes()
        if opens(blob, new) is not None:
            continue
        plain = opens(blob, old)
        if plain is None:
            sys.exit(f"{f.name} opens with neither the current nor the new passcode")
        f.write_bytes(seal(plain, new))
        changed = True

    b64 = lambda s: base64.b64encode(s.encode("utf-8")).decode()
    d2 = re.sub(r"(var BAKED_PASSCODE = atob\(')[^']*('\))", lambda x: x.group(1) + b64(new) + x.group(2), dtext)
    if collab:
        d2 = re.sub(r"(var COLLABORATOR_PASSCODE = atob\(')[^']*('\))",
                    lambda x: x.group(1) + b64(collab) + x.group(2), d2)
    if d2 != dtext:
        demo.write_text(d2)
        changed = True

    v = hashlib.pbkdf2_hmac("sha256", new.encode("utf-8"), b"vavelab-db-verifier-v1", 200_000).hex()
    gtext = gate.read_text()
    g2 = re.sub(r"(VERIFIER_HASH_HEX\s*=\s*')[0-9a-f]+(')", lambda x: x.group(1) + v + x.group(2), gtext)
    if g2 != gtext:
        gate.write_text(g2)
        changed = True

    print("rotated" if changed else "already rotated")
    return 0


if __name__ == "__main__":
    sys.exit(main())
