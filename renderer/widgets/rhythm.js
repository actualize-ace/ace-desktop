// renderer/widgets/rhythm.js
export default {
  id: 'rhythm',
  label: 'Rhythm',
  description: 'Weekly ritual heatmap — /start, active, /eod',
  dataSource: 'getRhythm',
  defaultEnabled: true,

  render(data, el) {
    if (!data || !data.week || !data.week.length) {
      el.innerHTML = `
        <div class="section-label">Rhythm</div>
        <div style="font-size:11px;color:var(--text-dim);padding:8px 0;font-style:italic">
          No rituals tracked yet \u2014 run <span style="color:var(--gold)">/start</span> to begin.
        </div>`
      return
    }

    const today = new Date().toISOString().slice(0, 10)
    const rituals = ['start', 'active', 'eod']
    const ritualLabels = ['/start', 'active', '/eod']

    el.innerHTML = `
      <div class="section-label">Rhythm
        <span style="color:var(--text-dim);font-weight:400;margin-left:8px">
          ${data.streaks.start > 0 ? `start: ${data.streaks.start}d` : ''}
          ${data.streaks.active > 0 ? ` \u00b7 active: ${data.streaks.active}d` : ''}
          ${data.streaks.eod > 0 ? ` \u00b7 eod: ${data.streaks.eod}d` : ''}
        </span>
      </div>
      <div class="rhythm-grid">
        <div class="rhythm-header">
          <div class="rhythm-label"></div>
          ${data.week.map(w => `<div class="rhythm-day-label${w.date === today ? ' today' : ''}">${w.dayLabel}</div>`).join('')}
        </div>
        ${rituals.map((r, ri) => `
          <div class="rhythm-row">
            <div class="rhythm-label">${ritualLabels[ri]}</div>
            ${data.week.map(w => {
              const active = w[r]
              const isToday = w.date === today
              return `<div class="rhythm-cell${active ? ' active' : ''}${isToday ? ' today' : ''}"></div>`
            }).join('')}
          </div>
        `).join('')}
      </div>`
  }
}
