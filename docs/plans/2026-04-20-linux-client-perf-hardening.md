# Long-Session & Cold-Start Perf Hardening — Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use `superpowers:executing-plans` to implement task-by-task. Run with Sonnet, not Opus.

> **Filename note:** file is still `2026-04-20-linux-client-perf-hardening.md` for link continuity. Rename after first phase lands.

**Goal:** Three perf fixes that help all platforms but hit hardest on Linux + weak GPU, Intel Macs under load, and Windows with AV overhead: bounded chat DOM over long sessions, platform-aware reduced-effects mode, deferred MCP spawn with idle prewarm.

**Trigger:** Alex moved from ACE Desktop back to VS Code (Linux) citing slowness. Existing perf work was tuned to macOS harness numbers; long-session memory growth, GPU-expensive CSS, and eager MCP spawn are off-harness and affect every platform.

**Why this is not "Linux-only":**
- **Phase A (virtualization)** fixes renderer RSS ballooning over a workday — hits macOS users who keep ACE open 8+ hours just as hard as Alex on Linux. Standard for chat UIs (Slack, Discord, Cursor, ChatGPT, VS Code terminal).
- **Phase B (reduced-effects)** defaults to on for Linux but also responds to OS-level `prefers-reduced-motion` / `prefers-reduced-transparency`, so macOS users with accessibility settings benefit automatically.
- **Phase C (defer spawn)** helps Windows most — AV scans every subprocess, `cmd.exe` setup is slow, Defender can add 500ms–2s per spawn. Also fixes the "open session to read history, never send, still paid the MCP boot tax" footgun on every platform.

**Relationship to prior Apr-18 rejection:**
[project_ace_desktop_ipc_backpressure](memory/project_ace_desktop_ipc_backpressure.md) rejected DOM virtualization during multi-agent IPC freeze investigation. That rejection was correct *for that problem* — IPC backpressure was the freeze cause, not DOM bloat. This plan addresses a **different failure mode**: long-session memory growth + scrollback scroll perf. Different motivation, different implementation (height-preserving placeholders, no hard cap, heavy-node release). Update the memory after ship to note the scope nuance.

**Relationship to concurrent plan:**
[2026-04-20-performance-optimization-revised.md](ace-desktop/docs/plans/2026-04-20-performance-optimization-revised.md) also touches chat-manager (Task 5: async `detectClaudeBinary`) and session-manager (Tasks 13/14: timer cleanup). **Land that plan's Phase B first** — `get-augmented-env` module extraction is a prerequisite for Phase C here's spawn contract changes, and the timer cleanup tasks reduce risk of listener leaks surviving eviction in Phase A.

**Architecture:**
- **Phase A:** viewport-windowed chat renderer. Mount messages near visible range, height-preserving placeholders elsewhere, eviction on scroll. Heavy nodes (code-block ASTs, decoded images) are *released*, not just hidden — otherwise eviction is cosmetic.
- **Phase B:** single `body.reduced-effects` class gates override stylesheet. Applied when: `platform === 'linux'` | `prefers-reduced-motion: reduce` | `prefers-reduced-transparency: reduce` | user toggle. Tri-state config (auto/on/off), not binary.
- **Phase C:** defer `claude` CLI spawn until first send; background prewarm after 5s session idle; audit read-path dependencies before deferring (history view, transcript hydration); `suppressMcp` UI toggle for emergency bypass.

**Tech Stack:** Vanilla JS renderer, Electron main process, no new deps.

---

## Gate: Alex's profile comes first

**Do not start A, B, or C until Alex has sent:**
1. A 10-second `Performance` recording from DevTools during a slow moment
2. A verbal A/B: does launching with `--disable-gpu` feel different?
3. Approximate vault file count + MCP server count
4. Distro + X11/Wayland + GPU vendor

**Profile-driven phase selection (numeric thresholds):**

| Signal from Performance recording | Threshold | Start with |
|---|---|---|
| Painting + Rasterization % of total frame time | ≥ 35% | Phase B (GPU mode) |
| Scripting % of total frame time | ≥ 50% | Phase A (virtualization) |
| Both thresholds crossed | — | A → B |
| "MCP loading…" visible > 3s on chat open | — | Phase C first |
| None of above crossed | — | Phase A first (general hygiene win) |

Three phases differ in cost by 10×. Numeric thresholds prevent re-litigating order in the moment.

---

## Phase A — Chat virtualization (all platforms, biggest daily-use win)

**Why:** Every message stays mounted in the DOM forever. After a workday, the renderer accumulates DOM nodes + syntax-highlighted code-block token trees + closure captures over message content. Memory grows monotonically until app restart. Biggest win: **RSS stops growing over a workday** on every platform — this is the real prize, not just Linux.

**Scope guardrails:**
- Only virtualize *settled* messages above the visible window. Streaming bottom message stays fully mounted always.
- Must preserve: scroll-to-bottom on new message, scrollback position on tab switch (via **index + offset-within-message**, not pixel), find-in-page within loaded window, code-block syntax highlighting on rehydrate.
- Must *release*, not just hide: code-block token trees (Prism/Shiki output), decoded image bitmaps. If heap doesn't drop, eviction is cosmetic. Gate this in A6.
- Non-goal: search across unloaded history (use history view for that).

### Task A1: Measure baseline DOM weight + heap retention

**Files:** None — measurement only.

**Step 1:** Open long session (30+ messages, mix of text + code + any embedded images). DevTools Console:
```js
document.querySelectorAll('#session-chat-list .message').length
performance.memory.usedJSHeapSize / 1024 / 1024
document.querySelectorAll('#session-chat-list *').length
document.querySelectorAll('#session-chat-list pre, #session-chat-list code').length
```

**Step 2:** Chrome DevTools → Memory tab → "Heap snapshot." Note "Retained size" for:
- `Detached HTMLDivElement` (leaked DOM refs)
- Any string retainer > 10KB (likely code-block content)

These are the A6 comparison targets. Node count dropping without heap dropping = cosmetic win only.

**Step 3:** Record all numbers as a comment on this task.

**Step 4:** No commit.

---

### Task A2: Add message-index metadata

**Files:**
- Modify: [renderer/modules/session-manager.js:96](ace-desktop/renderer/modules/session-manager.js#L96) and [:245](ace-desktop/renderer/modules/session-manager.js#L245)

**Step 1:** At both `s.messages.push(...)` sites (user + assistant), add `index: s.messages.length` before push.

**Step 2:** Manual verify: send 2 messages, confirm `session.messages.every((m, i) => m.index === i)` in console.

**Step 3:** Commit:
```bash
git add ace-desktop/renderer/modules/session-manager.js
git commit -m "chore(chat): tag messages with stable index field for virtualization"
```

---

### Task A3: Build `VirtualChatList` skeleton with release hook

**Files:**
- Create: `ace-desktop/renderer/modules/virtual-chat-list.js`

**Step 1:** Before writing, grep `ace-desktop/renderer/modules/*.js` to confirm module style (CJS vs ESM). Match existing convention.

**Step 2:** Factory exposes `mount`, `hydrate`, `evictAboveFold`, `releaseNode`, `setMessages`. Skeleton only — full implementations land in A4.

```js
// virtual-chat-list.js
// Windowed chat message renderer. Mounts only messages within
// BUFFER_ABOVE of the visible range. Streaming bottom message is
// always mounted by caller — this module only manages settled history.
// releaseNode() is called on eviction to null out refs to heavy
// nested state (code-block AST containers, decoded images) so heap
// actually drops, not just DOM node count.

const BUFFER_ABOVE = 20
const OBSERVE_ROOT_MARGIN = '400px 0px 0px 0px'

function createVirtualChatList(container, renderMessage) {
  const mounted = new Map()
  const placeholders = new Map()
  let currentMessages = []

  const io = new IntersectionObserver(/* ... */, {
    root: container,
    rootMargin: OBSERVE_ROOT_MARGIN
  })

  function mount(message) { /* A4 */ }
  function hydrate(idx) { /* A4 */ }
  function evictAboveFold(visibleTopIdx) { /* A4 */ }
  function releaseNode(node) {
    // Walk node subtree; null out any `._highlightAST`, `._decodedImage`,
    // `._codeTokens` refs the renderer may have attached.
    // ALSO: abort the node's AbortController (see listener-cleanup note
    // below). Nulling refs alone is insufficient — attached event
    // listeners pin the whole DOM subtree and prevent GC.
    // Purpose: ensure eviction drops heap, not just DOM nodes.
  }
  function setMessages(messages) { currentMessages = messages }

  return { mount, hydrate, evictAboveFold, releaseNode, setMessages,
           get size() { return mounted.size } }
}

module.exports = { createVirtualChatList }
```

**Step 3: Listener-cleanup contract.** Every mounted node carries its own `AbortController`, stored as `node._ac`. Every event listener attached during render passes `{ signal: node._ac.signal }`. `releaseNode` calls `node._ac.abort()`. Without this, listeners on nested elements (code-block copy buttons, image hover handlers, anything) pin the subtree and `replaceWith(placeholder)` leaks the detached node. Update `mount()` and `renderMessage` contract to always create/accept an AbortController.

**Step 4:** Syntax check: `node -c ace-desktop/renderer/modules/virtual-chat-list.js`.

**Step 5:** Commit:
```bash
git add ace-desktop/renderer/modules/virtual-chat-list.js
git commit -m "feat(chat): VirtualChatList skeleton — mount/hydrate/evict/release + AbortController"
```

---

### Task A4: Implement `evictAboveFold` + `hydrate`

**Files:**
- Modify: `ace-desktop/renderer/modules/virtual-chat-list.js`

**Note on naming:** function is `evictAboveFold` (messages above the visible top are evicted), not `evictBelowFold`. Don't invert the mental model.

**Step 1:** Implement `evictAboveFold(visibleTopIdx)` with **batch read, then batch write** to avoid layout thrash. Interleaving `getBoundingClientRect()` with `replaceWith()` forces a full reflow per iteration — on a 100-message eviction that's 100 reflows, which makes the eviction itself a frame-killer (exactly the problem we're trying to fix).

```js
function evictAboveFold(visibleTopIdx) {
  const evictBefore = visibleTopIdx - BUFFER_ABOVE

  // PASS 1: read all heights (no DOM mutation — avoids per-iter reflow)
  const toEvict = []
  for (const [idx, node] of mounted) {
    if (idx < evictBefore) {
      toEvict.push({ idx, node, h: node.getBoundingClientRect().height })
    }
  }

  // PASS 2: mutate (all reads done; each replaceWith invalidates layout
  // but we don't read again this frame)
  for (const { idx, node, h } of toEvict) {
    const ph = document.createElement('div')
    ph.className = 'message-placeholder'
    ph.style.height = `${h}px`
    ph.dataset.messageIndex = String(idx)
    ph.dataset.measuredHeight = String(h)
    node.replaceWith(ph)
    releaseNode(node)
    mounted.delete(idx)
    placeholders.set(idx, ph)
    io.observe(ph)
  }
}
```

**Step 2:** Implement `hydrate(idx)` — replace placeholder with re-rendered node, re-run code-block syntax highlighting, unobserve placeholder, remove from `placeholders` map.

**Stutter guard:** IntersectionObserver fires per-frame. On fast scroll top→bottom, many placeholders enter the viewport in rapid succession and `hydrate` gets called in a cascade. `postProcessCodeBlocks` (syntax highlighting via Prism/Shiki) is not cheap — cascading synchronous hydration jannks the scroll. Strategy: mount the skeletal node **synchronously** (so layout resolves immediately and scroll doesn't drift), but defer heavy work to `requestIdleCallback(fn, { timeout: 100 })` with a `requestAnimationFrame` fallback for browsers without rIC. Heavy work = syntax highlighting, image decoding, any markdown post-processing. This keeps fast scrolls smooth while still hydrating fully within 1–2 frames of the scroll settling.

**Step 3:** Height-reconciliation on rehydrate: after mounting, compare new `getBoundingClientRect().height` to `dataset.measuredHeight`. If delta > 2px, the placeholder was the wrong size — log to a counter (`window.__virtHeightDrift++`) so we can spot systemic drift in A6.

**Step 4:** Commit:
```bash
git add ace-desktop/renderer/modules/virtual-chat-list.js
git commit -m "feat(chat): VirtualChatList eviction + hydrate with heap release"
```

---

### Task A5: Integrate + index-based scroll restoration

**Files:**
- Modify: `ace-desktop/renderer/modules/session-manager.js`

**Step 1:** Replace direct DOM append in chat render path with `virtualList.mount(message)`. Attach scroll listener on chat container calling `evictAboveFold(topVisibleIndex)` debounced at 500ms.

**Step 2:** Guard: streaming bottom message mounts through existing stream-render code path (full mount, no virtualization). Virtual list manages *settled* messages only — never the in-flight assistant response.

**Step 3:** Scroll restoration on tab switch — persist `{ topVisibleMessageIndex, offsetWithinMessage }` per session, NOT `scrollTop` pixel. On restore:
1. Scroll target message's node into view (rehydrate placeholder if needed)
2. Adjust by `offsetWithinMessage` pixels

Pixel-based restoration drifts after rehydration because placeholder heights can be ±2px off from actual rendered heights, and that drift compounds across N intervening placeholders.

**Step 4:** Manual verify:
- `env -u ELECTRON_RUN_AS_NODE npm start` → open long session
- Scroll up and down rapidly, switch tabs, come back
- Confirm: no visual flash, scrollback returns to correct position, code blocks render correctly when scrolled back into view
- DevTools: `document.querySelectorAll('#session-chat-list .message').length` bounded (~BUFFER_ABOVE + visible, not full history)

**Step 5:** Commit:
```bash
git add ace-desktop/renderer/modules/session-manager.js
git commit -m "feat(chat): wire VirtualChatList — index-based scroll restoration"
```

---

### Task A6: Scripted verification (not just visual)

**Files:**
- Create: `ace-desktop/scripts/virtualization-stress.js`

Scrollbar jump and scroll drift are exactly the bug class virtualization famously ships with. "No visual flash" as a human verification step is too soft. Script it.

**Step 1:** Script programmatic exercise (runnable from DevTools Console or node via stress harness):
- Paste 60 messages (mix: 40 text, 15 with code blocks, 5 with embedded images if any)
- Rapid scroll: top → bottom → top → bottom, 5 cycles, 500ms per cycle
- **Assert:** `scrollTop` at top (0) and bottom (max) invariant ±2px across all 5 cycles
- **Assert:** `document.querySelectorAll('#session-chat-list .message').length` bounded (~BUFFER_ABOVE + visible, not 60)
- **Assert:** `window.__virtHeightDrift` < 3 total drifts (from A4 counter)

**Step 2:** Re-run A1's measurements:
- DOM node count: order of magnitude lower ✓
- Heap: lower or flat ✓
- Code-block/image count under `#session-chat-list`: bounded ✓ (if full count, `releaseNode` isn't releasing heavy refs — revisit A3's release hook)

**Step 3:** Heap snapshot comparison to A1 baseline:
- `Detached HTMLDivElement` retained size — must drop
- String retainers > 10KB — must drop (code-block content released)

If detached nodes persist after eviction, there's a listener or closure leak holding them. **Fix before Phase B** — don't stack phases on a leaky foundation.

**Step 4:** No commit — gate checkpoint.

---

## Phase B — Reduced-effects mode (Linux default + OS accessibility respect)

**Why:** 286 `backdrop-filter` / `box-shadow` occurrences across 24 CSS files. On Linux with flaky GPU compositing (Wayland, integrated GPU, disabled HW accel), these fall back to CPU and each frame costs 10×. Same problem hits macOS users on weak Intel MBPs under load and any user with OS-level accessibility settings for reduced motion or transparency. VS Code deliberately avoids this entire effect class.

**Approach:** Single `body.reduced-effects` class gates override stylesheet. Applied when ANY of:
- `platform === 'linux'` (default, user-overridable)
- OS reports `prefers-reduced-motion: reduce`
- OS reports `prefers-reduced-transparency: reduce`
- User toggled it on via config

### Task B1: Platform detection + media queries + boot-order flash fix

**Files:**
- Modify: `ace-desktop/preload.js`
- Modify: `ace-desktop/renderer/index.js` (or renderer bootstrap entry — grep `document.body.classList` or `did-finish-load` to locate)
- Modify: `ace-desktop/main.js` (synchronous config-at-window-creation wiring)

**Boot-order flash problem:** If we read `reducedEffects` from an async `window.ace.config.get()`, a user who unchecked the Linux default sees a flash of flat UI before the config resolves and removes the class. Fix: expose `window.ace.initialConfig` synchronously at bootstrap, populated by main process at window creation time (before `did-finish-load` fires).

**Step 1:** In preload, add:
```js
platform: process.platform,
// initialConfig populated by main via contextBridge before window shows
```

Wire `main.js` to pass config synchronously via `additionalArguments` on the BrowserWindow, or via a sync IPC call made at preload-time.

**Step 2:** In renderer bootstrap, before first paint:
```js
const cfg = window.ace.initialConfig ?? {}
const platformDefault = window.ace.platform === 'linux'
const prefersReducedMotion =
  matchMedia('(prefers-reduced-motion: reduce)').matches
const prefersReducedTransparency =
  matchMedia('(prefers-reduced-transparency: reduce)').matches
const userSetting = cfg.reducedEffects  // undefined = auto

const shouldReduce = userSetting ??
  (platformDefault || prefersReducedMotion || prefersReducedTransparency)

if (shouldReduce) document.body.classList.add('reduced-effects')

// React live to OS setting changes
const reapply = () => {
  const cfg2 = window.ace.cachedConfig ?? cfg
  const next = cfg2.reducedEffects ??
    (platformDefault ||
     matchMedia('(prefers-reduced-motion: reduce)').matches ||
     matchMedia('(prefers-reduced-transparency: reduce)').matches)
  document.body.classList.toggle('reduced-effects', !!next)
}
matchMedia('(prefers-reduced-motion: reduce)')
  .addEventListener('change', reapply)
matchMedia('(prefers-reduced-transparency: reduce)')
  .addEventListener('change', reapply)
```

**Step 3:** Manual verify on Mac:
- Class NOT applied by default
- Toggle macOS System Settings → "Reduce motion" ON → class applies without restart
- DevTools `document.body.classList.add('reduced-effects')` still works for manual testing
- No boot-time flash (load with reducedEffects: false in config, confirm UI renders full-fidelity from first paint)

**Step 4:** Commit:
```bash
git add ace-desktop/preload.js ace-desktop/renderer/index.js ace-desktop/main.js
git commit -m "feat(perf): reduced-effects class — platform + OS a11y + user setting, no boot flash"
```

---

### Task B2: Override stylesheet (preserves accessibility affordances)

**Files:**
- Create: `ace-desktop/renderer/styles/reduced-effects.css`
- Modify: `ace-desktop/renderer/index.html` (link LAST so cascade wins)

**Step 1:** Scope everything under `body.reduced-effects`. Strip `backdrop-filter`, kill continuous decorative animations, simplify decorative shadows — but **preserve focus rings and other accessibility affordances**.

```css
/* reduced-effects.css — Linux / low-GPU / reduced-motion fallback.
 * Strips decorative GPU-expensive effects while preserving
 * accessibility affordances (focus rings, active states). */

body.reduced-effects *,
body.reduced-effects *::before,
body.reduced-effects *::after {
  backdrop-filter: none !important;
  -webkit-backdrop-filter: none !important;
}

/* Kill continuous decorative animations only.
 * Do NOT touch :focus, :active, or loading indicators. */
body.reduced-effects .atmosphere,
body.reduced-effects .glow,
body.reduced-effects [class*="ring-anim"],
body.reduced-effects [class*="pulse-anim"] {
  animation: none !important;
}

/* Simplify decorative box-shadow to 1px rim.
 * Focus rings use outline, not box-shadow, so they survive. */
body.reduced-effects .card,
body.reduced-effects .pane,
body.reduced-effects .modal,
body.reduced-effects .chat-message {
  box-shadow: 0 0 0 1px rgba(255, 255, 255, 0.06) !important;
}

/* Explicitly preserve focus rings — keep :focus-visible intact */
body.reduced-effects :focus-visible {
  outline: 2px solid var(--accent, #d4a574) !important;
  outline-offset: 2px !important;
}
```

**Step 2:** Link last in `index.html`:
```html
<link rel="stylesheet" href="styles/reduced-effects.css" />
```

**Step 3:** Manual verify on Mac:
- `document.body.classList.add('reduced-effects')` → UI flat but usable
- Tab through focusable elements → focus rings visible
- Buttons still show hover/active states (only decorative/continuous effects gone)
- Remove class → original returns

**Step 4:** Commit:
```bash
git add ace-desktop/renderer/styles/reduced-effects.css ace-desktop/renderer/index.html
git commit -m "feat(perf): reduced-effects stylesheet — strips decorative filters, preserves focus"
```

---

### Task B3: Tri-state config toggle (not binary)

**Files:**
- Modify: config UI (grep for existing appearance/theme settings panel)
- Modify: `ace-desktop/main.js` config schema

**Why tri-state, not checkbox:** A Mac user who wants macOS "Reduce motion" to propagate needs *Auto*, not *Off*. A binary toggle collapses `undefined` (auto) into `false` (off), losing that intent. Three states: Auto / Always on / Always off.

**Step 1:** Dropdown "Visual effects":
- "Auto (platform + accessibility settings)" — config value `undefined`
- "Reduced always" — `true`
- "Full always" — `false`

**Step 2:** Persist `reducedEffects: boolean | undefined` via existing `PATCH_CONFIG`.

**Step 3:** On change, re-run B1's resolution logic (without reload), apply/remove class, update `window.ace.cachedConfig` so live-reacting media queries see the new value.

**Step 4:** Manual verify:
- Auto on Mac (no a11y settings) → off
- Auto on Mac with macOS Reduce Motion on → on
- Auto on Linux → on
- "Always on" / "Always off" override regardless of platform or a11y
- Restart persists

**Step 5:** Commit:
```bash
git add ace-desktop/renderer/views/config.js ace-desktop/main.js
git commit -m "feat(config): reducedEffects tri-state — auto/on/off dropdown"
```

---

## Phase C — MCP spawn deferral + idle prewarm + bypass

**Why:** Session open currently spawns `claude` CLI → all MCP servers. Chat unresponsive until spawn settles. Hits Windows worst (AV scans subprocess, cmd.exe overhead, 500ms–2s Defender stall per spawn). Also: users who open a session just to read history pay the full MCP boot tax for zero UX gain. Lazy-init is how IDEs solved the same problem (language servers).

### Task C1: MCP status dot + perf telemetry hooks

**Files:**
- Modify: chat UI template (grep for send button)
- Modify: `ace-desktop/renderer/modules/session-manager.js`
- Create: `ace-desktop/src/perf-telemetry.js`

**Step 1:** Status dot next to send button:
- Gray: "idle" (no process spawned yet)
- Yellow pulse: "starting" (spawn in-flight)
- Green: "ready"
- Red: "failed"

**Step 2:** Perf telemetry hooks — emit opt-in events (gated on existing user telemetry preference; do not collect without consent):
- `first_interactive_ms` — from app launch to first usable UI
- `session_open_to_ready_ms` — from session click to spawn ready
- `first_token_ms` — from send click to first stream token

Without these, you can't confirm the fix landed for real users — just for Alex. 1 week of data before claiming success.

**Step 3:** Wire dot to existing chat-manager spawn lifecycle events.

**Step 4:** Commit:
```bash
git add ace-desktop/renderer/modules/session-manager.js ace-desktop/src/perf-telemetry.js
git commit -m "feat(chat): MCP status dot + opt-in perf telemetry hooks"
```

---

### Task C2: Defer spawn until first send OR 5s idle prewarm

**Files:**
- Modify: `ace-desktop/src/chat-manager.js`
- Modify: `ace-desktop/renderer/modules/session-manager.js`

**Idle-prewarm rationale:** Pure "defer until send" hurts users who open a session, think for 10 seconds, then send — they pay the full cold-start tax *plus* the thinking time. 5s idle prewarm gives that latency back: history-only users still never spawn (they close before 5s or don't care), but active users warm up silently in the background.

**Step 1:** Read-path audit — BEFORE changing the spawn trigger, verify what session-open needs:
- Does transcript hydration call into CLI? (grep chat-manager / session-reader)
- Does history view call into CLI?
- Does file preview within a session call into CLI?

If any of the above use the CLI, either:
- Route those reads through main-process file IO directly (preferred), OR
- Document the dependency and keep eager spawn for history-opened sessions; only defer for net-new sessions

**Do not silently break read-mode.**

**Step 2:** Change spawn contract:
- Opening a session marks it "active" but does NOT spawn
- Three trigger paths for spawn (whichever fires first):
  - First send (existing path, now also triggers spawn)
  - **5-second *activity* timer** after session open (background prewarm)
  - Any CLI-dependent action uncovered in Step 1's audit

**Activity detection for the prewarm timer:** "Idle" must mean *no user engagement with the chat*, not just *no send event*. Otherwise a user who opens a session and spends 30s typing a long message sits in "idle" the whole time, prewarm never fires, they hit a cold spawn on send — worst of both worlds. Define activity as any of:
- Input focus entering the chat textarea
- Keystroke in the chat textarea (even a single character)
- Scroll on the chat container
- Selection change within the chat view

Any of these → reset a 5s countdown. When the countdown expires, trigger prewarm. Kill the timer entirely on session close or tab switch away. This way, active typers prewarm silently the moment they show intent (first keystroke → 5s → spawn, runs in parallel with them composing); history browsers never spawn.

**Step 3:** Double-spawn guard + queuing + edge cases:
- Send arrives while spawn in-flight → queue, flush on ready
- User sends 2+ messages before spawn returns → queue all, flush in order
- User closes session during prewarm → cancel spawn
- User switches tabs during prewarm → continue in background; resources are cheap
- Spawn fails → red dot + error card + surface `suppressMcp` toggle as suggested remedy, no infinite retry

**Step 4:** Manual verify:
- Mac: open session, `ps aux | grep claude` for 10s — no process until ~5s, then appears (prewarm)
- Mac: open session + immediately send — process spawns on send, chat works normally, no added latency
- Mac: open session, close within 3s — no process ever spawned
- Windows (Marc): same sequence, confirm spawn appears in Task Manager

**Step 5:** Commit:
```bash
git add ace-desktop/src/chat-manager.js ace-desktop/renderer/modules/session-manager.js
git commit -m "perf(chat): defer claude spawn until first send or 5s idle prewarm"
```

---

### Task C3: `suppressMcp` toggle in Config

**Files:**
- Modify: config UI (same file as B3)

**Step 1:** Checkbox "Disable MCP servers (emergency bypass — speeds chat launch by skipping all MCP tools)". Writes existing `suppressMcp` config field.

**Step 2:** Toggling kills live chat processes so next send respawns with new flag. Toast: "MCP setting changed — next message restarts the chat process."

**Step 3:** Manual verify: enable → send → chat works, no MCP tools available. Disable → send → MCP tools return.

**Step 4:** Commit:
```bash
git add ace-desktop/renderer/views/config.js
git commit -m "feat(config): suppressMcp toggle — emergency MCP bypass"
```

---

## Regression gate (run after each phase)

From ace-desktop root:

```bash
STRESS=1 npm start
# In DevTools:
await __stress.runChatHeavy(6, 20, 3)
await __stress.runPtyHeavy(6)
```

**Targets vs `scripts/stress-results.jsonl` Apr-20 baseline:**
- chat-heavy p99 ≤ 20ms
- chat-heavy over50 ≤ 3
- peakHeapMB ≤ 15
- pty-heavy p99 ≤ 15ms

**Phase A additional gate:** Run `scripts/virtualization-stress.js` from A6. All assertions pass. Heap snapshot shows drop in `Detached HTMLDivElement` retained size vs A1 baseline.

**Phase B additional gate:** Toggle class on/off in DevTools — no layout shift. Tab through focusable elements in both modes — focus rings visible.

**Phase C additional gate:** Open session, wait 10s without sending → `ps aux | grep claude` shows process appeared (prewarm fired). Open + immediate send → send path added latency < 100ms.

If any phase breaches: revert that phase's commits, diagnose, don't proceed.

---

## Execution order

1. **Alex's profile first.** Without it, phase order is a guess — the gate table resolves order from the profile numerically.
2. **Land [2026-04-20-performance-optimization-revised.md](ace-desktop/docs/plans/2026-04-20-performance-optimization-revised.md) Phase B first** if not already — `get-augmented-env` extraction is a prerequisite for C2's spawn contract changes, and its timer cleanup reduces risk of listener leaks surviving A4 eviction.
3. **Profile dictates phase order within this plan** (gate table above).
4. **Task by task, one commit each.** Per [feedback_incremental_edits_only](memory/feedback_incremental_edits_only.md).
5. **Cross-platform testing for C:** Mac (dev) + Windows (Marc) + Linux (Alex) before tagging release. Windows confirms AV-spawn deferral win; Linux confirms reduced-effects; Mac catches regressions.

---

## Post-ship followups

- **Update [project_ace_desktop_ipc_backpressure.md](memory/project_ace_desktop_ipc_backpressure.md)** to note the Apr-18 virtualization rejection was scoped to multi-agent freeze investigation, not long-session memory — so a future session doesn't re-reject virtualization work under different motivation.
- **Collect 1 week of `first_interactive_ms` / `first_token_ms` telemetry** before claiming the fix landed beyond Alex's case.
- **Mark on [ROADMAP.md](ace-desktop/ROADMAP.md):** "chat renderer windowed," "reduced-effects mode," "MCP lazy-init + prewarm" as shipped per [feedback_roadmap_update_on_ship](memory/feedback_roadmap_update_on_ship.md).
- **Rename this file** to `2026-04-20-longsession-coldstart-perf.md` after Phase A lands (or whenever a link-update sweep is cheap). Title in the doc is already updated.

---

## Summary

| Phase | Tasks | Days | Platform scope | Expected impact |
|---|---|---|---|---|
| A: Chat virtualization | A1–A6 | 2–3 | All platforms | Renderer RSS stops growing over a workday; scrollback perf on long sessions |
| B: Reduced-effects mode | B1–B3 | 1 | Linux default, OS a11y auto-on, all opt-in | Large on Linux weak GPU; helps Intel Macs + accessibility users |
| C: MCP spawn deferral + prewarm | C1–C3 | 1–2 | All platforms | Windows biggest win (AV overhead); session-open no longer blocks; history-only users never spawn |

**12 tasks. One commit each. Profile-gated phase selection. Regression gate after every phase. Heap verification, not just DOM count. Tri-state config, not binary. Index-based scroll restoration, not pixel.**
