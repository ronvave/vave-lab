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

## Phase 3 update — re-deploying after a server-code change

The Phase 3 build adds three read-only actions to `master-writeback.gs`:

- `readScholar` — fetch a single Scholars row live from the sheet (used to refresh the modal after a write)
- `readRows` — fetch all rows for a Scholar ID on `Positions` or `Graduate Degrees`
- `readChangeLog` — fetch the most recent N Change Log rows for the admin Change Log tab

None of these mutate the Master. They still require the shared secret. To pick them up:

1. Open the Apps Script project (Extensions → Apps Script on the Master sheet).
2. Overwrite the contents of `master-writeback.gs` with the new file in this repo (`apps-script/master-writeback.gs`).
3. Save (⌘S).
4. **Deploy → Manage deployments →** click the pencil on your existing Web App deployment → **Version: New version** → **Deploy**. This keeps the same URL you already pasted into the admin.

If you'd rather create a fresh deployment (which gets a new `/exec` URL), do that instead and paste the new URL into the admin's Data source tab.

After redeploying, hit **Test connection** in the admin — the pill should stay green. The new Positions and Graduate Degrees editors, and the Master change log tab, only work once this update is deployed.

## Phase 3.1 update — MAPPING corrected to real Master headers

The previous MAPPING used approximate column names (e.g. `Alive/Deceased`, `Current Title`, `ORCID`, `Primary Discipline/Field`, `Department/Unit`, `Qualification`, `Field`, `Thesis Title`). The live Master sheet actually uses:

- Scholars: `Alive / Deceased`, `Current Title / Role`, `ORCID / Researcher ID`, `Primary Discipline / Field`, `Institution Country`, `Current Department / Unit`, plus `Vanua / Provenance Notes`, `Current PG Status`, `Name Variants / Aliases`, `Record Notes`, and derived `Paternal Confederacy` — all with the exact spacing shown.
- Positions: `Department / Unit`, `Academic / Professional Title (verbatim)`, `Standardized Academic Rank`, `Leadership Title (verbatim)`, `Standardized Leadership Category`, `Evidence / Notes`, `Last Verified`.
- Graduate Degrees: `Degree / Qualification`, `Field / Discipline`, `Year / Status`, `Thesis / Research Title`, `Thesis / Repository URL`, `Evidence URL 1`, `Evidence URL 2`, `Verification`, `Notes`, `Finish / Completion Year`, `Duration (years)`, `Study Date Evidence / Notes`.

`Alive / Deceased` is a free-text descriptor in the sheet (values like `Alive / current record`, `Deceased — February 2021`), not a strict `Alive|Deceased|Unknown` enum. It is now typed as `string` with a client-side datalist of suggestions.

**Re-deploy sequence:**

1. Open the Master's Apps Script project (Extensions → Apps Script).
2. Fully overwrite `master-writeback.gs` in the editor with the current contents of `apps-script/master-writeback.gs` from this repo. If you skip this step, the deployment will still say "New version" but nothing will change.
3. ⌘S to save.
4. Deploy → Manage deployments → pencil on your existing Web App → **Version: New version** → Deploy. Same URL, same secret.
5. Hard-refresh admin (⌘⇧R) so the new `mf24` assets load.
6. In the admin's Data source tab, click **Test connection** — pill should stay green.
7. Open Joeli (ITK-S0315). Confirm that Positions and Graduate Degrees no longer show `bad_request: unknown-action`, and that Alive / Deceased now shows `Alive / current record`.

## Phase 3.2 update — Master structural + normalization changes applied

**What already changed in the Master workbook (already written; no action needed):**

- New column at Scholars position 3: `Title / Salutation` (values blank for all rows — awaiting your first edits via Admin V2).
- New column at Scholars position 8: `Year of Death` (values blank except ITK-S0088 = `2021`, extracted from the legacy `Deceased — February 2021` cell).
- Scholars column `Alive / Deceased` normalized to controlled vocabulary. Distribution before/after:
  - 397 × `Alive / current record`      →   `Alive`
  - 53 × `Unknown / not checked`        →   `Unknown`
  - 1 × `Deceased — February 2021`      →   `Deceased` (with 2021 preserved in Year of Death)
  - 24 × `Deceased`                     →   unchanged
- Sheet-level data validation on Alive / Deceased column: strict `ONE_OF_LIST {Alive, Deceased, Unknown}`.
- Change Log rows appended for both structural changes and the normalization.
- Google Sheets auto-adjusted the one cross-sheet A1 formula that used Scholars column letters (`Vanua Evidence Audit!A5` FILTER); no manual formula fixes required.

**Server MAPPING (v1.2 → v1.3) — needs redeploy:**

- Added `Title / Salutation` field: strict enum `[Dr, Prof, Rev, Rev Dr, Mr, Mrs, Ms, ""]`.
- Added `Year of Death` field: string, pattern `^(\d{4})?$` (four digits or blank).
- `Alive / Deceased` changed from free-text string to strict enum `[Alive, Deceased, Unknown, ""]` matching the sheet's controlled vocabulary and its ONE_OF_LIST data-validation rule.
- Added `pattern` support to `validateValue_` (only affects string-typed fields that declare a pattern).

**Admin V2:**

- Cache-buster mf24 → mf25.
- Identity fieldset now shows a real Title / Salutation dropdown before Family Name, a strict Alive / Deceased dropdown, and a new Year of Death input (four-digit numeric, blank when Alive/Unknown).

**Redeploy sequence (unchanged from Phase 3.1 — still required):**

1. Master → Extensions → Apps Script.
2. Fully overwrite `master-writeback.gs` in the editor with the current repo contents (v1.3).
3. ⌘S.
4. Deploy → Manage deployments → pencil → **Version: New version** → Deploy. Same URL, same secret.
5. Hard-refresh Admin V2 (⌘⇧R) so `mf25` loads.
6. **Test connection** — pill should stay green.
7. Open ITK-S0315 (Joeli): Title / Salutation shows `(no title)`, Alive / Deceased shows `Alive`, Year of Death is blank. Open ITK-S0088 (Kuridrani): Alive / Deceased shows `Deceased`, Year of Death shows `2021`.

**Panel F caveat — Year of Birth is not yet in the Master.**

Your Aug 23 doc asks Panel F to display a lifespan `YYYY – YYYY` for deceased scholars. The Master now has Year of Death but no Year of Birth column. Adding a Year of Birth column is an additional structural change that I have NOT made, because it is not explicitly approved in the current doc set. Options for the next step:

- Approve adding `Year of Birth` as a new Scholars column (recommended: position 5, immediately after `Given Names`, adjacent to identity attributes). Same string-with-pattern validation as Year of Death.
- Or specify a graceful "birth year unknown" Panel F fallback for now (for example, show `? – 2021` for Kuridrani).

I will not add a Year of Birth column without your explicit approval.
