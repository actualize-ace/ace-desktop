// renderer/widgets/synthesis.js
// Command Center: coherence state + momentum/attention zones + view switcher

function escapeHtml(str) {
  return String(str ?? '').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;')
}

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
    const structural = this._buildStructural(ctx)
    const priorities = this._buildPriorities(allData, ctx)
    const momentum = this._buildMomentum(ctx)
    const label = this._stateLabel(ctx.coherenceScore)

    const signalKeys = ['A1','A2','A3','C1','C2','C3','E1','E2','E3']
    const signalLabels = ['A','C','E']

    el.innerHTML = `
      <div class="command-center">
        <div class="cc-pulse">
          <div class="cc-orb ${label}">
            <span class="cc-orb-score">${ctx.coherenceScore}</span>
            <span class="cc-orb-label">${label}</span>
          </div>
          <div class="cc-synthesis" id="cc-synthesis-text">${escapeHtml(structural)}</div>
          <div class="cc-right">
            <div class="cc-signals">
              ${[0,1,2].map(row => {
                const offset = row * 3
                return `<span class="cc-signal-label">${signalLabels[row]}</span>` +
                  [0,1,2].map(col => {
                    const color = ctx.signals[offset + col] || 'dim'
                    return `<div class="cc-signal-dot ${color}" title="${signalKeys[offset + col]}: ${SIGNAL_NAMES[signalKeys[offset + col]]}"></div>`
                  }).join('')
              }).join('')}
            </div>
            <div class="cc-mode-tag">${escapeHtml(ctx.mode || '\u2014')} \u00b7 ${escapeHtml(ctx.energy || '\u2014')}</div>
          </div>
        </div>

        <div class="cc-divider">
          <span class="cc-divider-label">
            <span class="cc-view-switcher">
              <button class="cc-view-pill active" data-view="now">Now</button>
              <button class="cc-view-pill" data-view="week">This Week</button>
              <button class="cc-view-pill" data-view="signals">Signals</button>
            </span>
          </span>
        </div>

        <div class="cc-view-content" id="cc-view-content">
          ${this._renderNowView(momentum, priorities)}
        </div>
      </div>`

    // Wire view switcher
    this._wireViewSwitcher(el, ctx, allData, momentum, priorities)

    // Wire signal matrix click → switch to Signals view
    const signalGrid = el.querySelector('.cc-signals')
    if (signalGrid) {
      signalGrid.addEventListener('click', () => {
        const pill = el.querySelector('.cc-view-pill[data-view="signals"]')
        if (pill) pill.click()
      })
    }

    // Wire click handlers for attention items
    this._wirePriorityClicks(el, priorities)

    // Async AI layer
    this._fetchAI(ctx, allData, el, priorities)
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

  _renderNowView(momentum, priorities) {
    const top3 = priorities.slice(0, 3)

    // Momentum zone
    let momentumHtml = ''
    if (momentum.length > 0) {
      momentumHtml = `<div class="cc-momentum">${momentum.map(m =>
        `<div class="cc-momentum-chip"><span class="chip-icon">${m.icon}</span>${escapeHtml(m.text)}</div>`
      ).join('')}</div>`
    } else {
      // Day 1 / empty state nudge
      momentumHtml = `<div class="cc-momentum-nudge">Run <span>/start</span> to begin your day and activate your system.</div>`
    }

    // Attention zone
    let attentionHtml = ''
    if (top3.length > 0) {
      attentionHtml = `<div class="cc-nextup">${top3.map((p, i) => `
        <div class="cc-nextup-row" data-priority-idx="${i}">
          <div class="cc-nextup-dot ${p.urgency}"></div>
          <span class="cc-nextup-label">${escapeHtml(p.label)}</span>
          <span class="cc-nextup-context">${escapeHtml(p.context)}</span>
          <span class="cc-nextup-arrow">\u2192</span>
        </div>`).join('')}</div>`
    } else {
      attentionHtml = `<div class="cc-nextup"><div class="cc-nextup-empty">No urgent items \u2014 your system is clean.</div></div>`
    }

    return momentumHtml + attentionHtml
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
          if (typeof spawnSession === 'function') spawnSession()
          setTimeout(() => {
            if (typeof activeId !== 'undefined' && activeId && typeof sessions !== 'undefined') {
              const modelEl = document.getElementById('chat-model-' + activeId)
              const permsEl = document.getElementById('chat-perms-' + activeId)
              if (modelEl) modelEl.value = 'sonnet'
              if (permsEl) permsEl.value = 'auto'
              const tab = sessions[activeId]?.tab
              if (tab) {
                const span = tab.querySelector('span:not(.stab-close)')
                if (span) span.textContent = `${key}: ${name}`
              }
              if (typeof sendChatMessage === 'function') {
                sendChatMessage(activeId, `My ${key} signal (${name}, under ${leg}) is currently ${status}. Help me understand what's driving this signal and what I can do to strengthen it. Reference the ACE Coherence Triad — ${leg} leg.`)
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
            this._wirePriorityClicks(el, priorities)
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
    const { state, metrics, pipeline, followUps, velocity } = allData || {}
    const signals = metrics?._signals || Array(9).fill('dim')
    const scoreMap = { green: 2, yellow: 1, red: 0, dim: 0 }
    const coherenceScore = signals.reduce((sum, c) => sum + (scoreMap[c] || 0), 0)

    const today = new Date(); today.setHours(0, 0, 0, 0)
    const byDay = velocity?.byDay || {}
    let daysSinceExecution = 0
    for (let i = 0; i < 14; i++) {
      const d = new Date(); d.setDate(d.getDate() - i)
      if ((byDay[d.toISOString().slice(0, 10)] || 0) > 0) break
      daysSinceExecution = i + 1
    }

    const fuArr = Array.isArray(followUps) ? followUps : []
    const overdueFu = fuArr.filter(f => {
      if (!f.due) return false
      const d = new Date(f.due); d.setHours(0, 0, 0, 0)
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
    const label = this._stateLabel(ctx.coherenceScore).toUpperCase()
    const keys   = ['A1','A2','A3','C1','C2','C3','E1','E2','E3']
    const red    = ctx.signals.map((c, i) => c === 'red'    ? keys[i] : null).filter(Boolean)
    const yellow = ctx.signals.map((c, i) => c === 'yellow' ? keys[i] : null).filter(Boolean)
    const parts  = [`Coherence ${ctx.coherenceScore}/18 \u2014 ${label}.`]

    if (red.length)                  parts.push(`${red.join(', ')} RED.`)
    if (yellow.length)               parts.push(`${yellow.slice(0, 2).join(', ')} YELLOW.`)
    if (ctx.overdueFu > 0)           parts.push(`${ctx.overdueFu} overdue follow-up${ctx.overdueFu > 1 ? 's' : ''}.`)
    if (ctx.daysSinceExecution >= 2) parts.push(`${ctx.daysSinceExecution}d execution gap.`)

    return parts.join(' ')
  },

  _buildPriorities(allData, ctx) {
    const priorities = []
    const today = new Date(); today.setHours(0, 0, 0, 0)
    const fuArr = Array.isArray(allData?.followUps) ? allData.followUps : []
    const pipeline = Array.isArray(allData?.pipeline) ? allData.pipeline : []

    // 1. Overdue follow-ups
    fuArr.filter(f => {
      if (!f.due) return false
      const d = new Date(f.due); d.setHours(0, 0, 0, 0)
      return d < today && (f.status || '').toLowerCase() !== 'done'
    }).sort((a, b) => new Date(a.due) - new Date(b.due))
      .forEach(f => {
        const d = new Date(f.due); d.setHours(0, 0, 0, 0)
        const days = Math.round((today - d) / (1000 * 60 * 60 * 24))
        priorities.push({
          type: 'followup', urgency: 'urgent',
          label: `${f.person} follow-up`,
          context: `${days}d overdue`,
          prompt: `I need to follow up with ${f.person}. Topic: ${f.topic || 'general'}. It's ${days} days overdue (was due ${f.due}). Help me draft a message or plan my approach.`,
          tabLabel: `${f.person} follow-up`,
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
        })
      })

    // 4. Pipeline deals with overdue next actions
    pipeline.filter(d => {
      if (!d.due_date) return false
      const due = new Date(d.due_date); due.setHours(0, 0, 0, 0)
      return due < today
    }).sort((a, b) => new Date(a.due_date) - new Date(b.due_date))
      .forEach(d => {
        const due = new Date(d.due_date); due.setHours(0, 0, 0, 0)
        const days = Math.round((today - due) / (1000 * 60 * 60 * 24))
        const fmtMoney = n => n >= 1000 ? `$${Math.round(n/1000)}K` : `$${Math.round(n)}`
        priorities.push({
          type: 'pipeline', urgency: 'warning',
          label: `${d.person} \u2014 ${d.stage}`,
          context: `${days}d overdue`,
          prompt: `${d.person} is at ${d.stage} stage${d.amount ? ', ' + fmtMoney(d.amount) : ''}. Next action: ${d.next_action || 'TBD'} (${days}d overdue). Help me move this forward.`,
          tabLabel: `${d.person} deal`,
        })
      })

    // 5. Unchecked weekly targets
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

  _wirePriorityClicks(el, priorities) {
    el.querySelectorAll('.cc-nextup-row').forEach(row => {
      row.addEventListener('click', () => {
        const idx = parseInt(row.dataset.priorityIdx)
        const p = priorities[idx]
        if (!p) return

        document.querySelector('.nav-item[data-view="terminal"]').click()

        setTimeout(() => {
          if (typeof spawnSession === 'function') spawnSession()

          setTimeout(() => {
            if (typeof activeId !== 'undefined' && activeId && typeof sessions !== 'undefined') {
              const modelEl = document.getElementById('chat-model-' + activeId)
              const permsEl = document.getElementById('chat-perms-' + activeId)
              if (modelEl) modelEl.value = 'sonnet'
              if (permsEl) permsEl.value = 'auto'

              const tab = sessions[activeId]?.tab
              if (tab) {
                const span = tab.querySelector('span:not(.stab-close)')
                if (span) span.textContent = p.tabLabel || 'ACE'
              }

              if (typeof sendChatMessage === 'function') {
                sendChatMessage(activeId, p.prompt)
              }
            }
          }, 200)
        }, 150)
      })
    })
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

      if (synthesis) {
        const textEl = document.getElementById('cc-synthesis-text')
        if (textEl) {
          textEl.style.opacity = '0'
          setTimeout(() => {
            textEl.textContent = synthesis
            textEl.style.opacity = '1'
          }, 400)
        }
      }

      if (aiPriorities && aiPriorities.length > 0) {
        // Only update if we're still on the "Now" view
        const activeView = el.querySelector('.cc-view-pill.active')?.dataset?.view
        if (activeView !== 'now') return

        const listEl = document.getElementById('cc-view-content')
        if (!listEl) return

        const mapped = aiPriorities.slice(0, 3).map((ai, i) => {
          const match = fallbackPriorities.find(fp =>
            fp.label.toLowerCase().includes((ai.label || '').toLowerCase().split(' ')[0]) ||
            (ai.label || '').toLowerCase().includes(fp.label.toLowerCase().split(' ')[0])
          ) || fallbackPriorities[i]

          return {
            type: match?.type || 'ai',
            urgency: match?.urgency || 'normal',
            label: ai.label || match?.label || 'Action item',
            context: ai.context || match?.context || '',
            prompt: match?.prompt || `Help me with: ${ai.label}. ${ai.reasoning || ''}`,
            tabLabel: match?.tabLabel || ai.label || 'ACE',
          }
        })

        // Re-render Now view with AI priorities
        const momentum = this._buildMomentum(ctx)
        listEl.style.opacity = '0'
        listEl.style.transition = 'opacity 0.4s ease'
        setTimeout(() => {
          listEl.innerHTML = this._renderNowView(momentum, mapped)
          listEl.style.opacity = '1'
          this._wirePriorityClicks(el, mapped)
        }, 400)
      }
    }).catch(() => {})
  },
}
