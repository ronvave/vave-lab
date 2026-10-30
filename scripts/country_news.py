"""Scholar news snapshot for a country dashboard (Panel A4).

Reads the country's News sheet (header row 4, data from row 5) and keeps
stories that are ticked "Show on Dashboard" and belong to a scholar on the
dashboard roster. Only allow-listed fields leave the Master file; Notes,
Added By and Added On stay private.

Stories are added by hand after review. Nothing here searches for news.
No timestamp is embedded, so an unchanged News tab yields identical bytes
and scripts/plaintext_changed.py skips the re-encrypt.
"""
from __future__ import annotations

import re
from datetime import datetime

CATEGORIES = ["Award", "Appointment", "Graduation", "Milestone", "Publication", "Research"]
# Panel A4 toggle groups. Rows without an Announcement Type are News.
TYPES = ["News", "Defense", "Thesis", "Publication", "Event"]
# Older label kept readable: webinars are now listed under Events.
TYPE_ALIASES = {"Webinar": "Event", "New Thesis": "Thesis", "New Publication": "Publication"}
# New theses and publications may be about Tonga by an author outside the
# database; those rows need a Scholar Display Name instead of a Scholar ID.
OPEN_TYPES = ("Thesis", "Publication")
TIMED_TYPES = ("Defense", "Event")


def _s(v) -> str:
    return re.sub(r"\s+", " ", str(v or "")).strip()


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


def build(rows: list[dict], scholars: list[dict], *, source: str, generator: str) -> dict:
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
    return {
        "source": source,
        "generator": generator,
        "items": items,
        "skipped": skipped,
    }
