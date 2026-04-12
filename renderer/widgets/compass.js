// renderer/widgets/compass.js
// Creative Compass — four DCA-anchored cardinal directions with weekly needle
import { escapeHtml } from '../modules/chat-renderer.js'
import { openVaultFile } from '../views/vault.js'

export default {
  id: 'compass',
  label: 'Creative Compass',
  description: 'DCA-anchored direction with weekly needle from execution log',
  dataSource: null,
  defaultEnabled: true,

  render(allData, el) {
    const ns = allData.northStar || {}
    const directions = ns.compass_directions || {}
    const compass = allData.compass || { direction: null, strength: 0 }

    if (!directions.north) {
      el.innerHTML = ''
      return
    }

    const angle = this._dirAngle(compass.direction)

    el.innerHTML = `
      <div class="cockpit-compass">
        <div class="cmp-rose"></div>
        <div class="cmp-cross"></div>
        <div class="cmp-needle" style="transform: translate(-50%, -100%) rotate(${angle}deg)"></div>
        <div class="cmp-center" data-action="open-dca"></div>
        ${['north','east','south','west'].map(dir => `
          <div class="cmp-dir cmp-${dir} ${compass.direction === dir ? 'active' : ''}" data-dir="${dir}">
            <span class="cmp-letter">${dir[0].toUpperCase()}</span>
            <span class="cmp-label">${escapeHtml(directions[dir]?.label || '')}</span>
          </div>
        `).join('')}
      </div>`

    const openOverlay = () => showCompassOverlay(directions, compass)
    el.querySelector('[data-action="open-dca"]')?.addEventListener('click', openOverlay)
    el.querySelectorAll('.cmp-dir').forEach(d => d.addEventListener('click', openOverlay))
    // Click on the compass face itself also opens the overlay
    el.querySelector('.cockpit-compass')?.addEventListener('click', (e) => {
      if (e.target.closest('.cmp-dir') || e.target.closest('[data-action]')) return
      openOverlay()
    })
  },

  _dirAngle(dir) {
    if (dir === 'north') return 0
    if (dir === 'east')  return 90
    if (dir === 'south') return 180
    if (dir === 'west')  return 270
    return 45 // no signal — point northeast as ambient
  },
}

function escapeAttr(s) {
  return String(s || '').replace(/"/g, '&quot;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
}

function showCompassOverlay(directions, compass) {
  document.querySelectorAll('.cockpit-overlay').forEach(o => o.remove())

  const active = compass.direction
  const scores = compass.scores || {}
  const totalScore = Object.values(scores).reduce((a, b) => a + b, 0)

  const rows = ['north', 'east', 'south', 'west'].map(dir => {
    const cfg = directions[dir] || {}
    const score = scores[dir] || 0
    const pct = totalScore > 0 ? Math.round((score / totalScore) * 100) : 0
    const isActive = dir === active
    const kw = (cfg.keywords || []).slice(0, 4).join(', ')
    return `<div class="cockpit-overlay-row">
      <span class="cockpit-overlay-row-label">${dir.toUpperCase()} · ${escapeAttr(cfg.label || '')}</span>
      <span class="cockpit-overlay-row-value ${isActive ? 'active' : ''}">${pct}%${isActive ? ' · rising' : ''}</span>
    </div>
    <div style="font-family:'JetBrains Mono',monospace;font-size:9px;color:var(--text-dim);padding:0 0 8px;letter-spacing:0.05em;">${escapeAttr(kw)}</div>`
  }).join('')

  const overlay = document.createElement('div')
  overlay.className = 'cockpit-overlay'
  overlay.innerHTML = `
    <div class="cockpit-overlay-panel">
      <div class="cockpit-overlay-header">
        <span class="cockpit-overlay-label">Creative Compass · this week</span>
        <button class="cockpit-overlay-close" aria-label="Close">×</button>
      </div>
      <div class="cockpit-overlay-body">
        ${rows}
      </div>
      <div class="cockpit-overlay-footer">
        <button class="cockpit-overlay-btn secondary" data-action="close">Close</button>
        <button class="cockpit-overlay-btn" data-action="edit-dca">Edit DCA</button>
      </div>
    </div>`

  const close = () => overlay.remove()
  overlay.addEventListener('click', (e) => { if (e.target === overlay) close() })
  overlay.querySelector('.cockpit-overlay-close').addEventListener('click', close)
  overlay.querySelector('[data-action="close"]').addEventListener('click', close)
  overlay.querySelector('[data-action="edit-dca"]').addEventListener('click', () => {
    close()
    document.querySelector('.nav-item[data-view="vault"]')?.click()
    // Ask the main process for the DCA path and open it in vault view
    setTimeout(async () => {
      try {
        const ns = await window.ace.dash.getNorthStar()
        if (ns?.filePath) openVaultFile(ns.filePath, 'dca.md')
      } catch (e) { console.error('Open DCA failed:', e) }
    }, 120)
  })
  document.addEventListener('keydown', function esc(e) {
    if (e.key === 'Escape') { close(); document.removeEventListener('keydown', esc) }
  })
  document.body.appendChild(overlay)
}
