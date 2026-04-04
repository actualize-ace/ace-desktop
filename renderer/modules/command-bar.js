// renderer/modules/command-bar.js
// Cmd+K command bar — overlay UI, keyboard navigation, dispatch.

import { state } from '../state.js'
import { search } from './command-registry.js'
import { sendToActive, spawnSession } from './session-manager.js'

const overlay = document.getElementById('cmdk-overlay')
const backdrop = document.getElementById('cmdk-backdrop')
const input = document.getElementById('cmdk-input')
const results = document.getElementById('cmdk-results')

let activeIndex = 0
let flatItems = []     // current visible items (flat, for arrow-key nav)
let previousFocus = null

// ─── Open / Close ────────────────────────────────────────────

function open() {
  if (overlay.classList.contains('open')) { close(); return }

  // Close any other open overlays
  document.getElementById('settings-overlay')?.classList.remove('open')
  document.getElementById('oracle-overlay')?.classList.remove('open')
  document.getElementById('dash-settings-overlay')?.classList.remove('open')
  document.querySelector('.oracle-fab')?.classList.remove('open')

  previousFocus = document.activeElement
  overlay.classList.add('open')
  input.value = ''
  activeIndex = 0
  render('')
  requestAnimationFrame(() => input.focus())
}

function close() {
  overlay.classList.remove('open')
  input.value = ''
  if (previousFocus && typeof previousFocus.focus === 'function') {
    previousFocus.focus()
  }
  previousFocus = null
}

// ─── Render results ──────────────────────────────────────────

function render(query) {
  const { views, commands } = search(query)
  flatItems = []
  let html = ''

  if (views.length) {
    html += '<div class="cmdk-group-label">Views</div>'
    for (const v of views) {
      const idx = flatItems.length
      flatItems.push(v)
      const itemId = `cmdk-item-${idx}`
      html += `<div class="cmdk-item${idx === activeIndex ? ' active' : ''}" id="${itemId}" data-idx="${idx}" role="option">
        <span class="cmdk-item-icon">${v.icon}</span>
        <span class="cmdk-item-label">${v.label}</span>
        <span class="cmdk-item-desc">${v.keywords[0] || ''}</span>
      </div>`
    }
  }

  if (commands.length) {
    html += '<div class="cmdk-group-label">Commands</div>'
    for (const c of commands) {
      const idx = flatItems.length
      flatItems.push(c)
      const itemId = `cmdk-item-${idx}`
      html += `<div class="cmdk-item${idx === activeIndex ? ' active' : ''}" id="${itemId}" data-idx="${idx}" role="option">
        <span class="cmdk-item-icon">/</span>
        <span class="cmdk-item-label">${c.cmd}</span>
        <span class="cmdk-item-desc">${c.description}</span>
      </div>`
    }
  }

  if (!views.length && !commands.length) {
    html = '<div class="cmdk-empty">No matches</div>'
  }

  results.innerHTML = html

  // Update aria-activedescendant for screen readers
  if (flatItems.length) {
    input.setAttribute('aria-activedescendant', `cmdk-item-${activeIndex}`)
  } else {
    input.removeAttribute('aria-activedescendant')
  }
}

// ─── Dispatch ────────────────────────────────────────────────

function dispatch(item) {
  close()
  if (item.type === 'view') {
    const navItem = document.querySelector(`.nav-item[data-view="${item.id}"]`)
    if (navItem) navItem.click()
  } else if (item.type === 'command') {
    // Navigate to terminal
    document.querySelector('.nav-item[data-view="terminal"]').click()
    // Ensure a session exists, then send
    setTimeout(() => {
      if (!state.activeId) spawnSession()
      setTimeout(() => sendToActive(item.cmd + '\r'), 80)
    }, 120)
  }
}

// ─── Keyboard handling ───────────────────────────────────────

function onInputKeydown(e) {
  if (e.key === 'ArrowDown') {
    e.preventDefault()
    activeIndex = Math.min(activeIndex + 1, flatItems.length - 1)
    render(input.value)
    scrollToActive()
  } else if (e.key === 'ArrowUp') {
    e.preventDefault()
    activeIndex = Math.max(activeIndex - 1, 0)
    render(input.value)
    scrollToActive()
  } else if (e.key === 'Enter') {
    e.preventDefault()
    if (flatItems[activeIndex]) dispatch(flatItems[activeIndex])
  } else if (e.key === 'Escape') {
    e.preventDefault()
    close()
  }
}

function scrollToActive() {
  const el = results.querySelector('.cmdk-item.active')
  if (el) el.scrollIntoView({ block: 'nearest' })
}

// ─── Event listeners ─────────────────────────────────────────

export function initCommandBar() {
  // Global Cmd+K / Ctrl+K
  document.addEventListener('keydown', (e) => {
    if ((e.metaKey || e.ctrlKey) && e.key === 'k') {
      e.preventDefault()
      e.stopPropagation()
      open()
    }
  }, true)  // capture phase to beat xterm

  // Input filtering
  input.addEventListener('input', () => {
    activeIndex = 0
    render(input.value)
  })

  // Input keyboard nav
  input.addEventListener('keydown', onInputKeydown)

  // Click on result item
  results.addEventListener('click', (e) => {
    const item = e.target.closest('.cmdk-item')
    if (!item) return
    const idx = parseInt(item.dataset.idx, 10)
    if (flatItems[idx]) dispatch(flatItems[idx])
  })

  // Backdrop click to close
  backdrop.addEventListener('click', close)

  // Sidebar hint click to open
  document.getElementById('cmdk-hint-sidebar')?.addEventListener('click', open)
}
