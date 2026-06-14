#!/usr/bin/env bash
set -euo pipefail

SOLAR_REPO="${SOLAR_REPO:-$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)}"
HARNESS_DIR="${HARNESS_DIR:-${SOLAR_REPO}/harness}"
cd "$HARNESS_DIR"

LIMIT="${WIKI_DISPATCH_LIMIT:-2}"

exec ./solar-harness.sh wiki knowledge-ingest run-pipeline \
  --discover \
  --discover-raw-limit "$LIMIT" \
  --discover-vault-limit "$LIMIT" \
  --json
