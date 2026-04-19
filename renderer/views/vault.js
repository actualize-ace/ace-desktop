// renderer/views/vault.js
import { state } from '../state.js'
import { escapeHtml, processWikilinks, postProcessCodeBlocks, postProcessWikilinks } from '../modules/chat-renderer.js'

let vaultRootPath      = null
let activeVaultFile    = null
const expandedDirs     = new Set()

const TREE_HIDE = new Set(['.git', '.obsidian', 'node_modules', '.DS_Store', '.claude'])
const BINARY_EXTS = new Set(['.db', '.sqlite', '.png', '.jpg', '.jpeg', '.gif', '.svg', '.pdf', '.mp4', '.mp3', '.webp', '.ico', '.woff', '.woff2', '.ttf', '.eot'])

function treeHide(name)   { return name.startsWith('.') || TREE_HIDE.has(name) }
function treeBinary(name) { const i = name.lastIndexOf('.'); return i > 0 && BINARY_EXTS.has(name.slice(i).toLowerCase()) }
function treeExt(name)    { const i = name.lastIndexOf('.'); return i > 0 ? name.slice(i).toLowerCase() : '' }

async function initVault() {
  if (state.vaultInitialized) return
  state.vaultInitialized = true
  const config = await window.ace.setup.getConfig()
  vaultRootPath = config?.vaultPath
  if (!vaultRootPath) {
    document.getElementById('vault-tree').innerHTML = '<div class="vault-empty">No vault configured</div>'
    return
  }
  const treeEl = document.getElementById('vault-tree')
  treeEl.innerHTML = ''
  await buildTree(treeEl, vaultRootPath, 0)
}

async function buildTree(parentEl, dirPath, depth) {
  const entries = await window.ace.vault.listDir(dirPath)
  if (!entries || entries.error || !Array.isArray(entries)) return

  entries.sort((a, b) => {
    if (a.isDir !== b.isDir) return a.isDir ? -1 : 1
    return a.name.localeCompare(b.name)
  })

  for (const entry of entries) {
    if (treeHide(entry.name)) continue

    const item = document.createElement('div')
    item.className = 'tree-item' + (entry.isDir ? ' tree-dir' : '')
    item.style.paddingLeft = `${10 + depth * 14}px`

    const icon = document.createElement('span')
    icon.className = 'tree-icon'

    const name = document.createElement('span')
    name.className = 'tree-name'
    name.textContent = entry.name

    item.appendChild(icon)
    item.appendChild(name)

    if (entry.isDir) {
      icon.textContent = '\u25b6'
      const childContainer = document.createElement('div')
      let loaded = false

      item.addEventListener('click', async (e) => {
        e.stopPropagation()
        const expanded = expandedDirs.has(entry.path)
        if (expanded) {
          expandedDirs.delete(entry.path)
          icon.textContent = '\u25b6'
          childContainer.style.display = 'none'
        } else {
          expandedDirs.add(entry.path)
          icon.textContent = '\u25be'
          if (!loaded) {
            loaded = true
            await buildTree(childContainer, entry.path, depth + 1)
          }
          childContainer.style.display = ''
        }
      })

      childContainer.style.display = 'none'
      parentEl.appendChild(item)
      parentEl.appendChild(childContainer)
    } else {
      if (treeBinary(entry.name)) continue
      const ext = treeExt(entry.name)
      if      (ext === '.md')                              icon.textContent = '\u25cb'
      else if (['.js','.ts','.py','.sh'].includes(ext))   icon.textContent = '\u25c7'
      else if (['.json','.yaml','.yml'].includes(ext))     icon.textContent = '\u25c8'
      else                                                 icon.textContent = '\u00b7'

      item.addEventListener('click', (e) => {
        e.stopPropagation()
        document.querySelectorAll('#vault-tree .tree-item').forEach(el => el.classList.remove('active'))
        item.classList.add('active')
        openVaultFile(entry.path, entry.name)
      })
      parentEl.appendChild(item)
    }
  }
}

async function openVaultFile(filePath, fileName) {
  activeVaultFile = filePath
  const renderEl = document.getElementById('vault-render')
  renderEl.innerHTML = '<div class="vault-empty">Loading\u2026</div>'

  const content = await window.ace.vault.readFile(filePath)
  if (!content || (typeof content === 'object' && content.error)) {
    renderEl.innerHTML = `<div class="vault-empty">Error reading file</div>`
    return
  }
  if (content === '') {
    renderEl.innerHTML = '<div class="vault-empty">Empty file</div>'
    return
  }

  const ext = treeExt(filePath)
  if (ext === '.md' || ext === '.markdown') {
    const html  = marked.parse(content)
    const safe  = DOMPurify.sanitize(html, {
      ALLOWED_TAGS: ['h1','h2','h3','h4','h5','h6','p','a','ul','ol','li',
                     'blockquote','code','pre','strong','em','del','s','table',
                     'thead','tbody','tr','th','td','hr','br','span','div',
                     'input','details','summary','mark'],
      ALLOWED_ATTR: ['href','src','alt','class','id','data-target','title',
                     'colspan','rowspan','type','checked','disabled'],
    })
    renderEl.innerHTML = `<div class="md-body">${safe}</div>`
    postProcessWikilinks(renderEl)
  } else {
    const escaped = content.replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;')
    renderEl.innerHTML = `<div class="md-body"><pre><code>${escaped}</code></pre></div>`
  }

  // Breadcrumb
  const rel   = filePath.startsWith(vaultRootPath) ? filePath.slice(vaultRootPath.length + 1) : filePath
  const parts = rel.split('/')
  document.getElementById('vault-breadcrumb').innerHTML =
    parts.map((p, i) =>
      `<span style="color:${i===parts.length-1?'var(--text-secondary)':'var(--text-dim)'}">${p}</span>${i<parts.length-1?'<span style="color:var(--text-dim);padding:0 3px">/</span>':''}`
    ).join('')

  renderEl.scrollTop = 0

  // Show edit button for editable file types
  const editorEl  = document.getElementById('vault-editor')
  const editBtn   = document.getElementById('vault-edit-btn')
  const saveBtn   = document.getElementById('vault-save-btn')
  const cancelBtn = document.getElementById('vault-cancel-btn')
  const renderEl2 = document.getElementById('vault-render')
  // Exit edit mode if switching files
  editorEl.style.display = 'none'
  renderEl2.style.display = ''
  editBtn.style.display = filePath.match(/\.(md|markdown|txt|yaml|yml|json|js|css|html)$/i) ? '' : 'none'
  saveBtn.style.display = 'none'
  cancelBtn.style.display = 'none'
}

// Rename button on load
const openBtn = document.getElementById('vault-open-term-btn')
if (openBtn) openBtn.textContent = 'Open in Chat'

openBtn?.addEventListener('click', async () => {
  if (!activeVaultFile) return
  const fileName = activeVaultFile.split('/').pop()
  // Read file content for context
  let fileContent = ''
  try {
    fileContent = await window.ace.vault.readFile(activeVaultFile)
    if (typeof fileContent === 'object' && fileContent.error) fileContent = ''
  } catch(e) { fileContent = '' }

  // Navigate to terminal and open chat with file context
  document.querySelector('.nav-item[data-view="terminal"]').click()
  setTimeout(() => {
    if (window.spawnSession) window.spawnSession()
    setTimeout(() => {
      if (state.activeId) {
        // Set tab name to filename
        const tab = state.sessions[state.activeId]?.tab
        if (tab) {
          const span = tab.querySelector('span:not(.stab-close)')
          if (span) span.textContent = fileName
        }
        // Send file content as context prompt
        const truncated = fileContent.length > 4000 ? fileContent.slice(0, 4000) + '\n\n[...truncated]' : fileContent
        const prompt = `I'm looking at the file "${fileName}" from my vault. Here's its content:\n\n\`\`\`markdown\n${truncated}\n\`\`\`\n\nHelp me work with this file. What stands out?`
        if (window.sendChatMessage) window.sendChatMessage(state.activeId, prompt)
      }
    }, 200)
  }, 150)
})

// ─── Vault Edit Mode ─────────────────────────────────────────────────────────
const editBtn   = document.getElementById('vault-edit-btn')
const saveBtn   = document.getElementById('vault-save-btn')
const cancelBtn = document.getElementById('vault-cancel-btn')
const editorEl  = document.getElementById('vault-editor')
const renderEl2 = document.getElementById('vault-render')

function showEditButtons(show) {
  editBtn.style.display   = show && !editorEl.style.display.includes('block') ? '' : 'none'
  saveBtn.style.display   = show && editorEl.style.display === 'block' ? '' : 'none'
  cancelBtn.style.display = show && editorEl.style.display === 'block' ? '' : 'none'
}

editBtn.addEventListener('click', async () => {
  if (!activeVaultFile) return
  const content = await window.ace.vault.readFile(activeVaultFile)
  if (typeof content !== 'string') return
  state.vaultEditRaw = content
  editorEl.value = content
  editorEl.style.display = 'block'
  renderEl2.style.display = 'none'
  editBtn.style.display = 'none'
  saveBtn.style.display = ''
  cancelBtn.style.display = ''
  editorEl.focus()
})

saveBtn.addEventListener('click', async () => {
  if (!activeVaultFile) return
  const result = await window.ace.vault.writeFile(activeVaultFile, editorEl.value)
  if (result?.error) { console.error('[vault] save failed:', result.error); return }
  editorEl.style.display = 'none'
  renderEl2.style.display = ''
  saveBtn.style.display = 'none'
  cancelBtn.style.display = 'none'
  // Re-render the file with updated content
  await openVaultFile(activeVaultFile, activeVaultFile.split('/').pop())
})

cancelBtn.addEventListener('click', () => {
  editorEl.style.display = 'none'
  renderEl2.style.display = ''
  editBtn.style.display = ''
  saveBtn.style.display = 'none'
  cancelBtn.style.display = 'none'
})

export {
  initVault,
  buildTree,
  openVaultFile,
  treeHide,
  treeBinary,
  treeExt,
  showEditButtons,
}
