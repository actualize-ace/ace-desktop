# ACE Desktop — Changelog

All notable changes to ACE Desktop are documented here.
Format: newest first. Tags link to GitHub Releases.

---

## [v0.4.5](https://github.com/actualize-ace/ace-desktop/releases/tag/ace-desktop-v0.4.5) — 2026-08-18 — the settings panel comes back, groups read as groups, and a reply can start in ACE

This release exists first to supersede 0.4.4, whose Settings panel did not render at all. The rest of it makes Comms worth the visibility 0.4.4 gave it: group chats stop wearing one person's name, a mute covers the whole window, a dead bridge names its cause, and a reply can now begin in ACE while sending stays entirely yours. Scheduled background tasks also come back from the dead.

### Added
- **Group chats now read as groups.** Beeper has always said which chats are groups and what they are called, and ACE was discarding both, guessing identity from whoever spoke recently. When one person spoke in a group, the whole thread wore that person's name, and group chatter could be routed into your follow-ups as though a member owed you a reply. That is a data-integrity failure, not a cosmetic one, and it is gone at the level where it lived: chats now carry Beeper's own type and title, a group renders as a real room name with a group pill and the true participant count, never the count of recent speakers, and no group can route to a person surface. Muting also now means what it says. A mute or unmute in Beeper takes effect across the whole visible window at the next projection, where before it was honored only for newly arriving messages and up to seven days of already-staged ones stayed visible. Chats the map does not know behave exactly as before, so nothing already staged is disturbed. (`src/connectors/`, `renderer/views/comms.js`)
- **A reply can start in ACE, and sending stays yours.** A needs-reply card now carries a compose box: type or dictate a draft, and it lives on that card, saved locally per profile, surviving an app restart. Open in Beeper opens that chat in Beeper with your text staged in its compose box; you read it there and press send, or you do not. Nothing else leaves the machine: Clear is local, the one call the surface makes is a focus, and ACE holds a read-scoped token with no send route in the client, so "ACE cannot send" is enforced by the token, not by a promise. The whole surface sits behind an explicit consent switch, default off and revocable; with consent off, no draft interface exists and the service refuses before opening a socket. (`renderer/views/comms.js`, `renderer/views/comms-drafts-store.js`, `src/connectors/draft-writer.js`)
- **When sync fails because Beeper is closed, Comms says so, and offers to open it.** A failing bridge used to read as a generic sync failure. The most common cause, the Beeper app simply not running, is now detected and named on the card, with a button that opens it. (`renderer/views/comms.js`, `src/connectors/connectors-service.js`)

### Fixed
- **The Settings panel renders again.** In 0.4.4 opening Settings failed with `TypeError: true is not a function` and showed nothing, leaving every setting unreachable. The cause was two backticks inside an HTML comment inside the panel's template literal: the first closed the string, and the text after a comparison then applied as a tag to the literal that followed, calling a boolean as a function. That is valid JavaScript, so no parser, linter, or check step could flag it; only actually rendering the panel fails. The backticks are gone, the rest of the renderer was swept for the same shape with no other occurrence found, and a regression suite now renders the panel for real, proven by watching all six tests fail with the exact production error against the broken revision. (`renderer/views/settings.js`, `renderer/__tests__/settings-panel-render.test.js`)
- **An old stamp no longer opts you out of Comms.** 0.4.1 and 0.4.2 wrote `comms: false` into the settings file of anyone who merely opened the Settings panel, harmless at the time because Comms was opt-in. 0.4.4 flipped Comms to on-unless-you-said-no, and that historical stamp began reading as an explicit no: members who had ever opened Settings on those versions would see Comms disappear after upgrading, while members who never had would not. The default is corrected, and a one-time repair clears the stale stamp and marks every settings file, including the ones needing no repair, so the repair can never later undo a genuine choice. Switching Comms off on this build works exactly as before and is never touched by the repair. (`renderer/views/settings.js`, `src/config-migrations.js`)
- **Scheduled background tasks launch again, and say what actually happened.** 0.4.4 handed the CLI a permission flag it refuses in background mode, so every scheduled fire since then died at launch while health kept reporting green. The launch flags are corrected, and the honesty gaps around them are closed. A fire that wakes to a dead network is held and recorded as a failure instead of dispatched into nothing and stranded silently, with the readiness window widened from 20 to 120 seconds to survive post-wake WiFi reassociation. Each fire now classifies what the previous run actually did, reading the completion markers unattended runs already emit, so "dispatch accepted" stops standing in for "the work happened". A retry-backoff window shorter than the task's own schedule no longer swallows the next scheduled fire, a manual Run now leaves the same durable health trace as a launchd fire, and runs that finish while ACE is closed announce themselves once at the next launch, which by construction could never happen before. These fixes reach real scheduled fires once this release is installed, because the background runner is the packaged app. (`src/scheduler/`, `src/agents-manager.js`, `src/agent-notify-state.js`)
- **A finished reply no longer blinks as though it is still writing.** The streaming caret could survive the end of a turn and sit on a completed reply indefinitely. It is removed when the turn settles, with a regression test covering the orphaned-paint path. (`renderer/modules/session-manager.js`)
- **The AI transit reading keeps its own file, and a failed regeneration says so.** Regenerating the reading could fail silently and leave the old text in place; it now fails loudly, and the reading no longer shares a file with anything else. (`renderer/views/astro.js`, `src/astro/index.js`)
- **Tolerant due-date parsing, and a local-calendar birth-time fix.** More date formats are accepted where follow-ups are matched, and the astro birth time is interpreted on the local calendar. (`renderer/modules/people-matching.js`, `src/vault-reader.js`)

### Changed
- **A killed turn names its own cause.** When a chat process is killed rather than exiting on its own, the record now says so and says why, instead of leaving a bare exit. Diagnostic groundwork for the reply-loss line of work; nothing about rendering changes. (`src/chat-telemetry.js`, `src/chat-manager.js`)
- **Composer polish.** A soft glow on focus and hover, and a proper scrollbar on long drafts. (`renderer/styles/chat.css`)

### Known limitations (carried from 0.4.4, still true)
- **The blank-bubble failure remains visible, not fixed.** The instrumentation shipped in 0.4.4 stands; no occurrence has yet named which of the two surviving mechanisms is real, and nothing in this release should be read as a fix for it.
- **Voice transcription does not work on a fresh install.** Nothing in the app bundles a transcription engine: it runs only where `whisper-cli`, `ffmpeg` and a model have been installed by hand. On any other machine a voice note stays a bare `[voice]` marker, with no indication the feature is unavailable.
- **If you get signed out of Claude, the app will not tell you, and cannot sign you back in.** Carried unchanged from 0.4.4: the signed-out card and chip do not fire on a real sign-out, and recovery is `claude auth login` in a terminal. The fix remains carded as W2.1a.

---

## [v0.4.4](https://github.com/actualize-ace/ace-desktop/releases/tag/ace-desktop-v0.4.4) — 2026-08-10 — when a reply arrives late, and comms comes out from behind the switch

The headline is a class of failure being closed rather than a feature being added: a reply that took minutes to arrive could be destroyed by whatever you sent next, and now it is not. ACE Link comes out from behind its preview flag as a read-only surface.

**Disclosed 2026-08-18, superseded by 0.4.5: the Settings panel in this build does not render.** Opening Settings fails with `TypeError: true is not a function` and shows nothing, so every setting is unreachable, including the Comms switch announced below. Comms itself still works, because its visibility is decided outside the panel; what is broken is the panel. Found live in a member session; cause and fix are in the 0.4.5 notes. That work also surfaced an older defect this build activates: 0.4.1 and 0.4.2 stamped `comms: false` for anyone who opened Settings on them, and this build's on-unless-you-said-no gate reads that stamp as a real no, hiding Comms after upgrade for exactly those members. 0.4.5 repairs the stamp one time.

### Added
- **Comms (ACE Link) now ships visible to everyone.** It reads your messages locally to show who is waiting on a reply from you. Read-only by construction: it stages messages on your own machine and there is no send path in the code at all. The switch that used to hide it is now the switch that turns it off, at Settings → Preview Features. The gate reads "on unless you explicitly said no" rather than "on if you explicitly said yes", because the second form could never reach anyone who already had ACE installed: their settings file was written before the flag existed. (`renderer/lib/prepaint.js`, `renderer/styles/shell.css`, `renderer/views/settings.js`)

### Fixed
- **A reply that arrives late is no longer thrown away.** When a background task finished mid-turn, the notification was answered by a throwaway turn whose result closed the bubble the real reply was still streaming into, destroying the whole answer. Nine days of these were on record. A turn now *settles* (spinner gone, looks finished) without *releasing*, so later text on the same process reopens the bubble and keeps writing. Caught working in the field before release: two rescues in the running app, one after the bubble had sat finished-looking for 14.7 seconds and another after 29.0, both with nothing yet painted. The first correlated to a reply that ran 330 seconds and was written, painted and kept, where the previous build would have discarded it. (`renderer/modules/session-manager.js`, `renderer/modules/turn-paint-log.js`)
- **Events from a superseded process can no longer contaminate the live turn.** Stream events now bind to the process that queued them rather than being re-resolved at flush time, gated once at a single entry point with dropped events counted. Two defect sites the original design never named were found by the tests and closed: an erroring dead process marked the *live* turn failed, and a process that produced no output announced itself ready and replayed its startup failures onto the turn that replaced it. (`src/chat-manager.js`, `renderer/modules/session-manager.js`)
- **"Add to previous" no longer drops the note it was carrying.** The button cancels and re-sends 300ms later against a 2.5s grace window, and held three separate defects: the turn was fenced 300ms too late, the resulting settle pushed a phantom message into a history it had just cleaned, and the cancel was skipped entirely on an already-settled turn, leaking a process still writing. (`renderer/modules/session-manager.js`)
- **A failed message sync now recovers on its own.** The background timer only ran for a connection already marked healthy, so one failed sync latched it off permanently and only a manual Sync could bring it back. Observed running silently for five days across roughly 600 no-op ticks. Eligibility now retries a failed connection on an escalating backoff capped at an hour, and thrown errors are counted rather than swallowed uncounted. The root cause of the original failure remains unknown; this makes it self-healing, not prevented. (`src/connectors/link-sync-policy.js`, `main.js`)
- **A broken message bridge is now impossible to miss.** Comms bucketed a failing connection together with a healthy one, so the single pane you would open to look for messages showed a five-day-old picture with no signal that anything was wrong. Failure state now rides separately from "a link exists", which still keeps the Sync button available so an errored account stays retryable. (`renderer/views/comms.js`)
- **"Last sync" now means the last *successful* sync.** The timestamp was stamped on failed attempts too. That was harmless while a failed connector simply stopped being attempted, since it froze at the failure and read honestly as days ago, but the retry change above would have restamped it on every failed retry and shown "4 minutes ago" over days-old data. Stamped on completion only, with a regression test that fails if the old behaviour returns. (`src/connectors/connectors-service.js`, `renderer/views/connectors.js`)
- **Voice-note transcripts are carried in full.** A spoken note has no text body, so the transcript *is* the message, and it was passing through a 280-character preview cap that silently discarded everything past it while every surface still looked complete. A real member note lost its back half this way. **Note:** this only changes what you see if transcription is running at all — see Known limitations. (`src/connectors/digest.js`)

### Changed
- **A blank reply that used to leave no trace now reports itself.** On 10 August a turn ran for 116 seconds, produced 877 words, exited cleanly, showed an empty bubble, and wrote nothing at all to the log. The counter meant to catch exactly that had been counting text arriving in memory rather than text reaching the screen, so everything in between left it looking healthy. It was the instrument, not the fault. Painting and buffering are now counted separately and two previously unobservable outcomes report themselves by name, carrying enough detail that the next occurrence explains its own cause. At most one line per turn, so a bad session cannot flood the log. (`renderer/modules/turn-paint-log.js`, `renderer/modules/session-manager.js`)

### Known limitations
- **The blank-bubble failure above is visible, not fixed.** Two mechanisms still fit the evidence and cannot be told apart yet: the window received the text and failed to draw it, or it never received the text and the loss happened earlier. The next occurrence decides which. Nothing here should be read as a fix for it.
- **Voice transcription does not work on a fresh install.** Nothing in the app bundles a transcription engine: no speech package is included, and the build ships no binaries or models. It runs only where `whisper-cli`, `ffmpeg` and a model have been installed by hand. On any other machine a voice note stays a bare `[voice]` marker, retried silently forever, with no indication the feature is unavailable. Bundling is specified and not yet built.
- **Draft replies are not reachable.** The staging path exists behind a default-off consent gate and cannot send by construction, but no interface reaches it.
- **If you get signed out of Claude, the app will not tell you, and cannot sign you back in.** This release carries a signed-out card, a logged-out chip and an in-app Sign in button, and on a real sign-out none of them appear. Tested live on 10 August, and both causes are understood. The card listens for the signed-out message on the CLI's error stream, but the message actually arrives on the output stream inside the normal reply payload, so the code that would raise the card never sees it. The chip re-checks your sign-in state when you click back into the window, but skips the check if it already ran in the last 60 seconds, so a quick trip to a terminal and back falls inside the gap. What you see instead is a message that goes nowhere: no reply, no error, no explanation. **Recovery is `claude auth login` in a terminal,** which restores everything including the app. Previous releases had no signed-out handling at all, so nothing that used to work has stopped working, but the feature named here does not function and should not be relied on. One thing remains unmeasured: whether the earlier v0.4.2 would at least have printed the raw "Not logged in" text where this build prints nothing. The paint path changed across seven commits since then and that comparison has not been run. Fix carded as W2.1a.

---

## [v0.4.2](https://github.com/actualize-ace/ace-desktop/releases/tag/ace-desktop-v0.4.2) — 2026-07-29 — when the screen stays blank

One release about one symptom: you send something and nothing comes back. A real cause of it is fixed, a whole class of failure that was previously invisible is now recorded, and the specific mistake that caused the worst version of it can no longer reach a build.

### Added
- **A renderer fault is now written down.** A JavaScript error inside the window does not kill the app, so nothing ever caught one: the crash log has been empty of them for this app's entire history, and the only handling wrote to a stream that a packaged app launched from Finder has nowhere to send. That is the blind spot behind "I typed something and ACE never responded." The reply is generated in full and simply never painted, while every health metric still reports a clean turn, because those metrics are stamped by a different half of the app than the one that failed. (`main.js`, `renderer/app.js`)
- **A record of the turn that arrives and paints nothing.** Painting is now logged on the window side, so a reply that streams for a minute and shows you nothing leaves evidence behind instead of disappearing. Recounting the corpus this made possible also corrects a figure this project had been quoting: across 1,496 turns, 54 (3.61%) never saw a first token and 165 (11.0%) were killed mid-stream, where the previously published number was 1 in 1,437. Both numbers were measured honestly; the old one only ever counted one half of the pipe. (`renderer/modules/turn-paint-log.js`, `renderer/modules/session-manager.js`)

### Changed
- **A brand-new install now starts on Sonnet 5** rather than Sonnet 4.6. This is the model a member meets on their first ever launch, before they have chosen anything. It is written into their settings at that moment and never revisited, so an existing member keeps whatever they already have and is unaffected by this. Sonnet 5 over Opus because it carries a 1M context window on a current CLI at a fraction of the cost, which is the right first-weeks default before anyone knows when to reach for the expensive model. (`renderer/models.js`)
- **The ALPHA card describes the build you are actually running.** Its contents had not been refreshed since v0.4.0, so it was still announcing that release's news two versions later. It now covers the context work, the previews, and this release's fixes, and the card is bounded so longer copy scrolls instead of pushing its own buttons off the bottom of the screen. (`renderer/index.html`, `renderer/styles/shell.css`)

### Fixed
- **Sharing a screenshot no longer swallows the reply.** Every screenshot attachment produced a red stream error in chat: an image is inlined on a single line that a 390KB PNG can push past 1MB, and the old guard threw away the entire buffer rather than the oversized line, so complete messages sharing that moment died alongside it. The limit is now 32MB, applies only to the incomplete tail, and resynchronises at the next line instead of feeding a truncated fragment onward. (`src/ndjson-buffer.js`, `src/chat-manager.js`)
- **A long file write is no longer cut short as a false stall.** The watchdog moves a tool to its longer time limit when the tool begins rather than when it ends, so a large write is no longer judged against the limit meant for ordinary prose and killed part-way through. (`renderer/modules/stall-watchdog.js`)
- **Comms group threads now attribute quotes to whoever said them (preview).** A group conversation could print one person's words under another person's name, and wear a single member's avatar as though the whole thread were them. Off by default behind Settings → Preview Features. (`src/connectors/digest.js`, `src/connectors/comms-store.js`, `renderer/views/comms.js`)

---

## [v0.4.1](https://github.com/actualize-ace/ace-desktop/releases/tag/ace-desktop-v0.4.1) — 2026-07-27 — chat context you can trust (true context windows · pressure nudge · reload no longer loses work)

A maintenance release built around one theme: the numbers on a chat should be true, and a reload should not cost you anything. The context meter now reads each model's real window instead of a guess, a nudge reaches you before a long session hits the wall, and spend, model, and carried context all survive Cmd+R.

### Added
- **A context-pressure nudge that arrives before the slow zone.** A strip above the composer offers you a fresh chat while there is still room to act, instead of a passive percentage at the bottom of the pane that a heads-down dictation session sails straight past. It fires once per threshold rather than nagging, escalates its wording without escalating its styling, spills into the other pane and opens the split when the current pane is full, and plainly withdraws the offer when every slot is taken. (`renderer/modules/session-manager.js`, `renderer/modules/chat-pane.js`, `renderer/styles/chat.css`)
- **A branch pill in the titlebar.** When your vault is on a branch, a linked worktree, or a detached HEAD, the titlebar says so; on `main` in the primary checkout it stays invisible, so nothing changes for a member who never uses branches. It also keeps up with a branch switch made inside the app instead of going stale until the next reload. (`src/git-context.js`, `renderer/modules/branch-pill.js`)
- **A Codex runtime card in Connectors.** Log in to Codex and pick the model it rests on. ACE never stores an OpenAI credential, and writing the model setting leaves every other secret already in your `~/.codex/config.toml` byte-for-byte untouched. (`renderer/views/connectors.js`, `src/codex-auth.js`)
- **Comms (ACE Link) ships present but dark, behind a preview flag.** ACE Link reads your messages locally to build a comms picture, and it is still in development, so it is off by default and no member sees it without opting in at Settings → Preview Features. Read-only by construction: it stages messages locally and has no send path at all. (`renderer/lib/prepaint.js`, `renderer/views/settings.js`, `renderer/views/connectors.js`)

### Changed
- **The context meter reads each model's true window.** Windows are now learned from the CLI itself as turns complete and remembered across restarts, with measured values used only until a model's first real turn. The table this replaces was confidently wrong: it pinned Opus and Fable at 1M while the CLI actually ran them at 200K, so the meter read roughly five times low and a chat could reach the wall with no warning. Related: plain `claude-opus-5` runs a 200K window, and only the `[1m]` suffix buys the full 1M, so the context-wall card no longer suggests switching models for headroom that was never there. (`renderer/modules/telemetry.js`)
- **Instrument Sans throughout.** Display and body type move to Instrument Sans, with dashboard interaction fixes alongside. (`renderer/styles/`)
- **A quieter chat status strip.** The token count is gone from the visible strip: it only counted cumulative uncached input, so it understated real usage and implied a cost-per-token rate that meant nothing. The raw numbers moved to a tooltip, and the context-window bar grew slightly, being the only actionable number left. (`renderer/modules/chat-pane.js`)

### Fixed
- **Cmd+R no longer drops open chats from a split view.** A renderer reload now restores every open chat to the pane it came from. The split is rebuilt idempotently and self-heals a stale active-flag / missing-DOM mismatch before any chat is placed, so right-pane chats no longer fall into the left pane and get dropped past the per-pane limit. A partial or failed restore never erases the recovery record either: `persistActiveSessions()` is the single writer, so a chat that could not be placed returns on the next reload instead of being lost for good. An opened-but-unsent create chat now survives the reload too: it respawns as an empty slot in its original pane on the model you had picked, where before it was never written to the recovery record and vanished on Cmd+R. The pane-placement decision is now a pure, unit-tested function. (`renderer/modules/session-manager.js`, `renderer/modules/split-pane-manager.js`, `renderer/modules/restore-plan.js`, `renderer/modules/__tests__/restore-plan.test.js`)
- **A reloaded chat comes back on its own model, showing the context it is actually carrying.** Both were silently lost: the recovery record passed no model for a sent chat, on the belief that loading history re-derived it when nothing in that path ever did, and carried context size was never saved at all, so the bar read 0% on a chat sitting near full. (`renderer/modules/session-manager.js`, `renderer/__tests__/session-restore-state.test.js`)
- **Chat spend survives a reload and a History reopen.** Cost reset to $0.00 on both paths because the running total lived only on the in-memory session object, which both paths recreate. Spend is now written once per turn and restored on resume, and it no longer clobbers a chat's label or tags on the way through. (`src/chat-meta-store.js`, `renderer/modules/session-manager.js`)
- **Sovereign Mode: honest cost, and a key lifecycle that holds.** Session cost is labeled estimated rather than presented as exact, the server key lifecycle and boot-time catalog gate are fixed, and tool chips render atomically instead of flickering through partial states. (`renderer/modules/session-manager.js`, `src/pty-manager.js`)
- **A globally installed Codex binary resolves regardless of your npm prefix.** Child-process PATH construction is deduplicated across macOS and Linux, `~/.npm-global/bin` is included, and callers can hint the resolved Claude CLI directory so a co-located Codex install is always found. (`src/claude-runtime/discover.js`, `src/pty-manager.js`)

---

## [v0.4.0](https://github.com/actualize-ace/ace-desktop/releases/tag/ace-desktop-v0.4.0) — 2026-07-02 — v0.4 stable (Ambient · Sovereign Mode · Intelligence · Agents & scheduling first-class)

The v0.4 keel lands stable. The Agents and Images previews from v0.3.8–v0.3.9 are now first-class, background scheduling runs on macOS launchd, an Ambient surface and an opt-in Sovereign Mode arrive, Intelligence briefings render in-app, and the freeze / lost-work / stall bugs are fixed. This entry graduates the rc.1 → rc.3 scope below and folds in everything cut since rc.3.

### Added
- **Ambient surface.** A living-orb Ambient view with converse mode over bidirectional voice, a move engine that reads vault signals into a synthesis widget, and a Hero surface that offers one fresh suggestion at a time with suppression, a review nudge, and a depth drawer. You can mark a suggested move done from the view. (`renderer/views/ambient.js`, `renderer/widgets/ambient-orb.js`, `renderer/widgets/synthesis.js`, `renderer/modules/speakable.js`, `src/intelligence/ambient-move.js`, `src/intelligence/freshness-gate.js`, `src/vault-reader.js`)
- **Sovereign Mode (opt-in, key-gated, off by default).** An in-app launcher for the local opencode + OpenRouter terminal host, gated behind a Settings toggle and your own OpenRouter key, with a boot overlay that masks cold-start and a pinned dark theme. (`renderer/views/settings.js`, `renderer/modules/session-manager.js`, `renderer/styles/views/terminal.css`, `src/pty-manager.js`)
- **Intelligence briefings render in-app.** The weekly-review Health Runway can render an intelligence briefing on demand; a cockpit widget and a dedicated Intelligence view surface it, with an empty-state render CTA and a reading-history log. (`renderer/views/intelligence.js`, `renderer/widgets/intelligence.js`, `renderer/widgets/registry.js`, `main.js`, `src/ipc-channels.js`)
- **Agents is a top-level surface.** Promoted out of the Sessions group to its own primary sidebar item so the background-task workflow is discoverable on first launch. Hand work off with Task (runs once) or Goal (runs until a condition you write is met), and set up recurring scheduled tasks. (`renderer/index.html`, `renderer/modules/agents-manager.js`)
- **Scheduled tasks are visible from an empty state.** The Scheduled section and its "+ New" button now render even with zero tasks, so recurring work can be created in-app instead of hand-editing the filesystem. (`renderer/modules/agents-manager.js`, `renderer/styles/views/agents.css`)
- **Standalone LEARN lessons for Agents and Sessions.** The onboarding "Sessions, Agents, History" lesson split into a dedicated Agents lesson (a guided in-view tour of dispatch, Task/Goal, and scheduling) and a Sessions, Panes & History lesson. (`renderer/data/learn/`)
- **Background scheduling via macOS launchd (opt-in, off by default).** Scheduled tasks now fire through launchd instead of the Electron main process, so they run even when ACE is closed and catch up missed runs on wake. No launchd jobs are installed until you enable background scheduling in Settings. Platforms without a native backend (Windows/Linux) fall back to in-process firing while ACE is open. (`src/scheduler.js`, `src/scheduler/**`)

### Changed
- **Sidebar reorg.** People is now a flat primary item under Agents, Intelligence moved into the Knowledge group, and Learn is a standalone item under System. (`renderer/index.html`)
- **Per-chat aurora regulation field.** The chat pane carries a subtle regulation field during generation. (`renderer/modules/chat-pane.js`)
- **Images view: clearer no-key path.** The free Gemini-key link is now clickable (opens in your browser) and every button has a keyboard focus ring. (`renderer/views/images.js`, `renderer/styles/views/images.css`)

### Fixed
- **Resume no longer freezes the app.** Reopening a long conversation renders in interruptible batches so the window stays responsive throughout (regression-guarded in `src/__tests__/history-render.test.js`).
- **Scheduler re-anchors on timezone change.** launchd jobs re-anchor when the machine timezone changes, so a job created in one timezone no longer fires at the wrong local hour. (`src/scheduler/os-scheduler/macos.js`, `src/scheduler/scheduler-sync.js`)
- **Chat resilience.** Socket drops auto-retry up to three times before an error card, queued chat bubbles get a per-message Cancel button, and the engine-error card uses straight quotes so the renderer parses it. (`src/chat-manager.js`, `renderer/modules/chat-pane.js`)
- **Agents auto-retry scheduled socket drops** with a manual Retry button for the ones that stay down. (`src/agents-manager.js`)
- **Artifacts view repaired.** Visibility, search, preview, and live chip counts are fixed. (`renderer/views/artifacts.js`, `src/vault-reader.js`)

### Security
- **Connector token cleanup is path-confined.** The clear-tokens handler only deletes inside allow-listed credential directories under your home folder, instead of any path it is handed. (`main.js`)

### Known limitations (carried forward)
- **Partial CSP.** `script-src` still includes `'unsafe-inline'`; strict `script-src 'self'` did not land in this cut.
- **`sandbox: false` on the main window.** The preload still requires `ipc-channels` at build time; `sandbox: true` needs the preload bundled first.
- **Electron 34 (EOL).** The major version bump off 34 did not land in this cut.
- **Unsigned build.** DMGs are not code-signed or notarized. On first launch, right-click the app → Open to bypass Gatekeeper. arm64 for Apple Silicon, x64 for Intel Macs.

The strict-CSP, `sandbox: true`, and Electron-bump gates were flagged in rc.1 as targets for v0.4.0 final. They did not land here and are carried forward to a later release; v0.4.0 ships with the partial CSP, `sandbox: false`, and Electron 34 as accepted limitations for the current trusted-user base.

---

## [v0.4.0-rc.3](https://github.com/actualize-ace/ace-desktop/releases/tag/ace-desktop-v0.4.0-rc.3) — 2026-06-25 — RC refresh (People view · chat resilience · agent-dispatch + stall fixes)

Rolls up everything cut since rc.1 (rc.2 was a quick rebuild carried without separate notes). Still on the v0.4 line; strict-CSP / sandbox / Electron-bump remain deferred to v0.4.0 final.

### Added
- **People view (Phase 0).** A first-class People surface with exact-match lookup, due-date discipline on follow-ups, and graph fidelity to the network map. (`renderer/views/people.js`, `renderer/styles/views/people.css`)
- **Chat auto-retries transient overloads.** A turn that hits an HTTP 529 (API overloaded) now retries automatically instead of surfacing an error card. (`src/chat-manager.js`)

### Changed
- **People list tags are capped.** Category tags on the People list cap at two with an overflow chip, so dense entries stay scannable. (`renderer/views/people.js`)
- **Rhythm widget reads honestly.** A single 28-day scan replaces the buggy week array (which could count future dates), and labels now reflect what is actually measured. (`renderer/modules/rhythm-widget.js`)

### Fixed
- **Agents no longer hang on dispatch.** Background dispatch now resolves on the CLI's `backgrounded · <id>` banner instead of waiting for an stdout EOF that the detached daemon never sends, so handoff no longer stalls for 15s and fails. (`src/dispatch-core.js`, `src/agents-manager.js`)
- **Chat stall-card Resume loop is broken.** The Resume action now escalates and reaps the stuck process instead of re-entering the same stall card. (`renderer/modules/chat-pane.js`)
- **Inactivity stall watchdog.** Long-silent turns are detected and recovered via resume-without-replay, so a wedged turn no longer hangs the pane. (`src/chat-manager.js`)

---

## [v0.4.0-rc.1](https://github.com/actualize-ace/ace-desktop/releases/tag/ace-desktop-v0.4.0-rc.1) — 2026-06-11 — Early tester RC (Ultracode tier · v0.4 security hardening · partial CSP)

First release candidate on the v0.4 line, cut to get the current build onto early testers ahead of the final hardening pass. Carries the full v0.4.0 scope in Unreleased above, plus the changes below. The strict-CSP / sandbox / Electron-bump work is intentionally deferred to v0.4.0 final.

### Added
- **Ultracode multi-agent tier.** A capstone "✦ Ultracode" rung above Max in the per-chat and Settings effort selectors. Selecting it engages the CLI's multi-agent fan-out on decomposable tasks while still sending a valid `--effort max`; your typed message stays clean. Gated to models that honor it (Opus, Fable) — Sonnet/Haiku fall back to Max — and arms a gradient send-button ring so the higher token cost is never silently on. (`renderer/models.js`, `renderer/modules/session-manager.js`, `renderer/modules/chat-pane.js`, `renderer/views/settings.js`, `renderer/styles/chat.css`)

### Security
- **Closed the renderer-XSS → IPC → host-RCE escalation class (partial v0.4 hardening).** A pre-v0.4 audit surfaced a path from a renderer XSS through the preload bridge to host code execution. This pass closes the verified holes — each adversarially re-verified for both hole-closed and legit-caller-preserved: a `--` terminator before background-dispatch prompts so a flag-shaped prompt can't become a CLI flag; rejection of catch-all permission patterns with in-process vault-path derivation; hook-injection rejection on settings writes; vault-containment + `0600` enforcement on connector env files and `ace-config.json`; a path-traversal guard on history reads; and symlink-escape realpathing on new-file writes; plus renderer XSS escaping across the command bar, slash menu, MCP cards, connectors, and LEARN (DOMPurify). 484 tests pass (4 skipped). (`main.js`, `src/dispatch-core.js`, `renderer/**`)
- **Content-Security-Policy added (partial).** index.html now carries a CSP meta. `script-src` still allows `'unsafe-inline'` — the four inline module blocks are externalized in a later launch-verified pass — but it already blocks the highest-impact escalations: remote script loading, `eval` / `new Function`, plugins (`object-src 'none'`), `<base>` hijack, framing, and form exfil, and confines renderer fetch/connect/img/media/font to `'self'` plus the local coherence WebSocket. Pre-paint scripts externalized to `renderer/lib/prepaint.js`; dashboard and preflight buttons moved off inline `onclick`. (`renderer/index.html`, `renderer/lib/prepaint.js`)

### Changed
- **UI polish.** The Cmd+K command-bar input no longer draws a sharp-cornered focus ring inside its rounded panel; chat-pane header glyphs trimmed 14→12px (22px hit-target preserved); the astro birth-info line is centered to align with its toggle and links. (`renderer/styles/forms.css`, `renderer/styles/chat.css`, `renderer/styles/command-bar.css`, `renderer/styles/views/astro.css`)

### Install & known limitations
- **Unsigned build.** DMGs are not yet code-signed or notarized. On first launch, right-click the app → Open to bypass Gatekeeper. arm64 for Apple Silicon (M1/M2/M3), x64 for Intel Macs.
- **Partial CSP.** `script-src` still includes `'unsafe-inline'`; strict `script-src 'self'`, `sandbox: true`, and the Electron major bump land in v0.4.0 final. Acceptable for trusted testers.
- **Background scheduling is opt-in.** Off by default; enable it in Settings to have scheduled tasks run while ACE is closed (macOS launchd). See Unreleased above.
- **Scheduled-task prompts are trusted code.** A task's prompt runs as written; don't import scheduled-task files (`~/.claude/scheduled-tasks/*/SKILL.md`) from sources you don't trust.

---

## [v0.3.9-rc.2](https://github.com/actualize-ace/ace-desktop/releases/tag/ace-desktop-v0.3.9-rc.2) — 2026-05-29 — Sprint cut for beta (Skills view, chat summaries, Agents + Images live)

Mid-sprint release candidate cut to get the latest beta work onto testers' machines. Builds on rc.1's Windows Claude launch fix.

### Added
- **Skills view (Atelier).** New System-section view that catalogs the vault's skills, replacing the old Roadmap view. (`renderer/views/skills.js`, `renderer/data/skill-library.js`, `renderer/styles/views/skills.css`)
- **One-click AI chat summary.** Summarize any live chat or past session in one click; summary renders inline in the chat pane and History view. New `src/chat-summarizer.js` + IPC channel. (`renderer/modules/chat-summary.js`, `renderer/modules/chat-pane.js`, `renderer/views/history.js`, `renderer/styles/chat-summary.css`)

### Changed
- **Agents and Images views are now visible by default.** Both were shipped as flag-gated previews in v0.3.8 (`ace-flag-agentsView` localStorage flag and the `imageGenV1` config flag). Their sidebar nav entries now show without any flag, so beta testers see them out of the box. (`renderer/index.html`)

### Internal
- Windows CI smoke tests for the `claude-runtime` module (real Claude launch on Windows runners). Test-only; no user-facing change.

---

## [v0.3.9-rc.1](https://github.com/actualize-ace/ace-desktop/releases/tag/ace-desktop-v0.3.9-rc.1) — 2026-05-28 — Windows Claude launch fix (release candidate)

Release candidate for Windows beta testing. Not yet validated on a real Windows machine — cut to get the fix onto beta testers' Windows installs.

### Fixed
- **Windows Claude launch reliability.** Reworked how ACE finds and launches the Claude CLI so Windows installs start reliably instead of silently failing. Three changes:
  - **Never trust a path that can't run.** Setup/preflight now persist a Claude path only after it actually responds to `--version`, ending the "configured but won't launch" state. Windows `.ps1` shims are no longer auto-selected.
  - **Prompts no longer go through the command line.** The user message is piped to Claude via stdin, and ACE's system prompt (CLAUDE.md + identity block) is passed as a file (`--append-system-prompt-file`). This eliminates Windows `cmd.exe` breakage on characters like `& | % ^ < > " ( )` and newlines.
  - **Windows install types are handled explicitly.** Native binary vs npm `.cmd` shim are each launched correctly through a single adapter.
- New `src/claude-runtime/` module centralizes Claude discovery, verification, and launch (previously duplicated across `main.js`, `preflight.js`, and `chat-manager.js`). macOS/Linux native launch is unchanged. Scope: setup detection + structured chat only — terminal pane, background agents, and synthesis still use the prior launch path (migrating in a later release).

---

## [v0.3.8](https://github.com/actualize-ace/ace-desktop/releases/tag/ace-desktop-v0.3.8) — 2026-05-28 — Agents + Images previews, sidebar redesign

### Added
- **Agents view (preview, flag OFF by default).** A calm place to launch and watch background `claude --bg` sessions without living in a terminal: a unified list grouped by state (needs-input / running / scheduled / done / failed), a one-line dispatcher with a Task vs Goal mode hint, a read-only peek drawer with a live progress trail and reasoning-trail cards, macOS notifications on state transitions, unattended-task guardrails (scope rails, wall-clock cap, audit log), and a friendly scheduled-task builder (frequency + time + day, no cron required) backed by a cron-driven scheduler engine. Enable in Settings → Preview Features.
- **Image generation v1 (preview, flag OFF by default).** Generate images from a prompt with your own Gemini or OpenAI (gpt-image-1) key, saved to a simple gallery; auto-selects the provider you have a key for, renders image file-refs inline in chat as thumbnails, and shows a clear up-front banner with a deep-link to Settings when no key is configured. Enable in Settings → Preview Features.
- **Sidebar nav redesign (A6).** Views regrouped by function, a usable collapsed mode with a hover flyout, a refreshed icon set, and a "last used" hover on the command strip.
- **One-click Copy on the active chat**, plus Copy + Delete buttons in the Vault view toolbar.

### Fixed
- **Connectors: Disconnect/Remove now works.** The native confirm dialog is silently suppressed in this renderer, so it always returned false and the action never fired; replaced with an inline confirm strip.
- **Agents: no more false "blocked" state** on autonomous tasks that actually completed.
- **Permissions:** the "Always allow cd" button is relabelled to name its standalone-only scope.
- **Session continuity:** guarded chat stream/error/exit handlers against ghost events after teardown.

## [v0.3.7](https://github.com/actualize-ace/ace-desktop/releases/tag/ace-desktop-v0.3.7) — 2026-05-21 — Build Mode = True Bypass

### Changed
- **Build Mode now actually means Build Mode.** When the Build Mode toggle is ON, the chat engine launches with a true permission bypass (`--dangerously-skip-permissions`) instead of the `acceptEdits` mode + allowlist it used before. Commands, file edits, `.claude/` skill edits, MCP tools, and sub-agent calls all run without an approval card. The toggle previously only appended verb patterns to an allowlist, so anything the list did not name still spawned a card — a gap no list could close. Routing through the bypass closes it for good. Verified against Claude Code 2.1.144: the bypass is total, including `.claude/` writes.

### Added
- **Build Mode safety guard** — a `PreToolUse` hook (`.claude/hooks/build-mode-guard.cjs`) that hard-blocks a deliberately tight denylist of genuinely catastrophic Bash commands: recursive deletes of a filesystem root / system directory / home root (including `sudo`-prefixed and compound forms), fork bombs, and raw disk-device writes (`dd of=/dev/…`, `mkfs`, `> /dev/sd…`). It runs regardless of permission mode, so it is the one floor that survives the bypass. Ordinary destructive dev work (`rm -rf node_modules`, force-push, `git reset --hard`) is intentionally allowed. A block shows a non-actionable "Blocked for safety" note — no approval card, no retry. ACE Desktop installs and self-heals the guard on startup (`src/build-guard.js`), so fresh installs and client vaults get it automatically. Fails open: a missing or broken guard never bricks Build Mode.
- **Build Mode toggle feedback** — toggling Build Mode now gives a calm, visible signal: the toggle plays a one-shot pulse on the transition, carries a slow ambient breathing glow the whole time it is ON, and a small auto-fading toast confirms the change (`commands run without approval` / `approval prompts restored`). Since Build Mode now changes the safety model rather than just lengthening an allowlist, the mode you are in should never be ambiguous. Honours `prefers-reduced-motion` — the static gold state remains as the signal.

### Fixed
- **Build Mode no longer shows approval cards for unlisted Bash verbs** — `renderBashPermissionCard` early-returns in Build Mode and calls `autoApproveBuildMode` instead: extracts verb patterns from all denied commands, writes them to `settings.json` in a single batched read-modify-write (no race), and auto-continues the session. Fixed the v0.3.5 regression where commands like `dscl`, `lsof`, `xattr`, and `strings` still prompted even with the toggle ON. Toggle-off sweep now unions `BUILD_PERMS` + `dynamicBuildPerms` so runtime-approved patterns are cleaned up on mode exit. (`renderer/modules/build-mode.js`, `renderer/modules/mcp-cards.js`)
- **AskUserQuestion renders correctly in plan mode** — normalized real tool schema (`questions[]`, `multiSelect`, `{label, description}`) so proper tool calls produce an interactive card instead of an empty textarea; detects AskUserQuestion JSON emitted as plain text (plan mode / tool unavailable) and renders a card instead of a raw JSON box; routes card submit through `sendChatMessage` (stdin was dead in one-shot `-p` mode — writes silently no-opped); collapses duplicate prose behind a toggle when a card renders in the same turn. Fixes the broken plan-mode UI Joel Rafidi was seeing. (`renderer/modules/session-manager.js`, `renderer/modules/tool-renderer.js`)
- **MCP subprocesses no longer leak on session teardown (ACED-25)** — `killProc` was signalling only the claude PID; child MCP servers (`uvx workspace-mcp`, `npx mcp-remote`) reparented to launchd and survived. After ~5 sessions they exhausted ports 8000-8004 and every new Google Workspace connection failed. Chat process now spawns detached (own process group); teardown signals the negative PID so the whole subtree dies with it. (`src/chat-manager.js`)
- **History resume no longer spawns a blank session** — clicking a session in History briefly triggered the nav handler to auto-spawn an empty session before the resume took over. A `window.__resumeIncoming` flag suppresses the auto-spawn during the 150 ms hand-off. (`renderer/index.html`, `renderer/views/history.js`)
- **Google Workspace MCP routes through the shared HTTP service** — the connector template was using per-spawn `stdio`/`uvx`, opening a new port per session and exhausting ports 8000-8004 after ~5 concurrent sessions. Now `type: http, url: http://localhost:8000/mcp`. Do not revert to stdio. (`src/connector-registry.js`)
- **Large transcript renders no longer freeze the app** — `renderInBatches` yields to the event loop via `setTimeout(0)` between every 25 messages, keeping the renderer responsive during long session hydration. (`renderer/modules/render-in-batches.js`)
- **Bypassed messages hidden** — `.chat-msg-bypassed { display:none }` rule was missing. (`renderer/styles/chat.css`)

### Internal
- `tryAutoApproveWrites` was removed from `mcp-cards.js` in `e8b7ddf` but its import and call site remained in `session-manager.js`. An ES-module import of a missing export throws a SyntaxError that takes down the whole renderer module graph — the dev instance opened to a blank, broken screen. Dropped the dead import; write-permission denials now call `renderWritePermissionCard` directly. (`renderer/modules/session-manager.js`)
- Build-Mode Bash denials route through `autoApproveBuildMode` (see Fixed above) rather than the bash approval card. The old path would have auto-approved + retried the safety guard denial — an infinite loop. Caught in pre-implementation pressure testing. [Design](docs/plans/2026-05-20-build-mode-true-bypass-design.md).

### Added
- **HTML attachments** — `.html` files can now be attached to chat messages (🌐 icon). Both `attachment-manager.js` (main process) and `attachment-handler.js` (renderer) updated consistently.
- **Cadence thresholds tightened** — green ≤ 5 days (was 7), yellow ≤ 7 days (was 9). (`renderer/widgets/cadence.js`)

---

## [v0.3.6](https://github.com/actualize-ace/ace-desktop/releases/tag/ace-desktop-v0.3.6) — 2026-05-11 — Pomodoro + Reliability Sweep

### Added
- **Pomodoro timer** — focus/break cycle pill in the bottom-right of the somatic bar, click to configure work/break/cycles. Sleep-wake-safe via absolute `endTimestamp` (your timer survives lid-close and machine sleep). Native OS `Notification` when ACE is backgrounded with the ACE icon. WebAudio chime + toast with one-click `/breath` shortcut on work-end. 29 engine tests cover start/pause/resume/stop, `fastForward` sleep-wake recovery with safety cap, serialize/deserialize with corrupt-state recovery, and `advancePhase` long-break trigger.
- **Add-to-previous (queued bubble merge)** — when a chat is streaming and you queue a follow-up, the queued bubble now exposes an "Add to previous" button that folds it into the active streaming turn instead of spawning a new session. Handles the stream-just-finished race; button disables on click to prevent double-fire.

### Fixed
- **Bash approval patterns finally match** — the verb extractor was generating `Bash(git:*)` instead of the canonical `Bash(git *)`, so approved commands silently created allow-list patterns that never matched on subsequent invocations. Every command kept re-prompting forever. Now generates the space-form pattern that Claude Code actually honours.
- **Multi-denial bash cards** — auto-continue the conversation after Approve, plus per-item removal so you can deny one command in a multi-command card without losing the others.
- **Post-wake renderer starvation** — when the system wakes from sleep, ACE was freezing for ~3 min before recovering. Now `powerMonitor.on('resume')` immediately runs soft-GC + paints a "Resuming…" vitals indicator, so the renderer comes back fast.
- **Native min/max/close strip stayed black in light mode on Windows/Linux** — `titleBarOverlay` colors were baked in once at `BrowserWindow` construction with hardcoded dark values, so flipping the app theme left a black slab welded to the light-mode titlebar. Now `applyTheme()` calls `mainWindow.setTitleBarOverlay()` on each theme change with matched colors (light: `#f0eef6` / `#302e52`, dark: `#0a0a0f` / `#cccccc`). macOS unaffected (uses OS-native traffic lights). Caught on Aleksander's Linux machine.

### Changed
- **Async pane loading + error surfaces** — Artifacts, History, Learn, People, Vault, and Roadmap views now show a "Loading…" placeholder immediately on view enter, and surface errors in-pane on async load failure. Closes the silent-blank-pane class of bugs (root cause of the Resume "duplicate" bug from May 8, per memory `feedback_async_loading_states`).

### Internal
- **Release roll banner + `/roll-release` skill** (operator-only, never fires on client builds) — Roadmap view detects when the latest `ace-desktop-v*` git tag is newer than the leftmost roadmap column label and renders a yellow banner. One click opens a fresh chat with `/roll-release vX.Y.Z` pre-typed; the skill archives Done items and renames the column. Banner gracefully no-ops on any environment without a matching git tag (clients running `ACE.app` from `app.asar` have no `.git` dir → `git tag` fails → handler returns null → no banner). Client-safe by construction.

---

## [v0.3.5](https://github.com/actualize-ace/ace-desktop/releases/tag/ace-desktop-v0.3.5) — 2026-05-07 — Astro safety nets + clickable file refs + roadmap view

### Added
- **Clickable file refs in chat** — every wikilink, bare path (`00-System/state.md`), and absolute path mentioned in chat is now a purple pill. Click expands the file inline as collapsible markdown (with copy-raw button + recursive nav into linked files); ↗ icon opens it in your default app. New `vault.resolveRef` IPC channel with a symlink-safe resolver that handles explicit paths and wikilink stem search. Pills appear in user messages too. 21 commits across `feat/clickable-file-refs`. Closes the loop on Joel's "I want to actually open the files ACE points me to" feedback.
- **Roadmap view (sidebar)** — vault-backed kanban (`00-System/data/roadmap.json`) with columns v0.3.5 / v0.4 / Future / Parked / Done. Card-level "AI strategize" action drops a structured prompt into a Create session. Line-stroke icons + stoplight complexity dots. Surfaces what's shipping, what's deferred, and what the AI can pick up next — visible to the operator at a glance instead of buried in `ROADMAP.md`.
- **Copy + delete chats from History** — every chat in the History detail pane now has a **Copy** button (assembles the full transcript as plain-text with role markers + timestamps and copies to clipboard) and a **Delete** button (confirm dialog → removes the JSONL file from disk + drops any associated label/tags). Per-message copy icon on hover for grabbing a single response. Closes the "history chats cannot be copied" bug + fills the missing housekeeping gap (no way to clear stale/test sessions before this).
- **Slash-command chat title fix** — every chat started by a slash command (e.g. `/process-call`, `/pulse`, `/start`) was being titled "Command-message X command-message command-name" because Claude Code wraps the first user message in `<command-message>`/`<command-name>`/`<command-args>` XML-ish tags and `deriveSessionName` was stripping the angle brackets and surfacing the literal tag names as the leading content words. Fix in [session-naming.js](ace-desktop/renderer/modules/session-naming.js): detect the wrapper, extract the actual command name + first arg, and surface it as `/<command> <args>` (truncated at 40 chars). Retroactive — every existing chat in History gets the cleaned title on next render.
- **Untitled session fix — head-buffer too small** — chats with `queue-operation` / `attachment` / image preambles before the first user message were rendering as "Untitled session" because [session-reader.js](ace-desktop/src/session-reader.js) `parseMetaFromHead` only scanned the first 8KB (`headRead(8192)`). ACE writes preamble records that can each exceed 7KB; long-queue chats pushed the user message past the buffer, and image attachments produced single user-message lines >500KB that got mid-truncated and failed `JSON.parse`. Replaced the fixed head-read with `streamLines()` — chunked reader that yields complete lines (never mid-truncates), with early-exit once `title + slug + gitBranch + model` are all populated and a 4MB hard cap. Uses `StringDecoder` so multi-byte UTF-8 characters (emoji, CJK, accented chars) that span a chunk boundary decode cleanly instead of producing replacement characters in the title. Verified with a regression test that places an emoji at exactly the chunk boundary. Restores titles for every previously-Untitled chat on next History render.
- **Connectors registry expanded** — Airtable, Deepgram, ElevenLabs added to the connector registry so they appear in the Connectors view alongside the existing set.

### Astro
- **Legend safety net** — when a natal-legend generation fails partway, the UI now shows a partial banner + "Use anyway" button instead of dumping the user. `feat(astro): legend safety net — Use anyway, partial banner, regenerate button` (`f6ce44b`).
- **"Regenerate today's transit" button** — manual UI hook on the Astro view for when the daily transit didn't land or the user wants a different angle. Backend already supported it; this surfaces the action.
- **Manual paste path for natal chart** — users who can't run the pipeline (or want to override) can paste a known good chart directly. Pairs with a local-day fix so transits compute against the user's actual local date, not UTC.
- **Failed-generation draft + birth-data read-back** — IPC for recovering from a crashed generation: the partial draft is preserved and re-readable on next mount; birth data is read back into the form so the user doesn't re-enter it.
- **Incarnation Signature regex broadened** — `legend-writer.js` `sectionRe` now tolerates H1, italic, and `__bold__` heading variants. Joe Hawley hit this on v0.3.4 (2026-05-06): the LLM occasionally emitted a heading variant the strict regex rejected, surfacing as "Output structure incomplete." Closes the bug.
- **Go Deeper labels persist** — `Astro: <Card>` labels now persist under the Claude session UUID across history reloads (was being lost on session resume).

### Chat & permissions
- **Bash permission approval card for non-`.claude/` denials** — the renderer's filter previously required `.claude/` paths to render an approval card, so all other Bash denials silently dropped. Now any Bash denial renders a card with "Always allow `<verb>` commands" / "Just this command" / "Dismiss". Interim fix from `feat/bash-permission-card` (full Tier B run-on-user's-behalf path deferred to v0.4.0). Joel feedback (May 5) — building a RATH course platform migration in a sub-agent and hitting silent walls.
- **Identity lock + chat name persistence** — replaced the weak lean-mode-only identity hint with explicit `IDENTITY:` + `ENVIRONMENT:` system-prompt blocks that ban "Claude" / "Anthropic" / "Claude Code" self-references and enumerate valid ACE slash commands. Closes both the "ACE refers to itself as Claude Code during MCP setup" bug and the `/mcp` slash hallucination (the model was inventing CLI-only commands). Chat name persistence fix bundled.
- **Stop button on queued messages** — three coupled fixes: (1) send/stop button now flips back to ■ after queuing because programmatic input clears dispatch a synthetic input event; (2) user-stop with a queue peels the queue first instead of cancelling the running stream; (3) multiple queued messages peel LIFO (msg3 → msg2 → cancel msg1). Commit `33fb2dc`. Joel feedback (May 4) + reproduced on v0.3.4.
- **`/close` Step 6 explicit close signal** — the close protocol now ends with an unambiguous "you can close this tab now" signal so users don't sit waiting for more output (`2bc2e49`).

### Hardening
- **Renderer XSS + shell IPC + history fallback** — defense-in-depth pass on the renderer (`86c3566`): tightened sanitizer paths, hardened shell IPC surface, added history-resolution fallbacks.
- **`vault.resolveInsideVault` handles non-existent paths** — was throwing on missing paths; now returns gracefully so callers can decide.
- **Build Mode permission collapse** — 18 individual `Bash(git:...)` permissions collapsed into a single `Bash(git:*)` glob in the Build Mode preset.
- **Ritual streak counts only filled morning journals** — `vault-reader.js` was counting empty morning journals toward the streak.

### Fixed (UX polish)
- **Wikilink clickability gated** — every wikilink is now clickable (was previously gated on a `.clickable` class that wasn't always applied).
- **File-ref styling unified with wikilinks** — same purple, flattened to plain text inside `<code>` blocks.
- **Inline expand scroll behavior** — new expands now `scrollIntoView({ block: 'start' })` so the body shows; `flex-shrink: 0` prevents the inline-expand block from being squished in flex `chat-messages`.
- **Roadmap view CSS scope fix** — `#view-roadmap` display was `flex` unscoped, covering other active views with a white pane. Now scoped to `.active`.

---

## [v0.3.4](https://github.com/actualize-ace/ace-desktop/releases/tag/ace-desktop-v0.3.4) — 2026-05-04 — Hot patch

### Fixed
- **`.claude/` write approval card succeeded only inside the vault** — `PERM_WRITE_FILE` IPC handler restricted writes to the vault root, so approving a card for a `~/.claude/skills/...` file (the most common case — global skill creation) returned `Access denied: path outside vault` and the card showed "Partial — check files. Some writes need the terminal." Now allows writes inside vault root **OR** inside `~/.claude/`. Tested end-to-end: card surfaces → Approve → file lands → skill loader picks it up → conversation auto-continues. Closes the regression of the v0.3.3 fix for the original Joel-flagged silent-block bug.

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
