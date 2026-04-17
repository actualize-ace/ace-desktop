const fs = require('fs')
const path = require('path')

// Add an allow pattern to .claude/settings.local.json.
// Idempotent; creates the file + permissions.allow array if missing.
function addAllow(vaultPath, pattern) {
  if (!vaultPath || typeof vaultPath !== 'string') {
    return { ok: false, error: 'invalid-vault-path' }
  }
  if (!pattern || typeof pattern !== 'string') {
    return { ok: false, error: 'invalid-pattern' }
  }

  const file = path.join(vaultPath, '.claude', 'settings.local.json')

  let data = {}
  if (fs.existsSync(file)) {
    try {
      data = JSON.parse(fs.readFileSync(file, 'utf8'))
    } catch (e) {
      return { ok: false, error: 'parse-failed', detail: e.message }
    }
  } else {
    fs.mkdirSync(path.dirname(file), { recursive: true })
  }

  if (!data.permissions || typeof data.permissions !== 'object') {
    data.permissions = {}
  }
  if (!Array.isArray(data.permissions.allow)) {
    data.permissions.allow = []
  }

  if (data.permissions.allow.includes(pattern)) {
    return { ok: true, alreadyPresent: true }
  }

  data.permissions.allow.push(pattern)

  try {
    fs.writeFileSync(file, JSON.stringify(data, null, 2) + '\n', 'utf8')
  } catch (e) {
    return { ok: false, error: 'write-failed', detail: e.message }
  }

  return { ok: true, alreadyPresent: false }
}

module.exports = { addAllow }
