# peon.work

AI-powered project management platform combining chat, kanban boards, and coding agents.

## 🚀 Quick Start

```bash
# Install dependencies
npm install

# Start development environment
npm run dev
```

Visit [localhost:5174](http://localhost:5174) to access the platform.

## 🏗️ Architecture

```
Browser (React)  ←→  Gateway (Hono)  ←→  Database (PostgreSQL)
                        ↕                    ↕
                   Redis (Queue)      Docker Workers (OpenClaw)
```

### Tech Stack

- **Frontend**: React 19, Vite, Tailwind v4, shadcn/ui
- **Backend**: Hono, Bun runtime
- **Database**: PostgreSQL with Drizzle ORM
- **Queue**: Redis with BullMQ
- **Auth**: Google OAuth → JWT sessions
- **AI**: Anthropic Claude Sonnet

## 📁 Project Structure

```
packages/
├── core/      # Shared types and utilities
├── gateway/   # HTTP server and API endpoints
├── web/       # React frontend application
└── worker/    # OpenClaw AI agent containers
```

## 🔧 Development Scripts

```bash
npm run dev          # Full stack development
npm run dev:gateway  # Backend only
npm run dev:web      # Frontend only
npm run build        # Build all packages
npm run typecheck    # Type checking
```

## 🌟 Features

- **Google OAuth** - Secure authentication
- **GitHub Integration** - Connect your repositories  
- **AI Chat** - Powered by Claude Sonnet
- **Kanban Boards** - Drag-and-drop task management
- **Multi-User** - Team collaboration support
- **Docker Workers** - Isolated AI coding environments

## 📋 Current Status

| Feature | Status |
|---------|--------|
| ✅ User Authentication | Working |
| ✅ GitHub OAuth | Working |
| ✅ Project Management | Working |
| ✅ AI Chat | Working |
| ✅ Kanban Board UI | Working |
| 🚧 Docker Workers | In Progress |
| 🚧 Task Persistence | Planned |
| 🚧 Streaming Chat | Planned |

## 🗂️ Documentation

- [Architecture Overview](docs/architecture-overview.md)
- [Sprint Plans](docs/plans/)

## 🔐 Environment Setup

Copy `.env.example` to `.env` and configure:

```bash
# Database
DATABASE_URL=postgresql://...

# Auth
GOOGLE_CLIENT_ID=...
GOOGLE_CLIENT_SECRET=...

# AI
ANTHROPIC_API_KEY=...
```

## 🐳 Docker

Development environment includes PostgreSQL and Redis:

```bash
docker compose -f docker/docker-compose.yml up -d
```

## 📝 License

Private - All rights reserved

---

Built with ❤️ for the future of AI-powered development