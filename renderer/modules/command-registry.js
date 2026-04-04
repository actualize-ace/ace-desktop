// renderer/modules/command-registry.js
// Single source of truth for all navigable items in ACE Desktop.

export const VIEWS = [
  { type: 'view', id: 'home',      label: 'Home',      icon: '⌂', keywords: ['dashboard', 'overview'] },
  { type: 'view', id: 'terminal',  label: 'Terminal',   icon: '▸', keywords: ['chat', 'session', 'cli'] },
  { type: 'view', id: 'agents',    label: 'Agents',     icon: '◎', keywords: ['parallel', 'subagent'] },
  { type: 'view', id: 'vault',     label: 'Vault',      icon: '☰', keywords: ['files', 'browser', 'editor'] },
  { type: 'view', id: 'graph',     label: 'Graph',      icon: '⬡', keywords: ['connections', 'network', 'links'] },
  { type: 'view', id: 'people',    label: 'People',     icon: '♟', keywords: ['contacts', 'network', 'followups'] },
  { type: 'view', id: 'history',   label: 'History',    icon: '◷', keywords: ['sessions', 'past', 'search'] },
  { type: 'view', id: 'artifacts', label: 'Artifacts',  icon: '▦', keywords: ['creative', 'library', 'assets'] },
  { type: 'view', id: 'pipeline',  label: 'Pipeline',   icon: '→', keywords: ['deals', 'sales', 'revenue'] },
  { type: 'view', id: 'breath',    label: 'Breath',     icon: '◉', keywords: ['breathing', 'regulate', 'somatic'] },
]

export const COMMANDS = [
  { type: 'command', cmd: '/start',               label: 'start',               description: 'Morning day-start protocol' },
  { type: 'command', cmd: '/brief',               label: 'brief',               description: 'Morning orientation briefing' },
  { type: 'command', cmd: '/pulse',               label: 'pulse',               description: 'Triad health diagnostic' },
  { type: 'command', cmd: '/eod',                 label: 'eod',                 description: 'End-of-day closure' },
  { type: 'command', cmd: '/coach',               label: 'coach',               description: 'Open-ended coaching conversation' },
  { type: 'command', cmd: '/close',               label: 'close',               description: 'Session close and handoff' },
  { type: 'command', cmd: '/prep',                label: 'prep',                description: 'Meeting preparation briefing' },
  { type: 'command', cmd: '/triage',              label: 'triage',              description: 'Route inbox items' },
  { type: 'command', cmd: '/weekly-review',       label: 'weekly-review',       description: 'Weekly reflection and calibration' },
  { type: 'command', cmd: '/monthly-reflection',  label: 'monthly-reflection',  description: 'Monthly coaching review' },
  { type: 'command', cmd: '/edge',                label: 'edge',                description: 'Growth edge inquiry' },
  { type: 'command', cmd: '/regulate',            label: 'regulate',            description: 'Nervous system check-in' },
  { type: 'command', cmd: '/blind-spots',         label: 'blind-spots',         description: 'Surface what you might be missing' },
  { type: 'command', cmd: '/audit-energy',        label: 'audit-energy',        description: 'Boundary and energy review' },
  { type: 'command', cmd: '/state',               label: 'state',               description: 'Mid-session energy update' },
  { type: 'command', cmd: '/followup',            label: 'followup',            description: 'Review commitments and follow-ups' },
  { type: 'command', cmd: '/pipeline',            label: 'pipeline',            description: 'Sales pipeline tracker' },
  { type: 'command', cmd: '/revenue',             label: 'revenue',             description: 'Revenue dashboard' },
  { type: 'command', cmd: '/content',             label: 'content',             description: 'Content lifecycle tracker' },
  { type: 'command', cmd: '/emails',              label: 'emails',              description: 'Process unread emails' },
  { type: 'command', cmd: '/intel',               label: 'intel',               description: 'Newsletter intelligence' },
  { type: 'command', cmd: '/sync',                label: 'sync',                description: 'Sync business metrics' },
  { type: 'command', cmd: '/commit',              label: 'commit',              description: 'Commit and push to GitHub' },
  { type: 'command', cmd: '/release',             label: 'release',             description: 'Push updates to ace-core' },
  { type: 'command', cmd: '/culturescan',         label: 'culturescan',         description: 'Reddit cultural intelligence' },
  { type: 'command', cmd: '/signal',              label: 'signal',              description: 'Weekly signal engine' },
]

// ─── Fuzzy match ──────────────────────────────────────────────

function fuzzyScore(query, text) {
  const q = query.toLowerCase()
  const t = text.toLowerCase()
  if (!q) return 1  // empty query matches everything

  let qi = 0, score = 0, consecutive = 0, lastMatchIdx = -2

  for (let ti = 0; ti < t.length && qi < q.length; ti++) {
    if (t[ti] === q[qi]) {
      score += 1
      // Bonus: consecutive match
      if (ti === lastMatchIdx + 1) {
        consecutive++
        score += consecutive * 2
      } else {
        consecutive = 0
      }
      // Bonus: word boundary (start of string or after - / space)
      if (ti === 0 || '-/ '.includes(t[ti - 1])) score += 5
      lastMatchIdx = ti
      qi++
    }
  }
  return qi === q.length ? score : 0
}

function scoreItem(query, item) {
  const fields = item.type === 'view'
    ? [item.label, ...item.keywords]
    : [item.cmd, item.label, item.description]
  let best = 0
  for (const f of fields) {
    const s = fuzzyScore(query, f)
    if (s > best) best = s
  }
  return best
}

// ─── Search (returns grouped results) ─────────────────────────

export function search(query) {
  const q = query.trim()
  const viewResults = []
  const cmdResults = []

  for (const v of VIEWS) {
    const s = scoreItem(q, v)
    if (s > 0) viewResults.push({ ...v, score: s })
  }
  for (const c of COMMANDS) {
    const s = scoreItem(q, c)
    if (s > 0) cmdResults.push({ ...c, score: s })
  }

  viewResults.sort((a, b) => b.score - a.score)
  cmdResults.sort((a, b) => b.score - a.score)

  return { views: viewResults, commands: cmdResults }
}

// ─── Flat command list (for settings.js compatibility) ────────

export const ALL_COMMAND_NAMES = COMMANDS.map(c => c.cmd)
