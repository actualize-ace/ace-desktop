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
 * @param {object} [opts]
 * @param {(message: object, ctx: { signal: AbortSignal }) => (HTMLElement | { node: HTMLElement, hydrateHeavy?: () => void })} [opts.renderMessage]
 *   Optional full renderer. Used by hydrate when no snapshot exists.
 *   MUST attach listeners via ctx.signal so releaseNode can tear them down.
 * @param {(node: HTMLElement, message: object, ctx: { signal: AbortSignal }) => void} [opts.onRewire]
 *   Called after snapshot-based hydrate to re-attach listeners on the
 *   fresh node (e.g. attachment click handlers). Listeners MUST use
 *   ctx.signal.
 */
export function createVirtualChatList(container, opts = {}) {
  // Back-compat: older callers pass renderMessage as second arg directly.
  const renderMessage = typeof opts === 'function' ? opts : opts.renderMessage
  const onRewire = typeof opts === 'function' ? null : opts.onRewire
  const mounted = new Map()       // index -> node
  const placeholders = new Map()  // index -> placeholder node
  const snapshots = new Map()     // index -> outerHTML (captured at adopt)
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

  // Retroactively track an existing DOM node + capture its outerHTML as
  // the snapshot source for hydrate after eviction. Used by callers (e.g.
  // session-manager) that already build their own message nodes and just
  // want eviction + snapshot-based restoration, not full render ownership.
  function adopt(node, message) {
    if (!node || message?.index == null) return
    const ac = new AbortController()
    node._ac = ac
    node.dataset.messageIndex = String(message.index)
    snapshots.set(message.index, node.outerHTML)
    mounted.set(message.index, node)
  }

  function hydrate(idx) {
    const ph = placeholders.get(idx)
    if (!ph) return
    const message = currentMessages[idx] || { index: idx }

    const expectedH = Number(ph.dataset.measuredHeight)
    const html = snapshots.get(idx)
    let node
    const ac = new AbortController()

    if (html) {
      const tmpl = document.createElement('template')
      tmpl.innerHTML = html
      node = tmpl.content.firstElementChild
      node._ac = ac
      node.dataset.messageIndex = String(idx)
    } else if (renderMessage) {
      node = renderAttached(message)
    } else {
      return
    }

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

    if (html && typeof onRewire === 'function') {
      try { onRewire(node, message, { signal: ac.signal }) } catch (_) { /* ignored */ }
    } else if (!html) {
      scheduleHeavy(node)
    }

    return node
  }

  // Topmost visible message in the viewport + pixel offset from its top.
  // Used by session switch to persist scroll via { index, offset } instead
  // of pixel scrollTop (which drifts across rehydration when placeholder
  // heights diverge from actual rendered heights by ±2px).
  function topVisible() {
    const containerTop = container.getBoundingClientRect().top
    const entries = [...mounted.entries(), ...placeholders.entries()]
      .sort((a, b) => a[0] - b[0])
    for (const [idx, el] of entries) {
      const rect = el.getBoundingClientRect()
      if (rect.bottom > containerTop + 1) {
        return { index: idx, offset: Math.max(0, containerTop - rect.top) }
      }
    }
    return { index: 0, offset: 0 }
  }

  // Scroll container so the given message index is at the top, adjusted
  // by offset pixels within that message. Hydrates a placeholder if the
  // target index is currently evicted.
  function scrollToIndex(index, offset = 0) {
    if (placeholders.has(index)) hydrate(index)
    const node = mounted.get(index)
    if (!node) return
    const containerRect = container.getBoundingClientRect()
    const nodeRect = node.getBoundingClientRect()
    container.scrollTop += (nodeRect.top - containerRect.top) + offset
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
    adopt,
    hydrate,
    evictAboveFold,
    releaseNode,
    setMessages,
    topVisible,
    scrollToIndex,
    get size() { return mounted.size },
    get messages() { return currentMessages },
    _mounted: mounted,
    _placeholders: placeholders,
    _snapshots: snapshots,
  }
}
