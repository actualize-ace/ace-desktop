# Changelog

All notable changes to ACE Desktop are documented here. Format based on [Keep a Changelog](https://keepachangelog.com/).

## [Unreleased]

## [0.1.2] — 2026-04-12

### Fixed
- Setup preflight: Node.js + Git detection falls back to known install paths when packaged Electron app doesn't inherit shell `PATH` (GUI-launched apps on macOS).
- Sidebar collapsed state: Learn icon centers cleanly; status pulse + version badge hide in collapsed state.

## [0.1.1] — 2026-04-12

### Added
- Setup screen redesigned with ACE purple-dark palette, nebula backdrop, starfield, ACE mark as background watermark.
- Extended preflight checks — Node.js (≥20) + Git alongside Claude CLI + Vault. Soft warnings, don't block launch.
- Info popovers on every preflight check with install links.
- `ALPHA` pill in titlebar (click for details) + clickable sidebar version badge — shared popover with version + known limitations + changelog link + bug-report link.

### Changed
- Removed Anthropic API key step from setup — synthesis uses Claude CLI + Max subscription, not the SDK.
- Settings panel reorganized: Chat → Display → Sidebar Commands → Startup → Cost & Safety → System.
- Default View dropdown now includes all main views.

### Fixed
- Vault Change + Claude Binary Re-detect buttons (return-shape bugs).
- Dropped dead Daily Spend Warning setting.

## [0.1.0] — 2026-04-12

### Added
- First packaged Mac DMG (unsigned, arm64).
- Electron 34.5.8 + Node 20 LTS + Chrome 132.
- Dashboard, Command Center, Agent Terminal, Insight, People, Knowledge Graph views.
- Claude CLI chat integration with `stream-json` + `--resume` multi-turn.
- Interactive Learn tab with 8-lesson Essentials track (Triad intro, Vault, Command Center, Chat, Session Rails, /start, /eod, Going Deeper).
- Spotlight overlay with pulsing gold ring + scroll-into-view; welcome bloom on fresh install.
- App renamed to **ACE** (from ACE Desktop); icon updated to current brand mark.

### Known limitations
- Unsigned build — macOS requires right-click → Open on first launch.
- Auto-update not wired — new releases require manual re-install.
- Windows build in development.
- No code signing / notarization yet.
