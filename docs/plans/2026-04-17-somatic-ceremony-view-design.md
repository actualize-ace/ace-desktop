# Somatic Ceremony View — Design Doc

**Status:** APPROVED  
**Date:** 2026-04-17  
**Prototype:** `docs/prototypes/somatic-transitions-prototype.html`

---

## 1. Problem Statement

ACE Desktop currently has no embodied threshold between "not working" and "working." Users open the app and land directly in chat or cockpit — no arrival, no departure. The day starts without settling and ends without landing.

The somatic atmosphere system (intensity bar, nudge strip, breath view) regulates *during* work, but nothing marks the **transitions** between states: beginning a day, closing a session, entering a weekly review. These thresholds are where the body either settles or braces, and right now the app skips them entirely.

## 2. What We're Building

A dedicated **ceremony view** — a full-stage animated transition that bookends key rituals (start of day, close, weekly review, monthly reflection). Plus a **time-aware trigger** system that surfaces somatic cues when a ceremony is available.

### Not building (Phase 2)
- Voice input/output (STT/TTS)
- Embedded coaching prompts during transitions
- AI-generated ceremony content
- Dynamic responses during transitions

## 3. Trigger Mechanism

### 3.1 Detection Logic

| Ritual | Condition | Priority | Destination |
|--------|-----------|----------|-------------|
| Monthly reflection | Last day of month + after 5am + not completed this month | 1 (highest) | Chat → /monthly-reflection |
| Weekly review | Saturday + after 5am + not completed this week | 2 | Chat → /weekly-review |
| Start of day | First app focus after 5am + no /start today | 3 | Cockpit |
| End of day | After 7pm + at least one session logged + /close hasn't run | 4 (lowest) | Rest state |

**Priority rule:** One ceremony at a time. Highest-priority ritual fires first. After it completes or is dismissed, the next pending ceremony's cue reappears.

**No guilt accumulation:** If a ceremony is skipped, it doesn't persist past its window:
- Start of day: cue disappears after noon
- End of day: cue disappears at 3am
- Weekly review: cue disappears Sunday midnight
- Monthly reflection: cue disappears after 2 days

### 3.2 Visual Cues (Two Surfaces, One Signal)

**ACE mark (sidebar):**
- Normal: standard breathing pulse
- Ceremony available: glow shifts to dawn-gold (morning rituals) or amber-settle (evening rituals)
- The mark doesn't badge, flash, or count — it breathes differently

**Somatic bar (bottom strip):**
- Normal: cycles through intensity-appropriate text pools
- Ceremony available: text shifts to ceremony-specific invitation
  - Start of day: *"the day is ready"*
  - End of day: *"time to land"*
  - Weekly review: *"the week wants your attention"*
  - Monthly reflection: *"a month to witness"*

Both surfaces activate together. Clicking either opens the ceremony view.

### 3.3 Chat Integration

`/start`, `/close`, `/eod`, `/weekly-review`, `/monthly-reflection` typed in chat also trigger the ceremony view before executing the skill. The renderer intercepts these commands, plays the transition, then routes to the destination with the skill executing.

## 4. Ceremony View

### 4.1 Structure

The ceremony view is a full-stage overlay that replaces the current view content. It owns the entire viewport below the titlebar.

**Lifecycle:**
1. Trigger fires (click cue or type command)
2. Ceremony view mounts, takes full stage
3. Transition animation plays (3-5 seconds)
4. On completion: routes to destination (cockpit, chat, or rest)
5. Ceremony view unmounts

### 4.2 Transition Styles

Three styles, user selects in settings. Default: **C (Ship Boot)**.

#### A — "Eyes Open" (Meditation Emergence)
- Cockpit starts fully blurred (20px) and dim (brightness 0.3)
- Over 4 seconds, blur dissolves and brightness rises
- A breath ring expands at center during opening
- Italic whisper text ("settle in") fades through at midpoint
- Quality: deceleration, body-first

#### B — "Temple Threshold" (Door Reveal)
- Two vertical door panels cover the viewport
- Ornamental light seam glows between them
- Center glyph pulses ("Welcome home")
- Doors part left/right over 2.8s, revealing cockpit behind
- Elements stagger in: orb → synthesis → triad cards
- Quality: ceremony, crossing a boundary

#### C — "Ship Boot" (Systems Online)
- Scan line sweeps top to bottom (2.5s)
- Boot lines appear sequentially:
  - `initializing coherence engine`
  - `loading triad signals`
  - `syncing vault state`
  - `calibrating atmosphere`
  - `connecting nervous system`
  - `all systems nominal`
- Boot overlay fades, cockpit powers on with subsystem labels briefly flashing
- Quality: gravitational assembly, vessel coming to life

#### Close / Departure (shared across all styles)
- Current view settles downward (gravity — scale 0.94, translateY 24px)
- Blur and dim increase progressively
- Close overlay fades in with:
  - Progress ring (spinning close indicator)
  - Session stats: sessions count, active time, items shipped
  - Departure message in italic script: *"the work landed. rest well."*
- Final dim to black/rest state

### 4.3 Skip

- **Escape** or **click anywhere** during animation → immediate skip to destination
- **Settings toggle:** "Skip ceremony animations" → disables all ceremonies globally
- Skip is always available, never penalized, never commented on

## 5. Settings Schema

New fields in `ace-config.json`:

```json
{
  "ceremony": {
    "style": "ship-boot",
    "triggers": {
      "startOfDay": true,
      "endOfDay": true,
      "weeklyReview": true,
      "monthlyReflection": true
    },
    "skipAnimations": false
  }
}
```

`style` values: `"eyes-open"` | `"temple"` | `"ship-boot"`

## 6. Files Affected

**New files:**
- `renderer/views/ceremony.js` — view logic, animation orchestration, trigger routing
- `renderer/styles/views/ceremony.css` — all three transition styles + close sequence

**Modified files:**
- `renderer/modules/atmosphere.js` — detection logic (time-of-day + ritual state checks)
- `renderer/views/sidebar.js` (or equivalent) — mark glow state for ceremony cues
- `renderer/modules/chat-manager.js` — intercept /start, /close, /eod commands to trigger ceremony
- `ace-config.json` schema — ceremony preferences

## 7. Design Principles

1. **Somatic, not alarm** — the cue breathes differently, never badges or counts
2. **One at a time** — no stacking, highest priority wins
3. **No guilt** — missed ceremonies expire silently
4. **Always skippable** — the ceremony invites, never blocks
5. **The animation IS the threshold** — not decoration before content, but the felt experience of crossing into/out of a state
6. **GPU-only animations** — transform, opacity, filter only. No layout thrash. `prefers-reduced-motion` respected.
