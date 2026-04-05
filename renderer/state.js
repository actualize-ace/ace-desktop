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
  splitActiveIds: { left: null, right: null },

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
    // Activity tracking
    activityState: 'active',       // 'active' | 'paused' | 'ended'
    lastActivity: Date.now(),
    sessionActiveMin: 0,           // active minutes in current work block
    totalActiveMin: 0,             // cumulative active minutes today (loaded from config)
    completedSessions: 0,          // /close-bounded or auto-closed sessions (loaded from config)
    completedProtocols: 0,         // breath protocols completed to target (loaded from config)

    // Preserved
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

  // Insight view
  insightInitialized: false,
  insight: {
    mode: 'ambient',
    audioCtx: null,
    analyser: null,
    stream: null,
    freqData: null,
    bars: null,
    chatSessionId: null,
  },

  // Cost guardrail (loaded from config in initSessions)
  _costGuardrail: null,

  // Timers (stored for cleanup)
  timeTimer: null,
  agentTimer: null,
}
