# Cadence Ticker — Design Doc

**Date:** 2026-04-14
**Status:** Approved
**Prototype:** `2026-04-14-cadence-ticker-prototype.html`

## Problem

Users forget to run `/weekly-review` and `/monthly-reflection`. Existing nudges (Sunday hint in Synthesis, E2 signal dispatch in Integrity) are buried and reactive. Need a persistent, visible reminder with staleness tracking.

## Design

### Layout

A **Cadence Ring** in the `cockpit-brain-row` right column (280px), replacing the standalone Ritual Streak widget. The ring is a 240x240 circular form that visually balances the Coherence Orb on the left.

The circle splits into two halves:
- **Top half:** Ritual Streak (existing) — streak count, "ritual streak" label, 7-day dot grid
- **Bottom half:** Cadence Ticker (new) — `W: 3d · M: 18d` with color-coded pips

A subtle gradient divider separates the halves.

### Detection

**File-based** — no cron, no persistent state.
- **Weekly:** Scan `01-Journal/weekly-reviews/` for most recent `YYYY-WXX.md`, parse ISO week to date.
- **Monthly:** Scan `01-Journal/monthly-reviews/` for most recent `YYYY-MM.md`, derive date.
- Computed at dashboard render time (every load).

### Thresholds

| Review  | Green | Amber | Red   |
|---------|-------|-------|-------|
| Weekly  | 0-7d  | 8-9d  | 10d+  |
| Monthly | 0-31d | 32-37d| 38d+  |

### Cadence Chips

Each review type renders as a chip: `pip + key + days + arrow`

- **Pip:** 6px colored dot (green/amber/red) with matching glow shadow. Red pips pulse.
- **Key:** `W:` or `M:` in mono, secondary color.
- **Days:** `3d` in mono, colored by threshold.
- **Arrow:** `▷` — always reserves 10px width. Invisible (opacity 0) when green. Fades in when amber/red. No layout shift.

### Hover

Tooltip shows full date: `"Last weekly review: Apr 11, 2026"`
When overdue, appends: `" — click to run"`

### Click

Launches the corresponding skill (`/weekly-review` or `/monthly-reflection`) in the chat pane. Same pattern as Integrity regen button: navigate to terminal view, spawn session, send skill command.

### Overdue Ring Pulse

When either cadence is amber or red, the bottom half of the ring track pulses:
- **Amber:** 3s breathing glow, `rgba(224,192,96)` tones.
- **Red:** 2.2s faster pulse, `rgba(224,112,128)` tones.
- Worst state between weekly and monthly wins the ring color.

Implemented via `::after` pseudo-element with `clip-path: inset(50% 0 0 0)` to isolate the bottom half.

### Widget Registration

- New composite widget `cadence` in `widgets/registry.js`, `dataSource: null`.
- Absorbs the existing `ritualstreak` widget — both render inside the shared ring container.
- `defaultEnabled: true`, placed in `cockpit-brain-row` right column (same slot as current ritualstreak).

### Styling

- Follows cockpit design tokens: `--font-display` (Space Grotesk), `--font-mono` (JetBrains Mono), `--font-body` (DM Sans).
- Ring track: 1px solid `rgba(212,165,116,0.12)` with inner dashed ring.
- Colors: `--green` (#60d8a8), `--yellow` (#e0c060), `--red` (#e07080).
- Streak elements use existing `--amber` (#d4a574) warm gold.

## Out of Scope

- Cron jobs or background scheduling.
- Tracking whether the review was _completed_ (only tracks last file creation date).
- Monthly review reminder in Integrity widget (could add later if needed).
