// renderer/modules/virtual-chat-list.js
//
// Windowed chat message renderer. Mounts only settled messages within
// BUFFER_ABOVE of the visible range; replaces evicted messages with
// height-preserving placeholders so scrollback position is stable.
//
// The streaming bottom message is always mounted by the caller — this
// module manages *settled* history only.
//
// releaseNode() is called on eviction to null out refs to heavy nested
// state (code-block AST containers, decoded images) AND abort the node's
// AbortController so attached listeners do not pin the detached subtree.
// Without the abort, replaceWith(placeholder) leaks: listeners on nested
// elements (copy buttons, hover handlers, anything) keep the whole
// subtree reachable and heap does not drop on eviction.
//
// Skeleton only — evictAboveFold / hydrate implementations land in A4.

const BUFFER_ABOVE = 20

// Start hydrating placeholders 400px before they enter the viewport so
// content is ready by the time the user scrolls to it (avoids a blank
// flash on fast scroll).
const OBSERVE_ROOT_MARGIN = '400px 0px 0px 0px'

/**
 * @param {HTMLElement} container - Scroll container (e.g. #chat-msgs-{id}).
 * @param {(message: object, ctx: { signal: AbortSignal }) => (HTMLElement | { node: HTMLElement, hydrateHeavy?: () => void })} renderMessage
 *   Caller-provided renderer. MUST attach any event listeners with
 *   { signal: ctx.signal } so releaseNode can tear them down. May return
 *   a plain node (work done synchronously) OR { node, hydrateHeavy }
 *   where hydrateHeavy is deferred to rIC/rAF after mount so fast
 *   scrolls do not jank on syntax highlighting / image decoding.
 */
export function createVirtualChatList(container, renderMessage) {
  const mounted = new Map()       // index -> node
  const placeholders = new Map()  // index -> placeholder node
  let currentMessages = []

  const io = new IntersectionObserver((entries) => {
    for (const entry of entries) {
      if (!entry.isIntersecting) continue
      const idx = Number(entry.target.dataset.messageIndex)
      if (Number.isFinite(idx)) hydrate(idx)
    }
  }, { root: container, rootMargin: OBSERVE_ROOT_MARGIN })

  function renderAttached(message) {
    const ac = new AbortController()
    const result = renderMessage(message, { signal: ac.signal })
    const node = result && result.nodeType ? result : result?.node
    if (!node) throw new Error('renderMessage must return a node or { node }')
    node._ac = ac
    node._hydrateHeavy = result?.hydrateHeavy || null
    node.dataset.messageIndex = String(message.index)
    return node
  }

  // Deferred heavy work (syntax highlighting, image decoding, markdown
  // post-processing). Sync mount resolves layout first so fast scroll
  // doesn't drift; heavy work runs in an idle slot. Aborted-eviction
  // check skips wasted work on nodes evicted before their idle callback.
  function scheduleHeavy(node) {
    if (!node._hydrateHeavy) return
    const signal = node._ac?.signal
    const run = () => {
      if (signal?.aborted) return
      try { node._hydrateHeavy?.() } catch (_) { /* ignored */ }
      node._hydrateHeavy = null
    }
    if (typeof requestIdleCallback === 'function') {
      requestIdleCallback(run, { timeout: 100 })
    } else {
      requestAnimationFrame(run)
    }
  }

  function mount(message) {
    const node = renderAttached(message)
    container.appendChild(node)
    mounted.set(message.index, node)
    scheduleHeavy(node)
    return node
  }

  function hydrate(idx) {
    const ph = placeholders.get(idx)
    if (!ph) return
    const message = currentMessages[idx]
    if (!message) return

    const expectedH = Number(ph.dataset.measuredHeight)
    const node = renderAttached(message)

    io.unobserve(ph)
    ph.replaceWith(node)
    placeholders.delete(idx)
    mounted.set(idx, node)

    // Height reconciliation — drift > 2px means placeholder was the wrong
    // size at eviction and cumulative drift across N placeholders above
    // will misplace scroll on restoration. A6 gates on this counter.
    const actualH = node.getBoundingClientRect().height
    if (expectedH && Math.abs(actualH - expectedH) > 2) {
      window.__virtHeightDrift = (window.__virtHeightDrift || 0) + 1
    }

    scheduleHeavy(node)
    return node
  }

  // Two-pass to avoid layout thrash: PASS 1 reads all heights (no DOM
  // mutation), PASS 2 does replaceWith + releaseNode. Interleaving the
  // two forces a reflow per iteration — on a 100-message eviction that
  // is 100 reflows, making the eviction itself a frame-killer.
  function evictAboveFold(visibleTopIdx) {
    const evictBefore = visibleTopIdx - BUFFER_ABOVE

    const toEvict = []
    for (const [idx, node] of mounted) {
      if (idx < evictBefore) {
        toEvict.push({ idx, node, h: node.getBoundingClientRect().height })
      }
    }

    for (const { idx, node, h } of toEvict) {
      const ph = document.createElement('div')
      ph.className = 'message-placeholder'
      ph.style.height = `${h}px`
      ph.dataset.messageIndex = String(idx)
      ph.dataset.measuredHeight = String(h)
      node.replaceWith(ph)
      releaseNode(node)
      mounted.delete(idx)
      placeholders.set(idx, ph)
      io.observe(ph)
    }
  }

  function releaseNode(node) {
    if (!node) return
    // Abort first — tears down all listeners attached via the signal,
    // releasing their subtree hold. Then null heavy refs so remaining
    // closures don't retain token trees / decoded bitmaps.
    try { node._ac?.abort() } catch (_) { /* ignored */ }
    node._ac = null
    const walk = (n) => {
      if (!n) return
      n._highlightAST = null
      n._decodedImage = null
      n._codeTokens = null
      for (const child of n.children || []) walk(child)
    }
    walk(node)
  }

  function setMessages(messages) { currentMessages = messages }

  return {
    mount,
    hydrate,
    evictAboveFold,
    releaseNode,
    setMessages,
    get size() { return mounted.size },
    get messages() { return currentMessages },
    _mounted: mounted,
    _placeholders: placeholders,
  }
}
