# Cache-busting `?v=<sha>` on JS/CSS references

## Why this exists

GitHub Pages serves `js/*.js` and `css/*.css` with long-lived
`Cache-Control` headers. Returning visitors keep the JavaScript in
their disk cache and run it against whichever HTML they load next.
When the HTML changes but the JS doesn't, the two versions can drift
apart.

### Incident — July 2026, "Fiji click zooms to Sapporo"

- Panel B2 was updated in a single commit: new KPI tile row in the
  HTML, new totals-only rendering path in `js/itaukei-database.js`.
- The JS reference was pinned to a hand-maintained
  `?v=20260712-09`, and I forgot to bump it.
- Returning visitors' browsers refetched the HTML (short cache) but
  reused the cached `itaukei-database.js` from `?v=20260712-09`.
- New markup ran against old JS. Clicking any country row invoked a
  stale zoom path and framed the wrong region. Fiji clicks landed on
  Sapporo, Australia clicks landed on Korea/Japan.
- Incognito was fine (empty cache). That's how the diagnosis landed.

## Fix

Every `<script src="js/...">` and `<link href="css/...">` gets a
`?v=<first-8-hex-of-sha256(file)>` query string. The hash is
regenerated from the file's actual bytes, so any edit produces a new
URL and forces every browser to refetch.

```html
<script src="js/itaukei-database.js?v=35a435da" defer></script>
<link rel="stylesheet" href="css/tokens.css?v=ec2c3516" />
```

## How it stays fresh

Three layers, so nobody has to remember:

1. **`scripts/bust_cache.py`** — walks every `*.html` at the repo
   root, finds every local JS/CSS reference, and rewrites the `?v=`
   suffix to `sha256(file)[:8]`. Idempotent. Run it manually with:

   ```
   python3 scripts/bust_cache.py           # rewrite in place
   python3 scripts/bust_cache.py --check   # exit 1 on drift
   ```

2. **`.githooks/pre-commit`** — auto-runs `bust_cache.py` before
   every commit that touches `.html`, `.js`, or `.css`, then
   re-stages any HTML the script updated so the fresh hashes land in
   the same commit. Only active after
   `bash scripts/install_hooks.sh` has been run in the local clone
   (it points `core.hooksPath` at `.githooks/`).

3. **`.github/workflows/verify-cache-bust.yml`** — CI safety net.
   Runs `bust_cache.py --check` on every push/PR that touches
   HTML/JS/CSS. If a contributor didn't install the hooks, or if
   somebody hand-edits a hash, the workflow fails before the change
   ships. Also handles the case where someone edits a JS file
   without editing any HTML — the hook won't fire on the commit that
   only touches JS, but the next check will still catch the drift.

## Adding a new HTML page

Nothing to do beyond writing the plain reference:

```html
<script src="js/my-new-page.js" defer></script>
```

The pre-commit hook or CI check will rewrite it to
`js/my-new-page.js?v=<sha>` and keep it in sync forever after. Vendor
CDN URLs (anything starting with `http://` or `https://`) are ignored.

## Adding a new asset directory

`bust_cache.py` currently rewrites references matching `src="js/..."`
and `href="css/..."`. If we ever start serving hashed refs from
another directory (e.g. `assets/`), update the two regexes near the
top of `scripts/bust_cache.py` and re-run it.

## Guardrails that could not have caught this before

- The Zotero refresh workflow re-encrypts data blobs only, doesn't
  touch HTML/JS, so it never surfaced the mismatch.
- The pre-push hook (`.githooks/pre-push`) validates encrypted blobs
  parse as JSON — it doesn't know about frontend caching.

`verify-cache-bust.yml` is the workflow that would have caught this.
