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

// Phase B1: live-reapply reduced-effects when OS accessibility preferences
// change (e.g. user toggles macOS "Reduce motion"). Initial application
// happens pre-paint via the inline script in index.html.
;(function initReducedEffectsListeners () {
  const ace = window.ace || {}
  const resolve = () => {
    const cfg = (window.ace && window.ace.cachedConfig) || ace.initialConfig || {}
    if (typeof cfg.reducedEffects === 'boolean') return cfg.reducedEffects
    return (ace.platform === 'linux')
      || matchMedia('(prefers-reduced-motion: reduce)').matches
      || matchMedia('(prefers-reduced-transparency: reduce)').matches
  }
  const reapply = () => {
    document.body.classList.toggle('reduced-effects', !!resolve())
  }
  matchMedia('(prefers-reduced-motion: reduce)').addEventListener('change', reapply)
  matchMedia('(prefers-reduced-transparency: reduce)').addEventListener('change', reapply)
})()
