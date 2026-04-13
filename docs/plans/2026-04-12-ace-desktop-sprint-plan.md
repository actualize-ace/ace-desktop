# ACE Desktop — Sprint Plan (2026-04-12)

> Sequenced execution plan for all ACE Desktop work. Complements [ROADMAP.md](../../ROADMAP.md) — roadmap = what, sprint plan = when + in what order.
> Updated: 2026-04-12 — post-/start. 3 sprints ahead, ~4 weeks of horizon.

---

## Sprint 1 — Mac Ship (Apr 12–13) 🔴 ACTIVE

**Goal:** Joe Hawley installs signed build on macOS and completes first-launch flow with populated cockpit.

**Exit criteria:**
- Signed + notarized DMG delivered to Joe
- Joe's first `/start` shows populated North Star, Compass, affirmations
- No crash-on-launch, no empty-state cockpit

### Day 1 — Today (Apr 12)

| Order | Task | Blocks | Owner | Status |
|-------|------|--------|-------|--------|
| 1 | Ship remaining cockpit features (freeze DCA schema) | DCA frontmatter work | Nikhil | In progress |
| 2 | Update ROADMAP.md rows → Done as each ships | Handoff clarity | Nikhil | Live |
| 3 | **Apple Developer ID enrollment** ($99) | Code signing, auto-update | Nikhil | Not started |
| 4 | **DCA frontmatter integration** (after #1 freezes) | Joe's first-launch UX | Fresh chat | Not started |
| 4a | → Read `parseDCAFrontmatter()` in `src/vault-reader.js` — extract authoritative schema | | | |
| 4b | → Update `ace-core/00-System/core/dca.md` template with empty scaffold | | | |
| 4c | → Extend `/build-vault` skill to populate from Blueprint (anchors, gate_date, journey_start, affirmations, compass_directions) | | | |
| 5 | **Onboarding tutorial** — post-setup walkthrough, once-shown | Client UX | Nikhil | Not started |
| 6 | **Code signing + notarization** — electron-builder afterSign hook | Clean install on Joe's Mac | Nikhil | Not started (gated on #3) |

**Hard gate:** 21:30 Max credits cutoff (DOWNGRADE MAX).

**Fallback if code signing not ready by EOD:** Path B — unsigned DMG + document Gatekeeper bypass (`xattr -cr` or right-click > Open) for Joe. Ship anyway.

### Day 2 — Tomorrow (Apr 13)

| Order | Task | Status |
|-------|------|--------|
| 1 | **First deploy test to Joe Hawley** — signed DMG install, first-launch flow, cockpit populated check | Not started |
| 2 | Live fix any install-blocking issues surfaced in Joe's session | Reactive |
| 3 | Capture feedback into [project_desktop_client_ship_sprint.md](../../../memory/project_desktop_client_ship_sprint.md) | Reactive |

---

## Sprint 2 — Windows Port + Stabilization (Apr 14–27) 🟡 NEXT

**Goal:** Marc Cooper installs on Windows. Auto-update + vault sync infra live so clients never manually install again.

**Sequential — do not start until Sprint 1 Joe install confirmed working.**

### Track A — Windows Port (Apr 14–20)

Dependencies flow left-to-right. Riskiest item first.

| Order | Task | Risk |
|-------|------|------|
| 1 | **ConPTY / node-pty testing on Windows** — Claude CLI spawn, ANSI render, resize | High (riskiest integration) |
| 2 | Claude binary detection for Windows (`%LOCALAPPDATA%`, `where.exe`) | Low |
| 3 | Process kill via `taskkill /pid /T` (replace SIGTERM) | Low |
| 4 | npm scripts cross-platform (`cross-env`) | Low |
| 5 | Native module rebuild x64 (better-sqlite3 + node-pty, Electron 34 headers) | Medium — may need Windows CI |
| 6 | Windows icon (`ace.ico` 256×256 multi-res) | Low |
| 7 | electron-builder win target (`nsis`) | Low |
| 8 | **First Windows deploy test → Marc Cooper** | Ship gate |
| 9 | Authenticode signing (defer if SmartScreen acceptable) | Low — deferrable |

### Track B — Auto-Update + Vault Sync Infra (Apr 21–27)

Depends on Sprint 1 code signing (both macOS notarization + Windows Authenticode).

| Order | Task | Why now |
|-------|------|---------|
| 1 | **App auto-update (electron-updater)** — GitHub Releases, auto-check on launch, install prompt | First manual install is the last |
| 2 | **Vault sync from desktop** — silent `git fetch upstream`, "ACE update available" badge, one-click `/sync-core` | Clients self-update vaults without CLI |
| 3 | Settings > GitHub config (client repo URL + upstream) | Prerequisite for #2 |
| 4 | Setup screen pre-flight: git + SSH key check | Prerequisite for #2 |

### Track C — Client Feedback (parallel, reactive)

- Incorporate Joe + Marc usage patterns into next sprint scope
- HeartMath calibration session (if Joe has device)
- Update roadmap based on observed friction

---

## Sprint 3 — Token Economy + UX Polish (Apr 28 – May 11) 🟢 QUEUED

**Goal:** Sustainable cost profile + daily-use UX refinements. No new surface area — make what exists better.

### Track A — Token Economy Phase 2

| Task | Notes |
|------|-------|
| Auto-effort at 80% context | Downgrade opus→sonnet automatically |
| Brevity injection at 70% | Inject brevity directive into system prompt |
| Cache countdown + refresh button | Visible 5min TTL, manual refresh |

Design: [token-economy-overhaul.md](../../ace-desktop-token-economy-overhaul.md)

### Track B — Auto-Sync Health System

| Task | Notes |
|------|-------|
| Background sync for Artifacts view | Start here — simplest |
| Extend to People + Dashboard | Once Artifacts stable |
| "Last synced" indicator per view | UX surfacing |
| Stale-data health flag | Integrates with system integrity bar |

### Track C — Dynamic Command Registry

~30 lines. `command-registry.js` reads `.claude/skills/*/SKILL.md` at runtime via existing `vault.listDir` + `vault.readFile` IPC. Merges with static `COMMANDS`. Both Cmd+K and slash menu auto-discover custom skills. No new IPC.

### Track D — Self-Healing Renderer Refresh

Half-day given existing infra. Needs:
1. `bootedAt` timestamp in `state.js`
2. Refresh-window config (idle >30min + uptime >12h, or 2am–6am)
3. State audit (chat sessions, PTY connections)
4. IPC channel `RENDERER_REFRESH`
5. Post-reload hydration path

### Track E — UX Polish

| Task | Priority |
|------|----------|
| Somatic warmth token glow fix (targeted, not full-screen) | Medium |
| Notification redesign (amber, jump-to-pane) | Medium |
| Terminal session naming (auto-name from first prompt) | Medium |
| Living orb (PTY activity reactive) | Medium |
| Scratchpad (persistent markdown sidebar) | Medium |

---

## Beyond Sprint 3 — Parked

See [ROADMAP.md § Parked](../../ROADMAP.md#parked--future-sprints) and [ROADMAP.md § Future](../../ROADMAP.md#future--guided-onboarding-flow-ace-blueprint--mcp-wizard--system-ready).

**Highest-leverage parked items to promote next:**
1. **Guided onboarding flow (Phase A–C)** — enables ACE-Delivers-ACE by Beta 3
2. **Client backup/restore** — insurance against vault loss
3. **Auto-close on window exit** — solves "forgot /close" memory leak
4. **Dashboard customization** — clients pick/rearrange widgets

**Permanently parked unless validated by client demand:**
- Token economy Phase 3–5 (provider routing, Graphify, direct SDK)
- Event bus / state proxy / event delegation (engineering hygiene, not user-visible)
- Custom pages, skills store, embedded browser
- Canvas view (ON HOLD)
- Test framework (defer until regression pain justifies)

---

## Sprint Cadence

- **Sprint length:** ~2 weeks, tied to beta milestones
- **Sprint start:** Monday
- **Sprint review:** Friday EOD — what shipped, what slipped, update ROADMAP
- **Mid-sprint check:** Wednesday — am I on track or do I cut scope?
- **Monthly:** review Parked, promote or drop

---

## How to Use This File

- **Every morning:** Check "active" sprint column. Pull next unblocked task.
- **When shipping:** Update ROADMAP.md row → Done (live, not batch). Sprint plan stays fluid.
- **When blocked:** Surface in /start or /brief. Document the dependency.
- **End of sprint:** Move completed tracks to ROADMAP Shipped, open next sprint.
- **When adding new work:** If it fits current sprint scope, add it. If it doesn't, park it in ROADMAP Next or Parked.
