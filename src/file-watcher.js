const path     = require('path')
const chokidar = require('chokidar')
const ch       = require('./ipc-channels')

let watcher = null

function start(win) {
  const vaultPath = global.VAULT_PATH
  if (!vaultPath || watcher) return

  // ── Files that have dedicated parsers + IPC events ──
  const dedicatedFiles = [
    path.join(vaultPath, '00-System', 'state.md'),
    path.join(vaultPath, '00-System', 'active.md'),
    path.join(vaultPath, '00-System', 'sitrep.md'),
    path.join(vaultPath, '04-Network', 'follow-ups.md'),
  ]

  // ── Files that feed cockpit widgets (generic refresh) ──
  const cockpitFiles = [
    path.join(vaultPath, '00-System', 'core', 'dca.md'),
    path.join(vaultPath, '00-System', 'system-metrics.md'),
    path.join(vaultPath, '00-System', 'execution-log.md'),
    path.join(vaultPath, '00-System', 'execution-log-recent.md'),
    path.join(vaultPath, '00-System', 'pulse-cache.md'),
  ]

  // ── Directories where new/changed files trigger refresh ──
  const cockpitDirs = [
    path.join(vaultPath, '01-Journal', 'daily'),
    path.join(vaultPath, '01-Journal', 'weekly-reviews'),
    path.join(vaultPath, '01-Journal', 'monthly-reviews'),
  ]

  const opts = {
    persistent: true,
    ignoreInitial: true,
    awaitWriteFinish: { stabilityThreshold: 400, pollInterval: 100 },
  }

  // Dedicated watcher — specific parsers per file
  const dedicatedWatcher = chokidar.watch(dedicatedFiles, opts)

  dedicatedWatcher.on('change', (filePath) => {
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

  // Cockpit watcher — generic refresh for all intelligence bar sources
  const cockpitWatcher = chokidar.watch([...cockpitFiles, ...cockpitDirs], {
    ...opts,
    depth: 0, // only top-level files in watched dirs (no recursion)
  })

  const sendRefresh = () => {
    if (!win.isDestroyed()) win.webContents.send(ch.DASH_REFRESH)
  }

  cockpitWatcher.on('change', sendRefresh)
  cockpitWatcher.on('add', sendRefresh) // new daily note created, new review file, etc.

  watcher = { dedicatedWatcher, cockpitWatcher }
}

module.exports = { start }
