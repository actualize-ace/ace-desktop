## Somatic Atmosphere Phase 1A — Build Session

We're building the core somatic loop for ACE Desktop. Before writing any code, read these two documents in order:

1. **Design doc** — `docs/plans/2026-04-03-somatic-atmosphere-infusion-design.md` (APPROVED). Read sections 1-6 for full context: problem statement, research foundation, design principles, architecture, feature spec. Pay close attention to Section 10 (Progressive Build Phases) — we are building **Phase 1A only** (intensity bar + nudge strip + breath view).

2. **Implementation plan** — `docs/plans/2026-04-03-somatic-atmosphere-phase1a-plan.md`. This has the 8 tasks with exact file paths, code, and commands.

Before building, review both docs and tell me:
- Does the implementation plan accurately reflect the design doc's Phase 1A spec?
- Are there any gaps between what the design describes and what the plan builds?
- Any concerns about the approach given the current codebase on branch `refactor/modular-renderer`?

Read the existing renderer code too — `renderer/state.js`, `renderer/index.html`, `renderer/styles/tokens.css`, and `renderer/modules/theme.js` — to verify the plan's file paths and integration points are correct.

Once review is complete, execute the plan using `superpowers:executing-plans`.
