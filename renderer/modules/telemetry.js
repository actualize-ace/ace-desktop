// renderer/modules/telemetry.js
import { state } from '../state.js'

export const MODEL_CTX_LIMITS = { opus: 1_000_000, sonnet: 200_000, haiku: 200_000 }

// ─── Sidebar Telemetry ────────────────────────────────────────────────────────
const ACE_BOOT_TIME = Date.now()

export function updateTelemetry() {
  const allSessions = [...Object.values(state.sessions), ...Object.values(state.agentSessions)]
  const activeCount = allSessions.length
  const streamingCount = allSessions.filter(s => s.isStreaming).length

  // Sessions
  const sessEl = document.getElementById('telem-sessions')
  if (sessEl) {
    sessEl.textContent = streamingCount > 0 ? `${activeCount} · ${streamingCount} live` : `${activeCount}`
    sessEl.classList.toggle('streaming', streamingCount > 0)
  }

  // Active session context %
  const activeSession = state.sessions[state.activeId]
  const ctxEl = document.getElementById('telem-ctx-pct')
  if (ctxEl) {
    if (activeSession?.contextInputTokens) {
      const model = activeSession?.model || state.chatDefaults?.model || 'opus'
      const limit = MODEL_CTX_LIMITS[model] || 200_000
      const pct = Math.min(100, Math.round((activeSession.contextInputTokens / limit) * 100))
      ctxEl.textContent = pct + '%'
    } else {
      ctxEl.textContent = '—'
    }
  }

  // Uptime
  const uptimeSec = Math.floor((Date.now() - ACE_BOOT_TIME) / 1000)
  const hrs = Math.floor(uptimeSec / 3600)
  const mins = Math.floor((uptimeSec % 3600) / 60)
  const secs = uptimeSec % 60
  const uptimeEl = document.getElementById('telem-uptime')
  if (uptimeEl) uptimeEl.textContent = hrs > 0 ? `${hrs}h ${mins}m` : `${mins}:${String(secs).padStart(2, '0')}`
}

// ─── Claude Usage Limits ──────────────────────────────────────────────────────

export async function fetchUsageLimits() {
  if (state.usageFetching || !window.ace?.dash?.getUsage) { console.log('[usage] skipped:', state.usageFetching ? 'already fetching' : 'no getUsage'); return }
  state.usageFetching = true
  console.log('[usage] fetching...')
  try {
    const data = await window.ace.dash.getUsage()
    console.log('[usage] got:', JSON.stringify(data))
    if (data && !data.error) state.usageData = data
    else console.log('[usage] error in data:', data?.error)
  } catch (e) { console.error('[usage] catch:', e) }
  state.usageFetching = false
  renderUsageLimits()
}

export function fmtTok(n) {
  if (n >= 1000000) return (n / 1000000).toFixed(1) + 'M'
  if (n >= 1000) return (n / 1000).toFixed(0) + 'K'
  return n + ''
}

export function renderUsageLimits() {
  const sessionEl = document.getElementById('telem-session-val')
  if (state.usageData?.session && sessionEl) {
    sessionEl.textContent = fmtTok(state.usageData.session.tokens)
  }
}

export function initTelemetry() {
  setInterval(updateTelemetry, 1000)
  updateTelemetry()

  // Fetch on startup, then every 5 minutes
  setTimeout(fetchUsageLimits, 3000)
  setInterval(fetchUsageLimits, 5 * 60 * 1000)
}
