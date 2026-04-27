# ACE Desktop Renderer Leak Fixes Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Close the three known renderer-side resource leaks that cause ACE Desktop to accumulate CPU load over a session (peaking near 100% after ~6 hours of use) and fix the longtask observer's false-positive reports so the log becomes trustworthy.

**Architecture:** Four surgical changes to existing modules — no new abstractions. (1) `closeSession` / `closeAgentPane` dispose the xterm instance, detach the per-session PTY IPC listener, cancel pending rAF handles, and clear the status-word interval. (2) Terminal `onBufferChange` handlers in both session-manager and agent-manager coalesce rAF scheduling so a data flood can't queue thousands of rAFs behind each other. (3) The longtask observer suppresses heartbeat reports when the window is not focused/visible, which is when Chromium's intensive wake-up throttling clamps `setTimeout` to 1000ms and produces the ~900ms "phantom freeze" pattern. (4) A smoke verification at the end confirms CPU drops to baseline after two parallel sessions are opened, used, and closed.

**Tech Stack:** Existing — Electron + Chromium, xterm.js (already imported), preload `contextBridge` pattern, the renderer's `state.sessions` / `state.agentSessions` stores. No new dependencies.

**Context (why now):**
- 2026-04-24 freeze — user opened two parallel chat sessions, renderer climbed to 104% CPU, stayed pegged 6+ hours after sessions closed. Live `sample` of the renderer PID showed the main thread 62% idle in `mach_msg2_trap`, which means the CPU burn was in compositor + leaked timers + background rAF loops, not a hot JS loop — classic leak signature.
- Pressure-test on 2026-04-24 confirmed three concrete leaks in code: `term.dispose()` is never called anywhere in the renderer; the disposer returned by `window.ace.pty.onData()` at [session-manager.js:856](../../renderer/modules/session-manager.js#L856) is discarded; `_pendingRAF` + `_wordTimer` are not cleared in `closeSession`.
- Longtask observer issue: same pressure-test showed consistent ~900ms overruns at exactly 1Hz while `visibleView: "view-terminal"` and `activeChatCount: 0` — the fingerprint of Chromium's `setTimeout` clamping in unfocused windows. The observer is currently logging these as real freezes, making the log untrustworthy.
- The April 20 revised perf plan had a Task 14 for "Clear `_wordTimer` and `_pendingRAF` in `closeSession`" — it was scoped correctly but never shipped. This plan completes it and extends it to cover the two larger leaks that plan missed.

**Constraints from memory:**
- `feedback_incremental_edits_only.md` — one change at a time in `ace-desktop/`; never batch; manually smoke-test via `npm start` between commits.
- `reference_ace_desktop_no_tests.md` — no test framework; verification is manual via DevTools + Activity Monitor observation.
- `feedback_branch_check_before_ace_desktop_edits.md` — confirm `git branch --show-current` shows `main` before the first edit; work on a feature branch cut off `main`.
- `feedback_multi_app_git_scoping.md` — never `git add -A`; always stage specific ace-desktop paths.
- `feedback_landing_never_on_main.md` — root-level landing-page files must not appear in any commit on this branch.

---

## Preflight: Branch check

**Step 1: Confirm clean starting point on main**

Run from vault root:

```bash
cd /Users/nikhilkale/Documents/Actualize
git branch --show-current
```

Expected: `main`. If anything else, stop. Do not proceed until on `main` with a clean tree.

**Step 2: Pull latest**

```bash
git pull --ff-only origin main
```

**Step 3: Create the feature branch**

```bash
git checkout -b ace-desktop-renderer-leak-fixes
```

**Step 4: Verify no root-level landing files are being tracked**

```bash
git ls-files | grep -E '^(ace-landing-v[0-9]+|thank-you)\.(html|css|js)$'
```

Expected: empty output. Those files live on `landing-v10` only (`feedback_landing_never_on_main.md`). If anything matches, stop — something went wrong.

---

## Task 1: Longtask observer — suppress false positives when window is unfocused or hidden

**Files:**
- Modify: `ace-desktop/renderer/lib/longtask-observer.js`

**Why first:** all downstream verification relies on reading `longtask.log` to confirm leaks are closed. Until the observer stops crying wolf when the ACE window is backgrounded, any log tail produces noise that drowns out real signal.

**Background (from the 2026-04-24 pressure test):**
Chromium clamps `setTimeout` to ~1000ms minimum in unfocused/hidden windows (Intensive Wake-Up Throttling triggers after ~5 min defocused, aggressive clamping when `document.hidden`). Our heartbeat reschedules with `setTimeout(…, 100)` so when the window is defocused the heartbeat fires at T+1000ms and reports a 900ms "overrun" — purely artificial. The fix: don't report overruns while the window can't be interacted with, and reset the heartbeat anchor when the window regains focus so the returning heartbeat doesn't report a multi-second phantom block.

**Step 1: Read the current observer**

Run: `sed -n '45,70p' ace-desktop/renderer/lib/longtask-observer.js`

Confirm the heartbeat section exists as described in this plan — specifically that `channel.port1.onmessage` is defined and ends by calling `setTimeout(() => channel.port2.postMessage(null), HEARTBEAT_INTERVAL_MS)`.

**Step 2: Modify the heartbeat section**

Replace the `let lastScheduledAt = …` block (starting at line 49) through the closing `setTimeout(...)` (line 68) with:

```js
  // --- Detector 2: MessageChannel heartbeat ---------------------------------
  // Schedule a heartbeat every HEARTBEAT_INTERVAL_MS. When it fires late by
  // ≥THRESHOLD_MS, capture stack. Suppress reports when the window is
  // unfocused or hidden — Chromium clamps setTimeout to ~1000ms in those
  // states, producing phantom ~900ms "overruns" that are not real freezes.
  let lastScheduledAt = performance.now()
  const windowInteractive = () =>
    document.visibilityState === 'visible' && document.hasFocus()

  const resetAnchor = () => { lastScheduledAt = performance.now() }
  document.addEventListener('visibilitychange', resetAnchor)
  window.addEventListener('focus', resetAnchor)

  const channel = new MessageChannel()
  channel.port1.onmessage = () => {
    const now = performance.now()
    const overrun = now - lastScheduledAt - HEARTBEAT_INTERVAL_MS
    if (overrun >= THRESHOLD_MS && windowInteractive()) {
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
```

**Step 3: Syntax check**

```bash
node -c ace-desktop/renderer/lib/longtask-observer.js
```

Expected: no output (success).

**Step 4: Smoke test**

```bash
cd ace-desktop
env -u ELECTRON_RUN_AS_NODE npm start
```

- Wait for ACE to boot.
- Open DevTools (Cmd+Opt+I) — confirm console shows `[longtask] observer active — threshold 200 ms`. No errors.
- With ACE focused, in DevTools console paste:
  ```js
  (() => { const t = Date.now(); while (Date.now() - t < 500) {} })()
  ```
  Expected: a heartbeat or performance-observer entry appears in `~/Library/Logs/ACE/longtask.log` within ~1s.
- Verify: `tail -3 ~/Library/Logs/ACE/longtask.log` shows a real 500ms overrun with `visibleView` set.
- Click away from ACE to another app (e.g., click on VS Code). Leave it unfocused for 30 seconds.
- Run: `tail -30 ~/Library/Logs/ACE/longtask.log | grep -c heartbeat` — note the count. Wait 30 more seconds. Run again. Expected: count has **not grown** (or grown by ≤1 from the `performance-observer` source, not from heartbeat).
- Click back on ACE — no flood of phantom overruns should appear.

**If step 4 shows phantom overruns continuing:** stop, re-check the `windowInteractive()` gate and `focus`/`visibilitychange` anchors. Do not proceed to Task 2 until the observer is trustworthy.

**Step 5: Commit**

```bash
cd /Users/nikhilkale/Documents/Actualize
git add ace-desktop/renderer/lib/longtask-observer.js
git commit -m "fix(ace-desktop): suppress longtask phantom overruns when window unfocused/hidden"
```

---

## Task 2: session-manager — coalesce onBufferChange rAF scheduling

**Files:**
- Modify: `ace-desktop/renderer/modules/session-manager.js` (lines 849–851)

**Why:** under PTY data flood (hung/spinning CLI child), `term.buffer.onBufferChange` can fire thousands of times per second. Each fire schedules a fresh `requestAnimationFrame`. The rAF queue grows faster than it drains, and the renderer falls progressively further behind. A single-flag guard collapses all queued buffer changes into one rAF per frame — correct behavior, no visual difference, bounded work.

**Step 1: Read current code**

Run: `sed -n '847,862p' ace-desktop/renderer/modules/session-manager.js`

Confirm it matches this:
```js
term.buffer.onBufferChange(() => {
  requestAnimationFrame(() => { term.scrollToBottom(); userScrolledUp = false; scrollBtn?.classList.toggle('visible', false) })
})
```

**Step 2: Replace with coalesced version**

Replace those three lines with:

```js
let _bufChangeRafPending = false
term.buffer.onBufferChange(() => {
  if (_bufChangeRafPending) return
  _bufChangeRafPending = true
  requestAnimationFrame(() => {
    _bufChangeRafPending = false
    term.scrollToBottom(); userScrolledUp = false; scrollBtn?.classList.toggle('visible', false)
  })
})
```

**Step 3: Syntax check**

```bash
node -c ace-desktop/renderer/modules/session-manager.js
```

Expected: no output.

**Step 4: Smoke test**

```bash
cd ace-desktop && env -u ELECTRON_RUN_AS_NODE npm start
```

- Open a chat session.
- Flip the session to terminal mode (header toggle).
- Run a command that produces fast output: `for i in $(seq 1 2000); do echo "line $i"; done`
- Confirm: output scrolls smoothly, the window stays interactive, the bottom remains anchored unless you've scrolled up.
- Take a DevTools Performance recording over ~5 seconds of the output storm — confirm: FPS stays ≥30, rAF entries show as single batches not as backlogs.
- Scroll up mid-stream — the scroll-bottom button should appear. Scroll back to bottom — button hides. Verify this after coalescing.

**Step 5: Commit**

```bash
git add ace-desktop/renderer/modules/session-manager.js
git commit -m "perf(ace-desktop): coalesce session onBufferChange rAF — one render per frame"
```

---

## Task 3: session-manager — closeSession full cleanup (term.dispose + PTY disposer + timer clears)

**Files:**
- Modify: `ace-desktop/renderer/modules/session-manager.js` (lines 849–862 for capture, 942–966 for cleanup)

**Why:** three leaks close in one commit because they are all per-session lifetime bugs in the same file. (1) `window.ace.pty.onData(id, cb)` returns a disposer that the current code discards — the IPC listener on `PTY_DATA:${id}` never detaches. (2) `term.dispose()` is never called anywhere — every xterm instance created stays in memory with internal render timers and selection observers. (3) Task 14 from the 2026-04-20 perf plan (cancel `_pendingRAF`, clear `_wordTimer`) was dropped as "unmeasured" but is cheap and correct.

**Step 1: Capture the PTY onData disposer at the registration site**

Locate around line 856 — the block that starts with `window.ace.pty.onData(id, data => {`.

Change the leading line from:
```js
  window.ace.pty.onData(id, data => {
```
to:
```js
  s._ptyDataDispose = window.ace.pty.onData(id, data => {
```

Do not change the body of the callback. Only the assignment to `s._ptyDataDispose`.

**Step 2: Extend `closeSession` with the four new cleanups**

Locate `export function closeSession(id)` at line 942. Between the existing line `if (s._cleanupListeners) s._cleanupListeners()` and the line `const group = s.pane.parentElement`, insert:

```js
  if (s._ptyDataDispose) { try { s._ptyDataDispose() } catch (_) { /* ignored */ } s._ptyDataDispose = null }
  if (s._wordTimer)      { clearInterval(s._wordTimer); s._wordTimer = null }
  if (s._pendingRAF)     { cancelAnimationFrame(s._pendingRAF); s._pendingRAF = null }
  if (s.term)            { try { s.term.dispose() } catch (_) { /* ignored */ } s.term = null }
```

Ordering rationale: PTY disposer first (stops inbound data); timers next (stops outbound DOM churn); xterm dispose last before DOM removal (xterm's internal cleanup expects its DOM parent to still exist).

**Step 3: Syntax check**

```bash
node -c ace-desktop/renderer/modules/session-manager.js
```

Expected: no output.

**Step 4: Smoke test — CPU returns to baseline after session close**

```bash
cd ace-desktop && env -u ELECTRON_RUN_AS_NODE npm start
```

- Open DevTools Memory tab. Take a heap snapshot, label "before".
- Open a new chat session. Send a prompt so xterm receives data. Close the session (the tab X).
- Take a second heap snapshot, label "after-1".
- Repeat: open session, use it, close it — 5 times total.
- Take a third heap snapshot, label "after-5".
- In each snapshot, filter the "Class filter" for `Terminal` (xterm.js constructor). Expected: `after-5` shows **at most 1 retained Terminal** (the currently active or most recently GC-delayed). Before this fix, it would show 6.
- Activity Monitor → ACE Helper (Renderer) should drop to <5% CPU within ~10 seconds after closing all sessions.
- `tail -50 ~/Library/Logs/ACE/longtask.log` — no new heartbeat overruns should appear while the app is focused and idle post-close.

**If step 4 shows retained Terminals still climbing:** the dispose call may be silently throwing. Open DevTools Console and check for errors around `term.dispose()`. Common cause: xterm needs the DOM element still attached when `dispose()` runs — if so, move the `term.dispose()` line to run **before** `pane.remove()` (i.e., between the new block and the existing `const group = s.pane.parentElement`).

**Step 5: Commit**

```bash
git add ace-desktop/renderer/modules/session-manager.js
git commit -m "fix(ace-desktop): closeSession full cleanup — term.dispose + PTY listener + timers"
```

---

## Task 4: agent-manager — coalesce onBufferChange rAF scheduling

**Files:**
- Modify: `ace-desktop/renderer/modules/agent-manager.js` (lines 179–181)

**Why:** identical bug and identical fix to Task 2, in the parallel agent-sessions code path. Separate commit because it's a separate file and commits are reviewable units.

**Step 1: Read current code**

```bash
sed -n '177,183p' ace-desktop/renderer/modules/agent-manager.js
```

Confirm it matches:
```js
term.buffer.onBufferChange(() => {
  requestAnimationFrame(() => { term.scrollToBottom(); agentUserScrolledUp = false; scrollBtn?.classList.toggle('visible', false) })
})
```

**Step 2: Replace with coalesced version**

```js
let _agentBufChangeRafPending = false
term.buffer.onBufferChange(() => {
  if (_agentBufChangeRafPending) return
  _agentBufChangeRafPending = true
  requestAnimationFrame(() => {
    _agentBufChangeRafPending = false
    term.scrollToBottom(); agentUserScrolledUp = false; scrollBtn?.classList.toggle('visible', false)
  })
})
```

**Step 3: Syntax check**

```bash
node -c ace-desktop/renderer/modules/agent-manager.js
```

Expected: no output.

**Step 4: Smoke test**

```bash
cd ace-desktop && env -u ELECTRON_RUN_AS_NODE npm start
```

- Navigate to view-agents.
- Spawn an agent. Send a task that produces rapid output.
- Confirm: scrolling is smooth, button appears/hides correctly, no console errors, no renderer freeze.

**Step 5: Commit**

```bash
git add ace-desktop/renderer/modules/agent-manager.js
git commit -m "perf(ace-desktop): coalesce agent onBufferChange rAF — parity with session fix"
```

---

## Task 5: agent-manager — closeAgentPane full cleanup

**Files:**
- Modify: `ace-desktop/renderer/modules/agent-manager.js` (lines 186 for capture, 240–260 for cleanup)

**Why:** `closeAgentPane` has the same three leaks as `closeSession` — PTY `onData` disposer discarded, no `term.dispose()`, no rAF/timer cleanup. Parallel fix in the agent-sessions code path.

**Step 1: Capture the PTY onData disposer**

Locate around line 186 — the block that starts `window.ace.pty.onData(id, data => {`.

Change the leading line from:
```js
  window.ace.pty.onData(id, data => {
```
to:
```js
  s._ptyDataDispose = window.ace.pty.onData(id, data => {
```

**Step 2: Extend `closeAgentPane` with the cleanups**

Locate `export function closeAgentPane(id)` at line 240. Between `if (s._cleanupListeners) s._cleanupListeners()` and `const topEl  = document.getElementById('panes-top')`, insert:

```js
  if (s._ptyDataDispose) { try { s._ptyDataDispose() } catch (_) { /* ignored */ } s._ptyDataDispose = null }
  if (s._wordTimer)      { clearInterval(s._wordTimer); s._wordTimer = null }
  if (s._pendingRAF)     { cancelAnimationFrame(s._pendingRAF); s._pendingRAF = null }
  if (s.term)            { try { s.term.dispose() } catch (_) { /* ignored */ } s.term = null }
```

(Same block as Task 3 — agent sessions use the same `s._wordTimer` / `s._pendingRAF` naming convention.)

**Step 3: Syntax check**

```bash
node -c ace-desktop/renderer/modules/agent-manager.js
```

**Step 4: Smoke test — parallel to Task 3**

Same procedure as Task 3 Step 4 but using agent panes instead of chat sessions. Expected: `Terminal` instance count in heap snapshots stays bounded after repeated open/close, CPU returns to idle.

**Step 5: Commit**

```bash
git add ace-desktop/renderer/modules/agent-manager.js
git commit -m "fix(ace-desktop): closeAgentPane full cleanup — parity with closeSession fix"
```

---

## Task 6: End-to-end smoke — two parallel sessions, verify no residual CPU

**Why:** the actual user scenario that triggered the 2026-04-24 freeze was two parallel sessions running, then closed. This task is the reproduction of that scenario with all fixes in place. If this passes, the plan has delivered.

**No code changes. Verification only.**

**Step 1: Fresh launch**

```bash
cd /Users/nikhilkale/Documents/Actualize/ace-desktop
env -u ELECTRON_RUN_AS_NODE npm start
```

Open Activity Monitor → find `ACE Helper (Renderer)`. Note idle CPU — should be <5%.

**Step 2: Open two chat sessions in parallel**

- Open chat session A, send a prompt that produces ~30s of streaming output.
- Without waiting for A to finish, open chat session B, send a similar prompt.
- Let both streams complete naturally.
- During streaming, watch Activity Monitor — CPU should spike (expected) but recover between messages.

**Step 3: Close both sessions**

- Close session A (tab X).
- Close session B.
- Wait 15 seconds.

**Step 4: Confirm CPU returns to baseline**

- Activity Monitor: `ACE Helper (Renderer)` should be <5% CPU.
- `tail -30 ~/Library/Logs/ACE/longtask.log` — no heartbeat overruns in the last 15 seconds.
- DevTools Memory tab → take heap snapshot → filter class `Terminal` → should show 0 retained xterm instances.

**Step 5: Confirm background state stays clean**

- Click away from ACE (focus another app).
- Wait 60 seconds.
- `tail -20 ~/Library/Logs/ACE/longtask.log` — should NOT show any new heartbeat entries with ~900ms overruns. (This was the phantom-freeze symptom pre-fix.)

**If any step fails:**
- CPU stuck high after close → re-run Task 3 / Task 5 verification; check for errors in DevTools console at close time.
- Phantom overruns returning → re-run Task 1 verification; confirm `windowInteractive()` gate is present in longtask-observer.js.
- Terminal instances leaked → set a breakpoint on `term.dispose()` call, confirm it's being reached.

**Step 6: Merge back**

If all verifications pass:

```bash
cd /Users/nikhilkale/Documents/Actualize
git checkout main
git merge --ff-only ace-desktop-renderer-leak-fixes
git push origin main
```

If fast-forward fails (main moved), rebase the feature branch on main first:

```bash
git checkout ace-desktop-renderer-leak-fixes
git rebase main
# resolve any conflicts, re-run Task 6 smoke
git checkout main
git merge --ff-only ace-desktop-renderer-leak-fixes
git push origin main
```

**Step 7: Delete the feature branch**

```bash
git branch -d ace-desktop-renderer-leak-fixes
```

---

## Exit criteria

- All six tasks committed individually on `ace-desktop-renderer-leak-fixes`.
- Two-parallel-sessions scenario (Task 6) completes without residual CPU burn.
- `longtask.log` stops reporting phantom ~900ms overruns while ACE is defocused.
- No new `console.error` entries at session/agent open or close in DevTools.
- Heap snapshots show `Terminal` instances bounded after repeated open/close cycles.
- Branch merged to `main` and deleted.

---

## Future Work — Level 2 (render isolation, deferred)

The leak fixes in this plan stop CPU accumulation but do not remove the structural bottleneck: all sessions, xterm instances, the atmosphere canvas, and every other renderer surface share a single V8 event loop. Two parallel sessions still compete for the same main thread — the fixes just ensure the competition resolves cleanly when sessions close. VS Code does not have this problem because each chat panel runs in a separate webview renderer process, giving each session its own event loop and heap.

**Defer Level 2 until one of these triggers fires:**
- Even with Level 1 fixes shipped, two simultaneously active sessions (both streaming) still produce >30% main-thread overrun entries in longtask.log.
- Activity Monitor shows `ACE Helper (Renderer)` sustained >60% CPU during normal (non-flood) dual-session use.
- A user reports slow typing response or animation jitter while a long stream is active in another tab.

When any of those trigger, the Level 2 scope is:

### L2-T1: xterm-addon-webgl — GPU-accelerate terminal rendering
- **Impact:** move xterm's per-cell rendering from canvas2d on the main thread to WebGL on the compositor thread. xterm.js supports this via an addon; the integration is one import + `term.loadAddon(new WebglAddon())`.
- **Expected relief:** 40–70% reduction in main-thread time during PTY streams; frees budget for markdown, scroll, and IPC handling.
- **Risk:** WebGL context loss (sleep/wake) — the addon emits a `contextLoss` event; need a re-initialization path. Also adds a required fallback to canvas2d for WebGL-unavailable environments.
- **Estimated effort:** 1 day (incl. context-loss handling + smoke).

### L2-T2: OffscreenCanvas + Worker for atmosphere `drawRhythmStrip`
- **Impact:** [atmosphere.js:861-863](../../renderer/modules/atmosphere.js#L861-L863) runs `drawRhythmStrip` (bezier path + gradient fills) at 60Hz continuously, on the main thread, regardless of which view is active. Moving to OffscreenCanvas in a Web Worker removes this from the main thread entirely.
- **Expected relief:** ~5–15% main-thread reduction during idle, more during heavy use (because the compositor is already loaded).
- **Risk:** cross-thread message overhead if frame data is large — for a small rhythm strip this is negligible. Worker needs to receive `coherenceState` updates via `postMessage` on change.
- **Estimated effort:** 0.5 day.

### L2-T3: Configure `backgroundThrottling` explicitly
- **Impact:** [main.js BrowserWindow](../../main.js) creation currently omits `webPreferences.backgroundThrottling` — so Electron uses the default (enabled). Decide: leave enabled (user saves CPU when ACE is hidden) or disable (timers stay accurate for audio/atmosphere coherence sync when unfocused). If disabled, the longtask observer gate from Task 1 is still useful but no longer load-bearing.
- **Decision criterion:** if atmosphere audio drifts or coherence updates feel stale on refocus after extended unfocus, disable throttling. Otherwise leave it.
- **Estimated effort:** 15 minutes + 1 hour of observed dogfooding.

### L2-T4: Audit and dispose all rAF self-scheduling loops on view-change
- **Impact:** views like breath (`views/breath.js:143`, `:155`, `:291`), insight (`views/insight.js:839`, `:966`), and atmosphere (`coherenceAnimLoop`) each run rAF loops. Some cancel correctly on view-change; some may not. A centralized "view-scope" pattern (register rAF handle, auto-cancel on view-exit) would eliminate leaked animation loops as a class of bug.
- **Expected relief:** eliminates one category of "open a view, navigate away, animation keeps running forever" leaks.
- **Estimated effort:** 1 day.

### Level 3 — true process isolation (deep architectural, months)
Not scoped in this document. Rough shape: each chat/agent session becomes its own `BrowserView` or Electron utility process, with the renderer acting as a shell that hosts per-session views. Matches VS Code's webview-per-panel model. Triggered only if Level 2 proves insufficient for the "10 simultaneous sessions" target.

---

## Scope guardrails — do NOT do in this plan

- **Do not** introduce any new animation, scheduler, or abstraction layer. The six tasks close specific leaks; scope creep invalidates the "one change at a time" discipline (`feedback_incremental_edits_only.md`).
- **Do not** use parallel agents or batch tool calls across the ace-desktop files for these tasks — smoke test between each commit per the same memory.
- **Do not** touch any root-level `ace-landing-*.{html,css,js}` file. Those belong to `landing-v10` only (`feedback_landing_never_on_main.md`).
- **Do not** commit the feature branch with `git add -A` — stage each modified ace-desktop file explicitly (`feedback_multi_app_git_scoping.md`).
- **Do not** advance to Level 2 from this plan. Level 2 work starts a new plan with its own pressure-test and budget.
