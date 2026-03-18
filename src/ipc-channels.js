// Single source of truth for all IPC channel name strings.
// Import this in main.js, preload.js, and app.js — never hardcode strings inline.

module.exports = {
  // PTY
  PTY_DATA:        'pty-data',
  PTY_ERROR:       'pty-error',

  // Sessions
  SESSION_SPAWNED: 'session-spawned',
  SESSION_EXIT:    'session-exit',
  SESSION_ERROR:   'session-error',
  SESSION_LIST:    'session-list',

  // Dashboard live updates (chokidar → renderer)
  DASH_STATE:      'dash-state-update',
  DASH_OUTCOMES:   'dash-outcomes-update',
  DASH_FOLLOWUPS:  'dash-followups-update',
  DASH_PIPELINE:   'dash-pipeline-update',

  // Dashboard data requests (renderer → main, invoke/handle)
  GET_STATE:       'get-state',
  GET_PIPELINE:    'get-pipeline',
  GET_FOLLOWUPS:   'get-followups',
  GET_METRICS:     'get-metrics',

  // Vault
  VAULT_LIST_DIR:  'vault-list-dir',
  VAULT_READ_FILE: 'vault-read-file',
  VAULT_BUILD_GRAPH:    'vault-build-graph',
  VAULT_GRAPH_INVALIDATE: 'vault-graph-invalidate',

  // Config / setup
  GET_CONFIG:      'get-config',
  SAVE_CONFIG:     'save-config',
  DETECT_BINARY:   'detect-binary',
  PICK_VAULT:      'pick-vault',

  // Dashboard: new channels
  GET_VELOCITY:           'get-velocity',
  GET_SYNTHESIS_STRUCT:   'get-synthesis-structural',
  GET_SYNTHESIS_AI:       'get-synthesis-ai',
  SAVE_LAYOUT:            'save-layout',
  GET_LAYOUT:             'get-layout',
}
