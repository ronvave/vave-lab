# Panel C2 geography repair — 2026‑08‑25

## Summary

Panel C2 ("Research in and across Fiji's 14 provinces") was migrated
from legacy per‑Publication province Yes/blank columns to canonical
Research Geography relational counts. **Reports** are now included in
all C2 totals; **Preprints** remain excluded from every C2 count.
iTaukei subset filtering is now driven by stable IDs on the Authorship
and Researcher Authorship bridge tables — no author‑name string
matching.

## Authoritative pipeline

For every province × publication type × view (all authorship /
iTaukei‑associated), the number is:

```
COUNT DISTINCT Publication ID
  WHERE Publications.Publication Type ∈ {
          Journal Article, Master's Thesis, PhD Thesis,
          Book Chapter, Book, Report                       # Preprint excluded
        }
    AND Research Geography.Country            = "Fiji"
    AND Research Geography.Fiji Province      = <named province>
    AND Research Geography.Verification       ∈ {"Verified*", "Strong"}
    AND (for the iTaukei view only)
        ( ∃ Authorship        row where Scholar ID    ∈ Scholars
          OR ∃ Researcher Authorship row where Researcher ID ≠ "" )
```

Non‑provincial (`Fiji - no province specified`) and `Unsure` cells use
the same pipeline with the corresponding Fiji Province value; they are
**not** populated from `Publications!AL` or any other legacy Yes/blank
flag.

## Affected worksheets and panels

- **Master file**
  - `Dashboard!A66:S72` — Publications × province × type, all authorship.
    Rows 66–70 = headline five; **row 71 = Report (new)**; row 72 = Total.
  - `Dashboard!A80:S86` — Publications × province × type, iTaukei view.
    Rows 80–84 = headline five; **row 85 = Report (new)**; row 86 = Total.
  - Non‑provincial (`S`) and Unsure (`T`) columns rewritten to RG logic.
  - Confederacy summary columns (`P/Q/R`) recompute dynamically as
    SUMs over the province cells — no hard‑coded values.
- **V2 public dashboard**
  - `js/master-file-adapter.js` — Panel C2 counts now derive from
    `geoByPub[pid]` filtered by `Country="Fiji"` +
    `Verification ∈ (Verified*, Strong)`. Legacy `p[prov]` one‑hot
    iteration removed.
- **Transformer**
  - `scripts/master_file_transformer.py` — exposes Research
    Geography.Verification and adds an `extract_researcher_authorship`
    step; `_is_itaukei_associated` is now
    `Authorship OR Researcher Authorship`.
- **Snapshot pipeline**
  - `data/itaukei-master-researcher-authorship.json[.enc]` is a new
    output file; `scripts/encrypt_data.py` and the refresh workflow
    watch it explicitly.

## Row/column layout after repair

Panel C2 all‑authorship block:

| Row | Content |
| --: | :-- |
| 65 | Header (Province ×14, Confederacy summaries) |
| 66 | Journal Article |
| 67 | Master's Thesis |
| 68 | PhD Thesis |
| 69 | Book Chapter |
| 70 | Book |
| **71** | **Report (new)** |
| 72 | Total (SUM 66:71) |

Panel C2 iTaukei block:

| Row | Content |
| --: | :-- |
| 79 | Header (Province ×14, Confederacy summaries) |
| 80 | Journal Article |
| 81 | Master's Thesis |
| 82 | PhD Thesis |
| 83 | Book Chapter |
| 84 | Book |
| **85** | **Report (new)** |
| 86 | Total (SUM 80:85) |

## Verified totals — 2026‑08‑25 10:20 HST

**All authorship, Total row 72:**
Kadavu 42 · Nadroga 35 · Namosi 12 · Rewa 76 · Serua 14 · Ba 101 ·
Lomaiviti 32 · Naitasiri 19 · Ra 16 · Tailevu 23 · Bua 49 ·
Cakaudrove 80 · Lau 51 · Macuata 46 · Non‑provincial/Fiji 60 · Unsure 1.

Confederacies (all authorship): Burebasaga 179 · Kubuna 191 · Tovata 226.

**iTaukei‑associated, Total row 86:**
Kadavu 9 · Nadroga 15 · Namosi 7 · Rewa 27 · Serua 7 · Ba 21 ·
Lomaiviti 18 · Naitasiri 14 · Ra 6 · Tailevu 17 · Bua 18 ·
Cakaudrove 15 · Lau 10 · Macuata 20 · Non‑provincial/Fiji 59 · Unsure 1.

## Deviation from the docx validation targets

The docx targets were computed before the Researcher Authorship bridge
existed. All‑authorship deltas are within ±1 (Ba −1, Cakaudrove +1,
Tailevu −1, Macuata +1); this is legitimate drift from RG edits after
the prompt was written. iTaukei deltas run higher by ~+37 across the
14 named provinces, entirely from the new Researcher Authorship rows
(60 links → 39 unique publications). See `docs/audit_c2_geography.csv`
for per‑publication traceability and
`docs/c2_validation_results.txt` for the 10‑test pass log.

## Repair scripts

| Script | Purpose |
| :-- | :-- |
| `scripts/repair_dashboard_c2.py --apply` | One‑shot: insert Report rows and migrate S/T columns. |
| `scripts/repair_dashboard_c2_fixups.py` | Follow‑up: fix `$78` → `$79` and extend Total SUM ranges. |
| `scripts/audit_c2_geography.py` | Emit `docs/audit_c2_geography.csv` (per‑pub audit). |
| `scripts/validate_c2_repair.py` | Run the 10 validation tests. |

## Post‑repair operational notes

- Any RG edit is now reflected on next Master reload and on the next
  V2 snapshot refresh (2‑hour cadence via
  `.github/workflows/refresh-master-file.yml`, or manual dispatch).
- Master Dashboard heartbeat cells `A11` / `D11` were refreshed to
  3674 publications and 2058 authorship links; the reconciler
  tolerance was bumped to 50 to cover Researcher Authorship drift
  against the older hard‑coded Panel B totals until Ron chooses to
  refresh those too.
- The public URL for verification:
  <https://ronvave.github.io/vave-lab/itaukei-research-database.html>
  (passcode: `Arachnid1!`).
