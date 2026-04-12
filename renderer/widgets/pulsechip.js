// renderer/widgets/pulsechip.js
// Pulse freshness chip — sits under the orb. Shows "pulsed Xh ago" and
// turns amber/red as data ages. Click routes to terminal + runs /pulse.

function formatAgo(h) {
  if (h == null) return 'never pulsed'
  if (h <= 0)    return 'pulsed now'
  if (h < 1)     return 'pulsed <1h ago'
  if (h === 1)   return 'pulsed 1h ago'
  if (h < 24)    return `pulsed ${h}h ago`
  const days = Math.round(h / 24)
  return `pulsed ${days}d ago`
}

function freshnessClass(h) {
  if (h == null) return 'stale'
  if (h <= 24)   return 'fresh'     // green
  if (h <= 72)   return 'aging'     // amber
  return 'stale'                     // red
}

export default {
  id: 'pulsechip',
  label: 'Pulse Freshness',
  description: 'Last /pulse timestamp + re-run',
  dataSource: null,
  defaultEnabled: true,

  render(allData, el) {
    const lp = allData.lastPulse || {}
    const cls = freshnessClass(lp.hoursAgo)
    const txt = formatAgo(lp.hoursAgo)

    el.innerHTML = `
      <button class="pulse-chip ${cls}" title="Click to run /pulse in terminal">
        <span class="pulse-dot"></span>
        <span class="pulse-text">${txt}</span>
        <span class="pulse-refresh">↻</span>
      </button>`

    el.querySelector('.pulse-chip')?.addEventListener('click', () => {
      runPulse()
    })
  },
}

function runPulse() {
  // Route to terminal, spawn session, send /pulse
  document.querySelector('.nav-item[data-view="terminal"]')?.click()
  setTimeout(() => {
    if (window.spawnSession) window.spawnSession()
    setTimeout(() => {
      const st = window.__aceState
      if (st?.activeId && window.sendChatMessage) {
        window.sendChatMessage(st.activeId, '/pulse')
      } else if (window.sendToActive) {
        window.sendToActive('/pulse\r')
      }
    }, 200)
  }, 150)
}
