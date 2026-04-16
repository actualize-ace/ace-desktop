// renderer/widgets/ritualstreak.js
// Ritual Streak — consecutive days with a daily note (proxy for /start being run).
// Replaces the compass in cockpit-brain zone.

export default {
  id: 'ritualstreak',
  label: 'Ritual Streak',
  description: 'Consecutive days you have run your morning start ritual',
  dataSource: null,
  defaultEnabled: true,

  render(allData, el) {
    const d = allData.ritualStreak || {}
    const streak      = d.streak      ?? 0
    const todayActive = d.todayActive ?? false
    const pending     = d.todayPending ?? false
    const last7       = d.last7       || []

    const dotsHtml = last7.map((day, i) => {
      const cls = [
        'rs-dot',
        day.active   ? 'active'  : '',
        i === 0      ? 'today'   : '',
      ].filter(Boolean).join(' ')
      return `<div class="${cls}" title="${day.date}"></div>`
    }).join('')

    const statusText = todayActive
      ? 'Today complete'
      : pending
        ? 'Run /start to keep your streak'
        : streak === 0
          ? 'Start your first ritual today'
          : 'Run /start to keep your streak'

    const statusClass = todayActive ? 'rs-status complete' : 'rs-status pending'

    el.innerHTML = `
      <div class="ritual-streak">
        <div class="rs-top">
          <span class="rs-count">${streak}</span>
          <span class="rs-unit">day${streak !== 1 ? 's' : ''}</span>
        </div>
        <div class="rs-label">ritual streak</div>
        <div class="rs-dots">${dotsHtml}</div>
        <div class="${statusClass}">${statusText}</div>
      </div>`
  }
}
