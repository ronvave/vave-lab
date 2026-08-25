#!/usr/bin/env python3
"""Decrypt itaukei-master-scholars.json.enc and dump ITK-S0212's raw record."""
import json
import sys
from pathlib import Path
from cryptography.hazmat.primitives import hashes
from cryptography.hazmat.primitives.kdf.pbkdf2 import PBKDF2HMAC
from cryptography.hazmat.primitives.ciphers.aead import AESGCM

MAGIC = b"IVAV"
PASSCODE = "Arachnid1!"

def derive_key(passcode: str, salt: bytes) -> bytes:
    kdf = PBKDF2HMAC(algorithm=hashes.SHA256(), length=32, salt=salt,
                     iterations=200000)
    return kdf.derive(passcode.encode("utf-8"))

def decrypt(path: Path) -> bytes:
    blob = path.read_bytes()
    assert blob[:4] == MAGIC, "bad magic"
    salt = blob[4:20]
    iv = blob[20:32]
    body = blob[32:]
    key = derive_key(PASSCODE, salt)
    aes = AESGCM(key)
    return aes.decrypt(iv, body, associated_data=None)

if __name__ == "__main__":
    repo = Path(__file__).resolve().parent.parent
    plaintext = decrypt(repo / "data" / "itaukei-master-scholars.json.enc")
    data = json.loads(plaintext)
    scholars = data.get("scholars", []) if isinstance(data, dict) else data
    for s in scholars:
        if not isinstance(s, dict):
            continue
        if s.get("scholarId") == "ITK-S0212" or s.get("Scholar ID") == "ITK-S0212":
            print(json.dumps(s, indent=2, ensure_ascii=False))
            sys.exit(0)
    print("ITK-S0212 not found", file=sys.stderr)
    sys.exit(1)
