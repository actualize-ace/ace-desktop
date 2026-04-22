// ace-desktop/scripts/virtualization-stress.js
//
// A6 verification harness — paste entire file into DevTools Console.
// Requires: window.__aceVL exposed (session-manager.js), one real message sent.
//
// Injects 60 fake messages (40 text, 15 code-with-AST, 5 image-with-bitmap),
// runs 5 scroll cycles, evicts, and asserts:
//   1. scrollTop stable ±2px across cycles
//   2. mounted count bounded after evict
//   3. no detached nodes left in mounted map
//   4. window.__virtHeightDrift < 3

;(async () => {
  const id = document.querySelector('[id^="chat-msgs-"]')?.id?.replace('chat-msgs-', '')
  if (!id) return { error: 'no chat container found' }
  const container = document.getElementById('chat-msgs-' + id)
  const vl = window.__aceVL?.(id)
  if (!vl) return { error: 'virtualList not ready — send one message first to init it' }

  const BASE = 9000
  const FAKE = 60
  const assert = (label, pass, detail = '') => ({ label, result: pass ? '✅' : '❌', detail })
  const assertions = []

  // ── 1. Inject 60 fake messages ──────────────────────────────────────────────
  const anchor = container.firstChild
  for (let i = 0; i < FAKE; i++) {
    const el = document.createElement('div')
    el.className = 'chat-msg ' + (i % 2 ? 'chat-msg-assistant' : 'chat-msg-user')
    el.dataset.a6stress = '1'
    if (i < 40) {
      el.innerHTML = `<div class="chat-msg-label">${i % 2 ? 'ACE' : 'YOU'}</div>` +
        `<div class="chat-msg-content">A6 stress message ${i + 1} — lorem ipsum dolor sit amet consectetur adipiscing elit sed do eiusmod tempor.</div>`
    } else if (i < 55) {
      el.innerHTML = `<div class="chat-msg-label">ACE</div>` +
        `<div class="chat-msg-content"><pre><code>// block ${i}\nfunction fn${i}() { return ${i} }</code></pre></div>`
      el._highlightAST = { tokens: new Array(200).fill('tok'), src: `block-${i}` }
      el._codeTokens = new Array(200).fill('tok')
    } else {
      el.innerHTML = `<div class="chat-msg-label">ACE</div>` +
        `<div class="chat-msg-content"><div style="width:200px;height:100px;background:#2a2a3e;border-radius:4px;"></div></div>`
      el._decodedImage = new Uint8Array(512)
    }
    container.insertBefore(el, anchor)
    vl.adopt(el, { index: BASE + i })
  }

  // ── 2. Scroll stability — 5 cycles top↔bottom ───────────────────────────────
  const scrollTo = (pos) => new Promise(res => {
    container.scrollTop = pos
    requestAnimationFrame(() => requestAnimationFrame(res))
  })
  const maxScroll = container.scrollHeight - container.clientHeight
  const tops = [], bottoms = []
  for (let c = 0; c < 5; c++) {
    await scrollTo(0); tops.push(container.scrollTop)
    await scrollTo(maxScroll); bottoms.push(container.scrollTop)
  }
  const topDrift = Math.max(...tops) - Math.min(...tops)
  const botDrift = Math.max(...bottoms) - Math.min(...bottoms)
  assertions.push(assert('scrollTop=0 stable ±2px across 5 cycles', topDrift <= 2, `drift=${topDrift}px`))
  assertions.push(assert('scrollTop=max stable ±2px across 5 cycles', botDrift <= 2, `drift=${botDrift}px`))

  // ── 3. Evict and check DOM bound ────────────────────────────────────────────
  // evictAboveFold(9059) → evictBefore = 9059-20 = 9039 → evicts 9000..9038 (39 fake) + real msgs
  vl.evictAboveFold(BASE + FAKE - 1)
  const mountedAfter = vl._mounted.size
  const phAfter = vl._placeholders.size
  assertions.push(assert('mounted count ≤ 25 after evict', mountedAfter <= 25, `mounted=${mountedAfter}`))
  assertions.push(assert('placeholders ≥ 35 created', phAfter >= 35, `placeholders=${phAfter}`))

  // ── 4. No detached nodes in mounted map ─────────────────────────────────────
  const detached = [...vl._mounted.values()].filter(n => !document.body.contains(n)).length
  assertions.push(assert('no detached nodes in mounted map', detached === 0, `detached=${detached}`))

  // ── 5. Height drift ─────────────────────────────────────────────────────────
  assertions.push(assert('virtHeightDrift < 3', (window.__virtHeightDrift ?? 0) < 3, `drift=${window.__virtHeightDrift ?? 0}`))

  // ── 6. Heavy-ref release spot-check ─────────────────────────────────────────
  // Index BASE+50 (code block) should NOT be evicted (50 > evictBefore threshold of 39)
  const notEvicted = vl._mounted.get(BASE + 50)
  assertions.push(assert('non-evicted code node still in mounted map', notEvicted != null, `idx=${BASE + 50}`))

  // ── Cleanup ──────────────────────────────────────────────────────────────────
  container.querySelectorAll('[data-a6stress]').forEach(n => n.remove())
  container.querySelectorAll('[data-message-index]').forEach(n => {
    if (Number(n.dataset.messageIndex) >= BASE) n.remove()
  })
  for (let i = 0; i < FAKE; i++) {
    vl._mounted.delete(BASE + i)
    vl._placeholders.delete(BASE + i)
    vl._snapshots.delete(BASE + i)
  }

  const pass = assertions.every(a => a.result === '✅')
  console.table(assertions)
  return {
    summary: pass ? '✅ A6 PASS' : '❌ A6 FAIL',
    heapMB: +(performance.memory?.usedJSHeapSize / 1048576).toFixed(2),
    virtDrift: window.__virtHeightDrift ?? 0,
    assertions,
  }
})()
