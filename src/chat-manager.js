// Chat manager — spawns Claude Code with --output-format stream-json,
// parses NDJSON output, forwards structured events to renderer via IPC.
// Each message is a separate process invocation. Multi-turn via --resume.

const { spawn, spawnSync } = require('child_process')
const path = require('path')
const fs = require('fs')
const ch = require('./ipc-channels')

const sessions = new Map() // chatId → { proc, claudeSessionId }

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
    } else {
      // OAuth/Max path — suppress MCP servers but keep skills + all tools
      args.push('--strict-mcp-config')
    }
  }

  // Augment PATH so the Claude binary (a Node.js script) can find `node`
  // in packaged Electron apps that inherit a minimal system PATH.
  const augmentedPath = [
    '/opt/homebrew/bin',
    '/usr/local/bin',
    '/usr/bin',
    process.env.PATH || '',
  ].filter(Boolean).join(process.platform === 'win32' ? ';' : ':')

  // On Windows, .cmd wrappers require shell:true so the OS routes the
  // invocation through cmd.exe — without it, stdio pipes never connect
  // and the process hangs silently (node-pty works because ConPTY handles
  // this internally; bare spawn does not).
  const needsShell = process.platform === 'win32' && /\.(cmd|bat)$/i.test(claudeBin)
  const proc = spawn(claudeBin, args, {
    cwd,
    stdio: ['pipe', 'pipe', 'pipe'],
    env: { ...process.env, PATH: augmentedPath, TERM: 'xterm-256color', COLORTERM: 'truecolor' },
    shell: needsShell,
  })

  // Spawn-level failures (ENOENT for node, EACCES, etc.) are emitted on the
  // proc itself — without this listener they'd surface only as an exit with
  // no stderr and the renderer would show nothing.
  proc.on('error', err => {
    if (win.isDestroyed()) return
    win.webContents.send(`${ch.CHAT_ERROR}:${chatId}`,
      JSON.stringify({
        type: 'spawn-failed',
        code: err.code,
        message: err.message,
        path: claudeBin,
      }))
  })

  sessions.set(chatId, { proc, claudeSessionId })

  // Line-buffered NDJSON parsing
  let buffer = ''
  proc.stdout.on('data', chunk => {
    if (win.isDestroyed()) return
    buffer += chunk.toString()
    const lines = buffer.split('\n')
    buffer = lines.pop() // keep incomplete trailing line
    for (const line of lines) {
      if (!line.trim()) continue
      try {
        const event = JSON.parse(line)
        win.webContents.send(`${ch.CHAT_STREAM}:${chatId}`, event)
      } catch {}
    }
  })

  // Stderr — filter noise, forward actual errors
  proc.stderr.on('data', chunk => {
    if (win.isDestroyed()) return
    const text = chunk.toString()
    if (text.includes('No STDIN data received') || text.includes('proceeding without')) return
    win.webContents.send(`${ch.CHAT_ERROR}:${chatId}`, text)
  })

  proc.on('close', code => {
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

module.exports = { send, cancel, cancelAll, respond }
