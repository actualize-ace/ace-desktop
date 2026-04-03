// renderer/app.js
// Entry point — imports state and bridges it to the inline script during migration.
// This file will grow as modules are extracted from the inline script.

import { state } from './state.js'

// Bridge: expose state to the inline script during migration.
// The inline script still uses bare globals (sessions, activeId, etc.).
// This bridge lets it access state.sessions etc. via window.__aceState.
// Will be removed once all JS is extracted into modules.
window.__aceState = state
