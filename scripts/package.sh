#!/usr/bin/env bash
# Build a distributable, load-unpacked-ready zip of the Flip Lens extension.
#
# Usage: ./scripts/package.sh   (or: npm run package)
# Output: dist/flip-lens-<version>.zip
#
# The zip contains only the files Chrome needs at runtime. Unzip it and load the
# resulting folder via chrome://extensions -> Developer mode -> Load unpacked.
set -euo pipefail

cd "$(dirname "$0")/.."

VERSION=$(node -p "require('./manifest.json').version" 2>/dev/null || echo "0.0.0")
OUT_DIR="dist"
OUT_ZIP="${OUT_DIR}/flip-lens-${VERSION}.zip"

mkdir -p "${OUT_DIR}"
rm -f "${OUT_ZIP}"

zip -r "${OUT_ZIP}" \
  manifest.json \
  rules.json \
  src \
  icons \
  README.md \
  LICENSE \
  -x '*.DS_Store' >/dev/null

echo "Built ${OUT_ZIP}"
