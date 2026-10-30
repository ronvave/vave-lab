"""Scholar news snapshot for a country dashboard (Panel A4).

Reads the country's News sheet (header row 4, data from row 5) and keeps
stories that are ticked "Show on Dashboard" and belong to a scholar on the
dashboard roster. Only allow-listed fields leave the Master file; Notes,
Added By and Added On stay private.

Stories are added by hand after review. Nothing here searches for news.

The "New publications" and "New theses" toggles are also filled from the
Master's own Publications and Authorship sheets (the Panel G records): recent
works with at least one database scholar as an author. These are marked
"auto" and stay off the scholar-card "In the news" tab, which already lists
publications.
No timestamp is embedded, so an unchanged News tab yields identical bytes
and scripts/plaintext_changed.py skips the re-encrypt.
"""
from __future__ import annotations

import html
import re
from datetime import datetime

CATEGORIES = ["Award", "Appointment", "Graduation", "Milestone", "Publication", "Research", "News"]  # News = general news
# Panel A4 toggle groups. Rows without an Announcement Type are News.
TYPES = ["News", "Defense", "Thesis", "Publication", "Event"]
# Older label kept readable: webinars are now listed under Events.
TYPE_ALIASES = {"Webinar": "Event", "New Thesis": "Thesis", "New Publication": "Publication"}
# New theses and publications may be about Tonga by an author outside the
# database; those rows need a Scholar Display Name instead of a Scholar ID.
OPEN_TYPES = ("Thesis", "Publication")
TIMED_TYPES = ("Defense", "Event")


def _s(v) -> str:
    return re.sub(r"\s+", " ", html.unescape(str(v or ""))).strip()


def _yes(v) -> bool:
    return _s(v).lower() in {"yes", "y", "true", "1", "x"}


def _iso(v) -> str:
    """Accept 2026-10-29, 29/10/2026, 10/29/2026 or 29 Oct 2026; return ISO or ''."""
    s = _s(v)
    for fmt in ("%Y-%m-%d", "%d/%m/%Y", "%m/%d/%Y", "%d %b %Y", "%d %B %Y", "%B %d, %Y", "%b %d, %Y"):
        try:
            return datetime.strptime(s, fmt).strftime("%Y-%m-%d")
        except ValueError:
            pass
    return ""


def _url(v) -> str:
    s = _s(v)
    return s if s.startswith(("https://", "http://")) else ""


THESIS_TYPES = {"PhD Thesis", "Master's Thesis", "Other Thesis"}
# Kinds of record that are not new published works for this panel.
NOT_PUBLISHED = {"Unpublished", "Patent", "Other", "Presentation", "Conference Presentation", "Dataset", "Software"}
AUTO_IN_ALL = {"Publication": 5, "Thesis": 3}   # newest few also join the "All" view


def _year(v):
    m = re.match(r"\s*(\d{4})", str(v or ""))
    return int(m.group(1)) if m else None


def _bib_name(v) -> str:
    """'Fotu, Belinda' -> 'Belinda Fotu'; other forms are kept as written."""
    s = _s(v)
    if s.count(",") == 1:
        last, first = [x.strip() for x in s.split(",")]
        if last and first:
            return first + " " + last
    return s


def auto_items(publications, authorship, roster, today=None, only_types=None) -> list[dict]:
    """Recent Panel G works with a database scholar among the authors.

    "Recent" is this year or later; from January to March the previous year is
    included too so the toggle is not empty early in the year. Newest years
    come first; within a year, records added to the Master later come first.
    """
    today = today or datetime.now()
    since = today.year - (1 if today.month <= 3 else 0)
    authors: dict[str, list[tuple[int, str]]] = {}
    for a in authorship or []:
        key, sid = _s(a.get("Publication ID / BibTeX Key")), _s(a.get("Scholar ID")).upper()
        if key and sid in roster:
            pos = a.get("Author Position")
            try:
                pos = int(pos)
            except (TypeError, ValueError):
                pos = 99
            authors.setdefault(key, []).append((pos, sid))
    out, seen_titles = [], set()
    for order, p in enumerate(publications or []):
        key = _s(p.get("Publication ID / BibTeX Key"))
        year, ptype, title = _year(p.get("Year")), _s(p.get("Publication Type")), _s(p.get("Title"))
        if not key or not title or year is None or year < since or ptype in NOT_PUBLISHED:
            continue
        if only_types is not None and ptype not in only_types:  # e.g. Fiji shows Panel G's six types only
            continue
        sids = []
        for _, sid in sorted(authors.get(key, [])):
            if sid not in sids:
                sids.append(sid)
        is_thesis = ptype in THESIS_TYPES
        # Publications need a database scholar as author. Every recent thesis
        # in the Publications records is listed (by Tongan scholars or about
        # Tonga); unlinked ones show the author as recorded.
        lead = _bib_name(p.get("Bibliographic Lead Author"))
        if not sids and not (is_thesis and lead):
            continue
        tkey = re.sub(r"[^a-z0-9]", "", title.lower())[:80]
        if tkey in seen_titles:
            continue
        seen_titles.add(tkey)
        doi = _s(p.get("DOI"))
        url = ("https://doi.org/" + re.sub(r"^https?://(dx\.)?doi\.org/", "", doi)) if doi else _url(p.get("URL"))
        if not url:
            continue
        kind = "Thesis" if is_thesis else "Publication"
        names = [roster[x] for x in sids] or [lead]
        shown = names[0] if len(names) == 1 else (" and ".join(names) if len(names) == 2 else names[0] + ", " + names[1] + " and others")
        venue = _s(p.get("Publisher / Institution / School")) if kind == "Thesis" else _s(p.get("Journal / Book Title"))
        out.append({
            "id": "PUB-" + key, "sid": sids[0] if sids else "", "name": shown, "full": names[0],
            "type": kind, "cat": kind, "sub": ptype, "when": "", "where": "",
            "head": title, "outlet": venue, "date": f"{year}-12-31", "dlabel": str(year),
            "url": url, "img": "", "credit": "", "sum": "", "also": "", "auto": True,
            "_order": order,
        })
    # Newest year first; works by database scholars before unlinked theses.
    out.sort(key=lambda x: (x["date"], bool(x["sid"]), x["_order"]), reverse=True)
    for x in out:
        x.pop("_order")
    return out


def build(rows: list[dict], scholars: list[dict], *, source: str, generator: str,
          publications: list[dict] | None = None, authorship: list[dict] | None = None, today=None,
          only_types=None) -> dict:
    roster = {
        _s(s.get("Scholar ID")).upper(): _s(s.get("Scholar Name") or s.get("Display Name"))
        for s in scholars
        if _s(s.get("Scholar ID"))
    }
    items, skipped = [], []
    for r in rows:
        nid = _s(r.get("News ID"))
        sid = _s(r.get("Scholar ID")).upper()
        if not _yes(r.get("Show on Dashboard")):
            continue
        head, url, date = _s(r.get("Headline")), _url(r.get("Article URL")), _iso(r.get("Publication Date"))
        cat = _s(r.get("Category")).title()
        typ = _s(r.get("Announcement Type")).title() or "News"
        typ = TYPE_ALIASES.get(typ, typ)
        if typ not in TYPES:
            typ = "News"
        shown = _s(r.get("Scholar Display Name"))
        on_roster = sid in roster
        if not on_roster and not (typ in OPEN_TYPES and shown):
            skipped.append(nid or head[:40])
            continue
        if not head or not url or not date:
            skipped.append(nid or head[:40])
            continue
        items.append({
            "id": nid,
            "sid": sid if on_roster else "",
            "name": shown or roster[sid],
            "full": roster[sid] if on_roster else shown,
            "type": typ,
            "cat": (cat if cat in CATEGORIES else "Milestone") if typ == "News" else typ,
            "when": _s(r.get("Event Time")) if typ in TIMED_TYPES else "",
            "where": _s(r.get("Event Location")) if typ in TIMED_TYPES else "",
            "head": head,
            "outlet": _s(r.get("Outlet")),
            "date": date,
            "url": url,
            "img": _url(r.get("Image URL")),
            "credit": _s(r.get("Image Credit")),
            "sum": _s(r.get("Summary")),
            "also": _s(r.get("Also Covered By")),
        })
    items.sort(key=lambda x: (x["date"], x["id"]), reverse=True)
    seen = {re.sub(r"^https?://(www\.)?|/+$", "", i["url"].lower()) for i in items}
    auto = [a for a in auto_items(publications, authorship, roster, today, only_types)
            if re.sub(r"^https?://(www\.)?|/+$", "", a["url"].lower()) not in seen]
    shown = {k: 0 for k in AUTO_IN_ALL}
    for a in auto:
        shown[a["type"]] += 1
        a["inAll"] = shown[a["type"]] <= AUTO_IN_ALL[a["type"]]
    return {
        "source": source,
        "generator": generator,
        "items": items + auto,
        "skipped": skipped,
    }
