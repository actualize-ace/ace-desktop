# Design: Operations Container + Auto-Scroll

**Date:** 2026-04-11
**Status:** Approved
**Approach:** B — Single operations container per tool burst

## Problem

Two UX issues in the chat pane:

1. **Tool block noise** — Bash, Edit, Write render as expanded accordion blocks that clutter the chat. Users have to scroll past verbose tool output to find synthesized responses.
2. **No auto-scroll on tool activity** — `appendToolBlock`, `appendToolInput`, and `finalizeMessage` add DOM content without scrolling. The only scroll logic is in `scheduleRender` (text streaming), gated by a 60px `isAtBottom` check that fails as soon as tool blocks push the viewport. The `autoScroll` setting in settings.js exists but is never read by session-manager.

## Design

### Operations Container

Every assistant message gets a `chat-ops-container` element per tool burst. All non-question tool calls append as child items inside it.

**DOM structure:**
```html
<div class="chat-ops-container collapsed">
  <div class="chat-ops-header">
    <span class="chat-ops-icon">⚡</span>
    <span class="chat-ops-count">4 operations</span>
    <span class="chat-ops-chevron">▸</span>
  </div>
  <div class="chat-ops-list">
    <div class="chat-ops-item collapsed">
      <div class="chat-ops-item-header">Read: session-manager.js</div>
      <div class="chat-ops-item-detail"><!-- full content on expand --></div>
    </div>
    <div class="chat-ops-item collapsed">
      <div class="chat-ops-item-header">Bash: npm install</div>
      <div class="chat-ops-item-detail"><pre>npm install</pre></div>
    </div>
    <div class="chat-ops-item collapsed">
      <div class="chat-ops-item-header">Edit: chat.css</div>
      <div class="chat-ops-item-detail"><!-- diff view --></div>
    </div>
  </div>
</div>
```

**Two-level accordion:**
- Click container header → toggles `chat-ops-list` visibility (shows item list)
- Click any item header → toggles that item's `chat-ops-item-detail` (shows diff/command/content)

**What stays outside the container (unchanged):**
- `AskUserQuestion` → renders as `chat-question-block`
- Permission approval cards → render via `renderPermissionApprovalCard` on `msgsEl`
- Text content → renders in `chat-settled` / `chat-tail`

**Counter:** Header updates live: `1 operation` → `2 operations` → etc. (singular/plural).

**Detail rendering per tool type:**
- Edit → diff view (old_string red, new_string green)
- Bash → command in `<pre>`
- Write → file path + content preview (truncated at 500 chars)
- Read/Glob/Grep → compact file path label
- Everything else → JSON stringify of input

### Auto-Scroll

Three changes:

1. **Wire up `autoScroll` setting** — read from config. When `false`, skip all auto-scroll calls. Default: `true`.

2. **Scroll on tool activity** — after inserting into ops container or creating a new container, scroll to bottom if within threshold. Threshold: 120px (up from current 60px — accommodates 2-3 tool blocks of drift).

3. **Scroll on finalize** — when response completes, scroll to bottom with generous 300px threshold. If user has scrolled more than 300px up, they're deliberately reading — don't interrupt. If within 300px (drifted due to tool noise), snap to bottom.

### Edge Cases (Pressure-Tested)

#### AskUserQuestion mid-burst
Sequence: `Read → Read → AskUserQuestion → Edit → Edit`

When a question block is inserted, null out `s._opsContainer`. Next non-question tool creates a fresh container. Result:
```
[⚡ 2 operations: Read, Read]
[Question: "Are you sure?"]
[⚡ 2 operations: Edit, Edit]
```

#### Skill/close detection
Currently uses `s._toolGroup?.name === 'Skill'` (line 522). Replace with `s._currentToolName === 'Skill'`. Set `s._currentToolName` in `appendToolBlock` for every tool call.

#### Multiple text↔tool transitions
Sequence: `text → tools → text → tools → text`

When text block starts (line 474), reset `s._opsContainer = null` and create new settled/tail pairs. Each tool burst gets its own ops container:
```
[text paragraph 1]
[⚡ 3 operations]
[text paragraph 2]
[⚡ 2 operations]
[text paragraph 3]
```

#### Permission approval cards
Render on `msgsEl` (line 641), not inside assistant message. Completely independent. No change needed.

#### Agent sessions
Use xterm terminal, different rendering path. Unaffected.

#### History view
Independent rendering from message data. Has its own collapsed tool display. Unaffected.

## File Changes

### `renderer/modules/session-manager.js`

- **Remove** `VISIBLE_TOOLS` set (line 210)
- **Replace** `appendToolBlock` — create/get `chat-ops-container`, append `chat-ops-item`, update counter. Question tools still render as `chat-question-block` outside container.
- **Update** `appendToolInput` — detail rendering targets `chat-ops-item-detail`. Same diff/command/preview logic.
- **Update** `content_block_start` text handler (line 474) — replace `s._toolGroup` with `s._opsContainer` in transition check.
- **Update** `content_block_stop` (line 519) — replace `s._toolGroup?.name` with `s._currentToolName` for Skill detection.
- **Update** `finalizeMessage` — add scroll-to-bottom with 300px threshold. Clean up `s._opsContainer`.
- **Add** scroll call in ops container creation/update (120px threshold).
- **Add** `autoScroll` config check — read from settings, gate all scroll calls.

**New session state:**
- `s._opsContainer` — DOM reference to current ops container element
- `s._opsCount` — running count for header label
- `s._currentToolName` — name of the current tool (for Skill detection)

**Removed session state:**
- `s._toolGroup` — replaced by `_opsContainer`

### `renderer/styles/chat.css`

- **Add** `chat-ops-container`, `chat-ops-header`, `chat-ops-list`, `chat-ops-item`, `chat-ops-item-header`, `chat-ops-item-detail` styles
- **Keep** `chat-tool-block` styles temporarily (history view references similar patterns)
- Visual language: same border/monospace/gold as existing tool blocks, but compact

### No changes to:
- `chat-renderer.js`
- `agent-manager.js`
- `views/history.js`
- `renderPermissionApprovalCard`
- `chat-question-block` / `AskUserQuestion` rendering
