// renderer/modules/vitality-card.js
// Live telemetry card — appended to body, positioned via getBoundingClientRect.
// Polls every 5s while open; clears on close.

const POLL_MS = 5_000

const COLOR = {
  clear:   { bar: 'var(--green, #6db88f)', level: '',        badge: 'clear'   },
  warming: { bar: '#c8a060',               level: 'warming', badge: 'warming' },
  hot:     { bar: '#d4784a',               level: 'hot',     badge: 'hot'     },
}

let pollTimer = null
let open = false
let card = null

function stateFromScore(score) {
  if (score < 0.4) return 'clear'
  if (score < 0.7) return 'warming'
  return 'hot'
}

function pct(ratio) { return Math.round(ratio * 100) }

function flashPip() {
  const pip = card?.querySelector('#vc-live-pip')
  if (!pip) return
  pip.classList.add('vc-flash')
  setTimeout(() => pip.classList.remove('vc-flash'), 400)
}

function applyHealth(score) {
  const s = stateFromScore(score)
  const c = COLOR[s]
  const badge = card?.querySelector('#vc-score-badge')
  const fill  = card?.querySelector('#vc-bar-fill')
  if (!badge || !fill) return
  badge.textContent = c.badge
  if (c.level) badge.dataset.level = c.level
  else delete badge.dataset.level
  fill.style.width      = pct(score) + '%'
  fill.style.background = c.bar
}

function applySensors(raw, score) {
  const color = COLOR[stateFromScore(score)].bar
  const fmt = {
    dom:       (r) => `${r.val}`,
    listeners: (r) => `${r.val}`,
    sessions:  (r) => `${r.val}`,
    uptime:    (r) => `${r.val}h`,
    staleness: (r) => `${r.val}m`,
  }
  Object.entries(raw).forEach(([key, r]) => {
    const bar = card?.querySelector(`#vc-bar-${key}`)
    const val = card?.querySelector(`#vc-val-${key}`)
    if (!bar || !val) return
    const p = Math.min(100, Math.round((r.val / r.ceil) * 100))
    bar.style.width      = p + '%'
    bar.style.background = color
    val.textContent      = fmt[key]?.(r) ?? p + '%'
  })
}

function applyMemory(snap) {
  const mb = (b) => Math.round(b / 1024 / 1024)
  ;[
    ['#vc-mem-heap', mb(snap.heapUsed)],
    ['#vc-mem-rss',  mb(snap.rss)],
    ['#vc-mem-ext',  mb(snap.external)],
    ['#vc-mem-pty',  snap.ptySessions],
  ].forEach(([sel, val]) => {
    const el = card?.querySelector(sel)
    if (el) el.textContent = val
  })
}

function updateFooter() {
  const el = card?.querySelector('#vc-footer-text')
  if (el) el.textContent = 'updated ' + new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' })
}

async function poll() {
  const score  = window._refreshEngine?.health?.() ?? 0
  const raw    = window._refreshEngine?.rawSensors?.()
  const snap   = await window.ace?.memory?.usage?.().catch(() => null)
  applyHealth(score)
  if (raw) applySensors(raw, score)
  if (snap) applyMemory(snap)
  updateFooter()
  flashPip()
}

function positionCard(dot) {
  const r = dot.getBoundingClientRect()
  card.style.left   = r.left + 'px'
  card.style.bottom = (window.innerHeight - r.top + 10) + 'px'
}

function openCard(dot) {
  open = true
  positionCard(dot)
  card.classList.add('vc-visible')
  dot.classList.add('open')
  poll()
  pollTimer = setInterval(poll, POLL_MS)
}

function closeCard(dot) {
  open = false
  card.classList.remove('vc-visible')
  dot?.classList.remove('open')
  clearInterval(pollTimer)
  pollTimer = null
  const ft = card?.querySelector('#vc-footer-text')
  if (ft) ft.textContent = 'waiting…'
}

function buildCard() {
  const el = document.createElement('div')
  el.className = 'vitality-card'
  el.id = 'vitality-card'
  el.innerHTML = `
    <div class="vc-header">
      <span class="vc-label">System Vitals</span>
      <span class="vc-score-badge" id="vc-score-badge">clear</span>
    </div>
    <div class="vc-bar-wrap"><div class="vc-bar-fill" id="vc-bar-fill"></div></div>
    <div class="vc-section-label">Sensors</div>
    <div class="vc-row"><span class="vc-row-name">DOM nodes</span><div class="vc-row-bar-wrap"><div class="vc-row-bar" id="vc-bar-dom"></div></div><span class="vc-row-val" id="vc-val-dom">—</span></div>
    <div class="vc-row"><span class="vc-row-name">Listeners</span><div class="vc-row-bar-wrap"><div class="vc-row-bar" id="vc-bar-listeners"></div></div><span class="vc-row-val" id="vc-val-listeners">—</span></div>
    <div class="vc-row"><span class="vc-row-name">Sessions</span><div class="vc-row-bar-wrap"><div class="vc-row-bar" id="vc-bar-sessions"></div></div><span class="vc-row-val" id="vc-val-sessions">—</span></div>
    <div class="vc-row"><span class="vc-row-name">Uptime</span><div class="vc-row-bar-wrap"><div class="vc-row-bar" id="vc-bar-uptime"></div></div><span class="vc-row-val" id="vc-val-uptime">—</span></div>
    <div class="vc-row"><span class="vc-row-name">Staleness</span><div class="vc-row-bar-wrap"><div class="vc-row-bar" id="vc-bar-staleness"></div></div><span class="vc-row-val" id="vc-val-staleness">—</span></div>
    <div class="vc-section-label">Memory</div>
    <div class="vc-mem-grid">
      <div class="vc-mem-cell"><div class="vc-mem-cell-label">Heap</div><div class="vc-mem-cell-val"><span id="vc-mem-heap">—</span><span class="vc-mem-cell-unit">mb</span></div></div>
      <div class="vc-mem-cell"><div class="vc-mem-cell-label">RSS</div><div class="vc-mem-cell-val"><span id="vc-mem-rss">—</span><span class="vc-mem-cell-unit">mb</span></div></div>
      <div class="vc-mem-cell"><div class="vc-mem-cell-label">External</div><div class="vc-mem-cell-val"><span id="vc-mem-ext">—</span><span class="vc-mem-cell-unit">mb</span></div></div>
      <div class="vc-mem-cell"><div class="vc-mem-cell-label">PTY sessions</div><div class="vc-mem-cell-val"><span id="vc-mem-pty">—</span></div></div>
    </div>
    <div class="vc-footer">
      <div class="vc-live-pip" id="vc-live-pip"></div>
      <span class="vc-footer-text" id="vc-footer-text">waiting…</span>
      <span class="vc-interval-note">5s</span>
    </div>`
  document.body.appendChild(el)
  return el
}

export function initVitalityCard() {
  const dot = document.getElementById('vitals-dot')
  if (!dot) return

  card = buildCard()
  dot.style.cursor = 'pointer'

  dot.addEventListener('click', (e) => {
    e.stopPropagation()
    open ? closeCard(dot) : openCard(dot)
  })

  document.addEventListener('click', (e) => {
    if (open && !card.contains(e.target)) closeCard(dot)
  })

  window.addEventListener('ace:health-score', (e) => { if (open) applyHealth(e.detail) })
  window.addEventListener('ace:memory-sample', (e) => { if (open) applyMemory(e.detail) })
}
