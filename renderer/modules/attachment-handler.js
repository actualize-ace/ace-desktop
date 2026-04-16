// renderer/modules/attachment-handler.js
// Shared attachment pipeline: stage, render chips, inject at send time.

const ALLOWED_EXTS = new Set([
  'png', 'jpg', 'jpeg', 'gif', 'webp', 'pdf', 'txt', 'md'
])

const TYPE_ICONS = {
  png: '🖼', jpg: '🖼', jpeg: '🖼', gif: '🖼', webp: '🖼',
  pdf: '📄',
  txt: '📝', md: '📝',
}

const WARN_SIZE = 5 * 1024 * 1024  // 5 MB

function formatSize(bytes) {
  if (bytes < 1024) return bytes + ' B'
  if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(1) + ' KB'
  return (bytes / (1024 * 1024)).toFixed(1) + ' MB'
}

function extFromName(name) {
  return (name.split('.').pop() || '').toLowerCase()
}

// ─── Staging ─────────────────────────────────────────────────────────────────

export async function stageFromPaths(session, chatId, filePaths) {
  for (const filePath of filePaths) {
    const name = filePath.split(/[\\/]/).pop()
    const ext = extFromName(name)
    if (!ALLOWED_EXTS.has(ext)) {
      showToast(chatId, `Unsupported file type: .${ext}`)
      continue
    }
    const result = await window.ace.attachments.save({ sourcePath: filePath, name })
    if (result.error) {
      showToast(chatId, result.error === 'too-large'
        ? `File too large (${formatSize(result.size)}, max 25 MB)`
        : `Cannot attach .${result.ext} files`)
      continue
    }
    session.pendingAttachments.push(result)
    renderChipTray(session, chatId)
  }
}

export async function stageFromBuffer(session, chatId, buffer, fileName) {
  const ext = extFromName(fileName)
  if (!ALLOWED_EXTS.has(ext)) {
    showToast(chatId, `Unsupported file type: .${ext}`)
    return
  }
  const result = await window.ace.attachments.save({
    buffer: Array.from(new Uint8Array(buffer)),
    name: fileName,
  })
  if (result.error) {
    showToast(chatId, result.error === 'too-large'
      ? `File too large (${formatSize(result.size)}, max 25 MB)`
      : `Cannot attach .${result.ext} files`)
    return
  }
  session.pendingAttachments.push(result)
  renderChipTray(session, chatId)
}

// ─── Pick (native dialog) ────────────────────────────────────────────────────

export async function pickAndStage(session, chatId) {
  const files = await window.ace.attachments.pickFile()
  if (!files || !files.length) return
  await stageFromPaths(session, chatId, files.map(f => f.sourcePath))
}

// ─── Chip Tray Rendering ─────────────────────────────────────────────────────

export function renderChipTray(session, chatId) {
  const tray = document.getElementById('chat-attachments-' + chatId)
  if (!tray) return
  tray.innerHTML = ''
  for (let i = 0; i < session.pendingAttachments.length; i++) {
    const att = session.pendingAttachments[i]
    const ext = extFromName(att.name)
    const icon = TYPE_ICONS[ext] || '📎'
    const warn = att.size > WARN_SIZE ? ' warn' : ''

    const chip = document.createElement('div')
    chip.className = 'attach-chip' + warn
    chip.innerHTML = `
      <span class="attach-chip-icon">${icon}</span>
      <span class="attach-chip-name" title="${att.name}">${att.name.length > 24 ? att.name.slice(0, 22) + '…' : att.name}</span>
      <span class="attach-chip-size">${formatSize(att.size)}</span>
      <button class="attach-chip-remove" aria-label="Remove attachment" data-idx="${i}">×</button>
    `
    chip.querySelector('.attach-chip-remove').addEventListener('click', () => {
      session.pendingAttachments.splice(i, 1)
      renderChipTray(session, chatId)
    })
    tray.appendChild(chip)
  }
}

// ─── Prompt Injection ────────────────────────────────────────────────────────

export function injectAttachments(session, prompt) {
  if (!session.pendingAttachments || session.pendingAttachments.length === 0) {
    return prompt
  }
  const refs = session.pendingAttachments.map(a => '@' + a.relPath).join('\n')
  return refs + '\n\n' + prompt
}

export function consumeAttachments(session) {
  const list = session.pendingAttachments.slice()
  session.pendingAttachments = []
  return list
}

// ─── Message Bubble Chips ────────────────────────────────────────────────────

export function renderMsgAttachments(attachments) {
  if (!attachments || attachments.length === 0) return ''
  const chips = attachments.map(att => {
    const ext = extFromName(att.name)
    const icon = TYPE_ICONS[ext] || '📎'
    return `<span class="msg-attach-chip" data-path="${att.absPath || ''}" title="${att.name}">${icon} ${att.name.length > 20 ? att.name.slice(0, 18) + '…' : att.name}</span>`
  }).join('')
  return `<div class="msg-attachments">${chips}</div>`
}

// Wire click-to-open on message attachment chips (call once per bubble)
export function wireMsgAttachmentClicks(containerEl) {
  containerEl.querySelectorAll('.msg-attach-chip[data-path]').forEach(chip => {
    chip.addEventListener('click', async () => {
      const p = chip.dataset.path
      if (!p) return
      try {
        await window.ace.attachments.openFile(p)
      } catch {
        chip.classList.add('missing')
        chip.title = 'File no longer available'
      }
    })
  })
}

// ─── Drop Zone ───────────────────────────────────────────────────────────────

export function wireDropZone(session, chatId) {
  const inputArea = document.querySelector(`#pane-${chatId} .chat-input-area`)
  if (!inputArea) return

  let dragCounter = 0

  inputArea.addEventListener('dragenter', e => {
    e.preventDefault()
    dragCounter++
    if (dragCounter === 1) showDropOverlay(inputArea)
  })
  inputArea.addEventListener('dragover', e => {
    e.preventDefault()
    e.dataTransfer.dropEffect = 'copy'
  })
  inputArea.addEventListener('dragleave', () => {
    dragCounter--
    if (dragCounter <= 0) { dragCounter = 0; hideDropOverlay(inputArea) }
  })
  inputArea.addEventListener('drop', e => {
    e.preventDefault()
    dragCounter = 0
    hideDropOverlay(inputArea)
    const files = Array.from(e.dataTransfer.files)
    for (const file of files) {
      if (file.path) {
        // Electron File objects from Finder have a .path property
        stageFromPaths(session, chatId, [file.path])
      } else {
        // Fallback: read as buffer (drag from Preview, browser, etc.)
        const reader = new FileReader()
        reader.onload = () => {
          const ext = extFromName(file.name || 'dropped-file')
          const name = file.name || `dropped-${Date.now()}.${ext || 'bin'}`
          stageFromBuffer(session, chatId, reader.result, name)
        }
        reader.readAsArrayBuffer(file)
      }
    }
  })
}

function showDropOverlay(inputArea) {
  if (inputArea.querySelector('.chat-drop-overlay')) return
  const overlay = document.createElement('div')
  overlay.className = 'chat-drop-overlay'
  overlay.textContent = 'Drop to attach'
  inputArea.appendChild(overlay)
}

function hideDropOverlay(inputArea) {
  const overlay = inputArea.querySelector('.chat-drop-overlay')
  if (overlay) overlay.remove()
}

// ─── Paste Handler ───────────────────────────────────────────────────────────

export function wirePasteHandler(session, chatId) {
  const textarea = document.getElementById('chat-input-' + chatId)
  if (!textarea) return

  textarea.addEventListener('paste', e => {
    const files = e.clipboardData?.files
    if (!files || files.length === 0) return  // normal text paste — fall through

    e.preventDefault()
    for (const file of files) {
      // Clipboard images usually don't have a .path — use buffer route
      if (file.path) {
        stageFromPaths(session, chatId, [file.path])
      } else {
        const reader = new FileReader()
        reader.onload = () => {
          const ext = extFromName(file.name || 'paste.png')
          const name = file.name || `clipboard-${Date.now()}.${ext || 'png'}`
          stageFromBuffer(session, chatId, reader.result, name)
        }
        reader.readAsArrayBuffer(file)
      }
    }
  })
}

// ─── Toast ───────────────────────────────────────────────────────────────────

function showToast(chatId, message) {
  const msgsEl = document.getElementById('chat-msgs-' + chatId)
  if (!msgsEl) return
  const toast = document.createElement('div')
  toast.className = 'chat-msg chat-msg-system'
  toast.style.cssText = 'opacity:0.7; font-size:11px; padding:4px 24px; color:var(--amber,#d4a574);'
  toast.textContent = message
  msgsEl.appendChild(toast)
  setTimeout(() => toast.remove(), 5000)
}
