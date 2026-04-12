// renderer/modules/attention.js
import { state } from '../state.js'

// Attention state — tracks which sessions need user input
export function setAttention(id, sessionsObj, reason = 'notice') {
  sessionsObj = sessionsObj || state.sessions
  const s = sessionsObj[id]
  if (s) {
    s.needsAttention = true
    s.attentionReason = reason
    s.attentionAt = Date.now()
  }
  const tab = s?.tab || document.getElementById('tab-' + id)
  const dot = tab?.querySelector('.stab-dot')
  if (dot) dot.classList.add('attention')
  const arDot = document.querySelector(`#ar-item-${id} .ar-dot`)
  if (arDot) arDot.classList.add('attention')
  updateAttentionBadge()
}

export function clearAttention(id, sessionsObj) {
  sessionsObj = sessionsObj || state.sessions
  const s = sessionsObj[id]
  if (s) {
    s.needsAttention = false
    s.attentionReason = null
    s.attentionAt = null
  }
  const tab = s?.tab || document.getElementById('tab-' + id)
  const dot = tab?.querySelector('.stab-dot')
  if (dot) dot.classList.remove('attention')
  const arDot = document.querySelector(`#ar-item-${id} .ar-dot`)
  if (arDot) arDot.classList.remove('attention')
  updateAttentionBadge()
}

export function updateAttentionBadge() {
  const sessionCount = Object.values(state.sessions).filter(s => s.needsAttention).length
  const agentCount   = Object.values(state.agentSessions).filter(s => s.needsAttention).length
  const count = sessionCount + agentCount
  const badge = document.getElementById('attention-badge')
  if (badge) {
    badge.textContent = count
    badge.classList.toggle('visible', count > 0)
  }
  // Mirror agent-attention state onto the Agents nav-item so the user sees
  // it from anywhere in the app, not just inside the Agents view.
  const agentsNav = document.querySelector('.nav-item[data-view="agents"]')
  if (agentsNav) agentsNav.classList.toggle('has-attention', agentCount > 0)
  const sessionsNav = document.querySelector('.nav-item[data-view="terminal"]')
  if (sessionsNav) sessionsNav.classList.toggle('has-attention', sessionCount > 0)
}
