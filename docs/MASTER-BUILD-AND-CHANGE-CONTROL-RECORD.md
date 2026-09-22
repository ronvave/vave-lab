# Master Build and Change-Control Record

## 2026-09-21 — Solomon Islands Panel D milestone alignment

Right-anchored every line of the 1992 and 2001 annotations and constrained their
placement to the left of their year markers. The fallback also rejects connector
intersections with these annotation blocks. Both connectors remain attached to
their original year markers.

Verified in headless Chrome at 1440, 900, and 600 pixel viewport widths with local
encrypted snapshot data. Rendered geometry checks passed for right anchoring,
1992 text clearance from the 2001 connector, unchanged markers, unchanged
1972/1984 labels and connectors, and identical remaining chart SVG elements
(including bars and axes). Desktop and narrow screenshots visually inspected.
`node --check js/solomon-database-master.js` and
`node tests/itaukei-card-mobility.test.cjs` passed. No chart data or other panel
logic changed. Updated the dashboard script cache hash.
