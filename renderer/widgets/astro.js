// renderer/widgets/astro.js
// Daily cosmic weather — contextual message derived from transits against natal chart.
// Gracefully invisible when astro tools aren't configured.

const SIGN_NAMES = { Ari:'Aries', Tau:'Taurus', Gem:'Gemini', Can:'Cancer', Leo:'Leo', Vir:'Virgo', Lib:'Libra', Sco:'Scorpio', Sag:'Sagittarius', Cap:'Capricorn', Aqu:'Aquarius', Pis:'Pisces' }

// Triad mapping for natal planets
const TRIAD = {
  authority: ['Sun', 'Pluto', 'Mercury'],
  capacity:  ['Moon', 'Saturn', 'Neptune'],
  expansion: ['Jupiter', 'Mars', 'Uranus'],
}

function triadOf(planet) {
  for (const [leg, planets] of Object.entries(TRIAD)) {
    if (planets.includes(planet)) return leg
  }
  return null
}

// Moon sign energies — 3 variations each for remix
const MOON_ENERGY = {
  Ari: [
    'Energy for bold starts — act on what you\'ve been circling.',
    'Impulse has intelligence today — trust the first move.',
    'Fire under your feet — don\'t overthink, initiate.',
  ],
  Tau: [
    'Slow-build day — trust the body, do what feels solid.',
    'Steady wins today — one thing done well beats three rushed.',
    'Grounding energy available — build from what\'s already working.',
  ],
  Gem: [
    'Mental agility peaks — conversations carry more than usual.',
    'Words land differently today — say the thing you\'ve been holding.',
    'Curiosity is productive — follow the thread that pulls you.',
  ],
  Can: [
    'Inner world speaks louder today — honor what needs tending.',
    'Emotional clarity comes through feeling, not thinking.',
    'Home and foundation energy — tend to what holds you.',
  ],
  Leo: [
    'Creative fire available — let your work be seen.',
    'Visibility energy — what you put out today gets noticed.',
    'Heart-led expression is the move — lead with warmth.',
  ],
  Vir: [
    'Detail energy — good for editing, systems, cleanup.',
    'Refine what exists before building new — precision pays today.',
    'Service orientation — the small things carry weight.',
  ],
  Lib: [
    'Relational day — partnerships and collaborations flow.',
    'Balance-seeking energy — where are you over-giving or under-receiving?',
    'Harmony available — but not at the cost of honesty.',
  ],
  Sco: [
    'Intensity available — go deep on what matters most.',
    'Transformation energy — let something end that needs to.',
    'Power moves today — but only the ones aligned with truth.',
  ],
  Sag: [
    'Big-picture day — strategy and meaning over mechanics.',
    'Expansion energy — aim higher than feels comfortable.',
    'Teaching and vision work flows — share what you know.',
  ],
  Cap: [
    'Builder energy — lay foundations, make commitments.',
    'Structure supports freedom today — build the container first.',
    'Discipline feels natural — use it before it passes.',
  ],
  Aqu: [
    'Pattern-breaking energy — try the unconventional approach.',
    'Innovation day — the weird idea might be the right one.',
    'Systems thinking peaks — see the network, not just the node.',
  ],
  Pis: [
    'Intuition runs high — listen to what surfaces without forcing.',
    'Surrender is productive today — stop pushing, start receiving.',
    'Creative downloads available — make space for what wants to come through.',
  ],
}

// Aspect messages — 2 variations per aspect type + triad leg
const ASPECT_MSG = {
  conjunction: {
    authority: [
      'amplifying your voice — speak with conviction today',
      'identity energy intensified — own what you stand for',
    ],
    capacity: [
      'intensifying your inner rhythm — stay grounded',
      'deep activation of your emotional core — feel it through',
    ],
    expansion: [
      'fueling your drive — channel into what you\'re building',
      'action energy doubled — pick one target and go',
    ],
  },
  trine: {
    authority: [
      'your truth flows easily today — trust what comes naturally',
      'effortless alignment with your voice — use it',
    ],
    capacity: [
      'deep ease available — regulation comes without effort',
      'inner support running strong — ride the current',
    ],
    expansion: [
      'growth happening on autopilot — ride the wave',
      'momentum building without friction — let it carry you',
    ],
  },
  square: {
    authority: [
      'friction on identity — the tension is productive, don\'t avoid it',
      'your truth is being tested — hold your ground',
    ],
    capacity: [
      'emotional pressure building — regulate before you push',
      'capacity being stretched — this is how resilience is built',
    ],
    expansion: [
      'obstacles forcing a better path — adjust, don\'t force',
      'growth edge activated — the resistance IS the way through',
    ],
  },
  opposition: {
    authority: [
      'someone or something mirrors your blind spot today',
      'polarity energy — what you see outside reflects something inside',
    ],
    capacity: [
      'pull between rest and output — find the middle',
      'opposite force illuminating where you\'re off-balance',
    ],
    expansion: [
      'tension between growth and stability — hold both',
      'expansion meets resistance — the synthesis is the breakthrough',
    ],
  },
  sextile: {
    authority: [
      'quiet opportunity to be seen — reach for it',
      'a door opens for your voice — step through',
    ],
    capacity: [
      'subtle support for your inner work today',
      'gentle deepening available — no force needed',
    ],
    expansion: [
      'door cracking open — small action, big leverage',
      'opportunity seed planted — nurture it with one concrete step',
    ],
  },
}

let _cachedTransits = null
let _currentVariant = 0

function pickVariant(arr) {
  return arr[_currentVariant % arr.length]
}

function buildMessage(transits) {
  const moon = transits.moon
  const retros = transits.retrogrades || []
  const aspects = (transits.transit_to_natal_aspects || []).slice(0, 6)

  // Start with moon energy
  const moonSign = moon?.sign
  const moonMsgs = MOON_ENERGY[moonSign]
  let message = moonMsgs ? pickVariant(moonMsgs) : ''

  // Find the tightest planet-to-planet transit aspect
  const tight = aspects.find(a => {
    const name = a.natal_planet
    return triadOf(name) !== null
  })

  if (tight) {
    const aspectType = tight.aspect?.toLowerCase()
    const triad = triadOf(tight.natal_planet)
    const msgs = ASPECT_MSG[aspectType]?.[triad]
    if (msgs) {
      message += ` Transit ${tight.transit_planet} ${pickVariant(msgs)}.`
    }
  }

  // Retrograde warning if relevant
  if (retros.includes('Mercury')) {
    message = 'Mercury retrograde — double-check details and give extra space in communication. ' + message
  }

  return message
}

function buildSubline(transits) {
  const moon = transits.moon
  const phase = moon?.phase?.phase || ''
  const moonSign = SIGN_NAMES[moon?.sign] || moon?.sign || ''
  const retros = transits.retrogrades || []

  let parts = [`☽ ${moonSign}`]
  if (phase) parts.push(phase)
  if (retros.length) parts.push(`℞ ${retros.join(', ')}`)
  return parts.join('  ·  ')
}

export default {
  id: 'astro',
  label: 'Cosmic Weather',
  description: 'Daily contextual message from today\'s transits',
  dataSource: null,
  defaultEnabled: true,

  async render(_data, el) {
    if (!_cachedTransits) {
      try {
        _cachedTransits = await window.ace.astro?.getTransits()
      } catch { /* not configured */ }
    }

    // Graceful fallback: hide entirely if no astro data
    if (!_cachedTransits) {
      el.innerHTML = ''
      el.style.display = 'none'
      return
    }
    el.style.display = ''

    const message = buildMessage(_cachedTransits)
    const subline = buildSubline(_cachedTransits)

    el.innerHTML = `
      <div class="astro-anchor" id="astro-anchor-remix">
        <span class="astro-anchor-text">${message}</span>
        <span class="astro-anchor-sub">${subline}</span>
      </div>`

    // Click to remix
    document.getElementById('astro-anchor-remix')?.addEventListener('click', () => {
      _currentVariant++
      const newMsg = buildMessage(_cachedTransits)
      const textEl = el.querySelector('.astro-anchor-text')
      if (textEl) {
        textEl.style.opacity = '0'
        setTimeout(() => {
          textEl.textContent = newMsg
          textEl.style.opacity = '1'
        }, 200)
      }
    })
  }
}
