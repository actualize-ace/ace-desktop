// renderer/modules/chat-pane.js
import { state } from '../state.js'
import { aceMarkSvg } from './ace-mark.js'
import { attach as attachSlashMenu } from './slash-menu.js'

/**
 * Factory: creates a full chat pane DOM element with wired event handlers.
 * Returns controls object. Caller assigns pane/tab to session state after this call.
 *
 * Attachment wiring (wireDropZone, wirePasteHandler, pickAndStage) is NOT handled here —
 * those functions write to session.pendingAttachments directly and must be wired by the
 * caller after session state is initialized.
 */
export function createChatPane(id, config = {}) {
  const {
    paneClass = 'term-pane',
    roleName = 'ACE',
    showTimer = false,
    showMoveButton = false,
    moveDirection = '→',
    placeholder = 'Message ACE...',
    attachSlash = true,
    containerEl,
    tabBarEl,
    onSend,
    onClose,
    onModeToggle,
    onTerminalInit,
  } = config

  const isAgent = paneClass === 'apane'

  // ── Pane DOM ──────────────────────────────────────────────────────────────
  const pane = document.createElement('div')
  pane.className = paneClass
  pane.id = 'pane-' + id

  const header = isAgent
    ? `<div class="apane-tab" id="aptab-${id}">
        <div class="ap-dot waiting"></div>
        <span class="ap-role">${roleName}</span>
        <span class="ap-name-label">${id.slice(-6)}</span>
        <span class="ap-task-label" id="ap-task-${id}">starting…</span>
        <button class="mode-toggle-btn" id="mode-toggle-${id}">Terminal</button>
        <span class="ap-tokens" id="ap-tokens-${id}">↑ 0 lines</span>
        <span class="ap-time-label" id="ap-time-${id}">0:00</span>
        <span class="ap-close-btn" id="ap-close-${id}">×</span>
       </div>`
    : `<div class="term-hdr">
        <div class="term-hdr-dot" style="background:var(--green);box-shadow:0 0 7px rgba(109,184,143,0.5)"></div>
        <div class="term-hdr-label" id="hdr-label-${id}">ACE Session</div>
        <button class="mode-toggle-btn" id="mode-toggle-${id}">Terminal</button>
        <div class="term-hdr-path" id="hdr-path-${id}">Chat Mode</div>
        ${showTimer ? `
        <span class="session-timer" id="session-timer-${id}" style="display:none"></span>
        <select class="session-duration-select" id="session-duration-${id}" title="Set session timer" data-learn-target="session-timer">
          <option value="">Timer</option>
          <option value="15">15m</option>
          <option value="30">30m</option>
          <option value="60">60m</option>
          <option value="90">90m</option>
        </select>` : ''}
       </div>`

  pane.innerHTML = header + `
    <div class="chat-view" id="chat-view-${id}">
      <div class="chat-messages" id="chat-msgs-${id}">
        <div class="chat-welcome">
          <div class="chat-welcome-icon">${aceMarkSvg(36)}</div>
          <div class="chat-welcome-text">${roleName} Chat</div>
          <div class="chat-welcome-sub">Enter to send · Shift+Enter for newline · Type a message below</div>
        </div>
      </div>
      <div class="chat-status" id="chat-status-${id}">
        <span class="chat-cost-label">$0.00</span>
        <span class="chat-tokens-label">0 tokens</span>
        <div class="ctx-bar" id="ctx-bar-${id}" title="Context usage" data-learn-target="ctx-bar">
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
        <textarea class="chat-input" id="chat-input-${id}" data-learn-target="chat-composer" placeholder="${placeholder}" rows="1"></textarea>
        <div class="chat-send-wrap">
          <button class="chat-send-btn" id="chat-send-${id}" data-learn-target="send-button">↑</button>
          <span class="mcp-dot" id="mcp-dot-${id}" title="Claude process: idle"></span>
        </div>
      </div>
    </div>
    <div class="term-xterm" id="xterm-${id}" style="display:none"></div>
    <button class="scroll-to-bottom" id="scroll-btn-${id}" title="Scroll to bottom" style="display:none">↓</button>`

  if (containerEl) containerEl.appendChild(pane)

  // ── Tab DOM (sessions only) ───────────────────────────────────────────────
  let tab = null
  if (tabBarEl) {
    tab = document.createElement('div')
    tab.className = 'stab'
    tab.id = 'tab-' + id
    tab.innerHTML = `<div class="stab-dot"></div>` +
      `<span class="stab-label" id="tab-label-${id}">${roleName}</span>` +
      (showMoveButton ? `<span class="stab-move" id="stab-move-${id}" title="Move to other pane">${moveDirection}</span>` : '') +
      `<span class="stab-close" id="stab-close-${id}" title="Close session">×</span>`
    const addBtn = tabBarEl.querySelector('.stab-add')
    tabBarEl.insertBefore(tab, addBtn)
  }

  // ── Element refs ──────────────────────────────────────────────────────────
  // pane.querySelector works whether or not the pane is yet attached to the
  // document — agent panes pass containerEl: null and append themselves after
  // the factory call, so document.getElementById would miss those elements.
  const inputEl  = pane.querySelector('#chat-input-'  + id)
  const sendBtn  = pane.querySelector('#chat-send-'   + id)
  const xtermEl  = pane.querySelector('#xterm-'       + id)

  // ── Slash menu ────────────────────────────────────────────────────────────
  if (attachSlash) {
    attachSlashMenu(inputEl, { send: (prompt) => onSend?.(id, prompt) })
  }

  // ── Input: auto-grow + send on Enter + cancel on Escape ──────────────────
  inputEl.addEventListener('keydown', e => {
    if (e.key === 'Enter' && !e.shiftKey && !e.__slashMenuHandled) {
      e.preventDefault()
      const prompt = inputEl.value.trim()
      if (!prompt) return
      inputEl.value = ''
      inputEl.style.height = 'auto'
      onSend?.(id, prompt)
    }
    if (e.key === 'Escape' && !e.__slashMenuHandled) {
      window.ace.chat.cancel(id)
    }
  })

  inputEl.addEventListener('input', () => {
    inputEl.style.height = 'auto'
    inputEl.style.height = Math.min(inputEl.scrollHeight, 150) + 'px'
  })

  sendBtn.addEventListener('click', () => {
    const prompt = inputEl.value.trim()
    if (!prompt) { window.ace.chat.cancel(id); return }
    inputEl.value = ''
    inputEl.style.height = 'auto'
    onSend?.(id, prompt)
  })

  // ── Close buttons ─────────────────────────────────────────────────────────
  tab?.querySelector('#stab-close-' + id)?.addEventListener('click', e => {
    e.stopPropagation(); onClose?.(id)
  })
  pane.querySelector('#ap-close-' + id)?.addEventListener('click', e => {
    e.stopPropagation(); onClose?.(id)
  })

  // ── Mode toggle ───────────────────────────────────────────────────────────
  // Factory fires onTerminalInit on first toggle, then delegates all DOM/state
  // work to the onModeToggle callback (toggleSessionMode / toggleAgentMode).
  let terminalInited = false
  pane.querySelector('#mode-toggle-' + id)?.addEventListener('click', e => {
    e.stopPropagation()
    if (!terminalInited && xtermEl) {
      terminalInited = true
      onTerminalInit?.(xtermEl)
    }
    onModeToggle?.(id)
  })

  // ── setStreaming ──────────────────────────────────────────────────────────
  function setStreaming(active) {
    sendBtn.disabled = active
    sendBtn.classList.toggle('streaming', active)
    if (!active) {
      sendBtn.textContent = '↑'
      sendBtn.classList.remove('cancel')
    }
  }

  // ── Destroy ───────────────────────────────────────────────────────────────
  function destroy() {
    pane.remove()
    tab?.remove()
  }

  return { pane, tab, chatInput: inputEl, sendBtn, destroy, setStreaming }
}
