# Samoa Master Sheet — Apps Script Deploy Guide

Step-by-step for wiring `apps-script/samoa-master-writeback.gs` into a
newly-created Samoa Master Sheet so the admin panel (once built) and the
refresh workflow can write to it.

## Prerequisites

- The `Samoa-Scholar-Database-Master.xlsx` file, uploaded to Google Sheets.
  Note the Spreadsheet ID from the URL (`.../d/<ID>/edit`).
- Owner Google account (Ron Vave) as the sheet's owner.
- Access to the `ronvave/vave-lab` GitHub Actions Secrets page.
- The workspace-only file `SECRETS-NOT-COMMITTED.md` for the fresh Samoa
  `SHARED_SECRET`. **NEVER commit this to git.**

## 1. Wire the bound Apps Script

1. Open the Samoa Master Sheet. Extensions → Apps Script.
2. Rename the project to `Samoa Master Writeback`.
3. Delete the placeholder `Code.gs`. Add a new script file named
   `samoa-master-writeback.gs` and paste the entire content of
   `apps-script/samoa-master-writeback.gs`.
4. **Critical:** regenerate the `ALLOWLIST` map at the top of the file so
   each key matches the exact row-4 header of a writable tab in your
   Samoa Master Sheet. The generator has already produced the correct
   `MAPPING` block against the live sheet — do not hand-edit it.

## 2. Set Script Properties

Project Settings (⚙) → Script Properties → Add script property:

| Key | Value |
|---|---|
| `SHARED_SECRET` | The fresh 64-hex string from workspace `SECRETS-NOT-COMMITTED.md` (starts with `3165379b…`) |
| `WRITE_ENABLED` | `true` |
| `ADMIN_ORIGIN` | `https://ronvave.github.io` |

## 3. Deploy as a Web App

Deploy → New deployment → Select type: **Web app**.

- Description: `Samoa Master write-back v1`
- Execute as: **Me (Ron Vave)**
- Who has access: **Anyone with the link**

Copy the resulting `/exec` URL. This is the endpoint the admin panel and
the refresh workflow will call. Paste it into the admin panel's Data
Source tab once the admin UI is committed.

## 4. Grant workflow access to the sheet

The service account defined by GitHub Secret `GCP_SA_KEY` must have
**Editor** access to the Samoa Master Sheet. Open the Master Sheet →
Share → paste the service account's email address → give Editor role.

## 5. Set the GitHub Secrets

In `github.com/ronvave/vave-lab` → Settings → Secrets and variables →
Actions → Repository secrets:

| Secret | Purpose |
|---|---|
| `VAVELAB_SAMOA_PASSCODE` | AES-GCM passcode for `data/samoa-*.json.enc`. Choose a fresh strong value that has not been used elsewhere. |
| `GCP_SA_KEY` | Existing; already used by sister workflows. No change needed. |

## 6. Update `scripts/samoa_master_file_config.py`

Open the file. Replace the placeholder:

```python
SPREADSHEET_ID = "1X-RZSWKbzG-oY7anCYaR54Ev8h2G8yl0SXy6jMNhCHQ"
```

with the actual Spreadsheet ID from step 0. Commit and push.

## 7. First workflow run

Trigger the refresh workflow manually to confirm the round-trip works
against an empty Master Sheet:

```bash
gh workflow run refresh-samoa-master-file.yml -R ronvave/vave-lab
gh run watch -R ronvave/vave-lab
```

Expected: workflow completes; a commit like `chore(samoa): refresh master
snapshot` appears on `main` with new `data/samoa-master-*.json.enc` files.

## 8. Ping the writeback

Once the admin panel is committed, from the browser console on the admin
page:

```js
window.samoaWriteback.ping().then(console.log);
```

Expected: `{ok: true, ...}`. Any other result means the `/exec` URL or the
`SHARED_SECRET` is wrong; re-check step 2 and step 3.

## Deployment notes

- Every new deployment produces a new `/exec` URL. Prefer **Manage
  deployments → Edit → New version** so the URL stays stable.
- The Web App runs as Ron. Keep the sheet's ownership on Ron's account so
  a role change on the sister systems never revokes the writeback.
- The Apps Script `ALLOWLIST` map is the single source of truth for what
  the admin panel can write. Anything not on the allowlist is silently
  rejected with a `not_allowlisted` classification. If a new column is
  added to a writable tab, add it to the allowlist BEFORE the admin panel
  needs it.
- The refresh workflow is idempotent: running it against an unchanged
  sheet produces no commit. Diffs are computed against
  `data/samoa-last-master-sync.json`.
