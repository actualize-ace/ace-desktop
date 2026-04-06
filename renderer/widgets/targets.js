// renderer/widgets/targets.js
function escapeHtml(str) {
  return String(str ?? '').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;')
}

export default {
  id: 'targets',
  label: 'This Week',
  description: 'Weekly targets from active.md',
  dataSource: 'getState',
  defaultEnabled: true,

  render(data, el) {
    const targets = data?.weeklyTargets || []
    if (!targets.length) {
      el.innerHTML = '<div style="font-size:11px;color:var(--text-dim);padding:8px 0;opacity:0.7">No targets this week — set them in <span style="color:var(--gold)">active.md</span></div>'
      return
    }
    const sorted = [...targets.filter(t => !t.checked), ...targets.filter(t => t.checked)]
    el.innerHTML = `
      <div class="section-label">This Week</div>
      <div>${sorted.map(t => `
        <div class="target-row dash-clickable" data-cmd="What's the latest on this weekly target: ${escapeHtml(t.text)}">
          <span class="target-check${t.checked ? ' done' : ''}"></span>
          <span class="target-text${t.checked ? ' done' : ''}">${escapeHtml(t.text)}</span>
        </div>`).join('')}
      </div>`
  }
}
