#!/usr/bin/env bash
# One-time setup for the repo-tracked git hooks. Run after a fresh clone.
# Idempotent — safe to re-run.
set -euo pipefail

REPO_ROOT="$(git rev-parse --show-toplevel)"
cd "$REPO_ROOT"

git config core.hooksPath .githooks
chmod +x .githooks/pre-push .githooks/pre-commit

echo "Hooks path set to .githooks/ and pre-push + pre-commit made executable."
echo "Export VAVELAB_PASSCODE in your shell if you want the pre-push"
echo "hook to decrypt .enc files and confirm they parse as JSON."
