# iTaukei Master-file Dashboard Rebuild

This document explains how the Master-file-driven dashboard pipeline
works, how to set it up, and how to operate it.

## Overview

The iTaukei Scholarly Research Database dashboard is being rebuilt so
that its data source is the authoritative Google Sheet
`iTaukei_Master_file` (spreadsheet ID
`1nJvMWLS8jnCOKtRoqdDpEW3s3j9TSAclXBO1txVFxdg`) instead of Zotero.

The rebuild preserves the existing dashboard's look, feel, panels
(A1, A2, A3, B1, B2, B3, B4, C1, C2, C3, D, E, F, G), interactions,
demo-view button, and passcode gate. Only the data layer changes.

**Production dashboard (unchanged):**
- `itaukei-research-database.html` + `js/itaukei-database.js` — still
  driven by Zotero via `refresh-zotero-snapshot.yml`.

**Preview dashboard (new, unlinked from nav until approved):**
- `itaukei-research-database-master.html` + `js/itaukei-database-master.js`
  — driven by Master-file JSON via `refresh-master-file.yml`.

## Pipeline architecture

```
iTaukei_Master_file Google Sheet
  │
  │ (service-account read, hourly*2)
  ▼
scripts/master_file_transformer.py
  │  · fetch 6 core sheets (Scholars, Publications, Authorship,
  │    Graduate Degrees, M>PhD mobility, Research Geography)
  │  · sanitize against public-field allowlists
  │  · compute aggregates + iTaukei-associated bridge
  ▼
data/itaukei-master-*.json  (plaintext, gitignored)
  │
  │ (reconciliation vs. Dashboard sheet — strict)
  ▼
scripts/encrypt_data.py  (AES-GCM, existing pipeline)
  │
  ▼
data/itaukei-master-*.json.enc  (committed to main)
  │
  │ (fetch + decrypt in browser via js/db-gate.js)
  ▼
itaukei-research-database-master.html  → dashboard renders
```

## One-time setup

### 1. Create a Google Cloud service account

The workflow needs read-only access to the Master file. Because the
Master file is private (unlike Zotero), we cannot use anonymous access.

Steps:

1. Go to https://console.cloud.google.com/ and select or create a project.
2. Enable the **Google Sheets API** for that project.
3. In IAM & Admin → Service Accounts → **Create service account**:
   - Name: `vavelab-master-file-reader`
   - Description: "Read-only access to iTaukei_Master_file for the
     GitHub Actions refresh workflow."
   - Skip the optional grant-access step (no IAM roles needed — the
     account will only see files explicitly shared with it).
4. Open the new service account → **Keys** → **Add key** → **Create new key**
   → JSON. Download the JSON key file (it will only be shown once).
5. The JSON contains a `client_email` field like
   `vavelab-master-file-reader@your-project.iam.gserviceaccount.com`.
   Copy that email address.
6. Open the Master-file Google Sheet
   ([open here](https://docs.google.com/spreadsheets/d/1nJvMWLS8jnCOKtRoqdDpEW3s3j9TSAclXBO1txVFxdg/edit))
   → **Share** → paste the service-account email → select **Viewer**
   → uncheck "Notify people" → **Share**.

### 2. Add the key as a GitHub Secret

1. Open the JSON key file in a text editor. Select **all** content.
2. Go to https://github.com/ronvave/vave-lab/settings/secrets/actions
   → **New repository secret**.
3. Name: `GOOGLE_SERVICE_ACCOUNT_JSON` (exact spelling).
4. Value: paste the entire JSON content. Save.

The existing `VAVELAB_PASSCODE` secret is reused — no need to add it again.

### 3. First manual run

1. Go to https://github.com/ronvave/vave-lab/actions/workflows/refresh-master-file.yml
2. Click **Run workflow** → set `force_commit=true` → **Run workflow**.
3. Watch the run. Expected: ~1-2 minutes; commit like
   `Auto-refresh: Master-file snapshot (delta 100.00%)`.

## Data files produced

Every workflow run produces (encrypted to `.enc` before commit):

| File | Purpose |
| --- | --- |
| `data/itaukei-master-scholars.json` | Sanitized scholar records (35 public fields + derived `effective_paternal_province`, `effective_confederacy`). |
| `data/itaukei-master-publications.json` | Sanitized publications (18 public fields + one-hot Fiji-geography columns + derived `_provinces`, `_confederacies`, `_is_itaukei_associated`, `_linked_scholar_ids`). |
| `data/itaukei-master-authorship.json` | The Scholar↔Publication bridge (7 public fields + derived `_is_lead`). |
| `data/itaukei-master-grad-degrees.json` | Sanitized graduate degrees (17 fields incl. C_Uni + O_Uni). |
| `data/itaukei-master-mobility.json` | M>PhD mobility rows (18 public fields; coords parsed as floats). |
| `data/itaukei-master-geography.json` | Research-geography records (9 public fields). |
| `data/itaukei-master-aggregates.json` | Pre-computed KPIs for headline panels. |
| `data/last-master-sync.json` | Timestamp + summary counts. |

## Sanitization policy

Every write goes through a hard allowlist defined in
`scripts/master_file_config.py`. Any field not on the allowlist is
dropped before writing JSON. Never edit the allowlist without
approval — several sheet columns are intentionally private:

- Scholars: `Vanua / Provenance Notes`, `Review Status`, `Source Basis`,
  `BibTeX Author Match`, `BibTeX Author Occurrences`,
  `Name Variants / Aliases`, `Record Notes`.
- Publications: `Abstract`, `Discovery / Source URL`, `Deduplication Key`.
- Graduate Degrees: `Thesis / Repository URL`, `Evidence URL 1/2`,
  `Verification`, `Notes`, `Study Date Evidence / Notes`.
- Mobility: `m_title`, `p_title`, `Info link1/2`, `Notes`.

### O_Uni vs C_Uni

`O_Uni name` is **historical institutional metadata** — the name the
institution had when the degree was awarded (e.g. old university name
before a merger). It is not inherently private and may be surfaced
selectively in degree-detail tooltips or profile metadata for
explanatory context.

**But it must never be used for institutional counts, aggregations,
filters, maps, or mobility calculations.** Those all use `C_Uni name`
exclusively. The transformer keeps both fields in the sanitized JSON
so the frontend can display O_Uni in tooltips while all its
aggregations key on C_Uni.

### iTaukei-association is bridge-only

`_is_itaukei_associated` on a publication is true iff there is at
least one row in the Authorship bridge that links the publication
to a Scholar ID in the current active roster. **Never infer iTaukei
identity from surname, given name, or affiliation** — the Authorship
sheet is the single source of truth (guide §8).

## Reconciliation tests

`scripts/master_file_reconcile.py` parses the `Dashboard` worksheet
of the Master file and compares its published QA values against the
transformer's computed aggregates.

- Runs on every refresh workflow.
- `--strict` mode causes CI to exit non-zero on any mismatch.
- Small drifts (±1 to ±5) are expected when the sheet's `Dashboard`
  tab has been updated less recently than its underlying data tabs.
  Use `--tolerance N` to allow up to N of drift per metric.

Metrics reconciled:
- Scholars (total + by gender)
- Publications (total + headline 5 + iTaukei-associated + non-iTaukei-only)
- Authorship links + scholars-with-links
- Grad-degree episodes (total + international)
- Per-publication-type breakdown (Journal Article, Master's Thesis,
  PhD Thesis, Book Chapter, Book — all + iTaukei splits)
- Grad stats (Completed Master's, Completed PhD, Current PhD,
  Both Master's + PhD)

## Failure handling

The workflow is designed to fail **safely**: on any transformer error,
reconciliation mismatch (in strict mode), or encryption failure, the
step exits non-zero **before** encrypting or committing, so the
existing `.enc` files on `main` are preserved. The dashboard continues
to serve the last valid snapshot.

## Cadence

- **Automatic**: every 2 hours (`0 */2 * * *` UTC).
- **Manual**: workflow_dispatch button in Actions. Optional inputs:
  - `force_commit=true` — commit even when totals drift <2%.
  - `dry_run=true` — run transformer + reconciliation but don't commit.

## Local development

```bash
# One-time: dump the Master file to /tmp for offline work.
python3 scripts/dump_master_file.py   # requires gws CLI + credentials

# Run the transformer against the local dump.
python3 scripts/master_file_transformer.py \
  --mode=local \
  --out-dir=/tmp/master-out

# Run reconciliation.
python3 scripts/master_file_reconcile.py \
  --mode=local \
  --snapshot-dir=/tmp/master-out \
  --tolerance=10   # tolerate ≤10 drift per metric locally
```

## Troubleshooting

**Q: The workflow fails with "GOOGLE_SERVICE_ACCOUNT_JSON env var not set".**
The GitHub Secret is missing or misnamed. Verify at
[repository settings](https://github.com/ronvave/vave-lab/settings/secrets/actions).

**Q: The workflow fails with "HttpError 403: The caller does not have permission".**
The Master-file sheet has not been shared with the service-account email.
Re-open the sheet's Share dialog and add
`vavelab-master-file-reader@your-project.iam.gserviceaccount.com`
as Viewer.

**Q: Reconciliation drifts by more than a few units.**
Open the Master file's `Dashboard` tab and confirm its formulas have
refreshed (they usually recalculate on open). If drift persists, run
the Change Log tab check — the recent Change Log activity should
explain the delta.

**Q: I need to add a new public field.**
Edit the allowlist in `scripts/master_file_config.py` and re-run
locally. Any field NOT on the allowlist is dropped before writing.

**Q: The old Zotero pipeline is still running — do I need to stop it?**
No. Keep it running while V2 is in preview. Retire it only after you
approve V2 as the production dashboard and update the production HTML.
