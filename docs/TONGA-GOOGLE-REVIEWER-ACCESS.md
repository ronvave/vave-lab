# Tonga Google reviewer access

Prepared 2026-09-21. Frontend and backend code must both be deployed before access works.

## Private configuration

Preserve all existing Apps Script properties. Add:

- `TONGA_GOOGLE_CLIENT_ID`: the Google Web application's public client ID.
- `TONGA_OWNER_EMAIL`: the Owner's exact Google-hosted email address.
- `TONGA_REVIEWER_EMAILS`: comma-separated exact Google-hosted reviewer email addresses.

Keep the roster in private Script Properties. Never commit it to this repository.
The Owner always takes precedence over the reviewer list. No web route can edit
these settings. Reviewers must not be Apps Script editors, GitHub maintainers,
or holders of the existing shared secret or owner credentials.

The application checks the roster on every request and binds the first successful
login for each authorized email to Google's immutable `sub`. Removing an email
revokes subsequent access even with a still-valid ID token. If an account is
replaced, the Owner must explicitly clear its corresponding private
`TONGA_GOOGLE_SUB_...` property before enrolling its replacement.

## Installation

1. Keep a backup of the currently deployed Apps Script source.
2. Replace its source with the supplied combined replacement file, which includes
   `apps-script/deployed/tonga-submissions-v1.gs` and the vendored verifier.
   Alternatively use those two source files as separate `.gs` files, once each.
3. Save, then Deploy > Manage deployments > edit the existing Tonga web app >
   New version > Deploy. Preserve its existing execution and access settings,
   deployment URL, and all Script Properties.
4. Open `admin-tongan-review.html` on the published site and sign in as Owner.
   The page must display Owner and load both queues. Test an authorized reviewer
   and an unlisted account before sending collaborators the link.
5. To roll back, edit the same deployment and select the previous version.
   Existing owner-secret routes remain available during migration.

No client secret, new Sheet-sharing permissions, or GCP project reassignment
is needed. The OAuth client needs JavaScript origin `https://ronvave.github.io`.
Gmail reviewers require External audience. Keep the intended accounts in the
OAuth test-user list while using Testing mode.

## Permission boundary

- Owner: all existing backend actions and existing full Owner panel.
- Admin: queue reads, linked attachment reads, selected scholar text approvals,
  documented attachment reviews, rejection, and publication geography decisions.
- Owner only: arbitrary Master writes/reads, change-log queries, bans, publishing
  photos, and access configuration.

Google role authorization is enforced in Apps Script, independently of browser
controls. Credentials are verified using RS256 against Google's HTTPS JWKS;
issuer, exact audience, expiry, issue time, verified email, hosted identity, and
immutable subject binding are enforced. Tokens stay in browser memory, travel
in POST bodies, and are never accepted in GET URLs. Google callback nonce is
bound to the page instance. No cookie-based application session is created.

## Deliberate workflow limits

Reviewer text and geography decisions save directly to the Master. Public
snapshots update through the existing scheduled refresh; this screen does not
receive or ask for a GitHub token. Photo attachments stay Pending for the Owner
panel to publish. Successful text is saved and journaled independently, so the
Owner can resume the same submission safely. Bibliography import remains manual
with evidence, matching the existing review workflow.

## Validation and change-control record

Local tests cover real RSA signed credentials, tampered/expired/wrong audience
and issuer tokens, algorithm restrictions, subject binding, unlisted accounts,
roster revocation, both queue routes, blocked owner-route calls, immutable web
access configuration, per-person audit labels, and Owner-secret recovery.
Browser fixtures cover nonce matching, role display, POST-only credentials,
no local/session storage, and the explicit photo restriction.
Existing Tonga submission/review/badge tests and both country card/mobility
preservation tests pass: Fiji 55 photos, 75 summaries, 151 mobility scholars;
Tonga 14 photos, 13 summaries, 86 mobility scholars in this checkout.
Real Google login and production approvals require the Owner's backend deployment
and have not been represented as tested by the local fixtures.

## Dependency provenance

`apps-script/vendor/tonga-jwt.gs` wraps the unmodified `jsrsasign-all-min.js`
from npm package jsrsasign 11.1.5 (the upstream bundle reports 11.1.4).
Package tarball SHA-1: `7bd0b3ae320ba6738169bde0691a18f8ce1af29a`.
License is retained next to it. Only its JWS verification and public key parsing
are used; no runtime source download or eval is used.

Google guidance: https://developers.google.com/identity/gsi/web/guides/verify-google-id-token
