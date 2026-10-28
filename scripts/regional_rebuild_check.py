#!/usr/bin/env python3
"""Compare a freshly rebuilt regional bundle with the live one (CI safety check).

  REGIONAL_PASSCODE=... python3 scripts/regional_rebuild_check.py OLD.enc NEW.enc

Both files are IVAV bundles encrypted with REGIONAL_PASSCODE. Prints a
counts-only table per country (no names or other values) and a per-section
same/changed list, and also writes them to $GITHUB_STEP_SUMMARY when set.

Result (last line, and `result=` in $GITHUB_OUTPUT):
  blocked   - a Master was not read, a section disappeared, or a country total
              fell by more than --max-drop (default 10%). Keep the live bundle.
  unchanged - identical apart from the build time stamp and Master modified times.
  changed   - safe to publish.
Never treats a country that failed to load as zero.
"""
import argparse, json, os, sys
from pathlib import Path
sys.path.insert(0, str(Path(__file__).resolve().parent))
from encrypt_data import MAGIC, derive_key  # noqa: E402
from cryptography.hazmat.primitives.ciphers.aead import AESGCM

FIELDS = ('scholars', 'masters', 'phd', 'pubsIndexed', 'pubsIndigenous')
IGNORE = {'generated'}


def load(p, pw):
    b = Path(p).read_bytes()
    assert b[:len(MAGIC)] == MAGIC, f'{p}: unexpected file format'
    b = b[len(MAGIC):]
    return json.loads(AESGCM(derive_key(pw, b[:16])).decrypt(b[16:28], b[28:], None))


def strip(k, v):
    """A Master's 'last modified' time alone is not a data change (user decision 2026-10-28)."""
    if k == 'sources' and isinstance(v, list):
        return [{x: y for x, y in s.items() if x != 'modified'} for s in v]
    return v


def size(v):
    return len(v) if isinstance(v, (list, dict)) else ''


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('old')
    ap.add_argument('new')
    ap.add_argument('--max-drop', type=float, default=0.10)
    a = ap.parse_args()
    pw = os.environ.get('REGIONAL_PASSCODE') or sys.exit('Set REGIONAL_PASSCODE')
    old, new = load(a.old, pw), load(a.new, pw)
    problems, lines = [], []

    src = {s['code']: s for s in new.get('sources', [])}
    oldsrc = {s['code']: s for s in old.get('sources', [])}
    for code, s in oldsrc.items():
        if s.get('status', '').startswith('Connected') and not src.get(code, {}).get('status', '').startswith('Connected'):
            problems.append(f'{code}: Master was not read')

    oc = {c['code']: c for c in old.get('countries', [])}
    nc = {c['code']: c for c in new.get('countries', [])}
    lines.append('| Country | ' + ' | '.join(f'{f} (live → new)' for f in FIELDS) + ' |')
    lines.append('|---' * (len(FIELDS) + 1) + '|')
    for code in sorted(set(oc) | set(nc)):
        o, n = oc.get(code, {}), nc.get(code)
        if n is None:
            problems.append(f'{code}: missing from the new build')
        cells = []
        for f in FIELDS:
            ov, nv = o.get(f), (n or {}).get(f)
            mark = '' if ov == nv else ' *'
            cells.append(f'{ov} → {nv}{mark}')
            if isinstance(ov, (int, float)) and ov > 0 and isinstance(nv, (int, float)) and nv < ov * (1 - a.max_drop):
                problems.append(f'{code}: {f} fell from {ov} to {nv}')
        lines.append(f'| {code} | ' + ' | '.join(cells) + ' |')

    lines += ['', '| Section | Live size | New size | Same? |', '|---|---|---|---|']
    changed = False
    for k in sorted((set(old) | set(new)) - IGNORE):
        if k not in new:
            problems.append(f'section {k} missing from the new build')
        same = strip(k, old.get(k)) == strip(k, new.get(k))
        changed |= not same
        lines.append(f'| {k} | {size(old.get(k))} | {size(new.get(k))} | {"yes" if same else "CHANGED"} |')

    result = 'blocked' if problems else ('changed' if changed else 'unchanged')
    out = '\n'.join(lines + [''] + [f'- {p}' for p in problems] + ['', f'Result: **{result}**'])
    print(out)
    if os.environ.get('GITHUB_STEP_SUMMARY'):
        with open(os.environ['GITHUB_STEP_SUMMARY'], 'a') as fh:
            fh.write('## Regional rebuild check\n\n' + out + '\n')
    if os.environ.get('GITHUB_OUTPUT'):
        with open(os.environ['GITHUB_OUTPUT'], 'a') as fh:
            fh.write(f'result={result}\n')
    print(result)


if __name__ == '__main__':
    main()
