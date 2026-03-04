# Web Client Phase 1: Missing Functionality

**Date:** 2026-03-02
**Status:** Approved

## Problem

The web client is missing critical screens and UX patterns:
- No settings page (can't manage API keys or GitHub connection after onboarding)
- No error feedback (500s silently fail, no toasts)
- No loading states (blank screens while data fetches)
- No empty states in chat
- No persistent navigation (header only on dashboard)

## Scope

### 1. Settings Page (`/settings`)

Standalone page with left sidebar navigation and 4 sections:

**Profile**
- Display: name, email, avatar (from Google, read-only)
- Future: editable name

**API Keys**
- List existing keys: provider badge, masked key, label, created date, delete button
- Add key form: provider selector (Anthropic/OpenAI), key input, label input
- Delete confirmation via dialog
- After adding/removing a key, re-bridge credentials to the Peon agent

**GitHub**
- Show connection status: connected (@username) or not connected
- Connect button → redirects to `/api/auth/github` (existing flow)
- Disconnect button (new endpoint: `DELETE /api/auth/github`)

**Danger Zone**
- Delete account button with confirmation dialog
- Warns about data loss (projects, keys, chat history)

### 2. Toast Notification System

Add `sonner` library for toast notifications. Use toasts for:
- API errors (network failures, 4xx/5xx responses)
- Auth failures (session expired, unauthorized)
- Success feedback (key added, project created, GitHub connected)
- SSE disconnection warnings
- Background errors (project creation failed)

Integration: wrap the `request()` helper in `lib/api.ts` to auto-toast on errors.

### 3. Loading & Empty States

**Dashboard**
- Skeleton cards (3 placeholders) while projects load
- Error banner if fetch fails

**ProjectPage**
- Full-page skeleton while project loads
- Error state with retry button

**ChatPanel**
- Empty state: "Send a message to start working with your team"
- Reconnection indicator when SSE disconnects

**OnboardingPage**
- Loading spinner on "Launch Project" button while creating

### 4. Navigation Improvements

**Persistent header** on all authenticated pages:
- Left: "peon" logo/text → links to `/dashboard`
- Right: user avatar dropdown menu
  - Settings → `/settings`
  - Sign out

Replace the ad-hoc header in DashboardPage with this shared layout.

### 5. Backend Changes Needed

**New endpoints:**
- `DELETE /api/auth/github` — disconnect GitHub (clear githubId + githubAccessToken)
- `DELETE /api/user` — delete account (cascade deletes projects, keys, chat)
- `PATCH /api/user/profile` — update name (future)

**Existing endpoint changes:**
- `POST /api/keys` — after creating key, trigger `bridgeCredentials` re-sync
- `DELETE /api/keys/:id` — after deleting, trigger credential re-sync

## Tech Stack

- Existing: React, Tailwind, shadcn/ui, Radix
- Add: `sonner` for toasts
- Add: shadcn `sheet`, `dropdown-menu`, `skeleton`, `toast` components

## Pages & Routes

| Route | Page | Auth |
|-------|------|------|
| `/` | LoginPage | No |
| `/dashboard` | DashboardPage | Yes |
| `/onboarding` | OnboardingPage | Yes |
| `/project/:id` | ProjectPage | Yes |
| `/settings` | SettingsPage | Yes |

## Out of Scope (Phase 2)

- Visual redesign / new design system
- Mobile responsiveness
- Animations / transitions
- Project-level settings
- Collaborators / multi-user per project
