# Admin V2 — Phase 1 + Phase 2 status

Everything covered by the Aug 22, 2026 approval doc that could ship without a live Apps Script endpoint is now live in `main`. The next step is on your side: deploy the Apps Script Web App and connect the admin to it. After that, I can proceed with Phases 3–5 (editable fields, transactional save, conflict handling, Joeli round-trip test).

Two production surfaces are untouched, as required:

- `itaukei-research-database.html` (V1)
- `admin.html` (Old admin)

## What is live now (production)

### Phase 1a — Prioritised authorship-gap tab

Live at <https://ronvave.github.io/vave-lab/admin-master.html> → **Authorship linkage gaps** tab (deploys within ~1 min of the commit landing).

- New **Repair priority** column: VERY HIGH / HIGH / MEDIUM / LOW.
- Priority ladder (Doc 2 #29):
  - `no-authorship-rows` + oldTotal ≥ 30 → **VERY HIGH**; ≥ 10 → HIGH; ≥ 3 → MEDIUM; else LOW.
  - `sparse-authorship` + delta ≥ 30 → **VERY HIGH**; ≥ 10 → HIGH; ≥ 3 → MEDIUM; else LOW.
  - No old-Zotero footprint → LOW.
- Default sort is now Repair priority (VERY HIGH first).
- CSV export (Download CSV button) now emits the full Doc 2 #26 column set: Scholar ID, Scholar Name, Old-Zotero Total, Old-Zotero First-Author, Current Canonical Total, Current Canonical First-Author, Master Authorship Rows, Delta, Linkage Status, Repair Priority, Alive/Deceased, Discipline, Paternal Confederacy, Roster Tier.
- Old Zotero counts remain **diagnostic only** and never overwrite canonical Master values (approval-doc #9).

Ravulo-style example rendering: old 68/45 · Master 0/0 rows · linkage status INCOMPLETE · priority VERY HIGH.

### Phase 1b — Client-side V1 insights migration

Live at admin-master.html → new **Migration & tools** tab.

- Runs entirely in your already-unlocked admin session. Uses the same passcode you enter at the db-gate; there is **no separate passcode UI**, no passcode in code, no passcode in any log or migration report (approval-doc #8).
- Reads `data/scholar-insights.json.enc` (V1, name-keyed) via dbGate.
- Resolves each V1 key to a Master Scholar ID via: exact `Scholar Name` → exact `Family + Given` → `Family + first-token(Given)`.
- Classifies every entry as **MATCHED / AMBIGUOUS / UNMATCHED / INVALID**. Nothing is discarded (approval-doc #7).
- Preserves every V1 field verbatim: keywords, summary HTML with hyperlinks, `summaryFormat`, `signature`, `sources`, `summarySource`, `publicationCount`, `regeneratedAt`, `lastGeneratedUtc`. Adds `scholarId`, `legacyKey`, `migrationReason`, `migratedAt` provenance stamps.
- Preserves any existing V2 insights on collision — no regeneration of curated summaries.
- **Dry run** shows counts + first 8 items per bucket. **Download report (JSON)** produces an offline copy. **Write** encrypts and pushes `data/scholar-insights-master.json.enc` via the existing GH PAT helper.

You should run the dry run first, download the report, and review AMBIGUOUS + UNMATCHED before clicking Write.

### Phase 2 — Apps Script write-back endpoint + admin wiring

Live in the repo, not yet deployed. Once you deploy it, the admin can start writing back to the Master sheet.

- Server: `apps-script/master-writeback.gs`.
- Deploy doc: `docs/APPS-SCRIPT-DEPLOY.md` (~10 minutes, one-time).
- Mapping mirror: `data/admin-master-mapping.json` (admin renders the correct inputs; server re-validates independently).
- Client: `js/admin-writeback-client.js` (endpoint + secret in localStorage only).
- Admin UI: new **Master write-back endpoint** card in the Data source & GitHub tab (URL + secret inputs, Save / Test connection / Clear, status pill).

Auth model, per your approval-doc #1:

- Shared secret in ScriptProperties, constant-time compare, 5-minute replay window.
- LockService (30s timeout) around every write batch.
- Server rereads the current cell inside the lock and hard-rejects with a 5-column conflict diff when it has drifted (approval-doc #5).
- `WRITE_ENABLED` script property is a server-authoritative kill switch (approval-doc #6). `ping` / `describe` still work when disabled so the admin can display an explicit banner.
- Actor stamp is `"Ron Vave (admin)"` (approval-doc #4). No IP collection.
- No credentials are exposed in Pages HTML/JS.

Allowlist (approval-doc #14 — no worksheet not in this list is writable):

- **Scholars**: Scholar Name, Family Name, Given Names, Gender, Alive/Deceased, Province Paternal/Maternal, District Paternal/Maternal, Island Paternal/Maternal, Village Paternal/Maternal, Primary Discipline/Field, Current Title/Role/Institution/Country/Department, Current Profile URL, ORCID, Researcher ID, Google Scholar URL.
- **Positions** (per-row, requires `rowNumber`): Institution, Country, Department/Unit, Title, Academic Rank, Leadership Title/Category/Level, Role Status, Start Year, End Year, Source URL, Evidence/Notes, Last Verified.
- **Graduate Degrees** (per-row, requires `rowNumber`): Degree Stage, Qualification, Field, C_Uni name, O_Uni name, Country, International from Fiji?, City, Region, Year-Status, Completion Status, Thesis Title, Start Year, Finish Year, Duration.
- **Change Log**: append-only via the endpoint. Existing header row is not renamed; new detail lives in columns F–J which the sheet already has.

Fields that are explicitly **not writable** (derived / mirrored / cache):

- `Linked Publication Count`, `First-Author Publication Count`, `effective_paternal_province`, `effective_confederacy`, all `*Episodes`, `Awards Count`, `Gold Medals`, `Roster Tier`, `Leadership Category/Level` (Scholars cache), `Highest Completed Degree`, `Current PG Status`, and any derived Confederacy field (Maternal Confederacy is UI-derived from Master Lookups Province → Confederacy, per approval-doc #10).

### Safe changes already shipped in earlier commits

- Default sort on Scholar profiles is publication count DESC (Doc 1 #1).
- Maternal Confederacy is derived and displayed alongside Paternal (approval-doc #10). No new Master column.
- V2 dashboard card shows a subtle "publication linkage being updated" flag when a scholar has zero canonical Authorship rows (Panel F, Doc 1 #10).
- Cache-buster is at `mf22`.

## What still needs your action

### 1. Deploy the Apps Script

Follow `docs/APPS-SCRIPT-DEPLOY.md`. It's ~10 minutes:

1. Master sheet → Extensions → Apps Script → paste `apps-script/master-writeback.gs` in a new project.
2. Run `generateSecret` once to produce a fresh 64-hex secret.
3. Set Script Properties: `SHARED_SECRET`, `WRITE_ENABLED=true`, `ADMIN_ORIGIN=https://ronvave.github.io`.
4. Deploy → New deployment → Web app → Execute as: **you**, Access: **Anyone with the link**. Copy the `/exec` URL.
5. Admin V2 → **Data source & GitHub** tab → **Master write-back endpoint** → paste URL + secret → **Save endpoint** → **Test connection**.

Expected: status pill turns green with `ping ok · WRITE_ENABLED=true · actor=Ron Vave (admin) · tz=Pacific/Honolulu`.

If you see any error at Test connection, take a screenshot of the status pill + detail line and I will debug in the next round.

### 2. (Optional) Run the insights migration dry run

While the endpoint is being deployed, you can run the Migration tab's dry run at any time. It doesn't need the endpoint — it uses the GitHub PAT you already have configured to push the resulting `.enc` file.

## Positions worksheet — inspection findings (for your visibility)

Confirmed from a read of `Positions!A4:V500`:

- Header row is **row 4**. Rows 1–3 are title/notes.
- **`Role Status`** is the current-position identifier. Values found: `Current` (58 rows), `Past` (29), `Historical` (27), plus suffixed variants (`Current / latest verified`, etc.).
- 354 rows filled of 1093 provisioned.
- 56 scholars have at least one `Current` row; two scholars have >1 concurrent Current row (ITK-S0080, ITK-S0116).
- **Joeli Veitayaki (ITK-S0315) has zero rows in Positions.** His current-position data lives on the Scholars tab (Current Title / Institution / Country / Department) as hand-maintained mirrors.
- `Scholars.Current *` are **hand-maintained mirrors**, not formulas from Positions. Some semicolon-concatenate multiple concurrent positions (Nabobo-Baba: "Professor; Vice-Chancellor").

Design decision, per approval-doc #11 ("do not create two independently editable authoritative copies"):

- Positions rows will be editable **per row**. `Role Status` is the current-position flag.
- Scholars-tab `Current *` fields will be editable but each shows a small "hand-maintained summary — update after editing the underlying Position rows" hint. No auto-sync formula is added (would be a structural Master change).
- For scholars with no Positions rows (Joeli), Scholars-tab `Current *` is the only writable path.

No structural change is required for Phase 3 to proceed. If we later want a formula-based mirror, that will come to you as a separate approval request.

## Files added / changed in Phases 1–2

- `apps-script/master-writeback.gs` (new)
- `data/admin-master-mapping.json` (new)
- `docs/APPS-SCRIPT-DEPLOY.md` (new)
- `js/admin-insights-migration.js` (new)
- `js/admin-writeback-client.js` (new)
- `js/admin-master.js` (Phase 1a gap CSV + priority; Phase 1b migration wiring; Phase 2 endpoint UI wiring)
- `js/master-file-adapter.js` (Maternal Confederacy derivation)
- `admin-master.html` (new Migration & tools tab; write-back endpoint card; Repair-priority column; badge CSS; cache-buster mf22)
- `itaukei-research-database-master.html` (linkage-flag CSS; cache-buster mf22)
- `js/itaukei-database-master.js` (linkage-flag rendering)
- `docs/ADMIN-V2-WRITEBACK-AUTH-PROPOSAL.md` (previously shipped auth proposal)

## Commits

- `522e179` — Doc 3 safe changes (default sort, Maternal Confederacy, Panel F flag).
- `4a546d7` — Write-back auth proposal doc.
- `c75f016` — Phase 1a + 1b (prioritised gaps CSV + insights migration).
- `3b93e00` — Phase 2 (Apps Script + endpoint client + Data-source UI + deploy doc).

Once you've deployed and Test connection returns green, ping me and I'll ship Phases 3, 4, and the Joeli round-trip test.
