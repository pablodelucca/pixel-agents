# Clawmpany (Frontend + Backend)

# ── Stage 1: Build Frontend ──────────────────────────────────
FROM node:22-alpine AS frontend-builder

RUN apk add --no-cache python3 make g++

WORKDIR /app

ARG VITE_PRIVY_APP_ID
ARG VITE_API_URL=https://api.clawmpany.id

RUN echo "VITE_PRIVY_APP_ID=$VITE_PRIVY_APP_ID" > .env && \
    echo "VITE_API_URL=$VITE_API_URL" >> .env

COPY package*.json ./
RUN npm install

COPY . .

# Build frontend (Vite outputs to dist/)
RUN npm run build

# ── Stage 2: Production ──────────────────────────────────────
FROM node:22-alpine AS runner

WORKDIR /app

ENV NODE_ENV=production
ENV PORT=3001

COPY package*.json ./
RUN npm install --omit=dev

# Copy built frontend
COPY --from=frontend-builder /app/dist ./public

# Copy server source
COPY server ./server
COPY src/shared ./src/shared

EXPOSE 3001

CMD ["npx", "tsx", "server/index.ts"]
