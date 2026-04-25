---
title: ACE Desktop Multi-Session Stability — Phased Implementation Plan
date: 2026-04-24
status: draft
companions:
  - ../research/2026-04-24-vscode-multi-session-architecture.md
  - ../research/2026-04-24-ace-desktop-vscode-audit.md
---

# ACE Desktop Multi-Session Stability Plan

Three-phase plan to bring ACE Desktop's stability under load to VS Code-equivalent levels, derived from source-verified VS Code patterns and a fresh audit of ACE's current architecture.

## Why phased

The prior memory `feedback_stress_harness_coverage_gap.md` warns that ACE's 60s stress harness is green but misses the failure modes users actually hit. Building VS Code-inspired features against an uninformative harness risks optimizing for the wrong thing — so Phase 0 extends the harness before any production code changes. Phase 1 applies the patterns that mapped cleanly. Phase 2 is the architectural rewrite (utility-process extraction) and only ships after Phase 1 is stable in production.

## Source references (anchors for every Phase 1 fix)

Every Phase 1 fix below maps to a specific VS Code source file. Pulled from `microsoft/vscode` `main` 2026-04-24:

- `src/vs/platform/terminal/node/terminalProcess.ts:322-339,578-596` — backpressure pause/resume
- `src/vs/workbench/contrib/terminal/browser/terminalProcessManager.ts:732-747` — renderer ACK batching
- `src/vs/platform/terminal/common/terminal.ts:457-485,868-889` — heartbeat + flow-control constants
- `src/vs/platform/terminal/node/ptyHostService.ts:64-72,154-171,213,365-418` — heartbeat / silence-detection / restart-on-exit
- `src/vs/platform/terminal/common/terminalDataBuffering.ts` — 5ms time-based data coalescing
- `src/vs/base/common/lifecycle.ts:416-541` — DisposableStore + Disposable base class

## Verified VS Code constants (use these exact numbers)

```
HighWatermarkChars  = 100_000   // pause when unacked exceeds
LowWatermarkChars   = 5_000     // resume when unacked drops below
CharCountAckSize    = 5_000     // renderer ACKs in 5k-char batches
BatchWindow         = 5         // ms — coalesce data within this window
HeartbeatInterval   = 5_000     // ms — beat from child to parent
FirstWarnAt         = 6_000     // ms — log warn (5000 × 1.2)
SecondWarnAt        = 11_000    // ms — log error + UI signal
CreateProcessTimeout = 5_000    // ms — timeout for spawn ack
MaxRestarts         = 5         // hard exits before giving up
```

---

## Phase 0 — Stress harness expansion (~1-2 days)

**Goal:** Make off-harness failure modes measurable BEFORE we build solutions to them.

### 0.1 Multi-session churn scenario
**File:** [scripts/stress.js](../../scripts/stress.js) — add `runChurn()`
**Action:** Open and close 50 chat sessions in succession (open → send 1 msg → wait for response → close). Measure:
- DOM nodes after each cycle (should plateau, not grow)
- Listener count after each cycle (sample via main-process telemetry)
- RSS slope (linear regression over 50 cycles)
**Success:** DOM/listener counts plateau within 10 cycles. RSS slope < 5MB per cycle.

### 0.2 Long-uptime drift scenario
**File:** [scripts/stress.js](../../scripts/stress.js) — add `runUptime(hours)`
**Action:** Idle the app for 8h with one active chat session. Sample memory every 60s. Plot RSS over time. Detect leak vs steady-state.
**Success:** RSS plateau within 2h. Soft GC fires expected number of times.

### 0.3 Wake-from-sleep recovery
**Files:** [scripts/stress.js](../../scripts/stress.js), [main.js](../../main.js)
**Action:** Add a manual harness for the macOS sleep/wake case. Listen for `powerMonitor` events in main; log time-to-first-frame after `resume`. Document procedure for human-driven test (sleep laptop 5 min, wake, observe).
**Success:** Document baseline. Phase 1 should not make this worse; Phase 2 may improve it.

### 0.4 MCP spawn timing
**File:** [scripts/stress.js](../../scripts/stress.js) — add `runMcpSpawn()`
**Action:** Measure time between chat send and first stream output for sessions with MCP enabled. Distinguish spawn time, MCP server initialization, first token.
**Success:** Document p50 / p95 latency. Provides baseline for the "stuck session" silence threshold (Phase 1 #2).

### 0.5 First-paint with cold caches
**File:** [scripts/stress.js](../../scripts/stress.js) — add `runColdStart()`
**Action:** Force-clear V8 cache + relaunch. Measure time-to-interactive.
**Success:** Document baseline. Phase 1 should hold or improve.

### Phase 0 deliverable
- Updated `scripts/stress.js` with five new scenarios
- Baseline numbers checked into `docs/research/2026-04-24-stress-baseline.md`
- All scenarios pass before Phase 1 begins (i.e., the harness itself is correct, even if the numbers reveal problems)

---

## Phase 1 — Direct VS Code patterns (~3-5 days)

Each fix below maps 1:1 to a verified VS Code source pattern. No invention.

### 1.1 PTY backpressure (mirror `terminalProcess.ts`)
**Owner files:** [src/pty-manager.js](../../src/pty-manager.js), [preload.js](../../preload.js), [renderer/modules/session-manager.js](../../renderer/modules/session-manager.js), [src/ipc-channels.js](../../src/ipc-channels.js)

**Implementation:**

```js
// src/pty-manager.js — additions

const HighWatermarkChars = 100_000
const LowWatermarkChars = 5_000
const BatchWindowMs = 5

function create(win, id, cwd, claudeBin, cols, rows) {
  const shell = pty.spawn(claudeBin, [], { name, cols, rows, cwd, env: { ...process.env } })
  const session = {
    shell,
    unackedChars: 0,
    paused: false,
    batchBuffer: [],
    batchTimer: null,
  }
  sessions.set(id, session)

  shell.onData(data => {
    if (win.isDestroyed()) return
    session.unackedChars += data.length

    if (!session.paused && session.unackedChars > HighWatermarkChars) {
      session.paused = true
      shell.pause()
    }

    session.batchBuffer.push(data)
    if (!session.batchTimer) {
      session.batchTimer = setTimeout(() => flushBatch(win, id), BatchWindowMs)
    }
  })
  // ... rest unchanged
}

function flushBatch(win, id) {
  const session = sessions.get(id)
  if (!session || win.isDestroyed()) return
  const merged = session.batchBuffer.join('')
  session.batchBuffer = []
  session.batchTimer = null
  win.webContents.send(`${ch.PTY_DATA}:${id}`, merged)
}

function ack(id, charCount) {
  const session = sessions.get(id)
  if (!session) return
  session.unackedChars = Math.max(session.unackedChars - charCount, 0)
  if (session.paused && session.unackedChars < LowWatermarkChars) {
    session.paused = false
    session.shell.resume()
  }
}

module.exports = { create, write, resize, kill, ack }
```

```js
// main.js — wire ACK channel
ipcMain.on('pty-ack', (_, id, charCount) => require('./src/pty-manager').ack(id, charCount))
```

```js
// preload.js — expose ACK
pty: {
  // ... existing
  ack: (id, charCount) => ipcRenderer.send('pty-ack', id, charCount),
}
```

```js
// renderer terminal wiring — AckDataBufferer (mirrors VS Code)
class AckDataBufferer {
  constructor(id) {
    this.id = id
    this.unsentCharCount = 0
    this.AckSize = 5_000
  }
  ack(charCount) {
    this.unsentCharCount += charCount
    while (this.unsentCharCount > this.AckSize) {
      this.unsentCharCount -= this.AckSize
      window.ace.pty.ack(this.id, this.AckSize)
    }
  }
}

// hook into xterm.js write callback:
const ackBufferer = new AckDataBufferer(id)
window.ace.pty.onData(id, data => {
  term.write(data, () => ackBufferer.ack(data.length))  // xterm's write callback fires when chunk consumed
})
```

**Tests (Phase 0 harness):**
- Run `runPtyHeavy` with 1MB/s output. Verify pause/resume fires. Verify renderer FPS stays >55.
- Verify backpressure does NOT trigger for slow output (interactive shell typing).

**Risk:** node-pty's `pause()` / `resume()` semantics on Windows may differ from POSIX. Test on Mac first; gate Windows behind feature flag if behavior diverges.

### 1.2 Stuck-session silence detection (NOT auto-kill)
**Owner files:** [src/chat-manager.js](../../src/chat-manager.js), renderer chat UI

**Implementation:**

```js
// src/chat-manager.js — additions

const SilenceThresholdMs = 30_000  // tune based on Phase 0.4 baseline

function send(win, chatId, prompt, claudeSessionId, opts) {
  // ... existing spawn logic
  const sessionEntry = {
    proc, claudeSessionId, _evtQueue: [], _flushTimer: null,
    _lastStreamAt: Date.now(),
    _silenceTimer: null,
  }
  sessions.set(chatId, sessionEntry)

  const armSilenceTimer = () => {
    clearTimeout(sessionEntry._silenceTimer)
    sessionEntry._silenceTimer = setTimeout(() => {
      if (!win.isDestroyed()) {
        win.webContents.send(`${ch.CHAT_SILENT}:${chatId}`, {
          silentMs: Date.now() - sessionEntry._lastStreamAt,
        })
      }
    }, SilenceThresholdMs)
  }

  armSilenceTimer()  // arm on send

  // Inside the queueEvent function (existing):
  const queueEvent = (event) => {
    sessionEntry._lastStreamAt = Date.now()
    armSilenceTimer()  // re-arm on each event
    sessionEntry._evtQueue.push(event)
    if (!sessionEntry._flushTimer) {
      sessionEntry._flushTimer = setTimeout(flushEvents, 16)
    }
  }
}
```

**Renderer:** subscribe to `chat-silent` event, render an inline affordance: "Still thinking… [Cancel] [Show details]". `[Cancel]` calls existing `window.ace.chat.cancel(id)`. `[Show details]` opens a panel with last stream event timestamps.

**Critical: do NOT auto-kill the process.** Mirror VS Code's pattern: detect silence, surface UI, let user act. Hard-exit handling (`proc.on('close')` at [chat-manager.js:336-343](../../src/chat-manager.js#L336-L343)) already covers actual crashes.

**Tests:**
- Force a chat to hang (e.g., MCP server with intentional sleep). Verify silence event fires within 30s. Verify cancel works.
- Verify silence event does NOT fire during legitimate slow streams (long thinking turns).

**Risk:** False positives during legitimate multi-minute thinking. Mitigate by tuning threshold post-Phase-0.4 baseline.

### 1.3 Spawn timeout for chat-manager
**Owner files:** [src/chat-manager.js](../../src/chat-manager.js)

**Implementation:**

```js
// src/chat-manager.js — additions

const SpawnTimeoutMs = 5_000

function send(win, chatId, prompt, claudeSessionId, opts) {
  const proc = spawn(claudeBin, args, { stdio: ['pipe', 'pipe', 'pipe'], env: {...} })

  let spawned = false
  const spawnTimeout = setTimeout(() => {
    if (!spawned) {
      try { proc.kill('SIGKILL') } catch (_) {}
      if (!win.isDestroyed()) {
        win.webContents.send(`${ch.CHAT_ERROR}:${chatId}`, JSON.stringify({
          type: 'chat-spawn-timeout',
          message: `Claude CLI did not start within ${SpawnTimeoutMs}ms`,
        }))
      }
    }
  }, SpawnTimeoutMs)

  proc.once('spawn', () => {
    spawned = true
    clearTimeout(spawnTimeout)
  })

  proc.once('error', (err) => {
    spawned = true
    clearTimeout(spawnTimeout)
    // existing error handling
  })

  // ... rest unchanged
}
```

**Tests:**
- Misconfigure `claudeBinaryPath` to non-existent file. Verify timeout fires within 5s and surfaces error event.
- Verify normal spawns are unaffected (no timeout fires during healthy use).

**Risk:** Cold disk on first launch may exceed 5s; rare but possible. If Phase 0.5 baseline shows p99 > 4s, raise to 10s.

### 1.4 DisposableStore in main process
**Owner files:** new `src/lifecycle.js`, [src/pty-manager.js](../../src/pty-manager.js), [src/chat-manager.js](../../src/chat-manager.js)

**Implementation:**

```js
// src/lifecycle.js — minimal port of VS Code's DisposableStore

class DisposableStore {
  constructor() {
    this._toDispose = new Set()
    this._isDisposed = false
  }
  add(disposable) {
    if (this._isDisposed) {
      try { disposable.dispose?.() } catch (_) {}
      return disposable
    }
    this._toDispose.add(disposable)
    return disposable
  }
  delete(disposable) {
    this._toDispose.delete(disposable)
    try { disposable.dispose?.() } catch (_) {}
  }
  dispose() {
    if (this._isDisposed) return
    this._isDisposed = true
    for (const d of this._toDispose) {
      try { d.dispose?.() } catch (_) {}
    }
    this._toDispose.clear()
  }
}

function toDisposable(fn) {
  return { dispose: fn }
}

module.exports = { DisposableStore, toDisposable }
```

**Refactor pty-manager.js:**
```js
const { DisposableStore, toDisposable } = require('./lifecycle')

function create(win, id, cwd, claudeBin, cols, rows) {
  const store = new DisposableStore()
  const shell = pty.spawn(...)

  store.add(toDisposable(() => { try { shell.kill() } catch (_) {} }))
  store.add(toDisposable(() => { clearTimeout(session.batchTimer) }))
  // ... etc

  const session = { shell, store, /* ... */ }
  sessions.set(id, session)
}

function kill(id) {
  const session = sessions.get(id)
  if (!session) return
  session.store.dispose()  // cascades cleanup
  sessions.delete(id)
}
```

Same pattern for chat-manager.js: every per-session timer, listener, child process becomes a `Disposable` registered into a per-session store. `cancel(chatId)` and exit handlers call `store.dispose()`.

**Tests:**
- Phase 0.1 churn scenario should plateau more cleanly.
- Verify no listener-count growth across 50 cycles.

**Risk:** Refactor surface is moderate — both managers touched. Ship behind a flag (`useDisposableStore`) for one release; promote after a week.

### 1.5 Memory telemetry in refresh-engine
**Owner files:** [main.js](../../main.js), [renderer/modules/refresh-engine.js](../../renderer/modules/refresh-engine.js), new IPC channel

**Implementation:**

```js
// main.js
ipcMain.handle('main-memory-usage', () => {
  const usage = process.memoryUsage()
  return {
    rss: usage.rss,
    heapUsed: usage.heapUsed,
    heapTotal: usage.heapTotal,
    external: usage.external,
    sessionCount: require('./src/pty-manager').count() + require('./src/chat-manager').count(),
    timestamp: Date.now(),
  }
})

// In app startup: log every 60s to ~/Library/Logs/ACE/memory.ndjson
const fs = require('fs')
const path = require('path')
const logFile = path.join(app.getPath('logs'), 'memory.ndjson')
setInterval(async () => {
  const sample = await ipcMain._handle('main-memory-usage')
  fs.appendFile(logFile, JSON.stringify(sample) + '\n', () => {})
}, 60_000)
```

**Renderer:** in [refresh-engine.js](../../renderer/modules/refresh-engine.js), every soft-GC tick fetch `main-memory-usage` and include it in the health snapshot logged to console + `~/Library/Logs/ACE/refresh-engine.ndjson`.

**Tests:**
- Verify log file is created and writable.
- Verify rotation (manual: simulate 7+ days of logs, check truncation).

**Risk:** Disk write every 60s is negligible (~200 bytes/sample). 7-day retention = ~2MB.

---

## Phase 2 — UtilityProcess extraction (deferred, ~2 weeks)

Only after Phase 1 ships and Phase 0 harness shows stable numbers in production for ≥1 release.

### Goal
Move `pty-manager.js` and `chat-manager.js` into a single `UtilityProcess` (the "ACE Pty/Chat Host"). Mirrors VS Code's pty host pattern. The main process becomes orchestration-only; child process spawning, stream parsing, batching, and backpressure all live in the utility process.

### Why deferred
- Migration is risky: native modules (node-pty), child process inheritance, file descriptor lifecycle all change behavior in utility processes vs main.
- Phase 1 closes the most painful gaps without architectural rewrite. We need to confirm those changes are sufficient before paying the migration cost.
- Phase 0 harness is what validates whether Phase 2 is actually needed. If Phase 1 + harness shows stable numbers under all scenarios, Phase 2 may be unnecessary.

### Migration plan (when triggered)
1. Verify node-pty works inside `utilityProcess.fork()` on macOS, Linux, Windows. Spike on a branch, no production code.
2. Extract pty-manager + chat-manager to a new entry point `src/host/host-main.js`.
3. Establish MessagePort transport from main → utility process. Forward existing IPC channels.
4. Run all Phase 0 scenarios against the new architecture. Compare to Phase 1 baseline.
5. Ship behind a flag for one release. Promote.

### Expected gains
- Renderer crash resilience: pty/chat host can crash without taking the renderer with it.
- Main process stays responsive: stream parsing no longer competes with window orchestration.
- Path opens for Phase 3 (multi-window support) — utility host can serve multiple renderers.

---

## Sequencing & gates

| Phase | Effort | Ships when |
|---|---|---|
| 0 — Harness expansion | 1-2 days | Baselines documented; all scenarios pass syntactically |
| 1 — Direct patterns | 3-5 days | All five fixes pass Phase 0 scenarios; manual smoke on Mac + Linux |
| 2 — UtilityProcess | ~2 weeks | Phase 1 in production ≥1 release; harness shows residual gaps |

## Out of scope

- Worker pool for renderer CPU work — no measured CPU stalls justify this.
- Sandbox: true (full renderer sandboxing) — preload's `require('ipc-channels')` blocks this; not worth the build-config rework.
- Code-splitting renderer modules — bundle size hasn't been flagged.
- Per-session IPC channel namespacing — theoretical hardening, no actual bugs observed.

These can be revisited if Phase 0 surfaces evidence they matter.

## Success criteria for the entire plan

After Phase 1 ships:
- Phase 0.1 churn scenario: DOM/listener counts plateau within 10 cycles. RSS slope < 5MB/cycle.
- Phase 0.2 uptime: 8h run shows RSS plateau within 2h.
- Phase 0.4 MCP spawn: silence threshold for #1.2 calibrated to p99 + 50% margin.
- No new "appears frozen" reports from clients for 2 weeks post-release.
- `memory.ndjson` log shows steady-state RSS across multiple users.

If those hold, Phase 2 may be deferrable indefinitely.
