# Learn — Lesson Authoring

Lessons live here as standalone markdown files. Each file is one lesson. The filename becomes the `id`.

## Frontmatter schema

```yaml
---
id: 05-session-rails              # stable ID, matches filename (without .md)
title: Your session rails         # shown in curriculum sidebar and content pane
track: essentials                 # essentials | deeper
order: 5                          # sort within track (lower = earlier)
estimatedMinutes: 3               # shown as "3m" beside the title
tryIt:                            # optional — omit for reading-only lessons
  type: spotlight                 # spotlight | action
  view: terminal                  # which view to switch to before running
  prerequisite: send-message      # optional gate — see list below
  targets:                        # for type: spotlight
    - selector: '[data-learn-target="ctx-bar"]'
      tooltip: "Short copy (~15 words max)."
    - selector: '[data-learn-target="session-timer"]'
      tooltip: "One per step."
  action: prefill-composer        # for type: action — what to do in the view
  text: /start                    # for prefill-composer — what to drop in the composer
---
```

## tryIt types

- **`spotlight`** — overlay backdrop + cutout + tooltip stepping through a list of real UI targets. User clicks Next to advance, Got it on the last step, or Escape to bail.
- **`action`** — perform a real app action. Supported actions:
  - `prefill-composer` — switch to `view`, drop `text` into the chat composer, focus it.

## Prerequisites

- `send-message` — an existing session must have ≥1 user message before the Try-it button enables. Used for lessons that need live session data (Lesson 5).

## Selector targets

Use `data-learn-target="..."` attributes on real DOM elements, not CSS class selectors. Attributes survive CSS refactors and make the tutorial's dependencies explicit. See the Task 12 section of `docs/plans/2026-04-12-onboarding-tutorial.md` for the canonical list.

## Voice

- Write TO the user warmly. Second person ("you", "your") always.
- Invitations, not instructions. No commandment tone, no diagnostic tone.
- No AI tells. No "it's important to," no "what you shared stayed with me."
- Italic closes on most lessons where natural.
- Don't overexplain. Trust the reader.

## Body

Markdown body goes after the closing `---`. Renders with `marked.js` plus the styles in `renderer/styles/views/learn.css`. Inline code is styled; fenced code blocks are supported.
