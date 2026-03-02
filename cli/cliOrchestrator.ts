/**
 * CLI Orchestrator — Replaces PixelAgentsViewProvider for standalone CLI mode
 *
 * Creates a webview shim that broadcasts JSON to WebSocket clients.
 * Handles incoming messages using the same protocol as the VS Code extension.
 * Reuses backend modules directly (assetLoader, layoutPersistence, fileWatcher, etc.).
 */

import * as fs from 'fs';
import * as path from 'path';
import type { WebSocket } from 'ws';
import type { AgentState } from '../src/types.js';
import {
	loadFurnitureAssets,
	loadFloorTiles,
	loadWallTiles,
	loadCharacterSprites,
	loadDefaultLayout,
} from '../src/assetLoader.js';
import {
	readLayoutFromFile,
	writeLayoutToFile,
	watchLayoutFile,
} from '../src/layoutPersistence.js';
import type { LayoutWatcher } from '../src/layoutPersistence.js';
import { readSeats, writeSeats, readSettings, writeSettings } from './persistence.js';
import { startSessionScanner } from './sessionScanner.js';

export interface CliOrchestratorOptions {
	/** Path to dist/ directory containing assets/ and webview/ */
	distDir: string;
}

export class CliOrchestrator {
	private clients = new Set<WebSocket>();
	private agents = new Map<number, AgentState>();
	private nextAgentId = { current: 1 };
	private knownJsonlFiles = new Set<string>();

	// Per-agent timers (same shape as PixelAgentsViewProvider)
	private fileWatchers = new Map<number, fs.FSWatcher>();
	private pollingTimers = new Map<number, ReturnType<typeof setInterval>>();
	private waitingTimers = new Map<number, ReturnType<typeof setTimeout>>();
	private permissionTimers = new Map<number, ReturnType<typeof setTimeout>>();

	private defaultLayout: Record<string, unknown> | null = null;
	private layoutWatcher: LayoutWatcher | null = null;
	private sessionScannerDispose: (() => void) | null = null;

	/** Webview shim — broadcasts to all connected WS clients */
	readonly webview: { postMessage(msg: unknown): void };

	constructor(private readonly opts: CliOrchestratorOptions) {
		this.webview = {
			postMessage: (msg: unknown) => {
				const json = JSON.stringify(msg);
				for (const ws of this.clients) {
					if (ws.readyState === 1 /* OPEN */) {
						ws.send(json);
					}
				}
			},
		};
	}

	addClient(ws: WebSocket): void {
		this.clients.add(ws);
		ws.on('close', () => this.clients.delete(ws));
		ws.on('message', (data) => {
			try {
				const msg = JSON.parse(data.toString());
				this.handleMessage(msg);
			} catch { /* ignore malformed */ }
		});
	}

	private async handleMessage(message: Record<string, unknown>): Promise<void> {
		switch (message.type) {
			case 'webviewReady':
				await this.onWebviewReady();
				break;

			case 'saveLayout':
				this.layoutWatcher?.markOwnWrite();
				writeLayoutToFile(message.layout as Record<string, unknown>);
				break;

			case 'saveAgentSeats':
				writeSeats(message.seats as Record<string, unknown>);
				break;

			case 'setSoundEnabled':
				writeSettings({ soundEnabled: message.enabled as boolean });
				break;

			case 'exportLayout': {
				const layout = readLayoutFromFile();
				if (layout) {
					this.webview.postMessage({
						type: 'exportLayoutData',
						layout: JSON.stringify(layout, null, 2),
					});
				}
				break;
			}

			case 'importLayoutData': {
				const imported = message.layout as Record<string, unknown>;
				if (imported && imported.version === 1 && Array.isArray(imported.tiles)) {
					this.layoutWatcher?.markOwnWrite();
					writeLayoutToFile(imported);
					this.webview.postMessage({ type: 'layoutLoaded', layout: imported });
				}
				break;
			}

			// No-ops for CLI mode
			case 'openClaude':
			case 'focusAgent':
			case 'closeAgent':
			case 'openSessionsFolder':
			case 'importLayout':
				break;
		}
	}

	private async onWebviewReady(): Promise<void> {
		const assetsRoot = this.opts.distDir;
		const assetsDir = path.join(assetsRoot, 'assets');

		// Load and send assets in order
		try {
			// Load bundled default layout
			this.defaultLayout = loadDefaultLayout(assetsRoot);

			// Character sprites
			if (fs.existsSync(path.join(assetsDir, 'characters'))) {
				const charSprites = await loadCharacterSprites(assetsRoot);
				if (charSprites) {
					this.webview.postMessage({
						type: 'characterSpritesLoaded',
						characters: charSprites.characters,
					});
				}
			}

			// Floor tiles
			if (fs.existsSync(path.join(assetsDir, 'floors.png'))) {
				const floorTiles = await loadFloorTiles(assetsRoot);
				if (floorTiles) {
					this.webview.postMessage({
						type: 'floorTilesLoaded',
						sprites: floorTiles.sprites,
					});
				}
			}

			// Wall tiles
			if (fs.existsSync(path.join(assetsDir, 'walls.png'))) {
				const wallTiles = await loadWallTiles(assetsRoot);
				if (wallTiles) {
					this.webview.postMessage({
						type: 'wallTilesLoaded',
						sprites: wallTiles.sprites,
					});
				}
			}

			// Furniture
			const furnitureAssets = await loadFurnitureAssets(assetsRoot);
			if (furnitureAssets) {
				const spritesObj: Record<string, string[][]> = {};
				for (const [id, spriteData] of furnitureAssets.sprites) {
					spritesObj[id] = spriteData;
				}
				this.webview.postMessage({
					type: 'furnitureAssetsLoaded',
					catalog: furnitureAssets.catalog,
					sprites: spritesObj,
				});
			}
		} catch (err) {
			console.error('[CLI] Error loading assets:', err);
		}

		// Send settings
		const settings = readSettings();
		this.webview.postMessage({ type: 'settingsLoaded', soundEnabled: settings.soundEnabled });

		// Send layout
		const layout = readLayoutFromFile() || this.defaultLayout;
		if (layout) {
			this.webview.postMessage({ type: 'layoutLoaded', layout });
		}

		// Start layout watcher
		if (!this.layoutWatcher) {
			this.layoutWatcher = watchLayoutFile((updatedLayout) => {
				this.webview.postMessage({ type: 'layoutLoaded', layout: updatedLayout });
			});
		}

		// Send existing agents
		this.sendExistingAgents();

		// Start session scanner
		if (!this.sessionScannerDispose) {
			const scanner = startSessionScanner({
				agents: this.agents,
				nextAgentId: this.nextAgentId,
				knownJsonlFiles: this.knownJsonlFiles,
				fileWatchers: this.fileWatchers,
				pollingTimers: this.pollingTimers,
				waitingTimers: this.waitingTimers,
				permissionTimers: this.permissionTimers,
				webview: this.webview as never,
				onAgentCreated: (agentId, folderName) => {
					this.webview.postMessage({ type: 'agentCreated', id: agentId, folderName });
				},
			});
			this.sessionScannerDispose = scanner.dispose;
		}
	}

	private sendExistingAgents(): void {
		const agentIds = [...this.agents.keys()].sort((a, b) => a - b);
		const agentMeta = readSeats();
		const folderNames: Record<number, string> = {};
		for (const [id, agent] of this.agents) {
			if (agent.folderName) {
				folderNames[id] = agent.folderName;
			}
		}
		this.webview.postMessage({
			type: 'existingAgents',
			agents: agentIds,
			agentMeta,
			folderNames,
		});

		// Re-send current statuses
		for (const [agentId, agent] of this.agents) {
			for (const [toolId, status] of agent.activeToolStatuses) {
				this.webview.postMessage({
					type: 'agentToolStart',
					id: agentId,
					toolId,
					status,
				});
			}
			if (agent.isWaiting) {
				this.webview.postMessage({
					type: 'agentStatus',
					id: agentId,
					status: 'waiting',
				});
			}
		}
	}

	dispose(): void {
		this.layoutWatcher?.dispose();
		this.layoutWatcher = null;
		this.sessionScannerDispose?.();
		this.sessionScannerDispose = null;

		// Clean up all agent timers
		for (const w of this.fileWatchers.values()) w.close();
		this.fileWatchers.clear();
		for (const t of this.pollingTimers.values()) clearInterval(t);
		this.pollingTimers.clear();
		for (const t of this.waitingTimers.values()) clearTimeout(t);
		this.waitingTimers.clear();
		for (const t of this.permissionTimers.values()) clearTimeout(t);
		this.permissionTimers.clear();

		// Unwatch all JSONL files
		for (const agent of this.agents.values()) {
			try { fs.unwatchFile(agent.jsonlFile); } catch { /* ignore */ }
		}

		// Close all WebSocket connections
		for (const ws of this.clients) {
			ws.close();
		}
		this.clients.clear();
	}
}
