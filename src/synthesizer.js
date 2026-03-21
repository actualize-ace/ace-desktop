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
    // Find the last "- Details:" line (most recent pulse snapshot)
    const lines = text.split('\n')
    let detailsLine = ''
    for (let i = lines.length - 1; i >= 0; i--) {
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

function buildContext(vaultPath, state, metrics, followUps, velocity, pipeline) {
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
    pipeline: {
      count: (pipeline || []).length,
      value: (pipeline || []).reduce((s, d) => s + (d.amount || 0), 0),
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
- Pipeline: ${context.pipeline?.count || 0} deals / $${context.pipeline?.value || 0}
- Velocity: ${context.velocity?.thisWeek || 0} this week vs ${context.velocity?.lastWeek || 0} last week
- Overdue follow-ups: ${context.overdueFu || 0}
- Execution gap: ${context.daysSinceExecution || 0}d

Return JSON only. No markdown, no code fences.`

  return new Promise(resolve => {
    const proc = execFile(binaryPath, ['--model', 'sonnet', '-p', prompt], {
      timeout: 30000,
      env: process.env,
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

module.exports = { buildStructural, buildContext, getAISynthesis, parseSignalDetails }
