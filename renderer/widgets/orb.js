// renderer/widgets/orb.js
// Breathing coherence orb — prototype-v2 fidelity.
// Renders: iris rings + ping ripple + orb body with score / divider / state.
// Clickable to open Threshold Mode.

import synthesis from './synthesis.js'

function stateLabel(score) {
  if (score >= 15) return 'coherent'
  if (score >= 11) return 'stable'
  if (score >= 7)  return 'drifting'
  if (score >= 4)  return 'fragmented'
  return 'critical'
}

export default {
  id: 'orb',
  label: 'Coherence Orb',
  description: 'Breathing orb with coherence score + state',
  dataSource: null,
  defaultEnabled: true,

  render(allData, el) {
    // Reuse synthesis widget's buildContext for coherence score
    const ctx = synthesis._buildContext(allData)
    const score = ctx.coherenceScore ?? 0
    const total = 18 // max possible (9 signals × 2 for green)
    const label = stateLabel(score)

    el.innerHTML = `
      <div class="orb-wrap" title="Click to enter Threshold Mode">
        <div class="orb-iris"></div>
        <div class="orb-ping"></div>
        <div class="orb">
          <div class="orb-score">${score}</div>
          <div class="orb-divider">/ ${total}</div>
          <div class="orb-state">${label}</div>
        </div>
      </div>`

    el.querySelector('.orb-wrap')?.addEventListener('click', () => {
      alert("Threshold Mode opens here:\n\n\u2192 3 coherence breaths\n\u2192 North Star anchors recited\n\u2192 \u2018What wants to be created today?\u2019\n\u2192 Your answer becomes today\u2019s intent\n\u2192 Cockpit shapes around it")
    })
  },
}
