// renderer/views/learn.js
// Onboarding tutorial + persistent knowledge base.

const state = {
  lessons: [],
  progress: null,
  currentLessonId: null,
}

async function loadLessons() {
  state.lessons = await window.ace.learn.list()
  state.progress = await window.ace.learn.state()
}

function lessonsByTrack(track) {
  return state.lessons.filter(l => l.track === track)
}

function isCompleted(id) {
  return state.progress?.lessonsCompleted?.includes(id) || false
}

function renderSidebar() {
  const sidebar = document.getElementById('learn-sidebar')
  if (!sidebar) return
  const essentials = lessonsByTrack('essentials')
  const deeper = lessonsByTrack('deeper')

  const trackMarkup = (title, items) => `
    <div class="learn-track">
      <h3 class="learn-track-title">${title}</h3>
      <ul class="learn-track-list">${items.map(renderRow).join('')}</ul>
    </div>`

  sidebar.innerHTML = [
    trackMarkup('Essentials', essentials),
    deeper.length ? trackMarkup('Deeper', deeper) : '',
  ].join('')

  sidebar.querySelectorAll('[data-lesson-id]').forEach(el => {
    el.addEventListener('click', () => selectLesson(el.dataset.lessonId))
  })
}

function renderRow(lesson) {
  const completed = isCompleted(lesson.id) ? 'completed' : ''
  const active = state.currentLessonId === lesson.id ? 'active' : ''
  return `
    <li class="learn-row ${completed} ${active}" data-lesson-id="${lesson.id}">
      <span class="learn-row-bullet"></span>
      <span class="learn-row-title">${escapeHtml(lesson.title)}</span>
      <span class="learn-row-minutes">${lesson.estimatedMinutes || 1}m</span>
    </li>`
}

function renderHero() {
  if (state.progress?.firstRunComplete) return ''
  const essentials = lessonsByTrack('essentials')
  const completedInTrack = essentials.filter(l => isCompleted(l.id))
  const isReturning = completedInTrack.length > 0
  const nextLesson = essentials.find(l => !isCompleted(l.id)) || essentials[0]
  if (!nextLesson) return ''

  const headline = isReturning ? 'Welcome back' : 'Welcome to ACE'
  const body = isReturning
    ? `You're ${completedInTrack.length} of ${essentials.length} through the essentials. Pick up where you left off.`
    : 'Take twelve minutes to learn the rails. You can skip and come back any time.'

  return `
    <div class="learn-hero">
      <h2 class="learn-hero-title">${headline}</h2>
      <p class="learn-hero-body">${body}</p>
      <div class="learn-hero-actions">
        <button class="learn-hero-start" data-lesson-id="${nextLesson.id}">
          ${isReturning ? 'Continue' : 'Start'} · ${escapeHtml(nextLesson.title)}
        </button>
        <button class="learn-hero-skip">Skip for now</button>
      </div>
    </div>`
}

async function renderContent(lesson) {
  const content = document.getElementById('learn-content')
  if (!content) return

  if (!lesson) {
    const hero = renderHero()
    content.innerHTML = hero || '<p class="learn-empty">Select a lesson.</p>'
    content.querySelector('.learn-hero-start')?.addEventListener('click', (e) => {
      selectLesson(e.currentTarget.dataset.lessonId)
    })
    content.querySelector('.learn-hero-skip')?.addEventListener('click', async () => {
      await window.ace.learn.dismiss()
      state.progress = await window.ace.learn.state()
      updateLearnDot()
      const homeNav = document.querySelector('.nav-item[data-view="home"]')
      homeNav?.click()
    })
    return
  }

  const bodyHtml = window.marked ? window.marked.parse(lesson.body) : `<pre>${escapeHtml(lesson.body)}</pre>`
  const tryItBtn = lesson.tryIt
    ? `<button class="learn-try-it" data-lesson-id="${lesson.id}">Try it</button>`
    : ''

  const allIds = state.lessons.map(l => l.id)
  const idx = allIds.indexOf(lesson.id)
  const prev = idx > 0 ? state.lessons[idx - 1] : null
  const next = idx < state.lessons.length - 1 ? state.lessons[idx + 1] : null

  content.innerHTML = `
    <article class="learn-lesson">
      <div class="learn-lesson-meta">${escapeHtml(lesson.track === 'essentials' ? 'Essentials' : 'Deeper')} · ${lesson.estimatedMinutes || 1} min</div>
      <div class="learn-lesson-body">${bodyHtml}</div>
      ${tryItBtn}
      <div class="learn-nav">
        ${prev ? `<button class="learn-nav-btn learn-nav-prev" data-lesson-id="${prev.id}">← ${escapeHtml(prev.title)}</button>` : '<div></div>'}
        ${next ? `<button class="learn-nav-btn learn-nav-next" data-lesson-id="${next.id}">${escapeHtml(next.title)} →</button>` : '<div></div>'}
      </div>
    </article>`

  content.querySelectorAll('.learn-nav-btn').forEach(btn => {
    btn.addEventListener('click', async () => {
      await window.ace.learn.markCompleted(lesson.id)
      state.progress = await window.ace.learn.state()
      updateLearnDot()
      selectLesson(btn.dataset.lessonId)
    })
  })

  content.querySelector('.learn-try-it')?.addEventListener('click', () => {
    console.warn('[learn] Try-it clicked — spotlight module arrives in Task 8')
  })
}

async function selectLesson(id) {
  state.currentLessonId = id
  renderSidebar()
  const lesson = await window.ace.learn.get(id)
  renderContent(lesson)
}

function updateLearnDot() {
  const dot = document.getElementById('learn-dot')
  if (!dot) return
  dot.hidden = !!state.progress?.firstRunComplete
}

function escapeHtml(str) {
  if (str == null) return ''
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;')
}

export async function initLearn() {
  await loadLessons()
  renderSidebar()
  updateLearnDot()
  if (state.progress?.lastOpenedLesson) {
    await selectLesson(state.progress.lastOpenedLesson)
  } else {
    await renderContent(null)
  }
}

export { updateLearnDot }
