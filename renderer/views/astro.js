// renderer/views/astro.js
// Natal birth chart + daily transits — SVG wheel with split-panel detail.

import { state } from '../state.js'

const SIGN_GLYPHS = { Ari:'♈', Tau:'♉', Gem:'♊', Can:'♋', Leo:'♌', Vir:'♍', Lib:'♎', Sco:'♏', Sag:'♐', Cap:'♑', Aqu:'♒', Pis:'♓' }
const SIGN_NAMES  = { Ari:'Aries', Tau:'Taurus', Gem:'Gemini', Can:'Cancer', Leo:'Leo', Vir:'Virgo', Lib:'Libra', Sco:'Scorpio', Sag:'Sagittarius', Cap:'Capricorn', Aqu:'Aquarius', Pis:'Pisces' }
const ASPECT_COLORS = { conjunction:'#c8a0f0', trine:'#60d8a8', sextile:'#70b0e0', square:'#e07080', opposition:'#e080a0' }
const ASPECT_GLYPHS = { conjunction:'☌', trine:'△', sextile:'✱', square:'□', opposition:'☍' }
const TRIAD_COLORS = { authority:'var(--authority)', capacity:'var(--capacity)', expansion:'var(--expansion)' }

let natalData = null
let interpretations = null
let transitData = null
let selectedPlanet = null
let selectedAspect = null

// Re-render the wheel on theme toggle — the SVG bakes light/dark fills into
// its markup at render time, so it can't respond to theme changes via CSS alone.
window.addEventListener('ace-theme-change', () => {
  const container = document.getElementById('astro-wheel-container')
  if (container && natalData) renderWheel(container)
})

// ── Data Loading ─────────────────────────────────────────────────────────────

async function loadNatalChart() {
  try {
    const data = await window.ace.astro.getNatalChart()
    return data || null
  } catch { return null }
}

async function loadInterpretations() {
  try {
    const data = await window.ace.astro.getInterpretations()
    return data || null
  } catch { return null }
}

async function loadTransits() {
  try {
    const result = await window.ace.astro.getTransits()
    return result || null
  } catch (e) {
    console.warn('[astro] transit load failed:', e)
    return null
  }
}

// ── SVG Wheel ────────────────────────────────────────────────────────────────

function degToRad(d) { return d * Math.PI / 180 }

function polarToXY(cx, cy, r, angleDeg) {
  // In astrology charts, 0° (ASC) is at 9 o'clock (left), going counter-clockwise
  const rad = degToRad(180 - angleDeg)
  return { x: cx + r * Math.cos(rad), y: cy - r * Math.sin(rad) }
}

function absToChart(absDeg, ascDeg) {
  // Convert absolute zodiac degree to chart angle (ASC on left = 0°)
  return (absDeg - ascDeg + 360) % 360
}

function renderWheel(container) {
  const size = 480
  const cx = size / 2, cy = size / 2
  const outerR = 220, signR = 195, innerR = 170, houseR = 60
  const planetR = 145, transitR = 232
  const ascDeg = natalData.angles.asc.abs_degree

  let svg = `<svg class="astro-wheel" viewBox="0 0 ${size} ${size}" xmlns="http://www.w3.org/2000/svg">`

  // Defs — glows (theme-aware)
  const isLight = document.body.classList.contains('light')
  const bgInner = isLight ? 'rgba(240,238,246,0.3)' : 'rgba(20,24,40,0.3)'
  const bgOuter = isLight ? 'rgba(232,230,240,0.5)' : 'rgba(8,10,18,0.6)'
  const planetFill = isLight ? 'rgba(240,238,246,0.9)' : 'rgba(16,20,36,0.8)'
  const transitFill = isLight ? 'rgba(240,238,246,0.85)' : 'rgba(16,20,36,0.7)'
  const elFillOpacity = isLight ? 0.08 : 0.06

  svg += `<defs>
    <filter id="planet-glow"><feGaussianBlur stdDeviation="3" result="g"/><feMerge><feMergeNode in="g"/><feMergeNode in="SourceGraphic"/></feMerge></filter>
    <filter id="transit-glow"><feGaussianBlur stdDeviation="2" result="g"/><feMerge><feMergeNode in="g"/><feMergeNode in="SourceGraphic"/></feMerge></filter>
    <radialGradient id="wheel-bg" cx="50%" cy="50%" r="50%">
      <stop offset="0%" stop-color="${bgInner}"/>
      <stop offset="100%" stop-color="${bgOuter}"/>
    </radialGradient>
  </defs>`

  // Background circle
  svg += `<circle cx="${cx}" cy="${cy}" r="${outerR}" fill="url(#wheel-bg)" stroke="var(--border)" stroke-width="0.5"/>`

  // Sign ring — 12 segments
  const signs = ['Ari','Tau','Gem','Can','Leo','Vir','Lib','Sco','Sag','Cap','Aqu','Pis']
  const signElements = { Ari:'fire', Tau:'earth', Gem:'air', Can:'water', Leo:'fire', Vir:'earth', Lib:'air', Sco:'water', Sag:'fire', Cap:'earth', Aqu:'air', Pis:'water' }
  const elementColors = isLight
    ? { fire:'rgba(90,72,192,0.06)', earth:'rgba(26,138,96,0.06)', air:'rgba(48,96,168,0.06)', water:'rgba(192,72,120,0.06)' }
    : { fire:'rgba(200,160,240,0.06)', earth:'rgba(96,216,168,0.06)', air:'rgba(112,176,224,0.06)', water:'rgba(224,128,160,0.06)' }

  for (let i = 0; i < 12; i++) {
    const startAbs = i * 30
    const endAbs = (i + 1) * 30
    const startChart = absToChart(startAbs, ascDeg)
    const endChart = absToChart(endAbs, ascDeg)

    // Segment fill
    const p1 = polarToXY(cx, cy, outerR, startChart)
    const p2 = polarToXY(cx, cy, outerR, endChart)
    const p3 = polarToXY(cx, cy, innerR, endChart)
    const p4 = polarToXY(cx, cy, innerR, startChart)
    const largeArc = 0
    const sweepOuter = 1  // clockwise in SVG (counter-clockwise in astro)
    const sweepInner = 0

    svg += `<path d="M${p1.x},${p1.y} A${outerR},${outerR} 0 ${largeArc},${sweepOuter} ${p2.x},${p2.y} L${p3.x},${p3.y} A${innerR},${innerR} 0 ${largeArc},${sweepInner} ${p4.x},${p4.y} Z" fill="${elementColors[signElements[signs[i]]]}" stroke="var(--border)" stroke-width="0.3"/>`

    // Sign glyph in the middle of the segment
    const midChart = absToChart(startAbs + 15, ascDeg)
    const glyphPos = polarToXY(cx, cy, (outerR + innerR) / 2, midChart)
    svg += `<text x="${glyphPos.x}" y="${glyphPos.y}" class="astro-sign-glyph" text-anchor="middle" dominant-baseline="central">${SIGN_GLYPHS[signs[i]]}</text>`
  }

  // Inner circle
  svg += `<circle cx="${cx}" cy="${cy}" r="${innerR}" fill="none" stroke="var(--border)" stroke-width="0.5"/>`
  svg += `<circle cx="${cx}" cy="${cy}" r="${houseR}" fill="none" stroke="var(--border)" stroke-width="0.3"/>`

  // House lines
  for (const house of natalData.houses) {
    const chartAngle = absToChart(house.abs_degree, ascDeg)
    const p1 = polarToXY(cx, cy, innerR, chartAngle)
    const p2 = polarToXY(cx, cy, houseR, chartAngle)
    const isAngle = [1, 4, 7, 10].includes(house.num)
    svg += `<line x1="${p1.x}" y1="${p1.y}" x2="${p2.x}" y2="${p2.y}" stroke="${isAngle ? 'var(--text-dim)' : 'var(--border)'}" stroke-width="${isAngle ? 0.8 : 0.4}"/>`

    // House number
    const nextHouse = natalData.houses[house.num % 12]
    const midAbs = house.abs_degree + ((nextHouse.abs_degree - house.abs_degree + 360) % 360) / 2
    const midChart = absToChart(midAbs, ascDeg)
    const numPos = polarToXY(cx, cy, (innerR + houseR) / 2 - 5, midChart)
    svg += `<text x="${numPos.x}" y="${numPos.y}" class="astro-house-num" text-anchor="middle" dominant-baseline="central">${house.num}</text>`
  }

  // Angle labels (ASC, MC, DSC, IC)
  for (const [key, angle] of Object.entries(natalData.angles)) {
    const chartAngle = absToChart(angle.abs_degree, ascDeg)
    const lp = polarToXY(cx, cy, innerR + 2, chartAngle)
    // Position label slightly outside inner ring
    const labelR = key === 'asc' ? -14 : key === 'dsc' ? 14 : 0
    const labelY = key === 'mc' ? -10 : key === 'ic' ? 10 : 0
    svg += `<text x="${lp.x + labelR}" y="${lp.y + labelY}" class="astro-angle-label" text-anchor="middle" dominant-baseline="central">${angle.label}</text>`
  }

  // Aspect lines (natal-to-natal) — only planet-to-planet aspects
  const planetKeys = Object.keys(natalData.planets)
  for (const asp of natalData.aspects) {
    if (!planetKeys.includes(asp.p1) || !planetKeys.includes(asp.p2)) continue
    const p1abs = natalData.planets[asp.p1].abs_degree
    const p2abs = natalData.planets[asp.p2].abs_degree
    const c1 = absToChart(p1abs, ascDeg)
    const c2 = absToChart(p2abs, ascDeg)
    const pt1 = polarToXY(cx, cy, houseR + 10, c1)
    const pt2 = polarToXY(cx, cy, houseR + 10, c2)
    const color = ASPECT_COLORS[asp.type] || 'var(--text-dim)'
    const opacity = asp.orb < 2 ? 0.4 : asp.orb < 5 ? 0.2 : 0.1
    const isSelected = selectedAspect && selectedAspect.p1 === asp.p1 && selectedAspect.p2 === asp.p2
    svg += `<line x1="${pt1.x}" y1="${pt1.y}" x2="${pt2.x}" y2="${pt2.y}" stroke="${color}" stroke-width="${isSelected ? 1.5 : 0.6}" opacity="${isSelected ? 0.8 : opacity}" class="astro-aspect-line" data-p1="${asp.p1}" data-p2="${asp.p2}"/>`
  }

  // Natal planets
  const placed = spreadPlanets(natalData.planets, ascDeg, planetR)
  for (const [key, pos] of Object.entries(placed)) {
    const planet = natalData.planets[key]
    const pt = polarToXY(cx, cy, pos.r, pos.angle)
    const triad = natalData.triad_mapping.authority.includes(key) ? 'authority'
      : natalData.triad_mapping.capacity.includes(key) ? 'capacity'
      : natalData.triad_mapping.expansion.includes(key) ? 'expansion' : 'authority'
    const isSelected = selectedPlanet === key
    svg += `<g class="astro-planet-group${isSelected ? ' selected' : ''}" data-planet="${key}" filter="url(#planet-glow)" style="cursor:pointer">
      <circle cx="${pt.x}" cy="${pt.y}" r="${isSelected ? 16 : 13}" fill="${planetFill}" stroke="${TRIAD_COLORS[triad]}" stroke-width="${isSelected ? 1.2 : 0.6}"/>
      <text x="${pt.x}" y="${pt.y}" class="astro-planet-glyph" text-anchor="middle" dominant-baseline="central" fill="${TRIAD_COLORS[triad]}">${planet.glyph}</text>
    </g>`
    // Degree tick to zodiac ring
    const chartAngle = absToChart(planet.abs_degree, ascDeg)
    const tick1 = polarToXY(cx, cy, innerR, chartAngle)
    const tick2 = polarToXY(cx, cy, innerR + 4, chartAngle)
    svg += `<line x1="${tick1.x}" y1="${tick1.y}" x2="${tick2.x}" y2="${tick2.y}" stroke="${TRIAD_COLORS[triad]}" stroke-width="1" opacity="0.5"/>`
  }

  // Transit planets (outer ring, dimmed)
  if (transitData?.transit_planets) {
    for (const [key, tp] of Object.entries(transitData.transit_planets)) {
      const chartAngle = absToChart(tp.abs_degree, ascDeg)
      const pt = polarToXY(cx, cy, transitR, chartAngle)
      const glyph = natalData.planets[key]?.glyph || key[0].toUpperCase()
      const isRetro = tp.retrograde
      svg += `<g class="astro-transit-planet" data-transit="${key}" filter="url(#transit-glow)" style="cursor:pointer" opacity="0.4">
        <circle cx="${pt.x}" cy="${pt.y}" r="9" fill="${transitFill}" stroke="var(--gold-dim)" stroke-width="0.4" stroke-dasharray="${isRetro ? '2,1' : 'none'}"/>
        <text x="${pt.x}" y="${pt.y}" class="astro-transit-glyph" text-anchor="middle" dominant-baseline="central">${glyph}</text>
      </g>`
    }
  }

  // Outer transit ring
  svg += `<circle cx="${cx}" cy="${cy}" r="${outerR + 4}" fill="none" stroke="var(--border)" stroke-width="0.3" stroke-dasharray="2,3"/>`

  svg += '</svg>'
  container.innerHTML = svg

  // Click SVG background to deselect and return to overview
  const svgEl = container.querySelector('.astro-wheel')
  if (svgEl) {
    svgEl.addEventListener('click', (e) => {
      // Only if clicking the SVG itself, not a planet/aspect
      if (e.target.closest('.astro-planet-group') || e.target.closest('.astro-transit-planet') || e.target.closest('.astro-aspect-line')) return
      selectedPlanet = null
      selectedAspect = null
      renderWheel(container)
      renderOverview()
    })
  }

  // Wire click handlers
  container.querySelectorAll('.astro-planet-group').forEach(g => {
    g.addEventListener('click', () => {
      selectedPlanet = g.dataset.planet
      selectedAspect = null
      renderWheel(container)
      renderDetail()
    })
  })
  container.querySelectorAll('.astro-transit-planet').forEach(g => {
    g.addEventListener('click', () => {
      selectedPlanet = g.dataset.transit
      selectedAspect = null
      // Highlight this transit planet
      g.setAttribute('opacity', '1')
      renderTransitDetail(g.dataset.transit)
    })
  })
  container.querySelectorAll('.astro-aspect-line').forEach(line => {
    line.style.cursor = 'pointer'
    line.addEventListener('click', (e) => {
      e.stopPropagation()
      const asp = natalData.aspects.find(a => a.p1 === line.dataset.p1 && a.p2 === line.dataset.p2)
      if (asp) {
        selectedAspect = asp
        selectedPlanet = null
        renderWheel(container)
        renderAspectDetail(asp)
      }
    })
  })
}

// Spread overlapping planets so glyphs don't collide
function spreadPlanets(planets, ascDeg, baseR) {
  const entries = Object.entries(planets).map(([key, p]) => ({
    key,
    angle: absToChart(p.abs_degree, ascDeg),
    r: baseR,
  }))
  entries.sort((a, b) => a.angle - b.angle)

  const minGap = 16 // degrees
  for (let pass = 0; pass < 3; pass++) {
    for (let i = 0; i < entries.length; i++) {
      for (let j = i + 1; j < entries.length; j++) {
        let diff = Math.abs(entries[i].angle - entries[j].angle)
        if (diff > 180) diff = 360 - diff
        if (diff < minGap) {
          entries[i].r = baseR - 8
          entries[j].r = baseR + 8
        }
      }
    }
  }

  const result = {}
  for (const e of entries) result[e.key] = { angle: e.angle, r: e.r }
  return result
}

// ── Right Panel Renderers ────────────────────────────────────────────────────

function renderTransitSummary() {
  const panel = document.getElementById('astro-transit-summary')
  if (!panel) return

  if (!transitData) {
    panel.innerHTML = `<div class="astro-no-transits">
      <span class="astro-dim">Transit data unavailable</span>
      <span class="astro-dim" style="font-size:9px;margin-top:4px">Run: python3 tools/astro/daily_transits.py</span>
    </div>`
    return
  }

  const moon = transitData.moon
  const retros = transitData.retrogrades || []

  // Top transit aspects (tightest 5)
  const topAspects = (transitData.transit_to_natal_aspects || []).slice(0, 6)

  let html = `<div class="astro-transit-header">
    <span class="astro-transit-date">${transitData.date}</span>
    <span class="astro-transit-label">Today's Transits</span>
  </div>`

  // Moon + phase
  html += `<div class="astro-moon-row">
    <span class="astro-moon-glyph">☽</span>
    <div class="astro-moon-info">
      <span class="astro-moon-sign">${SIGN_GLYPHS[moon.sign] || ''} Moon in ${SIGN_NAMES[moon.sign] || moon.sign} ${Math.floor(moon.degree)}°</span>
      <span class="astro-moon-phase">${moon.phase.phase} · ${moon.phase.angle}°</span>
    </div>
  </div>`

  // Retrogrades
  if (retros.length) {
    html += `<div class="astro-retro-row">
      <span class="astro-retro-label">℞</span>
      <span class="astro-retro-list">${retros.join(', ')}</span>
    </div>`
  }

  // Top aspects
  html += '<div class="astro-transit-aspects">'
  for (const asp of topAspects) {
    const color = ASPECT_COLORS[asp.aspect?.toLowerCase()] || 'var(--text-dim)'
    const glyph = ASPECT_GLYPHS[asp.aspect?.toLowerCase()] || asp.aspect
    html += `<div class="astro-transit-aspect-row" data-transit-aspect="${asp.transit_planet}_${asp.natal_planet}" style="cursor:pointer">
      <span class="astro-ta-transit" style="color:var(--gold-dim)">${asp.transit_planet}</span>
      <span class="astro-ta-glyph" style="color:${color}">${glyph}</span>
      <span class="astro-ta-natal">${asp.natal_planet}</span>
      <span class="astro-ta-orb">${asp.orb}°</span>
    </div>`
  }
  html += '</div>'

  panel.innerHTML = html

  // Click handlers for transit aspects
  panel.querySelectorAll('.astro-transit-aspect-row').forEach(row => {
    row.addEventListener('click', () => {
      const [tp, np] = row.dataset.transitAspect.split('_')
      const asp = (transitData.transit_to_natal_aspects || []).find(a =>
        a.transit_planet === tp && a.natal_planet === np
      )
      if (asp) renderTransitAspectDetail(asp)
    })
  })
}

function backLink() {
  return `<div class="astro-back-link" id="astro-back-overview">← Overview</div>`
}

function wireBackLink() {
  document.getElementById('astro-back-overview')?.addEventListener('click', () => {
    selectedPlanet = null
    selectedAspect = null
    renderWheel(document.getElementById('astro-wheel-container'))
    renderOverview()
  })
}

function renderDetail() {
  const panel = document.getElementById('astro-detail-panel')
  if (!panel || !selectedPlanet) return

  const planet = natalData.planets[selectedPlanet]
  if (!planet) return

  let html = backLink()
  const interp = interpretations.planets[selectedPlanet]
  const triad = natalData.triad_mapping.authority.includes(selectedPlanet) ? 'authority'
    : natalData.triad_mapping.capacity.includes(selectedPlanet) ? 'capacity'
    : natalData.triad_mapping.expansion.includes(selectedPlanet) ? 'expansion' : 'authority'

  // Find aspects involving this planet
  const relatedAspects = natalData.aspects.filter(a =>
    a.p1 === selectedPlanet || a.p2 === selectedPlanet
  ).filter(a => Object.keys(natalData.planets).includes(a.p1) && Object.keys(natalData.planets).includes(a.p2))

  html += `<div class="astro-detail-header">
    <span class="astro-detail-glyph" style="color:${TRIAD_COLORS[triad]}">${planet.glyph}</span>
    <div class="astro-detail-title">
      <span class="astro-detail-name">${planet.name}</span>
      <span class="astro-detail-pos">${Math.floor(planet.degree)}°${String(Math.round((planet.degree % 1) * 60)).padStart(2, '0')}' ${SIGN_NAMES[planet.sign]} · House ${planet.house_num}</span>
    </div>
    <span class="astro-triad-badge" style="background:${TRIAD_COLORS[triad]}">${triad.toUpperCase()}</span>
  </div>`

  if (interp) {
    html += `<div class="astro-detail-section">
      <div class="astro-detail-label">Natal Interpretation</div>
      <div class="astro-detail-text">${interp.natal}</div>
    </div>`

    html += `<div class="astro-detail-section">
      <div class="astro-detail-label">Triad Significance</div>
      <div class="astro-detail-text astro-triad-text" style="border-left:2px solid ${TRIAD_COLORS[triad]}">${interp.triad_read}</div>
    </div>`
  }

  if (relatedAspects.length) {
    html += '<div class="astro-detail-section"><div class="astro-detail-label">Aspects</div>'
    for (const asp of relatedAspects) {
      const other = asp.p1 === selectedPlanet ? asp.p2 : asp.p1
      const otherPlanet = natalData.planets[other]
      if (!otherPlanet) continue
      const color = ASPECT_COLORS[asp.type] || 'var(--text-dim)'
      html += `<div class="astro-detail-aspect" style="cursor:pointer" data-asp-p1="${asp.p1}" data-asp-p2="${asp.p2}">
        <span style="color:${color}">${ASPECT_GLYPHS[asp.type] || asp.type}</span>
        <span>${otherPlanet.glyph} ${otherPlanet.name}</span>
        <span class="astro-dim">${asp.type} (${asp.orb}°)</span>
      </div>`
    }
    html += '</div>'
  }

  panel.innerHTML = html
  wireBackLink()

  // Wire aspect clicks in detail
  panel.querySelectorAll('.astro-detail-aspect').forEach(el => {
    el.addEventListener('click', () => {
      const asp = natalData.aspects.find(a => a.p1 === el.dataset.aspP1 && a.p2 === el.dataset.aspP2)
      if (asp) {
        selectedAspect = asp
        selectedPlanet = null
        renderWheel(document.getElementById('astro-wheel-container'))
        renderAspectDetail(asp)
      }
    })
  })
}

function renderAspectDetail(asp) {
  const panel = document.getElementById('astro-detail-panel')
  if (!panel) return

  const p1 = natalData.planets[asp.p1]
  const p2 = natalData.planets[asp.p2]
  if (!p1 || !p2) return

  const color = ASPECT_COLORS[asp.type] || 'var(--text-dim)'
  const interpKey = `${asp.p1}_${asp.type}_${asp.p2}`
  const interp = interpretations.aspects[interpKey] || ''

  let html = backLink()
  html += `<div class="astro-detail-header">
    <span class="astro-detail-glyph" style="color:${color}">${ASPECT_GLYPHS[asp.type] || asp.type}</span>
    <div class="astro-detail-title">
      <span class="astro-detail-name">${p1.glyph} ${p1.name} ${asp.type} ${p2.glyph} ${p2.name}</span>
      <span class="astro-detail-pos">Orb: ${asp.orb}°</span>
    </div>
  </div>`

  if (interp) {
    html += `<div class="astro-detail-section">
      <div class="astro-detail-text">${interp}</div>
    </div>`
  }

  // General aspect meaning
  const generalInterp = interpretations.transit_aspects[asp.type]
  if (generalInterp) {
    html += `<div class="astro-detail-section">
      <div class="astro-detail-label">Aspect Pattern</div>
      <div class="astro-detail-text astro-dim">${generalInterp}</div>
    </div>`
  }

  panel.innerHTML = html
  wireBackLink()
}

function renderTransitDetail(transitKey) {
  const panel = document.getElementById('astro-detail-panel')
  if (!panel || !transitData) return

  const tp = transitData.transit_planets[transitKey]
  if (!tp) return

  const natal = natalData.planets[transitKey]
  const glyph = natal?.glyph || transitKey[0].toUpperCase()

  // Find transit-to-natal aspects for this planet
  const aspects = (transitData.transit_to_natal_aspects || []).filter(a =>
    a.transit_planet.toLowerCase() === transitKey
  )

  let html = backLink()
  html += `<div class="astro-detail-header">
    <span class="astro-detail-glyph" style="color:var(--gold-dim)">${glyph}</span>
    <div class="astro-detail-title">
      <span class="astro-detail-name">Transit ${tp.name || transitKey}</span>
      <span class="astro-detail-pos">${Math.floor(tp.degree)}° ${SIGN_NAMES[tp.sign] || tp.sign}${tp.retrograde ? ' ℞' : ''}</span>
    </div>
    <span class="astro-transit-badge">TRANSIT</span>
  </div>`

  if (aspects.length) {
    html += '<div class="astro-detail-section"><div class="astro-detail-label">Aspects to Natal</div>'
    for (const asp of aspects) {
      const color = ASPECT_COLORS[asp.aspect?.toLowerCase()] || 'var(--text-dim)'
      html += `<div class="astro-detail-aspect">
        <span style="color:${color}">${ASPECT_GLYPHS[asp.aspect?.toLowerCase()] || asp.aspect}</span>
        <span>natal ${asp.natal_planet}</span>
        <span class="astro-dim">${asp.orb}° · ${asp.movement || ''}</span>
      </div>`
    }
    html += '</div>'
  }

  panel.innerHTML = html
  wireBackLink()
}

function renderTransitAspectDetail(asp) {
  const panel = document.getElementById('astro-detail-panel')
  if (!panel) return

  const color = ASPECT_COLORS[asp.aspect?.toLowerCase()] || 'var(--text-dim)'
  const glyph = ASPECT_GLYPHS[asp.aspect?.toLowerCase()] || asp.aspect
  const generalInterp = interpretations.transit_aspects[asp.aspect?.toLowerCase()]

  let html = backLink()
  html += `<div class="astro-detail-header">
    <span class="astro-detail-glyph" style="color:${color}">${glyph}</span>
    <div class="astro-detail-title">
      <span class="astro-detail-name">T.${asp.transit_planet} ${asp.aspect} N.${asp.natal_planet}</span>
      <span class="astro-detail-pos">Orb: ${asp.orb}° · ${asp.movement || ''}</span>
    </div>
  </div>`

  if (generalInterp) {
    html += `<div class="astro-detail-section">
      <div class="astro-detail-text">${generalInterp}</div>
    </div>`
  }

  panel.innerHTML = html
  wireBackLink()
}

// ── Element/Quality Summary ──────────────────────────────────────────────────

function renderChartSummary() {
  const el = document.getElementById('astro-chart-summary')
  if (!el) return

  const { elements, qualities, lunation_phase } = natalData
  const elBars = Object.entries(elements).map(([k, v]) => {
    const colors = { fire:'#c8a0f0', earth:'#60d8a8', air:'#70b0e0', water:'#e080a0' }
    return `<div class="astro-el-row">
      <span class="astro-el-label">${k}</span>
      <div class="astro-el-bar"><div class="astro-el-fill" style="width:${v * 10}%;background:${colors[k]}"></div></div>
      <span class="astro-el-count">${v}</span>
    </div>`
  }).join('')

  const qualBars = Object.entries(qualities).map(([k, v]) => {
    return `<div class="astro-el-row">
      <span class="astro-el-label">${k}</span>
      <div class="astro-el-bar"><div class="astro-el-fill" style="width:${v * 10}%;background:var(--gold-dim)"></div></div>
      <span class="astro-el-count">${v}</span>
    </div>`
  }).join('')

  el.innerHTML = `
    <div class="astro-summary-block">
      <div class="astro-summary-title">Elements</div>
      ${elBars}
    </div>
    <div class="astro-summary-block">
      <div class="astro-summary-title">Modalities</div>
      ${qualBars}
    </div>
    <div class="astro-summary-block">
      <div class="astro-summary-title">Lunation</div>
      <div class="astro-lunation">${lunation_phase} · ${natalData.lunation_angle}°</div>
    </div>
  `
}

// ── Init ─────────────────────────────────────────────────────────────────────

export async function initAstro() {
  const el = document.getElementById('view-astro')
  if (!el) return

  el.innerHTML = `<div class="view-header">
    <div class="view-title">Astro</div>
    <div class="view-actions">
      <span class="astro-birth-info" style="font-family:'JetBrains Mono',monospace;font-size:9px;letter-spacing:0.08em;color:var(--text-dim)">loading...</span>
    </div>
  </div>
  <div class="vbody astro-body">
    <div class="astro-left">
      <div class="astro-wheel-wrap" id="astro-wheel-container"></div>
      <div class="astro-chart-summary" id="astro-chart-summary"></div>
    </div>
    <div class="astro-right">
      <div class="astro-transit-summary" id="astro-transit-summary"></div>
      <div class="astro-detail-panel" id="astro-detail-panel">
        <div class="astro-detail-loading">Loading...</div>
      </div>
    </div>
  </div>`

  // Load data
  ;[natalData, interpretations] = await Promise.all([loadNatalChart(), loadInterpretations()])
  transitData = await loadTransits()

  // Empty state — no natal chart configured (v0.1.6 ships without bundled charts;
  // v0.1.7 will add the birth-details Settings UI that generates per-user charts).
  if (!natalData) {
    el.innerHTML = `<div class="view-header">
      <div class="view-title">Astro</div>
    </div>
    <div class="vbody" style="display:flex;align-items:center;justify-content:center;min-height:400px">
      <div style="max-width:420px;text-align:center;padding:40px 32px">
        <div style="font-size:48px;margin-bottom:20px;opacity:0.4">✦</div>
        <div style="font-size:15px;color:var(--text);margin-bottom:12px;font-weight:500">
          Birth chart not configured
        </div>
        <div style="font-size:13px;color:var(--text-dim);line-height:1.6;margin-bottom:20px">
          Astrology features — natal wheel, daily transits, cosmic weather — require your birth details. Add them in Settings to generate your chart.
        </div>
        <div style="font-size:11px;color:var(--text-dim);opacity:0.6;letter-spacing:0.04em">
          Birth details input ships in v0.1.7
        </div>
      </div>
    </div>`
    return
  }

  // Update birth info label
  const info = el.querySelector('.astro-birth-info')
  if (info) info.textContent = `${natalData.birth.date} · ${natalData.birth.time} · ${natalData.birth.location}`

  // Render
  const wheelContainer = document.getElementById('astro-wheel-container')
  renderWheel(wheelContainer)
  renderTransitSummary()
  renderChartSummary()
  renderOverview()
}

function renderOverview() {
  const panel = document.getElementById('astro-detail-panel')
  if (!panel) return

  const { elements, qualities, lunation_phase, lunation_angle } = natalData

  // Dominant element + modality
  const topEl = Object.entries(elements).sort((a, b) => b[1] - a[1])[0]
  const topQual = Object.entries(qualities).sort((a, b) => b[1] - a[1])[0]

  // Big three
  const sun = natalData.planets.sun
  const moon = natalData.planets.moon
  const asc = natalData.angles.asc

  // Stellium detection
  const stelliumInterp = interpretations.stellium?.sagittarius_8th || ''

  // Count planets per sign
  const signCounts = {}
  for (const p of Object.values(natalData.planets)) {
    signCounts[p.sign] = (signCounts[p.sign] || 0) + 1
  }
  const stelliumSigns = Object.entries(signCounts).filter(([, c]) => c >= 3)

  let html = `<div class="astro-detail-header">
    <span class="astro-detail-glyph" style="color:var(--gold)">⊛</span>
    <div class="astro-detail-title">
      <span class="astro-detail-name">Chart Overview</span>
      <span class="astro-detail-pos">${natalData.birth.date} · ${natalData.birth.time} · ${natalData.birth.location}</span>
    </div>
  </div>`

  // Big Three
  html += `<div class="astro-detail-section">
    <div class="astro-detail-label">The Big Three</div>
    <div class="astro-overview-row"><span class="astro-overview-glyph">${sun.glyph}</span> <strong>Sun</strong> ${SIGN_NAMES[sun.sign]} · House ${sun.house_num}</div>
    <div class="astro-overview-row"><span class="astro-overview-glyph">${moon.glyph}</span> <strong>Moon</strong> ${SIGN_NAMES[moon.sign]} · House ${moon.house_num}</div>
    <div class="astro-overview-row"><span class="astro-overview-glyph">↑</span> <strong>Rising</strong> ${SIGN_NAMES[asc.sign]}</div>
  </div>`

  // Signature
  html += `<div class="astro-detail-section">
    <div class="astro-detail-label">Chart Signature</div>
    <div class="astro-detail-text">Dominant element: <strong>${topEl[0]}</strong> (${topEl[1]}/10) · Dominant mode: <strong>${topQual[0]}</strong> (${topQual[1]}/10)</div>
    <div class="astro-detail-text" style="margin-top:4px">Lunation type: <strong>${lunation_phase}</strong> (${lunation_angle}°)</div>
  </div>`

  // Stellium
  if (stelliumSigns.length) {
    html += `<div class="astro-detail-section">
      <div class="astro-detail-label">Stellium</div>
      <div class="astro-detail-text">${stelliumSigns.map(([s, c]) => `<strong>${c} planets in ${SIGN_NAMES[s]}</strong>`).join(', ')}</div>
      ${stelliumInterp ? `<div class="astro-detail-text" style="margin-top:6px">${stelliumInterp}</div>` : ''}
    </div>`
  }

  // Tightest aspects
  const tightAspects = natalData.aspects
    .filter(a => Object.keys(natalData.planets).includes(a.p1) && Object.keys(natalData.planets).includes(a.p2))
    .slice(0, 5)

  if (tightAspects.length) {
    html += '<div class="astro-detail-section"><div class="astro-detail-label">Tightest Aspects</div>'
    for (const asp of tightAspects) {
      const p1 = natalData.planets[asp.p1]
      const p2 = natalData.planets[asp.p2]
      const color = ASPECT_COLORS[asp.type] || 'var(--text-dim)'
      html += `<div class="astro-detail-aspect" style="cursor:pointer" data-asp-p1="${asp.p1}" data-asp-p2="${asp.p2}">
        <span>${p1.glyph}</span>
        <span style="color:${color}">${ASPECT_GLYPHS[asp.type] || asp.type}</span>
        <span>${p2.glyph}</span>
        <span>${p1.name} ${asp.type} ${p2.name}</span>
        <span class="astro-dim" style="margin-left:auto">${asp.orb}°</span>
      </div>`
    }
    html += '</div>'
  }

  html += `<div class="astro-overview-hint">Click any planet or aspect line to explore</div>`

  panel.innerHTML = html

  // Wire aspect clicks
  panel.querySelectorAll('.astro-detail-aspect').forEach(el => {
    el.addEventListener('click', () => {
      const asp = natalData.aspects.find(a => a.p1 === el.dataset.aspP1 && a.p2 === el.dataset.aspP2)
      if (asp) {
        selectedAspect = asp
        selectedPlanet = null
        renderWheel(document.getElementById('astro-wheel-container'))
        renderAspectDetail(asp)
      }
    })
  })
}

export function onAstroExit() {
  selectedPlanet = null
  selectedAspect = null
}
