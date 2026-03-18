const pty = require('node-pty')
const ch  = require('./ipc-channels')

const sessions = new Map()

function create(win, id, cwd, claudeBin, cols, rows) {
  const shell = pty.spawn(claudeBin, [], {
    name: 'xterm-256color',
    cols: cols || 120,
    rows: rows || 30,
    cwd,
    env: {
      ...process.env,
      TERM:      'xterm-256color',
      COLORTERM: 'truecolor',
    },
  })

  sessions.set(id, shell)

  shell.onData(data => {
    if (!win.isDestroyed()) {
      win.webContents.send(`${ch.PTY_DATA}:${id}`, data)
    }
  })

  shell.onExit(({ exitCode }) => {
    sessions.delete(id)
    if (!win.isDestroyed()) {
      win.webContents.send(ch.SESSION_EXIT, id, exitCode)
    }
  })

  win.webContents.send(ch.SESSION_SPAWNED, id)
  return id
}

function write(id, data) {
  const p = sessions.get(id)
  if (p) p.write(data)
}

function resize(id, cols, rows) {
  const p = sessions.get(id)
  if (p) p.resize(cols, rows)
}

function kill(id) {
  const p = sessions.get(id)
  if (p) { try { p.kill() } catch {} sessions.delete(id) }
}

function killAll() {
  for (const [, p] of sessions) { try { p.kill() } catch {} }
  sessions.clear()
}

module.exports = { sessions, create, write, resize, kill, killAll }
