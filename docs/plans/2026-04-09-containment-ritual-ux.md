# Containment + Ritual UX Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Add session containment (limits + timer) and optional ritual entry/exit to ACE Desktop so the UI scaffolds sovereign use rather than enabling unbounded build binges.

**Architecture:** Feature A lives entirely in `session-manager.js` and a new `session-timer.js` module. Feature B adds a lightweight modal overlay (HTML/CSS) triggered on session spawn and close. Both features are additive — no existing session logic is modified, only extended at spawn/close hook points.

**Tech Stack:** Vanilla JS, existing Electron renderer, existing CSS token system (`styles/tokens.css`).

---

## Feature A — Lightweight Containment (ship with desktop sprint)

### Task 1: Session limit warning per pane

**Files:**
- Modify: `renderer/modules/session-manager.js:741` (`spawnSession` function)
- Modify: `renderer/styles/chat.css` (toast style)

**Step 1: Add a helper that counts live sessions per pane container**

Add inside `session-manager.js` above `spawnSession`:

```js
function countSessionsInContainer(containerId) {
  const container = document.getElementById(containerId)
  if (!container) return 0
  return container.querySelectorAll('.term-pane').length
}
```

**Step 2: Add a toast notification utility**

Add inside `session-manager.js`:

```js
function showToast(message, durationMs = 3500) {
  let toast = document.getElementById('ace-toast')
  if (!toast) {
    toast = document.createElement('div')
    toast.id = 'ace-toast'
    toast.className = 'ace-toast'
    document.body.appendChild(toast)
  }
  toast.textContent = message
  toast.classList.add('ace-toast--visible')
  clearTimeout(toast._hideTimer)
  toast._hideTimer = setTimeout(() => toast.classList.remove('ace-toast--visible'), durationMs)
}
```

**Step 3: Add toast CSS to `renderer/styles/chat.css`**

```css
/* Session limit toast */
.ace-toast {
  position: fixed;
  bottom: 24px;
  left: 50%;
  transform: translateX(-50%) translateY(12px);
  background: var(--surface-2, #1e1e2e);
  color: var(--text-primary, #cdd6f4);
  border: 1px solid var(--amber, #f9e2af);
  border-radius: 8px;
  padding: 10px 18px;
  font-size: 13px;
  opacity: 0;
  pointer-events: none;
  transition: opacity 0.2s ease, transform 0.2s ease;
  z-index: 9999;
}
.ace-toast--visible {
  opacity: 1;
  transform: translateX(-50%) translateY(0);
}
```

**Step 4: Wire limit check into `spawnSession`**

At the top of `spawnSession`, after determining `targetContainer`, add:

```js
const SESSION_LIMIT = 3
const containerId = (opts?.container || document.getElementById('pane-content-left')).id
const currentCount = countSessionsInContainer(containerId)
if (currentCount >= SESSION_LIMIT) {
  showToast(`${SESSION_LIMIT} sessions open in this pane. Close one before opening another.`)
  return
}
```

**Step 5: Test manually**
- Open ACE Desktop
- Open 3 sessions in the left pane
- Try to open a 4th — expect toast, no new session created
- Close one session, try again — expect new session opens

**Step 6: Commit**
```bash
git add renderer/modules/session-manager.js renderer/styles/chat.css
git commit -m "feat(ux): session limit of 3 per pane with toast warning"
```

---

### Task 2: Session timer

**Files:**
- Create: `renderer/modules/session-timer.js`
- Modify: `renderer/modules/session-manager.js` (spawn + close hooks)
- Modify: `renderer/index.html` (timer display in session header)
- Modify: `renderer/styles/chat.css` (timer styles)

**Step 1: Create `session-timer.js`**

```js
// renderer/modules/session-timer.js
// Lightweight per-session countdown timer. Opt-in via duration selector.

const timers = {}  // sessionId → { intervalId, remaining, el }

export function startTimer(sessionId, durationMinutes) {
  if (timers[sessionId]) clearTimer(sessionId)

  let remaining = durationMinutes * 60  // seconds
  const el = document.getElementById('session-timer-' + sessionId)
  if (!el) return

  el.style.display = 'inline-flex'
  renderTime(el, remaining)

  const intervalId = setInterval(() => {
    remaining -= 1
    renderTime(el, remaining)

    if (remaining <= 300) el.classList.add('timer--warning')   // last 5 min
    if (remaining <= 60)  el.classList.add('timer--critical')  // last 1 min

    if (remaining <= 0) {
      clearInterval(intervalId)
      delete timers[sessionId]
      el.classList.add('timer--expired')
      el.textContent = 'Time'
      showSessionNudge(sessionId)
    }
  }, 1000)

  timers[sessionId] = { intervalId, el }
}

export function clearTimer(sessionId) {
  if (!timers[sessionId]) return
  clearInterval(timers[sessionId].intervalId)
  const el = timers[sessionId].el
  if (el) { el.style.display = 'none'; el.className = 'session-timer' }
  delete timers[sessionId]
}

function renderTime(el, seconds) {
  const m = Math.floor(seconds / 60)
  const s = seconds % 60
  el.textContent = `${m}:${s.toString().padStart(2, '0')}`
}

function showSessionNudge(sessionId) {
  // Reuse the toast from session-manager
  const toast = document.getElementById('ace-toast')
  if (!toast) return
  toast.textContent = 'Session time complete. Wrap up and close this chat when ready.'
  toast.classList.add('ace-toast--visible')
  toast.style.borderColor = 'var(--amber, #f9e2af)'
  setTimeout(() => toast.classList.remove('ace-toast--visible'), 6000)
}
```

**Step 2: Add timer element to session pane HTML in `spawnSession`**

In the `term-hdr` div inside `spawnSession`'s pane HTML template, add after `.term-hdr-path`:

```html
<span class="session-timer" id="session-timer-${id}" style="display:none"></span>
<select class="session-duration-select" id="session-duration-${id}" title="Set session timer">
  <option value="">No timer</option>
  <option value="30">30 min</option>
  <option value="60">60 min</option>
  <option value="90">90 min</option>
</select>
```

**Step 3: Wire duration select to start timer**

After the `closeSession` listener in `spawnSession`, add:

```js
import { startTimer, clearTimer } from './session-timer.js'

document.getElementById('session-duration-' + id).addEventListener('change', (e) => {
  const val = parseInt(e.target.value)
  if (val) {
    startTimer(id, val)
    e.target.style.display = 'none'
  } else {
    clearTimer(id)
  }
})
```

**Step 4: Clear timer on session close**

In the `closeSession` function (find it in session-manager.js), add at the top:

```js
clearTimer(id)
```

**Step 5: Add timer CSS to `styles/chat.css`**

```css
/* Session timer */
.session-timer {
  font-size: 11px;
  font-variant-numeric: tabular-nums;
  color: var(--text-muted, #6c7086);
  padding: 2px 6px;
  border-radius: 4px;
  background: var(--surface-1, #181825);
  margin-left: 6px;
}
.session-timer.timer--warning { color: var(--amber, #f9e2af); }
.session-timer.timer--critical { color: var(--red, #f38ba8); }
.session-timer.timer--expired { color: var(--red, #f38ba8); font-weight: 600; }

.session-duration-select {
  font-size: 11px;
  background: var(--surface-1, #181825);
  color: var(--text-muted, #6c7086);
  border: 1px solid var(--border, #313244);
  border-radius: 4px;
  padding: 1px 4px;
  margin-left: 6px;
  cursor: pointer;
}
```

**Step 6: Test manually**
- Open a session
- Set timer to 30 min — verify countdown appears in header, dropdown disappears
- Set timer to a short value by temporarily changing `durationMinutes * 60` to `durationMinutes * 3` (seconds = minutes × 3)
- Verify warning/critical color changes and toast nudge on expiry
- Close session — verify timer clears (no console errors)

**Step 7: Commit**
```bash
git add renderer/modules/session-timer.js renderer/modules/session-manager.js renderer/styles/chat.css renderer/index.html
git commit -m "feat(ux): per-session countdown timer with expiry nudge"
```

---

## Feature B — Ritual Entry (optional, next sprint)

> Ship this only after Feature A is stable and in Marc + Joe's hands. Confirm it doesn't create friction before enabling by default.

### Task 3: Pre-session intention prompt (opt-in modal)

**Files:**
- Create: `renderer/modules/session-ritual.js`
- Modify: `renderer/modules/session-manager.js` (`spawnSession` hook)
- Modify: `renderer/index.html` (modal HTML)
- Modify: `renderer/styles/overlays.css` (modal styles)

**Step 1: Add modal HTML to `index.html`** (before closing `</body>`)

```html
<!-- Session ritual modal -->
<div class="ritual-overlay" id="ritual-overlay" style="display:none">
  <div class="ritual-panel">
    <div class="ritual-label">What's your intention for this session?</div>
    <textarea class="ritual-input" id="ritual-intention" placeholder="Optional — press Enter or skip..." rows="2"></textarea>
    <div class="ritual-duration-row">
      <span class="ritual-duration-label">Session length</span>
      <select class="ritual-duration-select" id="ritual-duration">
        <option value="">Open-ended</option>
        <option value="30">30 min</option>
        <option value="60">60 min</option>
        <option value="90">90 min</option>
      </select>
    </div>
    <div class="ritual-actions">
      <button class="ritual-btn-skip" id="ritual-skip">Skip</button>
      <button class="ritual-btn-begin" id="ritual-begin">Begin</button>
    </div>
  </div>
</div>
```

**Step 2: Create `session-ritual.js`**

```js
// renderer/modules/session-ritual.js
// Optional pre-session ritual modal. Returns a Promise resolving to { intention, duration }.
// Resolves immediately (no modal) if rituals are disabled in settings.

export function promptRitual() {
  return new Promise((resolve) => {
    const overlay = document.getElementById('ritual-overlay')
    const intentionEl = document.getElementById('ritual-intention')
    const durationEl = document.getElementById('ritual-duration')
    const skipBtn = document.getElementById('ritual-skip')
    const beginBtn = document.getElementById('ritual-begin')

    function finish() {
      overlay.style.display = 'none'
      intentionEl.value = ''
      durationEl.value = ''
      skipBtn.removeEventListener('click', onSkip)
      beginBtn.removeEventListener('click', onBegin)
    }

    function onSkip() { finish(); resolve({ intention: null, duration: null }) }
    function onBegin() {
      const intention = intentionEl.value.trim() || null
      const duration = parseInt(durationEl.value) || null
      finish()
      resolve({ intention, duration })
    }

    skipBtn.addEventListener('click', onSkip)
    beginBtn.addEventListener('click', onBegin)

    // Enter key submits
    intentionEl.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); onBegin() }
    })

    overlay.style.display = 'flex'
    requestAnimationFrame(() => intentionEl.focus())
  })
}
```

**Step 3: Hook into `spawnSession` — make it async**

Change `export function spawnSession(opts)` to `export async function spawnSession(opts)`.

After the session limit check, add:

```js
// Ritual prompt (only if enabled in settings)
const ritualsEnabled = window.aceConfig?.rituals ?? false
if (ritualsEnabled) {
  const { intention, duration } = await promptRitual()
  if (intention) {
    // Store on session for later reference (pre-populate chat welcome)
    opts = { ...opts, intention }
  }
  if (duration) {
    // Duration gets wired after session creation — store temporarily
    opts = { ...opts, timerDuration: duration }
  }
}
```

After `activateSession(id)` at the end of `spawnSession`, add:

```js
if (opts?.intention) {
  const welcomeSub = document.querySelector(`#pane-${id} .chat-welcome-sub`)
  if (welcomeSub) welcomeSub.textContent = `Intention: ${opts.intention}`
}
if (opts?.timerDuration) {
  startTimer(id, opts.timerDuration)
}
```

**Step 4: Add ritual CSS to `styles/overlays.css`**

```css
/* Session ritual modal */
.ritual-overlay {
  position: fixed; inset: 0;
  display: flex; align-items: center; justify-content: center;
  background: rgba(0,0,0,0.5);
  backdrop-filter: blur(4px);
  z-index: 8000;
}
.ritual-panel {
  background: var(--surface-2, #1e1e2e);
  border: 1px solid var(--border, #313244);
  border-radius: 12px;
  padding: 24px;
  width: 380px;
  display: flex; flex-direction: column; gap: 14px;
}
.ritual-label {
  font-size: 14px;
  color: var(--text-primary, #cdd6f4);
  font-weight: 500;
}
.ritual-input {
  background: var(--surface-1, #181825);
  border: 1px solid var(--border, #313244);
  border-radius: 8px;
  color: var(--text-primary, #cdd6f4);
  font-size: 13px;
  padding: 10px 12px;
  resize: none;
  font-family: inherit;
}
.ritual-input:focus { outline: none; border-color: var(--accent, #cba6f7); }
.ritual-duration-row {
  display: flex; align-items: center; gap: 10px;
  font-size: 12px; color: var(--text-muted, #6c7086);
}
.ritual-duration-select {
  background: var(--surface-1, #181825);
  border: 1px solid var(--border, #313244);
  border-radius: 6px;
  color: var(--text-muted, #6c7086);
  font-size: 12px;
  padding: 3px 6px;
}
.ritual-actions {
  display: flex; gap: 8px; justify-content: flex-end;
}
.ritual-btn-skip {
  background: none;
  border: 1px solid var(--border, #313244);
  border-radius: 6px;
  color: var(--text-muted, #6c7086);
  font-size: 12px; padding: 6px 14px; cursor: pointer;
}
.ritual-btn-begin {
  background: var(--accent, #cba6f7);
  border: none; border-radius: 6px;
  color: #1e1e2e;
  font-size: 12px; font-weight: 600;
  padding: 6px 14px; cursor: pointer;
}
```

**Step 5: Add ritual toggle to Settings panel**

In `index.html`, inside the settings panel, add:

```html
<label class="setting-row">
  <span class="setting-label">Ritual entry prompt</span>
  <input type="checkbox" id="setting-rituals" />
</label>
```

In `renderer/views/settings.js` (or wherever settings are persisted), wire the checkbox to `window.aceConfig.rituals` and persist to `ace-config.json`.

**Step 6: Test manually**
- Enable ritual entry in settings
- Open a new session — expect modal appears
- Type intention, select 60 min, click Begin — expect modal closes, timer starts, welcome text shows intention
- Click Skip — expect modal closes, no timer, no intention text
- Disable ritual entry in settings — expect new sessions open immediately with no modal

**Step 7: Commit**
```bash
git add renderer/modules/session-ritual.js renderer/modules/session-manager.js renderer/index.html renderer/styles/overlays.css
git commit -m "feat(ux): optional pre-session ritual prompt with intention + timer"
```

---

## Rollout Order

1. Feature A, Task 1 (session limit) → ship with Apr 12-13 sprint to Joe + Marc
2. Feature A, Task 2 (session timer) → ship same sprint
3. Feature B, Task 3 (ritual entry) → next sprint, OFF by default, toggle in Settings
