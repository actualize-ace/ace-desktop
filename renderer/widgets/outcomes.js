// renderer/widgets/outcomes.js
function escapeHtml(str) {
  return String(str ?? '').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;')
}

export default {
  id: 'outcomes',
  label: 'Outcomes',
  description: 'Active outcomes with gate countdowns and status',
  dataSource: 'getState',
  defaultEnabled: true,

  render(data, el) {
    if (!data?.outcomes?.length) {
      el.innerHTML = '<div style="font-size:11px;color:var(--text-dim);padding:8px 0;opacity:0.7">No outcomes yet — define them in <span style="color:var(--gold)">active.md</span></div>'
      return
    }
    el.innerHTML = `
      <div class="section-label">Outcomes</div>
      <div class="outcomes-grid">${data.outcomes.map(o => {
        const statusColor = { 'ON TRACK':'green','AT RISK':'gold','BLOCKED':'red','COMPLETE':'green','IN PROGRESS':'blue-grey' }[o.status] || 'dim'
        const isClosed    = o.status === 'COMPLETE' || o.status === 'CLOSED'
        const daysColor   = o.daysToGate == null || isClosed ? 'dim' : o.daysToGate < 0 ? 'red' : o.daysToGate <= 7 ? 'gold' : 'blue-grey'
        const daysLabel   = o.daysToGate == null ? '' : isClosed ? 'closed' : o.daysToGate < 0 ? `${Math.abs(o.daysToGate)}d overdue` : o.daysToGate === 0 ? 'today' : `${o.daysToGate}d`
        return `
          <div class="oc-card dash-clickable" data-cmd="Tell me the current status of my outcome: ${escapeHtml(o.title)}">
            <div class="oc-title">${escapeHtml(o.title)}</div>
            <div class="oc-meta">
              ${o.status ? `<span class="oc-badge ${statusColor}">${escapeHtml(o.status)}</span>` : ''}
              ${daysLabel ? `<span class="oc-days" style="color:var(--${daysColor})">${escapeHtml(daysLabel)}</span>` : ''}
              ${o.gateLabel ? `<span class="oc-gate">${escapeHtml(o.gateLabel)}</span>` : ''}
            </div>
          </div>`
      }).join('')}</div>`
  }
}
