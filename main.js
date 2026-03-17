const { app, BrowserWindow, ipcMain, dialog, shell } = require('electron')
const path = require('path')
const fs = require('fs')
const { execSync, spawn } = require('child_process')
const ch = require('./src/ipc-channels')

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
}

// ─── App Lifecycle ────────────────────────────────────────────────────────────

app.whenReady().then(() => {
  const config = loadConfig()
  const vaultMissing = config && !fs.existsSync(config.vaultPath)

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
})

// ─── PTY IPC Handlers ────────────────────────────────────────────────────────

ipcMain.handle('pty-create', (_, id, cwd, cols, rows) => {
  return require('./src/pty-manager').create(mainWindow, id, cwd || global.VAULT_PATH, global.CLAUDE_BIN, cols, rows)
})

ipcMain.on('pty-write',  (_, id, data)       => require('./src/pty-manager').write(id, data))
ipcMain.on('pty-resize', (_, id, cols, rows) => require('./src/pty-manager').resize(id, cols, rows))
ipcMain.on('pty-kill',   (_, id)             => require('./src/pty-manager').kill(id))

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
  require('./src/file-watcher').start(mainWindow)
  require('./src/db-reader').open(config.vaultPath)
  mainWindow.loadFile(path.join(__dirname, 'renderer', 'index.html'))
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
  try { return require('./src/db-reader').getMetrics() } catch (e) { return { error: e.message } }
})

// ─── Vault IPC Handlers ───────────────────────────────────────────────────────

ipcMain.handle(ch.VAULT_LIST_DIR, (_, dirPath) => {
  try { return require('./src/vault-reader').listDir(dirPath || global.VAULT_PATH) } catch (e) { return { error: e.message } }
})

ipcMain.handle(ch.VAULT_READ_FILE, (_, filePath) => {
  try { return fs.readFileSync(filePath, 'utf8') } catch (e) { return { error: e.message } }
})

ipcMain.handle(ch.VAULT_BUILD_GRAPH, () => {
  try { return require('./src/vault-scanner').buildGraph(global.VAULT_PATH) }
  catch (e) { return { error: e.message } }
})

ipcMain.handle(ch.VAULT_GRAPH_INVALIDATE, () => {
  try { require('./src/vault-scanner').invalidateCache(); return true }
  catch { return false }
})
