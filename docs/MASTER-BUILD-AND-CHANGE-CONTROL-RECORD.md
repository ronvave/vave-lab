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
