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

---

## Session 2 (2026-08-30) — Dashboard scaffold shipped

Session 2 lands the dashboard's runtime scaffold. The panels themselves
(scholar directory, map, publications, alluvial, chord, coauthor
network) are still placeholders — those land in Sessions 3+. The
scaffold is a working preview end-to-end: unlock the demo gate, the
adapter loads Master snapshots, the geography summary strip lights up
with real counts from the live Master Sheet.

### Files shipped in Session 2

| Path | Role | Lines | Status |
|---|---|---:|---|
| `js/samoa-database-adapter.js` | Samoa-native Master-file adapter. Hydrates six independent geography dimensions from `data/samoa-master-geography.json`. Normalises Scholar rows to preserve the six-dimension paternal/maternal split. Exports `window.SamoaScholarDatabaseAdapter` (deliberately NOT `window.MasterFileAdapter`). | 661 | ✅ Ready |
| `js/samoa-demo-gate.js` | Dashboard-only demo/dev gate. Baked passcode `Zoopilus1!` (base64), Samoa-specific HMAC signing key. `data/samoa-*.json.enc` decrypted in-browser via AES-GCM using the same IVAV wire format as the admin db-gate. Localstorage key `samoalab_dev`. Revocations file `data/samoa-revoked-demos.json`. | 476 | ✅ Ready |
| `js/samoa-main.js` | Theme toggle, sticky-header scroll shadow, mobile menu, scroll-reveal — jurisdiction-neutral. Byte-identical (below the header) to the sister-jurisdiction equivalents; header comment documents that no Samoa-specific logic lives here. | 89 | ✅ Ready |
| `samoa-research-database-master.html` | Full dashboard shell. Loads the four JS files in dependency order. Contains 7 panel placeholders (A–G) for Sessions 3+. Boot script wires the demo-gate to the adapter's `dbGate` handle and populates the six-dimension geography summary strip. | 323 | ✅ Ready |
| `data/samoa-master-geography.json.enc` | Live geography snapshot encrypted with `Zoopilus1!`. Built ad-hoc from the four Master Sheet lookup tabs (Regions, Region-District, Village Geography, Traditional Itūmālō, Electoral Constituency). The transformer will regenerate this in Session 4. | 155 KB | ✅ Present |

### Six-dimension geography surface exposed by the adapter

The adapter's `load()` returns a bundle with a `geo` sub-object whose
constants are FIRST-CLASS. Every value below was verified against the
live Master Sheet on 2026-08-30:

| Constant | Count | Sample values |
|---|---:|---|
| `statisticalRegions` | 4 | Apia Urban Area, North West Upolu, Rest of Upolu, Savai'i |
| `politicalDistricts` | 51 | Vaimauga 2, Vaimauga 3, Faleata 1, … (2021-Census) |
| `villages` | 329 (unique from 341 raw) | Moataa, Vaivase Tai, Tanoaleia, … |
| `specificIslands` | 4 | Upolu, Manono, Apolima, Savai'i |
| `traditionalItumalo` | 11 | Tuamasaga, A'ana, Aiga-i-le-Tai, Va'a-o-Fonoti, Atua, Fa'asaleleaga, Gaga'emauga, Gagaifomauga, Vaisigano, Satupa'itea, Palauli |
| `electoralConstituenciesByVersion['2019-Act']` | 51 | Vaimauga 1, Vaimauga 2, Vaimauga 3, … (post-Electoral Constituencies Act 2019) |
| `electoralConstituenciesByVersion['Pre-2019']` | 43 | pre-Act historical constituencies |
| `electoralVersions` | 2 | `2019-Act`, `Pre-2019` |

Integrity of the loaded snapshot (verified in Python round-trip):
- 0 districts pointing to an unknown region.
- 0 villages pointing to an unknown district.
- 5 villages correctly missing `specificIsland` (per the "never infer
  island from district" rule). These are: Tausagi, Olo, Paepaeala,
  Satuilagi, Satoi — flagged for follow-up when Ron next reviews the
  Village Directory.

The 4 named-but-uninhabited islets (Fanuatapu, Namu'a, Nu'ulua,
Nu'usafe'e) are NOT in `SPECIFIC_ISLANDS` because they carry no villages
in the SBS Village Directory. If a future scholar record points at one
of those, the transformer will add it as an out-of-band Specific Island
value.

### Adapter output bundle (from `load()`)

```
{
  scholars:            Map<Scholar ID, Scholar>,     // paternal + maternal six-dim geography
  publications:        Map<Publication ID, Pub>,
  authorship:          Array,
  researcherAuthorship: Array,
  gradDegrees:         Array,
  mobility:            Array,
  geography:           Object,                       // raw six-dim doc
  geographyCoords:     Array,
  worldPoints:         Array,
  aggregates:          Map<Scholar ID, agg>,
  partIndigenous:      Map<Scholar ID, row>,
  bodyComposition:     Object|null,
  autoResolved:        Map<Scholar ID, evidence>,
  insights:            Map<Scholar ID, insights>,
  workplaceCoords:     Object,
  uniCountryOverrides: Object,
  worldUniversities:   Array,
  districtsGeoJSON:    FeatureCollection,
  lastSync:            Object|null,
  geo:                 {                             // ⭐ six-dimension constants
    statisticalRegions:   [...],
    politicalDistricts:   [...],
    politicalDistrictToRegion: { <district>: <region> },
    villages:             [...],
    villageToDistrict:    { <village>:  <district> },
    villageToIsland:      { <village>:  <island>   },   // ONLY when explicit
    specificIslands:      [...],
    traditionalItumalo:   [...],
    itumaloAlternate:     { <name>: <alternate spelling> },
    electoralConstituenciesByVersion: { '2019-Act': [...], 'Pre-2019': [...] },
    electoralVersions:    [...],
    currentElectoralVersion: '2019-Act',
    // Unresolved-value tokens (per dimension, all distinct).
    STATISTICAL_REGION_UNSPEC, STATISTICAL_REGION_UNSURE,
    POLITICAL_DISTRICT_UNSPEC, POLITICAL_DISTRICT_UNSURE,
    VILLAGE_UNSPEC, VILLAGE_UNSURE,
    SPECIFIC_ISLAND_UNSPEC, SPECIFIC_ISLAND_UNSURE,
    TRADITIONAL_ITUMALO_UNSPEC, TRADITIONAL_ITUMALO_UNSURE,
    ELECTORAL_CONSTITUENCY_UNSPEC, ELECTORAL_CONSTITUENCY_UNSURE
  },
  geoStats: { regions, districts, villages, specificIslands, traditionalItumalo, electoralVersions }
}
```

Downstream panel code in Sessions 3+ MUST read from `bundle.geo` and
MUST NOT define its own province/ward/confederacy variables that hold
Samoa data. `bundle.geo.politicalDistricts` is the district list; no
`bundle.geo.provinces` alias exists and none will be added.

### Baked authentication material (dashboard-side)

Values baked into `js/samoa-demo-gate.js`:

| Constant | Value | Derivation |
|---|---|---|
| `BAKED_PASSCODE` | `atob('Wm9vcGlsdXMxIQ==')` = `Zoopilus1!` | Same passcode as `samoa-db-gate.js`; a single AES-GCM key decrypts both admin and dashboard data files. |
| `DEMO_SIGN_KEY_B64` | `V0EeEl8X5U8yAig6hYeCJaJ2+BumXO0XSgOkGBOPVUY=` | Random 32-byte HMAC key. Fresh for Samoa, distinct from all sister-system keys. |
| `DEV_FLAG_KEY` | `samoalab_dev` | Distinct from sister-system dev flags. |
| `REVOKE_PATH` | `data/samoa-revoked-demos.json` | Samoa-only revocations file. |

### Verified in Session 2

- **Forbidden-token sweep** (PCRE2 word-boundary, all seven Session-1
  and Session-2 JS/HTML files): 5 matches total, ALL in either
  docstring/comment text explaining the anti-pattern or in the
  `REJECTED_KEYS` data-safety guard. Zero operational code paths
  reference a sister-jurisdiction concept.
- **`node --check`** passes on all Session-2 JS files.
- **Geography round-trip**: Python-side emulation of
  `hydrateGeography()` against the real live-sheet geography snapshot
  produces the 4/51/329/4/11/(51+43) counts documented above with zero
  integrity violations.
- **AES-GCM round-trip** of the geography snapshot with the baked
  `Zoopilus1!` passcode: verified end-to-end. The dashboard shell can
  decrypt and load real data.

### Session 2 remaining gaps

1. **Panel content (A–G) is a placeholder scaffold.** The
   `.samoa-panel-placeholder` divs will be replaced with real DOM +
   render code in Sessions 3+ as each panel is semantically rewritten.
2. **`js/samoa-database-master.js` and `js/samoa-panel-overrides.js`
   don't exist yet.** The dashboard HTML has slots for them but does
   not `<script>` them in — the current scaffold only needs
   `samoa-database-adapter.js` to demonstrate the geography summary.
   These land in Sessions 3+.
3. **`data/samoa-master-scholars.json.enc`** etc. — the other Master
   snapshots do not exist yet on this branch. The adapter tolerates
   their absence (each `fetchJsonOr(..., fallback)`), so the scaffold
   loads with empty scholars/publications and a real geography summary.
   The refresh workflow (`.github/workflows/refresh-samoa-master-file.yml`)
   will produce these on its first successful run once
   `SAMOA_SHEETS_API_KEY` and `SAMOA_APPS_SCRIPT_URL` secrets are set.
4. **`data/samoa-districts.geojson.enc`** does not yet exist. When the
   map panel lands (Session 3), the file will be sourced from GADM v4.1
   or Natural Earth ADM-2 filtered to Samoa's districts.
5. **`js/samoa-database-master.js` will need panel-by-panel review**
   for any accidental `PROVINCE_*`/`WARD_*` variable leaking in via a
   copy-paste. Every panel touch in Sessions 3+ must be preceded by an
   explicit "no aliases" audit.

### Session 3+ scope reminder

Sessions 3–5 will rewrite each dashboard panel semantically, one at a
time, per the multi-session commitment:

- **Session 3**: Panels A (scholar directory + six-dimension filters),
  B (Leaflet district map + world-points overlay), C (publications).
- **Session 4**: Panels D (alluvial mobility), E (discipline × electoral
  constituency chord — versioned), F (coauthor network coloured by
  Statistical Region).
- **Session 5**: Panel G (body-composition iframe) and Apps Script
  writeback protocol adaptation (`action='update'` HMAC contract).
- **Final session**: full audit — every panel confirmed to reference
  ONLY Samoa constants, no aliases anywhere in the runtime, all six
  dimensions render distinctly, admin writeback round-trips against
  the live Master Sheet.
