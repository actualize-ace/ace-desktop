// renderer/widgets/followups.js
function escapeHtml(str) {
  return String(str ?? '').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;')
}

export default {
  id: 'followups',
  label: 'Follow-ups',
  description: 'Active follow-ups from follow-ups.md',
  dataSource: 'getFollowUps',
  defaultEnabled: true,

  render(data, el) {
    const items = Array.isArray(data) ? data : []
    const today = new Date(); today.setHours(0,0,0,0)
    const parse = s => { const d = new Date(s); d.setHours(0,0,0,0); return d }

    const overdue  = items.filter(f => f.due && parse(f.due) < today  && (f.status||'').toLowerCase() !== 'done')
    const upcoming = items.filter(f => !overdue.includes(f)           && (f.status||'').toLowerCase() !== 'done')

    const renderRows = arr => arr.slice(0, 5).map(f => {
      const d = f.due ? parse(f.due) : null
      return `<div class="fu-row">
        <span class="fu-person">${escapeHtml(f.person)}</span>
        <span class="fu-topic" style="flex:1">${escapeHtml(f.topic)}</span>
        ${d ? `<span class="fu-due">${d.toLocaleDateString('en-US',{month:'numeric',day:'numeric'})}</span>` : ''}
      </div>`
    }).join('')

    el.innerHTML = `
      <div class="section-label">Follow-ups <span style="color:var(--text-dim);font-weight:400">${items.length} open${overdue.length ? ` · <span style="color:var(--red)">${overdue.length} overdue</span>` : ''}</span></div>
      <div>
        ${overdue.length ? `<div class="fu-section-label overdue">Overdue</div>${renderRows(overdue)}` : ''}
        ${upcoming.length ? renderRows(upcoming) : ''}
        ${!items.length ? '<div class="fu-empty">All clear.</div>' : ''}
      </div>`
  }
}
