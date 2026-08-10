#!/usr/bin/env bash
# Boot smoke test: proves that server.ts — the production entrypoint that
# `npm start` runs — actually starts and serves /api/health.
#
# Why this exists: typecheck, the test suite, and `vite build` all pass on a
# server that throws at import time, because none of them ever execute
# server.ts. `npm run build` only bundles the client. A malformed merge
# resolution shipped exactly that in August 2026 and main sat unbootable for
# hours with CI green on every other check.
#
# Hermetic by design: Supabase credentials are overridden with stubs so the
# boot never talks to a real database, regardless of what is in the caller's
# environment. Missing optional secrets degrade features with a warning;
# anything that kills the process or leaves /api/health unreachable fails
# this test.
#
# Run locally with: bash scripts/ci-smoke.sh
set -euo pipefail
cd "$(dirname "$0")/.."

PORT="${SMOKE_PORT:-3789}"
LOG="$(mktemp)"

# A stale server on this port would answer the health probe and mask a broken
# boot, so refuse to run rather than silently test the wrong process.
if curl -sf -m 2 "http://localhost:${PORT}/api/health" >/dev/null 2>&1; then
  echo "FAIL: something is already listening on port ${PORT} — stop it or set SMOKE_PORT" >&2
  exit 1
fi

export NODE_ENV=production
export PORT
export APP_URL="http://localhost:${PORT}"
export VITE_SUPABASE_URL="http://smoke-test.invalid"
export SUPABASE_URL="http://smoke-test.invalid"
export SUPABASE_SERVICE_ROLE_KEY="smoke-test-placeholder"
export SUPABASE_KEY="smoke-test-placeholder"

# setsid puts the server in its own process group so the trap can kill the
# whole tree — killing only $! would orphan the node process npx spawns.
setsid npx tsx server.ts >"$LOG" 2>&1 &
SERVER_PID=$!
trap 'kill -- "-$SERVER_PID" 2>/dev/null || true' EXIT

fail() {
  echo "FAIL: $1" >&2
  echo "---- server log ----" >&2
  cat "$LOG" >&2
  exit 1
}

for _ in $(seq 1 60); do
  if ! kill -0 "$SERVER_PID" 2>/dev/null; then
    fail "server process exited before /api/health responded"
  fi
  BODY="$(curl -sf -m 5 "http://localhost:${PORT}/api/health" || true)"
  if [ -n "$BODY" ]; then
    echo "$BODY"
    if ! grep -q '"status":"ok"' <<<"$BODY"; then
      fail "/api/health responded without status ok"
    fi
    # In CI this runs after `npm run build`, so also prove the production
    # server picked up the bundle. Locally without dist/ the server boots in
    # signaling-only mode and this assertion is skipped.
    if [ -d dist ] && ! grep -q '"frontendServed":true' <<<"$BODY"; then
      fail "dist/ exists but the server is not serving it"
    fi
    echo "PASS: server.ts booted and /api/health is healthy"
    exit 0
  fi
  sleep 1
done

fail "/api/health did not respond within 60s"
