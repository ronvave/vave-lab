#!/usr/bin/env python3
"""
Run all six HMAC smoke-test cases against the deployed Samoa writeback web app.

Usage:
    export SAMOA_WRITEBACK_URL='https://script.google.com/macros/s/AKfy.../exec'
    export SAMOA_WRITEBACK_SECRET_HEX='<64-char hex>'
    python3 apps-script/run-hmac-smoke-tests.py

The script prints a compact pass/fail summary and exits 0 iff every case
matches the expected shape. It never echoes the secret to stdout.

The six cases exercise:
  A  ok           update with two valid fields on an existing row
  B  rejected     update with an unknown field (all-or-nothing rejection)
  C  unauthorized wrong signature (secret mismatch simulation)
  D  replay       reused nonce (should be blocked by the CacheService window)
  E  noop         update with identical current values
  F  describe     read-only capability probe

The two rows used (SAM-S0001 for case A/D/E, SAM-S0002 for case B, and the
'describe' target) must exist in the live Samoa Master Sheet before the
tests run; the writeback layer never creates rows.
"""

import hashlib
import hmac
import json
import os
import sys
import time
import urllib.error
import urllib.request
import uuid


def canonical_json(obj):
    """Recursive canonical JSON: keys sorted, no whitespace, arrays preserved."""
    if isinstance(obj, dict):
        parts = []
        for k in sorted(obj):
            parts.append(json.dumps(k) + ":" + canonical_json(obj[k]))
        return "{" + ",".join(parts) + "}"
    if isinstance(obj, list):
        return "[" + ",".join(canonical_json(x) for x in obj) + "]"
    return json.dumps(obj, ensure_ascii=False, separators=(",", ":"))


def sign(secret_hex, message_str):
    key = bytes.fromhex(secret_hex)
    return hmac.new(key, message_str.encode("utf-8"), hashlib.sha256).hexdigest()


def build_signed_body(secret_hex, action, worksheet, row_id, fields, *, nonce=None, ts_ms=None, tamper=False):
    nonce = nonce or uuid.uuid4().hex
    ts_ms = ts_ms if ts_ms is not None else int(time.time() * 1000)
    canonical_fields = canonical_json(fields)
    canonical_string = "\n".join([action, worksheet, row_id, canonical_fields, nonce, str(ts_ms)])
    sig = sign(secret_hex, canonical_string)
    if tamper:
        # Flip one hex nibble to simulate a wrong-secret request. Never expose the real digest.
        sig = ("f" if sig[0] != "f" else "0") + sig[1:]
    return {
        "action": action,
        "worksheet": worksheet,
        "row_id": row_id,
        "fields": fields,
        "nonce": nonce,
        "ts_ms": ts_ms,
        "sig": sig,
    }


def post(url, body):
    data = json.dumps(body).encode("utf-8")
    req = urllib.request.Request(url, data=data, method="POST",
                                 headers={"Content-Type": "application/json"})
    try:
        with urllib.request.urlopen(req, timeout=30) as resp:
            return resp.status, resp.read().decode("utf-8", errors="replace")
    except urllib.error.HTTPError as e:
        return e.code, e.read().decode("utf-8", errors="replace")
    except Exception as e:  # noqa: BLE001
        return None, f"ERR:{type(e).__name__}:{e}"


def parse(txt):
    try:
        return json.loads(txt)
    except Exception:
        return None


def check(name, got, expected_status, expected_predicate):
    body = parse(got[1])
    ok = got[0] == expected_status and (expected_predicate is None or expected_predicate(body))
    mark = "PASS" if ok else "FAIL"
    print(f"  [{mark}] {name}: http={got[0]} body_status={body.get('status') if isinstance(body, dict) else None}")
    if not ok:
        print(f"         raw: {got[1][:400]}")
    return ok


def main():
    url = os.environ.get("SAMOA_WRITEBACK_URL")
    secret = os.environ.get("SAMOA_WRITEBACK_SECRET_HEX")
    if not url or not secret or "REPLACE_ME" in url or "REPLACE_ME" in secret:
        print("ERROR: set SAMOA_WRITEBACK_URL and SAMOA_WRITEBACK_SECRET_HEX in env")
        sys.exit(2)
    if len(secret) != 64 or any(c not in "0123456789abcdef" for c in secret.lower()):
        print("ERROR: SAMOA_WRITEBACK_SECRET_HEX must be exactly 64 hex chars")
        sys.exit(2)

    print(f"Running six HMAC smoke tests against {url}\n")
    passes = 0
    fails = 0

    # ------- Case A: ok update -----------------------------------------------
    body_a = build_signed_body(secret, "update", "Scholars", "SAM-S0001",
                                {"Living Status": "Alive", "Review Status": "Verified"})
    print("Case A (ok):")
    r = post(url, body_a)
    if check("Case A", r, 200, lambda b: b and b.get("status") in {"ok", "noop"}):
        passes += 1
    else:
        fails += 1

    # ------- Case B: rejected unknown field ----------------------------------
    body_b = build_signed_body(secret, "update", "Scholars", "SAM-S0002",
                                {"Not A Real Field": "x"})
    print("Case B (rejected unknown field):")
    r = post(url, body_b)
    if check("Case B", r, 200, lambda b: b and b.get("status") == "rejected"):
        passes += 1
    else:
        fails += 1

    # ------- Case C: unauthorized bad sig ------------------------------------
    body_c = build_signed_body(secret, "update", "Scholars", "SAM-S0001",
                                {"Living Status": "Alive"}, tamper=True)
    print("Case C (unauthorized bad sig):")
    r = post(url, body_c)
    if check("Case C", r, 200, lambda b: b and b.get("status") == "unauthorized"):
        passes += 1
    else:
        fails += 1

    # ------- Case D: replay --------------------------------------------------
    # Reuse the exact nonce+ts from Case A. Recompute sig against the same canonical string.
    body_d = dict(body_a)  # same nonce, same ts, same sig
    print("Case D (replay attempt, reused nonce):")
    r = post(url, body_d)
    if check("Case D", r, 200, lambda b: b and b.get("status") == "unauthorized"):
        passes += 1
    else:
        fails += 1

    # ------- Case E: noop ----------------------------------------------------
    body_e = build_signed_body(secret, "update", "Scholars", "SAM-S0001",
                                {"Living Status": "Alive", "Review Status": "Verified"})
    print("Case E (noop, identical values):")
    r = post(url, body_e)
    if check("Case E", r, 200, lambda b: b and b.get("status") in {"noop", "ok"}):
        passes += 1
    else:
        fails += 1

    # ------- Case F: describe ------------------------------------------------
    body_f = build_signed_body(secret, "describe", "Scholars", "*", {})
    print("Case F (describe):")
    r = post(url, body_f)
    if check("Case F", r, 200, lambda b: b and b.get("status") == "ok" and "fields" in (b or {})):
        passes += 1
    else:
        fails += 1

    print()
    print(f"Summary: {passes} passed, {fails} failed")
    sys.exit(0 if fails == 0 else 1)


if __name__ == "__main__":
    main()
