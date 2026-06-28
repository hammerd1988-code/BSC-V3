#!/bin/sh
# Casper CLI installer — https://bloodsweatcode.org/install.sh
#
#   curl -fsSL https://bloodsweatcode.org/install.sh | sh
#
# Detects your OS + CPU architecture, downloads the matching standalone binary
# from the latest casper-cli GitHub release, and installs it to a bin directory
# on your PATH. No Node.js required.
#
# Environment overrides:
#   CASPER_INSTALL_DIR   target directory (default: $HOME/.local/bin)
#   CASPER_VERSION       release tag to install (default: latest casper-cli-v*)
set -eu

REPO="hammerd1988-code/BSC-V3"
INSTALL_DIR="${CASPER_INSTALL_DIR:-$HOME/.local/bin}"

red()   { printf '\033[31m%s\033[0m\n' "$1" >&2; }
green() { printf '\033[32m%s\033[0m\n' "$1"; }
info()  { printf '\033[36m%s\033[0m\n' "$1"; }

fail() { red "✗ $1"; exit 1; }

command -v curl >/dev/null 2>&1 || fail "curl is required but was not found."

# ── Detect platform ──────────────────────────────────────────────────────────
os="$(uname -s)"
arch="$(uname -m)"

case "$os" in
  Linux)  os_name="linux" ;;
  Darwin) os_name="macos" ;;
  *) fail "Unsupported OS '$os'. Windows users: run the PowerShell installer instead:
    irm https://bloodsweatcode.org/install.ps1 | iex" ;;
esac

case "$arch" in
  x86_64|amd64)  arch_name="x64" ;;
  arm64|aarch64) arch_name="arm64" ;;
  *) fail "Unsupported CPU architecture '$arch'." ;;
esac

asset="casper-${os_name}-${arch_name}"

# Only macOS ships both x64 and arm64 builds; Linux is x64-only for now.
if [ "$os_name" = "linux" ] && [ "$arch_name" = "arm64" ]; then
  fail "No prebuilt Linux arm64 binary yet. Install from source: npm i -g @bsc/casper-cli"
fi

# ── Resolve the release tag ──────────────────────────────────────────────────
if [ -n "${CASPER_VERSION:-}" ]; then
  tag="$CASPER_VERSION"
else
  info "Finding the latest Casper CLI release…"
  tag="$(curl -fsSL "https://api.github.com/repos/${REPO}/releases" \
    | grep '"tag_name"' \
    | grep 'casper-cli-v' \
    | head -n 1 \
    | sed -E 's/.*"tag_name": *"([^"]+)".*/\1/')"
  [ -n "$tag" ] || fail "Could not determine the latest casper-cli release tag."
fi

base="https://github.com/${REPO}/releases/download/${tag}"
info "Downloading ${asset} (${tag})…"

tmp="$(mktemp)"
trap 'rm -f "$tmp"' EXIT

# Prefer the per-platform asset; fall back to the legacy unsuffixed name that
# older releases shipped (single "casper" binary) so this keeps working today.
if ! curl -fSL --progress-bar "${base}/${asset}" -o "$tmp" 2>/dev/null; then
  info "Per-platform asset not on ${tag}; trying legacy 'casper'…"
  curl -fSL --progress-bar "${base}/casper" -o "$tmp" \
    || fail "Download failed. No '${asset}' or 'casper' asset on ${tag}."
fi

# Guard against a captive-portal / HTML error page being saved as the binary.
if head -c 16 "$tmp" | grep -qi '<!doctype\|<html'; then
  fail "Server returned an HTML page instead of a binary. The release asset '${asset}' may be missing for ${tag}."
fi

# ── Install ──────────────────────────────────────────────────────────────────
mkdir -p "$INSTALL_DIR"
dest="$INSTALL_DIR/casper"
mv "$tmp" "$dest"
trap - EXIT
chmod +x "$dest"

# macOS Gatekeeper quarantines unsigned downloads — clear it so it runs.
if [ "$os_name" = "macos" ]; then
  xattr -d com.apple.quarantine "$dest" >/dev/null 2>&1 || true
fi

green "✓ Installed casper → $dest"

# ── PATH hint ────────────────────────────────────────────────────────────────
case ":$PATH:" in
  *":$INSTALL_DIR:"*) ;;
  *)
    info ""
    info "⚠ $INSTALL_DIR is not on your PATH. Add it:"
    info "    export PATH=\"$INSTALL_DIR:\$PATH\""
    info "  (append that line to ~/.bashrc, ~/.zshrc, or ~/.profile)"
    ;;
esac

info ""
green "Run 'casper auth login' to link this machine, then 'casper --help'."
