# Windows Build + Public Distribution Repo Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Ship an unsigned Windows .exe of ACE Desktop built on a GitHub Actions Windows runner, published to a new public repo `actualize-ace/ace-desktop` that serves as the download + issues + changelog front door for all clients.

**Architecture:** Source stays private in `mythopoetix/nikhil`. A `release.yml` workflow in the private repo, triggered on `ace-desktop-v*` tags, builds both macOS and Windows artifacts in parallel, then uses a scoped PAT to publish a release to the public `actualize-ace/ace-desktop` repo. In-app alpha popover links migrate from the public gist + mailto to the new repo's CHANGELOG + Issues. Windows-specific code changes (icon, binary detection, process kill, cross-env scripts) are isolated per commit on a `windows-port` branch, merged to main before tagging.

**Tech Stack:** Electron 34.5.8 · electron-builder 24.13.3 · node-pty 1.1.0 · better-sqlite3 12.8.0 · GitHub Actions (`macos-latest`, `windows-latest`) · ImageMagick (ace.ico generation) · `cross-env` (npm scripts) · `gh` CLI 2.x.

**Sequencing constraint:** Apr 13 morning is AA + ACE MC2 announce gate (AT RISK, owner = user). No task in this plan begins execution until user confirms AA announce is shipped. Design doc: [2026-04-12-windows-build-and-public-repo-design.md](2026-04-12-windows-build-and-public-repo-design.md).

---

## Phase 0 — Pre-flight (~5 min, blocking for all later phases)

### Task 0.1: Create `windows-port` branch

**Files:** none

**Step 1:** Confirm main is clean
```bash
cd /Users/nikhilkale/Documents/Actualize
git status --short | grep -v '^??'
```
Expected: only tracked-file modifications (these are vault state, not code — fine to leave). No staged changes.

**Step 2:** Create and switch to branch
```bash
git checkout -b windows-port
```

**Step 3:** Verify
```bash
git branch --show-current
```
Expected: `windows-port`

### Task 0.2: Verify local tooling

**Files:** none

**Step 1:** Check required binaries
```bash
/opt/homebrew/bin/gh --version
which magick convert 2>&1 | head -2
node --version
```
Expected: `gh` ≥ 2.40, ImageMagick present (`magick` or `convert`), node ≥ 20.

**Step 2:** If ImageMagick missing
```bash
brew install imagemagick
```

**Step 3:** Verify gh auth
```bash
/opt/homebrew/bin/gh auth status
```
Expected: logged in as `mythopoetix` with scopes including `repo`, `admin:org`, `workflow`.

**Step 4:** Commit (no file changes — skip commit, just confirm ready)

---

## Phase 1 — Public repo scaffolding (~15 min)

### Task 1.1: Create `actualize-ace/ace-desktop` public repo

**Files:** none (GitHub API action)

**Step 1:** Create repo via gh CLI
```bash
/opt/homebrew/bin/gh repo create actualize-ace/ace-desktop \
  --public \
  --description "ACE Desktop — download installers, changelog, bug reports" \
  --homepage "https://actualize.ai"
```
Expected: `✓ Created repository actualize-ace/ace-desktop on GitHub`

**Step 2:** Verify public + issues enabled
```bash
/opt/homebrew/bin/gh repo view actualize-ace/ace-desktop --json visibility,hasIssuesEnabled
```
Expected: `{"visibility":"PUBLIC","hasIssuesEnabled":true}`

**Step 3:** Clone to a scratch location (not inside the vault)
```bash
cd /tmp
git clone git@github.com:actualize-ace/ace-desktop.git
cd ace-desktop
```
Expected: empty repo cloned. Remains our scratch workspace for Phase 1.

### Task 1.2: Seed `README.md`

**Files:**
- Create: `/tmp/ace-desktop/README.md`

**Step 1:** Write the README with install instructions for both platforms

```markdown
# ACE Desktop

Operating system for coherence. Download installers and report issues here.

**Status:** Alpha (v0.1.x) — unsigned builds. Expect rough edges.

---

## Download

Latest release: [github.com/actualize-ace/ace-desktop/releases/latest](https://github.com/actualize-ace/ace-desktop/releases/latest)

### macOS (Apple Silicon)

1. Download `ACE-X.Y.Z-arm64.dmg`
2. Open the DMG, drag **ACE** to Applications
3. **Right-click** ACE in Applications → **Open** (first launch only)
4. Confirm the Gatekeeper security prompt

Unsigned build — the right-click step bypasses macOS Gatekeeper. Future versions will be notarized.

### Windows (x64)

1. Download `ACE-X.Y.Z-x64.exe`
2. Double-click to install
3. If Windows SmartScreen warns: click **More info** → **Run anyway**

Unsigned build — SmartScreen warning is expected on first install. Future versions will be Authenticode-signed.

---

## Report a Bug

[Open an issue](https://github.com/actualize-ace/ace-desktop/issues/new) — include OS, version, and steps.

## Changelog

[CHANGELOG.md](./CHANGELOG.md)
```

**Step 2:** Manually verify the file renders (preview in editor or `gh markdown`)

**Step 3:** Stage
```bash
cd /tmp/ace-desktop && git add README.md
```

### Task 1.3: Seed `CHANGELOG.md`

**Files:**
- Create: `/tmp/ace-desktop/CHANGELOG.md`

**Step 1:** Pull current gist content
```bash
curl -s https://gist.githubusercontent.com/mythopoetix/aa39a1831b4358e0452e8aed777fda2a/raw > /tmp/gist-changelog.md
cat /tmp/gist-changelog.md
```
Expected: existing v0.1.0 through v0.1.2 release notes.

**Step 2:** Write the CHANGELOG in Keep-a-Changelog format

```markdown
# Changelog

All notable changes to ACE Desktop are documented here. Format based on [Keep a Changelog](https://keepachangelog.com/).

## [Unreleased]

## [0.1.2] — 2026-04-12

### Fixed
- Node + Git detection falls back to known paths when packaged Electron app doesn't inherit shell `PATH` (GUI-launched apps on macOS)
- Sidebar collapse polish: hide learn dot + status pulse + meta when sidebar collapsed

## [0.1.1] — 2026-04-12

### Added
- Setup preflight polish + alpha signaling + settings cleanup

## [0.1.0] — 2026-04-12

### Added
- First packaged Mac DMG (unsigned, arm64)
- Electron 34.5.8 + Node 20 LTS + Chrome 132
- Dashboard + Command Center + Agent Terminal + Insight + People + Knowledge Graph
- Claude CLI chat integration with stream-json + --resume
- Learn tab onboarding tutorial (8 lessons)
- Alpha pill + clickable footer badge
- App renamed to ACE (from ACE Desktop)
```

Port exact content from the gist output — don't paraphrase.

**Step 3:** Stage
```bash
git add CHANGELOG.md
```

### Task 1.4: Create issue templates

**Files:**
- Create: `/tmp/ace-desktop/.github/ISSUE_TEMPLATE/bug_report.yml`

**Step 1:** Write the bug report template

```yaml
name: Bug report
description: Something broken in ACE Desktop
labels: ["bug"]
body:
  - type: markdown
    attributes:
      value: |
        Thanks for reporting. Please include OS + version + steps.
  - type: input
    id: version
    attributes:
      label: ACE version
      description: "Check: footer badge inside the app, or the filename you downloaded."
      placeholder: "0.1.3"
    validations:
      required: true
  - type: dropdown
    id: os
    attributes:
      label: Operating system
      options:
        - macOS (Apple Silicon)
        - macOS (Intel)
        - Windows 10
        - Windows 11
        - Other
    validations:
      required: true
  - type: textarea
    id: what-happened
    attributes:
      label: What happened?
      description: Include steps to reproduce.
    validations:
      required: true
  - type: textarea
    id: logs
    attributes:
      label: Console output (optional)
      description: "Open DevTools (Cmd/Ctrl+Shift+I) → Console tab → copy any red error lines."
      render: shell
```

**Step 2:** Stage
```bash
mkdir -p .github/ISSUE_TEMPLATE
# (write the file via Write tool to correct path: /tmp/ace-desktop/.github/ISSUE_TEMPLATE/bug_report.yml)
git add .github/ISSUE_TEMPLATE/bug_report.yml
```

### Task 1.5: Commit + push public repo seed

**Step 1:** Commit
```bash
cd /tmp/ace-desktop
git commit -m "chore: seed public ace-desktop repo — README, CHANGELOG, bug template"
```

**Step 2:** Push
```bash
git push origin main
```

**Step 3:** Verify
```bash
/opt/homebrew/bin/gh repo view actualize-ace/ace-desktop --web
```
Expected: README renders on repo landing, Issues tab present, CHANGELOG in file list.

---

## Phase 2 — Cross-repo publish auth (~10 min)

### Task 2.1: Create fine-grained PAT

**Files:** none (GitHub web UI action — no API equivalent for fine-grained PATs as of 2026-04)

**Step 1:** Navigate to https://github.com/settings/personal-access-tokens/new

**Step 2:** Configure the token:
- Token name: `ace-desktop-release-publish`
- Expiration: 90 days (calendar reminder on day 75)
- Resource owner: `actualize-ace`
- Repository access: Only select repositories → `actualize-ace/ace-desktop`
- Permissions → Repository permissions:
  - `Contents`: Read and write
  - `Metadata`: Read-only (required, auto-enabled)

**Step 3:** Generate + copy token (starts with `github_pat_`)

**Step 4:** Never commit this token. Store in secret manager next step.

### Task 2.2: Add PAT as secret in private repo

**Files:** none (GitHub Actions settings)

**Step 1:** Add secret via gh CLI
```bash
/opt/homebrew/bin/gh secret set PUBLIC_REPO_TOKEN \
  --repo mythopoetix/nikhil \
  --body "<paste-pat-here>"
```
Expected: `✓ Set Actions secret PUBLIC_REPO_TOKEN for mythopoetix/nikhil`

**Step 2:** Verify
```bash
/opt/homebrew/bin/gh secret list --repo mythopoetix/nikhil
```
Expected: `PUBLIC_REPO_TOKEN` appears in list.

---

## Phase 3 — Windows code port (~2 hr, each task one commit)

All work below happens in the vault repo on branch `windows-port`.

```bash
cd /Users/nikhilkale/Documents/Actualize
git checkout windows-port
```

### Task 3.1: Generate `ace.ico`

**Files:**
- Create: `ace-desktop/assets/ace.ico`
- Read: `ace-desktop/assets/ace.png`

**Step 1:** Verify source PNG exists and is ≥ 256×256
```bash
file ace-desktop/assets/ace.png
```
Expected: PNG image data, ≥ 256 x 256.

**Step 2:** Generate multi-resolution .ico
```bash
cd ace-desktop/assets
magick ace.png -resize 256x256 -define icon:auto-resize=256,128,64,48,32,16 ace.ico
```
If `magick` command not found, use `convert` (ImageMagick 6 legacy).

**Step 3:** Verify output
```bash
file ace.ico
```
Expected: `MS Windows icon resource - 6 icons, 16x16, ... 256x256`

**Step 4:** Commit
```bash
cd /Users/nikhilkale/Documents/Actualize
git add ace-desktop/assets/ace.ico
git commit -m "build(ace-desktop): add Windows ace.ico (multi-resolution)"
```

### Task 3.2: Add Windows build target to `package.json`

**Files:**
- Modify: `ace-desktop/package.json` (build section)

**Step 1:** Read current build config
```bash
cat ace-desktop/package.json | python3 -c "import json,sys; print(json.dumps(json.load(sys.stdin).get('build',{}), indent=2))"
```
Expected: existing `build` object with `mac` target. No `win` key yet.

**Step 2:** Add `win` block. Exact JSON to merge into `build`:

```json
"win": {
  "target": "nsis",
  "icon": "assets/ace.ico",
  "artifactName": "ACE-${version}-${arch}.${ext}"
},
"nsis": {
  "oneClick": false,
  "perMachine": false,
  "allowToChangeInstallationDirectory": true,
  "createDesktopShortcut": true,
  "shortcutName": "ACE"
}
```

Use Edit tool against the `"mac": {` line to insert `"win"` block before it, preserving JSON validity.

**Step 3:** Verify JSON parses
```bash
python3 -c "import json; json.load(open('ace-desktop/package.json'))"
```
Expected: no output (valid JSON).

**Step 4:** Verify build config
```bash
cat ace-desktop/package.json | python3 -c "import json,sys; b=json.load(sys.stdin)['build']; print('win target:', b.get('win',{}).get('target'))"
```
Expected: `win target: nsis`

**Step 5:** Commit
```bash
git add ace-desktop/package.json
git commit -m "build(ace-desktop): add Windows nsis target + ace.ico"
```

### Task 3.3: Extend binary detection with Windows paths

**Files:**
- Modify: `ace-desktop/main.js` (findBinary helper + known-path arrays)

**Step 1:** Locate current helper
```bash
grep -n "NODE_PATHS\|GIT_PATHS\|findBinary\|detectClaudeBinary" ace-desktop/main.js | head -20
```
Record line numbers.

**Step 2:** Read the findBinary function + path arrays

Read `ace-desktop/main.js` around the matched line numbers.

**Step 3:** Add Windows known-paths (platform-gated)

Pattern (adapt exact location to current code):

```javascript
const WINDOWS_NODE_PATHS = [
  path.join(process.env.ProgramFiles || 'C:\\Program Files', 'nodejs', 'node.exe'),
  path.join(process.env['ProgramFiles(x86)'] || 'C:\\Program Files (x86)', 'nodejs', 'node.exe'),
  path.join(process.env.APPDATA || '', 'npm', 'node.exe'),
];

const WINDOWS_GIT_PATHS = [
  path.join(process.env.ProgramFiles || 'C:\\Program Files', 'Git', 'bin', 'git.exe'),
  path.join(process.env.ProgramFiles || 'C:\\Program Files', 'Git', 'cmd', 'git.exe'),
  path.join(process.env['ProgramFiles(x86)'] || 'C:\\Program Files (x86)', 'Git', 'bin', 'git.exe'),
];

const WINDOWS_CLAUDE_PATHS = [
  path.join(process.env.LOCALAPPDATA || '', 'Programs', 'claude', 'claude.exe'),
  path.join(process.env.APPDATA || '', 'npm', 'claude.cmd'),
  path.join(process.env.APPDATA || '', 'npm', 'claude.ps1'),
];
```

Merge at lookup time using `process.platform === 'win32'`:

```javascript
const NODE_PATHS = process.platform === 'win32' ? WINDOWS_NODE_PATHS : MACOS_NODE_PATHS;
```

(Rename existing `NODE_PATHS` → `MACOS_NODE_PATHS` if not already named that way.)

**Step 4:** Manual verification (dev mode only, Mac side)

```bash
cd ace-desktop && npm start
```

Open DevTools Console. Trigger setup preflight (Settings → "Re-run setup"). Expected: Node/Git/Claude still detected on Mac — no regression.

**Step 5:** Commit
```bash
git add ace-desktop/main.js
git commit -m "feat(ace-desktop): Windows known-paths for Node + Git + Claude binary detection"
```

### Task 3.4: Replace `which` with `where.exe` on win32

**Files:**
- Modify: `ace-desktop/main.js` (wherever `which` is called via execSync)

**Step 1:** Find all `which` invocations
```bash
grep -n "which " ace-desktop/main.js | grep -v "//"
```

**Step 2:** Gate by platform. Pattern:

```javascript
const whichCmd = process.platform === 'win32' ? 'where.exe' : 'which';
const found = execSync(`${whichCmd} ${binName}`, { encoding: 'utf8' }).trim().split('\n')[0];
```

`where.exe` output on Windows can list multiple paths across lines — take `[0]` after splitting.

**Step 3:** Manual verification on Mac
```bash
npm start
```
Trigger preflight. Expected: no regression.

**Step 4:** Commit
```bash
git add ace-desktop/main.js
git commit -m "feat(ace-desktop): use where.exe for binary lookup on Windows"
```

### Task 3.5: Platform-aware process kill

**Files:**
- Modify: `ace-desktop/renderer/modules/chat-manager.js` (kill paths)
- Modify: `ace-desktop/renderer/modules/pty-manager.js` (kill paths)

Actual filenames may differ — verify first:
```bash
grep -rln "SIGTERM\|process\.kill\|child\.kill" ace-desktop/ --include="*.js"
```

**Step 1:** For each kill site, wrap in platform check:

```javascript
function killProcess(pid) {
  if (process.platform === 'win32') {
    const { spawnSync } = require('child_process');
    spawnSync('taskkill', ['/pid', String(pid), '/T', '/F']);
  } else {
    try { process.kill(pid, 'SIGTERM'); } catch (e) { /* already dead */ }
  }
}
```

`/T` = kill child tree. `/F` = force. On Windows, SIGTERM is ignored by non-console apps and graceful shutdown isn't supported — `taskkill /T /F` is the accepted pattern.

**Step 2:** Manual verification on Mac — start + stop a chat session, confirm no stuck processes:
```bash
npm start
# send a chat message, then close the pane
# in another terminal:
ps aux | grep -i claude
```
Expected: no orphan claude processes.

**Step 3:** Commit
```bash
git add ace-desktop/renderer/modules/chat-manager.js ace-desktop/renderer/modules/pty-manager.js
git commit -m "feat(ace-desktop): taskkill on Windows, SIGTERM on Unix"
```

### Task 3.6: Cross-platform npm scripts with `cross-env`

**Files:**
- Modify: `ace-desktop/package.json` (scripts + devDependencies)

**Step 1:** Find the Unix-only script
```bash
grep -n "env -u\|ELECTRON_RUN_AS_NODE" ace-desktop/package.json
```
Expected: `"start": "env -u ELECTRON_RUN_AS_NODE electron ."` or similar.

**Step 2:** Install cross-env
```bash
cd ace-desktop && npm install --save-dev cross-env
```
Expected: `cross-env` added to devDependencies.

**Step 3:** Replace the script. New value:

```json
"start": "cross-env-shell ELECTRON_RUN_AS_NODE= electron ."
```

`cross-env-shell` unsets the var on Windows (unlike `cross-env` which only sets). `ELECTRON_RUN_AS_NODE=` with no value unsets it cross-platform.

**Step 4:** Manual verification on Mac
```bash
npm start
```
Expected: Electron app launches, chat + terminal work.

**Step 5:** Commit
```bash
git add ace-desktop/package.json ace-desktop/package-lock.json
git commit -m "build(ace-desktop): cross-env for ELECTRON_RUN_AS_NODE across platforms"
```

### Task 3.7: Merge `windows-port` to main

**Step 1:** Rebase to keep history linear
```bash
git checkout main
git pull origin main
git checkout windows-port
git rebase main
```

**Step 2:** Switch + merge
```bash
git checkout main
git merge --ff-only windows-port
```

**Step 3:** Push
```bash
git push origin main
```

**Step 4:** Final Mac sanity check
```bash
cd ace-desktop && npm start
```
Full regression pass: chat, terminal, setup preflight, switch sessions, close app cleanly. All green before proceeding.

---

## Phase 4 — GitHub Actions release workflow (~1 hr)

### Task 4.1: Write `release.yml`

**Files:**
- Create: `.github/workflows/release.yml` (at vault root, i.e. `mythopoetix/nikhil` root — NOT inside ace-desktop/)

**Step 1:** Confirm workflow directory
```bash
ls .github/workflows/ 2>/dev/null || mkdir -p .github/workflows
```

**Step 2:** Write the workflow

```yaml
name: Release ACE Desktop

on:
  push:
    tags:
      - 'ace-desktop-v*'

jobs:
  build-mac:
    runs-on: macos-latest
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with:
          node-version: '20'
      - name: Install
        working-directory: ace-desktop
        run: npm ci
      - name: Rebuild native modules for Electron
        working-directory: ace-desktop
        run: npx electron-rebuild
      - name: Build DMG
        working-directory: ace-desktop
        run: npm run dist
      - name: Upload artifact
        uses: actions/upload-artifact@v4
        with:
          name: mac-dmg
          path: ace-desktop/dist/*.dmg
          if-no-files-found: error

  build-win:
    runs-on: windows-latest
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with:
          node-version: '20'
      - name: Install
        working-directory: ace-desktop
        run: npm ci
      - name: Rebuild native modules for Electron
        working-directory: ace-desktop
        run: npx electron-rebuild
      - name: Build NSIS installer
        working-directory: ace-desktop
        run: npm run dist
      - name: Upload artifact
        uses: actions/upload-artifact@v4
        with:
          name: win-exe
          path: ace-desktop/dist/*.exe
          if-no-files-found: error

  publish:
    needs: [build-mac, build-win]
    runs-on: ubuntu-latest
    steps:
      - name: Download Mac artifact
        uses: actions/download-artifact@v4
        with:
          name: mac-dmg
          path: artifacts/
      - name: Download Windows artifact
        uses: actions/download-artifact@v4
        with:
          name: win-exe
          path: artifacts/
      - name: Extract version from tag
        id: version
        run: echo "version=${GITHUB_REF_NAME#ace-desktop-v}" >> $GITHUB_OUTPUT
      - name: Create release on public repo
        env:
          GH_TOKEN: ${{ secrets.PUBLIC_REPO_TOKEN }}
        run: |
          gh release create "${GITHUB_REF_NAME}" \
            --repo actualize-ace/ace-desktop \
            --title "ACE v${{ steps.version.outputs.version }}" \
            --notes "See [CHANGELOG.md](https://github.com/actualize-ace/ace-desktop/blob/main/CHANGELOG.md#${{ steps.version.outputs.version }})" \
            artifacts/*.dmg artifacts/*.exe
```

**Step 3:** Commit
```bash
git add .github/workflows/release.yml
git commit -m "ci: GitHub Actions release workflow for ace-desktop (Mac + Windows)"
git push origin main
```

### Task 4.2: Dry-run test with pre-release tag

**Step 1:** Tag a pre-release version
```bash
# First bump package.json to a pre-release version
cd ace-desktop
# edit package.json version from "0.1.2" to "0.1.3-rc1" via Edit tool
git add package.json
git commit -m "chore: bump ace-desktop to 0.1.3-rc1 for CI smoke test"
git push origin main

cd /Users/nikhilkale/Documents/Actualize
git tag ace-desktop-v0.1.3-rc1
git push origin ace-desktop-v0.1.3-rc1
```

**Step 2:** Watch the workflow
```bash
/opt/homebrew/bin/gh run watch --repo mythopoetix/nikhil
```

**Step 3:** On success, verify release
```bash
/opt/homebrew/bin/gh release view ace-desktop-v0.1.3-rc1 --repo actualize-ace/ace-desktop
```
Expected: both `.dmg` and `.exe` attached.

**Step 4:** On failure (almost certain first time) — iterate

Likely failures + fixes:
- **`electron-rebuild` fails on Windows** — usually missing Visual Studio Build Tools. Add step before `electron-rebuild`:
  ```yaml
  - name: Install Windows build tools
    if: runner.os == 'Windows'
    run: npm config set msvs_version 2022
  ```
- **`npm ci` fails on peer deps** — may need `--legacy-peer-deps` flag.
- **`better-sqlite3` prebuilt binary missing** — add `npm rebuild better-sqlite3` step.
- **PAT permissions error on `gh release create`** — re-verify PAT scope in Task 2.1.

Each fix: commit to a new `windows-port-ci` branch, push, re-tag `v0.1.3-rc2`, repeat. Hard cap: 3 RC iterations (~1 hr) before falling back to cloud Windows VM for interactive debugging.

**Step 5:** Once green, delete RC release + tag
```bash
/opt/homebrew/bin/gh release delete ace-desktop-v0.1.3-rc1 --repo actualize-ace/ace-desktop --yes
git push --delete origin ace-desktop-v0.1.3-rc1
git tag -d ace-desktop-v0.1.3-rc1
```

---

## Phase 5 — Install verification (~30 min)

### Task 5.1: Windows install test

**Prerequisites:** Access to a Windows machine. Options in order of preference:

1. **Marc's machine** (remote session during Apr 14 IT team install call) — real target hardware.
2. **Cloud VM** — AWS EC2 `t3.medium` Windows, ~$0.05/hr. Spin up, test, tear down. Commands:
   ```bash
   # AWS CLI setup assumed
   aws ec2 run-instances --image-id ami-<windows-2022> --instance-type t3.medium ...
   ```
3. **Kim's machine** Apr 13 session (if she's game).

**Step 1:** Download the .exe from `actualize-ace/ace-desktop/releases/latest` on the Windows machine.

**Step 2:** Run installer. Expected: NSIS wizard, install to Program Files or chosen directory, desktop shortcut created.

**Step 3:** Launch ACE. Expected: setup screen appears. Preflight checks run.

**Checkpoint A — setup preflight passes:**
- Node detected (or "install Node" prompt if absent)
- Git detected
- Claude CLI detected (or "install Claude CLI" prompt)
- Vault picker works

**Step 4:** Pick a vault (create empty if no vault on test machine). Click continue.

**Checkpoint B — main app loads:**
- Dashboard renders
- Chat tab opens
- Send a message to Claude — response streams back

**Checkpoint C — terminal works (riskiest):**
- Switch to Agent Terminal tab
- New session
- Claude CLI spawns in the PTY
- Type a prompt, verify ANSI renders correctly
- Resize pane, verify terminal reflows

**Checkpoint D — clean exit:**
- Close the app (File → Exit or X button)
- Open Task Manager → verify no orphan `ACE.exe` or `claude.exe` processes

**Step 5:** Record results. For each checkpoint that fails:
- Capture DevTools console output (Ctrl+Shift+I)
- File issue on private tracker (or in notes for now — don't pollute public Issues with dev-time bugs)

### Task 5.2: If terminal fails (Checkpoint C)

Known risk per design doc. Mitigation: ship v0.1.3 with terminal disabled on Windows. Steps:

**Files:**
- Modify: `ace-desktop/renderer/modules/view-router.js` (or wherever Agent Terminal nav item is defined)

**Step 1:** Hide terminal nav on Windows (temporary)

```javascript
if (process.platform === 'win32') {
  document.querySelector('[data-view="terminal"]')?.classList.add('hidden-on-platform');
}
```

**Step 2:** Add user-visible note in README.md under Windows install:
> Agent Terminal view is temporarily disabled on Windows in v0.1.3 while ConPTY integration is being verified. Chat, Dashboard, and all other views work fully.

**Step 3:** Commit
```bash
git add ace-desktop/renderer/modules/view-router.js /tmp/ace-desktop/README.md
git commit -m "feat(ace-desktop): hide terminal on Windows pending ConPTY verification"
```

---

## Phase 6 — In-app link migration (~15 min)

### Task 6.1: Swap changelog + bug-report URLs

**Files:**
- Modify: alpha popover component (find via grep)

**Step 1:** Find current links
```bash
grep -rn "aa39a1831b4358e0452e8aed777fda2a\|mailto:" ace-desktop/renderer/ --include="*.js" --include="*.html"
```

**Step 2:** Replace:
- Gist URL → `https://github.com/actualize-ace/ace-desktop/blob/main/CHANGELOG.md`
- mailto link → `https://github.com/actualize-ace/ace-desktop/issues/new`

**Step 3:** Update button labels if needed ("Email bug report" → "Report a bug").

**Step 4:** Manual verification
```bash
npm start
```
Click alpha pill, click each link, verify they open in external browser (per existing ACE external-link policy).

**Step 5:** Commit
```bash
git add ace-desktop/renderer/
git commit -m "feat(ace-desktop): alpha popover links point at public repo"
```

---

## Phase 7 — Ship v0.1.3 (~15 min)

### Task 7.1: Bump version, update CHANGELOG

**Step 1:** Edit `ace-desktop/package.json`: version `0.1.2` → `0.1.3`.

**Step 2:** Edit `/tmp/ace-desktop/CHANGELOG.md`: add section under `[Unreleased]`:

```markdown
## [0.1.3] — 2026-04-13

### Added
- Windows x64 NSIS installer (unsigned)
- Public distribution repo `actualize-ace/ace-desktop` — all future downloads + bug reports land here
- GitHub Issues bug report template

### Changed
- Binary detection extended with Windows known-paths (Node, Git, Claude CLI)
- Process termination uses `taskkill` on Windows, `SIGTERM` on Unix
- `npm start` uses `cross-env-shell` for cross-platform compatibility
- Alpha popover now links to public CHANGELOG + GitHub Issues (replaces gist + mailto)

### Known issues
- Agent Terminal view disabled on Windows pending ConPTY verification (if Task 5.2 triggered)
```

**Step 3:** Commit both:
```bash
cd /Users/nikhilkale/Documents/Actualize
git add ace-desktop/package.json
git commit -m "chore: bump ace-desktop to 0.1.3"
git push origin main

cd /tmp/ace-desktop
git add CHANGELOG.md
git commit -m "docs: v0.1.3 release notes"
git push origin main
```

### Task 7.2: Tag + trigger release

**Step 1:** Tag
```bash
cd /Users/nikhilkale/Documents/Actualize
git tag ace-desktop-v0.1.3
git push origin ace-desktop-v0.1.3
```

**Step 2:** Watch CI
```bash
/opt/homebrew/bin/gh run watch --repo mythopoetix/nikhil
```
Expected: all three jobs green in ~12 min.

**Step 3:** Verify release
```bash
/opt/homebrew/bin/gh release view ace-desktop-v0.1.3 --repo actualize-ace/ace-desktop --web
```
Expected: both artifacts visible, CHANGELOG link in notes works, download links resolve.

### Task 7.3: Smoke test downloaded artifacts

**Step 1:** Download .dmg on Mac, drag to Applications, verify launch (Gatekeeper bypass via right-click).

**Step 2:** (Optional — if Windows box still up from Phase 5) Download .exe, install, verify launch.

**Step 3:** If either smoke test fails, tag `v0.1.3.1` with fix, do not announce v0.1.3.

### Task 7.4: Share with clients

**Step 1:** Share release URL with Marc + Kim:
```
ACE v0.1.3 is live — Mac + Windows installers here:
https://github.com/actualize-ace/ace-desktop/releases/latest
```

Per-client platform:
- Marc: Windows .exe
- Kim: Windows .exe
- Joe: Mac .dmg (he's on v0.1.2 — let him know when he's ready to upgrade)

**Step 2:** Draft the message first; get user approval before sending (per memory `feedback_draft_before_sending`).

---

## Phase 8 — Update ROADMAP + memories (~10 min)

### Task 8.1: Update `ace-desktop/ROADMAP.md`

**Files:**
- Modify: `ace-desktop/ROADMAP.md`

Move all Phase 2 Windows Port rows from "Next" → "Shipped" with date `2026-04-13`. Per memory `feedback_roadmap_update_on_ship`.

### Task 8.2: Update auto-memory

Update relevant memory files:
- `project_desktop_client_ship_sprint.md` — add "Windows .exe shipped Apr 13 via actualize-ace/ace-desktop"
- Create `reference_release_pipeline.md` — describes the new `tag → CI → public-repo` workflow so future sessions find it

### Task 8.3: Final commit + push

```bash
git add ace-desktop/ROADMAP.md
git commit -m "docs(ace-desktop): Phase 2 Windows Port complete — v0.1.3 shipped"
git push origin main
```

---

## Definition of done

- [ ] `actualize-ace/ace-desktop` exists, public, has README + CHANGELOG + Issue template
- [ ] Push of `ace-desktop-v*` tag builds both Mac .dmg and Windows .exe in CI, publishes to public repo
- [ ] `.exe` installs and launches on a Windows machine; setup preflight passes; chat works
- [ ] Alpha popover in v0.1.3 points to public CHANGELOG + Issues
- [ ] Marc + Kim have the download URL
- [ ] ROADMAP.md updated, Phase 2 Windows Port moved to Shipped
- [ ] Apr 13 AA announce gate shipped cleanly, unaffected by this work
