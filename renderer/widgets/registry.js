// renderer/widgets/registry.js
// Import order = default layout order.
// Each widget: { id, label, description, dataSource, defaultEnabled, render(data, el) }

import metrics   from './metrics.js'
import state     from './state.js'
import outcomes  from './outcomes.js'
import targets   from './targets.js'
import pipeline  from './pipeline.js'
import followups from './followups.js'
import velocity  from './velocity.js'
import synthesis from './synthesis.js'

export const WIDGETS = [synthesis, metrics, state, outcomes, targets, pipeline, followups, velocity]

export const DEFAULT_LAYOUT = WIDGETS.map(w => ({ id: w.id, enabled: w.defaultEnabled ?? true }))
