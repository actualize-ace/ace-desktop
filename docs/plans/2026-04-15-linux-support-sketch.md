# Linux Support — Direction Sketch

**Status:** Sketch only, not an implementation plan
**Date:** 2026-04-15
**Target version:** v0.2.1
**Test target:** Aleksander Brankov — Linux build due 2026-04-21

> **For next session:** Run `superpowers:writing-plans` to turn this sketch into an ordered implementation plan with verification gates per task. Save the result as `2026-04-15-linux-support.md` (drop the `-sketch` suffix).

---

## Why

Aleksander Brankov is a current ACE client on Linux. His build is due 2026-04-21. The CI workflow already handles Mac arm64, Mac x64, and Windows NSIS in parallel — Linux is the missing leg. AppImage is the natural fit: universal across distros, no install required, runs from a single file.

## Goal

Ship v0.2.1 with Linux as a fully supported platform in the release pipeline. Aleksander downloads an AppImage from [actualize-ace/ace-desktop/releases](https://github.com/actualize-ace/ace-desktop/releases) the same way Joe and Marc do.

---

## What changes

### 1. `ace-desktop/package.json` — add `linux` target to electron-builder config

```json
"linux": {
  "target": ["AppImage"],
  "category": "Office",
  "icon": "assets/ace.png",
  "artifactName": "ACE-${version}-${arch}.${ext}"
}
```

Decision needed: AppImage only, or AppImage + deb + rpm? AppImage alone is simplest. Native packages (deb/rpm) are nicer for users on specific distros but add CI time and test surface.

### 2. Binary detection — extend path lists for Linux

Currently these files branch on `process.platform === 'win32'` vs. an else branch that assumes Mac (Homebrew paths). Linux falls through to the Mac branch and misses its standard locations.

Files to update:
- [src/pty-manager.js](../../src/pty-manager.js) — two PATH-augmentation sites (lines 16, 83)
- [src/preflight.js](../../src/preflight.js) — binary path fallback (line 31)
- [src/chat-manager.js](../../src/chat-manager.js) — spawn PATH augmentation (line 110)

Linux paths to add:
- `/usr/local/bin`
- `/usr/bin`
- `~/.local/bin`
- `/snap/bin`
- nvm: `~/.nvm/versions/node/*/bin`
- volta: `~/.volta/bin`
- fnm: `~/.local/share/fnm/node-versions/*/installation/bin`
- asdf: `~/.asdf/shims`
- mise: `~/.local/share/mise/shims`

Pattern: three-way branch (`win32` | `darwin` | fallthrough Linux) rather than binary `win32` vs. else.

### 3. CI workflow — `.github/workflows/release.yml`

Add a `build-linux` job running on `ubuntu-latest`:

- Same checkout + setup-node@20 + setup-python@3.11 preamble
- `npm ci` in `ace-desktop/`
- `npx electron-builder --linux AppImage` (skip signing — unsigned is fine on Linux)
- Upload `ace-desktop/dist/*.AppImage` as artifact named `linux-appimage`

Extend the `publish` job:

- Add a download step for `linux-appimage`
- Extend the `gh release create` command to include `artifacts/*.AppImage`
- Update the notes to mention Linux: "Linux (x64): download the AppImage, `chmod +x`, then run."

### 4. Icon

`assets/ace.png` should already exist (we reference it in landing pages). electron-builder auto-generates the right sizes. No new asset work needed — verify before building.

---

## Risks + known gotchas

1. **FUSE missing on Ubuntu 22.04+ / 24.04** — AppImage needs `libfuse2`. Solution: document the install instruction (`sudo apt install libfuse2`) in release notes, or bundle with `appimage-builder` (heavier).

2. **chrome-sandbox SUID** — some distros strip SUID from the bundled `chrome-sandbox` binary. Symptom: app fails to launch with "sandboxing error." Workaround: document `--no-sandbox` flag OR set SUID on the extracted binary. AppImage usually handles this via its runtime.

3. **native module rebuild** — better-sqlite3 + node-pty should have prebuilt Linux x64 binaries. If prebuilt binary download fails in CI, fall back to building from source (needs `build-essential` + `python3` on runner — already installed on `ubuntu-latest`).

4. **Wayland vs X11** — Electron defaults to X11 via XWayland; mostly transparent. Some HiDPI scaling issues possible. Aleksander's feedback will surface these.

5. **package-lock.json drift** — if it was last synced on macOS, some optional deps may be Mac-only. `npm ci` on Linux usually handles this; if it fails, regenerate lockfile on Linux.

6. **Wayland clipboard** — image paste in chat (shipped in v0.2.0) may behave differently. Needs smoke test.

---

## Aleksander test protocol (draft)

Minimum verification before he's productive:

1. Download AppImage, `chmod +x`, launch — app opens, setup screen renders
2. Binary detection finds Claude CLI (or manual picker works)
3. Vault path selected — dashboard loads without error
4. Chat: send a prompt, receive streamed response
5. Agent Terminal: spawn a Claude Code session, interact for 2 minutes
6. Attachment flow: paperclip + drag-drop + screenshot paste
7. Slash menu `/start` renders and executes
8. Close + reopen — state persists, config survives

Report format: what worked, what broke, paste logs from `~/.config/ACE/` if errors.

---

## Out of scope for v0.2.1

- Native deb/rpm packages (AppImage only in v1)
- Snap / Flatpak
- Linux ARM64 builds (Raspberry Pi etc.)
- Code signing with GPG
- Auto-update via electron-updater on Linux
- Wayland-native build (keep XWayland)
- HiDPI scaling tuning

---

## Success criteria

- `.github/workflows/release.yml` builds AppImage on every `ace-desktop-v*` tag push
- Aleksander launches v0.2.1 on his Linux machine and completes a /start session without workaround
- Release notes document the Linux install path
- No regression on Mac or Windows builds (the new Linux job runs in parallel, shouldn't interact)

---

## Next step

Open a new Claude Code session. First message:

> Plan Linux support for ACE Desktop v0.2.1. Use `superpowers:writing-plans` for a task-by-task implementation plan with verification gates per step. Reference [`ace-desktop/docs/plans/2026-04-15-linux-support-sketch.md`](.) as the starting direction. Aleksander Brankov is the test target, due 2026-04-21. AppImage is the primary format.

That invokes the planning skill and produces an ordered plan with checkboxes, not a sketch.
