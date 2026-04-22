// renderer/views/settings.js
import { state } from '../state.js'
import { applyTheme, applyZoom } from '../modules/theme.js'
import { toggleBuildMode, updateBuildModeUI } from '../modules/build-mode.js'
import { fitActive, sendToActive } from '../modules/session-manager.js'
import { getAllCommandNames } from '../modules/command-registry.js'

let _settingsConfig = null
const CMD_COLORS = [
  { name: 'Gold', css: 'var(--gold)' },
  { name: 'Green', css: 'var(--green)' },
  { name: 'Purple', css: 'var(--ark)' },
  { name: 'Blue', css: '#6088c0' },
  { name: 'Red', css: 'var(--red)' },
]

const DEFAULTS = {
  chat: { model: 'sonnet', permissions: 'default', effort: 'high' },
  display: { theme: 'dark', fontSize: 'medium', sidebarCollapsed: false, reducedEffects: 'auto' },
  guardrails: { sessionCostWarning: 2.00 },
  sidebar: {
    commands: [
      { cmd: '/start', color: 'var(--gold)' },
      { cmd: '/brief', color: 'var(--gold)' },
      { cmd: '/pulse', color: 'var(--green)' },
      { cmd: '/eod', color: 'var(--ark)' },
      { cmd: '/coach', color: 'var(--ark)' }
    ]
  },
  startup: { defaultView: 'home', autoScroll: true }
}

export async function loadSettingsFromConfig() {
  const config = await window.ace.setup.getConfig() || {}
  if (!config.defaults) {
    config.defaults = JSON.parse(JSON.stringify(DEFAULTS))
    await window.ace.setup.patchConfig({ defaults: config.defaults })
  } else {
    // Migrate any missing sections
    let changed = false
    for (const key of Object.keys(DEFAULTS)) {
      if (!config.defaults[key]) {
        config.defaults[key] = JSON.parse(JSON.stringify(DEFAULTS[key]))
        changed = true
      }
    }
    if (changed) await window.ace.setup.patchConfig({ defaults: config.defaults })
  }
  _settingsConfig = config
  return config
}

export async function saveSettingsField(path, value) {
  if (!_settingsConfig) await loadSettingsFromConfig()
  const parts = path.split('.')
  let obj = _settingsConfig.defaults
  for (let i = 0; i < parts.length - 1; i++) {
    if (!obj[parts[i]]) obj[parts[i]] = {}
    obj = obj[parts[i]]
  }
  obj[parts[parts.length - 1]] = value
  await window.ace.setup.patchConfig({ defaults: _settingsConfig.defaults })
}

function sel(setting, value, label) {
  const cur = getNestedVal(_settingsConfig?.defaults, setting)
  return `<option value="${value}" ${cur === value ? 'selected' : ''}>${label}</option>`
}

function getNestedVal(obj, path) {
  if (!obj) return undefined
  const parts = path.split('.')
  let v = obj
  for (const p of parts) { v = v?.[p]; if (v === undefined) return undefined }
  return v
}

export async function renderSettingsPanel() {
  const body = document.getElementById('settings-body')
  const config = await loadSettingsFromConfig()
  const d = config.defaults

  body.innerHTML = `
    <div class="settings-section">
      <div class="settings-section-label">Chat Defaults</div>
      <div class="settings-row">
        <div class="settings-label">Model</div>
        <select class="settings-select" data-setting="chat.model">
          ${sel('chat.model', 'opus', 'Opus')}
          ${sel('chat.model', 'sonnet', 'Sonnet')}
          ${sel('chat.model', 'haiku', 'Haiku')}
        </select>
      </div>
      <div class="settings-row">
        <div class="settings-label">Permissions</div>
        <select class="settings-select" data-setting="chat.permissions">
          ${sel('chat.permissions', 'default', 'Normal')}
          ${sel('chat.permissions', 'plan', 'Plan')}
          ${sel('chat.permissions', 'auto', 'Auto-accept')}
        </select>
      </div>
      <div class="settings-row">
        <div class="settings-label">Effort</div>
        <select class="settings-select" data-setting="chat.effort">
          ${sel('chat.effort', 'low', 'Low')}
          ${sel('chat.effort', 'medium', 'Medium')}
          ${sel('chat.effort', 'high', 'High')}
          ${sel('chat.effort', 'max', 'Max')}
        </select>
      </div>
      <div class="settings-row">
        <div>
          <div class="settings-label">Lean Mode</div>
          <div style="font-size:9px;color:var(--text-dim);margin-top:2px;">Strips MCP overhead. Faster, lower token cost.</div>
        </div>
        <div class="settings-toggle${d.chat?.lean !== false ? ' on' : ''}" data-setting="chat.lean"></div>
      </div>
      <div class="settings-row">
        <div>
          <div class="settings-label">Disable MCP Servers</div>
          <div style="font-size:9px;color:var(--text-dim);margin-top:2px;">Emergency bypass — skips all MCP tools. Speeds chat launch on slow networks or Windows.</div>
        </div>
        <div class="settings-toggle${_settingsConfig?.suppressMcp ? ' on' : ''}" data-setting="suppressMcp"></div>
      </div>
    </div>

    <div class="settings-section">
      <div class="settings-section-label">Display</div>
      <div class="settings-row">
        <div class="settings-label">Theme</div>
        <select class="settings-select" data-setting="display.theme">
          ${sel('display.theme', 'dark', 'Dark')}
          ${sel('display.theme', 'light', 'Light')}
        </select>
      </div>
      <div class="settings-row">
        <div class="settings-label">Font Size</div>
        <select class="settings-select" data-setting="display.fontSize">
          ${sel('display.fontSize', 'small', 'Small')}
          ${sel('display.fontSize', 'medium', 'Medium')}
          ${sel('display.fontSize', 'large', 'Large')}
        </select>
      </div>
      <div class="settings-row">
        <div class="settings-label">Sidebar Collapsed</div>
        <div class="settings-toggle${d.display?.sidebarCollapsed ? ' on' : ''}" data-setting="display.sidebarCollapsed"></div>
      </div>
      <div class="settings-row">
        <div>
          <div class="settings-label">Visual Effects</div>
          <div style="font-size:9px;color:var(--text-dim);margin-top:2px;">Reduced mode strips backdrop blur + ambient animations. Recommended on Linux or weak GPUs.</div>
        </div>
        <select class="settings-select" data-setting="display.reducedEffects">
          ${sel('display.reducedEffects', 'auto', 'Auto')}
          ${sel('display.reducedEffects', 'on', 'Reduced always')}
          ${sel('display.reducedEffects', 'off', 'Full always')}
        </select>
      </div>
    </div>

    <div class="settings-section">
      <div class="settings-section-label">Sidebar Commands</div>
      <div class="settings-cmd-list" id="settings-cmd-list"></div>
      <button class="settings-add-cmd" id="settings-add-cmd">+ Add Command</button>
    </div>

    <div class="settings-section">
      <div class="settings-section-label">Startup</div>
      <div class="settings-row">
        <div class="settings-label">Default View</div>
        <select class="settings-select" data-setting="startup.defaultView">
          ${sel('startup.defaultView', 'home', 'Command (Home)')}
          ${sel('startup.defaultView', 'terminal', 'Terminal')}
          ${sel('startup.defaultView', 'agents', 'Agents')}
          ${sel('startup.defaultView', 'people', 'People')}
          ${sel('startup.defaultView', 'vault', 'Vault')}
          ${sel('startup.defaultView', 'history', 'History')}
          ${sel('startup.defaultView', 'artifacts', 'Artifacts')}
          ${sel('startup.defaultView', 'insight', 'Insight')}
          ${sel('startup.defaultView', 'astro', 'Astro')}
          ${sel('startup.defaultView', 'learn', 'Learn')}
        </select>
      </div>
      <div class="settings-row">
        <div class="settings-label">Auto-scroll Chat</div>
        <div class="settings-toggle${d.startup?.autoScroll !== false ? ' on' : ''}" data-setting="startup.autoScroll"></div>
      </div>
    </div>

    <div class="settings-section">
      <div class="settings-section-label">Cost & Safety</div>
      <div class="settings-row">
        <div class="settings-label">Session Cost Warning ($)</div>
        <input class="settings-input" type="number" step="0.5" min="0" data-setting="guardrails.sessionCostWarning" value="${d.guardrails?.sessionCostWarning ?? 2.00}">
      </div>
      <div class="settings-row">
        <div>
          <div class="settings-label">Build Mode</div>
          <div style="font-size:9px;color:var(--text-dim);margin-top:2px;">Broad dev command permissions. Use for build sprints.</div>
        </div>
        <div class="settings-toggle${state.buildModeOn ? ' on' : ''}" id="settings-build-toggle" data-setting="buildMode"></div>
      </div>
    </div>

    <div class="settings-section">
      <div class="settings-section-label">System</div>
      <div class="settings-row" style="flex-direction:column;align-items:flex-start;gap:6px">
        <div class="settings-label">Vault Path</div>
        <div class="settings-path-row">
          <div class="settings-path" id="settings-vault-path">${config.vaultPath || '\u2014'}</div>
          <button class="settings-path-btn" id="settings-pick-vault">Change</button>
        </div>
      </div>
      <div class="settings-row" style="flex-direction:column;align-items:flex-start;gap:6px">
        <div class="settings-label">Claude Binary</div>
        <div class="settings-path-row">
          <div class="settings-path" id="settings-binary-path">${config.claudeBinaryPath || '\u2014'}</div>
          <button class="settings-path-btn" id="settings-detect-binary">Re-detect</button>
        </div>
      </div>
    </div>
  `

  renderCommandList(d.sidebar?.commands || [])
  wireSettingsHandlers()
}

export function renderCommandList(commands) {
  const listEl = document.getElementById('settings-cmd-list')
  if (!listEl) return
  listEl.innerHTML = commands.map((c, i) => `
    <div class="settings-cmd-row" data-idx="${i}">
      <span class="settings-cmd-drag">\u2800\u2801\u2802\u2803\u2804\u2805\u2806\u2807\u2808\u2809\u280a\u280b\u280c\u280d\u280e\u280f\u2810\u2811\u2812\u2813\u2814\u2815\u2816\u2817\u2818\u2819\u281a\u281b\u281c\u281d\u281e\u281f</span>
      <span class="settings-cmd-dot" style="background:${c.color}" data-idx="${i}"></span>
      <span class="settings-cmd-name">${c.cmd}</span>
      <span class="settings-cmd-remove" data-idx="${i}">&times;</span>
    </div>
  `).join('')

  // Fix drag handle - use simpler character
  listEl.querySelectorAll('.settings-cmd-drag').forEach(el => { el.textContent = '\u2807' })

  // Wire remove buttons
  listEl.querySelectorAll('.settings-cmd-remove').forEach(btn => {
    btn.addEventListener('click', async (e) => {
      e.stopPropagation()
      const idx = parseInt(btn.dataset.idx)
      const cmds = [...(_settingsConfig.defaults.sidebar?.commands || [])]
      cmds.splice(idx, 1)
      await saveSettingsField('sidebar.commands', cmds)
      renderCommandList(cmds)
      rebuildSidebarCommands(cmds)
    })
  })

  // Wire color dot clicks
  listEl.querySelectorAll('.settings-cmd-dot').forEach(dot => {
    dot.addEventListener('click', (e) => {
      e.stopPropagation()
      showColorPicker(dot, parseInt(dot.dataset.idx))
    })
  })

  // SortableJS for drag reorder
  if (typeof Sortable !== 'undefined') {
    Sortable.create(listEl, {
      animation: 150,
      handle: '.settings-cmd-drag',
      onEnd: async () => {
        const rows = listEl.querySelectorAll('.settings-cmd-row')
        const newCmds = []
        rows.forEach(row => {
          const name = row.querySelector('.settings-cmd-name').textContent
          const dot = row.querySelector('.settings-cmd-dot')
          newCmds.push({ cmd: name, color: dot.style.background })
        })
        await saveSettingsField('sidebar.commands', newCmds)
        rebuildSidebarCommands(newCmds)
        // Re-render to fix data-idx attributes
        renderCommandList(newCmds)
      }
    })
  }
}

export function showColorPicker(dotEl, idx) {
  // Remove any existing picker
  document.querySelectorAll('.settings-color-picker').forEach(p => p.remove())

  const picker = document.createElement('div')
  picker.className = 'settings-color-picker'
  CMD_COLORS.forEach(c => {
    const swatch = document.createElement('div')
    swatch.className = 'settings-color-swatch'
    swatch.style.background = c.css
    swatch.title = c.name
    swatch.addEventListener('click', async () => {
      dotEl.style.background = c.css
      const cmds = [...(_settingsConfig.defaults.sidebar?.commands || [])]
      if (cmds[idx]) {
        cmds[idx].color = c.css
        await saveSettingsField('sidebar.commands', cmds)
        rebuildSidebarCommands(cmds)
      }
      picker.remove()
    })
    picker.appendChild(swatch)
  })

  // Position relative to dot
  const rect = dotEl.getBoundingClientRect()
  picker.style.left = (rect.left - 10) + 'px'
  picker.style.top = (rect.bottom + 6) + 'px'
  document.body.appendChild(picker)
}

export function showCommandSelector(btnEl, commands) {
  // Remove any existing selector
  document.querySelectorAll('.settings-cmd-selector').forEach(s => s.remove())

  const currentCmds = commands.map(c => c.cmd)
  const available = getAllCommandNames().filter(c => !currentCmds.includes(c))
  if (!available.length) return

  const selector = document.createElement('div')
  selector.className = 'settings-cmd-selector'
  available.forEach(cmd => {
    const opt = document.createElement('div')
    opt.className = 'settings-cmd-option'
    opt.textContent = cmd
    opt.addEventListener('click', async () => {
      const cmds = [...(_settingsConfig.defaults.sidebar?.commands || [])]
      if (cmds.length >= 8) { selector.remove(); return }
      cmds.push({ cmd, color: 'var(--gold)' })
      await saveSettingsField('sidebar.commands', cmds)
      rebuildSidebarCommands(cmds)
      renderCommandList(cmds)
      selector.remove()
    })
    selector.appendChild(opt)
  })

  const rect = btnEl.getBoundingClientRect()
  selector.style.left = rect.left + 'px'
  selector.style.bottom = (window.innerHeight - rect.top + 6) + 'px'
  document.body.appendChild(selector)
}

export function rebuildSidebarCommands(commands) {
  const cmdSection = document.querySelector('.cmd-section')
  if (!cmdSection) return
  cmdSection.innerHTML = commands.map(c =>
    `<button class="cmd-btn" data-cmd="${c.cmd}"><div class="cmd-dot" style="background:${c.color}"></div>${c.cmd}</button>`
  ).join('')
  // Re-wire click handlers
  cmdSection.querySelectorAll('[data-cmd]').forEach(el => {
    el.addEventListener('click', () => {
      document.querySelector('.nav-item[data-view="terminal"]').click()
      setTimeout(() => sendToActive(el.dataset.cmd + '\r'), 120)
    })
  })
  // Also update chatDefaults
  if (_settingsConfig?.defaults?.chat) {
    state.chatDefaults = _settingsConfig.defaults.chat
  }
}

export function wireSettingsHandlers() {
  const body = document.getElementById('settings-body')

  // Selects
  body.querySelectorAll('.settings-select[data-setting]').forEach(sel => {
    sel.addEventListener('change', async () => {
      const setting = sel.dataset.setting
      await saveSettingsField(setting, sel.value)
      applySettingImmediately(setting, sel.value)
    })
  })

  // Number inputs with debounce
  let debounceTimers = {}
  body.querySelectorAll('.settings-input[data-setting]').forEach(inp => {
    inp.addEventListener('input', () => {
      const setting = inp.dataset.setting
      clearTimeout(debounceTimers[setting])
      debounceTimers[setting] = setTimeout(async () => {
        await saveSettingsField(setting, parseFloat(inp.value) || 0)
      }, 500)
    })
  })

  // Toggles
  body.querySelectorAll('.settings-toggle[data-setting]').forEach(tog => {
    tog.addEventListener('click', async () => {
      if (tog.dataset.setting === 'buildMode') {
        // Build mode writes to ~/.claude/settings.json, not ace-config
        await toggleBuildMode()
        return
      }
      if (tog.dataset.setting === 'suppressMcp') {
        // Top-level config field — not under defaults
        tog.classList.toggle('on')
        const isOn = tog.classList.contains('on')
        await window.ace.setup.patchConfig({ suppressMcp: isOn })
        if (_settingsConfig) _settingsConfig.suppressMcp = isOn
        applySettingImmediately('suppressMcp', isOn)
        return
      }
      tog.classList.toggle('on')
      const isOn = tog.classList.contains('on')
      const setting = tog.dataset.setting
      await saveSettingsField(setting, isOn)
      applySettingImmediately(setting, isOn)
    })
  })

  // System buttons
  const pickVaultBtn = document.getElementById('settings-pick-vault')
  if (pickVaultBtn) {
    pickVaultBtn.addEventListener('click', async () => {
      const result = await window.ace.setup.pickVault()
      // pickVault returns { vaultPath, hasMcp } or null on cancel
      if (result && result.vaultPath) {
        document.getElementById('settings-vault-path').textContent = result.vaultPath
        // Vault change triggers a full save + index.html reload in main.js
        const config = await window.ace.setup.getConfig()
        config.vaultPath = result.vaultPath
        await window.ace.setup.saveConfig(config)
      }
    })
  }

  const detectBinaryBtn = document.getElementById('settings-detect-binary')
  if (detectBinaryBtn) {
    detectBinaryBtn.addEventListener('click', async () => {
      const result = await window.ace.setup.detectBinary()
      // detectBinary returns { path, version } or null
      if (result && result.path) {
        document.getElementById('settings-binary-path').textContent = result.path
        await window.ace.setup.patchConfig({ claudeBinaryPath: result.path })
      }
    })
  }

  // Add command button
  const addBtn = document.getElementById('settings-add-cmd')
  if (addBtn) {
    addBtn.addEventListener('click', () => {
      showCommandSelector(addBtn, _settingsConfig.defaults.sidebar?.commands || [])
    })
  }
}

export function applySettingImmediately(path, value) {
  if (path === 'display.theme') {
    applyTheme(value)
    localStorage.setItem('ace-theme', value)
  } else if (path === 'display.fontSize') {
    const sizes = { small: '11px', medium: '12.5px', large: '14px' }
    document.documentElement.style.setProperty('--chat-font-size', sizes[value] || '12.5px')
  } else if (path === 'display.sidebarCollapsed') {
    const sidebar = document.querySelector('.sidebar')
    const toggleBtn = document.getElementById('sidebar-toggle')
    if (value) {
      sidebar?.classList.add('collapsed')
      if (toggleBtn) toggleBtn.innerHTML = '\u25b8'
    } else {
      sidebar?.classList.remove('collapsed')
      if (toggleBtn) toggleBtn.innerHTML = '\u25c2 <span>Collapse</span>'
    }
  } else if (path === 'suppressMcp') {
    // Cancel all live streams — next send picks up the new flag from main.js config
    for (const id of Object.keys(state.sessions || {})) {
      const s = state.sessions[id]
      if (s?.isStreaming) window.ace.chat.cancel(id)
    }
    // Inline transient banner in settings panel
    const existing = document.getElementById('suppress-mcp-toast')
    if (existing) existing.remove()
    const banner = document.createElement('div')
    banner.id = 'suppress-mcp-toast'
    banner.style.cssText = 'margin:8px 0;padding:7px 10px;background:rgba(136,120,255,0.12);border-radius:6px;font-size:11px;color:var(--text-secondary,#aaa);'
    banner.textContent = 'MCP setting changed — next message restarts the chat process.'
    const section = document.querySelector('.settings-section')
    if (section) section.parentNode.insertBefore(banner, section)
    setTimeout(() => banner.remove(), 4000)
  } else if (path === 'chat.model' || path === 'chat.permissions' || path === 'chat.effort' || path === 'chat.lean') {
    // Update chatDefaults for new sessions
    const key = path.split('.')[1]
    state.chatDefaults[key] = value
  } else if (path === 'display.reducedEffects') {
    // Store user pref globally so app.js's OS-media listeners consult it
    // when the user is on 'auto' vs 'on' vs 'off'.
    window.__aceReducedPref = value
    const shouldReduce = value === 'on' ? true
      : value === 'off' ? false
      : (window.ace?.platform === 'linux'
         || matchMedia('(prefers-reduced-motion: reduce)').matches
         || matchMedia('(prefers-reduced-transparency: reduce)').matches)
    document.body.classList.toggle('reduced-effects', !!shouldReduce)
  }
}

export function openSettings() {
  const overlay = document.getElementById('settings-overlay')
  overlay.classList.add('open')
  renderSettingsPanel()
}

export function closeSettings() {
  const overlay = document.getElementById('settings-overlay')
  overlay.classList.remove('open')
  // Remove any open pickers / selectors
  document.querySelectorAll('.settings-color-picker, .settings-cmd-selector').forEach(el => el.remove())
}

export function initSettings() {
  const overlay = document.getElementById('settings-overlay')
  const backdrop = document.getElementById('settings-backdrop')
  const closeBtn = document.getElementById('settings-close')
  const gearBtn = document.getElementById('settings-btn')

  gearBtn.addEventListener('click', openSettings)
  backdrop.addEventListener('click', closeSettings)
  closeBtn.addEventListener('click', closeSettings)
  document.addEventListener('keydown', e => {
    if (e.key === 'Escape' && overlay.classList.contains('open')) closeSettings()
  })

  // Load config on init for cost guardrails
  loadSettingsFromConfig().catch(() => {})
}

// sendToActive imported directly from session-manager.js
