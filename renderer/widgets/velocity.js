// renderer/widgets/velocity.js
// Velocity waveform — prototype-v2 style SVG with purple gradient fill.
// Uses daily execution counts from execution-log.md.

export default {
  id: 'velocity',
  label: 'Velocity',
  description: 'Shipping cadence from execution-log.md',
  dataSource: 'getVelocity',
  defaultEnabled: true,

  render(data, el) {
    if (!data || data.error) {
      el.innerHTML = `
        <div class="flow-block">
          <div class="flow-label"><span>Velocity</span></div>
          <div style="font-size:10px;color:var(--text-dim);padding:8px 0;font-style:italic">unavailable</div>
        </div>`
      return
    }

    const { byDay, totalThisWeek, totalLastWeek } = data

    // Build 14-day series oldest→newest
    const today = new Date()
    const series = []
    for (let i = 13; i >= 0; i--) {
      const d = new Date(today); d.setDate(d.getDate() - i)
      const key = d.toISOString().slice(0, 10)
      series.push(byDay[key] || 0)
    }

    const delta = totalLastWeek > 0
      ? Math.round((totalThisWeek - totalLastWeek) / totalLastWeek * 100)
      : null
    const arrowChar = delta === null ? '·' : delta > 0 ? '↑' : delta < 0 ? '↓' : '→'
    const metaText = delta === null
      ? `${totalThisWeek} this week`
      : `${totalThisWeek} this week · ${delta >= 0 ? '+' : ''}${delta}%`

    // Build per-point labels + dates for rollover
    const today = new Date()
    const dateLabels = []
    for (let i = 13; i >= 0; i--) {
      const d = new Date(today); d.setDate(d.getDate() - i)
      dateLabels.push(d.toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' }))
    }

    // Map values to SVG coordinates (viewBox 0-300 × 0-52, inverted Y)
    const maxVal = Math.max(1, ...series)
    const n = series.length
    const points = series.map((v, i) => {
      const x = (i / (n - 1)) * 300
      const y = 52 - (v / maxVal) * 40 - 4 // reserve 4px top/bottom padding
      return { x, y, v, label: dateLabels[i] }
    })

    // Build a smooth path using quadratic bezier through midpoints
    let linePath = `M${points[0].x},${points[0].y}`
    for (let i = 1; i < points.length; i++) {
      const prev = points[i - 1]
      const curr = points[i]
      const mx = (prev.x + curr.x) / 2
      const my = (prev.y + curr.y) / 2
      if (i === 1) {
        linePath += ` Q${prev.x},${prev.y} ${mx},${my}`
      } else {
        linePath += ` T${mx},${my}`
      }
    }
    linePath += ` T${points[n - 1].x},${points[n - 1].y}`

    const areaPath = `${linePath} L${points[n - 1].x},52 L${points[0].x},52 Z`

    // Invisible rollover hit-markers per data point
    const markers = points.map((p, i) =>
      `<circle cx="${p.x.toFixed(1)}" cy="${p.y.toFixed(1)}" r="8"
               fill="transparent" class="velocity-hit" data-i="${i}">
         <title>${p.label}: ${p.v} action${p.v === 1 ? '' : 's'}</title>
       </circle>`
    ).join('')
    // Visible dots at each point for visual affordance
    const dots = points.map((p, i) =>
      `<circle cx="${p.x.toFixed(1)}" cy="${p.y.toFixed(1)}" r="2"
               fill="var(--gold)" opacity="${p.v > 0 ? 0.6 : 0.2}"
               class="velocity-dot"/>`
    ).join('')

    el.innerHTML = `
      <div class="flow-block">
        <div class="flow-label">
          <span>Velocity</span>
          <span class="meta">${metaText}</span>
          <span class="arrow">${arrowChar}</span>
        </div>
        <div class="velocity-wave">
          <svg viewBox="0 0 300 52" preserveAspectRatio="none">
            <defs>
              <linearGradient id="velArea" x1="0" y1="0" x2="0" y2="1">
                <stop offset="0%"   stop-color="rgba(200,160,240,0.35)" />
                <stop offset="100%" stop-color="rgba(200,160,240,0)" />
              </linearGradient>
            </defs>
            <path fill="url(#velArea)" stroke="none" d="${areaPath}" />
            <path class="line" d="${linePath}" />
            ${dots}
            ${markers}
          </svg>
        </div>
      </div>`
  }
}
