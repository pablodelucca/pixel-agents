import * as http from 'http';
import * as https from 'https';
import WebSocket from 'ws';
import type { AgentState, MessageEmitter } from './types.js';
import {
	SYNC_HEARTBEAT_INTERVAL_MS,
	SYNC_LAYOUT_POLL_INTERVAL_MS,
	SYNC_RECONNECT_BASE_MS,
	SYNC_RECONNECT_MAX_MS,
} from './constants.js';

interface RemoteAgent {
	id: number;
	name: string;
	status: 'active' | 'idle' | 'waiting' | 'permission';
	activeTool?: string;
	seatId?: string;
	palette: number;
	hueShift: number;
}

interface PresenceClient {
	clientId: string;
	userName: string;
	agents: RemoteAgent[];
}

export class SyncClient {
	private ws: WebSocket | null = null;
	private serverUrl: string;
	private httpBaseUrl: string;
	private userName: string;
	private agents: Map<number, AgentState>;
	private webview: MessageEmitter | undefined;
	private heartbeatTimer: ReturnType<typeof setInterval> | null = null;
	private layoutPollTimer: ReturnType<typeof setInterval> | null = null;
	private reconnectTimer: ReturnType<typeof setTimeout> | null = null;
	private reconnectDelay = SYNC_RECONNECT_BASE_MS;
	private layoutEtag = '';
	private disposed = false;
	private onRemoteLayoutChanged: ((layout: Record<string, unknown>) => void) | null = null;

	constructor(
		serverUrl: string,
		userName: string,
		agents: Map<number, AgentState>,
		webview: MessageEmitter | undefined,
		onRemoteLayoutChanged?: (layout: Record<string, unknown>) => void,
	) {
		this.serverUrl = serverUrl;
		this.userName = userName;
		this.agents = agents;
		this.webview = webview;
		this.onRemoteLayoutChanged = onRemoteLayoutChanged || null;

		// Derive HTTP base URL from WS URL
		this.httpBaseUrl = serverUrl
			.replace(/^ws:/, 'http:')
			.replace(/^wss:/, 'https:');

		this.connect();
		this.startLayoutPolling();
	}

	setWebview(webview: MessageEmitter | undefined): void {
		this.webview = webview;
	}

	updateUserName(userName: string): void {
		this.userName = userName;
		if (this.ws?.readyState === WebSocket.OPEN) {
			this.ws.send(JSON.stringify({ type: 'join', userName }));
		}
	}

	private connect(): void {
		if (this.disposed) return;

		try {
			this.ws = new WebSocket(this.serverUrl);

			this.ws.on('open', () => {
				console.log('[SyncClient] Connected to server');
				this.reconnectDelay = SYNC_RECONNECT_BASE_MS;
				this.ws!.send(JSON.stringify({ type: 'join', userName: this.userName }));
				this.startHeartbeat();
			});

			this.ws.on('message', (data) => {
				try {
					const msg = JSON.parse(data.toString());
					if (msg.type === 'presence') {
						this.handlePresence(msg.clients as PresenceClient[]);
					} else if (msg.type === 'layoutChanged') {
						this.fetchLayout();
					}
				} catch (err) {
					console.error('[SyncClient] Bad server message:', err);
				}
			});

			this.ws.on('close', () => {
				console.log('[SyncClient] Disconnected');
				this.stopHeartbeat();
				this.scheduleReconnect();
			});

			this.ws.on('error', (err) => {
				console.error('[SyncClient] WS error:', err);
			});
		} catch (err) {
			console.error('[SyncClient] Connection failed:', err);
			this.scheduleReconnect();
		}
	}

	private scheduleReconnect(): void {
		if (this.disposed) return;
		if (this.reconnectTimer) return;

		this.reconnectTimer = setTimeout(() => {
			this.reconnectTimer = null;
			this.connect();
		}, this.reconnectDelay);

		this.reconnectDelay = Math.min(this.reconnectDelay * 2, SYNC_RECONNECT_MAX_MS);
	}

	private startHeartbeat(): void {
		this.stopHeartbeat();
		this.sendHeartbeat();
		this.heartbeatTimer = setInterval(() => this.sendHeartbeat(), SYNC_HEARTBEAT_INTERVAL_MS);
	}

	private stopHeartbeat(): void {
		if (this.heartbeatTimer) {
			clearInterval(this.heartbeatTimer);
			this.heartbeatTimer = null;
		}
	}

	private sendHeartbeat(): void {
		if (!this.ws || this.ws.readyState !== WebSocket.OPEN) return;

		const agents: RemoteAgent[] = [];
		for (const [id, agent] of this.agents) {
			if (agent.isExternal) continue;

			let status: RemoteAgent['status'] = 'idle';
			if (agent.permissionSent) status = 'permission';
			else if (agent.isWaiting) status = 'waiting';
			else if (agent.activeToolIds.size > 0 || agent.hadToolsInTurn) status = 'active';

			let activeTool: string | undefined;
			for (const toolName of agent.activeToolNames.values()) {
				activeTool = toolName;
				break;
			}

			agents.push({
				id,
				name: agent.terminalRef?.name || `Agent ${id}`,
				status,
				activeTool,
				palette: 0,
				hueShift: 0,
			});
		}

		this.ws.send(JSON.stringify({ type: 'heartbeat', agents }));
	}

	private handlePresence(clients: PresenceClient[]): void {
		this.webview?.postMessage({
			type: 'remoteAgents',
			clients,
		});
	}

	private startLayoutPolling(): void {
		this.layoutPollTimer = setInterval(() => this.fetchLayout(), SYNC_LAYOUT_POLL_INTERVAL_MS);
	}

	private fetchLayout(): void {
		const url = new URL('/layout', this.httpBaseUrl);
		const mod = url.protocol === 'https:' ? https : http;

		const headers: Record<string, string> = {};
		if (this.layoutEtag) {
			headers['If-None-Match'] = this.layoutEtag;
		}

		const req = mod.get(url.toString(), { headers }, (res) => {
			if (res.statusCode === 304) return;

			let body = '';
			res.on('data', (chunk: string) => { body += chunk; });
			res.on('end', () => {
				if (res.statusCode === 200) {
					const newEtag = res.headers['etag'] as string;
					if (newEtag && newEtag !== this.layoutEtag) {
						this.layoutEtag = newEtag;
						try {
							const layout = JSON.parse(body) as Record<string, unknown>;
							this.onRemoteLayoutChanged?.(layout);
						} catch (err) {
							console.error('[SyncClient] Bad layout JSON:', err);
						}
					}
				}
			});
		});

		req.on('error', (err) => {
			console.error('[SyncClient] Layout fetch error:', err);
		});
	}

	putLayout(layout: Record<string, unknown>): void {
		const json = JSON.stringify(layout);
		const url = new URL('/layout', this.httpBaseUrl);
		const mod = url.protocol === 'https:' ? https : http;

		const req = mod.request(url.toString(), {
			method: 'PUT',
			headers: {
				'Content-Type': 'application/json',
				'Content-Length': Buffer.byteLength(json).toString(),
			},
		}, (res) => {
			let body = '';
			res.on('data', (chunk: string) => { body += chunk; });
			res.on('end', () => {
				if (res.statusCode === 200) {
					try {
						const result = JSON.parse(body);
						this.layoutEtag = result.etag;
					} catch { /* ignore */ }
				}
			});
		});

		req.on('error', (err) => {
			console.error('[SyncClient] Layout PUT error:', err);
		});

		req.write(json);
		req.end();
	}

	dispose(): void {
		this.disposed = true;
		this.stopHeartbeat();
		if (this.layoutPollTimer) {
			clearInterval(this.layoutPollTimer);
			this.layoutPollTimer = null;
		}
		if (this.reconnectTimer) {
			clearTimeout(this.reconnectTimer);
			this.reconnectTimer = null;
		}
		if (this.ws) {
			this.ws.close();
			this.ws = null;
		}
	}
}
