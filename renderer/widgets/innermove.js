// renderer/widgets/innermove.js
// Inner Move bar — pattern-aware coaching prompt
import { escapeHtml } from '../modules/chat-renderer.js'
import synthesis from './synthesis.js'

export default {
  id: 'innermove',
  label: 'Inner Move',
  description: 'Pattern-aware coaching prompt below the triad deck',
  dataSource: null,
  defaultEnabled: true,

  render(allData, el) {
    // Reuse synthesis widget's coaching builder
    const ctx = synthesis._buildContext(allData)
    const coaching = synthesis._buildCoachingPrompt
      ? synthesis._buildCoachingPrompt(ctx)
      : null

    if (!coaching) {
      el.innerHTML = ''
      return
    }

    const pat = coaching.pattern
    const ten = coaching.tension

    el.innerHTML = `
      <div class="cockpit-innermove" style="--innermove-accent: ${coaching.accent || 'var(--green)'}">
        <div class="im-header">
          <span class="im-icon">↻</span>
          <span class="im-tag">Inner Move</span>
          ${coaching.skill ? `<span class="im-skill">${escapeHtml(coaching.skill)}</span>` : ''}
        </div>
        ${pat ? `<div class="im-pattern">
          <span class="im-pattern-name">${escapeHtml(pat.name)}</span>
          <span class="im-pattern-count">${pat.count}<span class="im-pattern-trend">${pat.trend === '^' ? '↑' : pat.trend === 'v' ? '↓' : '·'}</span></span>
        </div>` : ''}
        <div class="im-prompt">${escapeHtml(coaching.prompt)}</div>
        ${ten ? `<div class="im-tension">tension: ${escapeHtml(ten.label)} — day ${ten.days}</div>` : ''}
        <div class="im-actions">
          <button class="im-open" data-action="open">Open ${escapeHtml(coaching.skill || '/coach')}</button>
        </div>
      </div>`

    el.querySelector('[data-action="open"]')?.addEventListener('click', () => {
      document.querySelector('.nav-item[data-view="terminal"]').click()
      setTimeout(() => {
        if (window.spawnSession) window.spawnSession()
        setTimeout(() => {
          if (window.sendChatMessage) {
            const st = window.__aceState
            if (st?.activeId) window.sendChatMessage(st.activeId, coaching.prompt)
          }
        }, 200)
      }, 150)
    })
  },
}
