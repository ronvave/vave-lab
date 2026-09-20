# Tongan B3 mobility preservation contract

## Scope and baseline
Tonga B3 adapts approved iTaukei commit d48c5ccf9a111ca2cb1250880d9e4fd5d83c4ba6.
The shared filter component remains unchanged. Tonga loads only its own gated
Master snapshots. The chart has no embedded Fiji fallback and cannot load
country data as a standalone page.

## Population and source pipeline
The authoritative M>PhD mobility worksheet records completed Master's study
paired with completed or ongoing PhD study. Preserve that population and the
worksheet's existing choice of degree pair; do not create a Cartesian product
from Graduate Degrees. Preserve distinct recorded study episodes, same-school
loops, and weight one per distinct pathway. Deduplicate exact repeated pairs.
Use canonical TNG-S IDs and the eligible snapshot roster, never padded legacy IDs.
Explicit degree links, if present, must agree with the scholar and population.

Graduate Degrees O_Uni name feeds the formula-driven C_Uni name and mobility
worksheet. Scheduled refresh-tongan-master-file.yml runs every two hours,
sanitizes via tongan_master_file_transformer.py, encrypts and commits snapshots.
Scholar ID is now included in MOBILITY_PUBLIC_FIELDS. Private titles and notes
remain excluded. Pages must also deploy on successful Tonga refresh completion
because GITHUB_TOKEN snapshot commits do not trigger another push workflow.

UN M49 continent-level regions match the approved baseline: Oceania, Asia,
Americas, Europe, Africa. Taiwan is grouped geographically in Asia if present.
Institution names use source C_Uni mappings; do not guess from employment.

## Source corrections
Verified source changes on 2026-09-20: only Graduate Degrees column I
(O_Uni name), with evidence in cell notes; formulas in column H and the
mobility worksheet preserved.
- TNG-D0041 / TNG-S0025, row 45: blank → Massey University. Evidence: https://www.massey.ac.nz/about/news/massey-welcomes-senior-research-scientist-as-new-dean-pacific/
- TNG-D0049 / TNG-S0031, row 53: blank → University of Hawaiʻi at Mānoa. Evidence: https://saap.unm.edu/people/faculty/sarah-soakai/index.html
- TNG-D0050 / TNG-S0031, row 54: blank → University of California, Los Angeles. Evidence: https://saap.unm.edu/people/faculty/sarah-soakai/index.html
- TNG-D0052 / TNG-S0032, row 56: blank → University of the South Pacific. Evidence: https://trinitycollege.ac.nz/why-trinity/who-we-are/
- TNG-D0053 / TNG-S0032, row 57: blank → University of Auckland. Evidence: https://trinitycollege.ac.nz/why-trinity/who-we-are/
- TNG-D0063 / TNG-S0038, row 67: blank → University of California, Santa Barbara. Evidence: https://www.usp.ac.fj/alumni/wp-content/uploads/sites/4/2021/08/USPAlumniNewsletter_201702_en.pdf
- TNG-D0064 / TNG-S0038, row 68: blank → University of the South Pacific. Evidence: https://www.usp.ac.fj/alumni/wp-content/uploads/sites/4/2021/08/USPAlumniNewsletter_201702_en.pdf
- TNG-D0072 / TNG-S0044, row 76: blank → University of Waikato. Evidence: https://researchcommons.waikato.ac.nz/entities/publication/5ad5407a-311d-4427-9c0f-b5b6d55fe47a
- TNG-D0073 / TNG-S0045, row 77: blank → University of Auckland. Evidence: https://profiles.auckland.ac.nz/s-ofanoa

After recalculation: 95 source pathways, 86 plotted scholars/pathways,
47 universities, 7 countries, 4 regions. Nine unresolved pathways remain:
TNG-S0027, TNG-S0029, TNG-S0030, TNG-S0033, TNG-S0036, TNG-S0037,
TNG-S0040, TNG-S0065, TNG-S0066. These are observations, not UI constants.
Keep unresolved records in the source and derive the exclusion count dynamically.

## Filters, layout and interaction
Either matches either endpoint; Master's and PhD match the named endpoint;
Both requires both endpoints in the union of selected locations, including
Australia → New Zealand. Region and country constraints intersect per endpoint.
Retain complete matched pathways and their counterpart institutions. Keep badge
numbers and colors stable. Empty selection and no matching results are distinct.
Reset restores all locations and Either degree.

At most 54 visible institutions use balanced flanks and a centered 54% chart
column. Larger populations use the baseline four flanks and 38% center.
The compact fullscreen CSS selector must outrank the fullscreen default.
Outside clicks dismiss menus without collapsing fullscreen. Ordinary expanded
chart clicks do not exit. Escape closes a menu first and fullscreen second.
Reuse the iframe so selections survive view switches.

Captions derive unique scholars, institutions, countries and regions from the
same filtered model. Full-dataset exclusions are separately described. Preserve
full institutional labels and numbered badges; tooltip lists are numbered.

## Verification and preservation
Run:
- node tests/itaukei-card-mobility.test.cjs
- node tests/tongan-card-mobility.test.cjs

The Tonga test executes the real adapter and chart loader against encrypted
snapshots in memory, verifies saved photos and rich summaries, canonical joins,
deduplication, multiple episodes, same-institution paths, ongoing doctoral study,
gated loading, compact fullscreen CSS and menu dismissal. Shared filter tests
cover location union/intersection, all degree modes, endpoints and empty states.
An isolated corrected-source fixture passed with 86 paths and nine exclusions.
The original snapshot passed with 80 paths and 15 exclusions. Actual sync and
browser observations are recorded in the release section after deployment.

Preserve all other panels, 14 saved photos and 13 saved summaries (observed
baseline counts), Share, Update info and the hidden-until-ready s.html guard.
Never switch the dashboard to masterOnly loading.

## Rollback
Revert only this release's Tonga B3 files, parent B3 handler/export changes and
Tonga-specific Pages additions. Preserve newer snapshots, source corrections,
Admin enrichment, unrelated country work and the approved Fiji baseline.
Do not restore whole repository trees or overwrite the Master Sheet.

