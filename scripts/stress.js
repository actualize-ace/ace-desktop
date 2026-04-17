// renderer-side stress harness — dev only, loaded via ?stress=1 URL flag
// Exposed as window.__stress. See scripts/stress-README.md for usage.
//
// Scenarios:
//   runChatHeavy(n, msgsPerSession, streamingCount, opts)
//   runPtyHeavy(n, opts)
//
// Each scenario starts a frame-time recorder, runs for ~60s, prints a JSON
// summary to the console, and appends one line to scripts/stress-results.jsonl
// via the main-process stress-append IPC (dev only).

import { state } from '../renderer/state.js'
import { scheduleRender } from '../renderer/modules/session-manager.js'

// ─── Frame-time recorder ─────────────────────────────────────────────────────

let _recording = false
let _lastT = 0
let _gaps = []
let _rafId = null
let _peakHeap = 0

function _tick(t) {
  if (!_recording) return
  if (_lastT) {
    _gaps.push(t - _lastT)
  }
  _lastT = t
  if (performance.memory?.usedJSHeapSize) {
    _peakHeap = Math.max(_peakHeap, performance.memory.usedJSHeapSize)
  }
  _rafId = requestAnimationFrame(_tick)
}

function startRecording() {
  _gaps = []
  _lastT = 0
  _peakHeap = 0
  _recording = true
  _rafId = requestAnimationFrame(_tick)
}

function stopRecording() {
  _recording = false
  if (_rafId) cancelAnimationFrame(_rafId)
  _rafId = null
  const gaps = _gaps.slice().sort((a, b) => a - b)
  const n = gaps.length
  const pct = (p) => n ? gaps[Math.min(n - 1, Math.floor(n * p))] : 0
  return {
    frames: n,
    p50: +pct(0.50).toFixed(2),
    p95: +pct(0.95).toFixed(2),
    p99: +pct(0.99).toFixed(2),
    max: +(n ? gaps[n - 1] : 0).toFixed(2),
    over16: _gaps.filter(g => g > 16).length,
    over50: _gaps.filter(g => g > 50).length,
    over100: _gaps.filter(g => g > 100).length,
    peakHeapMB: +(_peakHeap / 1024 / 1024).toFixed(1),
  }
}

// ─── Fixture ─────────────────────────────────────────────────────────────────

// Default fixture path. Swappable via opts.fixturePath in scenarios.
const DEFAULT_FIXTURE = '../scripts/fixtures/stream-response-20k.jsonl'

let _fixtureCache = null

async function loadFixture(url = DEFAULT_FIXTURE) {
  if (_fixtureCache) return _fixtureCache
  try {
    const res = await fetch(url)
    const text = await res.text()
    const events = text.split('\n').filter(l => l.trim()).map(l => JSON.parse(l))
    _fixtureCache = events
    return events
  } catch (e) {
    console.warn('[stress] fixture load failed, using synthetic fallback:', e.message)
    return _syntheticFallback()
  }
}

// Deterministic synthetic fallback — used if jsonl fixture is absent.
function _syntheticFallback() {
  const paragraphs = [
    'This is a paragraph of streaming output with some *emphasis* and `inline code`. It represents a normal assistant reply.\n\n',
    '## Heading two\n\nMore markdown content here including [[wikilinks]] and **bold text**.\n\n',
    '```javascript\nfunction example(a, b) {\n  const result = a + b\n  return result\n}\nconst x = example(1, 2)\n```\n\n',
    '- First bullet point\n- Second bullet with *italics*\n- Third bullet with `code`\n\n',
    '```python\ndef process(data):\n    for item in data:\n        print(f"item={item}")\n    return len(data)\n```\n\n',
    '> A blockquote with some reflective content that wraps onto multiple lines and demonstrates the tail-rendering pathway under streaming conditions.\n\n',
    '1. Numbered item one\n2. Numbered item two with more text to make the line longer\n3. Numbered item three\n\n',
  ]
  const events = []
  // Build ~80K chars of content by cycling paragraphs
  for (let i = 0; i < 120; i++) {
    const p = paragraphs[i % paragraphs.length]
    // Chunk each paragraph into 5–25 char deltas
    let cursor = 0
    while (cursor < p.length) {
      const chunkLen = 5 + Math.floor((cursor * 9973) % 20)
      const text = p.slice(cursor, cursor + chunkLen)
      events.push({ type: 'stream_event', event: { type: 'content_block_delta', delta: { type: 'text_delta', text } } })
      cursor += chunkLen
    }
  }
  return events
}

// ─── Minimal harness DOM (bypasses SESSION_LIMIT without touching prod code) ─

function _createHarnessChatSession(id) {
  const container = document.getElementById('pane-content-left')
  if (!container) throw new Error('[stress] pane-content-left not found — app not ready')

  const pane = document.createElement('div')
  pane.className = 'term-pane stress-harness-pane'
  pane.id = 'pane-' + id
  pane.style.display = 'none' // hidden to avoid visual clutter; does not affect rAF measurement
  pane.innerHTML = `
    <div class="chat-view" id="chat-view-${id}">
      <div class="chat-messages" id="chat-msgs-${id}"></div>
    </div>
  `
  container.appendChild(pane)

  const msgsEl = document.getElementById('chat-msgs-' + id)
  const assistantMsg = document.createElement('div')
  assistantMsg.className = 'chat-msg chat-msg-assistant'
  assistantMsg.innerHTML = '<div class="chat-msg-content md-body"><div class="chat-settled"></div><div class="chat-tail"></div></div>'
  msgsEl.appendChild(assistantMsg)

  state.sessions[id] = {
    mode: 'chat',
    name: 'STRESS',
    pane,
    tab: null,
    messages: [],
    pendingAttachments: [],
    currentStreamText: '',
    _fullResponseText: '',
    currentToolInput: '',
    isStreaming: true,
    model: 'opus',
    totalCost: 0,
    needsAttention: false,
    _currentAssistantEl: assistantMsg,
    _settledBoundary: 0,
    _settledHTML: '',
    _pendingRAF: null,
  }
  return id
}

function _teardownHarnessSession(id) {
  const s = state.sessions[id]
  if (!s) return
  if (s._pendingRAF) cancelAnimationFrame(s._pendingRAF)
  s.pane?.remove()
  delete state.sessions[id]
}

// ─── Scenario: chat-heavy ────────────────────────────────────────────────────

async function appendResult(entry) {
  // Writes one JSON line to scripts/stress-results.jsonl via main-process IPC.
  // Silently no-ops if the channel isn't registered (packaged build).
  try {
    if (window.ace?.stress?.appendResult) {
      await window.ace.stress.appendResult(entry)
    }
  } catch (e) {
    console.warn('[stress] appendResult failed:', e.message)
  }
}

export async function runChatHeavy(n = 6, msgsPerSession = 20, streamingCount = 3, opts = {}) {
  const durationMs = opts.durationMs ?? 60_000
  const deltaIntervalMs = opts.deltaIntervalMs ?? 20
  const label = opts.label ?? 'chat-heavy'

  console.log(`[stress] runChatHeavy n=${n} streaming=${streamingCount} duration=${durationMs}ms label=${label}`)

  const events = await loadFixture(opts.fixturePath)

  // Spawn harness sessions
  const ids = []
  for (let i = 0; i < n; i++) {
    const id = `stress-chat-${Date.now()}-${i}`
    _createHarnessChatSession(id)
    ids.push(id)
  }

  // Seed pseudo-history — add msgsPerSession worth of text into currentStreamText
  // on each non-streaming session, to simulate a warm 100K-token context.
  // (Rendered once, not continuously — just puts mass in the DOM.)
  const historyChunk = events.map(e => e.event?.delta?.text || '').join('').slice(0, 4000)
  for (let i = streamingCount; i < n; i++) {
    const s = state.sessions[ids[i]]
    s.currentStreamText = historyChunk.repeat(msgsPerSession)
    scheduleRender(ids[i])
  }

  // Start streaming on the first `streamingCount` sessions
  const streamers = ids.slice(0, streamingCount).map(id => ({
    id,
    cursor: 0,
    timer: null,
  }))

  startRecording()

  for (const st of streamers) {
    st.timer = setInterval(() => {
      const s = state.sessions[st.id]
      if (!s) return
      const event = events[st.cursor % events.length]
      st.cursor++
      if (event?.event?.delta?.text) {
        s.currentStreamText += event.event.delta.text
        scheduleRender(st.id)
      }
    }, deltaIntervalMs)
  }

  await new Promise(r => setTimeout(r, durationMs))

  // Stop streamers
  for (const st of streamers) clearInterval(st.timer)

  const metrics = stopRecording()
  const result = {
    scenario: label,
    ts: new Date().toISOString(),
    n,
    streamingCount,
    msgsPerSession,
    durationMs,
    deltaIntervalMs,
    ...metrics,
  }

  console.log('[stress] result:', JSON.stringify(result, null, 2))
  await appendResult(result)

  // Teardown
  for (const id of ids) _teardownHarnessSession(id)
  return result
}

// ─── Scenario: pty-heavy ─────────────────────────────────────────────────────

export async function runPtyHeavy(n = 6, opts = {}) {
  const durationMs = opts.durationMs ?? 60_000
  const label = opts.label ?? 'pty-heavy'
  const cmd = opts.cmd ?? 'yes "xxxxxxxx"\r'
  const cwd = opts.cwd ?? '/tmp'

  console.log(`[stress] runPtyHeavy n=${n} duration=${durationMs}ms label=${label}`)

  const ids = []
  const cleanups = []
  let bytesReceived = 0

  for (let i = 0; i < n; i++) {
    const id = `stress-pty-${Date.now()}-${i}`
    ids.push(id)
    // Minimal data sink so IPC delivery is exercised but we don't render to xterm
    const cleanup = window.ace.pty.onData(id, data => {
      bytesReceived += typeof data === 'string' ? data.length : 0
    })
    cleanups.push(cleanup)
    try {
      await window.ace.pty.create(id, cwd, 80, 24)
    } catch (e) {
      console.error(`[stress] pty.create failed for ${id}:`, e)
    }
  }

  // Let shells initialize
  await new Promise(r => setTimeout(r, 500))

  startRecording()

  // Start the high-rate producer in each session
  for (const id of ids) {
    window.ace.pty.write(id, cmd)
  }

  await new Promise(r => setTimeout(r, durationMs))

  // Stop: send SIGINT (Ctrl-C) to each, then kill
  for (const id of ids) {
    try { window.ace.pty.write(id, '\x03') } catch {}
  }
  await new Promise(r => setTimeout(r, 200))
  for (const id of ids) {
    try { window.ace.pty.kill(id) } catch {}
  }

  const metrics = stopRecording()
  const result = {
    scenario: label,
    ts: new Date().toISOString(),
    n,
    durationMs,
    bytesReceivedMB: +(bytesReceived / 1024 / 1024).toFixed(1),
    ...metrics,
  }

  console.log('[stress] result:', JSON.stringify(result, null, 2))
  await appendResult(result)

  for (const cleanup of cleanups) { try { cleanup() } catch {} }
  return result
}

// ─── Combined / future scenarios are added here ──────────────────────────────

export const _internal = { startRecording, stopRecording, loadFixture }
