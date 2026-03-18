// renderer/widgets/targets.js
export default {
  id: 'targets',
  label: 'This Week',
  description: 'Weekly targets from active.md',
  dataSource: 'getState',
  defaultEnabled: true,

  render(data, el) {
    const targets = data?.weeklyTargets || []
    if (!targets.length) {
      el.innerHTML = '<div style="font-size:10px;color:var(--text-dim)">No targets set.</div>'
      return
    }
    const sorted = [...targets.filter(t => !t.checked), ...targets.filter(t => t.checked)]
    el.innerHTML = `
      <div class="section-label">This Week</div>
      <div>${sorted.map(t => `
        <div class="target-row">
          <span class="target-check${t.checked ? ' done' : ''}"></span>
          <span class="target-text${t.checked ? ' done' : ''}">${t.text}</span>
        </div>`).join('')}
      </div>`
  }
}
