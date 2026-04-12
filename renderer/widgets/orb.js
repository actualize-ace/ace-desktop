// renderer/widgets/orb.js
// Breathing coherence orb — prototype-v2 fidelity.
// Renders: iris rings + ping ripple + orb body with score / divider / state.
// Click → contextual panel with coherence breakdown + Threshold Mode entry.

import synthesis from './synthesis.js'

const SIGNAL_NAMES = {
  A1: 'Truth', A2: 'Choice', A3: 'Expression',
  C1: 'Regulation', C2: 'Depth', C3: 'Resilience',
  E1: 'Rhythm', E2: 'Containers', E3: 'Realization',
}

function stateLabel(score) {
  if (score >= 15) return 'coherent'
  if (score >= 11) return 'stable'
  if (score >= 7)  return 'drifting'
  if (score >= 4)  return 'fragmented'
  return 'critical'
}

function escapeAttr(s) {
  return String(s || '').replace(/"/g, '&quot;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
}

export default {
  id: 'orb',
  label: 'Coherence Orb',
  description: 'Breathing orb with coherence score + state',
  dataSource: null,
  defaultEnabled: true,

  render(allData, el) {
    const ctx = synthesis._buildContext(allData)
    const score = ctx.coherenceScore ?? 0
    const total = 18
    const label = stateLabel(score)

    el.innerHTML = `
      <div class="orb-wrap" title="Coherence breakdown + Threshold Mode">
        <div class="orb-iris"></div>
        <div class="orb-ping"></div>
        <div class="orb">
          <div class="orb-score">${score}</div>
          <div class="orb-divider">/ ${total}</div>
          <div class="orb-state">${label}</div>
        </div>
      </div>`

    el.querySelector('.orb-wrap')?.addEventListener('click', () => {
      showOrbOverlay(ctx, allData, score, total, label)
    })
  },
}

function showOrbOverlay(ctx, allData, score, total, label) {
  document.querySelectorAll('.cockpit-overlay').forEach(o => o.remove())

  const signalKeys = ['A1','A2','A3','C1','C2','C3','E1','E2','E3']
  const rows = signalKeys.map((key, i) => {
    const color = ctx.signals[i] || 'dim'
    const status = { green: 'Green', yellow: 'Yellow', red: 'Red', dim: '—' }[color]
    return `<div class="cockpit-overlay-row">
      <span class="cockpit-overlay-row-label">${key} · ${SIGNAL_NAMES[key]}</span>
      <span class="cockpit-overlay-row-value ${color === 'green' ? 'active' : ''}">${status}</span>
    </div>`
  }).join('')

  const overlay = document.createElement('div')
  overlay.className = 'cockpit-overlay'
  overlay.innerHTML = `
    <div class="cockpit-overlay-panel">
      <div class="cockpit-overlay-header">
        <span class="cockpit-overlay-label">Coherence ${score} / ${total} · ${label}</span>
        <button class="cockpit-overlay-close" aria-label="Close">×</button>
      </div>
      <div class="cockpit-overlay-body">
        ${rows}
      </div>
      <div class="cockpit-overlay-footer">
        <button class="cockpit-overlay-btn secondary" data-action="close">Close</button>
        <button class="cockpit-overlay-btn" data-action="threshold">Enter Threshold Mode</button>
      </div>
    </div>`

  const close = () => overlay.remove()
  overlay.addEventListener('click', (e) => { if (e.target === overlay) close() })
  overlay.querySelector('.cockpit-overlay-close').addEventListener('click', close)
  overlay.querySelector('[data-action="close"]').addEventListener('click', close)
  overlay.querySelector('[data-action="threshold"]').addEventListener('click', () => {
    close()
    // Open coaching session primed for threshold ritual
    document.querySelector('.nav-item[data-view="terminal"]')?.click()
    setTimeout(() => {
      if (window.spawnSession) window.spawnSession()
      setTimeout(() => {
        const st = window.__aceState
        if (st?.activeId && window.sendChatMessage) {
          window.sendChatMessage(st.activeId,
            "Open Threshold Mode for me. Walk me through 3 coherence breaths, recite my North Star anchors, then ask me: what wants to be created today? My answer becomes today's intent.")
        }
      }, 200)
    }, 150)
  })
  document.addEventListener('keydown', function esc(e) {
    if (e.key === 'Escape') { close(); document.removeEventListener('keydown', esc) }
  })
  document.body.appendChild(overlay)
}
