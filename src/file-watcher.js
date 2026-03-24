const path     = require('path')
const chokidar = require('chokidar')
const ch       = require('./ipc-channels')

let watcher = null

function start(win) {
  const vaultPath = global.VAULT_PATH
  if (!vaultPath || watcher) return

  const watched = [
    path.join(vaultPath, '00-System', 'state.md'),
    path.join(vaultPath, '00-System', 'active.md'),
    path.join(vaultPath, '00-System', 'sitrep.md'),
    path.join(vaultPath, '04-Network', 'follow-ups.md'),
  ]

  watcher = chokidar.watch(watched, {
    persistent: true,
    ignoreInitial: true,
    awaitWriteFinish: { stabilityThreshold: 400, pollInterval: 100 },
  })

  watcher.on('change', (filePath) => {
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
  })
}

module.exports = { start }
