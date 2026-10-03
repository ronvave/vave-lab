# Vanuatu dashboard and owner Admin

Corrected on 2026-10-03 to use the full Tongan HTML, styles, panel renderer,
chart embeds and owner Admin editor. The earlier compact collaborator interface
has been replaced. Tonga and iTaukei assets remain unchanged.

The dashboard preserves panels A1–A3, B1–B5, C1–C3 and D–G, scholar cards,
linked filters, publication lists and expanded charts. Geography uses Torba,
Sanma, Penama, Malampa, Shefa and Tafea, with independently recorded islands
and area councils. No island affiliation or identity is inferred from a name.
The Admin preserves the reference layout, scholar table, filters, degree and
position editors, photo/summary tools, review queues and change log.

## Validation

13 Python export tests, 16 model checks, 12 mocked backend checks, simulated
DOM integration, JavaScript syntax, local assets and six province joins passed.
The DOM tests cover full reference-panel parity, search/reset, scoped scholar
profiles, the owner-editor layout, independent province/island/council inputs,
report counts, country isolation and read-only preview. Existing Tonga and
iTaukei card/mobility checks also passed. These do not establish live backend
operation. Rendered live-page verification is performed after publication.

## Data and owner connection

The static pages provide clearly labelled **fictional layout previews**.
`data/vanuatu-master-bundle.json.enc` is not yet present and `adminURL` in
`js/vanuatu-config.js` remains empty. No real Vanuatu totals are claimed.
Public submissions and direct browser GitHub uploads are disabled.

To activate the owner service, deploy `apps-script/vanuatu-admin-app.html` and
`apps-script/vanuatu-master-writeback.gs` together in Apps Script, enable the
advanced Sheets service, require Google sign-in, and configure an explicit
`VANUATU_ROLES` email-to-owner/reviewer mapping in Script Properties. Empty
Google identity and unlisted accounts are denied on every call. Set
`VANUATU_WRITE_ENABLED=true` only after the owner validates source headers,
Lookups and authenticated writes. Configure the private approved-enrichment
Drive file through `VANUATU_ENRICHMENT_FILE_ID` and put only the deployment URL
in `adminURL`. The source is the established Vanuatu Master spreadsheet.

Master updates use canonical entity IDs, optimistic conflicts, explicit
confirmation and a Change Log. Supplementary summaries are stored as plain
text; approved field-by-field export controls still apply. Public snapshots
require a separate refresh/publication after owner changes.

Run the manual `refresh-vanuatu-master-file.yml` in dry-run mode first after
configuring the Vanuatu passcode secret, source access and exact Public Export
Config approvals. Do not reuse another country's password or credentials.
Publish the approved encrypted bundle only after that validation succeeds.

Rebuild the native Admin after source edits with
`python3 scripts/build_vanuatu_assets.py`.

## Pages

- `vanuatu-research-database-master.html` — full scholar dashboard
- `admin-vanuatu-master.html` — full owner Admin layout
- `s-vanuatu.html?scholar=VAN-S…` — a scoped scholar profile
- `vanuatu-chord-flanked.html` — explicit reviewed study pathways
- `vanuatu-body-composition.html` — publication/gender chart

This corrects the interface and static publication. Real-data activation and
live authenticated editing remain separate, unconfigured deployment steps.
