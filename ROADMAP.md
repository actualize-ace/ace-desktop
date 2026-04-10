# ACE Desktop — Roadmap

> Single source of truth for what's shipped, what's next, and what's parked.
> Updated: 2026-04-10

---

## Shipped

Core platform — 353 commits on main.

| Feature | Status | Notes |
|---------|--------|-------|
| Electron app architecture | Done | main/renderer/preload, IPC bridge |
| Dashboard + modular widgets | Done | State, outcomes, pipeline, velocity, follow-ups, metrics |
| Claude CLI chat integration | Done | stream-json, --resume multi-turn, model/effort/permissions |
| Agent Terminal (full Claude Code) | Done | node-pty, xterm.js, split pane |
| Vault editor + file browser | Done | Markdown editing, frontmatter support |
| Knowledge graph (D3.js) | Done | Force-directed vault visualization |
| Setup screen | Done | Vault picker, binary detection, config persistence |
| Context bar (token tracking) | Done | Per-session input/output/cache tracking, threshold warnings |
| Inner Move coaching card | Done | Pattern-aware coaching in Command Center |
| Coherence HRV UI | Done | HeartMath BLE integration, HRV panel, somatic bar (auto-connect disabled pending calibration) |
| Breath protocols | Done | Sighing, box, 4-7-8, coherence, custom |
| Insight view (voice coaching) | Done | Deepgram STT/TTS, coaching presets |
| Artifacts view | Done | Status tracking, file association |
| People + network view | Done | Follow-ups, relationship graph |
| History view | Done | Session browser, project grouping |
| Astro blueprint | Done | Natal chart rendering |
| Oracle view | Done | Divinatory interface |
| Atmosphere (somatic layer) | Done | Activity tracking, time-of-day, solfeggio/binaural audio |
| Cost guardrails | Done | Session cost warning, daily spend tracking |
| Sidebar commands | Done | Customizable, drag-reorder, color-coded |
| Lean mode toggle | Done | --strict-mcp-config for MCP overhead reduction (Settings > Chat Defaults) |
| External links in browser | Done | Not inside Electron |

---

## In Progress — Ship Sprint (Apr 12-13)

Target: first client builds for Joe Hawley (macOS) + Marc Cooper (Windows).

| Feature | Status | Blocker | Plan |
|---------|--------|---------|------|
| Rich output panel | Not started | Blocks client UX | Replace xterm chat with HTML renderer (markdown, code blocks, tool cards) |
| Session containment + timer | Not started | — | [containment-ritual-ux.md](docs/plans/2026-04-09-containment-ritual-ux.md) |
| Native module bundling | Not started | Blocks dist | Ensure better-sqlite3 + node-pty compile for target arch |
| Windows build | Not started | Blocks Marc | electron-builder Windows target |
| First client deploy test | Not started | Blocks ship | Joe Hawley macOS build verification |

---

## Next — Post-Ship (Apr 14-30)

| Feature | Priority | Plan |
|---------|----------|------|
| Token economy Phase 2 — context lifecycle | High | Auto-effort at 80%, brevity injection at 70%, cache countdown + refresh button. [token-economy-overhaul.md](../ace-desktop-token-economy-overhaul.md) |
| Living orb | Medium | Animated orb reacting to PTY activity / session state |
| Scratchpad | Medium | Persistent markdown notepad sidebar |
| Client feedback integration | Medium | Incorporate Joe + Marc usage patterns |
| HeartMath calibration | Low | Side-by-side session (ACE vs HeartMath app) to fix coherence thresholds |

---

## Parked — Future Sprints

| Feature | Notes | Plan |
|---------|-------|------|
| Token economy Phase 3 — provider routing | OpenRouter/LiteLLM fallback when subscription limits hit | [token-economy-overhaul.md](../ace-desktop-token-economy-overhaul.md) |
| Token economy Phase 4 — Graphify | Knowledge graph context compression for vault reads | [token-economy-overhaul.md](../ace-desktop-token-economy-overhaul.md) |
| Token economy Phase 5 — direct SDK | Bypass CLI for pure conversation (~100x baseline savings) | [token-economy-overhaul.md](../ace-desktop-token-economy-overhaul.md) |
| Embedded browser | Chromium pane for in-app reference docs | — |
| Two-layer architecture | Sovereign Base (offline) + ACE Live (subscription) | — |
| Build/Share polarity meter | Auto-derived ratio replacing manual mode toggle | — |
| Sovereign mode (Ollama) | Local model with context compression | — |
| Canvas view | ON HOLD | — |
| Multi-engine fallback | Codex plugin now, ace-engine adapter later | — |

---

## Design Docs (in `docs/plans/`)

| File | Status |
|------|--------|
| [2026-04-09-containment-ritual-ux.md](docs/plans/2026-04-09-containment-ritual-ux.md) | Ready to build |
| [2026-03-18-modular-dashboard-plan.md](docs/plans/2026-03-18-modular-dashboard-plan.md) | Shipped |
| [2026-03-18-modular-dashboard-design.md](docs/plans/2026-03-18-modular-dashboard-design.md) | Shipped |
| [2026-03-17-knowledge-graph.md](docs/plans/2026-03-17-knowledge-graph.md) | Shipped |
| [2026-03-17-vault-graph-design.md](docs/plans/2026-03-17-vault-graph-design.md) | Shipped |

---

## How to Use This File

- **Start of session:** Read this to orient. Check "In Progress" for current sprint.
- **After shipping:** Move from "In Progress" → "Shipped". Pull from "Next" into "In Progress".
- **After planning:** Add new items to "Next" or "Parked" with a link to the plan doc.
- **Monthly reflection:** Review "Parked" — promote, drop, or keep.
