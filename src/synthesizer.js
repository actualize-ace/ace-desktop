// src/synthesizer.js
// Provides structural health summary (instant) and AI synthesis call (async via Anthropic SDK)

const Anthropic = require('@anthropic-ai/sdk')
const fs        = require('fs')
const path      = require('path')

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

// ─── AI synthesis (Anthropic SDK) ────────────────────────────────────────────

async function getAISynthesis(context, voicePath) {
  if (!process.env.ANTHROPIC_API_KEY) return null

  let voiceNote = ''
  try {
    const raw = fs.readFileSync(voicePath, 'utf8')
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
