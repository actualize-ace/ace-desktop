# Context Meter Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Fix context bar accuracy, centralize model limits, and make the bar an interactive reset control with a turns-remaining tooltip.

**Architecture:** All changes are in the renderer layer. `MODEL_CTX_LIMITS` becomes a named export from `session-manager.js` consumed by `telemetry.js`. The bar gets `cursor:pointer` in CSS and a click handler wired at session spawn time. Turn deltas are tracked per-session for the predictive tooltip.

**Tech Stack:** Vanilla JS ES modules, DOM manipulation, CSS. No new dependencies. Manual visual verification via `npm start` — no test framework exists.

---

### Task 1: Export `MODEL_CTX_LIMITS` and fix `telemetry.js`

**Files:**
- Modify: `ace-desktop/renderer/modules/session-manager.js` — add export, update internal usage
- Modify: `ace-desktop/renderer/modules/telemetry.js:2,37-39` — import and use constant

**Step 1: Add the export near the top of `session-manager.js`**

Find the first `export` statement or the imports block at the top of the file and add this constant before the first function:

```js
export const MODEL_CTX_LIMITS = { opus: 1_000_000, sonnet: 200_000, haiku: 200_000 }
```

**Step 2: Update `updateContextBar` to use it**

In `updateContextBar` (around line 559), replace:
```js
const CTX_LIMITS = { opus: 1000000, sonnet: 200000, haiku: 200000 }
const maxCtx = CTX_LIMITS[model] || 200000
```
With:
```js
const maxCtx = MODEL_CTX_LIMITS[model] || 200_000
```

**Step 3: Update `telemetry.js` to import and use it**

At the top of `telemetry.js`, add the import:
```js
import { state, MODEL_CTX_LIMITS } from './session-manager.js'
```
Wait — `state` is currently imported from `'../state.js'`. Keep that. Add a second import:
```js
import { MODEL_CTX_LIMITS } from './session-manager.js'
```

Then in `updateTelemetry` around line 37-39, replace:
```js
const limit = model === 'opus' ? 1000000 : 200000
```
With:
```js
const limit = MODEL_CTX_LIMITS[model] || 200_000
```

**Step 4: Verify no other hardcoded limit values remain**

Run: `grep -n "1000000\|200000" ace-desktop/renderer/modules/session-manager.js ace-desktop/renderer/modules/telemetry.js`

Expected: zero matches (both files should now use the constant).

**Step 5: Launch app and verify context bar still works**

```bash
cd ace-desktop && npm start
```
Open a chat, send a message. Context bar should update normally.

**Step 6: Commit**

```bash
git add ace-desktop/renderer/modules/session-manager.js ace-desktop/renderer/modules/telemetry.js
git commit -m "refactor(ace-desktop): centralize MODEL_CTX_LIMITS — single source of truth for context window sizes"
```

---

### Task 2: Remove `contextInputTokens` update from `result` event path + add debug log

**Files:**
- Modify: `ace-desktop/renderer/modules/session-manager.js:497-533` — `updateChatStatus`

**Step 1: Open `updateChatStatus` (around line 497)**

The current block reads:
```js
if (event.usage) {
  s.totalTokens.input += event.usage.input_tokens || 0
  s.totalTokens.output += event.usage.output_tokens || 0
  // Real context = input + cache fields (Claude caches full conversation history)
  if (event.usage) {
    const u = event.usage
    s.contextInputTokens = (u.input_tokens || 0) + (u.cache_creation_input_tokens || 0) + (u.cache_read_input_tokens || 0)
  }
}
```

Note: the accuracy fix from the earlier session already removed the `s.contextInputTokens` assignment here and replaced it with a comment. Verify by reading the current file state. If the fix is already applied, skip to Step 2. If not, apply it now.

**Step 2: Add debug log**

Immediately after the `if (event.usage)` block in `updateChatStatus`, add:
```js
console.debug('[ctx] result.usage:', JSON.stringify(event.usage), '| contextInputTokens:', s.contextInputTokens)
```

This lets you open DevTools, run a turn with tool use, and compare what `result.usage` reports vs what `message_start` already set. Remove this line once confirmed.

**Step 3: Remove the `updateContextBar` call from `updateChatStatus`**

Check whether `updateContextBar(id, s.contextInputTokens)` still appears in `updateChatStatus` after the earlier fix. If it does, remove it — the bar is now only updated from `updateTokensFromStream`.

**Step 4: Verify in app**

```bash
npm start
```
Open DevTools console. Send a message that uses tools (e.g. ask Claude to read a file). Watch the console — you should see the `[ctx] result.usage:` log line. Note whether `input_tokens` in the result is larger than `contextInputTokens` (confirming cumulative) or equal (confirming per-last-call). Either way the fix is correct.

**Step 5: Commit**

```bash
git add ace-desktop/renderer/modules/session-manager.js
git commit -m "fix(ace-desktop): context bar reads from message_start only — result.usage is cumulative across tool-call rounds"
```

---

### Task 3: Add `turnDeltas` state + snapshot before send

**Files:**
- Modify: `ace-desktop/renderer/modules/session-manager.js` — session init + `sendChatMessage`

**Step 1: Add `turnDeltas` and `_prevContextTokens` to session init**

In `spawnSession` around line 1258, the session state object is initialized. Add two fields:
```js
turnDeltas: [],
_prevContextTokens: 0,
```

**Step 2: Snapshot context before send**

In `sendChatMessage`, around line 77-87 (where `s.isStreaming = true` is set), add:
```js
s._prevContextTokens = s.contextInputTokens
```

Place it right after `s.isStreaming = true`.

**Step 3: Commit (no visual change yet)**

```bash
git add ace-desktop/renderer/modules/session-manager.js
git commit -m "feat(ace-desktop): track per-turn context deltas for predictive turns-remaining tooltip"
```

---

### Task 4: Compute delta at `finalizeMessage`

**Files:**
- Modify: `ace-desktop/renderer/modules/session-manager.js:188-226` — `finalizeMessage`

**Step 1: Add delta computation at the top of `finalizeMessage`**

After `s.isStreaming = false` (line ~192), add:
```js
// Track per-turn context growth for predictive tooltip
const delta = s.contextInputTokens - (s._prevContextTokens || 0)
if (delta > 0) {
  s.turnDeltas = [...(s.turnDeltas || []), delta].slice(-5)
}
```

**Step 2: Verify in app**

```bash
npm start
```
Open DevTools console. After a few turns, run:
```js
Object.values(window.__aceState?.sessions || {}).map(s => ({ turnDeltas: s.turnDeltas }))
```
Expected: array of objects with `turnDeltas` growing after each turn.

If `window.__aceState` isn't exposed, check `state.js` for how state is exported. Alternatively just add a temporary `console.log('[ctx] turnDeltas:', s.turnDeltas)` at the end of the delta block.

**Step 3: Commit**

```bash
git add ace-desktop/renderer/modules/session-manager.js
git commit -m "feat(ace-desktop): compute per-turn context delta in finalizeMessage"
```

---

### Task 5: Upgrade bar tooltip with turns-remaining estimate

**Files:**
- Modify: `ace-desktop/renderer/modules/session-manager.js:559-581` — `updateContextBar`

**Step 1: Replace the tooltip line in `updateContextBar`**

Current line (around 567):
```js
if (barEl) barEl.title = `Context: ${formatTokens(totalTokens)} / ${formatTokens(maxCtx)} tokens (${Math.round(pct)}%)`
```

Replace with:
```js
if (barEl) {
  const s = state.sessions[id]
  let turnsHint = ''
  if (s?.turnDeltas?.length >= 2) {
    const avg = s.turnDeltas.reduce((a, b) => a + b, 0) / s.turnDeltas.length
    const remaining = Math.floor((maxCtx - totalTokens) / avg)
    if (remaining < 20) turnsHint = `  ·  ~${remaining} turn${remaining === 1 ? '' : 's'} remaining`
  }
  barEl.title = `Context: ${formatTokens(totalTokens)} / ${formatTokens(maxCtx)}${turnsHint}  ·  click to reset`
}
```

**Step 2: Verify in app**

```bash
npm start
```
Send 3+ turns. Hover the context bar. Tooltip should show turns remaining after 2 turns of data. Before 2 turns, shows just `Context: X / Y  ·  click to reset`.

**Step 3: Commit**

```bash
git add ace-desktop/renderer/modules/session-manager.js
git commit -m "feat(ace-desktop): context bar tooltip shows turns remaining + click-to-reset hint"
```

---

### Task 6: Add `cursor: pointer` to context bar CSS

**Files:**
- Modify: `ace-desktop/renderer/styles/chat.css:201-204`

**Step 1: Add cursor to `.ctx-bar`**

Current:
```css
.ctx-bar {
  width:80px; height:3px; background:var(--bg-elevated); border-radius:2px;
  overflow:hidden; border:1px solid var(--border);
  transition: box-shadow 1.2s ease, border-color 1.2s ease;
}
```

Add `cursor: pointer;`:
```css
.ctx-bar {
  width:80px; height:3px; background:var(--bg-elevated); border-radius:2px;
  overflow:hidden; border:1px solid var(--border);
  transition: box-shadow 1.2s ease, border-color 1.2s ease;
  cursor: pointer;
}
```

**Step 2: Verify in app**

```bash
npm start
```
Hover the context bar — cursor should change to a hand pointer.

**Step 3: Commit**

```bash
git add ace-desktop/renderer/styles/chat.css
git commit -m "feat(ace-desktop): context bar cursor:pointer — affordance for click-to-reset"
```

---

### Task 7: Wire click-to-reset on context bar

**Files:**
- Modify: `ace-desktop/renderer/modules/session-manager.js` — add `resetContext` function + wire click in `spawnSession`

**Step 1: Write `resetContext` function**

Add this function near `updateContextBar` (exported so it's testable):

```js
export function resetContext(id) {
  const s = state.sessions[id]
  if (!s) return

  // Clear Claude session thread — next send has no --resume
  s.claudeSessionId = null

  // Reset token tracking
  s.contextInputTokens = 0
  s.totalTokens = { input: 0, output: 0 }
  s.totalCost = 0
  s.turnDeltas = []
  s._prevContextTokens = 0
  s._costWarned = false

  // Clear chat DOM
  const msgsEl = document.getElementById('chat-msgs-' + id)
  if (msgsEl) msgsEl.innerHTML = ''

  // Clear message history
  s.messages = []
  s.currentStreamText = ''
  s._fullResponseText = ''

  // Reset status bar labels
  const statusEl = document.getElementById('chat-status-' + id)
  if (statusEl) {
    const costEl = statusEl.querySelector('.chat-cost-label')
    const tokEl = statusEl.querySelector('.chat-tokens-label')
    if (costEl) costEl.style.color = ''
    if (costEl) costEl.textContent = '$0.0000'
    if (tokEl) tokEl.textContent = '0 tokens'
  }

  // Reset context bar to 0
  updateContextBar(id, 0)
}
```

**Step 2: Wire click handler in `spawnSession`**

In `spawnSession`, after the model dropdown change listener (around line 1264), add:

```js
document.getElementById('ctx-bar-' + id)?.addEventListener('click', () => {
  resetContext(id)
})
```

**Step 3: Verify in app**

```bash
npm start
```
Golden path test:
1. Send 3+ messages — context bar fills, tooltip shows turns remaining
2. Click the context bar — bar drops to 0%, chat clears, status bar resets
3. Send another message — conversation starts fresh (no memory of prior turns), context bar fills again from scratch
4. Verify the pane stays open with the same tab name and model selection

Edge case test:
- Click reset mid-stream (while Claude is responding). The bar should clear. The in-flight response will still finalize but `messages` is empty, so it'll push to a now-empty array — acceptable.

**Step 4: Commit**

```bash
git add ace-desktop/renderer/modules/session-manager.js
git commit -m "feat(ace-desktop): click context bar to reset conversation — clears thread, DOM, and token tracking in-place"
```

---

### Task 8: Remove debug log

**Files:**
- Modify: `ace-desktop/renderer/modules/session-manager.js` — remove the `console.debug` line added in Task 2

Do this after verifying what `result.usage` contains in Task 2's DevTools check. Remove the line:
```js
console.debug('[ctx] result.usage:', JSON.stringify(event.usage), '| contextInputTokens:', s.contextInputTokens)
```

Update the comment to record what was confirmed:
```js
// contextInputTokens is NOT updated here — result.usage.input_tokens is cumulative
// across all API calls in a multi-tool turn (confirmed YYYY-MM-DD). Use
// message_start events (updateTokensFromStream) as the sole context source.
```

**Step 2: Commit**

```bash
git add ace-desktop/renderer/modules/session-manager.js
git commit -m "chore(ace-desktop): remove context meter debug log — result.usage confirmed [cumulative|per-call]"
```

---

## Execution Options

**Plan saved to `docs/plans/2026-04-17-context-meter-impl.md`.**

**1. Subagent-Driven (this session)** — fresh subagent per task, review between tasks, fast iteration

**2. Parallel Session (separate)** — open new session with executing-plans, batch execution with checkpoints

Which approach?
