// renderer/views/artifacts.js
import { state } from '../state.js'
import { escapeHtml } from '../modules/chat-renderer.js'

const ARTIFACT_CAT_COLORS = {
  document: '#6ba3f7', deck: '#f7a06b', website: '#7be0ad', email: '#e0b860',
  visual: '#e07be0', video: '#e06b6b', app: '#8878ff', brand: '#c8a0f0',
}

const ARTIFACT_CAT_ORDER = ['app', 'website', 'document', 'deck', 'email', 'visual', 'video', 'brand']

export async function initArtifacts() {
  // console.log('[artifacts] initArtifacts called, initialized:', state.artifactsInitialized)
  if (state.artifactsInitialized) return
  state.artifactsInitialized = true
  const listEl = document.getElementById('artifacts-list')

  const data = await window.ace.artifacts.list()
  state.artifactsData = data

  if (!data || !data.artifacts || data.artifacts.length === 0) {
    listEl.innerHTML = '<div class="vault-empty">No artifacts yet \u2014 use /artifact to catalog shipped work</div>'
    return
  }

  // Build filter chips
  const filtersEl = document.getElementById('artifacts-filters')
  const total = data.artifacts.length
  let chipHtml = `<button class="artifacts-filter-chip active" data-cat="">All <span style="opacity:0.5">${total}</span></button>`
  for (const cat of ARTIFACT_CAT_ORDER) {
    const count = data.categories[cat] || 0
    if (count === 0) continue
    chipHtml += `<button class="artifacts-filter-chip" data-cat="${cat}">${cat.charAt(0).toUpperCase() + cat.slice(1)} <span style="opacity:0.5">${count}</span></button>`
  }
  filtersEl.innerHTML = chipHtml
  filtersEl.querySelectorAll('.artifacts-filter-chip').forEach(chip => {
    chip.addEventListener('click', () => {
      filtersEl.querySelectorAll('.artifacts-filter-chip').forEach(c => c.classList.remove('active'))
      chip.classList.add('active')
      state.artifactsActiveFilter = chip.dataset.cat || null
      renderArtifactsList()
    })
  })

  renderArtifactsList()
}

export async function refreshArtifacts() {
  const data = await window.ace.artifacts.list()
  if (!data || !data.artifacts) return
  state.artifactsData = data
  renderArtifactsList()
}

export function renderArtifactsList() {
  const listEl = document.getElementById('artifacts-list')
  const search = (document.getElementById('artifacts-search').value || '').toLowerCase()
  const filter = state.artifactsActiveFilter

  // Split active vs archived
  const active = []
  const archived = []
  for (const a of state.artifactsData.artifacts) {
    if (filter && a.category !== filter) continue
    if (search && !a.title.toLowerCase().includes(search) &&
        !(a.tags || []).some(t => t.toLowerCase().includes(search)) &&
        !(a.domain || '').toLowerCase().includes(search)) continue
    if (a.status === 'archived') { archived.push(a) } else { active.push(a) }
  }

  // Group active by category
  const grouped = {}
  for (const a of active) {
    const cat = a.category || 'other'
    if (!grouped[cat]) grouped[cat] = []
    grouped[cat].push(a)
  }

  let html = ''
  const order = filter ? [filter] : ARTIFACT_CAT_ORDER
  for (const cat of order) {
    const items = grouped[cat]
    if (!items || items.length === 0) continue
    html += `<div class="artifacts-cat-header">${cat} <span style="opacity:0.5">${items.length}</span></div>`
    for (const a of items) {
      html += `
        <div class="artifacts-item${a.missing ? ' missing' : ''}" data-slug="${escapeHtml(a.slug)}">
          <div class="artifacts-dot cat-${a.category}"></div>
          <span class="artifacts-name">${escapeHtml(a.title)}</span>
          ${a.missing ? '<span class="artifacts-missing-badge">missing</span>' : ''}
          ${a.domain ? `<span class="artifacts-domain-tag">${escapeHtml(a.domain)}</span>` : ''}
        </div>`
    }
  }

  // Archived section at the bottom
  if (state.artifactsShowArchived && archived.length > 0) {
    html += `<div class="artifacts-cat-header" style="opacity:0.4;margin-top:12px">Archived <span style="opacity:0.5">${archived.length}</span></div>`
    for (const a of archived) {
      html += `
        <div class="artifacts-item archived${a.missing ? ' missing' : ''}" data-slug="${escapeHtml(a.slug)}">
          <div class="artifacts-dot cat-${a.category}"></div>
          <span class="artifacts-name">${escapeHtml(a.title)}</span>
          ${a.missing ? '<span class="artifacts-missing-badge">missing</span>' : ''}
        </div>`
    }
  }

  // Add archived toggle at bottom if there are archived items
  if (archived.length > 0) {
    html += `<div class="artifacts-archived-toggle" id="artifacts-archived-toggle">
      ${state.artifactsShowArchived ? 'Hide' : 'Show'} archived (${archived.length})
    </div>`
  }

  listEl.innerHTML = html || '<div class="vault-empty">No matches</div>'

  // Wire archived toggle
  const archToggle = listEl.querySelector('#artifacts-archived-toggle')
  if (archToggle) {
    archToggle.addEventListener('click', () => {
      state.artifactsShowArchived = !state.artifactsShowArchived
      renderArtifactsList()
    })
  }

  const items = listEl.querySelectorAll('.artifacts-item')
  // console.log('[artifacts] binding click to', items.length, 'items')
  items.forEach(item => {
    item.addEventListener('click', () => {
      // console.log('[artifacts] clicked:', item.dataset.slug)
      items.forEach(el => el.classList.remove('active'))
      item.classList.add('active')
      openArtifactDetail(item.dataset.slug)
    })
  })
}

export async function openArtifactDetail(slug) {
  const detailEl = document.getElementById('artifacts-detail')
  // console.log('[artifacts] opening detail for:', slug)
  const data = await window.ace.artifacts.detail(slug)
  // console.log('[artifacts] detail data:', JSON.stringify(data))
  if (!data || data.error) {
    detailEl.innerHTML = `<div class="vault-empty">Error: ${escapeHtml(data?.error || 'Not found')}</div>`
    return
  }

  const config = await window.ace.setup.getConfig()
  const catColor = ARTIFACT_CAT_COLORS[data.category] || 'var(--text-dim)'
  const tags = Array.isArray(data.tags) ? data.tags : []
  const filePath = data.file_path || ''
  const fullPath = filePath ? config.vaultPath + '/' + filePath : ''

  // Determine if we can show inline preview
  const isHtml = filePath.endsWith('.html')
  const isPdf = filePath.endsWith('.pdf')
  const isDir = filePath.endsWith('/')
  const hasUrl = data.url && data.url.startsWith('http')

  // Preview source — only set if backend confirmed previewable or has URL
  let previewSrc = ''
  let previewType = 'iframe' // 'iframe' for HTML/URL, 'embed' for PDF
  if (data.previewable) {
    if (isPdf) { previewSrc = 'file://' + fullPath; previewType = 'embed' }
    else if (isHtml) previewSrc = 'file://' + fullPath
    else if (isDir) previewSrc = 'file://' + fullPath + 'index.html'
  }
  if (!previewSrc && hasUrl) previewSrc = data.url

  const isArchived = data.status === 'archived'
  const isMissing = data.missing

  // Context-aware open label
  let openLabel = 'Open in Finder'
  if (isHtml || isDir) openLabel = 'Open in Browser'
  else if (isPdf) openLabel = 'Open in PDF Viewer'

  let actionsHtml = ''
  // Primary open button — opens artifact in native app
  if (filePath && !isMissing) {
    actionsHtml += `<button class="artifacts-action-btn art-open-native" id="art-open-file">${openLabel}</button>`
  }
  if (data.url) {
    actionsHtml += `<button class="artifacts-action-btn" id="art-open-url">Open URL</button>`
  }
  if (previewSrc) {
    actionsHtml += `<button class="artifacts-action-btn" id="art-toggle-preview">Preview</button>`
  }
  // Archive / Restore button
  actionsHtml += `<button class="artifacts-action-btn ${isArchived ? 'art-restore' : 'art-archive'}" id="art-archive-btn">${isArchived ? 'Restore' : 'Archive'}</button>`

  detailEl.innerHTML = `
    ${isMissing ? '<div class="artifacts-missing-banner">Source file not found \u2014 the original file may have been moved or deleted.</div>' : ''}
    <div class="artifacts-detail-title">${escapeHtml(data.title || slug)}</div>
    <div class="artifacts-detail-meta">
      <span class="artifacts-detail-cat" style="background:${catColor}22;color:${catColor};border:1px solid ${catColor}44">${escapeHtml(data.category || 'unknown')}</span>
      <span class="${isArchived ? 'art-status-archived' : ''}">${escapeHtml(data.status || 'shipped')}</span>
      ${data.domain ? `<span>\u00b7 ${escapeHtml(data.domain)}</span>` : ''}
      ${data.client ? `<span>\u00b7 ${escapeHtml(data.client)}</span>` : ''}
      ${data.created ? `<span>\u00b7 ${escapeHtml(data.created)}</span>` : ''}
    </div>
    ${tags.length > 0 ? `<div class="artifacts-detail-tags">${tags.map(t => `<span class="artifacts-tag">${escapeHtml(t)}</span>`).join('')}</div>` : ''}
    ${filePath ? `<div style="font-family:'JetBrains Mono',monospace;font-size:8px;color:var(--text-dim);margin-bottom:6px;word-break:break-all">${escapeHtml(filePath)}</div>` : ''}
    ${data.url ? `<div style="font-family:'JetBrains Mono',monospace;font-size:8px;color:rgba(107,163,247,0.8);margin-bottom:6px;word-break:break-all;cursor:pointer" id="art-url-text">${escapeHtml(data.url)}</div>` : ''}
    ${actionsHtml ? `<div class="artifacts-detail-actions">${actionsHtml}</div>` : ''}
    <div id="art-preview-container" style="margin-top:16px;display:none"></div>
    <div class="artifacts-detail-body" style="margin-top:16px">${escapeHtml(data.body || '')}</div>
  `

  // Wire open file button
  const openFileBtn = detailEl.querySelector('#art-open-file')
  if (openFileBtn && fullPath) {
    openFileBtn.addEventListener('click', async () => {
      const err = await window.ace.shell.openPath(fullPath)
      if (err) console.error('[artifacts] openPath error:', err, 'path:', fullPath)
    })
  }

  // Wire open URL button
  const openUrlBtn = detailEl.querySelector('#art-open-url')
  if (openUrlBtn && data.url) {
    openUrlBtn.addEventListener('click', () => window.ace.shell.openExternal(data.url))
  }

  // Wire clickable URL text
  const urlText = detailEl.querySelector('#art-url-text')
  if (urlText && data.url) {
    urlText.addEventListener('click', () => window.ace.shell.openExternal(data.url))
  }

  // Wire archive/restore button
  const archiveBtn = detailEl.querySelector('#art-archive-btn')
  if (archiveBtn) {
    archiveBtn.addEventListener('click', async () => {
      const currentStatus = data.status || 'shipped'
      const newStatus = currentStatus === 'archived' ? 'shipped' : 'archived'
      const result = await window.ace.artifacts.setStatus(slug, newStatus)
      if (result?.ok) {
        await refreshArtifacts()
        openArtifactDetail(slug)
      }
    })
  }

  // Wire preview toggle
  const previewBtn = detailEl.querySelector('#art-toggle-preview')
  if (previewBtn) {
    let showing = false
    previewBtn.addEventListener('click', () => {
      const container = detailEl.querySelector('#art-preview-container')
      showing = !showing
      previewBtn.textContent = showing ? 'Hide Preview' : 'Preview'
      if (showing) {
        if (previewType === 'embed') {
          container.innerHTML = `<embed src="${previewSrc}" type="application/pdf" style="width:100%;height:600px;border:1px solid var(--border);border-radius:8px">`
        } else {
          container.innerHTML = `<iframe src="${previewSrc}" style="width:100%;height:500px;border:1px solid var(--border);border-radius:8px;background:#fff" sandbox="allow-scripts allow-same-origin"></iframe>`
        }
        container.style.display = ''
      } else {
        container.innerHTML = ''
        container.style.display = 'none'
      }
    })
  }
}

// Wire search
document.getElementById('artifacts-search')?.addEventListener('input', () => {
  if (state.artifactsInitialized) renderArtifactsList()
})
