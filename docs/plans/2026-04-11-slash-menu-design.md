# Slash Command Menu — In-Chat `/` Autocomplete

**Status:** Approved
**Date:** 2026-04-11
**Scope:** 1 new file, 2 modified files, ~160 lines total

## Problem

25 slash commands exist in the command registry but are only accessible via Cmd+K (global palette) or sidebar buttons (max 8 pinned). There's no way to discover or invoke commands from the chat input itself — the place where the user is already typing.

## Solution

An upward-growing autocomplete menu that appears when `/` is typed as the first character in the chat textarea. Fuzzy-filters as the user types, inserts the selected command into the textarea on Enter/click, and lets the user append context before sending.

## Decisions

| Decision | Choice | Rationale |
|----------|--------|-----------|
| Trigger | `/` at position 0 only | Mid-sentence slashes are punctuation, not commands |
| On select | Insert text into textarea | User keeps control — can add context, review before sending |
| Ordering | Pinned sidebar commands first, then by fuzzy score | Sidebar = user's stated preferences; fuzzy handles the rest |
| Direction | Grows upward (VS Code style) | Input is at the bottom of the screen; menu opens above it |
| Dismiss | Escape, click outside, backspace past `/` | Standard dropdown behavior, no surprises |
| Scope | Commands only, no views | Views don't make sense from a chat input |

## Visual Spec

```
┌──────────────────────────────────┐
│  /weekly-review  Weekly reflec…  │  ← furthest from input
│  /blind-spots    Surface what…   │
│  /coach          Open-ended c…   │
│  /close      ★   Session clos…   │  ← ★ = pinned
│  /content    ★   Content life…   │
│  /commit     ★   Commit and p…   │  ← nearest to input (active)
├──────────────────────────────────┤
│  /co█                          ↑ │  ← textarea
└──────────────────────────────────┘
```

- Best match at bottom, closest to where user is typing
- Active selection starts at bottom, Arrow Up moves away from input
- Max 8 visible items, scrollable beyond that
- Pinned items show subtle `★` indicator
- Each row: command name (primary) + description (dim, truncated)
- Top corners rounded, bottom edge flat (meets input area)
- Upward box-shadow for depth

### Tokens (reuse existing)

- Surface: `--bg-card`, `--border`
- Text: `--text-primary` (command), `--text-dim` (description)
- Active item: `--gold` left border (same pattern as Cmd+K)
- Pinned dot: `--gold-dim`

## Keyboard Navigation

| Key | Behavior |
|-----|----------|
| Arrow Up | Move selection upward (away from input) |
| Arrow Down | Move selection downward (toward input) |
| Enter | Insert selected command into textarea, dismiss menu |
| Escape | Close menu, keep textarea text |
| Backspace past `/` | Close menu (textarea now empty) |
| Any character | Update fuzzy filter query |

When menu is open, Arrow Up/Down and Enter are captured by the menu — they don't propagate to the textarea's normal handlers (send message, etc.).

## Architecture

### New: `renderer/modules/slash-menu.js` (~120 lines)

Standalone module, no framework dependencies.

```
attach(textareaEl)     → hooks input + keydown listeners on a textarea
show(anchorEl)         → creates + positions menu above the anchor
updateFilter(query)    → calls command-registry.search(), applies pinned-first sort
select(item)           → inserts item.cmd + ' ' into textarea, dismisses
dismiss()              → removes menu from DOM
```

**Pinned-first ordering:**
1. Read `config.sidebar.commands[]` via `window.ace.setup.getConfig()` at show-time (not cached — respects live config changes)
2. Partition search results into pinned vs unpinned
3. Pinned retain their sidebar order, unpinned sorted by fuzzy score
4. Both groups filtered by query — pinned commands drop out if they don't match

**Singleton pattern:** Only one menu open at a time across all chat panes. Opening a new one dismisses the previous.

### Modified: `renderer/modules/session-manager.js`

In the input setup block (~line 933):
- Import `slash-menu.js`
- Call `slashMenu.attach(inputEl)` after textarea creation
- The existing `keydown` listener yields to slash-menu when open: Enter selects from menu (not send), Arrow keys navigate menu (not default)

### Modified: `renderer/styles/chat.css`

~40 lines added:
- `.slash-menu` — absolute position, anchored above textarea, `flex-direction: column-reverse`
- `.slash-menu-item` — row layout matching Cmd+K item sizing
- `.slash-menu-item.active` — gold left border
- `.slash-menu-pinned` — subtle star/dot indicator
- Max-height with overflow-y scroll, custom scrollbar

### Not changed

- `command-registry.js` — already has `search()` and `COMMANDS` exports, no modifications needed
- `command-bar.js` — Cmd+K stays independent, no coupling
- `preload.js` / `main.js` — no new IPC channels

## Edge Cases

| Case | Behavior |
|------|----------|
| Menu open + streaming starts | Dismiss menu |
| Multiple chat panes | Each textarea gets `attach()`, menu is singleton |
| Empty filter (`/` alone) | Show all commands, pinned first |
| No matches | Show "No matches" row, Enter does nothing |
| Textarea resize | Menu anchored via CSS relative to `.chat-input-area`, no JS repositioning |
| `/` typed mid-word | No trigger — only fires at position 0 |
| Config change (sidebar commands) | Picked up on next show() — reads fresh config each time |

## What This Does NOT Include

- View navigation from chat input (use Cmd+K)
- Auto-execution on select (user always hits Enter to send)
- Command argument hints or parameter completion (future)
- Recently-used ordering (sidebar pins serve this role)
