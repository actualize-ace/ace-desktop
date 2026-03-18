// renderer/widgets/synthesis.js
// Special widget: always first. Receives ALL data (not a single dataSource).
// Renders structural health instantly, then replaces with AI brief async.
export default {
  id: 'synthesis',
  label: 'System Intelligence',
  description: 'Live AI synthesis of your system state',
  dataSource: null,   // receives allData object — handled specially by orchestrator
  defaultEnabled: true,

  render(allData, el) {
    const context = this._buildContext(allData)
    const structural = this._buildStructural(context)

    el.innerHTML = `
      <div class="synthesis-bar">
        <div class="synthesis-icon">◎</div>
        <div class="synthesis-text" id="synthesis-text">${structural}</div>
      </div>`

    // Async AI layer — replaces structural summary when it arrives
    if (window.ace?.dash?.getSynthesisAI) {
      window.ace.dash.getSynthesisAI(context).then(ai => {
        if (!ai) return
        const textEl = document.getElementById('synthesis-text')
        if (!textEl) return
        textEl.style.opacity = '0'
        textEl.style.transition = 'opacity 0.4s'
        setTimeout(() => {
          textEl.textContent = ai
          textEl.style.opacity = '1'
        }, 400)
      }).catch(() => {})
    }
  },

  _buildContext(allData) {
    const { state, metrics, pipeline, followUps, velocity } = allData || {}
    const signals = (metrics && metrics._signals) ? metrics._signals : Array(9).fill('dim')
    const scoreMap = { green: 2, yellow: 1, red: 0, dim: 0 }
    const coherenceScore = signals.reduce((sum, c) => sum + (scoreMap[c] || 0), 0)

    const today = new Date(); today.setHours(0, 0, 0, 0)
    const byDay = velocity?.byDay || {}
    let daysSinceExecution = 0
    for (let i = 0; i < 14; i++) {
      const d = new Date(); d.setDate(d.getDate() - i)
      const key = d.toISOString().slice(0, 10)
      if ((byDay[key] || 0) > 0) break
      daysSinceExecution = i + 1
    }

    const fuArr = Array.isArray(followUps) ? followUps : []
    const overdueFu = fuArr.filter(f => {
      if (!f.due) return false
      const d = new Date(f.due); d.setHours(0, 0, 0, 0)
      return d < today && (f.status || '').toLowerCase() !== 'done'
    }).length

    return {
      coherenceScore,
      signals,
      mode:    state?.mode    || '',
      energy:  state?.energy  || '',
      outcomes: (state?.outcomes || []).map(o => ({ title: o.title, status: o.status })),
      targets: {
        done:  (state?.weeklyTargets || []).filter(t => t.checked).length,
        total: (state?.weeklyTargets || []).length,
      },
      pipeline: {
        count: (pipeline || []).length,
        value: (pipeline || []).reduce((s, d) => s + (d.amount || 0), 0),
      },
      velocity: {
        thisWeek: velocity?.totalThisWeek || 0,
        lastWeek: velocity?.totalLastWeek || 0,
      },
      overdueFu,
      daysSinceExecution,
    }
  },

  _buildStructural(ctx) {
    const label =
      ctx.coherenceScore >= 15 ? 'COHERENT'   :
      ctx.coherenceScore >= 11 ? 'STABLE'     :
      ctx.coherenceScore >= 7  ? 'DRIFTING'   :
      ctx.coherenceScore >= 4  ? 'FRAGMENTED' : 'CRITICAL'

    const keys   = ['A1','A2','A3','C1','C2','C3','E1','E2','E3']
    const red    = ctx.signals.map((c, i) => c === 'red'    ? keys[i] : null).filter(Boolean)
    const yellow = ctx.signals.map((c, i) => c === 'yellow' ? keys[i] : null).filter(Boolean)
    const parts  = [`Coherence ${ctx.coherenceScore}/18 — ${label}.`]

    if (red.length)                  parts.push(`${red.join(', ')} RED.`)
    if (yellow.length)               parts.push(`${yellow.slice(0, 2).join(', ')} YELLOW.`)
    if (ctx.overdueFu > 0)           parts.push(`${ctx.overdueFu} overdue follow-up${ctx.overdueFu > 1 ? 's' : ''}.`)
    if (ctx.daysSinceExecution >= 2) parts.push(`${ctx.daysSinceExecution}d execution gap.`)

    return parts.join(' ')
  }
}
