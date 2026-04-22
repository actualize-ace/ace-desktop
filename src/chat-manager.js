// Chat manager — spawns Claude Code with --output-format stream-json,
// parses NDJSON output, forwards structured events to renderer via IPC.
// Each message is a separate process invocation. Multi-turn via --resume.

const { spawn, spawnSync } = require('child_process')
const path = require('path')
const fs = require('fs')
const ch = require('./ipc-channels')

const sessions = new Map() // chatId → { proc, claudeSessionId, _evtQueue, _flushTimer }

// Windows ignores SIGTERM for non-console apps and has no concept of signal-
// based graceful shutdown. `taskkill /T /F` force-kills the process tree,
// matching the behavior we already get from SIGTERM on Unix.
function killProc(proc) {
  if (!proc || !proc.pid) return
  if (process.platform === 'win32') {
    try { spawnSync('taskkill', ['/pid', String(proc.pid), '/T', '/F']) } catch {}
  } else {
    try { proc.kill('SIGTERM') } catch {}
  }
}

// Classify binary-path failure so the error card explains the actual problem.
// Returns null if the path looks usable; otherwise { reason, path }.
function diagnoseBinary(claudeBin) {
  if (!claudeBin) return { reason: 'unconfigured', path: null }
  if (typeof claudeBin !== 'string') return { reason: 'invalid-type', path: String(claudeBin) }
  if (!fs.existsSync(claudeBin)) return { reason: 'path-missing', path: claudeBin }
  try {
    fs.accessSync(claudeBin, fs.constants.X_OK)
  } catch {
    return { reason: 'not-executable', path: claudeBin }
  }
  return null
}

// ── MCP event detection ─────────────────────────────────────────────────────
// Sources:
//   2a. stdout stream-json:   mcp_instructions_delta, elicitation system event
//   2b. stderr from mcp-remote subprocess (PID-prefixed lines)
//   2c. stderr from Claude CLI itself (pre-init + mid-session)
//
// All patterns verified against Claude Code 2.1.92 + mcp-remote 0.1.37
// bundled sources — NOT speculative.

// mcp-remote stderr patterns (line-level)
const MCP_REMOTE_AUTH_URL_RE  = /Please authorize this client by visiting:\s*(https?:\/\/\S+)/i
const MCP_REMOTE_TERMINAL_RE  = /Already attempted reconnection.*Giving up/i
const MCP_REMOTE_FATAL_RE     = /Fatal error:/i
const MCP_REMOTE_AUTH_PEND_RE = /Authentication required\.\s*(?:Initializing auth|Waiting for authorization)/i
const MCP_REMOTE_SUCCESS_RE   = /Connected to remote server/i

// Claude CLI stderr patterns
const CLI_AUTH_EXPIRED_RE  = /MCP server\s+"([^"]+)"\s+requires re-authorization\s+\(token expired\)/i
const CLI_NOT_CONNECTED_RE = /MCP server\s+"([^"]+)"\s+is not connected/i
const CLI_CONNECT_FAILED_RE = /Failed to connect to MCP server\s+'([^']+)'/i
const CLI_AUTH_REQUIRED_RE = /Authentication required for (HTTP|claude\.ai proxy) server/i

function classifyMcpLine(text) {
  let m
  if ((m = text.match(MCP_REMOTE_AUTH_URL_RE))) return { subtype: 'auth_url_ready', authUrl: m[1] }
  if (MCP_REMOTE_TERMINAL_RE.test(text))        return { subtype: 'auth_terminal_fail' }
  if (MCP_REMOTE_FATAL_RE.test(text))           return { subtype: 'mcp_remote_crash', detail: text.trim().slice(0, 500) }
  if (MCP_REMOTE_AUTH_PEND_RE.test(text))       return { subtype: 'auth_pending' }
  if ((m = text.match(CLI_AUTH_EXPIRED_RE)))    return { subtype: 'cli_auth_expired', server: m[1] }
  if ((m = text.match(CLI_NOT_CONNECTED_RE)))   return { subtype: 'cli_not_connected', server: m[1] }
  if ((m = text.match(CLI_CONNECT_FAILED_RE)))  return { subtype: 'cli_connect_failed', server: m[1] }
  if ((m = text.match(CLI_AUTH_REQUIRED_RE)))   return { subtype: 'cli_auth_required', serverKind: m[1] }
  return null
}

function isMcpNoise(text) {
  return MCP_REMOTE_SUCCESS_RE.test(text)
}

function send(win, chatId, prompt, cwd, claudeBin, claudeSessionId, opts) {
  // Kill any existing process for this chatId
  cancel(chatId)
  opts = opts || {}

  // Pre-spawn binary guard — classify the failure so the error card can
  // show the actual cause (undefined vs missing vs unreadable).
  const binaryIssue = diagnoseBinary(claudeBin)
  if (binaryIssue) {
    if (!win.isDestroyed()) {
      win.webContents.send(`${ch.CHAT_ERROR}:${chatId}`,
        JSON.stringify({ type: 'binary-missing', ...binaryIssue }))
    }
    return
  }

  const args = ['-p', prompt, '--output-format', 'stream-json',
                '--verbose', '--include-partial-messages']
  if (claudeSessionId) args.push('--resume', claudeSessionId)

  // Model selection — only pass Claude-native models (not ollama: prefixed sovereign models)
  if (opts.model && !opts.model.startsWith('ollama:')) {
    args.push('--model', opts.model)
  }

  // Permission mode — -p mode can't do interactive approvals.
  // .claude/ edits are denied by the CLI regardless of mode — the renderer
  // catches permission_denials and shows an approval card (applied via fs).
  if (opts.permissions === 'auto') {
    args.push('--dangerously-skip-permissions')
  } else if (opts.permissions === 'plan') {
    args.push('--permission-mode', 'plan')
  } else {
    args.push('--permission-mode', 'acceptEdits')
  }

  // Reasoning effort — always pass explicitly
  if (opts.effort) {
    args.push('--effort', opts.effort)
  }

  // Token economy — lean mode (Phase 1)
  // Strips MCP server schemas (~45k tokens) without breaking skills or tools.
  // --bare gives deeper savings but requires ANTHROPIC_API_KEY (breaks OAuth/Max).
  if (opts.lean !== false) {
    const hasApiKey = !!process.env.ANTHROPIC_API_KEY

    if (hasApiKey) {
      args.push('--bare', '--add-dir', cwd)
      // Inject CLAUDE.md manually when --bare kills auto-discovery
      const claudeMdPath = path.join(cwd, 'CLAUDE.md')
      if (fs.existsSync(claudeMdPath)) {
        args.push('--append-system-prompt',
          fs.readFileSync(claudeMdPath, 'utf8'))
      }
    } else if (opts.suppressMcp) {
      // Client vaults: suppress user-scoped MCP servers so clients don't see
      // Nikhil's Fathom/Gmail/etc. Set suppressMcp:true in client ace-config.json.
      // --strict-mcp-config without --mcp-config = zero MCP servers loaded.
      args.push('--strict-mcp-config')
    }
    // else: OAuth/Max on own vault — MCP loads normally
  }

  // Augment PATH so the Claude binary can find `node` and other dependencies
  // in packaged Electron apps that inherit a minimal system PATH.
  // Covers Homebrew (arm64 + Intel), nvm, volta, fnm, asdf, and mise installs.
  const home = require('os').homedir()
  let augmentedPath
  if (process.platform === 'win32') {
    augmentedPath = [
      path.join(process.env.APPDATA || '', 'npm'),
      path.join(process.env.LOCALAPPDATA || '', 'Programs', 'nodejs'),
      process.env.PATH || '',
    ].filter(Boolean).join(';')
  } else if (process.platform === 'darwin') {
    augmentedPath = [
      '/opt/homebrew/bin',
      '/usr/local/bin',
      '/usr/bin',
      // nvm — default install; exact version dir unknown so probe shims path
      path.join(home, '.nvm', 'versions', 'node', 'current', 'bin'),
      // volta
      path.join(home, '.volta', 'bin'),
      // fnm
      path.join(home, '.fnm', 'aliases', 'default', 'bin'),
      // mise / asdf shims (covers node + claude installed via tool manager)
      path.join(home, '.local', 'share', 'mise', 'shims'),
      path.join(home, '.asdf', 'shims'),
      path.join(home, '.local', 'bin'),
      process.env.PATH || '',
    ].filter(Boolean).join(':')
  } else {
    // linux
    augmentedPath = [
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
    ].filter(Boolean).join(':')
  }

  // On Windows, .cmd wrappers require shell:true so the OS routes the
  // invocation through cmd.exe — without it, stdio pipes never connect
  // and the process hangs silently (node-pty works because ConPTY handles
  // this internally; bare spawn does not).
  const needsShell = process.platform === 'win32' && /\.(cmd|bat)$/i.test(claudeBin)
  const spawnStartMs = Date.now()
  const proc = spawn(claudeBin, args, {
    cwd,
    stdio: ['pipe', 'pipe', 'pipe'],
    env: { ...process.env, PATH: augmentedPath, TERM: 'xterm-256color', COLORTERM: 'truecolor', ELECTRON_RUN_AS_NODE: undefined, MCP_CONNECTION_NONBLOCKING: undefined },
    shell: needsShell,
  })
  if (!win.isDestroyed()) win.webContents.send(`${ch.CHAT_SPAWN_STATUS}:${chatId}`, { status: 'starting' })

  // Spawn-level failures (ENOENT for node, EACCES, etc.) are emitted on the
  // proc itself — without this listener they'd surface only as an exit with
  // no stderr and the renderer would show nothing.
  proc.on('error', err => {
    if (win.isDestroyed()) return
    win.webContents.send(`${ch.CHAT_SPAWN_STATUS}:${chatId}`, { status: 'failed' })
    win.webContents.send(`${ch.CHAT_ERROR}:${chatId}`,
      JSON.stringify({
        type: 'spawn-failed',
        code: err.code,
        message: err.message,
        path: claudeBin,
      }))
  })

  // Per-session IPC batch buffer — flush every 16 ms (≈1 frame) to prevent
  // flooding the renderer when two+ heavy Opus streams run concurrently.
  const sessionEntry = { proc, claudeSessionId, _evtQueue: [], _flushTimer: null }
  sessions.set(chatId, sessionEntry)

  const flushEvents = () => {
    const entry = sessions.get(chatId)
    if (!entry || entry._evtQueue.length === 0) return
    const batch = entry._evtQueue.splice(0)
    entry._flushTimer = null
    if (!win.isDestroyed()) win.webContents.send(`${ch.CHAT_STREAM}:${chatId}`, batch)
  }

  const queueEvent = (event) => {
    const entry = sessions.get(chatId)
    if (!entry) return
    entry._evtQueue.push(event)
    if (!entry._flushTimer) entry._flushTimer = setTimeout(flushEvents, 16)
  }

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
    if (!win.isDestroyed()) win.webContents.send(`${ch.CHAT_SPAWN_STATUS}:${chatId}`, { status: 'ready', spawnMs: Date.now() - spawnStartMs })
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

  // Buffer cap — if upstream emits a pathological 100MB+ line without a
  // newline, main-process memory would climb unbounded. 1MB is well above
  // any legitimate single stream-json line (typical: <5KB).
  const MAX_BUF = 1 * 1024 * 1024
  proc.stdout.on('data', chunk => {
    if (win.isDestroyed()) return
    if (startupPhase) flushStartupBuffer()

    buffer += chunk.toString()
    if (buffer.length > MAX_BUF) {
      if (!win.isDestroyed()) {
        win.webContents.send(`${ch.CHAT_ERROR}:${chatId}`, JSON.stringify({
          type: 'stream-buffer-overflow',
          message: `chat stream buffer exceeded ${MAX_BUF} bytes; discarding partial line`,
        }))
      }
      buffer = ''
      return
    }
    const lines = buffer.split(/\r?\n/)
    buffer = lines.pop()
    for (const line of lines) {
      if (!line.trim()) continue
      try {
        const event = JSON.parse(line)
        // removedNames field name confirmed in Claude Code 2.1.92 binary.
        if (event.type === 'mcp_instructions_delta' && event.removedNames?.length) {
          emitMcpEvent({ subtype: 'mcp_disconnect', servers: event.removedNames })
        }
        // Elicitation auth URL arrives as a system event — NOT as error.code -32042.
        // Code -32042 is the internal MCP wire error; stream-json unwraps it into
        // { type:"system", subtype:"elicitation", mode:"url", url, mcp_server_name, elicitation_id }
        if (event.type === 'system' && event.subtype === 'elicitation' &&
            event.mode === 'url' && typeof event.url === 'string') {
          emitMcpEvent({ subtype: 'auth_url_ready', authUrl: event.url, server: event.mcp_server_name })
        }
        queueEvent(event)
      } catch {}
    }
  })

  // Stderr — buffer during startup phase, classify MCP lines, forward the rest.
  proc.stderr.on('data', chunk => {
    if (win.isDestroyed()) return
    const text = chunk.toString()
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
  // TODO: manually verify mcp_instructions_delta disconnect path against a
  // long-running MCP server killed mid-session. Not covered in Task 6.

  proc.on('close', code => {
    const entry = sessions.get(chatId)
    if (entry?._flushTimer) { clearTimeout(entry._flushTimer); flushEvents() }
    sessions.delete(chatId)
    if (!win.isDestroyed()) {
      win.webContents.send(`${ch.CHAT_EXIT}:${chatId}`, code)
    }
  })
}

function cancel(chatId) {
  const s = sessions.get(chatId)
  if (s?.proc) {
    killProc(s.proc)
    sessions.delete(chatId)
  }
}

function cancelAll() {
  for (const [, s] of sessions) {
    killProc(s.proc)
  }
  sessions.clear()
}

function respond(chatId, text) {
  const s = sessions.get(chatId)
  if (s?.proc?.stdin?.writable) {
    s.proc.stdin.write(text + '\n')
  }
}

// Warm up OS binary caches (AV scanning, Node.js module load) by running
// `claude --version` in the background. Zero tokens, no API call, no output.
// Fires ~5s after first user activity so the real first send has a head start.
function prewarm(claudeBin) {
  if (!claudeBin) return
  try {
    const pw = spawn(claudeBin, ['--version'], {
      stdio: 'ignore',
      env: { ...process.env },
    })
    pw.on('error', () => { /* silent — binary may not support --version */ })
    pw.unref()
  } catch (_) { /* ignored */ }
}

module.exports = { send, cancel, cancelAll, respond, prewarm }
