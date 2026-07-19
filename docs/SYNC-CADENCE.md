# Public-dashboard sync cadence

> **See also: [`DATA-COVERAGE-GAPS.md`](DATA-COVERAGE-GAPS.md)** —
> end-to-end flow for new countries / universities entering Zotero,
> the auto-resolver, the E2E test, and how each panel picks them up.
> All numbered sections, searchable in one place.

## The rule

**Every panel on the public dashboard refreshes on the same cadence, from
the same data pipeline, on the same commit.**

That cadence is:

- **Scheduled** — every 3 hours, at `0 */3 * * *` UTC, via
  `.github/workflows/refresh-zotero-snapshot.yml`.
- **Forced** — any time you click **Run workflow** on the *Refresh iTaukei
  Zotero snapshot* action in the GitHub Actions tab, or push a commit that
  triggers the workflow. A forced run behaves identically to a scheduled
  run except it always commits even when no tracked total moved by more
  than the 2% threshold.

There is no per-panel schedule and no partial refresh. When the workflow
finishes, every panel is in sync.

## What "every panel" covers

Panels A through G on
[itaukei-research-database.html](https://ronvave.github.io/vave-lab/itaukei-research-database.html)
all read from the encrypted `.enc` blobs under `data/`:

| Data file (encrypted as `.enc`) | Drives which panels |
| --- | --- |
| `itaukei-zotero-snapshot.json` | A totals, B (province & confederacy), C (leaders + item lists), D (histogram), E (all publication cards), F (published-scholar list) |
| `itaukei-graduate-studies.json` | A2 by-country counts, world map bubbles, university drill-down |
| `scholar-profiles.json` | Scholar cards (photo, village, province, institution), Countries / Universities of study filter, Countries / Institutions of work filter, discipline & sector filters, mobility spreadsheet |
| `fiji-provinces.geojson` | Fiji province map polygons, confederacy tallies |
| `workplace-coords.json` | Workplace bubble coordinates on the world map |
| `uni-country-overrides.json` | Country resolution for universities where the Zotero string is ambiguous |
| `scholar-insights.json` | AI-generated "Explain their research" text on scholar cards |
| `last-sync.json` | The Sync badge in the top-right corner of the site |

Because the workflow re-encrypts every `.enc` blob with a fresh shared
salt on every run, all files are rewritten together, and the site can
decrypt them all against the same key.

## The workflow steps (must stay in this order)

1. Decrypt existing `.enc` blobs into plaintext (needed for diffing).
2. Stash the previous snapshot to `/tmp`.
3. Regenerate `itaukei-zotero-snapshot.json` from the Zotero public API
   (`data/refresh-zotero-snapshot.py`).
4. Regenerate `itaukei-graduate-studies.json` from the fresh snapshot
   (`data/refresh-graduate-studies.py`).
5. **Backfill `scholar-profiles.json`** from `itaukei-graduate-studies.json`
   (`scripts/add_grad_only_scholars.py --apply`). This adds missing name
   stubs AND copies `masters` / `phd` degree metadata onto every profile
   whose admin fields are still empty. Admin edits are never overwritten.
6. Diff snapshot vs previous, write `last-sync.json`.
7. Re-encrypt every data file (`scripts/encrypt_data.py`).
8. Commit and push (`data/*.enc` only; plaintext stays gitignored).

Steps 3, 4, and 5 form a chain: each reads what the previous one wrote.
Reorder them and (for example) the profile backfill will run against
stale graduate-studies data.

## What can silently break the guarantee

- **Adding a new panel that reads a data file not in the table above.**
  If a panel reads a file the workflow doesn't rewrite, it will go stale
  independently of the sync badge. Add its source to this table AND to
  the workflow if it needs regenerating.
- **Adding a new source lookup (e.g. an API in Apps Script or Google
  Sheets) that isn't wired into the workflow.** Everything the public
  site depends on must flow through this workflow.
- **Silent failures in a middle step.** Steps 3, 4, and 5 all use
  `set -e` (implicit in the `run: |` shell), so a non-zero exit halts
  the run and the commit doesn't happen. If a run fails, the badge stops
  advancing — that's the signal to check the Actions tab.
- **Force-pushing an older `scholar-profiles.json.enc` from the admin
  dashboard.** The workflow doesn't overwrite admin-entered fields, but
  a full admin re-export will replace the whole file — that's fine, the
  next scheduled run will re-apply the degree backfills on top.

## Panels that DO NOT depend on this cadence

Some things on the site are computed at load time, in the browser, from
the same `.enc` blobs. They still refresh on the same cadence in
practice, because their inputs do:

- Panel D histogram year buckets, source-type stacking, and authorship
  splits — all computed client-side from
  `itaukei-zotero-snapshot.json`.
- Panel B2 confederacy totals — computed client-side from the item's
  Zotero collection membership + `fiji-provinces.geojson`.
- Panel F scholar filter chips (name, keyword, confederacy, sector,
  discipline, countries, etc.) — computed client-side from
  `scholar-profiles.json`.

If you add a new client-side computation, it inherits the every-3h
cadence for free as long as it reads only from these files.

## History

- **2026-07-17** — added `scripts/add_grad_only_scholars.py --apply` as
  Step 5. Without it, the "Countries / Universities of study" filter
  missed China, India, Portugal, Malta, South Korea, Canada, Germany,
  Sweden, Philippines, and Indonesia even though the world map showed
  bubbles for those countries. See the
  [Panel D + sync](../.github/workflows/refresh-zotero-snapshot.yml)
  workflow docstring for the full step list.
