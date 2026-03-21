// renderer/widgets/registry.js
// Import order = default layout order.
// Each widget: { id, label, description, dataSource, defaultEnabled, render(data, el) }

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

export const WIDGETS = [synthesis, identity, metrics, rhythm, velocity, state, outcomes, targets, pipeline, followups, quickactions]

export const DEFAULT_LAYOUT = WIDGETS.map(w => ({ id: w.id, enabled: w.defaultEnabled ?? true }))
