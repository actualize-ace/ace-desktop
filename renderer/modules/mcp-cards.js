// renderer/modules/mcp-cards.js
import { state } from '../state.js'
import { sendChatMessage } from './session-manager.js'

// Escape user-controlled strings before inserting into innerHTML.
function mcpEsc(s) {
  return (s || '').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;')
}

async function resetMcpAuth(evt) {
  // Resolve server name → URL via MCP_RESOLVE_SERVER IPC.
  // Reads both ~/.claude.json (user-scope) and <vaultPath>/.mcp.json (project-scope).
  // Do NOT use window.ace.claudeSettings.read() — that reads ~/.claude/settings.json
  // which has NO mcpServers (confirmed by direct inspection).
  try {
    const name = evt.server || evt.serverName
    if (!name) { console.warn('[mcp] resetAuth: no server name in event', evt); return }

    const config = await window.ace.setup.getConfig()
    const vaultPath = config?.vaultPath || null

    const resolved = await window.ace.mcp.resolveServer(name, vaultPath)
    if (!resolved?.ok) {
      console.warn('[mcp] resetAuth: could not resolve server URL for', name, resolved?.error)
      return
    }
    const result = await window.ace.mcp.resetAuth({
      serverUrl:  resolved.serverUrl,
      resource:   resolved.resource,
      headers:    resolved.headers,
      serverName: name,
    })
    console.log('[mcp] resetAuth result:', result)
  } catch (err) {
    console.error('[mcp] resetAuth failed:', err)
  }
}

export function renderMcpEventCard(msgsEl, chatId, evt) {
  const { subtype, authUrl, server, servers, serverKind, detail } = evt

  if (subtype === 'mcp_disconnect') {
    const toast = document.createElement('div')
    toast.className = 'chat-error'
    toast.style.cssText = 'opacity:0.7;font-size:12px'
    toast.textContent = `Lost MCP server${(servers?.length || 0) > 1 ? 's' : ''}: ${(servers || []).join(', ')}`
    msgsEl.appendChild(toast)
    setTimeout(() => toast.remove(), 5000)
    return
  }

  if (subtype === 'auth_pending') {
    const inline = document.createElement('div')
    inline.className = 'chat-error'
    inline.style.cssText = 'opacity:0.7;font-size:12px'
    inline.textContent = 'MCP authentication in progress…'
    msgsEl.appendChild(inline)
    return
  }

  const variants = {
    auth_url_ready: {
      title: server ? `Authorize ${mcpEsc(server)}` : 'Authorize MCP server',
      body: 'An MCP server needs OAuth authorization. Click below to complete it in your browser.',
      primary: { label: 'Authorize in Browser', handler: async () => {
        const result = await window.ace.mcp.openAuthUrl(authUrl)
        if (!result?.ok) console.error('[mcp] openExternal failed:', result?.error)
      }},
    },
    auth_terminal_fail: {
      title: server ? `${mcpEsc(server)} needs re-authentication` : 'MCP re-authentication needed',
      body: 'Auto-refresh failed. Reset credentials to trigger a fresh browser OAuth flow.',
      primary: { label: 'Reset & Re-auth', handler: () => resetMcpAuth(evt) },
    },
    cli_auth_expired: {
      title: `${mcpEsc(server) || 'MCP server'} tokens expired`,
      body: 'OAuth tokens have expired and automatic refresh failed.',
      primary: { label: 'Reset & Re-auth', handler: () => resetMcpAuth(evt) },
    },
    cli_auth_required: {
      title: `${mcpEsc(serverKind) || 'MCP'} server needs authentication`,
      body: 'This server has never been authenticated in this session.',
      primary: { label: 'Reset & Re-auth', handler: () => resetMcpAuth(evt) },
    },
    mcp_remote_crash: {
      title: 'MCP server crashed',
      body: 'The MCP subprocess exited unexpectedly. Retry your message or restart the server.',
      primary: { label: 'Dismiss', handler: (card) => card.remove() },
    },
    cli_connect_failed: {
      title: `Can't reach ${mcpEsc(server) || 'MCP server'}`,
      body: "The server is configured but couldn't be reached. Check network or server status.",
      primary: { label: 'Dismiss', handler: (card) => card.remove() },
    },
    cli_not_connected: {
      title: `${mcpEsc(server) || 'MCP server'} not connected`,
      body: 'The server is offline or not responding.',
      primary: { label: 'Dismiss', handler: (card) => card.remove() },
    },
  }

  const variant = variants[subtype]
  if (!variant) {
    const errEl = document.createElement('div')
    errEl.className = 'chat-error'
    errEl.textContent = `MCP event (${subtype}): ${detail || server || ''}`
    msgsEl.appendChild(errEl)
    return
  }

  const detailBlock = detail
    ? `<div style="margin-bottom:10px;opacity:0.55;font-size:11px;white-space:pre-wrap;max-height:60px;overflow:auto">${mcpEsc(detail)}</div>`
    : ''
  const card = document.createElement('div')
  card.className = 'chat-error binary-missing-card'
  card.innerHTML = `
    <div style="margin-bottom:6px"><strong>${variant.title}</strong></div>
    <div style="margin-bottom:8px">${variant.body}</div>
    ${detailBlock}
    <div style="display:flex;gap:8px">
      <button class="preflight-btn mcp-primary-btn">${variant.primary.label}</button>
      <button class="preflight-btn" data-dismiss>Dismiss</button>
    </div>`
  card.querySelector('.mcp-primary-btn').addEventListener('click', () => variant.primary.handler(card))
  card.querySelector('[data-dismiss]').addEventListener('click', () => card.remove())
  msgsEl.appendChild(card)
}

// Render approval card for .claude/ permission denials
export function renderPermissionApprovalCard(s, chatId, denials) {
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
    const paths = unique.map(d => d.tool_input.file_path.replace(/^.*\/\.claude\//, '.claude/')).join(', ')
    if (msgsEl) {
      const confirm = document.createElement('div')
      confirm.className = 'chat-msg assistant'
      confirm.innerHTML = `<div class="msg-content md-body">${allOk
        ? `<strong>Done.</strong> Edited ${paths} directly (bypassed CLI permission).`
        : `<strong>Partial.</strong> Some edits to ${paths} may not have applied — check the files. Send a follow-up to continue.`
      }</div>`
      msgsEl.appendChild(confirm)
      msgsEl.scrollTop = msgsEl.scrollHeight
    }

    // Auto-continue: -p mode CLI exited when it emitted the denial, so the
    // session's view of the turn is "tool failed". Without this nudge, the
    // next --resume would likely retry the same edit and re-trigger the
    // approval card (loop). Skip on partial failure — user needs to inspect.
    if (allOk) {
      try {
        const sessionsObj = state.sessions[chatId] === s ? state.sessions : state.agentSessions
        const continuation = `[approved and applied via desktop bypass: ${paths}. don't retry the edit — continue from where you left off.]`
        sendChatMessage(chatId, continuation, sessionsObj)
      } catch (err) {
        console.warn('[permission-card] auto-continue failed:', err)
      }
    }
  })

  card.querySelector('.permission-deny').addEventListener('click', () => card.remove())
}

export function renderMcpPermissionCard(s, chatId, denials) {
  const msgsEl = document.getElementById('chat-msgs-' + chatId)
  if (!msgsEl) return

  // Dedupe by tool_name + stringified tool_input
  const seen = new Set()
  const unique = denials.filter(d => {
    const key = d.tool_name + '|' + JSON.stringify(d.tool_input || {})
    if (seen.has(key)) return false
    seen.add(key)
    return true
  })
  if (!unique.length) return

  const esc = str => String(str ?? '')
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')

  // tool_name format: mcp__<server>__<tool>
  const parseToolName = name => {
    const m = /^mcp__([^_][^_]*(?:_[^_]+)*)__(.+)$/.exec(name)
    return m ? { server: m[1], tool: m[2] } : { server: 'unknown', tool: name }
  }

  const card = document.createElement('div')
  card.className = 'chat-permission-card mcp-permission-card'

  let html = `<div class="permission-card-header">MCP tool needs approval</div>`
  unique.forEach((d, i) => {
    const { server, tool } = parseToolName(d.tool_name)
    const inputPreview = JSON.stringify(d.tool_input || {}, null, 0).slice(0, 140)
    html += `
      <div class="permission-edit-item" data-idx="${i}">
        <div class="permission-file-path"><strong>${esc(server)}</strong> · ${esc(tool)}</div>
        <div class="permission-diff" style="font-family:monospace;font-size:11px;opacity:0.7">
          ${esc(inputPreview)}
        </div>
        <div class="chat-tool-actions" style="margin-top:6px">
          <button class="chat-approve-btn mcp-allow-server" data-server="${esc(server)}">Allow all ${esc(server)} tools</button>
          <button class="chat-approve-btn mcp-allow-tool" data-pattern="${esc(d.tool_name)}">Just this one</button>
        </div>
      </div>`
  })
  html += `
    <div class="chat-tool-actions">
      <button class="chat-deny-btn mcp-dismiss">Dismiss</button>
    </div>`

  card.innerHTML = html
  msgsEl.appendChild(card)
  msgsEl.scrollTop = msgsEl.scrollHeight

  const session = s

  async function applyPattern(pattern, btn) {
    btn.disabled = true
    btn.textContent = 'Saving…'
    const config = await window.ace.setup.getConfig()
    const vaultPath = config?.vaultPath || null
    const res = await window.ace.permissions.addAllow(vaultPath, pattern)
    if (!res?.ok) {
      btn.textContent = 'Failed — check console'
      console.error('[mcp] addAllow failed:', res)
      return
    }

    const lastPrompt = session?.lastPrompt
    const confirm = document.createElement('div')
    confirm.className = 'chat-msg assistant'
    confirm.innerHTML = `
      <div class="msg-content md-body">
        <strong>Added</strong> <code>${esc(pattern)}</code> to allow list
        ${res.alreadyPresent ? ' (was already present)' : ''}.
        ${lastPrompt
          ? `<div style="margin-top:8px"><button class="preflight-btn mcp-retry-btn">Retry last message</button></div>`
          : '<div style="margin-top:8px;opacity:0.7">Re-send your message to try again.</div>'}
      </div>`
    msgsEl.appendChild(confirm)
    msgsEl.scrollTop = msgsEl.scrollHeight
    card.remove()

    const retryBtn = confirm.querySelector('.mcp-retry-btn')
    if (retryBtn) {
      retryBtn.addEventListener('click', () => {
        retryBtn.disabled = true
        retryBtn.textContent = 'Sending…'
        // Detect whether session lives in state.sessions or state.agentSessions so
        // sendChatMessage resolves it in the correct session map.
        const sessionsObj = state.sessions[chatId] === s ? state.sessions : state.agentSessions
        sendChatMessage(chatId, session.lastPrompt, sessionsObj)
      })
    }
  }

  card.querySelectorAll('.mcp-allow-server').forEach(btn => {
    btn.addEventListener('click', () =>
      applyPattern(`mcp__${btn.dataset.server}__*`, btn))
  })
  card.querySelectorAll('.mcp-allow-tool').forEach(btn => {
    btn.addEventListener('click', () =>
      applyPattern(btn.dataset.pattern, btn))
  })
  card.querySelector('.mcp-dismiss').addEventListener('click', () => card.remove())
}
