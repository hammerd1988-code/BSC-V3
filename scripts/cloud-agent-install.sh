#!/usr/bin/env bash
# Cloud Agent install: idempotent, one-time environment bootstrap.
#
# Prepares everything that can be baked into the environment snapshot: system
# packages (Docker + Supabase CLI), Node dependencies, and the local .env file.
# Per-boot service startup (Docker daemon + Supabase stack) lives in
# scripts/cloud-agent-start.sh instead.
set -euo pipefail

cd "$(dirname "$0")/.."
ROOT="$(pwd)"
echo "[install] repo root: $ROOT"

# --- 1. System packages: Docker engine + fuse-overlayfs + Supabase CLI ---------
if ! command -v docker >/dev/null 2>&1; then
  echo "[install] installing docker.io + fuse-overlayfs"
  sudo apt-get update -qq
  sudo DEBIAN_FRONTEND=noninteractive apt-get install -y -qq docker.io fuse-overlayfs uidmap
else
  echo "[install] docker already present: $(docker --version)"
fi

if ! command -v supabase >/dev/null 2>&1; then
  echo "[install] installing supabase CLI"
  arch="$(dpkg --print-architecture)"
  ver="$(curl -fsSL https://api.github.com/repos/supabase/cli/releases/latest \
        | grep -oP '"tag_name":\s*"v\K[^"]+' | head -1)"
  curl -fsSL -o /tmp/supabase.deb \
    "https://github.com/supabase/cli/releases/download/v${ver}/supabase_${ver}_linux_${arch}.deb"
  sudo dpkg -i /tmp/supabase.deb
else
  echo "[install] supabase CLI already present: $(supabase --version)"
fi

# --- 2. Node dependencies (root web app) --------------------------------------
echo "[install] installing root npm dependencies"
npm ci

# --- 3. Native mobile package (separate npm project; root vitest globs its tests)
if [ -f packages/casper-ssh-mobile/package.json ]; then
  echo "[install] installing casper-ssh-mobile dependencies"
  npm --prefix packages/casper-ssh-mobile ci \
    || npm --prefix packages/casper-ssh-mobile install
fi

# --- 4. Local dev env file wired to the local Supabase stack -------------------
if [ ! -f .env.local ]; then
  echo "[install] writing .env.local from scripts/cloud-agent.env.local"
  cp scripts/cloud-agent.env.local .env.local
else
  echo "[install] .env.local already present — leaving as-is"
fi

echo "[install] done"
