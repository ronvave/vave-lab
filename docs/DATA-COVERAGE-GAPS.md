# Data coverage — new countries, universities, and panel propagation

Single source of truth for **what happens when a new country or
university enters the iTaukei Zotero group**, how the pipeline resolves
it, which panels display it, and how to fix things when it doesn't.

Ron's mandate driving all of this:

> "Allow the backend system to automatically search for new country
>  ISO code, and also university website and its location, without
>  requiring input from you."

**No engineer intervention should be required for a new country or
university under normal operation.** The auto-resolver and E2E test
enforce that promise.

Search this doc by section heading (`## …`). Sections:

1. Zotero as the source of truth
2. The 3-hour refresh pipeline
3. Auto-resolver (`data/auto_resolve.py`)
4. E2E test + CI heartbeat
5. Panels that update automatically
6. Where the hardcoded mappings live
7. How the script surfaces residual gaps
8. Coordinate sources for manual pins
9. Auditing what's currently mapped
10. Force-sync recipe
11. When to still touch code
12. Historical incidents

---

## 1. Zotero as the source of truth

1. Ron files a new thesis in the iTaukei Zotero group under
   **`Thesis / B2-iTaukei Thesis by Country/Universities / <Country> /
   <University>`**. Country and university collections are created in
   Zotero if they don't exist yet.
2. The thesis item's `collections` array must include the university
   collection key. That's how the refresh script links thesis →
   university → country → world-map bubble.

That's it — no config files, no separate spreadsheet, no code change.

---

## 2. The 3-hour refresh pipeline

`.github/workflows/refresh-zotero-snapshot.yml` runs **every 3 hours**
(and on manual dispatch). It:

1. Downloads the Zotero group into
   `data/itaukei-zotero-snapshot.json`.
2. Runs `data/refresh-graduate-studies.py`, which:
   1. Walks the country / university tree (root key `9XHGQJE6`).
   2. For each thesis, resolves the country and the university.
   3. **Checks the hardcoded dicts first** — `COUNTRY_ISO`,
      `COUNTRY_REGION`, `UNIVERSITY_COORDS` in
      `data/refresh-graduate-studies.py`. Those always win.
   4. **For any residual gap, runs the auto-resolver** (section 3).
   5. Emits `data/itaukei-graduate-studies.json` with:
      - `worldPoints[]` (one entry per country + university bubble),
      - `scholars{}` (roster keyed by canonical name),
      - `totals` (theses, scholars, universities, countries),
      - `autoResolved` (provenance for anything the resolver filled
        in).
3. Re-encrypts `data/*.json` and commits the updated `.enc` blobs.
4. GitHub Pages rebuilds from `main` and every panel reloads on the
   next page view.

**All panels update every 3hrs, or during forced sync** — repeat this
instruction for all panel sync every time there's a refresh. There is
no per-panel schedule and no partial refresh.

---

## 3. Auto-resolver (`data/auto_resolve.py`)

Runs only when a gap exists AND `VAVELAB_DISABLE_AUTO_RESOLVE` is
unset. Resolvers, tried in order per gap:

| Gap | Source | Notes |
|-----|--------|-------|
| Country → ISO2 + region | World Bank public API (`api.worldbank.org/v2/country`) | No key. Bulk 295-row fetch, one hit per run. Alias map handles Zotero-friendly names (USA, UK, Russia, South Korea, …). |
| University → lat / lng | Wikipedia REST page-summary (`en.wikipedia.org/api/rest_v1/page/summary/{title}`) | Direct title match first. |
| University → lat / lng | Wikipedia OpenSearch → summary | Fallback for variant names. |
| University → lat / lng | OpenStreetMap Nominatim | Last resort. 1 req/sec rate-limited by the module. Descriptive User-Agent set. |

Rules:

- **Hardcoded dicts always win** — pin canonical spellings /
  hand-verified coords by adding to `COUNTRY_ISO`, `COUNTRY_REGION`,
  or `UNIVERSITY_COORDS` in `data/refresh-graduate-studies.py`.
- **Cache is 7-day.** Successes AND failures cache in
  `data/auto-resolved.json` (encrypted as `.enc`). A permanent typo
  doesn't hammer the APIs every 3 hours.
- **Cache lives with the other `.enc` data** — encrypt/decrypt scripts
  handle it via `--all`.
- **Region mapping is by ISO2** — `ISO_TO_REGION` in
  `data/auto_resolve.py` maps codes to Ron's dropdown buckets
  (Pacific / Asia / Europe / North America / Americas / Africa).
  World Bank's macro-region strings (`Europe & Central Asia`, etc.)
  are only used as a fallback when we haven't classified the ISO yet.
- **Provenance is logged** — every resolved entry prints its source
  URL to the CI log (grep `auto-resolved country` /
  `auto-resolved university`) and is stored in
  `output.autoResolved` for admin-side inspection.
- **Strict-coverage still guards truly unresolvable names.** A typo
  in Zotero ("Univresity of X") won't match any resolver and will
  fail the build under `VAVELAB_STRICT_COVERAGE=1` so we notice.

Historical note: originally used `restcountries.com/v3.1`; they
deprecated all free `/v1`–`/v4` endpoints in July 2026 and moved v5
to an API-key model. Switched to World Bank on 2026-07-19.

When the auto-resolver identifies a country or university you want
to pin permanently (canonical spelling, hand-verified coords), copy
the values from `data/auto-resolved.json` into `COUNTRY_ISO` /
`COUNTRY_REGION` / `UNIVERSITY_COORDS` and delete the cache entry.
Manual entries take precedence and are documented alongside their
sources in the commit body.

---

## 4. E2E test + CI heartbeat

`scripts/test_auto_resolve.py` proves the resolver end-to-end:

1. Deep-copies the real snapshot.
2. Injects a synthetic country + university + thesis (Netherlands +
   Leiden University + "Test Scholar (auto-resolve)"), neither of
   which is in the hardcoded dicts.
3. Clears the auto-resolved cache so the run really hits the network.
4. Runs `refresh-graduate-studies.py` under
   `VAVELAB_STRICT_COVERAGE=1` in a `/tmp/vave-lab-test-*` workspace.
5. Asserts:
   - refresh exits 0 (strict-coverage passed),
   - `worldPoints[Netherlands]` has `iso="NL"`, `region="Europe"`,
     `lat` / `lng` populated,
   - `phdScholars` contains the fake scholar,
   - `autoResolved.countries.Netherlands.source` and
     `autoResolved.universities["Leiden University"].source` are
     valid `http(s)` URLs.

`.github/workflows/test-auto-resolve.yml` runs the test:

- On every push touching `auto_resolve.py`,
  `refresh-graduate-studies.py`, or `test_auto_resolve.py`.
- **Weekly heartbeat on Sundays 09:00 UTC** — catches upstream API
  outages (World Bank / Wikipedia / Nominatim) before they break the
  next 3-hour refresh.
- Also triggerable manually via `workflow_dispatch`.

If Netherlands or Leiden ever gets promoted into the hardcoded dicts,
update `TEST_COUNTRY` / `TEST_UNIVERSITY` near the top of the test
script.

---

## 5. Panels that update automatically

Once the refresh commits the new `data/itaukei-graduate-studies.json`,
these panels pick up the change on the next page load — **no code
deploy required**:

| Panel | What it reads | What updates |
|-------|--------------|--------------|
| **A2 — Standalone world map** | `worldPoints[]` | New country bubble (if new country) or additional bubble on existing country (if new uni). New scholar appears in the scholar-view roster. |
| **B2 — World map + KPI row (Theses / Scholars / Masters / PhD / Universities / Countries)** | `worldPoints[]` + `totals` | Every KPI tile increments. New bubble at the university coords. Country dropdown gains a row. Region dropdown places it under Pacific / Asia / Europe / etc. Clicking the bubble opens the thesis + scholar detail. |
| **A1 — iTaukei scholar KPI row** | `scholars{}` (via graduate-studies) + admin profiles | Total-scholars tile increments when the new thesis brings in a not-yet-seen author. |
| **Confederacy · Province rollup (Panel B2 subview)** | `scholars{}` + admin province data | New scholar rolls into their province / confederacy tile once Ron fills in province data on the admin side. Shows as `(Province unknown)` until then. |
| **Country + University lists (Panel B2 dropdowns)** | `worldPoints[]` | New country / university appears in the alphabetized dropdown automatically. |
| **Admin dashboard** | `output.autoResolved` | Any resolved entry shows a badge with its provenance URL, so Ron can audit what the resolver decided. |

Panels that **do not** touch this data:

- **B3** (Where iTaukei research is done) — reads
  `b3_publications_by_country.xlsx`, an independent feed. Only
  updates when Ron edits that spreadsheet.
- **B1** (publications by type / authorship) — reads Zotero item
  types, not the graduate-studies feed.
- **C1 / C2** (Fiji-side publications by province) — reads the Fiji
  paternal-province tree, not the graduate-studies tree.

---

## 6. Where the hardcoded mappings live

Three blocks near the top of `data/refresh-graduate-studies.py`:

1. **`COUNTRY_ISO`** — country name → ISO-3166 alpha-2 code. Add
   every new country that appears as a leaf under
   `iTaukei Thesis by Country/Universities` (root key `9XHGQJE6`).
   Missing entries drop the `iso` field, breaking any downstream code
   that filters by ISO (flag icons, joins).
2. **`UNIVERSITY_COORDS`** — university name (as spelled in Zotero) →
   `(lat, lng)` tuple. Rough campus centroid is fine; the map uses it
   to place a Leaflet circle at zoom-2. Precision of ±0.01° (~1 km)
   is enough.
3. **`COUNTRY_REGION`** — country name → region label (`Pacific`,
   `Asia`, `Europe`, `North America`, `Americas`, `Africa`). Drives
   the region › country › university dropdown in the fullscreen world
   map. Missing entries fall into `"Other"` and trigger a
   strict-coverage failure so a new country can't land in Panel B2
   without a proper regional home.

All three dicts are alphabetized by country within the file — keep
that ordering when adding entries.

---

## 7. How the script surfaces residual gaps

`data/refresh-graduate-studies.py` prints a fenced WARNING block at
the end of every run listing:

- countries missing an ISO code,
- universities missing coordinates,
- countries missing a region assignment.

The first two are also written into the JSON output at
`unknownCountries` and `unknownUniversities` so downstream tooling can
inspect them programmatically without re-parsing stdout. Region gaps
surface only in the log — the JSON still emits `"region": "Other"` so
the dropdown never vanishes.

### Strict mode in CI

The 3-hourly refresh workflow runs the script with
`VAVELAB_STRICT_COVERAGE=1`. That flag **only fails the build when
the auto-resolver could not identify the new country or university.**
In the normal case, a new Zotero entry is resolved on the fly and the
build succeeds.

Locally the script only warns (no exit failure) so ad-hoc refreshes
do not block the workflow. To reproduce the CI behavior locally:

```bash
VAVELAB_STRICT_COVERAGE=1 python3 data/refresh-graduate-studies.py
```

To bypass the auto-resolver (offline debug or reproducing the
pre-July-2026 strict behavior):

```bash
VAVELAB_STRICT_COVERAGE=1 VAVELAB_DISABLE_AUTO_RESOLVE=1 \
    python3 data/refresh-graduate-studies.py
```

---

## 8. Coordinate sources for manual pins

For consistency, prefer these in order:

1. Wikipedia infobox coordinates (usually the main campus).
2. University's own "Contact / Location" page.
3. Google Maps pin for the university's main entrance.

Round to 3 decimal places (`(lat, lng)` with millidegree precision).
That matches the existing entries and is sufficient for a zoom-2
world view.

---

## 9. Auditing what's currently mapped

To see the full set of currently-mapped universities and countries
without running the pipeline:

```bash
grep -c '":' data/refresh-graduate-studies.py  # rough count of entries
python3 -c "
import ast, re
src = open('data/refresh-graduate-studies.py').read()
for name in ('COUNTRY_ISO', 'UNIVERSITY_COORDS', 'COUNTRY_REGION'):
    m = re.search(name + r'\s*=\s*(\{[^}]*\})', src, re.DOTALL)
    if m: print(f'{name}: {len(ast.literal_eval(m.group(1)))} entries')
"
```

To inspect what the auto-resolver has healed:

```bash
VAVELAB_PASSCODE='…' python3 scripts/decrypt_data.py auto-resolved.json
python3 -m json.tool data/auto-resolved.json | less
```

---

## 10. Force-sync recipe

If Ron says "refresh now":

```bash
gh workflow run refresh-zotero-snapshot.yml --repo ronvave/vave-lab
gh run list --workflow=refresh-zotero-snapshot.yml \
    --repo ronvave/vave-lab --limit 1 \
    --json databaseId,status,conclusion
```

If a refresh fails at strict-coverage with an unresolved country /
university, the failure log names it. Two responses, in order of
preference:

1. **Check the CI log** for `auto-resolved country` /
   `auto-resolved university` lines to see what the resolver tried.
   Usually the fix is a spelling alias in `_COUNTRY_ALIASES` (in
   `data/auto_resolve.py`) or a Wikipedia page title hint.
2. **Manually pin** by adding to `COUNTRY_ISO` / `COUNTRY_REGION` /
   `UNIVERSITY_COORDS` in `data/refresh-graduate-studies.py`, then
   commit with the source URL in the commit body.

---

## 11. When to still touch code

The auto-resolver handles new countries + universities. Panels update
themselves. Code changes are only needed when:

1. **You want to pin a canonical spelling or hand-verified coords.**
   Copy from `data/auto-resolved.json` into the hardcoded dicts, then
   delete the cache entry. Manual entries take precedence.
2. **A resolver went wrong** — e.g. Wikipedia returned the wrong
   coords for a same-named university. Same fix: hardcode the correct
   value, document the override in the commit body.
3. **A new region bucket is needed.** `ISO_TO_REGION` in
   `data/auto_resolve.py` only knows Ron's current buckets.
4. **A panel needs a new tile / column / view.** Panel layout is
   HTML/JS in `itaukei-research-database.html` +
   `js/itaukei-database.js`; the data feed doesn't need to change if
   the field is already in `worldPoints[]`.

Everything else — new country, new university, new scholar, new
thesis — should propagate automatically from the next refresh.

---

## 12. Historical incidents

| Date | Missing | Symptom | Fix commit |
|------|---------|---------|------------|
| 2026-07-16 | Mangalore University (India), Tsinghua University (China), Auckland University of Technology (New Zealand), Hokkaido University (Japan) — plus India + China missing from `COUNTRY_ISO` | India and China appeared in Panel B2 by-country list; no bubbles on map | added constants + `VAVELAB_STRICT_COVERAGE=1` in CI |
| 2026-07-19 | Central China Normal University coords | Force sync failed at strict-coverage step — new PhD scholar's institution not in `UNIVERSITY_COORDS` | added `Central China Normal University` and `Central China University` alias |
| 2026-07-19 | Region assignments for China, India, Papua New Guinea | Panel B2 region dropdown listed only Japan / South Korea / Indonesia / Philippines under Asia; China and India rows were visible in the by-country list but absent from the region drilldown | added `COUNTRY_REGION` map + emit `region` on every `worldPoints[]` entry + client reads from data file with fallback |
| 2026-07-19 | Tonga (`COUNTRY_ISO` + `COUNTRY_REGION`) and Christ's University in Pacific (`UNIVERSITY_COORDS`) | Second strict-coverage failure in a week — Zotero pulled a new Tonga PhD scholar and blocked the force sync | manual patch + built `data/auto_resolve.py` (World Bank + Wikipedia + Nominatim) so future new countries / universities self-resolve during the refresh without engineer intervention |
| 2026-07-19 | Added `scripts/test_auto_resolve.py` E2E test + `.github/workflows/test-auto-resolve.yml` weekly CI heartbeat | Ron: "Add a test that intentionally introduces a fake country in Zotero to confirm the resolver heals it end-to-end." | Test injects Netherlands + Leiden University into a doctored snapshot copy, runs the refresh script under `STRICT_COVERAGE=1`, and asserts both resolve with valid provenance URLs. Test caught the restcountries deprecation on first run — switched to World Bank in the same commit. |
| 2026-07-19 | Consolidated `NEW-COUNTRY-OR-UNIVERSITY.md` into this doc | Ron: "keep it all in one document which have clearly demarcated topics or headings so it's easier to search, find and reference" | Merged the runbook into `DATA-COVERAGE-GAPS.md` under numbered section headings; removed the standalone file. |
