# Renderer Long Task Observer Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** When the ACE Desktop renderer main thread stalls ≥200 ms, dump a timestamped record — stack trace, tick-overrun ms, active-chat context — to `~/Library/Logs/ACE/longtask.log` so the next freeze names its culprit instead of landing in unsymbolized JIT addresses.

**Architecture:** Two complementary detectors in the renderer. (1) `PerformanceObserver({ entryTypes: ['longtask'] })` — Chrome-native, fires on any task ≥50 ms but does **not** include a stack trace. (2) A `MessageChannel` heartbeat scheduled every 100 ms — when it fires late (overrun ≥200 ms), we capture `new Error().stack` synchronously from the heartbeat callback. Combined, the heartbeat names the function that blocked the previous tick (because the heartbeat was queued behind it) while the PerformanceObserver confirms duration. Both funnel through a single fire-and-forget IPC channel → main process → `fs.appendFile` on the log file. Zero overhead in the hot path: no batching, no buffering, just one `ipcRenderer.send` when something is already broken.

**Tech Stack:** Electron (Chrome) `PerformanceObserver`, `MessageChannel`, existing `contextBridge` / `ipcRenderer.send` pattern, Node.js `fs.appendFile` in main, `app.getPath('logs')` for cross-platform log dir.

**Context (why now):** 2026-04-19 ACE freeze — renderer pinned at 97 % CPU after 8 h 20 m uptime with one 7 h 24 m marathon chat + three deep chats open. `sample` showed main thread looping in JIT; no symbols. This observer converts every future freeze from "unknown JS loop" into "overrun 4312 ms, stack = X, active chats = Y, current view = Z".

**Constraint from memory (`feedback_incremental_edits_only.md`):** One change at a time. Test between each task. Do not batch.

**Testing note (`reference_ace_desktop_no_tests.md`):** ACE Desktop has no test framework. Manual verification via `npm start` + a synthetic long-task trigger in DevTools.

---

### Task 1: Add IPC channel constant

**Files:**
- Modify: `ace-desktop/src/ipc-channels.js`

**Step 1: Add the channel name**

Find the section near the end of the module (after the last group) and append:

```js
  // Diagnostics
  LONGTASK_REPORT: 'longtask-report',
```

Place it before the final closing `}` of the `module.exports = { ... }` object.

**Step 2: Verify by grep**

Run: `grep -n "LONGTASK_REPORT" ace-desktop/src/ipc-channels.js`
Expected: exactly one line printed, showing the new constant.

**Step 3: Commit**

```bash
git add ace-desktop/src/ipc-channels.js
git commit -m "feat(ace-desktop): add LONGTASK_REPORT ipc channel constant"
```

---

### Task 2: Main process — ensure logs dir + register handler

**Files:**
- Modify: `ace-desktop/main.js`

**Step 1: Add the logs dir initializer and handler**

Near the top of `main.js`, confirm `fs` and `path` are already imported (they are, see line 2-3). Then near the block of other `ipcMain.on(...)` / `ipcMain.handle(...)` registrations (around lines 340–400), append:

```js
// ─── Diagnostics: renderer long-task reports ─────────────────────────────────

const aceLogsDir = path.join(app.getPath('logs'))
try { fs.mkdirSync(aceLogsDir, { recursive: true }) } catch {}
const longTaskLogPath = path.join(aceLogsDir, 'longtask.log')

ipcMain.on(ch.LONGTASK_REPORT, (_, payload) => {
  try {
    const line = JSON.stringify({ ts: new Date().toISOString(), ...payload }) + '\n'
    fs.appendFile(longTaskLogPath, line, (err) => {
      if (err) console.error('[longtask] append failed:', err.message)
    })
  } catch (err) {
    console.error('[longtask] handler threw:', err.message)
  }
})
```

**Placement rule:** after other `ipcMain` registrations so the handler is bound before the first renderer frame renders.

**Step 2: Verify the file compiles**

Run: `node -c ace-desktop/main.js`
Expected: no output (success). If syntax error, it will print and exit non-zero.

**Step 3: Commit**

```bash
git add ace-desktop/main.js
git commit -m "feat(ace-desktop): main-process longtask log sink"
```

---

### Task 3: Preload — expose debug.reportLongTask

**Files:**
- Modify: `ace-desktop/preload.js`

**Step 1: Add the debug bridge**

Inside the `contextBridge.exposeInMainWorld('ace', { ... })` object, as a new top-level key (place it just before the closing `})` of that call):

```js
  // ─── Diagnostics ─────────────────────────────────────────────────────────
  debug: {
    reportLongTask: (payload) => ipcRenderer.send(ch.LONGTASK_REPORT, payload),
  },
```

**Step 2: Verify**

Run: `grep -nC1 "reportLongTask" ace-desktop/preload.js`
Expected: the new key appears once, inside the exposeInMainWorld object.

**Step 3: Commit**

```bash
git add ace-desktop/preload.js
git commit -m "feat(ace-desktop): preload bridge for longtask reports"
```

---

### Task 4: Renderer — create longtask-observer.js

**Files:**
- Create: `ace-desktop/renderer/lib/longtask-observer.js`

**Step 1: Write the module**

Create the file with this exact contents:

```js
// renderer/lib/longtask-observer.js
// When the main thread stalls ≥200 ms, dump a record to main process.
// Two detectors: PerformanceObserver (duration, no stack) + MessageChannel
// heartbeat (captures stack of whatever blocked the previous tick).

;(function initLongTaskObserver () {
  if (!window.ace || !window.ace.debug || !window.ace.debug.reportLongTask) return

  const THRESHOLD_MS = 200
  const HEARTBEAT_INTERVAL_MS = 100

  function collectContext () {
    const activeChatEls = document.querySelectorAll('[data-chat-id]')
    const activeChatIds = Array.from(activeChatEls).map(el => el.dataset.chatId)
    const visibleView = document.querySelector('.view.active')?.id || null
    const perf = performance.memory || {}
    return {
      uptimeMs: Math.round(performance.now()),
      domNodes: document.getElementsByTagName('*').length,
      activeChatCount: activeChatIds.length,
      activeChatIds: activeChatIds.slice(0, 8),
      visibleView,
      jsHeapMB: perf.usedJSHeapSize ? Math.round(perf.usedJSHeapSize / 1048576) : null,
    }
  }

  // --- Detector 1: PerformanceObserver ---------------------------------------
  try {
    const po = new PerformanceObserver((list) => {
      for (const entry of list.getEntries()) {
        if (entry.duration < THRESHOLD_MS) continue
        window.ace.debug.reportLongTask({
          source: 'performance-observer',
          durationMs: Math.round(entry.duration),
          entryName: entry.name,
          context: collectContext(),
        })
      }
    })
    po.observe({ entryTypes: ['longtask'] })
  } catch (err) {
    console.warn('[longtask] PerformanceObserver unavailable:', err.message)
  }

  // --- Detector 2: MessageChannel heartbeat ---------------------------------
  // Schedule a heartbeat every HEARTBEAT_INTERVAL_MS. When it fires late by
  // ≥THRESHOLD_MS, capture stack (which will include whatever ran right
  // before this tick could process).
  let lastScheduledAt = performance.now()
  const channel = new MessageChannel()
  channel.port1.onmessage = () => {
    const now = performance.now()
    const overrun = now - lastScheduledAt - HEARTBEAT_INTERVAL_MS
    if (overrun >= THRESHOLD_MS) {
      const stack = (new Error('longtask-heartbeat-overrun')).stack
      window.ace.debug.reportLongTask({
        source: 'heartbeat',
        overrunMs: Math.round(overrun),
        stack: stack ? stack.split('\n').slice(0, 30).join('\n') : null,
        context: collectContext(),
      })
    }
    lastScheduledAt = performance.now()
    setTimeout(() => channel.port2.postMessage(null), HEARTBEAT_INTERVAL_MS)
  }
  setTimeout(() => channel.port2.postMessage(null), HEARTBEAT_INTERVAL_MS)

  console.log('[longtask] observer active — threshold', THRESHOLD_MS, 'ms')
})()
```

**Step 2: Verify syntax**

Run: `node -c ace-desktop/renderer/lib/longtask-observer.js`
Expected: no output. If syntax error, node prints and exits non-zero.

**Step 3: Commit**

```bash
git add ace-desktop/renderer/lib/longtask-observer.js
git commit -m "feat(ace-desktop): renderer longtask observer module"
```

---

### Task 5: Wire the observer into the renderer boot path

**Files:**
- Modify: `ace-desktop/renderer/index.html`

**Step 1: Locate the script block where `app.js` is loaded**

Run: `grep -n "app.js" ace-desktop/renderer/index.html`
Note the line number.

**Step 2: Insert the observer script tag BEFORE `app.js` loads**

Add a new `<script>` line immediately before the existing `app.js` script tag:

```html
<script src="lib/longtask-observer.js"></script>
```

The observer is an IIFE with no dependencies on `app.js`, so it's safe to run first. Loading it earlier means we start measuring before the heavy boot code runs — which is itself a potential long task we want to catch.

**Step 3: Verify placement**

Run: `grep -nB1 "app.js" ace-desktop/renderer/index.html | head -6`
Expected: the longtask-observer script tag appears on the line directly above `app.js`.

**Step 4: Commit**

```bash
git add ace-desktop/renderer/index.html
git commit -m "feat(ace-desktop): wire longtask observer into renderer boot"
```

---

### Task 6: Manual verification with synthetic long task

**No test framework — manual verification only.**

**Step 1: Launch the app**

```bash
cd ace-desktop
env -u ELECTRON_RUN_AS_NODE npm start
```

Wait for the main window to load.

**Step 2: Confirm observer is active**

Open DevTools (Cmd+Opt+I) → Console. Look for:

```
[longtask] observer active — threshold 200 ms
```

If missing, the observer didn't load. Check script tag placement and path.

**Step 3: Trigger a synthetic 500 ms long task**

In DevTools console, paste and run:

```js
(function blockMainThread () {
  const t = Date.now()
  while (Date.now() - t < 500) { /* spin */ }
  console.log('blocked for 500ms')
})()
```

**Step 4: Verify the log was written**

In a terminal:

```bash
tail -2 ~/Library/Logs/ACE/longtask.log
```

Expected: at least one JSON line like

```json
{"ts":"2026-04-19T...","source":"performance-observer","durationMs":500,"entryName":"...","context":{"uptimeMs":...,"domNodes":...,"activeChatCount":...}}
```

And likely a second `"source":"heartbeat"` entry with a stack that points to the `blockMainThread` frame (names will be visible — unlike the native `sample`).

**Step 5: Verify no performance regression**

In DevTools → Performance → record 10 s of normal scrolling / clicking. The observer itself should contribute <0.1 % CPU (it's an event-driven PerformanceObserver plus a 10 Hz heartbeat that does nothing unless overrun ≥200 ms).

**If the synthetic trigger does not produce a log line:** stop. Do not proceed. Investigate. Typical causes: preload bridge not wired (check `window.ace.debug` in console), IPC channel name mismatch between preload and main, or main-process `mkdirSync` silently failing on a read-only logs dir.

---

### Task 7: Document + hand off

**Files:**
- Modify: `ace-desktop/CHANGELOG.md`

**Step 1: Add a changelog entry**

Add at the top of the "Unreleased" / next-version section:

```md
- Renderer long-task observer: dumps stack + context to `~/Library/Logs/ACE/longtask.log` when main thread stalls ≥200 ms. Diagnostic only — no user-facing behavior change.
```

**Step 2: Note log location for future freeze investigations**

Add to a memory entry (the user will decide whether to persist) the fact that future "ACE froze" reports should begin with:

```bash
tail -50 ~/Library/Logs/ACE/longtask.log
```

**Step 3: Commit**

```bash
git add ace-desktop/CHANGELOG.md
git commit -m "docs(ace-desktop): changelog longtask observer"
```

---

## Scope guardrails — do NOT do in this plan

- **Do not** virtualize the chat DOM. That is the separate scalability plan.
- **Do not** freeze inactive chats. That is the follow-up plan.
- **Do not** add per-module instrumentation to cadence ring / refresh engine / chat renderer. Let the observer name the culprit from real evidence before we instrument specific suspects.
- **Do not** batch the IPC send. The whole point is that something is already broken — we want the report out of the renderer as fast as possible.
- **Do not** write to the vault. Logs live in `app.getPath('logs')` only. The vault is user data; diagnostic noise must not go there.

---

## Exit criteria

- `npm start` launches ACE with `[longtask] observer active` in console.
- Synthetic 500 ms block in DevTools produces at least one JSON line in `~/Library/Logs/ACE/longtask.log` within 1 s.
- Heartbeat entries include readable stack frames (not `???`).
- Normal usage for 10 min produces zero log entries (no false positives above 200 ms during typical interaction).
- All 7 tasks committed individually on one branch.

Next freeze → `tail -100 ~/Library/Logs/ACE/longtask.log` → we know which function to fix.
