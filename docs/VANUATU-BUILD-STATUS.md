# Vanuatu dashboard and Admin build

Recovered and validated on 2026-10-03. This change adds Vanuatu-specific dashboard,
shared-profile, mobility and Admin pages adapted from the Tonga implementation.
Geography uses the six provinces, islands and area councils. Identity eligibility,
degree episodes and publication authorship remain separate, explicitly linked records.

## Passed locally

- 13 Python export tests.
- 16 JavaScript model checks and 12 backend checks with a mocked Google runtime.
- Simulated DOM integration: preview, filters, reset, expansion, lock, scoped
  profiles, Admin tables and read-only preview editing.
- Asset paths, namespaces, province joins and JavaScript syntax checks.

The DOM test uses `VANUATU_JSDOM_PATH` when jsdom is installed outside the repository.
These results do not establish rendered-browser acceptance or live backend operation.

## Deployment status

The code is prepared for review. The authenticated Apps Script Admin service is
not deployed/configured: `js/vanuatu-config.js` has an empty `adminURL`.
The encrypted `data/vanuatu-master-bundle.json.enc` snapshot is not present.
The manual refresh workflow requires the Vanuatu passcode, source access and
approved export fields before activation. No real private export or credentials
are included in this commit.

The dashboard and Admin offer an explicitly labelled fictional preview. Preview
examples are never substituted for real scholars or verified totals.
Publishing these static files alone will not activate real-data access or editing.

## Entry points

- `vanuatu-research-database-master.html`
- `admin-vanuatu-master.html`
- `admin-vanuatu-review.html`
- `s-vanuatu.html`
- `vanuatu-chord-flanked.html`

Complete snapshot/backend configuration, rendered-browser acceptance and live
deployment verification before describing this build as production-complete.
