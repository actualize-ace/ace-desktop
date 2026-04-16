const { dialog } = require('electron')
const path = require('path')
const fs = require('fs')

const ALLOWED_EXTS = new Set([
  'png', 'jpg', 'jpeg', 'gif', 'webp',
  'pdf',
  'txt', 'md'
])

const MAX_SIZE = 25 * 1024 * 1024  // 25 MB

function sanitizeName(name) {
  const ext = path.extname(name)
  const base = path.basename(name, ext)
  const clean = base.replace(/\s+/g, '-').replace(/[^a-zA-Z0-9\-_]/g, '')
  return (clean || 'file') + ext.toLowerCase()
}

function destDir(vaultPath) {
  const now = new Date()
  const dateStr = now.toISOString().slice(0, 10)
  return path.join(vaultPath, '00-System', 'chat-attachments', dateStr)
}

function timePrefix() {
  const now = new Date()
  return String(now.getHours()).padStart(2, '0')
       + String(now.getMinutes()).padStart(2, '0')
       + String(now.getSeconds()).padStart(2, '0')
}

function ensureGitignore(vaultPath) {
  const gi = path.join(vaultPath, '.gitignore')
  if (!fs.existsSync(gi)) return
  const content = fs.readFileSync(gi, 'utf8')
  if (content.includes('00-System/chat-attachments')) return
  fs.appendFileSync(gi, '\n# ACE chat attachments\n00-System/chat-attachments/\n')
}

async function pickFile(win) {
  const result = await dialog.showOpenDialog(win, {
    properties: ['openFile', 'multiSelections'],
    filters: [
      { name: 'All Supported', extensions: ['png', 'jpg', 'jpeg', 'gif', 'webp', 'pdf', 'txt', 'md'] },
      { name: 'Images', extensions: ['png', 'jpg', 'jpeg', 'gif', 'webp'] },
      { name: 'Documents', extensions: ['pdf'] },
      { name: 'Text', extensions: ['txt', 'md'] },
    ],
  })
  if (result.canceled || !result.filePaths.length) return []
  return result.filePaths.map(p => ({ sourcePath: p, name: path.basename(p) }))
}

function saveFile(vaultPath, opts) {
  // opts: { sourcePath?, buffer?, name }
  const ext = path.extname(opts.name).replace('.', '').toLowerCase()
  if (!ALLOWED_EXTS.has(ext)) {
    return { error: 'unsupported-type', ext }
  }

  // Size check — path-based reads stat, buffer checks .length
  if (opts.sourcePath) {
    const stat = fs.statSync(opts.sourcePath)
    if (stat.size > MAX_SIZE) return { error: 'too-large', size: stat.size }
  } else if (opts.buffer && opts.buffer.length > MAX_SIZE) {
    return { error: 'too-large', size: opts.buffer.length }
  }

  const dir = destDir(vaultPath)
  fs.mkdirSync(dir, { recursive: true })

  const safeName = timePrefix() + '-' + sanitizeName(opts.name)
  const absPath = path.join(dir, safeName)

  if (opts.sourcePath) {
    fs.copyFileSync(opts.sourcePath, absPath)
  } else if (opts.buffer) {
    fs.writeFileSync(absPath, Buffer.from(opts.buffer))
  } else {
    return { error: 'no-data' }
  }

  const stat = fs.statSync(absPath)
  const relPath = path.relative(vaultPath, absPath)

  // Idempotent .gitignore on first save
  ensureGitignore(vaultPath)

  return { relPath, absPath, name: safeName, size: stat.size }
}

module.exports = { pickFile, saveFile }
