# Master Build and Change-Control Record

## 2026-09-21 — Tonga scholar update review notice

Updated the yellow Update info notice in the Tonga scholar portal and the
dashboard's fallback modal with the requested reviewer names, Professor Tēvita
Kaʻili and Associate Professor ‘Inoke Hafoka, and wording allowing friends,
family, students and colleagues to submit updates on a scholar's behalf.
Retained the bold Please read label and refreshed the portal script cache hash.
JavaScript syntax validation and `node tests/itaukei-card-mobility.test.cjs`
passed (55 saved photos, 75 research summaries, 151 mobility rows).
Tonga card/mobility checks also passed (14 photos, 13 saved summaries,
86 scholars and pathways). Publishing through the validated GitHub Pages
workflow; live delivery is checked after deployment.

## 2026-09-21 — Solomon Islands Panel D milestone alignment

Right-anchored every line of the 1992 and 2001 annotations and constrained their
placement to the left of their year markers. The fallback also rejects connector
intersections with these annotation blocks. Both connectors remain attached to
their original year markers.

Verified in headless Chrome at 1440, 900, and 600 pixel viewport widths with local
encrypted snapshot data. Rendered geometry checks passed for right anchoring,
1992 text clearance from the 2001 connector, unchanged markers, unchanged
1972/1984 labels and connectors, and identical remaining chart SVG elements
(including bars and axes). Desktop and narrow screenshots visually inspected.
`node --check js/solomon-database-master.js` and
`node tests/itaukei-card-mobility.test.cjs` passed. No chart data or other panel
logic changed. Updated the dashboard script cache hash.

## 2026-09-22 — Solomon Islands scholar sharing and submission review

Authorized from the revised Solomon Islands implementation prompt. Baseline: 651bd6266b34bee04e11a504f3bced36f9c68c4c. Implemented separate public portal/direct route, stable Master token sync, changed-only profile form, private scholar/geography queues, verified Google Owner/Admin roles, resumable signed review plans, per-file outcomes, Owner photo merge/publish service, and country-checked public activation from Owner settings. Live Solomon headers were read on 2026-09-22 before mapping approval writes. Institution names resolve to canonical IDs; degree writes recheck stable Degree IDs. Geography writes use the actual 13-column Research Geography schema, preserve existing tags and record audit provenance.

Maternal columns removed from the public export allowlist and current public scholar snapshot; no maternal-to-paternal fallback in the transformer. Existing Master maternal values remain untouched. Removed the active email-only form. Country-specific runtime scripts, storage keys, endpoint configuration, schema and refresh route are Solomon-only. Other countries remain valid publication-geography choices.

Verified with isolated Apps Script spreadsheet fixtures and browser DOM tests: submission receipt/idempotency, current-value conflicts, enum and institution mapping, wrong country/token rejection, private maternal retention, exact degree writes, append-only geography deduplication, signed Google roles and expired/wrong-audience rejection, durable partial approvals, attachment outcomes, private journal tamper rejection, badge refresh and notes retention. Existing Solomon Admin schema regressions pass. These checks do not constitute a live Google deployment or a real approval.

Deployment requirement: follow docs/SOLOMON-SUBMISSIONS-ACTIVATION.md; the generated single-file backend is apps-script/deployed/solomon-submissions-v1.gs. Public config remains empty until the existing Solomon deployment is updated and the Owner activates it. No backend deployment, reviewer list or live end-to-end approval is claimed by this repository change.

The cache-bust and dashboard-integrity gates and the required iTaukei preservation regression pass. Pixel-level browser QA was unavailable because the Chromium download timed out; DOM integration tests ran against the real encrypted snapshot. Live owner/backend activation remains outstanding.

Live deployment verification: frontend published in f38039f969093062617e16ec82bbf10aa91bcdcc; GitHub submission tests, integrity, cache checks and Pages passed. Initial token sync safely rejected historical notes in an unnamed trailing Scholars column. Follow-up appends the token header after every occupied column and expands the grid only as needed, preserving the notes.

The corrected live refresh passed. Its service account is read-only, so the authorized connected spreadsheet account initialized 81 stable tokens in the new Scholars BG1:BG82 column on 2026-09-22. Readback verified every token and Scholar ID; occupied unnamed BF cells were preserved. Published map contains only those Master-confirmed tokens. Google Apps Script activation remains the sole owner-side deployment dependency.

## 2026-09-22 — Solomon Islands pre-launch introduction

Matched the shared Solomon Islands profile introduction to the Tonga pre-launch format: review badge, project background, highlighted Update info instruction, document guidance, privacy statement and reviewed-publication explanation. Named Professor Transform Aqorau and Associate Professor Tarcisius Kabutaulaka with the user-supplied profile links. Retained Indigenous Solomon Islands scope and submission-on-behalf guidance. Existing matching CSS supplies the typography and callout styling.

JavaScript syntax, cache hashes, dashboard integrity, Solomon submission/portal regression and required iTaukei card/mobility regression passed. This is an introduction-only change; no backend activation or live approval is claimed. Updated the portal script cache hash.

## 2026-09-22 — New iTaukei graduate discipline panel B4

Inserted a single Gender / Degree table after unchanged B3. Former B4 research
geography is now B5; there were no subsequent B-series panels. Its legacy map,
filter and embed identifiers remain unchanged, preserving existing handlers.
The new panel has the stable `graduate-disciplines` anchor. Other sections and
shared profile layouts are unchanged.

The Master transformer now exports `shortDisciplines` inside the existing
encrypted aggregates snapshot. It uses the actual Graduate Degrees Short
Discipline column, completion statuses beginning Completed, exact Master's /
PhD/Doctorate stages, and distinct Scholar ID sets before degree display
record deduplication. It preserves the existing Part-iTaukei exclusion list.
The existing two-hour refresh generates new categories, totals and matching
caption counts; the UI also rerenders on Master hydration without resetting
its Gender / Degree selection. Reload retrieves the latest published snapshot.

Reconciliation: the current worksheet tables include ITK-S0416 and ITK-S0418
in discipline totals although these IDs are on Part-iTaukei and absent from
Scholars. The sheet displays 370 overall but its genders sum to 368. Preserving
the dashboard's existing exclusions yields 368 overall (194 male, 174 female),
341 completed Master's and 133 completed PhD scholars with Short Discipline.
The eligible population before blank-discipline exclusion is 371 overall and
345 Master's scholars. Source captions' fixed included counts are therefore
not copied as constants. No source spreadsheet cells were changed. Seeded only
the new aggregate property from the live source; other aggregate fields remain
unchanged. No individual-level data is added to the summary payload.

Passed Python distinct-count fixtures, DOM checks for both views, dynamic
captions, retained selection, empty/error states and B1–B5 order; JavaScript
syntax; and existing iTaukei card/mobility and filter regression tests (56
photos, 76 research summaries, 151 pathways, 78 universities). Browser screenshot
validation could not run because the Chromium download returned an invalid
archive; no live visual verification is claimed. Deployment workflow evidence
is recorded after publication.

Release evidence: implementation commit ba55d0e5092841cfe9353d38db44f47df4416a7b.
Pages deployment 35769660706 completed successfully. Live HTTP checks confirm
new B4, renamed B5, and the content-hashed JS (3f64e45b) and CSS (50c7f719).
Automatic cache-bust commit 30747b6 corrected the initial asset version strings;
local hash verification passes against that published HTML. Master refresh
35769660772 succeeded and produced a99f082ac491a763bd7a8370259fae3e0ec5a476;
its decrypted aggregate independently confirms 368 total / 341 Master's /
133 PhD and denominators 371 / 345. The refresh-triggered Pages run follows
the existing deployment queue. Browser screenshots remain unverified.


## 2026-09-22 — B4 readability refinements

Added a short instruction beneath Graduate research disciplines explaining the
default Gender view and Degree toggle. The interpretation caption now shares
B5's db-panel__hint typography (0.9rem), retaining its italics. Applied subtle
transparent alternating white/teal row fills, with the olive Total column
preserved and lightly differentiated. Both toggle views use the same styles.
No data calculations or other panels changed. Refreshed the CSS content hash;
DOM toggle and existing card/mobility regression checks passed.
