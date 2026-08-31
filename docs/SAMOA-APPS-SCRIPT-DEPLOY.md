# Samoa Admin — Apps Script Deployment (Google-auth, no browser secrets)

**Effective 2026-08-30.** Replaces the retired browser-HMAC contract.

## Architecture

```
                    ┌──────────────────────────────┐
                    │ ronvave.github.io/vave-lab/  │
                    │  samoa-research-database-…   │  (public dashboard)
                    │  admin-samoa-master.html     │  (public stub → link)
                    └──────────────┬───────────────┘
                                   │  (link only, no secrets)
                                   ▼
                    ┌──────────────────────────────┐
                    │ script.google.com/…/exec     │
                    │  ↓  doGet(e)                 │
                    │  ↓  _assertAuthorized_()     │
                    │  ↓  HtmlService.createTemplate│
                    │       samoa-admin-app.html   │
                    │        · writeback-bridge    │
                    │        · admin-controller    │
                    │        · admin-master-inline │
                    └──────────────┬───────────────┘
                                   │  google.script.run
                                   ▼
                    ┌──────────────────────────────┐
                    │  apiDescribe / apiPing /     │
                    │  apiReadRow / apiUpdateRow   │
                    │  (server-side, gated by      │
                    │   APPROVED_ADMIN_EMAIL)      │
                    └──────────────┬───────────────┘
                                   ▼
                    ┌──────────────────────────────┐
                    │  Samoa Master Sheet          │
                    └──────────────────────────────┘
```

## What lives where

| Location | Contents | Access model |
|---|---|---|
| GitHub Pages `admin-samoa-master.html` | Public stub that links to the Apps Script `/exec` URL. Contains no secrets, no admin JS, no HMAC. | Anyone with the URL can view the stub. Nothing sensitive here. |
| Apps Script project (bound to Samoa Master Sheet) | `.gs` writeback + four HTML includes for the admin UI. `APPROVED_ADMIN_EMAIL` Script Property gates who can open it. | Only the Google account listed in `APPROVED_ADMIN_EMAIL` sees the admin surface. Everyone else sees a "Not authorized" page. |
| Master Sheet | Data. Writes only via `apiUpdateRow` in the `.gs` file. | Regular Google Sheets sharing. The Apps Script runs under the caller's identity, so writes obey Sheet ACLs too. |

## Files added to the Apps Script project

| File | Kind | Purpose |
|---|---|---|
| `samoa-master-writeback.gs` | .gs | Server. `doGet` serves the admin app + read paths; `doPost` returns 410 Gone; `api*` functions do the real work. |
| `samoa-admin-app.html` | HTML | Main HtmlService template rendered by `doGet`. |
| `samoa-admin-writeback-bridge.html` | HTML | JS that exposes `window.samoaWriteback` on top of `google.script.run`. |
| `samoa-admin-controller.html` | HTML | Shim that provides `samoaDbGate` (routes through `apiReadRow`) and bypasses the legacy password form. |
| `samoa-admin-master-inline.html` | HTML | The admin JS controller (unchanged from the retired browser build, embedded verbatim). |

## Script Properties

| Key | Value | Required |
|---|---|---|
| `APPROVED_ADMIN_EMAIL` | Ron's Google account, lowercase, e.g. `ronvave2011@gmail.com` | **Yes** |
| `WRITE_ENABLED` | `true` (or omit / `false` to enable read-only mode) | Optional |
| `SHARED_SECRET` | **Delete this.** The Samoa admin no longer uses it. Sister-database polling paths in `doGet` still honor it if present, but Samoa's admin path does not. | No |

## Deployment steps

1. Open the Samoa Master Sheet → Extensions → Apps Script.
2. Add the five files above. Paste `samoa-master-writeback.gs` first; then create each `.html` via File → New → HTML file and paste each include's contents.
3. Project Settings → Script Properties:
   - Add `APPROVED_ADMIN_EMAIL = <your Google account, lowercase>`.
   - Add `WRITE_ENABLED = true` if you want writes on immediately.
   - Delete any existing `SHARED_SECRET` property (no longer used by the admin; leaks are moot after this deploy).
4. Deploy → New deployment → type = **Web app**:
   - Description: `Samoa Admin (Google auth) v2`
   - Execute as: **User accessing the web app** ← **CRITICAL** (without this, `Session.getActiveUser().getEmail()` returns empty).
   - Who has access: **Anyone with a Google account**
5. Copy the `/exec` URL from the deploy dialog.
6. Paste the URL into `admin-samoa-master.html` where the placeholder `REPLACE_WITH_APPS_SCRIPT_EXEC_URL` sits. Commit + push (no secrets in this URL — auth is fully server-side).

## Verification checklist

Run these before declaring the deploy healthy. Each takes < 30 seconds.

### 1. Approved account sees the admin app

Open the `/exec` URL while signed into the account listed in `APPROVED_ADMIN_EMAIL`.

Expected: page renders "Samoa Scholar Database — Admin", shows "Signed in as <your-email>", status advances from "Booting…" to "Ready. Server writeEnabled = yes".

### 2. Unauthorized account sees "Not authorized"

Open the `/exec` URL in an incognito window while signed into a different Google account (or sign out first).

Expected: "Not authorized" page. No worksheet list, no form.

### 3. Anonymous fetch cannot read

From a terminal, `curl -i <exec-url>`.

Expected: 302 redirect to a Google sign-in page (or a Google login HTML). No JSON MAPPING, no worksheet list.

### 4. `doPost` is gone

From a terminal:

```
curl -i -X POST -H 'Content-Type: application/json' \
     -d '{"action":"ping"}' <exec-url>
```

Expected: HTTP 410 with body `{"status":"gone","error":"browser-hmac-contract-retired",…}`. Any HMAC-signed POST from a compromised browser returns the same 410.

### 5. Server-side write works

In the admin app: pick a worksheet, load an existing row, change one editable field (e.g. `Notes`), save.

Expected: green success banner. Open the Master Sheet directly and confirm the cell + Change Log both updated. Change Log's actor column is your Google email, not the string `admin`.

### 6. Write path rejects unauthorized

Sign out; sign into a non-approved Google account; open `/exec`; expected "Not authorized". No `google.script.run` call can reach `apiUpdateRow` because `_assertAuthorized_` throws before any work runs.

## Rotation and revocation

**To revoke admin access instantly**, change `APPROVED_ADMIN_EMAIL` to any value the current admin cannot control (e.g. `revoked@invalid`). No redeploy required — the Script Property is read on every request.

**To rotate the admin identity**, edit `APPROVED_ADMIN_EMAIL` to the new Google account's email. No secret rotation needed. No client-side changes needed.

**The previously exposed browser HMAC secret** (fingerprint prefix `3165379b…`, reference elsewhere in the session record) is now permanently irrelevant. `doPost` no longer verifies it. No live surface accepts it. History-rewriting the old commits that contain it is unnecessary because it grants no access.

## What was killed on 2026-08-30

- `js/samoa-admin-writeback-client.js` (browser HMAC signer). Deleted.
- `js/samoa-admin-insights-migration.js` (client-side migrations). Deleted.
- `js/admin-samoa-master.js` (browser admin controller). Deleted — its code now lives in `apps-script/samoa-admin-master-inline.html`.
- `apps-script/hmac-smoke-test.md` and `apps-script/run-hmac-smoke-tests.py`. Deleted — the contract they tested no longer exists.
- `admin-samoa-master.html` browser JS: `SAMOA_ADMIN_PASSWORD_HASH_HEX`, `SAMOA_WRITEBACK_URL`, `SAMOA_WRITEBACK_SECRET_HEX` inline assignments. Replaced by a static stub with a single `ADMIN_URL` (not a secret).
- `doPost` in `samoa-master-writeback.gs`: entire HMAC branch and the legacy `checkAuth_`-based sister-database `write`/`ping` branch. Returns 410 Gone.

## What was preserved

- `MAPPING` allowlist (25 worksheets, ~454 fields).
- `ALWAYS_CONFIRM` policy for high-risk fields.
- `LockService` on every write.
- Change Log append on every write, now stamped with the caller's Google email as actor.
- Field-level validation (`validateValue_`).
- Legacy JSON read paths (`readScholar`, `readRows`, `readChangeLog`) via `doGet` — still gated by the SHARED_SECRET Script Property, still usable by sister-database polling, but not by Samoa admin.
- Emergency read-only switch: `WRITE_ENABLED = false`.

## Security tests (post-deploy, one-time)

```bash
# 1. Anonymous doGet is denied
curl -i -L "$EXEC_URL" | head -20   # expect Google login redirect

# 2. Anonymous doPost is 410
curl -i -X POST -H 'Content-Type: application/json' \
     -d '{"action":"ping"}' "$EXEC_URL"    # expect HTTP 410

# 3. Anonymous doPost with fake HMAC is 410
curl -i -X POST -H 'Content-Type: application/json' \
     -d '{"action":"update","worksheet":"Scholars","key":"SAM-S0001",
          "fields":{"Notes":"hax"},"sig":"deadbeef","nonce":"aa",
          "ts":'"$(date +%s%3N)"'}' "$EXEC_URL"    # expect HTTP 410

# 4. Legacy read path with wrong SHARED_SECRET is 401 or unauthorized
curl -i "$EXEC_URL?action=ping&secret=wrong&clientTs=$(date +%s%3N)"

# 5. Legacy read path with no SHARED_SECRET falls into HTML admin (Google redirect)
curl -i "$EXEC_URL?action=ping" | head -20
```

All five must pass before Ron considers the migration verified.
