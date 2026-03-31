// Chat manager — spawns Claude Code with --output-format stream-json,
// parses NDJSON output, forwards structured events to renderer via IPC.
// Each message is a separate process invocation. Multi-turn via --resume.

const { spawn } = require('child_process')
const ch = require('./ipc-channels')

const sessions = new Map() // chatId → { proc, claudeSessionId }

function send(win, chatId, prompt, cwd, claudeBin, claudeSessionId, opts) {
  // Kill any existing process for this chatId
  cancel(chatId)
  opts = opts || {}

  const args = ['-p', prompt, '--output-format', 'stream-json',
                '--verbose', '--include-partial-messages']
  if (claudeSessionId) args.push('--resume', claudeSessionId)

  // Model selection — always pass explicitly (CLI default may differ)
  if (opts.model) {
    args.push('--model', opts.model)
  }

  // Permission mode — -p mode can't do interactive approvals, so:
  // "Normal" = pre-approve all standard tools (Bash, Edit, Write, Read, etc.)
  // "Plan" = read-only permission mode
  // "Auto" = skip all permissions entirely
  if (opts.permissions === 'auto') {
    args.push('--dangerously-skip-permissions')
  } else if (opts.permissions === 'plan') {
    args.push('--permission-mode', 'plan')
  } else {
    // Normal mode — let project settings.json handle permissions (defaultMode: acceptEdits)
    // Don't pass any flag — claude -p will read the project config automatically
  }

  // Reasoning effort — always pass explicitly
  if (opts.effort) {
    args.push('--effort', opts.effort)
  }

  const proc = spawn(claudeBin, args, {
    cwd,
    stdio: ['pipe', 'pipe', 'pipe'],
    env: { ...process.env, TERM: 'xterm-256color', COLORTERM: 'truecolor' },
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
    try { s.proc.kill('SIGTERM') } catch {}
    sessions.delete(chatId)
  }
}

function cancelAll() {
  for (const [, s] of sessions) {
    try { s.proc.kill('SIGTERM') } catch {}
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
