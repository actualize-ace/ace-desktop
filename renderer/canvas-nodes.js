// ─── Canvas Nodes — 7 node types, connections, interaction handlers ──────────
// Loaded after canvas.js. Exposes window.aceCanvasNodes.

;(() => {
  'use strict'

  // ─── Node Colors & Shapes ─────────────────────────────────────────────────
  const NODE_DEFS = {
    goal:      { color: '#e0c878', label: 'Goal',      icon: '◎', w: 180, h: 72, radius: 12 },
    task:      { color: '#70b0e0', label: 'Task',      icon: '☐', w: 170, h: 64, radius: 4 },
    decision:  { color: '#c8a0f0', label: 'Decision',  icon: '◇', w: 160, h: 80, radius: 0 },
    note:      { color: '#60d8a8', label: 'Note',      icon: '✎', w: 160, h: 64, radius: 4 },
    reference: { color: '#8a8a9a', label: 'Reference', icon: '⊞', w: 160, h: 56, radius: 4 },
    milestone: { color: '#e08070', label: 'Milestone', icon: '⚑', w: 170, h: 64, radius: 4 },
    group:     { color: 'transparent', label: 'Group', icon: '⊟', w: 300, h: 200, radius: 8 },
  }

  const STATUS_COLORS = {
    open: 'rgba(136,120,255,0.3)',
    'in-progress': '#e0c878',
    done: '#60d8a8',
  }

  let nodeIdCounter = 0

  function genId () { return 'n' + (++nodeIdCounter) + '-' + Date.now().toString(36) }

  // ─── Create Node ──────────────────────────────────────────────────────────
  function createNode (type, x, y, opts = {}) {
    const def = NODE_DEFS[type]
    if (!def) return null

    const nodeLayer = window.aceCanvas?.getNodeLayer()
    if (!nodeLayer) return null

    const id = opts.id || genId()
    const title = opts.title || def.label
    const body = opts.body || ''
    const isDark = !document.body.classList.contains('light')

    const group = new Konva.Group({
      x, y,
      draggable: true,
      nodeId: id,
      nodeType: type,
      title,
      body,
      status: opts.status || null,
      date: opts.date || null,
      vaultPath: opts.vaultPath || null,
    })

    // ─── Shape ────────────────────────────────────────────────────────
    if (type === 'decision') {
      // Diamond shape
      const hw = def.w / 2, hh = def.h / 2
      const diamond = new Konva.Line({
        points: [hw, 0, def.w, hh, hw, def.h, 0, hh],
        closed: true,
        fill: isDark ? hexAlpha(def.color, 0.12) : hexAlpha(def.color, 0.08),
        stroke: def.color,
        strokeWidth: 1.5,
        name: 'node-shape',
      })
      group.add(diamond)
    } else if (type === 'note') {
      // Sticky note with folded corner
      const fold = 14
      const shape = new Konva.Line({
        points: [0, 0, def.w - fold, 0, def.w, fold, def.w, def.h, 0, def.h],
        closed: true,
        fill: isDark ? hexAlpha(def.color, 0.12) : hexAlpha(def.color, 0.08),
        stroke: def.color,
        strokeWidth: 1.5,
        name: 'node-shape',
      })
      group.add(shape)
      // Fold triangle
      group.add(new Konva.Line({
        points: [def.w - fold, 0, def.w - fold, fold, def.w, fold],
        closed: true,
        fill: isDark ? hexAlpha(def.color, 0.25) : hexAlpha(def.color, 0.15),
        stroke: def.color,
        strokeWidth: 0.5,
      }))
    } else if (type === 'milestone') {
      // Flag/pennant shape
      const flagH = def.h * 0.65
      const shape = new Konva.Line({
        points: [0, 0, def.w, 0, def.w - 16, flagH / 2, def.w, flagH, 0, flagH, 0, def.h],
        closed: false,
        fill: isDark ? hexAlpha(def.color, 0.12) : hexAlpha(def.color, 0.08),
        stroke: def.color,
        strokeWidth: 1.5,
        name: 'node-shape',
      })
      group.add(shape)
      // Pole line
      group.add(new Konva.Line({
        points: [0, flagH, 0, def.h],
        stroke: def.color,
        strokeWidth: 2,
      }))
    } else if (type === 'group') {
      // Dashed boundary
      group.add(new Konva.Rect({
        width: def.w, height: def.h,
        fill: isDark ? 'rgba(136,120,255,0.03)' : 'rgba(90,72,192,0.03)',
        stroke: isDark ? 'rgba(136,120,255,0.2)' : 'rgba(90,72,192,0.2)',
        strokeWidth: 1,
        dash: [8, 4],
        cornerRadius: def.radius,
        name: 'node-shape',
      }))
    } else {
      // Standard rectangle (goal, task, reference)
      group.add(new Konva.Rect({
        width: def.w, height: def.h,
        fill: isDark ? hexAlpha(def.color, 0.12) : hexAlpha(def.color, 0.08),
        stroke: def.color,
        strokeWidth: 1.5,
        cornerRadius: def.radius,
        name: 'node-shape',
      }))
    }

    // ─── Selection border ─────────────────────────────────────────────
    group.add(new Konva.Rect({
      x: -3, y: -3,
      width: def.w + 6, height: def.h + 6,
      stroke: '#8878ff',
      strokeWidth: 2,
      cornerRadius: def.radius + 3,
      dash: [6, 3],
      visible: false,
      name: 'selection-border',
      listening: false,
    }))

    // ─── Icon + Title ─────────────────────────────────────────────────
    const textColor = isDark ? '#e8e6f0' : '#2a2a3e'
    const dimColor = isDark ? 'rgba(232,230,240,0.5)' : 'rgba(42,42,62,0.5)'

    // Type icon
    group.add(new Konva.Text({
      x: 10, y: type === 'decision' ? 25 : 10,
      text: def.icon,
      fontSize: 13,
      fill: def.color,
      fontFamily: 'system-ui',
      listening: false,
    }))

    // Title
    group.add(new Konva.Text({
      x: 28, y: type === 'decision' ? 25 : 10,
      text: title,
      fontSize: 12,
      fontFamily: "'Space Grotesk', 'JetBrains Mono', monospace",
      fontStyle: 'bold',
      fill: textColor,
      width: def.w - 40,
      ellipsis: true,
      wrap: 'none',
      name: 'node-title',
    }))

    // Body text (if provided)
    if (body && type !== 'group') {
      group.add(new Konva.Text({
        x: 10, y: type === 'decision' ? 42 : 28,
        text: body,
        fontSize: 10,
        fontFamily: "'JetBrains Mono', monospace",
        fill: dimColor,
        width: def.w - 20,
        ellipsis: true,
        wrap: 'none',
        name: 'node-body',
      }))
    }

    // Status badge (tasks only)
    if (type === 'task' && opts.status) {
      const statusColor = STATUS_COLORS[opts.status] || STATUS_COLORS.open
      group.add(new Konva.Circle({
        x: def.w - 14, y: 14,
        radius: 4,
        fill: statusColor,
        name: 'status-badge',
      }))
    }

    // Date label (milestones)
    if (type === 'milestone' && opts.date) {
      group.add(new Konva.Text({
        x: 10, y: def.h - 16,
        text: opts.date,
        fontSize: 9,
        fontFamily: "'JetBrains Mono', monospace",
        fill: dimColor,
        name: 'date-label',
      }))
    }

    // ─── Connection Ports ─────────────────────────────────────────────
    const ports = [
      { name: 'port-top',    x: def.w / 2, y: -4 },
      { name: 'port-bottom', x: def.w / 2, y: def.h + 4 },
      { name: 'port-left',   x: -4,        y: def.h / 2 },
      { name: 'port-right',  x: def.w + 4, y: def.h / 2 },
    ]
    ports.forEach(p => {
      const port = new Konva.Circle({
        x: p.x, y: p.y,
        radius: 5,
        fill: def.color,
        opacity: 0,
        name: p.name,
        hitStrokeWidth: 10,
      })
      port.on('mouseenter', () => { port.opacity(0.7); nodeLayer.batchDraw() })
      port.on('mouseleave', () => { port.opacity(0); nodeLayer.batchDraw() })
      port.on('mousedown', (e) => {
        e.cancelBubble = true
        window.aceCanvas.pushUndo()
        window.aceCanvas.startConnectMode()
      })
      group.add(port)
    })

    // ─── Events ───────────────────────────────────────────────────────
    group.on('click tap', (e) => {
      e.cancelBubble = true
      if (window.aceCanvas.isConnecting()) {
        window.aceCanvas.finishConnection(id)
        return
      }
      const additive = e.evt?.shiftKey || false
      window.aceCanvas.selectNode(id, additive)
    })

    group.on('dragstart', () => {
      window.aceCanvas.pushUndo()
    })

    group.on('dragmove', () => {
      updateConnections(id)
    })

    group.on('dragend', () => {
      window.aceCanvas.scheduleAutosave()
    })

    group.on('mouseenter', () => {
      document.getElementById('canvas-container')?.classList.add('node-hover')
    })
    group.on('mouseleave', () => {
      document.getElementById('canvas-container')?.classList.remove('node-hover')
    })

    // Double click → edit title
    group.on('dblclick dbltap', (e) => {
      e.cancelBubble = true
      editNodeTitle(group)
    })

    nodeLayer.add(group)
    nodeLayer.batchDraw()
    return group
  }

  // ─── Edit Node Title (inline) ─────────────────────────────────────────────
  function editNodeTitle (group) {
    const titleText = group.findOne('.node-title')
    if (!titleText) return

    const stage = window.aceCanvas.getStage()
    const scale = stage.scaleX()
    const pos = titleText.getAbsolutePosition()
    const container = document.getElementById('canvas-container')
    const cRect = container.getBoundingClientRect()

    const input = document.createElement('input')
    input.type = 'text'
    input.value = group.attrs.title || ''
    input.className = 'canvas-inline-edit'
    input.style.left = (cRect.left + pos.x) + 'px'
    input.style.top = (cRect.top + pos.y - 2) + 'px'
    input.style.width = (titleText.width() * scale) + 'px'
    input.style.fontSize = (12 * scale) + 'px'
    document.body.appendChild(input)
    input.focus()
    input.select()

    const finish = () => {
      const val = input.value.trim()
      if (val && val !== group.attrs.title) {
        window.aceCanvas.pushUndo()
        group.attrs.title = val
        titleText.text(val)
        window.aceCanvas.getNodeLayer().batchDraw()
        window.aceCanvas.scheduleAutosave()
      }
      input.remove()
    }

    input.addEventListener('blur', finish)
    input.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') finish()
      if (e.key === 'Escape') input.remove()
    })
  }

  // ─── Connections ──────────────────────────────────────────────────────────
  function createConnection (fromId, toId, label = '', direction = 'forward') {
    const connLayer = window.aceCanvas?.getConnLayer()
    const nodeLayer = window.aceCanvas?.getNodeLayer()
    if (!connLayer || !nodeLayer) return null

    const fromGroup = findNodeGroup(fromId)
    const toGroup = findNodeGroup(toId)
    if (!fromGroup || !toGroup) return null

    const connId = 'c-' + fromId + '-' + toId
    const isDark = !document.body.classList.contains('light')
    const strokeColor = isDark ? 'rgba(136,120,255,0.5)' : 'rgba(90,72,192,0.5)'

    const points = computeBezierPoints(fromGroup, toGroup)

    const line = new Konva.Line({
      points,
      stroke: strokeColor,
      strokeWidth: 1.5,
      tension: 0.4,
      connId,
      fromNode: fromId,
      toNode: toId,
      label,
      direction,
      hitStrokeWidth: 12,
    })

    // Arrow head
    if (direction === 'forward' || direction === 'bidirectional') {
      const arrow = new Konva.Arrow({
        points: points.slice(-4),
        pointerLength: 8,
        pointerWidth: 6,
        fill: strokeColor,
        stroke: strokeColor,
        strokeWidth: 1,
        name: 'conn-arrow-' + connId,
        listening: false,
      })
      connLayer.add(arrow)
    }

    // Label on connection
    if (label) {
      const midX = (points[0] + points[points.length - 2]) / 2
      const midY = (points[1] + points[points.length - 1]) / 2
      const labelText = new Konva.Text({
        x: midX - 30, y: midY - 8,
        text: label,
        fontSize: 9,
        fontFamily: "'JetBrains Mono', monospace",
        fill: isDark ? 'rgba(232,230,240,0.4)' : 'rgba(42,42,62,0.4)',
        name: 'conn-label-' + connId,
        listening: false,
      })
      connLayer.add(labelText)
    }

    connLayer.add(line)
    connLayer.batchDraw()
    return line
  }

  function computeBezierPoints (fromGroup, toGroup) {
    const fromDef = NODE_DEFS[fromGroup.attrs.nodeType] || { w: 160, h: 64 }
    const toDef = NODE_DEFS[toGroup.attrs.nodeType] || { w: 160, h: 64 }

    const fx = fromGroup.x() + fromDef.w / 2
    const fy = fromGroup.y() + fromDef.h / 2
    const tx = toGroup.x() + toDef.w / 2
    const ty = toGroup.y() + toDef.h / 2

    // Pick best ports based on relative position
    let fromPort, toPort
    const dx = tx - fx
    const dy = ty - fy

    if (Math.abs(dx) > Math.abs(dy)) {
      // Horizontal connection
      if (dx > 0) {
        fromPort = { x: fromGroup.x() + fromDef.w + 4, y: fromGroup.y() + fromDef.h / 2 }
        toPort = { x: toGroup.x() - 4, y: toGroup.y() + toDef.h / 2 }
      } else {
        fromPort = { x: fromGroup.x() - 4, y: fromGroup.y() + fromDef.h / 2 }
        toPort = { x: toGroup.x() + toDef.w + 4, y: toGroup.y() + toDef.h / 2 }
      }
    } else {
      // Vertical connection
      if (dy > 0) {
        fromPort = { x: fromGroup.x() + fromDef.w / 2, y: fromGroup.y() + fromDef.h + 4 }
        toPort = { x: toGroup.x() + toDef.w / 2, y: toGroup.y() - 4 }
      } else {
        fromPort = { x: fromGroup.x() + fromDef.w / 2, y: fromGroup.y() - 4 }
        toPort = { x: toGroup.x() + toDef.w / 2, y: toGroup.y() + toDef.h + 4 }
      }
    }

    return [fromPort.x, fromPort.y, toPort.x, toPort.y]
  }

  function updateConnections (nodeId) {
    const connLayer = window.aceCanvas?.getConnLayer()
    if (!connLayer) return

    connLayer.getChildren().forEach(child => {
      if (child.attrs?.fromNode === nodeId || child.attrs?.toNode === nodeId) {
        if (child.attrs?.connId) {
          const fromGroup = findNodeGroup(child.attrs.fromNode)
          const toGroup = findNodeGroup(child.attrs.toNode)
          if (fromGroup && toGroup) {
            const points = computeBezierPoints(fromGroup, toGroup)
            child.points(points)

            // Update arrow
            const arrow = connLayer.findOne('.conn-arrow-' + child.attrs.connId)
            if (arrow) arrow.points(points.slice(-4))

            // Update label
            const label = connLayer.findOne('.conn-label-' + child.attrs.connId)
            if (label) {
              label.x((points[0] + points[points.length - 2]) / 2 - 30)
              label.y((points[1] + points[points.length - 1]) / 2 - 8)
            }
          }
        }
      }
    })
    connLayer.batchDraw()
  }

  function findNodeGroup (nodeId) {
    const nodeLayer = window.aceCanvas?.getNodeLayer()
    if (!nodeLayer) return null
    return nodeLayer.getChildren().find(g => g.attrs?.nodeId === nodeId) || null
  }

  // ─── Utility ──────────────────────────────────────────────────────────────
  function hexAlpha (hex, alpha) {
    const r = parseInt(hex.slice(1, 3), 16)
    const g = parseInt(hex.slice(3, 5), 16)
    const b = parseInt(hex.slice(5, 7), 16)
    return `rgba(${r},${g},${b},${alpha})`
  }

  // ─── Public API ───────────────────────────────────────────────────────────
  window.aceCanvasNodes = {
    createNode,
    createConnection,
    updateConnections,
    findNodeGroup,
    NODE_DEFS,
    editNodeTitle,
  }
})()
