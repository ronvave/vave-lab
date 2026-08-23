# Apps Script deploy — Master write-back v1

One-time steps to stand up the `master-writeback.gs` web app that the Admin V2 dashboard calls when you save a change to the Master sheet.

You only need to do this once. After it's deployed, the admin UI talks to it directly and every write is authenticated, allowlisted, conflict-checked, and logged.

## What this deploys

- A bound Apps Script attached to the Master file (`1nJvMWLS8jnCOKtRoqdDpEW3s3j9TSAclXBO1txVFxdg`).
- One Web App URL (execute as YOU, anyone with the link can hit it, but the shared secret gates every call).
- Three Script Properties: `SHARED_SECRET`, `WRITE_ENABLED`, `ADMIN_ORIGIN`.

Nothing goes on GitHub. The secret lives only in Google's Script Properties and in your Admin's browser `localStorage`.

## 1. Open the Master file's Apps Script project

1. Open the Master sheet: <https://docs.google.com/spreadsheets/d/1nJvMWLS8jnCOKtRoqdDpEW3s3j9TSAclXBO1txVFxdg/edit>
2. Menu: **Extensions → Apps Script**. A new tab opens with an empty project (or your existing one).
3. In the left sidebar you'll see one file, `Code.gs`. Rename or delete it and create a new file called `master-writeback.gs`.

## 2. Paste the code

1. In this repo, open `apps-script/master-writeback.gs`.
2. Copy the entire file contents.
3. Paste them into `master-writeback.gs` in the Apps Script editor.
4. Click the **Save** icon (or ⌘S).

## 3. Generate the shared secret

1. In the Apps Script editor, above the code area, select the function dropdown → choose `generateSecret` → click **Run**.
2. The first time you run any function you'll be prompted to authorize the script. Approve the OAuth scopes it asks for (Sheets read/write, Script Properties, LockService). Google will show a "This app isn't verified" warning because it's your personal script — click **Advanced → Go to (unsafe)** to continue. It is your own script running under your own account.
3. After it runs, open **View → Executions** or **View → Logs**. You'll see a line like `SHARED_SECRET = e59f3a…64chars`. Copy this string. **You will not be able to retrieve it again from here** — paste it into a safe local note now.

## 4. Set Script Properties

1. In the Apps Script editor, **Project Settings** (gear icon, left sidebar) → scroll to **Script properties** → **Add script property**.
2. Add three properties:

| Property | Value |
| --- | --- |
| `SHARED_SECRET` | (paste the 64-hex string from step 3) |
| `WRITE_ENABLED` | `true` |
| `ADMIN_ORIGIN` | `https://ronvave.github.io` |

3. Click **Save script properties**.

## 5. Deploy as Web App

1. Top-right of the Apps Script editor: **Deploy → New deployment**.
2. Click the gear next to "Select type" → **Web app**.
3. Fill in:

   - **Description:** `Master write-back v1`
   - **Execute as:** `Me (ronvave2011@gmail.com)`
   - **Who has access:** `Anyone with the link`

4. Click **Deploy**. Approve any OAuth prompts.
5. Copy the **Web app URL**. It will look like `https://script.google.com/macros/s/AKfyc…/exec`.

## 6. Wire the admin to it

1. Open the admin dashboard: <https://ronvave.github.io/vave-lab/admin-master.html>
2. Unlock the admin with your usual passcode.
3. Open the **Data source & GitHub** tab.
4. In the new "Master write-back endpoint" section:

   - Paste the Web app URL from step 5 into the **Endpoint URL** field.
   - Paste the shared secret from step 3 into the **Shared secret** field.
   - Click **Save endpoint** to store both in this browser's `localStorage`. The secret never leaves your device.
   - Click **Test connection**. You should see `ping ok · WRITE_ENABLED=true · actor=Ron Vave (admin)`.

## 7. Emergency read-only switch

If you ever need the endpoint to reject all writes (for example while you're doing something structural in the sheet), open the Apps Script project → Project Settings → Script properties → set `WRITE_ENABLED` to `false` → Save.

The admin UI's Save button will still submit, but the server will return `{status:'disabled'}` and no cell will change. Set it back to `true` to re-enable. This is authoritative — do not rely on the client-side disabled state alone.

## 8. Rotating the secret

If you ever need to rotate:

1. Run `generateSecret` again in the Apps Script editor.
2. Update the `SHARED_SECRET` Script Property.
3. Paste the new value into the admin's Shared secret field and click **Save endpoint**.
4. The old secret is now dead everywhere.

## 9. Republishing after a code change

If we edit `master-writeback.gs` in the repo:

1. Copy the new version into the Apps Script editor.
2. Save.
3. **Deploy → Manage deployments** → click the pencil on the active deployment → **Version: New version** → **Deploy**. The URL stays the same.

If you'd rather roll out a new URL instead (e.g. for a big breaking change), do **Deploy → New deployment** and paste the new URL into the admin.

## What the admin sends

Every save from the admin is a POST to your Web app URL with a JSON body like:

```json
{
  "secret":   "…64 hex chars…",
  "clientTs": 1724369100000,
  "action":   "write",
  "changes": [
    { "worksheet": "Scholars",  "scholarId": "ITK-S0315",
      "field": "Given Names", "oldValue": "Joeli", "newValue": "Joeli" }
  ]
}
```

The server:

1. Verifies the secret (constant-time compare) and the clock skew (≤ 5 min).
2. Takes a script-scoped lock (30s timeout).
3. Re-reads the current cell and compares to `oldValue`. If it drifted, returns a `conflict` result with the exact diff.
4. Validates the new value against the field allowlist (types, enums, length).
5. Writes the cell.
6. Appends a row to `Change Log` (columns A–J) recording actor, worksheet, field, old value, new value.

Every worksheet, every field, and every enum value is enforced server-side. If you edit the mapping JSON in the repo but forget to update the Apps Script, the server allowlist wins.

## Sanity checklist

- [ ] Master file's Apps Script project has `master-writeback.gs` saved.
- [ ] `SHARED_SECRET`, `WRITE_ENABLED=true`, `ADMIN_ORIGIN` all set.
- [ ] Web app deployed as "Execute as: me, Access: anyone with the link".
- [ ] Endpoint URL + secret pasted into admin, saved, and "Test connection" returns ok.
- [ ] `Change Log` tab is still present with its 10 columns (do not rename headers).
