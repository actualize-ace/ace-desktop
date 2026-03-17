const fs   = require('fs')
const path = require('path')

// Folders/files to skip during walk
const SKIP = new Set(['.git', '.obsidian', 'node_modules', '.DS_Store', '.claude'])

// Top-level folder → color group
const GROUP_COLORS = {
  '00-System':  '#74a4c4',
  '01-Journal': '#d4a574',
  '04-Network': '#6db88f',
  'Domains':    '#9b74c4',
}
const DEFAULT_COLOR = '#5a5248'

function groupColor(group) {
  return GROUP_COLORS[group] || DEFAULT_COLOR
}

// Recursively collect all .md file absolute paths
function collectMdFiles(dir, results = []) {
  let entries
  try { entries = fs.readdirSync(dir, { withFileTypes: true }) } catch { return results }
  for (const e of entries) {
    if (e.name.startsWith('.') || SKIP.has(e.name)) continue
    const full = path.join(dir, e.name)
    if (e.isDirectory()) collectMdFiles(full, results)
    else if (e.name.endsWith('.md')) results.push(full)
  }
  return results
}

// Extract [[wikilink]] targets from markdown text
const WIKILINK_RE = /\[\[([^\]|#\n]+?)(?:\|[^\]\n]+?)?\]\]/g
function extractLinks(text) {
  const links = []
  for (const m of text.matchAll(WIKILINK_RE)) links.push(m[1].trim())
  return links
}

// Cache
let cache = null

function buildGraph(vaultPath) {
  if (cache) return cache

  const allFiles = collectMdFiles(vaultPath)

  // Build id map: filename-without-ext → relative path (last one wins for duplicates)
  const nameToId = {}
  const nodes = []

  for (const absPath of allFiles) {
    const rel   = path.relative(vaultPath, absPath)
    const parts = rel.split(path.sep)
    const group = parts[0]
    const label = path.basename(absPath, '.md')

    nodes.push({ id: rel, label, path: absPath, group, color: groupColor(group) })
    nameToId[label.toLowerCase()] = rel
  }

  // Build edges
  const idSet = new Set(nodes.map(n => n.id))
  const edgeSet = new Set()
  const edges = []

  for (const absPath of allFiles) {
    const sourceId = path.relative(vaultPath, absPath)
    let text
    try { text = fs.readFileSync(absPath, 'utf8') } catch { continue }

    for (const target of extractLinks(text)) {
      // Try exact relative path match first, then filename match
      const targetId = idSet.has(target + '.md')
        ? target + '.md'
        : idSet.has(target)
          ? target
          : nameToId[target.toLowerCase()]

      if (!targetId || targetId === sourceId) continue

      const key = `${sourceId}|||${targetId}`
      if (!edgeSet.has(key)) {
        edgeSet.add(key)
        edges.push({ source: sourceId, target: targetId })
      }
    }
  }

  cache = { nodes, edges }
  return cache
}

function invalidateCache() { cache = null }

module.exports = { buildGraph, invalidateCache }
