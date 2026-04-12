# Onboarding Tutorial + Learn Tab — Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Ship a first-run interactive tutorial and a persistent knowledge base for ACE Desktop. New clients go from "installed" to "daily-ritual competent" in ~12 minutes without a live call. Last non-signing blocker for Phase 1 Mac ship.

**Architecture:** New `Learn` view mounted as a permanent sidebar tab. Content = bundled markdown in `renderer/data/learn/` with YAML frontmatter. Curriculum sidebar + content pane layout. Four lessons use an overlay spotlight (new `learn-coach.js` module) driven by `data-learn-target` attributes on real UI elements. Progress persists in `ace-config.json`. First-run auto-routes to Learn; Skip is always one click away.

**Tech Stack:** Electron 34, vanilla JS (no framework), `marked.js` (already bundled) for markdown rendering, existing `patchConfig()` for persistence, existing IPC bridge.

**Design Doc:** [2026-04-12-onboarding-tutorial-design.md](2026-04-12-onboarding-tutorial-design.md)

**Branch:** `desktop-onboarding-tutorial` (already cut)

**Out of scope for this sprint:**
- Deeper track lesson content (Insight, Breath, Oracle, Astro, Artifacts, People, Graph, Agent Terminal, Lean mode, Settings). Infrastructure supports it; content authoring deferred.
- Vault-driven content sync
- Search across lessons
- Video demos

---

## Verification Convention

ace-desktop has no test framework. Each task ends with a **manual verification** step — observable outcomes via `npm start` + DevTools. Per memory (`feedback_incremental_edits_only.md`), one change per commit, test between edits, never batch.

**Restart procedure** (per `feedback_ace_desktop_restart.md`): kill Electron by PID, not `pkill`:

```bash
ps aux | grep -i electron | grep -v grep | awk '{print $2}' | xargs kill -9 2>/dev/null
cd ace-desktop && npm start
```

---

## Task 1: Lesson content directory + frontmatter loader (main process)

**Files:**
- Create: `ace-desktop/renderer/data/learn/01-welcome.md` (placeholder)
- Create: `ace-desktop/renderer/data/learn/README.md` (authoring notes)
- Modify: `ace-desktop/main.js` (add IPC handlers)
- Modify: `ace-desktop/preload.js` (expose `ace.learn`)

**Step 1: Create `renderer/data/learn/` with placeholder lesson**

Write `renderer/data/learn/01-welcome.md`:

```markdown
---
id: 01-welcome
title: Welcome to ACE
track: essentials
order: 1
estimatedMinutes: 1
---

# Welcome to ACE

Placeholder content. Replaced in Task 13.
```

Write `renderer/data/learn/README.md` (authoring notes: frontmatter schema, content conventions, where screenshots go).

**Step 2: Add IPC handlers in `main.js`**

Near the other `ipcMain.handle` registrations, add:

```javascript
const yaml = require('js-yaml') // install if not present
const LESSONS_DIR = path.join(__dirname, 'renderer', 'data', 'learn')

function parseLessonFile(filePath) {
  const raw = fs.readFileSync(filePath, 'utf8')
  const match = raw.match(/^---\n([\s\S]*?)\n---\n([\s\S]*)$/)
  if (!match) return null
  const frontmatter = yaml.load(match[1]) || {}
  const body = match[2]
  return { ...frontmatter, body }
}

ipcMain.handle('learn:list', () => {
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
    .sort((a, b) => (a.order || 99) - (b.order || 99))
})

ipcMain.handle('learn:get', (_event, id) => {
  const filePath = path.join(LESSONS_DIR, `${id}.md`)
  if (!fs.existsSync(filePath)) return null
  return parseLessonFile(filePath)
})
```

Install `js-yaml` if not already in package.json:

```bash
cd ace-desktop && npm install js-yaml --save
```

**Step 3: Expose via `preload.js`**

Add to the contextBridge `ace` namespace:

```javascript
learn: {
  list: () => ipcRenderer.invoke('learn:list'),
  get: (id) => ipcRenderer.invoke('learn:get', id),
},
```

**Step 4: Manual verification**

Restart app. Open DevTools console. Run:

```javascript
await window.ace.learn.list()
// Expected: [{ id: '01-welcome', title: 'Welcome to ACE', track: 'essentials', order: 1, estimatedMinutes: 1 }]

await window.ace.learn.get('01-welcome')
// Expected: same object plus body: '# Welcome to ACE\n\nPlaceholder...'
```

**Step 5: Commit**

```bash
git add ace-desktop/renderer/data/learn/ ace-desktop/main.js ace-desktop/preload.js ace-desktop/package.json ace-desktop/package-lock.json
git commit -m "feat(ace-desktop): lesson content loader + IPC bridge"
```

---

## Task 2: Sidebar Learn tab + view switching

**Files:**
- Modify: `ace-desktop/renderer/index.html` (add nav-item + view container)
- Create: `ace-desktop/renderer/views/learn.js` (stub)
- Create: `ace-desktop/renderer/styles/views/learn.css`
- Modify: `ace-desktop/renderer/app.js` (register view in switcher)

**Step 1: Add nav-item to `index.html`**

In the `.sidebar-pinned` section (near Settings, around line 226+), add:

```html
<div class="nav-item" data-view="learn" id="nav-learn">
  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5">
    <path d="M4 4v16M4 4h10a4 4 0 014 4v12a4 4 0 00-4-4H4"/>
    <path d="M20 4v16M20 4H10a4 4 0 00-4 4v12a4 4 0 014-4h10"/>
  </svg>
  <span>Learn</span>
  <span class="nav-dot" id="learn-dot" hidden></span>
</div>
```

Add matching view container after the last existing `.view` element:

```html
<div class="view" id="view-learn">
  <div class="learn-container">
    <aside class="learn-sidebar"></aside>
    <section class="learn-content"><p class="learn-empty">Select a lesson.</p></section>
  </div>
</div>
```

**Step 2: Create `renderer/styles/views/learn.css`**

Per `feedback_view_display_override.md`: do NOT use `#view-learn { display: flex }`. Use `.view` / `.view.active` toggle.

```css
.learn-container {
  display: flex;
  height: 100%;
  overflow: hidden;
}
.learn-sidebar {
  width: 320px;
  flex-shrink: 0;
  overflow-y: auto;
  border-right: 1px solid var(--border);
  padding: 24px 16px;
}
.learn-content {
  flex: 1;
  overflow-y: auto;
  padding: 32px 48px;
  max-width: 720px;
}
.learn-empty { color: var(--text-dim); }
.nav-dot {
  width: 6px;
  height: 6px;
  border-radius: 50%;
  background: #d4a574;
  margin-left: auto;
}
.nav-dot[hidden] { display: none; }
```

Register the stylesheet in `index.html` alongside other view CSS.

**Step 3: Create `renderer/views/learn.js` (stub)**

```javascript
export const learnView = {
  mount() {
    console.log('[learn] mount')
  },
  unmount() {},
}
```

**Step 4: Register view in `app.js`**

Find the view registration block (where `vault`, `graph`, etc. are registered). Add `learn` alongside. Match existing pattern exactly.

**Step 5: Manual verification**

Restart app. Click "Learn" in sidebar. Expected:
- View switches (home becomes inactive, view-learn becomes active)
- Content area shows "Select a lesson."
- Left sidebar pane is empty (rendering comes next task)
- No console errors

**Step 6: Commit**

```bash
git add ace-desktop/renderer/index.html ace-desktop/renderer/views/learn.js ace-desktop/renderer/styles/views/learn.css ace-desktop/renderer/app.js
git commit -m "feat(ace-desktop): Learn tab + view scaffold"
```

---

## Task 3: Curriculum sidebar rendering (Essentials + Deeper sections)

**Files:**
- Modify: `ace-desktop/renderer/views/learn.js`
- Modify: `ace-desktop/renderer/styles/views/learn.css`

**Step 1: Add two more placeholder lessons**

Create `02-vault.md` (essentials, order 2) and `deep-01-insight.md` (track: deeper, order: 1). Minimal frontmatter + placeholder body. This gives the sidebar two groups to render.

**Step 2: Render curriculum**

Replace `learn.js` with:

```javascript
let lessons = []
let currentLessonId = null

async function loadLessons() {
  lessons = await window.ace.learn.list()
}

function renderSidebar() {
  const sidebar = document.querySelector('#view-learn .learn-sidebar')
  const essentials = lessons.filter(l => l.track === 'essentials')
  const deeper = lessons.filter(l => l.track === 'deeper')

  sidebar.innerHTML = `
    <div class="learn-track">
      <h3 class="learn-track-title">Essentials</h3>
      <ul class="learn-track-list">
        ${essentials.map(renderLessonRow).join('')}
      </ul>
    </div>
    <div class="learn-track">
      <h3 class="learn-track-title">Deeper</h3>
      <ul class="learn-track-list">
        ${deeper.map(renderLessonRow).join('')}
      </ul>
    </div>
  `

  sidebar.querySelectorAll('[data-lesson-id]').forEach(el => {
    el.addEventListener('click', () => selectLesson(el.dataset.lessonId))
  })
}

function renderLessonRow(lesson) {
  return `
    <li class="learn-row" data-lesson-id="${lesson.id}">
      <span class="learn-row-bullet"></span>
      <span class="learn-row-title">${lesson.title}</span>
      <span class="learn-row-minutes">${lesson.estimatedMinutes || 1}m</span>
    </li>
  `
}

function selectLesson(id) {
  currentLessonId = id
  document.querySelectorAll('[data-lesson-id]').forEach(el => {
    el.classList.toggle('active', el.dataset.lessonId === id)
  })
  // Content pane rendering in Task 4
}

export const learnView = {
  async mount() {
    await loadLessons()
    renderSidebar()
  },
  unmount() {},
}
```

**Step 3: Style the rows**

Append to `learn.css`:

```css
.learn-track { margin-bottom: 24px; }
.learn-track-title {
  font-size: 11px;
  font-weight: 600;
  text-transform: uppercase;
  letter-spacing: 0.1em;
  color: var(--text-dim);
  margin: 0 0 12px 4px;
}
.learn-track-list { list-style: none; padding: 0; margin: 0; }
.learn-row {
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 8px 12px;
  border-radius: 8px;
  cursor: pointer;
  font-size: 13px;
  color: var(--text);
  transition: background 0.15s;
}
.learn-row:hover { background: var(--surface-hover); }
.learn-row.active { background: var(--surface-active); }
.learn-row-bullet {
  width: 10px;
  height: 10px;
  border-radius: 50%;
  border: 1.5px solid var(--text-dim);
  flex-shrink: 0;
}
.learn-row.completed .learn-row-bullet { background: #d4a574; border-color: #d4a574; }
.learn-row-title { flex: 1; }
.learn-row-minutes { font-size: 11px; color: var(--text-dim); }
```

**Step 4: Manual verification**

Restart. Click Learn. Expected:
- Two sections: "Essentials" (2 lessons) and "Deeper" (1 lesson)
- Click a lesson row → row gets `active` class (background highlight)
- Lessons ordered by `order` field within each track

**Step 5: Commit**

```bash
git add -A ace-desktop/renderer/
git commit -m "feat(ace-desktop): curriculum sidebar rendering"
```

---

## Task 4: Content pane rendering with marked.js + Prev/Next

**Files:**
- Modify: `ace-desktop/renderer/views/learn.js`
- Modify: `ace-desktop/renderer/styles/views/learn.css`

**Step 1: Confirm marked.js is available**

Check `renderer/index.html` — `marked.min.js` should already be loaded (used by chat-renderer). If not, add:

```html
<script src="lib/marked.min.js"></script>
```

**Step 2: Extend `selectLesson` to render content**

```javascript
async function selectLesson(id) {
  currentLessonId = id
  document.querySelectorAll('[data-lesson-id]').forEach(el => {
    el.classList.toggle('active', el.dataset.lessonId === id)
  })
  const lesson = await window.ace.learn.get(id)
  renderContent(lesson)
}

function renderContent(lesson) {
  const content = document.querySelector('#view-learn .learn-content')
  if (!lesson) {
    content.innerHTML = '<p class="learn-empty">Lesson not found.</p>'
    return
  }

  const bodyHtml = window.marked.parse(lesson.body)
  const tryItButton = lesson.tryIt
    ? `<button class="learn-try-it" data-lesson-id="${lesson.id}">Try it</button>`
    : ''

  const allIds = lessons.map(l => l.id)
  const idx = allIds.indexOf(lesson.id)
  const prev = idx > 0 ? lessons[idx - 1] : null
  const next = idx < lessons.length - 1 ? lessons[idx + 1] : null

  content.innerHTML = `
    <div class="learn-lesson-body">${bodyHtml}</div>
    ${tryItButton}
    <div class="learn-nav">
      ${prev ? `<button class="learn-nav-prev" data-lesson-id="${prev.id}">← ${prev.title}</button>` : '<div></div>'}
      ${next ? `<button class="learn-nav-next" data-lesson-id="${next.id}">${next.title} →</button>` : ''}
    </div>
  `

  content.querySelectorAll('.learn-nav-prev, .learn-nav-next').forEach(btn => {
    btn.addEventListener('click', () => selectLesson(btn.dataset.lessonId))
  })
  // Try it wiring in Task 8
}
```

**Step 3: Style the content pane**

Append to `learn.css`:

```css
.learn-lesson-body { font-size: 15px; line-height: 1.7; color: var(--text); }
.learn-lesson-body h1 { font-size: 28px; margin: 0 0 16px; color: var(--text-bright); }
.learn-lesson-body h2 { font-size: 20px; margin: 32px 0 12px; color: var(--text-bright); }
.learn-lesson-body p { margin: 0 0 16px; }
.learn-lesson-body code { background: var(--surface); padding: 2px 6px; border-radius: 4px; font-size: 13px; }
.learn-lesson-body pre { background: var(--surface); padding: 12px; border-radius: 8px; overflow-x: auto; }
.learn-try-it {
  display: inline-block;
  margin: 24px 0;
  padding: 10px 20px;
  background: #d4a574;
  color: #000;
  border: none;
  border-radius: 8px;
  font-weight: 600;
  cursor: pointer;
}
.learn-nav {
  display: flex;
  justify-content: space-between;
  margin-top: 48px;
  padding-top: 24px;
  border-top: 1px solid var(--border);
}
.learn-nav button {
  background: none;
  border: 1px solid var(--border);
  color: var(--text);
  padding: 10px 16px;
  border-radius: 8px;
  cursor: pointer;
  font-size: 13px;
}
.learn-nav button:hover { background: var(--surface-hover); }
```

**Step 4: Manual verification**

Restart. Click Learn, click a lesson. Expected:
- Markdown body renders with headings/paragraphs/code styled
- Prev/Next buttons at bottom show sibling lessons
- Clicking Next/Prev navigates and the sidebar active state updates
- Lessons without `tryIt` frontmatter: no "Try it" button

**Step 5: Commit**

```bash
git add -A ace-desktop/renderer/
git commit -m "feat(ace-desktop): learn content pane + navigation"
```

---

## Task 5: Config persistence for learn progress

**Files:**
- Modify: `ace-desktop/main.js` (default config schema)
- Modify: `ace-desktop/preload.js` (progress API)
- Modify: `ace-desktop/renderer/views/learn.js` (read + write progress)

**Step 1: Add `learn` to default config schema**

Find the default config shape in `main.js` (where `ace-config.json` is initialized). Add:

```javascript
learn: {
  firstRunComplete: false,
  lessonsCompleted: [],
  lastOpenedLesson: null,
  dismissedFirstRun: false,
}
```

Ensure this merges non-destructively for existing configs (users who already have `ace-config.json`).

**Step 2: Add IPC for patching learn state**

If there's already a generic `config:patch` handler, reuse it. Otherwise add:

```javascript
ipcMain.handle('learn:markCompleted', (_event, lessonId) => {
  const config = readConfig()
  const completed = new Set(config.learn?.lessonsCompleted || [])
  completed.add(lessonId)
  config.learn = { ...config.learn, lessonsCompleted: [...completed], lastOpenedLesson: lessonId }
  writeConfig(config)
  return config.learn
})

ipcMain.handle('learn:setDismissed', () => {
  const config = readConfig()
  config.learn = { ...config.learn, dismissedFirstRun: true }
  writeConfig(config)
  return config.learn
})

ipcMain.handle('learn:getState', () => {
  return readConfig().learn || {}
})
```

**Step 3: Expose via preload**

```javascript
learn: {
  list: () => ipcRenderer.invoke('learn:list'),
  get: (id) => ipcRenderer.invoke('learn:get', id),
  state: () => ipcRenderer.invoke('learn:getState'),
  markCompleted: (id) => ipcRenderer.invoke('learn:markCompleted', id),
  dismiss: () => ipcRenderer.invoke('learn:setDismissed'),
},
```

**Step 4: Wire progress into `learn.js`**

```javascript
let progress = { lessonsCompleted: [], lastOpenedLesson: null }

export const learnView = {
  async mount() {
    await loadLessons()
    progress = await window.ace.learn.state()
    renderSidebar()
    if (progress.lastOpenedLesson) selectLesson(progress.lastOpenedLesson)
  },
  unmount() {},
}
```

Update `renderLessonRow` to add `completed` class when `progress.lessonsCompleted.includes(lesson.id)`.

Update `selectLesson` to mark-complete when the user scrolls past the content OR clicks Next (simpler: on Next click, call `markCompleted`). For this task, just mark complete on Next click.

**Step 5: Manual verification**

Restart app (fresh). Click Learn, click lesson 1, click Next. Close app. Restart. Click Learn. Expected:
- Lesson 1 shows completed bullet (gold-filled)
- Lesson 2 is active (lastOpenedLesson was set when selected via Next)
- `cat "$HOME/Library/Application Support/ACE/ace-config.json" | jq .learn` shows the correct state

**Step 6: Commit**

```bash
git add -A ace-desktop/
git commit -m "feat(ace-desktop): persist learn progress to ace-config.json"
```

---

## Task 6: First-run routing to Learn view

**Files:**
- Modify: `ace-desktop/renderer/app.js` (startup view logic)
- Modify: `ace-desktop/renderer/views/learn.js` (Skip button)

**Step 1: Find the app startup view-selection code**

In `app.js`, find where the initial active view is set on load (likely defaulting to `home`). Wrap with:

```javascript
async function decideStartupView() {
  const learnState = await window.ace.learn.state()
  const shouldShowFirstRun =
    learnState && !learnState.firstRunComplete && !learnState.dismissedFirstRun
  return shouldShowFirstRun ? 'learn' : 'home'
}
```

Use this return value to set the initial view.

**Step 2: Add Skip / Continue hero to Learn view for first-run state**

At the top of the Learn content pane, render a first-run hero only when `!firstRunComplete`:

```javascript
function renderFirstRunHero() {
  const learnState = progress
  if (learnState.firstRunComplete) return ''
  const essentials = lessons.filter(l => l.track === 'essentials')
  const completedInTrack = essentials.filter(l => learnState.lessonsCompleted.includes(l.id))
  const isReturning = completedInTrack.length > 0
  const nextLesson = essentials.find(l => !learnState.lessonsCompleted.includes(l.id)) || essentials[0]

  return `
    <div class="learn-hero">
      <h2>${isReturning ? 'Welcome back' : 'Welcome to ACE'}</h2>
      <p>${isReturning
        ? `You're ${completedInTrack.length} of ${essentials.length} through the essentials.`
        : 'Take 12 minutes to learn the essentials. You can skip and come back any time.'}</p>
      <div class="learn-hero-actions">
        <button class="learn-hero-start" data-lesson-id="${nextLesson.id}">
          ${isReturning ? 'Continue' : 'Start'} — ${nextLesson.title}
        </button>
        <button class="learn-hero-skip">Skip for now</button>
      </div>
    </div>
  `
}
```

Wire the Skip button handler:

```javascript
content.querySelector('.learn-hero-skip')?.addEventListener('click', async () => {
  await window.ace.learn.dismiss()
  window.app.switchView('home')
})
```

Show the hero when no lesson is selected (empty content pane default).

**Step 3: Mark `firstRunComplete` when all essentials done**

In `markCompleted` IPC handler, check if all essentials IDs are in `lessonsCompleted`. If yes, set `firstRunComplete: true`.

**Step 4: Manual verification**

- Delete `ace-config.json` to simulate fresh install:

```bash
rm ~/Library/Application\ Support/ACE/ace-config.json
```

- Restart. Expected: app lands on Learn view, hero shows "Welcome to ACE" + Start/Skip buttons.
- Click Skip. Expected: routes to Home. Verify config: `dismissedFirstRun: true`.
- Restart again. Expected: lands on Home (Skip was persistent), Learn tab still clickable.
- Complete essentials lessons. Expected: hero disappears on next Learn visit, `firstRunComplete: true`.

**Step 5: Commit**

```bash
git add -A ace-desktop/
git commit -m "feat(ace-desktop): first-run routing + Skip/Continue hero"
```

---

## Task 7: Sidebar dot indicator

**Files:**
- Modify: `ace-desktop/renderer/app.js` (or wherever sidebar state updates live)

**Step 1: Show dot when `firstRunComplete === false`**

Add a helper:

```javascript
async function updateLearnDot() {
  const state = await window.ace.learn.state()
  const dot = document.getElementById('learn-dot')
  if (!dot) return
  dot.hidden = !!state.firstRunComplete
}
```

Call `updateLearnDot()`:
- On app mount
- After any `markCompleted` call
- After any `dismiss` call

**Step 2: Manual verification**

Fresh install → dot present on Learn nav item. Complete all essentials lessons → dot disappears. Restart → still gone.

**Step 3: Commit**

```bash
git add -A ace-desktop/
git commit -m "feat(ace-desktop): learn tab dot indicator during first run"
```

---

## Task 8: Spotlight overlay module — backdrop + cutout + basic tooltip

**Files:**
- Create: `ace-desktop/renderer/modules/learn-coach.js`
- Create: `ace-desktop/renderer/styles/learn-coach.css`
- Modify: `ace-desktop/renderer/index.html` (load coach CSS)
- Modify: `ace-desktop/renderer/views/learn.js` (wire Try-it button)

**Step 1: Create `learn-coach.js`**

```javascript
let activeOverlay = null

export function startSpotlight({ targets, onComplete, onCancel }) {
  if (activeOverlay) stopSpotlight()
  let idx = 0

  const backdrop = document.createElement('div')
  backdrop.className = 'learn-coach-backdrop'
  backdrop.innerHTML = `
    <svg class="learn-coach-svg" width="100%" height="100%">
      <defs>
        <mask id="learn-coach-mask">
          <rect width="100%" height="100%" fill="white"/>
          <rect id="learn-coach-cutout" fill="black" rx="8"/>
        </mask>
      </defs>
      <rect width="100%" height="100%" fill="rgba(0,0,0,0.6)" mask="url(#learn-coach-mask)"/>
    </svg>
    <div class="learn-coach-tooltip">
      <div class="learn-coach-tip-body"></div>
      <div class="learn-coach-tip-nav">
        <span class="learn-coach-progress"></span>
        <button class="learn-coach-next">Next</button>
      </div>
    </div>
  `
  document.body.appendChild(backdrop)
  activeOverlay = backdrop

  function positionStep() {
    const target = targets[idx]
    const el = document.querySelector(target.selector)
    if (!el) {
      console.warn('[learn-coach] target not found:', target.selector)
      advance()
      return
    }
    const rect = el.getBoundingClientRect()
    const cutout = backdrop.querySelector('#learn-coach-cutout')
    cutout.setAttribute('x', rect.left - 8)
    cutout.setAttribute('y', rect.top - 8)
    cutout.setAttribute('width', rect.width + 16)
    cutout.setAttribute('height', rect.height + 16)

    backdrop.querySelector('.learn-coach-tip-body').innerHTML = target.tooltip
    backdrop.querySelector('.learn-coach-progress').textContent = `${idx + 1} / ${targets.length}`
    backdrop.querySelector('.learn-coach-next').textContent =
      idx === targets.length - 1 ? 'Got it' : 'Next'

    positionTooltip(backdrop.querySelector('.learn-coach-tooltip'), rect)
  }

  function advance() {
    if (idx === targets.length - 1) {
      stopSpotlight()
      onComplete?.()
    } else {
      idx++
      positionStep()
    }
  }

  backdrop.querySelector('.learn-coach-next').addEventListener('click', advance)
  backdrop.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') { stopSpotlight(); onCancel?.() }
  })
  document.addEventListener('keydown', handleKey)
  function handleKey(e) { if (e.key === 'Escape') { stopSpotlight(); onCancel?.() } }
  backdrop.__handleKey = handleKey

  positionStep()
}

export function stopSpotlight() {
  if (!activeOverlay) return
  document.removeEventListener('keydown', activeOverlay.__handleKey)
  activeOverlay.remove()
  activeOverlay = null
}

function positionTooltip(tooltip, targetRect) {
  // Task 9 will refine this. Task 8 uses a simple below-target placement.
  tooltip.style.left = `${targetRect.left}px`
  tooltip.style.top = `${targetRect.bottom + 16}px`
}
```

**Step 2: Styles**

`renderer/styles/learn-coach.css`:

```css
.learn-coach-backdrop {
  position: fixed;
  inset: 0;
  z-index: 10000;
  pointer-events: auto;
}
.learn-coach-svg {
  position: absolute;
  inset: 0;
  pointer-events: none;
}
.learn-coach-tooltip {
  position: absolute;
  background: var(--surface);
  border: 1px solid var(--border);
  border-radius: 12px;
  padding: 16px 20px;
  max-width: 320px;
  box-shadow: 0 8px 32px rgba(0,0,0,0.4);
  color: var(--text);
  font-size: 14px;
  line-height: 1.5;
}
.learn-coach-tip-nav {
  display: flex;
  justify-content: space-between;
  align-items: center;
  margin-top: 12px;
}
.learn-coach-progress { color: var(--text-dim); font-size: 12px; }
.learn-coach-next {
  background: #d4a574;
  color: #000;
  border: none;
  padding: 6px 14px;
  border-radius: 6px;
  font-weight: 600;
  cursor: pointer;
}
```

Per `feedback_electron_titlebar_drag_region.md`: the backdrop is appended to `document.body` (root) so it escapes the titlebar drag region. Verify during manual check.

**Step 3: Wire Try-it button in `learn.js`**

```javascript
import { startSpotlight } from '../modules/learn-coach.js'

// inside renderContent, after setting innerHTML:
content.querySelector('.learn-try-it')?.addEventListener('click', async () => {
  const lesson = await window.ace.learn.get(lessonId)
  if (lesson.tryIt?.type === 'spotlight') {
    // Navigate to the target view first if specified
    if (lesson.tryIt.view) window.app.switchView(lesson.tryIt.view)
    setTimeout(() => {
      startSpotlight({
        targets: lesson.tryIt.targets,
        onComplete: async () => {
          await window.ace.learn.markCompleted(lessonId)
          window.app.switchView('learn')
          learnView.mount()
        },
        onCancel: () => { /* no-op */ },
      })
    }, 200) // let view switch settle
  }
})
```

**Step 4: Add a test spotlight lesson**

Update `02-vault.md` frontmatter to include:

```yaml
tryIt:
  type: spotlight
  view: vault
  targets:
    - selector: '[data-view="vault"]'
      tooltip: "This is your Vault tab — where all your markdown files live."
```

For this task, target the Vault nav-item itself so no new `data-learn-target` attributes are needed yet.

**Step 5: Manual verification**

Restart. Click Learn → lesson 2 → Try it. Expected:
- App switches to Vault view
- Dark backdrop with a cutout around the Vault nav-item
- Tooltip below the cutout with the tooltip text + "1 / 1" + "Got it" button
- Click Got it → overlay disappears, returns to Learn tab, lesson 2 marked completed
- Escape dismisses cleanly

**Step 6: Commit**

```bash
git add -A ace-desktop/
git commit -m "feat(ace-desktop): spotlight overlay module"
```

---

## Task 9: Tooltip edge-detection + auto-flip

**Files:**
- Modify: `ace-desktop/renderer/modules/learn-coach.js`

**Step 1: Improve `positionTooltip`**

Replace the stub:

```javascript
function positionTooltip(tooltip, targetRect) {
  const vw = window.innerWidth
  const vh = window.innerHeight
  const tipRect = tooltip.getBoundingClientRect()
  const GAP = 16

  // Default: below target
  let top = targetRect.bottom + GAP
  let left = targetRect.left

  // Flip above if not enough space below
  if (top + tipRect.height > vh - 16) {
    top = Math.max(16, targetRect.top - tipRect.height - GAP)
  }

  // Clamp to viewport horizontally
  if (left + tipRect.width > vw - 16) {
    left = vw - tipRect.width - 16
  }
  if (left < 16) left = 16

  tooltip.style.left = `${left}px`
  tooltip.style.top = `${top}px`
}
```

Call it twice — once with estimated size, once after DOM lays out:

```javascript
positionTooltip(backdrop.querySelector('.learn-coach-tooltip'), rect)
requestAnimationFrame(() => {
  positionTooltip(backdrop.querySelector('.learn-coach-tooltip'), rect)
})
```

**Step 2: Manual verification**

Add a test lesson targeting the bottom-right sidebar element (e.g. settings nav-item at page bottom). Run Try-it. Expected: tooltip flips above the target, doesn't clip viewport.

**Step 3: Commit**

```bash
git add -A ace-desktop/
git commit -m "feat(ace-desktop): spotlight tooltip edge detection"
```

---

## Task 10: `waitForSelector` helper + graceful missing-target handling

**Files:**
- Modify: `ace-desktop/renderer/modules/learn-coach.js`

**Step 1: Add helper**

```javascript
async function waitForSelector(selector, timeoutMs = 3000) {
  const start = Date.now()
  while (Date.now() - start < timeoutMs) {
    const el = document.querySelector(selector)
    if (el) return el
    await new Promise(r => setTimeout(r, 100))
  }
  return null
}
```

Update `positionStep` to await the selector and show a toast if missing:

```javascript
async function positionStep() {
  const target = targets[idx]
  const el = await waitForSelector(target.selector)
  if (!el) {
    showToast(`Spotlight target "${target.selector}" not found. Skipping.`)
    advance()
    return
  }
  // ... rest unchanged
}
```

**Step 2: Add a tiny toast helper**

Inline function:

```javascript
function showToast(message) {
  const t = document.createElement('div')
  t.className = 'learn-coach-toast'
  t.textContent = message
  document.body.appendChild(t)
  setTimeout(() => t.remove(), 3000)
}
```

Style in `learn-coach.css`:

```css
.learn-coach-toast {
  position: fixed;
  bottom: 32px;
  left: 50%;
  transform: translateX(-50%);
  background: var(--surface);
  border: 1px solid var(--border);
  padding: 10px 20px;
  border-radius: 8px;
  z-index: 10001;
  color: var(--text);
  font-size: 13px;
}
```

**Step 3: Manual verification**

Add a test spotlight with an invalid selector (`[data-learn-target="does-not-exist"]`). Try it. Expected: toast appears, spotlight skips gracefully to next target (or closes if that was the only one). No stuck overlay.

**Step 4: Commit**

```bash
git add -A ace-desktop/
git commit -m "feat(ace-desktop): waitForSelector + missing-target toast"
```

---

## Task 11: Prerequisite gating (send-message check)

**Files:**
- Modify: `ace-desktop/renderer/views/learn.js`
- Modify: `ace-desktop/renderer/modules/learn-coach.js`

**Step 1: Implement `checkPrerequisite`**

In `learn.js`:

```javascript
function checkPrerequisite(prereq) {
  if (!prereq) return { met: true }
  if (prereq === 'send-message') {
    // Check if any chat session has at least one user message.
    // Use whatever global/state the session manager exposes.
    const sessions = window.ace.sessions?.all?.() || []
    const hasMessage = sessions.some(s => (s.messages?.length || 0) > 0)
    return hasMessage
      ? { met: true }
      : { met: false, hint: 'Send a message in chat first, then come back.' }
  }
  return { met: true }
}
```

**Step 2: Gate the Try-it button**

In `renderContent`, after rendering:

```javascript
const tryBtn = content.querySelector('.learn-try-it')
if (tryBtn && lesson.tryIt?.prerequisite) {
  const check = checkPrerequisite(lesson.tryIt.prerequisite)
  if (!check.met) {
    tryBtn.disabled = true
    const hint = document.createElement('p')
    hint.className = 'learn-try-hint'
    hint.textContent = check.hint
    tryBtn.after(hint)
  }
}
```

Style:

```css
.learn-try-it:disabled { opacity: 0.4; cursor: not-allowed; }
.learn-try-hint { color: var(--text-dim); font-size: 13px; margin-top: 8px; font-style: italic; }
```

**Step 3: Manual verification**

Add a lesson with `prerequisite: send-message`. Fresh app (no chat activity). Click lesson. Expected: Try-it button greyed out, hint below. Send a message in chat. Return to lesson. Re-select (re-renders content). Expected: button enabled.

**Step 4: Commit**

```bash
git add -A ace-desktop/
git commit -m "feat(ace-desktop): prerequisite gating for Try-it buttons"
```

---

## Task 12: Add `data-learn-target` attributes across UI

**Files:**
- Modify: `ace-desktop/renderer/index.html` (static targets)
- Modify: `ace-desktop/renderer/dashboard.js` (dashboard widgets — find the render locations)
- Modify: chat composer + context bar + session timer files

**Step 1: Audit needed targets**

From the curriculum:
- Lesson 2 (Vault): `[data-learn-target="vault-tab"]` → already works as `[data-view="vault"]`, but add explicit attribute for stability.
- Lesson 3 (Command Center): `[data-learn-target="triad-deck"]`, `[data-learn-target="north-star"]`, `[data-learn-target="dashboard-widgets"]`.
- Lesson 4 (Chat): `[data-learn-target="chat-composer"]`, `[data-learn-target="send-button"]`.
- Lesson 5 (Session rails): `[data-learn-target="ctx-bar"]`, `[data-learn-target="session-timer"]`.
- Lesson 6 (`/start`): `[data-learn-target="chat-composer"]` (reused).
- Lesson 7 (`/eod`): `[data-learn-target="chat-composer"]` (reused).

**Step 2: Add attributes incrementally**

Use Grep to find each element's current source. Add `data-learn-target="..."` alongside existing attributes. One commit per target area (vault, dashboard, chat, session).

**Step 3: Manual verification**

After adding all, open DevTools:

```javascript
document.querySelectorAll('[data-learn-target]').length
// Expected: 7+ (at least one per target listed above)
```

**Step 4: Commit (multiple small commits or one batch)**

```bash
git commit -m "feat(ace-desktop): add data-learn-target attributes to UI"
```

---

## Task 13: Write Essentials lesson content (Lessons 1–3)

**Files:**
- Modify: `renderer/data/learn/01-welcome.md`
- Modify: `renderer/data/learn/02-vault.md`
- Create: `renderer/data/learn/03-command-center.md`

**Step 1: Lesson 1 — Welcome + Triad**

~150 words. Explains ACE, Authority/Capacity/Expansion, and that this is a coherence system not a productivity system. No `tryIt`.

**Step 2: Lesson 2 — Your vault, your sovereignty**

~150 words. Local-first principle, where files live, why it matters (sovereignty, portability, no lock-in). `tryIt: spotlight` on vault-tab.

**Step 3: Lesson 3 — The Command Center**

~200 words. Dashboard anatomy: Triad deck (shows current state), North Star (DCA), widget row (outcomes, pipeline, follow-ups). `tryIt: spotlight` with 3 targets: triad-deck, north-star, dashboard-widgets.

**Step 4: Manual verification**

Open each lesson. Verify:
- Copy reads naturally (not diagnostic — matches `feedback_coaching_ui_voice.md`)
- Markdown renders cleanly
- Try-it spotlights hit the real targets
- Completion on Got it works

**Step 5: Commit**

```bash
git add -A ace-desktop/renderer/data/learn/
git commit -m "content(ace-desktop): essentials lessons 1-3"
```

---

## Task 14: Write Essentials lesson content (Lessons 4–5 — Chat + Session rails)

**Files:**
- Create: `renderer/data/learn/04-chat.md`
- Create: `renderer/data/learn/05-session-rails.md`

**Step 1: Lesson 4 — Chat with ACE**

~200 words. How sessions work, slash commands intro, model/effort/permissions selectors. `tryIt: spotlight` with 2 targets: chat-composer + send-button. Prerequisite: none (but user will need to be on the chat view — set `view: terminal` in tryIt).

**Step 2: Lesson 5 — Your session rails**

~300 words — the most technical essential. Cover:
- Context bar: what input/output/cache mean, color states (green → gold → red)
- Session timer: duration options, warning → critical → expiry flow, why to use it
- 3-per-pane limit: why (focus, coherence)
- `prerequisite: send-message` — need a real session for the numbers to make sense
- `tryIt: spotlight` with 2 targets: ctx-bar, session-timer

**Step 3: Manual verification**

Without sending a message first: Lesson 5's Try-it disabled with hint. Send a message. Return to Lesson 5. Try-it enables. Run it. Both targets highlight correctly.

**Step 4: Commit**

```bash
git add -A ace-desktop/renderer/data/learn/
git commit -m "content(ace-desktop): essentials lessons 4-5 (chat + session rails)"
```

---

## Task 15: Write Essentials lesson content (Lessons 6–8)

**Files:**
- Create: `renderer/data/learn/06-start.md`
- Create: `renderer/data/learn/07-eod.md`
- Create: `renderer/data/learn/08-going-deeper.md`

**Step 1: Lesson 6 — Starting your day**

~200 words. What `/start` reads (state.md, active.md, calendar), what it writes (updates state on /close, grounds Triad). `tryIt: action` — puts `/start` into the chat composer ready to send. (Simpler than spotlight — user literally just hits enter.)

Alternative `tryIt` type `action`:

```yaml
tryIt:
  type: action
  view: terminal
  action: prefill-composer
  text: /start
  tooltip: "Press Enter to run your /start ritual."
```

Implement this branch in `learn.js`: instead of `startSpotlight`, look up the composer (`[data-learn-target="chat-composer"]`), set its value to `action.text`, focus it, and show a small floating tooltip.

**Step 2: Lesson 7 — Closing your day**

Mirror of Lesson 6 for `/eod`. Same `action` type with `/eod`.

**Step 3: Lesson 8 — Going deeper**

~100 words. No Try-it. Quick pointer to the Deeper track in the Learn sidebar. Lists what's covered. Completion of this lesson marks `firstRunComplete: true` (already handled by the completion-tracking logic if 8 essentials IDs are in the set).

**Step 4: Manual verification**

Run through Lessons 6 and 7: Try it fills composer, presses focus. Tooltip visible. User can hit Enter to actually run the ritual.

Complete Lesson 8. Expected: sidebar dot clears, `firstRunComplete: true` in config.

**Step 5: Commit**

```bash
git add -A ace-desktop/
git commit -m "content(ace-desktop): essentials lessons 6-8 + prefill action type"
```

---

## Task 16: Full manual verification + polish pass

**Files:** any identified during verification

**Step 1: Fresh-install flow**

```bash
ps aux | grep -i electron | grep -v grep | awk '{print $2}' | xargs kill -9 2>/dev/null
rm ~/Library/Application\ Support/ACE/ace-config.json
cd ace-desktop && npm start
```

Walk through: setup → Learn auto-opens → hero → Start → Lesson 1 → Next through all 8.

**Checklist:**
- [ ] Every lesson renders cleanly (no broken markdown, no console errors)
- [ ] Every Try-it works end-to-end
- [ ] Prev/Next navigation updates sidebar active state
- [ ] Completed bullets fill gold as you go
- [ ] Prereq gating works on Lesson 5
- [ ] Lesson 8 completion clears the sidebar dot + flips `firstRunComplete`

**Step 2: Skip + resume**

Fresh install → Skip → lands on Home, dot persists. Restart → still on Home, dot persists. Click Learn → hero says "Welcome back" + Continue button points at Lesson 1. Resume, complete all.

**Step 3: Light / dark mode**

Toggle theme. Walk through a spotlight lesson. Verify: backdrop, tooltip, buttons all legible in both modes. Check `--text`, `--text-dim`, `--surface`, `--border`, `--gold` usage.

**Step 4: Zoom range (50%–200%)**

Per `feedback_applyTheme_load_order.md` and recent zoom-bug fix: cycle zoom from 50% to 200%. Verify:
- Learn curriculum sidebar doesn't clip
- Spotlight cutout + tooltip stay aligned with target
- `getBoundingClientRect()` returns zoomed coords — confirm cutout matches

**Step 5: Escape handling + cancel paths**

- Escape during a spotlight → overlay disappears, no stuck state, no `onComplete` fired (so no bogus completion)
- Click outside tooltip inside backdrop → should NOT dismiss (prevent accidental escapes)
- Click the Vault tab while a spotlight is active on the Dashboard → overlay persists? or dismisses? Document behavior, prefer dismiss-with-no-completion.

**Step 6: Re-verify ROADMAP.md entry**

Update `ace-desktop/ROADMAP.md`:
- Move "Onboarding tutorial" from Phase 1 "Not started" to "Done"
- Reference this plan + design doc

Per memory `feedback_roadmap_update_on_ship.md`: update roadmap when feature ships, not as afterthought.

**Step 7: Final commit**

```bash
git add -A ace-desktop/
git commit -m "chore(ace-desktop): onboarding tutorial verified + roadmap updated"
```

---

## Post-ship

After merge to main:
1. Push to remote (polish merge + this branch).
2. Run `/close` to capture what shipped.
3. Move to next Phase 1 blocker: code signing / notarization.
4. Queue follow-up: Deeper track content authoring (10 lessons × ~150 words + screenshots).

## References

- Design: [2026-04-12-onboarding-tutorial-design.md](2026-04-12-onboarding-tutorial-design.md)
- Memory: `feedback_incremental_edits_only.md` — one change at a time
- Memory: `feedback_electron_titlebar_drag_region.md` — mount overlay at body root
- Memory: `feedback_view_display_override.md` — don't use `#view-X { display: flex }`
- Memory: `feedback_applyTheme_load_order.md` — guard sessions in applyTheme
- Memory: `feedback_coaching_ui_voice.md` — copy writes TO the user warmly, not diagnostic
- Memory: `feedback_roadmap_update_on_ship.md` — update ROADMAP when feature ships
