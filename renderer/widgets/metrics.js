// renderer/widgets/metrics.js
export default {
  id: 'metrics',
  label: 'Stats Strip',
  description: 'Subscribers, MTD revenue, pipeline count, follow-up count',
  dataSource: null,
  defaultEnabled: true,

  render(allData, el) {
    const { metrics, pipeline, followUps } = allData || {}
    const s = metrics?._stats

    const fmtMoney = (n) => {
      if (!n) return '—'
      return n >= 1000 ? `$${Math.round(n / 1000)}K` : `$${Math.round(n)}`
    }

    // Check if any business data exists
    const hasBizData = s?.subscribers || s?.mtdRevenue || (Array.isArray(pipeline) && pipeline.length)
    const fuCount = Array.isArray(followUps) ? followUps.filter(f => (f.status||'').toLowerCase() !== 'done').length : 0

    // Always show follow-ups + pipeline count (vault data). Only show subscriber/revenue if connected.
    const stats = []
    if (hasBizData) {
      stats.push({ value: s?.subscribers ? Math.round(s.subscribers).toLocaleString() : '—', label: 'Subscribers', color: 'var(--blue-grey)' })
      stats.push({ value: fmtMoney(s?.mtdRevenue), label: 'Revenue MTD', color: 'var(--green)' })
    }
    stats.push({ value: Array.isArray(pipeline) ? `${pipeline.length}` : '0', label: 'Pipeline Deals', color: 'var(--gold)' })
    stats.push({ value: `${fuCount}`, label: 'Follow-ups', color: 'var(--text-secondary)' })

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
