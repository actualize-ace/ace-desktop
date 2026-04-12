// renderer/dashboard.js
// Orchestrates widget rendering based on layout config from ace-config.json.
import { WIDGETS, DEFAULT_LAYOUT, WIDGET_ZONES } from './widgets/registry.js'

async function getLayout() {
  const saved = await window.ace.dash.getLayout()
  if (!saved) {
    await window.ace.dash.saveLayout(DEFAULT_LAYOUT)
    return DEFAULT_LAYOUT
  }
  const registryIds = new Set(WIDGETS.map(w => w.id))
  // 1) Drop IDs no longer in the registry (stale/renamed widgets).
  const cleaned = saved.filter(w => registryIds.has(w.id))
  // 2) Merge: keep saved order/enabled for known IDs, append newly-registered widgets at end.
  const cleanedIds = new Set(cleaned.map(w => w.id))
  const merged = [...cleaned]
  for (const w of WIDGETS) {
    if (!cleanedIds.has(w.id)) merged.push({ id: w.id, enabled: w.defaultEnabled ?? true })
  }
  // 3) Cockpit mode: force-disable any widget in the 'legacy' zone, regardless
  //    of saved state — the cockpit replaces these with triad cards.
  const normalized = merged.map(l =>
    WIDGET_ZONES[l.id] === 'legacy' ? { ...l, enabled: false } : l
  )
  // 4) Sort legacy widgets to the bottom so the settings list reads
  //    active-first, dormant-after instead of interleaving. Stable within groups.
  const active = normalized.filter(l => WIDGET_ZONES[l.id] !== 'legacy')
  const legacy = normalized.filter(l => WIDGET_ZONES[l.id] === 'legacy')
  const ordered = [...active, ...legacy]
  // 5) Persist the cleaned + reordered layout if it differs from saved. Prevents
  //    stale IDs from accumulating and keeps settings UI stable across reloads.
  const sameShape = saved.length === ordered.length
    && saved.every((s, i) => s.id === ordered[i].id && s.enabled === ordered[i].enabled)
  if (!sameShape) { window.ace.dash.saveLayout(ordered).catch(() => {}) }
  return ordered
}

async function loadDashboard() {
  const layout = await getLayout()
  const enabledIds = layout.filter(l => l.enabled).map(l => l.id)

  // Data source → IPC method map
  const sourceMap = {
    getState:        () => window.ace.dash.getState(),
    getPipeline:     () => window.ace.dash.getPipeline(),
    getFollowUps:    () => window.ace.dash.getFollowUps(),
    getMetrics:      () => window.ace.dash.getMetrics(),
    getVelocity:     () => window.ace.dash.getVelocity(),
    getRhythm:       () => window.ace.dash.getRhythm(),
    getNorthStar:    () => window.ace.dash.getNorthStar(),
    getDailyFocus:   () => window.ace.dash.getDailyFocus(),
    getBuildBlocks:  () => window.ace.dash.getBuildBlocks(),
    getCompass:      () => window.ace.dash.getCompass(),
    getLastPulse:    () => window.ace.dash.getLastPulse(),
  }
  // Patterns: optional, don't break dashboard if unavailable
  if (typeof window.ace.dash.getPatterns === 'function') {
    sourceMap.getPatterns = () => window.ace.dash.getPatterns()
  }

  // Collect unique data sources needed by enabled widgets
  const neededSources = new Set()
  for (const id of enabledIds) {
    const w = WIDGETS.find(w => w.id === id)
    if (w?.dataSource) neededSources.add(w.dataSource)
    else if (w && w.dataSource === null) {
      // Composite widgets receive allData — fetch every source
      for (const key of Object.keys(sourceMap)) neededSources.add(key)
    }
  }

  // Fetch needed sources in parallel
  const fetchList = [...neededSources].filter(s => sourceMap[s])
  const fetchResults = await Promise.all(fetchList.map(s => sourceMap[s]()))
  const data = {}
  fetchList.forEach((s, i) => { data[s] = fetchResults[i] })

  // Always fetch velocity for synthesis context (even if velocity widget is disabled)
  if (!data.getVelocity) data.getVelocity = await window.ace.dash.getVelocity()

  // Always fetch cockpit composite data for composite widgets
  if (!data.getNorthStar)   data.getNorthStar   = await window.ace.dash.getNorthStar()
  if (!data.getDailyFocus)  data.getDailyFocus  = await window.ace.dash.getDailyFocus()
  if (!data.getBuildBlocks) data.getBuildBlocks = await window.ace.dash.getBuildBlocks()
  if (!data.getCompass)     data.getCompass     = await window.ace.dash.getCompass()
  if (!data.getLastPulse)   data.getLastPulse   = await window.ace.dash.getLastPulse()

  // Bundle allData for composite widgets (dataSource: null)
  const allData = {
    state:        data.getState,
    metrics:      data.getMetrics,
    pipeline:     data.getPipeline,
    followUps:    data.getFollowUps,
    velocity:     data.getVelocity,
    rhythm:       data.getRhythm,
    patterns:     data.getPatterns,
    northStar:    data.getNorthStar,
    dailyFocus:   data.getDailyFocus,
    buildBlocks:  data.getBuildBlocks,
    compass:      data.getCompass,
    lastPulse:    data.getLastPulse,
  }

  // ─── Build candidate pools per leg + compute leverage + select risen ─────
  const candidatesByLeg = buildCandidatesByLeg(allData)
  const compassDir = allData.compass?.direction
  const dailyFocus = allData.dailyFocus || []
  const signals = allData.metrics?._signals || []
  const weakestLeg = computeWeakestLeg(signals)

  for (const leg of ['authority', 'capacity', 'expansion']) {
    for (const c of candidatesByLeg[leg]) {
      c._leverage = computeLeverageScore(c, { dailyFocus, weakestLeg, compassDirection: compassDir })
    }
    candidatesByLeg[leg].sort((a, b) => (b._leverage || 0) - (a._leverage || 0))
  }

  // Find risen leg — highest leverage across all leg-tops
  let topScore = -1
  let risenLeg = null
  for (const leg of ['authority', 'capacity', 'expansion']) {
    const top = candidatesByLeg[leg][0]
    if (top && top._leverage > topScore) {
      topScore = top._leverage
      risenLeg = leg
    }
  }

  allData._candidatesByLeg = candidatesByLeg
  allData._risenLeg = risenLeg
  allData._weakestLeg = weakestLeg

  // ─── Vault health banner ──────────────────────────────────
  try {
    const health = await window.ace.health?.check?.()
    if (health && !health.ok && health.missing?.length) {
      let bannerEl = document.getElementById('vault-health-banner')
      if (!bannerEl) {
        bannerEl = document.createElement('div')
        bannerEl.id = 'vault-health-banner'
        const grid = document.querySelector('.triad-grid') || document.querySelector('.dashboard-grid') || document.querySelector('.widget-grid')
        if (grid) grid.parentNode.insertBefore(bannerEl, grid)
      }
      renderHealthBanner(health, bannerEl)
    } else {
      const existing = document.getElementById('vault-health-banner')
      if (existing) existing.remove()
    }
  } catch (_) { /* vault health is non-blocking */ }

  // Clear all widget containers first, then render only enabled ones
  for (const w of WIDGETS) {
    const container = document.getElementById(`widget-${w.id}`)
    if (container && !enabledIds.includes(w.id)) container.innerHTML = ''
  }

  for (let _wi = 0; _wi < enabledIds.length; _wi++) {
    const id = enabledIds[_wi]
    const widget = WIDGETS.find(w => w.id === id)
    const container = document.getElementById(`widget-${id}`)
    if (!widget || !container) continue

    const widgetData = widget.dataSource === null
      ? allData
      : data[widget.dataSource]

    try {
      widget.render(widgetData, container)
      // Staggered entrance animation
      container.style.animation = `widgetReveal 0.35s ease ${_wi * 0.06}s both`
    } catch (e) {
      console.error(`[dashboard] widget ${id} render error:`, e)
    }
  }

  // Legacy: render Triad signal dots in old column headers (elements may no longer exist)
  const legacySignals = signals.length ? signals : Array(9).fill('dim')
  const dotGroups = {
    authority:  legacySignals.slice(0, 3),
    capacity:   legacySignals.slice(3, 6),
    expansion:  legacySignals.slice(6, 9),
  }
  for (const [leg, dots] of Object.entries(dotGroups)) {
    const el = document.getElementById(`dots-${leg}`)
    if (el) el.innerHTML = dots.map(c => `<div class="triad-dot ${c}"></div>`).join('')
  }

  // "Begin here" whisper — appears 1.2s after entry, fades after 5s
  setTimeout(() => {
    const whisper = document.getElementById('begin-whisper')
    if (!whisper || !risenLeg) return
    const colIdx = { authority: 0, capacity: 1, expansion: 2 }[risenLeg]
    if (colIdx == null) return
    whisper.style.left = `${(colIdx + 0.5) * 33.33}%`
    whisper.style.transform = 'translateX(-50%)'
    whisper.textContent = 'begin here ↓'
    whisper.classList.add('show')
    setTimeout(() => {
      whisper.classList.add('fade')
      setTimeout(() => whisper.classList.remove('show', 'fade'), 1500)
    }, 5000)
  }, 1200)
}

function renderHealthBanner(health, el) {
  const critical = health.missing.filter(m => m.tier === 'engine')
  const other = health.missing.filter(m => m.tier !== 'engine')

  const criticalHtml = critical.length
    ? `<div class="health-section">
        <span class="health-section-label health-engine">${critical.length} engine file${critical.length === 1 ? '' : 's'} missing</span>
        <button class="health-fix-critical" onclick="window.__fixCriticalVault__()">Repair</button>
       </div>`
    : ''

  const otherHtml = other.length
    ? `<div class="health-section">
        <span class="health-section-label health-scaffolding">${other.length} optional file${other.length === 1 ? '' : 's'} missing</span>
       </div>`
    : ''

  el.innerHTML = `
    <div class="vault-health-card">
      <div class="health-header">
        <span class="health-score">${health.score}%</span>
        <span class="health-label">Vault Integrity</span>
        <button class="health-dismiss" onclick="this.closest('.vault-health-card').remove()">\u00d7</button>
      </div>
      <div class="health-body">${criticalHtml}${otherHtml}</div>
    </div>
  `

  window.__fixCriticalVault__ = async () => {
    const btn = el.querySelector('.health-fix-critical')
    if (btn) { btn.textContent = 'Repairing...'; btn.disabled = true }
    await window.ace.health.scaffoldAll(critical)
    // Re-check health after repair
    const updated = await window.ace.health.check()
    if (updated && !updated.ok && updated.missing?.length) {
      renderHealthBanner(updated, el)
    } else {
      el.remove()
    }
    if (typeof loadDashboard === 'function') loadDashboard()
  }
}

// ─── Clickable dashboard items → terminal ───────────────────────────────────
function initDashClickables() {
  const home = document.getElementById('view-home')
  if (!home || home._dashClickWired) return
  home._dashClickWired = true
  home.addEventListener('click', (e) => {
    const item = e.target.closest('.dash-clickable[data-cmd]')
    if (!item) return
    document.querySelector('.nav-item[data-view="terminal"]')?.click()
    if (window.sendToActive) {
      setTimeout(() => window.sendToActive(item.dataset.cmd + '\r'), 120)
    }
  })
}

// ─── Cockpit candidate builders per leg ──────────────────────────────────

function buildCandidatesByLeg(allData) {
  const dismissed = JSON.parse(localStorage.getItem('cockpit-dismissed') || '[]')
  const today = new Date().toISOString().slice(0, 10)
  const dismissedToday = new Set(
    dismissed.filter(d => d.date === today).map(d => d.label)
  )
  const cycled = JSON.parse(sessionStorage.getItem('cockpit-cycled') || '[]')
  const cycledSet = new Set(cycled)

  const filterDismissed = (arr) => arr.filter(c =>
    !dismissedToday.has(c.label) && !cycledSet.has(c.label)
  )

  return {
    authority: filterDismissed(buildAuthorityCandidates(allData)),
    capacity:  filterDismissed(buildCapacityCandidates(allData)),
    expansion: filterDismissed(buildExpansionCandidates(allData)),
  }
}

function buildAuthorityCandidates(allData) {
  const candidates = []
  const outcomes = allData.state?.outcomes || []

  for (const o of outcomes) {
    if (!o.title || /COMPLETE|CLOSED|ABSORBED/i.test(o.status || '')) continue
    const days = o.daysToGate
    let urgency = 'normal'
    if (days != null && days <= 0) urgency = 'critical'
    else if (days != null && days <= 3) urgency = 'urgent'
    else if (days != null && days <= 7) urgency = 'warning'
    if (/AT RISK|BLOCKED/i.test(o.status || '')) urgency = 'urgent'

    candidates.push({
      type: 'outcome',
      leg: 'authority',
      urgency,
      label: o.title,
      context: o.gateLabel
        ? `Gate ${o.gateLabel}${days != null ? ` · ${Math.abs(days)} days ${days < 0 ? 'past' : ''}` : ''}`
        : (o.status || ''),
      _raw: o,
    })
  }
  return candidates
}

function buildCapacityCandidates(allData) {
  const candidates = []
  const signals = allData.metrics?._signals || []
  const state = allData.state || {}
  const followUps = Array.isArray(allData.followUps) ? allData.followUps : []

  // Regulation invitation (C1 yellow/red)
  const c1 = signals[3]
  if (c1 === 'yellow' || c1 === 'red') {
    candidates.push({
      type: 'regulation',
      leg: 'capacity',
      urgency: c1 === 'red' ? 'urgent' : 'warning',
      label: 'Regulation invitation',
      context: `C1 ${c1} · energy ${state.energy || 'unknown'}`,
      _raw: { signal: 'C1', color: c1 },
    })
  }

  // Recovery protocol
  if (state.energy === 'depleted') {
    candidates.push({
      type: 'recovery',
      leg: 'capacity',
      urgency: 'critical',
      label: 'Recovery protocol',
      context: `Energy depleted · mode ${state.mode || 'unknown'}`,
      _raw: { energy: state.energy },
    })
  }

  // Follow-ups
  const today = new Date()
  today.setHours(0, 0, 0, 0)
  const overdueFu = followUps.filter(f => {
    if (!f.due) return false
    const d = new Date(f.due)
    if (isNaN(d.getTime())) return false
    d.setHours(0, 0, 0, 0)
    return d < today && (f.status || '').toLowerCase() !== 'done'
  }).sort((a, b) => new Date(a.due) - new Date(b.due))

  for (const fu of overdueFu) {
    const daysOverdue = Math.round((today - new Date(fu.due)) / (1000 * 60 * 60 * 24))
    let urgency = 'normal'
    if (daysOverdue >= 15) urgency = 'critical'
    else if (daysOverdue >= 8) urgency = 'urgent'
    else if (daysOverdue >= 3) urgency = 'warning'

    candidates.push({
      type: 'followup',
      leg: 'capacity',
      urgency,
      label: `${fu.person} — ${(fu.topic || '').slice(0, 60)}`,
      context: `${daysOverdue} days overdue`,
      _raw: { person: fu.person, topic: fu.topic, due: fu.due },
    })
  }

  return candidates
}

function buildExpansionCandidates(allData) {
  const candidates = []
  const state = allData.state || {}
  const buildBlocks = allData.buildBlocks || []
  const patterns = allData.patterns || {}
  const signals = allData.metrics?._signals || []
  const pipeline = Array.isArray(allData.pipeline) ? allData.pipeline : []

  // Weekly targets (unchecked)
  const targets = (state.weeklyTargets || []).filter(t => !t.checked)
  for (const t of targets) {
    candidates.push({
      type: 'target',
      leg: 'expansion',
      urgency: 'normal',
      label: t.text,
      context: 'This week',
      _raw: { text: t.text },
    })
  }

  // BUILD blocks (next 24h)
  for (const b of buildBlocks) {
    candidates.push({
      type: 'build_block',
      leg: 'expansion',
      urgency: b.hoursUntil <= 2 ? 'urgent' : 'normal',
      label: b.title,
      context: `in ${b.hoursUntil}h · ${b.duration} min`,
      _raw: b,
    })
  }

  // Cadence (day-of-week)
  const dow = new Date().getDay()
  if (dow === 6) {
    candidates.push({
      type: 'cadence', leg: 'expansion', urgency: 'normal',
      label: 'Write list email', context: 'Saturday ritual',
      _raw: { ritual: 'list-email' },
    })
  }
  if (dow === 0) {
    candidates.push({
      type: 'cadence', leg: 'expansion', urgency: 'normal',
      label: 'Weekly review', context: 'Sunday ritual',
      _raw: { ritual: 'weekly-review' },
    })
  }

  // Growth edges
  const c2 = signals[4]
  if (patterns.tensions?.length) {
    for (const t of patterns.tensions) {
      if (t.days < 3) continue
      candidates.push({
        type: 'growth_edge',
        leg: 'expansion',
        urgency: t.days >= 7 ? 'urgent' : 'warning',
        label: `Growth edge: ${t.label}`,
        context: `${t.days} days alive`,
        _raw: t,
      })
    }
  } else if (c2 === 'yellow' || c2 === 'red') {
    candidates.push({
      type: 'growth_edge',
      leg: 'expansion',
      urgency: c2 === 'red' ? 'urgent' : 'warning',
      label: 'Untouched edge',
      context: `Capacity → Depth ${c2}`,
      _raw: { signal: 'C2', color: c2 },
    })
  }

  // Pipeline (overdue only)
  for (const deal of pipeline) {
    if (!deal.due_date) continue
    const due = new Date(deal.due_date)
    const today = new Date()
    today.setHours(0, 0, 0, 0)
    if (due >= today) continue
    candidates.push({
      type: 'pipeline',
      leg: 'expansion',
      urgency: 'urgent',
      label: `${deal.person} — ${(deal.next_action || '').slice(0, 60)}`,
      context: `Overdue · $${deal.amount}`,
      _raw: deal,
    })
  }

  return candidates
}

// Local scoring helpers — mirror src/synthesizer.js but inline for renderer
function computeWeakestLeg(signals) {
  const score = (c) => c === 'green' ? 2 : c === 'yellow' ? 1 : 0
  const a = signals[0] && signals[1] && signals[2] ? score(signals[0]) + score(signals[1]) + score(signals[2]) : 6
  const c = signals[3] && signals[4] && signals[5] ? score(signals[3]) + score(signals[4]) + score(signals[5]) : 6
  const e = signals[6] && signals[7] && signals[8] ? score(signals[6]) + score(signals[7]) + score(signals[8]) : 6
  if (a <= c && a <= e) return 'authority'
  if (c <= e) return 'capacity'
  return 'expansion'
}

function computeLeverageScore(item, ctx) {
  let score = 0
  const focus = ctx.dailyFocus || []
  for (const f of focus) {
    const fLow = (f || '').toLowerCase()
    if (item.label && fLow.includes(item.label.toLowerCase().slice(0, 20))) { score += 5; break }
    if (item._raw?.person && fLow.includes(item._raw.person.toLowerCase())) { score += 5; break }
  }
  if (item.leg && item.leg === ctx.weakestLeg) score += 3
  if (item.urgency === 'critical' || item.urgency === 'urgent') score += 2
  else score += 1
  return score
}

// Cockpit-refresh — re-render dashboard after card actions
window.addEventListener('cockpit-refresh', () => {
  loadDashboard()
})

// Wire dock "Add instrument" tile — one-time delegation
document.addEventListener('click', (e) => {
  const addTile = e.target.closest('.dock-tile-add')
  if (!addTile) return
  alert("Operator Dock — coming soon.\n\nTier 1: built-in tiles (analytics, pipeline, content queue, today's calendar).\nTier 2: your custom ACE skills as tiles.\nTier 3: drag-and-drop reorder, resize, and visibility.\n\nFor now, this zone reserves the space.")
})

export { loadDashboard, getLayout, initDashClickables }
