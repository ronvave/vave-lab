#!/usr/bin/env python3
"""Merge an encrypted data patch into data/regional-scholars.json.enc in CI.

Used when new derived sections (e.g. the Pacific Firsts timeline) must be added
to the encrypted regional bundle without anyone outside GitHub knowing the
dashboard passcode, and without plaintext ever being committed.

  data/regional-patch.enc  = 12-byte IV + AES-256-GCM ciphertext of a JSON
                             object, key = base64 REGIONAL_PATCH_KEY secret.
Only whitelisted top-level keys are merged. The bundle is decrypted with
REGIONAL_PASSCODE, patched, re-encrypted with the same passcode (fresh salt
and IV), and the patch file is deleted. Prints 'merged' or 'nopatch'.
"""
import base64, json, os, sys
from pathlib import Path
sys.path.insert(0, str(Path(__file__).resolve().parent))
from encrypt_data import MAGIC, derive_key  # noqa: E402
from cryptography.hazmat.primitives.ciphers.aead import AESGCM

ALLOWED = {'firsts', 'positions', 'directory', 'studyMap', 'posCards'}
ROOT = Path(__file__).resolve().parent.parent
enc, patch = ROOT / 'data' / 'regional-scholars.json.enc', ROOT / 'data' / 'regional-patch.enc'
if not patch.exists():
    print('nopatch'); sys.exit(0)
pw, pk = os.environ.get('REGIONAL_PASSCODE'), os.environ.get('REGIONAL_PATCH_KEY')
if not pw or not pk:
    sys.exit('REGIONAL_PASSCODE and REGIONAL_PATCH_KEY are required')
blob = enc.read_bytes()
assert blob[:len(MAGIC)] == MAGIC, 'unexpected file format'
body = blob[len(MAGIC):]
salt, iv, ct = body[:16], body[16:28], body[28:]
data = json.loads(AESGCM(derive_key(pw, salt)).decrypt(iv, ct, None))
p = patch.read_bytes()
upd = json.loads(AESGCM(base64.b64decode(pk)).decrypt(p[:12], p[12:], None))
bad = set(upd) - ALLOWED
if bad:
    sys.exit(f'patch contains keys that are not allowed: {sorted(bad)}')
data.update(upd)
plain = json.dumps(data, ensure_ascii=False, separators=(',', ':')).encode()
s2, iv2 = os.urandom(16), os.urandom(12)
enc.write_bytes(MAGIC + s2 + iv2 + AESGCM(derive_key(pw, s2)).encrypt(iv2, plain, None))
patch.unlink()
print('merged')
