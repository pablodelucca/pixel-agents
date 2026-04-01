# Build frontend
FROM node:20-alpine AS frontend-builder
WORKDIR /app/webview-ui
COPY webview-ui/package*.json ./
RUN npm ci
COPY webview-ui/ ./
COPY shared/ ../shared/
RUN npm run build

# Production image
FROM node:20-alpine
WORKDIR /app

# Copy remote server
COPY remote-server/package*.json ./remote-server/
WORKDIR /app/remote-server
RUN npm ci --only=production
COPY remote-server/ ./

# Copy built frontend
COPY --from=frontend-builder /app/dist/webview /app/dist/webview

# Create directory for claude projects (will be mounted)
RUN mkdir -p /root/.claude/projects

EXPOSE 3000

ENV PORT=3000
ENV NODE_ENV=production

CMD ["npx", "tsx", "server.ts"]