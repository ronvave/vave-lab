# Phase 5 — Joeli Veitayaki (ITK-S0315) controlled round-trip test

This is the end-to-end verification of the Phase 3+4 write-back stack. You drive it from your unlocked Admin V2 session. Every write is reversible from the same UI — the last step of the protocol reverts every value the test touched.

**Target scholar:** ITK-S0315 · Veitayaki, Joeli
Master sheet row lookup: [Scholars](https://docs.google.com/spreadsheets/d/1nJvMWLS8jnCOKtRoqdDpEW3s3j9TSAclXBO1txVFxdg/edit#gid=0)

---

## Preconditions

Before starting, confirm all three:

1. Admin loads with no console errors — [https://ronvave.github.io/vave-lab/admin-master.html](https://ronvave.github.io/vave-lab/admin-master.html). Hard-refresh (⌘⇧R) after Phase 3+4 is pushed so the mf23 assets load.
2. Data source & GitHub tab → Master write-back endpoint card shows the green **Test connection** pill: `ping ok · WRITE_ENABLED=true · actor=Ron Vave (admin) · tz=Pacific/Honolulu`.
3. You have already applied the Phase 3 Apps Script re-deploy step in `docs/APPS-SCRIPT-DEPLOY.md` (the new file adds `readScholar`, `readRows`, `readChangeLog` actions).

If Test connection still returns green but Positions/Graduate Degrees rows show "Failed to load: unknown-action", you skipped the re-deploy — go back to that step first.

---

## A. Baseline capture (Master sheet, read-only)

Open the Master sheet in another tab and record the current values of Joeli's row so you have a baseline to compare against and to revert to at the end.

**Scholars tab, row for ITK-S0315:**

- Family Name: `_________`
- Given Names: `_________`
- Current Title: `_________`
- Current Institution: `_________`
- Google Scholar URL: `_________`

**Positions tab:** Joeli has 0 rows here (confirmed during Phase 1 audit; his Scholars-tab Current\* fields are the only writable positional data — approval-doc note in Doc 3 §2/§11).

**Graduate Degrees tab, all rows for ITK-S0315:** copy each row's `Row #`, `Degree Stage`, `Qualification`, `C_Uni name`, `Country`, `Start Year`, `Finish Year`, `Completion Status`.

---

## B. Round-trip test — five writes, one preview, one commit

The goal is to exercise every code path once. The changes are trivially reversible.

Open the admin, go to **Scholar profiles → search "Veitayaki" → click the row** to open the edit modal.

### Test writes

Make exactly these five edits inside the modal:

| # | Section | Field | Change (append a marker so it's easy to spot) |
|---|---|---|---|
| 1 | Identity | Family Name | append ` (test)` |
| 2 | Master fields — Public profile URLs | Google Scholar URL | append `?phase5=1` to the existing URL |
| 3 | Master fields — Current position | Current Title | append ` (test)` |
| 4 | Master fields — Paternal geography | Paternal district | append ` (test)` |
| 5 | Graduate Degrees (first row) | Thesis Title | append ` [phase5]` |

For write #5: if Joeli has no `Thesis Title` value on his first Graduate Degrees row, use `Duration` instead — pick any field with a non-empty existing value so the diff is meaningful.

### Preview

Click **Save & push**. The **Preview changes before writing to Master** modal should open with exactly five rows in the diff table, each showing:

- Correct worksheet name
- Correct row number (`—` for Scholars rows; a real row number for the Graduate Degrees row)
- Correct old value / new value (old value shown in muted grey, new value in normal weight)

If any row is missing, the diff missed the change. Cancel, re-do the affected edit, and try again.

### Commit

Click **Confirm and write**. Expected outcome:

1. Toast: `Saved ITK-S0315 — GitHub Pages will refresh in 1–2 minutes.`
2. Preview modal closes.
3. Edit modal closes.
4. Action log tab shows:
   `Master write-back — ok: 5 ok, 0 noop, 0 conflict, 0 reject.`

Now switch to the **Master change log** tab and click **Refresh**. The five most recent rows should be your test writes, each with:

- `actor = Ron Vave (admin)`
- `source = admin-master-webapp v1`
- `worksheet` + `field` + `old value` + `new value` matching what you did

Also open the Master sheet's `Change Log` tab in a new browser tab and confirm the same five rows landed at the bottom, using columns A–J only (Version / Date / Change / Scope / Source / Actor / Worksheet / Field / Old / New).

---

## C. Conflict test (optional but recommended)

This exercises the optimistic-lock path.

1. In the admin, open Joeli's modal again. Do NOT edit anything yet.
2. In the Master sheet directly, manually change Joeli's `Current Institution` to some sentinel value (e.g. `INSTITUTION-CONFLICT-TEST`) and hit Enter. Then revert it back to the original in a second manual edit so the sheet ends where it started, but the cell has been written since the modal opened — that's enough for the version snapshot to drift on a real conflict path if we compared cell revision counters. To force a real conflict for this test, leave `INSTITUTION-CONFLICT-TEST` in the sheet.
3. Back in the admin modal, change `Current Institution` to `Something else`. Click Save & push.
4. Preview shows one row: `Current Institution: <original> → Something else`.
5. Click **Confirm and write**. Expected: hard reject with a toast `Write-back rejected — see Action log`, and the Action log shows:
   `CONFLICT Scholars.Current Institution (row —): loaded="<original>" current="INSTITUTION-CONFLICT-TEST" attempted="Something else"`
6. Cell is NOT changed. Modal stays open with your edit still there.
7. Manually revert `Current Institution` in the sheet to the original value.

---

## D. Revert the test writes

Open Joeli's modal again (this refetches from Master so you see the current post-test values).

Reverse each of the five test writes:

| # | Field | Revert |
|---|---|---|
| 1 | Family Name | remove the trailing ` (test)` |
| 2 | Google Scholar URL | strip the trailing `?phase5=1` |
| 3 | Current Title | remove the trailing ` (test)` |
| 4 | Paternal district | remove the trailing ` (test)` |
| 5 | Graduate Degrees Thesis Title (or Duration) | remove the trailing ` [phase5]` |

Save → preview → confirm. Action log should show `Master write-back — ok: 5 ok, 0 noop, 0 conflict, 0 reject`.

Refresh the Master change log tab. You should now see 10 rows for the ITK-S0315 test (5 forward + 5 reverse), all with `actor = Ron Vave (admin)`.

---

## E. Sign-off checklist

- [ ] Test connection pill green
- [ ] Baseline captured (Section A)
- [ ] All 5 forward writes previewed and committed (Section B)
- [ ] Master change log tab shows 5 forward rows
- [ ] Master sheet's Change Log tab shows same 5 rows in A–J
- [ ] (Optional) Conflict test rejected with a diff shown in Action log (Section C)
- [ ] All 5 reversions previewed and committed (Section D)
- [ ] Joeli's row on the Master sheet ends identical to the Section A baseline
- [ ] No untracked structural changes to the workbook (no renamed/reordered/deleted columns, no renamed tabs)

If any step fails, note which one, screenshot the Action log and any toast, and hand back — I'll investigate before we widen the write-back to more scholars.
