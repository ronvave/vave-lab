# Tongan Scholar Database — Admin Panel Build Notes

Sister clone of the iTaukei Master-file Admin (V2), built inside the existing
`ronvave/vave-lab` repo. **Only new, Tongan-prefixed files were added.** No
existing iTaukei file (`admin-master.html`, `js/admin-master.js`,
`js/db-gate.js`, `js/admin-insights-migration.js`,
`js/admin-writeback-client.js`, `apps-script/*`, `docs/*`) was edited,
renamed, or deleted — verified byte-identical against `origin/main` before
commit (`git diff --stat HEAD -- <those paths>` returns empty).

Source of truth for every field/panel mapping decision below:
`tongan_scholar_database_crosswalk.md` (user-approved) and
`tongan_sheet_schema.json` (37-tab Tongan Sheet schema, dated 2026-08-28,
which resolves Crosswalk Ambiguity A — see "Judgment calls" below).

## Files added

| File | Role | Cloned from |
|---|---|---|
| `admin-tongan-master.html` | Admin panel UI, 6-tab layout, retitled | `admin-master.html` |
| `js/tongan-db-gate.js` | PBKDF2+AES-GCM passcode gate, brand-new passcode/hash, Tongan `ENC_FILES` map | `js/db-gate.js` |
| `js/tongan-database-adapter.js` | Master-file → dashboard-shape adapter (built by a sibling task; verified present and Tongan-prefixed before wiring the `<script>` tag) | `js/master-file-adapter.js` |
| `js/tongan-admin-insights-migration.js` | V1→V2 Scholar-ID-keyed insights migration, Tongan file paths | `js/admin-insights-migration.js` |
| `js/tongan-admin-writeback-client.js` | Thin GET/POST client for the future Tongan Apps Script `/exec` endpoint, Tongan-namespaced localStorage keys | `js/admin-writeback-client.js` |
| `js/admin-tongan-master.js` | Full admin CRUD logic: tabs, filters, edit modal, GitHub push, migration UI, cache-bust, change log | `js/admin-master.js` |
| `TONGAN-ADMIN-BUILD-NOTES.md` | This file | — |

## Passcode

**Updated 2026-08-29 (later same day) — Ron changed the admin-login
passcode to one of his own choosing.** `PASSWORD_HASH` in
`admin-tongan-master.js` now holds `SHA-256(<Ron's own passcode>)` instead of
the original build passcode below. The new plaintext passcode is
intentionally NOT recorded here — update this note (or just re-derive the
hash) if you need to change it again. This change touches ONLY the
admin-login gate; the data-decryption passcode (`Ongoongo9!`, item 2 below)
is completely unaffected and unchanged.

**Updated 2026-08-29 — bug fix.** There are two independent passcodes, exactly
mirroring the iTaukei system's two-gate design:

1. **Admin-login passcode** (`PASSWORD_HASH` in `admin-tongan-master.js`,
   SHA-256) = **`xIN2rULfs6kUd4jB`** *(original build value, superseded — see
   update note above)*. Guarded the initial admin login form only.
2. **Data-decryption passcode** (`VERIFIER_HASH_HEX` in `js/tongan-db-gate.js`
   AND `BAKED_PASSCODE` in `js/tongan-demo-gate.js`, PBKDF2) = **`Ongoongo9!`**.
   Guards the actual `data/tongan-master-*.json.enc` files. This MUST be
   identical between `tongan-db-gate.js` (admin) and `tongan-demo-gate.js`
   (public dashboard) because both scripts decrypt the exact same on-disk
   `.enc` blobs — exactly like the iTaukei system, where `db-gate.js`'s
   verifier and `demo-gate.js`'s `BAKED_PASSCODE` are both `"Arachnid1!"`.

**Root cause of the 2026-08-29 "Failed to load data: Operation..." admin bug:**
the admin build (this file, this session) picked `xIN2rULfs6kUd4jB` as the
db-gate data passcode, while the dashboard build (a different session) baked
`Ongoongo9!` into `tongan-demo-gate.js` and the actual `.enc` master files
were encrypted with `Ongoongo9!`. The admin's db-gate lock-screen accepted
`xIN2rULfs6kUd4jB` (matching its own verifier) but then failed to decrypt the
real files (`OperationError` / AES-GCM tag mismatch), which also skipped
`wireControls()` and left every tab unclickable. Fix: `tongan-db-gate.js`'s
`VERIFIER_HASH_HEX` was changed to `PBKDF2-HMAC-SHA256("Ongoongo9!",
"vavelab-db-verifier-v1", 200000 iters, 32 bytes)` =
`88efe3b11c2d116bccea8b724a346c6bdb59c251077197a4cbbea0623e6060ac`. No data
files were re-encrypted; no admin-login change was needed.

Any existing browser with a cached db-gate session under the old passcode
will be prompted again on next load — this is expected; enter `Ongoongo9!`.

**Root cause of the 2026-08-29 (later same day) "Save failed: Fresh decrypt of
data/tongan-scholar-enrichment.json.enc failed: OperationError" bug on
Save & push:** `js/admin-tongan-master.js` was cloned from the iTaukei
`js/admin-master.js` and its `fetchEncryptedAtSha_()` helper (used by the
race-safe pre-write "fresh decrypt" step) still read the cached
data-passcode from `localStorage['vavelab.db.session.v2']` — the iTaukei
session key. `js/tongan-db-gate.js` actually stores the unlocked passcode
under `localStorage['tonganlab.db.session.v1']` (deliberately different, per
the isolation requirement). Because both the iTaukei and Tongan pages share
the same GitHub Pages origin (`ronvave.github.io`), `localStorage` is shared
across paths — so a browser that had ever unlocked the iTaukei admin/
dashboard had a live, non-expired session under the iTaukei key holding the
iTaukei passcode. The Tongan writeback path silently read that instead of
the Tongan passcode, derived the wrong AES-256-GCM key, and
`crypto.subtle.decrypt()` correctly threw `OperationError` on the auth-tag
check. Fix: changed the single leftover constant in
`js/admin-tongan-master.js` from `_dbSessionKey = 'vavelab.db.session.v2'` to
`_dbSessionKey = 'tonganlab.db.session.v1'`. No encryption format, PBKDF2
parameters, salt handling, or passcode values changed. Verified no other
`vavelab`-branded leftovers exist in `tongan-admin-writeback-client.js`,
`tongan-admin-insights-migration.js`, or `tongan-database-adapter.js`.

## Judgment calls made during this build

1. **Admin-login SHA-256 passcode (separate from the db-gate PBKDF2
   passcode).** The task specified exactly one new passcode
   (`xIN2rULfs6kUd4jB`), but the iTaukei admin has *two* independent gates:
   a SHA-256 admin-login passcode (`PASSWORD_HASH` in `admin-master.js`,
   guarding "Arachnid1!") and the PBKDF2 db-gate passcode. Rather than invent
   an undocumented second secret, `admin-tongan-master.js` reuses
   `xIN2rULfs6kUd4jB` for the admin-login gate too, with a fresh
   `SHA-256("xIN2rULfs6kUd4jB")` hash
   (`1046112d600820b2e1e0255d570b99018a71a52b559bc9510a2d75891ed4993a`) —
   documented inline in the file. If a distinct admin-login passcode is
   wanted, only that one hash constant needs to change.

2. **Cultural & Lineage Affiliation fields (Crosswalk Ambiguity A).** The
   crosswalk flagged as an open question whether Estate/Chiefly Affiliation
   (Tofiʻa), Haʻa/Lineage, Kāinga, and Self-identified Home/Community
   Affiliation should be split Paternal/Maternal. `tongan_sheet_schema.json`
   (dated after the crosswalk, "per user decision (2026-08-28)") already
   resolves this — the Scholars tab headers list all four fields split
   Paternal/Maternal. This build follows the schema: a new **"Cultural &
   lineage affiliation"** fieldset was added to the edit modal with all 8
   fields (4 concepts × Paternal/Maternal), positioned after Maternal
   geography and before the Current-position fieldset. These fields have no
   Fiji V2 equivalent and are never inferred from geography, surname, or
   title — matching the schema's explicit rule.

3. **Dropped tikina-level District field.** Per crosswalk §4, iTaukei's
   `District Paternal/Maternal` (a sub-province tikina layer) has no Tonga
   administrative equivalent and was dropped, not renamed. The admin no
   longer has `me-dist-paternal`/`me-dist-maternal` inputs; the old iTaukei
   `Province` field became the Tongan `District` dropdown, and
   `Village`/`Island` became independently curated `Village/Town (Kolo)` and
   `Specific Island` fields per scholar (never derived from District), per
   the crosswalk's explicit "Specific Island as its own field" requirement.

4. **District → Island Division lookup table.** `tongan_sheet_schema.json`
   only supplies the *headers* for the "Tonga District-Island Division
   Lookup" worksheet, not the row data. The 23-district → 5-division mapping
   used in `DISTRICT_TO_DIVISION` (in `js/admin-tongan-master.js`) was
   reconstructed from the district names already enumerated as grouped tag
   columns on the schema's `Publications` tab (Tongatapu / Vavaʻu / Haʻapai /
   ʻEua / Ongo Niua groupings), which matches the crosswalk's cited 2021
   Census source (23 districts, 5 Island Divisions).

5. **Gender labels.** `Male`/`Female` → `Tangata`/`Fefine` in the admin's
   Gender `<select>` (`Unknown` unchanged). Per the task's explicit
   instruction, the iTaukei silhouette icon set was kept as-is (no imagery
   changes were made — Panel C1 body-composition silhouette assets live in
   the public dashboard, not in this admin panel, so nothing needed changing
   here).

6. **Scholar ID prefix.** Confirmed from the crosswalk (§3, row 2 and row
   33): iTaukei uses `ITK-S####` (Scholars) / `ITK-R####` (Researchers).
   The Tongan clone uses `TON-S####` / `TON-R####` throughout comments,
   placeholders, and the photo-path convention
   (`img/scholars/<TON-Sxxxx>.jpg`). CRUD in `admin-master.js` was already
   ID-string-keyed (joins by `s['Scholar ID']`, never by row index) with no
   hardcoded prefix-generation logic to change — Scholar IDs are supplied by
   the Master Sheet / write-back layer, which is out of scope for this admin
   panel build.

7. **`js/tongan-database-adapter.js` ownership.** Per the task, this file
   was being built by a sibling dashboard-build task. It was absent on first
   check, present (mid-write, still referencing iTaukei file paths) on a
   30-second recheck, and fully Tongan-prefixed (exposing
   `window.MasterFileAdapter`, fetching `data/tongan-master-*.json`,
   `data/tonga-districts.geojson`, etc.) on a second 30-second recheck. This
   build only *points* `admin-tongan-master.html`'s script tag at it and did
   not author or edit its contents.

8. **Data pipeline / Apps Script / GitHub Actions workflow.** Building the
   actual Tongan Master Sheet, its Apps Script `.gs` deployment, and a
   `refresh-tongan-master-file.yml` GitHub Action are explicitly out of
   scope for this admin-panel task (per the crosswalk, these are separate
   build phases). `js/admin-tongan-master.js` already references the
   Tongan-prefixed data files and dispatches
   `refresh-tongan-master-file.yml` by name so it is wired correctly for
   when that workflow exists; until then, the dispatch button will
   gracefully report a failed/404 dispatch (existing error-handling path,
   unchanged from the iTaukei version) without blocking any other admin
   function. Likewise `js/tongan-admin-writeback-client.js` never hardcodes
   an Apps Script `/exec` URL — the user pastes it into the Data source tab
   once that endpoint is deployed, exactly like the iTaukei flow.

9. **`docs/APPS-SCRIPT-DEPLOY.md` link.** The Data source tab's "one-time
   setup" link still points at the existing shared `docs/APPS-SCRIPT-DEPLOY.md`
   (not duplicated), since no Tongan-specific deploy guide exists yet and the
   underlying Apps Script deploy mechanics (Extensions → Apps Script → paste
   code → generate secret → Deploy) are identical procedure, just against a
   different (future) spreadsheet/script project.

## What was NOT changed

- No existing iTaukei file's bytes changed (verified via `git status`/`git
  diff` against `origin/main` before commit — zero diff on
  `admin-master.html`, `js/admin-master.js`, `js/db-gate.js`,
  `js/admin-insights-migration.js`, `js/admin-writeback-client.js`,
  `apps-script/*`, `docs/*`).
- No Tongan Master Google Sheet, Apps Script deployment, or GitHub Actions
  workflow was created — those remain future build phases per the
  crosswalk.

## Deployed URL

Once GitHub Pages redeploys (typically ~30–90 seconds after push):

**https://ronvave.github.io/vave-lab/admin-tongan-master.html**

The page will show the passcode-gate lock screen (`js/tongan-db-gate.js`)
and, once unlocked with `xIN2rULfs6kUd4jB`, the admin login screen (same
passcode, see judgment call #1). No Tongan data files exist on the server
yet, so all panels will show an honest empty state until the Tongan Master
Sheet + data pipeline (out of scope here) are built and populated.
