#!/usr/bin/env python3
"""Collaborator access for the China Education Diplomacy dashboard.

grant : decrypt data/china-education-diplomacy.json.enc with REGIONAL_PASSCODE
        and write the same data, encrypted under CEDP_COLLAB_PASSCODE, to
        data/china-education-diplomacy.collab.json.enc (verified before writing).
revoke: delete the collaborator file, so the collaborator passcode stops working.
sync  : like grant, but only if the collaborator file already exists (used after
        each data update so collaborators see the same data).

Plaintext stays in memory; no passcode is printed.
Prints 'granted', 'revoked', 'unchanged' or 'skipped'.
"""
import os, sys
from pathlib import Path
sys.path.insert(0, str(Path(__file__).resolve().parent))
from encrypt_data import MAGIC, derive_key  # noqa: E402
from cryptography.hazmat.primitives.ciphers.aead import AESGCM

root = Path(__file__).resolve().parent.parent
main = root / 'data' / 'china-education-diplomacy.json.enc'
collab = root / 'data' / 'china-education-diplomacy.collab.json.enc'
mode = (sys.argv[1] if len(sys.argv) > 1 else 'grant').lower()


def open_blob(blob, pw):
    b = blob[len(MAGIC):]
    return AESGCM(derive_key(pw, b[:16])).decrypt(b[16:28], b[28:], None)


if mode == 'revoke':
    if collab.exists():
        collab.unlink(); print('revoked')
    else:
        print('unchanged')
    sys.exit(0)
if mode == 'sync' and not collab.exists():
    print('skipped'); sys.exit(0)
if mode not in ('grant', 'sync'):
    sys.exit(f'unknown mode {mode}')

reg, col = os.environ.get('REGIONAL_PASSCODE', ''), os.environ.get('CEDP_COLLAB_PASSCODE', '')
if len(reg) < 12:
    sys.exit('REGIONAL_PASSCODE secret missing')
if len(col) < 12:
    sys.exit('CEDP_COLLAB_PASSCODE secret missing or shorter than 12 characters')
if col == reg:
    sys.exit('CEDP_COLLAB_PASSCODE must differ from the Regional passcode')

plain = open_blob(main.read_bytes(), reg)
if collab.exists():
    try:
        if open_blob(collab.read_bytes(), col) == plain:
            print('unchanged'); sys.exit(0)
    except Exception:
        pass  # passcode rotated or data changed: rebuild
s, iv = os.urandom(16), os.urandom(12)
blob = MAGIC + s + iv + AESGCM(derive_key(col, s)).encrypt(iv, plain, None)
assert open_blob(blob, col) == plain
collab.write_bytes(blob)
print('granted')
