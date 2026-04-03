// renderer/modules/atmosphere.js
// Somatic atmosphere — session tracking, intensity bar, nudge strip.
// Design doc: docs/plans/2026-04-03-somatic-atmosphere-infusion-design.md

import { state } from '../state.js'

// ── Constants ──
const TICK_MS = 60_000  // update every minute
const NUDGE_MINUTES = 45
const NUDGE_SESSIONS = 5
const NUDGE_HOUR = 22   // 10pm
const CROSSFADE_MS = 30_000  // 30s frequency transitions

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

function getTimeOfDay() {
  const h = new Date().getHours()
  if (h >= 5 && h < 12) return 'morning'
  if (h >= 12 && h < 17) return 'afternoon'
  if (h >= 17 && h < 22) return 'evening'
  return 'late'
}

function computeIntensity(sessions, totalHours, currentMin) {
  return clamp(
    (sessions / 8) * 0.4 + (totalHours / 6) * 0.35 + (currentMin / 60) * 0.25,
    0, 1
  )
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
    glow.style.opacity = intensity * 0.15
  }

  // Icon color tracks intensity
  const icon = document.querySelector('.atm-intensity-icon')
  if (icon) {
    icon.style.color = intensity > 0.05 ? hsl : ''
    icon.style.opacity = intensity > 0.05 ? 0.7 + intensity * 0.3 : 0.5
  }

  // Tooltip
  const tooltip = document.getElementById('atm-tooltip')
  const wrap = document.getElementById('atm-intensity-wrap')
  if (tooltip && wrap) {
    const s = state.atmosphere.sessionCount
    const totalMin = state.atmosphere.totalMinutesToday
    const h = Math.floor(totalMin / 60)
    const m = totalMin % 60
    const timeStr = h > 0 ? `${h}h ${m}m` : `${m}m`
    const pct = Math.round(intensity * 100)
    const feel = pct < 20 ? 'Fresh' : pct < 45 ? 'Active' : pct < 70 ? 'Warm' : 'Heavy'
    tooltip.innerHTML = `<strong>Day energy: ${feel}</strong><br>${s} session${s !== 1 ? 's' : ''} · ${timeStr} today`
    // Position fixed tooltip under the bar
    const rect = wrap.getBoundingClientRect()
    tooltip.style.right = (window.innerWidth - rect.right) + 'px'
  }
}

// ── Nudge Strip ──
function checkNudge() {
  const a = state.atmosphere
  if (a.nudgeFired || a.nudgeDismissed) return

  const hour = new Date().getHours()
  let word = null

  if (a.elapsed >= NUDGE_MINUTES) word = 'breathe'
  else if (a.sessionCount >= NUDGE_SESSIONS) word = 'pause'
  else if (hour >= NUDGE_HOUR) word = 'rest'

  if (!word) return

  a.nudgeFired = true
  const nudge = document.getElementById('atmosphere-nudge')
  const nudgeWord = document.getElementById('nudge-word')
  if (!nudge || !nudgeWord) return

  nudgeWord.textContent = word
  nudge.classList.add('visible')
  audioNudgeShift()
}

function dismissNudge() {
  state.atmosphere.nudgeDismissed = true
  const nudge = document.getElementById('atmosphere-nudge')
  if (nudge) nudge.classList.remove('visible')
}

function nudgeClick() {
  dismissNudge()
  // Navigate to breath view
  const breathNav = document.querySelector('[data-view="breath"]')
  if (breathNav) breathNav.click()
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
  // For simulation: also factor in totalMinutesToday so reloads show the effect
  const sessionMin = a.elapsed
  const totalEnergy = clamp(a.totalMinutesToday / 60 / 7, 0, 1) // 7 hours = full
  const currentEnergy = clamp(sessionMin <= 10 ? sessionMin / 10 * 0.3 : sessionMin <= 30 ? 0.3 + (sessionMin - 10) / 20 * 0.7 : 1, 0, 1)
  const energy = clamp(Math.max(currentEnergy, totalEnergy), 0, 1)
  const sessionHeat = clamp((a.sessionCount - 1) / 10, 0, 1) // 11 sessions = full
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

  console.log(`[atm] warmth=${warmth.toFixed(2)} hue=${Math.round(borderH)} energy=${energy.toFixed(2)} sessions=${a.sessionCount}`)

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
function tick() {
  const a = state.atmosphere
  a.elapsed += 1
  a.totalMinutesToday += 1
  a.timeOfDay = getTimeOfDay()
  a.intensity = computeIntensity(a.sessionCount, a.totalMinutesToday / 60, a.elapsed)

  // Persist
  sessionStorage.setItem('ace-atm-total', String(a.totalMinutesToday))

  renderIntensityBar()
  writeAtmosphereVars()
  checkNudge()
}

// ── Init ──
export function initAtmosphere() {
  // Increment session count
  const count = parseInt(sessionStorage.getItem('ace-atm-sessions') || '0') + 1
  sessionStorage.setItem('ace-atm-sessions', String(count))
  state.atmosphere.sessionCount = count

  // Reset daily counters at midnight
  const lastDate = sessionStorage.getItem('ace-atm-date')
  const today = new Date().toDateString()
  if (lastDate !== today) {
    sessionStorage.setItem('ace-atm-date', today)
    sessionStorage.setItem('ace-atm-sessions', '1')
    sessionStorage.setItem('ace-atm-total', '0')
    state.atmosphere.sessionCount = 1
    state.atmosphere.totalMinutesToday = 0
  }

  // Initial state
  state.atmosphere.timeOfDay = getTimeOfDay()
  state.atmosphere.intensity = computeIntensity(
    state.atmosphere.sessionCount,
    state.atmosphere.totalMinutesToday / 60,
    0
  )

  renderIntensityBar()
  writeAtmosphereVars()

  // Wire nudge
  const nudge = document.getElementById('atmosphere-nudge')
  if (nudge) nudge.addEventListener('click', nudgeClick)

  // Wire tooltip hover (tooltip is body-level, not a CSS child)
  const wrap = document.getElementById('atm-intensity-wrap')
  const tooltip = document.getElementById('atm-tooltip')
  if (wrap && tooltip) {
    wrap.addEventListener('mouseenter', () => {
      const rect = wrap.getBoundingClientRect()
      tooltip.style.top = (rect.bottom + 6) + 'px'
      tooltip.style.right = (window.innerWidth - rect.right) + 'px'
      tooltip.classList.add('visible')
    })
    wrap.addEventListener('mouseleave', () => {
      tooltip.classList.remove('visible')
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

  // Start tick
  setInterval(tick, TICK_MS)
}
