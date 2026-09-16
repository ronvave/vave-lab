# Phase 3.4 - Field-Level Conflict Handling: Completion Report

**Commit:** `8efb0a6` on `main`
**Deployed to Pages:** yes (verified `?v=mf27` on `https://ronvave.github.io/vave-lab/admin-master.html`)
**Apps Script redeploy required:** **YES** (`apps-script/master-writeback.gs` changed)
**Phase 5:** **NOT started.** Gated on your explicit approval after redeploy + Tests A-G.

## Root cause of the Joeli regression

`applyOneChange_` in `apps-script/master-writeback.gs` had (prior to this
commit) an optimistic-lock check at line ~416 that fired *before* the no-op
check against the intended value:

```
if (loadedValueStr !== currentValueStr) return { status: 'conflict', ... }
```

That branch returned a `conflict` verdict as soon as the modal's `loaded`
value differed from the current Master value - even when the *intended* value
already equaled the current Master value and no write was needed.

The client-side `executeSaveAfterPreview` compounded the problem: when the
server response contained `status: 'conflict'`, the client aborted the entire
batch and returned a red toast, so unrelated fields in the same save could not
be written either.

Joeli Veitayaki (ITK-S0315) trigger sequence:

1. Master was normalized from legacy `Alive / current record` -> `Alive`.
2. Admin V2's modal held the cached (stale) `Alive / current record` in
   `data-loaded` because `state.scholarById[sid]` was populated from the
   GitHub-Pages-cached MasterFileAdapter bundle at page load.
3. User selected `Alive` in the dropdown, saved.
4. Server saw `loaded=Alive / current record` vs `current=Alive` -> `conflict`.
5. Because it was the only field being saved, the whole batch was rejected.

## Fix summary

Replaced the batch-level optimistic lock with per-field classification, and
split the write flow into two phases: dry-run classify -> user decision ->
authorized commit with re-read-before-write.

### Server decision table (implemented in `applyOneChange_`)

| currentMaster vs intended | Always-confirm field? | currentMaster vs loaded | authorized? | Result             | Written? |
|---------------------------|-----------------------|-------------------------|-------------|--------------------|----------|
| equal                     | any                   | any                     | any         | `already_satisfied`| no       |
| differs                   | yes                   | any                     | no          | `needs_confirmation` (`always-confirm-field`) | no |
| differs                   | yes                   | any                     | yes + expectedCurrent match | `ok` | yes |
| differs                   | no                    | equal                   | n/a         | `ok`               | yes      |
| differs                   | no                    | differs                 | no          | `needs_confirmation` (`master-changed`)       | no |
| differs                   | no                    | differs                 | yes + expectedCurrent match | `ok` | yes |

`ALWAYS_CONFIRM = { 'Scholars.Alive / Deceased': true }` - extend the map to
add more status fields later.

Batch-level `status`: `ok` | `partial` | `needs_confirmation` | `rejected` |
`conflict-only`.

### Wire protocol additions (backward-compatible)

Request:
- `dryRun: true` for classification-only.
- Per-change `overrideAuthorized: true` + `expectedCurrent: "<current value>"`
  for authorized commits after user confirmation.

Response (per result):
- `status`: `ok | already_satisfied | needs_confirmation | rejected`
- `currentValue`, `loadedValue`, `intendedValue`, `willWrite`, `reason`

Response (overall): `dryRun`, `counts`, per-field results in submission order.

### Preview UI (four sections)

Rendered by `renderPreviewClassification` in `js/admin-master.js`:

1. **Will write** - clean writes; commit as-is.
2. **Already satisfied** - shown for transparency; never written; no Change
   Log row.
3. **Needs confirmation** - per-row `Keep` / `Change` buttons. Alive/Deceased
   uses plain-language labels (`Keep "Alive"` / `Change to "Deceased"`).
   Confirm button disabled until every row has a decision.
4. **Rejected** - validation failures with a reason column.

The `Already satisfied` and `Keep` decisions cause `data-loaded` on the input
to adopt the current Master value on close, so a re-open starts from truth.

### Second-race handling

Server re-reads currentMaster inside the write lock. If an authorized
override's `expectedCurrent` no longer matches, that field returns
`needs_confirmation`; Admin V2 catches this on the commit response,
re-classifies the entire pending set, and re-renders the preview so the user
decides again with fresh values. The modal only closes when no `needs_confirmation` remains.

## Files changed (all in commit `8efb0a6`)

- `apps-script/master-writeback.gs` - full rewrite of `handleWrite_` and
  `applyOneChange_`; new `ALWAYS_CONFIRM` map; new `parseFoldedScope_` helper
  for the Change Log reader; `dryRun` plumbing.
- `js/admin-writeback-client.js` - `write(changes, opts)` supports
  `opts.dryRun` and forwards `overrideAuthorized` / `expectedCurrent`.
- `js/admin-master.js` - two-phase commit: `saveEditModal` runs dry-run first;
  new `renderPreviewClassification` / `renderPreviewSection_` /
  `renderConfirmButtons_` / `refreshConfirmButtonState_` / `changeAt_`;
  `executeSaveAfterPreview` rewritten with second-race handling; new
  `adoptCurrentMasterBaselines_` helper.
- `admin-master.html` - preview modal intro rewritten for the 4-section flow;
  cache-buster `mf26 -> mf27` (5 script tags).
- `itaukei-research-database-master.html` - cache-buster `mf27` (4 tags).
- `docs/APPS-SCRIPT-DEPLOY.md` - Phase 3.4 section with the decision table,
  wire protocol, preview UI spec, second-race handling, Change Log rule,
  Tests A-G checklist.

## Redeploy sequence for Ron

1. Open the Master sheet -> Extensions -> Apps Script.
2. Paste the current `apps-script/master-writeback.gs` file into the editor
   (overwrite whatever is there).
3. Cmd-S.
4. Deploy -> Manage deployments -> pencil icon on the current deployment ->
   New version -> Deploy. Keep the same URL and same secret. Copy the URL
   only if it changed (it should not).
5. Hard-refresh Admin V2 (Cmd-Shift-R). Confirm every script tag in DevTools
   Network shows `?v=mf27`. `Test connection` should stay green.

## Tests A-G (run after redeploy - I did not perform substantive Master writes)

Per your stop rule (no new substantive Master edits merely to make the tests
pass), I did NOT run the writeback tests against the production Master.
Instead I have a repo-verified proof-of-behavior plan you can run:

| Test | Setup | Expected behavior | Pass criterion |
|------|-------|-------------------|----------------|
| A - stale but already-satisfied | Open ITK-S0315 (Joeli). Master is `Alive`. Modal will hold whatever it caches; select `Alive` and Save. | Preview classifies Alive/Deceased as `already_satisfied` OR `needs_confirmation` (`always-confirm-field`). Keep -> no write; Change is not offered because intended equals current. | No Change Log row for this field. |
| B - unrelated edits survive alongside already-satisfied | On Joeli, edit Primary Discipline (blank -> `Marine biology`) plus the Alive/Deceased selection from Test A. | Preview shows Discipline in Will write; Alive/Deceased in Already satisfied or Kept. Confirm. | Discipline gets one Change Log row; Alive/Deceased gets none. **Revert Discipline afterward.** |
| C - intentional Alive -> Deceased warning | Pick any Alive scholar (e.g. controlled test row you can revert). Change Alive/Deceased to `Deceased`. | Preview places it in Needs confirmation. Confirm button disabled until you pick. `Change to "Deceased"` label present. Pick Change -> write happens; pick Keep -> no write. | Test with a reversible scholar and revert afterward. |
| D - cancel contradiction | Same as Test C but click Back to edit after choosing. | No writes; form retains `Deceased` for further edit. | No Change Log rows added; Master unchanged. |
| E - concurrent change (unedited by user) | While the modal is open, edit Village Paternal directly in the Master sheet. Do NOT edit Village Paternal in the modal. Save any other field. | Village Paternal must NOT appear anywhere in the preview (it was never collected because the modal never saw the user change it). Only the intentional field is classified. | Re-open the modal -> Village Paternal reflects the new Master value. |
| F - second race after confirmation | In Test C flow, between picking Change and pressing Confirm, edit Alive/Deceased in Master to `Unknown`. | Commit returns `needs_confirmation` for that field. Admin V2 re-classifies and re-renders the preview with the new current value (`Unknown`) and forces a fresh decision. | No spurious write; new preview shows current=`Unknown`. |
| G - Change Log strictness | After A-F, open Admin V2's Change Log tab. | Only fields that produced an actual write appear. Each row's Scope/Impact reads `Ron Vave (admin) - <SID> - Worksheet.Field: old -> new`. Columns F-J are blank for new rows. | Reader parses folded scope so actor/field/etc. render even though F-J are empty. |

**Please do NOT run Tests A-G on Joeli Tudravu (ITK-S0381) with Title/YoD -
that per your standing rule is not to be populated. Use reversible fields on
other scholars.**

## Cache-buster verified

`curl` on GitHub Pages after push (2026-08-23):

```
$ curl -sS https://ronvave.github.io/vave-lab/admin-master.html | grep -oE 'v=mf2[0-9]' | sort -u
v=mf27
```

All 5 script tags (`db-gate.js`, `master-file-adapter.js`,
`admin-insights-migration.js`, `admin-writeback-client.js`, `admin-master.js`)
serve at `?v=mf27`. `itaukei-research-database-master.html` also serves 4 tags
at `mf27`.

## Remaining ambiguity / notes

1. **How the modal's `loaded` value gets stale.** The modal populates from
   `state.scholarById[sid]`, which is filled from
   `MasterFileAdapter.load()` at page load and never refreshed until a full
   page reload or `refreshMasterForScholar(sid)`. Phase 3.4 fixes the write
   path so a stale `loaded` no longer breaks writes, but the modal can still
   *display* stale values on open. If you want the modal to always open with
   a live read, we would add a `readScholar` call at modal open (extra API
   hit per open, small latency). I did not add this in Phase 3.4 because it
   changes read behavior beyond the current spec; flag it if you want it in a
   Phase 3.5.

2. **`already_satisfied` when the field is `always-confirm`.** The decision
   table says `currentMaster equal to intended` -> `already_satisfied`
   regardless of the `always-confirm` flag. That means if the field is
   already `Alive` and the user picks `Alive`, no confirmation prompt is
   shown. If you want a "yes, I really mean Alive" dialog every time the
   Alive/Deceased row is touched (even when the value is unchanged), flip
   the classifier to prioritize `ALWAYS_CONFIRM` above the equality check.
   I did NOT do that here because your prompt specifies that
   `already_satisfied` -> "Do not write that field again, do not show an
   error, and do not prevent other fields from being written." I read that
   as no dialog either. Confirm if you want a stricter reading.

3. **Rejected sections.** Server-side validators (`validate.year`,
   `validate.enum`, `validate.pattern`) still short-circuit with `rejected`
   before the classifier runs. Rejected rows appear in a fourth preview
   section; the user must fix the value in the edit modal.

4. **Change Log reader for legacy rows.** Rows 224-226 (the pollution rows
   you asked me not to clean up) will still render with legacy per-column
   values because F-J are non-blank for them. New rows read cleanly via the
   folded-Scope parser. No cleanup happens.

5. **No manual Master writes were performed by me in this segment.** The
   only Master reads were via the classifier dry-run wiring, which does not
   write. All test verification is on you.

## Ready for redeploy

Once you redeploy the Apps Script, hard-refresh Admin V2, and run Tests
A-G with reversible values, respond here with the results and I will
prepare the Phase 5 (Joeli round-trip) test protocol - but only after you
explicitly approve.
