#!/usr/bin/env python3
"""Re-encrypt data/regional-scholars.json.enc under a new passcode (IVAV v1).

Env: REGIONAL_PASSCODE (new, required); REGIONAL_PASSCODE_CURRENT (old).
Exit 0 with "already rotated" if the bundle already opens with the new passcode.
Plaintext is held in memory only and never written to disk.
"""
import os, sys
from pathlib import Path
sys.path.insert(0, str(Path(__file__).resolve().parent))
from encrypt_data import MAGIC, derive_key  # noqa: E402
from cryptography.hazmat.primitives.ciphers.aead import AESGCM

enc = Path(__file__).resolve().parent.parent / 'data' / 'regional-scholars.json.enc'
new, old = os.environ.get('REGIONAL_PASSCODE', ''), os.environ.get('REGIONAL_PASSCODE_CURRENT', '')
if len(new) < 12:
    sys.exit('REGIONAL_PASSCODE secret is missing or shorter than 12 characters')
blob = enc.read_bytes()
assert blob[:len(MAGIC)] == MAGIC, 'unexpected file format'
body = blob[len(MAGIC):]
salt, iv, ct = body[:16], body[16:28], body[28:]

def opens(pw):
    try:
        return AESGCM(derive_key(pw, salt)).decrypt(iv, ct, None)
    except Exception:
        return None

if opens(new) is not None:
    print('already rotated'); sys.exit(0)
plain = opens(old) if old else None
if plain is None:
    sys.exit('Could not open the bundle with REGIONAL_PASSCODE_CURRENT')
s2, iv2 = os.urandom(16), os.urandom(12)
enc.write_bytes(MAGIC + s2 + iv2 + AESGCM(derive_key(new, s2)).encrypt(iv2, plain, None))
print('rotated')
