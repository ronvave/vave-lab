# V2 Panel F — Strict Paternal Geography Isolation (2026‑08‑25)

## Bug

Panel F scholar‑card identity geography was mixing paternal and maternal
lineage. Regression case: **ITK‑S0212 Malelili Naulivou Rokomatu** rendered
as

> Naseyani vlg (Beqa Is), Ra Province.

That combines:

- paternal village = Naseyani
- **maternal island = Beqa** (leaked)
- paternal province = Ra

Beqa is Malelili's maternal island; it must never appear on Panel F.

## Root cause

`js/master-file-adapter.js` flattened paternal + maternal Master
columns into two generic keys used by every V2 renderer:

```js
village: cleanSentinel_(s['Village Paternal']) || cleanSentinel_(s['Village Maternal']),
island:  cleanSentinel_(s['Island Paternal'])  || cleanSentinel_(s['Island Maternal']),
```

`cleanSentinel_()` blanks Master placeholders (`Unclassified`,
`Unknown`, `N/A`, `-`, blank). ITK‑S0212's `Island Paternal` cell was
`"Unclassified"` in the deployed snapshot, so the `||` fallback pulled
`"Beqa"` from `Island Maternal` and Panel F rendered it verbatim.

`effectivePaternalProvince(profile)` in
`js/itaukei-database-master.js` had a matching fallback
(`paternalProvince || maternalProvince`) that Panel F also relied on
via `provinceToConfederacy(paternal)`.

## Fix

Panel F now reads paternal‑only fields with **no fallback** and no
merged keys.

### `js/master-file-adapter.js`

1. Added two new dedicated keys to every scholar profile:

   - `paternalVillage`  ← `Village Paternal`
   - `maternalVillage`  ← `Village Maternal`

   The existing `paternalIsland` / `maternalIsland` /
   `paternalProvince` / `maternalProvince` keys already existed, so no
   schema regression is possible for callers that used them.

2. Changed the flat `village` / `island` fields so they hold the
   **paternal‑side value only** (still passed through `cleanSentinel_`
   for placeholder scrubbing). No maternal fallback, no `||` merge.

3. Changed `effectivePaternalProvince` on the adapter‑produced profile
   object to strictly return the paternal province. (The
   `effectivePaternalProvince()` *function* in
   `js/itaukei-database-master.js` is unchanged — it still falls back
   to maternal for its 8 non‑Panel‑F call sites — Panel F just no
   longer calls it.)

### `js/itaukei-database-master.js`

1. **Panel F scholar‑card renderer** (row card) builds a dedicated
   `paternalGeography = { village, island, province }` object from
   `profile.paternalVillage`, `profile.paternalIsland`,
   `profile.paternalProvince` and passes it to
   `formatScholarGeography()`. No `||` fallback, no
   `effectivePaternalProvince()` call.

2. **Map popup scholar‑detail chip** (Panel F/G scholar hovers on the
   Fiji map) now reads `profile.paternalVillage` /
   `profile.paternalIsland` / `profile.paternalProvince` directly. No
   fallback.

3. **`_workplaceProvinceForProfile` / `_workplaceVillageLine`**
   (world‑map workplace popup card, used by Panel A2 world map) now
   read `p.paternalVillage` / `p.paternalIsland` / `p.paternalProvince`
   directly. The second maternal note line still uses maternal fields
   explicitly (and only when `maternalProvince !== paternalProvince`)
   — that's the intentional "maternal: Rewa – Burebasaga" annotation,
   not a paternal fallback.

4. **`mergeVillageProvince()`** (B3 popup hover chip) now reads
   `prof.paternalVillage` / `prof.paternalIsland` /
   `prof.paternalProvince` directly. No fallback.

### `formatScholarGeography()` itself is unchanged

The formatter already scrubs `Unclassified` / `Unknown` / `N/A` and
already suppresses `Viti Levu` / `Vanua Levu` from the island slot.
All fixes are at the *field selection* layer, not the display layer.

## Regression tests

Simulated in Python (`scripts/audit_panel_f_paternal_contamination.py`)
against the deployed snapshot. Test cases from the docx:

| Case | Master values | Expected | Fixed output |
| :-- | :-- | :-- | :-- |
| A. ITK‑S0212 | Paternal: Naseyani / Unclassified / Ra · Maternal: Rukua / Beqa / Rewa | `Naseyani vlg, Ra Province.` | `Naseyani vlg, Ra Province.` ✓ |
| B. Named paternal island ≠ maternal island | e.g. Paternal Moala, Maternal Cicia | show paternal island only | shows `(Moala Is)` ✓ |
| C. Paternal Island = Viti Levu | e.g. Paternal Viti Levu | omit island name | mainland suppression fires ✓ |
| D. Blank paternal village + valid paternal province | Paternal `– / – / Ra` | `Ra Province.` | `Ra Province.` ✓ |
| E. No paternal village/province, rich maternal | Paternal all blank, maternal populated | `Village not yet added` | empty geoLine → placeholder rendered ✓ |

## Deployed contamination

`docs/panel_f_paternal_contamination.md` and `.csv` list every
affected scholar. Against the deployed snapshot on 2026‑08‑25 there
are **4 affected scholars**:

| Scholar ID | Name | Before | After |
| :-- | :-- | :-- | :-- |
| ITK‑S0003 | Aporosa, Apo | Naduri vlg, Macuata Province. | (Village not yet added) |
| ITK‑S0092 | Lako, Jimaima | Mabula vlg (Cicia Is), Lau Province. | Lau Province. |
| ITK‑S0123 | Mateiviti‑Tulavu, Eseta K | Lomanikoro vlg, Rewa Province. | (Village not yet added) |
| ITK‑S0212 | Rokomatu, Malelili Naulivou | Naseyani vlg (Beqa Is), Ra Province. | Naseyani vlg, Ra Province. |

The three "(Village not yet added)" cases are correct per the docx §
"If paternal information is incomplete, simply display the available
paternal information" — these scholars have no paternal village *or*
province, so Panel F cannot construct an identity line from paternal
data and correctly shows the empty‑state chip.

## Safeguards preserved

- **Master data is unchanged.** No cells were rewritten to hide the bug.
- **Maternal data is intact.** `maternalVillage` / `maternalIsland` /
  `maternalProvince` / `maternalDistrict` are still emitted by the
  adapter for any consumer that legitimately needs both lineages.
- **V1 unchanged.** No `js/itaukei-database.js` edits.
- **Admin unchanged.** No `js/admin-*.js` edits.
- **Card design unchanged.** Only the geography meta line's *inputs*
  changed; typography, order, layout, and confederacy tinting are
  identical.

## Deployment

1. Commit and push (main).
2. Trigger `refresh-master-file.yml` (or wait for the 2h cron).
3. Snapshot rebuilds `data/itaukei-master-scholars.json.enc`.
4. GitHub Pages redeploys automatically.
5. Verify at
   <https://ronvave.github.io/vave-lab/itaukei-research-database.html>
   (hard‑refresh; passcode `Arachnid1!`). ITK‑S0212 must read
   `Naseyani vlg, Ra Province.`
