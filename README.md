# Clawmpany

Office simulation game with real-time collaboration features.

## 🏗️ Architecture

```
clawmpany/
├── src/            Frontend (React + Vite)
│   └── shared/     Shared types & utilities
├── server/         Backend (Express API)
├── public/         Static assets
└── dist/           Build output (gitignored)
```

**Dev:** Vite :5173 proxies `/api` → Express :3001
**Prod:** Express :3001 serves API + built frontend

## 🚀 Quick Start

```bash
npm install
cp .env.example .env   # edit with your values
npm run dev
```

- Frontend: http://localhost:5173
- API: http://localhost:5173/api/* (proxied to :3001)

### Production (Docker)

```bash
cp .env.example .env
npm run build:docker
npm run start:docker
```

Access: http://localhost:3001

## 🔧 Scripts

| Command | Description |
|---------|-------------|
| `npm run dev` | Frontend + backend concurrently |
| `npm run dev:client` | Frontend only |
| `npm run dev:server` | Backend only |
| `npm run build` | Build frontend |
| `npm run lint` | Lint frontend |
| `npm run dev:docker` | Docker Compose up |
| `npm run build:docker` | Build Docker image |

## 📦 Tech Stack

React 19 · Vite · Express · TypeScript · Privy Auth · PocketBase *(→ Supabase)* · Tripay

## 📝 License

Private — All rights reserved.
