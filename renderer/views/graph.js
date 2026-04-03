// renderer/views/graph.js
import { state } from '../state.js'
import { escapeHtml } from '../modules/chat-renderer.js'

let graphSimulation = null

async function initGraph() {
  state.graphInitialized = true
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
    '00-System':  '#70b0e0',
    '01-Journal': '#c8a0f0',
    '02-Rituals': '#e0c878',
    '04-Network': '#60d8a8',
    '05-Research':'#e080a0',
    'Domains':    '#8878ff',
  }
  const nodeColor = d => GROUP_COLORS[d.group] || '#606080'

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
    .attr('stroke', 'rgba(136,120,255,0.12)')
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
    .attr('fill-opacity', d => (degree[d.id] || 0) === 0 ? 0.4 : 0.85)
    .attr('stroke', d => nodeColor(d))
    .attr('stroke-width', 1)
    .attr('stroke-opacity', 0.4)

  node.append('text')
    .attr('class', 'graph-label')
    .attr('dy', d => -(nodeRadius(d) + 3))
    .attr('text-anchor', 'middle')
    .text(d => d.label)

  // Hover interactions
  node.on('mouseenter', (event, d) => {
    const neighborIds = new Set([d.id])
    edges.forEach(e => {
      const src = e.source.id || e.source
      const tgt = e.target.id || e.target
      if (src === d.id) neighborIds.add(tgt)
      if (tgt === d.id) neighborIds.add(src)
    })

    node.selectAll('circle').attr('fill-opacity', n => neighborIds.has(n.id) ? 1.0 : 0.08)
    node.selectAll('text').style('opacity', n => n.id === d.id ? 1 : 0)
    link
      .attr('stroke', e => {
        const src = e.source.id || e.source
        const tgt = e.target.id || e.target
        return (src === d.id || tgt === d.id) ? '#8878ff' : 'rgba(136,120,255,0.04)'
      })
      .attr('stroke-width', e => {
        const src = e.source.id || e.source
        const tgt = e.target.id || e.target
        return (src === d.id || tgt === d.id) ? 1.5 : 0.5
      })
  })

  node.on('mouseleave', () => {
    node.selectAll('circle').attr('fill-opacity', n => (degree[n.id] || 0) === 0 ? 0.4 : 0.85)
    node.selectAll('text').style('opacity', 0)
    link.attr('stroke', 'rgba(136,120,255,0.12)').attr('stroke-width', 1)
  })

  // Click → open in Vault view
  node.on('click', (event, d) => {
    event.stopPropagation()
    d3.select(event.currentTarget).select('circle')
      .transition().duration(120).attr('r', nodeRadius(d) * 1.8)
      .transition().duration(120).attr('r', nodeRadius(d))

    document.querySelector('.nav-item[data-view="vault"]').click()
    setTimeout(() => {
      if (!state.vaultInitialized) {
        // Import dynamically or rely on global initVault/openVaultFile
        if (typeof initVault === 'function') {
          initVault().then(() => openVaultFile(d.path, d.label + '.md'))
        }
      } else {
        if (typeof openVaultFile === 'function') openVaultFile(d.path, d.label + '.md')
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
    node.selectAll('circle').attr('fill-opacity', 0.85)
    node.selectAll('text').style('opacity', 0)
    link.attr('stroke', 'rgba(136,120,255,0.12)').attr('stroke-width', 1)
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
  await renderGraph()
})

// Graph "Ask AI" buttons — open Oracle with graph context
document.getElementById('graph-ask-btn').addEventListener('click', () => {
  const overlay = document.getElementById('oracle-overlay')
  const fab = document.getElementById('oracle-fab')
  overlay.classList.add('open')
  fab.classList.add('open')
  // Replace Oracle presets with vault-graph-specific ones
  const presetsEl = document.getElementById('oracle-presets')
  presetsEl.innerHTML = [
    { label: 'Orphan files', query: 'What files in my vault have no wikilink connections? List the orphaned files and suggest which hubs they should connect to.' },
    { label: 'Most connected', query: 'What are the most heavily connected files in my vault? Which files serve as hubs? Are there any that are over-connected (doing too much)?' },
    { label: 'Stale areas', query: 'Which areas of my vault haven\'t been touched recently? Look at the graph structure and identify clusters that might be going stale.' },
    { label: 'Architecture health', query: 'Analyze my vault\'s graph architecture. Is it well-structured? Are there clear hub-and-spoke patterns? Suggest improvements.' },
  ].map(p => `<div class="oracle-preset" data-query="${escapeHtml(p.query)}">${p.label}</div>`).join('')
  // Re-wire preset clicks
  presetsEl.querySelectorAll('.oracle-preset').forEach(p => {
    p.addEventListener('click', () => {
      if (window.sendOracleQuery) window.sendOracleQuery(p.dataset.query)
    })
  })
  setTimeout(() => document.getElementById('oracle-input').focus(), 200)
})

export {
  initGraph,
  renderGraph,
}
