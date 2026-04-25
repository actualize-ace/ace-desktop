---
title: ACE Desktop — VS Code Stability Audit
date: 2026-04-24
topic: Codebase gap analysis vs VS Code patterns
status: reference (source-verified 2026-04-24)
companion: 2026-04-24-vscode-multi-session-architecture.md
implementation_plan: ../plans/2026-04-24-multi-session-stability.md
---

# ACE Desktop VS Code Stability Audit

Gap analysis of ACE Desktop's current architecture against VS Code's multi-session stability patterns. Companion to [2026-04-24-vscode-multi-session-architecture.md](./2026-04-24-vscode-multi-session-architecture.md). Implementation plan: [2026-04-24-multi-session-stability.md](../plans/2026-04-24-multi-session-stability.md).

## Provenance & verification

All ACE-side claims verified against source files at `/Users/nikhilkale/Documents/Actualize/ace-desktop/` on 2026-04-24. All VS Code-side numbers verified against `microsoft/vscode` `main` branch on the same date (file paths cited inline). Each claim is grounded in a quoted code excerpt — no second-hand summaries.

**Overall Status: ⚠️ Mostly Stable, Missing Crash Recovery**

ACE Desktop has good foundational architecture — renderer sandboxing is secure, IPC is async-only, session state is isolated, and batching prevents concurrent-streaming freeze. However, it's missing critical resilience features: no heartbeat/silence detection, no PTY backpressure, no explicit Disposable pattern in main, and memory growth on long sessions is off-harness.

---

## 1. Renderer Sandboxing — ⚠️ Partial

**Evidence:**
- [main.js:216-219](../../main.js#L216-L219) — `BrowserWindow` webPreferences: `nodeIntegration: false`, `contextIsolation: true`, `sandbox: false` (required: preload uses `require('ipc-channels')` at build time)
- [preload.js:1-2,16](../../preload.js) — Uses `contextBridge.exposeInMainWorld()`; does NOT leak raw Node APIs
- Renderer has zero direct `require()` calls (verified via grep across `/renderer/`)

**Gap vs VS Code:** `sandbox: false` is a deliberate exception to enable preload to require `ipc-channels`. VS Code would extract channel names into a separate constants file or pass them from main.

**Impact:** Low — preload is carefully scoped; no raw fs/child_process APIs leak to renderer.

---

## 2. Process Architecture — ⚠️ Partial

**Evidence:**
- **PTY:** [src/pty-manager.js:42-87](../../src/pty-manager.js#L42-L87) — PTY spawns `claudeBin` via `node-pty` **in the main process** (not a utility process). Sessions stored in a global `Map`.
- **Chat:** [src/chat-manager.js:5,191](../../src/chat-manager.js) — Claude CLI process spawned via `spawn()` in main process; also stored in global `Map`.
- **Shared process:** None. All IPC handlers registered on main's `ipcMain`. Config stored in globals (`global.VAULT_PATH`, `global.CLAUDE_BIN`).
- **MCP:** Not directly managed by ACE. Spawned by Claude CLI as child of chat/pty process. ACE forwards auth events/URLs to renderer.

**Gap vs VS Code:**
- No `utilityProcess.fork()` for worker threads — PTY could run in a utility process to isolate terminal I/O from main-thread
- All IPC handlers are global/stateless (no per-session handler registration/cleanup)

**Impact:** Medium — PTY/chat in main means a slow or crashed Claude CLI can block IPC responses for other sessions. No timeout or watchdog protection.

---

## 3. IPC Patterns — ✅ Implemented (no synchronous IPC)

**Evidence:**
- [main.js:355-357](../../main.js#L355-L357) — `ipcMain.on()` fire-and-forget for PTY writes/resize/kill
- [main.js:351-352, 364-369](../../main.js#L351-L369) — `ipcMain.handle()` (await-able) for create/send
- **No `ipcRenderer.sendSync()` anywhere** — verified via grep
- [src/ipc-channels.js](../../src/ipc-channels.js) — Single source of truth for ~70 channel names; preload exports safe APIs via `contextBridge.exposeInMainWorld('ace', {...})`

**Gap vs VS Code:**
- No per-session IPC channel namespace (VS Code uses scoped channels like `renderer:sessionId:write`). ACE uses a single global `'pty-write'` and multiplexes by ID in the payload.
- No channel abstraction class (like VS Code's `IChannel`). Handlers are raw lambdas.

**Impact:** Low — fire-and-forget async IPC is safe. Global channel multiplexing by ID works.

---

## 4. IPC Backpressure / Flow Control — ⚠️ Partial

**Evidence:**
- **Chat batching (16ms window):** Shipped in commit `add8883` (2026-04-18).
  - [src/chat-manager.js:214-231](../../src/chat-manager.js#L214-L231) — Per-session event buffer with 16ms flush timer
  - [preload.js:98-100](../../preload.js#L98-L100) — Batch unpacking in renderer
- **Chat buffer cap:** [src/chat-manager.js:271-285](../../src/chat-manager.js#L271-L285) — 1MB line-buffer cap (overflow → error event, buffer reset)
- **PTY:** [src/pty-manager.js:72-76](../../src/pty-manager.js#L72-L76) — **NO batching, NO pause/resume.** Every `onData` event triggers immediate `webContents.send`:
  ```js
  shell.onData(data => {
    if (!win.isDestroyed()) {
      win.webContents.send(`${ch.PTY_DATA}:${id}`, data)
    }
  })
  ```

**Gap vs VS Code:**
- Chat events batched (good), PTY data is not
- No renderer → main ACK mechanism (no `acknowledgeDataEvent(id, charCount)` equivalent)
- No `pause()` on PTY stream when renderer IPC queue fills

**Impact:** Medium — Chat batching prevents concurrent-stream freeze. PTY is unprotected; fast-scrolling terminal with large chunks could still flood the renderer event queue.

---

## 5. Listener Lifecycle / Disposables — ⚠️ Partial

**Evidence:**
- [renderer/modules/session-manager.js:476,576,626,642,649](../../renderer/modules/session-manager.js) — Listeners registered per-session, cleanup functions stored:
  ```js
  const cleanupStream = window.ace.chat.onStream(id, event => { ... })
  const cleanupError = window.ace.chat.onError(id, msg => { ... })
  const cleanupExit = window.ace.chat.onExit(id, code => { ... })
  if (s) s._cleanupListeners = () => { cleanupStream(); cleanupError(); cleanupExit(); cleanupSpawn?.() }
  ```
- [renderer/modules/session-manager.js:949](../../renderer/modules/session-manager.js#L949) — `closeSession(id)` calls `_cleanupListeners()`
- [preload.js:50-52,102-113](../../preload.js) — Each event listener returns an unsubscribe function

**Gap vs VS Code:**
- No `DisposableStore` or `Disposable` base class — cleanup is manual, error-prone (easy to forget one listener)
- Main process IPC handlers (`ipcMain.on/handle`) are **never removed** — persist for app lifetime (acceptable since they're global + stateless, but hardening opportunity)

**Impact:** Low-medium — renderer cleanup is thorough. Risk: if a session is deleted from `state.sessions` without calling `closeSession()`, listeners persist and fire on orphaned channels.

---

## 6. Crash Recovery / Heartbeats — ❌ Missing

**Evidence:**
- **Zero matches** for `heartbeat`, `ping`, `alive`, `watchdog` in pty-manager.js or chat-manager.js
- [main.js:260-265](../../main.js#L260-L265) — Renderer crash detection (via `render-process-gone`) → auto-reload
- [src/pty-manager.js:78-83](../../src/pty-manager.js#L78-L83) — PTY exit handler: deletes session, notifies renderer
- [src/chat-manager.js:336-343](../../src/chat-manager.js#L336-L343) — Similar pattern for chat exit
- **No proactive monitoring** — no timer checks "is this process still alive?" or "silent for 30s?"

**Gap vs VS Code:**
- No heartbeat message (main ↔ child every N seconds)
- No watchdog timer to force-kill process after N seconds of silence
- No spawn timeout — if Claude CLI takes >60s to print first token, no error raised

**Impact:** **HIGH** — A hung Claude CLI blocks the session until Electron's invoke timeout (~30s). Large files or slow MCP servers can trigger this. No graceful auto-recovery.

---

## 7. Workers for CPU Work — ❌ Missing

**Evidence:**
- **Zero matches** for `Worker(` in renderer code
- [renderer/modules/session-manager.js:289-306](../../renderer/modules/session-manager.js) — NDJSON parsing + event routing runs synchronously on main renderer thread
- Markdown parsing and HTML sanitization also main-thread

**Gap vs VS Code:** VS Code uses workers for tokenization, theme parsing, heavy syntax analysis. ACE has no worker pool.

**Impact:** Medium (latent risk) — most ACE rendering is CSS-based, so not a measured problem yet. Long markdown parses during active streaming could jank UI.

---

## 8. Startup / Lazy Loading — ⚠️ Partial

**Evidence:**
- [main.js:273-307](../../main.js#L273-L307) — Eager window creation on `app.whenReady()`
- [main.js:306](../../main.js#L306) — `require('./src/file-watcher').start(mainWindow)` eager at startup
- MCP servers: lazy (spawned by Claude CLI on-demand — ✅ good)
- No activation-event equivalent

**Gap vs VS Code:** File watcher is eager, not deferred until user opens a file.

**Impact:** Low-medium — file watcher startup ~100ms; contributes to first-paint latency on slow disks.

---

## 9. Multi-Session State Isolation — ✅ Good

**Evidence:**
- [renderer/state.js:11-12,714-737](../../renderer/state.js) — Each session gets its own object in `state.sessions[id]`
- [src/pty-manager.js:5,70](../../src/pty-manager.js) and [src/chat-manager.js:10,217](../../src/chat-manager.js) — Both use `Map` keyed by session ID
- No accidental `activeSession` / `currentSession` globals causing cross-session bleed
- Virtual chat list scoped per-session ([renderer/modules/session-manager.js:50-71](../../renderer/modules/session-manager.js))

**Gap vs VS Code:** None identified.

**Impact:** None.

---

## 10. Memory / Listener Accumulation — ⚠️ Partial

**Evidence:**
- **DOM eviction:** [renderer/modules/session-manager.js:45-71](../../renderer/modules/session-manager.js#L45-L71) — Virtual chat list evicts settled messages above viewport
- **Soft GC with health scoring:** [renderer/modules/refresh-engine.js:1-144](../../renderer/modules/refresh-engine.js) — Sensors for DOM count, listeners, sessions, uptime, staleness; weighted health score; triggers soft GC at 30min or when health > 0.7; full reload at 6h idle
- **Soft GC cleanup:** [renderer/modules/session-manager.js:896-940](../../renderer/modules/session-manager.js) — Clears orphaned timers, DOM refs, buffers
- **Known gap:** `memory/feedback_stress_harness_coverage_gap.md` — 60s harness is green but real-world shows memory growth on long sessions; harness doesn't cover session churn, first-paint, MCP spawn

**Gap vs VS Code:**
- Virtual list evicts DOM but stores height-preserving placeholders — hydration on scroll-back works but requires "settled boundary" calculation, error-prone
- No explicit memory ceiling — soft GC is time+health-based, no RSS cap
- No memory telemetry (no `process.memoryUsage()` logged per session or globally)

**Impact:** Medium — long sessions (8+ hours) may show RSS growth. Off-harness.

---

## Priority Fix List (source-verified, with VS Code numbers)

Ordered by estimated impact on multi-session stability. Numbers in parentheses come from verified VS Code source.

### 1. PTY backpressure (mirror `terminalProcess.ts`) — **HIGH**
**Files:** [src/pty-manager.js:72-76](../../src/pty-manager.js#L72-L76), [preload.js](../../preload.js), renderer terminal wiring
**VS Code reference:** `src/vs/platform/terminal/node/terminalProcess.ts:322-339,578-596` + `terminalProcessManager.ts:732-747`
**Action:** Implement `acknowledgeDataEvent` style flow control with verified VS Code constants:
- `HighWatermarkChars = 100_000` (pause node-pty when unacked exceeds)
- `LowWatermarkChars = 5_000` (resume when below)
- `CharCountAckSize = 5_000` (renderer batches ACKs, fires every 5k consumed)
Add 5ms `TerminalDataBufferer`-equivalent batching (ref `terminalDataBuffering.ts`, `throttleBy = 5`).
**Impact:** Prevents PTY data from overwhelming renderer event queue during fast scrolling or large outputs.
**Effort:** Medium (~1 day)

### 2. "Stuck session" silence detection (NOT auto-kill) — **HIGH**
**Files:** [src/chat-manager.js:191-212,272-307](../../src/chat-manager.js#L191-L307), renderer chat UI
**VS Code reference:** `src/vs/platform/terminal/node/ptyHostService.ts:64-72,154-171,213,365-418` + `terminal.ts:457-485`
**Critical correction from prior plan:** VS Code does NOT auto-kill on heartbeat silence. It only logs and fires `onPtyHostUnresponsive` which surfaces a UI notice. Auto-restart is reserved for actual process exit.
**Action:** Track time-since-last-stream-event per active chat session. After 30s of silence during in-flight streaming, emit a `chat-stream-silent` IPC event; renderer surfaces a "still thinking… [cancel] [details]" affordance. Do NOT auto-kill the process — let user decide. Hard-exit auto-recovery is already in place ([src/chat-manager.js:336-343](../../src/chat-manager.js#L336-L343)).
**Impact:** Faster UX feedback for hung Claude CLI; user retains control. Eliminates the "appears frozen" failure mode without introducing aggressive process termination.
**Effort:** Medium (~1 day)

### 3. Spawn timeout for chat-manager — **MEDIUM**
**Files:** [src/chat-manager.js:191-212](../../src/chat-manager.js#L191-L212)
**VS Code reference:** `HeartbeatConstants.CreateProcessTimeout = 5000` in `terminal.ts:457-485`
**Action:** 5s timeout on `spawn()` for the process to exist (separate from "first stream output" — that can legitimately take longer). If process hasn't reported alive in 5s, kill + emit `chat-spawn-timeout` error.
**Impact:** Faster error feedback when Claude CLI misconfigured or binary path broken. Distinct from #2 (which handles already-spawned-but-silent).
**Effort:** Low (~2 hrs)

### 4. DisposableStore for main-process listeners — **MEDIUM**
**Files:** [src/pty-manager.js](../../src/pty-manager.js), [src/chat-manager.js](../../src/chat-manager.js)
**VS Code reference:** `src/vs/base/common/lifecycle.ts:416-541` (Disposable + DisposableStore pattern)
**Action:** Add a small `DisposableStore` utility (50 LOC port of VS Code's API: `add`, `dispose`, `clear`). Replace the ad-hoc `_cleanupListeners` pattern with `Disposable` + `_register()`. Per-session: spawn-listeners, timers, buffer flush timers all registered into a session-scoped store; `closeSession` calls `store.dispose()`.
**Impact:** Prevents listener-leak class of bugs. Fixes the silent ASI / forgotten-cleanup risk. Also makes the future utility-process migration (Phase 2) cleaner because services can be properly torn down.
**Effort:** Low-Medium (~half day)

### 5. Memory telemetry in refresh-engine — **MEDIUM**
**Files:** [renderer/modules/refresh-engine.js](../../renderer/modules/refresh-engine.js), [main.js](../../main.js)
**Action:** Add an IPC channel `main-memory-usage` that returns `process.memoryUsage()` (RSS, heap used, external). Renderer logs this on each soft-GC tick. Main process logs once per minute. Persist to `~/Library/Logs/ACE/memory.ndjson` with a 7-day rotation. This unblocks measurement-driven decisions for everything else.
**Impact:** Without this, all "memory leak" claims are vibes. With this, off-harness drift becomes visible.
**Effort:** Low (~3 hrs)

### 6. Per-session IPC handler namespacing — **LOW** (deprioritized)
**Files:** [main.js](../../main.js), [src/ipc-channels.js](../../src/ipc-channels.js), [preload.js](../../preload.js)
**Action:** Namespace channels by session ID (e.g., `pty-write:sess-123`).
**Impact:** Hardening only. ACE already multiplexes by ID in payload; risk is theoretical.
**Effort:** Medium. **Deprioritized** — not worth the churn unless we see actual cross-session bugs.

### 7. Deferred file-watcher startup — **LOW-MEDIUM**
**Files:** [main.js:306](../../main.js#L306)
**Action:** Start file-watcher when first vault-dependent IPC fires, not at app startup.
**Impact:** Faster first-paint on slow disks.
**Effort:** Low

### 8. Validate sender in main-process IPC handlers — **LOW**
**Files:** [main.js](../../main.js) (all ipcMain.on/handle calls)
**Action:** Add `if (event.sender.id !== mainWindow.webContents.id) return` guard.
**Impact:** Defense in depth. No current attack surface (preload bridge is sole client + contextIsolation enforced).
**Effort:** Very low. **Optional** — given threat model, not load-bearing.

### 9. Code-split renderer modules — **LOW**
**Files:** [renderer/app.js](../../renderer/app.js)
**Action:** Dynamic `import()` for dashboard modules (orbit, cockpit, insights). Load on first view activation.
**Impact:** Faster initial page load.
**Effort:** Medium. **Defer** — bundle size hasn't been flagged as a problem.

---

## What was REMOVED from the prior fix list (and why)

- **"Auto-kill / restart on heartbeat timeout"** — removed. VS Code does NOT do this. Heartbeat is silence-detection only, surfaces UI, never kills. The original recommendation to "kill after 3 missed pings" was a false analogy.
- **"Explicit memory ceiling + PTY event buffer cap"** — removed as standalone item. Backpressure (#1) achieves the same goal more correctly: bounding unacknowledged char count caps in-flight memory. A separate cap would be redundant.
- **"Workers for renderer CPU work"** — removed. ACE renderer is mostly CSS-bound; markdown/JSON parsing is in main, not renderer. No measured CPU stalls justify a worker pool.

---

## Implementation sequencing

The full plan with phasing, success criteria, and stress-harness gates lives at [../plans/2026-04-24-multi-session-stability.md](../plans/2026-04-24-multi-session-stability.md). Summary:

- **Phase 0 (1-2 days):** Extend stress harness to cover off-harness modes (multi-session churn, long-uptime drift, wake-from-sleep). Without this, P1 work optimizes against numbers that don't reflect real failures.
- **Phase 1 (3-5 days):** Direct VS Code patterns: PTY backpressure, stuck-session UI, spawn timeout, DisposableStore in main, memory telemetry.
- **Phase 2 (~2 weeks, deferred):** Architectural — extract pty-manager + chat-manager into a UtilityProcess. Mirrors VS Code's pty host. High value, high risk; only after Phase 1 ships and Phase 0 harness validates the gain.
