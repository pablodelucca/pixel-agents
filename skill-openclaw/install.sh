#!/usr/bin/env bash
# ─────────────────────────────────────────────────────────────
# Pixel Agents — OpenClaw skill installer
# ─────────────────────────────────────────────────────────────
# Installs the Pixel Agents skill into OpenClaw's workspace skills.
# Run once from the pixel-agents repo root:
#   bash skill-openclaw/install.sh

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
SKILLS_DIR="${HOME}/.openclaw/workspace/skills"
SKILL_NAME="pixel-agents"
TARGET="${SKILLS_DIR}/${SKILL_NAME}"

echo "🎮 Pixel Agents — OpenClaw skill installer"
echo ""

# 1. Create skills directory if it doesn't exist
if [ ! -d "${SKILLS_DIR}" ]; then
  echo "  Creating ${SKILLS_DIR}"
  mkdir -p "${SKILLS_DIR}"
fi

# 2. Copy skill files
echo "  Installing skill → ${TARGET}"
rm -rf "${TARGET}"
cp -r "${SCRIPT_DIR}/${SKILL_NAME}" "${TARGET}"

echo "  ✅ Skill installed: ${TARGET}/SKILL.md"
echo ""

# 3. Prompt for agentId
echo "  Your PA_AGENT_ID identifies your character in the office."
echo "  Press Enter to use hostname ($(hostname)) or type a custom ID:"
read -r PA_AGENT_ID_INPUT
PA_AGENT_ID="${PA_AGENT_ID_INPUT:-$(hostname)}"

echo ""
echo "  agentId = ${PA_AGENT_ID}"
echo ""

# 4. Print VS Code settings
echo "─────────────────────────────────────────────────────────────"
echo "  Add to your .vscode/settings.json (or VS Code User settings):"
echo ""
cat <<JSON
{
  "pixelAgents.source": "openclaw",
  "pixelAgents.openclaw.agentIdFilter": "${PA_AGENT_ID}"
}
JSON
echo ""
echo "─────────────────────────────────────────────────────────────"
echo ""

# 5. Print shell helper
echo "  Add this to your OpenClaw agent's startup script or session init:"
echo ""
cat <<BASH
export PA_AGENT_ID="${PA_AGENT_ID}"
pa() { printf '{"type":"pa","agentId":"'"${PA_AGENT_ID}"'",%s}\n' "\$1"; }
# Usage: pa '"event":"run_registered"'
BASH
echo ""

# 6. Verify OpenClaw can see the skill
if command -v openclaw &>/dev/null; then
  echo "  Verifying skill visibility:"
  openclaw skills list 2>/dev/null | grep -i "pixel" && echo "  ✅ Skill visible to OpenClaw" || echo "  ℹ️  Run: openclaw skills list | grep pixel-agents"
else
  echo "  ℹ️  openclaw CLI not found in PATH — install OpenClaw first."
fi

echo ""
echo "  🎮 Done! Reload VS Code and open the Pixel Agents panel."
echo "     Your character will appear when you start your next OpenClaw session."
