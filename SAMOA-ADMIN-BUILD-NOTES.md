# Samoa Scholar Database — Admin Panel Build Notes

Companion to `SAMOA-DASHBOARD-BUILD-NOTES.md`. This file documents the
Samoa admin panel's isolation guardrails and the pieces still to build in
the follow-up session.

## Scope of this commit

This commit ships the **backend and reservation surface** of the admin
system. The interactive admin UI is deferred by explicit owner decision so
the ~2,890-line `js/admin-master.js` clone can be adapted carefully to
Samoa's six-dimension geography schema.

Ready to use in this commit:

- `apps-script/samoa-master-writeback.gs` — bound Apps Script Web App.
  Structural clone of `apps-script/tongan-master-writeback.gs` (752 lines).
  Fresh `SHARED_SECRET` (see `SECRETS-NOT-COMMITTED.md`, workspace-only).
  `SPREADSHEET_ID_HINT` is a placeholder that must be replaced with the
  real Samoa Master Sheet ID before deploying.
- `.github/workflows/refresh-samoa-master-file.yml` — hourly + on-dispatch
  refresh workflow with commit-race guardrails.
- `scripts/samoa_master_file_config.py` — refuses to run if wired to any
  sister-system sheet.
- `scripts/samoa_encrypt_data.py` / `samoa_decrypt_data.py` — AES-GCM with
  `VAVELAB_SAMOA_PASSCODE`.

Deferred:

- `js/samoa-db-gate.js` — passcode gate. Clone of `js/db-gate.js`. Must:
  - Use a fresh PBKDF2 `VERIFIER_HASH_HEX` derived from
    `VAVELAB_SAMOA_PASSCODE` (never a copy of any sister-system value).
  - Rename all `vavelab.db.*` / `tonganlab.db.*` / `solomonlab.db.*`
    localStorage keys to `samoalab.db.*`.
  - Return a `SAMOA_MASTER_PASSCODE_PROMISE` global whose contract matches
    the sister systems so the adapter can `await` it before fetching.
- `js/samoa-database-adapter.js` — clone of `js/master-file-adapter.js`.
  Must speak the six-dimension geography schema, not confederacy/province.
- `js/samoa-admin-writeback-client.js` — clone of
  `admin-writeback-client.js`. Points at the Samoa Apps Script `/exec` URL.
- `js/samoa-admin-insights-migration.js` — V1 → V2 migration, matching
  the iTaukei V2 policy (exclude preprints and unresolved 'Document' items
  from V2 counts).
- `js/admin-samoa-master.js` — clone of `js/admin-master.js`. Must:
  - Use a fresh SHA-256 admin-login `PASSWORD_HASH`, chosen by Ron
    (matches the pattern for the initial Tongan build).
  - Reference `samoa-master-writeback.gs`'s field names, not the Tongan
    ones.
  - Load `js/samoa-db-gate.js` and `js/samoa-database-adapter.js`.

## Isolation checklist for the follow-up admin session

Before committing `js/admin-samoa-master.js` and its companions, verify:

- [ ] Every `localStorage` key is `samoalab.*` (never `vavelab.*`,
      `tonganlab.*`, or `solomonlab.*`).
- [ ] `SAMOA_MASTER_PASSCODE_PROMISE` global is exposed (mirrors the
      Tongan pattern in `js/db-gate.js` L27 area).
- [ ] db-gate `VERIFIER_HASH_HEX` is derived fresh from
      `VAVELAB_SAMOA_PASSCODE`.
- [ ] Admin-login `PASSWORD_HASH` is a fresh SHA-256 hex string chosen by
      Ron and pasted into `js/admin-samoa-master.js` — not a copy from any
      sister system.
- [ ] Writeback client points at the Samoa Apps Script `/exec` URL; test
      with the `ping` action before enabling saves.
- [ ] Apps Script `ALLOWLIST` map fully regenerated to match the row-4
      headers of every writable tab in the Samoa Master Sheet.
- [ ] Six geography dimensions are visible as parallel edit fields in the
      Scholar Detail view (never collapsed into one "location" field).
- [ ] Change Log entries are tagged with `admin-master-webapp v1` and the
      actor label `Ron Vave (Samoa admin)`.

## Deploy sequence

1. Open the Samoa Master Sheet in Google Sheets. Extensions → Apps Script.
2. Paste the contents of `apps-script/samoa-master-writeback.gs` into the
   Apps Script project.
3. Regenerate the `ALLOWLIST` map to match this Master Sheet's row-4 headers.
4. In Project Settings → Script Properties, add:
   - `SHARED_SECRET` = the fresh Samoa value from `SECRETS-NOT-COMMITTED.md`
     (workspace-only). Also paste this into the admin Data-source tab when
     the admin UI is added.
   - `WRITE_ENABLED` = `true`
   - `ADMIN_ORIGIN` = `https://ronvave.github.io`
5. Deploy → New deployment → Web App → Execute as `Me (Ron Vave)`;
   Access = `Anyone with the link`. Copy the `/exec` URL.
6. In GitHub → repo settings → Secrets and variables → Actions, add
   `VAVELAB_SAMOA_PASSCODE` (choose fresh; distinct from `Arachnid1!` and
   `Ongoongo9!`).
7. Run the refresh workflow manually once (`gh workflow run
   refresh-samoa-master-file.yml -R ronvave/vave-lab`) to confirm the
   pipeline round-trips against the empty Master Sheet before the admin UI
   is added.

See `docs/SAMOA-APPS-SCRIPT-DEPLOY.md` for the full step-by-step.
