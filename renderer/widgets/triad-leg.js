// renderer/widgets/triad-leg.js
// Triad leg widget — signal decode + action card with rising/leverage logic
// One factory creates three exports: triad-authority, triad-capacity, triad-expansion
import { escapeHtml } from '../modules/chat-renderer.js'

const SIGNAL_NAMES = {
  A1: 'Truth', A2: 'Choice', A3: 'Expression',
  C1: 'Regulation', C2: 'Depth', C3: 'Resilience',
  E1: 'Rhythm', E2: 'Containers', E3: 'Realization',
}

const LEG_CONFIG = {
  authority: {
    name: 'Authority',
    subtitle: 'authoring',
    signalKeys: ['A1', 'A2', 'A3'],
    signalIndices: [0, 1, 2],
  },
  capacity: {
    name: 'Capacity',
    subtitle: 'holding',
    signalKeys: ['C1', 'C2', 'C3'],
    signalIndices: [3, 4, 5],
  },
  expansion: {
    name: 'Expansion',
    subtitle: 'growing',
    signalKeys: ['E1', 'E2', 'E3'],
    signalIndices: [6, 7, 8],
  },
}

function makeWidget(leg) {
  return {
    id: `triad-${leg}`,
    label: `Triad — ${LEG_CONFIG[leg].name}`,
    description: `${LEG_CONFIG[leg].name} signal decode + highest-leverage action`,
    dataSource: null,
    defaultEnabled: true,
    leg,

    render(allData, el) {
      const config = LEG_CONFIG[leg]
      const signals = allData.metrics?._signals || Array(9).fill('dim')
      const legSignals = config.signalIndices.map(i => signals[i] || 'dim')
      const legScore = legSignals.filter(s => s === 'green').length

      const candidates = this._buildCandidates(allData, leg)
      const top = candidates[0] || null
      const isRisen = allData._risenLeg === leg

      el.innerHTML = `
        <div class="triad-leg ${leg} ${isRisen ? 'risen-leg' : ''}">
          <div class="leg-header">
            <div class="leg-name" title="${this._legHint(leg)}">${config.name}<span class="arrow">↗</span></div>
            <div class="leg-score">${legScore} / 3</div>
          </div>
          <div class="leg-subtitle">${escapeHtml(config.subtitle)}</div>

          <div class="signal-decode">
            ${config.signalKeys.map((key, i) => {
              const color = legSignals[i]
              const status = { green: 'Green', yellow: 'Yellow', red: 'Red', dim: '—' }[color]
              return `
                <div class="signal-row" data-signal="${key}">
                  <div class="dot ${color}"></div>
                  <span class="key">${key}</span>
                  <span class="name">${SIGNAL_NAMES[key]}</span>
                  <span class="status ${color}">${status}</span>
                </div>`
            }).join('')}
          </div>

          ${this._renderActionCard(top, isRisen)}
        </div>`

      this._wire(el, top, allData)
    },

    _renderActionCard(item, isRisen) {
      if (!item) {
        const empty = this._emptyState()
        return `<div class="action-card empty"><div class="empty-text">${escapeHtml(empty)}</div></div>`
      }
      const typeLabel = this._typeLabel(item.type)
      const risenClass = isRisen ? 'risen' : ''
      return `
        <div class="action-card ${risenClass}" data-leverage="${item._leverage || 0}">
          <div class="header">
            <div class="urgency-dot ${item.urgency || 'normal'}"></div>
            <span class="label-tag">${escapeHtml(typeLabel)}</span>
          </div>
          <div class="move-label">${escapeHtml(item.label)}</div>
          <div class="move-context">${escapeHtml(item.context || '')}</div>
          <div class="card-actions-default">
            <span class="arrow">→ open</span>
          </div>
          <div class="card-actions-hover">
            <button class="card-btn done"  data-action="done"  title="Mark done">✓</button>
            <button class="card-btn open"  data-action="open"  title="Open">→</button>
            <button class="card-btn skip"  data-action="skip"  title="Skip today">⏭</button>
          </div>
        </div>`
    },

    _emptyState() {
      if (leg === 'authority')  return 'No outcomes pending'
      if (leg === 'capacity')   return 'Body steady. Relationships current.'
      return 'Run /weekly-review to anchor your direction.'
    },

    _legHint(leg) {
      if (leg === 'authority') return 'outcomes & gates'
      if (leg === 'capacity')  return 'body, nervous system, relationships'
      return 'targets, build blocks, growth edges'
    },

    _typeLabel(type) {
      const map = {
        outcome: 'Outcome', followup: 'Follow-up', target: 'Target',
        pipeline: 'Pipeline', cadence: 'Ritual', growth_edge: 'Growth Edge',
        regulation: 'Regulation', recovery: 'Recovery', hrv: 'Coherence',
        build_block: 'Build Block',
      }
      return map[type] || type
    },

    _buildCandidates(allData, leg) {
      // Read pre-built candidates from allData (Task 13 wires this)
      const all = allData._candidatesByLeg || {}
      return all[leg] || []
    },

    _wire(el, item, allData) {
      const card = el.querySelector('.action-card')
      if (!card || !item) return

      // Default click → open coaching session for this item
      card.addEventListener('click', (e) => {
        if (e.target.closest('.card-btn')) return
        this._openCoachingSession(item, allData)
      })

      // Hover buttons
      card.querySelector('[data-action="done"]')?.addEventListener('click', async (e) => {
        e.stopPropagation()
        const result = await window.ace.dash.markDone(item)
        if (result?.error) console.error('Mark done failed:', result.error)
        window.dispatchEvent(new CustomEvent('cockpit-refresh'))
      })

      card.querySelector('[data-action="open"]')?.addEventListener('click', (e) => {
        e.stopPropagation()
        this._openCoachingSession(item, allData)
      })

      card.querySelector('[data-action="skip"]')?.addEventListener('click', (e) => {
        e.stopPropagation()
        const dismissed = JSON.parse(localStorage.getItem('cockpit-dismissed') || '[]')
        dismissed.push({ label: item.label, date: new Date().toISOString().slice(0, 10) })
        localStorage.setItem('cockpit-dismissed', JSON.stringify(dismissed))
        window.dispatchEvent(new CustomEvent('cockpit-refresh'))
      })

      // Signal row clicks → coaching session for that signal
      el.querySelectorAll('.signal-row').forEach(row => {
        row.addEventListener('click', () => {
          const key = row.dataset.signal
          const name = SIGNAL_NAMES[key]
          this._openSignalCoaching(key, name, leg)
        })
      })
    },

    _openCoachingSession(item, allData) {
      document.querySelector('.nav-item[data-view="terminal"]').click()
      setTimeout(() => {
        if (window.spawnSession) window.spawnSession()
        setTimeout(() => {
          const st = window.__aceState
          if (st?.activeId && st?.sessions) {
            if (window.sendChatMessage) {
              const prompt = item.prompt || `Help me with: ${item.label}. Context: ${item.context || ''}`
              window.sendChatMessage(st.activeId, prompt)
            }
          }
        }, 200)
      }, 150)
    },

    _openSignalCoaching(key, name, leg) {
      document.querySelector('.nav-item[data-view="terminal"]').click()
      setTimeout(() => {
        if (window.spawnSession) window.spawnSession()
        setTimeout(() => {
          const st = window.__aceState
          if (st?.activeId && window.sendChatMessage) {
            const prompt = `My ${key} signal (${name}, under ${leg}) is currently surfacing for review. Help me understand what's driving this signal and what I can do to strengthen it. Reference the ACE Coherence Triad — ${leg} leg.`
            window.sendChatMessage(st.activeId, prompt)
          }
        }, 200)
      }, 150)
    },
  }
}

export const triadAuthority = makeWidget('authority')
export const triadCapacity  = makeWidget('capacity')
export const triadExpansion = makeWidget('expansion')

export default triadAuthority
