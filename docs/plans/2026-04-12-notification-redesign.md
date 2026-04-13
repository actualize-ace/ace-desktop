# Notification Redesign Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Replace the red attention badge with a gold-family somatic signal, wire click-through to the correct pane, add a dropdown when multiple sessions flag, and give tab + header dots a one-shot arrival pulse.

**Architecture:** Keep existing `needsAttention` flag + badge counter. Extend session state with `attentionReason` + `attentionAt`. Color-token migration from `#e07080` to `var(--gold)`. Replace the existing "jump to first flagged" click handler in `index.html:697-708` with a router that (a) direct-jumps when count === 1, or (b) opens a dropdown anchored to the badge when count ≥ 2. Dropdown reuses slash-menu primitives (absolute-positioned panel, outside-click dismiss, keyboard nav). Arrival pulse is a one-shot CSS class `.just-arrived` applied to `.stab-dot` + `.term-hdr-dot` for 1.5s on activation via dropdown or direct-jump. Header-dot pulse is a transient override on top of the existing pressure-mirror states (ctx-warn/hot/critical) — pulse fades, pressure glow remains.

**Tech Stack:** Vanilla JS ESM modules, CSS custom properties, existing Electron renderer. No new dependencies.

**Conventions:** ace-desktop has no test framework — verification is manual via `npm start` + DevTools (per `reference_ace_desktop_no_tests.md`). One change at a time, test between edits (per `feedback_incremental_edits_only.md`). Work on `main` — worktrees break Electron native modules.

---

## Task 1: Color token migration (red → gold)

Migrate the badge + badge glow + hover state from hardcoded `#e07080` / `rgba(224,112,128,…)` to `var(--gold)` with matching rgba glow values. Gold RGB: `#c8a0f0` → `rgba(200,160,240,…)` (dark) / `#5a48c0` → handled automatically via var swap. Keep the `--red` token reserved for genuine errors (chat-error pane already uses it correctly).

**Files:**
- Modify: `ace-desktop/renderer/styles/views/terminal.css:11-25`

**Step 1: Update `.attention-badge` base styles**

Replace lines 11-25 with:

```css
.attention-badge {
  display: none; align-items: center; justify-content: center;
  min-width: 18px; height: 18px; border-radius: 9px; padding: 0 5px;
  background: var(--gold); color: var(--bg-0, #0a0a14); cursor: pointer;
  font-family: 'JetBrains Mono', monospace; font-size: 9px; font-weight: 700;
  animation: attention-pulse 1.2s ease-in-out infinite;
  box-shadow: 0 0 10px rgba(200,160,240,0.55), 0 0 20px rgba(200,160,240,0.28);
  transition: all 0.14s; -webkit-app-region: no-drag;
}
@keyframes attention-pulse {
  0%, 100% { transform: scale(1);    box-shadow: 0 0 10px rgba(200,160,240,0.55), 0 0 20px rgba(200,160,240,0.28); }
  50%      { transform: scale(1.15); box-shadow: 0 0 14px rgba(200,160,240,0.75), 0 0 28px rgba(200,160,240,0.38); }
}
.attention-badge.visible { display: flex; }
.attention-badge:hover { transform: scale(1.25); box-shadow: 0 0 16px rgba(200,160,240,0.85), 0 0 32px rgba(200,160,240,0.45); }
```

Note: `--bg-0` may not exist as a token — if DevTools shows the text is unreadable, fall back to `color: #0a0a14` or `color: var(--bg)` after checking `tokens.css`. Verify in step 3.

**Step 2: Verify existing `.stab-dot.attention` already uses gold**

Read `terminal.css:9` — it already reads `background: var(--gold); … box-shadow: 0 0 6px rgba(212,165,116,0.5)`. The rgba is the old terracotta gold, not the purple-gold. Update to:

```css
.stab-dot.attention { background: var(--gold); animation: breathe 1.2s ease-in-out infinite; box-shadow: 0 0 6px rgba(200,160,240,0.55); }
```

**Step 3: Manual verification**

Run: `cd ace-desktop && npm start`

In a running session: trigger a question tool (e.g. ask ACE a question that triggers `AskUserQuestion`) OR force-trigger via DevTools console:

```js
import('./renderer/modules/attention.js').then(m => m.setAttention(Object.keys(state.sessions)[0]))
```

Expected:
- Badge visible in top bar, pulsing gold (purple-gold, not red)
- Badge text readable against gold background
- Tab dot pulses gold with soft halo
- Hover on badge increases glow

If text is illegible, change `color: var(--bg-0, #0a0a14)` → `color: #0a0a14` directly.

**Step 4: Commit**

```bash
cd /Users/nikhilkale/Documents/Actualize
git add ace-desktop/renderer/styles/views/terminal.css
git commit -m "fix(ace-desktop): attention badge gold over red

Red reads as error/alert. Gold carries 'Claude is reaching for you'
semantics consistent with token bar breath + HRV glow. Red stays
reserved for genuine errors."
```

---

## Task 2: Track attention reason + timestamp on session state

Each session's attention flag needs a reason (`question` | `exit` | `error`) and a timestamp so the dropdown can show "asks you…", "finished", "errored" and relative time. Extend `setAttention` signature.

**Files:**
- Modify: `ace-desktop/renderer/modules/attention.js:5-17`
- Modify: `ace-desktop/renderer/modules/session-manager.js` — 3 `setAttention` call sites (lines 255, 618, 634)

**Step 1: Extend `setAttention` to accept reason**

Replace `attention.js:5-17` with:

```js
export function setAttention(id, sessionsObj, reason = 'notice') {
  sessionsObj = sessionsObj || state.sessions
  const s = sessionsObj[id]
  if (s) {
    s.needsAttention = true
    s.attentionReason = reason
    s.attentionAt = Date.now()
  }
  const tab = s?.tab || document.getElementById('tab-' + id)
  const dot = tab?.querySelector('.stab-dot')
  if (dot) dot.classList.add('attention')
  const arDot = document.querySelector(`#ar-item-${id} .ar-dot`)
  if (arDot) arDot.classList.add('attention')
  updateAttentionBadge()
}
```

And extend `clearAttention` (lines 19-29) to clear the two new fields:

```js
export function clearAttention(id, sessionsObj) {
  sessionsObj = sessionsObj || state.sessions
  const s = sessionsObj[id]
  if (s) {
    s.needsAttention = false
    s.attentionReason = null
    s.attentionAt = null
  }
  const tab = s?.tab || document.getElementById('tab-' + id)
  const dot = tab?.querySelector('.stab-dot')
  if (dot) dot.classList.remove('attention')
  const arDot = document.querySelector(`#ar-item-${id} .ar-dot`)
  if (arDot) arDot.classList.remove('attention')
  updateAttentionBadge()
}
```

**Step 2: Update the 3 trigger sites in session-manager.js**

- Line 255 (question tool): `setAttention(id, sessionsObj)` → `setAttention(id, sessionsObj, 'question')`
- Line 618 (chat error): `setAttention(id, sessionsObj)` → `setAttention(id, sessionsObj, 'error')`
- Line 634 (exit while hidden): `setAttention(id, sessionsObj)` → `setAttention(id, sessionsObj, 'exit')`

**Step 3: Initialize fields in session creation**

In `session-manager.js:902-918`, add two fields to the `state.sessions[id] = { … }` object literal:

```js
needsAttention: false,
attentionReason: null,
attentionAt: null,
```

Place these after `totalCost: 0,` for readability.

**Step 4: Verify fields populate**

Run `npm start`. In DevTools console, trigger an attention event and inspect:

```js
Object.values(state.sessions).filter(s => s.needsAttention).map(s => ({reason: s.attentionReason, at: s.attentionAt}))
```

Expected: array with `reason: 'question' | 'exit' | 'error'` and a valid timestamp.

**Step 5: Commit**

```bash
git add ace-desktop/renderer/modules/attention.js ace-desktop/renderer/modules/session-manager.js
git commit -m "feat(ace-desktop): attention reason + timestamp on session state

Sets attentionReason ('question' | 'exit' | 'error') and attentionAt
so the upcoming dropdown can route to the right pane with context."
```

---

## Task 3: Arrival pulse CSS

Add a one-shot `.just-arrived` class that pulses both `.stab-dot` and `.term-hdr-dot` in gold for 1.5s. Must layer cleanly on top of existing pressure-mirror states (`ctx-warn/hot/critical`) — arrival pulse is transient, pressure glow remains.

**Files:**
- Modify: `ace-desktop/renderer/styles/views/terminal.css` (append)

**Step 1: Append arrival-pulse keyframes + classes to terminal.css**

Add at end of file:

```css
/* ── Arrival pulse — one-shot "you've landed here" signal ──
   Applied for 1.5s on session activation via attention dropdown
   or direct-jump. Transient; pressure-mirror glow (ctx-warn/hot/
   critical) remains underneath via !important on those rules. */
@keyframes arrival-pulse {
  0%   { transform: scale(1);   box-shadow: 0 0 0   rgba(200,160,240,0.0);  }
  15%  { transform: scale(1.8); box-shadow: 0 0 14px rgba(200,160,240,0.95); }
  100% { transform: scale(1);   box-shadow: 0 0 0   rgba(200,160,240,0.0);  }
}
.stab-dot.just-arrived,
.term-hdr-dot.just-arrived {
  animation: arrival-pulse 1.5s ease-out 1;
}
```

**Step 2: Test the pulse in isolation**

In DevTools, grab any header dot:

```js
document.querySelector('.term-hdr-dot').classList.add('just-arrived')
setTimeout(() => document.querySelector('.term-hdr-dot').classList.remove('just-arrived'), 1600)
```

Expected: visible gold flash, scales up then fades over 1.5s.

**Step 3: Commit**

```bash
git add ace-desktop/renderer/styles/views/terminal.css
git commit -m "feat(ace-desktop): arrival pulse keyframes + just-arrived class"
```

---

## Task 4: Attention menu module

New module `attention-menu.js` owning: open/close, position anchored to badge, list build from flagged sessions, item click → route + pulse. Reuses the slash-menu pattern for show/dismiss + outside-click.

**Files:**
- Create: `ace-desktop/renderer/modules/attention-menu.js`
- Modify: `ace-desktop/renderer/index.html` — add menu root element + import module

**Step 1: Create the menu HTML root**

In `index.html`, find line 86 (`<div class="attention-badge" …>`) and add an empty menu container directly after it (as sibling so it anchors to top bar, not inside badge):

```html
<div class="attention-badge" id="attention-badge" title="Sessions need attention">0</div>
<div class="attention-menu" id="attention-menu" role="menu" aria-hidden="true"></div>
```

**Step 2: Write the module**

Create `ace-desktop/renderer/modules/attention-menu.js`:

```js
// Attention menu — routes user to the pane that needs them
import { state } from '../state.js'
import { clearAttention } from './attention.js'
import { activateSession } from './session-manager.js'
import { focusAgentPane } from './agent-sessions.js'

const REASON_LABEL = {
  question: 'asks you',
  exit:     'finished',
  error:    'errored',
  notice:   'needs you',
}

function relativeTime(ts) {
  if (!ts) return ''
  const secs = Math.floor((Date.now() - ts) / 1000)
  if (secs < 60)    return `${secs}s ago`
  if (secs < 3600)  return `${Math.floor(secs/60)}m ago`
  return `${Math.floor(secs/3600)}h ago`
}

function collectFlagged() {
  const items = []
  for (const [id, s] of Object.entries(state.sessions)) {
    if (!s.needsAttention) continue
    const label = document.getElementById('tab-label-' + id)?.textContent || 'ACE'
    const pane = s.pane?.parentElement?.id === 'pane-content-right' ? 'right' : 'left'
    items.push({ id, kind: 'session', label, pane, reason: s.attentionReason, at: s.attentionAt })
  }
  for (const [id, s] of Object.entries(state.agentSessions)) {
    if (!s.needsAttention) continue
    items.push({ id, kind: 'agent', label: s.name || 'Agent', pane: 'agents', reason: s.attentionReason, at: s.attentionAt })
  }
  return items.sort((a, b) => (b.at || 0) - (a.at || 0))
}

function route(item) {
  if (item.kind === 'session') {
    document.querySelector('.nav-item[data-view="terminal"]')?.click()
    setTimeout(() => {
      activateSession(item.id)
      clearAttention(item.id)
      pulseArrival(item.id, 'session')
    }, 100)
  } else {
    document.querySelector('.nav-item[data-view="agents"]')?.click()
    setTimeout(() => {
      focusAgentPane(item.id)
      clearAttention(item.id, state.agentSessions)
      pulseArrival(item.id, 'agent')
    }, 100)
  }
}

function pulseArrival(id, kind) {
  const tabDot = document.querySelector(`#tab-${id} .stab-dot`)
  const paneEl = kind === 'session' ? state.sessions[id]?.pane : null
  const hdrDot = paneEl?.querySelector('.term-hdr-dot')
  ;[tabDot, hdrDot].forEach(el => {
    if (!el) return
    el.classList.remove('just-arrived')
    // Force reflow so the animation restarts if class lingered
    void el.offsetWidth
    el.classList.add('just-arrived')
    setTimeout(() => el.classList.remove('just-arrived'), 1600)
  })
}

function render(items) {
  const menu = document.getElementById('attention-menu')
  if (!menu) return
  menu.innerHTML = items.map(it => `
    <div class="attention-menu-item" data-id="${it.id}" data-kind="${it.kind}" role="menuitem" tabindex="0">
      <span class="attention-menu-label">${it.label}</span>
      <span class="attention-menu-reason">${REASON_LABEL[it.reason] || 'needs you'}</span>
      <span class="attention-menu-pane">${it.pane}</span>
      <span class="attention-menu-time">${relativeTime(it.at)}</span>
    </div>
  `).join('')
  menu.querySelectorAll('.attention-menu-item').forEach(el => {
    el.addEventListener('click', () => {
      const item = items.find(i => i.id === el.dataset.id && i.kind === el.dataset.kind)
      if (item) { close(); route(item) }
    })
  })
}

let outsideHandler = null
let keyHandler = null
let activeIdx = 0
let currentItems = []

export function open() {
  currentItems = collectFlagged()
  if (currentItems.length === 0) return
  if (currentItems.length === 1) {
    // Direct-jump path — no menu
    route(currentItems[0])
    return
  }
  render(currentItems)
  const menu = document.getElementById('attention-menu')
  menu.classList.add('open')
  menu.setAttribute('aria-hidden', 'false')
  activeIdx = 0
  highlight()
  // Outside-click dismiss (next tick so the triggering click doesn't immediately close)
  setTimeout(() => {
    outsideHandler = (e) => {
      if (!menu.contains(e.target) && e.target.id !== 'attention-badge') close()
    }
    document.addEventListener('click', outsideHandler)
  }, 0)
  keyHandler = (e) => {
    if (e.key === 'Escape') { e.preventDefault(); close() }
    else if (e.key === 'ArrowDown') { e.preventDefault(); activeIdx = (activeIdx + 1) % currentItems.length; highlight() }
    else if (e.key === 'ArrowUp')   { e.preventDefault(); activeIdx = (activeIdx - 1 + currentItems.length) % currentItems.length; highlight() }
    else if (e.key === 'Enter')     { e.preventDefault(); const it = currentItems[activeIdx]; if (it) { close(); route(it) } }
  }
  document.addEventListener('keydown', keyHandler)
}

function highlight() {
  const menu = document.getElementById('attention-menu')
  menu?.querySelectorAll('.attention-menu-item').forEach((el, i) => {
    el.classList.toggle('active', i === activeIdx)
  })
}

export function close() {
  const menu = document.getElementById('attention-menu')
  if (!menu) return
  menu.classList.remove('open')
  menu.setAttribute('aria-hidden', 'true')
  if (outsideHandler) document.removeEventListener('click', outsideHandler)
  if (keyHandler)     document.removeEventListener('keydown', keyHandler)
  outsideHandler = null; keyHandler = null
}
```

Note: verify the import path for `focusAgentPane` by grepping first — it may live in a different module than `agent-sessions.js`.

**Step 3: Verify imports before proceeding**

Run:

```
Grep pattern: "export.*focusAgentPane" in ace-desktop/renderer/modules
```

Adjust the import path in `attention-menu.js` to match. If `focusAgentPane` isn't exported, use the same lookup pattern the existing `index.html:706` handler uses.

**Step 4: Commit**

```bash
git add ace-desktop/renderer/modules/attention-menu.js ace-desktop/renderer/index.html
git commit -m "feat(ace-desktop): attention menu module scaffolding

Collects flagged sessions with reason + relative time, routes on
click, triggers arrival pulse on both tab + header dots. Direct-
jumps when exactly one is flagged."
```

---

## Task 5: Wire badge click to open menu + replace legacy handler

Replace the existing `index.html:697-708` handler with a call to `attention-menu.open()`. The module itself handles the "count === 1 → direct jump" case, so the call site is trivial.

**Files:**
- Modify: `ace-desktop/renderer/index.html:697-708`

**Step 1: Replace the handler**

Replace lines 697-708 with:

```js
// ─── Attention Badge Click — open menu (auto-direct-jumps if count=1) ──
import('./modules/attention-menu.js').then(({ open }) => {
  document.getElementById('attention-badge').addEventListener('click', open)
})
```

(Dynamic import keeps it isolated; matches other late-bound modules in this file.)

**Step 2: Verify**

Run `npm start`. Trigger two attention events via DevTools:

```js
import('./renderer/modules/attention.js').then(m => {
  const ids = Object.keys(state.sessions)
  m.setAttention(ids[0], state.sessions, 'question')
  m.setAttention(ids[1], state.sessions, 'exit')
})
```

Click the badge. Expected: menu appears with two items, each showing label + reason + pane + time.

Then test with one: clear one and click. Expected: direct jump to the remaining session, no menu.

**Step 3: Commit**

```bash
git add ace-desktop/renderer/index.html
git commit -m "feat(ace-desktop): wire attention badge to dropdown menu"
```

---

## Task 6: Attention menu styling

Style the dropdown to anchor top-right (near the badge), dark panel, gold accents. Reuse slash-menu visual language so the UI reads as one design system.

**Files:**
- Modify: `ace-desktop/renderer/styles/views/terminal.css` (append) — OR new file if it grows

**Step 1: Append styles to terminal.css**

Add at end of file:

```css
/* ── Attention menu — dropdown for multi-flag routing ── */
.attention-menu {
  position: fixed;
  top: 44px; right: 16px;
  min-width: 260px; max-width: 340px;
  background: rgba(14,12,22,0.96);
  border: 1px solid rgba(200,160,240,0.25);
  border-radius: 8px;
  box-shadow: 0 10px 40px rgba(0,0,0,0.55), 0 0 0 1px rgba(200,160,240,0.08);
  backdrop-filter: blur(12px);
  padding: 4px;
  opacity: 0; pointer-events: none;
  transform: translateY(-6px);
  transition: opacity 0.14s ease, transform 0.14s ease;
  z-index: 10000;
  font-family: 'JetBrains Mono', monospace;
}
.attention-menu.open {
  opacity: 1; pointer-events: auto;
  transform: translateY(0);
}
.attention-menu-item {
  display: grid;
  grid-template-columns: 1fr auto auto;
  grid-template-rows: auto auto;
  grid-template-areas:
    "label  pane  time"
    "reason pane  time";
  gap: 2px 10px;
  padding: 8px 10px;
  border-radius: 6px;
  cursor: pointer;
  transition: background 0.1s;
}
.attention-menu-item:hover,
.attention-menu-item.active {
  background: rgba(200,160,240,0.10);
}
.attention-menu-label {
  grid-area: label;
  color: var(--text-primary);
  font-size: 11px;
  letter-spacing: 0.4px;
  overflow: hidden; text-overflow: ellipsis; white-space: nowrap;
}
.attention-menu-reason {
  grid-area: reason;
  color: var(--gold);
  font-size: 9px;
  letter-spacing: 0.8px;
  text-transform: uppercase;
}
.attention-menu-pane {
  grid-area: pane;
  align-self: center;
  color: var(--text-dim);
  font-size: 8px;
  letter-spacing: 1px;
  text-transform: uppercase;
  padding: 2px 6px;
  border: 1px solid rgba(200,160,240,0.18);
  border-radius: 3px;
}
.attention-menu-time {
  grid-area: time;
  align-self: center;
  color: var(--text-dim);
  font-size: 8px;
  white-space: nowrap;
}
```

**Step 2: Verify visually**

Run `npm start`, trigger 2+ attention events, click badge. Expected:
- Panel drops in from top-right just below top bar
- Two items, each showing tab label, "asks you / finished / errored" in gold, "left / right" pane chip, relative time
- Hover highlights row; arrow keys move highlight; Enter routes
- Click outside closes; Escape closes

**Step 3: Commit**

```bash
git add ace-desktop/renderer/styles/views/terminal.css
git commit -m "style(ace-desktop): attention menu dropdown"
```

---

## Task 7: Full-flow integration test

Run through the three real trigger paths end-to-end and confirm the arrival pulse, color, and routing all cohere.

**Step 1: Question trigger**

Ask the agent a question that invokes `AskUserQuestion`. Leave the session pane, switch to Dashboard. Expected:
- Badge becomes visible in gold, pulsing
- Tab dot on that session also gold, breathing
- Click badge → routes back to terminal view → that session becomes active → both tab dot and header dot flash gold once (1.5s) then settle

**Step 2: Exit-while-hidden trigger**

Open two sessions, put one in the right pane. In the right pane, run a long-running task. Switch to the left pane. When the right task finishes, expected:
- Badge appears, gold
- Tab dot on the right-pane session pulses gold
- Click badge → right pane session activates → both dots pulse on arrival

**Step 3: Error trigger**

Force an error (e.g. invalid model config). Expected:
- Badge + tab dot → gold (NOT red — red is reserved for content-level errors in the message area, badge still signals "session needs you")
- Click flow same as above

**Step 4: Multi-flag dropdown**

Trigger two attentions simultaneously (one question, one exit). Expected:
- Badge shows count `2`
- Click → dropdown appears with two items sorted by recency
- Keyboard arrow + Enter routes correctly to the right pane

**Step 5: Commit any polish fixes found during integration testing**

```bash
git add -A
git commit -m "polish(ace-desktop): notification redesign integration fixes"
```

---

## Task 8: Update ROADMAP

Per `feedback_roadmap_update_on_ship.md` — update ROADMAP immediately when a feature ships.

**Files:**
- Modify: `ace-desktop/ROADMAP.md` — row "Notification system redesign"

**Step 1: Flip the row**

Strike-through the row and mark Done with commit ref + one-line summary. Match the style of the other Done rows (e.g. `~~Terminal session naming~~ | Done | ~~Medium~~ | Shipped 2026-04-12: …`).

**Step 2: Commit**

```bash
git add ace-desktop/ROADMAP.md
git commit -m "docs(ace-desktop): roadmap — notification redesign shipped"
```

---

## Rollback

All changes are CSS + renderer JS — no DB, no IPC, no main-process code. If any task misbehaves, `git revert` the specific commit. Tasks are ordered so earlier commits work standalone (color migration is valuable even if dropdown never ships).

## Decisions Locked

- **Gold over amber:** carries existing ACE-Desktop somatic semantics (token bar breath, HRV glow)
- **Red stays reserved:** for content-level errors only, not for "session needs you" state
- **Dropdown anchors top-right:** under the badge, fixed-positioned
- **Reason text shown:** asks you / finished / errored + pane chip + relative time
- **Arrival pulse on both dots:** tab dot + header dot, 1.5s one-shot, transient override of pressure-mirror
- **Direct-jump when count=1:** no menu shown
