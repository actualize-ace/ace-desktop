const { contextBridge, ipcRenderer } = require('electron')
const ch = require('./src/ipc-channels')

// Pre-paint config: main passes a minimal subset of ace-config.json via
// additionalArguments so the renderer can apply body.reduced-effects before
// first paint (avoids FOUC on Linux / accessibility users). Kept minimal —
// do NOT expand to full config, argv leaks via DevTools / crash reports.
function parseInitialConfig () {
  try {
    const flag = process.argv.find(a => a.startsWith('--ace-initial-config='))
    if (!flag) return {}
    return JSON.parse(flag.split('=').slice(1).join('='))
  } catch { return {} }
}

contextBridge.exposeInMainWorld('ace', {

  // ─── App metadata ────────────────────────────────────────────────────────────
  appVersion: require('./package.json').version,
  appStage: 'alpha',
  platform: process.platform,
  initialConfig: parseInitialConfig(),

  // ─── Config / Setup ──────────────────────────────────────────────────────────
  setup: {
    detectBinary:  ()       => ipcRenderer.invoke(ch.DETECT_BINARY),
    detectNode:    ()       => ipcRenderer.invoke(ch.DETECT_NODE),
    detectGit:     ()       => ipcRenderer.invoke(ch.DETECT_GIT),
    pickVault:     ()       => ipcRenderer.invoke(ch.PICK_VAULT),
    pickBinary:    ()       => ipcRenderer.invoke(ch.PICK_BINARY),
    saveConfig:    (config) => ipcRenderer.invoke(ch.SAVE_CONFIG, config),
    patchConfig:   (partial) => ipcRenderer.invoke(ch.PATCH_CONFIG, partial),
    getConfig:     ()       => ipcRenderer.invoke(ch.GET_CONFIG),
  },

  // ─── Preflight ────────────────────────────────────────────────────────────
  preflight: {
    onResult: (cb) => ipcRenderer.on(ch.PREFLIGHT_RESULT, (_, result) => cb(result)),
    recheckBinary: () => ipcRenderer.send(ch.PREFLIGHT_RECHECK_BINARY),
  },

  // ─── PTY / Sessions ──────────────────────────────────────────────────────────
  pty: {
    create:  (id, cwd, cols, rows) => ipcRenderer.invoke('pty-create', id, cwd, cols, rows),
    write:   (id, data)       => ipcRenderer.send('pty-write', id, data),
    resize:  (id, cols, rows) => ipcRenderer.send('pty-resize', id, cols, rows),
    kill:    (id)             => ipcRenderer.send('pty-kill', id),
    onData:  (id, cb)         => {
      const channel = `${ch.PTY_DATA}:${id}`
      ipcRenderer.on(channel, (_, data) => cb(data))
      return () => ipcRenderer.removeAllListeners(channel)
    },
    onError: (cb) => ipcRenderer.on(ch.PTY_ERROR, (_, reason) => cb(reason)),
    onSessionSpawned: (cb) => ipcRenderer.on(ch.SESSION_SPAWNED, (_, id) => cb(id)),
    onSessionExit:    (cb) => ipcRenderer.on(ch.SESSION_EXIT, (_, id, code) => cb(id, code)),
    resume: (id, cwd, cols, rows, sessionId) => ipcRenderer.invoke(ch.PTY_RESUME, id, cwd, cols, rows, sessionId),
  },

  // ─── Dashboard ───────────────────────────────────────────────────────────────
  dash: {
    getState:    () => ipcRenderer.invoke(ch.GET_STATE),
    getFollowUps:() => ipcRenderer.invoke(ch.GET_FOLLOWUPS),
    getMetrics:  () => ipcRenderer.invoke(ch.GET_METRICS),

    onStateUpdate:    (cb) => ipcRenderer.on(ch.DASH_STATE,    cb),
    onOutcomesUpdate: (cb) => ipcRenderer.on(ch.DASH_OUTCOMES, cb),
    onFollowUpsUpdate:(cb) => ipcRenderer.on(ch.DASH_FOLLOWUPS,cb),
    onSitrepUpdate:   (cb) => ipcRenderer.on(ch.DASH_SITREP,   cb),
    onDashRefresh:    (cb) => ipcRenderer.on(ch.DASH_REFRESH,  cb),

    getVelocity:          ()        => ipcRenderer.invoke(ch.GET_VELOCITY),
    getRhythm:            ()        => ipcRenderer.invoke(ch.GET_RHYTHM),
    getUsage:             ()        => ipcRenderer.invoke(ch.GET_USAGE),
    getPeople:            ()        => ipcRenderer.invoke(ch.GET_PEOPLE),
    getPatterns:          ()        => ipcRenderer.invoke(ch.GET_PATTERNS),
    getSynthesisAI:       (context) => ipcRenderer.invoke(ch.GET_SYNTHESIS_AI, context),
    getLayout:            ()        => ipcRenderer.invoke(ch.GET_LAYOUT),
    saveLayout:           (layout)  => ipcRenderer.invoke(ch.SAVE_LAYOUT, layout),

    getNorthStar:   () => ipcRenderer.invoke(ch.GET_NORTHSTAR),
    getDailyFocus:  () => ipcRenderer.invoke(ch.GET_DAILY_FOCUS),
    getBuildBlocks: () => ipcRenderer.invoke(ch.GET_BUILD_BLOCKS),
    getCompass:       () => ipcRenderer.invoke(ch.GET_COMPASS),
    getLastPulse:     () => ipcRenderer.invoke(ch.GET_LAST_PULSE),
    getRitualStreak:  () => ipcRenderer.invoke(ch.GET_RITUAL_STREAK),
    getCadence:       () => ipcRenderer.invoke(ch.GET_CADENCE),
    markDone:       (item) => ipcRenderer.invoke(ch.MARK_DONE, item),
    snoozeItem:     (item, days) => ipcRenderer.invoke(ch.SNOOZE_ITEM, item, days),
  },

  // ─── Chat (stream-json mode) ─────────────────────────────────────────────────
  chat: {
    send:   (id, prompt, sessionId, opts) => ipcRenderer.invoke(ch.CHAT_SEND, id, prompt, sessionId, opts),
    respond:(id, text) => ipcRenderer.send(ch.CHAT_RESPOND, id, text),
    cancel: (id) => ipcRenderer.send(ch.CHAT_CANCEL, id),
    onStream: (id, cb) => {
      const channel = `${ch.CHAT_STREAM}:${id}`
      ipcRenderer.on(channel, (_, payload) => {
        if (Array.isArray(payload)) { for (const ev of payload) cb(ev) }
        else cb(payload)
      })
      return () => ipcRenderer.removeAllListeners(channel)
    },
    onError: (id, cb) => {
      const channel = `${ch.CHAT_ERROR}:${id}`
      ipcRenderer.on(channel, (_, msg) => cb(msg))
      return () => ipcRenderer.removeAllListeners(channel)
    },
    onExit: (id, cb) => {
      const channel = `${ch.CHAT_EXIT}:${id}`
      ipcRenderer.on(channel, (_, code) => cb(code))
      return () => ipcRenderer.removeAllListeners(channel)
    },
    onSpawnStatus: (id, cb) => {
      const channel = `${ch.CHAT_SPAWN_STATUS}:${id}`
      ipcRenderer.on(channel, (_, payload) => cb(payload))
      return () => ipcRenderer.removeAllListeners(channel)
    },
    prewarm: () => ipcRenderer.send(ch.CHAT_PREWARM),
  },

  // ─── Attachments ──────────────────────────────────────────────────────────────
  attachments: {
    pickFile: () => ipcRenderer.invoke(ch.ATTACHMENT_PICK),
    save:     (opts) => ipcRenderer.invoke(ch.ATTACHMENT_SAVE, opts),
    openFile: (absPath) => ipcRenderer.invoke(ch.SHELL_OPEN_PATH, absPath),
  },

  // ─── Vault ───────────────────────────────────────────────────────────────────
  vault: {
    listDir:  (dirPath)  => ipcRenderer.invoke(ch.VAULT_LIST_DIR, dirPath),
    readFile:  (filePath) => ipcRenderer.invoke(ch.VAULT_READ_FILE, filePath),
    writeFile: (filePath, content) => ipcRenderer.invoke(ch.VAULT_WRITE_FILE, filePath, content),
    buildGraph:      ()  => ipcRenderer.invoke(ch.VAULT_BUILD_GRAPH),
    invalidateGraph: ()  => ipcRenderer.invoke(ch.VAULT_GRAPH_INVALIDATE),
  },

  // ─── Claude Settings (~/.claude/settings.json) ─────────────────────────────
  claudeSettings: {
    read:  ()        => ipcRenderer.invoke(ch.CLAUDE_SETTINGS_READ),
    write: (content) => ipcRenderer.invoke(ch.CLAUDE_SETTINGS_WRITE, content),
  },

  // ─── Chat History ─────────────────────────────────────────────────────────
  history: {
    list:   (project, offset, limit) => ipcRenderer.invoke(ch.HISTORY_LIST, project, offset, limit),
    read:   (project, sessionId)     => ipcRenderer.invoke(ch.HISTORY_READ, project, sessionId),
    search: (query, project)         => ipcRenderer.invoke(ch.HISTORY_SEARCH, query, project),
  },

  // ─── Artifacts ──────────────────────────────────────────────────────────────
  artifacts: {
    list:      ()             => ipcRenderer.invoke(ch.ARTIFACTS_LIST),
    detail:    (slug)         => ipcRenderer.invoke(ch.ARTIFACTS_DETAIL, slug),
    setStatus: (slug, status) => ipcRenderer.invoke(ch.ARTIFACTS_SET_STATUS, slug, status),
  },

  // ─── Astro ─────────────────────────────────────────────────────────────────
  astro: {
    getTransits:        () => ipcRenderer.invoke(ch.ASTRO_TRANSITS),
    getNatalChart:      () => ipcRenderer.invoke(ch.ASTRO_NATAL),
    getInterpretations: () => ipcRenderer.invoke(ch.ASTRO_INTERPRETATIONS),
  },

  // ─── Insight voice ─────────────────────────────────────────────────────────
  insight: {
    transcribe: (audioBuffer) => ipcRenderer.invoke(ch.INSIGHT_TRANSCRIBE, audioBuffer),
    speak:      (text)        => ipcRenderer.invoke(ch.INSIGHT_SPEAK, text),
  },

  // ─── Shell ──────────────────────────────────────────────────────────────────
  shell: {
    openPath:     (p)   => ipcRenderer.invoke(ch.SHELL_OPEN_PATH, p),
    openExternal: (url) => ipcRenderer.invoke(ch.SHELL_OPEN_EXTERNAL, url),
  },

  // ─── Permissions ─────────────────────────────────────────────────────────
  permissions: {
    addAllow: (vaultPath, pattern) =>
      ipcRenderer.invoke(ch.PERMISSIONS_ADD_ALLOW, vaultPath, pattern),
  },

  // ─── MCP Resilience ───────────────────────────────────────────────────────
  mcp: {
    openAuthUrl:   (url)              => ipcRenderer.invoke(ch.MCP_OPEN_AUTH_URL, url),
    resetAuth:     (opts)             => ipcRenderer.invoke(ch.MCP_RESET_AUTH, opts),
    resolveServer: (name, vaultPath)  => ipcRenderer.invoke(ch.MCP_RESOLVE_SERVER, { name, vaultPath }),
  },

  // ─── Vault Health ──────────────────────────────────────────────────────────
  health: {
    check:        ()        => ipcRenderer.invoke(ch.VAULT_HEALTH_CHECK),
    scaffoldItem: (item)    => ipcRenderer.invoke(ch.VAULT_SCAFFOLD_ITEM, item),
    scaffoldAll:  (missing) => ipcRenderer.invoke(ch.VAULT_SCAFFOLD_ALL, missing),
    getColorMap:  ()        => ipcRenderer.invoke(ch.VAULT_GET_COLOR_MAP),
  },

  // ─── Learn / Onboarding ───────────────────────────────────────────────────
  learn: {
    list:          ()        => ipcRenderer.invoke(ch.LEARN_LIST),
    get:           (id)      => ipcRenderer.invoke(ch.LEARN_GET, id),
    state:         ()        => ipcRenderer.invoke(ch.LEARN_STATE),
    markCompleted: (id)      => ipcRenderer.invoke(ch.LEARN_MARK_COMPLETED, id),
    dismiss:       ()        => ipcRenderer.invoke(ch.LEARN_DISMISS),
  },

  // ─── Stress harness (dev only) ────────────────────────────────────────────
  stress: {
    appendResult: (entry) => ipcRenderer.invoke(ch.STRESS_APPEND_RESULT, entry),
    snapshot:     ()      => ipcRenderer.invoke(ch.STRESS_SNAPSHOT),
    coldStart:    ()      => ipcRenderer.invoke(ch.STRESS_COLD_START),
    onWake: (cb) => {
      ipcRenderer.on(ch.STRESS_WAKE_EVENT, (_, payload) => cb(payload))
      return () => ipcRenderer.removeAllListeners(ch.STRESS_WAKE_EVENT)
    },
  },

  // ─── Diagnostics ─────────────────────────────────────────────────────────
  debug: {
    reportLongTask: (payload) => ipcRenderer.send(ch.LONGTASK_REPORT, payload),
  },
})
