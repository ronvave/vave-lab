# Regional Pacific Scholars Dashboard — implementation notes

Page: `pacific-scholars.html` (+ `css/pacific-scholars.css`, `js/pacific-scholars.js`).
Status: **pre-launch preview — not pushed to `main`, not linked from any page, `noindex`.**

## 1. Implementation plan (as built)

1. Read all 11 authoritative country Master files read-only (Sheets API).
2. `scripts/build_regional_scholars.py` applies each country's own inclusion and
   completion rules, writes `data/regional-scholars.json` (plaintext, gitignored).
3. `scripts/encrypt_regional.py` encrypts it to `data/regional-scholars.json.enc`
   (same IVAV v1 / PBKDF2-SHA256 200k / AES-GCM format as the country dashboards)
   with a **separate regional passcode** (`REGIONAL_PASSCODE`).
4. The page decrypts in the browser after the passcode is entered and renders
   every panel from that one bundle. No Master-file IDs, tokens, contact details,
   geography, genealogy, notes or evidence fields are in the client bundle.
5. Static assets: Natural Earth basemap (`data/regional-basemap.json`, public domain)
   and Wikimedia Commons photographs (`img/regional/*.webp`, attribution in
   `img/regional/credits.json` and the page footer).

## 2. Source-of-truth inventory (read 2026-10-18 00:31 UTC)

Access method for every country: Google Sheets API, read-only, via the project
owner's Google account (`gws`). CI alternative: `REGIONAL_GOOGLE_SERVICE_ACCOUNT_JSON`
(service account needs Viewer on all 11 sheets — **not yet provisioned**).

| Country | Master file | Last modified | Country dashboard | Roster exclusions applied |
|---|---|---|---|---|
| Fiji | iTaukei_Master_file | 2026-10-13 01:40 UTC | itaukei-research-database-master.html | — |
| Tonga | Tongan Scholars Master File | 2026-10-16 03:04 UTC | tongan-research-database-master.html | Retained profile; excluded from Indigenous Tongan counts: 1 |
| Solomon Islands | Solomon Islands Scholars Master File | 2026-10-15 10:20 UTC | solomon-islands-research-database-master.html | — |
| Samoa | Samoa Scholar Database — Master Sheet | 2026-10-12 14:06 UTC | in development | Inclusion Status not Included: 1 |
| Vanuatu | Vanuatu Scholarly Database — Master File | 2026-10-12 14:06 UTC | vanuatu-research-database-master.html | Identity not Verified / Excluded: 2 |
| Tuvalu | Tuvalu Scholarly Database — Master File | 2026-10-12 14:06 UTC | — | — |
| Kiribati | Kiribati Scholarly Database — Master File | 2026-10-12 14:06 UTC | — | — |
| Palau | Palau Scholarly Database — Master File | 2026-10-12 14:06 UTC | — | — |
| Cook Islands | Cook Islands Scholarly Database — Master File | 2026-10-12 14:06 UTC | — | — |
| Marshall Islands | Marshall Islands Scholarly Database — Master File | 2026-10-12 14:01 UTC | — | — |
| Federated States of Micronesia | FSM Scholarly Database — Master File | 2026-10-12 14:06 UTC | — | — |

### Field mapping

| Concept | Fiji | Tonga | Solomon Is. / Samoa | Vanuatu + 6 newer countries |
|---|---|---|---|---|
| Scholar ID | `Scholar ID` (ITK-S…) | `Scholar ID` (TNG-S…) | `Scholar ID` | `Scholar ID` |
| Inclusion | not on `Part-iTaukei` | `Roster Tier` ≠ "excluded from Indigenous Tongan counts" | `Inclusion Status` = Included | `Identity Verification Status` = Verified and `Review Status` ≠ Excluded |
| Degree level | `Degree Level` | `Degree Stage` | `Degree Stage` / `Degree Level` | `Degree Level` |
| Completion | `Completion Status` starts "Completed"/"Awarded" | same | same | same |
| Destination | `University Country` | `University Country` | `Country` / `University Country` | `University Country` |
| Discipline | Short Discipline / Field / Broad → `master_short_disciplines.py` | same | not used | Vanuatu: `vanuatu-dashboard-model.js` crosswalk (ported exactly) |
| Gender | `Gender` | `Gender` (Tangata/Fefine) | `Gender` (Tāne/Fafine for Samoa) | `Gender` |
| Publications | Publications + Authorship (6 headline types incl. Report) | 5 headline types | 5 headline types; Samoa `V2 Inclusion Flag` = Included | 5 headline types |

Eight short-discipline categories (unchanged): Theology and religious studies;
Education; Health sciences; Engineering, technology and planning; Life and
environmental sciences; Humanities; Social sciences; Earth, ocean and atmospheric sciences.
Unmapped degrees are shown as "Unknown / unmapped" (Fiji 4, Tonga 15, Vanuatu 3).

## 3. Reconciliation — live vs 5 October 2026 checkpoint

| Country | Oct 5 M | Live M | Δ | Oct 5 PhD | Live PhD | Δ | Live scholars | Oct 5 total pubs | Live indexed (headline types) | Oct 5 by/with Indig. | Live Indig.-linked | Completed degrees on non-included scholars |
|---|---|---|---|---|---|---|---|---|---|---|---|---|
| Fiji | 355 | 356 | +1 | 133 | 134 | +1 | 474 | 3,633 | 4,049 | 1,951 | 1,972 | 2 |
| Tonga | 187 | 187 | +0 | 145 | 149 | +4 | 272 | 3,353 | 3,645 | 700 | 690 | 19 |
| Solomon Islands | 80 | 80 | +0 | 39 | 39 | +0 | 81 | 411 | 445 | 408 | 379 | 3 |
| Samoa | 40 | 50 | +10 | 46 | 51 | +5 | 59 | 384 | 349 | 293 | 215 | 48 |
| Vanuatu | 74 | 98 | +24 | 23 | 23 | +0 | 105 | 249 | 190 | 92 | 100 | 0 |
| Tuvalu | 25 | 25 | +0 | 12 | 12 | +0 | 31 | 88 | 37 | 88 | 2 | 0 |
| Kiribati | 20 | 21 | +1 | 13 | 13 | +0 | 28 | 80 | 28 | 80 | 4 | 0 |
| Palau | 19 | 19 | +0 | 6 | 6 | +0 | 20 | 58 | 13 | 58 | 1 | 0 |
| Cook Islands | 48 | 51 | +3 | 20 | 20 | +0 | 58 | 84 | 139 | 84 | 17 | 0 |
| Marshall Islands | 39 | 39 | +0 | 10 | 10 | +0 | 47 | 64 | 23 | 64 | 6 | 0 |
| Federated States of Micronesia | 23 | 23 | +0 | 14 | 17 | +3 | 34 | 37 | 15 | 37 | 1 | 0 |
| **Total** | **910** | **949** | **+39** | **461** | **474** | **+13** | **1209** | | | | | |

Unresolved / explained differences:

- **Header arithmetic:** the Oct 5 header says “542 Masters and 278 PhDs across 11 countries”; its rows sum to 910 + 461 = 1,371. 542 + 278 is Fiji + Tonga only.
- **PhDs include professional doctorates** (Tuvalu 1, Palau 2, Marshall Is. 8, FSM 3 = 14). FSM's +3 is exactly its 3 professional doctorates, so Oct 5 probably excluded them for FSM only — **needs confirmation**.
- **Vanuatu Master's +24, Samoa +10/+5, Cook Is. +3, Tonga PhD +4, Fiji +1/+1:** Master files edited after Oct 5 (all modified 12–16 Oct). Not independently verified line by line.
- **Samoa:** 48 completed degrees belong to scholars not marked Included, and they are excluded here.
- **Publications are not comparable to Oct 5:** Oct 5 counted all item types. This dashboard counts each country's headline categories. The six newer countries' Publications tabs were re-initialised (“INITIALIZED v0.1 — EMPTY COUNTRY TABLE”) after Oct 5 and have very few Authorship links (Tuvalu 2, Palau 1, FSM 1), so their Indigenous-linked counts are provisional.
- **Regional publications:** 8,629 unique country-indexed records and 3,348 unique Indigenous-linked records after cross-country DOI/title+year deduplication (3,387 before).
- **Two records dated after 2026** (2027) are flagged on the page as probable data-entry errors.
- **Cross-country duplicates of people** (the same scholar in two country rosters) are not yet reconciled.

## 4. Test report (Playwright, Chromium, local static server)

All of these passed in the real rendered DOM: wrong passcode rejected; three-way toggle (Scholars/PhDs/Master's) updates the strip, map labels, map legend, chart order and ARIA state together; strip strictly descending for each metric; chart order = strip order; arrow keys/Home/End on the toggle; map marker keyboard Enter selects and filters; URL deep link `?metric=&country=` restores; cross-panel filter (degrees, outputs, gender, destinations, disciplines); Kiribati selection shows the “not included” note for disciplines; clear filter; exactly 4 “View Dashboard” links (Fiji, Tonga, Solomon Is., Vanuatu), each resolving to an existing page; Samoa shows “Dashboard in development”; stacked view; CSV export (12 lines); Fields of Research for All/Fiji/Tonga/Vanuatu × level (8 categories + Unknown); destination filters by home/level/decade; Pacific, Australia and New Zealand separate; search by name, diacritic-insensitive search, country + level, field, A–Z browse, empty state, reset; result links use each country dashboard’s existing `?scholar=` filter; About, Methodology and Coverage dialogs plus 7 provenance dialogs open and close with Esc; zoom in/out/reset and table view; no broken images; **0 console errors**; no horizontal overflow at 1440, 1024 or 390 px. DOMContentLoaded about 90 ms locally, about 280 KB transferred after unlock.

## 5. Security and deployment

- This uses the same model as the existing country dashboards: the data are AES-GCM encrypted at rest and decrypted only with the passcode. This is **real encryption, not just a JavaScript password check**, but it is only as strong as the passcode. Anyone with the passcode can see the aggregates and the name search index. The asset files (photos, basemap) are public.
- GitHub Pages cannot restrict who requests the URL. `noindex` and the page not being linked anywhere reduce discovery but do not prevent access to the encrypted file. If per-person access control is required, put the page behind Cloudflare Access (or similar) in front of a custom domain.
- Not done without authorization: no push to `main`, no edits to country dashboards, Master files, admin panels or workflows.
- To publish: commit the page files, `img/regional/`, `data/regional-basemap.json` and `data/regional-scholars.json.enc` (never the plaintext), then push. GitHub Pages serves the result at `https://ronvave.github.io/vave-lab/pacific-scholars.html`.

## 6. Refresh

```bash
python3 scripts/build_regional_scholars.py --pull          # gws or service account
REGIONAL_PASSCODE=… python3 scripts/encrypt_regional.py
```

## 7. Pacific Firsts timeline

Full-width panel below "Graduate Degrees by Country" and "Fields of Research". It shows, per country, the earliest completed Master's and PhD by gender (male / female), using the same rule as the country dashboards' Panel D: completed Master's / PhD records (professional doctorates excluded) dated by the completion-year column, gender from the Scholars sheet (never inferred), display name = title + first given name + family name. Ties on the earliest year are kept and listed in the hover card. Flags are circles cropped from the regional basemap (`img/regional/flags/`); ring colour = gender (turquoise male, pink female), single ring = Master's, double ring = PhD. Toggles: degree (Master's and PhD / Master's only / PhD only) and gender (Both / Male / Female). The panel follows the country selection and stays hidden if the bundle has no `firsts` section.

`scripts/build_regional_scholars.py` computes `firsts` on every full rebuild. To add derived sections to the live encrypted bundle without knowing the passcode, encrypt a JSON patch (whitelisted keys only) to `data/regional-patch.enc` with a one-time key stored as the `REGIONAL_PATCH_KEY` secret, then run the manual **Merge regional dashboard data patch** workflow; it merges, re-encrypts with `REGIONAL_PASSCODE`, deletes the patch, and redeploys. Delete the `REGIONAL_PATCH_KEY` secret afterwards.

## 8. University positions panels

Two full-width panels below Pacific Firsts, built from each country Master file's
**Positions** sheet (plus **Institutions** for the institution type). Logic lives in
`scripts/regional_positions.py` and runs as part of `build_regional_scholars.py`
(output key `positions` inside the encrypted bundle; names never leave the bundle).

- **University Positions by Country** — canonical roles × 11 countries + region.
  Toggles: Ever held / Currently held; Both / Male / Female. Hover, tap or focus a
  number to list the scholars. Countries whose Positions sheet is still an empty
  template show striped "no records" columns (as of 18 Oct 2026: Tuvalu, Kiribati,
  Palau, Cook Islands, Marshall Islands, FSM).
- **Women and Men in University Leadership** — female / male / not-recorded counts for
  each leadership role, with a country dropdown that follows the dashboard's selected
  country.

- **Where Positions Are Held** (half width, left) — home country × institution country
  matrix (top 9 institution countries + Other) with a position-group dropdown (all
  positions, any leadership role, VC/PVC/Dean, Professors and Associate Professors,
  Lecturers and Senior Lecturers). Gold outline = positions at home; hover/tap/focus a
  cell for names. Added 18 Oct 2026; uses the per-role `h` (institution countries) field.
- **Highest Academic Rank Reached** (half width, right) — each scholar counted once at
  their most senior rank, with a Share / Number toggle.

Both half-width panels stack full width below 1100 px. All four panels highlight the
country selected on the cards.

Classification rules:
- Leadership (Chancellor/Pro-Chancellor, PVC/DVC, VC/President, Dean,
  Associate/Deputy Dean, Head of School/Department, Director of a university centre or
  institute) counts only at universities and other higher-education institutions and
  includes acting appointments; one row may carry several roles.
- Academic rank uses the recorded title first, then the standardized rank; Lecturer
  and Assistant Professor stay separate.
- Every count is unique scholars on the included roster.

First load (18 Oct 2026) used the one-time encrypted patch workflow
(`merge-regional-patch.yml`, allowed keys `firsts`, `positions`); later refreshes
rebuild `positions` automatically.

## 9. Regional Scholar Directory (bottom panel, added 2026-10-19)

- **Where:** full-width panel `#ps-dir-panel`, last in the page grid after "Find a Pacific Scholar". Code: `js/pacific-scholars-directory.js`, `css/pacific-scholars-directory.css` (every rule scoped to `#ps-dir`). Data: `directory` key of the encrypted bundle, gzip + base64, built by `scripts/regional_directory.py`.
- **Who appears:** each country's included roster (same rules as the other panels). Where a Master file has `Public Display Approved`, only rows marked TRUE (blank or shifted values are left out). Fiji, Tonga, Solomon Islands and Samoa have no consent column, so their included rosters appear.
- **Card fields:** display name, salutation shown once (a leading academic or clerical title inside the Master name is moved out of the name; the Master salutation wins; a stand-alone "Professor" shows as "Prof"; titles after a Samoan matai title stay in place and a salutation they would repeat is dropped; other honorifics already in the name are dropped), paternal home village / island line, local label (Fiji confederacy, Tonga island division, Solomon Islands and Vanuatu province only; the line drops the province or division the chip already shows, except Fiji), current role, workplace, department, work-country flag, work region (`wr`, from the workplace country), completed degrees and field, study regions (`r`) and study countries (`sc`, "Region|Country"), validated ORCID iD and Google Scholar URL, profile photo and institution / department / profile links, linked publications by type and first-authored count. For deceased scholars only: birth and death years (`yb`, `yd`, 4-digit Master values, else the country admin enrichment), shown as the black memorial strip under the photo ("1931 – 2008"; "d. 2008" when only the death year is known; otherwise "In memoriam") with a dark photo border, as on the Fiji card. Never exported: share tokens, notes, evidence, maternal geography, clans, birth years of living scholars, contact details.
- **Explain their research (AI generated):** the same keywords and plain-English summary as the country cards, copied in CI by `scripts/regional_card_extras.py` from the Fiji, Tonga and Solomon Islands insight files (`*scholar-insights-master.json.enc`) and from Vanuatu's enrichment rows (`kw` up to 24, `sm` up to 8,000 characters). Summary HTML is sanitised in the browser (only `<a>` to http(s)/mailto, `<em>`, `<strong>`, `<i>`, `<b>`, `<br>`). Keyword tags run a directory search.
- **Controls:** country, discipline (Fiji, Tonga, Vanuatu mappings only), degree, gender, Work region and Study region (fly-out menus: region first, then a sideways sub-menu of countries with counts and "All of <region>"; Work region also has "Not recorded"; sub-menus flip left near the screen edge and open inline below 640 px; Esc and arrow keys work), sector (University or tertiary when the workplace name is a university, college, polytechnic or wānanga; Other workplace; Not recorded), search (names, workplaces, places, fields, keywords, publication titles), removable filter chips, Clear filters, page-number pager (24 per page, Fiji layout), Share (copies that scholar's country profile link: Fiji `s.html?k=`, Tonga `s-tonga.html?k=`, Solomon Islands `s-solomon.html?k=`, Vanuatu `s-vanuatu.html?scholar=`, each with `explain=1` so Explain their research is already open when an explanation is recorded; the tokens are read on click from the public files those country pages already use, and are not stored in the regional bundle. Countries without a profile page still copy the regional card link, which opens after the passcode). The merged .bib export and Update info button were removed (user decisions).
- **Font:** the whole regional page uses Arial (`--ps-sans` and `--ps-serif` in `css/pacific-scholars.css`), as on the Fiji dashboard; Google Fonts are no longer loaded.
- **Publishing:** add `directory` to an encrypted patch (`merge_regional_patch.py` ALLOWED includes it) and run the merge workflow, as for `firsts` and `positions`.

## 10. Panel codes and panel menu (added 2026-10-19)

Every panel carries a code badge (top right) and the sticky menu bar under the headline figures jumps to it (`js/pacific-scholars-panel-menu.js`, same idea as the country dashboards' panel menu). Panels still hidden for lack of data are left out until they appear.

- **Panel A · Overview:** A1 Pacific Scholars Across Our Ocean, A2 Regional Postgraduate Degrees, A3 Research Outputs, A4 Graduate Degrees by Country, A5 Fields of Research
- **Panel B · Firsts & university careers:** B1 Pacific Firsts, B2 University Positions by Country, B3 Women and Men in University Leadership, B4 Where Positions Are Held, B5 Highest Academic Rank Reached
- **Panel C · People & pathways:** C1 Gender Representation, C2 Where Our Scholars Study, C3 From Learning to Impact
- **D** Find a Pacific Scholar (pill "Find a Scholar"), **E** Regional Scholar Directory (pill "Directory"), **F** Publications (pill "Publications"), **G** Collaborators (pill "Collaborators")

## 11. Panel F Publications (added 2026-10-19)

`js/pacific-scholars-publications.js` with styles in `css/pacific-scholars-pubs-collab.css`. Same layout as the Fiji dashboard's publications list. It reads the directory section of the encrypted bundle; the directory module calls `PSPublications.init` after decoding, so nothing extra is published.

- Lists every publication linked to a directory scholar (4,063 on 2026-10-19), merged across countries by DOI, otherwise by title and year. This count includes theses, reports and other outputs, so it is larger than the 3,348 headline figure, which counts only each country dashboard's main publication types. The panel says so in its introduction.
- Circle flag(s) from `img/regional/flags/` show the country of the linked scholar(s); a publication shared by scholars from two countries shows both flags.
- "Indigenous first author" comes from the per-scholar `f` list (first-authored publication indices), which `scripts/regional_directory.py` writes beside the existing `fa` count.
- Filters: search (title, authors, journal, publisher, scholar name), type, country, discipline (Fiji, Tonga and Vanuatu only), decade and authorship. Sorted newest first, 25 per page. Scholar names open that scholar's directory card (`#dir=ID`).
- Seven records with damaged citation fields are still listed, but an author field that holds a DOI or an internal key is not shown. There is no .bib export, to match the earlier removal of the directory's merged .bib.

## 12. Panel G Collaborators (added 2026-10-19)

`js/pacific-scholars-collaborators.js` reads `data/regional-collaborators.json`. Photos and logos in `img/regional/collab/` are cropped from the V2 partnership map. The map reuses A1's base image; up to two key collaborators per country appear as photos beside the country, with a "+N" circle when there are more. Selecting them, or a card's "Show N more collaborators" button, expands that country's card to list everyone.

To add a collaborator:

1. Put a square photo (about 240 × 240) in `img/regional/collab/`. This step is optional; without a photo the card shows initials.
2. Open `data/regional-collaborators.json` and add a line to that country's `people` list, for example `{ "name": "Jane Doe", "title": "Dr", "role": "Senior Lecturer", "inst": "NUS", "photo": "img/regional/collab/jane-doe.webp" }`.
3. Add `"key": true` to show the person on the map; only the first two key people per country are shown there. Add `"vc": true` for the green Vice Chancellor ring.
4. A new institution goes under `institutions` (name, optional logo). Put its code in the country's `logos` list to show the logo on the card.
5. Never add email addresses, phone numbers or other contact details.

A country added to the list without a set map position gets a default spot; check the map and adjust `SPOT` in the script if its photos cover a label.

