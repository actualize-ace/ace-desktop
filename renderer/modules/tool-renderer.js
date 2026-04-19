// renderer/modules/tool-renderer.js
import { state } from '../state.js'
import { setAttention } from './attention.js'
import { escapeHtml, SANITIZE_CONFIG } from './chat-renderer.js'

// Local scroll helper — mirrors session-manager.scrollChatToBottom. Kept private
// to avoid a circular import between session-manager and tool-renderer.
function scrollChatToBottom(id, threshold) {
  if (state._autoScroll === false) return
  const msgsEl = document.getElementById('chat-msgs-' + id)
  if (!msgsEl) return
  const dist = msgsEl.scrollHeight - msgsEl.scrollTop - msgsEl.clientHeight
  if (dist < (threshold || 120)) msgsEl.scrollTop = msgsEl.scrollHeight
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
export function appendToolBlock(s, id, toolInfo) {
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
    // Detect which sessionsObj owns this session so setAttention writes flags
    // to the correct session map (chat vs. agent).
    const sessionsObj = state.sessions[id] === s ? state.sessions : state.agentSessions
    setAttention(id, sessionsObj, 'question')
    s._currentToolBlock = block
    s.currentToolInput = ''
    updateActivityIndicator(s, id, toolName)
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

  updateActivityIndicator(s, id, toolName)
  scrollChatToBottom(id, 120)
}

export function appendToolInput(s, id, partialJson) {
  if (!s || !s._currentToolBlock) return
  s.currentToolInput += partialJson

  // Update activity indicator with file path or tool details
  let toolName = s._currentToolName || ''
  try {
    const parsed = JSON.parse(s.currentToolInput)
    const detail = parsed.file_path || parsed.path || parsed.command || parsed.pattern || parsed.query || ''
    if (detail) {
      const short = detail.split('/').pop() || detail.slice(0, 40)
      updateActivityIndicator(s, id, `${toolName}: ${short}`)
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
export function updateActivityIndicator(s, id, text) {
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

export function clearActivityIndicator(s) {
  if (!s || !s._currentAssistantEl) return
  const indicator = s._currentAssistantEl.querySelector('.chat-activity')
  if (indicator) indicator.remove()
}

// Render an interactive question card from AskUserQuestion tool input
export function renderQuestionCard(id, data, containerEl) {
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
