# Tonga scholar sharing and review pipeline

## Authority and country isolation

Master: `1lh6wOFcg2GiFe2YylgxM5cvLOdumdbCrHDLQk87rjRI`.
Scholar IDs: TNG-Sxxxx. Fiji files, IDs, queues and B3 are not modified.
Repository rollback: `backup/tonga-admin-before-submission-overhaul-20260920`
(baseline `216cff1120845f7fca55394761a0c5ed6822670c`). This is a source backup,
not a spreadsheet or Apps Script backup. The owner supplied and retained
Tonga-current-script.txt before replacing the deployed script.

## Submission paths

Panel F Share copies `s-tonga.html?k=<stable token>` and briefly turns green.
273 stable random tokens were initialized in Scholars / Scholar Share Token
on 20 September 2026 and verified by readback. The scheduled refresh exports
only tokens confirmed in Master, preserving existing links. Its service account
is currently read-only: new scholars require owner initialization of a unique
40-character lowercase hexadecimal token in that column. The sync can create
missing tokens only when run with an authorized writer. Missing tokens or a
failed token sync must not block normal dashboard snapshot updates. It never exports submission identities or attachments.
The shared route validates the token before loading and rendering one scholar;
the full dashboard remains hidden. It reuses the Panel F renderer and combined
Master + Admin enrichment + research insights adapter. Never use masterOnly
here: that removes saved photos and summaries.

Update info submits only changed fields plus optional private uploads. Maternal
fields are not prefilled on public forms and are not rendered on the card.
A blank untouched field is not a request to clear a Master value.
CVs, theses and bibliographic files remain private review attachments.
The backend accepts a maximum of six files, 12 MB each, 30 MB combined.
The form accepts JPEG headshots, PDF CV/theses and BibTeX/RIS/ENW exports.

Geography is tied to the original Master publication ID (NOT the adapter's
hashed display key) and verified against Authorship for that Scholar ID.
Tonga locations use national study or Island Division / District / Specific
Island / Village-Town-Site. Divisions: Tongatapu, Ha'apai, Vava'u, 'Eua, Niuas.
Other Pacific countries and other world countries are separate inputs.
Multiple study locations are supported. Existing approved locations remain.

## Admin review

Both queue tabs use the existing authenticated Tonga writeback client.
Scholar review displays server-computed current/proposed values. Approval sends
only checked writable fields and their expected current values. The backend
locks, rechecks for concurrent Master changes, rejects computed fields and
ambiguous multiple-degree rows, validates, writes and logs. Remaining changes
or attachments leave the review Pending. Refresh after a conflict.

JPEG headshots have a preview and explicit approval. Approval uses the existing
400px JPEG conversion and merges only the photo into the freshest encrypted
Tonga enrichment document, retaining saved JSON and other fields. GitHub commit
history records the photo. Reviewer records disposition in review notes.
Institution/department links can be applied through the existing scholar editor.
BibTeX/EndNote and CV attachments are reviewed manually: deduplicate against
Publications, then create correct Authorship links; do not pretend a download
has imported publications. Theses may require Graduate Degrees updates.

“Mark remaining review complete” requires notes; it closes the queue item but
applies no remaining data. Reject likewise makes no new Master changes and
never undoes earlier partial approvals. Geography approval adds deduplicated
Research Geography rows, with provenance and review status. Repeated decisions
are refused; rejection preserves the Master.

Master changes appear after `refresh-tongan-master-file.yml` (every two hours,
at minute 5) or Admin Refresh from Sheet. Photo/insight changes use the existing
GitHub enrichment pipeline. Queue statuses are not evidence of snapshot sync.

## Deployment state and activation

Owner deployed backend version `tonga-submissions-1`; capabilities endpoint
confirmed status ok, country Tonga, publicSubmissionsEnabled false.
Keep `TONGA_PUBLIC_SUBMISSIONS_ENABLED` false until token synchronization,
Admin authenticated queue reads and a controlled submit/review test are ready.
The owner must run `authorizeScholarSubmissionStorage` once to grant Drive
scope for attachments if not already authorized. Upload folder must be private.
`SHARED_SECRET` remains only in Script Properties and the owner's Admin browser.
Do not replace it or ask the owner to paste it into chat.

A successful public capabilities GET does not prove authenticated approvals,
Drive authorization, or a complete submission-to-dashboard round trip.

## Shared page presentation contract

The country shared page must include the full initiative and curator/collaborator
context, purpose of the review link, highlighted Update info instructions, CV
privacy, optional private maternal information, and review-before-publication
policy. Preserve the institutional banner. Render live A1/A2 totals and B2
graduate summary using the same dashboard rendering functions, before the
scholar card. Never hard-code Fiji counts, dates or administrative units.
Publication guidance must explain national and local Tonga study locations,
other Pacific/world countries, semicolon entry, multiple sites, and the value
of geography for local decision making. Keep original Master publication IDs
and the working authenticated review backend. This presentation repair does
not change submission approval, public activation or B3.

## Inline publication geography contract

The shared profile uses Fiji-style per-publication controls: Tonga checkbox
menu (national study, the five island divisions, and specific islands drawn
from Tonga Research Geography), Pacific Island country checkbox menu, and
Other countries semicolon input. Specific islands remain separate from
island divisions in the submitted payload; Ongo Niua maps to backend Niuas.
Only Tonga records with an established division supply island options; do
not infer localities from scholar ancestry. The menu is not an exhaustive
island gazetteer. Existing approved locations stay visible and matching
checkboxes are checked and locked because this backend adds locations.

One identity form below the list submits all changed publications for review,
using canonical Master publication IDs. Batches respect the 100-publication
server limit; failed/unsent entries remain editable, and confirmed entries
are cleared from the pending selection map to prevent accidental resubmission.
Unchecking an unsent choice removes it. Outside click and Escape close menus.
Menus expand within each card; mobile controls stack below the citation.
Original DOI/source links, publication colors, profile enrichment, summaries,
and B3 must be preserved. No Apps Script replacement is required.

## Update-info form presentation contract

Use the Fiji-style centered white 720px modal with teal backdrop, compact
explanation/review notice, two-column fieldsets, blue paternal and dark maternal
borders, full-width relationship/institution fields, and separate Cancel and
Submit for review buttons. Explicit inset/margin centering, zero minimum grid
track widths and border-box controls prevent the global reset and fieldset
min-content sizing from pushing the dialog left or creating horizontal scroll.
At narrow widths the fields stack; the dialog scrolls vertically within the
viewport. Escape and Cancel close the native dialog.

Tonga ancestry fields are Island Division, Specific Island, District and
Village / Town (Kolo), separately for paternal and optional private maternal
information. Never introduce Fiji province or confederacy fields. Preserve
Tonga gender values while showing readable English equivalents. Headshot
belongs in Scholar profile; thesis uploads belong in their degree sections;
CV has its own private optional section; bibliographic upload and notes belong
in Publications to add. Retain upload limits, existing payload keys, only-
changed-fields submission, review requirements and original Master authority.

## Admin queue visibility and attachment previews (2026-09-20)

Both submission tabs display Fiji-style pending-count badges after Admin reaches ready, before either tab is opened. Counts refresh every 30 seconds while visible, on returning to the window, and after queue review reloads. Background count reads do not rebuild review cards or discard notes. Failed reads retain the previous count; zero hides the badge.

Scholar attachments are grouped in a Fiji-style Attachments section with filename, field/size metadata and an automatically loaded secure inline image preview (maximum 280px). The existing authenticated attachment endpoint is used; previews do not publish images. Headshot approval remains explicit and uses the existing Tonga photo service. CV/thesis/bibliography files remain separately reviewed. No Apps Script deployment is required.

Validation: queue tests cover startup before tab click, ready gating, both badges, polling without note loss, failed reads, zero count, and inline authenticated headshot rendering. Existing submission and iTaukei preservation tests pass. No user submission was approved or rejected during these checks.

## Review v2 implementation

The Fiji-style Tonga review layout now supports per-card Check all/Clear all, changed-only emphasized tables, secure inline attachments, signed per-item review journals, combined text/photo review and explicit private-file completion evidence. Geography gains current-versus-proposed locations and confirmed approve-checked/reject-unchecked bulk decisions with partial failures retained. Existing badges, isolation, photos/insights, public forms and B3 are preserved.

Backend activation and unverified live checks are documented in `docs/TONGA-REVIEW-V2-DEPLOY.md`. The source filename remains `tonga-submissions-v1.gs` but its new runtime is `tonga-submissions-2`. The earlier v1 review instructions above describe the historical baseline; the v2 section and deployment guide govern once activated.

## Successful update submission closes automatically

After the server confirms an Update info submission, close the dialog immediately and show a persistent, dismissible success receipt on the profile page, including the submission reference and review-before-publication explanation. Cancel remains only in the unsubmitted form. Failed requests retain the form and entries. Guard against repeated submission while sending or after completion. The existing submission test verifies automatic closure, the receipt, prevention of repeat POSTs, and retained entries on failure. iTaukei photo/insight/mobility preservation checks pass. No backend deployment is required; no real submissions were created for testing.
