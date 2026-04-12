// renderer/widgets/northstar.js
// North Star bar — anchors + journey constellation + alignment
import { escapeHtml } from '../modules/chat-renderer.js'

export default {
  id: 'northstar',
  label: 'North Star',
  description: 'DCA anchors, journey progress, directional alignment',
  dataSource: null,           // composite — receives allData
  defaultEnabled: true,

  render(allData, el) {
    const ns = allData.northStar || {}
    const anchors = ns.north_star_anchors || []
    const daysElapsed = ns.daysElapsed
    const daysTotal = ns.daysTotal
    const gateDate = ns.gate_date

    // Empty state if no anchors configured
    if (anchors.length === 0) {
      el.innerHTML = `
        <div class="cockpit-northstar empty">
          <div class="ns-empty-text">Set your North Star in <span class="ns-link" data-action="open-dca">00-System/core/dca.md</span></div>
        </div>`
      el.querySelector('[data-action="open-dca"]')?.addEventListener('click', () => {
        document.querySelector('.nav-item[data-view="vault"]')?.click()
      })
      return
    }

    const alignment = this._deriveAlignment(allData)

    const anchorsHtml = anchors.map(a => escapeHtml(a)).join('<span class="ns-sep">·</span>')

    const gateLabel = gateDate
      ? new Date(gateDate).toLocaleDateString('en-US', { year: 'numeric', month: 'short', day: 'numeric' })
      : 'No gate set'
    const dayCount = (daysElapsed != null && daysTotal) ? `Day ${daysElapsed} / ${daysTotal}` : ''
    const arrowChar = alignment === 'on_course' ? '↑' : alignment === 'drifting' ? '→' : '↓'
    const alignLabel = alignment === 'on_course' ? 'on course' : alignment === 'drifting' ? 'drifting' : 'misaligned'

    // Render constellation (100 dots, scaled from daysElapsed/daysTotal)
    let constellationHtml = ''
    if (daysElapsed != null && daysTotal) {
      const total = 100
      const completed = Math.round((daysElapsed / daysTotal) * total)
      for (let i = 0; i < total; i++) {
        let cls = 'ns-star'
        if (i < completed - 1) cls += ' completed'
        else if (i === completed - 1) cls += ' current'
        constellationHtml += `<div class="${cls}"></div>`
      }
    }

    el.innerHTML = `
      <div class="cockpit-northstar" title="Click for full DCA + affirmations">
        <div class="ns-orient">You are here</div>
        <div class="ns-anchors">${anchorsHtml}</div>
        <div class="ns-meta">
          ${escapeHtml(gateLabel)} <span class="ns-arrow">${arrowChar}</span> ${alignLabel} <span class="ns-arrow">·</span> ${escapeHtml(dayCount)}
        </div>
        <div class="ns-constellation">${constellationHtml}</div>
      </div>`

    el.querySelector('.cockpit-northstar')?.addEventListener('click', () => {
      showDCAOverlay(ns, alignment)
    })
  },

  _deriveAlignment(allData) {
    const signals = allData.metrics?._signals || []
    const greens = signals.filter(s => s === 'green').length
    if (greens >= 6) return 'on_course'
    if (greens >= 3) return 'drifting'
    return 'misaligned'
  },
}

function escapeAttr(s) {
  return String(s || '').replace(/"/g, '&quot;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
}

function showDCAOverlay(ns, alignment) {
  document.querySelectorAll('.cockpit-overlay').forEach(o => o.remove())

  const anchors = ns.north_star_anchors || []
  const affirmations = ns.affirmations || []
  const gateDate = ns.gate_date
  const daysRemaining = (ns.daysTotal != null && ns.daysElapsed != null)
    ? ns.daysTotal - ns.daysElapsed : null
  const gateLabel = gateDate
    ? new Date(gateDate).toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric' })
    : 'No gate set'
  const alignLabel = alignment === 'on_course' ? 'on course'
    : alignment === 'drifting' ? 'drifting' : 'misaligned'

  const anchorsHtml = anchors.length
    ? anchors.map(a => `<div style="font-family:'Space Grotesk',sans-serif;font-size:16px;font-weight:300;padding:6px 0;color:var(--gold);">${escapeAttr(a)}</div>`).join('')
    : `<div style="font-style:italic;color:var(--text-dim);">No anchors set.</div>`

  const affirmationsHtml = affirmations.length
    ? affirmations.map(a => `<div style="font-family:'Cormorant Garamond',serif;font-style:italic;font-size:13px;padding:5px 0;color:var(--text-primary);opacity:0.85;">“${escapeAttr(a)}”</div>`).join('')
    : `<div style="font-style:italic;color:var(--text-dim);font-size:12px;">No affirmations set.</div>`

  const overlay = document.createElement('div')
  overlay.className = 'cockpit-overlay'
  overlay.innerHTML = `
    <div class="cockpit-overlay-panel" style="max-width:640px;">
      <div class="cockpit-overlay-header">
        <span class="cockpit-overlay-label">North Star · ${escapeAttr(alignLabel)}</span>
        <button class="cockpit-overlay-close" aria-label="Close">×</button>
      </div>
      <div class="cockpit-overlay-body">
        <div style="margin-bottom:18px;">
          <div style="font-family:'JetBrains Mono',monospace;font-size:8px;letter-spacing:0.22em;color:var(--text-dim);text-transform:uppercase;margin-bottom:10px;">Anchors</div>
          ${anchorsHtml}
        </div>
        <div style="margin-bottom:18px;padding-bottom:14px;border-bottom:1px dashed var(--border);">
          <div style="font-family:'JetBrains Mono',monospace;font-size:8px;letter-spacing:0.22em;color:var(--text-dim);text-transform:uppercase;margin-bottom:6px;">Gate</div>
          <div style="font-family:'Space Grotesk',sans-serif;font-size:14px;">${escapeAttr(gateLabel)}${daysRemaining != null ? ` <span style="color:var(--text-dim);font-family:'JetBrains Mono',monospace;font-size:11px;margin-left:8px;">${daysRemaining} days remain · Day ${ns.daysElapsed} / ${ns.daysTotal}</span>` : ''}</div>
        </div>
        <div>
          <div style="font-family:'JetBrains Mono',monospace;font-size:8px;letter-spacing:0.22em;color:var(--text-dim);text-transform:uppercase;margin-bottom:10px;">Affirmations</div>
          ${affirmationsHtml}
        </div>
      </div>
      <div class="cockpit-overlay-footer">
        <button class="cockpit-overlay-btn secondary" data-action="close">Close</button>
        <button class="cockpit-overlay-btn" data-action="edit-dca">Edit DCA</button>
      </div>
    </div>`

  const close = () => overlay.remove()
  overlay.addEventListener('click', (e) => { if (e.target === overlay) close() })
  overlay.querySelector('.cockpit-overlay-close').addEventListener('click', close)
  overlay.querySelector('[data-action="close"]').addEventListener('click', close)
  overlay.querySelector('[data-action="edit-dca"]').addEventListener('click', () => {
    close()
    document.querySelector('.nav-item[data-view="vault"]')?.click()
  })
  document.addEventListener('keydown', function esc(e) {
    if (e.key === 'Escape') { close(); document.removeEventListener('keydown', esc) }
  })
  document.body.appendChild(overlay)
}
