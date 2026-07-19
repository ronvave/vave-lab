# Data coverage gaps — countries & universities

When a new country or university first appears in the Zotero thesis tree,
two hardcoded lookups in `data/refresh-graduate-studies.py` need matching
entries or the world map will silently miss data.

## What breaks silently, and why

Panel B2 has two independent renderers:

- **By-country list** — needs `country` + counts. Works from any point.
- **World map bubbles** — needs `country` + `lat` + `lng`. **Without
  coordinates, no bubble is drawn.**

That mismatch is what produced the July 2026 incident: two PhD theses at
Mangalore University (India) and one at Tsinghua University (China) appeared
in the by-country list but had no map bubbles. The `refresh-graduate-studies`
script had already printed a warning listing both universities as missing
coordinates, but the warning was buried after the summary line and did not
fail the run, so the site shipped with the gap.

## Where to add mappings

Three blocks near the top of `data/refresh-graduate-studies.py`:

1. **`COUNTRY_ISO`** — country name → ISO-3166 alpha-2 code. Add every new
   country that appears as a leaf under `iTaukei Thesis by Country/Universities`
   (root key `9XHGQJE6`). Missing entries drop the `iso` field, breaking
   any downstream code that filters by ISO (flag icons, joins).
2. **`UNIVERSITY_COORDS`** — university name (as spelled in Zotero) →
   `(lat, lng)` tuple. Rough campus centroid is fine; the map uses it to
   place a Leaflet circle at zoom-2. Precision of ±0.01° (≈1 km) is enough.
3. **`COUNTRY_REGION`** — country name → region label (`Pacific`, `Asia`,
   `Europe`, `North America`, etc.). Drives the region › country ›
   university dropdown in the fullscreen world map. Missing entries fall
   into `"Other"` and trigger a strict-coverage failure so a new country
   can’t land in Panel B2 without a proper regional home.

All three dicts are alphabetized by country within the file — keep that
ordering when adding entries.

## How the script surfaces gaps

`data/refresh-graduate-studies.py` prints a fenced WARNING block at the end
of every run listing:

- countries missing an ISO code
- universities missing coordinates
- countries missing a region assignment

The first two are also written into the JSON output at `unknownCountries`
and `unknownUniversities` so downstream tooling can inspect them
programmatically without re-parsing stdout. Region gaps surface only in
the log — the JSON still emits `"region": "Other"` so the dropdown never
vanishes.

### Strict mode in CI

The 3-hourly refresh workflow
(`.github/workflows/refresh-zotero-snapshot.yml`) runs the script with
`VAVELAB_STRICT_COVERAGE=1`. That flag ONLY fails the build when the
auto-resolver (below) also could not identify the new country or
university. In the normal case, a new Zotero entry is resolved on the
fly and the build succeeds.

Manual override remains available: adding an entry to `COUNTRY_ISO`,
`UNIVERSITY_COORDS`, or `COUNTRY_REGION` in
`data/refresh-graduate-studies.py` takes precedence over any
auto-resolved value.

Locally the script still only warns (no exit failure) so ad-hoc refreshes
do not block the workflow. To reproduce the CI behavior locally:

```bash
VAVELAB_STRICT_COVERAGE=1 python3 data/refresh-graduate-studies.py
```

To bypass the auto-resolver (e.g. offline debug or reproducing the
pre-July-2026 strict behavior):

```bash
VAVELAB_STRICT_COVERAGE=1 VAVELAB_DISABLE_AUTO_RESOLVE=1 \
    python3 data/refresh-graduate-studies.py
```

## Auto-resolve policy (July 2026)

Ron's mandate: "Allow the backend system to automatically search for
new country ISO code, and also university website and its location,
without requiring input from you."

Implementation: `data/auto_resolve.py`, invoked from
`refresh-graduate-studies.py` right before the strict-coverage exit.

Resolvers, tried in order per gap:

| Gap type | Source | Rate limit |
|----------|--------|------------|
| Country → ISO2 + region | `restcountries.com/v3.1/name/{name}` | none |
| University → lat/lng | Wikipedia page-summary REST (`en.wikipedia.org/api/rest_v1/page/summary/{title}`) | none |
| University → lat/lng | Wikipedia OpenSearch + summary | none |
| University → lat/lng | OpenStreetMap Nominatim (`nominatim.openstreetmap.org/search`) | 1 req/sec (module enforces) |

Rules:

- **Hardcoded dicts always win.** If a name is in `COUNTRY_ISO`,
  `UNIVERSITY_COORDS`, or `COUNTRY_REGION`, the auto-resolver never
  runs for it. This lets us pin canonical spellings or overrule an
  incorrect Wikipedia coordinate.
- **Cache is authoritative for 7 days.** Successful lookups are cached
  in `data/auto-resolved.json` (encrypted at rest as
  `data/auto-resolved.json.enc`). Failed lookups also cache for 7 days
  so a permanently misspelled name doesn't hammer the APIs every 3
  hours.
- **Cache lives with the other .enc data** — encrypt/decrypt scripts
  handle it via `--all`. When editing the cache by hand, use the same
  encrypt/decrypt pattern as every other data blob.
- **Region mapping is by ISO2.** `data/auto_resolve.py` ships an
  `ISO_TO_REGION` dict that maps ISO codes to Ron's dropdown buckets
  (Pacific / Asia / Europe / North America / Americas / Africa).
  restcountries' own `region` field is only used as a fallback when we
  haven't classified the ISO yet.
- **Provenance is logged.** Every auto-resolved entry prints the URL
  it came from into the CI log (searchable as `auto-resolved country`
  / `auto-resolved university`) and is saved into
  `output["autoResolved"]` for admin-side inspection.
- **Strict-coverage still guards genuinely unresolvable names.** A
  typo in Zotero (e.g. "Univresity of X") is unlikely to match any of
  the three resolvers and will still fail the build so we notice.

When the auto-resolver identifies a country or university you want to
pin permanently (canonical spelling, hand-verified coordinates), copy
the values from `data/auto-resolved.json` into `COUNTRY_ISO` /
`COUNTRY_REGION` / `UNIVERSITY_COORDS` in
`data/refresh-graduate-studies.py` and delete the entry from the
cache. Manual entries take precedence and are documented alongside
their sources in the commit body.

## Coordinate sources

For consistency, prefer these in order:

1. Wikipedia infobox coordinates (usually the main campus)
2. University's own "Contact / Location" page
3. Google Maps pin for the university's main entrance

Round to 3 decimal places (`(lat, lng)` with millidegree precision). That
matches the existing entries and is sufficient for a zoom-2 world view.

## Auditing what's currently mapped

To see the full set of currently-mapped universities and countries without
running the pipeline:

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

## Historical incidents

| Date | Missing | Symptom | Fix commit |
|------|---------|---------|------------|
| 2026-07-16 | Mangalore University (India), Tsinghua University (China), Auckland University of Technology (New Zealand), Hokkaido University (Japan) — plus India+China missing from COUNTRY_ISO | India and China appeared in Panel B2 by-country list; no bubbles on map | added constants + `VAVELAB_STRICT_COVERAGE=1` in CI |
| 2026-07-19 | Central China Normal University coords | Force sync failed at strict-coverage step — new PhD scholar's institution not in `UNIVERSITY_COORDS` | added `Central China Normal University` and `Central China University` alias |
| 2026-07-19 | Region assignments for China, India, Papua New Guinea | Panel B2 region dropdown listed only Japan/South Korea/Indonesia/Philippines under Asia; China and India rows were visible in the by-country list but absent from the region drilldown | added `COUNTRY_REGION` map + emit `region` on every `worldPoints[]` entry + client reads from data file with fallback |
| 2026-07-19 | Tonga (COUNTRY_ISO + COUNTRY_REGION) and Christ's University in Pacific (UNIVERSITY_COORDS) | Second strict-coverage failure in a week — Zotero pulled a new Tonga PhD scholar and blocked the force sync | manual patch + built `data/auto_resolve.py` (restcountries + Wikipedia + Nominatim) so future new countries/universities self-resolve during the refresh without engineer intervention |
