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

# Single-word keywords that are too generic to be meaningful research tags on
# their own. These are only excluded when they appear as ONE-WORD keywords;
# when they're part of a longer phrase they're still accepted. E.g. we reject
# "food" but accept "food security".
GENERIC_SINGLE = set(
    """
    study studies research work works project projects paper papers article articles
    thesis theses field fields level levels degree area areas topic topics theme themes
    subject subjects factor factors issue issues effect effects impact impacts influence
    response responses trend trends practice practices approach approaches perspective
    perspectives context contexts insight insights understanding understandings example
    examples case cases analysis review overview evaluation assessment exploration
    experience experiences result results outcome outcomes finding findings
    system systems process processes activity activities role roles model models
    method methods application applications aspect aspects need needs concern concerns
    challenge challenges opportunity opportunities significance implication implications
    development developments change changes shift shifts phase phases stage stages
    background introduction discussion conclusion conclusions summary summaries
    people person community communities population populations group groups
    setting settings site sites location locations region regions place places
    body bodies form forms type types kind kinds sort sorts way ways
    quality quantity size shape number amount time times year years age ages date dates
    life food water air soil part parts point points side sides end ends
    fiji fijian pacific islands island oceania oceanic melanesia melanesian polynesia
    novel new recent modern initial preliminary comprehensive brief detailed
    remarks chapter chapters section sections preface epilogue foreword afterword
    concluding introductory intermediate general special specific specialised
    attending emerging leading previous previously current currently traditional
    contemporary modern global local regional national international rural urban
    ghanaian american american european asian african pacific-based indian chinese
    japanese korean australian british british-based canadian scottish scottish-based
    english welsh irish german french german-based
    cyclic linear planar recent old
    role roles trend trends impact impacts effect effects
    author authors editor editors
    open closed public private
    isolated discovery isolation identification identifying identifies
    report reports working workshop workshops
    social cultural political economic biological chemical physical
    critical high low mid mean median average
    exploring examining reviewing surveying reporting
    """.split()
)
# NOTE: 'fiji' / 'pacific' / 'islands' are in the generic single-word list
# because every iTaukei scholar's work is by definition Pacific-related; the
# bare word doesn't tell the reader anything. When these words appear inside
# a longer phrase ("Pacific health", "Fijian communities") they're kept.
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


# Phrases we always want to reject regardless of how frequent they are.
# These are chapter/section headings and other title fragments that slip through
# frequency filtering (e.g. book series with repeated "concluding remarks").
BAD_PHRASE_FRAGMENTS = {
    "concluding remarks", "introductory remarks", "opening remarks",
    "book chapter", "chapter conclusion",
    "islands field", "field notes",
    "attending clinics", "attending physicians",
    "levu fiji", "suva fiji",
    "first-in class", "in press", "in progress",
    "case study", "case studies",
}

# Adverbs (mostly -ly) and other grammatical fragments that shouldn't stand
# alone as "keywords" — they are modifiers, not topics.
def _is_adverbial(word: str) -> bool:
    w = word.lower()
    if w.endswith("ly") and len(w) > 5:
        return True
    return False


def _stem(word: str) -> str:
    """Cheap stemmer used only for overlap-detection between candidate keywords.
    Strips common English plural / -ing / -ed endings so 'sponge' and 'sponges'
    are treated as the same stem when we de-duplicate the final keyword list.
    """
    w = word.lower()
    for suf in ("'s", "ies", "ing", "ies", "ees", "ses", "sses", "es", "ed", "s"):
        if len(w) > len(suf) + 2 and w.endswith(suf):
            return w[: -len(suf)]
    return w


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
    Rank candidate keyword phrases by a diversity-friendly score.

    Design goals:
    * Prefer 2-grams because "marine natural products" is a richer research tag
      than either "marine" or "products" alone.
    * Reject one-word candidates that are too generic to be meaningful research
      tags on their own (see GENERIC_SINGLE) and any one-word candidate that
      only appears in a single publication (weak signal).
    * Reject over-specific 3-grams that only echo a longer version of an
      already-strong 2-gram phrase ("sponge stylotella aurantium" adds no new
      research area beyond "marine sponge").
    """
    counter: Counter[str] = Counter()
    for t in items_titles:
        for g in title_ngrams(t, max_n=3):
            counter[g] += 1

    scored: dict[str, float] = {}
    for gram, cnt in counter.items():
        toks = gram.split()
        n = len(toks)

        # Frequency floor per length. Removes long tail of one-off phrases.
        if n == 1 and cnt < 2:
            continue
        if n == 2 and cnt < 2:
            continue
        if n == 3 and cnt < 2:
            continue

        if gram in BAD_PHRASE_FRAGMENTS:
            continue

        # Reject any 2- or 3-word phrase that starts OR ends with a bare
        # nationality/adverbial modifier ("Ghanaian sponges", "clinically").
        if any(w in GENERIC_SINGLE for w in (toks[0], toks[-1])) and n >= 2:
            # Allowed if the phrase is a well-known compound like
            # 'food security', 'body image', 'health policy' — we recognise
            # this by NEITHER end being a generic AND the whole phrase
            # containing at least one non-generic content word.
            content_words = [w for w in toks if w not in GENERIC_SINGLE]
            if not content_words:
                continue
            # If both ends are generic, drop.
            if toks[0] in GENERIC_SINGLE and toks[-1] in GENERIC_SINGLE:
                continue

        # Single-word candidates are only kept when they aren't in the generic
        # blacklist AND they show up in enough different publications to look
        # like a real theme rather than an accident.
        if n == 1:
            if toks[0] in GENERIC_SINGLE:
                continue
            if _is_adverbial(toks[0]):
                continue
            if cnt < 3:
                continue

        # Length boost weighted toward the sweet-spot 2-gram.
        boost = 1.0 if n == 1 else 1.9 if n == 2 else 1.6
        # Extra bump if the phrase contains a research-word (heuristic: any
        # word ending in a common science suffix like -ology, -ics, -tion,
        # -ism, -ity). This nudges terms like "conservation", "ecology",
        # "linguistics", "identity" over long organism-name compounds.
        if any(re.search(r"(ology|ophy|ics|tion|sion|ism|ity|ance|ence|ure)$", w) for w in toks):
            boost *= 1.15
        scored[gram] = cnt * boost

    ranked = sorted(scored.items(), key=lambda kv: (-kv[1], -len(kv[0].split()), kv[0]))

    # De-overlap A: drop a phrase when a strictly-longer phrase contains all
    # of its tokens ("sponge" ⊂ "marine sponge" ⊂ "fijian marine sponge").
    ordered: list[tuple[str, float]] = []
    accepted_tokens: list[set[str]] = []
    for gram, sc in ranked:
        toks = set(gram.split())
        if any(toks < acc for acc in accepted_tokens):  # strict subset
            continue
        ordered.append((gram, sc))
        accepted_tokens.append(toks)
    return ordered


def pick_keywords(titles: list[str], k: int = 8) -> list[str]:
    """Return a diverse ordered list of display-ready keywords.

    Diversity is enforced via a shared-stem penalty: once a phrase whose stem
    set S is picked, later candidates whose stems overlap with S by more than
    one word are skipped. This is what stops the list from becoming "marine",
    "marine sponge", "fijian marine sponge", "sponge biology" — four ways of
    saying one thing.
    """
    ranked = score_ngrams(titles)
    picked: list[str] = []
    picked_stems: list[set[str]] = []
    for gram, _sc in ranked:
        stems = {_stem(t) for t in gram.split()}
        # If any already-picked keyword shares ≥1 stem (≥2 for 3-word
        # phrases, where a single shared common word is fine), skip.
        overlap_threshold = 2 if len(stems) >= 3 else 1
        if any(len(stems & prev) >= overlap_threshold for prev in picked_stems):
            continue
        picked.append(titlecase_phrase(gram))
        picked_stems.append(stems)
        if len(picked) >= k:
            break

    # Top up from remaining ranked phrases if the diversity gate was too tight
    # and we don't yet have enough entries.
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
    Plain-English summary focused on what the scholar's research is about —
    not what publication types they have. Uses top keywords to describe
    focus and breadth, plus institution / department context when available.

    Kept deterministic and rule-based so this pipeline can run offline. It
    is intentionally a first-cut; a follow-up LLM step can rewrite these to
    add motivation and news-article context. See scholar-insights schema:
    entries may include a `summaryLinks` array once LLM enrichment lands.
    """
    salutation = (profile or {}).get("salutation") or ""
    first = (profile or {}).get("first") or ""
    last  = (profile or {}).get("last") or ""
    pronoun = "Their"
    display = f"{salutation} {first} {last}".strip() or "This scholar"

    def _lower(k):
        return k.lower() if k else ""

    top = [_lower(k) for k in keywords[:3]]
    breadth = [_lower(k) for k in keywords[3:7]]

    def _join_and(items: list[str]) -> str:
        items = [i for i in items if i]
        if not items:
            return ""
        if len(items) == 1:
            return items[0]
        if len(items) == 2:
            return f"{items[0]} and {items[1]}"
        return ", ".join(items[:-1]) + f", and {items[-1]}"

    # Sentence 1 — primary focus.
    if len(top) >= 2:
        s1 = f"{display}\u2019s research focuses on {_join_and(top)}."
    elif top:
        s1 = f"{display}\u2019s research focuses on {top[0]}."
    else:
        s1 = f"{display} is an iTaukei researcher indexed in this database."

    # Sentence 2 — breadth.
    s2 = ""
    if breadth:
        s2 = f"{pronoun} indexed work also engages with {_join_and(breadth)}."

    # Sentence 3 — institutional / regional grounding, if we have it.
    inst = (profile or {}).get("institution") or ""
    dept = (profile or {}).get("department") or ""
    prov = (profile or {}).get("paternalProvince") or ""
    grounding = ""
    if inst and dept:
        grounding = f"They are based at {inst}, in {dept}."
    elif inst:
        grounding = f"They are based at {inst}."
    if prov and grounding:
        grounding = grounding.rstrip(".") + f", with paternal roots in {prov} Province."

    sentences = [s for s in (s1, s2, grounding) if s]
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
