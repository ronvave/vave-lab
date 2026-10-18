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
