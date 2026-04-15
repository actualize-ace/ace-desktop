'use strict'

const fs = require('fs')
const path = require('path')
const { execSync } = require('child_process')
const ch = require('./ipc-channels')
const { checkVaultHealth } = require('./vault-health')

/**
 * Verify Claude binary: exists, executable, responds to --version.
 */
function checkBinary(binaryPath) {
  if (!binaryPath || !fs.existsSync(binaryPath)) {
    return { ok: false, error: 'missing', path: binaryPath }
  }

  try {
    fs.accessSync(binaryPath, fs.constants.X_OK)
  } catch {
    return { ok: false, error: 'not-executable', path: binaryPath }
  }

  const home = require('os').homedir()
  const augmentedPath = process.platform === 'win32'
    ? [
        path.join(process.env.APPDATA || '', 'npm'),
        path.join(process.env.LOCALAPPDATA || '', 'Programs', 'nodejs'),
        process.env.PATH || '',
      ].filter(Boolean).join(';')
    : [
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

  try {
    const version = execSync(`"${binaryPath}" --version`, {
      encoding: 'utf8',
      timeout: 5000,
      env: { ...process.env, PATH: augmentedPath },
    }).trim()
    return { ok: true, path: binaryPath, version }
  } catch {
    return { ok: false, error: 'not-responding', path: binaryPath }
  }
}

/**
 * Check vault structure, split missing items into critical (tier === 'engine') vs non-critical.
 */
function checkVault(vaultPath) {
  if (!vaultPath || !fs.existsSync(vaultPath)) {
    return { ok: false, error: 'missing', score: 0, critical: [], other: [] }
  }

  const health = checkVaultHealth(vaultPath)
  if (health.error) {
    return { ok: false, error: health.error, score: 0, critical: [], other: [] }
  }

  const critical = health.missing.filter(m => m.tier === 'engine')
  const other = health.missing.filter(m => m.tier !== 'engine')

  return { ok: health.ok, score: health.score, critical, other }
}

/**
 * Run all pre-flight checks and send results to renderer via IPC.
 * Uses setImmediate so window paint isn't blocked.
 */
function run(win, binaryPath, vaultPath) {
  setImmediate(() => {
    const binary = checkBinary(binaryPath)
    const vault = checkVault(vaultPath)

    if (!win.isDestroyed()) {
      win.webContents.send(ch.PREFLIGHT_RESULT, { binary, vault })
    }
  })
}

module.exports = { checkBinary, checkVault, run }
