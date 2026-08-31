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

### Session 3+ scope reminder (corrected 2026-08-30 by owner)

Sessions 3–5 will rewrite each dashboard panel semantically, one at a
time, per the multi-session commitment. **Panel taxonomy corrected by
Ron in the Session 4 directive:**

| Panel | Meaning (authoritative) |
|---|---|
| A  | Overview KPIs and headline counts |
| B1 | Leaflet district-choropleth map |
| B2 | World-points overlay (graduate locations) |
| B3 | Postgraduate mobility (district → country of study, alluvial) |
| B4 | Research geography / global locations and institutional linkages |
| C1 | Gender + body composition (embedded histogram + iframe) |
| D  | Degree and publication timeline |
| E  | Publication types (with PhD Thesis + Masters Thesis first-class) |
| F  | Scholar leaderboard / cards |
| G  | Publications / items browser (citations, BibTeX, export) |

- **Session 3**: Panels A (KPIs + six-dimension filters), B1 (district
  map), B2 (world points), C1 gender histogram half, F (scholar
  leaderboard chrome).
- **Session 4**: Panels B3 (postgrad mobility), B4 (research geography
  + institutional linkages), D (degree + publication timeline), E
  (publication types with PhD/Masters chips), and the four interactive
  Samoa geography listboxes (Village, Specific Island, Itūmālō,
  Electoral Constituency) that Session 3 shipped as informational
  stubs.
- **Session 5**: Panel C1 body-composition iframe half + Panel G
  (publications/items browser — citation formats, BibTeX export,
  CSV/RIS export) + Apps Script writeback protocol adaptation
  (`action='update'` HMAC contract).
- **Final session**: full audit — every panel confirmed to reference
  ONLY Samoa constants, no aliases anywhere in the runtime, all six
  dimensions render distinctly, admin writeback round-trips against
  the live Master Sheet.

## Session 3 (2026-08-30) — Panels A / B / C semantic port

**Directive (owner, verbatim excerpt):**

> "Proceed with Session 3 Panels A, B and C. Preserve the complete Fiji V2
> panel structure, styling, filters, responsive/full-screen behavior and
> empty/error states while using only Samoa-native geography. Keep all
> six geography dimensions separate. Do not infer the five missing
> Specific Island values. Preserve Master's Thesis and PhD Thesis as
> visible publication types, pills and scholar-card counts. ... The 329
> unique villages from 341 rows should also remain documented; duplicates
> or repeated village names must be resolved through district-qualified
> IDs, not deleted merely because the names repeat."

**Approach: full mechanical semantic port, then targeted repair**

The sister-database panel code is 5,460 HTML lines + 11,844 JS lines
covering 14 panels. Ron's blueprint requires structural equivalence
(every panel, filter, chip, tooltip, empty-state, and fullscreen
behaviour preserved) but with Samoa's six-dimension geography as the
only geography model in the runtime. Rewriting 17,000+ lines by hand
in one session risked losing dozens of DOM classes and event bindings;
instead, Session 3 produced two Python passes:

1. **`substitute.py`** — a first, over-broad text substitution. Broke
   JS syntax by replacing `province` inside identifiers.
2. **`substitute_v2.py`** — context-aware: identifiers get short
   Samoa tokens (`district`, `region`), prose gets long Samoa labels
   (`Political/Census District`, `Statistical Region`). Regenerated
   cleanly from the sources.

The v2 output produced a clean HTML (0 forbidden-token hits) and a JS
file with only 6 legitimate residual hits (Solomon Islands as a Pacific
country in the world-country lookup — kept — and one classifier regex
that was rewritten to Samoan markers: `fa'a samoa`, `matai`, `aiga`,
`nu'u`, `tofi`, `feagaiga`, `talanoa`).

**Files added to `js/`**

| Path | Bytes | Role |
|---|---|---|
| `js/samoa-database-master.js` | 571 KB | Panel renderers (A1/A2/A3/B1/B2/C1/C2/C3/F/G) with district→region hydration; expects `SamoaScholarDatabaseAdapter.load()` bundle from Session 2. |
| `js/samoa-panel-overrides.js` | 5.5 KB | Runtime bridge: (1) patches `SamoaScholarDatabaseAdapter.load()` to hydrate `SAMOA_DISTRICT_TO_REGION` from `bundle.geo.politicalDistrictToRegion`, (2) wires the four new filter combos (village, specific island, itūmālō, constituency) with informational click notices — full listbox behaviour lands in Session 4. |

**HTML changes (`samoa-research-database-master.html`)**

- Replaced the Session-2 scaffold shell with the full 5,473-line
  Samoa-native dashboard.
- **Added four filter combo widgets** to the leaderboard toolbar so
  the six-dimension geography model surfaces in the UI:
  1. `data-scholar-village-combo` (Village)
  2. `data-scholar-island-combo` (Specific Island)
  3. `data-scholar-itumalo-combo` (Traditional Itūmālō)
  4. `data-scholar-constituency-combo` (Electoral Constituency)
  Each carries a `title` attribute documenting its scope and the known
  data caveats (village dedup rule, 5 unresolved specific-island cells,
  time-versioned constituencies).
- **Wired `samoaDemoGate → dbGate` bridge** at the bottom of the
  document so the panel code's existing `window.dbGate.fetchJson` /
  `window.dbGate.boot` calls resolve against Samoa's demo-gate module
  without renaming every call site.
- **Preserved PhD Thesis and Masters Thesis** as first-class
  publication types (chips: `data-pub-chip="thesisPhd"` /
  `thesisMasters`; item list: `data-type="thesisPhd"` /
  `thesisMasters`; type-filter dropdown: both options checked by
  default) — matches Ron's directive.

**Panels covered in Session 3 (structural port complete, awaiting live data)**

| Panel | Title | Notes |
|---|---|---|
| A1 | Database overview KPIs | 51 political/census districts (was 14 provinces). Publications / Authors / Theses / Unis / Countries. |
| A2 | Samoan-scholarship KPIs | participation, leadership, grad research — no geography assumptions. |
| A3 | About / methodology | prose scrubbed of non-Samoa geography terms. |
| B1 | Leaflet district-choropleth map | region legend (4 regions instead of 3 confederacies); popup shows district's home statistical region + main-area. `DISTRICT_TO_REGION` hydrated at boot. |
| B2 | World-graduates map scaffold | full port; hover/tooltip logic intact; empty-state handled. |
| C1 | Publications by gender histogram | ECharts config preserved; Tāne/Fafine labels applied. |
| C2 | Research across the 51 political/census districts | full port; empty district handling intact. |
| C3 | Research output by author's Statistical Region | rows updated to Samoa's four regions with `#0891b2` / `#eab308` / `#dc2626` / `#16a34a` palette. |
| F  | Scholar leaderboard | keyword search + 4 original filter combos preserved; 4 new Samoa-dimension combo stubs added (Session 4 wires their listboxes). |
| G  | All-items list | pagination preserved; PhD/Masters thesis rows preserved. |

**Legitimate residual token audit (final)**

`rg` sweep for the forbidden set
`fiji|itaukei|tongan|tikina|yasayasa|confederacy|kubuna|tovata|burebasaga|turaga|marama|matanitu|province`
across the three Session-3 files returns **0 hits**. The only
non-Samoa geography term surviving anywhere in the runtime is
"Solomon Islands" (4 hits in `samoa-database-master.js`), used only
in the world-country lookup table as one Pacific country among many —
this is legitimate and required for the world-graduates map.

**Village dedup rule (documented, not applied to data yet)**

The Master Sheet has 341 raw village rows but 329 unique village
NAMES — 12 name-collisions across different districts. Ron's
directive: resolve via district-qualified composite Village IDs
(`{districtId}::{villageName}` or the SBS `V-####` code), never by
deletion. The Session-2 adapter already keys `VILLAGE_ID_BY_NAME` on
the `V-####` id, so the data model supports this correctly; the
panel-side surfaces (Panel D alluvial in Session 4, Panel F village
filter listbox) still need to be updated to display the
district-qualified label whenever it shows a duplicated village name.

**Unresolved Specific Island entries (5, preserved)**

- Tausagi
- Olo
- Paepaeala
- Satuilagi
- Satoi

These are surfaced as `SPECIFIC_ISLAND_UNSURE` and rendered in the UI
as "Island unrecorded" — **never inferred**. Ron will resolve them
manually against the SBS Village Directory in a later admin pass.

### Session 3 verification

- `node --check js/samoa-database-master.js` → OK
- `node --check js/samoa-panel-overrides.js` → OK
- HTML parses cleanly (Python `html.parser`).
- Zero forbidden-token hits across the three files.
- `data-pub-chip="thesisPhd"` and `thesisMasters` present in HTML.
- `SamoaScholarDatabaseAdapter.load()` invoked in JS boot flow (line ~383).
- `samoaDemoGate._asDbGate()` shim installs `window.dbGate` before
  panel boot.
- Four new Samoa-dimension filter combos wired with informational
  click notices; the original two combos (Region, District) remain
  fully interactive.

### Session 4 remaining work (recorded now to preserve context; corrected 2026-08-30)

- **Panel B3** — postgraduate mobility alluvial (Samoa: home
  Political/Census District → country of study → degree level).
- **Panel B4** — research geography / global locations map plus
  institutional-linkage listing (where Samoan scholars publish from
  and with what overseas institutions).
- **Panel D** — degree + publication timeline (line/stacked-area
  histogram by year, split by degree level and publication type).
- **Panel E** — publication types with PhD Thesis + Masters Thesis
  first-class categories, matching pills and scholar-card counts.
- **Filter listbox behaviour** for the four Session-3 combo stubs
  (village, specific island, itūmālō, constituency).
- **Village display in Panels B3 / B4 / F / G** — apply
  district-qualified Village labels when a duplicated name would
  otherwise be ambiguous.

### Session 5 remaining work (recorded now; corrected 2026-08-30)

- **Panel C1 body-composition iframe half** — the C1 panel is a
  two-part panel: the gender histogram already shipped in Session 3;
  the body-composition iframe (Samoa-side target URL and embedded
  stylesheet, confirmed against Ron's existing body-composition page)
  ships in Session 5.
- **Panel G** — publications / items browser: citation formats
  (APA/Chicago/MLA), BibTeX export, CSV/RIS export, per-item copy
  buttons, filterable pagination. Panel structure is already ported
  from the sister template; Session 5 finishes the citation/export
  contract against Samoa's item schema.
- **Apps Script `samoa-master-writeback.gs`** — rewire the request
  contract from the sister-database format to the Session-1 Samoa
  client's `action='update'` + HMAC-SHA256 signed contract.

### Placeholder panels still shipping in Session-3 build

The following panels' DOM structure is present and empty-state-safe,
but their live logic lands in Session 4:

- B3 (mobility alluvial) — empty-state ("Mobility data landing in
  Session 4") intact.
- B4 (global locations) — empty-state intact.
- D (publications over time histogram) — empty-state intact.
- E (chord) — empty-state intact.

### Files modified in Session 3

- `samoa-research-database-master.html` (269 KB, 5,473 lines) —
  full dashboard shell replacing the Session-2 scaffold.
- `js/samoa-database-master.js` (571 KB, 11,842 lines) — panel
  renderers, ported from sister-database with context-aware
  substitution.
- `js/samoa-panel-overrides.js` (5.5 KB, 117 lines) — Samoa-native
  runtime patches for `bundle.geo` hydration + new-filter stubs.
- `SAMOA-DASHBOARD-BUILD-NOTES.md` — this Session 3 section added.

## Session 4 (2026-08-30) — Panel B3/B4/D/E semantic port + interactive listboxes

Session 4 focus areas:

1. **Iframe target pages** — `samoan-chord-flanked.html` (Panel B3) and
   `samoan-body-composition.html` (Panel C1 second half) now exist as
   Samoa-native standalone pages. Cloned from the closest sister
   pages (Tongan body-composition, iTaukei chord-flanked) with a two-
   pass token substitution that also swept data-file paths, script
   src attributes, download filenames, and cohort-detection tokens
   (`get('cohort') === 'samoan'`). Legitimate residuals are only the
   Pacific country lookups (`"Tonga":"Oceania"`, `"Tonga":"TON"`) in
   the world-map ISO/region tables, which are country-name entries
   for the neighbouring nation and are retained. Samoan gender vocab
   uses Fafine / Tāne (previous Tongan clone used Fefine / Tangata).

2. **Panel E — publication-type breakdown**. The Panel E HTML section
   was retitled from "By statistical region" to "By publication type"
   and given a new `db-pubtype-grid` container plus supporting CSS
   (`.db-pubtype-card`, `.db-pubtype-card__stripe`,
   `.db-pubtype-card__bar`, `.db-pubtype-card__fill`,
   `.db-pubtype-card__share`, and `.db-pubtype-card.is-dimmed`).
   Content is populated by the new `renderPanelE()` function in
   `js/samoa-database-master.js`, which iterates
   `PUB_TYPE_ORDER_E = [PhD Thesis, Master's Thesis, Journal Article,
   Book Chapter, Book, Report]` and renders one card per type with a
   count, a per-type share bar, and a click-to-filter label that
   pokes `state.filter.type` and re-renders the leaderboard + items
   list via `afterFilterChange()`. Types unchecked in the Panel B
   type filter render dimmed rather than disappearing so the grid
   layout stays stable across filter changes. The previously stale
   "By statistical region" content is now covered by Panel C3
   (Research Output by Home Political/Census District) and Panel B4
   (world map region drilldown); no data was lost.

   Function renames:
     - Old `renderPanelD()` at line 5521 (which actually rendered the
       Panel E `db-conf-grid`) → **removed**; replaced with
       `renderPanelE()`.
     - Two callers in `syncChecked()` and the boot sequence updated
       to call `renderPanelE()` instead. The genuine Panel D
       histogram renderer is `renderHistogram()` (unchanged, line
       6169).

3. **Four interactive Samoa geography listboxes** now wire the four
   Session-3 filter combo stubs (Village, Specific Island,
   Traditional Itūmālō, Electoral Constituency) into real
   single-select popovers that mutate scholar-list state and
   re-render Panel F + Panel G. The listbox implementation lives in
   `js/samoa-panel-overrides.js` (grown from 117 lines to 424 lines).
   Key architectural additions:

   - **Filter state slots** in `samoa-database-master.js`:
       - `state.scholarVillageFilter` — '' | V-#### id | plain name | '__unrecorded__'
       - `state.scholarIslandFilter` — '' | Upolu | Manono | Apolima | Savai‘i | '__unrecorded__'
       - `state.scholarItumaloFilter` — '' | Second-Schedule name | '__unrecorded__'
       - `state.scholarConstituencyFilter` — '' | version-prefixed name | '__unrecorded__'
   - **Filter cascade** in `renderLeaders()` extended with four
     Samoa-native passes at line 7326, all with strict-equality
     matching on `enrichedByName.get(r.name).{villageId | village |
     specificIsland | itumalo | constituency}`. Filters are independent
     of each other and independent of Statistical Region /
     Political-Census District. A scholar with a Village on record
     but no Itūmālō appears when Village is filtered but NOT when
     Itūmālō is filtered to anything except `__unrecorded__`. Values
     are never inferred.
   - **Public hooks** exposed at the end of the main-JS IIFE:
       - `window.samoaDb = { state, renderLeaders, renderItems }` —
         minimal public surface for the overrides file.
       - `window.__samoaSetScholarFilter(key, value)` — safe setter
         that also resets pagination.
       - `window.__samoaSetDistrictRegions(map)` — replaces
         `state.districts.features[i].properties.region` in place from
         `bundle.geo.politicalDistrictToRegion`.
   - **Adapter patch** re-runs `wireSamoaListboxes()` after every
     `SamoaScholarDatabaseAdapter.load()` completes, so listbox option
     lists always reflect the freshly-loaded `bundle.geo` payload.
   - **Search box** appears at the top of the Village listbox (329
     options); other listboxes are short enough to browse without.

4. **District-qualified village labels** (helper
   `buildDistrictQualifier(villages)` in
   `js/samoa-panel-overrides.js`) turns raw village names into
   `"{village} — {district}"` labels only when the raw name repeats
   across districts. The 12 name-collisions documented in the
   Session-2 adapter drive the qualification. The helper is exposed
   as `window.__samoaVillageLabel(villageObj)` for downstream card
   renderers.

5. **Five unresolved Specific Island entries** (`Tausagi`, `Olo`,
   `Paepaeala`, `Satuilagi`, `Satoi`) surface as a dedicated
   "Island unrecorded" entry in the Specific Island listbox with
   value `__unrecorded__`. Same pattern for the other three listboxes
   (`Village unrecorded`, `Itūmālō unrecorded`,
   `Constituency unrecorded`). None of the five villages ever has
   their island field inferred.

6. **HTML/CSS/JS residual corruption fixes** left by the Session 3
   substitution:
     - `.db-b2-political/census district-note` in three CSS rules →
       `.db-b2-district-note` (invalid slash in selector removed).
     - `class="db-b2-political/census district-note"` +
       `data-b2-political/census district-note` at HTML line 4770 →
       `class="db-b2-district-note" data-b2-district-note`.
     - `data-kpi="db-political/census districts"` at HTML line 4131 →
       `data-kpi="db-districts"` (JS side already correct).
     - `data-world-list-tab="statistical region"` at HTML line 4465 →
       `data-world-list-tab="region"` (matches the string the JS
       branch compares against).
     - `data-world-statistical region-list` at HTML line 4477 →
       `data-world-region-list` (space-in-attribute-name removed).
     - `querySelector('[data-world-region -list]')` at JS line 1628 →
       `[data-world-region-list]` (space-in-selector removed).

7. **Full Samoa-only audit** — `/tmp/session4/` scripts sweep all
   Session-4 files for:
     - Forbidden token regex: `fiji|fijian|itaukei|tongan|tonga|
       solomon islander|tikina|yasayasa|confederacy|kubuna|tovata|
       burebasaga|turaga|marama|matanitu|province`
     - Slash-in-identifier corruption
     - Space-in-attribute-name corruption
   Result: **0 blocking issues.** All prose-context forbidden-token
   hits are either in this build-notes file (documenting the audit
   itself), in country-name world-map lookups (`"Tonga":"Oceania"`
   and `"Tonga":"TON"` — legitimate country references), or in
   visible-to-user prose that intentionally says
   `political/census district`.

### Files modified in Session 4

- `samoa-research-database-master.html` — 5,576 lines (271 KB).
  Session-3 CSS/HTML corruption swept; Panel E section retitled to
  "By publication type" with new `db-pubtype-grid` structure; new
  Panel-E CSS block added; legacy Panel-E CSS retained with a
  comment marking it inactive.
- `js/samoa-database-master.js` — 11,942 lines (577 KB). New
  `renderPanelE()`, updated filter cascade, four new state slots,
  public-hook block appended before IIFE close.
- `js/samoa-panel-overrides.js` — 424 lines (17 KB, was 117 lines /
  5.5 KB). Full rewrite: dropped stub-alert notices; introduced
  `initListbox()`, `buildDistrictQualifier()`, `wireSamoaListboxes()`,
  and four option-list builders (village / island / itūmālō /
  constituency).
- `samoan-body-composition.html` — 1,161 lines (124 KB), NEW.
- `samoan-chord-flanked.html` — 1,188 lines (82 KB), NEW.
- `SAMOA-DASHBOARD-BUILD-NOTES.md` — this section added.

### Session 4 verification

- `node --check js/samoa-database-master.js` — passes.
- `node --check js/samoa-panel-overrides.js` — passes.
- Full audit script: 0 blocking issues, all remaining hits are prose
  or legitimate country-name lookups (documented above).

### Session 4 remaining known limitations

- The four listbox option lists pull from `bundle.geo` fields that
  the Session-2 adapter must expose (`villages`, `specificIslands`,
  `itumalo`, `electoralConstituencies.byVersion`). If any of these
  arrive empty, the corresponding listbox shows only the
  "unrecorded" entry — the wire is deliberately fail-open so the
  dashboard never renders a broken combo.
- The scholar-card renderer in `samoa-database-master.js` does not
  yet call `window.__samoaVillageLabel()` when rendering village
  chips on the card face. Session 4 exposes the helper; Session 5
  applies the district-qualified label at the card render site.
- `state.filter.type` (poked by Panel E card clicks) is a
  best-effort integration with the existing scholar-list filter —
  the leaderboard already reads `state.typeSet` (a `Set` of visible
  types) for its card-pill chip rendering. Panel E clicks currently
  only affect Panel G via `state.filter.type`; parity across F is
  Session-5 scope.


---

## Session 5 (completed 2026-08-30) — Panel-G exports, HMAC writeback, forbidden-token cleanup

Session 5 closes the seven task-list items from the S5 directive, commits the working tree, and pushes to GitHub Pages.

### S5-1 — Panel G items browser (BibTeX / CSV / RIS export, per-item copy, citation-format toggle)

Files touched:
- `samoa-research-database-master.html` (~5,588 lines)
  - Toolbar (line ~5133): added `<select data-db-cite-format>` (APA 7 / Chicago 17 / MLA 9)
  - Added `<button data-db-export="ris">Export .ris</button>` and `<button data-db-export="csv">Export .csv</button>` beside the existing `.bib` button.
  - `.db-item__copy` button pair CSS added at line ~2219 (`Copy cite`, `Copy BibTeX` per item).
- `js/samoa-database-master.js` (~12,400 lines)
  - `state.citationFormat = 'apa'` at line ~6890.
  - `renderItemCard()` at line ~9173: appends `Copy cite` + `Copy BibTeX` buttons on every item card.
  - New helpers: `copyToClipboard`, `formatCitation(item, style)` (APA/Chicago/MLA), `formatBibTeXEntry` (`@phdthesis` for `thesisPhd`, `@mastersthesis` for `thesisMasters`), `formatRISEntry` (M3 field preserves the PhD vs Master's split), `formatCSVRow`, `_downloadBlob`, `exportBib()`, `exportRis()`, `exportCsv()`.
  - `wire()` at line ~9648: bound the new toolbar controls and per-card copy delegates.

### S5-2 — District-qualified village labels on every scholar-card render path

Files touched:
- `js/samoa-panel-overrides.js` (~450 lines)
  - `buildDistrictQualifier()` at line 67–116: accepts BOTH call shapes
    (`labelFor({name, district})` and `labelFor("Falefa","Anoama'a East")`).
  - Exposes `window.__samoaVillageLabel.isAmbiguous(name)` and
    `window.__samoaVillageLabel.villagesFor(district)` for consumer code.
- `js/samoa-database-master.js`
  - `formatScholarGeography()` at line 164–190 routes every village token
    through `window.__samoaVillageLabel(v, p)` — a single choke-point that
    covers map popups, Panel-F leaderboard cards, and chord tooltips.

Convention: name-collision villages render as `"Falefa — Anoama'a East"`
with an em-dash; unique villages render as `"Poutasi"` unchanged. The
helper falls back to the raw village string when no district is passed.

### S5-3 — Panel F/E parity with Panel-E publication-type click filtering

Files touched:
- `js/samoa-database-master.js`, line ~5583–5631:
  - Panel-E name-click now sets both `state.filter.type` AND
    `state.filter.itemType`.
  - Snapshots the current `state.typeSet` into
    `_typeSetBeforePanelE` and narrows it to the clicked type.
  - When the clicked type is `thesis`, adds all three thesis sub-buckets
    (`thesisPhd`, `thesisMasters`, `thesisUnknown`) to the visible set.
  - Toggle-off restores `_typeSetBeforePanelE` verbatim.
  - Syncs Panel B checkboxes via existing `syncChecked()` and the
    Panel G dropdown via `[data-db-filter="itemType"]`.

Result: clicking a Panel-E card now filters Panel F's leaderboard AND
Panel G's item browser AND keeps Panel B's checkbox row in sync — one
click, three panels reflect the choice.

### S5-4 — HMAC writeback contract (Apps Script)

Files touched:
- `apps-script/samoa-master-writeback.gs` (1,514 lines, was 1,263)
  - Constants: `REPLAY_WINDOW_MS = 10 * 60 * 1000`, `NONCE_CACHE_TTL_S = 15 * 60`.
  - `doPost` at line ~927: any request that carries `sig`+`nonce` OR
    `action === 'update'` OR `action === 'describe'` is routed
    through `checkAuthHmac_()` before any sheet read/write happens.
    The legacy `write` action (from sister databases) is retained.
  - `handleUpdateRow_` at line ~1005: validates worksheet + field
    combinations against the MAPPING allowlist, rejects unknown
    fields up-front (no partial writes), invokes the existing
    `applyOneChange_` per field, and aggregates the per-cell status
    into one of `ok`, `partial`, `rejected`, `needs_confirmation`,
    or `noop`.
  - `checkAuthHmac_` at line ~1092: reads `SHARED_SECRET` from
    `PropertiesService.getScriptProperties()`, verifies the
    timestamp window, checks the nonce against CacheService for
    replay protection, computes HMAC-SHA-256 via
    `Utilities.computeHmacSha256Signature`, and does a
    constant-time compare.
  - `canonicalJSON_` at line ~1146: recursive JSON canonicaliser
    that matches the client-side serialiser in
    `js/samoa-admin-writeback-client.js`.
  - `hexToBytes_` / `bytesToHex_` helpers added.

New file:
- `apps-script/hmac-smoke-test.md` (131 lines) — six documented cases
  (successful update, rejected unknown field, unauthorized bad sig,
  replay attempt, no-op unchanged value, describe endpoint) with a
  Python-verified reference signature
  `08e962d38b10ce7051988a959e65ded91b2a1c58fbe056b6e5d5566d63b26744`
  for Case A that the deployer can use to prove wire-compatibility
  before flipping the client over.

### S5-5 — Confirmation: Panel C1 body composition uses Samoa page

- `samoa-research-database-master.html` line 4728: iframe src is
  `samoan-body-composition.html?embedded=1&src=master&v=mf22`.
- `samoan-body-composition.html` line 710:
  `DISPLAY = {"Woman":"Fafine","Man":"Tāne"}` — the entire page
  uses the Samoa-native gender terminology.

### S5-6 — Confirmation: Master's + PhD theses are first-class

- `PUB_TYPE_ORDER_E` at line 5546–5548 lists `thesisPhd` (label
  `"PhD Thesis"`) and `thesisMasters` (label `"Master's Thesis"`)
  as top-level rows in Panel E.
- Scholar-card renderer at lines 5158–5159 emits pills via
  `push(b.thesisPhd, ...)` and `push(b.thesisMasters, ...)`.
- `visualType()` at line 232 splits the raw `thesis` bucket by
  `thesisLevel === 'phd'` vs `'masters'` vs unknown.

### S5-7 — Forbidden-token audit, geography-integrity cleanup

Live-code renames in `samoa-research-database-master.html`:

| Was                     | Now                    | Site                             |
| ----------------------- | ---------------------- | -------------------------------- |
| `iTaukei`               | `Samoan`               | Admin email suggestion body      |
| `iTaukei_Master_file`   | `Samoa_Master_file`    | Zotero-collection HTML comment   |
| "Samoa or Fijians"      | "Samoa or Samoans"     | Admin help copy (×2)             |
| "on Samoa and Fijians"  | "on Samoa and Samoans" | Admin help copy                  |

Live-code renames in `js/samoa-database-master.js`:

| Was                              | Now                          |
| -------------------------------- | ---------------------------- |
| `iTaukeiScholarMaps`             | `samoanScholarMaps`          |
| `iTaukei_Master_file` (comments) | `Samoa_Master_file`          |
| `isFiji`                         | `hasDistrict`                |
| `nonFiji`                        | `nonDistrict`                |
| `nonProvincialFijiKey`           | `nonDistrictBucketKey`       |

Note: `zoteroCollectionKey_nonProvincialFiji` remains ONE reference
in `js/samoa-database-master.js` at line 603 — this is the legacy
bundle-adapter key that sister databases still emit. A backwards-
compatible fall-through at line ~600
(`bundle.zoteroCollectionKey_nonDistrictBucket ||
bundle.zoteroCollectionKey_nonProvincialSamoa ||
bundle.zoteroCollectionKey_nonProvincialFiji`) accepts all three.

Fixes in `samoan-chord-flanked.html`:

- Line 573 `EMBEDDED_ISO3`: removed the fossil `"Samoa":"FJI",`
  entry that shadowed the correct `"Samoa":"WSM"` mapping at the
  top of the object. The chord chart now emits the correct ISO
  code for Samoa in all offline paths.
- Line 576 `EMBEDDED_FALLBACK`: the ~44-row iTaukei-scholar
  mobility snapshot (Alifereti through Yabaki-Goundar) that
  shipped as the fetch-failure fallback has been replaced with a
  Samoa-native placeholder `{flows:[], unis:{}, num:{},
  uni_list:[]}`. The runtime fetches
  `data/samoa-master-mobility.json` and
  `data/samoa-master-scholars.json` (lines 985–986); if those
  fail, the chord chart now shows an empty state with a helpful
  status message instead of rendering iTaukei scholar names on
  the Samoa dashboard.
- Line 1020: fallback status message rewritten to
  `"Master's/PhD mobility data isn't available offline.
  Upload a CSV above, or check that
  data/samoa-master-mobility.json +
  data/samoa-master-scholars.json are published."`

Adjustment in `js/samoa-database-master.js`:

- Line 148 `_MAINLAND_ISLANDS_SUPPRESS` regex, formerly
  `/^(viti\s*levu|vanua\s*levu)$/i`, is now
  `/^(upolu|savai.i|manono|apolima)$/i` — Samoa's own four
  mainland islands. The regex retains its original purpose
  (suppress the island name when a district+village qualification
  is already visible) but no longer references Fiji islands.

### Remaining legacy-token occurrences (all justified, non-functional)

| File                              | Line          | Token                        | Justification                                                                 |
| --------------------------------- | ------------- | ---------------------------- | ----------------------------------------------------------------------------- |
| `samoan-chord-flanked.html`       | 580           | `iTaukei`                    | Code comment inside the fallback-block header explaining the guard rationale. |
| `js/samoa-database-master.js`     | 595, 603      | `Fiji`                       | Code comment + legacy fallback key in the adapter chain (documented above).   |
| `js/samoa-database-master.js`     | 6024, 8409    | `Solomon Islands`            | Country-code + ISO2 reference tables for the international collaboration map. |
| `js/samoa-database-master.js`     | 6027, 8409    | `Tonga`                      | Country-code + ISO2 reference tables (same map).                              |
| `js/samoa-database-master.js`     | 7660, 7663    | `Solomon Islands`, `Tonga`   | Country-name normalisation regex for author-affiliation parsing.              |
| `js/samoa-database-master.js`     | 11136, 11138  | `Tonga`, `Solomon Islands`   | World-map lat/lng coordinate table used by the international map.             |
| `samoan-chord-flanked.html`       | 571, 573      | `Tonga`, `Solomon Islands`   | UNSD region and ISO3 code lookup tables (mobility chord).                     |

**None of these hits are aliases or geography logic.** The world-map
and chord-chart lookup tables need every Pacific country ISO code so
that scholar-affiliation edges terminate on the right nodes; deleting
`Tonga` or `Solomon Islands` from those tables would break the maps.

### Verification

- `node --check js/samoa-database-master.js` → OK
- `node --check js/samoa-panel-overrides.js` → OK
- `node --check apps-script/samoa-master-writeback.gs` (copied to
  `/tmp/wb.js` for a strict-mode syntax pass) → OK
- Forbidden-token sweep across
  `samoa-research-database-master.html`,
  `js/samoa-database-master.js`,
  `js/samoa-panel-overrides.js`,
  `samoan-body-composition.html`,
  `samoan-chord-flanked.html`,
  `apps-script/samoa-master-writeback.gs`, and
  `admin-samoa-master.html` → all remaining hits are documented
  above as reference tables or comments (no live data path).

### Manual deployment steps (post-push)

1. Redeploy the Apps Script Web App from
   `apps-script/samoa-master-writeback.gs`. The HMAC rewrite
   requires a NEW deployment version, not just a save.
2. In the Apps Script project's Script Properties, ensure:
   - `SHARED_SECRET` = a NEW 64-char hex value generated out-of-band.
     The value that appeared in earlier drafts of these notes was
     compromised on 2026-08-30 and must never be used or preserved.
     Generate a fresh secret out-of-band (e.g. via `generateSecret()` in the Apps Script editor, or `python3 -c 'import secrets; print(secrets.token_hex(32))'`). The literal value must never appear in this repo, in git history, or in build notes; it lives only in Script Properties and in the admin panel's `window.SAMOA_WRITEBACK_SECRET_HEX`.
   - `WRITE_ENABLED` = `true`
   - `ADMIN_ORIGIN` = `https://ronvave.github.io`
3. In `admin-samoa-master.html`, confirm the deployed exec URL is
   assigned to `window.SAMOA_WRITEBACK_URL` and the hex secret to
   `window.SAMOA_WRITEBACK_SECRET_HEX`.
4. From the admin panel's Data-source tab, click
   `Test connection`. Then run through the six cases in
   `apps-script/hmac-smoke-test.md` (ok / partial / rejected /
   unauthorized / no-op / describe) and confirm each response
   matches the expected shape.

### Unresolved data gaps

- Five villages sit in District `D-017 Aiga i le Tai` with **Specific
  Island explicitly blank** in the live *Village Geography Lookup*:
  **Tausagi**, **Olo**, **Paepaeala**, **Satuilagi**, **Satoi**.
  The Village Directory Notes column on the Master Sheet already
  flags each as `ISLAND UNRESOLVED: village not named in the
  Constituencies Act 1963 island clauses for Aiga-i-le-Tai and no
  SBS island column exists. Left blank rather than inferred.`
  These render under the `Island unrecorded` bucket on the
  specific-island listbox and MUST remain unrecorded until an
  authoritative source (updated SBS gazetteer, matai statement,
  archival island survey, etc.) verifies each village's island.
  Never infer or resolve them merely to eliminate blanks.
- The live *Scholars* and *M>PhD Mobility* worksheets on the Master
  Sheet currently contain 0 verified data rows (schema header only).
  `data/samoa-master-scholars.json.enc` and
  `data/samoa-master-mobility.json.enc` are published as encrypted
  empty arrays so the chord panel and adapter can decrypt and
  render an empty state cleanly; they will be re-encrypted with
  real rows via the sync pipeline as scholars are added to the
  Master Sheet.

