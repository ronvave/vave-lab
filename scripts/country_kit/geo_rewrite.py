"""Rewrite Tonga's hard-coded Island Division / District structures for a new
country. Three passes:

1. JS/JSON literal spans (arrays and objects keyed or filled with Tonga units)
2. Repeated line blocks (HTML legend rows, CSS chip rules, one-line-per-unit code)
3. Prose lists and leftovers (logged so they can be reviewed)
"""
from __future__ import annotations

import re

from kitlib import (DIV_NORM, DIST_NORM, TONGA_DIVISIONS, TONGA_DISTRICT_TO_DIV, AMBIGUOUS_DIST,
                    norm, slug, css_slug, scan_spans, split_top, literal_names, subst_name_in,
                    entry_key, q)


def _entries(src, o, c):
    body = src[o + 1:c]
    return body, [(o + 1 + a, o + 1 + b) for a, b in split_top(body)]


def _names(text, table):
    return [n for _, _, n, _ in literal_names(text, table)]


def _key_names(text, table):
    k, _ = entry_key(text)
    return table.get(k) if k else None


def _join(src, ents, new_texts, o, c):
    """Rebuild literal body keeping the original separators/indentation."""
    if len(ents) >= 2:
        sep = src[ents[0][1]:ents[1][0]]
        sep = sep if sep.strip() == "," else ", "
        if "\n" in src[ents[0][1]:ents[1][0]]:
            sep = src[ents[0][1]:ents[1][0]]
    else:
        sep = ", "
    lead = src[o + 1:ents[0][0]]
    trail = src[ents[-1][1]:c]
    cleaned = [t.strip() for t in new_texts]
    return lead + sep.join(cleaned) + trail


def rewrite_spans(src: str, cfg: dict, log: list) -> str:
    divs = cfg["divisionList"]
    dists = cfg["districtList"]
    for _ in range(12):
        _, spans = scan_spans(src)
        spans.sort(key=lambda s: (s[0], -(s[1])))
        edits = []
        taken = []
        for o, c, ch in spans:
            if any(a <= o and c <= b for a, b in taken):
                continue
            if c - o > 20000:
                continue
            body, ents = _entries(src, o, c)
            if not ents:
                continue
            texts = [src[a:b] for a, b in ents]
            new = None
            if ch == "{":
                kd = [_key_names(t, DIV_NORM) for t in texts]
                ks = [_key_names(t, DIST_NORM) for t in texts]
                if sum(1 for k in kd if k) >= 3:
                    tmpl = [t for t, k in zip(texts, kd) if k]
                    tk = [k for k in kd if k]
                    rest = [t for t, k in zip(texts, kd) if not k]
                    out = []
                    for i, nd in enumerate(divs):
                        t = tmpl[i % len(tmpl)]
                        e = subst_name_in(t, tk[i % len(tk)], nd, DIV_NORM)
                        e = _replace_district_array(e, cfg["divisions"][nd])
                        out.append(e)
                    new = out + rest
                    log.append(f"span-div-object {len(tmpl)}→{len(divs)}")
                elif sum(1 for k in ks if k and k not in AMBIGUOUS_DIST) >= 6:
                    tmpl = [t for t, k in zip(texts, ks) if k]
                    tk = [k for k in ks if k]
                    rest = [t for t, k in zip(texts, ks) if not k]
                    out = []
                    for j, nd in enumerate(dists):
                        t = tmpl[j % len(tmpl)]
                        e = subst_name_in(t, tk[j % len(tk)], nd, DIST_NORM)
                        for dn in set(_names(e, DIV_NORM)):
                            e = subst_name_in(e, dn, cfg["districtToDiv"][nd], DIV_NORM)
                        out.append(e)
                    new = out + rest
                    log.append(f"span-district-object {len(tmpl)}→{len(dists)}")
            else:
                nd_ = [_names(t, DIV_NORM) for t in texts]
                ns_ = [_names(t, DIST_NORM) for t in texts]
                one_div = [len(set(x)) == 1 for x in nd_]
                one_dist = [len(set(x)) == 1 for x in ns_]
                if sum(one_div) >= 3 and all(od or not x for od, x in zip(one_div, nd_)) and not any(ns_):
                    tmpl = [t for t, od in zip(texts, one_div) if od]
                    tk = [x[0] for x, od in zip(nd_, one_div) if od]
                    rest = [t for t, od in zip(texts, one_div) if not od]
                    first_idx = one_div.index(True)
                    head = texts[:first_idx] if all(not one_div[k] for k in range(first_idx)) else []
                    rest = [t for t in rest if t not in head]
                    out = [subst_name_in(tmpl[i % len(tmpl)], tk[i % len(tk)], nd, DIV_NORM)
                           for i, nd in enumerate(divs)]
                    new = head + out + rest
                    log.append(f"span-div-array {len(tmpl)}→{len(divs)}")
                elif sum(one_dist) >= 6:
                    tmpl = [t for t, od in zip(texts, one_dist) if od]
                    tk = [x[0] for x, od in zip(ns_, one_dist) if od]
                    rest = [t for t, od in zip(texts, one_dist) if not od]
                    out = []
                    for j, nd in enumerate(dists):
                        e = subst_name_in(tmpl[j % len(tmpl)], tk[j % len(tk)], nd, DIST_NORM)
                        for dn in set(_names(e, DIV_NORM)):
                            e = subst_name_in(e, dn, cfg["districtToDiv"][nd], DIV_NORM)
                        out.append(e)
                    new = out + rest
                    log.append(f"span-district-array {len(tmpl)}→{len(dists)}")
            if new is not None:
                edits.append((o, c, _join(src, ents, new, o, c)))
                taken.append((o, c))
        if not edits:
            break
        for o, c, body in sorted(edits, reverse=True):
            src = src[:o + 1] + body + src[c:]
    return src


STR_ANY = re.compile(r"""(['"])((?:\\.|(?!\1).)*)\1""")


def _replace_district_array(entry: str, new_dists):
    """Inside a division entry, replace an array of district literals."""
    def rep(m):
        inner = m.group(1)
        found = literal_names(inner, DIST_NORM)
        if len(found) >= 1 and len(found) * 2 >= len(STR_ANY.findall(inner)):
            quote = found[0][3]
            return "[" + ", ".join(q(d, quote) for d in new_dists) + "]"
        return m.group(0)
    return re.sub(r"\[([^\[\]]*)\]", rep, entry)


# ---------------------------------------------------------------------------
# Pass 2: repeated line blocks
# ---------------------------------------------------------------------------
def _variants(canon: str):
    v = {canon, canon.replace("'", "ʻ"), canon.replace("'", "&#39;"), canon.replace("'", "\\'"),
         canon.replace("'", "’"), canon.replace("'", "")}
    return sorted(v, key=len, reverse=True)


def _div_token_re():
    alts = []
    for d in list(TONGA_DIVISIONS) + ["Niuas"]:
        alts += [re.escape(x) for x in _variants(d)]
        alts += [re.escape(slug(d)), re.escape(css_slug(d))]
    alts = sorted(set(alts), key=len, reverse=True)
    return re.compile(r"(?<![A-Za-z0-9])(" + "|".join(alts) + r")(?![A-Za-z0-9])", re.I)


DIV_TOKEN = _div_token_re()


def _which_div(tok: str):
    t = norm(tok)
    if t in DIV_NORM:
        return DIV_NORM[t]
    for d in TONGA_DIVISIONS:
        if tok.lower() in (slug(d), css_slug(d)):
            return d
    if tok.lower() == "niuas":
        return "Ongo Niua"
    return None


def _line_div(line):
    ds = {_which_div(m.group(1)) for m in DIV_TOKEN.finditer(line)}
    ds.discard(None)
    return ds


def _sub_block(lines, old, new):
    def rep(m):
        tok = m.group(1)
        if _which_div(tok) != old:
            return tok
        if tok == slug(old):
            return slug(new)
        if tok == css_slug(old):
            return css_slug(new)
        if "&#39;" in tok:
            return new.replace("'", "&#39;")
        if "\\'" in tok:
            return new.replace("'", "\\'")
        return new
    lines = [re.sub(r"\.(Tongatapu)\b(?!\s*[:(])", r"['\1']", ln) for ln in lines]
    return [DIV_TOKEN.sub(rep, ln) for ln in lines]


def _shape(line: str) -> str:
    x = re.sub(r"\s+", " ", line.strip())
    x = DIV_TOKEN.sub("<D>", x)
    x = re.sub(r"\[\s*([\"'])<D>\1\s*\]|\.<D>", "<ACC>", x)
    x = re.sub(r"([\"'])<D>\1", "<Q>", x)
    x = re.sub(r"#[0-9a-fA-F]{3,8}\b", "<C>", x)
    x = re.sub(r"rgba?\([^)]*\)", "<C>", x)
    return re.sub(r"\d+(\.\d+)?", "<N>", x)


def rewrite_line_blocks(src: str, cfg: dict, log: list) -> str:
    lines = src.split("\n")
    divs = cfg["divisionList"]
    out, i, n = [], 0, len(lines)
    while i < n:
        d0 = _line_div(lines[i])
        if len(d0) != 1:
            out.append(lines[i]); i += 1; continue
        d0 = next(iter(d0))
        j = i + 1
        while j < n and j - i <= 12 and not (_line_div(lines[j]) and _line_div(lines[j]) != {d0}):
            j += 1
        if j >= n or j - i > 12 or len(_line_div(lines[j])) != 1:
            out.append(lines[i]); i += 1; continue
        p = j - i
        a = 0
        while a < p - 1 and len(out) > a and i + p - a - 1 < n and \
                _shape(lines[i - a - 1]) == _shape(lines[i + p - a - 1]) and not _line_div(lines[i - a - 1]):
            a += 1
        start = i - a
        ref_shape = [_shape(x) for x in lines[start:start + p]]
        blocks, k, seen = [], start, set()
        while k + p <= n:
            blk = lines[k:k + p]
            if [_shape(x) for x in blk] != ref_shape:
                break
            ds = set().union(*[_line_div(x) for x in blk])
            if len(ds) != 1:
                break
            dd = next(iter(ds))
            if dd in seen:
                break
            seen.add(dd)
            blocks.append((dd, blk))
            k += p
        if len(blocks) >= 3:
            if a:
                del out[-a:]
            for idx, nd in enumerate(divs):
                od, blk = blocks[idx % len(blocks)]
                out.extend(_sub_block(blk, od, nd))
            log.append(f"line-block period={p} {len(blocks)}→{len(divs)} at line {start + 1}")
            i = k
        else:
            out.append(lines[i]); i += 1
    return "\n".join(out)


# ---------------------------------------------------------------------------
# Pass 3: prose lists and leftovers
# ---------------------------------------------------------------------------
def rewrite_leftovers(src: str, cfg: dict, log: list, fname: str) -> str:
    divs = cfg["divisionList"]
    dists = cfg["districtList"]
    tok = r"(?:" + "|".join(re.escape(v) for d in list(TONGA_DIVISIONS) for v in _variants(d)) + r")"
    lst = re.compile(tok + r"(?:\s*(?:,|/|and|,\s*and|or)\s*" + tok + r"){2,}")
    src = lst.sub(lambda m: (", " if "," in m.group(0) else " / ").join(divs), src)
    # explicit leftovers
    def div_left(m):
        ln = src.count("\n", 0, m.start()) + 1
        ctx = src[max(0, m.start()-70):m.end()+50].replace("\n", " ")
        log.append(f"L{ln} leftover division '{m.group(0)}' :: {ctx}")
        return divs[0]
    src = re.sub(r"(?<![A-Za-z0-9-])(" + tok + r")(?![A-Za-z0-9])", div_left, src)
    dist_tok = sorted({v for d in TONGA_DISTRICT_TO_DIV if d not in AMBIGUOUS_DIST for v in _variants(d)}, key=len, reverse=True)
    def dist_left(m):
        ln = src.count("\n", 0, m.start()) + 1
        ctx = src[max(0, m.start()-70):m.end()+50].replace("\n", " ")
        log.append(f"L{ln} leftover district '{m.group(0)}' :: {ctx}")
        return dists[0]
    src = re.sub(r"(?<![A-Za-z0-9-])(" + "|".join(re.escape(v) for v in dist_tok) + r")(?![A-Za-z0-9])", dist_left, src)
    return src


def rewrite_geography(src: str, cfg: dict, log: list, fname: str, kind: str) -> str:
    if kind in ("js", "html"):
        src = rewrite_spans(src, cfg, log)
    src = rewrite_line_blocks(src, cfg, log)
    src = rewrite_leftovers(src, cfg, log, fname)
    return src
