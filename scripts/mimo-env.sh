#!/usr/bin/env bash
# Source this file to get Mimo credentials in the current shell:
#   source ./scripts/mimo-env.sh
# Then `mimo-tui` or any OpenAI-compatible client pointed at
# $MIMO_BASE_URL with header `api-key: $MIMO_API_KEY` will work.

set -a
# Load .env.local from repo root.
ROOT="$( cd "$( dirname "${BASH_SOURCE[0]}" )/.." && pwd )"
if [ -f "$ROOT/.env.local" ]; then
  # shellcheck disable=SC1091
  . "$ROOT/.env.local"
fi
set +a

echo "[mimo] MIMO_BASE_URL=$MIMO_BASE_URL"
echo "[mimo] MIMO_DEFAULT_MODEL=${MIMO_DEFAULT_MODEL:-mimo-v2-flash}"
if [ -n "$MIMO_API_KEY" ]; then
  echo "[mimo] MIMO_API_KEY set (${#MIMO_API_KEY} chars)"
else
  echo "[mimo] MIMO_API_KEY NOT set — check .env.local"
fi
