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
  try {
    const filePath = path.join(vaultPath, '04-Network', 'follow-ups.md')
    let text = fs.readFileSync(filePath, 'utf8')

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

      const rowPerson = cells[1].replace(/\[\[(?:[^\]∥]+∥)?([^\]]+)\]\]/g, '$1').replace(/∥/g, '|').trim()
      const rowTopic = cells[2].replace(/∥/g, '|').trim()

      const personMatch = rowPerson.toLowerCase() === (person || '').toLowerCase()
      const topicSnippet = (topic || '').slice(0, 30).toLowerCase()
      const topicMatch = rowTopic.toLowerCase().startsWith(topicSnippet)
      if (!personMatch || !topicMatch) continue

      let newLine = lines[i]
      if (updates.status) {
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

    if (!modified) return { error: `Follow-up not found: ${person} / ${(topic || '').slice(0, 40)}...` }
    fs.writeFileSync(filePath, lines.join('\n'), 'utf8')
    return { ok: true }
  } catch (e) {
    return { error: e.message }
  }
}

module.exports = { markOutcomeComplete, toggleWeeklyTarget, updateFollowUp }
