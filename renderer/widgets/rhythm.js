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

    // Per-ritual totals
    const ritualCounts = {
      start:  days28.filter(d => d.start).length,
      active: days28.filter(d => d.active).length,
      eod:    days28.filter(d => d.eod).length,
    }

    // Current streak (consecutive days back from today that have a ritual)
    const streakFor = (key) => {
      let count = 0
      for (let i = days28.length - 1; i >= 0; i--) {
        if (days28[i][key]) count++
        else break
      }
      return count
    }
    const streaks = {
      start:  streakFor('start'),
      active: streakFor('active'),
      eod:    streakFor('eod'),
    }

    // Today's status
    const today = days28[days28.length - 1] || {}
    const todayMark = (on) => on ? '<span style="color:var(--gold)">●</span>' : '<span style="color:var(--text-dim);opacity:0.4">○</span>'

    const rowFor = (key, cls) => days28.map(d => {
      const on = !!d[key]
      const tip = `${d.date} · ${key}: ${on ? 'yes' : 'no'}`
      return `<div class="${on ? `rhythm-cell ${cls}` : 'rhythm-cell'}" title="${tip}"></div>`
    }).join('')

    // Overall completeness this week (last 7 days)
    const lastWeek = days28.slice(-7)
    const triadsThisWeek = lastWeek.reduce((sum, d) =>
      sum + (d.start ? 1 : 0) + (d.active ? 1 : 0) + (d.eod ? 1 : 0), 0)
    const pctThisWeek = Math.round((triadsThisWeek / 21) * 100)

    el.innerHTML = `
      <div class="flow-block">
        <div class="flow-label">
          <span>Rhythm</span>
          <span class="meta">${pctThisWeek}% this week</span>
        </div>
        <div class="rhythm-stack">
          <div class="rhythm-row" title="/start — morning grounding">
            <div class="rhythm-row-label">/start</div>
            <div class="rhythm-grid rhythm-grid-thin">${rowFor('start', 'active-3')}</div>
            <div class="rhythm-row-stat" title="current streak">${streaks.start}d</div>
          </div>
          <div class="rhythm-row" title="active — session work during the day">
            <div class="rhythm-row-label">active</div>
            <div class="rhythm-grid rhythm-grid-thin">${rowFor('active', 'active-2')}</div>
            <div class="rhythm-row-stat" title="current streak">${streaks.active}d</div>
          </div>
          <div class="rhythm-row" title="/eod — end-of-day closure">
            <div class="rhythm-row-label">/eod</div>
            <div class="rhythm-grid rhythm-grid-thin">${rowFor('eod', 'active-1')}</div>
            <div class="rhythm-row-stat" title="current streak">${streaks.eod}d</div>
          </div>
        </div>
        <div class="rhythm-today">
          <span class="rhythm-today-label">today</span>
          <span class="rhythm-today-dots">
            ${todayMark(today.start)} /start
            <span class="rhythm-today-sep">·</span>
            ${todayMark(today.active)} active
            <span class="rhythm-today-sep">·</span>
            ${todayMark(today.eod)} /eod
          </span>
        </div>
      </div>`
  }
}
