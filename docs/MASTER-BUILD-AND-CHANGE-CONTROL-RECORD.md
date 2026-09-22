# Master Build and Change-Control Record

## 2026-09-21 — Tonga scholar update review notice

Updated the yellow Update info notice in the Tonga scholar portal and the
dashboard's fallback modal with the requested reviewer names, Professor Tēvita
Kaʻili and Associate Professor ‘Inoke Hafoka, and wording allowing friends,
family, students and colleagues to submit updates on a scholar's behalf.
Retained the bold Please read label and refreshed the portal script cache hash.
JavaScript syntax validation and `node tests/itaukei-card-mobility.test.cjs`
passed (55 saved photos, 75 research summaries, 151 mobility rows).
Tonga card/mobility checks also passed (14 photos, 13 saved summaries,
86 scholars and pathways). Publishing through the validated GitHub Pages
workflow; live delivery is checked after deployment.

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
