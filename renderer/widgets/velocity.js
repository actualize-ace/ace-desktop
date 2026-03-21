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
      type: 'line',
      data: {
        labels: series.map(s => s.label),
        datasets: [{
          data: series.map(s => s.value),
          borderColor: 'rgba(100,160,255,0.95)',
          borderWidth: 2,
          fill: true,
          backgroundColor: function(context) {
            const chart = context.chart
            const { ctx: c, chartArea } = chart
            if (!chartArea) return 'rgba(100,160,255,0.15)'
            const gradient = c.createLinearGradient(0, chartArea.top, 0, chartArea.bottom)
            gradient.addColorStop(0, 'rgba(100,160,255,0.4)')
            gradient.addColorStop(0.5, 'rgba(136,120,255,0.15)')
            gradient.addColorStop(1, 'rgba(136,120,255,0.01)')
            return gradient
          },
          tension: 0.45,
          pointRadius: 0,
          pointHoverRadius: 5,
          pointHoverBackgroundColor: '#88c0ff',
          pointHoverBorderColor: 'rgba(100,160,255,0.6)',
          pointHoverBorderWidth: 3,
        }]
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        interaction: { mode: 'index', intersect: false },
        plugins: {
          legend: { display: false },
          tooltip: {
            backgroundColor: 'rgba(26,22,18,0.95)',
            borderColor: 'rgba(100,160,255,0.3)',
            borderWidth: 1,
            padding: { x: 12, y: 8 },
            titleFont: { family: "'JetBrains Mono', monospace", size: 9 },
            titleColor: 'rgba(138,125,111,0.8)',
            bodyFont: { family: "'Space Grotesk', sans-serif", size: 13, weight: '500' },
            bodyColor: '#88c0ff',
            displayColors: false,
            callbacks: {
              title: items => {
                const raw = series[items[0].dataIndex]
                if (!raw) return ''
                const d = new Date(raw.label.replace(/(\d+)-(\d+)/, `${new Date().getFullYear()}-$1-$2`))
                return d.toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' })
              },
              label: ctx => `${ctx.parsed.y} actions`,
              afterLabel: ctx => {
                const idx = ctx.dataIndex
                const avg = Math.round(series.slice(Math.max(0, idx - 2), idx + 1).reduce((s, p) => s + p.value, 0) / Math.min(3, idx + 1))
                return `3-day avg: ${avg}`
              }
            }
          }
        },
        scales: {
          x: {
            grid: { display: false },
            border: { display: false },
            ticks: { color: 'rgba(90,82,72,0.7)', font: { size: 9 }, maxRotation: 0, maxTicksLimit: 7 }
          },
          y: {
            display: false,
            beginAtZero: true
          }
        }
      }
    })
  }
}
