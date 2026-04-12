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
      <div class="cockpit-northstar">
        <div class="ns-orient">You are here</div>
        <div class="ns-anchors">${anchorsHtml}</div>
        <div class="ns-meta">
          ${escapeHtml(gateLabel)} <span class="ns-arrow">${arrowChar}</span> ${alignLabel} <span class="ns-arrow">·</span> ${escapeHtml(dayCount)}
        </div>
        <div class="ns-constellation">${constellationHtml}</div>
      </div>`
  },

  _deriveAlignment(allData) {
    const signals = allData.metrics?._signals || []
    const greens = signals.filter(s => s === 'green').length
    if (greens >= 6) return 'on_course'
    if (greens >= 3) return 'drifting'
    return 'misaligned'
  },
}
