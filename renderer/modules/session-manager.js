// renderer/modules/session-manager.js
import { state } from '../state.js'
import { xtermTheme } from './theme.js'
import { escapeHtml, syntaxHighlight, findSettledBoundary, renderTail, postProcessCodeBlocks, processWikilinks, SANITIZE_CONFIG } from './chat-renderer.js'
import { updateOrbState, aceMarkSvg } from './ace-mark.js'
import { setAttention, clearAttention, updateAttentionBadge } from './attention.js'
import { onSessionClose } from './atmosphere.js'
import { initSplitPane, moveToOtherGroup } from './split-pane-manager.js'
import { startTimer, clearTimer } from './session-timer.js'
import { attach as attachSlashMenu } from './slash-menu.js'

// ─── Chat System ─────────────────────────────────────────────────────────────

// Derive a short session name from the first user prompt. Keeps the label
// scannable across tabs. Falls back to 'ACE' if the prompt is empty.
function deriveSessionName(prompt) {
  if (!prompt || !prompt.trim()) return 'ACE'
  const cleaned = prompt.trim().replace(/\s+/g, ' ')
  if (cleaned.length <= 28) return cleaned
  return cleaned.slice(0, 28).trim() + '…'
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

  // Auto-name session on first user send (while name is still the default).
  // Only the tab gets the name — the header label stays "ACE SESSION" as a
  // static category marker. Tab = identity, header = category.
  if (s.messages.length === 0 && (!s.name || s.name === 'ACE')) {
    const newName = deriveSessionName(prompt)
    s.name = newName
    const tabLabel = document.getElementById('tab-label-' + id)
    if (tabLabel) tabLabel.textContent = newName
  }

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

// ─── Memory card rendering ───────────────────────────────────────────────────
// When auto-memory writes to `memory/*.md` via the Write tool, render an
// ambient card in the chat stream alongside the tool ops. Makes the
// compounding-intelligence loop visible instead of invisible. V2 · Standard
// variant — see docs/plans/2026-04-12-memory-card-prototype.html.

const MEMORY_TYPES = new Set(['user', 'feedback', 'project', 'reference'])

function isMemoryWritePath(filePath) {
  if (!filePath) return false
  // Match any path that contains a memory/ segment and ends in .md,
  // excluding the MEMORY.md index itself.
  const basename = filePath.split('/').pop() || ''
  if (basename === 'MEMORY.md') return false
  return /(^|\/)memory\/[^/]+\.md$/.test(filePath) && basename.endsWith('.md')
}

function parseMemoryFrontmatter(content) {
  if (!content || typeof content !== 'string') return null
  const m = content.match(/^---\s*\n([\s\S]*?)\n---\s*\n?([\s\S]*)$/)
  if (!m) return null
  const frontmatter = m[1]
  const body = (m[2] || '').trim()
  const fields = {}
  frontmatter.split('\n').forEach(line => {
    const kv = line.match(/^([a-zA-Z_][\w-]*)\s*:\s*(.*)$/)
    if (!kv) return
    let val = kv[2].trim()
    // Strip surrounding quotes
    if ((val.startsWith('"') && val.endsWith('"')) || (val.startsWith("'") && val.endsWith("'"))) {
      val = val.slice(1, -1)
    }
    fields[kv[1]] = val
  })
  const type = MEMORY_TYPES.has(fields.type) ? fields.type : 'reference'
  const description = fields.description || ''
  // Prefer description for the hook; fall back to first non-heading body line.
  let hook = description
  if (!hook && body) {
    const firstLine = body.split('\n').find(l => l.trim() && !l.trim().startsWith('#'))
    hook = (firstLine || '').trim()
  }
  return { type, description, hook, name: fields.name || '' }
}

function renderMemoryCard(contentEl, parsed) {
  const meta = parseMemoryFrontmatter(parsed.content)
  if (!meta || !meta.hook) return
  const card = document.createElement('div')
  card.className = 'chat-memory-card'
  card.innerHTML = `
    <div class="chat-memory-header">
      <span class="chat-memory-icon">🧠</span>
      <span class="chat-memory-title">Memory saved</span>
      <span class="chat-memory-type ${meta.type}">${meta.type}</span>
      <span class="chat-memory-time">just now</span>
    </div>
    <div class="chat-memory-body">${escapeHtml(meta.hook)}</div>
  `
  // Insert before the current tail so the card sits after tool ops in reading order.
  const tailEl = contentEl.querySelector('.chat-tail:last-of-type')
  if (tailEl) contentEl.insertBefore(card, tailEl)
  else contentEl.appendChild(card)
}

// Tools that need user input (questions) — render outside ops container
const QUESTION_TOOLS = new Set(['AskUserQuestion'])

// Tool block helpers — all non-question tools go into an ops container
export function appendToolBlock(id, toolInfo, sessionsObj) {
  sessionsObj = sessionsObj || state.sessions
  const s = sessionsObj[id]
  if (!s || !s._currentAssistantEl) return
  const contentEl = s._currentAssistantEl.querySelector('.chat-msg-content')
  const toolName = toolInfo.name || 'Tool'
  const needsInput = QUESTION_TOOLS.has(toolName)

  // Track current tool name for Skill/close detection
  s._currentToolName = toolName

  if (needsInput) {
    // Question tool — render outside container, break current container
    s._opsContainer = null
    s._opsCount = 0
    const block = document.createElement('div')
    block.className = 'chat-question-block'
    block.innerHTML = `<div class="question-header" id="question-text-${id}"></div>`
    s._questionBlockEl = block
    const tailEl = contentEl.querySelector('.chat-tail:last-of-type')
    contentEl.insertBefore(block, tailEl)
    setAttention(id, sessionsObj, 'question')
    s._currentToolBlock = block
    s.currentToolInput = ''
    updateActivityIndicator(id, toolName, sessionsObj)
    return
  }

  // Non-question tool — add to ops container
  if (!s._opsContainer) {
    // Create new ops container
    const container = document.createElement('div')
    container.className = 'chat-ops-container collapsed'
    container.innerHTML = `<div class="chat-ops-header"><span class="chat-ops-icon">⚡</span><span class="chat-ops-count">1 operation</span><span class="chat-ops-chevron">▸</span></div><div class="chat-ops-list"></div>`
    container.querySelector('.chat-ops-header').addEventListener('click', () => container.classList.toggle('collapsed'))
    const tailEl = contentEl.querySelector('.chat-tail:last-of-type')
    contentEl.insertBefore(container, tailEl)
    s._opsContainer = container
    s._opsCount = 0
  }

  // Create ops item
  s._opsCount++
  const countEl = s._opsContainer.querySelector('.chat-ops-count')
  if (countEl) countEl.textContent = s._opsCount === 1 ? '1 operation' : `${s._opsCount} operations`

  const item = document.createElement('div')
  item.className = 'chat-ops-item collapsed'
  item.innerHTML = `<div class="chat-ops-item-header"><span class="chat-ops-item-label">${escapeHtml(toolName)}</span><span class="chat-ops-item-chevron">▸</span></div><div class="chat-ops-item-detail"></div>`
  item.querySelector('.chat-ops-item-header').addEventListener('click', () => item.classList.toggle('collapsed'))

  s._opsContainer.querySelector('.chat-ops-list').appendChild(item)
  s._currentToolBlock = item
  s.currentToolInput = ''

  updateActivityIndicator(id, toolName, sessionsObj)
  scrollChatToBottom(id, 120)
}

export function appendToolInput(id, partialJson, sessionsObj) {
  sessionsObj = sessionsObj || state.sessions
  const s = sessionsObj[id]
  if (!s || !s._currentToolBlock) return
  s.currentToolInput += partialJson

  // Update activity indicator with file path or tool details
  let toolName = s._currentToolName || ''
  try {
    const parsed = JSON.parse(s.currentToolInput)
    const detail = parsed.file_path || parsed.path || parsed.command || parsed.pattern || parsed.query || ''
    if (detail) {
      const short = detail.split('/').pop() || detail.slice(0, 40)
      updateActivityIndicator(id, `${toolName}: ${short}`, sessionsObj)
    }
  } catch {}

  // Question tool — render markdown in question block
  if (s._questionBlockEl) {
    try {
      const parsed = JSON.parse(s.currentToolInput)
      const question = parsed.question || parsed.text || parsed.message || JSON.stringify(parsed, null, 2)
      const headerEl = s._questionBlockEl.querySelector('.question-header')
      if (headerEl) {
        headerEl.innerHTML = DOMPurify.sanitize(marked.parse(question), SANITIZE_CONFIG)
        headerEl.classList.add('md-body')
      }
      scrollChatToBottom(id, 120)
    } catch {}
    return
  }

  // Ops item — update the item label and detail
  const detailEl = s._currentToolBlock.querySelector('.chat-ops-item-detail')
  const labelEl = s._currentToolBlock.querySelector('.chat-ops-item-label')
  if (!detailEl) return

  try {
    const parsed = JSON.parse(s.currentToolInput)

    // Update item label with short description
    let shortLabel = toolName
    const filePath = parsed.file_path || parsed.path || ''
    if (filePath) {
      const parts = filePath.split('/')
      shortLabel = toolName + ': ' + (parts.length > 3 ? '.../' + parts.slice(-3).join('/') : filePath)
    } else if (parsed.command) {
      shortLabel = toolName + ': ' + (parsed.command.length > 50 ? parsed.command.slice(0, 50) + '...' : parsed.command)
    } else if (parsed.pattern) {
      shortLabel = toolName + ': ' + parsed.pattern
    } else if (parsed.query) {
      shortLabel = toolName + ': ' + parsed.query.slice(0, 40)
    }
    if (labelEl) labelEl.textContent = shortLabel

    // Render detail content (visible when item is expanded)
    if (parsed.old_string != null && parsed.new_string != null) {
      // Edit tool — diff view
      const file = parsed.file_path ? `<div class="tool-item" style="font-weight:500">${escapeHtml(parsed.file_path.split('/').slice(-3).join('/'))}</div>` : ''
      detailEl.innerHTML = `${file}<pre class="tool-diff"><span class="diff-remove">${escapeHtml(parsed.old_string)}</span><span class="diff-add">${escapeHtml(parsed.new_string)}</span></pre>`
    } else if (parsed.command) {
      // Bash tool — command
      detailEl.innerHTML = `<pre>${escapeHtml(parsed.command)}</pre>`
    } else if (parsed.content != null) {
      // Write tool — file path + content preview
      const file = parsed.file_path ? `<div class="tool-item" style="font-weight:500">${escapeHtml(parsed.file_path.split('/').slice(-3).join('/'))}</div>` : ''
      const preview = parsed.content.length > 500 ? parsed.content.slice(0, 500) + '...' : parsed.content
      detailEl.innerHTML = `${file}<pre>${escapeHtml(preview)}</pre>`
      // Memory surfacing — if this Write lands in memory/*.md, render an
      // ambient card once the content has a valid frontmatter block.
      if (isMemoryWritePath(parsed.file_path) && !s._currentToolBlock.dataset.memoryRendered) {
        const contentEl = s._currentAssistantEl && s._currentAssistantEl.querySelector('.chat-msg-content')
        if (contentEl && /^---[\s\S]*?\n---/.test(parsed.content)) {
          renderMemoryCard(contentEl, parsed)
          s._currentToolBlock.dataset.memoryRendered = '1'
        }
      }
    } else {
      // Generic — show key info
      const label = parsed.file_path || parsed.path || parsed.pattern || parsed.query || JSON.stringify(parsed, null, 2).slice(0, 200)
      detailEl.innerHTML = `<pre>${escapeHtml(label)}</pre>`
    }
  } catch {
    detailEl.innerHTML = `<pre>${escapeHtml(s.currentToolInput.slice(0, 200))}</pre>`
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
          if (s._opsContainer || s._hadToolBlocks) {
            s._opsContainer = null
            s._opsCount = 0
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
          renderPermissionApprovalCard(id, claudeEdits, sessionsObj)
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

  const pane = document.createElement('div')
  pane.className = 'term-pane'; pane.id = 'pane-' + id
  pane.innerHTML = `
    <div class="term-hdr">
      <div class="term-hdr-dot" style="background:var(--green);box-shadow:0 0 7px rgba(109,184,143,0.5)"></div>
      <div class="term-hdr-label" id="hdr-label-${id}">ACE Session</div>
      <button class="mode-toggle-btn" id="mode-toggle-${id}">Terminal</button>
      <div class="term-hdr-path" id="hdr-path-${id}">Chat Mode</div>
      <span class="session-timer" id="session-timer-${id}" style="display:none"></span>
      <select class="session-duration-select" id="session-duration-${id}" title="Set session timer" data-learn-target="session-timer">
        <option value="">Timer</option>
        <option value="15">15m</option>
        <option value="30">30m</option>
        <option value="60">60m</option>
        <option value="90">90m</option>
      </select>
    </div>
    <div class="chat-view" id="chat-view-${id}">
      <div class="chat-messages" id="chat-msgs-${id}">
        <div class="chat-welcome">
          <div class="chat-welcome-icon">${aceMarkSvg(36)}</div>
          <div class="chat-welcome-text">ACE Chat</div>
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
      <div class="chat-input-area">
        <textarea class="chat-input" id="chat-input-${id}" data-learn-target="chat-composer" placeholder="${window.__preflightResult?.binary?.ok && window.__preflightResult?.vault?.ok ? 'Type /start to begin your day' : 'Message ACE...'}" rows="1"></textarea>
        <button class="chat-send-btn" id="chat-send-${id}" data-learn-target="send-button">↑</button>
      </div>
    </div>
    <div class="term-xterm" id="xterm-${id}" style="display:none"></div>
    <button class="scroll-to-bottom" id="scroll-btn-${id}" title="Scroll to bottom" style="display:none">↓</button>`
  const targetContainer = opts?.container || document.getElementById('pane-content-left')
  targetContainer.appendChild(pane)

  const tab = document.createElement('div')
  tab.className = 'stab'; tab.id = 'tab-' + id
  const moveArrow = targetContainer.id === 'pane-content-right' ? '←' : '→'
  tab.innerHTML = `<div class="stab-dot"></div><span class="stab-label" id="tab-label-${id}">ACE</span><span class="stab-move" id="stab-move-${id}" title="Move to other pane">${moveArrow}</span><span class="stab-close" id="stab-close-${id}" title="Close session">×</span>`
  tab.addEventListener('click', (e) => { if (!e.target.classList.contains('stab-close') && !e.target.classList.contains('stab-move')) activateSession(id) })
  const targetTabBar = opts?.tabBar || document.getElementById('session-tabs-left')
  const addBtn = targetTabBar.querySelector('.stab-add')
  targetTabBar.insertBefore(tab, addBtn)

  state.sessions[id] = {
    term: null, fitAddon: null, pane, tab,
    mode: 'chat',
    name: 'ACE',
    claudeSessionId: null,
    resumeId: resumeId,
    resumeCwd: resumeCwd,
    messages: [],
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

  // Chat input handling
  const inputEl = document.getElementById('chat-input-' + id)
  const sendBtn = document.getElementById('chat-send-' + id)

  attachSlashMenu(inputEl, { send: (prompt) => sendChatMessage(id, prompt) })

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
      if (e.__slashMenuHandled) return
      window.ace.chat.cancel(id)
    }
  })
  // Reset placeholder after first message
  inputEl.addEventListener('input', function resetPlaceholder() {
    if (inputEl.placeholder !== 'Message ACE...') {
      inputEl.placeholder = 'Message ACE...'
      inputEl.removeEventListener('input', resetPlaceholder)
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
}
