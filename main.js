const { app, BrowserWindow, ipcMain, dialog, shell, session } = require('electron')
const path = require('path')
const fs = require('fs')
const { execSync, spawn } = require('child_process')
const ch = require('./src/ipc-channels')

// ─── Global Error Handlers ───────────────────────────────────────────────────

process.on('uncaughtException', (err) => {
  console.error('[main] uncaughtException:', err)
})

process.on('unhandledRejection', (reason) => {
  console.error('[main] unhandledRejection:', reason)
})

// ─── Single Instance Lock ─────────────────────────────────────────────────────

const gotLock = app.requestSingleInstanceLock()
if (!gotLock) {
  app.quit()
}

app.on('second-instance', () => {
  // If someone tries to open a second instance, focus the existing window
  if (mainWindow) {
    if (mainWindow.isMinimized()) mainWindow.restore()
    mainWindow.focus()
  }
})

// ─── Config ───────────────────────────────────────────────────────────────────

function getConfigPath() {
  return path.join(app.getPath('userData'), 'ace-config.json')
}

function loadConfig() {
  try {
    return JSON.parse(fs.readFileSync(getConfigPath(), 'utf8'))
  } catch {
    return null
  }
}

function saveConfig(config) {
  fs.writeFileSync(getConfigPath(), JSON.stringify(config, null, 2), 'utf8')
}

// ─── Binary Detection ─────────────────────────────────────────────────────────

const KNOWN_PATHS = [
  '/Users/' + require('os').userInfo().username + '/.local/bin/claude',
  '/usr/local/bin/claude',
  '/opt/homebrew/bin/claude',
]

function detectClaudeBinary() {
  // Try which first
  try {
    const result = execSync('which claude', { encoding: 'utf8', env: process.env }).trim()
    if (result && fs.existsSync(result)) return result
  } catch {}

  // Try known paths
  for (const p of KNOWN_PATHS) {
    if (fs.existsSync(p)) return p
  }

  return null
}

// ─── Window ───────────────────────────────────────────────────────────────────

let mainWindow = null

function createWindow(page) {
  mainWindow = new BrowserWindow({
    width: 1400,
    height: 900,
    titleBarStyle: 'hiddenInset',
    backgroundColor: '#0a0a0f',
    icon: path.join(__dirname, 'assets', 'ace.icns'),
    webPreferences: {
      nodeIntegration: false,
      contextIsolation: true,
      sandbox: false,        // required: preload uses require() for ipc-channels
      preload: path.join(__dirname, 'preload.js'),
    },
  })

  mainWindow.loadFile(path.join(__dirname, 'renderer', page))

  // Open DevTools in development
  if (!app.isPackaged) {
    mainWindow.webContents.openDevTools({ mode: 'detach' })
  }

  // Forward renderer console errors to stdout for debugging
  mainWindow.webContents.on('console-message', (_, level, msg, line, source) => {
    if (level >= 2) console.log(`[renderer:${level}] ${msg} (${source}:${line})`)
  })
}

// ─── App Lifecycle ────────────────────────────────────────────────────────────

app.setName('ACE')


app.whenReady().then(() => {
  // Set dock icon explicitly (required on macOS in dev mode)
  if (process.platform === 'darwin' && app.dock) {
    app.dock.setIcon(path.join(__dirname, 'assets', 'ace.png'))
  }

  // Allow microphone access for Insight voice coaching
  session.defaultSession.setPermissionRequestHandler((webContents, permission, callback) => {
    if (permission === 'media') {
      callback(true)
    } else {
      callback(true)  // allow all standard permissions
    }
  })

  const config = loadConfig()
  const vaultMissing = config && !fs.existsSync(config.vaultPath)

  // Load API key from config if not already in env
  if (config?.anthropicApiKey && !process.env.ANTHROPIC_API_KEY) {
    process.env.ANTHROPIC_API_KEY = config.anthropicApiKey
  }

  if (!config || vaultMissing) {
    createWindow('setup.html')
  } else {
    global.VAULT_PATH = config.vaultPath
    global.CLAUDE_BIN = config.claudeBinaryPath
    createWindow('index.html')
    require('./src/file-watcher').start(mainWindow)
    require('./src/db-reader').open(config.vaultPath)
  }
})

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit()
})

app.on('activate', () => {
  if (BrowserWindow.getAllWindows().length === 0) {
    const config = loadConfig()
    createWindow(config ? 'index.html' : 'setup.html')
  }
})

app.on('before-quit', () => {
  try { require('./src/pty-manager').killAll() } catch {}
  try { require('./src/chat-manager').cancelAll() } catch {}
})

// ─── PTY IPC Handlers ────────────────────────────────────────────────────────

ipcMain.handle('pty-create', (_, id, cwd, cols, rows) => {
  return require('./src/pty-manager').create(mainWindow, id, cwd || global.VAULT_PATH, global.CLAUDE_BIN, cols, rows)
})

ipcMain.on('pty-write',  (_, id, data)       => require('./src/pty-manager').write(id, data))
ipcMain.on('pty-resize', (_, id, cols, rows) => require('./src/pty-manager').resize(id, cols, rows))
ipcMain.on('pty-kill',   (_, id)             => require('./src/pty-manager').kill(id))
ipcMain.handle(ch.PTY_RESUME, (_, id, cwd, cols, rows, sessionId) => {
  return require('./src/pty-manager').resume(mainWindow, id, cwd || global.VAULT_PATH, global.CLAUDE_BIN, cols, rows, sessionId)
})

// ─── Chat IPC Handlers (stream-json mode) ────────────────────────────────────

ipcMain.handle(ch.CHAT_SEND, (_, chatId, prompt, claudeSessionId, opts) => {
  return require('./src/chat-manager').send(mainWindow, chatId, prompt,
    global.VAULT_PATH, global.CLAUDE_BIN, claudeSessionId, opts)
})
ipcMain.on(ch.CHAT_CANCEL, (_, chatId) => require('./src/chat-manager').cancel(chatId))
ipcMain.on(ch.CHAT_RESPOND, (_, chatId, text) => require('./src/chat-manager').respond(chatId, text))

// ─── Setup IPC Handlers ───────────────────────────────────────────────────────

ipcMain.handle(ch.DETECT_BINARY, () => {
  return detectClaudeBinary()
})

ipcMain.handle(ch.PICK_VAULT, async () => {
  const result = await dialog.showOpenDialog(mainWindow, {
    properties: ['openDirectory'],
    message: 'Select your ACE vault folder',
  })
  if (result.canceled || !result.filePaths.length) return null
  const vaultPath = result.filePaths[0]
  const hasMcp = fs.existsSync(path.join(vaultPath, '.mcp.json'))
  return { vaultPath, hasMcp }
})

ipcMain.handle(ch.SAVE_CONFIG, (_, config) => {
  saveConfig(config)
  // Reload into main UI
  global.VAULT_PATH = config.vaultPath
  global.CLAUDE_BIN = config.claudeBinaryPath
  if (config.anthropicApiKey) process.env.ANTHROPIC_API_KEY = config.anthropicApiKey
  require('./src/file-watcher').start(mainWindow)
  require('./src/db-reader').open(config.vaultPath)
  require('./src/vault-scanner').invalidateCache()
  mainWindow.loadFile(path.join(__dirname, 'renderer', 'index.html'))
})

ipcMain.handle(ch.PATCH_CONFIG, (_, partial) => {
  const config = loadConfig() || {}
  // Deep merge for nested objects like defaults
  for (const key of Object.keys(partial)) {
    if (typeof partial[key] === 'object' && !Array.isArray(partial[key]) && config[key]) {
      Object.assign(config[key], partial[key])
    } else {
      config[key] = partial[key]
    }
  }
  saveConfig(config)
  return true
})

ipcMain.handle(ch.GET_CONFIG, () => loadConfig())

// ─── Dashboard IPC Handlers ───────────────────────────────────────────────────

ipcMain.handle(ch.GET_STATE, () => {
  try { return require('./src/vault-reader').parseState(global.VAULT_PATH) } catch (e) { return { error: e.message } }
})

ipcMain.handle(ch.GET_PIPELINE, () => {
  try { return require('./src/db-reader').getPipeline() } catch (e) { return { error: e.message } }
})

ipcMain.handle(ch.GET_FOLLOWUPS, () => {
  try { return require('./src/vault-reader').parseFollowUps(global.VAULT_PATH) } catch (e) { return { error: e.message } }
})

ipcMain.handle(ch.GET_METRICS, () => {
  try {
    const metrics = require('./src/db-reader').getMetrics()
    metrics._signals = require('./src/synthesizer').parseSignalDetails(global.VAULT_PATH)
    return metrics
  } catch (e) { return { error: e.message } }
})

ipcMain.handle(ch.GET_VELOCITY, () => {
  try { return require('./src/vault-reader').parseExecutionLog(global.VAULT_PATH, 14) }
  catch (e) { return { byDay: {}, totalThisWeek: 0, totalLastWeek: 0, error: e.message } }
})

ipcMain.handle(ch.GET_RHYTHM, () => {
  try { return require('./src/vault-reader').parseRitualRhythm(global.VAULT_PATH) }
  catch (e) { return { week: [], streaks: { start: 0, close: 0, eod: 0 }, error: e.message } }
})

ipcMain.handle(ch.GET_PEOPLE, () => {
  try { return require('./src/vault-reader').parsePeople(global.VAULT_PATH) }
  catch (e) { return { people: [], categories: [], error: e.message } }
})

ipcMain.handle(ch.GET_USAGE, () => {
  try { return require('./src/usage-probe').probe() }
  catch (e) { return { session: null, weekly: null, error: e.message } }
})

// ─── Vault Health ──────────────────────────────────────────────────────────
ipcMain.handle(ch.VAULT_HEALTH_CHECK, () => {
  try { return require('./src/vault-health').checkVaultHealth(global.VAULT_PATH) }
  catch (e) { return { ok: false, error: e.message, missing: [], score: 0 } }
})
ipcMain.handle(ch.VAULT_SCAFFOLD_ITEM, (_, item) => {
  try { return require('./src/vault-health').scaffoldItem(global.VAULT_PATH, item) }
  catch (e) { return { ok: false, error: e.message } }
})
ipcMain.handle(ch.VAULT_SCAFFOLD_ALL, (_, missing) => {
  try { return require('./src/vault-health').scaffoldAll(global.VAULT_PATH, missing) }
  catch (e) { return { ok: false, error: e.message } }
})
ipcMain.handle(ch.VAULT_GET_COLOR_MAP, () => {
  try { return require('./src/vault-health').getColorMap(global.VAULT_PATH) }
  catch (e) { return {} }
})

ipcMain.handle(ch.GET_SYNTHESIS_AI, async (_, context) => {
  const voicePath = require('path').join(global.VAULT_PATH, '00-System', 'core', 'voice-profile.md')
  try { return await require('./src/synthesizer').getAISynthesis(context, voicePath, global.CLAUDE_BIN) }
  catch (e) { return null }
})

ipcMain.handle(ch.GET_LAYOUT, () => {
  const config = loadConfig() || {}
  return config.layout || null
})

ipcMain.handle(ch.SAVE_LAYOUT, (_, layout) => {
  const config = loadConfig() || {}
  config.layout = layout
  saveConfig(config)
  return true
})

// ─── Vault IPC Handlers ───────────────────────────────────────────────────────

function resolveInsideVault(targetPath) {
  const realVault = fs.realpathSync(global.VAULT_PATH)
  const realTarget = fs.realpathSync(path.resolve(targetPath))
  if (!realTarget.startsWith(realVault + path.sep) && realTarget !== realVault) return null
  return realTarget
}

ipcMain.handle(ch.VAULT_LIST_DIR, (_, dirPath) => {
  const resolved = resolveInsideVault(dirPath || global.VAULT_PATH)
  if (!resolved) return { error: 'Access denied: path outside vault' }
  try { return require('./src/vault-reader').listDir(resolved) } catch (e) { return { error: e.message } }
})

ipcMain.handle(ch.VAULT_READ_FILE, (_, filePath) => {
  const resolved = resolveInsideVault(filePath)
  if (!resolved) return { error: 'Access denied: path outside vault' }
  try { return fs.readFileSync(resolved, 'utf8') } catch (e) { return { error: e.message } }
})

ipcMain.handle(ch.VAULT_WRITE_FILE, (_, filePath, content) => {
  const resolved = resolveInsideVault(filePath)
  if (!resolved) return { error: 'Access denied: path outside vault' }
  try { fs.writeFileSync(resolved, content, 'utf8'); return { ok: true } }
  catch (e) { return { error: e.message } }
})

// Claude settings (~/.claude/settings.json)
const CLAUDE_SETTINGS_PATH = path.join(require('os').homedir(), '.claude', 'settings.json')

ipcMain.handle(ch.CLAUDE_SETTINGS_READ, () => {
  try { return fs.readFileSync(CLAUDE_SETTINGS_PATH, 'utf8') }
  catch (e) { return { error: e.message } }
})

ipcMain.handle(ch.CLAUDE_SETTINGS_WRITE, (_, content) => {
  try { fs.writeFileSync(CLAUDE_SETTINGS_PATH, content, 'utf8'); return { ok: true } }
  catch (e) { return { error: e.message } }
})

// ─── Chat History ─────────────────────────────────────────────────────────────
ipcMain.handle(ch.HISTORY_LIST, (_, projectFilter, offset, limit) => {
  try { return require('./src/session-reader').listSessions(projectFilter, offset, limit) }
  catch (e) { return { error: e.message } }
})
ipcMain.handle(ch.HISTORY_READ, (_, project, sessionId) => {
  try { return require('./src/session-reader').readSession(project, sessionId) }
  catch (e) { return { error: e.message } }
})
ipcMain.handle(ch.HISTORY_SEARCH, (_, query, projectFilter) => {
  try { return require('./src/session-reader').searchSessions(query, projectFilter) }
  catch (e) { return { error: e.message } }
})

// ─── Shell IPC Handlers ──────────────────────────────────────────────────────
ipcMain.handle(ch.SHELL_OPEN_PATH, (_, filePath) => {
  return shell.openPath(filePath)
})
ipcMain.handle(ch.SHELL_OPEN_EXTERNAL, (_, url) => {
  return shell.openExternal(url)
})

// ─── Artifacts IPC Handlers ──────────────────────────────────────────────────
ipcMain.handle(ch.ARTIFACTS_LIST, () => {
  try { return require('./src/vault-reader').parseArtifacts(global.VAULT_PATH) }
  catch (e) { return { artifacts: [], categories: {}, error: e.message } }
})
ipcMain.handle(ch.ARTIFACTS_DETAIL, (_, slug) => {
  try { return require('./src/vault-reader').getArtifactDetail(global.VAULT_PATH, slug) }
  catch (e) { return { error: e.message } }
})
ipcMain.handle(ch.ARTIFACTS_SET_STATUS, (_, slug, status) => {
  try { return require('./src/vault-reader').updateArtifactStatus(global.VAULT_PATH, slug, status) }
  catch (e) { return { error: e.message } }
})

ipcMain.handle(ch.VAULT_BUILD_GRAPH, () => {
  try { return require('./src/vault-scanner').buildGraph(global.VAULT_PATH) }
  catch (e) { return { error: e.message } }
})

ipcMain.handle(ch.VAULT_GRAPH_INVALIDATE, () => {
  try { require('./src/vault-scanner').invalidateCache(); return true }
  catch { return false }
})

/// ─── Astro: daily transits via Python ────────────────────────────────────────

ipcMain.handle(ch.ASTRO_TRANSITS, async () => {
  const config = loadConfig()
  const vaultPath = config?.vaultPath
  if (!vaultPath) return null
  const script = require('path').join(vaultPath, 'tools', 'astro', 'daily_transits.py')
  return new Promise(resolve => {
    require('child_process').execFile('python3', [script], { timeout: 10000 }, (err, stdout) => {
      if (err) { resolve(null); return }
      try { resolve(JSON.parse(stdout)) } catch { resolve(null) }
    })
  })
})

// ─── Insight: Deepgram STT + TTS ─────────────────────────────────────────────

ipcMain.handle(ch.INSIGHT_TRANSCRIBE, async (_, audioBuffer) => {
  const config = loadConfig()
  const apiKey = config?.deepgramApiKey
  if (!apiKey) return { error: 'Deepgram API key not configured' }
  try {
    const response = await fetch('https://api.deepgram.com/v1/listen?model=nova-2&language=en&smart_format=true', {
      method: 'POST',
      headers: { 'Authorization': `Token ${apiKey}`, 'Content-Type': 'audio/webm' },
      body: Buffer.from(audioBuffer),
    })
    const data = await response.json()
    const text = data.results?.channels?.[0]?.alternatives?.[0]?.transcript || ''
    return { text }
  } catch (e) {
    return { error: e.message }
  }
})

ipcMain.handle(ch.INSIGHT_SPEAK, async (_, text) => {
  const config = loadConfig()
  const apiKey = config?.deepgramApiKey
  if (!apiKey) return { error: 'Deepgram API key not configured' }
  try {
    const response = await fetch('https://api.deepgram.com/v1/speak?model=aura-2-athena-en', {
      method: 'POST',
      headers: { 'Authorization': `Token ${apiKey}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ text }),
    })
    const arrayBuffer = await response.arrayBuffer()
    return { audio: Array.from(new Uint8Array(arrayBuffer)) }
  } catch (e) {
    return { error: e.message }
  }
})
