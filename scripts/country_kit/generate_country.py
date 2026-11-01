#!/usr/bin/env python3
"""Generate a country dashboard + Admin kit from Tonga's live files.

    python3 scripts/country_kit/generate_country.py cook --out /tmp/kit/out

Tonga is the template. Every Tonga file listed in TEMPLATE_FILES is read,
rewritten for the target country (naming, geography, labels, art paths) and
written with the country key in place of "tongan"/"tonga". Shared files
(b2-study-table, country-news, ...) are referenced unchanged.

Nothing here touches a Master file or pushes to GitHub.
"""
from __future__ import annotations

import argparse
import json
import re
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
from kitlib import ROOT, KIT, load_country, norm, DIV_NORM, DIST_NORM, TONGA_DIV_ALIASES  # noqa: E402
from geo_rewrite import rewrite_geography  # noqa: E402

DASHBOARD_FILES = [
    "tongan-research-database-master.html", "tongan-chord-flanked.html", "tongan-body-composition.html",
    "js/tongan-mobility-model.js",
    "js/tongan-database-master.js", "js/tongan-database-adapter.js", "js/tongan-panel-overrides.js",
    "js/tongan-demo-gate.js", "js/tongan-main.js", "js/tongan-panel-hero.js", "js/tongan-panel-menu.js",
    "js/tongan-scholar-portal.js", "js/tongan-short-disciplines.js", "js/tongan-text-contrast.js",
    "js/tongan-clans.js", "js/tongan-country-flags.js", "js/tonga-countries.js", "js/tonga-country-inputs.js",
    "css/tongan-country-flags.css", "css/tongan-panel-hero.css", "css/tongan-panel-menu.css",
    "css/tongan-scholar-portal.css",
]
ADMIN_FILES = [
    "admin-tongan-master.html", "js/admin-tongan-master.js",
    "admin-tongan-review.html", "js/tongan-review-login.js",
    "js/tongan-admin-insights-migration.js", "js/tongan-admin-writeback-client.js",
    "js/tongan-attachment-parser.js", "js/tongan-attachment-review.js", "js/tongan-change-log.js",
    "js/tongan-db-gate.js", "js/tongan-news-admin.js",
    "js/tongan-review-change-log.js", "js/tongan-submissions-admin.js",
    "css/tongan-change-log.css", "css/tongan-news-admin.css", "css/tongan-submissions.css",
    "apps-script/tongan-master-writeback.gs", "apps-script/tongan-admin-app.html",
    "apps-script/tongan-admin-controller.html", "apps-script/tongan-admin-writeback-bridge.html",
    "apps-script/tonga-review-v5.gs", "apps-script/tonga-attachment-analysis.gs",
    "apps-script/deployed/tonga-submissions-v1.gs",
]
PIPELINE_FILES = [
    "scripts/tongan_master_file_config.py", "scripts/tongan_master_file_transformer.py",
    "scripts/tongan_short_disciplines.py", "scripts/tongan_encrypt_data.py", "scripts/tongan_decrypt_data.py",
    "scripts/tongan_sync_share_tokens.py", "scripts/tongan_autofill_university_coords.py",
    ".github/workflows/refresh-tongan-master-file.yml",
]

# Class names / paths defined in shared CSS/JS that must keep their Tonga spelling.
PROTECT = ["tonga-share", "Pacific/Tongatapu", "Rarotonga"]
OTHER_COUNTRIES = ["Fiji", "Samoa", "Vanuatu", "Solomon", "Kiribati", "Tuvalu", "Nauru", "Niue",
                   "New Zealand", "Australia", "Papua New Guinea", "Marshall", "Palau", "Hawai"]

TONGA_COLLAB = re.compile(
    r"Tongan scholar collaborators, Professor Tēvita Kaʻili and Associate Professor ‘Inoke Hafoka,")
PREPS = r"(?:in|of|from|to|on|about|across|for|by|with|within|throughout|at|into)"


def out_name(path: str, cfg: dict) -> str:
    p = re.sub(r"tongan", cfg["key"], path)
    return re.sub(r"tonga(?![a-z])", cfg["key"], p)


def multi_country_line(line: str) -> bool:
    if re.search(r"\[/\\b\w+\\b/i,", line):
        return True
    return sum(1 for c in OTHER_COUNTRIES if re.search(r"['\"]" + c, line)) >= 2


def rename(text: str, cfg: dict, kind: str) -> str:
    key, KEY = cfg["key"], cfg["KEY"]
    Key = key[0].upper() + key[1:]
    out = []
    for line in text.split("\n"):
        if multi_country_line(line):
            out.append(line)
            continue
        holds = {}
        protect = PROTECT + [n for n in cfg["divisionList"] + cfg["districtList"] if "tonga" in n.lower()]
        for i, p in enumerate(protect):
            tok = f"\x00P{i}\x00"
            if p in line:
                holds[tok] = p
                line = line.replace(p, tok)
        line = line.replace("TNG-", cfg["prefix"] + "-").replace("TON-R", cfg["prefix"] + "-R")
        line = re.sub(r"flag-ton\b", "flag-" + cfg["iso3"], line)
        line = line.replace("img/tonga/", f"img/{key}/")
        # identifiers (glued to other identifier chars) -> key forms
        line = re.sub(r"(?<=[A-Za-z0-9_$])TONGAN?|(?:TONGAN|TONGA(?!N))(?=[A-Za-z0-9_$])", KEY, line)
        line = re.sub(r"(?<=[A-Za-z0-9_$])Tongan?|(?:Tongan|Tonga(?!n))(?=[A-Za-z0-9_$])", Key, line)
        line = re.sub(r"(?<![A-Za-z])tongan?(?![a-z])|(?<![A-Za-z])tongan?(?=[A-Z0-9_-])", key, line)
        line = re.sub(r"(?<![A-Za-z])tongan?", key, line)
        # prose
        line = re.sub(r"\bTONGANS\b", cfg["adjectiveUpper"] + " SCHOLARS", line)
        line = re.sub(r"\bTONGAN\b", cfg["adjectiveUpper"], line)
        line = re.sub(r"\bTONGA\b", cfg["adjectiveUpper"], line)
        line = re.sub(r"(['\"])Tonga\1", lambda m: m.group(1) + cfg["countryValue"] + m.group(1), line)
        line = re.sub(r"\bTongans\b", cfg["adjective"] + " scholars", line)
        line = re.sub(r"\bTongan\b", cfg["adjective"], line)
        line = re.sub(r"\bTonga['’]s\b", cfg["countryPossessive"], line)
        line = re.sub(r"\b(" + PREPS + r") Tonga\b", lambda m: m.group(1) + " " + cfg["countryInSentence"], line)
        line = re.sub(r"\b(" + PREPS.replace("(?:", "(?:").title() + r") Tonga\b",
                      lambda m: m.group(0).replace("Tonga", cfg["countryInSentence"]), line)
        line = re.sub(r"\bTonga\b", cfg["country"], line)
        for tok, p in holds.items():
            line = line.replace(tok, p)
        out.append(line)
    return "\n".join(out)


def gender(text: str, cfg: dict | None = None) -> str:
    gl = (cfg or {}).get("genderLabels") or {"male": "Male", "female": "Female"}
    m, f = gl["male"], gl["female"]
    for a, b in (("Tangata", m), ("Fefine", f), ("tangata", m.lower()), ("fefine", f.lower())):
        text = re.sub(r"\b" + a + r"\b", b, text)
    return text


LABELS = [
    (r"Island Divisions", "division", "plural"), (r"Island Division", "division", "singular"),
    (r"Districts", "district", "plural"), (r"District", "district", "singular"),
    (r"Clans", "clan", "plural"), (r"Clan", "clan", "singular"),
    (r"Kolo", "village", "singular"),
]


def _label_sub(s: str, cfg: dict, lower_too=True) -> str:
    lv = cfg["levels"]
    for pat, lvl, form in LABELS:
        rep = lv[lvl][form]
        s = re.sub(r"\b" + pat + r"\b", rep, s)
        if lower_too and pat != "Kolo":
            s = re.sub(r"(?<![\w-])" + pat.lower() + r"(?![\w-])", rep.lower(), s)
    s = s.replace("Paternal", cfg["lineage"]["paternal"]).replace("Maternal", cfg["lineage"]["maternal"]) \
        if cfg["lineage"]["paternal"] != "Paternal" else s
    return s


JS_STR = re.compile(r"""(?<![\w$\]])(['"`])((?:\\.|(?!\1)[^\\\n])*?)\1""")


def relabel_js(text: str, cfg: dict) -> str:
    """Relabel prose string literals only: they must contain a space and the
    literal must not be used as a property key or index."""
    def rep(m):
        q, body = m.group(1), m.group(2)
        start, end = m.start(), m.end()
        before = text[max(0, start - 2):start]
        after = text[end:end + 2]
        if " " not in body.strip() or "[" in before[-1:] or after[:1] in ("]", ":"):
            return m.group(0)
        if re.fullmatch(r"(Island Division|District|Clan|Village/Town|Specific Island|Kolo)[\w /()-]*", body) \
                and len(body.split()) <= 4 and not body.endswith(("s", ".")):
            # looks like a column header (data key) -> keep
            return m.group(0)
        if "<" not in body and len(body) < 120 and re.search(r"(Paternal|Maternal) ", body) and "Kolo" not in body:
            # 'Paternal District' style keys are data columns; keep unless clearly prose
            if not re.search(r"\b(the|of|by|and|or|a|is|are|for)\b", body):
                return m.group(0)
        return q + _label_sub(body, cfg) + q
    text = JS_STR.sub(rep, text)
    return relabel_templates(text, cfg)


def relabel_templates(text: str, cfg: dict) -> str:
    """Relabel prose inside multi-line template literals (outside ${...})."""
    from kitlib import scan_spans
    strings, _ = scan_spans(text)
    out, last = [], 0
    for a, b, qch in strings:
        if qch != "`":
            continue
        body = text[a:b]
        if " " not in body:
            continue
        parts = re.split(r"(\$\{(?:[^{}]|\{[^{}]*\})*\})", body)
        new = "".join(pt if pt.startswith("${") else _label_tpl(pt, cfg) for pt in parts)
        out.append(text[last:a]); out.append(new); last = b
    out.append(text[last:])
    return "".join(out)


def _label_tpl(seg: str, cfg: dict) -> str:
    # only text between tags / plain words; keep attribute values (class names, data-*)
    def fix(m):
        return _label_sub(m.group(0), cfg)
    return re.sub(r"(?<=>)[^<>]+(?=<|$)|^[^<>]+(?=<|$)", fix, seg)


def relabel_html(text: str, cfg: dict) -> str:
    def text_node(m):
        return ">" + _label_sub(m.group(1), cfg) + "<"
    text = re.sub(r">([^<>]+)<", text_node, text)
    text = re.sub(r'((?:title|placeholder|aria-label|alt)=")([^"]*)(")',
                  lambda m: m.group(1) + _label_sub(m.group(2), cfg) + m.group(3), text)
    # inline <script> blocks: relabel prose literals
    text = re.sub(r"(<script(?![^>]*src)[^>]*>)(.*?)(</script>)",
                  lambda m: m.group(1) + relabel_js(m.group(2), cfg) + m.group(3), text, flags=re.S)
    return text


def map_rewrite(text: str, cfg: dict) -> str:
    (s, w), (n, e) = cfg["map"]["bounds"]
    cy, cx = cfg["map"]["center"]
    text = re.sub(r"\[\[\s*-21\.5\s*,\s*-176\.2\s*\]\s*,\s*\[\s*-15\.5\s*,\s*-173\.6\s*\]\]",
                  f"[[{s}, {w}], [{n}, {e}]]", text)
    text = re.sub(r"\[\s*-19\.5\s*,\s*-174\.5\s*\]", f"[{cy}, {cx}]", text)
    return text


def specials(text: str, cfg: dict, path: str) -> str:
    text = TONGA_COLLAB.sub("the dashboard curator,", text)
    text = re.sub(r", in collaboration with Tongan scholars, <a [^>]*tevita-kaili.*?Brigham Young University–Hawaiʻi", "", text)
    # Tonga's "Niuas" display alias for Ongo Niua has no equivalent elsewhere.
    text = re.sub(r"([\w.]+)==='Ongo Niua'\?'Niuas':\1\|\|''", r"\1||''", text)
    text = text.replace("v==='Ongo Niua'?'Niuas':", "")
    text = text.replace("if(v==='Ongo Niua')return 'Niuas';", "")
    text = text.replace("division==='Niuas'?'Niuas (Ongo Niua)':division", "division")
    text = text.replace("value === 'Niuas' ? 'Ongo Niua' : value", "value")
    # Panel B1 narrative assumes at least three Island Divisions.
    text = text.replace(
        "let s = `Tonga-focused publications are most concentrated in ${a.name} (${a.total.toLocaleString()}), followed by ${b.name} (${b.total.toLocaleString()}) and ${c.name} (${c.total.toLocaleString()}). `;",
        "const _fmtR = r => `${r.name} (${r.total.toLocaleString()})`;\n"
        "      let s = `Tonga-focused publications are most concentrated in ${_fmtR(a)}`"
        " + (c ? `, followed by ${_fmtR(b)} and ${_fmtR(c)}. ` : b ? `, followed by ${_fmtR(b)}. ` : '. ');")
    # <option> runs listing Tonga's divisions or districts -> this country's.
    def _opt_run(m):
        names = re.findall(r"<option>([^<]*)</option>", m.group(0))
        if names and all(norm(n) in DIV_NORM or n in TONGA_DIV_ALIASES for n in names):
            return "".join(f"<option>{d}</option>" for d in cfg["divisions"])
        if names and all(norm(n) in DIST_NORM for n in names):
            return "".join(f"<option>{d}</option>" for d in cfg["districtList"])
        return m.group(0)
    text = re.sub(r"(?:<option>[^<]*</option>\s*){2,}", _opt_run, text)
    # Panel D: a country may not yet have a recorded "first" for every
    # gender/stage pair. Skip that milestone rather than failing the panel.
    text = text.replace("if (!candidates.length) throw new Error(`Panel D milestone data missing: ${def.key}`);",
                        "if (!candidates.length) return null;")
    text = text.replace("        ties: tied\n      };\n    });\n\n    const authorshipByPublication",
                        "        ties: tied\n      };\n    }).filter(Boolean);\n\n    const authorshipByPublication")
    # Display-only "Grouped by" label in B1/C2 (exact literal, so the
    # data-key guard leaves it alone).
    text = text.replace("b1Division ? 'Island Division' :",
                        "b1Division ? '" + cfg["levels"]["division"]["singular"] + "' :")
    ex = cfg["districtList"]
    text = text.replace('placeholder="e.g. Kolovai"', f'placeholder="e.g. {cfg.get("villageExample") or "village name"}"')
    text = re.sub(r'placeholder="e\.g\. Tongatapu, Foa, Niuaf[^"]*"', f'placeholder="e.g. {", ".join(ex[:3])}"', text)
    text = re.sub(r"\s*<small>Independently curated — some districts \(e\.g\. Lulunga\) span multiple islands\.</small>", "", text)
    text = text.replace("('Tatakamotonga')", "")
    if path.endswith(".html") and "research-database-master" in path:
        text = re.sub(r"(<p class=\"db-lede\">\s*).*?(\s*</p>)",
                      lambda m: m.group(1) + "\x00INTRO\x00" + m.group(2), text, count=1, flags=re.S)
        text = re.sub(r"(<code>)Vave, R\., Ka'ili.*?(</code>)",
                      lambda m: m.group(1) + "\x00CITE\x00" + m.group(2), text, count=1, flags=re.S)
        text = text.replace(" nw--mat-fill", "")
    return text


TONGA_MASTER_ID = "1lh6wOFcg2GiFe2YylgxM5cvLOdumdbCrHDLQk87rjRI"


def gate_secrets(text: str, cfg: dict) -> str:
    """Tonga bakes its live passcode into the public gate file. A generated
    country gets PREVIEW-ONLY values (never Tonga's). Set the real ones at
    launch, ideally without baking them into public JS."""
    import base64
    import os
    pp = cfg.get("_previewPasscode") or "preview-only"
    b = base64.b64encode(pp.encode()).decode()
    text = re.sub(r"(var BAKED_PASSCODE = atob\(')[^']*('\))", lambda m: m.group(1) + b + m.group(2), text)
    cp = cfg.get("_collabPasscode") or base64.urlsafe_b64encode(os.urandom(18)).decode()
    cb = base64.b64encode(cp.encode()).decode()
    text = re.sub(r"(var COLLABORATOR_PASSCODE = atob\(')[^']*('\))", lambda m: m.group(1) + cb + m.group(2), text)
    key = base64.b64encode(os.urandom(32)).decode()
    text = re.sub(r"(var DEMO_SIGN_KEY_B64 = ')[^']*(')", lambda m: m.group(1) + key + m.group(2), text)
    return text


def gate_verifier(text: str, cfg: dict) -> str:
    """Point the data-gate verifier at this country's passcode, never Tonga's."""
    import hashlib
    pp = cfg.get("_previewPasscode") or "preview-only"
    v = hashlib.pbkdf2_hmac("sha256", pp.encode(), b"vavelab-db-verifier-v1", 200_000).hex()
    text = re.sub(r'//   passcode = "[^"\n]*"', "//   passcode = the country data passcode (GitHub secret, never in comments)", text)
    text = re.sub(r'BAKED_PASSCODE are both "[^"\n]*"\)', "BAKED_PASSCODE are the same value)", text)
    return re.sub(r"(VERIFIER_HASH_HEX\s*=\s*')[0-9a-f]+(')", lambda m: m.group(1) + v + m.group(2), text)


def finish(text: str, cfg: dict) -> str:
    if "BAKED_PASSCODE = atob(" in text:
        text = gate_secrets(text, cfg)
    if "VERIFIER_HASH_HEX" in text:
        text = gate_verifier(text, cfg)
    text = text.replace(TONGA_MASTER_ID, cfg["masterId"])
    text = re.sub(r'casual grep of "[^"\n]+"', "casual grep of the passcode", text)
    text = re.sub(re.escape(cfg["adjective"]) + r" islands\b", "islands", text)
    text = text.replace("Pacific/Tongatapu", cfg["timezone"])
    # Never point a new country at Tonga's Apps Script deployment.
    text = re.sub(r"https://script\.google\.com/macros/s/AKfyc[\w-]+/exec",
                  f"https://script.google.com/macros/s/REPLACE_WITH_{cfg['KEY']}_DEPLOYMENT/exec", text)
    text = text.replace('data-flag="ton"', f'data-flag="{cfg["iso3"]}"')
    n = len(cfg["districtList"])
    text = re.sub(r"(assert len\(PROVINCES\) == )23", lambda m: m.group(1) + str(n), text)
    lv = cfg["levels"]["district"]["plural"]
    text = re.sub(r"\b23(?=\s+(?:" + re.escape(lv) + "|" + re.escape(lv.lower()) + r")\b)", str(n), text)
    dp = cfg["levels"]["division"]["plural"]
    text = re.sub(r"\b5(?=\s+(?:" + re.escape(dp) + "|" + re.escape(dp.lower()) + r")\b)", str(len(cfg["divisionList"])), text)
    text = re.sub(r"\bfive(?=\s+(?:" + re.escape(dp) + "|" + re.escape(dp.lower()) + r")\b)", str(len(cfg["divisionList"])), text)
    text = re.sub(r"\b23 districts\b", f"{n} {cfg['levels']['district']['plural'].lower()}", text)
    text = re.sub(r"\b5 Island Divisions\b", f"{len(cfg['divisionList'])} {cfg['levels']['division']['plural']}", text)
    return text.replace("\x00INTRO\x00", cfg["intro"]).replace("\x00CITE\x00", cfg["citation"])


def workflow_governance(text: str, cfg: dict) -> str:
    """Countries whose Master uses the governance layout (Samoa, Cook Islands,
    FSM) are reshaped into Tonga's layout first (read-only), then transformed
    with the unchanged Tonga transformer in local mode. Steps that would write
    to the Master (coordinate autofill, share-token sync) are left out until
    Ron approves Master writes for that country."""
    k = cfg["key"]
    text = re.sub(r"\n# Manual refresh trigger:[^\n]*", "", text)
    text = re.sub(r"\n      - name: Autofill missing university coordinates\n.*?(?=\n      - name: )", "", text, flags=re.S)
    text = re.sub(r"\n      - name: Synchronize stable [^\n]*\n.*?(?=\n      - name: )", "", text, flags=re.S)
    new_step = (
        f"python3 scripts/country_kit/governance_dump.py {k} --dump-dir /tmp/{k}-dump > /dev/null\n"
        f"          python3 scripts/{k}_master_file_transformer.py \\\n"
        f"            --mode=local \\\n"
        f"            --dump-dir=/tmp/{k}-dump \\\n"
        f"            --out-dir=data")
    text, n = re.subn(r"python3 scripts/" + k + r"_master_file_transformer\.py \\\n\s+--mode=production \\\n\s+--out-dir=data",
                      lambda m: new_step, text)
    assert n == 1, "transform step not found"
    text = text.replace('      - "scripts/' + k + '_sync_share_tokens.py"\n',
                        '      - "scripts/country_kit/governance_dump.py"\n'
                        '      - "scripts/country_kit/countries/' + k + '.json"\n')
    text = text.replace("Reads the " + cfg["adjective"] + " Scholars Master Sheet via a service account,",
                        "Reads the " + cfg["adjective"] + " Scholars Master Sheet via a service account (read-only),\n# reshapes it with scripts/country_kit/governance_dump.py,")
    text = text.replace("must be granted Editor on the", "needs Viewer access on the")
    return text


def submit_guard(text: str, cfg: dict) -> str:
    """Until the country's Apps Script deployment exists: hide Share a story
    and give Update info an honest 'not open yet' message."""
    ph = f"REPLACE_WITH_{cfg['KEY']}_DEPLOYMENT"
    if ph not in text:
        return text
    text = re.sub(r' data-submit="https://script\.google\.com/macros/s/' + ph + r'/exec"', "", text)
    guard = (f"if(ENDPOINT.indexOf('{ph}')>=0)throw new Error('{cfg['country']} submissions are not open yet. "
             "Your entries remain here; please try again once submissions are enabled.');")
    text = text.replace("async function send(body){", "async function send(body){" + guard, 1)
    return text


def kind_of(path: str) -> str:
    if path.endswith((".js", ".gs")):
        return "js"
    if path.endswith(".html"):
        return "html"
    if path.endswith(".css"):
        return "css"
    return "other"


def generate(key: str, out: Path, groups=("dashboard", "admin", "pipeline"), passcode_file=None):
    cfg = load_country(key)
    if passcode_file:
        cfg["_previewPasscode"] = Path(passcode_file).read_text().strip()
        cp = Path(passcode_file).with_name(Path(passcode_file).name + "-collab")
        if cp.exists():
            cfg["_collabPasscode"] = cp.read_text().strip()
    files = []
    if "dashboard" in groups:
        files += DASHBOARD_FILES
    if "admin" in groups:
        files += ADMIN_FILES
    if "pipeline" in groups:
        files += PIPELINE_FILES
    report = {"country": key, "files": {}}
    for rel in files:
        src_path = ROOT / rel
        if not src_path.exists():
            report["files"][rel] = "MISSING in Tonga source"
            continue
        text = src_path.read_text()
        log = []
        k = kind_of(rel)
        text = specials(text, cfg, rel)
        if k in ("js", "html", "css") or rel.endswith(".py"):
            text = rewrite_geography(text, cfg, log, rel, "js" if rel.endswith(".py") else k)
        text = map_rewrite(text, cfg)
        text = gender(text, cfg)
        if k == "js":
            text = relabel_js(text, cfg)
        elif k == "html":
            text = relabel_html(text, cfg)
        text = rename(text, cfg, k)
        text = finish(text, cfg)
        text = submit_guard(text, cfg)
        if rel.endswith('refresh-tongan-master-file.yml') and cfg.get('masterLayout', 'governance') == 'governance':
            text = workflow_governance(text, cfg)
        dest = out / out_name(rel, cfg)
        dest.parent.mkdir(parents=True, exist_ok=True)
        dest.write_text(text)
        report["files"][out_name(rel, cfg)] = log
    if "pipeline" in groups:
        tpl = (KIT / "templates" / "rotate-passcode.yml").read_text()
        wf = out / ".github" / "workflows" / f"rotate-{key}-passcode.yml"
        wf.parent.mkdir(parents=True, exist_ok=True)
        wf.write_text(tpl.replace("__COUNTRY__", cfg["country"]).replace("__KEY__", cfg["KEY"]).replace("__key__", key))
    (out / f"_report-{key}.json").write_text(json.dumps(report, indent=1, ensure_ascii=False))
    return report


if __name__ == "__main__":
    ap = argparse.ArgumentParser()
    ap.add_argument("key")
    ap.add_argument("--out", default="/tmp/kit/out")
    ap.add_argument("--groups", default="dashboard,admin,pipeline")
    ap.add_argument("--passcode-file", help="preview passcode (file, never committed)")
    a = ap.parse_args()
    r = generate(a.key, Path(a.out) / a.key, tuple(a.groups.split(",")), a.passcode_file)
    for f, lg in r["files"].items():
        n = len(lg) if isinstance(lg, list) else lg
        print(f"{f}: {n}")
