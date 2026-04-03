// renderer/views/breath.js
// Full-screen breathing orb with 4 research-backed protocols.
// Design doc: docs/plans/2026-04-03-somatic-atmosphere-infusion-design.md §5.4

import { state } from '../state.js'
import { audioBreathEnter, audioBreathExit, onBreathComplete } from '../modules/atmosphere.js'

const PROTOCOLS = {
  sighing: {
    phases: [
      { name: 'inhale', duration: 2, scale: 0.7 },
      { name: 'inhale', duration: 1, scale: 1.0 },
      { name: 'exhale', duration: 5.5, scale: 0.45 },
      { name: 'rest', duration: 1.5, scale: 0.4 },
    ],
    cite: 'Balban et al. 2023 — cyclic sighing outperformed meditation for stress reduction',
    color: { h: 160, s: 55, l: 55 },
  },
  resonance: {
    phases: [
      { name: 'inhale', duration: 5, scale: 1.0 },
      { name: 'exhale', duration: 5, scale: 0.4 },
    ],
    cite: 'Lehrer & Gevirtz 2014 — resonance breathing optimizes heart rate variability',
    color: { h: 200, s: 50, l: 55 },
  },
  box: {
    phases: [
      { name: 'inhale', duration: 4, scale: 1.0 },
      { name: 'hold', duration: 4, scale: 1.0 },
      { name: 'exhale', duration: 4, scale: 0.4 },
      { name: 'hold', duration: 4, scale: 0.4 },
    ],
    cite: 'Box breathing — used in military and tactical stress management',
    color: { h: 220, s: 50, l: 55 },
  },
  '478': {
    phases: [
      { name: 'inhale', duration: 4, scale: 1.0 },
      { name: 'hold', duration: 7, scale: 1.0 },
      { name: 'exhale', duration: 8, scale: 0.35 },
    ],
    cite: 'Weil 4-7-8 technique — clinical use for sleep and deep relaxation',
    color: { h: 270, s: 45, l: 55 },
  },
}

let animFrame = null
let startTime = 0
let cycleCount = 0

function easeInOut(t) {
  return t < 0.5 ? 2 * t * t : 1 - Math.pow(-2 * t + 2, 2) / 2
}

function animate() {
  if (!state.breathRunning) return

  const proto = PROTOCOLS[state.breathProtocol]
  const cycleMs = proto.phases.reduce((a, p) => a + p.duration, 0) * 1000
  const elapsed = Date.now() - startTime
  const cycleElapsed = elapsed % cycleMs
  const currentCycle = Math.floor(elapsed / cycleMs)

  // Cycle counting
  if (currentCycle !== cycleCount) {
    cycleCount = currentCycle
    state.breathCycles = cycleCount
    if (state.breathTargetCycles > 0 && cycleCount >= state.breathTargetCycles) {
      onBreathComplete()
      stopBreath()
      return
    }
  }

  // Find current phase
  let phaseStart = 0
  let currentPhase = proto.phases[0]
  let phaseProgress = 0
  for (const phase of proto.phases) {
    const phaseEnd = phaseStart + phase.duration * 1000
    if (cycleElapsed < phaseEnd) {
      currentPhase = phase
      phaseProgress = (cycleElapsed - phaseStart) / (phase.duration * 1000)
      break
    }
    phaseStart = phaseEnd
  }

  // Interpolate scale
  const pi = proto.phases.indexOf(currentPhase)
  const prev = proto.phases[(pi - 1 + proto.phases.length) % proto.phases.length]
  const fromScale = (pi === 0 && cycleCount === 0 && elapsed < cycleMs) ? 0.4 : prev.scale
  const ease = currentPhase.name === 'hold' ? 1 : easeInOut(phaseProgress)
  const scale = fromScale + (currentPhase.scale - fromScale) * ease

  // Render orb
  const orb = document.getElementById('breath-orb')
  if (!orb) return

  const size = 60 + scale * 100
  orb.style.width = size + 'px'
  orb.style.height = size + 'px'

  const c = proto.color
  const isLight = state.theme === 'light'
  const la = isLight ? -15 : 0
  let op, gw
  if (currentPhase.name === 'inhale') { op = 0.5 + ease * 0.4; gw = 20 + ease * 30 }
  else if (currentPhase.name === 'exhale') { op = 0.9 - ease * 0.4; gw = 50 - ease * 30 }
  else if (currentPhase.name === 'hold') { op = currentPhase.scale > 0.7 ? 0.85 : 0.5; gw = currentPhase.scale > 0.7 ? 40 : 20 }
  else { op = 0.45; gw = 15 }

  orb.style.background = `radial-gradient(circle at 40% 38%, hsla(${c.h},${c.s}%,${c.l + la}%,${op}), hsla(${c.h},${c.s - 10}%,${c.l - 10 + la}%,${op * 0.5}) 55%, hsla(${c.h},${c.s - 15}%,${c.l - 15 + la}%,${op * 0.15}) 80%, transparent)`
  orb.style.boxShadow = `0 0 ${gw}px hsla(${c.h},${c.s}%,${c.l + la}%,${op * 0.25}), 0 0 ${gw * 2}px hsla(${c.h},${c.s}%,${c.l + la}%,${op * 0.08})`

  // Phase label
  const phaseEl = document.getElementById('breath-phase')
  if (phaseEl) {
    phaseEl.textContent = currentPhase.name
    phaseEl.style.color = `hsla(${c.h},${c.s - 20}%,${isLight ? 40 : 65}%,${op})`
  }

  // Cycle counter
  const cyclesEl = document.getElementById('breath-cycles')
  if (cyclesEl) {
    cyclesEl.textContent = state.breathTargetCycles > 0
      ? `${cycleCount + 1} / ${state.breathTargetCycles}`
      : `cycle ${cycleCount + 1}`
  }

  animFrame = requestAnimationFrame(animate)
}

function startBreath() {
  state.breathRunning = true
  startTime = Date.now()
  cycleCount = 0
  state.breathCycles = 0

  const btn = document.getElementById('breath-start')
  if (btn) { btn.textContent = 'Stop'; btn.classList.add('running') }

  animFrame = requestAnimationFrame(animate)
}

function stopBreath() {
  state.breathRunning = false
  if (animFrame) cancelAnimationFrame(animFrame)

  const btn = document.getElementById('breath-start')
  if (btn) { btn.textContent = 'Begin'; btn.classList.remove('running') }

  // Reset orb
  const orb = document.getElementById('breath-orb')
  if (orb) { orb.style.width = '80px'; orb.style.height = '80px'; orb.style.background = ''; orb.style.boxShadow = '' }

  const phaseEl = document.getElementById('breath-phase')
  if (phaseEl) phaseEl.textContent = ''
  const cyclesEl = document.getElementById('breath-cycles')
  if (cyclesEl) cyclesEl.textContent = ''
}

function selectProtocol(proto) {
  state.breathProtocol = proto
  document.querySelectorAll('.breath-proto-btn').forEach(b => b.classList.toggle('active', b.dataset.proto === proto))

  const cite = document.getElementById('breath-cite')
  if (cite) cite.textContent = PROTOCOLS[proto].cite

  // Restart if running
  if (state.breathRunning) { stopBreath(); startBreath() }
}

function selectDuration(dur) {
  state.breathTargetCycles = parseInt(dur)
  document.querySelectorAll('.breath-dur-btn').forEach(b => b.classList.toggle('active', b.dataset.dur === dur))
}

// ── Sidebar collapse on breath view ──
export function onBreathEnter() {
  state.breathActive = true
  const sidebar = document.getElementById('sidebar')
  if (sidebar) sidebar.classList.add('collapsed')
  audioBreathEnter()
  // Fade out somatic bar for full immersion
  const somaticBar = document.getElementById('somatic-bar')
  if (somaticBar) somaticBar.classList.add('breath-hidden')
}

export function onBreathExit() {
  state.breathActive = false
  if (state.breathRunning) stopBreath()
  const sidebar = document.getElementById('sidebar')
  if (sidebar) sidebar.classList.remove('collapsed')
  audioBreathExit()
  // Fade somatic bar back in
  const somaticBar = document.getElementById('somatic-bar')
  if (somaticBar) somaticBar.classList.remove('breath-hidden')
}

export function initBreath() {
  // Protocol buttons
  document.querySelectorAll('.breath-proto-btn').forEach(btn => {
    btn.addEventListener('click', () => selectProtocol(btn.dataset.proto))
  })

  // Duration buttons
  document.querySelectorAll('.breath-dur-btn').forEach(btn => {
    btn.addEventListener('click', () => selectDuration(btn.dataset.dur))
  })

  // Start/stop
  const startBtn = document.getElementById('breath-start')
  if (startBtn) {
    startBtn.addEventListener('click', () => {
      if (state.breathRunning) stopBreath()
      else startBreath()
    })
  }

  // Exit button
  const exitBtn = document.getElementById('breath-exit')
  if (exitBtn) {
    exitBtn.addEventListener('click', () => {
      // Navigate back to home — trigger the home nav item
      const homeNav = document.querySelector('[data-view="home"]')
      if (homeNav) homeNav.click()
    })
  }
}
