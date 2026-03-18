// renderer/widgets/velocity.js
// Requires Chart.js UMD loaded globally in index.html (window.Chart)
export default {
  id: 'velocity',
  label: '14-Day Velocity',
  description: 'Shipping cadence from execution-log.md',
  dataSource: 'getVelocity',
  defaultEnabled: true,

  _chartInstance: null,

  render(data, el) {
    if (!data || data.error) {
      el.innerHTML = '<div style="font-size:10px;color:var(--text-dim);padding:8px 0">Velocity data unavailable.</div>'
      return
    }
    const { byDay, totalThisWeek, totalLastWeek } = data
    const delta = totalLastWeek > 0
      ? Math.round((totalThisWeek - totalLastWeek) / totalLastWeek * 100)
      : null

    // Build ordered 14-day series oldest→newest
    const today = new Date()
    const series = []
    for (let i = 13; i >= 0; i--) {
      const d = new Date(today); d.setDate(d.getDate() - i)
      const key = d.toISOString().slice(0, 10)
      series.push({ label: key.slice(5), value: byDay[key] || 0 })
    }

    const deltaHtml = delta !== null
      ? `<span style="color:${delta >= 0 ? 'var(--green)' : 'var(--red)'}">(${delta >= 0 ? '+' : ''}${delta}%)</span>`
      : ''

    el.innerHTML = `
      <div class="section-label">14-Day Velocity
        <span style="color:var(--text-dim);font-weight:400;margin-left:8px">
          ${totalThisWeek} this week ${deltaHtml}
        </span>
      </div>
      <div style="height:120px;padding:4px 0">
        <canvas id="velocity-chart"></canvas>
      </div>`

    const ctx = el.querySelector('#velocity-chart')
    if (!ctx || typeof Chart === 'undefined') return

    if (this._chartInstance) { this._chartInstance.destroy(); this._chartInstance = null }

    this._chartInstance = new Chart(ctx, {
      type: 'bar',
      data: {
        labels: series.map(s => s.label),
        datasets: [{
          data: series.map(s => s.value),
          backgroundColor: 'rgba(212,165,116,0.4)',
          borderColor: '#d4a574',
          borderWidth: 1,
          borderRadius: 2,
        }]
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        plugins: {
          legend: { display: false },
          tooltip: { callbacks: { label: ctx => `${ctx.parsed.y} actions` } }
        },
        scales: {
          x: { ticks: { color: '#5a5248', font: { size: 9 } }, grid: { display: false } },
          y: {
            ticks: { color: '#5a5248', font: { size: 9 }, stepSize: 1 },
            grid: { color: 'rgba(212,165,116,0.05)' },
            beginAtZero: true
          }
        }
      }
    })
  }
}
