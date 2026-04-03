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

  // Cost guardrail (loaded from config in initSessions)
  _costGuardrail: null,

  // Timers (stored for cleanup)
  timeTimer: null,
  agentTimer: null,
}
