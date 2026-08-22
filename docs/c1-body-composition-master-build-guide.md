# C1 "iTaukei Scholarly Publications by Gender" — Master-Mode Build Guide

**Status:** shipped and verified in commit `3b018da` on `main`.
**Live URL:** https://ronvave.github.io/vave-lab/itaukei-research-database-master.html (panel C1)
**Standalone iframe:** https://ronvave.github.io/vave-lab/itaukei-body-composition.html?embedded=1&src=master

This is the end-to-end recipe for rebuilding the C1 pictorial-body panel from a
JPG of two silhouettes plus a Master-file data slice, with V1 production
untouched. Follow it top-to-bottom the next time we need to swap silhouettes,
add a third figure, or rebuild the master data payload.

---

## 1. What ships (files touched)

Six files carry the master-mode build. Every non-trivial change is behind an
`IS_MASTER` gate so V1 (`itaukei-research-database.html` + default
`itaukei-body-composition.html`) is byte-for-byte untouched at runtime.

| File | Role |
|---|---|
| `data/body-composition-master.json.enc` | Encrypted Master-file counts (Woman/Man × 5 pub types) |
| `js/db-gate.js` | Registers the .enc file in the V1 gate's ENC_FILES map |
| `js/demo-gate.js` | Same registration for the V2 demo gate |
| `itaukei-body-composition.html` | Adds `?src=master` routing + master silhouettes + master clip math |
| `itaukei-research-database-master.html` | V2 dashboard: iframe `src` carries `?src=master&v=mfN` cache-buster |
| `docs/c1-body-composition-master-build-guide.md` | This document |

---

## 2. Locked-in design decisions (from Ron's `ask_user_question` responses)

These are the constraints that determined the shape of the whole build. Do not
revisit without asking Ron.

1. **Scope: V2 only (Master build).** Do NOT touch V1 production
   body-composition or the V1 iframe.
2. **Rendering: trace SVG paths from the reference JPG** — clean vector,
   ~7–8 KB per figure. Not raster, not stock icons.
3. **Layout: Turaga (Man) LEFT, Marama (Woman) RIGHT** — matches the JPG.
   V1's dashboard has Women on the left; V2 flips this per the reference.
4. **Preserve the existing demo/passcode behavior exactly as it is.** Do NOT
   automate the passcode gate.
5. **Preserve production unchanged.** All new behavior gated behind `IS_MASTER`.
6. **After fixing and deploying, STOP.** Manual QA by Ron.

---

## 3. Data pipeline — Master file → encrypted JSON

The panel reads a single JSON blob that gives Woman and Man totals + 5 pub-type
counts each. The Master file is the source of truth.

### 3.1 Extract counts from the Master file

- **Source spreadsheet:** `1nJvMWLS8jnCOKtRoqdDpEW3s3j9TSAclXBO1txVFxdg`
- **Join:** `scholars` × `publications` × `authorship`
- **Gender column values in Master:** `Female` / `Male` (map: Woman ← Female / Marama; Man ← Male / Turaga)
- **Publication count rule:** count each publication once per gender if ANY
  linked scholar of that gender is an author. Female + Male can overlap on the
  same publication; 2 pubs are Unknown gender and excluded from C1.
- **Deployed counts (2026-08-22 snapshot):**
  ```
  Woman: scholars=144  masters=76  phd=51  journal=340  book=19  bookSection=59  → 545 pubs
  Man:   scholars=160  masters=99  phd=53  journal=356  book=23  bookSection=104 → 635 pubs
  Total: 304 scholars, 1,180 iTaukei-associated publications
  ```

### 3.2 Compose the plaintext JSON

Save exactly this shape to `/tmp/body-composition-master.json`:

```json
{
  "source": "Master file: itaukei-master-{scholars,publications,authorship}.json",
  "uploaded": "YYYY-MM-DD",
  "Woman": {"scholars":144,"masters":76,"phd":51,"journal":340,"book":19,"bookSection":59},
  "Man":   {"scholars":160,"masters":99,"phd":53,"journal":356,"book":23,"bookSection":104},
  "total": {"scholars":304,"masters":175,"phd":104,"journal":696,"book":42,"bookSection":163,"publications":1180}
}
```

`total.publications` should equal Woman.sum + Man.sum. The other totals are
sums of the two per-gender fields.

### 3.3 Encrypt with the site's IVAV format

The demo/db gates fetch `.enc` files, not plain `.json`. Format (from
`js/db-gate.js` lines 12–15):

```
magic (4)  = "IVAV"  = 0x49 0x56 0x41 0x56
salt  (16) = random
iv    (12) = random
ciphertext = AES-GCM
KDF        = PBKDF2-HMAC-SHA256, 200,000 iterations, 32-byte key
Passcode   = Arachnid1!   (baked in demo-gate.js line 59 as atob('QXJhY2huaWQxIQ=='))
```

Python one-liner (uses `cryptography`):

```python
import os, json
from cryptography.hazmat.primitives.kdf.pbkdf2 import PBKDF2HMAC
from cryptography.hazmat.primitives import hashes
from cryptography.hazmat.primitives.ciphers.aead import AESGCM

pt = open('/tmp/body-composition-master.json','rb').read()
salt = os.urandom(16); iv = os.urandom(12)
key = PBKDF2HMAC(hashes.SHA256(), 32, salt, 200_000).derive(b'Arachnid1!')
ct  = AESGCM(key).encrypt(iv, pt, None)
open('/home/user/workspace/vave-lab/data/body-composition-master.json.enc','wb') \
  .write(b'IVAV' + salt + iv + ct)
```

Sanity check by decrypting the same file — round-trip must equal the plaintext.

### 3.4 Register the file in BOTH gate ENC_FILES maps

Even though V2 uses `demo-gate.js`, register the file in `db-gate.js` too so
future re-use in V1 previews doesn't 404. Add exactly:

```js
'data/body-composition-master.json': 'data/body-composition-master.json.enc',
```

---

## 4. Silhouettes — JPG → SVG path

### 4.1 Trace from the reference JPG

The reference JPG has two figures: a broad-shouldered Turaga (bula shirt, sulu
vakataga) on the left, a Marama (long-sleeve dress) on the right. Trace each
separately.

Recipe that worked (via `potrace` under the hood):

1. Rasterize the JPG figure at high res (~750×1800), binarize with threshold
   ~128, foreground = white.
2. **Polarity fix:** pad the binary mask with 2 px of zeros around all sides
   before tracing, so `potrace` doesn't hallucinate a bounding-frame curve.
   Use `foreground = (padded > 128)` convention.
3. Trace with `fill-rule="evenodd"` so interior gaps (between legs, under arms)
   render as holes rather than filled.
4. Keep **all** curves from potrace's output — earlier attempts kept only the
   first curve and produced 115-char skeleton paths. Working paths are ~7.5 KB.
5. **Filter the outer frame:** reject any curve whose polygon area ≥ 98% of the
   image bounding rect. That's the fake-frame curve, not the silhouette.
6. Normalize each path to a **150 × 360** viewBox (x-range 15..135, y-range
   1..359). This matches the ECharts pictorialBar's expected proportions.

### 4.2 Wire the paths into `itaukei-body-composition.html`

Near the top of the `<script>` block, inject:

```js
const SRC_MODE = (function(){
  const p = new URLSearchParams(window.location.search).get('src');
  return p === 'master' ? 'master' : 'default';
})();
const IS_MASTER = (SRC_MODE === 'master');

const MASTER_MAN_PATH   = "path://M41.70,357.86...";   // ~7.5 KB
const MASTER_WOMAN_PATH = "path://M...";                // ~7.4 KB
```

Then gate the symbol map:

```js
const BODY_SYMBOLS = IS_MASTER
  ? { "Man": MASTER_MAN_PATH, "Woman": MASTER_WOMAN_PATH }
  : { /* V1 defaults untouched */ };
```

And the gender draw order (Turaga LEFT means "Man" comes first in the category
array):

```js
const genders = IS_MASTER ? ["Man","Woman"] : ["Woman","Man"];
```

---

## 5. The coordinate-system gotcha (this is where we spent the most time)

**Read this section carefully.** Getting it wrong = pills float outside the head.

### 5.1 Two coordinate systems that look identical

ECharts pictorialBar has TWO 0..100 scales that share a name but are different:

1. **SVG-internal clip space (0..100)** — where the silhouette's own path lives.
   `symbolClip: true` clips the drawn symbol to this space. Bar values (the
   `data:` array on each pictorialBar series) are interpreted as % of
   `symbolBoundingData=100` — i.e. how far up the SVG's own coordinate box the
   clip should fill.
2. **ECharts yAxis (0..100)** — the plot area. This is where scatter label
   points render (`type: "scatter"` + `data: [{value:[x,y], _lbl:...}]`).

They coincide only when `symbolSize[1] = "100%"`. But we use
`symbolSize = [BODY_W, "86%"]`, so **the silhouette occupies yAxis 0..86 only**.
The top 14 units of the yAxis are empty space above the crown.

### 5.2 What HEAD_CLIP / FEET_CLIP actually mean

`HEAD_CLIP` and `FEET_CLIP` are used for two things simultaneously:

- **`clipH[g][i]` = the bar's data value = fill height in yAxis units.** So
  `clipH` values ARE in yAxis space. Setting `clipH[phd] = 100` fills the PhD
  band all the way to yAxis=100, but `symbolClip` hides anything above the
  silhouette's visible top (yAxis ~85.76), so we don't see it.
- **Label pill Y = also in yAxis units** — the scatter overlay renders directly
  on the yAxis. If HEAD_CLIP is in the wrong space, labels land outside the
  visible silhouette.

**Both uses require yAxis units.** V1 got away with a subtle version of this
because V1's silhouettes had scalp at SVG y ≈ 54 out of 360 (giving scalp
clip=85), and `HEAD_CLIP=85` coincidentally worked as both an SVG-internal
scalp position AND a yAxis position. For traced silhouettes with the scalp at
SVG y=1 (no transparent padding above the head), the two spaces diverge.

### 5.3 Master-mode values (locked in)

For a 150×360 traced silhouette with scalp at SVG y=1 and sole at SVG y=359,
inside a `symbolSize=[BODY_W, "86%"]` bounding box:

```
scalp_yaxis = 86 * (360 -   1) / 360 = 85.76
sole_yaxis  = 86 * (360 - 359) / 360 =  0.24
```

Therefore:

```js
const HEAD_CLIP = IS_MASTER
  ? { "Woman": 85.76, "Man": 85.76 }
  : { "Woman": 88,    "Man": 85    };
const FEET_CLIP = IS_MASTER
  ? { "Woman": 0.24,  "Man": 0.24  }
  : { "Woman": 0,     "Man": 0     };
```

### 5.4 Skip V1's PHD_BOTTOM_RAISE nudge in master mode

V1 adds 2.4 clip-units to the Man's Masters-top to make the black cap read
~half the Woman's for visual balance. Traced silhouettes are proportioned
correctly and don't need that nudge — it would inflate PhD past its true
data share. Gate it:

```js
const PHD_BOTTOM_RAISE = IS_MASTER
  ? { "Woman": 0, "Man": 0 }
  : { "Woman": 0, "Man": 2.4 };
```

### 5.5 Compute PhD pill Y dynamically in master mode

V1 pinned the PhD pill at a hardcoded `y = 91.7`, chosen empirically to sit
just above V1's scalp (y≈85–88). For master mode, compute the band's midpoint
so it's guaranteed to sit inside the black head-cap regardless of counts:

```js
if (t.key === "phd") {
  if (IS_MASTER) {
    const idxMas = TYPES.findIndex(tt => tt.key === "masters");
    const phdBottom = clipH[g][idxMas];              // top of Masters = bottom of PhD
    yPos = (phdBottom + HEAD_CLIP[g]) / 2;           // midpoint of the black cap
  } else {
    yPos = 91.7;                                     // V1 pin, unchanged
  }
}
```

### 5.6 Verified pill positions with locked-in values

Simulated with deployed formula against deployed data:

| Band | Man Y | Woman Y | Silhouette region |
|---|---|---|---|
| Book chapters | 7.24 | 4.87 | feet |
| Books | 15.80 | 10.99 | hem / ankle |
| Journal articles | 41.32 | 39.16 | mid-torso |
| Masters theses | 71.96 | 71.79 | shoulder / neck |
| **PhD theses** | **82.19** | **81.76** | **inside head-cap** |
| Scalp | 85.76 | 85.76 | crown |

All pills sit inside the visible silhouette. PhD lands ~4 units below the
scalp — comfortably inside the black cap.

---

## 6. V2 dashboard iframe wiring

In `itaukei-research-database-master.html`:

```html
<iframe src="itaukei-body-composition.html?embedded=1&src=master&v=mfN" ...>
```

**Every time you ship a change to `itaukei-body-composition.html`, bump
`mfN → mf(N+1)` here AND in the four `<script src="js/...js?v=mfN">` lines
below.** The `?v=` query string is the ONLY reliable cache-buster for
GitHub Pages, which sets `cache-control: max-age=600` (10 min) on all HTML.
Without a bumped `v=`, users on stale HTTP caches will see the old panel
for up to 10 minutes and may need a manual hard-refresh.

There are 5 places to edit in the dashboard HTML — all use the same token.
A single search-and-replace does it.

---

## 7. Deploy & QA checklist

Before every C1 change:

- [ ] `node --check` (or equivalent parse test) on the modified script region
- [ ] Round-trip test the encrypted JSON: decrypt with `Arachnid1!` and diff
      against the plaintext
- [ ] Bump `mfN → mf(N+1)` in `itaukei-research-database-master.html` (5 sites)
- [ ] Commit + push to `main`
- [ ] Wait ~45–60 s for GitHub Pages to rebuild
- [ ] `curl -sSI` the master dashboard URL and confirm `HTTP/2 200`
- [ ] `curl -sS` the deployed body-composition.html and grep for the constants
      you edited (HEAD_CLIP, FEET_CLIP, MASTER_MAN_PATH, etc.)
- [ ] Ron manually hard-refreshes (Cmd/Ctrl+Shift+R) and QAs

Rollback is one revert:

```bash
git revert <SHA> && git push origin main
```

Then bump `mfN` again to invalidate caches carrying the reverted asset.

---

## 8. What NOT to do

- **Don't automate the passcode gate.** Ron's absolute constraint. QA is manual.
- **Don't touch V1 production files.** Everything is behind `IS_MASTER`; keep it
  that way.
- **Don't set `HEAD_CLIP` to a scalp position measured in the silhouette's own
  0..100 space.** Always measure it in yAxis units:
  `HEAD_CLIP = (BODY_H_PCT) × (SVG_H − scalp_svg_y) / SVG_H`
- **Don't use `setTimeout`, polling, or arbitrary delays** to work around
  gate/data timing.
- **Don't skip the cache-buster bump.** If you skip it, users get stale HTML
  for up to 10 minutes with no way to force a refresh other than Cmd+Shift+R.
- **Don't commit exploratory `.reference` files** — a 10k-line
  `itaukei-database-orig.js.reference` slipped in on `76a55b9` and had to be
  removed in `f84d85d`. Keep local exploration outside the repo.

---

## 9. Reference commits

| SHA | What |
|---|---|
| `e45e9df` | Initial master build: silhouettes, data, gate registration, iframe wiring |
| `76a55b9` | First attempt at PhD-pill fix (dynamic midpoint, PHD_BOTTOM_RAISE gated) |
| `f84d85d` | Removed accidentally-committed `.reference` file |
| `5f0cd42` | Cache-buster bump `mf7 → mf8` |
| **`3b018da`** | **Correct HEAD_CLIP/FEET_CLIP coordinate mapping — the fix that made it work** |

---

## 10. The final "aha"

The whole build failed twice because I had the coordinate system wrong. The
lesson: **when a chart mixes `symbolBoundingData` (bar-value space) with
`symbolSize` percentages, the drawing space and the label space diverge.**
Label overlays live on the plot yAxis. If your yAxis maxes at 100 but your
silhouette only occupies 0..86 of the plot area, then any label at yAxis > 86
floats above the head. Always resolve HEAD_CLIP and FEET_CLIP to actual yAxis
positions from the SVG geometry:

```
yaxis_scalp = BODY_H_PCT × (SVG_H − scalp_svg_y) / SVG_H
yaxis_sole  = BODY_H_PCT × (SVG_H − sole_svg_y)  / SVG_H
```

That single mapping was the difference between "8% floating above head" and
"8% sitting neatly inside the black cap."
