# Test Foundation Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Install Vitest + Playwright, add 7 unit tests + 2 e2e smoke tests, and wire CI to gate tag releases on tests passing.

**Architecture:** Two test layers co-located in `ace-desktop/tests/` — pure unit tests run on every push via `ci.yml`, full unit+e2e suite gates `ace-desktop-v*` tag releases. Three minimal runtime refactors expose functions that can't currently be imported cleanly (MODEL_CTX_LIMITS vs localStorage, parseDCAFrontmatter pure extraction for CRLF testing, userData isolation hook for e2e).

**Tech Stack:** Vitest 2.x (unit, node env), Playwright 1.48 (e2e, Electron), GitHub Actions (CI), xvfb-run (headless Electron on Linux)

---

## Important context before starting

This repo holds multiple apps. **Never `git add -A`**. Always scope `git add` to `ace-desktop/` paths only.

The codebase uses two module systems:
- `ace-desktop/src/` — CommonJS (`require` / `module.exports`)
- `ace-desktop/renderer/modules/` — ESM (`import` / `export`)

Vitest handles both natively. The configs below account for this.

`app.setName('ACE')` is at `main.js:259`. `app.whenReady()` is at `main.js:262`.

---

## Task 1: Install dev deps, add scripts, update .gitignore

**Files:**
- Modify: `ace-desktop/package.json`
- Modify: `ace-desktop/.gitignore` (create if missing)

**Step 1: Install dev dependencies**

```bash
cd ace-desktop
npm install --save-dev vitest@^2.0.0 @playwright/test@^1.48.0 playwright@^1.48.0
```

Expected: `package-lock.json` updated, `node_modules` updated. No errors.

**Step 2: Add scripts to `package.json`**

In `ace-desktop/package.json`, inside `"scripts"`:

```json
"test": "vitest run",
"test:watch": "vitest",
"test:e2e": "playwright test",
"test:all": "npm run test && npm run test:e2e"
```

**Step 3: Add to `.gitignore`** (create `ace-desktop/.gitignore` if it doesn't exist, otherwise append)

```
playwright-report/
test-results/
coverage/
```

**Step 4: Verify scripts are wired (vitest will fail — no tests yet)**

```bash
cd ace-desktop
npm test
```

Expected: `No test files found` or `0 tests passed`. Not an error.

**Step 5: Commit**

```bash
git add ace-desktop/package.json ace-desktop/package-lock.json ace-desktop/.gitignore
git commit -m "chore(ace-desktop): install vitest + playwright dev deps"
```

---

## Task 2: vitest.config.js

**Files:**
- Create: `ace-desktop/vitest.config.js`

**Step 1: Create the config**

```js
// ace-desktop/vitest.config.js
import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    include: ['tests/unit/**/*.test.js'],
    environment: 'node',
    reporters: ['verbose'],
  },
})
```

**Step 2: Verify config is valid**

```bash
cd ace-desktop
npm test
```

Expected: `No test files found` or `0 tests passed`. No config parse errors.

**Step 3: Commit**

```bash
git add ace-desktop/vitest.config.js
git commit -m "chore(ace-desktop): add vitest config"
```

---

## Task 3: playwright.config.js

**Files:**
- Create: `ace-desktop/playwright.config.js`

**Step 1: Install Playwright Chromium binary**

```bash
cd ace-desktop
npx playwright install chromium
```

Expected: Downloads Chromium (~150MB on first run). Takes 1–3 minutes.

**Step 2: Create the config**

```js
// ace-desktop/playwright.config.js
import { defineConfig } from '@playwright/test'

export default defineConfig({
  testDir: 'tests/e2e',
  testMatch: '**/*.spec.js',
  timeout: 30_000,
  retries: 1,
  workers: 1,
  reporter: 'list',
  use: {
    trace: 'on-first-retry',
  },
})
```

**Step 3: Verify config is valid**

```bash
cd ace-desktop
npm run test:e2e
```

Expected: `No tests found` or `0 passed`. No parse errors.

**Step 4: Commit**

```bash
git add ace-desktop/playwright.config.js
git commit -m "chore(ace-desktop): add playwright config"
```

---

## Task 4: Create test directory structure

**Files:**
- Create: `ace-desktop/tests/unit/.gitkeep`
- Create: `ace-desktop/tests/e2e/.gitkeep`
- Create: `ace-desktop/tests/helpers/.gitkeep`
- Create: `ace-desktop/tests/fixtures/vault/00-System/state.md`
- Create: `ace-desktop/tests/fixtures/vault/00-System/active.md`
- Create: `ace-desktop/tests/fixtures/vault/00-System/execution-log-recent.md`
- Create: `ace-desktop/tests/fixtures/vault/00-System/core/dca.md`
- Create: `ace-desktop/tests/fixtures/vault/04-Network/follow-ups.md`
- Create: `ace-desktop/tests/fixtures/README.md`

**Step 1: Create directories**

```bash
mkdir -p ace-desktop/tests/unit
mkdir -p ace-desktop/tests/e2e
mkdir -p ace-desktop/tests/helpers
mkdir -p ace-desktop/tests/fixtures/vault/00-System/core
mkdir -p ace-desktop/tests/fixtures/vault/04-Network
touch ace-desktop/tests/unit/.gitkeep
touch ace-desktop/tests/e2e/.gitkeep
touch ace-desktop/tests/helpers/.gitkeep
```

**Step 2: Create `tests/fixtures/vault/00-System/state.md`**

```markdown
## Operating Mode
execute

## Energy
high

## Open Failures
- none
```

**Step 3: Create `tests/fixtures/vault/00-System/active.md`**

```markdown
## Outcomes

### Ship test foundation
Status: in-progress

## Weekly Targets
- Build test framework
- Write seed tests
```

**Step 4: Create `tests/fixtures/vault/00-System/execution-log-recent.md`**

```markdown
## 2026-04-19

- Built test foundation design doc
- Committed design to git

## 2026-04-18

- Shipped IPC batching
- Shipped refresh engine
- Deployed v0.2.2
```

**Step 5: Create `tests/fixtures/vault/00-System/core/dca.md`**

```markdown
---
anchors:
  - Build with integrity
  - Serve with clarity
gate_date: "2026-12-31"
journey_start: "2026-01-01"
affirmations:
  - I show up fully
  - I build what matters
---

Body content here.
```

**Step 6: Create `tests/fixtures/vault/04-Network/follow-ups.md`**

```markdown
## Active

| Person | Commitment | Due | Status |
|--------|-----------|-----|--------|
| Marc Cooper | Send v0.2.2 installer | 2026-04-20 | open |
| Joe Hawley | Schedule next check-in | 2026-04-25 | open |

---

## Closed
```

**Step 7: Create `tests/fixtures/README.md`**

```markdown
# Test Fixtures

Canonical fake vault data for unit tests. Update when vault schema evolves.

## vault/

Minimal fake vault used by parser tests. Files:
- `00-System/state.md` — mode/energy/failures sample
- `00-System/active.md` — outcomes/targets sample
- `00-System/execution-log-recent.md` — 2 days of entries
- `00-System/core/dca.md` — DCA frontmatter sample
- `04-Network/follow-ups.md` — 2 active follow-ups

## Conventions

- Do NOT commit fixtures with Windows line endings (CRLF) — git may normalize them
- For CRLF tests, use inline strings in the test file itself (see `parse-dca-frontmatter.test.js`)
```

**Step 8: Commit**

```bash
git add ace-desktop/tests/
git commit -m "chore(ace-desktop): scaffold test directory + fixtures"
```

---

## Task 5: Runtime refactor — extract MODEL_CTX_LIMITS

`telemetry.js` imports `state.js`, which calls `localStorage.getItem()` at module load time. Node (Vitest env) has no `localStorage` — the import crashes. Fix: move the constant to its own file.

**Files:**
- Create: `ace-desktop/renderer/modules/model-context.js`
- Modify: `ace-desktop/renderer/modules/telemetry.js:4`
- Modify: `ace-desktop/renderer/modules/session-manager.js` (imports MODEL_CTX_LIMITS from telemetry)

**Step 1: Write the failing test first**

Create `ace-desktop/tests/unit/model-context-limits.test.js`:

```js
import { describe, it, expect } from 'vitest'
import { MODEL_CTX_LIMITS } from '../../renderer/modules/model-context.js'

describe('MODEL_CTX_LIMITS', () => {
  it('has entry for every supported model', () => {
    expect(MODEL_CTX_LIMITS).toHaveProperty('opus')
    expect(MODEL_CTX_LIMITS).toHaveProperty('sonnet')
    expect(MODEL_CTX_LIMITS).toHaveProperty('haiku')
  })

  it('all values are positive numbers', () => {
    for (const [model, limit] of Object.entries(MODEL_CTX_LIMITS)) {
      expect(typeof limit, `${model} limit should be a number`).toBe('number')
      expect(limit, `${model} limit should be positive`).toBeGreaterThan(0)
    }
  })

  it('opus has the largest context window', () => {
    expect(MODEL_CTX_LIMITS.opus).toBeGreaterThan(MODEL_CTX_LIMITS.sonnet)
  })
})
```

**Step 2: Run to verify it fails**

```bash
cd ace-desktop
npm test
```

Expected: FAIL — `Cannot find module '../../renderer/modules/model-context.js'`

**Step 3: Create `ace-desktop/renderer/modules/model-context.js`**

```js
// renderer/modules/model-context.js
export const MODEL_CTX_LIMITS = {
  opus: 1_000_000,
  sonnet: 200_000,
  haiku: 200_000,
}
```

**Step 4: Update `telemetry.js` to import from new file**

In `ace-desktop/renderer/modules/telemetry.js`, replace line 4:

Old:
```js
export const MODEL_CTX_LIMITS = { opus: 1_000_000, sonnet: 200_000, haiku: 200_000 }
```

New:
```js
export { MODEL_CTX_LIMITS } from './model-context.js'
```

**Step 5: Update `session-manager.js` import**

In `ace-desktop/renderer/modules/session-manager.js` line 3, find the import that includes `MODEL_CTX_LIMITS`. It currently imports from `telemetry.js`. Leave it — it still works via the re-export. No change needed.

**Step 6: Run tests to verify they pass**

```bash
cd ace-desktop
npm test
```

Expected: `3 tests passed`

**Step 7: Verify app still runs**

```bash
cd ace-desktop
npm start
```

Open Cockpit, open a chat, verify context meter shows a % (uses MODEL_CTX_LIMITS internally). Close app.

**Step 8: Commit**

```bash
git add ace-desktop/renderer/modules/model-context.js ace-desktop/renderer/modules/telemetry.js ace-desktop/tests/unit/model-context-limits.test.js
git commit -m "refactor(ace-desktop): extract MODEL_CTX_LIMITS to model-context.js + unit test"
```

---

## Task 6: Runtime refactor — extract parseDCAFrontmatterText

The CRLF regression test needs to call the parsing logic directly with a CRLF string, without going through the filesystem. Extract the inner parsing logic from `parseDCAFrontmatter`.

**Files:**
- Modify: `ace-desktop/src/vault-reader.js:237–330` (approximately)
- Modify: `ace-desktop/src/vault-reader.js:1031` (module.exports)

**Step 1: Write the failing test first**

Create `ace-desktop/tests/unit/parse-dca-frontmatter.test.js`:

```js
import { createRequire } from 'module'
const require = createRequire(import.meta.url)
const { parseDCAFrontmatterText } = require('../../src/vault-reader.js')

import { describe, it, expect } from 'vitest'

const LF_DCA = `---
anchors:
  - Build with integrity
gate_date: "2026-12-31"
journey_start: "2026-01-01"
affirmations:
  - I show up fully
---

Body text.`

// Same content with Windows CRLF line endings — this is what the v0.2.2 bug looked like
const CRLF_DCA = LF_DCA.replace(/\n/g, '\r\n')

describe('parseDCAFrontmatterText', () => {
  it('parses LF frontmatter correctly', () => {
    const result = parseDCAFrontmatterText(LF_DCA)
    expect(result.anchors).toEqual(['Build with integrity'])
    expect(result.gate_date).toBe('2026-12-31')
    expect(result.journey_start).toBe('2026-01-01')
    expect(result.affirmations).toEqual(['I show up fully'])
  })

  it('CRLF input produces same result as LF input', () => {
    const lf = parseDCAFrontmatterText(LF_DCA)
    const crlf = parseDCAFrontmatterText(CRLF_DCA)
    expect(crlf.anchors).toEqual(lf.anchors)
    expect(crlf.gate_date).toEqual(lf.gate_date)
    expect(crlf.journey_start).toEqual(lf.journey_start)
    expect(crlf.affirmations).toEqual(lf.affirmations)
  })

  it('returns default frontmatter when no YAML block present', () => {
    const result = parseDCAFrontmatterText('Just plain text, no frontmatter.')
    expect(result).toHaveProperty('anchors')
    expect(Array.isArray(result.anchors)).toBe(true)
  })
})
```

**Step 2: Run to verify it fails**

```bash
cd ace-desktop
npm test
```

Expected: FAIL — `parseDCAFrontmatterText is not a function`

**Step 3: Extract the function in `vault-reader.js`**

Find `function parseDCAFrontmatter(vaultPath)` at line 237. Extract its inner parsing logic into a new pure function placed ABOVE it:

```js
// Pure text parser — takes pre-loaded DCA file text, returns parsed object.
// Called by parseDCAFrontmatter (which handles file I/O) and directly in tests.
function parseDCAFrontmatterText(text, filePath) {
  const fmMatch = text.match(/^---\r?\n([\s\S]*?)\r?\n---\r?\n?/)
  const bodyText = fmMatch ? text.slice(fmMatch[0].length).trim() : text.trim()
  if (!fmMatch) return { ...defaultDCAFrontmatter(), body: bodyText, filePath }

  const lines = fmMatch[1].split(/\r?\n/)
  const result = {
    north_star_anchors: [],
    gate_date: null,
    journey_start: null,
    affirmations: [],
    compass_directions: defaultCompassDirections(),
  }

  let currentList = null
  let currentDirection = null
  let currentDirField = null

  for (const raw of lines) {
    const line = raw.replace(/\r$/, '')
    if (!line.trim()) continue

    const scalar = line.match(/^([a-z_]+):\s*(.+)$/)
    if (scalar) {
      const [, key, val] = scalar
      if (key === 'gate_date') result.gate_date = val.trim()
      else if (key === 'journey_start') result.journey_start = val.trim()
      currentList = null
      currentDirection = null
      currentDirField = null
      continue
    }

    // ... (copy the remainder of the existing parseDCAFrontmatter loop body here)
  }

  // Map north_star_anchors → anchors for backwards compat
  result.anchors = result.north_star_anchors

  return { ...result, body: bodyText, filePath }
}
```

Then update `parseDCAFrontmatter(vaultPath)` to call the new function:

```js
function parseDCAFrontmatter(vaultPath) {
  try {
    const dcaPath = path.join(vaultPath, '00-System', 'core', 'dca.md')
    const text = readText(dcaPath)
    return parseDCAFrontmatterText(text, dcaPath)
  } catch (e) {
    return { ...defaultDCAFrontmatter(), error: e.message }
  }
}
```

> **Note:** The existing function body is ~70 lines. Copy it faithfully into `parseDCAFrontmatterText`. Do not alter the logic — only restructure the function boundary. The CRLF robustness change is: update the frontmatter regex from `/^---\n([\s\S]*?)\n---\n?/` to `/^---\r?\n([\s\S]*?)\r?\n---\r?\n?/` and update `fmMatch[1].split('\n')` to `fmMatch[1].split(/\r?\n/)` so CRLF files are handled even without the `readText` normalization.

**Step 4: Export the new function**

In `vault-reader.js:1031`, add `parseDCAFrontmatterText` to `module.exports`:

```js
module.exports = { parseState, parseFollowUps, listDir, parseExecutionLog, parseRitualRhythm, parsePeople, parseArtifacts, getArtifactDetail, updateArtifactStatus, parsePatterns, parseDCAFrontmatter, parseDCAFrontmatterText, parseDailyFocus, parseRecoveryFlag, parseBuildBlocks, parseLastPulse, parseRitualStreak, parseCadence }
```

**Step 5: Run tests to verify they pass**

```bash
cd ace-desktop
npm test
```

Expected: `6 tests passed` (3 from Task 5 + 3 new)

**Step 6: Verify app still runs**

```bash
cd ace-desktop
npm start
```

Open Cockpit. Verify DCA/compass renders correctly. Close app.

**Step 7: Commit**

```bash
git add ace-desktop/src/vault-reader.js ace-desktop/tests/unit/parse-dca-frontmatter.test.js
git commit -m "refactor(ace-desktop): extract parseDCAFrontmatterText + CRLF unit test (pins v0.2.2 fix)"
```

---

## Task 7: Runtime refactor — main.js userData isolation

Without this, e2e tests corrupt your live `~/Library/Application Support/ACE/ace-config.json` every time they run.

**Files:**
- Modify: `ace-desktop/main.js:259–262`

**Step 1: Add the hook**

In `main.js`, between `app.setName('ACE')` (line 259) and `app.whenReady()` (line 262), insert:

```js
// Isolate userData so e2e tests don't corrupt the live config
if (process.env.ACE_TEST_MODE === '1') {
  const os = require('os')
  app.setPath('userData', require('path').join(os.tmpdir(), `ace-test-${Date.now()}`))
}
```

**Step 2: Verify app still runs normally (without env var)**

```bash
cd ace-desktop
npm start
```

Expected: app boots normally, reads live config. No change in behaviour.

**Step 3: Verify isolation works with env var**

```bash
cd ace-desktop
ACE_TEST_MODE=1 npm start
```

Expected: app boots, but any settings changes write to a temp dir (not `~/Library/Application Support/ACE/`). Close app.

**Step 4: Commit**

```bash
git add ace-desktop/main.js
git commit -m "fix(ace-desktop): add ACE_TEST_MODE userData isolation for e2e tests"
```

---

## Task 8: Unit test — boundary scanner

**Files:**
- Create: `ace-desktop/tests/unit/boundary-scanner.test.js`

**Step 1: Write the test**

```js
import { describe, it, expect } from 'vitest'
import {
  findSettledBoundary,
  findSettledBoundaryFrom,
} from '../../renderer/modules/chat-renderer.js'

describe('findSettledBoundary', () => {
  it('returns 0 for empty string', () => {
    expect(findSettledBoundary('')).toBe(0)
  })

  it('returns 0 for partial paragraph (no double newline)', () => {
    expect(findSettledBoundary('Hello world')).toBe(0)
  })

  it('returns boundary at completed paragraph', () => {
    const text = 'First paragraph.\n\nSecond paragraph in progress'
    const boundary = findSettledBoundary(text)
    expect(boundary).toBeGreaterThan(0)
    expect(boundary).toBeLessThanOrEqual(text.indexOf('\n\nSecond') + 2)
  })

  it('returns full length for text ending with double newline', () => {
    const text = 'Complete paragraph.\n\n'
    const boundary = findSettledBoundary(text)
    expect(boundary).toBeGreaterThan(0)
  })
})

describe('findSettledBoundaryFrom', () => {
  it('delegates to findSettledBoundary when prevBoundary is 0', () => {
    const text = 'Hello world'
    expect(findSettledBoundaryFrom(text, 0)).toBe(findSettledBoundary(text))
  })

  it('delegates to findSettledBoundary when prevBoundary is null', () => {
    const text = 'Hello world'
    expect(findSettledBoundaryFrom(text, null)).toBe(findSettledBoundary(text))
  })

  it('scans forward from prevBoundary, not from 0', () => {
    const text = 'First.\n\nSecond.\n\nThird in progress'
    const first = findSettledBoundary(text)
    const second = findSettledBoundaryFrom(text, first)
    expect(second).toBeGreaterThanOrEqual(first)
  })
})
```

**Step 2: Run tests**

```bash
cd ace-desktop
npm test
```

Expected: all previous tests pass + 7 new tests pass (total ~13 passing)

**Step 3: Commit**

```bash
git add ace-desktop/tests/unit/boundary-scanner.test.js
git commit -m "test(ace-desktop): boundary scanner unit tests"
```

---

## Task 9: Unit test — string utilities

**Files:**
- Create: `ace-desktop/tests/unit/string-utils.test.js`

**Step 1: Write the test**

```js
import { describe, it, expect } from 'vitest'
import { escapeHtml, processWikilinks } from '../../renderer/modules/chat-renderer.js'

describe('escapeHtml', () => {
  it('passes through plain text unchanged', () => {
    expect(escapeHtml('hello world')).toBe('hello world')
  })

  it('escapes < and >', () => {
    expect(escapeHtml('<script>')).toBe('&lt;script&gt;')
  })

  it('escapes ampersand', () => {
    expect(escapeHtml('a & b')).toBe('a &amp; b')
  })

  it('escapes double quotes', () => {
    expect(escapeHtml('"hello"')).toBe('&quot;hello&quot;')
  })
})

describe('processWikilinks', () => {
  it('returns text unchanged when no wikilinks present', () => {
    expect(processWikilinks('plain text')).toBe('plain text')
  })

  it('converts [[target]] to a link', () => {
    const result = processWikilinks('See [[some-note]] for details')
    expect(result).toContain('some-note')
    expect(result).not.toContain('[[')
    expect(result).not.toContain(']]')
  })

  it('converts [[target|label]] using display label', () => {
    const result = processWikilinks('See [[path/to/note|Display Name]] here')
    expect(result).toContain('Display Name')
    expect(result).not.toContain('[[')
  })

  it('handles multiple wikilinks in one string', () => {
    const result = processWikilinks('See [[note-a]] and [[note-b]]')
    expect(result).toContain('note-a')
    expect(result).toContain('note-b')
  })
})
```

**Step 2: Run tests**

```bash
cd ace-desktop
npm test
```

Expected: 8 new tests pass on top of existing

**Step 3: Commit**

```bash
git add ace-desktop/tests/unit/string-utils.test.js
git commit -m "test(ace-desktop): escapeHtml + processWikilinks unit tests"
```

---

## Task 10: Unit test — permissions

**Files:**
- Create: `ace-desktop/tests/unit/permissions.test.js`

**Step 1: Write the test**

Note: `addAllow` reads/writes files. Use `os.tmpdir()` for an isolated scratch dir per test.

```js
import { createRequire } from 'module'
const require = createRequire(import.meta.url)
const { addAllow } = require('../../src/permissions.js')

import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import fs from 'fs'
import os from 'os'
import path from 'path'

let tmpDir

beforeEach(() => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ace-test-perms-'))
})

afterEach(() => {
  fs.rmSync(tmpDir, { recursive: true, force: true })
})

describe('addAllow', () => {
  it('creates settings.local.json with the pattern when file does not exist', () => {
    const result = addAllow(tmpDir, 'npm run test')
    expect(result.ok).toBe(true)
    expect(result.alreadyPresent).toBe(false)

    const file = path.join(tmpDir, '.claude', 'settings.local.json')
    const data = JSON.parse(fs.readFileSync(file, 'utf8'))
    expect(data.permissions.allow).toContain('npm run test')
  })

  it('is idempotent — adding same pattern twice does not duplicate', () => {
    addAllow(tmpDir, 'npm run test')
    const result = addAllow(tmpDir, 'npm run test')
    expect(result.ok).toBe(true)
    expect(result.alreadyPresent).toBe(true)

    const file = path.join(tmpDir, '.claude', 'settings.local.json')
    const data = JSON.parse(fs.readFileSync(file, 'utf8'))
    expect(data.permissions.allow.filter(p => p === 'npm run test').length).toBe(1)
  })

  it('appends to existing allow list without overwriting', () => {
    addAllow(tmpDir, 'npm run test')
    addAllow(tmpDir, 'npm run build')

    const file = path.join(tmpDir, '.claude', 'settings.local.json')
    const data = JSON.parse(fs.readFileSync(file, 'utf8'))
    expect(data.permissions.allow).toContain('npm run test')
    expect(data.permissions.allow).toContain('npm run build')
  })

  it('returns error for invalid vaultPath', () => {
    const result = addAllow('', 'npm run test')
    expect(result.ok).toBe(false)
    expect(result.error).toBe('invalid-vault-path')
  })

  it('returns error for invalid pattern', () => {
    const result = addAllow(tmpDir, '')
    expect(result.ok).toBe(false)
    expect(result.error).toBe('invalid-pattern')
  })
})
```

**Step 2: Run tests**

```bash
cd ace-desktop
npm test
```

Expected: 5 new tests pass

**Step 3: Commit**

```bash
git add ace-desktop/tests/unit/permissions.test.js
git commit -m "test(ace-desktop): permissions.addAllow unit tests"
```

---

## Task 11: Unit test — follow-ups parser

**Files:**
- Create: `ace-desktop/tests/unit/parse-follow-ups.test.js`

**Step 1: Write the test**

```js
import { createRequire } from 'module'
const require = createRequire(import.meta.url)
const { parseFollowUps } = require('../../src/vault-reader.js')

import { describe, it, expect } from 'vitest'
import path from 'path'
import { fileURLToPath } from 'url'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const FIXTURE_VAULT = path.join(__dirname, '../fixtures/vault')

describe('parseFollowUps', () => {
  it('returns an array', () => {
    const result = parseFollowUps(FIXTURE_VAULT)
    expect(Array.isArray(result)).toBe(true)
  })

  it('parses follow-up entries from fixture vault', () => {
    const result = parseFollowUps(FIXTURE_VAULT)
    expect(result.length).toBeGreaterThan(0)
  })

  it('each entry has person, commitment, due, status fields', () => {
    const result = parseFollowUps(FIXTURE_VAULT)
    for (const entry of result) {
      expect(entry).toHaveProperty('person')
      expect(entry).toHaveProperty('commitment')
    }
  })

  it('returns empty array for vault with no follow-ups file', () => {
    const result = parseFollowUps('/nonexistent/path')
    expect(Array.isArray(result)).toBe(true)
    expect(result.length).toBe(0)
  })
})
```

**Step 2: Run tests**

```bash
cd ace-desktop
npm test
```

Expected: 4 new tests pass

**Step 3: Commit**

```bash
git add ace-desktop/tests/unit/parse-follow-ups.test.js
git commit -m "test(ace-desktop): parseFollowUps unit tests"
```

---

## Task 12: Unit test — execution log parser

**Files:**
- Create: `ace-desktop/tests/unit/parse-execution-log.test.js`

**Step 1: Write the test**

```js
import { createRequire } from 'module'
const require = createRequire(import.meta.url)
const { parseExecutionLog } = require('../../src/vault-reader.js')

import { describe, it, expect } from 'vitest'
import path from 'path'
import { fileURLToPath } from 'url'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const FIXTURE_VAULT = path.join(__dirname, '../fixtures/vault/00-System')

describe('parseExecutionLog', () => {
  it('returns byDay, totalThisWeek, totalLastWeek', () => {
    // parseExecutionLog takes vaultPath where log files live at top level of that dir
    // fixture log is at 00-System/execution-log-recent.md so pass 00-System as vaultPath substitute
    const result = parseExecutionLog(path.join(__dirname, '../fixtures/vault'))
    expect(result).toHaveProperty('byDay')
    expect(result).toHaveProperty('totalThisWeek')
    expect(result).toHaveProperty('totalLastWeek')
  })

  it('byDay is an object with date string keys', () => {
    const result = parseExecutionLog(path.join(__dirname, '../fixtures/vault'))
    const keys = Object.keys(result.byDay)
    expect(keys.length).toBeGreaterThan(0)
    for (const key of keys) {
      expect(key).toMatch(/^\d{4}-\d{2}-\d{2}$/)
    }
  })

  it('returns safe empty result for nonexistent vault path', () => {
    const result = parseExecutionLog('/nonexistent/vault')
    expect(result.byDay).toEqual({})
    expect(result.totalThisWeek).toBe(0)
    expect(result.totalLastWeek).toBe(0)
  })
})
```

**Step 2: Run tests**

```bash
cd ace-desktop
npm test
```

Expected: 3 new tests pass

**Step 3: Commit**

```bash
git add ace-desktop/tests/unit/parse-execution-log.test.js
git commit -m "test(ace-desktop): parseExecutionLog unit tests"
```

---

## Task 13: Create e2e launch-app helper

**Files:**
- Create: `ace-desktop/tests/helpers/launch-app.js`

**Step 1: Create the helper**

```js
// tests/helpers/launch-app.js
// Boots the real Electron app in test mode (isolated userData, no live config).
import { _electron as electron } from '@playwright/test'
import path from 'path'
import { fileURLToPath } from 'url'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const APP_ROOT = path.join(__dirname, '../../')

export async function launchApp() {
  const app = await electron.launch({
    args: [path.join(APP_ROOT, 'main.js')],
    env: {
      ...process.env,
      ACE_TEST_MODE: '1',
      NODE_ENV: 'test',
    },
  })

  const window = await app.firstWindow()
  // Give the renderer time to initialize
  await window.waitForLoadState('domcontentloaded')

  return { app, window }
}

export async function closeApp(app) {
  await app.close()
}
```

**Step 2: Verify helper is importable (no syntax errors)**

```bash
cd ace-desktop
node --input-type=module --eval "import './tests/helpers/launch-app.js'; console.log('OK')"
```

Expected: `OK`

**Step 3: Commit**

```bash
git add ace-desktop/tests/helpers/launch-app.js
git commit -m "test(ace-desktop): add e2e launch-app helper with ACE_TEST_MODE isolation"
```

---

## Task 14: E2E smoke test — app boots

**Files:**
- Create: `ace-desktop/tests/e2e/app-boots.spec.js`

**Step 1: Write the test**

```js
// tests/e2e/app-boots.spec.js
import { test, expect } from '@playwright/test'
import { launchApp, closeApp } from '../helpers/launch-app.js'

test.describe('App boot', () => {
  let app, window

  test.beforeEach(async () => {
    ;({ app, window } = await launchApp())
  })

  test.afterEach(async () => {
    await closeApp(app)
  })

  test('main window opens within 5 seconds', async () => {
    expect(window).toBeTruthy()
    await expect(window).toHaveTitle(/ACE/)
  })

  test('cockpit view is present in DOM', async () => {
    // Wait up to 5s for the main view container
    await window.waitForSelector('#view-cockpit, [data-view="cockpit"], .view', {
      timeout: 5000,
    })
  })
})
```

**Step 2: Run the e2e tests**

```bash
cd ace-desktop
npm run test:e2e
```

Expected: 2 tests pass. If they time out, check that `ACE_TEST_MODE=1` is being passed — the app may be hanging waiting for a real vault config.

If the selector `#view-cockpit` doesn't exist, inspect the DOM: add `await window.screenshot({ path: 'test-results/debug.png' })` before the assertion and check the screenshot to find the correct selector.

**Step 3: Commit**

```bash
git add ace-desktop/tests/e2e/app-boots.spec.js
git commit -m "test(ace-desktop): e2e smoke — app boots and cockpit renders"
```

---

## Task 15: E2E smoke test — view switching

**Files:**
- Create: `ace-desktop/tests/e2e/view-switching.spec.js`

**Step 1: Identify the nav selectors**

Before writing the test, run the app and inspect the nav items to get correct selectors:

```bash
cd ace-desktop
npm start
```

Open DevTools (Cmd+Option+I), inspect the sidebar nav buttons. Note their `id` or `data-view` attributes. They likely look like `[data-view="build"]`, `[data-view="studio"]`, etc. Or they may be `#nav-build`, `#nav-studio`.

**Step 2: Write the test (update selectors to match what you found in Step 1)**

```js
// tests/e2e/view-switching.spec.js
import { test, expect } from '@playwright/test'
import { launchApp, closeApp } from '../helpers/launch-app.js'

// Update these selectors to match actual DOM after inspecting in Step 1
const NAV_ITEMS = [
  { navSelector: '[data-nav="cockpit"]',  viewSelector: '[data-view="cockpit"]'  },
  { navSelector: '[data-nav="build"]',    viewSelector: '[data-view="build"]'    },
  { navSelector: '[data-nav="studio"]',   viewSelector: '[data-view="studio"]'   },
  { navSelector: '[data-nav="graph"]',    viewSelector: '[data-view="graph"]'    },
  { navSelector: '[data-nav="people"]',   viewSelector: '[data-view="people"]'   },
  { navSelector: '[data-nav="coach"]',    viewSelector: '[data-view="coach"]'    },
]

test.describe('View switching', () => {
  let app, window

  test.beforeEach(async () => {
    ;({ app, window } = await launchApp())
    // Wait for app to fully initialize before clicking nav
    await window.waitForTimeout(1000)
  })

  test.afterEach(async () => {
    await closeApp(app)
  })

  for (const { navSelector, viewSelector } of NAV_ITEMS) {
    test(`clicking ${navSelector} activates ${viewSelector}`, async () => {
      await window.click(navSelector)
      await window.waitForSelector(`${viewSelector}.active, ${viewSelector}[style*="display"]`, {
        timeout: 3000,
      })
    })
  }
})
```

**Step 3: Run tests**

```bash
cd ace-desktop
npm run test:e2e
```

Expected: 6 new tests pass (one per nav item). If selectors are wrong, update `NAV_ITEMS` based on what you found in Step 1.

**Step 4: Commit**

```bash
git add ace-desktop/tests/e2e/view-switching.spec.js
git commit -m "test(ace-desktop): e2e smoke — view switching covers all 6 nav items"
```

---

## Task 16: Add tests/README.md

**Files:**
- Create: `ace-desktop/tests/README.md`

**Step 1: Create the file**

```markdown
# ACE Desktop Tests

## Running tests

```bash
npm test              # Unit tests only (~30s)
npm run test:watch    # Unit tests in watch mode
npm run test:e2e      # E2E smoke tests (~3–5 min, requires display)
npm run test:all      # Both suites
```

## Unit tests (`tests/unit/`)

Run via Vitest in Node environment. Cover pure logic — parsers, string utilities, constants.

File naming: `*.test.js`

### To add a new unit test

1. Create `tests/unit/<what-you-are-testing>.test.js`
2. Import the function under test using `createRequire` for CommonJS src files, direct ESM `import` for renderer modules
3. Run `npm test` — new file is picked up automatically

## E2E smoke tests (`tests/e2e/`)

Run via Playwright against the real Electron app. Cover user flows — boots, navigation.

File naming: `*.spec.js`

Requires a display. On CI this is handled via `xvfb-run`. Locally just run `npm run test:e2e`.

### To add a new e2e test

1. Create `tests/e2e/<what-you-are-testing>.spec.js`
2. Use `launchApp` / `closeApp` from `tests/helpers/launch-app.js`
3. The app runs with `ACE_TEST_MODE=1` — userData is isolated to a temp dir

## Fixtures (`tests/fixtures/`)

See `tests/fixtures/README.md`. Update when vault schema evolves.

## Conventions

- `*.test.js` = Vitest unit tests
- `*.spec.js` = Playwright e2e tests
- CRLF tests use inline strings, NOT fixture files (git may normalize line endings in fixtures)
- Write the failing test before implementing — even for refactors
```

**Step 2: Commit**

```bash
git add ace-desktop/tests/README.md
git commit -m "docs(ace-desktop): add tests/README with how-to guide for adding new tests"
```

---

## Task 17: CI — ci.yml

**Files:**
- Create: `.github/workflows/ci.yml`

**Step 1: Create the workflow**

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
    name: Unit Tests
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

**Step 2: Commit and push to verify CI triggers**

```bash
git add .github/workflows/ci.yml
git commit -m "ci: add unit test workflow — runs on every push to main"
git push origin main
```

Expected: Go to `github.com/<your-repo>/actions` — you should see a `CI` workflow run appear within 30 seconds. It should pass green.

If it fails, check the Actions log. Common issues:
- `npm ci` fails — lockfile out of sync, run `npm install` locally and commit the updated lockfile
- Module not found — check that vitest is in devDependencies in package.json

**Note:** This workflow only REPORTS status. It does not gate merges. You can enable branch protection later via GitHub repo Settings → Branches → Require status checks. Do this after 1 week of CI proving stable.

---

## Task 18: CI — gate releases on tests

**Files:**
- Modify: `.github/workflows/release.yml`

**Step 1: Dry run first — verify the test job works in isolation**

Before modifying the release workflow, push a dry-run tag to test it:

```bash
git tag ace-desktop-v0.0.0-cidry
git push origin ace-desktop-v0.0.0-cidry
```

Watch Actions. If it triggers the current release workflow and builds successfully, proceed. Then delete the tag:

```bash
git push origin --delete ace-desktop-v0.0.0-cidry
git tag -d ace-desktop-v0.0.0-cidry
```

**Step 2: Add `workflow_dispatch` trigger and new `test` job to `release.yml`**

At the top of `release.yml`, find the `on:` block. Add `workflow_dispatch:` (allows re-running releases without retag):

```yaml
on:
  push:
    tags:
      - 'ace-desktop-v*'
  workflow_dispatch:
    inputs:
      reason:
        description: 'Reason for manual re-run'
        required: false
        default: 'retry'
```

Add a new `test` job BEFORE the `build-mac` and `build-windows` jobs:

```yaml
  test:
    name: Test Gate
    runs-on: ubuntu-latest
    timeout-minutes: 12

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
        run: npx playwright install chromium --with-deps

      - name: Run unit tests
        working-directory: ace-desktop
        run: npm test

      - name: Run e2e smoke tests
        working-directory: ace-desktop
        run: xvfb-run --auto-servernum npm run test:e2e
```

Add `needs: test` to BOTH `build-mac` and `build-windows` jobs:

```yaml
  build-mac:
    needs: test        # ← add this line
    runs-on: macos-latest
    # ... rest unchanged

  build-windows:
    needs: test        # ← add this line
    runs-on: windows-latest
    # ... rest unchanged
```

**Step 3: Commit and push**

```bash
git add .github/workflows/release.yml
git commit -m "ci: gate tag releases on unit + e2e tests before building installers"
git push origin main
```

**Step 4: Verify with a real test tag**

```bash
git tag ace-desktop-v0.2.3-test
git push origin ace-desktop-v0.2.3-test
```

Watch Actions. You should see: `test` job runs → if passes → `build-mac` and `build-windows` start. Delete the tag and its release after verifying:

```bash
git push origin --delete ace-desktop-v0.2.3-test
git tag -d ace-desktop-v0.2.3-test
```

Also manually delete the draft release from GitHub Releases UI if one was created.

---

## Task 19: CI badge in README

**Files:**
- Modify: `ace-desktop/README.md`

**Step 1: Add the badge**

At the top of `ace-desktop/README.md`, after the title, add:

```markdown
![CI](https://github.com/<your-org>/<your-repo>/actions/workflows/ci.yml/badge.svg)
```

Replace `<your-org>/<your-repo>` with your actual GitHub repo path.

**Step 2: Commit**

```bash
git add ace-desktop/README.md
git commit -m "docs(ace-desktop): add CI status badge"
git push origin main
```

---

## Verification checklist

Before declaring done, verify all of these:

- [ ] `npm test` runs in <60s and all tests pass
- [ ] `npm run test:e2e` launches real Electron app, both smoke tests pass
- [ ] `npm run test:all` runs both suites clean
- [ ] Pushing to `main` triggers `ci.yml` and it goes green in GitHub Actions
- [ ] Creating an `ace-desktop-v*` tag triggers the `test` job before build jobs
- [ ] App still boots normally with `npm start` (no regression)
- [ ] `~/Library/Application Support/ACE/ace-config.json` is NOT modified after running `npm run test:e2e`

---

## What's deliberately not here

- Branch protection (enable manually in GitHub UI after 1 week of stable CI)
- Windows e2e runner (add if Windows-specific bugs surface)
- Code coverage thresholds
- Pre-commit hooks
- Linting
- ace-web or aurora tests
- Stress harness migration into CI

These are explicitly out of scope. Do not add them during this sprint.
