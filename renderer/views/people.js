// renderer/views/people.js
import { state } from '../state.js'
import { escapeHtml, processWikilinks, postProcessCodeBlocks, SANITIZE_CONFIG } from '../modules/chat-renderer.js'

let currentPersonName = null
let currentPersonPath = null

async function initPeople() {
  if (state.peopleInitialized) return
  state.peopleInitialized = true
  const listEl = document.getElementById('people-list')

  const [data, followUps] = await Promise.all([
    window.ace.dash.getPeople(),
    window.ace.dash.getFollowUps()
  ])
  state.peopleData = data
  state.peopleFollowUps = Array.isArray(followUps) ? followUps : []

  if (!data || !data.people || data.people.length === 0) {
    listEl.innerHTML = '<div class="vault-empty">No people files yet — create them in 04-Network/people/</div>'
    return
  }

  // Build filter chips — "All" first, then categories
  const filtersEl = document.getElementById('people-filters')
  const totalPeople = data.people.length
  filtersEl.innerHTML =
    `<button class="people-filter-chip active" data-cat="">All <span style="opacity:0.5">${totalPeople}</span></button>` +
    data.categories.map(c =>
      `<button class="people-filter-chip" data-cat="${escapeHtml(c.name)}">${escapeHtml(c.name)} <span style="opacity:0.5">${c.members.length}</span></button>`
    ).join('')
  filtersEl.querySelectorAll('.people-filter-chip').forEach(chip => {
    chip.addEventListener('click', () => {
      const cat = chip.dataset.cat
      filtersEl.querySelectorAll('.people-filter-chip').forEach(c => c.classList.remove('active'))
      chip.classList.add('active')
      state.peopleActiveFilter = cat || null
      applyPeopleFilters()
      // If graph is showing, highlight filtered nodes
      if (state.peopleGraphMode) highlightGraphCategory(state.peopleActiveFilter)
    })
  })

  renderPeopleList(data, state.peopleFollowUps)

  // Default to graph view — graph replaces the profile panel, not the whole body
  state.peopleGraphMode = true
  document.getElementById('people-profile').style.display = 'none'
  document.getElementById('people-graph').style.display = ''
  document.getElementById('people-view-toggle').textContent = 'Profile'
  setTimeout(() => renderPeopleGraph(), 100)
}

function applyPeopleFilters() {
  const search = document.getElementById('people-search').value
  renderPeopleList(state.peopleData, state.peopleFollowUps, search, state.peopleActiveFilter)
}

function renderPeopleList(data, followUps, search, catFilter) {
  const listEl = document.getElementById('people-list')
  const searchLower = (search || '').toLowerCase()

  // Entities section — collapsed by default
  let html = ''
  if (data.entities && data.entities.length > 0 && !catFilter && !searchLower) {
    html += `<div class="people-cat-header people-entities-toggle" style="cursor:pointer;display:flex;align-items:center;gap:4px">
      <span class="people-entities-chevron" style="font-size:8px;transition:transform 0.15s">\u25b8</span>
      Entities <span style="opacity:0.5">${data.entities.length}</span>
    </div>
    <div class="people-entities-list" style="display:none">`
    for (const ent of data.entities) {
      html += `
        <div class="people-item people-entity-item" data-entity="${escapeHtml(ent.id)}" data-entry="${escapeHtml(ent.entryFile || '')}" data-name="${escapeHtml(ent.name)}">
          <div class="people-dot has-fu" style="background:var(--gold);box-shadow:0 0 4px rgba(200,160,240,0.4)"></div>
          <span class="people-name" style="font-weight:500;color:var(--text-primary)">${escapeHtml(ent.name)}</span>
        </div>`
    }
    html += `</div><div style="height:1px;background:var(--border);margin:6px 14px"></div>`
  }

  // Flat list — filter by category if selected, show category tags
  const seen = new Set()
  const filtered = data.people.filter(p => {
    if (searchLower && !p.name.toLowerCase().includes(searchLower)) return false
    if (catFilter && !(p.categories || []).includes(catFilter)) return false
    if (seen.has(p.fileName)) return false
    seen.add(p.fileName)
    return true
  })

  for (const person of filtered) {
    const fuCount = followUps.filter(f =>
      f.person && f.person.toLowerCase().includes(person.name.toLowerCase().split(' ')[0]) &&
      (f.status || '').toLowerCase() !== 'done'
    ).length
    const cats = (person.categories || []).filter(c => c !== 'Other')
    html += `
      <div class="people-item" data-path="${escapeHtml(person.path)}" data-name="${escapeHtml(person.name)}" data-cats="${escapeHtml((person.categories || []).join(','))}">
        <div class="people-dot${fuCount > 0 ? ' has-fu' : ''}"></div>
        <span class="people-name">${escapeHtml(person.name)}</span>
        ${cats.length > 0 ? `<span class="people-cat-tags">${cats.map(c => `<span class="people-cat-tag">${escapeHtml(c.length > 12 ? c.slice(0,10) + '..' : c)}</span>`).join('')}</span>` : ''}
        ${fuCount > 0 ? `<span class="people-fu-count">${fuCount}</span>` : ''}
      </div>`
  }
  listEl.innerHTML = html || '<div class="vault-empty">No matches</div>'

  listEl.querySelectorAll('.people-item').forEach(item => {
    item.addEventListener('click', () => {
      listEl.querySelectorAll('.people-item').forEach(el => el.classList.remove('active'))
      item.classList.add('active')
      // Switch from graph to profile view if needed
      if (state.peopleGraphMode) {
        state.peopleGraphMode = false
        document.getElementById('people-profile').style.display = ''
        document.getElementById('people-graph').style.display = 'none'
        document.getElementById('people-view-toggle').textContent = 'Graph'
        if (state.peopleGraphSim) { state.peopleGraphSim.stop(); state.peopleGraphSim = null }
      }
      openPersonProfile(item.dataset.path, item.dataset.name)
    })
  })

  // Wire entities toggle
  const entToggle = listEl.querySelector('.people-entities-toggle')
  if (entToggle) {
    entToggle.addEventListener('click', () => {
      const list = listEl.querySelector('.people-entities-list')
      const chevron = entToggle.querySelector('.people-entities-chevron')
      if (list && chevron) {
        const open = list.style.display !== 'none'
        list.style.display = open ? 'none' : ''
        chevron.style.transform = open ? '' : 'rotate(90deg)'
      }
    })
  }

  // Wire entity clicks
  listEl.querySelectorAll('.people-entity-item').forEach(item => {
    item.addEventListener('click', () => {
      const entryFile = item.dataset.entry
      if (!entryFile) return
      listEl.querySelectorAll('.people-item').forEach(el => el.classList.remove('active'))
      item.classList.add('active')
      if (state.peopleGraphMode) {
        state.peopleGraphMode = false
        document.getElementById('people-profile').style.display = ''
        document.getElementById('people-graph').style.display = 'none'
        document.getElementById('people-view-toggle').textContent = 'Graph'
        if (state.peopleGraphSim) { state.peopleGraphSim.stop(); state.peopleGraphSim = null }
      }
      openPersonProfile(entryFile, item.dataset.name)
    })
  })
}

async function openPersonProfile(filePath, personName) {
  currentPersonName = personName
  currentPersonPath = filePath
  const profileEl = document.getElementById('people-profile')
  profileEl.innerHTML = '<div class="vault-empty">Loading...</div>'

  const content = await window.ace.vault.readFile(filePath)
  if (!content || (typeof content === 'object' && content.error)) {
    profileEl.innerHTML = '<div class="vault-empty">Error reading file</div>'
    return
  }

  const withLinks = processWikilinks(content)
  const html = marked.parse(withLinks)
  const safe = DOMPurify.sanitize(html, SANITIZE_CONFIG)

  const today = new Date(); today.setHours(0, 0, 0, 0)
  const personFu = (state.peopleFollowUps || []).filter(f =>
    f.person && f.person.toLowerCase().includes(personName.toLowerCase().split(' ')[0]) &&
    (f.status || '').toLowerCase() !== 'done'
  )

  let commitHtml = ''
  if (personFu.length > 0) {
    commitHtml = `
      <div class="people-commitments">
        <div class="section-label">Active Commitments</div>
        ${personFu.map(f => {
          const due = f.due ? new Date(f.due) : null
          if (due) due.setHours(0, 0, 0, 0)
          const overdue = due && due < today
          const dueLabel = due ? due.toLocaleDateString('en-US', { month: 'numeric', day: 'numeric' }) : ''
          return `
            <div class="people-commitment-row" data-prompt="${escapeHtml(`I need to follow up with ${personName}. Topic: ${f.topic || 'general'}. ${overdue ? 'It is overdue.' : ''} Help me plan my approach.`)}">
              <span class="people-commitment-topic">${escapeHtml(f.topic || '')}</span>
              ${dueLabel ? `<span class="people-commitment-due${overdue ? ' overdue' : ''}">${overdue ? '\u26a0 ' : ''}${dueLabel}</span>` : ''}
            </div>`
        }).join('')}
      </div>`
  }

  profileEl.innerHTML = `<div class="md-body">${safe}</div>${commitHtml}`
  postProcessCodeBlocks(profileEl)
  profileEl.scrollTop = 0

  profileEl.querySelectorAll('.people-commitment-row').forEach(row => {
    row.addEventListener('click', () => {
      document.querySelector('.nav-item[data-view="terminal"]').click()
      setTimeout(() => {
        if (window.spawnSession) window.spawnSession()
        setTimeout(() => {
          if (state.activeId && state.sessions) {
            const modelEl = document.getElementById('chat-model-' + state.activeId)
            const permsEl = document.getElementById('chat-perms-' + state.activeId)
            if (modelEl) modelEl.value = 'sonnet'
            if (permsEl) permsEl.value = 'auto'
            const tab = state.sessions[state.activeId]?.tab
            if (tab) {
              const span = tab.querySelector('span:not(.stab-close)')
              if (span) span.textContent = personName
            }
            if (window.sendChatMessage) window.sendChatMessage(state.activeId, row.dataset.prompt)
          }
        }, 200)
      }, 150)
    })
  })
}

// Search filter
document.getElementById('people-search').addEventListener('input', () => applyPeopleFilters())

// Graph toggle
document.getElementById('people-view-toggle').addEventListener('click', () => {
  state.peopleGraphMode = !state.peopleGraphMode
  const profileEl = document.getElementById('people-profile')
  const graphEl = document.getElementById('people-graph')
  const toggleBtn = document.getElementById('people-view-toggle')

  if (state.peopleGraphMode) {
    profileEl.style.display = 'none'
    graphEl.style.display = ''
    toggleBtn.textContent = 'Profile'
    if (!state.peopleGraphSim) renderPeopleGraph()
  } else {
    profileEl.style.display = ''
    graphEl.style.display = 'none'
    toggleBtn.textContent = 'Graph'
    if (state.peopleGraphSim) { state.peopleGraphSim.stop(); state.peopleGraphSim = null }
  }
})

function renderPeopleGraph() {
  if (!state.peopleData || !state.peopleData.people.length) return
  const graphEl = document.getElementById('people-graph')
  const emptyEl = document.getElementById('people-graph-empty')
  graphEl.querySelectorAll('svg').forEach(el => el.remove())
  if (emptyEl) emptyEl.style.display = 'none'

  const W = graphEl.clientWidth
  const H = graphEl.clientHeight

  const CAT_COLORS = {
    'Inner Circle': '#e080a0', 'Collaborators': '#8878ff', 'Clients': '#60d8a8',
    'Professional Services': '#70b0e0', 'Community': '#c8a0f0', 'Strategic Allies': '#e0c878',
    'Mentors / Advisors': '#f0a060', 'Other': '#606080',
  }

  // Hub-and-spoke: You at center, category groups as entity hubs
  // Categories with 3+ members become hub nodes, rest connect directly to You
  const HUB_THRESHOLD = 3
  const hubCategories = state.peopleData.categories.filter(c => c.members.length >= HUB_THRESHOLD)

  const nodes = []
  const edges = []

  // Central node: You
  nodes.push({ id: '_you', name: 'You', nodeType: 'self', color: '#fff', radius: 14 })

  // Category hub nodes (only for categories with enough members)
  const HUB_COLORS = { 'Clients': '#60d8a8', 'Community': '#c8a0f0', 'Collaborators': '#8878ff',
    'Inner Circle': '#e080a0', 'Strategic Allies': '#e0c878' }
  hubCategories.forEach(cat => {
    const hubId = '_hub_' + cat.name.toLowerCase().replace(/\s+/g, '-')
    nodes.push({ id: hubId, name: cat.name, nodeType: 'entity', color: HUB_COLORS[cat.name] || '#8878ff', radius: 10 })
    edges.push({ source: '_you', target: hubId })
  })

  // People nodes
  const hubCatNames = new Set(hubCategories.map(c => c.name))
  state.peopleData.people.forEach(p => {
    const fuCount = (state.peopleFollowUps || []).filter(f =>
      f.person && f.person.toLowerCase().includes(p.name.toLowerCase().split(' ')[0]) &&
      (f.status || '').toLowerCase() !== 'done'
    ).length
    nodes.push({
      id: p.fileName, name: p.name, path: p.path, category: p.category,
      nodeType: 'person', color: CAT_COLORS[p.category] || '#606080',
      radius: fuCount > 0 ? 6 : 4, fuCount,
    })

    // Connect to ALL category hubs this person belongs to, or directly to You
    const personCats = p.categories || [p.category]
    let connectedToHub = false
    for (const cat of personCats) {
      if (hubCatNames.has(cat)) {
        const hubId = '_hub_' + cat.toLowerCase().replace(/\s+/g, '-')
        edges.push({ source: hubId, target: p.fileName })
        connectedToHub = true
      }
    }
    if (!connectedToHub) {
      edges.push({ source: '_you', target: p.fileName })
    }
  })

  const svg = d3.select('#people-graph').append('svg').attr('width', W).attr('height', H)
  const container = svg.append('g')
  svg.call(d3.zoom().scaleExtent([0.2, 4]).on('zoom', e => container.attr('transform', e.transform)))

  const link = container.append('g').selectAll('line').data(edges).join('line')
    .attr('stroke', d => {
      const src = typeof d.source === 'string' ? d.source : d.source.id
      return src === '_you' ? 'rgba(200,180,255,0.22)' : 'rgba(160,140,255,0.18)'
    })
    .attr('stroke-width', d => {
      const src = typeof d.source === 'string' ? d.source : d.source.id
      return src === '_you' ? 1.5 : 1
    })

  const node = container.append('g').selectAll('g').data(nodes).join('g')
    .attr('class', 'people-graph-node')
    .call(d3.drag()
      .on('start', (ev, d) => { if (!ev.active) state.peopleGraphSim.alphaTarget(0.3).restart(); d.fx = d.x; d.fy = d.y })
      .on('drag', (ev, d) => { d.fx = ev.x; d.fy = ev.y })
      .on('end', (ev, d) => { if (!ev.active) state.peopleGraphSim.alphaTarget(0); d.fx = null; d.fy = null })
    )

  // Circles
  node.append('circle')
    .attr('r', d => d.radius)
    .attr('fill', d => d.nodeType === 'self'
      ? 'url(#selfGradient)'
      : d.nodeType === 'entity'
        ? d.color
        : d.color)
    .attr('fill-opacity', d => d.nodeType === 'person' ? 0.85 : 1)
    .attr('stroke', d => d.color)
    .attr('stroke-width', d => d.nodeType === 'self' ? 2 : d.nodeType === 'entity' ? 1.5 : 1)
    .attr('stroke-opacity', d => d.nodeType === 'person' ? 0.4 : 0.6)

  // Add gradient for self node
  const defs = svg.append('defs')
  const grad = defs.append('radialGradient').attr('id', 'selfGradient')
  grad.append('stop').attr('offset', '0%').attr('stop-color', '#a090ff')
  grad.append('stop').attr('offset', '100%').attr('stop-color', '#8878ff')

  // Glow for self + entity nodes
  node.filter(d => d.nodeType === 'self' || d.nodeType === 'entity').append('circle')
    .attr('r', d => d.radius + 4)
    .attr('fill', 'none')
    .attr('stroke', d => d.color)
    .attr('stroke-opacity', 0.2)
    .attr('stroke-width', 3)

  // Labels
  node.append('text')
    .attr('class', 'people-graph-label')
    .attr('dy', d => -(d.radius + 4))
    .attr('text-anchor', 'middle')
    .text(d => d.nodeType === 'person' ? d.name.split(' ')[0] : d.name)
    .style('opacity', d => d.nodeType === 'self' || d.nodeType === 'entity' ? 1 : 0)
    .style('font-weight', d => d.nodeType !== 'person' ? '600' : '400')
    .style('font-size', d => d.nodeType === 'self' ? '11px' : d.nodeType === 'entity' ? '10px' : '9px')

  // Hover interactions
  const tooltip = document.getElementById('graph-tooltip')
  const tooltipTitle = document.getElementById('graph-tooltip-title')
  const tooltipStats = document.getElementById('graph-tooltip-stats')
  const tooltipAnalyze = document.getElementById('graph-tooltip-analyze')
  let tooltipTarget = null

  node.on('mouseenter', (ev, d) => {
    const neighborIds = new Set([d.id])
    edges.forEach(e => {
      const src = e.source.id || e.source
      const tgt = e.target.id || e.target
      if (src === d.id) neighborIds.add(tgt)
      if (tgt === d.id) neighborIds.add(src)
    })
    node.selectAll('circle').attr('fill-opacity', n => neighborIds.has(n.id) ? 1 : 0.1)
    node.selectAll('text').style('opacity', n => neighborIds.has(n.id) ? 1 : 0)
    link.attr('stroke-opacity', e => {
      const src = e.source.id || e.source
      const tgt = e.target.id || e.target
      return (src === d.id || tgt === d.id) ? 0.6 : 0.03
    }).attr('stroke-width', e => {
      const src = e.source.id || e.source
      const tgt = e.target.id || e.target
      return (src === d.id || tgt === d.id) ? 2 : 0.5
    })

    // Show tooltip for hub/entity nodes or person nodes
    if (d.nodeType === 'entity' || d.nodeType === 'self') {
      // Compute stats for this hub
      const catName = d.name
      const memberNodes = nodes.filter(n => n.nodeType === 'person' && neighborIds.has(n.id))
      const totalFu = memberNodes.reduce((s, n) => s + (n.fuCount || 0), 0)
      const today = new Date(); today.setHours(0, 0, 0, 0)
      const overdueFu = (state.peopleFollowUps || []).filter(f => {
        if (!f.due) return false
        const fDue = new Date(f.due); fDue.setHours(0, 0, 0, 0)
        const matchesMember = memberNodes.some(n => f.person && f.person.toLowerCase().includes(n.name.toLowerCase().split(' ')[0]))
        return matchesMember && fDue < today && (f.status || '').toLowerCase() !== 'done'
      }).length

      tooltipTitle.textContent = d.nodeType === 'self' ? 'Your Network' : catName
      tooltipStats.innerHTML = `
        <div class="graph-tooltip-stat"><span>People</span><span class="graph-tooltip-stat-value">${memberNodes.length}</span></div>
        <div class="graph-tooltip-stat"><span>Active follow-ups</span><span class="graph-tooltip-stat-value">${totalFu}</span></div>
        ${overdueFu > 0 ? `<div class="graph-tooltip-stat"><span>Overdue</span><span class="graph-tooltip-stat-value urgent">${overdueFu}</span></div>` : ''}
      `
      tooltipTarget = d
      // Position anchored to the node, not the cursor
      const svgRect = graphEl.querySelector('svg').getBoundingClientRect()
      const nodeEl = ev.currentTarget
      const ctm = nodeEl.getScreenCTM()
      if (ctm) {
        tooltip.style.left = (ctm.e + 20) + 'px'
        tooltip.style.top = (ctm.f - 10) + 'px'
      }
      tooltip.classList.add('visible')
    } else if (d.nodeType === 'person') {
      const cats = (d.categories || [d.category]).filter(c => c !== 'Other')
      tooltipTitle.textContent = d.name
      tooltipStats.innerHTML = `
        ${cats.length > 0 ? `<div class="graph-tooltip-stat"><span>Groups</span><span class="graph-tooltip-stat-value">${cats.join(', ')}</span></div>` : ''}
        <div class="graph-tooltip-stat"><span>Follow-ups</span><span class="graph-tooltip-stat-value${d.fuCount > 0 ? ' warn' : ''}">${d.fuCount}</span></div>
      `
      tooltipTarget = d
      const nodeEl2 = ev.currentTarget
      const ctm2 = nodeEl2.getScreenCTM()
      if (ctm2) {
        tooltip.style.left = (ctm2.e + 20) + 'px'
        tooltip.style.top = (ctm2.f - 10) + 'px'
      }
      tooltip.classList.add('visible')
    }
  })
  node.on('mouseleave', () => {
    node.selectAll('circle').attr('fill-opacity', d => d.nodeType === 'person' ? 0.85 : 1)
    node.selectAll('text').style('opacity', d => d.nodeType === 'self' || d.nodeType === 'entity' ? 1 : 0)
    link.attr('stroke-opacity', 1).attr('stroke-width', d => {
      const src = d.source.id || d.source
      return src === '_you' ? 1.5 : 1
    })
    // Hide tooltip after delay (so user can click Analyze)
    setTimeout(() => {
      if (!tooltip.matches(':hover')) tooltip.classList.remove('visible')
    }, 500)
  })
  // Keep tooltip visible while hovering it
  tooltip.addEventListener('mouseleave', () => tooltip.classList.remove('visible'))

  // Analyze button → open Oracle with context
  tooltipAnalyze.addEventListener('click', () => {
    tooltip.classList.remove('visible')
    const d = tooltipTarget
    if (!d) return
    const overlay = document.getElementById('oracle-overlay')
    const fab = document.getElementById('oracle-fab')
    overlay.classList.add('open')
    fab.classList.add('open')
    const oracleInput = document.getElementById('oracle-input')
    if (d.nodeType === 'entity' || d.nodeType === 'self') {
      const catName = d.name === 'You' ? 'my entire network' : d.name
      setTimeout(() => {
        oracleInput.value = `Analyze my ${catName} group. Who needs attention? What follow-ups are overdue? What patterns do you see in my relationships here?`
        oracleInput.focus()
      }, 200)
    } else if (d.nodeType === 'person') {
      setTimeout(() => {
        oracleInput.value = `Give me a full brief on ${d.name}. Relationship history, active commitments, last interaction, and what I should do next.`
        oracleInput.focus()
      }, 200)
    }
  })

  // Click person → open profile
  node.on('click', (ev, d) => {
    if (d.nodeType !== 'person') return
    // Switch to profile view
    state.peopleGraphMode = false
    document.getElementById('people-profile').style.display = ''
    document.getElementById('people-graph').style.display = 'none'
    document.getElementById('people-view-toggle').textContent = 'Graph'
    if (state.peopleGraphSim) { state.peopleGraphSim.stop(); state.peopleGraphSim = null }
    // Highlight in list
    document.querySelectorAll('#people-list .people-item').forEach(el => {
      el.classList.toggle('active', el.dataset.name === d.name)
    })
    openPersonProfile(d.path, d.name)
  })

  state.peopleGraphSim = d3.forceSimulation(nodes)
    .force('link', d3.forceLink(edges).id(d => d.id).distance(d => {
      const src = typeof d.source === 'string' ? d.source : d.source.id
      return src === '_you' ? 100 : 60
    }).strength(0.4))
    .force('charge', d3.forceManyBody().strength(d => d.nodeType === 'self' ? -300 : d.nodeType === 'entity' ? -200 : -60))
    .force('center', d3.forceCenter(W / 2, H / 2))
    .force('collide', d3.forceCollide(d => d.radius + 4))
    .on('tick', () => {
      link.attr('x1', d => d.source.x).attr('y1', d => d.source.y)
        .attr('x2', d => d.target.x).attr('y2', d => d.target.y)
      node.attr('transform', d => `translate(${d.x},${d.y})`)
    })
}

function highlightGraphCategory(catName) {
  const graphEl = document.getElementById('people-graph')
  const svg = graphEl?.querySelector('svg')
  if (!svg) return
  const container = d3.select(svg).select('g')
  if (!container.node()) return

  if (!catName) {
    // Reset — show all
    container.selectAll('circle').attr('fill-opacity', d => d.nodeType === 'person' ? 0.85 : 1)
    container.selectAll('.people-graph-label').style('opacity', d => d.nodeType === 'self' || d.nodeType === 'entity' ? 1 : 0)
    container.selectAll('line').attr('stroke-opacity', 1)
    return
  }

  // Highlight only matching category
  container.selectAll('circle').attr('fill-opacity', d => {
    if (d.nodeType === 'self') return 1
    if (d.nodeType === 'entity' && d.name === catName) return 1
    if (d.nodeType === 'person' && (d.categories || [d.category]).includes(catName)) return 1
    return 0.08
  })
  container.selectAll('.people-graph-label').style('opacity', d => {
    if (d.nodeType === 'self') return 1
    if (d.nodeType === 'entity' && d.name === catName) return 1
    if (d.nodeType === 'person' && (d.categories || [d.category]).includes(catName)) return 1
    return 0
  })
  container.selectAll('line').attr('stroke-opacity', d => {
    const src = d.source.id || d.source
    const tgt = d.target.id || d.target
    // Show lines connected to matching nodes
    const srcMatch = src === '_you' || (state.peopleData?.people?.find(p => p.fileName === src)?.category === catName)
    const tgtMatch = (state.peopleData?.people?.find(p => p.fileName === tgt)?.category === catName)
    return srcMatch && tgtMatch ? 0.5 : tgt.startsWith('_hub_') && tgt.includes(catName.toLowerCase().replace(/\s+/g, '-')) ? 0.5 : 0.03
  })
}

// Shared dispatcher — spawns a new session and sends any prompt about the network
function askAboutNetwork(prompt, tabLabel) {
  document.querySelector('.nav-item[data-view="terminal"]').click()
  setTimeout(() => {
    if (window.spawnSession) window.spawnSession()
    setTimeout(() => {
      if (state.activeId) {
        if (tabLabel) {
          const tab = state.sessions[state.activeId]?.tab
          if (tab) {
            const span = tab.querySelector('span:not(.stab-close)')
            if (span) span.textContent = tabLabel
          }
        }
        if (window.sendChatMessage) window.sendChatMessage(state.activeId, prompt)
      }
    }, 200)
  }, 150)
}

// Existing per-person Ask AI button in the view header
document.getElementById('people-ask-btn').addEventListener('click', () => {
  const personName = currentPersonName || 'this person'
  const prompt = `Tell me about ${personName} — their current status, open follow-ups, and what I should focus on next.`
  askAboutNetwork(prompt, personName)
})

// Persistent ask bar — general network prompts + free-form input
const askInput = document.getElementById('people-ask-input')
const askSend  = document.getElementById('people-ask-send')
function fireAsk() {
  const prompt = askInput.value.trim()
  if (!prompt) return
  askInput.value = ''
  askAboutNetwork(prompt, 'Network')
}
askInput.addEventListener('keydown', e => {
  if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); fireAsk() }
})
askSend.addEventListener('click', fireAsk)
document.querySelectorAll('.people-ask-chip').forEach(chip => {
  chip.addEventListener('click', () => {
    askAboutNetwork(chip.dataset.prompt, chip.textContent.trim())
  })
})

export {
  initPeople,
  applyPeopleFilters,
  renderPeopleList,
  openPersonProfile,
  renderPeopleGraph,
  highlightGraphCategory,
}
