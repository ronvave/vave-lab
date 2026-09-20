# iTaukei scholar cards and B3: preservation contract

Recorded 2026-09-20 after the user reported repeat regressions.

## Scholar cards: Panel F and shared pre-launch profiles

The Master file owns scholarly records and counts. Admin-owned supplementary
content is also required: `scholar-enrichment.json.enc` supplies saved photos
and supporting profile fields; `scholar-insights-master.json.enc` supplies
keywords and rich-text research summaries. Join them by canonical Scholar ID.
Load the combined adapter bundle before rendering either surface. Do not use
`MasterFileAdapter.load({masterOnly:true})` in the Fiji dashboard: that option
explicitly suppresses both Admin files and caused the regression.

Preserve Master-field precedence, the existing card layout, Share / Update info,
the pre-launch profile, and the hidden-until-ready iframe guard in `s.html`.
Do not expose maternal/private submission fields or unpublished dashboard
content as a side effect of restoring photos and summaries. Do not generate
replacement summaries when approved saved JSON already exists.

## Panel B3

The authoritative `M>PhD mobility` worksheet contains both `Scholar ID`
(canonical ITK-S...) and `scholar_id` (legacy, usually numeric). These are
different namespaces, not interchangeable numbers. Export `Scholar ID` in
`MOBILITY_PUBLIC_FIELDS`, retain it through every scheduled snapshot refresh,
and prefer it in the chord's Scholars lookup. Never pad the legacy number to
invent an ITK-S ID. The old export omitted the canonical column and the chart
silently kept only 2 of 153 rows.

The repair restores the existing mobility population; it does not redefine it
as completed-only. The source worksheet explicitly includes completed Master's
with completed or in-progress PhDs. The separate completed-degree summary
tables have a different population. Any future population change needs an
explicit request and a corresponding caption change.

## Verification and release requirements

Run `node tests/itaukei-card-mobility.test.cjs`. It decrypts the existing snapshots
in memory through the established format, invokes the actual adapter load call
used by the dashboard, verifies every saved photo and research summary for
rostered scholars, and executes B3's loader to check every complete mobility
row and its scholar name. At repair time: 55 saved photos, 75 research summaries,
153 mobility rows, 84 distinct recorded university strings. Counts are dynamic,
not constants to copy into the UI.

The test runs in Dashboard integrity and the Pages deployment validation job.
Also verify Joeli (ITK-S0315) on the live shared profile, Panel F, and B3 before
claiming a visually verified deployment. Keep cache hashes current. Update the
Master Build and Change-Control Record with deployment and validation evidence,
including any limitations. Revert only the scoped code changes when necessary;
do not overwrite newer source data or Admin content.

## B3 university and layout correction — 2026-09-20

Correct institutions in the Master worksheet before refreshing the encrypted
mobility snapshot. Subjects, qualifications, thesis titles and "not found" are
not universities. Preserve unresolved records in the source; omit incomplete
institution pathways from the plotted university population and disclose their
number. Never guess an awarding institution from employment or a PhD location.
Use full canonical university names and canonical Scholar IDs. The corrected
snapshot has 153 source pathways, of which 151 have known institutions; 78
universities remain after canonical-name merging. Koliyavu and Savou-Wara still
need a verified Master's institution. These counts are observations, not UI constants.

The top sentence derives distinct scholars, universities, countries and regions
from the plotted model. It explicitly includes ongoing PhD study. Taiwan maps
to Asia for geographic grouping. The small ribbons/rings explanation belongs
below the chart, and the University key heading is hidden for iTaukei only.
Expanded mode uses the viewport width instead of the former 1480px maximum;
keep the four flanking columns in outer-third, inner-first, inner-second,
outer-fourth order. Preserve other country dashboards and Admin enrichment.

## B3 study-location filters — 2026-09-20

The degree selector is single-choice: Either degree, Master's, PhD, Both
degrees. Both endpoints must belong to the selected location set for Both;
Either matches at least one endpoint. Preserve complete pathways and stable
university numbers and colors. Filter the existing completed-Master's plus
completed/ongoing-PhD population, never add Master's-only scholars.

Region and country controls are multiselect, with country options restricted
to selected regions. Reset filters restores the full dataset; explicit empty
selections display a selection message. Normal and expanded views share the
same iframe and filter state. Escape closes an open dropdown first, then the
expanded chart. Filter interactions must not toggle fullscreen.

Summary counts and legends use the same filtered model. Unverified pathway
exclusions are labeled as full-dataset counts. Source records, Admin content,
other-country behavior, and profile routing are unchanged.
Run node tests/itaukei-mobility-filters.test.cjs in addition to the existing
card/mobility regression test. Live visual validation is recorded separately
in the Master Build and Change-Control Record.

## B3 filtered fullscreen layout and dropdown dismissal — 2026-09-20

Compact (54 or fewer universities) layouts must use three columns in BOTH
normal and fullscreen mode: equal side columns and a centered 54% chart
column. Fullscreen's five-column default must not override that compact rule.
Outside clicks close open filter menus without collapsing fullscreen or
changing selections. Once expanded, ordinary chart clicks keep B3 expanded;
the Close full screen button and Escape remain explicit exit controls.
