// renderer/modules/session-timer.js
// Lightweight per-session countdown timer. Opt-in via duration selector in session header.

const timers = {}  // sessionId → { intervalId, el }

export function startTimer(sessionId, durationMinutes) {
  if (timers[sessionId]) clearTimer(sessionId)

  let remaining = durationMinutes * 60  // seconds
  const el = document.getElementById('session-timer-' + sessionId)
  if (!el) return

  el.style.display = 'inline-flex'
  renderTime(el, remaining)

  const intervalId = setInterval(() => {
    remaining -= 1
    renderTime(el, remaining)

    if (remaining <= 300) el.classList.add('timer--warning')   // last 5 min
    if (remaining <= 60)  el.classList.add('timer--critical')  // last 1 min

    if (remaining <= 0) {
      clearInterval(intervalId)
      delete timers[sessionId]
      el.classList.add('timer--expired')
      el.textContent = 'Time'
      showSessionNudge()
    }
  }, 1000)

  timers[sessionId] = { intervalId, el }
}

export function clearTimer(sessionId) {
  if (!timers[sessionId]) return
  clearInterval(timers[sessionId].intervalId)
  const el = timers[sessionId].el
  if (el) { el.style.display = 'none'; el.className = 'session-timer' }
  delete timers[sessionId]
}

function renderTime(el, seconds) {
  const m = Math.floor(seconds / 60)
  const s = seconds % 60
  el.textContent = `${m}:${s.toString().padStart(2, '0')}`
}

function showSessionNudge() {
  // Reuse the toast from session-manager
  let toast = document.getElementById('ace-toast')
  if (!toast) {
    toast = document.createElement('div')
    toast.id = 'ace-toast'
    toast.className = 'ace-toast'
    document.body.appendChild(toast)
  }
  toast.textContent = 'Session time complete. Wrap up and close this chat when ready.'
  toast.classList.add('ace-toast--visible')
  toast.style.borderColor = 'var(--amber, #f9e2af)'
  clearTimeout(toast._hideTimer)
  toast._hideTimer = setTimeout(() => toast.classList.remove('ace-toast--visible'), 6000)
}
