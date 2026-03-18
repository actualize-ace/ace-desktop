# ACE Desktop — Knowledge Graph View Design

**Date:** 2026-03-17
**Branch:** feature/ace-desktop
**Status:** Approved — ready for implementation

---

## Context

Phase 3 (Vault view — file tree + markdown reader) is already shipped.
This doc covers the **Knowledge Graph view** (Phase 3b).

---

## Goal

An Obsidian-style interactive knowledge graph: nodes are `.md` files, edges are
`[[wikilink]]` connections. Separate nav item. Primary interactions: hover to
highlight neighborhood, click to open file in Vault view.

---

## Architecture

### New file

```
src/vault-scanner.js    # walks vault, extracts wikilinks → { nodes, edges }
```

### Files modified

```
src/ipc-channels.js     # add VAULT_BUILD_GRAPH constant
main.js                 # register IPC handler
preload.js              # expose window.ace.vault.buildGraph()
renderer/index.html     # new Graph nav item + view div + D3 CSS/JS
package.json            # npm install d3
```

### New IPC channel

```
VAULT_BUILD_GRAPH   invoke/handle   → { nodes, edges }
```

### Data flow

```
User clicks ◉ Graph nav (first time)
  → window.ace.vault.buildGraph()
  → vault-scanner.js walks all .md files
  → extracts [[wikilinks]] per file
  → resolves links to actual file paths (drops dangling)
  → returns { nodes: [{id, label, path, group}], edges: [{source, target}] }
  → cached in memory (main process) — subsequent opens use cache
  → D3 force simulation renders SVG
```

---

## Graph Data Schema

### Node
```js
{
  id:    '00-System/state.md',          // relative path — unique key
  label: 'state',                        // filename without extension
  path:  '/abs/path/to/state.md',        // for vault.readFile()
  group: '00-System',                    // top-level folder
}
```

### Edge
```js
{ source: '00-System/state.md', target: '00-System/active.md' }
```

Edges are directional (A links to B), but undirected visually for simplicity.
Dangling links (target file doesn't exist) are silently dropped.

---

## Node Color Scheme

Matches existing ACE design system:

| Group        | Color     | Hex       |
|--------------|-----------|-----------|
| `00-System`  | blue-grey | `#74a4c4` |
| `01-Journal` | gold      | `#d4a574` |
| `04-Network` | green     | `#6db88f` |
| `Domains`    | purple    | `#9b74c4` |
| everything else | dim    | `#5a5248` |

Node radius: 5px base. Scales up to 8px for nodes with degree > 5.
Orphan nodes (no edges): 3px, 40% opacity.

---

## Visualization

### Library
D3.js (`npm install d3`). ~280KB. Force simulation on SVG element.

### D3 forces
```js
forceLink()          // edges pull connected nodes together
forceManyBody()      // repulsion, strength ≈ -120
forceCenter()        // anchor cluster to canvas center
```

### Pan / zoom
`d3.zoom()` on the SVG wrapper — scroll to zoom, drag canvas to pan.

### Layout
Full-bleed SVG inside the view. No side panels.
View header: title "Graph" + "Refresh" button (rebuilds cache + re-renders).

---

## Interactions

### Hover
- Brighten hovered node (opacity 1.0, slight radius increase)
- Draw its edges in gold (`#d4a574`)
- Dim all unconnected nodes + edges to 12% opacity
- Show label above node (hidden by default)

### Click
- Brief pulse animation on node + its neighbors
- Switch active nav to Vault
- Open file via `openVaultFile(node.path, node.label)`

### Background click
- Clear all hover state
- Restore full opacity on all nodes/edges

### Labels
Hidden by default. Appear on hover only. Keep clean at vault scale (~150–200 nodes).

---

## Performance

- Graph build on first open only. Cached in main process memory.
- Rebuild triggered by: user clicks Refresh button.
- Expected build time: <300ms for ~200 files.
- D3 force sim at 150–200 nodes: stable 60fps.

---

## Out of Scope

- Wikilink navigation inside the markdown reader (Phase 4)
- Full-text search — Phase 4
- File editing — not planned
- Graph filtering by folder — not planned for this phase

---

## Implementation Order

1. `npm install d3`
2. Add `VAULT_BUILD_GRAPH` to `src/ipc-channels.js`
3. Write `src/vault-scanner.js` (`buildGraph(vaultPath)`)
4. Register IPC handler in `main.js`
5. Expose `window.ace.vault.buildGraph()` in `preload.js`
6. Add `◉ Graph` nav item to sidebar in `index.html`
7. Add Graph view HTML (view div + SVG container)
8. Add Graph view CSS
9. Add Graph view JS (D3 init, force sim, hover, click interactions)
10. Wire Refresh button
11. Wire click-to-open → Vault view
