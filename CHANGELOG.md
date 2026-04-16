# ACE Desktop — Changelog

All notable changes to ACE Desktop are documented here.
Format: newest first. Tags link to GitHub Releases.

---

## v0.2.1 — 2026-04-16

### Added
- **Linux support (AppImage)** — `ACE-0.2.1-x86_64.AppImage` now built and published alongside Mac DMGs and Windows installer on every release. Run `chmod +x` then execute directly. Ubuntu 22.04+ users may need `sudo apt install libfuse2`.
- Binary detection now covers Linux install locations: `/usr/local/bin`, `/usr/bin`, `/snap/bin`, `~/.local/bin`, plus nvm/volta/fnm/asdf/mise version-manager paths.

### Changed
- Refactored platform branching across `pty-manager`, `preflight`, `chat-manager`, and `main` from two-way (`win32` vs. else-Mac) to three-way (`win32` | `darwin` | `linux`). No behavior change on Mac or Windows.

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
