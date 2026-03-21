// renderer/widgets/identity.js
export default {
  id: 'identity',
  label: 'Identity Anchor',
  description: 'Grounding line from your Definite Chief Aim',
  dataSource: 'getState',
  defaultEnabled: true,

  render(data, el) {
    const dca = data?.dca
    if (!dca) { el.innerHTML = ''; return }

    el.innerHTML = `
      <div class="identity-anchor">
        <span class="identity-text">${dca.replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;')}</span>
      </div>`
  }
}
