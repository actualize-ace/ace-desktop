// renderer/modules/atmosphere.js
// Somatic atmosphere — session tracking, intensity bar, nudge strip.
// Design doc: docs/plans/2026-04-03-somatic-atmosphere-infusion-design.md

import { state } from '../state.js'

// ── Constants ──
const TICK_MS = 60_000  // update every minute
const NUDGE_MINUTES = 45
const NUDGE_SESSIONS = 5
const NUDGE_HOUR = 22   // 10pm

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
  if (tooltip) {
    const s = state.atmosphere.sessionCount
    const totalMin = state.atmosphere.totalMinutesToday
    const h = Math.floor(totalMin / 60)
    const m = totalMin % 60
    const timeStr = h > 0 ? `${h}h ${m}m` : `${m}m`
    const pct = Math.round(intensity * 100)
    const feel = pct < 20 ? 'Fresh' : pct < 45 ? 'Active' : pct < 70 ? 'Warm' : 'Heavy'
    tooltip.innerHTML = `<strong>Day energy: ${feel}</strong><br>${s} session${s !== 1 ? 's' : ''} · ${timeStr} today`
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

  // Wire nudge
  const nudge = document.getElementById('atmosphere-nudge')
  if (nudge) nudge.addEventListener('click', nudgeClick)

  // Check nudge immediately (for 5+ sessions or late night)
  checkNudge()

  // Start tick
  setInterval(tick, TICK_MS)
}
