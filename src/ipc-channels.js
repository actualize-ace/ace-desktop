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
  DASH_SITREP:     'dash-sitrep-update',

  // Dashboard data requests (renderer → main, invoke/handle)
  GET_STATE:       'get-state',
  GET_PIPELINE:    'get-pipeline',
  GET_FOLLOWUPS:   'get-followups',
  GET_METRICS:     'get-metrics',

  // Vault
  VAULT_LIST_DIR:  'vault-list-dir',
  VAULT_READ_FILE:  'vault-read-file',
  VAULT_WRITE_FILE: 'vault-write-file',
  VAULT_BUILD_GRAPH:    'vault-build-graph',
  VAULT_GRAPH_INVALIDATE: 'vault-graph-invalidate',

  // Config / setup
  GET_CONFIG:      'get-config',
  SAVE_CONFIG:     'save-config',
  PATCH_CONFIG:    'patch-config',
  DETECT_BINARY:   'detect-binary',
  PICK_VAULT:      'pick-vault',

  // Dashboard: new channels
  GET_VELOCITY:           'get-velocity',
  GET_SYNTHESIS_AI:       'get-synthesis-ai',
  SAVE_LAYOUT:            'save-layout',
  GET_LAYOUT:             'get-layout',

  GET_RHYTHM:             'get-rhythm',
  GET_PEOPLE:             'get-people',
  GET_USAGE:              'get-usage',

  // Chat (stream-json mode)
  CHAT_SEND:              'chat-send',
  CHAT_RESPOND:           'chat-respond',
  CHAT_CANCEL:            'chat-cancel',
  CHAT_STREAM:            'chat-stream',
  CHAT_ERROR:             'chat-error',
  CHAT_EXIT:              'chat-exit',

  // Claude settings (~/.claude/settings.json)
  CLAUDE_SETTINGS_READ:   'claude-settings-read',
  CLAUDE_SETTINGS_WRITE:  'claude-settings-write',

  // Chat History
  HISTORY_LIST:           'history-list',
  HISTORY_READ:           'history-read',
  HISTORY_SEARCH:         'history-search',

  // PTY Resume
  PTY_RESUME:             'pty-resume',

  // Artifacts
  ARTIFACTS_LIST:         'artifacts-list',
  ARTIFACTS_DETAIL:       'artifacts-detail',
  ARTIFACTS_SET_STATUS:   'artifacts-set-status',

  // Shell
  SHELL_OPEN_PATH:        'shell-open-path',
  SHELL_OPEN_EXTERNAL:    'shell-open-external',

  // Vault Health
  VAULT_HEALTH_CHECK:     'vault-health-check',
  VAULT_SCAFFOLD_ITEM:    'vault-scaffold-item',
  VAULT_SCAFFOLD_ALL:     'vault-scaffold-all',
  VAULT_GET_COLOR_MAP:    'vault-get-color-map',

  // Insight voice
  INSIGHT_TRANSCRIBE:     'insight-transcribe',
}
