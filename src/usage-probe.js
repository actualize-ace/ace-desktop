// usage-probe.js — Parses Claude's local JSONL session files for usage data
// No PTY, no process spawn — just file reads

const fs = require('fs')
const path = require('path')
const os = require('os')

function probe() {
  const projectsDir = path.join(os.homedir(), '.claude', 'projects')
  if (!fs.existsSync(projectsDir)) return { session: null, weekly: null, error: 'no projects dir' }

  const now = Date.now()
  const fiveHoursAgo = now - (5 * 60 * 60 * 1000)
  const oneWeekAgo = now - (7 * 24 * 60 * 60 * 1000)
  const oneDayAgo = now - (24 * 60 * 60 * 1000)

  let sessionInput = 0, sessionOutput = 0, sessionCacheRead = 0, sessionCacheCreate = 0
  let weeklyInput = 0, weeklyOutput = 0, weeklyCacheRead = 0, weeklyCacheCreate = 0
  let todayInput = 0, todayOutput = 0
  let sessionCount = 0
  const seenMessages = new Set()

  try {
    const projects = fs.readdirSync(projectsDir, { withFileTypes: true })
    for (const proj of projects) {
      if (!proj.isDirectory()) continue
      const projPath = path.join(projectsDir, proj.name)

      let files
      try { files = fs.readdirSync(projPath).filter(f => f.endsWith('.jsonl')) } catch { continue }

      for (const file of files) {
        const filePath = path.join(projPath, file)
        let stat
        try { stat = fs.statSync(filePath) } catch { continue }
        if (stat.mtimeMs < oneWeekAgo) continue

        // Read tail of file
        const readSize = Math.min(stat.size, 100 * 1024)
        const buffer = Buffer.alloc(readSize)
        let fd
        try {
          fd = fs.openSync(filePath, 'r')
          fs.readSync(fd, buffer, 0, readSize, Math.max(0, stat.size - readSize))
          fs.closeSync(fd)
        } catch { continue }

        const lines = buffer.toString('utf8').split('\n')
        for (const line of lines) {
          if (!line.includes('"type":"assistant"') || !line.includes('"usage"')) continue
          try {
            const obj = JSON.parse(line)
            if (obj.type !== 'assistant') continue
            const usage = obj.message?.usage
            if (!usage) continue

            // Deduplicate by message ID + request ID
            const msgId = obj.message?.id
            const reqId = obj.requestId
            if (msgId && reqId) {
              const key = `${msgId}:${reqId}`
              if (seenMessages.has(key)) continue
              seenMessages.add(key)
            }

            const ts = obj.timestamp ? new Date(obj.timestamp).getTime() : 0
            const input = usage.input_tokens || 0
            const output = usage.output_tokens || 0
            const cacheRead = usage.cache_read_input_tokens || 0
            const cacheCreate = usage.cache_creation_input_tokens || 0

            if (ts > fiveHoursAgo) {
              sessionInput += input; sessionOutput += output
              sessionCacheRead += cacheRead; sessionCacheCreate += cacheCreate
              sessionCount++
            }
            if (ts > oneWeekAgo) {
              weeklyInput += input; weeklyOutput += output
              weeklyCacheRead += cacheRead; weeklyCacheCreate += cacheCreate
            }
            if (ts > oneDayAgo) {
              todayInput += input; todayOutput += output
            }
          } catch {}
        }
      }
    }
  } catch (e) {
    return { session: null, weekly: null, error: e.message }
  }

  const sessionTotal = sessionInput + sessionOutput + sessionCacheRead + sessionCacheCreate
  const weeklyTotal = weeklyInput + weeklyOutput + weeklyCacheRead + weeklyCacheCreate
  const todayTotal = todayInput + todayOutput

  return {
    session: {
      tokens: sessionTotal,
      input: sessionInput,
      output: sessionOutput,
      requests: sessionCount,
    },
    weekly: {
      tokens: weeklyTotal,
      input: weeklyInput,
      output: weeklyOutput,
    },
    today: {
      tokens: todayTotal,
      input: todayInput,
      output: todayOutput,
    },
  }
}

module.exports = { probe }
