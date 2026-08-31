# Samoa Scholar Database — Build Notes

Sister clone of the iTaukei Scholarly Research Database and the Tongan
Scholar Database, built inside `ronvave/vave-lab`. **Every file listed
below is a new, additively-committed file.** No existing iTaukei, Tongan,
or Solomon Islands file was edited, renamed, or deleted.

Authoritative source documents used to build this:

- `Samoa-Scholarly-Database-Master-Schema-Build-Blueprint.docx` — owner-approved
  blueprint from Prof. Ron Vave (Department of Pacific Islands Studies),
  dated 30 August 2026.
- The Samoa Master Google Sheet (created separately from this repo commit —
  see the `Samoa-Scholar-Database-Master.xlsx` in the parent turn's
  deliverables and paste its Google Sheets URL / ID into
  `scripts/samoa_master_file_config.py` when it exists as a live Sheet).

## Session scope disclosure

This commit is the **scaffold + Master Sheet foundation** phase. It does NOT
include the working admin panel or the full public dashboard JS. Both were
explicitly deferred by the owner to follow-up sessions so that the
~11,000-line `js/itaukei-database-master.js` clone can be adapted carefully
to Samoa's six-dimension geography model without repeating the Fiji-leftover
bugs that shipped in the initial Tongan clone (see
`TONGAN-DASHBOARD-BUILD-NOTES.md`, §8 and §9).

**What ships in this commit:**

| Path | Role | Status |
|---|---|---|
| `Samoa-Scholar-Database-Master.xlsx` (delivered in-thread, not committed) | 41-worksheet Master Sheet with authoritative Samoa geography lookups | Ready to open in Google Sheets |
| `scripts/samoa_master_file_config.py` | Pipeline config with Samoa-specific spreadsheet ID placeholder, six-dimension geography constants, public-field allowlist | Ready; awaiting Sheet ID |
| `scripts/samoa_encrypt_data.py` | AES-GCM encryptor for `data/samoa-*.json.enc`; refuses to encrypt non-Samoa targets | Ready; awaiting VAVELAB_SAMOA_PASSCODE |
| `scripts/samoa_decrypt_data.py` | Companion decryptor | Ready |
| `apps-script/samoa-master-writeback.gs` | Bound Apps Script writeback with fresh `SHARED_SECRET`; **allowlist inherited from Tongan sister and must be regenerated against Samoa Master Sheet headers before enabling writes** | Structural clone; allowlist banner in place |
| `.github/workflows/refresh-samoa-master-file.yml` | Scheduled + on-dispatch refresh workflow; every 2h at :10; requires `VAVELAB_SAMOA_PASSCODE` secret | Ready; awaiting secret |
| `admin-samoa-master.html` | Placeholder page reserving the admin URL and documenting companion JS files not yet added | Stub |
| `samoa-research-database-master.html` | Placeholder page reserving the dashboard URL and documenting the six-dimension geography model | Stub |
| `SAMOA-DASHBOARD-BUILD-NOTES.md` | This file | Ready |
| `SAMOA-ADMIN-BUILD-NOTES.md` | Admin-side companion notes | Ready |
| `docs/SAMOA-APPS-SCRIPT-DEPLOY.md` | Step-by-step Apps Script deploy instructions | Ready |

**What is deferred to follow-up sessions:**

- `js/samoa-database-master.js` (clone of `js/itaukei-database-master.js`, 11,844 lines)
- `js/samoa-database-adapter.js` (clone of `js/master-file-adapter.js`, 1,534 lines)
- `js/samoa-panel-overrides.js`
- `js/samoa-demo-gate.js` (with fresh HMAC signing key and BAKED_PASSCODE)
- `js/samoa-main.js`
- `samoa-body-composition.html` (Panel C1 iframe target)
- `js/samoa-db-gate.js`, `js/samoa-admin-writeback-client.js`,
  `js/samoa-admin-insights-migration.js`, `js/admin-samoa-master.js`
- `scripts/samoa_master_file_transformer.py` (Sheet → dashboard-snapshot ETL)
- `scripts/samoa_master_file_diff.py` / `plaintext_changed.py`-equivalent wiring
- `data/samoa-districts.geojson` (SBS district boundaries)
- The complete rewritten Apps Script `ALLOWLIST` map matching Samoa Master
  Sheet headers exactly (currently inherited from Tongan; the banner in the
  file makes this un-missable)

## Six-dimension geography model (critical)

Samoa's blueprint mandates that these six geography systems be preserved as
SEPARATE dimensions and never assumed interchangeable. Every Samoa file in
this commit treats them as six independent lookups; the Master Sheet has
six separate lookup tabs; `samoa_master_file_config.py` exposes them as
six independent Python constants:

1. **Statistical Region** — SBS's four census regions (Apia Urban Area,
   North-West Upolu, Rest of Upolu, Savai'i). Top of the SBS statistical
   spine.
2. **Political/Census District** — SBS uses ~43 Political Districts for
   statistical reporting; each rolls up to exactly one Region.
3. **Village** — SBS Village Directory (~340 villages). Each rolls up to
   exactly one Political District.
4. **Specific Island** — Upolu, Savai'i, Manono, Apolima, Nu'utele,
   Nu'ulua, Namu'a, Fanuatapu. **Independent field**; never derived from
   district name.
5. **Traditional Itūmālō** — the 11 constitutional traditional districts
   named in Samoa's Constitution, Second Schedule. Parallel to the SBS
   spine; never substituted for a census district.
6. **Electoral Constituency** — the 51 territorial + 2 individual-voter
   constituencies from the Electoral Constituencies Act 2019, plus the
   pre-2019 constituency set. **Time-versioned**; every row carries the
   applicable election-year/version.

The dashboard filter UI (deferred) must expose these as clearly-labelled
parallel filters, never as interchangeable synonyms.

## Isolation guardrails (matches Tongan build)

- **Spreadsheet ID guard.** `scripts/samoa_master_file_config.py` refuses
  to run if `SPREADSHEET_ID` is left as the placeholder, or if it matches
  the iTaukei sheet (`1nJvMWLS8jnCOKtRoqdDpEW3s3j9TSAclXBO1txVFxdg`) or
  the Tongan sheet (`1lh6wOFcg2GiFe2YylgxM5cvLOdumdbCrHDLQk87rjRI`).
- **Passcode.** Encryption uses `VAVELAB_SAMOA_PASSCODE`, never
  `VAVELAB_PASSCODE` / `VAVELAB_TONGAN_PASSCODE` / `VAVELAB_SOLOMON_PASSCODE`.
- **Filename prefixes.** Every Samoa data file is `data/samoa-*` (or the
  GeoJSON at `data/samoa-districts.geojson`). The encryptor + decryptor
  refuse to touch files starting with `itaukei-`, `tongan-`, `tonga-`, or
  `solomon-`.
- **Apps Script secret.** Fresh 32-byte hex `SHARED_SECRET` generated for
  this deployment; distinct from the Tongan value baked into
  `apps-script/tongan-master-writeback.gs`.
- **Cron offset.** Refresh workflow runs at `10 */2 * * *` UTC — 10 minutes
  after the hour, offset from the iTaukei workflow (on the hour) and the
  Tongan workflow (`5 */2 * * *`), to keep commit races on `main` unlikely.
- **Localstorage key isolation.** When the admin and dashboard JS clones
  are added, they must use `samoalab.*`-prefixed keys (not `vavelab.*`,
  `tonganlab.*`, or `solomonlab.*`) to avoid the cross-system localStorage
  collision documented in `TONGAN-ADMIN-BUILD-NOTES.md`.

## Public-origin display policy (owner-confirmed 2026-08-30)

Paternal default, matching Fiji V2. Public scholar cards show verified
paternal village + political/census district + specific island (when
useful) + Samoa. Traditional itūmālō and matai/customary info appear only
when independently verified. The country label is always "Samoa" —
"Western Samoa" appears only in search aliases and explanatory metadata,
never on public cards.

## Ambiguities and unresolved items

1. **Apps Script `ALLOWLIST` map.** The current file structurally clones
   the Tongan writeback; the `ALLOWLIST` map still references Tongan-schema
   column names (e.g. `"C_Uni name"`, `"International from Samoa?"` — the
   Samoa string was substituted mechanically). Before enabling writes,
   regenerate this map from the row-4 headers of every writable tab in the
   Samoa Master Sheet. The banner comment in the file makes this un-missable.
2. **Refresh cadence.** Every 2 hours plus post-write (matching Tongan).
   Owner may want a different cadence once the workbook has records.
3. **Publication types.** Follows the blueprint §5.3 headline set (Journal
   Article, Master's Thesis, PhD Thesis, Book Chapter, Book) and the
   iTaukei V2 preprint-exclusion policy (preprints remain in the Master but
   are excluded from V2 counts, chips, and lists).
4. **Body composition (Panel C1).** No Samoan-specific silhouette imagery
   yet. Recommend using the Tongan approach: keep silhouettes generic when
   labels change to Tāne / Fafine, unless Ron wants Samoa-specific artwork.
5. **Coordinate coverage.** The Master Sheet's Research Geography
   Coordinates tab is populated only for villages where an authoritative
   coordinate source was found. Coverage gaps are documented in the
   geography README shipped alongside the Master Sheet.

## Verification checklist for the follow-up dashboard session

Before that session commits `js/samoa-database-master.js`, verify:

- [ ] Every hardcoded confederacy / province table swapped for Samoa's
      Statistical Region → Political/Census District table (built from the
      Master Sheet's Region-District Lookup tab).
- [ ] Every occurrence of "Confederacy" / "Province" / "Tikina" in
      user-visible strings replaced with Samoa's dimension names.
- [ ] Gender labels: "Turaga" → "Tāne", "Marama" → "Fafine".
- [ ] Every "iTaukei" in user-visible text replaced with "Samoan".
- [ ] Map center/bounds: approx `[-13.75, -172.30]` and bounds covering
      Upolu (west and east), Savai'i, Manono, Apolima.
- [ ] No `PROVINCE_TO_CONFEDERACY` object contains Fijian confederacy names.
- [ ] No Fiji-specific tikina fallback strings left in error/empty
      states.
- [ ] Preprints excluded from all V2 counts, chips, lists (matches iTaukei
      V2 policy).
- [ ] Master's and PhD theses counted and shown in pills and cards.
- [ ] The three parallel geography filters (census, traditional, electoral)
      are visually distinct and labelled with their dimension name and
      version.

---

**Sister systems for reference:**
- iTaukei (Fiji): `itaukei-research-database-master.html`, `js/itaukei-database-master.js`
- Tongan: `tongan-research-database-master.html`, `js/tongan-database-master.js`
- Solomon Islands: `solomon-islands-research-database-master.html`
