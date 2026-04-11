# ACE Desktop — Roadmap

> Single source of truth for what's shipped, what's next, and what's parked.
> Updated: 2026-04-10 — Locked. 49 features across 4 tiers.

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

## In Progress — Phase 1: Mac Ship (Apr 12-13)

Target: first client build for Joe Hawley (macOS). Windows follows after Mac is stable.

| Feature | Status | Blocker | Plan |
|---------|--------|---------|------|
| Setup screen polish | Done | — | Pre-flight module (binary health + vault structure), titlebar status indicator, spawn guards in chat-manager + pty-manager, `/start` placeholder, vault validation gate in setup screen, version display. [Design](docs/plans/2026-04-10-setup-screen-polish-design.md) |
| Onboarding tutorial | Not started | Blocks client UX | Post-setup guided walkthrough shown once. Introduces the Triad, explains daily rituals (/start, /eod), tours the dashboard widgets and views, shows where to get help. Progressive disclosure — don't dump all 22 features at once. |
| Rich output panel | Not started | Blocks client UX | Replace xterm chat with HTML renderer (markdown, code blocks, tool cards) |
| Session containment + timer | Not started | — | [containment-ritual-ux.md](docs/plans/2026-04-09-containment-ritual-ux.md) |
| Process cleanup on exit | Done | — | `killAllChildren()` in main.js — covers `SIGINT`, `SIGTERM`, `process.on('exit')`, `uncaughtException`, `unhandledRejection`, and `before-quit`. Commit `9904225`. |
| Native module bundling (ARM64) | Not started | Blocks dist | Verify better-sqlite3 + node-pty compile against Electron 28 headers for Apple Silicon |
| Code signing / notarization | Not started | Blocks clean install | **Path A (ideal):** Apple Developer ID ($99/yr) → electron-builder afterSign hook → notarized DMG, clean install. **Path B (day-one fallback):** Unsigned DMG, Joe bypasses Gatekeeper via right-click > Open or `xattr -cr` during build session. Document both. Get Apple Dev account set up either way. |
| extraResources verification | Not started | — | Verify `../tools/ace-analytics` resolves correctly on build machine and bundles into DMG |
| First client deploy test | Not started | Blocks ship | Joe Hawley macOS build verification |

---

## Next — Phase 2: Windows Port (after Mac stable)

Target: Marc Cooper (Windows). Sequential — don't start until Joe's Mac build is confirmed working.

| Feature | Status | Blocker | Plan |
|---------|--------|---------|------|
| Windows icon | Not started | Blocks build | Generate `ace.ico` (256x256, multi-resolution) from existing `ace.png`. Place in `assets/`. |
| electron-builder win target | Not started | Blocks build | Add `"win": { "target": "nsis", "icon": "assets/ace.ico" }` to package.json build config. |
| Claude binary detection (Windows) | Not started | Blocks setup | Current detection is macOS-only (`~/.local/bin`, `/usr/local/bin`, `which`). Add Windows paths: `%LOCALAPPDATA%\Programs\claude\`, `%APPDATA%\npm\`. Replace `which` with `where.exe` on win32. |
| Process kill (Windows) | Not started | Blocks chat | `SIGTERM` doesn't work on Windows. `child_process.kill()` calls `TerminateProcess` (hard kill, no cleanup). Add platform check in chat-manager.js — use `taskkill /pid /T` or accept hard kill with graceful session recovery. |
| PTY / ConPTY testing | Not started | Blocks terminal | node-pty 1.0.0 uses ConPTY on Win10 1809+. Verify Claude CLI spawns correctly, ANSI output renders in xterm.js, resize works. Riskiest integration point — test early. |
| npm scripts cross-platform | Not started | Blocks dev | `env -u ELECTRON_RUN_AS_NODE` is Unix-only. Add `cross-env` package or conditional scripts so `npm start` works on Windows. |
| Native module bundling (x64) | Not started | Blocks dist | Rebuild better-sqlite3 + node-pty against Electron 28 headers for Windows x64. May need Windows build machine or CI. |
| Windows code signing | Not started | — | Authenticode certificate for clean install. Can defer — Windows SmartScreen warning is less hostile than macOS Gatekeeper. |
| First Windows deploy test | Not started | Blocks ship | Marc Cooper Windows build verification |

---

## Next — Post-Ship (Apr 14-30)

| Feature | Priority | Plan |
|---------|----------|------|
| Electron upgrade (28 → latest stable) | High | Ship on 28 first — don't destabilize before client deploy. Upgrade post-ship: new Chromium, new Node, security patches. Rebuild all native modules after. Test thoroughly — API changes may break IPC or preload. |
| Token economy Phase 2 — context lifecycle | High | Auto-effort at 80%, brevity injection at 70%, cache countdown + refresh button. [token-economy-overhaul.md](../ace-desktop-token-economy-overhaul.md) |
| Auto-sync health system | High | Background sync keeps views (Artifacts, People, Dashboard) current with vault. Health check flags stale data, visible "last synced" indicator. Start with Artifacts, extend to other views. |
| App auto-update (electron-updater) | High | GitHub Releases as update server. Signed builds, auto-check on launch, download + install prompt. First build clients manually install is the last one they manually install. Requires code signing (macOS notarization, Windows Authenticode). |
| Vault sync from desktop (ace-core pull) | High | On launch: silent `git fetch upstream`, compare HEAD vs upstream. If behind → "ACE update available" badge in dashboard. One-click triggers /sync-core, shows diff summary of what changed. Requires Settings > GitHub config: client enters their repo URL + upstream (actualize-ace/core). Setup screen pre-flight checks git + SSH key. No new MCP — pure git over existing infra. |
| Dashboard customization | Medium | Users pick, rearrange, resize, and hide dashboard widgets. Persist layout per user. Builds on existing modular widget architecture. |
| Living orb | Medium | Animated orb reacting to PTY activity / session state |
| Scratchpad | Medium | Persistent markdown notepad sidebar |
| Notification system redesign | Medium | Replace red dot with non-social-media color (amber/accent). Click notification → jump to correct session pane with pulsing dot on tab. Multiple notifications → dropdown to pick which chat. |
| Terminal session naming | Medium | Sessions created from Agent Terminal default to "ACE" — should auto-name from first prompt or vault context. |
| Client feedback integration | Medium | Incorporate Joe + Marc usage patterns |
| HeartMath calibration | Low | Side-by-side session (ACE vs HeartMath app) to fix coherence thresholds |

---

## Future — Guided Onboarding Flow (ACE Blueprint → MCP Wizard → System Ready)

Goal: First-launch experience that configures the entire system from a guided conversation. No terminal, no JSON editing. For Beta 1-2 clients, done live on a call. By Beta 3-4, ACE agents onboard new users into ACE itself (ACE-Delivers-ACE). By product launch, fully in-app.

**Phase A — ACE Blueprint Intake:**
- [ ] Identity & context questions built into first-launch UI (role, goals, values, energy patterns)
- [ ] Answers seed `user.md`, `state.md`, `active.md` with real data
- [ ] Current mode detection (Authority/Capacity/Expansion)
- [ ] Outcomes and weekly targets populated from intake
- [ ] Voice profile baseline from intake responses

**Phase B — Integration Setup (MCP Wizard):**
- [ ] "What tools do you use?" — dynamic checklist (Gmail, Calendar, Stripe, CRM, etc.)
- [ ] Per-integration credential collection (API keys for simple ones, OAuth window for Google/Microsoft)
- [ ] Auto-generate `mcpServers` config in Claude CLI settings — user never touches JSON
- [ ] Connection verification with live feedback ("Can we reach your inbox? ✓")
- [ ] .mcp.json templates already exist in `ace-core/00-System/templates/`

**Phase C — System Ready:**
- [ ] First `/start` runs with real context — not a blank template
- [ ] Dashboard reflects their actual life from minute one
- [ ] Coaching already knows their edges and patterns

---

## Future — Client Infrastructure

| Feature | Notes |
|---------|-------|
| `/sync-core` | Push updates from actualize-ace/core to client repos |
| Client backup/restore | — |
| Permission gate | Core vs client-specific skills |
| Client health dashboard | Aggregate pulse across clients |

---

## Parked — Future Sprints

| Feature | Notes | Plan |
|---------|-------|------|
| Token economy Phase 3 — provider routing | OpenRouter/LiteLLM fallback when subscription limits hit | [token-economy-overhaul.md](../ace-desktop-token-economy-overhaul.md) |
| Token economy Phase 4 — Graphify | Knowledge graph context compression for vault reads | [token-economy-overhaul.md](../ace-desktop-token-economy-overhaul.md) |
| Token economy Phase 5 — direct SDK | Bypass CLI for pure conversation (~100x baseline savings) | [token-economy-overhaul.md](../ace-desktop-token-economy-overhaul.md) |
| Event bus | Decouple views from direct DOM manipulation. Lightweight pub/sub (~50 lines) so views communicate through events instead of querySelector('.nav-item').click(). Half-day. | — |
| State proxy wrapper | Wrap state.js in a Proxy to get mutation notifications for free. Enables reactive updates without a framework. Replaces silent mutations with observable state. Half-day. | — |
| Event delegation on views | Stop re-attaching click handlers on every render. One delegated listener per view container. Improves perf and eliminates listener leaks. A few hours per view. | — |
| Custom pages | User-created pages pinned to sidebar as first-class tabs. Markdown, data views, custom layouts. Requires UI scalability infra (CSS namespacing, DOMPurify, dynamic widget loading, iframe). | — |
| Skills store | Browse and install skills from a library. Skill registry format, versioning, install/uninstall, permissions model. Platform-level — Layer 2. | — |
| Embedded browser | Chromium pane for in-app reference docs | — |
| Two-layer architecture | Sovereign Base (offline) + ACE Live (subscription) | — |
| Build/Share polarity meter | Auto-derived ratio replacing manual mode toggle | — |
| Sovereign mode (Ollama) | Local model with context compression | — |
| Canvas view | ON HOLD | — |
| Multi-engine fallback | Codex plugin now, ace-engine adapter later | — |

---

## Parked — Client Analytics (activates when desktop ships to clients)

Context: Dashboard has graceful degradation built in. `metrics.js` shows revenue + pipeline if `ace.db` exists. `pipeline.js` renders deals from same DB. `db-reader.js` is read-only SQLite via IPC. Infrastructure works — gap is no client vault ships with a database or analytics MCP.

| Feature | Notes |
|---------|-------|
| ace.db scaffold | Create empty DB with standard schema during `/build-vault` or Build Session 1 |
| Client analytics MCP template | Generic ace-analytics server clients configure with their own sources (ThriveCart, Stripe, GHL, PayPal) |
| Add analytics MCP to core manifest | So `/sync-core` can push updates to analytics layer |
| Integration setup in Build Session | Wire client payment/CRM to their analytics MCP |
| Client-facing `/pipeline` and `/revenue` | Promote from personal-only to core (already use graceful degradation) |

Depends on: Desktop shipped to clients + onboarding flow includes integration wizard. Target: Beta 2-3 (Apr-Sep 2026).

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

## Beta Timeline

| Beta | Window | Key milestone |
|------|--------|---------------|
| 1 (done) | Feb-Mar 2026 | 8 clients, $19,976 |
| 2 | Apr-Jun 2026 | Two-track (VIP + Group), affiliates start |
| 3 | Jun-Sep 2026 | App subscription launches, ACE-Delivers-ACE begins |
| 4 | Sep-Nov 2026 | Agent-assisted onboarding |
| 5 | Dec 2026-Feb 2027 | Near-automated delivery |

Target: ~$292K across 5 betas. App subscription ARR layered on top starting Beta 3.

---

## How to Use This File

- **Start of session:** Read this to orient. Check "In Progress" for current sprint.
- **After shipping:** Move from "In Progress" → "Shipped". Pull from "Next" into "In Progress".
- **After planning:** Add new items to "Next" or "Parked" with a link to the plan doc.
- **Monthly reflection:** Review "Parked" — promote, drop, or keep.
