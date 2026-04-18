#!/usr/bin/env bash
# One-shot smoke test for Mimo. Exits 0 on a valid PONG, nonzero otherwise.
set -euo pipefail

ROOT="$( cd "$( dirname "${BASH_SOURCE[0]}" )/.." && pwd )"
# shellcheck disable=SC1091
. "$ROOT/scripts/mimo-env.sh" >/dev/null

: "${MIMO_BASE_URL:?MIMO_BASE_URL not set}"
: "${MIMO_API_KEY:?MIMO_API_KEY not set}"
MODEL="${MIMO_DEFAULT_MODEL:-mimo-v2-flash}"

resp=$(curl -sS -X POST "$MIMO_BASE_URL/chat/completions" \
  -H "api-key: $MIMO_API_KEY" \
  -H "content-type: application/json" \
  -d "{\"model\":\"$MODEL\",\"max_completion_tokens\":16,\"messages\":[{\"role\":\"user\",\"content\":\"Respond with ONLY the word PONG.\"}],\"stream\":false}")

text=$(node -e "process.stdout.write((JSON.parse(process.argv[1]).choices?.[0]?.message?.content||'').trim())" "$resp")
echo "[mimo] model=$MODEL reply='$text'"

case "$text" in
  *PONG*) exit 0 ;;
  *) echo "[mimo] unexpected reply" >&2; exit 1 ;;
esac
