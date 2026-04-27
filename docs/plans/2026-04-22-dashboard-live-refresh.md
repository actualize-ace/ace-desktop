# Dashboard Live Refresh Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Wire the existing `onDashRefresh` IPC subscriber in `dashboard.js` so the dashboard re-renders automatically when vault files change — fixing both the Coherence Orb staleness after `/pulse` and the widget startup race where North Star / command bar render empty on first load.

**Architecture:** The infrastructure is already fully in place: `file-watcher.js` watches `system-metrics.md` (and other cockpit files) via chokidar and sends `DASH_REFRESH` IPC to the renderer on any change. `preload.js` already exposes `onDashRefresh(cb)`. `dashboard.js` already has a `cockpit-refresh` DOM listener — it just never subscribes to the IPC version. One listener line + one startup null-check closes both bugs.

**Tech Stack:** Electron renderer (vanilla JS, ES modules). No new dependencies. Manual verification via `npm start` + DevTools.

**No tests exist in ace-desktop.** Verification = visual `npm start` smoke test described at each step.

---

### Task 1: Subscribe to `onDashRefresh` IPC in dashboard.js

This fixes the Coherence Orb going stale after `/pulse`. When Claude CLI writes `00-System/system-metrics.md`, chokidar fires → `DASH_REFRESH` IPC → `loadDashboard()` re-runs → Orb re-reads fresh signals.

**Files:**
- Modify: `ace-desktop/renderer/dashboard.js:485-489`

**Step 1: Read the bottom of dashboard.js to confirm the exact insertion point**

Open `renderer/dashboard.js`, go to the end. You'll see:

```js
// Cockpit-refresh — re-render dashboard after card actions
window.addEventListener('cockpit-refresh', () => {
  loadDashboard()
})
```

This is lines ~485-488. The file ends here.

**Step 2: Add the IPC subscriber immediately after**

Add this block after the existing `cockpit-refresh` listener:

```js
// Vault-change refresh — re-render when cockpit files change on disk
// Covers: /pulse writing system-metrics.md, new daily notes, dca.md edits, etc.
// Infrastructure: file-watcher.js → DASH_REFRESH IPC → preload.onDashRefresh
if (typeof window.ace?.dash?.onDashRefresh === 'function') {
  window.ace.dash.onDashRefresh(() => loadDashboard())
}
```

The `typeof` guard is because `onDashRefresh` is exposed via contextBridge — if for any reason it's undefined, this won't crash.

**Step 3: Verify in DevTools**

```bash
cd ace-desktop && npm start
```

1. Open DevTools (Cmd+Option+I) → Console
2. Navigate to Dashboard view
3. In a separate terminal, run: `echo " " >> ~/Documents/Actualize/00-System/system-metrics.md`
4. Expected: Console shows no errors, dashboard re-renders within ~500ms (chokidar stabilityThreshold is 400ms)
5. Expected: No "Cannot read properties of undefined" errors

**Step 4: Test the Coherence Orb live**

1. In ACE Desktop, note the current Orb state (which signals are lit)
2. Open a chat session, run `/pulse`
3. Expected: After `/pulse` completes and writes `system-metrics.md`, the Orb updates without requiring `location.reload()`

**Step 5: Commit**

```bash
cd ace-desktop
git add renderer/dashboard.js
git commit -m "fix(dashboard): wire onDashRefresh IPC — orb + cockpit live-update after vault writes"
```

---

### Task 2: Add startup null-check retry for widget race

This fixes the intermittent empty North Star / command bar on first launch (race: IPC handlers in main.js resolve before vault-reader caches are warm → `getNorthStar()` returns null → widget renders empty and never re-renders since no files change on startup).

**Files:**
- Modify: `ace-desktop/renderer/dashboard.js` — inside `loadDashboard()`, after all data is fetched

**Step 1: Locate the data-fetch completion point**

In `loadDashboard()`, find the section that ends the parallel fetch block — around lines 86-92:

```js
await Promise.all([
  !data.getCompass      && window.ace.dash.getCompass().then(...),
  !data.getLastPulse    && window.ace.dash.getLastPulse().then(...),
  !data.getRitualStreak && window.ace.dash.getRitualStreak().then(...),
  !data.getCadence      && window.ace.dash.getCadence().then(...),
])
```

Right after this block (before `// Bundle allData for composite widgets`), add the null-check:

**Step 2: Add the retry guard**

```js
// Startup race guard — if critical data resolved null (vault-reader cache cold on slow
// disk / Windows), reschedule one re-render after 900ms. Idempotent: if data arrives
// correctly on retry, this branch never fires a second time.
if (!data.getNorthStar && !data.getDailyFocus) {
  setTimeout(loadDashboard, 900)
  return
}
```

Place it directly after the final `Promise.all([...])` block (the compass/lastPulse/ritualStreak/cadence block), before the `// Bundle allData` comment.

**Step 3: Verify startup behavior**

```bash
npm start
```

1. Quit the app fully (Cmd+Q), relaunch
2. Navigate immediately to Dashboard
3. Expected: North Star bar and command bar render populated within 1–2s even on first launch
4. Open DevTools, check Console: no extra render calls flooding (the guard should fire at most once)
5. If North Star loads correctly on first try: guard fired and returned early → no change in UX (fast-disk machines are unaffected)

**Step 4: Commit**

```bash
git add renderer/dashboard.js
git commit -m "fix(dashboard): startup null-check retry for widget race — North Star + command bar"
```

---

### Task 3: Verify v0.2.3 tag prereq — suppressMcp toggle

Before tagging v0.2.3, the `suppressMcp` toggle was left ON during perf testing. Must be turned OFF.

**Files:**
- Runtime config: `~/Library/Application Support/ACE/ace-config.json`

**Step 1: Check current state**

```bash
cat ~/Library/Application\ Support/ACE/ace-config.json | grep suppressMcp
```

Expected: `"suppressMcp": true` (was left ON from testing)

**Step 2: Turn it OFF**

Option A (in app): `npm start` → Settings → Chat Defaults → Visual Effects section → toggle "Suppress MCP" to OFF → close Settings.

Option B (direct edit): Edit `~/Library/Application Support/ACE/ace-config.json`, change `"suppressMcp": true` to `"suppressMcp": false`.

**Step 3: Smoke test**

```bash
npm start
```

1. Open a new chat session
2. Expected: MCP tools available (run `/start` — it should use Google Calendar MCP without timeout)
3. Dashboard renders: Stats Strip shows Sessions / Targets / Follow-ups / Last Pulse
4. No deal cards appear in Expansion pillar (ace-analytics surgical removal confirmed)

**Step 4: This does not require a commit** — `ace-config.json` is not tracked in git (it lives in userData, not vault).

---

## Execution Notes

- **Sequential only** — ace-desktop has no test framework. Each task requires a manual `npm start` smoke test before committing. Do not batch.
- **Branch**: `perf-hardening-apr20` — all tasks land here before v0.2.3/v0.2.5 tagging
- **After Task 3 smoke test passes**: tag `ace-desktop-v0.2.3` on `perf-hardening-apr20`
- **After Tasks 1+2 commit + smoke test**: tag `ace-desktop-v0.2.5`
- **Tag command**: `git tag ace-desktop-v0.2.5 && git push origin ace-desktop-v0.2.5` → CI builds + publishes automatically
