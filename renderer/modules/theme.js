// renderer/modules/theme.js
// Theme, zoom, and time utilities.

import { state } from '../state.js'

const XTERM_DARK = {
  background:'#060810', foreground:'#e8e4f0', cursor:'#c8a0f0',
  selectionBackground:'rgba(136,120,255,0.2)',
  black:'#141828', red:'#e07080', green:'#60d8a8', yellow:'#e0c878',
  blue:'#70b0e0', magenta:'#c8a0f0', cyan:'#60c8d8', white:'#e8e4f0',
  brightBlack:'#606080', brightRed:'#f08898', brightGreen:'#78e8b8',
  brightYellow:'#f0d888', brightBlue:'#88c0f0', brightMagenta:'#d8b0ff',
  brightCyan:'#78d8e8', brightWhite:'#f0ecf8',
}
const XTERM_LIGHT = {
  background:'#eceaf4', foreground:'#18162a', cursor:'#5a48c0',
  selectionBackground:'rgba(90,72,192,0.15)',
  black:'#18162a', red:'#c04858', green:'#1a8a60', yellow:'#a07020',
  blue:'#3060a8', magenta:'#7048b8', cyan:'#186888', white:'#c8c6d4',
  brightBlack:'#8886a0', brightRed:'#d05868', brightGreen:'#2a9a70',
  brightYellow:'#b08030', brightBlue:'#4070b8', brightMagenta:'#8058c8',
  brightCyan:'#287898', brightWhite:'#e8e6f0',
}

export function xtermTheme() { return state.theme === 'light' ? XTERM_LIGHT : XTERM_DARK }

const SUN_SVG = '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="4"/><line x1="12" y1="2" x2="12" y2="4"/><line x1="12" y1="20" x2="12" y2="22"/><line x1="4.93" y1="4.93" x2="6.34" y2="6.34"/><line x1="17.66" y1="17.66" x2="19.07" y2="19.07"/><line x1="2" y1="12" x2="4" y2="12"/><line x1="20" y1="12" x2="22" y2="12"/><line x1="4.93" y1="19.07" x2="6.34" y2="17.66"/><line x1="17.66" y1="6.34" x2="19.07" y2="4.93"/></svg>'
const MOON_SVG = '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z"/></svg>'

export function applyTheme(t) {
  state.theme = t
  document.body.classList.toggle('light', t === 'light')
  const themeBtn = document.getElementById('theme-btn')
  if (themeBtn) themeBtn.innerHTML = t === 'light' ? MOON_SVG : SUN_SVG
  localStorage.setItem('ace-theme', t)
  try {
    const xt = xtermTheme()
    Object.values(state.sessions).forEach(s => { if (s?.term) s.term.options.theme = { ...xt } })
    Object.values(state.agentSessions).forEach(s => { if (s?.term) s.term.options.theme = { ...xt } })
  } catch(e) {}
  // Let views that bake theme-specific values into their own DOM (e.g. astro
  // SVG fills) re-render themselves. Pure-CSS views ignore this.
  window.dispatchEvent(new CustomEvent('ace-theme-change', { detail: t }))
}

export function applyZoom(z) {
  state.uiZoom = Math.max(0.5, Math.min(2.0, z))
  document.documentElement.style.setProperty('--ui-zoom', state.uiZoom)
  document.getElementById('zoom-label').textContent = Math.round(state.uiZoom * 100) + '%'
  localStorage.setItem('ace-zoom', state.uiZoom)
  // fitActive is defined in session-manager — use window bridge during migration
  setTimeout(() => { if (window.fitActive) window.fitActive() }, 100)
}

export function updateTime() {
  const now   = new Date()
  const t     = now.toLocaleTimeString('en-US', { hour:'2-digit', minute:'2-digit', second:'2-digit', hour12:false })
  const d     = now.toLocaleDateString('en-US', { weekday:'short', month:'short', day:'numeric' })
  const greet = now.getHours() < 12 ? 'morning' : now.getHours() < 17 ? 'afternoon' : 'evening'
  const liveEl = document.getElementById('live-time')
  const homeTimeEl = document.getElementById('home-time')
  const homeNameEl = document.getElementById('home-name')
  if (liveEl) liveEl.textContent = t
  if (homeTimeEl) homeTimeEl.textContent = d.toUpperCase()
  if (homeNameEl) homeNameEl.textContent = `Good ${greet}.`
}

export function initTheme() {
  // Apply theme on load
  document.body.classList.toggle('light', state.theme === 'light')
  applyTheme(state.theme)
  applyZoom(state.uiZoom)
  updateTime()
  state.timeTimer = setInterval(updateTime, 1000)

  // Event listeners
  document.getElementById('theme-btn').addEventListener('click', () => applyTheme(state.theme === 'dark' ? 'light' : 'dark'))
  document.getElementById('zoom-in-btn').addEventListener('click', () => applyZoom(state.uiZoom + 0.05))
  document.getElementById('zoom-out-btn').addEventListener('click', () => applyZoom(state.uiZoom - 0.05))
  document.getElementById('sidebar-toggle').addEventListener('click', () => {
    const sidebar = document.getElementById('sidebar')
    sidebar.classList.toggle('collapsed')
    setTimeout(() => { if (window.fitActive) window.fitActive() }, 250)
  })

  // ── Sidebar drag-to-resize ─────────────────────────────────────────────
  // Bounds chosen so the collapsed toggle (52px) and standard width (216px)
  // remain natural endpoints. Persisted to ace-config.json on mouseup.
  const SIDEBAR_MIN = 180
  const SIDEBAR_MAX = 380
  const SIDEBAR_DEFAULT = 216
  const handle = document.getElementById('sidebar-resize-handle')
  const sidebar = document.getElementById('sidebar')
  if (handle && sidebar) {
    let dragging = false
    let startX = 0
    let startW = 0

    const saveWidth = async (w) => {
      try {
        await window.ace?.setup?.patchConfig?.({ defaults: { display: { sidebarWidth: w } } })
      } catch {}
    }

    handle.addEventListener('mousedown', e => {
      if (sidebar.classList.contains('collapsed')) return
      dragging = true
      startX = e.clientX
      startW = sidebar.getBoundingClientRect().width
      sidebar.classList.add('resizing')
      document.body.classList.add('sidebar-resizing')
      e.preventDefault()
    })

    document.addEventListener('mousemove', e => {
      if (!dragging) return
      const delta = e.clientX - startX
      const w = Math.max(SIDEBAR_MIN, Math.min(SIDEBAR_MAX, startW + delta))
      sidebar.style.setProperty('--sidebar-w', w + 'px')
    })

    document.addEventListener('mouseup', () => {
      if (!dragging) return
      dragging = false
      sidebar.classList.remove('resizing')
      document.body.classList.remove('sidebar-resizing')
      const w = Math.round(sidebar.getBoundingClientRect().width)
      saveWidth(w)
      if (window.fitActive) window.fitActive()
    })

    handle.addEventListener('dblclick', () => {
      sidebar.style.setProperty('--sidebar-w', SIDEBAR_DEFAULT + 'px')
      saveWidth(SIDEBAR_DEFAULT)
      if (window.fitActive) window.fitActive()
    })
  }

  // Visibility change — pause/resume clock
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible') {
      updateTime()
      if (!state.timeTimer) state.timeTimer = setInterval(updateTime, 1000)
    } else {
      clearInterval(state.timeTimer)
      state.timeTimer = null
    }
  })
}
