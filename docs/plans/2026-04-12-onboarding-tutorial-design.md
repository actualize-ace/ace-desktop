# Onboarding Tutorial + Learn Tab — Design

**Date:** 2026-04-12
**Branch:** `desktop-onboarding-tutorial`
**Status:** Design approved, ready for implementation plan
**Blocks:** Phase 1 Mac Ship (Joe Hawley build) — last non-signing item on the roadmap.

---

## Goal

Ship a first-run tutorial and a persistent knowledge base for ACE Desktop. A new client (Joe, Marc) should be able to go from "app installed" to "I know how to use this daily" in ~10 minutes without a live call. The same surface doubles as a reference manual they can revisit any time.

## Non-goals

- Not a Claude Code tutorial. Clients arrive via a Build Session; they already know how to chat.
- Not a replacement for `/build-vault` or `/sync-core`. This teaches the app, not the vault intake.
- Not a feature flag / A-B test platform. Content is linear markdown.
- Not client-editable. Content ships bundled with the app binary.

## Shape

**Hybrid interactive tutorial + knowledge base, layered by depth.**

- **First-run**: after setup completes, the app routes to a new `Learn` view instead of Dashboard. Users see an Essentials track (8 lessons, ~12 min). They can skip and resume any time.
- **Persistent**: `Learn` is a permanent sidebar tab (grouped near Settings at the bottom). Users can revisit lessons, jump around, and access a deeper track covering every view.
- **Interactive on the lessons that matter**: four lessons (Vault, Command Center, Chat, Session Rails, `/start`, `/eod`) use an overlay spotlight + tooltip to walk the user through real UI. The rest are plain text + screenshots.

## Essentials curriculum (first-run, ~12 min)

| # | Lesson | Try it? | What it teaches |
|---|--------|---------|-----------------|
| 1 | Welcome + the Triad | — | A/C/E concept in 60s. What ACE is and isn't. |
| 2 | Your vault, your sovereignty | spotlight | Vault tab, where files live, local-first principle. |
| 3 | The Command Center | spotlight tour | Dashboard anatomy: Triad deck, North Star, widgets. |
| 4 | Chat with ACE | send message + `/brief` | Sessions, slash commands, model/effort/permissions. |
| 5 | Your session rails | spotlight | Context bar (input/output/cache + thresholds), session timer (15/30/60/90m, warning→critical→expiry), 3-per-pane limit. Requires an active session with some history — user sends a message first, then the spotlight points at real numbers. |
| 6 | Starting your day | run `/start` | The daily anchor. What it reads, what it writes. |
| 7 | Closing your day | run `/eod` | The truth-capture ritual. |
| 8 | Going deeper | — | Pointer to the Deeper track. |

## Deeper track (Learn tab, not first-run)

Browsable by topic, no ordering. Lessons live in the same `renderer/data/learn/` directory with a `track: deeper` flag.

- Insight (voice coaching, Deepgram STT/TTS)
- Breath protocols
- Oracle
- Astro (natal blueprint)
- Artifacts
- People + network
- Knowledge graph
- Agent Terminal (vs chat)
- Lean mode
- Settings (themes, zoom, autoscroll, cost guardrails, MCP config)

All deeper lessons are text + screenshots. No spotlights — by the time a user is exploring these, coach marks feel patronizing.

## Architecture

### Content layer

Lesson content lives in `ace-desktop/renderer/data/learn/*.md`. Each file is Markdown with YAML frontmatter:

```markdown
---
id: 05-session-rails
title: Your session rails
track: essentials
order: 5
estimatedMinutes: 2
tryIt:
  type: spotlight
  prerequisite: send-message
  targets:
    - selector: '[data-learn-target="ctx-bar"]'
      tooltip: "This is your context bar. Green = plenty of room. Gold = breathing warning. Red = wrap up the session."
    - selector: '[data-learn-target="session-timer"]'
      tooltip: "Your session timer. Set a duration when you start a container. Warning at 80%, critical at 95%."
---

# Your session rails

...markdown body...
```

- `id` — stable identifier for progress tracking.
- `track` — `essentials` | `deeper`.
- `order` — sort order within track.
- `tryIt` — optional. `type: spotlight` | `action` | null. `prerequisite` is an app-state check (e.g. `send-message` requires an active session with at least one message).
- Rendered via `marked.js` (already bundled).

### UI layer

New view: `renderer/views/learn.js` + `renderer/styles/views/learn.css`.

Two-pane layout inside the Learn view:
- **Left (320px)**: curriculum sidebar. Two sections (Essentials, Deeper). Each lesson shows title + estimated minutes + completion state (empty circle / filled circle / "continue" marker on current). Sticky.
- **Right (fluid)**: lesson content pane. Markdown body + "Try it" button (if `tryIt` present) + Prev/Next nav at bottom.

### Spotlight layer

New module: `renderer/modules/learn-coach.js`.

When user clicks "Try it" on a `type: spotlight` lesson:
1. Verify prerequisite (e.g. "send a message first" → show inline hint if not met, don't launch overlay).
2. Navigate to the target view (Dashboard, chat, Vault, etc.).
3. Mount a fixed-position overlay at body root (NOT inside the titlebar `-webkit-app-region: drag` zone — see memory on that). Full-viewport dark backdrop (rgba 0,0,0,0.6) with a cutout that matches the target element's bounding rect + 8px padding.
4. Tooltip positioned adjacent to the cutout (auto-flip based on viewport edges).
5. "Next" advances to the next target in the sequence; "Got it" closes the overlay and returns the user to the Learn tab; Escape closes without marking complete.
6. On complete: mark the lesson's `completed` flag in `ace-config.json`.

Targeting uses `data-learn-target="..."` attributes — NOT CSS selectors tied to class names. This survives CSS refactors and makes the tutorial's dependencies explicit. Each target lives on a real DOM element; if we remove a feature, the tutorial breaks loudly in development, not silently in production.

### Progress / persistence

State stored in `ace-config.json` under `learn`:

```json
{
  "learn": {
    "firstRunComplete": false,
    "lessonsCompleted": ["01-welcome", "02-vault"],
    "lastOpenedLesson": "03-command-center",
    "dismissedFirstRun": false
  }
}
```

- On app launch: if `firstRunComplete === false` AND `dismissedFirstRun === false`, route to Learn tab after setup.
- "Skip for now" sets `dismissedFirstRun = true`, routes to Dashboard. Learn tab still shows a small dot until all Essentials lessons are completed.
- Clicking any lesson marks `lastOpenedLesson`. Completing marks `lessonsCompleted`. When `lessonsCompleted` contains all Essentials IDs, `firstRunComplete = true` and the sidebar dot clears.

### Navigation integration

Add Learn as the second-to-last sidebar item (above Settings). Icon: open-book glyph. When `firstRunComplete === false`, show a small gold dot (`--gold-attention: #d4a574` — matching the notification system token).

## Data flow

```
Setup completes
  → main checks config.learn.firstRunComplete
  → if false and not dismissed, renderer routes to Learn view
  → Learn view mounts, reads lessons from learn/*.md via IPC (sync at startup)
  → User clicks lesson → content pane renders markdown
  → User clicks "Try it" → learn-coach.js takes over
    → verify prerequisite → navigate → mount overlay → walk targets
    → on complete → patchConfig({ learn: { lessonsCompleted: [...] } })
  → User clicks Prev/Next → advance in curriculum sidebar
  → User completes final Essentials lesson → firstRunComplete = true, dot clears
```

## Error handling

- **Missing lesson file**: log to DevTools, skip silently in the sidebar. Tutorial must never crash the app.
- **Missing `data-learn-target` element**: spotlight shows a non-blocking "this feature moved" toast, advances to next target or closes gracefully. Don't leave the user stuck behind a dark overlay.
- **Prerequisite unmet** (e.g. "send a message" when no session is open): inline hint above the "Try it" button, disable the button until satisfied. No error dialogs.
- **Config write fails**: progress stays in memory for the session. Non-fatal.

## Testing

ace-desktop has no test framework (per roadmap Parked item). Verification is manual:

- Fresh install → routes to Learn on first launch.
- Skip → Dashboard, dot persists on sidebar.
- Resume → Continue button points at next uncompleted lesson.
- Each "Try it" flow works end-to-end without spotlights leaking into subsequent navigation.
- Mark Essentials complete → dot clears.
- Dark + light modes both legible.
- Zoom 50%–200% — curriculum sidebar doesn't clip.
- Escape closes overlay cleanly.
- Click outside tooltip but inside backdrop does NOT dismiss (prevents accidental escape during a multi-step tour).

## Risks / open questions

1. **Lesson 5 prerequisite** — requires a real chat session with ≥1 message for the context bar to have numbers. If the user is on first-run and hasn't chatted yet, the lesson needs a "send a test message" sub-step before the spotlight. Plan must handle this cleanly.
2. **Spotlight on a dynamically-rendered target** — e.g. the context bar only exists once a session has an active stream. Need a small `waitForSelector` helper with a 3s timeout before giving up.
3. **Copy-writing takes time** — 8 essentials lessons at ~150-300 words each is 2-3 hours of writing alone. Plan should budget this as its own task, not fold it into implementation.
4. **Screenshots for deeper track** — 10 lessons × 1-2 screenshots each = 10-20 images. Keep them in `renderer/data/learn/images/` and commit as part of the content sprint, not the infrastructure sprint.

## Out of scope (deferred)

- Vault-driven content (`00-System/learn/` synced from `actualize-ace/core`). Migration path: markdown schema stays identical; just swap the read path.
- Search across lessons. Ship with curriculum sidebar only; add search if clients ask.
- Video clips / animated demos. Static screenshots are enough for v1.
- Localization / i18n. English only.
- Tutorial analytics. Not instrumenting which lessons get skipped — can layer in later.

## Approval

Design approved 2026-04-12 by Nikhil. Next: implementation plan via writing-plans skill.
