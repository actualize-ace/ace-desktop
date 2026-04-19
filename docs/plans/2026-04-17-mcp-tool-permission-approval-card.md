# MCP Tool Permission Approval Card Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** When Claude's `permission_denials` event contains an MCP tool (`mcp__<server>__<tool>`), render an in-chat approval card with "Always allow this server / this tool / Dismiss" actions — the accept button writes `.claude/settings.local.json` and offers a one-click retry of the last user message.

**Architecture:** Piggy-back on the existing `permission_denials` event handling at [session-manager.js:665-673](../../renderer/modules/session-manager.js#L665-L673). Add a second filter for `tool_name.startsWith('mcp__')`, render a new `renderMcpPermissionCard`, and expose a small main-process IPC (`permissions.addAllow`) that reads/modifies/writes `.claude/settings.local.json` atomically. Retry reuses `window.ace.chat.send` with the stored last user prompt — chat-manager already spawns a fresh claude process per message and picks up updated settings on the next spawn ([chat-manager.js:77](../../src/chat-manager.js#L77)).

**Tech Stack:** Electron main (`fs`), contextBridge preload, vanilla JS renderer module. No new dependencies.

---

## Scope Notes

- **Out of scope:** "Allow once" (requires a runtime-only allowlist and session restart with `--allowed-tools`; weight not worth it for MVP).
- **Out of scope:** Rewriting the existing `.claude/` Edit approval card — it uses a filesystem bypass that doesn't generalize to MCP tools. Keep both cards.
- **Settings file format:** `.claude/settings.local.json` already has `permissions.allow: [...]`. We append `mcp__<server>__*` or `mcp__<server>__<tool>` patterns into that same array; idempotent (skip if already present).
- **Dedupe:** Claude sometimes emits retries for the same tool in the same `result` event. Dedupe by `tool_name + JSON.stringify(tool_input)`.
- **No tests:** ace-desktop has no test framework (see `reference_ace_desktop_no_tests.md`). Every task ends with manual visual verification via `npm start` + DevTools.

---

### Task 1: Add `permissions.addAllow` IPC handler in main process

**Files:**
- Create: `ace-desktop/src/permissions.js`
- Modify: `ace-desktop/src/ipc-channels.js` (add `PERMISSIONS_ADD_ALLOW`)
- Modify: `ace-desktop/main.js` (register the handler)
- Modify: `ace-desktop/preload.js` (expose `window.ace.permissions.addAllow`)

**Step 1: Add IPC channel constant**

In [ipc-channels.js](../../src/ipc-channels.js), add alongside the other module.exports keys:

```js
PERMISSIONS_ADD_ALLOW: 'permissions:add-allow',
```

**Step 2: Create `permissions.js` with atomic read-modify-write**

```js
// ace-desktop/src/permissions.js
// Add an allow pattern to .claude/settings.local.json.
// Idempotent; creates the file + permissions.allow array if missing.

const fs = require('fs')
const path = require('path')

function addAllow(vaultPath, pattern) {
  if (!vaultPath || typeof vaultPath !== 'string') {
    return { ok: false, error: 'invalid-vault-path' }
  }
  if (!pattern || typeof pattern !== 'string') {
    return { ok: false, error: 'invalid-pattern' }
  }

  const file = path.join(vaultPath, '.claude', 'settings.local.json')

  let data = {}
  if (fs.existsSync(file)) {
    try {
      data = JSON.parse(fs.readFileSync(file, 'utf8'))
    } catch (e) {
      return { ok: false, error: 'parse-failed', detail: e.message }
    }
  } else {
    // Ensure .claude/ exists
    fs.mkdirSync(path.dirname(file), { recursive: true })
  }

  if (!data.permissions || typeof data.permissions !== 'object') {
    data.permissions = {}
  }
  if (!Array.isArray(data.permissions.allow)) {
    data.permissions.allow = []
  }

  if (data.permissions.allow.includes(pattern)) {
    return { ok: true, alreadyPresent: true }
  }

  data.permissions.allow.push(pattern)

  try {
    fs.writeFileSync(file, JSON.stringify(data, null, 2) + '\n', 'utf8')
  } catch (e) {
    return { ok: false, error: 'write-failed', detail: e.message }
  }

  return { ok: true, alreadyPresent: false }
}

module.exports = { addAllow }
```

**Step 3: Wire handler in `main.js`**

Find the existing `ipcMain.handle(...)` block (near the other permission/vault handlers). Add:

```js
const { addAllow } = require('./src/permissions')
ipcMain.handle(ch.PERMISSIONS_ADD_ALLOW, (_, vaultPath, pattern) =>
  addAllow(vaultPath, pattern))
```

**Step 4: Expose via preload**

In [preload.js](../../preload.js), add under the existing `ace` object:

```js
permissions: {
  addAllow: (vaultPath, pattern) =>
    ipcRenderer.invoke(ch.PERMISSIONS_ADD_ALLOW, vaultPath, pattern),
},
```

**Step 5: Manual smoke test from DevTools console**

Run `npm start`, open DevTools, then:

```js
await window.ace.permissions.addAllow(window.ace.state.vaultPath, 'mcp__fathom__*')
// Expected: { ok: true, alreadyPresent: false }
await window.ace.permissions.addAllow(window.ace.state.vaultPath, 'mcp__fathom__*')
// Expected: { ok: true, alreadyPresent: true }
```

Then `cat .claude/settings.local.json` — verify `mcp__fathom__*` appears in `permissions.allow` exactly once, other entries untouched.

**Step 6: Commit**

```bash
git add ace-desktop/src/permissions.js ace-desktop/src/ipc-channels.js \
        ace-desktop/main.js ace-desktop/preload.js
git commit -m "feat(ace-desktop): permissions.addAllow IPC for settings.local.json writes"
```

---

### Task 2: Capture last user prompt per chat (for retry)

**Files:**
- Modify: `ace-desktop/renderer/modules/session-manager.js`

**Why:** The approval card's "Approve & Retry" button needs the last message text to re-send. Today `session-manager.js` doesn't persist it.

**Step 1: Find where user messages are sent**

In [session-manager.js](../../renderer/modules/session-manager.js), search for the call site that invokes `window.ace.chat.send(...)`. That's the place the user's typed text gets shipped to the main process.

**Step 2: Store the last prompt on the session object**

Right before the `window.ace.chat.send(...)` call, add:

```js
const session = sessionsObj[id]
if (session) session.lastPrompt = prompt
```

(Use whatever local variable name already holds the user's text — do not rename.)

**Step 3: Manual verify**

`npm start`, open DevTools. In a chat, send "hello". In console:

```js
// Replace <chat-id> with an actual chat id from state.sessions
Object.values(window.__ace_debug?.sessions || {})[0]?.lastPrompt
// Expected: "hello"
```

If `__ace_debug` isn't exposed, temporarily log `session.lastPrompt` from inside the send function and confirm it prints.

**Step 4: Commit**

```bash
git add ace-desktop/renderer/modules/session-manager.js
git commit -m "feat(ace-desktop): store last user prompt per chat for retry flows"
```

---

### Task 3: Extend `permission_denials` filter to catch MCP denials

**Files:**
- Modify: `ace-desktop/renderer/modules/session-manager.js` (around line 665-673)

**Step 1: Add the MCP filter alongside the existing .claude/ Edit filter**

Replace the block at [session-manager.js:665-673](../../renderer/modules/session-manager.js#L665-L673):

```js
if (event.permission_denials?.length) {
  const claudeEdits = event.permission_denials.filter(d => {
    const p = d.tool_input?.file_path || ''
    return d.tool_name === 'Edit' && p.includes('/.claude/') && !p.includes('/.claude/projects/')
  })
  if (claudeEdits.length) {
    renderPermissionApprovalCard(id, claudeEdits, sessionsObj)
  }

  const mcpDenials = event.permission_denials.filter(d =>
    typeof d.tool_name === 'string' && d.tool_name.startsWith('mcp__'))
  if (mcpDenials.length) {
    renderMcpPermissionCard(id, mcpDenials, sessionsObj)
  }
}
```

**Step 2: Manual verify filter fires**

Temporarily add `console.log('[mcp-denial]', mcpDenials)` inside the `if (mcpDenials.length)` block. `npm start`, run `/call Craig`. Verify DevTools console logs an array with one entry whose `tool_name` starts with `mcp__fathom__`. (At this point `renderMcpPermissionCard` doesn't exist yet — you'll see a ReferenceError, which is fine; we just want to confirm the filter matches.)

Remove the `console.log` before committing. Do NOT commit yet — Task 4 adds the render function and this task's change would crash without it.

---

### Task 4: Implement `renderMcpPermissionCard`

**Files:**
- Modify: `ace-desktop/renderer/modules/session-manager.js` (add function near `renderPermissionApprovalCard` at line 871)

**Design:**
- One card per `result` event, grouping denials by server.
- For each denial, show: server name, tool name, compact input preview.
- Three buttons per denial:
  1. **Allow all `mcp__<server>__*`** (primary — most common case)
  2. **Just this tool (`mcp__<server>__<tool>`)** (tighter scope)
  3. **Dismiss** (no-op, closes card)
- After allow → write via IPC → show inline confirmation → offer **Retry last message** button that re-sends `session.lastPrompt`.

**Step 1: Add the function**

Insert after the existing `renderPermissionApprovalCard` closes (after line 954):

```js
function renderMcpPermissionCard(chatId, denials, sessionsObj) {
  const msgsEl = document.getElementById('chat-msgs-' + chatId)
  if (!msgsEl) return

  // Dedupe by tool_name + stringified tool_input
  const seen = new Set()
  const unique = denials.filter(d => {
    const key = d.tool_name + '|' + JSON.stringify(d.tool_input || {})
    if (seen.has(key)) return false
    seen.add(key)
    return true
  })
  if (!unique.length) return

  const esc = str => String(str ?? '')
    .replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;')

  // tool_name format: mcp__<server>__<tool>
  const parseToolName = name => {
    const m = /^mcp__([^_][^_]*(?:_[^_]+)*)__(.+)$/.exec(name)
    return m ? { server: m[1], tool: m[2] } : { server: 'unknown', tool: name }
  }

  const card = document.createElement('div')
  card.className = 'chat-permission-card mcp-permission-card'

  let html = `<div class="permission-card-header">MCP tool needs approval</div>`
  unique.forEach((d, i) => {
    const { server, tool } = parseToolName(d.tool_name)
    const inputPreview = JSON.stringify(d.tool_input || {}, null, 0).slice(0, 140)
    html += `
      <div class="permission-edit-item" data-idx="${i}">
        <div class="permission-file-path"><strong>${esc(server)}</strong> · ${esc(tool)}</div>
        <div class="permission-diff" style="font-family:monospace;font-size:11px;opacity:0.7">
          ${esc(inputPreview)}
        </div>
        <div class="chat-tool-actions" style="margin-top:6px">
          <button class="chat-approve-btn mcp-allow-server" data-server="${esc(server)}">Allow all ${esc(server)} tools</button>
          <button class="chat-approve-btn mcp-allow-tool" data-pattern="${esc(d.tool_name)}">Just this one</button>
        </div>
      </div>`
  })
  html += `
    <div class="chat-tool-actions">
      <button class="chat-deny-btn mcp-dismiss">Dismiss</button>
    </div>`

  card.innerHTML = html
  msgsEl.appendChild(card)
  msgsEl.scrollTop = msgsEl.scrollHeight

  const vaultPath = window.ace.state?.vaultPath
  const session = sessionsObj[chatId]

  async function applyPattern(pattern, btn) {
    btn.disabled = true
    btn.textContent = 'Saving…'
    const res = await window.ace.permissions.addAllow(vaultPath, pattern)
    if (!res?.ok) {
      btn.textContent = 'Failed — check console'
      console.error('[mcp] addAllow failed:', res)
      return
    }

    // Swap card into "approved" state with retry CTA
    const confirm = document.createElement('div')
    confirm.className = 'chat-msg assistant'
    const lastPrompt = session?.lastPrompt
    confirm.innerHTML = `
      <div class="msg-content md-body">
        <strong>Added</strong> <code>${pattern}</code> to allow list
        ${res.alreadyPresent ? ' (was already present)' : ''}.
        ${lastPrompt
          ? `<div style="margin-top:8px"><button class="preflight-btn mcp-retry-btn">Retry last message</button></div>`
          : '<div style="margin-top:8px;opacity:0.7">Re-send your message to try again.</div>'}
      </div>`
    msgsEl.appendChild(confirm)
    msgsEl.scrollTop = msgsEl.scrollHeight
    card.remove()

    const retryBtn = confirm.querySelector('.mcp-retry-btn')
    if (retryBtn) {
      retryBtn.addEventListener('click', () => {
        retryBtn.disabled = true
        retryBtn.textContent = 'Sending…'
        window.ace.chat.send(chatId, session.lastPrompt)
      })
    }
  }

  card.querySelectorAll('.mcp-allow-server').forEach(btn => {
    btn.addEventListener('click', () =>
      applyPattern(`mcp__${btn.dataset.server}__*`, btn))
  })
  card.querySelectorAll('.mcp-allow-tool').forEach(btn => {
    btn.addEventListener('click', () =>
      applyPattern(btn.dataset.pattern, btn))
  })
  card.querySelector('.mcp-dismiss').addEventListener('click', () => card.remove())
}
```

**Step 2: Verify the regex handles real server names**

Server names used in the vault include hyphens: `google-workspace`, `ace-analytics`, `21st-dev`. Test in DevTools console:

```js
const re = /^mcp__([^_][^_]*(?:_[^_]+)*)__(.+)$/
re.exec('mcp__fathom__find_person')              // → [_, 'fathom', 'find_person']
re.exec('mcp__google-workspace__send_gmail_message') // → [_, 'google-workspace', 'send_gmail_message']
re.exec('mcp__ace-analytics__ace_close_deal')    // → [_, 'ace-analytics', 'ace_close_deal']
```

All three must parse correctly. If the middle one fails (because hyphens aren't in `[^_]`), keep the regex — hyphen IS in `[^_]` since `_` is the only excluded char.

**Step 3: Manual end-to-end verification**

`npm start`. In a chat: `/call Craig`. Expected flow:
1. Claude emits permission denial for `mcp__fathom__find_person`
2. MCP permission card appears: "fathom · find_person" with two allow buttons + Dismiss
3. Click **Allow all fathom tools**
4. Card replaced with confirmation: "Added `mcp__fathom__*` to allow list" + Retry button
5. `cat .claude/settings.local.json` → confirm `mcp__fathom__*` is in `permissions.allow`
6. Click **Retry last message** → /call Craig re-runs, Fathom tool executes without prompt, returns transcript

**Step 4: Negative test**

Dismiss path: send another message that triggers a different MCP tool (e.g. `/emails` for `mcp__google-workspace__*`). Click **Dismiss** → card disappears, nothing written to settings.

**Step 5: Commit Tasks 3 + 4 together**

```bash
git add ace-desktop/renderer/modules/session-manager.js
git commit -m "feat(ace-desktop): MCP tool permission approval card with retry"
```

---

### Task 5: CSS polish (optional — only if visual looks broken)

**Files:**
- Modify: `ace-desktop/renderer/styles/chat.css`

Open the app, inspect the `.mcp-permission-card`. If spacing/contrast looks off vs. the existing `.chat-permission-card`, add a small selector:

```css
.mcp-permission-card .permission-edit-item {
  padding: 8px 10px;
  border-radius: 6px;
  background: rgba(255,255,255,0.03);
  margin-bottom: 6px;
}
```

Only commit if visual adjustments were needed.

```bash
git add ace-desktop/renderer/styles/chat.css
git commit -m "style(ace-desktop): MCP permission card spacing"
```

---

### Task 6: Update ROADMAP + memory

**Files:**
- Modify: `ace-desktop/ROADMAP.md` (mark the MCP tool approval card as shipped)
- Review: `memory/feedback_skill_write_permissions.md` — note that MCP tools now follow the same approval-card pattern as `.claude/` edits

**Step 1:** Find the ROADMAP row for MCP resilience (or create one in the `Done` table if none exists). Add a bullet: "MCP tool permission approval card — user can Allow-server / Allow-tool, auto-writes `.claude/settings.local.json`, Retry re-sends last message."

**Step 2:** No memory changes needed unless verification turns up a surprise. If an unknown server name pattern breaks `parseToolName`, add a feedback memory about it.

**Step 3: Commit**

```bash
git add ace-desktop/ROADMAP.md
git commit -m "docs(ace-desktop): roadmap — MCP tool approval card shipped"
```

---

## Definition of Done

- `/call Craig` → denial card appears → click Allow → retry succeeds (transcript returned)
- Same flow works for `mcp__google-workspace__*` (e.g., `/emails`)
- Dismiss leaves settings.local.json unchanged
- Idempotent: clicking Allow twice for the same pattern returns `alreadyPresent: true` and writes nothing
- `.claude/` Edit approval card still works (no regression on existing flow)
- No JS errors in DevTools console during any of the above

---

## Effort Estimate

~60-80 minutes for a fresh session: Task 1 (25 min) + Task 2 (5 min) + Tasks 3-4 (30 min) + Task 5 (10 min optional) + Task 6 (5 min). One commit per task.
