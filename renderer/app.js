// renderer/app.js
// Entry point — imports state and bridges it to the inline script during migration.
// This file will grow as modules are extracted from the inline script.

window.onerror = (msg, source, line, col, err) => {
  console.error(`[renderer] error: ${msg} (${source}:${line}:${col})`, err)
}

window.addEventListener('unhandledrejection', (e) => {
  console.error('[renderer] unhandledRejection:', e.reason)
})

import { state } from './state.js'

// Bridge: expose state to the inline script during migration.
// The inline script still uses bare globals (sessions, activeId, etc.).
// This bridge lets it access state.sessions etc. via window.__aceState.
// Will be removed once all JS is extracted into modules.
window.__aceState = state

// Command bar (Cmd+K)
import { initCommandBar } from './modules/command-bar.js'
initCommandBar()
