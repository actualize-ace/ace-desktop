# Triad Column Redesign — Signal Decode + One Action

**Status:** Ready to build
**Branch:** create `triad-column-redesign` from main
**Scope:** 5 files changed, 1 new file, ~150 lines

## Problem

The three Authority / Capacity / Expansion columns on the home dashboard are never used. They mirror raw vault data (outcomes list, mode tag, targets checklist, follow-ups, pipeline) that the synthesis widget already surfaces more intelligently. They take up prime real estate and add no value.

## Solution

Replace each column's contents with two things:

1. **Signal Decode** — 3 readable rows per column showing signal key, name, color dot, and a one-line rule-based status read. No AI call needed.
2. **One Action** — the single highest-priority item for that Triad leg, pulled from the existing priority system in synthesis.js.

Graceful fallback at every layer: dim signals when no `/pulse` has run, empty-state nudge when no action exists for a leg.

## Architecture (Why This Is Clean)

- **Zero new IPC channels** — all data already fetched (signals from `getMetrics`, priorities from `getState` + `getFollowUps` + `getPipeline`)
- **Zero backend changes** — `vault-reader.js` and `synthesizer.js` untouched
- **Zero AI calls** — signal decode is pure rules, instant render
- **Fallback already built in** — signals default to `dim[]`, every parser returns `[]` on missing data

## Signal Decode Spec

Each column shows 3 signal rows:

```
Authority                    ● ● ●
─────────────────────────────────
● A1  Truth        GREEN
● A2  Choice       —
● A3  Expression   YELLOW

[ One Action Card ]
```

Signal-to-column mapping (already exists in dashboard.js:114-117):
- Authority: A1 Truth, A2 Choice, A3 Expression → signals[0..2]
- Capacity: C1 Regulation, C2 Depth, C3 Resilience → signals[3..5]
- Expansion: E1 Rhythm, E2 Containers, E3 Realization → signals[6..8]

Color rendering: reuse existing `.triad-dot` classes (green/yellow/red/dim).
Status label: `{ green: 'GREEN', yellow: 'YELLOW', red: 'RED', dim: '—' }`

When all 3 signals are dim → show nudge: "Run /pulse to activate signals."

## One Action Spec

Each column shows the top priority item tagged to that Triad leg:

| Priority type | Triad leg |
|---------------|-----------|
| outcome (gate/status) | Authority |
| followup (overdue) | Capacity |
| pipeline (deal) | Expansion |
| target (weekly) | Expansion |
| cadence (ritual) | Expansion |

Display: urgency dot + label + context line + click-to-terminal (reuse existing `dash-clickable` pattern).

When no action exists for a leg → show calm empty: "No urgent items."

## Implementation Steps

### Step 1: Create `renderer/widgets/triad-leg.js`

New composite widget (dataSource: null) that renders both signal decode and one action.

```js
// Exported as three widget instances:
// triad-authority, triad-capacity, triad-expansion
// Each receives allData and renders its leg.

const SIGNAL_NAMES = {
  A1: 'Truth', A2: 'Choice', A3: 'Expression',
  C1: 'Regulation', C2: 'Depth', C3: 'Resilience',
  E1: 'Rhythm', E2: 'Containers', E3: 'Realization',
}

const LEG_CONFIG = {
  authority: { signals: ['A1','A2','A3'], offset: 0, actionTypes: ['outcome'] },
  capacity:  { signals: ['C1','C2','C3'], offset: 3, actionTypes: ['followup'] },
  expansion: { signals: ['E1','E2','E3'], offset: 6, actionTypes: ['pipeline','target','cadence'] },
}
```

Key functions:
- `renderSignalDecode(signals, keys)` — 3 rows with dot + key + name + status label
- `renderOneAction(priorities, allowedTypes)` — first matching priority or empty state
- `buildLegPriorities(allData, leg)` — extract priorities using same logic as synthesis.js `_buildPriorities`, filtered by leg

### Step 2: Update `renderer/index.html` (lines 316-340)

Replace multiple widget divs per column with one container each:

```html
<div class="triad-col triad-authority">
  <div class="triad-col-header">
    <div class="triad-col-label">Authority</div>
    <div class="triad-dots" id="dots-authority"></div>
  </div>
  <div id="widget-triad-authority"></div>  <!-- was widget-outcomes -->
</div>
<div class="triad-col triad-capacity">
  <div class="triad-col-header">
    <div class="triad-col-label">Capacity</div>
    <div class="triad-dots" id="dots-capacity"></div>
  </div>
  <div id="widget-triad-capacity"></div>  <!-- was widget-state + widget-followups -->
</div>
<div class="triad-col triad-expansion">
  <div class="triad-col-header">
    <div class="triad-col-label">Expansion</div>
    <div class="triad-dots" id="dots-expansion"></div>
  </div>
  <div id="widget-triad-expansion"></div>  <!-- was widget-targets + widget-pipeline -->
</div>
```

### Step 3: Update `renderer/widgets/registry.js`

- Remove imports: `state`, `outcomes`, `targets`, `pipeline`, `followups`
- Add imports: `triadAuthority`, `triadCapacity`, `triadExpansion` from `./triad-leg.js`
- Update WIDGETS array: replace the 5 removed entries with the 3 new ones

### Step 4: Update `renderer/dashboard.js`

- The triad-leg widgets use `dataSource: null` (composite) — already handled by the existing render loop at lines 99-101
- Remove the signal dot rendering block (lines 112-122) — dots are now rendered inside each triad-leg widget, OR keep them in the header and let the widget just render below

Decision: **Keep dots in the header** (dashboard.js renders them as today). The widget renders signal decode + one action below. This is simpler — fewer moving parts.

### Step 5: Add CSS to `renderer/styles/views/home.css`

```css
/* Signal decode rows */
.signal-decode-row {
  display: flex; align-items: center; gap: 8px;
  padding: 4px 0;
}
.signal-decode-dot { /* reuse .triad-dot sizing */ }
.signal-decode-key {
  font-family: 'JetBrains Mono', monospace;
  font-size: 8px; letter-spacing: 0.5px;
  color: var(--text-dim); width: 18px;
}
.signal-decode-name {
  font-size: 10.5px; color: var(--text-secondary); flex: 1;
}
.signal-decode-status {
  font-family: 'JetBrains Mono', monospace;
  font-size: 8px; letter-spacing: 0.5px; text-transform: uppercase;
}
.signal-decode-status.green  { color: var(--green); }
.signal-decode-status.yellow { color: var(--gold); }
.signal-decode-status.red    { color: var(--red); }
.signal-decode-status.dim    { color: var(--text-dim); }

/* One action card */
.leg-action {
  margin-top: 12px; padding: 10px 12px;
  background: var(--bg-elevated);
  border: 1px solid var(--border);
  border-radius: 6px;
}
.leg-action-label { font-size: 11px; font-weight: 500; color: var(--text-primary); }
.leg-action-context {
  font-family: 'JetBrains Mono', monospace;
  font-size: 9px; color: var(--text-dim); margin-top: 3px;
}
```

### Step 6: Clean up old widget files

Don't delete — just remove from registry. Files stay in case we want to reference them:
- `outcomes.js` — no longer imported
- `state.js` — no longer imported
- `targets.js` — no longer imported
- `pipeline.js` — no longer imported
- `followups.js` — no longer imported

### Step 7: Test

1. Launch app — columns should show signal decode + one action
2. Delete `system-metrics.md` signals → all dots should go dim, nudge appears
3. Empty `active.md` outcomes → Authority action shows empty state
4. Empty `follow-ups.md` → Capacity action shows empty state
5. No pipeline deals → Expansion falls back to weekly target or empty

## Files Changed

| File | Change |
|------|--------|
| `renderer/widgets/triad-leg.js` | **NEW** — composite widget, ~80 lines |
| `renderer/widgets/registry.js` | Swap 5 imports → 3 imports |
| `renderer/index.html` | Simplify column containers (lines 316-340) |
| `renderer/styles/views/home.css` | Add signal-decode + leg-action CSS (~30 lines) |
| `renderer/dashboard.js` | No change needed (dots stay in header, composite routing already works) |

## What NOT to Touch

- `src/vault-reader.js` — data layer is fine
- `src/synthesizer.js` — signal parsing is fine
- `renderer/widgets/synthesis.js` — keeps doing the smart AI work
- `main.js` / `preload.js` — no new IPC channels
