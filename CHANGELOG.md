# ACE Desktop — Changelog

All notable changes to ACE Desktop are documented here.
Format: newest first. Tags link to GitHub Releases.

---

## Unreleased

---

## [v0.3.3](https://github.com/actualize-ace/ace-desktop/releases/tag/ace-desktop-v0.3.3) — 2026-05-04 — Astro Natal Pipeline

### Fixed
- **No window controls on Windows/Linux** — `titleBarStyle: 'hidden'` removed the native chrome but no replacement min/max/close buttons existed in the custom titlebar, so Win/Linux users had to use Alt+F4 or kill from the taskbar. Added `titleBarOverlay` (native min/max/close buttons painted on the top-right of our titlebar, ~138px wide) for non-macOS platforms. macOS keeps `hiddenInset` traffic lights on the top-left as before. Custom titlebar gains `padding-right: 150px` on Win/Linux so the ALPHA pill and intensity meter don't slide under the overlay.
- **Artifacts "Open in Browser" opened Finder, not the browser** — for directory and HTML artifacts, the open-file button used `shell.openPath` which surfaces the folder in Finder (or routes `.html` to a text editor on some setups). Now routes HTML files and directories through `shell.openExternal('file://…')` so the OS default browser picks them up; directories resolve to `index.html`. PDFs and other file types still use `openPath` so Preview/etc. open them.
- **Moon-phase mislabel** — phase classifier in transit-writer was using boundaries AT 0/45/90/…/315° instead of CENTERED on the cardinal angles (±22.5°), so the three days *after* full moon were labeled "full moon." Now uses 22.5° / 67.5° / 112.5° / 157.5° / 202.5° / 247.5° / 292.5° / 337.5° boundaries.
- **Sagittarius-Moon mislabel on cockpit** — new transit subline read `☽ Sagittarius` with no temporal context and was being read as a natal claim instead of a transit summary. Now reads `Today: ☽ Sagittarius` so it disambiguates from your natal Moon.
- **Markdown sanitizer fail-open** — `mdToHtml()` in `views/astro.js` had a silent fallback to raw `marked.parse()` when DOMPurify wasn't loaded. Now fails closed to escaped plaintext so model output cannot reach `innerHTML` unsanitized in any state.
- **YAML injection in transit + birth-data frontmatter** — renderer-supplied strings (`name`, `city_query`, `city_resolved`) and pipeline values were interpolated into `"…"` YAML keys without escaping. A stray `"` or newline would have corrupted the file and broken the parser on next read. Added a `yamlString()` helper used at both write sites.

### Performance
- **Ask-thread bounded** — the F7 "Ask your chart" thread now retains only the most recent 20 turns (was unbounded). Each submit re-rendered the full thread via `innerHTML`, which had begun causing 200–900ms main-thread overruns in long sessions.
- **History list bounded** — the History view now renders at most 100 most-recent sessions and replaces "Load more" with a hint to use search. Each Load-more rebuilt the entire list and rebound per-item listeners; DOM grew unbounded toward 3K+ nodes.

### Added
- **Astro natal pipeline (headline feature)** — anyone can now sit at the Astro view, enter their birth data, confirm an accuracy gate, and within ~3–5 minutes receive their own natal wheel + a foundational mythic personal legend written in the ACE voice. Daily transits read in the language of that legend, refreshed lazily. **Closes the gap surfaced by Joel on 2026-05-02** (he opened the Astro view, found nothing actionable, bounced).
  - **Pure-local computation.** Birth time + coordinates never leave the vault. No third-party astro APIs, no recurring service costs, no AGPL dependencies. Astronomy Engine (MIT, ~250KB) + custom JS for houses/aspects/nodes/Chiron, empirically validated within **8.33 arcseconds of Kerykeion** across all 10 planets on Nikhil's chart. All signs match. All retrograde flags match.
  - **Vault file structure:** `00-System/core/astro/{birth-data.md, natal-chart.json, personal-legend.md, transits/YYYY-MM-DD.md}`. Persists across app updates, refreshes, reinstalls.
  - **Voice fidelity.** Reads operator's calibrated `tools/astro/voice-brief.md` (with bundled sanitized fallback for clients).
  - **Birth-details form** with debounced GeoNames city autocomplete (~25K cities ≥5,000 pop, bundled SQLite), "I don't know my birth time" toggle revealing solar/noon-estimate radios, draft persistence in localStorage.
  - **Accuracy gate** — sub-100ms preview shows resolved birth + Sun/Moon/Rising before any tokens are spent. Special handling for solar-only and high-latitude (>66°) Whole Sign fallback.
  - **Generation UX** — ACE-gradient shimmering progress bar, cycling status labels ("Mapping your sky…" → "Reaching the writer…" → "Writing your legend…"), live elapsed counter + token count once Claude streams. Cancel SIGTERMs Claude; deterministic chart preserved on crash, recovery banner on next mount.
  - **Triad-banded legend layout** — 7 movements rendered as collapsible cards: Incarnation Signature opener, Authority/Capacity/Expansion Triad bands (color-coded to wheel triad tokens), Wound (Chiron), Nodal Axis, Master Quest closing with gradient title + gold edge.
  - **Wheel ↔ card linking** — click any planet on the natal wheel → smooth-scrolls + auto-expands the matching card with a brief gold highlight pulse. Hover → floating tooltip with Superpower Name + first sentence of card.
  - **"Ask your chart" bottom dock** — sticky 56px bar across the bottom of the Astro view, expands to 1/3 or 1/2 viewport. Single-shot Sonnet calls scoped to the user's chart + legend; speaks back in the legend's voice using the Superpower Names.
  - **Daily transits** — lazy generation on first Astro view open per day, prose written in the language of the user's legend, ~1–2 sentences per significant aspect. Filtered to tight (≤2°) + angular + slow-outer aspects.
- **Test framework** — Vitest 3 scoped to `src/astro/**`, 95 tests covering ephemeris (10 planets vs Kerykeion), Placidus iterative solver (all 12 cusps within 5 arcmin tolerance), aspects, stelliums, geocoder, vault I/O atomicity, AI runner with fake spawn, legend writer prompt + structural validation, transit writer significance filter, chart-builder full-shape integration. Test command: `npm test`. For the full 95-test suite (incl. better-sqlite3 native binding): `npm run test:rebuild-native`.
- **Model-agnostic AI runner** — `src/ai-runner.js` is a one-shot wrapper around the Claude CLI's `--print` mode. AbortController cancellation, onProgress streaming token counts, error mapping for auth/throttle/network. Built model-agnostic so it can grow other backends (OpenAI HTTP, Ollama) without callers changing.
- **Connectors view** — new sidebar nav entry surfacing 11 ACE connectors (FluentCRM, Stripe, ThriveCart, Gmail, Calendar, Drive, Fathom, Hindsight, ace-analytics, Slack, Telegram). Per-connector test layer with brand icons, inline credential entry, and **honest status** (configured-vs-verified — never green-on-config-presence alone, per memory `feedback_honest_status_in_health_uis`). IPC channels for connector config read/write. Desktop environment awareness injected into chat system prompt so Claude knows which connectors are live.
- **Chat session labels + history tagging** — full system, not just the rename UI:
  - Per-user JSON store (`chat-meta.json`) with atomic write + IPC channels for get/set/list-all
  - Inline label edit in History view via hover-revealed pencil (right-click in sidebar also works); manual labels persist on session resume
  - Tag editor in detail pane with autocomplete; tag filter dropdown in History view
  - History search now matches manual labels and tags, not just session title
  - Three-tier name resolution (manual label > derived from title > raw title), with retroactive cleanup on existing sessions
- **Stop-button visual feedback** — when the user clicks Stop mid-stream, the chat message gets a clear visual treatment so it's obvious the response was interrupted vs. completed. Closes a long-standing UX gap where stopped messages looked indistinguishable from done ones.
- **High-contrast mode** — auto / high / normal toggle in Settings. Adds a separate `high-contrast.css` layer for both light and dark themes; auto mode follows OS `prefers-contrast`.
- **Take a Break feature** — restored on the atmosphere intensity bar in the titlebar.
- **Attachment file types** — CSV, TSV, and JSON now allowed in chat attachments (was images + text only).
- **Font-size setting** — wired the dead control, then removed it as redundant since the existing zoom (`--ui-zoom`) already covers it (per memory `feedback_kill_redundant_dead_controls`).
- **Connectors sprint roadmap + scheduled-tasks plans** — design + implementation plans committed for v0.3.4+.

### Changed
- **Astro view layout** — column-flex with the chat dock as a sibling at the bottom (not an overlay). "Hide wheel" toggle in the view header lets the legend expand to a centered 920px-max reading column.
- **Astro widget on the dashboard** — falls back to the user's natal chart (Sun sign, Rising) when no transit file exists yet, so the widget stays visible from the moment a chart is generated.
- **Chat scrollbars** widened from 3-4px to 8px so they're actually grabbable.
- **Ask FAB hidden on agents view** — the bottom-right Ask floating action button no longer overlaps agent UI.

### Also Fixed (in-batch, not pre-tag)
- **Velocity sparkline overshoot** — clamped Catmull-Rom spline so the curve never dips below baseline on the synthesis card.
- **Vault reader regex trap** — replaced `\Z`-anchored regex (which matches a literal `Z` in JS, not end-of-input) with line-based H2 section extraction. Was silently truncating section content at any uppercase Z (per memory `feedback_js_regex_z_anchor_trap`).
- **Ordered list rendering in chat** — `start` and `value` attributes now allowed by sanitizer, so `<ol start="5">` renders the leading number correctly instead of resetting to 1.
- **Permissions write approval card** for `.claude/` paths — explicit approval UI instead of a silent denial.
- **Build mode permissions** — added `Write` and `Edit` to `BUILD_PERMS` so build sprints can actually write code without prompting per file.
- **AI runner prompt passing** — switched from stdin to positional arg (avoids stream-handling races on slower stdin pipes).

### Internal
- **Chiron cache 1900–2035** (49,673 daily positions, 2 MB, generated build-time via Skyfield + JPL DE440). Pre-1900 dates gracefully omit Chiron rather than blowing up the chart.
- **GeoNames cities ≥5,000 pop** (68,512 entries, 11 MB SQLite, CC BY 4.0).
- **Privileged write path** — astro module is allow-listed in `00-System/permissions.md` to write to `00-System/core/` (same exception pattern as `/build-vault`).

[Design](docs/plans/2026-05-02-astro-natal-pipeline-design.md) · [Plan](docs/plans/2026-05-02-astro-natal-pipeline-plan.md) · [PR #2](https://github.com/mythopoetix/nikhil/pull/2)

### Astro Go Deeper (v1)
- **"Go deeper →" button on every astro card** — transit, incarnation, wound, nodal axis, master quest, all 9–10 planet cards, and the dashboard cosmic-weather overlay. ~15 entry points total.
- Click spawns a fresh Create chat session, applies an `Astro: <Card>` manual label (using the chat-labels API from v0.3.3), and prefills the composer with a card-scoped seed in coaching voice. **Does NOT auto-send** — user can edit before firing.
- Pure-function seed builders for each card archetype (`renderer/views/astro/go-deeper.js`); 26 unit tests in `src/__tests__/go-deeper.test.js`.
- v2 (DCA throughline weave) deferred — see [ROADMAP](ROADMAP.md).

[Design](docs/plans/2026-05-03-astro-go-deeper-design.md) · [Plan](docs/plans/2026-05-03-astro-go-deeper-plan.md)

### Astro transit refresh
- **Stale-day auto-refresh** — the Astro view now re-checks today's date every time you enter the view, not only on first mount. If the loaded transit is from a previous day (e.g. ACE stayed running overnight), it auto-regenerates instead of silently showing yesterday's reading. New `onAstroEnter()` hook in `renderer/views/astro.js`.
- **Refresh icon (↻) on the dashboard cosmic-weather widget** — click to regenerate today's transit on demand without navigating into the Astro view. Spins while running, surfaces a "stale" pill on the widget header when the cached reading is from a previous day.

---

## [v0.3.2](https://github.com/actualize-ace/ace-desktop/releases/tag/ace-desktop-v0.3.2) — 2026-04-28

### Fixed
- **Build Mode toggle silently no-op'd on fresh installs** — clicking the sidebar Build Mode toggle did nothing for users who hadn't yet had `~/.claude/settings.json` created (any first-time Claude Code install). Root cause: `readClaudeSettings` returned `null` for the missing file, and `toggleBuildMode` aborted on null without distinguishing "file missing" from "real read error." Now treats `ENOENT` as an empty config so the first toggle click creates the file with build perms. Existing users were unaffected. Caught during Joel Rafidi's onboarding.

### Added
- **Light mode contrast (WCAG AA)** + **font token system** — promoted typography to CSS custom properties on `:root`, swept hardcoded `font-family` literals to `var(--font-*)`, dropped DM Sans dependency, raised light mode tokens to WCAG AA contrast.

### Changed
- **Settings rename + decouple** — "Lean Mode" → "Bare Mode" (clarifies `--bare` semantics, no-ops without `ANTHROPIC_API_KEY`); "Disable MCP Servers" → "Skip MCP Servers" (independent toggle, no longer requires Bare Mode). Both default OFF. See commit `687a591`.
- **Cmd bar polish** — light-mode hover/scrollbar/backdrop fixes; long descriptions truncate cleanly with no horizontal scroll.
- **Slash menu in agents view chat bar** — now enabled (previously disabled).

---

## [v0.3.1](https://github.com/actualize-ace/ace-desktop/releases/tag/ace-desktop-v0.3.1) — 2026-04-27

### Added
- **Voice-to-text mic button** — tap-to-record / tap-to-stop in every chat pane and the Oracle panel. Pulsing red glow while recording, "Listening..." placeholder, transcribed text inserted into the textarea for review before sending. Global hotkey `Cmd+Shift+V` (`Ctrl+Shift+V` on Win/Linux) toggles recording on the active pane; the Oracle overlay takes priority when open. [Design](docs/plans/2026-04-27-voice-to-text-design.md) · [Plan](docs/plans/2026-04-27-voice-to-text-plan.md)
- **API Keys settings section** — new section in Settings with a Voice Provider dropdown (Deepgram, ElevenLabs, Local Whisper). Conditional fields per provider: API key for cloud providers, server URL for local Whisper, plus a separate Deepgram TTS key field when STT is non-Deepgram (Insight voice coaching stays Deepgram-only).
- **Provider-agnostic STT dispatch** — `INSIGHT_TRANSCRIBE` is now a switch on `config.voiceProvider`. Supports Deepgram Nova-2, ElevenLabs `scribe_v1`, and any OpenAI-compatible local Whisper server (`faster-whisper-server`, `whisper.cpp --server`, LocalAI). Same IPC channel and contract as before; `INSIGHT_SPEAK` (TTS) is unchanged.

### Changed
- **Chat input bar alignment** — paperclip, mic, and send buttons now share a 40px height (34px in Oracle) so they bottom-align cleanly with the input's natural one-line height under `box-sizing: border-box` + `line-height: 1.5`. Resolves the ~4px drift that made the icon strip read off-center.
- **Config migration** — legacy `deepgramApiKey` is copied into `voiceApiKey` on first load and `voiceProvider` defaults to `deepgram`. Existing users keep working with no setup; `deepgramApiKey` is preserved so Insight TTS continues regardless of STT provider.

### Fixed
- **Resumed sessions stay in chat mode** — previously, reopening a session rehydrated chat history then immediately auto-switched to terminal mode, hiding the chat the user had just opened. Resumed sessions now also seed `claudeSessionId` from `resumeId` so the first follow-up message doesn't trigger a redundant resume.

---

## [v0.3.0](https://github.com/actualize-ace/ace-desktop/releases/tag/ace-desktop-v0.3.0) — 2026-04-27

### Fixed
- **Windows prompt truncation (definitive fix)** — Claude CLI prompts sent through `.cmd` wrappers (npm install) were split at whitespace by cmd.exe, so only the first word reached Claude. Root cause: Node.js overrides `windowsVerbatimArguments` to `true` when `shell:true`, ignoring the v0.2.9 fix entirely. Now manually wraps the prompt in cmd.exe-safe double quotes before args are joined. Affects `chat-manager.js` and `synthesizer.js`. Users with `claude.exe` (standalone install) and all Mac/Linux users were never affected.

### Changed
- **Chat history restored on resume** — reopening a session now rehydrates prior messages from the Claude CLI session log instead of showing a blank pane.

---

## [v0.2.9](https://github.com/actualize-ace/ace-desktop/releases/tag/ace-desktop-v0.2.9) — 2026-04-26

### Fixed
- **Energy pill overflow** — removed the energy tag from the cockpit synthesis card; the tag was rendering raw state text and overflowing its container on Windows.
- **Windows CLI quoting (attempted)** — set `windowsVerbatimArguments: false` to fix prompt truncation on `.cmd` binaries. Did not resolve the issue — Node.js overrides this setting when `shell:true`. Superseded by v0.3.0.

---

## [v0.2.8](https://github.com/actualize-ace/ace-desktop/releases/tag/ace-desktop-v0.2.8) — 2026-04-26

### Fixed
- **Output flush race condition** — the close handler only flushed buffered stream events if a flush timer was pending. Events arriving after the last timer-based flush but before process exit were silently dropped. Now flushes whenever the event queue is non-empty, regardless of timer state.

---

## [v0.2.7](https://github.com/actualize-ace/ace-desktop/releases/tag/ace-desktop-v0.2.7) — 2026-04-26

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

## [v0.2.6](https://github.com/actualize-ace/ace-desktop/releases/tag/ace-desktop-v0.2.6) — 2026-04-23

Branch hygiene release. No user-facing changes.

Rebased 12 commingled landing-page commits off `main`; prior state preserved as `backup/pre-cleanup-v0.2.5` tag on origin. First clean-trunk release — `main` now contains only `ace-desktop/` work.

---

## [v0.2.5](https://github.com/actualize-ace/ace-desktop/releases/tag/ace-desktop-v0.2.5) — 2026-04-22

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

## [v0.2.2](https://github.com/actualize-ace/ace-desktop/releases/tag/ace-desktop-v0.2.2) — 2026-04-19

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

## [v0.2.1](https://github.com/actualize-ace/ace-desktop/releases/tag/ace-desktop-v0.2.1) — 2026-04-16

### Added
- **Linux support (AppImage)** — `ACE-0.2.1-x86_64.AppImage` now built and published alongside Mac DMGs and Windows installer on every release. Run `chmod +x` then execute directly. Ubuntu 22.04+ users may need `sudo apt install libfuse2`.
- Binary detection now covers Linux install locations: `/usr/local/bin`, `/usr/bin`, `/snap/bin`, `~/.local/bin`, plus nvm/volta/fnm/asdf/mise version-manager paths.

### Changed
- Refactored platform branching across `pty-manager`, `preflight`, `chat-manager`, and `main` from two-way (`win32` vs. else-Mac) to three-way (`win32` | `darwin` | `linux`). No behavior change on Mac or Windows.
- Linux window icon now loads the correct format.

---

## [v0.2.0](https://github.com/actualize-ace/ace-desktop/releases/tag/ace-desktop-v0.2.0) — 2026-04-15

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

## [v0.1.10](https://github.com/actualize-ace/ace-desktop/releases/tag/ace-desktop-v0.1.10) — 2026-04-13

### Added
- **Live file-watching** — vault changes (daily notes, patterns, follow-ups, memory files) reflect in the dashboard without manual refresh. File watcher covers all vault subdirectories.
- **Memory card styles** — auto-memory writes surface as ambient cards in the chat stream with type badge (user/feedback/project/reference) and faint gold glow.

---

## [v0.1.9](https://github.com/actualize-ace/ace-desktop/releases/tag/ace-desktop-v0.1.9) — 2026-04-14

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

## [v0.1.8](https://github.com/actualize-ace/ace-desktop/releases/tag/ace-desktop-v0.1.8) — 2026-04-14

### Added
- Natal chart and interpretations load from `{vault}/data/` via IPC instead of from the app bundle
- Mirrors existing ASTRO_TRANSITS pattern — packaged DMGs remain clean (no personal data bundled)
- Users with `data/natal-chart.json` + `data/interpretations.json` in their vault get full astro; others see empty state

---

## [v0.1.7](https://github.com/actualize-ace/ace-desktop/releases/tag/ace-desktop-v0.1.7) — 2026-04-14

### Fixed
- **Windows chat hang:** spawn/execFile on `.cmd` binaries now uses `shell: true` to route through cmd.exe — stdio pipes were never connecting, causing silent hang on Windows (Kim's machine)
- **Compass bleed:** `defaultCompassDirections()` returned hardcoded vocabulary from the developer's vault — clients without DCA frontmatter saw this as their compass data. Now returns `{}` so the compass widget renders blank state instead

---

## [v0.1.6](https://github.com/actualize-ace/ace-desktop/releases/tag/ace-desktop-v0.1.6) — 2026-04-13

### Fixed
- **Personal data leak:** every DMG through v0.1.5 bundled Nikhil's pre-computed natal chart and 82 lines of personal natal readings. Clients opening the Astro tab saw Nikhil's chart, not their own
- electron-builder `files` config now excludes `natal-chart.json` + `interpretations.json` from the bundle
- Astro view loaders return `null` on fetch failure instead of throwing — renders "Birth chart not configured" empty state
- Home greeting drops hardcoded name; proper `user.md` wire-up coming in a future release

---

## [v0.1.5](https://github.com/actualize-ace/ace-desktop/releases/tag/ace-desktop-v0.1.5) — 2026-04-13

### Fixed
- **Stale CLAUDE_BIN:** Settings > Re-detect wrote the new path to config.json but never updated the in-memory `global.CLAUDE_BIN` — chat/pty kept using the stale path (Eliana's Mac)
- `PATCH_CONFIG` now syncs globals when `claudeBinaryPath` / `vaultPath` change
- `resolveClaudeBin()` / `resolveVaultPath()` self-heal from config if globals are undefined
- `detectClaudeBinary()` + `preflight.checkBinary()` use augmented PATH (same pattern as v0.1.4 node-spawn fix) so Homebrew installs work in packaged builds
- `diagnoseBinary()` classifies failures (unconfigured / path-missing / not-executable) — error card shows the actual reason instead of a generic fallback
- `proc.on('error')` handler surfaces spawn failures (ENOENT etc.) that previously vanished silently

---

## [v0.1.4](https://github.com/actualize-ace/ace-desktop/releases/tag/ace-desktop-v0.1.4) — 2026-04-13

### Fixed
- **Node not found on client Macs:** packaged Electron apps inherit a minimal system PATH excluding Homebrew and npm binary dirs. Claude CLI is a Node.js script — spawning it without `/usr/local/bin` or `/opt/homebrew/bin` in PATH caused `env: node: No such file or directory` and pty launch failures
- Prepend known macOS node locations to PATH in both `chat-manager` and `pty-manager` spawn calls

---

## [v0.1.3](https://github.com/actualize-ace/ace-desktop/releases/tag/ace-desktop-v0.1.3) — 2026-04-13

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

## [v0.1.2](https://github.com/actualize-ace/ace-desktop/releases/tag/ace-desktop-v0.1.2) — 2026-04-13

### Fixed
- **Setup preflight:** Node.js and Git now correctly detected in packaged builds. macOS apps launched from Finder/Dock inherit a minimal PATH (no Homebrew `/opt/homebrew/bin`) — earlier release showed "Not found" even when both were installed via Homebrew. Falls back to known install paths when `which` fails
- **Sidebar (collapsed):** Learn nav icon centers cleanly — gold attention dot no longer pushes it off-axis. Status pulse + version badge hide when collapsed

---

## [v0.1.1](https://github.com/actualize-ace/ace-desktop/releases/tag/ace-desktop-v0.1.1) — 2026-04-13

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

## [v0.1.0](https://github.com/actualize-ace/ace-desktop/releases/tag/ace-desktop-v0.1.0) — 2026-04-12

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
