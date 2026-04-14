# Clawmpany (Frontend + Backend)

# ── Stage 1: Build Frontend ──────────────────────────────────
FROM node:22-alpine AS frontend-builder

RUN apk add --no-cache python3 make g++

WORKDIR /app

ARG VITE_PRIVY_APP_ID

RUN echo "VITE_PRIVY_APP_ID=$VITE_PRIVY_APP_ID" > .env

COPY package*.json ./
RUN npm install

COPY . .

# Build frontend (Vite outputs to dist/)
RUN npm run build

# ── Stage 2: Production ──────────────────────────────────────
FROM node:22-alpine AS runner

WORKDIR /app

RUN apk add --no-cache python3 make g++

ENV NODE_ENV=production
ENV BACKEND_PORT=${BACKEND_PORT}

COPY package*.json ./
RUN npm install --omit=dev

# Copy built frontend
COPY --from=frontend-builder /app/dist ./public

# Copy server source
COPY server ./server
COPY src/shared ./src/shared

ARG BACKEND_PORT
EXPOSE ${BACKEND_PORT}

CMD ["npx", "tsx", "server/index.ts"]
