// renderer/modules/refresh-engine.js
// Two-tier self-refresh: soft GC (30 min / health threshold) + full reload (6h idle)
import { state } from '../state.js'

// ── Timing Constants ──────────────────────────────────────────────────────────
const TICK_MS          = 60_000        // check every 60 seconds
const SOFT_GC_INTERVAL = 30 * 60_000  // 30 min default soft GC cycle
const SOFT_GC_COOLDOWN = 5 * 60_000   // skip GC if user active within this window
const FULL_RELOAD_IDLE = 6 * 3_600_000 // 6 hours idle
const MIN_UPTIME       = 2 * 3_600_000 // 2 hours before full reload eligible
const HEALTH_THRESHOLD = 0.7           // soft GC fires immediately above this

// ── Sensor Weights ────────────────────────────────────────────────────────────
const W_DOM       = 0.35
const W_LISTENER  = 0.15
const W_SESSION   = 0.15
const W_UPTIME    = 0.20
const W_STALENESS = 0.15

// ── Sensor Baselines / Ceilings ───────────────────────────────────────────────
const DOM_BASE = 50,  DOM_CEIL = 500
const LIS_BASE = 10,  LIS_CEIL = 60
const SES_BASE = 2,   SES_CEIL = 8
const UPT_BASE = 1,   UPT_CEIL = 8   // hours
const GCS_BASE = 10,  GCS_CEIL = 60  // minutes

// ── State ─────────────────────────────────────────────────────────────────────
let bootedAt    = Date.now()
let lastSoftGC  = Date.now()
let healthScore = 0
let tickTimer   = null

const softGcCallbacks    = []
const willReloadCallbacks = []

// ── Public Registration ───────────────────────────────────────────────────────
export function onSoftGC(fn)     { softGcCallbacks.push(fn) }
export function onWillReload(fn) { willReloadCallbacks.push(fn) }
export function getHealthScore() { return healthScore }
export function getBootedAt()    { return bootedAt }

// ── Sensors ───────────────────────────────────────────────────────────────────
function clamp01(v) { return Math.max(0, Math.min(1, v)) }

function sensorDOM() {
  const count = document.querySelectorAll('.chat-msg').length
  return clamp01((count - DOM_BASE) / (DOM_CEIL - DOM_BASE))
}

function sensorListeners() {
  let count = 0
  for (const s of Object.values(state.sessions || {})) {
    if (s._cleanupListeners) count += 3
  }
  for (const s of Object.values(state.agentSessions || {})) {
    if (s._cleanupListeners) count += 3
  }
  return clamp01((count - LIS_BASE) / (LIS_CEIL - LIS_BASE))
}

function sensorSessions() {
  const count = Object.keys(state.sessions || {}).length + Object.keys(state.agentSessions || {}).length
  return clamp01((count - SES_BASE) / (SES_CEIL - SES_BASE))
}

function sensorUptime() {
  const hours = (Date.now() - bootedAt) / 3_600_000
  return clamp01((hours - UPT_BASE) / (UPT_CEIL - UPT_BASE))
}

function sensorStaleness() {
  const minutes = (Date.now() - lastSoftGC) / 60_000
  return clamp01((minutes - GCS_BASE) / (GCS_CEIL - GCS_BASE))
}

function computeHealth() {
  return (
    sensorDOM()       * W_DOM +
    sensorListeners() * W_LISTENER +
    sensorSessions()  * W_SESSION +
    sensorUptime()    * W_UPTIME +
    sensorStaleness() * W_STALENESS
  )
}

// ── Soft GC ───────────────────────────────────────────────────────────────────
function runSoftGC() {
  console.log('[refresh-engine] soft GC — health was', healthScore.toFixed(3))
  for (const fn of softGcCallbacks) {
    try { fn() } catch (e) { console.error('[refresh-engine] soft-gc callback error:', e) }
  }
  lastSoftGC = Date.now()
  healthScore = computeHealth()
  updateVitalsDot()
}

// ── Full Reload ───────────────────────────────────────────────────────────────
function runFullReload() {
  console.log('[refresh-engine] full reload triggered')
  for (const fn of willReloadCallbacks) {
    try { fn() } catch (e) { console.error('[refresh-engine] will-reload callback error:', e) }
  }
  localStorage.setItem('_aceReloadMarker', JSON.stringify({
    ts: Date.now(),
    lastView: document.querySelector('.nav-item.active')?.dataset?.view || 'home',
    theme: state.theme,
    sidebarCollapsed: document.querySelector('.sidebar')?.classList.contains('collapsed') || false,
  }))
  location.reload()
}

// ── Post-Reload Restore ───────────────────────────────────────────────────────
export function checkReloadRestore() {
  const raw = localStorage.getItem('_aceReloadMarker')
  if (!raw) return
  try {
    const marker = JSON.parse(raw)
    localStorage.removeItem('_aceReloadMarker')
    if (marker.lastView) {
      const navItem = document.querySelector(`.nav-item[data-view="${marker.lastView}"]`)
      if (navItem) navItem.click()
    }
    if (marker.sidebarCollapsed) {
      document.querySelector('.sidebar')?.classList.add('collapsed')
    }
    console.log('[refresh-engine] restored from reload marker', marker)
  } catch { localStorage.removeItem('_aceReloadMarker') }
}

// ── Vitals Dot UI ─────────────────────────────────────────────────────────────
function updateVitalsDot() {
  const dot = document.getElementById('vitals-dot')
  if (!dot) return
  if (healthScore < 0.4) {
    dot.dataset.level = ''
    dot.dataset.tooltip = 'System vitals: clear'
  } else if (healthScore < 0.7) {
    dot.dataset.level = 'warming'
    dot.dataset.tooltip = 'System vitals: warming'
  } else {
    dot.dataset.level = 'hot'
    dot.dataset.tooltip = 'Refreshing...'
  }
}

// ── Tick ──────────────────────────────────────────────────────────────────────
function tick() {
  healthScore = computeHealth()
  window.dispatchEvent(new CustomEvent('ace:health-score', { detail: healthScore }))
  updateVitalsDot()

  const now = Date.now()
  const idleMs = now - (state.atmosphere?.lastActivity || now)
  const uptimeMs = now - bootedAt
  const sinceSoftGC = now - lastSoftGC
  const recentlyActive = idleMs < SOFT_GC_COOLDOWN

  // Full reload check (highest priority)
  const anyStreaming = Object.values(state.sessions || {}).some(s => s.isStreaming) ||
                       Object.values(state.agentSessions || {}).some(s => s.isStreaming)
  if (uptimeMs > MIN_UPTIME && idleMs > FULL_RELOAD_IDLE && !anyStreaming) {
    runFullReload()
    return
  }

  // Soft GC check
  if (!recentlyActive) {
    if (healthScore >= HEALTH_THRESHOLD || sinceSoftGC >= SOFT_GC_INTERVAL) {
      runSoftGC()
    }
  }
}

// ── Init ──────────────────────────────────────────────────────────────────────
export function initRefreshEngine() {
  bootedAt   = Date.now()
  lastSoftGC = Date.now()
  checkReloadRestore()

  // Built-in: config hot-reload on each soft GC
  onSoftGC(async () => {
    try {
      const config = await window.ace?.setup?.getConfig()
      if (!config) return
      if (config.defaults?.chat) Object.assign(state.chatDefaults, config.defaults.chat)
      if (config.defaults?.guardrails?.sessionCostWarning !== undefined) {
        state._costGuardrail = config.defaults.guardrails.sessionCostWarning
      }
      console.log('[refresh-engine] config hot-reloaded')
    } catch (e) { console.error('[refresh-engine] config reload failed:', e) }
  })

  tickTimer = setInterval(tick, TICK_MS)
  console.log('[refresh-engine] initialized')

  // Debug helpers — accessible from DevTools console
  window._refreshEngine = {
    health:     () => healthScore,
    sensors:    () => ({
      dom:       sensorDOM(),
      listeners: sensorListeners(),
      sessions:  sensorSessions(),
      uptime:    sensorUptime(),
      staleness: sensorStaleness(),
      total:     computeHealth(),
    }),
    softGC:     () => runSoftGC(),
    bootedAt:   () => new Date(bootedAt).toLocaleTimeString(),
    lastSoftGC: () => new Date(lastSoftGC).toLocaleTimeString(),
  }
}
