// renderer/dashboard.js
// Orchestrates widget rendering based on layout config from ace-config.json.
import { WIDGETS, DEFAULT_LAYOUT } from './widgets/registry.js'

async function getLayout() {
  const saved = await window.ace.dash.getLayout()
  if (!saved) {
    await window.ace.dash.saveLayout(DEFAULT_LAYOUT)
    return DEFAULT_LAYOUT
  }
  // Merge: keep saved order/enabled, add any new widgets from registry at end
  const savedIds = new Set(saved.map(w => w.id))
  const merged = [...saved]
  for (const w of WIDGETS) {
    if (!savedIds.has(w.id)) merged.push({ id: w.id, enabled: w.defaultEnabled ?? true })
  }
  return merged
}

async function loadDashboard() {
  const layout = await getLayout()
  const enabledIds = layout.filter(l => l.enabled).map(l => l.id)

  // Data source → IPC method map
  const sourceMap = {
    getState:     () => window.ace.dash.getState(),
    getPipeline:  () => window.ace.dash.getPipeline(),
    getFollowUps: () => window.ace.dash.getFollowUps(),
    getMetrics:   () => window.ace.dash.getMetrics(),
    getVelocity:  () => window.ace.dash.getVelocity(),
    getRhythm:    () => window.ace.dash.getRhythm(),
    getPatterns:  () => window.ace.dash.getPatterns(),
  }

  // Collect unique data sources needed by enabled widgets
  const neededSources = new Set()
  for (const id of enabledIds) {
    const w = WIDGETS.find(w => w.id === id)
    if (w?.dataSource) neededSources.add(w.dataSource)
    else if (w && w.dataSource === null) {
      // Composite widgets receive allData — fetch every source
      for (const key of Object.keys(sourceMap)) neededSources.add(key)
    }
  }

  // Fetch needed sources in parallel
  const fetchList = [...neededSources].filter(s => sourceMap[s])
  const fetchResults = await Promise.all(fetchList.map(s => sourceMap[s]()))
  const data = {}
  fetchList.forEach((s, i) => { data[s] = fetchResults[i] })

  // Always fetch velocity for synthesis context (even if velocity widget is disabled)
  if (!data.getVelocity) data.getVelocity = await window.ace.dash.getVelocity()

  // Bundle allData for composite widgets (dataSource: null)
  const allData = {
    state:     data.getState,
    metrics:   data.getMetrics,
    pipeline:  data.getPipeline,
    followUps: data.getFollowUps,
    velocity:  data.getVelocity,
    rhythm:    data.getRhythm,
    patterns:  data.getPatterns,
  }

  // ─── Vault health banner ──────────────────────────────────
  try {
    const health = await window.ace.health?.check?.()
    if (health && !health.ok && health.missing?.length) {
      let bannerEl = document.getElementById('vault-health-banner')
      if (!bannerEl) {
        bannerEl = document.createElement('div')
        bannerEl.id = 'vault-health-banner'
        const grid = document.querySelector('.triad-grid') || document.querySelector('.dashboard-grid') || document.querySelector('.widget-grid')
        if (grid) grid.parentNode.insertBefore(bannerEl, grid)
      }
      renderHealthBanner(health, bannerEl)
    } else {
      const existing = document.getElementById('vault-health-banner')
      if (existing) existing.remove()
    }
  } catch (_) { /* vault health is non-blocking */ }

  // Clear all widget containers first, then render only enabled ones
  for (const w of WIDGETS) {
    const container = document.getElementById(`widget-${w.id}`)
    if (container && !enabledIds.includes(w.id)) container.innerHTML = ''
  }

  for (let _wi = 0; _wi < enabledIds.length; _wi++) {
    const id = enabledIds[_wi]
    const widget = WIDGETS.find(w => w.id === id)
    const container = document.getElementById(`widget-${id}`)
    if (!widget || !container) continue

    const widgetData = widget.dataSource === null
      ? allData
      : data[widget.dataSource]

    try {
      widget.render(widgetData, container)
      // Staggered entrance animation
      container.style.animation = `widgetReveal 0.35s ease ${_wi * 0.06}s both`
    } catch (e) {
      console.error(`[dashboard] widget ${id} render error:`, e)
    }
  }

  // Render Triad signal dots in column headers
  const signals = allData.metrics?._signals || Array(9).fill('dim')
  const dotGroups = {
    authority:  signals.slice(0, 3),  // A1, A2, A3
    capacity:   signals.slice(3, 6),  // C1, C2, C3
    expansion:  signals.slice(6, 9),  // E1, E2, E3
  }
  for (const [leg, dots] of Object.entries(dotGroups)) {
    const el = document.getElementById(`dots-${leg}`)
    if (el) el.innerHTML = dots.map(c => `<div class="triad-dot ${c}"></div>`).join('')
  }

  // Dynamic greeting from user.md
  const userName = allData.state?.userName
  if (userName) {
    const hour = new Date().getHours()
    const greet = hour < 12 ? 'morning' : hour < 17 ? 'afternoon' : 'evening'
    const nameEl = document.getElementById('home-name')
    if (nameEl) nameEl.textContent = `Good ${greet}, ${userName}.`
  }
}

function renderHealthBanner(health, el) {
  const pageGroups = {}
  for (const m of health.missing) {
    const key = m.page || 'system'
    if (!pageGroups[key]) pageGroups[key] = []
    pageGroups[key].push(m)
  }

  const groupHtml = Object.entries(pageGroups).map(([page, items]) => {
    const label = page === 'system' ? 'System' : page.charAt(0).toUpperCase() + page.slice(1)
    const itemsHtml = items.map(i =>
      `<span class="health-item health-${i.tier}">${i.path}</span>`
    ).join('')
    return `<div class="health-group"><strong>${label}</strong> ${itemsHtml}</div>`
  }).join('')

  el.innerHTML = `
    <div class="vault-health-card">
      <div class="health-header">
        <span class="health-score">${health.score}%</span>
        <span class="health-label">Vault Integrity</span>
        <span class="health-count">${health.missing.length} item${health.missing.length === 1 ? '' : 's'} missing</span>
        <button class="health-fix-all" onclick="window.__fixAllVault__()">Fix All</button>
        <button class="health-dismiss" onclick="this.closest('.vault-health-card').remove()">\u00d7</button>
      </div>
      <div class="health-body">${groupHtml}</div>
    </div>
  `

  window.__fixAllVault__ = async () => {
    const btn = el.querySelector('.health-fix-all')
    if (btn) { btn.textContent = 'Fixing...'; btn.disabled = true }
    await window.ace.health.scaffoldAll(health.missing)
    el.remove()
    if (typeof loadDashboard === 'function') loadDashboard()
  }
}

// ─── Clickable dashboard items → terminal ───────────────────────────────────
function initDashClickables() {
  const home = document.getElementById('view-home')
  if (!home || home._dashClickWired) return
  home._dashClickWired = true
  home.addEventListener('click', (e) => {
    const item = e.target.closest('.dash-clickable[data-cmd]')
    if (!item) return
    document.querySelector('.nav-item[data-view="terminal"]')?.click()
    if (window.sendToActive) {
      setTimeout(() => window.sendToActive(item.dataset.cmd + '\r'), 120)
    }
  })
}

export { loadDashboard, getLayout, initDashClickables }
