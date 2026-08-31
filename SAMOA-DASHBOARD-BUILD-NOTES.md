# Samoa Scholar Database — Dashboard Build Notes

Public dashboard and Master Sheet foundation for the Samoa Scholar
Database, built inside `ronvave/vave-lab`. Every file is committed
additively; no other repo file is modified except an appended block in
`.gitignore`.

Authoritative source:

- `Samoa-Scholarly-Database-Master-Schema-Build-Blueprint.docx` — owner-approved
  blueprint from Prof. Ron Vave (Department of Pacific Islands Studies),
  dated 30 August 2026.
- The Samoa Master Google Sheet at
  `1X-RZSWKbzG-oY7anCYaR54Ev8h2G8yl0SXy6jMNhCHQ` — the single source of
  truth for tab names, row-4 headers, and geography lookups.

## Files shipping in this build

| Path | Role | Status |
|---|---|---|
| `apps-script/samoa-master-writeback.gs` | Bound Apps Script writeback. Fresh `SHARED_SECRET`. `MAPPING` is auto-regenerated from the live Master Sheet by `samoa_build/generate_allowlist.py` (25 writable tabs, 454 field entries). | Ready |
| `scripts/samoa_master_file_config.py` | Pipeline config. Six independent geography constants. Guard refuses to run against any spreadsheet ID in `_FORBIDDEN_SPREADSHEET_IDS`. | Ready |
| `scripts/samoa_encrypt_data.py` + `samoa_decrypt_data.py` | AES-GCM under `VAVELAB_SAMOA_PASSCODE`. `_FORBIDDEN_PREFIXES` refuses to touch files that would collide with another jurisdiction. | Ready |
| `.github/workflows/refresh-samoa-master-file.yml` | Runs at `10 */2 * * *` UTC and on manual dispatch. | Ready |
| `admin-samoa-master.html` | Admin surface (JS being built in a follow-up phase). | Stub, active build |
| `samoa-research-database-master.html` | Public dashboard shell (JS being built in a follow-up phase). | Stub, active build |
| `data/samoa-*.json.enc` | 19 non-decryptable stubs (`IVAV` magic + zeroed salt/iv/ciphertext) reserving the fetch paths so the dashboard 200s until the first workflow run writes real blobs. | Ready |
| `SAMOA-ADMIN-BUILD-NOTES.md` | Admin-side companion. | Ready |
| `SAMOA-DASHBOARD-BUILD-NOTES.md` | This file. | Ready |
| `docs/SAMOA-APPS-SCRIPT-DEPLOY.md` | Apps Script deploy runbook. | Ready |

## Six-dimension geography model

Samoa's blueprint mandates that these six geography systems be preserved
as SEPARATE dimensions and never assumed interchangeable. Every file in
this build treats them as six independent lookups.

1. **Statistical Region** — SBS's four census regions (Apia Urban Area,
   North-West Upolu, Rest of Upolu, Savai'i). Top of the SBS statistical
   spine.
2. **Political/Census District** — the 51 Political Districts SBS uses
   for statistical reporting; each rolls up to exactly one Region.
3. **Village** — SBS Village Directory (341 villages captured; 2 short of
   SBS's own stated 343; missing names not recoverable from published
   sources and were **not** padded).
4. **Specific Island** — Upolu, Savai'i, Manono, Apolima, Nu'utele,
   Nu'ulua, Namu'a, Fanuatapu. Independent field; never derived from a
   district name. Five Aiga i le Tai villages (Tausagi, Olo, Paepaeala,
   Satuilagi, Satoi) have no island assignment in fetched sources; those
   cells are left blank rather than inferred.
5. **Traditional Itūmālō** — the 11 traditional districts. Constituent-
   village mappings could not be recovered from any government source in
   the initial research pass; those cells are left blank rather than
   inferred.
6. **Electoral Constituency** — 51 territorial post-2019 constituencies
   (Electoral Constituencies Act 2019 No.11) plus the pre-2019 territorial
   and individual-voter constituencies from the Constituencies Act 1963.
   Each row is time-versioned; every consumer must read the
   `election_version` column and never mix eras.

The dashboard filter UI exposes these as clearly-labelled parallel
filters. Never as interchangeable synonyms.

## Preserved unresolved gaps

The Master Sheet and geography lookups **visibly preserve** these gaps.
Do not fabricate replacement values.

- Village Geography Lookup has 341 rows against SBS's stated 343.
- 11 Traditional Itūmālō rows have `constituent_villages_or_subdistricts` blank.
- 5 Aiga i le Tai villages have `specific_island` blank.
- 113 villages have no coordinate in the Research Geography Coordinates tab.
- 228/341 coordinates are name-matched to GeoNames without SBS-boundary
  verification (each row's `notes` records this).

## Isolation guardrails

- **Spreadsheet ID guard.** `samoa_master_file_config.py` enumerates every
  spreadsheet ID that must never receive a Samoa write; the transformer
  refuses to run if `SPREADSHEET_ID` matches any of them or is left as
  a placeholder.
- **Passcode.** Encryption uses `VAVELAB_SAMOA_PASSCODE`, a Samoa-only env
  variable. Never paste a passcode used by any other pipeline.
- **Filename prefixes.** Every Samoa data file lives at `data/samoa-*`.
  The encryptor and decryptor refuse to touch files that would collide
  with a sister jurisdiction.
- **Apps Script secret.** Fresh 32-byte hex `SHARED_SECRET` generated for
  this deployment.
- **Cron offset.** Refresh workflow runs at `10 */2 * * *` UTC, chosen
  to keep commit-race odds on `main` low against other repo cron jobs.
- **Localstorage key isolation.** All admin and dashboard JS use
  `samoalab.*`-prefixed keys.

## Public-origin display policy (owner-confirmed 2026-08-30)

Paternal default. Public scholar cards show verified paternal village +
political/census district + specific island (when useful) + Samoa.
Traditional itūmālō and matai/customary information appear only when
independently verified. The country label is always "Samoa" — "Western
Samoa" appears only in search aliases and explanatory metadata, never on
public cards. Maternal geography, family/ʻāiga, matai title, customary
affiliation, self-identified home, cultural evidence notes, all internal
notes, review/inclusion status, and source IDs are permanently denied to
the public dashboard.

## MAPPING regeneration

If Master Sheet headers change, re-run:

```bash
cd samoa_build
python3 generate_allowlist.py           # writes allowlist.gs.fragment
```

Then paste the fragment into `apps-script/samoa-master-writeback.gs`
replacing the current `var MAPPING = { ... }` block. Do not hand-edit the
`MAPPING`. The current MAPPING was generated 2026-08-30 against the live
sheet and covers 25 writable tabs, 454 field entries.

## Verification checklist for the follow-up dashboard session

Before the dashboard JS lands:

- [ ] `js/samoa-database-master.js` uses only Samoa geography names in
      user-visible strings ("Statistical Region", "Political/Census
      District", "Village", "Specific Island", "Traditional Itūmālō",
      "Electoral Constituency").
- [ ] Gender labels are "Tāne" and "Fafine".
- [ ] Country label in public strings is "Samoa".
- [ ] Map center ≈ `[-13.75, -172.30]`; bounds cover Upolu (both halves),
      Savai'i, Manono, and Apolima.
- [ ] Preprints excluded from all V2 counts, chips, and lists.
- [ ] Master's and PhD theses counted and shown.
- [ ] Three parallel geography filters (census, traditional, electoral)
      are visually distinct and labelled with dimension + version.
- [ ] Every fetch target lands at a `data/samoa-*.json.enc` path.
- [ ] Every localStorage key is `samoalab.*`.
