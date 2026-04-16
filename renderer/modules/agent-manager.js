// renderer/modules/agent-manager.js
import { state } from '../state.js'
import { xtermTheme } from './theme.js'
import { escapeHtml, SANITIZE_CONFIG, findSettledBoundary, renderTail, postProcessCodeBlocks, processWikilinks, syntaxHighlight } from './chat-renderer.js'
import { updateOrbState, aceMarkSvg } from './ace-mark.js'
import { setAttention, clearAttention } from './attention.js'
import { sendChatMessage, wireChatListeners, scheduleRender } from './session-manager.js'
import { pickAndStage, wireDropZone, wirePasteHandler } from './attachment-handler.js'

// Single global exit handler — fires for ALL PTY sessions; filter to agents only
export function wireAgentExitHandler() {
  window.ace.pty.onSessionExit((exitId, code) => {
    if (!state.agentSessions[exitId]) return
    state.agentSessions[exitId].status = code === 0 ? 'complete' : 'error'
    updateAgentDots(exitId)
    // Notification parity with terminal sessions — flag attention if the
    // user isn't currently focused on this agent's pane.
    const agentsVisible = document.getElementById('view-agents')?.classList.contains('active')
    const isFocused = agentsVisible && exitId === state.focusedAgentId
    if (!isFocused) setAttention(exitId, state.agentSessions, code === 0 ? 'exit' : 'error')
  })
}

export function agentElapsed(id) {
  if (!state.agentSessions[id]) return '0:00'
  const sec = Math.floor((Date.now() - state.agentSessions[id].spawnTime) / 1000)
  return `${Math.floor(sec / 60)}:${String(sec % 60).padStart(2, '0')}`
}

export function agentDotClass(id) {
  const s = state.agentSessions[id]
  if (!s) return 'waiting'
  if (s.status === 'complete') return 'complete'
  if (s.status === 'error')    return 'error'
  if (s.status === 'waiting')  return 'waiting'
  const isOrch = document.getElementById('panes-top')?.querySelector('#pane-' + id) !== null
  return isOrch ? 'orchestrating' : 'running'
}

export function updateAgentDots(id) {
  const cls   = agentDotClass(id)
  const s     = state.agentSessions[id]
  const attn  = s?.needsAttention ? ' attention' : ''
  const apDot = document.querySelector(`#pane-${id} .ap-dot`)
  if (apDot) apDot.className = 'ap-dot ' + cls + attn
  const arDot = document.querySelector(`#ar-item-${id} .ar-dot`)
  if (arDot) arDot.className = 'ar-dot ' + (cls === 'orchestrating' ? 'orch' : cls) + attn
}

export function refreshAgentsLayout() {
  const topEl    = document.getElementById('panes-top')
  const botEl    = document.getElementById('panes-bottom')
  const hResizer = document.getElementById('panes-h-resizer')
  const hasBottom = botEl?.querySelector('.apane') !== null
  if (hResizer) hResizer.style.display = hasBottom ? '' : 'none'
  if (topEl)    topEl.style.flex = hasBottom ? '' : '1'
  if (botEl)    botEl.style.flex = hasBottom ? '1' : '0'
  // Set initial 50/50 split when bottom row first gets an agent
  if (hasBottom && !topEl.style.height) {
    topEl.style.height = (topEl.parentElement.clientHeight / 2) + 'px'
  }
  if (!hasBottom) topEl.style.height = ''
  Object.keys(state.agentSessions).forEach(id => {
    requestAnimationFrame(() => state.agentSessions[id]?.fitAddon?.fit())
  })
}

export function spawnAgentPane(targetRow) {
  const topEl = document.getElementById('panes-top')
  const botEl = document.getElementById('panes-bottom')
  if (!targetRow) targetRow = topEl.querySelector('.apane') ? 'bottom' : 'top'

  const id       = 'agent-' + Date.now()
  const isTop    = targetRow === 'top'
  const roleName = isTop ? 'orchestrator' : 'agent'

  const pane = document.createElement('div')
  pane.className = 'apane'; pane.id = 'pane-' + id
  pane.innerHTML = `
    <div class="apane-tab" id="aptab-${id}">
      <div class="ap-dot waiting"></div>
      <span class="ap-role">${roleName}</span>
      <span class="ap-name-label">${id.slice(-6)}</span>
      <span class="ap-task-label" id="ap-task-${id}">starting…</span>
      <button class="mode-toggle-btn" id="agent-mode-toggle-${id}">Terminal</button>
      <span class="ap-tokens" id="ap-tokens-${id}">↑ 0 lines</span>
      <span class="ap-time-label" id="ap-time-${id}">0:00</span>
      <span class="ap-close-btn" id="ap-close-${id}">×</span>
    </div>
    <div class="chat-view" id="chat-view-${id}">
      <div class="chat-messages" id="chat-msgs-${id}">
        <div class="chat-welcome">
          <div class="chat-welcome-icon">${aceMarkSvg(36)}</div>
          <div class="chat-welcome-text">Agent Chat</div>
          <div class="chat-welcome-sub">Enter to send · Shift+Enter for newline</div>
        </div>
      </div>
      <div class="chat-status" id="chat-status-${id}">
        <span class="chat-cost-label">$0.00</span>
        <span class="chat-tokens-label">0 tokens</span>
        <div class="ctx-bar" id="ctx-bar-${id}" title="Context usage">
          <div class="ctx-bar-fill" id="ctx-fill-${id}"></div>
        </div>
        <span class="ctx-bar-pct" id="ctx-label-${id}">0%</span>
      </div>
      <div class="chat-controls" id="chat-controls-${id}">
        <select class="chat-select" id="chat-model-${id}" title="Model">
          <option value="opus" ${state.chatDefaults.model === 'opus' ? 'selected' : ''}>Opus</option>
          <option value="sonnet" ${state.chatDefaults.model === 'sonnet' ? 'selected' : ''}>Sonnet</option>
          <option value="haiku" ${state.chatDefaults.model === 'haiku' ? 'selected' : ''}>Haiku</option>
        </select>
        <select class="chat-select" id="chat-perms-${id}" title="Permission mode">
          <option value="default" ${state.chatDefaults.permissions === 'default' ? 'selected' : ''}>Normal</option>
          <option value="plan" ${state.chatDefaults.permissions === 'plan' ? 'selected' : ''}>Plan</option>
          <option value="auto" ${state.chatDefaults.permissions === 'auto' ? 'selected' : ''}>Auto-accept</option>
        </select>
        <select class="chat-select" id="chat-effort-${id}" title="Reasoning effort">
          <option value="low" ${state.chatDefaults.effort === 'low' ? 'selected' : ''}>Low effort</option>
          <option value="medium" ${state.chatDefaults.effort === 'medium' ? 'selected' : ''}>Medium</option>
          <option value="high" ${state.chatDefaults.effort === 'high' ? 'selected' : ''}>High</option>
          <option value="max" ${state.chatDefaults.effort === 'max' ? 'selected' : ''}>Max effort</option>
        </select>
      </div>
      <div class="chat-attachments" id="chat-attachments-${id}"></div>
      <div class="chat-input-area">
        <button class="chat-attach-btn" id="chat-attach-${id}" title="Attach · drag, paste, or click" aria-label="Attach file">
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21.44 11.05l-9.19 9.19a6 6 0 0 1-8.49-8.49l9.19-9.19a4 4 0 0 1 5.66 5.66l-9.2 9.19a2 2 0 0 1-2.83-2.83l8.49-8.49"/></svg>
        </button>
        <textarea class="chat-input" id="chat-input-${id}" placeholder="Message ACE..." rows="1"></textarea>
        <button class="chat-send-btn" id="chat-send-${id}">↑</button>
      </div>
    </div>
    <div class="term-xterm" id="xterm-${id}" style="display:none"></div>
    <button class="scroll-to-bottom" id="scroll-btn-${id}" title="Scroll to bottom" style="display:none">↓</button>`

  if (!isTop && botEl.querySelector('.apane')) {
    const vRes = document.createElement('div')
    vRes.className = 'panes-v-resizer'
    vRes.dataset.forPane = id
    botEl.appendChild(vRes)
    wireVResizer(vRes, id)
  }
  ;(isTop ? topEl : botEl).appendChild(pane)

  const arItem = document.createElement('div')
  arItem.className = 'ar-item'; arItem.id = 'ar-item-' + id
  arItem.innerHTML = `
    <div class="ar-dot waiting"></div>
    <span class="ar-name">${id.slice(-6)}</span>
    <span class="ar-time" id="ar-time-${id}">0:00</span>`
  arItem.addEventListener('click', () => focusAgentPane(id))
  document.getElementById('ar-list').appendChild(arItem)

  state.agentSessions[id] = {
    term: null, fitAddon: null, pane, rosterItem: arItem, role: roleName,
    spawnTime: Date.now(), lineCount: 0, status: 'waiting',
    mode: 'chat',
    claudeSessionId: null, messages: [], pendingAttachments: [], currentStreamText: '', currentToolInput: '',
    isStreaming: false, totalCost: 0, totalTokens: { input: 0, output: 0 },
    needsAttention: false, attentionReason: null, attentionAt: null,
    _settledBoundary: 0, _settledHTML: '', _currentAssistantEl: null, _pendingRAF: null, _currentToolBlock: null,
  }

  // Chat input handling for agent
  const inputEl = document.getElementById('chat-input-' + id)
  const sendBtn = document.getElementById('chat-send-' + id)

  inputEl.addEventListener('keydown', e => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault()
      const prompt = inputEl.value
      if (!prompt.trim()) return
      inputEl.value = ''; inputEl.style.height = 'auto'
      sendChatMessage(id, prompt, state.agentSessions)
    }
    if (e.key === 'Escape' && state.agentSessions[id]?.isStreaming) {
      window.ace.chat.cancel(id)
    }
  })
  inputEl.addEventListener('input', () => {
    inputEl.style.height = 'auto'
    inputEl.style.height = Math.min(inputEl.scrollHeight, 150) + 'px'
    if (state.agentSessions[id]?.isStreaming) {
      const hasText = inputEl.value.trim().length > 0
      sendBtn.textContent = hasText ? '↑' : '■'
      sendBtn.classList.toggle('cancel', !hasText)
    }
  })
  sendBtn.addEventListener('click', () => {
    const prompt = inputEl.value
    if (state.agentSessions[id]?.isStreaming && !prompt.trim()) { window.ace.chat.cancel(id); return }
    if (!prompt.trim()) return
    inputEl.value = ''; inputEl.style.height = 'auto'
    sendChatMessage(id, prompt, state.agentSessions)
  })

  // Attachment handlers
  const attachBtn = document.getElementById('chat-attach-' + id)
  if (attachBtn) {
    attachBtn.addEventListener('click', () => pickAndStage(state.agentSessions[id], id))
  }
  wireDropZone(state.agentSessions[id], id)
  wirePasteHandler(state.agentSessions[id], id)

  // Wire chat listeners for agent
  wireChatListeners(id, state.agentSessions)

  // Mode toggle for agent pane
  document.getElementById('agent-mode-toggle-' + id).addEventListener('click', (e) => {
    e.stopPropagation()
    toggleAgentMode(id)
  })

  document.getElementById('ap-close-' + id).addEventListener('click', e => {
    e.stopPropagation(); closeAgentPane(id)
  })
  document.getElementById('aptab-' + id).addEventListener('click', () => focusAgentPane(id))

  focusAgentPane(id)
  refreshAgentsLayout()
  return id
}

export function toggleAgentMode(id) {
  const s = state.agentSessions[id]
  if (!s) return
  const chatView = document.getElementById('chat-view-' + id)
  const xtermEl = document.getElementById('xterm-' + id)
  const scrollBtn = document.getElementById('scroll-btn-' + id)
  const toggleBtn = document.getElementById('agent-mode-toggle-' + id)

  if (s.mode === 'chat') {
    s.mode = 'terminal'
    chatView.style.display = 'none'
    xtermEl.style.display = ''
    scrollBtn.style.display = ''
    toggleBtn.textContent = 'Chat'

    if (!s.term) {
      const term = new Terminal({
        fontFamily: '"JetBrains Mono", "Fira Code", monospace',
        fontSize: 12.5, lineHeight: 1.5, cursorBlink: true,
        theme: xtermTheme(), allowProposedApi: true,
      })
      const fitAddon = new FitAddon.FitAddon()
      term.loadAddon(fitAddon)
      s.term = term; s.fitAddon = fitAddon

      let agentUserScrolledUp = false
      requestAnimationFrame(() => {
        term.open(xtermEl)
        fitAddon.fit()
        window.ace.pty.create(id, null, term.cols, term.rows).then(() => {
          if (!state.agentSessions[id]) return
          state.agentSessions[id].status = 'running'
          document.getElementById('ap-task-' + id).textContent = 'ready'
          updateAgentDots(id)
        })
        term.onScroll(() => {
          agentUserScrolledUp = term.buffer.active.viewportY < term.buffer.active.baseY
          scrollBtn.classList.toggle('visible', agentUserScrolledUp)
        })
        term.buffer.onBufferChange(() => {
          requestAnimationFrame(() => { term.scrollToBottom(); agentUserScrolledUp = false; scrollBtn.classList.toggle('visible', false) })
        })
      })
      scrollBtn.addEventListener('click', () => {
        term.scrollToBottom(); agentUserScrolledUp = false; scrollBtn.classList.toggle('visible', false)
      })
      window.ace.pty.onData(id, data => {
        if (!state.agentSessions[id]) return
        const wasAtBottom = !agentUserScrolledUp
        term.write(data, () => { if (wasAtBottom) term.scrollToBottom() })
        const newlines = (data.match(/\n/g) || []).length
        if (newlines > 0) {
          state.agentSessions[id].lineCount += newlines
          const el = document.getElementById('ap-tokens-' + id)
          if (el) el.textContent = `↑ ${state.agentSessions[id].lineCount} lines`
        }
      })
      term.onData(d => window.ace.pty.write(id, d))
      term.onResize(({ cols, rows }) => window.ace.pty.resize(id, cols, rows))
    } else {
      requestAnimationFrame(() => s.fitAddon.fit())
    }
  } else {
    s.mode = 'chat'
    chatView.style.display = ''
    xtermEl.style.display = 'none'
    scrollBtn.style.display = 'none'
    toggleBtn.textContent = 'Terminal'
    setTimeout(() => document.getElementById('chat-input-' + id)?.focus(), 50)
  }
}

export function focusAgentPane(id) {
  if (!state.agentSessions[id]) return
  document.querySelectorAll('.apane').forEach(p => p.classList.remove('focused'))
  document.querySelectorAll('.ar-item').forEach(r => r.classList.remove('active'))
  state.agentSessions[id].pane.classList.add('focused')
  state.agentSessions[id].rosterItem.classList.add('active')
  state.focusedAgentId = id
  clearAttention(id, state.agentSessions)
  if (state.agentSessions[id].mode === 'terminal' && state.agentSessions[id].fitAddon) {
    setTimeout(() => state.agentSessions[id]?.fitAddon?.fit(), 50)
  }
}

export function closeAgentPane(id) {
  const s = state.agentSessions[id]
  if (!s) return
  if (s.term) window.ace.pty.kill(id)
  if (s.isStreaming) window.ace.chat.cancel(id)
  if (s._cleanupListeners) s._cleanupListeners()
  const topEl  = document.getElementById('panes-top')
  const botEl  = document.getElementById('panes-bottom')
  const wasTop = topEl.querySelector('#pane-' + id) !== null
  if (!wasTop) {
    const prevSib = s.pane.previousElementSibling
    if (prevSib?.classList.contains('panes-v-resizer')) prevSib.remove()
  }
  s.pane.remove(); s.rosterItem.remove()
  delete state.agentSessions[id]
  if (wasTop) {
    const firstBottom = botEl.querySelector('.apane')
    if (firstBottom) {
      const prevVRes = firstBottom.previousElementSibling
      if (prevVRes?.classList.contains('panes-v-resizer')) prevVRes.remove()
      topEl.appendChild(firstBottom)
    }
  }
  const remaining = Object.keys(state.agentSessions)
  if (remaining.length > 0) focusAgentPane(remaining[0])
  else state.focusedAgentId = null
  refreshAgentsLayout()
}

// Horizontal resizer (top row height)
export function wireHResizer() {
  const resizer = document.getElementById('panes-h-resizer')
  const topEl   = document.getElementById('panes-top')
  let dragging  = false

  resizer.addEventListener('mousedown', e => {
    dragging = true
    document.body.style.cursor = 'row-resize'
    document.body.style.userSelect = 'none'
    e.preventDefault()
  })
  window.addEventListener('mousemove', e => {
    if (!dragging) return
    const rect   = document.getElementById('agents-panes').getBoundingClientRect()
    const newPct = Math.max(15, Math.min(80, ((e.clientY - rect.top) / rect.height) * 100))
    topEl.style.flex = `0 0 ${newPct}%`
    Object.keys(state.agentSessions).forEach(id => state.agentSessions[id]?.fitAddon?.fit())
  })
  window.addEventListener('mouseup', () => {
    if (!dragging) return
    dragging = false
    document.body.style.cursor = ''
    document.body.style.userSelect = ''
    Object.keys(state.agentSessions).forEach(id => state.agentSessions[id]?.fitAddon?.fit())
  })
}

export function wireVResizer(resizerEl, rightPaneId) {
  let dragging = false
  resizerEl.addEventListener('mousedown', e => {
    dragging = true
    document.body.style.cursor = 'col-resize'
    document.body.style.userSelect = 'none'
    e.preventDefault()
  })
  window.addEventListener('mousemove', e => {
    if (!dragging) return
    const botEl    = document.getElementById('panes-bottom')
    const leftPane = resizerEl.previousElementSibling
    if (!leftPane?.classList.contains('apane')) return
    const rect    = botEl.getBoundingClientRect()
    const leftPct = Math.max(15, Math.min(80, ((e.clientX - rect.left) / rect.width) * 100))
    leftPane.style.flex = `0 0 ${leftPct}%`
    const rightPane = document.getElementById('pane-' + rightPaneId)
    if (rightPane) rightPane.style.flex = '1'
    Object.keys(state.agentSessions).forEach(id => state.agentSessions[id]?.fitAddon?.fit())
  })
  window.addEventListener('mouseup', () => {
    if (!dragging) return
    dragging = false
    document.body.style.cursor = ''
    document.body.style.userSelect = ''
    Object.keys(state.agentSessions).forEach(id => state.agentSessions[id]?.fitAddon?.fit())
  })
}

// ─── Initialization ─────────────────────────────────────────────────────────
export function initAgents() {
  // Wire the global PTY exit handler for agents
  wireAgentExitHandler()

  // Wire horizontal resizer
  wireHResizer()

  // Spawn button
  document.getElementById('ar-spawn-btn').addEventListener('click', () => spawnAgentPane())

  // Agent timer — updates elapsed time and dots
  state.agentTimer = setInterval(() => {
    Object.keys(state.agentSessions).forEach(id => {
      const s = state.agentSessions[id]; if (!s) return
      const te = document.getElementById('ap-time-' + id)
      if (te) te.textContent = agentElapsed(id)
      const re = document.getElementById('ar-time-' + id)
      if (re) re.textContent = agentElapsed(id)
      if (s.status === 'running' || s.status === 'waiting') updateAgentDots(id)
    })
  }, 1000)

  // Pause/resume timer on visibility change
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible') {
      if (!state.agentTimer) state.agentTimer = setInterval(() => {
        Object.keys(state.agentSessions).forEach(id => {
          const s = state.agentSessions[id]; if (!s) return
          const te = document.getElementById('ap-time-' + id)
          if (te) te.textContent = agentElapsed(id)
          const re = document.getElementById('ar-time-' + id)
          if (re) re.textContent = agentElapsed(id)
          if (s.status === 'running' || s.status === 'waiting') updateAgentDots(id)
        })
      }, 1000)
    } else {
      clearInterval(state.agentTimer); state.agentTimer = null
    }
  })
}
