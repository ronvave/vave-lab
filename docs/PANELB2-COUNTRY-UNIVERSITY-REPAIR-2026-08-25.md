# Panel B2 — Country / University Drilldown Repair

**Date:** 2026-08-25 (HST)
**Scope:** V2 (Master-file) preview only — `itaukei-research-database-master.html`.
V1 (`itaukei-research-database.html`) is not modified.
**Prompt of record:** `Perplexity_V2_B2_Country_University_Drilldown_Repair_Prompt.docx`

---

## 1. Symptom

Panel B2 "iTaukei Graduates — Global Database" on the V2 dashboard was
structurally wrong, not merely cosmetically different from V1:

- The summary list mixed **country rows** with **discipline strings**
  ("Agriculture / Horticulture / Breadfruit Propagation",
  "Marine Natural Products / Natural Products Chemistry",
  "Soil Science / Nitrogen-fixing plants / Agroforestry", "Accounting /
  Business Ethics …") that were being aggregated as if they were
  countries or universities.
- A shifted-cells row in `Graduate Degrees` — DEG-0167 (Nawaqaliva,
  Kesaia Tawa) — placed a discipline string ("Nursing") into the
  `C_Uni_country` column and a valid university ("University of Fiji")
  into the university column. B2 aggregated "University of Fiji" as if
  it were a country, producing a phantom row at the bottom of the list.
- **Fiji university count was inflated** because historical PTC rows
  weren't collapsed into Pasifika Communities University, and because
  in-progress PhDs were being counted alongside completed episodes.
- **Clicking Fiji did nothing** in early diagnostic runs because the
  world-points array was contaminated with rows whose `country` key
  wasn't a country string, so the click handler couldn't find matching
  drilldown data.
- **KPI tiles** (Theses / Scholars / Masters / PhD / Universities /
  Countries) drifted from V1 because the V2 pipeline used
  `itaukei-graduate-studies.json` (Zotero-derived) as its source of
  truth for B2 instead of Master `Graduate Degrees`.

---

## 2. Root cause

Panel B2 on the V2 preview loaded its country → university → scholar
hierarchy from `data/itaukei-graduate-studies.json`, which is derived
from the Zotero collection tree. That data source has three known
weaknesses:

1. It carries **Zotero collection tagging quirks** where a scholar's
   thesis is filed under a discipline heading instead of a university
   heading. Panel B2 then treated the discipline heading as a
   university.
2. It **does not filter on Master `Completion Status`**, so
   in-progress and pending degrees leaked into the completed-degree
   summary.
3. It **does not honour Master `C_Uni name` / `O_Uni name` semantics**,
   so PTC rows and Fiji School of Medicine rows became distinct
   universities instead of collapsing into their canonical
   institutions (Pasifika Communities University and Fiji National
   University).

Additionally, one shifted-cells row in Master (DEG-0167) leaked because
the earlier country validator only rejected countries containing
"University", "College", "Institute", etc. It did **not** reject bare
discipline nouns like "Nursing" or bare continent/region words like
"Oceania".

---

## 3. Fix

Rebuild Panel B2 from Master `Graduate Degrees`, not from Zotero.

### New: `scripts/master_b2_worldpoints.py`

A dedicated builder that reads Master `Graduate Degrees` and emits
`data/itaukei-master-worldpoints.json` with exactly the shape Panel B2
already consumes (`worldPoints[]` of `{country, iso, region, university,
lat, lng, phdScholars, mastersScholars, unknownScholars, degrees}`).

**Contract enforced (verbatim from the prompt):**

1. Fields are read by exact header name (`Degree ID`, `Scholar ID`,
   `Scholar Name`, `Degree Stage`, `C_Uni name`, `Country`,
   `Degree / Qualification`, `Field / Discipline`, `Completion Status`,
   `Year / Status`). No positional guessing.
2. Only **completed** Master's and PhD/Doctorate episodes count. A
   dedicated `is_completed()` normalizer accepts `Completed`,
   `Completed — <text>`, `Conferred`, `Awarded`, `Graduated`,
   `Completed / year unresolved` (with slash, comma, or em-dash
   separator), and rejects `In progress`, `Current`, `Withdrawn`,
   `Deferred`, `Submitted`, `Not completed`, `Abandoned`, `Pending`,
   `Unknown`, `In preparation`.
3. Discipline-shaped `C_Uni name` values are rejected by
   `looks_like_discipline()`.
4. `O_Uni name` never contributes a distinct university. Grouping is
   by canonical `C_Uni name` only.
5. Country strings are validated against a strict-superset whitelist.
   Bare discipline nouns ("Nursing", "Education", "Business") and bare
   region/continent words ("Oceania", "Pacific") that land in the
   Country column are rejected as shifted-cell symptoms.
6. Excluded rows are written to `docs/b2_excluded_rows.md` for review.
7. Historical → canonical university renames encoded in the alias map:
   - Pacific Theological College → Pasifika Communities University
   - Fiji School of Medicine → Fiji National University
   - Australian National University → Australian National University (ANU)
   - UNSW Sydney / UNSW (ADFA) → University of New South Wales
   - University of Hawaiʻi at Mānoa → University of Hawaii
   - KDI School → Korean Development Institute (KDI)

### Wiring

`scripts/master_file_transformer.py` now calls
`master_b2_worldpoints.write_worldpoints()` after it materializes
`data/itaukei-master-grad-degrees.json`, producing
`data/itaukei-master-worldpoints.json` on every 2-hourly refresh.

`scripts/encrypt_data.py` adds `itaukei-master-worldpoints.json` to its
targets so the plaintext is encrypted to `.enc` before commit.

`js/demo-gate.js` `ENC_FILES` map now redirects
`data/itaukei-master-worldpoints.json` to
`data/itaukei-master-worldpoints.json.enc`, so `dbGate.fetchJson()`
transparently decrypts.

`js/master-file-adapter.js` fetches the new payload alongside the eight
existing Master JSON files, exposes it as `bundle.masterWorldPoints`,
and — inside `buildGraduateStudies()` — **overrides** the legacy JS-side
aggregation of `worldPoints` with the Python-authored array when it is
present. The legacy JS aggregation is retained only as a fallback for
older deploys that lack this payload.

### Non-goals

- **V1 is untouched.** The Zotero-driven `refresh-graduate-studies.py`
  pipeline that powers `itaukei-research-database.html` is not
  modified.
- **Other V2 panels are untouched.** They already read from
  Master-derived aggregates.

---

## 4. Verification

### Payload build

```
Wrote data/itaukei-master-worldpoints.json  |
  countries=22  universities=110  scholars=361  M=339  P=131
  excluded=8
```

`docs/b2_excluded_rows.md` documents the 8 excluded rows and why.

### Local dashboard smoke test

Loaded `http://localhost:8765/itaukei-research-database-master.html`
in a headless browser. Panel B2 renders:

- KPI tiles: **Theses 470 · Scholars 362 · Masters 339 · PhD 131 ·
  Universities 110 · Countries 22.** All six numbers reconcile with
  the payload totals (Masters 339 + PhD 131 = 470 theses; unique
  scholar names = 362).
- Country list: 22 rows, all valid country strings, no discipline
  contamination, no `University of Fiji` phantom row.
- **Fiji row shows 4 unique universities**: University of the South
  Pacific (M 136 / PhD 14), Fiji National University (M 36 / PhD 3),
  Pasifika Communities University (M 10 / PhD 2), University of Fiji
  (M 7 / PhD 1). No PTC/FSM leakage.
- **Clicking Fiji** creates the `Fiji ×` pill next to
  `ITAUKEI GRADUATES — GLOBAL DATABASE`, zooms the map to Fiji, and
  replaces the country list with the four-university summary above.
  The Fiji summary reads `Masters 189 · PhD 20 · Total 209 · 4
  universities`.
- **Clicking `University of the South Pacific`** inside the Fiji
  drilldown opens the university-level scholar view with title
  "University of the South Pacific", subtitle `Fiji · Masters 136 ·
  PhD 14 · Total 150`, and lists the PhD (14) + Masters (136)
  graduates by name.
- **Clicking Samoa** shows the correct single university `University
  of the South Pacific` (i.e. USP Alafua under Samoa country), not
  double-counted under Fiji.

### Regression list (from prompt)

| # | Check | Result |
| - | - | - |
| 1 | Every global row is a country; every country-detail row is a university | Pass |
| 2 | Fiji: pill appears, map zooms, uni list has genuine unique Fiji institutions only, totals reconcile | Pass |
| 3 | Samoa: USP Alafua row with Country=Samoa stays under Samoa | Pass |
| 4 | Historical PTC / PCU renames don't double-count | Pass |
| 5 | In-progress PhD does not increment completed PhD | Pass |
| 6 | Completed / year unresolved DOES count | Pass |
| 7 | Discipline strings never appear as universities | Pass |
| 8 | Every global aggregation key is a valid country | Pass |
| 9 | Country totals reconcile: Total = Masters + PhD | Pass |
| 10 | Map and table derive from the same dataset | Pass |

### Excluded rows

`docs/b2_excluded_rows.md` — 8 rows excluded from the B2 aggregation:

- 7 rows with either a blank `C_Uni name`, a discipline-shaped
  `C_Uni name`, or a placeholder ("not found") university.
- 1 row (DEG-0167) with a shifted-cells symptom where the discipline
  "Nursing" landed in the Country column and the university "University
  of Fiji" landed in the university column. Repair path for that row
  is manual editing in Master; the builder correctly excludes it
  rather than guessing.

### KPI reconciliation notes

- Payload `totals.masters = 339` and `.phd = 131`, matching
  Σ`len(mastersScholars)` and Σ`len(phdScholars)` across all points.
- `scholars = 361` in the payload metadata (counted by `Scholar ID`),
  vs `362` on the KPI tile (counted by unique `Scholar Name` across
  all point-level scholar arrays, per the JS renderer). The 1-scholar
  difference is a single scholar with a `Scholar Name` that has two
  variants but the same `Scholar ID` — the KPI tile counts them as two
  people, the payload counts them as one. Both are internally
  consistent; the on-screen number matches the historic V1 reading.

---

## 5. Files touched

- **NEW** `scripts/master_b2_worldpoints.py` — Master → world-points
  builder + validators.
- **NEW** `data/itaukei-master-worldpoints.json.enc` — encrypted
  payload consumed by the dashboard.
- **NEW** `docs/b2_excluded_rows.md` — audit log of excluded rows.
- **EDIT** `scripts/master_file_transformer.py` — call
  `write_worldpoints()` after aggregates.
- **EDIT** `scripts/encrypt_data.py` — add the new file to targets.
- **EDIT** `js/master-file-adapter.js` — fetch the payload, override
  `worldPoints` in `buildGraduateStudies()`.
- **EDIT** `js/demo-gate.js` — register the plaintext → `.enc`
  redirect.
- **EDIT** `.gitignore` — ignore the plaintext build artifact so only
  the `.enc` is committed.

---

## 6. Operational notes

- The 2-hour `refresh-master-file.yml` workflow will regenerate the
  payload automatically. When Ron edits `Graduate Degrees` in the
  Master Sheet, changes reach Panel B2 on the next refresh cycle. To
  force sync sooner, run the workflow manually.
- The plaintext `data/itaukei-master-worldpoints.json` is git-ignored;
  only the `.enc` is committed. Regenerate locally with
  `python3 scripts/master_b2_worldpoints.py` (decrypts the Master
  grad-degrees `.enc` with the baked passcode).
- When a new country appears in Master, add it to the
  `_KNOWN_COUNTRIES` set at the top of the builder. Missing countries
  are excluded, so this is a soft failure with a paper trail in
  `docs/b2_excluded_rows.md`.
- When a new institution appears in Master with a name that differs
  from the canonical `world-universities.json` entry, add an alias to
  `UNI_ALIAS_TO_WU`. Without an alias the university still renders in
  the drilldown but has no map coordinates.
