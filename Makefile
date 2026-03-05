.PHONY: all install build dev electron clean server server-build server-stop

# Build everything and launch Electron
all: install build electron

# Install dependencies (root + webview + electron + server)
install:
	npm install
	cd webview-ui && npm install
	cd electron && npm install
	cd server && npm install

# Build extension + webview
build:
	npm run compile

# Build everything including server
build-all: build server-build

# Watch mode (extension + types)
dev:
	npm run watch

# Build webview + launch Electron standalone app
electron:
	npm run electron:dev

# Package Electron app (dmg/AppImage/nsis)
electron-package:
	npm run electron:build

# ── Multiuser Server ─────────────────────────────────────
PORT ?= 4200

# Build the server
server-build:
	cd server && npm run build

# Run the server (builds first if needed)
server: server-build
	cd server && node dist/index.js --port $(PORT)

# Stop the server (if running in background)
server-stop:
	@lsof -ti:$(PORT) | xargs kill 2>/dev/null || echo "No server running on port $(PORT)"

# Clean build artifacts
clean:
	rm -rf dist
	rm -rf webview-ui/dist
	rm -rf server/dist
	cd electron && npm run clean
