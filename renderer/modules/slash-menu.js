// renderer/modules/slash-menu.js
// In-chat slash command autocomplete — upward-growing menu triggered by / at position 0.

import { COMMANDS, search, rescanCommands } from './command-registry.js'

let menuEl = null        // current menu DOM element
let activeIndex = 0      // keyboard selection index (0 = bottom item, nearest input)
let flatItems = []       // current filtered + ordered items
let attachedInput = null // the textarea the menu is anchored to
let cachedPinnedCmds = [] // pinned commands cached per menu open
// Note: send callback is stored per-input (inputEl._slashMenuSend) so multiple
// chat sessions don't clobber each other's callbacks.

// ─── Show / Dismiss ─────────────────────────────────────────

async function show(inputEl) {
  dismiss()
  attachedInput = inputEl

  // Cache pinned commands once per menu session (async config)
  cachedPinnedCmds = await fetchPinnedCmds()

  menuEl = document.createElement('div')
  menuEl.className = 'slash-menu'
  menuEl.setAttribute('role', 'listbox')

  // Position: inside .chat-input-area, above the textarea
  inputEl.closest('.chat-input-area').appendChild(menuEl)

  updateFilter('')
  document.addEventListener('click', onOutsideClick, true)

  // Fire-and-forget rescan: only re-filter if the skill set actually changed.
  rescanCommands().then(changed => { if (changed && menuEl) updateFilter(currentQuery()) })
}

function currentQuery() {
  if (!attachedInput) return ''
  const v = attachedInput.value || ''
  return v.startsWith('/') ? v.slice(1) : ''
}

function dismiss() {
  if (menuEl) {
    menuEl.remove()
    menuEl = null
  }
  flatItems = []
  activeIndex = 0
  attachedInput = null
  cachedPinnedCmds = []
  document.removeEventListener('click', onOutsideClick, true)
}

function isOpen() {
  return menuEl !== null
}

function onOutsideClick(e) {
  if (menuEl && !menuEl.contains(e.target) && e.target !== attachedInput) {
    dismiss()
  }
}

// ─── Filter + Render ────────────────────────────────────────

async function fetchPinnedCmds() {
  try {
    const cfg = await window.ace.setup.getConfig()
    const sidebar = cfg.sidebar?.commands || []
    return sidebar.map(c => c.cmd)
  } catch { return [] }
}

function updateFilter(query) {
  const { commands } = search(query)

  // Partition into pinned (sidebar order) and unpinned (score order)
  const pinned = []
  const unpinned = []
  for (const cmd of commands) {
    if (cachedPinnedCmds.includes(cmd.cmd)) {
      pinned.push({ ...cmd, pinned: true })
    } else {
      unpinned.push(cmd)
    }
  }
  // Sort pinned by sidebar order
  pinned.sort((a, b) => cachedPinnedCmds.indexOf(a.cmd) - cachedPinnedCmds.indexOf(b.cmd))

  flatItems = [...pinned, ...unpinned]
  activeIndex = 0 // select best match (highest score)

  render()
}

function render() {
  if (!menuEl) return

  if (flatItems.length === 0) {
    menuEl.innerHTML = '<div class="slash-menu-empty">No matches</div>'
    return
  }

  let html = ''
  for (let i = 0; i < flatItems.length; i++) {
    const item = flatItems[i]
    const active = i === activeIndex ? ' active' : ''
    const pinMark = item.pinned ? '<span class="slash-menu-pin">\u2605</span>' : ''
    html += `<div class="slash-menu-item${active}" data-idx="${i}" role="option">
      <span class="slash-menu-cmd">${item.cmd}</span>${pinMark}<span class="slash-menu-desc">${item.description}</span>
    </div>`
  }
  menuEl.innerHTML = html

  // Scroll active item into view
  const activeEl = menuEl.querySelector('.slash-menu-item.active')
  if (activeEl) activeEl.scrollIntoView({ block: 'nearest' })
}

// ─── Selection ──────────────────────────────────────────────

function selectCurrent() {
  if (flatItems.length === 0 || !attachedInput) return
  const item = flatItems[activeIndex]
  if (!item) return

  const input = attachedInput
  const send = input._slashMenuSend
  input.value = ''
  input.style.height = 'auto'
  dismiss()

  // Auto-send the command — use per-input callback so multi-session doesn't clobber
  if (send) send(item.cmd)
}

// ─── Keyboard Navigation ────────────────────────────────────

function moveUp() {
  if (flatItems.length === 0) return
  activeIndex = Math.max(0, activeIndex - 1)
  render()
}

function moveDown() {
  if (flatItems.length === 0) return
  activeIndex = Math.min(flatItems.length - 1, activeIndex + 1)
  render()
}

// ─── Click handler ──────────────────────────────────────────

function onMenuClick(e) {
  const item = e.target.closest('.slash-menu-item')
  if (!item) return
  activeIndex = parseInt(item.dataset.idx)
  selectCurrent()
}

// ─── Attach to a textarea ───────────────────────────────────

export function attach(inputEl, { send } = {}) {
  // Store per-input so each chat session keeps its own callback.
  inputEl._slashMenuSend = send || null

  inputEl.addEventListener('input', async () => {
    const val = inputEl.value
    // Trigger: / at position 0
    if (val.startsWith('/')) {
      const query = val.slice(1) // everything after /
      if (!isOpen()) {
        await show(inputEl)
      }
      updateFilter(query)
    } else if (isOpen()) {
      dismiss()
    }
  })

  inputEl.addEventListener('keydown', e => {
    if (!isOpen()) return

    if (e.key === 'ArrowUp') {
      e.preventDefault()
      moveUp()
    } else if (e.key === 'ArrowDown') {
      e.preventDefault()
      moveDown()
    } else if (e.key === 'Enter' && !e.shiftKey) {
      if (flatItems.length > 0) {
        e.preventDefault()
        e.__slashMenuHandled = true
        selectCurrent()
      }
    } else if (e.key === 'Escape') {
      e.preventDefault()
      e.__slashMenuHandled = true
      dismiss()
    }
  })
}

// ─── Event delegation for clicks inside menu ────────────────

document.addEventListener('click', (e) => {
  if (menuEl && menuEl.contains(e.target)) {
    onMenuClick(e)
  }
})
