# Phase 3.5 — Legacy Year of Birth / Year of Death migration report

**Date:** 2026-08-23
**Author:** Ron Vave (admin)
**Scope:** Removal of the duplicate Admin-owned `Year of Birth` and `Year of Death` inputs from the Admin V2 edit modal and their associated write path into `data/scholar-enrichment.json.enc`.

---

## What existed before Phase 3.5

The Admin V2 edit modal historically had **two** sets of year-of-birth / year-of-death inputs on the same scholar profile:

1. **Master Identity fieldset** — `#me-year-of-birth` and `#me-year-of-death`, which write straight to the Master Google Sheet `Scholars` worksheet, columns `Year of Birth` and `Year of Death`, via the Apps Script write-back endpoint.
2. **Admin-owned fields fieldset** — `#pf-birth` and `#pf-death`, which wrote into `state.enrichmentDoc.scholars[SID].yearOfBirth`, `.yearOfDeath` (and `.deceased`) inside `data/scholar-enrichment.json.enc` on GitHub.

The public dashboard (`js/master-file-adapter.js` `buildProfiles`) composes each scholar profile by taking the Master row first and then overlaying `state.enrichmentDoc.scholars[SID]` (`adminExtras`). For photo / sector / institutionUrl / departmentUrl this is fine — those are Admin-owned by design. For years of birth and death it was a source of confusion: two different UI controls could disagree, and the enrichment sidecar values would silently mask any change made in the Master column.

## What Phase 3.5 changes

1. **HTML** — `admin-master.html` no longer renders the `#pf-birth` / `#pf-death` inputs. The Admin-owned fieldset now contains only Sector, Institution URL, and Department URL. The Master Identity fieldset (Title / Salutation, Given Names, Family Name, Alive / Deceased, Year of Birth, Year of Death, Gender, Primary Discipline / Field) is unchanged.
2. **Client write path** — `performNonMasterPush` in `js/admin-master.js` no longer reads `#pf-birth` or `#pf-death` and no longer writes `yearOfBirth`, `yearOfDeath`, or `deceased` into the enrichment record. A guard was also added to the modal populate step so that if the duplicate inputs ever come back (unlikely) they still populate without errors.
3. **Master write path** — unchanged. `#me-year-of-birth` and `#me-year-of-death` continue to go through the field-level Phase 3.4 dry-run / commit / re-read-before-write pipeline. `Alive / Deceased` also continues through the ALWAYS_CONFIRM path.
4. **No silent overwrite of the encrypted enrichment file.** The client stops **writing** the two fields, but existing values that live in `data/scholar-enrichment.json.enc` are preserved verbatim. On the next save-and-push of any scholar, the pruned record is re-written with those legacy keys still present (because the `Object.assign({}, state.enrichmentDoc.scholars[sid] || {})` seed copies them forward untouched, and no code path deletes them).

## Migration-inspection tool

A new card on the Admin V2 **Data source** tab — "Legacy Year of Birth / Year of Death migration inspection" — runs a **read-only** inspection over the already-decrypted `state.enrichmentDoc` and the loaded `state.scholarById` Master rows. For every scholar that carries a sidecar `yearOfBirth` or `yearOfDeath`, it reports one of three states per cell:

- **Master cell BLANK, enrichment has a value.** These are candidates for manual migration: the value came from an Admin V2 write that never made it onto the Master sheet.
- **Master cell disagrees with enrichment.** Needs a human decision. Almost certainly a case where Admin V2 wrote the enrichment sidecar but Ron subsequently corrected the Master sheet directly (or vice versa).
- **Master cell agrees with enrichment.** Safe to leave. The sidecar is redundant now that Master is authoritative; it will fall away naturally as future edits touch the record.

The tool never writes. To migrate a value, open the affected scholar in the Scholars tab, enter the value in the Master `Year of Birth` or `Year of Death` input in the Identity fieldset, and click Save & push. That goes through the Phase 3.4 conflict-handling pipeline (dry-run classify → confirm if `already_satisfied` or `needs_confirmation`) and the Phase 3.5 auto-refresh (see the completion report).

## Why the tool is client-side instead of a workspace file

`data/scholar-enrichment.json.enc` is encrypted with the vavelab passcode and never committed to the repository in plaintext. The only place the plaintext exists is in an authenticated Admin V2 session (the Web Crypto-decrypted `state.enrichmentDoc`). Producing this migration report from a headless workspace subagent would require handing that passcode to a non-browser process, which is out of scope for Phase 3.5 and against the project's data-safety posture. Doing the inspection in-browser after the admin unlocks the database keeps the passcode where it already lives.

## Result

- Duplicate UI is gone.
- Duplicate write path is gone.
- Nothing has been silently deleted or overwritten in `scholar-enrichment.json.enc`.
- Ron can run the inspection at any time to see whether any legacy sidecar YoB/YoD values still need to be moved onto the Master sheet, and can migrate them one scholar at a time through the ordinary edit flow.
