/**
 * HTTP + WebSocket Server for Pixel Agents CLI
 *
 * Serves static files from dist/webview/ and handles WebSocket connections on /ws.
 * No Express needed — plain Node.js http.createServer (~60 lines).
 */

import * as http from 'http';
import * as fs from 'fs';
import * as path from 'path';
import { WebSocketServer } from 'ws';
import type { CliOrchestrator } from './cliOrchestrator.js';

const MIME_TYPES: Record<string, string> = {
	'.html': 'text/html',
	'.js': 'application/javascript',
	'.css': 'text/css',
	'.json': 'application/json',
	'.png': 'image/png',
	'.jpg': 'image/jpeg',
	'.jpeg': 'image/jpeg',
	'.svg': 'image/svg+xml',
	'.ttf': 'font/ttf',
	'.woff': 'font/woff',
	'.woff2': 'font/woff2',
	'.ico': 'image/x-icon',
	'.mp3': 'audio/mpeg',
	'.wav': 'audio/wav',
};

export function createServer(
	webviewDir: string,
	orchestrator: CliOrchestrator,
): http.Server {
	const server = http.createServer((req, res) => {
		let urlPath = req.url?.split('?')[0] || '/';
		if (urlPath === '/') urlPath = '/index.html';

		const filePath = path.join(webviewDir, urlPath);

		// Prevent directory traversal
		if (!filePath.startsWith(webviewDir)) {
			res.writeHead(403);
			res.end('Forbidden');
			return;
		}

		fs.readFile(filePath, (err, data) => {
			if (err) {
				res.writeHead(404);
				res.end('Not Found');
				return;
			}

			const ext = path.extname(filePath).toLowerCase();
			const contentType = MIME_TYPES[ext] || 'application/octet-stream';
			res.writeHead(200, { 'Content-Type': contentType });
			res.end(data);
		});
	});

	// WebSocket server on /ws path
	const wss = new WebSocketServer({ server, path: '/ws' });
	wss.on('connection', (ws) => {
		console.log('[CLI] WebSocket client connected');
		orchestrator.addClient(ws);
		ws.on('close', () => {
			console.log('[CLI] WebSocket client disconnected');
		});
	});

	return server;
}
