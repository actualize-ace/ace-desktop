# MCP Resilience System — Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Detect MCP auth failures from structured and textual signals, show typed recovery cards, and provide one-click **browser-based** re-auth via `shell.openExternal` + filesystem-level token reset. No PTY, no nonexistent CLI subcommand.

**Design doc:** [2026-04-17-mcp-resilience-design.md](2026-04-17-mcp-resilience-design.md) (v2, post-research)

**Tech stack:** Electron main (Node), vanilla JS renderer, existing IPC channels + three new ones (`mcp:open-auth-url`, `mcp:reset-auth`, `mcp:resolve-server`).

---

## Context for the executor

Before starting any task, read:
- `ace-desktop/src/chat-manager.js` (lines 38–226 — current `send()` flow)
- `ace-desktop/renderer/modules/session-manager.js` lines 676–723 (current `cleanupError` handler)
- `ace-desktop/src/ipc-channels.js` (note `SHELL_OPEN_EXTERNAL` already exists at line 88 — reuse it)
- `~/.mcp-auth/mcp-remote-<version>/` on the dev machine (verify layout: `<md5>_tokens.json`, `<md5>_client_info.json`, `<md5>_code_verifier.txt`, `<md5>_lock.json`)

**Verified facts** (all confirmed against Claude Code 2.1.92 + mcp-remote 0.1.37 bundled source):
- `mcp-remote` uses `MD5(serverUrl + '|' + (resource || '') + '|' + JSON.stringify(sortedHeaders || {}))` for its cache filename prefix.
- Deleting `<hash>_tokens.json` + `<hash>_code_verifier.txt` (keeping `client_info.json`) is the canonical fresh-auth trigger — README `rm -rf ~/.mcp-auth` is the blunt version.
- Auth URL is logged to stderr as `Please authorize this client by visiting:\n<URL>` (plus a follow-on `Browser opened automatically.` or `Could not open browser automatically.`).
- `--strict-mcp-config` without `--mcp-config` = zero MCP servers (confirmed via CLI help).
- `mcp_instructions_delta` stream-json event carries `addedNames[]`, `addedBlocks[]`, and `removedNames[]` — field names confirmed in CLI 2.1.92 binary.
- Elicitation auth URL arrives as a **system event**: `{ type: "system", subtype: "elicitation", mode: "url", url: "...", mcp_server_name: "...", elicitation_id: "...", message: "..." }` — NOT as `event.error?.code === -32042` on a tool_result. Code -32042 is the internal MCP error code; what stream-json consumers receive is the unwrapped system event.
- **MCP server config is split across two files** (confirmed by direct inspection):
  - User-scope: `~/.claude.json` → `mcpServers` (servers added with `-s user`)
  - Project-scope: `<vaultPath>/.mcp.json` → `mcpServers` (servers added with `-s local` or project-default)
  - `~/.claude/settings.json` (what `CLAUDE_SETTINGS_READ` reads) has NO mcpServers — wrong file entirely.

---

### Task 1: Lean Mode Verification (docs-only)

**Files:** none modified — verification commit

**Step 1: Verify current behavior**

Launch ACE Desktop with lean mode ON and no `ANTHROPIC_API_KEY`. Configure at least one MCP server (e.g. Fathom) in `~/.claude.json`. Send a chat message that would normally use an MCP tool. Open DevTools → Main process console. Confirm:
- No stderr lines containing `mcp-remote`, `Authentication required`, or `Please authorize`.
- Chat response succeeds without MCP tools.

**Step 2: Document the verification**

If verified, add a short comment to `chat-manager.js` above line 95:
```javascript
// --strict-mcp-config without --mcp-config = zero MCP servers loaded.
// Verified against Claude Code 2.1.92 CLI help + runtime behavior.
```

**Step 3: Commit (only if the comment was added)**

```bash
git add ace-desktop/src/chat-manager.js
git commit -m "docs(ace-desktop): document strict-mcp-config lean behavior"
```

If no code change, skip — roll into Task 2's commit.

---

### Task 2: IPC Channels + Preload Wiring

**Files:**
- Modify: `ace-desktop/src/ipc-channels.js`
- Modify: `ace-desktop/preload.js`

**Step 1: Register new channels**

In `ipc-channels.js`, add a new section before `module.exports`'s closing brace:

```javascript
  // MCP resilience
  MCP_OPEN_AUTH_URL:   'mcp-open-auth-url',
  MCP_RESET_AUTH:      'mcp-reset-auth',
  MCP_RESOLVE_SERVER:  'mcp-resolve-server',  // resolves name → { serverUrl, headers, resource }
```

**Step 2: Expose them in preload**

In `ace-desktop/preload.js`, locate the `window.ace` API surface (search for `openExternal:` around line 153). Add an `mcp` namespace:

```javascript
  mcp: {
    openAuthUrl:   (url) => ipcRenderer.invoke(ch.MCP_OPEN_AUTH_URL, url),
    resetAuth:     (opts) => ipcRenderer.invoke(ch.MCP_RESET_AUTH, opts),
    resolveServer: (name, vaultPath) => ipcRenderer.invoke(ch.MCP_RESOLVE_SERVER, { name, vaultPath }),
  },
```

**Step 3: Verify preload loads**

```bash
cd ace-desktop && npm start
```

DevTools console → `window.ace.mcp.openAuthUrl`, `window.ace.mcp.resetAuth`, and `window.ace.mcp.resolveServer` should all return functions. If undefined, preload didn't reload — quit + relaunch.

**Step 4: Commit**

```bash
git add ace-desktop/src/ipc-channels.js ace-desktop/preload.js
git commit -m "feat(ace-desktop): register MCP resilience IPC channels"
```

---

### Task 3: Main-process auth helper (`src/mcp-auth.js`)

**Files:**
- Create: `ace-desktop/src/mcp-auth.js`
- Modify: `ace-desktop/main.js` (register IPC handlers)

**Step 1: Create the helper module**

Create `ace-desktop/src/mcp-auth.js`:

```javascript
// MCP auth recovery — filesystem-level token reset for mcp-remote.
// Canonical recovery: delete <hash>_tokens.json + <hash>_code_verifier.txt,
// keep <hash>_client_info.json so dynamic client registration isn't repeated.
// Hash derivation (from mcp-remote 0.1.37 source, getServerUrlHash):
//   MD5(serverUrl + '|' + (authorizeResource || '') + '|' + JSON.stringify(sortedHeaders || {}))

const fs = require('fs')
const path = require('path')
const os = require('os')
const crypto = require('crypto')
const { shell } = require('electron')

const MCP_AUTH_ROOT = path.join(os.homedir(), '.mcp-auth')
const CLAUDE_NEEDS_AUTH_CACHE = path.join(os.homedir(), '.claude', 'mcp-needs-auth-cache.json')

function sortedHeadersJson(headers) {
  if (!headers || typeof headers !== 'object') return '{}'
  const sorted = {}
  for (const k of Object.keys(headers).sort()) sorted[k] = headers[k]
  return JSON.stringify(sorted)
}

function computeHash(serverUrl, resource, headers) {
  const key = `${serverUrl}|${resource || ''}|${sortedHeadersJson(headers)}`
  return crypto.createHash('md5').update(key).digest('hex')
}

// Find all cache directories (one per mcp-remote version installed via npx).
// We clear matching-hash files across all of them — safe, only tokens deleted.
function findCacheDirs() {
  if (!fs.existsSync(MCP_AUTH_ROOT)) return []
  return fs.readdirSync(MCP_AUTH_ROOT)
    .filter(name => name.startsWith('mcp-remote-'))
    .map(name => path.join(MCP_AUTH_ROOT, name))
    .filter(p => fs.statSync(p).isDirectory())
}

// Delete tokens.json + code_verifier.txt for a given server.
// Keep client_info.json (dynamic client registration) + lock.json (ownership).
function clearTokens(serverUrl, resource, headers) {
  const hash = computeHash(serverUrl, resource, headers)
  const deleted = []
  for (const dir of findCacheDirs()) {
    for (const suffix of ['_tokens.json', '_code_verifier.txt']) {
      const p = path.join(dir, hash + suffix)
      if (fs.existsSync(p)) {
        try { fs.unlinkSync(p); deleted.push(p) } catch (err) {
          return { ok: false, error: err.message, deleted }
        }
      }
    }
  }
  return { ok: true, hash, deleted }
}

// Remove a server from Claude CLI's needs-auth cache so next spawn retries.
function bustNeedsAuthCache(serverName) {
  if (!serverName) return { ok: true, busted: false }
  if (!fs.existsSync(CLAUDE_NEEDS_AUTH_CACHE)) return { ok: true, busted: false }
  try {
    const raw = fs.readFileSync(CLAUDE_NEEDS_AUTH_CACHE, 'utf8')
    const data = JSON.parse(raw)
    if (data && typeof data === 'object' && data[serverName]) {
      delete data[serverName]
      fs.writeFileSync(CLAUDE_NEEDS_AUTH_CACHE, JSON.stringify(data, null, 2))
      return { ok: true, busted: true }
    }
    return { ok: true, busted: false }
  } catch (err) {
    // Cache corruption shouldn't block recovery — report but don't fail.
    return { ok: true, busted: false, cacheError: err.message }
  }
}

// IPC handler: shell.openExternal with validation.
// URL must be http(s) — don't let renderer open arbitrary schemes.
async function handleOpenAuthUrl(_evt, url) {
  if (typeof url !== 'string') return { ok: false, error: 'url must be a string' }
  if (!/^https?:\/\//i.test(url)) return { ok: false, error: 'only http(s) URLs allowed' }
  try {
    await shell.openExternal(url)
    return { ok: true }
  } catch (err) {
    return { ok: false, error: err.message }
  }
}

// IPC handler: reset auth for a given MCP server.
// Expects { serverUrl, resource?, headers?, serverName? }
async function handleResetAuth(_evt, payload) {
  const { serverUrl, resource, headers, serverName } = payload || {}
  if (typeof serverUrl !== 'string' || !serverUrl) {
    return { ok: false, error: 'serverUrl required' }
  }
  const result = clearTokens(serverUrl, resource, headers)
  if (!result.ok) return result
  const cache = bustNeedsAuthCache(serverName)
  return { ok: true, hash: result.hash, deleted: result.deleted, cacheBusted: cache.busted }
}

// Read mcpServers from both config locations.
// User-scope: ~/.claude.json (servers added with -s user)
// Project-scope: <vaultPath>/.mcp.json (servers added with -s local / project default)
// ~/.claude/settings.json has NO mcpServers — confirmed by direct inspection.
function readMcpServers(vaultPath) {
  const servers = {}
  // User scope
  const userJson = path.join(os.homedir(), '.claude.json')
  if (fs.existsSync(userJson)) {
    try {
      const d = JSON.parse(fs.readFileSync(userJson, 'utf8'))
      Object.assign(servers, d.mcpServers || {})
    } catch {}
  }
  // Project scope
  if (vaultPath) {
    const projectJson = path.join(vaultPath, '.mcp.json')
    if (fs.existsSync(projectJson)) {
      try {
        const d = JSON.parse(fs.readFileSync(projectJson, 'utf8'))
        // Project-scope entries shadow user-scope entries with same name
        Object.assign(servers, d.mcpServers || {})
      } catch {}
    }
  }
  return servers
}

// Resolve a server name to its URL (for mcp-remote: args[index of http(s) URL]).
function resolveServerUrl(name, servers) {
  const cfg = servers[name]
  if (!cfg) return null
  // HTTP/SSE transport: URL is in the `url` field directly
  if (cfg.url) return { serverUrl: cfg.url, headers: cfg.headers || null, resource: null }
  // stdio via mcp-remote: `npx mcp-remote@latest <url> [...]`
  if (cfg.command === 'npx' && Array.isArray(cfg.args)) {
    const urlArg = cfg.args.find(a => /^https?:\/\//.test(a))
    if (urlArg) return { serverUrl: urlArg, headers: cfg.headers || null, resource: null }
  }
  return null
}

// IPC handler: resolve a server name → { serverUrl, headers, resource }
async function handleResolveServer(_evt, { name, vaultPath } = {}) {
  if (!name) return { ok: false, error: 'name required' }
  const servers = readMcpServers(vaultPath)
  const resolved = resolveServerUrl(name, servers)
  if (!resolved) return { ok: false, error: `server "${name}" not found or URL not resolvable` }
  return { ok: true, ...resolved }
}

function registerHandlers(ipcMain, channels) {
  ipcMain.handle(channels.MCP_OPEN_AUTH_URL,  handleOpenAuthUrl)
  ipcMain.handle(channels.MCP_RESET_AUTH,     handleResetAuth)
  ipcMain.handle(channels.MCP_RESOLVE_SERVER, handleResolveServer)
}

module.exports = {
  registerHandlers,
  // Exported for future test harness + Phase 2 health panel
  computeHash,
  clearTokens,
  bustNeedsAuthCache,
  readMcpServers,
  resolveServerUrl,
}
```

**Step 2: Register handlers in main.js**

In `ace-desktop/main.js`, near the top where other modules are required, add:

```javascript
const mcpAuth = require('./src/mcp-auth')
```

Near the other `ipcMain.handle` calls (after the `SHELL_OPEN_EXTERNAL` handler around line 802), add:

```javascript
mcpAuth.registerHandlers(ipcMain, ch)
```

**Step 3: Smoke test the handlers**

```bash
cd ace-desktop && npm start
```

DevTools console (renderer):

```javascript
// Happy path — URL opens, returns {ok:true}
await window.ace.mcp.openAuthUrl('https://example.com')

// Invalid URL rejected
await window.ace.mcp.openAuthUrl('javascript:alert(1)')   // → {ok:false}
await window.ace.mcp.openAuthUrl('file:///etc/passwd')    // → {ok:false}

// Reset returns ok even if nothing was cached (safe no-op)
await window.ace.mcp.resetAuth({ serverUrl: 'https://example.com/nonexistent' })
// → {ok:true, deleted: [], cacheBusted: false}

// Resolve server — fathom is user-scoped in ~/.claude.json
await window.ace.mcp.resolveServer('fathom', '/Users/nikhilkale/Documents/Actualize')
// → {ok:true, serverUrl:'https://api.fathom.ai/mcp', headers:null, resource:null}

// Unknown server
await window.ace.mcp.resolveServer('nonexistent', '/tmp')
// → {ok:false, error:'server "nonexistent" not found or URL not resolvable'}
```

**Step 4: Commit**

```bash
git add ace-desktop/src/mcp-auth.js ace-desktop/main.js
git commit -m "feat(ace-desktop): add MCP auth recovery IPC handlers"
```

---

### Task 4: Chat-manager MCP event detection

**Files:**
- Modify: `ace-desktop/src/chat-manager.js`

**Step 1: Add detection helpers above `send()`**

In `chat-manager.js`, right after the `diagnoseBinary` function (around line 36), add:

```javascript
// ── MCP event detection ─────────────────────────────────────────────
// Sources:
//   2a. stdout stream-json:   mcp_instructions_delta, tool_result errors, code -32042
//   2b. stderr from mcp-remote subprocess (PID-prefixed lines)
//   2c. stderr from Claude CLI itself (pre-init + mid-session)
//
// All patterns verified against Claude Code 2.1.92 + mcp-remote 0.1.37
// bundled sources — NOT speculative.

// mcp-remote stderr patterns (line-level)
const MCP_REMOTE_AUTH_URL_RE   = /Please authorize this client by visiting:\s*(https?:\/\/\S+)/i
const MCP_REMOTE_TERMINAL_RE   = /Already attempted reconnection.*Giving up/i
const MCP_REMOTE_FATAL_RE      = /Fatal error:/i
const MCP_REMOTE_AUTH_PEND_RE  = /Authentication required\.\s*(?:Initializing auth|Waiting for authorization)/i
const MCP_REMOTE_SUCCESS_RE    = /Connected to remote server/i

// Claude CLI stderr patterns
const CLI_AUTH_EXPIRED_RE      = /MCP server\s+"([^"]+)"\s+requires re-authorization\s+\(token expired\)/i
const CLI_NOT_CONNECTED_RE     = /MCP server\s+"([^"]+)"\s+is not connected/i
const CLI_CONNECT_FAILED_RE    = /Failed to connect to MCP server\s+'([^']+)'/i
const CLI_AUTH_REQUIRED_RE     = /Authentication required for (HTTP|claude\.ai proxy) server/i

function classifyMcpLine(text) {
  let m
  if ((m = text.match(MCP_REMOTE_AUTH_URL_RE))) return { subtype: 'auth_url_ready', authUrl: m[1] }
  if (MCP_REMOTE_TERMINAL_RE.test(text))        return { subtype: 'auth_terminal_fail' }
  if (MCP_REMOTE_FATAL_RE.test(text))           return { subtype: 'mcp_remote_crash', detail: text.trim().slice(0, 500) }
  if (MCP_REMOTE_AUTH_PEND_RE.test(text))       return { subtype: 'auth_pending' }
  if ((m = text.match(CLI_AUTH_EXPIRED_RE)))    return { subtype: 'cli_auth_expired', server: m[1] }
  if ((m = text.match(CLI_NOT_CONNECTED_RE)))   return { subtype: 'cli_not_connected', server: m[1] }
  if ((m = text.match(CLI_CONNECT_FAILED_RE))) return { subtype: 'cli_connect_failed', server: m[1] }
  if ((m = text.match(CLI_AUTH_REQUIRED_RE)))   return { subtype: 'cli_auth_required', serverKind: m[1] }
  return null
}

function isMcpNoise(text) {
  // mcp-remote success message is noise (not an error to forward) — but we
  // DO emit a clear event so the renderer can dismiss open error cards.
  return MCP_REMOTE_SUCCESS_RE.test(text)
}
```

**Step 2: Replace the stderr handler + add buffering**

Replace the current `proc.stdout.on('data', ...)` block (lines ~173–186) and `proc.stderr.on('data', ...)` block (lines ~189–194) with:

```javascript
  // Line-buffered NDJSON parsing. Split on \r?\n so Windows CRLF line endings
  // don't leave a trailing \r that fails JSON.parse silently.
  let buffer = ''
  let stderrBuf = []
  let startupPhase = true

  const emitMcpEvent = (event) => {
    if (win.isDestroyed()) return
    win.webContents.send(`${ch.CHAT_ERROR}:${chatId}`, JSON.stringify({
      type: 'mcp-event',
      ...event,
    }))
  }

  // Flush buffered stderr — called on first stdout chunk OR on early exit.
  const flushStartupBuffer = () => {
    if (!startupPhase || !stderrBuf) return
    startupPhase = false
    const buf = stderrBuf
    stderrBuf = null
    if (win.isDestroyed()) return
    for (const line of buf) {
      if (line.includes('No STDIN data received') || line.includes('proceeding without')) continue
      if (isMcpNoise(line)) continue
      const classified = classifyMcpLine(line)
      if (classified) {
        emitMcpEvent(classified)
      } else {
        win.webContents.send(`${ch.CHAT_ERROR}:${chatId}`, line)
      }
    }
  }

  proc.stdout.on('data', chunk => {
    if (win.isDestroyed()) return
    if (startupPhase) flushStartupBuffer()

    buffer += chunk.toString()
    const lines = buffer.split(/\r?\n/)
    buffer = lines.pop()
    for (const line of lines) {
      if (!line.trim()) continue
      try {
        const event = JSON.parse(line)
        // Stream-json MCP events (channel 2a from design doc)
        // removedNames field name confirmed in Claude Code 2.1.92 binary.
        if (event.type === 'mcp_instructions_delta' && event.removedNames?.length) {
          emitMcpEvent({ subtype: 'mcp_disconnect', servers: event.removedNames })
        }
        // Elicitation auth URL arrives as a system event — NOT as error.code -32042.
        // Code -32042 is the internal MCP wire error; stream-json unwraps it into
        // { type:"system", subtype:"elicitation", mode:"url", url:"...", mcp_server_name, elicitation_id }
        // Field shape confirmed in CLI 2.1.92 binary (Gh5 schema + QL9 handler).
        if (event.type === 'system' && event.subtype === 'elicitation' &&
            event.mode === 'url' && typeof event.url === 'string') {
          emitMcpEvent({ subtype: 'auth_url_ready', authUrl: event.url, server: event.mcp_server_name })
        }
        win.webContents.send(`${ch.CHAT_STREAM}:${chatId}`, event)
      } catch {}
    }
  })

  proc.stderr.on('data', chunk => {
    if (win.isDestroyed()) return
    const text = chunk.toString()
    // Split on newlines so each classified signal is independent.
    const lines = text.split(/\r?\n/).filter(l => l.trim())
    if (startupPhase && stderrBuf) {
      for (const line of lines) stderrBuf.push(line)
      return
    }
    for (const line of lines) {
      if (line.includes('No STDIN data received') || line.includes('proceeding without')) continue
      if (isMcpNoise(line)) continue
      const classified = classifyMcpLine(line)
      if (classified) {
        emitMcpEvent(classified)
      } else {
        win.webContents.send(`${ch.CHAT_ERROR}:${chatId}`, line)
      }
    }
  })

  // Flush buffered stderr if the CLI dies before producing any stdout.
  // Without this, startup MCP failures are silently discarded on early crash.
  proc.on('exit',  () => { if (startupPhase) flushStartupBuffer() })
  proc.on('close', () => { if (startupPhase) flushStartupBuffer() })
```

**Step 3: Verify build**

```bash
cd ace-desktop && npm start
```

Send a normal chat message. Check DevTools console for any new errors. Regression test: send a malformed prompt that would generate a normal stderr error — verify it still surfaces as a plain `.chat-error`.

**Step 4: Commit**

```bash
git add ace-desktop/src/chat-manager.js
git commit -m "feat(ace-desktop): detect MCP events from stream-json + stderr"
```

---

### Task 5: Typed MCP error cards in renderer

**Files:**
- Modify: `ace-desktop/renderer/modules/session-manager.js`

**Step 1: Add MCP event handler**

In `session-manager.js` at the `cleanupError` handler (line 676), add a new branch **after** the `spawn-failed` block and **before** the generic `else`:

```javascript
    } else if (parsed?.type === 'mcp-event') {
      renderMcpEventCard(msgsEl, id, parsed, sessionsObj)
```

**Step 2: Add the card renderer**

Near the top of the module-scope helpers (after the existing `renderPermissionApprovalCard` or similar), add:

```javascript
function renderMcpEventCard(msgsEl, chatId, evt, sessionsObj) {
  const { subtype, authUrl, server, servers, serverKind, detail } = evt

  // mcp_disconnect is a toast, not a card — auto-dismiss after 5s
  if (subtype === 'mcp_disconnect') {
    const toast = document.createElement('div')
    toast.className = 'chat-error'
    toast.style.cssText = 'opacity:0.7;font-size:12px'
    toast.textContent = `Lost MCP server${(servers?.length || 0) > 1 ? 's' : ''}: ${(servers || []).join(', ')}`
    msgsEl.appendChild(toast)
    setTimeout(() => toast.remove(), 5000)
    return
  }

  // auth_pending is informational — show a subtle inline status, no action
  if (subtype === 'auth_pending') {
    const inline = document.createElement('div')
    inline.className = 'chat-error'
    inline.style.cssText = 'opacity:0.7;font-size:12px'
    inline.textContent = 'MCP authentication in progress…'
    msgsEl.appendChild(inline)
    return
  }

  // Escape all user-controlled strings that land in innerHTML.
  // server/serverKind come from ~/.claude.json names which the user controls.
  const esc = (s) => (s || '').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;')

  const variants = {
    auth_url_ready: {
      title: server ? `Authorize ${esc(server)}` : 'Authorize MCP server',
      body: 'An MCP server needs OAuth authorization. Click below to complete it in your browser.',
      primary: { label: 'Authorize in Browser', handler: async () => {
        const result = await window.ace.mcp.openAuthUrl(authUrl)
        if (!result?.ok) console.error('[mcp] openExternal failed:', result?.error)
      }},
    },
    auth_terminal_fail: {
      title: server ? `${esc(server)} needs re-authentication` : 'MCP re-authentication needed',
      body: 'Auto-refresh failed. Reset credentials to trigger a fresh browser OAuth flow.',
      primary: { label: 'Reset & Re-auth', handler: () => resetMcpAuth(evt) },
    },
    cli_auth_expired: {
      title: `${esc(server) || 'MCP server'} tokens expired`,
      body: 'OAuth tokens have expired and automatic refresh failed.',
      primary: { label: 'Reset & Re-auth', handler: () => resetMcpAuth(evt) },
    },
    cli_auth_required: {
      title: `${esc(serverKind) || 'MCP'} server needs authentication`,
      body: 'This server has never been authenticated in this session.',
      primary: { label: 'Reset & Re-auth', handler: () => resetMcpAuth(evt) },
    },
    mcp_remote_crash: {
      title: 'MCP server crashed',
      body: 'The MCP subprocess exited unexpectedly. Retry your message or restart the server.',
      primary: { label: 'Dismiss', handler: (card) => card.remove() },
    },
    cli_connect_failed: {
      title: `Can't reach ${esc(server) || 'MCP server'}`,
      body: 'The server is configured but couldn\'t be reached. Check network or server status.',
      primary: { label: 'Dismiss', handler: (card) => card.remove() },
    },
    cli_not_connected: {
      title: `${esc(server) || 'MCP server'} not connected`,
      body: 'The server is offline or not responding.',
      primary: { label: 'Dismiss', handler: (card) => card.remove() },
    },
  }

  const variant = variants[subtype]
  if (!variant) {
    // Unknown subtype — fall back to plain error
    const errEl = document.createElement('div')
    errEl.className = 'chat-error'
    errEl.textContent = `MCP event (${subtype}): ${detail || server || ''}`
    msgsEl.appendChild(errEl)
    return
  }

  const card = document.createElement('div')
  card.className = 'chat-error binary-missing-card'
  const detailBlock = detail
    ? `<div style="margin-bottom:10px;opacity:0.55;font-size:11px;white-space:pre-wrap;max-height:60px;overflow:auto">${esc(detail)}</div>`
    : ''
  card.innerHTML = `
    <div style="margin-bottom:6px"><strong>${variant.title}</strong></div>
    <div style="margin-bottom:8px">${variant.body}</div>
    ${detailBlock}
    <div style="display:flex;gap:8px">
      <button class="preflight-btn mcp-primary-btn">${variant.primary.label}</button>
      <button class="preflight-btn" data-dismiss>Dismiss</button>
    </div>`
  card.querySelector('.mcp-primary-btn').addEventListener('click', () => variant.primary.handler(card))
  card.querySelector('[data-dismiss]').addEventListener('click', () => card.remove())
  msgsEl.appendChild(card)
}

async function resetMcpAuth(evt) {
  // Resolve server name → URL via MCP_RESOLVE_SERVER IPC.
  // Reads both ~/.claude.json (user-scope) and <vaultPath>/.mcp.json (project-scope).
  // Do NOT use window.ace.claudeSettings.read() — that reads ~/.claude/settings.json
  // which has NO mcpServers (confirmed by direct inspection of the file).
  try {
    const name = evt.server || evt.serverName
    if (!name) {
      console.warn('[mcp] resetAuth: no server name in event', evt)
      return
    }

    // Vault path needed to find project-scoped servers in .mcp.json.
    const config = await window.ace.config.get()
    const vaultPath = config?.vaultPath || null

    const resolved = await window.ace.mcp.resolveServer(name, vaultPath)
    if (!resolved?.ok) {
      console.warn('[mcp] resetAuth: could not resolve server URL for', name, resolved?.error)
      return
    }

    const result = await window.ace.mcp.resetAuth({
      serverUrl:  resolved.serverUrl,
      resource:   resolved.resource,
      headers:    resolved.headers,
      serverName: name,
    })
    console.log('[mcp] resetAuth result:', result)
    // User will see a fresh auth_url_ready card on their next chat message.
  } catch (err) {
    console.error('[mcp] resetAuth failed:', err)
  }
}
```

**Step 3: Verify `window.ace.config.get` exists in preload**

```bash
grep -n "config.get\|config:" ace-desktop/preload.js | head -10
```

The config IPC (`GET_CONFIG` channel) should already be wired. If `window.ace.config.get` is missing, add it alongside existing config accessors. If the API is shaped differently (e.g. `window.ace.getConfig()`), adjust the call in `resetMcpAuth` accordingly.

**Step 4: Manual test with synthetic events**

Temporarily add to `chat-manager.js` right after `sessions.set(chatId, ...)` (around line 169):

```javascript
// TEMP TEST — remove after verification
setTimeout(() => {
  win.webContents.send(`${ch.CHAT_ERROR}:${chatId}`, JSON.stringify({
    type: 'mcp-event',
    subtype: 'auth_url_ready',
    authUrl: 'https://example.com/oauth',
    server: 'fathom',
  }))
}, 2000)
```

Launch app, send a message. Verify card appears with "Authorize fathom" title and "Authorize in Browser" button. Click button — browser opens to example.com. Remove the test line before Step 5.

Repeat with `subtype: 'cli_auth_expired'` and `subtype: 'mcp_disconnect', servers: ['fathom', 'sentry']`.

**Step 5: Remove test scaffolding**

Remove the temporary setTimeout.

**Step 6: Commit**

```bash
git add ace-desktop/renderer/modules/session-manager.js ace-desktop/preload.js
git commit -m "feat(ace-desktop): typed MCP error cards with browser-based recovery"
```

---

### Task 6: End-to-end verification

**Files:** none modified (verification only)

**Step 1: Real auth-URL path (easiest to stage)**

On the dev machine, force an auth flow for Fathom without breaking state:

```bash
# Back up tokens so you can restore after testing
cp ~/.mcp-auth/mcp-remote-*/e16a953e20eb463806a626921bc28854_tokens.json /tmp/fathom-tokens.bak
cp ~/.mcp-auth/mcp-remote-*/e16a953e20eb463806a626921bc28854_code_verifier.txt /tmp/fathom-verifier.bak 2>/dev/null || true

# Trigger fresh auth
rm ~/.mcp-auth/mcp-remote-*/e16a953e20eb463806a626921bc28854_tokens.json
rm ~/.mcp-auth/mcp-remote-*/e16a953e20eb463806a626921bc28854_code_verifier.txt 2>/dev/null || true
```

Launch ACE Desktop, send a chat message that uses a Fathom tool (e.g. "list my recent meetings via fathom"). Verify:
1. Card appears with title "Authorize fathom" and "Authorize in Browser" button
2. Click button — browser opens to Fathom's OAuth page
3. Complete OAuth — browser shows success, closes
4. Card can be dismissed or auto-clears
5. Send another Fathom-using message — tool call succeeds

Restore tokens if needed:
```bash
cp /tmp/fathom-tokens.bak ~/.mcp-auth/mcp-remote-*/e16a953e20eb463806a626921bc28854_tokens.json
```

**Step 2: Reset & Re-auth path**

```bash
# Corrupt client_info to force InvalidClientError → terminal fail
cp ~/.mcp-auth/mcp-remote-*/e16a953e20eb463806a626921bc28854_client_info.json /tmp/fathom-clientinfo.bak
echo '{}' > ~/.mcp-auth/mcp-remote-*/e16a953e20eb463806a626921bc28854_client_info.json
```

Send a Fathom message. Verify:
1. Card appears with "fathom needs re-authentication" and "Reset & Re-auth" button
2. Click button — files deleted (check `ls ~/.mcp-auth/mcp-remote-*/e16a953e20eb463806a626921bc28854_*`)
3. Send another Fathom message — fresh auth card appears (auth_url_ready)
4. Click Authorize, complete OAuth, verify tool works

Restore:
```bash
cp /tmp/fathom-clientinfo.bak ~/.mcp-auth/mcp-remote-*/e16a953e20eb463806a626921bc28854_client_info.json
# Re-auth if tokens were actually destroyed during the test
```

**Step 3: Lean-mode suppression**

1. Ensure no `ANTHROPIC_API_KEY` in shell or `.env`
2. Lean mode ON (Settings → Chat Defaults)
3. Add a deliberately-broken MCP server to `~/.claude.json`:
   ```json
   "mcp-broken-test": { "command": "npx", "args": ["mcp-remote@latest", "https://nonexistent-server.invalid/mcp"] }
   ```
4. Send any chat message
5. Verify: no MCP error cards appear. Chat works normally.
6. Remove the test server from `~/.claude.json`

**Step 4: Non-MCP regression**

1. Send a chat message that triggers an unrelated error (e.g. wrong model name via config)
2. Verify: error still shows as a plain `.chat-error` — no false MCP card

**Step 5: Mid-session disconnect**

Hard to stage manually. Accept this as a known gap and add a TODO note in `chat-manager.js`:
```javascript
// TODO: manually verify mcp_instructions_delta disconnect path against a
// long-running MCP server killed mid-session. Not covered in Task 6.
```

**Step 6: Final commit (if any TODO or cleanup)**

```bash
git add ace-desktop/src/chat-manager.js ace-desktop/renderer/modules/session-manager.js
git commit -m "chore(ace-desktop): MCP resilience verification cleanup"
```

---

## Rollback plan

If MCP detection regresses chat error handling in production:

1. Revert Task 4's stderr changes (single file, single commit).
2. Keep Task 2 (IPC channels) and Task 3 (main-process helper) — they're inert without the stderr side.
3. The renderer card handler (Task 5) degrades gracefully: unknown `mcp-event` types fall back to a plain error.

---

## Deferred to Phase 2

- Startup MCP health dashboard in Settings view (`claude mcp list` output + per-server actions).
- claude.ai proxy OAuth (Gmail/Calendar/Drive) — different flow, needs its own detection branch.
- HTTP transport OAuth (`claude mcp add -t http` with `--client-id`) — different token storage.
- Per-server enable/disable without editing `~/.claude.json`.
- Auto-dismiss cards when `Connected to remote server` stderr arrives (requires cross-message state).
