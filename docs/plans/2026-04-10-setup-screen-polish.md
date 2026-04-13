# Setup Screen Polish — Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Make the setup screen and app launch resilient for first client deploy — binary verification, vault structure validation, spawn guards, and a clean first-60-seconds experience.

**Architecture:** New `src/preflight.js` module runs async checks (binary health + vault structure) after window loads, sends results via IPC. Renderer surfaces results in titlebar status, dashboard banner, and chat placeholder. Spawn guards in chat-manager and pty-manager catch mid-session binary loss. Setup screen gates on vault validity.

**Tech Stack:** Electron IPC, existing vault-health.js, Node fs/child_process

**Design doc:** [2026-04-10-setup-screen-polish-design.md](2026-04-10-setup-screen-polish-design.md)

---

### Task 1: Add IPC Channels

**Files:**
- Modify: `src/ipc-channels.js:95` (end of file)

**Step 1: Add new channel constants**

At end of `module.exports` object (before the closing `}`), add:

```javascript
  // Preflight
  PREFLIGHT_RESULT:         'preflight-result',
  PREFLIGHT_RECHECK_BINARY: 'preflight-recheck-binary',
```

**Step 2: Verify no duplicate keys**

Run: `grep -c 'preflight' src/ipc-channels.js`
Expected: 2

**Step 3: Commit**

```bash
git add src/ipc-channels.js
git commit -m "feat(desktop): add preflight IPC channels"
```

---

### Task 2: Create Pre-flight Module (`src/preflight.js`)

**Files:**
- Create: `src/preflight.js`
- Reference: `src/vault-health.js` (existing, read-only)

**Step 1: Write the module**

```javascript
'use strict'

const fs = require('fs')
const { execSync } = require('child_process')
const ch = require('./ipc-channels')
const { checkVaultHealth } = require('./vault-health')

/**
 * Verify Claude binary: exists, executable, responds to --version.
 */
function checkBinary(binaryPath) {
  if (!binaryPath || !fs.existsSync(binaryPath)) {
    return { ok: false, error: 'missing', path: binaryPath }
  }

  try {
    fs.accessSync(binaryPath, fs.constants.X_OK)
  } catch {
    return { ok: false, error: 'not-executable', path: binaryPath }
  }

  try {
    const version = execSync(`"${binaryPath}" --version`, {
      encoding: 'utf8',
      timeout: 5000,
      env: process.env,
    }).trim()
    return { ok: true, path: binaryPath, version }
  } catch {
    return { ok: false, error: 'not-responding', path: binaryPath }
  }
}

/**
 * Check vault structure, split missing items into critical vs non-critical.
 */
function checkVault(vaultPath) {
  if (!vaultPath || !fs.existsSync(vaultPath)) {
    return { ok: false, error: 'missing', score: 0, critical: [], other: [] }
  }

  const health = checkVaultHealth(vaultPath)
  if (health.error) {
    return { ok: false, error: health.error, score: 0, critical: [], other: [] }
  }

  const critical = health.missing.filter(m => m.tier === 'engine')
  const other = health.missing.filter(m => m.tier !== 'engine')

  return {
    ok: health.ok,
    score: health.score,
    critical,
    other,
  }
}

/**
 * Run all pre-flight checks and send results to renderer.
 * Called once after window loads. Non-blocking — window renders immediately.
 */
function run(win, binaryPath, vaultPath) {
  // Run async so window paint isn't blocked
  setImmediate(() => {
    const binary = checkBinary(binaryPath)
    const vault = checkVault(vaultPath)

    if (!win.isDestroyed()) {
      win.webContents.send(ch.PREFLIGHT_RESULT, { binary, vault })
    }
  })
}

module.exports = { run, checkBinary, checkVault }
```

**Step 2: Verify module loads without error**

Run: `cd ace-desktop && node -e "require('./src/preflight')"`
Expected: exits cleanly (code 0)

**Step 3: Commit**

```bash
git add src/preflight.js
git commit -m "feat(desktop): add preflight module — binary + vault health checks"
```

---

### Task 3: Wire Pre-flight into Main Process

**Files:**
- Modify: `main.js:149-181` (app.whenReady block)
- Modify: `main.js:83-96` (detectClaudeBinary)

**Step 1: Enhance `detectClaudeBinary()` to verify binary works**

Replace `main.js` lines 83-96 (`function detectClaudeBinary()`) with:

```javascript
function detectClaudeBinary() {
  // Try which first
  let found = null
  try {
    const result = execSync('which claude', { encoding: 'utf8', env: process.env }).trim()
    if (result && fs.existsSync(result)) found = result
  } catch {}

  // Try known paths
  if (!found) {
    for (const p of KNOWN_PATHS) {
      if (fs.existsSync(p)) { found = p; break }
    }
  }

  if (!found) return null

  // Verify it actually works
  try {
    const version = execSync(`"${found}" --version`, {
      encoding: 'utf8',
      timeout: 5000,
      env: process.env,
    }).trim()
    return { path: found, version }
  } catch {
    return { path: found, version: null }
  }
}
```

**Step 2: Call preflight after window loads**

In the `app.whenReady()` block, after `createWindow('index.html')` (line 177), add preflight call. Replace lines 174-180:

```javascript
  } else {
    global.VAULT_PATH = config.vaultPath
    global.CLAUDE_BIN = config.claudeBinaryPath
    createWindow('index.html')
    // Pre-flight checks (async, non-blocking)
    require('./src/preflight').run(mainWindow, config.claudeBinaryPath, config.vaultPath)
    require('./src/file-watcher').start(mainWindow)
    require('./src/db-reader').open(config.vaultPath)
  }
```

**Step 3: Add IPC handler for binary re-check**

After the existing `DETECT_BINARY` handler (line 222-224), add:

```javascript
ipcMain.on(ch.PREFLIGHT_RECHECK_BINARY, () => {
  require('./src/preflight').run(mainWindow, global.CLAUDE_BIN, global.VAULT_PATH)
})
```

**Step 4: Update DETECT_BINARY handler to return version**

Replace line 222-224:

```javascript
ipcMain.handle(ch.DETECT_BINARY, () => {
  return detectClaudeBinary()
})
```

(This already returns the new `{ path, version }` format from Step 1.)

**Step 5: Commit**

```bash
git add main.js
git commit -m "feat(desktop): wire preflight into app lifecycle, enhance binary detection"
```

---

### Task 4: Expose Pre-flight in Preload Bridge

**Files:**
- Modify: `preload.js:7-13` (setup namespace)

**Step 1: Add preflight namespace to preload.js**

After the `setup` namespace (line 13), add:

```javascript
  // ─── Preflight ────────────────────────────────────────────────────────────
  preflight: {
    onResult: (cb) => ipcRenderer.on(ch.PREFLIGHT_RESULT, (_, result) => cb(result)),
    recheckBinary: () => ipcRenderer.send(ch.PREFLIGHT_RECHECK_BINARY),
  },
```

**Step 2: Commit**

```bash
git add preload.js
git commit -m "feat(desktop): expose preflight IPC in preload bridge"
```

---

### Task 5: Add Spawn Guards to Chat Manager and PTY Manager

**Files:**
- Modify: `src/chat-manager.js:12` (top of `send()`)
- Modify: `src/pty-manager.js:6` (top of `create()`)
- Modify: `src/pty-manager.js:58` (top of `resume()`)

**Step 1: Add binary guard in chat-manager.js**

At the top of the `send()` function (after `opts = opts || {}` on line 14), add:

```javascript
  // Pre-spawn binary guard
  if (!fs.existsSync(claudeBin)) {
    if (!win.isDestroyed()) {
      win.webContents.send(`${ch.CHAT_ERROR}:${chatId}`,
        JSON.stringify({ type: 'binary-missing', path: claudeBin }))
    }
    return
  }
```

**Step 2: Add fs require at top of pty-manager.js**

Add after line 1 (`const pty = require('node-pty')`):

```javascript
const fs  = require('fs')
```

**Step 3: Add binary guard in pty-manager.js `create()`**

At the top of `create()` (line 6, before `const shell = pty.spawn(...)`), add:

```javascript
  if (!fs.existsSync(claudeBin)) {
    if (!win.isDestroyed()) {
      win.webContents.send(ch.PTY_ERROR, `Claude CLI not found at ${claudeBin}. It may have been moved or uninstalled.`)
    }
    return null
  }
```

**Step 4: Add binary guard in pty-manager.js `resume()`**

At the top of `resume()` (line 58, before `const shell = pty.spawn(...)`), add same guard:

```javascript
  if (!fs.existsSync(claudeBin)) {
    if (!win.isDestroyed()) {
      win.webContents.send(ch.PTY_ERROR, `Claude CLI not found at ${claudeBin}. It may have been moved or uninstalled.`)
    }
    return null
  }
```

**Step 5: Commit**

```bash
git add src/chat-manager.js src/pty-manager.js
git commit -m "feat(desktop): add binary spawn guards to chat-manager and pty-manager"
```

---

### Task 6: Renderer — Binary Status Indicator in Titlebar

**Files:**
- Modify: `renderer/index.html:59` (titlebar-right div)
- Modify: `renderer/styles/shell.css` (add status indicator styles)
- Modify: `renderer/index.html:818-843` (init section)

**Step 1: Add binary status indicator element**

In `renderer/index.html`, inside `.titlebar-right` (line 59), add as the FIRST child (before `titlebar-nextmove`):

```html
      <div class="preflight-status" id="preflight-status" style="display:none">
        <div class="preflight-dot"></div>
        <span class="preflight-label" id="preflight-label"></span>
        <div class="preflight-card" id="preflight-card" style="display:none">
          <div class="preflight-msg" id="preflight-msg"></div>
          <div class="preflight-actions">
            <button class="preflight-btn" id="preflight-recheck">Re-detect</button>
            <button class="preflight-btn" id="preflight-settings">Open Settings</button>
          </div>
        </div>
      </div>
```

**Step 2: Add styles**

Append to `renderer/styles/shell.css`:

```css
/* ─── Preflight Binary Status ────────────────────────────────────────────── */
.preflight-status {
  position: relative;
  display: flex;
  align-items: center;
  gap: 6px;
  padding: 2px 10px;
  cursor: pointer;
  font-size: 11px;
  color: var(--text-secondary);
}
.preflight-dot {
  width: 6px; height: 6px; border-radius: 50%;
  background: #d4c274;
  box-shadow: 0 0 6px rgba(212,194,116,0.4);
}
.preflight-status.error .preflight-dot {
  background: #c47474;
  box-shadow: 0 0 6px rgba(196,116,116,0.4);
}
.preflight-card {
  position: absolute;
  top: 100%;
  right: 0;
  margin-top: 8px;
  width: 320px;
  background: var(--bg-elevated, #1a1612);
  border: 1px solid var(--border-hover, rgba(212,165,116,0.18));
  border-radius: 8px;
  padding: 14px;
  z-index: 200;
  box-shadow: 0 8px 24px rgba(0,0,0,0.3);
}
.preflight-msg {
  font-size: 12px;
  color: var(--text-primary);
  margin-bottom: 12px;
  line-height: 1.5;
  font-family: 'JetBrains Mono', monospace;
  word-break: break-all;
}
.preflight-actions {
  display: flex;
  gap: 8px;
}
.preflight-btn {
  flex: 1;
  padding: 8px 12px;
  background: var(--bg-surface, #0a0806);
  border: 1px solid var(--border-hover, rgba(212,165,116,0.18));
  border-radius: 6px;
  color: var(--text-primary);
  font-size: 12px;
  font-family: 'DM Sans', sans-serif;
  cursor: pointer;
  transition: border-color 0.14s;
}
.preflight-btn:hover { border-color: var(--gold, #d4a574); }
```

**Step 3: Add preflight listener in init section**

In `renderer/index.html`, after `initAtmosphere().then(() => initBreath())` (line 842), add:

```javascript
// ─── Preflight Result Handler ──
window.ace.preflight.onResult((result) => {
  const el = document.getElementById('preflight-status')
  const label = document.getElementById('preflight-label')
  const card = document.getElementById('preflight-card')
  const msg = document.getElementById('preflight-msg')

  if (result.binary.ok) {
    el.style.display = 'none'
  } else {
    el.style.display = 'flex'
    el.className = 'preflight-status' + (result.binary.error === 'missing' ? ' error' : '')
    const messages = {
      'missing': 'Claude CLI not found',
      'not-executable': 'Claude CLI not executable',
      'not-responding': 'Claude CLI not responding',
    }
    label.textContent = messages[result.binary.error] || 'Claude CLI issue'
    msg.textContent = result.binary.error === 'missing'
      ? `Binary not found at ${result.binary.path || 'configured path'}. Install Claude Code or update the path in Settings.`
      : result.binary.error === 'not-executable'
      ? `Found ${result.binary.path} but it is not executable. Check file permissions.`
      : `Found ${result.binary.path} but it did not respond to --version within 5 seconds.`

    el.addEventListener('click', (e) => {
      if (e.target.closest('.preflight-btn')) return
      card.style.display = card.style.display === 'none' ? 'block' : 'none'
    })
  }

  // Store result for chat placeholder logic
  window.__preflightResult = result
})

document.getElementById('preflight-recheck')?.addEventListener('click', () => {
  document.getElementById('preflight-label').textContent = 'Checking...'
  window.ace.preflight.recheckBinary()
})

document.getElementById('preflight-settings')?.addEventListener('click', () => {
  document.getElementById('settings-overlay')?.classList.add('open')
})
```

**Step 4: Commit**

```bash
git add renderer/index.html renderer/styles/shell.css
git commit -m "feat(desktop): add binary health status indicator in titlebar"
```

---

### Task 7: Renderer — Enhanced Vault Health Banner

**Files:**
- Modify: `renderer/dashboard.js:134-170` (renderHealthBanner function)

**Step 1: Replace `renderHealthBanner` with tier-aware version**

Replace the entire `renderHealthBanner` function (lines 134-170):

```javascript
function renderHealthBanner(health, el) {
  const critical = health.missing.filter(m => m.tier === 'engine')
  const other = health.missing.filter(m => m.tier !== 'engine')

  const criticalHtml = critical.length
    ? `<div class="health-section">
        <span class="health-section-label health-engine">${critical.length} engine file${critical.length === 1 ? '' : 's'} missing</span>
        <button class="health-fix-critical" onclick="window.__fixCriticalVault__()">Repair</button>
       </div>`
    : ''

  const otherHtml = other.length
    ? `<div class="health-section">
        <span class="health-section-label health-scaffolding">${other.length} optional file${other.length === 1 ? '' : 's'} missing</span>
       </div>`
    : ''

  el.innerHTML = `
    <div class="vault-health-card">
      <div class="health-header">
        <span class="health-score">${health.score}%</span>
        <span class="health-label">Vault Integrity</span>
        <button class="health-dismiss" onclick="this.closest('.vault-health-card').remove()">\u00d7</button>
      </div>
      <div class="health-body">${criticalHtml}${otherHtml}</div>
    </div>
  `

  window.__fixCriticalVault__ = async () => {
    const btn = el.querySelector('.health-fix-critical')
    if (btn) { btn.textContent = 'Repairing...'; btn.disabled = true }
    await window.ace.health.scaffoldAll(critical)
    // Re-check health after repair
    const updated = await window.ace.health.check()
    if (updated && !updated.ok && updated.missing?.length) {
      renderHealthBanner(updated, el)
    } else {
      el.remove()
    }
    if (typeof loadDashboard === 'function') loadDashboard()
  }
}
```

**Step 2: Commit**

```bash
git add renderer/dashboard.js
git commit -m "feat(desktop): vault health banner distinguishes critical vs non-critical"
```

---

### Task 8: Renderer — Chat Input `/start` Placeholder + Binary-Missing Card

**Files:**
- Modify: `renderer/modules/session-manager.js:788` (chat input placeholder)
- Modify: `renderer/modules/session-manager.js:552-561` (error handler)

**Step 1: Dynamic placeholder for first session**

In `session-manager.js`, find the chat input template at line 788:

```html
<textarea class="chat-input" id="chat-input-${id}" placeholder="Message ACE..." rows="1"></textarea>
```

Replace with:

```html
<textarea class="chat-input" id="chat-input-${id}" placeholder="${window.__preflightResult?.binary?.ok !== false ? 'Type /start to begin your day' : 'Message ACE...'}" rows="1"></textarea>
```

Then, after the input event listeners are set up (after line 854, the `inputEl.addEventListener('keydown')` block), add logic to reset placeholder after first use:

```javascript
  // Reset placeholder after first message
  inputEl.addEventListener('input', function resetPlaceholder() {
    if (inputEl.placeholder !== 'Message ACE...') {
      inputEl.placeholder = 'Message ACE...'
      inputEl.removeEventListener('input', resetPlaceholder)
    }
  })
```

**Step 2: Styled binary-missing card in error handler**

In `session-manager.js`, replace the error handler at lines 552-561:

```javascript
  const cleanupError = window.ace.chat.onError(id, msg => {
    const msgsEl = document.getElementById('chat-msgs-' + id)
    if (!msgsEl) return
    if (msg.includes('No STDIN data') || msg.includes('proceeding without')) return

    // Check for structured binary-missing error
    let parsed = null
    try { parsed = JSON.parse(msg) } catch {}

    if (parsed?.type === 'binary-missing') {
      const card = document.createElement('div')
      card.className = 'chat-error binary-missing-card'
      card.innerHTML = `
        <div style="margin-bottom:8px">Claude CLI not found at <code>${parsed.path || 'configured path'}</code>.</div>
        <div style="margin-bottom:10px;opacity:0.7">It may have been moved or uninstalled.</div>
        <div style="display:flex;gap:8px">
          <button class="preflight-btn" onclick="window.ace.preflight.recheckBinary()">Re-detect</button>
          <button class="preflight-btn" onclick="document.getElementById('settings-overlay')?.classList.add('open')">Open Settings</button>
        </div>`
      msgsEl.appendChild(card)
    } else {
      const errEl = document.createElement('div')
      errEl.className = 'chat-error'
      errEl.textContent = msg
      msgsEl.appendChild(errEl)
    }
    setAttention(id, sessionsObj)
  })
```

**Step 3: Add styles for binary-missing card**

Append to `renderer/styles/chat.css`:

```css
/* Binary missing card in chat */
.binary-missing-card {
  padding: 14px !important;
  border-radius: 8px !important;
  line-height: 1.5 !important;
}
.binary-missing-card code {
  font-family: 'JetBrains Mono', monospace;
  font-size: 11px;
  background: rgba(212,165,116,0.08);
  padding: 2px 6px;
  border-radius: 3px;
  color: var(--gold, #d4a574);
}
```

**Step 4: Commit**

```bash
git add renderer/modules/session-manager.js renderer/styles/chat.css
git commit -m "feat(desktop): /start placeholder hint + styled binary-missing error card"
```

---

### Task 9: Setup Screen — Vault Validation Gate + Messaging

**Files:**
- Modify: `renderer/setup.html:262-322` (script section)

**Step 1: Update vault picker handler to show better messaging**

Replace the vault-btn click handler (lines 266-276):

```javascript
    $('vault-btn').addEventListener('click', async () => {
      const result = await window.ace.setup.pickVault()
      if (!result) return
      state.vaultPath = result.vaultPath
      state.vaultValid = result.hasMcp
      $('vault-path').textContent = result.vaultPath
      $('vault-path').className = 'step-value ' + (result.hasMcp ? 'valid' : '')
      $('vault-dot').className = 'status-dot ' + (result.hasMcp ? 'green' : 'amber')
      $('vault-warning').textContent = result.hasMcp
        ? ''
        : 'Please select your ACE vault folder. If you haven\'t received your vault yet, your operator will set it up during your first session.'
      $('vault-warning').style.display = result.hasMcp ? 'none' : 'block'
      checkReady()
    })
```

**Step 2: Gate launch on vault validity**

Replace `checkReady()` (line 305-307):

```javascript
    function checkReady() {
      $('launch-btn').disabled = !(state.vaultPath && state.vaultValid && state.binaryPath)
    }
```

**Step 3: Update binary detection to show version**

Replace `detectBinary()` (lines 278-296):

```javascript
    async function detectBinary() {
      $('binary-path').textContent = 'Detecting\u2026'
      $('binary-dot').className = 'status-dot'
      const result = await window.ace.setup.detectBinary()
      if (result && result.path) {
        state.binaryPath = result.path
        const label = result.version ? `${result.path} (${result.version})` : result.path
        $('binary-path').textContent = label
        $('binary-path').className = 'step-value valid'
        $('binary-dot').className = 'status-dot green'
        $('install-guide').classList.remove('visible')
      } else if (result === null || !result?.path) {
        state.binaryPath = null
        $('binary-path').textContent = 'Not found'
        $('binary-path').className = 'step-value error'
        $('binary-dot').className = 'status-dot red'
        $('install-guide').classList.add('visible')
      }
      checkReady()
    }
```

**Step 4: Update config save to use path from result object**

Replace the launch-btn handler (lines 309-319):

```javascript
    $('launch-btn').addEventListener('click', async () => {
      $('launch-btn').disabled = true
      $('launch-btn').textContent = 'Launching\u2026'
      const cfg = {
        vaultPath: state.vaultPath,
        claudeBinaryPath: state.binaryPath,
        configVersion: 1,
      }
      if (state.apiKey) cfg.anthropicApiKey = state.apiKey
      await window.ace.setup.saveConfig(cfg)
    })
```

**Step 5: Commit**

```bash
git add renderer/setup.html
git commit -m "feat(desktop): setup screen gates on vault validity, shows version + messaging"
```

---

### Task 10: Smoke Test

**Step 1: Start the app in dev mode**

Run: `cd ace-desktop && npm start`

**Step 2: Verify pre-flight**

- App should load to dashboard
- No binary status indicator visible (binary is healthy)
- Vault health banner should only appear if files are actually missing
- First Command Center chat input should show "Type /start to begin your day"

**Step 3: Test binary failure path**

Temporarily set a bad binary path in `~/Library/Application Support/ACE/ace-config.json`:
- Change `claudeBinaryPath` to `/tmp/fake-claude`
- Restart app
- Verify: amber/red indicator appears in titlebar
- Verify: clicking it shows the error card with Re-detect and Open Settings
- Verify: typing in chat shows styled binary-missing card (not raw error)
- Restore original config

**Step 4: Test setup screen gate**

- Delete or rename `ace-config.json` to force setup screen
- Browse to a non-vault folder (e.g., `/tmp`)
- Verify: amber warning with message about selecting ACE vault
- Verify: "Save & Launch" button stays disabled
- Browse to actual vault folder
- Verify: green dot, button enables

**Step 5: Commit (if any fixes needed)**

```bash
git add -A
git commit -m "fix(desktop): setup screen polish smoke test fixes"
```

---

### Task 11: Final Commit — Update ROADMAP

**Files:**
- Modify: `ROADMAP.md` ("In Progress" table)

**Step 1: Update setup screen polish status**

Change `Setup screen polish` row status from `Not started` to `Done`.
Change `Process cleanup on exit` row status from `Not started` to `Done` (already shipped per user).

**Step 2: Commit**

```bash
git add ROADMAP.md
git commit -m "docs(desktop): mark setup screen polish + process cleanup as done"
```
