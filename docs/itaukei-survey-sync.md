# iTaukei roster → survey sheet sync

How the "Sync to survey sheet" button in [admin.html](../admin.html) works, and how to
maintain it.

## What it does

Pushes every iTaukei scholar tagged in the admin dashboard into the Google
Sheet that backs the [community crowdsourcing survey](https://ronvave.github.io/vave-lab/itaukei-scholar-province-survey-live.html)
and its [progress page](https://ronvave.github.io/vave-lab/itaukei-scholar-province-progress.html).

Before this button existed, adding a newly-tagged scholar to the survey meant
exporting from the admin, pasting into the Sheet, and hoping the names lined
up. Now it's one click.

**Safe to run repeatedly.** The endpoint dedupes by `(lastName, firstName)`
case-insensitively, so clicking Sync ten times never adds a name twice. Existing
rows are never modified — new rows land at the bottom with a light-yellow
background and `admin-synced` in column D.

## How to use it

1. Open [admin.html](https://ronvave.github.io/vave-lab/admin.html) and sign in
2. Scroll to the **Authors extracted from Zotero** panel
3. Click **Sync to survey sheet** (top-right of the panel, next to *Push all to GitHub*)
4. **First click on any given browser:** you'll be prompted for the survey
   sheet admin key. Paste the value of `ADMIN_KEY` from the Apps Script. It's
   saved to `localStorage` so you'll never be asked again on that browser.
5. Confirm the "Sync N iTaukei scholars…" dialog
6. Wait ~2 seconds — a toast reports how many were added vs already present

### Rotating the key

If you rotate `ADMIN_KEY` in the Apps Script, **Shift-click** the Sync button
in admin.html — the prompt re-opens and you can paste the new value.

### Clearing the key manually

Open DevTools → Application → Local Storage → `https://ronvave.github.io` →
delete the `vavelab_survey_sheet_key` entry. Next Sync click will re-prompt.

## Architecture

```
admin.html (browser)
    │  POST { type: 'upsertRoster', key, scholars: [{lastName, firstName}, …] }
    │  Content-Type: text/plain; charset=utf-8   (no-cors mode)
    ▼
Apps Script web app (doPost)
    │  handleUpsertRoster_(ss, payload)
    │    1. Verify payload.key === ADMIN_KEY  → 401-style if not
    │    2. Read Scholars sheet, build dedup index by lastName||firstName
    │    3. Append missing rows with next-available id + 'admin-synced' tag
    ▼
Scholars sheet (Google Sheets)
    │
    ▼
progress page + survey page  (read the sheet on next load)
```

The `Content-Type: text/plain` header is the standard trick to avoid a CORS
preflight — Apps Script web apps don't set CORS response headers, so the
browser would reject a `Content-Type: application/json` POST. The Apps Script
side reads the body from `e.postData.contents` and `JSON.parse`s it anyway,
so the wire format is still JSON.

## Files involved

| File | What it does |
|---|---|
| [admin.html](../admin.html) (`#sync-to-sheet` button) | The button in the Authors panel |
| [js/admin.js](../js/admin.js) (`#sync-to-sheet` click handler, ~line 1911) | Collects scholars from `state.profilesByKey`, prompts for the key, posts, and reports the delta |
| Apps Script (`handleUpsertRoster_`) | Server-side dedup + append |

The Apps Script itself lives outside the repo (it's a bound-or-standalone
Google Apps Script project, not a file in Git). The canonical source for the
`handleUpsertRoster_` function is [apps_script_upsertRoster.gs](./apps-script/apps_script_upsertRoster.gs)
in this repo, kept as a reference so you can re-paste it if the script is
ever lost or migrated.

## Constants

In `js/admin.js` (top of the IIFE, ~line 30-40):

```js
const SURVEY_SHEET_URL         = 'https://script.google.com/macros/s/…/exec';
const SURVEY_SHEET_KEY_STORAGE = 'vavelab_survey_sheet_key';
```

In the Apps Script:

```js
const ADMIN_KEY = '…';  // must match what admin.html prompts for
```

The key is intentionally NOT in the repo. Prompted-once-and-cached keeps it
out of Git while sparing you from typing it on every click.

## Rebuilding the Apps Script from scratch

If you ever need to redeploy the survey sheet endpoint on a new Apps Script
project:

1. Copy the full script from the current active project (it contains
   `doGet`, `doPost`, `handleUpsertRoster_`, and the near-match rename
   helpers)
2. Paste into the new project
3. Set `SHEET_ID` at the top to the target Google Sheet's ID
4. Set `ADMIN_KEY` to a fresh random string
5. Deploy → New deployment → Web app → **Execute as: Me** / **Who has access: Anyone**
6. Copy the new `/exec` URL
7. Update `SURVEY_SHEET_URL` in [js/admin.js](../js/admin.js) to the new URL
8. Commit + push
9. On next Sync click, admin.html will re-prompt for the new key (or use
   Shift-click if it silently used a cached one)

## Cleaning up near-match duplicates

The dedup key is exact `(lowercase-trimmed-last, lowercase-trimmed-first)`.
Middle initials, punctuation, hyphens, and Fijian salutations (Adi, Ratu, Ro,
Bui) all count as distinct — so "Vunidilo, Tarisi" and "Vunidilo, Tarisi
Sorovi" would both land on the sheet.

Periodically you'll want to do a reconciliation pass to catch these. See the
one-off `cleanupSyncDuplicates` Apps Script pattern used in July 2026 — it
lists specific `(id, expectedName)` pairs to delete and verifies each row's
current name matches before removing.

## Auth model & threat surface

- The admin dashboard is behind a password gate (SHA-256 hash in
  [js/admin.js](../js/admin.js))
- The GitHub PAT and the survey sheet key are stored per-browser in
  `localStorage`, never in the repo
- The Apps Script endpoint requires `key === ADMIN_KEY` for any write
- Read endpoints (`?mode=progress`, `?mode=version`, `?mode=newScholars`) are
  intentionally open because the survey and progress pages need them
  anonymously

Someone with the admin dashboard password could re-sync, but they can already
do that manually via CSV export → paste. They cannot exfiltrate the sheet key
because it's only in the admin's own localStorage.
