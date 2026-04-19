# Refresh Engine Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Build a two-tier self-refresh system (soft GC + full reload) with an observable health score and ambient vitals dot UI.

**Architecture:** A coordinator module (`refresh-engine.js`) runs a 60-second tick, computes a 0.0–1.0 health score from 5 sensors, and emits `ace:soft-gc` when score crosses 0.7 or every 30 min idle. Modules register cleanup callbacks. After 6+ hours idle + 2+ hours uptime, the coordinator persists minimal state to localStorage and calls `location.reload()`. A breathing vitals dot in the status bar reflects system health.

**Tech Stack:** Vanilla JS (ES modules), Electron renderer process, CSS animations, existing `state.js` singleton, `atmosphere.js` activity tracking.

**Design doc:** `docs/plans/2026-04-17-refresh-engine-design.md`

**No test framework** exists for ace-desktop — verification is manual via `npm start` + DevTools. Each task includes specific manual verification steps.

---

### Task 1: Create refresh-engine.js — Core Coordinator

**Files:**
- Create: `ace-desktop/renderer/modules/refresh-engine.js`

**Step 1: Create the module with health score computation and tick loop**

```js
// renderer/modules/refresh-engine.js
// Two-tier self-refresh: soft GC (30 min / health threshold) + full reload (6h idle)
import { state } from '../state.js'

// ── Timing Constants ──
const TICK_MS         = 60_000    // check every 60 seconds
const SOFT_GC_INTERVAL = 30 * 60_000  // 30 min default soft GC cycle
const SOFT_GC_COOLDOWN = 5 * 60_000   // 5 min — skip GC if user active within this window
const FULL_RELOAD_IDLE = 6 * 3600_000 // 6 hours idle
const MIN_UPTIME       = 2 * 3600_000 // 2 hours before full reload eligible
const HEALTH_THRESHOLD = 0.7          // soft GC fires immediately above this

// ── Sensor Weights ──
const W_DOM      = 0.35
const W_LISTENER = 0.15
const W_SESSION  = 0.15
const W_UPTIME   = 0.20
const W_STALENESS = 0.15

// ── Sensor Baselines / Ceilings ──
const DOM_BASE = 50,   DOM_CEIL = 500
const LIS_BASE = 10,   LIS_CEIL = 60
const SES_BASE = 2,    SES_CEIL = 8
const UPT_BASE = 1,    UPT_CEIL = 8   // hours
const GCS_BASE = 10,   GCS_CEIL = 60  // minutes

// ── State ──
let bootedAt   = Date.now()
let lastSoftGC = Date.now()
let healthScore = 0
let tickTimer  = null

// Registered cleanup callbacks
const softGcCallbacks    = []
const willReloadCallbacks = []

// ── Public Registration ──
export function onSoftGC(fn) { softGcCallbacks.push(fn) }
export function onWillReload(fn) { willReloadCallbacks.push(fn) }
export function getHealthScore() { return healthScore }
export function getBootedAt() { return bootedAt }

// ── Sensor Functions ──
function clamp01(v) { return Math.max(0, Math.min(1, v)) }

function sensorDOM() {
  const count = document.querySelectorAll('.chat-msg').length
  return clamp01((count - DOM_BASE) / (DOM_CEIL - DOM_BASE))
}

function sensorListeners() {
  // Count sessions with registered cleanup listeners (proxy for IPC listener count)
  let count = 0
  for (const s of Object.values(state.sessions)) {
    if (s._cleanupListeners) count += 3  // stream + error + exit per session
  }
  for (const s of Object.values(state.agentSessions || {})) {
    if (s._cleanupListeners) count += 3
  }
  return clamp01((count - LIS_BASE) / (LIS_CEIL - LIS_BASE))
}

function sensorSessions() {
  const count = Object.keys(state.sessions).length + Object.keys(state.agentSessions || {}).length
  return clamp01((count - SES_BASE) / (SES_CEIL - SES_BASE))
}

function sensorUptime() {
  const hours = (Date.now() - bootedAt) / 3_600_000
  return clamp01((hours - UPT_BASE) / (UPT_CEIL - UPT_BASE))
}

function sensorStaleness() {
  const minutes = (Date.now() - lastSoftGC) / 60_000
  return clamp01((minutes - GCS_BASE) / (GCS_CEIL - GCS_BASE))
}

function computeHealth() {
  return (
    sensorDOM()       * W_DOM +
    sensorListeners() * W_LISTENER +
    sensorSessions()  * W_SESSION +
    sensorUptime()    * W_UPTIME +
    sensorStaleness() * W_STALENESS
  )
}

// ── Soft GC ──
function runSoftGC() {
  console.log('[refresh-engine] soft GC — health was', healthScore.toFixed(3))
  for (const fn of softGcCallbacks) {
    try { fn() } catch (e) { console.error('[refresh-engine] soft-gc callback error:', e) }
  }
  lastSoftGC = Date.now()
}

// ── Full Reload ──
function runFullReload() {
  console.log('[refresh-engine] full reload triggered')
  // Notify modules (persist state etc.)
  for (const fn of willReloadCallbacks) {
    try { fn() } catch (e) { console.error('[refresh-engine] will-reload callback error:', e) }
  }
  // Persist minimal state to localStorage
  localStorage.setItem('_aceReloadMarker', JSON.stringify({
    ts: Date.now(),
    lastView: document.querySelector('.nav-item.active')?.dataset?.view || 'home',
    theme: state.theme,
    sidebarCollapsed: document.querySelector('.sidebar')?.classList.contains('collapsed') || false,
  }))
  location.reload()
}

// ── Post-Reload Restore ──
export function checkReloadRestore() {
  const raw = localStorage.getItem('_aceReloadMarker')
  if (!raw) return
  try {
    const marker = JSON.parse(raw)
    localStorage.removeItem('_aceReloadMarker')
    // Restore view
    if (marker.lastView) {
      const navItem = document.querySelector(`.nav-item[data-view="${marker.lastView}"]`)
      if (navItem) navItem.click()
    }
    // Restore sidebar
    if (marker.sidebarCollapsed) {
      document.querySelector('.sidebar')?.classList.add('collapsed')
    }
    console.log('[refresh-engine] restored from reload marker', marker)
  } catch { localStorage.removeItem('_aceReloadMarker') }
}

// ── Tick ──
function tick() {
  healthScore = computeHealth()

  // Emit health score for UI
  window.dispatchEvent(new CustomEvent('ace:health-score', { detail: healthScore }))

  const now = Date.now()
  const idleMs = now - (state.atmosphere?.lastActivity || now)
  const uptimeMs = now - bootedAt
  const sinceSoftGC = now - lastSoftGC
  const recentlyActive = idleMs < SOFT_GC_COOLDOWN

  // Full reload check (highest priority)
  const anyStreaming = Object.values(state.sessions).some(s => s.isStreaming) ||
                       Object.values(state.agentSessions || {}).some(s => s.isStreaming)
  if (uptimeMs > MIN_UPTIME && idleMs > FULL_RELOAD_IDLE && !anyStreaming) {
    runFullReload()
    return  // page will reload
  }

  // Soft GC check
  if (!recentlyActive) {
    if (healthScore >= HEALTH_THRESHOLD || sinceSoftGC >= SOFT_GC_INTERVAL) {
      runSoftGC()
    }
  }
}

// ── Init ──
export function initRefreshEngine() {
  bootedAt = Date.now()
  lastSoftGC = Date.now()
  checkReloadRestore()
  tickTimer = setInterval(tick, TICK_MS)
  console.log('[refresh-engine] initialized')
}
```

**Step 2: Verify the module is syntactically valid**

Open DevTools console after wiring (Task 3). Check for import errors.

**Step 3: Commit**

```bash
git add ace-desktop/renderer/modules/refresh-engine.js
git commit -m "feat(ace-desktop): add refresh-engine coordinator — health score + soft GC + full reload"
```

---

### Task 2: Register Soft GC Cleanup in session-manager.js

**Files:**
- Modify: `ace-desktop/renderer/modules/session-manager.js`

**Step 1: Import and register soft GC callback**

At the top of `session-manager.js`, after the existing imports (line 11), add:

```js
import { onSoftGC } from './refresh-engine.js'
```

At the end of `initSessions()` (find it — it's the exported init function), add the soft GC registration:

```js
  // Register soft GC cleanup
  onSoftGC(softGcSessions)
```

**Step 2: Add the softGcSessions function**

Add this function before the `closeSession` export (around line 1508):

```js
// ── Soft GC — DOM pruning + buffer cleanup ──────────────────────────────────
const SOFT_GC_MSG_KEEP = 40  // keep last N messages per session

function softGcSessions() {
  for (const [id, s] of Object.entries(state.sessions)) {
    // Skip actively streaming sessions
    if (s.isStreaming) continue

    // 1. Prune DOM — keep last SOFT_GC_MSG_KEEP messages, tombstone the rest
    const msgsEl = document.getElementById('chat-msgs-' + id)
    if (msgsEl) {
      const msgs = msgsEl.querySelectorAll('.chat-msg')
      const excess = msgs.length - SOFT_GC_MSG_KEEP
      if (excess > 0) {
        // Remove excess oldest messages
        for (let i = 0; i < excess; i++) msgs[i].remove()
        // Insert tombstone at top
        const existing = msgsEl.querySelector('.chat-gc-tombstone')
        if (!existing) {
          const tomb = document.createElement('div')
          tomb.className = 'chat-gc-tombstone'
          tomb.textContent = `${excess} earlier messages cleared`
          tomb.style.cssText = 'text-align:center;padding:8px;opacity:0.35;font-size:11px;'
          msgsEl.prepend(tomb)
        } else {
          // Update count
          const prev = parseInt(existing.textContent) || 0
          existing.textContent = `${prev + excess} earlier messages cleared`
        }
      }
    }

    // 2. Clear finalized streaming buffers
    if (!s.isStreaming) {
      s._settledHTML = ''
      s._settledBoundary = 0
      s._fullResponseText = ''
      s.currentStreamText = ''
      s.currentToolInput = ''
    }

    // 3. Cancel orphaned timers
    if (s._wordTimer && !s.isStreaming) {
      clearInterval(s._wordTimer)
      s._wordTimer = null
    }
    if (s._pendingRAF && !s.isStreaming) {
      cancelAnimationFrame(s._pendingRAF)
      s._pendingRAF = null
    }

    // 4. Clear DOM references that are no longer needed
    if (!s.isStreaming) {
      s._currentAssistantEl = null
      s._opsContainer = null
    }
  }
  console.log('[refresh-engine] session-manager soft GC complete')
}
```

**Step 3: Manual verification**

1. `npm start` in ace-desktop
2. Open a chat, send a few messages
3. In DevTools console: `window._state` — verify `sessions` object has expected shape
4. Wait for soft GC to fire (or trigger manually in console for testing — will be wired in Task 7)

**Step 4: Commit**

```bash
git add ace-desktop/renderer/modules/session-manager.js
git commit -m "feat(ace-desktop): register session-manager soft GC — DOM pruning + buffer cleanup"
```

---

### Task 3: Register Soft GC in View Modules (graph, people, charts)

**Files:**
- Modify: `ace-desktop/renderer/views/graph.js`
- Modify: `ace-desktop/renderer/views/people.js`

**Step 1: Read graph.js and people.js to find simulation variables and init functions**

Locate the D3 force simulation references and the init/destroy patterns.

**Step 2: Add soft GC registration to graph.js**

At the top, import the hook:
```js
import { onSoftGC } from '../modules/refresh-engine.js'
```

After `initGraph()` is defined, register the cleanup:
```js
onSoftGC(() => {
  const graphActive = document.getElementById('view-graph')?.classList.contains('active')
  if (!graphActive && state.graphInitialized) {
    // Destroy simulation when graph view is not visible
    if (typeof simulation !== 'undefined' && simulation) {
      simulation.stop()
      simulation = null
    }
    state.graphInitialized = false
    console.log('[refresh-engine] graph.js: destroyed inactive simulation')
  }
})
```

**Step 3: Add soft GC registration to people.js**

Same pattern — import `onSoftGC`, destroy `state.peopleGraphSim` if people view not active:
```js
import { onSoftGC } from '../modules/refresh-engine.js'

// In or after initPeople():
onSoftGC(() => {
  const active = document.getElementById('view-people')?.classList.contains('active')
  if (!active && state.peopleInitialized) {
    if (state.peopleGraphSim) {
      state.peopleGraphSim.stop()
      state.peopleGraphSim = null
    }
    state.peopleData = null
    state.peopleFollowUps = null
    state.peopleInitialized = false
    console.log('[refresh-engine] people.js: destroyed inactive data')
  }
})
```

**Step 4: Verify** — switch between views, confirm graph/people reinitialize after GC.

**Step 5: Commit**

```bash
git add ace-desktop/renderer/views/graph.js ace-desktop/renderer/views/people.js
git commit -m "feat(ace-desktop): register graph + people view soft GC — destroy inactive simulations"
```

---

### Task 4: Config Hot-Reload on Soft GC

**Files:**
- Modify: `ace-desktop/renderer/modules/refresh-engine.js`

**Step 1: Add config reload to the soft GC cycle**

In `refresh-engine.js`, register a built-in soft GC callback in `initRefreshEngine()`:

```js
  // Built-in: config hot-reload
  onSoftGC(async () => {
    try {
      const config = await window.ace?.setup?.getConfig()
      if (!config) return
      // Update chat defaults
      if (config.defaults?.chat) {
        Object.assign(state.chatDefaults, config.defaults.chat)
      }
      // Update cost guardrail
      if (config.defaults?.guardrails?.sessionCostWarning !== undefined) {
        state._costGuardrail = config.defaults.guardrails.sessionCostWarning
      }
      console.log('[refresh-engine] config hot-reloaded')
    } catch (e) {
      console.error('[refresh-engine] config reload failed:', e)
    }
  })
```

**Step 2: Commit**

```bash
git add ace-desktop/renderer/modules/refresh-engine.js
git commit -m "feat(ace-desktop): config hot-reload on soft GC cycle"
```

---

### Task 5: Atmosphere Cleanup on Soft GC

**Files:**
- Modify: `ace-desktop/renderer/modules/atmosphere.js`

**Step 1: Import and register**

At the top of `atmosphere.js`, after existing imports (line 6):
```js
import { onSoftGC } from './refresh-engine.js'
```

At the end of `initAtmosphere()` (before the `setInterval(tick, TICK_MS)` call on line 1307), add:

```js
  // Register soft GC cleanup
  onSoftGC(() => {
    // Clear stale nudge timers
    if (hoverTimeout) { clearTimeout(hoverTimeout); hoverTimeout = null }
    if (streamTimeout) { clearTimeout(streamTimeout); streamTimeout = null }
    // Persist current state before GC
    persistAtmosphere()
    console.log('[refresh-engine] atmosphere soft GC complete')
  })
```

**Step 2: Commit**

```bash
git add ace-desktop/renderer/modules/atmosphere.js
git commit -m "feat(ace-desktop): register atmosphere soft GC — clear stale timers + persist"
```

---

### Task 6: Wire Refresh Engine into index.html Init

**Files:**
- Modify: `ace-desktop/renderer/index.html`

**Step 1: Add import**

In the `<script type="module">` block at the bottom of index.html (around line 778), add to the import list:

```js
import { initRefreshEngine } from './modules/refresh-engine.js'
```

**Step 2: Call initRefreshEngine()**

After the `initAtmosphere()` call (find it in the init sequence — it's near the end of the script block), add:

```js
initRefreshEngine()
```

**Step 3: Manual verification**

1. `npm start`
2. Open DevTools console
3. Look for `[refresh-engine] initialized` log
4. After 60 seconds, look for `ace:health-score` events (or check: `window.addEventListener('ace:health-score', e => console.log('health:', e.detail))`)
5. Verify no import errors

**Step 4: Commit**

```bash
git add ace-desktop/renderer/index.html
git commit -m "feat(ace-desktop): wire refresh-engine init into app startup"
```

---

### Task 7: Add Debug Console Helpers

**Files:**
- Modify: `ace-desktop/renderer/modules/refresh-engine.js`

**Step 1: Expose debug helpers on window for manual testing**

Add to the end of `initRefreshEngine()`:

```js
  // Debug helpers — accessible from DevTools console
  window._refreshEngine = {
    health: () => healthScore,
    sensors: () => ({
      dom: sensorDOM(),
      listeners: sensorListeners(),
      sessions: sensorSessions(),
      uptime: sensorUptime(),
      staleness: sensorStaleness(),
      total: computeHealth(),
    }),
    softGC: () => runSoftGC(),
    bootedAt: () => new Date(bootedAt).toLocaleTimeString(),
    lastSoftGC: () => new Date(lastSoftGC).toLocaleTimeString(),
  }
```

**Step 2: Manual verification**

In DevTools console:
- `_refreshEngine.health()` — should return a number 0.0–1.0
- `_refreshEngine.sensors()` — should return object with all 5 sensors
- `_refreshEngine.softGC()` — should trigger soft GC manually and log cleanup messages

**Step 3: Commit**

```bash
git add ace-desktop/renderer/modules/refresh-engine.js
git commit -m "feat(ace-desktop): add refresh-engine debug console helpers"
```

---

### Task 8: Vitals Dot — CSS

**Files:**
- Modify: `ace-desktop/renderer/styles/atmosphere.css`

**Step 1: Add vitals dot styles**

Append to `atmosphere.css`:

```css
/* ── Vitals Dot ── */
.vitals-dot {
  width: 6px;
  height: 6px;
  border-radius: 50%;
  background: var(--vitals-color, rgba(140, 120, 255, 0.4));
  opacity: 0.5;
  animation: vitals-pulse var(--vitals-speed, 4s) ease-in-out infinite;
  transition: background 2s ease, opacity 1.5s ease;
  cursor: default;
  flex-shrink: 0;
}

.vitals-dot[data-level="warming"] {
  --vitals-color: rgba(200, 160, 100, 0.6);
  --vitals-speed: 2.5s;
  opacity: 0.65;
}

.vitals-dot[data-level="hot"] {
  --vitals-color: rgba(210, 140, 80, 0.8);
  --vitals-speed: 1.5s;
  opacity: 0.8;
}

@keyframes vitals-pulse {
  0%, 100% { transform: scale(1); opacity: var(--vitals-opacity, 0.5); }
  50% { transform: scale(1.4); opacity: calc(var(--vitals-opacity, 0.5) + 0.2); }
}

/* Tooltip */
.vitals-dot::after {
  content: attr(data-tooltip);
  position: absolute;
  bottom: calc(100% + 6px);
  left: 50%;
  transform: translateX(-50%);
  background: var(--bg-elevated, #1a1c2e);
  color: var(--text-secondary, #aaa);
  font-size: 10px;
  padding: 3px 8px;
  border-radius: 4px;
  white-space: nowrap;
  pointer-events: none;
  opacity: 0;
  transition: opacity 0.2s;
}

.vitals-dot:hover::after {
  opacity: 1;
}
```

**Step 2: Commit**

```bash
git add ace-desktop/renderer/styles/atmosphere.css
git commit -m "feat(ace-desktop): add vitals dot CSS — breathing pulse with three health levels"
```

---

### Task 9: Vitals Dot — HTML + JS Wiring

**Files:**
- Modify: `ace-desktop/renderer/index.html`
- Modify: `ace-desktop/renderer/modules/refresh-engine.js`

**Step 1: Add the vitals dot element to the status bar in index.html**

Find the status bar area in index.html (near the somatic bar / bottom of the sidebar). Add the dot element near the context meter or intensity bar. The exact insertion point depends on the HTML structure — look for the bottom status area and insert:

```html
<div class="vitals-dot" id="vitals-dot" data-tooltip="System vitals: clear" style="position:relative;"></div>
```

**Step 2: Add UI update to refresh-engine.js**

In `refresh-engine.js`, add a function to update the vitals dot and call it from `tick()`:

```js
function updateVitalsDot() {
  const dot = document.getElementById('vitals-dot')
  if (!dot) return

  if (healthScore < 0.4) {
    dot.dataset.level = ''
    dot.dataset.tooltip = 'System vitals: clear'
  } else if (healthScore < 0.7) {
    dot.dataset.level = 'warming'
    dot.dataset.tooltip = 'System vitals: warming'
  } else {
    dot.dataset.level = 'hot'
    dot.dataset.tooltip = 'Refreshing...'
  }
}
```

Call `updateVitalsDot()` at the end of the `tick()` function, after the health score is computed and before the GC checks.

**Step 3: After soft GC completes, ease the dot back**

At the end of `runSoftGC()`, add:
```js
  // Recompute health after GC and update UI
  healthScore = computeHealth()
  updateVitalsDot()
```

**Step 4: Manual verification**

1. `npm start`
2. Look for the vitals dot in the status bar
3. Hover — should show "System vitals: clear" tooltip
4. In console: `_refreshEngine.softGC()` — dot should briefly show "Refreshing..." then ease back
5. Verify pulse animation is visible (subtle, ~4s cycle)

**Step 5: Commit**

```bash
git add ace-desktop/renderer/index.html ace-desktop/renderer/modules/refresh-engine.js
git commit -m "feat(ace-desktop): wire vitals dot UI — health score drives pulse speed + tooltip"
```

---

### Task 10: Full Reload — Will-Reload Callback in Atmosphere

**Files:**
- Modify: `ace-desktop/renderer/modules/atmosphere.js`

**Step 1: Import onWillReload and register**

Add to the existing import from refresh-engine:

```js
import { onSoftGC, onWillReload } from './refresh-engine.js'
```

In `initAtmosphere()`, alongside the soft GC registration, add:

```js
  onWillReload(() => {
    // Persist atmosphere state before full reload
    persistAtmosphere()
    // Stop audio to prevent orphaned oscillators
    stopSolfeggio()
    stopBinaural()
    console.log('[refresh-engine] atmosphere pre-reload: persisted + audio stopped')
  })
```

**Step 2: Commit**

```bash
git add ace-desktop/renderer/modules/atmosphere.js
git commit -m "feat(ace-desktop): register atmosphere will-reload — persist state + stop audio"
```

---

### Task 11: Integration Test — Full Manual Verification

**Files:** None (testing only)

**Step 1: Fresh launch test**

1. `npm start`
2. DevTools console: verify `[refresh-engine] initialized`
3. `_refreshEngine.sensors()` — all sensors should be near 0.0

**Step 2: Health score accumulation test**

1. Open 3–4 chat sessions
2. Send several messages in each
3. `_refreshEngine.sensors()` — `dom` and `sessions` should rise
4. `_refreshEngine.health()` — should be > 0 but < 0.7

**Step 3: Manual soft GC test**

1. `_refreshEngine.softGC()`
2. Console should show cleanup logs from session-manager, atmosphere
3. Check DOM: older messages should be replaced with tombstone
4. `_refreshEngine.health()` — should drop after GC

**Step 4: Vitals dot test**

1. Verify dot is visible with slow pulse
2. Hover — tooltip shows "System vitals: clear"
3. After GC with high health, verify dot level transitions

**Step 5: Reload restore test**

1. Navigate to a non-default view (e.g. "people" or "vault")
2. In console: force a reload marker and reload:
   ```js
   localStorage.setItem('_aceReloadMarker', JSON.stringify({ts:Date.now(),lastView:'people',theme:'dark',sidebarCollapsed:false}))
   location.reload()
   ```
3. After reload, verify the people view is active (not home)
4. Console should show `[refresh-engine] restored from reload marker`

**Step 6: Commit verification checkpoint**

```bash
git log --oneline -10
```

Verify all commits from Tasks 1–10 are present.

---

## Summary

| Task | What | Files |
|------|------|-------|
| 1 | Core coordinator — health score, tick, GC, reload | `refresh-engine.js` (create) |
| 2 | Session-manager soft GC — DOM pruning + buffer cleanup | `session-manager.js` |
| 3 | Graph + People view soft GC — destroy inactive simulations | `graph.js`, `people.js` |
| 4 | Config hot-reload on soft GC | `refresh-engine.js` |
| 5 | Atmosphere soft GC — clear stale timers | `atmosphere.js` |
| 6 | Wire into index.html init | `index.html` |
| 7 | Debug console helpers | `refresh-engine.js` |
| 8 | Vitals dot CSS | `atmosphere.css` |
| 9 | Vitals dot HTML + JS wiring | `index.html`, `refresh-engine.js` |
| 10 | Atmosphere will-reload callback | `atmosphere.js` |
| 11 | Full manual integration test | — |
