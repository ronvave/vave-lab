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
`VAVELAB_STRICT_COVERAGE=1`, which converts any gap into a non-zero exit.
GitHub Actions marks the run failed and emails Ron, so silent map
regressions cannot ship. To fix:

1. Open the failed workflow log, scroll to the "Regenerate graduate-studies
   from snapshot" step, and copy the missing names from the WARNING blocks.
2. Add entries to `COUNTRY_ISO`, `UNIVERSITY_COORDS`, and/or `COUNTRY_REGION`
   in `data/refresh-graduate-studies.py`.
3. Commit and push — the next scheduled (or manually re-run) workflow will
   succeed.

Locally the script still only warns (no exit failure) so ad-hoc refreshes
do not block the workflow. To reproduce the CI behavior locally:

```bash
VAVELAB_STRICT_COVERAGE=1 python3 data/refresh-graduate-studies.py
```

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
