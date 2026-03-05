# Pixel Agents: Editor Area Integration Analysis

## Executive Summary

The Pixel Agents extension currently uses **WebviewViewProvider** (sidebar/panel view), but can be migrated to **WebviewPanel** to display as a full-screen editor tab. This requires architectural changes to support both configurations simultaneously, allowing users to open the pixel agents office in the main editor area just like terminals.

---

## Current Architecture

### Current Setup: WebviewViewProvider (Sidebar)
```
package.json
├── contributes.viewsContainers.panel
│   └── id: "pixel-agents-panel" → Shows in sidebar/panel area
└── contributes.views
    └── "pixel-agents-panel"
        └── pixel-agents.panelView (WebviewView)

src/extension.ts
└── registerWebviewViewProvider(VIEW_ID, provider)
    └── provider: PixelAgentsViewProvider
        └── implements vscode.WebviewViewProvider
            └── resolveWebviewView() → Creates sidebar webview
```

### Key Components
- **PixelAgentsViewProvider**: Single instance managing all agents
  - `webviewView: vscode.WebviewView` (sidebar only)
  - `resolveWebviewView()`: Called once when sidebar initializes
  - No support for opening in main editor area

- **Extension Entry Point** (`extension.ts`):
  - Only registers one provider
  - Only one command: `showPanel` (focuses sidebar)

---

## Migration Strategy

### Option 1: Dual-View Architecture (Recommended)
Support **both** sidebar and editor area simultaneously using a hybrid approach.

#### Implementation Steps

1. **Replace WebviewViewProvider with WebviewPanel**
   - Change `PixelAgentsViewProvider` to implement `WebviewPanelProvider` OR use `createWebviewPanel()` directly
   - Support multiple webview instances

2. **Add Editor Tab Command**
   ```typescript
   "commands": [
     {
       "command": "pixel-agents.openEditorTab",
       "title": "Pixel Agents: Open in Editor Area"
     },
     {
       "command": "pixel-agents.showPanel", // Keep for sidebar
       "title": "Pixel Agents: Show Panel"
     }
   ]
   ```

3. **Maintain Shared Agent State**
   - All webviews (sidebar + editor tabs) share the same `agents` Map
   - Message routing broadcasts to all connected webviews
   - Only one active webview at a time receives focus

4. **Webview Management**
   ```typescript
   class PixelAgentsViewProvider {
     agents = new Map<number, AgentState>()          // Shared
     webviews = new Set<vscode.Webview>()            // All connected webviews
     activeWebview: vscode.Webview | undefined       // Currently focused
     
     registerNewWebview(webview: vscode.Webview)     // Track new webview
     broadcastToWebviews(message: any)               // Send to all
   }
   ```

---

## Detailed Implementation Plan

### Phase 1: Restructure View Provider

#### File: `src/extension.ts`
```typescript
import * as vscode from 'vscode';
import { PixelAgentsViewProvider } from './PixelAgentsViewProvider.js';
import { 
  VIEW_ID, 
  COMMAND_SHOW_PANEL, 
  COMMAND_EXPORT_DEFAULT_LAYOUT,
  COMMAND_OPEN_EDITOR_TAB  // NEW
} from './constants.js';

let providerInstance: PixelAgentsViewProvider | undefined;

export function activate(context: vscode.ExtensionContext) {
  const provider = new PixelAgentsViewProvider(context);
  providerInstance = provider;

  // Register webview view provider (sidebar)
  context.subscriptions.push(
    vscode.window.registerWebviewViewProvider(VIEW_ID, provider)
  );

  // Show panel command
  context.subscriptions.push(
    vscode.commands.registerCommand(COMMAND_SHOW_PANEL, () => {
      vscode.commands.executeCommand(`${VIEW_ID}.focus`);
    })
  );

  // NEW: Open in editor area command
  context.subscriptions.push(
    vscode.commands.registerCommand(COMMAND_OPEN_EDITOR_TAB, () => {
      provider.openEditorTab();
    })
  );

  // Export layout command
  context.subscriptions.push(
    vscode.commands.registerCommand(COMMAND_EXPORT_DEFAULT_LAYOUT, () => {
      provider.exportDefaultLayout();
    })
  );
}

export function deactivate() {
  providerInstance?.dispose();
}
```

#### File: `src/constants.ts`
```typescript
// Add:
export const COMMAND_OPEN_EDITOR_TAB = 'pixel-agents.openEditorTab';
export const EDITOR_TAB_TITLE = 'Pixel Agents';
```

### Phase 2: Modify PixelAgentsViewProvider

#### Key Changes to `PixelAgentsViewProvider.ts`

```typescript
export class PixelAgentsViewProvider implements vscode.WebviewViewProvider {
  // Existing
  agents = new Map<number, AgentState>();
  webviewView: vscode.WebviewView | undefined;
  
  // NEW: Track multiple webviews
  editorWebviews = new Map<string, vscode.WebviewPanel>();  // panelId → WebviewPanel
  activeWebviewId: string | undefined;  // Currently focused webview
  
  // NEW: Determine which webview to use for messages
  private get activeWebview(): vscode.Webview | undefined {
    if (this.activeWebviewId && this.editorWebviews.has(this.activeWebviewId)) {
      return this.editorWebviews.get(this.activeWebviewId)?.webview;
    }
    return this.webviewView?.webview;
  }

  // NEW: Broadcast to all webviews
  private broadcastToWebviews(message: any): void {
    // Send to sidebar
    this.webviewView?.webview.postMessage(message);
    // Send to all editor tabs
    this.editorWebviews.forEach((panel) => {
      panel.webview.postMessage(message);
    });
  }

  // NEW: Open editor tab
  async openEditorTab(): Promise<void> {
    const panel = vscode.window.createWebviewPanel(
      'pixel-agents-editor',
      this.context.globalState.get('pixel-agents.editorTabCount', 1),
      vscode.ViewColumn.Active,
      { enableScripts: true, retainContextWhenHidden: true }
    );

    const tabId = panel.webview.cspSource;  // Unique ID
    this.editorWebviews.set(tabId, panel);
    this.activeWebviewId = tabId;

    panel.webview.options = { enableScripts: true };
    panel.webview.html = getWebviewContent(panel.webview, this.extensionUri);

    // Setup message handler
    panel.webview.onDidReceiveMessage((message) => {
      this.handleWebviewMessage(message, panel.webview);
    });

    // Cleanup when closed
    panel.onDidDispose(() => {
      this.editorWebviews.delete(tabId);
      if (this.activeWebviewId === tabId) {
        this.activeWebviewId = undefined;
      }
    });

    // Track focus
    panel.onDidChangeViewState(({ webviewPanel }) => {
      if (webviewPanel.visible) {
        this.activeWebviewId = tabId;
      }
    });
  }

  // NEW: Extract message handling to shared method
  private handleWebviewMessage(message: any, webview: vscode.Webview): void {
    if (message.type === 'openClaude') {
      // ... existing logic, but use broadcastToWebviews() instead of sending to single webview
      launchNewTerminal(
        // ... parameters
      );
    } else if (message.type === 'agentCreated') {
      // Broadcast agent creation to all webviews
      this.broadcastToWebviews({
        type: 'agentCreated',
        agent: message.agent
      });
    }
    // ... handle other messages
  }

  // Existing: WebviewViewProvider implementation
  resolveWebviewView(webviewView: vscode.WebviewView) {
    this.webviewView = webviewView;
    webviewView.webview.options = { enableScripts: true };
    webviewView.webview.html = getWebviewContent(webviewView.webview, this.extensionUri);

    webviewView.webview.onDidReceiveMessage(async (message) => {
      this.handleWebviewMessage(message, webviewView.webview);
    });

    // Refocus sidebar when it becomes visible
    webviewView.onDidChangeVisibility(() => {
      if (webviewView.visible) {
        this.activeWebviewId = undefined;  // Prioritize sidebar
      }
    });
  }
}
```

### Phase 3: Update package.json

```json
{
  "contributes": {
    "commands": [
      {
        "command": "pixel-agents.showPanel",
        "title": "Pixel Agents: Show Panel"
      },
      {
        "command": "pixel-agents.openEditorTab",
        "title": "Pixel Agents: Open in Editor Area"
      },
      {
        "command": "pixel-agents.exportDefaultLayout",
        "title": "Pixel Agents: Export Layout as Default"
      }
    ],
    "viewsContainers": {
      "panel": [
        {
          "id": "pixel-agents-panel",
          "title": "Pixel Agents",
          "icon": "$(window)"
        }
      ]
    },
    "views": {
      "pixel-agents-panel": [
        {
          "type": "webview",
          "id": "pixel-agents.panelView",
          "name": "Pixel Agents"
        }
      ]
    }
  }
}
```

### Phase 4: UI Enhancements

Add button to bottom toolbar to open editor tab:

#### File: `webview-ui/src/components/BottomToolbar.tsx`
```typescript
// Add new button alongside existing buttons
<button
  onClick={() => vscode.postMessage({ type: 'openEditorTab' })}
  title="Open in Editor Area"
  style={{ padding: '4px', cursor: 'pointer' }}
>
  ⊟ {/* Expand/Editor icon */}
</button>
```

---

## Architecture Comparison

### Current: Single WebviewViewProvider
```
┌─────────────────────────────────────────────────┐
│  VS Code                                        │
├─────────────────────────────────────────────────┤
│  Editor Area          │  Sidebar (Panel)        │
│                       │ ┌────────────────────┐  │
│                       │ │ Pixel Agents View  │  │
│                       │ │ (WebviewView)      │  │
│                       │ │ - Canvas           │  │
│                       │ │ - Agents           │  │
│                       │ │ - Controls         │  │
│                       │ └────────────────────┘  │
│                       │                        │
└─────────────────────────────────────────────────┘
```

### Proposed: Dual-View with WebviewPanel
```
┌─────────────────────────────────────────────────┐
│  VS Code                                        │
├─────────────────────────────────────────────────┤
│  ┌────────────────────────┐  │  Sidebar        │
│  │ Editor Tab 1           │  │  ┌────────────┐ │
│  │ (WebviewPanel)         │  │  │Pixel Agents│ │
│  │ - Canvas               │  │  │(WebviewView)│ │
│  │ - Agents               │  │  │            │ │
│  │ - Controls             │  │  └────────────┘ │
│  └────────────────────────┘  │                 │
│  ┌────────────────────────┐  │                 │
│  │ Editor Tab 2 (Optional)│  │  (Shared Agent  │
│  │ (WebviewPanel)         │  │   State)        │
│  │ - Same View            │  │                 │
│  └────────────────────────┘  │                 │
└─────────────────────────────────────────────────┘

Shared State: PixelAgentsViewProvider.agents
Message Flow: All webviews ← → Same provider
Active Webview: Whichever is currently focused
```

---

## Critical Implementation Considerations

### 1. **Message Broadcasting**
   - All agent state changes must broadcast to ALL webviews
   - Use `broadcastToWebviews()` for agent creation, terminal focus, tool updates
   - Messages like `agentToolStart`, `agentToolDone` need to reach all tabs

### 2. **State Synchronization**
   - `agents` Map remains the single source of truth
   - Each webview maintains its own camera position, selection state (local React state)
   - File watching and JSONL parsing happen once at provider level, results broadcast

### 3. **Focus Management**
   ```typescript
   // Sidebar visible → messages go to sidebar
   // Editor tab visible → messages go to active editor tab
   // No tab visible → buffer messages until a webview connects
   ```

### 4. **Cleanup & Disposal**
   - Editor panels must properly dispose of event listeners
   - Prevent memory leaks from closed webview references
   - Use `Set` or `Map` with cleanup on `onDidDispose`

### 5. **Performance**
   - Only update layout file once (not per webview)
   - Debounce `saveLayout` messages
   - Share asset loading (character sprites, floor tiles, wall tiles)

---

## Code Structure After Migration

```
src/
├── extension.ts                    ← Register both WebviewViewProvider + openEditorTab command
├── PixelAgentsViewProvider.ts      ← Manage sidebar + multiple editor panels
│   ├── agents: Map                 ← Shared across all webviews
│   ├── webviewView: WebviewView    ← Sidebar view
│   ├── editorWebviews: Map         ← Editor tab panels
│   ├── activeWebviewId: string     ← Track focused webview
│   ├── resolveWebviewView()        ← Implement WebviewViewProvider
│   ├── openEditorTab()             ← NEW: Create editor panel
│   ├── broadcastToWebviews()       ← NEW: Send to all
│   └── handleWebviewMessage()      ← NEW: Shared message handler
├── agentManager.ts                 ← Unchanged (terminal lifecycle)
├── fileWatcher.ts                  ← Unchanged (JSONL monitoring)
└── ... other files ...
```

---

## Migration Roadmap

### Step 1: Prepare Infrastructure (No Breaking Changes)
- [ ] Add `COMMAND_OPEN_EDITOR_TAB` to constants
- [ ] Implement `openEditorTab()` stub method
- [ ] Register new command in extension.ts

### Step 2: Implement Webview Panel Creation
- [ ] Create `openEditorTab()` that spawns WebviewPanel
- [ ] Set up message routing for new panels
- [ ] Track editor panels in `editorWebviews` Map

### Step 3: Refactor Message Handling
- [ ] Extract shared message handling to `handleWebviewMessage()`
- [ ] Implement `broadcastToWebviews()` method
- [ ] Update all agent state changes to broadcast

### Step 4: Test & Polish
- [ ] Test multiple editor tabs simultaneously
- [ ] Verify agent state sync across tabs
- [ ] Test sidebar + editor tab together
- [ ] Ensure proper cleanup on panel close

### Step 5: UI Enhancements
- [ ] Add "Open in Editor" button to toolbar
- [ ] Update README with new workflow
- [ ] Consider keyboard shortcut (e.g., Ctrl+Shift+P > "Open Pixel Agents in Editor")

---

## Backward Compatibility

✅ **Fully compatible** — The sidebar view continues to work as before. New editor tab feature is purely additive.

- Users can still access Pixel Agents from the sidebar
- New users/workflows can use editor tabs instead
- Users can use both simultaneously if desired

---

## Future Enhancements

1. **Multi-workspace support**: Each workspace has its own layout
2. **Tab recovery**: Remember which editor tabs were open on restart
3. **Split pane**: Divide editor area between office and code editor
4. **Keyboard shortcuts**: Cmd/Ctrl+Shift+O to toggle editor tab

---

## Summary

| Aspect | Current | After Migration |
|--------|---------|-----------------|
| **View Type** | WebviewViewProvider (sidebar only) | WebviewViewProvider + WebviewPanel (both) |
| **Open Locations** | Sidebar panel only | Sidebar + editor area tabs |
| **Multiple Instances** | Not possible | Yes (multiple editor tabs) |
| **Message Routing** | Single webview | Broadcast to all |
| **State Management** | Single agents Map | Shared across webviews |
| **Commands** | `showPanel` | `showPanel` + `openEditorTab` |
| **Breaking Changes** | None | None (fully additive) |

The migration enables a **terminal-like experience** for Pixel Agents while maintaining the existing sidebar functionality. Users can now choose their preferred view: compact sidebar or full-screen editor tab.
