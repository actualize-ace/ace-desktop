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
 * @param {(message: object, ctx: { signal: AbortSignal }) => HTMLElement} renderMessage
 *   Caller-provided renderer. MUST attach any event listeners with
 *   { signal: ctx.signal } so releaseNode can tear them down.
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

  function mount(message) {
    // A4 implements real mount; skeleton appends a rendered node so
    // callers can exercise the surface without virtualization yet.
    const ac = new AbortController()
    const node = renderMessage(message, { signal: ac.signal })
    node._ac = ac
    node.dataset.messageIndex = String(message.index)
    container.appendChild(node)
    mounted.set(message.index, node)
    return node
  }

  function hydrate(_idx) { /* A4 */ }

  function evictAboveFold(_visibleTopIdx) { /* A4 */ }

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
