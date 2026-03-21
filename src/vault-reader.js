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
    const statusMatch = section.match(/\*\*Status:\*\*\s*(ON TRACK|AT RISK|BLOCKED|COMPLETE|IN PROGRESS|PAUSED)/i)
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

    const activeSection = text.match(/## Active\s*\n([\s\S]*?)(?=\n## |$)/)
    if (!activeSection) return []

    const tableLines = activeSection[1].split('\n').filter(l => l.trim().startsWith('|'))
    if (tableLines.length < 3) return []

    const headers = tableLines[0].split('|').map(h => h.trim().toLowerCase()).filter(Boolean)

    const rows = []
    for (let i = 2; i < tableLines.length; i++) {
      const cells = tableLines[i].split('|').slice(1, headers.length + 1).map(c => c.trim())
      if (cells.length < 2) continue
      const row = {}
      headers.forEach((h, idx) => { row[h] = cells[idx] || '' })
      row.person = (row.person || '').replace(/\[\[(?:[^\]|]+\|)?([^\]]+)\]\]/g, '$1').trim()
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

// ─── Days Since Last Pulse (system-metrics.md) ──────────────────────────────

function daysSinceLastPulse(vaultPath) {
  try {
    const text = fs.readFileSync(path.join(vaultPath, '00-System', 'system-metrics.md'), 'utf8')
    const dates = [...text.matchAll(/^## (\d{4}-\d{2}-\d{2})/gm)]
    if (!dates.length) return -1
    const last = new Date(dates[dates.length - 1][1])
    last.setHours(0, 0, 0, 0)
    const today = new Date(); today.setHours(0, 0, 0, 0)
    return Math.round((today - last) / (1000 * 60 * 60 * 24))
  } catch { return -1 }
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
    if (headingMatch) { currentDate = headingMatch[1]; continue }
    if (!currentDate || !dateSet.has(currentDate)) continue
    const entry = week.find(w => w.date === currentDate)
    if (!entry) continue
    // Match **Source:** or **Sources:** lines only — these are authoritative
    const sourceMatch = line.match(/^\s*-\s*\*\*Sources?:\*\*\s*(.+)/i)
    if (sourceMatch) {
      const source = sourceMatch[1].toLowerCase()
      if (source.includes('/start')) entry.start = true
      if (source.includes('/close')) entry.active = true  // any /close = work happened
      if (source.includes('/eod')) entry.eod = true
    }
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

  return { week, streaks }
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

module.exports = { parseState, parseFollowUps, listDir, parseExecutionLog, parseRitualRhythm, parsePeople }
