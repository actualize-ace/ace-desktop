---
name: Windows CRLF frontmatter parser fix (v0.2.2)
status: ready
created: 2026-04-17
target_release: v0.2.2
triggered_by: Craig Young call 2026-04-17 — cockpit rendered empty "Set your North Star" despite valid DCA frontmatter
severity: Windows-breaking (any client with Git autocrlf=true on Windows)
---

# Patch Plan — Windows CRLF Frontmatter Parser Fix

## Problem

On Windows, Git's default `core.autocrlf=true` rewrites LF → CRLF on checkout. Every markdown file a Windows client pulls lands on disk with `\r\n` line endings. v0.2.1's frontmatter parsers use regexes that match `\n` only, so **every frontmatter block on a Windows client fails to parse silently**, returning default/empty state.

Surfaced on Craig Young's call:
- Cockpit showed "Set your North Star" despite `00-System/core/dca.md` having valid frontmatter
- `/sync-core` slash command didn't appear in skill registry until run manually (same bug in skill discovery)

## Not triggered on

- **Mac clients** (Joe Hawley) — Git doesn't touch line endings
- **Linux clients** (Aleksander Brankov) — same; his cockpit works
- **Windows clients with `core.autocrlf=false`** — rare, requires manual config

## Root cause

Regex patterns of the shape `/^---\n([\s\S]*?)\n---/` hard-code LF. On CRLF files, the closing delimiter is `\r\n---\r\n`, which the regex can't match. The `.match()` call returns `null`, callers hit the empty-state fallback.

## Affected parsers (6 confirmed)

### Main process — `ace-desktop/src/vault-reader.js`

| Line | Function | Impact |
|------|----------|--------|
| 93 | state weekly-targets parser | Weekly targets show empty in cockpit |
| 113 | state active-section parser | Active outcomes empty |
| 235 | `parseDCAFrontmatter` | **North Star bar empty (Craig's bug)** |
| 800 | generic `parseFrontmatter` | Used for people/patterns/etc. metadata |

### Renderer — `ace-desktop/renderer/modules/`

| File | Line | Function | Impact |
|------|------|----------|--------|
| `command-registry.js` | 97 | `parseSkillFrontmatter` | Discovered skills don't appear in `/` autocomplete |
| `session-manager.js` | 259 | `parseMemoryFrontmatter` | Memory-saved cards don't render in chat |

Additional sweep likely needed for any YAML parsing in `file-watcher.js`, `dashboard.js`, and other widgets — do a final grep before shipping.

## Approach — single-point normalization at read layer

Two options considered:

**A) Fix each regex individually** (`\n` → `\r?\n` everywhere)
- Pro: explicit, no hidden behavior
- Con: 6+ regex edits, easy to miss one, each future parser re-introduces bug

**B) Normalize line endings at read time** (strip `\r` once, downstream unchanged)
- Pro: single source of truth, future parsers automatically safe, matches git's own approach
- Con: small memory cost per file read (negligible for .md files)

**Choose B.** Lower regression risk, future-proof, matches how Git itself handles `core.autocrlf`. The memory cost of one `.replace(/\r\n/g, '\n')` per read is immaterial for markdown files under 100KB.

## Implementation (incremental, per `feedback_incremental_edits_only`)

One change per commit. Test manually between each commit.

### Step 1 — add read helper in `vault-reader.js`

Add at top of file, before existing parsers:
```js
function readText(p) {
  return fs.readFileSync(p, 'utf8').replace(/\r\n/g, '\n')
}
```

### Step 2 — route all `fs.readFileSync(..., 'utf8')` in `vault-reader.js` through helper

Replace every `fs.readFileSync(somePath, 'utf8')` with `readText(somePath)`. Expected ~15–20 call sites. Grep after to confirm zero remaining direct `readFileSync(..., 'utf8')` calls in that file.

**Test:** restart Desktop on a Windows VM with a CRLF-only DCA file. Cockpit renders North Star.

### Step 3 — wrap renderer-side read bridge

In `ace-desktop/src/preload.js` (or wherever `window.ace.vault.readFile` is exposed), normalize before returning:

```js
readFile: async (relPath) => {
  const content = await ipcRenderer.invoke('vault:readFile', relPath)
  return typeof content === 'string' ? content.replace(/\r\n/g, '\n') : content
}
```

Alternatively, do the normalization in the main-process IPC handler so the renderer doesn't need patching.

**Test:** in DevTools console, re-run `window.ace.vault.readFile('00-System/core/dca.md').then(c => console.log(c.includes('\r')))`. Should return `false`.

### Step 4 — verify renderer parsers work with normalized input

With Steps 1–3 in place, `command-registry.js` and `session-manager.js` receive already-LF content, so their existing `\n` regexes match. No code change needed in those files.

**Test:**
- Skill slash commands auto-discovered appear in `/` autocomplete
- "Memory saved" card renders after saving a memory

### Step 5 — repo-wide sweep for missed parsers

```bash
cd ace-desktop
grep -rn '/\^---\\n\|\\n---\\n' src/ renderer/
```

Audit each hit. If any still exist outside the normalized read path, either route through `readText`/normalized bridge, or update the regex to `\r?\n`.

### Step 6 — bump version + changelog

`ace-desktop/package.json`: `0.2.1` → `0.2.2`.

`ace-desktop/CHANGELOG.md`:
```md
## v0.2.2 — 2026-04-17

### Fixed
- **Windows CRLF frontmatter parsing** — DCA frontmatter, skill discovery, and memory cards failed silently on Windows clients due to Git's LF → CRLF conversion. All vault-reader and renderer parsers now normalize line endings on read. (Surfaced on Craig Young onboarding call.)
```

### Step 7 — pre-tag audit (per `feedback_pretag_uncommitted_audit`)

```bash
git diff --stat HEAD -- ace-desktop/
```

Verify no orphaned CSS/HTML leftovers. Only `vault-reader.js`, preload/IPC file, `package.json`, `CHANGELOG.md`, and this plan should appear.

### Step 8 — tag + CI publish (per `feedback_release_ci_workflow`)

```bash
git tag ace-desktop-v0.2.2
git push origin ace-desktop-v0.2.2
```

CI auto-builds Mac arm64/x64 DMGs, Windows NSIS installer, Linux AppImage. Do not run `npm run dist` locally.

## Test strategy

### Manual tests (required)

Windows VM (or Craig's machine in a controlled follow-up):
1. Fresh v0.2.2 install on a vault with CRLF-only DCA → cockpit shows North Star
2. `/sync-core` → skill registry populates `/` autocomplete
3. Save a memory → memory card renders in chat
4. State widgets (weekly targets, active outcomes) show data
5. People widget shows metadata from a CRLF `Person.md` with frontmatter

Mac (regression):
1. All above work unchanged
2. No double-render, no performance regression on vault load

### Automated tests

No test harness exists in ace-desktop ([reference_ace_desktop_no_tests.md](../../../memory/reference_ace_desktop_no_tests.md)). Manual verification only for now. Consider adding a tiny `node src/vault-reader-test.js` fixture with CRLF + LF samples as a future follow-up — out of scope for v0.2.2.

## Risk + rollback

**Risks:**
- `readText` could accept a non-utf8 path and error differently than direct `fs.readFileSync`. Mitigation: helper preserves same error shape (throws identical exception from `fs.readFileSync`).
- Normalization on binary-adjacent files (rare — would need `.md` that contains embedded `\r`). Acceptable; we only call this on markdown.

**Rollback:** revert the three commits (Steps 1–3) and re-tag as v0.2.2.1. CI republishes. Windows clients on v0.2.2 would regress to v0.2.1 behavior — not worse than starting state.

## Post-ship deliverables

1. **Memory entry**: create `feedback_windows_crlf_parser_bug.md` documenting the pattern, so future parsers are written with normalization in mind from day one.
2. **Sweep Marc Cooper's vault** — he's on Windows ([reference_client_platforms.md](../../../memory/reference_client_platforms.md)). Check if his cockpit shows North Star on v0.2.2 when delivered.
3. **Operator pre-flight** — when onboarding any Windows client in the future, ship them v0.2.2+ Desktop AND verify their DCA renders before call close.

## Out of scope (tracked separately)

- `superpowers:*` colon-path bug in client vaults — needs separate investigation of where those dirs are being pulled from (likely `/build-vault` or sync-core template copy). Hits all Windows clients independently. Track in [ROADMAP.md](../../ROADMAP.md) as a separate row.
- Retroactive sweep of Marc Cooper's + Aleksander Brankov's client repos to check for `superpowers:*` remnants before their next pull.
