// renderer/widgets/compass.js
// Creative Compass — four DCA-anchored cardinal directions with weekly needle
import { escapeHtml } from '../modules/chat-renderer.js'

export default {
  id: 'compass',
  label: 'Creative Compass',
  description: 'DCA-anchored direction with weekly needle from execution log',
  dataSource: null,
  defaultEnabled: true,

  render(allData, el) {
    const ns = allData.northStar || {}
    const directions = ns.compass_directions || {}
    const compass = allData.compass || { direction: null, strength: 0 }

    if (!directions.north) {
      el.innerHTML = ''
      return
    }

    const angle = this._dirAngle(compass.direction)

    el.innerHTML = `
      <div class="cockpit-compass">
        <div class="cmp-rose"></div>
        <div class="cmp-cross"></div>
        <div class="cmp-needle" style="transform: translate(-50%, -100%) rotate(${angle}deg)"></div>
        <div class="cmp-center" data-action="open-dca"></div>
        ${['north','east','south','west'].map(dir => `
          <div class="cmp-dir cmp-${dir} ${compass.direction === dir ? 'active' : ''}" data-dir="${dir}">
            <span class="cmp-letter">${dir[0].toUpperCase()}</span>
            <span class="cmp-label">${escapeHtml(directions[dir]?.label || '')}</span>
          </div>
        `).join('')}
      </div>`

    el.querySelector('[data-action="open-dca"]')?.addEventListener('click', () => {
      document.querySelector('.nav-item[data-view="vault"]')?.click()
    })

    el.querySelectorAll('.cmp-dir').forEach(d => {
      d.addEventListener('click', () => {
        const dir = d.dataset.dir
        const label = directions[dir]?.label || dir
        console.log(`Compass direction: ${dir} — ${label}`)
      })
    })
  },

  _dirAngle(dir) {
    if (dir === 'north') return 0
    if (dir === 'east')  return 90
    if (dir === 'south') return 180
    if (dir === 'west')  return 270
    return 45 // no signal — point northeast as ambient
  },
}
