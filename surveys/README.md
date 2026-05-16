# Pacific CPWB & FPA Survey Framework

A standardized framework for deploying web-based surveys documenting **Culturally Protected Water Bodies (CPWBs)** and **Funerary Protected Areas (FPAs)** across Pacific Island countries. Each country survey shares the same architecture, naming conventions, and setup workflow so a single setup checklist works for all of them.

Maintained by **Dr. Ron Vave**, Assistant Professor, University of Hawai'i at Mānoa.

---

## Folder Structure

```
surveys/
├── README.md                    ← you are here (framework-wide guide)
├── Vanuatu/
│   ├── README.md                ← country-specific notes
│   ├── van-cpwb-survey.html
│   ├── van-cpwb-dashboard.html
│   ├── van-cpwb-admin.html
│   ├── van-cpwb-backend.gs
│   └── van-cpwb-questionnaire.pdf
├── Fiji/                        (planned)
├── SolomonIslands/              (planned)
└── …
```

Each country gets its own folder. All files within a country folder use the same 3-letter country prefix.

---

## Naming Convention

### Country prefixes

| Country | Prefix | Folder |
|---|---|---|
| Vanuatu | `van-` | `surveys/Vanuatu/` |
| Fiji | `fij-` | `surveys/Fiji/` |
| Solomon Islands | `sol-` | `surveys/SolomonIslands/` |
| Tonga | `ton-` | `surveys/Tonga/` |
| Samoa | `sam-` | `surveys/Samoa/` |
| Kiribati | `kir-` | `surveys/Kiribati/` |
| Papua New Guinea | `png-` | `surveys/PNG/` |
| Federated States of Micronesia | `fsm-` | `surveys/FSM/` |
| Palau | `pal-` | `surveys/Palau/` |
| Marshall Islands | `mar-` | `surveys/MarshallIslands/` |
| Cook Islands | `coo-` | `surveys/CookIslands/` |
| Niue | `niu-` | `surveys/Niue/` |
| Tuvalu | `tuv-` | `surveys/Tuvalu/` |
| Nauru | `nau-` | `surveys/Nauru/` |

### Survey type suffix

After the country prefix, the next segment indicates survey scope:

- `cpwb-` — all 5 Culturally Protected Water Body types (FPA, CIPA, CircPA, MecPA, ConcPA)
- `fpa-` — Funerary Protected Areas only (single-type survey)

### Standard file set per country

Every country folder must contain these six files:

| Filename pattern | Purpose |
|---|---|
| `{xxx}-{type}-survey.html` | Public-facing survey (single-page HTML with inlined village data, i18n, Leaflet) |
| `{xxx}-{type}-dashboard.html` | Live response viewer (KPIs, Chart.js, clustered Leaflet map) |
| `{xxx}-{type}-admin.html` | Password-gated CRUD admin (SHA-256 multi-password, CSV/JSON export) |
| `{xxx}-{type}-backend.gs` | Google Apps Script backend (`doPost` + `doGet list/update/delete`) |
| `{xxx}-{type}-questionnaire.pdf` | Printable trilingual field form (offline collection fallback) |
| `README.md` | Country-specific notes (sheet name, project name, village dataset, language review status) |

Example for Fiji: `fij-cpwb-survey.html`, `fij-cpwb-dashboard.html`, `fij-cpwb-admin.html`, `fij-cpwb-backend.gs`, `fij-cpwb-questionnaire.pdf`, `README.md`.

---

## 10-Step Setup Checklist

This checklist applies to **every country survey** in this framework. The country-specific values to plug in (sheet name, project name, village dataset) live in each country folder's `README.md`.

### Step 1 — Create the Google Sheet

1. Go to [sheets.google.com](https://sheets.google.com) → **Blank**
2. Rename it exactly to the value listed in the country folder's `README.md` (e.g., `Vanuatu CPWB survey form results`)
3. Leave row 1 empty — the Apps Script writes headers automatically on first submission
4. Copy the **Sheet ID** from the URL: `https://docs.google.com/spreadsheets/d/{SHEET_ID}/edit`

### Step 2 — Create a new Apps Script project

1. Go to [script.google.com](https://script.google.com) → **+ New project**
2. Rename the project to the value in the country folder's `README.md` (e.g., `Vanuatu project`)

> **One Apps Script project per country.** Don't mix multiple countries into the same project — each has its own sheet, column schema, and deployment URL.

### Step 3 — Paste the backend code

1. In the editor, select all of the default `Code.gs` → delete
2. Open the country folder's `{xxx}-{type}-backend.gs` on GitHub → **Raw** → copy all
3. Paste into the Apps Script editor
4. Press **⌘+S** / **Ctrl+S** to save

### Step 4 — Replace the two placeholders in the backend

Find these two constants near the top of the pasted code:

```javascript
const SHEET_ID = "REPLACE_WITH_SHEET_ID";
const ADMIN_WRITE_TOKEN = "REPLACE_WITH_ADMIN_WRITE_TOKEN";
```

| Placeholder | Replace with |
|---|---|
| `REPLACE_WITH_SHEET_ID` | Sheet ID from Step 1 |
| `REPLACE_WITH_ADMIN_WRITE_TOKEN` | Long random string (32+ chars) |

Generate the admin token using any of:

- Browser console: `crypto.randomUUID() + crypto.randomUUID()`
- Mac/Linux terminal: `openssl rand -hex 32`
- Password manager (1Password / Bitwarden) — 32+ char random

**Save this token in a password manager** — you'll paste the same value into the admin HTML in Step 7.

Save the file again (**⌘+S** / **Ctrl+S**).

### Step 5 — Deploy the Apps Script as a Web App

1. Top-right: **Deploy** → **New deployment**
2. Click the gear next to "Select type" → **Web app**
3. Fill in:
   - **Description:** `{Country} CPWB v1` (e.g., `Vanuatu CPWB v1`)
   - **Execute as:** *Me (your account)*
   - **Who has access:** **Anyone**
4. Click **Deploy**
5. First time only: authorize the requested scopes → **Advanced** → **Go to {project name} (unsafe)** → **Allow** (the "unsafe" warning is normal for personal Apps Script projects)
6. Copy the **Web app URL** ending in `/exec` — save it for Step 6

### Step 6 — Wire the deployment URL into the three HTML files

In `{xxx}-{type}-survey.html`, `{xxx}-{type}-dashboard.html`, and `{xxx}-{type}-admin.html`, find this line near the top of the inline `<script>`:

```javascript
const APPS_SCRIPT_URL = "https://script.google.com/macros/s/REPLACE_WITH_DEPLOYMENT_ID/exec";
```

Replace with the `/exec` URL from Step 5. Same URL in all three files.

### Step 7 — Set the admin token in the admin HTML

In `{xxx}-{type}-admin.html` only, find:

```javascript
const ADMIN_WRITE_TOKEN = "REPLACE_WITH_ADMIN_WRITE_TOKEN";
```

Replace with the **same** token you set in Step 4. Both must match exactly — the backend rejects update/delete requests if they don't.

### Step 8 — Generate admin password hashes

The admin page uses SHA-256 hashes for 4 named slots: **ron**, **team1**, **team2**, **field**. Only `ron` is required to log in; the others can stay as placeholders or be set for collaborators.

For each password, paste this in any browser console (replace `your-password`):

```javascript
(async () => {
  const enc = new TextEncoder().encode("your-password");
  const hash = await crypto.subtle.digest("SHA-256", enc);
  console.log([...new Uint8Array(hash)].map(b => b.toString(16).padStart(2, "0")).join(""));
})();
```

Copy the 64-character hex output and paste into the matching slot in `{xxx}-{type}-admin.html`:

```javascript
const ADMIN_PASSWORD_HASHES = {
  ron:   "PASTE_RON_HASH_HERE",
  team1: "PASTE_TEAM1_HASH_HERE",
  team2: "PASTE_TEAM2_HASH_HERE",
  field: "PASTE_FIELD_HASH_HERE",
};
```

### Step 9 — Swap IRB placeholder and review language flags

Every country survey ships with two markers that must be resolved before launch:

**IRB protocol placeholder.** Both the web survey and the PDF currently read:

> *This study has been approved by [University of Hawaii at Manoa IRB Protocol #TBD].*

Replace `#TBD` with your assigned protocol number. Locations:

- `{xxx}-{type}-survey.html` — search for `IRB Protocol`
- `{xxx}-{type}-questionnaire.pdf` — annotate post-hoc or rebuild from source

**Language review markers.** Translation strings I wasn't fully confident on are wrapped in HTML comments:

```html
<!-- review --> some translated string here <!-- /review -->
```

Search each survey and admin HTML for `<!-- review -->` and have a native speaker / collaborator pass through them before launch. Each country's `README.md` lists which language pairs need review (e.g., Bislama for Vanuatu, Solomon Islands Pijin for Solomons).

### Step 10 — Commit edited files, host, and test end-to-end

1. Commit the three edited HTML files back to GitHub (web editor pencil icon, or local `git push`)
2. Host via [GitHub Pages](https://pages.github.com) (Settings → Pages → source `main` / root) — or any static host
3. Test:
   - Open the deployed survey → submit a test response → verify row appears in the Google Sheet
   - Open the dashboard → confirm KPIs and map update
   - Open the admin → log in with your `ron` password → confirm edit/delete works

---

## Country Index

| Country | Folder | Status | Survey type(s) | Languages |
|---|---|---|---|---|
| [Vanuatu](./Vanuatu/) | `Vanuatu/` | ✅ Built (pending Apps Script setup + Bislama review) | CPWB (all 5 types) | English, Bislama, French |
| Fiji | `Fiji/` | 🟡 Planned (prior Jiru work to be migrated) | CPWB (all 5 types) | English, Fijian |
| Solomon Islands | `SolomonIslands/` | 🟡 Planned | CPWB or FPA | English, Solomon Islands Pijin |
| Tonga | `Tonga/` | ⚪ Not started | TBD | English, Tongan |
| Samoa | `Samoa/` | ⚪ Not started | TBD | English, Samoan |
| Kiribati | `Kiribati/` | ⚪ Not started | TBD | English, Gilbertese |
| Papua New Guinea | `PNG/` | ⚪ Not started | TBD | English, Tok Pisin |
| FSM | `FSM/` | ⚪ Not started | TBD | English + local |
| Palau | `Palau/` | ⚪ Not started | TBD | English, Palauan |
| Marshall Islands | `MarshallIslands/` | ⚪ Not started | TBD | English, Marshallese |
| Cook Islands | `CookIslands/` | ⚪ Not started | TBD | English, Cook Islands Māori |
| Niue | `Niue/` | ⚪ Not started | TBD | English, Niuean |
| Tuvalu | `Tuvalu/` | ⚪ Not started | TBD | English, Tuvaluan |
| Nauru | `Nauru/` | ⚪ Not started | TBD | English, Nauruan |

**Legend:** ✅ live · 🟡 in progress / planned · ⚪ not started

---

## Quick Reference — Placeholders to Replace per Country

| Where | Placeholder | Replace with |
|---|---|---|
| `{xxx}-{type}-backend.gs` | `REPLACE_WITH_SHEET_ID` | Google Sheet ID from the sheet URL |
| `{xxx}-{type}-backend.gs` | `REPLACE_WITH_ADMIN_WRITE_TOKEN` | Long random string (32+ chars) |
| All 3 HTML files | `REPLACE_WITH_DEPLOYMENT_ID` (inside `APPS_SCRIPT_URL`) | `/exec` URL from Apps Script deploy |
| `{xxx}-{type}-admin.html` | `REPLACE_WITH_ADMIN_WRITE_TOKEN` | **Same** value as in the backend |
| `{xxx}-{type}-admin.html` | 4 password hash slots | SHA-256 hashes of chosen passwords |
| Survey HTML + PDF | `IRB Protocol #TBD` | Assigned UH Mānoa IRB protocol number |
| Survey + admin HTML | `<!-- review -->` markers | Native-speaker reviewed translations |

---

## License & Contact

© 2026 Dr. Ron Vave, University of Hawai'i at Mānoa.

For collaboration inquiries: ronvave@hawaii.edu
