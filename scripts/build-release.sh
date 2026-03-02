#!/usr/bin/env bash
# =============================================================================
# Build release tarballs for codebase-analyzer distribution.
#
# Produces platform-specific tarballs containing:
#   codebase-analyzer          (compiled bun binary)
#   wasm/tree-sitter.wasm      (web-tree-sitter runtime)
#   wasm/tree-sitter-*.wasm    (per-language grammar files)
#
# Usage:
#   ./scripts/build-release.sh                  # Build for current platform
#   ./scripts/build-release.sh --all            # Build for all supported platforms
#   ./scripts/build-release.sh --output-dir <d> # Custom output directory
#
# Output:
#   release/codebase-analyzer-<os>-<arch>.tar.gz
#
# After building, upload the tarballs to a GitHub release:
#   gh release create v0.1.0 release/*.tar.gz --title "v0.1.0" --notes "..."
#
# Then update the Homebrew formula with sha256 checksums:
#   shasum -a 256 release/*.tar.gz
# =============================================================================

set -euo pipefail

# ── Configuration ─────────────────────────────────────────────────────

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"

# Read version from package.json
VERSION=$(grep -o '"version": *"[^"]*"' "$PROJECT_ROOT/package.json" | head -1 | grep -o '"[^"]*"$' | tr -d '"')

RELEASE_DIR="$PROJECT_ROOT/release"
BUILD_ALL=false

# Languages whose tree-sitter WASM grammars we ship
GRAMMAR_LANGUAGES=(typescript tsx javascript python go)

# Bun cross-compilation targets (--target=bun-<os>-<arch>)
# See: https://bun.sh/docs/bundler/executables#cross-compile
SUPPORTED_TARGETS=(
  "darwin-arm64"
  "darwin-x86_64"
  "linux-arm64"
  "linux-x86_64"
)

# ── Argument parsing ──────────────────────────────────────────────────

while [[ $# -gt 0 ]]; do
  case "$1" in
    --all)
      BUILD_ALL=true
      shift
      ;;
    --output-dir)
      RELEASE_DIR="$2"
      shift 2
      ;;
    -h|--help)
      echo "Usage: $0 [--all] [--output-dir <dir>]"
      echo ""
      echo "Options:"
      echo "  --all            Build for all supported platforms (cross-compile)"
      echo "  --output-dir <d> Output directory (default: ./release/)"
      echo "  -h, --help       Show this help"
      exit 0
      ;;
    *)
      echo "Error: Unknown argument: $1"
      echo "Run $0 --help for usage."
      exit 1
      ;;
  esac
done

# ── Helpers ───────────────────────────────────────────────────────────

detect_platform() {
  local os arch
  os="$(uname -s | tr '[:upper:]' '[:lower:]')"
  arch="$(uname -m)"

  # Normalize OS name
  case "$os" in
    darwin) os="darwin" ;;
    linux)  os="linux" ;;
    *)
      echo "Error: Unsupported OS: $os"
      exit 1
      ;;
  esac

  # Normalize architecture name
  case "$arch" in
    arm64|aarch64) arch="arm64" ;;
    x86_64|amd64)  arch="x86_64" ;;
    *)
      echo "Error: Unsupported architecture: $arch"
      exit 1
      ;;
  esac

  echo "${os}-${arch}"
}

# Map our platform identifier to bun's --target flag value
bun_target_for() {
  local platform="$1"
  local os arch bun_arch

  os="${platform%-*}"
  arch="${platform##*-}"

  # Bun uses "x64" not "x86_64"
  case "$arch" in
    x86_64) bun_arch="x64" ;;
    arm64)  bun_arch="arm64" ;;
    *)      bun_arch="$arch" ;;
  esac

  echo "bun-${os}-${bun_arch}"
}

# ── Step 1: TypeScript compile check ──────────────────────────────────

echo "==> Release build for codebase-analyzer v${VERSION}"
echo ""
echo "  [1/5] TypeScript compile check..."
cd "$PROJECT_ROOT"
bun run build

# ── Step 2: Prepare WASM files (shared across all platforms) ──────────

echo "  [2/5] Collecting WASM files..."

WASM_STAGING="$RELEASE_DIR/.wasm-staging"
rm -rf "$WASM_STAGING"
mkdir -p "$WASM_STAGING"

# web-tree-sitter runtime WASM
WTS_DIR="$(dirname "$(cd "$PROJECT_ROOT" && bun -e "console.log(require.resolve('web-tree-sitter/package.json'))")")"
if [ -f "$WTS_DIR/tree-sitter.wasm" ]; then
  cp "$WTS_DIR/tree-sitter.wasm" "$WASM_STAGING/"
  echo "    + tree-sitter.wasm (runtime)"
else
  echo "Error: web-tree-sitter WASM not found at $WTS_DIR/tree-sitter.wasm"
  exit 1
fi

# Grammar WASM files from tree-sitter-wasms
GRAMMAR_DIR="$(dirname "$(cd "$PROJECT_ROOT" && bun -e "console.log(require.resolve('tree-sitter-wasms/package.json'))")")/out"
for lang in "${GRAMMAR_LANGUAGES[@]}"; do
  src="$GRAMMAR_DIR/tree-sitter-${lang}.wasm"
  if [ -f "$src" ]; then
    cp "$src" "$WASM_STAGING/"
    echo "    + tree-sitter-${lang}.wasm (grammar)"
  else
    echo "    ! Warning: tree-sitter-${lang}.wasm not found, skipping"
  fi
done

WASM_COUNT=$(find "$WASM_STAGING" -name '*.wasm' | wc -l | tr -d ' ')
echo "    Collected $WASM_COUNT WASM files"

# ── Step 3: Determine which platforms to build ────────────────────────

if [ "$BUILD_ALL" = true ]; then
  TARGETS=("${SUPPORTED_TARGETS[@]}")
  echo "  [3/5] Building for all platforms: ${TARGETS[*]}"
else
  CURRENT_PLATFORM="$(detect_platform)"
  TARGETS=("$CURRENT_PLATFORM")
  echo "  [3/5] Building for current platform: $CURRENT_PLATFORM"
fi

# ── Step 4: Compile binary and package for each target ────────────────

echo "  [4/5] Compiling and packaging..."

mkdir -p "$RELEASE_DIR"
ARTIFACTS=()

for target in "${TARGETS[@]}"; do
  echo ""
  echo "    --- $target ---"

  # Staging directory for this target's tarball contents
  STAGE_DIR="$RELEASE_DIR/.stage-${target}"
  rm -rf "$STAGE_DIR"
  mkdir -p "$STAGE_DIR/wasm"

  # Compile binary
  BINARY_PATH="$STAGE_DIR/codebase-analyzer"
  BUN_TARGET="$(bun_target_for "$target")"

  echo "    Compiling binary (target: $BUN_TARGET)..."
  bun build --compile --target="$BUN_TARGET" \
    "$PROJECT_ROOT/src/cli/index.ts" \
    --outfile "$BINARY_PATH"

  # Copy WASM files
  cp "$WASM_STAGING"/*.wasm "$STAGE_DIR/wasm/"

  # Create tarball
  TARBALL_NAME="codebase-analyzer-${target}.tar.gz"
  TARBALL_PATH="$RELEASE_DIR/$TARBALL_NAME"

  echo "    Packaging $TARBALL_NAME..."
  tar -czf "$TARBALL_PATH" -C "$STAGE_DIR" codebase-analyzer wasm/

  # Record artifact info
  BINARY_SIZE=$(du -h "$BINARY_PATH" | cut -f1)
  TARBALL_SIZE=$(du -h "$TARBALL_PATH" | cut -f1)
  ARTIFACTS+=("$TARBALL_PATH")

  echo "    Binary: $BINARY_SIZE | Tarball: $TARBALL_SIZE"

  # Clean up staging
  rm -rf "$STAGE_DIR"
done

# ── Step 5: Summary ──────────────────────────────────────────────────

# Clean up WASM staging
rm -rf "$WASM_STAGING"

echo ""
echo "  [5/5] Done! Release artifacts:"
echo ""

for artifact in "${ARTIFACTS[@]}"; do
  SIZE=$(du -h "$artifact" | cut -f1)
  SHA=$(shasum -a 256 "$artifact" | cut -d' ' -f1)
  NAME=$(basename "$artifact")
  echo "    $NAME"
  echo "      Size:   $SIZE"
  echo "      SHA256: $SHA"
  echo ""
done

echo "  Next steps:"
echo "    1. Create a GitHub release:"
echo "       gh release create v${VERSION} ${RELEASE_DIR}/*.tar.gz \\"
echo "         --title \"v${VERSION}\" --notes \"Release notes here\""
echo ""
echo "    2. Update the Homebrew formula (pkg/homebrew/codebase-analyzer.rb)"
echo "       with the SHA256 values printed above."
echo ""
echo "    3. Push the updated formula to your homebrew-tap repo."
