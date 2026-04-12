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

    // Build per-point date labels for rollover
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

    // Compute 3-day rolling average per point
    const rolling3 = points.map((p, i) => {
      const start = Math.max(0, i - 2)
      const window = points.slice(start, i + 1).map(x => x.v)
      return Math.round((window.reduce((s, v) => s + v, 0) / window.length) * 10) / 10
    })

    // Invisible hover hit-markers per data point (8px radius for easy hover)
    const markers = points.map((p, i) =>
      `<circle cx="${p.x.toFixed(1)}" cy="${p.y.toFixed(1)}" r="8"
               fill="transparent" stroke="none"
               class="velocity-hit"
               data-label="${p.label}"
               data-value="${p.v}"
               data-avg="${rolling3[i]}"/>`
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
            <path class="line-glow" d="${linePath}" vector-effect="non-scaling-stroke" />
            <path class="line" d="${linePath}" vector-effect="non-scaling-stroke" />
            ${markers}
          </svg>
          <div class="velocity-dot" id="velocity-dot"></div>
          <div class="velocity-tooltip" id="velocity-tooltip"></div>
        </div>
      </div>`

    // Wire custom DOM tooltip + circular HTML dot overlay (SVG is stretched
    // non-uniformly so SVG circles render as ovals; HTML dot stays round)
    const wave = el.querySelector('.velocity-wave')
    const tooltip = el.querySelector('#velocity-tooltip')
    const dot = el.querySelector('#velocity-dot')
    if (wave && tooltip && dot) {
      el.querySelectorAll('.velocity-hit').forEach(hit => {
        hit.addEventListener('mouseenter', () => {
          const rect = wave.getBoundingClientRect()
          const cx = parseFloat(hit.getAttribute('cx'))
          const cy = parseFloat(hit.getAttribute('cy'))
          const px = (cx / 300) * rect.width
          const py = (cy / 52) * rect.height
          tooltip.innerHTML = `
            <div class="vt-date">${hit.dataset.label}</div>
            <div class="vt-value">${hit.dataset.value} action${hit.dataset.value === '1' ? '' : 's'}</div>
            <div class="vt-avg">3-day avg: ${hit.dataset.avg}</div>`
          tooltip.style.left = `${px}px`
          tooltip.classList.add('show')
          dot.style.left = `${px}px`
          dot.style.top = `${py}px`
          dot.classList.add('show')
        })
        hit.addEventListener('mouseleave', () => {
          tooltip.classList.remove('show')
          dot.classList.remove('show')
        })
      })
    }
  }
}
