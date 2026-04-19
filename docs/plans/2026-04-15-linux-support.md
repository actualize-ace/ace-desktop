# Linux Support (AppImage) Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Ship `ace-desktop` v0.2.1 with Linux x64 AppImage built and published by the CI workflow on every `ace-desktop-v*` tag, so Aleksander Brankov can install ACE on Linux with the same flow as Mac/Windows users.

**Architecture:** Add a `build-linux` job to the existing `.github/workflows/release.yml` matrix (already does Mac arm64, Mac x64, Windows NSIS in parallel). Extend each binary-detection site in `ace-desktop/src/` from a two-way `win32` vs. `else (assumed Mac)` branch to a three-way `win32` | `darwin` | `linux` branch covering Linux package manager / version manager install paths. Add `linux` target to electron-builder config. AppImage only — no deb/rpm/snap/flatpak this round.

**Tech Stack:** electron-builder 24.13.3, GitHub Actions (`ubuntu-latest`), node 20, AppImage runtime, FUSE2 (host requirement, documented).

**Test target:** Aleksander Brankov, due 2026-04-21.

**Key constraints:**
- ace-desktop has **no test framework** — verification is `node -c <file>` syntax check + `npm start` manual smoke + CI green + AppImage launch + Aleksander's report. No Jest/Mocha exists; do not invent one.
- ace-desktop sits inside the multi-app vault repo. **Never `git add -A` or `git add .`** — every commit scopes paths to `ace-desktop/` or `.github/workflows/`.
- One change at a time. Smoke-test between every edit (`feedback_incremental_edits_only.md`).
- DRY note: the augmented-PATH array now appears in 4 files. Extracting a shared helper is **out of scope for this plan** — track as separate refactor (see Out of Scope at bottom).
- Tagging + pushing requires **explicit user "ship it" approval**. Do not tag on directional agreement (`feedback_explicit_permission_required.md`).

---

## Task 0: Confirm baseline + branch

**Files:** none (git only)

**Step 1: Verify working tree clean except for sketch + this plan**

Run: `git status --short ace-desktop/ .github/`
Expected output: only the new plan file under `ace-desktop/docs/plans/` (and possibly the sketch if not yet deleted). Nothing else modified.

**Step 2: Confirm baseline build works on current platform**

Run: `cd ace-desktop && npm start`
Expected: app window opens, dashboard renders, no console errors. Close it (Cmd-Q).
Why: catches "broken before I started" so we don't blame Linux work for pre-existing breakage.

**Step 3: Create feature branch**

Run: `git checkout -b ace-desktop-linux-support`
Expected: `Switched to a new branch 'ace-desktop-linux-support'`

**Step 4: No commit yet** — proceed to Task 1.

---

## Task 1: Add Linux target to electron-builder config

**Files:**
- Modify: [ace-desktop/package.json:32-64](../../package.json#L32-L64) — `build` block

**Step 1: Edit `package.json` to add `linux` block**

Insert the `linux` block immediately after the existing `win` block (and before `nsis`). The full `build` block becomes:

```json
"build": {
  "appId": "io.asraya.ace-desktop",
  "productName": "ACE",
  "mac": {
    "category": "public.app-category.productivity",
    "target": "dmg",
    "icon": "assets/ace.icns",
    "artifactName": "ACE-${version}-${arch}.${ext}"
  },
  "win": {
    "target": "nsis",
    "icon": "assets/ace.ico",
    "artifactName": "ACE-${version}-${arch}.${ext}"
  },
  "linux": {
    "target": ["AppImage"],
    "category": "Office",
    "icon": "assets/ace.png",
    "artifactName": "ACE-${version}-${arch}.${ext}"
  },
  "nsis": { ... unchanged ... },
  "extraResources": [ ... unchanged ... ],
  "files": [ ... unchanged ... ]
}
```

**Step 2: Verify JSON is valid**

Run: `node -e "JSON.parse(require('fs').readFileSync('ace-desktop/package.json','utf8'))" && echo OK`
Expected: `OK`

**Step 3: Verify electron-builder accepts the config (dry parse)**

Run: `cd ace-desktop && npx electron-builder --help >/dev/null && echo "builder reachable"`
Expected: `builder reachable`. (Cannot fully validate Linux build on macOS without Docker; CI is the real validator.)

**Step 4: Commit**

```bash
git add ace-desktop/package.json
git commit -m "feat(ace-desktop): add linux AppImage target to electron-builder config"
```

---

## Task 2: Three-way platform branch in `pty-manager.js`

**Files:**
- Modify: [ace-desktop/src/pty-manager.js:15-20](../../src/pty-manager.js#L15-L20) (in `create`)
- Modify: [ace-desktop/src/pty-manager.js:82-87](../../src/pty-manager.js#L82-L87) (in `resume`)

**Background:** Both sites currently build `augmentedPath` from `['/opt/homebrew/bin', '/usr/local/bin', '/usr/bin', process.env.PATH || '']`. Linux falls through but misses `~/.local/bin`, `/snap/bin`, and node version managers.

**Step 1: Add helper at top of file (after `const sessions = new Map()` on line 5)**

Insert:

```javascript
const path = require('path')
const os = require('os')

function getAugmentedPath() {
  const home = os.homedir()
  if (process.platform === 'win32') {
    return [
      path.join(process.env.APPDATA || '', 'npm'),
      path.join(process.env.LOCALAPPDATA || '', 'Programs', 'nodejs'),
      process.env.PATH || '',
    ].filter(Boolean).join(';')
  }
  if (process.platform === 'darwin') {
    return [
      '/opt/homebrew/bin',
      '/usr/local/bin',
      '/usr/bin',
      process.env.PATH || '',
    ].filter(Boolean).join(':')
  }
  // linux (and other unix)
  return [
    '/usr/local/bin',
    '/usr/bin',
    '/snap/bin',
    path.join(home, '.local', 'bin'),
    path.join(home, '.nvm', 'versions', 'node', 'current', 'bin'),
    path.join(home, '.volta', 'bin'),
    path.join(home, '.local', 'share', 'fnm', 'aliases', 'default', 'bin'),
    path.join(home, '.local', 'share', 'mise', 'shims'),
    path.join(home, '.asdf', 'shims'),
    process.env.PATH || '',
  ].filter(Boolean).join(':')
}
```

Note: this helper is **file-local** — not extracted to a shared module. See "Out of Scope" at the bottom.

**Step 2: Replace both `augmentedPath` blocks with `const augmentedPath = getAugmentedPath()`**

In `create()` lines 15-20, replace:
```javascript
const augmentedPath = [
  '/opt/homebrew/bin',
  '/usr/local/bin',
  '/usr/bin',
  process.env.PATH || '',
].filter(Boolean).join(process.platform === 'win32' ? ';' : ':')
```
with:
```javascript
const augmentedPath = getAugmentedPath()
```

Repeat in `resume()` lines 82-87.

**Step 3: Syntax check**

Run: `node -c ace-desktop/src/pty-manager.js && echo OK`
Expected: `OK`

**Step 4: Smoke-test on current platform**

Run: `cd ace-desktop && npm start`
Open Agent Terminal (left rail icon → spawn Claude session). Type a prompt, get a response. Close window.
Expected: PTY session spawns and streams output normally on macOS — no regression.

**Step 5: Commit**

```bash
git add ace-desktop/src/pty-manager.js
git commit -m "refactor(ace-desktop): three-way platform branch for PATH augmentation in pty-manager"
```

---

## Task 3: Three-way platform branch in `preflight.js`

**Files:**
- Modify: [ace-desktop/src/preflight.js:23-41](../../src/preflight.js#L23-L41)

**Background:** `checkBinary` builds `augmentedPath` with a `win32` vs. else branch. The `else` is currently Mac-flavored (`/opt/homebrew/bin` first) but used for Linux too.

**Step 1: Replace the `augmentedPath` ternary**

Currently:
```javascript
const home = require('os').homedir()
const augmentedPath = process.platform === 'win32'
  ? [
      path.join(process.env.APPDATA || '', 'npm'),
      path.join(process.env.LOCALAPPDATA || '', 'Programs', 'nodejs'),
      process.env.PATH || '',
    ].filter(Boolean).join(';')
  : [
      '/opt/homebrew/bin',
      '/usr/local/bin',
      '/usr/bin',
      path.join(home, '.nvm', 'versions', 'node', 'current', 'bin'),
      path.join(home, '.volta', 'bin'),
      path.join(home, '.fnm', 'aliases', 'default', 'bin'),
      path.join(home, '.local', 'share', 'mise', 'shims'),
      path.join(home, '.asdf', 'shims'),
      path.join(home, '.local', 'bin'),
      process.env.PATH || '',
    ].filter(Boolean).join(':')
```

Replace with three-way branch:

```javascript
const home = require('os').homedir()
let augmentedPath
if (process.platform === 'win32') {
  augmentedPath = [
    path.join(process.env.APPDATA || '', 'npm'),
    path.join(process.env.LOCALAPPDATA || '', 'Programs', 'nodejs'),
    process.env.PATH || '',
  ].filter(Boolean).join(';')
} else if (process.platform === 'darwin') {
  augmentedPath = [
    '/opt/homebrew/bin',
    '/usr/local/bin',
    '/usr/bin',
    path.join(home, '.nvm', 'versions', 'node', 'current', 'bin'),
    path.join(home, '.volta', 'bin'),
    path.join(home, '.fnm', 'aliases', 'default', 'bin'),
    path.join(home, '.local', 'share', 'mise', 'shims'),
    path.join(home, '.asdf', 'shims'),
    path.join(home, '.local', 'bin'),
    process.env.PATH || '',
  ].filter(Boolean).join(':')
} else {
  // linux
  augmentedPath = [
    '/usr/local/bin',
    '/usr/bin',
    '/snap/bin',
    path.join(home, '.local', 'bin'),
    path.join(home, '.nvm', 'versions', 'node', 'current', 'bin'),
    path.join(home, '.volta', 'bin'),
    path.join(home, '.local', 'share', 'fnm', 'aliases', 'default', 'bin'),
    path.join(home, '.local', 'share', 'mise', 'shims'),
    path.join(home, '.asdf', 'shims'),
    process.env.PATH || '',
  ].filter(Boolean).join(':')
}
```

**Step 2: Syntax check**

Run: `node -c ace-desktop/src/preflight.js && echo OK`
Expected: `OK`

**Step 3: Smoke-test preflight on current platform**

Run: `cd ace-desktop && npm start`
Wait for the dashboard to load. Open DevTools (View → Toggle Developer Tools). In the console, look for the `[preflight]` IPC result — binary should report `ok: true` and the correct path. Close window.

**Step 4: Commit**

```bash
git add ace-desktop/src/preflight.js
git commit -m "refactor(ace-desktop): three-way platform branch for PATH augmentation in preflight"
```

---

## Task 4: Three-way platform branch in `chat-manager.js`

**Files:**
- Modify: [ace-desktop/src/chat-manager.js:102-124](../../src/chat-manager.js#L102-L124)

**Step 1: Replace the `augmentedPath` ternary** (same shape as Task 3)

Currently lines 102-124 build `augmentedPath` with `win32 ? [...] : [...]`. Replace the ternary with the same three-way `if / else if / else` block from Task 3 (use the exact same Linux array). Keep all surrounding comments about Homebrew/nvm/volta/fnm/asdf/mise — they apply to the macOS branch.

**Step 2: Syntax check**

Run: `node -c ace-desktop/src/chat-manager.js && echo OK`
Expected: `OK`

**Step 3: Smoke-test chat on current platform**

Run: `cd ace-desktop && npm start`
Open Chat view. Send a prompt: `say hi in one word`. Receive streamed reply. Close window.
Expected: chat works with no PATH-related ENOENT.

**Step 4: Commit**

```bash
git add ace-desktop/src/chat-manager.js
git commit -m "refactor(ace-desktop): three-way platform branch for PATH augmentation in chat-manager"
```

---

## Task 5: Linux paths in `main.js` (binary detection + node/git fallbacks)

**Files:**
- Modify: [ace-desktop/main.js:82-92](../../main.js#L82-L92) — `KNOWN_PATHS` for Claude
- Modify: [ace-desktop/main.js:101-113](../../main.js#L101-L113) — `detectClaudeBinary` augmented PATH
- Modify: [ace-desktop/main.js:170](../../main.js#L170) — window icon
- Modify: [ace-desktop/main.js:327-348](../../main.js#L327-L348) — `NODE_PATHS` / `GIT_PATHS`

**Step 1: Add `LINUX_CLAUDE_PATHS` and update `KNOWN_PATHS`**

After `WINDOWS_CLAUDE_PATHS` (line 91), add:

```javascript
const LINUX_CLAUDE_PATHS = [
  path.join(require('os').homedir(), '.local', 'bin', 'claude'),
  '/usr/local/bin/claude',
  '/usr/bin/claude',
  '/snap/bin/claude',
]
```

Replace line 92:
```javascript
const KNOWN_PATHS = process.platform === 'win32' ? WINDOWS_CLAUDE_PATHS : MACOS_CLAUDE_PATHS
```
with:
```javascript
const KNOWN_PATHS =
  process.platform === 'win32' ? WINDOWS_CLAUDE_PATHS :
  process.platform === 'darwin' ? MACOS_CLAUDE_PATHS :
  LINUX_CLAUDE_PATHS
```

**Step 2: Linux-friendly `augmentedPath` in `detectClaudeBinary`**

Replace the array at lines 102-113 with a three-way branch (same shape as Task 3, use the same Linux array). Keep `WHICH_CMD` as-is — `which` works on Linux.

**Step 3: Window icon — add Linux case**

Line 170 currently:
```javascript
icon: path.join(__dirname, 'assets', process.platform === 'win32' ? 'ace.ico' : 'ace.icns'),
```

Replace with:
```javascript
icon: path.join(__dirname, 'assets',
  process.platform === 'win32' ? 'ace.ico' :
  process.platform === 'darwin' ? 'ace.icns' :
  'ace.png'),
```

(`assets/ace.png` already exists — verified.)

**Step 4: Add `LINUX_NODE_PATHS` / `LINUX_GIT_PATHS` and update selectors**

After `WINDOWS_GIT_PATHS` (line 346), add:

```javascript
const LINUX_NODE_PATHS = [
  '/usr/local/bin/node',
  '/usr/bin/node',
  '/snap/bin/node',
  path.join(require('os').homedir(), '.local', 'bin', 'node'),
]
const LINUX_GIT_PATHS = [
  '/usr/local/bin/git',
  '/usr/bin/git',
  '/snap/bin/git',
]
```

Replace lines 347-348:
```javascript
const NODE_PATHS = process.platform === 'win32' ? WINDOWS_NODE_PATHS : MACOS_NODE_PATHS
const GIT_PATHS = process.platform === 'win32' ? WINDOWS_GIT_PATHS : MACOS_GIT_PATHS
```
with:
```javascript
const NODE_PATHS =
  process.platform === 'win32' ? WINDOWS_NODE_PATHS :
  process.platform === 'darwin' ? MACOS_NODE_PATHS :
  LINUX_NODE_PATHS
const GIT_PATHS =
  process.platform === 'win32' ? WINDOWS_GIT_PATHS :
  process.platform === 'darwin' ? MACOS_GIT_PATHS :
  LINUX_GIT_PATHS
```

**Step 5: Syntax check**

Run: `node -c ace-desktop/main.js && echo OK`
Expected: `OK`

**Step 6: Smoke-test on current platform (macOS)**

Run: `cd ace-desktop && npm start`
Verify: window opens with the right icon, binary auto-detection runs, dashboard loads.
Expected: no regression on macOS.

**Step 7: Commit**

```bash
git add ace-desktop/main.js
git commit -m "feat(ace-desktop): add linux paths for binary detection and window icon"
```

---

## Task 6: Verify icon asset

**Files:** none (read-only check)

**Step 1: Confirm `assets/ace.png` exists and is non-trivial**

Run: `ls -la ace-desktop/assets/ace.png && file ace-desktop/assets/ace.png`
Expected: file exists, type is PNG, size > 10KB. (electron-builder auto-generates needed sizes from this single PNG for AppImage.)

**Step 2: No commit** — pure verification.

---

## Task 7: Add `build-linux` job to release workflow

**Files:**
- Modify: [.github/workflows/release.yml:57-85](../../../.github/workflows/release.yml#L57-L85)

**Step 1: Insert `build-linux` job after `build-win`**

After the `build-win` job ends (line 85, after the `Upload Windows artifact` step), insert:

```yaml
  build-linux:
    runs-on: ubuntu-latest
    timeout-minutes: 25
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with:
          node-version: '20'
          cache: 'npm'
          cache-dependency-path: ace-desktop/package-lock.json
      - uses: actions/setup-python@v5
        with:
          python-version: '3.11'
      - name: Install dependencies
        working-directory: ace-desktop
        run: npm ci
      - name: Build AppImage
        working-directory: ace-desktop
        run: npx electron-builder --linux AppImage
      - name: List build output
        working-directory: ace-desktop
        run: ls -la dist/
      - name: Upload Linux artifact
        uses: actions/upload-artifact@v4
        with:
          name: linux-appimage
          path: ace-desktop/dist/*.AppImage
          if-no-files-found: error
```

Notes:
- No code-signing env var needed (AppImage is unsigned by convention).
- `ubuntu-latest` ships with `build-essential` and Python 3 already, so `node-pty` and `better-sqlite3` rebuilds will work if prebuilt binaries are absent.
- No arch matrix — Linux x64 only for v0.2.1 (ARM64 is out of scope).

**Step 2: Update `publish` job's `needs:` array**

Line 88 currently:
```yaml
needs: [build-mac, build-win]
```
Change to:
```yaml
needs: [build-mac, build-win, build-linux]
```

**Step 3: YAML syntax check**

Run: `python3 -c "import yaml; yaml.safe_load(open('.github/workflows/release.yml'))" && echo OK`
Expected: `OK`. (If `pyyaml` is not installed: `pip3 install --quiet pyyaml` first, or use `npx js-yaml .github/workflows/release.yml`.)

**Step 4: Commit**

```bash
git add .github/workflows/release.yml
git commit -m "ci(ace-desktop): add linux AppImage build job"
```

---

## Task 8: Wire Linux artifact into publish step + update release notes

**Files:**
- Modify: [.github/workflows/release.yml:91-129](../../../.github/workflows/release.yml#L91-L129) (publish job steps)

**Step 1: Add Linux artifact download step**

After the existing `Download Windows artifact` step (around line 106), insert:

```yaml
      - name: Download Linux artifact
        uses: actions/download-artifact@v4
        with:
          name: linux-appimage
          path: artifacts/
```

**Step 2: Extend release notes + artifact glob**

Replace the entire `Create release on public repo` step body. The new step:

```yaml
      - name: Create release on public repo
        env:
          GH_TOKEN: ${{ secrets.PUBLIC_REPO_TOKEN }}
          VERSION: ${{ steps.version.outputs.version }}
        run: |
          gh release create "$GITHUB_REF_NAME" \
            --repo actualize-ace/ace-desktop \
            --title "ACE v$VERSION" \
            --notes "## ACE v$VERSION

          Download the installer for your platform below.

          **macOS:** download the DMG matching your Mac — \`arm64\` for Apple Silicon (M1/M2/M3), \`x64\` for Intel Macs. Right-click the DMG → Open (first launch only, Gatekeeper bypass).

          **Windows (x64):** if SmartScreen warns, click More info → Run anyway.

          **Linux (x64):** download the AppImage, then:

          \`\`\`bash
          chmod +x ACE-$VERSION-x86_64.AppImage
          ./ACE-$VERSION-x86_64.AppImage
          \`\`\`

          If launch fails with a FUSE error on Ubuntu 22.04+: \`sudo apt install libfuse2\`.

          Full notes: [CHANGELOG.md](https://github.com/actualize-ace/ace-desktop/blob/main/CHANGELOG.md)" \
            artifacts/*.dmg artifacts/*.exe artifacts/*.AppImage
```

(The artifact glob added `artifacts/*.AppImage` at the end. The `--notes` body gained a Linux section with the FUSE caveat.)

**Step 3: YAML syntax check**

Run: `python3 -c "import yaml; yaml.safe_load(open('.github/workflows/release.yml'))" && echo OK`
Expected: `OK`

**Step 4: Commit**

```bash
git add .github/workflows/release.yml
git commit -m "ci(ace-desktop): publish linux AppImage and document install"
```

---

## Task 9: Bump version + CHANGELOG entry

**Files:**
- Modify: [ace-desktop/package.json:4](../../package.json#L4) — version
- Modify: [ace-desktop/CHANGELOG.md](../../CHANGELOG.md) — add v0.2.1 section

**Step 1: Bump version**

Change `package.json` line 4 from `"version": "0.2.0"` to `"version": "0.2.1"`.

**Step 2: Add CHANGELOG entry at top (after the title block, before `## v0.2.0`)**

```markdown
## v0.2.1 — 2026-04-16

### Added
- **Linux support (AppImage)** — `ACE-0.2.1-x86_64.AppImage` now built and published alongside Mac DMGs and Windows NSIS installer on every release. Run `chmod +x` then double-click. Ubuntu 22.04+ users may need `sudo apt install libfuse2`.
- Binary detection now covers Linux install locations: `/usr/local/bin`, `/usr/bin`, `/snap/bin`, `~/.local/bin`, plus nvm/volta/fnm/asdf/mise version-manager paths.

### Changed
- Refactored platform branching across `pty-manager`, `preflight`, `chat-manager`, and `main` from two-way (`win32` vs. else-Mac) to three-way (`win32` | `darwin` | `linux`). No behavior change on Mac/Windows.

---
```

**Step 3: Verify JSON + Markdown sanity**

Run: `node -e "console.log(require('./ace-desktop/package.json').version)" && head -25 ace-desktop/CHANGELOG.md`
Expected: prints `0.2.1` then the new CHANGELOG section.

**Step 4: Commit**

```bash
git add ace-desktop/package.json ace-desktop/CHANGELOG.md
git commit -m "chore(ace-desktop): bump to v0.2.1, add changelog entry"
```

---

## Task 10: Update ROADMAP

**Files:**
- Modify: [ace-desktop/ROADMAP.md](../../ROADMAP.md)

**Step 1: Read current state of ROADMAP**

Run: `head -80 ace-desktop/ROADMAP.md`
Identify the Phase 2 (Windows) row and the section where Linux belongs.

**Step 2: Add a Linux row marked Done in v0.2.1**

If a "Phase 3: Linux" or similar section already exists, mark its row(s) as `Done — v0.2.1`. If not, add a row in the most relevant table:

```markdown
| Linux AppImage build (x64) | Done — v0.2.1 | Aleksander Brankov primary target; FUSE2 dependency documented in release notes |
```

(Match the existing table column shape — read the file first to confirm.)

**Step 3: Commit**

```bash
git add ace-desktop/ROADMAP.md
git commit -m "docs(ace-desktop): mark linux AppImage as shipped in v0.2.1"
```

---

## Task 11: Pre-tag uncommitted-files audit

**Files:** none (audit only)

**Per `feedback_pretag_uncommitted_audit.md`:**

**Step 1: Confirm no orphaned changes in `ace-desktop/`**

Run: `git diff --stat HEAD -- ace-desktop/ .github/`
Expected: empty output (everything committed).

**Step 2: Confirm branch is ahead of main with the expected commits**

Run: `git log --oneline main..HEAD`
Expected: 9 commits — Tasks 1, 2, 3, 4, 5, 7, 8, 9, 10. Each scoped to a single concern.

**Step 3: PAUSE — explicit ship approval gate**

Per `feedback_explicit_permission_required.md`, do **not** push or tag without the user typing "ship it" / "go" / "tag it". Surface the audit summary and ask:

> "Branch is ready. 9 commits queued. About to:
> 1. Push `ace-desktop-linux-support` to origin
> 2. Open PR (or fast-forward merge to main per user preference)
> 3. Tag `ace-desktop-v0.2.1` on the merge commit and push the tag — this triggers CI build + publish to actualize-ace/ace-desktop releases
>
> Confirm with 'ship it' to proceed, or tell me to hold."

---

## Task 12: Push, merge, tag (gated on user "ship it")

**Files:** none (git only)

**Step 1: Push branch**

Run: `git push -u origin ace-desktop-linux-support`

**Step 2: Merge to main** (ask user: PR review or fast-forward? Default to fast-forward since solo owner.)

For fast-forward:
```bash
git checkout main
git merge --ff-only ace-desktop-linux-support
git push origin main
```

**Step 3: Tag**

```bash
git tag ace-desktop-v0.2.1
git push origin ace-desktop-v0.2.1
```

**Step 4: Verify tag triggered the workflow**

Run: `gh run list --workflow=release.yml --limit 3`
Expected: a new run for `ace-desktop-v0.2.1` showing `in_progress`.

---

## Task 13: Watch CI to green

**Files:** none

**Step 1: Tail the run**

Run: `gh run watch` (pick the latest `release.yml` run).
Expected: all four jobs finish — `build-mac (arm64)`, `build-mac (x64)`, `build-win`, `build-linux`, then `publish`.
Total expected wall time: ~20–25 minutes.

**Step 2: If `build-linux` fails**

Capture the failing step output:
```bash
gh run view --log-failed
```
Most likely failure modes (in priority order):
1. **`npm ci` fails on lockfile** — package-lock.json was last regenerated on macOS. If a Mac-only optional dep (e.g. `@rollup/rollup-darwin-*`) is pinned, run `npm install` locally on Linux (or in a Docker `node:20` container) and commit the regenerated lockfile.
2. **`electron-builder` fails on missing FUSE for AppImage build** — extremely rare on `ubuntu-latest` (which has it). If it happens: `sudo apt-get install -y libfuse2` step before the build.
3. **`better-sqlite3` / `node-pty` rebuild fails** — should not happen on Ubuntu 24.04. If it does, add `sudo apt-get install -y build-essential python3` step.

Apply the fix, push, re-tag (or push a new tag like `ace-desktop-v0.2.1-rc2`).

**Step 3: Confirm release published**

Run: `gh release view ace-desktop-v0.2.1 --repo actualize-ace/ace-desktop`
Expected: 4 assets — 2 DMGs, 1 EXE, 1 AppImage.

---

## Task 14: Sanity-launch the AppImage

**Files:** none

**Step 1: Download the AppImage to a Linux test machine**

If no Linux machine handy, use a Docker container with X11 forwarding, or skip this step and rely on Aleksander's first-launch report. Document which.

**Step 2: Run it**

```bash
chmod +x ACE-0.2.1-x86_64.AppImage
./ACE-0.2.1-x86_64.AppImage
```

Expected: window opens, setup screen renders. Walk through binary detection + vault selection + chat ping.

**Step 3: Note any blockers** for inclusion in the message to Aleksander.

---

## Task 15: Send Aleksander download link + test protocol

**Files:** none (Gmail draft only — per `feedback_draft_before_sending.md`, draft, do not send)

**Step 1: Use `/draft-email` skill** to compose a Gmail draft to Aleksander (`AleksBrankov` on GitHub; check `04-Network/people/aleksander-brankov.md` for current email).

Draft body should include:
- Download link: `https://github.com/actualize-ace/ace-desktop/releases/tag/ace-desktop-v0.2.1`
- One-line install: `chmod +x ACE-0.2.1-x86_64.AppImage && ./ACE-0.2.1-x86_64.AppImage`
- FUSE caveat for Ubuntu 22.04+: `sudo apt install libfuse2` if it errors
- Test protocol checklist (8 items from the sketch — Step 96-108):
  1. AppImage launches, setup screen renders
  2. Binary detection finds Claude CLI (or manual picker works)
  3. Vault path selected — dashboard loads
  4. Chat: send prompt, get streamed response
  5. Agent Terminal: spawn Claude session, interact 2 min
  6. Attachment flow: paperclip + drag-drop + screenshot paste
  7. Slash menu `/start` renders + executes
  8. Close + reopen — state persists
- Where to send logs if errors: paste from `~/.config/ACE/` directory

**Step 2: Show draft to user, wait for "send" approval.**

**Step 3: On approval, send via Gmail MCP** (`nikhil@asraya.io` per `feedback_google_workspace_email.md`).

---

## Task 16: Update memory + delete sketch

**Files:**
- Delete: [ace-desktop/docs/plans/2026-04-15-linux-support-sketch.md](../../docs/plans/2026-04-15-linux-support-sketch.md)
- Possibly add: a new memory file noting Linux is now supported + Aleksander as first user

**Step 1: Delete sketch**

```bash
git rm ace-desktop/docs/plans/2026-04-15-linux-support-sketch.md
git commit -m "docs(ace-desktop): remove linux support sketch (superseded by implementation)"
git push
```

**Step 2: Add memory note** if Aleksander reports a Linux-specific issue worth remembering for future builds (FUSE, chrome-sandbox SUID, Wayland clipboard, etc.).

**Step 3: `/close` the session** to log what shipped.

---

## Out of Scope for v0.2.1 (do NOT do)

- **DRY refactor of augmented-PATH array** into a shared `src/platform-paths.js` helper. Five copies is annoying but fixing it is a cross-file refactor — risky to bundle with platform-expansion work. Track separately.
- Native deb / rpm packages
- Snap / Flatpak builds
- Linux ARM64 (Raspberry Pi etc.)
- GPG-signed AppImages
- electron-updater on Linux
- Wayland-native (Electron defaults to XWayland — fine)
- HiDPI scaling tuning (will surface from Aleksander's feedback if needed)

## Success Criteria

- [ ] CI workflow on `ace-desktop-v0.2.1` tag produces all 4 artifacts (2 DMG, 1 EXE, 1 AppImage)
- [ ] `gh release view ace-desktop-v0.2.1 --repo actualize-ace/ace-desktop` lists the AppImage
- [ ] Aleksander launches the AppImage on his Linux machine and completes a `/start` session without workarounds
- [ ] Mac arm64 + Mac x64 + Windows builds still green (no regression)
- [ ] CHANGELOG, ROADMAP, sketch deletion all in main

---

## Verification Checklist (use during execution)

After every task: `git status --short ace-desktop/ .github/` — should show only the file(s) the task is meant to touch. If anything else is dirty, you accidentally edited too much.

Before ANY claim that a task is "done": run the exact verification command in the task and observe the expected output. **Evidence before assertion.** (`superpowers:verification-before-completion`)
