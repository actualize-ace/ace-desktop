// renderer/modules/session-manager.js
import { state } from '../state.js'
import { xtermTheme } from './theme.js'
import { escapeHtml, syntaxHighlight, findSettledBoundary, findSettledBoundaryFrom, renderTail, postProcessCodeBlocks, processWikilinks, postProcessWikilinks, SANITIZE_CONFIG } from './chat-renderer.js'
import { onSoftGC } from './refresh-engine.js'
import { updateOrbState } from './ace-mark.js'
import { setAttention, clearAttention, updateAttentionBadge } from './attention.js'
import { onSessionClose } from './atmosphere.js'
import { initSplitPane, moveToOtherGroup } from './split-pane-manager.js'
import { startTimer, clearTimer } from './session-timer.js'
import { pickAndStage, wireDropZone, wirePasteHandler, injectAttachments, consumeAttachments, renderChipTray, renderMsgAttachments, wireMsgAttachmentClicks } from './attachment-handler.js'
import { appendToolBlock, appendToolInput, updateActivityIndicator, clearActivityIndicator, renderQuestionCard } from './tool-renderer.js'
import { renderMcpEventCard, renderPermissionApprovalCard, renderMcpPermissionCard } from './mcp-cards.js'
import { MODEL_CTX_LIMITS, updateTelemetry } from './telemetry.js'
import { createChatPane } from './chat-pane.js'

// ─── Chat System ─────────────────────────────────────────────────────────────

// Derive a short session name from the first user prompt. Keeps the label
// scannable across tabs. Falls back to 'ACE' if the prompt is empty.
function deriveSessionName(prompt) {
  if (!prompt || !prompt.trim()) return 'ACE'
  const STOP = new Set([
    'what','how','why','when','where','who','which','can','could','would','should',
    'please','help','me','us','i','you','the','a','an','is','are','was','were',
    'do','does','did','to','of','for','in','on','with','and','or','but','my','your',
    'this','that','these','those','it','its','be','been','being','have','has','had',
    'will','want','need','make','get','let','tell','show','give','find','go','put',
  ])
  const words = prompt.trim()
    .replace(/[^\w\s'-]/g, ' ')
    .split(/\s+/)
    .map(w => w.toLowerCase().replace(/^[-']+|[-']+$/g, ''))
    .filter(w => w.length > 1 && !STOP.has(w))
  const title = words.slice(0, 4).join(' ')
  if (!title) {
    const cleaned = prompt.trim().replace(/\s+/g, ' ')
    return cleaned.length <= 28 ? cleaned : cleaned.slice(0, 28).trim() + '…'
  }
  return title.charAt(0).toUpperCase() + title.slice(1)
}

export function sendChatMessage(id, prompt, sessionsObj) {
  sessionsObj = sessionsObj || state.sessions
  const s = sessionsObj[id]
  if (!s || !prompt.trim()) return

  // If currently streaming, queue the message
  if (s.isStreaming) {
    if (!s._messageQueue) s._messageQueue = []
    s._messageQueue.push(prompt.trim())
    // Show queued indicator
    const msgsEl = document.getElementById('chat-msgs-' + id)
    if (msgsEl) {
      const queuedMsg = document.createElement('div')
      queuedMsg.className = 'chat-msg chat-msg-user chat-msg-queued'
      queuedMsg.innerHTML = `<div class="chat-msg-label">QUEUED</div><div class="chat-msg-content">${escapeHtml(prompt.trim())}</div>`
      msgsEl.appendChild(queuedMsg)
      msgsEl.scrollTop = msgsEl.scrollHeight
    }
    return
  }

  // Add user message to DOM
  const msgsEl = document.getElementById('chat-msgs-' + id)
  const userMsg = document.createElement('div')
  userMsg.className = 'chat-msg chat-msg-user'
  const attachHtml = renderMsgAttachments(s.pendingAttachments)
  userMsg.innerHTML = `<div class="chat-msg-label">YOU</div>${attachHtml}<div class="chat-msg-content">${escapeHtml(prompt.trim())}</div>`
  // Remove welcome if present
  const welcome = msgsEl.querySelector('.chat-welcome')
  if (welcome) welcome.remove()
  msgsEl.appendChild(userMsg)
  wireMsgAttachmentClicks(userMsg)

  // Add assistant message placeholder
  const assistantMsg = document.createElement('div')
  assistantMsg.className = 'chat-msg chat-msg-assistant'
  assistantMsg.innerHTML = `<div class="chat-msg-label">ACE <span class="chat-streaming-indicator"><span></span><span></span><span></span></span><span class="chat-status-word" id="status-word-${id}">Synthesizing</span></div><div class="chat-msg-content md-body"><div class="chat-settled"></div><div class="chat-tail"></div></div>`
  msgsEl.appendChild(assistantMsg)

  // Auto-name session on first user send (while name is still the default).
  // Only the tab gets the name — the header label stays "ACE SESSION" as a
  // static category marker. Tab = identity, header = category.
  if (s.messages.length === 0 && (!s.name || s.name === 'ACE')) {
    const newName = deriveSessionName(prompt)
    s.name = newName
    const tabLabel = document.getElementById('tab-label-' + id)
    if (tabLabel) tabLabel.textContent = newName
  }

  // Consume pending attachments before pushing message record
  const attachedFiles = consumeAttachments(s)
  const finalPrompt = injectAttachments({ pendingAttachments: attachedFiles }, prompt.trim())

  s.messages.push({ role: 'user', content: prompt.trim(), attachments: attachedFiles.length ? attachedFiles : undefined, timestamp: Date.now() })
  s.currentStreamText = ''
  s._fullResponseText = ''
  s.currentToolInput = ''
  s.isStreaming = true
  s._paneControls?.setStreaming(true)
  s._prevContextTokens = s.contextInputTokens
  updateOrbState()
  s._settledBoundary = 0
  s._settledHTML = ''
  s._currentAssistantEl = assistantMsg
  s._pendingRAF = null

  // Clear chip tray
  renderChipTray(s, id)

  // Update button state
  const sendBtn = document.getElementById('chat-send-' + id)
  if (sendBtn) { sendBtn.textContent = '■'; sendBtn.classList.add('cancel') }

  // Auto-scroll to bottom
  msgsEl.scrollTop = msgsEl.scrollHeight

  // Gather options from controls
  const modelEl = document.getElementById('chat-model-' + id)
  const permsEl = document.getElementById('chat-perms-' + id)
  const effortEl = document.getElementById('chat-effort-' + id)
  const opts = {
    model: modelEl?.value || state.chatDefaults.model,
    permissions: permsEl?.value || state.chatDefaults.permissions,
    effort: effortEl?.value || state.chatDefaults.effort,
    lean: state.chatDefaults.lean !== false,
  }
  // Keep session state in sync with the model actually used
  if (s) s.model = opts.model

  // Store for MCP retry flows
  s.lastPrompt = prompt

  // Send to backend with injected attachment refs
  window.ace.chat.send(id, finalPrompt, s.claudeSessionId, opts)

  // Start rotating status words
  const STATUS_WORDS = [
    'Synthesizing', 'Composing', 'Reflecting', 'Connecting', 'Exploring',
    'Weaving', 'Cohering', 'Actualizing', 'Expanding', 'Distilling',
    'Integrating', 'Attuning', 'Crystallizing', 'Illuminating',
  ]
  let wordIdx = 0
  s._wordTimer = setInterval(() => {
    if (!s.isStreaming) { clearInterval(s._wordTimer); return }
    wordIdx = (wordIdx + 1) % STATUS_WORDS.length
    const wordEl = document.getElementById('status-word-' + id)
    if (wordEl) {
      wordEl.style.opacity = '0'
      setTimeout(() => {
        wordEl.textContent = STATUS_WORDS[wordIdx]
        wordEl.style.opacity = ''
      }, 150)
    }
  }, 2500)
}

// Schedule debounced render
export function scheduleRender(id, sessionsObj) {
  sessionsObj = sessionsObj || state.sessions
  const s = sessionsObj[id]
  if (!s || s._pendingRAF) return
  s._pendingRAF = requestAnimationFrame(() => {
    s._pendingRAF = null
    renderChatStream(id, sessionsObj)
  })
}

// Render accumulated stream text
export function renderChatStream(id, sessionsObj) {
  sessionsObj = sessionsObj || state.sessions
  const s = sessionsObj[id]
  if (!s || !s._currentAssistantEl) return
  const contentEl = s._currentAssistantEl.querySelector('.chat-msg-content')
  const settledEls = contentEl.querySelectorAll('.chat-settled')
  const tailEls = contentEl.querySelectorAll('.chat-tail')
  const settledEl = settledEls[settledEls.length - 1]
  const tailEl = tailEls[tailEls.length - 1]

  const boundary = findSettledBoundaryFrom(s.currentStreamText, s._settledBoundary)
  if (boundary > s._settledBoundary) {
    const settledText = s.currentStreamText.slice(0, boundary)
    const raw = marked.parse(settledText)
    const safe = DOMPurify.sanitize(raw, SANITIZE_CONFIG)
    settledEl.innerHTML = safe
    s._settledBoundary = boundary
    s._settledHTML = safe
    postProcessCodeBlocks(settledEl)
    postProcessWikilinks(settledEl)
  }

  const tail = s.currentStreamText.slice(boundary)
  tailEl.innerHTML = tail ? renderTail(tail) : ''

  // Auto-scroll
  scrollChatToBottom(id, 120)
}

// Show an inline banner in the chat message area
export function showChatBanner(id, message, sessionsObj) {
  sessionsObj = sessionsObj || state.sessions
  const msgsEl = document.getElementById('chat-msgs-' + id)
  if (!msgsEl) return
  const banner = document.createElement('div')
  banner.className = 'chat-banner-warning'
  banner.textContent = message
  msgsEl.appendChild(banner)
  msgsEl.scrollTop = msgsEl.scrollHeight
}

// Finalize a message (streaming complete)
export function finalizeMessage(id, sessionsObj) {
  sessionsObj = sessionsObj || state.sessions
  const s = sessionsObj[id]
  if (!s) return
  s.isStreaming = false
  s._paneControls?.setStreaming(false)
  // Track per-turn context growth for predictive tooltip
  const delta = s.contextInputTokens - (s._prevContextTokens || 0)
  if (delta > 0) {
    s.turnDeltas = [...(s.turnDeltas || []), delta].slice(-5)
  }
  updateOrbState()
  // Final full render
  if (s._currentAssistantEl) {
    const contentEl = s._currentAssistantEl.querySelector('.chat-msg-content')
    // Use LAST settled/tail pair (matches renderChatStream behavior)
    const settledEls = contentEl.querySelectorAll('.chat-settled')
    const tailEls = contentEl.querySelectorAll('.chat-tail')
    const settledEl = settledEls[settledEls.length - 1]
    const tailEl = tailEls[tailEls.length - 1]
    const raw = marked.parse(s.currentStreamText)
    const safe = DOMPurify.sanitize(raw, SANITIZE_CONFIG)
    settledEl.innerHTML = safe
    tailEl.innerHTML = ''
    postProcessCodeBlocks(settledEl)
    postProcessWikilinks(settledEl)
    // Remove streaming indicators from label
    const indicator = s._currentAssistantEl.querySelector('.chat-streaming-indicator')
    if (indicator) indicator.remove()
    const statusWord = s._currentAssistantEl.querySelector('.chat-status-word')
    if (statusWord) statusWord.remove()
  }
  s.messages.push({ role: 'assistant', content: s._fullResponseText || s.currentStreamText, timestamp: Date.now() })
  s.currentStreamText = ''
  s._settledBoundary = 0
  s._settledHTML = ''
  clearActivityIndicator(s)
  // Auto-scroll on finalize — generous threshold (user may have scrolled up deliberately)
  scrollChatToBottom(id, 300)
  if (s._wordTimer) { clearInterval(s._wordTimer); s._wordTimer = null }
  s._opsContainer = null
  s._opsCount = 0
  s._currentToolName = null
  s._hadToolBlocks = false
  s._currentAssistantEl = null

  // Update button state
  const sendBtn = document.getElementById('chat-send-' + id)
  if (sendBtn) { sendBtn.textContent = '↑'; sendBtn.classList.remove('cancel') }

  // Process queued messages
  if (s._messageQueue && s._messageQueue.length > 0) {
    const nextPrompt = s._messageQueue.shift()
    // Remove the queued label from the DOM
    const msgsEl = document.getElementById('chat-msgs-' + id)
    const queuedEl = msgsEl?.querySelector('.chat-msg-queued')
    if (queuedEl) queuedEl.remove()
    setTimeout(() => sendChatMessage(id, nextPrompt, sessionsObj), 300)
  }
}

// Scroll chat to bottom — respects autoScroll setting and proximity threshold
function scrollChatToBottom(id, threshold) {
  if (state._autoScroll === false) return
  const msgsEl = document.getElementById('chat-msgs-' + id)
  if (!msgsEl) return
  const dist = msgsEl.scrollHeight - msgsEl.scrollTop - msgsEl.clientHeight
  if (dist < (threshold || 120)) msgsEl.scrollTop = msgsEl.scrollHeight
}

// Update chat status bar + context bar
export function updateChatStatus(id, event, sessionsObj) {
  sessionsObj = sessionsObj || state.sessions
  const s = sessionsObj[id]
  if (!s) return

  if (event.total_cost_usd != null) s.totalCost += event.total_cost_usd
  if (event.usage) {
    s.totalTokens.input += event.usage.input_tokens || 0
    s.totalTokens.output += event.usage.output_tokens || 0
    // contextInputTokens is NOT updated here — result.usage.input_tokens is cumulative
    // across all API calls in a multi-tool turn (confirmed 2026-04-17). Use
    // message_start events (updateTokensFromStream) as the sole context source.
  }
  const totalTok = s.totalTokens.input + s.totalTokens.output

  // Update status bar labels
  const statusEl = document.getElementById('chat-status-' + id)
  if (statusEl) {
    const costEl = statusEl.querySelector('.chat-cost-label')
    const tokEl = statusEl.querySelector('.chat-tokens-label')
    if (costEl) costEl.textContent = '$' + s.totalCost.toFixed(4)
    if (tokEl) tokEl.textContent = formatTokens(totalTok) + ' tokens'
  }

  // Cost guardrail: warn if session cost exceeds threshold
  if (state._costGuardrail && s.totalCost > state._costGuardrail && !s._costWarned) {
    s._costWarned = true
    const costEl = document.getElementById('chat-status-' + id)?.querySelector('.chat-cost-label')
    if (costEl) costEl.style.color = 'var(--red)'
  }
}

// Also update tokens from stream events (not just result)
export function updateTokensFromStream(id, event, sessionsObj) {
  sessionsObj = sessionsObj || state.sessions
  const s = sessionsObj[id]
  if (!s) return
  // message_start and message_delta contain usage info
  if (event.type === 'stream_event' && event.event) {
    const e = event.event
    if (e.type === 'message_start' && e.message?.usage) {
      // Real context = input + cache_creation + cache_read (Claude caches the full history)
      const u = e.message.usage
      s.contextInputTokens = (u.input_tokens || 0) + (u.cache_creation_input_tokens || 0) + (u.cache_read_input_tokens || 0)
      updateContextBar(id, s.contextInputTokens)
    }
    // message_delta output tokens intentionally not added — context bar stays stable during streaming
  }
}

export function formatTokens(n) {
  if (n >= 1000000) return (n / 1000000).toFixed(1) + 'M'
  if (n >= 1000) return (n / 1000).toFixed(1) + 'K'
  return n + ''
}

export function updateContextBar(id, totalTokens) {
  const model = state.sessions[id]?.model || state.chatDefaults?.model || 'opus'
  const maxCtx = MODEL_CTX_LIMITS[model] || 200_000
  const pct = Math.min(100, (totalTokens / maxCtx) * 100)
  const fill = document.getElementById('ctx-fill-' + id)
  const label = document.getElementById('ctx-label-' + id)
  const barEl = document.getElementById('ctx-bar-' + id)
  if (fill) {
    fill.style.width = pct + '%'
    fill.className = 'ctx-bar-fill' + (pct > 80 ? ' critical' : pct > 50 ? ' warn' : '')
  }
  if (barEl) {
    const s = state.sessions[id]
    let turnsHint = ''
    if (s?.turnDeltas?.length >= 2) {
      const avg = s.turnDeltas.reduce((a, b) => a + b, 0) / s.turnDeltas.length
      const remaining = Math.floor((maxCtx - totalTokens) / avg)
      if (remaining < 20) turnsHint = `  ·  ~${remaining} turn${remaining === 1 ? '' : 's'} remaining`
    }
    barEl.title = `Context: ${formatTokens(totalTokens)} / ${formatTokens(maxCtx)}${turnsHint}  ·  click to reset`
  }
  if (label) label.textContent = Math.round(pct) + '%'

  // Ambient pressure — somatic response on the pane itself
  const paneEl = document.getElementById('pane-' + id)
  if (paneEl) {
    paneEl.classList.toggle('ctx-warn',     pct >= 50 && pct < 80)
    paneEl.classList.toggle('ctx-hot',      pct >= 80 && pct < 95)
    paneEl.classList.toggle('ctx-critical', pct >= 95)
  }
}

function _doResetContext(id) {
  const s = state.sessions[id]
  if (!s) return

  s.claudeSessionId = null
  s.contextInputTokens = 0
  s.totalTokens = { input: 0, output: 0 }
  s.totalCost = 0
  s.turnDeltas = []
  s._prevContextTokens = 0
  s._costWarned = false

  const statusEl = document.getElementById('chat-status-' + id)
  if (statusEl) {
    const costEl = statusEl.querySelector('.chat-cost-label')
    const tokEl = statusEl.querySelector('.chat-tokens-label')
    if (costEl) costEl.style.color = ''
    if (costEl) costEl.textContent = '$0.0000'
    if (tokEl) tokEl.textContent = '0 tokens'
  }

  updateContextBar(id, 0)
}

export function resetContext(id) {
  const s = state.sessions[id]
  if (!s) return

  // Remove any existing confirm banner
  document.getElementById('ctx-reset-confirm-' + id)?.remove()

  const inputArea = document.querySelector('#pane-' + id + ' .chat-input-area')
  if (!inputArea) { _doResetContext(id); return }

  const banner = document.createElement('div')
  banner.id = 'ctx-reset-confirm-' + id
  banner.className = 'ctx-reset-confirm'
  banner.innerHTML = `<span>Claude will forget this conversation — your history stays visible.</span><button class="ctx-reset-ok">Reset</button><button class="ctx-reset-cancel">Cancel</button>`

  banner.querySelector('.ctx-reset-ok').addEventListener('click', () => {
    banner.remove()
    _doResetContext(id)
  })
  banner.querySelector('.ctx-reset-cancel').addEventListener('click', () => banner.remove())

  inputArea.parentNode.insertBefore(banner, inputArea)
}

// Wire chat stream listeners for a session
export function wireChatListeners(id, sessionsObj) {
  sessionsObj = sessionsObj || state.sessions
  const cleanupStream = window.ace.chat.onStream(id, event => {
    const s = sessionsObj[id]
    if (!s) return
    if (event.type === 'system' && event.session_id) {
      s.claudeSessionId = event.session_id
    }
    // Track token usage from stream events
    updateTokensFromStream(id, event, sessionsObj)
    if (event.type === 'stream_event' && event.event) {
      const e = event.event
      if (e.type === 'content_block_start') {
        if (e.content_block?.type === 'tool_use') {
          appendToolBlock(s, id, e.content_block)
        } else if (e.content_block?.type === 'text') {
          // Text block starts — end any tool group and clear activity
          clearActivityIndicator(s)
          // If there were tool blocks before this text, create new settled/tail
          // so text renders AFTER the tool blocks in the DOM
          if (s._opsContainer || s._hadToolBlocks) {
            s._opsContainer = null
            s._opsCount = 0
            // Finalize current settled text
            if (s.currentStreamText && s._currentAssistantEl) {
              const contentEl = s._currentAssistantEl.querySelector('.chat-msg-content')
              const settledEl = contentEl?.querySelector('.chat-settled:last-of-type')
              const tailEl = contentEl?.querySelector('.chat-tail:last-of-type')
              if (settledEl && s.currentStreamText) {
                const raw = marked.parse(s.currentStreamText)
                const safe = DOMPurify.sanitize(raw, SANITIZE_CONFIG)
                settledEl.innerHTML = safe
                postProcessCodeBlocks(settledEl)
                postProcessWikilinks(settledEl)
              }
              if (tailEl) tailEl.innerHTML = ''
              // Create new settled/tail pair after the tool blocks
              const newSettled = document.createElement('div')
              newSettled.className = 'chat-settled'
              const newTail = document.createElement('div')
              newTail.className = 'chat-tail'
              contentEl.appendChild(newSettled)
              contentEl.appendChild(newTail)
            }
            s.currentStreamText = ''
            s._settledBoundary = 0
            s._settledHTML = ''
            s._hadToolBlocks = false
          }
        }
      }
      if (e.type === 'content_block_delta') {
        if (e.delta?.type === 'text_delta') {
          s.currentStreamText += e.delta.text
          s._fullResponseText += e.delta.text
          scheduleRender(id, sessionsObj)
        }
        if (e.delta?.type === 'input_json_delta') {
          appendToolInput(s, id, e.delta.partial_json)
        }
      }
      if (e.type === 'content_block_stop') {
        if (s._currentToolBlock) {
          // Detect /close skill invocation
          if (s._currentToolName === 'Skill') {
            try {
              const parsed = JSON.parse(s.currentToolInput)
              if (parsed.skill === 'close') onSessionClose()
            } catch {}
          }
          s._hadToolBlocks = true
          s._currentToolBlock = null
          s._questionBlockEl = null
          s.currentToolInput = ''
        }
      }
      // Don't finalize on message_stop — Claude Code may send multiple
      // message rounds (text → tool_use → tool_result → more text).
      // Finalize only on the 'result' event which signals everything is done.
    }
    if (event.type === 'result') {
      updateChatStatus(id, event, sessionsObj)
      finalizeMessage(id, sessionsObj)
      // Detect .claude/ permission denials — show approval card instead of banner
      if (event.permission_denials?.length) {
        const claudeEdits = event.permission_denials.filter(d => {
          const p = d.tool_input?.file_path || ''
          return d.tool_name === 'Edit' && p.includes('/.claude/') && !p.includes('/.claude/projects/')
        })
        if (claudeEdits.length) {
          renderPermissionApprovalCard(s, id, claudeEdits)
        }

        const mcpDenials = event.permission_denials.filter(d =>
          typeof d.tool_name === 'string' && d.tool_name.startsWith('mcp__'))
        if (mcpDenials.length) {
          renderMcpPermissionCard(s, id, mcpDenials)
        }
      }
    }
  })
  const cleanupError = window.ace.chat.onError(id, msg => {
    const msgsEl = document.getElementById('chat-msgs-' + id)
    if (!msgsEl) return
    if (msg.includes('No STDIN data') || msg.includes('proceeding without')) return

    // Check for structured binary-missing error
    let parsed = null
    try { parsed = JSON.parse(msg) } catch {}

    if (parsed?.type === 'binary-missing') {
      const reasonCopy = {
        'unconfigured': 'No Claude CLI path is configured. Open Settings → Re-detect.',
        'invalid-type': 'Configured path is not a string (got: ' + parsed.path + ').',
        'path-missing': 'Path <code>' + (parsed.path || '?') + '</code> does not exist on disk.',
        'not-executable': 'Path <code>' + (parsed.path || '?') + '</code> exists but is not executable.',
      }
      const line = reasonCopy[parsed.reason] || ('Claude CLI not found at <code>' + (parsed.path || 'configured path') + '</code>.')
      const card = document.createElement('div')
      card.className = 'chat-error binary-missing-card'
      card.innerHTML = `
        <div style="margin-bottom:6px"><strong>Claude CLI issue</strong></div>
        <div style="margin-bottom:8px">${line}</div>
        <div style="margin-bottom:10px;opacity:0.55;font-size:11px">reason: ${parsed.reason || 'unknown'}</div>
        <div style="display:flex;gap:8px">
          <button class="preflight-btn" onclick="window.ace.preflight.recheckBinary()">Re-detect</button>
          <button class="preflight-btn" onclick="document.getElementById('settings-overlay')?.classList.add('open')">Open Settings</button>
        </div>`
      msgsEl.appendChild(card)
    } else if (parsed?.type === 'spawn-failed') {
      const card = document.createElement('div')
      card.className = 'chat-error binary-missing-card'
      card.innerHTML = `
        <div style="margin-bottom:6px"><strong>Claude CLI failed to start</strong></div>
        <div style="margin-bottom:8px">${parsed.message || 'spawn error'}</div>
        <div style="margin-bottom:10px;opacity:0.55;font-size:11px">code: ${parsed.code || '?'} · path: <code>${parsed.path || '?'}</code></div>
        <div style="display:flex;gap:8px">
          <button class="preflight-btn" onclick="window.ace.preflight.recheckBinary()">Re-detect</button>
          <button class="preflight-btn" onclick="document.getElementById('settings-overlay')?.classList.add('open')">Open Settings</button>
        </div>`
      msgsEl.appendChild(card)
    } else if (parsed?.type === 'mcp-event') {
      renderMcpEventCard(msgsEl, id, parsed)
    } else {
      const errEl = document.createElement('div')
      errEl.className = 'chat-error'
      errEl.textContent = msg
      msgsEl.appendChild(errEl)
    }
    setAttention(id, sessionsObj, 'error')
  })
  const cleanupExit = window.ace.chat.onExit(id, code => {
    const s = sessionsObj[id]
    // Delay exit finalization — the result event on the stream channel may
    // arrive after the exit event (different IPC channels, no ordering).
    // Give stream events 500ms to arrive; if result already finalized
    // (isStreaming === false), this becomes a no-op.
    if (s && s.isStreaming) setTimeout(() => {
      if (s.isStreaming) finalizeMessage(id, sessionsObj)
    }, 500)
    // Set attention if this session's view isn't currently visible
    const terminalVisible = document.getElementById('view-terminal')?.classList.contains('active')
    const agentsVisible = document.getElementById('view-agents')?.classList.contains('active')
    const sessionVisible = terminalVisible && id === state.activeId
    const agentVisible = agentsVisible && id === state.focusedAgentId
    if (!sessionVisible && !agentVisible) setAttention(id, sessionsObj, 'exit')
  })
  // Store cleanup functions on session so listeners are removed on close
  const s = sessionsObj[id]
  if (s) s._cleanupListeners = () => { cleanupStream(); cleanupError(); cleanupExit() }
}

// ─── Sessions ────────────────────────────────────────────────────────────────

const SESSION_LIMIT = 3

function countSessionsInContainer(containerId) {
  const container = document.getElementById(containerId)
  if (!container) return 0
  return container.querySelectorAll('.term-pane').length
}

function showToast(message, durationMs = 3500) {
  let toast = document.getElementById('ace-toast')
  if (!toast) {
    toast = document.createElement('div')
    toast.id = 'ace-toast'
    toast.className = 'ace-toast'
    document.body.appendChild(toast)
  }
  toast.textContent = message
  toast.classList.add('ace-toast--visible')
  clearTimeout(toast._hideTimer)
  toast._hideTimer = setTimeout(() => toast.classList.remove('ace-toast--visible'), durationMs)
}

export function spawnSession(opts) {
  // Session limit check — block before creating any DOM
  const targetContainerId = (opts?.container || document.getElementById('pane-content-left')).id
  const currentCount = countSessionsInContainer(targetContainerId)
  if (currentCount >= SESSION_LIMIT) {
    showToast(`${SESSION_LIMIT} sessions open in this pane. Close one before opening another.`)
    return
  }

  const resumeId = opts?.resumeId || null
  const resumeCwd = opts?.resumeCwd || null
  const id = 'sess-' + Date.now()

  const targetContainer = opts?.container || document.getElementById('pane-content-left')
  const targetTabBar    = opts?.tabBar    || document.getElementById('session-tabs-left')
  const moveArrow = targetContainer.id === 'pane-content-right' ? '←' : '→'
  const smartPlaceholder = window.__preflightResult?.binary?.ok && window.__preflightResult?.vault?.ok
    ? 'Type /start to begin your day'
    : 'Message ACE...'

  const controls = createChatPane(id, {
    paneClass: 'term-pane',
    roleName: 'ACE',
    showTimer: true,
    showMoveButton: true,
    moveDirection: moveArrow,
    placeholder: smartPlaceholder,
    containerEl: targetContainer,
    tabBarEl: targetTabBar,
    onSend:         (id, prompt) => sendChatMessage(id, prompt),
    onClose:        (id)         => closeSession(id),
    onModeToggle:   (id)         => toggleSessionMode(id),
    onTerminalInit: (xtermEl)    => _initSessionTerminal(id, xtermEl),
  })

  const { pane, tab } = controls
  tab.addEventListener('click', (e) => { if (!e.target.classList.contains('stab-close') && !e.target.classList.contains('stab-move')) activateSession(id) })

  state.sessions[id] = {
    term: null, fitAddon: null, pane, tab,
    mode: 'chat',
    name: 'ACE',
    claudeSessionId: null,
    resumeId: resumeId,
    resumeCwd: resumeCwd,
    messages: [],
    pendingAttachments: [],
    currentStreamText: '',
    currentToolInput: '',
    isStreaming: false,
    model: state.chatDefaults.model,
    totalCost: 0,
    needsAttention: false,
    attentionReason: null,
    attentionAt: null,
    totalTokens: { input: 0, output: 0 },
    contextInputTokens: 0,
    turnDeltas: [],
    _prevContextTokens: 0,
    _settledBoundary: 0, _settledHTML: '', _currentAssistantEl: null, _pendingRAF: null, _currentToolBlock: null,
    _paneControls: controls,
  }
  activateSession(id)

  // Keep session model state in sync when user changes the dropdown
  document.getElementById('chat-model-' + id)?.addEventListener('change', function () {
    if (state.sessions[id]) state.sessions[id].model = this.value
    updateContextBar(id, state.sessions[id]?.contextInputTokens || 0)
    updateTelemetry()
  })

  document.getElementById('ctx-bar-' + id)?.addEventListener('click', () => {
    resetContext(id)
  })

  // Move to other pane button (factory wires stab-close → onClose)
  document.getElementById('stab-move-' + id)?.addEventListener('click', (e) => {
    e.stopPropagation()
    moveToOtherGroup(id)
  })

  // Session timer — duration select starts countdown, hides dropdown
  document.getElementById('session-duration-' + id)?.addEventListener('change', (e) => {
    const val = parseInt(e.target.value)
    if (val) {
      startTimer(id, val)
      e.target.style.display = 'none'
    } else {
      clearTimer(id)
    }
  })

  // Input refs from factory — used for streaming cancel toggle + resetPlaceholder
  const inputEl = controls.chatInput
  const sendBtn = controls.sendBtn

  // Reset smart placeholder after first keystroke
  inputEl.addEventListener('input', function resetPlaceholder() {
    if (inputEl.placeholder !== 'Message ACE...') {
      inputEl.placeholder = 'Message ACE...'
      inputEl.removeEventListener('input', resetPlaceholder)
    }
  })

  // Toggle send button between ↑ / ■ during streaming (factory's input listener only resizes)
  inputEl.addEventListener('input', () => {
    if (state.sessions[id]?.isStreaming) {
      const hasText = inputEl.value.trim().length > 0
      sendBtn.textContent = hasText ? '↑' : '■'
      sendBtn.classList.toggle('cancel', !hasText)
    }
  })

  // Attachment handlers
  const attachBtn = document.getElementById('chat-attach-' + id)
  if (attachBtn) {
    attachBtn.addEventListener('click', () => pickAndStage(state.sessions[id], id))
  }
  wireDropZone(state.sessions[id], id)
  wirePasteHandler(state.sessions[id], id)

  // Wire chat stream listeners
  wireChatListeners(id)

  // Auto-switch to terminal mode for resumed sessions
  if (resumeId) {
    requestAnimationFrame(() => toggleSessionMode(id))
  }
}

function _initSessionTerminal(id, xtermEl) {
  const s = state.sessions[id]
  if (!s) return
  const scrollBtn = document.getElementById('scroll-btn-' + id)
  const term = new Terminal({
    fontFamily: '"JetBrains Mono", "Fira Code", monospace',
    fontSize: 12.5, lineHeight: 1.5, cursorBlink: true,
    theme: xtermTheme(), allowProposedApi: true,
  })
  const fitAddon = new FitAddon.FitAddon()
  term.loadAddon(fitAddon)
  s.term = term
  s.fitAddon = fitAddon

  let userScrolledUp = false
  requestAnimationFrame(() => {
    term.open(xtermEl)
    fitAddon.fit()
    if (s.resumeId) {
      window.ace.pty.resume(id, s.resumeCwd, term.cols, term.rows, s.resumeId)
    } else {
      window.ace.pty.create(id, null, term.cols, term.rows)
    }
    term.onScroll(() => {
      userScrolledUp = term.buffer.active.viewportY < term.buffer.active.baseY
      scrollBtn?.classList.toggle('visible', userScrolledUp)
    })
    term.buffer.onBufferChange(() => {
      requestAnimationFrame(() => { term.scrollToBottom(); userScrolledUp = false; scrollBtn?.classList.toggle('visible', false) })
    })
  })
  scrollBtn?.addEventListener('click', () => {
    term.scrollToBottom(); userScrolledUp = false; scrollBtn.classList.toggle('visible', false)
  })
  window.ace.pty.onData(id, data => {
    const wasAtBottom = !userScrolledUp
    term.write(data, () => { if (wasAtBottom) term.scrollToBottom() })
  })
  term.onData(d => window.ace.pty.write(id, d))
  term.onResize(({ cols, rows }) => window.ace.pty.resize(id, cols, rows))
}

export function toggleSessionMode(id) {
  const s = state.sessions[id]
  if (!s) return
  const chatView = document.getElementById('chat-view-' + id)
  const xtermEl = document.getElementById('xterm-' + id)
  const scrollBtn = document.getElementById('scroll-btn-' + id)
  const toggleBtn = document.getElementById('mode-toggle-' + id)
  const hdrPath = document.getElementById('hdr-path-' + id)

  if (s.mode === 'chat') {
    // Switch to terminal mode — factory fires onTerminalInit on first toggle
    // which calls _initSessionTerminal; no init branch needed here.
    s.mode = 'terminal'
    chatView.style.display = 'none'
    xtermEl.style.display = ''
    scrollBtn.style.display = ''
    toggleBtn.textContent = 'Chat'
    hdrPath.textContent = '~/Documents/Actualize'
    if (s.fitAddon) requestAnimationFrame(() => s.fitAddon.fit())
  } else {
    // Switch to chat mode
    s.mode = 'chat'
    chatView.style.display = ''
    xtermEl.style.display = 'none'
    scrollBtn.style.display = 'none'
    toggleBtn.textContent = 'Terminal'
    hdrPath.textContent = 'Chat Mode'
    // Focus input
    setTimeout(() => document.getElementById('chat-input-' + id)?.focus(), 50)
  }
}

// ── Soft GC — DOM pruning + buffer cleanup ────────────────────────────────────
const SOFT_GC_MSG_KEEP = 40

function softGcSessions() {
  for (const [id, s] of Object.entries(state.sessions)) {
    if (s.isStreaming) continue

    // Prune DOM — keep last SOFT_GC_MSG_KEEP messages, tombstone the rest
    const msgsEl = document.getElementById('chat-msgs-' + id)
    if (msgsEl) {
      const msgs = msgsEl.querySelectorAll('.chat-msg')
      const excess = msgs.length - SOFT_GC_MSG_KEEP
      if (excess > 0) {
        for (let i = 0; i < excess; i++) msgs[i].remove()
        const existing = msgsEl.querySelector('.chat-gc-tombstone')
        if (!existing) {
          const tomb = document.createElement('div')
          tomb.className = 'chat-gc-tombstone'
          tomb.textContent = `${excess} earlier messages cleared`
          tomb.style.cssText = 'text-align:center;padding:8px;opacity:0.35;font-size:11px;'
          msgsEl.prepend(tomb)
        } else {
          const prev = parseInt(existing.textContent) || 0
          existing.textContent = `${prev + excess} earlier messages cleared`
        }
      }
    }

    // Clear finalized streaming buffers
    s._settledHTML = ''
    s._settledBoundary = 0
    s._fullResponseText = ''
    s.currentStreamText = ''
    s.currentToolInput = ''

    // Cancel orphaned timers
    if (s._wordTimer) { clearInterval(s._wordTimer); s._wordTimer = null }
    if (s._pendingRAF) { cancelAnimationFrame(s._pendingRAF); s._pendingRAF = null }

    // Release stale DOM refs
    s._currentAssistantEl = null
    s._opsContainer = null
  }
  console.log('[refresh-engine] session-manager soft GC complete')
}

export function closeSession(id) {
  const s = state.sessions[id]
  if (!s) return
  clearTimer(id)
  if (s.term) window.ace.pty.kill(id)
  if (s.isStreaming) window.ace.chat.cancel(id)
  if (s._cleanupListeners) s._cleanupListeners()
  // Determine which group this session is in before removing
  const group = s.pane.parentElement
  s.pane.remove()
  s.tab.remove()
  delete state.sessions[id]
  // Activate next session in the same group
  const groupSessions = Object.entries(state.sessions).filter(([, v]) => v.pane.parentElement === group)
  if (groupSessions.length > 0) {
    activateSession(groupSessions[groupSessions.length - 1][0])
  } else {
    state.activeId = null
    // No sessions left in this group — trigger collapse check
    if (typeof window.splitPaneManager !== 'undefined') {
      window.splitPaneManager.checkCollapse(group)
    }
  }
}

export function activateSession(id) {
  if (!state.sessions[id]) return
  // Only deactivate sessions in the SAME pane group
  const pane = state.sessions[id].pane
  const group = pane.parentElement  // .pane-group-content
  group.querySelectorAll('.term-pane').forEach(p => p.classList.remove('active'))
  const groupTabBar = group.parentElement.querySelector('.session-tabs')
  groupTabBar.querySelectorAll('.stab').forEach(t => t.classList.remove('active'))
  // Activate this session
  pane.classList.add('active')
  state.sessions[id].tab.classList.add('active')
  // Track active per group
  const groupId = group.id === 'pane-content-left' ? 'left' : 'right'
  state.splitActiveIds[groupId] = id
  state.activeId = id
  clearAttention(id)
  if (state.sessions[id].mode === 'terminal' && state.sessions[id].fitAddon) {
    setTimeout(() => state.sessions[id].fitAddon.fit(), 50)
  } else if (state.sessions[id].mode === 'chat') {
    setTimeout(() => document.getElementById('chat-input-' + id)?.focus(), 50)
  }
}

export function fitActive() {
  Object.entries(state.splitActiveIds || {}).forEach(([, sid]) => {
    if (sid && state.sessions[sid] && state.sessions[sid].mode === 'terminal' && state.sessions[sid].fitAddon) {
      state.sessions[sid].fitAddon.fit()
    }
  })
}

export function sendToActive(t) {
  if (!state.activeId) return
  const s = state.sessions[state.activeId]
  if (s.mode === 'chat') {
    // Strip trailing \r for chat mode
    sendChatMessage(state.activeId, t.replace(/\r$/, ''))
  } else {
    window.ace.pty.write(state.activeId, t)
  }
}

// ─── Window Focus / Visibility ────────────────────────────────────────────────
function onWindowRegainFocus() {
  fitActive()
  if (state.focusedAgentId && typeof state.agentSessions !== 'undefined' && state.agentSessions[state.focusedAgentId]) {
    if (state.agentSessions[state.focusedAgentId].mode === 'terminal') {
      state.agentSessions[state.focusedAgentId].fitAddon?.fit()
      state.agentSessions[state.focusedAgentId].term?.scrollToBottom()
    }
  }
}

// ─── Init ────────────────────────────────────────────────────────────────────

export function initSessions() {
  // Load chatDefaults and cost guardrail from config
  ;(async () => {
    const cfg = await window.ace.setup.getConfig()
    if (cfg?.defaults?.chat) state.chatDefaults = cfg.defaults.chat
    if (cfg?.defaults?.guardrails?.sessionCostWarning) state._costGuardrail = cfg.defaults.guardrails.sessionCostWarning
    state._autoScroll = cfg?.defaults?.startup?.autoScroll !== false
  })()

  // New session button
  document.getElementById('new-session-btn').addEventListener('click', spawnSession)

  // ResizeObserver for fitActive
  const ro = new ResizeObserver(() => fitActive())
  ro.observe(document.getElementById('pane-content-left'))

  // External links: intercept clicks and open in default browser
  document.addEventListener('click', (e) => {
    const a = e.target.closest('a[href]')
    if (!a) return
    const href = a.getAttribute('href')
    if (href && (href.startsWith('http://') || href.startsWith('https://'))) {
      e.preventDefault()
      window.ace.shell.openExternal(href)
    }
  })

  // Window focus / visibility handlers
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible') setTimeout(onWindowRegainFocus, 50)
  })
  window.addEventListener('focus', () => setTimeout(onWindowRegainFocus, 50))

  // Make key functions available globally (called from view modules during migration)
  window.fitActive = fitActive
  window.sendToActive = sendToActive
  window.spawnSession = spawnSession
  window.sendChatMessage = sendChatMessage
  window.activateSession = activateSession

  initSplitPane()
  onSoftGC(softGcSessions)
}
