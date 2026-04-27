---
title: ACE Desktop Phase 2 — UtilityProcess Extraction Design
date: 2026-04-25
status: design (no code; awaiting Phase 1 production soak)
companions:
  - 2026-04-24-multi-session-stability.md
  - ../research/2026-04-24-vscode-multi-session-architecture.md
  - ../research/2026-04-24-ace-desktop-vscode-audit.md
---

# Phase 2: UtilityProcess Extraction — Design

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Use Sonnet, not Opus (per `feedback_sonnet_for_plan_execution.md`).

**Goal:** Move `pty-manager.js` and `chat-manager.js` out of the Electron main process into a single `utilityProcess.fork()` host, mirroring VS Code's Pty Host pattern. Result: stream parsing, child-process supervision, and node-pty I/O all live off the main thread. Main keeps orchestration only.

**Architecture:** Single utility process (`ace-host`) owns both managers. Two-stage rollout — v1 routes all IPC through main (host = compute-only, main forwards) so the existing `ipcMain` surface is unchanged; v2 adds renderer↔host MessagePort for the data plane (PTY_DATA, CHAT_STREAM) once v1 is stable. This doc fully specifies v1; v2 is a hook with explicit defer.

**Tech Stack:** Electron `utilityProcess.fork()` (Electron ≥22 API), Node IPC via `process.postMessage`/`process.on('message')`, existing `DisposableStore` from `src/lifecycle.js`, existing channel registry from `src/ipc-channels.js`. No new dependencies.

---

## 0. Phase 2 prerequisites (gate)

Do not start this plan until ALL of the below hold. If any miss, stop and revisit Phase 1.

- [ ] Phase 1.1 (PTY backpressure) shipped in a tagged release.
- [ ] Phase 1.2 (silence detection) shipped in a tagged release.
- [ ] Phase 1.3 (spawn timeout) shipped — already done at `82950b6`.
- [ ] Phase 1.4 (DisposableStore in main) shipped — already done at `5d1f6ad..95cefb9`.
- [ ] Phase 1.5 (memory telemetry) shipped — already done at `62c74f8`.
- [ ] Phase 0 stress harness has run for ≥1 production release with ≥3 distinct users (Nikhil + Aleksander + Marc minimum) and `memory.ndjson` data is in hand.
- [ ] Phase 0 baselines re-measured against the v0.2.7+ release. RSS slope, churn plateau, MCP-spawn p95 all documented in `docs/research/2026-04-24-stress-baseline.md`.
- [ ] **At least one** of these holds in the post-Phase-1 baselines: (a) RSS slope > 5 MB/cycle on churn, (b) renderer FPS dips below 50 during heavy stream, (c) main-process CPU > 25% sustained during multi-session use, (d) "appears frozen" reports continue from clients. If NONE hold, Phase 2 is unnecessary — defer indefinitely and update [2026-04-24-multi-session-stability.md](2026-04-24-multi-session-stability.md) "Success criteria" to reflect.

The "is Phase 2 actually needed" check is the most important gate. Re-read the gap audit's "Out of scope" section before starting.

---

## 1. Architecture decisions

### 1.1 Two-stage rollout: v1 (control-plane only) → v2 (data-plane MessagePort)

**Decision:** v1 keeps the main process in the data path. v2 (a separate, future plan) adds direct renderer↔host MessagePort.

**Why two stages:**
- v1 validates host *stability* (does node-pty work in a utility process? does Claude CLI spawn cleanly? do MCP auth URLs still surface?) without renderer changes.
- v2 captures the *throughput* win (main-thread freed from forwarding every PTY byte). VS Code does this — see `terminalProcessManager.ts:732-747` — but only after the host pattern itself is stable.
- Coupling them risks debugging two unfamiliar things at once: utility process semantics + a new renderer transport. Stage them.

**v1 trade-off accepted:** main process still forwards every `pty-data` event from host → renderer, so v1 doesn't fully eliminate main-thread compute. The win in v1 is crash isolation + scheduling separation (host has its own event loop), not raw throughput. Confirm this is enough by re-running Phase 0 churn + uptime scenarios against v1. If v1 alone closes the residual gap, skip v2.

### 1.2 Single host process for both managers

**Decision:** `pty-manager` + `chat-manager` share one utility process (`ace-host`), not two.

**Why one:**
- Both spawn the same `claudeBin`. Sharing the host means one place to resolve binary path, one place for env/PATH augmentation (`getAugmentedPath()` from `src/pty-manager.js:11`).
- ACE's session count is small (typically 1–4 chats + 1–2 PTYs). Two hosts is overhead with no isolation benefit.
- Mirrors VS Code's Pty Host (singleton across windows). VS Code only splits when the workload differs structurally (extension host = sandboxed user code; pty host = trusted I/O).
- If we later need to split (e.g., a misbehaving MCP server flaps the host), the v1 protocol is designed so a second host is additive.

### 1.3 IPC protocol: typed JSON messages over `process.postMessage`

**Decision:** All main↔host messages are JSON envelopes with `{ id, kind, channel, payload }`. Request/response is correlated by `id`. Events are `kind: 'event'` with no response.

**Why typed envelopes (not raw channel multiplexing):**
- The existing `ipc-channels.js` registry is per-channel-named; reusing channel names verbatim across the host boundary keeps the surface readable and greppable.
- A single envelope schema lets us add tracing, correlation IDs, and timeouts uniformly without touching every call site.
- We do NOT use `Comlink` / `electron-better-ipc` / any RPC library. Vanilla `postMessage` keeps the dependency surface unchanged and makes failure modes explicit.

**Schema:**
```js
// Request (main → host)
{ id: string, kind: 'request', channel: string, args: any[] }

// Response (host → main)
{ id: string, kind: 'response', ok: boolean, result?: any, error?: { message, stack } }

// Event (host → main, fire-and-forget)
{ kind: 'event', channel: string, payload: any }
```

`channel` reuses values from `src/ipc-channels.js` so the wire format matches what main forwards to renderer. Example: when host emits a `pty-data` event for session `id`, the `payload` is `{ id, data }` and main builds the renderer-bound channel string `${ch.PTY_DATA}:${id}` itself.

### 1.4 Migration boundary

**Moves into host (`src/host/`):**
- `src/pty-manager.js` → `src/host/pty-manager.js` (logic identical, no `BrowserWindow` refs)
- `src/chat-manager.js` → `src/host/chat-manager.js` (logic identical, no `BrowserWindow` refs)
- `src/host/host-main.js` (new) — entry point. Imports both managers, registers `process.on('message')` handler, dispatches by `channel`.
- `src/host/protocol.js` (new) — envelope helpers (`makeRequest`, `makeResponse`, `makeEvent`).

**Stays in main (`src/`):**
- `src/lifecycle.js` — used by both sides, but `require()`'d separately on each.
- `src/ipc-channels.js` — same.
- `src/mcp-auth.js` — main-side OAuth flow; host emits `MCP_OPEN_AUTH_URL` events that main forwards to renderer. The auth callback (browser → main) does not move.
- `main.js` — keeps every `ipcMain.handle/on` registration. Body of each manager-related handler swaps from `require('./src/pty-manager').foo()` to `host.invoke('pty-...', args)`.

**Does NOT move (explicit non-goals):**
- File watcher, vault reader/writer, dashboards, learn, astro, attachments — all main-process only.
- Renderer modules — zero changes in `renderer/` for v1.
- `preload.js` — zero changes for v1. The `window.ace.pty.*` and `window.ace.chat.*` shapes stay identical.

### 1.5 Native module strategy

**Decision:** node-pty is loaded only inside the host. Verified before any production code via Stage 0 spike (Task 1 below).

**Why this works:**
- Electron's `utilityProcess.fork()` runs the Electron Node runtime (same V8/N-API ABI as main), so the same `electron-rebuild`-produced `.node` binary works.
- However, the host process is invoked with a `modulePath` not via `require()`, so module resolution starts from the resolved absolute path. Use absolute paths in `host-main.js` requires.
- `nodeOptions: ['--no-warnings']` only — no `--experimental-*` flags. Default `serviceName: 'ace-host'`.
- macOS: pass `disclaim: true` so the OS treats host as a separate security entity. This matches VS Code's pattern for the extension host (`utilityProcess.fork(modulePath, args, { disclaim: true })`).

**Spike must verify:**
1. node-pty `pty.spawn` succeeds inside utility process and `onData` fires for `claudeBin --version` test.
2. Claude CLI `spawn()` from `child_process` succeeds inside utility process and stdout streams.
3. The `process.platform`-conditional PATH augmentation in `getAugmentedPath()` (currently in `src/pty-manager.js:11-41`) still resolves `claude` correctly. Utility processes inherit env from main, but `process.env.PATH` may differ from a Terminal.app shell's PATH — this is already handled in main; verify it carries.
4. Sigterm/SIGKILL on the host shuts down child PTYs cleanly (no zombies).

If ANY spike step fails on Mac arm64 — STOP. Reconsider whether host pattern is viable on the current Electron version. Document failure in `docs/research/`.

### 1.6 Crash and silence handling

**Hard crash (host process exit):**
- Main listens to `host.on('exit', code, signal)`.
- All in-flight requests reject with `host-exited` error → propagate to renderer as `chat-error` / `pty-error` per session.
- Auto-restart capped at `MaxRestarts = 5`, mirroring VS Code's `ptyHostService` (see `terminal/node/ptyHostService.ts:365-418`). Reset counter after 60s of stable host uptime.
- After max restarts: surface UI banner "ACE host crashed repeatedly. Restart the app to recover." Do NOT auto-restart further.

**Silence (host unresponsive but alive):**
- Reuse Phase 1.2's silence-detection pattern, applied to the host as a whole. Heartbeat: host posts `{ kind: 'event', channel: 'host-beat' }` every 5s. Main expects beats; after 11s of silence (mirroring VS Code's `HeartbeatConstants.FirstWaitMultiplier × 1.2 + SecondWaitMultiplier`), main fires a renderer event `host-unresponsive` for UI signal. **Do NOT auto-kill.** Same rule as 1.2 — silence ≠ crash.

**Spawn timeout (host fork itself fails):**
- 5s timeout on `utilityProcess.fork()` resolving via first heartbeat. Mirrors `CreateProcessTimeout = 5000`. On timeout: kill host, surface `host-spawn-failed` to renderer, fall back to in-main code path (the feature-flag rollback covers this).

### 1.7 Feature flag

**Decision:** Single config flag `useUtilityHost: boolean`, default `false`. Lives in `~/Library/Application Support/ACE/ace-config.json`. Settable via the existing `PATCH_CONFIG` IPC handler.

**Why flag-gated:**
- Allows per-user soak. Nikhil + Aleksander + Marc test in `useUtilityHost: true`; everyone else stays on the proven in-main path.
- Crash-recovery path: if host crashes 5×, main can flip flag to `false` for the remainder of the session and persist a "degraded mode" notice. Restart returns to flag value (so it's not silently disabled forever).
- Removal path is one commit when v1 is the default.

---

## 2. v1 IPC protocol — full spec

### 2.1 Channel inventory (host ↔ main)

Every channel below uses identifiers from `src/ipc-channels.js`. The wire format is the JSON envelope from §1.3.

**Main → host requests (handled by host, returns response):**

| Channel | Args | Returns | Replaces |
|---|---|---|---|
| `pty-create` | `[id, cwd, claudeBin, cols, rows]` | spawn result | `pty-manager.create()` |
| `pty-resume` | `[id, cwd, claudeBin, cols, rows, sessionId]` | spawn result | `pty-manager.resume()` |
| `pty-write` | `[id, data]` | `void` | `pty-manager.write()` |
| `pty-resize` | `[id, cols, rows]` | `void` | `pty-manager.resize()` |
| `pty-kill` | `[id]` | `void` | `pty-manager.kill()` |
| `pty-killall` | `[]` | `void` | `pty-manager.killAll()` |
| `pty-ack` | `[id, charCount]` | `void` | `pty-manager.ack()` (Phase 1.1) |
| `chat-send` | `[chatId, prompt, cwd, claudeBin, claudeSessionId, opts]` | spawn ack | `chat-manager.send()` |
| `chat-cancel` | `[chatId]` | `void` | `chat-manager.cancel()` |
| `chat-cancelall` | `[]` | `void` | `chat-manager.cancelAll()` |
| `chat-respond` | `[chatId, text]` | `void` | `chat-manager.respond()` |
| `chat-prewarm` | `[claudeBin]` | `void` | `chat-manager.prewarm()` |
| `host-stress-snapshot` | `[]` | `{ ptySessions, chatSessions }` | (new — used by `STRESS_SNAPSHOT` and `MAIN_MEMORY_USAGE`) |

**Host → main events (forwarded by main to renderer):**

| Host event channel | Main fans out to renderer channel | Notes |
|---|---|---|
| `pty-data` | `${ch.PTY_DATA}:${id}` | payload `{ id, data }` |
| `pty-error` | `${ch.PTY_ERROR}:${id}` | payload `{ id, message }` |
| `chat-stream` | `${ch.CHAT_STREAM}:${chatId}` | payload `{ chatId, events: [...] }` (already batched per Phase 1) |
| `chat-error` | `${ch.CHAT_ERROR}:${chatId}` | payload `{ chatId, message }` |
| `chat-exit` | `${ch.CHAT_EXIT}:${chatId}` | payload `{ chatId, code }` |
| `chat-spawn-status` | `${ch.CHAT_SPAWN_STATUS}:${chatId}` | payload (existing shape) |
| `chat-silent` | `${ch.CHAT_SILENT}:${chatId}` (Phase 1.2) | payload `{ chatId, silentMs }` |
| `mcp-open-auth-url` | `ch.MCP_OPEN_AUTH_URL` (broadcast) | unchanged |
| `mcp-reset-auth` | `ch.MCP_RESET_AUTH` (broadcast) | unchanged |
| `host-beat` | (consumed by main's heartbeat watchdog) | not forwarded |

### 2.2 The host runtime (`src/host/host-main.js`)

```js
// src/host/host-main.js
// Entry point for the ACE host utility process.

const ptyManager = require('./pty-manager')
const chatManager = require('./chat-manager')

const HEARTBEAT_INTERVAL_MS = 5_000

// --- Outbound (host → main) ---
function emit(channel, payload) {
  process.parentPort.postMessage({ kind: 'event', channel, payload })
}

function respond(id, ok, result, error) {
  process.parentPort.postMessage({ kind: 'response', id, ok, result, error })
}

// Inject the emit fn into both managers so they can fire events
// without taking a `BrowserWindow` ref. The shape mirrors the events
// each manager used to send via `win.webContents.send`.
ptyManager.bindEmitter(emit)
chatManager.bindEmitter(emit)

// --- Inbound (main → host) ---
const handlers = {
  'pty-create':       (args) => ptyManager.create(...args),
  'pty-resume':       (args) => ptyManager.resume(...args),
  'pty-write':        (args) => { ptyManager.write(...args) },
  'pty-resize':       (args) => { ptyManager.resize(...args) },
  'pty-kill':         (args) => { ptyManager.kill(...args) },
  'pty-killall':      ()     => { ptyManager.killAll() },
  'pty-ack':          (args) => { ptyManager.ack(...args) },
  'chat-send':        (args) => chatManager.send(...args),
  'chat-cancel':      (args) => { chatManager.cancel(...args) },
  'chat-cancelall':   ()     => { chatManager.cancelAll() },
  'chat-respond':     (args) => { chatManager.respond(...args) },
  'chat-prewarm':     (args) => { chatManager.prewarm(...args) },
  'host-stress-snapshot': () => ({
    ptySessions:  ptyManager.sessions.size,
    chatSessions: chatManager.sessionCount(),
  }),
}

process.parentPort.on('message', (e) => {
  const msg = e.data
  if (msg.kind !== 'request') return
  const handler = handlers[msg.channel]
  if (!handler) {
    respond(msg.id, false, null, { message: `unknown channel: ${msg.channel}` })
    return
  }
  Promise.resolve()
    .then(() => handler(msg.args || []))
    .then(result => respond(msg.id, true, result))
    .catch(err => respond(msg.id, false, null, {
      message: String(err?.message || err),
      stack: err?.stack,
    }))
})

// Heartbeat
setInterval(() => emit('host-beat', { ts: Date.now() }), HEARTBEAT_INTERVAL_MS)

// Tear down on host exit
process.on('exit', () => {
  try { ptyManager.killAll() } catch (_) {}
  try { chatManager.cancelAll() } catch (_) {}
})
```

### 2.3 The main-side client (`src/host/host-client.js`)

```js
// src/host/host-client.js
// Main-process client: forks the host, exposes a typed invoke() API,
// proxies events back to the renderer.

const { utilityProcess, app } = require('electron')
const path = require('path')
const ch = require('../ipc-channels')

const HEARTBEAT_TIMEOUT_MS = 11_000   // mirrors Phase 1.2 + VS Code's 6s+5s window
const SPAWN_TIMEOUT_MS = 5_000
const MAX_RESTARTS = 5
const RESTART_RESET_AFTER_MS = 60_000

let win = null
let host = null
let pending = new Map()    // id → { resolve, reject, timer }
let nextId = 0
let lastBeatAt = 0
let beatWatchdog = null
let restartCount = 0
let lastRestartAt = 0
let isShuttingDown = false

function bindWindow(mainWindow) { win = mainWindow }

function start() {
  return new Promise((resolve, reject) => {
    const modulePath = path.join(__dirname, 'host-main.js')
    host = utilityProcess.fork(modulePath, [], {
      serviceName: 'ace-host',
      stdio: 'inherit',                  // logs flow to main's stdout for now
      // disclaim: true (macOS) — add only after spike verifies it doesn't break node-pty
    })

    const spawnTimer = setTimeout(() => {
      reject(new Error('host-spawn-timeout'))
      try { host.kill() } catch (_) {}
    }, SPAWN_TIMEOUT_MS)

    host.once('spawn', () => {
      clearTimeout(spawnTimer)
      lastBeatAt = Date.now()
      armBeatWatchdog()
      resolve()
    })

    host.on('message', onMessage)
    host.once('exit', onExit)
  })
}

function onMessage(msg) {
  if (msg.kind === 'response') {
    const slot = pending.get(msg.id)
    if (!slot) return
    pending.delete(msg.id)
    clearTimeout(slot.timer)
    if (msg.ok) slot.resolve(msg.result)
    else slot.reject(Object.assign(new Error(msg.error.message), { stack: msg.error.stack }))
    return
  }
  if (msg.kind === 'event') {
    if (msg.channel === 'host-beat') {
      lastBeatAt = Date.now()
      return
    }
    forwardEventToRenderer(msg.channel, msg.payload)
  }
}

function forwardEventToRenderer(channel, payload) {
  if (!win || win.isDestroyed()) return
  switch (channel) {
    case 'pty-data':           return win.webContents.send(`${ch.PTY_DATA}:${payload.id}`, payload.data)
    case 'pty-error':          return win.webContents.send(`${ch.PTY_ERROR}:${payload.id}`, payload.message)
    case 'chat-stream':        return win.webContents.send(`${ch.CHAT_STREAM}:${payload.chatId}`, payload.events)
    case 'chat-error':         return win.webContents.send(`${ch.CHAT_ERROR}:${payload.chatId}`, payload.message)
    case 'chat-exit':          return win.webContents.send(`${ch.CHAT_EXIT}:${payload.chatId}`, payload.code)
    case 'chat-spawn-status':  return win.webContents.send(`${ch.CHAT_SPAWN_STATUS}:${payload.chatId}`, payload.status)
    case 'chat-silent':        return win.webContents.send(`${ch.CHAT_SILENT}:${payload.chatId}`, payload)
    case 'mcp-open-auth-url':  return win.webContents.send(ch.MCP_OPEN_AUTH_URL, payload)
    case 'mcp-reset-auth':     return win.webContents.send(ch.MCP_RESET_AUTH, payload)
    default: console.warn('[host] unknown event channel', channel)
  }
}

function invoke(channel, args = [], { timeoutMs = 30_000 } = {}) {
  if (!host) return Promise.reject(new Error('host-not-started'))
  const id = String(++nextId)
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      pending.delete(id)
      reject(new Error(`host-invoke-timeout: ${channel}`))
    }, timeoutMs)
    pending.set(id, { resolve, reject, timer })
    host.postMessage({ kind: 'request', id, channel, args })
  })
}

function armBeatWatchdog() {
  clearInterval(beatWatchdog)
  beatWatchdog = setInterval(() => {
    const silentMs = Date.now() - lastBeatAt
    if (silentMs > HEARTBEAT_TIMEOUT_MS && win && !win.isDestroyed()) {
      win.webContents.send('host-unresponsive', { silentMs })
    }
  }, 2_000)
}

function onExit(code, signal) {
  clearInterval(beatWatchdog)
  for (const [id, slot] of pending) {
    clearTimeout(slot.timer)
    slot.reject(new Error(`host-exited (code=${code}, signal=${signal})`))
  }
  pending.clear()
  host = null
  if (isShuttingDown) return

  // Reset restart counter if previous host ran > RESTART_RESET_AFTER_MS
  if (Date.now() - lastRestartAt > RESTART_RESET_AFTER_MS) restartCount = 0

  if (restartCount >= MAX_RESTARTS) {
    if (win && !win.isDestroyed()) win.webContents.send('host-dead', { restartCount })
    return
  }
  restartCount++
  lastRestartAt = Date.now()
  start().catch(err => console.error('[host] restart failed', err))
}

function shutdown() {
  isShuttingDown = true
  if (host) try { host.kill() } catch (_) {}
}

module.exports = { bindWindow, start, invoke, shutdown }
```

### 2.4 main.js wiring change (representative)

Replace direct manager calls with host-client invocations, gated on the flag:

```js
// main.js — single-line change to each handler when flag is on.

const hostClient = require('./src/host/host-client')

function useHost() { return loadConfig().useUtilityHost === true }

ipcMain.handle('pty-create', (_, id, cwd, cols, rows) => {
  const args = [id, cwd || resolveVaultPath(), resolveClaudeBin(), cols, rows]
  return useHost()
    ? hostClient.invoke('pty-create', args)
    : require('./src/pty-manager').create(mainWindow, id, ...args)
})

ipcMain.on('pty-write', (_, id, data) => {
  if (useHost()) hostClient.invoke('pty-write', [id, data])
  else require('./src/pty-manager').write(id, data)
})

// ...same shape for every manager-related handler
```

The `mainWindow` ref disappears from the host path because the host receives `win` indirectly through main's `forwardEventToRenderer`.

### 2.5 Manager changes for host-mode

Both managers move to `src/host/` and replace `win.webContents.send(...)` with `emit(...)`. Concretely:

```js
// src/host/pty-manager.js (was src/pty-manager.js)
let _emit = () => {}
function bindEmitter(fn) { _emit = fn }

// Inside create()/onData:
shell.onData(data => {
  // existing batching / backpressure / DisposableStore logic unchanged
  _emit('pty-data', { id, data: merged })
})

// Inside exit handler:
shell.onExit(({ exitCode, signal }) => {
  _emit('pty-error', { id, message: `exited code=${exitCode} signal=${signal}` })
})

module.exports = { sessions, bindEmitter, create, resume, write, resize, kill, killAll, ack }
```

Same shape for `chat-manager.js`. The `BrowserWindow` parameter goes away from every signature in the host versions; main-side wrappers keep accepting it for backwards compat during the transition.

---

## 3. Rollout strategy

| Stage | Duration | Action | Gate to next stage |
|---|---|---|---|
| 0 — Spike | 1 day | Throwaway branch. Verify node-pty + Claude CLI spawn inside `utilityProcess.fork()` on Mac. | All four §1.5 spike checks pass on Mac arm64. |
| 1 — Scaffolding | 1 day | Land `src/host/host-client.js`, `src/host/host-main.js` skeleton, `useUtilityHost` flag (default false). No managers moved yet. | App builds + runs unchanged with flag off. With flag on, host forks but no real work routed. |
| 2 — pty-manager extraction | 2 days | Copy `src/pty-manager.js` → `src/host/pty-manager.js`. Add `bindEmitter`. Wire pty handlers through `useHost()`. | Phase 0.1 churn scenario passes on flag-on. PTY-heavy stress matches in-main numbers ±10%. |
| 3 — chat-manager extraction | 2 days | Same for `src/chat-manager.js`. Includes MCP regex classifiers and silence detection. | Full Phase 0 harness passes on flag-on. MCP auth URL surfaces correctly through new path (manual smoke). |
| 4 — Crash + watchdog hardening | 1 day | Restart-on-exit cap, `host-unresponsive` UI banner, degraded-mode fallback (auto-flip flag to false after 5 crashes for current session). | Force-kill host mid-session; verify UI banner + recovery. Force `process.exit(1)` in host handler; verify auto-restart. |
| 5 — Internal soak | 1 release cycle | Tag a build with flag = true for Nikhil + Aleksander + Marc. Everyone else stays default false. Collect `memory.ndjson` + `host-unresponsive` events. | Zero unrecovered crashes for 1 release cycle. RSS numbers ≤ in-main baseline. |
| 6 — Default flip | 1 release cycle | Default `useUtilityHost: true`. Old in-main code path retained as fallback. | Zero rollbacks reported. |
| 7 — Cleanup | 0.5 day | Delete `src/pty-manager.js` and `src/chat-manager.js` (originals). Remove flag and `useHost()` branches. | Final commit; close Phase 2. |

**Total active dev:** ~8 days. **Total elapsed (incl. soak):** ~6 weeks given a 2-week release cycle.

**Hard rule:** never proceed to a later stage if the current stage's gate fails. The plan absorbs slip — if Stage 2 churn numbers regress 30%, that's a Stage-2 problem, not a Stage 3 problem masked.

---

## 4. Risk register

| Risk | Likelihood | Impact | Mitigation |
|---|---|---|---|
| node-pty fails to load in utility process | Low (Electron docs claim parity) | Blocks Phase 2 entirely | Stage 0 spike. If fails, document and abandon Phase 2 — Phase 1 already shipped most of the gain. |
| `process.env.PATH` in host doesn't resolve `claude` | Medium | Chat/PTY spawn fails | Re-run `getAugmentedPath()` from inside host-main.js before spawning; pass augmented PATH to all child spawns. Verify in Stage 0 spike. |
| Host crashes more than in-main path due to new failure modes | Medium | Soak fails, rollback | Crash recovery + auto-restart cap (§1.6). Auto-flip flag to false on persistent crash. Nikhil-only soak first. |
| MessagePort/postMessage payload size limits | Low | Large stream events truncate | Existing chat batching keeps events small (~16ms windows). Document max envelope size; assert in dev mode. |
| Renderer event ordering changes (host → main → renderer adds latency) | Medium | Subtle UI bugs | Audit any place renderer assumes synchronous handler completion. None known after Phase 1, but call out during Stage 3 review. |
| Disclaim/sandbox flags break node-pty on macOS | Medium | Host crashes on Mac | Don't enable `disclaim: true` until spike verifies. Default `serviceName` only. |
| File descriptor inheritance differs | Low | Child processes leak FDs | Verify with `lsof -p <host-pid>` during Stage 2 churn. Existing DisposableStore in pty-manager handles this if signals propagate. |
| Stress harness can't observe host (it pokes main only) | High | Numbers misleading | Add `host-stress-snapshot` request to harness so Phase 0 scenarios sample host-side state. New IPC channel `STRESS_SNAPSHOT` already exists and can be extended. |

---

## 5. Implementation plan (Sonnet-executable)

This section is the executable plan. Each task is bite-sized; commit after each. Use Sonnet (not Opus). Use `superpowers:test-driven-development` when adding logic; use `superpowers:verification-before-completion` before claiming any task complete.

**Branch:** `feat/utility-host` (new, off `main` after Phase 1 fully merged). Confirm `git branch --show-current` shows `feat/utility-host` before any Edit/Write to `ace-desktop/`. Per `feedback_branch_check_before_ace_desktop_edits.md`.

**Scope:** All commits paths are `ace-desktop/...`. Never `git add -A`. Per `feedback_multi_app_git_scoping.md`.

### Task 1: Stage 0 spike (throwaway)

**Files:** `ace-desktop/scripts/spike-utility-host.js` (new, will be deleted)

**Step 1.** Create the spike script that forks a utility process and invokes node-pty.

```js
// ace-desktop/scripts/spike-utility-host.js
// Throwaway. Verifies node-pty + child_process work in utilityProcess.fork().
const { app, utilityProcess } = require('electron')
const path = require('path')

app.whenReady().then(() => {
  const child = utilityProcess.fork(path.join(__dirname, 'spike-host.js'))
  child.on('spawn', () => child.postMessage({ kind: 'go' }))
  child.on('message', m => { console.log('[main]', m); if (m.kind === 'done') app.quit() })
  child.on('exit', code => console.log('[main] host exited', code))
})
```

```js
// ace-desktop/scripts/spike-host.js
const pty = require('node-pty')
const { spawn } = require('child_process')

process.parentPort.on('message', (e) => {
  if (e.data.kind !== 'go') return
  // Test 1: node-pty
  const shell = pty.spawn('/bin/sh', ['-c', 'echo HELLO_PTY'], { name: 'xterm', cols: 80, rows: 24 })
  shell.onData(d => process.parentPort.postMessage({ kind: 'pty-data', data: d.toString() }))
  shell.onExit(({ exitCode }) => {
    // Test 2: child_process spawn
    const proc = spawn('/bin/sh', ['-c', 'echo HELLO_SPAWN'])
    proc.stdout.on('data', d => process.parentPort.postMessage({ kind: 'spawn-data', data: d.toString() }))
    proc.on('exit', () => process.parentPort.postMessage({ kind: 'done', ptyCode: exitCode }))
  })
})
```

**Step 2.** Run with `npm start -- --spike` (add a one-line conditional in `main.js` that calls the spike script when arg present, gated on dev). Manually delete after task.

**Step 3.** Verify: console shows `HELLO_PTY` and `HELLO_SPAWN`. Exit code 0. No native module errors.

**Step 4.** Repeat with `claudeBin --version` instead of `/bin/sh -c echo`. Verify Claude CLI starts inside utility process.

**Step 5.** Delete `spike-utility-host.js` + `spike-host.js`. Commit nothing from this task.

**Gate:** All four §1.5 checks pass. If any fail, STOP and update this doc with findings before proceeding.

### Task 2: Add `useUtilityHost` config flag

**Files:** `ace-desktop/main.js` (config schema), `ace-desktop/renderer/...` (settings UI — only if a UI toggle is desired; not required for v1).

**Step 1.** In `main.js` `loadConfig()`, ensure `useUtilityHost` defaults to `false` if absent. Verify the existing `PATCH_CONFIG` IPC handler accepts the new key.

**Step 2.** Test: `await window.ace.config.patch({ useUtilityHost: true })` from devtools persists to `ace-config.json`. Restart, value persists.

**Step 3.** Commit: `feat(ace-desktop): Phase 2.0 — add useUtilityHost config flag`

### Task 3: Scaffold `src/host/` directory

**Files:**
- Create: `ace-desktop/src/host/host-client.js`
- Create: `ace-desktop/src/host/host-main.js`
- Create: `ace-desktop/src/host/protocol.js` (envelope helpers if extracted)

**Step 1.** Implement `host-client.js` per §2.3. Include `start`, `invoke`, `shutdown`, `bindWindow`. No managers required yet — `host-main.js` can be a stub that only emits `host-beat`.

**Step 2.** Implement `host-main.js` skeleton: heartbeat only, no handlers wired.

**Step 3.** In `main.js`, after `mainWindow` is created and `useHost()` is true, call `hostClient.bindWindow(mainWindow)` then `hostClient.start()`. Wrap in try/catch — failure must not block startup.

**Step 4.** Manual test: set `useUtilityHost: true`, restart app. Verify host process appears in `ps -ax | grep ace-host`. Verify console shows `host-beat` debug logs (add temporarily, remove before commit).

**Step 5.** Commit: `feat(ace-desktop): Phase 2.1 — host-client + host-main skeleton`

### Task 4: Move pty-manager into host

**Files:**
- Create: `ace-desktop/src/host/pty-manager.js` (copy of `ace-desktop/src/pty-manager.js`)
- Modify: `ace-desktop/src/host/pty-manager.js` — add `bindEmitter`, replace `win.webContents.send(...)` calls with `_emit(...)`. Drop the `win` parameter from `create`/`resume`. Keep `id, cwd, claudeBin, cols, rows` shape.
- Modify: `ace-desktop/src/host/host-main.js` — wire `pty-*` handlers per §2.2.
- Modify: `ace-desktop/main.js` — switch every `pty-*` IPC handler to use `useHost()` branching per §2.4.

**Step 1.** Copy file. Re-run `electron-rebuild` in case node-pty needs rebuild for utility-process load semantics.

**Step 2.** TDD: write a smoke script (NOT committed) that runs `pty-create` via host-client, confirms `pty-data` events arrive in main with correct `${ch.PTY_DATA}:${id}` channel forwarding to renderer. Verify backpressure (Phase 1.1) still works — fast-output stress test should still pause/resume.

**Step 3.** Run Phase 0.1 churn scenario with flag on. Compare DOM/listener/RSS plateau against Phase 1 baseline. Document deltas in `docs/research/2026-04-25-utility-host-phase2-numbers.md`.

**Step 4.** Commit: `feat(ace-desktop): Phase 2.2 — extract pty-manager into utility host`

**Gate:** Phase 0.1 + 0.2 numbers within 10% of Phase 1 baseline. If churn regresses, debug before Stage 3.

### Task 5: Move chat-manager into host

**Files:**
- Create: `ace-desktop/src/host/chat-manager.js` (copy of `ace-desktop/src/chat-manager.js`)
- Modify: same pattern as Task 4. `bindEmitter`, drop `win`, replace sends with emits.
- Modify: `ace-desktop/src/host/host-main.js` — wire `chat-*` handlers.
- Modify: `ace-desktop/main.js` — switch chat IPC handlers to `useHost()` branching.

**Step 1.** Copy file. Confirm MCP regex classifiers come along (`MCP_REMOTE_AUTH_URL_RE` etc., per `chat-manager.js:49-59`).

**Step 2.** Smoke test: send a chat with flag on. Verify stream events arrive in renderer batched. Verify `chat-error`, `chat-exit`, `chat-spawn-status` all fire. Verify silence detection (Phase 1.2) still triggers UI affordance.

**Step 3.** Manual MCP auth flow test: send a chat that triggers `mcp-remote` OAuth. Verify auth URL still opens via `mcp-open-auth-url` event. Complete auth flow end-to-end.

**Step 4.** Run Phase 0.4 (MCP spawn timing) baseline. Numbers should match Phase 1 ±20%.

**Step 5.** Commit: `feat(ace-desktop): Phase 2.3 — extract chat-manager into utility host`

**Gate:** Full Phase 0 harness green on flag-on. Manual MCP smoke passes.

### Task 6: Crash recovery + watchdog UI

**Files:**
- Modify: `ace-desktop/src/host/host-client.js` — verify §2.3 restart logic and `host-unresponsive` event work end-to-end.
- Modify: `ace-desktop/renderer/app.js` (or appropriate module) — subscribe to `host-unresponsive` and `host-dead` events, render banner.

**Step 1.** Add a renderer banner component for "host-unresponsive" (yellow) and "host-dead" (red, with restart instructions). Use existing notification patterns.

**Step 2.** Test: in devtools, force `process.exit(1)` from host (add a temporary debug IPC). Verify host restarts, sessions reconnect, banner appears for ~2s then clears.

**Step 3.** Test: force 6 crashes within 60s. Verify `host-dead` fires after 5th, banner stays, no further restart attempts.

**Step 4.** Test: SIGSTOP host process (`kill -STOP <pid>`), wait 15s. Verify `host-unresponsive` banner. SIGCONT, verify banner clears.

**Step 5.** Commit: `feat(ace-desktop): Phase 2.4 — host crash recovery + unresponsive banner`

### Task 7: Stress harness host-aware

**Files:**
- Modify: `ace-desktop/scripts/stress.js` — add a `--host` mode that asserts the snapshot endpoint reflects host-side state, not main-side stale state.
- Modify: `ace-desktop/main.js` — `STRESS_SNAPSHOT` handler in §main.js:847 already pokes `pty-manager`; update to call `hostClient.invoke('host-stress-snapshot', [])` when flag is on, merge with main-side counts.

**Step 1.** Update stress harness to dual-snapshot (main + host) and report both.

**Step 2.** Re-run Phase 0.1 + 0.2 + 0.4 with flag on. Save numbers in `docs/research/2026-04-25-utility-host-phase2-numbers.md`.

**Step 3.** Commit: `feat(ace-desktop): Phase 2.5 — stress harness host-aware`

### Task 8: Internal soak release

**Files:** None — release tag.

**Step 1.** Verify all Phase 2.0–2.5 commits on `main` (not stuck on `feat/utility-host`). Per `feedback_release_ci_workflow.md`, push tag `ace-desktop-v0.X.0`; CI builds.

**Step 2.** Hand-flip `useUtilityHost: true` for Nikhil + Aleksander + Marc only. Document in their `~/Library/Application Support/ACE/ace-config.json`.

**Step 3.** Soak for 1 release cycle (~2 weeks). Collect `memory.ndjson`, any `host-unresponsive` / `host-dead` reports.

**Gate:** Zero unrecovered crashes. RSS numbers ≤ Phase 1 baseline.

### Task 9: Default flip

**Files:** `ace-desktop/main.js` — change `useUtilityHost` default to `true` in `loadConfig()`.

**Step 1.** Edit default.

**Step 2.** Tag release. Soak 1 more cycle.

**Step 3.** Commit: `feat(ace-desktop): Phase 2.6 — default useUtilityHost to true`

### Task 10: Cleanup

**Files:**
- Delete: `ace-desktop/src/pty-manager.js`
- Delete: `ace-desktop/src/chat-manager.js`
- Modify: `ace-desktop/main.js` — remove `useHost()` branching, call host-client unconditionally.
- Modify: `ace-desktop/main.js` — remove `useUtilityHost` flag handling.

**Step 1.** Delete originals. Audit for any lingering `require('./src/pty-manager')` or `./src/chat-manager` outside the host directory.

**Step 2.** Simplify all manager-related IPC handlers to call `hostClient.invoke(...)` directly.

**Step 3.** Run full Phase 0 harness one final time.

**Step 4.** Commit: `feat(ace-desktop): Phase 2.7 — drop in-main manager fallback`

---

## 6. Success criteria (Phase 2 done when)

After Task 10:
- Phase 0.1 churn: DOM/listener/RSS plateau within 10 cycles, RSS slope ≤ Phase 1 baseline.
- Phase 0.2 uptime: 8h run shows RSS plateau within 2h, slope ≤ Phase 1 baseline.
- Renderer FPS during heavy stream stays ≥55 (Phase 1 may have already hit this; confirm Phase 2 holds).
- Main-process CPU during multi-session use drops measurably vs Phase 1 baseline (this is the v1 win — schedules off main).
- Zero "appears frozen" reports for 4 weeks post-default-flip.
- `memory.ndjson` shows steady-state RSS ≤ 600 MB across all v0.X.0+ users for 4 weeks.

## 7. Out of scope (and why)

- **v2 renderer↔host MessagePort.** Defer until v1 numbers prove main-process forwarding is the throughput bottleneck. Separate plan: `docs/plans/YYYY-MM-DD-utility-host-messageport.md`.
- **Multi-window support.** Out of scope until ACE actually supports multiple windows (it doesn't — single `mainWindow`). When that lands, the host pattern already supports it (host is singleton-per-app, fans out to per-window webContents).
- **Splitting pty-host from chat-host.** No evidence of cross-contamination. Keep one host.
- **Sandbox: true on renderer.** Blocked by `preload.js` requiring `ipc-channels` at build time — same constraint flagged in audit §1. Not a Phase 2 problem.
- **Code-signing the host binary separately.** Same Electron runtime, same signature; verify but no extra work expected.

## 8. Open questions for execution session

These should be resolved in the spike (Task 1) or Stage 1, not pre-decided here:

1. Does `disclaim: true` on macOS break node-pty's TTY allocation? Default to `false` in v1; revisit if security review wants it.
2. Do we need a host-side process supervisor for the Claude CLI children, or does losing the host inherently SIGKILL them via the OS? Verify in Stage 0 spike.
3. Should `STRESS_SNAPSHOT` continue to live in main.js or move into the host? Decision: stays in main, calls host for the host portion. Mirrors how `MAIN_MEMORY_USAGE` already works.
4. Heartbeat tuning: 5s interval / 11s timeout matches VS Code, but ACE's host has less to do — may be able to tighten to 3s/7s if false-positive rate is low. Decide post-Stage 5 soak data.

---

## Appendix A — File diff summary

**New files:**
- `ace-desktop/src/host/host-client.js` (~150 LOC)
- `ace-desktop/src/host/host-main.js` (~80 LOC)
- `ace-desktop/src/host/pty-manager.js` (~160 LOC, mostly copy)
- `ace-desktop/src/host/chat-manager.js` (~415 LOC, mostly copy)
- `ace-desktop/docs/research/2026-04-25-utility-host-phase2-numbers.md` (results log)

**Modified files (during phased rollout):**
- `ace-desktop/main.js` — manager-related ipcMain handlers swap to `useHost()` branching, then unconditional invocation, then flag removal.
- `ace-desktop/scripts/stress.js` — host-aware snapshot mode.
- `ace-desktop/renderer/app.js` (or banner module) — `host-unresponsive` / `host-dead` UI.

**Deleted files (after Task 10):**
- `ace-desktop/src/pty-manager.js`
- `ace-desktop/src/chat-manager.js`

**Unchanged:**
- `ace-desktop/preload.js`
- `ace-desktop/src/ipc-channels.js`
- `ace-desktop/src/lifecycle.js`
- All renderer modules except the new banner subscription.

## Appendix B — When NOT to ship Phase 2

If, after Phase 1 ships and soaks for one release:
- RSS slope on Phase 0.1 < 5 MB/cycle, AND
- 8h uptime RSS plateaus within 2h, AND
- No "appears frozen" reports for 2 weeks, AND
- Main-process CPU never exceeds 20% during multi-session use,

then Phase 2 is unnecessary. Update `2026-04-24-multi-session-stability.md` "Sequencing & gates" to mark Phase 2 as `not pursued — Phase 1 sufficient` with the data link, archive this doc to `docs/plans/archive/`, and move on. The architectural complexity of utility-process extraction is not free, and an unused capability is technical debt.

The honest framing: this design exists to be ready to ship if needed, not to be shipped by default.
