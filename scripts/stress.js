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

// ─── Helpers ─────────────────────────────────────────────────────────────────

async function _snapshot() {
  try {
    if (window.ace?.stress?.snapshot) return await window.ace.stress.snapshot()
  } catch {}
  return null
}

function _domNodeCount() {
  return document.querySelectorAll('*').length
}

// Simple linear regression slope (y per x unit) over an array of {x, y} pairs.
function _slope(samples) {
  const n = samples.length
  if (n < 2) return 0
  const sumX = samples.reduce((a, s) => a + s.x, 0)
  const sumY = samples.reduce((a, s) => a + s.y, 0)
  const sumXY = samples.reduce((a, s) => a + s.x * s.y, 0)
  const sumX2 = samples.reduce((a, s) => a + s.x * s.x, 0)
  return (n * sumXY - sumX * sumY) / (n * sumX2 - sumX * sumX)
}

// ─── Scenario 0.1: multi-session churn ───────────────────────────────────────

export async function runChurn(cycles = 50, opts = {}) {
  const label = opts.label ?? 'churn'
  const streamEventsPerCycle = opts.streamEventsPerCycle ?? 30

  console.log(`[stress] runChurn cycles=${cycles}`)

  const events = await loadFixture(opts.fixturePath)
  const rssSamples = []
  const domSamples = []
  let listenerWarnFired = false

  for (let i = 0; i < cycles; i++) {
    const id = `stress-churn-${Date.now()}-${i}`
    _createHarnessChatSession(id)

    // Simulate one short streaming response
    const s = state.sessions[id]
    for (let j = 0; j < streamEventsPerCycle; j++) {
      const ev = events[j % events.length]
      if (ev?.event?.delta?.text) {
        s.currentStreamText += ev.event.delta.text
        scheduleRender(id)
      }
    }
    // Wait one rAF so the render actually runs
    await new Promise(r => requestAnimationFrame(r))

    _teardownHarnessSession(id)

    const snap = await _snapshot()
    const rssMB = snap ? +(snap.rss / 1024 / 1024).toFixed(1) : null
    const dom = _domNodeCount()
    rssSamples.push({ x: i, y: rssMB ?? 0 })
    domSamples.push({ x: i, y: dom })

    if (snap) {
      if (i === 0) console.log(`[stress] churn cycle 0: DOM=${dom} RSS=${rssMB}MB`)
      if (i === cycles - 1) console.log(`[stress] churn cycle ${i}: DOM=${dom} RSS=${rssMB}MB`)
    }

    // Warn if DOM keeps growing past cycle 10
    if (i === 10 && domSamples[10].y > domSamples[0].y * 1.2 && !listenerWarnFired) {
      console.warn('[stress] DOM count still growing at cycle 10 — possible leak')
      listenerWarnFired = true
    }
  }

  const rssSlopeMBPerCycle = _slope(rssSamples.filter(s => s.y > 0))
  const domSlopePerCycle = _slope(domSamples)

  const result = {
    scenario: label,
    ts: new Date().toISOString(),
    cycles,
    rssSlopeMBPerCycle: +rssSlopeMBPerCycle.toFixed(3),
    domSlopePerCycle: +domSlopePerCycle.toFixed(1),
    domFinal: domSamples[domSamples.length - 1]?.y ?? null,
    rssFinalMB: rssSamples[rssSamples.length - 1]?.y ?? null,
    pass: Math.abs(rssSlopeMBPerCycle) < 5 && Math.abs(domSlopePerCycle) < 5,
  }

  console.log('[stress] result:', JSON.stringify(result, null, 2))
  await appendResult(result)
  return result
}

// ─── Scenario 0.2: long-uptime drift ─────────────────────────────────────────

export async function runUptime(opts = {}) {
  const durationMs = opts.durationMs ?? 8 * 60 * 60 * 1000
  const sampleIntervalMs = opts.sampleIntervalMs ?? 60_000
  const label = opts.label ?? 'uptime'

  console.log(`[stress] runUptime duration=${durationMs}ms sampleInterval=${sampleIntervalMs}ms`)

  const id = `stress-uptime-${Date.now()}`
  _createHarnessChatSession(id)

  const samples = []
  const t0 = performance.now()

  const interval = setInterval(async () => {
    const elapsed = performance.now() - t0
    const snap = await _snapshot()
    const heapMB = performance.memory?.usedJSHeapSize
      ? +(performance.memory.usedJSHeapSize / 1024 / 1024).toFixed(1)
      : null
    samples.push({
      elapsedMs: +elapsed.toFixed(0),
      rssMB: snap ? +(snap.rss / 1024 / 1024).toFixed(1) : null,
      heapMB,
      dom: _domNodeCount(),
    })
  }, sampleIntervalMs)

  await new Promise(r => setTimeout(r, durationMs))
  clearInterval(interval)
  _teardownHarnessSession(id)

  const rssValues = samples.map(s => s.rssMB).filter(v => v !== null)
  const plateauWindow = samples.slice(Math.floor(samples.length / 2))
  const rssStdDev = (() => {
    if (plateauWindow.length < 2) return null
    const vals = plateauWindow.map(s => s.rssMB).filter(v => v !== null)
    const mean = vals.reduce((a, v) => a + v, 0) / vals.length
    const variance = vals.reduce((a, v) => a + (v - mean) ** 2, 0) / vals.length
    return +Math.sqrt(variance).toFixed(2)
  })()

  const rssSlopeMBPerMin = _slope(
    samples.filter(s => s.rssMB !== null).map(s => ({ x: s.elapsedMs / 60000, y: s.rssMB }))
  )

  const result = {
    scenario: label,
    ts: new Date().toISOString(),
    durationMs,
    sampleCount: samples.length,
    rssStartMB: rssValues[0] ?? null,
    rssEndMB: rssValues[rssValues.length - 1] ?? null,
    rssSlopeMBPerMin: +rssSlopeMBPerMin.toFixed(4),
    rssSecondHalfStdDev: rssStdDev,
    samples,
  }

  console.log('[stress] result:', JSON.stringify({ ...result, samples: `[${result.sampleCount} samples]` }, null, 2))
  await appendResult(result)
  return result
}

// ─── Scenario 0.3: wake-from-sleep ────────────────────────────────────────────

export async function runSleepWake(opts = {}) {
  const timeoutMs = opts.timeoutMs ?? 15 * 60 * 1000
  const label = opts.label ?? 'sleep-wake'

  console.log('[stress] runSleepWake — put the machine to sleep now (timeout:', timeoutMs / 1000 + 's)')

  let cleanup
  const t0 = performance.now()

  const result = await new Promise((resolve) => {
    const timer = setTimeout(() => {
      resolve({ scenario: label, ts: new Date().toISOString(), timedOut: true, timeoutMs })
    }, timeoutMs)

    cleanup = window.ace.stress.onWake(({ wakeAt, sleepMs }) => {
      clearTimeout(timer)
      const timeToWakeHandlerMs = +(performance.now() - t0).toFixed(0)
      resolve({
        scenario: label,
        ts: new Date().toISOString(),
        sleepMs,
        timeToWakeHandlerMs,
        note: 'time-to-first-frame requires manual observation after wake',
      })
    })
  })

  cleanup?.()
  console.log('[stress] result:', JSON.stringify(result, null, 2))
  await appendResult(result)
  return result
}

// ─── Scenario 0.4: MCP spawn timing ──────────────────────────────────────────

export async function runMcpSpawn(opts = {}) {
  const label = opts.label ?? 'mcp-spawn'
  const prompt = opts.prompt ?? 'Reply with only the word "ok".'
  const timeoutMs = opts.timeoutMs ?? 60_000
  const chatId = `stress-mcp-${Date.now()}`

  console.log(`[stress] runMcpSpawn chatId=${chatId}`)

  const t0 = performance.now()
  let tSpawnStatus = null
  let tFirstStream = null

  const result = await new Promise((resolve) => {
    const timer = setTimeout(() => {
      window.ace.chat.cancel(chatId)
      resolve({ scenario: label, ts: new Date().toISOString(), timedOut: true, timeoutMs })
    }, timeoutMs)

    const cleanupSpawn = window.ace.chat.onSpawnStatus(chatId, () => {
      if (tSpawnStatus === null) tSpawnStatus = +(performance.now() - t0).toFixed(1)
    })

    const cleanupStream = window.ace.chat.onStream(chatId, () => {
      if (tFirstStream !== null) return
      tFirstStream = +(performance.now() - t0).toFixed(1)
      clearTimeout(timer)
      window.ace.chat.cancel(chatId)
      cleanupSpawn()
      cleanupStream()
      resolve({
        scenario: label,
        ts: new Date().toISOString(),
        spawnStatusMs: tSpawnStatus,
        firstStreamMs: tFirstStream,
        // spawn → MCP init → first token are all inside firstStreamMs;
        // spawnStatusMs isolates the process-spawn acknowledgment alone.
      })
    })

    const cleanupError = window.ace.chat.onError(chatId, (msg) => {
      clearTimeout(timer)
      cleanupSpawn()
      cleanupStream()
      cleanupError()
      resolve({ scenario: label, ts: new Date().toISOString(), error: msg })
    })

    window.ace.chat.send(chatId, prompt, null, {}).catch(err => {
      clearTimeout(timer)
      cleanupSpawn()
      cleanupStream()
      cleanupError()
      resolve({ scenario: label, ts: new Date().toISOString(), error: err.message })
    })
  })

  console.log('[stress] result:', JSON.stringify(result, null, 2))
  await appendResult(result)
  return result
}

// ─── Scenario 0.5: cold-start TTI ────────────────────────────────────────────

// On module init: if we just relaunched from a cold-start, capture and log TTI.
;(function _checkColdStartRelaunch() {
  const flag = localStorage.getItem('__stress_cold_start_initiated')
  if (!flag) return
  localStorage.removeItem('__stress_cold_start_initiated')
  const navEntry = performance.getEntriesByType('navigation')[0]
  const tti = navEntry
    ? +(navEntry.domInteractive - navEntry.startTime).toFixed(1)
    : +(performance.timing.domInteractive - performance.timing.navigationStart).toFixed(1)
  const result = { scenario: 'cold-start-cold', tti, ts: new Date().toISOString() }
  console.log('[stress] cold-start cold TTI:', tti + 'ms')
  appendResult(result).catch(() => {})
})()

export async function runColdStart() {
  const label = 'cold-start-warm'

  // Measure warm-start TTI from this session's navigation timing.
  const navEntry = performance.getEntriesByType('navigation')[0]
  const warmTti = navEntry
    ? +(navEntry.domInteractive - navEntry.startTime).toFixed(1)
    : +(performance.timing.domInteractive - performance.timing.navigationStart).toFixed(1)

  console.log(`[stress] runColdStart — warm TTI=${warmTti}ms; clearing cache + relaunching for cold measurement`)

  // Tag localStorage so the next boot captures cold TTI.
  localStorage.setItem('__stress_cold_start_initiated', String(Date.now()))

  // Trigger cache clear + relaunch.
  try {
    const res = await window.ace.stress.coldStart()
    if (!res?.ok) {
      localStorage.removeItem('__stress_cold_start_initiated')
      console.warn('[stress] cold-start IPC failed:', res?.reason ?? res?.error)
    }
    // App will exit and relaunch; cold TTI logged on next boot via _checkColdStartRelaunch().
  } catch (e) {
    localStorage.removeItem('__stress_cold_start_initiated')
    console.warn('[stress] cold-start failed:', e.message)
  }

  const result = { scenario: label, ts: new Date().toISOString(), warmTti }
  console.log('[stress] result:', JSON.stringify(result, null, 2))
  await appendResult(result)
  return result
}

// ─── Combined / future scenarios are added here ──────────────────────────────

export const _internal = { startRecording, stopRecording, loadFixture }
