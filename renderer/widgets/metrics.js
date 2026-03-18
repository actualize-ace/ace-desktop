// renderer/widgets/metrics.js
export default {
  id: 'metrics',
  label: 'Stats Strip',
  description: 'Subscribers, MTD revenue, pipeline count, follow-up count',
  dataSource: 'getMetrics',
  defaultEnabled: true,

  render(data, el) {
    if (!data || !data._stats) return
    const s = data._stats

    const fmtMoney = (n) => {
      if (!n) return '—'
      return n >= 1000 ? `$${Math.round(n / 1000)}K` : `$${Math.round(n)}`
    }

    el.innerHTML = `
      <div class="stats-strip">
        <div class="sstat">
          <span class="sv" style="color:var(--blue-grey)">${s.subscribers ? Math.round(s.subscribers).toLocaleString() : '—'}</span>
          <span class="sl">Subscribers</span>
        </div>
        <div class="sstat">
          <span class="sv" style="color:var(--green)">${fmtMoney(s.mtdRevenue)}</span>
          <span class="sl">Revenue MTD</span>
        </div>
        <div class="sstat">
          <span class="sv" style="color:var(--gold)">${Array.isArray(data._pipeline) ? fmtMoney(data._pipeline.reduce((s,d) => s+(d.amount||0), 0)) : '—'}</span>
          <span class="sl">Pipeline</span>
        </div>
        <div class="sstat">
          <span class="sv" style="color:var(--text-secondary)">${data._fuCount ?? '—'}</span>
          <span class="sl">Follow-ups</span>
        </div>
      </div>`
  }
}
