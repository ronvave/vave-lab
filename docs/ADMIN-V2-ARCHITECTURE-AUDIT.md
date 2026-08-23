# Admin dashboard for the Master-file iTaukei Scholar dashboard — architecture audit and proposed plan

**Deliverable status:** audit only, no code changes. Awaiting Ron's approval before implementation (per section 16 of the revised prompt).

**Author:** Perplexity Computer, 2026-08-22 HST
**Scope:** New Admin dashboard for `itaukei-research-database-master.html` (Panel F enrichment). Old admin (`admin.html`) is left untouched.

---

## A. Old architecture (Zotero → old admin → old Panel F)

**Data flow**

```
Zotero library (531 pubs, ~4,637 authors)
  ↓ refresh-zotero-snapshot.py + workflow
data/itaukei-zotero-snapshot.json.enc
  ↓
admin.html + js/admin.js
  ↓ (admin enrichment: village, institution, ORCID, photo, etc.)
data/scholar-profiles.json.enc            ← identity+profile
data/scholar-insights.json.enc            ← keywords + summary + sources
img/scholars/*.jpg                        ← photos (via GitHub PAT)
  ↓
itaukei-research-database.html + js/database.js → old Panel F cards
```

**Old admin.html specifics**

- Roster is derived by extracting **every unique author from Zotero** (`~4,637` rows), then Ron toggles the iTaukei checkbox per author. That toggle list is persisted in `scholar-profiles.json.enc` under `notItaukeiAuthors` / `hiddenScholars` / `nameAliases`.
- Primary key is the **author name string** (`"Last, First"`) — with alias-chain resolution and a first-token fallback for spelling variants.
- Encryption is IVAV / AES-GCM via `js/db-gate.js` (`window.dbGate.fetchJson` decrypts, `window.dbGate.encryptForUpload` encrypts).
- GitHub writes: `js/admin.js` calls the Contents API directly (`PUT /repos/ronvave/vave-lab/contents/{path}`) using a **Personal Access Token** the user pastes in the admin and stores in `localStorage` (`vavelab_gh_token`). Never committed. Retry logic handles 409/422 sha races.
- Photo pipeline (`admin.js` L1500–1830):
  - Drop image → resize to 400×400 JPEG in-browser
  - If a PAT is set: `PUT contents/img/scholars/<slug>.jpg` directly, form's `photo` field is set to `img/scholars/<slug>.jpg`
  - No PAT: base64 preview + downloadable file for manual repo commit
- Insights: paste-in JSON dialogue, keyed by `"Last, First"` name (with alias resolution). Merges into `scholar-insights.json.enc` and pushes.
- Extra buttons: "Save iTaukei toggles", "Push all to GitHub", "Sync to survey sheet", "Copy for Google Sheets", "Copy all as JSON".

---

## B. Current V2 architecture (Master file → V2 dashboard → current Panel F)

**Data flow**

```
iTaukei Scholar Master Google Sheet (29 tabs)
  ↓ .github/workflows/refresh-master-file.yml (every 2h, service account)
    → scripts/refresh_master_file.py
  ↓
data/itaukei-master-scholars.json.enc
data/itaukei-master-publications.json.enc
data/itaukei-master-authorship.json.enc     ← ground truth for pub↔scholar links
data/itaukei-master-grad-degrees.json.enc
data/itaukei-master-geography.json.enc
data/itaukei-master-aggregates.json.enc
data/itaukei-master-mobility.json.enc
  ↓
js/master-file-adapter.js  (buildProfiles, builds a Zotero-shaped `bundle`)
  ↓
js/itaukei-database-master.js → Panel F (renders scholar cards)
```

**How V2 Panel F reads scholars today (crucial finding):**

1. `js/master-file-adapter.js` `buildProfiles(master, snap)` produces `bundle.profiles.scholars[]` where each row has `scholarId` **and** `name = "Last, First"`. Master-file fields (gender, village, institution, ORCID, etc.) already flow through.
2. `js/itaukei-database-master.js` then indexes profiles by `"Last, First"` **name string**, not by Scholar ID (`state.scholarProfilesByName`).
3. Panel F's row builder (function `computeScholarRows()` around L7385–7605) still runs the **Zotero-collection-based counting logic** — it iterates `state.snapshot.items` and matches to `Zotero sub-collections` and admin `nameAliases`.
4. The adapter fabricates synthetic Zotero collections from `master.authorship`, so this "works" but is a lossy indirection: counts depend on how the adapter reshapes Master → synthetic Zotero rather than being read directly from the authoritative `Authorship` table.

**Why the counts drift (Veitayaki 73 / 81 / 75 / 68):**

Verified against Master file `Authorship` sheet directly via Sheets API today:

| Source | Total | First-authored |
| --- | --- | --- |
| **Master file `Authorship` (authoritative)** | **75** | **38** |
| Old dashboard (Zotero snapshot) | 73 or 81 | 37 or 39 |
| Current V2 dashboard (as displayed) | 75 | 68 |

Diagnosis:
- The **75** total on V2 is correct — matches Master file.
- The **68 first-authored** is wrong. The adapter's synthetic-Zotero indirection is misrouting Veitayaki's authorship-position signal. The Master file has `Is First Author?` and `Author Position` per row, but Panel F's counter re-derives first-authorship by comparing `creators[0]`'s last name to the scholar's last name — because iTaukei-only authorship rows drop non-iTaukei co-authors, an iTaukei co-author often ends up at `creators[0]` after sorting, so the last-name-match trips true.

**Independent Master-file check for other scholars:**

| Scholar | Master Authorship total / first | Old dashboard (screenshot 2) |
| --- | --- | --- |
| Veitayaki, Joeli (ITK-S0315) | 75 / 38 | 81 / 39 |
| Ratuva, Steven (ITK-S0195) | 53 / 47 | 66 / 54 |
| Waqa, Gade (ITK-S0339) | 63 / 13 | 65 / 14 |
| Tabudravu, Jioji N. (ITK-S0244) | 65 / 14 | 65 / 14 |
| **Ravulo, Jioji (ITK-S0379)** | **1 / 1** | 68 / 45 |

**Ravulo is essentially empty in the Master `Authorship` table.** This is a data-completeness gap in the Master file, not a Panel F bug. The audit surfaces it; the admin cannot invent data — Ron needs to link Ravulo's publications on the `Authorship` tab of the Master sheet.

---

## C. Proposed architecture (new admin → V2 Panel F)

### C.1 Data ownership map (single source of truth per field)

| Field group | Owner | Where it lives | Admin behavior |
| --- | --- | --- | --- |
| Scholar ID | Master file | `Scholars.Scholar ID` | Read-only in admin (primary key everywhere) |
| Canonical name (`Family Name`, `Given Names`) | Master file | `Scholars` cols 2-3 | Read-only |
| Gender | Master file | `Scholars.Gender` | Read-only (edit in Sheet) |
| Alive / deceased | Master file | `Scholars.Alive / Deceased` | Read-only |
| Paternal/maternal province, village | Master file | `Scholars` cols 7-14 | Read-only |
| Confederacy | Master file (derived) | `Scholars.Paternal Confederacy` | Read-only |
| Discipline / field | Master file | `Scholars.Primary Discipline / Field` | Read-only |
| Current institution / country / department | Master file | `Scholars` cols 18-20 | Read-only |
| Professional title | Master file | `Scholars.Current Title / Role` | Read-only |
| Profile URL | Master file | `Scholars.Current Profile URL` | Read-only |
| ORCID | Master file | `Scholars.ORCID / Researcher ID` | Read-only |
| Google Scholar URL | Master file | `Scholars.Google Scholar URL` | Read-only |
| Masters / PhD university + country | Master file | `Graduate Degrees` sheet | Read-only |
| **Photo path** | **Admin** | new `data/scholar-enrichment.json.enc`, keyed by Scholar ID; file at `img/scholars/<ITK-Sxxxx>.jpg` | Editable — drop or URL |
| **Institution website URL** | **Admin** | same enrichment file | Editable |
| **Department website URL** | **Admin** | same enrichment file | Editable |
| **Sector** | **Admin** | same enrichment file | Editable (dropdown) |
| **Year of birth / death** | **Admin** | same enrichment file | Editable |
| **Research keywords** | **Admin** | new `data/scholar-insights-master.json.enc`, keyed by Scholar ID | Paste-in JSON |
| **Plain-English summary** (HTML with weblinks) | **Admin** | same insights file | Paste-in JSON |
| **Sources list** for summary | **Admin** | same insights file | Paste-in JSON |
| **Total publications, first-authored, type breakdown** | Master file (derived) | Computed live from `master.authorship` + `master.publications` | Read-only — new canonical function |

Rule: if it's in the Master file, admin never overrides it. Admin fields are **strictly supplementary**.

### C.2 File inventory

**Retained (untouched):**
- `admin.html` + `js/admin.js` — the old admin stays operational for anyone still using Zotero-only data.
- All existing Master-file refresh workflow files (`refresh-master-file.yml`, `scripts/refresh_master_file.py`, `scripts/master_file_config.py`).
- All existing `data/itaukei-master-*.json.enc` files.
- `js/db-gate.js` — reused as-is for IVAV / AES-GCM.

**Modified:**
- `js/itaukei-database-master.js`:
  1. Fix Panel F counts to read directly from `master.authorship` (canonical counts function; details in C.5).
  2. Extend scholar-profile lookup so it prefers **Scholar ID** as the join key when available, with `"Last, First"` name lookup as fallback for legacy data.
  3. Merge new admin enrichment fields (photo, sector, institution URL, dept URL, birth/death year) and new insights file into the card renderer.
- `js/master-file-adapter.js`:
  1. Load two new files: `data/scholar-enrichment.json.enc` and `data/scholar-insights-master.json.enc` (both optional; missing = empty).
  2. Merge those into `bundle.profiles.scholars[i]` keyed on `scholarId`. This keeps the downstream contract unchanged.
- `itaukei-research-database-master.html`: bump cache-buster, no visual changes.

**Created:**
- `admin-master.html` — new admin page, separate from `admin.html`. Structurally similar (data source panel, scholar list, edit modal, JSON paste-in) but Master-file-first.
- `js/admin-master.js` — new admin logic (Scholar ID primary key, GitHub push helpers reused, canonical count function shared with the dashboard).
- `data/scholar-enrichment.json.enc` — initially empty `{ "scholars": {} }` shape: `{ "<ITK-Sxxxx>": { photo, institutionUrl, departmentUrl, sector, yearOfBirth, yearOfDeath, updatedAt } }`.
- `data/scholar-insights-master.json.enc` — initially empty `{ "scholars": {} }` shape: `{ "<ITK-Sxxxx>": { canonicalName, keywords[], summaryHtml, summaryFormat, sources[], updatedAt } }`.
- `img/scholars/` (already exists) — photos filed as `<ITK-Sxxxx>.jpg` going forward (old name-slug files remain valid; enrichment field points at whichever path).
- `docs/ADMIN-V2-ARCHITECTURE-AUDIT.md` — this document.

**Obsolete (NOT carried over):**
- "Authors extracted from Zotero" author-triage table + iTaukei toggle checkboxes.
- `notItaukeiAuthors`, `nameAliases`, `hiddenScholars`, "Save iTaukei toggles", "Mark selected as non-iTaukei", merge-selected UI. (Master file's `Scholars` sheet IS the roster.)
- "Sync to survey sheet" button (progress-roster survey has its own path).
- "Copy for Google Sheets" / "Copy all as JSON" (writes go directly to the encrypted file + repo).
- `refresh-zotero-snapshot.yml` workflow trigger button (irrelevant).

### C.3 Schemas (new files)

**`data/scholar-enrichment.json.enc`** (encrypted plaintext form):

```json
{
  "version": 1,
  "updatedAt": "2026-08-23T05:30:00Z",
  "scholars": {
    "ITK-S0315": {
      "canonicalName": "Veitayaki, Joeli",
      "photo": "img/scholars/ITK-S0315.jpg",
      "institutionUrl": "https://www.blueprosperityfiji.org/team",
      "departmentUrl": "",
      "sector": "Government / SIDS agency",
      "yearOfBirth": 1958,
      "yearOfDeath": null,
      "updatedBy": "ron",
      "updatedAt": "2026-08-23T05:30:00Z"
    }
  }
}
```

**`data/scholar-insights-master.json.enc`** (encrypted plaintext form):

```json
{
  "version": 1,
  "updatedAt": "2026-08-23T05:30:00Z",
  "scholars": {
    "ITK-S0315": {
      "canonicalName": "Veitayaki, Joeli",
      "keywords": [
        "Community-Based Fisheries Management",
        "Locally Managed Marine Areas",
        "Ocean Governance",
        "Blue Economy Development",
        "Gau Island Conservation",
        "Traditional Resource Management",
        "Marine Spatial Planning",
        "Poverty Alleviation through Fisheries",
        "Climate Change Resilience"
      ],
      "summaryHtml": "Veitayaki has spent decades studying and building community-based fisheries management … <a href=\"https://…\">Pacific ocean governance and the law of the sea</a>. He is now a strategic advisor for <a href=\"https://www.blueprosperityfiji.org/…\">Blue Prosperity Fiji</a> …",
      "summaryFormat": "html",
      "sources": [
        { "title": "Pacific ocean governance and the law of the sea", "url": "https://…", "publicationId": "veitayaki_2018_law_sea" },
        { "title": "Blue Prosperity Fiji roadmap", "url": "https://…" }
      ],
      "generatedBy": "manual-paste",
      "generatedAt": "2026-08-23T05:30:00Z"
    }
  }
}
```

Rules built into the admin:
- Primary key is **Scholar ID**; the `canonicalName` field is metadata only (for debugging).
- Unknown Scholar IDs on paste: reject the whole paste with a diagnostic (do not silently create orphan records).
- JSON is validated (JSON parse + shape check) before merging. Existing records not in the paste are preserved.
- Preview step before commit: show a diff of "will replace ITK-Sxxxx (was N keywords, now M)" and "unknown Scholar IDs: […]".

### C.4 Photo pipeline

- Same drop-or-URL UX as old admin, but filename is `img/scholars/<ITK-Sxxxx>.jpg` (Scholar ID slug, not name — survives renames).
- 400×400 JPEG resize in-browser (reuse the old admin's resize helper by porting it).
- Push flow reuses `githubUploadFile` from old admin (Contents API + PAT + sha-race retry), extracted into a small shared helper `js/gh-upload.js` so both admins can import it.
- If no PAT: same downloadable-file fallback.
- Old name-slug files (e.g. `img/scholars/veitayaki-joeli.jpg`) remain valid: `enrichment.photo` stores whatever path the admin was given.

### C.5 Canonical count function (fixes 73/81/75/68)

Add a single shared function `computePublicationTotals(master, scholarId)` in `js/master-file-adapter.js`, returning `{ total, firstAuthored, types: {…} }`.

Logic:
- `total` = count of **distinct `Publication ID / BibTeX Key`** in `master.authorship` where `Scholar ID === scholarId`.
- `firstAuthored` = count of distinct publication IDs from that set where the scholar's row for that pub has `Is First Author? === true` OR `Author Position === 1`.
- `types` = same distinct-publication set, grouped by `master.publications[pid]['Entry Type'] / Publication Type`, using the existing `visualType()` mapping.
- Ignore conference papers (existing global rule).
- Ignore duplicate rows via the distinct-pub-ID set.
- Return zeros if the scholar has no rows in `Authorship`. This is the honest answer, and it will surface the Ravulo data gap (1/1 today) rather than mask it.

Panel F uses this function. Admin uses the same function. **One number, one place.**

### C.6 Auth model (per section 14 of the prompt)

- **Passcode gate:** reuse `js/db-gate.js` for data decryption. Ron can decide to use the same passcode as the old admin or set a new one — this is a runtime choice, not a code change.
- **GitHub credentials:** exactly the same model as old admin — PAT is pasted in the admin, stored only in the user's `localStorage`, sent as a Bearer token to `api.github.com`. Never committed. Never rendered on the public site. This is the current best practice given no server component.
- If Ron wants a stricter model (short-lived tokens, GitHub App), that's a follow-up — flagged but out-of-scope for this rebuild.

### C.7 Test plan (per section 17)

Before declaring complete, verify these scholars end-to-end (Master file → adapter → admin edit → dashboard reload):

1. **Veitayaki, Joeli (ITK-S0315)** — full profile; expect 75 / 38 counts after fix.
2. **Ratuva, Steven (ITK-S0195)** — full profile; verify multi-institution history.
3. **Nayacakalou, Rusiate (ITK-S0162)** — deceased scholar; verify memorial banner + `Year of birth/death`.
4. **Vuki, Veikila C. (ITK-S0327)** — female PhD; verify graduate-studies block populates from Master `Graduate Degrees` (Southampton, UK).
5. **Ravulo, Jioji (ITK-S0379)** — data gap; expect admin to display "Authorship table has 1/1; check Master file" warning so Ron is prompted to fill it.
6. **A scholar with only a Master's, no PhD** — ensure graduate-studies block gracefully omits PhD.
7. **A scholar whose current institution is outside Fiji** — verify country/sector display.
8. **A scholar with sparse profile** — verify all "not yet added" placeholders behave.
9. **Filters** — verify name / keyword / confederacy / sector / discipline / country filters see the new enrichment fields.
10. **Reload / redeploy persistence** — after admin push, hard-refresh public dashboard and confirm the card reflects the change once the .enc file arrives via CDN.

### C.8 Safety / rollback

- Everything new goes under new filenames — public dashboard degrades gracefully if `scholar-enrichment.json.enc` or `scholar-insights-master.json.enc` is missing (empty maps).
- All admin writes are single-file PUTs with sha-race retry (reused from old admin).
- Admin never writes to `Master file` Google Sheet or to any existing `itaukei-master-*.json.enc` file.
- Full snapshot backups: commits are the history — every push is a diffable revision.
- One-shot "Preview" required before any commit.
- V1 dashboard (`itaukei-research-database.html`) and V1 admin (`admin.html`) are not touched.

---

## D. Open questions before I start coding

1. **Encryption gate.** Same passcode as the old admin, or new one? (Code-side, either works — you set the passphrase at unlock time.)
2. **Sector taxonomy.** The old admin had a dropdown — do you want the exact same list, or a revised set? (Default: I'll port the old list verbatim.)
3. **Photo naming rollover.** For scholars whose photo already exists at `img/scholars/veitayaki-joeli.jpg`, do you want the admin to auto-copy those to `img/scholars/ITK-S0315.jpg` on first-edit, or leave them where they are and just record the existing path? (Default: leave them where they are; record path as-is.)
4. **Ravulo-type data gaps.** If a scholar has zero Authorship rows, should Panel F still render their card (with `0 publications`, admin fields intact) or hide them until Ron links pubs? (Default: render with zeros — better than silently hiding.)
5. **Insights generation.** Paste-in only for now (fastest path), or do you want a "Generate" button that calls an AI pipeline? (Default: paste-in only — matches the old admin and keeps this rebuild scoped. Generation UI can be added later as a follow-up.)

Answer these five and I'll proceed with implementation.
