'use strict'

const fs = require('fs')
const path = require('path')

/**
 * Reads vault-manifest.json and checks the vault's structural health.
 * Returns a health report with missing items grouped by tier and page.
 */
function checkVaultHealth(vaultPath) {
  const manifestPath = path.join(vaultPath, 'vault-manifest.json')
  if (!fs.existsSync(manifestPath)) {
    return { ok: false, error: 'no-manifest', missing: [], score: 0 }
  }

  let manifest
  try {
    manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'))
  } catch (e) {
    return { ok: false, error: 'bad-manifest', missing: [], score: 0 }
  }

  const missing = []
  let total = 0
  let found = 0

  // Check engine files
  for (const f of manifest.engine?.files || []) {
    total++
    const full = path.join(vaultPath, f.path)
    if (fs.existsSync(full)) { found++ }
    else { missing.push({ tier: 'engine', type: 'file', path: f.path, page: f.page || null }) }
  }

  // Check engine directories
  for (const d of manifest.engine?.directories || []) {
    total++
    const full = path.join(vaultPath, d)
    if (fs.existsSync(full)) { found++ }
    else { missing.push({ tier: 'engine', type: 'directory', path: d, page: null }) }
  }

  // Check scaffolding files
  for (const f of manifest.scaffolding?.files || []) {
    if (f.optional) continue
    total++
    const full = path.join(vaultPath, f.path)
    if (fs.existsSync(full)) { found++ }
    else { missing.push({ tier: 'scaffolding', type: 'file', path: f.path, page: null, template: f.template || null }) }
  }

  // Check scaffolding directories
  for (const d of manifest.scaffolding?.directories || []) {
    total++
    const full = path.join(vaultPath, d)
    if (fs.existsSync(full)) { found++ }
    else { missing.push({ tier: 'scaffolding', type: 'directory', path: d, page: null }) }
  }

  const score = total > 0 ? Math.round((found / total) * 100) : 0

  return { ok: missing.length === 0, score, total, found, missing, version: manifest.version }
}

/**
 * Scaffolds a single missing item. Creates the file from template or mkdir.
 */
function scaffoldItem(vaultPath, item) {
  const full = path.join(vaultPath, item.path)

  if (item.type === 'directory') {
    fs.mkdirSync(full, { recursive: true })
    return { ok: true, path: item.path }
  }

  // Ensure parent directory exists
  fs.mkdirSync(path.dirname(full), { recursive: true })

  if (item.template === 'empty-header') {
    const name = path.basename(item.path, '.md').replace(/-/g, ' ')
    const title = name.charAt(0).toUpperCase() + name.slice(1)
    fs.writeFileSync(full, `# ${title}\n`, 'utf8')
    return { ok: true, path: item.path }
  }

  // Check for a named template in the manifest
  const manifestPath = path.join(vaultPath, 'vault-manifest.json')
  try {
    const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'))
    // Match template key by filename stem
    const stem = path.basename(item.path, '.md')
    for (const [key, tplPath] of Object.entries(manifest.templates || {})) {
      if (key === stem || key === item.template) {
        const tplFull = path.join(vaultPath, tplPath)
        if (fs.existsSync(tplFull)) {
          fs.copyFileSync(tplFull, full)
          return { ok: true, path: item.path, source: tplPath }
        }
      }
    }
  } catch (_) { /* proceed to fallback */ }

  // Fallback: create empty file with heading
  const name = path.basename(item.path, '.md').replace(/-/g, ' ')
  const title = name.charAt(0).toUpperCase() + name.slice(1)
  fs.writeFileSync(full, `# ${title}\n`, 'utf8')
  return { ok: true, path: item.path }
}

/**
 * Scaffolds all missing items from a health report.
 */
function scaffoldAll(vaultPath, missing) {
  return missing.map(item => scaffoldItem(vaultPath, item))
}

/**
 * Reads the colorMap from the manifest. Returns {} if unavailable.
 */
function getColorMap(vaultPath) {
  const manifestPath = path.join(vaultPath, 'vault-manifest.json')
  try {
    const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'))
    return manifest.colorMap || {}
  } catch (_) { return {} }
}

module.exports = { checkVaultHealth, scaffoldItem, scaffoldAll, getColorMap }
