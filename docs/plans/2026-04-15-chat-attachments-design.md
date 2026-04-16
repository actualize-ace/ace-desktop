# Chat Attachments — Design Doc

**Date:** 2026-04-15
**Status:** Approved
**Requested by:** Joe Hawley, Craig (client feedback)

## Problem

Users want to upload images, PDFs, and text files into ACE Desktop chat sessions to give Claude visual/document context. Currently the only input is text.

## Scope

**Phase 1 (this release):**
- Terminal view rendered chats ✅
- Agents view rendered chats ✅ (same component)
- Raw terminal mode ❌ (not supported)

**Phase 2 (follow-up):**
- Oracle view

## Approach — Chip-First Composer (Option B)

Three entry points (drag-drop, paperclip button, clipboard paste) all funnel to a shared `stageAttachment(chatId, file)` renderer function. Files are copied into a vault-local folder. At send time, `@<relPath>` references are prepended to the user's prompt and passed to `window.ace.chat.send()` — Claude CLI reads the files natively.

### Architecture

```
[drag-drop / paperclip / paste]
        ↓
  stageAttachment(chatId, file)
        ↓
  IPC → main: ATTACHMENT_SAVE
        ↓
  main: copy file → <vault>/00-System/chat-attachments/YYYY-MM-DD/HHMMSS-name.ext
        ↓
  return { relPath, absPath, size }
        ↓
  renderer: push to session.pendingAttachments[]
        ↓
  render chip in tray
        ↓ (on send)
  prepend @relPath lines → chat.send(combinedPrompt)
  store attachments[] in message schema
```

### Composer Layout

```
[chat-controls: model · perms · effort]
[attachment-tray]   ← only visible when ≥1 staged
[📎][textarea                    ][↑ send]
```

### IPC Channels

```
ATTACHMENT_PICK  — opens native dialog, returns file info[]
ATTACHMENT_SAVE  — copies file into vault, returns relPath
```

Two save paths:
- **Path-based** (drag-drop, picker): renderer sends `{ sourcePath, targetName }`. Main `fs.copyFile()`. No bytes cross IPC.
- **Buffer-based** (clipboard paste only): renderer sends `{ buffer, targetName }`. Main `fs.writeFile()`.

### Vault Storage

```
<vault>/00-System/chat-attachments/
  2026-04-15/
    153022-screenshot.png
    153045-report.pdf
```

- Namespaced under `00-System/` to avoid colliding with user `attachments/` folders.
- `.gitignore` gets `00-System/chat-attachments/` appended idempotently on first save (only if `.gitignore` already exists).

### Filename Sanitization (main-side)

```js
name.replace(/\s+/g, '-').replace(/[^a-zA-Z0-9.\-_]/g, '')
```

- ASCII-safe, no spaces (prevents `@path` injection breakage)
- Extension preserved from original
- Prefixed with `HHMMSS-` to prevent same-day collisions

### Whitelisted File Types

| Category | Extensions |
|----------|-----------|
| Images   | png, jpg, jpeg, gif, webp |
| Docs     | pdf |
| Text     | txt, md |

Anything else → reject at save with `{ error: 'unsupported-type', ext }` → renderer shows toast.

### Message Schema Extension

```js
s.messages.push({
  role: 'user',
  content: prompt.trim(),        // user's typed text only (no @paths)
  timestamp: Date.now(),
  attachments: [                  // NEW — optional
    { relPath, name, type, size }
  ]
})
```

- `content` stays clean. `@<relPath>` prefix is constructed at send time, not stored.
- `relPath` only — absolute is recomputed as `path.join(vaultPath, relPath)` on load (vault-move safe).

### Prompt Injection Format

```
@00-System/chat-attachments/2026-04-15/153022-screenshot.png
@00-System/chat-attachments/2026-04-15/153045-report.pdf

Here's the report and screenshot I mentioned — what patterns do you see?
```

Relative paths from cwd (vault root). Avoids parent-path space issues.

### Composer Chip Tray

- `<div class="chat-attachments" id="chat-attachments-${id}">` between `.chat-controls` and `.chat-input-area`.
- Hidden when `pendingAttachments.length === 0`.
- Horizontal flex, wraps on overflow.
- Each chip: `[icon] filename.ext · 2.4MB [×]`
  - Icon: 🖼 image, 📄 pdf, 📝 text
  - Filename truncated to 24ch, full name on `title`
  - `×` removes from `pendingAttachments[]`, re-renders tray (file stays on disk)
  - Amber background if >5MB (soft warn)

### Paperclip Button

- SVG paperclip, monochrome, matches `↑` send aesthetic.
- Placed left of textarea inside `.chat-input-area`.
- Click → `ATTACHMENT_PICK` → `dialog.showOpenDialog({ properties: ['openFile', 'multiSelections'], filters })`.
- Tooltip: "Attach · drag, paste, or click"

### Drop Overlay

- `dragover`/`drop`/`dragleave` on `.chat-input-area`.
- Overlay div: dashed gold border + "Drop to attach" centered text.
- Uses warm attention gold (`#d4a574` / `rgba(212,165,116,…)`).

### Paste Handler

- `paste` listener on textarea.
- `if (e.clipboardData.files.length > 0) { e.preventDefault(); stage each }`.
- Falls through to default text-paste behavior otherwise.

### Sent Message Bubble

- Attachment chips render above message text (same chip style, no × button).
- Chip click → `shell.openPath(absPath)` (system default handler).
- If file no longer exists → chip renders muted + `title="File no longer available"`, click disabled.

### Size Handling

- Chip shows size inline (e.g., "4.2MB").
- >5MB: amber chip background (soft warning).
- >25MB: reject at save with toast ("File too large for chat context").

### Accessibility

- Paperclip: `aria-label="Attach file"`
- Chip ×: `aria-label="Remove attachment"`
- Drop zone: `role="region" aria-label="Drop files to attach"`

## Pressure-Tested Issues (Addressed Above)

1. Paths with spaces → relative paths from cwd + filename sanitization
2. IPC buffer bloat → path-based copy for drag/picker, buffer only for paste
3. Folder collision → namespaced to `00-System/chat-attachments/`
4. Client GitHub sync → idempotent `.gitignore` append
5. HEIC/unknown types → whitelist + reject toast
6. Paste text interference → gate on `files.length > 0`
7. Resume loses context → `attachments[]` in message schema, `relPath` only

## Deliberately Punted

- Orphan cleanup (staged but never sent)
- Disk-space monitoring
- Cross-session attachment sharing
- Raw terminal mode support
