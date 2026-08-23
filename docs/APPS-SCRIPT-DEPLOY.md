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

## Phase 3.3 update — Year of Birth + Panel F rules + Change Log schema fix

**Already written to the Master workbook (no more sheet writes needed for this phase):**

- New column `Year of Birth` at Scholars position 7, immediately after `Gender` and before `Alive / Deceased`. Every scholar row is blank; no birth years were inferred.
- The Vanua Evidence Audit FILTER and Dashboard's `AF`-based COUNTIF were auto-shifted by Google Sheets on the insert (verified `J5:S445`, `AN5:AN445`, and `$AG$5:$AG` respectively).
- Change Log row 227 documents the structural insert using the real 5-column schema (Version | Date | Change | Scope/Impact | Source). The prior pollution in rows 224-226 (extra columns F-J) was deliberately left in place per your instruction.

**Repo changes in Phase 3.3 (this commit):**

- `apps-script/master-writeback.gs` MAPPING v1.3 -> v1.4: adds `Year of Birth` (string, pattern `^(\d{4})?$`) between `Gender` and `Alive / Deceased`. The Change Log writer `appendChangeLog_` was rewritten to write exactly five columns: `[Version, Date, Change, Scope/Impact, Source]`. Actor / worksheet / field / verbatim old / verbatim new now live inside column D (Scope/Impact) so nothing spills into columns F onward.
- `data/admin-master-mapping.json` mirror bumped to 1.4 with the same field.
- `admin-master.html` Identity fieldset gains a new `Year of Birth` input between Gender and Alive / Deceased, using the same `pattern="^\d{4}$" maxlength="4"` validation as Year of Death.
- `js/admin-master.js` `openEditModal` reads `s['Year of Birth']` and populates the new field. Preview / write-back / optimistic-lock all flow through the existing `collectMasterChanges` + `writeBackScholarChanges` path (no per-field wiring required because it iterates every `[id^=me-][data-ws][data-field]` element in the modal).
- `js/master-file-adapter.js` now sources `yearOfBirth`, `yearOfDeath`, `salutation`, and the `deceased` boolean from the Master's structured columns (`Year of Birth`, `Year of Death`, `Title / Salutation`, `Alive / Deceased`) with the pre-existing sidecar `adminExtras` as fallback. `isDeceased` uses the exact controlled-enum match on `'Deceased'` (with sidecar or Master YoD as belt-and-braces fallbacks). A new `parseYearOrNull_` helper isolates the 4-digit-string parsing rules.
- `js/itaukei-database-master.js` `renderCardMemorialBand` is unchanged in behavior but its header comment now documents the approved Panel F rules A-E, calls out Ron's regression test (Jemesa Tudravu -> `d. YYYY`), and clarifies the data source (Master columns via the adapter, not `scholar-profiles.json`).
- Cache-buster mf25 -> mf26 on both `admin-master.html` and `itaukei-research-database-master.html` (5 tags + 4 tags respectively).

**Panel F rules implemented (in `renderCardMemorialBand`):**

- Rule A - Year of Birth and Year of Death both known: `YYYY – YYYY` (en-dash, matches the existing Panel F design).
- Rule B - only Year of Death known: `d. YYYY`. This is the Jemesa Tudravu regression form.
- Rule C - only Year of Birth known but Alive / Deceased = `Deceased`: `In memoriam`. No death year is invented.
- Rule D - neither year known but Alive / Deceased = `Deceased`: `In memoriam`.
- Rule E - Alive / Deceased != `Deceased`: no strip rendered (living scholars unaffected).

Jemesa Tudravu (ITK-S0381) currently has Year of Death blank in the Master, so his Panel F strip will render `In memoriam` until his Year of Death is populated. Once his `Year of Death` cell is set to `2025`, the strip will render exactly `d. 2025`. No inference is performed by the dashboard.

**Redeploy required?**

Yes. `apps-script/master-writeback.gs` changed (MAPPING v1.3 -> v1.4 plus the Change Log writer). Follow the standard Phase 3.x redeploy sequence: paste the current server file into the Apps Script editor, Cmd-S, Deploy -> Manage deployments -> pencil -> New version -> Deploy (same URL, same secret).

**Hard-refresh expected version.** After redeploying and hard-refreshing Admin V2 (Cmd-Shift-R) you should see `?v=mf26` on every script tag in DevTools Network. The Identity fieldset should now include the Year of Birth input between Gender and Alive / Deceased.

**Do not start Phase 5 yet.** Phase 5 (Joeli round-trip write test) is still gated on your explicit approval after you verify: (1) Test connection stays green, (2) Joeli's row reads back Alive with Year of Birth / Year of Death blank, (3) Kuridrani's row reads back Deceased with Year of Death 2021, (4) Panel F strips render according to rules A-E.

## Phase 3.4 - Field-level conflict handling and no-op adoption (2026-08-23)

### What changed and why

Phase 3.3 kept Admin V2's optimistic-lock check as an all-or-nothing gate at the batch level: if any field's loaded value differed from the current Master value, the entire save was rejected with `status: conflict`, even if that field's intended value already matched the current Master. Real-world scenario: Joeli Veitayaki's Alive/Deceased column was normalized from the legacy `Alive / current record` string to `Alive` between the modal opening and the save click. The modal held the stale `Alive / current record` as its `loaded` value; the user selected `Alive` (identical to current Master); Admin V2's server saw `loaded != currentMaster` and rejected the whole transaction. Nothing was writable until the page was reloaded.

Phase 3.4 replaces the batch-level lock with a three-way per-field classifier (`loaded / currentMaster / intended`) and a two-phase commit (dry-run classify -> explicit user decision -> authorized commit with re-read-before-write). No worksheet renames, column renames, formula changes, or added columns. Only master-mode files. V1 dashboard and old admin remain untouched. Change Log stays five-column.

### Per-field decision table

For every field the modal collected as an intended change, `applyOneChange_(ss, c, dryRun)` returns exactly one of:

| currentMaster vs intended | Always-confirm field? | currentMaster vs loaded | authorized? | Result | Written? |
|---|---|---|---|---|---|
| equal            | any | any     | any                     | `already_satisfied` | no |
| differs          | yes | any     | no                      | `needs_confirmation` (reason: `always-confirm-field`) | no |
| differs          | yes | any     | yes + expectedCurrent match | `ok` | yes |
| differs          | no  | equal   | n/a                     | `ok` | yes |
| differs          | no  | differs | no                      | `needs_confirmation` (reason: `master-changed`) | no |
| differs          | no  | differs | yes + expectedCurrent match | `ok` | yes |

`Always-confirm` is currently `{ 'Scholars.Alive / Deceased': true }`. Extend the `ALWAYS_CONFIRM` map at the top of `master-writeback.gs` to add more fields (e.g. life-status of a similarly sensitive column). `expectedCurrent` mismatch inside the lock means the Master changed a second time after the confirmation dialog was shown -> the server refuses the write and returns `needs_confirmation` again so the client re-classifies and re-prompts.

Batch-level `status` returned to the client is one of `ok` (all `ok`), `partial` (mix of `ok` and `already_satisfied`), `needs_confirmation` (any field still requires user action), `rejected` (validation failures with no writable fields), or `conflict-only` (all fields are `needs_confirmation`). No transaction ever gets silently dropped.

### Two-phase commit protocol

Wire protocol additions (backward-compatible: legacy clients that don't send `dryRun` still work but only ever get the strict optimistic-lock behavior for their subset of changes):

Request:
- `dryRun: true` on the classification request. Server returns per-field statuses without writing anything.
- Per-change `overrideAuthorized: true` + `expectedCurrent: "<stringified current value>"` on the commit request. Only accepted after the user explicitly confirmed the override in the preview modal.

Response (per result):
- `status`: one of `ok | already_satisfied | needs_confirmation | rejected`
- `currentValue`, `loadedValue`, `intendedValue`: canonical strings for the preview UI
- `willWrite`: bool
- `reason`: for `needs_confirmation`, one of `always-confirm-field | master-changed`

Response (overall): includes `dryRun`, `counts`, and per-field results in original submission order.

### Preview UI (four sections)

Admin V2's preview modal now renders four disjoint sections, in order:

1. **Will write** - fields safe to write. Sends verbatim on Confirm.
2. **Already satisfied** - fields where current Master already equals your intended value. Shown for transparency; never written.
3. **Master changed - adopt** - fields where you did NOT change the loaded value but the Master value has moved. The preview shows the current Master; on close, `data-loaded` is refreshed to the current Master so a re-open starts from a truthful baseline.
4. **Needs confirmation** - fields where your intended value contradicts the current Master. Each row has plain-language buttons; Alive/Deceased uses `Keep "Alive"` / `Change to "Deceased"` (or the equivalent for the specific values in play). Other fields use `Keep Master value` / `Overwrite Master`. The Confirm button remains disabled until every needs_confirmation row has a decision recorded.

If any needs_confirmation row is still undecided when Confirm is pressed, the button is inactive. If the user picks `Keep` on all of them, the classified `ok` fields still commit; the kept fields silently adopt the current Master into `data-loaded`.

### Second-race handling

Between the dry-run and the commit, another editor may write Master again. Server re-reads currentMaster inside the write lock; if any authorized override's `expectedCurrent` no longer matches, that field returns `needs_confirmation` and no write happens for it. Admin V2 catches the second-race response, re-classifies the full pending set, and re-renders the preview with fresh values so the user decides again. The client only closes the preview modal when the commit finishes with zero `needs_confirmation` responses.

### Change Log rule (unchanged from Phase 3.3)

Only actual writes create Change Log rows. `already_satisfied` fields do NOT produce a row. `needs_confirmation` fields that the user resolved by choosing `Keep` do NOT produce a row (there was no write). Confirmed overrides that actually write produce exactly one strict five-column row (columns A-E only; F-J blank), same as Phase 3.3. The Change Log reader endpoint now also parses the folded Scope/Impact string (`"actor - SID - Worksheet.Field: old -> new"`) so the Admin log tab renders correctly for post-Phase-3.3 rows while still reading legacy F-J columns verbatim for older rows.

### Files changed

- `apps-script/master-writeback.gs` - full rewrite of `handleWrite_` and `applyOneChange_`; new `ALWAYS_CONFIRM` map; new `parseFoldedScope_` helper for the Change Log reader; `dryRun` plumbing on the write endpoint.
- `js/admin-writeback-client.js` - `write(changes, opts)` now supports `opts.dryRun` and forwards `overrideAuthorized` / `expectedCurrent` on each change.
- `js/admin-master.js` - `saveEditModal` now runs the dry-run classifier before any modal renders; new `renderPreviewClassification` / `renderPreviewSection_` / `renderConfirmButtons_` / `refreshConfirmButtonState_` / `changeAt_`; `executeSaveAfterPreview` rewritten for the two-phase commit with second-race handling; new `adoptCurrentMasterBaselines_` helper.
- `admin-master.html` - preview modal intro rewritten to describe the four sections; cache-buster mf26 -> mf27 (5 tags).
- `itaukei-research-database-master.html` - cache-buster mf26 -> mf27 (4 tags).

### Redeploy sequence

Yes. `apps-script/master-writeback.gs` changed (new `handleWrite_`, `applyOneChange_`, `ALWAYS_CONFIRM`, `parseFoldedScope_`). Follow the standard Phase 3.x redeploy sequence: paste the current server file into the Apps Script editor, Cmd-S, Deploy -> Manage deployments -> pencil -> New version -> Deploy (same URL, same secret).

**Hard-refresh expected version.** After redeploying and hard-refreshing Admin V2 (Cmd-Shift-R) you should see `?v=mf27` on every script tag in DevTools Network. Test connection should stay green.

### Regression checklist (before approving Phase 5)

1. **Test A - stale but already-satisfied.** Open Joeli (ITK-S0315) in Admin V2 with the modal holding a stale `Alive / current record` load; the current Master is `Alive`; select `Alive` in the form; Save. Preview should classify Alive/Deceased as `already_satisfied` (or `needs_confirmation` under `always-confirm-field` rule; keeping `Alive` on that field must succeed with no writes). No Change Log row is added.
2. **Test B - unrelated edits survive.** Same modal, add a Primary Discipline edit (e.g. blank -> `Marine biology`). Preview shows Discipline in Will write and Alive/Deceased in Already satisfied / Keep. Confirm. Discipline is written; Alive/Deceased is not; Change Log gets one row for Discipline only.
3. **Test C - intentional Alive -> Deceased warning.** On a currently-Alive scholar, change Alive/Deceased to `Deceased`. Preview places the field in Needs confirmation with `Change to "Deceased"` / `Keep "Alive"`. Confirm button is disabled until you pick one. Picking Change and Confirm writes the row and creates one Change Log row; picking Keep and Confirm skips it entirely.
4. **Test D - cancel contradiction.** Same as Test C but click Back to edit. No writes happen and the form still holds `Deceased` locally for you to revise.
5. **Test E - concurrent change not made by user.** Have another editor bump Village Paternal on Master to a new value while Admin V2's modal is open. Do NOT edit Village Paternal in the modal. Trigger any other save. Village Paternal must NOT appear in Will write. If it appears anywhere it must be in Master changed - adopt (or be filtered out entirely because the intended value was never collected). Re-opening the modal should show the new Master value.
6. **Test F - second race after confirmation.** In Test C flow, between picking Change and clicking Confirm, have another editor set Alive/Deceased to `Unknown` on Master. Confirm. The server should return `needs_confirmation` for that field; Admin V2 should re-render the preview with the new current Master value (`Unknown`), requiring a fresh decision. No write should happen.
7. **Test G - Change Log strictness.** After Tests A-F, inspect Change Log rows via the Admin log tab: only actual writes appear; each row has A-E filled with `Actor -> SID -> Worksheet.Field: old -> new` in Scope/Impact; no rows for already_satisfied / kept fields.

**Do not start Phase 5 yet.** Phase 5 (Joeli round-trip write test) is still gated on your explicit approval after redeploying and running Tests A-G.
