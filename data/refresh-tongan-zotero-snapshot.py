#!/usr/bin/env python3
"""
Sister clone of data/refresh-zotero-snapshot.py for the Tongan Scholar
Database. Refreshes /data/tongan-zotero-snapshot.json from the public
Zotero API. Uses the same Zotero group as the iTaukei system (Ron's single
research library covers both projects) but writes to Tongan-prefixed
output files only — never touches data/itaukei-*.

  python3 data/refresh-tongan-zotero-snapshot.py

After running, commit the updated JSON:
  git add data/tongan-zotero-snapshot.json && git commit -m "Refresh Tongan Zotero snapshot" && git push
"""
import json, os, re, sys, time, urllib.request, urllib.error
from datetime import datetime, timezone
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
from drift_validator import reconcile_drift  # noqa: E402

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
    """Extract a 4-digit publication year from a Zotero date string.

    Zotero stores dates in whatever shape the item entry uses — the same
    library holds bare years ('2019'), month-only ISO ('2019-03'), full ISO
    ('2019-03-15'), month names ('March 15, 2019'), season+year ('Winter
    2019'), and free-text ('c. 2019'). We accept any of these, otherwise
    ~200 items (8% of the database) silently drop out of Panel D.
    """
    if not dt: return None
    import re
    # Look for the first 4-digit run anywhere in the string. Handles
    # ISO ('2019-03', '2019-03-15'), month-first, day-first, and anything
    # else the token-split path used to miss.
    m = re.search(r'\b(\d{4})\b', str(dt))
    if m:
        y = int(m.group(1))
        if 1900 <= y <= 2035:
            return y
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

# ---------------------------------------------------------------------------
# Cross-check: reconcile items[].collections[] with each collection's
# authoritative numItems (from /collections). This defends against the
# transient Zotero API bug where the paged /items/top endpoint returns
# items with an incomplete collections[] field even though the per-item
# /items/{key} endpoint returns the correct list.
#
# Only top-level items (theses, books, articles, reports, chapters) count
# toward the client-side panel totals; child notes/attachments live under
# the same collections but were already filtered out above. We compare
# against a top-level-only variant of numItems that we recompute from the
# /collections/{key}/itemKeys endpoint, filtered to keys we kept.
# ---------------------------------------------------------------------------
def _get_with_backoff(url: str, attempts: int = 4) -> bytes | None:
    """GET url with exponential backoff on 429/5xx. Returns raw body or None.

    Honors Retry-After when the server sends it. Sleeps 1s, 2s, 4s, 8s
    between attempts otherwise. Any other HTTPError is raised so the
    caller can decide.
    """
    req = urllib.request.Request(url, headers={"Zotero-API-Version": "3"})
    for attempt in range(attempts):
        try:
            with urllib.request.urlopen(req) as r:
                return r.read()
        except urllib.error.HTTPError as e:
            if e.code == 429 or (500 <= e.code < 600):
                retry_after = e.headers.get("Retry-After") if hasattr(e, "headers") else None
                delay = int(retry_after) if (retry_after and retry_after.isdigit()) else (1 << attempt)
                if attempt < attempts - 1:
                    time.sleep(delay)
                    continue
            raise
    return None


def fetch_collection_item_keys(col_key: str) -> list[str]:
    """Return the list of item keys directly in a collection.

    Uses /collections/{key}/items?format=keys, which returns one
    newline-delimited key per line. Cheap: no JSON parsing, no item
    bodies, no pagination for collections under ~5k items.
    """
    u = f"https://api.zotero.org/groups/{GROUP_ID}/collections/{col_key}/items?format=keys"
    body = _get_with_backoff(u) or b""
    text = body.decode("utf-8", errors="replace")
    return [line.strip() for line in text.splitlines() if line.strip()]


def fetch_item(item_key: str) -> dict | None:
    """Fetch a single item's data payload, or None if the API errors."""
    u = f"https://api.zotero.org/groups/{GROUP_ID}/items/{item_key}?format=json"
    try:
        body = _get_with_backoff(u)
        return json.loads(body) if body else None
    except Exception as e:
        print(f"  ! fetch_item({item_key}) failed: {e}")
        return None


# Cap the repair budget so a genuinely broken API can't hang the refresh.
MAX_COLLECTIONS_TO_CHECK = 400   # we currently have ~355 collections
MAX_ITEMS_TO_REPAIR      = 500   # safety net; typical drift is <30
API_DELAY_SECONDS        = 0.20  # unauthenticated tier throttles hard

print("Validating collection membership against authoritative /collections "
      "key lists\u2026")
stats = reconcile_drift(
    items, collections,
    key_fetcher=fetch_collection_item_keys,
    item_fetcher=fetch_item,
    api_delay=API_DELAY_SECONDS,
    max_collections=MAX_COLLECTIONS_TO_CHECK,
    max_items=MAX_ITEMS_TO_REPAIR,
)

if stats["skipped_collections"]:
    print(f"Note: {stats['skipped_collections']} collection(s) skipped due to API errors; "
          "drift within those is not detected on this run.")
if stats["repaired_items"]:
    print(f"Repaired {stats['repaired_items']} item collection-list(s) across "
          f"{stats['repaired_collections']} collection(s).")
    print("Drift summary:")
    for col_key, name, recon, auth in stats["drift_report"]:
        print(f"  {col_key}  {name!r:40}  reconstructed {recon:>4} → authoritative {auth:>4}")
elif not stats["skipped_collections"]:
    print("No drift detected — all collection memberships consistent.")
else:
    print("No drift detected in checked collections.")

snapshot = {
    "generatedAt": datetime.now(timezone.utc).isoformat(),
    "source": {
        "group": f"https://www.zotero.org/groups/{GROUP_ID}/itaukei_academic_research/library",  # same Zotero group as iTaukei; Tonga-specific filtering happens downstream
        "api": f"https://api.zotero.org/groups/{GROUP_ID}",
        "groupId": GROUP_ID,
    },
    "totals": {"items": len(items), "collections": len(collections)},
    "items": items,
    "collections": collections,
}

here = os.path.dirname(os.path.abspath(__file__))
out = os.path.join(here, "tongan-zotero-snapshot.json")
with open(out, "w") as f:
    json.dump(snapshot, f, ensure_ascii=False, separators=(",", ":"))
sz = os.path.getsize(out)/1024
print(f"Snapshot refreshed: {len(items)} items · {len(collections)} collections · {sz:.1f} KB")

# Re-encrypt ONLY the snapshot file we just wrote. Each .enc file uses its
# own per-file random salt (see scripts/encrypt_data.py) so there is no
# shared-salt invariant to preserve \u2014 touching this one file is enough
# and cannot corrupt any of the other .enc blobs on disk.
import subprocess, sys
root = os.path.dirname(here)
enc = os.path.join(root, "scripts", "tongan_encrypt_data.py")
if os.environ.get("VAVELAB_TONGAN_PASSCODE"):
    print("Re-encrypting tongan-zotero-snapshot.json\u2026")
    subprocess.run([sys.executable, enc, "tongan-zotero-snapshot.json"], check=True)
else:
    print("NOTE: VAVELAB_TONGAN_PASSCODE not set \u2014 skipped re-encryption. Run "
          "`VAVELAB_TONGAN_PASSCODE=\u2026 python3 scripts/tongan_encrypt_data.py tongan-zotero-snapshot.json` "
          "before committing.")
