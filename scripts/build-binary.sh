#!/usr/bin/env bash
# Build a distributable binary using bun build --compile.
#
# WASM files (tree-sitter runtime + grammars) cannot be embedded in the binary,
# so they are copied to a wasm/ directory alongside the output binary.
#
# Usage: ./scripts/build-binary.sh [--output <path>]
#   Default output: ./dist/codebase-analyzer

set -euo pipefail

OUTPUT="${1:-./dist/codebase-analyzer}"
OUTPUT_DIR="$(dirname "$OUTPUT")"
WASM_DIR="$OUTPUT_DIR/wasm"

echo "==> Building binary to $OUTPUT"

# 1. TypeScript compile check
echo "  [1/4] TypeScript compile check..."
bun run build

# 2. Compile the binary
echo "  [2/4] Compiling binary..."
mkdir -p "$OUTPUT_DIR"
bun build --compile --target=bun src/cli/index.ts --outfile "$OUTPUT"

# 3. Copy WASM files
echo "  [3/4] Copying WASM files..."
mkdir -p "$WASM_DIR"

# web-tree-sitter runtime WASM
WTS_DIR="$(dirname "$(bun -e "console.log(require.resolve('web-tree-sitter/package.json'))")")"
cp "$WTS_DIR/tree-sitter.wasm" "$WASM_DIR/"

# tree-sitter grammar WASM files
GRAMMAR_DIR="$(dirname "$(bun -e "console.log(require.resolve('tree-sitter-wasms/package.json'))")")/out"
for lang in typescript tsx javascript python go; do
  src="$GRAMMAR_DIR/tree-sitter-${lang}.wasm"
  if [ -f "$src" ]; then
    cp "$src" "$WASM_DIR/"
  else
    echo "    Warning: $src not found, skipping"
  fi
done

# 4. Summary
BINARY_SIZE=$(du -h "$OUTPUT" | cut -f1)
WASM_COUNT=$(find "$WASM_DIR" -name '*.wasm' | wc -l | tr -d ' ')

echo "  [4/4] Done!"
echo ""
echo "  Binary: $OUTPUT ($BINARY_SIZE)"
echo "  WASM files: $WASM_DIR/ ($WASM_COUNT files)"
echo ""
echo "  To run: $OUTPUT analyze /path/to/repo"
echo "  Note: WASM files must remain in the same directory as the binary."
