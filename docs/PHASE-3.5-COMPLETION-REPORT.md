# Admin V2 — Phase 3.5 completion report

**Date:** 2026-08-23
**Author:** Ron Vave (admin)
**Scope:** Public profile refresh pipeline + alternating section borders + duplicate YoB / YoD removal.
**Prompt file:** `uploaded_attachments/…/Perplexity_Admin_V2_Public_Profile_Refresh_and_Section_Borders_Prompt.docx`

---

## 1. Root cause of the "Joeli looks unchanged after Save & push" bug

The full save-to-public pipeline for Admin V2 has three separate transport layers, and until Phase 3.5 they were not all wired to refresh together.

| Layer | Writes to | Refresh mechanism | Latency until public dashboard sees the change |
| ---- | ---- | ---- | ---- |
| **Master Google Sheet** | `Scholars`, `Positions`, `Graduate Degrees` worksheets on Google Sheets ID `1nJvMWLS8jnCOKtRoqdDpEW3s3j9TSAclXBO1txVFxdg` | Apps Script `master-writeback.gs` `doPost` inside a document lock; committed synchronously. | **Up to ~2 hours.** The public dashboard fetches `data/itaukei-master-scholars.json.enc` from GitHub Pages, not the Sheet. The `.enc` file is regenerated only by the `refresh-master-file.yml` workflow, which runs on a `cron: '0 */2 * * *'` schedule. Before Phase 3.5, Save & push did not dispatch this workflow. |
| **Enrichment overlay** | `data/scholar-enrichment.json.enc` on the `main` branch of `ronvave/vave-lab`. | Direct commit via GitHub Contents API in `performNonMasterPush`. | ~10–60 seconds (GitHub Pages cache TTL). |
| **Insights** | `data/scholar-insights-master.json.enc` on the `main` branch. | Same as enrichment. | ~10–60 seconds. |
| **Photo binary** | `img/scholars/{SID}.jpg` on the `main` branch. | Same as enrichment. | ~10–60 seconds. |

Ron's Save on ITK-S0315 (Joeli Veitayaki) wrote:

- Salutation `Dr`, Current Title `Strategic Advisor`, Current Institution `Blue Prosperity Fiji`, Institution Country `Fiji`, Paternal geography (Malawai / Gau / Lomaiviti), ORCID, Google Scholar URL, graduate degrees — **all Master fields** → Sheet updated instantly, `.enc` still stale from the last 2-hour cron run.
- Photo `img/scholars/ITK-S0315.jpg` — enrichment/GitHub → visible in ~1 minute.

The public dashboard then composed `stale Master row × fresh enrichment overlay` and rendered a card that showed `JV` initials (photo path came through in enrichment but the profile-lookup path in Panel F is keyed off the composed name, which used the stale Master row's `Given Names / Family Name`), Unclassified village, no salutation, no institution, no insights. **Photo, pub counts, and insights are technically fresh** (they come from enrichment / master-authorship joined at load time) but everything Master-owned was invisible until the next cron run.

This is the whole reason 5 minutes and a hard reload didn't help: nothing was going to help until 2 AM/4 AM/…/UTC when the cron next ran.

The prompt explicitly asked for the auto-trigger, and that is what Phase 3.5 wires up.

---

## 2. Files changed

| Path | Change |
| ---- | ---- |
| `js/admin-master.js` | Added `MASTER_PANELF_FIELDS` map + `isPanelFField_()`; `dispatchRefresh()` now returns a boolean and accepts `{silent:true}` for the auto-trigger; `executeSaveAfterPreview` tracks whether any Panel-F-visible Master field was written and stashes `state.savedPanelFFields`; `performNonMasterPush` reads that flag after finishing its enrichment/insights/photo writes and, if true, calls `dispatchRefresh({silent:true})`; final `toast` messages now describe the actual state ("Public dashboard refresh queued (2–5 min)" or "Public dashboard refresh NOT queued — use the manual Refresh button") rather than the old misleading "GitHub Pages will refresh in 1–2 minutes" line; the write path no longer touches `yearOfBirth`, `yearOfDeath`, or `deceased`; a defensive guard in the modal populate step handles the removed `#pf-birth` / `#pf-death` inputs gracefully; a new inspection button wires the Data-source-tab migration report. |
| `admin-master.html` | Removed the duplicate `#pf-birth` and `#pf-death` inputs from the Admin-owned fields fieldset; added a "Legacy Year of Birth / Year of Death migration inspection" card on the Data source tab with an `#inspect-yob-yod` button and `#inspect-yob-yod-out` output pane; added CSS for `.section-border-black` and `.section-border-blue` with 2px solid borders in `#111111` and `#0b4a86`, extra top margin (26px) and legend colour match; applied the classes to the 10 relevant fieldsets in the exact Ron pattern. Cache-buster mf27→mf28 on all five script tags. |
| `itaukei-research-database-master.html` | Cache-buster mf27→mf28 on all four script tags. |
| `docs/PHASE-3.5-YOB-YOD-MIGRATION.md` | Migration report describing the duplicate removal, the preservation policy for legacy sidecar values, and the client-side inspection tool. |
| `docs/PHASE-3.5-COMPLETION-REPORT.md` | This file. |

**Files intentionally NOT changed in Phase 3.5:**

- `apps-script/master-writeback.gs` — no wire-protocol or logic change. No Apps Script redeploy is required for Phase 3.5.
- `data/scholar-enrichment.json.enc` — legacy `yearOfBirth` / `yearOfDeath` / `deceased` fields inside individual scholar records are preserved verbatim. Nothing has been silently overwritten, deleted, or migrated.
- `.github/workflows/refresh-master-file.yml` — unchanged; the same workflow is now dispatched programmatically from the client.
- `js/itaukei-database.js`, `admin.html`, V1 files — untouched, as per standing rule.
- `js/master-file-adapter.js` — unchanged; its existing "Master first, enrichment overlay" composition is now sufficient because the Master `.enc` is refreshed within minutes of every relevant edit.

---

## 3. Does Save & push auto-trigger the refresh workflow?

**Yes**, but only when at least one Master-backed field that Panel F actually renders was written in that save. The set is defined by the `MASTER_PANELF_FIELDS` map in `js/admin-master.js`:

- `Scholars`: `Title / Salutation`, `Family Name`, `Given Names`, `Alive / Deceased`, `Year of Birth`, `Year of Death`, `Province Paternal`, `District Paternal`, `Village Paternal`, `Island Paternal`, `Province Maternal`, `District Maternal`, `Village Maternal`, `Island Maternal`, `Current Title / Role`, `Current Institution`, `Current Department / Unit`, `Institution Country`, `Primary Discipline / Field`, `ORCID / Researcher ID`, `Google Scholar URL`, `Current Profile URL`, `Gender`.
- `Positions.*` and `Graduate Degrees.*` — any row change.

If none of those fields changed (for example a Sector-only edit, or a photo-only edit), the workflow is **not** dispatched, because nothing on the composed public profile would change even after the next cron; the enrichment overlay is fresh already.

If they did change, `dispatchRefresh({silent:true})` fires immediately after the successful enrichment/photo/insights writes. The toast reflects reality: either "Public dashboard refresh queued (2–5 min)" on a 204 response or "Public dashboard refresh NOT queued — use the manual Refresh button on the Data source tab" if the PAT is missing or the API rejected the call.

The manual "Trigger refresh" button on the Data source tab is unchanged and still available as a fallback.

**Local-view overlay.** After a successful Master write, `state.scholarById[sid][field] = finalValue` is applied in memory so that the admin's own next dashboard reload sees the change immediately, without waiting for the workflow to finish. This is purely a local convenience; the public dashboard still gets its updates from the regenerated `.enc` snapshot.

---

## 4. How the public dashboard composes a Panel F card

Read path when a visitor opens `itaukei-research-database-master.html?src=master`:

1. `js/db-gate.js` unlocks with a viewer-side passcode and rewrites every `data/*.json` request through `ENC_FILES` to the on-disk `data/*.json.enc` counterpart.
2. `MasterFileAdapter.load()` (`js/master-file-adapter.js`) fetches, in parallel:
    - `data/itaukei-master-scholars.json` → `.enc` (**refreshed by `refresh-master-file.yml`**)
    - `data/itaukei-master-publications.json` → `.enc` (workflow)
    - `data/itaukei-master-authorship.json` → `.enc` (workflow)
    - `data/itaukei-master-positions.json` → `.enc` (workflow)
    - `data/itaukei-master-graddegrees.json` → `.enc` (workflow)
    - `data/itaukei-master-lookups.json` → `.enc` (workflow)
    - `data/scholar-enrichment.json` → `.enc` (**direct client push in Save & push**)
    - `data/scholar-insights-master.json` → `.enc` (**direct client push**)
    - `data/scholar-profiles.json` → `.enc` (legacy, kept for the salutation sidecar fallback)
    - `data/body-composition-master.json` → `.enc`
    - `data/last-sync.json` → `.enc`
3. `buildProfiles` composes each scholar as `Master row + adminExtras`. Master supplies `salutation` (via `Title / Salutation`), `givenNames`, `familyName`, `village` / `district` / `province` / `island` paternal + maternal, `title` (Current Title / Role), `institution`, `institutionCountry`, `orcid`, `googleScholarUrl`, `isDeceased`, `yearOfBirth`, `yearOfDeath`. Admin extras supply `photo`, `institutionUrl`, `departmentUrl`, `sector`, plus a fallback for salutation.
4. `js/itaukei-database-master.js` builds `state.scholarProfilesByName` from these composed profiles keyed by `"Last, First"` and consumed by Panel F card rendering.

Because both layers are now refreshed within ~2–5 minutes of every save, the composed profile is fresh end-to-end without a manual button.

---

## 5. Panel F "Kubuna Confederacy / Dr. Joeli Veitayaki" reference card

Ron shared the intended public Panel F card in the current turn (screenshot from the old V1 dashboard). The card shows the header band with the confederacy name, Fiji flag, iTaukei flag, ORCID icon, Google Scholar icon; the photo; `Dr. Joeli Veitayaki`; `Malawai vlg, Gau Is · Lomaiviti Province`; `Blue Prosperity Fiji`; `Strategic Advisor`; `Last update: 18 Jul 2026`; the AI-generated insights expander; keyword pills; the plain-English summary paragraph; and the totals `73 Publications`, `37 First-authored`, with per-type pills.

For ITK-S0315 the Master `Scholars` row now contains (as of the Phase 3.4 → 3.5 saves):

- `Title / Salutation`: `Dr`
- `Given Names`: `Joeli`
- `Family Name`: `Veitayaki`
- `Alive / Deceased`: `Alive`
- Paternal geography: Malawai / Gau / Lomaiviti Province
- `Current Title / Role`: `Strategic Advisor`
- `Current Institution`: `Blue Prosperity Fiji`
- `Institution Country`: `Fiji`
- `ORCID / Researcher ID`, `Google Scholar URL`, `Current Profile URL`: set

Enrichment record `scholars["ITK-S0315"]` contains `photo: "img/scholars/ITK-S0315.jpg"` and `sector`.

Current Master authorship pipeline totals for ITK-S0315 are 75 / 38, which are the authoritative Phase 3.3 counts; the reference card is an earlier snapshot at 73 / 37 (two conference-typed items filtered out on the public view per the July 2026 rule) — the counts are computed by `MasterFileAdapter.computePublicationTotals`, unchanged by Phase 3.5.

**Verification protocol for Ron once mf28 is live on GitHub Pages:**

1. Open `https://ronvave.github.io/vave-lab/admin-master.html?v=mf28`. Force-reload with Ctrl+Shift+R.
2. Confirm the version tag in the footer is mf28.
3. Confirm the Admin-owned fields fieldset **no longer** shows Year of birth / Year of death.
4. Open Joeli's card (ITK-S0315) and confirm the 10 alternating black/blue borders in the exact prompted order.
5. Save & push a trivial no-op Master change (or reconfirm one field) and watch the toast: it should read "Saved ITK-S0315. Public dashboard refresh queued (2–5 min)."
6. Watch GitHub → Actions → `refresh-master-file.yml` fire within a few seconds.
7. Wait for the workflow to complete (typically 2–5 min). Open `https://ronvave.github.io/vave-lab/itaukei-research-database-master.html?src=master&v=mf28`, force reload, open Panel F on Joeli, and confirm the card renders `Dr. Joeli Veitayaki`, photo, `Malawai, Gau / Lomaiviti Province`, `Strategic Advisor` at `Blue Prosperity Fiji`, ORCID + Google Scholar icons, pub counts.

---

## 6. Duplicate YoB / YoD outcome

See `docs/PHASE-3.5-YOB-YOD-MIGRATION.md` for the full report.

Summary:

- Duplicate inputs `#pf-birth` and `#pf-death` **removed** from the modal.
- Write path in `performNonMasterPush` no longer touches `yearOfBirth`, `yearOfDeath`, or `deceased`.
- Existing sidecar values in `data/scholar-enrichment.json.enc` are **preserved verbatim** — nothing was silently overwritten, discarded, or migrated.
- New "Legacy Year of Birth / Year of Death migration inspection" card on the Data source tab produces a read-only report of which scholars still carry sidecar values and whether the Master column is blank / disagreeing / agreeing.
- Ron can migrate a value by editing the Master `Year of Birth` / `Year of Death` inputs in the Identity fieldset and saving through the normal Phase 3.4 pipeline. Alive → Deceased still routes through the ALWAYS_CONFIRM path unchanged.

---

## 7. Section-border CSS

The alternating pattern is defined at the top of `<style>` in `admin-master.html`:

```
.fieldset.section-border-black,
.fieldset.section-border-blue { margin-top: 26px; padding: 16px 18px 18px; }
.fieldset.section-border-black { border: 2px solid #111111; }
.fieldset.section-border-blue  { border: 2px solid #0b4a86; }
.fieldset.section-border-black > legend { color: #111111; }
.fieldset.section-border-blue  > legend { color: #0b4a86; }
```

Applied in this exact order (Photo stays on the neutral 1px `--border` colour):

1. `Master fields — Identity` → **black**
2. `Master fields — Paternal geography` → **blue**
3. `Master fields — Maternal geography` → **black**
4. `Master fields — Current position` → **blue**
5. `Master fields — Public profile URLs` → **black**
6. `Master fields — Provenance & notes` → **blue**
7. `Positions` → **black**
8. `Graduate Degrees` → **blue**
9. `Admin-owned fields` → **black**
10. `Research insights` → **blue**

`#0b4a86` was picked as an accessible dark navy that contrasts against the parchment card background, per Ron's "not a very pale cyan" note. The two-column `.form-grid` layout inside each fieldset is untouched.

---

## 8. master-writeback.gs and Apps Script redeploy

**Unchanged.** No Apps Script redeploy is needed for Phase 3.5. The wire protocol from Phase 3.4 (`dryRun`, per-change `overrideAuthorized`, `expectedCurrent`, per-result `status` / `currentValue` / `loadedValue` / `intendedValue` / `willWrite` / `reason`; overall `status` / `dryRun` / `counts`) is used as-is, and the ALWAYS_CONFIRM map, two-phase re-read-before-write, and change-log Phase-3.4 folding all continue to work.

---

## 9. Cache-buster

**mf27 → mf28** on all five script tags in `admin-master.html` (`db-gate`, `master-file-adapter`, `admin-insights-migration`, `admin-writeback-client`, `admin-master`) and all four script tags in `itaukei-research-database-master.html` (`demo-gate`, `master-file-adapter`, `itaukei-database-master`, `master-file-panel-overrides`).

## 10. Phase 5 not started

Per standing rule: **not started.** Phase 5 remains gated on Ron's explicit approval after he verifies mf28 end-to-end on the public dashboard.
