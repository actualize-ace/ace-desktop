// renderer/modules/split-pane-manager.js
import { state } from '../state.js'

const splitState = {
  active: false,
  ratio: parseFloat(localStorage.getItem('ace-split-ratio') || '0.5'),
}

function persistState() {
  localStorage.setItem('ace-split-active', splitState.active ? '1' : '0')
  localStorage.setItem('ace-split-ratio', splitState.ratio.toString())
}

// ─── Create / Destroy ────────────────────────────────────────────────────────

export function initSplit() {
  if (splitState.active) return
  splitState.active = true

  const layout = document.getElementById('split-layout')
  const leftGroup = document.getElementById('pane-group-left')

  // Create resizer
  const resizer = document.createElement('div')
  resizer.className = 'split-v-resizer'
  resizer.id = 'split-resizer'
  layout.appendChild(resizer)

  // Create right pane group
  const rightGroup = document.createElement('div')
  rightGroup.className = 'pane-group'
  rightGroup.id = 'pane-group-right'
  rightGroup.innerHTML = `
    <div class="session-tabs" id="session-tabs-right">
      <button class="stab-add" id="new-session-btn-right" title="New session">+</button>
      <button class="stab-collapse" id="collapse-btn" title="Close split">×</button>
    </div>
    <div class="pane-group-content" id="pane-content-right"></div>`
  layout.appendChild(rightGroup)

  // Apply ratio
  applyRatio()

  // Wire right pane "+" button
  document.getElementById('new-session-btn-right').addEventListener('click', () => {
    window.spawnSession({
      container: document.getElementById('pane-content-right'),
      tabBar: document.getElementById('session-tabs-right'),
    })
  })

  // Wire collapse button
  document.getElementById('collapse-btn').addEventListener('click', () => collapseSplit())

  // Wire resizer drag
  wireResizer(resizer, leftGroup, rightGroup)

  // Observe right pane for terminal fit
  const ro = new ResizeObserver(() => {
    const rightActiveId = state.splitActiveIds?.right
    if (rightActiveId && state.sessions[rightActiveId]?.mode === 'terminal' && state.sessions[rightActiveId]?.fitAddon) {
      state.sessions[rightActiveId].fitAddon.fit()
    }
  })
  ro.observe(document.getElementById('pane-content-right'))
  splitState._rightResizeObserver = ro

  // Update split button
  document.getElementById('split-btn').classList.add('active')

  persistState()
}

export function collapseSplit() {
  if (!splitState.active) return
  splitState.active = false

  const leftContainer = document.getElementById('pane-content-left')
  const leftTabBar = document.getElementById('session-tabs-left')
  const rightContainer = document.getElementById('pane-content-right')
  const rightTabBar = document.getElementById('session-tabs-right')

  // Move all right-pane sessions to left
  if (rightContainer && leftContainer) {
    const rightPanes = Array.from(rightContainer.querySelectorAll('.term-pane'))
    rightPanes.forEach(pane => leftContainer.appendChild(pane))

    const rightTabs = Array.from(rightTabBar.querySelectorAll('.stab'))
    const addBtn = leftTabBar.querySelector('.stab-add')
    rightTabs.forEach(tab => {
      // Update move icon direction
      const moveIcon = tab.querySelector('.stab-move')
      if (moveIcon) moveIcon.textContent = '→'
      leftTabBar.insertBefore(tab, addBtn)
    })
  }

  // Cleanup any in-progress drag listeners
  if (splitState._cleanupDrag) { splitState._cleanupDrag(); splitState._cleanupDrag = null }

  // Remove right group and resizer
  document.getElementById('pane-group-right')?.remove()
  document.getElementById('split-resizer')?.remove()

  // Cleanup resize observer
  if (splitState._rightResizeObserver) {
    splitState._rightResizeObserver.disconnect()
    splitState._rightResizeObserver = null
  }

  // Reset flex-basis on left group
  document.getElementById('pane-group-left').style.flexBasis = ''
  document.getElementById('pane-group-left').style.flexGrow = ''

  // Update split button
  document.getElementById('split-btn').classList.remove('active')

  // Activate the last session in left if needed
  const leftPanes = document.getElementById('pane-content-left').querySelectorAll('.term-pane')
  if (leftPanes.length > 0) {
    const lastPane = leftPanes[leftPanes.length - 1]
    const lastId = lastPane.id.replace('pane-', '')
    if (state.sessions[lastId]) {
      window.activateSession(lastId)
    }
  }

  // Update state
  if (state.splitActiveIds) {
    state.splitActiveIds.right = null
  }

  persistState()
}

// Called by session-manager when a pane group becomes empty
export function checkCollapse(groupContentEl) {
  if (!splitState.active) return
  if (groupContentEl.id === 'pane-content-right') {
    collapseSplit()
  } else if (groupContentEl.id === 'pane-content-left') {
    // Left is empty — collapseSplit will move everything from right to left
    collapseSplit()
  }
}

// ─── Move Tab Between Groups ─────────────────────────────────────────────────

export function moveToOtherGroup(sessionId) {
  const s = state.sessions[sessionId]
  if (!s) return

  const currentGroup = s.pane.parentElement
  const isInLeft = currentGroup.id === 'pane-content-left'

  // If no split yet, create one
  if (!splitState.active) {
    initSplit()
  }

  const targetContainer = isInLeft
    ? document.getElementById('pane-content-right')
    : document.getElementById('pane-content-left')
  const targetTabBar = isInLeft
    ? document.getElementById('session-tabs-right')
    : document.getElementById('session-tabs-left')

  // Move pane
  targetContainer.appendChild(s.pane)

  // Move tab
  const addBtn = targetTabBar.querySelector('.stab-add')
  targetTabBar.insertBefore(s.tab, addBtn)

  // Update move icon direction
  const moveIcon = s.tab.querySelector('.stab-move')
  if (moveIcon) moveIcon.textContent = isInLeft ? '←' : '→'

  // Activate in new group
  window.activateSession(sessionId)

  // Check if old group is now empty — if so, spawn a new session there
  const oldGroupPanes = currentGroup.querySelectorAll('.term-pane')
  if (oldGroupPanes.length === 0) {
    const oldTabBar = isInLeft
      ? document.getElementById('session-tabs-left')
      : document.getElementById('session-tabs-right')
    window.spawnSession({
      container: currentGroup,
      tabBar: oldTabBar,
    })
  }
}

// ─── Resizer ─────────────────────────────────────────────────────────────────

function wireResizer(resizer, leftGroup, rightGroup) {
  let startX, startLeftWidth, totalWidth

  function onMouseDown(e) {
    e.preventDefault()
    startX = e.clientX
    startLeftWidth = leftGroup.getBoundingClientRect().width
    totalWidth = leftGroup.getBoundingClientRect().width + rightGroup.getBoundingClientRect().width
    resizer.classList.add('dragging')
    leftGroup.classList.add('no-transition')
    rightGroup.classList.add('no-transition')
    document.addEventListener('mousemove', onMouseMove)
    document.addEventListener('mouseup', onMouseUp)
  }

  function onMouseMove(e) {
    const dx = e.clientX - startX
    let newLeftWidth = startLeftWidth + dx
    // Enforce min widths (300px each side)
    newLeftWidth = Math.max(300, Math.min(newLeftWidth, totalWidth - 300))
    const ratio = newLeftWidth / totalWidth
    splitState.ratio = ratio
    applyRatio()
  }

  function onMouseUp() {
    resizer.classList.remove('dragging')
    leftGroup.classList.remove('no-transition')
    rightGroup.classList.remove('no-transition')
    document.removeEventListener('mousemove', onMouseMove)
    document.removeEventListener('mouseup', onMouseUp)
    // Persist ratio + active state
    persistState()
    // Refit terminals in both panes
    window.fitActive?.()
  }

  resizer.addEventListener('mousedown', onMouseDown)

  splitState._cleanupDrag = () => {
    document.removeEventListener('mousemove', onMouseMove)
    document.removeEventListener('mouseup', onMouseUp)
  }
}

function applyRatio() {
  const left = document.getElementById('pane-group-left')
  const right = document.getElementById('pane-group-right')
  if (left && right) {
    left.style.flexBasis = (splitState.ratio * 100) + '%'
    right.style.flexBasis = ((1 - splitState.ratio) * 100) + '%'
    left.style.flexGrow = '0'
    right.style.flexGrow = '0'
  }
}

// ─── Getters ─────────────────────────────────────────────────────────────────

export function isSplitActive() { return splitState.active }

// ─── Init ────────────────────────────────────────────────────────────────────

export function initSplitPane() {
  // Wire split button
  document.getElementById('split-btn').addEventListener('click', () => {
    if (splitState.active) {
      collapseSplit()
    } else {
      initSplit()
      // Spawn a new session in the right pane
      window.spawnSession({
        container: document.getElementById('pane-content-right'),
        tabBar: document.getElementById('session-tabs-right'),
      })
    }
  })

  // Restore split state from previous session
  const wasSplit = localStorage.getItem('ace-split-active') === '1'
  if (wasSplit) {
    // Defer to after initial sessions are spawned
    requestAnimationFrame(() => {
      initSplit()
      // Spawn a new session in the right pane
      window.spawnSession({
        container: document.getElementById('pane-content-right'),
        tabBar: document.getElementById('session-tabs-right'),
      })
    })
  }

  // Expose for session-manager
  window.splitPaneManager = { checkCollapse, moveToOtherGroup, isSplitActive }
}
