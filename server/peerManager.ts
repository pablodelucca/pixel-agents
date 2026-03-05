import { WebSocket } from 'ws';
import type { AgentState } from './types.js';

interface PeerState {
	peerId: string;
	name: string;
	ws: WebSocket;
	/** Maps peer's local agent ID -> host's global agent ID */
	agentIdMap: Map<number, number>;
}

const peers = new Map<string, PeerState>();
const wsToPeer = new Map<WebSocket, string>();

export interface PeerContext {
	nextAgentIdRef: { current: number };
	agents: Map<number, AgentState>;
	emit: (msg: unknown) => void;
	persistAgents: () => void;
}

function findPeer(ws: WebSocket): PeerState | null {
	const peerId = wsToPeer.get(ws);
	if (!peerId) return null;
	return peers.get(peerId) || null;
}

function getGlobalId(peer: PeerState, localId: number): number | null {
	return peer.agentIdMap.get(localId) ?? null;
}

function sendTo(ws: WebSocket, msg: unknown): void {
	if (ws.readyState === WebSocket.OPEN) {
		ws.send(JSON.stringify(msg));
	}
}

/**
 * Handle a peer protocol message. Returns true if the message was handled.
 */
export function handlePeerMessage(ws: WebSocket, msg: Record<string, unknown>, ctx: PeerContext): boolean {
	const type = msg.type as string;
	if (!type?.startsWith('peer')) return false;

	if (type === 'peerRegister') {
		const name = (msg.name as string) || 'Remote';
		const peerId = crypto.randomUUID();
		const peer: PeerState = { peerId, name, ws, agentIdMap: new Map() };
		peers.set(peerId, peer);
		wsToPeer.set(ws, peerId);
		console.log(`[PeerManager] Peer registered: "${name}" (${peerId})`);
		sendTo(ws, { type: 'peerRegistered', peerId });
		return true;
	}

	const peer = findPeer(ws);
	if (!peer) {
		console.warn(`[PeerManager] Message from unregistered peer: ${type}`);
		return true;
	}

	const localId = msg.localId as number;

	if (type === 'peerAgentCreated') {
		const folderName = msg.folderName as string | undefined;
		const globalId = ctx.nextAgentIdRef.current++;
		peer.agentIdMap.set(localId, globalId);

		const agent: AgentState = {
			id: globalId,
			ptyProcess: null,
			projectDir: '',
			jsonlFile: '',
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
			isExternal: true,
			isRemote: true,
			peerId: peer.peerId,
			peerLocalId: localId,
			peerName: peer.name,
			label: folderName ? `${peer.name}: ${folderName}` : peer.name,
		};

		ctx.agents.set(globalId, agent);
		ctx.persistAgents();
		console.log(`[PeerManager] Peer "${peer.name}" agent created: local=${localId} -> global=${globalId}`);
		ctx.emit({ type: 'agentCreated', id: globalId, folderName: agent.label });
		return true;
	}

	if (type === 'peerAgentClosed') {
		const globalId = getGlobalId(peer, localId);
		if (globalId === null) return true;
		peer.agentIdMap.delete(localId);
		ctx.agents.delete(globalId);
		ctx.persistAgents();
		console.log(`[PeerManager] Peer "${peer.name}" agent closed: global=${globalId}`);
		ctx.emit({ type: 'agentClosed', id: globalId });
		return true;
	}

	// Simple forwarding messages: translate localId -> globalId and re-emit
	const globalId = getGlobalId(peer, localId);
	if (globalId === null) return true;

	if (type === 'peerAgentToolStart') {
		ctx.emit({ type: 'agentToolStart', id: globalId, toolId: msg.toolId, status: msg.status });
		// Track on AgentState for late-joining browsers
		const agent = ctx.agents.get(globalId);
		if (agent) {
			const toolId = msg.toolId as string;
			const status = msg.status as string;
			agent.activeToolIds.add(toolId);
			agent.activeToolStatuses.set(toolId, status);
		}
	} else if (type === 'peerAgentToolDone') {
		ctx.emit({ type: 'agentToolDone', id: globalId, toolId: msg.toolId });
		const agent = ctx.agents.get(globalId);
		if (agent) {
			const toolId = msg.toolId as string;
			agent.activeToolIds.delete(toolId);
			agent.activeToolStatuses.delete(toolId);
		}
	} else if (type === 'peerAgentToolsClear') {
		ctx.emit({ type: 'agentToolsClear', id: globalId });
		const agent = ctx.agents.get(globalId);
		if (agent) {
			agent.activeToolIds.clear();
			agent.activeToolStatuses.clear();
			agent.activeToolNames.clear();
			agent.isWaiting = false;
			agent.permissionSent = false;
		}
	} else if (type === 'peerAgentStatus') {
		ctx.emit({ type: 'agentStatus', id: globalId, status: msg.status });
		const agent = ctx.agents.get(globalId);
		if (agent) {
			agent.isWaiting = msg.status === 'waiting';
		}
	} else if (type === 'peerAgentToolPermission') {
		ctx.emit({ type: 'agentToolPermission', id: globalId });
		const agent = ctx.agents.get(globalId);
		if (agent) agent.permissionSent = true;
	} else if (type === 'peerAgentToolPermissionClear') {
		ctx.emit({ type: 'agentToolPermissionClear', id: globalId });
		const agent = ctx.agents.get(globalId);
		if (agent) agent.permissionSent = false;
	} else if (type === 'peerSubagentToolStart') {
		ctx.emit({ type: 'subagentToolStart', id: globalId, parentToolId: msg.parentToolId, toolId: msg.toolId, status: msg.status });
	} else if (type === 'peerSubagentToolDone') {
		ctx.emit({ type: 'subagentToolDone', id: globalId, parentToolId: msg.parentToolId, toolId: msg.toolId });
	} else if (type === 'peerSubagentClear') {
		ctx.emit({ type: 'subagentClear', id: globalId, parentToolId: msg.parentToolId });
	} else if (type === 'peerSubagentToolPermission') {
		ctx.emit({ type: 'subagentToolPermission', id: globalId, parentToolId: msg.parentToolId });
	} else if (type === 'peerAgentTokens') {
		ctx.emit({ type: 'agentTokens', id: globalId, input: msg.input, output: msg.output, cacheRead: msg.cacheRead, cacheCreation: msg.cacheCreation });
	} else if (type === 'peerAgentText') {
		ctx.emit({ type: 'agentText', id: globalId, text: msg.text });
	}

	return true;
}

/**
 * Called when a WebSocket disconnects. If it belongs to a peer, clean up all their agents.
 */
export function handlePeerDisconnect(ws: WebSocket, ctx: PeerContext): void {
	const peerId = wsToPeer.get(ws);
	if (!peerId) return;

	const peer = peers.get(peerId);
	if (!peer) return;

	console.log(`[PeerManager] Peer "${peer.name}" disconnected — removing ${peer.agentIdMap.size} agents`);

	for (const globalId of peer.agentIdMap.values()) {
		ctx.agents.delete(globalId);
		ctx.emit({ type: 'agentClosed', id: globalId });
	}

	peers.delete(peerId);
	wsToPeer.delete(ws);
	ctx.persistAgents();
}

export function isPeer(ws: WebSocket): boolean {
	return wsToPeer.has(ws);
}
