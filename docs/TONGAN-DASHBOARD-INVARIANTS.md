# Tongan dashboard invariants

These are regression-blocking requirements for the Tongan V2 dashboard.

## Scholar-card publication types

- `Master's Thesis` and `PhD Thesis` are permanent publication categories.
- Every completed Master's/PhD row in `Graduate Degrees` must appear on its
  scholar's card even when the thesis-title field is blank or the matching
  `Publications`/`Authorship` row is absent.
- The thesis contributes to the card's publication total, first-authored total,
  and publication-type badge.
- When the same thesis exists in both `Graduate Degrees` and
  `Publications`/`Authorship`, it is counted once, using normalized title and
  degree level for reconciliation.
- Dashboard filtering, regeneration, redesign, or cache refresh must never
  silently remove either thesis category.

Run `node scripts/test_tongan_scholar_card_theses.js` before publishing changes
to the Tongan adapter or scholar-card counter.

## Scholar-card locality labels

- When a specific island is present, display its concise island name with the
  canonical `Is` suffix.
- When the specific island is blank but the paternal Island Division is
  present, use the Island Division as the island label.
- Remove the explanatory qualifier `(main island)` and the hierarchy suffix
  `Island Division` from public locality text. Preserve the underlying Master
  values unchanged.
- Tonga has no province tier. Never append `Province` to the district value on
  a Tongan scholar card, and do not carry Fiji's province terminology into
  Tongan public locality text.
- Display the correct Tonga-specific suffix: `Kolovai District`, never
  `Kolovai Province`, on scholar cards.
- Example: `Te'ekiu vlg (Tongatapu (main island) Is), Kolovai Province.` must
  render as `Te'ekiu vlg (Tongatapu Is), Kolovai District.`
- Apply this rule through the shared geography formatter so it remains
  consistent across every scholar card.

Run `node scripts/test_tongan_scholar_geography.js` before publishing changes
to scholar geography rendering.

## Tonga-specific interface terminology

- The scholar filter's unselected/reset label is always `All Island Divisions`.
- Never restore the cloned Fiji label `All Confederacies` in Tongan HTML,
  JavaScript-generated dropdown rows, reset states, or selected-label builders.
- Static markup and dynamic rendering logic must use the same wording so a
  refresh or interaction cannot overwrite the correct label.

Run `node scripts/test_tongan_ui_labels.js` before publishing Tongan interface
copy changes.
