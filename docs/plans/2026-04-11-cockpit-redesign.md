# ACE Cockpit Redesign Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Replace the current home dashboard with a directional coherence cockpit — a bio-organic spaceship with North Star, breathing orb, creative compass, three triad cards (Authority/Capacity/Expansion) with a gravitationally-risen highest-leverage action, Inner Move bar, and extensible operator dock.

**Architecture:** Zone-based widget system. Existing widget registry pattern preserved with new `zone` field. New composite widgets (`triadLeg`, `northstar`, `compass`, `innermove`) consume `allData`. New `vault-writer.js` mirrors `vault-reader.js` for write-back actions (mark done, snooze). Leverage scoring lives in `synthesizer.js`, runs per-render. All animations CSS-only (transform/opacity/filter), 5.5 bpm breath cycles.

**Tech Stack:** Electron 34, vanilla JS modules (renderer), Node 20 (main), better-sqlite3, marked.js, existing IPC pattern via `ch.GET_*` channels in `src/ipc-channels.js`.

**Verification model:** No unit test framework exists in ace-desktop. Verification = (1) launch app via `npm start`, (2) check console for errors, (3) visual comparison against prototype at [docs/plans/2026-04-11-cockpit-prototype-v2.html](2026-04-11-cockpit-prototype-v2.html), (4) test write-back by inspecting source files after action. Reload renderer with Cmd+R between changes.

**Reference docs:**
- Design: [2026-04-11-cockpit-redesign-design.md](2026-04-11-cockpit-redesign-design.md)
- Prototype (visual truth): [2026-04-11-cockpit-prototype-v2.html](2026-04-11-cockpit-prototype-v2.html)

**Working directory:** `/Users/nikhilkale/Documents/Actualize/ace-desktop`

**Order of work:** Backend data layer first (parsers, scoring, IPC) → renderer wiring → individual widgets → integration → polish. Each task ends in a working app state — no broken intermediate states.

**Frequent commits:** After each task. Use conventional commit prefixes: `feat:`, `refactor:`, `style:`, `fix:`.

---

## Phase 1 — Backend Data Layer

### Task 1: Add DCA frontmatter parser to vault-reader.js

**Files:**
- Modify: `src/vault-reader.js` (add new function near existing `parseDCA` at line 214)
- Modify: `00-System/core/dca.md` (add frontmatter block — manual test fixture)

**Step 1: Read existing parseFrontmatter helper**

The file already has `parseFrontmatter()` at line 497 that parses `---\nkey: value\n---` blocks but only handles strings and flat arrays `[a, b, c]`. The DCA frontmatter has nested objects (`compass_directions.north.label`, etc.). We need a new YAML-aware parser OR enhance the existing one.

Decision: Use a minimal YAML-subset parser for DCA frontmatter only. Don't introduce a YAML dependency for this — write the small parser inline. The DCA frontmatter has predictable shape (defined in design doc).

**Step 2: Add parseDCAFrontmatter function**

Add to `src/vault-reader.js` after the existing `parseDCA` function (around line 226):

```js
function parseDCAFrontmatter(vaultPath) {
  try {
    const text = fs.readFileSync(path.join(vaultPath, '00-System', 'core', 'dca.md'), 'utf8')
    const fmMatch = text.match(/^---\n([\s\S]*?)\n---/)
    if (!fmMatch) return defaultDCAFrontmatter()

    const lines = fmMatch[1].split('\n')
    const result = {
      north_star_anchors: [],
      gate_date: null,
      journey_start: null,
      affirmations: [],
      compass_directions: defaultCompassDirections(),
    }

    let currentList = null      // 'north_star_anchors' | 'affirmations' | null
    let currentDirection = null // 'north' | 'east' | 'south' | 'west' | null
    let currentDirField = null  // 'label' | 'keywords' | null

    for (const raw of lines) {
      const line = raw.replace(/\r$/, '')
      if (!line.trim()) continue

      // Top-level scalar: "key: value"
      const scalar = line.match(/^([a-z_]+):\s*(.+)$/)
      if (scalar) {
        const [, key, val] = scalar
        if (key === 'gate_date') result.gate_date = val.trim()
        else if (key === 'journey_start') result.journey_start = val.trim()
        currentList = null
        currentDirection = null
        currentDirField = null
        continue
      }

      // List header: "key:" (no value)
      const listHeader = line.match(/^([a-z_]+):\s*$/)
      if (listHeader) {
        const key = listHeader[1]
        if (key === 'north_star_anchors' || key === 'affirmations') {
          currentList = key
          currentDirection = null
        } else if (key === 'compass_directions') {
          currentList = 'compass_directions'
          currentDirection = null
        }
        continue
      }

      // List item: "  - "value""
      const listItem = line.match(/^\s*-\s*"?(.+?)"?\s*$/)
      if (listItem && currentList === 'north_star_anchors') {
        result.north_star_anchors.push(listItem[1])
        continue
      }
      if (listItem && currentList === 'affirmations') {
        result.affirmations.push(listItem[1])
        continue
      }
      // Keywords list under a direction
      if (listItem && currentDirection && currentDirField === 'keywords') {
        if (!result.compass_directions[currentDirection].keywords) {
          result.compass_directions[currentDirection].keywords = []
        }
        result.compass_directions[currentDirection].keywords.push(listItem[1])
        continue
      }

      // Compass direction header: "  north:" (2-space indent)
      const dirHeader = line.match(/^\s{2}(north|east|south|west):\s*$/)
      if (dirHeader && currentList === 'compass_directions') {
        currentDirection = dirHeader[1]
        currentDirField = null
        if (!result.compass_directions[currentDirection]) {
          result.compass_directions[currentDirection] = { label: '', keywords: [] }
        }
        continue
      }

      // Direction field: "    label: "..."" or "    keywords: [...]"
      const dirField = line.match(/^\s{4}(label|keywords):\s*(.*)$/)
      if (dirField && currentDirection) {
        const [, field, val] = dirField
        currentDirField = field
        if (field === 'label') {
          result.compass_directions[currentDirection].label = val.replace(/^["']|["']$/g, '')
        } else if (field === 'keywords') {
          // Inline array form: keywords: [a, b, c]
          if (val.startsWith('[') && val.endsWith(']')) {
            result.compass_directions[currentDirection].keywords =
              val.slice(1, -1).split(',').map(s => s.trim().replace(/^["']|["']$/g, '')).filter(Boolean)
          } else {
            result.compass_directions[currentDirection].keywords = []
          }
        }
        continue
      }
    }

    // Compute journey day count
    if (result.gate_date && result.journey_start) {
      const start = new Date(result.journey_start)
      const gate = new Date(result.gate_date)
      const today = new Date()
      today.setHours(0, 0, 0, 0)
      const daysTotal = Math.round((gate - start) / (1000 * 60 * 60 * 24))
      const daysElapsed = Math.round((today - start) / (1000 * 60 * 60 * 24))
      result.daysTotal = daysTotal
      result.daysElapsed = Math.max(0, Math.min(daysTotal, daysElapsed))
    }

    return result
  } catch (e) {
    return { ...defaultDCAFrontmatter(), error: e.message }
  }
}

function defaultCompassDirections() {
  return {
    north: { label: 'Visible expression', keywords: ['content', 'post', 'publish', 'talk', 'podcast', 'video', 'share'] },
    east:  { label: 'Sovereign infrastructure', keywords: ['build', 'code', 'ship', 'system', 'automation', 'integration', 'deploy'] },
    south: { label: 'Liberation and overflow', keywords: ['recovery', 'regulate', 'breath', 'body', 'rest', 'integration', 'audit-energy'] },
    west:  { label: 'Lineage and devotion', keywords: ['strategy', 'ritual', 'ancestry', 'decision', 'vision', 'threshold'] },
  }
}

function defaultDCAFrontmatter() {
  return {
    north_star_anchors: [],
    gate_date: null,
    journey_start: null,
    affirmations: [],
    compass_directions: defaultCompassDirections(),
    daysElapsed: null,
    daysTotal: null,
  }
}
```

**Step 3: Export the new function**

Modify the `module.exports` line at the end of `src/vault-reader.js`:

```js
module.exports = {
  parseState, parseFollowUps, listDir, parseExecutionLog, parseRitualRhythm,
  parsePeople, parseArtifacts, getArtifactDetail, updateArtifactStatus, parsePatterns,
  parseDCAFrontmatter,  // NEW
}
```

**Step 4: Add frontmatter to dca.md as test fixture**

Edit `00-System/core/dca.md` to add the frontmatter block at the very top (before `# Definite Chief Aim`):

```yaml
---
north_star_anchors:
  - "Already sovereign"
  - "Already overflowing"
  - "Already arriving"
gate_date: 2027-12-31
journey_start: 2024-04-01
affirmations:
  - "Coherence is my operating state."
  - "The systems hold the back-end. My expression lives front-stage."
  - "I lead in the lineage of Shivaji."
  - "My homes are sanctuaries."
  - "I am surrounded by incredible allies worldwide."
  - "Truth reaches the world at scale."
  - "Liberation is already lived."
  - "Actualization is my proof."
compass_directions:
  north:
    label: "Visible expression"
    keywords: [content, post, publish, talk, podcast, video, share]
  east:
    label: "Sovereign infrastructure"
    keywords: [build, code, ship, system, automation, integration, deploy]
  south:
    label: "Liberation and overflow"
    keywords: [recovery, regulate, breath, body, rest, integration]
  west:
    label: "Lineage and devotion"
    keywords: [strategy, ritual, ancestry, decision, vision, threshold]
---
```

**Step 5: Verify with a quick script**

Run from repo root:
```bash
cd ace-desktop && node -e "
const { parseDCAFrontmatter } = require('./src/vault-reader.js');
const result = parseDCAFrontmatter('/Users/nikhilkale/Documents/Actualize');
console.log(JSON.stringify(result, null, 2));
"
```

Expected output: object with `north_star_anchors` (3 strings), `affirmations` (8 strings), `compass_directions` (4 keys, each with label and keywords array), `gate_date: '2027-12-31'`, `daysElapsed` and `daysTotal` as numbers.

If parsing fails on any field, fix the parser before continuing.

**Step 6: Commit**

```bash
git add ace-desktop/src/vault-reader.js 00-System/core/dca.md
git commit -m "feat(vault-reader): add DCA frontmatter parser for cockpit"
```

---

### Task 2: Add daily-focus + recovery-flag + build-blocks parsers

**Files:**
- Modify: `src/vault-reader.js` (add 3 new parser functions)

**Step 1: Add parseDailyFocus**

Add after `parseDCAFrontmatter`:

```js
function parseDailyFocus(vaultPath) {
  try {
    const today = new Date()
    const dateStr = today.toISOString().slice(0, 10)
    const filePath = path.join(vaultPath, '01-Journal', 'daily', `${dateStr}.md`)
    const text = fs.readFileSync(filePath, 'utf8')

    // Look for "## Today's Focus" or "**Focus:**" (multiple template variants)
    const focusItems = []

    // Pattern 1: "## Today's Focus" section with bullets
    const sectionMatch = text.match(/## Today['']s Focus\s*\n([\s\S]*?)(?=\n## |$)/i)
    if (sectionMatch) {
      const bullets = sectionMatch[1].split('\n')
        .filter(l => /^\s*-\s+\S/.test(l))
        .map(l => l.replace(/^\s*-\s*\[?[x ]?\]?\s*/i, '').trim())
        .filter(Boolean)
      focusItems.push(...bullets)
    }

    // Pattern 2: "**Focus:**" inline
    const inlineMatch = text.match(/\*\*Focus:\*\*\s*(.+)/i)
    if (inlineMatch && inlineMatch[1].trim()) {
      focusItems.push(inlineMatch[1].trim())
    }

    // Pattern 3: "## Top 3" or "## Priorities"
    const prioritiesMatch = text.match(/## (?:Top 3|Priorities|Today's Top)\s*\n([\s\S]*?)(?=\n## |$)/i)
    if (prioritiesMatch) {
      const bullets = prioritiesMatch[1].split('\n')
        .filter(l => /^\s*\d+\.\s+\S|^\s*-\s+\S/.test(l))
        .map(l => l.replace(/^\s*\d+\.\s*|\s*-\s*\[?[x ]?\]?\s*/i, '').trim())
        .filter(Boolean)
      focusItems.push(...bullets)
    }

    return focusItems
  } catch (e) {
    return []
  }
}
```

**Step 2: Add parseRecoveryFlag**

Add after `parseDailyFocus`:

```js
function parseRecoveryFlag(vaultPath) {
  try {
    const text = fs.readFileSync(path.join(vaultPath, '00-System', 'state.md'), 'utf8')
    const m = text.match(/## Recovery Flag\s*\n\s*(true|false)/i)
    return m ? m[1].toLowerCase() === 'true' : false
  } catch {
    return false
  }
}
```

**Step 3: Add parseBuildBlocks (calendar shim for now)**

Build blocks live in Google Calendar. The dashboard already has calendar IPC infrastructure for /pulse but no direct calendar reader in vault-reader.js. For v1, **read pre-cached BUILD blocks from `pulse-cache.md`** which already lists them. If pulse-cache is stale, return empty array.

Add after `parseRecoveryFlag`:

```js
function parseBuildBlocks(vaultPath) {
  try {
    const text = fs.readFileSync(path.join(vaultPath, '00-System', 'pulse-cache.md'), 'utf8')

    // pulse-cache.md format:
    // build_blocks_week: 7
    // build_blocks_upcoming:
    //   - title: "Cockpit deep work"
    //     start: "2026-04-11T14:00"
    //     duration_min: 90
    const upcomingMatch = text.match(/build_blocks_upcoming:\s*\n((?:\s+-\s+[\s\S]*?(?=\n\s*-|\n[a-z_]+:|\n\n|$))+)/)
    if (!upcomingMatch) return []

    const blocks = []
    const now = new Date()

    // Split on bullet items
    const items = upcomingMatch[1].split(/\n\s*-\s+/).filter(Boolean)
    for (const item of items) {
      const titleMatch = item.match(/title:\s*"?([^"\n]+)"?/)
      const startMatch = item.match(/start:\s*"?([^"\n]+)"?/)
      const durationMatch = item.match(/duration_min:\s*(\d+)/)
      if (!titleMatch || !startMatch) continue

      const start = new Date(startMatch[1])
      if (isNaN(start.getTime())) continue
      if (start < now) continue // skip past blocks
      const hoursUntil = Math.round((start - now) / (1000 * 60 * 60))
      if (hoursUntil > 24) continue // only next 24h

      blocks.push({
        title: titleMatch[1].trim(),
        start: start.toISOString(),
        hoursUntil,
        duration: durationMatch ? parseInt(durationMatch[1]) : 0,
      })
    }

    blocks.sort((a, b) => new Date(a.start) - new Date(b.start))
    return blocks
  } catch {
    return []
  }
}
```

**Step 4: Update exports**

```js
module.exports = {
  parseState, parseFollowUps, listDir, parseExecutionLog, parseRitualRhythm,
  parsePeople, parseArtifacts, getArtifactDetail, updateArtifactStatus, parsePatterns,
  parseDCAFrontmatter, parseDailyFocus, parseRecoveryFlag, parseBuildBlocks,  // NEW
}
```

**Step 5: Verify**

```bash
cd ace-desktop && node -e "
const r = require('./src/vault-reader.js');
const v = '/Users/nikhilkale/Documents/Actualize';
console.log('Daily focus:', r.parseDailyFocus(v));
console.log('Recovery flag:', r.parseRecoveryFlag(v));
console.log('Build blocks:', r.parseBuildBlocks(v));
"
```

Expected: arrays may be empty (today's daily note may not have a focus section yet, pulse-cache may not have build_blocks_upcoming structure yet). No errors thrown. Empty arrays are valid output.

**Step 6: Commit**

```bash
git add ace-desktop/src/vault-reader.js
git commit -m "feat(vault-reader): add daily focus, recovery flag, and build blocks parsers"
```

---

### Task 3: Create vault-writer.js for action write-back

**Files:**
- Create: `src/vault-writer.js`

**Step 1: Create the file**

```js
// src/vault-writer.js
// Mirrors vault-reader.js for write-back actions from the dashboard.
// All functions take vaultPath + parameters, return { ok: true } or { error: msg }.

const fs = require('fs')
const path = require('path')

// ─── Outcomes — mark complete ────────────────────────────────────────────────

function markOutcomeComplete(vaultPath, outcomeTitle) {
  try {
    const filePath = path.join(vaultPath, '00-System', 'active.md')
    let text = fs.readFileSync(filePath, 'utf8')

    // Find the outcome's ### section (title may have suffix " — Month Day")
    const titlePattern = outcomeTitle.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
    const sectionRe = new RegExp(`(### ${titlePattern}[^\\n]*\\n[\\s\\S]*?)(\\*\\*Status:\\*\\*\\s*)([A-Z ]+)`, 'i')
    const match = text.match(sectionRe)
    if (!match) return { error: `Outcome not found: ${outcomeTitle}` }

    text = text.replace(sectionRe, `$1$2COMPLETE`)
    fs.writeFileSync(filePath, text, 'utf8')
    return { ok: true }
  } catch (e) {
    return { error: e.message }
  }
}

// ─── Weekly Targets — toggle checkbox ────────────────────────────────────────

function toggleWeeklyTarget(vaultPath, targetText, checked = true) {
  try {
    const filePath = path.join(vaultPath, '00-System', 'active.md')
    let text = fs.readFileSync(filePath, 'utf8')

    // Find the target line: "- [ ] <text>" or "- [x] <text>"
    const escaped = targetText.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
    const lineRe = new RegExp(`(- \\[)[x ]?(\\] ${escaped})`, 'g')
    const match = text.match(lineRe)
    if (!match) return { error: `Target not found: ${targetText}` }

    text = text.replace(lineRe, `$1${checked ? 'x' : ' '}$2`)
    fs.writeFileSync(filePath, text, 'utf8')
    return { ok: true }
  } catch (e) {
    return { error: e.message }
  }
}

// ─── Follow-ups — update status or due date ──────────────────────────────────

function updateFollowUp(vaultPath, person, topic, updates) {
  // updates: { status?: string, due?: string }
  try {
    const filePath = path.join(vaultPath, '04-Network', 'follow-ups.md')
    let text = fs.readFileSync(filePath, 'utf8')

    // Find rows in the Active section that match person + topic
    const lines = text.split('\n')
    let inActive = false
    let modified = false

    for (let i = 0; i < lines.length; i++) {
      if (/^## Active/i.test(lines[i])) { inActive = true; continue }
      if (inActive && /^## /.test(lines[i])) break
      if (!inActive) continue
      if (!lines[i].trim().startsWith('|')) continue

      // Parse row: | Person | Topic | Due | Status | Notes |
      // Neutralize wikilink pipes: [[a|b]] → [[a∥b]]
      const neutralized = lines[i].replace(/\[\[([^\]]*?)\|([^\]]*?)\]\]/g, '[[$1∥$2]]')
      const cells = neutralized.split('|').map(c => c.trim())
      if (cells.length < 5) continue

      // cells: ['', Person, Topic, Due, Status, Notes, '']
      const rowPerson = cells[1].replace(/\[\[(?:[^\]∥]+∥)?([^\]]+)\]\]/g, '$1').replace(/∥/g, '|').trim()
      const rowTopic = cells[2].replace(/∥/g, '|').trim()

      // Match: person matches AND topic starts with first 30 chars of provided topic
      const personMatch = rowPerson.toLowerCase() === person.toLowerCase()
      const topicSnippet = topic.slice(0, 30).toLowerCase()
      const topicMatch = rowTopic.toLowerCase().startsWith(topicSnippet)
      if (!personMatch || !topicMatch) continue

      // Apply updates — restore original line then patch the cells
      let newLine = lines[i]
      if (updates.status) {
        // Replace 4th cell content (Status)
        const cellRe = new RegExp(`^(\\|[^|]*\\|[^|]*\\|[^|]*\\|)([^|]*)(\\|)`)
        newLine = newLine.replace(cellRe, `$1 ${updates.status} $3`)
      }
      if (updates.due) {
        const cellRe = new RegExp(`^(\\|[^|]*\\|[^|]*\\|)([^|]*)(\\|)`)
        newLine = newLine.replace(cellRe, `$1 ${updates.due} $3`)
      }
      lines[i] = newLine
      modified = true
      break
    }

    if (!modified) return { error: `Follow-up not found: ${person} / ${topic.slice(0, 40)}...` }
    fs.writeFileSync(filePath, lines.join('\n'), 'utf8')
    return { ok: true }
  } catch (e) {
    return { error: e.message }
  }
}

module.exports = { markOutcomeComplete, toggleWeeklyTarget, updateFollowUp }
```

**Step 2: Verify with manual smoke test**

Create a temporary test fixture and run:

```bash
cd ace-desktop && node -e "
const w = require('./src/vault-writer.js');
const v = '/Users/nikhilkale/Documents/Actualize';
// Dry run — verify functions exist and return { error } not crash on missing items
console.log('markOutcomeComplete:', w.markOutcomeComplete(v, 'Nonexistent Outcome'));
console.log('toggleWeeklyTarget:',  w.toggleWeeklyTarget(v, 'Nonexistent Target'));
console.log('updateFollowUp:',      w.updateFollowUp(v, 'Nonexistent', 'topic', { status: 'Done' }));
"
```

Expected output: each call returns `{ error: '...not found...' }`. **The vault file MUST NOT be modified** — verify with `git status` after running. If `00-System/active.md` or `04-Network/follow-ups.md` shows as modified, the writer has a bug — fix before committing.

**Step 3: Commit**

```bash
git add ace-desktop/src/vault-writer.js
git commit -m "feat(vault-writer): add write-back functions for outcomes, targets, follow-ups"
```

---

### Task 4: Add IPC channels for new endpoints

**Files:**
- Modify: `src/ipc-channels.js`

**Step 1: Read existing channels file**

Run: `cat ace-desktop/src/ipc-channels.js`. Note the existing pattern — module.exports object with kebab-case channel names.

**Step 2: Add new channels**

Add to the exports object (preserve formatting style):

```js
  // Cockpit additions
  GET_NORTHSTAR:   'get-northstar',
  GET_DAILY_FOCUS: 'get-daily-focus',
  GET_BUILD_BLOCKS:'get-build-blocks',
  MARK_DONE:       'mark-done',
  SNOOZE_ITEM:     'snooze-item',
```

**Step 3: Verify**

```bash
cd ace-desktop && node -e "console.log(require('./src/ipc-channels.js'))" | grep -E "GET_NORTHSTAR|GET_DAILY_FOCUS|GET_BUILD_BLOCKS|MARK_DONE|SNOOZE_ITEM"
```

Expected: 5 lines printed.

**Step 4: Commit**

```bash
git add ace-desktop/src/ipc-channels.js
git commit -m "feat(ipc): add cockpit channels for northstar, daily focus, build blocks, mark done, snooze"
```

---

### Task 5: Wire IPC handlers in main.js

**Files:**
- Modify: `main.js` (add 5 new ipcMain.handle blocks after existing dashboard handlers around line 330)

**Step 1: Add the handlers**

After `ipcMain.handle(ch.GET_USAGE, ...)` (around line 330), add:

```js
ipcMain.handle(ch.GET_NORTHSTAR, () => {
  try {
    const reader = require('./src/vault-reader')
    return reader.parseDCAFrontmatter(global.VAULT_PATH)
  } catch (e) { return { error: e.message } }
})

ipcMain.handle(ch.GET_DAILY_FOCUS, () => {
  try {
    return require('./src/vault-reader').parseDailyFocus(global.VAULT_PATH)
  } catch (e) { return [] }
})

ipcMain.handle(ch.GET_BUILD_BLOCKS, () => {
  try {
    return require('./src/vault-reader').parseBuildBlocks(global.VAULT_PATH)
  } catch (e) { return [] }
})

ipcMain.handle(ch.MARK_DONE, (_, item) => {
  // item: { type, label, _raw: {...} }
  try {
    const writer = require('./src/vault-writer')
    if (item.type === 'outcome') {
      return writer.markOutcomeComplete(global.VAULT_PATH, item._raw?.title || item.label)
    }
    if (item.type === 'target') {
      return writer.toggleWeeklyTarget(global.VAULT_PATH, item._raw?.text || item.label, true)
    }
    if (item.type === 'followup') {
      return writer.updateFollowUp(
        global.VAULT_PATH,
        item._raw?.person,
        item._raw?.topic,
        { status: 'Done' }
      )
    }
    return { error: `Mark-done not supported for type: ${item.type}` }
  } catch (e) { return { error: e.message } }
})

ipcMain.handle(ch.SNOOZE_ITEM, (_, item, days) => {
  try {
    const writer = require('./src/vault-writer')
    if (item.type === 'followup') {
      const newDate = new Date()
      newDate.setDate(newDate.getDate() + (days || 3))
      const dueStr = newDate.toISOString().slice(0, 10)
      return writer.updateFollowUp(
        global.VAULT_PATH,
        item._raw?.person,
        item._raw?.topic,
        { due: dueStr }
      )
    }
    return { error: `Snooze not supported for type: ${item.type}` }
  } catch (e) { return { error: e.message } }
})
```

**Step 2: Launch app and verify no startup errors**

```bash
cd ace-desktop && npm start
```

Check the terminal output and the Electron DevTools console (View → Toggle Developer Tools, or Cmd+Opt+I). Expected: no errors mentioning `MARK_DONE`, `GET_NORTHSTAR`, etc. App launches normally with existing dashboard. Quit the app (Cmd+Q).

**Step 3: Commit**

```bash
git add ace-desktop/main.js
git commit -m "feat(main): wire cockpit IPC handlers for northstar, focus, build blocks, mark done, snooze"
```

---

### Task 6: Expose new methods in preload.js

**Files:**
- Modify: `preload.js`

**Step 1: Read existing dash bridge**

Find the `dash:` block in preload.js (around line 39). Note the pattern: `methodName: () => ipcRenderer.invoke(ch.CHANNEL_NAME)`.

**Step 2: Add new bridge methods**

Inside the `dash:` object, add:

```js
  getNorthStar:   () => ipcRenderer.invoke(ch.GET_NORTHSTAR),
  getDailyFocus:  () => ipcRenderer.invoke(ch.GET_DAILY_FOCUS),
  getBuildBlocks: () => ipcRenderer.invoke(ch.GET_BUILD_BLOCKS),
  markDone:       (item) => ipcRenderer.invoke(ch.MARK_DONE, item),
  snoozeItem:     (item, days) => ipcRenderer.invoke(ch.SNOOZE_ITEM, item, days),
```

**Step 3: Verify in DevTools**

Launch app:
```bash
cd ace-desktop && npm start
```

Open DevTools console (Cmd+Opt+I), run:
```js
await window.ace.dash.getNorthStar()
await window.ace.dash.getDailyFocus()
await window.ace.dash.getBuildBlocks()
```

Expected:
- `getNorthStar()` returns object with `north_star_anchors` array, `affirmations` array, `compass_directions` object, `daysElapsed`, `daysTotal`
- `getDailyFocus()` returns array (possibly empty)
- `getBuildBlocks()` returns array (possibly empty)

Quit app.

**Step 4: Commit**

```bash
git add ace-desktop/preload.js
git commit -m "feat(preload): expose cockpit dash methods"
```

---

### Task 7: Add leverage scoring + compass direction to synthesizer.js

**Files:**
- Modify: `src/synthesizer.js`

**Step 1: Read existing synthesizer**

Run `cat ace-desktop/src/synthesizer.js` to see current structure. Note `parseSignalDetails()` already exists.

**Step 2: Add computeCompassDirection**

Append to the file (before `module.exports`):

```js
function computeCompassDirection(vaultPath, directions) {
  try {
    const fs = require('fs')
    const path = require('path')
    let text = ''
    for (const file of ['execution-log-recent.md', 'execution-log.md']) {
      try { text += '\n' + fs.readFileSync(path.join(vaultPath, '00-System', file), 'utf8') } catch {}
    }

    // Limit to last 7 days of entries
    const today = new Date()
    today.setHours(0, 0, 0, 0)
    const cutoff = new Date(today)
    cutoff.setDate(cutoff.getDate() - 7)

    const sections = text.split(/\n(?=#{1,3}\s+\d{4}-\d{2}-\d{2})/)
    let weekText = ''
    for (const section of sections) {
      const dateMatch = section.match(/^#{1,3}\s+(\d{4}-\d{2}-\d{2})/)
      if (!dateMatch) continue
      const d = new Date(dateMatch[1])
      if (d >= cutoff) weekText += '\n' + section
    }

    const lower = weekText.toLowerCase()
    const scores = { north: 0, east: 0, south: 0, west: 0 }
    for (const [dir, config] of Object.entries(directions || {})) {
      const keywords = config.keywords || []
      for (const kw of keywords) {
        const matches = lower.split(kw.toLowerCase()).length - 1
        scores[dir] += matches
      }
    }

    const total = Object.values(scores).reduce((a, b) => a + b, 0)
    const sorted = Object.entries(scores).sort((a, b) => b[1] - a[1])
    return {
      direction: total > 0 ? sorted[0][0] : null,
      strength: total > 0 ? sorted[0][1] / total : 0,
      scores,
    }
  } catch (e) {
    return { direction: null, strength: 0, scores: { north: 0, east: 0, south: 0, west: 0 }, error: e.message }
  }
}
```

**Step 3: Add computeLeverageScore**

Add after `computeCompassDirection`:

```js
function computeLeverageScore(priority, ctx) {
  let score = 0

  // +5 if matches today's /start focus
  const focus = ctx.dailyFocus || []
  for (const f of focus) {
    const fLow = f.toLowerCase()
    if (priority.label && fLow.includes(priority.label.toLowerCase().slice(0, 20))) { score += 5; break }
    if (priority._raw?.person && fLow.includes(priority._raw.person.toLowerCase())) { score += 5; break }
    if (priority._raw?.topic && fLow.includes(priority._raw.topic.toLowerCase().slice(0, 20))) { score += 5; break }
  }

  // +3 if in the weakest triad leg
  if (priority.leg && priority.leg === ctx.weakestLeg) score += 3

  // Urgency
  if (priority.urgency === 'critical' || priority.urgency === 'urgent') score += 2
  else score += 1

  // +1 if compass-aligned
  if (priority.direction && priority.direction === ctx.compassDirection) score += 1

  return score
}

function computeWeakestLeg(signals) {
  // signals: array of 9 colors
  const score = (c) => c === 'green' ? 2 : c === 'yellow' ? 1 : 0
  const a = (signals[0] && signals[1] && signals[2]) ? score(signals[0]) + score(signals[1]) + score(signals[2]) : 6
  const c = (signals[3] && signals[4] && signals[5]) ? score(signals[3]) + score(signals[4]) + score(signals[5]) : 6
  const e = (signals[6] && signals[7] && signals[8]) ? score(signals[6]) + score(signals[7]) + score(signals[8]) : 6
  if (a <= c && a <= e) return 'authority'
  if (c <= e) return 'capacity'
  return 'expansion'
}
```

**Step 4: Update exports**

Update the existing `module.exports`:

```js
module.exports = {
  parseSignalDetails,                    // existing
  computeCompassDirection,                // NEW
  computeLeverageScore,                   // NEW
  computeWeakestLeg,                      // NEW
}
```

**Step 5: Verify**

```bash
cd ace-desktop && node -e "
const s = require('./src/synthesizer.js');
const r = require('./src/vault-reader.js');
const v = '/Users/nikhilkale/Documents/Actualize';
const dca = r.parseDCAFrontmatter(v);
console.log('Compass:', s.computeCompassDirection(v, dca.compass_directions));
console.log('Weakest:', s.computeWeakestLeg(['green','green','green','green','yellow','green','green','green','yellow']));
console.log('Leverage:', s.computeLeverageScore(
  { label: 'ACE Masterclass copy', leg: 'authority', urgency: 'urgent', direction: 'east' },
  { dailyFocus: ['ship the ACE Masterclass copy'], weakestLeg: 'capacity', compassDirection: 'east' }
));
"
```

Expected:
- Compass returns `{ direction: 'east' | 'north' | ... | null, strength: 0–1, scores: {...} }`
- Weakest returns `'capacity'` for the example signals
- Leverage returns `8` (5 for focus match + 2 for urgent + 1 for compass)

**Step 6: Commit**

```bash
git add ace-desktop/src/synthesizer.js
git commit -m "feat(synthesizer): add compass direction, leverage scoring, weakest leg computation"
```

---

## Phase 2 — Renderer Wiring

### Task 8: Update widget registry contract with zone field

**Files:**
- Modify: `renderer/widgets/registry.js`

**Step 1: Add zone field to registry export**

Modify the file. The current export is a flat array. Add zones by wrapping each widget's existing definition. Since each widget defines itself in its own file with no zone metadata, we add zones in the registry layer:

```js
// renderer/widgets/registry.js
import synthesis    from './synthesis.js'
import identity     from './identity.js'
import metrics      from './metrics.js'
import rhythm       from './rhythm.js'
import velocity     from './velocity.js'
import state        from './state.js'
import outcomes     from './outcomes.js'
import targets      from './targets.js'
import pipeline     from './pipeline.js'
import followups    from './followups.js'
import quickactions from './quickactions.js'
import astro        from './astro.js'

// Existing widgets — kept for backward compat, most disabled by default for cockpit
export const WIDGETS = [
  synthesis, identity, astro, metrics, rhythm, velocity,
  state, outcomes, targets, pipeline, followups, quickactions,
]

// Zone assignment for cockpit layout
// 'cockpit-*' = sacred ACE framework zones (fixed order, framework-defined)
// 'dock' = operator-extensible zone
// 'legacy' = old widgets disabled by default
export const WIDGET_ZONES = {
  // cockpit zones (will be populated as new widgets are added in subsequent tasks)
  synthesis:    'cockpit-brain',
  velocity:     'cockpit-flow',
  rhythm:       'cockpit-flow',
  astro:        'cockpit-flow',

  // legacy — disabled by default in cockpit mode
  identity:     'legacy',
  metrics:      'legacy',
  state:        'legacy',
  outcomes:     'legacy',
  targets:      'legacy',
  pipeline:     'legacy',
  followups:    'legacy',
  quickactions: 'legacy',
}

// New default — cockpit-active widgets enabled, legacy disabled
export const DEFAULT_LAYOUT = WIDGETS.map(w => ({
  id: w.id,
  enabled: WIDGET_ZONES[w.id] !== 'legacy',
}))
```

**Step 2: Verify app still launches**

```bash
cd ace-desktop && npm start
```

Existing dashboard should look mostly the same except identity/metrics/state/outcomes/targets/pipeline/followups/quickactions widgets are no longer rendered (their containers exist in HTML but receive empty content). Synthesis, velocity, rhythm, astro still appear. Triad column header dots still appear. Check console for errors. Quit.

**Step 3: Commit**

```bash
git add ace-desktop/renderer/widgets/registry.js
git commit -m "refactor(widgets): add zone field, default-disable legacy widgets for cockpit"
```

---

### Task 9: Update dashboard.js to fetch new data sources

**Files:**
- Modify: `renderer/dashboard.js`

**Step 1: Add new data sources to the fetch bundle**

Find the `sourceMap` block (around line 25). Add new sources:

```js
const sourceMap = {
  getState:        () => window.ace.dash.getState(),
  getPipeline:     () => window.ace.dash.getPipeline(),
  getFollowUps:    () => window.ace.dash.getFollowUps(),
  getMetrics:      () => window.ace.dash.getMetrics(),
  getVelocity:     () => window.ace.dash.getVelocity(),
  getRhythm:       () => window.ace.dash.getRhythm(),
  getNorthStar:    () => window.ace.dash.getNorthStar(),       // NEW
  getDailyFocus:   () => window.ace.dash.getDailyFocus(),      // NEW
  getBuildBlocks:  () => window.ace.dash.getBuildBlocks(),     // NEW
}
if (typeof window.ace.dash.getPatterns === 'function') {
  sourceMap.getPatterns = () => window.ace.dash.getPatterns()
}
```

**Step 2: Bundle new data into allData**

Find the `allData` bundle assembly (around line 59). Add new keys:

```js
const allData = {
  state:     data.getState,
  metrics:   data.getMetrics,
  pipeline:  data.getPipeline,
  followUps: data.getFollowUps,
  velocity:  data.getVelocity,
  rhythm:    data.getRhythm,
  patterns:  data.getPatterns,
  northStar:    data.getNorthStar,      // NEW
  dailyFocus:   data.getDailyFocus,     // NEW
  buildBlocks:  data.getBuildBlocks,    // NEW
}
```

**Step 3: Always fetch northStar + dailyFocus + buildBlocks for composite widgets**

After the existing "always fetch velocity" block (around line 56), add:

```js
if (!data.getNorthStar)   data.getNorthStar   = await window.ace.dash.getNorthStar()
if (!data.getDailyFocus)  data.getDailyFocus  = await window.ace.dash.getDailyFocus()
if (!data.getBuildBlocks) data.getBuildBlocks = await window.ace.dash.getBuildBlocks()
```

**Step 4: Verify**

Launch app, open DevTools, set a breakpoint or just `console.log(allData)` temporarily inside `loadDashboard()`. Expected: `allData.northStar`, `allData.dailyFocus`, `allData.buildBlocks` all populated. Remove the debug log. Quit.

**Step 5: Commit**

```bash
git add ace-desktop/renderer/dashboard.js
git commit -m "feat(dashboard): fetch northStar, dailyFocus, buildBlocks for composite widgets"
```

---

## Phase 3 — Cockpit Widgets (Build Order: Outside → In)

### Task 10: Build North Star widget

**Files:**
- Create: `renderer/widgets/northstar.js`
- Modify: `renderer/index.html` (add container before existing widget-synthesis)
- Modify: `renderer/widgets/registry.js` (import + zone)
- Modify: `renderer/styles/views/home.css` (add cockpit-northstar styles)

**Step 1: Create the widget file**

Create `renderer/widgets/northstar.js`:

```js
// renderer/widgets/northstar.js
// North Star bar — anchors + journey constellation + alignment
import { escapeHtml } from '../modules/chat-renderer.js'

export default {
  id: 'northstar',
  label: 'North Star',
  description: 'DCA anchors, journey progress, directional alignment',
  dataSource: null,           // composite — receives allData
  defaultEnabled: true,

  render(allData, el) {
    const ns = allData.northStar || {}
    const anchors = ns.north_star_anchors || []
    const daysElapsed = ns.daysElapsed
    const daysTotal = ns.daysTotal
    const gateDate = ns.gate_date

    // Empty state if no anchors configured
    if (anchors.length === 0) {
      el.innerHTML = `
        <div class="cockpit-northstar empty">
          <div class="ns-empty-text">Set your North Star in <span class="ns-link" data-action="open-dca">00-System/core/dca.md</span></div>
        </div>`
      el.querySelector('[data-action="open-dca"]')?.addEventListener('click', () => {
        document.querySelector('.nav-item[data-view="vault"]')?.click()
      })
      return
    }

    // Alignment from /pulse — read from system-metrics.md alignment field if available
    // For v1 we hardcode "on course" if no signal data, derive from pulse output later
    const alignment = this._deriveAlignment(allData)

    // Render anchors line
    const anchorsHtml = anchors.map(a => escapeHtml(a)).join('<span class="ns-sep">·</span>')

    // Render meta line
    const gateLabel = gateDate ? new Date(gateDate).toLocaleDateString('en-US', { year: 'numeric', month: 'short', day: 'numeric' }) : 'No gate set'
    const dayCount = (daysElapsed != null && daysTotal) ? `Day ${daysElapsed} / ${daysTotal}` : ''
    const arrowChar = alignment === 'on_course' ? '↑' : alignment === 'drifting' ? '→' : '↓'
    const alignLabel = alignment === 'on_course' ? 'on course' : alignment === 'drifting' ? 'drifting' : 'misaligned'

    // Render constellation (100 dots, scaled from daysElapsed/daysTotal)
    let constellationHtml = ''
    if (daysElapsed != null && daysTotal) {
      const total = 100
      const completed = Math.round((daysElapsed / daysTotal) * total)
      for (let i = 0; i < total; i++) {
        let cls = 'ns-star'
        if (i < completed - 1) cls += ' completed'
        else if (i === completed - 1) cls += ' current'
        constellationHtml += `<div class="${cls}"></div>`
      }
    }

    el.innerHTML = `
      <div class="cockpit-northstar">
        <div class="ns-orient">You are here</div>
        <div class="ns-anchors">${anchorsHtml}</div>
        <div class="ns-meta">
          ${escapeHtml(gateLabel)} <span class="ns-arrow">${arrowChar}</span> ${alignLabel} <span class="ns-arrow">·</span> ${escapeHtml(dayCount)}
        </div>
        <div class="ns-constellation">${constellationHtml}</div>
      </div>`
  },

  _deriveAlignment(allData) {
    // v1: pulse alignment isn't persisted; default to "on course" if signals exist
    // v2: read from system-metrics.md "Alignment:" field after /pulse adds it
    const signals = allData.metrics?._signals || []
    const greens = signals.filter(s => s === 'green').length
    if (greens >= 6) return 'on_course'
    if (greens >= 3) return 'drifting'
    return 'misaligned'
  },
}
```

**Step 2: Add container in index.html**

Find the `.vbody` block (around line 293). Add the northstar container as the FIRST element inside `.vbody` (before `home-time`):

```html
<div class="vbody">
  <!-- North Star bar — cockpit top -->
  <div id="widget-northstar"></div>

  <div class="home-time" id="home-time"></div>
  ... (rest unchanged)
```

**Step 3: Register the widget**

Modify `renderer/widgets/registry.js`:

```js
import northstar from './northstar.js'

// Add to WIDGETS array (at the start)
export const WIDGETS = [
  northstar, synthesis, identity, astro, metrics, rhythm, velocity,
  state, outcomes, targets, pipeline, followups, quickactions,
]

// Add to WIDGET_ZONES
export const WIDGET_ZONES = {
  northstar:    'cockpit-top',
  synthesis:    'cockpit-brain',
  ...
}
```

**Step 4: Add CSS to home.css**

Append to `renderer/styles/views/home.css` (copy from the prototype's North Star CSS, adapted to ACE token names):

```css
/* ── COCKPIT — North Star ────────────────────────────────────── */
.cockpit-northstar {
  text-align: center;
  padding: 8px 0 24px;
  border-bottom: 1px solid var(--border);
  margin-bottom: 24px;
}
.cockpit-northstar.empty { padding: 12px 0; opacity: 0.5; }
.ns-empty-text { font-family: 'DM Sans', sans-serif; font-size: 12px; color: var(--text-dim); }
.ns-link { color: var(--gold); cursor: pointer; }
.ns-link:hover { text-decoration: underline; }
.ns-orient {
  font-family: 'JetBrains Mono', monospace;
  font-size: 8px; letter-spacing: 0.3em; text-transform: uppercase;
  color: var(--text-dim); opacity: 0.6;
  margin-bottom: 14px;
}
.ns-anchors {
  font-family: 'Space Grotesk', sans-serif;
  font-size: 16px; font-weight: 300;
  letter-spacing: 0.04em;
  background: var(--gradient-accent);
  -webkit-background-clip: text;
  -webkit-text-fill-color: transparent;
  background-clip: text;
  margin-bottom: 12px;
  animation: ns-shimmer 15s ease-in-out infinite;
}
.ns-anchors .ns-sep {
  color: var(--gold-dim);
  margin: 0 12px;
  -webkit-text-fill-color: var(--gold-dim);
  opacity: 0.6;
}
@keyframes ns-shimmer {
  0%, 100% { filter: brightness(1) drop-shadow(0 0 12px var(--glow-accent)); }
  50%      { filter: brightness(1.15) drop-shadow(0 0 20px var(--glow-accent)); }
}
.ns-meta {
  font-family: 'JetBrains Mono', monospace;
  font-size: 9px; letter-spacing: 0.18em; text-transform: uppercase;
  color: var(--text-dim);
  margin-bottom: 14px;
}
.ns-arrow { color: var(--green); margin: 0 8px; }
.ns-constellation {
  display: flex; justify-content: center; gap: 4px; flex-wrap: wrap;
  max-width: 720px; margin: 0 auto; padding: 4px 0;
}
.ns-star {
  width: 3px; height: 3px; border-radius: 50%;
  background: var(--text-dim); opacity: 0.4;
  transition: all 0.4s ease;
}
.ns-star.completed { background: var(--gold); box-shadow: 0 0 4px var(--glow-accent); opacity: 1; }
.ns-star.current {
  background: var(--ark); width: 4px; height: 4px;
  box-shadow: 0 0 10px var(--ark);
  animation: ns-pulse 11s ease-in-out infinite;
}
@keyframes ns-pulse {
  0%, 100% { transform: scale(1); opacity: 1; }
  50%      { transform: scale(1.6); opacity: 0.85; }
}
```

**Step 5: Verify**

```bash
cd ace-desktop && npm start
```

Expected: North Star bar appears at top of home view. Anchors line shimmers. Meta line shows date + alignment + day count. Constellation appears as small dots (most gold/dim, one lavender pulsing). Quit.

**Step 6: Commit**

```bash
git add ace-desktop/renderer/widgets/northstar.js ace-desktop/renderer/widgets/registry.js ace-desktop/renderer/index.html ace-desktop/renderer/styles/views/home.css
git commit -m "feat(cockpit): add North Star widget with anchors, journey, constellation"
```

---

### Task 11: Build Compass widget (placed in brain layer beside synthesis)

**Files:**
- Create: `renderer/widgets/compass.js`
- Modify: `renderer/index.html`
- Modify: `renderer/widgets/registry.js`
- Modify: `renderer/styles/views/home.css`

**Step 1: Create the widget file**

Create `renderer/widgets/compass.js`:

```js
// renderer/widgets/compass.js
// Creative Compass — four DCA-anchored cardinal directions with weekly needle
import { escapeHtml } from '../modules/chat-renderer.js'

export default {
  id: 'compass',
  label: 'Creative Compass',
  description: 'DCA-anchored direction with weekly needle from execution log',
  dataSource: null,
  defaultEnabled: true,

  render(allData, el) {
    const ns = allData.northStar || {}
    const directions = ns.compass_directions || {}
    const compass = allData.compass || { direction: null, strength: 0 }

    // If no directions configured, skip rendering
    if (!directions.north) {
      el.innerHTML = ''
      return
    }

    const angle = this._dirAngle(compass.direction)

    el.innerHTML = `
      <div class="cockpit-compass">
        <div class="cmp-rose"></div>
        <div class="cmp-cross"></div>
        <div class="cmp-needle" style="transform: translate(-50%, -100%) rotate(${angle}deg)"></div>
        <div class="cmp-center" data-action="open-dca"></div>
        ${['north','east','south','west'].map(dir => `
          <div class="cmp-dir cmp-${dir} ${compass.direction === dir ? 'active' : ''}" data-dir="${dir}">
            <span class="cmp-letter">${dir[0].toUpperCase()}</span>
            <span class="cmp-label">${escapeHtml(directions[dir]?.label || '')}</span>
          </div>
        `).join('')}
      </div>`

    // Click center → open DCA file in vault editor
    el.querySelector('[data-action="open-dca"]')?.addEventListener('click', () => {
      document.querySelector('.nav-item[data-view="vault"]')?.click()
    })

    // Click direction → log evidence (v2 will drill in)
    el.querySelectorAll('.cmp-dir').forEach(d => {
      d.addEventListener('click', () => {
        const dir = d.dataset.dir
        const label = directions[dir]?.label || dir
        console.log(`Compass direction: ${dir} — ${label}`)
      })
    })
  },

  _dirAngle(dir) {
    // Needle angle: 0° = pointing up (north), 90° = right (east), etc.
    // Account for "no signal yet" → point up gently
    if (dir === 'north') return 0
    if (dir === 'east')  return 90
    if (dir === 'south') return 180
    if (dir === 'west')  return 270
    return 45 // no direction yet — point northeast as ambient
  },
}
```

**Step 2: Add container in index.html**

The compass needs to live beside the synthesis widget in the brain layer. Modify the existing layout. Find `<div id="widget-synthesis"></div>` (around line 298) and wrap it:

```html
<!-- Brain layer: orb (in synthesis) + synthesis line + compass -->
<div class="cockpit-brain-row">
  <div id="widget-synthesis" class="cb-synthesis"></div>
  <div id="widget-compass" class="cb-compass"></div>
</div>
```

The synthesis widget already includes the orb. We'll restructure synthesis in a later task to split orb/synthesis/compass into 3 columns. For now, compass renders to the right.

**Step 3: Register the widget**

Modify `renderer/widgets/registry.js`:

```js
import compass from './compass.js'

export const WIDGETS = [
  northstar, synthesis, compass, identity, astro, metrics, rhythm, velocity,
  state, outcomes, targets, pipeline, followups, quickactions,
]

export const WIDGET_ZONES = {
  northstar: 'cockpit-top',
  synthesis: 'cockpit-brain',
  compass:   'cockpit-brain',
  // ...
}
```

**Step 4: Add compass to dashboard.js fetch + bundle compass result**

Modify `renderer/dashboard.js`. The compass widget needs computed `allData.compass`. Since `synthesizer.js`'s `computeCompassDirection` runs in main process and IPC isn't strictly needed for it (it could run in renderer if we expose vault read), the cleanest path is to add a compass computation result via a new IPC handler.

Actually simpler: add `GET_COMPASS` IPC channel + handler that calls the synthesizer. Add to:

`src/ipc-channels.js`:
```js
GET_COMPASS: 'get-compass',
```

`main.js` (after other dashboard handlers):
```js
ipcMain.handle(ch.GET_COMPASS, () => {
  try {
    const reader = require('./src/vault-reader')
    const synth = require('./src/synthesizer')
    const dca = reader.parseDCAFrontmatter(global.VAULT_PATH)
    return synth.computeCompassDirection(global.VAULT_PATH, dca.compass_directions)
  } catch (e) { return { direction: null, strength: 0, error: e.message } }
})
```

`preload.js` dash block:
```js
getCompass: () => ipcRenderer.invoke(ch.GET_COMPASS),
```

`renderer/dashboard.js` sourceMap:
```js
getCompass: () => window.ace.dash.getCompass(),
```

And in allData bundle:
```js
compass: data.getCompass,
```

And always-fetch:
```js
if (!data.getCompass) data.getCompass = await window.ace.dash.getCompass()
```

**Step 5: Add CSS for compass + brain row layout**

Append to `renderer/styles/views/home.css`:

```css
/* ── COCKPIT — Brain Row layout (synthesis + compass side by side) ── */
.cockpit-brain-row {
  display: grid;
  grid-template-columns: 1fr 240px;
  gap: 24px;
  align-items: center;
  margin-bottom: 24px;
}
@media (max-width: 1100px) {
  .cockpit-brain-row { grid-template-columns: 1fr; }
}

/* ── COCKPIT — Compass ───────────────────────────────────────── */
.cockpit-compass {
  position: relative;
  width: 220px; height: 220px;
  margin: 0 auto;
}
.cmp-rose {
  position: absolute; inset: 8px;
  border: 1px solid var(--border-hover);
  border-radius: 50%;
  background: radial-gradient(circle at center, rgba(200,160,240,0.04) 0%, transparent 70%);
}
.cmp-rose::before {
  content: ''; position: absolute; inset: 30px;
  border: 1px dashed var(--border); border-radius: 50%;
}
.cmp-cross::before, .cmp-cross::after {
  content: ''; position: absolute;
  background: linear-gradient(to right, transparent, rgba(140,120,255,0.12) 50%, transparent);
}
.cmp-cross::before { left: 8px; right: 8px; top: 50%; height: 1px; transform: translateY(-50%); }
.cmp-cross::after  { top: 8px; bottom: 8px; left: 50%; width: 1px; transform: translateX(-50%);
  background: linear-gradient(to bottom, transparent, rgba(140,120,255,0.12) 50%, transparent); }
.cmp-needle {
  position: absolute; top: 50%; left: 50%;
  width: 2px; height: 88px;
  background: linear-gradient(to top, transparent, rgba(200,160,240,0.6) 30%, var(--gold));
  transform-origin: bottom center;
  box-shadow: 0 0 10px var(--glow-accent);
  z-index: 2;
  transition: transform 1.5s ease;
}
.cmp-needle::after {
  content: ''; position: absolute; top: -3px; left: 50%; transform: translateX(-50%);
  width: 6px; height: 6px; background: var(--gold); border-radius: 50%;
  box-shadow: 0 0 12px var(--gold);
}
.cmp-center {
  position: absolute; top: 50%; left: 50%;
  width: 12px; height: 12px; border-radius: 50%;
  background: radial-gradient(circle at 35% 35%, #c8b8ff, #7060e0);
  transform: translate(-50%, -50%);
  box-shadow: 0 0 14px rgba(140,120,255,0.7);
  z-index: 3; cursor: pointer;
  animation: cmp-breathe 2.5s ease-in-out infinite;
}
@keyframes cmp-breathe {
  0%, 100% { transform: translate(-50%, -50%) scale(1); }
  50%      { transform: translate(-50%, -50%) scale(1.25); }
}
.cmp-dir {
  position: absolute; text-align: center; cursor: default;
  font-family: 'JetBrains Mono', monospace;
  font-size: 7px; letter-spacing: 0.2em; text-transform: uppercase;
}
.cmp-dir .cmp-letter {
  display: block;
  font-family: 'Space Grotesk', sans-serif;
  font-size: 13px; color: var(--text-secondary);
  margin-bottom: 2px; letter-spacing: 0.1em;
}
.cmp-dir .cmp-label {
  display: block; font-size: 7px; color: var(--text-dim); max-width: 90px;
}
.cmp-dir.active .cmp-letter { color: var(--gold); text-shadow: 0 0 14px var(--glow-accent); }
.cmp-north { top: -10px; left: 50%; transform: translateX(-50%); }
.cmp-east  { right: -34px; top: 50%; transform: translateY(-50%); }
.cmp-south { bottom: -10px; left: 50%; transform: translateX(-50%); }
.cmp-west  { left: -34px; top: 50%; transform: translateY(-50%); }
```

**Step 6: Verify**

```bash
cd ace-desktop && npm start
```

Expected: Compass appears to the right of the synthesis widget. Needle points to a direction (likely north or east based on this week's execution log content). Center pin breathes. Direction labels show. Click center → opens vault view. Quit.

**Step 7: Commit**

```bash
git add ace-desktop/renderer/widgets/compass.js ace-desktop/renderer/widgets/registry.js ace-desktop/renderer/index.html ace-desktop/renderer/styles/views/home.css ace-desktop/src/ipc-channels.js ace-desktop/main.js ace-desktop/preload.js ace-desktop/renderer/dashboard.js
git commit -m "feat(cockpit): add Creative Compass widget with weekly needle from execution log"
```

---

### Task 12: Build Triad Leg widget (composite — signal decode + action card with rise)

**Files:**
- Create: `renderer/widgets/triad-leg.js`
- Modify: `renderer/index.html`
- Modify: `renderer/widgets/registry.js`
- Modify: `renderer/styles/views/home.css`

**Step 1: Create the widget**

Create `renderer/widgets/triad-leg.js` (this is the largest new widget — it handles all three legs via factory):

```js
// renderer/widgets/triad-leg.js
// Triad leg widget — signal decode + action card with rising/leverage logic
// One factory creates three exports: triad-authority, triad-capacity, triad-expansion
import { escapeHtml } from '../modules/chat-renderer.js'

const SIGNAL_NAMES = {
  A1: 'Truth', A2: 'Choice', A3: 'Expression',
  C1: 'Regulation', C2: 'Depth', C3: 'Resilience',
  E1: 'Rhythm', E2: 'Containers', E3: 'Realization',
}

const LEG_CONFIG = {
  authority: {
    name: 'Authority',
    subtitle: 'authoring',
    signalKeys: ['A1', 'A2', 'A3'],
    signalIndices: [0, 1, 2],
  },
  capacity: {
    name: 'Capacity',
    subtitle: 'holding',
    signalKeys: ['C1', 'C2', 'C3'],
    signalIndices: [3, 4, 5],
  },
  expansion: {
    name: 'Expansion',
    subtitle: 'growing',
    signalKeys: ['E1', 'E2', 'E3'],
    signalIndices: [6, 7, 8],
  },
}

function makeWidget(leg) {
  return {
    id: `triad-${leg}`,
    label: `Triad — ${LEG_CONFIG[leg].name}`,
    description: `${LEG_CONFIG[leg].name} signal decode + highest-leverage action`,
    dataSource: null,
    defaultEnabled: true,
    leg,

    render(allData, el) {
      const config = LEG_CONFIG[leg]
      const signals = allData.metrics?._signals || Array(9).fill('dim')
      const legSignals = config.signalIndices.map(i => signals[i] || 'dim')
      const legScore = legSignals.filter(s => s === 'green').length

      const candidates = this._buildCandidates(allData, leg)
      const top = candidates[0] || null
      const isRisen = allData._risenLeg === leg

      el.innerHTML = `
        <div class="triad-leg ${leg} ${isRisen ? 'risen-leg' : ''}">
          <div class="leg-header">
            <div class="leg-name" title="${this._legHint(leg)}">${config.name}<span class="arrow">↗</span></div>
            <div class="leg-score">${legScore} / 3</div>
          </div>
          <div class="leg-subtitle">${escapeHtml(config.subtitle)}</div>

          <div class="signal-decode">
            ${config.signalKeys.map((key, i) => {
              const color = legSignals[i]
              const status = { green: 'Green', yellow: 'Yellow', red: 'Red', dim: '—' }[color]
              return `
                <div class="signal-row" data-signal="${key}">
                  <div class="dot ${color}"></div>
                  <span class="key">${key}</span>
                  <span class="name">${SIGNAL_NAMES[key]}</span>
                  <span class="status ${color}">${status}</span>
                </div>`
            }).join('')}
          </div>

          ${this._renderActionCard(top, isRisen)}
        </div>`

      this._wire(el, top, allData)
    },

    _renderActionCard(item, isRisen) {
      if (!item) {
        const empty = this._emptyState()
        return `<div class="action-card empty"><div class="empty-text">${escapeHtml(empty)}</div></div>`
      }
      const typeLabel = this._typeLabel(item.type)
      const risenClass = isRisen ? 'risen' : ''
      return `
        <div class="action-card ${risenClass}" data-leverage="${item._leverage || 0}">
          <div class="header">
            <div class="urgency-dot ${item.urgency || 'normal'}"></div>
            <span class="label-tag">${escapeHtml(typeLabel)}</span>
          </div>
          <div class="move-label">${escapeHtml(item.label)}</div>
          <div class="move-context">${escapeHtml(item.context || '')}</div>
          <div class="card-actions-default">
            <span class="arrow">→ open</span>
          </div>
          <div class="card-actions-hover">
            <button class="card-btn done"  data-action="done"  title="Mark done">✓</button>
            <button class="card-btn open"  data-action="open"  title="Open">→</button>
            <button class="card-btn skip"  data-action="skip"  title="Skip today">⏭</button>
          </div>
        </div>`
    },

    _emptyState() {
      if (leg === 'authority')  return 'No outcomes pending'
      if (leg === 'capacity')   return 'Body steady. Relationships current.'
      return 'Run /weekly-review to anchor your direction.'
    },

    _legHint(leg) {
      if (leg === 'authority') return 'outcomes & gates'
      if (leg === 'capacity')  return 'body, nervous system, relationships'
      return 'targets, build blocks, growth edges'
    },

    _typeLabel(type) {
      const map = {
        outcome: 'Outcome', followup: 'Follow-up', target: 'Target',
        pipeline: 'Pipeline', cadence: 'Ritual', growth_edge: 'Growth Edge',
        regulation: 'Regulation', recovery: 'Recovery', hrv: 'Coherence',
        build_block: 'Build Block',
      }
      return map[type] || type
    },

    _buildCandidates(allData, leg) {
      // Read pre-built candidates from allData if dashboard.js computed them
      // Otherwise, fall back to building here (not implemented yet — Task 13 wires this)
      const all = allData._candidatesByLeg || {}
      return all[leg] || []
    },

    _wire(el, item, allData) {
      const card = el.querySelector('.action-card')
      if (!card || !item) return

      // Default click → open coaching session for this item
      card.addEventListener('click', (e) => {
        // If clicking a hover button, let its handler run
        if (e.target.closest('.card-btn')) return
        this._openCoachingSession(item, allData)
      })

      // Hover buttons
      card.querySelector('[data-action="done"]')?.addEventListener('click', async (e) => {
        e.stopPropagation()
        const result = await window.ace.dash.markDone(item)
        if (result?.error) console.error('Mark done failed:', result.error)
        // Trigger dashboard refresh
        window.dispatchEvent(new CustomEvent('cockpit-refresh'))
      })

      card.querySelector('[data-action="open"]')?.addEventListener('click', (e) => {
        e.stopPropagation()
        this._openCoachingSession(item, allData)
      })

      card.querySelector('[data-action="skip"]')?.addEventListener('click', (e) => {
        e.stopPropagation()
        const dismissed = JSON.parse(localStorage.getItem('cockpit-dismissed') || '[]')
        dismissed.push({ label: item.label, date: new Date().toISOString().slice(0, 10) })
        localStorage.setItem('cockpit-dismissed', JSON.stringify(dismissed))
        window.dispatchEvent(new CustomEvent('cockpit-refresh'))
      })

      // Signal row clicks → coaching session for that signal (existing pattern)
      el.querySelectorAll('.signal-row').forEach(row => {
        row.addEventListener('click', () => {
          const key = row.dataset.signal
          const name = SIGNAL_NAMES[key]
          this._openSignalCoaching(key, name, leg)
        })
      })
    },

    _openCoachingSession(item, allData) {
      // Reuse the pattern from synthesis.js — open terminal view + spawn session + send prompt
      document.querySelector('.nav-item[data-view="terminal"]').click()
      setTimeout(() => {
        if (window.spawnSession) window.spawnSession()
        setTimeout(() => {
          const st = window.__aceState
          if (st?.activeId && st?.sessions) {
            if (window.sendChatMessage) {
              const prompt = item.prompt || `Help me with: ${item.label}. Context: ${item.context || ''}`
              window.sendChatMessage(st.activeId, prompt)
            }
          }
        }, 200)
      }, 150)
    },

    _openSignalCoaching(key, name, leg) {
      document.querySelector('.nav-item[data-view="terminal"]').click()
      setTimeout(() => {
        if (window.spawnSession) window.spawnSession()
        setTimeout(() => {
          const st = window.__aceState
          if (st?.activeId && window.sendChatMessage) {
            const prompt = `My ${key} signal (${name}, under ${leg}) is currently surfacing for review. Help me understand what's driving this signal and what I can do to strengthen it. Reference the ACE Coherence Triad — ${leg} leg.`
            window.sendChatMessage(st.activeId, prompt)
          }
        }, 200)
      }, 150)
    },
  }
}

export const triadAuthority = makeWidget('authority')
export const triadCapacity  = makeWidget('capacity')
export const triadExpansion = makeWidget('expansion')

export default triadAuthority // for import compatibility
```

**Step 2: Add three containers in index.html**

Replace the existing `.triad-grid` block (around lines 316-340) with:

```html
<!-- Triad deck -->
<div class="cockpit-triad-deck">
  <div id="widget-triad-authority"></div>
  <div id="widget-triad-capacity"></div>
  <div id="widget-triad-expansion"></div>
  <div class="begin-whisper" id="begin-whisper"></div>
</div>
```

**Step 3: Register all three in registry.js**

```js
import { triadAuthority, triadCapacity, triadExpansion } from './triad-leg.js'

export const WIDGETS = [
  northstar, synthesis, compass,
  triadAuthority, triadCapacity, triadExpansion,
  identity, astro, metrics, rhythm, velocity,
  state, outcomes, targets, pipeline, followups, quickactions,
]

export const WIDGET_ZONES = {
  northstar:        'cockpit-top',
  synthesis:        'cockpit-brain',
  compass:          'cockpit-brain',
  'triad-authority':'cockpit-triad',
  'triad-capacity': 'cockpit-triad',
  'triad-expansion':'cockpit-triad',
  velocity:         'cockpit-flow',
  rhythm:           'cockpit-flow',
  astro:            'cockpit-flow',
  identity:         'legacy',
  metrics:          'legacy',
  state:            'legacy',
  outcomes:         'legacy',
  targets:          'legacy',
  pipeline:         'legacy',
  followups:        'legacy',
  quickactions:     'legacy',
}
```

**Step 4: Add CSS for triad deck + cards**

Append to `renderer/styles/views/home.css` (large block — derived from prototype-v2):

```css
/* ── COCKPIT — Triad Deck ─────────────────────────────────────────── */
.cockpit-triad-deck {
  display: grid;
  grid-template-columns: 1fr 1fr 1fr;
  gap: 16px;
  margin-bottom: 24px;
  position: relative;
}
@media (max-width: 1100px) {
  .cockpit-triad-deck { grid-template-columns: 1fr; }
}

.cockpit-triad-deck .triad-leg {
  background: var(--glass-bg);
  border: 1px solid var(--border);
  border-top-width: 2px;
  border-radius: 10px;
  padding: 20px 22px 22px;
  backdrop-filter: var(--glass-blur);
  -webkit-backdrop-filter: var(--glass-blur);
  position: relative;
  overflow: hidden;
  transition: transform 0.3s ease, border-color 0.3s ease;
  animation: leg-breath 11s ease-in-out infinite;
}
.cockpit-triad-deck .triad-leg.authority  { border-top-color: var(--authority); animation-duration: 9s; }
.cockpit-triad-deck .triad-leg.capacity   { border-top-color: var(--capacity);  animation-duration: 14s; }
.cockpit-triad-deck .triad-leg.expansion  { border-top-color: var(--expansion); animation-duration: 11s; }
.cockpit-triad-deck .triad-leg:hover { border-color: var(--border-hover); transform: translateY(-2px); }

@keyframes leg-breath {
  0%, 100% { box-shadow: 0 0 0 rgba(140,120,255,0); }
  50%      { box-shadow: inset 0 0 24px rgba(140,120,255,0.04); }
}

.cockpit-triad-deck .leg-header {
  display: flex; justify-content: space-between; align-items: center;
  margin-bottom: 4px; padding-bottom: 10px;
  border-bottom: 1px solid var(--border);
}
.cockpit-triad-deck .leg-name {
  font-family: 'JetBrains Mono', monospace;
  font-size: 8px; font-weight: 500; letter-spacing: 0.22em; text-transform: uppercase;
  cursor: help;
}
.cockpit-triad-deck .triad-leg.authority .leg-name { color: var(--authority); }
.cockpit-triad-deck .triad-leg.capacity  .leg-name { color: var(--capacity); }
.cockpit-triad-deck .triad-leg.expansion .leg-name { color: var(--expansion); }
.cockpit-triad-deck .leg-name .arrow { margin-left: 6px; opacity: 0.7; }
.cockpit-triad-deck .leg-score {
  font-family: 'JetBrains Mono', monospace;
  font-size: 9px; color: var(--text-dim);
}
.cockpit-triad-deck .leg-subtitle {
  font-family: 'Cormorant Garamond', Georgia, serif;
  font-size: 13px; font-style: italic;
  color: var(--text-secondary);
  margin: 12px 0 16px;
  opacity: 0.7;
  text-align: center;
}

.cockpit-triad-deck .signal-decode {
  margin-bottom: 18px; padding-bottom: 16px;
  border-bottom: 1px solid var(--border);
}
.cockpit-triad-deck .signal-row {
  display: grid;
  grid-template-columns: 14px 28px 1fr auto;
  align-items: center; gap: 10px;
  padding: 5px 0; cursor: pointer;
  border-radius: 4px;
  transition: background 0.2s ease;
}
.cockpit-triad-deck .signal-row:hover {
  background: rgba(140,120,255,0.04);
  margin: 0 -8px;
  padding: 5px 8px;
}
.cockpit-triad-deck .signal-row .dot {
  width: 7px; height: 7px; border-radius: 50%;
  background: var(--text-dim);
}
.cockpit-triad-deck .signal-row .dot.green   { background: var(--green); box-shadow: 0 0 6px rgba(96,216,168,0.5); }
.cockpit-triad-deck .signal-row .dot.yellow  { background: var(--gold);  box-shadow: 0 0 6px rgba(212,165,116,0.5); }
.cockpit-triad-deck .signal-row .dot.red     { background: var(--red);   box-shadow: 0 0 6px rgba(224,112,128,0.5); }
.cockpit-triad-deck .signal-row .key {
  font-family: 'JetBrains Mono', monospace;
  font-size: 9px; color: var(--text-dim); letter-spacing: 0.05em;
}
.cockpit-triad-deck .signal-row .name {
  font-family: 'Space Grotesk', sans-serif;
  font-size: 12px; color: var(--text-primary);
}
.cockpit-triad-deck .signal-row .status {
  font-family: 'JetBrains Mono', monospace;
  font-size: 7.5px; letter-spacing: 0.2em; color: var(--text-dim);
  text-transform: uppercase;
}
.cockpit-triad-deck .signal-row .status.green  { color: var(--green); }
.cockpit-triad-deck .signal-row .status.yellow { color: var(--gold); }
.cockpit-triad-deck .signal-row .status.red    { color: var(--red); }

/* Action card */
.cockpit-triad-deck .action-card {
  position: relative;
  background: linear-gradient(to top, rgba(140,120,255,0.06), transparent 80%);
  border: 1px solid rgba(140,120,255,0.15);
  border-radius: 8px;
  padding: 14px 16px;
  cursor: pointer;
  transition: all 0.3s ease;
}
.cockpit-triad-deck .action-card:hover {
  background: linear-gradient(to top, rgba(140,120,255,0.12), rgba(140,120,255,0.03));
  border-color: rgba(140,120,255,0.3);
  transform: translateY(-1px);
}
.cockpit-triad-deck .action-card.empty {
  background: transparent; border-style: dashed;
  cursor: default; padding: 18px 16px; text-align: center;
}
.cockpit-triad-deck .action-card.empty:hover { transform: none; }
.cockpit-triad-deck .empty-text {
  font-family: 'Cormorant Garamond', Georgia, serif;
  font-style: italic; font-size: 12px;
  color: var(--text-dim);
}
.cockpit-triad-deck .action-card .header {
  display: flex; align-items: center; gap: 8px; margin-bottom: 8px;
}
.cockpit-triad-deck .urgency-dot {
  width: 6px; height: 6px; border-radius: 50%;
  background: var(--gold); box-shadow: 0 0 6px rgba(212,165,116,0.6);
  animation: urgency-pulse 8s ease-in-out infinite;
}
.cockpit-triad-deck .urgency-dot.critical {
  background: var(--red); box-shadow: 0 0 8px rgba(224,112,128,0.7);
}
.cockpit-triad-deck .urgency-dot.normal {
  background: var(--green); box-shadow: 0 0 6px rgba(96,216,168,0.5);
}
@keyframes urgency-pulse {
  0%, 100% { opacity: 0.85; }
  50%      { opacity: 1; transform: scale(1.15); }
}
.cockpit-triad-deck .label-tag {
  font-family: 'JetBrains Mono', monospace;
  font-size: 7.5px; letter-spacing: 0.22em; text-transform: uppercase;
  color: var(--gold);
}
.cockpit-triad-deck .move-label {
  font-family: 'Space Grotesk', sans-serif;
  font-size: 13px; color: var(--text-primary);
  margin-bottom: 4px; line-height: 1.35;
}
.cockpit-triad-deck .move-context {
  font-family: 'JetBrains Mono', monospace;
  font-size: 9px; color: var(--text-dim);
  margin-bottom: 12px; letter-spacing: 0.05em;
}
.cockpit-triad-deck .card-actions-default { display: block; }
.cockpit-triad-deck .card-actions-hover {
  display: flex; gap: 8px; opacity: 0; pointer-events: none;
  position: absolute; bottom: 12px; right: 12px;
  transition: opacity 0.2s ease;
}
.cockpit-triad-deck .action-card:hover .card-actions-hover {
  opacity: 1; pointer-events: auto;
}
.cockpit-triad-deck .action-card:hover .card-actions-default {
  opacity: 0.3;
}
.cockpit-triad-deck .card-btn {
  background: rgba(20,24,40,0.6);
  border: 1px solid var(--border);
  color: var(--gold);
  width: 24px; height: 24px;
  border-radius: 4px;
  cursor: pointer;
  font-size: 11px;
  display: flex; align-items: center; justify-content: center;
  transition: all 0.2s ease;
}
.cockpit-triad-deck .card-btn:hover {
  border-color: var(--gold-dim);
  background: rgba(140,120,255,0.1);
}
.cockpit-triad-deck .arrow {
  font-family: 'JetBrains Mono', monospace;
  font-size: 9px; color: var(--gold);
  letter-spacing: 0.15em; opacity: 0.7;
}

/* ── RISEN card — gravity, not lightning ──────────────────────── */
.cockpit-triad-deck .action-card.risen {
  transform: translateY(-4px);
  border-color: rgba(200,160,240,0.45);
  background: linear-gradient(to top, rgba(200,160,240,0.14), rgba(200,160,240,0.04));
  box-shadow:
    0 0 24px rgba(200,160,240,0.28),
    0 0 48px rgba(200,160,240,0.12),
    inset 0 0 16px rgba(200,160,240,0.06);
  animation: risen-halo 5.5s ease-in-out infinite;
}
.cockpit-triad-deck .action-card.risen .move-label {
  color: var(--text-primary); font-weight: 500;
}
.cockpit-triad-deck .action-card.risen:hover {
  transform: translateY(-5px); border-color: rgba(200,160,240,0.6);
}
@keyframes risen-halo {
  0%, 100% {
    box-shadow: 0 0 24px rgba(200,160,240,0.28), 0 0 48px rgba(200,160,240,0.12), inset 0 0 16px rgba(200,160,240,0.06);
  }
  50% {
    box-shadow: 0 0 32px rgba(200,160,240,0.42), 0 0 64px rgba(200,160,240,0.22), inset 0 0 24px rgba(200,160,240,0.10);
  }
}
.cockpit-triad-deck .action-card.risen::after {
  content: ''; position: absolute; top: 10px; right: 12px;
  width: 6px; height: 6px; border-radius: 50%;
  background: var(--gold);
  box-shadow: 0 0 8px var(--gold), 0 0 16px var(--glow-accent);
  animation: focus-dot-breathe 5.5s ease-in-out infinite;
}
@keyframes focus-dot-breathe {
  0%, 100% { opacity: 0.7; transform: scale(1); }
  50%      { opacity: 1;   transform: scale(1.3); }
}

/* "Begin here" whisper */
.begin-whisper {
  position: absolute; top: -28px;
  font-family: 'Cormorant Garamond', Georgia, serif;
  font-size: 13px; font-style: italic;
  color: var(--gold);
  letter-spacing: 0.05em;
  opacity: 0; pointer-events: none;
  transition: opacity 1.2s ease, transform 1.2s ease;
  text-shadow: 0 0 12px var(--glow-accent);
  white-space: nowrap;
}
.begin-whisper.show { opacity: 0.9; transform: translateY(-2px); }
.begin-whisper.fade { opacity: 0; }
```

**Step 5: Verify**

```bash
cd ace-desktop && npm start
```

Expected: Three triad cards appear (Authority, Capacity, Expansion). Each shows leg name, score, italic subtitle, signal decode rows, and either an empty-state action card or actual action data. **No risen card yet** (Task 13 wires the candidates pipeline). Hover any card to see hover buttons fade in. Quit.

If cards appear empty (no actions), that's expected — Task 13 wires candidates.

**Step 6: Commit**

```bash
git add ace-desktop/renderer/widgets/triad-leg.js ace-desktop/renderer/widgets/registry.js ace-desktop/renderer/index.html ace-desktop/renderer/styles/views/home.css
git commit -m "feat(cockpit): add triad-leg widget for Authority/Capacity/Expansion cards"
```

---

### Task 13: Wire candidate building + leverage scoring + risen-leg selection

**Files:**
- Modify: `renderer/dashboard.js`

**Step 1: Add candidate-building logic to dashboard.js**

After the `allData` bundle assembly, before widget rendering, add:

```js
// ── Build candidate pools per leg + compute leverage + select risen ─────
const candidatesByLeg = buildCandidatesByLeg(allData)
const compassDir = allData.compass?.direction
const dailyFocus = allData.dailyFocus || []
const signals = allData.metrics?._signals || []
const weakestLeg = computeWeakestLeg(signals)

// Score every candidate
for (const leg of ['authority', 'capacity', 'expansion']) {
  for (const c of candidatesByLeg[leg]) {
    c._leverage = computeLeverageScore(c, { dailyFocus, weakestLeg, compassDirection: compassDir })
  }
  candidatesByLeg[leg].sort((a, b) => (b._leverage || 0) - (a._leverage || 0))
}

// Find risen leg — highest leverage across all leg-tops
let topScore = -1
let risenLeg = null
for (const leg of ['authority', 'capacity', 'expansion']) {
  const top = candidatesByLeg[leg][0]
  if (top && top._leverage > topScore) {
    topScore = top._leverage
    risenLeg = leg
  }
}

allData._candidatesByLeg = candidatesByLeg
allData._risenLeg = risenLeg
allData._weakestLeg = weakestLeg
```

**Step 2: Add the helper functions at the bottom of dashboard.js**

Below `loadDashboard()` and any existing helpers, add:

```js
// ─── Candidate builders per leg ──────────────────────────────────────────

function buildCandidatesByLeg(allData) {
  const dismissed = JSON.parse(localStorage.getItem('cockpit-dismissed') || '[]')
  const today = new Date().toISOString().slice(0, 10)
  const dismissedToday = new Set(
    dismissed.filter(d => d.date === today).map(d => d.label)
  )

  const filterDismissed = (arr) => arr.filter(c => !dismissedToday.has(c.label))

  return {
    authority: filterDismissed(buildAuthorityCandidates(allData)),
    capacity:  filterDismissed(buildCapacityCandidates(allData)),
    expansion: filterDismissed(buildExpansionCandidates(allData)),
  }
}

function buildAuthorityCandidates(allData) {
  const candidates = []
  const outcomes = allData.state?.outcomes || []
  const today = new Date()
  today.setHours(0, 0, 0, 0)

  for (const o of outcomes) {
    if (!o.title || /COMPLETE|CLOSED|ABSORBED/i.test(o.status || '')) continue
    const days = o.daysToGate
    let urgency = 'normal'
    if (days != null && days <= 0) urgency = 'critical'
    else if (days != null && days <= 3) urgency = 'urgent'
    else if (days != null && days <= 7) urgency = 'warning'
    if (/AT RISK|BLOCKED/i.test(o.status || '')) urgency = 'urgent'

    candidates.push({
      type: 'outcome',
      leg: 'authority',
      urgency,
      label: o.title,
      context: o.gateLabel ? `Gate ${o.gateLabel}${days != null ? ` · ${Math.abs(days)} days ${days < 0 ? 'past' : ''}` : ''}` : (o.status || ''),
      _raw: o,
    })
  }
  return candidates
}

function buildCapacityCandidates(allData) {
  const candidates = []
  const signals = allData.metrics?._signals || []
  const state = allData.state || {}
  const followUps = Array.isArray(allData.followUps) ? allData.followUps : []

  // 1. Regulation invitation (C1 yellow/red)
  const c1 = signals[3]
  if (c1 === 'yellow' || c1 === 'red') {
    candidates.push({
      type: 'regulation',
      leg: 'capacity',
      urgency: c1 === 'red' ? 'urgent' : 'warning',
      label: 'Regulation invitation',
      context: `C1 ${c1} · energy ${state.energy || 'unknown'}`,
      _raw: { signal: 'C1', color: c1 },
    })
  }

  // 2. Recovery protocol
  if (state.energy === 'depleted') {
    candidates.push({
      type: 'recovery',
      leg: 'capacity',
      urgency: 'critical',
      label: 'Recovery protocol',
      context: `Energy depleted · mode ${state.mode || 'unknown'}`,
      _raw: { energy: state.energy },
    })
  }

  // 3. Follow-ups (existing logic)
  const today = new Date()
  today.setHours(0, 0, 0, 0)
  const overdueFu = followUps.filter(f => {
    if (!f.due) return false
    const d = new Date(f.due)
    if (isNaN(d.getTime())) return false
    d.setHours(0, 0, 0, 0)
    return d < today && (f.status || '').toLowerCase() !== 'done'
  }).sort((a, b) => new Date(a.due) - new Date(b.due))

  for (const fu of overdueFu) {
    const daysOverdue = Math.round((today - new Date(fu.due)) / (1000 * 60 * 60 * 24))
    let urgency = 'normal'
    if (daysOverdue >= 15) urgency = 'critical'
    else if (daysOverdue >= 8) urgency = 'urgent'
    else if (daysOverdue >= 3) urgency = 'warning'

    candidates.push({
      type: 'followup',
      leg: 'capacity',
      urgency,
      label: `${fu.person} — ${(fu.topic || '').slice(0, 60)}`,
      context: `${daysOverdue} days overdue`,
      _raw: { person: fu.person, topic: fu.topic, due: fu.due },
    })
  }

  return candidates
}

function buildExpansionCandidates(allData) {
  const candidates = []
  const state = allData.state || {}
  const buildBlocks = allData.buildBlocks || []
  const patterns = allData.patterns || {}
  const signals = allData.metrics?._signals || []
  const pipeline = Array.isArray(allData.pipeline) ? allData.pipeline : []

  // 1. Weekly targets (unchecked)
  const targets = (state.weeklyTargets || []).filter(t => !t.checked)
  for (const t of targets) {
    candidates.push({
      type: 'target',
      leg: 'expansion',
      urgency: 'normal',
      label: t.text,
      context: 'This week',
      _raw: { text: t.text },
    })
  }

  // 2. BUILD blocks (next 24h)
  for (const b of buildBlocks) {
    candidates.push({
      type: 'build_block',
      leg: 'expansion',
      urgency: b.hoursUntil <= 2 ? 'urgent' : 'normal',
      label: b.title,
      context: `in ${b.hoursUntil}h · ${b.duration} min`,
      _raw: b,
    })
  }

  // 3. Cadence (day-of-week)
  const dow = new Date().getDay() // 0=Sun
  if (dow === 6) {
    candidates.push({
      type: 'cadence', leg: 'expansion', urgency: 'normal',
      label: 'Write list email', context: 'Saturday ritual',
      _raw: { ritual: 'list-email' },
    })
  }
  if (dow === 0) {
    candidates.push({
      type: 'cadence', leg: 'expansion', urgency: 'normal',
      label: 'Weekly review', context: 'Sunday ritual',
      _raw: { ritual: 'weekly-review' },
    })
  }

  // 4. Growth edges (from patterns or C2 signal)
  const c2 = signals[4]
  if (patterns.tensions?.length) {
    for (const t of patterns.tensions) {
      if (t.days < 3) continue
      candidates.push({
        type: 'growth_edge',
        leg: 'expansion',
        urgency: t.days >= 7 ? 'urgent' : 'warning',
        label: `Growth edge: ${t.label}`,
        context: `${t.days} days alive`,
        _raw: t,
      })
    }
  } else if (c2 === 'yellow' || c2 === 'red') {
    candidates.push({
      type: 'growth_edge',
      leg: 'expansion',
      urgency: c2 === 'red' ? 'urgent' : 'warning',
      label: 'Untouched edge',
      context: `Capacity → Depth ${c2}`,
      _raw: { signal: 'C2', color: c2 },
    })
  }

  // 5. Pipeline (personal — only if data exists)
  for (const deal of pipeline) {
    if (!deal.due_date) continue
    const due = new Date(deal.due_date)
    const today = new Date()
    today.setHours(0, 0, 0, 0)
    if (due >= today) continue
    candidates.push({
      type: 'pipeline',
      leg: 'expansion',
      urgency: 'urgent',
      label: `${deal.person} — ${(deal.next_action || '').slice(0, 60)}`,
      context: `Overdue · $${deal.amount}`,
      _raw: deal,
    })
  }

  return candidates
}

// Local scoring helpers — mirror src/synthesizer.js but inline for renderer
function computeWeakestLeg(signals) {
  const score = (c) => c === 'green' ? 2 : c === 'yellow' ? 1 : 0
  const a = signals[0] && signals[1] && signals[2] ? score(signals[0]) + score(signals[1]) + score(signals[2]) : 6
  const c = signals[3] && signals[4] && signals[5] ? score(signals[3]) + score(signals[4]) + score(signals[5]) : 6
  const e = signals[6] && signals[7] && signals[8] ? score(signals[6]) + score(signals[7]) + score(signals[8]) : 6
  if (a <= c && a <= e) return 'authority'
  if (c <= e) return 'capacity'
  return 'expansion'
}

function computeLeverageScore(item, ctx) {
  let score = 0
  const focus = ctx.dailyFocus || []
  for (const f of focus) {
    const fLow = (f || '').toLowerCase()
    if (item.label && fLow.includes(item.label.toLowerCase().slice(0, 20))) { score += 5; break }
    if (item._raw?.person && fLow.includes(item._raw.person.toLowerCase())) { score += 5; break }
  }
  if (item.leg && item.leg === ctx.weakestLeg) score += 3
  if (item.urgency === 'critical' || item.urgency === 'urgent') score += 2
  else score += 1
  return score
}
```

**Step 3: Wire cockpit-refresh event listener**

At the bottom of `loadDashboard()` or in module init, add:

```js
window.addEventListener('cockpit-refresh', () => {
  loadDashboard()
})
```

**Step 4: Verify**

```bash
cd ace-desktop && npm start
```

Expected:
- Authority card shows your top outcome (likely "ACE Masterclass 2 — final cohort copy" or similar)
- Capacity card shows highest-priority follow-up or somatic invitation
- Expansion card shows top weekly target, BUILD block, or growth edge
- **One card has the risen treatment** (gold halo, lifted, focus dot)
- Hover a card → action buttons fade in (✓ → ⏭)
- Click an action → opens terminal session
- Click ✓ Done on a target → confirm in source file (`cat 00-System/active.md` shows `[x]` instead of `[ ]`)

Quit.

**Step 5: Commit**

```bash
git add ace-desktop/renderer/dashboard.js
git commit -m "feat(cockpit): wire candidate pools, leverage scoring, and risen-leg selection"
```

---

### Task 14: Add "begin here" whisper on entry

**Files:**
- Modify: `renderer/dashboard.js`

**Step 1: Position whisper above risen card after render**

After the candidate computation in `loadDashboard()`, add:

```js
// "Begin here" whisper — appears 1.2s after entry, fades after 5s
setTimeout(() => {
  const whisper = document.getElementById('begin-whisper')
  if (!whisper || !risenLeg) return
  // Position above the risen leg's column
  const colIdx = { authority: 0, capacity: 1, expansion: 2 }[risenLeg]
  whisper.style.left = `${(colIdx + 0.5) * 33.33}%`
  whisper.style.transform = 'translateX(-50%)'
  whisper.textContent = 'begin here ↓'
  whisper.classList.add('show')
  setTimeout(() => {
    whisper.classList.add('fade')
    setTimeout(() => whisper.classList.remove('show', 'fade'), 1500)
  }, 5000)
}, 1200)
```

**Step 2: Verify**

```bash
cd ace-desktop && npm start
```

Expected: ~1.2s after the home view loads, *"begin here ↓"* whispers in above the risen card. Fades at 5s. Reload (Cmd+R) to see again. Quit.

**Step 3: Commit**

```bash
git add ace-desktop/renderer/dashboard.js
git commit -m "feat(cockpit): add 'begin here' whisper above risen card on entry"
```

---

### Task 15: Strip down synthesis widget to brain-bar-only

**Files:**
- Modify: `renderer/widgets/synthesis.js`

**Step 1: Remove tab switcher and view content**

The current synthesis widget renders Now/Week/Signals tabs. The cockpit needs only the brain bar (orb + synthesis line + 9-dot matrix + mode/energy + affirmations). The Now-tab content (Next Move + Inner Move) moves to: triad cards already handle Next Move; Inner Move becomes its own widget in Task 16.

Modify the `render()` method in `synthesis.js`. Keep the brain bar HTML (`.cc-pulse` block) and remove everything below it (tabs, view-content):

```js
render(allData, el) {
  const ctx = this._buildContext(allData)
  this._lastCtx = ctx
  const structural = this._buildStructural(ctx)
  const label = this._stateLabel(ctx.coherenceScore)

  const signalKeys = ['A1','A2','A3','C1','C2','C3','E1','E2','E3']
  const signalLabels = ['A','C','E']

  // Affirmations rotation setup
  const affirmations = allData.northStar?.affirmations || []
  const initialAff = affirmations[0] || ''

  el.innerHTML = `
    <div class="command-center cockpit-mode">
      <div class="cc-pulse">
        <div class="cc-orb ${label}" data-action="threshold">
          <span class="cc-orb-score">${ctx.coherenceScore}</span>
          <span class="cc-orb-label">${label}</span>
        </div>
        <div class="cc-center">
          <div class="cc-synthesis" id="cc-synthesis-text">${escapeHtml(structural)}</div>
          <div class="cc-synth-loading" id="cc-synth-loading">
            <span>Synthesizing</span>
            <div class="cc-synth-loading-bar"></div>
          </div>
          <div class="cc-signals">
            ${[0,1,2].map(row => {
              const offset = row * 3
              return `<span class="cc-signal-label">${signalLabels[row]}</span>` +
                [0,1,2].map(col => {
                  const color = ctx.signals[offset + col] || 'dim'
                  return `<div class="cc-signal-dot ${color}" title="${signalKeys[offset + col]}: ${SIGNAL_NAMES[signalKeys[offset + col]]}"></div>`
                }).join('')
            }).join('')}
          </div>
          <div class="cc-mode-tag">${escapeHtml(ctx.mode || '\u2014')} \u00b7 ${escapeHtml(ctx.energy || '\u2014')}</div>
          <div class="cc-affirmation" id="cc-affirmation">${escapeHtml(initialAff)}</div>
        </div>
      </div>
    </div>`

  // Wire orb click → Threshold Mode placeholder
  el.querySelector('[data-action="threshold"]')?.addEventListener('click', () => {
    alert("Threshold Mode opens here:\n\n→ 3 coherence breaths\n→ North Star anchors recited\n→ 'What wants to be created today?'\n→ Your answer becomes today's intent\n→ Cockpit shapes around it")
  })

  // Wire signal matrix click → coaching session
  const signalGrid = el.querySelector('.cc-signals')
  if (signalGrid) {
    signalGrid.addEventListener('click', () => {
      // Open terminal + send a coaching prompt about the 9 signals
      document.querySelector('.nav-item[data-view="terminal"]').click()
    })
  }

  // Affirmation rotation (every 11s)
  if (affirmations.length > 1) {
    let idx = 0
    if (this._affInterval) clearInterval(this._affInterval)
    this._affInterval = setInterval(() => {
      const affEl = document.getElementById('cc-affirmation')
      if (!affEl) { clearInterval(this._affInterval); return }
      affEl.style.opacity = '0'
      setTimeout(() => {
        idx = (idx + 1) % affirmations.length
        affEl.textContent = affirmations[idx]
        affEl.style.opacity = '0.75'
      }, 1500)
    }, 11000)
  }

  // Show synthesis loading + async AI
  const loadingEl = document.getElementById('cc-synth-loading')
  if (loadingEl) loadingEl.classList.add('active')
  this._fetchAI(ctx, allData, el, [])
},
```

**Note:** Keep all helper methods (`_buildContext`, `_buildStructural`, `_buildMomentum`, `_buildPriorities`, `_fetchAI`, `_buildCoachingPrompt`, etc.) intact for now — they're imported by future Inner Move widget. Just remove the tab-rendering methods (`_renderNowView`, `_renderWeekView`, `_renderSignalsView`, `_wireViewSwitcher`, `_wireNextMoveActions`, `_getDismissed`, `_setDismissed`) since the cockpit doesn't use them.

Actually for safety, **keep them** — Inner Move widget will use `_buildCoachingPrompt`. Strip only the rendering of tabs/views inside the new `render()` body.

**Step 2: Add CSS for affirmation in the brain bar**

Append to `renderer/styles/views/home.css`:

```css
/* Cockpit-mode synthesis brain bar */
.command-center.cockpit-mode .cc-pulse {
  display: grid;
  grid-template-columns: 200px 1fr;
  gap: 24px;
  align-items: center;
  padding: 24px 0;
}
.cc-affirmation {
  margin-top: 16px;
  font-family: 'Cormorant Garamond', Georgia, serif;
  font-size: 14px; font-style: italic;
  color: var(--gold);
  letter-spacing: 0.04em;
  opacity: 0.75;
  min-height: 22px;
  transition: opacity 1.5s ease;
}
```

**Step 3: Verify**

```bash
cd ace-desktop && npm start
```

Expected: Synthesis widget shows orb + synthesis line + 9-dot matrix + mode/energy tags + rotating affirmation. **No tabs.** Compass appears to the right (from Task 11). Quit.

**Step 4: Commit**

```bash
git add ace-desktop/renderer/widgets/synthesis.js ace-desktop/renderer/styles/views/home.css
git commit -m "refactor(synthesis): strip to brain-bar-only mode for cockpit (remove tabs)"
```

---

### Task 16: Build Inner Move widget (extracted from synthesis)

**Files:**
- Create: `renderer/widgets/innermove.js`
- Modify: `renderer/index.html`
- Modify: `renderer/widgets/registry.js`
- Modify: `renderer/styles/views/home.css`

**Step 1: Create the widget**

Create `renderer/widgets/innermove.js`:

```js
// renderer/widgets/innermove.js
// Inner Move bar — pattern-aware coaching prompt
import { escapeHtml } from '../modules/chat-renderer.js'
import synthesis from './synthesis.js'

export default {
  id: 'innermove',
  label: 'Inner Move',
  description: 'Pattern-aware coaching prompt below the triad deck',
  dataSource: null,
  defaultEnabled: true,

  render(allData, el) {
    // Reuse synthesis widget's coaching builder
    const ctx = synthesis._buildContext(allData)
    const coaching = synthesis._buildCoachingPrompt
      ? synthesis._buildCoachingPrompt(ctx)
      : null

    if (!coaching) {
      el.innerHTML = ''
      return
    }

    const pat = coaching.pattern
    const ten = coaching.tension

    el.innerHTML = `
      <div class="cockpit-innermove" style="--innermove-accent: ${coaching.accent || 'var(--green)'}">
        <div class="im-header">
          <span class="im-icon">↻</span>
          <span class="im-tag">Inner Move</span>
          ${coaching.skill ? `<span class="im-skill">${escapeHtml(coaching.skill)}</span>` : ''}
        </div>
        ${pat ? `<div class="im-pattern">
          <span class="im-pattern-name">${escapeHtml(pat.name)}</span>
          <span class="im-pattern-count">${pat.count}<span class="im-pattern-trend">${pat.trend === '^' ? '↑' : pat.trend === 'v' ? '↓' : '·'}</span></span>
        </div>` : ''}
        <div class="im-prompt">${escapeHtml(coaching.prompt)}</div>
        ${ten ? `<div class="im-tension">tension: ${escapeHtml(ten.label)} — day ${ten.days}</div>` : ''}
        <div class="im-actions">
          <button class="im-open" data-action="open">Open ${escapeHtml(coaching.skill || '/coach')}</button>
        </div>
      </div>`

    el.querySelector('[data-action="open"]')?.addEventListener('click', () => {
      document.querySelector('.nav-item[data-view="terminal"]').click()
      setTimeout(() => {
        if (window.spawnSession) window.spawnSession()
        setTimeout(() => {
          if (window.sendChatMessage) {
            const st = window.__aceState
            if (st?.activeId) window.sendChatMessage(st.activeId, coaching.prompt)
          }
        }, 200)
      }, 150)
    })
  },
}
```

**Step 2: Add container in index.html**

After the triad deck, before quick-actions (or in its place):

```html
<!-- Inner Move bar -->
<div id="widget-innermove"></div>

<!-- Dock zone (hidden when empty for v1) -->
<div id="widget-dock" data-empty="true" style="display:none"></div>
```

**Step 3: Register**

```js
import innermove from './innermove.js'

export const WIDGETS = [
  northstar, synthesis, compass,
  triadAuthority, triadCapacity, triadExpansion,
  innermove,
  identity, astro, metrics, rhythm, velocity, /* ... */
]

WIDGET_ZONES.innermove = 'cockpit-coaching'
```

**Step 4: Add CSS**

```css
/* ── COCKPIT — Inner Move ──────────────────────────────────── */
.cockpit-innermove {
  background:
    linear-gradient(135deg, rgba(96,216,168,0.06) 0%, transparent 50%),
    var(--glass-bg);
  border: 1px solid var(--border);
  border-left: 2px solid var(--green);
  border-radius: 10px;
  padding: 22px 26px;
  margin-bottom: 28px;
  backdrop-filter: var(--glass-blur);
  -webkit-backdrop-filter: var(--glass-blur);
}
.im-header { display: flex; align-items: center; gap: 12px; margin-bottom: 12px; }
.im-icon { color: var(--green); font-size: 16px; text-shadow: 0 0 8px rgba(96,216,168,0.5); }
.im-tag {
  font-family: 'JetBrains Mono', monospace;
  font-size: 8px; letter-spacing: 0.28em; text-transform: uppercase;
  color: var(--green);
}
.im-skill {
  font-family: 'JetBrains Mono', monospace;
  font-size: 9px; color: var(--text-dim);
  margin-left: auto;
}
.im-pattern { display: flex; gap: 10px; align-items: baseline; margin-bottom: 8px; }
.im-pattern-name { font-family: 'JetBrains Mono', monospace; font-size: 10px; color: var(--ark); }
.im-pattern-count { font-family: 'JetBrains Mono', monospace; font-size: 10px; color: var(--text-dim); }
.im-pattern-trend { color: var(--red); margin-left: 4px; }
.im-prompt {
  font-family: 'Space Grotesk', sans-serif;
  font-size: 16px; font-weight: 300; color: var(--text-primary);
  line-height: 1.5; max-width: 88%;
  letter-spacing: 0.01em;
}
.im-tension {
  font-family: 'JetBrains Mono', monospace;
  font-size: 9px; color: var(--text-dim);
  margin-top: 10px; letter-spacing: 0.05em;
}
.im-actions { margin-top: 12px; }
.im-open {
  background: rgba(96,216,168,0.1);
  border: 1px solid rgba(96,216,168,0.3);
  color: var(--green);
  padding: 6px 14px;
  border-radius: 6px;
  font-family: 'JetBrains Mono', monospace;
  font-size: 9px;
  letter-spacing: 0.15em;
  text-transform: uppercase;
  cursor: pointer;
}
.im-open:hover {
  background: rgba(96,216,168,0.2);
  border-color: var(--green);
}
```

**Step 5: Verify**

```bash
cd ace-desktop && npm start
```

Expected: Inner Move bar appears below the triad deck. Shows pattern + prompt + "Open /skill" button. Quit.

**Step 6: Commit**

```bash
git add ace-desktop/renderer/widgets/innermove.js ace-desktop/renderer/widgets/registry.js ace-desktop/renderer/index.html ace-desktop/renderer/styles/views/home.css
git commit -m "feat(cockpit): add Inner Move widget below triad deck"
```

---

## Phase 4 — Polish

### Task 17: Reposition flow layer (velocity + rhythm + astro) under brain

**Files:**
- Modify: `renderer/index.html`
- Modify: `renderer/styles/views/home.css`

**Step 1: Move flow widgets into a row above the triad deck**

In `renderer/index.html`, restructure the order. Replace:

```html
<div id="widget-astro"></div>
<div id="widget-metrics"></div>
<div id="widget-rhythm"></div>
<div id="widget-velocity" style="margin-bottom:10px"></div>
<div class="cockpit-triad-deck">...</div>
```

With:

```html
<!-- Flow layer: velocity + rhythm + astro -->
<div class="cockpit-flow-row">
  <div id="widget-velocity"></div>
  <div id="widget-rhythm"></div>
  <div id="widget-astro"></div>
</div>

<!-- Triad deck -->
<div class="cockpit-triad-deck">...</div>
```

(Remove the old `widget-metrics` from this position — it's disabled by default now.)

**Step 2: Add CSS for the flow row**

```css
.cockpit-flow-row {
  display: grid;
  grid-template-columns: 1.4fr 1.4fr 0.6fr;
  gap: 14px;
  margin-bottom: 24px;
}
@media (max-width: 1100px) {
  .cockpit-flow-row { grid-template-columns: 1fr 1fr; }
  .cockpit-flow-row #widget-astro { grid-column: span 2; }
}
```

**Step 3: Verify**

```bash
cd ace-desktop && npm start
```

Expected: Velocity, Rhythm, and Astro now sit in a row between the brain layer and the triad deck. Quit.

**Step 4: Commit**

```bash
git add ace-desktop/renderer/index.html ace-desktop/renderer/styles/views/home.css
git commit -m "style(cockpit): move flow layer (velocity/rhythm/astro) into row above triad deck"
```

---

### Task 18: Add right-click context menu for cards

**Files:**
- Modify: `renderer/widgets/triad-leg.js`

**Step 1: Add context menu HTML and handler**

In the `_wire()` method of `triad-leg.js`, add right-click handler:

```js
card.addEventListener('contextmenu', (e) => {
  e.preventDefault()
  this._showContextMenu(e, item, allData)
})
```

Add a new method `_showContextMenu`:

```js
_showContextMenu(event, item, allData) {
  // Remove any existing menu
  document.querySelectorAll('.cockpit-ctx-menu').forEach(m => m.remove())

  const menu = document.createElement('div')
  menu.className = 'cockpit-ctx-menu'
  menu.style.position = 'fixed'
  menu.style.left = `${event.clientX}px`
  menu.style.top = `${event.clientY}px`

  const items = []
  // Done supported by type
  if (['outcome', 'target', 'followup', 'pipeline'].includes(item.type)) {
    items.push({ label: 'Mark done', action: 'done' })
  }
  items.push({ label: 'Skip today', action: 'skip' })
  // Snooze only for follow-ups
  if (item.type === 'followup') {
    items.push({ label: 'Snooze 3 days', action: 'snooze-3' })
    items.push({ label: 'Snooze 1 week', action: 'snooze-7' })
  }
  items.push({ label: 'Cycle to next', action: 'cycle' })
  items.push({ label: 'Open in vault', action: 'vault' })
  items.push({ label: 'Why this is here?', action: 'why' })

  menu.innerHTML = items.map(i =>
    `<div class="ctx-item" data-action="${i.action}">${i.label}</div>`
  ).join('')

  document.body.appendChild(menu)

  menu.querySelectorAll('.ctx-item').forEach(el => {
    el.addEventListener('click', async () => {
      const action = el.dataset.action
      menu.remove()
      if (action === 'done') {
        const r = await window.ace.dash.markDone(item)
        if (r?.error) console.error(r.error)
        window.dispatchEvent(new CustomEvent('cockpit-refresh'))
      } else if (action === 'skip') {
        const dismissed = JSON.parse(localStorage.getItem('cockpit-dismissed') || '[]')
        dismissed.push({ label: item.label, date: new Date().toISOString().slice(0, 10) })
        localStorage.setItem('cockpit-dismissed', JSON.stringify(dismissed))
        window.dispatchEvent(new CustomEvent('cockpit-refresh'))
      } else if (action === 'snooze-3' || action === 'snooze-7') {
        const days = action === 'snooze-3' ? 3 : 7
        const r = await window.ace.dash.snoozeItem(item, days)
        if (r?.error) console.error(r.error)
        window.dispatchEvent(new CustomEvent('cockpit-refresh'))
      } else if (action === 'cycle') {
        // Mark this item temporarily skipped — refresh will pull next candidate
        const cycled = JSON.parse(sessionStorage.getItem('cockpit-cycled') || '[]')
        cycled.push(item.label)
        sessionStorage.setItem('cockpit-cycled', JSON.stringify(cycled))
        window.dispatchEvent(new CustomEvent('cockpit-refresh'))
      } else if (action === 'vault') {
        document.querySelector('.nav-item[data-view="vault"]')?.click()
      } else if (action === 'why') {
        alert(`Leverage: ${item._leverage || 0}\nLeg: ${item.leg}\nUrgency: ${item.urgency}\nType: ${item.type}`)
      }
    })
  })

  // Click anywhere else closes menu
  setTimeout(() => {
    document.addEventListener('click', () => menu.remove(), { once: true })
  }, 100)
}
```

**Step 2: Add CSS for context menu**

Append:

```css
.cockpit-ctx-menu {
  background: var(--bg-elevated);
  border: 1px solid var(--border-hover);
  border-radius: 6px;
  padding: 4px;
  z-index: 9999;
  min-width: 180px;
  box-shadow: 0 8px 24px rgba(0,0,0,0.5);
  font-family: 'DM Sans', sans-serif;
  font-size: 12px;
}
.cockpit-ctx-menu .ctx-item {
  padding: 7px 12px;
  border-radius: 4px;
  cursor: pointer;
  color: var(--text-primary);
}
.cockpit-ctx-menu .ctx-item:hover {
  background: rgba(140,120,255,0.1);
  color: var(--gold);
}
```

**Step 3: Update buildCandidatesByLeg to honor cycled list**

In `dashboard.js`, in `buildCandidatesByLeg`:

```js
const cycled = JSON.parse(sessionStorage.getItem('cockpit-cycled') || '[]')
const cycledSet = new Set(cycled)

const filterDismissed = (arr) => arr.filter(c =>
  !dismissedToday.has(c.label) && !cycledSet.has(c.label)
)
```

**Step 4: Verify**

```bash
cd ace-desktop && npm start
```

Expected: Right-click any action card → context menu appears with type-aware options. Click "Skip today" → card refreshes to next candidate. Click "Mark done" on a target → checkbox toggles in active.md (verify with `git diff 00-System/active.md`). Quit.

**Step 5: Commit**

```bash
git add ace-desktop/renderer/widgets/triad-leg.js ace-desktop/renderer/dashboard.js ace-desktop/renderer/styles/views/home.css
git commit -m "feat(cockpit): add right-click context menu for cards with type-aware actions"
```

---

### Task 19: Verify light mode + dark mode visual fidelity

**Files:** No code changes — visual verification only

**Step 1: Test dark mode (default)**

```bash
cd ace-desktop && npm start
```

Compare against [docs/plans/2026-04-11-cockpit-prototype-v2.html](docs/plans/2026-04-11-cockpit-prototype-v2.html). All sections should match aesthetically:
- North Star bar with gradient anchors
- Brain bar with breathing orb + synthesis + compass
- Flow row with velocity/rhythm/astro
- Triad deck with risen card
- Inner Move bar

**Step 2: Toggle to light mode**

In the app, find the existing theme toggle (Settings or sidebar — `body.light` is the existing class). Verify the cockpit gracefully shifts to pearlescent lavender. All elements must remain readable.

If any text appears low-contrast in light mode, add a `body.light` override in `home.css` for that specific element. Common likely fixes:

```css
body.light .ns-anchors {
  /* gradient may be too pale on lavender bg */
  filter: brightness(0.85);
}
body.light .cockpit-triad-deck .move-label {
  color: var(--text-primary);
}
```

**Step 3: Commit any light-mode fixes**

```bash
git add ace-desktop/renderer/styles/views/home.css
git commit -m "fix(cockpit): light mode contrast adjustments"
```

If no fixes needed, skip the commit.

---

### Task 20: Reduced-motion accessibility

**Files:**
- Modify: `renderer/styles/views/home.css`

**Step 1: Add prefers-reduced-motion media query**

Append to `home.css`:

```css
@media (prefers-reduced-motion: reduce) {
  .ns-anchors, .ns-star.current,
  .cockpit-triad-deck .triad-leg,
  .cockpit-triad-deck .urgency-dot,
  .cockpit-triad-deck .action-card.risen,
  .cockpit-triad-deck .action-card.risen::after,
  .cmp-center, .cmp-needle {
    animation: none !important;
    transition: none !important;
  }
}
```

**Step 2: Verify**

In macOS: System Settings → Accessibility → Display → Reduce motion → ON. Reload app. All breath/pulse/shimmer animations stop. Cockpit remains functional. Toggle reduce motion off again.

**Step 3: Commit**

```bash
git add ace-desktop/renderer/styles/views/home.css
git commit -m "feat(cockpit): respect prefers-reduced-motion accessibility setting"
```

---

### Task 21: Final integration check + ROADMAP update

**Files:**
- Modify: `ace-desktop/ROADMAP.md`

**Step 1: Full app smoke test**

```bash
cd ace-desktop && npm start
```

Click through every section. Verify:
- [ ] North Star anchors display from DCA frontmatter
- [ ] Constellation shows journey progress
- [ ] Orb breathes
- [ ] Synthesis line + signal matrix appear
- [ ] Affirmations rotate
- [ ] Compass needle points to dominant direction
- [ ] Velocity / Rhythm / Astro in flow row
- [ ] All three triad cards render with signals + actions
- [ ] One card is risen (golden halo + focus dot)
- [ ] "Begin here ↓" whisper appears on entry
- [ ] Hover card → action buttons appear
- [ ] ✓ Done writes to source file (verify with git diff)
- [ ] ⏭ Skip removes card, refreshes
- [ ] Right-click menu works for each card type
- [ ] Inner Move bar shows coaching prompt
- [ ] No console errors
- [ ] Light mode looks coherent (toggle theme)
- [ ] App restarts cleanly

Quit.

**Step 2: Update ROADMAP.md**

In `ace-desktop/ROADMAP.md`, find the "Triad column redesign" row in "In Progress — Now":

```diff
-| Triad column redesign | Not started | High | Replace dead-weight Authority/Capacity/Expansion columns with signal decode (3 readable rows per leg) + one featured action per leg. Zero backend changes, zero new IPC. Graceful fallback on missing data. [Plan](docs/plans/2026-04-11-triad-column-redesign.md) |
+| ~~Triad column redesign~~ | Done | ~~High~~ | Superseded by Cockpit Redesign — North Star + brain + compass + triad deck with risen-card + Inner Move + dock zone. [Design](docs/plans/2026-04-11-cockpit-redesign-design.md) · [Plan](docs/plans/2026-04-11-cockpit-redesign.md) |
```

Add design docs reference at the bottom:

```markdown
| [2026-04-11-cockpit-redesign-design.md](docs/plans/2026-04-11-cockpit-redesign-design.md) | Shipped |
| [2026-04-11-cockpit-redesign.md](docs/plans/2026-04-11-cockpit-redesign.md) | Shipped |
| [2026-04-11-cockpit-prototype-v2.html](docs/plans/2026-04-11-cockpit-prototype-v2.html) | Reference |
```

**Step 3: Commit**

```bash
git add ace-desktop/ROADMAP.md
git commit -m "docs(roadmap): mark cockpit redesign as shipped, archive triad column redesign"
```

---

## Done

All tasks complete. The cockpit ships with:
- North Star bar (anchors + journey + alignment)
- Brain layer (orb + synthesis + compass) — orb stub for Threshold Mode
- Flow layer (velocity + rhythm + astro)
- Triad deck (3 cards, signal decode + action card with rising leverage)
- Inner Move bar (pattern-aware coaching)
- Dock zone reserved (hidden when empty)
- Hover icons + right-click context menu (type-aware actions)
- Light + dark mode + reduced-motion support

**Out of scope (next sprints):**
- Threshold Mode full ritual (orb click currently shows placeholder)
- Operator dock widgets (Tier 1/2/3)
- HRV-synced breath rate
- Loop closure animations
- Compass v2/v3 (tagged execution log entries / AI scoring)
- AI-distilled DCA setup wizard
- Calendar BUILD blocks live read (currently uses pulse-cache.md)
