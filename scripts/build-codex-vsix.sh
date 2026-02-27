#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
OUT_VSIX="${ROOT_DIR}/pixel-agents-codex-1.0.2.vsix"

cd "${ROOT_DIR}"
npm install

cd "${ROOT_DIR}/webview-ui"
npm install

cd "${ROOT_DIR}"
npx @vscode/vsce package -o "${OUT_VSIX}"
code --install-extension "${OUT_VSIX}" --force

echo "Installed: ${OUT_VSIX}"
