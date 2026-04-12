// renderer/modules/attention-menu.js
// Routes user to the pane that flagged. Shows a dropdown when multiple
// sessions need attention; direct-jumps when exactly one.
import { state } from '../state.js'
import { clearAttention } from './attention.js'
import { activateSession } from './session-manager.js'
import { focusAgentPane } from './agent-manager.js'

const REASON_LABEL = {
  question: 'asks you',
  exit:     'finished',
  error:    'errored',
  notice:   'needs you',
}

function relativeTime(ts) {
  if (!ts) return ''
  const secs = Math.floor((Date.now() - ts) / 1000)
  if (secs < 60)   return `${secs}s ago`
  if (secs < 3600) return `${Math.floor(secs/60)}m ago`
  return `${Math.floor(secs/3600)}h ago`
}

function collectFlagged() {
  const items = []
  for (const [id, s] of Object.entries(state.sessions)) {
    if (!s.needsAttention) continue
    const label = document.getElementById('tab-label-' + id)?.textContent || 'ACE'
    const pane = s.pane?.parentElement?.id === 'pane-content-right' ? 'right' : 'left'
    items.push({ id, kind: 'session', label, pane, reason: s.attentionReason, at: s.attentionAt })
  }
  for (const [id, s] of Object.entries(state.agentSessions)) {
    if (!s.needsAttention) continue
    items.push({ id, kind: 'agent', label: s.role || 'Agent', pane: 'agents', reason: s.attentionReason, at: s.attentionAt })
  }
  return items.sort((a, b) => (b.at || 0) - (a.at || 0))
}

function pulseArrival(id, kind) {
  const tabDot = document.querySelector(`#tab-${id} .stab-dot`)
  const paneEl = kind === 'session' ? state.sessions[id]?.pane : state.agentSessions[id]?.pane
  const hdrDot = paneEl?.querySelector('.term-hdr-dot')
  ;[tabDot, hdrDot].forEach(el => {
    if (!el) return
    el.classList.remove('just-arrived')
    // Force reflow so the animation restarts even if the class lingered
    void el.offsetWidth
    el.classList.add('just-arrived')
    // CSS animation is 3s; clear class slightly after so animation completes
    setTimeout(() => el.classList.remove('just-arrived'), 3100)
  })
}

// Switch nav view if not already active, then run the activation fn after
// two rAF ticks (one frame to apply classes, one for layout). Deterministic
// replacement for the previous magic 100ms setTimeout.
function switchViewAndRun(viewName, fn) {
  const navItem = document.querySelector(`.nav-item[data-view="${viewName}"]`)
  const alreadyActive = navItem?.classList.contains('active')
  if (navItem && !alreadyActive) navItem.click()
  requestAnimationFrame(() => requestAnimationFrame(fn))
}

function route(item) {
  console.log('[attention-menu] route', item)
  if (item.kind === 'session') {
    switchViewAndRun('terminal', () => {
      activateSession(item.id)
      clearAttention(item.id, state.sessions)
      pulseArrival(item.id, 'session')
    })
  } else {
    switchViewAndRun('agents', () => {
      focusAgentPane(item.id)
      clearAttention(item.id, state.agentSessions)
      pulseArrival(item.id, 'agent')
    })
  }
}

function render(items) {
  const menu = document.getElementById('attention-menu')
  if (!menu) return
  menu.innerHTML = items.map(it => `
    <div class="attention-menu-item" data-id="${it.id}" data-kind="${it.kind}" role="menuitem" tabindex="-1">
      <span class="attention-menu-label">${escapeHtml(it.label)}</span>
      <span class="attention-menu-reason">${REASON_LABEL[it.reason] || REASON_LABEL.notice}</span>
      <span class="attention-menu-pane">${it.pane}</span>
      <span class="attention-menu-time">${relativeTime(it.at)}</span>
    </div>
  `).join('')
  menu.querySelectorAll('.attention-menu-item').forEach(el => {
    el.addEventListener('click', () => {
      const item = currentItems.find(i => i.id === el.dataset.id && i.kind === el.dataset.kind)
      if (item) { close(); route(item) }
    })
  })
}

function escapeHtml(str) {
  return String(str).replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]))
}

let outsideHandler = null
let keyHandler = null
let activeIdx = 0
let currentItems = []

export function open() {
  close()
  currentItems = collectFlagged()
  if (currentItems.length === 0) return
  if (currentItems.length === 1) {
    route(currentItems[0])
    return
  }
  render(currentItems)
  const menu = document.getElementById('attention-menu')
  if (!menu) return
  menu.classList.add('open')
  menu.setAttribute('aria-hidden', 'false')
  activeIdx = 0
  highlight()
  // Outside-click dismiss — defer one tick so the triggering click doesn't immediately close
  setTimeout(() => {
    outsideHandler = (e) => {
      if (!menu.contains(e.target) && e.target.id !== 'attention-badge') close()
    }
    document.addEventListener('click', outsideHandler)
  }, 0)
  keyHandler = (e) => {
    if (e.key === 'Escape') { e.preventDefault(); close() }
    else if (e.key === 'ArrowDown') { e.preventDefault(); activeIdx = (activeIdx + 1) % currentItems.length; highlight() }
    else if (e.key === 'ArrowUp')   { e.preventDefault(); activeIdx = (activeIdx - 1 + currentItems.length) % currentItems.length; highlight() }
    else if (e.key === 'Enter')     { e.preventDefault(); const it = currentItems[activeIdx]; if (it) { close(); route(it) } }
  }
  document.addEventListener('keydown', keyHandler)
}

function highlight() {
  const menu = document.getElementById('attention-menu')
  menu?.querySelectorAll('.attention-menu-item').forEach((el, i) => {
    const isActive = i === activeIdx
    el.classList.toggle('active', isActive)
    el.setAttribute('tabindex', isActive ? '0' : '-1')
    if (isActive) el.focus()
  })
}

export function close() {
  const menu = document.getElementById('attention-menu')
  if (!menu) return
  menu.classList.remove('open')
  menu.setAttribute('aria-hidden', 'true')
  if (outsideHandler) document.removeEventListener('click', outsideHandler)
  if (keyHandler)     document.removeEventListener('keydown', keyHandler)
  outsideHandler = null; keyHandler = null
}
