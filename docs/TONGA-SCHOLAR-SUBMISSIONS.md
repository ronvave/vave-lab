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
The scheduled Tonga snapshot workflow creates missing random tokens in
Scholars / Scholar Share Token and publishes the ID/token lookup, preserving
existing tokens. It never exports submission identities or attachments.
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
