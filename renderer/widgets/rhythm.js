// renderer/widgets/rhythm.js
// Rhythm 28-day activity grid — prototype-v2 style.
// Cells colored by ritual count per day: 0 → dim, 1 → active-1, 2 → active-2, 3 → active-3.
// Backend provides data.week (7 most recent days). Cells beyond that render as dim.

export default {
  id: 'rhythm',
  label: 'Rhythm',
  description: '28-day ritual activity grid',
  dataSource: 'getRhythm',
  defaultEnabled: true,

  render(data, el) {
    const days28 = data?.days28 || []
    if (!days28.length) {
      el.innerHTML = `
        <div class="flow-block">
          <div class="flow-label"><span>Rhythm</span><span class="meta">—</span></div>
          <div style="font-size:10px;color:var(--text-dim);padding:8px 0;font-style:italic">
            No rituals tracked yet — run <span style="color:var(--gold)">/start</span> to begin.
          </div>
        </div>`
      return
    }

    // Compute density stats for meta line
    const activeDays = days28.filter(d => d.start || d.active || d.eod).length
    const totalRituals = days28.reduce((sum, d) =>
      sum + (d.start ? 1 : 0) + (d.active ? 1 : 0) + (d.eod ? 1 : 0), 0)

    const cells = days28.map(d => {
      const count = (d.start ? 1 : 0) + (d.active ? 1 : 0) + (d.eod ? 1 : 0)
      const cls = count > 0 ? `rhythm-cell active-${Math.min(3, count)}` : 'rhythm-cell'
      const parts = []
      if (d.start)  parts.push('/start')
      if (d.active) parts.push('active')
      if (d.eod)    parts.push('/eod')
      const tip = `${d.date}\n${parts.length ? parts.join(' · ') : 'nothing logged'}`
      return `<div class="${cls}" title="${tip}"></div>`
    }).join('')

    el.innerHTML = `
      <div class="flow-block">
        <div class="flow-label">
          <span>Rhythm</span>
          <span class="meta">${activeDays}/28 days · ${totalRituals} rituals</span>
        </div>
        <div class="rhythm-grid">${cells}</div>
      </div>`
  }
}
