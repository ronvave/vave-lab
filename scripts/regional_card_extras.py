#!/usr/bin/env python3
"""Copy photo + link fields from the country dashboards into the regional bundle.

Runs in CI only (merge-regional-patch.yml), because the country enrichment files
are encrypted with each country's own passcode secret:

  FJI  data/scholar-enrichment.json.enc          VAVELAB_PASSCODE          .scholars
  TON  data/tongan-scholar-enrichment.json.enc   VAVELAB_TONGAN_PASSCODE   .scholars
  SLB  data/solomon-scholar-enrichment.json.enc  VAVELAB_SOLOMON_PASSCODE  .scholars
  VUT  data/vanuatu-master-bundle.json.enc       VAVELAB_VANUATU_PASSCODE  .enrichment

Only three fields leave each file, and only for scholars already in the regional
directory: photo (a repo path under img/scholars/ that exists, an https URL, or
for Vanuatu only an embedded JPEG that passes the Vanuatu dashboard's own check),
institutionUrl and departmentUrl (https URLs). They are written to the
`cardExtras` key of data/regional-scholars.json.enc (re-encrypted with
REGIONAL_PASSCODE, fresh salt and IV). Logs show counts only; never values.
Prints 'updated', 'unchanged' or 'skipped'.
"""
import base64, binascii, gzip, json, os, re, sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
from encrypt_data import MAGIC, derive_key  # noqa: E402
from cryptography.hazmat.primitives.ciphers.aead import AESGCM

ROOT = Path(__file__).resolve().parent.parent
BUNDLE = ROOT / 'data' / 'regional-scholars.json.enc'
SOURCES = [
    ('FJI', 'data/scholar-enrichment.json.enc', 'VAVELAB_PASSCODE', 'scholars'),
    ('TON', 'data/tongan-scholar-enrichment.json.enc', 'VAVELAB_TONGAN_PASSCODE', 'scholars'),
    ('SLB', 'data/solomon-scholar-enrichment.json.enc', 'VAVELAB_SOLOMON_PASSCODE', 'scholars'),
    ('VUT', 'data/vanuatu-master-bundle.json.enc', 'VAVELAB_VANUATU_PASSCODE', 'enrichment'),
]
PHOTO_PATH = re.compile(r'^(?:\./)?(img/scholars/[A-Za-z0-9._-]+\.(?:jpe?g|png|webp))$', re.I)
HTTPS = re.compile(r'^https://[^\s"\'<>]+$', re.I)


def decrypt(path, pw):
    blob = path.read_bytes()
    if blob[:len(MAGIC)] != MAGIC:
        raise ValueError('unexpected file format')
    body = blob[len(MAGIC):]
    salt, iv, ct = body[:16], body[16:28], body[28:]
    return json.loads(AESGCM(derive_key(pw, salt)).decrypt(iv, ct, None))


def embedded_jpeg(v):
    """Same rule as vanuatu_master_file_transformer.approved_photo: a base64
    JPEG data URL of at most 512 KB that decodes to a complete JPEG."""
    prefix = 'data:image/jpeg;base64,'
    if not v.startswith(prefix) or len(v) > 700000:
        return ''
    try:
        image = base64.b64decode(v[len(prefix):], validate=True)
    except (ValueError, binascii.Error):
        return ''
    return v if 4 <= len(image) <= 512000 and image.startswith(b'\xff\xd8') and image.endswith(b'\xff\xd9') else ''


def clean_photo(v, allow_embedded=False):
    v = str(v or '').strip()
    if allow_embedded and v.startswith('data:'):
        return embedded_jpeg(v)
    m = PHOTO_PATH.match(v)
    if m:
        return m.group(1) if (ROOT / m.group(1)).is_file() else ''
    return v if HTTPS.match(v) and len(v) < 600 else ''


def clean_url(v):
    v = str(v or '').strip()
    return v if HTTPS.match(v) and len(v) < 600 else ''


def main():
    pw = os.environ.get('REGIONAL_PASSCODE')
    if not pw:
        print('skipped'); return
    data = decrypt(BUNDLE, pw)
    d = data.get('directory')
    if not d:
        print('skipped'); return
    dirdata = json.loads(gzip.decompress(base64.b64decode(d['gz']))) if 'gz' in d else d
    ids = {s['id'] for s in dirdata.get('scholars', [])}
    extras, report = {}, []
    for code, rel, env, key in SOURCES:
        cpw = os.environ.get(env)
        path = ROOT / rel
        if not cpw or not path.exists():
            report.append(f'{code}: not available'); continue
        try:
            doc = decrypt(path, cpw)
        except Exception as exc:  # wrong passcode or format: skip this country only
            report.append(f'{code}: could not open ({type(exc).__name__})'); continue
        rows = doc.get(key) or {}
        n = dict(photo=0, inst=0, dept=0, rejected=0)
        for sid, r in rows.items():
            if sid not in ids or not isinstance(r, dict):
                continue
            out = {}
            ph = clean_photo(r.get('photo'), allow_embedded=(code == 'VUT'))
            if r.get('photo') and not ph:
                n['rejected'] += 1
            if ph: out['ph'] = ph; n['photo'] += 1
            iu = clean_url(r.get('institutionUrl'))
            if iu: out['iu'] = iu; n['inst'] += 1
            du = clean_url(r.get('departmentUrl'))
            if du: out['du'] = du; n['dept'] += 1
            if out:
                extras[sid] = out
        report.append(f"{code}: photos {n['photo']}, institution links {n['inst']}, department links {n['dept']}, photo values not usable {n['rejected']}")
    for line in report:
        print(line, file=sys.stderr)
    if data.get('cardExtras') == extras:
        print('unchanged'); return
    data['cardExtras'] = extras
    plain = json.dumps(data, ensure_ascii=False, separators=(',', ':')).encode()
    s2, iv2 = os.urandom(16), os.urandom(12)
    BUNDLE.write_bytes(MAGIC + s2 + iv2 + AESGCM(derive_key(pw, s2)).encrypt(iv2, plain, None))
    print('updated')


if __name__ == '__main__':
    main()
