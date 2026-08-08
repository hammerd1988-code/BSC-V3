#!/usr/bin/env bash
# Runtime checks for the HTTP-layer fixes on this branch. Expects a production
# build (`npm run build`) and a running server on $BASE (default :3001).
#
# Not part of CI — the equivalent assertions live in serverHttp.test.ts. This
# script exists to confirm the real Express middleware chain behaves the way
# those unit tests describe.
set -uo pipefail

BASE="${BASE:-http://127.0.0.1:3001}"
pass=0
fail=0

check() {
  local label="$1" expected="$2" actual="$3"
  if [[ "$actual" == *"$expected"* ]]; then
    printf '  PASS  %-58s %s\n' "$label" "$actual"
    pass=$((pass + 1))
  else
    printf '  FAIL  %-58s got %-28s want %s\n' "$label" "$actual" "$expected"
    fail=$((fail + 1))
  fi
}

header_of() { curl -sS -D - -o /dev/null --max-time 10 "$BASE$1" 2>/dev/null | tr -d '\r' | grep -i "^$2:" | head -1 | cut -d' ' -f2-; }

echo "== Cache-Control: only content-hashed bundles may be immutable =="
hashed=$(ls dist/assets/*.js 2>/dev/null | head -1 | xargs -r basename)
if [[ -n "$hashed" ]]; then
  check "assets/$hashed" "immutable" "$(header_of "/assets/$hashed" Cache-Control)"
fi
check "/sw.js (service worker)"        "no-cache"        "$(header_of /sw.js Cache-Control)"
check "/index.html (SPA shell)"        "no-cache"        "$(header_of / Cache-Control)"
check "/manifest.json (unhashed)"      "must-revalidate" "$(header_of /manifest.json Cache-Control)"
check "/offline.html (unhashed)"       "must-revalidate" "$(header_of /offline.html Cache-Control)"
check "/icons/icon-192x192.png"        "must-revalidate" "$(header_of /icons/icon-192x192.png Cache-Control)"

echo
echo "== JSON body limits: per-route ceilings, JSON-shaped 413 =="
# 2MB of JSON: over the 1mb default, under the 12mb large-route ceiling.
python3 -c "import json,sys; sys.stdout.write(json.dumps({'contentBase64':'A'*2_000_000}))" > /tmp/body-2mb.json

small_route_status=$(curl -sS -o /tmp/small.out -w '%{http_code}' --max-time 20 \
  -H 'Content-Type: application/json' --data-binary @/tmp/body-2mb.json \
  "$BASE/api/ai/generate-text")
check "2MB to /api/ai/generate-text rejected" "413" "$small_route_status"
check "  ...and the 413 body is JSON" '"success":false' "$(tr -d '\n' < /tmp/small.out | head -c 200)"

# The relay route must let a 2MB body reach the handler, which then rejects it
# for missing auth (401) rather than for size (413).
relay_status=$(curl -sS -o /tmp/relay.out -w '%{http_code}' --max-time 20 \
  -H 'Content-Type: application/json' --data-binary @/tmp/body-2mb.json \
  "$BASE/api/casper/relay/file")
if [[ "$relay_status" == "413" ]]; then
  printf '  FAIL  %-58s got 413 (body limit still blocks relay uploads)\n' "2MB to /api/casper/relay/file passes the body limit"
  fail=$((fail + 1))
else
  printf '  PASS  %-58s %s (reached the handler, not a size rejection)\n' "2MB to /api/casper/relay/file passes the body limit" "$relay_status"
  pass=$((pass + 1))
fi

echo
echo "== Malformed JSON =="
bad_status=$(curl -sS -o /tmp/bad.out -w '%{http_code}' --max-time 20 \
  -H 'Content-Type: application/json' --data-binary '{"nope"' "$BASE/api/ai/generate-text")
check "malformed JSON body" "400" "$bad_status"
check "  ...and that 400 is JSON too" '"success":false' "$(tr -d '\n' < /tmp/bad.out | head -c 200)"

echo
echo "== Health =="
check "/api/health" '"status"' "$(curl -sS --max-time 10 "$BASE/api/health" | head -c 400)"

echo
echo "$pass passed, $fail failed"
[[ "$fail" -eq 0 ]]
