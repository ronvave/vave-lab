#!/usr/bin/env python3
"""One-off: re-encrypt the China Education Diplomacy dashboard data.

Reads data/cedp-patch.enc (IVAV v1, one-time key in CEDP_PATCH_KEY), re-encrypts
it under REGIONAL_PASSCODE as data/china-education-diplomacy.json.enc, verifies
that the new file opens, and deletes the patch. Plaintext stays in memory.
Prints 'encrypted <sha256-of-plaintext>' or 'no patch'.
"""
import hashlib, os, sys
from pathlib import Path
sys.path.insert(0, str(Path(__file__).resolve().parent))
from encrypt_data import MAGIC, derive_key  # noqa: E402
from cryptography.hazmat.primitives.ciphers.aead import AESGCM

root = Path(__file__).resolve().parent.parent
patch, out = root / 'data' / 'cedp-patch.enc', root / 'data' / 'china-education-diplomacy.json.enc'
if not patch.exists():
    print('no patch'); sys.exit(0)
key, pw = os.environ.get('CEDP_PATCH_KEY', ''), os.environ.get('REGIONAL_PASSCODE', '')
if not key or len(pw) < 12:
    sys.exit('CEDP_PATCH_KEY or REGIONAL_PASSCODE secret missing')
b = patch.read_bytes()[len(MAGIC):]
plain = AESGCM(derive_key(key, b[:16])).decrypt(b[16:28], b[28:], None)
s, iv = os.urandom(16), os.urandom(12)
blob = MAGIC + s + iv + AESGCM(derive_key(pw, s)).encrypt(iv, plain, None)
c = blob[len(MAGIC):]
assert AESGCM(derive_key(pw, c[:16])).decrypt(c[16:28], c[28:], None) == plain
out.write_bytes(blob); patch.unlink()
print('encrypted', hashlib.sha256(plain).hexdigest())
