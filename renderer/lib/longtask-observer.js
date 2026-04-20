// renderer/lib/longtask-observer.js
// When the main thread stalls ≥200 ms, dump a record to main process.
// Two detectors: PerformanceObserver (duration, no stack) + MessageChannel
// heartbeat (captures stack of whatever blocked the previous tick).

;(function initLongTaskObserver () {
  if (!window.ace || !window.ace.debug || !window.ace.debug.reportLongTask) return

  const THRESHOLD_MS = 200
  const HEARTBEAT_INTERVAL_MS = 100

  function collectContext () {
    const activeChatEls = document.querySelectorAll('[data-chat-id]')
    const activeChatIds = Array.from(activeChatEls).map(el => el.dataset.chatId)
    const visibleView = document.querySelector('.view.active')?.id || null
    const perf = performance.memory || {}
    return {
      uptimeMs: Math.round(performance.now()),
      domNodes: document.getElementsByTagName('*').length,
      activeChatCount: activeChatIds.length,
      activeChatIds: activeChatIds.slice(0, 8),
      visibleView,
      jsHeapMB: perf.usedJSHeapSize ? Math.round(perf.usedJSHeapSize / 1048576) : null,
    }
  }

  // --- Detector 1: PerformanceObserver ---------------------------------------
  try {
    const po = new PerformanceObserver((list) => {
      for (const entry of list.getEntries()) {
        if (entry.duration < THRESHOLD_MS) continue
        window.ace.debug.reportLongTask({
          source: 'performance-observer',
          durationMs: Math.round(entry.duration),
          entryName: entry.name,
          context: collectContext(),
        })
      }
    })
    po.observe({ entryTypes: ['longtask'] })
  } catch (err) {
    console.warn('[longtask] PerformanceObserver unavailable:', err.message)
  }

  // --- Detector 2: MessageChannel heartbeat ---------------------------------
  // Schedule a heartbeat every HEARTBEAT_INTERVAL_MS. When it fires late by
  // ≥THRESHOLD_MS, capture stack (which will include whatever ran right
  // before this tick could process).
  let lastScheduledAt = performance.now()
  const channel = new MessageChannel()
  channel.port1.onmessage = () => {
    const now = performance.now()
    const overrun = now - lastScheduledAt - HEARTBEAT_INTERVAL_MS
    if (overrun >= THRESHOLD_MS) {
      const stack = (new Error('longtask-heartbeat-overrun')).stack
      window.ace.debug.reportLongTask({
        source: 'heartbeat',
        overrunMs: Math.round(overrun),
        stack: stack ? stack.split('\n').slice(0, 30).join('\n') : null,
        context: collectContext(),
      })
    }
    lastScheduledAt = performance.now()
    setTimeout(() => channel.port2.postMessage(null), HEARTBEAT_INTERVAL_MS)
  }
  setTimeout(() => channel.port2.postMessage(null), HEARTBEAT_INTERVAL_MS)

  console.log('[longtask] observer active — threshold', THRESHOLD_MS, 'ms')
})()
