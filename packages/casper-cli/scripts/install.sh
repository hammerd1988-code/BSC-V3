#!/usr/bin/env bash
set -euo pipefail

# One-liner installer for the Casper CLI standalone binary.
# Usage:
#   curl -fsSL https://raw.githubusercontent.com/hammerd1988-code/BSC-V3/main/packages/casper-cli/scripts/install.sh | bash
#   curl -fsSL .../install.sh | bash -s -- --install-dir ~/.local/bin

OWNER="hammerd1988-code"
REPO="BSC-V3"
TAG_PREFIX="casper-cli-"

show_help() {
  cat <<EOF
Usage: install.sh [OPTIONS]

Options:
  -d, --install-dir DIR   Install directory (default: ~/.local/bin)
  -v, --version VERSION   Specific version tag, e.g. casper-cli-v0.1.1
  -f, --force             Overwrite an existing binary
  -n, --no-path           Do not add the install directory to PATH
  -h, --help              Show this help
EOF
}

INSTALL_DIR=""
VERSION_TAG=""
FORCE=0
NO_PATH=0

while [[ $# -gt 0 ]]; do
  case "$1" in
    -d|--install-dir) INSTALL_DIR="$2"; shift 2 ;;
    -v|--version) VERSION_TAG="$2"; shift 2 ;;
    -f|--force) FORCE=1; shift ;;
    -n|--no-path) NO_PATH=1; shift ;;
    -h|--help) show_help; exit 0 ;;
    *) echo "Unknown option: $1" >&2; show_help >&2; exit 1 ;;
  esac
done

command -v curl >/dev/null 2>&1 || { echo "curl is required" >&2; exit 1; }

OS=$(uname -s)
ARCH=$(uname -m)

ASSET=""
case "$OS" in
  Linux)
    case "$ARCH" in
      x86_64) ASSET="casper-linux-x64" ;;
      aarch64|arm64) echo "Linux ARM64 is not yet released; using x64 via emulation may work but is unsupported." >&2; exit 1 ;;
      *) echo "Unsupported architecture: $ARCH" >&2; exit 1 ;;
    esac
    ;;
  Darwin)
    case "$ARCH" in
      x86_64) ASSET="casper-macos-x64" ;;
      arm64) ASSET="casper-macos-arm64" ;;
      *) echo "Unsupported architecture: $ARCH" >&2; exit 1 ;;
    esac
    ;;
  MINGW*|CYGWIN*|MSYS*)
    ASSET="casper-win-x64.exe"
    ;;
  *)
    echo "Unsupported OS: $OS" >&2
    exit 1
    ;;
esac

resolve_version() {
  if [[ -n "$VERSION_TAG" ]]; then
    echo "$VERSION_TAG"
    return
  fi

  # GitHub's releases.atom feed is not rate-limited, unlike the REST API.
  local feed
  feed=$(curl -fsSL "https://github.com/${OWNER}/${REPO}/releases.atom" 2>/dev/null) || {
    echo "Failed to fetch release feed" >&2
    exit 1
  }

  # Newest first. Pick the first title that starts with the Casper CLI prefix.
  local tag
  tag=$(printf '%s' "$feed" | sed -n "s|.*<title>${TAG_PREFIX}\([^<]*\)</title>.*|\1|p" | head -n1)
  if [[ -z "$tag" ]]; then
    echo "No Casper CLI release found" >&2
    exit 1
  fi
  echo "${TAG_PREFIX}${tag}"
}

TAG=$(resolve_version)
DOWNLOAD_URL="https://github.com/${OWNER}/${REPO}/releases/download/${TAG}/${ASSET}"

echo "Installing Casper CLI ${TAG} for ${OS} ${ARCH}..."

if [[ -z "$INSTALL_DIR" ]]; then
  INSTALL_DIR="${HOME}/.local/bin"
fi

mkdir -p "$INSTALL_DIR"

TARGET_NAME="casper"
if [[ "$ASSET" == *".exe" ]]; then
  TARGET_NAME="casper.exe"
fi

TARGET_PATH="${INSTALL_DIR}/${TARGET_NAME}"

if [[ -e "$TARGET_PATH" && "$FORCE" -ne 1 ]]; then
  echo "Casper is already installed at ${TARGET_PATH}" >&2
  echo "Run with --force to overwrite or --install-dir to choose a different directory." >&2
  exit 1
fi

TMP_FILE=$(mktemp)
trap 'rm -f "$TMP_FILE"' EXIT

echo "Downloading ${ASSET}..."
curl -fsSL --progress-bar "$DOWNLOAD_URL" -o "$TMP_FILE" || {
  echo "Download failed: ${DOWNLOAD_URL}" >&2
  exit 1
}

chmod +x "$TMP_FILE"
mv "$TMP_FILE" "$TARGET_PATH"

# Ensure the install directory is on PATH.
add_to_path() {
  local dir="$1"
  local added=0
  for rc in "$HOME/.bashrc" "$HOME/.zshrc" "$HOME/.profile"; do
    if [[ -f "$rc" ]] && ! grep -qF "export PATH=\"$dir:\$PATH\"" "$rc" 2>/dev/null; then
      echo "export PATH=\"$dir:\$PATH\"" >> "$rc"
      added=1
    fi
  done
  if [[ -d "$HOME/.config/fish" ]] && [[ ! -e "$HOME/.config/fish/config.fish" || ! $(grep -F "fish_add_path $dir" "$HOME/.config/fish/config.fish" 2>/dev/null) ]]; then
    echo "fish_add_path $dir" >> "$HOME/.config/fish/config.fish"
    added=1
  fi
  return $added
}

if [[ "$NO_PATH" -ne 1 ]]; then
  if ! add_to_path "$INSTALL_DIR"; then
    echo ""
    echo "Added ${INSTALL_DIR} to your PATH in shell config."
    echo "Open a new terminal or run:  source ~/.bashrc  (or ~/.zshrc)"
  fi
fi

if [[ ":${PATH}:" == *":${INSTALL_DIR}:"* ]]; then
  echo ""
  "$TARGET_PATH" --version
else
  echo ""
  echo "Casper installed to: ${TARGET_PATH}"
  echo "To use it now, either open a new terminal or add this to your PATH:"
  echo "  export PATH=\"${INSTALL_DIR}:\$PATH\""
fi
