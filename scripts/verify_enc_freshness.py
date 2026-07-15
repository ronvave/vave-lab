#!/usr/bin/env python3
"""
Guardrail for .enc data files on push.

Two checks:

  1. Every .enc file changed in the range being pushed must decrypt cleanly
     with $VAVELAB_PASSCODE and parse as JSON. Prevents shipping a corrupted
     blob that would 500 the site for every visitor with a valid passcode.

  2. If any commit message in the push range mentions a data-file symptom
     (a filename under data/, a Zotero collection key, or a known JSON field
     name), then at least one .enc file must be present in the combined
     diff of that commit range. Prevents the specific bug we just hit:
     rebase conflict resolution silently dropped the .enc updates while
     keeping the JS + commit message that described them.

Invoked by .githooks/pre-push. Reads the push range from stdin as git
docs specify:
   <local-ref> <local-sha> <remote-ref> <remote-sha>

Exit 0 = allow push. Exit non-zero = block push (git prints stderr).
"""

from __future__ import annotations
import os, re, sys, json, subprocess
from pathlib import Path

REPO_ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(REPO_ROOT / "scripts"))

# Symptoms that indicate a commit *claims* to be a data change. Extend as
# new data files or key namespaces get added. Case-insensitive match on
# the raw commit message body.
DATA_SYMPTOMS = [
    r"\bdata/",
    r"\.enc\b",
    r"\.json\b",
    r"\.geojson\b",
    r"\bzoteroCollectionKey\w*",
    r"\bRNKFUZ6M\b",
    r"\bAREH32KK\b",
    r"\bV3HLPDPL\b",              # B3 root
    r"\b9XHGQJE6\b",              # B2 root
    r"\bfiji-provinces\b",
    r"\bscholar-profiles\b",
    r"\bitaukei-zotero-snapshot\b",
    r"\bscholar-insights\b",
    r"\bworld-universities\b",
    r"\bworkplace-coords\b",
    r"\buni-country-overrides\b",
    r"\bitaukei-graduate-studies\b",
]
SYMPTOM_RE = re.compile("|".join(DATA_SYMPTOMS), re.IGNORECASE)

# Commits older than this ref are already on the remote and out of our
# control; we only ever inspect the new commits being pushed.
ZERO = "0000000000000000000000000000000000000000"


def sh(*args: str) -> str:
    """Run a git command and return stdout, or empty on non-zero exit."""
    r = subprocess.run(
        args, cwd=REPO_ROOT, capture_output=True, text=True, check=False
    )
    return r.stdout if r.returncode == 0 else ""


def commits_in_range(local: str, remote: str) -> list[str]:
    """List commit SHAs being pushed (new locally, not yet on remote)."""
    if remote == ZERO:
        # Brand-new branch; limit to a sane recent window instead of
        # everything back to the root commit.
        out = sh("git", "rev-list", "-n", "50", local)
    else:
        out = sh("git", "rev-list", f"{remote}..{local}")
    return [line for line in out.strip().splitlines() if line]


def files_changed_in_range(local: str, remote: str) -> set[str]:
    if remote == ZERO:
        out = sh("git", "diff-tree", "--no-commit-id", "--name-only", "-r", local)
    else:
        out = sh("git", "diff", "--name-only", f"{remote}..{local}")
    return {line for line in out.strip().splitlines() if line}


def commit_message(sha: str) -> str:
    return sh("git", "log", "-1", "--format=%B", sha)


def decrypt_and_parse(enc_path: Path, passcode: str) -> None:
    """Raise on failure. Uses the repo's own decrypt module for parity."""
    from decrypt_data import decrypt_blob  # type: ignore

    blob = enc_path.read_bytes()
    plaintext = decrypt_blob(blob, passcode)
    json.loads(plaintext)


def check_enc_decryptable(files: set[str], passcode: str) -> list[str]:
    problems: list[str] = []
    for rel in sorted(files):
        if not rel.endswith(".enc"):
            continue
        p = REPO_ROOT / rel
        if not p.exists():
            # File deleted in the push range; nothing to decrypt.
            continue
        try:
            decrypt_and_parse(p, passcode)
        except Exception as exc:
            problems.append(f"  {rel}: {exc}")
    return problems


def check_message_matches_diff(
    commits: list[str], all_files: set[str]
) -> list[str]:
    """
    If any commit message in the range describes a data-file change, the
    combined diff must contain at least one .enc file.
    """
    any_enc = any(f.endswith(".enc") for f in all_files)
    if any_enc:
        return []

    hits: list[str] = []
    for sha in commits:
        msg = commit_message(sha)
        matches = SYMPTOM_RE.findall(msg)
        if matches:
            first_line = msg.strip().splitlines()[0] if msg.strip() else "(no message)"
            unique_terms = sorted({m.lower() for m in matches})
            hits.append(f"  {sha[:8]}  {first_line}\n            symptoms: {', '.join(unique_terms)}")
    return hits


def main() -> int:
    passcode = os.environ.get("VAVELAB_PASSCODE")

    exit_code = 0
    for raw in sys.stdin:
        parts = raw.strip().split()
        if len(parts) != 4:
            continue
        _local_ref, local_sha, _remote_ref, remote_sha = parts
        if local_sha == ZERO:
            # Deleting a remote branch; nothing to check.
            continue

        commits = commits_in_range(local_sha, remote_sha)
        if not commits:
            continue

        files = files_changed_in_range(local_sha, remote_sha)

        # Check 1: .enc integrity
        if passcode:
            problems = check_enc_decryptable(files, passcode)
            if problems:
                sys.stderr.write(
                    "\n[verify_enc_freshness] Encrypted files failed to "
                    "decrypt and parse as JSON:\n"
                )
                sys.stderr.write("\n".join(problems) + "\n")
                sys.stderr.write(
                    "\nRe-run scripts/encrypt_data.py after editing the "
                    "plaintext, and confirm the .enc file is staged.\n"
                )
                exit_code = 1
        else:
            sys.stderr.write(
                "\n[verify_enc_freshness] VAVELAB_PASSCODE not set; "
                "skipping .enc decrypt check. Export it if you want the "
                "stronger guarantee.\n"
            )

        # Check 2: commit-message vs. diff consistency
        hits = check_message_matches_diff(commits, files)
        if hits:
            sys.stderr.write(
                "\n[verify_enc_freshness] Commit message(s) describe a data "
                "change but no .enc file is in the diff. This is the "
                "rebase-drop failure mode. Re-encrypt and amend, or set "
                "VAVELAB_SKIP_ENC_CHECK=1 to override:\n\n"
            )
            sys.stderr.write("\n".join(hits) + "\n")
            exit_code = 1

    return exit_code


if __name__ == "__main__":
    if os.environ.get("VAVELAB_SKIP_ENC_CHECK") == "1":
        sys.stderr.write(
            "[verify_enc_freshness] VAVELAB_SKIP_ENC_CHECK=1 — skipping.\n"
        )
        sys.exit(0)
    sys.exit(main())
