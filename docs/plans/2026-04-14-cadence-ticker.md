# Cadence Ticker Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Add a Cadence Ring widget to the cockpit brain row that shows weekly-review and monthly-reflection freshness, with overdue urgency and click-to-launch.

**Architecture:** Replace the standalone `ritualstreak` widget with a new `cadence` widget that renders both the existing Ritual Streak (top half) and a new Cadence Ticker (bottom half) inside a shared circular container. File-based detection scans journal directories at render time. Click-to-launch reuses the Integrity regen button pattern.

**Tech Stack:** Vanilla JS (ES module), CSS scoped under `.vbody.cockpit`, Electron IPC for vault reads.

---

### Task 1: Add `parseCadence` to vault-reader

**Files:**
- Modify: `ace-desktop/src/vault-reader.js:914-948`

**Step 1: Add the parseCadence function**

Add immediately before the closing `module.exports` line (currently line 949):

```javascript
// Parse cadence freshness — days since last weekly review + monthly reflection
function parseCadence(vaultPath) {
  const now = new Date()
  now.setHours(0, 0, 0, 0)

  // Weekly: scan 01-Journal/weekly-reviews/ for YYYY-WXX.md
  let weeklyDays = null
  let weeklyDate = null
  try {
    const wDir = path.join(vaultPath, '01-Journal', 'weekly-reviews')
    if (fs.existsSync(wDir)) {
      const files = fs.readdirSync(wDir).filter(f => /^\d{4}-W\d{2}\.md$/.test(f)).sort()
      if (files.length) {
        const last = files[files.length - 1]
        const [year, week] = last.replace('.md', '').split('-W').map(Number)
        // ISO week to date: Jan 4 is always in week 1
        const jan4 = new Date(year, 0, 4)
        const dayOfWeek = jan4.getDay() || 7
        const weekStart = new Date(jan4)
        weekStart.setDate(jan4.getDate() - dayOfWeek + 1 + (week - 1) * 7)
        weekStart.setHours(0, 0, 0, 0)
        weeklyDate = weekStart.toISOString().slice(0, 10)
        weeklyDays = Math.floor((now - weekStart) / 86400000)
      }
    }
  } catch (e) { /* silent */ }

  // Monthly: scan 01-Journal/monthly-reviews/ for YYYY-MM.md
  let monthlyDays = null
  let monthlyDate = null
  try {
    const mDir = path.join(vaultPath, '01-Journal', 'monthly-reviews')
    if (fs.existsSync(mDir)) {
      const files = fs.readdirSync(mDir).filter(f => /^\d{4}-\d{2}\.md$/.test(f)).sort()
      if (files.length) {
        const last = files[files.length - 1]
        const [year, month] = last.replace('.md', '').split('-').map(Number)
        // Use last day of that month as the review date
        const reviewDate = new Date(year, month, 0)
        reviewDate.setHours(0, 0, 0, 0)
        monthlyDate = reviewDate.toISOString().slice(0, 10)
        monthlyDays = Math.floor((now - reviewDate) / 86400000)
      }
    }
  } catch (e) { /* silent */ }

  return { weeklyDays, weeklyDate, monthlyDays, monthlyDate }
}
```

**Step 2: Add to module.exports**

Append `parseCadence` to the existing exports object:

```javascript
module.exports = { parseState, parseFollowUps, listDir, parseExecutionLog, parseRitualRhythm, parsePeople, parseArtifacts, getArtifactDetail, updateArtifactStatus, parsePatterns, parseDCAFrontmatter, parseDailyFocus, parseRecoveryFlag, parseBuildBlocks, parseLastPulse, parseRitualStreak, parseCadence }
```

**Step 3: Verify manually**

Run: `cd ace-desktop && node -e "const vr = require('./src/vault-reader'); console.log(vr.parseCadence('/Users/nikhilkale/Documents/Actualize'))"`

Expected: JSON with weeklyDays, weeklyDate, monthlyDays, monthlyDate populated from actual vault files.

**Step 4: Commit**

```bash
git add ace-desktop/src/vault-reader.js
git commit -m "feat(ace-desktop): add parseCadence to vault-reader for review freshness"
```

---

### Task 2: Wire IPC channel for cadence data

**Files:**
- Modify: `ace-desktop/src/ipc-channels.js:117-120`
- Modify: `ace-desktop/preload.js:71`
- Modify: `ace-desktop/main.js:546-550`

**Step 1: Add IPC channel constant**

In `ace-desktop/src/ipc-channels.js`, add before the closing `}`:

```javascript
  GET_CADENCE:        'get-cadence',
```

**Step 2: Add preload bridge**

In `ace-desktop/preload.js`, add after the `getRitualStreak` line (line 71):

```javascript
    getCadence:       () => ipcRenderer.invoke(ch.GET_CADENCE),
```

**Step 3: Add main process handler**

In `ace-desktop/main.js`, add after the `GET_RITUAL_STREAK` handler (after line 550):

```javascript
ipcMain.handle(ch.GET_CADENCE, () => {
  try {
    return require('./src/vault-reader').parseCadence(global.VAULT_PATH)
  } catch (e) { return { weeklyDays: null, weeklyDate: null, monthlyDays: null, monthlyDate: null, error: e.message } }
})
```

**Step 4: Commit**

```bash
git add ace-desktop/src/ipc-channels.js ace-desktop/preload.js ace-desktop/main.js
git commit -m "feat(ace-desktop): wire get-cadence IPC channel"
```

---

### Task 3: Add cadence data to dashboard allData

**Files:**
- Modify: `ace-desktop/renderer/dashboard.js:55-56` (sourceMap)
- Modify: `ace-desktop/renderer/dashboard.js:88` (always-fetch block)
- Modify: `ace-desktop/renderer/dashboard.js:104` (allData bundle)

**Step 1: Add to sourceMap**

In `dashboard.js`, add after the `getRitualStreak` line in sourceMap (~line 55):

```javascript
    getCadence:        () => window.ace.dash.getCadence(),
```

**Step 2: Add to always-fetch block**

After the `getRitualStreak` always-fetch line (~line 88), add:

```javascript
  if (!data.getCadence)     data.getCadence     = await window.ace.dash.getCadence()
```

**Step 3: Add to allData bundle**

After the `ritualStreak` line in the allData object (~line 104), add:

```javascript
    cadence:       data.getCadence,
```

**Step 4: Commit**

```bash
git add ace-desktop/renderer/dashboard.js
git commit -m "feat(ace-desktop): plumb cadence data into dashboard allData"
```

---

### Task 4: Create the cadence widget (JS)

**Files:**
- Create: `ace-desktop/renderer/widgets/cadence.js`

**Step 1: Write the widget**

```javascript
// renderer/widgets/cadence.js
// Cadence Ring — ritual streak (top) + review freshness (bottom).
// Replaces standalone ritualstreak in cockpit-brain zone.

function weeklyColor(days) {
  if (days == null) return 'dim'
  if (days <= 7)  return 'green'
  if (days <= 9)  return 'yellow'
  return 'red'
}

function monthlyColor(days) {
  if (days == null) return 'dim'
  if (days <= 31) return 'green'
  if (days <= 37) return 'yellow'
  return 'red'
}

function formatDate(iso) {
  if (!iso) return 'never'
  const d = new Date(iso + 'T00:00:00')
  return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })
}

function launchSkill(cmd) {
  document.querySelector('.nav-item[data-view="terminal"]')?.click()
  setTimeout(() => {
    if (window.spawnSession) window.spawnSession()
    setTimeout(() => {
      const st = window.__aceState
      if (st?.activeId && window.sendChatMessage) {
        window.sendChatMessage(st.activeId, cmd)
      } else if (window.sendToActive) {
        window.sendToActive(cmd + '\r')
      }
    }, 200)
  }, 150)
}

export default {
  id: 'cadence',
  label: 'Cadence Ring',
  description: 'Ritual streak + weekly/monthly review freshness',
  dataSource: null,
  defaultEnabled: true,

  render(allData, el) {
    // ─── Ritual Streak (top half) ───
    const d = allData.ritualStreak || {}
    const streak      = d.streak      ?? 0
    const todayActive = d.todayActive ?? false
    const pending     = d.todayPending ?? false
    const last7       = d.last7       || []

    const dotsHtml = last7.map((day, i) => {
      const cls = ['rs-dot', day.active ? 'active' : '', i === 0 ? 'today' : ''].filter(Boolean).join(' ')
      return `<div class="${cls}" title="${day.date}"></div>`
    }).join('')

    const statusText = todayActive
      ? 'Today complete'
      : pending
        ? 'Run /start to keep your streak'
        : streak === 0
          ? 'Start your first ritual today'
          : 'Run /start to keep your streak'

    // ─── Cadence (bottom half) ───
    const c = allData.cadence || {}
    const wDays = c.weeklyDays
    const mDays = c.monthlyDays
    const wColor = weeklyColor(wDays)
    const mColor = monthlyColor(mDays)
    const wOverdue = wColor !== 'green' && wColor !== 'dim'
    const mOverdue = mColor !== 'green' && mColor !== 'dim'

    // Ring state — worst of the two
    let ringClass = ''
    if (wColor === 'red' || mColor === 'red') ringClass = 'overdue-red'
    else if (wColor === 'yellow' || mColor === 'yellow') ringClass = 'overdue-yellow'

    const wLabel = wDays != null ? `${wDays}d` : '—'
    const mLabel = mDays != null ? `${mDays}d` : '—'
    const wTooltip = `Last weekly review: ${formatDate(c.weeklyDate)}${wOverdue ? ' — click to run' : ''}`
    const mTooltip = `Last monthly reflection: ${formatDate(c.monthlyDate)}${mOverdue ? ' — click to run' : ''}`

    el.innerHTML = `
      <div class="cadence-ring-wrap ${ringClass}">
        <div class="cadence-ring-track"></div>
        <div class="cadence-ring-inner">
          <div class="rs-section">
            <div class="rs-top">
              <span class="rs-count">${streak}</span>
              <span class="rs-unit">day${streak !== 1 ? 's' : ''}</span>
            </div>
            <div class="rs-label">ritual streak</div>
            <div class="rs-dots">${dotsHtml}</div>
          </div>
          <div class="cadence-ring-divider"></div>
          <div class="cadence-section">
            <div class="cadence-label">cadence</div>
            <div class="cadence-chips">
              <div class="cadence-chip ${wOverdue ? 'overdue' : ''}" data-skill="/weekly-review">
                <div class="cadence-pip ${wColor}"></div>
                <span class="cadence-key">W:</span>
                <span class="cadence-days ${wColor}">${wLabel}</span>
                <span class="cadence-arrow ${wOverdue ? wColor : ''}">&#9655;</span>
                <div class="cadence-tooltip">${wTooltip}</div>
              </div>
              <span class="cadence-dot-sep">&middot;</span>
              <div class="cadence-chip ${mOverdue ? 'overdue' : ''}" data-skill="/monthly-reflection">
                <div class="cadence-pip ${mColor}"></div>
                <span class="cadence-key">M:</span>
                <span class="cadence-days ${mColor}">${mLabel}</span>
                <span class="cadence-arrow ${mOverdue ? mColor : ''}">&#9655;</span>
                <div class="cadence-tooltip">${mTooltip}</div>
              </div>
            </div>
          </div>
        </div>
      </div>`

    // Click handlers
    el.querySelectorAll('.cadence-chip').forEach(chip => {
      chip.addEventListener('click', () => {
        const cmd = chip.dataset.skill
        if (cmd) launchSkill(cmd)
      })
    })
  }
}
```

**Step 2: Commit**

```bash
git add ace-desktop/renderer/widgets/cadence.js
git commit -m "feat(ace-desktop): create cadence ring widget"
```

---

### Task 5: Register the cadence widget and retire standalone ritualstreak

**Files:**
- Modify: `ace-desktop/renderer/widgets/registry.js`

**Step 1: Add cadence import, remove ritualstreak from WIDGETS and WIDGET_ZONES**

Replace the `ritualstreak` import line with:

```javascript
import cadence     from './cadence.js'
```

Keep the `ritualstreak` import (it's still used inside cadence indirectly through allData). Actually, ritualstreak data comes via `allData.ritualStreak` — the import is only for the widget object. Remove it from the WIDGETS array and zones.

In `WIDGETS` array (line 27), replace `ritualstreak` with `cadence`:

```javascript
export const WIDGETS = [
  northstar, orb, synthesis, cadence, compass, pulsechip,
  integrity,
  triadAuthority, triadCapacity, triadExpansion,
  innermove,
  identity, astro, metrics, rhythm, velocity,
  state, outcomes, targets, pipeline, followups, quickactions,
]
```

In `WIDGET_ZONES` (line 43), replace the `ritualstreak` entry with `cadence`:

```javascript
  cadence:          'cockpit-brain',
```

Remove the `ritualstreak` zone entry entirely.

**Step 2: Update index.html container ID**

In `ace-desktop/renderer/index.html`, change:

```html
<div id="widget-ritualstreak" class="cb-ritualstreak"></div>
```

to:

```html
<div id="widget-cadence" class="cb-cadence"></div>
```

**Step 3: Commit**

```bash
git add ace-desktop/renderer/widgets/registry.js ace-desktop/renderer/index.html
git commit -m "feat(ace-desktop): register cadence widget, retire standalone ritualstreak"
```

---

### Task 6: Add cadence ring CSS

**Files:**
- Modify: `ace-desktop/renderer/styles/views/cockpit.css`

**Step 1: Replace ritual streak styles with cadence ring styles**

Find the `/* ═══ Ritual Streak widget ═══ */` section (line 884) and replace it entirely. Also add the cadence-specific styles. The full replacement block:

```css
/* ═══ Cadence Ring (ritual streak + review freshness) ════════════════ */
.cadence-ring-wrap {
  position: relative;
  width: 240px; height: 240px;
  margin: 0 auto;
  display: flex;
  align-items: center;
  justify-content: center;
}

.cadence-ring-track {
  position: absolute;
  inset: 0;
  border-radius: 50%;
  border: 1px solid rgba(212,165,116,0.12);
  transition: border-color 0.6s ease, box-shadow 0.6s ease;
}
.cadence-ring-track::before {
  content: '';
  position: absolute;
  inset: 16px;
  border-radius: 50%;
  border: 1px dashed rgba(212,165,116,0.08);
  transition: border-color 0.6s ease;
}
.cadence-ring-track::after {
  content: '';
  position: absolute;
  inset: -2px;
  border-radius: 50%;
  border: 1.5px solid transparent;
  clip-path: inset(50% 0 0 0);
  transition: border-color 0.6s ease, box-shadow 0.6s ease;
}

/* Overdue ring pulses */
.cadence-ring-wrap.overdue-yellow .cadence-ring-track::after {
  border-color: rgba(224,192,96,0.4);
  box-shadow: 0 0 16px rgba(224,192,96,0.15), inset 0 0 16px rgba(224,192,96,0.08);
  animation: ring-pulse-amber 3s ease-in-out infinite;
}
@keyframes ring-pulse-amber {
  0%, 100% { border-color: rgba(224,192,96,0.4); box-shadow: 0 0 16px rgba(224,192,96,0.15); }
  50%      { border-color: rgba(224,192,96,0.6); box-shadow: 0 0 28px rgba(224,192,96,0.25); }
}
.cadence-ring-wrap.overdue-red .cadence-ring-track::after {
  border-color: rgba(224,112,128,0.45);
  box-shadow: 0 0 20px rgba(224,112,128,0.2), inset 0 0 20px rgba(224,112,128,0.1);
  animation: ring-pulse-red 2.2s ease-in-out infinite;
}
@keyframes ring-pulse-red {
  0%, 100% { border-color: rgba(224,112,128,0.45); box-shadow: 0 0 20px rgba(224,112,128,0.2); }
  50%      { border-color: rgba(224,112,128,0.7);  box-shadow: 0 0 36px rgba(224,112,128,0.35); }
}

.cadence-ring-inner {
  position: relative;
  width: 210px; height: 210px;
  border-radius: 50%;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  z-index: 2;
}

.cadence-ring-divider {
  width: 60%;
  height: 1px;
  background: linear-gradient(90deg, transparent, rgba(212,165,116,0.25), transparent);
  margin: 8px 0;
}

/* Top half — Ritual Streak */
.rs-section {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 4px;
  flex: 1;
  justify-content: flex-end;
  padding-bottom: 4px;
}
.rs-top {
  display: flex;
  align-items: baseline;
  gap: 4px;
}
.rs-count {
  font-family: var(--font-display);
  font-size: 38px;
  font-weight: 300;
  color: var(--amber);
  line-height: 1;
  letter-spacing: -1px;
}
.rs-unit {
  font-size: 13px;
  color: var(--amber);
  opacity: 0.75;
  font-weight: 400;
}
.rs-label {
  font-family: var(--font-mono);
  font-size: 8px;
  letter-spacing: 0.15em;
  text-transform: uppercase;
  color: var(--text-dim);
  margin-top: -2px;
}
.rs-dots {
  display: flex;
  gap: 5px;
  margin-top: 2px;
}
.rs-dot {
  width: 7px; height: 7px;
  border-radius: 50%;
  background: rgba(255,255,255,0.08);
  transition: background 0.3s ease;
}
.rs-dot.active { background: var(--amber); }
.rs-dot.today {
  outline: 1.5px solid rgba(212,165,116,0.4);
  outline-offset: 2px;
}
.rs-dot.today.active { outline-color: rgba(212,165,116,0.7); }

/* Bottom half — Cadence Ticker */
.cadence-section {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 6px;
  flex: 1;
  justify-content: flex-start;
  padding-top: 4px;
}
.cadence-label {
  font-family: var(--font-mono);
  font-size: 8px;
  letter-spacing: 0.15em;
  text-transform: uppercase;
  color: var(--text-dim);
}
.cadence-chips {
  display: flex;
  gap: 6px;
  align-items: center;
}
.cadence-chip {
  display: flex;
  align-items: center;
  gap: 6px;
  cursor: pointer;
  padding: 4px 8px;
  border-radius: 6px;
  transition: background 0.2s ease;
  position: relative;
}
.cadence-chip:hover { background: rgba(255,255,255,0.04); }
.cadence-chip.overdue:hover { background: rgba(255,255,255,0.06); }
.cadence-chip:active {
  background: rgba(255,255,255,0.08);
  transform: scale(0.97);
}

.cadence-pip {
  width: 6px; height: 6px;
  border-radius: 50%;
  flex-shrink: 0;
}
.cadence-pip.green  { background: #60d8a8; box-shadow: 0 0 8px var(--glow-mint); }
.cadence-pip.yellow { background: #e0c060; box-shadow: 0 0 8px rgba(224,192,96,0.3); }
.cadence-pip.red    { background: #e07080; box-shadow: 0 0 8px var(--glow-rose); animation: cadence-pip-pulse 2s ease-in-out infinite; }
.cadence-pip.dim    { background: rgba(255,255,255,0.1); }
@keyframes cadence-pip-pulse {
  0%, 100% { opacity: 1; }
  50% { opacity: 0.5; }
}

.cadence-key {
  font-family: var(--font-mono);
  font-size: 11px;
  color: var(--text-secondary);
  font-weight: 400;
}
.cadence-days {
  font-family: var(--font-mono);
  font-size: 13px;
  font-weight: 400;
  letter-spacing: -0.02em;
}
.cadence-days.green  { color: #60d8a8; }
.cadence-days.yellow { color: #e0c060; }
.cadence-days.red    { color: #e07080; }
.cadence-days.dim    { color: var(--text-dim); }

.cadence-arrow {
  font-family: var(--font-mono);
  font-size: 10px;
  opacity: 0;
  width: 10px;
  text-align: center;
  flex-shrink: 0;
  transition: opacity 0.3s ease;
  display: inline-block;
}
.cadence-arrow.yellow { color: #e0c060; }
.cadence-arrow.red    { color: #e07080; }
.cadence-chip.overdue .cadence-arrow { opacity: 0.65; }
.cadence-chip.overdue:hover .cadence-arrow { opacity: 1; }

.cadence-dot-sep {
  color: var(--text-dim);
  font-size: 10px;
  opacity: 0.4;
}

/* Tooltip */
.cadence-chip .cadence-tooltip {
  display: none;
  position: absolute;
  bottom: calc(100% + 8px);
  left: 50%;
  transform: translateX(-50%);
  background: rgba(20,22,36,0.95);
  border: 1px solid rgba(255,255,255,0.08);
  border-radius: 6px;
  padding: 6px 10px;
  font-family: var(--font-mono);
  font-size: 10px;
  color: var(--text-secondary);
  white-space: nowrap;
  z-index: 10;
  pointer-events: none;
}
.cadence-chip:hover .cadence-tooltip { display: block; }
```

**Step 2: Remove old `.ritual-streak` styles**

Delete the entire old ritual streak block (`.ritual-streak` through `.rs-status`) that was at lines 885-959. The new styles above include the `.rs-*` classes inside the cadence ring context.

**Step 3: Update `.cb-ritualstreak` references to `.cb-cadence`**

If any CSS references `.cb-ritualstreak`, rename to `.cb-cadence`. (Check with grep first.)

**Step 4: Commit**

```bash
git add ace-desktop/renderer/styles/views/cockpit.css
git commit -m "feat(ace-desktop): cadence ring CSS with overdue pulse + arrow affordance"
```

---

### Task 7: Visual verification

**No files changed — manual test only.**

**Step 1: Launch the app**

Run: `cd ace-desktop && npm start`

**Step 2: Verify the cadence ring**

- Coherence orb on left, command center in middle, cadence ring on right
- Top half shows ritual streak count + dots
- Bottom half shows `W: Xd · M: Xd` with correct day counts
- Colors match thresholds (check against actual vault dates)
- Hover shows tooltip with full date

**Step 3: Verify overdue behavior**

If weekly or monthly is actually overdue in the vault:
- Ring bottom half pulses amber or red
- Arrow (▷) visible on overdue chip
- Tooltip shows " — click to run"

**Step 4: Verify click-to-launch**

Click an overdue chip (or any chip). Should:
1. Switch to terminal view
2. Spawn a new session
3. Send the skill command (`/weekly-review` or `/monthly-reflection`)

**Step 5: Verify no regressions**

- Other widgets render normally
- Settings panel shows "Cadence Ring" (not "Ritual Streak")
- No console errors
