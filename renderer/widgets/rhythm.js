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

    // Per-ritual totals for the meta line
    const ritualCounts = {
      start:  days28.filter(d => d.start).length,
      active: days28.filter(d => d.active).length,
      eod:    days28.filter(d => d.eod).length,
    }

    const rowFor = (key, cls) => days28.map(d => {
      const on = !!d[key]
      const tip = `${d.date} · ${key}: ${on ? 'yes' : 'no'}`
      return `<div class="${on ? `rhythm-cell ${cls}` : 'rhythm-cell'}" title="${tip}"></div>`
    }).join('')

    el.innerHTML = `
      <div class="flow-block">
        <div class="flow-label">
          <span>Rhythm</span>
          <span class="meta">start ${ritualCounts.start} · active ${ritualCounts.active} · eod ${ritualCounts.eod}</span>
        </div>
        <div class="rhythm-stack">
          <div class="rhythm-row" title="/start — morning grounding">
            <div class="rhythm-row-label">/start</div>
            <div class="rhythm-grid rhythm-grid-thin">${rowFor('start', 'active-3')}</div>
          </div>
          <div class="rhythm-row" title="active — session work during the day">
            <div class="rhythm-row-label">active</div>
            <div class="rhythm-grid rhythm-grid-thin">${rowFor('active', 'active-2')}</div>
          </div>
          <div class="rhythm-row" title="/eod — end-of-day closure">
            <div class="rhythm-row-label">/eod</div>
            <div class="rhythm-grid rhythm-grid-thin">${rowFor('eod', 'active-1')}</div>
          </div>
        </div>
      </div>`
  }
}
