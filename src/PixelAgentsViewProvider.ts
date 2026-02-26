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
import { ensureProjectScan, startFileWatching, readNewLines } from './fileWatcher.js';
import { loadFurnitureAssets, sendAssetsToWebview, loadFloorTiles, sendFloorTilesToWebview, loadWallTiles, sendWallTilesToWebview, loadCharacterSprites, sendCharacterSpritesToWebview, loadDefaultLayout } from './assetLoader.js';
import { WORKSPACE_KEY_AGENT_SEATS, GLOBAL_KEY_SOUND_ENABLED, GLOBAL_KEY_EXTERNAL_AGENTS_ENABLED, GLOBAL_KEY_USE_TMUX, TMUX_TERMINAL_NAME_PREFIX, TMUX_SESSION_NAME } from './constants.js';
import { startExternalAgentScanning, startStaleExternalAgentCheck } from './externalAgentScanner.js';
import { isTmuxAvailable, resolveTmuxSession, tmuxSessionExists, createTmuxSession, createTmuxWindow, tmuxSendKeys, killTmuxWindow } from './tmuxResolver.js';
import { writeLayoutToFile, readLayoutFromFile, watchLayoutFile } from './layoutPersistence.js';
import type { LayoutWatcher } from './layoutPersistence.js';

export class PixelAgentsViewProvider implements vscode.WebviewViewProvider {
	nextAgentId = { current: 1 };
	nextTerminalIndex = { current: 1 };
	agents = new Map<number, AgentState>();
	webviewView: vscode.WebviewView | undefined;

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

	// External agent scanning
	externalScanTimer: ReturnType<typeof setInterval> | null = null;
	staleCheckTimer: ReturnType<typeof setInterval> | null = null;

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

	private persistAgents = (): void => {
		persistAgents(this.agents, this.context);
	};

	resolveWebviewView(webviewView: vscode.WebviewView) {
		this.webviewView = webviewView;
		webviewView.webview.options = { enableScripts: true };
		webviewView.webview.html = getWebviewContent(webviewView.webview, this.extensionUri);

		webviewView.webview.onDidReceiveMessage(async (message) => {
			if (message.type === 'openClaude') {
				const useTmux = this.context.globalState.get<boolean>(GLOBAL_KEY_USE_TMUX, false);
				if (useTmux && isTmuxAvailable()) {
					this.launchTmuxAgent();
				} else {
					launchNewTerminal(
						this.nextAgentId, this.nextTerminalIndex,
						this.agents, this.activeAgentId, this.knownJsonlFiles,
						this.fileWatchers, this.pollingTimers, this.waitingTimers, this.permissionTimers,
						this.jsonlPollTimers, this.projectScanTimer,
						this.webview, this.persistAgents,
					);
				}
			} else if (message.type === 'focusAgent') {
				const agent = this.agents.get(message.id);
				if (!agent) return;
				console.log(`[Pixel Agents] focusAgent ${agent.id}: terminalRef=${!!agent.terminalRef} isExternal=${agent.isExternal} isTmux=${agent.isTmux}`);
				if (agent.terminalRef) {
					agent.terminalRef.show();
				} else if (agent.isExternal) {
					this.attachExternalAgent(agent);
				} else if (agent.isTmux && agent.tmuxSessionName && agent.tmuxWindowName) {
					this.reattachTmuxAgent(agent);
				}
			} else if (message.type === 'closeAgent') {
				const agent = this.agents.get(message.id);
				if (!agent) return;
				// Kill tmux window if applicable
				if (agent.tmuxSessionName && agent.tmuxWindowName) {
					killTmuxWindow(agent.tmuxSessionName, agent.tmuxWindowName);
				} else if (agent.isExternal) {
					// Try to resolve and kill the tmux session for external agents
					const sessionName = resolveTmuxSession(agent.projectDir);
					if (sessionName) {
						try {
							// Kill the whole tmux session since we don't track the window
							const { execFileSync } = require('child_process') as typeof import('child_process');
							execFileSync('tmux', ['kill-session', '-t', sessionName], { stdio: 'pipe' });
						} catch { /* session may be gone */ }
					}
				}
				// Dispose VS Code terminal if any
				if (agent.terminalRef) {
					agent.terminalRef.dispose();
				}
				// Remove agent directly (onDidCloseTerminal will be a no-op since agent is gone)
				removeAgent(
					message.id as number, this.agents,
					this.fileWatchers, this.pollingTimers, this.waitingTimers, this.permissionTimers,
					this.jsonlPollTimers, this.persistAgents,
				);
				webviewView.webview.postMessage({ type: 'agentClosed', id: message.id });
			} else if (message.type === 'saveAgentSeats') {
				// Store seat assignments in a separate key (never touched by persistAgents)
				console.log(`[Pixel Agents] saveAgentSeats:`, JSON.stringify(message.seats));
				this.context.workspaceState.update(WORKSPACE_KEY_AGENT_SEATS, message.seats);
			} else if (message.type === 'saveLayout') {
				this.layoutWatcher?.markOwnWrite();
				writeLayoutToFile(message.layout as Record<string, unknown>);
			} else if (message.type === 'setSoundEnabled') {
				this.context.globalState.update(GLOBAL_KEY_SOUND_ENABLED, message.enabled);
			} else if (message.type === 'setUseTmux') {
				this.context.globalState.update(GLOBAL_KEY_USE_TMUX, message.enabled);
			} else if (message.type === 'setExternalAgentsEnabled') {
				const enabled = message.enabled as boolean;
				this.context.globalState.update(GLOBAL_KEY_EXTERNAL_AGENTS_ENABLED, enabled);
				if (enabled) {
					this.startExternalScanning();
				} else {
					this.stopExternalScanning();
				}
			} else if (message.type === 'webviewReady') {
				restoreAgents(
					this.context,
					this.nextAgentId, this.nextTerminalIndex,
					this.agents, this.knownJsonlFiles,
					this.fileWatchers, this.pollingTimers, this.waitingTimers, this.permissionTimers,
					this.jsonlPollTimers, this.projectScanTimer, this.activeAgentId,
					this.webview, this.persistAgents,
				);
				// Send persisted settings to webview
				const soundEnabled = this.context.globalState.get<boolean>(GLOBAL_KEY_SOUND_ENABLED, true);
				const externalAgentsEnabled = this.context.globalState.get<boolean>(GLOBAL_KEY_EXTERNAL_AGENTS_ENABLED, true);
				const useTmux = this.context.globalState.get<boolean>(GLOBAL_KEY_USE_TMUX, false);
				this.webview?.postMessage({ type: 'settingsLoaded', soundEnabled, externalAgentsEnabled, useTmux });

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
						this.webview, this.persistAgents,
					);

					// Load furniture assets BEFORE sending layout
					(async () => {
						try {
							console.log('[Extension] Loading furniture assets...');
							const extensionPath = this.extensionUri.fsPath;
							console.log('[Extension] extensionPath:', extensionPath);

							// Check bundled location first: extensionPath/dist/assets/
							const bundledAssetsDir = path.join(extensionPath, 'dist', 'assets');
							let assetsRoot: string | null = null;
							if (fs.existsSync(bundledAssetsDir)) {
								console.log('[Extension] Found bundled assets at dist/');
								assetsRoot = path.join(extensionPath, 'dist');
							} else if (workspaceRoot) {
								// Fall back to workspace root (development or external assets)
								console.log('[Extension] Trying workspace for assets...');
								assetsRoot = workspaceRoot;
							}

							if (!assetsRoot) {
								console.log('[Extension] ⚠️  No assets directory found');
								if (this.webview) {
									sendLayout(this.context, this.webview, this.defaultLayout);
									this.startLayoutWatcher();
								}
								return;
							}

							console.log('[Extension] Using assetsRoot:', assetsRoot);

							// Load bundled default layout
							this.defaultLayout = loadDefaultLayout(assetsRoot);

							// Load character sprites
							const charSprites = await loadCharacterSprites(assetsRoot);
							if (charSprites && this.webview) {
								console.log('[Extension] Character sprites loaded, sending to webview');
								sendCharacterSpritesToWebview(this.webview, charSprites);
							}

							// Load floor tiles
							const floorTiles = await loadFloorTiles(assetsRoot);
							if (floorTiles && this.webview) {
								console.log('[Extension] Floor tiles loaded, sending to webview');
								sendFloorTilesToWebview(this.webview, floorTiles);
							}

							// Load wall tiles
							const wallTiles = await loadWallTiles(assetsRoot);
							if (wallTiles && this.webview) {
								console.log('[Extension] Wall tiles loaded, sending to webview');
								sendWallTilesToWebview(this.webview, wallTiles);
							}

							const assets = await loadFurnitureAssets(assetsRoot);
							if (assets && this.webview) {
								console.log('[Extension] ✅ Assets loaded, sending to webview');
								sendAssetsToWebview(this.webview, assets);
							}
						} catch (err) {
							console.error('[Extension] ❌ Error loading assets:', err);
						}
						// Always send saved layout (or null for default)
						if (this.webview) {
							console.log('[Extension] Sending saved layout');
							sendLayout(this.context, this.webview, this.defaultLayout);
							this.startLayoutWatcher();
						}
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
								if (cs && this.webview) {
									sendCharacterSpritesToWebview(this.webview, cs);
								}
								const ft = await loadFloorTiles(distRoot);
								if (ft && this.webview) {
									sendFloorTilesToWebview(this.webview, ft);
								}
								const wt = await loadWallTiles(distRoot);
								if (wt && this.webview) {
									sendWallTilesToWebview(this.webview, wt);
								}
							}
						} catch { /* ignore */ }
						if (this.webview) {
							sendLayout(this.context, this.webview, this.defaultLayout);
							this.startLayoutWatcher();
						}
					})();
				}
				sendExistingAgents(this.agents, this.context, this.webview);

				// Start external agent scanning if enabled
				const extEnabled = this.context.globalState.get<boolean>(GLOBAL_KEY_EXTERNAL_AGENTS_ENABLED, true);
				if (extEnabled) {
					this.startExternalScanning();
				}
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
					this.webview?.postMessage({ type: 'layoutLoaded', layout: imported });
					vscode.window.showInformationMessage('Pixel Agents: Layout imported successfully.');
				} catch {
					vscode.window.showErrorMessage('Pixel Agents: Failed to read or parse layout file.');
				}
			}
		});

		vscode.window.onDidChangeActiveTerminal((terminal) => {
			this.activeAgentId.current = null;
			if (!terminal) return;
			for (const [id, agent] of this.agents) {
				if (agent.terminalRef === terminal) {
					this.activeAgentId.current = id;
					webviewView.webview.postMessage({ type: 'agentSelected', id });
					break;
				}
			}
		});

		vscode.window.onDidCloseTerminal((closed) => {
			for (const [id, agent] of this.agents) {
				if (agent.terminalRef && agent.terminalRef === closed) {
					if (this.activeAgentId.current === id) {
						this.activeAgentId.current = null;
					}
					if (agent.isExternal || agent.isTmux) {
						// Detach terminal — character stays, can re-attach on next click
						agent.terminalRef = null;
						this.persistAgents();
					} else {
						removeAgent(
							id, this.agents,
							this.fileWatchers, this.pollingTimers, this.waitingTimers, this.permissionTimers,
							this.jsonlPollTimers, this.persistAgents,
						);
						webviewView.webview.postMessage({ type: 'agentClosed', id });
					}
				}
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

	private launchTmuxAgent(): void {
		const cwd = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
		const projectDir = getProjectDirPath(cwd);
		if (!projectDir || !cwd) {
			vscode.window.showWarningMessage('Pixel Agents: No workspace folder found.');
			return;
		}

		const idx = this.nextTerminalIndex.current++;
		const windowName = `agent-${idx}`;
		const sessionId = crypto.randomUUID();

		// Ensure tmux session exists
		if (!tmuxSessionExists(TMUX_SESSION_NAME)) {
			createTmuxSession(TMUX_SESSION_NAME, windowName, cwd);
		} else {
			createTmuxWindow(TMUX_SESSION_NAME, windowName, cwd);
		}

		// Run claude in the tmux window
		tmuxSendKeys(TMUX_SESSION_NAME, windowName, `claude --session-id ${sessionId}`);

		// Create VS Code terminal attached to the tmux window
		const terminal = vscode.window.createTerminal({
			name: `${TMUX_TERMINAL_NAME_PREFIX} #${idx}`,
		});
		terminal.sendText(`tmux attach -t ${TMUX_SESSION_NAME}:${windowName}`);
		terminal.show();

		// Pre-register expected JSONL file
		const expectedFile = path.join(projectDir, `${sessionId}.jsonl`);
		this.knownJsonlFiles.add(expectedFile);

		// Create agent
		const id = this.nextAgentId.current++;
		const agent: AgentState = {
			id,
			terminalRef: terminal,
			projectDir,
			jsonlFile: expectedFile,
			fileOffset: 0,
			lineBuffer: '',
			activeToolIds: new Set(),
			activeToolStatuses: new Map(),
			activeToolNames: new Map(),
			activeSubagentToolIds: new Map(),
			activeSubagentToolNames: new Map(),
			isWaiting: false,
			permissionSent: false,
			hadToolsInTurn: false,
			isExternal: false,
			isTmux: true,
			tmuxSessionName: TMUX_SESSION_NAME,
			tmuxWindowName: windowName,
			lastDataTimestamp: Date.now(),
		};

		this.agents.set(id, agent);
		this.activeAgentId.current = id;
		this.persistAgents();
		console.log(`[Pixel Agents] Tmux agent ${id}: created window ${TMUX_SESSION_NAME}:${windowName}`);
		this.webview?.postMessage({ type: 'agentCreated', id });

		ensureProjectScan(
			projectDir, this.knownJsonlFiles, this.projectScanTimer, this.activeAgentId,
			this.nextAgentId, this.agents,
			this.fileWatchers, this.pollingTimers, this.waitingTimers, this.permissionTimers,
			this.webview, this.persistAgents,
		);

		// Poll for the JSONL file to appear
		const pollTimer = setInterval(() => {
			try {
				if (fs.existsSync(agent.jsonlFile)) {
					console.log(`[Pixel Agents] Tmux agent ${id}: found JSONL file`);
					clearInterval(pollTimer);
					this.jsonlPollTimers.delete(id);
					startFileWatching(id, agent.jsonlFile, this.agents, this.fileWatchers, this.pollingTimers, this.waitingTimers, this.permissionTimers, this.webview);
					readNewLines(id, this.agents, this.waitingTimers, this.permissionTimers, this.webview);
				}
			} catch { /* file may not exist yet */ }
		}, 1000);
		this.jsonlPollTimers.set(id, pollTimer);
	}

	private reattachTmuxAgent(agent: AgentState): void {
		const idx = this.nextTerminalIndex.current++;
		const terminal = vscode.window.createTerminal({
			name: `${TMUX_TERMINAL_NAME_PREFIX} #${idx}`,
		});
		terminal.sendText(`tmux attach -t ${agent.tmuxSessionName}:${agent.tmuxWindowName}`);
		terminal.show();
		agent.terminalRef = terminal;
		this.persistAgents();
		console.log(`[Pixel Agents] Re-attached tmux agent ${agent.id} to ${agent.tmuxSessionName}:${agent.tmuxWindowName}`);
	}

	private attachExternalAgent(agent: AgentState): void {
		if (!isTmuxAvailable()) {
			vscode.window.showInformationMessage('Pixel Agents: tmux is not installed. Cannot attach to external session.');
			return;
		}

		const sessionName = resolveTmuxSession(agent.projectDir);
		if (!sessionName) {
			vscode.window.showInformationMessage('Pixel Agents: Could not find a tmux session for this agent.');
			return;
		}

		const idx = this.nextTerminalIndex.current++;
		const terminal = vscode.window.createTerminal({
			name: `${TMUX_TERMINAL_NAME_PREFIX} #${idx}`,
		});
		terminal.sendText(`tmux attach -t ${sessionName}`);
		terminal.show();

		agent.terminalRef = terminal;
		this.persistAgents();
		console.log(`[Pixel Agents] Attached external agent ${agent.id} to tmux session "${sessionName}"`);
	}

	private startExternalScanning(): void {
		if (this.externalScanTimer) return;
		const projectDir = getProjectDirPath();
		if (!projectDir) return;

		this.externalScanTimer = startExternalAgentScanning(
			projectDir, this.nextAgentId, this.agents,
			this.fileWatchers, this.pollingTimers, this.waitingTimers, this.permissionTimers,
			this.webview, this.persistAgents,
		);
		this.staleCheckTimer = startStaleExternalAgentCheck(
			this.agents,
			this.fileWatchers, this.pollingTimers, this.waitingTimers, this.permissionTimers,
			this.jsonlPollTimers, this.webview, this.persistAgents,
		);
		console.log('[Pixel Agents] External agent scanning started');
	}

	private stopExternalScanning(): void {
		if (this.externalScanTimer) {
			clearInterval(this.externalScanTimer);
			this.externalScanTimer = null;
		}
		if (this.staleCheckTimer) {
			clearInterval(this.staleCheckTimer);
			this.staleCheckTimer = null;
		}
		// Remove all currently tracked external agents
		for (const [id, agent] of this.agents) {
			if (agent.isExternal) {
				removeAgent(
					id, this.agents,
					this.fileWatchers, this.pollingTimers, this.waitingTimers, this.permissionTimers,
					this.jsonlPollTimers, this.persistAgents,
				);
				this.webview?.postMessage({ type: 'agentClosed', id });
			}
		}
		console.log('[Pixel Agents] External agent scanning stopped');
	}

	private startLayoutWatcher(): void {
		if (this.layoutWatcher) return;
		this.layoutWatcher = watchLayoutFile((layout) => {
			console.log('[Pixel Agents] External layout change — pushing to webview');
			this.webview?.postMessage({ type: 'layoutLoaded', layout });
		});
	}

	dispose() {
		this.layoutWatcher?.dispose();
		this.layoutWatcher = null;
		this.stopExternalScanning();
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
