# Admin V2 — Phase 3 + 4 status

Shipped in commits `866c77e` (build) and `2de44a6` (Phase 5 protocol). Live at [https://ronvave.github.io/vave-lab/admin-master.html](https://ronvave.github.io/vave-lab/admin-master.html) at cache-buster `mf23`.

## Scope guardrails preserved

- V1 dashboard (`itaukei-research-database.html`) and old admin (`admin.html`) untouched.
- No worksheet renames, column renames, column reorders, formula replacements, or added convenience columns.
- No dual-authoritative copies — the Master fieldset in the modal is the only editable copy of each Master field. The read-only mirror that used to live below was removed, not augmented (approval-doc #11).
- Master `Confederacy` display fields remain derived-only (approval-doc #10).
- Positions/Grad Degrees UI never adds rows; only per-existing-row edits (approval-doc #4).
- No IP collection. Actor is a fixed string `Ron Vave (admin)`.
- No secrets in the JS bundle. Shared secret is browser-local only.

## Server (`apps-script/master-writeback.gs`)

Added three read-only GET actions, all secret-gated and MAPPING-scoped:

- `readScholar(scholarId)` — returns the mapped fields for a single row on the `Scholars` tab. Used to refresh the modal after a successful write.
- `readRows(worksheet, scholarId)` — returns all rows for a Scholar ID on a multi-row worksheet (`Positions`, `Graduate Degrees`). Rejected if `worksheet` isn't multi-row in `MAPPING`.
- `readChangeLog(limit)` — returns the last N rows of the Master `Change Log` tab, newest-first, in the fixed A–J column order.

Write path (`action=write`) is unchanged from Phase 2. Optimistic-lock diff and hard-reject semantics unchanged.

## Client (`js/admin-writeback-client.js`)

Extended `window.adminWriteback` with:

- `readScholar(sid)`
- `readRows(worksheet, sid)`
- `readChangeLog(limit)`
- Internal `callGetWithParams()` helper (GET with the shared secret in the URL, still validated against `SHARED_SECRET` server-side).

## Admin (`admin-master.html` + `js/admin-master.js`)

### Editable Master fields (Phase 3)

The Master fields block in the edit modal was fully replaced with editable inputs organised into fieldsets. Every input carries `data-ws` + `data-field` attributes matching the server MAPPING keys.

- **Identity:** Family Name, Given Names, Gender, Alive/Deceased, Career Stage.
- **Paternal geography:** Paternal Province (dropdown), Paternal District, Paternal Island, Paternal Village, Paternal Confederacy (derived, read-only display).
- **Maternal geography:** Maternal Province (dropdown), Maternal District, Maternal Island, Maternal Village, Maternal Confederacy (derived, read-only display).
- **Current position:** Current Title, Current Institution, Current Department, Current Country.
- **Public profile URLs:** ORCID, Google Scholar URL, Scopus/Author ID, ResearchGate URL, LinkedIn URL, University Profile URL.
- **Positions (multi-row, fetched live on modal open):** `Role Status`, `Position`, `Department`, `C_Uni name`, `Country`, `Start Year`, `Finish Year`.
- **Graduate Degrees (multi-row, fetched live on modal open):** `Degree Stage`, `Qualification`, `Department`, `C_Uni name`, `Country`, `Start Year`, `Finish Year`, `Completion Status`, `Duration`, `Thesis Title`.

Every editable input records its opening value in a `data-loaded` attribute; that value is sent as `oldValue` when the diff is written, so the server's optimistic-lock check compares against exactly what the admin saw when it opened the modal.

Province dropdowns are backed by a client-side `PROVINCE_TO_CONFED` map; changing the Province auto-updates the derived Confederacy display but does not write to the sheet (Confederacy is derived by Lookups, not stored).

### Transactional save + preview modal (Phase 4)

`saveEditModal()` is now two-phase:

1. `collectMasterChanges(sid)` diffs `data-loaded` vs current input value for every `me-*` and `me-row-input` in the modal, trimming whitespace to match server-side `normalizeForCompare_`.
2. If any diff exists, the **Preview changes before writing to Master** modal opens with a full row-by-row diff (Worksheet · Row · Field · Old value → New value). The user must click **Confirm and write** to proceed; **Cancel** closes the preview and leaves nothing written.

On confirm:

- The client POSTs `{action: "write", clientTs, secret, changes: [...]}`.
- Server takes a script-level lock, re-reads each cell, applies the field-level allowlist (types/enums/lengths), writes each cell, and appends one Change Log row per change (columns A–J only).
- Results are parsed per-change:
  - `ok` — increments the write count, updates the input's `data-loaded` to the new value so a re-open shows the right baseline.
  - `noop` — value already matched.
  - `conflict` — Action log gets a machine-readable diff line: `CONFLICT <ws>.<field> (row N): loaded="…" current="…" attempted="…"`.
  - `rejected` / other — Action log gets a reject line with the server's `reason`.
- If server-level `status` is `rejected` or `conflict`, nothing else is pushed (no photo/enrichment/insights). The user sees `Write-back rejected — see Action log`.
- On `ok` / `partial`, the modal calls `refreshMasterForScholar(sid)` (reads live values back), then proceeds with the existing photo / enrichment / insights push against GitHub.

### Master change log tab (Phase 4)

New top-level tab **Master change log** shows the last 100 Change Log rows fetched via `readChangeLog(100)`. The columns rendered are exactly the Change Log columns (Row · Version · Date · Actor · Worksheet · Field · Old value · New value · Source). A **Refresh** button re-fetches on demand; the tab auto-loads once the first time it's opened.

### Cache-buster

Bumped `mf22` → `mf23` on all five script tags. Verified live at [https://ronvave.github.io/vave-lab/admin-master.html](https://ronvave.github.io/vave-lab/admin-master.html) after this commit.

## What Ron needs to do to activate Phase 3+4

1. **Re-deploy the Apps Script** so the new read actions become live. Follow the new "Phase 3 update — re-deploying after a server-code change" section at the bottom of `docs/APPS-SCRIPT-DEPLOY.md`. This keeps the existing endpoint URL.
2. **Hard-refresh the admin** (⌘⇧R) so `mf23` assets load.
3. **Run the Phase 5 controlled round-trip test** in `docs/PHASE-5-JOELI-ROUND-TRIP-TEST.md`. That's the sign-off gate for the whole Phase 3+4 build.

## Files changed this cycle

- `apps-script/master-writeback.gs` — +readScholar / +readRows / +readChangeLog handlers.
- `js/admin-writeback-client.js` — +read helpers.
- `js/admin-master.js` — full modal rewrite for editable Master; preview + writeback + refresh flow; change log loader.
- `admin-master.html` — 6 editable Master fieldsets + Positions + Grad Degrees containers + preview modal + change log tab; `mf22`→`mf23`.
- `docs/APPS-SCRIPT-DEPLOY.md` — appended Phase 3 re-deploy note.
- `docs/PHASE-5-JOELI-ROUND-TRIP-TEST.md` — new Ron-driven end-to-end test.

## What is intentionally not built

- **No row-add UI** for Positions or Graduate Degrees. Adding rows still requires editing the sheet directly (documented inline in the fallback text). Approval-doc #4.
- **No structural workbook changes.** No new tabs, columns, formulas, headers, or renames.
- **No auto-run of the Phase 5 test.** The shared secret lives in Ron's browser only; the round-trip test writes and reverts against Joeli's real row, so Ron drives it.
