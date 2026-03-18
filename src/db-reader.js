const path = require('path')

let db = null

function open(vaultPath) {
  try {
    const Database = require('better-sqlite3')
    const dbPath = path.join(vaultPath, 'tools', 'ace-analytics', 'ace.db')
    db = new Database(dbPath, { readonly: true })
  } catch (e) {
    db = null
    console.error('[db-reader] open failed:', e.message)
  }
}

function getPipeline() {
  if (!db) return []
  try {
    return db.prepare(`
      SELECT person, product, stage, amount, currency, next_action, due_date, updated_at
      FROM deals
      WHERE outcome IS NULL OR outcome NOT IN ('won', 'lost')
      ORDER BY
        CASE stage
          WHEN 'closing'      THEN 1
          WHEN 'proposal'     THEN 2
          WHEN 'conversation' THEN 3
          WHEN 'lead'         THEN 4
          ELSE 5
        END,
        due_date ASC
    `).all()
  } catch (e) {
    return { error: e.message }
  }
}

function getMetrics() {
  if (!db) return {}
  try {
    // Latest value per metric
    const rows = db.prepare(`
      SELECT metric, value, recorded_at
      FROM metrics
      ORDER BY recorded_at DESC
    `).all()
    const latest = {}
    for (const row of rows) {
      if (!latest[row.metric]) latest[row.metric] = row
    }

    // MTD revenue
    const month = new Date().toISOString().slice(0, 7)
    const mtd = db.prepare(`SELECT SUM(amount) as total FROM revenue_events WHERE event_date LIKE ?`).get(month + '%')

    // YTD revenue
    const year = new Date().getFullYear().toString()
    const ytd = db.prepare(`SELECT SUM(amount) as total FROM revenue_events WHERE event_date LIKE ?`).get(year + '%')

    return {
      ...latest,
      _stats: {
        subscribers: latest['total_subscribers'] ? latest['total_subscribers'].value : 0,
        mtdRevenue:  mtd ? (mtd.total || 0) : 0,
        ytdRevenue:  ytd ? (ytd.total || 0) : 0,
      },
    }
  } catch (e) {
    return { error: e.message }
  }
}

module.exports = { open, getPipeline, getMetrics }
