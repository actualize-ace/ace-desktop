// renderer/widgets/outcomes.js
export default {
  id: 'outcomes',
  label: 'Outcomes',
  description: 'Active outcomes with gate countdowns and status',
  dataSource: 'getState',
  defaultEnabled: true,

  render(data, el) {
    if (!data?.outcomes?.length) {
      el.innerHTML = '<div style="font-size:10px;color:var(--text-dim);padding:8px 0">No outcomes found.</div>'
      return
    }
    el.innerHTML = `
      <div class="section-label">Outcomes</div>
      <div class="outcomes-grid">${data.outcomes.map(o => {
        const statusColor = { 'ON TRACK':'green','AT RISK':'gold','BLOCKED':'red','COMPLETE':'green','IN PROGRESS':'blue-grey' }[o.status] || 'dim'
        const daysColor   = o.daysToGate == null ? 'dim' : o.daysToGate < 0 ? 'red' : o.daysToGate <= 7 ? 'gold' : 'blue-grey'
        const daysLabel   = o.daysToGate == null ? '' : o.daysToGate < 0 ? `${Math.abs(o.daysToGate)}d overdue` : o.daysToGate === 0 ? 'today' : `${o.daysToGate}d`
        return `
          <div class="oc-card">
            <div class="oc-title">${o.title}</div>
            <div class="oc-meta">
              ${o.status ? `<span class="oc-badge ${statusColor}">${o.status}</span>` : ''}
              ${daysLabel ? `<span class="oc-days" style="color:var(--${daysColor})">${daysLabel}</span>` : ''}
              ${o.gateLabel ? `<span class="oc-gate">${o.gateLabel}</span>` : ''}
            </div>
          </div>`
      }).join('')}</div>`
  }
}
