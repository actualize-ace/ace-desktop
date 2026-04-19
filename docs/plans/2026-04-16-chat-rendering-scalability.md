# Chat Rendering Scalability Implementation Plan

> **Status — 2026-04-18: Mostly superseded.** Stress baselines run against
> main on 2026-04-18 (see `ace-desktop/scripts/stress-results.jsonl`) show
> P99 chat frame gap of 9.4ms — well inside the <50ms target. Refresh-engine's
> `findSettledBoundaryFrom` optimization + deduplicated rAFs + existing
> architecture handle the streaming workload. Only Task 0 (stress harness)
> and Task 4 (buffer cap + render-process-gone) shipped; Tasks 1, 2, 3, 6,
> 7, 8 are evidence-gated and evidence says no. Task 5 (lift SESSION_LIMIT)
> deferred as a product decision. Do NOT re-execute this plan without first
> re-checking `stress-results.jsonl` to confirm assumptions still hold.

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Guarantee the ACE Desktop renderer never jams (black screen) with 6–10 concurrent chat/terminal sessions, including sessions holding long (up to 1M-token) conversation histories.

**Architecture:** Three coordinated changes, in order of leverage:
1. **Chat-mode render:** Stop re-parsing whole message on every streaming chunk — parse and append only the delta. This is the dominant bottleneck (O(n²) per message today).
2. **Hidden-pane deferral:** Non-visible sessions buffer stream events as raw data; DOM mutation pauses; replay on activation. Eliminates cross-session interference.
3. **IPC backpressure:** Main-process coalescing + `node-pty` `pause()`/`resume()` flow control, plus capped chat-manager line buffer. Removes the pty fire-hose.

Everything else (syntax-highlighter worker, virtualization, `SESSION_LIMIT` lift, `render-process-gone` handler) is defense-in-depth or a cleanup-fork after the above passes the stress harness.

**Tech Stack:**
- Electron (main + renderer)
- `node-pty` ^1.1.0 (pause/resume supported, currently unused)
- `xterm.js` (terminal mode — already bounded via 5000 scrollback cap in Task 3)
- `marked` 9.1.6 + `dompurify` 3.3.3 (chat mode markdown pipeline)
- Home-rolled regex syntax highlighter in [chat-renderer.js:44-97](../../renderer/modules/chat-renderer.js#L44-L97)

**Testing note:** ace-desktop has no automated test framework ([reference_ace_desktop_no_tests.md]). Verification uses a dev-only stress harness (Task 0) plus manual visual checks. Pass criterion for each patch: stress harness frame-time degradation is ≤ baseline, zero frames > 100ms over 60s at the scenario's target session count.

**Commit discipline:** One task = one commit. Scope commit paths explicitly to `ace-desktop/` ([feedback_multi_app_git_scoping.md]). Never batch. Stop and hand back control between tasks ([feedback_incremental_edits_only.md]).

---

## Task 0: Stress harness (baseline measurement)

**Purpose:** Without a pass/fail signal, every subsequent patch is vibes-based. This harness gives reproducible numbers for each scenario.

**Files:**
- Create: `ace-desktop/scripts/stress.js` — renderer-side injector that spawns synthetic sessions and measures frame timing + heap
- Create: `ace-desktop/scripts/stress-README.md` — how to run it
- Modify: `ace-desktop/renderer/index.html` — conditional `<script>` include guarded by `?stress=1` URL flag
- Modify: `ace-desktop/src/main.js` — allow `?stress=1` query param on main window URL in dev mode only

**Scenarios:**
1. **Chat-heavy:** spawn 6 chat sessions, inject a ~100K-token synthetic history into each, start 3 of them streaming a 20K-token response simultaneously from a canned stream-event fixture.
2. **Pty-heavy:** spawn 6 terminal sessions, each running a local `yes "xxxxxxxx"` producer through the existing `pty-manager` path.

**Metrics collected:**
- `performance.now()` rAF-interval histogram (P50, P95, P99, max) over 60s
- Peak `performance.memory.usedJSHeapSize` during run (Chromium-only, dev flag)
- Count of frames with gap > 16ms, > 50ms, > 100ms
- Console-logged as JSON at end of run

**Step 1: Write the harness**

Create `ace-desktop/scripts/stress.js` with:
- `runChatHeavy(n, msgsPerSession, streamingCount)` — fabricates session DOM via existing `spawnSession` then feeds `state.sessions[id]._currentAssistantEl` with synthetic stream events
- `runPtyHeavy(n)` — spawns real sessions via `window.ace.pty.create` with cwd set to a scratch dir; command injected via `pty.write` after spawn
- A frame-timing recorder started before scenario, stopped 60s later
- Output: `console.log(JSON.stringify({scenario, frames, heap}))` + also writes to `ace-desktop/scripts/stress-results.jsonl`

Create a stream-event fixture at `ace-desktop/scripts/fixtures/stream-response-20k.jsonl` — 1 pre-recorded 20K-token stream dump (can be captured by running `claude -p "write a long essay about X" --output-format stream-json` once and saving).

**Step 2: Wire harness into renderer under dev flag**

In `ace-desktop/renderer/index.html`, after the existing module scripts, add:
```html
<script>
  if (new URLSearchParams(location.search).get('stress') === '1') {
    import('../scripts/stress.js').then(m => window.__stress = m)
  }
</script>
```

In `ace-desktop/src/main.js` (find `mainWindow.loadFile(...)` or `loadURL`), accept a `STRESS=1` env var in dev-only branch and append `?stress=1` to the URL. Never enable in production build.

**Step 3: Run baseline — chat-heavy**

```bash
cd ace-desktop
STRESS=1 npm start
# in app: open DevTools → Console → __stress.runChatHeavy(6, 20, 3)
# wait 60s
```

Expected baseline (from audit): P95 frame gap 50–200ms, some frames > 100ms, heap growing. Record exact numbers in `ace-desktop/scripts/stress-results.jsonl`.

**Step 4: Run baseline — pty-heavy**

```
__stress.runPtyHeavy(6)
```

Record numbers.

**Step 5: Commit baseline**

```bash
git add ace-desktop/scripts/stress.js ace-desktop/scripts/stress-README.md \
        ace-desktop/scripts/fixtures/stream-response-20k.jsonl \
        ace-desktop/scripts/stress-results.jsonl \
        ace-desktop/renderer/index.html ace-desktop/src/main.js
git commit -m "$(cat <<'EOF'
feat(ace-desktop): add renderer stress harness for chat+pty scaling

Dev-only (?stress=1 URL flag). Measures frame-time percentiles and heap
across chat-heavy and pty-heavy scenarios. Baseline numbers recorded.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

**Completion criterion:** Two baseline runs recorded in `stress-results.jsonl`. No production code changed. Harness is callable but off by default.

---

## Task 1: Incremental streaming render (delta parse, not whole-text parse)

**Purpose:** This is THE dominant fix. Today, [session-manager.js:153-162](../../renderer/modules/session-manager.js#L153-L162) re-parses the entire message text on every streaming chunk via `marked.parse(entireText)` + `DOMPurify.sanitize()` + `postProcessCodeBlocks()`. At 100 chunks per message, that's 100 full re-parses of growing text = O(n²). Fix: parse only the newly-settled delta and append to the DOM.

**Files:**
- Modify: `ace-desktop/renderer/modules/session-manager.js:131-170` (`scheduleRender`, `renderChatStream`)
- Modify: `ace-desktop/renderer/modules/chat-renderer.js` — add `findSettledBoundary` incremental variant that returns `(boundary, newlySettledBlocks)` or similar delta representation
- Test via stress harness chat-heavy scenario

**Design — what "settled" boundary means today:**

The existing `findSettledBoundary()` in `chat-renderer.js:100-135` returns the character offset up to which markdown is "complete" (e.g. before the last unclosed code fence). Currently the renderer re-parses `text.slice(0, boundary)` every frame.

**Design — incremental approach:**

Track in `s._settledBoundary` AND `s._settledBlocks` (new field, array of `{start, end, nodeRef}`). On each `scheduleRender`:
1. Compute new boundary.
2. If new boundary > old boundary AND the newly-settled range contains complete markdown block(s) (paragraph, code fence, list, heading), parse ONLY that range's markdown, sanitize, and `appendChild` the resulting nodes to `settledEl`. **Never replace `.innerHTML` on the whole settled container again.**
3. If the newly-settled range does not align on a block boundary (rare — streaming usually settles full blocks at a time), fall back to the old whole-range replace — but log it so we can tighten later.
4. Tail re-rendering (`renderTail`) already only covers the unsettled tail; keep as-is.

**Step 1: Capture baseline (re-run from Task 0)**

```
STRESS=1 npm start
__stress.runChatHeavy(6, 20, 3)
```

Note P95, P99, max frame gap. Save to `stress-results.jsonl` with label `"baseline-task0"`.

**Step 2: Implement incremental parser helper**

In `ace-desktop/renderer/modules/chat-renderer.js`, add:

```js
// Returns list of { start, end } block ranges within the newly-settled slice.
// A "block" is a top-level markdown unit safe to parse standalone.
export function findNewBlocks(text, fromBoundary, toBoundary) {
  const slice = text.slice(fromBoundary, toBoundary)
  // Split on double-newline (paragraph boundary) — the safe, common case.
  // Code fences/lists settle as whole blocks because `findSettledBoundary`
  // already refuses to advance across an unclosed fence or partial list.
  const blocks = []
  let cursor = 0
  const paraRegex = /\n{2,}/g
  let m
  while ((m = paraRegex.exec(slice)) !== null) {
    blocks.push({ start: fromBoundary + cursor, end: fromBoundary + m.index })
    cursor = m.index + m[0].length
  }
  if (cursor < slice.length) {
    blocks.push({ start: fromBoundary + cursor, end: toBoundary })
  }
  return blocks
}

export function parseBlockToNodes(markdown) {
  const withWikilinks = processWikilinks(markdown)
  const raw = marked.parse(withWikilinks)
  const safe = DOMPurify.sanitize(raw, SANITIZE_CONFIG)
  const template = document.createElement('template')
  template.innerHTML = safe
  return Array.from(template.content.childNodes)
}
```

**Step 3: Rewrite `renderChatStream` to use incremental appends**

In `ace-desktop/renderer/modules/session-manager.js:143-170`, replace the body after the `settledEl` / `tailEl` query (keep that part):

```js
const boundary = findSettledBoundary(s.currentStreamText)
if (boundary > s._settledBoundary) {
  const blocks = findNewBlocks(s.currentStreamText, s._settledBoundary, boundary)
  for (const block of blocks) {
    const md = s.currentStreamText.slice(block.start, block.end)
    if (!md.trim()) continue
    const nodes = parseBlockToNodes(md)
    for (const n of nodes) settledEl.appendChild(n)
    // Process code blocks only inside the newly-appended subtree
    for (const n of nodes) {
      if (n.nodeType === 1) postProcessCodeBlocks(n)
    }
  }
  s._settledBoundary = boundary
}

const tail = s.currentStreamText.slice(boundary)
tailEl.innerHTML = tail ? renderTail(tail) : ''
scrollChatToBottom(id, 120)
```

Remove the `s._settledHTML = safe` line — no longer needed. Remove the whole-range `marked.parse(...)` + `innerHTML = safe` path.

**Step 4: Manual verification**

Launch ACE Desktop normally (`npm start`, no stress flag). Send a chat prompt that returns mixed markdown: paragraphs, a code block, a bulleted list, and some wikilinks. Watch the streaming response:
- Text appears incrementally ✓
- Code block renders correctly after fence closes ✓
- Wikilinks render as clickable ✓
- No flicker, no duplicated content ✓
- Scroll-to-bottom still works ✓

If any check fails, STOP and re-examine block-boundary logic. Common failure: a code fence that contains `\n\n` inside — `findNewBlocks` might split mid-fence. Mitigation: the outer `findSettledBoundary` won't advance past an unclosed fence, so once settled, the fence is complete — splitting on `\n\n` inside its contents is still safe because `marked` handles standalone code fences fine. Verify by inducing a long code block in the test.

**Step 5: Re-run stress harness**

```
STRESS=1 npm start
__stress.runChatHeavy(6, 20, 3)
```

Expected: P95 frame gap drops substantially (audit predicts 4–10× improvement since the O(n²) work is now O(n) total). Frames > 100ms should approach zero in this scenario alone.

Record with label `"after-task1-incremental-parse"`.

**Step 6: Commit**

```bash
git add ace-desktop/renderer/modules/session-manager.js \
        ace-desktop/renderer/modules/chat-renderer.js \
        ace-desktop/scripts/stress-results.jsonl
git commit -m "$(cat <<'EOF'
perf(ace-desktop): incremental streaming render in chat mode

Previously, every streaming delta re-parsed the entire message through
marked + DOMPurify + postProcessCodeBlocks, giving O(n²) work per message
and jamming the renderer at 3+ concurrent streaming sessions.

Now the render appends only newly-settled markdown blocks to the DOM.
Whole-text parse is gone. Stress harness shows [N]× reduction in P95
frame gap for the 6-session chat-heavy scenario.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

**Completion criterion:** Stress harness chat-heavy run shows measurable improvement, manual chat flow works correctly including code blocks + wikilinks.

---

## Task 2: Hidden-pane stream deferral

**Purpose:** Audit confirmed that inactive sessions continue processing IPC stream events and running `scheduleRender` against hidden DOM ([session-manager.js:583 and onward](../../renderer/modules/session-manager.js#L583)). Five hidden streaming sessions each burning CPU drag the active one. Agent-manager already pauses timers on `visibilitychange:hidden` ([agent-manager.js:418-434](../../renderer/modules/agent-manager.js#L418-L434)) — apply the equivalent pattern at the session level.

**Files:**
- Modify: `ace-desktop/renderer/modules/session-manager.js` — wrap the `onStream` handler so it queues events into `s._deferredEvents` when the pane is not `.active` on screen; drain + replay on activation.
- Modify: `ace-desktop/renderer/modules/session-manager.js:1233-1254` (`activateSession`) — drain `_deferredEvents` on activation.

**Design — state machine:**

Per session, add `s._isVisible` (bool) and `s._deferredEvents` (array).

`wireChatListeners(id)` handler becomes:
```js
const cleanupStream = window.ace.chat.onStream(id, event => {
  if (!s._isVisible) {
    s._deferredEvents.push(event)
    // Still track the bare minimum so badges/status are accurate even hidden:
    if (event.type === 'stream_event' && event.event?.type === 'content_block_delta') {
      s.currentStreamText += event.event.delta.text  // keep text buffer live
    }
    return
  }
  // ...existing event handling...
})
```

When activating (`activateSession`), after the `.active` class toggle:
```js
if (s._deferredEvents && s._deferredEvents.length) {
  const queued = s._deferredEvents
  s._deferredEvents = []
  // Don't replay each individually — just force a full settled re-parse ONCE
  // using the text buffer we kept fresh. This is the one place we do an
  // all-at-once parse; it runs at most once per pane activation, not per chunk.
  s._settledBoundary = 0
  const settledEl = s._currentAssistantEl?.querySelector('.chat-settled')
  if (settledEl) settledEl.innerHTML = ''
  scheduleRender(id)
}
s._isVisible = true
```

When deactivating: `s._isVisible = false`. Add a deactivate hook if none exists.

**Caveat — still streaming while hidden:** If a session is mid-response when you switch away, we still accumulate text (so nothing is lost), but no markdown parsing or DOM mutation happens. On return, a single catch-up parse runs. Users who park a long build and come back later pay that one-shot cost; they don't pay it continuously.

**Step 1: Capture baseline (chat-heavy harness with focus churn)**

Extend stress harness to simulate pane-switching: `runChatHeavyWithFocusChurn(6, 20, 3, switchMs=500)`. Run 60s.

**Step 2: Implement the deferral**

Edit session-manager.js per the design above. Initialize `s._isVisible = false` in `spawnSession`, flip to `true` in `activateSession`, flip to `false` on the complementary path.

**Step 3: Verify no data loss**

Manually: open 3 sessions. Start streaming in session 2. Switch to session 1, then session 3, then back to session 2. The streamed response should be complete and correctly rendered. No missing text, no duplicate text, code blocks intact.

**Step 4: Re-run harness**

```
__stress.runChatHeavyWithFocusChurn(6, 20, 3, 500)
```

Expected: hidden sessions contribute near-zero CPU. P99 frame gap drops below 50ms.

**Step 5: Commit**

```bash
git add ace-desktop/renderer/modules/session-manager.js \
        ace-desktop/scripts/stress.js \
        ace-desktop/scripts/stress-results.jsonl
git commit -m "$(cat <<'EOF'
perf(ace-desktop): defer DOM work for hidden chat panes

Hidden sessions still keep text buffers live so nothing is lost, but
markdown parsing, sanitization, and DOM mutation are deferred until the
pane is activated. One catch-up parse on activation replaces hundreds of
per-chunk parses while hidden.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

**Completion criterion:** Switching between 6 streaming sessions doesn't degrade the foreground session; no data loss.

---

## Task 3: Main-process IPC coalesce + pty backpressure

**Purpose:** At this point (post Task 1 + 2) chat-mode is bounded. But pty-heavy scenarios (builds) still emit per-chunk IPC with no backpressure — [pty-manager.js:67-71](../../src/pty-manager.js#L67-L71). Fix: coalesce multiple `shell.onData` chunks per 16ms frame into one IPC message; pause the pty when the queue exceeds a byte threshold.

**Files:**
- Modify: `ace-desktop/src/pty-manager.js` — buffer + flush-timer + `pty.pause()`/`resume()` flow control
- Modify: `ace-desktop/src/preload.js` — preserve existing `onData(id, cb)` API; unwrap batch on the way through so renderer code doesn't change
- Modify: `ace-desktop/src/chat-manager.js:173` — cap the line buffer (see Task 4)
- Fast-path: payloads under 4KB bypass the coalescer (preserves interactive echo latency — critical for human keystrokes in Claude CLI)

**Files touched summary:**
- `ace-desktop/src/pty-manager.js:42-82` (create) and `:104-144` (resume) — wrap `shell.onData` with a per-session buffer + 16ms timer
- `ace-desktop/src/preload.js:34-38` — detect batched payload shape `{batch: true, chunks: [...]}` and emit each chunk to the renderer callback; unbatched (fast-path) passes through unchanged

**Design — per-session buffer and flow control:**

Inside `create()` and `resume()`, replace the direct `shell.onData(data => send(...))` with:

```js
let buf = []
let bufBytes = 0
let timer = null
let paused = false
const FAST_PATH_BYTES = 4 * 1024         // < this → send immediately
const BACKPRESSURE_BYTES = 256 * 1024    // > this → pause pty
const FLUSH_MS = 16

const flush = () => {
  if (!buf.length) { timer = null; return }
  if (win.isDestroyed()) { buf = []; bufBytes = 0; timer = null; return }
  if (buf.length === 1) {
    win.webContents.send(`${ch.PTY_DATA}:${id}`, buf[0])
  } else {
    win.webContents.send(`${ch.PTY_DATA}:${id}`, { __batch: true, chunks: buf })
  }
  buf = []
  bufBytes = 0
  timer = null
  if (paused && bufBytes < BACKPRESSURE_BYTES / 2) {
    paused = false
    try { shell.resume() } catch {}
  }
}

shell.onData(data => {
  // Fast path — small interactive chunks (keystroke echo) bypass coalesce
  if (!timer && data.length < FAST_PATH_BYTES && buf.length === 0) {
    if (!win.isDestroyed()) {
      win.webContents.send(`${ch.PTY_DATA}:${id}`, data)
    }
    return
  }
  buf.push(data)
  bufBytes += data.length
  if (bufBytes > BACKPRESSURE_BYTES && !paused) {
    paused = true
    try { shell.pause() } catch {}
  }
  if (!timer) timer = setTimeout(flush, FLUSH_MS)
})
```

In `kill()` and `killAll()`, clear the flush timer first to prevent sends after kill.

**Preload unbatch — `ace-desktop/src/preload.js:34-38`:**

```js
onData: (id, cb) => {
  const channel = `${ch.PTY_DATA}:${id}`
  const handler = (_, payload) => {
    if (payload && payload.__batch) {
      for (const chunk of payload.chunks) cb(chunk)
    } else {
      cb(payload)
    }
  }
  ipcRenderer.on(channel, handler)
  return () => ipcRenderer.removeListener(channel, handler)
},
```

**Step 1: Baseline (pty-heavy)**

Re-run `__stress.runPtyHeavy(6)`. Record.

**Step 2: Implement pty-manager batching + pause/resume**

Edit `ace-desktop/src/pty-manager.js`. Apply the same wrapper to both `create` and `resume` — the two functions today duplicate the `onData` handler. Consider extracting a helper `attachBackpressuredOnData(shell, id, win)` to DRY.

**Step 3: Implement preload unbatch**

Edit `ace-desktop/src/preload.js:34-38` per design.

**Step 4: Manual verification**

Launch ACE Desktop. Open a terminal session. Confirm:
- Typing in Claude CLI still echoes instantly (fast path working) ✓
- Pasting a large block still works ✓
- Running a heavy command (`find / -type f` or similar) doesn't jam the renderer ✓
- Ctrl+C still interrupts correctly ✓

**Step 5: Re-run pty-heavy harness**

```
__stress.runPtyHeavy(6)
```

Expected: P95 frame gap drops substantially. No paused-pty deadlock.

**Step 6: Commit**

```bash
git add ace-desktop/src/pty-manager.js ace-desktop/src/preload.js \
        ace-desktop/scripts/stress-results.jsonl
git commit -m "$(cat <<'EOF'
perf(ace-desktop): coalesce pty IPC and enforce backpressure

Main-process pty output is now batched into 16ms windows (fast-path for
<4KB chunks preserves keystroke echo). Per-session buffer beyond 256KB
triggers node-pty pause() until drained — previously the pty could flood
the IPC queue faster than the renderer drained, jamming the main thread.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

**Completion criterion:** Pty-heavy harness passes; interactive echo still feels instant.

---

## Task 4: Cap main-process chat buffer + graceful recovery

**Purpose:** Close two cleanup gaps surfaced by the audit: (a) `chat-manager.js:173` `let buffer = ''` accumulates without bound if the CLI emits a 100MB line, and (b) we have no handler for the rare case the renderer actually dies (as distinct from a jam).

**Files:**
- Modify: `ace-desktop/src/chat-manager.js:173-186` — cap the buffer at 1MB; if exceeded with no newline, flush as an error event and reset.
- Modify: `ace-desktop/src/main.js` — add `mainWindow.webContents.on('render-process-gone', ...)` to reload the window and surface a dismissible toast.

**Step 1: Implement buffer cap in chat-manager.js**

```js
const MAX_BUF = 1 * 1024 * 1024
let buffer = ''
proc.stdout.on('data', chunk => {
  if (win.isDestroyed()) return
  buffer += chunk.toString()
  if (buffer.length > MAX_BUF) {
    // Malformed output or pathological upstream — drop buffer and warn
    if (!win.isDestroyed()) {
      win.webContents.send(`${ch.CHAT_ERROR}:${chatId}`, 
        `[ACE] chat stream buffer exceeded ${MAX_BUF} bytes; discarding partial line.`)
    }
    buffer = ''
    return
  }
  const lines = buffer.split(/\r?\n/)
  buffer = lines.pop()
  // ...rest unchanged...
})
```

**Step 2: Add render-process-gone recovery**

In `ace-desktop/src/main.js` where `mainWindow` is created:

```js
mainWindow.webContents.on('render-process-gone', (_, details) => {
  console.error('[ACE] renderer process gone:', details)
  if (details.reason !== 'clean-exit') {
    mainWindow.reload()
  }
})
```

**Step 3: Manual verification**

Can't easily simulate renderer death without a debug hook. Accept that this path is defense-in-depth; verify the change compiles and the app launches normally.

**Step 4: Commit**

```bash
git add ace-desktop/src/chat-manager.js ace-desktop/src/main.js
git commit -m "$(cat <<'EOF'
fix(ace-desktop): cap chat stream buffer, auto-recover from renderer death

Cap the NDJSON line buffer at 1MB so a malformed CLI output can't blow
main-process memory. Handle render-process-gone with an automatic reload
so the rare true crash (not a jam) doesn't leave the user on a black
screen.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

**Completion criterion:** App launches normally; buffer cap is in place.

---

## Task 5: Lift SESSION_LIMIT (gated behind harness)

**Purpose:** Today [session-manager.js:901](../../renderer/modules/session-manager.js#L901) caps `SESSION_LIMIT = 3` per pane group. With two pane groups that's 6 total. To reach 10 concurrent we lift this — but only after Tasks 1–4 prove the renderer can handle it.

**Files:**
- Modify: `ace-desktop/renderer/modules/session-manager.js:901` — raise to 5 per pane group (10 total across two groups)
- Modify: `ace-desktop/renderer/modules/agent-manager.js` if it has its own limit (verify)

**Step 1: Pre-flight**

Before editing the constant, run the harness with 10 sessions (manual spawn via `__stress.runChatHeavy(10, 20, 5)`). It currently won't spawn 10 because of SESSION_LIMIT — bypass in the harness with a direct call. Confirm frame-time is acceptable. If not, STOP — return to earlier tasks.

**Step 2: Edit**

```js
const SESSION_LIMIT = 5  // was 3; two pane groups → 10 total
```

**Step 3: Verify**

Manually open 5 tabs in one pane group. Confirm UI stays responsive, tabs render, no overflow errors. Open 5 more in the second pane group.

**Step 4: Commit**

```bash
git add ace-desktop/renderer/modules/session-manager.js
git commit -m "$(cat <<'EOF'
feat(ace-desktop): raise per-pane session limit from 3 to 5

With the chat-render, hidden-pane, and pty-backpressure fixes in place,
stress harness shows stable P95 frame time with 10 concurrent sessions
across two pane groups. Lifting the cap unlocks the aspirational ceiling.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

**Completion criterion:** 10 concurrent sessions open without regression. Harness passes.

---

## Task 6: Syntax highlighter off main thread (deferred, gate on evidence)

**Purpose:** The home-rolled regex highlighter in [chat-renderer.js:44-97](../../renderer/modules/chat-renderer.js#L44-L97) runs O(n) per code block on the main thread, with no caching. After Task 1 lands, it no longer runs on every chunk — only on newly-settled code blocks. That may be enough.

**Decision gate:** After Tasks 0–5 are committed, re-run the full harness. If P95 frame gap on chat-heavy with long code-heavy responses is still > 50ms, proceed with this task. Otherwise, skip.

**If proceeding — two options:**

**Option A — Cache existing highlighter:**
Memoize `syntaxHighlight(code, lang)` by a cheap hash of `(code, lang)`. For identical code blocks re-rendered across focus changes, this hits the cache. Low risk, small change.

**Option B — Move to Web Worker:**
Spawn a dedicated worker; post code+lang messages; receive highlighted HTML. Run highlighter on worker thread. Replaces DOM content when worker returns. More work, bigger win for very long code blocks.

Start with A. Only do B if A is insufficient.

**Files (Option A):**
- Modify: `ace-desktop/renderer/modules/chat-renderer.js:44-97` — wrap `syntaxHighlight` with an LRU cache keyed on `lang + '|' + code`

**Step 1: Re-measure after Task 5**

```
__stress.runChatHeavy(10, 20, 5)  # with long code blocks in fixture
```

If max frame gap < 50ms, skip this task entirely. Commit `stress-results.jsonl` with the "after-task5" label as the shipped baseline.

**Step 2 (if needed): Implement cache**

```js
const _hlCache = new Map()
const _hlCacheMax = 200
function _hlCacheGet(key) { const v = _hlCache.get(key); if (v) { _hlCache.delete(key); _hlCache.set(key, v) } return v }
function _hlCacheSet(key, value) {
  if (_hlCache.size >= _hlCacheMax) _hlCache.delete(_hlCache.keys().next().value)
  _hlCache.set(key, value)
}

export function syntaxHighlight(code, lang) {
  const key = (lang || '') + '|' + code
  const cached = _hlCacheGet(key)
  if (cached) return cached
  // ...existing body...
  _hlCacheSet(key, result)
  return result
}
```

**Step 3: Re-run harness, verify improvement**

**Step 4: Commit**

```bash
git add ace-desktop/renderer/modules/chat-renderer.js ace-desktop/scripts/stress-results.jsonl
git commit -m "$(cat <<'EOF'
perf(ace-desktop): LRU-cache syntax highlighter results

Re-rendering the same code block across focus switches and streaming
re-flows no longer re-runs the regex scan. 200-entry cache, millisecond
hit cost. Measured [N]% frame-time improvement on chat-heavy harness
with code-heavy responses.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

**Completion criterion:** Only ship if measured improvement justifies. Otherwise skip.

---

## Task 7: Message-list virtualization (deferred, evidence-gated)

**Purpose:** The audit showed no virtualization — every message in the DOM forever ([session-manager.js:488-492](../../renderer/modules/session-manager.js#L488-L492)). For *streaming* jams this is not the bottleneck (Task 1 handles that). For *long-history* sessions (1M tokens after Claude CLI resume prints history), scrolling can feel heavy.

**Decision gate:** Only do this task if, after Tasks 0–6, scrolling a 1M-token resumed chat feels janky (subjective test + harness measurement of scroll frame time). Otherwise skip indefinitely.

**Files (if proceeding):**
- Modify: `ace-desktop/renderer/modules/session-manager.js` — wrap `.chat-messages` rendering in a windowed list using IntersectionObserver, keeping only ±N messages around viewport in the DOM
- Add: `ace-desktop/renderer/modules/chat-virtualizer.js` — small hand-rolled virtualizer (avoid adding a library for 1 use site)

This is a meaningful refactor. Plan a separate design doc before implementing. Not in scope for this plan unless evidence demands.

---

## Task 8: Memory hygiene (housekeeping)

**Purpose:** Audit flagged a cleanup drift — `_wordTimer` keeps updating every 2.5s for hidden sessions ([session-manager.js:117-128](../../renderer/modules/session-manager.js#L117-L128)), and `ResizeObserver` iterates all sessions on every resize. Match the agent-manager pattern.

**Files:**
- Modify: `ace-desktop/renderer/modules/session-manager.js` — gate `_wordTimer` on `s._isVisible` (already added in Task 2); skip resize fit on hidden panes

**Step 1: Gate word timer on visibility**

In the `setInterval` callback inside `scheduleStreamingWords` (around line 117), early-return if `!s._isVisible`.

**Step 2: Gate resize fit**

In the `ResizeObserver` callback (around line 1301), iterate only sessions where `s._isVisible`.

**Step 3: Commit**

```bash
git add ace-desktop/renderer/modules/session-manager.js
git commit -m "$(cat <<'EOF'
perf(ace-desktop): skip word-timer ticks and resize-fit for hidden panes

Matches the agent-manager pattern of pausing per-pane work on
visibilitychange. Cuts background CPU on unfocused streaming sessions
to near-zero.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

**Completion criterion:** No visible regressions; harness numbers unchanged or improved.

---

## Acceptance criteria for the whole plan

After Tasks 0–5 (Tasks 6–8 are evidence-gated):

1. Stress harness chat-heavy (6 sessions, 3 streaming) P99 frame gap < 50ms, zero frames > 100ms over 60s.
2. Stress harness pty-heavy (6 sessions streaming high-rate output) P99 frame gap < 50ms.
3. Combined harness (both scenarios at once) P99 < 75ms, zero frames > 150ms.
4. Manual: 10 concurrent chat sessions spawned, each with a resumed 100K-token context, 5 streaming simultaneously — app remains interactive (click responsiveness < 100ms).
5. Manual: interactive keystroke echo in terminal mode still feels instant (no perceptible lag from coalescing).
6. No data loss on pane switches mid-stream.
7. No regressions in existing flows (chat send, attachment render, terminal mode toggle, session close, resume).

---

## What this plan deliberately doesn't do

- **No DOM unmount of hidden panes.** Audit showed ~120 DOM nodes per session — not the bottleneck. Deferring work (Task 2) is enough.
- **No heartbeat watchdog.** Prevention (Tasks 1–4) should remove the jam class. `render-process-gone` handler (Task 4) covers the rare actual crash.
- **No Shiki / highlight.js swap.** Bigger dependency, bigger bundle. Cache the existing regex highlighter first (Task 6A) before considering.
- **No persistence of in-memory chat history to disk.** Claude CLI's own session storage handles resume. Audit flagged that closing a session loses in-memory history — that's a separate product question, not a scalability fix.

---

## Risks and open questions

1. **Incremental parse block-boundary edge case (Task 1).** If `findSettledBoundary` advances past an unclosed code fence, `findNewBlocks` could split mid-fence. Mitigation: trust `findSettledBoundary`'s existing guarantees; verify during Step 4 manual test with a long code block; fall back to whole-range parse if split produces empty blocks.
2. **Tail rendering of partial code fences.** `renderTail` may still need work if the incremental approach reveals edge cases. Defer to observation during Task 1 testing.
3. **Stream-event fixture capture.** The harness needs a real stream-event dump. Capture once from a running Claude CLI session and check it in. If the format changes across Claude CLI versions, the fixture will need a refresh.
4. **Node-pty `pause()` semantics on macOS vs. Linux vs. Windows.** Task 3 uses `pty.pause()` — verify behavior is uniform. If platform-divergent, fall back to `resume` after a fixed timeout to avoid deadlock. (Windows client is a client shipping target.)

---

## Sequencing note

**Ship Task 0 alone first.** Get baseline numbers. Then Tasks 1–5 in order, one commit each, re-measuring with the harness between each. Pause after Task 5 to decide on Tasks 6–8 based on evidence. Total estimated commits: 5–8. Total estimated sessions: 2–3 focused build blocks.
