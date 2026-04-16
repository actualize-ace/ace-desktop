# Chat Attachments Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Let users attach images, PDFs, and text files to chat messages via drag-drop, paste, or file picker — in both Terminal and Agents rendered chat views.

**Architecture:** Three renderer entry points (drag/paste/picker) funnel to a shared `stageAttachment()` that saves files via IPC to `<vault>/00-System/chat-attachments/YYYY-MM-DD/`. At send time, `@<relPath>` lines are prepended to the prompt. Chips render in composer (pre-send) and in message bubbles (post-send).

**Tech Stack:** Electron IPC, Node `fs`, DOM events (dragover/drop/paste), vanilla JS + CSS (no framework)

**Design doc:** `docs/plans/2026-04-15-chat-attachments-design.md`

**Testing:** ace-desktop has no test framework — all verification is manual via `npm start` + DevTools. Each task ends with a visual verification step.

---

### Task 1: IPC Channels + Preload Bridge

**Files:**
- Modify: `src/ipc-channels.js:57-62` (add after Chat block)
- Modify: `preload.js:79-99` (add after chat namespace)

**Step 1: Add channel constants**

In `src/ipc-channels.js`, add after the Chat block (after line 63):

```js
  // Attachments
  ATTACHMENT_PICK:          'attachment-pick',
  ATTACHMENT_SAVE:          'attachment-save',
```

**Step 2: Add preload bridge**

In `preload.js`, add a new `attachments` namespace after the `chat` block (after line 99):

```js
  // ─── Attachments ──────────────────────────────────────────────────────────────
  attachments: {
    pickFile: () => ipcRenderer.invoke(ch.ATTACHMENT_PICK),
    save:     (opts) => ipcRenderer.invoke(ch.ATTACHMENT_SAVE, opts),
    openFile: (absPath) => ipcRenderer.invoke(ch.SHELL_OPEN_PATH, absPath),
  },
```

Note: `openFile` reuses existing `SHELL_OPEN_PATH` channel — no new handler needed.

**Step 3: Verify**

Run `npm start`, open DevTools console, confirm `window.ace.attachments` exists with `pickFile`, `save`, `openFile` methods.

**Step 4: Commit**

```bash
git add ace-desktop/src/ipc-channels.js ace-desktop/preload.js
git commit -m "feat(attachments): add IPC channels and preload bridge"
```

---

### Task 2: Main-Process Attachment Manager

**Files:**
- Create: `src/attachment-manager.js`
- Modify: `main.js:301-308` (add IPC handlers after Chat handlers)

**Step 1: Create attachment-manager.js**

```js
const { dialog } = require('electron')
const path = require('path')
const fs = require('fs')

const ALLOWED_EXTS = new Set([
  'png', 'jpg', 'jpeg', 'gif', 'webp',
  'pdf',
  'txt', 'md'
])

const MAX_SIZE = 25 * 1024 * 1024  // 25 MB

function sanitizeName(name) {
  const ext = path.extname(name)
  const base = path.basename(name, ext)
  const clean = base.replace(/\s+/g, '-').replace(/[^a-zA-Z0-9\-_]/g, '')
  return (clean || 'file') + ext.toLowerCase()
}

function destDir(vaultPath) {
  const now = new Date()
  const dateStr = now.toISOString().slice(0, 10)
  return path.join(vaultPath, '00-System', 'chat-attachments', dateStr)
}

function timePrefix() {
  const now = new Date()
  return String(now.getHours()).padStart(2, '0')
       + String(now.getMinutes()).padStart(2, '0')
       + String(now.getSeconds()).padStart(2, '0')
}

function ensureGitignore(vaultPath) {
  const gi = path.join(vaultPath, '.gitignore')
  if (!fs.existsSync(gi)) return
  const content = fs.readFileSync(gi, 'utf8')
  if (content.includes('00-System/chat-attachments')) return
  fs.appendFileSync(gi, '\n# ACE chat attachments\n00-System/chat-attachments/\n')
}

async function pickFile(win) {
  const result = await dialog.showOpenDialog(win, {
    properties: ['openFile', 'multiSelections'],
    filters: [
      { name: 'Images', extensions: ['png', 'jpg', 'jpeg', 'gif', 'webp'] },
      { name: 'Documents', extensions: ['pdf'] },
      { name: 'Text', extensions: ['txt', 'md'] },
    ],
  })
  if (result.canceled || !result.filePaths.length) return []
  return result.filePaths.map(p => ({ sourcePath: p, name: path.basename(p) }))
}

function saveFile(vaultPath, opts) {
  // opts: { sourcePath?, buffer?, name }
  const ext = path.extname(opts.name).replace('.', '').toLowerCase()
  if (!ALLOWED_EXTS.has(ext)) {
    return { error: 'unsupported-type', ext }
  }

  // Size check — path-based reads stat, buffer checks .length
  if (opts.sourcePath) {
    const stat = fs.statSync(opts.sourcePath)
    if (stat.size > MAX_SIZE) return { error: 'too-large', size: stat.size }
  } else if (opts.buffer && opts.buffer.length > MAX_SIZE) {
    return { error: 'too-large', size: opts.buffer.length }
  }

  const dir = destDir(vaultPath)
  fs.mkdirSync(dir, { recursive: true })

  const safeName = timePrefix() + '-' + sanitizeName(opts.name)
  const absPath = path.join(dir, safeName)

  if (opts.sourcePath) {
    fs.copyFileSync(opts.sourcePath, absPath)
  } else if (opts.buffer) {
    fs.writeFileSync(absPath, Buffer.from(opts.buffer))
  } else {
    return { error: 'no-data' }
  }

  const stat = fs.statSync(absPath)
  const relPath = path.relative(vaultPath, absPath)

  // Idempotent .gitignore on first save
  ensureGitignore(vaultPath)

  return { relPath, absPath, name: safeName, size: stat.size }
}

module.exports = { pickFile, saveFile }
```

**Step 2: Wire IPC handlers in main.js**

Add after the Chat IPC handlers block (after line 308):

```js
// ─── Attachment IPC Handlers ─────────────────────────────────────────────────

ipcMain.handle(ch.ATTACHMENT_PICK, () => {
  return require('./src/attachment-manager').pickFile(mainWindow)
})
ipcMain.handle(ch.ATTACHMENT_SAVE, (_, opts) => {
  return require('./src/attachment-manager').saveFile(resolveVaultPath(), opts)
})
```

**Step 3: Verify**

Run `npm start`, DevTools console:
```js
// Test pick dialog
const files = await window.ace.attachments.pickFile()
console.log(files)  // should show file array or empty

// Test save (path-based) — pick a real file first
const result = await window.ace.attachments.save({
  sourcePath: '/path/to/test.png',
  name: 'test.png'
})
console.log(result)  // { relPath, absPath, name, size }
```

Confirm `00-System/chat-attachments/2026-04-15/` folder created with the file.
Confirm `.gitignore` has `00-System/chat-attachments/` line.

**Step 4: Commit**

```bash
git add ace-desktop/src/attachment-manager.js ace-desktop/main.js
git commit -m "feat(attachments): main-process save + pick handlers"
```

---

### Task 3: Attachment Chip Tray CSS

**Files:**
- Modify: `renderer/styles/chat.css` (add after `.chat-controls` block, ~line 255)

**Step 1: Add styles**

Add after the `.chat-select` styles (after the chat-controls block):

```css
/* ── ATTACHMENT CHIP TRAY ── */
.chat-attachments {
  display: flex; flex-wrap: wrap; gap: 6px;
  padding: 6px 24px 2px;
}
.chat-attachments:empty { display: none; }

.attach-chip {
  display: inline-flex; align-items: center; gap: 5px;
  background: rgba(136,120,255,0.08); border: 1px solid rgba(136,120,255,0.15);
  border-radius: 8px; padding: 4px 8px;
  font-family: 'DM Sans', sans-serif; font-size: 11px; color: var(--text-secondary);
  max-width: 220px; cursor: default;
  transition: background 0.15s;
}
.attach-chip.warn { background: rgba(212,165,116,0.12); border-color: rgba(212,165,116,0.25); }
.attach-chip-icon { font-size: 13px; flex-shrink: 0; }
.attach-chip-name {
  overflow: hidden; text-overflow: ellipsis; white-space: nowrap;
  max-width: 140px;
}
.attach-chip-size { color: var(--text-dim); font-size: 10px; flex-shrink: 0; }
.attach-chip-remove {
  background: none; border: none; color: var(--text-dim); cursor: pointer;
  font-size: 13px; padding: 0 2px; line-height: 1;
  transition: color 0.15s;
}
.attach-chip-remove:hover { color: var(--red); }

/* Sent message attachment chips (no remove button) */
.msg-attachments { display: flex; flex-wrap: wrap; gap: 4px; margin-bottom: 6px; }
.msg-attach-chip {
  display: inline-flex; align-items: center; gap: 4px;
  background: rgba(136,120,255,0.06); border: 1px solid rgba(136,120,255,0.1);
  border-radius: 6px; padding: 3px 7px;
  font-size: 10px; color: var(--text-secondary); cursor: pointer;
  transition: background 0.15s;
}
.msg-attach-chip:hover { background: rgba(136,120,255,0.14); }
.msg-attach-chip.missing { opacity: 0.4; cursor: default; }

/* Paperclip button */
.chat-attach-btn {
  width: 36px; height: 36px; border-radius: 10px; border: 1px solid rgba(136,120,255,0.12);
  background: transparent; color: var(--text-dim); cursor: pointer;
  display: flex; align-items: center; justify-content: center;
  font-size: 16px; transition: all 0.2s;
  flex-shrink: 0;
}
.chat-attach-btn:hover { color: var(--gold); border-color: rgba(212,165,116,0.3); }

/* Drop overlay */
.chat-drop-overlay {
  position: absolute; inset: 0; z-index: 50;
  display: flex; align-items: center; justify-content: center;
  background: rgba(10,14,28,0.85);
  border: 2px dashed rgba(212,165,116,0.5);
  border-radius: 12px; pointer-events: none;
  font-family: 'DM Sans', sans-serif; font-size: 13px; color: var(--gold);
  letter-spacing: 0.5px;
}
```

**Step 2: Verify**

Run `npm start`, inspect DevTools → Elements, confirm styles load without parse errors.

**Step 3: Commit**

```bash
git add ace-desktop/renderer/styles/chat.css
git commit -m "feat(attachments): chip tray + overlay CSS"
```

---

### Task 4: Renderer Attachment Handler Module

**Files:**
- Create: `renderer/modules/attachment-handler.js`

**Step 1: Create the module**

```js
// renderer/modules/attachment-handler.js
// Shared attachment pipeline: stage, render chips, inject at send time.

const ALLOWED_EXTS = new Set([
  'png', 'jpg', 'jpeg', 'gif', 'webp', 'pdf', 'txt', 'md'
])

const TYPE_ICONS = {
  png: '🖼', jpg: '🖼', jpeg: '🖼', gif: '🖼', webp: '🖼',
  pdf: '📄',
  txt: '📝', md: '📝',
}

const WARN_SIZE = 5 * 1024 * 1024  // 5 MB

function formatSize(bytes) {
  if (bytes < 1024) return bytes + ' B'
  if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(1) + ' KB'
  return (bytes / (1024 * 1024)).toFixed(1) + ' MB'
}

function extFromName(name) {
  return (name.split('.').pop() || '').toLowerCase()
}

// ─── Staging ─────────────────────────────────────────────────────────────────

// session.pendingAttachments = [] — initialized elsewhere (session-manager)

export async function stageFromPaths(session, chatId, filePaths) {
  for (const filePath of filePaths) {
    const name = filePath.split(/[\\/]/).pop()
    const ext = extFromName(name)
    if (!ALLOWED_EXTS.has(ext)) {
      showToast(chatId, `Unsupported file type: .${ext}`)
      continue
    }
    const result = await window.ace.attachments.save({ sourcePath: filePath, name })
    if (result.error) {
      showToast(chatId, result.error === 'too-large'
        ? `File too large (${formatSize(result.size)}, max 25 MB)`
        : `Cannot attach .${result.ext} files`)
      continue
    }
    session.pendingAttachments.push(result)
    renderChipTray(session, chatId)
  }
}

export async function stageFromBuffer(session, chatId, buffer, fileName) {
  const ext = extFromName(fileName)
  if (!ALLOWED_EXTS.has(ext)) {
    showToast(chatId, `Unsupported file type: .${ext}`)
    return
  }
  const result = await window.ace.attachments.save({
    buffer: Array.from(new Uint8Array(buffer)),
    name: fileName,
  })
  if (result.error) {
    showToast(chatId, result.error === 'too-large'
      ? `File too large (${formatSize(result.size)}, max 25 MB)`
      : `Cannot attach .${result.ext} files`)
    return
  }
  session.pendingAttachments.push(result)
  renderChipTray(session, chatId)
}

// ─── Pick (native dialog) ────────────────────────────────────────────────────

export async function pickAndStage(session, chatId) {
  const files = await window.ace.attachments.pickFile()
  if (!files || !files.length) return
  await stageFromPaths(session, chatId, files.map(f => f.sourcePath))
}

// ─── Chip Tray Rendering ─────────────────────────────────────────────────────

export function renderChipTray(session, chatId) {
  const tray = document.getElementById('chat-attachments-' + chatId)
  if (!tray) return
  tray.innerHTML = ''
  for (let i = 0; i < session.pendingAttachments.length; i++) {
    const att = session.pendingAttachments[i]
    const ext = extFromName(att.name)
    const icon = TYPE_ICONS[ext] || '📎'
    const warn = att.size > WARN_SIZE ? ' warn' : ''

    const chip = document.createElement('div')
    chip.className = 'attach-chip' + warn
    chip.innerHTML = `
      <span class="attach-chip-icon">${icon}</span>
      <span class="attach-chip-name" title="${att.name}">${att.name.length > 24 ? att.name.slice(0, 22) + '…' : att.name}</span>
      <span class="attach-chip-size">${formatSize(att.size)}</span>
      <button class="attach-chip-remove" aria-label="Remove attachment" data-idx="${i}">×</button>
    `
    chip.querySelector('.attach-chip-remove').addEventListener('click', () => {
      session.pendingAttachments.splice(i, 1)
      renderChipTray(session, chatId)
    })
    tray.appendChild(chip)
  }
}

// ─── Prompt Injection ────────────────────────────────────────────────────────

export function injectAttachments(session, prompt) {
  if (!session.pendingAttachments || session.pendingAttachments.length === 0) {
    return prompt
  }
  const refs = session.pendingAttachments.map(a => '@' + a.relPath).join('\n')
  return refs + '\n\n' + prompt
}

export function consumeAttachments(session) {
  const list = session.pendingAttachments.slice()
  session.pendingAttachments = []
  return list
}

// ─── Message Bubble Chips ────────────────────────────────────────────────────

export function renderMsgAttachments(attachments) {
  if (!attachments || attachments.length === 0) return ''
  const chips = attachments.map(att => {
    const ext = extFromName(att.name)
    const icon = TYPE_ICONS[ext] || '📎'
    return `<span class="msg-attach-chip" data-path="${att.absPath || ''}" title="${att.name}">${icon} ${att.name.length > 20 ? att.name.slice(0, 18) + '…' : att.name}</span>`
  }).join('')
  return `<div class="msg-attachments">${chips}</div>`
}

// Wire click-to-open on message attachment chips (call once per bubble)
export function wireMsgAttachmentClicks(containerEl) {
  containerEl.querySelectorAll('.msg-attach-chip[data-path]').forEach(chip => {
    chip.addEventListener('click', () => {
      const p = chip.dataset.path
      if (p) window.ace.attachments.openFile(p)
    })
  })
}

// ─── Drop Overlay ────────────────────────────────────────────────────────────

export function wireDropZone(session, chatId) {
  const inputArea = document.querySelector(`#pane-${chatId} .chat-input-area`)
  if (!inputArea) return

  let dragCounter = 0

  inputArea.addEventListener('dragenter', e => {
    e.preventDefault()
    dragCounter++
    if (dragCounter === 1) showDropOverlay(inputArea)
  })
  inputArea.addEventListener('dragover', e => {
    e.preventDefault()
    e.dataTransfer.dropEffect = 'copy'
  })
  inputArea.addEventListener('dragleave', () => {
    dragCounter--
    if (dragCounter <= 0) { dragCounter = 0; hideDropOverlay(inputArea) }
  })
  inputArea.addEventListener('drop', e => {
    e.preventDefault()
    dragCounter = 0
    hideDropOverlay(inputArea)
    const files = Array.from(e.dataTransfer.files)
    if (files.length) {
      // Electron File objects have a .path property
      stageFromPaths(session, chatId, files.map(f => f.path))
    }
  })
}

function showDropOverlay(inputArea) {
  if (inputArea.querySelector('.chat-drop-overlay')) return
  const overlay = document.createElement('div')
  overlay.className = 'chat-drop-overlay'
  overlay.textContent = 'Drop to attach'
  inputArea.appendChild(overlay)
}

function hideDropOverlay(inputArea) {
  const overlay = inputArea.querySelector('.chat-drop-overlay')
  if (overlay) overlay.remove()
}

// ─── Paste Handler ───────────────────────────────────────────────────────────

export function wirePasteHandler(session, chatId) {
  const textarea = document.getElementById('chat-input-' + chatId)
  if (!textarea) return

  textarea.addEventListener('paste', e => {
    const files = e.clipboardData?.files
    if (!files || files.length === 0) return  // normal text paste — fall through

    e.preventDefault()
    for (const file of files) {
      // Clipboard images usually don't have a .path — use buffer route
      if (file.path) {
        stageFromPaths(session, chatId, [file.path])
      } else {
        const reader = new FileReader()
        reader.onload = () => {
          const ext = extFromName(file.name || 'paste.png')
          const name = file.name || `clipboard-${Date.now()}.${ext || 'png'}`
          stageFromBuffer(session, chatId, reader.result, name)
        }
        reader.readAsArrayBuffer(file)
      }
    }
  })
}

// ─── Toast ───────────────────────────────────────────────────────────────────

function showToast(chatId, message) {
  const msgsEl = document.getElementById('chat-msgs-' + chatId)
  if (!msgsEl) return
  const toast = document.createElement('div')
  toast.className = 'chat-msg chat-msg-system'
  toast.style.cssText = 'opacity:0.7; font-size:11px; padding:4px 24px; color:var(--amber,#d4a574);'
  toast.textContent = message
  msgsEl.appendChild(toast)
  setTimeout(() => toast.remove(), 5000)
}
```

**Step 2: Verify**

Module is ESM — confirm it parses without errors when imported (next task wires it).

**Step 3: Commit**

```bash
git add ace-desktop/renderer/modules/attachment-handler.js
git commit -m "feat(attachments): renderer attachment handler module"
```

---

### Task 5: Wire Attachments into Session Manager

**Files:**
- Modify: `renderer/modules/session-manager.js`

This is the integration task — touches multiple spots in session-manager.js. Each sub-step is one edit.

**Step 1: Add import**

At the top of session-manager.js, add with other imports:

```js
import { pickAndStage, wireDropZone, wirePasteHandler, injectAttachments, consumeAttachments, renderChipTray, renderMsgAttachments, wireMsgAttachmentClicks } from './attachment-handler.js'
```

**Step 2: Initialize pendingAttachments on session creation**

Find where sessions are initialized (look for where `s.messages = []` or equivalent is set). Add:

```js
s.pendingAttachments = []
```

**Step 3: Add chip tray HTML to pane template**

In the pane template string (around line 959), add between `.chat-controls` div and `.chat-input-area` div:

```html
<div class="chat-attachments" id="chat-attachments-${id}"></div>
```

**Step 4: Add paperclip button to input area**

In the `.chat-input-area` div (around line 977), add the paperclip button before the textarea:

```html
<button class="chat-attach-btn" id="chat-attach-${id}" title="Attach · drag, paste, or click" aria-label="Attach file">
  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21.44 11.05l-9.19 9.19a6 6 0 0 1-8.49-8.49l9.19-9.19a4 4 0 0 1 5.66 5.66l-9.2 9.19a2 2 0 0 1-2.83-2.83l8.49-8.49"/></svg>
</button>
```

**Step 5: Wire paperclip click + drop + paste after pane creation**

After the pane is appended to DOM and event listeners are wired (find the area where `inputEl` listeners are set up, around line 1048+), add:

```js
// Attachment handlers
const attachBtn = document.getElementById('chat-attach-' + id)
if (attachBtn) {
  attachBtn.addEventListener('click', () => pickAndStage(s, id))
}
wireDropZone(s, id)
wirePasteHandler(s, id)
```

**Step 6: Inject attachments at send time**

In `sendChatMessage()` (around line 20-102), just before the call to `window.ace.chat.send()` (line 102), modify:

```js
// Inject attachment @paths into prompt
const attachedFiles = consumeAttachments(s)
const finalPrompt = injectAttachments({ pendingAttachments: attachedFiles }, prompt.trim())

// Store attachments in message record
s.messages[s.messages.length - 1].attachments = attachedFiles.length ? attachedFiles : undefined

// Clear chip tray
renderChipTray(s, id)

// Send to backend
window.ace.chat.send(id, finalPrompt, s.claudeSessionId, opts)
```

Replace the existing `window.ace.chat.send(id, prompt.trim(), s.claudeSessionId, opts)` line.

**Step 7: Render attachment chips in user message bubble**

In the user message DOM creation (around line 47-48), change the innerHTML to include attachment chips:

```js
const attachHtml = renderMsgAttachments(s.pendingAttachments)
userMsg.innerHTML = `<div class="chat-msg-label">YOU</div>${attachHtml}<div class="chat-msg-content">${escapeHtml(prompt.trim())}</div>`
```

And after appending, wire clicks:

```js
wireMsgAttachmentClicks(userMsg)
```

Same for queued messages (around line 36-38) if attachments are present.

**Step 8: Verify (full flow)**

Run `npm start`:
1. Open a Terminal session
2. Drag an image file onto the input area → chip appears in tray
3. Click paperclip → file dialog opens, select file → chip appears
4. Copy a screenshot to clipboard, paste in textarea → chip appears
5. Click × on a chip → chip removed
6. Type a message and send → message bubble shows attachment chips above text
7. Confirm DevTools console shows `@00-System/chat-attachments/...` in the prompt
8. Confirm `00-System/chat-attachments/` folder exists with saved files

**Step 9: Commit**

```bash
git add ace-desktop/renderer/modules/session-manager.js
git commit -m "feat(attachments): wire into session manager — full send flow"
```

---

### Task 6: Wire Attachments into Agent Manager

**Files:**
- Modify: `renderer/modules/agent-manager.js`

The Agents view uses `sendChatMessage` and `wireChatListeners` imported from session-manager. Check whether the rendered chat panes in Agents already share the same template. If they do, the session-manager wiring from Task 5 may already cover Agents.

**Step 1: Audit agent pane creation**

Read the agent pane HTML template in `agent-manager.js`. If it builds its own `.chat-input-area` (separate from session-manager's template), add the same elements:
- `<div class="chat-attachments" id="chat-attachments-${id}"></div>` before input area
- Paperclip button inside input area
- Wire `pickAndStage`, `wireDropZone`, `wirePasteHandler` after pane creation

If agents reuse `session-manager`'s pane builder, skip — Task 5 already covers it.

**Step 2: Initialize pendingAttachments**

Wherever agent sessions are created in state (`state.agentSessions[id] = {...}`), add:

```js
pendingAttachments: []
```

**Step 3: Verify**

Run `npm start`, open Agents view, spawn an agent pane. Confirm:
- Paperclip button visible
- Drag-drop shows overlay
- Chip tray works
- Send includes `@` paths

**Step 4: Commit**

```bash
git add ace-desktop/renderer/modules/agent-manager.js
git commit -m "feat(attachments): wire into agent manager panes"
```

---

### Task 7: Session Persistence — Attachments in Saved History

**Files:**
- Modify: `renderer/modules/session-manager.js` (message restore path)

**Step 1: Find session restore code**

Search for where saved messages are replayed into the DOM on session restore (look for message iteration that rebuilds `chat-msg-user` divs). Add attachment chip rendering there:

```js
const attachHtml = renderMsgAttachments(msg.attachments)
el.innerHTML = `<div class="chat-msg-label">YOU</div>${attachHtml}<div class="chat-msg-content">${escapeHtml(msg.content)}</div>`
wireMsgAttachmentClicks(el)
```

**Step 2: Verify**

1. Send a message with an attachment
2. Switch to another session tab, then back
3. Confirm attachment chips still render in the historical message
4. Click the chip → file opens in system viewer

**Step 3: Commit**

```bash
git add ace-desktop/renderer/modules/session-manager.js
git commit -m "feat(attachments): persist attachment chips in session history"
```

---

### Task 8: Edge Cases + Polish

**Files:**
- Modify: `renderer/modules/attachment-handler.js` (minor fixes)

**Step 1: Missing-file check for historical chips**

In `renderMsgAttachments()`, the chips need a `missing` class when the file no longer exists. Since we're in the renderer and can't do `fs.existsSync`, add a `data-path` attribute and handle in `wireMsgAttachmentClicks`:

```js
// In wireMsgAttachmentClicks, after getting absPath:
// Check if file exists via a quick IPC or just let shell.openPath fail gracefully
chip.addEventListener('click', async () => {
  const p = chip.dataset.path
  if (!p) return
  try {
    await window.ace.attachments.openFile(p)
  } catch {
    chip.classList.add('missing')
    chip.title = 'File no longer available'
  }
})
```

**Step 2: Multiple files in single drop**

Already handled — `stageFromPaths` iterates the array. Verify with 3+ files drag-dropped at once.

**Step 3: Verify edge cases**

1. Drop an unsupported file (`.heic`, `.docx`) → toast appears, no chip
2. Drop a file >25MB → toast shows size error
3. Drop 5 files at once → all 5 chips appear
4. Delete an attached file from Finder, then click its chip in history → chip goes muted
5. Paste plain text (no images) → normal text paste, no chip created

**Step 4: Commit**

```bash
git add ace-desktop/renderer/modules/attachment-handler.js
git commit -m "feat(attachments): edge case handling — missing files, unsupported types"
```

---

### Task 9: Final Integration Test

Manual test checklist — run through on Mac:

- [ ] Drag PNG → chip → send → bubble shows chip → Claude responds with image context
- [ ] Drag PDF → chip → send → bubble shows chip → Claude responds with PDF content
- [ ] Paste screenshot (Cmd+Shift+4, then Cmd+V) → chip → send → works
- [ ] Paperclip → native dialog → multi-select 2 files → both chip → send → works
- [ ] Remove chip (×) before send → removed file not in prompt
- [ ] Chip tray hidden when 0 attachments
- [ ] Drop overlay appears/disappears on drag enter/leave
- [ ] Unsupported type (.docx) → toast, no chip
- [ ] >25MB file → toast, no chip
- [ ] >5MB file → amber chip background
- [ ] Session switch + back → historical attachment chips persist
- [ ] Agents view → same flow works
- [ ] `.gitignore` has `00-System/chat-attachments/` line
- [ ] `00-System/chat-attachments/YYYY-MM-DD/` folder has sanitized filenames
- [ ] Terminal raw mode unaffected (no attachment UI visible)

No commit — this is verification only.

---

### Summary

| Task | Files | What |
|------|-------|------|
| 1 | ipc-channels.js, preload.js | IPC channels + preload bridge |
| 2 | attachment-manager.js (new), main.js | Main-process save/pick handlers |
| 3 | chat.css | Chip tray + overlay + paperclip CSS |
| 4 | attachment-handler.js (new) | Renderer attachment pipeline module |
| 5 | session-manager.js | Wire into Terminal rendered chats |
| 6 | agent-manager.js | Wire into Agents rendered chats |
| 7 | session-manager.js | Persist chips in saved history |
| 8 | attachment-handler.js | Edge cases + polish |
| 9 | — | Final integration test |
