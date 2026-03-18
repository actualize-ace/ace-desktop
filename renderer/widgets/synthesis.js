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

    const label =
      context.coherenceScore >= 15 ? 'coherent'   :
      context.coherenceScore >= 11 ? 'stable'     :
      context.coherenceScore >= 7  ? 'drifting'   :
      context.coherenceScore >= 4  ? 'fragmented' : 'critical'

    // Inject orb styles once
    if (!document.getElementById('orb-styles')) {
      const s = document.createElement('style')
      s.id = 'orb-styles'
      s.textContent = `
        .coherence-orb {
          width: 68px; height: 68px; border-radius: 50%; flex-shrink: 0;
          display: flex; flex-direction: column; align-items: center; justify-content: center;
          animation: orb-pulse 3.5s ease-in-out infinite; cursor: default;
          transition: box-shadow 0.6s ease;
        }
        .orb-score  { font-size: 20px; font-weight: 600; line-height: 1; letter-spacing: -0.02em; }
        .orb-label  { font-size: 7px; letter-spacing: 0.12em; text-transform: uppercase; opacity: 0.75; margin-top: 2px; }
        .orb-coherent   { background: radial-gradient(circle at 35% 30%, #a8f0c0, #3a8e5e);
                          box-shadow: 0 0 18px rgba(109,184,143,0.7), 0 0 40px rgba(109,184,143,0.3); color: #fff; }
        .orb-stable     { background: radial-gradient(circle at 35% 30%, #f5d090, #c4842a);
                          box-shadow: 0 0 18px rgba(212,165,116,0.7), 0 0 38px rgba(212,165,116,0.3); color: #fff; }
        .orb-drifting   { background: radial-gradient(circle at 35% 30%, #f0e070, #a89020);
                          box-shadow: 0 0 16px rgba(200,180,60,0.6), 0 0 34px rgba(200,180,60,0.25); color: #2a2000; }
        .orb-fragmented { background: radial-gradient(circle at 35% 30%, #f0a060, #b04010);
                          box-shadow: 0 0 18px rgba(196,112,60,0.65), 0 0 38px rgba(196,112,60,0.25); color: #fff; }
        .orb-critical   { background: radial-gradient(circle at 35% 30%, #f07070, #a01010);
                          box-shadow: 0 0 22px rgba(196,60,60,0.8), 0 0 50px rgba(196,60,60,0.4); color: #fff;
                          animation: orb-pulse-critical 1.8s ease-in-out infinite; }
        @keyframes orb-pulse {
          0%, 100% { transform: scale(1);    filter: brightness(1); }
          50%       { transform: scale(1.05); filter: brightness(1.18); }
        }
        @keyframes orb-pulse-critical {
          0%, 100% { transform: scale(1);    filter: brightness(1); }
          50%       { transform: scale(1.08); filter: brightness(1.3); }
        }
      `
      document.head.appendChild(s)
    }

    el.innerHTML = `
      <div class="synthesis-bar">
        <div class="coherence-orb orb-${label}">
          <span class="orb-score">${context.coherenceScore}</span>
          <span class="orb-label">${label}</span>
        </div>
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
