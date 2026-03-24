// ─── Canvas I/O — list, read, write .canvas.json files in vault ─────────────
const fs = require('fs')
const path = require('path')

function getCanvasDir (vaultPath) {
  const dir = path.join(vaultPath, '06-Canvas')
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true })
  }
  return dir
}

/**
 * List all .canvas.json files with title + modified date.
 */
function listCanvases (vaultPath) {
  const dir = getCanvasDir(vaultPath)
  const files = fs.readdirSync(dir).filter(f => f.endsWith('.canvas.json'))
  return files.map(f => {
    try {
      const raw = fs.readFileSync(path.join(dir, f), 'utf-8')
      const data = JSON.parse(raw)
      const stat = fs.statSync(path.join(dir, f))
      return {
        filename: f,
        id: data.id || f.replace('.canvas.json', ''),
        title: data.title || 'Untitled',
        modified: data.modified || stat.mtime.toISOString(),
        nodeCount: (data.nodes || []).length,
      }
    } catch {
      return { filename: f, id: f.replace('.canvas.json', ''), title: 'Untitled', modified: '', nodeCount: 0 }
    }
  }).sort((a, b) => (b.modified || '').localeCompare(a.modified || ''))
}

/**
 * Read a canvas file by id.
 */
function readCanvas (vaultPath, canvasId) {
  const dir = getCanvasDir(vaultPath)
  const file = path.join(dir, canvasId + '.canvas.json')
  if (!fs.existsSync(file)) throw new Error('Canvas not found: ' + canvasId)
  return fs.readFileSync(file, 'utf-8')
}

/**
 * Write a canvas file by id.
 */
function writeCanvas (vaultPath, canvasId, content) {
  const dir = getCanvasDir(vaultPath)
  const file = path.join(dir, canvasId + '.canvas.json')
  fs.writeFileSync(file, content, 'utf-8')
  return { ok: true, path: file }
}

module.exports = { listCanvases, readCanvas, writeCanvas }
