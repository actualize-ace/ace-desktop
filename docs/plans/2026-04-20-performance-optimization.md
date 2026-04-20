# ACE Desktop Performance Optimization — Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Eliminate all identified performance bottlenecks — O(n²) streaming, 15s startup blocking, dashboard sync I/O, leaked timers/listeners — through 28 surgical, independently-testable changes.

**Architecture:** Each task is one atomic change. No test framework exists — verification is manual via `npm start` + DevTools (Performance tab, Console, Memory tab). Every task ships one commit. Phases are ordered by impact: critical streaming fixes first, then startup/IPC, then renderer efficiency, then resource cleanup.

**Tech Stack:** Electron (main + renderer), vanilla JS (no framework), node-pty, better-sqlite3, chokidar, marked, DOMPurify

**Important:** No batching of changes. Make one edit, verify in the running app, commit. Kill the Electron process by PID (`kill <PID>`), not by `pkill`. Use `env -u ELECTRON_RUN_AS_NODE npm start` to launch from this terminal (ELECTRON_RUN_AS_NODE is set by Claude Code and breaks Electron).

---

## Phase 1: Critical Streaming Fixes (Highest ROI)

### Task 1: Add RAF debouncing to Oracle streaming

Oracle re-parses the entire message on every single `text_delta` event. Session-manager already has a RAF + settled/tail pattern — port it.

**Files:**
- Modify: `renderer/views/oracle.js:60-106`

**Step 1: Add RAF-debounced render function at module level**

Above the `sendOracleQuery` function, add:

```javascript
let _oraclePendingRAF = null

function scheduleOracleRender(el, text, msgsEl) {
  if (_oraclePendingRAF) return
  _oraclePendingRAF = requestAnimationFrame(() => {
    _oraclePendingRAF = null
    el.innerHTML = `<div class="md-body">${DOMPurify.sanitize(marked.parse(text), SANITIZE_CONFIG)}</div>`
    msgsEl.scrollTop = msgsEl.scrollHeight
  })
}
```

**Step 2: Replace direct innerHTML writes in the stream handler**

In the `content_block_delta` handler (~line 81), replace the direct innerHTML + scrollTop with:

```javascript
// OLD (line 81):
oracleAssistantEl.innerHTML = `<div class="md-body">${DOMPurify.sanitize(marked.parse(oracleStreamText), SANITIZE_CONFIG)}</div>`
msgsEl.scrollTop = msgsEl.scrollHeight

// NEW:
scheduleOracleRender(oracleAssistantEl, oracleStreamText, msgsEl)
```

Keep the `result` handler (line 89) and `exit` handler (line 101) doing full renders — those fire once and need `postProcessCodeBlocks`.

**Step 3: Cancel pending RAF on cleanup**

At the end of the `result` and `exit` handlers, cancel any pending RAF:

```javascript
if (_oraclePendingRAF) { cancelAnimationFrame(_oraclePendingRAF); _oraclePendingRAF = null }
```

**Step 4: Verify**

Run: `env -u ELECTRON_RUN_AS_NODE npm start`
- Open Oracle panel, send a long query ("Explain the ACE Triad in detail with examples")
- Open DevTools → Performance tab → Record during streaming
- Confirm: no `marked.parse` calls between RAF frames (should see batched updates at ~16ms intervals)
- Confirm: final message still renders correctly with code blocks highlighted

**Step 5: Commit**

```bash
git add ace-desktop/renderer/views/oracle.js
git commit -m "perf(oracle): RAF-debounce streaming renders — eliminates 200+ parse calls per response"
```

---

### Task 2: Incremental markdown rendering in session-manager

`renderChatStream` re-parses ALL settled text from position 0 on every boundary advance. Instead, cache last settled HTML and only parse the new delta.

**Files:**
- Modify: `renderer/modules/session-manager.js:171-198`

**Step 1: Change renderChatStream to incremental parsing**

Replace the existing `renderChatStream` function (lines 171-198) with:

```javascript
export function renderChatStream(id, sessionsObj) {
  sessionsObj = sessionsObj || state.sessions
  const s = sessionsObj[id]
  if (!s || !s._currentAssistantEl) return
  const contentEl = s._currentAssistantEl.querySelector('.chat-msg-content')
  const settledEls = contentEl.querySelectorAll('.chat-settled')
  const tailEls = contentEl.querySelectorAll('.chat-tail')
  const settledEl = settledEls[settledEls.length - 1]
  const tailEl = tailEls[tailEls.length - 1]

  const boundary = findSettledBoundaryFrom(s.currentStreamText, s._settledBoundary)
  if (boundary > s._settledBoundary) {
    // Incremental: only parse text added since last boundary
    const deltaText = s.currentStreamText.slice(s._settledBoundary, boundary)
    const deltaRaw = marked.parse(deltaText)
    const deltaSafe = DOMPurify.sanitize(deltaRaw, SANITIZE_CONFIG)

    // Append delta HTML to settled element instead of replacing
    const deltaContainer = document.createElement('div')
    deltaContainer.innerHTML = deltaSafe
    while (deltaContainer.firstChild) settledEl.appendChild(deltaContainer.firstChild)

    // Post-process only the newly added nodes
    // (code blocks check .closest('.code-block-wrapper') so already-processed blocks are skipped)
    postProcessCodeBlocks(settledEl)
    postProcessWikilinks(settledEl)

    s._settledBoundary = boundary
    s._settledHTML += deltaSafe
  }

  const tail = s.currentStreamText.slice(boundary)
  tailEl.innerHTML = tail ? renderTail(tail) : ''

  scrollChatToBottom(id, 120)
}
```

**Step 2: Verify**

Run: `env -u ELECTRON_RUN_AS_NODE npm start`
- Open a chat session, send a prompt that produces a long response with code blocks
- Watch the streaming — text should appear smoothly, code blocks should highlight
- Send a second message — verify the settled text from the first message is intact
- Open DevTools → Performance → Record during streaming
- Confirm: `marked.parse` calls process only delta text (small slices), not growing full text

**Step 3: Commit**

```bash
git add ace-desktop/renderer/modules/session-manager.js
git commit -m "perf(chat): incremental markdown rendering — O(n) instead of O(n²) streaming"
```

---

### Task 3: Track processed code blocks to avoid re-traversal

`postProcessCodeBlocks` uses `.closest('.code-block-wrapper')` to skip already-wrapped blocks but still queries every `pre > code` on every call. Add a data attribute to mark processed blocks.

**Files:**
- Modify: `renderer/modules/chat-renderer.js:195-221`

**Step 1: Add processed marker**

In `postProcessCodeBlocks`, after wrapping (line 219), add a data attribute. And at the top of the forEach, check for it:

```javascript
export function postProcessCodeBlocks(container) {
  container.querySelectorAll('pre > code').forEach(codeEl => {
    if (codeEl.closest('.code-block-wrapper')) return
    if (codeEl.dataset.codeProcessed) return  // already handled
    codeEl.dataset.codeProcessed = '1'
    const pre = codeEl.parentElement
    const langClass = [...codeEl.classList].find(c => c.startsWith('language-'))
    const lang = langClass ? langClass.replace('language-', '') : ''
    if (lang && HL_LANGS[lang.toLowerCase()]) {
      codeEl.innerHTML = syntaxHighlight(codeEl.textContent, lang)
    }
    const wrapper = document.createElement('div')
    wrapper.className = 'code-block-wrapper'
    const header = document.createElement('div')
    header.className = 'code-block-header'
    header.innerHTML = `<span class="code-lang">${escapeHtml(lang || 'code')}</span><button class="code-copy-btn">Copy</button>`
    header.querySelector('.code-copy-btn').addEventListener('click', () => {
      navigator.clipboard.writeText(codeEl.textContent)
      const btn = header.querySelector('.code-copy-btn')
      btn.textContent = 'Copied!'
      setTimeout(() => btn.textContent = 'Copy', 1500)
    })
    pre.parentNode.insertBefore(wrapper, pre)
    wrapper.appendChild(header)
    wrapper.appendChild(pre)
  })
}
```

**Step 2: Verify**

- Send a message that produces multiple code blocks
- Confirm blocks render with syntax highlighting and copy buttons
- In DevTools Console, run: `document.querySelectorAll('[data-code-processed]').length` — should match number of code blocks

**Step 3: Commit**

```bash
git add ace-desktop/renderer/modules/chat-renderer.js
git commit -m "perf(chat): skip already-processed code blocks via data attribute"
```

---

## Phase 2: Main Process — Startup & IPC

### Task 4: Extract shared PATH augmentation module

Four files duplicate PATH-building logic. Extract to one shared module.

**Files:**
- Create: `src/get-augmented-env.js`
- Modify: `main.js:108-147`
- Modify: `src/pty-manager.js:9-39`
- Modify: `src/chat-manager.js:141-183`
- Modify: `src/preflight.js:23-58`

**Step 1: Create the shared module**

```javascript
// src/get-augmented-env.js — Single source of truth for PATH augmentation.
// Packaged Electron apps inherit a minimal system PATH that lacks Homebrew,
// nvm, volta, fnm, mise, and asdf paths. This module computes the augmented
// PATH once at require-time and caches it for the app lifetime.

const path = require('path')
const os = require('os')

const home = os.homedir()
const sep = process.platform === 'win32' ? ';' : ':'

let _augmentedPath
if (process.platform === 'win32') {
  _augmentedPath = [
    path.join(process.env.APPDATA || '', 'npm'),
    path.join(process.env.LOCALAPPDATA || '', 'Programs', 'nodejs'),
    process.env.PATH || '',
  ].filter(Boolean).join(sep)
} else if (process.platform === 'darwin') {
  _augmentedPath = [
    '/opt/homebrew/bin',
    '/usr/local/bin',
    '/usr/bin',
    path.join(home, '.nvm', 'versions', 'node', 'current', 'bin'),
    path.join(home, '.volta', 'bin'),
    path.join(home, '.fnm', 'aliases', 'default', 'bin'),
    path.join(home, '.local', 'share', 'mise', 'shims'),
    path.join(home, '.asdf', 'shims'),
    path.join(home, '.local', 'bin'),
    process.env.PATH || '',
  ].filter(Boolean).join(sep)
} else {
  _augmentedPath = [
    '/usr/local/bin',
    '/usr/bin',
    '/snap/bin',
    path.join(home, '.local', 'bin'),
    path.join(home, '.nvm', 'versions', 'node', 'current', 'bin'),
    path.join(home, '.volta', 'bin'),
    path.join(home, '.local', 'share', 'fnm', 'aliases', 'default', 'bin'),
    path.join(home, '.local', 'share', 'mise', 'shims'),
    path.join(home, '.asdf', 'shims'),
    process.env.PATH || '',
  ].filter(Boolean).join(sep)
}

const augmentedEnv = Object.freeze({ ...process.env, PATH: _augmentedPath })

module.exports = { augmentedPath: _augmentedPath, augmentedEnv }
```

**Step 2: Replace in main.js detectClaudeBinary**

At the top of `main.js`, add:
```javascript
const { augmentedPath, augmentedEnv } = require('./src/get-augmented-env')
```

In `detectClaudeBinary()` (lines 108-147), delete the entire PATH-building block (lines 111-147) and replace with:
```javascript
function detectClaudeBinary() {
  let found = null
  try {
    const result = execSync(`${WHICH_CMD} claude`, { encoding: 'utf8', env: augmentedEnv }).trim().split(/\r?\n/)[0]
    if (result && fs.existsSync(result)) found = result
  } catch {}
  // ... rest of function unchanged from line 158 onward
```

**Step 3: Replace in pty-manager.js**

Delete `getAugmentedPath()` function (lines 9-39). Replace with:
```javascript
const { augmentedPath } = require('./get-augmented-env')
```

Replace line 49 (`const augmentedPath = getAugmentedPath()`) — just delete it; `augmentedPath` is now module-level.

**Step 4: Replace in chat-manager.js**

Delete the PATH-building block (lines 141-183). Replace with:
```javascript
const { augmentedPath, augmentedEnv } = require('./get-augmented-env')
```

Update the `spawn()` call (line 190) to use `augmentedEnv` directly in the env option.

**Step 5: Replace in preflight.js**

Delete the PATH-building block (lines 23-58). At the top, add:
```javascript
const { augmentedEnv } = require('./get-augmented-env')
```

Use `augmentedEnv` in the `execSync` call (line 61).

**Step 6: Verify**

Run: `env -u ELECTRON_RUN_AS_NODE npm start`
- App should launch normally
- Open a chat session — confirm messages send and stream back
- Open terminal mode — confirm pty spawns correctly
- Check DevTools Console for any PATH-related errors

**Step 7: Commit**

```bash
git add ace-desktop/src/get-augmented-env.js ace-desktop/main.js ace-desktop/src/pty-manager.js ace-desktop/src/chat-manager.js ace-desktop/src/preflight.js
git commit -m "refactor: extract shared PATH augmentation — eliminates 4 duplicate copies"
```

---

### Task 5: Make detectClaudeBinary async

Three sequential `execSync` calls with 5s timeouts = up to 15s blocking. Convert to async.

**Files:**
- Modify: `main.js:108-189`

**Step 1: Convert detectClaudeBinary to async**

Replace the function with:

```javascript
async function detectClaudeBinary() {
  const { execFile } = require('child_process')
  const util = require('util')
  const execFileAsync = util.promisify(execFile)

  // Try PATH lookup first
  let found = null
  try {
    const { stdout } = await execFileAsync(WHICH_CMD, ['claude'], { env: augmentedEnv, timeout: 3000 })
    const result = stdout.trim().split(/\r?\n/)[0]
    if (result && fs.existsSync(result)) found = result
  } catch {}

  // Try login shell
  if (!found && process.platform !== 'win32') {
    try {
      const shell = process.env.SHELL || '/bin/zsh'
      const { stdout } = await execFileAsync(shell, ['-l', '-c', 'which claude'], { timeout: 3000 })
      const result = stdout.trim().split(/\r?\n/)[0]
      if (result && fs.existsSync(result)) found = result
    } catch {}
  }

  // Try known paths
  if (!found) {
    for (const p of KNOWN_PATHS) {
      if (fs.existsSync(p)) { found = p; break }
    }
  }

  if (!found) return null

  // Verify it works
  try {
    const { stdout } = await execFileAsync(found, ['--version'], { env: augmentedEnv, timeout: 3000 })
    return { path: found, version: stdout.trim() }
  } catch {
    return { path: found, version: null }
  }
}
```

**Step 2: Update all callers to await**

The `DETECT_BINARY` IPC handler (~line 462) already uses `ipcMain.handle` which supports async. Update:

```javascript
ipcMain.handle(ch.DETECT_BINARY, async () => detectClaudeBinary())
```

Similarly update the `PREFLIGHT_RECHECK_BINARY` handler (~line 475) if it calls `detectClaudeBinary`.

**Step 3: Verify**

Run: `env -u ELECTRON_RUN_AS_NODE npm start`
- App should launch without delay
- Open Settings → Binary path should show detected Claude CLI path
- If Claude isn't installed, setup screen should show gracefully

**Step 4: Commit**

```bash
git add ace-desktop/main.js
git commit -m "perf(startup): async binary detection — eliminates 15s worst-case main-thread block"
```

---

### Task 6: Cache loadConfig with file-watch invalidation

`loadConfig()` does `readFileSync` + `JSON.parse` on every IPC call. Cache it.

**Files:**
- Modify: `main.js:64-70`

**Step 1: Add caching to loadConfig**

Replace the `loadConfig` function:

```javascript
let _configCache = null
let _configWatcher = null

function loadConfig() {
  if (_configCache) return _configCache
  try {
    _configCache = JSON.parse(fs.readFileSync(getConfigPath(), 'utf8'))
    // Watch for external changes (first call only)
    if (!_configWatcher) {
      try {
        _configWatcher = fs.watch(getConfigPath(), () => { _configCache = null })
      } catch {} // file may not exist yet
    }
    return _configCache
  } catch {
    return null
  }
}

function invalidateConfigCache() { _configCache = null }
```

**Step 2: Invalidate on save/patch**

In `saveConfig()` (~line 72), add `invalidateConfigCache()` after `writeFileSync`.
In the `PATCH_CONFIG` handler (~line 516), add `invalidateConfigCache()` after saving.

**Step 3: Verify**

- Launch app, open Settings, change a setting → confirm it persists after restart
- In DevTools Console, no errors related to config loading

**Step 4: Commit**

```bash
git add ace-desktop/main.js
git commit -m "perf: cache loadConfig with fs.watch invalidation"
```

---

### Task 7: Batch dashboard IPC into single handler

13 separate IPC calls on dashboard load → 1 batched call returning all data.

**Files:**
- Modify: `src/ipc-channels.js` (add new channel)
- Modify: `main.js:586-639` (add batched handler)
- Modify: `renderer/dashboard.js` (use batched call)
- Modify: `preload.js` (expose new IPC)

**Step 1: Add channel constant**

In `src/ipc-channels.js`, add after the `GET_METRICS` line:

```javascript
GET_DASHBOARD_BATCH: 'get-dashboard-batch',
```

**Step 2: Add batched handler in main.js**

After the existing dashboard handlers (they stay for backward compat), add:

```javascript
ipcMain.handle(ch.GET_DASHBOARD_BATCH, async () => {
  const vp = global.VAULT_PATH
  const reader = require('./src/vault-reader')
  const db = require('./src/db-reader')

  // Run all reads concurrently via promises (each is sync internally but parallelized at scheduler level)
  const [state, pipeline, followUps, metrics, velocity, rhythm, people, patterns, usage, northStar] = await Promise.all([
    Promise.resolve().then(() => { try { return reader.parseState(vp) } catch (e) { return { error: e.message } } }),
    Promise.resolve().then(() => { try { return db.getPipeline() } catch (e) { return { error: e.message } } }),
    Promise.resolve().then(() => { try { return reader.parseFollowUps(vp) } catch (e) { return { error: e.message } } }),
    Promise.resolve().then(() => {
      try {
        const m = db.getMetrics()
        m._signals = require('./src/synthesizer').parseSignalDetails(vp)
        return m
      } catch (e) { return { error: e.message } }
    }),
    Promise.resolve().then(() => { try { return reader.parseExecutionLog(vp, 14) } catch (e) { return { error: e.message } } }),
    Promise.resolve().then(() => { try { return reader.parseRitualRhythm(vp) } catch (e) { return { error: e.message } } }),
    Promise.resolve().then(() => { try { return reader.parsePeople(vp) } catch (e) { return { error: e.message } } }),
    Promise.resolve().then(() => { try { return reader.parsePatterns(vp) } catch (e) { return { error: e.message } } }),
    Promise.resolve().then(() => { try { return require('./src/usage-probe').probe() } catch (e) { return { error: e.message } } }),
    Promise.resolve().then(() => { try { return reader.parseDCAFrontmatter(vp) } catch (e) { return { error: e.message } } }),
  ])

  return { state, pipeline, followUps, metrics, velocity, rhythm, people, patterns, usage, northStar }
})
```

**Step 3: Expose in preload.js**

Add to the dashboard section of `contextBridge.exposeInMainWorld`:

```javascript
getDashboardBatch: () => ipcRenderer.invoke(ch.GET_DASHBOARD_BATCH),
```

**Step 4: Use in dashboard.js**

In the dashboard's data-fetching function, replace the 10+ `Promise.all` of individual calls with:

```javascript
const data = await window.ace.dash.getDashboardBatch()
// Destructure: data.state, data.pipeline, data.followUps, etc.
```

Pass each field to its respective widget renderer.

**Step 5: Verify**

- Launch app → cockpit should load all widgets
- Navigate away and back → widgets should refresh
- DevTools Network: confirm only 1 IPC call instead of 10+

**Step 6: Commit**

```bash
git add ace-desktop/src/ipc-channels.js ace-desktop/main.js ace-desktop/preload.js ace-desktop/renderer/dashboard.js
git commit -m "perf(dashboard): batch 13 IPC calls into single handler — reduces main-thread contention"
```

---

### Task 8: Cache resolveInsideVault with resolved vault root

`fs.realpathSync(global.VAULT_PATH)` runs on every vault file IPC call. Cache the resolved root.

**Files:**
- Modify: `main.js:758-763`

**Step 1: Cache the resolved vault root**

Above `resolveInsideVault`, add:

```javascript
let _realVaultRoot = null
function getRealVaultRoot() {
  if (!_realVaultRoot && global.VAULT_PATH) {
    _realVaultRoot = fs.realpathSync(global.VAULT_PATH)
  }
  return _realVaultRoot
}
```

Update `resolveInsideVault`:

```javascript
function resolveInsideVault(targetPath) {
  const realVault = getRealVaultRoot()
  if (!realVault) return null
  const realTarget = fs.realpathSync(path.resolve(global.VAULT_PATH, targetPath))
  if (!realTarget.startsWith(realVault + path.sep) && realTarget !== realVault) return null
  return realTarget
}
```

Invalidate when vault path changes — in the `SAVE_CONFIG` / `PATCH_CONFIG` handlers, add `_realVaultRoot = null`.

**Step 2: Verify**

- Open Vault view — files should list and open correctly
- Write a file via chat — confirm it saves

**Step 3: Commit**

```bash
git add ace-desktop/main.js
git commit -m "perf: cache resolved vault root — eliminates realpathSync per IPC call"
```

---

## Phase 3: Renderer Efficiency

### Task 9: Fix layout thrashing in scrollChatToBottom

Reading `scrollHeight` after writing to the DOM forces synchronous reflow.

**Files:**
- Modify: `renderer/modules/session-manager.js:274-281`

**Step 1: Batch scroll into RAF**

Replace `scrollChatToBottom`:

```javascript
function scrollChatToBottom(id, threshold) {
  if (state._autoScroll === false) return
  requestAnimationFrame(() => {
    const msgsEl = document.getElementById('chat-msgs-' + id)
    if (!msgsEl) return
    const dist = msgsEl.scrollHeight - msgsEl.scrollTop - msgsEl.clientHeight
    if (dist < (threshold || 120)) msgsEl.scrollTop = msgsEl.scrollHeight
  })
}
```

**Step 2: Verify**

- Stream a long message — auto-scroll should still follow the output
- Scroll up manually during streaming — it should not snap back (threshold logic)
- No visible jank during streaming

**Step 3: Commit**

```bash
git add ace-desktop/renderer/modules/session-manager.js
git commit -m "perf(chat): batch scrollChatToBottom into RAF — eliminates forced reflow"
```

---

### Task 10: Fix sidebar resize reflow loop

`getBoundingClientRect()` on every mousemove during drag forces reflow at 60Hz.

**Files:**
- Modify: `renderer/modules/theme.js:105-130`

**Step 1: Use CSS variable during drag, measure only on mouseup**

Replace the sidebar resize handlers:

```javascript
    handle.addEventListener('mousedown', e => {
      if (sidebar.classList.contains('collapsed')) return
      dragging = true
      startX = e.clientX
      startW = parseFloat(getComputedStyle(sidebar).getPropertyValue('--sidebar-w')) || 200
      sidebar.classList.add('resizing')
      document.body.classList.add('sidebar-resizing')
      e.preventDefault()
    })

    document.addEventListener('mousemove', e => {
      if (!dragging) return
      const delta = e.clientX - startX
      const w = Math.max(SIDEBAR_MIN, Math.min(SIDEBAR_MAX, startW + delta))
      sidebar.style.setProperty('--sidebar-w', w + 'px')
    })

    document.addEventListener('mouseup', () => {
      if (!dragging) return
      dragging = false
      sidebar.classList.remove('resizing')
      document.body.classList.remove('sidebar-resizing')
      const w = parseFloat(getComputedStyle(sidebar).getPropertyValue('--sidebar-w')) || SIDEBAR_DEFAULT
      saveWidth(Math.round(w))
      if (window.fitActive) window.fitActive()
    })
```

The key change: `startW` reads from CSS variable (no reflow), `mouseup` reads from CSS variable (1 reflow instead of 60+).

**Step 2: Verify**

- Drag the sidebar left and right — smooth resize, no stutter
- Double-click resize handle — resets to default
- Sidebar width persists after restart

**Step 3: Commit**

```bash
git add ace-desktop/renderer/modules/theme.js
git commit -m "perf(sidebar): read CSS var instead of getBoundingClientRect during drag"
```

---

### Task 11: Add will-change hints to animations

**Files:**
- Modify: `renderer/styles/animation.css`

**Step 1: Add will-change to animated elements**

Add these rules (append to animation.css):

```css
/* GPU compositing hints for continuous animations */
.status-pulse { will-change: transform, opacity; }
.sidebar-mark.active::before { will-change: transform, box-shadow; }
.orb { will-change: background-position; }
.code-block-wrapper.streaming .code-block-header { will-change: background-position; }
```

**Step 2: Verify**

- DevTools → Rendering → check "Paint flashing" — animated elements should have dedicated layers (no green flash on surrounding content)
- Streaming should feel slightly smoother

**Step 3: Commit**

```bash
git add ace-desktop/renderer/styles/animation.css
git commit -m "perf(css): add will-change hints to continuous animations"
```

---

### Task 12: Debounce file watcher state parses

Rapid file writes trigger multiple full state parses with no debounce.

**Files:**
- Modify: `src/file-watcher.js:43-64`

**Step 1: Add debounce wrapper**

At the top of the module, add:

```javascript
function debounce(fn, ms) {
  let timer
  return (...args) => { clearTimeout(timer); timer = setTimeout(() => fn(...args), ms) }
}
```

**Step 2: Wrap dedicated handlers**

Replace the `dedicatedWatcher.on('change', ...)` callback:

```javascript
  const handleDedicatedChange = debounce((filePath) => {
    if (win.isDestroyed()) return
    const name = path.basename(filePath)

    if (name === 'state.md' || name === 'active.md') {
      try {
        const state = require('./vault-reader').parseState(vaultPath)
        win.webContents.send(ch.DASH_STATE, state)
      } catch {}
    }

    if (name === 'follow-ups.md') {
      try {
        const followUps = require('./vault-reader').parseFollowUps(vaultPath)
        win.webContents.send(ch.DASH_FOLLOWUPS, followUps)
      } catch {}
    }

    if (name === 'sitrep.md') {
      win.webContents.send(ch.DASH_SITREP)
    }
  }, 200)

  dedicatedWatcher.on('change', handleDedicatedChange)
```

Also debounce `sendRefresh`:

```javascript
  const sendRefresh = debounce(() => {
    if (!win.isDestroyed()) win.webContents.send(ch.DASH_REFRESH)
  }, 200)
```

**Step 3: Verify**

- Edit `state.md` in quick succession — console should show only 1 parse, not multiple
- Dashboard should still update within ~200ms of last file change

**Step 4: Commit**

```bash
git add ace-desktop/src/file-watcher.js
git commit -m "perf(watcher): debounce file change handlers at 200ms"
```

---

## Phase 4: Resource Cleanup

### Task 13: Clear agentTimer on window close

`state.agentTimer` runs a 1s interval that's never cleared.

**Files:**
- Modify: `renderer/modules/agent-manager.js:338-347`

**Step 1: Add cleanup on visibility hidden**

The existing code at line 350 already handles visibility changes for pause/resume. Add full cleanup on `beforeunload`:

```javascript
window.addEventListener('beforeunload', () => {
  if (state.agentTimer) { clearInterval(state.agentTimer); state.agentTimer = null }
})
```

Add this right after the `visibilitychange` handler (~line 360).

**Step 2: Verify**

- Open agents, confirm timer dots still animate
- Close and reopen window — no leaked intervals (check DevTools → Performance → timers)

**Step 3: Commit**

```bash
git add ace-desktop/renderer/modules/agent-manager.js
git commit -m "fix(agents): clear agentTimer interval on window close"
```

---

### Task 14: Clear _wordTimer in closeSession

`_wordTimer` is only cleared in `finalizeMessage` — force-closing a streaming session leaks it.

**Files:**
- Modify: `renderer/modules/session-manager.js:867-872`

**Step 1: Add timer cleanup to closeSession**

In `closeSession()` (line 867), after `clearTimer(id)` (line 870), add:

```javascript
  if (s._wordTimer) { clearInterval(s._wordTimer); s._wordTimer = null }
  if (s._pendingRAF) { cancelAnimationFrame(s._pendingRAF); s._pendingRAF = null }
```

**Step 2: Verify**

- Start streaming, then close the session tab mid-stream
- No console errors about writing to removed DOM elements
- Check DevTools → Performance — no orphaned intervals after close

**Step 3: Commit**

```bash
git add ace-desktop/renderer/modules/session-manager.js
git commit -m "fix(sessions): clear wordTimer and pendingRAF on force-close"
```

---

### Task 15: Clean up spawnSession listeners on close

Dropdown and button listeners from `spawnSession` accumulate across session lifecycle.

**Files:**
- Modify: `renderer/modules/session-manager.js:680-720` and `closeSession` (~867)

**Step 1: Store listener references for cleanup**

In `spawnSession`, after creating listeners (line 682+), store AbortController references. Replace:

```javascript
  // Create abort controller for session-scoped listeners
  const sessionAC = new AbortController()
  const sig = { signal: sessionAC.signal }

  document.getElementById('chat-model-' + id)?.addEventListener('change', function () {
    if (state.sessions[id]) state.sessions[id].model = this.value
    updateContextBar(id, state.sessions[id]?.contextInputTokens || 0)
    updateTelemetry()
  }, sig)

  document.getElementById('ctx-bar-' + id)?.addEventListener('click', () => {
    resetContext(id)
  }, sig)

  document.getElementById('stab-move-' + id)?.addEventListener('click', (e) => {
    e.stopPropagation()
    moveToOtherGroup(id)
  }, sig)

  document.getElementById('session-duration-' + id)?.addEventListener('change', (e) => {
    const val = parseInt(e.target.value)
    if (val) {
      startTimer(id, val)
      e.target.style.display = 'none'
    } else {
      clearTimer(id)
    }
  }, sig)
```

Store the controller on the session object:

```javascript
  state.sessions[id]._sessionAC = sessionAC
```

**Step 2: Abort in closeSession**

In `closeSession`, add before `delete state.sessions[id]`:

```javascript
  if (s._sessionAC) s._sessionAC.abort()
```

**Step 3: Verify**

- Open and close 5 sessions rapidly
- DevTools → Memory → Take heap snapshot → search for "EventListener" — count should not grow

**Step 4: Commit**

```bash
git add ace-desktop/renderer/modules/session-manager.js
git commit -m "fix(sessions): abort session-scoped listeners on close via AbortController"
```

---

### Task 16: LRU cap on session-reader _metaCache

Unbounded Map grows indefinitely.

**Files:**
- Modify: `src/session-reader.js:7-8`

**Step 1: Add size cap**

Replace `_metaCache` with a bounded version:

```javascript
const MAX_META_CACHE = 200
const _metaCache = new Map()

function cacheSet(key, value) {
  if (_metaCache.size >= MAX_META_CACHE) {
    // Delete oldest entry (first key in insertion order)
    const firstKey = _metaCache.keys().next().value
    _metaCache.delete(firstKey)
  }
  _metaCache.set(key, value)
}
```

Then replace all `_metaCache.set(key, value)` calls in the file with `cacheSet(key, value)`.

**Step 2: Verify**

- Open History view — sessions should list and load
- Open 200+ sessions worth of history (or verify via console that cache size stays bounded)

**Step 3: Commit**

```bash
git add ace-desktop/src/session-reader.js
git commit -m "fix(history): LRU cap on session metadata cache at 200 entries"
```

---

### Task 17: Prune messages array during soft GC

`softGcSessions` prunes DOM but leaves the `messages[]` array unbounded.

**Files:**
- Modify: `renderer/modules/session-manager.js:824-865`

**Step 1: Add message pruning after DOM pruning**

Inside `softGcSessions`, after clearing streaming buffers (line 854), add:

```javascript
    // Prune in-memory message history to match DOM
    if (s.messages && s.messages.length > SOFT_GC_MSG_KEEP) {
      s.messages = s.messages.slice(-SOFT_GC_MSG_KEEP)
    }
```

**Step 2: Verify**

- Send 50+ messages in a session
- Trigger soft GC (wait for refresh-engine or call `softGcSessions()` from console)
- Check `state.sessions[id].messages.length` — should be <= 40

**Step 3: Commit**

```bash
git add ace-desktop/renderer/modules/session-manager.js
git commit -m "fix(memory): prune messages array during soft GC — prevents unbounded growth"
```

---

## Phase 5: Deferred Loading

### Task 18: Defer d3, chart.js, xterm to async loading

These 3 libraries add ~160ms of parse time before first paint.

**Files:**
- Modify: `renderer/index.html` (script tags in head)

**Step 1: Add defer attribute to library script tags**

Change the script tags for d3, chart.js, and xterm from:

```html
<script src="../node_modules/chart.js/dist/chart.umd.js"></script>
<script src="../node_modules/d3/dist/d3.min.js"></script>
<script src="../node_modules/xterm/lib/xterm.js"></script>
```

To:

```html
<script defer src="../node_modules/chart.js/dist/chart.umd.js"></script>
<script defer src="../node_modules/d3/dist/d3.min.js"></script>
<script defer src="../node_modules/xterm/lib/xterm.js"></script>
```

`defer` loads in parallel with HTML parsing but executes in order after DOM is ready — matches ES module behavior without breaking dependency order.

**Step 2: Verify**

- Launch app — dashboard should render (chart widgets need Chart.js)
- Open chat → terminal mode — xterm should initialize
- Open graph view — d3 graph should render
- Check DevTools Console for "Chart is not defined" or "d3 is not defined" errors

**Step 3: Commit**

```bash
git add ace-desktop/renderer/index.html
git commit -m "perf(startup): defer d3/chart.js/xterm loading — unblocks first paint"
```

---

### Task 19: Lazy-load file watcher and db-reader

Both start immediately at window load even if the user hasn't opened dashboard.

**Files:**
- Modify: `main.js:292-296`

**Step 1: Defer startup to after first dashboard request**

Replace the `did-finish-load` block:

```javascript
    mainWindow.webContents.once('did-finish-load', () => {
      require('./src/preflight').run(mainWindow, config.claudeBinaryPath, config.vaultPath)
      // Defer file watcher + DB until first dashboard paint (500ms)
      setTimeout(() => {
        require('./src/file-watcher').start(mainWindow)
        require('./src/db-reader').open(config.vaultPath)
      }, 500)
    })
```

This is a simple 500ms deferral — keeps the window responsive during initial paint while still loading before the user is likely to interact with dashboard widgets.

**Step 2: Verify**

- Launch app — dashboard should still load (the 500ms is well before user interaction)
- File changes should still trigger dashboard updates after initial load
- No errors in console about missing DB reader

**Step 3: Commit**

```bash
git add ace-desktop/main.js
git commit -m "perf(startup): defer file-watcher + db-reader by 500ms — faster first paint"
```

---

### Task 20: Add vault-scanner cache invalidation on file-watcher events

Graph cache is never invalidated by file changes — only by manual `VAULT_GRAPH_INVALIDATE` IPC.

**Files:**
- Modify: `src/file-watcher.js` (add invalidation call)

**Step 1: Invalidate graph cache on cockpit file changes**

In the cockpit watcher's `add` handler (line 77), also invalidate the vault graph:

```javascript
  cockpitWatcher.on('add', (...args) => {
    sendRefresh(...args)
    try { require('./vault-scanner').invalidateCache() } catch {}
  })
```

This ensures new files are picked up in the graph view without requiring a manual refresh.

**Step 2: Verify**

- Open graph view → note the node count
- Create a new .md file in the vault (via chat or manually)
- Switch away from graph and back — new file should appear

**Step 3: Commit**

```bash
git add ace-desktop/src/file-watcher.js
git commit -m "fix(graph): invalidate vault-scanner cache on new file detection"
```

---

## Summary

| Phase | Tasks | Impact |
|-------|-------|--------|
| 1: Streaming | 1-3 | Eliminates O(n²) markdown parsing, 200+ redundant parse calls |
| 2: Startup/IPC | 4-8 | Kills 15s startup block, removes 4 duplicate modules, batches 13 IPC calls |
| 3: Renderer | 9-12 | Eliminates forced reflows, GPU compositing, debounced watchers |
| 4: Cleanup | 13-17 | Fixes timer leaks, listener accumulation, unbounded caches |
| 5: Deferred | 18-20 | Faster first paint, lazy initialization, cache coherence |

**Total: 20 tasks, each independently testable and committable.**
