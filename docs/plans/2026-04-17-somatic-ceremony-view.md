# Somatic Ceremony View — Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Add a ceremony view that plays animated start-of-day and end-of-day transitions, triggered by time-aware somatic cues on the sidebar mark and somatic bar.

**Architecture:** New overlay view (`ceremony.js` + `ceremony.css`) lives outside the normal nav system — it mounts on top of the current view, plays the animation, then unmounts and routes to the destination. Detection logic lives in `atmosphere.js`. ACE mark gains dawn/settle glow states. Somatic bar gains ceremony-ready text mode.

**Tech Stack:** Vanilla JS (module pattern), CSS animations (GPU-only: transform, opacity, filter), ace-config.json for persistence.

**Important:** ace-desktop has no test framework. All verification is manual via `npm start` + DevTools. One change at a time — verify between each edit.

---

### Task 1: Add ceremony state and config fields

**Files:**
- Modify: `renderer/state.js` (add ceremony state block)
- No new files

**Step 1: Add ceremony state to state.js**

In `renderer/state.js`, add a `ceremony` block inside the exported `state` object, after the `atmosphere` block (after line ~77):

```javascript
  // Ceremony (somatic transition thresholds)
  ceremony: {
    style: 'ship-boot',           // 'eyes-open' | 'temple' | 'ship-boot'
    active: false,                // ceremony view currently mounted
    currentRitual: null,          // 'startOfDay' | 'endOfDay' | 'weeklyReview' | 'monthlyReflection'
    completedToday: new Set(),    // rituals completed today (reset at 5am)
    pendingCue: null,             // 'dawn' | 'settle' | null
    triggers: {
      startOfDay: true,
      endOfDay: true,
      weeklyReview: true,
      monthlyReflection: true,
    },
    skipAnimations: false,
  },
```

**Step 2: Verify**

Run: `npm start` from `ace-desktop/`
Expected: App launches normally. Open DevTools console, type `state` — confirm `ceremony` field exists.

**Step 3: Commit**

```bash
git add renderer/state.js
git commit -m "feat(ceremony): add ceremony state fields to state.js"
```

---

### Task 2: Create ceremony.css — all three transition styles + close

**Files:**
- Create: `renderer/styles/views/ceremony.css`

**Step 1: Create the ceremony CSS file**

Create `renderer/styles/views/ceremony.css` with the full ceremony styling. This is ported from the approved prototype (`docs/prototypes/somatic-transitions-prototype.html`), scoped under `#ceremony-overlay`.

```css
/* ═══════════════════════════════════════════════════════════════════
   CEREMONY VIEW — Somatic transition overlays
   Design doc: docs/plans/2026-04-17-somatic-ceremony-view-design.md
   Scoped under #ceremony-overlay
   ═══════════════════════════════════════════════════════════════════ */

/* ── Overlay container ── */
#ceremony-overlay {
  position: fixed;
  top: 0; left: 0; right: 0; bottom: 0;
  z-index: 8000;
  background: var(--bg-deep, #080a12);
  display: none;
  overflow: hidden;
}
#ceremony-overlay.active {
  display: block;
}

/* Skip hint */
#ceremony-overlay .ceremony-skip {
  position: absolute;
  bottom: 40px; right: 24px;
  font-family: var(--font-mono);
  font-size: 8px; letter-spacing: 0.1em;
  color: var(--text-whisper);
  opacity: 0; pointer-events: none;
  z-index: 8010;
  animation: ceremony-skip-in 0.4s ease 1.5s forwards;
}
@keyframes ceremony-skip-in {
  from { opacity: 0; }
  to { opacity: 0.5; }
}

/* ── Destination preview (cockpit mock rendered by JS) ── */
#ceremony-destination {
  position: absolute; inset: 0;
  opacity: 0;
  pointer-events: none;
}

/* ═══ STYLE A — "Eyes Open" (Meditation Emergence) ═══ */
#ceremony-overlay.style-eyes-open #ceremony-destination {
  filter: blur(20px) brightness(0.3);
  transform: scale(1.04);
}
#ceremony-overlay.style-eyes-open.arriving #ceremony-destination {
  opacity: 1;
  animation: ceremony-eyes-open 4s cubic-bezier(0.25, 0.46, 0.45, 0.94) forwards;
}
@keyframes ceremony-eyes-open {
  0%   { filter: blur(20px) brightness(0.3); transform: scale(1.04); }
  30%  { filter: blur(12px) brightness(0.5); transform: scale(1.025); }
  60%  { filter: blur(5px)  brightness(0.75); transform: scale(1.01); }
  80%  { filter: blur(2px)  brightness(0.9); transform: scale(1.005); }
  100% { filter: blur(0)    brightness(1);   transform: scale(1); }
}

/* Breath guide ring */
#ceremony-overlay .ceremony-breath-guide {
  position: absolute;
  top: 50%; left: 50%;
  transform: translate(-50%, -50%);
  z-index: 8005;
  display: flex; flex-direction: column;
  align-items: center; gap: 16px;
  opacity: 0; pointer-events: none;
}
#ceremony-overlay .ceremony-breath-ring {
  width: 120px; height: 120px;
  border: 1.5px solid rgba(200,160,240,0.3);
  border-radius: 50%;
}
#ceremony-overlay .ceremony-breath-text {
  font-family: var(--font-script);
  font-size: 16px; font-style: italic;
  color: var(--gold);
  opacity: 0.8;
}
#ceremony-overlay.style-eyes-open.arriving .ceremony-breath-guide {
  animation: ceremony-breath-appear 4s ease forwards;
}
@keyframes ceremony-breath-appear {
  0%   { opacity: 0; }
  15%  { opacity: 0.9; }
  50%  { opacity: 0.9; }
  75%  { opacity: 0.3; }
  100% { opacity: 0; }
}
#ceremony-overlay.style-eyes-open.arriving .ceremony-breath-ring {
  animation: ceremony-breath-expand 4s ease-in-out forwards;
}
@keyframes ceremony-breath-expand {
  0%   { transform: scale(0.7); border-color: rgba(200,160,240,0.15); }
  50%  { transform: scale(1.15); border-color: rgba(200,160,240,0.45); }
  100% { transform: scale(1.3); border-color: rgba(200,160,240,0); }
}

/* ═══ STYLE B — "Temple Threshold" (Door Reveal) ═══ */
#ceremony-overlay .ceremony-temple-doors {
  position: absolute; inset: 0;
  z-index: 8005; pointer-events: none;
  display: none;
}
#ceremony-overlay.style-temple .ceremony-temple-doors { display: block; }
#ceremony-overlay.style-temple #ceremony-destination { opacity: 1; }

.ceremony-door {
  position: absolute; top: 0; bottom: 0;
  width: 50%;
  background: var(--bg-deep, #080a12);
  will-change: transform;
}
.ceremony-door.left  { left: 0; }
.ceremony-door.right { right: 0; }

.ceremony-door::after {
  content: '';
  position: absolute; top: 8%; bottom: 8%;
  width: 1px;
  background: linear-gradient(180deg, transparent, rgba(200,160,240,0.3), rgba(96,216,168,0.2), rgba(200,160,240,0.3), transparent);
}
.ceremony-door.left::after  { right: 0; }
.ceremony-door.right::after { left: 0; }

.ceremony-temple-glyph {
  position: absolute;
  top: 50%; left: 50%;
  transform: translate(-50%, -50%);
  z-index: 8006;
  display: flex; flex-direction: column;
  align-items: center; gap: 12px;
  opacity: 0;
}
.ceremony-temple-glyph-mark {
  width: 48px; height: 48px;
  border: 1.5px solid rgba(200,160,240,0.35);
  border-radius: 50%;
  display: flex; align-items: center; justify-content: center;
  font-family: var(--font-display);
  font-size: 18px; font-weight: 300;
  color: var(--gold);
  text-shadow: 0 0 14px rgba(200,160,240,0.25);
}
.ceremony-temple-glyph-text {
  font-family: var(--font-mono);
  font-size: 8px; letter-spacing: 0.3em;
  text-transform: uppercase;
  color: var(--text-dim);
}

.ceremony-temple-seam {
  position: absolute;
  top: 0; bottom: 0;
  left: 50%; width: 2px;
  transform: translateX(-50%);
  background: linear-gradient(180deg, transparent 5%, rgba(200,160,240,0.6) 30%, rgba(96,216,168,0.4) 50%, rgba(200,160,240,0.6) 70%, transparent 95%);
  z-index: 8007;
  opacity: 0;
}

#ceremony-overlay.style-temple.arriving .ceremony-temple-glyph {
  animation: ceremony-glyph-flash 2.8s ease forwards;
}
@keyframes ceremony-glyph-flash {
  0%   { opacity: 0; transform: translate(-50%, -50%) scale(0.8); }
  15%  { opacity: 1; transform: translate(-50%, -50%) scale(1); }
  55%  { opacity: 1; }
  75%  { opacity: 0; }
  100% { opacity: 0; }
}
#ceremony-overlay.style-temple.arriving .ceremony-door.left {
  animation: ceremony-door-left 2.8s cubic-bezier(0.22, 0.61, 0.36, 1) 0.6s forwards;
}
#ceremony-overlay.style-temple.arriving .ceremony-door.right {
  animation: ceremony-door-right 2.8s cubic-bezier(0.22, 0.61, 0.36, 1) 0.6s forwards;
}
@keyframes ceremony-door-left  { to { transform: translateX(-100%); } }
@keyframes ceremony-door-right { to { transform: translateX(100%); } }

#ceremony-overlay.style-temple.arriving .ceremony-temple-seam {
  animation: ceremony-seam-glow 2.8s ease forwards;
}
@keyframes ceremony-seam-glow {
  0%   { opacity: 0; width: 1px; }
  20%  { opacity: 1; width: 3px; }
  50%  { opacity: 0.8; width: 40px; filter: blur(12px); }
  100% { opacity: 0; width: 100%; filter: blur(40px); }
}

/* ═══ STYLE C — "Ship Boot" (Systems Online) ═══ */
#ceremony-overlay .ceremony-scan-line {
  position: absolute; top: -2px; left: 0; right: 0;
  height: 2px;
  background: linear-gradient(90deg, transparent, rgba(200,160,240,0.6), rgba(96,216,168,0.4), rgba(200,160,240,0.6), transparent);
  z-index: 8008; opacity: 0; pointer-events: none;
  box-shadow: 0 0 20px rgba(200,160,240,0.4), 0 0 60px rgba(200,160,240,0.2);
  display: none;
}
#ceremony-overlay.style-ship-boot .ceremony-scan-line { display: block; }

#ceremony-overlay .ceremony-boot-overlay {
  position: absolute; inset: 0;
  z-index: 8005;
  display: none;
  flex-direction: column;
  justify-content: center;
  align-items: center;
  gap: 8px;
}
#ceremony-overlay.style-ship-boot .ceremony-boot-overlay { display: flex; }

.ceremony-boot-line {
  font-family: var(--font-mono);
  font-size: 9px; letter-spacing: 0.1em;
  color: var(--text-dim);
  opacity: 0;
  display: flex; align-items: center; gap: 8px;
}
.ceremony-boot-pip {
  width: 5px; height: 5px;
  border-radius: 50%;
  background: var(--text-whisper);
  transition: all 0.3s ease 0.15s;
  flex-shrink: 0;
}
.ceremony-boot-pip.on {
  background: var(--green);
  box-shadow: 0 0 8px rgba(96,216,168,0.25);
}
.ceremony-boot-line.final-line { color: var(--green); font-weight: 500; }

#ceremony-overlay.style-ship-boot.arriving .ceremony-scan-line {
  animation: ceremony-scan-sweep 2.5s ease-in-out forwards;
}
@keyframes ceremony-scan-sweep {
  0%   { top: -2px; opacity: 0; }
  10%  { opacity: 1; }
  90%  { opacity: 1; }
  100% { top: 100%; opacity: 0; }
}

#ceremony-overlay.style-ship-boot #ceremony-destination { opacity: 0; }
#ceremony-overlay.style-ship-boot.arriving .ceremony-boot-line:nth-child(1) { animation: ceremony-boot-in 0.35s ease 0.3s forwards; }
#ceremony-overlay.style-ship-boot.arriving .ceremony-boot-line:nth-child(2) { animation: ceremony-boot-in 0.35s ease 0.65s forwards; }
#ceremony-overlay.style-ship-boot.arriving .ceremony-boot-line:nth-child(3) { animation: ceremony-boot-in 0.35s ease 1.0s forwards; }
#ceremony-overlay.style-ship-boot.arriving .ceremony-boot-line:nth-child(4) { animation: ceremony-boot-in 0.35s ease 1.35s forwards; }
#ceremony-overlay.style-ship-boot.arriving .ceremony-boot-line:nth-child(5) { animation: ceremony-boot-in 0.35s ease 1.7s forwards; }
#ceremony-overlay.style-ship-boot.arriving .ceremony-boot-line:nth-child(6) { animation: ceremony-boot-in 0.35s ease 2.1s forwards; }
@keyframes ceremony-boot-in {
  from { opacity: 0; transform: translateY(4px); }
  to   { opacity: 1; transform: translateY(0); }
}
#ceremony-overlay.style-ship-boot.arriving .ceremony-boot-overlay {
  animation: ceremony-boot-fade 0.8s ease 3s forwards;
}
@keyframes ceremony-boot-fade {
  to { opacity: 0; pointer-events: none; }
}
#ceremony-overlay.style-ship-boot.arriving #ceremony-destination {
  animation: ceremony-power-on 1.5s ease 2.6s forwards;
}
@keyframes ceremony-power-on {
  0%   { opacity: 0; filter: brightness(0.2); }
  40%  { opacity: 0.6; filter: brightness(0.6); }
  100% { opacity: 1; filter: brightness(1); }
}

/* ═══ CLOSE / DEPARTURE ═══ */
#ceremony-overlay .ceremony-close-overlay {
  position: absolute; inset: 0;
  z-index: 8005;
  background: rgba(8,10,18,0);
  display: flex; flex-direction: column;
  align-items: center; justify-content: center;
  gap: 20px;
  opacity: 0; pointer-events: none;
}

.ceremony-close-ring {
  width: 90px; height: 90px;
  border-radius: 50%;
  border: 1.5px solid rgba(200,160,240,0.15);
  position: relative;
  display: flex; align-items: center; justify-content: center;
}
.ceremony-close-ring-progress {
  position: absolute; inset: -2px;
  border-radius: 50%;
  border: 2px solid transparent;
  border-top-color: var(--gold);
  border-right-color: rgba(200,160,240,0.3);
}
.ceremony-close-ring-check {
  font-size: 24px;
  color: var(--green);
  opacity: 0;
}
.ceremony-close-ring-label {
  font-family: var(--font-mono);
  font-size: 7px; letter-spacing: 0.2em;
  text-transform: uppercase;
  color: var(--gold);
  position: absolute;
}

.ceremony-close-stats {
  display: flex; gap: 28px;
  opacity: 0;
}
.ceremony-close-stat { text-align: center; }
.ceremony-close-stat-value {
  font-family: var(--font-display);
  font-size: 24px; font-weight: 300;
  color: var(--text-primary);
}
.ceremony-close-stat-label {
  font-family: var(--font-mono);
  font-size: 7px; letter-spacing: 0.2em;
  text-transform: uppercase;
  color: var(--text-dim);
  margin-top: 2px;
}

.ceremony-close-message {
  font-family: var(--font-script);
  font-size: 16px; font-style: italic;
  color: var(--gold);
  opacity: 0;
  letter-spacing: 0.03em;
}

#ceremony-overlay.departing .ceremony-close-overlay {
  animation: ceremony-close-appear 3s ease forwards;
}
@keyframes ceremony-close-appear {
  0%   { opacity: 0; background: rgba(8,10,18,0); }
  40%  { opacity: 1; background: rgba(8,10,18,0.5); }
  100% { background: rgba(8,10,18,0.88); }
}
#ceremony-overlay.departing .ceremony-close-ring-progress {
  animation: ceremony-close-spin 2.5s cubic-bezier(0.4, 0, 0.2, 1) forwards;
}
@keyframes ceremony-close-spin {
  from { transform: rotate(0); }
  to   { transform: rotate(360deg); }
}
#ceremony-overlay.departing .ceremony-close-ring-label {
  animation: ceremony-close-label-swap 2.8s ease forwards;
}
@keyframes ceremony-close-label-swap {
  0%, 85% { opacity: 1; }
  90%, 100% { opacity: 0; }
}
#ceremony-overlay.departing .ceremony-close-ring-check {
  animation: ceremony-close-check 0.4s ease 2.6s forwards;
}
@keyframes ceremony-close-check {
  from { opacity: 0; transform: scale(0.5); }
  to   { opacity: 1; transform: scale(1); }
}
#ceremony-overlay.departing .ceremony-close-stats {
  animation: ceremony-fade-slide-up 0.8s ease 1.4s forwards;
}
#ceremony-overlay.departing .ceremony-close-message {
  animation: ceremony-fade-slide-up 0.8s ease 2s forwards;
}
@keyframes ceremony-fade-slide-up {
  from { opacity: 0; transform: translateY(8px); }
  to   { opacity: 1; transform: translateY(0); }
}

#ceremony-overlay.departed {
  animation: ceremony-final-dim 1.5s ease forwards;
}
@keyframes ceremony-final-dim {
  to { opacity: 0; }
}

/* ── Accessibility ── */
@media (prefers-reduced-motion: reduce) {
  #ceremony-overlay *,
  #ceremony-overlay *::before,
  #ceremony-overlay *::after {
    animation-duration: 0.01ms !important;
    transition-duration: 0.01ms !important;
  }
}

/* ── ACE Mark ceremony glow states ── */
.sidebar-mark.ceremony-dawn .sidebar-mark-ring {
  border-color: rgba(212,165,116,0.3);
  box-shadow: 0 0 18px rgba(212,165,116,0.35), 0 0 40px rgba(212,165,116,0.15);
  animation: mark-dawn-breathe 5.5s ease-in-out infinite;
}
@keyframes mark-dawn-breathe {
  0%, 100% { box-shadow: 0 0 14px rgba(212,165,116,0.3), 0 0 30px rgba(212,165,116,0.1); }
  50%      { box-shadow: 0 0 24px rgba(212,165,116,0.5), 0 0 50px rgba(212,165,116,0.2); }
}

.sidebar-mark.ceremony-settle .sidebar-mark-ring {
  border-color: rgba(200,152,96,0.25);
  box-shadow: 0 0 18px rgba(200,152,96,0.3), 0 0 40px rgba(200,152,96,0.12);
  animation: mark-settle-breathe 7s ease-in-out infinite;
}
@keyframes mark-settle-breathe {
  0%, 100% { box-shadow: 0 0 14px rgba(200,152,96,0.25), 0 0 30px rgba(200,152,96,0.08); }
  50%      { box-shadow: 0 0 22px rgba(200,152,96,0.45), 0 0 45px rgba(200,152,96,0.18); }
}

/* ── Somatic bar ceremony-ready states ── */
.somatic-bar.ceremony-dawn #somatic-bar-text {
  color: var(--dawn-gold, #d4a574);
  cursor: pointer;
}
.somatic-bar.ceremony-settle #somatic-bar-text {
  color: var(--amber-settle, #c89860);
  cursor: pointer;
}
```

**Step 2: Link the stylesheet in index.html**

In `renderer/index.html`, find the existing view stylesheet links (search for `views/cockpit.css` or `views/breath.css`). Add after the last view stylesheet:

```html
<link rel="stylesheet" href="styles/views/ceremony.css">
```

**Step 3: Verify**

Run: `npm start`
Expected: App launches normally. No visual changes yet (ceremony overlay is `display: none` by default).

**Step 4: Commit**

```bash
git add renderer/styles/views/ceremony.css renderer/index.html
git commit -m "feat(ceremony): add ceremony.css with all three transition styles + close"
```

---

### Task 3: Add ceremony overlay HTML to index.html

**Files:**
- Modify: `renderer/index.html`

**Step 1: Add the ceremony overlay markup**

In `renderer/index.html`, add the overlay HTML **before** the closing `</body>` tag (or just before the `<script type="module">` block). This sits outside the normal `.view` system:

```html
<!-- ═══ Ceremony Overlay (somatic transitions) ═══ -->
<div id="ceremony-overlay">
  <!-- Style A: breath guide -->
  <div class="ceremony-breath-guide">
    <div class="ceremony-breath-ring"></div>
    <div class="ceremony-breath-text">settle in</div>
  </div>

  <!-- Style B: temple doors -->
  <div class="ceremony-temple-doors">
    <div class="ceremony-door left"></div>
    <div class="ceremony-door right"></div>
    <div class="ceremony-temple-seam"></div>
    <div class="ceremony-temple-glyph">
      <div class="ceremony-temple-glyph-mark">&#9670;</div>
      <div class="ceremony-temple-glyph-text" id="ceremony-temple-text">Welcome home</div>
    </div>
  </div>

  <!-- Style C: scan + boot -->
  <div class="ceremony-scan-line"></div>
  <div class="ceremony-boot-overlay">
    <div class="ceremony-boot-line"><span class="ceremony-boot-pip"></span> initializing coherence engine</div>
    <div class="ceremony-boot-line"><span class="ceremony-boot-pip"></span> loading triad signals</div>
    <div class="ceremony-boot-line"><span class="ceremony-boot-pip"></span> syncing vault state</div>
    <div class="ceremony-boot-line"><span class="ceremony-boot-pip"></span> calibrating atmosphere</div>
    <div class="ceremony-boot-line"><span class="ceremony-boot-pip"></span> connecting nervous system</div>
    <div class="ceremony-boot-line final-line"><span class="ceremony-boot-pip"></span> all systems nominal</div>
  </div>

  <!-- Destination preview (populated by JS) -->
  <div id="ceremony-destination"></div>

  <!-- Close overlay -->
  <div class="ceremony-close-overlay">
    <div class="ceremony-close-ring">
      <div class="ceremony-close-ring-progress"></div>
      <div class="ceremony-close-ring-label">Closing</div>
      <div class="ceremony-close-ring-check">&#10003;</div>
    </div>
    <div class="ceremony-close-stats" id="ceremony-close-stats"></div>
    <div class="ceremony-close-message" id="ceremony-close-message">the work landed. rest well.</div>
  </div>

  <!-- Skip hint -->
  <div class="ceremony-skip">esc to skip</div>
</div>
```

**Step 2: Verify**

Run: `npm start`
Expected: App launches normally. Overlay is hidden (`display: none`). Inspect Elements in DevTools to confirm `#ceremony-overlay` is present in DOM.

**Step 3: Commit**

```bash
git add renderer/index.html
git commit -m "feat(ceremony): add ceremony overlay HTML to index.html"
```

---

### Task 4: Create ceremony.js — view logic and animation orchestration

**Files:**
- Create: `renderer/views/ceremony.js`

**Step 1: Create the ceremony module**

Create `renderer/views/ceremony.js`:

```javascript
// renderer/views/ceremony.js
// Ceremony view — somatic transition orchestration
// Design doc: docs/plans/2026-04-17-somatic-ceremony-view-design.md

import { state } from '../state.js'

// ── Constants ──
const STYLE_MAP = {
  'eyes-open': 'style-eyes-open',
  'temple': 'style-temple',
  'ship-boot': 'style-ship-boot',
}

const DURATIONS = {
  'eyes-open': 4200,
  'temple': 3600,
  'ship-boot': 4300,
}

const BOOT_DELAYS = [450, 800, 1150, 1500, 1850, 2250]

const TEMPLE_TEXTS = {
  startOfDay: 'Welcome home',
  endOfDay: 'Until tomorrow',
  weeklyReview: 'The week awaits',
  monthlyReflection: 'A month to witness',
}

const CLOSE_MESSAGES = [
  'the work landed. rest well.',
  'what was done today matters.',
  'the container holds.',
]

let _timeouts = []

function clearTimeouts() {
  _timeouts.forEach(t => clearTimeout(t))
  _timeouts = []
}

function after(ms, fn) {
  _timeouts.push(setTimeout(fn, ms))
}

// ── Public API ──

/**
 * Play an arrival ceremony.
 * @param {'startOfDay'|'weeklyReview'|'monthlyReflection'} ritual
 * @param {Function} onComplete — called when animation finishes (route to destination)
 */
export function playCeremony(ritual, onComplete) {
  if (state.ceremony.skipAnimations) {
    if (onComplete) onComplete()
    return
  }

  const overlay = document.getElementById('ceremony-overlay')
  if (!overlay) return

  const style = state.ceremony.style || 'ship-boot'
  const styleClass = STYLE_MAP[style] || 'style-ship-boot'
  const duration = DURATIONS[style] || 4300

  // Reset state
  clearTimeouts()
  resetOverlayClasses(overlay)
  resetBootPips()

  // Set style + ritual
  overlay.classList.add(styleClass)
  state.ceremony.active = true
  state.ceremony.currentRitual = ritual

  // Update temple glyph text
  const templeText = document.getElementById('ceremony-temple-text')
  if (templeText) templeText.textContent = TEMPLE_TEXTS[ritual] || 'Welcome home'

  // Mount
  overlay.classList.add('active', 'arriving')

  // Progressive boot pip activation (ship-boot only)
  if (style === 'ship-boot') {
    const pips = overlay.querySelectorAll('.ceremony-boot-pip')
    BOOT_DELAYS.forEach((d, i) => {
      after(d, () => { if (pips[i]) pips[i].classList.add('on') })
    })
  }

  // Complete
  after(duration, () => {
    overlay.classList.remove('arriving')
    state.ceremony.completedToday.add(ritual)
    state.ceremony.active = false
    state.ceremony.currentRitual = null
    state.ceremony.pendingCue = null

    // Unmount after a brief settle
    after(300, () => {
      overlay.classList.remove('active')
      resetOverlayClasses(overlay)
      resetBootPips()
      if (onComplete) onComplete()
    })
  })

  // Wire skip (Escape + click)
  wireSkip(overlay, () => {
    clearTimeouts()
    state.ceremony.completedToday.add(ritual)
    state.ceremony.active = false
    state.ceremony.currentRitual = null
    state.ceremony.pendingCue = null
    overlay.classList.remove('active')
    resetOverlayClasses(overlay)
    resetBootPips()
    if (onComplete) onComplete()
  })
}

/**
 * Play the close/departure ceremony.
 * @param {object} stats — { sessions, activeTime, itemsShipped }
 * @param {Function} onComplete
 */
export function playCloseCeremony(stats, onComplete) {
  if (state.ceremony.skipAnimations) {
    if (onComplete) onComplete()
    return
  }

  const overlay = document.getElementById('ceremony-overlay')
  if (!overlay) return

  clearTimeouts()
  resetOverlayClasses(overlay)

  state.ceremony.active = true
  state.ceremony.currentRitual = 'endOfDay'

  // Populate stats
  const statsEl = document.getElementById('ceremony-close-stats')
  if (statsEl) {
    statsEl.innerHTML = `
      <div class="ceremony-close-stat">
        <div class="ceremony-close-stat-value">${stats.sessions || 0}</div>
        <div class="ceremony-close-stat-label">Sessions</div>
      </div>
      <div class="ceremony-close-stat">
        <div class="ceremony-close-stat-value">${stats.activeTime || '0h'}</div>
        <div class="ceremony-close-stat-label">Active Time</div>
      </div>
      <div class="ceremony-close-stat">
        <div class="ceremony-close-stat-value">${stats.itemsShipped || 0}</div>
        <div class="ceremony-close-stat-label">Items Shipped</div>
      </div>`
  }

  // Randomize close message
  const msgEl = document.getElementById('ceremony-close-message')
  if (msgEl) msgEl.textContent = CLOSE_MESSAGES[Math.floor(Math.random() * CLOSE_MESSAGES.length)]

  // Mount + animate
  overlay.classList.add('active', 'departing')

  after(3400, () => {
    overlay.classList.add('departed')
    after(1500, () => {
      state.ceremony.completedToday.add('endOfDay')
      state.ceremony.active = false
      state.ceremony.currentRitual = null
      state.ceremony.pendingCue = null
      overlay.classList.remove('active')
      resetOverlayClasses(overlay)
      if (onComplete) onComplete()
    })
  })

  wireSkip(overlay, () => {
    clearTimeouts()
    state.ceremony.completedToday.add('endOfDay')
    state.ceremony.active = false
    state.ceremony.currentRitual = null
    overlay.classList.remove('active')
    resetOverlayClasses(overlay)
    if (onComplete) onComplete()
  })
}

/**
 * Load ceremony preferences from config.
 */
export async function loadCeremonyConfig() {
  try {
    const config = await window.ace.setup.getConfig()
    if (config?.ceremony) {
      if (config.ceremony.style) state.ceremony.style = config.ceremony.style
      if (config.ceremony.triggers) Object.assign(state.ceremony.triggers, config.ceremony.triggers)
      if (config.ceremony.skipAnimations != null) state.ceremony.skipAnimations = config.ceremony.skipAnimations
    }
  } catch (_) { /* config not available yet — use defaults */ }
}

/**
 * Persist ceremony style preference.
 */
export async function saveCeremonyStyle(style) {
  state.ceremony.style = style
  await window.ace.setup.patchConfig({ ceremony: { style } })
}

// ── Internal helpers ──

function resetOverlayClasses(el) {
  el.classList.remove(
    'arriving', 'departing', 'departed',
    'style-eyes-open', 'style-temple', 'style-ship-boot'
  )
}

function resetBootPips() {
  document.querySelectorAll('.ceremony-boot-pip').forEach(p => p.classList.remove('on'))
}

let _skipHandler = null
let _skipKeyHandler = null

function wireSkip(overlay, skipFn) {
  // Remove previous handlers
  if (_skipHandler) overlay.removeEventListener('click', _skipHandler)
  if (_skipKeyHandler) document.removeEventListener('keydown', _skipKeyHandler)

  _skipHandler = () => skipFn()
  _skipKeyHandler = (e) => {
    if (e.key === 'Escape') skipFn()
  }

  overlay.addEventListener('click', _skipHandler)
  document.addEventListener('keydown', _skipKeyHandler)

  // Cleanup after animation would have finished (safety net)
  after(10000, () => {
    overlay.removeEventListener('click', _skipHandler)
    document.removeEventListener('keydown', _skipKeyHandler)
  })
}
```

**Step 2: Import ceremony module in index.html**

In `renderer/index.html`, find the module imports (inside the `<script type="module">` block). Add:

```javascript
import { playCeremony, playCloseCeremony, loadCeremonyConfig } from './views/ceremony.js'
```

And call `loadCeremonyConfig()` during init (near the bottom of the init block, after `initAtmosphere()`):

```javascript
loadCeremonyConfig()
```

Also expose for dev testing:

```javascript
window.playCeremony = playCeremony
window.playCloseCeremony = playCloseCeremony
```

**Step 3: Verify**

Run: `npm start`
Open DevTools console, test:
```javascript
playCeremony('startOfDay', () => console.log('arrived'))
playCloseCeremony({ sessions: 3, activeTime: '2.1h', itemsShipped: 5 }, () => console.log('closed'))
```
Expected: Animations play. Escape skips. Callbacks fire.

**Step 4: Commit**

```bash
git add renderer/views/ceremony.js renderer/index.html
git commit -m "feat(ceremony): add ceremony.js with arrival + departure orchestration"
```

---

### Task 5: Add ceremony detection logic to atmosphere.js

**Files:**
- Modify: `renderer/modules/atmosphere.js`

**Step 1: Add detection function**

At the top of `atmosphere.js`, add the import:

```javascript
import { playCeremony, playCloseCeremony } from '../views/ceremony.js'
```

Then add the detection function (after the `renderSomaticBar` function, around line 139):

```javascript
// ── Ceremony Detection ──
const CEREMONY_RITUALS = [
  {
    key: 'monthlyReflection',
    priority: 1,
    cue: 'dawn',
    detect: () => {
      const now = new Date()
      const tomorrow = new Date(now)
      tomorrow.setDate(tomorrow.getDate() + 1)
      const isLastDay = tomorrow.getDate() === 1
      return isLastDay && now.getHours() >= 5
    },
    expiry: () => {
      const now = new Date()
      const deadline = new Date(now)
      deadline.setDate(deadline.getDate() + 2)
      return now < deadline
    },
    destination: 'chat',
    command: '/monthly-reflection',
  },
  {
    key: 'weeklyReview',
    priority: 2,
    cue: 'dawn',
    detect: () => {
      const now = new Date()
      return now.getDay() === 6 && now.getHours() >= 5  // Saturday
    },
    expiry: () => {
      const now = new Date()
      return now.getDay() === 6 || (now.getDay() === 0 && now.getHours() < 24)
    },
    destination: 'chat',
    command: '/weekly-review',
  },
  {
    key: 'startOfDay',
    priority: 3,
    cue: 'dawn',
    detect: () => {
      const now = new Date()
      return now.getHours() >= 5 && now.getHours() < 12
    },
    expiry: () => new Date().getHours() < 12,
    destination: 'cockpit',
  },
  {
    key: 'endOfDay',
    priority: 4,
    cue: 'settle',
    detect: () => {
      const now = new Date()
      return now.getHours() >= 19 && state.atmosphere.completedSessions > 0
    },
    expiry: () => {
      const h = new Date().getHours()
      return h >= 19 || h < 3
    },
    destination: 'rest',
  },
]

let lastCeremonyCheck = 0

function checkCeremonyTriggers() {
  if (state.ceremony.active) return
  const now = Date.now()
  if (now - lastCeremonyCheck < 60_000) return  // check at most once per minute
  lastCeremonyCheck = now

  // Reset completedToday at 5am
  const hour = new Date().getHours()
  if (hour === 5 && state.ceremony.completedToday.size > 0) {
    const lastReset = state.ceremony._lastReset || 0
    if (now - lastReset > 3_600_000) {  // don't reset more than once per hour
      state.ceremony.completedToday.clear()
      state.ceremony._lastReset = now
    }
  }

  // Find highest-priority eligible ritual
  let pendingRitual = null
  for (const ritual of CEREMONY_RITUALS) {
    if (!state.ceremony.triggers[ritual.key]) continue
    if (state.ceremony.completedToday.has(ritual.key)) continue
    if (!ritual.detect()) continue
    if (!ritual.expiry()) continue
    pendingRitual = ritual
    break  // first match wins (sorted by priority)
  }

  if (pendingRitual) {
    setCeremonyCue(pendingRitual.cue, pendingRitual.key)
  } else if (state.ceremony.pendingCue) {
    clearCeremonyCue()
  }
}

function setCeremonyCue(cue, ritualKey) {
  if (state.ceremony.pendingCue === cue) return
  state.ceremony.pendingCue = cue
  state.ceremony.currentRitual = ritualKey

  // Update ACE mark
  const mark = document.getElementById('sidebarMark')
  if (mark) {
    mark.classList.remove('ceremony-dawn', 'ceremony-settle')
    mark.classList.add('ceremony-' + cue)
  }

  // Update somatic bar text
  const textMap = {
    startOfDay: 'the day is ready',
    endOfDay: 'time to land',
    weeklyReview: 'the week wants your attention',
    monthlyReflection: 'a month to witness',
  }
  const barEl = document.getElementById('somatic-bar')
  if (barEl) {
    barEl.classList.remove('ceremony-dawn', 'ceremony-settle')
    barEl.classList.add('ceremony-' + cue)
  }
  updateSomaticBarText(textMap[ritualKey] || 'the day is ready')
}

function clearCeremonyCue() {
  state.ceremony.pendingCue = null

  const mark = document.getElementById('sidebarMark')
  if (mark) mark.classList.remove('ceremony-dawn', 'ceremony-settle')

  const barEl = document.getElementById('somatic-bar')
  if (barEl) barEl.classList.remove('ceremony-dawn', 'ceremony-settle')
}

// Export for use by click handlers
export function triggerPendingCeremony() {
  if (!state.ceremony.pendingCue || state.ceremony.active) return

  const ritualKey = state.ceremony.currentRitual
  const ritual = CEREMONY_RITUALS.find(r => r.key === ritualKey)
  if (!ritual) return

  clearCeremonyCue()

  if (ritual.key === 'endOfDay') {
    const stats = {
      sessions: state.atmosphere.completedSessions,
      activeTime: (state.atmosphere.totalActiveMin / 60).toFixed(1) + 'h',
      itemsShipped: '—',
    }
    playCloseCeremony(stats, () => {
      // Route to rest — could dim the app or just stay
    })
  } else {
    playCeremony(ritualKey, () => {
      // Route to destination
      if (ritual.destination === 'cockpit') {
        const cockpitNav = document.querySelector('[data-view="home"]')
        if (cockpitNav) cockpitNav.click()
      } else if (ritual.destination === 'chat' && ritual.command) {
        const homeNav = document.querySelector('[data-view="home"]')
        if (homeNav) homeNav.click()
        // Send the command after a brief delay
        setTimeout(() => {
          if (state.activeId && window.sendChatMessage) {
            window.sendChatMessage(state.activeId, ritual.command)
          }
        }, 500)
      }
    })
  }
}
```

**Step 2: Call detection in the tick loop**

Find the main tick/interval function in `atmosphere.js` (the one that runs every `TICK_MS`). Add `checkCeremonyTriggers()` to that loop:

```javascript
checkCeremonyTriggers()
```

**Step 3: Export triggerPendingCeremony**

Add `triggerPendingCeremony` to the file's exports.

**Step 4: Verify**

Run: `npm start`
Open DevTools, manually test by calling `checkCeremonyTriggers()` or adjusting system time. Confirm mark glow and somatic text change when conditions are met.

**Step 5: Commit**

```bash
git add renderer/modules/atmosphere.js
git commit -m "feat(ceremony): add time-aware detection logic to atmosphere.js"
```

---

### Task 6: Wire click handlers on sidebar mark and somatic bar

**Files:**
- Modify: `renderer/index.html` (add click listeners)

**Step 1: Add click handler on sidebar mark**

In the `<script type="module">` block of `renderer/index.html`, add after the ceremony imports:

```javascript
import { triggerPendingCeremony } from './modules/atmosphere.js'
```

Then wire the click handlers (near other init code):

```javascript
// Ceremony trigger — click sidebar mark or somatic bar text
document.getElementById('sidebarMark')?.addEventListener('click', () => {
  triggerPendingCeremony()
})

document.getElementById('somatic-bar-text')?.addEventListener('click', () => {
  triggerPendingCeremony()
})
```

**Step 2: Verify**

Run: `npm start`
Manually trigger a ceremony cue (via DevTools: set `state.ceremony.pendingCue = 'dawn'` and add the CSS class), then click the mark. Confirm ceremony plays.

**Step 3: Commit**

```bash
git add renderer/index.html
git commit -m "feat(ceremony): wire click triggers on sidebar mark and somatic bar"
```

---

### Task 7: Intercept ceremony commands from chat input

**Files:**
- Modify: `renderer/modules/session-manager.js`

**Step 1: Add ceremony interception to sendChatMessage**

At the top of `session-manager.js`, add the import:

```javascript
import { playCeremony, playCloseCeremony } from '../views/ceremony.js'
```

In the `sendChatMessage` function (line 26), add an interception block at the very start (after the `if (!s || !prompt.trim()) return` guard, before the streaming queue check):

```javascript
  // Ceremony interception — play transition before executing command
  const ceremonyCmds = {
    '/start': 'startOfDay',
    '/close': 'endOfDay',
    '/eod': 'endOfDay',
    '/weekly-review': 'weeklyReview',
    '/monthly-reflection': 'monthlyReflection',
  }
  const trimmedPrompt = prompt.trim()
  const ceremonyRitual = ceremonyCmds[trimmedPrompt]
  if (ceremonyRitual && !state.ceremony.active && !state.ceremony.skipAnimations) {
    if (ceremonyRitual === 'endOfDay') {
      const stats = {
        sessions: state.atmosphere?.completedSessions || 0,
        activeTime: ((state.atmosphere?.totalActiveMin || 0) / 60).toFixed(1) + 'h',
        itemsShipped: '—',
      }
      playCloseCeremony(stats, () => {
        // Now send the actual command to Claude
        _doSendChatMessage(id, prompt, sessionsObj)
      })
    } else {
      playCeremony(ceremonyRitual, () => {
        _doSendChatMessage(id, prompt, sessionsObj)
      })
    }
    return
  }
```

Then rename the rest of `sendChatMessage` to extract the sending logic into `_doSendChatMessage`:

```javascript
// Move the rest of the current sendChatMessage body into this function:
function _doSendChatMessage(id, prompt, sessionsObj) {
  sessionsObj = sessionsObj || state.sessions
  const s = sessionsObj[id]
  if (!s || !prompt.trim()) return

  // If currently streaming, queue the message
  if (s.isStreaming) {
    // ... existing queue logic ...
  }

  // ... rest of existing sendChatMessage logic ...
}
```

And have `sendChatMessage` call `_doSendChatMessage` for non-ceremony prompts:

```javascript
export function sendChatMessage(id, prompt, sessionsObj) {
  sessionsObj = sessionsObj || state.sessions
  const s = sessionsObj[id]
  if (!s || !prompt.trim()) return

  // Ceremony interception (block above)
  // ...

  // Normal send
  _doSendChatMessage(id, prompt, sessionsObj)
}
```

**Step 2: Verify**

Run: `npm start`
Type `/start` in chat. Confirm: ceremony animation plays FIRST, then `/start` command executes in chat.
Type `/close` in chat. Confirm: close ceremony plays, then `/close` executes.

**Step 3: Commit**

```bash
git add renderer/modules/session-manager.js
git commit -m "feat(ceremony): intercept /start, /close, /eod, /weekly-review from chat input"
```

---

### Task 8: Load config on startup and persist preferences

**Files:**
- Modify: `renderer/index.html` (already done in Task 4 — verify `loadCeremonyConfig()` is called)

**Step 1: Verify config loading**

Confirm that `loadCeremonyConfig()` is called during app init (added in Task 4).

**Step 2: Test persistence round-trip**

Open DevTools, run:
```javascript
// Save preference
await window.ace.setup.patchConfig({ ceremony: { style: 'temple', triggers: { startOfDay: true }, skipAnimations: false } })

// Reload and verify
const c = await window.ace.setup.getConfig()
console.log(c.ceremony)  // should show { style: 'temple', ... }
```

**Step 3: Commit** (if any changes needed)

```bash
git add renderer/index.html
git commit -m "feat(ceremony): verify config persistence for ceremony preferences"
```

---

### Task 9: Integration test — full flow

**No new files.** This is a manual verification task.

**Step 1: Test arrival ceremonies**

For each style (`eyes-open`, `temple`, `ship-boot`):
1. Set style: `state.ceremony.style = 'eyes-open'`
2. Trigger: `playCeremony('startOfDay', () => console.log('done'))`
3. Confirm: animation plays correctly, callback fires
4. Test skip: trigger again, press Escape mid-animation — confirm instant skip

**Step 2: Test close ceremony**

```javascript
playCloseCeremony({ sessions: 4, activeTime: '3.2h', itemsShipped: 6 }, () => console.log('closed'))
```
Confirm: cockpit settles, stats appear, message fades in, dims to black.

**Step 3: Test chat interception**

Type `/start` in chat input → ceremony plays → command executes after.
Type `/close` in chat input → close ceremony plays → command executes after.

**Step 4: Test somatic cues**

Manually trigger:
```javascript
// Simulate morning detection
state.ceremony.completedToday.clear()
// Call the detection function directly
checkCeremonyTriggers()
```
Confirm: mark glows dawn-gold, somatic bar text changes.
Click mark → ceremony plays.

**Step 5: Test reduced motion**

In DevTools: toggle `prefers-reduced-motion` in Rendering panel.
Confirm: animations are instant (0.01ms duration).

**Step 6: Commit final verification**

```bash
git commit --allow-empty -m "test(ceremony): manual integration test passed — all styles, skip, chat interception, cues"
```
