// renderer/views/history.js
import { state } from '../state.js'
import { escapeHtml, processWikilinks, postProcessCodeBlocks, SANITIZE_CONFIG } from '../modules/chat-renderer.js'

export function formatHistoryTokens(n) {
  if (n >= 1000000) return (n / 1000000).toFixed(1) + 'M tok'
  if (n >= 1000) return (n / 1000).toFixed(1) + 'k tok'
  return n + ' tok'
}

export function formatHistoryDuration(ms) {
  const mins = Math.floor(ms / 60000)
  if (mins < 60) return mins + 'm'
  return Math.floor(mins / 60) + 'h ' + (mins % 60) + 'm'
}

// escapeHistoryHtml removed — use escapeHtml from chat-renderer.js

export async function initHistory() {
  if (state.historyInitialized) return
  state.historyInitialized = true

  const listEl = document.getElementById('history-list')
  listEl.innerHTML = '<div class="vault-empty">Scanning sessions...</div>'

  // Derive current project from vault path
  const cfg = await window.ace.setup.getConfig()
  const vaultPath = cfg?.vaultPath || ''
  const defaultProject = '-' + vaultPath.replace(/\//g, '-').replace(/^-/, '')

  const data = await window.ace.history.list(null, 0, 50)
  if (data.error) {
    listEl.innerHTML = '<div class="vault-empty">' + escapeHtml(data.error) + '</div>'
    return
  }

  state.historySessionsList = data.sessions
  state.historyProjects = data.projects
  state.historyTotal = data.total
  state.historyOffset = 50

  // Populate project dropdown
  const select = document.getElementById('history-project-select')
  select.innerHTML = '<option value="">All Projects (' + data.total + ')</option>' +
    data.projects.map(p => {
      const label = p.replace(/-/g, '/').replace(/^\//, '').split('/').slice(-2).join('/')
      const selected = p === defaultProject ? ' selected' : ''
      return '<option value="' + escapeHtml(p) + '"' + selected + '>' + escapeHtml(label) + '</option>'
    }).join('')

  // Auto-filter to current vault's project
  if (data.projects.includes(defaultProject)) {
    select.value = defaultProject
    state.historyActiveProject = defaultProject
    const filtered = await window.ace.history.list(defaultProject, 0, 50)
    if (!filtered.error) {
      state.historySessionsList = filtered.sessions
      state.historyTotal = filtered.total
      state.historyOffset = 50
    }
  }

  renderHistoryList()

  // Event listeners
  select.addEventListener('change', async () => {
    const project = select.value || null
    state.historyActiveProject = project
    state.historyOffset = 0
    const d = await window.ace.history.list(project, 0, 50)
    if (d.error) return
    state.historySessionsList = d.sessions
    state.historyTotal = d.total
    state.historyOffset = 50
    renderHistoryList()
    document.getElementById('history-detail').innerHTML = '<div class="vault-empty">Select a session</div>'
  })

  let searchTimer
  document.getElementById('history-search').addEventListener('input', () => {
    clearTimeout(searchTimer)
    searchTimer = setTimeout(async () => {
      const query = document.getElementById('history-search').value.trim()
      if (!query) {
        const d = await window.ace.history.list(state.historyActiveProject, 0, 50)
        if (!d.error) {
          state.historySessionsList = d.sessions
          state.historyTotal = d.total
          state.historyOffset = 50
          renderHistoryList()
        }
        return
      }
      const results = await window.ace.history.search(query, state.historyActiveProject)
      if (!results.error) {
        state.historySessionsList = Array.isArray(results) ? results : results.sessions || []
        state.historyTotal = state.historySessionsList.length
        state.historyOffset = state.historyTotal
        renderHistoryList()
      }
    }, 300)
  })
}

export function renderHistoryList() {
  const listEl = document.getElementById('history-list')
  if (!state.historySessionsList.length) {
    listEl.innerHTML = '<div class="vault-empty">No sessions found</div>'
    return
  }

  const todayStart = new Date().setHours(0,0,0,0)
  const yesterdayStart = todayStart - 86400000
  const weekStart = todayStart - 6 * 86400000

  let html = ''
  let currentGroup = ''

  for (const s of state.historySessionsList) {
    let group
    if (s.mtime >= todayStart) group = 'Today'
    else if (s.mtime >= yesterdayStart) group = 'Yesterday'
    else if (s.mtime >= weekStart) group = 'This Week'
    else group = new Date(s.mtime).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })

    if (group !== currentGroup) {
      currentGroup = group
      html += '<div class="history-date-group">' + escapeHtml(group) + '</div>'
    }

    const time = new Date(s.mtime).toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' })
    const title = s.title || s.slug || 'Untitled session'
    const modelTag = s.model ? '<span class="history-item-tag">' + escapeHtml(s.model.replace('claude-', '')) + '</span>' : ''
    const branchTag = s.gitBranch ? '<span class="history-item-tag">' + escapeHtml(s.gitBranch) + '</span>' : ''
    const tokens = s.tokenCount ? formatHistoryTokens(s.tokenCount) : ''

    html += '<div class="history-item" data-project="' + escapeHtml(s.project) + '" data-id="' + escapeHtml(s.id) + '">' +
      '<div class="history-item-title">' + escapeHtml(title) + '</div>' +
      '<div class="history-item-meta">' +
        '<span>' + time + '</span>' +
        modelTag + branchTag +
        (tokens ? '<span>' + tokens + '</span>' : '') +
      '</div>' +
    '</div>'
  }

  if (state.historyOffset < state.historyTotal) {
    html += '<div class="history-load-more" id="history-load-more">Load more (' + (state.historyTotal - state.historyOffset) + ' remaining)</div>'
  }

  listEl.innerHTML = html

  // Click handlers
  listEl.querySelectorAll('.history-item').forEach(item => {
    item.addEventListener('click', () => {
      listEl.querySelectorAll('.history-item').forEach(el => el.classList.remove('active'))
      item.classList.add('active')
      openSessionDetail(item.dataset.project, item.dataset.id)
    })
  })

  const loadMoreEl = document.getElementById('history-load-more')
  if (loadMoreEl) {
    loadMoreEl.addEventListener('click', async () => {
      const d = await window.ace.history.list(state.historyActiveProject, state.historyOffset, 50)
      if (d.error) return
      state.historySessionsList = state.historySessionsList.concat(d.sessions)
      state.historyOffset += 50
      renderHistoryList()
    })
  }
}

export async function openSessionDetail(project, sessionId) {
  const detailEl = document.getElementById('history-detail')
  detailEl.innerHTML = '<div class="vault-empty">Loading transcript...</div>'

  const data = await window.ace.history.read(project, sessionId)
  if (data.error) {
    detailEl.innerHTML = '<div class="vault-empty">' + escapeHtml(data.error) + '</div>'
    return
  }

  const meta = data.meta || {}
  const firstMsg = data.messages.find(m => m.role === 'user')
  const title = firstMsg ? firstMsg.content.slice(0, 120) : meta.slug || 'Untitled'
  const duration = meta.duration ? formatHistoryDuration(meta.duration) : ''

  let headerHtml = '<div class="history-detail-header">' +
    '<div style="display:flex;align-items:center;justify-content:space-between;gap:12px">' +
      '<div class="history-detail-title">' + escapeHtml(title) + '</div>' +
      '<button class="history-resume-btn" id="history-resume-btn" data-session-id="' + escapeHtml(sessionId) + '" data-project="' + escapeHtml(project) + '">&#9654; Resume</button>' +
    '</div>' +
    '<div class="history-detail-meta">' +
      (meta.model ? '<span>Model: ' + escapeHtml(meta.model.replace('claude-', '')) + '</span>' : '') +
      (meta.slug ? '<span>Slug: ' + escapeHtml(meta.slug) + '</span>' : '') +
      (meta.gitBranch ? '<span>Branch: ' + escapeHtml(meta.gitBranch) + '</span>' : '') +
      (meta.tokens ? '<span>Tokens: ' + formatHistoryTokens(meta.tokens.input + meta.tokens.output) + '</span>' : '') +
      (duration ? '<span>Duration: ' + duration + '</span>' : '') +
      '<span>' + data.messages.length + ' messages</span>' +
    '</div>' +
  '</div>'

  let transcriptHtml = '<div class="history-transcript">'
  for (const msg of data.messages) {
    const roleClass = msg.role === 'user' ? 'history-msg-user' : 'history-msg-assistant'
    const label = msg.role === 'user' ? 'YOU' : 'ASSISTANT'
    const time = msg.timestamp ? new Date(msg.timestamp).toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit', second: '2-digit' }) : ''

    let contentHtml
    if (msg.role === 'user') {
      contentHtml = '<div class="history-msg-content">' + escapeHtml(msg.content) + '</div>'
    } else {
      // Render markdown for assistant messages
      const raw = typeof marked !== 'undefined' && marked.parse ? marked.parse(msg.content || '') : escapeHtml(msg.content || '')
      const safe = typeof DOMPurify !== 'undefined' ? DOMPurify.sanitize(raw) : raw
      contentHtml = '<div class="history-msg-content">' + safe + '</div>'
    }

    // Tool calls (collapsed by default)
    let toolsHtml = ''
    if (msg.toolCalls && msg.toolCalls.length > 0) {
      toolsHtml = msg.toolCalls.map(tc => {
        return '<div class="history-tool-summary collapsed">' +
          '<div class="history-tool-header">' +
            '<span style="font-size:10px">&#9889;</span>' +
            '<span>' + escapeHtml(tc.name) + '</span>' +
            '<span style="margin-left:auto;font-size:7px">&#x25B8;</span>' +
          '</div>' +
          '<div class="history-tool-detail"><pre>' + escapeHtml(tc.input) + '</pre></div>' +
        '</div>'
      }).join('')
    }

    transcriptHtml += '<div class="history-msg ' + roleClass + '">' +
      '<div class="history-msg-label">' + label + (time ? ' <span style="opacity:0.5;margin-left:8px">' + time + '</span>' : '') + '</div>' +
      contentHtml +
      toolsHtml +
    '</div>'
  }
  transcriptHtml += '</div>'

  detailEl.innerHTML = headerHtml + transcriptHtml
  detailEl.scrollTop = 0

  // Wire tool call toggle
  detailEl.querySelectorAll('.history-tool-header').forEach(header => {
    header.addEventListener('click', () => header.parentElement.classList.toggle('collapsed'))
  })

  // Wire resume button
  const resumeBtn = document.getElementById('history-resume-btn')
  if (resumeBtn) {
    resumeBtn.addEventListener('click', () => {
      const sid = resumeBtn.dataset.sessionId
      const project = resumeBtn.dataset.project
      const projectDir = project.replace(/-/g, '/')
      document.querySelector('.nav-item[data-view="terminal"]').click()
      setTimeout(() => spawnSession({ resumeId: sid, resumeCwd: projectDir, resumeProject: project }), 150)
    })
  }
}

// Re-export spawnSession dependency for openSessionDetail
// The caller must ensure spawnSession is available on window or passed in
function spawnSession(opts) {
  if (typeof window.spawnSession === 'function') {
    window.spawnSession(opts)
  }
}
