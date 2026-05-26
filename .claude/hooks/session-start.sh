#!/bin/bash
set -euo pipefail

# Cloud sessions start from a fresh clone, so repo-local git config is
# reset every time. Re-apply the repo owner's identity so commits made
# by Claude Code are attributed to them rather than the default
# "Claude <noreply@anthropic.com>". Repo-local (--local) only — never
# touches the user's global git config. Idempotent.
if git -C "${CLAUDE_PROJECT_DIR:-.}" rev-parse --git-dir >/dev/null 2>&1; then
  git -C "${CLAUDE_PROJECT_DIR:-.}" config --local user.name "Connor White"
  git -C "${CLAUDE_PROJECT_DIR:-.}" config --local user.email "connorwhitepdx@gmail.com"
fi
