// renderer/modules/build-mode.js
import { state } from '../state.js'

// ── Build Mode ──
export const BUILD_MODE_MARKER = 'Bash(#build-mode-enabled:*)'
export const BUILD_PERMS = [
  'Bash(#build-mode-enabled:*)',
  'Bash(npm:*)', 'Bash(npx:*)', 'Bash(node:*)', 'Bash(python:*)', 'Bash(python3:*)',
  'Bash(pip:*)', 'Bash(pip3:*)', 'Bash(cargo:*)', 'Bash(make:*)', 'Bash(mkdir:*)',
  'Bash(cp:*)', 'Bash(mv:*)', 'Bash(touch:*)', 'Bash(chmod:*)', 'Bash(ls:*)',
  'Bash(cat:*)', 'Bash(head:*)', 'Bash(tail:*)', 'Bash(echo:*)', 'Bash(printf:*)',
  'Bash(wc:*)', 'Bash(date:*)', 'Bash(which:*)', 'Bash(find:*)', 'Bash(grep:*)',
  'Bash(sed:*)', 'Bash(awk:*)', 'Bash(sort:*)', 'Bash(uniq:*)', 'Bash(diff:*)',
  'Bash(du:*)', 'Bash(df:*)', 'Bash(curl:*)', 'Bash(jq:*)', 'Bash(tar:*)',
  'Bash(unzip:*)', 'Bash(zip:*)', 'Bash(tee:*)', 'Bash(xargs:*)', 'Bash(test:*)',
  'Bash(env:*)', 'Bash(export:*)', 'Bash(source:*)',
  'Bash(git push:*)', 'Bash(git pull:*)', 'Bash(git branch:*)', 'Bash(git stash:*)',
  'Bash(git diff:*)', 'Bash(git log:*)', 'Bash(git status:*)', 'Bash(git fetch:*)',
  'Bash(git rebase:*)', 'Bash(git remote:*)', 'Bash(git tag:*)', 'Bash(git clone:*)',
  'Bash(git switch:*)', 'Bash(git worktree:*)',
  'Bash(gh:*)', 'Bash(netlify:*)', 'Bash(vercel:*)', 'Bash(docker:*)', 'Bash(brew:*)',
]

export async function readClaudeSettings() {
  try {
    const content = await window.ace.claudeSettings.read()
    console.log('[BuildMode] read result type:', typeof content, content?.error || 'ok')
    if (content?.error) return null
    return JSON.parse(content)
  } catch (e) { console.error('[BuildMode] read failed:', e); return null }
}

export async function writeClaudeSettings(data) {
  const result = await window.ace.claudeSettings.write(JSON.stringify(data, null, 2))
  console.log('[BuildMode] write result:', result)
}

export async function checkBuildMode() {
  const settings = await readClaudeSettings()
  if (!settings) return false
  const allow = settings.permissions?.allow || []
  return allow.includes(BUILD_MODE_MARKER)
}

export async function toggleBuildMode(forceState) {
  const settings = await readClaudeSettings()
  if (!settings) { console.error('[BuildMode] Could not read settings'); return }
  if (!settings.permissions) settings.permissions = {}
  if (!settings.permissions.allow) settings.permissions.allow = []

  const allow = settings.permissions.allow
  const isOn = allow.includes(BUILD_MODE_MARKER)
  const wantOn = forceState !== undefined ? forceState : !isOn
  console.log('[BuildMode] toggle: isOn=', isOn, 'wantOn=', wantOn, 'perms before=', allow.length)

  if (wantOn && !isOn) {
    settings.permissions.allow = [...allow, ...BUILD_PERMS]
    state.buildModeOn = true
  } else if (!wantOn && isOn) {
    const buildSet = new Set(BUILD_PERMS)
    settings.permissions.allow = allow.filter(p => !buildSet.has(p))
    state.buildModeOn = false
  } else {
    state.buildModeOn = wantOn
  }

  console.log('[BuildMode] writing perms count=', settings.permissions.allow.length, 'buildModeOn=', state.buildModeOn)
  await writeClaudeSettings(settings)
  updateBuildModeUI()
}

export function updateBuildModeUI() {
  const statusEl = document.getElementById('sidebarStatus')
  const labelEl = document.getElementById('statusLabel')
  const toggleEl = document.getElementById('buildToggle')
  const settingsToggle = document.getElementById('settings-build-toggle')

  if (statusEl) statusEl.classList.toggle('build-mode', state.buildModeOn)
  if (labelEl) labelEl.textContent = state.buildModeOn ? 'Build Mode' : 'ACE Online'
  if (toggleEl) toggleEl.classList.toggle('on', state.buildModeOn)
  if (settingsToggle) settingsToggle.classList.toggle('on', state.buildModeOn)
}

// Init build mode state
export async function initBuildMode() {
  state.buildModeOn = await checkBuildMode()
  updateBuildModeUI()

  // Wire status bar toggle
  const buildToggle = document.getElementById('buildToggle')
  if (buildToggle) {
    buildToggle.addEventListener('click', () => toggleBuildMode())
  }
}
