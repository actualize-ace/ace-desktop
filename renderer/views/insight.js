// renderer/views/insight.js
// Insight coaching view — orb, waveform, chat, pattern panel.
// Design doc: docs/plans/2026-04-05-insight-view-design.md
// Prototype: docs/insight-prototype.html

import { state } from '../state.js'

// ─── Constants ───────────────────────────────────────────────
const TC = { authority: '#c8a0f0', capacity: '#60d8a8', expansion: '#e080a0' }
const TR = { rising: '\u2191', stable: '\u2192', fading: '\u2193' }
const TRIAD_NAMES = { authority: 'Authority', capacity: 'Capacity', expansion: 'Expansion' }
const TRIAD_LETTERS = { authority: 'A', capacity: 'C', expansion: 'E' }
const TRIADS = ['authority', 'capacity', 'expansion']

// Waveform tuning
const WAVE = {
  barCount: 48, barW: 2.5, barGap: 2, barMaxH: 12, barIdleH: 1,
  barSmooth: 0.12, breathHz: 0.0003, breathAmp: 0.03,
}

// Hardcoded pattern data (real data loaded in Task 5)
const PAT = [
  { n: 'sovereignty',    t: 'authority',  s: 0.80, tr: 'stable', lc: 'established', co: 'authorship' },
  { n: 'aliveness',      t: 'authority',  s: 0.75, tr: 'rising', lc: 'active',      co: 'creative-spark' },
  { n: 'creative-spark', t: 'authority',  s: 0.50, tr: 'rising', lc: 'emerging',    co: 'aliveness' },
  { n: 'co-regulation',  t: 'capacity',   s: 0.58, tr: 'rising', lc: 'active',      co: 'deep-rest' },
  { n: 'momentum',       t: 'expansion',  s: 0.92, tr: 'rising', lc: 'established', co: 'leverage' },
  { n: 'leverage',       t: 'expansion',  s: 0.72, tr: 'rising', lc: 'active',      co: 'momentum' },
  { n: 'flow',           t: 'expansion',  s: 0.65, tr: 'stable', lc: 'active',      co: 'momentum' },
]
const PATMAP = {}
PAT.forEach(p => PATMAP[p.n] = p)

// ─── DOM refs (set in init) ─────────────────────────────────
let body, chatEl, textIn, micEl, modeTag
let waveBox, cv, ctx
let markEl, ringEl, svgOrb, svgGlow
let chipPop
let rafId = null
let t0 = 0
let bars = null
let sAmp = 0   // smoothed amplitude

// ─── Build DOM ───────────────────────────────────────────────
function buildDOM () {
  body = document.getElementById('insight-body')
  modeTag = document.getElementById('insight-mode')

  // Coaching column
  const coaching = el('div', 'ins-coaching')

  // Orb area
  const orbArea = el('div', null)
  orbArea.id = 'ins-orb-area'
  const mark = el('div', null)
  mark.id = 'ins-mark'
  const ring = el('div', null)
  ring.id = 'ins-ring'
  mark.appendChild(ring)
  mark.innerHTML += `<svg width="60" height="60" viewBox="0 0 100 100">
    <defs>
      <radialGradient id="ins-g-orb" cx="38%" cy="38%" r="60%">
        <stop offset="0%" stop-color="#8878ff"/>
        <stop offset="50%" stop-color="#c8a0f0"/>
        <stop offset="100%" stop-color="#60d8a8"/>
      </radialGradient>
      <radialGradient id="ins-g-ctr" cx="50%" cy="50%" r="50%">
        <stop offset="0%" stop-color="rgba(220,200,255,0.85)"/>
        <stop offset="30%" stop-color="rgba(180,160,240,0.35)"/>
        <stop offset="100%" stop-color="rgba(160,140,240,0)"/>
      </radialGradient>
    </defs>
    <circle cx="50" cy="50" r="38" fill="url(#ins-g-orb)" opacity="0.05"/>
    <circle id="ins-svgOrb" cx="50" cy="50" r="34" fill="url(#ins-g-orb)" opacity="0.9"/>
    <circle id="ins-svgGlow" cx="50" cy="50" r="14" fill="url(#ins-g-ctr)" opacity="0.8"/>
  </svg>`
  orbArea.appendChild(mark)
  coaching.appendChild(orbArea)

  // Waveform
  const waveDiv = el('div', null)
  waveDiv.id = 'ins-waveform'
  const canvas = document.createElement('canvas')
  canvas.id = 'ins-wave'
  waveDiv.appendChild(canvas)
  coaching.appendChild(waveDiv)

  // Chat
  const chat = el('div', null)
  chat.id = 'ins-chat'
  coaching.appendChild(chat)

  // Input bar
  const inputBar = el('div', null)
  inputBar.id = 'ins-input-bar'
  const mic = document.createElement('button')
  mic.id = 'ins-mic'
  mic.setAttribute('aria-label', 'Mic')
  mic.innerHTML = `<svg viewBox="0 0 24 24"><path d="M12 14c1.66 0 3-1.34 3-3V5c0-1.66-1.34-3-3-3S9 3.34 9 5v6c0 1.66 1.34 3 3 3zm-1-9c0-.55.45-1 1-1s1 .45 1 1v6c0 .55-.45 1-1 1s-1-.45-1-1V5z"/><path d="M17 11c0 2.76-2.24 5-5 5s-5-2.24-5-5H5c0 3.53 2.61 6.43 6 6.92V21h2v-3.08c3.39-.49 6-3.39 6-6.92h-2z"/></svg>`
  inputBar.appendChild(mic)
  const input = document.createElement('input')
  input.id = 'ins-text'
  input.type = 'text'
  input.placeholder = 'Type or speak...'
  input.autocomplete = 'off'
  inputBar.appendChild(input)
  coaching.appendChild(inputBar)

  // Pattern panel
  const panel = el('div', 'ins-pat-panel')
  panel.innerHTML = `<div class="pp-label">Patterns</div>
    <div class="pp-balance" id="ins-pp-bal"></div>
    <div class="pp-list" id="ins-pp-list"></div>`

  // Chip popover (appended to body element for fixed positioning)
  chipPop = el('div', null)
  chipPop.id = 'ins-chip-pop'
  document.body.appendChild(chipPop)

  body.appendChild(coaching)
  body.appendChild(panel)

  // Grab refs after DOM is built
  chatEl = document.getElementById('ins-chat')
  textIn = document.getElementById('ins-text')
  micEl = document.getElementById('ins-mic')
  markEl = document.getElementById('ins-mark')
  ringEl = document.getElementById('ins-ring')
  svgOrb = document.getElementById('ins-svgOrb')
  svgGlow = document.getElementById('ins-svgGlow')
  waveBox = document.getElementById('ins-waveform')
  cv = document.getElementById('ins-wave')
  ctx = cv.getContext('2d')
}

function el (tag, cls) {
  const e = document.createElement(tag)
  if (cls) e.className = cls
  return e
}

// ─── Pattern panel ───────────────────────────────────────────
function buildPatPanel () {
  const balEl = document.getElementById('ins-pp-bal')
  const listEl = document.getElementById('ins-pp-list')

  // Balance bars
  TRIADS.forEach(t => {
    const pats = PAT.filter(p => p.t === t)
    const avg = pats.reduce((s, p) => s + p.s, 0) / (pats.length || 1)
    const row = el('div', 'pp-bal-row')
    row.innerHTML = `<span class="pp-bal-letter" style="color:${TC[t]}">${TRIAD_LETTERS[t]}</span>
      <div class="pp-bal-track"><div class="pp-bal-fill" style="width:${avg * 100}%;background:${TC[t]}"></div></div>`
    balEl.appendChild(row)
  })

  // Pattern list grouped by triad
  TRIADS.forEach(t => {
    const pats = PAT.filter(p => p.t === t)
    if (!pats.length) return
    const tc = TC[t]
    const group = el('div', 'pp-group')
    group.innerHTML = `<div class="pp-group-label" style="color:${tc}">${TRIAD_NAMES[t]}</div>`
    pats.forEach(p => {
      const item = el('div', 'pp-item')
      item.innerHTML = `<div class="pp-row">
          <div class="pp-dot" style="background:${tc}"></div>
          <span class="pp-name">${p.n}</span>
          <span class="pp-trend">${TR[p.tr] || ''}</span>
        </div>
        <div class="pp-str"><div class="pp-str-fill" style="width:${p.s * 100}%;background:${tc}"></div></div>
        <div class="pp-ask"><span>\u25B6</span> ask about this</div>`
      item.addEventListener('click', () => askAbout(p))
      group.appendChild(item)
    })
    listEl.appendChild(group)
  })
}

// ─── Chat helpers ────────────────────────────────────────────
function chipHTML (n) {
  const p = PATMAP[n]
  if (!p) return `<b>${n}</b>`
  return `<span class="ins-chip" data-triad="${p.t}" data-pat="${n}"><span class="ins-chip-dot"></span>${n}<span class="ins-chip-trend">${TR[p.tr] || ''}</span></span>`
}

function addMsg (role, html) {
  const d = el('div', `ins-msg ins-msg-${role}`)
  d.innerHTML = `<div class="ins-msg-label">${role === 'ace' ? 'ACE' : 'YOU'}</div><div class="ins-msg-body">${html}</div>`
  chatEl.appendChild(d)
  chatEl.scrollTop = chatEl.scrollHeight
  // Wire chip click handlers in the new message
  d.querySelectorAll('.ins-chip').forEach(ch => {
    ch.addEventListener('click', e => {
      e.stopPropagation()
      showChipPop(ch, ch.dataset.pat)
    })
  })
}

function addTyping () {
  const d = el('div', 'ins-msg ins-msg-ace')
  d.id = 'ins-typing'
  d.innerHTML = `<div class="ins-msg-label">ACE</div><div class="ins-typing"><span></span><span></span><span></span></div>`
  chatEl.appendChild(d)
  chatEl.scrollTop = chatEl.scrollHeight
}

function rmTyping () {
  const e = document.getElementById('ins-typing')
  if (e) e.remove()
}

function askAbout (p) {
  addMsg('user', `Tell me about my ${p.n} pattern`)
  // Local display only — no streaming yet (Task 4)
  addTyping()
  setMode('responding')
  const resp = PAT_RESP[p.n] || `${chipHTML(p.n)} is ${p.tr}. It's ${p.lc} and pairs with ${p.co}. What do you want to know?`
  setTimeout(() => {
    rmTyping()
    addMsg('ace', resp)
    setMode('ambient')
  }, 1000 + Math.random() * 600)
}

// Hardcoded responses (real streaming in Task 4)
const PAT_RESP = {
  momentum: `${chipHTML('momentum')} has 42 backlinks \u2014 your most referenced pattern. It co-occurs with ${chipHTML('leverage')} 19 times. When one moves, the other follows. That's your signature build rhythm. What kicked this cycle off?`,
  leverage: `${chipHTML('leverage')} is rising alongside momentum. You're not just doing \u2014 you're compounding. The question is whether you're leveraging deliberately or just riding the wave. Which is it?`,
  sovereignty: `${chipHTML('sovereignty')} has been stable for weeks. That's rare \u2014 most people's authority patterns fluctuate. You're building from a grounded place. What's anchoring that right now?`,
  'co-regulation': `${chipHTML('co-regulation')} is rising while deep-rest fades. You might be sourcing regulation from connection instead of solitude right now. That works, but notice if it becomes dependency. Who's regulating you?`,
  'creative-spark': `${chipHTML('creative-spark')} is emerging \u2014 only 2 weeks old as a pattern. It pairs with ${chipHTML('aliveness')}. Something wants to be expressed that hasn't had a container yet. What is it?`,
  flow: `${chipHTML('flow')} is stable \u2014 your body knows the rhythm. This pattern usually shows up when sovereignty and momentum are both present. You're in a good window. Don't waste it on busywork.`,
  aliveness: `${chipHTML('aliveness')} is active and rising. It co-occurs with creative-spark. This is your expression signal \u2014 the felt sense that something wants to come through. When did you last feel it today?`,
}

// ─── Chip popover ────────────────────────────────────────────
function showChipPop (el, name) {
  const p = PATMAP[name]
  if (!p) return
  const tc = TC[p.t]
  chipPop.innerHTML = `<div class="cp-name" style="color:${tc}">${name} ${TR[p.tr] || ''}</div>
    <div class="cp-meta">${p.lc} \u00b7 ${p.t}</div>
    <div class="cp-bar"><div class="cp-fill" style="width:${p.s * 100}%;background:${tc}"></div></div>
    <div class="cp-pair">pairs with ${p.co}</div>`
  const r = el.getBoundingClientRect()
  chipPop.style.left = Math.min(Math.max(r.left, 8), innerWidth - 190) + 'px'
  chipPop.style.top = (r.bottom + 5) + 'px'
  chipPop.classList.add('show')
}

function hideChipPop (e) {
  if (!e.target.closest('.ins-chip') && !e.target.closest('#ins-chip-pop')) {
    chipPop.classList.remove('show')
  }
}

// ─── Mode ────────────────────────────────────────────────────
function setMode (m) {
  state.insight.mode = m
  if (modeTag) modeTag.textContent = m
  if (micEl) micEl.classList.toggle('on', m === 'listening')
  if (markEl) markEl.classList.toggle('active', m !== 'ambient')
  if (ringEl) ringEl.classList.toggle('active', m !== 'ambient')
}

// ─── Waveform drawing ────────────────────────────────────────
function resizeCanvas () {
  if (!waveBox || !cv) return
  const r = waveBox.getBoundingClientRect()
  const d = devicePixelRatio || 1
  cv.width = r.width * d
  cv.height = r.height * d
  ctx.setTransform(d, 0, 0, d, 0, 0)
}

function drawWave (t) {
  if (!waveBox || !ctx) return
  const r = waveBox.getBoundingClientRect()
  const W = r.width, H = r.height, cy = H / 2, n = WAVE.barCount
  const totalW = n * WAVE.barW + (n - 1) * WAVE.barGap
  const sx = (W - totalW) / 2

  const mode = state.insight.mode
  for (let i = 0; i < n; i++) {
    let tgt
    if (mode === 'listening' && state.insight.freqData) {
      tgt = state.insight.freqData[Math.floor(i * state.insight.freqData.length / n)] / 255
    } else if (mode === 'responding') {
      const rt = t * 0.001
      const env = Math.sin(rt * 3.2) * 0.5 + 0.5
      tgt = Math.max(0, env * 0.45 + Math.sin(rt * 6 + i * 0.35) * 0.25 + Math.sin(rt * 11 + i * 0.7) * 0.1) * 0.65
    } else {
      // Ambient idle
      const st = t * 0.0006
      tgt = Math.max(0.03, 0.04 + Math.sin(st * 0.5 + i * 0.3) * 0.025 + Math.sin(st * 0.9 + i * 0.6) * 0.012)
    }
    bars[i] += (tgt - bars[i]) * WAVE.barSmooth
  }

  ctx.clearRect(0, 0, W, H)
  const g = ctx.createLinearGradient(sx, 0, sx + totalW, 0)
  if (mode === 'responding') {
    g.addColorStop(0, 'rgba(200,160,240,0.50)')
    g.addColorStop(0.5, 'rgba(200,160,240,0.60)')
    g.addColorStop(1, 'rgba(200,160,240,0.40)')
  } else {
    g.addColorStop(0, 'rgba(136,120,255,0.35)')
    g.addColorStop(0.5, 'rgba(200,160,240,0.45)')
    g.addColorStop(1, 'rgba(96,216,168,0.30)')
  }
  ctx.strokeStyle = g
  ctx.lineWidth = WAVE.barW
  ctx.lineCap = 'round'
  const mH = mode === 'ambient' ? WAVE.barIdleH : WAVE.barMaxH
  for (let i = 0; i < n; i++) {
    const x = sx + i * (WAVE.barW + WAVE.barGap) + WAVE.barW / 2
    const h = Math.max(0.3, bars[i] * mH)
    ctx.beginPath()
    ctx.moveTo(x, cy - h)
    ctx.lineTo(x, cy + h)
    ctx.stroke()
  }
}

// ─── Orb animation ───────────────────────────────────────────
function updateOrb (t) {
  if (!svgOrb || !svgGlow || !markEl) return
  sAmp += (0 - sAmp) * 0.08  // no mic input yet — amp stays 0
  const b = Math.sin(t * WAVE.breathHz)
  const mode = state.insight.mode
  const respBoost = mode === 'responding' ? (Math.sin(t * 0.001 * 3) * 0.5 + 0.5) * 3 : 0
  const gr = 14 + b * 2 + sAmp * 8 + respBoost
  svgGlow.setAttribute('r', gr.toFixed(1))
  svgOrb.style.opacity = Math.min(1, 0.85 + b * 0.05 + sAmp * 0.1).toFixed(3)
  const sc = 1 + b * WAVE.breathAmp + sAmp * 0.05
  markEl.querySelector('svg').style.transform = `scale(${sc.toFixed(4)})`
}

// ─── Animation loop ──────────────────────────────────────────
function frame (ts) {
  if (!state.insightInitialized) return
  const t = ts - t0
  drawWave(t)
  updateOrb(t)
  rafId = requestAnimationFrame(frame)
}

// ─── Wire events ─────────────────────────────────────────────
function wireEvents () {
  // Text input — Enter sends (local display only, no streaming)
  textIn.addEventListener('keydown', e => {
    if (e.key === 'Enter' && textIn.value.trim()) {
      const txt = textIn.value.trim()
      textIn.value = ''
      addMsg('user', escHTML(txt))
      // Placeholder local echo — real streaming in Task 4
      addTyping()
      setMode('responding')
      setTimeout(() => {
        rmTyping()
        addMsg('ace', `What's present for you right now?`)
        setMode('ambient')
      }, 1000 + Math.random() * 800)
    }
  })

  // Mic button — placeholder (real mic in Task 6)
  micEl.addEventListener('click', () => {
    // Toggle visual state only for now
    if (state.insight.mode === 'listening') {
      setMode('ambient')
    } else {
      setMode('listening')
    }
  })

  // Chip popover dismiss
  document.addEventListener('click', hideChipPop)

  // Canvas resize
  window.addEventListener('resize', resizeCanvas)
}

function escHTML (s) {
  const d = document.createElement('div')
  d.textContent = s
  return d.innerHTML
}

// ─── Public API ──────────────────────────────────────────────
export function initInsight () {
  if (state.insightInitialized) return

  buildDOM()
  buildPatPanel()

  // Init waveform bars
  bars = new Float32Array(WAVE.barCount)
  for (let i = 0; i < WAVE.barCount; i++) {
    bars[i] = 0.05 + Math.sin(i * 0.5) * 0.02
  }

  resizeCanvas()
  wireEvents()

  // Seed chat
  addMsg('ace', `What's present for you right now?`)

  t0 = performance.now()
  state.insightInitialized = true
  rafId = requestAnimationFrame(frame)
}

export function onInsightExit () {
  // Stop animation loop
  if (rafId) {
    cancelAnimationFrame(rafId)
    rafId = null
  }
  state.insightInitialized = false
}
