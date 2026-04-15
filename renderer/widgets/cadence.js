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

function formatSince(iso) {
  if (!iso) return null
  const d = new Date(iso + 'T00:00:00')
  return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' })
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
    const streakStart = d.streakStart ?? null
    const todayActive = d.todayActive ?? false
    const pending     = d.todayPending ?? false

    // Streak state: active | at-risk | broken
    const streakState = todayActive ? 'active' : (pending && streak > 0) ? 'at-risk' : 'broken'

    // Since label
    const sinceLabel = streakStart ? `since ${formatSince(streakStart)}` : null

    // Streak display
    let streakCountHtml, streakTooltip
    if (streakState === 'broken') {
      streakCountHtml = `<span class="rs-count broken">—</span>`
      streakTooltip = 'No active streak — run /start to begin'
    } else {
      streakCountHtml = `
        <span class="rs-count ${streakState}">${streak}</span>
        <span class="rs-unit ${streakState}">days</span>`
      streakTooltip = streakState === 'active'
        ? `${streak}-day ritual streak · today complete`
        : `${streak}-day streak at risk — run /start today to keep it`
    }

    // ─── Cadence (bottom half) ───
    const c = allData.cadence || {}
    const wDays = c.weeklyDays
    const mDays = c.monthlyDays
    const wColor = weeklyColor(wDays)
    const mColor = monthlyColor(mDays)
    const wOverdue = wColor !== 'green' && wColor !== 'dim'
    const mOverdue = mColor !== 'green' && mColor !== 'dim'

    // Ring class — worst of cadence overdue OR streak state
    let ringClass = ''
    if (wColor === 'red' || mColor === 'red' || streakState === 'broken') ringClass = 'overdue-red'
    else if (wColor === 'yellow' || mColor === 'yellow' || streakState === 'at-risk') ringClass = 'overdue-yellow'

    const wLabel = wDays != null ? `${wDays}d` : '—'
    const mLabel = mDays != null ? `${mDays}d` : '—'
    const wTooltip = `Last weekly review: ${formatDate(c.weeklyDate)}${wOverdue ? ' — click to run' : ''}`
    const mTooltip = `Last monthly reflection: ${formatDate(c.monthlyDate)}${mOverdue ? ' — click to run' : ''}`

    el.innerHTML = `
      <div class="cadence-ring-wrap ${ringClass}">
        <div class="cadence-ring-track"></div>
        <div class="cadence-ring-iris"></div>
        <div class="cadence-ring-inner">
          <div class="rs-section">
            <div class="rs-streak-wrap">
              <div class="rs-top">
                ${streakCountHtml}
              </div>
              <div class="rs-tooltip">${streakTooltip}</div>
            </div>
            <div class="rs-label">days</div>
            ${streakState === 'broken'
              ? `<div class="rs-start-cta" data-skill="/start">run /start →</div>`
              : sinceLabel ? `<div class="rs-since">${sinceLabel}</div>` : ''
            }
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

    // Click handlers — cadence chips + broken-state CTA
    el.querySelectorAll('.cadence-chip, .rs-start-cta').forEach(chip => {
      chip.addEventListener('click', () => {
        const cmd = chip.dataset.skill
        if (cmd) launchSkill(cmd)
      })
    })
  }
}
