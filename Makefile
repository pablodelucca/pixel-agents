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
	@echo "  - Vite:      http://localhost:5174"
	@echo ""
	@echo "Run 'make stop' to stop the servers."

stop:
	@echo "Stopping servers..."
	@# Kill by PID file first
	@if [ -f $(DEVSERVER_PID) ]; then \
		kill $$(cat $(DEVSERVER_PID)) 2>/dev/null || true; \
		rm -f $(DEVSERVER_PID); \
	fi
	@if [ -f $(VITE_PID) ]; then \
		kill $$(cat $(VITE_PID)) 2>/dev/null || true; \
		rm -f $(VITE_PID); \
	fi
	@# Kill any remaining processes on our ports (most reliable)
	@for port in 3100 5174 5175; do \
		pids=$$(lsof -ti:$$port 2>/dev/null | grep -v '^$$'); \
		if [ -n "$$pids" ]; then \
			echo "  Killing processes on port $$port: $$pids"; \
			echo "$$pids" | xargs kill 2>/dev/null || true; \
		fi; \
	done
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
	@if lsof -ti:3100 > /dev/null 2>&1; then \
		echo "  devServer: running (PID $$(lsof -ti:3100))"; \
	else \
		echo "  devServer: stopped"; \
	fi
	@if lsof -ti:5174 > /dev/null 2>&1; then \
		echo "  Vite:      running (PID $$(lsof -ti:5174))"; \
	elif lsof -ti:5175 > /dev/null 2>&1; then \
		echo "  Vite:      running on :5175 (PID $$(lsof -ti:5175))"; \
	else \
		echo "  Vite:      stopped"; \
	fi

$(PID_DIR):
	@mkdir -p $(PID_DIR)
