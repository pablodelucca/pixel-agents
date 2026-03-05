import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import * as vscode from 'vscode';
import type { AgentState } from './types.js';
import {
	launchNewTerminal,
	removeAgent,
	restoreAgents,
	persistAgents,
	sendExistingAgents,
	sendLayout,
	getProjectDirPath,
} from './agentManager.js';
import { ensureProjectScan } from './fileWatcher.js';
import { loadFurnitureAssets, sendAssetsToWebview, loadFloorTiles, sendFloorTilesToWebview, loadWallTiles, sendWallTilesToWebview, loadCharacterSprites, sendCharacterSpritesToWebview, loadDefaultLayout } from './assetLoader.js';
import { WORKSPACE_KEY_AGENT_SEATS, GLOBAL_KEY_SOUND_ENABLED, WEBVIEW_PANEL_TYPE, WEBVIEW_PANEL_TITLE } from './constants.js';
import { writeLayoutToFile, readLayoutFromFile, watchLayoutFile } from './layoutPersistence.js';
import type { LayoutWatcher } from './layoutPersistence.js';

export class PixelAgentsViewProvider implements vscode.WebviewViewProvider {
	nextAgentId = { current: 1 };
	nextTerminalIndex = { current: 1 };
	agents = new Map<number, AgentState>();
	webviewView: vscode.WebviewView | undefined;

	// Editor tab webview panels: Map<panelId, WebviewPanel>
	editorWebviews = new Map<string, vscode.WebviewPanel>();
	activeWebviewId: string | undefined; // Currently focused webview (either sidebar or editor tab)
	panelIdCounter = 0; // Counter for generating unique panel IDs

	// Per-agent timers
	fileWatchers = new Map<number, fs.FSWatcher>();
	pollingTimers = new Map<number, ReturnType<typeof setInterval>>();
	waitingTimers = new Map<number, ReturnType<typeof setTimeout>>();
	jsonlPollTimers = new Map<number, ReturnType<typeof setInterval>>();
	permissionTimers = new Map<number, ReturnType<typeof setTimeout>>();

	// /clear detection: project-level scan for new JSONL files
	activeAgentId = { current: null as number | null };
	knownJsonlFiles = new Set<string>();
	projectScanTimer = { current: null as ReturnType<typeof setInterval> | null };

	// Bundled default layout (loaded from assets/default-layout.json)
	defaultLayout: Record<string, unknown> | null = null;

	// Cross-window layout sync
	layoutWatcher: LayoutWatcher | null = null;

	constructor(private readonly context: vscode.ExtensionContext) {}

	private get extensionUri(): vscode.Uri {
		return this.context.extensionUri;
	}

	private get webview(): vscode.Webview | undefined {
		return this.webviewView?.webview;
	}

	/** Get the currently active webview (sidebar or editor tab) */
	private getActiveWebview(): vscode.Webview | undefined {
		// Prioritize editor tab if one is active
		if (this.activeWebviewId && this.editorWebviews.has(this.activeWebviewId)) {
			return this.editorWebviews.get(this.activeWebviewId)?.webview;
		}
		// Fall back to sidebar
		return this.webviewView?.webview;
	}

	/** Broadcast message to all connected webviews */
	private broadcastToWebviews(message: Record<string, unknown>): void {
		// Send to sidebar if it exists
		this.webviewView?.webview.postMessage(message);
		// Send to all editor tabs
		this.editorWebviews.forEach((panel) => {
			panel.webview.postMessage(message);
		});
	}

	private persistAgents = (): void => {
		persistAgents(this.agents, this.context);
	};

	/** Shared message handler for both sidebar and editor tabs */
	private async handleWebviewMessage(message: Record<string, unknown>): Promise<void> {
		if (message.type === 'openClaude') {
			await launchNewTerminal(
				this.nextAgentId, this.nextTerminalIndex,
				this.agents, this.activeAgentId, this.knownJsonlFiles,
				this.fileWatchers, this.pollingTimers, this.waitingTimers, this.permissionTimers,
				this.jsonlPollTimers, this.projectScanTimer,
				this.getActiveWebview(), this.persistAgents,
				message.folderPath as string | undefined,
			);
		} else if (message.type === 'focusAgent') {
			const agent = this.agents.get(message.id as number);
			if (agent) {
				agent.terminalRef.show();
			}
		} else if (message.type === 'closeAgent') {
			const agent = this.agents.get(message.id as number);
			if (agent) {
				agent.terminalRef.dispose();
			}
		} else if (message.type === 'saveAgentSeats') {
			console.log(`[Pixel Agents] saveAgentSeats:`, JSON.stringify(message.seats));
			this.context.workspaceState.update(WORKSPACE_KEY_AGENT_SEATS, message.seats);
		} else if (message.type === 'saveLayout') {
			this.layoutWatcher?.markOwnWrite();
			writeLayoutToFile(message.layout as Record<string, unknown>);
		} else if (message.type === 'setSoundEnabled') {
			this.context.globalState.update(GLOBAL_KEY_SOUND_ENABLED, message.enabled);
		} else if (message.type === 'webviewReady') {
			restoreAgents(
				this.context,
				this.nextAgentId, this.nextTerminalIndex,
				this.agents, this.knownJsonlFiles,
				this.fileWatchers, this.pollingTimers, this.waitingTimers, this.permissionTimers,
				this.jsonlPollTimers, this.projectScanTimer, this.activeAgentId,
				this.getActiveWebview(), this.persistAgents,
			);
			// Send persisted settings to all webviews
			const soundEnabled = this.context.globalState.get<boolean>(GLOBAL_KEY_SOUND_ENABLED, true);
			this.broadcastToWebviews({ type: 'settingsLoaded', soundEnabled });

			// Send workspace folders to all webviews (only when multi-root)
			const wsFolders = vscode.workspace.workspaceFolders;
			if (wsFolders && wsFolders.length > 1) {
				this.broadcastToWebviews({
					type: 'workspaceFolders',
					folders: wsFolders.map(f => ({ name: f.name, path: f.uri.fsPath })),
				});
			}

			// Ensure project scan runs even with no restored agents (to adopt external terminals)
			const projectDir = getProjectDirPath();
			const workspaceRoot = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
			console.log('[Extension] workspaceRoot:', workspaceRoot);
			console.log('[Extension] projectDir:', projectDir);
			if (projectDir) {
				ensureProjectScan(
					projectDir, this.knownJsonlFiles, this.projectScanTimer, this.activeAgentId,
					this.nextAgentId, this.agents,
					this.fileWatchers, this.pollingTimers, this.waitingTimers, this.permissionTimers,
					this.getActiveWebview(), this.persistAgents,
				);

				// Load furniture assets BEFORE sending layout
				(async () => {
					try {
						console.log('[Extension] Loading furniture assets...');
						const extensionPath = this.extensionUri.fsPath;
						console.log('[Extension] extensionPath:', extensionPath);

						const bundledAssetsDir = path.join(extensionPath, 'dist', 'assets');
						let assetsRoot: string | null = null;
						if (fs.existsSync(bundledAssetsDir)) {
							console.log('[Extension] Found bundled assets at dist/');
							assetsRoot = path.join(extensionPath, 'dist');
						} else if (workspaceRoot) {
							console.log('[Extension] Trying workspace for assets...');
							assetsRoot = workspaceRoot;
						}

						if (!assetsRoot) {
							console.log('[Extension] ⚠️  No assets directory found');
							this.broadcastToWebviews({ type: 'layoutLoaded', layout: this.defaultLayout });
							this.startLayoutWatcher();
							return;
						}

						console.log('[Extension] Using assetsRoot:', assetsRoot);

						// Load bundled default layout
						this.defaultLayout = loadDefaultLayout(assetsRoot);

						// Load character sprites
						const charSprites = await loadCharacterSprites(assetsRoot);
						if (charSprites) {
							console.log('[Extension] Character sprites loaded, sending to webviews');
							this.broadcastToWebviews({ type: 'characterSpritesLoaded', characterSprites: charSprites });
						}

						// Load floor tiles
						const floorTiles = await loadFloorTiles(assetsRoot);
						if (floorTiles) {
							console.log('[Extension] Floor tiles loaded, sending to webviews');
							this.broadcastToWebviews({ type: 'floorTilesLoaded', floorTiles });
						}

						// Load wall tiles
						const wallTiles = await loadWallTiles(assetsRoot);
						if (wallTiles) {
							console.log('[Extension] Wall tiles loaded, sending to webviews');
							this.broadcastToWebviews({ type: 'wallTilesLoaded', wallTiles });
						}

						const assets = await loadFurnitureAssets(assetsRoot);
						if (assets) {
							console.log('[Extension] ✅ Assets loaded, sending to webviews');
							this.broadcastToWebviews({ type: 'furnitureAssetsLoaded', catalog: assets });
						}
					} catch (err) {
						console.error('[Extension] ❌ Error loading assets:', err);
					}
					// Always send saved layout (or null for default)
					console.log('[Extension] Sending saved layout');
					this.broadcastToWebviews({ type: 'layoutLoaded', layout: this.defaultLayout });
					this.startLayoutWatcher();
				})();
			} else {
				// No project dir — still try to load floor/wall tiles, then send saved layout
				(async () => {
					try {
						const ep = this.extensionUri.fsPath;
						const bundled = path.join(ep, 'dist', 'assets');
						if (fs.existsSync(bundled)) {
							const distRoot = path.join(ep, 'dist');
							this.defaultLayout = loadDefaultLayout(distRoot);
							const cs = await loadCharacterSprites(distRoot);
							if (cs) {
								this.broadcastToWebviews({ type: 'characterSpritesLoaded', characterSprites: cs });
							}
							const ft = await loadFloorTiles(distRoot);
							if (ft) {
								this.broadcastToWebviews({ type: 'floorTilesLoaded', floorTiles: ft });
							}
							const wt = await loadWallTiles(distRoot);
							if (wt) {
								this.broadcastToWebviews({ type: 'wallTilesLoaded', wallTiles: wt });
							}
						}
					} catch { /* ignore */ }
					this.broadcastToWebviews({ type: 'layoutLoaded', layout: this.defaultLayout });
					this.startLayoutWatcher();
				})();
			}
			sendExistingAgents(this.agents, this.context, this.getActiveWebview());
		} else if (message.type === 'openSessionsFolder') {
			const projectDir = getProjectDirPath();
			if (projectDir && fs.existsSync(projectDir)) {
				vscode.env.openExternal(vscode.Uri.file(projectDir));
			}
		} else if (message.type === 'exportLayout') {
			const layout = readLayoutFromFile();
			if (!layout) {
				vscode.window.showWarningMessage('Pixel Agents: No saved layout to export.');
				return;
			}
			const uri = await vscode.window.showSaveDialog({
				filters: { 'JSON Files': ['json'] },
				defaultUri: vscode.Uri.file(path.join(os.homedir(), 'pixel-agents-layout.json')),
			});
			if (uri) {
				fs.writeFileSync(uri.fsPath, JSON.stringify(layout, null, 2), 'utf-8');
				vscode.window.showInformationMessage('Pixel Agents: Layout exported successfully.');
			}
		} else if (message.type === 'importLayout') {
			const uris = await vscode.window.showOpenDialog({
				filters: { 'JSON Files': ['json'] },
				canSelectMany: false,
			});
			if (!uris || uris.length === 0) return;
			try {
				const raw = fs.readFileSync(uris[0].fsPath, 'utf-8');
				const imported = JSON.parse(raw) as Record<string, unknown>;
				if (imported.version !== 1 || !Array.isArray(imported.tiles)) {
					vscode.window.showErrorMessage('Pixel Agents: Invalid layout file.');
					return;
				}
				this.layoutWatcher?.markOwnWrite();
				writeLayoutToFile(imported);
				this.broadcastToWebviews({ type: 'layoutLoaded', layout: imported });
				vscode.window.showInformationMessage('Pixel Agents: Layout imported successfully.');
			} catch {
				vscode.window.showErrorMessage('Pixel Agents: Failed to read or parse layout file.');
			}
		}
	}

	resolveWebviewView(webviewView: vscode.WebviewView) {
		this.webviewView = webviewView;
		webviewView.webview.options = { enableScripts: true };
		webviewView.webview.html = getWebviewContent(webviewView.webview, this.extensionUri);

		webviewView.webview.onDidReceiveMessage(async (message) => {
			await this.handleWebviewMessage(message);
		});

		// Track sidebar visibility for focus management
		webviewView.onDidChangeVisibility(() => {
			if (webviewView.visible) {
				this.activeWebviewId = undefined; // Prioritize sidebar when visible
			}
		});

		// Register terminal event listeners (shared across all webviews)
		if (!this.terminalEventListenersRegistered) {
			this.setupTerminalEventListeners();
			this.terminalEventListenersRegistered = true;
		}
	}

	private terminalEventListenersRegistered = false;

	/** Setup global terminal event listeners (called once) */
	private setupTerminalEventListeners(): void {
		vscode.window.onDidChangeActiveTerminal((terminal) => {
			this.activeAgentId.current = null;
			if (!terminal) return;
			for (const [id, agent] of this.agents) {
				if (agent.terminalRef === terminal) {
					this.activeAgentId.current = id;
					this.broadcastToWebviews({ type: 'agentSelected', id });
					break;
				}
			}
		});

		vscode.window.onDidCloseTerminal((closed) => {
			for (const [id, agent] of this.agents) {
				if (agent.terminalRef === closed) {
					if (this.activeAgentId.current === id) {
						this.activeAgentId.current = null;
					}
					removeAgent(
						id, this.agents,
						this.fileWatchers, this.pollingTimers, this.waitingTimers, this.permissionTimers,
						this.jsonlPollTimers, this.persistAgents,
					);
					this.broadcastToWebviews({ type: 'agentClosed', id });
				}
			}
		});
	}

	/** Open a new editor tab with the Pixel Agents office */
	openEditorTab(): void {
		const tabId = `pixel-agents-${++this.panelIdCounter}`;
		const panel = vscode.window.createWebviewPanel(
			WEBVIEW_PANEL_TYPE,
			WEBVIEW_PANEL_TITLE,
			vscode.ViewColumn.Active,
			{ enableScripts: true, retainContextWhenHidden: true }
		);

		this.editorWebviews.set(tabId, panel);
		this.activeWebviewId = tabId;

		panel.webview.options = { enableScripts: true };
		panel.webview.html = getWebviewContent(panel.webview, this.extensionUri);

		// Message handler for this editor tab
		panel.webview.onDidReceiveMessage(async (message) => {
			await this.handleWebviewMessage(message);
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

	/** Export current saved layout to webview-ui/public/assets/default-layout.json (dev utility) */
	exportDefaultLayout(): void {
		const layout = readLayoutFromFile();
		if (!layout) {
			vscode.window.showWarningMessage('Pixel Agents: No saved layout found.');
			return;
		}
		const workspaceRoot = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
		if (!workspaceRoot) {
			vscode.window.showErrorMessage('Pixel Agents: No workspace folder found.');
			return;
		}
		const targetPath = path.join(workspaceRoot, 'webview-ui', 'public', 'assets', 'default-layout.json');
		const json = JSON.stringify(layout, null, 2);
		fs.writeFileSync(targetPath, json, 'utf-8');
		vscode.window.showInformationMessage(`Pixel Agents: Default layout exported to ${targetPath}`);
	}

	private startLayoutWatcher(): void {
		if (this.layoutWatcher) return;
		this.layoutWatcher = watchLayoutFile((layout) => {
			console.log('[Pixel Agents] External layout change — pushing to webviews');
			this.broadcastToWebviews({ type: 'layoutLoaded', layout });
		});
	}

	dispose() {
		this.layoutWatcher?.dispose();
		this.layoutWatcher = null;
		for (const id of [...this.agents.keys()]) {
			removeAgent(
				id, this.agents,
				this.fileWatchers, this.pollingTimers, this.waitingTimers, this.permissionTimers,
				this.jsonlPollTimers, this.persistAgents,
			);
		}
		if (this.projectScanTimer.current) {
			clearInterval(this.projectScanTimer.current);
			this.projectScanTimer.current = null;
		}
	}
}

export function getWebviewContent(webview: vscode.Webview, extensionUri: vscode.Uri): string {
	const distPath = vscode.Uri.joinPath(extensionUri, 'dist', 'webview');
	const indexPath = vscode.Uri.joinPath(distPath, 'index.html').fsPath;

	let html = fs.readFileSync(indexPath, 'utf-8');

	html = html.replace(/(href|src)="\.\/([^"]+)"/g, (_match, attr, filePath) => {
		const fileUri = vscode.Uri.joinPath(distPath, filePath);
		const webviewUri = webview.asWebviewUri(fileUri);
		return `${attr}="${webviewUri}"`;
	});

	return html;
}
