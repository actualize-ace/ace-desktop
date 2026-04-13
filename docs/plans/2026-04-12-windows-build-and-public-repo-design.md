# Windows Build + Public Distribution Repo — Design

**Date:** 2026-04-12
**Context:** v0.1.2 Mac DMG shipped to private `mythopoetix/nikhil` releases. Marc Cooper (Windows) leaves Apr 14 for 6 weeks. Kim Bamford (Windows) Build Session 1 Apr 13. Public release URL needed so downloads don't 404 for non-collaborators.

---

## Goals

1. Produce an unsigned Windows .exe of ACE Desktop without touching a Windows machine locally.
2. Create a public front door where any client can download Mac + Windows builds, read the changelog, and report bugs.
3. Make future releases a one-command tag push, not a manual local build.

## Non-goals

- Code signing (Mac notarization, Windows Authenticode) — deferred.
- Auto-updater (`electron-updater`) — deferred.
- Open-sourcing the desktop code — explicitly out of scope; source stays private.
- Moving vault or skills out of `mythopoetix/nikhil`.

---

## Architecture

### Two repos, clear separation

**`mythopoetix/nikhil`** (private, unchanged) — source of truth for vault + `ace-desktop/` code. All development continues here.

**`actualize-ace/ace-desktop`** (new, public) — distribution-only. Holds:

- `README.md` — short product description, install instructions per-OS, link to issues.
- `CHANGELOG.md` — versioned release notes, replaces the public gist.
- GitHub Releases — every `.dmg` and `.exe` attached here.
- GitHub Issues — bug report destination, replaces the `mailto:` link.

Zero source. A fresh clone of the public repo contains only markdown.

### Release pipeline

Trigger: pushing a tag matching `ace-desktop-v*` to `mythopoetix/nikhil`.

```
git tag ace-desktop-v0.1.3
git push origin ace-desktop-v0.1.3
     │
     ▼
GitHub Actions workflow (.github/workflows/release.yml in private repo)
     │
     ├── job: build-mac (runs on macos-latest, arm64)
     │       npm ci → electron-rebuild → npm run dist
     │       artifact: dist/ACE-X.Y.Z-arm64.dmg
     │
     ├── job: build-win (runs on windows-latest, x64)
     │       npm ci → electron-rebuild → npm run dist
     │       artifact: dist/ACE-X.Y.Z-x64.exe
     │
     └── job: publish (needs both builds)
             uses PAT scoped to actualize-ace/ace-desktop
             creates release at tag on public repo
             uploads both artifacts
             body = CHANGELOG entry for this version
```

Runtime: ~10–15 min end-to-end. Zero Nikhil-time after the tag push.

### Cross-repo publish mechanism

Private repo's CI needs write access to public repo's Releases. Implementation:

1. Create a fine-grained PAT owned by `mythopoetix`, scoped to `actualize-ace/ace-desktop` with `contents: write` permission.
2. Store as secret `PUBLIC_REPO_TOKEN` in `mythopoetix/nikhil` Actions settings.
3. Publish job uses `gh release create` with `GH_TOKEN=$PUBLIC_REPO_TOKEN --repo actualize-ace/ace-desktop`.

### Windows-specific code changes

Preflight detection (`main.js`) and process management currently assume Unix. Required changes, each isolated to one commit:

1. **`ace.ico`** — generate from `assets/ace.png` (256×256 multi-res) via ImageMagick. Place at `assets/ace.ico`.
2. **`package.json` build config** — add `"win": { "target": "nsis", "icon": "assets/ace.ico" }`.
3. **Binary detection** — extend `findBinary()` helper with Windows known-paths for Node, Git, Claude CLI. Replace `which` with `where.exe` on `process.platform === 'win32'`. Pattern already established per `reference_packaged_electron_path` memory.
4. **Process kill** — `chat-manager.js` + `pty-manager.js` currently call `process.kill(pid, 'SIGTERM')`. On Windows, SIGTERM is ignored; use `spawn('taskkill', ['/pid', pid, '/T', '/F'])` behind platform check.
5. **npm scripts** — `env -u ELECTRON_RUN_AS_NODE` in `npm start` is Unix-only. Add `cross-env` dev dependency and replace with `cross-env ELECTRON_RUN_AS_NODE=`.

All five changes land on a branch (`windows-port`), reviewed, merged, then tagged.

---

## Risk register

| Risk | Likelihood | Mitigation |
|---|---|---|
| `better-sqlite3` or `node-pty` fails to build against Electron 34 headers on Windows x64 | Medium | Fallback: spin up a `t3.medium` Windows EC2 at $0.05/hr, reproduce interactively, backport fix to workflow. Cap debug time at 1 hr before falling back. |
| ConPTY + Claude CLI spawn fails inside xterm.js | Medium | First Windows install test reveals this. If broken, chat-only mode ships; terminal tab disabled on Windows until fixed. Not a blocker for v0.1.3. |
| Cross-repo PAT permissions wrong | Low | Test with a dummy `v0.1.3-rc1` tag against a `test-release` branch before real tag. |
| AA announce gate slips because Windows work bled in | Low, but high-cost if it happens | Hard sequencing: no Windows commits tomorrow morning until AA announce ships. |

---

## Migration of in-app links

Current alpha popover:

- Changelog → `https://gist.github.com/mythopoetix/aa39a1831b4358e0452e8aed777fda2a`
- Bug report → `mailto:` link

v0.1.3 swaps to:

- Changelog → `https://github.com/actualize-ace/ace-desktop/blob/main/CHANGELOG.md`
- Bug report → `https://github.com/actualize-ace/ace-desktop/issues/new`

Old v0.1.0–v0.1.2 installs continue pointing at the gist. Gist stays live indefinitely (no deletion).

---

## Sequencing against Apr 13 AA announce gate

1. **Tonight (Apr 12 late):** Design doc committed. Plan doc written. No code.
2. **Apr 13 morning:** AA + ACE MC2 announce work (Luma, copy, posts). Windows work frozen.
3. **After AA announce shipped:** Begin Windows port on `windows-port` branch. Incremental commits per memory `feedback_incremental_edits_only`.
4. **First Windows tag (`v0.1.3`):** CI builds, publishes to public repo. Share URL with Kim + Marc.
5. **If Kim's Apr 13 session arrives before .exe is ready:** she runs CLI for Build Session 1 — soft target per conversation.

---

## Success criteria

- [ ] `actualize-ace/ace-desktop` exists, public, with README + CHANGELOG + Issues enabled.
- [ ] Git tag `ace-desktop-v0.1.3` on `mythopoetix/nikhil` produces both a `.dmg` and a `.exe` published to `actualize-ace/ace-desktop/releases/tag/ace-desktop-v0.1.3` within 15 min with no manual intervention.
- [ ] .exe installs cleanly on a Windows machine (Marc's or a cloud VM), launches, passes setup preflight, shows the chat view.
- [ ] Alpha popover in v0.1.3 links to the public repo's CHANGELOG + Issues.
- [ ] AA + ACE MC2 announce gate Apr 13 shipped on time, untouched by this work.
