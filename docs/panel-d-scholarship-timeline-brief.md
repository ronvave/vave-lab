# Panel D — Scholarship Timeline: Build Brief

**Target file:** `itaukei-research-database-master.html` (only) + `js/itaukei-database-master.js` (Panel D functions)
**Do NOT edit:** `itaukei-research-database.html`, `js/itaukei-database.js`

## Verified data (from decrypted Master files, 2026-08-22)

### Four required milestones (year + scholar)

| Milestone | Year | Scholar (from Scholars.Gender field) | Degree / University / Country |
| :--- | :--- | :--- | :--- |
| 1st Male Master's | **1978** | Vusoniwailala, Lasarusa | Master's · University of Hawaiʻi at Mānoa · United States |
| 1st Female Master's | **1988** | Buatava, Vitori | Master of Theology · Pasifika Communities University · Fiji |
| 1st Male PhD | **1963** | Nayacakalou, Rusiate Raibosa | PhD · University of London · United Kingdom |
| 1st Female PhD | **1994** | Vuki, Veikila C. | PhD/Doctorate · University of Southampton · United Kingdom |

Rule used: `Completion Status` starts with "Completed" (case-insensitive) **AND** `Finish / Completion Year` parses to a 4-digit year. Gender comes from `Scholars.Gender`, joined via `Scholar ID`. No name inference. Excludes in-progress and undated rows.

### KPI card values (Master-derived)

| Card | Value | Definition |
| :--- | :--- | :--- |
| Theses total | **432** | Completed Master's + PhD (any Completion Status starting "Completed") |
| Scholars | **472** | All rows in `Scholars` |
| Master's | **315** | Completed rows with Degree Stage = "Master's" |
| PhDs | **117** | Completed rows with Degree Stage = "PhD/Doctorate" |
| Universities | **101** | Distinct non-empty `C_Uni name` OR `O_Uni name` across completed rows |
| Countries | **22** | Distinct non-empty `Country` across completed rows |
| Key milestones | **4** (or 4 + any extras added) | Number of milestone dots actually drawn |

Subtitle for THESES TOTAL: `117 PhDs • 315 Master's`

### Publications sanity
- Publications rows: 2939 (2935 with a parseable year, range 1941–2026)
- Publications with iTaukei association (headline five): 1141 (from aggregates.totals)
- iTaukei scholars linked: 306 (aggregates.totals.scholars_with_authorship_link)

### Rolling women's share — data definition to use

Use **authorship-based** share: for each year, count publications whose lead scholar (`Auth_Lead Scholar ID` joined to `Scholars.Gender`) is Female vs Male vs Other/Unknown. Compute a **5-year rolling window (year-4 through year, inclusive)** producing `share_F = F / (F + M)` (denominator excludes Unknown/Other so the line isn't dragged by missing data). Label the right axis: **"Women authorship (5-yr rolling)"**. If a rolling window has fewer than 3 dated pubs total, drop the point (don't draw noise).

This is authorship-based (not degree-based) because publications drive the annual bars and it lets the line move in step with them. Mention this in the explanatory footnote.

## Preservation constraints (hard)

- URL/hash state: keys used elsewhere include `#b2=fiji-focused&b2a=first`. Panel D authorship filter already uses `data-hist-authors` and `state.histAuthors`. Do not rename these keys.
- Existing state variables you must keep working: `state.histTypeSet`, `state.histAuthors`, `state.histRange {start,end,preset}`, `state.typeSet`.
- Existing DOM hooks you must keep: `#db-source-histogram`, `[data-hist-authors-tabs]`, `[data-hist-authors]`, `[data-hist-type-filter]`, `[data-hist-start]`, `[data-hist-end]`, `[data-hist-presets]`, `[data-hist-reset]`.
- Existing functions you can extend but should not rename: `renderHistogram()`, `wireHistTypeFilter()`, `wireHistAuthorsTabs()`, `wireHistControls()`.
- Do NOT touch Panels A, B, B1, B2, B3, C, C1, E, F, G.

## Runtime data access

Inside `renderHistogram()` (or a new helper it calls), you have:
- `state.snapshot.items` — publications in Zotero-shape (used today for stacked bars).
- `state.master.scholars` — array of Scholar rows. Key fields: `Scholar ID`, `Scholar Name`, `Gender` ("Male"|"Female"|"Unknown / verify").
- `state.master.gradDegrees` — array of Graduate Degree rows. Key fields: `Scholar ID`, `Scholar Name`, `Degree Stage` ("Master's"|"PhD/Doctorate"), `Completion Status`, `Finish / Completion Year`, `Degree / Qualification`, `C_Uni name`, `O_Uni name`, `Country`.
- `state.master.publications` — array of publication rows (Master-shape). Key fields for the rolling line: `Year`, `Auth_Lead Scholar ID` (join → Scholars.Gender).

## Visual spec (from docx)

### Title / header
- Title: **PUBLICATIONS OVER TIME, BY SOURCE TYPE**
- Retain circular "D" badge (left).
- Retain authorship tabs (top-right): iTaukei lead / iTaukei coauthor / iTaukei both / All authors — existing DOM/state intact.

### Type checkboxes
Retain the 7 existing checkboxes + "Check all" / "Clear". Keep existing color swatches (see `TYPE_COLOR` in js). Confirm labels: PhD Thesis, Master's Thesis, Journal Article, Book Chapter, Book, Report, Preprint.

### Chart
- SVG viewBox `0 0 900 340`, existing bar / stack machinery stays.
- Add subtle alternating decade shading rectangles (BEHIND the bars). Two tones alternating, near-invisible warm neutrals, e.g. `rgba(120, 90, 60, 0.05)` and `rgba(120, 90, 60, 0.02)`. Compute bands from visible `[yMin, yMax]` boundaries (`Math.floor(yMin/10)*10` inclusive to `Math.ceil(yMax/10)*10` exclusive).
- Draw decade labels **above the plot area** ("1960s", "1970s", …), Arial 10px, centered over each band, `#6b7280`.
- Add right y-axis (0–100%) for the rolling women share. Ticks at 0/50/100.
- Draw the rolling line as a thin (`stroke-width=1.4`) gold/ochre polyline. Color: `#B08D2F`. Skip years with < 3 pubs in the 5-yr window.
- Overlay milestone annotations. Each milestone = small filled dot on the x-axis baseline (`r=4.5`, colored: female=`#B85450`, male=`#2E7C8F`), a short vertical guide line to the top of the plot (stroke `1 3` dashed at 20% opacity), a compact label above the plot (year in bold, subtitle in small text). Use SVG `<title>` for tooltip: milestone type · year · scholar · degree · university.
- If a milestone falls outside `[yMin, yMax]`, do NOT draw it.

### Below chart
- Explanatory footnote (italic, Arial): "One bar per year of publication. Unclassified items are excluded. A total of {X} publication records ({Y} across the five headline categories) are linked to {Z} iTaukei scholars. Women share is a 5-year rolling average of lead-author gender."
  - X = state.snapshot.items.length (or filtered pubs count)
  - Y = pubs whose visualType ∈ {journalArticle, thesisMasters, thesisPhd, bookSection, book}
  - Z = distinct linked scholar IDs from authorship
- Existing timeframe controls (From / To / All / 25 / 10 / 5 / Reset): keep as-is.

### KPI cards (NEW ROW, below the existing timeframe controls, still INSIDE `[data-panel="D"]`)
Reuse existing `.db-kpis` + `.db-kpi.db-kpi--solid.db-kpi--<color>` classes. Seven cards, in this order, using existing palette:

| # | Color | data-kpi id | Number | Label | Subtitle (small, `db-kpi__sub`) |
| :- | :--- | :--- | :--- | :--- | :--- |
| 1 | teal | `d-theses` | 432 | Theses total | 117 PhDs • 315 Master's |
| 2 | rust | `d-scholars` | 472 | Scholars | Documented in total |
| 3 | amber | `d-masters` | 315 | Master's | Degree completions |
| 4 | blue | `d-phds` | 117 | PhDs | Doctorate completions |
| 5 | purple | `d-unis` | 101 | Universities | Where degrees were earned |
| 6 | olive | `d-countries` | 22 | Countries | Across degree destinations |
| 7 | pink | `d-milestones` | 4 | Key milestones | Firsts and turning points |

Card DOM values must be **computed at runtime**, not hardcoded — the numbers above are from the current data and must be re-derived so that any Master refresh updates them automatically.

Extend `.db-kpi__body` to hold a third small `.db-kpi__sub` line (e.g. `font-size: 10px; color: rgba(255,255,255,0.65);` on solid cards). Do this via a new CSS rule scoped inside `[data-panel="D"] .db-kpi__sub`.

### Arial scoping

Add a CSS block scoped to `[data-panel="D"]` that overrides all text (title, hints, filter labels, buttons, KPI numbers, tooltips, SVG text) to `font-family: Arial, Helvetica, 'Helvetica Neue', sans-serif`. Existing panel is set to `DM Sans` — override via that scoped selector plus `[data-panel="D"] svg text { font-family: Arial, Helvetica, sans-serif; }`.

## Implementation order

1. HTML: add the KPI grid row + hidden data hooks + subtitle spans. Update decade-label container in Panel D. Ensure title reads exactly "Publications over time, by source type".
2. CSS (in `<style>` block, all rules prefixed `[data-panel="D"]`): Arial font family, decade band shading colors, milestone colors, right-y-axis tick color, `.db-kpi__sub`.
3. JS: extend `renderHistogram()` in `js/itaukei-database-master.js` to
   - Compute decade band rects and paint them BEFORE the bars (so they sit behind).
   - Compute per-year lead-author gender counts (F/M) and a 5-year rolling `F/(F+M)` where denom ≥ 3.
   - Draw right y-axis (0/50/100 %) with 3 tick labels and axis title.
   - Draw the polyline in gold.
   - Compute the 4 milestones from `state.master.gradDegrees` + `state.master.scholars` (Completion Status starts with "Completed", year parses, gender from Scholars) and store in `state.milestones = [{key, label, year, scholar, degree, uni, country, gender}]`. Restrict to the visible `[yMin, yMax]` window.
   - Draw dots + guide lines + labels + `<title>` tooltips.
   - Update explanatory footnote text (create a new element `.db-panel__note` above `.db-hist-controls`).
   - Update the seven KPI numbers.
4. Keep bar interactions (year click filter) unchanged.

## Local verification checklist

- Node parses updated JS (`node --check js/itaukei-database-master.js`).
- All four milestone years appear via `grep 1978 1988 1963 1994` in a debug console dump.
- KPI numbers derived from `state.master` match: 432, 472, 315, 117, 101, 22, 4.
- Other panels' code paths remain untouched (`git diff --stat` shows only master files changed).

## Deployment

- Bump cache-buster in `itaukei-research-database-master.html` (currently `mf9`) → `mf10`. Bump in all 5 sites: 1 iframe src + 4 script tags.
- Commit with clear message, push to `main`.
- Wait 45–60s for Pages rebuild, then curl the deployed HTML and grep for `mf10` and Panel D title to verify.
- Report per Ron's FINAL REPORT format.
