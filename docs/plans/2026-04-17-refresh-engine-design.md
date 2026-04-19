# Refresh Engine Design — Two-tier with Observable Health Score

**Date**: 2026-04-17
**Branch**: TBD
**Status**: Approved

## Problem

Electron apps degrade over long-running sessions. ACE Desktop users leave the app open for hours or days. Known leak/staleness vectors:

- **DOM accumulation**: Every chat message appended, never pruned, no virtual scroll. 500+ messages = 500+ nodes with parsed markdown, syntax highlighting, event listeners.
- **Streaming buffer orphans**: Interrupted streams leave `_currentAssistantEl`, `_settledHTML`, `_fullResponseText` allocated.
- **IPC listener leaks**: Registered per session (stream, error, exit), cleaned only on explicit `closeSession()`.
- **Timer leaks**: `_wordTimer`, `_sessionTimer` run forever if close doesn't fire.
- **Chart/Graph instances**: D3 force simulations and Chart.js instances created but never destroyed on view exit.
- **MCP token staleness**: Cached in `~/.mcp-auth/`, no periodic refresh. Long sessions = silent auth expiry.
- **Config drift**: Renderer state loaded once at init. Config changes on disk not reflected without manual reload.
- **O(n) streaming**: `findSettledBoundary()` walks entire accumulated text per chunk.

## Approach: Hybrid (Soft GC + Full Reload)

Two tiers of self-healing:

1. **Soft GC** — Runs every 30 min (or sooner if health degrades). Prunes DOM, clears buffers, destroys inactive view instances, reloads config. Invisible to the user.
2. **Full Reload** — `location.reload()` after 6+ hours idle and 2+ hours uptime. Gentle reset: restores view and theme, but atmosphere and DOM start fresh.

## Architecture

```
+---------------------------------------------------+
|  refresh-engine.js  (coordinator, ~150 lines)      |
|                                                    |
|  bootedAt --- lastActivity --- lastSoftGC          |
|                    |                               |
|              healthScore <--- sensors               |
|              (0.0 - 1.0)     +----------------+    |
|                    |         | DOM nodes      |    |
|         +----------+------+  | listeners      |    |
|         |                |   | session count   |    |
|         v                v   | uptime hours    |    |
|    soft-gc           full    +----------------+    |
|    (event)          reload                         |
|         |                |                         |
|    modules listen    persist > reload > restore    |
+---------------------------------------------------+
```

Core loop: 60-second `setInterval` checks conditions and emits `ace:soft-gc` or triggers reload. Modules register cleanup via `onSoftGC(fn)` / `onWillReload(fn)` callbacks.

## Health Score

0.0 = fresh boot, 1.0 = critical. Soft GC threshold: **0.7**.

| Sensor         | Weight | Baseline (0.0) | Critical (1.0) | How Measured                                    |
|----------------|--------|----------------|----------------|-------------------------------------------------|
| DOM pressure   | 0.35   | < 50 nodes     | > 500 nodes    | `.chat-msg` count across all sessions           |
| Listener count | 0.15   | < 10           | > 60           | Tracked registrations in session-manager        |
| Session count  | 0.15   | 1-2            | > 8            | `Object.keys(state.sessions).length`            |
| Uptime hours   | 0.20   | < 1 hr         | > 8 hrs        | `(Date.now() - bootedAt) / 3.6e6`              |
| GC staleness   | 0.15   | < 10 min       | > 60 min       | `(Date.now() - lastSoftGC) / 1.8e6`            |

Each sensor returns 0.0-1.0, clamped. Final score = weighted sum.

## Timing Parameters

| Parameter                        | Value   | Rationale                                          |
|----------------------------------|---------|----------------------------------------------------|
| Soft GC interval                 | 30 min  | Frequent enough to prevent buildup, rare for invisible |
| Soft GC activity cooldown        | 5 min   | Don't GC while user is actively working            |
| Full reload idle threshold       | 6 hrs   | Covers overnight + long away                       |
| Minimum uptime for full reload   | 2 hrs   | Prevents reload on quick lunch break               |
| Health score early GC threshold  | 0.7     | Heavy sessions get cleaned sooner                  |
| Coordinator tick interval        | 60 sec  | Lightweight check, no observable cost              |

## Soft GC — Module Cleanup Targets

### session-manager.js (heaviest impact)
- Prune DOM: keep last 40 messages per session, replace older with "load earlier" tombstone
- Clear finalized streaming buffers: `_settledHTML`, `_fullResponseText`, `_settledBoundary`
- Cancel orphaned `_pendingRAF` and `_wordTimer` on non-streaming sessions
- Sweep IPC listeners for sessions with no active stream

### graph.js / people.js
- Destroy D3 force simulation if view is not active
- Null out node/link data structures
- Re-initialize on next view entry (existing init guards handle this)

### Chart.js widgets
- Call `.destroy()` on chart instances when view is inactive
- Recreate on next render

### atmosphere.js
- Reset `sessionActiveMin` counter (display-only, not persisted)
- Clear stale nudge timers

### coherence.js
- Clear stale sensor timeout if no data received

### Config hot-reload
- Re-read `ace-config.json` via IPC
- Update `state.chatDefaults` in place

## Full Reload Flow

### Trigger (ALL must be true)
1. Uptime > 2 hours
2. Idle > 6 hours (`Date.now() - state.atmosphere.lastActivity`)
3. No session is streaming (`!Object.values(state.sessions).some(s => s.isStreaming)`)

### Pre-reload persist (localStorage)
```js
{
  _aceReloadMarker: true,
  lastView: state.activeView,
  theme: state.theme,
  sessionIds: Object.keys(state.sessions),
  sidebarCollapsed: state.sidebarCollapsed
}
```

### Post-reload restore (index.html init)
- Check for `_aceReloadMarker` in localStorage
- Restore view, theme, sidebar state
- Clear the marker
- Sessions rebuild from `claudeSessionId` (persisted server-side)
- Fresh atmosphere, fresh health score

## UI Element — Vitals Dot

Somatic ambient indicator (no badges, no red dots, no numbers). Placed in the bottom status area near the context meter.

| Health Range | Visual                                  | Tooltip                  |
|--------------|-----------------------------------------|--------------------------|
| 0.0 - 0.4   | Steady dim glow, slow pulse (~4s cycle) | "System vitals: clear"   |
| 0.4 - 0.7   | Brighter, moderate pulse (~2.5s)        | "System vitals: warming" |
| 0.7 - 1.0   | Warm amber glow, fast pulse (~1.5s)     | "Refreshing..."          |

After soft GC: dot eases back to slower pulse. After full reload: resets to slowest.
Not clickable in v1. Future: click to surface sensor breakdown panel.

## What This Achieves

### For users
- App stays fast all day — no "restart to fix sluggishness"
- Prevents black screen / renderer jam incidents
- Overnight healing — come back to a fresh app
- Zero maintenance burden — self-regulating
- Sessions never lost — `claudeSessionId` survives both tiers

### For the platform
- Forces state discipline: persisted vs. ephemeral boundary becomes architectural
- Eliminates a class of support tickets (slow, black screen, stale MCP)
- Observable health score for debugging
- Foundation for multi-session scaling (DOM pruning caps node count)
- Differentiator — an app that visibly self-heals

## Existing Infrastructure to Leverage

- `atmosphere.js` already tracks `lastActivity` with idle detection (8 min pause, 30 min end)
- `ace-config.json` persistence and IPC read/write already wired
- `claudeSessionId` for chat thread resumption already persisted
- `closeSession()` cleanup pattern already exists to model after
- View enter/exit hooks already in index.html nav wiring
