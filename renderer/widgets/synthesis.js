// renderer/widgets/synthesis.js
// Command Center: coherence state + momentum/attention zones + view switcher
import { escapeHtml } from '../modules/chat-renderer.js'

const SIGNAL_NAMES = {
  A1: 'Truth', A2: 'Choice', A3: 'Expression',
  C1: 'Regulation', C2: 'Depth', C3: 'Resilience',
  E1: 'Rhythm', E2: 'Containers', E3: 'Realization',
}

export default {
  id: 'synthesis',
  label: 'Command Center',
  description: 'Intelligence deck \u2014 system state + next actions',
  dataSource: null,
  defaultEnabled: true,

  render(allData, el) {
    const ctx = this._buildContext(allData)
    this._lastCtx = ctx // stash for Inner Move widget (_buildCoachingPrompt)
    const narrative = this._buildCockpitNarrative(ctx, allData)

    const signalKeys = ['A1','A2','A3','C1','C2','C3','E1','E2','E3']

    const affirmations = allData.northStar?.affirmations || []
    const initialAff = affirmations[0] || ''

    const sig = (i) => ctx.signals[i] || 'dim'
    const dotHtml = (i) => `<div class="cockpit-signal-dot ${sig(i)}" title="${signalKeys[i]}: ${SIGNAL_NAMES[signalKeys[i]]}"></div>`

    // Risen leg indicator + energy replaces the static operating-mode pill
    const risenLeg = allData._risenLeg
    const risenLabel = risenLeg ? `${risenLeg} rising` : 'in flow'
    const energyTag = ctx.energy ? `energy ${ctx.energy}` : ''
    const risenTitle = risenLeg ? 'Click: why this leg is rising' : 'Coherence in flow'

    el.innerHTML = `
      <div class="cockpit-synthesis">
        <div class="cockpit-synthesis-line" id="cc-synthesis-text">${narrative}</div>
        <div class="cockpit-synthesis-signals">
          <div class="cockpit-signal-cluster" data-leg="A">${dotHtml(0)}${dotHtml(1)}${dotHtml(2)}</div>
          <div class="cockpit-signal-cluster" data-leg="C">${dotHtml(3)}${dotHtml(4)}${dotHtml(5)}</div>
          <div class="cockpit-signal-cluster" data-leg="E">${dotHtml(6)}${dotHtml(7)}${dotHtml(8)}</div>
        </div>
        <div class="cockpit-synthesis-mode">
          <span class="tag ${risenLeg ? 'clickable-pill' : ''}" data-action="risen-why" title="${risenTitle}">${escapeHtml(risenLabel)}</span>
          ${energyTag ? `<span class="tag energy">${escapeHtml(energyTag)}</span>` : ''}
        </div>
        <div class="cockpit-affirmation" id="cc-affirmation">${escapeHtml(initialAff)}</div>
      </div>`

    // Signal cluster click → terminal (coaching)
    el.querySelectorAll('.cockpit-signal-cluster').forEach(c => {
      c.addEventListener('click', () => {
        document.querySelector('.nav-item[data-view="terminal"]')?.click()
      })
    })

    // Risen-leg pill click → explain why this leg is rising
    el.querySelector('[data-action="risen-why"]')?.addEventListener('click', () => {
      if (!risenLeg) return
      showRisenWhyOverlay(risenLeg, allData, ctx)
    })

    // Affirmation rotation (every 11s)
    if (affirmations.length > 1) {
      let idx = 0
      if (this._affInterval) clearInterval(this._affInterval)
      this._affInterval = setInterval(() => {
        const affEl = document.getElementById('cc-affirmation')
        if (!affEl) { clearInterval(this._affInterval); return }
        affEl.style.opacity = '0'
        setTimeout(() => {
          idx = (idx + 1) % affirmations.length
          affEl.textContent = affirmations[idx]
          affEl.style.opacity = '0.75'
        }, 1500)
      }, 11000)
    }

    // Async AI layer — updates synthesis-line when ready
    this._fetchAI(ctx, allData, el, [])
  },

  _stateLabel(score) {
    if (score >= 15) return 'coherent'
    if (score >= 11) return 'stable'
    if (score >= 7)  return 'drifting'
    if (score >= 4)  return 'fragmented'
    return 'critical'
  },

  _buildMomentum(ctx) {
    const chips = []

    // Targets progress
    if (ctx.targets.total > 0 && ctx.targets.done > 0) {
      chips.push({ icon: '\u2713', text: `${ctx.targets.done}/${ctx.targets.total} targets done` })
    }

    // Velocity trend
    if (ctx.velocity.thisWeek > 0) {
      if (ctx.velocity.lastWeek > 0) {
        const pct = Math.round(((ctx.velocity.thisWeek - ctx.velocity.lastWeek) / ctx.velocity.lastWeek) * 100)
        if (pct > 0) chips.push({ icon: '\u2191', text: `Velocity up ${pct}%` })
        else if (pct === 0) chips.push({ icon: '\u2192', text: 'Velocity steady' })
      } else {
        chips.push({ icon: '\u2191', text: `${ctx.velocity.thisWeek} items this week` })
      }
    }

    // On-track outcomes
    const onTrack = ctx.outcomes.filter(o => o.status === 'ON TRACK').length
    if (onTrack > 0) {
      chips.push({ icon: '\u25cf', text: `${onTrack} outcome${onTrack > 1 ? 's' : ''} on track` })
    }

    // Green signals count
    const greenCount = ctx.signals.filter(s => s === 'green').length
    if (greenCount >= 7) {
      chips.push({ icon: '\u25c9', text: `${greenCount}/9 signals green` })
    }

    return chips
  },

  _renderNowView(momentum, priorities, viewIdx) {
    const dismissed = this._getDismissed()
    const active = priorities.filter(p => !dismissed.includes(p.label))
    const idx = viewIdx || 0

    // Momentum zone
    let momentumHtml = ''
    if (momentum.length > 0) {
      momentumHtml = `<div class="cc-momentum">${momentum.map(m =>
        `<div class="cc-momentum-chip"><span class="chip-icon">${m.icon}</span>${escapeHtml(m.text)}</div>`
      ).join('')}</div>`
    } else {
      momentumHtml = `<div class="cc-momentum-nudge">Run <span>/start</span> to begin your day and activate your system.</div>`
    }

    // Next Move zone — featured item with nav + queue
    let nextMoveHtml = ''
    if (active.length > 0) {
      const currentIdx = Math.min(idx, active.length - 1)
      const current = active[currentIdx]
      const queue = active.slice(currentIdx + 1, currentIdx + 4)
      const expanded = this._buildExpandedInfo(current)
      const typeLabel = this._nextMoveTypeLabel(current.type)

      nextMoveHtml = `<div class="cc-nextmove">
        <div class="cc-nextmove-featured">
          <div class="cc-nextmove-header">
            <div class="cc-nextup-dot ${current.urgency}"></div>
            <span class="cc-nextmove-badge">Next Move</span>
            ${typeLabel ? `<span class="cc-nextmove-type">${escapeHtml(typeLabel)}</span>` : ''}
            ${active.length > 1 ? `
              <div class="cc-nextmove-nav">
                ${dismissed.length > 0 ? `<span class="cc-nextmove-skipped" title="Click to reset">${dismissed.length} skipped</span>` : ''}
                <button class="cc-nextmove-prev" ${currentIdx === 0 ? 'disabled' : ''} title="Previous">&#8249;</button>
                <span class="cc-nextmove-pos">${currentIdx + 1}/${active.length}</span>
                <button class="cc-nextmove-next" ${currentIdx >= active.length - 1 ? 'disabled' : ''} title="Next">&#8250;</button>
              </div>
            ` : ''}
          </div>
          <div class="cc-nextmove-label">${escapeHtml(current.label)}</div>
          <div class="cc-nextmove-context">${escapeHtml(current.context)}</div>
          ${expanded ? `
            <div class="cc-nextmove-expand-toggle">
              <span class="cc-nextmove-expand-icon">&#9662;</span> Details
            </div>
            <div class="cc-nextmove-expanded" style="display:none">${expanded}</div>
          ` : ''}
          <div class="cc-nextmove-actions">
            <button class="cc-nextmove-agree">Agree</button>
            <button class="cc-nextmove-ask">Ask Oracle</button>
            <button class="cc-nextmove-skip">Skip</button>
          </div>
          ${queue.length > 0 ? `<div class="cc-nextmove-queue">
            ${queue.map((q, qi) => {
              const tip = this._buildQueueTooltip(q)
              return `
              <div class="cc-nextmove-queue-row" data-queue-idx="${qi}" ${tip ? `title="${escapeHtml(tip)}"` : ''}>
                <div class="cc-nextup-dot small ${q.urgency}"></div>
                <span class="cc-nextmove-queue-label">${escapeHtml(q.label)}</span>
                <span class="cc-nextmove-queue-context">${escapeHtml(q.context)}</span>
              </div>`}).join('')}
          </div>` : ''}
        </div>
      </div>`
    } else {
      nextMoveHtml = `<div class="cc-nextup"><div class="cc-nextup-empty">No urgent items \u2014 your system is clean.${dismissed.length > 0 ? ' <span class="cc-nextmove-reset">Reset skipped</span>' : ''}</div></div>`
    }

    // Inner Move zone — pattern-aware coaching prompt
    const coaching = this._buildCoachingPrompt ? this._buildCoachingPrompt(this._lastCtx) : null
    let innerMoveHtml = ''
    if (coaching) {
      const pat = coaching.pattern
      const ten = coaching.tension
      innerMoveHtml = `<div class="cc-innermove-featured" style="--innermove-accent: ${coaching.accent}">
        <div class="cc-innermove-header">
          <span class="cc-innermove-badge">Inner Move</span>
          <span class="cc-innermove-skill">${escapeHtml(coaching.skill)}</span>
        </div>
        ${pat ? `<div class="cc-innermove-pattern">
          <span class="cc-innermove-pattern-name">${escapeHtml(pat.name)}</span>
          <span class="cc-innermove-pattern-count">${pat.count}<span class="cc-innermove-trend">${pat.trend === '^' ? '\u2191' : pat.trend === 'v' ? '\u2193' : '\u2022'}</span></span>
        </div>` : ''}
        <div class="cc-innermove-prompt">${escapeHtml(coaching.prompt)}</div>
        ${pat && pat.description ? `<div class="cc-innermove-desc">${escapeHtml(pat.description)}</div>` : ''}
        ${ten ? `<div class="cc-innermove-tension">tension: ${escapeHtml(ten.label)} \u2014 day ${ten.days}</div>` : ''}
        <div class="cc-innermove-actions">
          <button class="cc-innermove-open">Open ${escapeHtml(coaching.skill)}</button>
        </div>
      </div>`
    }

    // Wrap both cards in a row if we have an inner move
    if (innerMoveHtml) {
      return momentumHtml + `<div class="cc-cards-row">
        <div class="cc-nextmove-card">${nextMoveHtml}</div>
        ${innerMoveHtml}
      </div>`
    }
    return momentumHtml + nextMoveHtml
  },

  _nextMoveTypeLabel(type) {
    const labels = {
      followup: 'follow-up', outcome: 'outcome', pipeline: 'deal',
      target: 'target', cadence: 'ritual',
    }
    return labels[type] || ''
  },

  _buildExpandedInfo(move) {
    const rows = []
    if (move._raw) {
      if (move._raw.person) rows.push({ label: 'Person', value: move._raw.person })
      if (move._raw.topic && move._raw.topic !== 'general') rows.push({ label: 'Topic', value: move._raw.topic })
      if (move._raw.due) rows.push({ label: 'Due date', value: move._raw.due })
      if (move._raw.amount) {
        const fmt = move._raw.amount >= 1000 ? `$${Math.round(move._raw.amount/1000)}K` : `$${Math.round(move._raw.amount)}`
        rows.push({ label: 'Amount', value: fmt })
      }
      if (move._raw.stage) rows.push({ label: 'Stage', value: move._raw.stage })
      if (move._raw.nextAction) rows.push({ label: 'Next action', value: move._raw.nextAction })
      if (move._raw.status) rows.push({ label: 'Status', value: move._raw.status })
      if (move._raw.gateLabel) rows.push({ label: 'Gate', value: move._raw.gateLabel })
    }
    const reasons = {
      followup: 'Overdue follow-up detected', outcome: 'Outcome gate approaching or passed',
      pipeline: 'Pipeline deal needs movement', target: 'Unchecked weekly target',
      cadence: 'Recurring ritual for today',
    }
    if (reasons[move.type]) rows.push({ label: 'Why now', value: reasons[move.type] })
    if (rows.length === 0) return ''
    return `<div class="cc-nextmove-info-grid">${rows.map(r =>
      `<div class="cc-nextmove-info-label">${escapeHtml(r.label)}</div><div class="cc-nextmove-info-value">${escapeHtml(r.value)}</div>`
    ).join('')}</div>`
  },

  _buildQueueTooltip(move) {
    const parts = []
    if (move._raw) {
      if (move._raw.person) parts.push(move._raw.person)
      if (move._raw.topic && move._raw.topic !== 'general') parts.push(move._raw.topic)
      if (move._raw.due) parts.push(`Due: ${move._raw.due}`)
      if (move._raw.stage) parts.push(move._raw.stage)
      if (move._raw.nextAction) parts.push(move._raw.nextAction)
      if (move._raw.status) parts.push(move._raw.status)
      if (move._raw.gateLabel) parts.push(`Gate: ${move._raw.gateLabel}`)
    }
    const reasons = {
      followup: 'Overdue follow-up', outcome: 'Outcome gate', pipeline: 'Pipeline deal',
      target: 'Weekly target', cadence: 'Recurring ritual',
    }
    if (reasons[move.type]) parts.push(reasons[move.type])
    return parts.join(' · ')
  },

  _renderWeekView(ctx) {
    const targets = ctx.targets.items || []

    if (targets.length === 0) {
      return `<div class="cc-week-list"><div class="cc-momentum-nudge">Set your weekly targets in <span>active.md</span> under <span>**This Week**</span>.</div></div>`
    }

    const pct = ctx.targets.total > 0 ? Math.round((ctx.targets.done / ctx.targets.total) * 100) : 0
    const sorted = [...targets.filter(t => !t.checked), ...targets.filter(t => t.checked)]

    return `
      <div class="cc-week-progress">
        <span>${ctx.targets.done}/${ctx.targets.total} complete</span>
        <div class="cc-week-bar"><div class="cc-week-bar-fill" style="width:${pct}%"></div></div>
        <span>${pct}%</span>
      </div>
      <div class="cc-week-list">${sorted.map(t => `
        <div class="cc-week-row">
          <div class="cc-week-check${t.checked ? ' done' : ''}"></div>
          <span class="cc-week-text${t.checked ? ' done' : ''}">${escapeHtml(t.text)}</span>
        </div>`).join('')}
      </div>`
  },

  _renderSignalsView(ctx) {
    const keys = ['A1','A2','A3','C1','C2','C3','E1','E2','E3']
    const legs = ['Authority', 'Authority', 'Authority', 'Capacity', 'Capacity', 'Capacity', 'Expansion', 'Expansion', 'Expansion']
    const allDim = ctx.signals.every(s => s === 'dim')

    if (allDim) {
      return `<div class="cc-signals-detail"><div class="cc-momentum-nudge">Run <span>/pulse</span> to activate your 9 health signals.</div></div>`
    }

    return `<div class="cc-signals-detail">${keys.map((key, i) => {
      const color = ctx.signals[i] || 'dim'
      const statusLabel = { green: 'GREEN', yellow: 'YELLOW', red: 'RED', dim: '\u2014' }[color] || '\u2014'
      return `
        <div class="cc-signal-row cc-signal-clickable" data-signal-key="${key}" data-signal-name="${SIGNAL_NAMES[key]}" data-signal-leg="${legs[i]}" data-signal-status="${statusLabel}">
          <div class="cc-signal-row-dot ${color}"></div>
          <span class="cc-signal-row-key">${key}</span>
          <span class="cc-signal-row-name">${SIGNAL_NAMES[key]} <span style="color:var(--text-dim);font-size:9px">\u00b7 ${legs[i]}</span></span>
          <span class="cc-signal-row-status ${color}">${statusLabel}</span>
          <span class="cc-nextup-arrow">\u2192</span>
        </div>`
    }).join('')}</div>`
  },

  _wireSignalClicks(el) {
    el.querySelectorAll('.cc-signal-clickable').forEach(row => {
      row.addEventListener('click', () => {
        const key = row.dataset.signalKey
        const name = row.dataset.signalName
        const leg = row.dataset.signalLeg
        const status = row.dataset.signalStatus

        document.querySelector('.nav-item[data-view="terminal"]').click()
        setTimeout(() => {
          if (window.spawnSession) window.spawnSession()
          setTimeout(() => {
            const st = window.__aceState
            if (st?.activeId && st?.sessions) {
              const permsEl = document.getElementById('chat-perms-' + st.activeId)
              if (permsEl) permsEl.value = 'auto'
              const tab = st.sessions[st.activeId]?.tab
              if (tab) {
                const span = tab.querySelector('span:not(.stab-close)')
                if (span) span.textContent = `${key}: ${name}`
              }
              if (window.sendChatMessage) {
                window.sendChatMessage(st.activeId, `My ${key} signal (${name}, under ${leg}) is currently ${status}. Help me understand what's driving this signal and what I can do to strengthen it. Reference the ACE Coherence Triad — ${leg} leg.`)
              }
            }
          }, 200)
        }, 150)
      })
    })
  },

  _wireViewSwitcher(el, ctx, allData, momentum, priorities) {
    el.querySelectorAll('.cc-view-pill').forEach(pill => {
      pill.addEventListener('click', () => {
        el.querySelectorAll('.cc-view-pill').forEach(p => p.classList.remove('active'))
        pill.classList.add('active')
        const view = pill.dataset.view
        const contentEl = document.getElementById('cc-view-content')
        if (!contentEl) return

        contentEl.style.opacity = '0'
        setTimeout(() => {
          if (view === 'now') {
            contentEl.innerHTML = this._renderNowView(momentum, priorities)
            this._wireNextMoveActions(el, priorities, allData, ctx)
          } else if (view === 'week') {
            contentEl.innerHTML = this._renderWeekView(ctx)
          } else if (view === 'signals') {
            contentEl.innerHTML = this._renderSignalsView(ctx)
            this._wireSignalClicks(el)
          }
          contentEl.style.opacity = '1'
        }, 200)
      })
    })
  },

  _buildContext(allData) {
    const { state, metrics, followUps, velocity, patterns } = allData || {}
    const signals = metrics?._signals || Array(9).fill('dim')
    const scoreMap = { green: 2, yellow: 1, red: 0, dim: 0 }
    const coherenceScore = signals.reduce((sum, c) => sum + (scoreMap[c] || 0), 0)

    const today = new Date(); today.setHours(0, 0, 0, 0)
    const byDay = velocity?.byDay || {}
    const todayKey = today.toISOString().slice(0, 10)
    const todaySessions = byDay[todayKey] || 0
    let daysSinceExecution = 0
    for (let i = 0; i < 14; i++) {
      const d = new Date(); d.setDate(d.getDate() - i)
      if ((byDay[d.toISOString().slice(0, 10)] || 0) > 0) break
      daysSinceExecution = i + 1
    }

    const fuArr = Array.isArray(followUps) ? followUps : []
    const overdueFu = fuArr.filter(f => {
      if (!f.due) return false
      const d = new Date(f.due)
      if (isNaN(d.getTime())) return false
      d.setHours(0, 0, 0, 0)
      return d < today && (f.status || '').toLowerCase() !== 'done'
    }).length

    return {
      coherenceScore, signals,
      mode:    state?.mode    || '',
      energy:  state?.energy  || '',
      outcomes: (state?.outcomes || []).map(o => ({ title: o.title, status: o.status, daysToGate: o.daysToGate, gateLabel: o.gateLabel })),
      targets: {
        items: (state?.weeklyTargets || []),
        done:  (state?.weeklyTargets || []).filter(t => t.checked).length,
        total: (state?.weeklyTargets || []).length,
      },
      velocity: {
        thisWeek: velocity?.totalThisWeek || 0,
        lastWeek: velocity?.totalLastWeek || 0,
      },
      overdueFu,
      daysSinceExecution,
      todaySessions,
      patterns: patterns || { counts: [], tensions: [], coOccurrences: [], descriptions: {} },
    }
  },

  // Narrative synthesis for cockpit — warm, human, connected.
  // Writes to the user, not about them. Final emphasized clause carries the invitation.
  _buildCockpitNarrative(ctx, allData) {
    const score = ctx.coherenceScore || 0
    const signals = ctx.signals || []
    const red = signals.filter(s => s === 'red').length
    const yellow = signals.filter(s => s === 'yellow').length
    const risen = allData?._risenLeg
    const weakest = allData?._weakestLeg
    const greens = signals.filter(s => s === 'green').length
    const risenItem = allData?._candidatesByLeg?.[risen]?.[0]

    // Recovery / depletion states — care comes first
    if (ctx.energy === 'depleted') {
      return `Your body's been carrying a lot. <em>Let today be smaller than yesterday.</em>`
    }
    if (allData?.state?.recovery_flag === true) {
      return `You flagged recovery and the system's listening. <em>Honor that choice today.</em>`
    }
    if (red >= 3) {
      return `The signals are asking for your attention before the work. <em>Check in with your body first.</em>`
    }

    // High coherence — name what's working + gentle directional nudge
    if (score >= 15) {
      if (risen === 'authority') {
        const label = risenItem?.label ? ` ${risenItem.label.toLowerCase()}` : ''
        return `You're clear and the field is with you. <em>The next move${label ? ` —${label}` : ''} is ready when you are.</em>`
      }
      if (risen === 'expansion') {
        return `Momentum is real today. <em>Spend it on something that will still matter next week.</em>`
      }
      if (risen === 'capacity') {
        return `You're steady in the container — that's rare. <em>Deepen what's already working.</em>`
      }
      return `The whole system is humming. <em>Stay in this current a little longer.</em>`
    }

    // Mid coherence — acknowledge + offer the gentlest useful move
    if (score >= 11) {
      if (weakest === 'authority') return `Most of you is aligned; your voice hasn't quite landed yet. <em>Say the true thing and let it move.</em>`
      if (weakest === 'capacity')  return `The work is here but the body's asking to be tended first. <em>Start with breath, then the doing.</em>`
      if (weakest === 'expansion') return `You're held, and you're clear — now the rhythm wants one real block. <em>Pick it and protect it.</em>`
      return `There's some friction in the field. <em>Simplify to the one thing that matters.</em>`
    }

    // Lower coherence — invitation to smallness, not demands
    if (yellow >= 4 || red >= 1) {
      return `A few signals are asking for care today. <em>One small, honest move is plenty.</em>`
    }

    return `The container wants tending before the work does. <em>Slow down — it's not against you.</em>`
  },

  _buildStructural(ctx) {
    const label = this._stateLabel(ctx.coherenceScore).toUpperCase()
    const keys   = ['A1','A2','A3','C1','C2','C3','E1','E2','E3']
    const red    = ctx.signals.map((c, i) => c === 'red'    ? keys[i] : null).filter(Boolean)
    const yellow = ctx.signals.map((c, i) => c === 'yellow' ? keys[i] : null).filter(Boolean)
    const parts  = [`Coherence ${ctx.coherenceScore}/18 \u2014 ${label}.`]

    if (red.length)                  parts.push(`${red.join(', ')} RED.`)
    if (yellow.length)               parts.push(`${yellow.slice(0, 2).join(', ')} YELLOW.`)
    if (ctx.overdueFu > 0)           parts.push(`${ctx.overdueFu} overdue follow-up${ctx.overdueFu > 1 ? 's' : ''}.`)
    if (ctx.todaySessions > 0)       parts.push(`${ctx.todaySessions} session${ctx.todaySessions > 1 ? 's' : ''} today.`)
    else if (ctx.daysSinceExecution >= 2) parts.push(`${ctx.daysSinceExecution}d execution gap.`)

    return parts.join(' ')
  },

  _buildPriorities(allData, ctx) {
    const priorities = []
    const today = new Date(); today.setHours(0, 0, 0, 0)
    const fuArr = Array.isArray(allData?.followUps) ? allData.followUps : []

    // 1. Overdue follow-ups (skip non-date due values like "Next paycheck", "—", "TBD")
    fuArr.filter(f => {
      if (!f.due) return false
      const d = new Date(f.due)
      if (isNaN(d.getTime())) return false
      d.setHours(0, 0, 0, 0)
      return d < today && (f.status || '').toLowerCase() !== 'done'
    }).sort((a, b) => new Date(a.due) - new Date(b.due))
      .forEach(f => {
        const d = new Date(f.due); d.setHours(0, 0, 0, 0)
        const days = Math.round((today - d) / (1000 * 60 * 60 * 24))
        const urgency = days >= 15 ? 'critical' : days >= 8 ? 'urgent' : days >= 3 ? 'warning' : 'normal'
        priorities.push({
          type: 'followup', urgency,
          label: `${f.person} follow-up`,
          context: `${days}d overdue`,
          prompt: `I need to follow up with ${f.person}. Topic: ${f.topic || 'general'}. It's ${days} days overdue (was due ${f.due}). Help me draft a message or plan my approach.`,
          tabLabel: `${f.person} follow-up`,
          _raw: { person: f.person, topic: f.topic, due: f.due },
        })
      })

    // 2. Overdue outcomes (gate passed, not complete)
    ctx.outcomes
      .filter(o => o.daysToGate != null && o.daysToGate < 0 && o.status !== 'COMPLETE')
      .sort((a, b) => a.daysToGate - b.daysToGate)
      .forEach(o => {
        priorities.push({
          type: 'outcome', urgency: 'urgent',
          label: o.title,
          context: `${Math.abs(o.daysToGate)}d past gate`,
          prompt: `My outcome "${o.title}" is ${Math.abs(o.daysToGate)} days past its gate (${o.gateLabel}). Status: ${o.status}. Help me assess whether to push the gate or accelerate.`,
          tabLabel: o.title,
          _raw: { status: o.status, gateLabel: o.gateLabel },
        })
      })

    // 3. At-risk/blocked outcomes with gates < 7 days
    ctx.outcomes
      .filter(o => o.daysToGate != null && o.daysToGate >= 0 && o.daysToGate <= 7 && (o.status === 'AT RISK' || o.status === 'BLOCKED'))
      .sort((a, b) => a.daysToGate - b.daysToGate)
      .forEach(o => {
        priorities.push({
          type: 'outcome', urgency: 'warning',
          label: o.title,
          context: o.daysToGate === 0 ? 'gate today' : `gate in ${o.daysToGate}d`,
          prompt: `My outcome "${o.title}" has a gate on ${o.gateLabel} (${o.daysToGate} days away) and status is ${o.status}. Help me identify the next concrete step to stay on track.`,
          tabLabel: o.title,
          _raw: { status: o.status, gateLabel: o.gateLabel },
        })
      })

    // 4. Unchecked weekly targets
    ctx.targets.items
      .filter(t => !t.checked)
      .forEach(t => {
        priorities.push({
          type: 'target', urgency: 'normal',
          label: t.text,
          context: 'target',
          prompt: `One of my weekly targets is: "${t.text}". I have ${ctx.targets.done}/${ctx.targets.total} targets complete this week. Help me knock this out.`,
          tabLabel: 'Weekly target',
        })
      })

    // 6. Cadence items
    const dayName = ['Sunday','Monday','Tuesday','Wednesday','Thursday','Friday','Saturday'][new Date().getDay()]
    const cadence = {
      Saturday: { label: 'Write list email', prompt: `It's Saturday \u2014 time to draft the weekly list email. Help me get started.` },
      Sunday:   { label: 'Weekly review', prompt: `It's Sunday \u2014 time for the weekly review. Help me run /weekly-review.` },
    }
    if (cadence[dayName]) {
      priorities.push({
        type: 'cadence', urgency: 'normal',
        label: cadence[dayName].label,
        context: dayName,
        prompt: cadence[dayName].prompt,
        tabLabel: cadence[dayName].label,
      })
    }

    return priorities
  },

  _buildCoachingPrompt(ctx) {
    if (!ctx) return null
    const signals = ctx.signals || []
    const keys = ['A1','A2','A3','C1','C2','C3','E1','E2','E3']
    const energy = (ctx.energy || '').toLowerCase()
    const { counts, tensions, descriptions } = ctx.patterns || {}

    // Helper: find the top rising or active pattern matching a filter
    const topPattern = (filter) => {
      const matches = (counts || []).filter(filter).sort((a, b) => {
        // Rising (^) first, then by count descending
        if (a.trend === '^' && b.trend !== '^') return -1
        if (b.trend === '^' && a.trend !== '^') return 1
        return b.count - a.count
      })
      return matches[0] || null
    }

    // Helper: find active tension
    const activeTension = (tensions || [])[0] || null

    // Helper: build the card object with pattern context
    const card = (skill, prompt, terminalPrompt, accent, pattern, tension) => {
      const result = { skill, prompt, terminalPrompt, accent }
      if (pattern) {
        result.pattern = {
          name: pattern.name,
          count: pattern.count,
          trend: pattern.trend,
          description: (descriptions || {})[pattern.name] || '',
        }
      }
      if (tension) {
        result.tension = { label: tension.label, days: tension.days }
      }
      return result
    }

    // Priority 1: Dysregulation or C1 (Regulation) RED
    if (energy.includes('dysregulated') || signals[3] === 'red') {
      const p = topPattern(c => c.pole === 'Negative' && (c.triadLeg || '').includes('Capacity'))
      return card('/regulate',
        p ? `${p.name} is active (${p.count}${p.trend}). Your body is asking to ground first.`
          : 'Your system is signaling dysregulation. Ground first \u2014 execution can wait.',
        'I\u2019m feeling dysregulated. Help me check in with my nervous system and find ground.',
        'var(--capacity)', p, null)
    }

    // Priority 2: Any Authority signal (A1-A3) RED
    const redAuthIdx = [0, 1, 2].find(i => signals[i] === 'red')
    if (redAuthIdx != null) {
      const name = SIGNAL_NAMES[keys[redAuthIdx]]
      const p = topPattern(c => c.pole === 'Negative' && (c.triadLeg || '').includes('Authority'))
        || topPattern(c => (c.triadLeg || '').includes('Authority'))
      return card('/edge',
        p ? `${p.name} pattern (${p.count}${p.trend}) \u2014 ${name} is flagged. What edge are you avoiding?`
          : `${name} is flagged \u2014 where are you deferring something that needs to be faced?`,
        `My ${name} signal is RED. Help me explore what edge I\u2019m avoiding.`,
        'var(--authority)', p, null)
    }

    // Priority 3: 2+ Capacity signals RED or yellow
    const capStressed = [3, 4, 5].filter(i => signals[i] === 'red' || signals[i] === 'yellow').length
    if (capStressed >= 2) {
      const p = topPattern(c => c.pole === 'Negative' && (c.triadLeg || '').includes('Capacity'))
      return card('/coach',
        p ? `${p.name} (${p.count}${p.trend}) \u2014 Capacity is under pressure. What\u2019s draining you?`
          : 'Capacity is under pressure. What\u2019s draining you right now?',
        'My Capacity signals are stressed. Help me figure out what\u2019s draining me and what to do about it.',
        'var(--capacity)', p, null)
    }

    // Priority 4: Execution gap >= 3 days
    if (ctx.daysSinceExecution >= 3) {
      const p = topPattern(c => c.name === 'activation-gap' || c.name === 'avoidance' || c.name === 'drift')
      return card('/blind-spots',
        p ? `${p.name} (${p.count}${p.trend}) \u2014 ${ctx.daysSinceExecution}d without execution. What\u2019s hiding?`
          : `${ctx.daysSinceExecution} days without execution. What\u2019s blocking isn\u2019t always what it looks like.`,
        `I haven\u2019t executed in ${ctx.daysSinceExecution} days. Help me surface what I might be missing or avoiding.`,
        'var(--expansion)', p, null)
    }

    // Priority 5: Active tension exists
    if (activeTension && activeTension.days >= 7) {
      const p = topPattern(c => activeTension.label.includes(c.name))
      return card('/edge',
        `tension: ${activeTension.label} \u2014 day ${activeTension.days}. This one keeps showing up.`,
        `I have an active tension: "${activeTension.label}" that\u2019s persisted for ${activeTension.days} days. Help me explore this edge.`,
        'var(--authority)', p, activeTension)
    }

    // Priority 6: Rising pattern — celebrate or explore
    const rising = topPattern(c => c.trend === '^' && c.count >= 5)
    if (rising) {
      const isPositive = rising.pole === 'Positive'
      return card(isPositive ? '/coach' : '/edge',
        `${rising.name} is rising (${rising.count}^). ${isPositive ? 'What\u2019s fueling this?' : 'What\u2019s underneath this?'}`,
        isPositive
          ? `My "${rising.name}" pattern is rising (${rising.count} occurrences, trending up). Help me explore what\u2019s fueling it so I can sustain it.`
          : `My "${rising.name}" pattern is rising (${rising.count} occurrences, trending up). Help me explore what\u2019s underneath it.`,
        isPositive ? 'var(--capacity)' : 'var(--expansion)', rising, null)
    }

    // Priority 7: Stable + active today — go deeper
    if (ctx.coherenceScore >= 11 && ctx.todaySessions > 0) {
      const p = topPattern(c => c.trend === '^' || c.count >= 10)
      return card('/coach',
        p ? `System is stable. ${p.name} (${p.count}${p.trend}) \u2014 good day to go deeper.`
          : 'System is stable. Good day to go deeper \u2014 what\u2019s the thing you\u2019ve been avoiding?',
        'My system is stable today. Help me explore something I\u2019ve been putting off or avoiding.',
        'var(--gold)', p, null)
    }

    // Priority 8: Fallback
    const p = topPattern(c => c.count >= 5)
    return card('/coach',
      p ? `${p.name} (${p.count}${p.trend}) \u2014 what would make today feel like it mattered?`
        : 'What would make today feel like it mattered?',
      'Help me check in. What\u2019s most alive for me right now, and what would make today feel like it mattered?',
      'var(--gold)', p, null)
  },

  _wireNextMoveActions(el, priorities, allData, ctx, viewIdx) {
    const dismissed = this._getDismissed()
    const active = priorities.filter(p => !dismissed.includes(p.label))
    const idx = Math.min(viewIdx || 0, Math.max(active.length - 1, 0))
    const current = active[idx]

    // Update titlebar + FAB with the top (not necessarily viewed) item
    this._updateTitlebar(active[0] || null)
    this._updateFAB(active[0] || null)

    // Expand toggle
    const toggle = el.querySelector('.cc-nextmove-expand-toggle')
    const expanded = el.querySelector('.cc-nextmove-expanded')
    if (toggle && expanded) {
      toggle.addEventListener('click', () => {
        const isOpen = expanded.style.display !== 'none'
        expanded.style.display = isOpen ? 'none' : ''
        toggle.querySelector('.cc-nextmove-expand-icon').innerHTML = isOpen ? '&#9662;' : '&#9652;'
      })
    }

    // Helper to re-render at a given index
    const rerender = (newIdx) => {
      const contentEl = document.getElementById('cc-view-content')
      if (!contentEl) return
      const momentum = this._buildMomentum(ctx)
      contentEl.style.opacity = '0'
      setTimeout(() => {
        contentEl.innerHTML = this._renderNowView(momentum, priorities, newIdx)
        contentEl.style.opacity = '1'
        this._wireNextMoveActions(el, priorities, allData, ctx, newIdx)
      }, 150)
    }

    // Prev / Next navigation
    const prevBtn = el.querySelector('.cc-nextmove-prev')
    const nextBtn = el.querySelector('.cc-nextmove-next')
    if (prevBtn) prevBtn.addEventListener('click', () => { if (idx > 0) rerender(idx - 1) })
    if (nextBtn) nextBtn.addEventListener('click', () => { if (idx < active.length - 1) rerender(idx + 1) })

    // Queue item clicks — open in terminal
    el.querySelectorAll('.cc-nextmove-queue-row').forEach(row => {
      row.style.cursor = 'pointer'
      row.addEventListener('click', () => {
        const qi = parseInt(row.dataset.queueIdx)
        const queueItems = active.slice(idx + 1)
        const item = queueItems[qi]
        if (item) this._openTerminalWithPrompt(item)
      })
    })

    // Skip counter — click to reset
    const skippedBtn = el.querySelector('.cc-nextmove-skipped')
    if (skippedBtn) {
      skippedBtn.addEventListener('click', () => {
        this._clearDismissed()
        rerender(0)
      })
    }

    // Agree — open terminal session + auto-advance
    const agreeBtn = el.querySelector('.cc-nextmove-agree')
    if (agreeBtn && current) {
      agreeBtn.addEventListener('click', () => {
        this._openTerminalWithPrompt(current)
        this._addDismissed(current.label)
        rerender(0)
      })
    }

    // Ask Oracle
    const askBtn = el.querySelector('.cc-nextmove-ask')
    if (askBtn && current) {
      askBtn.addEventListener('click', () => {
        if (typeof window.resetOracleSession === 'function') window.resetOracleSession()
        if (typeof window.openOracle === 'function') window.openOracle()
        setTimeout(() => {
          const input = document.getElementById('oracle-input')
          if (input) {
            input.value = `Regarding: ${current.label} — `
            input.focus()
          }
        }, 200)
      })
    }

    // Skip
    const skipBtn = el.querySelector('.cc-nextmove-skip')
    if (skipBtn && current) {
      skipBtn.addEventListener('click', () => {
        this._addDismissed(current.label)
        rerender(0)
      })
    }

    // Reset skipped
    const resetBtn = el.querySelector('.cc-nextmove-reset')
    if (resetBtn) {
      resetBtn.addEventListener('click', () => {
        this._clearDismissed()
        rerender(0)
      })
    }

    // Inner Move — open coaching skill in terminal
    const innerMoveBtn = el.querySelector('.cc-innermove-open')
    if (innerMoveBtn) {
      const coaching = this._buildCoachingPrompt(ctx)
      if (coaching) {
        innerMoveBtn.addEventListener('click', () => {
          this._openTerminalWithPrompt({
            label: 'Inner Move',
            prompt: coaching.terminalPrompt,
            tabLabel: coaching.skill,
          })
        })
      }
    }
  },

  _openTerminalWithPrompt(p) {
    document.querySelector('.nav-item[data-view="terminal"]')?.click()
    setTimeout(() => {
      if (window.spawnSession) window.spawnSession()
      setTimeout(() => {
        const st = window.__aceState
        if (st?.activeId && st?.sessions) {
          const permsEl = document.getElementById('chat-perms-' + st.activeId)
          if (permsEl) permsEl.value = 'auto'
          const tab = st.sessions[st.activeId]?.tab
          if (tab) {
            const span = tab.querySelector('span:not(.stab-close)')
            if (span) span.textContent = p.tabLabel || 'ACE'
          }
          if (window.sendChatMessage) {
            window.sendChatMessage(st.activeId, p.prompt)
          }
        }
      }, 200)
    }, 150)
  },

  _updateFAB(topMove) {
    const fab = document.getElementById('oracle-fab')
    if (!fab) return
    if (topMove && (topMove.urgency === 'critical' || topMove.urgency === 'urgent')) {
      fab.classList.add('proactive')
    } else {
      fab.classList.remove('proactive')
    }
  },

  _updateTitlebar(topMove) {
    const container = document.getElementById('titlebar-nextmove')
    if (!container) return
    if (this._titlebarSilenced) return
    if (!topMove) {
      container.classList.remove('visible')
      return
    }
    const dot = document.getElementById('titlebar-nm-dot')
    const label = document.getElementById('titlebar-nm-label')
    const context = document.getElementById('titlebar-nm-context')
    container.classList.add('visible')
    if (dot) dot.className = `titlebar-nm-dot ${topMove.urgency}`
    if (label) label.textContent = topMove.label
    if (context) context.textContent = topMove.context

    // Wire click — clone to remove old listeners
    const newContainer = container.cloneNode(true)
    container.parentNode.replaceChild(newContainer, container)
    newContainer.addEventListener('click', (e) => {
      // Don't trigger terminal if clicking the close button
      if (e.target.classList.contains('titlebar-nm-close')) return
      this._openTerminalWithPrompt(topMove)
    })
    // Wire close/silence button
    const closeBtn = newContainer.querySelector('.titlebar-nm-close')
    if (closeBtn) {
      closeBtn.addEventListener('click', (e) => {
        e.stopPropagation()
        this._titlebarSilenced = true
        newContainer.classList.remove('visible')
      })
    }
  },

  // Dismiss tracking — localStorage keyed by date, resets daily
  _getDismissed() {
    const key = `nextmove-dismissed-${new Date().toISOString().slice(0, 10)}`
    try { return JSON.parse(localStorage.getItem(key) || '[]') } catch { return [] }
  },
  _addDismissed(label) {
    const key = `nextmove-dismissed-${new Date().toISOString().slice(0, 10)}`
    const list = this._getDismissed()
    if (!list.includes(label)) list.push(label)
    localStorage.setItem(key, JSON.stringify(list))
  },
  _clearDismissed() {
    const key = `nextmove-dismissed-${new Date().toISOString().slice(0, 10)}`
    localStorage.removeItem(key)
  },

  _fetchAI(ctx, allData, el, fallbackPriorities) {
    if (!window.ace?.dash?.getSynthesisAI) return

    window.ace.dash.getSynthesisAI(ctx).then(raw => {
      if (!raw) return

      let synthesis = null
      let aiPriorities = null
      try {
        const parsed = typeof raw === 'string' ? JSON.parse(raw) : raw
        if (parsed.synthesis) synthesis = parsed.synthesis
        if (parsed.priorities && Array.isArray(parsed.priorities)) aiPriorities = parsed.priorities
      } catch {
        synthesis = typeof raw === 'string' ? raw : null
      }

      // Hide loading indicator
      const loadingEl = document.getElementById('cc-synth-loading')
      if (loadingEl) loadingEl.classList.remove('active')

      if (synthesis) {
        const textEl = document.getElementById('cc-synthesis-text')
        if (textEl) {
          // Keep rule-based narrative if AI output is short/empty. Otherwise render
          // the AI text and italicize the final sentence for prototype fidelity.
          const txt = String(synthesis).trim()
          if (txt.length > 20) {
            const m = txt.match(/^([\s\S]*?[.!?])\s*([^.!?]*[.!?])\s*$/)
            const html = m
              ? `${escapeHtml(m[1].trim())} <em>${escapeHtml(m[2].trim())}</em>`
              : escapeHtml(txt)
            textEl.style.opacity = '0'
            setTimeout(() => {
              textEl.innerHTML = html
              textEl.style.opacity = '1'
            }, 400)
          }
        }
      }

      if (aiPriorities && aiPriorities.length > 0) {
        // Only update if we're still on the "Now" view
        const activeView = el.querySelector('.cc-view-pill.active')?.dataset?.view
        if (activeView !== 'now') return

        const listEl = document.getElementById('cc-view-content')
        if (!listEl) return

        // Merge AI re-ranking with full priority list:
        // AI's top picks go first, remaining originals follow
        const aiMapped = aiPriorities.slice(0, 5).map(ai => {
          const match = fallbackPriorities.find(fp =>
            fp.label.toLowerCase().includes((ai.label || '').toLowerCase().split(' ')[0]) ||
            (ai.label || '').toLowerCase().includes(fp.label.toLowerCase().split(' ')[0])
          )
          return match ? { ...match, _aiRanked: true } : {
            type: 'ai', urgency: 'normal',
            label: ai.label || 'Action item',
            context: ai.context || '',
            prompt: `Help me with: ${ai.label}. ${ai.reasoning || ''}`,
            tabLabel: ai.label || 'ACE',
            _aiRanked: true,
          }
        })

        // Append remaining originals that AI didn't mention
        const aiLabels = new Set(aiMapped.map(m => m.label.toLowerCase()))
        const remaining = fallbackPriorities.filter(fp => !aiLabels.has(fp.label.toLowerCase()))
        const merged = [...aiMapped, ...remaining]

        // Re-render Now view with merged priorities
        const momentum = this._buildMomentum(ctx)
        listEl.style.opacity = '0'
        listEl.style.transition = 'opacity 0.4s ease'
        setTimeout(() => {
          listEl.innerHTML = this._renderNowView(momentum, merged)
          listEl.style.opacity = '1'
          this._wireNextMoveActions(el, merged, allData, ctx)
        }, 400)
      }
    }).catch(() => {
      const loadingEl = document.getElementById('cc-synth-loading')
      if (loadingEl) loadingEl.classList.remove('active')
    })
  },
}

// ─── Risen-leg why overlay ─────────────────────────────────────────────

function escAttr(s) {
  return String(s || '').replace(/"/g, '&quot;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
}

function showRisenWhyOverlay(leg, allData, ctx) {
  document.querySelectorAll('.cockpit-overlay').forEach(o => o.remove())

  const top = allData?._candidatesByLeg?.[leg]?.[0]
  const weakest = allData?._weakestLeg
  const compass = allData?.compass?.direction
  const dailyFocus = allData?.dailyFocus || []
  const legSigRange = { authority: [0,2], capacity: [3,5], expansion: [6,8] }[leg]
  const signals = ctx.signals || []
  const legGreens = legSigRange
    ? signals.slice(legSigRange[0], legSigRange[1] + 1).filter(s => s === 'green').length
    : 0

  // Recompute score breakdown for the top candidate (shadow of dashboard's computeLeverageScore)
  const breakdown = []
  if (top) {
    for (const f of dailyFocus) {
      const fLow = (f || '').toLowerCase()
      if (top.label && fLow.includes(top.label.toLowerCase().slice(0, 20))) {
        breakdown.push({ reason: 'Matches today’s focus', points: 5 })
        break
      }
      if (top._raw?.person && fLow.includes(top._raw.person.toLowerCase())) {
        breakdown.push({ reason: `Focus mentions ${top._raw.person}`, points: 5 })
        break
      }
    }
    if (top.leg === weakest) breakdown.push({ reason: `${weakest} is the weakest leg right now`, points: 3 })
    if (top.urgency === 'critical' || top.urgency === 'urgent')
      breakdown.push({ reason: `Urgency: ${top.urgency}`, points: 2 })
    else breakdown.push({ reason: 'Baseline urgency', points: 1 })
    if (top.direction && top.direction === compass)
      breakdown.push({ reason: `Aligned with compass direction (${compass})`, points: 1 })
  }
  const total = breakdown.reduce((s, r) => s + r.points, 0)

  const breakdownHtml = breakdown.map(r => `
    <div class="cockpit-overlay-row">
      <span class="cockpit-overlay-row-label">${escAttr(r.reason)}</span>
      <span class="cockpit-overlay-row-value active">+${r.points}</span>
    </div>`).join('')

  const topLabel = top?.label || '(no candidate)'
  const topCtx = top?.context || ''

  const overlay = document.createElement('div')
  overlay.className = 'cockpit-overlay'
  overlay.innerHTML = `
    <div class="cockpit-overlay-panel">
      <div class="cockpit-overlay-header">
        <span class="cockpit-overlay-label">Why ${escAttr(leg)} is rising</span>
        <button class="cockpit-overlay-close" aria-label="Close">×</button>
      </div>
      <div class="cockpit-overlay-body">
        <div style="margin-bottom:14px;">
          <div style="font-family:'Space Grotesk',sans-serif;font-size:15px;color:var(--text-primary);margin-bottom:4px;">${escAttr(topLabel)}</div>
          <div style="font-family:'JetBrains Mono',monospace;font-size:10px;color:var(--text-dim);">${escAttr(topCtx)}</div>
        </div>
        <div style="font-family:'JetBrains Mono',monospace;font-size:8px;letter-spacing:0.22em;color:var(--text-dim);text-transform:uppercase;margin-bottom:8px;">Leverage score: ${total}</div>
        ${breakdownHtml || '<div style="font-style:italic;color:var(--text-dim);font-size:12px;">No candidates available.</div>'}
        <div style="margin-top:18px;padding-top:14px;border-top:1px dashed var(--border);font-family:'Cormorant Garamond',serif;font-style:italic;font-size:13px;color:var(--text-secondary);line-height:1.5;">
          The risen leg shifts daily based on what has highest leverage: focus match (+5), weakest leg (+3), urgency (+2), compass alignment (+1).
        </div>
      </div>
      <div class="cockpit-overlay-footer">
        <button class="cockpit-overlay-btn secondary" data-action="close">Close</button>
      </div>
    </div>`

  const close = () => overlay.remove()
  overlay.addEventListener('click', (e) => { if (e.target === overlay) close() })
  overlay.querySelector('.cockpit-overlay-close').addEventListener('click', close)
  overlay.querySelector('[data-action="close"]').addEventListener('click', close)
  document.addEventListener('keydown', function esc(e) {
    if (e.key === 'Escape') { close(); document.removeEventListener('keydown', esc) }
  })
  document.body.appendChild(overlay)
}
