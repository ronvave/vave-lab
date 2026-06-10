# Pacific Islander Faculty Beach Gathering — Survey + Dashboard

Sister project to the country surveys in `surveys/`. Single-island event-planning form for BYU–Hawaiʻi and UH Mānoa Pacific Islander faculty.

**Maintained by Dr. Ron Vave** — [ronvave@hawaii.edu](mailto:ronvave@hawaii.edu)

---

## Files

| File | Purpose |
|---|---|
| `pif-survey.html` | Public-facing 5-step survey (drag-rank dates, Oʻahu beach map, ranking, mobile-friendly) |
| `pif-dashboard.html` | Live dashboard, gated by `@hawaii.edu` / `@byuh.edu` email. Histograms, beach map, food/who/help charts |
| `pif-backend.gs` | Google Apps Script — appends submissions to a Sheet + serves `action=list` JSON to the dashboard |
| `img/1st-meeting.jpg` | Hero photo, top of survey |
| `img/beach-park.jpg` | Hūnānāniho Beach Park photo, inserted at Q4 (date ranking) |

> **Not linked from the navbar** (per request). Share the survey URL directly with faculty.

---

## Direct URLs (once deployed on GitHub Pages)

- Survey: `https://ronvave.github.io/vave-lab/surveys/Oahu-PIF-Gathering/pif-survey.html`
- Dashboard: `https://ronvave.github.io/vave-lab/surveys/Oahu-PIF-Gathering/pif-dashboard.html`

---

## 5-step setup (Apps Script + Sheet)

This mini-project uses the same Apps Script pattern as `surveys/Vanuatu/` but is simpler — no admin page, no passwords, just one backend with a list endpoint.

### 1. Create the Google Sheet

1. [sheets.google.com](https://sheets.google.com) → **Blank**
2. Rename to `PIF Beach Gathering Responses`
3. Leave row 1 empty — the script writes headers on first submission
4. Copy the **Sheet ID** from the URL: `https://docs.google.com/spreadsheets/d/{SHEET_ID}/edit`

### 2. Create the Apps Script project

1. [script.google.com](https://script.google.com) → **+ New project** → rename to `PIF Beach Gathering`
2. Delete the default `Code.gs` contents
3. Open `pif-backend.gs` in this folder on GitHub → **Raw** → copy all → paste into the editor

### 3. Plug in the Sheet ID

Near the top:

```javascript
const SHEET_ID = "REPLACE_WITH_SHEET_ID";
```

Replace with the ID from step 1. Save (`⌘+S`).

### 4. Deploy as Web App

1. **Deploy** → **New deployment**
2. Gear → **Web app**
3. Description: `PIF v1` · Execute as: *Me* · Who has access: **Anyone**
4. **Deploy** → authorize scopes (`Advanced` → `Go to … (unsafe)` → `Allow`)
5. Copy the **/exec URL**

### 5. Wire the deployment URL into the two HTML files

In both `pif-survey.html` and `pif-dashboard.html`, find:

```javascript
const APPS_SCRIPT_URL = 'https://script.google.com/macros/s/REPLACE_WITH_DEPLOYMENT_ID/exec';
```

Replace with the `/exec` URL. Same URL in both files. Commit, push.

### Test

1. Open the survey URL → submit a test response → confirm a row appears in the Sheet
2. Open the dashboard → enter a `@hawaii.edu` email → confirm charts and the map populate

---

## Dashboard email gate

The dashboard checks that the visitor types an email ending in `@hawaii.edu` or `@byuh.edu`. This is a **client-side trust check**, not server-side authentication — sufficient for sharing among colleagues but not bulletproof. To harden later:

- Add a one-time-code flow via `GmailApp.sendEmail` in the backend, or
- Move the dashboard behind a Google Site / Drive share restricted to the two domains.

The backend's `doGet?action=list` strips `q1_name` and `q3_email` before returning rows, so even if the JSON endpoint is hit directly, no personal identifiers are exposed publicly.

---

## What's on the dashboard

- **KPIs**: total responses · top weighted date · top side of island · # beach markers
- **Preferred date** — weighted bar (3 pts for 1st choice, 2 for 2nd, 1 for 3rd; "Other date" entries get 2 pts and are prefixed with ✎)
- **Side of island** (Q6), **Food format** (Q8), **Who** (Q10), **Time of day** (Q5, multi), **Activities** (Q12, multi), **Institutions** (Q2), **Help** (Q14)
- **Oʻahu map** — clustered markers from all respondents, popup shows beach name + restroom / parking / reservation flags
- **Most-suggested beaches** — table grouping markers by name, showing how often restroom & parking were confirmed
- **Accessibility / dietary notes feed** — anonymized free-text from Q16

---

## Changes vs. the original Word questionnaire

Per Ron's request:

- **Section structure**: 18 questions split into 5 progress-bar sections (About You · Date & Time · Location · Food & Family · Activities & Help)
- **1st-meeting photo** placed at the top of the survey
- **Q4 (dates)**: drag-to-rank (SortableJS), with "suggest another date" field; **Hūnānāniho beach photo** inserted here
- **Q5 (time)**: changed wording — gathering runs 10am–6pm with lunch at 1pm, come & go as you please
- **Q6**: rephrased to "Which side of the island would you prefer for the gathering?", added Honolulu and West/Leeward options
- **Q7 (map)**: Oʻahu-only Leaflet map with Esri imagery, Nominatim search constrained to the Oʻahu bbox, click-to-place multiple markers, each marker has **restroom near / parking / reservation required?** flags
- **Q8 (food)**: removed "Order/pick up food together"
- **Removed Q15** (what could you help with)
- **Q16 → "only faculty"**: removed "scholars or staff", question now asks about Pacific Islander faculty only

---

## License & contact

Same as the parent repo. Questions: **ronvave@hawaii.edu**.
