# Atmosphere Audio — Accuracy + Accordion Redesign

**Date:** 2026-04-21
**Scope:** `ace-desktop/renderer/modules/atmosphere.js` + audio popover markup in `ace-desktop/renderer/index.html`
**Reference repo:** [JTruax/resonance-sound-frequencies](https://github.com/JTruax/resonance-sound-frequencies) (MIT) — used as accuracy benchmark, not code import
**Status:** Design approved. Ready for implementation plan.

## Problem

The existing audio popover has three issues discovered during review against peer-reviewed binaural-entrainment literature:

1. **Mislabeled frequencies.**
   - "Focus · 528 Hz" — 528 Hz is the Horowitz/Puleo "love / DNA repair" tradition frequency; no research associates it with focus. Actual focus research points to 14–20 Hz beta entrainment or 40 Hz gamma.
   - "Calm · 174 Hz" — 174 Hz is Horowitz "foundation / pain relief"; not sleep/calm. Actual calm/sleep research points to alpha (10 Hz) and delta (2–4 Hz) entrainment.
   - "Ground · 396 Hz" — tradition-only; no peer-reviewed basis.

2. **Incorrect binaural carrier.** Current engine uses the solfeggio frequency as the binaural carrier (e.g. 528 Hz + 14 Hz offset = 521 / 535 Hz oscillators). Standard entrainment research uses a **200 Hz carrier** — at high carriers (>400 Hz) the brain perceives the beat weakly or not at all. Current presets are near-ineffective as binaural beats.

3. **Two-axis picker adds complexity without adding value.** Solfeggio × Binaural creates 12 combinations but users were effectively picking a single intent. Most combinations are not research-grounded.

## Decision Summary

- Replace 3 solfeggio × 4 binaural axes with **4 single-intent presets**, all research-backed.
- Hard-code binaural carrier to **200 Hz** (decoupled from preset frequency).
- Collapse picker UI into an **accordion** — selected preset expands inline to show citation.
- Add session **timer with 2-minute auto-fade**.
- Drop all tradition-only presets (174, 396, 528 Hz).

## §1 — Presets (locked)

All four presets are binaural beats on a 200 Hz carrier.

| Key      | Label            | Carrier | Beat | Use              | Citation |
|----------|------------------|---------|------|------------------|----------|
| `focus`  | Focus · 14 Hz β  | 200     | 14   | Deep work, building | Garcia-Argibay et al., 2019 — meta-analysis, beta entrainment + cognitive performance |
| `gamma`  | Gamma · 40 Hz    | 200     | 40   | Neural coherence, integration | Iaccarino et al. 2016 (Nature) — amyloid clearance via 40 Hz; Naghdi et al. 2019 — fibromyalgia |
| `calm`   | Calm · 10 Hz α   | 200     | 10   | Wind-down, gentle regulation | Isik et al. 2021 — RCT, 10 Hz binaural beats vs. standard care in MDD |
| `rest`   | Rest · 3 Hz δ    | 200     | 3    | Pre-sleep, deep rest | Jirakittayakorn & Wongsawat 2018 — 3 Hz binaural increased N3 deep-sleep duration and reduced N3 latency |

**Auto mode remap:**
- morning → `focus`
- afternoon → `focus`
- evening → `calm`
- late → `rest`

**Hook remaps:**
- `audioNudgeShift()` targets `calm` (replaces hardcoded 174 Hz).
- `audioBreathEnter()` targets `rest` (deeper than calm — matches breath ritual's slowing intent).
- `audioBreathExit()` returns to previously-active preset.

**Intentionally dropped:**
- 174 Hz, 396 Hz, 528 Hz solfeggio presets (mislabeled / tradition-only).
- Earth 7.83 Hz Schumann (documented physics, but the health-benefit framing is thin; excluded to keep the set fully research-backed).

## §2 — Audio Engine Changes

File: `ace-desktop/renderer/modules/atmosphere.js`, lines ~866–1034.

1. **Single preset API.** Replace `setSolfeggio(key)` + `setBinaural(key)` with single `setPreset(key)` where `key ∈ {focus, gamma, calm, rest, auto, off}`.

2. **Fix binaural carrier.** Hard-code `CARRIER_HZ = 200`. Every preset: `200 - beat/2` on left pan, `200 + beat/2` on right pan.

3. **Remove solfeggio-only synthesis path.** Delete `startSolfeggio` / `stopSolfeggio` / `crossfadeSolTo`, the `solOsc` / `solGain` state, and the `SOLFEGGIO` constant (~60 lines). Keep the binaural pair as the only synthesis path.

4. **Crossfade on preset switch.** Keep carrier constant at 200; ramp the left/right offsets toward the new beat over `CROSSFADE_MS` (existing 30s constant).

5. **localStorage migration.** One-time read of old keys `ace-atm-audio-sol` + `ace-atm-audio-bin`. If either was non-'off', default the new `ace-atm-audio-preset` key to `calm`. Delete old keys. Idempotent on re-runs.

6. **`renderAudioIndicator()` simplified.** Single preset label instead of composed "Focus + 14 Hz 🎧". Always show 🎧 when preset active (all presets are binaural). Example output: `♪ Calm · 10 Hz` or `♪ Off`.

7. **State shape change:**
   ```js
   state.atmosphere.audio = {
     mode: 'on' | 'off',
     preset: 'focus' | 'gamma' | 'calm' | 'rest' | 'auto',
     volume: 0.15,
     timerEndsAt: null | number,  // timestamp
     // removed: solfeggio, binaural
   }
   ```

## §3 — Timer + Auto-Fade

**UI:** single row below preset list — `⏱ Timer [Off | 15m | 30m | 45m | 60m ▼]`. When active, a muted countdown appears next to the select: `Ends in 24m`.

**Constants:**
```js
const TIMER_FADE_MS = 2 * 60_000  // 2-minute auto-fade before hard stop
```

**Behavior:**
- On timer set: `state.atmosphere.audio.timerEndsAt = Date.now() + minutes * 60_000`.
- On each `tick()` (60s): check remaining.
  - If `remaining <= TIMER_FADE_MS` and not already fading: begin linear gain ramp from current volume to 0 over the remaining time.
  - If `remaining <= 0`: call `setPreset('off')`, clear `timerEndsAt`.
- On reload: do not restore timer. `timerEndsAt` is cleared on `initAtmosphere()`.
- On app return from background: if `timerEndsAt` already passed, call `setPreset('off')` and clear — don't resume a timer that should have ended.

**Rationale for 2-minute fade:** Long enough to gently exit `rest` at sleep without a jarring cut; short enough that a 15m session doesn't lose meaningful entrainment time.

## §4 — Research Strip

Citations live in a `PRESET_RESEARCH` map, rendered into the accordion-expanded body of the selected preset (see §5). Locked copy:

- **focus** — *"200 Hz carrier + 14 Hz beta beat. Beta entrainment associated with sustained attention improvements. Meta-analysis: Garcia-Argibay et al., 2019."*
- **gamma** — *"200 Hz carrier + 40 Hz gamma beat. Linked to neural coherence; animal models show amyloid clearance. Iaccarino et al. 2016 (Nature); Naghdi et al. 2019."*
- **calm** — *"200 Hz carrier + 10 Hz alpha beat. RCT: alpha entrainment reduced depressive symptoms vs. standard care. Isik et al., 2021."*
- **rest** — *"200 Hz carrier + 3 Hz delta beat. Controlled study: 3 Hz increased N3 deep-sleep duration and shortened N3 latency. Jirakittayakorn & Wongsawat, 2018."*

**Disclaimer (single muted line, bottom of popover):**
*"Effects vary. Not medical advice. Use headphones for binaural entrainment."*

**No external hyperlinks.** ACE stays offline-capable; citations are locator text only. Users can look up the papers manually if they want.

## §5 — Popover Layout (Accordion)

Replaces current markup at `ace-desktop/renderer/index.html` lines ~1342–1383.

```
┌─ ♪ Audio Popover ──────────────────────┐
│ Preset   🎧 headphones                 │
│ ─────────────────────────────────────  │
│ Focus          14 Hz · β               │  ← 30px unselected row
│ ─────────────────────────────────────  │
│ ▼ Gamma        40 Hz · γ               │  ← 60px expanded row
│   200 Hz + 40 Hz gamma beat. Linked    │     (shows citation inline)
│   to neural coherence; animal models   │
│   show amyloid clearance. Iaccarino    │
│   2016; Naghdi 2019.                   │
│ ─────────────────────────────────────  │
│ Calm           10 Hz · α               │
│ Rest           3 Hz · δ                │
│ Auto           follows time            │
│ Off                                    │
│ ─────────────────────────────────────  │
│ ⏱ Timer  [30m ▼]  Ends in 24m          │
│ Effects vary. Not medical advice.      │
└────────────────────────────────────────┘
```

**DOM changes:**
- Replace `data-sol` / `data-bin` attrs with single `data-preset` on each button.
- "🎧 headphones" hint moves to single Preset section header.
- New elements:
  - `#atm-audio-timer-select` (native `<select>`)
  - `#atm-audio-timer-countdown` (updates on tick)
  - `.audio-pop-btn .audio-pop-research` (inline citation, rendered only when `.selected`)
  - `.atm-audio-disclaimer`
- Removed: separate `Solfeggio Tone` / `Binaural Beat` sections, per-button desc lines.

**Behavior:**
- Click preset button → select it + start playing + expand inline to show citation. Re-clicking same preset = no-op (already selected).
- Only one preset is `.selected` at a time; CSS toggles the expanded body.
- `Off` button removes `.selected` from everything, calls `setPreset('off')`.

**Footprint:** ~320px (vs. ~550px today). 40% reduction.

**CSS additions:** reuse existing muted-text tokens; add `.audio-pop-btn.selected .audio-pop-research { display: block }` — default `display: none`.

## Out of Scope (Not in this change)

- Porting Resonance's full 40+ preset dataset. B is a curated subset; keeping ACE lean is the point.
- Resonance's knowledge-base markdown doc. Linking from `/regulate` is a possible future move but not part of this design.
- New volume slider, mute toggle, or UI for the 🎧 headphone detection. Existing volume state stays as-is.
- Waveform visualization. Good feature, but lives on the somatic bar today via coherence integration; no reason to duplicate.
- Changes to the somatic bar, nudge logic, coherence integration, or refresh-engine hooks. Audio hooks (`audioNudgeShift`, `audioBreathEnter`, `audioBreathExit`) stay, just retargeted per §1.

## Risks + Mitigations

- **Breaking change to persisted config.** Migration in §2.5 handles old `ace-atm-audio-sol` / `ace-atm-audio-bin` keys. Smoke test on a config with both keys set to non-'off'.
- **User muscle memory.** Users who relied on "Focus · 528 Hz" will see it's gone. The new `focus` preset is what they wanted but didn't have — a 14 Hz beta beat. No migration path surfaces a notice; the popover change is self-explanatory.
- **Audio quirks on `setPreset` rapid-clicking.** Existing engine already handles this via crossfade; no changes needed, but test rapid preset switching.

## Dependencies + Branch

- Not part of `perf-hardening-apr20` (current active branch). Should land on its own branch — suggested: `audio-accuracy-apr21`.
- No new packages. Pure Web Audio API + existing module structure.
- No test framework in `ace-desktop/` — manual verification via `npm start` + DevTools + actual headphone listening test.

## Next Steps

Invoke `superpowers:writing-plans` to convert this design into a stepwise implementation plan with explicit verification gates.
