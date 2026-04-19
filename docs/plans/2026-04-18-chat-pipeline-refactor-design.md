# Chat Pipeline Refactor — Design Document

> **Status:** Draft — pressure-test before committing to an approach.
> **Date:** 2026-04-18
> **Companion plan:** `2026-04-16-chat-rendering-scalability.md` covers *performance* (incremental parse, hidden-pane deferral, pty backpressure). This document covers *structural architecture*. Sequencing resolved — see §5.

---

## 1. Problem Hypothesis

### 1.1 The Monolith

`session-manager.js` is 1,679 lines and owns too many concerns:

| Concern | Lines | Cohesion with session lifecycle |
|---|---|---|
| Chat send + streaming render | ~250 | High — core orchestration |
| Tool block rendering (ops, questions, memory cards) | ~250 | Medium — rendering, not lifecycle |
| MCP event/auth/permission card rendering | ~300 | Low — self-contained error recovery UI |
| `.claude/` permission approval cards | ~80 | Low — self-contained |
| Context bar + token tracking | ~120 | Medium — per-session state |
| Session spawn + lifecycle (close, activate, fit) | ~400 | High — this IS the module |
| Init, helpers, soft GC | ~280 | High — glue |

~630 lines (tool rendering + MCP cards + permission cards) have low cohesion with session lifecycle and could live anywhere.

### 1.2 The Duplication

`agent-manager.js` (436 lines) duplicates significant chat-pane infrastructure from session-manager:

| Duplicated code | session-manager lines | agent-manager lines |
|---|---|---|
| Chat pane DOM template (innerHTML) | 1249–1293 | 79–134 |
| Chat input wiring (keydown, input, send btn) | 1370–1413 | 166–195 |
| Mode toggle (chat ↔ terminal, lazy xterm init) | 1437–1508 | 224–294 |
| Attachment handler wiring | 1416–1421 | 199–203 |
| Model/permissions/effort selectors | in template | in template |

**~180 lines are structurally identical** across the two modules, with minor config differences (agent panes have a role label, different container targets, no session timer).

What IS properly shared today (agent-manager imports from session-manager):
- `sendChatMessage` — chat send + message queue logic
- `wireChatListeners` — IPC stream event handling
- `scheduleRender` — debounced rAF render
- `appendToolBlock` / `appendToolInput` — tool block creation
- `escapeHtml`, `syntaxHighlight`, `findSettledBoundary`, `renderTail`, `postProcessCodeBlocks`, `processWikilinks` — from chat-renderer.js

So the *logic* is shared but the *wiring and DOM construction* is copy-pasted.

### 1.3 The Coupling Risk

Every new chat-capable surface (Insight voice view, client-facing preview pane, or a future "focus mode" single-pane layout) will need to either:
- Copy-paste the same 180 lines again (debt compounds)
- Import session-manager and hope the function signatures stay stable (fragile coupling to a 1,600-line module)

### 1.4 What This Is NOT About

- **Performance.** The scalability plan handles rendering perf. This is about code organization.
- **State model unification.** `state.sessions` and `state.agentSessions` remain separate. Merging them is a bigger change with higher blast radius — it's explicitly out of scope here, though Approach C describes it as a future phase.
- **Feature changes.** No user-facing behavior changes. Pure internal refactor.

---

## 2. Inventory: What Exists Today

### Module dependency graph (chat-related)

```
state.js (shared singleton)
    ↑
chat-renderer.js (pure functions: escapeHtml, syntaxHighlight, findSettledBoundary, renderTail, postProcessCodeBlocks, processWikilinks)
    ↑
session-manager.js (1,678 lines — chat send, stream handling, tool blocks, MCP cards, session lifecycle, context bar, soft GC)
    ↑               ↑                               ↑
    |               |                               |
agent-manager.js    command-bar.js, slash-menu.js,  telemetry.js (MODEL_CTX_LIMITS),
(435 lines)         attention-menu.js (activateSession),  settings.js (fitActive, sendToActive)
    ↑
ace-mark.js, attention.js, attachment-handler.js, theme.js

refresh-engine.js (213 lines) — callback coordinator; session-manager registers its soft GC
    function into refresh-engine via onSoftGC(). No import from session-manager.
```

### Session state shape (per session in `state.sessions[id]`)

```js
{
  // Identity
  term, fitAddon, pane, tab, mode, name, claudeSessionId, resumeId, resumeCwd,

  // Chat state
  messages: [], pendingAttachments: [], currentStreamText: '', currentToolInput: '',
  isStreaming: false, model: 'opus',

  // Telemetry
  totalCost: 0, totalTokens: { input: 0, output: 0 },
  contextInputTokens: 0, turnDeltas: [],

  // Attention
  needsAttention: false, attentionReason: null, attentionAt: null,

  // Internal render state
  _settledBoundary, _settledHTML, _currentAssistantEl, _pendingRAF,
  _currentToolBlock, _opsContainer, _opsCount, _currentToolName,
  _hadToolBlocks, _questionBlockEl, _wordTimer, _fullResponseText,
  _prevContextTokens, _costWarned, _messageQueue, _cleanupListeners,
  lastPrompt,

  // Added by refactor (Phase 2)
  _paneControls: null,  // { pane, tab, chatInput, sendBtn, destroy, setStreaming } — returned by createChatPane
}
```

Agent sessions (`state.agentSessions[id]`) have the same shape plus `role`, `spawnTime`, `lineCount`, `status`, `rosterItem`.

### Files that import from session-manager.js

| File | What it imports |
|---|---|
| `agent-manager.js` | `sendChatMessage`, `wireChatListeners`, `scheduleRender` |
| `command-bar.js` | `sendToActive`, `spawnSession` |
| `attention-menu.js` | `activateSession` |
| `settings.js` | `fitActive`, `sendToActive` |
| `telemetry.js` | `MODEL_CTX_LIMITS` — defined at session-manager.js:14; should relocate to `telemetry.js` or a shared constants file during Phase 1 extraction |
| `split-pane-manager.js` | Uses `window.spawnSession`, `window.activateSession` (global bridge, not ES import) |
| `index.js` (main entry) | `initSessions` |

> **Removed:** `atmosphere.js` was listed here previously but does not actually import from session-manager (verified via grep). The relationship is the reverse — session-manager calls atmosphere functions directly.

---

## 3. Three Approaches

### Approach A: "Chat Pane Component" Extraction (Recommended)

**Core idea:** Extract a `chat-pane.js` module that owns the full lifecycle of a single chat pane as a factory function. Session-manager and agent-manager both call `createChatPane(id, config)` instead of duplicating DOM construction and event wiring. Simultaneously extract `tool-renderer.js` and `mcp-cards.js`.

**New module map:**

```
chat-pane.js (~250 lines) — NEW
    Creates chat pane DOM, wires input handlers, mode toggle, lazy xterm,
    attachment handlers, slash menu. Returns a pane object with {el, activate, destroy}.
    Config-driven: { showTimer, showMoveBtn, roleName, containerEl, tabBarEl }

tool-renderer.js (~250 lines) — EXTRACTED from session-manager
    appendToolBlock, appendToolInput, updateActivityIndicator, clearActivityIndicator,
    renderMemoryCard, parseMemoryFrontmatter, isMemoryWritePath, renderQuestionCard

mcp-cards.js (~300 lines) — EXTRACTED from session-manager
    renderMcpEventCard, renderPermissionApprovalCard, renderMcpPermissionCard,
    resetMcpAuth, mcpEsc

session-manager.js (~800 lines) — SHRUNK
    sendChatMessage, wireChatListeners, scheduleRender, renderChatStream,
    finalizeMessage, updateChatStatus, updateTokensFromStream, updateContextBar,
    resetContext, showChatBanner, formatTokens,
    spawnSession (now thin: calls createChatPane + wires session-specific stuff),
    closeSession, activateSession, toggleSessionMode, fitActive,
    sendToActive, initSessions, softGcSessions

agent-manager.js (~320 lines) — SHRUNK
    spawnAgentPane (now thin: calls createChatPane + wires agent-specific stuff),
    closeAgentPane, focusAgentPane, toggleAgentMode,
    wireHResizer, wireVResizer, refreshAgentsLayout, initAgents

chat-renderer.js — UNCHANGED (already clean)
```

**What `createChatPane` looks like:**

```js
// chat-pane.js
export function createChatPane(id, config = {}) {
  const {
    roleName = 'ACE',
    showTimer = false,
    showMoveButton = false,
    moveDirection = '→',
    placeholder = 'Message ACE...',
    containerEl,       // where to append the pane DOM
    tabBarEl,          // where to append the tab (null for agents — they use roster)
    onSend,             // (id, prompt) => void — fires on submit; caller owns queue + streaming
    onClose,            // (id) => void
    onModeToggle,       // (id) => void — e.g. (id) => toggleSessionMode(id)
    onTerminalInit,     // (containerEl) => void — fires once on first mode toggle to terminal
    onSlashCommand,     // (command, id) => void — caller owns slash-menu.js logic
    onAttachment,       // (file) => void — fires when a file is added (optional, for side-effects)
    onAttachmentsChange,// (files[]) => void — fires on every add OR remove with updated full array
  } = config

  // Build DOM (the ~80-line innerHTML template, parameterized)
  // Wire input handlers (keydown, input, send button)
  // Wire attachment handlers (pick, drop, paste) — maintains local files[] array,
  //   calls onAttachmentsChange(files) on every add or remove (including chip × clicks)
  // Wire slash menu trigger — on '/' keydown, calls onSlashCommand(command, id);
  //   does NOT import slash-menu.js (caller owns slash-menu logic)
  // Wire mode toggle button — calls onModeToggle(id); onTerminalInit fires on first toggle
  // Wire session timer (if showTimer)

  return { pane, tab, chatInput, sendBtn, destroy, setStreaming }
}
```

**Import changes:**

```diff
// agent-manager.js
+ import { createChatPane } from './chat-pane.js'
  import { sendChatMessage, wireChatListeners, scheduleRender } from './session-manager.js'
  // Delete the ~180-line inline DOM construction + event wiring block

// session-manager.js
+ import { createChatPane } from './chat-pane.js'
+ import { appendToolBlock, appendToolInput, ... } from './tool-renderer.js'
+ import { renderMcpEventCard, ... } from './mcp-cards.js'
+ import { MODEL_CTX_LIMITS } from './telemetry.js'   // relocated from here in Phase 1
  // Delete the ~630-line tool/MCP rendering block
```

**Trade-offs:**

| | |
|---|---|
| **+** Eliminates duplication root cause | **-** 3 new files to navigate |
| **+** Future chat surfaces call `createChatPane()` | **-** Moderate refactor risk (DOM ids, event handlers) |
| **+** MCP cards reusable without importing session-manager | **-** Need to verify no circular deps |
| **+** session-manager drops to ~800 lines | |
| **+** Each new module is self-contained and < 300 lines | |

**Risk assessment:** Medium. The extractions are mechanical (move functions, update imports). The chat-pane factory requires parameterizing the DOM template, which means testing every variant (session pane, agent pane) after the move. No test framework exists, so verification is manual via `npm start` + DevTools.

---

### Approach B: "Extract-Only" (Minimal)

**Core idea:** Extract `tool-renderer.js` and `mcp-cards.js` from session-manager. Leave chat pane DOM and wiring duplicated between session-manager and agent-manager. Just shrink the monolith.

**New module map:**

```
tool-renderer.js (~250 lines) — EXTRACTED
mcp-cards.js (~300 lines) — EXTRACTED
session-manager.js (~1,100 lines) — SHRUNK (still has duplicated chat pane code)
agent-manager.js (~436 lines) — UNCHANGED
```

**Trade-offs:**

| | |
|---|---|
| **+** Lowest risk — fewer moving parts | **-** Doesn't fix duplication (the actual debt) |
| **+** session-manager drops to ~1,100 lines | **-** 1,100 lines is still large |
| **+** Fast to execute (~1 session) | **-** Next chat surface re-copies 180 lines |
| **+** MCP cards become reusable | **-** Half-measure you'll revisit |

**Risk assessment:** Low. Pure function extraction with no behavioral change.

**When this is the right call:** If you're shipping a release in <48 hours and want quick wins without risking regressions.

---

### Approach C: "Full Component Model" (Ambitious)

**Core idea:** Everything in Approach A, plus unify `state.sessions` and `state.agentSessions` into a single session registry with a `type` discriminator. One lifecycle, one set of IPC handlers, one attention system.

**New module map:**

```
chat-pane.js (~250 lines) — NEW (same as Approach A)
tool-renderer.js (~250 lines) — EXTRACTED
mcp-cards.js (~300 lines) — EXTRACTED

session-registry.js (~200 lines) — NEW
    Unified session store: state.allSessions[id] = { type: 'chat' | 'agent' | 'orchestrator', ...}
    register(id, type, config), unregister(id), getByType(type), getActive()

session-manager.js (~600 lines) — SHRUNK FURTHER
    Chat pipeline only: send, stream, render, finalize, context bar
    No spawn/close/activate — those move to session-registry

agent-layout.js (~200 lines) — RENAMED from agent-manager
    Two-row grid layout, roster sidebar, resizers
    Delegates session lifecycle to session-registry

chat-renderer.js — UNCHANGED
```

**State model change:**

```js
// Before (state.js)
sessions: {},
agentSessions: {},
activeId: null,
focusedAgentId: null,

// After (state.js)
allSessions: {},        // unified map
activeSessionId: null,  // works for both
```

**Files affected by state model change:**

| File | References to `state.sessions` | References to `state.agentSessions` |
|---|---|---|
| session-manager.js | ~40 | 0 |
| agent-manager.js | 0 | ~35 |
| attention.js | ~4 | ~4 |
| attention-menu.js | ~3 | ~3 |
| telemetry.js | ~3 | ~3 |
| ace-mark.js | ~2 | ~2 |
| atmosphere.js | 0 | 0 |
| refresh-engine.js | ~2 | ~2 |
| split-pane-manager.js | ~3 | 0 |
| theme.js | ~2 | ~2 |
| **Total** | **~59** | **~51** |

That's **~110 references** across 10 files that need updating.

**Trade-offs:**

| | |
|---|---|
| **+** Maximum DRY — single code path for everything | **-** 110 reference sites to update across 10 files |
| **+** Simplifies telemetry, attention, soft GC (one loop) | **-** Layout concerns (tabs vs. roster, split-pane vs. grid) need abstraction |
| **+** Clean foundation for any future session type | **-** 2-3 build sessions instead of 1 |
| **+** session-manager drops to ~600 lines | **-** Highest regression risk without tests |

**Risk assessment:** High. The state model is the gravity well of the app. Every module touches it. No test framework means 110 manual verification points. Powerful result, but painful execution.

**When this is the right call:** As a Phase 2 after Approach A proves stable. The chat-pane extraction de-risks the state unification by reducing the surface area first.

---

## 4. Comparison Matrix

| Criterion | A: Chat Pane Component | B: Extract-Only | C: Full Component Model |
|---|---|---|---|
| session-manager final size | ~800 lines | ~1,100 lines | ~600 lines |
| Duplication eliminated | Yes | No | Yes |
| New files | 3 | 2 | 5 |
| References to update | ~20 imports | ~10 imports | ~110 refs across 10 files |
| Future chat surface cost | Call `createChatPane()` | Copy-paste 180 lines | Call `createChatPane()` |
| Risk level | Medium | Low | High |
| Build sessions | 1-2 | 1 | 2-3 |
| Prerequisite | None | None | Approach A first (recommended) |

---

## 5. Sequencing Relative to Scalability Plan

~~The scalability plan (`2026-04-16`) modifies `session-manager.js` significantly (incremental render, hidden-pane deferral). This refactor should ship **after** the scalability work.~~

**Updated 2026-04-18:** The scalability work is complete. The streaming freeze fix (`findSettledBoundaryFrom` O(n)→incremental), IPC event batching, and refresh engine all shipped and merged to main. session-manager.js is at 1,678 lines — the scalability work landed and was absorbed with no net size reduction, which confirms the structural debt is real and compounding.

**This refactor can execute now against current code.**

1. ~~Scalability plan ships (Tasks 0-5)~~ — **done**
2. This refactor extracts the already-improved code into clean modules ← **start here**
3. Future features (Insight chat, client preview) build on the clean foundation

If executed, session-manager goes from **1,678 lines → ~800 lines**.

---

## 6. Pressure Test Questions

Use these to stress-test whichever approach you're evaluating:

1. **Circular dependency check:** Does `chat-pane.js` need to import from `session-manager.js`? If yes, we have a cycle. (Answer for Approach A: No — chat-pane creates DOM and returns references. session-manager passes callbacks via config. No back-import needed.)

2. **Agent-specific divergence:** What if agent panes need different chat behavior in the future (e.g., tool approval flows, orchestration commands)? (Answer: `createChatPane` takes an `onSend` callback — the caller controls what happens. The DOM and wiring are shared; the behavior is caller-defined.)

3. **MCP card reuse:** Will agent panes ever show MCP auth cards? (Answer: Yes — agents use MCP tools too. Extracting `mcp-cards.js` makes this work without importing session-manager.)

4. **State shape fragility:** The session state object has 30+ fields. Is the shape documented anywhere? (Answer: Only implicitly in `spawnSession` initialization. A TypeScript interface or JSDoc typedef in `state.js` would help but is out of scope for this refactor.)

5. **Soft GC interaction:** The soft GC callback in session-manager prunes DOM and clears buffers. After extraction, does it need to reach into tool-renderer or mcp-cards state? (Answer: No — GC operates on `s._settledHTML`, `s._currentAssistantEl`, etc., which stay in session-manager. Tool/MCP cards are fire-and-forget DOM nodes.)

6. **Global bridge functions:** `window.spawnSession`, `window.activateSession`, `window.sendChatMessage` are set in `initSessions`. After refactor, do callers need updating? (Answer: No — the globals still get assigned in `initSessions`. The internal implementation changes but the bridge API doesn't.)

---

## 7. Recommendation

**Approach A (Chat Pane Component extraction)** — 80% of the structural benefit at 40% of the risk of C.

Phase it as:
- **Phase 1:** Extract `tool-renderer.js` and `mcp-cards.js` (pure function moves, lowest risk)
- **Phase 2:** Extract `chat-pane.js` (DOM template + wiring unification)
- **Phase 3 (future):** If warranted, unify session state model (Approach C)

Each phase ships independently. Each phase leaves the app in a working state. No phase depends on a future phase to be valuable.

---

## 8. Before Executing — Resolved Gaps

*All gaps identified across two rounds of pressure testing (2026-04-18). Resolved here so an executor doesn't hit them mid-session.*

---

### Gap 1 — Who assigns `s.pane` and `s.tab` after `createChatPane`?

**Resolved:** The factory never touches session state. It returns `{ pane, tab, chatInput, sendBtn, destroy, setStreaming }`. The caller (session-manager's `spawnSession` or agent-manager's `spawnAgentPane`) assigns immediately after the call:

```js
const controls = createChatPane(id, config)
s.pane     = controls.pane
s.tab      = controls.tab
s._paneControls = controls   // holds chatInput, sendBtn, destroy, setStreaming
```

The factory is a pure DOM factory. State ownership stays with the caller.

---

### Gap 2 — Lazy xterm/pty init requires Electron IPC — how does the factory stay pure?

**Resolved:** The factory takes an `onTerminalInit: (containerEl) => void` callback in its config. The factory creates the terminal container `<div>` and stores it. When the mode-toggle button is clicked and the terminal hasn't been initialized yet, the factory calls `onTerminalInit(termContainer)`. The caller (session-manager or agent-manager) passes its existing pty spawn logic as the callback.

```js
createChatPane(id, {
  onTerminalInit: (containerEl) => {
    // existing xterm/pty spawn logic from spawnSession
    window.ace.pty.create(id, ...)
    s.term = new Terminal(...)
    s.term.open(containerEl)
  },
  ...
})
```

The factory has zero IPC dependency. All IPC stays in session-manager/agent-manager.

---

### Gap 3 — `appendToolBlock` and friends operate on `s.*` fields — is Phase 1 actually a pure move?

**Resolved:** Yes, with one convention change. All functions in `tool-renderer.js` take `s` (the session state object) as their first explicit parameter. Every call site in session-manager updates accordingly.

```js
// Before (implicit session closure)
appendToolBlock(name, input)

// After (explicit session state)
appendToolBlock(s, name, input)
```

This is mechanical — grep for each function name, update the call site. No behavioral change. The functions become genuinely stateless (no closure over session state) and unit-testable in isolation if a test framework is ever added.

Same convention applies to any `mcp-cards.js` functions that need session context.

---

### Gap 4 — Does `sessionsObj` belong in the `createChatPane` config?

**Resolved:** No. Remove `sessionsObj` and `defaults` from the factory config entirely. The factory never reads or writes session state.

Attachment handling: the factory maintains its own internal `files[]` array (local to the closure). It calls `onAttachmentsChange(files)` on every mutation — both when a file is added (drag-drop, paste, file-pick) and when the user clicks a chip's × button to remove one. The caller receives the full updated array and syncs it to `s.pendingAttachments`. `onAttachment(file)` fires additionally on add only, for callers that need individual-file side-effects (e.g. showing a upload spinner).

Chip × removal is wired inside the factory because the × button lives in factory-owned DOM. The factory never holds a reference to session state — it just calls the callback.

Corrected minimal factory config:

```js
createChatPane(id, {
  roleName, showTimer, showMoveButton, moveDirection, placeholder,
  containerEl, tabBarEl,
  onSend, onClose, onModeToggle, onTerminalInit,
  onSlashCommand, onAttachment, onAttachmentsChange,
})
```

---

### Gap 5 — Who controls send button disabled state when streaming starts/stops?

**Resolved:** The factory's return value includes `setStreaming(bool)`. session-manager calls this whenever `s.isStreaming` changes — on stream start, stream end, and error recovery.

```js
// In session-manager, wherever isStreaming flips:
s.isStreaming = true
s._paneControls?.setStreaming(true)

// On finalize:
s.isStreaming = false
s._paneControls?.setStreaming(false)
```

`setStreaming` inside the factory toggles `sendBtn.disabled` and a CSS class for visual state. One-way signal from session-manager to pane. No circular dependency.

---

### Additional fixes (design gaps)

**Gap 6 — Import diff corrected (moved to §3.A above).**

**Gap 7 — `MODEL_CTX_LIMITS` relocation (add to Phase 1 task list):**
Move `MODEL_CTX_LIMITS` from `session-manager.js:14` to `telemetry.js` (where it is consumed). Update `session-manager.js` to import it from `telemetry.js`. This breaks the current inverted dependency (telemetry importing from session-manager for a constant that has nothing to do with sessions).

Pre-condition: **VERIFIED** — `telemetry.js` line 3 imports only `MODEL_CTX_LIMITS` from session-manager. Move is clean. No `constants.js` needed.

**Gap 8 — Branch strategy:**
Execute on `git checkout -b chat-pipeline-refactor` off main. One commit per phase. Merge only after visual smoke-test passes. Rollback: `git checkout main`.

**Gap 9 — Phase-level smoke-test checklists:**

*Phase 1 (after extracting tool-renderer.js + mcp-cards.js + MODEL_CTX_LIMITS relocation):*
- [ ] Tool blocks render in chat (run a tool-using prompt)
- [ ] Memory card appears on a memory write
- [ ] MCP auth/permission card renders correctly
- [ ] Permission approval card renders on a `.claude/` edit
- [ ] Context bar shows token count during and after a response (validates MODEL_CTX_LIMITS move)
- [ ] Existing sessions stream without regression

*Phase 2 (after chat-pane factory):*
- [ ] Session chat pane renders and sends
- [ ] Agent chat pane renders and sends
- [ ] Mode toggle (chat ↔ terminal) works in both pane types
- [ ] Attachment drag-drop / paste / file-pick works; chip × removes file
- [ ] Slash menu opens on `/`
- [ ] Session timer shows on session panes, absent on agent panes
- [ ] Send button disables during streaming, re-enables after
- [ ] Verify on Windows (Marc Cooper) before merging — DOM/event behavior can diverge on Electron/Win

**Gap 10 — Attention system:** Confirmed out of scope. `needsAttention` is set inside `wireChatListeners`, which stays in session-manager. Agent panes import `wireChatListeners` from session-manager unchanged. No action needed.

**Gap 13 — Slash menu: factory takes `onSlashCommand` callback; does NOT import `slash-menu.js`.**
The factory detects the `/` keydown, reads the input value, and calls `onSlashCommand(command, id)`. The caller passes its existing slash-menu.js invocation as the implementation. This keeps chat-pane.js free of any transitive dependency on session-manager.

```js
createChatPane(id, {
  onSlashCommand: (command, id) => openSlashMenu(command, id),  // caller wires slash-menu.js
  ...
})
```

**Gap 14 — `onModeToggle` vs `toggleSessionMode` relationship:**
`onModeToggle` is the factory callback that fires when the user clicks the mode toggle button. The caller passes `(id) => toggleSessionMode(id)` as its value. `toggleSessionMode` remains on session-manager's public surface — it's not renamed or moved. They are the same operation; `onModeToggle` is just the factory's hook into it.

**Gap 11 — Line count estimate:** Corrected to `~900 lines` (1,678 − 630 tool/MCP − 180 pane duplication + ~30 new imports/wiring = ~898).

**Gap 12 — split-pane-manager DOM assumptions:** Before Phase 2, grep `split-pane-manager.js` for hardcoded class names, IDs, or DOM selectors referencing chat pane structure. Verify they hold after `createChatPane` produces the pane DOM.
