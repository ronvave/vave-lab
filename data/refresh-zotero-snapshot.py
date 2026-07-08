#!/usr/bin/env python3
"""
Refreshes /data/itaukei-zotero-snapshot.json from the public Zotero API.
Run this whenever you've added or edited items in the iTaukei Academic Research group.

  python3 data/refresh-zotero-snapshot.py

After running, commit the updated JSON:
  git add data/itaukei-zotero-snapshot.json && git commit -m "Refresh Zotero snapshot" && git push
"""
import json, os, re, time, urllib.request
from datetime import datetime, timezone

GROUP_ID = 5983386

def fetch_all(path):
    out, start = [], 0
    while True:
        u = f"https://api.zotero.org/groups/{GROUP_ID}/{path}?limit=100&start={start}&format=json"
        req = urllib.request.Request(u, headers={"Zotero-API-Version": "3"})
        with urllib.request.urlopen(req) as r:
            total = int(r.headers.get("Total-Results", "0"))
            chunk = json.loads(r.read())
        out += chunk
        if not chunk or len(out) >= total:
            break
        start += 100
        time.sleep(0.05)
    return out

def creators(cs):
    parts = []
    for c in cs or []:
        n = c.get("name") or " ".join(x for x in [c.get("firstName"), c.get("lastName")] if x)
        if n: parts.append(n.strip())
    return parts

def year_of(dt):
    if not dt: return None
    for tok in dt.replace(",", " ").split():
        if tok.isdigit() and 1900 <= int(tok) <= 2035:
            return int(tok)
    return None

def classify_thesis_level(thesis_type: str, title: str = "") -> str:
    """Classify a thesis into 'phd' | 'masters' | 'unknown' using the thesisType
    field (and title as a fallback)."""
    haystack = f"{thesis_type} {title}".lower()
    # PhD family: PhD, doctoral, doctorate, dissertation, D.Phil, Doctor of / Doctor in
    if re.search(r"\b(phd|doctoral|doctorate|d\.?phil|dissertation|doctor of|doctor in)\b", haystack):
        return "phd"
    # Masters family: MA, MSc, MEd, MPhil, MRes, MEng, MBA, Master's, Masters, Master of, Master in
    if re.search(r"\b(m\.?a|m\.?sc|m\.?ed|m\.?eng|m\.?phil|m\.?res|mba|mia|mmis|mst|mlitt|masters?|master's|master of|master in)\b", haystack):
        return "masters"
    return "unknown"

raw = fetch_all("items")
items = []
for item in raw:
    d = item.get("data", {})
    itype = d.get("itemType")
    if itype in ("attachment", "note"): continue
    thesis_type = d.get("thesisType") or ""
    entry = {
        "key": item["key"], "itemType": itype,
        "title": d.get("title") or "",
        "creators": creators(d.get("creators")),
        "year": year_of(d.get("date")),
        "date": d.get("date") or "",
        "publicationTitle": d.get("publicationTitle") or d.get("bookTitle") or d.get("proceedingsTitle") or "",
        "university": d.get("university") or d.get("institution") or "",
        "thesisType": thesis_type,
        "DOI": d.get("DOI") or "",
        "url": d.get("url") or "",
        "collections": d.get("collections") or [],
        "tags": [t.get("tag") for t in (d.get("tags") or []) if t.get("tag")],
    }
    if itype == "thesis":
        entry["thesisLevel"] = classify_thesis_level(thesis_type, entry["title"])
    items.append(entry)

cols_raw = fetch_all("collections")
collections = [{
    "key": c["key"], "name": c["data"]["name"],
    "parent": c["data"].get("parentCollection") or None,
    "numItems": c["meta"]["numItems"],
} for c in cols_raw]

snapshot = {
    "generatedAt": datetime.now(timezone.utc).isoformat(),
    "source": {
        "group": f"https://www.zotero.org/groups/{GROUP_ID}/itaukei_academic_research/library",
        "api": f"https://api.zotero.org/groups/{GROUP_ID}",
        "groupId": GROUP_ID,
    },
    "totals": {"items": len(items), "collections": len(collections)},
    "items": items,
    "collections": collections,
}

here = os.path.dirname(os.path.abspath(__file__))
out = os.path.join(here, "itaukei-zotero-snapshot.json")
with open(out, "w") as f:
    json.dump(snapshot, f, ensure_ascii=False, separators=(",", ":"))
sz = os.path.getsize(out)/1024
print(f"Snapshot refreshed: {len(items)} items · {len(collections)} collections · {sz:.1f} KB")

# Re-encrypt every data file so the shipped .enc blobs stay in sync with
# the plaintext we just wrote. Requires VAVELAB_PASSCODE in the environment.
import subprocess, sys
root = os.path.dirname(here)
enc = os.path.join(root, "scripts", "encrypt_data.py")
if os.environ.get("VAVELAB_PASSCODE"):
    print("Re-encrypting data files\u2026")
    subprocess.run([sys.executable, enc], check=True)
else:
    print("NOTE: VAVELAB_PASSCODE not set \u2014 skipped re-encryption. Run "
          "`VAVELAB_PASSCODE=\u2026 python3 scripts/encrypt_data.py` before committing.")
