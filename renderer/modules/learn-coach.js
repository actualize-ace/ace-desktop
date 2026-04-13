// renderer/modules/learn-coach.js
// Spotlight overlay for tutorial "Try it" steps.
//
// Mounts a fixed, full-viewport backdrop at document.body with an SVG cutout
// around each target element and a positioned tooltip. Advances through a list
// of targets on Next click; Escape cancels. Mounting at body root escapes the
// titlebar `-webkit-app-region: drag` zone so clicks aren't eaten by the OS.

let active = null

export function startSpotlight({ targets, onComplete, onCancel }) {
  if (!Array.isArray(targets) || targets.length === 0) return
  if (active) stopSpotlight()

  let idx = 0

  const backdrop = document.createElement('div')
  backdrop.className = 'learn-coach-backdrop'
  backdrop.innerHTML = `
    <svg class="learn-coach-svg" xmlns="http://www.w3.org/2000/svg">
      <defs>
        <mask id="learn-coach-mask">
          <rect x="0" y="0" width="100%" height="100%" fill="white"/>
          <rect id="learn-coach-cutout" fill="black" rx="10" ry="10"/>
        </mask>
      </defs>
      <rect x="0" y="0" width="100%" height="100%" fill="rgba(0,0,0,0.62)" mask="url(#learn-coach-mask)"/>
      <rect id="learn-coach-ring" class="learn-coach-ring" fill="none" rx="10" ry="10"/>
    </svg>
    <div class="learn-coach-tooltip" role="dialog" aria-live="polite">
      <div class="learn-coach-tip-body"></div>
      <div class="learn-coach-tip-nav">
        <span class="learn-coach-progress"></span>
        <button class="learn-coach-skip" type="button">Skip</button>
        <button class="learn-coach-next" type="button">Next</button>
      </div>
    </div>
  `
  document.body.appendChild(backdrop)

  const onKey = (e) => {
    if (e.key === 'Escape') cancel()
    else if (e.key === 'Enter') advance()
  }

  const onResize = () => { positionStep() }

  document.addEventListener('keydown', onKey)
  window.addEventListener('resize', onResize)
  window.addEventListener('scroll', onResize, true)

  backdrop.querySelector('.learn-coach-next').addEventListener('click', advance)
  backdrop.querySelector('.learn-coach-skip').addEventListener('click', cancel)

  active = { backdrop, cleanup }
  console.log('[learn-coach] startSpotlight: targets=', targets.map(t => t.selector))
  positionStep()

  async function positionStep() {
    const target = targets[idx]
    if (!target || !target.selector) return advance()

    console.log(`[learn-coach] step ${idx + 1}/${targets.length} — waiting for`, target.selector)
    const el = await waitForSelector(target.selector, 3000)
    if (!el) {
      console.warn('[learn-coach] target not found:', target.selector)
      showToast(`Spotlight target missing: ${target.selector}`)
      return advance()
    }

    // Scroll target into view if it's off-screen (below the fold / above),
    // then wait for the scroll to settle before measuring.
    const firstRect = el.getBoundingClientRect()
    const vh = window.innerHeight
    const offscreen = firstRect.bottom > vh || firstRect.top < 0
    if (offscreen) {
      console.log('[learn-coach] target off-screen, scrolling into view')
      el.scrollIntoView({ block: 'center', inline: 'nearest', behavior: 'auto' })
      await new Promise(r => setTimeout(r, 120))
    }

    const rect = el.getBoundingClientRect()
    console.log('[learn-coach] target found. rect=', {
      x: Math.round(rect.left), y: Math.round(rect.top),
      w: Math.round(rect.width), h: Math.round(rect.height),
    })

    // Guard against zero-dimension targets (element exists but isn't laid out).
    if (rect.width < 2 || rect.height < 2) {
      console.warn('[learn-coach] target has zero dimensions, skipping step')
      showToast(`Spotlight target "${target.selector}" not visible yet — skipping.`)
      return advance()
    }

    const pad = 8
    const cutout = backdrop.querySelector('#learn-coach-cutout')
    const ring = backdrop.querySelector('#learn-coach-ring')
    const x = Math.max(0, rect.left - pad)
    const y = Math.max(0, rect.top - pad)
    const w = Math.max(0, rect.width + pad * 2)
    const h = Math.max(0, rect.height + pad * 2)
    cutout.setAttribute('x', x)
    cutout.setAttribute('y', y)
    cutout.setAttribute('width', w)
    cutout.setAttribute('height', h)
    ring.setAttribute('x', x)
    ring.setAttribute('y', y)
    ring.setAttribute('width', w)
    ring.setAttribute('height', h)
    // Retrigger the pulse animation for this step.
    ring.classList.remove('learn-coach-ring-pulse')
    // eslint-disable-next-line no-unused-expressions
    void ring.getBoundingClientRect()
    ring.classList.add('learn-coach-ring-pulse')

    const tip = backdrop.querySelector('.learn-coach-tooltip')
    backdrop.querySelector('.learn-coach-tip-body').textContent = target.tooltip || ''
    backdrop.querySelector('.learn-coach-progress').textContent = `${idx + 1} / ${targets.length}`
    backdrop.querySelector('.learn-coach-next').textContent =
      idx === targets.length - 1 ? 'Got it' : 'Next'

    // Position tooltip twice: once with estimated, once after layout settles.
    positionTooltip(tip, rect)
    requestAnimationFrame(() => {
      positionTooltip(tip, rect)
      const tr = tip.getBoundingClientRect()
      console.log('[learn-coach] tooltip positioned at', {
        left: Math.round(tr.left), top: Math.round(tr.top),
        w: Math.round(tr.width), h: Math.round(tr.height),
      })
    })
  }

  function advance() {
    if (idx === targets.length - 1) {
      cleanup()
      try { onComplete?.() } catch (e) { console.warn('[learn-coach] onComplete threw', e) }
    } else {
      idx++
      positionStep()
    }
  }

  function cancel() {
    cleanup()
    try { onCancel?.() } catch (e) { console.warn('[learn-coach] onCancel threw', e) }
  }

  function cleanup() {
    if (!active) return
    document.removeEventListener('keydown', onKey)
    window.removeEventListener('resize', onResize)
    window.removeEventListener('scroll', onResize, true)
    backdrop.remove()
    active = null
  }
}

export function stopSpotlight() {
  if (active?.cleanup) active.cleanup()
}

function positionTooltip(tooltip, targetRect) {
  const vw = window.innerWidth
  const vh = window.innerHeight
  const margin = 16
  const gap = 16

  // Measure after rendering
  tooltip.style.visibility = 'hidden'
  tooltip.style.left = '0px'
  tooltip.style.top = '0px'
  const tipRect = tooltip.getBoundingClientRect()

  // Preferred: below the target
  let top = targetRect.bottom + gap
  let left = targetRect.left

  // Flip above if no room below
  if (top + tipRect.height > vh - margin) {
    const above = targetRect.top - tipRect.height - gap
    if (above >= margin) {
      top = above
    } else {
      // Neither fits cleanly — clamp to viewport
      top = Math.max(margin, vh - tipRect.height - margin)
    }
  }

  // Clamp horizontally
  if (left + tipRect.width > vw - margin) left = vw - tipRect.width - margin
  if (left < margin) left = margin

  tooltip.style.left = `${Math.round(left)}px`
  tooltip.style.top = `${Math.round(top)}px`
  tooltip.style.visibility = ''
}

async function waitForSelector(selector, timeoutMs = 3000) {
  const start = Date.now()
  while (Date.now() - start < timeoutMs) {
    const el = document.querySelector(selector)
    if (el) {
      const rect = el.getBoundingClientRect()
      // Require non-zero dimensions — otherwise the element exists in DOM but
      // its parent view isn't visible yet (or layout hasn't settled).
      if (rect.width >= 2 && rect.height >= 2) return el
    }
    await new Promise(r => setTimeout(r, 80))
  }
  // Final fallback: return the element even if zero-size, so the caller can
  // decide what to do (positionStep will skip the step and toast).
  return document.querySelector(selector)
}

function showToast(message) {
  const t = document.createElement('div')
  t.className = 'learn-coach-toast'
  t.textContent = message
  document.body.appendChild(t)
  setTimeout(() => {
    t.classList.add('leaving')
    setTimeout(() => t.remove(), 300)
  }, 2500)
}
