# Peon — Design System

## The problem with current design
- Default shadcn dark theme
- Inter everywhere
- Blue/purple sidebar accent (same as every AI tool)
- Over-rounded corners (0.625rem)
- Generic. Forgettable.

## References
- Linear — dense, dark, sharp, serious
- Raycast — warm dark, single strong accent, premium weight
- mymind.com — confident, generous, distinctive
- Zed — sharp, no-fluff developer tool aesthetic

## Design decisions

### Color palette
Light. Warm. Like mymind.com — not another dark AI tool.

```css
/* Backgrounds — warm off-white */
--background:        #F7F6F2;   /* warm off-white page background */
--card:              #FFFFFF;   /* card surfaces */
--elevated:          #EEECEA;   /* subtle hover, secondary surfaces */

/* Borders — warm, barely visible */
--border:            #E2E0DA;   /* default border */
--border-strong:     #C8C5BC;   /* focused / hover border */

/* Text */
--foreground:        #1A1916;   /* near-black, warm */
--muted-foreground:  #8C8980;   /* secondary text */
--subtle:            #B8B5AC;   /* placeholder, disabled */

/* Accent — one color, used sparingly */
--accent:            #1A1916;   /* near-black as accent — confidence */
/* Primary CTA is dark on light. Clean. No color gimmicks. */
/* Reserve a single pop: agent working dot = #22C55E (green) */

/* Status */
--status-working:    #22C55E;   /* agent working = green */
--status-idle:       #C8C5BC;   /* agent idle = warm grey */
--status-error:      #EF4444;   /* agent error = red */

/* Destructive */
--destructive:       #EF4444;
```

### Typography
Premium trio — all free on Google Fonts.

```css
--font-sans:  "Instrument Sans", ui-sans-serif, system-ui, sans-serif;
--font-serif: "Instrument Serif", Georgia, serif;
--font-mono:  "JetBrains Mono", ui-monospace, monospace;
```

- **Instrument Serif** — display/hero headlines only. Editorial confidence.
- **Instrument Sans** — all app UI. Clean, modern, distinct from Inter.
- **JetBrains Mono** — agent names in TeamPanel, task owner labels, any code.

Import via Google Fonts in index.css.

Type scale — tighter tracking on headings:
- Display (landing hero): 72–96px, weight 600, tracking -0.04em
- H1: 32px, weight 600, tracking -0.02em
- H2: 20px, weight 500, tracking -0.01em
- Body: 14px, weight 400, tracking 0
- Small/label: 12px, weight 400, tracking 0.02em

### Borders & radius
Sharp. Confident.
```css
--radius: 0.25rem;   /* was 0.625rem */
```
Cards and inputs feel precise, not bubbly.

### Shadows
Remove almost all. Use borders instead.
The only shadow: subtle depth on floating elements (modals, dropdowns):
```css
box-shadow: 0 8px 32px rgba(0, 0, 0, 0.4);
```

### Density
Tighter than current. More information per screen.
- Sidebar items: 36px height (was ~44px)
- Card padding: 12px (was 16px)
- Gap between elements: 8px default, 12px between sections

---

## Component updates

### Dashboard — project cards
```
┌─────────────────────────────────┐
│ acme-saas               ● Live  │  ← name left, status right
│ 3 agents · 2m ago               │  ← muted, small
└─────────────────────────────────┘
```
- Background: --card
- Border: --border
- Hover: border → --border-strong, background → --elevated
- Status dot: lime (live) / grey (stopped)
- NO rounded xl corners. radius-sm only.

### Team panel — agent rows
```
● lead         ← lime dot if working, grey if idle
  backend      ← grey dot
  frontend     ← grey dot
```
- Font: Geist Mono for agent names
- Dot: 6px circle, filled lime (working) / hollow grey border (idle) / filled red (error)
- Row height: 32px
- No token bar

### Board — task cards
```
┌──────────────────────┐
│ Add JWT middleware    │
│ backend              │  ← agent name in mono, muted
└──────────────────────┘
```
- Minimal. Title + owner.
- Active card (agent currently working): left border 2px lime
- No shadows. Border only.

### Chat
- Input: flat, border only, no background fill
- Messages: no chat bubbles. Left-aligned text, clear sender label above in muted.
- Peon messages: slightly different background row

### Buttons
- Primary CTA: background near-black (#1A1916), text white, weight 500, radius-sm
- Secondary: transparent, border --border-strong, text --foreground
- Destructive: transparent, border red, text red

---

## Pages to update
1. `src/index.css` — replace entire :root color palette
2. `src/pages/LandingPage.tsx` — full redesign (see landing-brief.md)
3. `src/pages/DashboardPage.tsx` — project cards
4. `src/pages/ProjectPage.tsx` — layout, panel styling
5. `src/features/sessions/TeamPanel.tsx` — agent rows
6. `src/features/kanban/KanbanBoard.tsx` — task cards, column headers
7. `src/features/chat/` — chat messages, input
8. Install Geist fonts, update CSS vars
9. Update shadcn component overrides where needed (Button, Card, Input, Badge)

---

## What NOT to do
- No gradients (no `bg-gradient-to-*`)
- No glow effects (`box-shadow` with color)
- No glassmorphism
- No blue or purple anywhere
- No rounded-xl or rounded-2xl on cards
- No Inter (replace everywhere)
- No emojis in UI
