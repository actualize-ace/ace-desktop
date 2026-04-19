# Easy Batch — 8 Low-Risk Features Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Ship 8 well-scoped, low-risk features in a single morning session with no new dependencies.

**Architecture:** Pure renderer-side changes except Task 8 (which reads/writes vault via existing preload APIs). No new IPC channels, no new files, no main-process changes.

**Tech Stack:** Vanilla JS ES modules, CSS, HTML — all in `ace-desktop/renderer/`. Branch: `chat-pipeline-refactor` (current working branch).

---

## Task 1: Default model → Sonnet

**Goal:** New sessions default to Sonnet instead of Opus.

**Files:**
- Modify: `ace-desktop/renderer/state.js:21`
- Modify: `ace-desktop/renderer/views/settings.js:18`

**Step 1: Change state.js default**

In `renderer/state.js` line 21, change:
```js
chatDefaults: { model: 'opus', permissions: 'default', effort: 'high', lean: true },
```
to:
```js
chatDefaults: { model: 'sonnet', permissions: 'default', effort: 'high', lean: true },
```

**Step 2: Change settings.js default**

In `renderer/views/settings.js` line 18, change:
```js
chat: { model: 'opus', permissions: 'default', effort: 'high' },
```
to:
```js
chat: { model: 'sonnet', permissions: 'default', effort: 'high' },
```

**Step 3: Verify**

Run `npm start` from `ace-desktop/`. Open a new chat pane. Model dropdown should show "Sonnet" pre-selected.

Note: existing users who already saved a config won't see this change — it only affects fresh installs or users whose config doesn't have `defaults.chat.model` set. That's intentional.

**Step 4: Commit**
```bash
git add ace-desktop/renderer/state.js ace-desktop/renderer/views/settings.js
git commit -m "feat(ace-desktop): default model → Sonnet for new sessions"
```

---

## Task 2: Streaming status-word vocabulary expansion

**Goal:** Expand `TOOL_WORDS` and `STATUS_WORDS` to include more ACE-centric verbs.

**Files:**
- Modify: `ace-desktop/renderer/modules/tool-renderer.js:245`
- Modify: `ace-desktop/renderer/modules/session-manager.js:124`

**Step 1: SKIPPED — do not touch TOOL_WORDS**

User decision 2026-04-19: keep `TOOL_WORDS` as-is. Only the idle filler vocabulary (`STATUS_WORDS`) is changing. Skip to Step 2.

**Step 2: Replace STATUS_WORDS with ACE-flavored vocabulary in session-manager.js**

Drop mechanical/generic words (`Thinking`, `Reasoning`, `Analyzing`, `Processing`). Replace with ACE-coherent verbs.

In `renderer/modules/session-manager.js` around line 124, find:
```js
const STATUS_WORDS = ['Thinking', 'Reasoning', 'Analyzing', 'Synthesizing', 'Composing', 'Reflecting', 'Processing', 'Connecting', 'Exploring', 'Weaving']
```
Replace with:
```js
const STATUS_WORDS = [
  'Synthesizing', 'Composing', 'Reflecting', 'Connecting', 'Exploring',
  'Weaving', 'Cohering', 'Actualizing', 'Expanding', 'Distilling',
  'Integrating', 'Attuning', 'Crystallizing', 'Illuminating',
]
```

**Note:** Do NOT touch `TOOL_WORDS` in `tool-renderer.js` — leave that as-is. Only the idle filler vocabulary is changing.

**Step 3: Verify**

`npm start`, send a message, watch the status word in the chat header cycle through the new vocabulary.

**Step 4: Commit**
```bash
git add ace-desktop/renderer/modules/tool-renderer.js ace-desktop/renderer/modules/session-manager.js
git commit -m "feat(ace-desktop): expand TOOL_WORDS and STATUS_WORDS vocabulary"
```

---

## Task 3: Rename Terminal / Agents nav labels

**Goal:** "Terminal" → "Build", "Agents" → "Studio" in the sidebar nav.

**Files:**
- Modify: `ace-desktop/renderer/index.html:162-168`

**Step 1: Update the two nav labels**

In `renderer/index.html`, find (around line 162):
```html
      <div class="nav-item" data-view="terminal">
        <svg class="nav-icon" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5"><polyline points="4 17 10 11 4 5"/><line x1="12" y1="19" x2="20" y2="19"/></svg>
        Terminal
      </div>
      <div class="nav-item" data-view="agents">
        <svg class="nav-icon" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5"><circle cx="12" cy="5" r="2"/><circle cx="5" cy="19" r="2"/><circle cx="19" cy="19" r="2"/><line x1="12" y1="7" x2="5" y2="17"/><line x1="12" y1="7" x2="19" y2="17"/></svg>
        Agents
      </div>
```
Replace with:
```html
      <div class="nav-item" data-view="terminal">
        <svg class="nav-icon" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5"><polyline points="4 17 10 11 4 5"/><line x1="12" y1="19" x2="20" y2="19"/></svg>
        Build
      </div>
      <div class="nav-item" data-view="agents">
        <svg class="nav-icon" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5"><circle cx="12" cy="5" r="2"/><circle cx="5" cy="19" r="2"/><circle cx="19" cy="19" r="2"/><line x1="12" y1="7" x2="5" y2="17"/><line x1="12" y1="7" x2="19" y2="17"/></svg>
        Studio
      </div>
```

Note: `data-view` attributes stay as `terminal` and `agents` — those are internal routing keys. Only the visible label text changes.

**Step 2: Verify**

`npm start` — sidebar shows "Build" and "Studio". Clicking each still navigates correctly (routing is keyed to `data-view`, not text content).

**Step 3: Commit**
```bash
git add ace-desktop/renderer/index.html
git commit -m "feat(ace-desktop): rename Terminal→Build, Agents→Studio in nav"
```

---

## Task 4: Collapsible AGENTS roster sidebar

**Goal:** Add a collapse/expand toggle to the AGENTS roster panel (left sidebar in the Studio view).

**Files:**
- Modify: `ace-desktop/renderer/index.html:494-497`
- Modify: `ace-desktop/renderer/styles/views/agents.css:3`

**Step 1: Add chevron button to roster header in HTML**

In `renderer/index.html` around line 494, find:
```html
          <div class="agents-roster" id="agents-roster">
            <div class="ar-section">Agents</div>
```
Replace with:
```html
          <div class="agents-roster" id="agents-roster">
            <div class="ar-section ar-section-toggle" id="ar-collapse-btn">Agents <span class="ar-chevron">◂</span></div>
```

**Step 2: Add CSS for collapsed state**

In `renderer/styles/views/agents.css` line 3, find:
```css
.agents-roster { width:148px; flex-shrink:0; border-right:1px solid var(--glass-border); background:rgba(10,12,22,0.92); backdrop-filter:var(--glass-blur); overflow-y:auto; display:flex; flex-direction:column; }
```
Replace with:
```css
.agents-roster { width:148px; flex-shrink:0; border-right:1px solid var(--glass-border); background:rgba(10,12,22,0.92); backdrop-filter:var(--glass-blur); overflow-y:auto; display:flex; flex-direction:column; transition:width 0.18s ease; }
.agents-roster.collapsed { width:28px; overflow:hidden; }
.agents-roster.collapsed .ar-item,
.agents-roster.collapsed .ar-spawn,
.agents-roster.collapsed .ar-section { opacity:0; pointer-events:none; }
.ar-section-toggle { cursor:pointer; user-select:none; display:flex; justify-content:space-between; align-items:center; }
.ar-chevron { font-size:8px; color:var(--text-dim); transition:transform 0.18s; }
.agents-roster.collapsed .ar-chevron { transform:rotate(180deg); opacity:1; pointer-events:auto; }
```

**Step 3: Wire the toggle in index.html inline script**

Find the `initAgents()` call area (bottom of `index.html` script block, around line 993). After it, add:
```js
document.getElementById('ar-collapse-btn')?.addEventListener('click', () => {
  document.getElementById('agents-roster')?.classList.toggle('collapsed')
})
```

**Step 4: Verify**

`npm start` → go to Studio view → click "Agents ◂" header → roster collapses to a thin rail → click again → expands. Agent pane fills the extra space via its `flex:1`.

**Step 5: Commit**
```bash
git add ace-desktop/renderer/index.html ace-desktop/renderer/styles/views/agents.css
git commit -m "feat(ace-desktop): collapsible agents roster sidebar"
```

---

## Task 5: Contextual chat names + pane header display

**Goal:** Two coupled changes in one commit — (1) replace `deriveSessionName` with a stop-word extractor that produces 3–5 word titles instead of raw truncated sentences, and (2) wire the pane header (`hdr-label-${id}`) to show the derived name, which currently stays "ACE Session" forever.

**Files:**
- Modify: `ace-desktop/renderer/modules/session-manager.js:21-26` (name function)
- Modify: `ace-desktop/renderer/modules/session-manager.js:70-75` (header wire-up)

**Step 1: Replace deriveSessionName (lines 21-26)**

Find:
```js
function deriveSessionName(prompt) {
  if (!prompt || !prompt.trim()) return 'ACE'
  const cleaned = prompt.trim().replace(/\s+/g, ' ')
  if (cleaned.length <= 28) return cleaned
  return cleaned.slice(0, 28).trim() + '…'
}
```
Replace with:
```js
function deriveSessionName(prompt) {
  if (!prompt || !prompt.trim()) return 'ACE'
  const STOP = new Set([
    'what','how','why','when','where','who','which','can','could','would','should',
    'please','help','me','us','i','you','the','a','an','is','are','was','were',
    'do','does','did','to','of','for','in','on','with','and','or','but','my','your',
    'this','that','these','those','it','its','be','been','being','have','has','had',
    'will','want','need','make','get','let','tell','show','give','find','go','put',
  ])
  const words = prompt.trim()
    .replace(/[^\w\s'-]/g, ' ')
    .split(/\s+/)
    .map(w => w.toLowerCase().replace(/^[-']+|[-']+$/g, ''))
    .filter(w => w.length > 1 && !STOP.has(w))
  const title = words.slice(0, 4).join(' ')
  if (!title) {
    const cleaned = prompt.trim().replace(/\s+/g, ' ')
    return cleaned.length <= 28 ? cleaned : cleaned.slice(0, 28).trim() + '…'
  }
  return title.charAt(0).toUpperCase() + title.slice(1)
}
```

**Step 2: SKIPPED — do not wire the pane header**

User decision 2026-04-19: keep the explicit semantic split (tab=identity, header=category). Only the tab gets the derived name. The header `hdr-label-${id}` stays "ACE SESSION" — this is intentional, documented at session-manager.js:67-69. Do NOT add the hdrLabel wire-up.

**Step 3: Verify**

`npm start` → send a variety of first messages:
- "What are the backlog items?" → tab + header both show "backlog items"
- "Help me write an email to Marc" → "write email marc"
- "Fix the context meter bug" → "fix context meter bug"

**Step 4: Commit**
```bash
git add ace-desktop/renderer/modules/session-manager.js
git commit -m "feat(ace-desktop): smart contextual chat names + header display"
```

---

## Task 6: Sidebar Context % desync on model dropdown flip

**Goal:** When user changes the per-session model dropdown, `telem-ctx-pct` (sidebar %) doesn't recalculate. Fix by calling `updateTelemetry()` in the model change listener.

**Files:**
- Modify: `ace-desktop/renderer/modules/session-manager.js:662-666`

**Step 1: Add updateTelemetry() import guard**

At the top of `session-manager.js`, verify `updateTelemetry` is imported from `./telemetry.js`. Find:
```js
import { MODEL_CTX_LIMITS } from './telemetry.js'
```
Replace with:
```js
import { MODEL_CTX_LIMITS, updateTelemetry } from './telemetry.js'
```

**Step 2: Call updateTelemetry in the model change listener**

Find (around line 663):
```js
  document.getElementById('chat-model-' + id)?.addEventListener('change', function () {
    if (state.sessions[id]) state.sessions[id].model = this.value
    updateContextBar(id, state.sessions[id]?.contextInputTokens || 0)
  })
```
Replace with:
```js
  document.getElementById('chat-model-' + id)?.addEventListener('change', function () {
    if (state.sessions[id]) state.sessions[id].model = this.value
    updateContextBar(id, state.sessions[id]?.contextInputTokens || 0)
    updateTelemetry()
  })
```

**Step 3: Verify**

`npm start` → open a chat → send a few messages (builds context tokens) → flip the model dropdown → sidebar `telem-ctx-pct` should immediately recalculate based on the new model's limit.

For example: flipping from Opus (1M limit) to Sonnet (200K limit) on a 50K-token session should jump the sidebar % from ~5% to ~25%.

**Step 4: Commit**
```bash
git add ace-desktop/renderer/modules/session-manager.js
git commit -m "fix(ace-desktop): sidebar ctx% resyncs on model dropdown change"
```

---

## Task 7: One-click capture icon in titlebar

**Goal:** Add a persistent capture button in the titlebar that shows a minimal input overlay and appends a timestamped entry to `00-System/inbox.md`.

**Files:**
- Modify: `ace-desktop/renderer/index.html` (titlebar section ~line 63, and inline script)
- Modify: `ace-desktop/renderer/styles/shell.css` (capture button + overlay styles)

**Step 1: Add the capture button to the titlebar-right (not center)**

Icon: **custom SVG lightning bolt** — NOT the `+` emoji, NOT a unicode character. Matches the 14×14 stroke-only style of the existing nav icons and atmosphere equalizer (1.5px stroke, rounded linejoin).

Placement: **titlebar-right**, immediately before the `alpha-pill` button (around line 64). Keeps user-action controls grouped on the right; avoids cluttering titlebar-center's atmosphere indicator.

In `renderer/index.html`, find the titlebar-right block (around line 63):
```html
    <div class="titlebar-right">
      <button class="alpha-pill" id="alpha-pill" title="ACE v0.1.0 · alpha — click for details">ALPHA</button>
```
Replace with:
```html
    <div class="titlebar-right">
      <button class="capture-btn" id="capture-btn" title="Quick capture to inbox">
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><polygon points="13 2 3 14 12 14 11 22 21 10 12 10 13 2"/></svg>
      </button>
      <button class="alpha-pill" id="alpha-pill" title="ACE v0.1.0 · alpha — click for details">ALPHA</button>
```

**Step 2: Add the capture overlay HTML**

Directly after the `cmdk-overlay` closing `</div>` (around line 50), add:
```html
  <!-- Quick Capture Overlay -->
  <div class="capture-overlay" id="capture-overlay" style="display:none">
    <div class="capture-box">
      <input class="capture-input" id="capture-input" placeholder="Capture a thought..." autocomplete="off" spellcheck="false">
      <button class="capture-submit" id="capture-submit">→</button>
    </div>
  </div>
```

**Step 3: Add CSS to shell.css**

At the end of `renderer/styles/shell.css`, append:
```css
/* ── Quick Capture ── */
.capture-btn { background:none; border:1px solid rgba(212,165,116,0.18); border-radius:4px; color:var(--text-dim); width:22px; height:22px; cursor:pointer; display:flex; align-items:center; justify-content:center; transition:all 0.14s; padding:0; -webkit-app-region:no-drag; }
.capture-btn:hover { border-color:rgba(212,165,116,0.55); color:#d4a574; background:rgba(212,165,116,0.06); }
.capture-btn svg { display:block; }
.capture-overlay { position:fixed; top:32px; left:50%; transform:translateX(-50%); z-index:9000; }
.capture-box { display:flex; gap:6px; background:var(--bg-elevated); border:1px solid var(--glass-border); border-radius:8px; padding:8px 10px; box-shadow:0 8px 32px rgba(0,0,0,0.5); min-width:340px; }
.capture-input { flex:1; background:none; border:none; outline:none; color:var(--text-primary); font-family:'DM Sans',sans-serif; font-size:13px; }
.capture-input::placeholder { color:var(--text-dim); }
.capture-submit { background:none; border:none; color:var(--gold); cursor:pointer; font-size:16px; padding:0 4px; }
```

**Step 4: Wire the capture logic in inline script**

Near the bottom of the inline script in `index.html` (after `initBuildMode()` and `initAgents()` calls), add:
```js
// ── Quick Capture ──
;(function() {
  const btn    = document.getElementById('capture-btn')
  const overlay = document.getElementById('capture-overlay')
  const input  = document.getElementById('capture-input')
  const submit = document.getElementById('capture-submit')
  if (!btn || !overlay || !input || !submit) return

  function showCapture() {
    overlay.style.display = ''
    input.value = ''
    input.focus()
  }
  function hideCapture() { overlay.style.display = 'none' }

  async function doCapture() {
    const text = input.value.trim()
    if (!text) { hideCapture(); return }
    hideCapture()
    try {
      const vaultPath = state.config?.vaultPath
      if (!vaultPath) return
      const filePath = '00-System/inbox.md'
      const existing = await window.ace.vault.readFile(filePath) || ''
      const ts = new Date().toISOString().slice(0, 16).replace('T', ' ')
      const entry = `- ${ts} — ${text}\n`
      // Append after the first heading line, or prepend if no heading found
      const lines = existing.split('\n')
      const headerIdx = lines.findIndex(l => l.startsWith('#'))
      if (headerIdx >= 0) {
        lines.splice(headerIdx + 1, 0, entry)
      } else {
        lines.unshift(entry)
      }
      await window.ace.vault.writeFile(filePath, lines.join('\n'))
    } catch (e) { console.error('[capture]', e) }
  }

  btn.addEventListener('click', () => overlay.style.display === 'none' ? showCapture() : hideCapture())
  submit.addEventListener('click', doCapture)
  input.addEventListener('keydown', e => {
    if (e.key === 'Enter') { e.preventDefault(); doCapture() }
    if (e.key === 'Escape') hideCapture()
  })
  // Close on outside click
  document.addEventListener('click', e => {
    if (!overlay.contains(e.target) && e.target !== btn) hideCapture()
  }, true)
})()
```

Note: `state.config` is already populated by the time this runs — it's loaded in `initSessions` which fires earlier. If vaultPath is not set (pre-setup), the capture silently no-ops.

**Step 5: Verify**

`npm start` → see "+" button in titlebar center → click it → input appears → type a thought → press Enter → open `00-System/inbox.md` in vault view → entry appears with timestamp.

**Step 6: Commit**
```bash
git add ace-desktop/renderer/index.html ace-desktop/renderer/styles/shell.css
git commit -m "feat(ace-desktop): one-click capture icon in titlebar"
```

---

## Execution Order

These tasks are fully independent. Recommended sequence to minimize risk:

1. Task 6 (2-line fix — highest signal/effort ratio, closes a real bug)
2. Task 1 (1-line change — instant win)
3. Task 2 (string additions only — zero DOM risk)
4. Task 3 (text label swap — visual only)
5. Task 5 (pure function + 1-line addition — no DOM risk)
6. Task 4 (CSS + 3-line JS — visual only, no data impact)
7. Task 7 (most code, but all new — no risk to existing features)

Test after each commit with `npm start`. No automated tests exist for this codebase — manual visual verification is the gate.
