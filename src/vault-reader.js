const fs   = require('fs')
const path = require('path')

const MONTHS = {
  January:0, February:1, March:2, April:3, May:4, June:5,
  July:6, August:7, September:8, October:9, November:10, December:11,
}

// ─── State Parser (state.md + active.md) ─────────────────────────────────────

function parseState(vaultPath) {
  try {
    const stateText = fs.readFileSync(path.join(vaultPath, '00-System', 'state.md'), 'utf8')
    const activeText = fs.readFileSync(path.join(vaultPath, '00-System', 'active.md'), 'utf8')

    const stateSection = (heading) => {
      const re = new RegExp(`## ${heading}\\s*\\n([\\s\\S]*?)(?=\\n## |$)`)
      const m = stateText.match(re)
      return m ? m[1].trim() : null
    }

    const mode   = stateSection('Operating Mode')
    const energy = stateSection('Energy')

    const failuresRaw = stateSection('Open Failures')
    const failures = failuresRaw
      ? failuresRaw.split('\n').filter(l => l.trim().startsWith('-') && !/none/i.test(l)).map(l => l.replace(/^-\s*/, '').trim()).filter(Boolean)
      : []

    const weeklyTargets = parseWeeklyTargets(activeText)
    const outcomes      = parseOutcomes(activeText)

    const userName = parseUserName(vaultPath)
    const dca = parseDCA(vaultPath)
    const daysSincePulse = daysSinceLastPulse(vaultPath)

    return { mode, energy, failures, weeklyTargets, outcomes, userName, dca, daysSincePulse }
  } catch (e) {
    return { error: e.message }
  }
}

// ─── Outcomes (active.md ### sections) ───────────────────────────────────────

function parseOutcomes(activeText) {
  const today = new Date()
  today.setHours(0, 0, 0, 0)

  const sections = activeText.split(/\n(?=### )/)
  const outcomes = []

  for (const section of sections) {
    const titleMatch = section.match(/^### (.+)/)
    if (!titleMatch) continue

    // Strip " — Month Day" suffix from heading
    const title = titleMatch[1].replace(/\s*—\s*.+$/, '').trim()
    if (!title || title.toLowerCase() === 'direction') continue

    // Gate: extract last month-day pair → compute days to gate
    let daysToGate = null
    let gateLabel  = ''
    const gateMatch = section.match(/\*\*Gate:\*\*\s*(.+)/)
    if (gateMatch) {
      const dateRe = /\b(January|February|March|April|May|June|July|August|September|October|November|December)\s+(\d+)/g
      const found  = [...gateMatch[1].matchAll(dateRe)]
      if (found.length) {
        const last     = found[found.length - 1]
        const gateDate = new Date(2026, MONTHS[last[1]], parseInt(last[2]))
        gateDate.setHours(0, 0, 0, 0)
        daysToGate = Math.round((gateDate - today) / (1000 * 60 * 60 * 24))
        gateLabel  = `${last[1].slice(0, 3)} ${last[2]}`
      }
    }

    // Status: ON TRACK / AT RISK / BLOCKED / COMPLETE etc.
    const statusMatch = section.match(/\*\*Status:\*\*\s*(ON TRACK|AT RISK|BLOCKED|COMPLETE|CLOSED|IN PROGRESS|IN TRANSITION|PAUSED)/i)
    const status = statusMatch ? statusMatch[1].toUpperCase() : null

    // Skip section headers with no meaningful outcome data
    if (!status && daysToGate == null) continue

    outcomes.push({ title, daysToGate, gateLabel, status })
  }

  return outcomes
}

// ─── Weekly Targets (active.md) ──────────────────────────────────────────────

function parseWeeklyTargets(activeText) {
  try {
    const m = activeText.match(/\*\*This Week[^*]+\*\*:?\n([\s\S]*?)(?=\n---|\n\*\*This Week|\n###|$)/)
    if (!m) return []
    return m[1].split('\n')
      .filter(l => /^\s*-\s*\[/.test(l))
      .map(l => ({
        text:    l.replace(/^\s*-\s*\[[x ]\]\s*/i, '').trim(),
        checked: /^\s*-\s*\[x\]/i.test(l),
      }))
      .filter(i => i.text.length > 0)
  } catch {
    return []
  }
}

// ─── Follow-ups Parser ────────────────────────────────────────────────────────

function parseFollowUps(vaultPath) {
  try {
    const text = fs.readFileSync(path.join(vaultPath, '04-Network', 'follow-ups.md'), 'utf8')

    const activeSection = text.match(/## Active\s*\n([\s\S]*?)(?=\n---|\n## |$)/)
    if (!activeSection) return []

    // Neutralize wikilink pipes before splitting table columns
    // [[path|Display Name]] → [[path∥Display Name]] so | split works
    const neutralized = activeSection[1].replace(/\[\[([^\]]*?)\|([^\]]*?)\]\]/g, '[[$1∥$2]]')
    const tableLines = neutralized.split('\n').filter(l => l.trim().startsWith('|'))
    if (tableLines.length < 3) return []

    const headers = tableLines[0].split('|').map(h => h.trim().toLowerCase()).filter(Boolean)

    const rows = []
    for (let i = 2; i < tableLines.length; i++) {
      const cells = tableLines[i].split('|').slice(1, headers.length + 1).map(c => c.trim())
      if (cells.length < 2) continue
      const row = {}
      headers.forEach((h, idx) => { row[h] = cells[idx] || '' })
      row.person = (row.person || '').replace(/\[\[(?:[^\]∥]+[∥|])?([^\]]+)\]\]/g, '$1').trim()
      // Skip completed items still in the Active table
      const status = (row.status || '').toLowerCase()
      if (status === 'done' || status === 'completed') continue
      rows.push(row)
    }

    return rows.filter(r => r.person)
  } catch (e) {
    return { error: e.message }
  }
}

// ─── Dir Listing ──────────────────────────────────────────────────────────────

function listDir(dirPath) {
  try {
    return fs.readdirSync(dirPath, { withFileTypes: true }).map(e => ({
      name:  e.name,
      isDir: e.isDirectory(),
      path:  path.join(dirPath, e.name),
    }))
  } catch (e) {
    return { error: e.message }
  }
}

// ─── Execution Log Parser (velocity) ─────────────────────────────────────────

function parseExecutionLog(vaultPath, days = 14) {
  try {
    // Read both log files (recent entries may be in execution-log-recent.md)
    let text = ''
    for (const file of ['execution-log-recent.md', 'execution-log.md']) {
      try { text += '\n' + fs.readFileSync(path.join(vaultPath, '00-System', file), 'utf8') } catch {}
    }
    if (!text.trim()) return { byDay: {}, totalThisWeek: 0, totalLastWeek: 0 }
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
    const totalThisWeek = values.slice(0, 7).reduce((a, b) => a + b, 0)
    const totalLastWeek = values.slice(7).reduce((a, b) => a + b, 0)

    return { byDay, totalThisWeek, totalLastWeek }
  } catch (e) {
    return { byDay: {}, totalThisWeek: 0, totalLastWeek: 0, error: e.message }
  }
}

// ─── User Name (user.md) ─────────────────────────────────────────────────────

function parseUserName(vaultPath) {
  try {
    const text = fs.readFileSync(path.join(vaultPath, '00-System', 'user.md'), 'utf8')
    const m = text.match(/\*\*Name:\*\*\s*(.+)/)
    return m ? m[1].trim() : null
  } catch { return null }
}

// ─── DCA (core/dca.md) ──────────────────────────────────────────────────────

function parseDCA(vaultPath) {
  try {
    const text = fs.readFileSync(path.join(vaultPath, '00-System', 'core', 'dca.md'), 'utf8')
    const lines = text.split('\n').filter(l => !l.startsWith('#') && l.trim().length > 0)
    if (!lines.length) return null
    const first = lines[0].trim()
    // Truncate at sentence boundary near 200 chars
    if (first.length <= 200) return first
    const cut = first.lastIndexOf('.', 200)
    return cut > 50 ? first.slice(0, cut + 1) : first.slice(0, 200) + '...'
  } catch { return null }
}

// ─── DCA Frontmatter (core/dca.md) ─────────────────────────────────────────

function parseDCAFrontmatter(vaultPath) {
  try {
    const dcaPath = path.join(vaultPath, '00-System', 'core', 'dca.md')
    const text = fs.readFileSync(dcaPath, 'utf8')
    const fmMatch = text.match(/^---\n([\s\S]*?)\n---\n?/)
    const bodyText = fmMatch ? text.slice(fmMatch[0].length).trim() : text.trim()
    if (!fmMatch) return { ...defaultDCAFrontmatter(), body: bodyText, filePath: dcaPath }

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

    result.body = bodyText
    result.filePath = dcaPath
    return result
  } catch (e) {
    return { ...defaultDCAFrontmatter(), error: e.message }
  }
}

function defaultCompassDirections() {
  // Return empty so compass shows a blank state rather than hardcoded vocabulary
  // when a vault has no DCA frontmatter. The compass widget's !directions.north
  // guard will render nothing, preventing any bleed of example data onto clients.
  return {}
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

// ─── Daily Focus (01-Journal/daily/YYYY-MM-DD.md) ──────────────────────────

function parseDailyFocus(vaultPath) {
  try {
    const today = new Date()
    const dateStr = today.toISOString().slice(0, 10)
    const filePath = path.join(vaultPath, '01-Journal', 'daily', `${dateStr}.md`)
    const text = fs.readFileSync(filePath, 'utf8')

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

// ─── Recovery Flag (state.md) ──────────────────────────────────────────────

function parseRecoveryFlag(vaultPath) {
  try {
    const text = fs.readFileSync(path.join(vaultPath, '00-System', 'state.md'), 'utf8')
    const m = text.match(/## Recovery Flag\s*\n\s*(true|false)/i)
    return m ? m[1].toLowerCase() === 'true' : false
  } catch {
    return false
  }
}

// ─── Build Blocks (pulse-cache.md) ─────────────────────────────────────────

function parseBuildBlocks(vaultPath) {
  try {
    const text = fs.readFileSync(path.join(vaultPath, '00-System', 'pulse-cache.md'), 'utf8')

    const upcomingMatch = text.match(/build_blocks_upcoming:\s*\n((?:\s+-\s+[\s\S]*?(?=\n\s*-|\n[a-z_]+:|\n\n|$))+)/)
    if (!upcomingMatch) return []

    const blocks = []
    const now = new Date()

    const items = upcomingMatch[1].split(/\n\s*-\s+/).filter(Boolean)
    for (const item of items) {
      const titleMatch = item.match(/title:\s*"?([^"\n]+)"?/)
      const startMatch = item.match(/start:\s*"?([^"\n]+)"?/)
      const durationMatch = item.match(/duration_min:\s*(\d+)/)
      if (!titleMatch || !startMatch) continue

      const start = new Date(startMatch[1])
      if (isNaN(start.getTime())) continue
      if (start < now) continue
      const hoursUntil = Math.round((start - now) / (1000 * 60 * 60))
      if (hoursUntil > 24) continue

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

// ─── Days Since Last Pulse (system-metrics.md) ──────────────────────────────

function daysSinceLastPulse(vaultPath) {
  try {
    const text = fs.readFileSync(path.join(vaultPath, '00-System', 'system-metrics.md'), 'utf8')
    const dates = [...text.matchAll(/^## (\d{4}-\d{2}-\d{2})/gm)]
    if (!dates.length) return -1
    // Use max date, not last-in-file (entries may be out of chronological order)
    const maxDateStr = dates.map(m => m[1]).sort().pop()
    const last = new Date(maxDateStr)
    last.setHours(0, 0, 0, 0)
    const today = new Date(); today.setHours(0, 0, 0, 0)
    return Math.round((today - last) / (1000 * 60 * 60 * 24))
  } catch { return -1 }
}

// Return { timestamp: Date | null, hoursAgo: number | null } for the most recent pulse entry.
// system-metrics.md entries look like "## 2026-04-10 14:23" — we preserve hour granularity.
function parseLastPulse(vaultPath) {
  try {
    const text = fs.readFileSync(path.join(vaultPath, '00-System', 'system-metrics.md'), 'utf8')
    const entries = [...text.matchAll(/^##\s+(\d{4}-\d{2}-\d{2})(?:[ T](\d{2}):(\d{2}))?/gm)]
    if (!entries.length) return { timestamp: null, hoursAgo: null }
    // Parse to Date and pick the latest
    let latest = null
    for (const m of entries) {
      const [, dateStr, hh, mm] = m
      const d = new Date(`${dateStr}T${hh || '00'}:${mm || '00'}:00`)
      if (!isNaN(d.getTime()) && (!latest || d > latest)) latest = d
    }
    if (!latest) return { timestamp: null, hoursAgo: null }
    const hoursAgo = Math.max(0, Math.round((Date.now() - latest.getTime()) / (1000 * 60 * 60)))
    return { timestamp: latest.toISOString(), hoursAgo }
  } catch { return { timestamp: null, hoursAgo: null } }
}

// ─── Ritual Rhythm (execution-log.md) ────────────────────────────────────────

function parseRitualRhythm(vaultPath) {
  const today = new Date()
  today.setHours(0, 0, 0, 0)
  const dayOfWeek = today.getDay() // 0=Sun
  // Start from Monday of current week
  const monday = new Date(today)
  monday.setDate(today.getDate() - ((dayOfWeek + 6) % 7))

  const week = []
  const dayLabels = ['Mon','Tue','Wed','Thu','Fri','Sat','Sun']
  for (let i = 0; i < 7; i++) {
    const d = new Date(monday)
    d.setDate(monday.getDate() + i)
    week.push({ date: d.toISOString().slice(0, 10), dayLabel: dayLabels[i], start: false, active: false, eod: false })
  }

  // Read both log files
  let text = ''
  for (const file of ['execution-log-recent.md', 'execution-log.md']) {
    try { text += '\n' + fs.readFileSync(path.join(vaultPath, '00-System', file), 'utf8') } catch {}
  }

  const dateSet = new Set(week.map(w => w.date))
  let currentDate = null
  for (const line of text.split('\n')) {
    const headingMatch = line.match(/^#{1,3}\s+(\d{4}-\d{2}-\d{2})/)
    if (headingMatch) {
      currentDate = headingMatch[1]
      // Detect "Day Start" or "Session Close" or "EOD" from heading
      const entry = dateSet.has(currentDate) && week.find(w => w.date === currentDate)
      if (entry) {
        const heading = line.toLowerCase()
        if (heading.includes('day start')) entry.start = true
        if (heading.includes('session close')) entry.active = true
        if (heading.includes('eod')) entry.eod = true
      }
      continue
    }
    if (!currentDate || !dateSet.has(currentDate)) continue
    const entry = week.find(w => w.date === currentDate)
    if (!entry) continue
    // Match **Source:** or **Sources:** lines
    const sourceMatch = line.match(/^\s*-\s*\*\*Sources?:\*\*\s*(.+)/i)
    if (sourceMatch) {
      const source = sourceMatch[1].toLowerCase()
      if (source.includes('/start')) entry.start = true
      if (source.includes('/close')) entry.active = true
      if (source.includes('/eod')) entry.eod = true
    }
    // Also detect from individual **Source:** lines (non-consolidated)
    const singleSource = line.match(/^\s*-\s*\*\*Source:\*\*\s*(.+)/i)
    if (singleSource) {
      const source = singleSource[1].toLowerCase()
      if (source.includes('/start')) entry.start = true
      if (source.includes('/close')) entry.active = true
      if (source.includes('/eod')) entry.eod = true
    }
  }

  // Fallback: check daily notes when execution log entries are missing
  for (const day of week) {
    if (day.start && day.active && day.eod) continue
    try {
      const dailyNote = fs.readFileSync(path.join(vaultPath, '01-Journal', 'daily', day.date + '.md'), 'utf8')
      // /start: filled morning journal (not empty template)
      if (!day.start) {
        const morningMatch = dailyNote.match(/\*\*What is true this morning:\*\*[ \t]*(.+)/)
        if (morningMatch && morningMatch[1].trim().length > 0) day.start = true
      }
      // /close: actual session log entries (not just template comment)
      if (!day.active && /## Session Log[\s\S]*?- Shipped:/i.test(dailyNote)) day.active = true
      // /eod: filled energy field inside EOD Closure (empty template = just "**Energy:**\n")
      if (!day.eod) {
        const eodEnergy = dailyNote.match(/## EOD Closure[\s\S]*?\*\*Energy:\*\*[ \t]*(.+)/)
        if (eodEnergy && eodEnergy[1].trim().length > 0) day.eod = true
      }
    } catch {}
  }

  // Compute streaks (consecutive days back from today)
  const todayIdx = week.findIndex(w => w.date === today.toISOString().slice(0, 10))
  const streak = (key) => {
    let count = 0
    for (let i = todayIdx; i >= 0; i--) {
      if (week[i][key]) count++; else break
    }
    return count
  }
  const streaks = todayIdx >= 0 ? { start: streak('start'), active: streak('active'), eod: streak('eod') } : { start: 0, active: 0, eod: 0 }

  // Build 28-day rolling window for cockpit rhythm widget
  const days28 = []
  for (let i = 27; i >= 0; i--) {
    const d = new Date(today)
    d.setDate(today.getDate() - i)
    days28.push({ date: d.toISOString().slice(0, 10), start: false, active: false, eod: false })
  }
  const days28Map = new Map(days28.map(d => [d.date, d]))

  // Re-scan log text for the 28-day window
  {
    let currentDate = null
    for (const line of text.split('\n')) {
      const headingMatch = line.match(/^#{1,3}\s+(\d{4}-\d{2}-\d{2})/)
      if (headingMatch) {
        currentDate = headingMatch[1]
        const entry = days28Map.get(currentDate)
        if (entry) {
          const heading = line.toLowerCase()
          if (heading.includes('day start'))     entry.start = true
          if (heading.includes('session close')) entry.active = true
          if (heading.includes('eod'))           entry.eod = true
        }
        continue
      }
      if (!currentDate) continue
      const entry = days28Map.get(currentDate)
      if (!entry) continue
      const sourceMatch = line.match(/^\s*-\s*\*\*Sources?:\*\*\s*(.+)/i)
      if (sourceMatch) {
        const source = sourceMatch[1].toLowerCase()
        if (source.includes('/start')) entry.start = true
        if (source.includes('/close')) entry.active = true
        if (source.includes('/eod'))   entry.eod = true
      }
      const singleSource = line.match(/^\s*-\s*\*\*Source:\*\*\s*(.+)/i)
      if (singleSource) {
        const source = singleSource[1].toLowerCase()
        if (source.includes('/start')) entry.start = true
        if (source.includes('/close')) entry.active = true
        if (source.includes('/eod'))   entry.eod = true
      }
    }
  }

  // Daily-note fallback for days28
  for (const day of days28) {
    if (day.start && day.active && day.eod) continue
    try {
      const dailyNote = fs.readFileSync(path.join(vaultPath, '01-Journal', 'daily', day.date + '.md'), 'utf8')
      if (!day.start) {
        const morningMatch = dailyNote.match(/\*\*What is true this morning:\*\*[ \t]*(.+)/)
        if (morningMatch && morningMatch[1].trim().length > 0) day.start = true
      }
      if (!day.active && /## Session Log[\s\S]*?- Shipped:/i.test(dailyNote)) day.active = true
      if (!day.eod) {
        const eodEnergy = dailyNote.match(/## EOD Closure[\s\S]*?\*\*Energy:\*\*[ \t]*(.+)/)
        if (eodEnergy && eodEnergy[1].trim().length > 0) day.eod = true
      }
    } catch {}
  }

  return { week, streaks, days28 }
}

// ─── People Directory (04-Network/people/ + network-map.md) ─────────────────

function parsePeople(vaultPath) {
  const peopleDir = path.join(vaultPath, '04-Network', 'people')
  const people = []

  // Read person files
  try {
    const entries = fs.readdirSync(peopleDir, { withFileTypes: true })
    for (const e of entries) {
      if (!e.isFile() || !e.name.endsWith('.md') || e.name === 'person.md') continue
      const filePath = path.join(peopleDir, e.name)
      try {
        const text = fs.readFileSync(filePath, 'utf8')
        const nameMatch = text.match(/^#\s+(.+)/m)
        const name = nameMatch ? nameMatch[1].trim() : e.name.replace('.md', '').replace(/-/g, ' ')
        people.push({ name, fileName: e.name.replace('.md', ''), path: filePath, category: null })
      } catch {}
    }
  } catch { return { people: [], categories: [] } }

  // Parse network-map.md for categories
  // Multi-category: each person can belong to multiple categories
  const categories = []
  try {
    const mapText = fs.readFileSync(path.join(vaultPath, '04-Network', 'network-map.md'), 'utf8')
    const sections = mapText.split(/\n(?=## )/)
    for (const section of sections) {
      const headingMatch = section.match(/^## (.+)/m)
      if (!headingMatch) continue
      const catName = headingMatch[1].trim()
      if (catName.toLowerCase() === 'network map' || catName.startsWith('#')) continue
      const links = [...section.matchAll(/\[\[(?:[^\]|]+\|)?([^\]]+)\]\]/g)].map(m => m[1].trim().toLowerCase())
      const members = []
      for (const link of links) {
        const match = people.find(p =>
          p.name.toLowerCase() === link ||
          p.fileName.toLowerCase() === link ||
          p.fileName.toLowerCase() === link.replace(/\s+/g, '-')
        )
        if (match) {
          // Add category (allow multiple)
          if (!match.categories) match.categories = []
          if (!match.categories.includes(catName)) match.categories.push(catName)
          if (!members.includes(match.fileName)) members.push(match.fileName)
        }
      }
      if (members.length > 0) categories.push({ name: catName, members })
    }
  } catch {}

  // Set primary category (first one) and handle uncategorized
  people.forEach(p => {
    if (!p.categories || p.categories.length === 0) {
      p.categories = ['Other']
    }
    p.category = p.categories[0] // primary for backward compat
  })
  const uncatPeople = people.filter(p => p.categories.length === 1 && p.categories[0] === 'Other')
  if (uncatPeople.length > 0) {
    categories.push({ name: 'Other', members: uncatPeople.map(p => p.fileName) })
  }

  // Sort people alphabetically
  people.sort((a, b) => a.name.localeCompare(b.name))

  // Discover entities from Domains/ directory
  const entities = []
  try {
    const domainDir = path.join(vaultPath, 'Domains')
    const domainEntries = fs.readdirSync(domainDir, { withFileTypes: true })
    for (const e of domainEntries) {
      if (!e.isDirectory() || e.name.startsWith('.')) continue
      // Titlecase the domain name
      const name = e.name.split('-').map(w => w.charAt(0).toUpperCase() + w.slice(1)).join(' ')
      const domPath = path.join(domainDir, e.name)
      // Find best entry file: README.md > *overview*.md > first .md
      let entryFile = null
      try {
        const files = fs.readdirSync(domPath).filter(f => f.endsWith('.md'))
        entryFile = files.find(f => f.toLowerCase() === 'readme.md')
          || files.find(f => f.toLowerCase().includes('overview'))
          || files.find(f => f.toLowerCase().includes('index'))
          || files[0] || null
      } catch {}
      entities.push({ id: e.name, name, path: domPath, entryFile: entryFile ? path.join(domPath, entryFile) : null })
    }
  } catch {}

  return { people, categories, entities }
}

function parseArtifacts(vaultPath) {
  const artDir = path.join(vaultPath, '11-Artifacts')
  const artifacts = []
  const categories = {}

  try {
    const entries = fs.readdirSync(artDir, { withFileTypes: true })
    for (const e of entries) {
      if (!e.isFile() || !e.name.endsWith('.md') || e.name === 'README.md') continue
      const filePath = path.join(artDir, e.name)
      try {
        const text = fs.readFileSync(filePath, 'utf8')
        const fm = parseFrontmatter(text)
        if (!fm) continue
        const body = text.replace(/^---[\s\S]*?---\s*/, '').trim()
        const slug = e.name.replace('.md', '')
        // Check if source file/dir still exists
        const fp = fm.file_path || ''
        let missing = false
        if (fp) {
          const resolved = path.join(vaultPath, fp)
          missing = !fs.existsSync(resolved)
        }
        const artifact = {
          slug,
          title: fm.title || slug.replace(/-/g, ' '),
          category: fm.category || 'other',
          tags: fm.tags || [],
          status: fm.status || 'shipped',
          created: fm.created || '',
          url: fm.url || '',
          file_path: fp,
          domain: fm.domain || '',
          client: fm.client || '',
          body: body.slice(0, 500),
          path: filePath,
          missing,
        }
        artifacts.push(artifact)
        categories[artifact.category] = (categories[artifact.category] || 0) + 1
      } catch {}
    }
  } catch { return { artifacts: [], categories: {} } }

  artifacts.sort((a, b) => (b.created || '').localeCompare(a.created || ''))
  return { artifacts, categories }
}

function parseFrontmatter(text) {
  const match = text.match(/^---\n([\s\S]*?)\n---/)
  if (!match) return null
  const fm = {}
  const lines = match[1].split('\n')
  for (const line of lines) {
    const kv = line.match(/^(\w[\w_]*)\s*:\s*(.*)$/)
    if (!kv) continue
    let val = kv[2].trim()
    // Handle arrays: [tag1, tag2]
    if (val.startsWith('[') && val.endsWith(']')) {
      val = val.slice(1, -1).split(',').map(s => s.trim().replace(/^["']|["']$/g, '')).filter(Boolean)
    } else {
      // Strip quotes
      val = val.replace(/^["']|["']$/g, '')
    }
    fm[kv[1]] = val
  }
  return fm
}

function getArtifactDetail(vaultPath, slug) {
  const filePath = path.join(vaultPath, '11-Artifacts', slug + '.md')
  try {
    const text = fs.readFileSync(filePath, 'utf8')
    const fm = parseFrontmatter(text)
    const body = text.replace(/^---[\s\S]*?---\s*/, '').trim()
    // Check if file_path resolves to a previewable target
    const fp = fm.file_path || ''
    const fullPath = fp ? path.join(vaultPath, fp) : ''
    let previewable = false
    if (fp.endsWith('.html') && fs.existsSync(fullPath)) previewable = true
    else if (fp.endsWith('.pdf') && fs.existsSync(fullPath)) previewable = true
    else if (fp.endsWith('/') && fs.existsSync(path.join(fullPath, 'index.html'))) previewable = true
    // Check if source file/dir still exists
    let missing = false
    if (fp) {
      missing = !fs.existsSync(fullPath)
    }
    return { ...fm, slug, body, path: filePath, previewable, missing }
  } catch (e) { return { error: e.message } }
}

function updateArtifactStatus(vaultPath, slug, newStatus) {
  const filePath = path.join(vaultPath, '11-Artifacts', slug + '.md')
  try {
    let text = fs.readFileSync(filePath, 'utf8')
    if (text.match(/^status:\s*.+$/m)) {
      text = text.replace(/^status:\s*.+$/m, `status: ${newStatus}`)
    } else {
      // Insert status after the first --- line
      text = text.replace(/^(---\n)/, `$1status: ${newStatus}\n`)
    }
    fs.writeFileSync(filePath, text, 'utf8')
    return { ok: true }
  } catch (e) { return { error: e.message } }
}

function parsePatterns(vaultPath) {
  const indexPath = path.join(vaultPath, '01-Journal', 'patterns', 'index.md')
  try {
    const text = fs.readFileSync(indexPath, 'utf8')

    // Parse backlink counts: "- pattern-name: 43 ^"
    const counts = []
    const countRe = /^- ([\w-]+): (\d+) ([~^v])/gm
    let m
    while ((m = countRe.exec(text)) !== null) {
      counts.push({ name: m[1], count: parseInt(m[2]), trend: m[3] })
    }

    // Parse active tensions
    const tensions = []
    const tensionRe = /^\- \[\[tension: (.+?)\]\] — first surfaced ([\d-]+), last seen ([\d-]+)\. (.+)/gm
    while ((m = tensionRe.exec(text)) !== null) {
      const firstSurfaced = new Date(m[2])
      const lastSeen = new Date(m[3])
      const days = Math.round((lastSeen - firstSurfaced) / (1000 * 60 * 60 * 24))
      tensions.push({ label: m[1], firstSurfaced: m[2], lastSeen: m[3], days, note: m[4] })
    }

    // Parse co-occurrences from the table
    const coOccurrences = []
    const coRe = /^\| ([\w-]+ \+ [\w-]+) \| (\d+) \| (.+?) \|/gm
    while ((m = coRe.exec(text)) !== null) {
      coOccurrences.push({ pair: m[1], count: parseInt(m[2]), signal: m[3].trim() })
    }

    // Read first line of each pattern file for description
    const patternsDir = path.join(vaultPath, '01-Journal', 'patterns')
    const descriptions = {}
    for (const c of counts) {
      try {
        const pText = fs.readFileSync(path.join(patternsDir, c.name + '.md'), 'utf8')
        // First paragraph after the heading
        const lines = pText.split('\n').filter(l => l.trim() && !l.startsWith('#'))
        if (lines[0]) descriptions[c.name] = lines[0].trim()
        // Triad leg
        const legMatch = pText.match(/\*\*Triad leg:\*\*\s*(.+)/)
        if (legMatch) c.triadLeg = legMatch[1].trim()
        // Pole
        const poleMatch = pText.match(/\*\*Pole:\*\*\s*(.+)/)
        if (poleMatch) c.pole = poleMatch[1].trim()
      } catch (_) { /* pattern file may not exist */ }
    }

    return { counts, tensions, coOccurrences, descriptions }
  } catch (e) { return { counts: [], tensions: [], coOccurrences: [], descriptions: {}, error: e.message } }
}

// ─── Ritual Streak ────────────────────────────────────────────────────────────
// Counts consecutive days with a daily note — proxy for /start being run.
// Returns: { streak, todayActive, todayPending, last7 }
//   streak       — consecutive active days (from today if active, else from yesterday)
//   todayActive  — today's note exists
//   todayPending — streak is alive but today not yet logged (morning state)
//   last7        — array of { date, active } for the last 7 days
function parseRitualStreak(vaultPath) {
  try {
    const dailyDir = path.join(vaultPath, '01-Journal', 'daily')
    const today = new Date()
    today.setHours(0, 0, 0, 0)

    const last7 = []
    for (let i = 0; i < 7; i++) {
      const d = new Date(today)
      d.setDate(d.getDate() - i)
      const dateStr = d.toISOString().slice(0, 10)
      last7.push({ date: dateStr, active: fs.existsSync(path.join(dailyDir, `${dateStr}.md`)) })
    }

    const todayActive = last7[0].active

    // Count streak: start from today if active, else from yesterday
    let streak = 0
    const startIdx = todayActive ? 0 : 1
    for (let i = startIdx; i < last7.length; i++) {
      if (last7[i].active) streak++
      else break
    }

    return {
      streak,
      todayActive,
      todayPending: !todayActive && streak > 0,
      last7,
    }
  } catch (e) {
    return { streak: 0, todayActive: false, todayPending: false, last7: [], error: e.message }
  }
}

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

module.exports = { parseState, parseFollowUps, listDir, parseExecutionLog, parseRitualRhythm, parsePeople, parseArtifacts, getArtifactDetail, updateArtifactStatus, parsePatterns, parseDCAFrontmatter, parseDailyFocus, parseRecoveryFlag, parseBuildBlocks, parseLastPulse, parseRitualStreak, parseCadence }
