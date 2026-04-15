// renderer/widgets/cadence.js
// Cadence Ring — ritual streak (top) + review freshness (bottom).
// Replaces standalone ritualstreak in cockpit-brain zone.

function weeklyColor(days) {
  if (days == null) return 'dim'
  if (days <= 7)  return 'green'
  if (days <= 9)  return 'yellow'
  return 'red'
}

function monthlyColor(days) {
  if (days == null) return 'dim'
  if (days <= 31) return 'green'
  if (days <= 37) return 'yellow'
  return 'red'
}

function formatDate(iso) {
  if (!iso) return 'never'
  const d = new Date(iso + 'T00:00:00')
  return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })
}

function launchSkill(cmd) {
  document.querySelector('.nav-item[data-view="terminal"]')?.click()
  setTimeout(() => {
    if (window.spawnSession) window.spawnSession()
    setTimeout(() => {
      const st = window.__aceState
      if (st?.activeId && window.sendChatMessage) {
        window.sendChatMessage(st.activeId, cmd)
      } else if (window.sendToActive) {
        window.sendToActive(cmd + '\r')
      }
    }, 200)
  }, 150)
}

export default {
  id: 'cadence',
  label: 'Cadence Ring',
  description: 'Ritual streak + weekly/monthly review freshness',
  dataSource: null,
  defaultEnabled: true,

  render(allData, el) {
    // ─── Ritual Streak (top half) ───
    const d = allData.ritualStreak || {}
    const streak      = d.streak      ?? 0
    const todayActive = d.todayActive ?? false
    const pending     = d.todayPending ?? false
    const last7       = d.last7       || []

    const dotsHtml = last7.map((day, i) => {
      const cls = ['rs-dot', day.active ? 'active' : '', i === 0 ? 'today' : ''].filter(Boolean).join(' ')
      return `<div class="${cls}" title="${day.date}"></div>`
    }).join('')

    // ─── Cadence (bottom half) ───
    const c = allData.cadence || {}
    const wDays = c.weeklyDays
    const mDays = c.monthlyDays
    const wColor = weeklyColor(wDays)
    const mColor = monthlyColor(mDays)
    const wOverdue = wColor !== 'green' && wColor !== 'dim'
    const mOverdue = mColor !== 'green' && mColor !== 'dim'

    // Ring state — worst of the two
    let ringClass = ''
    if (wColor === 'red' || mColor === 'red') ringClass = 'overdue-red'
    else if (wColor === 'yellow' || mColor === 'yellow') ringClass = 'overdue-yellow'

    const wLabel = wDays != null ? `${wDays}d` : '—'
    const mLabel = mDays != null ? `${mDays}d` : '—'
    const wTooltip = `Last weekly review: ${formatDate(c.weeklyDate)}${wOverdue ? ' — click to run' : ''}`
    const mTooltip = `Last monthly reflection: ${formatDate(c.monthlyDate)}${mOverdue ? ' — click to run' : ''}`

    el.innerHTML = `
      <div class="cadence-ring-wrap ${ringClass}">
        <div class="cadence-ring-track"></div>
        <div class="cadence-ring-inner">
          <div class="rs-section">
            <div class="rs-top">
              <span class="rs-count">${streak}</span>
              <span class="rs-unit">day${streak !== 1 ? 's' : ''}</span>
            </div>
            <div class="rs-label">ritual streak</div>
            <div class="rs-dots">${dotsHtml}</div>
          </div>
          <div class="cadence-ring-divider"></div>
          <div class="cadence-section">
            <div class="cadence-label">cadence</div>
            <div class="cadence-chips">
              <div class="cadence-chip ${wOverdue ? 'overdue' : ''}" data-skill="/weekly-review">
                <div class="cadence-pip ${wColor}"></div>
                <span class="cadence-key">W:</span>
                <span class="cadence-days ${wColor}">${wLabel}</span>
                <span class="cadence-arrow ${wOverdue ? wColor : ''}">&#9655;</span>
                <div class="cadence-tooltip">${wTooltip}</div>
              </div>
              <span class="cadence-dot-sep">&middot;</span>
              <div class="cadence-chip ${mOverdue ? 'overdue' : ''}" data-skill="/monthly-reflection">
                <div class="cadence-pip ${mColor}"></div>
                <span class="cadence-key">M:</span>
                <span class="cadence-days ${mColor}">${mLabel}</span>
                <span class="cadence-arrow ${mOverdue ? mColor : ''}">&#9655;</span>
                <div class="cadence-tooltip">${mTooltip}</div>
              </div>
            </div>
          </div>
        </div>
      </div>`

    // Click handlers
    el.querySelectorAll('.cadence-chip').forEach(chip => {
      chip.addEventListener('click', () => {
        const cmd = chip.dataset.skill
        if (cmd) launchSkill(cmd)
      })
    })
  }
}
