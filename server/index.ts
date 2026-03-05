import * as fs from 'fs';
import * as path from 'path';
import { createServer } from 'http';
import express from 'express';
import type { AgentState } from './types.js';
import { initWebSocket, broadcast, sendTo, setMessageHandler, setConnectHandler, setDisconnectHandler, dispose as disposeWs } from './wsManager.js';
import { handlePeerMessage, handlePeerDisconnect } from './peerManager.js';
import type { PeerContext } from './peerManager.js';
import { createRouter } from './routes.js';
import type { RouteContext } from './routes.js';
import { persistAgents as doPersistAgents } from './agentManager.js';
import { loadLayout, watchLayoutFile, writeLayoutToFile, readLayoutFromFile } from './layoutPersistence.js';
import type { LayoutWatcher } from './layoutPersistence.js';
import { readSettings, setAgentSeats, setSoundEnabled } from './settingsStore.js';
import { DEFAULT_PORT } from './constants.js';
import { feedAgentText, flushAgent } from './chatSummarizer.js';

// -- Shared state --
const agents = new Map<number, AgentState>();
const nextAgentIdRef = { current: 1 };

let layoutWatcher: LayoutWatcher | null = null;

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
	agents,
	emit: broadcast,
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

// -- Peer context --
const peerCtx: PeerContext = {
	nextAgentIdRef,
	agents,
	emit: broadcast,
	persistAgents,
};

// -- Chat summarizer callback --
function onChatSummary(agentId: number, sender: string, summary: string): void {
	broadcast({ type: 'chatMessage', agentId, sender, text: summary, timestamp: Date.now() });
}

// -- Intercept agentText from emit for chat summarization --
const originalBroadcast = broadcast;
function instrumentedBroadcast(msg: unknown): void {
	originalBroadcast(msg);
	const m = msg as Record<string, unknown>;
	if (m.type === 'agentText') {
		const agentId = m.id as number;
		const text = m.text as string;
		const agent = agents.get(agentId);
		const name = agent?.label || `Agent ${agentId}`;
		feedAgentText(agentId, text, name, onChatSummary);
	} else if (m.type === 'agentStatus' && m.status === 'waiting') {
		const agentId = m.id as number;
		const agent = agents.get(agentId);
		const name = agent?.label || `Agent ${agentId}`;
		flushAgent(agentId, name, onChatSummary);
	}
}
peerCtx.emit = instrumentedBroadcast;

// -- WS message handler --
setMessageHandler((msg, ws) => {
	// Try peer protocol first
	if (handlePeerMessage(ws, msg, peerCtx)) return;

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

// -- Peer disconnect handler --
setDisconnectHandler((ws) => {
	handlePeerDisconnect(ws, peerCtx);
});

// -- Send initial state to new WS clients --
setConnectHandler((ws) => {
	const settings = readSettings();
	sendTo(ws, { type: 'settingsLoaded', soundEnabled: settings.soundEnabled });

	// Send existing agents (all remote, from peers)
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

// -- Start server --
server.listen(port, () => {
	console.log(`[Pixel Office] Server running at http://localhost:${port}`);
	console.log(`[Pixel Office] Agents join via: bun server/join.ts ws://HOST:${port}/ws --name NAME`);
});

// -- Graceful shutdown --
function cleanup(): void {
	console.log('\n[Pixel Office] Shutting down...');
	layoutWatcher?.dispose();
	disposeWs();
	server.close();
	process.exit(0);
}

process.on('SIGINT', cleanup);
process.on('SIGTERM', cleanup);
