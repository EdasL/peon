# Design Audit — peon.work

Audited: 2026-03-05

## Overall impression

The app looks like every other shadcn dark template. Nothing about it says "premium" or "this is different." It's competent but completely forgettable. Someone would use it, but they wouldn't feel anything.

## Page-by-page findings

### Landing Page
- Dark background (#0D0D0D) — needs to flip to warm off-white per new direction
- Headline "While you sleep, your team ships." is strong copy but Inter font is generic
- White CTA button on dark works, but doesn't feel premium
- Remotion demo is good concept but trapped in a dark context
- Sections below (truths, steps) fade into darkness — no contrast hierarchy

### Login Page
- Default shadcn Card component with rounded-xl corners — screams "template"
- Centered on pure dark background, cold and uninviting
- "Sign in with Google" button uses default primary variant — no personality
- Card has shadow-sm which is invisible on dark background

### Dashboard Page
- Project cards use zinc-900 hover — muddy, cold
- Status dots are emerald-500 (running) — good, keep green for status
- Typography: text-zinc-100/200/400/500/600 — too many zinc shades, no warmth
- Spacing is fine but Cards use default shadcn rounded-xl — too bubbly
- Delete button hover uses destructive/10 — needs to be cleaner

### Project Page (3-column layout)
- bg-zinc-950 everywhere — flat, no depth hierarchy between panels
- Left panel (TeamPanel) at 240px is good width
- Center tab bar (Chat/Board) uses bg-zinc-800 active state — cold
- Panel borders are border-border/40 — too faint, panels bleed together
- Header uses emerald-500/10 status badge — color is fine, shape is pill (rounded-full) — overdesigned

### Team Panel
- Status dots are 2px (size-2) — too small per spec, should be 6px
- Agent names use font-mono text-[11px] — right idea but text-zinc-300 is too bright on dark
- "TEAM" header in text-[10px] uppercase — good pattern
- Idle dot uses emerald-500 border — spec says it should be warm grey
- Loading skeleton uses bg-zinc-800/50 — cold

### Kanban Board
- Cards: rounded-[10px] — way too round for the sharp spec
- Column headers use colored accents (blue-400, cyan-400, green-400) — should be muted, not colorful
- Card working indicator is 1.5px green dot — too small
- No left-border indicator for active cards (spec requires 2px lime left border)
- Column backgrounds use bg-background/50 — creates ghostly floating look

### Chat Panel
- User messages: bg-blue-600 rounded-xl — classic chat bubble, needs to die
- Assistant messages: bg-zinc-800/80 rounded-bl-sm — inconsistent rounding
- Avatar circle with "TL" initials in blue-900/60 — clip-art energy
- Send button: bg-blue-600 — blue is the anti-brand color
- Input: bg-zinc-900 with border — too dark on dark, no contrast
- Timestamp text-[10px] text-zinc-600 — invisible

## Systemic issues

1. **Cold color palette**: Everything is zinc/slate. No warmth anywhere. Needs #F7F6F2 warm whites.
2. **Inter font**: Generic. Every dev tool uses it. Instrument Serif/Sans + JetBrains Mono gives instant distinctiveness.
3. **Over-rounded**: 0.625rem base radius + rounded-xl on cards = bubbly toy aesthetic. Spec says 0.25rem.
4. **Blue accent creep**: Blue-600 on send button, blue-400 on kanban columns, blue-900 avatars. Kill all blue.
5. **No type hierarchy**: Everything is text-sm/text-xs with zinc shades. No editorial confidence in sizing.
6. **Shadow-sm on cards**: Invisible and pointless. Replace with borders.
7. **Inconsistent density**: Some areas (chat) are spacious, others (team panel) are cramped.

## Priority order for fixes

1. index.css — new palette (LIGHT mode, warm), fonts, radius
2. Button/Card/Input — shadcn overrides
3. LandingPage — light theme + Instrument Serif hero
4. LoginPage — clean light card
5. DashboardPage — warm project cards
6. ProjectPage — header + layout borders
7. ChatPanel — flat messages, no bubbles
8. TeamPanel — 6px dots, JetBrains Mono names
9. KanbanCard — left-border active, sharp radius
10. KanbanColumn — muted headers
