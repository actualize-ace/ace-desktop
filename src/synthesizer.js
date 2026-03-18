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

  const prompt = `You are the AI layer of the ACE system. Write a 2-3 sentence synthesis of this system state. Speak directly in second person, no preamble, no labels.${voiceNote ? ` Voice reference: ${voiceNote}` : ''}

State: Mode=${context.mode} Energy=${context.energy} Coherence=${context.coherenceScore}/18 Signals=${context.signals.join(',')} Outcomes=${context.outcomes.map(o => `${o.title}[${o.status}]`).join('|')} Targets=${context.targets.done}/${context.targets.total} Pipeline=${context.pipeline.count}deals/$${context.pipeline.value} Velocity=${context.velocity.thisWeek}vs${context.velocity.lastWeek}lastWeek OverdueFU=${context.overdueFu} ExecutionGap=${context.daysSinceExecution}d

Synthesis:`

  return new Promise(resolve => {
    const proc = execFile(binaryPath, ['--model', 'claude-haiku-4-5-20251001', '-p', prompt], {
      timeout: 20000,
      env: process.env,
    }, (err, stdout) => {
      if (err) { console.error('[synthesizer] claude call failed:', err.message); resolve(null); return }
      resolve(stdout.trim() || null)
    })
    proc.on('error', () => resolve(null))
  })
}

module.exports = { buildStructural, buildContext, getAISynthesis, parseSignalDetails }
