#!/usr/bin/env python3
"""Time-limited, password-free viewer copy of the Regional dashboard data.

The viewer link (#view=<key>) opens data/regional-scholars.viewer.enc, a copy
of the regional bundle encrypted with REGIONAL_VIEWER_KEY instead of the
regional passcode. The real passcode never reaches a viewer's browser.
data/regional-viewer-access.json holds only the expiry (no secrets).

create: start the link (writes the expiry file and the viewer copy).
sync:   keep the viewer copy in step with the live bundle while the link is
        active; re-encrypts only when the decrypted content differs, so
        unchanged data never changes the file. Removes both files once the
        expiry has passed.
remove: end the link now (deletes both files).

Env: REGIONAL_PASSCODE, REGIONAL_VIEWER_KEY, VIEWER_EXPIRES (create only,
ISO 8601 with timezone). Prints "created", "updated", "removed" or
"unchanged". Secrets and plaintext are never printed or written to disk.
"""
import json, os, sys
from datetime import datetime, timezone
from pathlib import Path
sys.path.insert(0, str(Path(__file__).resolve().parent))
from encrypt_data import MAGIC, derive_key  # noqa: E402
from cryptography.hazmat.primitives.ciphers.aead import AESGCM

DATA = Path(__file__).resolve().parent.parent / 'data'
BUNDLE = DATA / 'regional-scholars.json.enc'
VIEWER = DATA / 'regional-scholars.viewer.enc'
META = DATA / 'regional-viewer-access.json'


def opens(blob, pw):
    if blob[:len(MAGIC)] != MAGIC:
        return None
    body = blob[len(MAGIC):]
    try:
        return AESGCM(derive_key(pw, body[:16])).decrypt(body[16:28], body[28:], None)
    except Exception:
        return None


def seal(plain, pw):
    salt, iv = os.urandom(16), os.urandom(12)
    return MAGIC + salt + iv + AESGCM(derive_key(pw, salt)).encrypt(iv, plain, None)


def now_ms():
    return int(datetime.now(timezone.utc).timestamp() * 1000)


def secrets():
    pw, key = os.environ.get('REGIONAL_PASSCODE', ''), os.environ.get('REGIONAL_VIEWER_KEY', '')
    if len(key) < 24:
        sys.exit('REGIONAL_VIEWER_KEY secret is missing or too short')
    plain = opens(BUNDLE.read_bytes(), pw)
    if plain is None:
        sys.exit('REGIONAL_PASSCODE does not open the live regional bundle')
    return plain, key


def remove():
    gone = False
    for f in (VIEWER, META):
        if f.exists():
            f.unlink(); gone = True
    return 'removed' if gone else 'unchanged'


def write_viewer(plain, key):
    if VIEWER.exists() and opens(VIEWER.read_bytes(), key) == plain:
        return False
    VIEWER.write_bytes(seal(plain, key))
    return True


def create():
    exp_dt = datetime.fromisoformat(os.environ.get('VIEWER_EXPIRES', ''))
    if exp_dt.tzinfo is None or exp_dt.timestamp() * 1000 <= now_ms():
        sys.exit('VIEWER_EXPIRES must be a future time with a timezone')
    plain, key = secrets()
    meta = {'expires': exp_dt.isoformat(), 'expiresMs': int(exp_dt.timestamp() * 1000)}
    meta_txt = json.dumps(meta, indent=2) + '\n'
    changed = write_viewer(plain, key)
    if not META.exists() or META.read_text() != meta_txt:
        META.write_text(meta_txt); changed = True
    return 'created' if changed else 'unchanged'


def sync():
    if not META.exists():
        return remove()
    if now_ms() >= json.loads(META.read_text()).get('expiresMs', 0):
        return remove()
    plain, key = secrets()
    return 'updated' if write_viewer(plain, key) else 'unchanged'


if __name__ == '__main__':
    cmd = sys.argv[1] if len(sys.argv) > 1 else ''
    fn = {'create': create, 'sync': sync, 'remove': remove}.get(cmd)
    if not fn:
        sys.exit('usage: regional_viewer_access.py create|sync|remove')
    print(fn())
