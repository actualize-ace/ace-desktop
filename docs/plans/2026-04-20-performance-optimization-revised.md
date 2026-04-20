# ACE Desktop Performance Optimization — Revised Plan

> **Supersedes** `2026-04-20-performance-optimization.md` (v1). That draft was pressure-tested against the existing stress harness; 6 tasks were dropped as evidence-free, 1 deferred, 13 survived. This is the evidence-gated version.

> **For Claude:** REQUIRED SUB-SKILL: Use `superpowers:executing-plans` to implement task-by-task.

---

## Problem Hypothesis (v1 claims, stated plainly)

The original plan claimed ACE Desktop has four classes of performance bottleneck:

1. **O(n²) streaming** — session-manager re-parses all settled text on every boundary advance; Oracle re-parses the full message on every `text_delta`.
2. **15s worst-case startup block** — `detectClaudeBinary` does three sequential `execSync` calls with 5s timeouts.
3. **Dashboard IPC storm** — cockpit load fires 13 separate IPC calls.
4. **Leaked timers, listeners, and unbounded caches** — `agentTimer`, `_wordTimer`, `_metaCache`, session listeners, and `messages[]` all grow without cleanup.

Therefore (the claim went), 20 surgical changes across 5 phases would eliminate all four classes.

## Evidence (gathered 2026-04-20)

The repo already has a stress harness (`scripts/stress.js`) with a committed baseline from 2026-04-18 main. Re-ran today against current main:

| Scenario | Metric | Apr-18 | Apr-20 | Verdict |
|---|---|---:|---:|---|
| chat-heavy | p50 | 8.3 | 8.3 | unchanged |
| chat-heavy | p95 | 9.2 | 9.1 | unchanged |
| chat-heavy | p99 | 9.4 | 16.6 | +7ms (likely display refresh delta, see note) |
| chat-heavy | max | 13949 | 83 | massively better (Apr-18 max was startup noise) |
| chat-heavy | over50 | 5 | 1 | better |
| chat-heavy | peakHeapMB | 14.5 | 12.8 | better |
| pty-heavy | p99 | 9.3 | 9.3 | unchanged |
| pty-heavy | over16 | 3 | 0 | better |

> **Display-rate caveat:** chat-heavy recorded 7096 frames/60s (~118fps) vs 3947 (~66fps) on baseline. If today's run was on a 120Hz display and baseline was 60Hz, each frame budget shrinks from 16.6ms → 8.3ms, which mechanically produces a higher p99 on the same workload. Not a code regression.

**Conclusion:** streaming hot path is green. Renderer memory is green. Pty is green.

## What the evidence rules out

The harness directly exercises claim (1) — streaming — and indirectly exercises claim (4) for renderer-side leaks (peakHeap stayed flat across a 60s stress). So:

- **Claim 1 is refuted.** Any task whose sole justification is "eliminate O(n²) streaming" has no measured problem to solve.
- **Claim 4 is partially refuted** for renderer-side heap growth under streaming load. Listener leaks during session churn and message-array growth are *not* exercised by the harness — those remain untested hypotheses.

## What the evidence doesn't cover

The harness does **not** exercise:

- **Startup time** (claim 2) — `detectClaudeBinary` only runs at app start, before `__stress` exists.
- **Dashboard IPC load** (claim 3) — harness focuses on chat/pty rendering, not cockpit initial paint.
- **Oracle panel** — separate code path from session-manager; naïve re-parse loop is unmeasured but visibly present in source.
- **Session churn** (open/close 10+ sessions rapidly) — not a scenario.
- **File-watcher storms** — not a scenario.

Tasks targeting these areas retain justification. Tasks targeting claim 1 do not.

---

## Dropped tasks (with reasoning)

| # | Original title | Why dropped |
|---|---|---|
| 2 | Incremental markdown rendering in session-manager | p99 at 9.4ms on 60Hz baseline is well inside target. Incremental parse also carries correctness risk (markdown is stateful across `\n\n` boundaries). Evidence says no. |
| 3 | Track processed code blocks via data attribute | Same hot path as Task 2. Already fast enough; `.closest('.code-block-wrapper')` short-circuit is O(1) per node. Marginal win, no measured need. |
| 9 | RAF-batch `scrollChatToBottom` | Scroll is part of the same green hot path. If Tasks 1–3 are unnecessary, this is too. |
| 10 | Use CSS var in sidebar resize | **Factually wrong.** Current `theme.js:105–130` already calls `getBoundingClientRect()` only on `mousedown`/`mouseup`, not per mousemove. No reflow loop exists. |
| 15 | AbortController for session listeners | Listener-leak claim unproven. Session-scoped elements are removed from DOM on `closeSession`, which triggers GC of attached listeners. Need a heap-snapshot diff across N open/close cycles before implementing. |
| 17 | Prune `messages[]` during soft GC | Peak heap stayed at 12.8MB across a 60s stress — no memory pressure. Also risks breaking scrollback resume. |

## Deferred (profile-gated)

| # | Title | Gate |
|---|---|---|
| 11 | `will-change` hints | Over-applied `will-change` permanently promotes layers and *hurts* perf. Add only after DevTools Layers panel shows specific elements repainting unnecessarily. |

---

## Revised scope — 13 tasks

Task numbers preserved from v1 for traceability. Phase labels restructured around *what's being improved* rather than original ordering.

### Phase A — Oracle streaming (separate from session-manager, unmeasured but visibly naïve)

**Task 1: RAF-debounce Oracle streaming renders**
- Modify: [renderer/views/oracle.js:60-106](ace-desktop/renderer/views/oracle.js#L60-L106)
- Port the RAF + settled/tail pattern from session-manager.
- Keep the `result` and `exit` handlers doing full renders (they need `postProcessCodeBlocks`).
- On cleanup, cancel any pending RAF (`_oraclePendingRAF`) in both `result` and `exit` handlers.
- **Verify:** DevTools → Performance → Record during a long Oracle query. `marked.parse` should fire at ~16ms intervals, not per delta.
- **Commit:** `perf(oracle): RAF-debounce streaming renders`
- *Implementation detail: see v1 plan Task 1 for exact code.*

### Phase B — Startup & IPC (not covered by harness, high-confidence wins)

**Task 4: Extract shared PATH augmentation module**
- Create: `ace-desktop/src/get-augmented-env.js`
- Modify: `main.js`, `pty-manager.js`, `chat-manager.js`, `preflight.js`
- Pure refactor — no perf claim. Eliminates 4 copies of the same PATH logic.
- **Commit:** `refactor: extract shared PATH augmentation module`
- *Implementation detail: see v1 plan Task 4.*

**Task 5: Make `detectClaudeBinary` async**
- Modify: [main.js:108-189](ace-desktop/main.js#L108-L189)
- Reframe from v1: the "15s block" only fires when CLI is absent *and* all three probes time out. Common case <100ms. This is a **UX fix for misconfigured installs**, not a hot-path perf fix.
- Use `execFile` + `util.promisify` with 3s timeouts (tighter than v1's 5s).
- **Commit:** `perf(startup): async binary detection — better UX on misconfigured installs`
- *Implementation detail: see v1 plan Task 5.*

**Task 6: Cache `loadConfig` with fs.watch invalidation**
- Modify: [main.js:64-70](ace-desktop/main.js#L64-L70)
- Add `_configCache`, invalidate on `saveConfig`/`PATCH_CONFIG` and on `fs.watch` fire.
- Windows caveat: `fs.watch` is unreliable when editors save-and-rename. Acceptable because internal writes invalidate explicitly.
- **Commit:** `perf: cache loadConfig with fs.watch invalidation`
- *Implementation detail: see v1 plan Task 6.*

**Task 7: Batch dashboard IPC into single handler**
- Add channel `GET_DASHBOARD_BATCH` in [src/ipc-channels.js](ace-desktop/src/ipc-channels.js)
- Modify: `main.js`, `preload.js`, `renderer/dashboard.js`
- **Framing correction from v1:** the `Promise.all(Promise.resolve().then(syncFn))` pattern does *not* parallelize — Node is single-threaded and these reads are sync internally. The real win is **one IPC round-trip instead of 13**, which reduces renderer→main serialization overhead and simplifies the callsite. No concurrency claim.
- **Commit:** `perf(dashboard): batch 13 IPC calls into single handler — one round-trip instead of thirteen`
- *Implementation detail: see v1 plan Task 7, but delete all language about parallelization.*

**Task 8: Cache resolved vault root**
- Modify: [main.js:758-763](ace-desktop/main.js#L758-L763)
- Cache `fs.realpathSync(global.VAULT_PATH)` in `_realVaultRoot`, invalidate in `SAVE_CONFIG`/`PATCH_CONFIG`.
- **Commit:** `perf: cache resolved vault root`
- *Implementation detail: see v1 plan Task 8.*

### Phase C — File watcher (not covered by harness, cheap win)

**Task 12: Debounce file watcher state parses at 200ms**
- Modify: [src/file-watcher.js:43-64](ace-desktop/src/file-watcher.js#L43-L64)
- Wrap `dedicatedWatcher.on('change', …)` and `sendRefresh` with a 200ms debounce.
- **Commit:** `perf(watcher): debounce file change handlers at 200ms`
- *Implementation detail: see v1 plan Task 12.*

### Phase D — Resource cleanup (small, correct fixes)

**Task 13: Clear `agentTimer` on `beforeunload`**
- Modify: [renderer/modules/agent-manager.js:338-347](ace-desktop/renderer/modules/agent-manager.js#L338-L347)
- Add `window.addEventListener('beforeunload', …)` after the existing `visibilitychange` handler.
- **Commit:** `fix(agents): clear agentTimer on window close`

**Task 14: Clear `_wordTimer` and `_pendingRAF` in `closeSession`**
- Modify: [renderer/modules/session-manager.js:867-872](ace-desktop/renderer/modules/session-manager.js#L867-L872)
- After `clearTimer(id)`, also `clearInterval(s._wordTimer)` and `cancelAnimationFrame(s._pendingRAF)`.
- **Interaction with Task 1:** Task 1's `_oraclePendingRAF` is module-scoped (not session-scoped), so it's handled in Oracle's own `result`/`exit` cleanup, not here. Verify those cleanup paths fire even when the stream is aborted mid-flight.
- **Commit:** `fix(sessions): clear wordTimer and pendingRAF on force-close`

**Task 16: LRU cap on `session-reader._metaCache` at 200 entries**
- Modify: [src/session-reader.js:7-8](ace-desktop/src/session-reader.js#L7-L8)
- Wrap `_metaCache.set` with a `cacheSet` that evicts the oldest key when size >= 200.
- **Commit:** `fix(history): LRU cap on session metadata cache at 200 entries`

### Phase E — Deferred loading (first-paint UX, not covered by harness)

**Task 18: Add `defer` to d3/chart.js/xterm script tags**
- Modify: [renderer/index.html](ace-desktop/renderer/index.html)
- **Commit:** `perf(startup): defer d3/chart.js/xterm loading — unblocks first paint`

**Task 19: Defer file-watcher + db-reader by 500ms**
- Modify: [main.js:292-296](ace-desktop/main.js#L292-L296)
- Wrap the `did-finish-load` handler's watcher/db init in `setTimeout(…, 500)`.
- **Commit:** `perf(startup): defer file-watcher + db-reader by 500ms`

**Task 20: Invalidate vault-scanner cache on file add/change/unlink**
- Modify: [src/file-watcher.js](ace-desktop/src/file-watcher.js)
- **Expansion from v1:** hook all three — `add`, `change`, `unlink` — not just `add`. Deleted files otherwise persist in the graph.
- **Commit:** `fix(graph): invalidate vault-scanner cache on file mutations`

---

## Regression gate

After **Phase A** completes, and again after **Phase D** completes, re-run the stress harness and diff against the Apr-20 baseline:

```bash
STRESS=1 npm start
# In DevTools:
await __stress.runChatHeavy(6, 20, 3)
await __stress.runPtyHeavy(6)
```

Targets (relative to Apr-20 baseline lines in `scripts/stress-results.jsonl`):
- chat-heavy p99 ≤ 20ms
- chat-heavy over50 ≤ 3
- peakHeapMB ≤ 15
- pty-heavy p99 ≤ 15ms

If any phase breaches these, **revert the last commit** and investigate before proceeding.

## Execution order

A → B → C → D → E. Phases A + D are gated by the stress harness; phases B, C, E are evaluated visually (`env -u ELECTRON_RUN_AS_NODE npm start`) and via DevTools Console.

## Summary

| Phase | Tasks | Covered by harness? | Justification |
|---|---|---|---|
| A: Oracle | 1 | No — separate code path | Visibly naïve re-parse loop |
| B: Startup/IPC | 4, 5, 6, 7, 8 | No | Not exercised; refactor + UX wins |
| C: Watcher | 12 | No | Cheap, low risk |
| D: Cleanup | 13, 14, 16 | Partial | Specific leaks the harness doesn't trigger |
| E: Deferred | 18, 19, 20 | No | First-paint + graph correctness |

**13 tasks. One commit each. Two regression gates.**
