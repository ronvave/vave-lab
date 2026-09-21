# Tonga review v2: owner deployment and verification

## Scope and backup

Source baseline: `f968602073fd22af13ea67081b03524afefab1f1`.
Remote backup: `backup/tonga-review-parity-20260921` points to that already-published commit. No private files were uploaded to create it.

The patch affects only Tonga's two review queues, their client, photo-service retry marker and refresh hook. It does not change Fiji, public forms, share tokens, B3, credentials, or snapshot data. The script retains the existing queue columns and stores a signed private per-item journal in Structured Submission JSON. Public submissions cannot supply an admin journal. A photo retry marker is hashed before entering the existing enrichment document.

## Existing project to update

Update the **existing Tonga shared-secret submission/writeback Apps Script project** serving this deployment ID:

`AKfycbwm6ZOEFya_NOPmMswjxjpqLsoXaYuoH5tMvc2hP29YakWf7dV9728y0iEHmx3WsKGSow`

It targets the Tongan Master ending `...k87rjRI` and currently reports `tonga-submissions-1`. Do not use the separate Google-identity-only Admin project described in the older deployment guide. Do not create a new endpoint or change execution identity, access, secrets, or other Script Properties.

Replacement source: `apps-script/deployed/tonga-submissions-v1.gs` (filename retained; runtime version becomes `tonga-submissions-2`).

1. Open the existing project in Apps Script. In Deploy → Manage deployments, verify the deployment ID above. The exact editor project ID is not available in this session; identify it by this deployment ID, not by guessing a project title.
2. Save the existing deployed `.gs` source locally and note its deployed version. Make a private copy of the Tongan Master before activating v2. The replacement includes `backupTongaReviewDataV2` as an optional owner-run helper; a normal private Drive copy also works. Do not place backups in a public folder.
3. Replace the existing submission/writeback source with the complete replacement file. Avoid leaving duplicate functions in another `.gs` file. Save. Keep all Script Properties unchanged.
4. Select `backupTongaReviewDataV2` and Run only if using the helper instead of a manual private copy. No setup or schema migration is otherwise required. Existing private attachment authorization is retained.
5. Deploy → Manage deployments → select the verified deployment → pencil → Version: New version → Deploy. Keep the existing web app URL and access settings.
6. Open that web app URL with `?action=submissionCapabilities`. Expect `country: Tonga`, `version: tonga-submissions-2`; public-submission enablement must retain its current setting.
7. In Tonga Admin, refresh the page and open Scholar Update Submissions. Its authenticated capability check enables combined approval and Ban submitter only when v2 responds. Do not paste secrets into chat or source files.
8. Use only an explicitly designated test scholar/submission for the live acceptance trace. Check text conflict handling, photo preservation, private file outcomes, Research Geography and public snapshot results. Do not approve/reject existing real submissions just to test. Do not test a ban on a real person.

## Review behavior

Scholar text and attachments start checked; geography starts unchecked. The confirmation states exactly what will be accepted and what unchecked items will be rejected. A started scholar selection is durable and resumes after failure. A changed Master or ambiguous degree remains pending. Rejection preserves earlier successful operations.

Headshots use the existing authenticated Tonga photo service; retries check the fresh encrypted sidecar. CV/thesis files remain private and require an explicit account of actual review or import. Bibliography files require completed import evidence; ticking or downloading them never imports anything. Pending files keep the submission pending. Ban requires a reason and confirmation and affects Tonga's blocklist only.

Current geography is read by canonical publication key from live Research Geography. Island/division pairs must already be established in Tonga Master geography, matching the source used by the public selection menu; uncertain new pairs require verification there. Approval rechecks Authorship and adds only non-duplicate rows. Bulk decisions approve selected visible Pending items and reject the rest, including the zero-selected case; mixed failures remain retryable.

Master approvals request the existing Tonga refresh workflow. A queued workflow is reported as queued, never as verified public publication. Missing credentials or dispatch errors are reported separately from the approval.

## Verification and limits

Passed: existing Tonga submission, badge, Tonga card/mobility and iTaukei preservation tests; new isolated backend/UI tests for expected-current conflict, interrupted-write retry, durable photo outcomes, unfinished files, live-key geography mapping, island/division validation, zero-selected bulk confirmation, partial failure retention and refresh failure. Syntax and whitespace checks pass.

Live backend read-only probe reports v1 with public submissions enabled. No live approval, rejection, ban, Sheet migration, photo upload or backend deployment was performed. The live Admin remains behind its password gate. Browser policy also blocks the isolated data-URL preview; desktop/mobile visual parity and live submission-to-publication verification are **not claimed**.

## Rollback

Revert only this release's changed source files/commit. Do not reset the whole repository, restore old snapshots, or overwrite Master data. If rolling back Apps Script after v2 was used, first retain a private copy of queues containing signed journals; v1 does not understand those journals. Roll back via Manage deployments to the recorded prior version only after pending reviews are reconciled. Never reverse previously approved Master changes as a side effect of code rollback.

## Release handoff status

The user explicitly approved publication to the public `ronvave/vave-lab` repository and deployment of the Tonga Admin frontend. Frontend deployment proceeds separately from the owner-run Apps Script update above. The live backend was last verified as v1; capability-gated combined scholar approvals and bans require v2. No live submission-to-publication test is claimed.
