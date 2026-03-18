const { contextBridge, ipcRenderer } = require('electron')
const ch = require('./src/ipc-channels')

contextBridge.exposeInMainWorld('ace', {

  // ─── Config / Setup ──────────────────────────────────────────────────────────
  setup: {
    detectBinary:  ()       => ipcRenderer.invoke(ch.DETECT_BINARY),
    pickVault:     ()       => ipcRenderer.invoke(ch.PICK_VAULT),
    saveConfig:    (config) => ipcRenderer.invoke(ch.SAVE_CONFIG, config),
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

    getVelocity:          ()        => ipcRenderer.invoke(ch.GET_VELOCITY),
    getSynthesisAI:       (context) => ipcRenderer.invoke(ch.GET_SYNTHESIS_AI, context),
    getLayout:            ()        => ipcRenderer.invoke(ch.GET_LAYOUT),
    saveLayout:           (layout)  => ipcRenderer.invoke(ch.SAVE_LAYOUT, layout),
  },

  // ─── Vault ───────────────────────────────────────────────────────────────────
  vault: {
    listDir:  (dirPath)  => ipcRenderer.invoke(ch.VAULT_LIST_DIR, dirPath),
    readFile:  (filePath) => ipcRenderer.invoke(ch.VAULT_READ_FILE, filePath),
    writeFile: (filePath, content) => ipcRenderer.invoke(ch.VAULT_WRITE_FILE, filePath, content),
    buildGraph:      ()  => ipcRenderer.invoke(ch.VAULT_BUILD_GRAPH),
    invalidateGraph: ()  => ipcRenderer.invoke(ch.VAULT_GRAPH_INVALIDATE),
  },
})
