"""Unit tests for find_symptoms — real commit messages, false positives, and adversarial cases."""
import sys
sys.path.insert(0, '/home/user/workspace/vave-lab/scripts')
from verify_enc_freshness import find_symptoms

CASES = [
    # (message, should_match_boolean, description)

    # --- True positives: real data-change intents ---
    ("Panel C1 — rewire fiji-provinces to RNKFUZ6M collection", True, "C1 root by name"),
    ("Panel B3 — add FSM sub-collection QGHHHAAC", True, "B3 sub root by key"),
    ("B2 map — refresh 9XHGQJE6 children", True, "B2 root key"),
    ("Update Ba province key from 86N8KGIZ to 97DILJ4T", True, "generic Zotero child keys"),
    ("data: refresh scholar-profiles snapshot", True, "filename symptom"),
    ("Encrypt refreshed .enc for the province data", True, ".enc symptom"),
    ("Bump zoteroCollectionKey_publicationLocation for Rewa", True, "field name"),
    ("Update Rewa Province ARS78SQY child under RNKFUZ6M", True, "mixed named + generic"),
    ("Refresh iTaukei Zotero snapshot", False, "message says snapshot but no ZKey/file"),  # borderline

    # --- False positives to guard against (must NOT match) ---
    ("Fix B2 chart tooltip alignment", False, "panel name only, no keys"),
    ("Redesign B3 popup for others-lead-with-iTaukei-coauthor", False, "panel name only"),
    ("BUREBASAGA CONFEDERACY LABEL UPDATE", False, "ALL-CAPS English"),
    ("PROVINCE FILTER DROPDOWN COLLAPSE FIX", False, "ALL-CAPS English words"),
    ("Fix CONFEDERACY tooltip in fullscreen mode", False, "one ALL-CAPS English word"),
    ("Trim unused CSS from confederacy-chip block", False, "no symptoms"),
    ("chore: bump devDependency lockfile", False, "generic chore"),

    # --- Adversarial edge cases ---
    ("Adds new AUTHORSH filter (no, this is a bug)", False, "AUTHORSH is letters-only"),
    ("HISTOGRA is not a valid state name", False, "HISTOGRA is letters-only"),
    # `MAX86400` is a known accepted false positive — see the note in
    # verify_enc_freshness.py; developers can override with
    # VAVELAB_SKIP_ENC_CHECK=1 in that rare case.
    ("Test: PLACEHOL SUBLOCAT MAX86400 short", True, "letters+digits 8-char token — known FP, expected to match"),
    ("The 12345678 timestamp got embedded", False, "digits-only"),
    ("Commit fixes 86400000 second overflow", False, "digits-only"),
    ("See RNKFUZ6M in the docs but no change to it here", True, "message DOES name a data key; even doc changes about it should trigger"),

    # --- Ordinary work that must pass ---
    ("Fix B1 map fullscreen exit binding", False, "B1 only, no keys"),
    ("Improve popup styling and animation", False, "unrelated"),
    ("README: document install_hooks.sh setup", False, "README-only"),
]

failed = 0
for msg, expected, note in CASES:
    got = find_symptoms(msg)
    triggered = bool(got)
    ok = triggered == expected
    mark = 'ok  ' if ok else 'FAIL'
    print(f"{mark}  expected={str(expected):5}  got={str(triggered):5}  {note!r:65}  symptoms={got}")
    if not ok:
        failed += 1

print(f"\n{failed} failure(s)")
sys.exit(0 if failed == 0 else 1)
