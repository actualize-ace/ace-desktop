// renderer/widgets/registry.js
// Import order = default layout order.
// Each widget: { id, label, description, dataSource, defaultEnabled, render(data, el) }

import northstar   from './northstar.js'
import orb          from './orb.js'
import pulsechip    from './pulsechip.js'
import compass      from './compass.js'
import cadence      from './cadence.js'
import integrity    from './integrity.js'
import { triadAuthority, triadCapacity, triadExpansion } from './triad-leg.js'
import innermove    from './innermove.js'
import synthesis    from './synthesis.js'
import identity     from './identity.js'
import metrics      from './metrics.js'
import rhythm       from './rhythm.js'
import velocity     from './velocity.js'
import state        from './state.js'
import outcomes     from './outcomes.js'
import targets      from './targets.js'
import followups    from './followups.js'
import quickactions from './quickactions.js'
import astro        from './astro.js'

export const WIDGETS = [
  northstar, orb, synthesis, cadence, compass, pulsechip,
  integrity,
  triadAuthority, triadCapacity, triadExpansion,
  innermove,
  identity, astro, metrics, rhythm, velocity,
  state, outcomes, targets, followups, quickactions,
]

// Zone assignment for cockpit layout
// 'cockpit-*' = sacred ACE framework zones (fixed order, framework-defined)
// 'dock' = operator-extensible zone
// 'legacy' = old widgets disabled by default
export const WIDGET_ZONES = {
  northstar:        'cockpit-top',
  orb:              'cockpit-brain',
  synthesis:        'cockpit-brain',
  cadence:          'cockpit-brain',
  compass:          'legacy',
  pulsechip:        'cockpit-brain',
  integrity:        'cockpit-integrity',
  'triad-authority':'cockpit-triad',
  'triad-capacity': 'cockpit-triad',
  'triad-expansion':'cockpit-triad',
  innermove:        'cockpit-coaching',
  velocity:     'cockpit-flow',
  rhythm:       'cockpit-flow',
  astro:        'cockpit-flow',

  identity:     'legacy',
  metrics:      'legacy',
  state:        'legacy',
  outcomes:     'legacy',
  targets:      'legacy',
  followups:    'legacy',
  quickactions: 'legacy',
}

// New default — cockpit-active widgets enabled, legacy disabled
export const DEFAULT_LAYOUT = WIDGETS.map(w => ({
  id: w.id,
  enabled: WIDGET_ZONES[w.id] !== 'legacy',
}))
