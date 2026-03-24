// ─── Canvas AI — Oracle bridge, canvas_ops parser, context injection ─────────
// Loaded after canvas.js and canvas-nodes.js. Bridges Oracle chat with canvas.

;(() => {
  'use strict'

  // ─── Canvas State Serialization for AI ────────────────────────────────────
  function buildAIContext () {
    const canvas = window.aceCanvas?.serialize()
    if (!canvas) return null

    // Build compact node summaries for AI
    const nodes = (canvas.nodes || []).map(n => ({
      id: n.id,
      type: n.type,
      title: n.title,
      body: n.body || undefined,
      status: n.status || undefined,
      date: n.date || undefined,
    }))

    const connections = (canvas.connections || []).map(c => ({
      from: c.from,
      to: c.to,
      label: c.label || undefined,
    }))

    const selected = Array.from(window.aceCanvas.getSelected?.() || [])

    return { nodes, connections, selected }
  }

  // ─── System Prompt Injection ──────────────────────────────────────────────
  function buildCanvasSystemPrompt (canvasContext) {
    const nodeList = (canvasContext?.nodes || [])
      .map(n => `  - [${n.id}] ${n.type}: "${n.title}"${n.body ? ' — ' + n.body : ''}`)
      .join('\n')

    const connList = (canvasContext?.connections || [])
      .map(c => `  - ${c.from} → ${c.to}${c.label ? ' (' + c.label + ')' : ''}`)
      .join('\n')

    const selectedList = (canvasContext?.selected || []).join(', ')

    return `You are assisting on an ACE Planning Canvas — an infinite spatial workspace for strategic thinking.

CANVAS STATE:
Nodes (${canvasContext?.nodes?.length || 0}):
${nodeList || '  (empty canvas)'}

Connections:
${connList || '  (none)'}

Selected nodes: ${selectedList || '(none)'}

AVAILABLE OPERATIONS:
You can manipulate the canvas by including a JSON block in your response with this format:
\`\`\`canvas_ops
{ "canvas_ops": [
  { "op": "add_node", "type": "goal|task|decision|note|reference|milestone", "title": "...", "body": "..." },
  { "op": "add_node", "type": "task", "title": "...", "status": "open|in-progress|done" },
  { "op": "add_node", "type": "milestone", "title": "...", "date": "YYYY-MM-DD" },
  { "op": "connect", "from_idx": 0, "to_idx": 1, "label": "requires" },
  { "op": "connect", "from_id": "n1-abc", "to_id": "n2-def", "label": "enables" },
  { "op": "remove_node", "id": "n1-abc" },
  { "op": "update_node", "id": "n1-abc", "title": "New title", "body": "Updated body" }
]}
\`\`\`

GUIDELINES:
- When generating a plan, create 6-12 nodes with meaningful connections
- Use Goal nodes for objectives, Task nodes for actions, Decision nodes for choice points
- Use Milestone nodes with dates for deadlines/checkpoints
- Connections should have labels like "requires", "enables", "blocks", "depends on"
- Lay out nodes in a logical flow (goals at top, tasks below, milestones at bottom)
- When asked to expand a selected node, create sub-nodes connected to it
- When asked to challenge/analyze, create Note or Decision nodes with observations
- Always include natural language explanation alongside canvas_ops`
  }

  // ─── Parse canvas_ops from AI Response ────────────────────────────────────
  function parseCanvasOps (text) {
    // Look for canvas_ops JSON block
    const patterns = [
      /```canvas_ops\s*\n?([\s\S]*?)```/,
      /```json\s*\n?\s*\{\s*"canvas_ops"([\s\S]*?)```/,
      /\{\s*"canvas_ops"\s*:\s*\[([\s\S]*?)\]\s*\}/,
    ]

    for (const pat of patterns) {
      const match = text.match(pat)
      if (match) {
        try {
          let jsonStr = match[0]
          // Clean up fenced code block markers
          jsonStr = jsonStr.replace(/^```canvas_ops\s*\n?/, '').replace(/```$/, '')
          jsonStr = jsonStr.replace(/^```json\s*\n?/, '').replace(/```$/, '')
          const parsed = JSON.parse(jsonStr)
          return parsed.canvas_ops || []
        } catch (e) {
          console.warn('[canvas-ai] Failed to parse canvas_ops:', e)
        }
      }
    }
    return []
  }

  // ─── Apply canvas_ops to the Canvas ───────────────────────────────────────
  function applyCanvasOps (ops) {
    if (!ops || ops.length === 0) return

    window.aceCanvas.pushUndo()

    const newNodeIds = [] // Track newly created node IDs for from_idx/to_idx references
    let baseX = 100
    let baseY = 100
    let col = 0

    // Calculate starting position (offset from existing nodes)
    const existing = window.aceCanvas.serialize()
    if (existing.nodes.length > 0) {
      const maxX = Math.max(...existing.nodes.map(n => n.x))
      baseX = maxX + 250
      baseY = 100
    }

    ops.forEach((op, idx) => {
      switch (op.op) {
        case 'add_node': {
          // Auto-layout: grid placement
          const x = op.x ?? (baseX + (col % 3) * 220)
          const y = op.y ?? (baseY + Math.floor(col / 3) * 120)
          col++

          const group = window.aceCanvasNodes.createNode(op.type || 'note', x, y, {
            title: op.title || 'Untitled',
            body: op.body || '',
            status: op.status || null,
            date: op.date || null,
            id: op.id || undefined,
          })

          if (group) {
            newNodeIds.push(group.attrs.nodeId)
            // Entrance animation
            group.opacity(0)
            group.scale({ x: 0.8, y: 0.8 })
            animateEntrance(group)
          }
          break
        }

        case 'connect': {
          let fromId = op.from_id || op.from
          let toId = op.to_id || op.to

          // Support index-based references (from_idx/to_idx)
          if (op.from_idx !== undefined && newNodeIds[op.from_idx]) fromId = newNodeIds[op.from_idx]
          if (op.to_idx !== undefined && newNodeIds[op.to_idx]) toId = newNodeIds[op.to_idx]

          if (fromId && toId) {
            window.aceCanvasNodes.createConnection(fromId, toId, op.label || '', op.direction || 'forward')
          }
          break
        }

        case 'remove_node': {
          if (op.id) {
            const group = window.aceCanvasNodes.findNodeGroup(op.id)
            if (group) group.destroy()
          }
          break
        }

        case 'update_node': {
          if (op.id) {
            const group = window.aceCanvasNodes.findNodeGroup(op.id)
            if (group) {
              if (op.title) {
                group.attrs.title = op.title
                const titleText = group.findOne('.node-title')
                if (titleText) titleText.text(op.title)
              }
              if (op.body !== undefined) {
                group.attrs.body = op.body
                const bodyText = group.findOne('.node-body')
                if (bodyText) bodyText.text(op.body)
              }
            }
          }
          break
        }
      }
    })

    window.aceCanvas.getNodeLayer().batchDraw()
    window.aceCanvas.getConnLayer().batchDraw()
    window.aceCanvas.scheduleAutosave()
  }

  // ─── Entrance Animation ───────────────────────────────────────────────────
  function animateEntrance (group) {
    const duration = 300
    const start = performance.now()

    function tick () {
      const elapsed = performance.now() - start
      const t = Math.min(1, elapsed / duration)
      const ease = 1 - Math.pow(1 - t, 3) // ease-out cubic

      group.opacity(ease)
      group.scale({ x: 0.8 + 0.2 * ease, y: 0.8 + 0.2 * ease })
      group.getLayer()?.batchDraw()

      if (t < 1) requestAnimationFrame(tick)
    }
    requestAnimationFrame(tick)
  }

  // ─── AI Assist Actions (context menu) ─────────────────────────────────────
  const ASSIST_ACTIONS = [
    { id: 'expand',    label: 'Expand — break this down',      prompt: 'Break down the selected node(s) into sub-tasks and phases. Create connected child nodes beneath them.' },
    { id: 'challenge', label: 'Challenge — what could go wrong', prompt: 'Analyze the selected node(s) for risks, obstacles, and failure modes. Create Decision or Note nodes with your observations.' },
    { id: 'connect',   label: 'Connect — find relationships',   prompt: 'Look at all nodes on the canvas and suggest connections between the selected node(s) and others. Draw connections with descriptive labels.' },
    { id: 'prioritize',label: 'Prioritize — rank by impact',    prompt: 'Review the selected nodes and rank them by impact and urgency. Update their titles with priority numbers or create a new Note summarizing the ranking.' },
    { id: 'summarize', label: 'Summarize — tell the story',     prompt: 'Read the entire canvas and provide a narrative summary of the plan, its key decisions, dependencies, and potential risks.' },
  ]

  function getAssistActions () { return ASSIST_ACTIONS }

  // ─── Build Full Prompt for Oracle ─────────────────────────────────────────
  function buildOraclePrompt (userMessage, action = null) {
    const context = buildAIContext()
    const systemPrompt = buildCanvasSystemPrompt(context)

    let fullPrompt = userMessage
    if (action) {
      const act = ASSIST_ACTIONS.find(a => a.id === action)
      if (act) fullPrompt = act.prompt
    }

    return {
      systemPrompt,
      userMessage: fullPrompt,
      context,
    }
  }

  // ─── Process Oracle Stream for canvas_ops ─────────────────────────────────
  let streamBuffer = ''

  function onStreamChunk (chunk) {
    // Accumulate streamed text
    if (typeof chunk === 'string') {
      streamBuffer += chunk
    } else if (chunk?.content) {
      streamBuffer += chunk.content
    }

    // Try to parse canvas_ops as they come in
    const ops = parseCanvasOps(streamBuffer)
    if (ops.length > 0) {
      applyCanvasOps(ops)
      streamBuffer = '' // Reset to avoid double-applying
    }
  }

  function resetStreamBuffer () {
    streamBuffer = ''
  }

  // ─── Public API ───────────────────────────────────────────────────────────
  window.aceCanvasAI = {
    buildAIContext,
    buildCanvasSystemPrompt,
    parseCanvasOps,
    applyCanvasOps,
    buildOraclePrompt,
    getAssistActions,
    onStreamChunk,
    resetStreamBuffer,
  }
})()
