# Admin V2 — Master Google Sheet write-back: auth architecture proposal

**Status:** ⚠️ **PROPOSAL — awaiting Ron's approval before any write-back code is written** (Doc 1 requirement #15).

**Context.** The two DOCX files uploaded 2026-08-22 (Admin-V2-Master-Field-Write-Back-Requirements.docx items 1–20 and Additional-Instructions-Admin-V2-Follow-up-Tasks.docx items 21–30) require Admin V2 to become the single scholar-editing interface that writes back to the Master Google Sheet. Requirement #15 explicitly says: "**Before implementing, explain how the Admin browser will be authenticated to modify the Google Sheet.**"

This document lays out three viable auth architectures, recommends one, and describes the exact request/response contract so Ron can approve (or amend) before any code touches the sheet.

---

## Constraints (from prior instructions + rebuild guide)

1. **NEVER** expose Google credentials in public JavaScript. No API keys, OAuth client secrets, service-account keys, or long-lived write tokens can live in HTML/JS.
2. The public site is on GitHub Pages (no server-side runtime). The admin is a static HTML page loaded from the same origin.
3. The Master Sheet is owned by Ron. Only Ron edits it. There is a single admin user.
4. Writes must be **transactional-ish**: preview → write Master → write GitHub → verify → refresh → log. Partial failure must be surfaced field-by-field (Doc 1 #11).
5. Every edit needs: date/time, Scholar ID, name, worksheet, field, old value, new value, Master write status, GitHub write status (Doc 1 #16).
6. No structural changes to Master (no renaming worksheets, columns; no reordering; no new columns) without approval (Doc 1 #18).

---

## Option A (RECOMMENDED) — Google Apps Script Web App with a shared secret

**How it works**

1. Ron creates a **new Apps Script project bound to the Master Sheet**.
2. That project defines two web-app entry points:
   - `doGet(e)` — returns the **schema/mapping** (`?action=describe`) and a health-check (`?action=ping`).
   - `doPost(e)` — receives a signed JSON write request and, if authorised, performs a transactional write via `SpreadsheetApp.getRange(...).setValue(...)`.
3. The script is **deployed as a web app**:
   - "Execute as: **Me** (Ron)". Runs with Ron's Drive permissions, so no OAuth needed in the browser.
   - "Who has access: **Anyone with the link**" — required because GitHub Pages cannot authenticate to Google without exposing a secret.
   - Access-control is enforced **inside** the script via a shared secret header/body field (see below).
4. The **shared secret** is a random 32-byte token, stored in:
   - Apps Script's `PropertiesService.getScriptProperties()` (server side).
   - The admin browser's `localStorage['vavelab_apps_script_secret']` (same pattern already used for the GitHub PAT).
5. Every write request from admin includes:
   ```json
   {
     "secret":     "<32-byte token>",
     "op":         "update-scholar",
     "scholarId":  "ITK-S0315",
     "changes":    [ { "worksheet": "Scholars", "field": "Google Scholar URL", "oldValue": "...", "newValue": "..." }, ... ],
     "clientTs":   "2026-08-23T06:33:00-10:00",
     "clientHash": "sha256(canonical(changes))"
   }
   ```
6. Apps Script verifies:
   - `secret` matches `ScriptProperties.SHARED_SECRET`.
   - Every `worksheet+field` is in the **allowlisted mapping** (below).
   - `oldValue` matches the current sheet value (optimistic lock — rejects on concurrent-edit).
   - Then, inside a `LockService.getScriptLock()` critical section:
     - Reads the current values (audit trail).
     - Writes the new values.
     - Appends a row to the `Change Log` worksheet (Doc 1 #16 fields).
     - Returns per-field success/failure with the sheet's post-write value.

**Security model**

| Threat | Mitigation |
|---|---|
| Secret leaked from browser | It never leaves the admin's own laptop unless copy-pasted; secret is a `localStorage` string next to the GH PAT. Rotate by re-running deploy + updating `localStorage`. |
| Someone finds the web-app URL | URL alone does nothing: every request must carry the secret. |
| Replay | Server ignores requests older than 5 minutes (`clientTs` check). |
| Concurrent edit stomps another change | Every write includes `oldValue`; script rejects if sheet no longer matches, admin re-loads and retries. |
| Malicious admin JS bug corrupts Master | Server-side allowlist rejects anything outside the mapping table. |
| Compromise of GitHub Pages HTML | Attacker could serve rogue admin JS from the same origin. Mitigated by the local secret still being needed AND by every write being logged AND by the mapping allowlist. |

**Why this over service accounts / OAuth**

- Service-account private keys **cannot** live in browser JS.
- Full 3-legged OAuth would require a client secret **or** a hosted redirect endpoint. GitHub Pages has neither.
- Apps Script "execute as me" + shared secret gives us a de-facto server without needing to host one.

**Ron-side setup (one-time)**

1. Master sheet → Extensions → Apps Script.
2. Paste the shipped `apps-script/master-writeback.gs` (I will draft after approval).
3. `File → Project Properties → Script Properties → SHARED_SECRET = <paste>`.
4. `Deploy → Manage deployments → New deployment → Web app`.
5. Copy the deployment URL into admin's Data-source tab (`Apps Script endpoint URL`), paste `SHARED_SECRET` into the adjacent field. Both persisted in `localStorage`.

---

## Option B — Google Identity Services (GIS) OAuth in the browser

**How it works.** Admin uses the Google Identity Services library to prompt Ron for a Google login, obtain an **access token with `https://www.googleapis.com/auth/spreadsheets` scope**, and call the Sheets API directly from JS.

**Pros:** No shared secret. Standard OAuth. Fine-grained per-user consent.

**Cons:**
- Requires a Google Cloud **OAuth client ID**. Public, but attached to `https://ronvave.github.io` origin — mostly safe.
- **Requires** Ron to re-authenticate every browser session (tokens expire in ~1 hour and refresh tokens cannot be safely held in the browser).
- Access-token in browser memory means any XSS in admin JS can silently drive the sheet with full sheet-editing scope for any sheet Ron owns — **much wider blast radius** than Option A's allowlisted script.
- No server-side allowlist enforcement; the admin JS is the only line of defence.

**Verdict:** More auth-flexible but strictly less safe than Option A. Not recommended.

---

## Option C — GitHub Actions relay

**How it works.** Admin commits a "pending write" JSON file to a new branch. A GitHub Action reads the file, uses a repository-secret service-account key to hit the Sheets API, and writes to Master. Result is committed back.

**Pros:** Sensitive credentials never leave GitHub. Immutable audit trail in git.

**Cons:**
- 30-60 s round-trip minimum. Kills the interactive "preview → save → verify → refresh" UX (Doc 1 #11–12).
- Service-account writing to Ron's personal sheet is awkward (share sheet with the SA email; SA appears as the editor in Change Log; not "Ron").
- Overkill for a one-user admin.

**Verdict:** Overkill. Not recommended.

---

## Recommendation

**Adopt Option A** (Apps Script web app + shared secret). It is the only pattern that:

- Runs writes **as Ron** (audit trail in Google shows real edits by real owner).
- Enforces a **server-side allowlist** of writable fields (mapping layer, req #4).
- Keeps a **single secret** in the admin's `localStorage`, rotatable by re-deploy.
- Supports the interactive preview/save/verify loop within seconds.
- Never puts a Google credential in publicly served JS.

---

## The mapping layer (Doc 1 requirement #4)

A single JSON config drives what admin can edit and what Apps Script accepts. Below is the initial draft based on the Master worksheet inventory I confirmed today (`Scholars`, `Positions`, `Graduate Degrees`, `Lookups`, `Change Log`). Ron reviews before deploy.

```jsonc
{
  "version": "2026-08-22.0",
  "worksheets": {
    "Scholars": {
      "keyColumn": "Scholar ID",
      "editableFields": {
        "Scholar Name":           { "type": "string",   "required": true },
        "Family Name":            { "type": "string",   "required": true },
        "Given Names":            { "type": "string",   "required": true },
        "Gender":                 { "type": "enum",     "source": "Lookups!Gender" },
        "Alive / Deceased":       { "type": "enum",     "source": "Lookups!Alive / Deceased" },
        "Paternal Confederacy":   { "type": "enum-derived", "from": "Province Paternal", "lookup": "Province→Confederacy" },
        "Province Paternal":      { "type": "enum",     "source": "Lookups!Fiji Provinces" },
        "District Paternal":      { "type": "string" },
        "Island Paternal":        { "type": "string" },
        "Village Paternal":       { "type": "string" },
        "Province Maternal":      { "type": "enum",     "source": "Lookups!Fiji Provinces" },
        "District Maternal":      { "type": "string" },
        "Island Maternal":        { "type": "string" },
        "Village Maternal":       { "type": "string" },
        "Primary Discipline / Field": { "type": "string" },
        "Current Title / Role":   { "type": "string",   "note": "current-position mirror; source of truth is Positions worksheet — see #6" },
        "Current Institution":    { "type": "string",   "note": "current-position mirror" },
        "Institution Country":    { "type": "enum",     "source": "Lookups!Country" },
        "Current Department / Unit": { "type": "string", "note": "current-position mirror" },
        "Current Profile URL":    { "type": "url" },
        "ORCID / Researcher ID":  { "type": "url" },
        "Google Scholar URL":     { "type": "url" }
      },
      "notEditableInAdmin": [
        "Linked Publication Count", "First-Author Publication Count",
        "effective_paternal_province", "effective_confederacy",
        "Degree Episodes", "International Degree Episodes", "Fiji Degree Episodes",
        "Funding Episodes", "Awards Count", "Gold Medals / Prizes Count",
        "Roster Tier", "Current Leadership Category", "Current Leadership Level",
        "Highest Completed Degree", "Current PG Status"
      ]
    },
    "Positions": {
      "keyColumn": "Position ID (TBC)",
      "note": "1093 rows. Admin displays ALL positions per Scholar ID (Doc 1 #6). 'Current' is identified by an existing Master status field; Admin flags ambiguity rather than silently overwriting historical rows.",
      "action": "Ron to confirm the column that flags a Position row as current before I map it. If none exists, I recommend adding one (structural change → needs approval per #18)."
    },
    "Graduate Degrees": {
      "keyColumn": "Degree ID",
      "editableFields": {
        "Degree Stage":            { "type": "enum", "source": "Lookups!Degree Stage" },
        "Degree / Qualification":  { "type": "string" },
        "Field / Discipline":      { "type": "string" },
        "C_Uni name":              { "type": "string" },
        "O_Uni name":              { "type": "string" },
        "Country":                 { "type": "enum", "source": "Lookups!Country" },
        "International from Fiji?": { "type": "enum", "source": "Lookups!YesNo" },
        "City":                    { "type": "string" },
        "Region":                  { "type": "string" },
        "Year / Status":           { "type": "string" },
        "Completion Status":       { "type": "enum", "source": "Lookups!Completion Status" },
        "Thesis / Research Title": { "type": "string" },
        "Start Year":              { "type": "integer" },
        "Finish / Completion Year": { "type": "integer" },
        "Duration (years)":        { "type": "number" }
      },
      "note": "Multi-row per Scholar ID. Admin shows ALL rows grouped by stage (Doc 1 #7,#8). NEVER destructively collapses."
    },
    "Change Log": {
      "keyColumn": "auto",
      "writeOnly": true,
      "appendRowShape": [
        "Timestamp (ISO)", "Scholar ID", "Scholar Name",
        "Worksheet", "Field", "Old Value", "New Value",
        "Master write status", "GitHub write status", "Actor (email)"
      ]
    }
  }
}
```

Fields **not in this table** are rejected by the Apps Script write handler.

---

## Open questions before I start coding write-back

1. **Positions "current" identifier.** Which Master column flags a Position row as the current one? (Doc 1 #6.) If there is no such column, do you want me to propose adding one (structural change → your approval per #18)?
2. **Public researcher-profile URL fields on Master (`Current Profile URL`, `ORCID / Researcher ID`, `Google Scholar URL`).** Confirmed present as Master columns; fine to make them Master-editable? (Doc 1 #9.) The alternative is keeping URL edits in the enrichment overlay until you say otherwise.
3. **Change-Log actor field.** Since writes execute *as* Ron via Apps Script, `Session.getActiveUser().getEmail()` will always be Ron. Are you fine with a static `"Ron Vave (admin)"` label plus IP-in-header, or should we add a per-admin passphrase in the future?
4. **Concurrency policy.** If a Master cell was changed in Google Sheets since admin last loaded, do you want (a) hard reject with a conflict diff shown to you, or (b) last-writer-wins? I recommend (a).
5. **Emergency read-only switch.** Do you want a `SHARED_SECRET_READONLY` mode you can flip in ScriptProperties to disable all writes instantly without redeploy?

---

## What I will build once you approve

Ordered so the interactive UX comes online in the smallest possible increments:

**Phase 1 — Insights migration + prioritised CSV (does NOT need write-back auth).**

- Follow-up #22–25: decrypt old `data/scholar-insights.json.enc`, resolve names to Scholar IDs using Master + enrichment aliases, output `MATCHED / AMBIGUOUS / UNMATCHED` report + populate the new `data/scholar-insights-master.json.enc`. Preserves keywords, plain-English summaries, hyperlinks, sources.
- Follow-up #26–29: prioritised authorship-gap CSV joining old-Zotero diagnostic counts with current canonical counts; integrated into Admin Gaps tab.

**Phase 2 — Apps Script + mapping (needs approval).**

- Deploy `apps-script/master-writeback.gs` (Ron runs the deploy).
- Ship `data/admin-master-mapping.json` (the JSON above, refined per your answers).
- Admin gains "Test connection" button verifying the endpoint + secret.

**Phase 3 — Editable fields (per Doc 1 #17).**

- Section by section, Identity → Paternal geography (with dependent Province → Confederacy dropdown) → Maternal geography (same) → Discipline → Positions (multi-row with "current" flag) → Masters (multi-row) → PhD (multi-row) → Public researcher profiles → Admin enrichment.

**Phase 4 — Transactional save + change-preview modal (#11, #12).**

- Modal shows per-worksheet diff. Save runs Master write → GitHub write → verify → refresh → append expanded Change Log row.
- Partial failure surfaces exactly what succeeded/failed at field granularity.

**Phase 5 — Joeli test (#19).**

- Live round-trip with ITK-S0315 using a harmless controlled change (e.g. touch a spare field with a value we can immediately revert). Verifies read → preview → write Master → append Change Log → GitHub push → refresh cycle.

---

## Approve to proceed

Please answer:

1. ✅ / ✗ **Adopt Option A (Apps Script + shared secret)?**
2. Answers to the five open questions above (or "your call" on any of them).
3. ✅ / ✗ **Start Phase 1 (insights migration + prioritised CSV) right away** — this is write-back-free and can begin as soon as you confirm.

Once you say go, I will start Phase 1 in parallel with drafting the Apps Script for your review.
