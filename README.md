# Pixel Agents Remote

> Fork from [pixel-agents](https://github.com/pablodelucca/pixel-agents)

English | [简体中文](README_CN.md)

Transformed the VS Code extension into a standalone web app for remotely monitoring all Claude Code sessions in a browser.

## What's Changed

The original project is a VS Code extension that only works in the sidebar. This version:

- Removed VS Code extension dependency, now a standalone web app
- Added WebSocket server to monitor JSONL files in `~/.claude/projects/`
- Multi-room support with independent layouts per project
- Deployable on remote servers, accessible via domain

## Quick Start

```bash
# Install dependencies
cd remote-server && npm install
cd ../webview-ui && npm install

# Run
npm run dev
```

Visit http://localhost:5174

Windows users can double-click `start-remote.bat`.

## Deployment

### Docker

```bash
docker-compose up -d --build
```

### Nginx + Node.js

```bash
# 1. Start server
cd remote-server && PORT=3000 npx tsx server.ts

# 2. Build frontend
cd webview-ui && npm run build

# 3. Nginx serves dist/webview/ and proxies /ws to port 3000
```

See `nginx.conf.example`.

WebSocket auto-detection:
- localhost → `ws://localhost:3000`
- Server → `wss://current-domain/ws`

## Project Structure

```
remote-server/          WebSocket server, monitors JSONL files
webview-ui/             Frontend
shared/                 Shared assets (sprites, furniture catalog, etc.)
Dockerfile
docker-compose.yml
nginx.conf.example
```

## Usage

- **Green dot**: Agent is executing a tool
- **Gray dot**: Agent is idle
- **Yellow dot**: Waiting for user confirmation

Click Connected (top right) to manage rooms. Each project can have its own room.

## License

MIT