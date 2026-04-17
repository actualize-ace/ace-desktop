# Context Meter — Design Spec
**Date:** 2026-04-17  
**Status:** Approved  
**Scope:** Accuracy fix + interactive bar redesign

---

## Problem

The context bar in ACE Desktop has two issues:

1. **Inflation bug.** `updateChatStatus` overwrites `contextInputTokens` from the `result` event's `usage` field at the end of every turn. The `result` event is a Claude CLI summary — its `usage.input_tokens` is likely cumulative across all API calls in a multi-tool turn (e.g. 3 tool calls × 30K each = 90K reported vs 30K actual). This causes the bar to spike after tool-heavy turns.

2. **No interaction.** The bar is a passive indicator. Sonnet's 200K limit fills fast in ACE (baseline context load from CLAUDE.md + skills + memory can be 30–50K before the first user message). Context reset is buried in "new session." There's no way to clear context in-place without losing the pane.

---

## Design Constraints

- ACE uses somatic cues, not alarm cues. No badges, no red dots, no in-stream warning messages.
- Sonnet filling up quickly is **normal workflow**, not an exception. The UX normalizes it rather than warning about it.
- One signal per surface. The bar is already doing its job visually — add interaction, not more chrome.

---

## Solution

### 1. Accuracy — Single Source for `contextInputTokens`

`contextInputTokens` is set from `message_start` stream events only (via `updateTokensFromStream`). The `result` event path in `updateChatStatus` no longer touches it.

`message_start` is the correct source: it fires once per Anthropic API call, always includes accurate per-call usage (`input_tokens + cache_creation_input_tokens + cache_read_input_tokens`), and is not aggregated across tool-call rounds.

A single `console.debug` line remains in `updateChatStatus` to log what `result.usage` actually contains vs `contextInputTokens` — confirms or denies the cumulative assumption in one live DevTools inspection, then can be removed.

### 2. Single Source of Truth for Model Limits

`MODEL_CTX_LIMITS` is exported from `session-manager.js` and imported by `telemetry.js`. Currently both files hardcode the same values independently. One constant, one place to update when Anthropic changes limits.

```js
// session-manager.js
export const MODEL_CTX_LIMITS = { opus: 1_000_000, sonnet: 200_000, haiku: 200_000 }
```

### 3. Interactive Context Bar

The context bar becomes a subtle click target — always, not just when full.

**Hover behavior:**  
Tooltip upgrades from the current `Context: 45K / 200K tokens (23%)` to:

```
Context: 45K / 200K  ·  ~12 turns remaining  ·  click to reset
```

"Turns remaining" is calculated from a rolling average of the last 5 turn deltas (`s.turnDeltas[]`). If fewer than 2 turns have occurred (not enough data), the turns estimate is omitted:

```
Context: 45K / 200K  ·  click to reset
```

**Click behavior:**  
Instant context reset — no confirmation dialog. Clears:
- `s.claudeSessionId = null` (next send spawns fresh, no `--resume`)
- `s.contextInputTokens = 0`
- `s.totalTokens = { input: 0, output: 0 }`
- `s.totalCost = 0`
- `s.turnDeltas = []`
- Chat message DOM (clears `chat-msgs-{id}` innerHTML)
- `s.messages = []`

The bar resets to 0% visually. The pane stays open — same tab, same model selection, same name. Only the Claude session thread is cleared.

**Cursor:**  
`cursor: pointer` on the bar element always (currently no pointer cursor).

**Color behavior:** unchanged. Existing `ctx-warn` / `ctx-hot` / `ctx-critical` CSS classes handle ambient pressure. No new states.

### 4. Turns Remaining Calculation

Track per-turn context delta in `s.turnDeltas[]` (capped at last 5):

```js
// Before send: snapshot current context
s._prevContextTokens = s.contextInputTokens

// At finalizeMessage: compute delta
const delta = s.contextInputTokens - (s._prevContextTokens || 0)
if (delta > 0) {
  s.turnDeltas = [...(s.turnDeltas || []), delta].slice(-5)
}
```

Turns remaining in tooltip:
```js
const avg = s.turnDeltas.reduce((a, b) => a + b, 0) / s.turnDeltas.length
const remaining = Math.floor((maxCtx - s.contextInputTokens) / avg)
```

Only shown when `s.turnDeltas.length >= 2` and `remaining < 20` (no point surfacing "~180 turns remaining" early in a session).

---

## What Is NOT In Scope

- Per-message token delta badges on bubbles (too noisy, badge pattern)
- In-stream "context is 80% full" system messages (intrusive for Sonnet)
- Auto-compact or slash-command reset (future consideration)
- New modal or confirmation on reset

---

## Files Changed

| File | Change |
|------|--------|
| `renderer/modules/session-manager.js` | Export `MODEL_CTX_LIMITS`; remove `contextInputTokens` from `updateChatStatus`; add debug log; add `turnDeltas` tracking; update `updateContextBar` tooltip; add click handler + reset function; add `cursor: pointer` |
| `renderer/styles/views/cockpit.css` | `cursor: pointer` on `#ctx-bar-{id}` (or via class) |
| `renderer/modules/telemetry.js` | Import and use `MODEL_CTX_LIMITS` instead of inline ternary |

---

## Open Question

Whether `result.usage.input_tokens` is cumulative across all API calls in a turn, or just the last call's value, is unconfirmed without a live test. The fix is safe either way (removes the overwrite entirely), but the `console.debug` line in `updateChatStatus` will confirm it in one DevTools session. Remove the log once confirmed.
