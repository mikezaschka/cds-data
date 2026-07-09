#!/usr/bin/env bash
# Install workspace dependencies pinned to CDS 9 + @cap-js/sqlite 2.x.
# Used inside the CDS 9 Docker image; do not run on a CDS 10 dev tree you
# intend to keep — it rewrites root package.json and drops the lockfile.
set -euo pipefail

root="$(cd "$(dirname "$0")/.." && pwd)"
cd "$root"

npm pkg set devDependencies.@sap/cds='^9' devDependencies.@cap-js/sqlite='^2'
npm pkg set overrides='{"@sap/cds":"^9","@cap-js/sqlite":"^2"}' --json
rm -f package-lock.json
npm install --no-audit --no-fund
