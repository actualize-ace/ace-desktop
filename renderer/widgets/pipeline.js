// renderer/widgets/pipeline.js
function escapeHtml(str) {
  return String(str ?? '').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;')
}

export default {
  id: 'pipeline',
  label: 'Pipeline',
  description: 'Active deals by stage from ace.db',
  dataSource: 'getPipeline',
  defaultEnabled: true,

  render(data, el) {
    const deals = Array.isArray(data) ? data : []
    if (!deals.length) { el.innerHTML = ''; el.style.display = 'none'; return }
    el.style.display = ''
    const total = deals.reduce((s, d) => s + (d.amount || 0), 0)
    const fmtMoney = n => n >= 1000 ? `$${Math.round(n/1000)}K` : `$${Math.round(n)}`
    const today = new Date(); today.setHours(0,0,0,0)

    el.innerHTML = `
      <div class="section-label">Pipeline <span style="color:var(--text-dim);font-weight:400">${deals.length} deals · ${fmtMoney(total)}</span></div>
      <div>${!deals.length
        ? '<div class="fu-empty" style="color:var(--text-dim);font-size:11px;padding:8px 0;opacity:0.7">No deals yet — use <span style="color:var(--gold)">/pipeline</span> to start tracking</div>'
        : deals.map(d => {
            const due = d.due_date ? new Date(d.due_date) : null
            if (due) due.setHours(0,0,0,0)
            const overdue = due && due < today
            return `
              <div class="fu-row">
                <span class="deal-stage-dot ${d.stage || 'lead'}"></span>
                <span class="fu-person">${escapeHtml(d.person)}</span>
                <span class="fu-topic" style="flex:1">${escapeHtml(d.next_action || d.product)}</span>
                ${d.amount ? `<span class="fu-due">${fmtMoney(d.amount)}</span>` : ''}
                ${due ? `<span class="fu-due${overdue ? ' overdue' : ''}">${overdue ? '⚠ ' : ''}${due.toLocaleDateString('en-US',{month:'numeric',day:'numeric'})}</span>` : ''}
              </div>`}).join('')}
      </div>`
  }
}
