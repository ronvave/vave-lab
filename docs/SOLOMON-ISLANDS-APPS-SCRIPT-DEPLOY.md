# Apps Script deploy — Solomon Islands Scholar Master write-back v1

One-time steps to stand up the `solomon-master-writeback.gs` web app that the Solomon Islands Admin Panel calls when you save a change to the Solomon Islands Master sheet.

**This is a completely separate, isolated deployment from the existing iTaukei `master-writeback.gs` and Tongan `tongan-master-writeback.gs` web apps.** It uses its own spreadsheet ID, its own shared secret, and its own Web App URL. It must never point at the iTaukei or Tongan spreadsheets, and neither of those deployments should ever be modified, redeployed, or reused for Solomon Islands data.

You only need to do this once. After it's deployed, the Solomon Islands Admin Panel talks to it directly and every write is authenticated, allowlisted, conflict-checked, and logged — mirroring the iTaukei/Tongan sister systems' write-back behavior.

**Status: NOT YET DEPLOYED.** No Apps Script project exists yet for this spreadsheet, and the Solomon Islands admin panel's writeback endpoint is currently a placeholder. This guide is the exact manual sequence Ron needs to run to bring the backend live.

## What this deploys

- A bound Apps Script attached to the Solomon Islands Master file (`1um6pHKriEhbtvmkm7e8E1j0_Zt9A-oYpY88fuPoAmFY` — **Solomon Islands Scholars Master File**). This is NOT the iTaukei sheet (`1nJvMWLS8jnCOKtRoqdDpEW3s3j9TSAclXBO1txVFxdg`) and NOT the Tongan sheet (`1lh6wOFcg2GiFe2YylgxM5cvLOdumdbCrHDLQk87rjRI`).
- One Web App URL (execute as you, anyone with the link can hit it, but the shared secret gates every call).
- Three Script Properties: `SOLOMON_SPREADSHEET_ID`, `SHARED_SECRET`, `WRITE_ENABLED`, plus `ADMIN_ORIGIN`.

Nothing goes on GitHub. The secret lives only in Google's Script Properties and in the Solomon Islands Admin Panel's browser `localStorage` (under its own, separately-named keys — `solomonlab_writeback_endpoint` / `solomonlab_writeback_secret` — never the iTaukei/Tongan `localStorage` keys, so the systems cannot cross-talk even in the same browser).

## 1. Open the Solomon Islands Master file's Apps Script project

1. Open the Solomon Islands Master sheet: <https://docs.google.com/spreadsheets/d/1um6pHKriEhbtvmkm7e8E1j0_Zt9A-oYpY88fuPoAmFY/edit>
2. Menu: **Extensions → Apps Script**. A new tab opens with an empty project (this is a brand-new Apps Script project bound only to the Solomon Islands sheet — it is not connected to the iTaukei or Tongan sheets' scripts in any way).
3. In the left sidebar you'll see one file, `Code.gs`. Rename or delete it and create a new file called `solomon-master-writeback.gs`.

## 2. Paste the code

1. In the `ronvave/vave-lab` repo, open `apps-script/solomon-master-writeback.gs`.
2. Copy the entire file contents.
3. Paste them into `solomon-master-writeback.gs` in the Apps Script editor.
4. Click the **Save** icon (or ⌘S).
5. Confirm the pasted file's `SPREADSHEET_ID_HINT` reads `1um6pHKriEhbtvmkm7e8E1j0_Zt9A-oYpY88fuPoAmFY` before continuing. If it ever reads the iTaukei or Tongan ID, stop and re-paste from the correct source file — do not proceed.

## 3. Set the script property `SOLOMON_SPREADSHEET_ID`

The spreadsheet ID is intentionally NOT hardcoded as a secret in the script — it is read from a Script Property so the same code file can be redeployed against a copy/staging sheet without editing source.

1. In the Apps Script editor, **Project Settings** (gear icon, left sidebar) → scroll to **Script properties** → **Add script property**.
2. Add: `SOLOMON_SPREADSHEET_ID` = `1um6pHKriEhbtvmkm7e8E1j0_Zt9A-oYpY88fuPoAmFY`.

## 4. Generate and set the shared secret

**SET THIS — do not skip.** No secret is pre-generated or committed to the repo for this deployment.

1. In the Apps Script editor, select the function dropdown → choose `generateSecret` → click **Run**. First run will prompt an OAuth authorization — approve the scopes it asks for (Sheets read/write, Script Properties, LockService); click through the "unsafe app" warning since this is your own script under your own account.
2. Open **View → Executions** or **View → Logs** to read the freshly generated 64-hex-character secret.
3. Back in **Project Settings → Script properties**, add:

| Property | Value |
| --- | --- |
| `SOLOMON_SPREADSHEET_ID` | `1um6pHKriEhbtvmkm7e8E1j0_Zt9A-oYpY88fuPoAmFY` |
| `SHARED_SECRET` | *(the value `generateSecret` just logged — SET THIS)* |
| `WRITE_ENABLED` | `true` |
| `ADMIN_ORIGIN` | `https://ronvave.github.io` |

4. Click **Save script properties**.

## 5. Deploy as Web App

1. Top-right of the Apps Script editor: **Deploy → New deployment**.
2. Click the gear next to "Select type" → **Web app**.
3. Fill in:

   - **Description:** `Solomon Islands Master write-back v1`
   - **Execute as:** `Me (ronvave@hawaii.edu)`
   - **Who has access:** `Anyone with the link`

4. Click **Deploy**. Approve any OAuth prompts.
5. Copy the **Web app URL**. It will look like `https://script.google.com/macros/s/AKfyc…/exec`. This is a brand-new URL, distinct from the iTaukei and Tongan deployments' URLs — do not reuse or point at either of those.

## 6. Wire the Solomon Islands Admin Panel to it

1. Open the Solomon Islands admin panel: <https://ronvave.github.io/vave-lab/admin-solomon-islands-master.html>
2. Unlock the admin: enter the admin-login passcode on the login screen (see the `PASSWORD_HASH` constant in `js/admin-solomon-master.js` — a brand-new Solomon-specific value, not shared with the iTaukei/Tongan admins; **rotate the placeholder value before real data goes live**, see `SOLOMON-ADMIN-BUILD-NOTES.md`). If a second, separate lock-screen then appears asking to unlock the encrypted data files, enter the data-decryption passcode documented in `js/solomon-db-gate.js` (also a placeholder pending rotation).
3. Open the **Data source & GitHub** tab.
4. In the "Master write-back endpoint" section (currently shows **"Writeback endpoint not yet configured"** until you complete this step):

   - Paste the Web app URL from step 5 into the **Endpoint URL** field.
   - Paste the shared secret from step 4 into the **Shared secret** field.
   - Click **Save endpoint** to store both in this browser's `localStorage`, under Solomon-specific keys (`solomonlab_writeback_endpoint` / `solomonlab_writeback_secret`) that never collide with the iTaukei/Tongan admins' equivalent keys.
   - Click **Test connection**. You should see `ping ok · WRITE_ENABLED=true · actor=Ron Vave (admin) · spreadsheetId=1um6pHKriEhbtvmkm7e8E1j0_Zt9A-oYpY88fuPoAmFY`.
5. **Before your first real writeback test**, confirm the `spreadsheetId` shown in the Test connection response is `1um6pHKriEhbtvmkm7e8E1j0_Zt9A-oYpY88fuPoAmFY` and explicitly NOT the iTaukei (`1nJvMWLS8jnCOKtRoqdDpEW3s3j9TSAclXBO1txVFxdg`) or Tongan (`1lh6wOFcg2GiFe2YylgxM5cvLOdumdbCrHDLQk87rjRI`) IDs. Do not proceed with any write until this is visually confirmed.

## 7. Emergency read-only switch

If you ever need the Solomon Islands endpoint to reject all writes (for example while doing something structural in the sheet), open the Solomon Islands Apps Script project → Project Settings → Script properties → set `WRITE_ENABLED` to `false` → Save.

The admin UI's Save button will still submit, but the server will return `{status:'disabled'}` and no cell will change. Set it back to `true` to re-enable. This is authoritative — do not rely on the client-side disabled state alone. This switch is fully independent of the iTaukei and Tongan deployments' own `WRITE_ENABLED` properties.

## 8. Rotating the secret

If you ever need to rotate:

1. Run `generateSecret` again in the Solomon Islands Apps Script editor.
2. Update the `SHARED_SECRET` Script Property.
3. Paste the new value into the Solomon Islands admin's Shared secret field and click **Save endpoint**.
4. The old secret is now dead everywhere. This never affects the iTaukei or Tongan deployments' secrets.

## 9. Republishing after a code change

If `solomon-master-writeback.gs` is edited in the repo:

1. Copy the new version into the Solomon Islands Apps Script editor.
2. Save.
3. **Deploy → Manage deployments** → click the pencil on the active deployment → **Version: New version** → **Deploy**. The URL stays the same.

If you'd rather roll out a new URL instead (e.g. for a big breaking change), do **Deploy → New deployment** and paste the new URL into the Solomon Islands admin.

## What the Solomon Islands admin sends

Every save from the Solomon Islands admin is a POST to the Solomon Islands Web app URL with a JSON body like:

```json
{
  "secret":   "…64 hex chars…",
  "clientTs": 1724369100000,
  "action":   "write",
  "changes": [
    { "worksheet": "Scholars",  "scholarId": "SOL-S0001",
      "field": "Given Names", "oldValue": "", "newValue": "Example" }
  ]
}
```

The server:

1. Verifies the secret (constant-time compare) and the clock skew (≤ 5 min).
2. Takes a script-scoped lock (30s timeout).
3. Re-reads the current cell and compares to `oldValue`. If it drifted, classifies as `needs_confirmation` / `conflict` with the exact diff.
4. Validates the new value against the Solomon Islands field allowlist (types, enums, length) — including the Solomon-specific `Gender` enum (`Man`/`Woman`/`Self-described (see free text)`/`Not yet verified` — **placeholder pending community consultation**, see build notes), the 3-tier geography fields (`Paternal/Maternal Province/City Area`, `Paternal/Maternal Ward`, `Paternal/Maternal Specific Island`, `Paternal/Maternal Village/Community`), and the separately-stored customary/cultural fields (`Paternal/Maternal Clan/Tribe/Lineage`, `Customary Place`, `Self-identified Home/Community`) — none of which are ever derived from administrative geography.
5. Writes the cell.
6. Appends a row to `Change Log` (columns A–E) recording actor, worksheet, field, old value, new value — same five-column schema as the iTaukei/Tongan sister systems.

Every worksheet, every field, and every enum value is enforced server-side. Stable Scholar IDs (`SOL-S0001`, `SOL-S0002`, …) are the join key everywhere — CRUD never keys off row number.

## Sanity checklist

- [ ] Solomon Islands Master file's Apps Script project has `solomon-master-writeback.gs` saved, bound only to spreadsheet `1um6pHKriEhbtvmkm7e8E1j0_Zt9A-oYpY88fuPoAmFY`.
- [ ] `SOLOMON_SPREADSHEET_ID`, `SHARED_SECRET`, `WRITE_ENABLED=true`, `ADMIN_ORIGIN` all set on the Solomon Islands project (independent of the iTaukei/Tongan projects' properties).
- [ ] Web app deployed as "Execute as: me, Access: anyone with the link".
- [ ] Endpoint URL + secret pasted into the Solomon Islands admin (`admin-solomon-islands-master.html`), saved under Solomon-specific `localStorage` keys, and "Test connection" returns ok with the Solomon Islands spreadsheet ID visibly displayed.
- [ ] `Change Log` tab is present on the Solomon Islands Master sheet with its 5 columns (Version | Date | Change | Scope/Impact | Source) — do not rename headers.
- [ ] Before any real write test: the Test-connection response's `spreadsheetId` was visually confirmed to be `1um6pHKriEhbtvmkm7e8E1j0_Zt9A-oYpY88fuPoAmFY`, not the iTaukei or Tongan IDs.
- [ ] CRUD tested first on a clearly-labeled TEST scholar record before any live scholar data entry.
- [ ] Rotate the placeholder admin-login passcode (`PASSWORD_HASH` in `js/admin-solomon-master.js`) and the placeholder data-decryption passcode (`js/solomon-db-gate.js` / `js/solomon-demo-gate.js`) before real data goes live — both currently ship with SET-THIS placeholder values chosen for this scaffold build, not secrets Ron has confirmed.
