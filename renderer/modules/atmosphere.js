// renderer/modules/atmosphere.js
// Somatic atmosphere — session tracking, intensity bar, nudge strip.
// Design doc: docs/plans/2026-04-03-somatic-atmosphere-infusion-design.md

import { state } from '../state.js'
import { initCoherence, coherenceState, onCoherenceUpdate } from './coherence.js'

// ── Constants ──
const TICK_MS = 60_000  // update every minute
const NUDGE_ACTIVE_MIN = 45     // active minutes before "breathe" nudge
const NUDGE_SESSIONS = 5        // real work blocks before "pause" nudge
const NUDGE_HOUR = 22           // 10pm
const IDLE_PAUSE_MS = 8 * 60_000    // 8 min — pause clock
const IDLE_END_MS = 30 * 60_000     // 30 min — auto-close session
const BREATH_REDUCTION = 0.05       // intensity reduction per completed protocol
const BREATH_REDUCTION_CAP = 0.15   // max total breath reduction
const CROSSFADE_MS = 30_000  // 30s frequency transitions

// ── Coherence color map ──
const COHERENCE_COLORS = {
  low:  { r: 224, g: 112, b: 128 },  // warm rose
  med:  { r: 96,  g: 216, b: 168 },  // capacity green
  high: { r: 255, g: 209, b: 102 },  // soft gold
}
let coherenceCurrentColor = { r: 140, g: 120, b: 255 }  // default purple
let coherenceTargetColor = { r: 140, g: 120, b: 255 }
let coherenceAnimFrame = null

// ── Somatic bar content pools ──
const POOL_LOW = [
  'what wants to move through you today?',
  'the space between thoughts is where clarity lives',
  'you don\'t need to know the whole path \u2014 just the next step',
  'creation begins before the first keystroke',
  'what would you build if nothing was urgent?',
  'settle in \u2014 the work will meet you where you are',
  'the quieter you become, the more you can hear',
  'presence is the first act of authority',
  'what are you choosing right now?',
  'start from stillness, not from speed',
  'your attention is the most valuable thing in this room',
  'depth over velocity',
  'the container shapes what can emerge',
  'begin before you\'re ready \u2014 readiness is a myth',
  'what\'s the simplest true thing right now?',
]
const POOL_MID = [
  'the body remembers what the mind skips over',
  'notice where you\'re holding tension right now',
  'you\'ve been building \u2014 check in with your shoulders',
  'the rhythm you set now carries you through the afternoon',
  'you don\'t have to finish everything today',
  'a pause is not a stop',
  'how\'s your breathing?',
  'sustainable pace is a form of self-respect',
  'the work isn\'t going anywhere \u2014 but your energy is',
  'unclench your jaw',
  'good work comes from a regulated body',
  'you\'re already further than you think',
  'what can you release right now?',
  'depth requires rest between sets',
  'the signal is in your body, not your inbox',
]
const POOL_HIGH = [
  'you\'ve been here a while \u2014 how\'s your breathing?',
  'diminishing returns are silent \u2014 they just feel like effort',
  'the most productive thing you can do right now might be stopping',
  'your body has been asking for something \u2014 what is it?',
  'rest is not the absence of work \u2014 it\'s the completion of it',
  'what would closing this session make space for?',
  'you\'ve done enough to call this a good day',
  'the screen will be here tomorrow \u2014 will your energy?',
  'sovereignty means knowing when to stop',
  'this is the part where you choose yourself',
  'one breath can reset more than you think',
  'the work you do after exhaustion isn\'t your best work',
  'you\'ve earned the right to step away',
  'let the last hour be for you, not the machine',
  'the body keeps the score \u2014 and it\'s been counting',
]
const BAND_THRESHOLDS = [0.33, 0.66]
const FALLBACK_REFRESH_MS = 30 * 60_000  // 30 minutes

// ── Somatic Bar State ──
let currentBand = -1       // 0=low, 1=mid, 2=high
let lastRefreshTime = 0    // timestamp of last text change

function getBand(intensity) {
  if (intensity < BAND_THRESHOLDS[0]) return 0
  if (intensity < BAND_THRESHOLDS[1]) return 1
  return 2
}

function getPool(band) {
  return [POOL_LOW, POOL_MID, POOL_HIGH][band]
}

function pickRandom(pool) {
  return pool[Math.floor(Math.random() * pool.length)]
}

function updateSomaticBarText(text) {
  const el = document.getElementById('somatic-bar-text')
  if (!el) return
  // Crossfade: fade out, swap, fade in
  el.style.opacity = '0'
  setTimeout(() => {
    el.textContent = text
    el.style.opacity = ''  // returns to CSS default (0.45)
  }, 750)
}

function renderSomaticBar() {
  const bar = document.getElementById('somatic-bar')
  const breathBg = document.getElementById('somatic-bar-breath')
  if (!bar || !breathBg) return

  const { intensity } = state.atmosphere
  const isLight = state.theme === 'light'

  // Violet accent — radial gradient for soft bloom edges
  breathBg.style.background = isLight
    ? 'radial-gradient(circle, rgba(90, 72, 192, 0.7) 0%, rgba(90, 72, 192, 0) 65%)'
    : 'radial-gradient(circle, rgba(140, 120, 255, 0.35) 0%, rgba(140, 120, 255, 0) 70%)'

  // Check for band crossing
  const band = getBand(intensity)
  const now = Date.now()

  if (band !== currentBand) {
    currentBand = band
    lastRefreshTime = now
    updateSomaticBarText(pickRandom(getPool(band)))
  } else if (now - lastRefreshTime >= FALLBACK_REFRESH_MS) {
    lastRefreshTime = now
    updateSomaticBarText(pickRandom(getPool(band)))
  }
}

// Solfeggio frequencies — research-backed (Akimoto et al. 2018)
const SOLFEGGIO = {
  calm:   { freq: 174, label: 'Calm · 174 Hz',   desc: 'Evening, before sleep, when activated' },
  ground: { freq: 396, label: 'Ground · 396 Hz', desc: 'Morning start, after disruption, scattered' },
  focus:  { freq: 528, label: 'Focus · 528 Hz',  desc: 'Deep work, writing, building' },
}
// Binaural offsets — Garcia-Argibay et al. 2019
const BINAURAL = {
  rest:    { offset: 4,  band: 'theta', label: 'Deep Rest · 4 Hz',      desc: 'Late night, deep relaxation' },
  reflect: { offset: 6,  band: 'theta', label: 'Reflection · 6 Hz',     desc: 'Journaling, coaching, integration' },
  relaxed: { offset: 10, band: 'alpha', label: 'Relaxed Focus · 10 Hz', desc: 'Reading, reviewing, calm attention' },
  active:  { offset: 14, band: 'beta',  label: 'Active Focus · 14 Hz',  desc: 'Building, coding, problem solving' },
}
const AUTO_SOL_MAP = { morning: 'ground', afternoon: 'focus', evening: 'calm', late: 'calm' }

// ── Helpers ──
function clamp(v, lo, hi) { return Math.max(lo, Math.min(hi, v)) }

// ── Activity Detection ──
const ACTIVITY_EVENTS = ['mousemove', 'keydown', 'click', 'scroll', 'wheel']

function initActivityListeners() {
  for (const evt of ACTIVITY_EVENTS) {
    window.addEventListener(evt, onActivity, { passive: true })
  }
  // Catch app returning from background (setInterval may be throttled while hidden)
  document.addEventListener('visibilitychange', () => {
    if (!document.hidden) {
      // App just became visible — check idle gap before resuming
      checkIdleState()
    }
  })
}

function onActivity() {
  const a = state.atmosphere
  const now = Date.now()
  const wasEnded = a.activityState === 'ended'
  const wasPaused = a.activityState === 'paused'

  // Before resetting lastActivity, check if we were idle long enough to auto-close
  // (covers case where setInterval was throttled while app was backgrounded)
  if (!wasEnded && !wasPaused) {
    const idleMs = now - a.lastActivity
    if (idleMs >= IDLE_END_MS) {
      endSession()
      // Now we're ended, fall through to fresh session start below
      return onActivity()
    } else if (idleMs >= IDLE_PAUSE_MS) {
      a.activityState = 'paused'
      // Fall through to resume below
    }
  }

  a.lastActivity = now

  if (wasEnded || a.activityState === 'ended') {
    // New session starting after auto-close or /close
    a.sessionActiveMin = 0
    a.nudgeFired = false
    a.nudgeDismissed = false
    a.activityState = 'active'
    return
  }

  a.activityState = 'active'
}

function checkIdleState() {
  const a = state.atmosphere
  if (a.activityState === 'ended') return

  const idleMs = Date.now() - a.lastActivity

  if (idleMs >= IDLE_END_MS) {
    endSession()
  } else if (idleMs >= IDLE_PAUSE_MS) {
    a.activityState = 'paused'
  }
}

function endSession() {
  const a = state.atmosphere
  if (a.activityState === 'ended') return
  a.completedSessions += 1
  a.activityState = 'ended'
  persistAtmosphere()
}

// Called by session-manager when /close skill is detected in chat stream
export function onSessionClose() {
  endSession()
}

// Called by breath.js when a protocol reaches its target cycle count
export function onBreathComplete() {
  const a = state.atmosphere
  a.completedProtocols += 1
  a.intensity = computeIntensity()
  renderIntensityBar()
  renderSomaticBar()
  persistAtmosphere()
}

function persistAtmosphere() {
  const a = state.atmosphere
  window.ace?.setup?.patchConfig({
    atmosphere: {
      sessions: a.completedSessions,
      activeTotal: a.totalActiveMin,
      breathCompleted: a.completedProtocols,
      date: new Date().toDateString(),
    }
  })
}

function getTimeOfDay() {
  const h = new Date().getHours()
  if (h >= 5 && h < 12) return 'morning'
  if (h >= 12 && h < 17) return 'afternoon'
  if (h >= 17 && h < 22) return 'evening'
  return 'late'
}

function computeIntensity() {
  const a = state.atmosphere
  const sessionCount = a.completedSessions + (a.activityState !== 'ended' ? 1 : 0)
  const baseLoad =
    (a.totalActiveMin / 360) * 0.45 +
    (Math.min(a.sessionActiveMin, 60) / 60) * 0.35 +
    (Math.min(sessionCount, 6) / 6) * 0.20
  const breathReduction = Math.min(a.completedProtocols * BREATH_REDUCTION, BREATH_REDUCTION_CAP)
  return clamp(baseLoad - breathReduction, 0, 1)
}

function intensityColor(t) {
  // 0=green(155) → 0.5=amber(35) → 1.0=rose(345)
  if (t < 0.5) {
    const p = t / 0.5
    return { h: 155 - p * 120, s: 55 + p * 10, l: 48 + p * 4 }
  }
  const p = (t - 0.5) / 0.5
  return { h: 35 - p * 50, s: 65 - p * 5, l: 52 + p * 3 }
}

// ── Intensity Bar ──
function renderIntensityBar() {
  const bar = document.getElementById('atm-intensity-fill')
  const glow = document.getElementById('atm-intensity-glow')
  if (!bar) return

  const { intensity } = state.atmosphere
  const c = intensityColor(intensity)
  const hsl = `hsl(${c.h}, ${c.s}%, ${c.l}%)`
  const hsla = (a) => `hsla(${c.h}, ${c.s}%, ${c.l}%, ${a})`

  bar.style.width = (intensity * 100) + '%'
  bar.style.background = `linear-gradient(90deg, ${hsla(0.6)}, ${hsl})`
  bar.style.boxShadow = `0 0 ${4 + intensity * 8}px ${hsla(0.3)}`

  if (glow) {
    glow.style.background = hsl
    glow.style.opacity = intensity > 0.5 ? 0.08 + (intensity - 0.5) * 0.2 : intensity * 0.08
  }

  // Icon color tracks intensity
  const isLight = state.theme === 'light'
  const icon = document.querySelector('.atm-intensity-icon')
  if (icon) {
    const iconColor = isLight ? `hsl(${c.h}, ${c.s - 10}%, ${c.l - 15}%)` : hsl
    icon.style.color = intensity > 0.05 ? iconColor : ''
    icon.style.opacity = intensity > 0.05 ? 0.6 + intensity * 0.3 : 0.4
  }

  // Gentle pulse at high intensity — subtle at 75%, noticeable at 90%+
  const wrap = document.getElementById('atm-intensity-wrap')
  if (wrap) {
    if (intensity >= 0.9) {
      wrap.style.animation = 'atm-bar-pulse 1.8s ease-in-out infinite'
    } else if (intensity >= 0.75) {
      wrap.style.animation = 'atm-bar-pulse-soft 3s ease-in-out infinite'
    } else {
      wrap.style.animation = ''
    }
  }

  renderDetailCard()
}

// ── Intensity Detail Card ──
let detailOpen = false
let detailPinned = false
let hoverTimeout = null
let streamTimeout = null

function openDetailCard() {
  if (detailOpen) return
  detailOpen = true
  renderDetailCard()
  const card = document.getElementById('atm-detail-card')
  if (!card) return
  card.offsetHeight
  card.classList.add('visible')
}

function pinDetailCard() {
  detailPinned = true
  const overlay = document.getElementById('atm-detail-overlay')
  const card = document.getElementById('atm-detail-card')
  if (overlay) overlay.classList.add('visible')
  if (card) card.classList.add('pinned')
  runAnalysis()
}

function closeDetailCard() {
  detailOpen = false
  detailPinned = false
  const overlay = document.getElementById('atm-detail-overlay')
  const card = document.getElementById('atm-detail-card')
  if (overlay) overlay.classList.remove('visible')
  if (card) card.classList.remove('visible', 'pinned')
  const textEl = document.getElementById('atm-detail-analysis-text')
  const loading = document.getElementById('atm-detail-loading')
  const howBody = document.getElementById('atm-detail-howlink-body')
  const howToggle = document.getElementById('atm-detail-howlink-toggle')
  if (textEl) textEl.innerHTML = ''
  if (loading) loading.style.display = 'flex'
  if (howBody) howBody.classList.remove('visible')
  if (howToggle) howToggle.textContent = 'How does this work?'
  if (streamTimeout) { clearTimeout(streamTimeout); streamTimeout = null }
}

function scheduleClose() {
  if (detailPinned) return
  hoverTimeout = setTimeout(closeDetailCard, 150)
}

function cancelClose() {
  if (hoverTimeout) { clearTimeout(hoverTimeout); hoverTimeout = null }
}

function renderDetailCard() {
  if (!detailOpen) return
  const a = state.atmosphere
  const { intensity } = a
  const c = intensityColor(intensity)
  const hsl = `hsl(${c.h}, ${c.s}%, ${c.l}%)`
  const pct = Math.round(intensity * 100)
  const feel = pct < 20 ? 'Fresh' : pct < 45 ? 'Active' : pct < 70 ? 'Warm' : 'Heavy'

  const sessionCount = a.completedSessions + (a.activityState !== 'ended' ? 1 : 0)
  const totalMin = a.totalActiveMin
  const h = Math.floor(totalMin / 60)
  const m = totalMin % 60
  const timeStr = h > 0 ? `${h}h ${m}m` : `${m}m`

  const feelEl = document.getElementById('atm-detail-feel')
  const pctEl = document.getElementById('atm-detail-pct')
  const summaryEl = document.getElementById('atm-detail-summary')
  if (feelEl) { feelEl.textContent = feel; feelEl.style.color = hsl }
  if (pctEl) pctEl.textContent = pct + '%'
  if (summaryEl) summaryEl.textContent = `${sessionCount} session${sessionCount !== 1 ? 's' : ''} \u00b7 ${timeStr} active`

  const accent = document.getElementById('atm-detail-accent')
  if (accent) accent.style.background = `linear-gradient(90deg, ${hsl}, transparent)`

  const dayRaw = a.totalActiveMin / 360
  const sessionRaw = Math.min(a.sessionActiveMin, 60) / 60
  const countRaw = Math.min(sessionCount, 6) / 6

  const dayBar = document.getElementById('atm-detail-day')
  const sessionBar = document.getElementById('atm-detail-session')
  const countBar = document.getElementById('atm-detail-count')

  if (dayBar) { dayBar.style.width = (clamp(dayRaw, 0, 1) * 100) + '%'; dayBar.style.background = hsl }
  if (sessionBar) { sessionBar.style.width = (clamp(sessionRaw, 0, 1) * 100) + '%'; sessionBar.style.background = hsl }
  if (countBar) { countBar.style.width = (clamp(countRaw, 0, 1) * 100) + '%'; countBar.style.background = hsl }

  // Populate actual values next to mini bars
  const dayValEl = document.getElementById('atm-detail-day-val')
  const sessionValEl = document.getElementById('atm-detail-session-val')
  const countValEl = document.getElementById('atm-detail-count-val')
  if (dayValEl) {
    const dh = Math.floor(a.totalActiveMin / 60)
    const dm = a.totalActiveMin % 60
    dayValEl.textContent = dh > 0 ? `${dh}h ${dm}m` : `${dm}m`
  }
  if (sessionValEl) sessionValEl.textContent = `${a.sessionActiveMin}m`
  if (countValEl) countValEl.textContent = `${sessionCount}`

  const breathRow = document.getElementById('atm-detail-breath-row')
  const breathBar = document.getElementById('atm-detail-breath')
  const breathVal = document.getElementById('atm-detail-breath-val')
  const breathReduction = Math.min(a.completedProtocols * BREATH_REDUCTION, BREATH_REDUCTION_CAP)
  if (breathRow) {
    if (breathReduction > 0) {
      breathRow.classList.add('visible')
      if (breathBar) breathBar.style.width = (breathReduction / BREATH_REDUCTION_CAP * 100) + '%'
      if (breathVal) breathVal.textContent = '\u2212' + Math.round(breathReduction * 100) + '%'
    } else {
      breathRow.classList.remove('visible')
    }
  }

  const breatheBtn = document.getElementById('atm-detail-breathe-btn')
  if (breatheBtn) breatheBtn.style.borderColor = `hsla(${c.h}, ${c.s}%, ${c.l}%, 0.25)`
}

// ── AI Energy Analysis ──
function runAnalysis() {
  const loading = document.getElementById('atm-detail-loading')
  const textEl = document.getElementById('atm-detail-analysis-text')
  if (!textEl || !loading) return
  textEl.innerHTML = ''
  loading.style.display = 'flex'

  // Fallback: templated analysis with simulated streaming
  setTimeout(() => {
    loading.style.display = 'none'
    const analysis = generateFallbackAnalysis()
    let i = 0
    function streamNext() {
      if (i >= analysis.length || !detailPinned) return
      const chunk = Math.min(Math.floor(Math.random() * 3) + 2, analysis.length - i)
      textEl.innerHTML = analysis.slice(0, i + chunk) + '<span class="cursor"></span>'
      i += chunk
      if (i >= analysis.length) {
        textEl.innerHTML = analysis
      } else {
        streamTimeout = setTimeout(streamNext, 18 + Math.random() * 12)
      }
    }
    streamNext()
  }, 600)
}

function generateFallbackAnalysis() {
  const a = state.atmosphere
  const intensity = a.intensity
  const pct = Math.round(intensity * 100)
  const sessionCount = a.completedSessions + (a.activityState !== 'ended' ? 1 : 0)
  const breathReduction = Math.min(a.completedProtocols * BREATH_REDUCTION, BREATH_REDUCTION_CAP)

  const dayRaw = a.totalActiveMin / 360
  const sessionRaw = Math.min(a.sessionActiveMin, 60) / 60
  const countRaw = Math.min(sessionCount, 6) / 6

  const drivers = [
    { name: 'day total', val: dayRaw * 0.45 },
    { name: 'session depth', val: sessionRaw * 0.35 },
    { name: 'session count', val: countRaw * 0.20 }
  ].sort((a, b) => b.val - a.val)
  const top = drivers[0]

  let text = ''

  if (pct < 15) {
    text += "You're starting fresh. Your system is rested and ready for deep work. "
    text += "This is your highest-leverage window \u2014 use it for the thing that matters most today."
  } else if (pct < 35) {
    text += "You're in a good rhythm. "
    if (top.name === 'session depth') {
      text += `Your current session (${a.sessionActiveMin}m) is the primary driver. `
      text += "You've got runway \u2014 this is the zone where deep focus happens."
    } else {
      text += `${sessionCount} session${sessionCount !== 1 ? 's' : ''} across ${a.totalActiveMin} minutes \u2014 `
      text += "building momentum without burning reserves."
    }
  } else if (pct < 60) {
    text += `Your energy is warm \u2014 ${top.name} is carrying most of the load. `
    if (top.name === 'session depth') {
      text += `${a.sessionActiveMin} minutes without a break. `
      text += "A 5-minute pause would extend your afternoon capacity."
    } else if (top.name === 'day total') {
      text += `${Math.floor(a.totalActiveMin / 60)}+ hours active. `
      text += "Save harder thinking for earlier in the window."
    } else {
      text += `${sessionCount} sessions is a lot of context-switching. `
      text += "Make the next one longer and uninterrupted."
    }
  } else if (pct < 80) {
    text += "You're running heavy. "
    if (top.name === 'session depth') {
      text += `${a.sessionActiveMin} minutes in one session \u2014 your body is likely holding tension. `
      text += "A breath protocol would drop your intensity right now."
    } else if (top.name === 'day total') {
      text += `${Math.floor(a.totalActiveMin / 60)} hours cumulative. `
      text += "Your remaining capacity is finite \u2014 make it count."
    } else {
      text += `${sessionCount} sessions \u2014 attention fragmented. `
      text += "Close something. Next session should be a single thread."
    }
  } else {
    text += "You're overextended. "
    text += `${Math.floor(a.totalActiveMin / 60)} hours, ${sessionCount} sessions, ${a.sessionActiveMin}m in this one. `
    text += "Your system is telling you to stop. Not pause \u2014 stop."
  }

  if (breathReduction > 0) {
    text += ` Your ${a.completedProtocols} breath protocol${a.completedProtocols > 1 ? 's' : ''} bought back ${Math.round(breathReduction * 100)}% \u2014 that's regulation working.`
  } else if (pct > 40) {
    text += " No breath work today \u2014 even one protocol would take the edge off."
  }

  return text
}

// ── Somatic Bar Nudge ──
function checkNudge() {
  const a = state.atmosphere
  if (a.nudgeFired || a.nudgeDismissed) return

  const hour = new Date().getHours()
  let word = null

  const sessionCount = a.completedSessions + (a.activityState !== 'ended' ? 1 : 0)
  if (a.sessionActiveMin >= NUDGE_ACTIVE_MIN) word = 'breathe'
  else if (sessionCount >= NUDGE_SESSIONS) word = 'pause'
  else if (hour >= NUDGE_HOUR) word = 'rest'

  if (!word) return

  a.nudgeFired = true
  const bar = document.getElementById('somatic-bar')
  if (!bar) return

  // Two-beat reveal: glow first, then word
  const glowEl = document.getElementById('somatic-bar-glow')
  const isLight = state.theme === 'light'
  if (glowEl && !state.coherenceConnected) {  // coherence owns the glow when connected
    glowEl.style.background = isLight
      ? 'radial-gradient(circle, rgba(90, 72, 192, 0.8) 0%, rgba(90, 72, 192, 0) 65%)'
      : 'radial-gradient(circle, rgba(140, 120, 255, 0.45) 0%, rgba(140, 120, 255, 0) 70%)'
  }
  bar.classList.add('nudge-active')

  // After 1s, crossfade text to nudge word
  setTimeout(() => {
    updateSomaticBarText(word)
  }, 1000)

  audioNudgeShift()
}

function dismissNudge() {
  state.atmosphere.nudgeDismissed = true
  const bar = document.getElementById('somatic-bar')
  if (bar) bar.classList.remove('nudge-active')
  // Restore ambient text
  const band = getBand(state.atmosphere.intensity)
  updateSomaticBarText(pickRandom(getPool(band)))
}

function nudgeClick() {
  dismissNudge()
  const breathNav = document.querySelector('[data-view="breath"]')
  if (breathNav) breathNav.click()
}

// ── Coherence: rhythm strip rendering ──

let rsCanvas = null
let rsCtx = null
let RS_W = 0, RS_H = 0

function initCoherenceBar() {
  rsCanvas = document.getElementById('somatic-bar-rhythm')
  if (!rsCanvas) return
  rsCtx = rsCanvas.getContext('2d')
  sizeRhythmCanvas()
  window.addEventListener('resize', sizeRhythmCanvas)

  onCoherenceUpdate(handleCoherenceUpdate)
  coherenceAnimLoop()
}

function sizeRhythmCanvas() {
  if (!rsCanvas || !rsCanvas.parentElement) return
  const rect = rsCanvas.parentElement.getBoundingClientRect()
  RS_W = rect.width
  RS_H = rect.height
  rsCanvas.width = RS_W * 2
  rsCanvas.height = RS_H * 2
  rsCtx.setTransform(2, 0, 0, 2, 0, 0)
}

function handleCoherenceUpdate(cs) {
  const strip = document.getElementById('somatic-bar-rhythm')
  const hrEl = document.getElementById('somatic-bar-hr')
  const hrVal = document.getElementById('somatic-bar-hr-value')
  const hrDot = document.getElementById('somatic-bar-hr-dot')
  const hrLevel = document.getElementById('somatic-bar-hr-level')
  const barText = document.getElementById('somatic-bar-text')
  const glowEl = document.getElementById('somatic-bar-glow')

  if (!strip) return

  state.coherenceConnected = cs.connected

  // Status dot state
  if (hrDot) {
    hrDot.classList.remove('scanning', 'connected')
    if (cs.connected) hrDot.classList.add('connected')
    else if (cs.scanning) hrDot.classList.add('scanning')
  }

  if (cs.connected) {
    strip.classList.add('active')
    if (hrEl) hrEl.classList.add('visible')
    if (barText) barText.classList.add('coherence-hidden')
    if (hrVal) { hrVal.textContent = cs.hr || '—'; hrVal.classList.remove('somatic-bar-hr-connecting') }
    // Coherence level word
    const LEVEL_WORDS = { low: 'low', med: 'coherent', high: 'deep' }
    if (hrLevel && cs.coherenceLevel) {
      hrLevel.textContent = LEVEL_WORDS[cs.coherenceLevel] || ''
      hrLevel.className = 'somatic-bar-hr-level ' + cs.coherenceLevel
    } else if (hrLevel) {
      hrLevel.textContent = ''
    }
    // Update glow color target
    if (cs.coherenceLevel && COHERENCE_COLORS[cs.coherenceLevel]) {
      coherenceTargetColor = { ...COHERENCE_COLORS[cs.coherenceLevel] }
    }
    // Set glow
    if (glowEl) {
      const c = coherenceCurrentColor
      const intensity = cs.coherence || 0
      glowEl.style.background = `radial-gradient(ellipse at center, rgba(${c.r|0},${c.g|0},${c.b|0},${0.06 + intensity * 0.2}) 0%, rgba(${c.r|0},${c.g|0},${c.b|0},0.02) 50%, transparent 75%)`
    }
  } else if (cs.scanning) {
    // Bridge running, sensor not found yet — show connecting state
    strip.classList.remove('active')
    if (hrEl) hrEl.classList.add('visible')
    if (hrVal) { hrVal.textContent = 'connecting'; hrVal.classList.add('somatic-bar-hr-connecting') }
    if (hrLevel) hrLevel.textContent = ''
    if (barText) barText.classList.add('coherence-hidden')
  } else {
    strip.classList.remove('active')
    if (hrEl) hrEl.classList.remove('visible')
    if (hrLevel) hrLevel.textContent = ''
    if (barText) barText.classList.remove('coherence-hidden')
    // Hand glow back to atmosphere
    if (glowEl) glowEl.style.background = ''
  }
}

function drawRhythmStrip() {
  if (!rsCtx || RS_W === 0) return
  rsCtx.clearRect(0, 0, RS_W, RS_H)

  const buf = coherenceState.rrStrip
  if (!coherenceState.connected || buf.length < 3) return

  // Lerp color
  coherenceCurrentColor.r += (coherenceTargetColor.r - coherenceCurrentColor.r) * 0.02
  coherenceCurrentColor.g += (coherenceTargetColor.g - coherenceCurrentColor.g) * 0.02
  coherenceCurrentColor.b += (coherenceTargetColor.b - coherenceCurrentColor.b) * 0.02

  const c = coherenceCurrentColor
  const min = Math.min(...buf)
  const max = Math.max(...buf)
  const range = Math.max(max - min, 40)
  const padY = 6
  const padX = 60

  // Build smooth curve points
  const points = []
  for (let i = 0; i < buf.length; i++) {
    const x = padX + (i / 79) * (RS_W - padX * 2)  // 80 = max strip length
    const normalized = (buf[i] - min) / range
    const y = RS_H - padY - normalized * (RS_H - padY * 2)
    points.push({ x, y })
  }

  // Draw smooth quadratic bezier curve
  rsCtx.beginPath()
  rsCtx.moveTo(points[0].x, points[0].y)
  for (let i = 0; i < points.length - 1; i++) {
    const cpx = (points[i].x + points[i + 1].x) / 2
    const cpy = (points[i].y + points[i + 1].y) / 2
    rsCtx.quadraticCurveTo(points[i].x, points[i].y, cpx, cpy)
  }
  const last = points[points.length - 1]
  rsCtx.lineTo(last.x, last.y)

  // Stroke — brightness scales with coherence
  const lineAlpha = 0.2 + (coherenceState.coherence || 0) * 0.35
  rsCtx.strokeStyle = `rgba(${c.r|0},${c.g|0},${c.b|0},${lineAlpha})`
  rsCtx.lineWidth = 1.3
  rsCtx.lineJoin = 'round'
  rsCtx.lineCap = 'round'
  rsCtx.stroke()

  // Subtle fill under curve
  rsCtx.lineTo(last.x, RS_H)
  rsCtx.lineTo(points[0].x, RS_H)
  rsCtx.closePath()
  const fillAlpha = 0.02 + (coherenceState.coherence || 0) * 0.04
  rsCtx.fillStyle = `rgba(${c.r|0},${c.g|0},${c.b|0},${fillAlpha})`
  rsCtx.fill()

  // Edge fade
  const edgeFade = rsCtx.createLinearGradient(0, 0, RS_W, 0)
  const bgColor = state.theme === 'light' ? '240,238,246' : '12,14,24'
  edgeFade.addColorStop(0, `rgba(${bgColor},1)`)
  edgeFade.addColorStop(0.08, `rgba(${bgColor},0)`)
  edgeFade.addColorStop(0.92, `rgba(${bgColor},0)`)
  edgeFade.addColorStop(1, `rgba(${bgColor},1)`)
  rsCtx.fillStyle = edgeFade
  rsCtx.fillRect(0, 0, RS_W, RS_H)
}

function coherenceAnimLoop() {
  drawRhythmStrip()
  coherenceAnimFrame = requestAnimationFrame(coherenceAnimLoop)
}

// ── Audio Engine (Web Audio API — pure synthesis, no files) ──
let audioCtx = null
let solOsc = null, solGain = null           // solfeggio oscillator
let binL = null, binR = null, binGain = null // binaural pair
let panL = null, panR = null

function ensureAudioCtx() {
  if (!audioCtx) audioCtx = new (window.AudioContext || window.webkitAudioContext)()
  if (audioCtx.state === 'suspended') audioCtx.resume()
  return audioCtx
}

function getTargetSolFreq() {
  const sol = state.atmosphere.audio.solfeggio
  if (sol === 'auto') return SOLFEGGIO[AUTO_SOL_MAP[state.atmosphere.timeOfDay]].freq
  return SOLFEGGIO[sol]?.freq || 0
}

function startSolfeggio(freq) {
  const ctx = ensureAudioCtx()
  const vol = state.atmosphere.audio.volume
  solGain = ctx.createGain()
  solGain.gain.setValueAtTime(0, ctx.currentTime)
  solGain.gain.linearRampToValueAtTime(vol, ctx.currentTime + 2)
  solGain.connect(ctx.destination)
  solOsc = ctx.createOscillator()
  solOsc.type = 'sine'
  solOsc.frequency.setValueAtTime(freq, ctx.currentTime)
  solOsc.connect(solGain)
  solOsc.start()
}

function stopSolfeggio() {
  if (!solOsc) return
  const ctx = audioCtx
  solGain.gain.linearRampToValueAtTime(0, ctx.currentTime + 2)
  const osc = solOsc, gain = solGain
  setTimeout(() => { osc.stop(); osc.disconnect(); gain.disconnect() }, 2500)
  solOsc = null; solGain = null
}

function crossfadeSolTo(freq, durationMs) {
  if (!solOsc || !audioCtx) return
  solOsc.frequency.linearRampToValueAtTime(freq, audioCtx.currentTime + durationMs / 1000)
}

function startBinaural(baseFreq, offset) {
  const ctx = ensureAudioCtx()
  const vol = state.atmosphere.audio.volume * 0.7
  binGain = ctx.createGain()
  binGain.gain.setValueAtTime(0, ctx.currentTime)
  binGain.gain.linearRampToValueAtTime(vol, ctx.currentTime + 2)
  binGain.connect(ctx.destination)

  panL = ctx.createStereoPanner(); panL.pan.value = -1
  panR = ctx.createStereoPanner(); panR.pan.value = 1
  panL.connect(binGain); panR.connect(binGain)

  binL = ctx.createOscillator(); binL.type = 'sine'
  binL.frequency.setValueAtTime(baseFreq - offset / 2, ctx.currentTime)
  binL.connect(panL); binL.start()

  binR = ctx.createOscillator(); binR.type = 'sine'
  binR.frequency.setValueAtTime(baseFreq + offset / 2, ctx.currentTime)
  binR.connect(panR); binR.start()
}

function stopBinaural() {
  if (!binL) return
  const ctx = audioCtx
  binGain.gain.linearRampToValueAtTime(0, ctx.currentTime + 2)
  const l = binL, r = binR, g = binGain, pl = panL, pr = panR
  setTimeout(() => { l.stop(); r.stop(); l.disconnect(); r.disconnect(); pl.disconnect(); pr.disconnect(); g.disconnect() }, 2500)
  binL = null; binR = null; binGain = null; panL = null; panR = null
}

function crossfadeBinTo(baseFreq, offset, durationMs) {
  if (!binL || !audioCtx) return
  const t = audioCtx.currentTime + durationMs / 1000
  binL.frequency.linearRampToValueAtTime(baseFreq - offset / 2, t)
  binR.frequency.linearRampToValueAtTime(baseFreq + offset / 2, t)
}

export function setSolfeggio(key) {
  const audio = state.atmosphere.audio
  const wasSol = audio.solfeggio
  audio.solfeggio = key
  localStorage.setItem('ace-atm-audio-sol', key)

  if (key === 'off') {
    stopSolfeggio()
  } else {
    const freq = getTargetSolFreq()
    if (!solOsc) startSolfeggio(freq)
    else crossfadeSolTo(freq, CROSSFADE_MS)
  }
  updateAudioMode()
  renderAudioIndicator()
}

export function setBinaural(key) {
  const audio = state.atmosphere.audio
  audio.binaural = key
  localStorage.setItem('ace-atm-audio-bin', key)

  if (key === 'off') {
    stopBinaural()
  } else {
    const baseFreq = getTargetSolFreq() || 396
    const offset = BINAURAL[key].offset
    if (!binL) startBinaural(baseFreq, offset)
    else crossfadeBinTo(baseFreq, offset, CROSSFADE_MS)
  }
  updateAudioMode()
  renderAudioIndicator()
}

function updateAudioMode() {
  const a = state.atmosphere.audio
  if (a.solfeggio !== 'off' || a.binaural !== 'off') a.mode = 'on'
  else a.mode = 'off'
  localStorage.setItem('ace-atm-audio-mode', a.mode)
}

function renderAudioIndicator() {
  const el = document.getElementById('atm-audio-label')
  if (!el) return
  const a = state.atmosphere.audio
  if (a.solfeggio === 'off' && a.binaural === 'off') {
    el.textContent = '♪ Off'
    el.parentElement.classList.remove('active')
    return
  }
  el.parentElement.classList.add('active')
  let label = ''
  if (a.solfeggio === 'auto') label = 'Auto'
  else if (a.solfeggio !== 'off') label = SOLFEGGIO[a.solfeggio].label.split(' · ')[0]
  if (a.binaural !== 'off') {
    const hz = BINAURAL[a.binaural].offset + 'Hz'
    label = label ? `${label} + ${hz} 🎧` : `${hz} 🎧`
  }
  el.textContent = label
}

// Audio responds to nudge — shift toward calm
export function audioNudgeShift() {
  if (!solOsc) return
  crossfadeSolTo(174, CROSSFADE_MS)
}

// Audio responds to breath view
export function audioBreathEnter() {
  if (!solOsc) return
  crossfadeSolTo(174, 5000)
  if (binL) crossfadeBinTo(174, 4, 5000) // theta for calming
}

export function audioBreathExit() {
  if (!solOsc) return
  const freq = getTargetSolFreq()
  crossfadeSolTo(freq, 5000)
  if (binL) {
    const binKey = state.atmosphere.audio.binaural
    if (binKey !== 'off') {
      crossfadeBinTo(freq, BINAURAL[binKey].offset, 5000)
    }
  }
}

// Popover toggle
export function toggleAudioPopover() {
  const pop = document.getElementById('atm-audio-popover')
  const ind = document.getElementById('atm-audio-indicator')
  if (!pop) return
  if (pop.classList.contains('open')) {
    pop.classList.remove('open')
  } else {
    // Position under the indicator
    if (ind) {
      const rect = ind.getBoundingClientRect()
      pop.style.right = (window.innerWidth - rect.right) + 'px'
    }
    pop.classList.add('open')
  }
}

function closeAudioPopover() {
  const pop = document.getElementById('atm-audio-popover')
  if (pop) pop.classList.remove('open')
}

function wireAudioPopover() {
  const indicator = document.getElementById('atm-audio-indicator')
  if (indicator) indicator.addEventListener('click', toggleAudioPopover)

  // Solfeggio buttons
  document.querySelectorAll('[data-sol]').forEach(btn => {
    btn.addEventListener('click', () => {
      setSolfeggio(btn.dataset.sol)
      closeAudioPopover()
    })
  })
  // Binaural buttons
  document.querySelectorAll('[data-bin]').forEach(btn => {
    btn.addEventListener('click', () => {
      setBinaural(btn.dataset.bin)
      closeAudioPopover()
    })
  })

  // Close on outside click
  document.addEventListener('click', (e) => {
    const pop = document.getElementById('atm-audio-popover')
    const ind = document.getElementById('atm-audio-indicator')
    if (pop?.classList.contains('open') && !pop.contains(e.target) && !ind?.contains(e.target)) {
      closeAudioPopover()
    }
  })
}

// ── CSS Atmosphere Variables (Phase 1C) ──
const TIME_HUE = { morning: 228, afternoon: 205, evening: 340, late: 265 }

function writeAtmosphereVars() {
  const a = state.atmosphere
  // Energy curve: 0-10min ramp to 0.3, 10-30min ramp to 1.0, plateau at 1.0
  // For simulation: also factor in totalActiveMin so reloads show the effect
  const sessionMin = a.sessionActiveMin
  const totalEnergy = clamp(a.totalActiveMin / 60 / 7, 0, 1)
  const currentEnergy = clamp(sessionMin <= 10 ? sessionMin / 10 * 0.3 : sessionMin <= 30 ? 0.3 + (sessionMin - 10) / 20 * 0.7 : 1, 0, 1)
  const energy = clamp(Math.max(currentEnergy, totalEnergy), 0, 1)
  const sessionCount = a.completedSessions + (a.activityState !== 'ended' ? 1 : 0)
  const sessionHeat = clamp((sessionCount - 1) / 6, 0, 1)
  const warmth = clamp(energy * 0.55 + sessionHeat * 0.45, 0, 1)

  const hue = TIME_HUE[a.timeOfDay] || 228
  const isEvening = a.timeOfDay === 'evening' || a.timeOfDay === 'late'
  const brightness = isEvening ? 1 - warmth * 0.12 : 1
  const edgeGlow = energy > 0.3 ? (energy - 0.3) / 0.7 : 0

  // Compute actual colors in JS (color-mix + calc in CSS is unreliable)
  // Hue shifts: low warmth = cool violet (260), mid = amber (35), high = hot rose (350)
  // Going amber→rose means going 35→0→350 (wrapping around), not 35→350 through blues
  let borderH
  if (warmth < 0.5) {
    borderH = 260 - (260 - 35) * (warmth / 0.5) // 260 → 35 (violet to amber)
  } else {
    borderH = 35 - (35 + 10) * ((warmth - 0.5) / 0.5) // 35 → -10 → wraps to 350 (amber to rose)
    if (borderH < 0) borderH += 360
  }
  const borderAlpha = 0.1 + warmth * 0.35
  const shadowAlpha = warmth * 0.15
  const shadowPx = warmth * 24
  const edgeAlpha = edgeGlow * 0.6
  const ambientAlpha = warmth * 0.12

  const r = document.documentElement.style
  r.setProperty('--atm-border-color', `hsla(${borderH}, 55%, 50%, ${borderAlpha})`)
  r.setProperty('--atm-shadow', `0 0 ${shadowPx}px hsla(${borderH}, 50%, 50%, ${shadowAlpha})`)
  r.setProperty('--atm-brightness', brightness.toFixed(3))
  r.setProperty('--atm-breath-speed', (3.5 - warmth * 2) + 's')
  r.setProperty('--atm-edge-color', `hsla(${borderH}, 55%, 55%, ${edgeAlpha})`)
  r.setProperty('--atm-edge-mid', `hsla(${borderH}, 55%, 55%, ${edgeAlpha * 0.5})`)
  r.setProperty('--atm-ambient', `hsla(${borderH}, 50%, 45%, ${ambientAlpha})`)

  // ACE mark glow — set directly to override shell.css box-shadow
  const mark = document.getElementById('sidebarMark')
  if (mark && warmth > 0.05) {
    const glowColor = `hsla(${borderH}, 55%, 55%, ${0.3 + warmth * 0.4})`
    const outerColor = `hsla(${borderH}, 50%, 50%, ${warmth * 0.15})`
    mark.style.boxShadow = `0 0 ${10 + warmth * 20}px ${glowColor}, 0 0 ${30 + warmth * 30}px ${outerColor}`
  } else if (mark) {
    mark.style.boxShadow = ''
  }
}

// ── Tick ──
let tickCount = 0

function tick() {
  const a = state.atmosphere
  tickCount += 1

  // Check idle state transitions
  checkIdleState()

  // Only increment active time when ACTIVE and app is visible
  if (a.activityState === 'active' && !document.hidden) {
    a.sessionActiveMin += 1
    a.totalActiveMin += 1
  }

  // Midnight rollover
  const today = new Date().toDateString()
  if (a._lastDate && a._lastDate !== today) {
    a.completedSessions = 0
    a.totalActiveMin = 0
    a.sessionActiveMin = 0
    a.completedProtocols = 0
    a.nudgeFired = false
    a.nudgeDismissed = false
    a._lastDate = today
    persistAtmosphere()
  }

  a.timeOfDay = getTimeOfDay()
  a.intensity = computeIntensity()

  // Persist every 5 ticks (~5 min)
  if (tickCount % 5 === 0) {
    persistAtmosphere()
  }

  renderIntensityBar()
  writeAtmosphereVars()
  renderSomaticBar()
  checkNudge()
}

// ── Init ──
export async function initAtmosphere() {
  const config = await window.ace?.setup?.getConfig() || {}
  const saved = config.atmosphere || {}
  const today = new Date().toDateString()
  const a = state.atmosphere

  // Detect old config format (used 'total' not 'activeTotal') and reset
  const isNewFormat = saved.activeTotal !== undefined || saved.breathCompleted !== undefined
  if (saved.date === today && isNewFormat) {
    a.completedSessions = saved.sessions || 0
    a.totalActiveMin = saved.activeTotal || 0
    a.completedProtocols = saved.breathCompleted || 0
  } else {
    a.completedSessions = 0
    a.totalActiveMin = 0
    a.completedProtocols = 0
  }

  // Track date for midnight rollover
  a._lastDate = today

  // Initial state
  a.activityState = 'active'
  a.lastActivity = Date.now()
  a.sessionActiveMin = 0
  a.timeOfDay = getTimeOfDay()
  a.intensity = computeIntensity()

  // Persist immediately
  persistAtmosphere()

  renderIntensityBar()
  renderSomaticBar()
  writeAtmosphereVars()

  // Wire somatic bar nudge click
  const somaticBar = document.getElementById('somatic-bar')
  if (somaticBar) {
    somaticBar.addEventListener('click', () => {
      if (state.atmosphere.nudgeFired && !state.atmosphere.nudgeDismissed) nudgeClick()
    })
  }

  // Wire detail card — hover to open, click to pin
  const wrap = document.getElementById('atm-intensity-wrap')
  if (wrap) {
    wrap.style.cursor = 'pointer'
    wrap.addEventListener('mouseenter', () => {
      cancelClose()
      if (!detailOpen) openDetailCard()
    })
    wrap.addEventListener('mouseleave', scheduleClose)
    wrap.addEventListener('click', () => {
      if (detailPinned) { closeDetailCard() }
      else { if (!detailOpen) openDetailCard(); pinDetailCard() }
    })
  }
  const detailCard = document.getElementById('atm-detail-card')
  const detailOverlay = document.getElementById('atm-detail-overlay')
  if (detailCard) {
    detailCard.addEventListener('mouseenter', cancelClose)
    detailCard.addEventListener('mouseleave', scheduleClose)
  }
  if (detailOverlay) {
    detailOverlay.addEventListener('click', closeDetailCard)
  }

  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && detailOpen) closeDetailCard()
  })

  const moreHint = document.getElementById('atm-detail-more-hint')
  if (moreHint) {
    moreHint.addEventListener('click', () => {
      if (!detailPinned) pinDetailCard()
    })
  }

  const howToggle = document.getElementById('atm-detail-howlink-toggle')
  const howBody = document.getElementById('atm-detail-howlink-body')
  if (howToggle && howBody) {
    howToggle.addEventListener('click', () => {
      howBody.classList.toggle('visible')
      howToggle.textContent = howBody.classList.contains('visible') ? 'Got it' : 'How does this work?'
    })
  }

  const breatheBtn = document.getElementById('atm-detail-breathe-btn')
  if (breatheBtn) {
    breatheBtn.addEventListener('click', () => {
      closeDetailCard()
      const breathNav = document.querySelector('[data-view="breath"]')
      if (breathNav) breathNav.click()
    })
  }

  // Check nudge immediately (for 5+ sessions or late night)
  checkNudge()

  // Wire audio popover + restore saved audio state
  wireAudioPopover()
  renderAudioIndicator()
  const audio = state.atmosphere.audio
  if (audio.solfeggio !== 'off') {
    // Defer audio start — requires user gesture in Chromium
    const startSavedAudio = () => {
      const freq = getTargetSolFreq()
      if (freq) startSolfeggio(freq)
      if (audio.binaural !== 'off') {
        startBinaural(freq || 396, BINAURAL[audio.binaural].offset)
      }
      document.removeEventListener('click', startSavedAudio)
    }
    document.addEventListener('click', startSavedAudio, { once: true })
  }

  // Start coherence (HeartMath) integration
  initCoherence()
  initCoherenceBar()

  // Start activity detection + tick
  initActivityListeners()
  setInterval(tick, TICK_MS)
}
