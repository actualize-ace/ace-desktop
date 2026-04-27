# ACE Desktop — Changelog

All notable changes to ACE Desktop are documented here.
Format: newest first. Tags link to GitHub Releases.

---

## Unreleased

---

## v0.3.0 — 2026-04-27

### Fixed
- **Windows prompt truncation (definitive fix)** — Claude CLI prompts sent through `.cmd` wrappers (npm install) were split at whitespace by cmd.exe, so only the first word reached Claude. Root cause: Node.js overrides `windowsVerbatimArguments` to `true` when `shell:true`, ignoring the v0.2.9 fix entirely. Now manually wraps the prompt in cmd.exe-safe double quotes before args are joined. Affects `chat-manager.js` and `synthesizer.js`. Users with `claude.exe` (standalone install) and all Mac/Linux users were never affected.

### Changed
- **Chat history restored on resume** — reopening a session now rehydrates prior messages from the Claude CLI session log instead of showing a blank pane.

---

## v0.2.9 — 2026-04-26

### Fixed
- **Energy pill overflow** — removed the energy tag from the cockpit synthesis card; the tag was rendering raw state text and overflowing its container on Windows.
- **Windows CLI quoting (attempted)** — set `windowsVerbatimArguments: false` to fix prompt truncation on `.cmd` binaries. Did not resolve the issue — Node.js overrides this setting when `shell:true`. Superseded by v0.3.0.

---

## v0.2.8 — 2026-04-26

### Fixed
- **Output flush race condition** — the close handler only flushed buffered stream events if a flush timer was pending. Events arriving after the last timer-based flush but before process exit were silently dropped. Now flushes whenever the event queue is non-empty, regardless of timer state.

---

## v0.2.7 — 2026-04-26

Stability + cockpit polish release. Renderer lifecycle hardened, auto-reload made non-destructive, and several silent failure modes surfaced.

### Added
- **Live vitality card** — header card now reflects real-time signal state instead of static mode pills.
- **Warn-before-reload toast** — 30-second countdown with Postpone button before the auto-reload fires; idle window bumped 6h → 12h while Windows still lacks `claude --resume` history recovery.
- **Risen-why overlay item-type label** — top candidate is now labeled by category (follow-up, outcome, signal, build block, pattern, ritual); context row hidden when empty.
- **Disposable lifecycle store** — central `DisposableStore` adopted across `chat-manager`, `pty-manager`, and `lifecycle.js`; listeners and timers released cleanly on session close.
- **Spawn timeout for chat-manager** — Claude CLI spawns fail fast instead of hanging if the binary doesn't come up.
- **Memory telemetry** — renderer memory snapshots stream to console and `~/Library/Logs/ACE/memory.ndjson` for diagnosis of long-session growth.

### Fixed
- **`.claude/` approval auto-continue** — chat auto-continues after the renderer applies a `.claude/` write the CLI hard-denies, so the turn no longer dead-ends.
- **Longtask false positives** — main-thread stalls reported only when the window is visible; suppresses the ~900ms phantom warnings Chromium emits on hidden windows.
- **Cockpit follow-up filter** — text-valued `due` fields like "Session 2" no longer crash the candidate parser.
- **Memory telemetry shutdown** — interval cleared on `before-quit`; first log-write I/O error now surfaces instead of failing silently.
- **Close-handler identity check** — proc/shell handlers verify identity before terminating, preventing wrong-process kills on close.

---

## v0.2.6 — 2026-04-23

Branch hygiene release. No user-facing changes.

Rebased 12 commingled landing-page commits off `main`; prior state preserved as `backup/pre-cleanup-v0.2.5` tag on origin. First clean-trunk release — `main` now contains only `ace-desktop/` work.

---

## v0.2.5 — 2026-04-22

### Added
- **Astro birth details form** — natal chart data entry in the Cockpit; lays groundwork for transit-aware context.
- **Reduced Effects mode** — tri-state setting (Auto / On / Off) in Display settings. Auto inherits your OS preference; On strips all decorative filters and animations; Off forces them regardless of OS setting.
- **Long chat virtualization** — messages beyond 50 are evicted from the DOM and snapshot-hydrated on scroll. Prevents renderer slowdown in extended sessions with no change to visible behavior.
- **CLI binary prewarm** — Claude CLI is pre-warmed 5 seconds after session open (activity-based), reducing first-response latency on slower machines.
- **Suppress MCP toggle** — emergency bypass in settings for MCP connection failures; lets you keep working without restarting the app.
- **Longtask observer** — diagnostic module that logs main-thread stalls ≥200ms to `~/Library/Logs/ACE/longtask.log`. Diagnostic only, no user-facing behavior change.

### Changed
- **Nav rename** — "Build" → "Create", "Studio" → "Agents".
- **Cockpit font** — Cormorant Garamond replaced with Instrument Serif across Cockpit, Home, Learn, Welcome, North Star, and Synthesis surfaces.
- **Cockpit layout** — full-width canvas; removed the 1320px max-width constraint.
- **ace-analytics** — dashboard surface removed from the app; tooling remains operator-side only.
- **MCP status dot removed** — visual MCP connection dot removed from the chat stream; silent perf telemetry kept.

### Fixed
- **Stop button** — send button now visibly flips to red ■ when a stream activates, not only on deactivate. Fixes the stop button being invisible on restored or re-hydrated sessions.
- **Security: tools/ bundling** — `tools/` directory no longer packed into the DMG. Previously shipped operator-side scripts (analytics agent, outreach agent) to client machines.

---

## v0.2.2 — 2026-04-19

### Added
- **MCP tool permission approval cards** — inline approval UI when Claude requests a new MCP tool, with retry flow on denial and browser-based auth recovery.
- **Self-healing refresh engine** — detects renderer death and stream freezes, auto-recovers without losing chat state.
- **Interactive context bar** — click to reset the conversation in-place; tooltip shows turns remaining; accurate per-turn delta tracking (fixed `result.usage` cumulative-read bug).
- **Vitals dot unification** — merged status-pulse into a single semantic indicator with hover response showing health state.
- **One-click capture** — lightning icon in the titlebar drops an instant inbox entry with confirmation toast.
- **Collapsible agents roster sidebar** — reclaim real estate when not in use; smart contextual chat names in headers.
- **Drag-to-resize sidebar** — manual width control with visible affordance.
- **Default model → Sonnet** for new chat sessions.
- **Renderer stress harness** — internal tooling for chat + pty scaling tests.

### Changed
- **Nav rename** — "Terminal" → "Build", "Agents" → "Studio".
- **Telemetry sidebar cleanup** — removed token/cost/daily/weekly clutter; kept signal-carrying metrics only.
- **Titlebar polish** — logical right-side grouping, consistent button sizing, capitalized Orchestrator + Agent role names in Studio.
- **Chat engine internals rebuilt** — `session-manager.js` split into dedicated modules (`chat-pane`, `mcp-cards`, `tool-renderer`; telemetry now owns context-window limits). ~45% code reduction in the core chat file, eliminates DOM duplication across single + multi-pane flows, sets up stable multi-session scaling. No change to chat behavior for existing sessions.

### Fixed
- **Windows CRLF frontmatter parsing** (Windows-only) — DCA frontmatter, skill discovery, and memory cards failed silently on Windows due to Git's LF → CRLF conversion on checkout. All `vault-reader.js` reads now normalize CRLF → LF via a `readText()` helper, and the `vault:readFile` IPC handler applies the same normalization before returning content to the renderer. Affects North Star bar, `/` autocomplete, memory cards, weekly targets, active outcomes, state widgets, and people metadata. Surfaced on Craig Young onboarding call 2026-04-17.
- **Concurrent Opus renderer freeze** — IPC stream events now batch under load; chat stream buffer is capped to prevent DOM overload with multiple streaming sessions.
- **Chat pane detached crash** — factory uses `pane.querySelector` instead of `document.getElementById`, so panes no longer crash when dragged to a secondary window.
- **Electron `confirm()` suppression** — replaced native `confirm()` with an inline reset banner (Electron silently blocks native dialogs under contextIsolation).
- **Reset context preserves history** — clears thread + token tracking only, keeps chat DOM visible.
- **MCP server startup reliability** — strip `MCP_CONNECTION_NONBLOCKING` and `ELECTRON_RUN_AS_NODE` from child spawns so slow-starting MCP servers register their tools without dropping init.
- **Cockpit triad deck** — correct amber yellow for caution-level signal dots.
- **Sidebar toggle stability** — stops wiping the toggle's span structure on collapse; expand chevron stays visible when sidebar is collapsed.
- **Sidebar context % resync** — context percentage in sidebar now updates immediately when the model dropdown changes.
- **Expanded tool/status vocabulary** — `TOOL_WORDS` and `STATUS_WORDS` dictionaries broadened for better stream-event classification.
- **Capture UX polish** — centered toast matching the capture box; visible expand chevron; status word fallthrough.

---

## v0.2.1 — 2026-04-16

### Added
- **Linux support (AppImage)** — `ACE-0.2.1-x86_64.AppImage` now built and published alongside Mac DMGs and Windows installer on every release. Run `chmod +x` then execute directly. Ubuntu 22.04+ users may need `sudo apt install libfuse2`.
- Binary detection now covers Linux install locations: `/usr/local/bin`, `/usr/bin`, `/snap/bin`, `~/.local/bin`, plus nvm/volta/fnm/asdf/mise version-manager paths.

### Changed
- Refactored platform branching across `pty-manager`, `preflight`, `chat-manager`, and `main` from two-way (`win32` vs. else-Mac) to three-way (`win32` | `darwin` | `linux`). No behavior change on Mac or Windows.
- Linux window icon now loads the correct format.

---

## v0.2.0 — 2026-04-15

### Added
- **File attachments in chat** — paperclip button, drag-and-drop, and clipboard paste (including screenshots) in both chat sessions and agent terminals. Files stage to `00-System/chat-attachments/YYYY-MM-DD/` in the active vault and inject as `@relPath` references into the prompt. Chip tray shows attached files before sending; individual chips are removable. Supported: PDF, images, docs, and any other file type Claude CLI accepts.
- **TOS acceptance gate** — terms of service screen on first launch; explicit acceptance required before the app loads.
- **Manual binary picker** — if Claude CLI is not auto-detected, a file picker lets you point directly to the binary rather than re-detecting.

### Fixed
- Binary detection broadened to cover additional install locations.
- Graceful shutdown improved — child processes cleaned up more reliably on quit.
- Slash-menu positioning fix for edge-case composer layouts.
- Copyright and TOS updated to reflect Nikhil Kale d/b/a Actualize legal name.

---

## v0.1.10 — 2026-04-13

### Added
- **Live file-watching** — vault changes (daily notes, patterns, follow-ups, memory files) reflect in the dashboard without manual refresh. File watcher covers all vault subdirectories.
- **Memory card styles** — auto-memory writes surface as ambient cards in the chat stream with type badge (user/feedback/project/reference) and faint gold glow.

---

## v0.1.9 — 2026-04-14

### Added
- **Cadence Ring** — new cockpit widget replacing the standalone ritual-streak tracker. Iris-style rotation showing review freshness across all cadenced items (rituals, patterns, reflections), with 365-day real streak counting, overdue pulse animation, gold glow states, streak tooltips, and since-date display. Includes `parseCadence` vault-reader with written-date parsing, birthtime fallback, and 800-byte stub filtering. Wired into dashboard via dedicated IPC channel.

### Fixed
- **Velocity bar zeroes out after ~7pm:** widget used UTC dates (`toISOString()`) to look up daily counts, but execution log entries use local calendar dates — mismatch caused today's bar to read 0 after UTC midnight rollover. Both widget and vault-reader now use local date keys
- **Claude CLI ENOENT on spawn:** augmented PATH in chat spawn and preflight now covers nvm, volta, fnm, mise, asdf, and `~/.local/bin` — previously only Homebrew + system paths, causing ENOENT for clients with non-Homebrew node installs
- **Re-detect button useless on bad path:** `recheckBinary` re-ran preflight against the same wrong path; it now calls `detectClaudeBinary()` first, updates config + global, then validates the fresh path
- **Windows double titlebar:** `titleBarStyle: 'hiddenInset'` is macOS-only — Windows now uses `'hidden'` to avoid system chrome stacking over the custom titlebar
- **Windows icon:** app was loading `ace.icns` on all platforms; Windows now loads `ace.ico`
- **Windows NDJSON CRLF:** NDJSON parser split on `\n` only — trailing `\r` on Windows caused silent JSON.parse failures in the chat stream. Now splits on `/\r?\n/`
- **Hindsight bank leak:** Oracle injected a hardcoded `bank_id="ace-nikhil"` Hindsight recall instruction for all users. Now gated on `config.hindsightBank` — clients without Hindsight get clean prompts; operator sets the key in their config

---

## v0.1.8 — 2026-04-14

### Added
- Natal chart and interpretations load from `{vault}/data/` via IPC instead of from the app bundle
- Mirrors existing ASTRO_TRANSITS pattern — packaged DMGs remain clean (no personal data bundled)
- Users with `data/natal-chart.json` + `data/interpretations.json` in their vault get full astro; others see empty state

---

## v0.1.7 — 2026-04-14

### Fixed
- **Windows chat hang:** spawn/execFile on `.cmd` binaries now uses `shell: true` to route through cmd.exe — stdio pipes were never connecting, causing silent hang on Windows (Kim's machine)
- **Compass bleed:** `defaultCompassDirections()` returned hardcoded vocabulary from the developer's vault — clients without DCA frontmatter saw this as their compass data. Now returns `{}` so the compass widget renders blank state instead

---

## v0.1.6 — 2026-04-13

### Fixed
- **Personal data leak:** every DMG through v0.1.5 bundled Nikhil's pre-computed natal chart and 82 lines of personal natal readings. Clients opening the Astro tab saw Nikhil's chart, not their own
- electron-builder `files` config now excludes `natal-chart.json` + `interpretations.json` from the bundle
- Astro view loaders return `null` on fetch failure instead of throwing — renders "Birth chart not configured" empty state
- Home greeting drops hardcoded name; proper `user.md` wire-up coming in a future release

---

## v0.1.5 — 2026-04-13

### Fixed
- **Stale CLAUDE_BIN:** Settings > Re-detect wrote the new path to config.json but never updated the in-memory `global.CLAUDE_BIN` — chat/pty kept using the stale path (Eliana's Mac)
- `PATCH_CONFIG` now syncs globals when `claudeBinaryPath` / `vaultPath` change
- `resolveClaudeBin()` / `resolveVaultPath()` self-heal from config if globals are undefined
- `detectClaudeBinary()` + `preflight.checkBinary()` use augmented PATH (same pattern as v0.1.4 node-spawn fix) so Homebrew installs work in packaged builds
- `diagnoseBinary()` classifies failures (unconfigured / path-missing / not-executable) — error card shows the actual reason instead of a generic fallback
- `proc.on('error')` handler surfaces spawn failures (ENOENT etc.) that previously vanished silently

---

## v0.1.4 — 2026-04-13

### Fixed
- **Node not found on client Macs:** packaged Electron apps inherit a minimal system PATH excluding Homebrew and npm binary dirs. Claude CLI is a Node.js script — spawning it without `/usr/local/bin` or `/opt/homebrew/bin` in PATH caused `env: node: No such file or directory` and pty launch failures
- Prepend known macOS node locations to PATH in both `chat-manager` and `pty-manager` spawn calls

---

## v0.1.3 — 2026-04-13

First public release on [actualize-ace/ace-desktop](https://github.com/actualize-ace/ace-desktop).

### Added
- **Intel Mac (x64) build** alongside Apple Silicon (arm64) — CI matrixes both architectures
- **Windows installer** (NSIS) with `ace.ico` multi-resolution icon
- Windows binary detection: `where.exe` instead of `which`, known paths for `%LOCALAPPDATA%` and `%APPDATA%\npm`
- Windows process kill via `taskkill` (SIGTERM doesn't work on Windows)
- Cross-platform launcher unsets `ELECTRON_RUN_AS_NODE`

### Changed
- Native modules (node-pty, better-sqlite3) rebuilt per-architecture before packaging

---

## v0.1.2 — 2026-04-13

### Fixed
- **Setup preflight:** Node.js and Git now correctly detected in packaged builds. macOS apps launched from Finder/Dock inherit a minimal PATH (no Homebrew `/opt/homebrew/bin`) — earlier release showed "Not found" even when both were installed via Homebrew. Falls back to known install paths when `which` fails
- **Sidebar (collapsed):** Learn nav icon centers cleanly — gold attention dot no longer pushes it off-axis. Status pulse + version badge hide when collapsed

---

## v0.1.1 — 2026-04-13

### Added
- **Setup screen redesign:** ACE purple palette, drifting nebula backdrop, starfield
- Preflight checks Node.js (>=20) and Git alongside Claude CLI + Vault
- Click-to-open info popovers on each check with real install links (nodejs.org, git-scm.com, Homebrew, Claude docs)
- **Alpha identity:** `ALPHA` pill in titlebar with shared popover — version, known limitations, changelog, report-a-bug links

### Fixed
- Vault Change + Claude Binary Re-detect buttons (return shape bugs)
- Removed misleading Anthropic API key step — synthesis uses Claude CLI + Max, not the SDK

### Changed
- Settings panel reorganized by usage frequency
- Default View dropdown includes all main views
- Dropped dead Daily Spend Warning input

---

## v0.1.0 — 2026-04-12

First packaged build. macOS Apple Silicon only. Unsigned — right-click > Open on first launch (Gatekeeper bypass).

### Added
- **Interactive onboarding tutorial** — 8 Essentials lessons (~12 min), auto-routes on first launch
- **Learn view** — persistent knowledge base in sidebar
- Welcome bloom animation on fresh install
- Spotlight overlay with scroll-to-target + pulsing gold ring on key lessons
- Prefill-composer action for `/start` + `/eod` lessons
- App renamed from "ACE Desktop" to "ACE"
- Regenerated `ace.icns` to match current brand mark (concave triangle + orb)

### Platform (pre-release, 271 commits)
- Electron 34 app architecture (main/renderer/preload, IPC bridge)
- Dashboard with modular widgets (state, outcomes, pipeline, velocity, follow-ups, metrics)
- Claude CLI chat integration (stream-json, --resume multi-turn, model/effort/permissions)
- Agent Terminal (node-pty, xterm.js, split pane)
- Vault editor + file browser (markdown editing, frontmatter support)
- Knowledge graph (D3.js force-directed vault visualization)
- Setup screen (vault picker, binary detection, config persistence)
- Context bar (per-session input/output/cache token tracking, threshold warnings)
- Cockpit view (North Star, compass, triad deck, Inner Move coaching card)
- Coherence HRV UI (HeartMath BLE integration, HRV panel, somatic bar)
- Breath protocols (sighing, box, 4-7-8, coherence, custom)
- Insight view (Deepgram STT/TTS voice coaching, presets)
- Artifacts view (status tracking, file association)
- People + network view (follow-ups, relationship graph)
- History view (session browser, project grouping)
- Astro blueprint (natal chart rendering)
- Oracle view (divinatory interface)
- Atmosphere (activity tracking, time-of-day theming, solfeggio/binaural audio)
- Cost guardrails (session cost warning, daily spend tracking)
- Sidebar commands (customizable, drag-reorder, color-coded)
- Lean mode toggle (--strict-mcp-config for MCP overhead reduction)
- External links open in browser (not inside Electron)
- Dynamic command registry (reads `.claude/skills/*/SKILL.md` from vault, auto-discovers new skills)
- Slash command menu (inline `/` autocomplete, pinned-first, fuzzy filter)
- Cmd+K command palette
- Session containment (3-per-pane limit, countdown timer with warning/critical/expiry nudge)
- Operations container (tool calls collapse into accordion, auto-scroll on activity)
- Notification system (gold pulse, attention dropdown, tab dot animation)
- Terminal session auto-naming from first prompt
- Token pressure glow (ctx-bar breath + header dot, no full-pane wash)
- Dark mode font legibility (WCAG AA compliance)
- Zoom range 50-200% with composer compensation
- Process cleanup on exit (covers SIGINT, SIGTERM, uncaughtException, before-quit)
- Light + dark theme support throughout
