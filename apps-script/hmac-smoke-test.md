# HMAC smoke test — Samoa admin writeback contract

Verifies that the JS client (`js/samoa-admin-writeback-client.js`) and the
Apps Script server (`apps-script/samoa-master-writeback.gs`) agree on the
byte-for-byte canonical string that is fed to HMAC-SHA-256.

Both sides compute:

```
canonical =
  action     + "\n" +
  worksheet  + "\n" +
  key        + "\n" +
  canonicalJSON(fields) + "\n" +
  nonce      + "\n" +
  ts
sig = hex( HMAC_SHA256(secretHexAsBytes, canonical) )
```

`canonicalJSON` is recursive: keys of every plain object are sorted
lexicographically, arrays use their natural order, primitives use
`JSON.stringify`. Whitespace is stripped.

## Case A — success

Client payload:

```json
{
  "action": "update",
  "worksheet": "Scholars",
  "key": "SAM-S0001",
  "fields": {"Living Status": "Alive", "Review Status": "Verified"},
  "actor": "admin",
  "nonce": "abc123",
  "ts": 1735500000000
}
```

Canonical string (backslashes shown as `\n` linebreaks):

```
update
Scholars
SAM-S0001
{"Living Status":"Alive","Review Status":"Verified"}
abc123
1735500000000
```

Server behaviour: `checkAuthHmac_` recomputes the sig, constant-time
compares, then `handleUpdateRow_` writes both fields. Response:

```json
{"status":"ok", "counts":{"ok":2,...}, "results":[{"field":"Living Status","status":"ok",...},...]}
```

## Case B — rejected (field not in allowlist)

Same envelope, `fields = {"Not A Real Field": "x"}`. Server response:

```json
{"status":"rejected","error":"field-not-allowed","fields":["Not A Real Field"]}
```

## Case C — unauthorised (bad signature)

Client sends a payload whose `sig` was computed with the wrong secret.
Server response:

```json
{"status":"unauthorized","error":"sig-mismatch"}
```

## Case D — no-op (already satisfied)

Client sends `fields = {"Living Status": "Alive"}` when the Master already
holds `"Alive"`. Server response:

```json
{"status":"ok","noop":true,"counts":{"already_satisfied":1,...}}
```

## Case E — replay (nonce reused within 15 min)

Second POST with the same `nonce`. Server response:

```json
{"status":"unauthorized","error":"nonce-replay"}
```

## Case F — stale timestamp (>10 min drift)

Server response:

```json
{"status":"unauthorized","error":"ts-outside-window"}
```

## Manual verification

To reproduce the sig locally with Python 3:

```python
import hmac, hashlib, json
secret_hex = "3165379b362f4447bc228abdd75d6668f7b4a3475d57a6298a3593ac3d431645"
fields = {"Living Status": "Alive", "Review Status": "Verified"}
# Recursive canonical JSON, keys sorted, no whitespace
def canonical(o):
    if o is None or not isinstance(o, dict):
        return json.dumps(o, separators=(',', ':'), ensure_ascii=False)
    return '{' + ','.join(
        json.dumps(k) + ':' + canonical(o[k]) for k in sorted(o.keys())
    ) + '}'
msg = '\n'.join(['update','Scholars','SAM-S0001', canonical(fields), 'abc123','1735500000000'])
print(hmac.new(bytes.fromhex(secret_hex), msg.encode('utf-8'), hashlib.sha256).hexdigest())
```

Reproduced sig for Case A:
`08e962d38b10ce7051988a959e65ded91b2a1c58fbe056b6e5d5566d63b26744`

Canonical string bytes (Case A):

```
update\nScholars\nSAM-S0001\n{"Living Status":"Alive","Review Status":"Verified"}\nabc123\n1735500000000
```

Both the browser client (`crypto.subtle.sign('HMAC', ...)`) and the Apps
Script server (`Utilities.computeHmacSha256Signature(bytes, keyBytes)`) must
produce this hex string byte-for-byte.
