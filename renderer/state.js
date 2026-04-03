// renderer/state.js
// Shared state module — single source of truth for all renderer state.
// Imported by all modules; mutated in place.

export const state = {
  // Theme & UI
  theme: localStorage.getItem('ace-theme') || 'dark',
  uiZoom: parseFloat(localStorage.getItem('ace-zoom') || '1'),

  // Terminal sessions
  sessions: {},
  activeId: null,

  // Agent sessions
  agentSessions: {},
  focusedAgentId: null,
  agentsInitialized: false,

  // Chat defaults
  chatDefaults: { model: 'opus', permissions: 'default', effort: 'high' },

  // Telemetry
  usageData: null,
  usageFetching: false,

  // View init flags
  vaultInitialized: false,
  graphInitialized: false,
  peopleInitialized: false,
  historyInitialized: false,
  artifactsInitialized: false,

  // View-specific state
  artifactsData: null,
  artifactsActiveFilter: null,
  artifactsShowArchived: false,

  peopleData: null,
  peopleFollowUps: null,
  peopleActiveFilter: null,
  peopleGraphMode: false,
  peopleGraphSim: null,

  historySessionsList: [],
  historyProjects: [],
  historyTotal: 0,
  historyOffset: 0,
  historyActiveProject: null,

  vaultEditRaw: '',

  // Build mode
  buildModeOn: false,

  // Atmosphere (somatic layer)
  atmosphere: {
    elapsed: 0,
    sessionCount: parseInt(localStorage.getItem('ace-atm-sessions') || '1'),
    totalMinutesToday: parseInt(localStorage.getItem('ace-atm-total') || '0'),
    timeOfDay: 'morning',
    intensity: 0,
    nudgeFired: false,
    nudgeDismissed: false,
    audio: {
      mode: localStorage.getItem('ace-atm-audio-mode') || 'off',
      solfeggio: localStorage.getItem('ace-atm-audio-sol') || 'off',
      binaural: localStorage.getItem('ace-atm-audio-bin') || 'off',
      volume: 0.03,
    },
  },

  // Breath view
  breathActive: false,
  breathRunning: false,
  breathProtocol: 'sighing',
  breathCycles: 0,
  breathTargetCycles: 6,

  // Cost guardrail (loaded from config in initSessions)
  _costGuardrail: null,

  // Timers (stored for cleanup)
  timeTimer: null,
  agentTimer: null,
}
