# Chat Pipeline Refactor — Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Extract `tool-renderer.js`, `mcp-cards.js`, and `chat-pane.js` from `session-manager.js` and `agent-manager.js`, eliminating ~180 lines of DOM/wiring duplication and shrinking session-manager from 1,678 → ~900 lines.

**Architecture:** Three-phase extraction on a dedicated branch. Phase 1a/1b = pure function moves with `s`-first parameter convention. Phase 1c = `MODEL_CTX_LIMITS` relocation. Phase 2 = chat-pane factory (DOM template + input/send/mode-toggle wiring). Each phase commits independently. Zero behavioral changes.

**Tech Stack:** Vanilla ES modules, Electron renderer process. No test framework — all verification is manual via `npm start` + DevTools. Attachment wiring stays in callers (attachment-handler writes to `session.pendingAttachments` directly; that coupling is deferred to a future cleanup).

**Design doc:** `ace-desktop/docs/plans/2026-04-18-chat-pipeline-refactor-design.md`

---

## Task 0: Branch + Pre-flight

**Files:** none

### Step 1: Create the branch
```bash
cd /Users/nikhilkale/Documents/Actualize/ace-desktop
git checkout -b chat-pipeline-refactor
```

### Step 2: Verify `split-pane-manager.js` DOM assumptions
```bash
grep -n "chat-view\|chat-msgs\|chat-input\|chat-send\|term-pane\|term-hdr\|xterm-\|scroll-btn\|stab" renderer/modules/split-pane-manager.js
```
Record any hardcoded class names or IDs. These must survive unchanged through Phase 2.

### Step 3: Confirm telemetry pre-condition (already verified — log it)
```bash
grep -n "from.*session-manager" renderer/modules/telemetry.js
```
Expected: `3:import { MODEL_CTX_LIMITS } from './session-manager.js'` — one import only. Clean to move.

---

## Phase 1a — Extract `tool-renderer.js`

## Task 1: Create `tool-renderer.js` and cut functions from session-manager

**Files:**
- Create: `ace-desktop/renderer/modules/tool-renderer.js`
- Modify: `ace-desktop/renderer/modules/session-manager.js` (lines 260–497, 1127–1198)

### Step 1: Create the file with imports
```js
// renderer/modules/tool-renderer.js
import { escapeHtml, syntaxHighlight, SANITIZE_CONFIG } from './chat-renderer.js'
```

### Step 2: Cut these blocks from `session-manager.js` and paste into `tool-renderer.js`

| Function | session-manager.js lines | Export? |
|---|---|---|
| `isMemoryWritePath` | 260–268 | no (private) |
| `parseMemoryFrontmatter` | 269–296 | no (private) |
| `renderMemoryCard` | 297–320 | no (private) |
| `appendToolBlock` | 321–379 | yes |
| `appendToolInput` | 380–467 | yes |
| `updateActivityIndicator` | 468–488 | yes |
| `clearActivityIndicator` | 489–497 | yes |
| `renderQuestionCard` | 1127–1198 | yes |

### Step 3: Update function signatures — `(id, ..., sessionsObj)` → `(s, ...)`

Every function that starts with `const s = sessionsObj[id]` gets that line removed and `s` added as the first parameter. Apply to all four exported functions:

```js
// appendToolBlock — before
export function appendToolBlock(id, toolInfo, sessionsObj) {
  const s = sessionsObj[id]
  if (!s) return

// appendToolBlock — after
export function appendToolBlock(s, toolInfo) {
  if (!s) return
```

Same pattern for `appendToolInput`, `updateActivityIndicator`, `clearActivityIndicator`, `renderQuestionCard`.

The three private helpers (`isMemoryWritePath`, `parseMemoryFrontmatter`, `renderMemoryCard`) take no session state — leave signatures unchanged.

### Step 4: Add import to `session-manager.js`
```js
import { appendToolBlock, appendToolInput, updateActivityIndicator, clearActivityIndicator, renderQuestionCard } from './tool-renderer.js'
```

### Step 5: Update all call sites in `session-manager.js`

Find them:
```bash
grep -n "appendToolBlock\|appendToolInput\|updateActivityIndicator\|clearActivityIndicator\|renderQuestionCard" renderer/modules/session-manager.js
```

For each call site, replace `(id, ..., sessionsObj)` with `(s, ...)`. `s` is always available in context (`const s = sessionsObj[id]` already exists nearby in `wireChatListeners`). Examples:

```js
// wireChatListeners, ~line 658
appendToolBlock(id, e.content_block, sessionsObj)  →  appendToolBlock(s, e.content_block)

// wireChatListeners, ~line 661
clearActivityIndicator(id, sessionsObj)  →  clearActivityIndicator(s)

// wireChatListeners, ~line 702
appendToolInput(id, e.delta.partial_json, sessionsObj)  →  appendToolInput(s, e.delta.partial_json)

// wireChatListeners, ~line 734 (inside renderPermissionApprovalCard call path)
// updateActivityIndicator call sites: ~lines 345, 376, 393, 450
```

> **Critical call site outside wireChatListeners:** `finalizeMessage` (~line 227) also calls `clearActivityIndicator(id, sessionsObj)`. This is on the hot path — every response completion goes through it. The grep will surface it; do not skip it. Update to `clearActivityIndicator(s)` where `s = sessionsObj[id]` is resolved at the top of `finalizeMessage`.

### Step 6: Verify
```bash
npm start
```
- Run a tool-using prompt in ACE chat
- Confirm tool blocks render (spinner → result)
- Confirm memory cards appear on a memory write
- No console errors in DevTools

### Step 7: Commit
```bash
git add renderer/modules/tool-renderer.js renderer/modules/session-manager.js
git commit -m "refactor: extract tool-renderer.js from session-manager"
```

---

## Phase 1b — Extract `mcp-cards.js`

## Task 2: Create `mcp-cards.js` and cut MCP functions from session-manager

**Files:**
- Create: `ace-desktop/renderer/modules/mcp-cards.js`
- Modify: `ace-desktop/renderer/modules/session-manager.js` (lines 817–1126)

### Step 1: Create the file
```js
// renderer/modules/mcp-cards.js
import { escapeHtml } from './chat-renderer.js'
```

### Step 2: Cut these blocks from `session-manager.js` and paste into `mcp-cards.js`

| Function | session-manager.js lines | Export? |
|---|---|---|
| `mcpEsc` | 817–820 | no (private) |
| `resetMcpAuth` | 821–849 | no (private) |
| `renderMcpEventCard` | 850–940 | yes |
| `renderPermissionApprovalCard` | 941–1024 | yes |
| `renderMcpPermissionCard` | 1025–1126 | yes |

### Step 3: Update signatures for `renderPermissionApprovalCard` and `renderMcpPermissionCard`

Both currently take `(chatId, denials, sessionsObj)` and do `const s = sessionsObj[chatId]`. Update to `(s, chatId, denials)`:

```js
// before
function renderPermissionApprovalCard(chatId, denials, sessionsObj) {
  const s = sessionsObj[chatId]

// after
export function renderPermissionApprovalCard(s, chatId, denials) {
```

`renderMcpEventCard` takes `(msgsEl, chatId, evt)` — no session state. Leave signature unchanged, add `export`.

### Step 4: Add import to `session-manager.js`
```js
import { renderMcpEventCard, renderPermissionApprovalCard, renderMcpPermissionCard } from './mcp-cards.js'
```

### Step 5: Update call sites in `session-manager.js`

Find them:
```bash
grep -n "renderMcpEventCard\|renderPermissionApprovalCard\|renderMcpPermissionCard" renderer/modules/session-manager.js
```
Expected locations: inside `wireChatListeners`, approximately lines 734, 740, 786.

```js
// before
renderPermissionApprovalCard(id, claudeEdits, sessionsObj)
renderMcpPermissionCard(id, mcpDenials, sessionsObj)
renderMcpEventCard(msgsEl, id, parsed)

// after
renderPermissionApprovalCard(s, id, claudeEdits)
renderMcpPermissionCard(s, id, mcpDenials)
renderMcpEventCard(msgsEl, id, parsed)  // unchanged
```

### Step 6: Verify
```bash
npm start
```
- Trigger an MCP auth/permission card (connect an MCP server or attempt a restricted tool)
- Trigger a `.claude/` permission approval card (attempt a file edit requiring permission)
- Confirm cards render; approve/deny buttons work
- No console errors

### Step 7: Commit
```bash
git add renderer/modules/mcp-cards.js renderer/modules/session-manager.js
git commit -m "refactor: extract mcp-cards.js from session-manager"
```

---

## Phase 1c — Relocate `MODEL_CTX_LIMITS`

## Task 3: Move `MODEL_CTX_LIMITS` from `session-manager.js` to `telemetry.js`

**Files:**
- Modify: `ace-desktop/renderer/modules/telemetry.js`
- Modify: `ace-desktop/renderer/modules/session-manager.js`

### Step 1: Update `telemetry.js`

Remove the import line (line 3):
```js
// DELETE:
import { MODEL_CTX_LIMITS } from './session-manager.js'
```

Add the constant definition after any remaining imports:
```js
export const MODEL_CTX_LIMITS = { opus: 1_000_000, sonnet: 200_000, haiku: 200_000 }
```

### Step 2: Update `session-manager.js`

Remove the constant definition (line 14):
```js
// DELETE:
export const MODEL_CTX_LIMITS = { opus: 1_000_000, sonnet: 200_000, haiku: 200_000 }
```

Add import at the top with other imports:
```js
import { MODEL_CTX_LIMITS } from './telemetry.js'
```

### Step 3: Verify
```bash
npm start
```
- Send a message and confirm the context bar updates with token percentage after the response
- Cost and token counts update normally
- No console errors

### Step 4: Commit
```bash
git add renderer/modules/telemetry.js renderer/modules/session-manager.js
git commit -m "refactor: move MODEL_CTX_LIMITS from session-manager to telemetry"
```

---

## Task 4: Phase 1 Full Smoke Test

Run before starting Phase 2. Fix any failures in this branch before proceeding.

- [ ] Tool blocks render in chat (run a tool-using prompt)
- [ ] Memory card appears on a memory write
- [ ] MCP auth/permission card renders correctly
- [ ] Permission approval card renders on a `.claude/` edit
- [ ] Context bar shows token % during and after a response (validates MODEL_CTX_LIMITS move)
- [ ] Existing sessions stream without regression

```bash
wc -l renderer/modules/session-manager.js
```
Expected: ~1,050 lines after Phase 1.

---

## Phase 2 — Extract `chat-pane.js`

## Task 5: Pre-check before touching DOM

### Step 1: Audit `split-pane-manager.js` class/ID references from Task 0
Review your Task 0 Step 2 grep output. Any IDs like `pane-${id}`, `tab-${id}`, class names like `term-pane`, `stab` must be preserved verbatim in the factory's DOM output. Note any that the factory needs to match.

### Step 2: Confirm slash-menu import alias
```bash
grep "from.*slash-menu" renderer/modules/session-manager.js
```
Expected: `import { attach as attachSlashMenu } from './slash-menu.js'`

The factory will use the same import. `slash-menu.js` imports only from `command-registry.js` — no cycle risk confirmed.

---

## Task 6: Create `chat-pane.js`

**Files:**
- Create: `ace-desktop/renderer/modules/chat-pane.js`

### Step 1: Write the full file

```js
// renderer/modules/chat-pane.js
import { state } from '../state.js'
import { aceMarkSvg } from './ace-mark.js'
import { attach as attachSlashMenu } from './slash-menu.js'

/**
 * Factory: creates a full chat pane DOM element with wired event handlers.
 * Returns controls object. Caller assigns pane/tab to session state after this call.
 *
 * Attachment wiring (wireDropZone, wirePasteHandler, pickAndStage) is NOT handled here —
 * those functions write to session.pendingAttachments directly and must be wired by the
 * caller after session state is initialized.
 *
 * @param {string} id
 * @param {object} config
 * @param {string}   config.paneClass        'term-pane' | 'apane'
 * @param {string}   [config.roleName]       Label shown in header. Default: 'ACE'
 * @param {boolean}  [config.showTimer]      Render timer controls. Default: false
 * @param {boolean}  [config.showMoveButton] Render move-pane arrow on tab. Default: false
 * @param {string}   [config.moveDirection]  '→' or '←'. Default: '→'
 * @param {string}   [config.placeholder]    Textarea placeholder. Default: 'Message ACE...'
 * @param {boolean}  [config.attachSlash]    Wire slash menu. Default: true
 * @param {Element}  config.containerEl      Where to append the pane DOM
 * @param {Element}  [config.tabBarEl]       Where to append .stab tab. null for agents.
 * @param {Function} config.onSend           (id, prompt) => void
 * @param {Function} [config.onClose]        (id) => void
 * @param {Function} [config.onModeToggle]   (id) => void  caller handles DOM + state
 * @param {Function} [config.onTerminalInit] (xtermEl) => void  called once on first toggle
 * @returns {{ pane, tab, chatInput, sendBtn, destroy, setStreaming }}
 */
export function createChatPane(id, config = {}) {
  const {
    paneClass = 'term-pane',
    roleName = 'ACE',
    showTimer = false,
    showMoveButton = false,
    moveDirection = '→',
    placeholder = 'Message ACE...',
    attachSlash = true,
    containerEl,
    tabBarEl,
    onSend,
    onClose,
    onModeToggle,
    onTerminalInit,
  } = config

  const isAgent = paneClass === 'apane'

  // ── Pane DOM ──────────────────────────────────────────────────────────────
  const pane = document.createElement('div')
  pane.className = paneClass
  pane.id = 'pane-' + id

  const header = isAgent
    ? `<div class="apane-tab" id="aptab-${id}">
        <div class="ap-dot waiting"></div>
        <span class="ap-role">${roleName}</span>
        <span class="ap-name-label">${id.slice(-6)}</span>
        <span class="ap-task-label" id="ap-task-${id}">starting…</span>
        <button class="mode-toggle-btn" id="mode-toggle-${id}">Terminal</button>
        <span class="ap-tokens" id="ap-tokens-${id}">↑ 0 lines</span>
        <span class="ap-time-label" id="ap-time-${id}">0:00</span>
        <span class="ap-close-btn" id="ap-close-${id}">×</span>
       </div>`
    : `<div class="term-hdr">
        <div class="term-hdr-dot" style="background:var(--green);box-shadow:0 0 7px rgba(109,184,143,0.5)"></div>
        <div class="term-hdr-label" id="hdr-label-${id}">ACE Session</div>
        <button class="mode-toggle-btn" id="mode-toggle-${id}">Terminal</button>
        <div class="term-hdr-path" id="hdr-path-${id}">Chat Mode</div>
        ${showTimer ? `
        <span class="session-timer" id="session-timer-${id}" style="display:none"></span>
        <select class="session-duration-select" id="session-duration-${id}" title="Set session timer" data-learn-target="session-timer">
          <option value="">Timer</option>
          <option value="15">15m</option>
          <option value="30">30m</option>
          <option value="60">60m</option>
          <option value="90">90m</option>
        </select>` : ''}
       </div>`

  pane.innerHTML = header + `
    <div class="chat-view" id="chat-view-${id}">
      <div class="chat-messages" id="chat-msgs-${id}">
        <div class="chat-welcome">
          <div class="chat-welcome-icon">${aceMarkSvg(36)}</div>
          <div class="chat-welcome-text">${roleName} Chat</div>
          <div class="chat-welcome-sub">Enter to send · Shift+Enter for newline · Type a message below</div>
        </div>
      </div>
      <div class="chat-status" id="chat-status-${id}">
        <span class="chat-cost-label">$0.00</span>
        <span class="chat-tokens-label">0 tokens</span>
        <div class="ctx-bar" id="ctx-bar-${id}" title="Context usage" data-learn-target="ctx-bar">
          <div class="ctx-bar-fill" id="ctx-fill-${id}"></div>
        </div>
        <span class="ctx-bar-pct" id="ctx-label-${id}">0%</span>
      </div>
      <div class="chat-controls" id="chat-controls-${id}">
        <select class="chat-select" id="chat-model-${id}" title="Model">
          <option value="opus" ${state.chatDefaults.model === 'opus' ? 'selected' : ''}>Opus</option>
          <option value="sonnet" ${state.chatDefaults.model === 'sonnet' ? 'selected' : ''}>Sonnet</option>
          <option value="haiku" ${state.chatDefaults.model === 'haiku' ? 'selected' : ''}>Haiku</option>
        </select>
        <select class="chat-select" id="chat-perms-${id}" title="Permission mode">
          <option value="default" ${state.chatDefaults.permissions === 'default' ? 'selected' : ''}>Normal</option>
          <option value="plan" ${state.chatDefaults.permissions === 'plan' ? 'selected' : ''}>Plan</option>
          <option value="auto" ${state.chatDefaults.permissions === 'auto' ? 'selected' : ''}>Auto-accept</option>
        </select>
        <select class="chat-select" id="chat-effort-${id}" title="Reasoning effort">
          <option value="low" ${state.chatDefaults.effort === 'low' ? 'selected' : ''}>Low effort</option>
          <option value="medium" ${state.chatDefaults.effort === 'medium' ? 'selected' : ''}>Medium</option>
          <option value="high" ${state.chatDefaults.effort === 'high' ? 'selected' : ''}>High</option>
          <option value="max" ${state.chatDefaults.effort === 'max' ? 'selected' : ''}>Max effort</option>
        </select>
      </div>
      <div class="chat-attachments" id="chat-attachments-${id}"></div>
      <div class="chat-input-area">
        <button class="chat-attach-btn" id="chat-attach-${id}" title="Attach · drag, paste, or click" aria-label="Attach file">
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21.44 11.05l-9.19 9.19a6 6 0 0 1-8.49-8.49l9.19-9.19a4 4 0 0 1 5.66 5.66l-9.2 9.19a2 2 0 0 1-2.83-2.83l8.49-8.49"/></svg>
        </button>
        <textarea class="chat-input" id="chat-input-${id}" data-learn-target="chat-composer" placeholder="${placeholder}" rows="1"></textarea>
        <button class="chat-send-btn" id="chat-send-${id}" data-learn-target="send-button">↑</button>
      </div>
    </div>
    <div class="term-xterm" id="xterm-${id}" style="display:none"></div>
    <button class="scroll-to-bottom" id="scroll-btn-${id}" title="Scroll to bottom" style="display:none">↓</button>`

  if (containerEl) containerEl.appendChild(pane)

  // ── Tab DOM (sessions only) ───────────────────────────────────────────────
  let tab = null
  if (tabBarEl) {
    tab = document.createElement('div')
    tab.className = 'stab'
    tab.id = 'tab-' + id
    tab.innerHTML = `<div class="stab-dot"></div>` +
      `<span class="stab-label" id="tab-label-${id}">${roleName}</span>` +
      (showMoveButton ? `<span class="stab-move" id="stab-move-${id}" title="Move to other pane">${moveDirection}</span>` : '') +
      `<span class="stab-close" id="stab-close-${id}" title="Close session">×</span>`
    const addBtn = tabBarEl.querySelector('.stab-add')
    tabBarEl.insertBefore(tab, addBtn)
  }

  // ── Element refs ──────────────────────────────────────────────────────────
  const inputEl  = document.getElementById('chat-input-'  + id)
  const sendBtn  = document.getElementById('chat-send-'   + id)
  const xtermEl  = document.getElementById('xterm-'       + id)

  // ── Slash menu ────────────────────────────────────────────────────────────
  if (attachSlash) {
    attachSlashMenu(inputEl, { send: (prompt) => onSend?.(id, prompt) })
  }

  // ── Input: auto-grow + send on Enter + cancel on Escape ──────────────────
  inputEl.addEventListener('keydown', e => {
    if (e.key === 'Enter' && !e.shiftKey && !e.__slashMenuHandled) {
      e.preventDefault()
      const prompt = inputEl.value.trim()
      if (!prompt) return
      inputEl.value = ''
      inputEl.style.height = 'auto'
      onSend?.(id, prompt)
    }
    if (e.key === 'Escape' && !e.__slashMenuHandled) {
      window.ace.chat.cancel(id)
    }
  })

  inputEl.addEventListener('input', () => {
    inputEl.style.height = 'auto'
    inputEl.style.height = Math.min(inputEl.scrollHeight, 150) + 'px'
  })

  sendBtn.addEventListener('click', () => {
    const prompt = inputEl.value.trim()
    if (!prompt) { window.ace.chat.cancel(id); return }
    inputEl.value = ''
    inputEl.style.height = 'auto'
    onSend?.(id, prompt)
  })

  // ── Close buttons ─────────────────────────────────────────────────────────
  document.getElementById('stab-close-' + id)?.addEventListener('click', e => {
    e.stopPropagation(); onClose?.(id)
  })
  document.getElementById('ap-close-' + id)?.addEventListener('click', e => {
    e.stopPropagation(); onClose?.(id)
  })

  // ── Mode toggle ───────────────────────────────────────────────────────────
  // Factory fires onTerminalInit on first toggle, then delegates all DOM/state
  // work to the onModeToggle callback (toggleSessionMode / toggleAgentMode).
  let terminalInited = false
  document.getElementById('mode-toggle-' + id)?.addEventListener('click', e => {
    e.stopPropagation()
    if (!terminalInited && xtermEl) {
      terminalInited = true
      onTerminalInit?.(xtermEl)
    }
    onModeToggle?.(id)
  })

  // ── setStreaming ──────────────────────────────────────────────────────────
  function setStreaming(active) {
    sendBtn.disabled = active
    sendBtn.classList.toggle('streaming', active)
    if (!active) {
      sendBtn.textContent = '↑'
      sendBtn.classList.remove('cancel')
    }
  }

  // ── Destroy ───────────────────────────────────────────────────────────────
  function destroy() {
    pane.remove()
    tab?.remove()
  }

  return { pane, tab, chatInput: inputEl, sendBtn, destroy, setStreaming }
}
```

### Step 2: Verify file loads
```bash
npm start
```
App opens, no import errors. Factory is not called yet — existing behavior unchanged.

---

## Task 7: Update `session-manager.spawnSession` to use `createChatPane`

**Files:**
- Modify: `ace-desktop/renderer/modules/session-manager.js`

### Step 1: Add import at top of session-manager.js
```js
import { createChatPane } from './chat-pane.js'
```

### Step 2: Replace pane + tab DOM construction in `spawnSession`

In `spawnSession` (line 1219), find the block that starts at:
```js
const pane = document.createElement('div')
pane.className = 'term-pane'; pane.id = 'pane-' + id
pane.innerHTML = `...`
```
and ends after:
```js
targetTabBar.insertBefore(tab, addBtn)
```
(approximately lines 1232–1304).

Replace the entire block with:
```js
  const targetContainer = opts?.container || document.getElementById('pane-content-left')
  const targetTabBar    = opts?.tabBar    || document.getElementById('session-tabs-left')
  const moveArrow = targetContainer.id === 'pane-content-right' ? '←' : '→'
  const smartPlaceholder = window.__preflightResult?.binary?.ok && window.__preflightResult?.vault?.ok
    ? 'Type /start to begin your day'
    : 'Message ACE...'

  const controls = createChatPane(id, {
    paneClass: 'term-pane',
    roleName: 'ACE',
    showTimer: true,
    showMoveButton: true,
    moveDirection: moveArrow,
    placeholder: smartPlaceholder,
    containerEl: targetContainer,
    tabBarEl: targetTabBar,
    onSend:         (id, prompt) => sendChatMessage(id, prompt),
    onClose:        (id)         => closeSession(id),
    onModeToggle:   (id)         => toggleSessionMode(id),
    onTerminalInit: (xtermEl)    => _initSessionTerminal(id, xtermEl),
  })

  const { pane, tab } = controls
```

### Step 3: Add `_paneControls` to session state init

Find `state.sessions[id] = {` (approximately line 1306). Add `_paneControls: controls,` as the last field before the closing `}`:
```js
  state.sessions[id] = {
    term: null, fitAddon: null, pane, tab,
    // ... all existing fields ...
    _paneControls: controls,  // holds chatInput, sendBtn, destroy, setStreaming
  }
```

### Step 4: Remove duplicate event wiring from `spawnSession`

Delete the following blocks (they are now handled by `createChatPane`):

```
// DELETE: attachSlashMenu call (~line 1368)
attachSlashMenu(inputEl, { send: ... })

// DELETE: inputEl.addEventListener('keydown', ...) block (~lines 1370–1384)
// DELETE: inputEl.addEventListener('input', resetPlaceholder) block (~lines 1386–1391)
// DELETE: inputEl.addEventListener('input', () => { resize + cancel toggle }) (~lines 1392–1401)
// DELETE: sendBtn.addEventListener('click', ...) block (~lines 1403–1413)
// DELETE: mode-toggle click handler (~lines 1427–1429)
document.getElementById('mode-toggle-' + id).addEventListener('click', () => {
  toggleSessionMode(id)
})
```

Also delete the local `const inputEl` and `const sendBtn` declarations if they are no longer referenced after the above deletions.

**Keep all of the following (these are session-specific and NOT moving to the factory):**
```
// KEEP: model change listener
document.getElementById('chat-model-' + id)?.addEventListener('change', ...)

// KEEP: ctx-bar click → resetContext
document.getElementById('ctx-bar-' + id)?.addEventListener('click', ...)

// KEEP: stab-close click → closeSession (already wired in factory via onClose — verify not doubled)
// If factory wires it via onClose, remove the explicit session-manager version to avoid double-fire.

// KEEP: stab-move click → moveToOtherGroup
document.getElementById('stab-move-' + id)?.addEventListener('click', ...)

// KEEP: session-duration change → startTimer
document.getElementById('session-duration-' + id)?.addEventListener('change', ...)

// KEEP: tab outer click → activateSession (factory returns tab DOM but does NOT wire this)
tab.addEventListener('click', e => {
  if (!e.target.classList.contains('stab-close') && !e.target.classList.contains('stab-move'))
    activateSession(id)
})

// KEEP: cancel-toggle on input during streaming (factory input listener only resizes)
// Add this AFTER state init so state.sessions[id] exists:
inputEl.addEventListener('input', () => {
  if (state.sessions[id]?.isStreaming) {
    const hasText = inputEl.value.trim().length > 0
    sendBtn.textContent = hasText ? '↑' : '■'
    sendBtn.classList.toggle('cancel', !hasText)
  }
})
// inputEl/sendBtn refs: get from controls.chatInput / controls.sendBtn after factory call

// KEEP: resetPlaceholder — one-time input listener to clear the smart placeholder on first keystroke
// (factory uses a static placeholder; smartPlaceholder from preflight never auto-resets otherwise)
// Wire using same inputEl ref (controls.chatInput) as cancel-toggle above:
inputEl.addEventListener('input', function resetPlaceholder() {
  if (inputEl.placeholder !== 'Message ACE...') {
    inputEl.placeholder = 'Message ACE...'
    inputEl.removeEventListener('input', resetPlaceholder)
  }
})

// KEEP: attachment wiring (AFTER state init)
const attachBtn = document.getElementById('chat-attach-' + id)
if (attachBtn) attachBtn.addEventListener('click', () => pickAndStage(state.sessions[id], id))
wireDropZone(state.sessions[id], id)
wirePasteHandler(state.sessions[id], id)

// KEEP: wireChatListeners(id)
// KEEP: activateSession(id)
// KEEP: resumeId terminal auto-switch
```

> **Note on close button:** The factory wires `stab-close-${id}` via `onClose`. If `spawnSession` also wires it, there will be a double-fire. Remove any explicit `stab-close` listener from `spawnSession` — the factory's `onClose: (id) => closeSession(id)` handles it.

### Step 5: Extract `_initSessionTerminal` private helper

The first-time xterm init block currently lives inside `toggleSessionMode`. Extract it:

```js
function _initSessionTerminal(id, xtermEl) {
  const s = state.sessions[id]
  if (!s) return
  const scrollBtn = document.getElementById('scroll-btn-' + id)
  const term = new Terminal({
    fontFamily: '"JetBrains Mono", "Fira Code", monospace',
    fontSize: 12.5, lineHeight: 1.5, cursorBlink: true,
    theme: xtermTheme(), allowProposedApi: true,
  })
  const fitAddon = new FitAddon.FitAddon()
  term.loadAddon(fitAddon)
  s.term = term
  s.fitAddon = fitAddon

  let userScrolledUp = false
  requestAnimationFrame(() => {
    term.open(xtermEl)
    fitAddon.fit()
    if (s.resumeId) {
      window.ace.pty.resume(id, s.resumeCwd, term.cols, term.rows, s.resumeId)
    } else {
      window.ace.pty.create(id, null, term.cols, term.rows)
    }
    term.onScroll(() => {
      userScrolledUp = term.buffer.active.viewportY < term.buffer.active.baseY
      scrollBtn?.classList.toggle('visible', userScrolledUp)
    })
    term.buffer.onBufferChange(() => {
      requestAnimationFrame(() => { term.scrollToBottom(); userScrolledUp = false; scrollBtn?.classList.toggle('visible', false) })
    })
  })
  scrollBtn?.addEventListener('click', () => {
    term.scrollToBottom(); userScrolledUp = false; scrollBtn.classList.toggle('visible', false)
  })
  window.ace.pty.onData(id, data => {
    const wasAtBottom = !userScrolledUp
    term.write(data, () => { if (wasAtBottom) term.scrollToBottom() })
  })
  term.onData(d => window.ace.pty.write(id, d))
  term.onResize(({ cols, rows }) => window.ace.pty.resize(id, cols, rows))
}
```

Then simplify the existing `toggleSessionMode` to remove the `if (!s.term) { ... }` block (which is now `_initSessionTerminal`) — the factory fires `onTerminalInit` on first toggle, so by the time `toggleSessionMode` runs, the terminal is being initialized asynchronously. `toggleSessionMode` still handles mode state and `fitAddon.fit()`.

### Step 6: Add `setStreaming` calls at the two `isStreaming` flip sites

```bash
grep -n "isStreaming" renderer/modules/session-manager.js
```
Expected flip sites: line ~84 (true, inside `sendChatMessage`) and line ~196 (false, inside `finalizeMessage`).

```js
// sendChatMessage, where isStreaming = true:
s.isStreaming = true
s._paneControls?.setStreaming(true)

// finalizeMessage, where isStreaming = false:
s.isStreaming = false
s._paneControls?.setStreaming(false)
```

### Step 7: Verify
```bash
npm start
```
- Open a session — pane and tab render correctly
- Send a message — input clears, stream renders, send button disables during streaming and re-enables after
- Slash menu opens on `/`
- Mode toggle switches to terminal; terminal works
- Timer select starts countdown
- Context bar updates token %

---

## Task 8: Update `agent-manager.spawnAgentPane` to use `createChatPane`

**Files:**
- Modify: `ace-desktop/renderer/modules/agent-manager.js`

### Step 1: Add import
```js
import { createChatPane } from './chat-pane.js'
```

### Step 2: Replace pane DOM block in `spawnAgentPane`

In `spawnAgentPane` (line 68), replace from:
```js
const pane = document.createElement('div')
pane.className = 'apane'; pane.id = 'pane-' + id
pane.innerHTML = `...`
```
through the end of the `pane.innerHTML` template (lines 77–134) with:

```js
  const controls = createChatPane(id, {
    paneClass: 'apane',
    roleName,
    showTimer: false,
    showMoveButton: false,
    containerEl: null,        // appended manually below due to row logic
    tabBarEl: null,           // agents use roster sidebar, not tab bar
    attachSlash: false,       // agents don't use slash commands
    onSend:         (id, prompt) => sendChatMessage(id, prompt, state.agentSessions),
    onClose:        (id)         => closeAgentPane(id),
    onModeToggle:   (id)         => toggleAgentMode(id),
    onTerminalInit: (xtermEl)    => _initAgentTerminal(id, xtermEl),
  })

  const { pane } = controls
```

Note `containerEl: null` — the pane is appended after the factory call using the existing row logic:
```js
;(isTop ? topEl : botEl).appendChild(pane)
```
This line already exists in `spawnAgentPane` and stays unchanged.

### Step 2b: Update `toggleAgentMode` to query the new button ID

The factory emits `id="mode-toggle-${id}"` for all pane types. The current `toggleAgentMode` queries `agent-mode-toggle-${id}` (line 230). Update it:

```js
// before (agent-manager.js line 230)
const toggleBtn = document.getElementById('agent-mode-toggle-' + id)

// after
const toggleBtn = document.getElementById('mode-toggle-' + id)
```

### Step 3: Add `_paneControls` to agent session state

Find `state.agentSessions[id] = {` (line 154). Add `_paneControls: controls,` as the last field:
```js
  state.agentSessions[id] = {
    term: null, fitAddon: null, pane, rosterItem: arItem, role: roleName,
    // ... all existing fields ...
    _paneControls: controls,
  }
```

### Step 4: Remove duplicate event wiring from `spawnAgentPane`

Delete these blocks (now handled by `createChatPane`):

```
// DELETE: const inputEl = document.getElementById('chat-input-' + id)
// DELETE: const sendBtn = document.getElementById('chat-send-' + id)
// DELETE: inputEl.addEventListener('keydown', ...) block (~lines 168–179)
// DELETE: inputEl.addEventListener('input', ...) block (~lines 180–188)
// DELETE: sendBtn.addEventListener('click', ...) block (~lines 189–195)
// DELETE: agent mode-toggle click handler (~lines 209–212)
document.getElementById('agent-mode-toggle-' + id).addEventListener('click', (e) => {
  e.stopPropagation()
  toggleAgentMode(id)
})
```

**Keep:**
```
// KEEP: cancel-toggle on input during streaming (factory input listener only resizes)
// Add AFTER state init so state.agentSessions[id] exists:
inputEl.addEventListener('input', () => {
  if (state.agentSessions[id]?.isStreaming) {
    const hasText = inputEl.value.trim().length > 0
    sendBtn.textContent = hasText ? '↑' : '■'
    sendBtn.classList.toggle('cancel', !hasText)
  }
})
// inputEl/sendBtn refs: get from controls.chatInput / controls.sendBtn after factory call

// KEEP: attachment wiring (AFTER state init — attachment-handler needs session object)
const attachBtn = document.getElementById('chat-attach-' + id)
if (attachBtn) attachBtn.addEventListener('click', () => pickAndStage(state.agentSessions[id], id))
wireDropZone(state.agentSessions[id], id)
wirePasteHandler(state.agentSessions[id], id)

// KEEP: wireChatListeners(id, state.agentSessions)
// KEEP: ap-close click → closeAgentPane  ← factory wires this via onClose; REMOVE explicit version
// KEEP: aptab click → focusAgentPane
// KEEP: focusAgentPane(id)
// KEEP: refreshAgentsLayout()
```

> **Note on ap-close:** Factory wires `ap-close-${id}` via `onClose`. Remove the explicit `document.getElementById('ap-close-' + id).addEventListener(...)` from `spawnAgentPane` to avoid double-fire.

### Step 5: Extract `_initAgentTerminal` private helper

Same pattern as Task 7 Step 5. Extract the first-time xterm init from `toggleAgentMode`'s `if (!s.term)` branch:

```js
function _initAgentTerminal(id, xtermEl) {
  const s = state.agentSessions[id]
  if (!s) return
  const scrollBtn = document.getElementById('scroll-btn-' + id)
  const term = new Terminal({
    fontFamily: '"JetBrains Mono", "Fira Code", monospace',
    fontSize: 12.5, lineHeight: 1.5, cursorBlink: true,
    theme: xtermTheme(), allowProposedApi: true,
  })
  const fitAddon = new FitAddon.FitAddon()
  term.loadAddon(fitAddon)
  s.term = term; s.fitAddon = fitAddon

  let agentUserScrolledUp = false
  requestAnimationFrame(() => {
    term.open(xtermEl)
    fitAddon.fit()
    window.ace.pty.create(id, null, term.cols, term.rows).then(() => {
      if (!state.agentSessions[id]) return
      state.agentSessions[id].status = 'running'
      document.getElementById('ap-task-' + id).textContent = 'ready'
      updateAgentDots(id)
    })
    term.onScroll(() => {
      agentUserScrolledUp = term.buffer.active.viewportY < term.buffer.active.baseY
      scrollBtn?.classList.toggle('visible', agentUserScrolledUp)
    })
    term.buffer.onBufferChange(() => {
      requestAnimationFrame(() => { term.scrollToBottom(); agentUserScrolledUp = false; scrollBtn?.classList.toggle('visible', false) })
    })
  })
  scrollBtn?.addEventListener('click', () => {
    term.scrollToBottom(); agentUserScrolledUp = false; scrollBtn.classList.toggle('visible', false)
  })
  window.ace.pty.onData(id, data => {
    if (!state.agentSessions[id]) return
    const wasAtBottom = !agentUserScrolledUp
    term.write(data, () => { if (wasAtBottom) term.scrollToBottom() })
    const newlines = (data.match(/\n/g) || []).length
    if (newlines > 0) {
      state.agentSessions[id].lineCount += newlines
      const el = document.getElementById('ap-tokens-' + id)
      if (el) el.textContent = `↑ ${state.agentSessions[id].lineCount} lines`
    }
  })
  term.onData(d => window.ace.pty.write(id, d))
  term.onResize(({ cols, rows }) => window.ace.pty.resize(id, cols, rows))
}
```

Then remove the `if (!s.term) { ... }` block from `toggleAgentMode` — only the else-branch (switching back to chat) remains.

### Step 6: Verify
```bash
npm start
```
- Spawn an agent pane — renders with role label, task status, tokens counter
- Send a message to the agent — input clears, stream renders
- Agent mode toggle switches to terminal; pty works
- Agent close button works

---

## Task 9: Phase 2 Full Smoke Test + Commit

### Step 1: Run full Phase 2 checklist
- [ ] Session chat pane renders and sends
- [ ] Agent chat pane renders and sends
- [ ] Mode toggle (chat ↔ terminal) works in both pane types
- [ ] Attachment drag-drop / paste / file-pick works (using existing wiring in callers)
- [ ] Slash menu opens on `/` in session panes; absent in agent panes
- [ ] Session timer shows on session panes, absent on agent panes
- [ ] Send button disables during streaming, re-enables after
- [ ] Context bar updates token %
- [ ] Tool blocks render
- [ ] MCP cards render
- [ ] Verify on Windows (Marc Cooper) before merging — DOM/event behavior can differ on Electron/Win

### Step 2: Check final line counts
```bash
wc -l renderer/modules/session-manager.js \
       renderer/modules/agent-manager.js \
       renderer/modules/chat-pane.js \
       renderer/modules/tool-renderer.js \
       renderer/modules/mcp-cards.js
```
Expected: session-manager ~900, agent-manager ~250, three new files ~250/250/300.

### Step 3: Commit Phase 2
```bash
git add renderer/modules/chat-pane.js \
        renderer/modules/session-manager.js \
        renderer/modules/agent-manager.js
git commit -m "refactor: extract chat-pane.js factory, eliminate DOM duplication"
```

### Step 4: Merge to main
```bash
git checkout main
git merge chat-pipeline-refactor
```

---

## Summary

| Phase | New files | session-manager size | Agent-manager size |
|---|---|---|---|
| Before | — | 1,678 lines | 436 lines |
| After Phase 1 | `tool-renderer.js`, `mcp-cards.js` | ~1,050 lines | unchanged |
| After Phase 2 | `chat-pane.js` | ~900 lines | ~250 lines |

Total new code: ~800 lines across 3 clean modules. Total deleted from monolith: ~580 lines. Net reduction: ~230 lines with zero behavioral change.
