// renderer/modules/perf-telemetry.js
//
// Local perf timing — tracks cold-start and chat latency metrics and
// exposes them via window.__acePerf for DevTools inspection.
// Nothing is sent remotely; these are dev-time diagnostics only.

const marks = new Map()   // key -> { startMs, label }
const results = []        // completed measurements

function start(key, label) {
  marks.set(key, { startMs: performance.now(), label: label || key })
}

function end(key) {
  const m = marks.get(key)
  if (!m) return null
  marks.delete(key)
  const ms = +(performance.now() - m.startMs).toFixed(1)
  const entry = { label: m.label, ms, ts: Date.now() }
  results.push(entry)
  if (results.length > 100) results.shift()
  return entry
}

// Convenience wrappers for the three plan-specified metrics
export function markSessionOpen(id) { start(`session:${id}`, `session_open_to_ready:${id}`) }
export function markSessionReady(id) {
  const r = end(`session:${id}`)
  if (r) console.debug(`[perf] session_open_to_ready=${r.ms}ms`)
  return r
}

export function markSendStart(id) { start(`send:${id}`, `first_token:${id}`) }
export function markFirstToken(id) {
  const r = end(`send:${id}`)
  if (r) console.debug(`[perf] first_token=${r.ms}ms`)
  return r
}

export function getResults() { return [...results] }

if (typeof window !== 'undefined') {
  window.__acePerf = { getResults, marks, results }
}
