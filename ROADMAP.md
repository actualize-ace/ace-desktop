# ACE Desktop — Roadmap

> Single source of truth for what's shipped, what's next, and what's parked.
> Updated: 2026-04-11 — Post-ship priorities promoted to Now. 49 features across 4 tiers.

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
| Linux AppImage (x64) | Done — v0.2.1 | Aleksander Brankov first user; FUSE2 caveat documented in release notes |

---

## In Progress — Phase 1: Mac Ship (Apr 12-13)

Target: first client build for Joe Hawley (macOS). Windows follows after Mac is stable.

| Feature | Status | Blocker | Plan |
|---------|--------|---------|------|
| Setup screen polish | Done | — | Pre-flight module (binary health + vault structure), titlebar status indicator, spawn guards in chat-manager + pty-manager, `/start` placeholder, vault validation gate in setup screen, version display. [Design](docs/plans/2026-04-10-setup-screen-polish-design.md) |
| Rich output panel | Done | — | Chat mode already renders full markdown (marked.js), syntax-highlighted code blocks (18 languages, copy buttons), tool cards (Edit diffs, Bash commands, Write previews), permission approval cards, and question blocks. Agent Terminal stays raw xterm.js by design. |
| Ops container + auto-scroll | Done | — | Tool calls collapse into `⚡ N operations` two-level accordion per burst. Auto-scroll on tool activity (120px) and finalize (300px), respects `autoScroll` setting. Commit `a878b3e`. [Design](docs/plans/2026-04-11-ops-container-autoscroll-design.md) |
| Session containment + timer | Done | — | 3-per-pane limit with toast, countdown timer (15/30/60/90m) with warning→critical→expiry nudge, light+dark mode. Ritual entry (Feature B) deferred to next sprint. Commit `b990bc2`. [Design](docs/plans/2026-04-09-containment-ritual-ux.md) |
| Process cleanup on exit | Done | — | `killAllChildren()` in main.js — covers `SIGINT`, `SIGTERM`, `process.on('exit')`, `uncaughtException`, `unhandledRejection`, and `before-quit`. Commit `9904225`. |
| Native module bundling (ARM64) | Done | — | Electron 28→34 (Node 18→20 LTS, Chrome 120→132). better-sqlite3 9.4.3→12.8.0, node-pty 1.0.0→1.1.0. Packaged app verified on Apple Silicon. Commit `a67daa7`. |
| Code signing / notarization | Deferred | Optional for Path B distribution | **Path A (later):** Apple Developer ID ($99/yr) → electron-builder afterSign hook → notarized DMG, clean install. **Path B (current):** Unsigned DMG shipped via GitHub Releases. Clients right-click → Open on first launch (Gatekeeper bypass). Good enough for Joe/Marc/early cohort. Upgrade when Apple Dev account is set up. |
| extraResources verification | Done | — | ace-analytics bundles into `Contents/Resources/ace-analytics/` correctly. Verified in packaged build. |
| MCP tool permission approval card | Done | — | When Claude denies an MCP tool call, an in-chat card appears with "Allow all `<server>` tools" / "Just this one" / "Dismiss". Accept writes `mcp__<server>__*` or exact tool pattern into `.claude/settings.local.json` (idempotent). Retry button re-sends the last user message via `sendChatMessage`. Branch `mcp-resilience`. |
| Slash command menu | Done | — | Inline `/` autocomplete in chat textarea. Upward menu, pinned-first, fuzzy filter, auto-send on select. Font-matched to Cmd+K. [Design](docs/plans/2026-04-11-slash-menu-design.md) · [Plan](docs/plans/2026-04-11-slash-menu.md) |
| Onboarding tutorial | Done | — | Learn tab with 8-lesson Essentials track (~12 min): Triad intro, Vault, Command Center, Chat, Session Rails, /start, /eod, Going Deeper. Spotlight overlay with pulsing gold ring + scroll-into-view + edge-detection on key lessons, prefill-composer action for /start + /eod + Going Deeper CTA, first-run auto-routing, skip + resume, welcome bloom on fresh install, persistent knowledge base. Content in `renderer/data/learn/*.md` with YAML frontmatter. [Design](docs/plans/2026-04-12-onboarding-tutorial-design.md) · [Plan](docs/plans/2026-04-12-onboarding-tutorial.md) |
| App renamed to ACE | Done | — | `build.productName` + window title: "ACE Desktop" → "ACE". Top-level productName + `app.setName('ACE')` were already "ACE" so userData path unchanged. DMG filename: `ACE-0.1.0-arm64.dmg`. Commit `fece39d`. |
| App icon regenerated | Done | — | `ace.icns` still contained the old gold-spade logo; regenerated from current `ace.png` (concave triangle + orb) at all 10 standard icns sizes via iconutil. Commit `c1a2fdd`. |
| Mac DMG distribution (unsigned) | Done | — | First packaged v0.1.0 build published to GitHub Releases on 2026-04-12 — tag `ace-desktop-v0.1.0`. Clients download, drag to Applications, right-click → Open on first launch (Gatekeeper bypass). Build command: `cd ace-desktop && npm run dist` → `dist/ACE-{version}-arm64.dmg`. |
| First client deploy test | Not started | Blocks ship | Joe Hawley macOS build verification — install from GitHub Releases link. |

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

## In Progress — Now (Apr 11+)

Promoted from post-ship — building with velocity.

| Feature | Status | Priority | Plan |
|---------|--------|----------|------|
| ~~Electron upgrade (28 → 34)~~ | Done | ~~High~~ | Shipped pre-client deploy. Electron 34.5.8, Node 20 LTS, Chrome 132. Commit `a67daa7`. |
| DCA frontmatter onboarding integration | Not started | High | Extend `/build-vault` + ace-core template so new clients get populated DCA frontmatter (`north_star_anchors`, `gate_date`, `journey_start`, `affirmations`) instead of empty-state cockpit. `compass_directions` deprecated — Cadence Ring replaced it. After cockpit-redesign merge. Requires fresh chat with ace-core + /build-vault read. |
| Token economy Phase 2 — context lifecycle | Not started | High | Auto-effort at 80%, brevity injection at 70%, cache countdown + refresh button. [token-economy-overhaul.md](../ace-desktop-token-economy-overhaul.md) |
| Auto-sync health system | Not started | High | Background sync keeps views (Artifacts, People, Dashboard) current with vault. Health check flags stale data, visible "last synced" indicator. Start with Artifacts, extend to other views. |
| App auto-update (electron-updater) | Not started | High | GitHub Releases as update server. Signed builds, auto-check on launch, download + install prompt. First build clients manually install is the last one they manually install. Requires code signing (macOS notarization, Windows Authenticode). |
| Vault sync from desktop (ace-core pull) | Not started | High | On launch: silent `git fetch upstream`, compare HEAD vs upstream. If behind → "ACE update available" badge in dashboard. One-click triggers /sync-core, shows diff summary of what changed. Requires Settings > GitHub config: client enters their repo URL + upstream (actualize-ace/core). Setup screen pre-flight checks git + SSH key. No new MCP — pure git over existing infra. |
| ~~Triad column redesign~~ | Done | ~~High~~ | Superseded by Cockpit Redesign — North Star + brain + compass + triad deck with risen-card + Inner Move + dock zone. [Design](docs/plans/2026-04-11-cockpit-redesign-design.md) · [Plan](docs/plans/2026-04-11-cockpit-redesign.md) |
| ~~Dynamic command registry~~ | Done | ~~High~~ | Shipped 2026-04-12. `command-registry.js` reads `.claude/skills/*/SKILL.md` from the active vault on startup and lazy-rescans on menu open (1.5s throttle, re-renders only when the skill set changes). Both Cmd+K and slash menu auto-discover user-authored skills — no rebuild, no reload. Static COMMANDS win on name collisions. |
| ~~Zoom bug — chat composer clipped~~ | Done | ~~High~~ | Fixed 2026-04-12: `.app-shell` used `zoom: var(--ui-zoom)` + `height:100vh`, causing rendered height to exceed viewport at zoom>1. Compensated with `height/width: calc(100vh / var(--ui-zoom))` in [shell.css:2-7](renderer/styles/shell.css#L2-L7). |
| ~~Operations container + auto-scroll~~ | Done | ~~High~~ | Shipped to Phase 1. Commit `a878b3e`. [Design](docs/plans/2026-04-11-ops-container-autoscroll-design.md) |
| ~~Slash command menu in chat input~~ | Done | ~~High~~ | Shipped to Phase 1. [Design](docs/plans/2026-04-11-slash-menu-design.md) |
| Windows close button / window chrome | Not started | High | v0.2.1 on Windows ships without visible close controls (top menu file/edit bar dropped). Craig had to force-kill the app. Add cross-platform titlebar close/minimize, or re-enable the native menu on win32. Surfaced in Craig Session 3 2026-04-17 [[1:05:08]](https://fathom.video/calls/639987960?timestamp=3908). |
| Token context meter stuck at 100% | Not started | High | Bottom bar shows ~100% on fresh chats in v0.2.1. Meter calc needs validation against actual Claude CLI token usage. Surfaced in Craig Session 3 2026-04-17 [[1:02:45]](https://fathom.video/calls/639987960?timestamp=3765). |
| DCA surfacing on Windows without DevTools | Not started | High | First-launch cockpit does not render North Star anchors on Windows vault path. Fix required live DevTools + PowerShell intervention on Craig's box. Same class as `compass_ui_vault_bleed` (widget bound to wrong vault path). Surfaced in Craig Session 3 2026-04-17 [[1:28:52]](https://fathom.video/calls/639987960?timestamp=5332). |
| Ritual nudges — /pulse + /weekly-review + /monthly-review | Not started | High | Automate ritual reminders via cron-like scheduler or top-bar nudge. Craig had never run a weekly review; command center now surfaces it visually but needs a time-of-week nudge. Surfaced in Craig Session 3 2026-04-17 [[1:02:03]](https://fathom.video/calls/639987960?timestamp=3723). |
| Google Workspace MCP auth loop (Windows) | Not started | High | OAuth refresh keeps expiring on Windows clients; Craig has re-authorized twice and given up. Blocks Gmail + Calendar integration for ritual nudges + weekly review. Surfaced in Craig Session 3 2026-04-17 [[59:47]](https://fathom.video/calls/639987960?timestamp=3587). |
| Superpowers skill install on Windows | Not started | Medium | Colon in superpowers skill naming convention breaks Windows paths — can't `/sync-core` it, must manually reinstall from GitHub repo. Either patch the skill name mapping on Windows or special-case the installer. Surfaced in Craig Session 3 2026-04-17 [[26:45]](https://fathom.video/calls/639987960?timestamp=1605). |
| Self-healing renderer refresh | Not started | Medium | Periodic `webContents.reload()` to prevent memory leaks and sluggishness from long-running sessions. **Already have:** activity detector in `atmosphere.js` (idle thresholds at 8m/30m, tracks `lastActivity`), config persistence via `patchConfig()`, localStorage for UI prefs, `killAllChildren()` on exit. **Need to add:** (1) `bootedAt` timestamp in `state.js`, (2) refresh-window config (e.g. idle > 30min + uptime > 12h, or 2am–6am quiet hours), (3) state audit — verify all critical state survives reload (chat sessions need graceful teardown, PTY connections need cleanup before refresh, atmosphere counters already persist), (4) IPC channel `RENDERER_REFRESH` from main process calling `webContents.reload()`, (5) post-reload hydration path (config + localStorage already cover this). **Side benefit:** forces formal persist-or-lose discipline on all renderer state — makes app resilient to crashes, not just planned refreshes. Half-day implementation given existing infra. |
| Dashboard customization | Not started | Medium | Users pick, rearrange, resize, and hide dashboard widgets. Persist layout per user. Builds on existing modular widget architecture. |
| ~~Somatic warmth — token glow fix~~ | Done | ~~Medium~~ | Shipped 2026-04-12: killed full-pane amber/red radial wash on `.term-pane::before`. Pressure now carried by ctx-bar (gold breath → red breath → red pulse) and header dot (color-matched halo + circular radial ring via scaled `::after`). Reading surface stays clean. Files: [terminal.css](renderer/styles/views/terminal.css), [chat.css](renderer/styles/chat.css). Backlog: session-state-driven header dot (active/idle/stale/error). |
| ~~Dark mode font legibility~~ | Done | ~~Medium~~ | Fixed 2026-04-12: `--text-dim #606080→#8c8ca8` (WCAG AA 3.0→5.0), `--gold-dim #7a60b0→#a080c8` (3.5→5.9) in [tokens.css](renderer/styles/tokens.css). Zoom range bumped 75–150% → 50–200% in [theme.js:40](renderer/modules/theme.js#L40). |
| ~~Chat text too white~~ | Done | ~~Medium~~ | 2026-04-12: Investigation showed chat already uses `--text-primary: #d8d4e4` (soft lavender-white), not `#fff`. Verified live — no change needed. |
| Living orb | Not started | Medium | Animated orb reacting to PTY activity / session state |
| Scratchpad | Not started | Medium | Persistent markdown notepad sidebar |
| Memory surfacing in chat | Not started | Medium | Render an ambient card in the chat stream whenever auto-memory writes to `memory/*.md`. Card shows type badge (user/feedback/project/reference) + the memory's one-line hook + faint gold glow fade. Hook into chat-renderer via Write tool event filter (path matches `memory/*.md`). Makes the compounding-intelligence claim visible instead of invisible. Enables honest depiction in the landing page animation. Half-day. |
| ~~Notification system redesign~~ | Done | ~~Medium~~ | Shipped 2026-04-12: red → terracotta gold (`#d4a574`) matching token bar breath + HRV glow. Badge click opens dropdown when 2+ sessions flag (label + reason + pane + relative time); direct-jumps when 1. Tab dot pulses gold 3s on arrival, no header pulse. Menu escapes titlebar drag region. Light mode styling included. Commits `0500c8f…9b6882c` + color compare via [gold-comparison prototype](/tmp/gold-comparison.html). [Design](docs/plans/2026-04-12-notification-redesign.md) |
| ~~Terminal session naming~~ | Done | ~~Medium~~ | Shipped 2026-04-12: `deriveSessionName()` auto-names session from first user prompt (trim + 28-char ellipsis). Tab updates on first send; header stays static "ACE SESSION" (tab = identity, header = category). Includes responsive tab bar fix — tabs flex-shrink w/ 50px floor, horizontal scroll fallback, fixed dot + close survive squeeze. Files: [session-manager.js](renderer/modules/session-manager.js), [terminal.css](renderer/styles/views/terminal.css). |
| ~~File attachment in chat (PDF, docs, images)~~ | Done | ~~Medium~~ | Shipped 2026-04-15: paperclip button + drag-drop + clipboard paste → vault staging at `00-System/chat-attachments/YYYY-MM-DD/`, chip tray composer, `@relPath` prompt injection. IPC: `attachment-pick` + `attachment-save`. Main: `attachment-manager.js`. Renderer: `attachment-handler.js`. Both chat sessions + agent terminals wired. Merged to main. [Plan](docs/plans/2026-04-15-chat-attachments-plan.md) |
| ~~Image paste in chat (screenshots)~~ | Done | ~~Medium~~ | Shipped as part of chat attachments 2026-04-15 — clipboard paste handler (`wirePasteHandler`) supports images via FileReader buffer fallback. |
| Client feedback integration | Not started | Medium | Incorporate Joe + Marc usage patterns |
| HeartMath calibration | Not started | Low | Side-by-side session (ACE vs HeartMath app) to fix coherence thresholds |

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
| Auto-close on window exit | Wire Electron `window.on('close')` / `app.on('before-quit')` to run lightweight session extraction (what shipped, corrections, decisions) and persist to memory files before the chat dies. Solves the "forgot /close" memory leak without relying on Claude Code hooks (which clients don't have). |

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
| Test framework | No tests exist in ace-desktop. Plans currently use manual visual verification (`npm start` + DevTools). Adding vitest + playwright would enable real TDD for parsers (unit) and widgets (integration). Data-layer tests first (vault-reader, vault-writer, synthesizer — pure functions, high ROI). UI smoke tests second. Defer until post-ship — manual verification has been sufficient through Beta 1. | — |

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
| [2026-04-11-slash-menu-design.md](docs/plans/2026-04-11-slash-menu-design.md) | Shipped |
| [2026-04-11-slash-menu.md](docs/plans/2026-04-11-slash-menu.md) | Shipped |
| [2026-04-11-ops-container-autoscroll-design.md](docs/plans/2026-04-11-ops-container-autoscroll-design.md) | Shipped |
| [2026-04-11-ops-container-autoscroll.md](docs/plans/2026-04-11-ops-container-autoscroll.md) | Shipped |
| [2026-04-11-triad-column-redesign.md](docs/plans/2026-04-11-triad-column-redesign.md) | Ready to build |
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

## Release Workflow

Current approach until `electron-updater` ships: GitHub Releases + manual install.

**To cut a new release:**

```bash
cd ~/Documents/Actualize/ace-desktop

# 1. Verify your changes work in dev
npm start

# 2. Bump version in package.json (semver: major.minor.patch)
#    Fix → patch (0.1.0 → 0.1.1)
#    Feature → minor (0.1.0 → 0.2.0)
#    Breaking → major (0.1.0 → 1.0.0)

# 3. Commit + push
git add package.json && git commit -m "chore: bump version to X.Y.Z" && git push

# 4. Build
npm run dist
# Output: dist/ACE-X.Y.Z-arm64.dmg

# 5. Publish to GitHub Releases
#    https://github.com/mythopoetix/nikhil/releases/new
#    Tag: ace-desktop-vX.Y.Z · Target: main · Attach DMG
```

**Install instructions for clients** (include in release notes):
1. Download the `.dmg` → drag to Applications
2. **Right-click** the app in Applications → **Open** (first launch only, Gatekeeper bypass)
3. Confirm the security prompt

**Future:** once `electron-updater` is wired (see Phase 2 "App auto-update"), clients never download manually again — the app auto-pulls from GitHub Releases.

## How to Use This File

- **Start of session:** Read this to orient. Check "In Progress" for current sprint.
- **After shipping:** Move from "In Progress" → "Shipped". Pull from "Next" into "In Progress".
- **After planning:** Add new items to "Next" or "Parked" with a link to the plan doc.
- **Monthly reflection:** Review "Parked" — promote, drop, or keep.
