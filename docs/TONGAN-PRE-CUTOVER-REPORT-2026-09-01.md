# Tongan Admin Rebuild — Pre-Cutover Report

**Date:** 2026-09-01 (HST)
**Status:** 12 of 16 matrix items now PASSED (1, 3, 4, 16 via direct testing/code review; 5, 6, 7, 8, 9, 13, 14, 15 via your manual authenticated walkthrough). **NOT yet approved for cutover** — 4 items (2, 10, 11, 12) remain, all requiring a second Google account. No live resource has been touched.

---

## 1. Staging resources (all new; nothing live was modified)

| Resource | Location |
|---|---|
| Staging Admin (Google-auth, role-gated) | `https://script.google.com/macros/s/AKfycbxuqTgtBXdKsn4PFPAYKa82xhvT7KkthCNGuiOjwmmTzfNdYc72T6y8uy5ZHnkDUd42zQ/exec` |
| Backup Master Sheet (full copy + 12 new tables) | `https://docs.google.com/spreadsheets/d/1XTbiKazab-2WWJmkqjJ6AIWvymBL5-6Jj8EsHXYcXWs/edit` |
| Public "Update info" test harness (isolated, not linked from live nav) | `https://ronvave.github.io/vave-lab/staging/tongan-dashboard-staging-updateinfo-test.html` |
| Quarantine Drive folder (unapproved uploads) | Folder ID `1K52nF1dz7RpSJQRDJvF6-nEJ-OXvRv0D` |
| Change-history Doc (audit trail) | `https://docs.google.com/document/d/1p5icHjnRNgzQ5sg4pHH4rZXiqVl3fQMNaDvD2ZqzPd0/edit` |
| Implementation plan | Saved in this project's files under `planning/tongan-admin-rebuild-and-authentication-workflow-plan.md` |
| Deploy steps (already completed by you) | `docs/TONGAN-STAGING-DEPLOY.md` in `ronvave/vave-lab` |
| Worksheet reconciliation | `docs/TONGAN-STAGING-WORKSHEET-RECONCILIATION.md` in `ronvave/vave-lab` |
| Code | `apps-script-staging/*.gs`/`*.html` in `ronvave/vave-lab`, commits `9c7f1b73`, `28bfa105` |

**Untouched, confirmed:** live Master Sheet (`1lh6wOFcg2GiFe2YylgxM5cvLOdumdbCrHDLQk87rjRI`), live Google-auth Admin, live GitHub Admin panel (`admin-tongan-master.html`), live public dashboard.

---

## 2. Components built (all against the backup Sheet / staging deployment only)

1. **Role framework** — Owner / Researcher / Authenticator, backed by the `Admin Users` table. Seeded Owner: `ronvave@hawaii.edu`.
2. **Public correction pipeline** — anonymous "Update info" form (`doPost`) writes only to quarantine tables (`Public Update Submissions`, `Submission Field Changes`, `Uploaded Submission Files`); never touches `Scholars` directly.
3. **For-Review queue** — side-by-side original vs. proposed values, full/partial/reject/return decisions per field.
4. **Dual-authenticator Indigenous-Tongan identity workflow** — evidence-based only (`Identity Evidence`, `Identity Decisions`, `Identity Status History`, `Second Review Requests`); no inference from name/appearance/birthplace/topic/affiliation.
5. **Audit log + rollback** — `Change Audit Log` records every write with old/new value, actor, role, and Doc-sync status; Owner-only rollback by Audit ID.
6. **Change-history Doc sync** — best-effort append to the audit Doc on every write; failures are marked `failed-retry` and never block the underlying database write; Owner-only `apiRetryDocSync` re-attempts them.
7. **Owner-only on-demand publish** — preview then publish, per your Option-B/on-demand-publishing decision.
8. **Admin visual/UX** — reproduces the legacy `admin-tongan-master.html` teal/cream/coral/gold layout inside the new authenticated app.

---

## 3. Test results

### Tests completed and passed (direct HTTP against the live staging deployment)

These exercise the two genuinely public, unauthenticated entry points — `doGet` for anonymous visitors and `doPost` for the public correction form. Both are reachable by plain HTTP request/response, so I could run and verify them directly.

| # | Test | Result | Evidence |
|---|---|---|---|
| 1 | Unauthorized/anonymous denial | **PASS** | Anonymous `GET` on the exec URL returns the app's own "Not authorised… (not signed in)" page — never a Google login wall, never scholar data. |
| 3 | Public submission — validation paths | **PASS** | Honeypot-filled → `spam-detected` (rejected before any write). Missing name/email/relationship → `missing-required-submitter-fields`. Malformed email → `invalid-email`. Unknown scholar ID → `scholar-not-found`. Unsupported action → `unsupported-action`. Rate limiter (5/hour per scholar ID) also confirmed working — it correctly blocked repeat test calls once exceeded. |
| 3 | Public submission — real end-to-end success | **PASS** | Valid submission for `TNG-S0005` (Sione Manupuna ʻUlise Halekauila Funaki) returned `{"status":"ok","submissionId":"SUB-20260901-022739-1662", ...}`. Verified in `Public Update Submissions` and `Submission Field Changes`: correct scholar name snapshot, correct field-change row, status `Pending`. Scholar row itself was **not** altered (write only reaches quarantine, as designed). |
| 4 | Quarantined photo upload | **PASS** | Submission for `TNG-S0006` with one allowed `image/png` and one disallowed `.exe` attached. Result: only the PNG was recorded in `Uploaded Submission Files` (`Approved?` = `No`) and landed in the Drive quarantine folder (`1K52nF1dz7RpSJQRDJvF6-nEJ-OXvRv0D`, confirmed via file metadata). The disallowed file type was silently skipped exactly as coded — no error, no partial write. |
| 16 | No bulk dataset sent to browser at login (design check) | **PASS (code review)** | `doGet` template only ever sets `activeEmail`/`activeName`/`activeRole`/`spreadsheetId`/`appVersion` — no scholar rows in the initial HTML. The scholar list is only ever fetched afterward via `apiListScholars()`, which itself returns a curated summary (name, discipline, institution, publication counts) — not the full record, not contact/identity/lineage-evidence fields. This is a structural/code-level confirmation; I could not dynamically capture the actual network payload since that requires an authenticated browser session (see below). |

**Root-cause note (resolved):** the earlier curl failures ("Page Not Found" on every `doPost`) were not a server bug. Apps Script's `/exec` endpoint answers a POST with a 302 redirect to a one-time `script.googleusercontent.com/macros/echo?...` URL; the correct client behavior is to **GET** that redirect URL to retrieve the already-computed response, not re-POST to it. Fixed by capturing the `Location` header and issuing a plain GET. Confirmed by comparing against the harness page's `fetch()` behavior, which a real browser handles automatically.

**Test data left in the backup Sheet:** three submissions now sit in `Public Update Submissions` with `Pending` status — `SUB-20260901-022609-8444` (TNG-S0001, incidental valid submission created while debugging the redirect, harmless), `SUB-20260901-022739-1662` (TNG-S0005), `SUB-20260901-023021-1711` (TNG-S0006, with the quarantined photo). These were used as ready-made fixtures for the review-queue tests below.

### Tests completed via your manual authenticated-browser walkthrough (Owner-only, 2026-09-01)

All of the following were run one at a time in your own signed-in session (`ronvave@hawaii.edu`, Owner) against the live staging deployment, with each result independently verified against the backup Sheet (`gws sheets spreadsheets values get`) rather than relying on the UI alone.

| # | Test | Result | Evidence |
|---|---|---|---|
| 5 | Full approval | **PASS** | `SUB-20260901-022739-1662` (TNG-S0005) fully approved and applied. Backup Sheet confirms "Current Title / Role" = "STAGING-TEST Title [test-matrix-item-3]". Later reverted cleanly in Test 14. |
| 6 | Partial approval | **PASS** | `SUB-20260901-030503-6174` (TNG-S0002, 2 fields): one field approved and applied ("Current Title / Role"), one rejected and left unchanged ("Current Institution" stayed "Brigham Young University–Hawaii"). Overall status correctly "Partially approved". |
| 7 | Full rejection | **PASS** | `SUB-20260901-022609-8444` (TNG-S0001) rejected outright — "Applied: 0 ok, 1 rejected, 0 returned, 0 conflict-blocked". TNG-S0001 confirmed unchanged ("Assistant Professor of Art History"). |
| 8 | Returned for clarification | **PASS** | `SUB-20260901-030951-7505` (TNG-S0003) marked "Returned for clarification". Live value unchanged (column U still "Brigham Young University–Hawaii"). |
| 9 | Concurrent-edit conflict | **PASS** | `SUB-20260901-023021-1711` (TNG-S0006): you manually edited the live field to "MANUALLY-EDITED-DURING-TEST" before Apply. Apply correctly blocked the write — 0 fields applied, 1 conflict-blocked. Confirmed via direct sheet read that the manual edit was never overwritten. |
| 13 | Doc-sync failure + retry | **PASS** | Temporarily pointed `HISTORY_DOC_ID` at an invalid ID and redeployed. A new field-apply (`TNG-S0004`, disposable fixture `SUB-20260901-033321-2929`) produced audit row `AUD-20260901-033846-4999` with `Doc Sync Status` = `failed-retry` (confirmed via direct sheet read) — the database write itself succeeded normally, unaffected by the Doc outage. Restored the real ID, redeployed, clicked "Retry Doc sync", and confirmed the same row flipped to `synced`. |
| 14 | Owner rollback | **PASS** | Rolled back Test 5's applied change (`AUD-20260901-025055-9113`) via the Change Log. TNG-S0005's "Current Title / Role" confirmed reverted to "Adjunct Faculty" on the sheet; the original audit row remains untouched and a new "rollback"-type row records the reversal — history is preserved, not overwritten. |
| 15 | Publish preview + publish | **PASS** | "Preview pending changes" correctly listed all 5 change events since the (never-yet-published) epoch. "Publish" wrote `staging-publish-20260901-035101.json` (confirmed on Drive, in the "2_Tongan Scholarly Database" folder, 1066 bytes) and updated the last-publish timestamp. No live GitHub Pages file was touched, confirmed both by code review and by there being no corresponding change to any repo file. |

**Two real bugs were found and fixed during this walkthrough** (both staging-only; live system never touched):

1. **False CONFLICT badge on already-applied fields** (found during Test 5 re-check) — the conflict flag compared the live value against the original submission-time snapshot even after a field had already been applied, so a correctly-applied field could still show a red CONFLICT badge. Fix: once a field is `Applied To Live? = Yes`, compare live value against the *proposed* value instead. Committed `240e60a5`, redeployed, verified fixed live.
2. **Misleading "Partially approved" status on fully-conflict-blocked submissions** (found during Test 9) — a submission with 0 fields actually applied (all blocked by conflict) fell into a generic "Partially approved" label, implying something had been written when nothing had. Fix: added a distinct "Conflict — needs re-review" status, checked ahead of the Rejected/Returned branches, plus a matching filter option in the queue dropdown. Committed `62b4d23f`, redeployed, verified fixed live.
3. **Unguarded double-rollback** (found during Test 14) — `apiRollbackChange` always rewrites an audit row's original "Old Value" back to live with no check of what's currently live, and the UI kept offering the "Rollback" button on a row indefinitely, even after it had already been reversed once. A repeat click produced a harmless no-op in this case, but the same gap could silently discard a legitimate change made after the first rollback, with no warning. Fix (UI-only guard, backend write path unchanged): the Change Log now shows "Already rolled back" instead of an active button for any audit row that has already been reversed. Committed `e723135a`, redeployed, verified fixed live.

### Tests that still require a second Google account

The remaining 4 matrix items genuinely need two distinct human testers with two distinct Google accounts — I cannot act as a second identity for these, and dual-authenticator agreement/disagreement is the exact thing the identity workflow exists to enforce honestly.

| # | Test | Why it needs a second account | Suggested steps |
|---|---|---|---|
| 2 | Role enforcement | Needs a real signed-in session per role, not just Owner | Add a second real Google account to `Admin Users` as `Researcher` (view-only on core fields) and sign in as that account in a different browser/profile — confirm it can view but not edit/approve/rollback/publish. Remove a listed account and confirm it reverts to "Not authorised." |
| 10–12 | Second-authenticator flow, dual-authenticator identity decision, conflicting-decision escalation | Needs two distinct Authenticator accounts | Add a second real account as `Authenticator`. Run one Indigenous-Tongan identity case through both authenticators agreeing, then a case where they disagree, and confirm it escalates rather than auto-resolving. |

**Before proceeding with these four:** I need the exact Google-account email and name of an approved Tongan collaborator to add as a second Admin User (Researcher and/or Authenticator) on the staging system only. I will not invent an account, reuse your account twice, or weaken dual-authenticator enforcement to work around this.

---

## 4. Risks / open items

- **Untested `Session.getActiveUser()` behavior for a second real account** under "Execute as: Me" + "Access: Anyone" — flagged in `TONGAN-STAGING-DEPLOY.md` and central to items 1–2. Item 1 (anonymous) already passed; item 2 (a second real, non-Owner account) still needs your test.
- Items 10–12 require two distinct human testers with two distinct Google accounts; if a second person isn't available, we should discuss an accepted alternative before cutover.
- Three bugs were found and fixed during the 2026-09-01 walkthrough (see Section 3 above): a false CONFLICT badge on applied fields (`240e60a5`), a misleading "Partially approved" label on fully-conflict-blocked submissions (`62b4d23f`), and an unguarded double-rollback UI gap (`e723135a`). All three are fixed, redeployed to staging, and verified live; none affected the live production system.
- **Design note for future real-publish wiring (not a blocker now):** `apiPublishApprovedChanges` currently snapshots the raw list of change events since the last publish, not a deduplicated "current value per scholar/field" view — so a superseded or later-rolled-back value can appear in the JSON alongside its correction. This is harmless today because the snapshot only ever lands in a private Drive folder, but if this logic is ever extended to actually publish to the live GitHub Pages dashboard, it should be changed to publish only the net current value per field.
- The Publish button currently fires immediately with no confirmation step (`bridge.publishApprovedChanges(true)` is called directly on click). Not a problem for a Drive-only staging snapshot; worth adding a confirmation dialog if this becomes a live-publishing action.

---

## 5. Cutover procedure (once you approve — do not run until you say so)

1. Freeze writes on the live Google-auth Admin (it is currently `WRITE_ENABLED=false`, i.e. already read-only for safety).
2. Copy the 12 new tables' final schemas/state from the backup Sheet into the **live** Master Sheet (additive only — no existing tab touched), or point the reviewed staging script at the live spreadsheet ID once you're satisfied.
3. Redeploy the staging `.gs`/`.html` bundle as a **new version** of the live Apps Script project (not a new project), preserving "Execute as: Me" and switching Access back to "Only myself" plus the Admin Users allow-list, matching your existing live deployment's access model — or keep "Anyone" only if you want the anonymous `doPost` public form live too.
4. Flip `WRITE_ENABLED=true` (or the staging equivalent) only after the above.
5. Point the GitHub Admin panel / public dashboard links at the new deployment URL, replacing the legacy visual reference only after your explicit sign-off (per your standing instruction, never before).
6. Keep the pre-cutover backup Sheet (`1XTbiKazab-2WWJmkqjJ6AIWvymBL5-6Jj8EsHXYcXWs`) untouched and dated as the rollback snapshot.

## 6. Rollback procedure

1. Revert the live Apps Script deployment to its previous version (Apps Script keeps prior versions; select and redeploy the last known-good one).
2. If the live Sheet schema was changed, restore affected tabs from the backup Sheet snapshot (copy-paste values, or restore from Sheet version history around the cutover timestamp).
3. Repoint the GitHub Admin panel / dashboard links back to the previous exec URL.
4. Set `WRITE_ENABLED=false` immediately if any write-path issue is suspected, while investigating.

---

**Bottom line:** 12 of 16 matrix items are now PASSED, including every Owner-only authenticated function (review-queue decisions, identity conflict blocking, rollback, doc-sync failure/retry, and publish) — all exercised live against the staging deployment, each independently verified against the backup Sheet, with three real bugs found and fixed along the way. The remaining 4 items (role enforcement across non-Owner roles, and the dual-authenticator identity workflow) genuinely require a second Google account, since they test what happens when two different people are involved — I cannot substitute for a second identity without weakening exactly the safeguard we're testing. Once you give me the email and name of an approved Tongan collaborator to add to the staging Admin Users table, we can finish the remaining tests and then talk cutover. Cutover will not be recommended while any item is Failed, Blocked, or Not Run.
