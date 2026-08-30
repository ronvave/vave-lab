# Solomon Islands Scholarly Research Database — Dashboard Build Notes

Sister system to the Tongan Scholarly Research Database and the original iTaukei/Fiji dashboards, built inside `ronvave/vave-lab`. **Every file listed below is a new, additively-committed file.** No existing Fiji/iTaukei or Tongan file (`itaukei-research-database-master.html`, `tongan-research-database-master.html`, `js/itaukei-database-master.js`, `js/tongan-database-master.js`, `js/tongan-database-adapter.js`, any `data/itaukei-*` or `data/tongan-*`, `docs/TONGAN-*`, or `apps-script/tongan-master-writeback.gs`) was edited, renamed, or deleted. `git status` / `git diff --stat` were checked immediately before commit to confirm zero modifications to any tracked file other than `.gitignore` (a purely additive addition of a new Solomon-specific block).

Source of truth for the Master Sheet schema: the live **Solomon Islands Scholars Master File** (spreadsheet ID `1um6pHKriEhbtvmkm7e8E1j0_Zt9A-oYpY88fuPoAmFY`), read directly via the `gws` CLI during this build to confirm exact worksheet names, header rows, and column headers (36 worksheets; all data worksheets are header-only with zero data rows as of this build).

---

## 1. New files — public dashboard

| File | What it is |
|---|---|
| `solomon-islands-research-database-master.html` | Public dashboard. Cloned from `tongan-research-database-master.html` (~5,500 lines), retitled "Solomon Islands Scholar Database," every panel relabeled for Solomon-specific copy. |
| `js/solomon-database-master.js` | Cloned from `js/tongan-database-master.js` (~12,400 lines). Core render/analytics logic preserved; every hardcoded Tongan 5-division geography table (color maps, gradients, tally objects, ward→province lookups — there were ~10 separate hardcoded copies at different call sites) replaced with the real Solomon 9-province + Honiara-City / 182-ward structure. |
| `js/solomon-database-adapter.js` | Cloned from `js/tongan-database-adapter.js` (~1,850 lines → ~1,930 lines). This is where the geography model was rebuilt properly (see §2) and where Scholars-sheet field names were remapped to the real Master Sheet headers (see §3). |
| `js/solomon-panel-overrides.js` | Cloned from `js/tongan-panel-overrides.js`. `DIVISION_ORDER`/`DIVISION_SLUG` rebuilt for the 9 provinces + Honiara City. |
| `js/solomon-main.js` | Cloned from `js/tongan-main.js`. Fully generic site-wide JS (theme toggle, nav highlighting, scroll-reveal) — no content changes needed. |
| `js/solomon-demo-gate.js` | Cloned from `js/tongan-demo-gate.js`, with a brand-new baked passcode and a brand-new HMAC demo-token signing key (§4) — never reuses the Tongan or iTaukei values. |
| `js/solomon-db-gate.js` | Cloned from `js/tongan-db-gate.js`, with a brand-new verifier hash for the same brand-new passcode (§4), and its own `ENC_FILES` map pointing only at `data/solomon-*.json.enc`. |

## 2. Geography model — the real structural adaptation

Tonga/iTaukei use a flat two-level model (District → Island Division / Confederacy). Solomon Islands is genuinely three-tier plus two independent attributes:

```
Village/Community/Study Site -> Ward -> Province/City Area -> Solomon Islands
```

- **Honiara City is its own first-level reporting area** with its own 12 wards — a sibling of the 9 provinces, never folded into Guadalcanal. The combined national total sums all 10 reporting areas.
- **Specific Island is independent** of administrative geography. It is read from its own dedicated Scholars-sheet columns (`Paternal/Maternal Specific Island`) and is **never derived** from Ward or Province anywhere in the adapter, master JS, or admin editor — a ward or province (e.g. Western Province) can span multiple physical islands.
- **Customary/cultural fields** (`Paternal/Maternal Clan/Tribe/Lineage`, `Customary Place`, `Self-identified Home/Community`) are stored and read separately from administrative geography and are never inferred from it, from surname, or from title.
- The full 9-province + Honiara-City → 182-ward table (`PROVINCE_WARDS` / `PROVINCE_GROUPS` internal names, kept for structural parity with the cloned code) lives in `js/solomon-database-adapter.js`, `js/solomon-database-master.js`, `js/admin-solomon-master.js`, and `scripts/solomon_master_file_config.py` — all four copies were regenerated from the same canonical list to keep them in sync. This mirrors the Master Sheet's own **Province-Ward Lookup** worksheet (Statoids-sourced, updated Sep 2025).
- Internal property names (`PROVINCE_GROUPS`, `PROVINCE_TO_CONFED`, `.provinceGroup`, `window.MasterFileAdapter`, `window.SolomonIslandsMasterFileAdapter`) were deliberately kept identical in *shape* to the Tongan/iTaukei originals — only their *content* changed — because the downstream chart/filter/tooltip logic reads them by these exact names. No Fijian confederacy or Tongan Island Division name (Tovata/Kubuna/Burebasaga, Tongatapu/Vava'u/Ha'apai/'Eua/Ongo Niua) appears anywhere in the Solomon files.

**Manual verification owed:** the Province-Ward Lookup's 182 wards are Statoids-sourced (Sep 2025) and explicitly marked "Not yet verified" against the Solomon Islands Government Gazette No. 7, Supplement No. 5 (23 Jan 2024), which reports 172 wards — a 10-ward discrepancy. Ron should reconcile the two sources before treating the ward list as final (see `SOLOMON-ADMIN-BUILD-NOTES.md` remaining-actions list).

## 3. Scholars-sheet field-name remapping

The real Master Sheet's `Scholars` worksheet uses different header names than the Tongan/iTaukei sheets this dashboard was cloned from. The adapter (`js/solomon-database-adapter.js`) was remapped field-by-field against the live headers (verified via `gws sheets spreadsheets values get`), notably:

- `Paternal Ward` / `Maternal Ward` (not `Ward Paternal`/`District Paternal`)
- `Paternal Province/City Area` / `Maternal Province/City Area`
- `Paternal Specific Island` / `Maternal Specific Island` (read directly — never derived)
- `Paternal Village/Community` / `Maternal Village/Community`
- `Paternal Clan/Tribe/Lineage` / `Maternal Clan/Tribe/Lineage`, `Customary Place`, `Self-identified Home/Community` (customary fields, independent of geography)

The Master Sheet's data worksheets all use **header row 1** (not row 4 as in the Tongan/iTaukei sheets), which is also reflected in `scripts/solomon_master_file_config.py`'s `SHEETS` mapping and in `apps-script/solomon-master-writeback.gs`'s `MAPPING.worksheets[...].headerRow`.

## 4. Gender vocabulary — NOT YET CONFIRMED

The Master Sheet's `Lookups` worksheet stores the Gender controlled vocabulary as **"Man" / "Woman" / "Self-described (see free text)" / "Not yet verified"**, explicitly annotated *"Placeholder canonical value — confirm terms with owner/community before publishing."* This dashboard's aggregates (`scripts/solomon_master_file_transformer.py`) and KPI labels use these exact placeholder terms rather than the Tongan Fefine/Tangata scheme or a generic Male/Female — but **Ron must confirm the final gender vocabulary with the relevant community/owner before this is treated as final** (see `SOLOMON-ADMIN-BUILD-NOTES.md`).

## 5. New encryption credentials (chosen for this build — rotate before real data goes live)

- **Data-file passcode: `Waelava7!`** (env var `VAVELAB_SOLOMON_PASSCODE`), baked into `js/solomon-demo-gate.js` (base64-encoded) and verified via a fresh PBKDF2 hash in `js/solomon-db-gate.js`. Distinct from the Tongan passcode and the iTaukei passcode — a `.enc` file encrypted with this passcode cannot be decrypted with either sister system's passcode.
- **Demo-gate HMAC signing key (base64): `0CKhHj4fu0fLoh88YRMpJtwFNOFzcxX/G8B1PaRSWMg=`** — a fresh random 32-byte key, distinct from both sister systems' signing keys.
- These are placeholder values chosen for this scaffold build (clearly marked "SET/ROTATE THIS" in-code) — not final production secrets. Rotate before any real scholar data is loaded.
- Encryption scheme unchanged from the Tongan/iTaukei pattern: `magic("IVAV") || salt(16) || iv(12) || AES-256-GCM(ciphertext+tag)`, key derived via `PBKDF2-HMAC-SHA256(passcode, salt, 200,000 iterations)`. Verified end-to-end: ran `scripts/solomon_master_file_transformer.py --mode=gws` against the live (header-only) Master Sheet, producing valid empty-array/zero-count JSON snapshots, then `scripts/solomon_encrypt_data.py` to produce real `data/solomon-master-*.json.enc` files committed with this build.
- `data/solomon-revoked-demos.json` is a new, empty Solomon-specific revocation list (never shares state with the Tongan/iTaukei revocation files).

## 6. Empty-data state (current, expected)

The Master Sheet has **zero** scholar/publication/degree/authorship rows right now — headers and controlled vocabularies only. Every panel therefore renders an honest "no data yet" / "awaiting verified records" empty state rather than any fabricated or borrowed number. This exactly mirrors how the Tongan system behaved on its first build. The `solomon-master-*.json.enc` snapshot files committed with this build reflect that real empty state (verified via a live pipeline run against the actual Google Sheet, not synthesized).

## 7. Demo mode

`js/solomon-demo-gate.js` preserves the "Show demo view" / dev-mode / signed-demo-link affordance from the Tongan clone, using the Solomon-specific passcode and signing key above. No synthetic Solomon-flavored scholar records were fabricated for this build (per the task's explicit "do not fabricate realistic-looking fake Solomon Islander scholar names/records" instruction) — the demo path currently surfaces the same honest empty state as the live dashboard rather than invented data. A follow-up task can populate a clearly-labeled synthetic demo dataset once Ron confirms what level of demo-data fidelity is appropriate.

## 8. `.gitignore`

Added a new Solomon-specific block (purely additive — the existing Fiji/iTaukei and Tongan blocks were not touched) excluding every Solomon Islands plaintext data file. Only `.enc` files are committed; plaintext is produced locally/in CI and never checked in.

## 9. Remaining owner actions

See the consolidated list in `SOLOMON-ADMIN-BUILD-NOTES.md` §"Remaining owner actions" — it covers both the dashboard and admin panel.
