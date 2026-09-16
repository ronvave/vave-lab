# Conference papers are hidden from the public dashboard

**Admin directive (Ron Vave, July 2026):** Conference papers must not appear
on the public dashboard, must not count toward scholar profile cards, and
must not count toward any panel tally.

## Where the filter is applied

Single chokepoint in `js/itaukei-database.js`, immediately after the snapshot
JSON is loaded and before `state.snapshot` is assigned:

```js
if (snap && Array.isArray(snap.items)) {
  const beforeCount = snap.items.length;
  snap.items = snap.items.filter(it => it && it.itemType !== 'conferencePaper');
  state.hiddenConferencePapers = beforeCount - snap.items.length;
}
state.snapshot = snap;
```

Every downstream reader on the dashboard iterates `state.snapshot.items`, so
this one filter cascades to every consumer without per-site changes.

## What this affects (all invisible on the dashboard)

- Panel A — thesis + KPI heatmap
- Panel B1 — Fiji province publications
- Panel B2 — confederacy summary + world tab
- Panel B3 — world publications
- Panels C1 / C2 — province bar charts
- Panel D — top authors
- Panel E — by-confederacy leaderboards
- Panel F — scholar profile cards (chip counters + item lists inside cards)
- Panel G — anywhere it draws from the snapshot
- BibTeX export button
- The "Conference Paper" chip in the scholar summary row (never shown; count
  is always 0 after the filter)

## What is NOT touched

- **Raw Zotero library** — conference papers remain in the Zotero group
  (`5983386`). The dashboard filter is presentation-only.
- **`data/itaukei-zotero-snapshot.json.enc`** — the snapshot on disk still
  contains every conference paper. The refresh scripts do not strip them so
  that the raw archive stays complete and future policy changes can toggle
  visibility without re-fetching from Zotero.
- **`data/itaukei-graduate-studies.json.enc`** — never contained conference
  papers (theses only), so no filter needed there.
- **`TYPE_ORDER`** in `js/itaukei-database.js` (~line 78) — already omits
  `conferencePaper`, so the type-filter checkbox row and bar charts already
  excluded them. The new snapshot-load filter is complementary: it removes
  them from item counts, scholar profile cards, and BibTeX too.

## Reverting

To make conference papers visible again, delete the `snap.items.filter(...)`
block in `js/itaukei-database.js` (around line 297) and re-add
`conferencePaper` to `TYPE_ORDER` (line 84). No data changes needed.

## Audit

Diagnostic counter available in the browser console:

```js
state.hiddenConferencePapers  // number of items filtered out at load
```

At the time of the directive (16 July 2026 snapshot, 2345 total items) this
was **29**.
