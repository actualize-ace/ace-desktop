# Slash Command Menu — Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Add an upward-growing autocomplete menu that appears when `/` is typed at position 0 in the chat textarea, letting users discover and insert slash commands without leaving the input.

**Architecture:** New standalone module `slash-menu.js` that attaches to chat textareas via `attach()`. Reuses `command-registry.js` for fuzzy search and `COMMANDS` list. Reads sidebar config for pinned-first ordering. CSS-only positioning (no JS repositioning). No new IPC, no backend changes.

**Tech Stack:** Vanilla JS (ES6 modules), CSS custom properties, existing command-registry fuzzy search.

**Design doc:** [2026-04-11-slash-menu-design.md](2026-04-11-slash-menu-design.md)

---

### Task 1: Create `slash-menu.js` — Core Module

**Files:**
- Create: `renderer/modules/slash-menu.js`

**Step 1: Create the module with exports and state**

Create `renderer/modules/slash-menu.js`:

```js
// renderer/modules/slash-menu.js
// In-chat slash command autocomplete — upward-growing menu triggered by / at position 0.

import { COMMANDS, search } from './command-registry.js'

let menuEl = null        // current menu DOM element
let activeIndex = 0      // keyboard selection index (0 = bottom item, nearest input)
let flatItems = []       // current filtered + ordered items
let attachedInput = null // the textarea the menu is anchored to

// ─── Show / Dismiss ─────────────────────────────────────────

function show(inputEl) {
  dismiss()
  attachedInput = inputEl

  menuEl = document.createElement('div')
  menuEl.className = 'slash-menu'
  menuEl.setAttribute('role', 'listbox')

  // Position: inside .chat-input-area, above the textarea
  inputEl.closest('.chat-input-area').appendChild(menuEl)

  updateFilter('')
  document.addEventListener('click', onOutsideClick, true)
}

function dismiss() {
  if (menuEl) {
    menuEl.remove()
    menuEl = null
  }
  flatItems = []
  activeIndex = 0
  attachedInput = null
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

function getPinnedCmds() {
  try {
    const cfg = window.ace?.setup?.getConfigSync?.() || {}
    const sidebar = cfg.sidebar?.commands || []
    return sidebar.map(c => c.cmd)
  } catch { return [] }
}

function updateFilter(query) {
  const { commands } = search(query)
  const pinnedCmds = getPinnedCmds()

  // Partition into pinned (sidebar order) and unpinned (score order)
  const pinned = []
  const unpinned = []
  for (const cmd of commands) {
    if (pinnedCmds.includes(cmd.cmd)) {
      pinned.push({ ...cmd, pinned: true })
    } else {
      unpinned.push(cmd)
    }
  }
  // Sort pinned by sidebar order
  pinned.sort((a, b) => pinnedCmds.indexOf(a.cmd) - pinnedCmds.indexOf(b.cmd))

  flatItems = [...pinned, ...unpinned]
  activeIndex = Math.max(0, flatItems.length - 1) // start at bottom (nearest input)

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
    const pinMark = item.pinned ? '<span class="slash-menu-pin">★</span>' : ''
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

  attachedInput.value = item.cmd + ' '
  attachedInput.dispatchEvent(new Event('input', { bubbles: true }))
  dismiss()
  attachedInput.focus()
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

export function attach(inputEl) {
  inputEl.addEventListener('input', () => {
    const val = inputEl.value
    // Trigger: / at position 0
    if (val.startsWith('/')) {
      const query = val.slice(1) // everything after /
      if (!isOpen()) {
        show(inputEl)
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
        e.stopPropagation()
        selectCurrent()
      }
    } else if (e.key === 'Escape') {
      e.preventDefault()
      e.stopPropagation()
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
```

**Step 2: Commit**

```bash
git add renderer/modules/slash-menu.js
git commit -m "feat: add slash-menu module for in-chat command autocomplete"
```

---

### Task 2: Add CSS for the Slash Menu

**Files:**
- Modify: `renderer/styles/chat.css` (append after line 552)

**Step 1: Add slash menu styles**

Append to the end of `renderer/styles/chat.css`:

```css
/* ── SLASH COMMAND MENU ── */
.chat-input-area {
  position: relative; /* anchor for absolute menu */
}
.slash-menu {
  position: absolute;
  bottom: 100%;
  left: 24px;
  right: 24px;
  max-height: 296px; /* ~8 items at 37px each */
  overflow-y: auto;
  display: flex;
  flex-direction: column;
  background: var(--bg-card);
  border: 1px solid var(--border);
  border-bottom: none;
  border-radius: 8px 8px 0 0;
  box-shadow: 0 -4px 24px rgba(0,0,0,0.25);
  z-index: 100;
  animation: slash-menu-in 0.1s ease;
}
@keyframes slash-menu-in {
  from { opacity: 0; transform: translateY(4px); }
  to   { opacity: 1; transform: translateY(0); }
}
.slash-menu::-webkit-scrollbar { width: 4px; }
.slash-menu::-webkit-scrollbar-thumb { background: var(--border-hover); border-radius: 2px; }
.slash-menu-item {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 8px 14px;
  cursor: pointer;
  border-left: 2px solid transparent;
  transition: background 0.08s;
}
.slash-menu-item:hover {
  background: rgba(255,255,255,0.03);
}
.slash-menu-item.active {
  background: rgba(255,255,255,0.04);
  border-left: 2px solid var(--gold);
}
.slash-menu-cmd {
  font-family: 'JetBrains Mono', monospace;
  font-size: 12px;
  color: var(--text-primary);
  min-width: 140px;
}
.slash-menu-pin {
  font-size: 9px;
  color: var(--gold-dim);
  margin-right: 2px;
}
.slash-menu-desc {
  font-size: 11px;
  color: var(--text-dim);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  flex: 1;
}
.slash-menu-empty {
  padding: 12px 14px;
  font-family: 'JetBrains Mono', monospace;
  font-size: 11px;
  color: var(--text-dim);
  text-align: center;
}

/* Light mode */
body.light .slash-menu {
  background: #f2f2f7;
  border-color: #c8c8d4;
  box-shadow: 0 -4px 24px rgba(0,0,0,0.1);
}
body.light .slash-menu-item:hover {
  background: rgba(0,0,0,0.04);
}
body.light .slash-menu-item.active {
  background: rgba(0,0,0,0.06);
}
```

**Step 2: Commit**

```bash
git add renderer/styles/chat.css
git commit -m "style: add slash menu CSS with upward positioning and light mode"
```

---

### Task 3: Wire Slash Menu into Session Manager

**Files:**
- Modify: `renderer/modules/session-manager.js:1` (add import)
- Modify: `renderer/modules/session-manager.js:933` (integrate with keydown)

**Step 1: Add import**

At `session-manager.js:9` (after the last existing import), add:

```js
import { attach as attachSlashMenu } from './slash-menu.js'
```

**Step 2: Attach slash menu after textarea creation**

At `session-manager.js:931` (after `const sendBtn = ...`, before the keydown listener), add:

```js
  attachSlashMenu(inputEl)
```

**Step 3: Guard existing Enter handler**

The existing keydown listener at line 933 sends the message on Enter. But when the slash menu is open, Enter should select from the menu (handled by slash-menu.js via `stopPropagation`). The slash-menu keydown listener is registered first (via `attach()`), so it calls `e.stopPropagation()` when it handles Enter — but `stopPropagation` doesn't stop other listeners on the same element. We need `e.stopImmediatePropagation()` in slash-menu.js, OR we guard the session-manager listener.

**Simpler approach:** Update the session-manager keydown handler to check if a slash menu consumed the event. The slash-menu already calls `e.preventDefault()`. So check `e.defaultPrevented`:

Replace the keydown listener at lines 933-944:

```js
  inputEl.addEventListener('keydown', e => {
    if (e.key === 'Enter' && !e.shiftKey) {
      if (e.__slashMenuHandled) return  // slash menu consumed this
      e.preventDefault()
      const prompt = inputEl.value
      if (!prompt.trim()) return
      inputEl.value = ''
      inputEl.style.height = 'auto'
      sendChatMessage(id, prompt)
    }
    if (e.key === 'Escape' && state.sessions[id].isStreaming) {
      window.ace.chat.cancel(id)
    }
  })
```

And update `slash-menu.js` Enter handler to set the flag: change the Enter block in the keydown listener inside `attach()` to:

```js
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
```

**Step 4: Dismiss on streaming start**

The slash menu should dismiss when streaming starts (user won't be selecting commands while Claude is responding). In the existing `wireChatListeners` function, or simpler: the `input` event handler in slash-menu.js already dismisses when text doesn't start with `/` — and when a message sends, the input clears, which triggers `input` and dismiss. So this is already handled naturally.

**Step 5: Commit**

```bash
git add renderer/modules/session-manager.js renderer/modules/slash-menu.js
git commit -m "feat: wire slash menu into chat input with event coordination"
```

---

### Task 4: Handle Config Access for Pinned Commands

**Files:**
- Modify: `renderer/modules/slash-menu.js` (update `getPinnedCmds`)

**Step 1: Verify config access pattern**

The `getPinnedCmds()` function uses `window.ace.setup.getConfigSync()`. Check if this exists. If not, the sidebar commands are also stored in the settings module. Check what's available:

```bash
cd /Users/nikhilkale/Documents/Actualize/ace-desktop && grep -n 'getConfigSync\|getConfig' renderer/modules/*.js renderer/views/*.js src/preload.js
```

If `getConfigSync` doesn't exist but `getConfig` is async, we need to cache the config. Simplest fix: read config once at `show()` time since we already have an async boundary there. Or read from the settings module's exported state.

**Step 2: Adapt to actual config access**

If config is only available async via `window.ace.setup.getConfig()`:

```js
async function getPinnedCmds() {
  try {
    const cfg = await window.ace.setup.getConfig()
    const sidebar = cfg.sidebar?.commands || []
    return sidebar.map(c => c.cmd)
  } catch { return [] }
}
```

And make `show()` async:

```js
async function show(inputEl) {
  dismiss()
  attachedInput = inputEl
  menuEl = document.createElement('div')
  menuEl.className = 'slash-menu'
  menuEl.setAttribute('role', 'listbox')
  inputEl.closest('.chat-input-area').appendChild(menuEl)
  await updateFilter('')
  document.addEventListener('click', onOutsideClick, true)
}
```

If config is available synchronously (e.g., cached in a module-level variable), keep it sync.

**Step 3: Commit (if changes needed)**

```bash
git add renderer/modules/slash-menu.js
git commit -m "fix: adapt slash menu config access to actual API"
```

---

### Task 5: Manual Test Pass

**Files:** None (testing only)

**Step 1: Launch the app**

```bash
cd /Users/nikhilkale/Documents/Actualize/ace-desktop && npm start
```

**Step 2: Test matrix**

| Test | Expected |
|------|----------|
| Type `/` in chat textarea | Menu appears above input with all 25 commands, sidebar pinned ones first with ★ |
| Type `/co` | Filters to `/coach`, `/content`, `/close`, `/commit`, `/close` |
| Arrow Up/Down | Selection moves through list, active item has gold left border |
| Enter on selected item | Command inserted into textarea with trailing space, menu dismisses |
| Type context after inserted command | Text appends normally: `/coach I'm feeling stuck` |
| Hit Enter after typing context | Message sends normally (no menu interference) |
| Escape while menu is open | Menu dismisses, textarea text stays |
| Backspace to remove `/` | Menu dismisses |
| Click outside menu | Menu dismisses |
| Click a menu item | That command inserted, menu dismisses |
| Type `/` then no matches (`/zzz`) | Shows "No matches" |
| Open menu, start streaming (send a message from another pane) | Menu unaffected (only this textarea's state matters) |
| Light mode toggle | Menu renders with light mode colors |
| Two chat panes open, type `/` in each | Only one menu visible at a time |

**Step 3: Fix any issues found, commit fixes individually**

---

### Task 6: Update ROADMAP.md

**Files:**
- Modify: `ace-desktop/ROADMAP.md`

**Step 1: Move slash menu from Post-Ship to Phase 1 as Done**

Add to the Phase 1 table:

```
| Slash command menu | Done | — | Inline `/` autocomplete in chat textarea. Upward menu, pinned-first, fuzzy filter, insert-on-select. Commit `{hash}`. [Design](docs/plans/2026-04-11-slash-menu-design.md) |
```

Remove or strike through the slash menu entry in the Post-Ship section.

**Step 2: Update the design docs table**

Add:

```
| [2026-04-11-slash-menu-design.md](docs/plans/2026-04-11-slash-menu-design.md) | Shipped |
| [2026-04-11-slash-menu.md](docs/plans/2026-04-11-slash-menu.md) | Shipped |
```

**Step 3: Commit**

```bash
git add ace-desktop/ROADMAP.md
git commit -m "docs: mark slash command menu as shipped in ROADMAP"
```
