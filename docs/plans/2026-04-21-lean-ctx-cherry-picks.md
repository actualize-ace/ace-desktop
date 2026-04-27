# lean-ctx Cherry-picks — Implementation Plan
**Source:** https://github.com/yvgude/lean-ctx  
**Date:** 2026-04-21  
**Scope:** Three independent tracks — two workflow, one ACE Desktop feature

---

## Why

lean-ctx is a context compression runtime for AI coding sessions. ACE doesn't benefit from its cost-reduction pitch (Claude Max subscription), but three specific patterns are directly applicable:

1. **Shell + file output compression** in Claude Code sessions → reduces context pressure in long vault sessions
2. **Read mode taxonomy** (signatures / map / full) → enforce bounded-intelligence in skills
3. **Mid-session finding capture** → prevent the /close data loss problem in ACE Desktop

---

## Track A — Developer Workflow: lean-ctx for Claude Code Sessions
**Effort:** 30 min · **Risk:** Low · **Blocked by:** Nothing

### What
Install lean-ctx binary + wire Claude Code PreToolUse hook so shell output and file reads are automatically compressed during Claude Code sessions. Only affects the dev environment (not shipped to clients).

### Steps

```bash
# 1. Install
brew tap yvgude/lean-ctx && brew install lean-ctx

# 2. Wire Claude Code hook
lean-ctx init --agent claude

# 3. Verify
lean-ctx doctor
```

`lean-ctx init --agent claude` writes a PreToolUse hook to `~/.claude/settings.json` that wraps Bash tool calls with compression. This requires explicit approval per `feedback_settings_json_permission.md` — if denied, add manually:

```json
// ~/.claude/settings.json — add under "hooks"
"PreToolUse": [
  {
    "matcher": "Bash",
    "hooks": [{ "type": "command", "command": "lean-ctx hook" }]
  }
]
```

### What gets compressed
- `git status / diff / log` → 70% reduction
- `npm install / build output` → 80% reduction
- File reads (map mode) → 90% reduction
- Directory listings → 80% reduction

### Useful commands in Claude Code sessions
```bash
lean-ctx -c git diff HEAD          # compressed diff
lean-ctx read ace-desktop/renderer/modules/chat-manager.js -m signatures  # API surface only
lean-ctx read ace-desktop/renderer/modules/chat-manager.js -m map         # dependency graph
lean-ctx gain                      # visual savings dashboard
```

---

## Track B — Skill Enhancement: Read Mode Constraints in build-mode
**Effort:** 15 min · **Risk:** Zero · **Blocked by:** Track A installed (binary must exist)

### What
Add read mode guidance to `.claude/skills/build-mode/SKILL.md` so Claude Code uses compressed reads by default when working on ace-desktop code.

### Constraint block to add
In `build-mode` Constraints section, append:

```
## Read Mode Discipline (requires lean-ctx installed)
When working on ace-desktop code:
- BEFORE editing a file: `lean-ctx read <path> -m signatures` to understand API surface (10-20% tokens)
- EXPLORING a module's role: `lean-ctx read <path> -m map` (5-15% tokens)  
- ACTUALLY EDITING: full Read tool (must see every line)
- Never full-read a file just to understand what it does

If lean-ctx is not installed: fall back to Read tool but limit to relevant sections.
```

### Files to edit
- `.claude/skills/build-mode/SKILL.md` — add constraints block

---

## Track C — ACE Desktop Feature: Mid-Session Finding Capture
**Effort:** 2–3h · **Risk:** Low · **Branch:** `lean-ctx-findings` off `perf-hardening-apr20` (or off `main` after merge)

### Problem
Sessions crash or die before `/close` runs. Decisions, file locations, and architectural findings discovered mid-session vanish. lean-ctx's `ctx_session finding "file:line — summary"` pattern shows the fix: capture incrementally, not at the end.

### Design
A lightweight in-chat action that persists findings to `userData/session-findings.json` in real-time. At `/close` time, findings are surfaced and appended to the session log automatically.

**No new views** — findings surface in two existing places:
1. A "Pin finding" button on Bash/Edit/Write tool cards (inside ops-container)
2. The `/close` skill reads `session-findings.json` and prepends findings to the session log entry

### Data schema
```json
// ~/Library/Application Support/ACE/session-findings.json
{
  "session_id": "2026-04-21-vault-session",
  "created_at": "2026-04-21T14:23:00Z",
  "findings": [
    {
      "id": "uuid",
      "ts": "2026-04-21T14:23:11Z",
      "text": "chat-manager.js:L142 — batch flush skips on reconnect",
      "source": "pinned"    // "pinned" | "manual" | "auto"
    }
  ]
}
```

### Implementation steps

**Step 1: findings-manager.js (main process)**
- `findings-manager.js` in `ace-desktop/main/`
- `startSession(sessionId)` → creates/clears `session-findings.json`
- `addFinding(text, source)` → appends to findings array, writes to disk
- `getFindings()` → returns current findings
- `clearFindings()` → wipes after /close consumed them

**Step 2: IPC surface (preload.js)**
- `window.ace.findings.pin(text)` → IPC to main `finding:add`
- `window.ace.findings.get()` → IPC to main `finding:get`
- `window.ace.findings.clear()` → IPC to main `finding:clear`

**Step 3: "Pin" button on tool cards (chat-renderer.js / ops-container.js)**
- Add a small pin icon (📌) to each tool card in the ops-container
- On click: prefill a mini inline text field with `"<filename>:<line> — "` context
- On confirm: `window.ace.findings.pin(text)`
- Toast confirmation: "Finding pinned"

**Step 4: Manual capture shortcut**
- Add `/pin <text>` as a chat command shortcut (add to command-registry.js)
- Or: Cmd+Shift+P → opens a modal text field for freeform finding entry

**Step 5: /close skill integration**
- At the end of `/close`, call `window.ace.findings.get()`
- If findings exist: surface them in the session log under `## Key Findings`
- Call `window.ace.findings.clear()` after write

**Step 6: Auto-capture (optional, Phase 2)**
- When a Write tool card completes (new file written), auto-capture: `"<path> created — <first line of file>"`
- When an Edit completes on a new function: auto-capture the function signature
- Configurable in Settings > Chat

### Files touched
| File | Change |
|------|--------|
| `ace-desktop/main/findings-manager.js` | New — findings store |
| `ace-desktop/main/main.js` | Register IPC handlers, init findings-manager |
| `ace-desktop/preload.js` | Expose `window.ace.findings` bridge |
| `ace-desktop/renderer/modules/chat-renderer.js` | Pin button on tool cards |
| `ace-desktop/renderer/modules/ops-container.js` | Pin button wiring |
| `ace-desktop/renderer/modules/command-registry.js` | `/pin` command |
| `.claude/skills/close/SKILL.md` | Add findings read + append step |

### Non-goals
- No findings view / sidebar (use existing session log)
- No sync to vault (findings stay local until /close writes them)
- No findings from agent terminal (only chat pane)

---

## Ship Order

| Track | Effort | Dependency | Ship when |
|-------|--------|------------|-----------|
| A — lean-ctx install | 30 min | Nothing | Now (dev machine only) |
| B — build-mode skill | 15 min | Track A | Same session as A |
| C — finding capture | 2–3h | Nothing | After perf-hardening merge |

Track C is independent of A+B. Can build on any branch.

---

## References
- lean-ctx source: https://github.com/yvgude/lean-ctx
- lean-ctx SKILL.md: https://github.com/yvgude/lean-ctx/blob/main/skills/lean-ctx/SKILL.md
- ctx_session docs: lean-ctx README § Session Continuity (CCP)
- ACE Desktop perf branch: `perf-hardening-apr20`
- Related ACE memory: `feedback_close_before_links.md`, `project_perf_hardening_branch.md`
