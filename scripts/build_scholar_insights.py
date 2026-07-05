#!/usr/bin/env python3
"""
Build data/scholar-insights.json — a per-scholar cache of "AI-generated"
research keywords and a plain-English summary, derived from the titles of
their indexed publications.

Design goals
------------
* **Cheap and offline.** No LLM API calls. Uses rule-based n-gram frequency
  analysis over publication titles, with stopwords tuned for academic
  writing. This gives sensible keyword pills for every scholar today; the
  script can later be swapped for an LLM step without changing the schema.
* **Idempotent.** The output file is keyed by scholar name + an item-set
  signature. A scholar's entry is only regenerated when their signature
  changes (i.e. their publication list gained or lost items). Callers can
  therefore rerun this script on every Zotero refresh without cost.
* **Portable.** Pure standard-library Python. Runs in the same environment
  as refresh-zotero-snapshot.

Input
-----
* data/itaukei-zotero-snapshot.json
* data/scholar-profiles.json

Output
------
* data/scholar-insights.json  (dict keyed by "Last, First")
    {
      "generatedAt": "...",
      "insights": {
        "Tabudravu, Jioji N.": {
          "keywords": ["Marine natural products", "Antimicrobial ...", ...],
          "summary": "Dr Tabudravu researches ...",
          "publicationCount": 63,
          "signature": "sha1:...",
          "regeneratedAt": "..."
        },
        ...
      }
    }
"""
from __future__ import annotations
import hashlib
import json
import re
import sys
from collections import Counter
from datetime import datetime, timezone
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
DATA = ROOT / "data"

SNAPSHOT_PATH  = DATA / "itaukei-zotero-snapshot.json"
PROFILES_PATH  = DATA / "scholar-profiles.json"
OUTPUT_PATH    = DATA / "scholar-insights.json"


# ---------------- stopwords + phrase filters ----------------

STOP = set(
    """
    a about above across after against all also am among an and another any anywhere are as at
    based be became because been before behind being below beneath between both but by can case
    could data day did do does doing done down due during each either else end enough etc
    even every everyone example few first following for four from further get given
    goes going got had has have having he her here hers herself him himself his how
    however i if impact impacts implications important in including indeed influence into is
    it its itself just kind less like likely literature little long look made make many may
    me might more most mostly much must my myself need never new next no non none nor not
    nothing now number of off often on once one only or other our ours out over overview own
    part particular per perhaps place plus possible potential provide provided quite rather
    really recent regarding require required response same say see seem seems seen several
    she shift should since small so some something sometimes soon still such take taken than
    that the their theirs them themselves then there therefore these they thing things this
    those though three through throughout thus time to together too toward towards two under
    until up upon us use used using various very via was way we well were what whatever
    when whenever where whereas whether which while who whom whose why will with within
    without would year yes yet you your yours
    against amid amidst amongst around beside besides beyond concerning despite except
    following inside outside past regarding since throughout underneath unlike until
    without whilst
    reviewing case comparison analysis assessment evaluation exploration exploring evidence
    examining insights role effect effects perspective perspectives approach approaches
    context contexts framework frameworks understanding understandings integration
    integrating implications implication toward towards from-a beyond across-a into
    ni na kei ki e i lako sa mai kei-na ni-na e-na
    """.split()
)
# Fijian and academic particles/function words that show up mid-phrase and
# make it look like a keyword pill contains no real content.
MID_BAD = {
    "the", "a", "an", "of", "in", "on", "to", "for", "and", "or", "by", "with",
    "from", "is", "are", "as", "at", "be", "been", "was", "were",
    "na", "ni", "kei", "ki", "e", "i", "me", "se", "ka", "o", "ko",
}

# Domain phrases the extractor should treat as noise / meta rather than
# actual research topics. All lowercased.
BAD_PHRASES = {
    "a case study", "case study", "case studies",
    "systematic review", "literature review", "narrative review", "scoping review",
    "chapter", "book chapter", "editorial",
    "commentary", "introduction",
    "in press", "et al", "abstract", "supplementary material",
    "authors reply", "response to",
}

# Words we always keep even if they'd otherwise look like a stopword.
KEEP_ALWAYS = set()


def clean_title(t: str) -> str:
    """Strip subtitle noise, TeX markup, and normalise unicode."""
    if not t:
        return ""
    t = t.replace("\u2019", "'").replace("\u2013", "-").replace("\u2014", "-")
    # Drop trailing venue/issue in brackets or "in Journal Name" tails.
    t = re.sub(r"\s*\[[^]]{1,80}]$", "", t).strip()
    # Drop trailing "in *Journal Name*" if present.
    t = re.sub(r"\s+in\s+[A-Z][^:]{4,80}$", "", t)
    return t.strip()


def _valid_word(w: str) -> bool:
    if w in STOP:
        return False
    if len(w) < 3:
        return False
    if not any(ch.isalpha() for ch in w):
        return False
    return True


def title_ngrams(title: str, max_n: int = 3) -> list[str]:
    """Return a list of lowercased n-grams (1..max_n) from a title."""
    title = clean_title(title)
    if not title:
        return []
    toks = re.findall(r"[A-Za-z][A-Za-z0-9'\-]{1,}", title)
    toks = [t.lower() for t in toks]
    grams: list[str] = []
    for n in range(1, max_n + 1):
        for i in range(len(toks) - n + 1):
            window = toks[i : i + n]
            gram = " ".join(window)
            if gram in BAD_PHRASES:
                continue
            # Reject when the FIRST or LAST word is a stopword or too short.
            if not _valid_word(window[0]) or not _valid_word(window[-1]):
                continue
            # For 3-grams, also reject when the middle word is a joiner that
            # would make the phrase read as fragmentary ("impact of the",
            # "ni bula ni", "study on the"). Prepositions or articles in the
            # middle position are fine ("quality of life", "school of pharmacy"),
            # but function words in ALL positions of a 3-gram are noise.
            if n == 3 and window[1] in MID_BAD and (window[0] in MID_BAD or window[2] in MID_BAD):
                continue
            # For 2-grams, both words being tiny/joiner-like = noise.
            if n == 2 and window[0] in MID_BAD and window[1] in MID_BAD:
                continue
            grams.append(gram)
    return grams


def titlecase_phrase(p: str) -> str:
    """Nicer display casing for keyword pills."""
    # Titlecase, but keep small connectors lowercase.
    small = {"and", "of", "for", "in", "the", "to", "on", "or", "with"}
    out = []
    for i, w in enumerate(p.split()):
        if i > 0 and w in small:
            out.append(w)
        else:
            out.append(w[:1].upper() + w[1:])
    return " ".join(out)


def score_ngrams(items_titles: list[str]) -> list[tuple[str, float]]:
    """
    Return a list of (phrase, score) sorted by score desc, where longer
    phrases are boosted so specific topics rank above their constituent
    words. Phrases whose words are fully contained in a higher-scoring
    longer phrase are demoted.
    """
    counter: Counter[str] = Counter()
    for t in items_titles:
        for g in title_ngrams(t, max_n=3):
            counter[g] += 1

    # Length boost: 2-grams and 3-grams outrank single words with the same freq.
    scored: dict[str, float] = {}
    for gram, cnt in counter.items():
        n = len(gram.split())
        boost = 1.0 if n == 1 else 1.6 if n == 2 else 2.0
        scored[gram] = cnt * boost

    # Sort by score desc, then by phrase-length desc, then alpha for stability.
    ranked = sorted(
        scored.items(),
        key=lambda kv: (-kv[1], -len(kv[0].split()), kv[0]),
    )

    # De-overlap: once we accept a phrase, drop its sub-phrases that appear
    # fewer times than the parent (they're likely redundant).
    accepted: list[tuple[str, float]] = []
    dropped: set[str] = set()
    for gram, sc in ranked:
        if gram in dropped:
            continue
        tokens = gram.split()
        if len(tokens) >= 2:
            for size in range(len(tokens) - 1, 0, -1):
                for i in range(len(tokens) - size + 1):
                    sub = " ".join(tokens[i : i + size])
                    if sub in scored and scored[sub] <= sc * 1.1:
                        dropped.add(sub)
        accepted.append((gram, sc))
    return accepted


def pick_keywords(titles: list[str], k: int = 10) -> list[str]:
    """Return a diverse ordered list of at least `k` display-ready keywords."""
    ranked = score_ngrams(titles)
    picked: list[str] = []
    seen_first_word: Counter[str] = Counter()
    # Pass 1: prefer diversity by first word so we don't get 8 variations of one theme.
    for gram, _ in ranked:
        if len(picked) >= k:
            break
        fw = gram.split()[0]
        if seen_first_word[fw] >= 2 and len(picked) < k - 2:
            continue
        picked.append(titlecase_phrase(gram))
        seen_first_word[fw] += 1
    # If diversity gate was too tight, top up from remaining.
    if len(picked) < k:
        for gram, _ in ranked:
            disp = titlecase_phrase(gram)
            if disp in picked:
                continue
            picked.append(disp)
            if len(picked) >= k:
                break
    return picked[:k]


def build_summary(profile: dict, keywords: list[str], pub_count: int,
                  types: dict) -> str:
    """
    Two-to-four sentence plain-English summary. Uses top keywords + counts
    + optional profile fields. Deterministic, no LLM.
    """
    salutation = (profile or {}).get("salutation") or ""
    first = (profile or {}).get("first") or ""
    last  = (profile or {}).get("last") or ""
    display = f"{salutation} {first} {last}".strip() or "This scholar"

    # Determine primary focus using the top-2 keywords.
    top_two = keywords[:2] if len(keywords) >= 2 else keywords[:1]
    top_two = [k.lower() for k in top_two]
    focus = " and ".join(top_two) if top_two else "their field"

    # Determine breadth using keywords 3-6.
    breadth = keywords[2:6]
    breadth = [k.lower() for k in breadth]
    breadth_text = ""
    if len(breadth) >= 2:
        breadth_text = (
            f" Their work also touches on {', '.join(breadth[:-1])}, and {breadth[-1]}."
        )
    elif breadth:
        breadth_text = f" Their work also touches on {breadth[0]}."

    # Publication mix.
    parts = []
    if types.get("journalArticle"):
        parts.append(f"{types['journalArticle']} journal article"
                     + ("s" if types['journalArticle'] != 1 else ""))
    if types.get("bookSection"):
        parts.append(f"{types['bookSection']} book chapter"
                     + ("s" if types['bookSection'] != 1 else ""))
    if types.get("book"):
        parts.append(f"{types['book']} book" + ("s" if types['book'] != 1 else ""))
    if types.get("report"):
        parts.append(f"{types['report']} report" + ("s" if types['report'] != 1 else ""))
    theses = (types.get("thesisPhd") or 0) + (types.get("thesisMasters") or 0) + (types.get("thesisUnknown") or 0)
    if theses:
        parts.append(f"{theses} thesis" if theses == 1 else f"{theses} theses")
    mix = ", ".join(parts[:-1]) + (", and " + parts[-1] if len(parts) > 1 else parts[-1]) if parts else ""

    # Compose.
    s1 = f"{display} researches {focus}."
    if pub_count > 0:
        if mix:
            s2 = f"Their {pub_count} indexed publication{'s' if pub_count != 1 else ''} include{'s' if pub_count == 1 else ''} {mix}."
        else:
            s2 = f"They have {pub_count} indexed publication{'s' if pub_count != 1 else ''} in this database."
    else:
        s2 = "No indexed publications yet."
    s3 = breadth_text.strip()

    sentences = [s1, s2]
    if s3:
        sentences.append(s3)
    return " ".join(sentences)


# ---------------- name-matching (mirrors JS deriveScholarRows Source B) --------------

def strip_dots(s: str) -> str:
    return (s or "").replace(".", "")


def first_token(s: str) -> str:
    return (s or "").strip().split()[0] if (s or "").strip() else ""


def parse_creator(name: str) -> tuple[str, str] | None:
    """Return (last_lower, first_token_lower_stripped) for a creator string."""
    if not name or not isinstance(name, str):
        return None
    s = name.strip()
    if not s:
        return None
    if "," in s:
        ln, fn = s.split(",", 1)
        last = ln.strip().lower()
        first = strip_dots(first_token(fn)).lower()
    else:
        toks = s.split()
        last = toks[-1].lower()
        first = strip_dots(toks[0]).lower() if toks else ""
    if not last or not first:
        return None
    return last, first


def collect_scholar_items(scholar_key: str, profile: dict, snapshot: dict) -> list[dict]:
    """
    Return the items list for a scholar. Prefer the Zotero sub-collection
    named `scholar_key`. Fall back to author-name-matching against every
    creator on every item if no sub-collection exists.
    """
    cols = snapshot.get("collections", []) or []
    items = snapshot.get("items", []) or []

    # 1) Try sub-collection.
    root = next((c for c in cols if c.get("name") == "iTaukei authors (>3 papers)"), None)
    if root:
        subs = [c for c in cols if c.get("parent") == root.get("key")]
        # Match by canonical name OR by stripped variant.
        stripped_target = f"{profile.get('last','')}, {first_token(profile.get('first',''))}"
        for c in subs:
            if c.get("name") == scholar_key or c.get("name") == stripped_target:
                key = c.get("key")
                return [it for it in items if key in (it.get("collections") or [])]

    # 2) Fall back to author-name matching.
    last_low = (profile.get("last") or "").lower()
    first_tok = strip_dots(first_token(profile.get("first") or "")).lower()
    if not last_low or not first_tok:
        return []
    matched = []
    for it in items:
        for raw in (it.get("creators") or []):
            parsed = parse_creator(raw)
            if not parsed:
                continue
            l, f = parsed
            if l == last_low and f == first_tok:
                matched.append(it)
                break
    return matched


def types_of_item(it: dict) -> str:
    t = it.get("itemType")
    if t == "thesis":
        lvl = (it.get("thesisLevel") or "").lower()
        if lvl == "phd":
            return "thesisPhd"
        if lvl == "masters":
            return "thesisMasters"
        return "thesisUnknown"
    return t or "journalArticle"


def item_signature(items: list[dict]) -> str:
    keys = sorted((it.get("key") or "") for it in items)
    return "sha1:" + hashlib.sha1(("|".join(keys)).encode("utf-8")).hexdigest()[:16]


def main() -> int:
    if not SNAPSHOT_PATH.exists():
        print(f"error: {SNAPSHOT_PATH} missing", file=sys.stderr)
        return 1
    with SNAPSHOT_PATH.open() as f:
        snapshot = json.load(f)
    profiles_doc = {}
    if PROFILES_PATH.exists():
        with PROFILES_PATH.open() as f:
            profiles_doc = json.load(f)
    profiles = profiles_doc.get("scholars", []) or []

    # Build the merged scholar list. Mirrors the JS deriveScholarRows logic.
    seen_keys: set[str] = set()
    scholars: list[tuple[str, dict]] = []

    # Source A: sub-collections
    cols = snapshot.get("collections", []) or []
    root = next((c for c in cols if c.get("name") == "iTaukei authors (>3 papers)"), None)
    if root:
        for c in cols:
            if c.get("parent") != root.get("key"):
                continue
            name = c.get("name") or ""
            if not name:
                continue
            last, _, first = name.partition(",")
            prof = next(
                (p for p in profiles
                 if (p.get("last", "").lower() == last.strip().lower()
                     and first_token(p.get("first", "")).lower()
                        == first_token(first.strip()).lower())),
                {},
            )
            scholars.append((name, prof))
            seen_keys.add(name.lower())
            if prof.get("last") and prof.get("first"):
                seen_keys.add(f"{prof['last']}, {first_token(prof['first'])}".lower())

    # Source B: profiles without a matching sub-collection
    for p in profiles:
        if not p.get("last") or not p.get("first"):
            continue
        canonical = f"{p['last']}, {p['first']}"
        stripped  = f"{p['last']}, {first_token(p['first'])}"
        if canonical.lower() in seen_keys or stripped.lower() in seen_keys:
            continue
        scholars.append((canonical, p))
        seen_keys.add(canonical.lower())
        seen_keys.add(stripped.lower())

    # Load existing output so we can preserve entries whose signature is unchanged.
    existing = {}
    if OUTPUT_PATH.exists():
        try:
            existing = (json.loads(OUTPUT_PATH.read_text()).get("insights") or {})
        except Exception:
            existing = {}

    out = {}
    now = datetime.now(timezone.utc).isoformat(timespec="seconds")
    for name, prof in scholars:
        items = collect_scholar_items(name, prof, snapshot)
        sig = item_signature(items)
        prev = existing.get(name)
        if prev and prev.get("signature") == sig:
            # Nothing to regenerate.
            out[name] = prev
            continue

        titles = [it.get("title") or "" for it in items]
        keywords = pick_keywords(titles, k=10)
        types = Counter()
        for it in items:
            types[types_of_item(it)] += 1
        summary = build_summary(prof, keywords, len(items), types)

        out[name] = {
            "keywords": keywords,
            "summary": summary,
            "publicationCount": len(items),
            "signature": sig,
            "regeneratedAt": now,
        }

    OUTPUT_PATH.write_text(
        json.dumps(
            {"generatedAt": now, "insights": out},
            indent=2, ensure_ascii=False,
        )
    )
    print(f"wrote {len(out)} scholar insights → {OUTPUT_PATH.relative_to(ROOT)}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
