# Operations Container + Auto-Scroll Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Replace noisy expanded tool blocks with a compact two-level operations accordion, and fix auto-scroll so the user never has to manually scroll to see responses after tool activity.

**Architecture:** All non-question tool calls are collected into a single `chat-ops-container` per tool burst within each assistant message. The container shows a collapsed `⚡ N operations` header by default. Click to expand the list, click an item to see its detail. Auto-scroll fires on tool activity (120px threshold) and on finalize (300px threshold), gated by the existing `autoScroll` setting.

**Tech Stack:** Vanilla JS (session-manager.js), CSS (chat.css). No new dependencies.

**Design doc:** `ace-desktop/docs/plans/2026-04-11-ops-container-autoscroll-design.md`

---

### Task 1: Add CSS for operations container

**Files:**
- Modify: `ace-desktop/renderer/styles/chat.css:109-127` (after existing tool block styles)

**Step 1: Add ops container styles after the existing tool block section**

Add after line 127 (after `.chat-tool-detail pre { ... }`):

```css
/* Operations container — collapsed tool summary */
.chat-ops-container { border:1px solid var(--border); border-radius:6px; margin:8px 0; overflow:hidden; }
.chat-ops-header {
  display:flex; align-items:center; gap:8px; padding:6px 12px; cursor:pointer;
  font-family:'JetBrains Mono',monospace; font-size:9px; color:var(--text-dim);
  transition:background 0.12s;
}
.chat-ops-header:hover { background:rgba(212,165,116,0.03); }
.chat-ops-icon { font-size:10px; }
.chat-ops-count { font-weight:500; }
.chat-ops-chevron { margin-left:auto; font-size:8px; transition:transform 0.15s; }
.chat-ops-container:not(.collapsed) .chat-ops-chevron { transform:rotate(90deg); }
.chat-ops-list { padding:0; }
.chat-ops-container.collapsed .chat-ops-list { display:none; }
.chat-ops-item { border-top:1px solid var(--border); }
.chat-ops-item-header {
  display:flex; align-items:center; gap:8px; padding:5px 12px; cursor:pointer;
  font-family:'JetBrains Mono',monospace; font-size:9px; color:var(--text-dim);
  transition:background 0.12s;
}
.chat-ops-item-header:hover { background:rgba(212,165,116,0.03); }
.chat-ops-item-chevron { margin-left:auto; font-size:7px; transition:transform 0.15s; }
.chat-ops-item:not(.collapsed) .chat-ops-item-chevron { transform:rotate(90deg); }
.chat-ops-item-detail { padding:0 12px 8px; font-size:11px; }
.chat-ops-item.collapsed .chat-ops-item-detail { display:none; }
.chat-ops-item-detail pre {
  background:var(--bg-card); border:1px solid var(--border); border-radius:4px;
  padding:8px 10px; margin:4px 0; overflow-x:auto;
  font-family:'JetBrains Mono',monospace; font-size:10px; color:var(--text-dim);
}
```

**Step 2: Verify visually**

Run ACE Desktop (`npm start` from ace-desktop/). Open a session. The new styles won't take effect yet since the JS hasn't changed, but verify the CSS file loads without errors in DevTools console.

**Step 3: Commit**

```bash
git add ace-desktop/renderer/styles/chat.css
git commit -m "style: add ops container CSS for collapsed tool display"
```

---

### Task 2: Add autoScroll helper and wire config

**Files:**
- Modify: `ace-desktop/renderer/modules/session-manager.js:1-9` (imports area, add nothing — just reference)
- Modify: `ace-desktop/renderer/modules/session-manager.js:1124-1130` (initSessions, load autoScroll)

**Step 1: Add `state._autoScroll` loading in `initSessions`**

In `ace-desktop/renderer/modules/session-manager.js`, find line 1127-1129 inside `initSessions`:

```js
    const cfg = await window.ace.setup.getConfig()
    if (cfg?.defaults?.chat) state.chatDefaults = cfg.defaults.chat
    if (cfg?.defaults?.guardrails?.sessionCostWarning) state._costGuardrail = cfg.defaults.guardrails.sessionCostWarning
```

Add after line 1129 (inside the same async IIFE):

```js
    state._autoScroll = cfg?.defaults?.startup?.autoScroll !== false
```

**Step 2: Add `scrollChatToBottom` helper**

Add after `clearActivityIndicator` (after line 370), a helper used by all scroll callsites:

```js
// Scroll chat to bottom — respects autoScroll setting and proximity threshold
function scrollChatToBottom(id, threshold) {
  if (state._autoScroll === false) return
  const msgsEl = document.getElementById('chat-msgs-' + id)
  if (!msgsEl) return
  const dist = msgsEl.scrollHeight - msgsEl.scrollTop - msgsEl.clientHeight
  if (dist < (threshold || 120)) msgsEl.scrollTop = msgsEl.scrollHeight
}
```

**Step 3: Update existing scroll in `renderChatStream`**

Replace lines 138-143:

```js
  // Auto-scroll
  const msgsEl = document.getElementById('chat-msgs-' + id)
  if (msgsEl) {
    const isAtBottom = (msgsEl.scrollHeight - msgsEl.scrollTop - msgsEl.clientHeight) < 60
    if (isAtBottom) msgsEl.scrollTop = msgsEl.scrollHeight
  }
```

With:

```js
  // Auto-scroll
  scrollChatToBottom(id, 120)
```

**Step 4: Add scroll to `finalizeMessage`**

In `finalizeMessage`, add after line 189 (`clearActivityIndicator(id, sessionsObj)`):

```js
  // Auto-scroll on finalize — generous threshold (user may have scrolled up deliberately)
  scrollChatToBottom(id, 300)
```

**Step 5: Test**

Run ACE Desktop. Send a message. Verify:
- Chat still auto-scrolls during text streaming
- After response finishes, chat scrolls to show the final text

**Step 6: Commit**

```bash
git add ace-desktop/renderer/modules/session-manager.js
git commit -m "feat: add scrollChatToBottom helper, wire autoScroll setting"
```

---

### Task 3: Replace `appendToolBlock` with ops container logic

This is the core change. Replace the standalone tool block system with the operations container.

**Files:**
- Modify: `ace-desktop/renderer/modules/session-manager.js:209-261` (VISIBLE_TOOLS + appendToolBlock)

**Step 1: Remove `VISIBLE_TOOLS` and rewrite `appendToolBlock`**

Replace lines 209-261 (from `const VISIBLE_TOOLS` through the end of `appendToolBlock`) with:

```js
// Tools that need user input (questions) — render outside ops container
const QUESTION_TOOLS = new Set(['AskUserQuestion'])

// Tool block helpers — all non-question tools go into an ops container
export function appendToolBlock(id, toolInfo, sessionsObj) {
  sessionsObj = sessionsObj || state.sessions
  const s = sessionsObj[id]
  if (!s || !s._currentAssistantEl) return
  const contentEl = s._currentAssistantEl.querySelector('.chat-msg-content')
  const toolName = toolInfo.name || 'Tool'
  const needsInput = QUESTION_TOOLS.has(toolName)

  // Track current tool name for Skill/close detection
  s._currentToolName = toolName

  if (needsInput) {
    // Question tool — render outside container, break current container
    s._opsContainer = null
    const block = document.createElement('div')
    block.className = 'chat-question-block'
    block.innerHTML = `<div class="question-header" id="question-text-${id}"></div>`
    s._questionBlockEl = block
    const tailEl = contentEl.querySelector('.chat-tail:last-of-type')
    contentEl.insertBefore(block, tailEl)
    setAttention(id, sessionsObj)
    s._currentToolBlock = block
    s.currentToolInput = ''
    updateActivityIndicator(id, toolName, sessionsObj)
    return
  }

  // Non-question tool — add to ops container
  if (!s._opsContainer) {
    // Create new ops container
    const container = document.createElement('div')
    container.className = 'chat-ops-container collapsed'
    container.innerHTML = `<div class="chat-ops-header"><span class="chat-ops-icon">⚡</span><span class="chat-ops-count">1 operation</span><span class="chat-ops-chevron">▸</span></div><div class="chat-ops-list"></div>`
    container.querySelector('.chat-ops-header').addEventListener('click', () => container.classList.toggle('collapsed'))
    const tailEl = contentEl.querySelector('.chat-tail:last-of-type')
    contentEl.insertBefore(container, tailEl)
    s._opsContainer = container
    s._opsCount = 0
  }

  // Create ops item
  s._opsCount++
  const countEl = s._opsContainer.querySelector('.chat-ops-count')
  if (countEl) countEl.textContent = s._opsCount === 1 ? '1 operation' : `${s._opsCount} operations`

  const item = document.createElement('div')
  item.className = 'chat-ops-item collapsed'
  item.innerHTML = `<div class="chat-ops-item-header"><span class="chat-ops-item-label">${escapeHtml(toolName)}</span><span class="chat-ops-item-chevron">▸</span></div><div class="chat-ops-item-detail"></div>`
  item.querySelector('.chat-ops-item-header').addEventListener('click', () => item.classList.toggle('collapsed'))

  s._opsContainer.querySelector('.chat-ops-list').appendChild(item)
  s._currentToolBlock = item
  s.currentToolInput = ''

  updateActivityIndicator(id, toolName, sessionsObj)
  scrollChatToBottom(id, 120)
}
```

**Note:** This removes the `VISIBLE_TOOLS` set entirely and the old `_toolGroup` logic. `QUESTION_TOOLS` stays but moves up (it was at line 212, now at the top of the replacement block — keeps same scope).

**Step 2: Verify no duplicate `QUESTION_TOOLS`**

The old `QUESTION_TOOLS` was at line 212. The new code includes it. Make sure the old declaration is removed (it was between `VISIBLE_TOOLS` and `appendToolBlock`, both of which are replaced).

**Step 3: Commit**

```bash
git add ace-desktop/renderer/modules/session-manager.js
git commit -m "feat: replace standalone tool blocks with ops container"
```

---

### Task 4: Update `appendToolInput` for ops container

**Files:**
- Modify: `ace-desktop/renderer/modules/session-manager.js:263-339` (appendToolInput function)

**Step 1: Rewrite `appendToolInput`**

Replace the entire `appendToolInput` function (lines 263-339) with:

```js
export function appendToolInput(id, partialJson, sessionsObj) {
  sessionsObj = sessionsObj || state.sessions
  const s = sessionsObj[id]
  if (!s || !s._currentToolBlock) return
  s.currentToolInput += partialJson

  // Update activity indicator with file path or tool details
  let toolName = s._currentToolName || ''
  try {
    const parsed = JSON.parse(s.currentToolInput)
    const detail = parsed.file_path || parsed.path || parsed.command || parsed.pattern || parsed.query || ''
    if (detail) {
      const short = detail.split('/').pop() || detail.slice(0, 40)
      updateActivityIndicator(id, `${toolName}: ${short}`, sessionsObj)
    }
  } catch {}

  // Question tool — render markdown in question block
  if (s._questionBlockEl) {
    try {
      const parsed = JSON.parse(s.currentToolInput)
      const question = parsed.question || parsed.text || parsed.message || JSON.stringify(parsed, null, 2)
      const headerEl = s._questionBlockEl.querySelector('.question-header')
      if (headerEl) {
        headerEl.innerHTML = DOMPurify.sanitize(marked.parse(question), SANITIZE_CONFIG)
        headerEl.classList.add('md-body')
      }
      scrollChatToBottom(id, 120)
    } catch {}
    return
  }

  // Ops item — update the item label and detail
  const detailEl = s._currentToolBlock.querySelector('.chat-ops-item-detail')
  const labelEl = s._currentToolBlock.querySelector('.chat-ops-item-label')
  if (!detailEl) return

  try {
    const parsed = JSON.parse(s.currentToolInput)

    // Update item label with short description
    let shortLabel = toolName
    const filePath = parsed.file_path || parsed.path || ''
    if (filePath) {
      const parts = filePath.split('/')
      shortLabel = toolName + ': ' + (parts.length > 3 ? '.../' + parts.slice(-3).join('/') : filePath)
    } else if (parsed.command) {
      shortLabel = toolName + ': ' + (parsed.command.length > 50 ? parsed.command.slice(0, 50) + '...' : parsed.command)
    } else if (parsed.pattern) {
      shortLabel = toolName + ': ' + parsed.pattern
    } else if (parsed.query) {
      shortLabel = toolName + ': ' + parsed.query.slice(0, 40)
    }
    if (labelEl) labelEl.textContent = shortLabel

    // Render detail content (visible when item is expanded)
    if (parsed.old_string != null && parsed.new_string != null) {
      // Edit tool — diff view
      const file = parsed.file_path ? `<div class="tool-item" style="font-weight:500">${escapeHtml(parsed.file_path.split('/').slice(-3).join('/'))}</div>` : ''
      detailEl.innerHTML = `${file}<pre class="tool-diff"><span class="diff-remove">${escapeHtml(parsed.old_string)}</span><span class="diff-add">${escapeHtml(parsed.new_string)}</span></pre>`
    } else if (parsed.command) {
      // Bash tool — command
      detailEl.innerHTML = `<pre>${escapeHtml(parsed.command)}</pre>`
    } else if (parsed.content != null) {
      // Write tool — file path + content preview
      const file = parsed.file_path ? `<div class="tool-item" style="font-weight:500">${escapeHtml(parsed.file_path.split('/').slice(-3).join('/'))}</div>` : ''
      const preview = parsed.content.length > 500 ? parsed.content.slice(0, 500) + '...' : parsed.content
      detailEl.innerHTML = `${file}<pre>${escapeHtml(preview)}</pre>`
    } else {
      // Generic — show key info
      const label = parsed.file_path || parsed.path || parsed.pattern || parsed.query || JSON.stringify(parsed, null, 2).slice(0, 200)
      detailEl.innerHTML = `<pre>${escapeHtml(label)}</pre>`
    }
  } catch {
    detailEl.innerHTML = `<pre>${escapeHtml(s.currentToolInput.slice(0, 200))}</pre>`
  }
}
```

**Step 2: Commit**

```bash
git add ace-desktop/renderer/modules/session-manager.js
git commit -m "feat: update appendToolInput for ops container item detail"
```

---

### Task 5: Update stream event handlers for ops container state

**Files:**
- Modify: `ace-desktop/renderer/modules/session-manager.js:469-537` (wireChatListeners stream handler)

**Step 1: Update `content_block_start` text handler**

Find line 479:
```js
          if (s._toolGroup || s._hadToolBlocks) {
            s._toolGroup = null
```

Replace with:
```js
          if (s._opsContainer || s._hadToolBlocks) {
            s._opsContainer = null
            s._opsCount = 0
```

**Step 2: Update `content_block_stop` Skill detection**

Find lines 520-527:
```js
        if (s._currentToolBlock) {
          // Detect /close skill invocation
          if (s._toolGroup?.name === 'Skill' || (!s._toolGroup && s._currentToolBlock.querySelector?.('.chat-tool-name')?.textContent?.includes('Skill'))) {
            try {
              const parsed = JSON.parse(s.currentToolInput)
              if (parsed.skill === 'close') onSessionClose()
            } catch {}
          }
```

Replace with:
```js
        if (s._currentToolBlock) {
          // Detect /close skill invocation
          if (s._currentToolName === 'Skill') {
            try {
              const parsed = JSON.parse(s.currentToolInput)
              if (parsed.skill === 'close') onSessionClose()
            } catch {}
          }
```

**Step 3: Update `finalizeMessage` cleanup**

Find line 191 in `finalizeMessage`:
```js
  s._toolGroup = null
```

Replace with:
```js
  s._opsContainer = null
  s._opsCount = 0
  s._currentToolName = null
```

**Step 4: Commit**

```bash
git add ace-desktop/renderer/modules/session-manager.js
git commit -m "feat: update stream handlers for ops container state management"
```

---

### Task 6: Manual integration test

**Files:** None (testing only)

**Step 1: Start ACE Desktop**

```bash
cd ace-desktop && npm start
```

**Step 2: Test basic tool consolidation**

Send a message that triggers multiple tool calls (e.g. `/start`). Verify:
- [ ] Tool calls appear as `⚡ N operations` collapsed block
- [ ] Click header expands to show item list
- [ ] Click item expands to show detail (command/diff/path)
- [ ] Counter updates as tools fire

**Step 3: Test auto-scroll**

Send a message that triggers many tool calls. Verify:
- [ ] Chat stays scrolled to the bottom as tools fire
- [ ] After response completes, final text is visible without manual scrolling
- [ ] Deliberately scrolling up during tool activity does NOT yank you back

**Step 4: Test question/approval blocks**

Trigger a tool that asks a question (AskUserQuestion) or a permission denial. Verify:
- [ ] Question block renders outside the ops container, fully visible
- [ ] Question block is interactive (can answer)
- [ ] After question block, new tools start a fresh ops container

**Step 5: Test text↔tool transitions**

Send a `/start` or similar command that produces text → tools → text → tools → text. Verify:
- [ ] Each tool burst gets its own `⚡ N operations` block
- [ ] Text paragraphs appear between the ops containers correctly

**Step 6: Test Skill/close detection**

Run `/close`. Verify the session closure still triggers (atmosphere effect, session log, etc).

**Step 7: Test autoScroll toggle**

Go to Settings → toggle "Auto-scroll Chat" off. Send a message. Verify chat does NOT auto-scroll. Toggle back on, verify it resumes.

**Step 8: Commit if all passes**

```bash
git add -A
git commit -m "test: verify ops container + auto-scroll integration"
```

---

### Summary of all changes

| File | Change |
|------|--------|
| `renderer/styles/chat.css` | Add `chat-ops-*` styles (~30 lines) |
| `renderer/modules/session-manager.js` | Replace `VISIBLE_TOOLS` + `appendToolBlock` + `appendToolInput`, add `scrollChatToBottom`, update stream handlers + `finalizeMessage` |
| No changes | `chat-renderer.js`, `agent-manager.js`, `history.js`, permission/question rendering |

**New session state:** `_opsContainer`, `_opsCount`, `_currentToolName`
**Removed session state:** `_toolGroup`
