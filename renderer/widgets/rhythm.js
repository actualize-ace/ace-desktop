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
    if (!data || !data.week || !data.week.length) {
      el.innerHTML = `
        <div class="flow-block">
          <div class="flow-label"><span>Rhythm</span><span class="meta">—</span></div>
          <div style="font-size:10px;color:var(--text-dim);padding:8px 0;font-style:italic">
            No rituals tracked yet — run <span style="color:var(--gold)">/start</span> to begin.
          </div>
        </div>`
      return
    }

    // Build level map keyed by date string (YYYY-MM-DD)
    const levels = {}
    for (const day of data.week) {
      const count = (day.start ? 1 : 0) + (day.active ? 1 : 0) + (day.eod ? 1 : 0)
      levels[day.date] = count
    }

    // Render 28 cells, oldest on left → newest on right
    const today = new Date()
    today.setHours(0, 0, 0, 0)
    const cells = []
    for (let i = 27; i >= 0; i--) {
      const d = new Date(today)
      d.setDate(d.getDate() - i)
      const key = d.toISOString().slice(0, 10)
      const level = levels[key] ?? 0
      const cls = level > 0 ? `rhythm-cell active-${Math.min(3, level)}` : 'rhythm-cell'
      cells.push(`<div class="${cls}" title="${key}: ${level} ritual${level === 1 ? '' : 's'}"></div>`)
    }

    el.innerHTML = `
      <div class="flow-block">
        <div class="flow-label">
          <span>Rhythm</span>
          <span class="meta">28 days</span>
        </div>
        <div class="rhythm-grid">${cells.join('')}</div>
      </div>`
  }
}
