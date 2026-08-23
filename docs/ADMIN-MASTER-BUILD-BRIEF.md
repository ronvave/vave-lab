# Build brief: admin-master.html + js/admin-master.js

## Goal
Ship a new Admin dashboard for the Master-file iTaukei Scholar dashboard
(`itaukei-research-database-master.html` / V2 Panel F). The old admin
(`admin.html` + `js/admin.js`) is untouched and remains operational.

## Non-negotiable rules
1. Master Google Sheet is authoritative. Never write to it. Never write to
   any `data/itaukei-master-*.json.enc` file.
2. Publication counts + first-authorship come from
   `window.MasterFileAdapter.computePublicationTotals(master, scholarId)`.
   Never re-derive.
3. Primary key is Scholar ID (`ITK-Sxxxx`) everywhere. Never use scholar
   names as keys.
4. GitHub PAT lives in `localStorage['vavelab_gh_token']` only. Never
   committed. Never printed. Copy the reused helper from the old
   `js/admin.js` (`githubUploadFile` at line 1500).
5. Encryption uses `window.dbGate.encryptForUpload(plaintextString)` →
   returns a Uint8Array. Base64 the bytes (helper below) and PUT to
   `data/scholar-enrichment.json.enc` / `data/scholar-insights-master.json.enc`.
   Decrypt with `window.dbGate.fetchJson(url)`.
6. Photos: filename `img/scholars/<ITK-Sxxxx>.jpg`. Resize to 400×400 JPEG
   in-browser (reuse resize helper pattern from old admin).
7. Never touch `admin.html`, `js/admin.js`, or the V1 dashboard.

## Files to CREATE
- `/home/user/workspace/vave-lab/admin-master.html`
- `/home/user/workspace/vave-lab/js/admin-master.js`
- `/home/user/workspace/vave-lab/data/scholar-enrichment.json.enc` (initial encrypted `{"version":1,"scholars":{}}`)
- `/home/user/workspace/vave-lab/data/scholar-insights-master.json.enc` (initial encrypted `{"version":1,"scholars":{}}`)

## Files to MODIFY
- `/home/user/workspace/vave-lab/js/master-file-adapter.js` — after the
  existing `loadFromMaster()` fetches Master JSON, also fetch the two new
  enrichment files (via `window.dbGate.fetchJson`, both optional/empty on
  404) and merge them into `bundle.profiles.scholars[i]` **keyed by
  `scholarId`**. Fields to merge from enrichment:
  `photo`, `institutionUrl`, `departmentUrl`, `sector`,
  `yearOfBirth`, `yearOfDeath`. Fields to merge from insights:
  attach the whole insight record onto a new `bundle.insightsDoc` map
  keyed by Scholar ID (Panel F already reads `state.scholarInsights`).
  Also expose `insightsByScholarId` on the bundle so the dashboard can
  look up by either name (legacy) or Scholar ID (new).
- `/home/user/workspace/vave-lab/js/itaukei-database-master.js` — when
  building `state.scholarInsights`, also index by Scholar ID; when
  rendering a card, if the profile has a `scholarId`, prefer
  `insightsById.get(scholarId)` over the name-keyed lookup. Also treat
  `deceased`/`yearOfBirth`/`yearOfDeath` in the profile row as coming
  from the enrichment merge (already handled by
  `renderCardMemorialBand`).
- `/home/user/workspace/vave-lab/itaukei-research-database-master.html`
  — bump cache-buster mf19 → mf20 (5 occurrences).

## admin-master.html — required sections

Structure (single-page, similar visual language to old admin):

1. **Header banner**: "iTaukei Scholar Master Admin" (V2). Small text:
   "Authoritative source: Master Google Sheet + Master Authorship table.
   Admin edits only supplementary fields." Link to the Master sheet.
2. **Data-source panel** (collapsible):
   - Passcode input (same `dbGate` unlock flow — reuse pattern from old admin).
   - GitHub PAT input (saved to `localStorage['vavelab_gh_token']`,
     shows "saved" state).
   - "Trigger Master-file refresh" button — POSTs
     `POST /repos/ronvave/vave-lab/actions/workflows/refresh-master-file.yml/dispatches`
     with `{ref: 'main'}`. Reuse the workflow-dispatch pattern from old admin.
3. **Scholar list**: single scrollable table with columns:
   - Scholar ID
   - Name
   - Confederacy chip (from Master)
   - Discipline (from Master)
   - Total pubs (canonical) / First-authored — from
     `MasterFileAdapter.computePublicationTotals()`
   - Photo status: ✓ if `enrichment.photo` set AND file HEAD returns 200
     (best-effort — mark ⚠ if not); else "—"
   - Insights: ✓ / — (has `keywords[]` + `summaryHtml`)
   - Institution URL: ✓ / —
   - Row click → opens edit modal.
   - Column headers are sortable. Default sort: Scholar ID.
   - Top-of-list filter chips: "Has photo", "Missing photo",
     "Has insights", "Missing insights", "Authorship gap"
     (`total === 0`).
   - Sticky header. Row count and "showing N of M" in top-right.
4. **Edit modal** (opens on row click):
   - Read-only fields (grey background, `disabled` inputs):
     Scholar ID, name, gender, alive/deceased, paternal/maternal
     province + village, discipline, current institution, country,
     department, title, ORCID, Google Scholar URL, Masters uni +
     country, PhD uni + country. All from Master.
   - Editable fields:
     - Photo: drop-zone or file input. Preview @400×400 JPEG. On save,
       PUTs to `img/scholars/<ITK-Sxxxx>.jpg`.
     - Institution URL (text)
     - Department URL (text)
     - Sector (dropdown; carry old admin's list verbatim — read the
       existing `sector` datalist from old `admin.html`).
     - Year of birth (integer)
     - Year of death (integer; enabled only when Alive/Deceased Master
       field says deceased or is blank).
     - Sub-form: **Insights** (keywords[], summaryHtml, sources[]).
       Paste-in JSON only, validated + previewed before save (same
       shape as `docs/ADMIN-V2-ARCHITECTURE-AUDIT.md § C.3`).
   - Canonical count preview at top of modal:
     "Publications: 75 total / 38 first-authored — from Master
     Authorship table (75 rows linked). Types: 37 J, 26 Ch, 5 B, 5 R,
     1 PhD."
   - Save button → merges the edited fields into a working copy of
     `enrichmentDoc.scholars[SID]`, encrypts the full enrichment doc,
     PUTs `data/scholar-enrichment.json.enc`. Similar path for
     insights doc.
   - Cancel button → dismisses without writing.
   - Includes a diff preview: "Was: photo=<old>, sector=<old>, …
     Now: photo=<new>, sector=<new>, …"
5. **Master Authorship linkage-gap report** (top-level tab or panel):
   - "N scholars have zero Authorship rows; M more have only 1 row"
   - Sortable table: Scholar ID · name · authorship-row count · reason
     · "Open Master sheet" link (deep-link to Authorship tab, add row).
   - CSV export button — writes to a downloadable CSV, no repo commit.
   - This is a report ONLY. The admin never modifies the Authorship
     table.
6. **Footer / status bar**:
   - Last enrichment save timestamp.
   - Last insights save timestamp.
   - `dbGate` unlock status.
   - Console-style log of last 20 admin actions.

## Wire order (do these tasks in this order to keep the build unblocked)

1. Create the two new encrypted seed files as empty
   `{"version":1,"updatedAt":"<now>","scholars":{}}` — encrypted with
   the same passcode Ron uses on the dashboard. Use a small Node script:
   ```
   scripts/seed_admin_master_files.js
   ```
   which:
   - Prompts on stdin for the passcode.
   - Encrypts with the same IVAV/AES-GCM/PBKDF2-SHA256(310k) scheme as
     `js/db-gate.js`.
   - Writes both seed files.
   - Also writes plaintext `.json` copies alongside, matching how the
     Master-file refresh workflow writes both.
   Actually — since we don't have the passcode here, DO NOT run the
   seed script from this shell. Instead: write the seed script + a
   README paragraph explaining how Ron runs it locally the first time
   (`node scripts/seed_admin_master_files.js`). The two files are
   optional on the public dashboard (adapter treats a 404 as empty).
2. Modify the adapter to load the two files (both optional, 404 =
   empty). Merge into profiles by Scholar ID.
3. Modify `js/itaukei-database-master.js` to look up insights by
   Scholar ID first.
4. Write `admin-master.html` (styles + shell + login gate).
5. Write `js/admin-master.js` (scholar list + modal + push helpers +
   gap report + CSV export).
6. Bump cache-buster mf19 → mf20 in the dashboard HTML.
7. Sanity-check by loading `admin-master.html` in a headless test (below).

## Sanity-test requirement (before committing)

Add `scripts/admin-master-sanity.js` — a small Node script that:
- Loads `data/itaukei-master-*.json`
- Loads the (fake in-test) copy of `js/master-file-adapter.js` via a
  bare `require`-like shim OR by evaluating the file with a Vitest-
  compatible harness.
- Asserts:
  - `computePublicationTotals(master, 'ITK-S0315').total === 75`
  - `computePublicationTotals(master, 'ITK-S0315').firstAuthored === 38`
  - `findAuthorshipLinkageGaps(master).length` between 100 and 400
    (sanity bounds).

If you can't get a headless harness to run cleanly in this shell,
skip this step and just verify the count function via a direct Node
smoke-test (`node -e "..."`).

## Deliverable

At the end of the build, the subagent should commit + push with the
message:

> Rebuild Admin dashboard for V2 (admin-master.html) — Scholar-ID keyed
> enrichment + insights + linkage-gap report. Old admin untouched.

And report back:
- Files created / modified (bulleted)
- Canonical count spot-check output (Veitayaki, Ravulo, Nayacakalou)
- Linkage-gap count
- Any issues / TODOs
