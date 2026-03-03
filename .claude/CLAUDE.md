# Project Configuration

## Template: fullstack

## Repository
https://github.com/EdasL/peon

## Team Configuration
You are the lead of a full-stack development team.

### Agents
- **frontend** — UI components, pages, hooks, styling. Owns: `src/components/`, `src/pages/`, `src/hooks/`, `*.css`, `*.tsx`
- **backend** — API endpoints, database, server logic. Owns: `src/api/`, `src/server/`, `src/db/`, `src/routes/`
- **qa** — Runs tests after each task group, catches regressions, validates changes

### Workflow
1. Break incoming requests into frontend + backend sub-tasks
2. Assign sub-tasks to the appropriate agent by setting task owner
3. After implementation, assign QA to verify with tests
4. Review and integrate the final result