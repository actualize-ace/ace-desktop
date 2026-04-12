// renderer/widgets/registry.js
// Import order = default layout order.
// Each widget: { id, label, description, dataSource, defaultEnabled, render(data, el) }

import northstar   from './northstar.js'
import compass      from './compass.js'
import synthesis    from './synthesis.js'
import identity     from './identity.js'
import metrics      from './metrics.js'
import rhythm       from './rhythm.js'
import velocity     from './velocity.js'
import state        from './state.js'
import outcomes     from './outcomes.js'
import targets      from './targets.js'
import pipeline     from './pipeline.js'
import followups    from './followups.js'
import quickactions from './quickactions.js'
import astro        from './astro.js'

export const WIDGETS = [northstar, synthesis, compass, identity, astro, metrics, rhythm, velocity, state, outcomes, targets, pipeline, followups, quickactions]

// Zone assignment for cockpit layout
// 'cockpit-*' = sacred ACE framework zones (fixed order, framework-defined)
// 'dock' = operator-extensible zone
// 'legacy' = old widgets disabled by default
export const WIDGET_ZONES = {
  northstar:    'cockpit-top',
  synthesis:    'cockpit-brain',
  compass:      'cockpit-brain',
  velocity:     'cockpit-flow',
  rhythm:       'cockpit-flow',
  astro:        'cockpit-flow',

  identity:     'legacy',
  metrics:      'legacy',
  state:        'legacy',
  outcomes:     'legacy',
  targets:      'legacy',
  pipeline:     'legacy',
  followups:    'legacy',
  quickactions: 'legacy',
}

// New default — cockpit-active widgets enabled, legacy disabled
export const DEFAULT_LAYOUT = WIDGETS.map(w => ({
  id: w.id,
  enabled: WIDGET_ZONES[w.id] !== 'legacy',
}))
