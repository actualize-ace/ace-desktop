// renderer/views/insight.js
// Insight coaching view — orb, waveform, chat, pattern panel.
// Design doc: docs/plans/2026-04-05-insight-view-design.md
// Prototype: docs/insight-prototype.html

import { state } from '../state.js'
import { escapeHtml, postProcessCodeBlocks, SANITIZE_CONFIG } from '../modules/chat-renderer.js'

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

// Hardcoded fallback pattern data
const FALLBACK_PAT = [
  { n: 'sovereignty',    t: 'authority',  s: 0.80, tr: 'stable', lc: 'established', co: 'authorship' },
  { n: 'aliveness',      t: 'authority',  s: 0.75, tr: 'rising', lc: 'active',      co: 'creative-spark' },
  { n: 'creative-spark', t: 'authority',  s: 0.50, tr: 'rising', lc: 'emerging',    co: 'aliveness' },
  { n: 'co-regulation',  t: 'capacity',   s: 0.58, tr: 'rising', lc: 'active',      co: 'deep-rest' },
  { n: 'momentum',       t: 'expansion',  s: 0.92, tr: 'rising', lc: 'established', co: 'leverage' },
  { n: 'leverage',       t: 'expansion',  s: 0.72, tr: 'rising', lc: 'active',      co: 'momentum' },
  { n: 'flow',           t: 'expansion',  s: 0.65, tr: 'stable', lc: 'active',      co: 'momentum' },
]

// Live data — populated by loadPatternData(), falls back to FALLBACK_PAT
let PAT = FALLBACK_PAT
let PATMAP = {}
PAT.forEach(p => PATMAP[p.n] = p)

// ─── Load pattern data from vault ────────────────────────────
async function loadPatternData () {
  try {
    const md = await window.ace.vault.readFile('01-Journal/patterns/index.md')
    if (!md) return FALLBACK_PAT

    // 1) Parse backlink counts: "- name: 42 ^" → { name, count, trend }
    const countMap = {}   // name → { count, trend }
    const countRe = /^- ([\w-]+):\s*(\d+)\s*([~^v])/gm
    let m
    while ((m = countRe.exec(md))) {
      const trendChar = m[3]
      const trend = trendChar === '^' ? 'rising' : trendChar === 'v' ? 'fading' : 'stable'
      countMap[m[1]] = { count: parseInt(m[2], 10), trend }
    }

    // 2) Parse emerged patterns for triad + lifecycle
    //    Format: [[path|name]] — Triad / description `lifecycle`
    //    Or:     [[name]] — Triad / description `lifecycle`
    const emergedMap = {}  // name → { triad, lifecycle }
    const emergedRe = /\[\[(?:[^\]|]*\|)?([\w-]+)\]\]\s*—\s*(Authority|Capacity|Expansion|Relational)\s*\/[^`]*`(\w+)`/gi
    while ((m = emergedRe.exec(md))) {
      const name = m[1]
      let triad = m[2].toLowerCase()
      // Map Relational → capacity (closest triad leg)
      if (triad === 'relational') triad = 'capacity'
      emergedMap[name] = { triad, lifecycle: m[3].toLowerCase() }
    }

    // 3) Parse co-occurrence table for top partner per pattern
    //    Format: | pattern1 + pattern2 | count | signal |
    const coMap = {}  // name → best co-occurrence partner
    const coRe = /\|\s*([\w-]+)\s*\+\s*([\w-]+)\s*\|\s*(\d+)/g
    while ((m = coRe.exec(md))) {
      const a = m[1], b = m[2], count = parseInt(m[3], 10)
      if (!coMap[a] || coMap[a].count < count) coMap[a] = { partner: b, count }
      if (!coMap[b] || coMap[b].count < count) coMap[b] = { partner: a, count }
    }

    // 4) Infer triad from seed pattern sections for patterns not in emerged
    const seedTriadMap = {}
    const capNames = ['flow', 'aliveness', 'deep-rest', 'regulated', 'resourced',
      'activation', 'freeze', 'depletion', 'scattered']
    capNames.forEach(n => seedTriadMap[n] = 'capacity')
    const authNames = ['creative-spark', 'voice-clear', 'authorship', 'insight',
      'mythopoetic', 'vision-pull', 'drift', 'performing']
    authNames.forEach(n => seedTriadMap[n] = 'authority')
    const expNames = ['momentum', 'rhythm-locked', 'container-held', 'clean-close',
      'leverage', 'friction', 'overcommitment', 'avoidance', 'open-loop-anxiety']
    expNames.forEach(n => seedTriadMap[n] = 'expansion')
    const relNames = ['resonance', 'collaboration-alive', 'trust-deepened',
      'boundary-held', 'boundary-breached', 'primary-rupture', 'co-regulation']
    relNames.forEach(n => seedTriadMap[n] = 'capacity')

    // 5) Build the result array — only include patterns with count >= 1
    const maxCount = Math.max(1, ...Object.values(countMap).map(c => c.count))
    const results = []

    for (const [name, { count, trend }] of Object.entries(countMap)) {
      if (count < 1) continue
      const emerged = emergedMap[name]
      const triad = emerged?.triad || seedTriadMap[name] || 'expansion'
      const lifecycle = emerged?.lifecycle || inferLifecycle(count, trend)
      const co = coMap[name]?.partner || ''
      results.push({
        n: name,
        t: triad,
        s: Math.round((count / maxCount) * 100) / 100,
        tr: trend,
        lc: lifecycle,
        co,
      })
    }

    // Sort by strength descending
    results.sort((a, b) => b.s - a.s)

    return results.length ? results : FALLBACK_PAT
  } catch (err) {
    console.warn('[insight] Failed to load pattern data from vault, using fallback:', err)
    return FALLBACK_PAT
  }
}

function inferLifecycle (count, trend) {
  if (count >= 9 && trend === 'fading') return 'integrated'
  if (count >= 9) return 'established'
  if (count >= 3 && trend === 'rising') return 'active'
  if (count >= 3) return 'active'
  return 'emerging'
}

// ─── DOM refs (set in init) ─────────────────────────────────
let body, chatEl, textIn, micEl, modeTag
let waveBox, cv, ctx
let markEl, ringEl, svgOrb, svgGlow
let chipPop
let rafId = null
let t0 = 0
let bars = null
let sAmp = 0   // smoothed amplitude

// Chat streaming state
let insStreaming = false
let insStreamText = ''
let insAssistantEl = null

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
  sendInsightChat('Tell me about my ' + p.n + ' pattern')
}

// ─── Chat streaming ──────────────────────────────────────────
function buildSystemPrompt () {
  const lines = PAT.map(p =>
    `- ${p.n} (${p.tr}) — lifecycle: ${p.lc} — pairs with: ${p.co}`
  ).join('\n')
  return `You are ACE, a coherence coach. Here are the user's active patterns:
${lines}

Coaching guidelines:
- Ask reflective questions. Don't lecture.
- Surface patterns only when genuinely relevant (~30% of responses).
- Most responses should be pure dialogue.
- Keep responses concise (2-4 sentences).
- When referencing a pattern, use its exact name.`
}

function sendInsightChat (query) {
  if (insStreaming || !query) return

  // Show user message
  addMsg('user', escapeHtml(query))

  // Add typing indicator
  addTyping()
  setMode('responding')

  insStreaming = true
  insStreamText = ''

  // Create assistant message element (hidden until first delta)
  insAssistantEl = el('div', 'ins-msg ins-msg-ace')
  insAssistantEl.style.display = 'none'
  insAssistantEl.innerHTML = `<div class="ins-msg-label">ACE</div><div class="ins-msg-body"></div>`
  chatEl.appendChild(insAssistantEl)

  const chatId = 'insight-' + Date.now()
  const opts = { model: 'sonnet', permissions: 'auto', effort: 'high' }

  // Wire stream listener before sending
  const cleanupStream = window.ace.chat.onStream(chatId, event => {
    // Capture session ID for follow-up messages
    if (event.type === 'system' && event.session_id) {
      state.insight.chatSessionId = event.session_id
    }

    // Streaming text deltas
    if (event.type === 'stream_event' && event.event) {
      const e = event.event
      if (e.type === 'content_block_delta' && e.delta?.type === 'text_delta') {
        insStreamText += e.delta.text
        // Remove typing indicator on first delta, show assistant el
        rmTyping()
        insAssistantEl.style.display = ''
        const bodyEl = insAssistantEl.querySelector('.ins-msg-body')
        bodyEl.innerHTML = `<div class="md-body">${DOMPurify.sanitize(marked.parse(insStreamText), SANITIZE_CONFIG)}</div>`
        chatEl.scrollTop = chatEl.scrollHeight
      }
    }

    // Final result
    if (event.type === 'result') {
      insStreaming = false
      rmTyping()
      insAssistantEl.style.display = ''
      const bodyEl = insAssistantEl.querySelector('.ins-msg-body')
      bodyEl.innerHTML = `<div class="md-body">${DOMPurify.sanitize(marked.parse(insStreamText), SANITIZE_CONFIG)}</div>`
      postProcessCodeBlocks(insAssistantEl)
      processPatternChips(insAssistantEl)
      // Wire chip click handlers on the new message
      insAssistantEl.querySelectorAll('.ins-chip').forEach(ch => {
        ch.addEventListener('click', e => {
          e.stopPropagation()
          showChipPop(ch, ch.dataset.pat)
        })
      })
      chatEl.scrollTop = chatEl.scrollHeight
      cleanupStream()
      cleanupExit()
      setMode('ambient')
    }
  })

  const cleanupExit = window.ace.chat.onExit(chatId, () => {
    insStreaming = false
    rmTyping()
    if (insStreamText && insAssistantEl) {
      insAssistantEl.style.display = ''
      const bodyEl = insAssistantEl.querySelector('.ins-msg-body')
      bodyEl.innerHTML = `<div class="md-body">${DOMPurify.sanitize(marked.parse(insStreamText), SANITIZE_CONFIG)}</div>`
      postProcessCodeBlocks(insAssistantEl)
      processPatternChips(insAssistantEl)
      insAssistantEl.querySelectorAll('.ins-chip').forEach(ch => {
        ch.addEventListener('click', e => {
          e.stopPropagation()
          showChipPop(ch, ch.dataset.pat)
        })
      })
    }
    cleanupStream()
    cleanupExit()
    setMode('ambient')
  })

  // Build the query — prepend system prompt on first message only
  const fullQuery = state.insight.chatSessionId
    ? query
    : buildSystemPrompt() + '\n\n' + query
  window.ace.chat.send(chatId, fullQuery, state.insight.chatSessionId, opts)
}

function processPatternChips (msgEl) {
  const bodyEl = msgEl.querySelector('.ins-msg-body')
  if (!bodyEl) return
  // Get all known pattern names, sorted longest-first to avoid partial matches
  const names = PAT.map(p => p.n).sort((a, b) => b.length - a.length)
  if (!names.length) return

  // Walk text nodes only — avoid replacing inside HTML tags or existing chips
  const walker = document.createTreeWalker(bodyEl, NodeFilter.SHOW_TEXT, null)
  const replacements = []
  let node
  while ((node = walker.nextNode())) {
    // Skip if already inside a chip
    if (node.parentElement && node.parentElement.closest('.ins-chip')) continue
    for (const name of names) {
      const idx = node.textContent.indexOf(name)
      if (idx >= 0) {
        replacements.push({ node, name, idx })
      }
    }
  }

  // Apply replacements in reverse order to preserve indices
  for (let i = replacements.length - 1; i >= 0; i--) {
    const { node, name, idx } = replacements[i]
    const p = PATMAP[name]
    if (!p) continue
    const before = node.textContent.slice(0, idx)
    const after = node.textContent.slice(idx + name.length)

    const chip = document.createElement('span')
    chip.className = 'ins-chip'
    chip.dataset.triad = p.t
    chip.dataset.pat = name
    chip.innerHTML = `<span class="ins-chip-dot"></span>${name}<span class="ins-chip-trend">${TR[p.tr] || ''}</span>`

    const parent = node.parentNode
    if (after) parent.insertBefore(document.createTextNode(after), node.nextSibling)
    parent.insertBefore(chip, node.nextSibling)
    node.textContent = before
  }
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

// ─── Audio ───────────────────────────────────────────────────
async function micOn () {
  try {
    state.insight.audioCtx = new (AudioContext || webkitAudioContext)()
    state.insight.stream = await navigator.mediaDevices.getUserMedia({ audio: true })
    const src = state.insight.audioCtx.createMediaStreamSource(state.insight.stream)
    state.insight.analyser = state.insight.audioCtx.createAnalyser()
    state.insight.analyser.fftSize = 256
    state.insight.analyser.smoothingTimeConstant = 0.7
    src.connect(state.insight.analyser)
    state.insight.freqData = new Uint8Array(state.insight.analyser.frequencyBinCount)
    setMode('listening')
  } catch (e) {
    console.warn('[insight] mic unavailable:', e)
  }
}

function micOff () {
  if (state.insight.stream) state.insight.stream.getTracks().forEach(t => t.stop())
  if (state.insight.audioCtx) state.insight.audioCtx.close()
  state.insight.audioCtx = null
  state.insight.analyser = null
  state.insight.stream = null
  state.insight.freqData = null
  state.insight.amp = 0
  sAmp = 0
  setMode('ambient')
}

function readAudio () {
  if (!state.insight.analyser) return
  state.insight.analyser.getByteFrequencyData(state.insight.freqData)
  let sum = 0
  for (let i = 0; i < state.insight.freqData.length; i++) {
    const v = state.insight.freqData[i] / 255
    sum += v * v
  }
  state.insight.amp = Math.sqrt(sum / state.insight.freqData.length)
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
  const targetAmp = state.insight.mode !== 'ambient' ? (state.insight.amp || 0) : 0
  sAmp += (targetAmp - sAmp) * 0.08
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
  if (state.insight.mode === 'listening') readAudio()
  drawWave(t)
  updateOrb(t)
  rafId = requestAnimationFrame(frame)
}

// ─── Wire events ─────────────────────────────────────────────
// Store bound handlers for cleanup on exit
let _boundResize = null
let _boundChipDismiss = null

function wireEvents () {
  // Text input — Enter sends via streaming IPC
  textIn.addEventListener('keydown', e => {
    if (e.key === 'Enter' && textIn.value.trim()) {
      const txt = textIn.value.trim()
      textIn.value = ''
      sendInsightChat(txt)
    }
  })

  // Mic button — toggles real audio capture
  micEl.addEventListener('click', () => {
    state.insight.mode === 'listening' ? micOff() : micOn()
  })

  // Chip popover dismiss (stored for removal on exit)
  _boundChipDismiss = hideChipPop
  document.addEventListener('click', _boundChipDismiss)

  // Canvas resize (stored for removal on exit)
  _boundResize = resizeCanvas
  window.addEventListener('resize', _boundResize)
}

function unwireGlobalEvents () {
  if (_boundResize) {
    window.removeEventListener('resize', _boundResize)
    _boundResize = null
  }
  if (_boundChipDismiss) {
    document.removeEventListener('click', _boundChipDismiss)
    _boundChipDismiss = null
  }
}

// escHTML removed — using imported escapeHtml from chat-renderer.js

// ─── Public API ──────────────────────────────────────────────
let insightLoading = false
export async function initInsight () {
  if (state.insightInitialized || insightLoading) return
  insightLoading = true

  // Load live pattern data from vault (falls back to FALLBACK_PAT)
  PAT = await loadPatternData()
  PATMAP = {}
  PAT.forEach(p => PATMAP[p.n] = p)

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
  insightLoading = false
  rafId = requestAnimationFrame(frame)
}

export function onInsightExit () {
  // Stop mic if active
  if (state.insight.stream) micOff()
  // Stop animation loop
  if (rafId) {
    cancelAnimationFrame(rafId)
    rafId = null
  }
  // Remove global listeners (window resize, document click) to prevent leaks
  unwireGlobalEvents()
  // Remove chip popover from document.body
  if (chipPop && chipPop.parentNode) {
    chipPop.parentNode.removeChild(chipPop)
    chipPop = null
  }
  state.insightInitialized = false
  insightLoading = false
}
