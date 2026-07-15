# Vave Lab

Public website and research infrastructure for **Dr. Ron Vave**, Assistant
Professor in Ocean Governance & Marine Resource Management at the
[Department of Pacific Islands Studies](https://hawaii.edu/cpis/), University
of Hawaiʻi at Mānoa. Work spans iTaukei (indigenous Fijian) scholarly
infrastructure, culturally protected water bodies, marine resource
management, and Pacific socioecology.

Live at **[ronvave.github.io/vave-lab](https://ronvave.github.io/vave-lab/)**
— static HTML/CSS/JS served straight from `main` by GitHub Pages.

## What lives here

### Public site

The homepage and standard academic pages — research, publications, teaching,
supervision, service, media, community workshops, LMMA network, and the terms
page. All static HTML, no framework, keyed off shared CSS in [`css/`](css/)
and partials in [`partials/`](partials/).

### iTaukei Research Database

A live directory of iTaukei postgraduate scholars and their publications,
built from a curated Zotero library.

- **[itaukei-research-database.html](https://ronvave.github.io/vave-lab/itaukei-research-database.html)** — public browseable database with search, province/confederacy filters, and per-scholar profile pages
- **[admin.html](https://ronvave.github.io/vave-lab/admin.html)** — password-gated dashboard for curating scholar profiles, tagging iTaukei researchers, uploading photos, and syncing to the survey infrastructure
- **[data/scholar-profiles.json.enc](data/)** — encrypted source of truth for all curated profile data

Source data flows: **Zotero library → refresh scripts → `.enc` snapshots →
admin dashboard → public database**. The admin never writes plaintext to the
repo; all committed data files are encrypted with a passcode-derived key
(see [`scripts/encrypt_data.py`](scripts/encrypt_data.py)).

### Community Crowdsourcing Survey

A public survey where iTaukei community members help fill in missing
paternal/maternal village and province data for scholars in the database.

- **[itaukei-scholar-province-survey-live.html](https://ronvave.github.io/vave-lab/itaukei-scholar-province-survey-live.html)** — the survey itself
- **[itaukei-scholar-province-progress.html](https://ronvave.github.io/vave-lab/itaukei-scholar-province-progress.html)** — live progress dashboard: tagged / partial / needs help
- **[itaukei-scholar-province-survey-admin.html](https://ronvave.github.io/vave-lab/itaukei-scholar-province-survey-admin.html)** — admin view of pending submissions
- **Google Sheet backend** via an Apps Script web app that handles reads
  (progress fetches) and writes (survey submissions, roster sync)

See [`docs/itaukei-survey-sync.md`](docs/itaukei-survey-sync.md) for the
architecture of the admin ↔ survey-sheet sync.

### CPWB / FPA Surveys

Country-specific web surveys documenting **Culturally Protected Water Bodies**
and **Funerary Protected Areas** across the Pacific. Currently active for
Vanuatu; Fiji, Solomon Islands, Tonga, Samoa planned. See
[`surveys/README.md`](surveys/README.md) for the framework.

### Jiru sub-project

Standalone survey + admin + dashboard for a separate collaboration.
`jiru-survey.html`, `jiru-admin.html`, `jiru-dashboard.html`.

## Repository layout

```
vave-lab/
├── index.html, research.html, publications.html, …    ← public site pages
├── admin.html                                         ← iTaukei database curation dashboard
├── itaukei-research-database.html                     ← public scholar database
├── itaukei-scholar-province-*                         ← community crowdsourcing survey pages
├── jiru-*                                             ← Jiru sub-project
├── css/                                               ← shared stylesheets
├── js/                                                ← page-specific JS (admin.js is the largest)
├── partials/                                          ← HTML fragments (header, footer, nav)
├── img/                                               ← photos, scholar portraits, hero images
│   └── scholars/                                      ← per-scholar portraits (slug-named)
├── data/                                              ← encrypted source data + geojson
│   ├── scholar-profiles.json.enc
│   ├── itaukei-zotero-snapshot.json.enc
│   ├── itaukei-graduate-studies.json.enc
│   ├── fiji-provinces.geojson.enc
│   └── …
├── scripts/                                           ← Python data pipeline
│   ├── encrypt_data.py                                ← passcode-based encryption
│   ├── decrypt_data.py                                ← reverse for local editing
│   └── build_scholar_insights.py                      ← derived aggregates
├── surveys/                                           ← CPWB/FPA country surveys
├── online-surveys/                                    ← older survey artifacts
└── docs/                                              ← architecture notes
    ├── itaukei-survey-sync.md
    └── apps-script/
        └── apps_script_upsertRoster.gs
```

## Working on the repo

### Editing content

Most pages are hand-written HTML — edit the file, commit, push. GitHub Pages
picks up the change within a minute or two.

### Editing encrypted data

The scholar database and other sensitive data files are stored as `.enc`
blobs. To edit:

```bash
# Decrypt (creates the plaintext .json alongside the .enc)
VAVELAB_PASSCODE='<passcode>' python3 scripts/decrypt_data.py scholar-profiles.json

# ... make your edits to data/scholar-profiles.json ...

# Re-encrypt (overwrites the .enc)
VAVELAB_PASSCODE='<passcode>' python3 scripts/encrypt_data.py scholar-profiles.json

# Clean up the plaintext before committing
rm -f data/scholar-profiles.json

# Commit + push the .enc only
git add data/scholar-profiles.json.enc
git commit -m "data: update scholar profiles"
git push
```

**Never commit a plaintext `.json` for any file that also has a `.enc` sibling.**

### Pre-push guardrail

After a fresh clone, run once:

```bash
bash scripts/install_hooks.sh
```

That wires `.githooks/pre-push` into git and enables two checks on every push:

1. **Decrypt sanity** — every `.enc` file being pushed must decrypt with
   `$VAVELAB_PASSCODE` and parse as JSON. Blocks corrupted blobs.
2. **Message vs. diff consistency** — if any commit message in the push
   range mentions a data-file symptom but no `.enc` file is in the diff,
   the push is blocked. Catches the rebase-drop failure mode where
   `git checkout --ours` silently resolves an `.enc` conflict to the
   wrong side and the data change never actually ships.

   Symptoms include:
   - filenames under `data/`, the `.enc` / `.json` / `.geojson` extensions
   - JSON field names like `zoteroCollectionKey*`
   - known data files: `fiji-provinces`, `scholar-profiles`,
     `itaukei-zotero-snapshot`, `scholar-insights`, `world-universities`,
     `workplace-coords`, `uni-country-overrides`, `itaukei-graduate-studies`
   - named panel-root Zotero keys: `RNKFUZ6M` (C1), `AREH32KK` (C1 non-
     provincial), `V3HLPDPL` (B3), `9XHGQJE6` (B2), `QGHHHAAC` (B3 FSM),
     `FLF6KCLK` (B3 provinces), `WWUJNIF4` (B3 Fiji provinces)
   - any Zotero collection key shape (8 alphanumeric chars mixing letters
     and digits), so per-province and per-country child keys like
     `97DILJ4T` (Ba), `ARS78SQY` (Rewa), or `I96RVKH7` (Vietnam) trigger
     the check even when the panel root isn't named

Unit tests: `python3 scripts/tests/test_symptom_regex.py`. Extend the
coverage lists in `scripts/verify_enc_freshness.py` when new panel roots
or data files land.

Export `VAVELAB_PASSCODE` in your shell so check #1 runs. Set
`VAVELAB_SKIP_ENC_CHECK=1` for a one-off override when you genuinely mean
to push a JS-only commit that happens to name a data file, or when a
rare English identifier collides with the Zotero-key shape (e.g.
`MAX86400`).

### Refreshing from Zotero

```bash
python3 data/refresh-zotero-snapshot.py
python3 data/refresh-graduate-studies.py
```

Both write encrypted snapshots into `data/`.

### Using the admin dashboard

Open [admin.html](https://ronvave.github.io/vave-lab/admin.html), enter the
admin password. From there:

- **Push all to GitHub** — commits any admin-side edits back to
  `data/scholar-profiles.json.enc` using a GitHub PAT saved in localStorage
- **Sync to survey sheet** — pushes the tagged iTaukei roster into the
  survey's Google Sheet ([docs](docs/itaukei-survey-sync.md))
- **Copy for Google Sheets** — TSV export
- **Copy all as JSON** — full JSON export for pasting into
  `data/scholar-profiles.json`

Both credentials (GitHub PAT, survey sheet admin key) are prompted for the
first time in each browser and cached in localStorage. Neither ever lives in
the repo.

## Related infrastructure

- **Zotero group library:** [iTaukei Academic Research](https://www.zotero.org/groups/5983386/itaukei_academic_research/library)
- **Google Sheet (survey backend):** private; managed by Ron
- **Apps Script (survey backend):** deployed as a web app; see
  [docs/itaukei-survey-sync.md](docs/itaukei-survey-sync.md) for the
  architecture and rebuild-from-scratch instructions

## Contact

Dr. Ron Vave · Assistant Professor in Ocean Governance & Marine Resource
Management · [Department of Pacific Islands Studies](https://hawaii.edu/cpis/) ·
[Fisheries Graduate Program](https://manoa.hawaii.edu/fisheries/) · University
of Hawaiʻi at Mānoa
