#!/usr/bin/env python3
"""Fail closed when a published dashboard has been truncated or replaced.

The validator can inspect the working tree, the Git index (``--staged``), or
an arbitrary Git revision (``--revision``).  When ``--base`` is supplied it
also rejects unexpectedly large reductions in file size or line count.
"""

from __future__ import annotations

import argparse
import subprocess
import sys
from dataclasses import dataclass
from pathlib import Path


REPO_ROOT = Path(__file__).resolve().parents[1]


@dataclass(frozen=True)
class DashboardRule:
    path: str
    min_bytes: int
    min_lines: int
    required: tuple[str, ...]


RULES = (
    DashboardRule(
        path="itaukei-research-database-master.html",
        min_bytes=200_000,
        min_lines=4_000,
        required=(
            "<!DOCTYPE html>",
            '<html lang="en">',
            "<head>",
            "<body>",
            "js/itaukei-database-master.js",
            "</body>",
            "</html>",
        ),
    ),
)

FORBIDDEN = (
    "Warning: truncated output",
    "Total output lines:",
    "tokens truncated",
    "original token count:",
)


def git_bytes(spec: str) -> bytes:
    completed = subprocess.run(
        ["git", "show", spec],
        cwd=REPO_ROOT,
        stdout=subprocess.PIPE,
        stderr=subprocess.PIPE,
        check=False,
    )
    if completed.returncode:
        message = completed.stderr.decode("utf-8", "replace").strip()
        raise RuntimeError(message or f"unable to read {spec}")
    return completed.stdout


def load_content(path: str, *, staged: bool, revision: str | None) -> bytes:
    if staged:
        return git_bytes(f":{path}")
    if revision:
        return git_bytes(f"{revision}:{path}")
    return (REPO_ROOT / path).read_bytes()


def load_base(path: str, base: str | None) -> bytes | None:
    if not base or set(base) == {"0"}:
        return None
    try:
        return git_bytes(f"{base}:{path}")
    except RuntimeError:
        # A newly introduced dashboard has no base blob; structural checks
        # still apply, so absence in the base is not itself an error.
        return None


def validate(rule: DashboardRule, content: bytes, base: bytes | None) -> list[str]:
    errors: list[str] = []
    text = content.decode("utf-8", "replace")
    line_count = len(text.splitlines())
    byte_count = len(content)

    if byte_count < rule.min_bytes:
        errors.append(f"only {byte_count:,} bytes; minimum is {rule.min_bytes:,}")
    if line_count < rule.min_lines:
        errors.append(f"only {line_count:,} lines; minimum is {rule.min_lines:,}")

    for marker in FORBIDDEN:
        if marker.casefold() in text.casefold():
            errors.append(f"contains forbidden diagnostic text: {marker!r}")

    for token in rule.required:
        if token not in text:
            errors.append(f"missing required structure: {token!r}")

    if base:
        base_text = base.decode("utf-8", "replace")
        base_lines = len(base_text.splitlines())
        if len(content) < len(base) * 0.70:
            errors.append(
                f"byte size fell by more than 30% ({len(base):,} -> {byte_count:,})"
            )
        if line_count < base_lines * 0.70:
            errors.append(
                f"line count fell by more than 30% ({base_lines:,} -> {line_count:,})"
            )
    return errors


def main() -> int:
    parser = argparse.ArgumentParser()
    source = parser.add_mutually_exclusive_group()
    source.add_argument("--staged", action="store_true")
    source.add_argument("--revision")
    parser.add_argument("--base", help="optional Git revision used for shrinkage checks")
    args = parser.parse_args()

    failures: list[str] = []
    for rule in RULES:
        try:
            content = load_content(rule.path, staged=args.staged, revision=args.revision)
        except (OSError, RuntimeError) as exc:
            failures.append(f"{rule.path}: cannot be read: {exc}")
            continue
        base = load_base(rule.path, args.base)
        failures.extend(f"{rule.path}: {error}" for error in validate(rule, content, base))

    if failures:
        print("DASHBOARD INTEGRITY CHECK FAILED", file=sys.stderr)
        for failure in failures:
            print(f"  - {failure}", file=sys.stderr)
        print("Commit/push/deployment blocked to protect the live site.", file=sys.stderr)
        return 1

    print("Dashboard integrity check passed.")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
