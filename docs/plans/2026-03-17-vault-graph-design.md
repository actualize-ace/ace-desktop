# Phase 3: Vault View + Knowledge Graph — Design Doc

**Date:** 2026-03-17
**Branch:** feature/ace-desktop
**Status:** Approved — ready for implementation

---

## Overview

Phase 3 adds two new views to ACE Desktop: a **Vault View** (file tree + markdown reader) and a **Knowledge Graph** (Cytoscape.js force-directed graph of wikilink connections). Both are backed by a shared `vault-scanner.js` main process module that walks the vault and parses `[[wikilinks]]`.

---

## Architecture

### New Files

```
src/vault-scanner.js        # walks vault tree + parses [[wikilinks]] → {nodes, edges}
```

### Existing Files Modified

```
src/ipc-channels.js         # add vault-scan channel
main.js                     # register vault-scan IPC handler
preload.js                  # expose window.ace.vault.scan()
renderer/index.html         # replace vault stub + add graph view + CSS + JS
package.json                # add cytoscape dependency
```

### New IPC Channel

```
vault-scan    invoke/handle    → returns { nodes: [{id, label, folder, connections}], edges: [{source, target}] }
```

Existing channels (`vault-list-dir`, `vault-read-file`) are unchanged and used as-is.

### Data Flow

**Vault View:**
```
vault.listDir(path) → render tree → click .md file → vault.readFile(path) → marked + DOMPurify → render HTML
```

**Graph View:**
```
vault.scan() → vault-scanner.js walks all .md → extracts [[wikilinks]] → {nodes, edges}
             → Cytoscape renders force graph → hover highlights neighbors → click opens file in vault reader
```

### Dependencies

```
npm install cytoscape
```
One package, ~300KB, no sub-dependencies.

---

## Vault View Design

### Layout

Split pane:
- **Left panel:** 240px file tree, collapsible to 0
- **Right panel:** fills remaining width, markdown reader

### File Tree

- Folders expand/collapse inline (click to toggle, chevron indicator)
- Active file: gold left-border indicator (`#d4a574`)
- Non-`.md` files: shown, dimmed, not clickable for preview
- Root starts at vault path from config

### Markdown Reader

- Rendered via `marked` + `DOMPurify` (already installed)
- Typography: headings in Space Grotesk, body in DM Sans, code in JetBrains Mono with subtle background
- `[[wikilinks]]` rendered as gold-colored `<span>` elements (display only, not navigable in Phase 3)
- Empty state: "Select a file to read" placeholder

### Header Bar

- Left: breadcrumb path of open file (e.g. `00-System / core / coach-constitution.md`)
- Right: search icon (⌘K) for file-name search + collapse toggle (⊞/⊟)

### State Persistence

- Last-opened file path stored in `localStorage['ace-vault-last-file']`
- Restored on next visit to the vault view

---

## Graph View Design

### Layout

Full-width Cytoscape canvas. Header bar with filter dropdown, reset, and center controls.

### Node Styling

Colors match ACE color scheme (folder-based):
- `00-System` → blue `#6b8cba`
- `01-Journal` → orange `#d4a574`
- `Domains/asraya` → green `#6db88f`
- `Domains/` (other) → purple `#9b74c4`
- `04-Network` → yellow `#c4b574`
- Everything else → grey `#6b7280`

Node size: scales with connection count (min 12px, max 40px).

### Edge Styling

- Directional arrows: A → B when A contains `[[B]]`
- Bidirectional links (A ↔ B): thicker stroke weight

### Interaction

- Zoom/pan freely (mouse wheel + drag)
- Hover node → highlight direct neighbors, dim everything else
- Click node → switch to vault view, load that file in the reader
- Filter dropdown → show only one folder's subgraph, or filter by min connection count ("hubs: 3+")
- Reset → clear filter, re-center graph

### Scanner Behavior

- `vault-scanner.js` runs on first graph view load
- Result cached in memory (main process)
- Rebuilds when chokidar fires a `.md` change event (reuses existing file-watcher infrastructure)
- Target build time: <200ms for ~500-node vault

### Cytoscape Layout

```javascript
layout: {
  name: 'cose',        // built-in force-directed (no extra package needed)
  animate: false,      // instant layout on load
  randomize: false,
  nodeRepulsion: 8000,
  idealEdgeLength: 80,
}
```

Note: `cose-bilkent` requires a separate npm package. Use built-in `cose` instead — same quality for this use case, zero additional dependency.

---

## Out of Scope (Phase 3)

- Wikilink navigation (clicking `[[link]]` in reader opens that file) — Phase 4
- Full-text search across vault content — Phase 4
- File editing — not planned
- Graph clustering / community detection — not planned

---

## Implementation Order

1. `npm install cytoscape`
2. Add `vault-scan` to `ipc-channels.js`
3. Write `src/vault-scanner.js`
4. Register IPC handler in `main.js`
5. Expose `window.ace.vault.scan()` in `preload.js`
6. Build vault view CSS + HTML structure in `index.html`
7. Build vault view JS (tree render + file reader)
8. Build graph view CSS + HTML structure
9. Build graph view JS (Cytoscape init + interactions)
10. Add Graph nav item to sidebar
11. Wire collapse toggle + ⌘K search
12. Test: tree navigation, markdown render, graph load, click-to-open
