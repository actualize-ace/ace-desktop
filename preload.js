const { contextBridge, ipcRenderer } = require('electron')
const ch = require('./src/ipc-channels')

contextBridge.exposeInMainWorld('ace', {

  // ─── Config / Setup ──────────────────────────────────────────────────────────
  setup: {
    detectBinary:  ()       => ipcRenderer.invoke(ch.DETECT_BINARY),
    pickVault:     ()       => ipcRenderer.invoke(ch.PICK_VAULT),
    saveConfig:    (config) => ipcRenderer.invoke(ch.SAVE_CONFIG, config),
    patchConfig:   (partial) => ipcRenderer.invoke(ch.PATCH_CONFIG, partial),
    getConfig:     ()       => ipcRenderer.invoke(ch.GET_CONFIG),
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
    getPipeline: () => ipcRenderer.invoke(ch.GET_PIPELINE),
    getFollowUps:() => ipcRenderer.invoke(ch.GET_FOLLOWUPS),
    getMetrics:  () => ipcRenderer.invoke(ch.GET_METRICS),

    onStateUpdate:    (cb) => ipcRenderer.on(ch.DASH_STATE,    cb),
    onOutcomesUpdate: (cb) => ipcRenderer.on(ch.DASH_OUTCOMES, cb),
    onFollowUpsUpdate:(cb) => ipcRenderer.on(ch.DASH_FOLLOWUPS,cb),
    onPipelineUpdate: (cb) => ipcRenderer.on(ch.DASH_PIPELINE, cb),
    onSitrepUpdate:   (cb) => ipcRenderer.on(ch.DASH_SITREP,   cb),

    getVelocity:          ()        => ipcRenderer.invoke(ch.GET_VELOCITY),
    getRhythm:            ()        => ipcRenderer.invoke(ch.GET_RHYTHM),
    getUsage:             ()        => ipcRenderer.invoke(ch.GET_USAGE),
    getPeople:            ()        => ipcRenderer.invoke(ch.GET_PEOPLE),
    getSynthesisAI:       (context) => ipcRenderer.invoke(ch.GET_SYNTHESIS_AI, context),
    getLayout:            ()        => ipcRenderer.invoke(ch.GET_LAYOUT),
    saveLayout:           (layout)  => ipcRenderer.invoke(ch.SAVE_LAYOUT, layout),
  },

  // ─── Chat (stream-json mode) ─────────────────────────────────────────────────
  chat: {
    send:   (id, prompt, sessionId, opts) => ipcRenderer.invoke(ch.CHAT_SEND, id, prompt, sessionId, opts),
    respond:(id, text) => ipcRenderer.send(ch.CHAT_RESPOND, id, text),
    cancel: (id) => ipcRenderer.send(ch.CHAT_CANCEL, id),
    onStream: (id, cb) => {
      const channel = `${ch.CHAT_STREAM}:${id}`
      ipcRenderer.on(channel, (_, event) => cb(event))
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

  // ─── Shell ──────────────────────────────────────────────────────────────────
  shell: {
    openPath:     (p)   => ipcRenderer.invoke(ch.SHELL_OPEN_PATH, p),
    openExternal: (url) => ipcRenderer.invoke(ch.SHELL_OPEN_EXTERNAL, url),
  },
})
