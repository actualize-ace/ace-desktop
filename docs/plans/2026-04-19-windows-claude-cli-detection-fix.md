# Windows Claude CLI detection fix — impl plan

**Created:** 2026-04-19
**Trigger incident:** Marc Cooper's Session 5 install call ([Fathom](https://fathom.video/share/sTk5fY39cnseMm-xsXBTHSYLK85soGSG) at 1:05:41+)
**Status:** Planned, not started
**Urgency:** Medium — next Windows client (Craig) hits same bug. Also [project_ace_desktop_windows_cli_banner.md](../../../memory/project_ace_desktop_windows_cli_banner.md) is the memory pointer.

---

## Problem summary

On Windows first-launch of the packaged ACE Desktop app, a red error card displays **"Claude CLI failed to start"** and/or **"Claude CLI not found"**. Clicking **Re-detect** does not clear it. The CLI often initializes successfully underneath (a test chat message works), but the banner persists. At least two Windows clients have hit this (Marc 2026-04-19, plus an earlier unnamed Windows client Nikhil referenced in-call).

## Root cause analysis (pressure-tested)

### Things I initially got wrong (documented for the record so we don't re-trip them)

1. **"`where.exe` skips `.cmd` without PATHEXT"** — WRONG. `PATHEXT` is inherited from the Windows shell session that launched the app and always has the system default. Adding `PATHEXT` to the augmented env is a no-op.

2. **"`fs.accessSync(X_OK)` rejects `.cmd` on Windows"** — WRONG. Per Node docs, `X_OK` on Windows is equivalent to `F_OK` (existence only). The `not-executable` branch in [chat-manager.js:30-34](../../src/chat-manager.js) never fires for `.cmd`/`.bat` files.

### The actual root cause

Two separate bugs, compounding:

**Bug A — Silent acceptance of unusable path in [main.js:108-189](../../main.js):**

When `npm install -g @anthropic-ai/claude-code` runs on Windows, npm creates three files in `%APPDATA%\npm\`:
- `claude` (bash script, no extension — for Git Bash)
- `claude.cmd` (cmd.exe wrapper)
- `claude.ps1` (PowerShell wrapper)

The detection pipeline:
1. `execSync('where.exe claude', { env: augmentedEnv })` at [main.js:152](../../main.js#L152) returns multi-line output. First line is often the extensionless `claude` (bash script).
2. `.split(/\r?\n/)[0]` takes the first line only.
3. `fs.existsSync(result)` → TRUE.
4. `execSync('"${found}" --version')` at [main.js:180](../../main.js#L180) throws because cmd.exe can't execute a shebang-less shell script on Windows.
5. The catch at [main.js:186-188](../../main.js#L186-L188) silently returns `{ path: found, version: null }` — **detection "succeeds" with an unusable path.**
6. Path saved to `ace-config.json` as `claudeBinaryPath`.
7. On first chat, [chat-manager.js:189](../../src/chat-manager.js#L189) checks `needsShell = /\.(cmd|bat)$/i.test(claudeBin)` → FALSE for the extensionless file.
8. `spawn()` fires `proc.on('error')` ([chat-manager.js:200-208](../../src/chat-manager.js#L200-L208)) → emits `spawn-failed` → red "Claude CLI failed to start" card.

**Bug B — Stale banner in [renderer/modules/session-manager.js:522-571](../../renderer/modules/session-manager.js):**

The `onError` handler appends `binary-missing-card` / `chat-error` cards to the chat DOM but **never removes them**. Grep confirms: zero `.binary-missing-card` removal sites in the renderer. The "Re-detect" button updates global `__preflightResult` state but orphaned cards in the chat DOM have no observer for that state. So even after detection gets fixed and chats work, the red card persists forever.

**Bug C — No PowerShell fallback on Windows (edge-case):**

Guard at [main.js:158](../../main.js#L158) reads `if (!found && process.platform !== 'win32')`, so the login-shell fallback is Mac/Linux only. Users with custom npm prefix (`npm config set prefix ...`), nvm-windows, or volta-for-windows installs register their binary only in their PowerShell profile — we miss it. Lower priority than A/B (stock npm install hits known paths), but cheap to add.

---

## The fix — three patches

### Patch 1: [main.js](../../main.js) — multi-candidate detection with reject-on-verify-fail

Replace the single-candidate pipeline (where.exe → existsSync → save) with a candidate-list pipeline (collect from all strategies → try each → first that passes `--version` wins → null if none).

**Changes:**
- Parse ALL lines from `where.exe` output, not just `[0]`.
- On Windows, rank candidates: `.exe` (0) > `.cmd` (1) > `.bat` (2); filter out extensionless and `.ps1` (spawn can't execute `.ps1` without an explicit powershell invocation).
- Collect from three strategies: PATH lookup, login-shell / PowerShell fallback, known paths.
- **Critical:** change the `catch` at line 186-188 from `return { path, version: null }` to fall through to the next candidate. Never return a path that failed `--version`.
- Return `null` if no candidate passes.

**Pseudocode:**
```js
const candidates = []
// 1. where.exe / which
try {
  const lines = execSync(...).trim().split(/\r?\n/).map(s => s.trim()).filter(Boolean)
  if (win32) {
    lines.filter(p => /\.(exe|cmd|bat)$/i.test(p))
         .sort((a,b) => rankWin(a) - rankWin(b))
         .forEach(p => candidates.push(p))
  } else {
    candidates.push(...lines)
  }
} catch {}

// 2. login shell (mac/linux) OR powershell (win)
if (!win32) {
  try { candidates.push(execSync(`${shell} -l -c 'which claude'`, ...).trim().split(/\r?\n/)[0]) } catch {}
} else {
  try {
    const r = execSync(`powershell -Command "(Get-Command claude -EA SilentlyContinue).Source"`, { timeout: 5000 }).trim().split(/\r?\n/)[0]
    if (r && /\.(exe|cmd|bat)$/i.test(r)) candidates.push(r)
  } catch {}
}

// 3. known paths
candidates.push(...KNOWN_PATHS)

// Try each — first that actually runs wins
const tried = new Set()
for (const p of candidates) {
  if (tried.has(p) || !fs.existsSync(p)) { tried.add(p); continue }
  tried.add(p)
  try {
    const version = execSync(`"${p}" --version`, { encoding: 'utf8', timeout: 5000, env: augmentedEnv }).trim()
    return { path: p, version }
  } catch {}
}
return null
```

### Patch 2: [renderer/modules/session-manager.js](../../renderer/modules/session-manager.js) — sweep stale cards on success

In the `result` event handler ([line 501](../../renderer/modules/session-manager.js#L501)), after `finalizeMessage(id, sessionsObj)`, remove any existing error cards since we now have proof the CLI is working:

```js
if (event.type === 'result') {
  updateChatStatus(id, event, sessionsObj)
  finalizeMessage(id, sessionsObj)
  // CLI is demonstrably working — sweep any stale error cards left over
  // from pre-detect or prior spawn failures so the UI matches reality.
  const msgsEl = document.getElementById('chat-msgs-' + id)
  msgsEl?.querySelectorAll('.binary-missing-card, .chat-error').forEach(el => el.remove())
  // ... existing permission_denials logic
}
```

**Caveat to check before shipping:** `.chat-error` is also used for non-binary errors (generic stderr surface at [session-manager.js:565-568](../../renderer/modules/session-manager.js#L565-L568)). Sweeping ALL `.chat-error` on every success may hide real transient errors that should persist. Safer: sweep only `.binary-missing-card`, leave generic `.chat-error` alone. Confirm before patching.

### Patch 3 (optional): preflight banner tied to live state

Longer-term — refactor the error card to subscribe to preflight state changes rather than being a static DOM append. When `recheckBinary()` succeeds and `global.CLAUDE_BIN` is valid, emit a `cli-ready` IPC event; cards listen and self-remove. More invasive but eliminates the class of "stale append" bugs entirely. Defer unless Bugs A/B resurface post-fix.

---

## Testing strategy

### Mac-side (what Nikhil can run today)

1. **No-regression smoke test** — `npm start`, open chat, send "hello", verify response.
2. **Fresh-install simulation** — delete `~/Library/Application Support/ACE/ace-config.json` per [feedback_ace_desktop_dual_config.md](../../../memory/feedback_ace_desktop_dual_config.md), relaunch, run setup, confirm detection picks real `claude`.
3. **Reject-broken-candidate test (THE key new logic):**
   ```bash
   mkdir -p /tmp/fake-bin
   printf '#!/bin/bash\nexit 127\n' > /tmp/fake-bin/claude
   chmod +x /tmp/fake-bin/claude
   PATH="/tmp/fake-bin:$PATH" npm start
   ```
   Old code would save `/tmp/fake-bin/claude` and fail at chat time. New code should reject at `--version` and fall through to login-shell or known-paths, landing on real `claude`. This directly exercises the same class of bug Marc hit — the value-add of the "try next candidate" logic is testable on Mac even though the triggering path (`where.exe` first-line ambiguity) is Windows-only.

4. **Stale-card sweep test (patch 2):** force a `binary-missing` card by temporarily corrupting `claudeBinaryPath` in `ace-config.json` to a nonexistent path, launching, confirming card appears, clicking Re-detect (which should now find real claude), sending a test chat, confirming card disappears on `result`.

### Windows-side validation options (pick at least one before shipping)

| Option | Cost | Confidence | Risk |
|---|---|---|---|
| **A. GitHub Actions Windows runner probe** — new workflow job that `npm install -g @anthropic-ai/claude-code` + runs detection code on fresh Windows runner, asserts `version` is non-null | ~30min setup | High — deterministic, fresh env per run, standing regression guard | Low |
| **B. Ask Marc / Craig for `where.exe claude` + `npm config get prefix` output** via WhatsApp | ~30s their time | Confirms hypothesis, doesn't test fix | Low (mild friction for Marc) |
| **C. Windows VM on Mac (Parallels / UTM)** | ~2hr + license | Highest | Low |

**Recommended:** A + B. The Actions probe becomes a permanent regression test for every Windows client onward. B confirms hypothesis for this specific incident.

**NOT recommended:** ship blind to Marc as v0.2.3 — per [feedback_pretag_uncommitted_audit.md](../../../memory/feedback_pretag_uncommitted_audit.md), clients shouldn't be the regression suite, especially when the client is already friction-y on their onboarding arc.

---

## Execution checklist (when you pick this up)

- [ ] Read the [chat-pipeline-refactor baking notes](2026-04-18-chat-pipeline-refactor-impl.md) — confirm no conflicting changes landed mid-flight
- [ ] Confirm `.chat-error` sweep scope with quick grep of non-binary error sites
- [ ] Patch 1: refactor `detectClaudeBinary()` in [main.js:108-189](../../main.js#L108-L189). Run Mac-side tests 1-3 above.
- [ ] Patch 2: sweep stale cards in [session-manager.js:501](../../renderer/modules/session-manager.js#L501) `result` handler. Run Mac-side test 4.
- [ ] Add GitHub Actions Windows probe (new workflow file or extend existing build workflow)
- [ ] (Optional) WhatsApp Marc: `where.exe claude` + `npm config get prefix` to confirm hypothesis
- [ ] Bump version to v0.2.3 in [ace-desktop/package.json](../../package.json)
- [ ] Update [CHANGELOG.md](../../CHANGELOG.md) + [ROADMAP.md](../../ROADMAP.md) per [feedback_roadmap_update_on_ship.md](../../../memory/feedback_roadmap_update_on_ship.md)
- [ ] Pre-tag audit per [feedback_pretag_uncommitted_audit.md](../../../memory/feedback_pretag_uncommitted_audit.md): `git diff --stat HEAD -- ace-desktop/`
- [ ] Tag `ace-desktop-v0.2.3` → CI builds + publishes per [feedback_release_ci_workflow.md](../../../memory/feedback_release_ci_workflow.md)
- [ ] Coordinate: tell Marc a new build is ready with install one-liners from [reference_ace_desktop_mac_install.md](../../../memory/reference_ace_desktop_mac_install.md) (Windows-equivalent needed)
- [ ] Update [project_ace_desktop_windows_cli_banner.md](../../../memory/project_ace_desktop_windows_cli_banner.md) — mark resolved with commit SHA

## Related files (quick-open index)

- Detection: [main.js:76-189](../../main.js#L76-L189)
- Detection IPC: [main.js:374-376, 470-479](../../main.js#L470-L479)
- Chat spawn + binary diagnosis: [src/chat-manager.js:26-36, 77-208](../../src/chat-manager.js#L26-L36)
- Error card render: [renderer/modules/session-manager.js:522-571](../../renderer/modules/session-manager.js#L522-L571)
- Setup flow: [renderer/setup.html:595-760](../../renderer/setup.html)
- Related memory: [project_ace_desktop_windows_cli_banner.md](../../../memory/project_ace_desktop_windows_cli_banner.md), [reference_packaged_electron_path.md](../../../memory/reference_packaged_electron_path.md), [reference_client_platforms.md](../../../memory/reference_client_platforms.md)
