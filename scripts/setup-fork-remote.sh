#!/bin/bash
set -euo pipefail
cd "$(dirname "$0")/.."

if git remote get-url origin &>/dev/null; then
  echo "origin already set: $(git remote get-url origin)"
else
  git remote add origin "https://github.com/HamzLDN/cockpit.git"
fi

git fetch origin 2>/dev/null || true
git push -u origin integrations
echo "Fork remote ready. Open PRs: upstream=cockpit-project/cockpit, origin=HamzLDN/cockpit"
