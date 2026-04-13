# Setup Screen Polish — Design

> Phase 1 Mac Ship. Target: Joe Hawley (macOS, vault pre-configured).
> Approved: 2026-04-10

---

## Problem

The setup screen and app launch flow have gaps that would cause confusing failures for a client:

1. **Binary detection is file-only.** Checks `fs.existsSync()` but never verifies the binary actually runs. If Claude CLI is broken, corrupt, or wrong version, the app loads fine and then throws raw spawn errors on first chat.
2. **No per-session binary re-check.** Binary detected once at setup, stored in config forever. If PATH changes or binary is removed, no recovery path — just cryptic errors.
3. **Vault validation is `.mcp.json` only.** No structural check. Missing `00-System/state.md` crashes the dashboard. `vault-health.js` exists with full manifest-based checking but is only called post-load from the dashboard.
4. **Non-vault folders can pass setup.** `checkReady()` requires `vaultPath` + `binaryPath` but not `vaultValid`. User can pick any folder and launch into a broken app.
5. **No "system ready" signal.** App loads views immediately with no pre-flight. No `/start` prompt. User has to know what to do.

---

## Design

### 1. Pre-flight Module (`src/preflight.js`)

New module. Called once in `main.js` after window loads, before file-watcher starts. Async, non-blocking — window renders immediately, results arrive via IPC.

**Three checks, sequential:**

#### 1a. Binary Health

```
existsSync(path)
  → accessSync(path, fs.constants.X_OK)
  → execSync(`${path} --version`, { timeout: 5000 })
```

Returns: `{ ok: true, path, version }` or `{ ok: false, error, path }`

Error codes:
- `missing` — file doesn't exist at configured path
- `not-executable` — file exists but not executable
- `not-responding` — exists + executable but `--version` times out or fails

#### 1b. Vault Structure

Calls existing `vault-health.checkVaultHealth(vaultPath)`.

Classifies missing items:
- **Critical** (`tier: 'engine'`) — files the app crashes without. Get "Repair" action.
- **Non-critical** (`tier: 'scaffolding'`) — informational warning only.

#### 1c. Result Event

Single IPC event `preflight-result` sent to renderer:

```json
{
  "binary": { "ok": true, "path": "/path/to/claude", "version": "1.0.30" },
  "vault": { "ok": false, "score": 85, "critical": [...], "other": [...] }
}
```

### 2. Renderer Surfaces

Three surfaces consume the pre-flight result:

#### 2a. Binary Status Indicator

Location: titlebar area, near existing context bar. Hidden when healthy.

When unhealthy:
- Amber dot + message: "Claude CLI not found" / "Claude CLI not responding"
- Click expands a card with specific error + two actions: **[Re-detect]** and **[Open Settings]**
- Auto-hides when re-detect succeeds

#### 2b. Vault Health Banner (enhanced)

Existing dashboard banner (`dashboard.js` lines 70-85) enhanced to distinguish tiers:
- Critical: "2 engine files missing — [Repair]" (calls `scaffoldAll` for engine-tier only)
- Non-critical: "3 optional files missing" (info, no action)
- Existing health score stays

#### 2c. Chat Input `/start` Hint

When pre-flight passes (binary ok + vault ok or repaired):
- First Command Center session placeholder changes from "Message ACE..." to "Type /start to begin your day"
- First load only — once user types anything, standard placeholder returns

### 3. Spawn Guards (Belt-and-Suspenders)

Handles the mid-session edge case where binary disappears after pre-flight passed.

#### 3a. `chat-manager.js`

Before `spawn(claudeBin, args, ...)`:
```javascript
if (!fs.existsSync(claudeBin)) {
  win.webContents.send(`${ch.CHAT_ERROR}:${chatId}`, JSON.stringify({
    type: 'binary-missing', path: claudeBin
  }))
  return
}
```

#### 3b. `pty-manager.js`

Same guard before `pty.spawn()`. Returns error via `PTY_ERROR` channel.

#### 3c. Renderer Error Handler

`onError` checks for `type: 'binary-missing'` → renders styled card instead of raw text:

> Claude CLI not found at `/path/to/claude`.
> It may have been moved or uninstalled.
> **[Re-detect]** **[Open Settings]**

### 4. Setup Screen Refinements

Existing 3-step flow, layout, and styling unchanged.

#### 4a. Binary Verification Upgrade

`detectClaudeBinary()` in `main.js` enhanced: after finding path, runs `claude --version` (5s timeout). Returns `{ path, version }` on success. Setup screen shows version string next to green dot.

#### 4b. Vault Validation Gate

- `checkReady()` now requires `state.vaultValid` (not just `state.vaultPath`).
- When folder picked but isn't a valid vault, amber warning replaced with:
  *"Please select your ACE vault folder. If you haven't received your vault yet, your operator will set it up during your first session."*
- Button stays disabled until valid vault selected.

---

## IPC Channels (new)

| Channel | Direction | Payload |
|---------|-----------|---------|
| `preflight-result` | main → renderer | `{ binary, vault }` |
| `preflight-recheck-binary` | renderer → main | (none) |

Existing channels reused: `DETECT_BINARY`, `VAULT_HEALTH_CHECK`, `VAULT_SCAFFOLD_ALL`, `CHAT_ERROR`, `PTY_ERROR`.

---

## Files Changed

| File | Change |
|------|--------|
| `src/preflight.js` | **New** — pre-flight check module |
| `src/ipc-channels.js` | Add 2 channels |
| `main.js` | Call preflight after window load, enhance `detectClaudeBinary()` |
| `preload.js` | Expose `preflight` namespace (onResult, recheckBinary) |
| `src/chat-manager.js` | Add binary guard before spawn (~5 lines) |
| `src/pty-manager.js` | Add binary guard before spawn (~5 lines) |
| `renderer/index.html` | Binary status indicator in titlebar |
| `renderer/dashboard.js` | Enhance vault health banner (critical vs non-critical) |
| `renderer/modules/session-manager.js` | `/start` placeholder logic, styled binary-missing card |
| `renderer/setup.html` | Version display, vault validation gate, messaging |

---

## Out of Scope

- AI-guided vault building (Future — Guided Onboarding Flow)
- MCP wizard / integration setup
- Windows binary detection paths
- API key validation beyond format check
- Auto-update
