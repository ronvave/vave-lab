# Names that must NEVER be merged

Distinct people with similar names. Any script or agent that reasons
about author identity must treat these as **separate scholars**. Do not
propose them as merge candidates, do not consider them "possibly the
same person", do not fold them into a shared canonical name.

Ron has stated this repeatedly — the note lives here so we stop
repeating the assumption.

## Fongs

| Canonical name (admin) | Notes |
| ---------------------- | ----- |
| `Fong, Patrick S.` | Also appears in Zotero as `Fong, Patrick` and `Fong, Patrick Sakiusa`. Those two variants ARE aliases of Patrick and DO fold in. |
| `Fong, James` | **Different person** from Patrick. Never merge with any Patrick / Sakiusa variant. |
| `Fong, Sakiusa` | **Different person** from Patrick. `Sakiusa` on its own is NOT the same as `Patrick Sakiusa`. Never merge. |
| `Fong-Lomavatu, Mereia` | Also appears as `Fong, Mereia`, `Lomavatu, Mereia Fong`, and the U+2010 hyphen variant — those DO fold. Never merge with any male Fong. |
| `Fong, Teddy`, `Fong, Jack` | Separate individuals. Do not merge with any of the above. |

## Rule for future scripts

- The source of truth for name identity is `data/scholar-profiles.json`
  `nameAliases` (variant → canonical). If two names are not linked
  there, treat them as **different people** — do not infer from surname,
  first-name overlap, or partial matches.
- When in doubt, ask Ron. Do not "helpfully" propose a merge.

---

# Rosters — what counts as the master iTaukei scholar list

- **The progress-dashboard Google Sheet is the exhaustive master roster** of iTaukei
  scholars — the list Ron considers most comprehensive. It is generated from
  every unique iTaukei author or co-author in Zotero and is what
  `itaukei-scholar-province-progress.html` shows (currently ~474 rows).
- `data/scholar-profiles.json` is a **subset** — only scholars that have
  been opened / enriched in the admin dashboard. Do not treat its length
  as the true iTaukei population.
- KPIs, panel counters, and Excel exports that claim to represent the
  full iTaukei population must be reconciled against the Sheet roster,
  not against admin's opened-profiles count.

# Progress-Sheet append behaviour (Ron's standing preference)

- When a new scholar is checked as iTaukei in the admin dashboard and
  approved into the master list, the progress-dashboard Google Sheet
  **must append that person at the top of the list**, and the row
  number / id must **continue increasing** (never reset, never renumber
  existing rows).
- Rationale: newest additions are visible immediately at the top, but
  existing ids stay stable so links, bookmarks, and past screenshots
  keep pointing at the same person.
- This is the append-top-with-increasing-id pattern already wired into
  the Apps Script `upsertRoster` flow. Do not "tidy" it into
  chronological or alphabetical order, and do not renumber.


# Reconciled KPI methodology (A2 panel — iTaukei scholarship)

The `A2 — iTaukei scholarship` panel on the public database (and its Excel
mirror) classifies every Zotero item using the **union roster** below,
not surname matching:

- **Canonical set for classification** = admin canonicals
  (`scholar-profiles.json .scholars[].name`) ∪ every alias variant
  (`scholar-profiles.json .nameAliases` keys AND values) ∪ every
  progress-Sheet canonical (fetched at runtime from the `?mode=progress`
  endpoint, built as `"lastName, firstName"`).
- **Classification rule** (see `js/itaukei-database.js :: creatorIsItaukei`):
  a Zotero creator counts as iTaukei only if the keyified name resolves
  to a member of that canonical set — either directly, in
  "Last, First" flipped form, or with a middle initial dropped.
- **Never** classify solely on surname. `Fong, James` sharing a surname
  with `Fong, Patrick S.` does not make James's papers count as Patrick's,
  and vice versa. See "Fongs" section above.
- **Universities / countries for A2** come from
  `data/itaukei-graduate-studies.json` `worldPoints` — iTaukei-scoped
  graduate study only. A2 must NOT be broadened to include non-iTaukei
  author universities. See the “A1 Panel — DB-wide universities/countries”
  section below for how A1 differs.
- **A1 and A2 universities/countries MUST diverge.** A1 counts every
  thesis in the database (iTaukei + non-iTaukei author theses); A2 counts
  only iTaukei graduate study. If A1 and A2 ever show the same numbers
  for universities or countries, that is a bug — A1 has been
  incorrectly re-wired to the graduate-set. Fix A1, not A2.
- **Province coverage** comes from Zotero collection tags per item, not
  from scholar profiles.

## Standing KPI values as of 2026-07-13

Pipeline: admin canonicals + aliases + progress-Sheet master roster
(union of 461 unique iTaukei scholars), classified against
`itaukei-zotero-snapshot.json`.

| Panel | KPI | Value |
| ----- | --- | -----:|
| A1 | Indexed works | 2,225 |
| A1 | Unique authors | 4,250 |
| A1 | Theses | 1,007 |
| A1 | Universities represented | 191 |
| A1 | Countries represented | 21 |
| A1 | Fiji provinces studied | 14 |
| A2 | Publications with or by iTaukei | 1,578 |
| A2 | With iTaukei as Lead author | 1,056 |
| A2 | With iTaukei as co-author | 522 |
| A2 | Theses by iTaukei scholars | 381 |
| A2 | Universities of iTaukei graduate study | 68 |
| A2 | Countries of iTaukei graduate study | 15 |

If a future refresh moves any of these numbers, update this table in the
same commit and note the reason (new roster additions, cleanup of a
false-positive surname match, etc.).

# Typography — Arial-only rule for KPI numbers (standing preference)

- **Every KPI number, count, percentage, or numeric value** displayed on
  the vave-lab site (iTaukei survey, progress dashboard, admin, public
  research database, mockups shared for review) must be set in **Arial**.
- Never use Fraunces, Georgia, Cambria, or any serif / display face for
  numeric values. Serifs are fine for prose headings only.
- This applies to A1, A2, and any future panel — including all mockups
  before they're wired to production. If a mockup ships with a
  non-Arial number, that is a bug: fix it before sharing.
- Ron has repeated this rule multiple times. Do not let him repeat it again.

# Scholar-card ordering rule (public dashboard)

Scholar cards on `itaukei-research-database.html` are ordered by:

1. **Total publications** — descending.
2. **First-authored publications** — descending (tiebreaker).
3. **Canonical name** — ascending (final deterministic fallback only,
   never the primary tiebreaker).

Rationale: when two scholars have the same total publication count,
first-authored output is a better signal of scholarly contribution than
alphabetical order. Example: Finau and Meo both have 31 publications,
but Finau has 12 first-authored vs Meo's 1 — Finau appears first.

Implementation: `js/itaukei-database.js` around the enriched-rows
`.sort(...)` in the panel-render pipeline (search for
"Scholar-card leaderboard sort order"). Any future ordering change must
update this doc in the same commit.

# A1 Panel — DB-wide universities/countries

Before 2026-07-13 the A1 Panel's "Universities represented" and
"Countries represented" counters were wired to `gradUnis` / `gradCountries`
— the same set that feeds A2. This was wrong: A1 is supposed to describe
the ENTIRE database, including theses by non-iTaukei authors.

**Fixed methodology (current):**

- Iterate every Zotero item with `itemType == "thesis"`.
- Collect the raw `university` field (Zotero-populated per record).
- Skip only placeholder values (`Institution not stated in source catalog`,
  `UNSPECIFIED`).
- Resolve each university name to a country via, in order:
  1. `data/itaukei-graduate-studies.json` `worldPoints` (has coord+country for iTaukei-linked schools)
  2. `data/world-universities.json` (49 entries, curated for the iTaukei sub-collections)
  3. `data/uni-country-overrides.json` (curated fallback map covering ~127 non-iTaukei-author universities: USP variants, Fiji National University sub-schools, most US/UK/AU/NZ/CA universities, and orthographic variants like "The Univesity of the South Pacific")
- Match is case-insensitive; a leading "The " prefix is stripped as a fallback.

**When new theses land whose university strings aren't recognised**, add
them to `data/uni-country-overrides.json` (plaintext) and re-encrypt with
`VAVELAB_PASSCODE='…' python3 scripts/encrypt_data.py uni-country-overrides.json`.
Leave iTaukei-populated schools in `itaukei-graduate-studies.json` /
`world-universities.json` untouched — the override file is only for
names those two datasets don't cover.

Never re-collapse A1 back to `gradUnis`/`gradCountries`. A1 and A2 SHOULD
diverge on these two counters — A1 is broader by design.

# Panel A1 / A2 card labels and order (standing preference)

The public database KPI cards on `itaukei-research-database.html` must use
these exact labels and order. Do NOT rename, abbreviate, or reorder them
without an explicit Ron instruction changing the standard.

## Panel A1 — Database overview (all cards)

| Position | data-kpi         | Label                     |
| -------- | ---------------- | ------------------------- |
| 1 teal   | `db-works`       | Publications              |
| 2 rust   | `db-authors`     | Unique authors            |
| 3 amber  | `db-theses`      | Theses                    |
| 4 blue   | `db-unis`        | Universities represented  |
| 5 purple | `db-countries`   | Countries represented     |
| 6 pink   | `db-provinces`   | Fiji provinces studied    |

- Card 1 is "Publications" — NOT "Indexed works", NOT "Works", NOT "Total works".

## Panel A2 — iTaukei scholarship (all cards)

| Position | data-kpi        | Label                                                |
| -------- | --------------- | ---------------------------------------------------- |
| 1 teal   | `it-works`      | Publications with or by iTaukei                      |
| 2 rust   | `it-coauth`     | With iTaukei as co-author                            |
| 3 amber  | `it-led`        | With iTaukei as Lead author                          |
| 4 blue   | `it-theses`     | Theses by iTaukei scholars                           |
| 5 purple | `it-unis`       | Universities attended by iTaukei graduate researchers |
| 6 pink   | `it-countries`  | Countries of iTaukei graduate study                  |

- Co-author card (`it-coauth`) is position 2 (rust). Lead-author card
  (`it-led`) is position 3 (amber). Do not swap them back to the older
  "iTaukei-led works" first / "co-authors" second order.
- Card 3 uses "Lead author" (capital L, singular), matching the original
  mockup wording.
- Icons follow the labels: handshake for co-author, star for Lead author.
