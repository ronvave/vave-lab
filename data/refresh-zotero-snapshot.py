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
    field (and title as a fallback).

    Ron enters Zotero thesisType values in many shapes: 'PhD', 'Ph.D.',
    'M.Sc.', 'M. Sc.', 'M.Env.Sc.', 'M.Ag.Sc.', 'M.Com.', 'M. Com.'. We strip
    interior dots and whitespace before matching so all of those collapse to
    the same normalized form ('phd', 'msc', 'menvsc', 'magsc', 'mcom' …).
    Bachelor's degrees (BA, BSc, B.App.Sc.) intentionally stay unclassified
    so they never appear in Panel C1, which only tracks PhD + Masters theses.
    """
    # Two normalized forms of the Zotero thesisType field:
    #   tt_raw    lower-case but interior punctuation/spacing preserved.
    #             Used for phrase matches like 'doctor of ...' and 'master of'.
    #   tt_norm   dots and whitespace stripped so 'M. Sc.', 'M.Sc.', 'MSc' all
    #             collapse to 'msc'; 'Ph.D.' becomes 'phd'; 'LL.M.' -> 'llm'.
    tt_raw = (thesis_type or "").lower()
    tt_norm = re.sub(r"[.\s]+", "", tt_raw)
    # Title also lower-cased and kept space-preserved for phrase fallbacks.
    title_norm = (title or "").lower()

    if not tt_norm and not title_norm:
        return "unknown"

    # ---- PhD family ---------------------------------------------------------
    # Starts with a known doctoral abbreviation. Because dots/spaces are
    # already stripped, this matches 'PhD Thesis' -> 'phdthesis',
    # 'Ph.D. Theol. thesis' -> 'phdtheolthesis', 'Ed.D. thesis' -> 'eddthesis',
    # 'D.Min. thesis' -> 'dminthesis', 'SJD thesis' -> 'sjdthesis', etc.
    if re.match(r"^(phd|dphil|doctorate|doctoral|edd|ded|dmin|sjd|jsd|dth|dsc|ddent|dclindent|drph|drjur)", tt_norm):
        return "phd"
    # Starts with the word 'doctor' — covers 'Doctor of Philosophy',
    # 'Doctor of Education', 'Doctor of Clinical Dentistry',
    # 'Doctor of Juridical Science', 'Doctor in ...'.
    if re.match(r"^doctor", tt_norm):
        return "phd"
    # Contains a spelled-out doctorate anywhere in the normalized string,
    # e.g. 'Doctor of Philosophy (PhD) thesis' embedded parenthetically.
    if re.search(r"doctorof|doctorin|doctorate|doctoral|philosophiae", tt_norm):
        return "phd"
    # Title-level phrase fallback for older records where the type field is
    # generic ('Other thesis') but the title spells out the doctorate.
    if re.search(r"\b(phd|d\.?phil|dissertation|doctor of|doctor in|doctorate|doctoral)\b", title_norm):
        return "phd"

    # ---- Bail-outs before Masters catchall ---------------------------------
    # 'MD' (Doctor of Medicine) is a physician credential in Fiji not a
    # research doctorate; treat 'MD thesis' / 'M.D. thesis' as unknown so it
    # never counts as PhD or Masters in Panel C1.
    if re.match(r"^md(thesis|$)", tt_norm):
        return "unknown"

    # ---- Masters family -----------------------------------------------------
    # LL.M. / LLM = Master of Laws (variants: llmthesis, llm)
    if re.match(r"^llm", tt_norm):
        return "masters"
    # Any thesisType starting with 'm' followed by another letter is treated
    # as a masters degree — covers the long tail of Fiji-region abbreviations
    # (MA, MSc, MEd, MPhil, MRes, MEng, MBA, MIA, MMIS, MSt, MLitt, MFA,
    # MHSc, MCom, MAgSc, MEnvSc, MSocSc, MAppSc, MPH, MPA, MArch, MDiv, MTh,
    # MUS, MLaw, MLing, MNurs, MEc, MEcon, MDevStudies, MBd, MBIT, MDistEd,
    # MPS, MLib, MTech, MLIS, MAADE, MSciMarineSci, MSocWk, MTeach, …).
    # 'MD' + 'MDthesis' were already excluded above.
    if re.match(r"^m[a-z]", tt_norm):
        return "masters"
    # Spelled-out variants inside thesisType.
    if re.search(r"masters?|masterof|masterin", tt_norm):
        return "masters"
    # Title-level fallback (English-language variants written out in the title).
    if re.search(r"\bmasters?\b|\bmaster's\b|\bmaster of\b|\bmaster in\b|\bllm\b|\bll\.m\.", title_norm):
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
