// renderer/modules/session-manager.js
import { state } from '../state.js'
import { xtermTheme } from './theme.js'
import { escapeHtml, syntaxHighlight, findSettledBoundary, renderTail, postProcessCodeBlocks, processWikilinks, SANITIZE_CONFIG } from './chat-renderer.js'
import { updateOrbState } from './ace-mark.js'
import { setAttention, clearAttention, updateAttentionBadge } from './attention.js'
import { onSessionClose } from './atmosphere.js'
import { initSplitPane, moveToOtherGroup } from './split-pane-manager.js'

// ─── Chat System ─────────────────────────────────────────────────────────────

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
  userMsg.innerHTML = `<div class="chat-msg-label">YOU</div><div class="chat-msg-content">${escapeHtml(prompt.trim())}</div>`
  // Remove welcome if present
  const welcome = msgsEl.querySelector('.chat-welcome')
  if (welcome) welcome.remove()
  msgsEl.appendChild(userMsg)

  // Add assistant message placeholder
  const assistantMsg = document.createElement('div')
  assistantMsg.className = 'chat-msg chat-msg-assistant'
  assistantMsg.innerHTML = `<div class="chat-msg-label">ACE <span class="chat-streaming-indicator"><span></span><span></span><span></span></span><span class="chat-status-word" id="status-word-${id}">Thinking</span></div><div class="chat-msg-content md-body"><div class="chat-settled"></div><div class="chat-tail"></div></div>`
  msgsEl.appendChild(assistantMsg)

  s.messages.push({ role: 'user', content: prompt.trim(), timestamp: Date.now() })
  s.currentStreamText = ''
  s._fullResponseText = ''
  s.currentToolInput = ''
  s.isStreaming = true
  updateOrbState()
  s._settledBoundary = 0
  s._settledHTML = ''
  s._currentAssistantEl = assistantMsg
  s._pendingRAF = null

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

  // Send to backend
  window.ace.chat.send(id, prompt.trim(), s.claudeSessionId, opts)

  // Start rotating status words
  const STATUS_WORDS = ['Thinking', 'Reasoning', 'Analyzing', 'Synthesizing', 'Composing', 'Reflecting', 'Processing', 'Connecting', 'Exploring', 'Weaving']
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

  const boundary = findSettledBoundary(s.currentStreamText)
  if (boundary > s._settledBoundary) {
    const settledText = s.currentStreamText.slice(0, boundary)
    const withWikilinks = processWikilinks(settledText)
    const raw = marked.parse(withWikilinks)
    const safe = DOMPurify.sanitize(raw, SANITIZE_CONFIG)
    settledEl.innerHTML = safe
    s._settledBoundary = boundary
    s._settledHTML = safe
    postProcessCodeBlocks(settledEl)
  }

  const tail = s.currentStreamText.slice(boundary)
  tailEl.innerHTML = tail ? renderTail(tail) : ''

  // Auto-scroll
  const msgsEl = document.getElementById('chat-msgs-' + id)
  if (msgsEl) {
    const isAtBottom = (msgsEl.scrollHeight - msgsEl.scrollTop - msgsEl.clientHeight) < 60
    if (isAtBottom) msgsEl.scrollTop = msgsEl.scrollHeight
  }
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
  updateOrbState()
  // Final full render
  if (s._currentAssistantEl) {
    const contentEl = s._currentAssistantEl.querySelector('.chat-msg-content')
    // Use LAST settled/tail pair (matches renderChatStream behavior)
    const settledEls = contentEl.querySelectorAll('.chat-settled')
    const tailEls = contentEl.querySelectorAll('.chat-tail')
    const settledEl = settledEls[settledEls.length - 1]
    const tailEl = tailEls[tailEls.length - 1]
    const withWikilinks = processWikilinks(s.currentStreamText)
    const raw = marked.parse(withWikilinks)
    const safe = DOMPurify.sanitize(raw, SANITIZE_CONFIG)
    settledEl.innerHTML = safe
    tailEl.innerHTML = ''
    postProcessCodeBlocks(settledEl)
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
  clearActivityIndicator(id, sessionsObj)
  if (s._wordTimer) { clearInterval(s._wordTimer); s._wordTimer = null }
  s._toolGroup = null
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

// Tools that show expanded with content preview (auto-approved but visible)
const VISIBLE_TOOLS = new Set(['Edit', 'Write', 'Bash', 'NotebookEdit'])
// Tools that need user input (questions)
const QUESTION_TOOLS = new Set(['AskUserQuestion'])

// Tool block helpers — consolidates consecutive same-type tools into one block
export function appendToolBlock(id, toolInfo, sessionsObj) {
  sessionsObj = sessionsObj || state.sessions
  const s = sessionsObj[id]
  if (!s || !s._currentAssistantEl) return
  const contentEl = s._currentAssistantEl.querySelector('.chat-msg-content')
  const toolName = toolInfo.name || 'Tool'
  const needsInput = QUESTION_TOOLS.has(toolName)
  const showExpanded = VISIBLE_TOOLS.has(toolName)

  // Only consolidate non-interactive, non-visible tools
  if (!needsInput && !showExpanded && s._toolGroup && s._toolGroup.name === toolName && s._toolGroup.block) {
    s._toolGroup.count++
    s._toolGroup.items.push({ input: '' })
    const header = s._toolGroup.block.querySelector('.chat-tool-name')
    if (header) header.textContent = `${toolName} · ${s._toolGroup.count} calls`
    updateActivityIndicator(id, toolName, sessionsObj)
    s._currentToolBlock = s._toolGroup.block
    s.currentToolInput = ''
    return
  }

  // New tool block
  const block = document.createElement('div')
  block.className = 'chat-tool-block' + (showExpanded ? '' : ' collapsed')

  if (needsInput) {
    block.className = 'chat-question-block'
    block.innerHTML = `<div class="question-header" id="question-text-${id}"></div>`
    s._questionBlockEl = block
    // Trigger attention — a question needs the user's input
    setAttention(id, sessionsObj)
  } else {
    block.innerHTML = `<div class="chat-tool-header"><span class="chat-tool-icon">⚡</span><span class="chat-tool-name">${escapeHtml(toolName)}</span><span class="chat-tool-chevron">▸</span></div><div class="chat-tool-detail"></div>`
  }

  const hdr = block.querySelector('.chat-tool-header')
  if (hdr) hdr.addEventListener('click', () => block.classList.toggle('collapsed'))
  const tailEl = contentEl.querySelector('.chat-tail:last-of-type')
  contentEl.insertBefore(block, tailEl)

  // Don't group visible or interactive tools
  s._toolGroup = (needsInput || showExpanded) ? null : { name: toolName, block, count: 1, items: [{ input: '' }] }
  s._currentToolBlock = block
  s.currentToolInput = ''

  updateActivityIndicator(id, toolName, sessionsObj)
}

export function appendToolInput(id, partialJson, sessionsObj) {
  sessionsObj = sessionsObj || state.sessions
  const s = sessionsObj[id]
  if (!s || !s._currentToolBlock) return
  s.currentToolInput += partialJson

  // Update activity indicator with file path or tool details
  let toolGroupName = s._toolGroup?.name || ''
  try {
    const parsed = JSON.parse(s.currentToolInput)
    const detail = parsed.file_path || parsed.path || parsed.command || parsed.pattern || parsed.query || ''
    if (detail) {
      const short = detail.split('/').pop() || detail.slice(0, 40)
      updateActivityIndicator(id, `${toolGroupName}: ${short}`, sessionsObj)
    }
  } catch {}

  const detailEl = s._currentToolBlock.querySelector('.chat-tool-detail')
  if (!detailEl) return

  if (s._toolGroup) {
    // Grouped read-only tool — update latest item and show compact list
    const items = s._toolGroup.items
    if (items.length > 0) items[items.length - 1].input = s.currentToolInput
    let html = ''
    for (const item of items) {
      let label = ''
      try {
        const p = JSON.parse(item.input)
        label = p.file_path || p.path || p.command || p.pattern || p.query || item.input.slice(0, 60)
        if (label.includes('/')) {
          const parts = label.split('/')
          label = parts.length > 3 ? '.../' + parts.slice(-3).join('/') : label
        }
      } catch {
        label = item.input.slice(0, 60) || '...'
      }
      html += `<div class="tool-item">${escapeHtml(label)}</div>`
    }
    detailEl.innerHTML = html
  } else if (s._questionBlockEl) {
    // Question tool — render the question text as markdown
    try {
      const parsed = JSON.parse(s.currentToolInput)
      const question = parsed.question || parsed.text || parsed.message || JSON.stringify(parsed, null, 2)
      const headerEl = s._questionBlockEl.querySelector('.question-header')
      if (headerEl) {
        headerEl.innerHTML = DOMPurify.sanitize(marked.parse(question), SANITIZE_CONFIG)
        headerEl.classList.add('md-body')
      }
      const msgsEl = document.getElementById('chat-msgs-' + id)
      if (msgsEl) msgsEl.scrollTop = msgsEl.scrollHeight
    } catch {}
    return
  } else {
    // Visible tool (Edit/Write/Bash) — show full input as formatted diff/content
    try {
      const parsed = JSON.parse(s.currentToolInput)
      if (parsed.old_string != null && parsed.new_string != null) {
        // Edit tool — show diff view
        const file = parsed.file_path ? `<div class="tool-item" style="font-weight:500">${escapeHtml(parsed.file_path.split('/').slice(-3).join('/'))}</div>` : ''
        detailEl.innerHTML = `${file}<pre class="tool-diff"><span class="diff-remove">${escapeHtml(parsed.old_string)}</span><span class="diff-add">${escapeHtml(parsed.new_string)}</span></pre>`
      } else if (parsed.command) {
        // Bash tool — show command
        detailEl.innerHTML = `<pre>${escapeHtml(parsed.command)}</pre>`
      } else if (parsed.content != null) {
        // Write tool — show file path + content preview
        const file = parsed.file_path ? `<div class="tool-item" style="font-weight:500">${escapeHtml(parsed.file_path.split('/').slice(-3).join('/'))}</div>` : ''
        const preview = parsed.content.length > 500 ? parsed.content.slice(0, 500) + '...' : parsed.content
        detailEl.innerHTML = `${file}<pre>${escapeHtml(preview)}</pre>`
      } else {
        detailEl.innerHTML = `<pre>${escapeHtml(JSON.stringify(parsed, null, 2))}</pre>`
      }
    } catch {
      detailEl.innerHTML = `<pre>${escapeHtml(s.currentToolInput)}</pre>`
    }
  }
}

// Activity indicator — shows what Claude is doing right now
export function updateActivityIndicator(id, text, sessionsObj) {
  sessionsObj = sessionsObj || state.sessions
  const s = sessionsObj[id]
  if (!s || !s._currentAssistantEl) return
  let indicator = s._currentAssistantEl.querySelector('.chat-activity')
  if (!indicator) {
    indicator = document.createElement('div')
    indicator.className = 'chat-activity'
    const label = s._currentAssistantEl.querySelector('.chat-msg-label')
    if (label) label.after(indicator)
  }
  indicator.textContent = text
  // Also update the status word to match the action
  const wordEl = document.getElementById('status-word-' + id)
  if (wordEl) {
    const action = text.split(':')[0] || text
    const TOOL_WORDS = { Read: 'Reading', Glob: 'Searching', Grep: 'Scanning', Edit: 'Editing', Write: 'Writing', Bash: 'Executing', WebFetch: 'Fetching', WebSearch: 'Searching' }
    wordEl.textContent = TOOL_WORDS[action] || action
  }
}

export function clearActivityIndicator(id, sessionsObj) {
  sessionsObj = sessionsObj || state.sessions
  const s = sessionsObj[id]
  if (!s || !s._currentAssistantEl) return
  const indicator = s._currentAssistantEl.querySelector('.chat-activity')
  if (indicator) indicator.remove()
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
    // Real context = input + cache fields (Claude caches full conversation history)
    if (event.usage) {
      const u = event.usage
      s.contextInputTokens = (u.input_tokens || 0) + (u.cache_creation_input_tokens || 0) + (u.cache_read_input_tokens || 0)
    }
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

  // Update context bar using actual context window usage
  updateContextBar(id, s.contextInputTokens)

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
  const CTX_LIMITS = { opus: 1000000, sonnet: 200000, haiku: 200000 }
  const maxCtx = CTX_LIMITS[model] || 200000
  const pct = Math.min(100, (totalTokens / maxCtx) * 100)
  const fill = document.getElementById('ctx-fill-' + id)
  const label = document.getElementById('ctx-label-' + id)
  const barEl = document.getElementById('ctx-bar-' + id)
  if (fill) {
    fill.style.width = pct + '%'
    fill.className = 'ctx-bar-fill' + (pct > 80 ? ' critical' : pct > 50 ? ' warn' : '')
  }
  if (barEl) barEl.title = `Context: ${formatTokens(totalTokens)} / ${formatTokens(maxCtx)} tokens (${Math.round(pct)}%)`
  if (label) label.textContent = Math.round(pct) + '%'

  // Ambient pressure — somatic response on the pane itself
  const paneEl = document.getElementById('pane-' + id)
  if (paneEl) {
    paneEl.classList.toggle('ctx-warn',     pct >= 50 && pct < 80)
    paneEl.classList.toggle('ctx-hot',      pct >= 80 && pct < 95)
    paneEl.classList.toggle('ctx-critical', pct >= 95)
  }
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
          appendToolBlock(id, e.content_block, sessionsObj)
        } else if (e.content_block?.type === 'text') {
          // Text block starts — end any tool group and clear activity
          clearActivityIndicator(id, sessionsObj)
          // If there were tool blocks before this text, create new settled/tail
          // so text renders AFTER the tool blocks in the DOM
          if (s._toolGroup || s._hadToolBlocks) {
            s._toolGroup = null
            // Finalize current settled text
            if (s.currentStreamText && s._currentAssistantEl) {
              const contentEl = s._currentAssistantEl.querySelector('.chat-msg-content')
              const settledEl = contentEl?.querySelector('.chat-settled:last-of-type')
              const tailEl = contentEl?.querySelector('.chat-tail:last-of-type')
              if (settledEl && s.currentStreamText) {
                const withWikilinks = processWikilinks(s.currentStreamText)
                const raw = marked.parse(withWikilinks)
                const safe = DOMPurify.sanitize(raw, SANITIZE_CONFIG)
                settledEl.innerHTML = safe
                postProcessCodeBlocks(settledEl)
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
          appendToolInput(id, e.delta.partial_json, sessionsObj)
        }
      }
      if (e.type === 'content_block_stop') {
        if (s._currentToolBlock) {
          // Detect /close skill invocation
          if (s._toolGroup?.name === 'Skill' || (!s._toolGroup && s._currentToolBlock.querySelector?.('.chat-tool-name')?.textContent?.includes('Skill'))) {
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
          renderPermissionApprovalCard(id, claudeEdits, sessionsObj)
        }
      }
    }
  })
  const cleanupError = window.ace.chat.onError(id, msg => {
    const msgsEl = document.getElementById('chat-msgs-' + id)
    if (!msgsEl) return
    if (msg.includes('No STDIN data') || msg.includes('proceeding without')) return
    const errEl = document.createElement('div')
    errEl.className = 'chat-error'
    errEl.textContent = msg
    msgsEl.appendChild(errEl)
    setAttention(id, sessionsObj)
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
    if (!sessionVisible && !agentVisible) setAttention(id, sessionsObj)
  })
  // Store cleanup functions on session so listeners are removed on close
  const s = sessionsObj[id]
  if (s) s._cleanupListeners = () => { cleanupStream(); cleanupError(); cleanupExit() }
}

// Render approval card for .claude/ permission denials
function renderPermissionApprovalCard(chatId, denials, sessionsObj) {
  const msgsEl = document.getElementById('chat-msgs-' + chatId)
  if (!msgsEl) return

  // Deduplicate retries (same file + same old_string)
  const seen = new Set()
  const unique = denials.filter(d => {
    const key = d.tool_input.file_path + '|' + d.tool_input.old_string
    if (seen.has(key)) return false
    seen.add(key)
    return true
  })

  const esc = str => String(str ?? '').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;')

  const card = document.createElement('div')
  card.className = 'chat-permission-card'

  let html = `<div class="permission-card-header">Edit requires approval</div>`
  unique.forEach((d, i) => {
    const inp = d.tool_input
    const short = inp.file_path.replace(/^.*\/\.claude\//, '.claude/')
    html += `
      <div class="permission-edit-item">
        <div class="permission-file-path">${esc(short)}</div>
        <div class="permission-diff">
          <div class="permission-diff-old">− ${esc(inp.old_string)}</div>
          <div class="permission-diff-new">+ ${esc(inp.new_string)}</div>
        </div>
      </div>`
  })
  html += `
    <div class="chat-tool-actions">
      <button class="chat-approve-btn permission-approve">Approve</button>
      <button class="chat-deny-btn permission-deny">Deny</button>
    </div>`

  card.innerHTML = html
  msgsEl.appendChild(card)
  msgsEl.scrollTop = msgsEl.scrollHeight

  card.querySelector('.permission-approve').addEventListener('click', async () => {
    const btn = card.querySelector('.permission-approve')
    btn.disabled = true
    btn.textContent = 'Applying...'
    let allOk = true
    for (const d of unique) {
      const { file_path, old_string, new_string, replace_all } = d.tool_input
      try {
        const content = await window.ace.vault.readFile(file_path)
        if (typeof content !== 'string') { allOk = false; continue }
        let updated
        if (replace_all) {
          updated = content.split(old_string).join(new_string)
        } else {
          const idx = content.indexOf(old_string)
          if (idx === -1) { allOk = false; continue }
          updated = content.slice(0, idx) + new_string + content.slice(idx + old_string.length)
        }
        const res = await window.ace.vault.writeFile(file_path, updated)
        if (res?.error) allOk = false
      } catch { allOk = false }
    }
    btn.textContent = allOk ? 'Applied' : 'Partial — check files'
    card.querySelector('.permission-deny').style.display = 'none'

    // Inject confirmation message into chat
    const msgsEl = document.getElementById('chat-msgs-' + chatId)
    if (msgsEl) {
      const confirm = document.createElement('div')
      confirm.className = 'chat-msg assistant'
      const paths = unique.map(d => d.tool_input.file_path.replace(/^.*\/\.claude\//, '.claude/')).join(', ')
      confirm.innerHTML = `<div class="msg-content md-body">${allOk
        ? `<strong>Done.</strong> Edited ${paths} directly (bypassed CLI permission).`
        : `<strong>Partial.</strong> Some edits to ${paths} may not have applied — check the files.`
      }</div>`
      msgsEl.appendChild(confirm)
      msgsEl.scrollTop = msgsEl.scrollHeight
    }
  })

  card.querySelector('.permission-deny').addEventListener('click', () => card.remove())
}

// Render an interactive question card from AskUserQuestion tool input
export function renderQuestionCard(id, data, containerEl, sessionsObj) {
  sessionsObj = sessionsObj || state.sessions
  const question = data.question || data.text || data.message || ''
  const options = data.options || []
  const isMulti = data.multiple === true || data.multi === true ||
                  (data.type && data.type.includes('multi'))

  let html = ''
  // Question header
  if (question) {
    const rendered = DOMPurify.sanitize(marked.parse(question), SANITIZE_CONFIG)
    html += `<div class="question-header md-body">${rendered}</div>`
  }

  if (options.length > 0) {
    // Options with radio buttons or checkboxes
    const inputType = isMulti ? 'checkbox' : 'radio'
    const groupName = 'q-' + id + '-' + Date.now()
    html += `<div class="question-options">`
    options.forEach((opt, i) => {
      const label = typeof opt === 'string' ? opt : (opt.label || opt.value || opt.text || JSON.stringify(opt))
      const desc = typeof opt === 'object' ? (opt.description || opt.desc || '') : ''
      html += `
        <label class="question-option">
          <input type="${inputType}" name="${groupName}" value="${escapeHtml(label)}" />
          <div class="question-option-content">
            <span class="question-option-label">${escapeHtml(label)}</span>
            ${desc ? `<span class="question-option-desc">${escapeHtml(desc)}</span>` : ''}
          </div>
        </label>`
    })
    html += `</div>`
    html += `<button class="chat-approve-btn question-submit">Submit</button>`
  } else {
    // No predefined options — show text input
    html += `
      <div class="chat-prompt-input-area">
        <textarea class="chat-input chat-prompt-response" placeholder="Type your answer..." rows="2"></textarea>
        <button class="chat-approve-btn question-submit">Send</button>
      </div>`
  }

  containerEl.innerHTML = html

  // Wire submit
  const submitBtn = containerEl.querySelector('.question-submit')
  submitBtn.addEventListener('click', () => {
    let answer = ''
    if (options.length > 0) {
      const checked = containerEl.querySelectorAll('input:checked')
      answer = [...checked].map(c => c.value).join(', ')
    } else {
      const textarea = containerEl.querySelector('textarea')
      answer = textarea?.value?.trim() || ''
    }
    if (!answer) return
    window.ace.chat.respond(id, answer)
    // Disable the card
    containerEl.querySelectorAll('input, textarea, button').forEach(el => el.disabled = true)
    submitBtn.textContent = 'Submitted'
    containerEl.classList.add('answered')
  })

  // Auto-scroll
  const msgsEl = document.getElementById('chat-msgs-' + id)
  if (msgsEl) msgsEl.scrollTop = msgsEl.scrollHeight
}

// ─── Sessions ────────────────────────────────────────────────────────────────

export function spawnSession(opts) {
  const resumeId = opts?.resumeId || null
  const resumeCwd = opts?.resumeCwd || null
  const id = 'sess-' + Date.now()

  const pane = document.createElement('div')
  pane.className = 'term-pane'; pane.id = 'pane-' + id
  pane.innerHTML = `
    <div class="term-hdr">
      <div class="term-hdr-dot" style="background:var(--green);box-shadow:0 0 7px rgba(109,184,143,0.5)"></div>
      <div class="term-hdr-label">ACE Session</div>
      <button class="mode-toggle-btn" id="mode-toggle-${id}">Terminal</button>
      <div class="term-hdr-path" id="hdr-path-${id}">Chat Mode</div>
    </div>
    <div class="chat-view" id="chat-view-${id}">
      <div class="chat-messages" id="chat-msgs-${id}">
        <div class="chat-welcome">
          <div class="chat-welcome-icon"><svg width="36" height="36" viewBox="0 0 100 100" xmlns="http://www.w3.org/2000/svg"><defs><radialGradient id="cw-orb" cx="38%" cy="38%" r="60%"><stop offset="0%" stop-color="#8878ff"/><stop offset="50%" stop-color="#c8a0f0"/><stop offset="100%" stop-color="#60d8a8"/></radialGradient><radialGradient id="cw-center" cx="50%" cy="50%" r="50%"><stop offset="0%" stop-color="rgba(220,200,255,0.9)"/><stop offset="30%" stop-color="rgba(180,160,240,0.4)"/><stop offset="100%" stop-color="rgba(160,140,240,0)"/></radialGradient></defs><circle cx="50" cy="50" r="38" fill="url(#cw-orb)" opacity="0.12"/><circle cx="50" cy="50" r="18" fill="url(#cw-orb)" opacity="0.7"/><circle cx="50" cy="50" r="10" fill="url(#cw-center)" opacity="0.9"/></svg></div>
          <div class="chat-welcome-text">ACE Chat</div>
          <div class="chat-welcome-sub">Enter to send · Shift+Enter for newline · Type a message below</div>
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
      <div class="chat-input-area">
        <textarea class="chat-input" id="chat-input-${id}" placeholder="Message ACE..." rows="1"></textarea>
        <button class="chat-send-btn" id="chat-send-${id}">↑</button>
      </div>
    </div>
    <div class="term-xterm" id="xterm-${id}" style="display:none"></div>
    <button class="scroll-to-bottom" id="scroll-btn-${id}" title="Scroll to bottom" style="display:none">↓</button>`
  const targetContainer = opts?.container || document.getElementById('pane-content-left')
  targetContainer.appendChild(pane)

  const tab = document.createElement('div')
  tab.className = 'stab'; tab.id = 'tab-' + id
  const moveArrow = targetContainer.id === 'pane-content-right' ? '←' : '→'
  tab.innerHTML = `<div class="stab-dot"></div><span>ACE</span><span class="stab-move" id="stab-move-${id}" title="Move to other pane">${moveArrow}</span><span class="stab-close" id="stab-close-${id}" title="Close session">×</span>`
  tab.addEventListener('click', (e) => { if (!e.target.classList.contains('stab-close') && !e.target.classList.contains('stab-move')) activateSession(id) })
  const targetTabBar = opts?.tabBar || document.getElementById('session-tabs-left')
  const addBtn = targetTabBar.querySelector('.stab-add')
  targetTabBar.insertBefore(tab, addBtn)

  state.sessions[id] = {
    term: null, fitAddon: null, pane, tab,
    mode: 'chat',
    claudeSessionId: null,
    resumeId: resumeId,
    resumeCwd: resumeCwd,
    messages: [],
    currentStreamText: '',
    currentToolInput: '',
    isStreaming: false,
    model: state.chatDefaults.model,
    totalCost: 0,
    totalTokens: { input: 0, output: 0 },
    contextInputTokens: 0,
    _settledBoundary: 0, _settledHTML: '', _currentAssistantEl: null, _pendingRAF: null, _currentToolBlock: null,
  }
  activateSession(id)

  // Keep session model state in sync when user changes the dropdown
  document.getElementById('chat-model-' + id)?.addEventListener('change', function () {
    if (state.sessions[id]) state.sessions[id].model = this.value
    updateContextBar(id, state.sessions[id]?.contextInputTokens || 0)
  })

  // Close button
  document.getElementById('stab-close-' + id).addEventListener('click', (e) => {
    e.stopPropagation()
    closeSession(id)
  })

  // Move to other pane button
  document.getElementById('stab-move-' + id).addEventListener('click', (e) => {
    e.stopPropagation()
    moveToOtherGroup(id)
  })

  // Chat input handling
  const inputEl = document.getElementById('chat-input-' + id)
  const sendBtn = document.getElementById('chat-send-' + id)

  inputEl.addEventListener('keydown', e => {
    if (e.key === 'Enter' && !e.shiftKey) {
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
  inputEl.addEventListener('input', () => {
    inputEl.style.height = 'auto'
    inputEl.style.height = Math.min(inputEl.scrollHeight, 150) + 'px'
    // Toggle button between queue/cancel during streaming
    if (state.sessions[id].isStreaming) {
      const hasText = inputEl.value.trim().length > 0
      sendBtn.textContent = hasText ? '↑' : '■'
      sendBtn.classList.toggle('cancel', !hasText)
    }
  })

  sendBtn.addEventListener('click', () => {
    const prompt = inputEl.value
    if (state.sessions[id].isStreaming && !prompt.trim()) {
      window.ace.chat.cancel(id)
      return
    }
    if (!prompt.trim()) return
    inputEl.value = ''
    inputEl.style.height = 'auto'
    sendChatMessage(id, prompt)
  })

  // Wire chat stream listeners
  wireChatListeners(id)

  // Mode toggle (chat ↔ terminal)
  document.getElementById('mode-toggle-' + id).addEventListener('click', () => {
    toggleSessionMode(id)
  })

  // Auto-switch to terminal mode for resumed sessions
  if (resumeId) {
    requestAnimationFrame(() => toggleSessionMode(id))
  }
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
    // Switch to terminal mode
    s.mode = 'terminal'
    chatView.style.display = 'none'
    xtermEl.style.display = ''
    scrollBtn.style.display = ''
    toggleBtn.textContent = 'Chat'
    hdrPath.textContent = '~/Documents/Actualize'

    // Lazy-init xterm + PTY
    if (!s.term) {
      const term = new Terminal({
        fontFamily: '"JetBrains Mono", "Fira Code", monospace',
        fontSize: 12.5, lineHeight: 1.5, cursorBlink: true,
        theme: xtermTheme(), allowProposedApi: true,
      })
      const fitAddon = new FitAddon.FitAddon()
      term.loadAddon(fitAddon)
      s.term = term; s.fitAddon = fitAddon

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
          scrollBtn.classList.toggle('visible', userScrolledUp)
        })
        term.buffer.onBufferChange(() => {
          requestAnimationFrame(() => { term.scrollToBottom(); userScrolledUp = false; scrollBtn.classList.toggle('visible', false) })
        })
      })

      scrollBtn.addEventListener('click', () => {
        term.scrollToBottom(); userScrolledUp = false; scrollBtn.classList.toggle('visible', false)
      })
      window.ace.pty.onData(id, data => {
        const wasAtBottom = !userScrolledUp
        term.write(data, () => { if (wasAtBottom) term.scrollToBottom() })
      })
      term.onData(data => window.ace.pty.write(id, data))
      term.onResize(({ cols, rows }) => window.ace.pty.resize(id, cols, rows))
    } else {
      requestAnimationFrame(() => s.fitAddon.fit())
    }
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

export function closeSession(id) {
  const s = state.sessions[id]
  if (!s) return
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
}
