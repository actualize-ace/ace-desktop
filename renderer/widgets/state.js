// renderer/widgets/state.js
export default {
  id: 'state',
  label: 'Mode & Energy',
  description: 'Current operating mode and energy level',
  dataSource: 'getState',
  defaultEnabled: true,

  render(data, el) {
    if (!data || data.error) return
    let html = ''
    if (data.mode) {
      const mode = data.mode.toLowerCase()
      html += `<span class="status-tag ${mode}">${mode}</span>`
    }
    if (data.energy) {
      html += `<span class="status-tag energy">${data.energy}</span>`
    }
    el.innerHTML = html
  }
}
