const fs = require('fs')
const path = require('path')
const yaml = require('js-yaml')

const LESSONS_DIR = path.join(__dirname, '..', 'renderer', 'data', 'learn')

function parseLessonFile(filePath) {
  const raw = fs.readFileSync(filePath, 'utf8')
  const match = raw.match(/^---\r?\n([\s\S]*?)\r?\n---\r?\n?([\s\S]*)$/)
  if (!match) return null
  let frontmatter
  try {
    frontmatter = yaml.load(match[1]) || {}
  } catch (e) {
    console.warn('[learn-reader] frontmatter parse failed for', filePath, e.message)
    return null
  }
  return { ...frontmatter, body: match[2] }
}

function listLessons() {
  if (!fs.existsSync(LESSONS_DIR)) return []
  return fs.readdirSync(LESSONS_DIR)
    .filter(f => f.endsWith('.md') && f !== 'README.md')
    .map(f => {
      const parsed = parseLessonFile(path.join(LESSONS_DIR, f))
      if (!parsed) return null
      const { body, ...meta } = parsed
      return meta
    })
    .filter(Boolean)
    .sort((a, b) => {
      if (a.track !== b.track) return a.track === 'essentials' ? -1 : 1
      return (a.order || 99) - (b.order || 99)
    })
}

function getLesson(id) {
  if (!id || typeof id !== 'string') return null
  const safeId = id.replace(/[^a-z0-9-]/gi, '')
  if (safeId !== id) return null
  const filePath = path.join(LESSONS_DIR, `${safeId}.md`)
  if (!fs.existsSync(filePath)) return null
  return parseLessonFile(filePath)
}

module.exports = { listLessons, getLesson }
