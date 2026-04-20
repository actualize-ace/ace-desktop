# Test Foundation Design

**Date:** 2026-04-19
**Status:** Approved, ready for implementation plan
**Scope:** ACE Desktop (`ace-desktop/`) only

---

## Goal

Build a production-grade test safety net for ACE Desktop that:

1. Catches regressions in pure logic on every push (~30s feedback)
2. Blocks broken installers from ever reaching clients (~3–5 min gate at tag time)
3. Builds the discipline of writing tests before fixes, accumulating coverage opportunistically

**Aggression level: B — production-grade foundation, ~1 day of work.**

---

## Architecture

Two test layers, two CI workflows, one home directory.

### Test layers

- **Unit tests** — pure JS functions in isolation. Run via [Vitest](https://vitest.dev). Fast (~30s). No Electron, no DOM, no vault. Cover deterministic logic — frontmatter parsing, boundary scanning, model context lookups, permissions JSON shape.
- **E2E smoke tests** — real Electron app launched in headless mode via Playwright. Slow (~3–5 min). Cover user flows — app boots, view switches work.

### CI workflows

- **`ci.yml`** (new) — triggers on every push/PR to `main`. Runs unit tests only. ~45s total. Reports status (does NOT gate releases day one).
- **`release.yml`** (modify existing) — triggers on `ace-desktop-v*` tag. New `test` job runs unit + e2e *before* the existing `build-mac` and `build-windows` jobs. Both build jobs gain `needs: test`. If tests fail → no DMG built → no release published.

### Directory layout

```
ace-desktop/
  tests/
    unit/                    ← vitest reads from here (*.test.js)
    e2e/                     ← playwright reads from here (*.spec.js)
    helpers/
      launch-app.js          ← Electron boot wrapper with isolated userData
    fixtures/
      vault/                 ← canonical fake vault for parser tests
        00-System/
          state.md
          active.md
          core/dca.md
        04-Network/
          follow-ups.md
      stream-events/         ← canned stream-json fixtures
      README.md              ← "update when vault schema evolves"
  vitest.config.js
  playwright.config.js
```

Co-located with the app. No cross-app testing infra now — if we later test ace-web, that gets its own `ace-web/tests/`.

---

## Components & Tooling

### New dev dependencies (in `ace-desktop/package.json`)

```json
"devDependencies": {
  "vitest": "^2.0.0",
  "@playwright/test": "^1.48.0",
  "playwright": "^1.48.0"
}
```

No babel, no jsdom (yet), no ts-jest. Total install ~50MB. Playwright fetches Chromium binary (~150MB) on first install only.

### New scripts

```json
"scripts": {
  "test": "vitest run",
  "test:watch": "vitest",
  "test:e2e": "playwright test",
  "test:all": "npm run test && npm run test:e2e"
}
```

### Config conventions

- **`*.test.js`** for vitest unit tests
- **`*.spec.js`** for Playwright e2e tests
- Lock convention in both runners' configs so neither accidentally picks up the other's files.

### `vitest.config.js` highlights

- Test directory: `tests/unit/**/*.test.js`
- Environment: `node` (not jsdom — keeps tests fast and simple)
- Coverage: opt-in via `--coverage` flag, off by default

### `playwright.config.js` highlights

- Test directory: `tests/e2e/**/*.spec.js`
- Single worker (Electron doesn't parallelize well)
- Retry policy: **1 retry on failure** (Playwright + Electron + xvfb is known-flaky)
- Per-test timeout: 30s
- Boot via `electron.launch({ args: ['main.js'], env: { ACE_TEST_MODE: '1' } })`

### Test isolation helper

`tests/helpers/launch-app.js` — wrapper that boots the Electron app with `ACE_TEST_MODE=1` set. Without this, e2e tests would corrupt the user's real `~/Library/Application Support/ACE/ace-config.json`.

### `.gitignore` additions

```
playwright-report/
test-results/
coverage/
```

---

## Phase 0 — Runtime refactors required before tests can be written

The pressure-test surfaced that several functions we want to test are not currently in a testable shape. Three small, defensive refactors required. Total: ~30 lines of runtime code change across 3 files. Each refactor is a clean separation of concerns that improves the codebase whether or not we test it.

### 0.1 — `main.js` userData isolation hook (~5 lines)

Add early in main.js:

```js
if (process.env.ACE_TEST_MODE === '1') {
  const path = require('path')
  const os = require('os')
  app.setPath('userData', path.join(os.tmpdir(), `ace-test-${Date.now()}`))
}
```

When `ACE_TEST_MODE=1` is set, app uses a throwaway userData directory. E2E tests can boot the real app without touching the user's live config.

### 0.2 — Extract pure parser inner functions in `vault-reader.js` (~20 lines)

The parsers all currently take `vaultPath` and read files internally. Extract pure text-processing inner functions:

```js
// Before
function parseState(vaultPath) {
  const stateText = readText(path.join(vaultPath, '00-System', 'state.md'))
  // ...processing...
  return result
}

// After
function parseStateText(stateText, activeText) {
  // ...processing only, no I/O...
  return result
}

function parseState(vaultPath) {
  const stateText = readText(path.join(vaultPath, '00-System', 'state.md'))
  const activeText = readText(path.join(vaultPath, '00-System', 'active.md'))
  return parseStateText(stateText, activeText)
}
```

Apply to: `parseState`, `parseExecutionLog`, `parseDCAFrontmatter`, `parseFollowUps`. Add `parseStateText`, `parseExecutionLogText`, `parseDCAFrontmatterText`, `parseFollowUpsText` to module.exports.

### 0.3 — Extract `MODEL_CTX_LIMITS` to standalone file (~5 lines net)

`telemetry.js` imports `state.js`, which uses `localStorage`. Vitest in node environment crashes on import. Extract:

- New file: `ace-desktop/renderer/modules/model-context.js`
- Move `export const MODEL_CTX_LIMITS = { opus: 1_000_000, sonnet: 200_000, haiku: 200_000 }` into it
- `telemetry.js` and `session-manager.js` import from there instead

Now `MODEL_CTX_LIMITS` is testable without dragging in `state.js`/`localStorage`.

---

## Seed test set (10 tests)

### Unit tests (8)

Located in `ace-desktop/tests/unit/`.

1. **`boundary-scanner.test.js`** — `findSettledBoundary` and `findSettledBoundaryFrom` from chat-renderer.js. Test cases: empty string, partial message, complete message, message with code fence. Pure function, no setup needed.

2. **`escape-html.test.js`** — `escapeHtml` from chat-renderer.js. Test cases: plain text, `<script>` tag, ampersand, quote. Cheap and fast.

3. **`process-wikilinks.test.js`** — `processWikilinks` from chat-renderer.js. Test cases: single `[[link]]`, multiple links, link with display text `[[target|label]]`, no links.

4. **`parse-state.test.js`** — `parseStateText` (extracted in Phase 0.2). Feed sample state.md + active.md text from fixtures. Assert mode/energy/outcomes parsed correctly.

5. **`parse-execution-log.test.js`** — `parseExecutionLogText`. Feed sample execution-log text. Assert recent items returned in expected order.

6. **`parse-dca-frontmatter.test.js`** — `parseDCAFrontmatterText`. Includes a CRLF fixture string to verify the v0.2.2 fix doesn't regress. This is the test that would have caught the v0.2.2 bug before Marc hit it.

7. **`model-context-limits.test.js`** — `MODEL_CTX_LIMITS` from new model-context.js. Assert keys present (opus, sonnet, haiku), values sane (>0), no `undefined` values.

8. **`permissions.test.js`** — `addAllow` from src/permissions.js. Feed sample config + permission, assert resulting JSON shape.

### E2E smoke tests (2)

Located in `ace-desktop/tests/e2e/`.

9. **`app-boots.spec.js`** — launch app via launch-app.js helper, assert main window opens, assert cockpit DOM paints within 5s (look for known selector). The single most important test — if this fails, the app is fundamentally broken.

10. **`view-switching.spec.js`** — boot, click each nav item (Cockpit, Build, Studio, Graph, People, Coach), assert active view changes. Catches view-routing regressions.

### Deliberately not tested day one (YAGNI)

- Vault file watching (chokidar — race-prone, slow)
- pty-manager actual spawning (requires real shell)
- D3 graph rendering (visual, hard to assert)
- MCP server registration (requires real MCP processes)
- Anything that hits the network or real Claude CLI
- Chat send-to-Claude flow (weak without real backend)

These get added later when specific bugs surface.

---

## CI implementation details

### `.github/workflows/ci.yml` (new file, ~40 lines)

```yaml
name: CI

on:
  push:
    branches: [main]
  pull_request:
    branches: [main]

permissions:
  contents: read

jobs:
  unit-tests:
    runs-on: ubuntu-latest
    timeout-minutes: 5
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with:
          node-version: '20'
          cache: 'npm'
          cache-dependency-path: ace-desktop/package-lock.json
      - name: Install dependencies
        working-directory: ace-desktop
        run: npm ci
      - name: Run unit tests
        working-directory: ace-desktop
        run: npm test
```

### `release.yml` modifications (add new test job, gate existing build jobs)

Add new job at top:

```yaml
  test:
    runs-on: ubuntu-latest
    timeout-minutes: 10
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with:
          node-version: '20'
          cache: 'npm'
          cache-dependency-path: ace-desktop/package-lock.json
      - name: Install dependencies
        working-directory: ace-desktop
        run: npm ci
      - name: Install Playwright Chromium
        working-directory: ace-desktop
        run: npx playwright install chromium
      - name: Run unit tests
        working-directory: ace-desktop
        run: npm test
      - name: Run e2e smoke tests
        working-directory: ace-desktop
        run: xvfb-run --auto-servernum npm run test:e2e
```

Modify existing jobs — add `needs: test` to `build-mac` and `build-windows`.

Add `workflow_dispatch:` trigger so failed releases can re-run without retag:

```yaml
on:
  push:
    tags:
      - 'ace-desktop-v*'
  workflow_dispatch:
    inputs:
      tag:
        description: 'Tag to rebuild'
        required: true
```

### Branch protection — deferred to week 2

Not enabled day one. Reason: pushing direct-to-main hotfixes is part of the workflow (e.g. v0.2.2 CRLF fix was direct-to-main). If CI flakes (network blip, GitHub outage) and protection is on, hotfixes are blocked. Enable after one week of CI data shows acceptable failure rate.

### Release.yml modification safety

Before merging the release.yml changes, dry-run on a feature branch:

1. Create branch `test-foundation`
2. Push `ace-desktop-v0.0.0-cidry` tag from that branch
3. Verify the new test job runs and the existing build jobs gate correctly
4. Delete the dry-run tag and any dry-run release artifacts
5. Then merge to main

---

## What this is and isn't

### Is

Development tooling. Lives in the repo, runs in CI on GitHub's servers, never bundled into the DMG, never touches the client's machine.

### Isn't

- A test for every function (YAGNI)
- A replacement for manual visual QA (still needed for UI/UX changes)
- A solution to macOS code signing (separate concern)
- Cross-platform e2e coverage (Ubuntu CI only — Windows e2e if specific bugs surface)
- A solution to packaging-time bugs (tests run against source, not packaged DMG)

---

## Success criteria

- `npm test` runs in <60s and passes
- `npm run test:e2e` boots a real Electron headless and passes
- Pushing to main triggers ci.yml; status appears on commit
- Tagging `ace-desktop-v*` triggers test → build → publish chain; broken tests block the build
- README has a CI status badge
- `tests/README.md` documents how to add a new test, what fixtures exist, and the convention split between unit and e2e
- After 2 months, accumulated test count is >20 (i.e., the discipline took root)

---

## Out of scope (explicitly)

- ace-web testing
- aurora-astrology testing
- Vault script testing
- Visual regression baselines
- Performance benchmarking in CI
- Code coverage thresholds
- Pre-commit hooks
- Mutation testing
- Stress harness migration into CI (stays as on-demand local tool)

These may come later. Not now.

---

## Open questions for implementation phase

1. Should `tests/fixtures/vault/` be a flat dir or use a builder helper? (Likely flat — simpler, more debuggable.)
2. Should we add a `npm run test:ci` alias matching what CI runs locally? (Probably yes — lets you reproduce CI failures locally with one command.)
3. Should ci.yml also lint? (No — out of scope. Add later if we install a linter.)

---

## Next step

Invoke `superpowers:writing-plans` to produce a task-by-task implementation plan from this design.
