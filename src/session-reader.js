// session-reader.js — Reads Claude Code JSONL session files for Chat History view
// Pattern: mirrors usage-probe.js (head-read, stat-based filtering, JSONL parsing)

const fs = require('fs')
const path = require('path')
const os = require('os')

const _metaCache = new Map() // key: `${filePath}:${mtimeMs}` → SessionMeta

function getProjectsDir() {
  return path.join(os.homedir(), '.claude', 'projects')
}

function projectLabel(dirName) {
  // "-Users-nikhilkale-Documents-Actualize" → "Documents/Actualize"
  const segments = dirName.replace(/^-/, '').split('-')
  return segments.slice(-2).join('/')
}

function extractUserText(message) {
  const content = message?.content
  if (typeof content === 'string') return content
  if (Array.isArray(content)) {
    return content
      .filter(b => b.type === 'text')
      .map(b => b.text)
      .join('\n')
  }
  return ''
}

function headRead(filePath, bytes) {
  const fd = fs.openSync(filePath, 'r')
  try {
    const buffer = Buffer.alloc(bytes)
    const bytesRead = fs.readSync(fd, buffer, 0, bytes, 0)
    return buffer.toString('utf8', 0, bytesRead)
  } finally {
    fs.closeSync(fd)
  }
}

function parseMetaFromHead(filePath, stat) {
  const cacheKey = `${filePath}:${stat.mtimeMs}`
  if (_metaCache.has(cacheKey)) return _metaCache.get(cacheKey)

  const meta = {
    id: path.basename(filePath, '.jsonl'),
    project: path.basename(path.dirname(filePath)),
    projectLabel: projectLabel(path.basename(path.dirname(filePath))),
    mtime: stat.mtimeMs,
    size: stat.size,
    title: '',
    slug: '',
    model: '',
    gitBranch: '',
    entrypoint: '',
    tokenCount: 0,
  }

  try {
    const headSize = Math.min(stat.size, 8192)
    const raw = headRead(filePath, headSize)
    const lines = raw.split('\n')

    for (const line of lines) {
      if (!line.trim()) continue
      try {
        const obj = JSON.parse(line)

        if (!meta.slug && obj.slug) meta.slug = obj.slug
        if (!meta.gitBranch && obj.gitBranch) meta.gitBranch = obj.gitBranch
        if (!meta.entrypoint && obj.entrypoint) meta.entrypoint = obj.entrypoint

        if (!meta.title && obj.type === 'user' && obj.message) {
          const text = extractUserText(obj.message)
          if (text) meta.title = text.slice(0, 120).replace(/\n/g, ' ')
        }

        // Also check agent_progress for user prompts (common first record)
        if (!meta.title && obj.type === 'agent_progress' && obj.prompt) {
          meta.title = obj.prompt.slice(0, 120).replace(/\n/g, ' ')
        }

        if (!meta.model && obj.type === 'assistant' && obj.message?.model) {
          meta.model = obj.message.model
        }

        if (obj.type === 'assistant' && obj.message?.usage) {
          meta.tokenCount += (obj.message.usage.output_tokens || 0)
        }
      } catch {}
    }
  } catch {}

  _metaCache.set(cacheKey, meta)
  return meta
}

/**
 * List sessions with pagination and optional project filter.
 * Only stats all files, only head-reads the paginated slice.
 */
function listSessions(projectFilter, offset, limit) {
  offset = offset || 0
  limit = limit || 50
  const projectsDir = getProjectsDir()
  if (!fs.existsSync(projectsDir)) return { sessions: [], projects: [], total: 0 }

  const allFiles = [] // { filePath, stat, project }
  const projects = []

  try {
    const dirs = fs.readdirSync(projectsDir, { withFileTypes: true })
    for (const dir of dirs) {
      if (!dir.isDirectory()) continue
      projects.push(dir.name)

      if (projectFilter && dir.name !== projectFilter) continue

      const projPath = path.join(projectsDir, dir.name)
      let files
      try { files = fs.readdirSync(projPath).filter(f => f.endsWith('.jsonl')) } catch { continue }

      for (const file of files) {
        const filePath = path.join(projPath, file)
        let stat
        try { stat = fs.statSync(filePath) } catch { continue }
        allFiles.push({ filePath, stat, project: dir.name })
      }
    }
  } catch (e) {
    return { sessions: [], projects: [], total: 0, error: e.message }
  }

  // Sort by mtime descending
  allFiles.sort((a, b) => b.stat.mtimeMs - a.stat.mtimeMs)

  const total = allFiles.length
  const slice = allFiles.slice(offset, offset + limit)

  // Only head-read the paginated slice
  const sessions = slice.map(f => parseMetaFromHead(f.filePath, f.stat))

  return { sessions, projects: projects.sort(), total }
}

/**
 * Read full session transcript for detail view.
 */
function readSession(project, sessionId) {
  const projectsDir = getProjectsDir()
  const filePath = path.join(projectsDir, project, sessionId + '.jsonl')

  if (!fs.existsSync(filePath)) return { error: 'Session file not found' }

  const stat = fs.statSync(filePath)
  const messages = []
  const seenUuids = new Set()
  let meta = { model: '', tokens: { input: 0, output: 0 }, slug: '', gitBranch: '', duration: 0 }
  let firstTs = null, lastTs = null

  const raw = fs.readFileSync(filePath, 'utf8')
  const lines = raw.split('\n')
  let msgCount = 0

  for (const line of lines) {
    if (!line.trim()) continue
    if (msgCount >= 2000) break // Cap for very large sessions

    try {
      const obj = JSON.parse(line)

      // Deduplicate
      if (obj.uuid) {
        if (seenUuids.has(obj.uuid)) continue
        seenUuids.add(obj.uuid)
      }

      if (!meta.slug && obj.slug) meta.slug = obj.slug
      if (!meta.gitBranch && obj.gitBranch) meta.gitBranch = obj.gitBranch

      const ts = obj.timestamp ? new Date(obj.timestamp).getTime() : null
      if (ts) {
        if (!firstTs) firstTs = ts
        lastTs = ts
      }

      if (obj.type === 'user' && obj.message?.role === 'user') {
        const text = extractUserText(obj.message)
        // Skip tool_result messages (they're just tool outputs)
        const hasToolResult = Array.isArray(obj.message.content) &&
          obj.message.content.some(b => b.type === 'tool_result')
        if (hasToolResult) continue

        if (text) {
          messages.push({
            role: 'user',
            content: text,
            toolCalls: [],
            timestamp: obj.timestamp || '',
          })
          msgCount++
        }
      }

      if (obj.type === 'assistant' && obj.message?.role === 'assistant') {
        if (!meta.model && obj.message.model) meta.model = obj.message.model

        const usage = obj.message.usage
        if (usage) {
          meta.tokens.input += (usage.input_tokens || 0)
          meta.tokens.output += (usage.output_tokens || 0)
        }

        const content = obj.message.content
        if (!Array.isArray(content)) continue

        let text = ''
        const toolCalls = []

        for (const block of content) {
          if (block.type === 'text') {
            text += (text ? '\n' : '') + block.text
          } else if (block.type === 'tool_use') {
            const inputStr = typeof block.input === 'string'
              ? block.input
              : JSON.stringify(block.input, null, 2)
            toolCalls.push({
              name: block.name,
              input: inputStr.length > 500 ? inputStr.slice(0, 500) + '...' : inputStr,
            })
          }
          // Skip 'thinking' blocks
        }

        if (text || toolCalls.length) {
          messages.push({
            role: 'assistant',
            content: text,
            toolCalls,
            timestamp: obj.timestamp || '',
            model: obj.message.model || '',
          })
          msgCount++
        }
      }
    } catch {}
  }

  if (firstTs && lastTs) meta.duration = lastTs - firstTs

  return { messages, meta }
}

/**
 * Search sessions by title/slug/branch from in-memory cache.
 */
function searchSessions(query, projectFilter) {
  if (!query) return []
  const q = query.toLowerCase()
  const results = []

  for (const [, meta] of _metaCache) {
    if (projectFilter && meta.project !== projectFilter) continue
    if (
      (meta.title && meta.title.toLowerCase().includes(q)) ||
      (meta.slug && meta.slug.toLowerCase().includes(q)) ||
      (meta.gitBranch && meta.gitBranch.toLowerCase().includes(q))
    ) {
      results.push(meta)
      if (results.length >= 100) break
    }
  }

  // Sort by mtime descending
  results.sort((a, b) => b.mtime - a.mtime)
  return results
}

module.exports = { listSessions, readSession, searchSessions }
