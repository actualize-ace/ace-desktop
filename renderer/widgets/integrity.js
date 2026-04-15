// renderer/widgets/integrity.js
// System Integrity bar — sits between brain row and flow row.
// Always visible. Collapses to a thin line when healthy, expands with
// regeneration call-out when signals drop or pulse is stale.

const SIGNAL_NAMES = {
  A1: 'Truth', A2: 'Choice', A3: 'Expression',
  C1: 'Regulation', C2: 'Depth', C3: 'Resilience',
  E1: 'Rhythm', E2: 'Containers', E3: 'Realization',
}
const SIGNAL_KEYS = ['A1','A2','A3','C1','C2','C3','E1','E2','E3']

// Map signal red/yellow → recommended regeneration skill + estimated minutes
const REGEN_MAP = {
  A1: { skill: '/coach',        label: 'truth work',              minutes: 15 },
  A2: { skill: '/decide',       label: 'decision clarity',        minutes: 10 },
  A3: { skill: '/ghostwrite',   label: 'expression unlock',       minutes: 20 },
  C1: { skill: '/regulate',     label: 'nervous system reset',    minutes: 8 },
  C2: { skill: '/edge',         label: 'growth edge inquiry',     minutes: 15 },
  C3: { skill: '/audit-energy', label: 'boundary + energy audit', minutes: 12 },
  E1: { skill: '/audit-energy', label: 'cadence audit',           minutes: 10 },
  E2: { skill: '/weekly-review',label: 'container reset',         minutes: 20 },
  E3: { skill: '/blind-spots',        label: 'surface realization blockers', minutes: 15 },
}

function escapeAttr(s) {
  return String(s || '').replace(/"/g, '&quot;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
}

export default {
  id: 'integrity',
  label: 'System Integrity',
  description: 'Pulse freshness + regeneration dispatcher',
  dataSource: null,
  defaultEnabled: true,

  render(allData, el) {
    const signals = allData.metrics?._signals || []
    const greens = signals.filter(s => s === 'green').length
    const yellows = signals.filter(s => s === 'yellow').length
    const reds = signals.filter(s => s === 'red').length
    const lp = allData.lastPulse || {}
    const pulseHours = lp.hoursAgo

    // Integrity tier
    const pulseStale = pulseHours != null && pulseHours > 72
    const hasReds = reds > 0
    const hasYellows = yellows >= 3
    const depleted = allData.state?.energy === 'depleted'
    const recoveryFlag = allData.state?.recovery_flag === true

    let tier = 'stable'
    if (hasReds || depleted || recoveryFlag) tier = 'critical'
    else if (hasYellows || pulseStale)       tier = 'watch'

    // Find the highest-priority regen target
    const regen = this._pickRegen(signals, depleted, recoveryFlag, pulseStale)

    const pulseLabel = pulseHours == null ? 'never pulsed'
      : pulseHours < 1 ? 'pulsed just now'
      : pulseHours < 24 ? `pulsed ${pulseHours}h ago`
      : `pulsed ${Math.round(pulseHours / 24)}d ago`

    const scoreLine = `${greens}/9 green${yellows ? ` · ${yellows} yellow` : ''}${reds ? ` · ${reds} red` : ''}`

    if (tier === 'stable') {
      // Collapsed single-line state
      el.innerHTML = `
        <div class="integrity-bar integrity-${tier}">
          <span class="integrity-pip"></span>
          <span class="integrity-label">system integrity</span>
          <span class="integrity-meta">${scoreLine} · ${pulseLabel}</span>
        </div>`
      return
    }

    // Expanded state with regeneration call-out
    el.innerHTML = `
      <div class="integrity-bar integrity-${tier}">
        <div class="integrity-head">
          <span class="integrity-pip"></span>
          <span class="integrity-label">system integrity · ${tier}</span>
          <span class="integrity-meta">${scoreLine} · ${pulseLabel}</span>
        </div>
        ${regen ? `
        <div class="integrity-regen">
          <div class="integrity-regen-text">
            <span class="integrity-regen-cause">${escapeAttr(regen.cause)}</span>
            <span class="integrity-regen-arrow">→</span>
            <span class="integrity-regen-skill">${escapeAttr(regen.skill)}</span>
            <span class="integrity-regen-desc">${escapeAttr(regen.label)} · ~${regen.minutes} min</span>
          </div>
          <button class="integrity-regen-btn" data-skill="${escapeAttr(regen.skill)}">Run in terminal</button>
        </div>` : ''}
      </div>`

    el.querySelector('.integrity-regen-btn')?.addEventListener('click', (e) => {
      const cmd = e.currentTarget.dataset.skill
      if (!cmd) return
      document.querySelector('.nav-item[data-view="terminal"]')?.click()
      setTimeout(() => {
        if (window.spawnSession) window.spawnSession()
        setTimeout(() => {
          const st = window.__aceState
          if (st?.activeId && window.sendChatMessage) {
            window.sendChatMessage(st.activeId, cmd)
          } else if (window.sendToActive) {
            window.sendToActive(cmd + '\r')
          }
        }, 200)
      }, 150)
    })
  },

  _pickRegen(signals, depleted, recoveryFlag, pulseStale) {
    // Stale pulse comes first if severe — data is lying
    if (pulseStale) {
      return {
        cause: 'pulse data stale',
        skill: '/pulse',
        label: 'refresh the signal reading',
        minutes: 3,
      }
    }
    // Recovery flag > depletion > red signals > yellow signals
    if (recoveryFlag) {
      return {
        cause: 'recovery flagged',
        skill: '/regulate',
        label: 'honor the recovery window',
        minutes: 10,
      }
    }
    if (depleted) {
      return {
        cause: 'energy depleted',
        skill: '/audit-energy',
        label: 'find what to release today',
        minutes: 12,
      }
    }
    // Find first red, then first yellow
    for (let i = 0; i < 9; i++) {
      if (signals[i] === 'red') {
        const k = SIGNAL_KEYS[i]
        const r = REGEN_MAP[k]
        return { cause: `${k} ${SIGNAL_NAMES[k]} red`, ...r }
      }
    }
    for (let i = 0; i < 9; i++) {
      if (signals[i] === 'yellow') {
        const k = SIGNAL_KEYS[i]
        const r = REGEN_MAP[k]
        return { cause: `${k} ${SIGNAL_NAMES[k]} yellow`, ...r }
      }
    }
    return null
  },
}
