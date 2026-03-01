.PHONY: dev stop restart build clean logs status

PID_DIR := .pids
DEVSERVER_PID := $(PID_DIR)/devserver.pid
VITE_PID := $(PID_DIR)/vite.pid

dev: $(PID_DIR)
	@echo "Building backend..."
	@npm run build:backend 2>/dev/null
	@echo "Starting devServer..."
	@node dist/devServer.js &
	@echo $$! > $(DEVSERVER_PID)
	@sleep 1
	@echo "Starting Vite..."
	@cd webview-ui && npm run dev &
	@echo $$! > $(VITE_PID)
	@echo ""
	@echo "Servers started!"
	@echo "  - DevServer: ws://localhost:3100"
	@echo "  - Vite:      http://localhost:5173"
	@echo ""
	@echo "Run 'make stop' to stop the servers."

stop:
	@if [ -f $(DEVSERVER_PID) ]; then \
		kill $$(cat $(DEVSERVER_PID)) 2>/dev/null || true; \
		rm -f $(DEVSERVER_PID); \
	fi
	@if [ -f $(VITE_PID) ]; then \
		kill $$(cat $(VITE_PID)) 2>/dev/null || true; \
		rm -f $(VITE_PID); \
	fi
	@pkill -f "devServer" 2>/dev/null || true
	@pkill -f "vite.*5173" 2>/dev/null || true
	@echo "Servers stopped."

restart: stop
	@sleep 1
	@$(MAKE) dev

build:
	@echo "Building project..."
	npm run build

clean: stop
	@echo "Cleaning dist..."
	rm -rf dist/
	@echo "Done."

logs:
	@echo "DevServer logs (Ctrl+C to exit):"
	@tail -f /dev/null

status:
	@echo "Server status:"
	@if pgrep -f "devServer" > /dev/null; then \
		echo "  devServer: running (PID $$(pgrep -f devServer))"; \
	else \
		echo "  devServer: stopped"; \
	fi
	@if pgrep -f "vite.*5173" > /dev/null; then \
		echo "  Vite:      running (PID $$(pgrep -f "vite.*5173"))"; \
	else \
		echo "  Vite:      stopped"; \
	fi

$(PID_DIR):
	@mkdir -p $(PID_DIR)
