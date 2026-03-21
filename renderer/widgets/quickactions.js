// renderer/widgets/quickactions.js
export default {
  id: 'quickactions',
  label: 'Quick Actions',
  description: 'Contextual command suggestions',
  dataSource: null,
  defaultEnabled: true,

  render(allData, el) {
    const suggestions = this._buildSuggestions(allData)
    const top4 = suggestions.slice(0, 4)

    el.innerHTML = `
      <div class="section-label">Suggested</div>
      <div class="quick-cmds">
        ${top4.map(s => `
          <div class="qcmd" data-cmd="${s.cmd}">
            <div class="qcmd-icon">${s.icon}</div>
            <div class="qcmd-label">${s.cmd}</div>
            <div class="qcmd-reason">${s.reason}</div>
          </div>
        `).join('')}
      </div>`

    // Wire click handlers — reuse existing data-cmd handler
    el.querySelectorAll('.qcmd[data-cmd]').forEach(qcmd => {
      qcmd.addEventListener('click', () => {
        document.querySelector('.nav-item[data-view="terminal"]').click()
        setTimeout(() => {
          if (typeof sendToActive === 'function') sendToActive(qcmd.dataset.cmd + '\r')
        }, 120)
      })
    })
  },

  _buildSuggestions(allData) {
    const hour = new Date().getHours()
    const dayOfWeek = new Date().getDay() // 0=Sun
    const { state, followUps, velocity, rhythm } = allData || {}

    // Check if rituals ran today
    const todayDate = new Date().toISOString().slice(0, 10)
    const todayRhythm = rhythm?.week?.find(w => w.date === todayDate)
    const startRan = todayRhythm?.start || false
    const eodRan = todayRhythm?.eod || false

    // Follow-up counts
    const today = new Date(); today.setHours(0, 0, 0, 0)
    const fuArr = Array.isArray(followUps) ? followUps : []
    const overdueFu = fuArr.filter(f => {
      if (!f.due) return false
      const d = new Date(f.due); d.setHours(0, 0, 0, 0)
      return d < today && (f.status || '').toLowerCase() !== 'done'
    }).length

    // Days since pulse
    const daysSincePulse = state?.daysSincePulse ?? -1

    // Open failures
    const failures = state?.failures?.length || 0

    // Build priority queue
    const queue = []

    // Morning + no /start
    if (hour < 12 && !startRan) queue.push({ cmd: '/start', icon: '\u2600', reason: 'Morning ritual', priority: 10 })
    // Evening + no /eod
    if (hour >= 17 && !eodRan) queue.push({ cmd: '/eod', icon: '\u25d0', reason: 'Close your day', priority: 10 })
    // Overdue follow-ups
    if (overdueFu > 0) queue.push({ cmd: '/followup', icon: '\u260e', reason: `${overdueFu} overdue`, priority: 7 })
    // Pulse stale
    if (daysSincePulse > 5 || daysSincePulse === -1) queue.push({ cmd: '/pulse', icon: '\u25ce', reason: daysSincePulse === -1 ? 'Never pulsed' : `${daysSincePulse}d ago`, priority: 6 })
    // Open failures
    if (failures > 0) queue.push({ cmd: '/triage', icon: '\u26a0', reason: `${failures} open`, priority: 5 })
    // Midday brief
    if (hour >= 12 && hour < 17) queue.push({ cmd: '/brief', icon: '\u26a1', reason: 'Midday check', priority: 4 })
    // Friday/Saturday → weekly review
    if (dayOfWeek === 5 || dayOfWeek === 6) queue.push({ cmd: '/weekly-review', icon: '\u2b50', reason: 'End of week', priority: 3 })
    // Coach suggestion
    queue.push({ cmd: '/coach', icon: '\u2661', reason: 'Coaching session', priority: 2 })

    // Fallback defaults
    if (queue.length < 4) {
      const defaults = [
        { cmd: '/start', icon: '\u2600', reason: 'Begin your day', priority: 1 },
        { cmd: '/brief', icon: '\u26a1', reason: 'Quick overview', priority: 1 },
        { cmd: '/pulse', icon: '\u25ce', reason: 'Health check', priority: 1 },
        { cmd: '/eod', icon: '\u25d0', reason: 'End of day', priority: 1 },
      ]
      for (const d of defaults) {
        if (!queue.find(q => q.cmd === d.cmd)) queue.push(d)
      }
    }

    // Sort by priority desc, deduplicate by cmd
    queue.sort((a, b) => b.priority - a.priority)
    const seen = new Set()
    return queue.filter(q => { if (seen.has(q.cmd)) return false; seen.add(q.cmd); return true })
  }
}
