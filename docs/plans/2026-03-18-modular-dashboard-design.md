# Modular Dashboard Design
**Date:** 2026-03-18
**Status:** Approved — ready for implementation

---

## Overview

Refactor the ACE Desktop home view from a hardcoded layout into a modular widget system. Each widget is a self-contained JS module. Users can toggle and reorder widgets via a settings panel. Layout persists to `ace-config.json`. A synthesis bar sits at the top of every dashboard — always — delivering a rule-based system health summary instantly, followed by an AI-generated brief via the Anthropic SDK.

**Scope:**
- Widget registry with per-file modules
- Layout config in `ace-config.json`
- SortableJS-powered toggle + reorder settings panel
- Synthesis bar: rule-based (instant) + Claude AI layer (async, on by default)
- New velocity widget: 14-day shipping chart from `execution-log.md`
- New IPC channel: `GET_VELOCITY`

---

## 1. Widget Registry Architecture

Each widget lives in `renderer/widgets/<id>.js` and exports a plain object:

```js
// renderer/widgets/velocity.js
export default {
  id: 'velocity',
  label: '14-Day Velocity',
  description: 'Shipping cadence bar chart from execution log',
  dataSource: 'getVelocity',       // maps to window.ace.dash method
  defaultEnabled: true,
  render(data, container) {
    // draws into container element
  },
  onUpdate(cb) {
    // optional: subscribe to live updates
  }
}
```

**Widget registry** (`renderer/widgets/index.js`) exports an ordered array of all available widgets. This is the canonical list — new widgets are registered here.

```js
import state    from './state.js'
import outcomes from './outcomes.js'
import targets  from './targets.js'
import metrics  from './metrics.js'
import pipeline from './pipeline.js'
import followups from './followups.js'
import velocity from './velocity.js'

export const WIDGETS = [state, outcomes, targets, metrics, pipeline, followups, velocity]
```

**Orchestrator** (`renderer/index.html` script):
1. Read `ace-config.json` layout array on load
2. Filter `WIDGETS` to enabled ones, in config order
3. Collect unique `dataSource` values from enabled widgets
4. Fetch only those data sources in parallel (`Promise.all`)
5. Render each widget into its container div in order
6. Subscribe to live update events

---

## 2. Layout Config Schema

Added to existing `ace-config.json`:

```json
{
  "vaultPath": "/path/to/vault",
  "claudeBinaryPath": "/path/to/claude",
  "layout": [
    { "id": "synthesis",  "enabled": true },
    { "id": "metrics",    "enabled": true },
    { "id": "outcomes",   "enabled": true },
    { "id": "targets",    "enabled": true },
    { "id": "pipeline",   "enabled": true },
    { "id": "followups",  "enabled": true },
    { "id": "velocity",   "enabled": true }
  ]
}
```

If `layout` is absent (first run / existing users), the orchestrator writes the default layout on startup. Unknown widget IDs in the config are silently ignored (forward-compatibility).

---

## 3. Synthesis Bar

The synthesis bar is a special widget (`renderer/widgets/synthesis.js`) that sits at the top of the dashboard. It has two layers that render sequentially.

### Layer 1 — Rule-based (instant)

Runs synchronously from vault data already loaded. Ports the `generate_health_insights` logic from `tools/ace-analytics/daily_dashboard.py` into a JS function in `src/vault-reader.js`.

Computes:
- Coherence score (0–18) from pulse signal details in `system-metrics.md`
- Top 1–2 flagged signals (RED first, then YELLOW)
- Overdue follow-up count
- Days since last execution log entry (cadence gap)
- Anti-state if present

Renders immediately as a 1–2 sentence structural summary:
> **Coherence 14/18 — STABLE.** E1 rhythm holding. Two overdue follow-ups compressing choice space. A3 quiet 6 days.

### Layer 2 — AI synthesis (async, on by default)

After Layer 1 renders, an IPC call to `main.js` triggers an Anthropic SDK request from the main process. The prompt passes:
- Current mode + energy
- Coherence score + top signals
- Active outcomes (titles + status)
- Weekly targets (done/total)
- Pipeline summary (count + value)
- Velocity summary (this week vs last week)
- Overdue follow-ups count
- Days since last content post

The AI returns 2–3 sentences in the user's voice (loaded from `00-System/core/voice-profile.md`). When the response arrives, the rule-based summary fades out and the AI synthesis fades in.

**Config flag:** `"aiSynthesis": true` in `ace-config.json`. Defaults to true. If false or if `ANTHROPIC_API_KEY` is not set, Layer 1 persists.

### IPC: Synthesis

```
GET_SYNTHESIS → main.js → reads vault data → calls Anthropic SDK → returns { structural, ai }
```

`structural` is returned immediately (sync). `ai` is a Promise that resolves when the API call completes. The renderer handles both independently.

### Anthropic SDK in Main Process

```js
// main.js (or src/synthesizer.js)
const Anthropic = require('@anthropic-ai/sdk')

async function getSynthesis(context) {
  const client = new Anthropic()   // reads ANTHROPIC_API_KEY from env
  const msg = await client.messages.create({
    model: 'claude-haiku-4-5-20251001',
    max_tokens: 150,
    messages: [{ role: 'user', content: buildPrompt(context) }]
  })
  return msg.content[0].text
}
```

Uses `claude-haiku-4-5-20251001` for speed and cost. The prompt is a compact system brief — no conversation history needed.

---

## 4. Velocity Widget

### New IPC Channel

```js
// src/ipc-channels.js
GET_VELOCITY: 'get-velocity'
```

### vault-reader.js addition

```js
function parseExecutionLog(vaultPath, days = 14) {
  // reads 00-System/execution-log.md
  // counts entries per date over last N days
  // returns { by_day: { "2026-03-17": 3, ... }, total_this_week, total_last_week }
}
```

### Renderer widget

`renderer/widgets/velocity.js` renders a Chart.js bar chart (same library already used in `daily-dashboard.html`). Chart.js is added as a dependency or loaded from CDN. Bars colored with ACE gold (`#d4a574`), 14 bars representing last 14 days.

---

## 5. Settings Panel

A settings view (accessible via gear icon in sidebar) renders all registered widgets as a drag-to-reorder list using SortableJS.

Each row:
- Drag handle (left)
- Widget label + description
- Toggle switch (right)

On any change (drag or toggle):
1. Serialize new order + enabled state to `layout` array
2. Call `window.ace.config.saveLayout(layout)` → IPC → writes `ace-config.json`
3. Re-render dashboard with new layout (no page reload needed)

SortableJS is added as a devDependency or bundled inline (~10KB).

---

## 6. Data Flow (Full)

```
App load
  │
  ├─ Read ace-config.json (layout array)
  │
  ├─ Filter WIDGETS registry → enabled widgets in order
  │
  ├─ Collect unique dataSources from enabled widgets
  │
  ├─ Promise.all([getState, getPipeline, getFollowUps, getMetrics, getVelocity, getSynthesis])
  │     └─ getSynthesis:
  │           ├─ Layer 1: compute structural summary synchronously → render immediately
  │           └─ Layer 2: Anthropic SDK call (async) → replace Layer 1 on resolve
  │
  └─ For each enabled widget (in layout order):
        widget.render(data[widget.dataSource], containerEl)
```

---

## 7. File Changes Summary

| File | Change |
|---|---|
| `renderer/widgets/` | New directory — one file per widget |
| `renderer/widgets/index.js` | Widget registry |
| `renderer/widgets/synthesis.js` | Synthesis bar widget (new) |
| `renderer/widgets/velocity.js` | Velocity chart widget (new) |
| `renderer/widgets/state.js` | Extracted from index.html |
| `renderer/widgets/outcomes.js` | Extracted from index.html |
| `renderer/widgets/targets.js` | Extracted from index.html |
| `renderer/widgets/metrics.js` | Extracted from index.html |
| `renderer/widgets/pipeline.js` | Extracted from index.html |
| `renderer/widgets/followups.js` | Extracted from index.html |
| `renderer/index.html` | Refactored to thin orchestrator |
| `src/ipc-channels.js` | Add `GET_VELOCITY`, `GET_SYNTHESIS` |
| `src/vault-reader.js` | Add `parseExecutionLog()`, `parseSystemMetrics()` for synthesis |
| `src/synthesizer.js` | New — Anthropic SDK call + prompt builder |
| `main.js` | Add IPC handlers for `GET_VELOCITY`, `GET_SYNTHESIS` |
| `preload.js` | Expose `getVelocity`, `getSynthesis` on `window.ace.dash` |
| `package.json` | Add `@anthropic-ai/sdk`, `chart.js`, `sortablejs` |

---

## 8. Out of Scope (v1)

- Widget resize / column control (v2)
- Per-widget refresh intervals (v2)
- Custom widget creation by end users (v3)
- Markdown editing in vault (separate feature track)
- Obsidian replacement (separate feature track)
