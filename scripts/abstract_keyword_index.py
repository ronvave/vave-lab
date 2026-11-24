#!/usr/bin/env python3
"""Abstract-derived keyword index for Panel F research-keyword search.

Publication abstracts stay private (copyright-sensitive; see
PUBLICATION_PRIVATE_FIELDS in master_file_config.py). This module turns a
scholar's abstracts into a search-only term list that is safe to publish:

  * lowercased words, punctuation removed, digits and 1-letter tokens dropped
  * common English function words and publisher boilerplate removed
  * adjacent remaining words paired into two-word terms ("climate adaptation")
  * every scholar's terms pooled across all of their eligible abstracts,
    de-duplicated and sorted alphabetically

The output contains no sentences, word order beyond two-word pairs, or
per-publication grouping, so the original abstracts cannot be read back
from it. It only answers "does this text appear in this scholar's
abstracts?".

Eligibility mirrors the dashboard: only the six counted publication types
(journal articles, books, book chapters, Master's theses, PhD theses,
reports; Ron 2026-10-03) and only Scholar IDs linked through the filtered
Authorship bridge (Part-iTaukei IDs already removed by the caller).

Output (data/itaukei-master-abstract-index.json, encrypted like every
other Master snapshot):

  {
    "version": 1,
    "generatedAt": "...Z",
    "method": "content-word bigrams, pooled per scholar, sorted",
    "publicationsWithAbstracts": 812,
    "scholarsIndexed": 120,
    "scholars": { "ITK-S0001": "climate adaptation \u2022 coastal communities \u2022 ...", ... }
  }
"""
from __future__ import annotations

import re
import unicodedata
from datetime import datetime, timezone
from typing import Any, Iterable

SEP = " \u2022 "  # same separator the dashboard uses between keyword fields

ELIGIBLE_TYPES = {
    "journal article",
    "book",
    "book section",
    "book chapter",
    "thesis (phd)",
    "phd thesis",
    "thesis (masters)",
    "masters thesis",
    "master's thesis",
    "report",
}

STOPWORDS = set(
    """
a about above across after afterwards again against all almost alone along already also although always am among amongst
an and another any anyhow anyone anything anyway anywhere are around as at be became because become becomes becoming been
before beforehand behind being below beside besides between beyond both but by can cannot could did do does doing done down
due during each either else elsewhere enough etc even ever every everyone everything everywhere except few for former formerly
from further had has have having he hence her here hereafter hereby herein hereupon hers herself him himself his how however i
ie if in indeed into is it its itself just last latter latterly least less many may me meanwhile might mine more moreover most
mostly much must my myself namely neither never nevertheless next no nobody none noone nor not nothing now nowhere of off often
on once one only onto or other others otherwise our ours ourselves out over own per perhaps please rather re same seem seemed
seeming seems several she should since so some somehow someone something sometime sometimes somewhere still such than that the
their theirs them themselves then thence there thereafter thereby therefore therein thereupon these they this those though
through throughout thru thus to together too toward towards under until up upon us very via was we well were what whatever when
whence whenever where whereafter whereas whereby wherein whereupon wherever whether which while whither who whoever whole whom
whose why will with within without would yet you your yours yourself yourselves eg viz
copyright rights reserved elsevier springer taylor francis wiley ltd inc published publisher abstract
""".split()
)

_APOS = re.compile(r"[\u2018\u2019\u02bc`']")
_NON_WORD = re.compile(r"[^\w]+", re.UNICODE)


def _norm_type(raw: Any) -> str:
    t = _APOS.sub("'", str(raw or "")).strip().lower()
    return re.sub(r"\s+", " ", t)


def tokenize(text: str) -> list[str]:
    """Lowercase content words in reading order (stopwords removed)."""
    t = unicodedata.normalize("NFKC", str(text or ""))
    t = re.sub(r"<[^>]*>", " ", t)  # stray HTML/JATS tags
    t = _APOS.sub("", t).lower()
    out = []
    for w in _NON_WORD.split(t):
        w = w.strip("_")
        if not w:
            continue
        if len(w) < 2 or w.isdigit() or w in STOPWORDS:
            out.append(None)  # phrase break: do not pair across a stopword gap
            continue
        out.append(w)
    return out


def terms_for(text: str) -> set[str]:
    """Two-word content phrases; single words that never pair are kept alone."""
    toks = tokenize(text)
    terms: set[str] = set()
    paired: set[int] = set()
    for i in range(len(toks) - 1):
        a, b = toks[i], toks[i + 1]
        if a and b:
            terms.add(f"{a} {b}")
            paired.update((i, i + 1))
    for i, w in enumerate(toks):
        if w and i not in paired:
            terms.add(w)
    return terms


def build(
    publication_dicts: Iterable[dict],
    authorship: Iterable[dict],
    scholar_ids: Iterable[str],
) -> dict:
    """publication_dicts: raw (unsanitized) Publications rows as dicts."""
    allowed = {str(s).strip() for s in scholar_ids if str(s).strip()}
    abstract_by_pid: dict[str, str] = {}
    for p in publication_dicts:
        pid = str(p.get("Publication ID / BibTeX Key") or "").strip()
        abstract = str(p.get("Abstract") or "").strip()
        if not pid or len(abstract) < 40:
            continue
        if _norm_type(p.get("Publication Type")) not in ELIGIBLE_TYPES:
            continue
        if str(p.get("Dedup Status") or "").strip().lower() == "duplicate":
            continue
        abstract_by_pid[pid] = abstract

    by_scholar: dict[str, set[str]] = {}
    used_pids: set[str] = set()
    for a in authorship:
        sid = str(a.get("Scholar ID") or "").strip()
        pid = str(a.get("Publication ID / BibTeX Key") or "").strip()
        if sid not in allowed or pid not in abstract_by_pid:
            continue
        by_scholar.setdefault(sid, set()).update(terms_for(abstract_by_pid[pid]))
        used_pids.add(pid)

    scholars = {sid: SEP.join(sorted(t)) for sid, t in sorted(by_scholar.items()) if t}
    return {
        "version": 1,
        "generatedAt": datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ"),
        "method": "content-word bigrams from eligible-publication abstracts, pooled per scholar, sorted",
        "publicationsWithAbstracts": len(used_pids),
        "scholarsIndexed": len(scholars),
        "scholars": scholars,
    }
