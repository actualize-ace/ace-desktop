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

  // Collect unique data sources needed by enabled widgets
  const neededSources = new Set()
  for (const id of enabledIds) {
    const w = WIDGETS.find(w => w.id === id)
    if (w?.dataSource) neededSources.add(w.dataSource)
  }

  // Data source → IPC method map
  const sourceMap = {
    getState:     () => window.ace.dash.getState(),
    getPipeline:  () => window.ace.dash.getPipeline(),
    getFollowUps: () => window.ace.dash.getFollowUps(),
    getMetrics:   () => window.ace.dash.getMetrics(),
    getVelocity:  () => window.ace.dash.getVelocity(),
  }

  // Fetch needed sources in parallel
  const fetchList = [...neededSources].filter(s => sourceMap[s])
  const fetchResults = await Promise.all(fetchList.map(s => sourceMap[s]()))
  const data = {}
  fetchList.forEach((s, i) => { data[s] = fetchResults[i] })

  // Always fetch velocity for synthesis context (even if velocity widget is disabled)
  if (!data.getVelocity) data.getVelocity = await window.ace.dash.getVelocity()

  // Bundle allData for synthesis widget
  const allData = {
    state:     data.getState,
    metrics:   data.getMetrics,
    pipeline:  data.getPipeline,
    followUps: data.getFollowUps,
    velocity:  data.getVelocity,
  }

  // Render each enabled widget into its container
  for (const id of enabledIds) {
    const widget = WIDGETS.find(w => w.id === id)
    const container = document.getElementById(`widget-${id}`)
    if (!widget || !container) continue

    const widgetData = widget.id === 'synthesis'
      ? allData
      : data[widget.dataSource]

    try {
      widget.render(widgetData, container)
    } catch (e) {
      console.error(`[dashboard] widget ${id} render error:`, e)
    }
  }
}

export { loadDashboard, getLayout }
