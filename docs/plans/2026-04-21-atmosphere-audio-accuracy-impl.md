# Atmosphere Audio Accuracy — Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Replace ACE Desktop's two-axis solfeggio × binaural popover with 4 research-backed single-intent presets on a 200 Hz binaural carrier, add an accordion UI with inline citations, and add a session timer with 2-minute auto-fade.

**Architecture:** In-place edit of [ace-desktop/renderer/modules/atmosphere.js](ace-desktop/renderer/modules/atmosphere.js) (audio engine + state) and [ace-desktop/renderer/index.html](ace-desktop/renderer/index.html) (popover markup). No new modules. Engine reduces from two parallel oscillator systems to one binaural pair with hard-coded 200 Hz carrier.

**Tech Stack:** Web Audio API (OscillatorNode, StereoPannerNode, GainNode), vanilla JS ES modules, plain DOM + CSS, localStorage for persistence. No test framework — verification is manual (`npm start` + DevTools + headphone listening) per [memory](memory/reference_ace_desktop_no_tests.md).

**Design reference:** [2026-04-21-atmosphere-audio-accuracy-design.md](ace-desktop/docs/plans/2026-04-21-atmosphere-audio-accuracy-design.md) — authoritative source for frequency numbers, citations, UI layout. This plan implements that design.

---

## Prerequisites

**Branch:** This plan must be executed on a new branch `audio-accuracy-apr21` off `main`, not on the current `perf-hardening-apr20` branch. Perf-hardening work is unrelated and should merge independently.

```bash
# Only after perf-hardening-apr20 has merged to main, or in a separate worktree:
git checkout main
git pull
git checkout -b audio-accuracy-apr21
```

**Constraints to honor:**
- [memory/feedback_incremental_edits_only.md](memory/feedback_incremental_edits_only.md) — one change at a time; test between edits.
- [memory/feedback_ace_desktop_restart.md](memory/feedback_ace_desktop_restart.md) — kill Electron by PID, not `pkill`.
- [memory/feedback_electron_run_as_node_testing.md](memory/feedback_electron_run_as_node_testing.md) — launch via `npm start`, not `electron .` directly.
- [memory/feedback_no_anthropic_api.md](memory/feedback_no_anthropic_api.md) — no API calls; Web Audio is local synth only.

**Commit cadence:** one commit per task. Never batch.

---

## Task 1 — Update state shape + localStorage migration

**Goal:** Change `state.atmosphere.audio` to the new shape, migrate old localStorage keys once. No behavior change yet; subsequent tasks replace the engine that reads this state.

**Files:**
- Modify: [ace-desktop/renderer/state.js:71-76](ace-desktop/renderer/state.js#L71-L76)

**Step 1: Verify current state shape in DevTools.**

Launch ACE, open DevTools console, run:
```js
state.atmosphere.audio
```
Expected output: `{ mode: '...', solfeggio: '...', binaural: '...', volume: 0.03 }`. Record what values are set so we can confirm migration runs correctly in Step 4.

**Step 2: Write migration helper + new state shape.**

Replace [state.js:71-76](ace-desktop/renderer/state.js#L71-L76) with:

```js
audio: (() => {
  const oldSol = localStorage.getItem('ace-atm-audio-sol')
  const oldBin = localStorage.getItem('ace-atm-audio-bin')
  const oldMode = localStorage.getItem('ace-atm-audio-mode')
  const newPreset = localStorage.getItem('ace-atm-audio-preset')

  // One-time migration: if new key absent but old keys present, translate
  let preset = newPreset
  if (!preset) {
    if ((oldSol && oldSol !== 'off') || (oldBin && oldBin !== 'off')) {
      preset = 'calm'  // safe default — research-backed alpha entrainment
    } else {
      preset = 'off'
    }
    localStorage.setItem('ace-atm-audio-preset', preset)
    localStorage.removeItem('ace-atm-audio-sol')
    localStorage.removeItem('ace-atm-audio-bin')
  }

  return {
    mode: oldMode === 'on' || preset !== 'off' ? 'on' : 'off',
    preset,                   // 'focus' | 'gamma' | 'calm' | 'rest' | 'auto' | 'off'
    previousPreset: null,     // for breath-enter/exit restore
    volume: 0.03,
    timerEndsAt: null,        // timestamp; null when no timer active
    timerMinutes: 0,          // 0 | 15 | 30 | 45 | 60 (selected value)
  }
})(),
```

**Step 3: Verify old-config migration.**

Set a fake old config in DevTools:
```js
localStorage.setItem('ace-atm-audio-sol', 'focus')
localStorage.setItem('ace-atm-audio-bin', 'active')
localStorage.removeItem('ace-atm-audio-preset')
location.reload()
```
After reload, in DevTools:
```js
localStorage.getItem('ace-atm-audio-preset')  // expect 'calm'
localStorage.getItem('ace-atm-audio-sol')     // expect null
localStorage.getItem('ace-atm-audio-bin')     // expect null
state.atmosphere.audio.preset                  // expect 'calm'
```

**Step 4: Verify fresh-install path.**

```js
localStorage.removeItem('ace-atm-audio-sol')
localStorage.removeItem('ace-atm-audio-bin')
localStorage.removeItem('ace-atm-audio-preset')
location.reload()
```
After reload: `state.atmosphere.audio.preset` should be `'off'`.

**Step 5: Commit.**

```bash
git add ace-desktop/renderer/state.js
git commit -m "refactor(audio): migrate state shape to single-preset key"
```

Note: App will be broken between this commit and Task 3's engine rewrite — atmosphere.js still references `audio.solfeggio`/`audio.binaural`. Don't restart ACE mid-task-2. Keep DevTools open on the pre-Task-1 build if you need to compare.

---

## Task 2 — Replace frequency constants

**Goal:** Swap `SOLFEGGIO`, `BINAURAL`, `AUTO_SOL_MAP` constants for the new `PRESETS`, `PRESET_RESEARCH`, `AUTO_PRESET_MAP`. Pure data change.

**Files:**
- Modify: [ace-desktop/renderer/modules/atmosphere.js:142-155](ace-desktop/renderer/modules/atmosphere.js#L142-L155)

**Step 1: Delete old constants.**

Remove the `SOLFEGGIO`, `BINAURAL`, `AUTO_SOL_MAP` blocks at lines 142–155.

**Step 2: Add new constants in the same location.**

```js
// Binaural entrainment — all presets use a 200 Hz carrier with a research-backed beat offset.
// Citations: see PRESET_RESEARCH. Carrier choice per standard entrainment practice (Oster 1973);
// higher carriers weaken beat perception.
const CARRIER_HZ = 200
const PRESETS = {
  focus: { beat: 14,   band: 'beta',  label: 'Focus',  hz: '14 Hz · β' },
  gamma: { beat: 40,   band: 'gamma', label: 'Gamma',  hz: '40 Hz · γ' },
  calm:  { beat: 10,   band: 'alpha', label: 'Calm',   hz: '10 Hz · α' },
  rest:  { beat: 3,    band: 'delta', label: 'Rest',   hz: '3 Hz · δ'  },
}
const PRESET_RESEARCH = {
  focus: '200 Hz carrier + 14 Hz beta beat. Beta entrainment associated with sustained attention improvements. Meta-analysis: Garcia-Argibay et al., 2019.',
  gamma: '200 Hz carrier + 40 Hz gamma beat. Linked to neural coherence; animal models show amyloid clearance. Iaccarino et al. 2016 (Nature); Naghdi et al. 2019.',
  calm:  '200 Hz carrier + 10 Hz alpha beat. RCT: alpha entrainment reduced depressive symptoms vs. standard care. Isik et al., 2021.',
  rest:  '200 Hz carrier + 3 Hz delta beat. Controlled study: 3 Hz increased N3 deep-sleep duration and shortened N3 latency. Jirakittayakorn & Wongsawat, 2018.',
}
const AUTO_PRESET_MAP = {
  morning:   'focus',
  afternoon: 'focus',
  evening:   'calm',
  late:      'rest',
}
const TIMER_FADE_MS = 2 * 60_000
```

**Step 3: Verify syntax.**

Run:
```bash
cd ace-desktop && node --check renderer/modules/atmosphere.js
```
Expected: no output (parse OK). If error, the file references old constants elsewhere — those are rewritten in Task 3. Ignore import-time errors from other files; you only want syntactic validity of atmosphere.js itself.

**Step 4: Commit.**

```bash
git add ace-desktop/renderer/modules/atmosphere.js
git commit -m "refactor(audio): replace solfeggio/binaural constants with PRESETS"
```

---

## Task 3 — Rewrite audio engine (single `setPreset` API)

**Goal:** Delete solfeggio-only oscillator path; collapse `setSolfeggio` + `setBinaural` into a single `setPreset(key)`; every preset is a binaural pair on 200 Hz carrier.

**Files:**
- Modify: [ace-desktop/renderer/modules/atmosphere.js:866-1034](ace-desktop/renderer/modules/atmosphere.js#L866-L1034)

**Step 1: Replace the Audio Engine block (lines ~866–1034) entirely.**

The new block (paste as a replacement for the entire `// ── Audio Engine ──` region through the end of `renderAudioIndicator`):

```js
// ── Audio Engine (Web Audio API — pure synthesis, no files) ──
let audioCtx = null
let binL = null, binR = null, binGain = null
let panL = null, panR = null

function ensureAudioCtx() {
  if (!audioCtx) audioCtx = new (window.AudioContext || window.webkitAudioContext)()
  if (audioCtx.state === 'suspended') audioCtx.resume()
  return audioCtx
}

function resolvePresetKey(key) {
  // Translates 'auto' to a concrete preset per time of day. Returns null for 'off'.
  if (key === 'off') return null
  if (key === 'auto') return AUTO_PRESET_MAP[state.atmosphere.timeOfDay] || 'focus'
  return PRESETS[key] ? key : null
}

function startBinaural(beatHz) {
  const ctx = ensureAudioCtx()
  const vol = state.atmosphere.audio.volume
  binGain = ctx.createGain()
  binGain.gain.setValueAtTime(0, ctx.currentTime)
  binGain.gain.linearRampToValueAtTime(vol, ctx.currentTime + 2)
  binGain.connect(ctx.destination)

  panL = ctx.createStereoPanner(); panL.pan.value = -1
  panR = ctx.createStereoPanner(); panR.pan.value = 1
  panL.connect(binGain); panR.connect(binGain)

  binL = ctx.createOscillator(); binL.type = 'sine'
  binL.frequency.setValueAtTime(CARRIER_HZ - beatHz / 2, ctx.currentTime)
  binL.connect(panL); binL.start()

  binR = ctx.createOscillator(); binR.type = 'sine'
  binR.frequency.setValueAtTime(CARRIER_HZ + beatHz / 2, ctx.currentTime)
  binR.connect(panR); binR.start()
}

function stopBinaural() {
  if (!binL) return
  const ctx = audioCtx
  binGain.gain.linearRampToValueAtTime(0, ctx.currentTime + 2)
  const l = binL, r = binR, g = binGain, pl = panL, pr = panR
  setTimeout(() => {
    l.stop(); r.stop()
    l.disconnect(); r.disconnect()
    pl.disconnect(); pr.disconnect()
    g.disconnect()
  }, 2500)
  binL = null; binR = null; binGain = null; panL = null; panR = null
}

function crossfadeBinTo(beatHz, durationMs) {
  if (!binL || !audioCtx) return
  const t = audioCtx.currentTime + durationMs / 1000
  binL.frequency.linearRampToValueAtTime(CARRIER_HZ - beatHz / 2, t)
  binR.frequency.linearRampToValueAtTime(CARRIER_HZ + beatHz / 2, t)
}

export function setPreset(key) {
  const audio = state.atmosphere.audio
  audio.preset = key
  localStorage.setItem('ace-atm-audio-preset', key)

  const resolved = resolvePresetKey(key)
  if (!resolved) {
    stopBinaural()
    audio.mode = 'off'
  } else {
    const beat = PRESETS[resolved].beat
    if (!binL) startBinaural(beat)
    else crossfadeBinTo(beat, CROSSFADE_MS)
    audio.mode = 'on'
  }
  localStorage.setItem('ace-atm-audio-mode', audio.mode)
  renderAudioIndicator()
  renderPresetAccordion()  // defined in Task 6
}

// Audio responds to nudge — shift toward calm
export function audioNudgeShift() {
  if (state.atmosphere.audio.preset === 'off') return
  crossfadeBinTo(PRESETS.calm.beat, CROSSFADE_MS)
}

// Audio responds to breath view — save current, switch to rest (3 Hz delta)
export function audioBreathEnter() {
  const audio = state.atmosphere.audio
  if (audio.preset === 'off') return
  audio.previousPreset = audio.preset
  crossfadeBinTo(PRESETS.rest.beat, 5000)
}

export function audioBreathExit() {
  const audio = state.atmosphere.audio
  if (audio.preset === 'off' || !audio.previousPreset) return
  const resolved = resolvePresetKey(audio.previousPreset)
  if (resolved) crossfadeBinTo(PRESETS[resolved].beat, 5000)
  audio.previousPreset = null
}

function renderAudioIndicator() {
  const el = document.getElementById('atm-audio-label')
  if (!el) return
  const audio = state.atmosphere.audio
  const resolved = resolvePresetKey(audio.preset)
  if (!resolved) {
    el.textContent = '♪ Off'
    el.parentElement?.classList.remove('active')
    return
  }
  el.parentElement?.classList.add('active')
  const p = PRESETS[resolved]
  el.textContent = `♪ ${p.label} · ${p.hz} 🎧`
}
```

**Step 2: Search for stale references.**

```bash
cd ace-desktop && grep -nE 'setSolfeggio|setBinaural|SOLFEGGIO|BINAURAL\[|AUTO_SOL_MAP|solOsc|solGain|crossfadeSolTo|startSolfeggio|stopSolfeggio|audio\.solfeggio|audio\.binaural' renderer/
```

Expected: **no matches.** If any remain, fix them — most likely in [atmosphere.js](ace-desktop/renderer/modules/atmosphere.js) init block (the "restore saved audio state" section around the old line 1288) and in any exports.

**Step 3: Update `initAtmosphere()` restore block.**

Find the block in `initAtmosphere()` that restored saved audio (old code read `audio.solfeggio`, `audio.binaural` and called `startSolfeggio`/`startBinaural`). Replace with:

```js
// Restore saved preset — requires user gesture in Chromium
const audio = state.atmosphere.audio
if (audio.preset !== 'off') {
  const startSavedAudio = () => {
    const resolved = resolvePresetKey(audio.preset)
    if (resolved) startBinaural(PRESETS[resolved].beat)
    document.removeEventListener('click', startSavedAudio)
  }
  document.addEventListener('click', startSavedAudio, { once: true })
}
```

Also update the `onWillReload` handler — replace `stopSolfeggio(); stopBinaural()` with just `stopBinaural()`.

**Step 4: Remove stale `updateAudioMode` helper.**

It computed `audio.mode` from both `solfeggio` and `binaural`; now `setPreset` does this inline. Delete the function and any calls to it.

**Step 5: Verify syntax.**

```bash
cd ace-desktop && node --check renderer/modules/atmosphere.js
```
Expected: no output.

**Step 6: Full app smoke test.**

```bash
cd ace-desktop && npm start
```

App should launch. Popover will still render the OLD markup (not yet updated — Task 5) but the JS wiring will be broken because `data-sol`/`data-bin` buttons no longer map to anything. **That's expected.** What you're verifying here:

- No JS console errors at boot.
- No errors from `initAtmosphere`.
- Click somatic bar, verify intensity bar still renders (not regressed).
- In DevTools, manually run `setPreset('calm')`. Within 2s you should hear a low warm 10 Hz binaural beat on 200 Hz carrier (put on headphones). Run `setPreset('focus')`. You should hear a 30-second crossfade to a 14 Hz beat. Run `setPreset('off')`. Sound fades out over 2s.

If any step fails, check DevTools console + fix before committing.

**Step 7: Commit.**

```bash
git add ace-desktop/renderer/modules/atmosphere.js
git commit -m "feat(audio): single setPreset API with 200 Hz binaural carrier"
```

---

## Task 4 — Update hook integrations in breath + session-manager

**Goal:** Any external caller that used the old `setSolfeggio`/`setBinaural` exports now must call `setPreset`. Verify nothing else references the deleted exports.

**Files:**
- Modify: any file that imports from `./modules/atmosphere.js` using the old names.

**Step 1: Search for external callers.**

```bash
cd ace-desktop && grep -rnE 'setSolfeggio|setBinaural|audioBreathEnter|audioBreathExit|audioNudgeShift' renderer/ --include='*.js'
```

Expected callers:
- `audioBreathEnter`/`audioBreathExit` — called from `renderer/modules/breath.js` or `renderer/views/breath.js`.
- `audioNudgeShift` — called internally from atmosphere.js `checkNudge()`.

**Step 2: Update imports.**

For each external file that imports `setSolfeggio` or `setBinaural`, replace the import + usage with `setPreset`. Examples:

```js
// Before
import { setSolfeggio, setBinaural } from '../modules/atmosphere.js'
setSolfeggio('calm')
setBinaural('off')

// After
import { setPreset } from '../modules/atmosphere.js'
setPreset('calm')
```

**Step 3: Verify.**

```bash
cd ace-desktop && grep -rnE 'setSolfeggio|setBinaural' renderer/ --include='*.js'
```
Expected: **no matches.**

**Step 4: Relaunch app, trigger breath view.**

```bash
cd ace-desktop && npm start
```

Click the breath view in the sidebar. `audioBreathEnter()` should fire — if a preset is active, it crossfades to 3 Hz delta. Exit breath. It should crossfade back to the previous preset.

**Step 5: Commit.**

```bash
git add ace-desktop/renderer/
git commit -m "refactor(audio): update external callers to setPreset"
```

---

## Task 5 — Replace popover markup (accordion structure)

**Goal:** Replace the two-section markup with a single preset section + timer row + disclaimer. Accordion body is inline per button (hidden by CSS until `.selected`).

**Files:**
- Modify: [ace-desktop/renderer/index.html:1342-1383](ace-desktop/renderer/index.html#L1342-L1383)

**Step 1: Replace lines 1342–1383 with:**

```html
<!-- Audio popover (body-level) -->
<div class="atm-audio-popover" id="atm-audio-popover">
  <div class="audio-pop-section">Preset <span class="audio-pop-note">🎧 headphones</span></div>

  <button class="audio-pop-btn" data-preset="focus">
    <div class="audio-pop-name">Focus<span class="audio-pop-hz">14 Hz · β</span></div>
    <div class="audio-pop-research" data-research-for="focus"></div>
  </button>
  <button class="audio-pop-btn" data-preset="gamma">
    <div class="audio-pop-name">Gamma<span class="audio-pop-hz">40 Hz · γ</span></div>
    <div class="audio-pop-research" data-research-for="gamma"></div>
  </button>
  <button class="audio-pop-btn" data-preset="calm">
    <div class="audio-pop-name">Calm<span class="audio-pop-hz">10 Hz · α</span></div>
    <div class="audio-pop-research" data-research-for="calm"></div>
  </button>
  <button class="audio-pop-btn" data-preset="rest">
    <div class="audio-pop-name">Rest<span class="audio-pop-hz">3 Hz · δ</span></div>
    <div class="audio-pop-research" data-research-for="rest"></div>
  </button>
  <button class="audio-pop-btn" data-preset="auto">
    <div class="audio-pop-name">Auto<span class="audio-pop-hz">follows time</span></div>
    <div class="audio-pop-research">Working hours → Focus · Evening → Calm · Late → Rest</div>
  </button>
  <button class="audio-pop-btn audio-pop-off" data-preset="off">
    <div class="audio-pop-name">Off</div>
  </button>

  <div class="audio-pop-timer-row">
    <label for="atm-audio-timer-select">⏱ Timer</label>
    <select id="atm-audio-timer-select">
      <option value="0">Off</option>
      <option value="15">15 min</option>
      <option value="30">30 min</option>
      <option value="45">45 min</option>
      <option value="60">60 min</option>
    </select>
    <span id="atm-audio-timer-countdown" class="audio-pop-timer-countdown"></span>
  </div>

  <div class="atm-audio-disclaimer">Effects vary. Not medical advice. Use headphones for binaural entrainment.</div>
</div>
```

**Step 2: Verify structure in browser.**

```bash
cd ace-desktop && npm start
```

Open popover. Structure should render (unstyled accordion — citations will all be visible or all collapsed depending on existing CSS). Buttons won't do anything yet (Task 6 wires them).

**Step 3: Commit.**

```bash
git add ace-desktop/renderer/index.html
git commit -m "feat(audio): accordion popover markup with single preset section"
```

---

## Task 6 — Wire accordion behavior + render citations

**Goal:** Populate `.audio-pop-research` bodies from `PRESET_RESEARCH`. Toggle `.selected` on click to drive CSS show/hide. Wire preset buttons to call `setPreset()`.

**Files:**
- Modify: `wireAudioPopover()` in [ace-desktop/renderer/modules/atmosphere.js:1057-1084](ace-desktop/renderer/modules/atmosphere.js#L1057-L1084).

**Step 1: Rewrite `wireAudioPopover`.**

```js
function wireAudioPopover() {
  const indicator = document.getElementById('atm-audio-indicator')
  if (indicator) indicator.addEventListener('click', toggleAudioPopover)

  // Populate research bodies once
  for (const [key, text] of Object.entries(PRESET_RESEARCH)) {
    const el = document.querySelector(`[data-research-for="${key}"]`)
    if (el) el.textContent = text
  }

  // Preset buttons
  document.querySelectorAll('[data-preset]').forEach(btn => {
    btn.addEventListener('click', () => {
      setPreset(btn.dataset.preset)
      closeAudioPopover()
    })
  })

  // Close on outside click
  document.addEventListener('click', (e) => {
    const pop = document.getElementById('atm-audio-popover')
    const ind = document.getElementById('atm-audio-indicator')
    if (pop?.classList.contains('open') && !pop.contains(e.target) && !ind?.contains(e.target)) {
      closeAudioPopover()
    }
  })
}
```

**Step 2: Add `renderPresetAccordion()` function (referenced in `setPreset` from Task 3).**

```js
function renderPresetAccordion() {
  const audio = state.atmosphere.audio
  document.querySelectorAll('[data-preset]').forEach(btn => {
    btn.classList.toggle('selected', btn.dataset.preset === audio.preset)
  })
}
```

Place it adjacent to `renderAudioIndicator` for locality.

**Step 3: Call `renderPresetAccordion()` from `initAtmosphere()`.**

After the existing `renderAudioIndicator()` call in `initAtmosphere`, add:
```js
renderPresetAccordion()
```

**Step 4: Verify.**

```bash
cd ace-desktop && npm start
```

Open popover. Click Focus → `.audio-pop-btn[data-preset="focus"]` should gain `.selected` class (inspect DOM to confirm). Click Gamma → Focus loses `.selected`, Gamma gains it. Click Off → no button selected. Audio responds accordingly (headphones on).

Citations are present in DOM but not yet styled to appear only when `.selected` — that's Task 8.

**Step 5: Commit.**

```bash
git add ace-desktop/renderer/modules/atmosphere.js
git commit -m "feat(audio): accordion wiring + inline research citations"
```

---

## Task 7 — Session timer with auto-fade

**Goal:** Timer select sets a duration; at `remaining <= 2min`, start fade; at `remaining <= 0`, turn off. Countdown text updates on tick.

**Files:**
- Modify: [ace-desktop/renderer/modules/atmosphere.js](ace-desktop/renderer/modules/atmosphere.js) — add timer helpers + wire select + update `tick()`.

**Step 1: Add timer helpers.**

Add near the audio engine section:

```js
function startTimer(minutes) {
  const audio = state.atmosphere.audio
  if (!minutes || minutes === 0) {
    audio.timerEndsAt = null
    audio.timerMinutes = 0
    renderTimerCountdown()
    return
  }
  audio.timerMinutes = minutes
  audio.timerEndsAt = Date.now() + minutes * 60_000
  renderTimerCountdown()
}

function checkTimer() {
  const audio = state.atmosphere.audio
  if (!audio.timerEndsAt) return
  const remaining = audio.timerEndsAt - Date.now()

  if (remaining <= 0) {
    audio.timerEndsAt = null
    audio.timerMinutes = 0
    setPreset('off')
    // Reset the <select> UI
    const sel = document.getElementById('atm-audio-timer-select')
    if (sel) sel.value = '0'
    renderTimerCountdown()
    return
  }

  if (remaining <= TIMER_FADE_MS && binGain && audioCtx) {
    // Begin fade if not already fading (check current ramp target)
    const targetVol = binGain.gain.value
    if (targetVol > 0.0001) {
      binGain.gain.cancelScheduledValues(audioCtx.currentTime)
      binGain.gain.setValueAtTime(targetVol, audioCtx.currentTime)
      binGain.gain.linearRampToValueAtTime(0, audioCtx.currentTime + remaining / 1000)
    }
  }

  renderTimerCountdown()
}

function renderTimerCountdown() {
  const el = document.getElementById('atm-audio-timer-countdown')
  if (!el) return
  const audio = state.atmosphere.audio
  if (!audio.timerEndsAt) {
    el.textContent = ''
    return
  }
  const remainingMs = Math.max(0, audio.timerEndsAt - Date.now())
  const mins = Math.ceil(remainingMs / 60_000)
  el.textContent = `Ends in ${mins}m`
}
```

**Step 2: Wire the `<select>` in `wireAudioPopover()`.**

Inside `wireAudioPopover`, add after the preset-button wiring:

```js
const timerSel = document.getElementById('atm-audio-timer-select')
if (timerSel) {
  timerSel.addEventListener('change', (e) => {
    startTimer(Number(e.target.value))
  })
}
```

**Step 3: Add `checkTimer()` to `tick()`.**

Inside the existing `tick()` function, add (after the existing activity checks, before the render calls):

```js
checkTimer()
```

Also add a per-second countdown refresh outside `tick()` so the countdown doesn't stutter by 60s jumps. Near the existing `setInterval(tick, TICK_MS)` call in `initAtmosphere`, add:

```js
setInterval(renderTimerCountdown, 1000)
```

**Step 4: Do not restore timer on reload.**

In `initAtmosphere`, after reading saved config, explicitly clear:
```js
state.atmosphere.audio.timerEndsAt = null
state.atmosphere.audio.timerMinutes = 0
```

**Step 5: Verify.**

```bash
cd ace-desktop && npm start
```

Open popover, set Timer to 15m while Calm is playing. Countdown appears. Open DevTools and fake the clock by advancing `state.atmosphere.audio.timerEndsAt` closer:
```js
// Simulate ~2:30 remaining to verify the fade-start condition
state.atmosphere.audio.timerEndsAt = Date.now() + 150_000
```
Wait ~30s. Audio should begin a linear fade. At 0, preset goes Off and countdown clears.

**Step 6: Verify reload clears timer.**

Set timer to 15m, then `location.reload()`. After reload: `state.atmosphere.audio.timerEndsAt` should be `null`, select should show `Off`, no countdown visible.

**Step 7: Commit.**

```bash
git add ace-desktop/renderer/modules/atmosphere.js
git commit -m "feat(audio): session timer with 2-minute auto-fade"
```

---

## Task 8 — CSS: accordion + timer + disclaimer

**Goal:** `.audio-pop-research` is hidden unless the button has `.selected`. Timer row + disclaimer get muted styling.

**Files:**
- Modify: [ace-desktop/renderer/shell.css](ace-desktop/renderer/shell.css) (or wherever the existing `.atm-audio-popover` rules live — search for it in Step 1).

**Step 1: Find existing popover styles.**

```bash
cd ace-desktop && grep -rn 'atm-audio-popover\|audio-pop-btn\|audio-pop-name' renderer/ --include='*.css'
```

Note the file + location. The new rules go alongside.

**Step 2: Add new rules.**

```css
/* Accordion research body — hidden by default, expanded when preset is selected */
.audio-pop-btn .audio-pop-research {
  display: none;
  margin-top: 6px;
  font-size: 11px;
  line-height: 1.4;
  opacity: 0.6;
}
.audio-pop-btn.selected .audio-pop-research {
  display: block;
}
.audio-pop-btn.selected {
  background: rgba(140, 120, 255, 0.08);  /* subtle violet wash to match atmosphere */
}

/* Timer row */
.audio-pop-timer-row {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 10px 12px;
  border-top: 1px solid rgba(255, 255, 255, 0.06);
  font-size: 12px;
  opacity: 0.75;
}
.audio-pop-timer-row label { flex: 0 0 auto; }
.audio-pop-timer-row select {
  background: transparent;
  border: 1px solid rgba(255, 255, 255, 0.12);
  color: inherit;
  font-size: 12px;
  padding: 2px 6px;
  border-radius: 4px;
}
.audio-pop-timer-countdown {
  margin-left: auto;
  opacity: 0.7;
}

/* Disclaimer */
.atm-audio-disclaimer {
  padding: 8px 12px 10px;
  font-size: 10px;
  line-height: 1.4;
  opacity: 0.4;
  text-align: center;
}
```

**Step 3: Light-theme parity (if applicable).**

Search for `theme-light` or `[data-theme="light"]` blocks in the CSS. If the existing popover has light-mode overrides, add matching ones for `.audio-pop-btn.selected` (use a darker violet rgba) and the timer row border.

**Step 4: Verify visual.**

```bash
cd ace-desktop && npm start
```

Open popover:
- Each preset is one row (name + Hz), no citation visible.
- Click Focus — citation appears inline under Focus, other presets stay collapsed.
- Click Gamma — Focus collapses, Gamma expands.
- Click Off — all collapsed.
- Timer row is subtle, near bottom.
- Disclaimer is barely-there muted text at the very bottom.

Measure popover height (DevTools → inspect `.atm-audio-popover` → Computed → height). Target: ≤ ~340px with a preset selected.

**Step 5: Commit.**

```bash
git add ace-desktop/renderer/shell.css  # or the file you modified
git commit -m "style(audio): accordion popover styling + timer + disclaimer"
```

---

## Task 9 — Final verification pass

**Goal:** End-to-end manual walkthrough with headphones on. No new code; just confirm nothing regressed.

**Step 1: Fresh install path.**

Kill Electron, clear config, relaunch:
```bash
# Reset userData to simulate fresh install (per memory feedback_ace_desktop_dual_config)
rm "/Users/nikhilkale/Library/Application Support/ACE/ace-config.json"
cd ace-desktop && npm start
```

Popover should show all presets Off-able. No errors. No stale "solfeggio"/"binaural" artifacts anywhere in UI or DOM.

**Step 2: Each preset — listen with headphones.**

For each of focus / gamma / calm / rest, in DevTools console:
```js
setPreset('focus')  // etc.
```
Confirm:
- Indicator shows `♪ Focus · 14 Hz · β 🎧`.
- Accordion expands the correct preset.
- Audio is audibly a binaural beat (pulsing mono-in-each-ear effect with headphones).
- Switching crossfades over ~30s without glitches.

**Step 3: Auto mode + time-of-day.**

```js
setPreset('auto')
// Fake time of day:
state.atmosphere.timeOfDay = 'evening'
setPreset('auto')  // re-resolve
```
Indicator should show Calm. Repeat for `'morning'` → Focus, `'late'` → Rest.

**Step 4: Breath enter/exit.**

Trigger breath view (click in sidebar). Listen: preset crossfades to Rest (3 Hz). Exit breath. Crossfades back.

**Step 5: Nudge shift.**

In DevTools:
```js
state.atmosphere.sessionActiveMin = 46  // force nudge condition
state.atmosphere.nudgeFired = false
state.atmosphere.nudgeDismissed = false
// Trigger tick manually:
// (or wait up to 60s for next tick)
```
Somatic bar should show nudge; audio crossfades to Calm.

**Step 6: Timer full cycle (optional but recommended).**

Set Timer to 15m. Leave running. Return ~13 minutes later. Confirm fade begins around remaining=2m, audio stops at ~0, select resets to Off.

**Step 7: Old-config migration on a saved config.**

If you have a backup ace-config.json with old `ace-atm-audio-sol` / `ace-atm-audio-bin` keys, drop it into the userData path and restart ACE. Confirm the app starts without errors and `localStorage.getItem('ace-atm-audio-preset')` returns `calm` (per Task 1's migration).

**Step 8: DevTools console sweep.**

Check the console at boot — no errors, no warnings from atmosphere.js.

**Step 9: Final commit (if any touch-ups were needed during verification).**

If you ran the pass cleanly without edits, nothing to commit. Otherwise:
```bash
git commit -m "fix(audio): <specific finding>"
```

**Step 10: Push branch + open PR.**

```bash
git push -u origin audio-accuracy-apr21
# Open PR against main manually via GitHub UI or `gh` if installed
```

---

## Verification Matrix (quick reference)

| Concern | How to verify |
|---|---|
| Old config migrates cleanly | Task 1 Step 3 |
| Engine has no stale solfeggio refs | Task 3 Step 2 |
| External callers updated | Task 4 Step 3 |
| Accordion shows one citation at a time | Task 8 Step 4 |
| Popover height ≤ ~340px | Task 8 Step 4 |
| Audio crossfades without glitches | Task 9 Step 2 |
| Timer fade + auto-off works | Task 9 Step 6 |
| Reload clears active timer | Task 7 Step 6 |
| No console errors at boot | Task 9 Step 8 |

## Out of Scope (not in this plan)

- Volume slider UI (existing `audio.volume` stays at 0.03 — can add later).
- Waveform visualization in the popover.
- Porting Resonance's full preset dataset.
- Linking to `/regulate` skill.
- Changes to somatic bar, nudge logic, coherence integration.
- Tests (no framework; manual only per memory [reference_ace_desktop_no_tests.md](memory/reference_ace_desktop_no_tests.md)).
