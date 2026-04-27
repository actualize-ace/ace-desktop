// src/synthesizer.js
// Provides structural health summary (instant) and AI synthesis call (via claude CLI)

const { execFile } = require('child_process')
const fs            = require('fs')
const path          = require('path')

// ─── Structural synthesis (rule-based, instant) ───────────────────────────────

function buildStructural(context) {
  const { coherenceScore, signals, overdueFu, daysSinceExecution } = context

  const label =
    coherenceScore >= 15 ? 'COHERENT'   :
    coherenceScore >= 11 ? 'STABLE'     :
    coherenceScore >= 7  ? 'DRIFTING'   :
    coherenceScore >= 4  ? 'FRAGMENTED' : 'CRITICAL'

  const parts = [`Coherence ${coherenceScore}/18 — ${label}.`]

  const signalKeys = ['A1','A2','A3','C1','C2','C3','E1','E2','E3']
  const red    = signals.map((c, i) => c === 'red'    ? signalKeys[i] : null).filter(Boolean)
  const yellow = signals.map((c, i) => c === 'yellow' ? signalKeys[i] : null).filter(Boolean)

  if (red.length)    parts.push(`${red.join(', ')} RED.`)
  if (yellow.length) parts.push(`${yellow.slice(0, 2).join(', ')} YELLOW.`)
  if (overdueFu > 0) parts.push(`${overdueFu} overdue follow-up${overdueFu > 1 ? 's' : ''}.`)
  if (daysSinceExecution >= 2) parts.push(`${daysSinceExecution}d execution gap.`)

  return parts.join(' ')
}

// ─── Parse system-metrics.md for signal details ───────────────────────────────

function parseSignalDetails(vaultPath) {
  try {
    const text = fs.readFileSync(
      path.join(vaultPath, '00-System', 'system-metrics.md'), 'utf8'
    )
    // Find the Details line under the most recent date heading (entries may be out of order)
    const lines = text.split('\n')
    let maxDate = ''
    let maxDateIdx = -1
    for (let i = 0; i < lines.length; i++) {
      const m = lines[i].match(/^## (\d{4}-\d{2}-\d{2})/)
      if (m && m[1] > maxDate) { maxDate = m[1]; maxDateIdx = i }
    }
    if (maxDateIdx < 0) return Array(9).fill('dim')
    let detailsLine = ''
    for (let i = maxDateIdx + 1; i < lines.length; i++) {
      if (lines[i].startsWith('## ')) break
      if (lines[i].trim().startsWith('- Details:')) { detailsLine = lines[i]; break }
    }
    if (!detailsLine) return Array(9).fill('dim')

    // Parse "A1=G A2=G A3=G C1=Y C2=Y C3=G E1=G E2=Y E3=R" format
    const colorMap = { G: 'green', Y: 'yellow', R: 'red' }
    const signalOrder = ['A1', 'A2', 'A3', 'C1', 'C2', 'C3', 'E1', 'E2', 'E3']
    const pairs = {}
    for (const m of detailsLine.matchAll(/([ACE]\d)=([GYR])/g)) {
      pairs[m[1]] = colorMap[m[2]] || 'dim'
    }
    return signalOrder.map(k => pairs[k] || 'dim')
  } catch {
    return Array(9).fill('dim')
  }
}

// ─── Build context object from all vault/db data ──────────────────────────────

function buildContext(vaultPath, state, metrics, followUps, velocity) {
  const signals = parseSignalDetails(vaultPath)
  const scoreMap = { green: 2, yellow: 1, red: 0, dim: 0 }
  const coherenceScore = signals.reduce((sum, c) => sum + (scoreMap[c] || 0), 0)

  const today = new Date(); today.setHours(0, 0, 0, 0)
  const byDay = velocity?.byDay || {}
  let daysSinceExecution = 0
  for (let i = 0; i < 14; i++) {
    const d = new Date(); d.setDate(d.getDate() - i)
    const key = d.toISOString().slice(0, 10)
    if ((byDay[key] || 0) > 0) break
    daysSinceExecution = i + 1
  }

  const fuArr = Array.isArray(followUps) ? followUps : []
  const overdueFu = fuArr.filter(fu => {
    if (!fu.due) return false
    const d = new Date(fu.due); d.setHours(0, 0, 0, 0)
    return d < today && (fu.status || '').toLowerCase() !== 'done'
  }).length

  return {
    coherenceScore,
    signals,
    mode:    state?.mode    || '',
    energy:  state?.energy  || '',
    outcomes: (state?.outcomes || []).map(o => ({ title: o.title, status: o.status })),
    targets: {
      done:  (state?.weeklyTargets || []).filter(t => t.checked).length,
      total: (state?.weeklyTargets || []).length,
    },
    velocity: {
      thisWeek: velocity?.totalThisWeek || 0,
      lastWeek: velocity?.totalLastWeek || 0,
    },
    overdueFu,
    daysSinceExecution,
  }
}

// ─── AI synthesis (via claude CLI) ───────────────────────────────────────────

async function getAISynthesis(context, voicePath, binaryPath) {
  if (!binaryPath) return null

  let voiceNote = ''
  try {
    const raw = fs.readFileSync(voicePath, 'utf8')
    const m = raw.match(/## Layer 1[\s\S]{0,400}/)
    voiceNote = m ? m[0].slice(0, 300) : ''
  } catch {}

  const today = new Date()
  const dayName = ['Sunday','Monday','Tuesday','Wednesday','Thursday','Friday','Saturday'][today.getDay()]
  const dateStr = today.toISOString().slice(0, 10)

  const prompt = `You are the AI layer of the ACE coherence system. Return ONLY valid JSON with two fields:

1. "synthesis": A 2-3 sentence system read. Speak directly in second person. No preamble, no labels. Be direct and specific about what matters most right now.
2. "priorities": An array of up to 5 objects, each with "label" (short task name), "context" (brief tag like "3d overdue" or "gate in 5d"), and "reasoning" (one sentence why this matters now). Rank by true importance — what will create the most coherence if done first.

${voiceNote ? `Voice reference: ${voiceNote}` : ''}

System state:
- Today: ${dayName} ${dateStr}
- Mode: ${context.mode || 'unknown'}, Energy: ${context.energy || 'unknown'}
- Coherence: ${context.coherenceScore}/18
- Signals: ${context.signals?.join(',') || 'unknown'}
- Outcomes: ${(context.outcomes || []).map(o => `${o.title}[${o.status}]${o.daysToGate != null ? ' gate:' + o.daysToGate + 'd' : ''}`).join(' | ') || 'none'}
- Targets: ${context.targets?.done || 0}/${context.targets?.total || 0} complete
- Velocity: ${context.velocity?.thisWeek || 0} this week vs ${context.velocity?.lastWeek || 0} last week
- Overdue follow-ups: ${context.overdueFu || 0}
- Execution gap: ${context.daysSinceExecution || 0}d

Return JSON only. No markdown, no code fences.`

  return new Promise(resolve => {
    const needsShell = process.platform === 'win32' && /\.(cmd|bat)$/i.test(binaryPath)
    const safePrompt = needsShell
      ? '"' + prompt.replace(/%/g, '%%').replace(/"/g, '""') + '"'
      : prompt
    const proc = execFile(binaryPath, ['--model', 'sonnet', '-p', safePrompt], {
      timeout: 30000,
      env: process.env,
      shell: needsShell,
    }, (err, stdout) => {
      if (err) { console.error('[synthesizer] claude call failed:', err.message); resolve(null); return }
      const text = (stdout || '').trim()
      try {
        resolve(JSON.parse(text))
      } catch {
        const jsonMatch = text.match(/\{[\s\S]*\}/)
        if (jsonMatch) {
          try { resolve(JSON.parse(jsonMatch[0])) } catch { resolve(text) }
        } else {
          resolve(text)
        }
      }
    })
    proc.on('error', () => resolve(null))
  })
}

// ─── Cockpit — compass direction from recent execution log ─────────────────

function computeCompassDirection(vaultPath, directions) {
  try {
    let text = ''
    for (const file of ['execution-log-recent.md', 'execution-log.md']) {
      try { text += '\n' + fs.readFileSync(path.join(vaultPath, '00-System', file), 'utf8') } catch {}
    }

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

// ─── Cockpit — leverage scoring + weakest leg ──────────────────────────────

function computeLeverageScore(priority, ctx) {
  let score = 0

  const focus = ctx.dailyFocus || []
  for (const f of focus) {
    const fLow = (f || '').toLowerCase()
    if (priority.label && fLow.includes(priority.label.toLowerCase().slice(0, 20))) { score += 5; break }
    if (priority._raw?.person && fLow.includes(priority._raw.person.toLowerCase())) { score += 5; break }
    if (priority._raw?.topic && fLow.includes(priority._raw.topic.toLowerCase().slice(0, 20))) { score += 5; break }
  }

  if (priority.leg && priority.leg === ctx.weakestLeg) score += 3

  if (priority.urgency === 'critical' || priority.urgency === 'urgent') score += 2
  else score += 1

  if (priority.direction && priority.direction === ctx.compassDirection) score += 1

  return score
}

function computeWeakestLeg(signals) {
  const score = (c) => c === 'green' ? 2 : c === 'yellow' ? 1 : 0
  const a = (signals[0] && signals[1] && signals[2]) ? score(signals[0]) + score(signals[1]) + score(signals[2]) : 6
  const c = (signals[3] && signals[4] && signals[5]) ? score(signals[3]) + score(signals[4]) + score(signals[5]) : 6
  const e = (signals[6] && signals[7] && signals[8]) ? score(signals[6]) + score(signals[7]) + score(signals[8]) : 6
  if (a <= c && a <= e) return 'authority'
  if (c <= e) return 'capacity'
  return 'expansion'
}

module.exports = {
  buildStructural, buildContext, getAISynthesis, parseSignalDetails,
  computeCompassDirection, computeLeverageScore, computeWeakestLeg,
}
