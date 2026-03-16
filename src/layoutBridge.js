const fs = require('fs');
const path = require('path');
const os = require('os');

const LAYOUT_DIR = path.join(os.homedir(), '.pixel-agents');
const LAYOUT_FILE = path.join(LAYOUT_DIR, 'layout.json');

function loadLayout() {
  try {
    if (fs.existsSync(LAYOUT_FILE)) {
      const content = fs.readFileSync(LAYOUT_FILE, 'utf-8');
      return JSON.parse(content);
    }
  } catch (err) {
    console.error('[LayoutBridge] Failed to load layout:', err.message);
  }
  return null;
}

function saveLayout(layout) {
  try {
    if (!fs.existsSync(LAYOUT_DIR)) {
      fs.mkdirSync(LAYOUT_DIR, { recursive: true });
    }
    fs.writeFileSync(LAYOUT_FILE, JSON.stringify(layout, null, 2));
  } catch (err) {
    console.error('[LayoutBridge] Failed to save layout:', err.message);
  }
}

module.exports = { loadLayout, saveLayout };
