// ─── Canvas View — Konva Stage management, pan/zoom, toolbar, undo/redo ──────
// Loaded as <script> after Konva. Exposes window.aceCanvas for other modules.

;(() => {
  'use strict'

  // ─── Constants ────────────────────────────────────────────────────────────
  const ZOOM_MIN = 0.1
  const ZOOM_MAX = 4
  const ZOOM_STEP = 1.08
  const UNDO_LIMIT = 50
  const AUTOSAVE_DELAY = 2000

  // ─── State ────────────────────────────────────────────────────────────────
  let stage = null
  let nodeLayer = null
  let connLayer = null
  let bgLayer = null
  let initialized = false
  let canvasId = null
  let canvasTitle = 'Untitled Canvas'
  let undoStack = []
  let redoStack = []
  let autosaveTimer = null

  // Selection state
  let selectedNodes = new Set()
  let selectionRect = null
  let isSelecting = false
  let selStartX = 0, selStartY = 0

  // Connection drawing state
  let isConnecting = false
  let tempLine = null
  let connectFromNode = null
  let connectFromPort = null

  // ─── Init ─────────────────────────────────────────────────────────────────
  function initCanvas () {
    if (initialized) { resizeStage(); return }

    const container = document.getElementById('canvas-container')
    if (!container) return

    const rect = container.getBoundingClientRect()

    stage = new Konva.Stage({
      container: 'canvas-container',
      width: rect.width || 800,
      height: rect.height || 600,
      draggable: true,
    })

    // Background layer (grid pattern)
    bgLayer = new Konva.Layer({ listening: false })
    stage.add(bgLayer)

    // Connection layer (below nodes)
    connLayer = new Konva.Layer()
    stage.add(connLayer)

    // Node layer (on top)
    nodeLayer = new Konva.Layer()
    stage.add(nodeLayer)

    drawGrid()
    setupZoom()
    setupSelection()
    setupKeyboard()

    initialized = true
    resizeStage()
  }

  // ─── Grid Background ─────────────────────────────────────────────────────
  function drawGrid () {
    bgLayer.destroyChildren()
    const scale = stage.scaleX()
    const gridSize = 40
    const pos = stage.position()
    const w = stage.width()
    const h = stage.height()

    // Calculate visible area in stage coords
    const x0 = -pos.x / scale
    const y0 = -pos.y / scale
    const x1 = x0 + w / scale
    const y1 = y0 + h / scale

    const startX = Math.floor(x0 / gridSize) * gridSize
    const startY = Math.floor(y0 / gridSize) * gridSize

    const isDark = !document.body.classList.contains('light')
    const dotColor = isDark ? 'rgba(136,120,255,0.08)' : 'rgba(90,72,192,0.08)'

    for (let x = startX; x < x1; x += gridSize) {
      for (let y = startY; y < y1; y += gridSize) {
        bgLayer.add(new Konva.Circle({
          x, y, radius: 1,
          fill: dotColor,
        }))
      }
    }
    bgLayer.batchDraw()
  }

  // ─── Zoom ─────────────────────────────────────────────────────────────────
  function setupZoom () {
    stage.on('wheel', (e) => {
      e.evt.preventDefault()
      const oldScale = stage.scaleX()
      const pointer = stage.getPointerPosition()

      const mousePointTo = {
        x: (pointer.x - stage.x()) / oldScale,
        y: (pointer.y - stage.y()) / oldScale,
      }

      const direction = e.evt.deltaY > 0 ? -1 : 1
      const newScale = Math.max(ZOOM_MIN, Math.min(ZOOM_MAX,
        direction > 0 ? oldScale * ZOOM_STEP : oldScale / ZOOM_STEP
      ))

      stage.scale({ x: newScale, y: newScale })
      stage.position({
        x: pointer.x - mousePointTo.x * newScale,
        y: pointer.y - mousePointTo.y * newScale,
      })

      drawGrid()
      updateZoomLabel()
    })

    // Redraw grid on pan
    stage.on('dragend', () => drawGrid())
    stage.on('dragmove', () => {
      // Throttled grid redraw during drag
      if (!stage._gridThrottle) {
        stage._gridThrottle = true
        requestAnimationFrame(() => {
          drawGrid()
          stage._gridThrottle = false
        })
      }
    })
  }

  function updateZoomLabel () {
    const el = document.getElementById('canvas-zoom-label')
    if (el) el.textContent = Math.round(stage.scaleX() * 100) + '%'
  }

  function zoomIn () {
    const newScale = Math.min(ZOOM_MAX, stage.scaleX() * ZOOM_STEP)
    const center = { x: stage.width() / 2, y: stage.height() / 2 }
    zoomToPoint(newScale, center)
  }

  function zoomOut () {
    const newScale = Math.max(ZOOM_MIN, stage.scaleX() / ZOOM_STEP)
    const center = { x: stage.width() / 2, y: stage.height() / 2 }
    zoomToPoint(newScale, center)
  }

  function zoomToPoint (newScale, point) {
    const oldScale = stage.scaleX()
    const mousePointTo = {
      x: (point.x - stage.x()) / oldScale,
      y: (point.y - stage.y()) / oldScale,
    }
    stage.scale({ x: newScale, y: newScale })
    stage.position({
      x: point.x - mousePointTo.x * newScale,
      y: point.y - mousePointTo.y * newScale,
    })
    drawGrid()
    updateZoomLabel()
  }

  function fitToContent () {
    const nodes = nodeLayer.getChildren()
    if (nodes.length === 0) return

    let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity
    nodes.forEach(n => {
      const box = n.getClientRect({ relativeTo: nodeLayer })
      minX = Math.min(minX, box.x)
      minY = Math.min(minY, box.y)
      maxX = Math.max(maxX, box.x + box.width)
      maxY = Math.max(maxY, box.y + box.height)
    })

    const padding = 60
    const cw = maxX - minX + padding * 2
    const ch = maxY - minY + padding * 2
    const sw = stage.width()
    const sh = stage.height()
    const scale = Math.min(sw / cw, sh / ch, 2)

    stage.scale({ x: scale, y: scale })
    stage.position({
      x: sw / 2 - (minX + (maxX - minX) / 2) * scale,
      y: sh / 2 - (minY + (maxY - minY) / 2) * scale,
    })
    drawGrid()
    updateZoomLabel()
  }

  // ─── Selection ────────────────────────────────────────────────────────────
  function setupSelection () {
    // Double-click on empty space → create node
    stage.on('dblclick dbltap', (e) => {
      if (e.target !== stage) return
      const pos = stage.getRelativePointerPosition()
      showNodePicker(pos.x, pos.y)
    })

    // Click on empty space → deselect all
    stage.on('click tap', (e) => {
      if (e.target === stage) {
        clearSelection()
      }
    })

    // Box selection via mousedown on stage
    stage.on('mousedown', (e) => {
      if (e.target !== stage || e.evt.button !== 0) return
      if (e.evt.shiftKey) {
        // Start box select
        stage.draggable(false)
        isSelecting = true
        const pos = stage.getRelativePointerPosition()
        selStartX = pos.x
        selStartY = pos.y

        selectionRect = new Konva.Rect({
          x: pos.x, y: pos.y, width: 0, height: 0,
          stroke: 'rgba(136,120,255,0.6)',
          strokeWidth: 1,
          dash: [4, 4],
          fill: 'rgba(136,120,255,0.05)',
        })
        nodeLayer.add(selectionRect)
      }
    })

    stage.on('mousemove', () => {
      if (!isSelecting || !selectionRect) return
      const pos = stage.getRelativePointerPosition()
      const x = Math.min(pos.x, selStartX)
      const y = Math.min(pos.y, selStartY)
      const w = Math.abs(pos.x - selStartX)
      const h = Math.abs(pos.y - selStartY)
      selectionRect.setAttrs({ x, y, width: w, height: h })
      nodeLayer.batchDraw()
    })

    stage.on('mouseup', () => {
      if (!isSelecting) return
      isSelecting = false
      stage.draggable(true)

      if (selectionRect) {
        const box = selectionRect.getClientRect({ relativeTo: nodeLayer })
        selectionRect.destroy()
        selectionRect = null

        // Select nodes within box
        nodeLayer.getChildren().forEach(group => {
          if (!group.attrs?.nodeId) return
          const nb = group.getClientRect({ relativeTo: nodeLayer })
          if (nb.x >= box.x && nb.y >= box.y &&
              nb.x + nb.width <= box.x + box.width &&
              nb.y + nb.height <= box.y + box.height) {
            selectNode(group.attrs.nodeId, true)
          }
        })
      }
    })
  }

  function selectNode (nodeId, additive = false) {
    if (!additive) clearSelection()
    selectedNodes.add(nodeId)
    highlightSelected()
  }

  function deselectNode (nodeId) {
    selectedNodes.delete(nodeId)
    highlightSelected()
  }

  function clearSelection () {
    selectedNodes.clear()
    highlightSelected()
  }

  function highlightSelected () {
    nodeLayer.getChildren().forEach(group => {
      if (!group.attrs?.nodeId) return
      const border = group.findOne('.selection-border')
      if (border) {
        border.visible(selectedNodes.has(group.attrs.nodeId))
      }
    })
    nodeLayer.batchDraw()
    updateToolbarState()
  }

  // ─── Keyboard ─────────────────────────────────────────────────────────────
  function setupKeyboard () {
    document.addEventListener('keydown', (e) => {
      // Only handle when canvas view is active
      if (!document.getElementById('view-canvas')?.classList.contains('active')) return

      if ((e.metaKey || e.ctrlKey) && e.key === 'z') {
        e.preventDefault()
        if (e.shiftKey) redo(); else undo()
      }
      if (e.key === 'Backspace' || e.key === 'Delete') {
        if (selectedNodes.size > 0 && document.activeElement?.tagName !== 'INPUT') {
          e.preventDefault()
          deleteSelected()
        }
      }
    })
  }

  // ─── Undo / Redo ──────────────────────────────────────────────────────────
  function pushUndo () {
    const snapshot = serializeCanvas()
    undoStack.push(snapshot)
    if (undoStack.length > UNDO_LIMIT) undoStack.shift()
    redoStack = []
    scheduleAutosave()
  }

  function undo () {
    if (undoStack.length === 0) return
    redoStack.push(serializeCanvas())
    const prev = undoStack.pop()
    restoreCanvas(prev)
  }

  function redo () {
    if (redoStack.length === 0) return
    undoStack.push(serializeCanvas())
    const next = redoStack.pop()
    restoreCanvas(next)
  }

  // ─── Serialize / Restore ──────────────────────────────────────────────────
  function serializeCanvas () {
    const nodes = []
    nodeLayer.getChildren().forEach(group => {
      if (!group.attrs?.nodeId) return
      nodes.push({
        id: group.attrs.nodeId,
        type: group.attrs.nodeType,
        title: group.attrs.title || '',
        body: group.attrs.body || '',
        x: group.x(),
        y: group.y(),
        status: group.attrs.status || null,
        date: group.attrs.date || null,
        vaultPath: group.attrs.vaultPath || null,
      })
    })

    const connections = []
    connLayer.getChildren().forEach(line => {
      if (!line.attrs?.connId) return
      connections.push({
        from: line.attrs.fromNode,
        to: line.attrs.toNode,
        label: line.attrs.label || '',
        direction: line.attrs.direction || 'forward',
      })
    })

    return {
      id: canvasId,
      title: canvasTitle,
      viewport: {
        x: stage.x(),
        y: stage.y(),
        zoom: stage.scaleX(),
      },
      nodes,
      connections,
    }
  }

  function restoreCanvas (data) {
    nodeLayer.destroyChildren()
    connLayer.destroyChildren()

    if (data.viewport) {
      stage.position({ x: data.viewport.x, y: data.viewport.y })
      stage.scale({ x: data.viewport.zoom, y: data.viewport.zoom })
    }

    if (data.nodes) {
      data.nodes.forEach(n => {
        if (window.aceCanvasNodes) {
          window.aceCanvasNodes.createNode(n.type, n.x, n.y, n)
        }
      })
    }

    if (data.connections) {
      data.connections.forEach(c => {
        if (window.aceCanvasNodes) {
          window.aceCanvasNodes.createConnection(c.from, c.to, c.label, c.direction)
        }
      })
    }

    drawGrid()
    updateZoomLabel()
    nodeLayer.batchDraw()
    connLayer.batchDraw()
  }

  // ─── Autosave ─────────────────────────────────────────────────────────────
  function scheduleAutosave () {
    if (autosaveTimer) clearTimeout(autosaveTimer)
    autosaveTimer = setTimeout(async () => {
      if (!canvasId || !window.ace?.canvas) return
      const data = serializeCanvas()
      data.modified = new Date().toISOString()
      try {
        await window.ace.canvas.write(canvasId, JSON.stringify(data, null, 2))
      } catch (err) {
        console.warn('[canvas] autosave failed:', err)
      }
    }, AUTOSAVE_DELAY)
  }

  // ─── Node Picker ──────────────────────────────────────────────────────────
  function showNodePicker (x, y) {
    // Remove existing picker
    document.getElementById('canvas-node-picker')?.remove()

    const types = [
      { type: 'goal', label: 'Goal', icon: '◎', color: '#e0c878' },
      { type: 'task', label: 'Task', icon: '☐', color: '#70b0e0' },
      { type: 'decision', label: 'Decision', icon: '◇', color: '#c8a0f0' },
      { type: 'note', label: 'Note', icon: '✎', color: '#60d8a8' },
      { type: 'reference', label: 'Reference', icon: '⊞', color: '#8a8a9a' },
      { type: 'milestone', label: 'Milestone', icon: '⚑', color: '#e08070' },
    ]

    const picker = document.createElement('div')
    picker.id = 'canvas-node-picker'
    picker.className = 'canvas-node-picker'

    // Convert stage coords to screen coords
    const scale = stage.scaleX()
    const screenX = x * scale + stage.x()
    const screenY = y * scale + stage.y()
    const container = document.getElementById('canvas-container')
    const cRect = container.getBoundingClientRect()
    picker.style.left = (cRect.left + screenX) + 'px'
    picker.style.top = (cRect.top + screenY) + 'px'

    types.forEach(t => {
      const btn = document.createElement('button')
      btn.className = 'npicker-btn'
      btn.innerHTML = `<span class="npicker-icon" style="color:${t.color}">${t.icon}</span>${t.label}`
      btn.addEventListener('click', () => {
        picker.remove()
        pushUndo()
        if (window.aceCanvasNodes) {
          window.aceCanvasNodes.createNode(t.type, x, y, { title: t.label })
        }
      })
      picker.appendChild(btn)
    })

    document.body.appendChild(picker)

    // Close on click outside
    setTimeout(() => {
      const closeHandler = (e) => {
        if (!picker.contains(e.target)) {
          picker.remove()
          document.removeEventListener('mousedown', closeHandler)
        }
      }
      document.addEventListener('mousedown', closeHandler)
    }, 50)
  }

  // ─── Delete Selected ──────────────────────────────────────────────────────
  function deleteSelected () {
    if (selectedNodes.size === 0) return
    pushUndo()

    // Remove connections involving deleted nodes
    const toRemoveConns = []
    connLayer.getChildren().forEach(line => {
      if (selectedNodes.has(line.attrs?.fromNode) || selectedNodes.has(line.attrs?.toNode)) {
        toRemoveConns.push(line)
      }
    })
    toRemoveConns.forEach(l => l.destroy())

    // Remove nodes
    nodeLayer.getChildren().forEach(group => {
      if (selectedNodes.has(group.attrs?.nodeId)) {
        group.destroy()
      }
    })

    clearSelection()
    nodeLayer.batchDraw()
    connLayer.batchDraw()
    scheduleAutosave()
  }

  // ─── Toolbar State ────────────────────────────────────────────────────────
  function updateToolbarState () {
    const connectBtn = document.getElementById('canvas-connect-btn')
    const deleteBtn = document.getElementById('canvas-delete-btn')
    const aiBtn = document.getElementById('canvas-ai-btn')
    if (connectBtn) connectBtn.disabled = selectedNodes.size < 1
    if (deleteBtn) deleteBtn.disabled = selectedNodes.size === 0
    if (aiBtn) aiBtn.disabled = false
  }

  // ─── Resize ───────────────────────────────────────────────────────────────
  function resizeStage () {
    if (!stage) return
    const container = document.getElementById('canvas-container')
    if (!container) return
    const rect = container.getBoundingClientRect()
    stage.width(rect.width)
    stage.height(rect.height)
    drawGrid()
  }

  // ─── Connection Mode ──────────────────────────────────────────────────────
  function startConnectMode () {
    if (selectedNodes.size === 0) return
    isConnecting = true
    connectFromNode = Array.from(selectedNodes)[0]
    document.getElementById('canvas-container')?.classList.add('connecting')

    // Show instruction
    const hint = document.getElementById('canvas-hint')
    if (hint) {
      hint.textContent = 'Click a target node to connect'
      hint.style.display = 'block'
    }
  }

  function finishConnection (toNodeId) {
    if (!isConnecting || !connectFromNode || connectFromNode === toNodeId) {
      cancelConnection()
      return
    }
    pushUndo()
    if (window.aceCanvasNodes) {
      window.aceCanvasNodes.createConnection(connectFromNode, toNodeId, '', 'forward')
    }
    cancelConnection()
  }

  function cancelConnection () {
    isConnecting = false
    connectFromNode = null
    if (tempLine) { tempLine.destroy(); tempLine = null }
    document.getElementById('canvas-container')?.classList.remove('connecting')
    const hint = document.getElementById('canvas-hint')
    if (hint) hint.style.display = 'none'
    connLayer.batchDraw()
  }

  // ─── Canvas Load / New ────────────────────────────────────────────────────
  async function loadCanvas (id) {
    if (!window.ace?.canvas) return
    try {
      const raw = await window.ace.canvas.read(id)
      const data = JSON.parse(raw)
      canvasId = data.id || id
      canvasTitle = data.title || 'Untitled'
      undoStack = []
      redoStack = []
      restoreCanvas(data)
      updateTitleDisplay()
    } catch (err) {
      console.warn('[canvas] load failed:', err)
    }
  }

  function newCanvas (title = 'Untitled Canvas') {
    canvasId = 'canvas-' + Date.now()
    canvasTitle = title
    undoStack = []
    redoStack = []
    nodeLayer.destroyChildren()
    connLayer.destroyChildren()
    stage.position({ x: 0, y: 0 })
    stage.scale({ x: 1, y: 1 })
    drawGrid()
    updateZoomLabel()
    updateTitleDisplay()
    scheduleAutosave()
  }

  function updateTitleDisplay () {
    const el = document.getElementById('canvas-title')
    if (el) el.textContent = canvasTitle
  }

  // ─── Public API ───────────────────────────────────────────────────────────
  window.aceCanvas = {
    init: initCanvas,
    resize: resizeStage,
    getStage: () => stage,
    getNodeLayer: () => nodeLayer,
    getConnLayer: () => connLayer,
    serialize: serializeCanvas,
    restore: restoreCanvas,
    pushUndo,
    undo,
    redo,
    zoomIn,
    zoomOut,
    fitToContent,
    selectNode,
    deselectNode,
    clearSelection,
    getSelected: () => selectedNodes,
    deleteSelected,
    startConnectMode,
    finishConnection,
    cancelConnection,
    isConnecting: () => isConnecting,
    loadCanvas,
    newCanvas,
    showNodePicker,
    scheduleAutosave,
    drawGrid,
  }
})()
