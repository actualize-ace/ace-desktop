# Knowledge Graph View Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Add an interactive D3.js force-directed knowledge graph view to ACE Desktop that renders vault files as nodes and wikilinks as edges, with hover-to-highlight and click-to-open-in-vault interactions.

**Architecture:** A new `vault-scanner.js` in the main process recursively walks all `.md` files and extracts `[[wikilinks]]` to build a `{ nodes, edges }` graph payload. This is sent to the renderer via a new `VAULT_BUILD_GRAPH` IPC channel. The renderer uses D3.js force simulation on an SVG element with `d3.zoom` for pan/zoom. Result is cached in main process memory; rebuilt on user-triggered Refresh.

**Tech Stack:** D3.js v7 (force simulation + zoom + SVG), Electron IPC (existing pattern), Node.js `fs.readdirSync` recursive walk.

**Design doc:** `docs/plans/2026-03-17-vault-graph-design.md`

---

### Task 1: Install D3

**Files:**
- Modify: `package.json`

**Step 1: Install**

```bash
cd ~/Documents/ace-os/ace-desktop
npm install d3
```

**Step 2: Verify**

```bash
ls node_modules/d3/dist/d3.node.js
```

Expected: file exists.

**Step 3: Commit**

```bash
git add package.json package-lock.json
git commit -m "feat(graph): add d3 dependency"
```

---

### Task 2: Add IPC channel constant

**Files:**
- Modify: `src/ipc-channels.js`

**Step 1: Add constant**

Open `src/ipc-channels.js`. After the `VAULT_READ_FILE` line, add:

```js
  VAULT_BUILD_GRAPH: 'vault-build-graph',
```

**Step 2: Verify**

```bash
node -e "const ch = require('./src/ipc-channels'); console.log(ch.VAULT_BUILD_GRAPH)"
```

Expected output: `vault-build-graph`

**Step 3: Commit**

```bash
git add src/ipc-channels.js
git commit -m "feat(graph): add VAULT_BUILD_GRAPH IPC channel"
```

---

### Task 3: Write vault-scanner.js

**Files:**
- Create: `src/vault-scanner.js`

**Step 1: Write the module**

```js
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
```

**Step 2: Smoke test**

```bash
node -e "
const s = require('./src/vault-scanner');
const r = s.buildGraph('/Users/nikhilkale/Documents/Actualize');
console.log('nodes:', r.nodes.length, 'edges:', r.edges.length);
"
```

Expected: `nodes: <N> edges: <E>` — both non-zero, no crash.

**Step 3: Commit**

```bash
git add src/vault-scanner.js
git commit -m "feat(graph): add vault-scanner with wikilink extraction"
```

---

### Task 4: Register IPC handler in main.js

**Files:**
- Modify: `main.js`

**Step 1: Add handler**

In `main.js`, after the `VAULT_READ_FILE` handler block (around line 170), add:

```js
ipcMain.handle(ch.VAULT_BUILD_GRAPH, () => {
  try { return require('./src/vault-scanner').buildGraph(global.VAULT_PATH) }
  catch (e) { return { error: e.message } }
})
```

Also add a handler for cache invalidation on refresh (called from renderer):
Add to `ipc-channels.js` after `VAULT_BUILD_GRAPH`:
```js
  VAULT_GRAPH_INVALIDATE: 'vault-graph-invalidate',
```

And in `main.js`:
```js
ipcMain.handle(ch.VAULT_GRAPH_INVALIDATE, () => {
  try { require('./src/vault-scanner').invalidateCache(); return true }
  catch { return false }
})
```

**Step 2: Verify (after app launches)**

App should launch without errors. Check DevTools console — no new errors on startup.

**Step 3: Commit**

```bash
git add main.js src/ipc-channels.js
git commit -m "feat(graph): register vault-build-graph IPC handler"
```

---

### Task 5: Expose in preload.js

**Files:**
- Modify: `preload.js`

**Step 1: Add to vault namespace**

In `preload.js`, inside the `vault:` object, after `readFile`, add:

```js
    buildGraph:   ()  => ipcRenderer.invoke(ch.VAULT_BUILD_GRAPH),
    invalidateGraph: () => ipcRenderer.invoke(ch.VAULT_GRAPH_INVALIDATE),
```

**Step 2: Verify**

Launch app. In DevTools console:
```js
typeof window.ace.vault.buildGraph   // "function"
typeof window.ace.vault.invalidateGraph  // "function"
```

**Step 3: Commit**

```bash
git add preload.js
git commit -m "feat(graph): expose buildGraph and invalidateGraph in preload"
```

---

### Task 6: Add Graph nav item + view skeleton in index.html

**Files:**
- Modify: `renderer/index.html`

**Step 1: Add nav item**

In the sidebar nav section, after the `◈ Vault` nav item, add:

```html
<div class="nav-item" data-view="graph"><span class="nav-icon">◉</span> Graph</div>
```

**Step 2: Add view div**

After the closing `</div>` of `view-vault`, before `view-pipeline`, add:

```html
<!-- GRAPH VIEW -->
<div class="view" id="view-graph">
  <div class="view-header">
    <div class="view-title">Graph</div>
    <div class="view-actions">
      <button class="vbtn" id="graph-refresh-btn">Refresh</button>
    </div>
  </div>
  <div class="graph-body" id="graph-body">
    <div class="vault-empty" id="graph-empty">Loading graph…</div>
  </div>
</div>
```

**Step 3: Add graph CSS**

In the `<style>` block, after `.wikilink` styles:

```css
/* ── GRAPH VIEW ── */
.graph-body {
  flex: 1; overflow: hidden; position: relative;
  background: var(--bg-deep);
}
.graph-body svg {
  width: 100%; height: 100%;
  cursor: grab;
}
.graph-body svg:active { cursor: grabbing; }
.graph-node { cursor: pointer; transition: r 0.15s; }
.graph-label {
  font-family: 'JetBrains Mono', monospace; font-size: 9px;
  fill: var(--text-secondary); pointer-events: none;
  opacity: 0; transition: opacity 0.1s;
}
```

**Step 4: Verify**

Launch app. `◉ Graph` should appear in sidebar. Clicking it shows the view with "Loading graph…" placeholder.

**Step 5: Commit**

```bash
git add renderer/index.html
git commit -m "feat(graph): add Graph nav item and view skeleton"
```

---

### Task 7: Add D3 script tag

**Files:**
- Modify: `renderer/index.html`

**Step 1: Add script tag**

After the DOMPurify script tag, before the xterm script tag, add:

```html
<script src="../node_modules/d3/dist/d3.min.js"></script>
```

**Step 2: Verify**

Launch app. In DevTools console: `typeof d3` → `"object"`, `typeof d3.forceSimulation` → `"function"`.

**Step 3: Commit**

```bash
git add renderer/index.html
git commit -m "feat(graph): load D3 in renderer"
```

---

### Task 8: Add graph initialization JS

**Files:**
- Modify: `renderer/index.html` (script block)

**Step 1: Add nav handler hook**

In the nav click handler, after the `else if (view === 'vault' ...)` line, add:

```js
else if (view === 'graph' && !graphInitialized) initGraph()
```

**Step 2: Add graph JS**

At the end of the `<script>` block (before `</script>`), add:

```js
// ─── Graph View ───────────────────────────────────────────────────────────────
let graphInitialized = false
let graphSimulation  = null

async function initGraph() {
  graphInitialized = true
  await renderGraph()
}

async function renderGraph() {
  const emptyEl = document.getElementById('graph-empty')
  const bodyEl  = document.getElementById('graph-body')

  if (emptyEl) emptyEl.style.display = 'flex'

  // Remove old SVG if refreshing
  bodyEl.querySelectorAll('svg').forEach(el => el.remove())
  if (graphSimulation) { graphSimulation.stop(); graphSimulation = null }

  const data = await window.ace.vault.buildGraph()
  if (!data || data.error || !data.nodes) {
    if (emptyEl) emptyEl.textContent = 'Graph unavailable'
    return
  }
  if (emptyEl) emptyEl.style.display = 'none'

  const W = bodyEl.clientWidth
  const H = bodyEl.clientHeight

  // Color fn
  const GROUP_COLORS = {
    '00-System':  '#74a4c4',
    '01-Journal': '#d4a574',
    '04-Network': '#6db88f',
    'Domains':    '#9b74c4',
  }
  const nodeColor = d => GROUP_COLORS[d.group] || '#5a5248'

  // Degree map for radius scaling
  const degree = {}
  data.nodes.forEach(n => { degree[n.id] = 0 })
  data.edges.forEach(e => {
    degree[e.source] = (degree[e.source] || 0) + 1
    degree[e.target] = (degree[e.target] || 0) + 1
  })
  const nodeRadius = d => {
    const deg = degree[d.id] || 0
    if (deg === 0) return 3
    if (deg > 5)   return 8
    return 5
  }

  // Build D3 copies (simulation mutates objects)
  const nodes = data.nodes.map(d => ({ ...d }))
  const edges = data.edges.map(e => ({ ...e }))

  // SVG
  const svg = d3.select('#graph-body').append('svg')
    .attr('width', W).attr('height', H)

  const container = svg.append('g')

  svg.call(d3.zoom()
    .scaleExtent([0.1, 4])
    .on('zoom', e => container.attr('transform', e.transform))
  )

  // Draw edges
  const link = container.append('g').attr('class', 'links')
    .selectAll('line')
    .data(edges).join('line')
    .attr('stroke', 'rgba(212,165,116,0.12)')
    .attr('stroke-width', 1)

  // Draw nodes
  const node = container.append('g').attr('class', 'nodes')
    .selectAll('g')
    .data(nodes).join('g')
    .attr('class', 'graph-node')
    .call(d3.drag()
      .on('start', (event, d) => {
        if (!event.active) graphSimulation.alphaTarget(0.3).restart()
        d.fx = d.x; d.fy = d.y
      })
      .on('drag', (event, d) => { d.fx = event.x; d.fy = event.y })
      .on('end', (event, d) => {
        if (!event.active) graphSimulation.alphaTarget(0)
        d.fx = null; d.fy = null
      })
    )

  node.append('circle')
    .attr('r', nodeRadius)
    .attr('fill', nodeColor)
    .attr('fill-opacity', 0.85)
    .attr('stroke', d => nodeColor(d))
    .attr('stroke-width', 1)
    .attr('stroke-opacity', 0.4)

  node.append('text')
    .attr('class', 'graph-label')
    .attr('dy', d => -(nodeRadius(d) + 3))
    .attr('text-anchor', 'middle')
    .text(d => d.label)

  // Hover interactions
  const allNodes = node
  const allLinks = link

  node.on('mouseenter', (event, d) => {
    const neighborIds = new Set([d.id])
    edges.forEach(e => {
      if (e.source.id === d.id || e.source === d.id) neighborIds.add(e.target.id || e.target)
      if (e.target.id === d.id || e.target === d.id) neighborIds.add(e.source.id || e.source)
    })

    allNodes.selectAll('circle').attr('fill-opacity', n => neighborIds.has(n.id) ? 1.0 : 0.08)
    allNodes.selectAll('text').style('opacity', n => n.id === d.id ? 1 : 0)
    allLinks
      .attr('stroke', e => {
        const src = e.source.id || e.source
        const tgt = e.target.id || e.target
        return (src === d.id || tgt === d.id) ? '#d4a574' : 'rgba(212,165,116,0.04)'
      })
      .attr('stroke-width', e => {
        const src = e.source.id || e.source
        const tgt = e.target.id || e.target
        return (src === d.id || tgt === d.id) ? 1.5 : 0.5
      })
  })

  node.on('mouseleave', () => {
    allNodes.selectAll('circle').attr('fill-opacity', 0.85)
    allNodes.selectAll('text').style('opacity', 0)
    allLinks.attr('stroke', 'rgba(212,165,116,0.12)').attr('stroke-width', 1)
  })

  // Click → open in Vault view
  node.on('click', (event, d) => {
    event.stopPropagation()
    // Pulse animation
    d3.select(event.currentTarget).select('circle')
      .transition().duration(120).attr('r', nodeRadius(d) * 1.8)
      .transition().duration(120).attr('r', nodeRadius(d))

    // Switch to vault view and open file
    document.querySelector('.nav-item[data-view="vault"]').click()
    setTimeout(() => {
      if (!vaultInitialized) {
        initVault().then(() => openVaultFile(d.path, d.label + '.md'))
      } else {
        openVaultFile(d.path, d.label + '.md')
        // Highlight matching tree item
        document.querySelectorAll('#vault-tree .tree-item').forEach(el => {
          if (el.querySelector('.tree-name')?.textContent === d.label) {
            el.classList.add('active')
            el.scrollIntoView({ block: 'nearest' })
          }
        })
      }
    }, 80)
  })

  // Background click — clear selection
  svg.on('click', () => {
    allNodes.selectAll('circle').attr('fill-opacity', 0.85)
    allNodes.selectAll('text').style('opacity', 0)
    allLinks.attr('stroke', 'rgba(212,165,116,0.12)').attr('stroke-width', 1)
  })

  // Force simulation
  graphSimulation = d3.forceSimulation(nodes)
    .force('link',   d3.forceLink(edges).id(d => d.id).distance(60).strength(0.5))
    .force('charge', d3.forceManyBody().strength(-120))
    .force('center', d3.forceCenter(W / 2, H / 2))
    .force('collide', d3.forceCollide(10))
    .on('tick', () => {
      link
        .attr('x1', d => d.source.x).attr('y1', d => d.source.y)
        .attr('x2', d => d.target.x).attr('y2', d => d.target.y)
      node.attr('transform', d => `translate(${d.x},${d.y})`)
    })
}

document.getElementById('graph-refresh-btn').addEventListener('click', async () => {
  await window.ace.vault.invalidateGraph()
  renderGraph()
})
```

**Step 3: Verify in running app**

- Launch app
- Click `◉ Graph` in sidebar
- Graph should render with colored nodes and edges after ~1s
- Hover a node → neighbors highlight, rest dim, label appears
- Click a node → switches to Vault view, opens file
- Drag nodes freely
- Scroll to zoom, drag background to pan
- Refresh button → rebuilds graph

**Step 4: Commit**

```bash
git add renderer/index.html
git commit -m "feat(graph): implement D3 force-directed knowledge graph with hover + click interactions"
```

---

### Task 9: Final cleanup + full integration test

**Step 1: Smoke test checklist**

- [ ] App launches without console errors
- [ ] Sidebar shows: Home / ACE Terminal / Vault / Graph / Pipeline
- [ ] Graph nav loads graph correctly on first click
- [ ] Node colors match folder groups (blue-grey for 00-System, gold for 01-Journal, etc.)
- [ ] Hover highlights neighborhood correctly
- [ ] Click on a node opens the correct file in Vault view
- [ ] Vault view file tree still works (tree expansion, file render)
- [ ] Refresh button clears cache and rebuilds
- [ ] Light mode toggle — check graph is readable in both themes
- [ ] No memory leak: switch views repeatedly, check DevTools Memory tab stays stable

**Step 2: Final commit**

```bash
git add -A
git commit -m "feat(graph): Phase 3b complete — knowledge graph view with D3 force simulation"
git push origin feature/ace-desktop
```
