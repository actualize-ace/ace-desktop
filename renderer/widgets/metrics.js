// renderer/widgets/metrics.js
// Universal stats strip — works for any ACE client, no ace.db dependency
export default {
  id: 'metrics',
  label: 'Stats Strip',
  description: 'Sessions, targets, follow-ups, pulse freshness',
  dataSource: null,
  defaultEnabled: true,

  render(allData, el) {
    const { state, metrics, pipeline, followUps, velocity } = allData || {}
    const s = metrics?._stats

    const fmtMoney = (n) => {
      if (!n) return '\u2014'
      return n >= 1000 ? `$${Math.round(n / 1000)}K` : `$${Math.round(n)}`
    }

    // Universal stats (always available from vault files)
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

    // Append business stats if ace.db data exists
    const hasBizData = s?.subscribers || s?.mtdRevenue || (Array.isArray(pipeline) && pipeline.length)
    if (hasBizData) {
      if (s?.mtdRevenue) stats.push({ value: fmtMoney(s.mtdRevenue), label: 'Revenue MTD', color: 'var(--green)' })
      if (Array.isArray(pipeline) && pipeline.length) stats.push({ value: `${pipeline.length}`, label: 'Pipeline', color: 'var(--gold)' })
    }

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
