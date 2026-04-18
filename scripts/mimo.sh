#!/usr/bin/env bash
# mimo.sh — thin CLI over the Xiaomi MiMo OpenAI-compatible API.
#
# Usage:
#   ./scripts/mimo.sh models               # list entitled models
#   ./scripts/mimo.sh chat "prompt"        # one-shot chat, prints reply to stdout
#   ./scripts/mimo.sh chat -m mimo-v2-pro "prompt"
#   echo "prompt" | ./scripts/mimo.sh chat -   # read prompt from stdin
#   ./scripts/mimo.sh stream "prompt"      # streamed reply (SSE)
#   ./scripts/mimo.sh explain <file>       # ask MiMo to explain a file
#   ./scripts/mimo.sh review <file>        # ask MiMo for a code review
#   ./scripts/mimo.sh ping                 # smoke test (expects PONG)
#   ./scripts/mimo.sh env                  # print loaded env (no secrets)
#
# Env resolution order: existing shell env > .env.local (auto-loaded).

set -euo pipefail

ROOT="$( cd "$( dirname "${BASH_SOURCE[0]}" )/.." && pwd )"
if [ -f "$ROOT/.env.local" ] && [ -z "${MIMO_API_KEY:-}" ]; then
  set -a; . "$ROOT/.env.local"; set +a
fi

: "${MIMO_API_KEY:?Set MIMO_API_KEY in .env.local}"
: "${MIMO_BASE_URL:=https://api.xiaomimimo.com/v1}"
: "${MIMO_DEFAULT_MODEL:=mimo-v2-flash}"

have_jq() { command -v jq >/dev/null 2>&1; }

# jq fallback via node (always available in this project).
pluck_ids() {
  if have_jq; then jq -r '.data[].id'; else node -e 'let d="";process.stdin.on("data",c=>d+=c).on("end",()=>{JSON.parse(d).data.forEach(m=>console.log(m.id))})'; fi
}
pluck_content() {
  if have_jq; then jq -r '.choices[0].message.content'; else node -e 'let d="";process.stdin.on("data",c=>d+=c).on("end",()=>{const p=JSON.parse(d);process.stdout.write(p.choices?.[0]?.message?.content||"")})'; fi
}
pluck_delta() {
  if have_jq; then jq -r '.choices[0].delta.content // empty'; else node -e 'let d="";process.stdin.on("data",c=>d+=c).on("end",()=>{try{process.stdout.write(JSON.parse(d).choices?.[0]?.delta?.content||"")}catch(_){}})'; fi
}

die() { echo "error: $*" >&2; exit 2; }

cmd="${1:-}"; shift || true

case "$cmd" in
  models)
    curl -fsS "$MIMO_BASE_URL/models" -H "api-key: $MIMO_API_KEY" | pluck_ids
    ;;

  env)
    echo "MIMO_BASE_URL=$MIMO_BASE_URL"
    echo "MIMO_DEFAULT_MODEL=$MIMO_DEFAULT_MODEL"
    echo "MIMO_API_KEY=***${MIMO_API_KEY: -6}  (${#MIMO_API_KEY} chars)"
    ;;

  ping)
    out=$(MIMO_API_KEY="$MIMO_API_KEY" "$0" chat "Reply with ONLY the word PONG.")
    [[ "$out" == *PONG* ]] || die "expected PONG, got: $out"
    echo "[mimo] ok ($MIMO_DEFAULT_MODEL)"
    ;;

  chat|stream)
    model="$MIMO_DEFAULT_MODEL"
    stream=false
    [ "$cmd" = "stream" ] && stream=true
    while [ $# -gt 0 ]; do
      case "$1" in
        -m|--model) model="$2"; shift 2 ;;
        --stream)   stream=true; shift ;;
        -) prompt=$(cat); shift ;;
        *) prompt="$1"; shift ;;
      esac
    done
    [ -z "${prompt:-}" ] && die "no prompt provided"

    body=$(node -e '
      const [m, p, s] = process.argv.slice(1);
      process.stdout.write(JSON.stringify({
        model: m,
        messages: [{ role: "user", content: p }],
        max_completion_tokens: 2048,
        stream: s === "true"
      }));
    ' "$model" "$prompt" "$stream")

    if $stream; then
      curl -fsS --no-buffer -X POST "$MIMO_BASE_URL/chat/completions" \
        -H "api-key: $MIMO_API_KEY" -H "content-type: application/json" \
        -d "$body" \
        | sed -u 's/^data: //' \
        | while IFS= read -r line; do
            [ -z "$line" ] && continue
            [ "$line" = "[DONE]" ] && break
            printf '%s' "$(printf '%s' "$line" | pluck_delta)"
          done
      echo
    else
      curl -fsS -X POST "$MIMO_BASE_URL/chat/completions" \
        -H "api-key: $MIMO_API_KEY" -H "content-type: application/json" \
        -d "$body" \
        | pluck_content
      echo
    fi
    ;;

  explain)
    file="${1:-}"; [ -f "$file" ] || die "file not found: $file"
    prompt="Explain what this code does, its key data flow, and any risks. File: $file
---
$(cat "$file")"
    exec "$0" chat - <<<"$prompt"
    ;;

  review)
    file="${1:-}"; [ -f "$file" ] || die "file not found: $file"
    prompt="Do a concise senior code review of this file. Call out bugs, security, and API-contract issues. Skip style nits. File: $file
---
$(cat "$file")"
    exec "$0" chat - <<<"$prompt"
    ;;

  -h|--help|help|"")
    sed -n '2,20p' "$0"
    ;;

  *) die "unknown command: $cmd (try: $0 help)" ;;
esac
