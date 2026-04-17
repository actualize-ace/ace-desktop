const { app, BrowserWindow, ipcMain, dialog, shell, session } = require('electron')
const path = require('path')
const fs = require('fs')
const { execSync, spawn } = require('child_process')
const ch = require('./src/ipc-channels')
const mcpAuth = require('./src/mcp-auth')

// ─── Process Cleanup ─────────────────────────────────────────────────────────

function killAllChildren() {
  try { require('./src/pty-manager').killAll() } catch {}
  try { require('./src/chat-manager').cancelAll() } catch {}
}

// ─── Global Error Handlers ───────────────────────────────────────────────────

process.on('uncaughtException', (err) => {
  console.error('[main] uncaughtException:', err)
  killAllChildren()
})

process.on('unhandledRejection', (reason) => {
  console.error('[main] unhandledRejection:', reason)
  killAllChildren()
})

// ─── Signal & Exit Handlers ──────────────────────────────────────────────────

process.on('SIGINT', () => {
  killAllChildren()
  app.quit()
})

process.on('SIGTERM', () => {
  killAllChildren()
  app.quit()
})

process.on('exit', () => {
  killAllChildren()
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

// Platform-specific known install paths. GUI-launched Electron apps inherit
// a minimal PATH that excludes user binary dirs (Homebrew on macOS, %APPDATA%
// installs on Windows), so `which`/`where.exe` lookup can fail in packaged
// builds that work fine in `npm start` dev mode. Always try PATH first, fall
// back to these.
const MACOS_CLAUDE_PATHS = [
  '/Users/' + require('os').userInfo().username + '/.local/bin/claude',
  '/usr/local/bin/claude',
  '/opt/homebrew/bin/claude',
]
const WINDOWS_CLAUDE_PATHS = [
  path.join(process.env.LOCALAPPDATA || '', 'Programs', 'claude', 'claude.exe'),
  path.join(process.env.APPDATA || '', 'npm', 'claude.cmd'),
  path.join(process.env.APPDATA || '', 'npm', 'claude.ps1'),
]
const LINUX_CLAUDE_PATHS = [
  path.join(require('os').homedir(), '.local', 'bin', 'claude'),
  '/usr/local/bin/claude',
  '/usr/bin/claude',
  '/snap/bin/claude',
]
const KNOWN_PATHS =
  process.platform === 'win32' ? WINDOWS_CLAUDE_PATHS :
  process.platform === 'darwin' ? MACOS_CLAUDE_PATHS :
  LINUX_CLAUDE_PATHS

// `which` is a POSIX tool; `where.exe` is the Windows equivalent. Windows
// output can list multiple matches across lines — take the first.
const WHICH_CMD = process.platform === 'win32' ? 'where.exe' : 'which'

function detectClaudeBinary() {
  // Augment PATH so packaged Electron (minimal system PATH) can still find
  // Homebrew-installed binaries via `which`.
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
      path.join(home, '.nvm', 'versions', 'node', 'current', 'bin'),
      path.join(home, '.volta', 'bin'),
      path.join(home, '.fnm', 'aliases', 'default', 'bin'),
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
  const augmentedEnv = { ...process.env, PATH: augmentedPath }

  // Try PATH lookup first
  let found = null
  try {
    const result = execSync(`${WHICH_CMD} claude`, { encoding: 'utf8', env: augmentedEnv }).trim().split(/\r?\n/)[0]
    if (result && fs.existsSync(result)) found = result
  } catch {}

  // Try login shell — catches nvm/volta/custom npm prefix paths that only
  // exist in the user's interactive shell environment (zsh/bash profiles).
  if (!found && process.platform !== 'win32') {
    try {
      const shell = process.env.SHELL || '/bin/zsh'
      const result = execSync(`${shell} -l -c 'which claude'`, {
        encoding: 'utf8',
        timeout: 5000,
      }).trim().split(/\r?\n/)[0]
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

  // Verify it actually works
  try {
    const version = execSync(`"${found}" --version`, {
      encoding: 'utf8',
      timeout: 5000,
      env: augmentedEnv,
    }).trim()
    return { path: found, version }
  } catch {
    return { path: found, version: null }
  }
}

// ─── Window ───────────────────────────────────────────────────────────────────

let mainWindow = null

function createWindow(page) {
  mainWindow = new BrowserWindow({
    width: 1400,
    height: 900,
    // hiddenInset is macOS-only — Windows needs 'hidden' for a custom titlebar,
    // otherwise the system chrome stacks over our CSS titlebar.
    titleBarStyle: process.platform === 'win32' ? 'hidden' : 'hiddenInset',
    backgroundColor: '#0a0a0f',
    icon: path.join(__dirname, 'assets',
      process.platform === 'win32' ? 'ace.ico' :
      process.platform === 'darwin' ? 'ace.icns' :
      'ace.png'),
    webPreferences: {
      nodeIntegration: false,
      contextIsolation: true,
      sandbox: false,        // required: preload uses require() for ipc-channels
      preload: path.join(__dirname, 'preload.js'),
    },
  })

  // STRESS=1 env var (dev only) appends ?stress=1 so renderer loads the
  // stress harness module. Never honored in packaged builds.
  const stressOpts = (!app.isPackaged && process.env.STRESS === '1')
    ? { search: 'stress=1' }
    : undefined
  mainWindow.loadFile(path.join(__dirname, 'renderer', page), stressOpts)

  // External links: open in default browser, not inside Electron
  mainWindow.webContents.on('will-navigate', (e, url) => {
    if (url.startsWith('http://') || url.startsWith('https://')) {
      e.preventDefault()
      shell.openExternal(url)
    }
  })
  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    if (url.startsWith('http://') || url.startsWith('https://')) {
      shell.openExternal(url)
    }
    return { action: 'deny' }
  })

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
    // Pre-flight checks — wait for renderer to load before sending IPC
    mainWindow.webContents.once('did-finish-load', () => {
      require('./src/preflight').run(mainWindow, config.claudeBinaryPath, config.vaultPath)
    })
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

app.on('before-quit', (event) => {
  event.preventDefault()
  killAllChildren()
  require('./src/file-watcher').stop().then(() => app.exit(0))
})

// Self-heal runtime globals from on-disk config if they've gone missing.
// Catches any path where CLAUDE_BIN/VAULT_PATH become undefined between
// launch and chat send (partial setup, race conditions, etc.).
function resolveClaudeBin() {
  if (global.CLAUDE_BIN) return global.CLAUDE_BIN
  const config = loadConfig()
  if (config?.claudeBinaryPath) {
    global.CLAUDE_BIN = config.claudeBinaryPath
    return global.CLAUDE_BIN
  }
  return null
}
function resolveVaultPath() {
  if (global.VAULT_PATH) return global.VAULT_PATH
  const config = loadConfig()
  if (config?.vaultPath) {
    global.VAULT_PATH = config.vaultPath
    return global.VAULT_PATH
  }
  return null
}

// ─── PTY IPC Handlers ────────────────────────────────────────────────────────

ipcMain.handle('pty-create', (_, id, cwd, cols, rows) => {
  return require('./src/pty-manager').create(mainWindow, id, cwd || resolveVaultPath(), resolveClaudeBin(), cols, rows)
})

ipcMain.on('pty-write',  (_, id, data)       => require('./src/pty-manager').write(id, data))
ipcMain.on('pty-resize', (_, id, cols, rows) => require('./src/pty-manager').resize(id, cols, rows))
ipcMain.on('pty-kill',   (_, id)             => require('./src/pty-manager').kill(id))
ipcMain.handle(ch.PTY_RESUME, (_, id, cwd, cols, rows, sessionId) => {
  return require('./src/pty-manager').resume(mainWindow, id, cwd || resolveVaultPath(), resolveClaudeBin(), cols, rows, sessionId)
})

// ─── Chat IPC Handlers (stream-json mode) ────────────────────────────────────

ipcMain.handle(ch.CHAT_SEND, (_, chatId, prompt, claudeSessionId, opts) => {
  const config = loadConfig() || {}
  const mergedOpts = { suppressMcp: !!config.suppressMcp, ...opts }
  return require('./src/chat-manager').send(mainWindow, chatId, prompt,
    resolveVaultPath(), resolveClaudeBin(), claudeSessionId, mergedOpts)
})
ipcMain.on(ch.CHAT_CANCEL, (_, chatId) => require('./src/chat-manager').cancel(chatId))
ipcMain.on(ch.CHAT_RESPOND, (_, chatId, text) => require('./src/chat-manager').respond(chatId, text))

// ─── Attachment IPC Handlers ─────────────────────────────────────────────────

ipcMain.handle(ch.ATTACHMENT_PICK, () => {
  return require('./src/attachment-manager').pickFile(mainWindow)
})
ipcMain.handle(ch.ATTACHMENT_SAVE, (_, opts) => {
  return require('./src/attachment-manager').saveFile(resolveVaultPath(), opts)
})

// ─── Setup IPC Handlers ───────────────────────────────────────────────────────

ipcMain.handle(ch.DETECT_BINARY, () => {
  return detectClaudeBinary()
})

// Known binary paths for packaged-app fallback — GUI-launched Electron apps
// inherit a minimal PATH that doesn't include Homebrew or nvm directories.
const MACOS_NODE_PATHS = [
  '/opt/homebrew/bin/node',
  '/usr/local/bin/node',
  '/usr/bin/node',
]
const MACOS_GIT_PATHS = [
  '/opt/homebrew/bin/git',
  '/usr/local/bin/git',
  '/usr/bin/git',
]
const WINDOWS_NODE_PATHS = [
  path.join(process.env.ProgramFiles || 'C:\\Program Files', 'nodejs', 'node.exe'),
  path.join(process.env['ProgramFiles(x86)'] || 'C:\\Program Files (x86)', 'nodejs', 'node.exe'),
  path.join(process.env.APPDATA || '', 'npm', 'node.exe'),
]
const WINDOWS_GIT_PATHS = [
  path.join(process.env.ProgramFiles || 'C:\\Program Files', 'Git', 'bin', 'git.exe'),
  path.join(process.env.ProgramFiles || 'C:\\Program Files', 'Git', 'cmd', 'git.exe'),
  path.join(process.env['ProgramFiles(x86)'] || 'C:\\Program Files (x86)', 'Git', 'bin', 'git.exe'),
]
const LINUX_NODE_PATHS = [
  '/usr/local/bin/node',
  '/usr/bin/node',
  '/snap/bin/node',
  path.join(require('os').homedir(), '.local', 'bin', 'node'),
]
const LINUX_GIT_PATHS = [
  '/usr/local/bin/git',
  '/usr/bin/git',
  '/snap/bin/git',
]
const NODE_PATHS =
  process.platform === 'win32' ? WINDOWS_NODE_PATHS :
  process.platform === 'darwin' ? MACOS_NODE_PATHS :
  LINUX_NODE_PATHS
const GIT_PATHS =
  process.platform === 'win32' ? WINDOWS_GIT_PATHS :
  process.platform === 'darwin' ? MACOS_GIT_PATHS :
  LINUX_GIT_PATHS

function runBinary(bin, args, timeoutMs = 3000) {
  return execSync(`"${bin}" ${args.join(' ')}`, {
    encoding: 'utf8',
    timeout: timeoutMs,
    env: process.env,
  }).trim()
}

function findBinary(name, knownPaths) {
  // Try PATH lookup first (works in dev mode with full shell env).
  // On Windows, `where.exe` may list multiple paths across lines — take the first.
  try {
    const result = execSync(`${WHICH_CMD} ${name}`, { encoding: 'utf8', env: process.env }).trim().split(/\r?\n/)[0]
    if (result && fs.existsSync(result)) return result
  } catch {}
  // Fall back to known install locations (covers packaged-app case)
  for (const p of knownPaths) {
    if (fs.existsSync(p)) return p
  }
  return null
}

// Detect Node.js — parses `node --version`, requires major ≥ 20.
ipcMain.handle(ch.DETECT_NODE, () => {
  const bin = findBinary('node', NODE_PATHS)
  if (!bin) return { ok: false, error: 'not-found' }
  try {
    const raw = runBinary(bin, ['--version'])
    const match = raw.match(/^v(\d+)\.(\d+)\.(\d+)/)
    if (!match) return { ok: false, error: 'unparseable', raw, path: bin }
    const major = parseInt(match[1], 10)
    return { ok: major >= 20, version: raw, major, min: 20, path: bin }
  } catch {
    return { ok: false, error: 'not-responding', path: bin }
  }
})

// Detect Git — any modern version is fine.
ipcMain.handle(ch.DETECT_GIT, () => {
  const bin = findBinary('git', GIT_PATHS)
  if (!bin) return { ok: false, error: 'not-found' }
  try {
    const raw = runBinary(bin, ['--version'])
    const match = raw.match(/git version (\S+)/)
    return { ok: true, version: match ? match[1] : raw, raw, path: bin }
  } catch {
    return { ok: false, error: 'not-responding', path: bin }
  }
})

ipcMain.on(ch.PREFLIGHT_RECHECK_BINARY, () => {
  // Re-detect first — re-running preflight with the same bad path is useless.
  const detected = detectClaudeBinary()
  if (detected?.path) {
    global.CLAUDE_BIN = detected.path
    const current = loadConfig()
    if (current) saveConfig({ ...current, claudeBinaryPath: detected.path })
  }
  require('./src/preflight').run(mainWindow, global.CLAUDE_BIN, global.VAULT_PATH)
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

ipcMain.handle(ch.PICK_BINARY, async () => {
  const result = await dialog.showOpenDialog(mainWindow, {
    properties: ['openFile'],
    message: 'Select the Claude CLI binary',
  })
  if (result.canceled || !result.filePaths.length) return null
  return require('./src/preflight').checkBinary(result.filePaths[0])
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
  const stressOpts = (!app.isPackaged && process.env.STRESS === '1')
    ? { search: 'stress=1' }
    : undefined
  mainWindow.loadFile(path.join(__dirname, 'renderer', 'index.html'), stressOpts)
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
  // Sync runtime globals when critical paths change — otherwise chat/pty
  // keep using the stale path and emit "not found at configured path".
  if ('claudeBinaryPath' in partial) global.CLAUDE_BIN = config.claudeBinaryPath
  if ('vaultPath' in partial) global.VAULT_PATH = config.vaultPath
  return true
})

ipcMain.handle(ch.GET_CONFIG, () => loadConfig())

// ─── Learn / Onboarding IPC Handlers ──────────────────────────────────────────

const DEFAULT_LEARN_STATE = {
  firstRunComplete: false,
  lessonsCompleted: [],
  lastOpenedLesson: null,
  dismissedFirstRun: false,
}

function getLearnState() {
  const config = loadConfig() || {}
  return { ...DEFAULT_LEARN_STATE, ...(config.learn || {}) }
}

function saveLearnState(next) {
  const config = loadConfig() || {}
  config.learn = { ...DEFAULT_LEARN_STATE, ...(config.learn || {}), ...next }
  saveConfig(config)
  return config.learn
}

ipcMain.handle(ch.LEARN_LIST, () => {
  try { return require('./src/learn-reader').listLessons() }
  catch (e) { console.error('[learn] list failed:', e); return [] }
})

ipcMain.handle(ch.LEARN_GET, (_, id) => {
  try { return require('./src/learn-reader').getLesson(id) }
  catch (e) { console.error('[learn] get failed:', e); return null }
})

ipcMain.handle(ch.LEARN_STATE, () => getLearnState())

ipcMain.handle(ch.LEARN_MARK_COMPLETED, (_, lessonId) => {
  const state = getLearnState()
  const completed = new Set(state.lessonsCompleted || [])
  completed.add(lessonId)
  const essentials = require('./src/learn-reader').listLessons()
    .filter(l => l.track === 'essentials')
    .map(l => l.id)
  const firstRunComplete = essentials.every(id => completed.has(id))
  return saveLearnState({
    lessonsCompleted: [...completed],
    lastOpenedLesson: lessonId,
    firstRunComplete,
  })
})

ipcMain.handle(ch.LEARN_DISMISS, () => saveLearnState({ dismissedFirstRun: true }))

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

ipcMain.handle(ch.GET_PATTERNS, () => {
  try { return require('./src/vault-reader').parsePatterns(global.VAULT_PATH) }
  catch (e) { return { counts: [], tensions: [], coOccurrences: [], descriptions: {}, error: e.message } }
})

ipcMain.handle(ch.GET_USAGE, () => {
  try { return require('./src/usage-probe').probe() }
  catch (e) { return { session: null, weekly: null, error: e.message } }
})

// ─── Cockpit ───────────────────────────────────────────────────────────────
ipcMain.handle(ch.GET_NORTHSTAR, () => {
  try {
    const reader = require('./src/vault-reader')
    return reader.parseDCAFrontmatter(global.VAULT_PATH)
  } catch (e) { return { error: e.message } }
})

ipcMain.handle(ch.GET_DAILY_FOCUS, () => {
  try {
    return require('./src/vault-reader').parseDailyFocus(global.VAULT_PATH)
  } catch (e) { return [] }
})

ipcMain.handle(ch.GET_BUILD_BLOCKS, () => {
  try {
    return require('./src/vault-reader').parseBuildBlocks(global.VAULT_PATH)
  } catch (e) { return [] }
})

ipcMain.handle(ch.GET_COMPASS, () => {
  try {
    const reader = require('./src/vault-reader')
    const synth = require('./src/synthesizer')
    const dca = reader.parseDCAFrontmatter(global.VAULT_PATH)
    return synth.computeCompassDirection(global.VAULT_PATH, dca.compass_directions)
  } catch (e) { return { direction: null, strength: 0, error: e.message } }
})

ipcMain.handle(ch.GET_LAST_PULSE, () => {
  try {
    return require('./src/vault-reader').parseLastPulse(global.VAULT_PATH)
  } catch (e) { return { timestamp: null, hoursAgo: null, error: e.message } }
})

ipcMain.handle(ch.GET_RITUAL_STREAK, () => {
  try {
    return require('./src/vault-reader').parseRitualStreak(global.VAULT_PATH)
  } catch (e) { return { streak: 0, todayActive: false, todayPending: false, last7: [], error: e.message } }
})

ipcMain.handle(ch.GET_CADENCE, () => {
  try {
    return require('./src/vault-reader').parseCadence(global.VAULT_PATH)
  } catch (e) { return { weeklyDays: null, weeklyDate: null, monthlyDays: null, monthlyDate: null, error: e.message } }
})

ipcMain.handle(ch.MARK_DONE, (_, item) => {
  // item: { type, label, _raw: {...} }
  try {
    const writer = require('./src/vault-writer')
    if (item.type === 'outcome') {
      return writer.markOutcomeComplete(global.VAULT_PATH, item._raw?.title || item.label)
    }
    if (item.type === 'target') {
      return writer.toggleWeeklyTarget(global.VAULT_PATH, item._raw?.text || item.label, true)
    }
    if (item.type === 'followup') {
      return writer.updateFollowUp(
        global.VAULT_PATH,
        item._raw?.person,
        item._raw?.topic,
        { status: 'Done' }
      )
    }
    return { error: `Mark-done not supported for type: ${item.type}` }
  } catch (e) { return { error: e.message } }
})

ipcMain.handle(ch.SNOOZE_ITEM, (_, item, days) => {
  try {
    const writer = require('./src/vault-writer')
    if (item.type === 'followup') {
      const newDate = new Date()
      newDate.setDate(newDate.getDate() + (days || 3))
      const dueStr = newDate.toISOString().slice(0, 10)
      return writer.updateFollowUp(
        global.VAULT_PATH,
        item._raw?.person,
        item._raw?.topic,
        { due: dueStr }
      )
    }
    return { error: `Snooze not supported for type: ${item.type}` }
  } catch (e) { return { error: e.message } }
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
  const voicePath = require('path').join(resolveVaultPath(), '00-System', 'core', 'voice-profile.md')
  try { return await require('./src/synthesizer').getAISynthesis(context, voicePath, resolveClaudeBin()) }
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
  const realTarget = fs.realpathSync(path.resolve(global.VAULT_PATH, targetPath))
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

mcpAuth.registerHandlers(ipcMain, ch)

// ─── Stress Harness IPC (dev only) ───────────────────────────────────────────
// Registered unconditionally but short-circuits in packaged builds so the
// renderer-side probe always has a handler to hit without throwing.
ipcMain.handle(ch.STRESS_APPEND_RESULT, (_, entry) => {
  if (app.isPackaged) return { ok: false, reason: 'disabled in packaged builds' }
  try {
    const line = JSON.stringify(entry) + '\n'
    const target = path.join(__dirname, 'scripts', 'stress-results.jsonl')
    fs.appendFileSync(target, line, 'utf8')
    return { ok: true }
  } catch (e) {
    return { ok: false, error: e.message }
  }
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
  if (!vaultPath) { console.warn('[astro] no vaultPath configured'); return null }
  const script = require('path').join(vaultPath, 'tools', 'astro', 'daily_transits.py')
  const fs = require('fs')
  if (!fs.existsSync(script)) { console.warn('[astro] script missing:', script); return null }
  // Windows ships `python`/`python.exe`, not `python3`. Try the platform-appropriate
  // binary first; fall through to the other on ENOENT so either install works.
  const primary = process.platform === 'win32' ? 'python' : 'python3'
  const secondary = process.platform === 'win32' ? 'python3' : 'python'
  const run = (bin) => new Promise(resolve => {
    require('child_process').execFile(bin, [script], { timeout: 15000 }, (err, stdout, stderr) => {
      if (err) {
        if (err.code === 'ENOENT') { resolve({ retry: true }); return }
        console.warn(`[astro] ${bin} failed:`, err.message)
        if (stderr) console.warn('[astro] stderr:', stderr.slice(0, 500))
        resolve(null); return
      }
      try { resolve(JSON.parse(stdout)) } catch (e) {
        console.warn('[astro] JSON parse failed:', e.message, 'stdout head:', stdout.slice(0, 200))
        resolve(null)
      }
    })
  })
  const first = await run(primary)
  if (first && first.retry) return await run(secondary).then(r => (r && r.retry) ? null : r)
  return first
})

// Natal chart + interpretations live in the user's vault at {vault}/data/.
// Returns null if the file is missing → astro view renders empty state.
function readVaultJson(relPath) {
  const config = loadConfig()
  const vaultPath = config?.vaultPath
  if (!vaultPath) return null
  const fullPath = require('path').join(vaultPath, relPath)
  try {
    const fs = require('fs')
    if (!fs.existsSync(fullPath)) return null
    return JSON.parse(fs.readFileSync(fullPath, 'utf8'))
  } catch { return null }
}

ipcMain.handle(ch.ASTRO_NATAL, async () => readVaultJson('data/natal-chart.json'))
ipcMain.handle(ch.ASTRO_INTERPRETATIONS, async () => readVaultJson('data/interpretations.json'))

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
