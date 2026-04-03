// renderer/modules/ace-mark.js
// ACE Mark SVG animation engine — concave triangle → orb → spinning ring

import { state } from '../state.js'

// ── ACE Mark Animation Engine — Full Flow ──
// Mark (concave A) → Float (3 orbs) → Merge (1 orb) → Spinning
export const ACE_MARK = {
  CX: 50, CY: 50, TRI_R: 34, BULGE: -12,
  active: false, phase: 0, winding: false,
  lastT: 0, _timers: [],

  // Mark
  markScale: 1, tMarkScale: 1,
  markOp: 1, tMarkOp: 1,
  // Disc
  discOp: 0.1, tDiscOp: 0.1,
  // Three orbs: [{x,y,r,op, tx,ty,tr,tOp}]
  orbs: null,
  // Merged orb
  orbR: 0, tOrbR: 0, orbOp: 0, tOrbOp: 0,
  // Center
  centerOp: 0, tCenterOp: 0, centerR: 4, tCenterR: 4,
  // Ring
  ringOp: 0, tRingOp: 0, ringAngle: 0, ringSpeed: 0, tRingSpeed: 0,

  triVerts(R) {
    return [0,1,2].map(i => {
      const a = (-90 + i * 120) * Math.PI / 180
      return { x: this.CX + R * Math.cos(a), y: this.CY + R * Math.sin(a) }
    })
  },

  computePath(scale) {
    const R = this.TRI_R * scale
    const bulge = this.BULGE * scale
    const v = this.triVerts(R)
    let d = `M ${v[0].x.toFixed(2)},${v[0].y.toFixed(2)}`
    for (let i = 0; i < 3; i++) {
      const p1 = v[i], p2 = v[(i+1)%3]
      const mx = (p1.x+p2.x)/2, my = (p1.y+p2.y)/2
      const dx = p2.x-p1.x, dy = p2.y-p1.y
      const len = Math.sqrt(dx*dx+dy*dy)
      let nx = -dy/len, ny = dx/len
      if (nx*(mx-this.CX)+ny*(my-this.CY) < 0) { nx=-nx; ny=-ny }
      d += ` Q ${(mx+nx*bulge).toFixed(2)},${(my+ny*bulge).toFixed(2)} ${p2.x.toFixed(2)},${p2.y.toFixed(2)}`
    }
    return d + ' Z'
  },

  init() {
    this.elMark = document.getElementById('smMark')
    this.elDisc = document.getElementById('smDisc')
    this.elOrb  = document.getElementById('smOrb')
    this.elGlow = document.getElementById('smGlow')
    this.elRing = document.getElementById('sidebarRing')
    this.elSvg  = document.getElementById('sidebarSvg')
    this.elWrap = document.getElementById('sidebarMark')
    this.elOrbEls = [
      document.getElementById('smOrbA'),
      document.getElementById('smOrbC'),
      document.getElementById('smOrbE'),
    ]
    if (!this.elMark) return

    const verts = this.triVerts(this.TRI_R)
    this.orbs = verts.map(v => ({
      x: v.x, y: v.y, r: 0, op: 0,
      tx: v.x, ty: v.y, tr: 0, tOp: 0,
    }))

    this.elMark.setAttribute('d', this.computePath(1))
    this.lastT = performance.now()
    this.tick()
  },

  _lr(cur, target, factor, dt) {
    return cur + (target - cur) * (1 - Math.pow(1 - factor, dt * 60))
  },
  _dl(cur, target, up, down, dt) {
    return this._lr(cur, target, cur < target ? up : down, dt)
  },

  tick() {
    if (!this.elMark) return
    const now = performance.now()
    const dt = Math.min((now - this.lastT) / 1000, 0.05)
    this.lastT = now

    this.markScale = this._dl(this.markScale, this.tMarkScale, 0.05, 0.03, dt)
    this.markOp = this._dl(this.markOp, this.tMarkOp, 0.05, 0.03, dt)
    this.discOp = this._dl(this.discOp, this.tDiscOp, 0.05, 0.025, dt)
    for (const o of this.orbs) {
      o.x = this._dl(o.x, o.tx, 0.06, 0.05, dt)
      o.y = this._dl(o.y, o.ty, 0.06, 0.05, dt)
      if (Math.abs(o.x - o.tx) < 0.3) o.x = o.tx
      if (Math.abs(o.y - o.ty) < 0.3) o.y = o.ty
      o.r = this._dl(o.r, o.tr, 0.05, 0.03, dt)
      o.op = this._dl(o.op, o.tOp, 0.06, 0.03, dt)
    }
    this.orbR = this._dl(this.orbR, this.tOrbR, 0.04, 0.025, dt)
    this.orbOp = this._dl(this.orbOp, this.tOrbOp, 0.05, 0.025, dt)
    this.centerOp = this._dl(this.centerOp, this.tCenterOp, 0.05, 0.02, dt)
    this.centerR = this._dl(this.centerR, this.tCenterR, 0.04, 0.02, dt)
    this.ringOp = this._dl(this.ringOp, this.tRingOp, 0.05, 0.02, dt)
    this.ringSpeed = this._dl(this.ringSpeed, this.tRingSpeed, 0.04, 0.01, dt)
    if (Math.abs(this.ringSpeed) < 0.3 && this.tRingSpeed === 0) this.ringSpeed = 0
    this.ringAngle = (this.ringAngle + this.ringSpeed * dt) % 360

    this.render(now)
    requestAnimationFrame(() => this.tick())
  },

  render(now) {
    if (this.markOp > 0.01) {
      this.elMark.setAttribute('d', this.computePath(this.markScale))
      this.elMark.style.opacity = this.markOp
    } else {
      this.elMark.style.opacity = 0
    }
    this.elDisc.style.opacity = this.discOp
    this.orbs.forEach((o, i) => {
      const el = this.elOrbEls[i]
      el.setAttribute('cx', o.x)
      el.setAttribute('cy', o.y)
      el.setAttribute('r', Math.max(0, o.r))
      el.style.opacity = o.op
    })
    this.elOrb.setAttribute('r', Math.max(0, this.orbR))
    this.elOrb.style.opacity = this.orbOp
    if (this.centerOp > 0.01) {
      const pulseAmp = 3 + (this.ringSpeed / 200) * 4
      const gr = this.centerR + Math.sin(now / 1000 * 1.5 * Math.PI * 2) * pulseAmp
      this.elGlow.setAttribute('r', Math.max(2, gr).toFixed(1))
      this.elGlow.style.opacity = this.centerOp
    } else {
      this.elGlow.style.opacity = 0
    }
    this.elRing.style.opacity = this.ringOp
    this.elRing.style.transform = `rotate(${this.ringAngle}deg)`
    const breath = Math.sin(now / 1000 * 0.4 * Math.PI * 2) * 0.5 + 0.5
    const bm = breath * 0.15
    const glowBase = this.active ? 10 : 5
    const glowAlpha = this.active ? 0.5 : 0.2
    const r1 = glowBase + bm * 6
    const a1 = glowAlpha + bm * 0.1
    this.elSvg.style.filter = `drop-shadow(0 0 ${r1.toFixed(1)}px rgba(136,120,255,${a1.toFixed(3)}))`
  },

  clearTimers() {
    this._timers.forEach(t => clearTimeout(t))
    this._timers = []
  },
  after(ms, fn) {
    this._timers.push(setTimeout(fn, ms))
  },

  setActive(isActive) {
    if (isActive && !this.active && !this.winding) {
      this.active = true
      if (this.elWrap) this.elWrap.classList.add('active')
      this.rampUp()
    } else if (!isActive && this.active && !this.winding) {
      this.active = false
      if (this.elWrap) this.elWrap.classList.remove('active')
      this.windDown()
    }
  },

  rampUp() {
    this.clearTimers()
    this.phase = 1
    const verts = this.triVerts(this.TRI_R)
    const wide = this.triVerts(this.TRI_R * 1.1)
    this.tMarkScale = 0.5
    this.tMarkOp = 0
    this.orbs.forEach((o, i) => {
      o.x = verts[i].x; o.y = verts[i].y; o.r = 0; o.op = 0
      o.tx = wide[i].x; o.ty = wide[i].y
      o.tr = 12; o.tOp = 0.9
    })
    this.after(1000, () => {
      if (!this.active) return
      this.phase = 2
      this.orbs.forEach(o => {
        o.tx = this.CX; o.ty = this.CY; o.tr = 7
      })
      this.centerOp = 0; this.tCenterOp = 0.5; this.tCenterR = 10
    })
    this.after(1800, () => {
      if (!this.active) return
      this.orbs.forEach(o => { o.tr = 0; o.tOp = 0 })
      this.tOrbR = 40; this.tOrbOp = 1
      this.tDiscOp = 0
      this.tCenterOp = 0.8; this.tCenterR = 14
    })
    this.after(2400, () => {
      if (!this.active) return
      this.phase = 3
      this.tRingOp = 1; this.tRingSpeed = 180
      this.tCenterOp = 1; this.tCenterR = 16
    })
  },

  windDown() {
    this.clearTimers()
    this.winding = true
    this.tRingSpeed = 0; this.tRingOp = 0
    this.tCenterOp = 0; this.tCenterR = 4
    this.after(600, () => {
      this.tOrbR = 0; this.tOrbOp = 0
      const verts = this.triVerts(this.TRI_R)
      this.orbs.forEach((o, i) => {
        o.x = this.CX; o.y = this.CY; o.r = 0; o.op = 0
        o.tx = verts[i].x; o.ty = verts[i].y
        o.tr = 10; o.tOp = 0.8
      })
    })
    this.after(1500, () => {
      this.orbs.forEach(o => { o.tr = 0; o.tOp = 0 })
      this.markScale = 0.5; this.markOp = 0
      this.tMarkScale = 1; this.tMarkOp = 1
      this.tDiscOp = 0.08
    })
    this.after(2800, () => {
      this.winding = false
      this.phase = 0
      this.ringSpeed = 0; this.ringOp = 0
      this.orbR = 0; this.orbOp = 0
      this.centerOp = 0; this.centerR = 4
      this.orbs.forEach((o, i) => {
        const v = this.triVerts(this.TRI_R)[i]
        o.x = v.x; o.y = v.y; o.r = 0; o.op = 0
      })
    })
  },
}

// Orb glow state — pulses when any session is streaming
export function updateOrbState() {
  const anyStreaming = Object.values(state.sessions).some(s => s.isStreaming) ||
                       Object.values(state.agentSessions).some(s => s.isStreaming)
  ACE_MARK.setActive(anyStreaming)
  document.body.classList.toggle('streaming', anyStreaming)
}

// Init ACE Mark animation
export function initAceMark() {
  ACE_MARK.init()
}
