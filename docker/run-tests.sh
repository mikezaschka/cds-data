#!/usr/bin/env bash
set -euo pipefail

npm run test -w cds-data-pipeline
npm run test -w cds-data-federation
npm run test -w cds-data-materialization
