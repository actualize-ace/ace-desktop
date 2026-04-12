# ACE Cockpit Redesign — Design Doc

**Date:** 2026-04-11
**Status:** Approved — ready for implementation plan
**Supersedes:** [2026-04-11-triad-column-redesign.md](2026-04-11-triad-column-redesign.md)
**Prototype:** [cockpit-prototype-v2.html](2026-04-11-cockpit-prototype-v2.html) (light + dark mode)

---

## Why

The current home dashboard is a stacked widget feed. Operators look at three things — the orb, the synthesis line, the velocity wave — and scroll past the rest. The triad columns duplicate the Command Center's data. The Command Center hides useful signals behind tabs. Next Move suggestions are usually wrong because the algorithm has no awareness of today's intent.

This redesign turns the home view into a **directional coherence cockpit** — a bio-organic spaceship that orients you toward your North Star, surfaces the highest-leverage next action somatically (gravity, not lightning), and breathes with you. The coherence framework stays sacred. Operators get a dock zone for their own metrics. The cockpit becomes an **orientation portal** and **creative compass** — a subconscious primer for completed creation.

## Vision Statement

The dashboard isn't a productivity tool — it's a coherence hub. It feels like a craft in motion toward the operator's North Star. Living, breathing, somatically-tuned. When you open it, your body settles, your attention finds the next coordinate, and the day begins from oriented presence.

## What

A single cockpit layout with five fixed zones plus an extensible dock:

```
┌──────────────────────────────────────────────────────────────┐
│  ✦ NORTH STAR — anchors · gate · journey constellation       │
├──────────────────────────────────────────────────────────────┤
│  ◉ Coherence Orb  │  Synthesis line   │  ✦ Creative Compass │
│   (breathing)      │  + 9-dot signals  │   (4 directions,    │
│                    │  + mode/energy    │    needle pointing) │
│                    │  + affirmations   │                     │
├──────────────────────────────────────────────────────────────┤
│  ▓▓▓▓▓ Velocity →  │  ▪▪▪▪ Rhythm     │  ☽ Astro            │
├────────────────┬────────────────┬────────────────────────────┤
│  AUTHORITY ↗  │  CAPACITY ↗    │  EXPANSION ↗                │
│  authoring     │  holding        │  growing                    │
│  signal decode │  signal decode  │  signal decode              │
│  + action card │  + action card  │  + action card              │
│  (one rises with golden halo + focus dot)                    │
├──────────────────────────────────────────────────────────────┤
│  ↻ Inner Move — pattern-aware coaching prompt                │
├──────────────────────────────────────────────────────────────┤
│  YOUR INSTRUMENTS — operator dock (extensible, hidden if empty)│
└──────────────────────────────────────────────────────────────┘
```

### Aesthetic

Native ACE Desktop palette: cosmic violet/lavender background, mint Capacity, rose Expansion, glassmorphic cards with `backdrop-filter: blur(12px)`. Both dark mode (deep cosmos) and light mode (pearlescent lavender) supported, matching existing `body.light` tokens.

Typography: Space Grotesk for display, DM Sans for body, JetBrains Mono for small uppercase labels with heavy letter-spacing, Cormorant Garamond italic for emphasis and affirmations.

Every layer breathes at **5.5 bpm (11s cycle)** — the resonance frequency that produces HRV coherence. The orb leads. Triad columns breathe asynchronously when fragmented (Authority 9s/mind, Capacity 14s/body, Expansion 11s/action). When all 9 signals are green, they would sync to one breath.

When HeartMath is connected, the breath rate overrides default with the operator's live coherence breath cadence — the cockpit breathes WITH the body, not at it.

---

## Sections

### 1. North Star Bar

Three lines, persistent, never collapsed:

- **Orient line:** *"You are here"* in monospace whisper text
- **Anchors line:** three present-tense distillations of the operator's DCA, e.g. *"Already sovereign · Already overflowing · Already arriving"*. Source: frontmatter in `00-System/core/dca.md` (see DCA Frontmatter Schema below).
- **Meta line:** gate date · alignment direction (↑ on course / → drifting / ↓ misaligned, from `/pulse`) · day count (e.g. *"Day 994 / 1,360"*).
- **Constellation:** dots representing journey progress. Completed dots glow gold. Current day pulses lavender at 5.5 bpm. By the gate date, the constellation is whole.

### 2. Brain Bar (Orb + Synthesis + Compass)

**Coherence Orb** (left): violet/lavender sphere matching the existing `start-nudge-orb` style, scaled up. Three layers — outer iris ring rotating at 90s, ping ring expanding outward every 5.5s, the orb itself breathing 11s. Shows coherence score (0–18) + state label (coherent/stable/drifting/fragmented/critical). Click → opens **Threshold Mode** (90-second arrival ritual: 3 coherence breaths + DCA anchors recited + *"What wants to be created today?"* prompt → answer becomes today's intent in daily note → cockpit reflows). Stubbed in v1; full ritual builds in next sprint.

**Synthesis** (center): AI-generated one-line read of current state with selective Cormorant italic emphasis. Below: 9-dot signal matrix grouped as A/C/E clusters. Below: mode + energy as pill tags matching existing `.status-tag` pattern. Below: rotating affirmations from DCA frontmatter, one per breath cycle (~11s).

**Creative Compass** (right): four cardinal directions anchored to the operator's DCA dimensions. Default for ACE: visible expression / sovereign infrastructure / liberation & overflow / lineage & devotion. Needle points to dominant direction this week, drifting subtly. Click direction label → drill into supporting execution log entries. Click center pin → opens DCA file.

### 3. Flow Layer

- **Velocity** — waveform showing items shipped this week with directional arrow
- **Rhythm** — 28-day heatmap of cadence (3 intensity levels)
- **Astro** — moon phase glyph in glassmorphic tile

### 4. Triad Deck — Three Cards

Three glassmorphic cards, one per Triad leg. Each card has:

- **Header**: Authority / Capacity / Expansion with ↗ arrow + N/3 score
- **Subtitle** in serif italic: *authoring* / *holding* / *growing*
- **Empty-state semantics**: When a card has no action, the empty state names the category exactly: *"No outcomes pending"* / *"Body steady. Relationships current."* / *"Run /weekly-review to anchor your direction."* This teaches the operator without permanent labels cluttering the surface.
- **Hover tooltip** on leg name reveals categorical hint for new operators (e.g. hover *Authority ↗* → *"outcomes & gates"*).
- **Signal decode**: 3 rows showing key (A1/A2/A3...), name (Truth/Choice/Expression...), color dot, status label (GREEN/YELLOW/RED). Click row → opens coaching session for that signal.
- **Action card**: one prioritized next-move per leg with urgency dot, type tag, label, context, click target.

The three legs breathe asynchronously, gain risen treatment for the highest-leverage card (see Section 6).

#### Authority Leg — *Authoring*

**Pool:**
- **Outcome** — from active.md `### sections` with status field
  - Action: open coaching session for outcome
  - Done writes `**Status:** COMPLETE`

#### Capacity Leg — *Holding* — "What's asking to be held"

**Pool (universal, no ace.db needed):**
- **Regulation invitation** — when C1 yellow/red OR BODY calendar gaps detected
  - Action: open existing breath protocol view (sighing/box/4-7-8/coherence/custom)
  - Done auto-detected when breath protocol completes
- **Recovery protocol** — when Recovery flag in state.md is `true` OR energy is `depleted`
  - Action: open recovery protocol overlay reading from `00-System/health-signals.md`
  - Done auto-detected when recovery practice logged
- **HRV session** — when HeartMath connected AND >24h since last session
  - Action: open existing HRV panel, start guided session
  - Done auto-detected when session completes
- **Follow-up** — overdue commitments to people from `04-Network/follow-ups.md` table
  - Action: open coaching session for follow-up
  - Done writes Status cell from `Open` → `Done` in markdown table
  - Snooze updates Due column to new date

**Reframe:** Capacity isn't only relational — it's "what's asking to be held." Body, nervous system, or relationship. All forms of unmet holding. The leverage scoring naturally lets somatic cards win when the body needs them (low energy, regulation gaps), and follow-ups win when the body is steady but commitments are aging. **The body before the obligation.**

#### Expansion Leg — *Growing*

**Pool (universal except where marked):**
- **Weekly target** — unchecked items from active.md "This Week" sections
  - Action: open coaching session for target
  - Done toggles `- [ ]` → `- [x]`
- **Calendar BUILD block** — next BUILD-tagged event in calendar (next 24h)
  - Action: open in calendar
  - No done state (commitments are honored, not completed)
- **Cadence ritual** — synthesized at runtime from day-of-week (Saturday list email, Sunday weekly review)
  - Action: open coaching session
  - Skip-only (recurring, no persistent done state)
- **Growth edge** — pattern-derived edge from `01-Journal/patterns/index.md` tensions, OR C2 Depth signal yellow/red
  - Action: open `/edge` session pre-loaded with pattern context
  - Done auto-detected when /edge runs targeting that pattern
  - Snooze: "next week" — mute for 7 days
- **Pipeline deal** *(personal only — gated on ace.db existence)* — deals from `tools/ace-analytics/ace.db` with overdue next_action
  - Action: open coaching session for deal
  - Done routes through `ace_close_deal` MCP (creates revenue event)
  - Snooze deferred to v2 (requires ace-analytics write IPC)

**Reframe:** Expansion isn't only outward shipping — it's also inner growth. Growth edges as Expansion-leg cards mean the dashboard surfaces *"This week, your edge is to stop performing"* alongside *"Ship cohort copy."* Both are forms of growing.

### 5. Risen Card — Highest Leverage Surfaced Somatically

**Not lightning. Gravity.**

The action card with the highest leverage score lifts 3-4px above the others, gains a soft golden corona (animated at 5.5 bpm), and shows a small persistent gold focus dot in the top-right. On entry, a serif italic whisper appears above the triad deck pointing to the risen card: *"begin here ↓"* — fades after 5 seconds, doesn't repeat unless reloaded.

**Leverage scoring (weighted blend):**

```
score =
  +5 if matches today's /start focus (read from today's daily note)
  +3 if in the weakest triad leg (heal the breach)
  +2 if urgent (≤3 days to gate or 7+ days overdue)
  +1 if normal urgency
  +1 if aligned with this week's compass dominant direction
```

**Tie handling:** If two cards score equally, both rise with matching halos. A whisper says *"two paths today — let your body choose."* Whichever is clicked first becomes the day's primary. Three-way ties: all three rise. *"Three faces are equal today. Which one is alive?"*

**Persistence:** Once a card is clicked, the focus dot stays glowing on it for the rest of the day. Walk away and come back — instant re-orientation.

### 6. Card Action Layer

**Default visible:** Card body is fully clickable (opens coaching session or appropriate target view). Bottom-right shows the `→` arrow only. No buttons polluting the surface.

**Hover reveals** three quiet icons fading in at the bottom-right (200ms transition, replacing the arrow):
- **✓ Done** — marks complete in source file, card refreshes to next-highest in pool
- **→ Open** — primary action (same as clicking card body)
- **⏭ Skip** — dismisses for the day (existing localStorage logic), card refreshes to next candidate

**Right-click reveals** full context menu (type-aware):
- Mark done
- Skip today
- Snooze 3 days / 1 week (only for snoozable types)
- Cycle to next candidate in this leg
- Open in vault editor (jump to source file)
- Why this is here? (shows leverage breakdown)

**Type-aware action availability:**

| Type | Done | Skip | Snooze | Cycle |
|------|------|------|--------|-------|
| Outcome | ✓ Status field write | ✓ | ❌ (gates are committed) | ✓ |
| Target | ✓ Checkbox toggle | ✓ | ❌ (week-bound) | ✓ |
| BUILD block | N/A | ✓ | ❌ | ✓ |
| Cadence | ❌ (no state) | ✓ | ❌ (recurring) | ✓ |
| Growth Edge | ⚠ auto-detect from /edge log | ✓ | ✓ (next week) | ✓ |
| Regulation/Recovery/HRV | ⚠ auto-detect from activity | ✓ | ❌ (now-or-skip) | ✓ |
| Follow-up | ✓ Table cell write | ✓ | ✓ (date update) | ✓ |
| Pipeline (personal) | ✓ via MCP | ✓ | ⚠ deferred to v2 | ✓ |

**Why type-aware:** The cockpit doesn't pretend to support actions it can't actually execute. Snooze on outcomes would be lying — gates are sacred commitments, not adjustable due dates. Cadence "done" has no state to write to. Honest UI.

### 7. Inner Move Bar

Full-width pattern-aware coaching prompt. Mint left-border accent, italic emphasis, pattern wikilink display. Same data as current `_buildCoachingPrompt()` in synthesis widget — moved out of the Now tab into its own zone.

**Distinction from Expansion's Growth Edge cards:**
- **Inner Move** = the *coaching prompt* — a question or reflection from the AI based on patterns. *"What part of you is afraid to ship before it's perfect?"*
- **Growth Edge in Expansion** = the *named edge to engage with* — surfacing the pattern itself as an action. *"Performing pattern, 3 mentions this week — open /edge."*

The Expansion card commits you to engage. The Inner Move suggests how. Same edge, different angles.

### 8. Dock Zone

Below the Inner Move bar, separated by a dashed border + label *"Your Instruments."*

**v1:** Reserved as `<div id="dock-zone" data-empty="true">` — completely hidden when empty. Architecture supports operator-added widgets but no UI to add them yet.

**Future tiers (v2+):**
- **Tier 1 (Data widget)** — form-based wizard, pull from vault file or MCP query, display as stat/sparkline/gauge/list
- **Tier 2 (Skill widget)** — runs a skill on render, displays output
- **Tier 3 (Code widget)** — sandboxed iframe, full HTML/CSS/JS in `vault/widgets/*.widget.md`

The dock inherits the cockpit's design language: same frame, same breath, same palette. Custom widgets feel like part of the same craft.

---

## Universal vs. Personal

| Card type | Universal? | Notes |
|-----------|-----------|-------|
| Outcome | ✓ | Reads active.md (every operator has) |
| Target | ✓ | Reads active.md "This Week" sections |
| BUILD block | ✓ | Reads operator's calendar |
| Cadence | ✓ | Day-of-week synthesis |
| Growth Edge | ✓ | Reads patterns/index.md + C2 signal |
| Follow-up | ✓ | Reads follow-ups.md table |
| Regulation/Recovery/HRV | ✓ | Reads /pulse signals + state.md + HeartMath connection |
| **Pipeline** | **Personal only** | Gated on `tools/ace-analytics/ace.db` existence |

Pipeline is yours. Other operators see no pipeline cards — Expansion's pool simply has one fewer source. The cockpit ships universally. When client analytics roll out (Beta 2-3), pipeline becomes universal too.

---

## DCA Frontmatter Schema

Operators add this to their `00-System/core/dca.md`:

```yaml
---
north_star_anchors:
  - "Already sovereign"
  - "Already overflowing"
  - "Already arriving"
gate_date: 2027-12-31
journey_start: 2024-04-01
affirmations:
  - "Coherence is my operating state."
  - "The systems hold the back-end. My expression lives front-stage."
  - "I lead in the lineage of Shivaji."
  - "My homes are sanctuaries."
  - "I am surrounded by incredible allies worldwide."
  - "Truth reaches the world at scale."
  - "Liberation is already lived."
  - "Actualization is my proof."
compass_directions:
  north:
    label: "Visible expression"
    keywords: [content, post, publish, talk, podcast, email-out, video, share]
  east:
    label: "Sovereign infrastructure"
    keywords: [build, code, ship, system, automation, integration, deploy]
  south:
    label: "Liberation and overflow"
    keywords: [recovery, regulate, breath, body, rest, integration, audit-energy]
  west:
    label: "Lineage and devotion"
    keywords: [strategy, ritual, ancestry, decision, vision, threshold]
---
```

**Graceful fallbacks:**
- Missing `north_star_anchors` → *"Set your North Star in 00-System/core/dca.md"* (clickable)
- Missing `gate_date` → no countdown, just *"Direction without gate"*
- Missing `affirmations` → orb area shows mode tag only, no rotation
- Missing `compass_directions` → compass shows generic ACE defaults

---

## How

### File Changes

| File | Change |
|------|--------|
| `renderer/index.html` | Replace existing widget stack + `.triad-grid` with cockpit zones |
| `renderer/widgets/northstar.js` | NEW — anchors + journey + constellation |
| `renderer/widgets/compass.js` | NEW — four directions + needle + alignment |
| `renderer/widgets/triad-leg.js` | NEW — composite widget per leg (signal decode + action card with rise logic + hover icons + right-click menu + type-aware actions) |
| `renderer/widgets/innermove.js` | NEW — extracted from synthesis Inner Move logic |
| `renderer/widgets/synthesis.js` | Strip down to brain bar (remove Now/Week/Signals tabs, move Inner Move out) |
| `renderer/widgets/registry.js` | Add `zone` field to widget contract; swap widget list |
| `renderer/dashboard.js` | Zone-aware rendering, fetch daily note, compute leverage scores, hide empty dock |
| `renderer/styles/views/home.css` | Cockpit layout CSS (~600 lines, derived from prototype) |
| `src/vault-reader.js` | Add `parseDCAFrontmatter()`, `parseDailyFocus()`, `parseRecoveryFlag()`, `parseBuildBlocks()` |
| `src/vault-writer.js` | NEW — `markOutcomeComplete()`, `toggleWeeklyTarget()`, `updateFollowUpStatus()`, `updateFollowUpDueDate()`, `snoozeGrowthEdge()` |
| `src/synthesizer.js` | Add `computeCompassDirection()`, `computeLeverageScore()`, `computeCapacityCandidates()`, `computeExpansionCandidates()` |
| `main.js` | Add IPC: `GET_NORTHSTAR`, `GET_DAILY_NOTE`, `GET_BUILD_BLOCKS`, `MARK_DONE`, `SNOOZE_ITEM` |
| `preload.js` | Expose `getNorthStar()`, `getDailyNote()`, `getBuildBlocks()`, `markDone()`, `snoozeItem()` |

### Old Widgets — Disabled, Not Deleted

Set `defaultEnabled: false` on: `identity`, `metrics`, `state`, `outcomes`, `targets`, `pipeline`, `followups`, `quickactions`. Code stays in registry. Operators can re-enable any in the dock zone later.

### Compass Needle — Implementation Path

**v1: Keyword scoring** (deterministic, ships with this redesign)

```js
function computeCompassDirection(executionEntries, directions) {
  const scores = { north: 0, east: 0, south: 0, west: 0 }
  for (const entry of executionEntries) {
    const text = entry.toLowerCase()
    for (const [dir, config] of Object.entries(directions)) {
      for (const kw of config.keywords) {
        if (text.includes(kw)) scores[dir]++
      }
    }
  }
  const sorted = Object.entries(scores).sort((a, b) => b[1] - a[1])
  return {
    direction: sorted[0][0],
    strength: sorted[0][1] / Math.max(1, sorted.reduce((s, [, v]) => s + v, 0))
  }
}
```

**v2 (later):** Add `direction:` field to `/eod` and `/close` templates. Compass reads tags directly. No keyword guessing.

**v3 (later):** Weekly LLM scoring for accuracy.

### Leverage Score — Implementation

```js
function computeLeverageScore(priority, ctx) {
  let score = 0

  // Intent alignment (+5) — strongest weight
  if (ctx.dailyFocus?.some(focus =>
    fuzzyMatch(focus, priority.label) ||
    fuzzyMatch(focus, priority._raw?.person) ||
    fuzzyMatch(focus, priority._raw?.topic)
  )) score += 5

  // Heal the weakest leg (+3)
  if (priority.leg === ctx.weakestLeg) score += 3

  // Urgency (+1 to +2)
  if (priority.urgency === 'critical' || priority.urgency === 'urgent') score += 2
  else score += 1

  // Compass alignment (+1)
  if (priority.direction === ctx.compassDirection) score += 1

  return score
}
```

After scoring, group by leg, pick top per leg, then mark the overall highest as `risen`. Equal-score leaders all rise together.

### Capacity Candidates — Implementation

```js
function computeCapacityCandidates(allData, ctx) {
  const candidates = []
  const { metrics, state, followUps, hrv } = allData

  // 1. Regulation invitation
  const c1 = metrics?._signals?.[3] // C1 Regulation
  if (c1 === 'yellow' || c1 === 'red' || ctx.bodyGapsLast3Days >= 2) {
    candidates.push({
      type: 'regulation',
      urgency: c1 === 'red' ? 'urgent' : 'warning',
      label: 'Regulation invitation',
      context: `${ctx.bodyGapsLast3Days} BODY gaps · energy ${state.energy}`,
      action: { view: 'breath', protocol: 'coherence' }
    })
  }

  // 2. Recovery protocol
  if (state.recoveryFlag === true || state.energy === 'depleted') {
    candidates.push({
      type: 'recovery',
      urgency: 'critical',
      label: 'Recovery protocol',
      context: `Energy ${state.energy} · recovery flag ${state.recoveryFlag ? 'active' : 'suggested'}`,
      action: { view: 'recovery-overlay' }
    })
  }

  // 3. HRV session
  if (hrv?.connected && hrv?.hoursSinceLastSession >= 24) {
    candidates.push({
      type: 'hrv',
      urgency: 'normal',
      label: 'Coherence training',
      context: `Last session: ${hrv.hoursSinceLastSession}h ago`,
      action: { view: 'insight', mode: 'hrv-session' }
    })
  }

  // 4. Follow-ups (existing logic from _buildPriorities)
  candidates.push(...buildFollowupCandidates(followUps))

  return candidates.map(c => ({ ...c, leg: 'capacity' }))
}
```

### Expansion Candidates — Implementation

```js
function computeExpansionCandidates(allData, ctx) {
  const candidates = []
  const { state, pipeline, patterns, buildBlocks } = allData

  // 1. Weekly targets (existing)
  candidates.push(...buildTargetCandidates(state.weeklyTargets))

  // 2. Calendar BUILD blocks (next 24h)
  if (buildBlocks?.length) {
    const nextBlock = buildBlocks[0]
    candidates.push({
      type: 'build_block',
      urgency: 'normal',
      label: nextBlock.title,
      context: `in ${nextBlock.hoursUntil}h · ${nextBlock.duration}min`,
      action: { view: 'calendar', eventId: nextBlock.id }
    })
  }

  // 3. Cadence rituals (existing)
  candidates.push(...buildCadenceCandidates(ctx.dayOfWeek))

  // 4. Growth edges (NEW)
  if (patterns?.tensions?.length) {
    for (const tension of patterns.tensions) {
      if (tension.days >= 3 && !ctx.recentEdgeForPattern(tension.label)) {
        candidates.push({
          type: 'growth_edge',
          urgency: tension.days >= 7 ? 'urgent' : 'warning',
          label: `Growth edge: ${tension.label}`,
          context: `${tension.days} days alive · last /edge ${ctx.daysSinceEdge}d ago`,
          action: { view: 'terminal', skill: '/edge', context: tension }
        })
      }
    }
  }
  // OR if C2 signal yellow/red and no recent edge
  const c2 = allData.metrics?._signals?.[4]
  if ((c2 === 'yellow' || c2 === 'red') && ctx.daysSinceEdge >= 7) {
    candidates.push({
      type: 'growth_edge',
      urgency: c2 === 'red' ? 'urgent' : 'warning',
      label: 'Untouched edge',
      context: `Capacity → Depth ${c2} · last /edge ${ctx.daysSinceEdge}d ago`,
      action: { view: 'terminal', skill: '/edge' }
    })
  }

  // 5. Pipeline (personal only — gated on ace.db)
  if (ctx.aceDbExists && pipeline?.length) {
    candidates.push(...buildPipelineCandidates(pipeline))
  }

  return candidates.map(c => ({ ...c, leg: 'expansion' }))
}
```

### Threshold Mode (stubbed in v1)

Click the orb → modal/overlay opens:
- 3 coherence breaths (orb leads, full-screen)
- North Star anchors recited (visual or audio)
- One question: *"What wants to be created today?"*
- Operator types one line → written to today's daily note as `## Today's Focus: [text]`
- Modal closes, cockpit reflows with leverage scores recomputed

**v1 ships:** Click handler with placeholder modal. Full ritual builds in next sprint.

### Animations (CSS Performance)

All animations use `transform`, `opacity`, and `filter` only — no layout thrash. Animations:
- **Breath cycle (11s)**: orb scale + box-shadow, signal dots opacity, leg-card box-shadow
- **Iris rotate (90s)**: `transform: rotate()` on outer ring
- **Aurora drift (80s)**: ambient background `transform: translate + scale`
- **Star shimmer (15s)**: starfield opacity
- **Constellation pulse (11s)**: current-day star scale + opacity
- **Risen halo (5.5s)**: action card box-shadow + focus-dot scale
- **Compass needle drift (30s)**: needle rotation alternate
- **Asynchronous leg breath**: Authority 9s, Capacity 14s, Expansion 11s

Total animation cost: ~12 simultaneous CSS animations. Tested in prototype at 60fps on M1 Max. `prefers-reduced-motion` respected — disables breath animations for OS-level accessibility.

---

## Felt Sequence (The User Opens ACE)

1. The North Star bar shimmers. *"Already arriving."*
2. The orb breathes. Without thinking, breath slows to match.
3. Synthesis line speaks. Affirmation rotates: *"Coherence is my operating state."*
4. Eye drifts to the triad deck. **One card is risen** — soft golden corona, lifted 3-4px, focus dot glowing in the corner.
5. Whisper appears for 5 seconds: *"begin here ↓"*. Fades.
6. You either click the risen card (the cockpit was right) or click another (the cockpit learns).
7. Coaching session opens. The day begins.

The cockpit didn't tell you what to do. It brought you to yourself, oriented you toward your North Star, and surfaced the next coordinate the way attention naturally rises — gravitationally, not via alarm.

---

## What This Replaces / Removes

**Removed from home dashboard:**
- Identity strip widget
- Stats strip (metrics) widget
- Quick actions widget
- State widget (mode/energy now in brain bar)
- Outcomes widget (now in Authority action card)
- Targets widget (now in Expansion action card)
- Pipeline widget (now in Expansion action card, personal only)
- Follow-ups widget (now in Capacity action card)
- Synthesis widget tab switcher (Now/Week/Signals — content distributed across cockpit zones)

**Kept and enhanced:**
- Coherence orb (now centerpiece of brain)
- Synthesis line (now persistent in brain)
- 9-dot signal matrix (now persistent in brain)
- Velocity waveform (now in flow layer)
- Rhythm heatmap (now in flow layer)
- Astro tile (now in flow layer)
- Inner Move (now its own bar below triad)

---

## Out of Scope for v1

These are designed-for-later, not built in v1:

- **Threshold Mode full ritual** — stubbed in v1, build next sprint
- **HRV-synced breath rate** — design supports it (CSS variable for `--breath`), implementation when HeartMath is connected
- **Loop closure animations** — action click → light pulse traveling up through column to orb to compass to constellation
- **Operator-added dock widgets** — Tier 1/2/3 builds in v2
- **Compass v2/v3** — keyword scoring ships now, tagged entries and AI scoring later
- **AI-distilled DCA setup** — `/distill-northstar` skill is v2; v1 ships with manual frontmatter
- **Seasonal palette shifts** — calendar season + lunar phase + recovery palette responsive layer is v2
- **Constellation rendering as actual constellation pattern** — v1 ships with linear dot grid
- **Pipeline snooze** — v2, requires ace-analytics write IPC

---

## Risks

1. **DCA frontmatter missing for existing users.** Mitigation: graceful fallbacks render generic defaults; in-app prompt suggests adding frontmatter; setup wizard for new operators makes this part of onboarding.

2. **Leverage algorithm produces wrong rise.** Mitigation: ties are surfaced honestly (no false confidence); user can always click another card; clicking another card writes a preference signal that a future v2 algorithm can learn from.

3. **Performance on lower-end machines.** Mitigation: animations use only `transform`/`opacity`/`filter` (GPU-accelerated). `prefers-reduced-motion` media query disables breath animations.

4. **Operators with no /pulse data yet.** Mitigation: signal dots dim, leg score shows N/A, action cards render but no rise. Whisper changes to *"Run /pulse to activate signals."*

5. **Visual complexity overwhelming new operators.** Mitigation: rising card pattern surfaces single focus, whisper guides on first load, no notifications/badges/banners ever, hover tooltips for category clarity, empty-state semantics teach categories on demand.

6. **New operators with empty Expansion (no weekly targets yet).** Mitigation: Expansion empty state nudges *"Run /weekly-review to anchor your direction."* Calendar BUILD blocks and cadence rituals fill the gap from week one even without weekly targets.

7. **Markdown table editing for follow-ups is fragile.** Mitigation: use proper table-row replacement (not naive string replace); test against pipe-character-in-topic edge cases; existing parser already handles wikilink pipe neutralization.

---

## Success Criteria

This redesign succeeds when:

- Operator opens ACE and within 3 seconds knows what to do next without conscious search
- 9 health signals are visible without clicking through tabs
- The North Star is the first thing the eye lands on
- The dashboard breathes — you can sit with it without urge to scroll
- Operators can't say *"this looks like a typical productivity dashboard"*
- Custom-instrument operators (when v2 ships) can add their KPIs without polluting the framework
- Capacity cards correctly surface somatic invitations when the body needs them, follow-ups when it doesn't
- Expansion cards work for all operator types (not just product-builders) via the BUILD-block + growth-edge + cadence pool

---

## Next Steps

Invoke `writing-plans` skill to break this design into ordered implementation tasks with verification gates per task.
