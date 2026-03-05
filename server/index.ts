import * as fs from 'fs';
import * as path from 'path';
import { createServer } from 'http';
import express from 'express';
import type { AgentState } from './types.js';
import { initWebSocket, broadcast, sendTo, setMessageHandler, setConnectHandler, dispose as disposeWs } from './wsManager.js';
import { createRouter } from './routes.js';
import type { RouteContext } from './routes.js';
import {
	persistAgents as doPersistAgents,
	restoreAgents,
	sendExistingAgents,
} from './agentManager.js';
import { loadLayout, watchLayoutFile, writeLayoutToFile, readLayoutFromFile } from './layoutPersistence.js';
import type { LayoutWatcher } from './layoutPersistence.js';
import { readSettings, writeSettings, setAgentSeats, setSoundEnabled } from './settingsStore.js';
import { startSessionScanner } from './sessionScanner.js';
import { DEFAULT_PORT } from './constants.js';

// -- Shared state --
const agents = new Map<number, AgentState>();
const nextAgentIdRef = { current: 1 };
const activeAgentIdRef = { current: null as number | null };
const knownJsonlFiles = new Set<string>();
const fileWatchers = new Map<number, fs.FSWatcher>();
const pollingTimers = new Map<number, ReturnType<typeof setInterval>>();
const waitingTimers = new Map<number, ReturnType<typeof setTimeout>>();
const permissionTimers = new Map<number, ReturnType<typeof setTimeout>>();
const jsonlPollTimers = new Map<number, ReturnType<typeof setInterval>>();
const projectScanTimerRef = { current: null as ReturnType<typeof setInterval> | null };

let layoutWatcher: LayoutWatcher | null = null;
let sessionScanTimer: ReturnType<typeof setInterval> | null = null;

const cwd = process.argv[2] || process.cwd();
const port = parseInt(process.env.PORT || String(DEFAULT_PORT), 10);

function persistAgents(): void {
	doPersistAgents(agents);
}

// -- Express app --
const app = express();
app.use(express.json({ limit: '10mb' }));

// Serve webview-ui dist (built frontend)
const webviewDistPath = path.join(import.meta.dirname, '..', 'webview-ui', 'dist');
if (fs.existsSync(webviewDistPath)) {
	app.use(express.static(webviewDistPath));
}

// Serve assets (PNGs, catalog JSON, default layout)
const assetsPath = path.join(import.meta.dirname, '..', 'webview-ui', 'public', 'assets');
if (fs.existsSync(assetsPath)) {
	app.use('/assets', express.static(assetsPath));
}
// Also try dist/assets for production builds
const distAssetsPath = path.join(import.meta.dirname, '..', 'webview-ui', 'dist', 'assets');
if (fs.existsSync(distAssetsPath)) {
	app.use('/assets', express.static(distAssetsPath));
}

// Route context
const routeCtx: RouteContext = {
	nextAgentIdRef,
	agents,
	activeAgentIdRef,
	knownJsonlFiles,
	fileWatchers,
	pollingTimers,
	waitingTimers,
	permissionTimers,
	jsonlPollTimers,
	projectScanTimerRef,
	emit: broadcast,
	persistAgents,
	cwd,
	layoutWatcher,
};

app.use('/api', createRouter(routeCtx));

// SPA fallback — serve index.html for non-API, non-asset routes
app.use((_req, res) => {
	const indexPath = path.join(webviewDistPath, 'index.html');
	if (fs.existsSync(indexPath)) {
		res.sendFile(indexPath);
	} else {
		res.status(404).send('Frontend not built. Run: cd webview-ui && npm run build');
	}
});

// -- HTTP + WebSocket server --
const server = createServer(app);
initWebSocket(server);

// -- Load default layout --
const defaultLayoutPath = path.join(assetsPath, 'default-layout.json');
let defaultLayout: Record<string, unknown> | null = null;
try {
	if (fs.existsSync(defaultLayoutPath)) {
		defaultLayout = JSON.parse(fs.readFileSync(defaultLayoutPath, 'utf-8'));
	}
} catch { /* ignore */ }

const currentLayout = loadLayout(defaultLayout);

// -- Layout watcher --
layoutWatcher = watchLayoutFile((layout) => {
	console.log('[Server] External layout change — broadcasting');
	broadcast({ type: 'layoutLoaded', layout });
});
routeCtx.layoutWatcher = layoutWatcher;

// -- WS message handler (replaces PixelAgentsViewProvider.onDidReceiveMessage) --
setMessageHandler((msg) => {
	if (msg.type === 'saveAgentSeats') {
		setAgentSeats(msg.seats as Record<string, { palette?: number; hueShift?: number; seatId?: string | null }>);
	} else if (msg.type === 'saveLayout') {
		layoutWatcher?.markOwnWrite();
		writeLayoutToFile(msg.layout as Record<string, unknown>);
	} else if (msg.type === 'setSoundEnabled') {
		setSoundEnabled(msg.enabled as boolean);
	} else if (msg.type === 'webviewReady') {
		// Client connected — state is sent via connect handler
	}
});

// -- Send initial state to new WS clients --
setConnectHandler((ws) => {
	const settings = readSettings();
	sendTo(ws, { type: 'settingsLoaded', soundEnabled: settings.soundEnabled });

	// Send existing agents
	const agentIds = [...agents.keys()].sort((a, b) => a - b);
	const agentSeats = settings.agentSeats || {};
	const folderNames: Record<number, string> = {};
	for (const [id, agent] of agents) {
		if (agent.label) folderNames[id] = agent.label;
	}
	sendTo(ws, {
		type: 'existingAgents',
		agents: agentIds,
		agentMeta: agentSeats,
		folderNames,
	});

	// Send current agent statuses
	for (const [agentId, agent] of agents) {
		for (const [toolId, status] of agent.activeToolStatuses) {
			sendTo(ws, { type: 'agentToolStart', id: agentId, toolId, status });
		}
		if (agent.isWaiting) {
			sendTo(ws, { type: 'agentStatus', id: agentId, status: 'waiting' });
		}
	}

	// Send layout
	const layout = readLayoutFromFile() || currentLayout;
	sendTo(ws, { type: 'layoutLoaded', layout });
});

// -- Restore agents from persistence --
restoreAgents(
	nextAgentIdRef, agents, knownJsonlFiles,
	fileWatchers, pollingTimers, waitingTimers, permissionTimers,
	jsonlPollTimers, projectScanTimerRef, activeAgentIdRef,
	broadcast, persistAgents,
);

// -- Start session scanner --
sessionScanTimer = startSessionScanner(
	nextAgentIdRef, agents, knownJsonlFiles,
	fileWatchers, pollingTimers, waitingTimers, permissionTimers,
	broadcast, persistAgents,
);

// -- Start server --
server.listen(port, () => {
	console.log(`[Pixel Agents] Server running at http://localhost:${port}`);
	console.log(`[Pixel Agents] Working directory: ${cwd}`);
	console.log(`[Pixel Agents] Agents: ${agents.size} restored`);
});

// -- Graceful shutdown --
function cleanup(): void {
	console.log('\n[Pixel Agents] Shutting down...');
	if (sessionScanTimer) clearInterval(sessionScanTimer);
	layoutWatcher?.dispose();
	if (projectScanTimerRef.current) clearInterval(projectScanTimerRef.current);
	for (const timer of pollingTimers.values()) clearInterval(timer);
	for (const timer of jsonlPollTimers.values()) clearInterval(timer);
	for (const watcher of fileWatchers.values()) watcher.close();
	disposeWs();
	server.close();
	process.exit(0);
}

process.on('SIGINT', cleanup);
process.on('SIGTERM', cleanup);
