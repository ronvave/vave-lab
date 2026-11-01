"""Country kit: shared helpers for turning Tonga's dashboard/Admin files into
another country's files.

Tonga is the template source. Every rewrite is driven by a country JSON in
scripts/country_kit/countries/. Nothing here reads or writes a Master.
"""
from __future__ import annotations

import html
import json
import re
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
KIT = Path(__file__).resolve().parent

# ---------------------------------------------------------------------------
# Tonga geography (the template's hard-coded units)
# ---------------------------------------------------------------------------
TONGA_DIVISIONS = {
    "Tongatapu": ["Kolofo'ou", "Kolomotu'a", "Vaini", "Tatakamotonga", "Lapaha", "Nukunuku", "Kolovai"],
    "Vava'u": ["Neiafu", "Pangaimotu", "Hahake", "Leimatu'a", "Hihifo", "Motu"],
    "Ha'apai": ["Pangai", "Foa", "Lulunga", "Mu'omu'a", "Ha'ano", "'Uiha"],
    "'Eua": ["'Eua Motu'a", "'Eua Fo'ou"],
    "Ongo Niua": ["Niuatoputapu", "Niuafo'ou"],
}
TONGA_DIV_ALIASES = {"Niuas": "Ongo Niua", "Ongo Niuas": "Ongo Niua"}
TONGA_DIST_ALIASES = {"Pangai (Lifuka)": "Pangai", "Vahe Hahake (Tongatapu)": "Vahe Hahake",
                      "Hihifo (Tongatapu)": "Vahe Hihifo"}
TONGA_DISTRICT_TO_DIV = {d: v for v, ds in TONGA_DIVISIONS.items() for d in ds}

APOS = "[ʻ‘’ʼ`']"


def norm(s: str) -> str:
    s = html.unescape(s)
    return re.sub(APOS, "'", s).strip()


def slug(s: str) -> str:
    return re.sub(r"[^a-z0-9]", "", norm(s).lower())


def css_slug(s: str) -> str:
    return re.sub(r"[^a-z0-9]+", "-", norm(s).lower()).strip("-")


DIV_NORM = {norm(d): d for d in TONGA_DIVISIONS}
DIV_NORM.update({norm(a): t for a, t in TONGA_DIV_ALIASES.items()})
DIST_NORM = {norm(d): d for d in TONGA_DISTRICT_TO_DIV}
DIST_NORM.update({norm(a): t for a, t in TONGA_DIST_ALIASES.items()})
# Names that are both a Tonga district and something else are ambiguous.
AMBIGUOUS_DIST = {"Motu", "Foa", "Hihifo", "Pangai", "Hahake", "Vaini"}


def load_country(key: str) -> dict:
    cfg = json.loads((KIT / "countries" / f"{key}.json").read_text())
    cfg["divisionList"] = list(cfg["divisions"].keys())
    cfg["districtList"] = [d for ds in cfg["divisions"].values() for d in ds]
    cfg["districtToDiv"] = {d: v for v, ds in cfg["divisions"].items() for d in ds}
    return cfg


# ---------------------------------------------------------------------------
# A tolerant JS scanner: finds string literals, comments and bracket spans.
# ---------------------------------------------------------------------------
REGEX_PREV = set("(,=:[!&|?{};+-*%<>~^")


def scan_spans(src: str):
    """Return (strings, spans). strings: list of (start, end, quote).
    spans: list of (open_idx, close_idx, char)."""
    i, n = 0, len(src)
    strings, spans, stack = [], [], []
    last_sig = ""
    while i < n:
        c = src[i]
        if c in "'\"`":
            j = i + 1
            depth_tpl = 0
            while j < n:
                cj = src[j]
                if cj == "\\":
                    j += 2
                    continue
                if c == "`" and cj == "$" and j + 1 < n and src[j + 1] == "{":
                    depth_tpl += 1
                    j += 2
                    continue
                if c == "`" and depth_tpl and cj == "}":
                    depth_tpl -= 1
                    j += 1
                    continue
                if cj == c and not depth_tpl:
                    break
                if cj == "\n" and c != "`":
                    break
                j += 1
            strings.append((i, j + 1, c))
            i = j + 1
            last_sig = c
            continue
        if c == "/" and i + 1 < n and src[i + 1] == "/":
            j = src.find("\n", i)
            i = n if j < 0 else j
            continue
        if c == "/" and i + 1 < n and src[i + 1] == "*":
            j = src.find("*/", i + 2)
            i = n if j < 0 else j + 2
            continue
        if c == "/" and (last_sig in REGEX_PREV or last_sig == "" or re.search(r"(return|typeof|in|of)\s*$", src[max(0, i - 8):i])):
            # regex literal
            j = i + 1
            in_cls = False
            while j < n and src[j] != "\n":
                if src[j] == "\\":
                    j += 2
                    continue
                if src[j] == "[":
                    in_cls = True
                elif src[j] == "]":
                    in_cls = False
                elif src[j] == "/" and not in_cls:
                    break
                j += 1
            i = j + 1
            while i < n and src[i].isalpha():
                i += 1
            last_sig = "/"
            continue
        if c in "[{(":
            stack.append((c, i))
        elif c in "]})":
            if stack:
                oc, oi = stack.pop()
                if (oc, c) in (("[", "]"), ("{", "}"), ("(", ")")) and oc != "(":
                    spans.append((oi, i, oc))
        if not c.isspace():
            last_sig = c
        i += 1
    return strings, spans


def split_top(body: str):
    """Split a literal body by top-level commas -> list of (start, end)."""
    parts, depth, i, start, n = [], 0, 0, 0, len(body)
    while i < n:
        c = body[i]
        if c in "'\"`":
            j = i + 1
            while j < n and body[j] != c:
                j += 2 if body[j] == "\\" else 1
            i = j + 1
            continue
        if c == "/" and i + 1 < n and body[i + 1] in "/*":
            if body[i + 1] == "/":
                j = body.find("\n", i)
                i = n if j < 0 else j
            else:
                j = body.find("*/", i + 2)
                i = n if j < 0 else j + 2
            continue
        if c in "[{(":
            depth += 1
        elif c in "]})":
            depth -= 1
        elif c == "," and depth == 0:
            parts.append((start, i))
            start = i + 1
        i += 1
    if body[start:].strip():
        parts.append((start, n))
    return parts


STR_RE = re.compile(r"""(['"])((?:\\.|(?!\1).)*)\1""")


def literal_names(text: str, table: dict):
    """Names (canonical Tonga) found as whole string literals or bare keys."""
    found = []
    for m in STR_RE.finditer(text):
        v = norm(m.group(2).replace("\\'", "'"))
        if v in table:
            found.append((m.start(), m.end(), table[v], m.group(1)))
    return found


def q(name: str, quote: str) -> str:
    if quote == "'":
        return "'" + name.replace("\\", "\\\\").replace("'", "\\'") + "'"
    return json.dumps(name, ensure_ascii=False)


def entry_key(entry: str):
    entry = re.sub(r"^(\s*(//[^\n]*\n|/\*.*?\*/))+", lambda m: " " * len(m.group(0)), entry, flags=re.S)
    m = re.match(r"\s*(?:(['\"])((?:\\.|(?!\1).)*)\1|([A-Za-z_$][\w$]*))\s*:", entry)
    if not m:
        return None, None
    raw = m.group(2) if m.group(1) else m.group(3)
    return norm(raw.replace("\\'", "'")), m


def subst_name_in(entry: str, old_canon: str, new: str, table: dict) -> str:
    """Replace literal/bare-key occurrences of old_canon in entry with new."""
    def rep(m):
        v = norm(m.group(2).replace("\\'", "'"))
        if table.get(v) == old_canon:
            return q(new, m.group(1))
        if m.group(2) == slug(old_canon):
            return q(slug(new), m.group(1))
        if m.group(2) == css_slug(old_canon) and "-" in m.group(2):
            return q(css_slug(new), m.group(1))
        return m.group(0)
    out = STR_RE.sub(rep, entry)
    k, m = entry_key(out)
    if k and table.get(k) == old_canon and not m.group(1):
        out = out[:m.start(3)] + (new if re.match(r"^[A-Za-z_$][\w$]*$", new) else q(new, "'")) + out[m.end(3):]
    return out
