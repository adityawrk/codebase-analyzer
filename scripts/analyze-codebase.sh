#!/usr/bin/env bash
# =============================================================================
# analyze-codebase.sh — One-liner codebase analysis runner
#
# Downloads the correct codebase-analyzer binary for the current platform,
# extracts it to a temp directory, and runs it against the specified repo.
#
# Usage:
#   ./analyze-codebase.sh <repo-path> [options]
#   ./analyze-codebase.sh .                        # Analyze current directory
#   ./analyze-codebase.sh . --format json           # JSON output
#   ./analyze-codebase.sh . > codebase_analysis.md  # Save report to file
#
# One-liner (download + run):
#   curl -sLo analyze-codebase.sh https://gist.githubusercontent.com/adityawrk/fbca749711e84d991358489ee7accecc/raw && \
#     chmod +x analyze-codebase.sh && ./analyze-codebase.sh . > codebase_analysis.md
#
# Environment variables:
#   CODEBASE_ANALYZER_VERSION  Override version (default: latest)
#   CODEBASE_ANALYZER_CACHE    Cache directory (default: ~/.cache/codebase-analyzer)
#
# All status output goes to stderr. Only the report goes to stdout.
# =============================================================================

set -euo pipefail

# ── Configuration ─────────────────────────────────────────────────────

DIST_REPO="adityawrk/codebase-analyzer-dist"
VERSION="${CODEBASE_ANALYZER_VERSION:-latest}"
CACHE_DIR="${CODEBASE_ANALYZER_CACHE:-$HOME/.cache/codebase-analyzer}"

# ── Helpers ───────────────────────────────────────────────────────────

info()  { echo "[codebase-analyzer] $*" >&2; }
error() { echo "[codebase-analyzer] ERROR: $*" >&2; exit 1; }

cleanup() {
  if [ -n "${TMPDIR_CREATED:-}" ] && [ -d "$TMPDIR_CREATED" ]; then
    rm -rf "$TMPDIR_CREATED"
  fi
}
trap cleanup EXIT

detect_platform() {
  local os arch
  os="$(uname -s | tr '[:upper:]' '[:lower:]')"
  arch="$(uname -m)"

  case "$os" in
    darwin) os="darwin" ;;
    linux)  os="linux" ;;
    *)      error "Unsupported OS: $os (supported: darwin, linux)" ;;
  esac

  case "$arch" in
    arm64|aarch64) arch="arm64" ;;
    x86_64|amd64)  arch="x86_64" ;;
    *)             error "Unsupported architecture: $arch (supported: arm64, x86_64)" ;;
  esac

  echo "${os}-${arch}"
}

check_dependencies() {
  for cmd in curl tar; do
    if ! command -v "$cmd" &>/dev/null; then
      error "Required dependency not found: $cmd"
    fi
  done

  # Check for gh CLI (needed for private repo releases) or warn
  if ! command -v gh &>/dev/null; then
    info "Note: 'gh' CLI not found. Using curl for downloads."
  fi
}

resolve_version() {
  if [ "$VERSION" = "latest" ]; then
    info "Resolving latest version..."
    VERSION=$(gh release view --repo "$DIST_REPO" --json tagName -q '.tagName' 2>/dev/null || true)
    if [ -z "$VERSION" ]; then
      # Fallback to curl if gh not available
      VERSION=$(curl -sI "https://github.com/${DIST_REPO}/releases/latest" \
        | grep -i '^location:' \
        | sed 's|.*/tag/||; s/[[:space:]]*$//' || true)
    fi
    if [ -z "$VERSION" ]; then
      error "Could not resolve latest version. Set CODEBASE_ANALYZER_VERSION explicitly."
    fi
    info "Latest version: $VERSION"
  fi
}

download_and_extract() {
  local platform="$1"
  local tarball_name="codebase-analyzer-${platform}.tar.gz"
  local cache_path="$CACHE_DIR/$VERSION/$tarball_name"

  # Check cache first
  if [ -f "$cache_path" ]; then
    info "Using cached binary ($VERSION, $platform)"
  else
    info "Downloading codebase-analyzer $VERSION for $platform..."
    mkdir -p "$CACHE_DIR/$VERSION"

    local download_url="https://github.com/${DIST_REPO}/releases/download/${VERSION}/${tarball_name}"

    if command -v gh &>/dev/null; then
      gh release download "$VERSION" \
        --repo "$DIST_REPO" \
        --pattern "$tarball_name" \
        --dir "$CACHE_DIR/$VERSION" \
        --clobber 2>/dev/null || {
          # Fallback to curl
          curl -sSfL "$download_url" -o "$cache_path" || \
            error "Download failed. Check version '$VERSION' and platform '$platform'."
        }
    else
      curl -sSfL "$download_url" -o "$cache_path" || \
        error "Download failed. Check version '$VERSION' and platform '$platform'."
    fi

    info "Downloaded $(du -h "$cache_path" | cut -f1 | tr -d ' ')"
  fi

  # Extract to temp directory
  TMPDIR_CREATED="$(mktemp -d)"
  info "Extracting to temp directory..."
  tar -xzf "$cache_path" -C "$TMPDIR_CREATED"

  # Strip macOS quarantine attribute (prevents Gatekeeper blocking)
  if [ "$(uname -s)" = "Darwin" ]; then
    xattr -dr com.apple.quarantine "$TMPDIR_CREATED" 2>/dev/null || true
  fi

  # Verify binary exists and is executable
  if [ ! -f "$TMPDIR_CREATED/codebase-analyzer" ]; then
    error "Extracted archive does not contain codebase-analyzer binary"
  fi
  chmod +x "$TMPDIR_CREATED/codebase-analyzer"
}

# ── Main ──────────────────────────────────────────────────────────────

if [ $# -lt 1 ] || [ "$1" = "-h" ] || [ "$1" = "--help" ]; then
  cat >&2 <<'USAGE'
Usage: analyze-codebase.sh <repo-path> [options]

Analyze a codebase and produce a static analysis report.

Arguments:
  <repo-path>     Path to the repository to analyze

Options (passed through to codebase-analyzer):
  -f, --format <format>     Output format: markdown or json (default: markdown)
  -o, --output <file>       Write report to file instead of stdout
  --rubric <path>           Path to custom rubric YAML
  --offline                 Skip external tool calls
  --timeout <ms>            Per-tool timeout in milliseconds (default: 60000)
  --include <patterns...>   Include glob patterns
  --exclude <patterns...>   Exclude glob patterns
  --follow-symlinks         Follow symlinks within repo root

Environment:
  CODEBASE_ANALYZER_VERSION   Override version (default: latest)
  CODEBASE_ANALYZER_CACHE     Cache dir (default: ~/.cache/codebase-analyzer)

Examples:
  ./analyze-codebase.sh .                             # Markdown to stdout
  ./analyze-codebase.sh . > codebase_analysis.md      # Save to file
  ./analyze-codebase.sh . --format json -o report.json
  ./analyze-codebase.sh /path/to/repo --offline
USAGE
  exit 0
fi

# Capture repo path and shift to remaining args
REPO_PATH="$1"
shift

check_dependencies

PLATFORM="$(detect_platform)"
info "Platform: $PLATFORM"

resolve_version
download_and_extract "$PLATFORM"

# Set up environment for the binary
export CODEBASE_ANALYZER_WASM_DIR="$TMPDIR_CREATED/wasm"
export CODEBASE_ANALYZER_DATA_DIR="$TMPDIR_CREATED/data"
RUBRIC_PATH="$TMPDIR_CREATED/rubric.yaml"

# Build the command — inject --rubric if the bundled rubric exists
# and the user hasn't specified their own
CMD=("$TMPDIR_CREATED/codebase-analyzer" "analyze" "$REPO_PATH")

USER_RUBRIC=false
for arg in "$@"; do
  if [ "$arg" = "--rubric" ]; then
    USER_RUBRIC=true
    break
  fi
done

if [ "$USER_RUBRIC" = false ] && [ -f "$RUBRIC_PATH" ]; then
  CMD+=("--rubric" "$RUBRIC_PATH")
fi

CMD+=("$@")

info "Running analysis..."
info ""

# Execute — report goes to stdout, status already on stderr
exec "${CMD[@]}"
