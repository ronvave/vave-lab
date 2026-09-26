# Tonga review improvements version 4

Prepared 2026-09-26 against repository commit aa4ec0024040700b3f2ecad112e718897bf7792c.
Scope: Tonga review queues and publication country entry only. Master data and
saved photos/insights are not rewritten by installation.

## Diagnosed causes and changes

- The Owner transport reread the entire queue after each successful review POST.
  A text review required begin, apply, and finish, each followed by a full read.
  The UI then reloaded the queue and capabilities, and refreshed badges.
- Every document change triggered another full Pending queue read for each badge.
  Periodic badge reads built every scholar diff; each field read its own cell.
- Geography bulk approval explicitly rejected unchecked submissions. Scholar
  review journals likewise recorded unchecked fields/files as rejected.
- Country validation only checked string length and punctuation, so cities and
  malformed combinations passed validation.
- All Google authentication exceptions were swallowed and the frontend replaced
  the response with a generic message. The production login cause is not proven.

V4 uses one locked request for a text selection, durable per-item review outcomes,
request-local table reuse on queue reads, one row/formula read per scholar instead
of per-field reads, count-only shared badge requests, on-demand attachment previews,
and updates to the affected card. Success follows server acknowledgement, not
optimistic removal. Failed/uncertain operations keep their selections for retry.
The original Master conflict checks, field allowlist, formula protection, locks,
Google signature checks, role restrictions and Owner recovery remain enforced.

Unchecked fields/files use a new deferred journal state. They remain Pending and
can be selected later. Previously recorded rejected items are not resurrected.
Checked bibliography/CV/thesis files still require evidence of actual review/import;
headshot publication still requires the Owner. Both bulk controls approve only
selected submissions in the displayed view; explicit Reject closes remaining work.

## Country vocabulary and drafts

Source: https://unstats.un.org/unsd/methodology/m49/ retrieved 2026-09-26.
The checked-in list contains 248 UN M49 countries or areas and their numeric and
ISO alpha-3 codes. Including a statistical area makes no sovereignty claim.
`data/tonga-country-list.json` is the source record; `js/tonga-countries.js` and
its identical embedded Apps Script copy provide exact-match validation and
explicit aliases. No fuzzy spelling correction or city-country splitting occurs.
Legacy Nauru resolves to Naoero; other aliases include United States, UK,
Federated States of Micronesia, and Pitcairn Islands.

Country drafts are stored locally, per scholar ID and publication ID, without a
profile token or submitter identity. Invalid entries remain after valid entries
are submitted; the interface reports storage failure honestly. The backend
independently validates both new submissions and queued suggestions at approval.
Invalid historical pending suggestions must be rejected and resubmitted correctly.
The current encrypted geography snapshot was read without modification: all
3,410 country values resolve after recognized aliases. This is a snapshot audit,
not a live private queue audit. No historical data were rewritten.

## Controlled performance measurements

`node tests/tongan-review-performance.cjs` compares the old and new actual
transport functions using the same fixed 40 ms network-delay fixture.
These numbers exclude Apps Script execution and UI rendering; they are NOT
production response times.

| Operation | Old requests | New requests | Old fixture ms | New fixture ms |
| --- | ---: | ---: | ---: | ---: |
| One text-only scholar approval | 6 | 1 | 243 | 40 |
| One rejection | 2 | 1 | 81 | 40 |
| Five text-only scholar approvals | 30 | 5 | 1210 | 202 |

Full-queue post-decision reloads and change-triggered badge reads were also
removed; their extra work is not counted in this conservative comparison.
Record production measurements only with authorized test records or genuine
Owner-directed review, never by deciding real submissions solely for testing.

## Deployment order

1. Back up the current Apps Script project source, deployment version and private
   configuration. Do not export secrets into the repository or public site.
2. Compare the actual deployed source with this repository baseline before
   replacing it. Preserve any newer live changes and existing execution settings.
3. Build the complete source with
   `python3 scripts/build_tonga_submission_bundle.py /path/Tonga_Review_Backend_v4.txt`.
   Install it once, or keep the vendor verifier and backend in separate files once
   each. The generated bundle includes the country vocabulary and token verifier.
4. Preserve the existing private Script Properties, especially SHARED_SECRET,
   WRITE_ENABLED, submission folder, enabled flags and spreadsheet association.
   Verify TONGA_GOOGLE_CLIENT_ID, TONGA_OWNER_EMAIL and TONGA_REVIEWER_EMAILS against
   the approved private roster. Never put the private roster into public code.
5. Run `inspectTongaReviewAccess` in the editor. It reports configuration presence,
   reviewer count, verifier availability and write flag, never secret values.
   Do not run doGet manually as a substitute for a real web request.
6. Deploy > Manage deployments > edit the existing Tonga web app > New version >
   Deploy. Preserve its URL and access/execution settings. Public capabilities
   must report `tonga-submissions-4` before the new scholar approval UI is enabled.
7. Publish the tested frontend changes together and verify the Pages workflow.
   Reload the Owner/reviewer pages after backend deployment to reload capabilities.
8. Sign in as the Owner and an authorized Admin; verify both queues, then verify
   an unlisted account is denied. Test revocation with an agreed test identity.
   No claim of production access repair is valid until these checks pass.

Google guidance: https://developers.google.com/identity/gsi/web/guides/verify-google-id-token
Client origin remains https://ronvave.github.io. No new Cloud project, client
secret, broad editor access, or shared Owner credential is needed.

## Verification and rollback

Regression fixtures cover deferred selections, conflict detection, interrupted
write retry, duplicate clicks, partial batches, geography append deduplication,
malformed country rejection, draft restore and publication scoping, protected
Owner routes, signed/expired/tampered credentials, subject binding, revocation,
and both queue routes. Existing scholar photo/insight/mobility checks remain gates.

Rollback frontend changes with a scoped revert; keep newer data and enrichment.
Keep backend V4 when reverting the UI: V3 does not understand deferred journal
items and must NOT be redeployed after V4 reviews exist without a deliberate
journal reconciliation. Keep the Owner recovery path, and never restore an entire
Master backup over subsequent legitimate approvals as a routine rollback.

## Live verification status

At preparation: public capabilities report V3. Google Apps Script is not signed
in in the available browser. Live configuration, deployed source, queue contents,
actual Google Owner/Admin login, production timings and backend rollout remain
unverified. Local tests are not evidence that these live steps have completed.
