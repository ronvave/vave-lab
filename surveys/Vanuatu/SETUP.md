# Vanuatu CPWB Survey — Backend & Dashboard Setup

Step-by-step guide to stand up the **Google Sheet backend**, **public dashboard**, and **admin dashboard** for the Vanuatu Culturally Protected Water Bodies (CPWB) survey.

You already have the live survey form (`van-cpwb-survey.html`). This guide gets the rest of the stack working: data collection into a sheet, a public stats dashboard, and a password-gated admin viewer/export tool.

---

## Architecture at a glance

```
┌──────────────────────────┐         POST          ┌────────────────────────┐
│  van-cpwb-survey.html    │ ───────────────────▶  │  Google Apps Script    │
│  (public form)           │                       │  doPost()              │
└──────────────────────────┘                       │                        │
                                                   │  Google Sheet          │
┌──────────────────────────┐  GET ?action=summary  │  "Vanuatu CPWB         │
│  van-cpwb-dashboard.html │ ───────────────────▶  │   survey form results" │
│  (public stats)          │                       │                        │
└──────────────────────────┘                       │  doGet():              │
                                                   │   ?action=summary      │
┌──────────────────────────┐  GET ?action=admin    │   ?action=admin&...    │
│  van-cpwb-admin.html     │      &password=...    │                        │
│  (password-gated CRUD)   │ ───────────────────▶  │                        │
└──────────────────────────┘                       └────────────────────────┘
```

One Apps Script project, one sheet, one deployment URL — used by all three pages.

---

## Prerequisites

- A Google account (the one that will own the sheet + script — easiest to use `ronvave@hawaii.edu`).
- The Vanuatu folder already cloned/visible on GitHub: `vave-lab/surveys/Vanuatu/`.
- ~45 minutes for first-time setup.

---

# PART 1 — Google Sheet + Apps Script backend

## Step 1.1 — Create the Google Sheet

1. Open <https://sheets.google.com> and click **Blank**.
2. Rename the file to **exactly**: `Vanuatu CPWB survey form results`
3. Leave row 1 empty — the Apps Script writes headers automatically the first time a survey is submitted.
4. Copy the **Sheet ID** from the URL — it's the long string between `/d/` and `/edit`:
   ```
   https://docs.google.com/spreadsheets/d/1AbCdEfGhIjKlMnOpQrStUvWxYz1234567890/edit
                                          └──────── this is the SHEET_ID ─────────┘
   ```
5. Paste the Sheet ID somewhere temporary (sticky note, password manager) — you'll need it in Step 1.4.

## Step 1.2 — Create the Apps Script project

1. Open <https://script.google.com> and click **+ New project**.
2. Top-left: rename the untitled project to **`Vanuatu CPWB backend`**.

> One Apps Script project per country. Do **not** add Vanuatu logic into the existing Solomon Islands Jiru project — they have different column schemas and need separate deployment URLs.

## Step 1.3 — Paste the backend code

1. In the editor, click into the default `Code.gs` file, **select all** (`⌘+A` / `Ctrl+A`), and delete.
2. Copy the entire code block below and paste it in.
3. Save: `⌘+S` / `Ctrl+S`.

```javascript
/**
 * Vanuatu CPWB survey backend
 * Handles: doPost (survey submissions), doGet?action=summary (public dashboard),
 *          doGet?action=admin (admin export)
 */

// ───── CONFIG — replace these two values ─────
const SHEET_ID = "REPLACE_WITH_SHEET_ID";
const ADMIN_PASSWORDS = ["REPLACE_WITH_ADMIN_PASSWORD"];  // accept any password in this list
// ─────────────────────────────────────────────

const SHEET_NAME = "Sheet1";  // default tab name; rename here if you renamed the tab

/* ════════════════════════════════════════════════
   doPost — Survey submission endpoint
   ════════════════════════════════════════════════ */
function doPost(e) {
  try {
    const ss = SpreadsheetApp.openById(SHEET_ID);
    const sheet = ss.getSheetByName(SHEET_NAME) || ss.getSheets()[0];

    // Parse the JSON payload sent by van-cpwb-survey.html
    const payload = JSON.parse(e.postData.contents);

    // First-time setup: write the header row if the sheet is empty
    if (sheet.getLastRow() === 0) {
      const headers = ["Timestamp"].concat(Object.keys(payload));
      sheet.appendRow(headers);
    }

    // Build the new row in the same order as the existing header row
    const headerRow = sheet.getRange(1, 1, 1, sheet.getLastColumn()).getValues()[0];
    const newRow = headerRow.map(h => {
      if (h === "Timestamp") return new Date().toISOString();
      return payload[h] !== undefined ? payload[h] : "";
    });

    // If the payload has new fields not yet in the header, append them as new columns
    Object.keys(payload).forEach(key => {
      if (headerRow.indexOf(key) === -1) {
        const newColIdx = sheet.getLastColumn() + 1;
        sheet.getRange(1, newColIdx).setValue(key);
        newRow.push(payload[key]);
      }
    });

    sheet.appendRow(newRow);

    return ContentService
      .createTextOutput(JSON.stringify({ success: true }))
      .setMimeType(ContentService.MimeType.JSON);

  } catch (err) {
    return ContentService
      .createTextOutput(JSON.stringify({ success: false, error: String(err) }))
      .setMimeType(ContentService.MimeType.JSON);
  }
}

/* ════════════════════════════════════════════════
   doGet — Dashboard + admin endpoints
   ════════════════════════════════════════════════ */
function doGet(e) {
  const action = (e.parameter.action || "").toLowerCase();

  if (action === "summary") return jsonResponse(buildSummary());
  if (action === "admin")   return handleAdmin(e);

  return jsonResponse({ error: "Unknown action. Use ?action=summary or ?action=admin&password=..." });
}

function jsonResponse(obj) {
  return ContentService
    .createTextOutput(JSON.stringify(obj))
    .setMimeType(ContentService.MimeType.JSON);
}

/* ────── Public summary endpoint (used by van-cpwb-dashboard.html) ────── */
function buildSummary() {
  const VANUATU_PROVINCES = ["Torba", "Sanma", "Penama", "Malampa", "Shefa", "Tafea"];

  const rows = getAllRowsAsObjects();
  const provinceMap = {};
  VANUATU_PROVINCES.forEach(p => {
    provinceMap[p] = { name: p, count: 0, jiru_yes: 0, jiru_past: 0, jiru_no: 0, jiru_unsure: 0 };
  });

  const markers = [];
  let lastUpdated = null;

  rows.forEach(r => {
    const prov = r["Province"];
    if (provinceMap[prov]) provinceMap[prov].count++;

    const status = (r["Jiru Status"] || "").toLowerCase();
    if (provinceMap[prov]) {
      if (status === "yes_current") provinceMap[prov].jiru_yes++;
      else if (status === "yes_past") provinceMap[prov].jiru_past++;
      else if (status === "no_never" || status === "no") provinceMap[prov].jiru_no++;
      else if (status === "unsure") provinceMap[prov].jiru_unsure++;
    }

    // Anonymized markers — only lat/lng/status/province (no PII)
    if (r["Latitude"] && r["Longitude"]) {
      markers.push({
        lat: Number(r["Latitude"]),
        lng: Number(r["Longitude"]),
        status: status === "yes_current" ? "active"
              : status === "yes_past" ? "past"
              : status === "no_never" || status === "no" ? "never"
              : "unsure",
        province: prov
      });
    }

    if (r["Timestamp"]) {
      const t = new Date(r["Timestamp"]);
      if (!lastUpdated || t > lastUpdated) lastUpdated = t;
    }
  });

  return {
    total_submissions: rows.length,
    provinces: VANUATU_PROVINCES.map(p => provinceMap[p]),
    markers: markers,
    last_updated: lastUpdated ? lastUpdated.toISOString() : null
  };
}

/* ────── Admin endpoint (used by van-cpwb-admin.html) ────── */
function handleAdmin(e) {
  const pw = e.parameter.password || "";
  if (ADMIN_PASSWORDS.indexOf(pw) === -1) {
    return jsonResponse({ success: false, error: "Unauthorized" });
  }
  const rows = getAllRowsAsObjects();
  return jsonResponse({ success: true, total: rows.length, data: rows });
}

/* ────── Helper: read all rows as array of {header: value} objects ────── */
function getAllRowsAsObjects() {
  const ss = SpreadsheetApp.openById(SHEET_ID);
  const sheet = ss.getSheetByName(SHEET_NAME) || ss.getSheets()[0];
  if (sheet.getLastRow() < 2) return [];
  const values = sheet.getDataRange().getValues();
  const headers = values[0];
  return values.slice(1).map(row => {
    const obj = {};
    headers.forEach((h, i) => { obj[h] = row[i]; });
    return obj;
  });
}
```

## Step 1.4 — Replace the two placeholders

In the code you just pasted, scroll to the top and replace:

| Placeholder | Replace with |
|---|---|
| `REPLACE_WITH_SHEET_ID` | The Sheet ID you copied in Step 1.1 |
| `REPLACE_WITH_ADMIN_PASSWORD` | A strong password (e.g. `Vanuatu-CPWB-2026-x9k2`) |

For the admin password, you can also list multiple passwords in the array to give different team members their own:
```javascript
const ADMIN_PASSWORDS = ["ronVanuatu2026", "team1Vanuatu2026", "fieldVanuatu2026"];
```

**Save the file** (`⌘+S` / `Ctrl+S`).

**Save the admin password(s) in your password manager.** You will paste the same value(s) into `van-cpwb-admin.html` in Part 3.

## Step 1.5 — Deploy the Apps Script as a Web App

1. Top-right of the Apps Script editor: **Deploy** → **New deployment**.
2. Click the gear icon next to "Select type" → choose **Web app**.
3. Fill in:
   - **Description:** `Vanuatu CPWB v1`
   - **Execute as:** *Me (ronvave@hawaii.edu)*
   - **Who has access:** **Anyone**
4. Click **Deploy**.
5. First time only: Google will ask to authorize the script.
   - Click **Authorize access** → pick your account.
   - You'll see a "Google hasn't verified this app" warning. This is normal for personal Apps Script projects.
   - Click **Advanced** → **Go to Vanuatu CPWB backend (unsafe)** → **Allow**.
6. Copy the **Web app URL** that ends in `/exec`. It looks like:
   ```
   https://script.google.com/macros/s/AKfycby.................../exec
   ```
7. **Save this URL** — you'll paste it into all three HTML files in the next steps.

> Whenever you change the Apps Script code later, you must **Deploy → Manage deployments → pencil icon → New version → Deploy** to push the changes live. Editing the code alone does not update the live `/exec` URL.

## Step 1.6 — Wire the survey to the new backend

In `surveys/Vanuatu/van-cpwb-survey.html`, find this line (around line 2554):

```javascript
const APPS_SCRIPT_URL = 'https://script.google.com/macros/s/AKfycby19VE50MFkSFM86tkMvFaS6Nz4SQnCAYzYK8In8N_TZ9me5AYK0RxJFmE6fEIp0RyD/exec';
```

That's currently pointing at the **Solomon Islands** backend. Replace it with your new Vanuatu `/exec` URL from Step 1.5.

Commit and push:
```bash
git add surveys/Vanuatu/van-cpwb-survey.html
git commit -m "Point Vanuatu survey to its own Apps Script backend"
git push origin main
```

## Step 1.7 — Test the survey → sheet flow

1. Open the live survey: <https://ronvave.github.io/vave-lab/surveys/Vanuatu/van-cpwb-survey.html>
2. Fill in the consent + a few fields and click **Submit survey**.
3. Switch to the Google Sheet → you should see a new row with all the field values and a `Timestamp` column on the left.
4. On the very first submission, you'll also see the entire header row populate automatically.

If nothing appears:
- Check the browser console (`F12`) for CORS or fetch errors.
- In Apps Script: **Executions** (left sidebar) → look for the most recent `doPost` run and check the error message.
- Common gotcha: deployed URL ends in `/dev` instead of `/exec`. Re-deploy as "New deployment", not "Test deployment".

---

# PART 2 — Public dashboard (`van-cpwb-dashboard.html`)

The public dashboard shows aggregate stats by province, a clustered map of submissions, and a "no data yet" marker for provinces still needing fieldwork. No login required — anyone with the URL can view.

## Step 2.1 — Create the dashboard file

The Solomon Islands `jiru-dashboard.html` is your template. The fastest path is to copy it and rename references from Jiru/Solomon Islands to Vanuatu.

In your local clone:
```bash
cd /path/to/vave-lab
cp jiru-dashboard.html surveys/Vanuatu/van-cpwb-dashboard.html
```

## Step 2.2 — Find-and-replace in the new file

Open `surveys/Vanuatu/van-cpwb-dashboard.html` and make these replacements (use your editor's find-and-replace, case-sensitive):

| Find | Replace with |
|---|---|
| `Solomon Islands` | `Vanuatu` |
| `Jiru` (whole word) | `Funerary Tabu Area` |
| `jiru` (whole word) | `funerary tabu area` |
| The `APPS_SCRIPT_URL` constant near the top | Your Vanuatu `/exec` URL from Step 1.5 |

## Step 2.3 — Update the province list

Find the array of Solomon Islands provinces (search for `"Choiseul"` or `"Guadalcanal"`) and replace the entire array with Vanuatu's 6 provinces:

```javascript
const VANUATU_PROVINCES = [
  "Torba",     // northernmost
  "Sanma",     // Espiritu Santo, Malo
  "Penama",    // Pentecost, Ambae, Maewo
  "Malampa",   // Malekula, Ambrym, Paama
  "Shefa",     // Efate, Epi, Shepherd islands
  "Tafea"      // Tanna, Erromango, Aneityum, Aniwa, Futuna (Vanuatu)
];
```

Also update the "X of 9" province counter (Solomon Islands has 9 provinces, Vanuatu has 6):

```javascript
// Find this line:
document.getElementById('stat-provinces').textContent = provincesWithData + ' of 9';
// Change to:
document.getElementById('stat-provinces').textContent = provincesWithData + ' of 6';
```

## Step 2.4 — Update the map default view

Find the Leaflet map init (search for `L.map('jiru-map')` or `setView([-8.5, 160.5]`) and replace the center coordinates and zoom level:

```javascript
// Solomon Islands center:
window.jiruMap = L.map('jiru-map').setView([-8.5, 160.5], 7);

// Replace with Vanuatu center (Efate area, slightly zoomed in):
window.vanuatuMap = L.map('vanuatu-map').setView([-16.5, 168.0], 7);
```

Also rename the `<div id="jiru-map">` to `<div id="vanuatu-map">` to match.

## Step 2.5 — Update the page `<title>` and visible heading

In the `<head>` section:
```html
<title>Funerary Tabu Area — Vanuatu live dashboard</title>
```

In the visible `<h1>` (or wherever the main heading lives):
```html
<h1>Vanuatu Funerary Tabu Area — live dashboard</h1>
```

## Step 2.6 — Test locally before pushing

Open the file directly in your browser:
```
file:///path/to/vave-lab/surveys/Vanuatu/van-cpwb-dashboard.html
```

You should see:
- `Total submissions: 1` (or however many test rows you submitted in Step 1.7)
- All 6 province cards showing
- Provinces without data marked as "Needs data"
- Your test submission appearing as a dot on the map (if it had lat/lng)

If the dashboard shows `Total submissions: 0` but you know rows exist, open the browser console and check the network tab — the request to `?action=summary` should return a non-empty JSON response.

## Step 2.7 — Commit and push

```bash
git add surveys/Vanuatu/van-cpwb-dashboard.html
git commit -m "Add Vanuatu CPWB public dashboard"
git push origin main
```

Live URL once pushed: <https://ronvave.github.io/vave-lab/surveys/Vanuatu/van-cpwb-dashboard.html>

---

# PART 3 — Admin dashboard (`van-cpwb-admin.html`)

The admin page is password-gated and shows every individual submission (full row data, including PII like names and contact). It also has CSV / JSON export, sortable columns, and a per-record viewer.

## Step 3.1 — Create the admin file

```bash
cd /path/to/vave-lab
cp jiru-admin.html surveys/Vanuatu/van-cpwb-admin.html
```

## Step 3.2 — Find-and-replace

Same global substitutions as the dashboard:

| Find | Replace with |
|---|---|
| `Solomon Islands` | `Vanuatu` |
| `Jiru` (whole word) | `Funerary Tabu Area` |
| `jiru` (whole word) | `funerary tabu area` |
| The `APPS_SCRIPT_URL` constant | Your Vanuatu `/exec` URL |

## Step 3.3 — Set the admin password(s)

Find the password array (search for `ADMIN_PASSWORDS`):

```javascript
const ADMIN_PASSWORDS = ["jiru-secret-2025"];
```

Replace with the **same password(s)** you used in the Apps Script `ADMIN_PASSWORDS` (Part 1, Step 1.4):

```javascript
const ADMIN_PASSWORDS = ["Vanuatu-CPWB-2026-x9k2"];
```

If you set multiple passwords in the backend, list them all here. The admin page tries each in turn until one works.

> The admin password is stored in plain text in the HTML. Anyone who views the page source can read it. This is acceptable because (a) the backend also requires the password — it's a defense-in-depth check, not a secret, and (b) the admin URL itself should be kept private and shared only with trusted collaborators.
>
> For stronger protection, store an SHA-256 **hash** in the HTML and compare against a user-typed password before sending the plaintext to the backend. The Solomon Islands admin already uses this pattern — search for `ADMIN_PASSWORD_HASHES` to see how it works.

## Step 3.4 — Update the field mapping

The biggest customization. Search for `Local Jiru Name` — you'll find a block that maps Google Sheet column names → JavaScript field names. Each `r['Column Name']` must match a header in your Vanuatu sheet.

For Vanuatu, the column names in your sheet come from the survey form's submitted field keys (which are based on the HTML `id` attributes). To find the exact list, after Step 1.7 you can open your Google Sheet and read row 1 — those header strings are what to use here.

A typical Vanuatu mapping starts like:
```javascript
data = (Array.isArray(raw) ? raw : []).map(r => ({
  date: r['Timestamp'] || '',
  name: r['first_name'] || '',
  email: r['email'] || '',
  province: r['province'] || '',
  island: r['island'] || '',
  ward: r['ward'] || '',
  village: r['village'] || '',
  lat: r['lat'] || null,
  lng: r['lng'] || null,
  jiru_status: r['jiru_status'] || '',
  // ... and so on for every column in your sheet
}));
```

> Easiest way to do this: after you've submitted at least one test row in Step 1.7, open the Google Sheet, copy row 1 (all the headers), paste into a scratch file, and use that as the authoritative list of column names to map.

## Step 3.5 — Update province filter dropdowns

Search for `<option value="Choiseul">` (or any Solomon Islands province) and replace the whole `<select>` with Vanuatu options:

```html
<select id="filter-province">
  <option value="">All provinces</option>
  <option value="Torba">Torba</option>
  <option value="Sanma">Sanma</option>
  <option value="Penama">Penama</option>
  <option value="Malampa">Malampa</option>
  <option value="Shefa">Shefa</option>
  <option value="Tafea">Tafea</option>
</select>
```

## Step 3.6 — Update the map default view

Same change as the public dashboard (Step 2.4) — find the Leaflet `setView` call and update center + zoom:
```javascript
adminMap = L.map('admin-map').setView([-16.5, 168.0], 7);
```

## Step 3.7 — Update page `<title>` and heading

```html
<title>Vanuatu CPWB — admin</title>
<h1>Vanuatu CPWB admin dashboard</h1>
```

## Step 3.8 — Test locally

```
file:///path/to/vave-lab/surveys/Vanuatu/van-cpwb-admin.html
```

- Page should load and show a password prompt (or load directly into a "demo data" view if the backend is unreachable).
- Type your admin password. The Solomon Islands template auto-uses the first password in `ADMIN_PASSWORDS` for testing — you may want to add a real password prompt for production.
- You should see your test submission(s) in the table, on the map, and the export buttons (CSV / JSON) should work.

If you see only **DEMO_DATA**:
- Open the browser network tab, find the `/exec?action=admin&password=...` request, and read the response.
- A `{success: false, error: "Unauthorized"}` response means the password in the HTML doesn't match the one in the Apps Script.
- A `{success: true, data: []}` response means auth works but the sheet is empty.

## Step 3.9 — Commit and push

```bash
git add surveys/Vanuatu/van-cpwb-admin.html
git commit -m "Add Vanuatu CPWB admin dashboard"
git push origin main
```

Live URL: <https://ronvave.github.io/vave-lab/surveys/Vanuatu/van-cpwb-admin.html>

**Do not share this URL publicly.** Send it only to team members who need access, along with the admin password (via a separate channel — e.g. Signal or a password manager share, never the same email).

---

# PART 4 — End-to-end smoke test

Once all three files are pushed:

1. **Survey → Sheet:** Submit a fresh test row at `/van-cpwb-survey.html`. Confirm the row appears in the Google Sheet within a few seconds.
2. **Dashboard:** Open `/van-cpwb-dashboard.html` in a private/incognito window. Confirm the submission counter incremented and the province card updated.
3. **Admin:** Open `/van-cpwb-admin.html`, log in with your password, confirm the row appears in the table with all fields populated.
4. **CSV export:** From the admin page, click **Export CSV** — confirm the downloaded file opens correctly in Excel/Numbers with one row per submission and all columns.
5. **Delete the test rows** directly in the Google Sheet before any real data collection begins. The admin page does not currently support row-level delete; you do this manually in the sheet.

---

# Troubleshooting cheat sheet

| Symptom | Likely cause | Fix |
|---|---|---|
| Survey submit button spins forever | `APPS_SCRIPT_URL` typo, or `/dev` URL instead of `/exec` | Re-check Step 1.5/1.6 |
| Apps Script error: "You do not have permission to call openById" | The Sheet ID is wrong, or the sheet was created under a different Google account | Re-create the sheet under the same account as the script |
| Apps Script error: "Cannot read property 'postData' of undefined" | The doPost is being triggered manually inside the script editor (which sends no payload) | Just ignore — only `fetch()` calls from the survey send a real payload |
| Dashboard shows `Total submissions: 0` despite rows in sheet | Sheet tab is not named `Sheet1`, or the script can't find it | In Apps Script, change `const SHEET_NAME = "Sheet1"` to your actual tab name, then redeploy |
| Admin shows demo data only | Password mismatch between HTML and Apps Script | Make both `ADMIN_PASSWORDS` arrays match exactly, then redeploy the Apps Script |
| Map dots not showing on dashboard | Submissions don't have lat/lng values | Confirm Step 2 of the survey was completed (map marker placed) for each test row |
| Changed Apps Script code, nothing updated | Edited but didn't redeploy | **Deploy → Manage deployments → pencil → New version → Deploy** |

---

# What you'll have when you're done

- A Google Sheet collecting all Vanuatu CPWB survey submissions in real time.
- A public dashboard anyone can view (province-level aggregate stats + anonymized map, no PII).
- A password-gated admin page for full row-level data, CSV/JSON export, and inspection of individual submissions.
- All three pages independently versioned in GitHub, served via GitHub Pages, free to host indefinitely.

---

**File locations summary:**

| File | URL once pushed |
|---|---|
| Survey | `https://ronvave.github.io/vave-lab/surveys/Vanuatu/van-cpwb-survey.html` |
| Dashboard | `https://ronvave.github.io/vave-lab/surveys/Vanuatu/van-cpwb-dashboard.html` |
| Admin | `https://ronvave.github.io/vave-lab/surveys/Vanuatu/van-cpwb-admin.html` |
| Sheet | (your private Google Sheet) |
| Apps Script | (your private Apps Script project) |

---

*Maintained alongside `surveys/README.md` (framework-wide guide). For other Pacific countries (Fiji, Solomon Islands), repeat this checklist with the appropriate 3-letter prefix and province list.*
