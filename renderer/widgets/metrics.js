// renderer/widgets/metrics.js
// Universal stats strip — vault-markdown only, no DB dependency.
export default {
  id: 'metrics',
  label: 'Stats Strip',
  description: 'Sessions, targets, follow-ups, pulse freshness',
  dataSource: null,
  defaultEnabled: true,

  render(allData, el) {
    const { state, followUps, velocity } = allData || {}

    const sessionsThisWeek = velocity?.totalThisWeek || 0
    const targetsDone = state?.weeklyTargets?.filter(t => t.checked).length || 0
    const targetsTotal = state?.weeklyTargets?.length || 0
    const fuCount = Array.isArray(followUps) ? followUps.filter(f => (f.status||'').toLowerCase() !== 'done').length : 0
    const daysSincePulse = state?.daysSincePulse ?? -1
    const pulseLabel = daysSincePulse === -1 ? 'Never' : daysSincePulse === 0 ? 'Today' : `${daysSincePulse}d`

    const stats = [
      { value: `${sessionsThisWeek}`, label: 'Sessions', color: 'var(--blue-grey)' },
      { value: targetsTotal > 0 ? `${targetsDone}/${targetsTotal}` : '\u2014', label: 'Targets', color: 'var(--green)' },
      { value: `${fuCount}`, label: 'Follow-ups', color: 'var(--gold)' },
      { value: pulseLabel, label: 'Last Pulse', color: daysSincePulse > 5 || daysSincePulse === -1 ? 'var(--red)' : 'var(--text-secondary)' },
    ]

    el.innerHTML = `
      <div class="stats-strip">
        ${stats.map(st => `
          <div class="sstat">
            <span class="sv" style="color:${st.color}">${st.value}</span>
            <span class="sl">${st.label}</span>
          </div>
        `).join('')}
      </div>`
  }
}
