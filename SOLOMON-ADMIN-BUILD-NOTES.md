# Solomon Islands Scholar Database — Admin Panel Build Notes

Sister clone of the Tongan Master-file Admin (V2), itself a clone of the original iTaukei admin, built inside the existing `ronvave/vave-lab` repo. **Only new, Solomon-prefixed files were added.** No existing Fiji/iTaukei file (`admin-master.html`, `js/admin-master.js`, `js/db-gate.js`) or Tongan file (`admin-tongan-master.html`, `js/admin-tongan-master.js`, `js/tongan-db-gate.js`, `apps-script/tongan-master-writeback.gs`) was edited, renamed, or deleted — verified via `git status` / `git diff --stat` immediately before commit.

Source of truth for every field/panel mapping decision below: the live **Solomon Islands Scholars Master File** (spreadsheet ID `1um6pHKriEhbtvmkm7e8E1j0_Zt9A-oYpY88fuPoAmFY`), read directly during this build via the `gws` CLI to confirm exact worksheet names, header rows, and the real column headers (36 worksheets; the Province-Ward Lookup worksheet already has the full 9-province + Honiara-City / 182-ward controlled list populated; every data worksheet — Scholars, Publications, Graduate Degrees, etc. — currently has zero data rows).

## Files added

| File | Role | Cloned from |
|---|---|---|
| `admin-solomon-islands-master.html` | Admin panel UI, tabbed layout, retitled "Solomon Islands Scholar Database Admin (V2)" | `admin-tongan-master.html` |
| `js/admin-solomon-master.js` | Full admin CRUD logic: tabs, filters, edit modal, GitHub push, migration UI, cache-bust, change log; geography editor rebuilt for the 3-tier + independent-island + customary model (§2) | `js/admin-tongan-master.js` |
| `js/solomon-db-gate.js` | PBKDF2+AES-GCM passcode gate, brand-new passcode/verifier hash, Solomon-specific `ENC_FILES` map | `js/tongan-db-gate.js` |
| `js/solomon-admin-insights-migration.js` | V1→V2 Scholar-ID-keyed insights migration, Solomon-specific file paths (not yet needed — there is no V1 file to migrate from — cloned for structural parity and future-proofing) | `js/tongan-admin-insights-migration.js` |
| `js/solomon-admin-writeback-client.js` | Thin GET/POST client for the future Solomon Islands Apps Script `/exec` endpoint, Solomon-namespaced localStorage keys (`solomonlab_writeback_endpoint` / `solomonlab_writeback_secret`) | `js/tongan-admin-writeback-client.js` |
| `js/solomon-database-adapter.js` | Master-file → dashboard-shape adapter, shared between the dashboard and admin panel | `js/tongan-database-adapter.js` |

## 1. Passcodes (placeholders — rotate before real data goes live)

There are two independent passcodes, exactly mirroring the Tongan/iTaukei two-gate design:

1. **Admin-login passcode** (gates who can open the admin UI at all). `PASSWORD_HASH` in `js/admin-solomon-master.js` currently holds `SHA-256("HoniaraAdmin7!")` — a brand-new placeholder value, distinct from the Tongan and iTaukei admin passcodes. **Ron should change this to his own chosen passcode before real data entry begins** (re-derive with any SHA-256 tool and update the constant).
2. **Data-decryption passcode** (`Waelava7!`, env var `VAVELAB_SOLOMON_PASSCODE`) — unlocks the encrypted `data/solomon-master-*.json.enc` snapshot files client-side. Baked into `js/solomon-demo-gate.js` and verified via a PBKDF2 hash in `js/solomon-db-gate.js`. Completely independent of the admin-login passcode and of both sister systems' passcodes.

Both are clearly marked "SET/ROTATE THIS" in their respective source files.

## 2. Geography editor — 3-tier + independent-island + customary model

The admin's geography editor was rebuilt (not just relabeled) to match Solomon Islands' real structure, which is genuinely different from Tonga/Fiji's flat 2-tier model:

```
Village/Community -> Ward -> Province/City Area -> Solomon Islands
```

- **Dependent dropdowns**: Province/City Area → Ward, driven by `DISTRICT_TO_DIVISION` in `js/admin-solomon-master.js`, rebuilt from the real Province-Ward Lookup worksheet data (9 provinces + Honiara City → 182 wards, regenerated programmatically to stay in sync with the same table used in the dashboard adapter). Honiara City is a valid Province/City Area value with its own 12 wards, a sibling of the 9 provinces — the dropdown does not fold it into Guadalcanal.
- **Specific Island** is a separate, independent field in the editor — it is never auto-filled or overwritten when Ward/Province changes, since a ward or province can span multiple physical islands and a scholar's origin island may not itself be an administrative unit.
- **Customary/cultural fields** (Paternal/Maternal Clan/Tribe/Lineage, Customary Place, Self-identified Home/Community) are edited in a visually separate section from administrative geography, and the writeback backend (`apps-script/solomon-master-writeback.gs`) enforces this separation server-side — no field in the customary section can silently derive from or overwrite a geography field or vice versa.
- Editing is **field-level**, not row-flattening: a save only ever writes the specific field(s) the admin changed, mirroring the Tongan/iTaukei admin's conflict-detection design (`oldValue`/`currentMaster`/`newValue` three-way compare in the Apps Script backend) so it never silently clobbers other verified data in the same row.

## 3. Apps Script backend (`apps-script/solomon-master-writeback.gs`)

Cloned from `apps-script/tongan-master-writeback.gs` and adapted for the real Solomon schema:

- Spreadsheet ID is read from the `SOLOMON_SPREADSHEET_ID` Script Property (not hardcoded as a secret) — see `docs/SOLOMON-ISLANDS-APPS-SCRIPT-DEPLOY.md`.
- The field-mapping allowlist (`MAPPING.worksheets`) was rewritten field-by-field against the real Master Sheet headers: `Scholars`, `Positions`, `Graduate Degrees`, `Awards & Honours`, `Scholarships & Funding`, `Publications`, and `Research Geography` (the Tongan original only covered Scholars/Positions/Graduate Degrees). Header row is `1` everywhere (the Solomon sheet has no title-banner/description rows above the header, unlike the Tongan/iTaukei sheets which use row 4).
- `Gender` enum uses the Master Sheet's own placeholder controlled vocabulary: `Man` / `Woman` / `Self-described (see free text)` / `Not yet verified` — **NOT confirmed as final**, see §4.
- Same audited-writeback/change-log/concurrency-guard behavior as the Tongan version: script-scoped `LockService` lock, three-way `oldValue`/currentMaster/`newValue` conflict classification, `ALWAYS_CONFIRM` list for high-consequence fields (`Scholars.Alive/Deceased`), and a 5-column Change Log append (`Version | Date | Change | Scope/Impact | Source`).
- **Status: not yet deployed.** No live Apps Script Web App exists for this spreadsheet yet — the admin's writeback endpoint field shows a clear on-screen "Writeback endpoint not yet configured" note until an owner completes `docs/SOLOMON-ISLANDS-APPS-SCRIPT-DEPLOY.md`.

## 4. Open confirmations needed from Ron / the relevant community

- **Ward-list verification.** The Province-Ward Lookup worksheet's 182 wards are Statoids-sourced (updated Sep 2025) and explicitly marked "Not yet verified" against the Solomon Islands Government Gazette No. 7, Supplement No. 5 (23 Jan 2024), which reports **172** wards — a 10-ward discrepancy that needs reconciling against the primary source before the ward list is treated as final for public display.
- **Gender vocabulary.** The Lookups worksheet marks `Man`/`Woman`/`Self-described (see free text)`/`Not yet verified` as *"Placeholder canonical value — confirm terms with owner/community before publishing."* This build uses those exact placeholder terms (not the Tongan Fefine/Tangata scheme) but they are not yet confirmed final.
- **Public-origin display policy.** Confirm which geography/customary fields (Ward, Province/City Area, Specific Island, Clan/Tribe/Lineage, Customary Place, Self-identified Home/Community) are safe for public dashboard display per-scholar vs. admin-only, mirroring the confidentiality review the Tongan/iTaukei systems went through. The current `SCHOLAR_PUBLIC_FIELDS` allowlist in `scripts/solomon_master_file_config.py` includes all administrative-geography and customary fields as public by default — Ron should review this before real scholar data is entered.

## 5. Remaining owner actions (dashboard + admin, consolidated)

- [ ] Deploy the Apps Script backend (`docs/SOLOMON-ISLANDS-APPS-SCRIPT-DEPLOY.md`) and paste the resulting endpoint URL + secret into the admin's Data source tab.
- [ ] Add the GitHub repo secrets `VAVELAB_SOLOMON_PASSCODE` and (if not already present for the shared service account) `GOOGLE_SERVICE_ACCOUNT_JSON`, and grant that service account Editor access on the Solomon Islands Master Sheet.
- [ ] Rotate the placeholder admin-login passcode (`PASSWORD_HASH` in `js/admin-solomon-master.js`) and the placeholder data-decryption passcode (`js/solomon-db-gate.js` / `js/solomon-demo-gate.js`) before real data goes live.
- [ ] Verify the 182-ward Province-Ward Lookup against SIG Gazette No. 7, Supplement No. 5 (23 Jan 2024)'s figure of 172 wards; correct the Master Sheet and both regenerated ward tables (`js/solomon-database-adapter.js` + `js/admin-solomon-master.js` + `scripts/solomon_master_file_config.py`) if discrepancies are found.
- [ ] Confirm the final Gender controlled vocabulary with the relevant community/owner.
- [ ] Confirm the public-origin display policy (which geography/customary fields are safe to show per-scholar on the public dashboard vs. admin-only).
- [ ] Populate real scholar/publication/degree records in the Master Sheet — the dashboard and admin currently show honest "no data yet" empty states everywhere, by design, until this happens.
- [ ] Run the first live CI refresh (`.github/workflows/refresh-solomon-master-file.yml`) once the GitHub secrets above are set, to confirm the production (service-account) code path works end-to-end (this build's `.enc` snapshots were produced via the `gws`-CLI sandbox path against the live sheet, not the production service-account path, since no service-account key is available in this environment).
