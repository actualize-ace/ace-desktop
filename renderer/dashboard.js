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
  }

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

export { loadDashboard, getLayout }
