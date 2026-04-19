# MCP Resilience System — Design Doc

**Date:** 2026-04-17 (revised after deep research)
**Status:** Approved (v2 — post-research)
**Approach:** Four-layer defense with **`shell.openExternal` + token-file recovery** instead of PTY re-auth.

---

## What Changed After Research

The first draft assumed a PTY-driven `claude mcp auth <server>` flow. Verification showed:

- **No such subcommand exists.** Claude Code 2.1.92 `mcp` surface is: `add, add-from-claude-desktop, add-json, get, list, remove, reset-project-choices, serve`. No `auth` / `reauth` / `login`.
- **`mcp-remote` already handles OAuth itself** — it uses the `open` npm package to launch the system browser from a non-TTY child, runs an Express callback server on a pre-registered localhost port, and stores tokens at `~/.mcp-auth/mcp-remote-<version>/<hash>_tokens.json`.
- **The fix is filesystem-level, not CLI-level.** Deleting `<hash>_tokens.json` + `<hash>_code_verifier.txt` (keeping `client_info.json`) triggers a fresh OAuth flow on next spawn without re-registering the dynamic client.
- **Claude Code already exposes MCP health** via `claude mcp list` (emits `✓ Connected`, `✗ Failed to connect`, `! Needs authentication`) and caches failing servers at `~/.claude/mcp-needs-auth-cache.json`.
- **`--output-format stream-json` carries structured MCP events**: `mcp_instructions_delta` (server added/removed), `mcp_progress`, tool errors via normal `tool_result` with `isError:true`. Disconnects surface as a synthetic user message: `"The following MCP servers have disconnected..."`.
- **VS Code and Cursor both fail this UX.** Neither auto-refreshes. Neither offers inline recovery. Our opportunity is real.

---

## Problem (restated)

1. OAuth-based MCP servers (`mcp-remote` + Fathom, claude.ai Gmail/Calendar/Drive, Sentry, etc.) lose tokens. Google testing-mode invalidates refresh tokens every 7 days; other providers vary.
2. When tokens fail, the Claude Code CLI subprocess emits errors to stderr that the chat UI currently surfaces as raw text.
3. Clients who don't use MCP inherit user-scoped MCP config and see confusing errors for servers they never added.
4. No inline recovery path exists — the user has to leave ACE Desktop, find a terminal, and either manually reset tokens or re-run `claude mcp remove` / `add`.

---

## Solution: Four Layers

### Layer 1 — Lean Mode Suppression (Client Protection)

**Goal:** Clients who don't use MCP never see MCP errors.

**Mechanism:** `chat-manager.js` already passes `--strict-mcp-config` for OAuth/Max users in lean mode (line 95). CLI help confirms `--strict-mcp-config` without `--mcp-config` = zero MCP servers loaded. No code change needed — just document and test.

**Also reuse**: `~/.claude/mcp-needs-auth-cache.json` is populated by the CLI when it skips failing servers. This already suppresses `! Needs authentication` noise on re-runs; we inherit the behavior for free.

**Files:** `chat-manager.js` (verification only, no code change)

---

### Layer 2 — Structured MCP Event Detection

**Goal:** Catch MCP state changes from multiple channels and normalize to typed events.

**Three detection channels**, in priority order:

#### 2a. Stream-JSON envelope events (stdout, structured)

From `--output-format stream-json`. Handle in the existing stdout NDJSON parser:

| Event type | Meaning | UX action |
|---|---|---|
| `mcp_instructions_delta` with `removedNames[]` | Server disconnected mid-session | Toast: "Lost MCP server `<name>`" |
| `mcp_progress` | Long tool run progress | Surface progress indicator (future) |
| `tool_result` with `isError:true` from MCP tool | Tool call failed | Let existing error rendering handle |
| Error code `-32042` (`UrlElicitationRequired`) | Server requests browser URL | Forward to Layer 3 auth card |

#### 2b. mcp-remote stderr patterns (stdio subprocess)

`mcp-remote` logs with `[PID]` prefix to stderr. Buffer these lines per-process. Regex-stable patterns (verified against bundled source at `~/.npm/_npx/*/node_modules/mcp-remote/dist/chunk-*.js`):

```
Please authorize this client by visiting:\s*(https?://\S+)   → auth_url_ready (capture URL)
Authentication required. (?:Initializing auth|Waiting for authorization)  → auth_pending
Authorization error:                                          → auth_error (bad state)
Already attempted reconnection.*Giving up                     → auth_terminal_fail
Fatal error:                                                  → mcp_remote_crash
Connected to remote server using                              → auth_success (clear error state)
```

#### 2c. Claude CLI pre-init stderr (parent process)

These come from Claude Code itself when MCP servers fail at startup:

```
MCP server "(.+?)" requires re-authorization \(token expired\)        → cli_auth_expired
MCP server "(.+?)" is not connected                                   → cli_not_connected
Failed to connect to MCP server '(.+?)'                               → cli_connect_failed
MCP session expired during tool call                                  → cli_session_expired
Authentication required for (HTTP|claude\.ai proxy) server            → cli_auth_required
```

#### Buffering & flush rules

- Buffer stderr until first stdout chunk arrives **OR** `proc.exit` / `proc.close` fires (flushes on early crash).
- Guard the buffer handler with `if (stderrBuf)` against the null-race after flush.
- Each detected event becomes a `{ type: 'mcp-event', subtype, server, detail, authUrl? }` payload on the existing `CHAT_ERROR` IPC channel.

**Files:** `chat-manager.js` (~60 lines)

---

### Layer 3 — Typed Error Card in Renderer

**Goal:** Show contextually-correct recovery UI for each failure class, never raw text.

Reuse existing `binary-missing-card` CSS class. The card varies by subtype:

| Subtype | Title | Body | Primary action | Secondary |
|---|---|---|---|---|
| `auth_url_ready` | "Authorize `<server>`" | "Click to complete OAuth in your browser." | **Authorize in Browser** → `shell.openExternal(authUrl)` | Dismiss |
| `cli_auth_expired` / `auth_terminal_fail` | "`<server>` needs re-authentication" | "Tokens have expired and automatic refresh failed." | **Reset & Re-auth** → IPC to clear token files, respawn | Open logs |
| `mcp_remote_crash` | "`<server>` crashed" | `<detail trimmed>` | **Restart** → resend same message | Dismiss |
| `cli_not_connected` / `cli_connect_failed` | "`<server>` unavailable" | "The server is configured but couldn't connect." | **Check server** → open terminal to `claude mcp get <name>` | Dismiss |
| `mcp-disconnect` (from 2a) | Toast, not card | "Lost `<server>` during session" | — | Auto-dismiss 5s |

**Files:** `session-manager.js` (~80 lines for card variants + handlers), no CSS changes (all variants reuse existing card class with inline styles for the action buttons that already exist in `binary-missing-card`).

---

### Layer 4 — Filesystem-Level Auth Recovery (no PTY, no CLI subcommand)

**Goal:** One-click full re-auth without leaving the app or opening a terminal.

Because `mcp-remote` handles OAuth via `open` + Express callback, the entire flow works from an Electron child. Two recovery primitives:

#### 4a. Authorize-in-Browser (new tokens needed, no stale state)

When Layer 2b captures the `Please authorize this client by visiting: <URL>` line:

1. Renderer shows the `auth_url_ready` card with **Authorize in Browser** button.
2. Click → IPC `mcp:open-auth-url` → main process calls `shell.openExternal(url)`.
3. User completes OAuth in browser. mcp-remote's Express callback server receives the redirect, saves tokens, and the MCP subprocess becomes `✓ Connected` automatically.
4. Renderer closes the card when a `Connected to remote server using` line appears, OR when the chat successfully uses an MCP tool.

No PTY. No CLI subcommand. `shell.openExternal` is the whole story.

#### 4b. Reset & Re-auth (tokens present but broken)

For `cli_auth_expired`, `auth_terminal_fail`, or user-initiated reset:

1. Renderer → IPC `mcp:reset-auth` with `{ serverUrl, resource?, headers? }`.
2. Main process computes `md5(serverUrl + '|' + (resource || '') + '|' + JSON.stringify(sortedHeaders || {}))`.
3. Resolve cache dir: `~/.mcp-auth/mcp-remote-<version>/` — version comes from reading package.json inside `~/.npm/_npx/*/node_modules/mcp-remote/package.json`, OR by globbing `~/.mcp-auth/mcp-remote-*/` and picking the newest. Keep a fallback that strips all matching-hash files across all version dirs (safe — only tokens get deleted).
4. Delete:
   - `<hash>_tokens.json`
   - `<hash>_code_verifier.txt`
5. Keep:
   - `<hash>_client_info.json` (so dynamic client registration isn't repeated)
   - `<hash>_lock.json` (ownership state)
6. Also bust `~/.claude/mcp-needs-auth-cache.json` entry for the server (JSON edit, preserve other entries).
7. Respawn the chat request. On next spawn, `mcp-remote` sees no tokens, falls through to browser OAuth → Layer 4a path kicks in automatically.

#### Where server config comes from

MCP server config is split across two files (confirmed by direct inspection):
- **User scope** — `~/.claude.json` → `mcpServers` key. Servers added with `claude mcp add -s user`.
- **Project scope** — `<vaultPath>/.mcp.json` → `mcpServers` key. Servers added with `claude mcp add` (default) or `-s local`.
- `~/.claude/settings.json` has **no mcpServers** — this is the wrong file; do not use `CLAUDE_SETTINGS_READ` for this purpose.

For stdio servers using `npx mcp-remote@latest <url>`, the URL is the first `https?://` arg in `args[]`. For HTTP/SSE transport servers, URL is the `url` field. `mcp-auth.js` reads both files and merges them (`resolveServerUrl`). Read on demand per reset call, not cached (auth resets are rare; freshness matters more than perf).

**elicitation stream-json event** — When a CLI-served tool triggers URL elicitation, stream-json emits a `{ type: "system", subtype: "elicitation", mode: "url", url: "...", mcp_server_name: "...", elicitation_id: "..." }` event. This is NOT `event.error?.code === -32042` — that's the internal MCP wire error code which stream-json unwraps before emitting.

**Files:** `main.js` or new `mcp-auth.js` (~120 lines: cache-dir resolver, hash computer, reset handler, needs-auth-cache bust). New IPC channels: `mcp:open-auth-url`, `mcp:reset-auth`.

---

## Data Flow

```
Claude CLI spawn (chat-manager.js)
  ├─ stdout NDJSON ─→ parse stream-json events
  │                   ├─ assistant message → renderer
  │                   ├─ mcp_instructions_delta → toast (Layer 2a)
  │                   └─ tool_result isError → normal error flow
  │
  ├─ stderr ──→ buffer until first stdout OR process exit (null-guarded)
  │             ├─ mcp-remote "Please authorize: URL" → auth_url_ready card (Layer 2b)
  │             ├─ mcp-remote "Giving up" → auth_terminal_fail card
  │             ├─ mcp-remote "Fatal error" → crash card
  │             ├─ CLI "requires re-authorization" → cli_auth_expired card (Layer 2c)
  │             └─ non-MCP stderr → existing error rendering (unchanged)
  │
  └─ card action handlers (session-manager.js → IPC → main)
                ├─ Authorize in Browser → shell.openExternal(authUrl)   (Layer 4a)
                └─ Reset & Re-auth → delete token files + bust cache + respawn   (Layer 4b)
```

---

## What This Intentionally Does NOT Do

- **No PTY-driven auth commands.** `claude mcp auth` doesn't exist; even if it did, `shell.openExternal` is simpler and more reliable.
- **No LLM text parsing.** Only matches verified stderr strings from `mcp-remote` + Claude CLI source.
- **No custom OAuth client.** Delegates entirely to `mcp-remote`'s existing browser flow.
- **No MCP process lifecycle supervision from ACE.** Claude Code owns it. We just observe and recover.
- **No cross-version scraping of mcp-remote internals.** We only read the stable tokens.json cache dir. The regex patterns are tied to mcp-remote's public stderr surface, which has been stable across 0.1.x releases.
- **No startup MCP health probe.** Status comes from real chat stderr, not a pre-spawn `claude mcp list`. (Optional Phase 2 enhancement.)

---

## Files Changed

| File | Lines | Change |
|------|-------|--------|
| `src/chat-manager.js` | ~60 | Stderr buffer + null-guard + multi-channel MCP detection + structured events |
| `renderer/modules/session-manager.js` | ~80 | Typed error cards with per-subtype handlers |
| `src/main.js` or new `src/mcp-auth.js` | ~120 | `mcp:open-auth-url` + `mcp:reset-auth` IPC handlers, cache-dir resolver, hash computer |
| `src/ipc-channels.js` | ~4 | Register new channel names |

**Total:** ~260 lines across 4 files. No CSS. No new npm deps (uses built-in `crypto`, `fs`, `path`, Electron `shell`).

---

## Testing

Manual verification (project convention — no test framework):

**Happy path**
1. Configure Fathom MCP, tokens valid, send a chat message that uses a Fathom tool. Verify normal behavior, no cards.

**Auth URL path (Layer 4a)**
1. Delete `~/.mcp-auth/mcp-remote-0.1.37/<hash>_tokens.json` for Fathom (keep client_info.json).
2. Send a chat message. Verify: card appears titled "Authorize fathom" with **Authorize in Browser** button.
3. Click button. Verify: browser opens to Fathom's OAuth page. Complete flow.
4. Send another message. Verify: tool call works, card dismisses.

**Terminal failure path (Layer 4b)**
1. Corrupt `<hash>_client_info.json` (write `{}`) to force InvalidClientError.
2. Send a chat message. Verify: card shows "fathom needs re-authentication" with **Reset & Re-auth** button.
3. Click button. Verify: token files deleted, chat respawns, browser OAuth opens.

**Lean-mode suppression (Layer 1)**
1. Ensure no `ANTHROPIC_API_KEY` set.
2. Lean mode ON.
3. Configure a broken OAuth MCP server.
4. Send a chat message. Verify: no MCP errors, chat works normally (MCP server not loaded).

**Mid-session disconnect (Layer 2a)**
1. Start a chat with MCP working.
2. In a terminal, kill the `mcp-remote` subprocess mid-session (`pkill -f mcp-remote`).
3. Verify: toast appears "Lost MCP server fathom".

**Regression**
1. Normal chat without MCP — verify no new cards appear for ordinary errors.
2. Binary-missing error path still works (test with wrong claudeBin in config).

---

## Open Questions / Phase 2

- **HTTP transport OAuth (not mcp-remote)**: Claude CLI now supports `--transport http` with `--client-id` / `--callback-port`. These use a different OAuth flow. Detection patterns will differ. Defer until a user configures one.
- **Startup MCP health dashboard**: a panel showing `claude mcp list` status with per-server "Reset" / "Authorize" actions. Useful for ACE Desktop Settings view. Phase 2.
- **Per-server enable/disable**: VS Code/Cursor pattern — let users toggle individual MCP servers without editing `~/.claude.json`. Phase 2.
- **claude.ai proxy servers** (Gmail/Calendar/Drive): these show `! Needs authentication` with a different flow (likely `tengu_mcp_claudeai_proxy_401` internal metric). Needs its own detection branch. Phase 2.
