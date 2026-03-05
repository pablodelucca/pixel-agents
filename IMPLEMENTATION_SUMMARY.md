# Pixel Agents: Editor Area Integration Implementation

## ✅ Implementation Complete

The Pixel Agents extension has been successfully updated to support opening in the VS Code editor area as full-screen tabs, in addition to the existing sidebar panel view. Users can now open the pixel agents office as they would a terminal or editor file.

---

## What Changed

### 1. **Core Architecture Changes**

#### `src/constants.ts`
- Added new command IDs:
  - `COMMAND_OPEN_EDITOR_TAB` = `'pixel-agents.openEditorTab'`
  - `WEBVIEW_PANEL_TYPE` = `'pixel-agents-editor'`
  - `WEBVIEW_PANEL_TITLE` = `'Pixel Agents'`

#### `src/extension.ts`
- Registered new command `COMMAND_OPEN_EDITOR_TAB` 
- Command handler calls `provider.openEditorTab()`
- All existing functionality preserved (backward compatible)

#### `src/PixelAgentsViewProvider.ts` (Major Refactor)
Added multi-webview support:
```typescript
// Track multiple editor tabs
editorWebviews = new Map<string, vscode.WebviewPanel>()
activeWebviewId: string | undefined

// New methods
getActiveWebview(): vscode.Webview | undefined
broadcastToWebviews(message: Record<string, unknown>): void
handleWebviewMessage(message: Record<string, unknown>): Promise<void>
openEditorTab(): void
setupTerminalEventListeners(): void
```

**Key Improvements:**
- ✅ Single shared `agents` Map across all webviews (sidebar + editor tabs)
- ✅ Terminal event listeners registered once globally
- ✅ All webviews receive real-time agent state updates
- ✅ Message routing broadcasts to all connected webviews
- ✅ Proper cleanup when editor tabs are closed
- ✅ Focus management between sidebar and editor tabs

#### `package.json`
- Added new command to contributes:
  ```json
  {
    "command": "pixel-agents.openEditorTab",
    "title": "Pixel Agents: Open in Editor Area"
  }
  ```

#### `webview-ui/src/components/BottomToolbar.tsx`
- Added "⊡ Tab" button to open the office in an editor tab
- Button sends message `{ type: 'openEditorTab' }` to extension
- Integrated seamlessly with existing toolbar layout

---

## How It Works

### User Workflow

1. **Open in Editor Tab (New)**
   - Click "⊡ Tab" button in the Pixel Agents sidebar/panel
   - OR run command: `Pixel Agents: Open in Editor Area`
   - A new editor tab labeled "Pixel Agents" opens with the full office view
   - Multiple tabs can be opened simultaneously

2. **Existing Sidebar View (Still Works)**
   - Sidebar panel remains available and functional
   - Users can still access the office from the sidebar
   - Both views are always synced

3. **Agent Management (Unified)**
   - Agents run in terminals and appear in **all open views** (sidebar + editor tabs)
   - Opening an agent terminal updates **all webviews** in real-time
   - Each webview maintains its own camera position and selection state
   - Closing a terminal clears it from all views

### Message Flow

```
Extension (Backend)
    ↓ Single Provider Instance
┌───────────────────────────────────┐
│  Shared Agent State + Timers      │
│  (agents Map, file watchers, etc)│
└───────────────────────────────────┘
    ↓↓ Broadcast Messages
    ├─→ Sidebar WebviewView
    ├─→ Editor Tab 1 (WebviewPanel)
    └─→ Editor Tab 2 (WebviewPanel)
    
    ↑↑ Receive from all
    ├─← Sidebar messages
    ├─← Tab 1 messages
    └─← Tab 2 messages
```

---

## Technical Details

### Multi-Webview Management

**Editor Tab Creation** (`openEditorTab()`)
```typescript
const tabId = `pixel-agents-${++this.panelIdCounter}`
const panel = vscode.window.createWebviewPanel(
  WEBVIEW_PANEL_TYPE,
  WEBVIEW_PANEL_TITLE,
  vscode.ViewColumn.Active,
  { enableScripts: true, retainContextWhenHidden: true }
)
```

**Broadcasting** (`broadcastToWebviews()`)
- Sends message to sidebar (if exists)
- Sends message to all editor tabs in `editorWebviews` Map
- Used for agent creation, tool updates, layout changes, etc.

**Cleanup** 
- `panel.onDidDispose()` removes tab from tracking
- `panel.onDidChangeViewState()` updates active webview
- All timers and file watchers stay at provider level (shared)

### State Synchronization

All critical state changes trigger broadcasts:
- ✅ Agent creation/termination
- ✅ Terminal focus changes
- ✅ Tool state updates (start/done/clear)
- ✅ Layout changes (external sync, import/export)
- ✅ Asset loading (sprites, tiles, furniture)
- ✅ Settings changes (sound toggle)

### Backward Compatibility

✅ **100% Compatible** — All existing functionality preserved
- Sidebar view works exactly as before
- Commands `pixel-agents.showPanel` and `pixel-agents.exportDefaultLayout` unchanged
- No breaking changes to data structures or APIs
- Users who never open editor tabs won't notice any difference

---

## Features

### What Works Now

| Feature | Before | After |
|---------|--------|-------|
| **View Locations** | Sidebar only | Sidebar + Editor tabs |
| **Simultaneous Views** | 1 (sidebar) | N (multiple editor tabs) |
| **Agent Sync** | Sidebar updates | All views update |
| **Focus Management** | N/A | Active webview tracking |
| **Terminal Events** | Single webview | All webviews |
| **Layout Persistence** | Works | Works (shared) |
| **Multi-tab Support** | N/A | Full support |

### Using Editor Tabs Like Terminals

Just like VS Code terminals, you can now:
- 🔳 Open multiple Pixel Agents tabs side-by-side
- 🔳 Arrange them in split editor panes
- 🔳 Keep sidebar + editor tab open simultaneously
- 🔳 Each tab maintains its own scroll/camera position
- 🔳 All tabs stay synced with live agent updates

---

## Files Modified

```
src/
├── constants.ts                  [+3 constants]
├── extension.ts                  [+command registration]
└── PixelAgentsViewProvider.ts    [+5 new methods, major refactor]

webview-ui/src/
└── components/BottomToolbar.tsx  [+1 button]

package.json                       [+1 command]

EDITOR_AREA_ANALYSIS.md           [analysis document]
```

---

## Developer Notes

### Key Implementation Patterns

1. **Lazy Terminal Event Setup**
   - `terminalEventListenersRegistered` flag prevents duplicate listeners
   - Called once on first `resolveWebviewView()` call
   - Listeners use `broadcastToWebviews()` to reach all views

2. **Active Webview Tracking**
   - `activeWebviewId` stores currently focused view ID
   - Sidebar always takes priority when visible
   - Used by `getActiveWebview()` for message routing

3. **Panel ID Generation**
   - Counter-based: `pixel-agents-1`, `pixel-agents-2`, etc.
   - Unique per session (not persisted)
   - Maps to `editorWebviews` for cleanup

4. **Message Handling**
   - Extracted to `handleWebviewMessage()` (240+ lines)
   - Used by both `resolveWebviewView()` and editor tab handlers
   - All operations use `getActiveWebview()` or `broadcastToWebviews()`

### Future Enhancements

The architecture now supports:
- 📌 Persisting open editor tabs across sessions (add `workspaceState` tracking)
- 📌 Tab recovery on extension reload
- 📌 Split-pane layouts (layout per webview)
- 📌 Independent camera positions (already works)
- 📌 Keyboard shortcuts for opening tabs (register command)

---

## Testing

The implementation has been:
- ✅ Type-checked (TypeScript compilation passes)
- ✅ Built successfully (esbuild + Vite)
- ✅ Linted (no new errors, pre-existing warnings only)
- ✅ Architecture reviewed (backward compatible)

**Manual Testing Checklist:**
1. Open the extension (sidebar view works)
2. Click "⊡ Tab" button → Editor tab opens
3. Click "+ Agent" → Agent appears in both sidebar and editor tab
4. Switch between tabs → Agent states sync
5. Open multiple editor tabs → Multiple offices visible
6. Close tab → Cleanup works, sidebar unaffected
7. Run `Pixel Agents: Open in Editor Area` command → New tab opens

---

## Quick Start

**Users:**
1. Update to the new version
2. Look for "⊡ Tab" button in the sidebar toolbar
3. Click it to open a full-screen editor tab
4. Or: Command Palette → `Pixel Agents: Open in Editor Area`

**Developers:**
- Review `PixelAgentsViewProvider.ts` line 55-72 for multi-webview pattern
- Extension state now lives at provider level (shared across all views)
- All webview messages go through `handleWebviewMessage()` (single source of truth)
- Broadcasting with `broadcastToWebviews()` updates all views simultaneously

---

## Architecture Diagram

```
┌──────────────────────────────────────────────────────┐
│         VS Code Extension Context                    │
├──────────────────────────────────────────────────────┤
│                                                      │
│  PixelAgentsViewProvider (Single Instance)           │
│  ┌──────────────────────────────────────────────┐   │
│  │ Shared State:                                │   │
│  │  • agents: Map<id, AgentState>              │   │
│  │  • timers (file watch, polling, etc)        │   │
│  │  • knownJsonlFiles                          │   │
│  │  • defaultLayout                            │   │
│  │  • layoutWatcher                            │   │
│  └──────────────────────────────────────────────┘   │
│                    ↓                                 │
│  ┌──────────────────────────────────────────────┐   │
│  │ Webview Management:                          │   │
│  │  • webviewView (sidebar)                    │   │
│  │  • editorWebviews (Map of tabs)             │   │
│  │  • getActiveWebview()                       │   │
│  │  • broadcastToWebviews()                    │   │
│  │  • handleWebviewMessage()                   │   │
│  └──────────────────────────────────────────────┘   │
│                    ↓↓↓                               │
│    ┌───────────────┬───────────────┬────────────┐   │
│    ↓               ↓               ↓            ↓   │
│  Sidebar      Editor Tab 1    Editor Tab 2   ...   │
│  (WebviewView) (WebviewPanel) (WebviewPanel)      │
│                                                    │
└──────────────────────────────────────────────────────┘
```

---

## Summary

✨ **The Pixel Agents extension now supports full-screen editor tabs with complete agent state synchronization.** Users can open the pixel art office wherever they want—sidebar or editor area—and all instances stay perfectly synced with real-time agent updates.

This implementation maintains 100% backward compatibility while enabling a new, more flexible workflow that brings Pixel Agents closer to terminal-like flexibility.
