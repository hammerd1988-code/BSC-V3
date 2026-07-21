#!/usr/bin/env bash
set -euo pipefail

# One-liner installer for the Casper CLI standalone binary.
# Usage:
#   curl -fsSL https://raw.githubusercontent.com/hammerd1988-code/BSC-V3/main/packages/casper-cli/scripts/install.sh | bash
#   curl -fsSL .../install.sh | bash -s -- --install-dir ~/.local/bin
#   curl -fsSL .../install.sh | bash -s -- --update        # upgrade in place

OWNER="hammerd1988-code"
REPO="BSC-V3"
TAG_PREFIX="casper-cli-v"

show_help() {
  cat <<EOF
Usage: install.sh [OPTIONS]

Options:
  -d, --install-dir DIR   Install directory (default: ~/.local/bin)
  -v, --version VERSION   Specific version tag, e.g. casper-cli-v0.2.0
  -f, --force             Overwrite an existing binary
  -u, --update            Upgrade an existing install in place (implies --force)
  -n, --no-path           Do not modify PATH; just print the export line
      --no-verify         Skip SHA-256 checksum verification (NOT recommended)
  -h, --help              Show this help
EOF
}

INSTALL_DIR=""
VERSION_TAG=""
FORCE=0
UPDATE=0
NO_PATH=0
NO_VERIFY=0

while [[ $# -gt 0 ]]; do
  case "$1" in
    -d|--install-dir) INSTALL_DIR="$2"; shift 2 ;;
    -v|--version) VERSION_TAG="$2"; shift 2 ;;
    -f|--force) FORCE=1; shift ;;
    -u|--update) UPDATE=1; FORCE=1; shift ;;
    -n|--no-path) NO_PATH=1; shift ;;
    --no-verify) NO_VERIFY=1; shift ;;
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
      aarch64|arm64) ASSET="casper-linux-arm64" ;;
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
    case "$ARCH" in
      aarch64|arm64) ASSET="casper-win-arm64.exe" ;;
      *) ASSET="casper-win-x64.exe" ;;
    esac
    ;;
  *)
    echo "Unsupported OS: $OS" >&2
    exit 1
    ;;
esac

resolve_version() {
  if [[ -n "$VERSION_TAG" ]]; then
    # Accept either "0.2.0" or "casper-cli-v0.2.0".
    if [[ "$VERSION_TAG" == ${TAG_PREFIX}* ]]; then
      echo "$VERSION_TAG"
    else
      echo "${TAG_PREFIX}${VERSION_TAG}"
    fi
    return
  fi

  # GitHub's releases.atom feed is not rate-limited, unlike the REST API.
  # Resolve by the *tag* embedded in each entry's release link, NOT the
  # human-editable release title (which can be renamed and break scraping).
  local feed
  feed=$(curl -fsSL "https://github.com/${OWNER}/${REPO}/releases.atom" 2>/dev/null) || {
    echo "Failed to fetch release feed" >&2
    exit 1
  }

  # Entries are newest-first; pick the first Casper CLI tag.
  local tag
  tag=$(printf '%s' "$feed" \
    | grep -oE "releases/tag/${TAG_PREFIX}[0-9][^\"<]*" \
    | sed "s#releases/tag/##" \
    | head -n1)
  if [[ -z "$tag" ]]; then
    echo "No Casper CLI release found" >&2
    exit 1
  fi
  echo "$tag"
}

sha256_of() {
  if command -v sha256sum >/dev/null 2>&1; then
    sha256sum "$1" | awk '{print $1}'
  elif command -v shasum >/dev/null 2>&1; then
    shasum -a 256 "$1" | awk '{print $1}'
  else
    echo ""
  fi
}

TAG=$(resolve_version)
BASE_URL="https://github.com/${OWNER}/${REPO}/releases/download/${TAG}"
DOWNLOAD_URL="${BASE_URL}/${ASSET}"

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
  CURRENT=""
  CURRENT=$("$TARGET_PATH" --version 2>/dev/null || true)
  if [[ -n "$CURRENT" ]]; then
    echo "Casper ${CURRENT} is already installed at ${TARGET_PATH}." >&2
  else
    echo "Casper is already installed at ${TARGET_PATH}." >&2
  fi
  echo "Run with --update to upgrade in place, --force to overwrite, or --install-dir to choose another directory." >&2
  exit 1
fi

TMP_DIR=$(mktemp -d)
TMP_FILE="${TMP_DIR}/${ASSET}"
trap 'rm -rf "$TMP_DIR"' EXIT

echo "Downloading ${ASSET}..."
curl -fsSL --progress-bar "$DOWNLOAD_URL" -o "$TMP_FILE" || {
  echo "Download failed: ${DOWNLOAD_URL}" >&2
  exit 1
}

# Verify integrity against the release SHA256SUMS manifest before installing.
if [[ "$NO_VERIFY" -eq 1 ]]; then
  echo "WARNING: skipping checksum verification (--no-verify)." >&2
else
  SUMS_FILE="${TMP_DIR}/SHA256SUMS"
  if curl -fsSL "${BASE_URL}/SHA256SUMS" -o "$SUMS_FILE" 2>/dev/null; then
    EXPECTED=$(grep -E "  ${ASSET}\$" "$SUMS_FILE" | awk '{print $1}' | head -n1)
    ACTUAL=$(sha256_of "$TMP_FILE")
    if [[ -z "$EXPECTED" ]]; then
      echo "Checksum for ${ASSET} not found in SHA256SUMS." >&2
      exit 1
    fi
    if [[ -z "$ACTUAL" ]]; then
      echo "No sha256 tool (sha256sum/shasum) available to verify the download." >&2
      echo "Re-run with --no-verify to bypass (not recommended), or install one." >&2
      exit 1
    fi
    if [[ "$EXPECTED" != "$ACTUAL" ]]; then
      echo "Checksum mismatch for ${ASSET}!" >&2
      echo "  expected: ${EXPECTED}" >&2
      echo "  actual:   ${ACTUAL}" >&2
      exit 1
    fi
    echo "Checksum OK (${ACTUAL})."
  else
    echo "WARNING: no SHA256SUMS published for ${TAG}; cannot verify integrity." >&2
    echo "         This release predates checksum manifests. Continuing." >&2
  fi
fi

chmod +x "$TMP_FILE"
mv "$TMP_FILE" "$TARGET_PATH"

# Add the install directory to PATH by editing only the active shell's rc file.
rc_file_for_shell() {
  local shell_name
  shell_name=$(basename "${SHELL:-}")
  case "$shell_name" in
    zsh)  echo "$HOME/.zshrc" ;;
    bash) if [[ -f "$HOME/.bashrc" ]]; then echo "$HOME/.bashrc"; else echo "$HOME/.profile"; fi ;;
    fish) echo "$HOME/.config/fish/config.fish" ;;
    *)    echo "" ;;
  esac
}

path_hint() {
  echo ""
  echo "Add ${INSTALL_DIR} to your PATH:"
  echo "  export PATH=\"${INSTALL_DIR}:\$PATH\""
}

if [[ ":${PATH}:" == *":${INSTALL_DIR}:"* ]]; then
  : # already on PATH
elif [[ "$NO_PATH" -eq 1 ]]; then
  path_hint
else
  RC=$(rc_file_for_shell)
  if [[ -z "$RC" ]]; then
    path_hint
  else
    mkdir -p "$(dirname "$RC")"
    if [[ "$RC" == *config.fish ]]; then
      LINE="fish_add_path ${INSTALL_DIR}"
    else
      LINE="export PATH=\"${INSTALL_DIR}:\$PATH\""
    fi
    if ! grep -qF "$LINE" "$RC" 2>/dev/null; then
      printf '\n%s\n' "$LINE" >> "$RC"
      echo ""
      echo "Added ${INSTALL_DIR} to your PATH in ${RC}."
      echo "Open a new terminal or run:  source ${RC}"
    fi
  fi
fi

echo ""
if [[ ":${PATH}:" == *":${INSTALL_DIR}:"* ]]; then
  "$TARGET_PATH" --version
else
  echo "Casper installed to: ${TARGET_PATH}"
fi
