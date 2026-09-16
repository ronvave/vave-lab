# Master-file Admin (V2) — Handoff

Deployment status: **live**
Commit: `3337a4c` on `main`
URL: [admin-master.html](https://ronvave.github.io/vave-lab/admin-master.html)

The old V1 admin at [admin.html](https://ronvave.github.io/vave-lab/admin.html)
is unchanged and remains fully functional. This new admin only touches the
Master-file (V2) dashboard.

---

## What was built

### 1. `admin-master.html` — new admin dashboard

- Password gate (same hash as V1 admin, so the same password unlocks both)
- Database passcode gate (same shared `db-gate` prompt used by every V2 page)
- Four tabs:
  - **Scholar profiles** — filterable, sortable table of all Master scholars
  - **Authorship linkage gaps** — read-only diagnostic + prioritised repair queue
  - **Data source & GitHub** — GitHub PAT entry, refresh-workflow dispatch, file map
  - **Action log** — last 200 admin operations in this session

### 2. `js/admin-master.js` — admin runtime

- Loads Master data through `MasterFileAdapter.load()` — the same adapter the
  public dashboard uses. So Admin and Panel F cannot show different pub counts.
- Loads the old `data/scholar-profiles.json.enc` as **diagnostic reference only**,
  never as an authoritative count.
- Photo pipeline: drag-drop / file picker → center-crop → 400×400 JPEG (quality 0.9)
  → PUT to `img/scholars/<ITK-Sxxxx>.jpg` via the GitHub Contents API.
- Enrichment save: merges admin-owned fields into the Scholar-ID-keyed doc,
  encrypts with `dbGate.encryptForUpload()`, PUTs to `data/scholar-enrichment.json.enc`.
- Insights save: same flow, into `data/scholar-insights-master.json.enc`.
- GitHub PAT is stored **only** in this browser's `localStorage` (`vavelab_gh_token`).
  Never transmitted anywhere except `api.github.com`.
- Sha-race retry on 409/422 (one retry with a re-fetched sha).

### 3. Adapter integration

`js/master-file-adapter.js` now:

- Loads `data/scholar-enrichment.json.enc` (optional; 404 → empty) and merges
  the Scholar-ID-keyed fields (photo, institutionUrl, departmentUrl, sector,
  yearOfBirth, yearOfDeath, deceased, orcid override, googleScholarUrl override,
  profileUrl override) into `buildProfiles()`.
- Loads `data/scholar-insights-master.json.enc` (optional; 404 → empty) and
  exposes it two ways on the bundle: `insightsDoc.insights` (name-keyed, so the
  existing Panel F dashboard works with no changes) and `insightsDoc.byScholarId`
  (Scholar-ID-keyed, for anything new).
- `computePublicationTotals(master, scholarId)` is the **single canonical
  publication-count function**. Panel F and the Admin both call it; they cannot
  drift. First authorship is read from Master `Authorship` (`Is First Author?` /
  `Author Position === 1`), never reconstructed from Zotero `creators[0]`.

### 4. `data/scholar-enrichment.json.enc` + `data/scholar-insights-master.json.enc`

**Not created yet.** They're created on the first admin save, with the same
encryption pipeline. Until then the adapter falls back to an empty doc, so the
public dashboard and admin render fine with zero enrichment.

### 5. Cache-buster

`mf19` → `mf20` on `itaukei-research-database-master.html` (5 refs) so browsers
pull the updated adapter + dashboard JS.

---

## Setup steps (one-off — takes about 3 minutes)

1. Open [admin-master.html](https://ronvave.github.io/vave-lab/admin-master.html).
2. Enter the admin password (same as the V1 admin).
3. Enter the shared database preview passcode (same as V2 dashboard).
4. Click **Data source & GitHub** tab.
5. Create a fine-grained GitHub PAT with **Contents: Read and write** on
   [ronvave/vave-lab](https://github.com/ronvave/vave-lab) at
   [github.com/settings/tokens?type=beta](https://github.com/settings/tokens?type=beta).
6. Paste the token, click **Save token**. Status pill should turn green (`token ok`).
7. Go back to **Scholar profiles**, click any scholar, edit, click **Save & push**.
   Watch GitHub Actions — no dispatch runs because the admin writes directly.
   Your changes appear on the public dashboard after the GitHub Pages CDN
   refresh (usually 30–90 seconds).

---

## Canonical count validation (spot-check)

| Scholar ID | Name | Master Auth total | 1st-auth | Old Zotero total | Status |
| --- | --- | --- | --- | --- | --- |
| ITK-S0315 | Veitayaki, Joeli | **75** ✓ | **38** ✓ | (target 75 / 38) | OK — matches user target |
| ITK-S0195 | Ratuva, Steven | 53 | 47 | — | OK |
| ITK-S0339 | Waqa, Gade | 63 | 13 | — | OK |
| ITK-S0244 | Tabudravu, Jioji N. | 65 | 14 | — | OK |
| ITK-S0327 | Vuki, Veikila C. | 4 | 2 | — | OK |
| ITK-S0379 | Ravulo, Jioji | 0 | 0 | 68 / 45 (from V1) | ⚠️ Authorship linkage incomplete |
| ITK-S0162 | Nayacakalou, Rusiate | 0 | 0 | — | ⚠️ Authorship linkage incomplete |

Panel F cards for the two flagged scholars now show 0/0 (per your approval
message #2 — keep the cards visible) with an admin-side "Authorship linkage
incomplete" flag.

---

## Prioritised gap list

The admin loads it on-demand:

1. Open [admin-master.html](https://ronvave.github.io/vave-lab/admin-master.html).
2. Click the **Authorship linkage gaps** tab.
3. The table is already sorted by **Old Zotero total desc**, so the scholars
   whose V1 dashboard showed the biggest publication footprints appear first.
   These are your highest-value linkage-repair targets.
4. Click **Download CSV** to grab a snapshot for offline planning.

Snapshot without old-Zotero context (Master-only) is also in the repo at
[`docs/master-authorship-linkage-gaps.csv`](../docs/master-authorship-linkage-gaps.csv)
and [`docs/MASTER-AUTHORSHIP-LINKAGE-GAP-REPORT.md`](./MASTER-AUTHORSHIP-LINKAGE-GAP-REPORT.md).
The admin-side CSV supersedes it because it adds the old-Zotero diagnostic column.

Full breakdown (unchanged since prior report):

- **472** scholars in Master.
- **306** have any Authorship rows.
- **166** have zero Authorship rows.
- **183** have only 1 Authorship row (likely incomplete).
- **349** total sparse-or-missing (74%).
- Only **16** cases where Master `Scholars.Linked Publication Count` disagrees
  with what `computePublicationTotals` counts from Authorship rows — the
  vast majority of gaps are agreed-upon zero/sparse, not a count mismatch.

---

## Data-file map

| File | Ownership | Notes |
| --- | --- | --- |
| `data/itaukei-master-scholars.json.enc` | Master sheet | Read-only. Refreshed every 2h. |
| `data/itaukei-master-publications.json.enc` | Master sheet | Read-only. |
| `data/itaukei-master-authorship.json.enc` | Master sheet | Read-only. Publication↔scholar linkage. |
| `data/itaukei-master-grad-degrees.json.enc` | Master sheet | Read-only. |
| `data/scholar-enrichment.json.enc` | This admin | Scholar-ID keyed. Photo / URLs / sector / years. |
| `data/scholar-insights-master.json.enc` | This admin | Scholar-ID keyed. Keywords / summary / sources. |
| `img/scholars/<ITK-Sxxxx>.jpg` | This admin | Photo files. |

Everything V1 depends on (`data/scholar-profiles.json.enc`, the old admin, the
Zotero-driven Panel F) is untouched.

---

## Not yet built / open TODOs

1. **Panel F card rendering of the "Authorship linkage incomplete" flag** on the
   public dashboard. Right now the flag is only surfaced in the admin. If you
   want visitors to see a small icon on cards where the count is 0/0 because of
   an unrepaired linkage (vs a genuine zero-pub scholar), that's a small tweak
   in `js/itaukei-database-master.js` around the Panel F row builder.
   The adapter already sets `_authorshipGap` on each Panel F row.

2. **Panel F insights rendering for the new Scholar-ID map.** The adapter
   currently maps admin insights back to the name-key so the existing Panel F
   lookup works. Once you're happy with the ID-first path, we can switch Panel F
   to prefer `state.scholarInsightsById[SID]` and fall back to the name.

3. **Reconstruct the old-Zotero diagnostic column into an offline CSV.** The
   admin already loads it in-browser; if you want a repo-committed prioritised
   CSV, we can regenerate `docs/master-authorship-linkage-gaps.csv` with the
   Old-Zotero column populated. It requires the passcode to decrypt
   `scholar-profiles.json.enc` locally.

4. **Bulk insights import from the old admin.** The old admin used a different
   insight file format (`data/scholar-insights.json.enc`, name-keyed). If you
   want to seed the new Scholar-ID-keyed `scholar-insights-master.json.enc` with
   the existing content, we can write a one-shot migration script that runs in
   the admin browser after unlock.

5. **Authorship-linkage repair workflow.** This admin flags gaps but does NOT
   edit the Master sheet. Repair happens in Google Sheets. If you want an
   assisted-repair panel that suggests matches, we'll spec it separately.

---

## Reversibility notes

- Every artifact this admin creates is a new file. Nothing in the V1 data
  layer is modified.
- If you want to roll back: `git revert 3337a4c` on `main`. That removes the
  new admin, the adapter enrichment/insights overlay, and the cache-buster
  bump. It does NOT remove any `scholar-enrichment.json.enc` /
  `scholar-insights-master.json.enc` / `img/scholars/*.jpg` files pushed
  after this commit — those are separate commits per save, each individually
  revertable.
