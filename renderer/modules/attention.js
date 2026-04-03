// renderer/modules/attention.js
import { state } from '../state.js'

// Attention state — tracks which sessions need user input
export function setAttention(id, sessionsObj) {
  sessionsObj = sessionsObj || state.sessions
  const s = sessionsObj[id]
  if (s) s.needsAttention = true
  // Update tab dot
  const tab = s?.tab || document.getElementById('tab-' + id)
  const dot = tab?.querySelector('.stab-dot')
  if (dot) dot.classList.add('attention')
  // Update agent roster dot
  const arDot = document.querySelector(`#ar-item-${id} .ar-dot`)
  if (arDot) arDot.classList.add('attention')
  updateAttentionBadge()
}

export function clearAttention(id, sessionsObj) {
  sessionsObj = sessionsObj || state.sessions
  const s = sessionsObj[id]
  if (s) s.needsAttention = false
  const tab = s?.tab || document.getElementById('tab-' + id)
  const dot = tab?.querySelector('.stab-dot')
  if (dot) dot.classList.remove('attention')
  const arDot = document.querySelector(`#ar-item-${id} .ar-dot`)
  if (arDot) arDot.classList.remove('attention')
  updateAttentionBadge()
}

export function updateAttentionBadge() {
  const count = Object.values(state.sessions).filter(s => s.needsAttention).length +
                Object.values(state.agentSessions).filter(s => s.needsAttention).length
  const badge = document.getElementById('attention-badge')
  if (badge) {
    badge.textContent = count
    badge.classList.toggle('visible', count > 0)
  }
}
