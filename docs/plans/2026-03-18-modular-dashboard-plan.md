# Modular Dashboard Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Refactor the ACE Desktop home view into a modular widget system with a live AI synthesis bar at the top, user-configurable layout (toggle + reorder), and a new 14-day velocity chart widget.

**Architecture:** Each widget is a self-contained ES module in `renderer/widgets/`. A thin orchestrator (`renderer/dashboard.js`) reads layout config from `ace-config.json`, fetches only the data sources needed by enabled widgets, and renders them in order. The synthesis bar (always first) renders structural health instantly, then replaces itself with a Claude AI brief when the async API call resolves.

**Tech Stack:** Electron 28 (CommonJS main, ES modules in renderer), Anthropic SDK (`@anthropic-ai/sdk`) in main process, Chart.js UMD for velocity widget, SortableJS for drag-to-reorder settings, existing `better-sqlite3` + vault markdown parsers.

**Design doc:** `docs/plans/2026-03-18-modular-dashboard-design.md`

---

## Phase 1: Backend Infrastructure

### Task 1: Install dependencies

**Files:**
- Modify: `package.json`

**Step 1: Install packages**

```bash
cd /Users/nikhilkale/Documents/ace-os/ace-desktop
npm install @anthropic-ai/sdk
```

**Step 2: Copy static lib files to renderer**

```bash
mkdir -p renderer/lib
cp node_modules/chart.js/dist/chart.umd.js renderer/lib/chart.umd.js
cp node_modules/sortablejs/Sortable.min.js renderer/lib/Sortable.min.js
```

**Step 3: Install sortablejs and chart.js**

```bash
npm install chart.js sortablejs
```

**Step 4: Verify**

```bash
ls renderer/lib/
# Expected: chart.umd.js  Sortable.min.js
node -e "require('@anthropic-ai/sdk'); console.log('SDK ok')"
```

**Step 5: Commit**

```bash
git add package.json package-lock.json renderer/lib/
git commit -m "feat(dashboard): install Anthropic SDK, Chart.js, SortableJS"
```

---

### Task 2: Add new IPC channels

**Files:**
- Modify: `src/ipc-channels.js`

**Step 1: Add channels**

Add to the bottom of `src/ipc-channels.js` before the closing `}`:

```js
  // Dashboard: new channels
  GET_VELOCITY:           'get-velocity',
  GET_SYNTHESIS_STRUCT:   'get-synthesis-structural',
  GET_SYNTHESIS_AI:       'get-synthesis-ai',
  SAVE_LAYOUT:            'save-layout',
  GET_LAYOUT:             'get-layout',
```

**Step 2: Verify no typos**

```bash
node -e "const ch = require('./src/ipc-channels'); console.log(Object.keys(ch).length, 'channels')"
# Expected: prints a number > 15, no errors
```

**Step 3: Commit**

```bash
git add src/ipc-channels.js
git commit -m "feat(dashboard): add velocity, synthesis, layout IPC channels"
```

---

### Task 3: Add parseExecutionLog to vault-reader.js

**Files:**
- Modify: `src/vault-reader.js`

**Step 1: Add function before `module.exports`**

```js
// ─── Execution Log Parser (velocity) ─────────────────────────────────────────

function parseExecutionLog(vaultPath, days = 14) {
  try {
    const text = fs.readFileSync(
      path.join(vaultPath, '00-System', 'execution-log.md'), 'utf8'
    )
    const today = new Date()
    today.setHours(0, 0, 0, 0)
    const byDay = {}

    // Build date keys for last N days
    for (let i = 0; i < days; i++) {
      const d = new Date(today)
      d.setDate(d.getDate() - i)
      byDay[d.toISOString().slice(0, 10)] = 0
    }

    // Count log entries per date — entries start with "- " under a date heading
    // Date headings: "## 2026-03-17" or "### 2026-03-17"
    let currentDate = null
    for (const line of text.split('\n')) {
      const headingMatch = line.match(/^#{1,3}\s+(\d{4}-\d{2}-\d{2})/)
      if (headingMatch) {
        currentDate = headingMatch[1]
        continue
      }
      if (currentDate && byDay[currentDate] !== undefined && /^\s*-\s+\S/.test(line)) {
        byDay[currentDate]++
      }
    }

    const values = Object.values(byDay)
    const midpoint = Math.ceil(values.length / 2)
    const totalThisWeek = values.slice(midpoint).reduce((a, b) => a + b, 0)
    const totalLastWeek = values.slice(0, midpoint).reduce((a, b) => a + b, 0)

    return { byDay, totalThisWeek, totalLastWeek }
  } catch (e) {
    return { byDay: {}, totalThisWeek: 0, totalLastWeek: 0, error: e.message }
  }
}
```

**Step 2: Update module.exports**

```js
module.exports = { parseState, parseFollowUps, listDir, parseExecutionLog }
```

**Step 3: Quick smoke test**

```bash
node -e "
const vr = require('./src/vault-reader');
const r = vr.parseExecutionLog('/Users/nikhilkale/Documents/Actualize');
console.log('thisWeek:', r.totalThisWeek, 'lastWeek:', r.totalLastWeek);
console.log('days:', Object.keys(r.byDay).length);
"
# Expected: numbers, 14 days, no error
```

**Step 4: Commit**

```bash
git add src/vault-reader.js
git commit -m "feat(dashboard): add parseExecutionLog for 14-day velocity"
```

---

### Task 4: Create src/synthesizer.js

**Files:**
- Create: `src/synthesizer.js`

This module provides both the structural (rule-based) summary and the AI synthesis call.

**Step 1: Create the file**

```js
// src/synthesizer.js
// Provides structural health summary (instant) and AI synthesis (async via Anthropic SDK)

const Anthropic = require('@anthropic-ai/sdk')
const fs        = require('fs')
const path      = require('path')

// ─── Structural synthesis (rule-based, instant) ───────────────────────────────

function buildStructural(context) {
  const { coherenceScore, signals, overdueFu, daysSinceExecution, mode, energy, outcomes } = context

  // Coherence label
  const label =
    coherenceScore >= 15 ? 'COHERENT' :
    coherenceScore >= 11 ? 'STABLE'   :
    coherenceScore >= 7  ? 'DRIFTING' :
    coherenceScore >= 4  ? 'FRAGMENTED' : 'CRITICAL'

  const parts = [`Coherence ${coherenceScore}/18 — ${label}.`]

  // Top flagged signals
  const signalKeys = ['A1','A2','A3','C1','C2','C3','E1','E2','E3']
  const red    = signals.map((c, i) => c === 'red'    ? signalKeys[i] : null).filter(Boolean)
  const yellow = signals.map((c, i) => c === 'yellow' ? signalKeys[i] : null).filter(Boolean)

  if (red.length)    parts.push(`${red.join(', ')} RED.`)
  if (yellow.length) parts.push(`${yellow.slice(0, 2).join(', ')} YELLOW.`)

  // Overdue follow-ups
  if (overdueFu > 0) parts.push(`${overdueFu} overdue follow-up${overdueFu > 1 ? 's' : ''}.`)

  // Cadence gap
  if (daysSinceExecution >= 2) parts.push(`${daysSinceExecution}d execution gap.`)

  return parts.join(' ')
}

// ─── Parse system-metrics.md for signal details ───────────────────────────────

function parseSignalDetails(vaultPath) {
  try {
    const text = fs.readFileSync(
      path.join(vaultPath, '00-System', 'system-metrics.md'), 'utf8'
    )
    // Look for signal_details line: signal_details: green,green,yellow,...
    const m = text.match(/signal_details:\s*([^\n]+)/)
    if (!m) return Array(9).fill('dim')
    return m[1].split(',').map(s => s.trim().toLowerCase()).slice(0, 9)
  } catch {
    return Array(9).fill('dim')
  }
}

// ─── Build context object from all vault/db data ──────────────────────────────

function buildContext(vaultPath, state, metrics, followUps, velocity, pipeline) {
  const signals = parseSignalDetails(vaultPath)
  const scoreMap = { green: 2, yellow: 1, red: 0, dim: 0 }
  const coherenceScore = signals.reduce((sum, c) => sum + (scoreMap[c] || 0), 0)

  // Days since last execution entry
  const today = new Date().toISOString().slice(0, 10)
  const byDay = velocity?.byDay || {}
  let daysSinceExecution = 0
  for (let i = 0; i < 14; i++) {
    const d = new Date()
    d.setDate(d.getDate() - i)
    const key = d.toISOString().slice(0, 10)
    if (byDay[key] > 0) break
    daysSinceExecution = i + 1
  }

  // Overdue follow-ups count
  const fuArr = Array.isArray(followUps) ? followUps : []
  const todayDate = new Date(); todayDate.setHours(0,0,0,0)
  const overdueFu = fuArr.filter(fu => {
    if (!fu.due) return false
    const d = new Date(fu.due); d.setHours(0,0,0,0)
    return d < todayDate && (fu.status || '').toLowerCase() !== 'done'
  }).length

  return {
    coherenceScore,
    signals,
    mode:    state?.mode    || '',
    energy:  state?.energy  || '',
    outcomes: (state?.outcomes || []).map(o => ({ title: o.title, status: o.status })),
    targets: { done: (state?.weeklyTargets || []).filter(t => t.checked).length, total: (state?.weeklyTargets || []).length },
    pipeline: { count: (pipeline || []).length, value: (pipeline || []).reduce((s, d) => s + (d.amount || 0), 0) },
    velocity: { thisWeek: velocity?.totalThisWeek || 0, lastWeek: velocity?.totalLastWeek || 0 },
    overdueFu,
    daysSinceExecution,
  }
}

// ─── AI synthesis (Anthropic SDK) ────────────────────────────────────────────

async function getAISynthesis(context, voicePath) {
  if (!process.env.ANTHROPIC_API_KEY) return null

  let voiceNote = ''
  try {
    const raw = fs.readFileSync(voicePath, 'utf8')
    // Extract first 300 chars of Layer 1 (Core Essence section) for tone reference
    const m = raw.match(/## Layer 1[\s\S]{0,400}/)
    voiceNote = m ? m[0].slice(0, 300) : ''
  } catch {}

  const prompt = `You are the AI layer of the ACE system for the user. Write a 2-3 sentence synthesis of their system state. Speak directly, in second person, no preamble. Match this voice: ${voiceNote}

System state:
- Mode: ${context.mode} | Energy: ${context.energy}
- Coherence: ${context.coherenceScore}/18 (signals: ${context.signals.join(',')})
- Outcomes: ${context.outcomes.map(o => `${o.title} [${o.status}]`).join(', ')}
- Weekly targets: ${context.targets.done}/${context.targets.total} done
- Pipeline: ${context.pipeline.count} deals, $${context.pipeline.value} value
- Velocity: ${context.velocity.thisWeek} actions this week vs ${context.velocity.lastWeek} last week
- Overdue follow-ups: ${context.overdueFu}
- Days since last execution: ${context.daysSinceExecution}

Write the synthesis now:`

  try {
    const client = new Anthropic()
    const msg = await client.messages.create({
      model:      'claude-haiku-4-5-20251001',
      max_tokens: 150,
      messages:   [{ role: 'user', content: prompt }],
    })
    return msg.content[0]?.text?.trim() || null
  } catch (e) {
    console.error('[synthesizer] AI call failed:', e.message)
    return null
  }
}

module.exports = { buildStructural, buildContext, getAISynthesis, parseSignalDetails }
```

**Step 2: Smoke test structural (no API key needed)**

```bash
node -e "
const s = require('./src/synthesizer');
const ctx = { coherenceScore: 13, signals: ['green','green','yellow','green','green','green','green','yellow','green'], mode: 'execute', energy: 'high', outcomes: [], targets: {done:2,total:5}, pipeline:{count:3,value:5000}, velocity:{thisWeek:8,lastWeek:6}, overdueFu:1, daysSinceExecution:0 };
console.log(s.buildStructural(ctx));
"
# Expected: "Coherence 13/18 — STABLE. A3, E2 YELLOW. 1 overdue follow-up."
```

**Step 3: Commit**

```bash
git add src/synthesizer.js
git commit -m "feat(dashboard): add synthesizer — structural + Anthropic AI brief"
```

---

### Task 5: Wire new IPC handlers in main.js and preload.js

**Files:**
- Modify: `main.js`
- Modify: `preload.js`

**Step 1: Add to main.js — after existing Dashboard IPC section**

Find the comment `// ─── Dashboard IPC Handlers ─────` and add after existing handlers:

```js
ipcMain.handle(ch.GET_VELOCITY, () => {
  try { return require('./src/vault-reader').parseExecutionLog(global.VAULT_PATH, 14) }
  catch (e) { return { byDay: {}, totalThisWeek: 0, totalLastWeek: 0, error: e.message } }
})

ipcMain.handle(ch.GET_SYNTHESIS_STRUCT, (_, context) => {
  try { return require('./src/synthesizer').buildStructural(context) }
  catch (e) { return '' }
})

ipcMain.handle(ch.GET_SYNTHESIS_AI, async (_, context) => {
  const voicePath = require('path').join(global.VAULT_PATH, '00-System', 'core', 'voice-profile.md')
  try { return await require('./src/synthesizer').getAISynthesis(context, voicePath) }
  catch (e) { return null }
})

ipcMain.handle(ch.GET_LAYOUT, () => {
  const config = loadConfig()
  return config?.layout || null
})

ipcMain.handle(ch.SAVE_LAYOUT, (_, layout) => {
  const config = loadConfig() || {}
  config.layout = layout
  saveConfig(config)
  return true
})
```

**Step 2: Add to preload.js — inside `window.ace.dash` object**

Add after the existing `onPipelineUpdate` line:

```js
    getVelocity:          ()        => ipcRenderer.invoke(ch.GET_VELOCITY),
    getSynthesisStruct:   (context) => ipcRenderer.invoke(ch.GET_SYNTHESIS_STRUCT, context),
    getSynthesisAI:       (context) => ipcRenderer.invoke(ch.GET_SYNTHESIS_AI, context),
    getLayout:            ()        => ipcRenderer.invoke(ch.GET_LAYOUT),
    saveLayout:           (layout)  => ipcRenderer.invoke(ch.SAVE_LAYOUT, layout),
```

**Step 3: Verify app still starts**

```bash
cd /Users/nikhilkale/Documents/ace-os/ace-desktop && npm start
# Expected: app opens, home dashboard loads, no console errors from new handlers
```

**Step 4: Commit**

```bash
git add main.js preload.js
git commit -m "feat(dashboard): wire velocity, synthesis, layout IPC handlers"
```

---

## Phase 2: Widget Extraction

### Task 6: Scaffold widget directory and registry

**Files:**
- Create: `renderer/widgets/` (directory)
- Create: `renderer/widgets/registry.js`

**Step 1: Create registry file**

```js
// renderer/widgets/registry.js
// Import order = default layout order.
// Each widget: { id, label, description, dataSource, defaultEnabled, render(data, el) }

import metrics  from './metrics.js'
import state    from './state.js'
import outcomes from './outcomes.js'
import targets  from './targets.js'
import pipeline from './pipeline.js'
import followups from './followups.js'
import velocity from './velocity.js'
import synthesis from './synthesis.js'

export const WIDGETS = [synthesis, metrics, state, outcomes, targets, pipeline, followups, velocity]

export const DEFAULT_LAYOUT = WIDGETS.map(w => ({ id: w.id, enabled: w.defaultEnabled ?? true }))
```

**Step 2: Commit scaffold**

```bash
git add renderer/widgets/
git commit -m "feat(dashboard): scaffold widget registry"
```

---

### Task 7: Extract metrics widget

**Files:**
- Create: `renderer/widgets/metrics.js`

**Step 1: Find the renderStats function in index.html (around line 1280) and copy its logic**

```js
// renderer/widgets/metrics.js
export default {
  id: 'metrics',
  label: 'Stats Strip',
  description: 'Subscribers, MTD revenue, pipeline count, follow-up count',
  dataSource: 'getMetrics',
  defaultEnabled: true,

  render(data, el) {
    if (!data || !data._stats) return
    const s = data._stats

    const fmtMoney = (n) => {
      if (!n) return '—'
      return n >= 1000 ? `$${Math.round(n / 1000)}K` : `$${Math.round(n)}`
    }

    el.innerHTML = `
      <div class="stats-strip">
        <div class="sstat">
          <span class="sv" style="color:var(--blue-grey)">${s.subscribers ? Math.round(s.subscribers).toLocaleString() : '—'}</span>
          <span class="sl">Subscribers</span>
        </div>
        <div class="sstat">
          <span class="sv" style="color:var(--green)">${fmtMoney(s.mtdRevenue)}</span>
          <span class="sl">Revenue MTD</span>
        </div>
        <div class="sstat">
          <span class="sv" style="color:var(--gold)">${data._pipeline ? fmtMoney(data._pipeline.value) : '—'}</span>
          <span class="sl">Pipeline</span>
        </div>
        <div class="sstat">
          <span class="sv" style="color:var(--text-secondary)">${data._fuCount ?? '—'}</span>
          <span class="sl">Follow-ups</span>
        </div>
      </div>`
  }
}
```

**Step 2: Commit**

```bash
git add renderer/widgets/metrics.js
git commit -m "feat(dashboard): extract metrics widget"
```

---

### Task 8: Extract state widget

**Files:**
- Create: `renderer/widgets/state.js`

**Step 1: Create file**

```js
// renderer/widgets/state.js
export default {
  id: 'state',
  label: 'Mode & Energy',
  description: 'Current operating mode and energy level',
  dataSource: 'getState',
  defaultEnabled: true,

  render(data, el) {
    if (!data || data.error) return
    let html = ''
    if (data.mode) {
      const mode = data.mode.toLowerCase()
      html += `<span class="status-tag ${mode}">${mode}</span>`
    }
    if (data.energy) {
      html += `<span class="status-tag energy">${data.energy}</span>`
    }
    el.innerHTML = html
  }
}
```

**Step 2: Commit**

```bash
git add renderer/widgets/state.js
git commit -m "feat(dashboard): extract state widget"
```

---

### Task 9: Extract outcomes widget

**Files:**
- Create: `renderer/widgets/outcomes.js`

**Step 1: Find renderOutcomes in index.html (around line 1158) and port it**

```js
// renderer/widgets/outcomes.js
export default {
  id: 'outcomes',
  label: 'Outcomes',
  description: 'Active outcomes with gate countdowns and status',
  dataSource: 'getState',
  defaultEnabled: true,

  render(data, el) {
    if (!data?.outcomes?.length) { el.innerHTML = '<div style="font-size:10px;color:var(--text-dim);padding:8px 0">No outcomes found.</div>'; return }

    el.innerHTML = `
      <div class="section-label">Outcomes</div>
      <div class="outcomes-grid">${data.outcomes.map(o => {
        const statusColor = { 'ON TRACK':'green','AT RISK':'gold','BLOCKED':'red','COMPLETE':'green','IN PROGRESS':'blue-grey' }[o.status] || 'dim'
        const daysColor   = o.daysToGate == null ? 'dim' : o.daysToGate < 0 ? 'red' : o.daysToGate <= 7 ? 'gold' : 'blue-grey'
        const daysLabel   = o.daysToGate == null ? '' : o.daysToGate < 0 ? `${Math.abs(o.daysToGate)}d overdue` : o.daysToGate === 0 ? 'today' : `${o.daysToGate}d`
        return `
          <div class="oc-card">
            <div class="oc-title">${o.title}</div>
            <div class="oc-meta">
              ${o.status ? `<span class="oc-badge ${statusColor}">${o.status}</span>` : ''}
              ${daysLabel ? `<span class="oc-days" style="color:var(--${daysColor})">${daysLabel}</span>` : ''}
              ${o.gateLabel ? `<span class="oc-gate">${o.gateLabel}</span>` : ''}
            </div>
          </div>`
      }).join('')}</div>`
  }
}
```

**Step 2: Commit**

```bash
git add renderer/widgets/outcomes.js
git commit -m "feat(dashboard): extract outcomes widget"
```

---

### Task 10: Extract targets widget

**Files:**
- Create: `renderer/widgets/targets.js`

**Step 1: Create file**

```js
// renderer/widgets/targets.js
export default {
  id: 'targets',
  label: 'This Week',
  description: 'Weekly targets from active.md',
  dataSource: 'getState',
  defaultEnabled: true,

  render(data, el) {
    const targets = data?.weeklyTargets || []
    if (!targets.length) { el.innerHTML = '<div style="font-size:10px;color:var(--text-dim)">No targets set.</div>'; return }

    const sorted = [...targets.filter(t => !t.checked), ...targets.filter(t => t.checked)]
    el.innerHTML = `
      <div class="section-label">This Week</div>
      <div id="target-list">${sorted.map(t => `
        <div class="target-row">
          <span class="target-check${t.checked ? ' done' : ''}"></span>
          <span class="target-text${t.checked ? ' done' : ''}">${t.text}</span>
        </div>`).join('')}
      </div>`
  }
}
```

**Step 2: Commit**

```bash
git add renderer/widgets/targets.js
git commit -m "feat(dashboard): extract targets widget"
```

---

### Task 11: Extract pipeline widget

**Files:**
- Create: `renderer/widgets/pipeline.js`

**Step 1: Create file**

```js
// renderer/widgets/pipeline.js
export default {
  id: 'pipeline',
  label: 'Pipeline',
  description: 'Active deals by stage from ace.db',
  dataSource: 'getPipeline',
  defaultEnabled: true,

  render(data, el) {
    const deals = Array.isArray(data) ? data : []
    const total = deals.reduce((s, d) => s + (d.amount || 0), 0)
    const fmtMoney = n => n >= 1000 ? `$${Math.round(n/1000)}K` : `$${Math.round(n)}`
    const today = new Date(); today.setHours(0,0,0,0)

    el.innerHTML = `
      <div class="section-label">Pipeline <span style="color:var(--text-dim);font-weight:400">${deals.length} deals · ${fmtMoney(total)}</span></div>
      <div id="pipeline-list">${!deals.length
        ? '<div class="fu-empty">No active deals.</div>'
        : deals.map(d => {
            const due = d.due_date ? new Date(d.due_date) : null
            due && due.setHours(0,0,0,0)
            const overdue = due && due < today
            return `
              <div class="fu-row">
                <span class="deal-stage-dot ${d.stage || 'lead'}"></span>
                <span class="fu-person">${d.person}</span>
                <span class="fu-topic" style="flex:1">${d.next_action || d.product || ''}</span>
                ${d.amount ? `<span class="fu-due">${fmtMoney(d.amount)}</span>` : ''}
                ${due ? `<span class="fu-due${overdue ? ' overdue' : ''}">${overdue ? '⚠ ' : ''}${due.toLocaleDateString('en-US',{month:'numeric',day:'numeric'})}</span>` : ''}
              </div>`}).join('')}
      </div>`
  }
}
```

**Step 2: Commit**

```bash
git add renderer/widgets/pipeline.js
git commit -m "feat(dashboard): extract pipeline widget"
```

---

### Task 12: Extract followups widget

**Files:**
- Create: `renderer/widgets/followups.js`

**Step 1: Create file**

```js
// renderer/widgets/followups.js
export default {
  id: 'followups',
  label: 'Follow-ups',
  description: 'Active follow-ups from follow-ups.md',
  dataSource: 'getFollowUps',
  defaultEnabled: true,

  render(data, el) {
    const items = Array.isArray(data) ? data : []
    const today = new Date(); today.setHours(0,0,0,0)

    const parse = s => { const d = new Date(s); d.setHours(0,0,0,0); return d }
    const overdue  = items.filter(f => f.due && parse(f.due) < today  && (f.status||'').toLowerCase() !== 'done')
    const upcoming = items.filter(f => !f.due || parse(f.due) >= today && (f.status||'').toLowerCase() !== 'done')

    const renderRows = arr => arr.slice(0, 5).map(f => {
      const d = f.due ? parse(f.due) : null
      return `<div class="fu-row">
        <span class="fu-person">${f.person}</span>
        <span class="fu-topic" style="flex:1">${f.topic || ''}</span>
        ${d ? `<span class="fu-due">${d.toLocaleDateString('en-US',{month:'numeric',day:'numeric'})}</span>` : ''}
      </div>`
    }).join('')

    el.innerHTML = `
      <div class="section-label">Follow-ups <span style="color:var(--text-dim);font-weight:400">${items.length} open${overdue.length ? ` · <span style="color:var(--red)">${overdue.length} overdue</span>` : ''}</span></div>
      <div id="followup-list">
        ${overdue.length ? `<div class="fu-section-label overdue">Overdue</div>${renderRows(overdue)}` : ''}
        ${upcoming.length ? renderRows(upcoming) : ''}
        ${!items.length ? '<div class="fu-empty">All clear.</div>' : ''}
      </div>`
  }
}
```

**Step 2: Commit**

```bash
git add renderer/widgets/followups.js
git commit -m "feat(dashboard): extract followups widget"
```

---

## Phase 3: New Widgets

### Task 13: Create velocity widget

**Files:**
- Create: `renderer/widgets/velocity.js`

**Step 1: Create file**

```js
// renderer/widgets/velocity.js
// Requires: renderer/lib/chart.umd.js loaded in index.html before this module
export default {
  id: 'velocity',
  label: '14-Day Velocity',
  description: 'Shipping cadence from execution-log.md',
  dataSource: 'getVelocity',
  defaultEnabled: true,

  _chartInstance: null,

  render(data, el) {
    if (!data || data.error) return
    const { byDay, totalThisWeek, totalLastWeek } = data
    const delta = totalLastWeek > 0 ? Math.round((totalThisWeek - totalLastWeek) / totalLastWeek * 100) : null

    // Build ordered 14-day series
    const today = new Date()
    const series = []
    for (let i = 13; i >= 0; i--) {
      const d = new Date(today); d.setDate(d.getDate() - i)
      const key = d.toISOString().slice(0, 10)
      series.push({ label: key.slice(5), value: byDay[key] || 0 })
    }

    el.innerHTML = `
      <div class="section-label">14-Day Velocity
        <span style="color:var(--text-dim);font-weight:400">
          ${totalThisWeek} this week
          ${delta !== null ? `<span style="color:${delta >= 0 ? 'var(--green)' : 'var(--red)'}">(${delta >= 0 ? '+' : ''}${delta}%)</span>` : ''}
        </span>
      </div>
      <div style="height:120px;padding:8px 0">
        <canvas id="velocity-chart"></canvas>
      </div>`

    const ctx = el.querySelector('#velocity-chart')
    if (!ctx || typeof Chart === 'undefined') return

    if (this._chartInstance) this._chartInstance.destroy()
    this._chartInstance = new Chart(ctx, {
      type: 'bar',
      data: {
        labels: series.map(s => s.label),
        datasets: [{
          data: series.map(s => s.value),
          backgroundColor: 'rgba(212,165,116,0.4)',
          borderColor: '#d4a574',
          borderWidth: 1,
          borderRadius: 2,
        }]
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        plugins: { legend: { display: false }, tooltip: { callbacks: { label: ctx => `${ctx.parsed.y} actions` } } },
        scales: {
          x: { ticks: { color: '#5a5248', font: { size: 9 } }, grid: { display: false } },
          y: { ticks: { color: '#5a5248', font: { size: 9 }, stepSize: 1 }, grid: { color: 'rgba(212,165,116,0.05)' }, beginAtZero: true }
        }
      }
    })
  }
}
```

**Step 2: Commit**

```bash
git add renderer/widgets/velocity.js
git commit -m "feat(dashboard): add velocity widget with 14-day Chart.js bar chart"
```

---

### Task 14: Create synthesis widget

**Files:**
- Create: `renderer/widgets/synthesis.js`

**Step 1: Create file**

```js
// renderer/widgets/synthesis.js
// Special widget: always first, receives all data, renders structural instantly then replaces with AI.
export default {
  id: 'synthesis',
  label: 'System Intelligence',
  description: 'Live AI synthesis of your system state',
  dataSource: null,   // receives all data — handled specially by orchestrator
  defaultEnabled: true,

  render(allData, el) {
    // allData: { state, metrics, pipeline, followUps, velocity }
    // Step 1: build context and get structural summary immediately
    const context = this._buildContext(allData)
    const structural = this._buildStructural(context)

    el.innerHTML = `
      <div class="synthesis-bar" id="synthesis-bar">
        <div class="synthesis-icon">◎</div>
        <div class="synthesis-text" id="synthesis-text">${structural}</div>
      </div>`

    // Step 2: fire AI call async — replace when it arrives
    window.ace.dash.getSynthesisAI(context).then(ai => {
      if (!ai) return
      const textEl = document.getElementById('synthesis-text')
      if (!textEl) return
      textEl.style.opacity = '0'
      textEl.style.transition = 'opacity 0.4s'
      setTimeout(() => {
        textEl.textContent = ai
        textEl.style.opacity = '1'
      }, 400)
    })
  },

  _buildContext(allData) {
    const { state, metrics, pipeline, followUps, velocity } = allData
    const signals = metrics?._signals || Array(9).fill('dim')
    const scoreMap = { green: 2, yellow: 1, red: 0, dim: 0 }
    const coherenceScore = signals.reduce((sum, c) => sum + (scoreMap[c] || 0), 0)

    const today = new Date(); today.setHours(0,0,0,0)
    const byDay = velocity?.byDay || {}
    let daysSinceExecution = 0
    for (let i = 0; i < 14; i++) {
      const d = new Date(); d.setDate(d.getDate() - i)
      const key = d.toISOString().slice(0, 10)
      if ((byDay[key] || 0) > 0) break
      daysSinceExecution = i + 1
    }

    const fuArr = Array.isArray(followUps) ? followUps : []
    const overdueFu = fuArr.filter(f => {
      if (!f.due) return false
      const d = new Date(f.due); d.setHours(0,0,0,0)
      return d < today && (f.status||'').toLowerCase() !== 'done'
    }).length

    return {
      coherenceScore,
      signals,
      mode:    state?.mode    || '',
      energy:  state?.energy  || '',
      outcomes: (state?.outcomes || []).map(o => ({ title: o.title, status: o.status })),
      targets: { done: (state?.weeklyTargets||[]).filter(t=>t.checked).length, total: (state?.weeklyTargets||[]).length },
      pipeline: { count: (pipeline||[]).length, value: (pipeline||[]).reduce((s,d)=>s+(d.amount||0),0) },
      velocity: { thisWeek: velocity?.totalThisWeek||0, lastWeek: velocity?.totalLastWeek||0 },
      overdueFu,
      daysSinceExecution,
    }
  },

  _buildStructural(ctx) {
    const label =
      ctx.coherenceScore >= 15 ? 'COHERENT'   :
      ctx.coherenceScore >= 11 ? 'STABLE'      :
      ctx.coherenceScore >= 7  ? 'DRIFTING'    :
      ctx.coherenceScore >= 4  ? 'FRAGMENTED'  : 'CRITICAL'

    const keys = ['A1','A2','A3','C1','C2','C3','E1','E2','E3']
    const red    = ctx.signals.map((c,i) => c==='red'    ? keys[i] : null).filter(Boolean)
    const yellow = ctx.signals.map((c,i) => c==='yellow' ? keys[i] : null).filter(Boolean)
    const parts  = [`Coherence ${ctx.coherenceScore}/18 — ${label}.`]
    if (red.length)            parts.push(`${red.join(', ')} RED.`)
    if (yellow.length)         parts.push(`${yellow.slice(0,2).join(', ')} YELLOW.`)
    if (ctx.overdueFu > 0)     parts.push(`${ctx.overdueFu} overdue follow-up${ctx.overdueFu>1?'s':''}.`)
    if (ctx.daysSinceExecution >= 2) parts.push(`${ctx.daysSinceExecution}d execution gap.`)
    return parts.join(' ')
  }
}
```

**Step 2: Add synthesis bar CSS to index.html `<style>` block**

Find the `<style>` block in `renderer/index.html` and add:

```css
/* ─── Synthesis Bar ─────────────────────────────── */
.synthesis-bar {
  display: flex;
  align-items: flex-start;
  gap: 12px;
  padding: 14px 16px;
  margin-bottom: 16px;
  background: var(--bg-elevated);
  border: 1px solid var(--border);
  border-radius: 8px;
}
.synthesis-icon {
  color: var(--gold);
  font-size: 16px;
  margin-top: 1px;
  flex-shrink: 0;
}
.synthesis-text {
  font-size: 13px;
  color: var(--text-secondary);
  line-height: 1.6;
  transition: opacity 0.4s;
}
```

**Step 3: Commit**

```bash
git add renderer/widgets/synthesis.js renderer/index.html
git commit -m "feat(dashboard): add synthesis widget — structural + async AI brief"
```

---

## Phase 4: Orchestrator Refactor

### Task 15: Create renderer/dashboard.js orchestrator

**Files:**
- Create: `renderer/dashboard.js`

**Step 1: Create file**

```js
// renderer/dashboard.js
// Orchestrates widget rendering based on layout config from ace-config.json.
import { WIDGETS, DEFAULT_LAYOUT } from './widgets/registry.js'

async function getLayout() {
  const saved = await window.ace.dash.getLayout()
  if (!saved) {
    await window.ace.dash.saveLayout(DEFAULT_LAYOUT)
    return DEFAULT_LAYOUT
  }
  // Merge: keep saved order/enabled, add any new widgets from registry
  const savedIds = new Set(saved.map(w => w.id))
  const merged = [...saved]
  for (const w of WIDGETS) {
    if (!savedIds.has(w.id)) merged.push({ id: w.id, enabled: w.defaultEnabled ?? true })
  }
  return merged
}

async function loadDashboard() {
  const layout = await getLayout()
  const enabledIds = layout.filter(l => l.enabled).map(l => l.id)

  // Collect unique data sources needed
  const neededSources = new Set()
  for (const id of enabledIds) {
    const w = WIDGETS.find(w => w.id === id)
    if (w?.dataSource) neededSources.add(w.dataSource)
  }

  // Always fetch all base sources for synthesis context
  const sourceMap = {
    getState:    () => window.ace.dash.getState(),
    getPipeline: () => window.ace.dash.getPipeline(),
    getFollowUps:() => window.ace.dash.getFollowUps(),
    getMetrics:  () => window.ace.dash.getMetrics(),
    getVelocity: () => window.ace.dash.getVelocity(),
  }

  // Fetch needed sources in parallel
  const fetchList = [...neededSources].filter(s => sourceMap[s])
  const fetchResults = await Promise.all(fetchList.map(s => sourceMap[s]()))
  const data = {}
  fetchList.forEach((s, i) => { data[s] = fetchResults[i] })

  // Also fetch velocity for synthesis even if widget disabled
  if (!data.getVelocity) data.getVelocity = await window.ace.dash.getVelocity()

  const allData = {
    state:     data.getState,
    metrics:   data.getMetrics,
    pipeline:  data.getPipeline,
    followUps: data.getFollowUps,
    velocity:  data.getVelocity,
  }

  // Render each enabled widget into its container
  for (const id of enabledIds) {
    const widget = WIDGETS.find(w => w.id === id)
    const container = document.getElementById(`widget-${id}`)
    if (!widget || !container) continue

    const widgetData = widget.id === 'synthesis'
      ? allData
      : data[widget.dataSource]

    widget.render(widgetData, container)
  }
}

export { loadDashboard, getLayout }
```

**Step 2: Commit**

```bash
git add renderer/dashboard.js
git commit -m "feat(dashboard): add orchestrator — layout-driven parallel fetch + render"
```

---

### Task 16: Refactor index.html home view

**Files:**
- Modify: `renderer/index.html`

This is the most surgical task. The goal is to replace the home view body with widget containers, load Chart.js before the module script, and replace the inline script with the module orchestrator.

**Step 1: In `<head>`, add Chart.js before the closing `</head>`**

```html
<script src="../renderer/lib/chart.umd.js"></script>
```

**Step 2: Replace the `.vbody` content inside `id="view-home"` with widget containers**

Find:
```html
<div class="vbody">
  <!-- Greeting -->
  ...
  (everything up to and including the two-column layout closing </div>)
</div>
```

Replace with:

```html
<div class="vbody">
  <div class="home-time" id="home-time"></div>
  <div class="home-name" id="home-name">Good morning.</div>

  <!-- Widget containers — rendered in layout order by dashboard.js -->
  <div id="widget-synthesis"></div>
  <div id="widget-state"></div>
  <div id="widget-metrics"></div>

  <div class="home-cols">
    <div class="home-left">
      <div id="widget-outcomes"></div>
      <div class="section-label">Commands</div>
      <div class="quick-cmds">
        <div class="qcmd" data-cmd="/start"><div class="qcmd-icon">☀</div><div class="qcmd-label">/start</div></div>
        <div class="qcmd" data-cmd="/brief"><div class="qcmd-icon">⚡</div><div class="qcmd-label">/brief</div></div>
        <div class="qcmd" data-cmd="/pulse"><div class="qcmd-icon">◎</div><div class="qcmd-label">/pulse</div></div>
        <div class="qcmd" data-cmd="/eod"><div class="qcmd-icon">◐</div><div class="qcmd-label">/eod</div></div>
      </div>
    </div>
    <div class="home-right">
      <div id="widget-targets"></div>
      <div id="widget-followups"></div>
      <div id="widget-pipeline"></div>
    </div>
  </div>

  <div id="widget-velocity" style="margin-top:16px"></div>
</div>
```

**Step 3: Replace the inline `<script>` dashboard functions with the module import**

Find the bottom of index.html where `loadDashboard()` and all `render*` functions live (the large inline script). Remove everything from `async function loadDashboard()` through `window.ace.dash.onPipelineUpdate(...)`.

Replace with:

```html
<script type="module">
  import { loadDashboard } from '../renderer/dashboard.js'

  // Greeting
  const greet = () => {
    const h = new Date().getHours()
    const g = h < 12 ? 'Good morning' : h < 17 ? 'Good afternoon' : 'Good evening'
    document.getElementById('home-name').textContent = `${g}.`
    document.getElementById('home-time').textContent = new Date().toLocaleTimeString('en-US', { hour:'2-digit', minute:'2-digit' })
  }
  greet()
  setInterval(greet, 60000)

  loadDashboard()

  document.getElementById('refresh-btn')?.addEventListener('click', () => loadDashboard())

  // Live updates
  window.ace.dash.onStateUpdate?.(()    => loadDashboard())
  window.ace.dash.onFollowUpsUpdate?.(() => loadDashboard())
  window.ace.dash.onPipelineUpdate?.(()  => loadDashboard())
</script>
```

**Step 4: Test the app loads without errors**

```bash
npm start
# Expected: home dashboard renders, synthesis bar visible at top, all widgets present
```

**Step 5: Commit**

```bash
git add renderer/index.html
git commit -m "feat(dashboard): refactor home view to widget containers + module orchestrator"
```

---

## Phase 5: Settings Panel

### Task 17: Add settings view with layout toggle and reorder

**Files:**
- Modify: `renderer/index.html`

**Step 1: Add settings nav item to sidebar**

Find the sidebar nav items and add:

```html
<div class="nav-item" data-view="settings" title="Settings">
  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5">
    <circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83-2.83l.06-.06A1.65 1.65 0 0 0 4.68 15a1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 2.83-2.83l.06.06A1.65 1.65 0 0 0 9 4.68a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 2.83l-.06.06A1.65 1.65 0 0 0 19.4 9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z"/>
  </svg>
</div>
```

**Step 2: Add settings view HTML before closing `</main>`**

```html
<!-- SETTINGS VIEW -->
<div class="view" id="view-settings">
  <div class="view-header">
    <div class="view-title">Dashboard Layout</div>
  </div>
  <div class="vbody">
    <div style="font-size:11px;color:var(--text-dim);margin-bottom:16px">Drag to reorder. Toggle to show/hide. Changes apply immediately.</div>
    <div id="layout-list"></div>
  </div>
</div>
```

**Step 3: Add settings CSS to `<style>` block**

```css
/* ─── Settings / Layout ─────────────────────────── */
.layout-row {
  display: flex;
  align-items: center;
  gap: 12px;
  padding: 10px 12px;
  margin-bottom: 6px;
  background: var(--bg-elevated);
  border: 1px solid var(--border);
  border-radius: 6px;
  cursor: grab;
  user-select: none;
}
.layout-row:active { cursor: grabbing; }
.layout-drag { color: var(--text-dim); font-size: 14px; }
.layout-info { flex: 1; }
.layout-label { font-size: 12px; color: var(--text-primary); }
.layout-desc  { font-size: 10px; color: var(--text-dim); margin-top: 2px; }
.layout-toggle {
  width: 32px; height: 18px;
  background: var(--bg-deep);
  border: 1px solid var(--border-hover);
  border-radius: 9px;
  position: relative;
  cursor: pointer;
  transition: background 0.2s;
}
.layout-toggle.on { background: var(--gold-dim); }
.layout-toggle::after {
  content: '';
  position: absolute;
  width: 12px; height: 12px;
  border-radius: 50%;
  background: var(--text-dim);
  top: 2px; left: 2px;
  transition: transform 0.2s, background 0.2s;
}
.layout-toggle.on::after { transform: translateX(14px); background: var(--gold); }
```

**Step 4: Add settings JS as a module script**

```html
<script type="module">
  import { WIDGETS }     from '../renderer/widgets/registry.js'
  import { loadDashboard } from '../renderer/dashboard.js'

  async function renderSettings() {
    const el = document.getElementById('layout-list')
    if (!el) return
    const saved = await window.ace.dash.getLayout() || WIDGETS.map(w => ({ id: w.id, enabled: true }))

    el.innerHTML = saved.map(item => {
      const w = WIDGETS.find(w => w.id === item.id)
      if (!w) return ''
      return `
        <div class="layout-row" data-id="${w.id}">
          <span class="layout-drag">⠿</span>
          <div class="layout-info">
            <div class="layout-label">${w.label}</div>
            <div class="layout-desc">${w.description}</div>
          </div>
          <div class="layout-toggle ${item.enabled ? 'on' : ''}" data-id="${w.id}"></div>
        </div>`
    }).join('')

    // Toggle handler
    el.querySelectorAll('.layout-toggle').forEach(toggle => {
      toggle.addEventListener('click', async e => {
        e.stopPropagation()
        toggle.classList.toggle('on')
        await saveCurrentLayout()
        loadDashboard()
      })
    })

    // SortableJS
    if (typeof Sortable !== 'undefined') {
      Sortable.create(el, {
        animation: 150,
        handle: '.layout-drag',
        onEnd: async () => { await saveCurrentLayout(); loadDashboard() }
      })
    }
  }

  async function saveCurrentLayout() {
    const rows = document.querySelectorAll('#layout-list .layout-row')
    const layout = [...rows].map(row => ({
      id:      row.dataset.id,
      enabled: row.querySelector('.layout-toggle').classList.contains('on'),
    }))
    await window.ace.dash.saveLayout(layout)
  }

  // Load settings when view activates
  document.querySelector('[data-view="settings"]')?.addEventListener('click', renderSettings)
</script>
```

**Step 5: Add Sortable.min.js to index.html `<head>`**

```html
<script src="../renderer/lib/Sortable.min.js"></script>
```

**Step 6: Test settings panel**

```bash
npm start
# Expected:
# - Settings icon in sidebar
# - Clicking it shows widget list
# - Toggle turns gold when on
# - Dragging rows reorders
# - Dashboard re-renders after each change
```

**Step 7: Commit**

```bash
git add renderer/index.html
git commit -m "feat(dashboard): add settings panel — toggle + drag-to-reorder layout"
```

---

## Phase 6: AI Synthesis End-to-End

### Task 18: Verify Anthropic SDK integration

**Files:**
- No new files — verify existing wiring

**Step 1: Check ANTHROPIC_API_KEY is available**

```bash
echo $ANTHROPIC_API_KEY | head -c 20
# Expected: sk-ant-... (first 20 chars)
```

**Step 2: Test synthesis IPC directly**

```bash
node -e "
process.env.ANTHROPIC_API_KEY = process.env.ANTHROPIC_API_KEY || ''
const s = require('./src/synthesizer')
const ctx = {
  coherenceScore: 13,
  signals: ['green','green','yellow','green','green','green','green','yellow','green'],
  mode: 'execute', energy: 'high',
  outcomes: [{title:'ACE Desktop',status:'ON TRACK'}],
  targets: {done:2,total:5},
  pipeline: {count:3,value:5000},
  velocity: {thisWeek:8,lastWeek:6},
  overdueFu:1, daysSinceExecution:0
}
s.getAISynthesis(ctx, '/Users/nikhilkale/Documents/Actualize/00-System/core/voice-profile.md')
  .then(r => console.log('AI result:', r || '(no key or error)'))
  .catch(e => console.error('Error:', e.message))
"
# Expected: 2-3 sentence synthesis or "(no key or error)" if key not set
```

**Step 3: If API key not in env, add to config**

The Anthropic SDK reads `ANTHROPIC_API_KEY` from the environment. Electron inherits the shell environment when launched via `npm start`. If the key is missing:

```bash
# Add to ~/.zshrc
echo 'export ANTHROPIC_API_KEY="your-key-here"' >> ~/.zshrc
source ~/.zshrc
```

Then relaunch:
```bash
npm start
```

**Step 4: Verify in app**

Open the app. The synthesis bar should:
1. Show the structural summary immediately (e.g. "Coherence 13/18 — STABLE. E2 YELLOW.")
2. After ~1-2 seconds, fade and replace with the AI brief

**Step 5: Final commit**

```bash
git add -A
git commit -m "feat(dashboard): modular widget system + AI synthesis bar — complete"
```

---

## Verification Checklist

- [ ] App launches cleanly with no console errors
- [ ] Synthesis bar appears at top of home view
- [ ] Structural summary renders immediately on load
- [ ] AI brief replaces structural summary within ~2 seconds (when API key present)
- [ ] All 7 widgets render (synthesis, metrics, state, outcomes, targets, pipeline, followups, velocity)
- [ ] Velocity chart shows 14 bars with activity data
- [ ] Settings panel accessible via gear icon in sidebar
- [ ] Toggling a widget off removes it from home view
- [ ] Dragging rows in settings reorders widgets on home view
- [ ] Layout persists after app restart (stored in ace-config.json)
- [ ] `npm start` only launches one instance (single-instance lock from earlier task)
