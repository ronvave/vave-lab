#!/usr/bin/env python3
"""Time-limited, password-free viewer copies (Regional and Vanuatu).

A viewer link (#view=<key>) opens a separate copy of a dashboard's data,
encrypted with a viewer-only key instead of the real passcode, so the real
passcode never reaches a viewer's browser. A small plaintext file holds only
the expiry. Targets:

  regional  data/regional-scholars.json.enc (REGIONAL_PASSCODE)
            -> data/regional-scholars.viewer.enc (REGIONAL_VIEWER_KEY)
            The viewer copy may also swap A1 "View dashboard" links for
            password-free country links from REGIONAL_VIEWER_COUNTRY_LINKS
            (JSON {"WSM": "...", "VUT": "..."}); only viewers see them.
  vanuatu   data/vanuatu-collaborator-bundle.json.enc
            (VAVELAB_VANUATU_COLLABORATOR_PASSCODE)
            -> data/vanuatu-collaborator-bundle.viewer.enc (VANUATU_VIEWER_KEY)

  countries data/regional-scholars.json.enc (REGIONAL_PASSCODE)
            -> data/regional-scholars-<code>.viewer.enc, one per country in
            REGIONAL_COUNTRY_VIEWERS (JSON {"HAW": {"key": "...", "links":
            {"FJI": "...", "HAW": "..."}}}). Each copy opens with its own key
            (#view=<key>&lc=<CODE>); Panel A1 links only the dashboards in
            "links" and marks every other live dashboard "Not included in this
            link". Removing a country from the secret deletes its copy on the
            next sync, which ends that country's link only.

Commands: <target|all> create|sync|remove
  create  start the link (VIEWER_EXPIRES, ISO 8601 with timezone)
  sync    while active, refresh the viewer copy only when its decrypted
          content would change (unchanged data never rewrites the file);
          once expired, delete it, which ends the link for everyone
  remove  end the link now
Prints "<target>: created|updated|removed|unchanged". No secrets or plaintext
are printed or written to disk.
"""
import json, os, sys
from datetime import datetime, timezone
from pathlib import Path
sys.path.insert(0, str(Path(__file__).resolve().parent))
from encrypt_data import MAGIC, derive_key  # noqa: E402
from cryptography.hazmat.primitives.ciphers.aead import AESGCM

DATA = Path(__file__).resolve().parent.parent / 'data'


def regional_extra(plain):
    links = json.loads(os.environ.get('REGIONAL_VIEWER_COUNTRY_LINKS') or '{}')
    if not links:
        return plain
    d = json.loads(plain)
    for c in d.get('countries', []):
        if c.get('code') in links:
            c['dashboard'], c['dashboardStatus'] = links[c['code']], 'live'
    return json.dumps(d, ensure_ascii=False, separators=(',', ':')).encode()


LIVE_DASHBOARDS = {'FJI', 'HAW', 'WSM', 'SLB', 'TON', 'VUT'}


def restrict(plain, links):
    d = json.loads(plain)
    for c in d.get('countries', []):
        code = c.get('code')
        if code in links:
            c['dashboard'], c['dashboardStatus'] = links[code], 'live'
        elif c.get('dashboard') or code in LIVE_DASHBOARDS:
            c['dashboard'], c['dashboardStatus'] = None, 'restricted'
    return json.dumps(d, ensure_ascii=False, separators=(',', ':')).encode()


TARGETS = {
    'regional': dict(src='regional-scholars.json.enc', pw='REGIONAL_PASSCODE',
                     out='regional-scholars.viewer.enc', key='REGIONAL_VIEWER_KEY',
                     meta='regional-viewer-access.json', extra=regional_extra),
    'vanuatu': dict(src='vanuatu-collaborator-bundle.json.enc', pw='VAVELAB_VANUATU_COLLABORATOR_PASSCODE',
                    out='vanuatu-collaborator-bundle.viewer.enc', key='VANUATU_VIEWER_KEY',
                    meta='vanuatu-viewer-access.json', extra=None),
    'countries': dict(src='regional-scholars.json.enc', pw='REGIONAL_PASSCODE',
                      out=None, key='REGIONAL_COUNTRY_VIEWERS',
                      meta='regional-country-viewer-access.json', extra=None),
}


def opens(blob, pw):
    if not pw or blob[:len(MAGIC)] != MAGIC:
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


class CountryTargets:
    """One restricted Regional viewer copy per country (see 'countries')."""
    def __init__(self, name):
        self.name, self.t = name, TARGETS[name]
        self.meta = DATA / self.t['meta']

    def files(self):
        return sorted(DATA.glob('regional-scholars-[a-z][a-z][a-z].viewer.enc'))

    def build(self):
        try:
            cfg = json.loads(os.environ.get('REGIONAL_COUNTRY_VIEWERS') or '')
        except ValueError:
            sys.exit('REGIONAL_COUNTRY_VIEWERS secret is missing or not JSON')
        plain = opens((DATA / self.t['src']).read_bytes(), os.environ.get('REGIONAL_PASSCODE', ''))
        if plain is None:
            sys.exit('REGIONAL_PASSCODE does not open regional-scholars.json.enc')
        changed, keep = False, set()
        for code, c in sorted(cfg.items()):
            key = c.get('key', '')
            if len(code) != 3 or not code.isalpha() or len(key) < 24:
                sys.exit(f'REGIONAL_COUNTRY_VIEWERS entry {code[:3]!r} is malformed')
            out = DATA / f'regional-scholars-{code.lower()}.viewer.enc'
            keep.add(out.name)
            body = restrict(plain, c.get('links') or {})
            if not (out.exists() and opens(out.read_bytes(), key) == body):
                out.write_bytes(seal(body, key)); changed = True
        for f in self.files():
            if f.name not in keep:
                f.unlink(); changed = True
        return changed

    def remove(self):
        gone = False
        for f in (*self.files(), self.meta):
            if f.exists():
                f.unlink(); gone = True
        return 'removed' if gone else 'unchanged'

    def create(self):
        exp_dt = datetime.fromisoformat(os.environ.get('VIEWER_EXPIRES', ''))
        if exp_dt.tzinfo is None or exp_dt.timestamp() * 1000 <= now_ms():
            sys.exit('VIEWER_EXPIRES must be a future time with a timezone')
        meta_txt = json.dumps({'expires': exp_dt.isoformat(), 'expiresMs': int(exp_dt.timestamp() * 1000)}, indent=2) + '\n'
        changed = self.build()
        if not self.meta.exists() or self.meta.read_text() != meta_txt:
            self.meta.write_text(meta_txt); changed = True
        return 'created' if changed else 'unchanged'

    def sync(self):
        if not self.meta.exists() or now_ms() >= json.loads(self.meta.read_text()).get('expiresMs', 0):
            return self.remove()
        return 'updated' if self.build() else 'unchanged'


class Target:
    def __init__(self, name):
        t = TARGETS[name]
        self.name, self.t = name, t
        self.src, self.out, self.meta = DATA / t['src'], DATA / t['out'], DATA / t['meta']

    def plain_and_key(self):
        key = os.environ.get(self.t['key'], '')
        if len(key) < 24:
            sys.exit(f"{self.t['key']} secret is missing or too short")
        plain = opens(self.src.read_bytes(), os.environ.get(self.t['pw'], ''))
        if plain is None:
            sys.exit(f"{self.t['pw']} does not open {self.t['src']}")
        if self.t['extra']:
            plain = self.t['extra'](plain)
        return plain, key

    def write_viewer(self, plain, key):
        if self.out.exists() and opens(self.out.read_bytes(), key) == plain:
            return False
        self.out.write_bytes(seal(plain, key))
        return True

    def remove(self):
        gone = False
        for f in (self.out, self.meta):
            if f.exists():
                f.unlink(); gone = True
        return 'removed' if gone else 'unchanged'

    def create(self):
        exp_dt = datetime.fromisoformat(os.environ.get('VIEWER_EXPIRES', ''))
        if exp_dt.tzinfo is None or exp_dt.timestamp() * 1000 <= now_ms():
            sys.exit('VIEWER_EXPIRES must be a future time with a timezone')
        plain, key = self.plain_and_key()
        meta_txt = json.dumps({'expires': exp_dt.isoformat(), 'expiresMs': int(exp_dt.timestamp() * 1000)}, indent=2) + '\n'
        changed = self.write_viewer(plain, key)
        if not self.meta.exists() or self.meta.read_text() != meta_txt:
            self.meta.write_text(meta_txt); changed = True
        return 'created' if changed else 'unchanged'

    def sync(self):
        if not self.meta.exists() or now_ms() >= json.loads(self.meta.read_text()).get('expiresMs', 0):
            return self.remove()
        plain, key = self.plain_and_key()
        return 'updated' if self.write_viewer(plain, key) else 'unchanged'


if __name__ == '__main__':
    if len(sys.argv) < 3 or sys.argv[2] not in ('create', 'sync', 'remove') or sys.argv[1] not in (*TARGETS, 'all'):
        sys.exit('usage: regional_viewer_access.py regional|vanuatu|countries|all create|sync|remove')
    names = list(TARGETS) if sys.argv[1] == 'all' else [sys.argv[1]]
    for n in names:
        print(f'{n}: ' + getattr((CountryTargets if n == 'countries' else Target)(n), sys.argv[2])())
