// MCP auth recovery — filesystem-level token reset for mcp-remote.
// Canonical recovery: delete <hash>_tokens.json + <hash>_code_verifier.txt,
// keep <hash>_client_info.json so dynamic client registration isn't repeated.
// Hash derivation (from mcp-remote 0.1.37 source, getServerUrlHash):
//   MD5(serverUrl + '|' + (authorizeResource || '') + '|' + JSON.stringify(sortedHeaders || {}))

const fs = require('fs')
const path = require('path')
const os = require('os')
const crypto = require('crypto')
const { shell } = require('electron')

const MCP_AUTH_ROOT = path.join(os.homedir(), '.mcp-auth')
const CLAUDE_NEEDS_AUTH_CACHE = path.join(os.homedir(), '.claude', 'mcp-needs-auth-cache.json')

function sortedHeadersJson(headers) {
  if (!headers || typeof headers !== 'object') return '{}'
  const sorted = {}
  for (const k of Object.keys(headers).sort()) sorted[k] = headers[k]
  return JSON.stringify(sorted)
}

function computeHash(serverUrl, resource, headers) {
  const key = `${serverUrl}|${resource || ''}|${sortedHeadersJson(headers)}`
  return crypto.createHash('md5').update(key).digest('hex')
}

// Find all cache directories (one per mcp-remote version installed via npx).
// We clear matching-hash files across all of them — safe, only tokens deleted.
function findCacheDirs() {
  if (!fs.existsSync(MCP_AUTH_ROOT)) return []
  return fs.readdirSync(MCP_AUTH_ROOT)
    .filter(name => name.startsWith('mcp-remote-'))
    .map(name => path.join(MCP_AUTH_ROOT, name))
    .filter(p => fs.statSync(p).isDirectory())
}

// Delete tokens.json + code_verifier.txt for a given server.
// Keep client_info.json (dynamic client registration) + lock.json (ownership).
function clearTokens(serverUrl, resource, headers) {
  const hash = computeHash(serverUrl, resource, headers)
  const deleted = []
  for (const dir of findCacheDirs()) {
    for (const suffix of ['_tokens.json', '_code_verifier.txt']) {
      const p = path.join(dir, hash + suffix)
      if (fs.existsSync(p)) {
        try { fs.unlinkSync(p); deleted.push(p) } catch (err) {
          return { ok: false, error: err.message, deleted }
        }
      }
    }
  }
  return { ok: true, hash, deleted }
}

// Remove a server from Claude CLI's needs-auth cache so next spawn retries.
function bustNeedsAuthCache(serverName) {
  if (!serverName) return { ok: true, busted: false }
  if (!fs.existsSync(CLAUDE_NEEDS_AUTH_CACHE)) return { ok: true, busted: false }
  try {
    const raw = fs.readFileSync(CLAUDE_NEEDS_AUTH_CACHE, 'utf8')
    const data = JSON.parse(raw)
    if (data && typeof data === 'object' && data[serverName]) {
      delete data[serverName]
      fs.writeFileSync(CLAUDE_NEEDS_AUTH_CACHE, JSON.stringify(data, null, 2))
      return { ok: true, busted: true }
    }
    return { ok: true, busted: false }
  } catch (err) {
    // Cache corruption shouldn't block recovery — report but don't fail.
    return { ok: true, busted: false, cacheError: err.message }
  }
}

// IPC handler: shell.openExternal with validation.
// URL must be http(s) — don't let renderer open arbitrary schemes.
async function handleOpenAuthUrl(_evt, url) {
  if (typeof url !== 'string') return { ok: false, error: 'url must be a string' }
  if (!/^https?:\/\//i.test(url)) return { ok: false, error: 'only http(s) URLs allowed' }
  try {
    await shell.openExternal(url)
    return { ok: true }
  } catch (err) {
    return { ok: false, error: err.message }
  }
}

// IPC handler: reset auth for a given MCP server.
// Expects { serverUrl, resource?, headers?, serverName? }
async function handleResetAuth(_evt, payload) {
  const { serverUrl, resource, headers, serverName } = payload || {}
  if (typeof serverUrl !== 'string' || !serverUrl) {
    return { ok: false, error: 'serverUrl required' }
  }
  const result = clearTokens(serverUrl, resource, headers)
  if (!result.ok) return result
  const cache = bustNeedsAuthCache(serverName)
  return { ok: true, hash: result.hash, deleted: result.deleted, cacheBusted: cache.busted }
}

// Read mcpServers from both config locations.
// User-scope: ~/.claude.json (servers added with -s user)
// Project-scope: <vaultPath>/.mcp.json (servers added with -s local / project default)
// ~/.claude/settings.json has NO mcpServers — confirmed by direct inspection.
function readMcpServers(vaultPath) {
  const servers = {}
  // User scope
  const userJson = path.join(os.homedir(), '.claude.json')
  if (fs.existsSync(userJson)) {
    try {
      const d = JSON.parse(fs.readFileSync(userJson, 'utf8'))
      Object.assign(servers, d.mcpServers || {})
    } catch {}
  }
  // Project scope (shadows user-scope entries with same name)
  if (vaultPath) {
    const projectJson = path.join(vaultPath, '.mcp.json')
    if (fs.existsSync(projectJson)) {
      try {
        const d = JSON.parse(fs.readFileSync(projectJson, 'utf8'))
        Object.assign(servers, d.mcpServers || {})
      } catch {}
    }
  }
  return servers
}

// Resolve a server name to its URL.
function resolveServerUrl(name, servers) {
  const cfg = servers[name]
  if (!cfg) return null
  // HTTP/SSE transport: URL is in the `url` field directly
  if (cfg.url) return { serverUrl: cfg.url, headers: cfg.headers || null, resource: null }
  // stdio via mcp-remote: `npx mcp-remote@latest <url> [...]`
  if (cfg.command === 'npx' && Array.isArray(cfg.args)) {
    const urlArg = cfg.args.find(a => /^https?:\/\//.test(a))
    if (urlArg) return { serverUrl: urlArg, headers: cfg.headers || null, resource: null }
  }
  return null
}

// IPC handler: resolve a server name → { serverUrl, headers, resource }
async function handleResolveServer(_evt, { name, vaultPath } = {}) {
  if (!name) return { ok: false, error: 'name required' }
  const servers = readMcpServers(vaultPath)
  const resolved = resolveServerUrl(name, servers)
  if (!resolved) return { ok: false, error: `server "${name}" not found or URL not resolvable` }
  return { ok: true, ...resolved }
}

function registerHandlers(ipcMain, channels) {
  ipcMain.handle(channels.MCP_OPEN_AUTH_URL,  handleOpenAuthUrl)
  ipcMain.handle(channels.MCP_RESET_AUTH,     handleResetAuth)
  ipcMain.handle(channels.MCP_RESOLVE_SERVER, handleResolveServer)
}

module.exports = {
  registerHandlers,
  // Exported for future test harness + Phase 2 health panel
  computeHash,
  clearTokens,
  bustNeedsAuthCache,
  readMcpServers,
  resolveServerUrl,
}
