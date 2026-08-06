#!/usr/bin/env bash
# Cloud Agent start: per-boot service reconciliation. Tolerates restarts, avoids
# duplicate processes, waits for readiness, and returns.
#
#   1. Neutralise the stale legacy-iptables FORWARD DROP that blocks Docker's
#      bridge networking in this nested VM.
#   2. Start the Docker daemon (fuse-overlayfs storage driver) if not running.
#   3. Bring up the local Supabase stack (Postgres + Auth + Storage + Realtime),
#      applying migrations on first init and reusing the volume thereafter.
set -euo pipefail

cd "$(dirname "$0")/.."

# --- 1. Fix Docker bridge networking ------------------------------------------
# Docker's working rules live in the nft backend, but a stale legacy-iptables
# FORWARD chain with policy DROP silently drops all inter-container traffic
# (e.g. the realtime container cannot reach Postgres). Clear the legacy filter.
sudo iptables-legacy -P FORWARD ACCEPT 2>/dev/null || true
sudo iptables-legacy -P INPUT ACCEPT 2>/dev/null || true
sudo iptables-legacy -P OUTPUT ACCEPT 2>/dev/null || true
sudo iptables-legacy -F 2>/dev/null || true

# --- 2. Docker daemon ---------------------------------------------------------
if ! sudo docker info >/dev/null 2>&1; then
  echo "[start] launching dockerd (fuse-overlayfs)"
  sudo rm -f /var/run/docker.pid 2>/dev/null || true
  sudo bash -c 'nohup dockerd --storage-driver=fuse-overlayfs >/var/log/dockerd.log 2>&1 &'
  for _ in $(seq 1 60); do
    sudo docker info >/dev/null 2>&1 && break
    sleep 2
  done
fi
if ! sudo docker info >/dev/null 2>&1; then
  echo "[start] ERROR: dockerd failed to start; see /var/log/dockerd.log" >&2
  exit 1
fi
# Let the non-root agent user talk to the daemon without sudo.
sudo chmod 666 /var/run/docker.sock 2>/dev/null || true
echo "[start] docker is up: $(docker --version)"

# --- 3. Local Supabase stack --------------------------------------------------
# config.toml interpolates these; real values are not needed for local dev.
export GOOGLE_OAUTH_CLIENT_ID="${GOOGLE_OAUTH_CLIENT_ID:-placeholder}"
export GOOGLE_OAUTH_CLIENT_SECRET="${GOOGLE_OAUTH_CLIENT_SECRET:-placeholder}"

echo "[start] starting local Supabase stack"
supabase start
supabase status || true

echo "[start] ready — run the app with: npx tsx --env-file=.env.local server.ts"
