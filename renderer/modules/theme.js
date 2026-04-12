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

export function applyTheme(t) {
  state.theme = t
  document.body.classList.toggle('light', t === 'light')
  document.getElementById('theme-btn').textContent = t === 'light' ? '◐' : '◑'
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
  if (homeNameEl) homeNameEl.textContent = `Good ${greet}, Nikhil.`
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
    const btn = document.getElementById('sidebar-toggle')
    const isCollapsed = sidebar.classList.toggle('collapsed')
    btn.innerHTML = isCollapsed ? '▸' : '◂ <span>Collapse</span>'
    setTimeout(() => { if (window.fitActive) window.fitActive() }, 250)
  })

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
