#!/usr/bin/env python3
"""Build a LOCAL preview of a generated country kit. Nothing is pushed and no
Master is written; the Master is only read.

    python3 scripts/country_kit/build_preview.py cook

Output: /tmp/kit/preview/<key>/  (generated files + img/<key>/ + data/*.enc)
Serve with serve_preview.py, which falls back to the repo for shared files.
"""
from __future__ import annotations

import argparse
import base64
import json
import os
import shutil
import subprocess
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
from kitlib import ROOT, load_country, norm  # noqa: E402
from generate_country import generate  # noqa: E402
import governance_dump  # noqa: E402

from PIL import Image, ImageFilter  # noqa: E402
from cryptography.hazmat.primitives.ciphers.aead import AESGCM  # noqa: E402
from cryptography.hazmat.primitives.kdf.pbkdf2 import PBKDF2HMAC  # noqa: E402
from cryptography.hazmat.primitives import hashes  # noqa: E402


def encrypt(plain: bytes, passcode: str) -> bytes:
    salt, iv = os.urandom(16), os.urandom(12)
    key = PBKDF2HMAC(algorithm=hashes.SHA256(), length=32, salt=salt, iterations=200_000).derive(passcode.encode())
    return b"IVAV" + salt + iv + AESGCM(key).encrypt(iv, plain, None)


def geojson(cfg: dict) -> dict:
    g = json.loads(Path(cfg["geojson"]["file"]).read_text())
    prop = cfg["geojson"]["nameProp"]
    aliases = cfg["geojson"].get("aliases", {})
    lookup = {norm(d).lower(): d for d in cfg["districtList"]}
    lookup.update({norm(d.split(" / ")[0]).lower(): d for d in cfg["districtList"]})
    feats, unmatched = [], []
    for f in g["features"]:
        raw = f["properties"].get(prop, "")
        name = aliases.get(raw, raw)
        d = lookup.get(norm(name).lower())
        if not d:
            unmatched.append(raw)
            continue
        feats.append({"type": "Feature", "geometry": f["geometry"],
                      "properties": {"district": d, "islandDivision": cfg["districtToDiv"][d],
                                     "source": cfg["geojson"]["attribution"]}})
    return {"type": "FeatureCollection", "name": f"{cfg['key']}-districts",
            "metadata": {"source": cfg["geojson"]["attribution"], "districtCount": len(feats),
                         "unmatched": unmatched,
                         "missingDistricts": sorted(set(cfg["districtList"]) - {x["properties"]["district"] for x in feats})},
            "features": feats}


def art(cfg: dict, out: Path):
    d = out / "img" / cfg["key"]
    d.mkdir(parents=True, exist_ok=True)
    flag = Image.open(ROOT / cfg["art"]["flag"]).convert("RGB")
    w, h = flag.size
    tw = int(h * 144 / 200)
    flag.crop(((w - tw) // 2, 0, (w - tw) // 2 + tw, h)).resize((144, 200), Image.LANCZOS).save(d / "flag-fingerprint.webp")
    hdr = Image.open(ROOT / cfg["art"]["header"]).convert("RGB")
    for name, size in (("panel-header-sea.webp", (2000, 357)), ("panel-header-whale.webp", (2665, 724)),
                       ("panel-header-b2-emblem.webp", (1500, 389))):
        tw, th = size
        sw, sh = hdr.size
        scale = max(tw / sw, th / sh)
        im = hdr.resize((int(sw * scale) + 1, int(sh * scale) + 1), Image.LANCZOS)
        x, y = (im.width - tw) // 2, (im.height - th) // 2
        im.crop((x, y, x + tw, y + th)).save(d / name, quality=82)
    # plain cream texture (no Tongan mat art)
    im = Image.new("RGB", (1600, 600), (246, 238, 223))
    noise = Image.effect_noise((1600, 600), 6).convert("RGB")
    Image.blend(im, noise, 0.04).filter(ImageFilter.GaussianBlur(0.6)).save(d / "mat-background.webp", quality=80)
    fav = out / "img" / "favicons"
    fav.mkdir(parents=True, exist_ok=True)
    src = Image.open(ROOT / cfg["art"]["flag"]).convert("RGBA")
    for s in (32, 64):
        src.resize((s, s), Image.LANCZOS).save(fav / f"flag-{cfg['iso3']}-{s}.png")


def stubs(cfg: dict, data: Path, dump: Path):
    k = cfg["key"]
    look = json.loads((dump / "Lookups.json").read_text())["rows"][4:]
    unis = [{"name": r[0], "location": [float(r[3]), float(r[2])], "country": r[1], "city": ""} for r in look]
    return {
        f"{k}-districts.json": {"zoteroCollectionKey_c1Root": "", "districts": cfg["districtList"], "note": "preview"},
        f"{k}-body-composition.json": {"Woman": {}, "Man": {}, "note": "preview"},
        f"{k}-graduate-studies.json": {"scholars": [], "worldPoints": [], "note": "preview"},
        f"{k}-last-sync.json": None,
        f"{k}-scholar-enrichment.json": {"version": 1, "scholars": {}, "updatedAt": None},
        f"{k}-scholar-insights.json": {"version": 1, "scholars": {}},
        f"{k}-scholar-insights-master.json": {"version": 1, "scholars": {}, "updatedAt": None},
        f"{k}-scholar-profiles.json": {"scholars": {}, "nameAliases": {}, "hiddenScholars": [], "notItaukeiAuthors": []},
        f"{k}-zotero-snapshot.json": {"items": [], "collections": [], "note": "preview"},
        f"{k}-world-universities.json": {"_comment": "preview", "universities": unis},
        f"{k}-auto-resolved.json": {}, f"{k}-uni-country-overrides.json": {}, f"{k}-workplace-coords.json": {},
    }


def write_clans(cfg: dict, out: Path, dump: Path):
    """Tonga ships a curated clan order. Other countries get the distinct
    values already recorded in their Master (never invented); FSM has none."""
    rows = json.loads((dump / "Scholars.json").read_text())["rows"]
    h = rows[3]
    vals = set()
    for col in ("Clan Paternal", "Clan Maternal"):
        if col in h:
            i = h.index(col)
            vals.update(r[i].strip() for r in rows[4:] if i < len(r) and r[i].strip())
    k = cfg["KEY"]
    body = ",\n    ".join(json.dumps(v, ensure_ascii=False) for v in sorted(vals))
    (out / "js" / f"{cfg['key']}-clans.js").write_text(
        f"/* {cfg['levels']['clan']['plural']} recorded in the {cfg['country']} Master (preview; replace with a curated order). */\n"
        f"(function (global) {{\n  'use strict';\n  global.{k}_CLANS = Object.freeze([\n    {body}\n  ]);\n}})(window);\n")


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("key")
    ap.add_argument("--skip-fetch", action="store_true")
    ap.add_argument("--pp-file", help="passcode file (default /tmp/kit/.<key>-pp)")
    ap.add_argument("--out", help="output folder (default /tmp/kit/preview/<key>)")
    a = ap.parse_args()
    key = a.key
    cfg = load_country(key)
    pp_file = Path(a.pp_file or f"/tmp/kit/.{key}-pp")
    pp = pp_file.read_text().strip()
    out = Path(a.out or f"/tmp/kit/preview/{key}")
    if out.exists():
        shutil.rmtree(out)
    generate(key, out, ("dashboard", "admin", "pipeline"), str(pp_file))
    dump = Path(f"/tmp/kit/{key}-dump")
    if not a.skip_fetch:
        rep = governance_dump.build(key, dump)
        print("dump:", {k: v.get("rows") for k, v in rep.items() if isinstance(v, dict)})
    plain = Path(f"/tmp/kit/{key}-data")
    if plain.exists():
        shutil.rmtree(plain)
    plain.mkdir(parents=True)
    # Overlay root: repo scripts + generated scripts, so helpers that put
    # ROOT/scripts first on sys.path still find the generated country modules.
    pyroot = Path(f"/tmp/kit/pyroot/{key}")
    if pyroot.exists():
        shutil.rmtree(pyroot)
    (pyroot / "scripts").mkdir(parents=True)
    for f in (ROOT / "scripts").glob("*.py"):
        shutil.copy(f, pyroot / "scripts" / f.name)
    for f in (out / "scripts").glob("*.py"):
        shutil.copy(f, pyroot / "scripts" / f.name)
    for d in ("data", "js", "img"):
        (pyroot / d).symlink_to(ROOT / d)
    env = dict(os.environ, PYTHONPATH=f"{pyroot}/scripts")
    r = subprocess.run([sys.executable, str(pyroot / "scripts" / f"{key}_master_file_transformer.py"), "--mode", "local",
                        "--dump-dir", str(dump), "--out-dir", str(plain)], capture_output=True, text=True, env=env)
    print(r.stdout[-1500:], r.stderr[-1500:])
    for name, obj in stubs(cfg, plain, dump).items():
        if not (plain / name).exists():
            (plain / name).write_text(json.dumps(obj))
    gj = geojson(cfg)
    print("geojson:", gj["metadata"]["districtCount"], "unmatched", gj["metadata"]["unmatched"],
          "missing", gj["metadata"]["missingDistricts"])
    (plain / f"{key}-districts.geojson").write_text(json.dumps(gj))
    data = out / "data"
    data.mkdir(parents=True, exist_ok=True)
    for f in plain.iterdir():
        (data / (f.name + ".enc")).write_bytes(encrypt(f.read_bytes(), pp))
    shutil.copy(ROOT / "data" / "tonga-country-list.json", data / f"{key}-country-list.json")
    (data / f"{key}-share-tokens.json").write_text(json.dumps({"country": cfg["countryValue"], "m": {}}))
    (data / f"{key}-revoked-demos.json").write_text(json.dumps({"revoked": []}))
    write_clans(cfg, out, dump)
    art(cfg, out)
    print("preview ready:", out)


if __name__ == "__main__":
    main()
