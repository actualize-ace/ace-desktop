// renderer/views/oracle.js
import { state } from '../state.js'
import { escapeHtml, processWikilinks, postProcessCodeBlocks, SANITIZE_CONFIG } from '../modules/chat-renderer.js'

let oracleSessionId = null
let oracleStreaming = false
let oracleStreamText = ''
let oracleAssistantEl = null

export function openOracle() {
  const overlay = document.getElementById('oracle-overlay')
  const fab = document.getElementById('oracle-fab')
  const input = document.getElementById('oracle-input')
  overlay.classList.add('open')
  fab.classList.add('open')
  setTimeout(() => input.focus(), 200)
}

export function closeOracle() {
  const overlay = document.getElementById('oracle-overlay')
  const fab = document.getElementById('oracle-fab')
  overlay.classList.remove('open')
  fab.classList.remove('open')
  // Reset size on close
  const panel = document.querySelector('.oracle-panel')
  if (panel) { panel.classList.remove('expanded', 'full') }
}

export async function sendOracleQuery(query) {
  const input = document.getElementById('oracle-input')
  const msgsEl = document.getElementById('oracle-messages')

  if (!query.trim() || oracleStreaming) return

  // Remove welcome
  const welcome = msgsEl.querySelector('.oracle-welcome')
  if (welcome) welcome.remove()

  // Add user message
  const userMsg = document.createElement('div')
  userMsg.className = 'oracle-msg user'
  userMsg.textContent = query
  msgsEl.appendChild(userMsg)

  // Add thinking indicator
  const thinking = document.createElement('div')
  thinking.className = 'oracle-thinking'
  thinking.textContent = 'Thinking...'
  msgsEl.appendChild(thinking)

  // Add assistant placeholder
  oracleAssistantEl = document.createElement('div')
  oracleAssistantEl.className = 'oracle-msg assistant'
  oracleAssistantEl.style.display = 'none'
  msgsEl.appendChild(oracleAssistantEl)

  msgsEl.scrollTop = msgsEl.scrollHeight
  oracleStreaming = true
  oracleStreamText = ''
  input.value = ''
  input.style.height = 'auto'

  // Send via chat IPC with a dedicated oracle ID
  const oracleId = 'oracle-' + Date.now()
  const oracleModelEl = document.getElementById('oracle-model')
  const selectedModel = oracleModelEl ? oracleModelEl.value : 'sonnet'
  const opts = { model: selectedModel, permissions: 'auto', effort: 'high' }

  // Wire up stream listener for this query
  const cleanupStream = window.ace.chat.onStream(oracleId, event => {
    if (event.type === 'system' && event.session_id) {
      oracleSessionId = event.session_id
    }
    if (event.type === 'stream_event' && event.event) {
      const e = event.event
      if (e.type === 'content_block_delta' && e.delta?.type === 'text_delta') {
        oracleStreamText += e.delta.text
        // Remove thinking, show response
        if (thinking.parentNode) thinking.remove()
        oracleAssistantEl.style.display = ''
        oracleAssistantEl.innerHTML = `<div class="md-body">${DOMPurify.sanitize(marked.parse(oracleStreamText), SANITIZE_CONFIG)}</div>`
        msgsEl.scrollTop = msgsEl.scrollHeight
      }
    }
    if (event.type === 'result') {
      oracleStreaming = false
      if (thinking.parentNode) thinking.remove()
      oracleAssistantEl.style.display = ''
      oracleAssistantEl.innerHTML = `<div class="md-body">${DOMPurify.sanitize(marked.parse(oracleStreamText), SANITIZE_CONFIG)}</div>`
      postProcessCodeBlocks(oracleAssistantEl)
      msgsEl.scrollTop = msgsEl.scrollHeight
      cleanupStream()
      cleanupExit()
    }
  })
  const cleanupExit = window.ace.chat.onExit(oracleId, () => {
    oracleStreaming = false
    if (thinking.parentNode) thinking.remove()
    if (oracleStreamText && oracleAssistantEl) {
      oracleAssistantEl.style.display = ''
      oracleAssistantEl.innerHTML = `<div class="md-body">${DOMPurify.sanitize(marked.parse(oracleStreamText), SANITIZE_CONFIG)}</div>`
      postProcessCodeBlocks(oracleAssistantEl)
    }
    cleanupStream()
    cleanupExit()
  })

  // Send to backend — oracle gets its own session, resumes for context continuity
  // Hindsight recall is operator-only: only inject the instruction when the
  // user's config names a hindsight bank. Clients without Hindsight fall
  // through to default behavior (Claude reads vault files directly).
  const config = await window.ace.setup.getConfig()
  const hindsightBank = config?.hindsightBank
  const enhancedQuery = oracleSessionId
    ? query  // follow-up messages don't need the instruction repeated
    : hindsightBank
      ? `Before answering, try to use the hindsight recall tool to search for relevant context: recall(bank_id="${hindsightBank}", query="${query.replace(/"/g, '\\"')}"). If the tool is unavailable, proceed by reading vault files directly. Then answer:\n\n${query}`
      : query
  window.ace.chat.send(oracleId, enhancedQuery, oracleSessionId, opts)
}

export function resetOracleSession() {
  oracleSessionId = null
  const msgsEl = document.getElementById('oracle-messages')
  msgsEl.innerHTML = ''
  // Re-show presets
  const presetsEl = document.getElementById('oracle-presets')
  if (presetsEl) presetsEl.style.display = ''
}

export function initOracle() {
  const fab = document.getElementById('oracle-fab')
  const overlay = document.getElementById('oracle-overlay')
  const backdrop = document.getElementById('oracle-backdrop')
  const closeBtn = document.getElementById('oracle-close')
  const input = document.getElementById('oracle-input')
  const sendBtn = document.getElementById('oracle-send')
  const msgsEl = document.getElementById('oracle-messages')
  const presetsEl = document.getElementById('oracle-presets')

  const expandBtn = document.getElementById('oracle-expand')
  expandBtn.addEventListener('click', () => {
    const panel = document.querySelector('.oracle-panel')
    if (!panel) return
    if (panel.classList.contains('full')) {
      panel.classList.remove('full', 'expanded')
      expandBtn.innerHTML = '&#x2922;'
      expandBtn.title = 'Expand'
    } else if (panel.classList.contains('expanded')) {
      panel.classList.remove('expanded')
      panel.classList.add('full')
      expandBtn.innerHTML = '&#x2923;'
      expandBtn.title = 'Collapse'
    } else {
      panel.classList.add('expanded')
      expandBtn.innerHTML = '&#x2922;'
      expandBtn.title = 'Full width'
    }
  })

  fab.addEventListener('click', openOracle)
  backdrop.addEventListener('click', closeOracle)
  closeBtn.addEventListener('click', closeOracle)
  document.addEventListener('keydown', e => {
    if (e.key === 'Escape' && overlay.classList.contains('open')) closeOracle()
  })

  window.openOracle = openOracle
  window.sendOracleQuery = sendOracleQuery
  window.resetOracleSession = resetOracleSession

  // Input handlers
  input.addEventListener('keydown', e => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault()
      sendOracleQuery(input.value)
    }
  })
  input.addEventListener('input', () => {
    input.style.height = 'auto'
    input.style.height = Math.min(input.scrollHeight, 100) + 'px'
  })
  sendBtn.addEventListener('click', () => sendOracleQuery(input.value))

  // Preset clicks
  presetsEl.querySelectorAll('.oracle-preset').forEach(preset => {
    preset.addEventListener('click', () => {
      sendOracleQuery(preset.dataset.query)
    })
  })
}
