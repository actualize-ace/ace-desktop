// renderer/modules/coherence.js
// Singleton — connects to heartmath-bridge.py, computes coherence from R-R intervals.
// Consumed by atmosphere.js (somatic bar) and breath.js (HUD).

const WS_URL = 'ws://localhost:8765'
const RECONNECT_MS = 3000
const RR_MIN = 300   // 200bpm hard floor
const RR_MAX = 2000  // 30bpm hard ceiling
const RR_JUMP = 0.25 // 25% deviation = artifact
const WINDOW_MS = 64000 // 64s rolling window for FFT
const FS = 4 // 4Hz interpolation

export const coherenceState = {
  connected: false,
  scanning: false,
  hr: 0,
  coherence: 0,       // raw ratio (0-1)
  coherenceLevel: '', // 'low' | 'med' | 'high' | ''
  battery: 0,
  rrWindow: [],       // clean R-R intervals for coherence computation
  rrStrip: [],        // last 80 R-R values for waveform display
}

const listeners = { update: [], heartbeat: [] }
let ws = null
let reconnectTimer = null
let initialized = false

// ── Public API ──

export function initCoherence() {
  if (initialized) return
  initialized = true
  connect()
}

export function onCoherenceUpdate(fn) { listeners.update.push(fn) }
export function onHeartbeat(fn) { listeners.heartbeat.push(fn) }

function emit(type) {
  for (const fn of listeners[type]) fn(coherenceState)
}

// ── WebSocket ──

function connect() {
  if (ws && (ws.readyState === WebSocket.OPEN || ws.readyState === WebSocket.CONNECTING)) return
  try {
    ws = new WebSocket(WS_URL)
    ws.onopen = () => {
      coherenceState.scanning = true
      emit('update')
    }
    ws.onmessage = (e) => handleMessage(JSON.parse(e.data))
    ws.onclose = () => {
      if (coherenceState.connected || coherenceState.scanning) {
        coherenceState.connected = false
        coherenceState.scanning = false
        coherenceState.hr = 0
        coherenceState.coherence = 0
        coherenceState.coherenceLevel = ''
        coherenceState.rrWindow = []
        coherenceState.rrStrip = []
        emit('update')
      }
      scheduleReconnect()
    }
    ws.onerror = () => ws.close()
  } catch (_) {
    scheduleReconnect()
  }
}

function scheduleReconnect() {
  if (reconnectTimer) return
  reconnectTimer = setTimeout(() => {
    reconnectTimer = null
    connect()
  }, RECONNECT_MS)
}

// ── Message handling ──

function handleMessage(msg) {
  if (msg.type === 'status') {
    if (msg.connected) {
      coherenceState.connected = true
      coherenceState.scanning = false
      coherenceState.battery = msg.battery || 0
    } else {
      coherenceState.connected = false
      coherenceState.scanning = true
      coherenceState.rrWindow = []
      coherenceState.rrStrip = []
    }
    emit('update')
  } else if (msg.type === 'hr') {
    coherenceState.hr = msg.hr
    coherenceState.battery = msg.battery || coherenceState.battery
    if (msg.rr && msg.rr.length > 0) {
      for (const rr of msg.rr) {
        if (filterRR(rr)) {
          coherenceState.rrWindow.push(rr)
          coherenceState.rrStrip.push(rr)
        }
      }
      // Trim strip buffer
      if (coherenceState.rrStrip.length > 80) {
        coherenceState.rrStrip = coherenceState.rrStrip.slice(-80)
      }
      // Trim window to ~64s
      let totalMs = 0
      let start = coherenceState.rrWindow.length - 1
      while (start > 0 && totalMs < WINDOW_MS) {
        totalMs += coherenceState.rrWindow[start]
        start--
      }
      if (start > 0) coherenceState.rrWindow = coherenceState.rrWindow.slice(start)

      // Compute coherence
      coherenceState.coherence = computeCoherence(coherenceState.rrWindow)
      if (coherenceState.coherence > 0.6) coherenceState.coherenceLevel = 'high'
      else if (coherenceState.coherence > 0.3) coherenceState.coherenceLevel = 'med'
      else coherenceState.coherenceLevel = 'low'

      emit('heartbeat')
    }
    emit('update')
  }
}

// ── Artifact rejection ──

function filterRR(rr) {
  if (rr < RR_MIN || rr > RR_MAX) return false
  const buf = coherenceState.rrWindow
  if (buf.length >= 3) {
    const recent = buf.slice(-5)
    const avg = recent.reduce((a, b) => a + b, 0) / recent.length
    if (Math.abs(rr - avg) / avg > RR_JUMP) return false
  }
  return true
}

// ── FFT Coherence Engine ──
// Based on HeartMath 2014: 64s window, 4Hz interpolation, Hann, FFT, peak-in-band ratio.

function computeCoherence(rrIntervals) {
  if (rrIntervals.length < 16) return 0

  // Build time array
  const times = [0]
  for (let i = 0; i < rrIntervals.length; i++) {
    times.push(times[i] + rrIntervals[i] / 1000)
  }
  const totalTime = times[times.length - 1]
  const numSamples = Math.floor(totalTime * FS)
  if (numSamples < 8) return 0

  // Midpoint times + values
  const rrTimes = []
  const rrVals = []
  for (let i = 0; i < rrIntervals.length; i++) {
    rrTimes.push((times[i] + times[i + 1]) / 2)
    rrVals.push(rrIntervals[i])
  }

  // Linear interpolation to 4Hz grid
  const signal = []
  for (let i = 0; i < numSamples; i++) {
    const t = i / FS
    let j = 0
    while (j < rrTimes.length - 1 && rrTimes[j + 1] < t) j++
    if (j >= rrTimes.length - 1) signal.push(rrVals[rrVals.length - 1])
    else {
      const frac = (t - rrTimes[j]) / (rrTimes[j + 1] - rrTimes[j])
      signal.push(rrVals[j] + frac * (rrVals[j + 1] - rrVals[j]))
    }
  }

  // Detrend
  const mean = signal.reduce((a, b) => a + b, 0) / signal.length
  const detrended = signal.map(v => v - mean)

  // Hann window
  const windowed = detrended.map((v, i) => {
    const w = 0.5 * (1 - Math.cos(2 * Math.PI * i / (detrended.length - 1)))
    return v * w
  })

  // Zero-pad to next power of 2 × 2
  let n = 1
  while (n < windowed.length) n *= 2
  n *= 2
  const real = new Array(n).fill(0)
  const imag = new Array(n).fill(0)
  for (let i = 0; i < windowed.length; i++) real[i] = windowed[i]

  // Cooley-Tukey FFT
  fft(real, imag, n)

  // Power spectrum + peak finding in 0.04-0.26Hz
  const freqRes = FS / n
  let totalPower = 0
  let peakFreqIdx = 0
  let peakPower = 0
  for (let i = 1; i < n / 2; i++) {
    const p = (real[i] * real[i] + imag[i] * imag[i]) / n
    totalPower += p
    const freq = i * freqRes
    if (freq >= 0.04 && freq <= 0.26 && p > peakPower) {
      peakPower = p
      peakFreqIdx = i
    }
  }

  if (totalPower === 0 || peakPower === 0) return 0

  // Integrate 0.030Hz window around peak
  const halfWindow = Math.ceil(0.015 / freqRes)
  let peakBandPower = 0
  for (let i = Math.max(1, peakFreqIdx - halfWindow); i <= Math.min(n / 2 - 1, peakFreqIdx + halfWindow); i++) {
    peakBandPower += (real[i] * real[i] + imag[i] * imag[i]) / n
  }

  return Math.min(1, peakBandPower / totalPower)
}

// Cooley-Tukey radix-2 in-place FFT
function fft(real, imag, n) {
  // Bit-reversal permutation
  for (let i = 1, j = 0; i < n; i++) {
    let bit = n >> 1
    for (; j & bit; bit >>= 1) j ^= bit
    j ^= bit
    if (i < j) {
      [real[i], real[j]] = [real[j], real[i]];
      [imag[i], imag[j]] = [imag[j], imag[i]]
    }
  }
  // FFT
  for (let len = 2; len <= n; len *= 2) {
    const angle = -2 * Math.PI / len
    const wR = Math.cos(angle)
    const wI = Math.sin(angle)
    for (let i = 0; i < n; i += len) {
      let curR = 1, curI = 0
      for (let j = 0; j < len / 2; j++) {
        const uR = real[i + j], uI = imag[i + j]
        const vR = real[i + j + len / 2] * curR - imag[i + j + len / 2] * curI
        const vI = real[i + j + len / 2] * curI + imag[i + j + len / 2] * curR
        real[i + j] = uR + vR
        imag[i + j] = uI + vI
        real[i + j + len / 2] = uR - vR
        imag[i + j + len / 2] = uI - vI
        const tmpR = curR * wR - curI * wI
        curI = curR * wI + curI * wR
        curR = tmpR
      }
    }
  }
}
