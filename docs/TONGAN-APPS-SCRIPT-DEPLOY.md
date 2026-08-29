# Apps Script deploy — Tongan Scholar Master write-back v1

One-time steps to stand up the `tongan-master-writeback.gs` web app that the Tongan Admin Panel calls when you save a change to the Tongan Master sheet.

**This is a completely separate, isolated deployment from the existing iTaukei `master-writeback.gs` web app.** It uses its own spreadsheet ID, its own shared secret, and its own Web App URL. It must never point at the iTaukei spreadsheet, and the iTaukei deployment must never be modified, redeployed, or reused for Tongan data.

You only need to do this once. After it's deployed, the Tongan Admin Panel talks to it directly and every write is authenticated, allowlisted, conflict-checked, and logged — mirroring the iTaukei system's write-back behavior exactly.

## What this deploys

- A bound Apps Script attached to the Tongan Master file (`1lh6wOFcg2GiFe2YylgxM5cvLOdumdbCrHDLQk87rjRI` — **Tongan Scholars Master File**). This is NOT the iTaukei sheet (`1nJvMWLS8jnCOKtRoqdDpEW3s3j9TSAclXBO1txVFxdg`).
- One Web App URL (execute as you, anyone with the link can hit it, but the shared secret gates every call).
- Three Script Properties: `SHARED_SECRET`, `WRITE_ENABLED`, `ADMIN_ORIGIN`.

Nothing goes on GitHub. The secret lives only in Google's Script Properties and in the Tongan Admin Panel's browser `localStorage` (under its own, separately-named keys — never the iTaukei `localStorage` keys, so the two systems cannot cross-talk even in the same browser).

## 0. Pre-generated values for this deployment

A shared secret has already been generated for you so this guide can be followed without extra steps:

| Property | Value |
| --- | --- |
| Tongan Spreadsheet ID | `1lh6wOFcg2GiFe2YylgxM5cvLOdumdbCrHDLQk87rjRI` |
| `SHARED_SECRET` | `0b732540ae27999f0f9cbb72c516f9b32fd4ceb7d3096663ac6cbae1fb2755bb` |
| `WRITE_ENABLED` | `true` |
| `ADMIN_ORIGIN` | `https://ronvave.github.io` |

You can use this secret as-is, or run `generateSecret()` yourself in step 3 to mint a fresh one — either way, **never reuse the iTaukei secret**, and never paste the Tongan secret into the iTaukei admin's Data source tab, or vice versa.

## 1. Open the Tongan Master file's Apps Script project

1. Open the Tongan Master sheet: <https://docs.google.com/spreadsheets/d/1lh6wOFcg2GiFe2YylgxM5cvLOdumdbCrHDLQk87rjRI/edit>
2. Menu: **Extensions → Apps Script**. A new tab opens with an empty project (this is a brand-new Apps Script project bound only to the Tongan sheet — it is not connected to the iTaukei sheet's script in any way).
3. In the left sidebar you'll see one file, `Code.gs`. Rename or delete it and create a new file called `tongan-master-writeback.gs`.

## 2. Paste the code

1. In the `ronvave/vave-lab` repo, open `apps-script/tongan-master-writeback.gs`.
2. Copy the entire file contents.
3. Paste them into `tongan-master-writeback.gs` in the Apps Script editor.
4. Click the **Save** icon (or ⌘S).
5. Confirm the pasted file's `SPREADSHEET_ID_HINT` reads `1lh6wOFcg2GiFe2YylgxM5cvLOdumdbCrHDLQk87rjRI` before continuing. If it ever reads the iTaukei ID, stop and re-paste from the correct source file — do not proceed.

## 3. Set the shared secret

Use the pre-generated secret from step 0, or generate your own:

1. (Optional, to mint a new one instead) In the Apps Script editor, select the function dropdown → choose `generateSecret` → click **Run**. First run will prompt an OAuth authorization — approve the scopes it asks for (Sheets read/write, Script Properties, LockService); click through the "unsafe app" warning since this is your own script under your own account.
2. Open **View → Executions** or **View → Logs** to read the freshly generated secret if you ran it, or use the pre-generated one from step 0.

## 4. Set Script Properties

1. In the Apps Script editor, **Project Settings** (gear icon, left sidebar) → scroll to **Script properties** → **Add script property**.
2. Add three properties:

| Property | Value |
| --- | --- |
| `SHARED_SECRET` | `0b732540ae27999f0f9cbb72c516f9b32fd4ceb7d3096663ac6cbae1fb2755bb` (or your own freshly generated secret) |
| `WRITE_ENABLED` | `true` |
| `ADMIN_ORIGIN` | `https://ronvave.github.io` |

3. Click **Save script properties**.

## 5. Deploy as Web App

1. Top-right of the Apps Script editor: **Deploy → New deployment**.
2. Click the gear next to "Select type" → **Web app**.
3. Fill in:

   - **Description:** `Tongan Master write-back v1`
   - **Execute as:** `Me (ronvave2011@gmail.com)`
   - **Who has access:** `Anyone with the link`

4. Click **Deploy**. Approve any OAuth prompts.
5. Copy the **Web app URL**. It will look like `https://script.google.com/macros/s/AKfyc…/exec`. This is a brand-new URL, distinct from the iTaukei deployment's URL — do not reuse or point at the iTaukei one.

## 6. Wire the Tongan Admin Panel to it

1. Open the Tongan admin panel: <https://ronvave.github.io/vave-lab/admin-tongan-master.html>
2. Unlock the admin: enter the admin-login passcode `xIN2rULfs6kUd4jB` on the login screen. If a second, separate lock-screen then appears asking to unlock the encrypted data files, enter `Ongoongo9!` there (this is the data-decryption passcode shared with the public dashboard's demo gate — both are brand-new Tongan-specific values, distinct from and never shared with the iTaukei admin's passcodes).
3. Open the **Data source & GitHub** tab.
4. In the "Master write-back endpoint" section:

   - Paste the Web app URL from step 5 into the **Endpoint URL** field.
   - Paste the shared secret from step 4 into the **Shared secret** field.
   - Click **Save endpoint** to store both in this browser's `localStorage`, under Tongan-specific keys (e.g. `tonganlab_writeback_endpoint` / `tonganlab_writeback_secret`) that never collide with the iTaukei admin's `vavelab_writeback_endpoint` / `vavelab_writeback_secret` keys.
   - Click **Test connection**. You should see `ping ok · WRITE_ENABLED=true · actor=Ron Vave (admin) · spreadsheetId=1lh6wOFcg2GiFe2YylgxM5cvLOdumdbCrHDLQk87rjRI`.
5. **Before your first real writeback test**, confirm the `spreadsheetId` shown in the Test connection response is `1lh6wOFcg2GiFe2YylgxM5cvLOdumdbCrHDLQk87rjRI` and explicitly NOT `1nJvMWLS8jnCOKtRoqdDpEW3s3j9TSAclXBO1txVFxdg` (iTaukei). Do not proceed with any write until this is visually confirmed.

## 7. Emergency read-only switch

If you ever need the Tongan endpoint to reject all writes (for example while doing something structural in the sheet), open the Tongan Apps Script project → Project Settings → Script properties → set `WRITE_ENABLED` to `false` → Save.

The admin UI's Save button will still submit, but the server will return `{status:'disabled'}` and no cell will change. Set it back to `true` to re-enable. This is authoritative — do not rely on the client-side disabled state alone. This switch is fully independent of the iTaukei deployment's own `WRITE_ENABLED` property.

## 8. Rotating the secret

If you ever need to rotate:

1. Run `generateSecret` again in the Tongan Apps Script editor.
2. Update the `SHARED_SECRET` Script Property.
3. Paste the new value into the Tongan admin's Shared secret field and click **Save endpoint**.
4. The old secret is now dead everywhere. This never affects the iTaukei deployment's secret.

## 9. Republishing after a code change

If `tongan-master-writeback.gs` is edited in the repo:

1. Copy the new version into the Tongan Apps Script editor.
2. Save.
3. **Deploy → Manage deployments** → click the pencil on the active deployment → **Version: New version** → **Deploy**. The URL stays the same.

If you'd rather roll out a new URL instead (e.g. for a big breaking change), do **Deploy → New deployment** and paste the new URL into the Tongan admin.

## What the Tongan admin sends

Every save from the Tongan admin is a POST to the Tongan Web app URL with a JSON body like:

```json
{
  "secret":   "…64 hex chars…",
  "clientTs": 1724369100000,
  "action":   "write",
  "changes": [
    { "worksheet": "Scholars",  "scholarId": "TON-S0001",
      "field": "Given Names", "oldValue": "", "newValue": "Sione" }
  ]
}
```

The server:

1. Verifies the secret (constant-time compare) and the clock skew (≤ 5 min).
2. Takes a script-scoped lock (30s timeout).
3. Re-reads the current cell and compares to `oldValue`. If it drifted, classifies as `needs_confirmation` / `conflict` with the exact diff.
4. Validates the new value against the Tongan field allowlist (types, enums, length) — including the Tongan-specific `Gender` enum (`Tangata`/`Fefine`/`Unknown`), the geography fields (`Paternal/Maternal Island Division`, `District Paternal/Maternal`, `Specific Island Paternal/Maternal`, `Village/Town Paternal/Maternal (Kolo)`), and the separately-stored cultural/lineage fields (Estate/Chiefly Affiliation (Tofiʻa), Haʻa/Lineage, Kāinga, Self-identified Home/Community Affiliation — Paternal and Maternal).
5. Writes the cell.
6. Appends a row to `Change Log` (columns A–E) recording actor, worksheet, field, old value, new value — same five-column schema as the iTaukei system.

Every worksheet, every field, and every enum value is enforced server-side. Stable Scholar IDs (`TON-S0001`, `TON-S0002`, …) are the join key everywhere — CRUD never keys off row number.

## Sanity checklist

- [ ] Tongan Master file's Apps Script project has `tongan-master-writeback.gs` saved, bound only to spreadsheet `1lh6wOFcg2GiFe2YylgxM5cvLOdumdbCrHDLQk87rjRI`.
- [ ] `SHARED_SECRET`, `WRITE_ENABLED=true`, `ADMIN_ORIGIN` all set on the Tongan project (independent of the iTaukei project's properties).
- [ ] Web app deployed as "Execute as: me, Access: anyone with the link".
- [ ] Endpoint URL + secret pasted into the Tongan admin (`admin-tongan-master.html`), saved under Tongan-specific `localStorage` keys, and "Test connection" returns ok with the Tongan spreadsheet ID visibly displayed.
- [ ] `Change Log` tab is present on the Tongan Master sheet with its 5 columns (Version | Date | Change | Scope/Impact | Source) — do not rename headers.
- [ ] Before any real write test: the Test-connection response's `spreadsheetId` was visually confirmed to be `1lh6wOFcg2GiFe2YylgxM5cvLOdumdbCrHDLQk87rjRI`, not the iTaukei ID.
- [ ] CRUD tested first on a clearly-labeled TEST scholar record (e.g. `TON-S0001` reserved as a test record, or a record whose Name Variants / Aliases field is explicitly marked "TEST — do not use for real data" until Phase 5-equivalent sign-off), before any live scholar data entry.
