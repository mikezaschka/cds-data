#!/usr/bin/env bash
# Install workspace dependencies from the committed lockfile (CDS 10).
set -euo pipefail

root="$(cd "$(dirname "$0")/.." && pwd)"
cd "$root"

npm ci --no-audit --no-fund
