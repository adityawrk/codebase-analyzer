#!/usr/bin/env bash
# =============================================================================
# analyze-codebase.sh — One-liner codebase analysis runner
#
# Downloads the correct codebase-analyzer binary for the current platform,
# extracts it to a temp directory, and runs it against the specified repo.
#
# Usage:
#   ./analyze-codebase.sh <repo-path>                  # Saves to ~/
#   ./analyze-codebase.sh . -o ./report.md             # Custom output path
#   ./analyze-codebase.sh . --format json              # JSON to ~/
#
# One-liner (download + run):
#   curl -sLo analyze-codebase.sh https://gist.githubusercontent.com/adityawrk/fbca749711e84d991358489ee7accecc/raw && \
#     chmod +x analyze-codebase.sh && ./analyze-codebase.sh .
#
# Environment variables:
#   CODEBASE_ANALYZER_VERSION  Override version (default: latest)
#   CODEBASE_ANALYZER_CACHE    Cache directory (default: ~/.cache/codebase-analyzer)
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
Report is saved to your home directory by default.

Arguments:
  <repo-path>     Path to the repository to analyze

Options (passed through to codebase-analyzer):
  -f, --format <format>     Output format: markdown or json (default: markdown)
  -o, --output <file>       Custom output path (default: ~/<repo>_codebase_analysis.md)
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
  ./analyze-codebase.sh .                               # ~/myrepo_codebase_analysis.md
  ./analyze-codebase.sh /path/to/repo                   # ~/repo_codebase_analysis.md
  ./analyze-codebase.sh . -o ./report.md                # Custom output path
  ./analyze-codebase.sh . --format json                 # ~/myrepo_codebase_analysis.json
  ./analyze-codebase.sh . --offline
USAGE
  exit 0
fi

# Capture repo path and shift to remaining args
REPO_PATH="$1"
shift

# Resolve the repo name for the output filename
REPO_ABS_PATH="$(cd "$REPO_PATH" 2>/dev/null && pwd)" || error "Cannot access: $REPO_PATH"
REPO_NAME="$(basename "$REPO_ABS_PATH")"

# Determine output format and whether the user specified -o / --output
USER_OUTPUT=false
USER_FORMAT="markdown"
ARGS_COPY=("$@")
i=0
while [ $i -lt ${#ARGS_COPY[@]} ]; do
  arg="${ARGS_COPY[$i]}"
  case "$arg" in
    -o|--output)
      USER_OUTPUT=true
      ;;
    -f|--format)
      if [ $((i + 1)) -lt ${#ARGS_COPY[@]} ]; then
        USER_FORMAT="${ARGS_COPY[$((i + 1))]}"
      fi
      ;;
  esac
  i=$((i + 1))
done

# If user didn't specify -o, auto-generate output path in $HOME
if [ "$USER_OUTPUT" = false ]; then
  if [ "$USER_FORMAT" = "json" ]; then
    OUTPUT_EXT="json"
  else
    OUTPUT_EXT="md"
  fi
  OUTPUT_PATH="$HOME/${REPO_NAME}_codebase_analysis.${OUTPUT_EXT}"
fi

check_dependencies

PLATFORM="$(detect_platform)"
info "Platform: $PLATFORM"

# Show where the report will be saved
if [ "$USER_OUTPUT" = false ]; then
  info "Report will be saved to: $OUTPUT_PATH"
fi

resolve_version
download_and_extract "$PLATFORM"

# Set up environment for the binary
export CODEBASE_ANALYZER_WASM_DIR="$TMPDIR_CREATED/wasm"
export CODEBASE_ANALYZER_DATA_DIR="$TMPDIR_CREATED/data"
RUBRIC_PATH="$TMPDIR_CREATED/rubric.yaml"

# Build the command — inject --rubric if the bundled rubric exists
# and the user hasn't specified their own
CMD=("$TMPDIR_CREATED/codebase-analyzer" "analyze" "$REPO_ABS_PATH")

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

# Inject auto-generated output path if user didn't specify one
if [ "$USER_OUTPUT" = false ]; then
  CMD+=("--output" "$OUTPUT_PATH")
fi

CMD+=("$@")

info "Running analysis..."
info ""

# Execute the analyzer
"${CMD[@]}"
EXIT_CODE=$?

if [ $EXIT_CODE -eq 0 ] && [ "$USER_OUTPUT" = false ]; then
  info ""
  info "Done! Report saved to: $OUTPUT_PATH"
fi

exit $EXIT_CODE
