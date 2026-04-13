// renderer/modules/welcome.js
// First-boot welcome — a brief, somatic entrance animation shown once after
// a user finishes setup and lands in the main app for the first time.
//
// Design: full-viewport dark overlay, centered ACE mark, slow gold halo
// breath, fade out over ~2.2s total. Non-blocking for interaction.

import { aceMarkSvg } from './ace-mark.js'

let played = false

export function playWelcome() {
  if (played) return
  played = true

  const overlay = document.createElement('div')
  overlay.className = 'ace-welcome-overlay'
  overlay.innerHTML = `
    <div class="ace-welcome-halo"></div>
    <div class="ace-welcome-mark">${aceMarkSvg(140)}</div>
    <div class="ace-welcome-caption">Welcome</div>
  `
  document.body.appendChild(overlay)

  // Trigger fade-in on next frame so the CSS transition kicks in.
  requestAnimationFrame(() => {
    overlay.classList.add('ace-welcome-in')
  })

  // After the sequence, fade out and remove.
  setTimeout(() => {
    overlay.classList.add('ace-welcome-out')
    overlay.classList.remove('ace-welcome-in')
  }, 1500)

  setTimeout(() => {
    overlay.remove()
  }, 2400)
}
