"""Regional Panel A2 "Celebrating Pasifika scholars".

Builds one story list for all 11 country databases from the Master dumps the
Regional rebuild already pulls:

  * curated News tab rows (Fiji, Tonga, Solomon Islands today), and
  * new theses and publications from Publications + Authorship (this year).

Rules carried over from the country panels and the Regional dashboard:
  * only the six main publication types (no conference papers or preprints),
  * only scholars on each country's included roster (identity gate),
  * one item per work: a paper co-authored by Fiji and Tonga scholars is
    merged by full title into one item listing both countries.

Each item keeps the people in author order as [country, scholar id, name],
so the page can show the lead database scholar's flag first and split photos.
"""
from __future__ import annotations

import re

import country_news as cn

# Regional label -> country-panel type name (pill text and colour class).
TYPE_NAME = {
    "Journal article": "Journal Article",
    "Book chapter": "Book Chapter",
    "Book": "Book",
    "Report": "Report",
    "Master's thesis": "Master's Thesis",
    "PhD thesis": "PhD Thesis",
}


def _title_key(t: str) -> str:
    return re.sub(r"[^a-z0-9]+", "", (t or "").lower())


def _given_family(s: dict, first) -> str:
    g = first(s, "Given Names", "Given Name(s)", "Given Name")
    f = first(s, "Family Name", "Surname")
    if g or f:
        return (g + " " + f).strip()
    nm = first(s, "Scholar Name", "Display Name", "Full Name")
    m = re.match(r"^([^,]+),\s*(.+)$", nm)
    return (m.group(2) + " " + m.group(1)) if m else nm


def _country_items(code: str, dump: dict, B) -> tuple[list, dict, dict]:
    """country_news items for one country, {pub id: [(pos, sid)]}, {sid: name}."""
    first, norm, fold = B.first, B.norm, B.fold
    sch, _excl = B.roster(code, dump)
    ids = {norm(r["Scholar ID"]).upper() for r in sch}
    roster = [{"Scholar ID": norm(r["Scholar ID"]).upper(), "Scholar Name": _given_family(r, first)} for r in sch]

    # Same publication rules as the Regional Panel G counts (build_country).
    P = B.table(dump, "Publications", "Publication ID / BibTeX Key") or B.table(dump, "Publications", "Publication ID")
    pubs, seen = [], set()
    for r in P:
        pid = norm(r.get("Publication ID / BibTeX Key") or r.get("Publication ID"))
        if not pid or pid in seen:
            continue
        seen.add(pid)
        if code == "WSM" and fold(r.get("V2 Inclusion Flag")) != "included":
            continue
        if fold(r.get("Verification Status")) == "excluded" or fold(r.get("Dedup Status")) == "duplicate":
            continue
        t = fold(first(r, "Publication Type", "Type"))
        label = B.ELIGIBLE_PUB.get(t) or (B.FIJI_EXTRA_PUB.get(t) if code == "FJI" else None)
        if label not in TYPE_NAME:
            continue
        pubs.append({
            "Publication ID / BibTeX Key": pid,
            "Publication Type": TYPE_NAME[label],
            "Year": first(r, "Year"),
            "Title": first(r, "Title"),
            "DOI": first(r, "DOI"),
            "URL": first(r, "URL", "Primary URL", "Open Access URL", "Full Text URL"),
            "Bibliographic Lead Author": first(r, "Bibliographic Lead Author", "Lead Author Name"),
            "Journal / Book Title": first(r, "Journal / Book Title", "Container / Journal", "Journal/Publisher", "Journal / Publisher"),
            "Publisher / Institution / School": first(r, "Publisher / Institution / School", "Publisher / Institution"),
        })
    auth, order = [], {}
    for r in B.table(dump, "Authorship", "Authorship ID"):
        if fold(r.get("Verification Status")) == "excluded":
            continue
        pid = norm(r.get("Publication ID / BibTeX Key") or r.get("Publication ID"))
        sid = norm(r.get("Scholar ID")).upper()
        if not pid or sid not in ids:
            continue
        pos = first(r, "Author Position")
        auth.append({"Publication ID / BibTeX Key": pid, "Scholar ID": sid, "Author Position": pos})
        try:
            p = int(float(pos))
        except ValueError:
            p = 99
        order.setdefault(pid, []).append((p, sid))

    news = B.table(dump, "News", "News ID")
    doc = cn.build(news, roster, source=code, generator="regional_news.py", publications=pubs, authorship=auth)
    return doc["items"], order, {r["Scholar ID"]: r["Scholar Name"] for r in roster}


def build(dumps: dict, countries, B) -> dict:
    merged: dict[str, dict] = {}
    for c in countries:
        code = c[0]
        dump = dumps.get(code)
        if not dump:
            continue
        items, order, names = _country_items(code, dump, B)
        for it in items:
            pid = it["id"][4:] if it.get("auto") else ""
            if it.get("auto"):
                ppl = [(p, code, s) for p, s in sorted(order.get(pid, []))]
            else:
                ppl = [(i, code, s) for i, s in enumerate(it.get("sids") or ([it["sid"]] if it.get("sid") else []))]
            key = ("T" + _title_key(it["head"])) if it.get("auto") else ("U" + (it.get("url") or it["id"]))
            row = merged.get(key)
            if row is None:
                row = dict(it)
                row["id"] = code + "-" + it["id"]
                row["src"] = [code]
                row["_ppl"] = []
                row["_names"] = {}
                merged[key] = row
            elif code not in row["src"]:
                row["src"].append(code)
            row["_ppl"].extend(ppl)
            row["_names"].update({(code, s): names.get(s, "") for _, _, s in ppl})

    out = []
    for row in merged.values():
        seen, ppl = set(), []
        for _p, code, sid in sorted(row.pop("_ppl"), key=lambda x: x[0]):
            if (code, sid) in seen:
                continue
            seen.add((code, sid))
            ppl.append([code, sid, row["_names"].get((code, sid), "")])
        row.pop("_names")
        row["ppl"] = ppl
        # Flags: countries in author order; items with no database scholar
        # (for example a thesis about the country) use the source database.
        flags = []
        for code, _s, _n in ppl:
            if code not in flags:
                flags.append(code)
        for code in row["src"]:
            if code not in flags:
                flags.append(code)
        row["c"] = flags
        if ppl:
            row["sid"] = ppl[0][1]
            names = []
            for _c, _s, n in ppl:  # one person in two databases is named once
                if n and n not in names:
                    names.append(n)
            if names and row.get("auto"):
                row["name"] = names[0] if len(names) == 1 else (
                    " and ".join(names) if len(names) == 2 else names[0] + ", " + names[1] + " and others")
                row["full"] = names[0]
        row.pop("sids", None)
        row.pop("inAll", None)
        out.append(row)
    out.sort(key=lambda x: (x.get("date", ""), bool(x.get("sid"))), reverse=True)
    return {"items": out}
