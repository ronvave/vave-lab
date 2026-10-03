# Vanuatu dashboard replication

Reference: Tongan dashboard, repository revision `83fbb22234e42032e7981e8fd21d517afcf31987`, inspected unlocked on 3 October 2026 UTC.

## Implemented

The existing Vanuatu route now uses the lab header/banner and copied Tonga visual baseline, warm-sand menu, A1–A3, B1–B5, C1–C3, D–G, scholar cards, publication browsing and filtered BibTeX export. Vanuatu-specific computations live in `js/vanuatu-dashboard-model.js`; no Tonga data URLs or credentials are reused. Existing Admin assets are unchanged.

B4 uses unique Scholar IDs and an explicit eight-category crosswalk. Ambiguous combined broad fields remain unmapped. B3 accepts explicit reviewed pairs or a unique completed Master's/doctorate pair with consistent completion years; multiple candidates are excluded instead of Cartesian pairing. Study geography, scholar affiliations, and research locations remain distinct. The six counted publication types include Reports.

## Release status

The repository has no `data/vanuatu-master-bundle.json.enc`. The manual Vanuatu refresh workflow requires the original source, its exact export approvals, and a Vanuatu-specific encryption secret. No credentials or display flags were changed. The existing encrypted access mechanism is retained. The dashboard shell is visible while locked; a clearly marked fictional preview is available only by explicit selection or `?preview=1`.

The supplied workbook snapshot permits Scholar ID and Scholar Name, plus two degree thesis-description fields, individually. The other broad allowlist labels do not currently release individual columns through the existing exact-field exporter. A proposed field manifest is in `docs/vanuatu-dashboard-proposed-fields.json`. It is documentation, not an approval grant or a live-source mutation. The owner must review these fields before live activation. Never publish the Master workbook itself.

Snapshot baseline: 106 verified display-approved scholars; 5 verified display-approved publications, with 5 eligible authorship links; 119 eligible completed degrees (96 Master's and 23 doctorates, 104 unique scholars); zero Research Geography rows. These row-level baselines do not override field-level export constraints or later source changes.

The Vanuatu submission service URL remains unconfigured. Update info reports that state honestly and gives the curator contact; it does not simulate a successful submission. Shared profiles use public Scholar IDs for navigation and preserve the same encrypted data gate. They display both the scholar card and linked publications.

## Validation

Run:

```
node tests/vanuatu-dashboard-parity.test.cjs
node tests/vanuatu-model.test.cjs
node tests/vanuatu-backend.test.cjs
python3 -m unittest discover -s tests -p vanuatu_export_test.py
python3 scripts/check_vanuatu_assets.py
VANUATU_JSDOM_PATH=/path/to/jsdom node tests/vanuatu-dom.test.cjs
```

Rendered acceptance is a separate step. Compare the live preview with Tonga; check default layout, menus, B2 drilldown, B3 full-screen, B4 toggle, scholar filters, publication cards, and lock behavior. A fictional preview proves layout/interaction only, not live-source readiness.

## Published acceptance

GitHub Pages deployment passed on 3 October 2026. Browser review verified the live page header, overview cards, study-country linked scholar results, B4 degree toggle, province and global research tables, and B3 full-screen chart. Fictional examples were used throughout. Local model, export, backend-mock, asset and simulated-DOM checks passed. Map tables render independently of optional map-library availability.

## Field approval — 3 October 2026

Ron Vave explicitly approved the proposed fields at 10:17 HST. Added and read back 81 exact-field rows in the live Master Public Export Config A20:J100, preserving the four existing explicit approvals and all private-field exclusions. The manifest retains its original filename for link continuity; its status now records approval. Scholar and publication eligibility flags were not changed. A fresh live-source transform passes the exact allowlist checks. This supersedes the earlier field-approval blocker above. Encrypted snapshot activation remains pending the GitHub workflow and Vanuatu-specific secret; no secret was created, retrieved, or copied from another country.

## Separate viewing passwords — 3 October 2026

Ron requested an owner-only viewing password and a different shared collaborator viewing password. `VAVELAB_VANUATU_PASSCODE` encrypts the owner snapshot; optional `VAVELAB_VANUATU_COLLABORATOR_PASSCODE` encrypts a second copy of the same approved dataset. The dashboard accepts either. The keys must differ. Neither viewing password grants an Admin role; Google-authenticated backend authorization still controls editing. The refresh stages and verifies all new ciphertext before publishing both in the same commit. The collaborator key can be added even when the owner generation is unchanged. Existing ciphertext requires its matching key; rotation requires an explicit rekey procedure, not simply overwriting a secret. No plaintext source or password is committed.

Owner secret presence was verified. First refresh run 37152049207 passed tests but source read returned HTTP 403; source service-account Viewer access remains pending owner permission. Collaborator secret entry remains pending.

## Activation prerequisites completed — 3 October 2026, 10:48 HST

Verified both owner and collaborator repository secret names without accessing their values. Ron explicitly approved Viewer access for the existing sync service account; the live Vanuatu Master permission was granted and read back as reader. Run 37152876924 starts the two-password snapshot refresh. Added the Vanuatu refresh workflow to Pages deployment completion triggers, so successful refreshes publish the encrypted data. This supersedes the earlier password/source-access blockers. No Admin role, Master editing permission, or collaborator record-review permission was granted.
