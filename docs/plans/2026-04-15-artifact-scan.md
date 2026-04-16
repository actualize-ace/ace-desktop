# Artifact Vault Scan — Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Add a "Scan Vault" button to the Artifacts view that walks the filesystem for uncatalogued artifact-worthy files, presents them in a modal grouped as New vs Old Versions, lets the user approve or ignore each item individually or in bulk, and on Apply registers selected items as stub `.md` cards and writes ignored paths to `.artifacts-ignore`.

**Architecture:** Three backend functions in `vault-reader.js` (scan, register, read/write ignore list) → three new IPC channels → preload bridge → modal UI in `artifacts.js` + `index.html` + `artifacts.css`. The `.artifacts-ignore` file lives at `{vaultPath}/.artifacts-ignore` (one relative path per line, same mental model as `.gitignore`). No new dependencies.

**Tech Stack:** Vanilla JS (ES module), CSS scoped under `#view-artifacts`, Electron IPC, `fs` + `path` (already in vault-reader), no new npm packages.

---

## Data Model

### Scan result shape
```javascript
{
  newItems: [
    { relPath: 'ace-mobile-chat-prototype.html', title: 'Ace Mobile Chat Prototype', category: 'website', slug: 'ace-mobile-chat-prototype' },
    ...
  ],
  oldVersions: [
    { relPath: 'ace-landing-v4.html', title: 'Ace Landing V4', category: 'website', slug: 'ace-landing-v4' },
    ...
  ]
}
```

### Stub `.md` template written on Register
```markdown
---
title: Ace Mobile Chat Prototype
category: website
status: shipped
file_path: ace-mobile-chat-prototype.html
created: 2026-04-15
tags: []
---
```

### `.artifacts-ignore` format
```
ace-landing-v2.html
ace-landing-v3.html
Domains/innova-atelier/vegansma-prototype.html
```

---

## Scan Rules

### Directories to walk (recursive)
- Vault root (top-level files only, not system subdirs)
- `Domains/` (full recursion)
- `11-Artifacts/files/` (actual asset files, not the `.md` stubs)

### Directories to EXCLUDE from recursion
- `.worktrees/` — git worktree copies, causes duplicates
- `ace-desktop/` — source code, not outputs
- `.git/`, `.obsidian/`, `.claude/`, `node_modules/`
- `00-System/`, `01-Journal/`, `02-Rituals/`, `04-Network/`, `05-Research/`, `10-Health/`
- `tools/`, `api/`, `ace-web/`

### File types to collect
- `*.html`
- `*.pdf`
- Directories containing `index.html` (counted as one item, use dir path)

### Already-catalogued detection (two checks)
1. **Exact match**: `relPath` equals a `file_path` value in any existing `11-Artifacts/*.md`
2. **Directory prefix match**: `relPath` starts with a catalogued `file_path` that ends in `/` (e.g. file inside `ace-web/` is covered by the `ace-web/` entry)
3. **Ignore list**: `relPath` appears in `.artifacts-ignore`

### Old version detection
A file is classified as an Old Version (not New) if its filename matches `*-v{N}` or `*-v{N}.ext` (e.g. `ace-landing-v4.html`) AND either:
- A higher-numbered version of the same base name exists anywhere in the scan results or catalogued entries, OR
- The base name (without version suffix) appears in the catalogued entries

Otherwise it stays in New even if it has a version suffix.

### Category inference
| Rule | Category |
|------|----------|
| `.pdf` | `document` |
| `ebook` or `book` in filename | `document` |
| `deck` or `slide` or `slides` in filename | `deck` |
| `email` in filename | `email` |
| `brand` in filename | `brand` |
| Everything else `.html` or dir | `website` |

### Title + slug generation
- Strip extension → replace `-` and `_` with spaces → title-case each word
- Slug = filename without extension (already kebab-case from vault convention)
- If slug would collide with an existing `11-Artifacts/{slug}.md`, append `-2`, `-3`, etc.

---

## Task 1: Backend — `scanUncataloguedArtifacts`

**Files:**
- Modify: `ace-desktop/src/vault-reader.js` (add before `module.exports`)

**Step 1: Add the scan function**

Add immediately before the closing `module.exports` line:

```javascript
// ─── Artifact Vault Scanner ───────────────────────────────────────────────

const SCAN_EXCLUDE_DIRS = new Set([
  '.worktrees', 'ace-desktop', '.git', '.obsidian', '.claude', 'node_modules',
  '00-System', '01-Journal', '02-Rituals', '04-Network', '05-Research',
  '10-Health', 'tools', 'api', 'ace-web',
])

function inferCategory(relPath) {
  const name = path.basename(relPath).toLowerCase()
  if (relPath.endsWith('.pdf') || /ebook|book/.test(name)) return 'document'
  if (/deck|slide|slides/.test(name)) return 'deck'
  if (/email/.test(name)) return 'email'
  if (/brand/.test(name)) return 'brand'
  return 'website'
}

function toTitle(slug) {
  return slug.replace(/[-_]/g, ' ').replace(/\b\w/g, c => c.toUpperCase())
}

function toSlug(relPath) {
  return path.basename(relPath, path.extname(relPath))
}

function isOldVersion(slug, allSlugs, cataloguedPaths) {
  const vMatch = slug.match(/^(.+)-v(\d+)$/)
  if (!vMatch) return false
  const [, base, numStr] = vMatch
  const num = parseInt(numStr, 10)
  // Is there a higher version in scan results or catalogue?
  const higherInScan = allSlugs.some(s => {
    const m = s.match(/^(.+)-v(\d+)$/)
    return m && m[1] === base && parseInt(m[2], 10) > num
  })
  const baseInCatalogue = cataloguedPaths.some(p => {
    const pSlug = path.basename(p, path.extname(p))
    return pSlug === base || (pSlug.match(/^(.+)-v(\d+)$/) || [])[1] === base
  })
  return higherInScan || baseInCatalogue
}

function readIgnoreList(vaultPath) {
  const ignoreFile = path.join(vaultPath, '.artifacts-ignore')
  try {
    return fs.readFileSync(ignoreFile, 'utf8')
      .split('\n')
      .map(l => l.trim())
      .filter(l => l && !l.startsWith('#'))
  } catch { return [] }
}

function scanUncataloguedArtifacts(vaultPath) {
  // 1. Load existing catalogue
  const artifactsDir = path.join(vaultPath, '11-Artifacts')
  const cataloguedPaths = []
  try {
    const files = fs.readdirSync(artifactsDir).filter(f => f.endsWith('.md') && f !== 'README.md')
    for (const f of files) {
      try {
        const text = fs.readFileSync(path.join(artifactsDir, f), 'utf8')
        const m = text.match(/^file_path:\s*["']?(.+?)["']?\s*$/m)
        if (m) cataloguedPaths.push(m[1].trim())
      } catch {}
    }
  } catch {}

  // 2. Load ignore list
  const ignoreList = new Set(readIgnoreList(vaultPath))

  // 3. Walk vault
  const found = [] // { relPath, isDir }

  function walk(dir, relDir) {
    let entries
    try { entries = fs.readdirSync(dir, { withFileTypes: true }) } catch { return }
    for (const e of entries) {
      const name = e.name
      // Skip hidden + excluded dirs
      if (name.startsWith('.')) continue
      const relPath = relDir ? relDir + '/' + name : name
      if (e.isDirectory()) {
        if (SCAN_EXCLUDE_DIRS.has(name)) continue
        // Check if dir itself contains index.html → treat as artifact
        const indexPath = path.join(dir, name, 'index.html')
        if (fs.existsSync(indexPath)) {
          found.push({ relPath: relPath + '/', isDir: true })
          // Don't recurse into it — the dir itself is the artifact
          continue
        }
        // Only recurse into Domains and 11-Artifacts/files from root
        if (relDir === '' || relDir === 'Domains' || relDir.startsWith('Domains/') ||
            relDir === '11-Artifacts/files' || relDir.startsWith('11-Artifacts/files/')) {
          walk(path.join(dir, name), relPath)
        }
      } else if (e.isFile()) {
        if (name.endsWith('.html') || name.endsWith('.pdf')) {
          found.push({ relPath, isDir: false })
        }
      }
    }
  }

  // Walk top-level files first
  try {
    const topEntries = fs.readdirSync(vaultPath, { withFileTypes: true })
    for (const e of topEntries) {
      if (!e.isFile()) continue
      if (e.name.startsWith('.')) continue
      if (e.name.endsWith('.html') || e.name.endsWith('.pdf')) {
        found.push({ relPath: e.name, isDir: false })
      }
    }
  } catch {}

  // Walk Domains/
  walk(path.join(vaultPath, 'Domains'), 'Domains')
  // Walk 11-Artifacts/files/
  walk(path.join(vaultPath, '11-Artifacts', 'files'), '11-Artifacts/files')

  // 4. Filter: already catalogued or in ignore list
  function isCatalogued(relPath) {
    const normalized = relPath.replace(/\/$/, '')
    for (const cp of cataloguedPaths) {
      const cpNorm = cp.replace(/\/$/, '')
      if (cpNorm === normalized) return true
      // Directory prefix: file inside a catalogued dir
      if (cp.endsWith('/') && relPath.startsWith(cp)) return true
    }
    return false
  }

  const candidates = found.filter(({ relPath }) => {
    if (ignoreList.has(relPath) || ignoreList.has(relPath.replace(/\/$/, ''))) return false
    if (isCatalogued(relPath)) return false
    return true
  })

  // 5. Split new vs old versions
  const allSlugs = candidates.map(c => toSlug(c.relPath))
  const newItems = []
  const oldVersions = []

  for (const c of candidates) {
    const slug = toSlug(c.relPath)
    const item = {
      relPath: c.relPath,
      title: toTitle(slug),
      category: inferCategory(c.relPath),
      slug,
    }
    if (isOldVersion(slug, allSlugs, cataloguedPaths)) {
      oldVersions.push(item)
    } else {
      newItems.push(item)
    }
  }

  return { newItems, oldVersions }
}
```

**Step 2: Add `registerArtifacts` function**

Add immediately after the scan function above:

```javascript
function registerArtifacts(vaultPath, candidates) {
  const artifactsDir = path.join(vaultPath, '11-Artifacts')
  const today = new Date().toISOString().slice(0, 10)
  const registered = []
  const errors = []

  for (const c of candidates) {
    // Resolve slug collision
    let slug = c.slug
    let attempt = 1
    while (fs.existsSync(path.join(artifactsDir, slug + '.md'))) {
      attempt++
      slug = c.slug + '-' + attempt
    }

    const content = [
      '---',
      `title: ${c.title}`,
      `category: ${c.category}`,
      `status: shipped`,
      `file_path: "${c.relPath}"`,
      `created: ${today}`,
      `tags: []`,
      '---',
      '',
    ].join('\n')

    try {
      fs.writeFileSync(path.join(artifactsDir, slug + '.md'), content, 'utf8')
      registered.push(slug)
    } catch (e) {
      errors.push({ slug, error: e.message })
    }
  }

  return { registered, errors }
}
```

**Step 3: Add `writeArtifactIgnore` function**

Add immediately after `registerArtifacts`:

```javascript
function writeArtifactIgnore(vaultPath, paths) {
  const ignoreFile = path.join(vaultPath, '.artifacts-ignore')
  const existing = readIgnoreList(vaultPath)
  const toAdd = paths.filter(p => !existing.includes(p))
  if (!toAdd.length) return { ok: true }
  const newContent = [...existing, ...toAdd].join('\n') + '\n'
  try {
    fs.writeFileSync(ignoreFile, newContent, 'utf8')
    return { ok: true }
  } catch (e) {
    return { error: e.message }
  }
}
```

**Step 4: Add all three functions to `module.exports`**

Append to the existing exports:

```javascript
module.exports = {
  // ... existing exports ...,
  scanUncataloguedArtifacts, registerArtifacts, writeArtifactIgnore,
}
```

**Step 5: Verify manually**

```bash
cd ace-desktop && node -e "
  const vr = require('./src/vault-reader');
  const r = vr.scanUncataloguedArtifacts('/Users/nikhilkale/Documents/Actualize');
  console.log('NEW:', r.newItems.map(i => i.relPath));
  console.log('OLD:', r.oldVersions.map(i => i.relPath));
"
```

Expected: New list contains uncatalogued files like `ace-mobile-chat-prototype.html`. Old list contains versioned files like `ace-landing-v4.html`. No `.worktrees/` entries. No already-catalogued files like `ace-landing-v8.html`.

**Step 6: Commit**

```bash
git add ace-desktop/src/vault-reader.js
git commit -m "feat(ace-desktop): artifact vault scanner — scan, register, ignore"
```

---

## Task 2: IPC channels + main.js handlers

**Files:**
- Modify: `ace-desktop/src/ipc-channels.js`
- Modify: `ace-desktop/main.js`

**Step 1: Add channel constants to `ipc-channels.js`**

After the `ARTIFACTS_SET_STATUS` line, add:

```javascript
  ARTIFACTS_SCAN:           'artifacts-scan',
  ARTIFACTS_REGISTER:       'artifacts-register',
  ARTIFACTS_IGNORE:         'artifacts-ignore',
```

**Step 2: Add three IPC handlers to `main.js`**

After the `ARTIFACTS_SET_STATUS` handler block, add:

```javascript
ipcMain.handle(ch.ARTIFACTS_SCAN, () => {
  try { return require('./src/vault-reader').scanUncataloguedArtifacts(global.VAULT_PATH) }
  catch (e) { return { newItems: [], oldVersions: [], error: e.message } }
})

ipcMain.handle(ch.ARTIFACTS_REGISTER, (_, candidates) => {
  try { return require('./src/vault-reader').registerArtifacts(global.VAULT_PATH, candidates) }
  catch (e) { return { registered: [], errors: [{ error: e.message }] } }
})

ipcMain.handle(ch.ARTIFACTS_IGNORE, (_, paths) => {
  try { return require('./src/vault-reader').writeArtifactIgnore(global.VAULT_PATH, paths) }
  catch (e) { return { error: e.message } }
})
```

**Step 3: Commit**

```bash
git add ace-desktop/src/ipc-channels.js ace-desktop/main.js
git commit -m "feat(ace-desktop): wire artifacts scan/register/ignore IPC channels"
```

---

## Task 3: Preload bridge

**Files:**
- Modify: `ace-desktop/preload.js`

**Step 1: Add three methods to the `artifacts` bridge object**

After the `setStatus` line in the `artifacts` object:

```javascript
    scan:      ()             => ipcRenderer.invoke(ch.ARTIFACTS_SCAN),
    register:  (candidates)   => ipcRenderer.invoke(ch.ARTIFACTS_REGISTER, candidates),
    ignore:    (paths)        => ipcRenderer.invoke(ch.ARTIFACTS_IGNORE, paths),
```

**Step 2: Commit**

```bash
git add ace-desktop/preload.js
git commit -m "feat(ace-desktop): expose artifacts scan/register/ignore in preload"
```

---

## Task 4: Modal markup in `index.html`

**Files:**
- Modify: `ace-desktop/renderer/index.html`

**Step 1: Add Scan Vault button to artifacts view header**

Find the `<div class="view-actions">` block inside `#view-artifacts` and add the button before the search input:

```html
<button class="artifacts-scan-btn" id="artifacts-scan-btn" title="Scan vault for uncatalogued artifacts">
  Scan vault
</button>
```

**Step 2: Add the scan modal**

Place immediately before the closing `</body>` tag (after any existing modals):

```html
<!-- Artifact Scan Modal -->
<div class="artifacts-scan-overlay" id="artifacts-scan-overlay" style="display:none">
  <div class="artifacts-scan-modal" id="artifacts-scan-modal">
    <div class="asm-header">
      <div class="asm-title">Vault Scan</div>
      <div class="asm-subtitle" id="asm-subtitle">Scanning…</div>
      <button class="asm-close" id="asm-close">&times;</button>
    </div>

    <div class="asm-body" id="asm-body">
      <div class="asm-spinner" id="asm-spinner">Scanning vault…</div>
      <div class="asm-results" id="asm-results" style="display:none">

        <!-- New artifacts section -->
        <div class="asm-section" id="asm-section-new" style="display:none">
          <div class="asm-section-header">
            <span class="asm-section-label">New <span class="asm-count" id="asm-count-new"></span></span>
            <button class="asm-select-all" id="asm-select-all-new">Select all</button>
          </div>
          <div class="asm-list" id="asm-list-new"></div>
        </div>

        <!-- Old versions section -->
        <div class="asm-section" id="asm-section-old" style="display:none">
          <div class="asm-section-header">
            <span class="asm-section-label asm-old-label">Old versions <span class="asm-count" id="asm-count-old"></span></span>
            <button class="asm-ignore-all" id="asm-ignore-all-old">Ignore all</button>
          </div>
          <div class="asm-list" id="asm-list-old"></div>
        </div>

        <!-- Empty state -->
        <div class="asm-empty" id="asm-empty" style="display:none">
          All artifacts are catalogued.
        </div>

        <!-- Pending ignore strip -->
        <div class="asm-ignore-strip" id="asm-ignore-strip" style="display:none">
          <span class="asm-ignore-strip-label">Will be ignored:</span>
          <div class="asm-ignore-strip-paths" id="asm-ignore-strip-paths"></div>
        </div>
      </div>
    </div>

    <div class="asm-footer" id="asm-footer" style="display:none">
      <button class="asm-cancel" id="asm-cancel">Cancel</button>
      <button class="asm-apply" id="asm-apply">Apply</button>
    </div>
  </div>
</div>
```

**Step 3: Commit**

```bash
git add ace-desktop/renderer/index.html
git commit -m "feat(ace-desktop): artifact scan modal markup"
```

---

## Task 5: Modal logic in `artifacts.js`

**Files:**
- Modify: `ace-desktop/renderer/views/artifacts.js`

**Step 1: Add state fields**

At the top of the file, add to the module-level state:

```javascript
// Scan modal state
let scanState = {
  newItems: [],
  oldVersions: [],
  checked: new Set(),   // relPaths checked for registration
  ignored: new Set(),   // relPaths marked for ignore-forever
}
```

**Step 2: Add `initScanModal` function**

Add after the `refreshArtifacts` export:

```javascript
export function initScanModal() {
  const $ = id => document.getElementById(id)

  // Open modal on button click
  $('artifacts-scan-btn').addEventListener('click', openScanModal)
  $('asm-close').addEventListener('click', closeScanModal)
  $('asm-cancel').addEventListener('click', closeScanModal)
  $('asm-apply').addEventListener('click', applyModal)

  // Close on overlay click
  $('artifacts-scan-overlay').addEventListener('click', e => {
    if (e.target === $('artifacts-scan-overlay')) closeScanModal()
  })

  $('asm-select-all-new').addEventListener('click', () => {
    scanState.newItems.forEach(item => {
      if (!scanState.ignored.has(item.relPath)) scanState.checked.add(item.relPath)
    })
    renderModalLists()
  })

  $('asm-ignore-all-old').addEventListener('click', () => {
    scanState.oldVersions.forEach(item => {
      scanState.checked.delete(item.relPath)
      scanState.ignored.add(item.relPath)
    })
    renderModalLists()
  })
}

async function openScanModal() {
  const overlay = document.getElementById('artifacts-scan-overlay')
  const spinner = document.getElementById('asm-spinner')
  const results = document.getElementById('asm-results')
  const footer  = document.getElementById('asm-footer')
  const subtitle = document.getElementById('asm-subtitle')

  // Reset state
  scanState = { newItems: [], oldVersions: [], checked: new Set(), ignored: new Set() }
  spinner.style.display = ''
  results.style.display = 'none'
  footer.style.display = 'none'
  subtitle.textContent = 'Scanning…'
  overlay.style.display = 'flex'

  try {
    const data = await window.ace.artifacts.scan()
    scanState.newItems = data.newItems || []
    scanState.oldVersions = data.oldVersions || []

    // Default: check all new items, don't check old versions
    scanState.newItems.forEach(item => scanState.checked.add(item.relPath))

    const total = scanState.newItems.length + scanState.oldVersions.length
    subtitle.textContent = total === 0 ? 'Nothing to catalogue' : `Found ${total} item${total !== 1 ? 's' : ''}`
    spinner.style.display = 'none'
    results.style.display = ''
    footer.style.display = total > 0 ? '' : 'none'
    renderModalLists()
  } catch (e) {
    spinner.textContent = 'Scan failed: ' + e.message
  }
}

function closeScanModal() {
  document.getElementById('artifacts-scan-overlay').style.display = 'none'
}

function renderModalLists() {
  const $ = id => document.getElementById(id)

  const total = scanState.newItems.length + scanState.oldVersions.length
  $('asm-empty').style.display = total === 0 ? '' : 'none'

  // New items
  const newVisible = scanState.newItems.filter(i => !scanState.ignored.has(i.relPath))
  $('asm-section-new').style.display = newVisible.length ? '' : 'none'
  $('asm-count-new').textContent = `(${newVisible.length})`
  $('asm-list-new').innerHTML = newVisible.map(item => renderModalRow(item, 'new')).join('')

  // Old versions
  const oldVisible = scanState.oldVersions.filter(i => !scanState.ignored.has(i.relPath))
  $('asm-section-old').style.display = oldVisible.length ? '' : 'none'
  $('asm-count-old').textContent = `(${oldVisible.length})`
  $('asm-list-old').innerHTML = oldVisible.map(item => renderModalRow(item, 'old')).join('')

  // Ignore strip
  const ignoreList = [...scanState.ignored]
  $('asm-ignore-strip').style.display = ignoreList.length ? '' : 'none'
  $('asm-ignore-strip-paths').innerHTML = ignoreList.map(p =>
    `<span class="asm-ignore-tag">${p} <button class="asm-ignore-undo" data-path="${p}">undo</button></span>`
  ).join('')

  // Apply button label
  const registerCount = [...scanState.checked].filter(p => !scanState.ignored.has(p)).length
  const ignoreCount   = scanState.ignored.size
  let applyLabel = 'Apply'
  if (registerCount && ignoreCount) applyLabel = `Register ${registerCount} · Ignore ${ignoreCount}`
  else if (registerCount) applyLabel = `Register ${registerCount}`
  else if (ignoreCount)   applyLabel = `Ignore ${ignoreCount}`
  $('asm-apply').textContent = applyLabel
  $('asm-apply').disabled = !registerCount && !ignoreCount

  // Wire checkboxes and ignore buttons
  document.querySelectorAll('.asm-row-check').forEach(cb => {
    cb.addEventListener('change', e => {
      const p = e.target.dataset.path
      if (e.target.checked) scanState.checked.add(p)
      else scanState.checked.delete(p)
      renderModalLists()
    })
  })
  document.querySelectorAll('.asm-ignore-btn').forEach(btn => {
    btn.addEventListener('click', e => {
      const p = e.currentTarget.dataset.path
      scanState.checked.delete(p)
      scanState.ignored.add(p)
      renderModalLists()
    })
  })
  document.querySelectorAll('.asm-ignore-undo').forEach(btn => {
    btn.addEventListener('click', e => {
      const p = e.currentTarget.dataset.path
      scanState.ignored.delete(p)
      renderModalLists()
    })
  })
}

function renderModalRow(item, bucket) {
  const isChecked = scanState.checked.has(item.relPath) && !scanState.ignored.has(item.relPath)
  return `
    <div class="asm-row" data-path="${item.relPath}">
      <label class="asm-row-left">
        <input type="checkbox" class="asm-row-check" data-path="${item.relPath}" ${isChecked ? 'checked' : ''}>
        <span class="asm-row-title">${item.title}</span>
        <span class="asm-row-category ${item.category}">${item.category}</span>
      </label>
      <span class="asm-row-path">${item.relPath}</span>
      <button class="asm-ignore-btn" data-path="${item.relPath}">Ignore forever</button>
    </div>`
}

async function applyModal() {
  const toRegister = scanState.newItems.concat(scanState.oldVersions)
    .filter(item => scanState.checked.has(item.relPath) && !scanState.ignored.has(item.relPath))

  const toIgnore = [...scanState.ignored]

  const applyBtn = document.getElementById('asm-apply')
  applyBtn.disabled = true
  applyBtn.textContent = 'Applying…'

  try {
    if (toRegister.length) await window.ace.artifacts.register(toRegister)
    if (toIgnore.length)   await window.ace.artifacts.ignore(toIgnore)
    closeScanModal()
    await refreshArtifacts()
    showToast(`${toRegister.length} registered · ${toIgnore.length} ignored`)
  } catch (e) {
    applyBtn.disabled = false
    applyBtn.textContent = 'Apply'
    showToast('Error: ' + e.message)
  }
}

function showToast(msg) {
  let toast = document.getElementById('artifacts-toast')
  if (!toast) {
    toast = document.createElement('div')
    toast.id = 'artifacts-toast'
    toast.className = 'artifacts-toast'
    document.body.appendChild(toast)
  }
  toast.textContent = msg
  toast.classList.add('visible')
  setTimeout(() => toast.classList.remove('visible'), 3000)
}
```

**Step 3: Call `initScanModal` from `initArtifacts`**

In the existing `initArtifacts` function, add after the existing event wiring:

```javascript
initScanModal()
```

**Step 4: Commit**

```bash
git add ace-desktop/renderer/views/artifacts.js
git commit -m "feat(ace-desktop): artifact scan modal logic — scan, approve, ignore-forever"
```

---

## Task 6: Modal CSS in `artifacts.css`

**Files:**
- Modify: `ace-desktop/renderer/styles/views/artifacts.css`

**Step 1: Add styles**

Append to the end of the file:

```css
/* ═══ Scan Vault button ═══════════════════════════════════════════════════ */
.artifacts-scan-btn {
  padding: 5px 12px;
  font-size: 12px;
  font-family: var(--font-mono);
  color: var(--text-secondary);
  background: rgba(255,255,255,0.05);
  border: 1px solid rgba(255,255,255,0.08);
  border-radius: 6px;
  cursor: pointer;
  transition: background 0.2s, color 0.2s;
  white-space: nowrap;
}
.artifacts-scan-btn:hover {
  background: rgba(255,255,255,0.09);
  color: var(--text-primary);
}

/* ═══ Scan Modal ══════════════════════════════════════════════════════════ */
.artifacts-scan-overlay {
  position: fixed;
  inset: 0;
  background: rgba(0,0,0,0.55);
  display: flex;
  align-items: center;
  justify-content: center;
  z-index: 200;
  backdrop-filter: blur(4px);
}

.artifacts-scan-modal {
  background: var(--surface-primary, #1a1c2e);
  border: 1px solid rgba(255,255,255,0.1);
  border-radius: 12px;
  width: 580px;
  max-height: 70vh;
  display: flex;
  flex-direction: column;
  overflow: hidden;
  box-shadow: 0 24px 64px rgba(0,0,0,0.5);
}

.asm-header {
  display: flex;
  align-items: baseline;
  gap: 10px;
  padding: 18px 20px 14px;
  border-bottom: 1px solid rgba(255,255,255,0.06);
  flex-shrink: 0;
}
.asm-title {
  font-size: 15px;
  font-weight: 500;
  color: var(--text-primary);
}
.asm-subtitle {
  font-family: var(--font-mono);
  font-size: 11px;
  color: var(--text-dim);
  flex: 1;
}
.asm-close {
  font-size: 18px;
  color: var(--text-dim);
  background: none;
  border: none;
  cursor: pointer;
  line-height: 1;
  padding: 0 2px;
  margin-left: auto;
}
.asm-close:hover { color: var(--text-primary); }

.asm-body {
  flex: 1;
  overflow-y: auto;
  padding: 16px 20px;
  display: flex;
  flex-direction: column;
  gap: 16px;
}

.asm-spinner {
  color: var(--text-dim);
  font-family: var(--font-mono);
  font-size: 12px;
  padding: 24px 0;
  text-align: center;
}

.asm-empty {
  color: var(--text-dim);
  font-size: 13px;
  text-align: center;
  padding: 24px 0;
}

/* Section */
.asm-section { display: flex; flex-direction: column; gap: 6px; }
.asm-section-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  margin-bottom: 4px;
}
.asm-section-label {
  font-family: var(--font-mono);
  font-size: 10px;
  letter-spacing: 0.1em;
  text-transform: uppercase;
  color: var(--text-secondary);
}
.asm-old-label { color: var(--text-dim); }
.asm-count { opacity: 0.6; }

.asm-select-all, .asm-ignore-all {
  font-size: 11px;
  font-family: var(--font-mono);
  color: var(--text-dim);
  background: none;
  border: none;
  cursor: pointer;
  padding: 2px 6px;
  border-radius: 4px;
  transition: color 0.2s, background 0.2s;
}
.asm-select-all:hover { color: var(--text-primary); background: rgba(255,255,255,0.05); }
.asm-ignore-all:hover { color: #e07080; background: rgba(224,112,128,0.06); }

/* Row */
.asm-row {
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 7px 10px;
  border-radius: 7px;
  background: rgba(255,255,255,0.02);
  border: 1px solid rgba(255,255,255,0.04);
  transition: background 0.15s;
}
.asm-row:hover { background: rgba(255,255,255,0.04); }

.asm-row-left {
  display: flex;
  align-items: center;
  gap: 8px;
  flex: 1;
  min-width: 0;
  cursor: pointer;
}
.asm-row-check { cursor: pointer; flex-shrink: 0; }
.asm-row-title {
  font-size: 13px;
  color: var(--text-primary);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}
.asm-row-category {
  font-family: var(--font-mono);
  font-size: 9px;
  letter-spacing: 0.08em;
  text-transform: uppercase;
  padding: 2px 6px;
  border-radius: 4px;
  flex-shrink: 0;
  background: rgba(255,255,255,0.06);
  color: var(--text-dim);
}
/* Reuse existing category colors */
.asm-row-category.website  { color: #7be0ad; background: rgba(123,224,173,0.1); }
.asm-row-category.document { color: #6ba3f7; background: rgba(107,163,247,0.1); }
.asm-row-category.deck     { color: #f7a06b; background: rgba(247,160,107,0.1); }
.asm-row-category.email    { color: #e0b860; background: rgba(224,184,96,0.1);  }
.asm-row-category.brand    { color: #c8a0f0; background: rgba(200,160,240,0.1); }

.asm-row-path {
  font-family: var(--font-mono);
  font-size: 10px;
  color: var(--text-dim);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
  max-width: 160px;
  flex-shrink: 0;
}

.asm-ignore-btn {
  font-size: 10px;
  font-family: var(--font-mono);
  color: var(--text-dim);
  background: none;
  border: none;
  cursor: pointer;
  padding: 2px 6px;
  border-radius: 4px;
  white-space: nowrap;
  flex-shrink: 0;
  opacity: 0;
  transition: opacity 0.2s, color 0.2s, background 0.2s;
}
.asm-row:hover .asm-ignore-btn { opacity: 1; }
.asm-ignore-btn:hover { color: #e07080; background: rgba(224,112,128,0.08); }

/* Ignore strip */
.asm-ignore-strip {
  padding: 10px 12px;
  background: rgba(224,112,128,0.05);
  border: 1px solid rgba(224,112,128,0.12);
  border-radius: 7px;
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
  align-items: center;
}
.asm-ignore-strip-label {
  font-family: var(--font-mono);
  font-size: 10px;
  color: #e07080;
  opacity: 0.7;
  flex-shrink: 0;
}
.asm-ignore-tag {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  font-family: var(--font-mono);
  font-size: 10px;
  color: var(--text-dim);
  background: rgba(255,255,255,0.04);
  border-radius: 4px;
  padding: 2px 6px;
}
.asm-ignore-undo {
  font-size: 10px;
  color: var(--text-dim);
  background: none;
  border: none;
  cursor: pointer;
  text-decoration: underline;
  padding: 0;
}
.asm-ignore-undo:hover { color: var(--text-primary); }

/* Footer */
.asm-footer {
  padding: 12px 20px;
  border-top: 1px solid rgba(255,255,255,0.06);
  display: flex;
  justify-content: flex-end;
  gap: 10px;
  flex-shrink: 0;
}
.asm-cancel {
  padding: 7px 16px;
  font-size: 12px;
  font-family: var(--font-mono);
  color: var(--text-dim);
  background: none;
  border: 1px solid rgba(255,255,255,0.08);
  border-radius: 6px;
  cursor: pointer;
  transition: color 0.2s, background 0.2s;
}
.asm-cancel:hover { color: var(--text-primary); background: rgba(255,255,255,0.05); }

.asm-apply {
  padding: 7px 18px;
  font-size: 12px;
  font-family: var(--font-mono);
  color: #0a0c1a;
  background: #d4a574;
  border: none;
  border-radius: 6px;
  cursor: pointer;
  font-weight: 500;
  transition: background 0.2s, opacity 0.2s;
}
.asm-apply:hover:not(:disabled) { background: #ddb87f; }
.asm-apply:disabled { opacity: 0.4; cursor: not-allowed; }

/* Toast */
.artifacts-toast {
  position: fixed;
  bottom: 24px;
  left: 50%;
  transform: translateX(-50%) translateY(12px);
  background: rgba(20,22,36,0.95);
  border: 1px solid rgba(255,255,255,0.1);
  border-radius: 8px;
  padding: 9px 18px;
  font-family: var(--font-mono);
  font-size: 12px;
  color: var(--text-secondary);
  z-index: 300;
  opacity: 0;
  transition: opacity 0.25s ease, transform 0.25s ease;
  pointer-events: none;
}
.artifacts-toast.visible {
  opacity: 1;
  transform: translateX(-50%) translateY(0);
}
```

**Step 2: Commit**

```bash
git add ace-desktop/renderer/styles/views/artifacts.css
git commit -m "feat(ace-desktop): artifact scan modal CSS — rows, sections, ignore strip, toast"
```

---

## Task 7: Visual verification

**No files changed — manual test only.**

**Step 1: Launch the app**

```bash
cd ace-desktop && npm start
```

**Step 2: Navigate to Artifacts view**

Verify the "Scan vault" button appears in the view header next to the search input.

**Step 3: Run a scan**

Click "Scan vault". Verify:
- Modal opens with "Scanning…" state
- Results appear with New and Old Versions sections
- New items are checked by default
- Old version items (e.g. `ace-landing-v4.html`) are unchecked by default
- Already-catalogued items (e.g. `ace-landing-v8.html`) do NOT appear
- `.worktrees/` files do NOT appear
- Apply button label reflects the count

**Step 4: Test Ignore Forever**

- Hover a row → "Ignore forever" appears
- Click it → item moves to the ignore strip at the bottom
- "Undo" in the strip restores the item
- "Ignore All" on Old Versions section moves all old items to the strip

**Step 5: Test Apply**

- Select a mix of new items, ignore some old versions
- Click Apply → modal closes, artifacts list refreshes
- Toast appears: "X registered · Y ignored"
- Newly registered items appear in the artifacts list
- Re-open scan → ignored items no longer appear
- Registered items no longer appear (now catalogued)

**Step 6: Verify `.artifacts-ignore` was written**

```bash
cat ~/Documents/Actualize/.artifacts-ignore
```

Should contain the paths you ignored.

**Step 7: Verify no regressions**

- Existing artifact list, detail panel, archive/restore still work
- Search and category filters still work
- No console errors
