# Tongan Admin Rebuild — Pre-Cutover Report

**Date:** 2026-09-01 (HST)
**Status:** Staging system built and partially tested. **NOT yet approved for cutover** — see "What still needs your testing" below. No live resource has been touched.

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

**Test data left in the backup Sheet:** three submissions now sit in `Public Update Submissions` with `Pending` status — `SUB-20260901-022609-8444` (TNG-S0001, incidental valid submission created while debugging the redirect, harmless), `SUB-20260901-022739-1662` (TNG-S0005), `SUB-20260901-023021-1711` (TNG-S0006, with the quarantined photo). These are on the **backup Sheet only** and are actually useful — you can use them as ready-made fixtures for the review-queue tests below (full/partial/reject/return) instead of creating new ones.

### Tests that cannot be run from here — require your manual testing in a browser

The remaining 12 matrix items all exercise the **26 `apiXxx` server functions** (role checks, review-queue decisions, identity workflow, rollback, publish, etc.). Those are only reachable via `google.script.run` calls made *from inside the rendered admin page in your own authenticated Google session* — there is no plain HTTP endpoint for them (confirmed by reading `doGet`/`doPost`: `doGet` only ever renders the page for an authorized caller, and `doPost` only ever accepts the one public `submitPublicUpdate` action). This isn't a bug to fix, it's how Apps Script's `google.script.run` bridge works by design — and it's also exactly what "identity before any scholar data returns" requires, so I don't want to bypass it. I don't have a Google session to drive a browser through this safely, and browser automation would need your own login/2FA, which I shouldn't be given.

| # | Test | Why it needs you | Suggested steps |
|---|---|---|---|
| 2 | Role enforcement | Needs a real signed-in session per role | Open the staging exec URL signed in as `ronvave@hawaii.edu` (Owner) — confirm full access. Then add a second real Google account to `Admin Users` as `Researcher` (view-only on core fields) and sign in as that account in a different browser/profile — confirm it can view but not edit/approve/rollback/publish. Remove a listed account and confirm it reverts to "Not authorised." |
| 5–8 | Full / partial / reject / return approval | Review-queue decisions run via `google.script.run` | Open the review queue, use the 3 pending test submissions listed above (`SUB-...8444`, `SUB-...1662`, `SUB-...1711`) — approve one field fully, partially approve/reject a multi-field one, reject one outright, and mark one "returned" (needs more info). Confirm `Change Audit Log` and `Scholars` update only for approved fields. |
| 9 | Concurrent-edit conflicts | Needs two simultaneous sessions | Open the same submission in two browser tabs/accounts, submit conflicting decisions, confirm the second write is blocked/flagged rather than silently overwriting. |
| 10–12 | Second-authenticator flow, dual-authenticator identity decision, conflicting-decision escalation | Needs two distinct Authenticator accounts | Add a second real account as `Authenticator`. Run one Indigenous-Tongan identity case through both authenticators agreeing, then a case where they disagree, and confirm it escalates rather than auto-resolving. **Note:** items 10–12 genuinely need two different people/accounts — let me know if you'd like help identifying a second tester, since I can't act as a second identity for this. |
| 13 | Doc-sync failure + retry | Needs a deliberately broken Doc reference | Code review confirms the design is sound: `_syncDocHistory_` never throws (a Doc outage can't block a database write) and marks the row `failed-retry`; `apiRetryDocSync` (Owner-only) re-attempts every `failed-retry` row. To force-test live: temporarily point `HISTORY_DOC_ID` at an inaccessible Doc ID, make one edit, confirm the audit row shows `failed-retry`, restore the correct ID, run "Retry Doc Sync" from the Owner UI, confirm it flips to `synced`. |
| 14 | Owner rollback | Owner-only `apiRollback`-style function | After approving a test-submission field change, use the rollback control on that Audit ID and confirm the scholar field reverts and a new "reversal" audit row is created. |
| 15 | Publish preview + publish | Owner-only, on-demand per your Option-B decision | Trigger "Preview" and confirm it shows exactly what would go out; then "Publish" and confirm the public dashboard/data path updates accordingly, on your explicit action only (never automatic). |

---

## 4. Risks / open items

- **Untested `Session.getActiveUser()` behavior for a second real account** under "Execute as: Me" + "Access: Anyone" — flagged in `TONGAN-STAGING-DEPLOY.md` and central to items 1–2. Item 1 (anonymous) already passed; item 2 (a second real, non-Owner account) still needs your test.
- Items 10–12 require two distinct human testers with two distinct Google accounts; if a second person isn't available, we should discuss an accepted alternative before cutover.
- No code changes were made this segment beyond what's already committed — today's session was testing and diagnosis only, plus updating `Uploaded Submission Files!L1` verification (no schema change was actually needed; I initially suspected a missing `Approved?` column but confirmed it's present at column L).

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

**Bottom line:** the public-facing, unauthenticated half of the system (identity gate for anonymous visitors, public correction submissions, file quarantine, spam/rate-limit protection) is built and verified working end-to-end against the live staging deployment. The authenticated admin half (role enforcement, review/approval, identity workflow, rollback, publish) is built and code-reviewed but not yet exercised live, because it can only be driven from inside your own authenticated browser session — not something I can safely automate. I'd like your sign-off to either walk through those manually together or have you run the steps above, before we talk cutover.
