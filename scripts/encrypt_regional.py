#!/usr/bin/env python3
"""Encrypt data/regional-scholars.json -> data/regional-scholars.json.enc (IVAV v1).

Passcode from REGIONAL_PASSCODE (never commit). Same format as encrypt_data.py.
"""
import os, sys
from pathlib import Path
sys.path.insert(0, str(Path(__file__).resolve().parent))
from encrypt_data import MAGIC, derive_key  # noqa: E402
from cryptography.hazmat.primitives.ciphers.aead import AESGCM

ROOT = Path(__file__).resolve().parent.parent
src = ROOT / 'data' / 'regional-scholars.json'
pw = os.environ.get('REGIONAL_PASSCODE')
if not pw:
    sys.exit('Set REGIONAL_PASSCODE')
salt, iv = os.urandom(16), os.urandom(12)
ct = AESGCM(derive_key(pw, salt)).encrypt(iv, src.read_bytes(), None)
(ROOT / 'data' / 'regional-scholars.json.enc').write_bytes(MAGIC + salt + iv + ct)
print('wrote', len(MAGIC + salt + iv + ct), 'bytes')
