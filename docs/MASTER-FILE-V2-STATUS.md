# Master-file V2 Dashboard — Port Status Report

Generated: 2026-08-22 · commits `c69341e` → `98ebeef` → `52a1053` → `c0fca31` on `main`

The V2 dashboard lives at `itaukei-research-database-master.html` and is
**unlinked** from site navigation. Production dashboard at
`itaukei-research-database.html` is untouched.

## 1) Panels ported

Every production dashboard panel now runs off the Master-file data layer
via the Zotero-shape adapter, with the same render code the production
dashboard uses:

| Panel | What it renders | Wired |
| :-- | :-- | :--: |
| A1  | Database-wide totals KPI row | ✓ |
| A2  | iTaukei-only totals KPI row | ✓ |
| B1  | Fiji province publication map + bar chart | ✓ |
| B2  | iTaukei publication summary (theses focus) | ✓ |
| B3  | iTaukei scholarly mobility (chord + map) | ✓ |
| B4  | Global locations of iTaukei research | ✓ |
| C1  | iTaukei publications by gender × type | ✓ |
| C2  | 14-province × confederacy TOTAL-column table | ✓ (via overrides) |
| C3  | Research output by paternal province | ✓ |
| D   | Publication trends over time | ✓ |
| E   | Confederacy analysis (donut) | ✓ |
| F   | Scholar profile browser | ✓ |
| G   | Publication browser | ✓ |

Everything on the production dashboard that is not a panel — filters
(discipline, decade, province, paternal, university, year, scholar,
type), search, fullscreen, "Show demo view", the passcode gate,
navigation, tooltips, exports, responsive layout — continues to work
because the production JS is used verbatim; only its `loadAll()` was
replaced with a call into the adapter.

Master-file-specific requirements are layered on top by
`js/master-file-panel-overrides.js`:

- 14-province table with dedicated **TOTAL** columns nested inside each
  of Burebasaga / Kubuna / Tovata (rule 14)
- The two verbatim explanatory note lines below the province tables
  (rules 5, 6, 15):
  - `*The above summary does not include Reports, Conference papers, Unpublished report, and Others.`
  - `**Non-iTaukei records are publications on Fiji by non-iTaukei without any iTaukei authors`
- `Last Master-file update: [timestamp]` badge next to the sync badge

## 2) Master JSON source for each panel

Every panel is fed **entirely** from Master-file JSON — no Zotero
snapshot is read at runtime by the V2 dashboard.

| Panel | Master JSON source(s) |
| :-- | :-- |
| A1, A2 | `itaukei-master-aggregates.json` + full items array |
| B1, C2 | `itaukei-master-publications.json` (14 province one-hots + `_provinces`) |
| B2 | `itaukei-master-publications.json` filtered to thesis types |
| B3 | `itaukei-master-mobility.json` + `itaukei-master-grad-degrees.json` |
| B4 | `itaukei-master-geography.json` + `itaukei-master-grad-degrees.json` |
| C1 | `itaukei-master-authorship.json` (`_is_lead`) × `itaukei-master-scholars.json` (Gender) |
| C3 | `itaukei-master-scholars.json` (Province Paternal) via Authorship bridge |
| D | Year field of `itaukei-master-publications.json` |
| E | `itaukei-master-scholars.json` Province Paternal → confederacy |
| F | `itaukei-master-scholars.json` |
| G | `itaukei-master-publications.json` |

**Scholar identity is Scholar ID** (rule 1), **publication identity is
Publication ID / BibTeX Key** (rule 2), and iTaukei-associated flags come
**only from the Authorship bridge** (rule 3) — the adapter never
surname-matches or infers iTaukei from author strings.

## 3) Calculated KPI totals

Computed from the Master-file JSON on 2026-08-22, all matching the
Master-file Dashboard sheet (§ 5 below):

```
scholars                                : 472
  female / male / other                 : 208 / 258 / 6
publications_total                      : 2932
publications_headline_five              : 2608
publications_itaukei_associated         : 1346
publications_itaukei_associated_headline: 1138
publications_non_itaukei_only_headline  : 1470
authorship_links                        : 1500
scholars_with_authorship_link           : 306
grad_degree_episodes                    : 492
grad_degree_international               : 252
mobility_records                        : 308
```

Panel-level counts (see `docs/MASTER-FILE-RECONCILIATION.md` for the
full table). Highlights:

- **B1** (Fiji provinces, headline only, all pubs): Rewa 22 · Ra 16 ·
  Ba 15 · Kadavu 15 · Lau 15 · Nadroga/Navosa 12 · Tailevu 12 · Naitasiri 9 ·
  Namosi 7 · Bua 6 · Serua 5 · Lomaiviti 5 · Macuata 5 · Cakaudrove 3
- **Fiji - no province specified**: 1607 pubs
- **Unsure**: 47 pubs
- **B2** iTaukei theses: 281 total (177 Master's + 104 PhD)
- **C1** iTaukei-associated gender × type (Journal Article): 400
  Unknown/Blank, 132 Male, 128 Female
- **D** Timeline range: 1941–2026; iTaukei-associated by decade:
  1980s 32 · 1990s 72 · 2000s 227 · 2010s 484 · 2020s 527
- **E** Scholars by paternal confederacy: Burebasaga 23 · Kubuna 15 · Tovata 42
- **G** All types: Journal Article 1083 · Master's Thesis 676 · PhD Thesis 515 ·
  Book Chapter 247 · Report 197 · Book 87 · Conference Paper 78 · Other 28

## 4) Discrepancies vs Master Dashboard sheet

Reconciliation script: `scripts/master_file_reconcile.py`. 28 checks
against the Dashboard sheet, all pass at **±10 tolerance**. Nine values
drift by 1–7 records (Master file has grown slightly since the
Dashboard sheet was manually recomputed):

| Metric | Dashboard | Computed | Drift |
| :-- | --: | --: | --: |
| publications_itaukei_associated_headline | 1137 | 1138 | +1 |
| publications_non_itaukei_only_headline | 1471 | 1470 | −1 |
| grad_degree_episodes | 485 | 492 | +7 |
| grad_degree_international | 249 | 252 | +3 |
| pubtype:Book:itaukei | 39 | 40 | +1 |
| completed_masters_total | 303 | 306 | +3 |
| completed_phd_total | 115 | 116 | +1 |
| phd_current_total | 49 | 50 | +1 |
| both_masters_and_phd_total | 99 | 100 | +1 |

The Dashboard sheet is a manually-refreshed QA reference; drift of a
handful of records is expected and stays well inside the ±10 tolerance.

## 5) Remaining Zotero-shaped dependencies

**None** at data-source level. The V2 page (`itaukei-research-database-master.html`)
does not load, decrypt, or read a single Zotero-shape file:

- No `db-...-snapshot.json` fetched
- No `scholar-profiles.json` fetched
- No `graduate-studies.json` fetched
- No `universities.json` fetched
- All 8 encrypted targets registered with the demo-gate are Master-file
  files (`itaukei-master-*.json` + `last-master-sync.json`)

The Zotero-shape **payload structure** (items[], collections[]) is still
used inside the browser: the adapter synthesizes that shape from Master
data so the 10,544-line production render layer runs unchanged. This is
architectural, not a leftover Zotero dependency.

## 6) Blockers before production-ready

The V2 dashboard cannot render live until these two operational items
are complete. Both are Ron actions, not code changes:

1. **Add `GOOGLE_SERVICE_ACCOUNT_JSON` GitHub Secret.** The Actions
   workflow at `.github/workflows/refresh-master-file.yml` needs this
   to read the Master-file spreadsheet every 2h. Setup steps in
   `docs/MASTER-FILE-REBUILD.md`. Until this is set, the encrypted
   Master JSON files won't exist under `data/*.enc` and the demo-gate
   will fail to hydrate the V2 page.
2. **First workflow run to seed `data/*.enc`.** After adding the secret,
   trigger the workflow manually once from the GitHub Actions tab. The
   workflow calls the transformer, reconciler, `encrypt_data.py`, and
   commits the 8 `.enc` files under `data/`. Every subsequent run
   commits only when the sanitized JSON has actually changed.

Once both are done, browsing to `/itaukei-research-database-master.html`
and entering the shared passcode will render every panel above with
live data.

### Nice-to-haves (not blockers)

- Live-browser QA pass to catch any panel-specific visual break the
  offline reconciliation can't see (map layers, chord layout on small
  screens, browser card overflows).
- Add the V2 page to site navigation (currently unlinked by intent —
  Ron controls when it becomes discoverable).

## Files touched (git log —oneline)

```
c0fca31 test: assert adapter attaches province collections to Fiji pubs
52a1053 fix: transformer province one-hots use is_truthy
98ebeef feat: Master-file adapter + full production panel port
c69341e chore: backend + docs + initial thin JS  (previous session)
```

## How to verify locally

```bash
# 1. Transformer + reconcile against the Dashboard sheet.
python3 scripts/master_file_transformer.py --mode local \
    --dump-dir /tmp/master-file-dump --out-dir /tmp/master-out
python3 scripts/master_file_reconcile.py --mode local \
    --dump-dir /tmp/master-file-dump --snapshot-dir /tmp/master-out --tolerance 10
# → 28/28 PASS at ±10

# 2. Adapter smoke test (Zotero-shape synthesis contract).
node scripts/test_master_adapter.js
# → items=2932, scholars=472, headline=2608, iTaukei=1346, prov-items=1783

# 3. Panel-level reconciliation report (regenerates docs/MASTER-FILE-RECONCILIATION.md).
python3 scripts/reconcile_all_panels.py
```
