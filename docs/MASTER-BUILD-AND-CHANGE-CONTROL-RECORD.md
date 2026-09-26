# Master Build and Change-Control Record

## 2026-09-24 — Tonga B4 graduate research disciplines

Added Fiji-style Gender/Degree discipline table, using Tonga Master aggregates,
confirmed Scholar-ID unions and Tangata/Fefine mapping. Export now retains
Short Discipline and calculates the aggregate before degree display deduplication.
The live Graduate Degrees sheet lacked this field; added AA4 without disturbing
existing columns (Z contains unheaded evidence notes). No classifications were
invented. The current live roster has 234 completed-degree scholars, 174 with a
completed Master's, and zero classified scholars; B4 explicitly displays that
coverage gap rather than manufactured discipline counts. Thirteen completed-degree
IDs absent from the core roster are excluded from this standalone reconciliation.

Moved the research-location map to visible B5, retaining its existing internal
map IDs and old panel-nav-b4 bookmark. The menu targets the new B4 independently.
Added source aggregation and UI regression tests for gender mapping, duplicate
records, union totals, orphan IDs, missing data, independent filters and hydration.
Tonga preservation tests pass (14 photos, 13 summaries, 86 pathways); iTaukei
preservation tests pass (59 photos, 77 summaries, 151 pathways). Shared Fiji
aggregation and styling remain unchanged. Publishing through the established
Pages and Tonga snapshot workflows; deployment verification follows publication.


## 2026-09-24 — Tonga card Island Division and paternal clan

Card banners, Panel F division counts and division filtering now use the explicit
paternal Island Division, independently of District. Adapter division fields no
longer infer values from District or maternal geography. Village labels use
`Village vlg (Clan)` and tolerate equivalent apostrophe characters in clan
counts/filtering while preserving the supplied clan order. Empty villages retain
the existing placeholder. Refreshed dashboard and Admin asset hashes.

Verified the current encrypted export for TNG-S0002 contains Tongatapu and
Haʻa Lātūhifo. The new card-geography regression exercises that actual record,
blank District, maternal privacy, clan counts and filters, and the placeholder.
Tonga and iTaukei card/mobility preservation tests passed (Tonga: 14 photos,
13 summaries; iTaukei: 56 photos, 76 summaries). JavaScript syntax passed.


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

## 2026-09-22 — Floating dashboard panel navigation

Added a dashboard-only A–G pill bar after the visitor scrolls beyond the first
viewport. A–C expose the agreed short panel names; D–G jump directly to their
single destinations. The bar sits below the measured sticky site header,
highlights the visible panel group, and uses horizontal pill scrolling on
narrow screens. Dropdowns support keyboard focus, Escape and outside clicks.
A3 opens its disclosure before navigation. Jumps account for the fixed bar
and preserve the existing filter hash. Stable existing panel IDs are retained.
The bar is suppressed in shared/profile routes, embedded dashboards and
fullscreen charts. No data model or existing panel handler changed.

Passed DOM navigation checks covering visibility, destination mapping,
dropdown exclusivity/dismissal, keyboard operation, A3, direct links, filter
hash preservation and shared-profile isolation; JavaScript syntax and content
hash checks; and the existing iTaukei card/mobility regressions (56 photos,
76 insights, 151 pathways, 78 universities). Browser screenshot verification
is not claimed. Release is via the validated Pages workflow.

## 2026-09-22 — Attach navigation dropdowns to their pills

Corrected a containing-block mismatch: backdrop-filter on the floating bar
made its fixed dropdown relative to the bar, while the script supplied viewport
coordinates, adding the header offset twice. Dropdowns now use absolute
coordinates relative to the bar and sit four pixels below the selected pill.
Horizontal viewport clamping, scroll/resize repositioning, and all navigation
behaviour remain intact. Added a regression with a 76px header/bar offset and
verified the resulting 4px pill-to-dropdown gap. Updated content hashes.

## 2026-09-22 — Fiji scholar work-country classification

The Panel F work filter now admits only canonical country/territory names and
recognized aliases at its first level. Malformed country fields are resolved
from existing institution/location evidence; employer names remain available
in the country submenu. Both tree construction and row filtering use the same
resolver and institution list. Trailing parentheses/commas are stripped only
when their contents are a recognized country, preserving employer acronyms.

Source scholar records, Admin content, styling and unrelated panel handlers
are unchanged. The script cache hash is refreshed. Executable synthetic
fixtures cover employers in the country column, aliases, Cuba, country-only
selection, institution selection, reset and record immutability. The required
card/mobility regression now also audits all current adapter profiles through
the actual Panel F filter code. GitHub Dashboard integrity and cache-hash checks passed for 992645a1.
The snapshot audit covers 474 profiles and identified all eight distinct
employer labels in the country column, plus five geographic variants. It
preserves 56 saved photos, 76 research summaries and 151 mobility pathways.
The follow-up covers every audited employer (including Tetra Tech's recorded
Indo-Pacific scope), and verified Fiji offices for Pacific Disability Forum
and UNDP. Pacific Blue Foundation has both Fiji and US offices, so its blank
country is left unresolved without guessing a scholar's workplace. No
deployment or browser visual check is claimed.
Local shell and Node tools could not start (runtime ownership missing).

Release evidence (2026-09-23 UTC): user authorized publication. PR #7 merged
as e262d0134b647637f79b24b55a2e64227468c04b. Validated Pages run
https://github.com/ronvave/vave-lab/actions/runs/35847108189 passed its
integrity, iTaukei and Tongan preservation checks and deployed successfully;
GitHub Pages reported success at 10:09:34 UTC. The published script reference
uses content hash ab699240. Full-profile/filter and cache validation also
passed for final implementation 1e53513. Direct live HTTP retrieval and the
browser tool were unavailable in this session, so visual verification is not
claimed. Deployment success is confirmed by GitHub Pages.

## 2026-09-23 — Canonical universities in the Fiji work submenu

The work filter's right-hand menu now includes recognized universities only.
A work-specific registry canonicalizes department/college suffixes, aliases,
and mixed affiliations. USP College of Agriculture and USP group under
University of the South Pacific; UNSW Sydney groups under University of New
South Wales. Lancashire's old name maps to its current name, supported by
https://www.officeforstudents.org.uk/for-providers/registering-with-the-ofs/university-title/decisions/.
Standalone colleges, NGOs, employers and job titles are omitted from the
university submenu. Excelsia is a University College, not a university
(https://www.teqsa.gov.au/about-us/news-and-events/latest-news/teqsa-registers-excelsia-college-university-college).

Country-only filtering continues to include all scholars working there.
Country badges count distinct canonical universities; selecting one uses the
same canonical membership for scholar counts and linked publications. Original
profile fields and styling are untouched. Renamed the pill Countries /
Universities of work and refreshed its script hash.

Audited all current workplace labels via the existing encrypted adapter
snapshot. Added regression cases for subunits, aliases, non-universities,
multiple university affiliations, deduplication, selection of all three USP
variants, reset and record immutability. Synthetic execution and JavaScript
syntax pass. Full snapshot and preservation checks run in the PR and deployment
workflows. Local execution/browser tools remain unavailable; no visual QA is
claimed. Deployment evidence follows after release.

Release evidence: PR #8 merged as 836ee626b3e1d967c3d0432e4ea005ad6348e792.
GitHub Pages run https://github.com/ronvave/vave-lab/actions/runs/35848360039
completed validation and deployment successfully. Final script hash:
fd00b7ee. All 474 adapter profiles passed country/university filtering,
canonical membership, deduplication, reset and immutability checks. Existing
preservation checks passed with 56 photos, 76 summaries and 151 mobility rows.
No browser visual verification is claimed.


## 2026-09-24 — Tonga graduate-discipline mapping and refresh reruns

Mapped 345 Graduate Degrees records in the Tonga Master Sheet to Fiji's eight short-discipline categories. The AA5 array formula uses Field / Discipline and Broad discipline, with twelve explicit degree-ID supplements from recorded qualifications/fields. Four unresolved or ambiguous degree records have review notes and remain blank. Reconciliation gives 231 classified core scholars out of 234 completed-degree scholars.

A refresh rerun checked out its original triggering commit and conflicted with newer encrypted snapshots. Checkout now explicitly uses main so reruns start with the current snapshot. Existing content-change detection and rebase safeguards remain in place.

Pre-publication preservation check passed: node tests/itaukei-card-mobility.test.cjs; 59 saved photos, 77 research summaries, and 151 mobility rows retained. No card implementation changed. Live publication verification follows the refresh; no browser visual verification is claimed.

## Tonga review V4 preparation 2026-09-26

Approved scope: faster review, approve-only bulk selection, canonical country
entry and collaborator access diagnosis. See `TONGA-REVIEW-V4-DEPLOY.md` for exact
changes, measured fixture timings, deployment order and deferred-journal rollback
constraint. No real submissions were approved/rejected during preparation.
Preservation tests pass: Fiji 59 photos, 77 summaries, 151 mobility rows;
Tonga 15 photos, 14 summaries, 86 scholar pathways. These are observed snapshot
counts, not hardcoded UI totals. Shared-profile submission fixtures preserve
photos, summaries and linked publications. Live Apps Script deployment and real
Google login verification were initially pending authenticated access.

Backend release: signed in as the Owner, verified the baseline source and existing
private access settings, and found the missing token verifier. Created a private
Master backup and deployed the complete V4 bundle as Apps Script Version 6 on
2026-09-26 UTC. The safe runtime diagnostic passed with verifier present and three
reviewers configured. Frontend publication and live login verification follow.

Frontend release: PR #21 merged as 767d1d5c61e68a5349f431428d23ee8f377d7a75;
Pages run 36232082658 passed and deployed. Live profile country fields and invalid
input warnings verified, with no submission sent. Backend public capabilities
report V4. Owner Google login remains blocked by missing external-request consent.
A runtime diagnostic identified UrlFetchApp permission failure. Automatic approval
review requires explicit Owner approval for script.external_request before the
Google consent helper can run. Original manifest restored; no permission granted.
Do not report collaborator login repaired until live verification passes.

Authorization follow-up: the Owner explicitly approved external requests and
completed Google consent on 2026-09-26 UTC. The diagnostic fetched two public
Google signing keys successfully. Live Google login now identifies the Owner and
loads both queues (0 scholar / 16 geography Pending). Invalid historical country
values are flagged and cannot be approved. No real submission decisions were made.
The existing Version 6 deployment works after consent; editor-only diagnostics are
saved for maintenance. Individual collaborator sessions and live revocation remain
untested; signed-token role/security fixtures pass.
