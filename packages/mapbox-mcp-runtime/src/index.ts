/**
 * mapbox-mcp-runtime — MCP Server for Mapbox GL JS
 *
 * 通过标准 MCP 协议暴露 Mapbox GL JS 操控工具，
 * 通过 WebSocket 桥接到浏览器中的 mapbox-mcp-bridge 执行。
 *
 * 架构：
 *   AI Agent <-> MCP Server (stdio) <-> WebSocket <-> Browser (mapbox-mcp-bridge)
 *   Backend  <-> HTTP POST /api/command <-> WebSocket <-> Browser (mapbox-mcp-bridge)
 */

import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js'
import { z } from 'zod'
import { WebSocketServer, WebSocket, type RawData } from 'ws'
import { createServer, type IncomingMessage, type ServerResponse } from 'node:http'

// ==================== WebSocket Bridge ====================

const WS_PORT = parseInt(process.env.MAPBOX_WS_PORT ?? '9200')
const MAX_PORT_RETRIES = 10

/** 按 sessionId 管理已连接的浏览器 */
const browserClients = new Map<string, WebSocket>()

/** 等待浏览器响应的 pending requests */
const pendingRequests = new Map<string, {
  resolve: (result: unknown) => void
  reject: (err: Error) => void
  timer: ReturnType<typeof setTimeout>
}>()

let requestIdCounter = 0
let _relayPort = 0

const DEFAULT_SESSION_ID = process.env.DEFAULT_SESSION_ID ?? 'default'

function getDefaultBrowser(): WebSocket | null {
  if (browserClients.size === 0) return null
  const preferred = browserClients.get(DEFAULT_SESSION_ID)
  if (preferred && preferred.readyState === WebSocket.OPEN) return preferred
  return browserClients.values().next().value ?? null
}

function sendToBrowser(action: string, params: Record<string, unknown>, timeoutMs = 30000): Promise<unknown> {
  if (_relayPort > 0) return _sendViaRelay(action, params, timeoutMs)
  return new Promise((resolve, reject) => {
    const ws = getDefaultBrowser()
    if (!ws || ws.readyState !== WebSocket.OPEN) {
      reject(new Error('No browser connected. Please open the page with mapbox-mcp-bridge and connect via WebSocket.'))
      return
    }

    const reqId = `req_${++requestIdCounter}`
    const timer = setTimeout(() => {
      pendingRequests.delete(reqId)
      reject(new Error(`Browser response timeout (${timeoutMs}ms)`))
    }, timeoutMs)

    pendingRequests.set(reqId, { resolve, reject, timer })

    ws.send(JSON.stringify({
      jsonrpc: '2.0',
      id: reqId,
      method: action,
      params,
    }))
  })
}

function pushToBrowser(sessionId: string, command: { action: string; params: Record<string, unknown> }): boolean {
  if (_relayPort > 0) {
    _pushViaRelay(sessionId, command)
    return true
  }
  const ws = browserClients.get(sessionId) ?? getDefaultBrowser()
  if (!ws || ws.readyState !== WebSocket.OPEN) return false
  ws.send(JSON.stringify({
    jsonrpc: '2.0',
    id: `push_${++requestIdCounter}`,
    method: command.action,
    params: command.params,
  }))
  return true
}

async function _sendViaRelay(action: string, params: Record<string, unknown>, timeoutMs: number): Promise<unknown> {
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), timeoutMs)
  try {
    const resp = await fetch(`http://127.0.0.1:${_relayPort}/api/relay`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action, params }),
      signal: controller.signal,
    })
    const data = await resp.json() as { ok: boolean; result?: unknown; error?: string }
    if (!data.ok) throw new Error(data.error ?? 'Relay failed')
    return data.result
  } catch (err: unknown) {
    if (err instanceof DOMException && err.name === 'AbortError') {
      throw new Error(`Browser response timeout (${timeoutMs}ms, via relay)`)
    }
    throw err
  } finally {
    clearTimeout(timer)
  }
}

function _pushViaRelay(sessionId: string, command: { action: string; params: Record<string, unknown> }) {
  fetch(`http://127.0.0.1:${_relayPort}/api/command`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ sessionId, command }),
  }).catch(() => { /* fire-and-forget */ })
}

function handleHttpRequest(req: IncomingMessage, res: ServerResponse) {
  res.setHeader('Access-Control-Allow-Origin', '*')
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS')
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type')

  if (req.method === 'OPTIONS') {
    res.writeHead(204)
    res.end()
    return
  }

  if (req.method === 'POST' && req.url?.startsWith('/api/command')) {
    let body = ''
    req.on('data', (chunk: Buffer) => { body += chunk.toString() })
    req.on('end', () => {
      try {
        const payload = JSON.parse(body)
        const sessionId: string = payload.sessionId ?? 'default'
        const commands: Array<{ action: string; params: Record<string, unknown> }> =
          Array.isArray(payload.commands) ? payload.commands : [payload.command]

        let sent = 0
        for (const cmd of commands) {
          if (cmd && pushToBrowser(sessionId, cmd)) sent++
        }

        res.writeHead(200, { 'Content-Type': 'application/json' })
        res.end(JSON.stringify({ ok: true, sent, total: commands.length }))
      } catch {
        res.writeHead(400, { 'Content-Type': 'application/json' })
        res.end(JSON.stringify({ ok: false, error: 'Invalid JSON' }))
      }
    })
    return
  }

  if (req.method === 'POST' && req.url?.startsWith('/api/relay')) {
    let body = ''
    req.on('data', (chunk: Buffer) => { body += chunk.toString() })
    req.on('end', async () => {
      try {
        const { action, params } = JSON.parse(body) as { action: string; params: Record<string, unknown> }
        const result = await sendToBrowser(action, params)
        res.writeHead(200, { 'Content-Type': 'application/json' })
        res.end(JSON.stringify({ ok: true, result }))
      } catch (err) {
        res.writeHead(200, { 'Content-Type': 'application/json' })
        res.end(JSON.stringify({ ok: false, error: err instanceof Error ? err.message : String(err) }))
      }
    })
    return
  }

  if (req.method === 'GET' && req.url?.startsWith('/api/status')) {
    const sessions = Array.from(browserClients.keys())
    res.writeHead(200, { 'Content-Type': 'application/json' })
    res.end(JSON.stringify({ ok: true, server: 'mapbox-mcp-runtime', sessions, connections: sessions.length }))
    return
  }

  res.writeHead(404)
  res.end('Not Found')
}

async function _probeExistingInstance(port: number): Promise<boolean> {
  try {
    const resp = await fetch(`http://127.0.0.1:${port}/api/status`, { signal: AbortSignal.timeout(1500) })
    const data = await resp.json() as { server?: string }
    return data.server === 'mapbox-mcp-runtime'
  } catch {
    return false
  }
}

function _tryListen(httpServer: ReturnType<typeof createServer>, port: number): Promise<boolean> {
  return new Promise(resolve => {
    const onError = (err: NodeJS.ErrnoException) => {
      httpServer.removeListener('listening', onListening)
      if (err.code === 'EADDRINUSE') resolve(false)
      else { console.error(`[mapbox-mcp-runtime] HTTP server error:`, err.message); resolve(false) }
    }
    const onListening = () => {
      httpServer.removeListener('error', onError)
      resolve(true)
    }
    httpServer.once('error', onError)
    httpServer.once('listening', onListening)
    httpServer.listen(port)
  })
}

async function startServer() {
  const httpServer = createServer(handleHttpRequest)
  const wss = new WebSocketServer({ server: httpServer })
  _setupWss(wss)

  if (await _tryListen(httpServer, WS_PORT)) {
    console.error(`[mapbox-mcp-runtime] HTTP + WebSocket server on http://localhost:${WS_PORT}`)
    return
  }

  httpServer.close()
  if (await _probeExistingInstance(WS_PORT)) {
    _relayPort = WS_PORT
    console.error(`[mapbox-mcp-runtime] Port ${WS_PORT} occupied by existing instance — relay mode enabled`)
    return
  }

  for (let offset = 1; offset <= MAX_PORT_RETRIES; offset++) {
    const tryPort = WS_PORT + offset
    const altServer = createServer(handleHttpRequest)
    const altWss = new WebSocketServer({ server: altServer })
    _setupWss(altWss)
    if (await _tryListen(altServer, tryPort)) {
      console.error(`[mapbox-mcp-runtime] Port ${WS_PORT} occupied, using port ${tryPort}`)
      return
    }
    altServer.close()
  }

  console.error(`[mapbox-mcp-runtime] Could not find available port (tried ${WS_PORT}-${WS_PORT + MAX_PORT_RETRIES}), WebSocket server disabled`)
}

function _setupWss(wss: WebSocketServer) {
  wss.on('connection', (ws: WebSocket, req: IncomingMessage) => {
    const sessionId = new URL(req.url ?? '/', `http://localhost`).searchParams.get('session') ?? 'default'
    console.error(`[ws] Browser connected: session=${sessionId}`)
    browserClients.set(sessionId, ws)

    ws.on('message', (raw: RawData) => {
      try {
        const msg = JSON.parse(raw.toString())
        if (msg.id && pendingRequests.has(msg.id)) {
          const pending = pendingRequests.get(msg.id)!
          pendingRequests.delete(msg.id)
          clearTimeout(pending.timer)
          if (msg.error) {
            pending.reject(new Error(msg.error.message ?? JSON.stringify(msg.error)))
          } else {
            pending.resolve(msg.result)
          }
        }
      } catch { /* ignore parse errors */ }
    })

    ws.on('close', () => {
      console.error(`[ws] Browser disconnected: session=${sessionId}`)
      browserClients.delete(sessionId)
    })
  })
}

// ==================== MCP Server ====================

declare const __VERSION__: string

const PKG_VERSION = typeof __VERSION__ !== 'undefined' ? __VERSION__ : '0.1.0'

const server = new McpServer({
  name: 'mapbox-mcp-runtime',
  version: PKG_VERSION,
  title: 'Mapbox MCP Runtime',
  description: 'AI-powered 2D/3D map control via MCP — camera, layers, markers, sources, drawing, and interaction with Mapbox GL JS.',
  websiteUrl: 'https://github.com/gaopengbin/mapbox-mcp',
}, {
  instructions: 'Mapbox MCP Runtime provides tools for controlling a Mapbox GL JS map via AI. A browser with mapbox-mcp-bridge must be connected via WebSocket for command execution. Use view tools (flyTo, easeTo, fitBounds) to navigate, layer/source tools to manage data, marker tools for annotations, and interaction tools for screenshots and feature queries.',
})

// ==================== Resources ====================

server.resource(
  'camera',
  'mapbox://map/camera',
  { description: 'Current map camera state (center, zoom, bearing, pitch)', mimeType: 'application/json' },
  async () => {
    try {
      const result = await sendToBrowser('getView', {})
      return { contents: [{ uri: 'mapbox://map/camera', text: JSON.stringify(result), mimeType: 'application/json' }] }
    } catch {
      return { contents: [{ uri: 'mapbox://map/camera', text: '{"error":"no browser connected"}', mimeType: 'application/json' }] }
    }
  },
)

server.resource(
  'layers',
  'mapbox://map/layers',
  { description: 'Current map layers list', mimeType: 'application/json' },
  async () => {
    try {
      const result = await sendToBrowser('listLayers', {})
      return { contents: [{ uri: 'mapbox://map/layers', text: JSON.stringify(result), mimeType: 'application/json' }] }
    } catch {
      return { contents: [{ uri: 'mapbox://map/layers', text: '{"error":"no browser connected"}', mimeType: 'application/json' }] }
    }
  },
)

// ==================== Toolsets ====================

const TOOLSETS: Record<string, string[]> = {
  view: ['flyTo', 'easeTo', 'jumpTo', 'getView', 'fitBounds', 'resetNorth', 'zoomIn', 'zoomOut'],
  layer: ['addLayer', 'removeLayer', 'listLayers', 'setLayerVisibility', 'setPaintProperty', 'setLayoutProperty', 'setFilter', 'moveLayer'],
  source: ['addSource', 'removeSource', 'listSources', 'getSourceData', 'setSourceData'],
  marker: ['addMarker', 'removeMarker', 'updateMarker', 'listMarkers'],
  draw: ['addGeoJSON', 'addImage', 'removeImage'],
  style: ['setStyle', 'getStyle', 'setFog', 'setLight', 'setTerrain', 'setSky'],
  interaction: ['screenshot', 'queryRenderedFeatures', 'querySourceFeatures'],
  '3d': ['addFillExtrusion', 'add3DModel', 'setTerrain', 'setSky'],
  geolocation: ['geocode'],
}

const TOOLSET_DESCRIPTIONS: Record<string, string> = {
  view: 'Camera/view controls (flyTo, easeTo, jumpTo, fitBounds, zoom, resetNorth)',
  layer: 'Layer management (add, remove, list, visibility, paint/layout properties, filters)',
  source: 'Data source management (add, remove, list, get/set data)',
  marker: 'Marker annotations (add, remove, update, list)',
  draw: 'GeoJSON data and image management',
  style: 'Map style configuration (setStyle, fog, light, terrain, sky)',
  interaction: 'User interaction (screenshot, feature queries)',
  '3d': '3D features (fill-extrusion, 3D models, terrain, sky)',
  geolocation: 'Geocoding — convert address/place name to coordinates',
}

const DEFAULT_TOOLSETS = ['view', 'layer', 'source', 'marker', 'interaction']

const _tsEnv = process.env.MAPBOX_TOOLSETS?.trim()
const _allMode = _tsEnv === 'all'
const _enabledSets = new Set<string>(
  _allMode
    ? Object.keys(TOOLSETS)
    : _tsEnv
      ? _tsEnv.split(',').map(s => s.trim()).filter(s => s in TOOLSETS)
      : DEFAULT_TOOLSETS,
)

const _enabledTools = new Set<string>()
for (const setName of _enabledSets) {
  for (const tool of TOOLSETS[setName]!) {
    _enabledTools.add(tool)
  }
}

const _toolDefs = new Map<string, unknown[]>()

const _registerTool = ((...args: unknown[]) => {
  const name = args[0] as string
  _toolDefs.set(name, args)
  if (_enabledTools.has(name)) {
    ;(server.tool as Function).apply(server, args)
  }
}) as typeof server.tool

function _enableToolset(setName: string): string[] {
  const tools = TOOLSETS[setName]
  if (!tools) return []
  const added: string[] = []
  for (const toolName of tools) {
    if (!_enabledTools.has(toolName)) {
      _enabledTools.add(toolName)
      const def = _toolDefs.get(toolName)
      if (def) {
        ;(server.tool as Function).apply(server, def)
        added.push(toolName)
      }
    }
  }
  _enabledSets.add(setName)
  return added
}

// ==================== Tools: View ====================

_registerTool(
  'flyTo',
  'Fly to a location with animation (lng, lat, zoom)',
  {
    longitude: z.number().describe('Longitude (-180 ~ 180)'),
    latitude: z.number().describe('Latitude (-90 ~ 90)'),
    zoom: z.number().optional().default(12).describe('Zoom level (0~22)'),
    bearing: z.number().optional().default(0).describe('Map bearing (degrees), 0 = north'),
    pitch: z.number().optional().default(0).describe('Map pitch (degrees), 0 = top-down, max 85'),
    duration: z.number().optional().default(2000).describe('Animation duration (ms)'),
    curve: z.number().optional().default(1.42).describe('Zoom curve factor'),
    essential: z.boolean().optional().default(true).describe('If true, animation is considered essential'),
  },
  { readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: false, title: 'Fly To' },
  async (params) => {
    const result = await sendToBrowser('flyTo', {
      center: [params.longitude, params.latitude],
      zoom: params.zoom,
      bearing: params.bearing,
      pitch: params.pitch,
      duration: params.duration,
      curve: params.curve,
      essential: params.essential,
    })
    return { content: [{ type: 'text' as const, text: JSON.stringify(result ?? { success: true }) }] }
  },
)

_registerTool(
  'easeTo',
  'Ease to a location with linear animation',
  {
    longitude: z.number().describe('Longitude (-180 ~ 180)'),
    latitude: z.number().describe('Latitude (-90 ~ 90)'),
    zoom: z.number().optional().describe('Zoom level (0~22)'),
    bearing: z.number().optional().describe('Map bearing (degrees)'),
    pitch: z.number().optional().describe('Map pitch (degrees)'),
    duration: z.number().optional().default(1000).describe('Animation duration (ms)'),
  },
  { readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: false, title: 'Ease To' },
  async (params) => {
    const result = await sendToBrowser('easeTo', {
      center: [params.longitude, params.latitude],
      zoom: params.zoom,
      bearing: params.bearing,
      pitch: params.pitch,
      duration: params.duration,
    })
    return { content: [{ type: 'text' as const, text: JSON.stringify(result ?? { success: true }) }] }
  },
)

_registerTool(
  'jumpTo',
  'Jump to a location instantly (no animation)',
  {
    longitude: z.number().describe('Longitude (-180 ~ 180)'),
    latitude: z.number().describe('Latitude (-90 ~ 90)'),
    zoom: z.number().optional().describe('Zoom level (0~22)'),
    bearing: z.number().optional().describe('Map bearing (degrees)'),
    pitch: z.number().optional().describe('Map pitch (degrees)'),
  },
  { readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: false, title: 'Jump To' },
  async (params) => {
    const result = await sendToBrowser('jumpTo', {
      center: [params.longitude, params.latitude],
      zoom: params.zoom,
      bearing: params.bearing,
      pitch: params.pitch,
    })
    return { content: [{ type: 'text' as const, text: JSON.stringify(result ?? { success: true }) }] }
  },
)

_registerTool(
  'getView',
  'Get current map view state (center, zoom, bearing, pitch, bounds)',
  {},
  { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false, title: 'Get View' },
  async () => {
    const result = await sendToBrowser('getView', {})
    return { content: [{ type: 'text' as const, text: JSON.stringify(result) }] }
  },
)

_registerTool(
  'fitBounds',
  'Fit the map to a bounding box with optional padding',
  {
    west: z.number().describe('West longitude (degrees)'),
    south: z.number().describe('South latitude (degrees)'),
    east: z.number().describe('East longitude (degrees)'),
    north: z.number().describe('North latitude (degrees)'),
    padding: z.number().optional().default(50).describe('Padding in pixels'),
    duration: z.number().optional().default(1000).describe('Animation duration (ms)'),
    maxZoom: z.number().optional().describe('Max zoom level'),
  },
  { readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: false, title: 'Fit Bounds' },
  async (params) => {
    const result = await sendToBrowser('fitBounds', {
      bounds: [[params.west, params.south], [params.east, params.north]],
      padding: params.padding,
      duration: params.duration,
      maxZoom: params.maxZoom,
    })
    return { content: [{ type: 'text' as const, text: JSON.stringify(result ?? { success: true }) }] }
  },
)

_registerTool(
  'resetNorth',
  'Reset the map bearing to north (0 degrees)',
  {
    duration: z.number().optional().default(1000).describe('Animation duration (ms)'),
  },
  { readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: false, title: 'Reset North' },
  async (params) => {
    const result = await sendToBrowser('resetNorth', params)
    return { content: [{ type: 'text' as const, text: JSON.stringify(result ?? { success: true }) }] }
  },
)

_registerTool(
  'zoomIn',
  'Zoom in by one level',
  {
    duration: z.number().optional().default(300).describe('Animation duration (ms)'),
  },
  { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: false, title: 'Zoom In' },
  async (params) => {
    const result = await sendToBrowser('zoomIn', params)
    return { content: [{ type: 'text' as const, text: JSON.stringify(result ?? { success: true }) }] }
  },
)

_registerTool(
  'zoomOut',
  'Zoom out by one level',
  {
    duration: z.number().optional().default(300).describe('Animation duration (ms)'),
  },
  { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: false, title: 'Zoom Out' },
  async (params) => {
    const result = await sendToBrowser('zoomOut', params)
    return { content: [{ type: 'text' as const, text: JSON.stringify(result ?? { success: true }) }] }
  },
)

// ==================== Tools: Layer ====================

_registerTool(
  'addLayer',
  'Add a Mapbox style layer to the map. Requires a source to be added first (or use inline source).',
  {
    id: z.string().describe('Unique layer ID'),
    type: z.enum(['fill', 'line', 'symbol', 'circle', 'heatmap', 'fill-extrusion', 'raster', 'hillshade', 'background', 'sky']).describe('Layer type'),
    source: z.union([z.string(), z.record(z.unknown())]).describe('Source ID (string) or inline source object'),
    sourceLayer: z.string().optional().describe('Source layer name (for vector tile sources)'),
    paint: z.record(z.unknown()).optional().describe('Paint properties object'),
    layout: z.record(z.unknown()).optional().describe('Layout properties object'),
    filter: z.array(z.unknown()).optional().describe('Mapbox expression filter'),
    minzoom: z.number().optional().describe('Min zoom level (0~24)'),
    maxzoom: z.number().optional().describe('Max zoom level (0~24)'),
    beforeId: z.string().optional().describe('Insert before this layer ID'),
  },
  { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: false, title: 'Add Layer' },
  async (params) => {
    const result = await sendToBrowser('addLayer', params)
    return { content: [{ type: 'text' as const, text: JSON.stringify(result ?? { success: true }) }] }
  },
)

_registerTool(
  'removeLayer',
  'Remove a layer from the map by its ID',
  {
    id: z.string().describe('Layer ID to remove'),
  },
  { readOnlyHint: false, destructiveHint: true, idempotentHint: true, openWorldHint: false, title: 'Remove Layer' },
  async (params) => {
    const result = await sendToBrowser('removeLayer', params)
    return { content: [{ type: 'text' as const, text: JSON.stringify(result ?? { success: true }) }] }
  },
)

_registerTool(
  'listLayers',
  'List all layers in the current map style',
  {},
  { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false, title: 'List Layers' },
  async () => {
    const result = await sendToBrowser('listLayers', {})
    return { content: [{ type: 'text' as const, text: JSON.stringify(result) }] }
  },
)

_registerTool(
  'setLayerVisibility',
  'Show or hide a layer',
  {
    id: z.string().describe('Layer ID'),
    visible: z.boolean().describe('Whether the layer should be visible'),
  },
  { readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: false, title: 'Set Layer Visibility' },
  async (params) => {
    const result = await sendToBrowser('setLayerVisibility', params)
    return { content: [{ type: 'text' as const, text: JSON.stringify(result ?? { success: true }) }] }
  },
)

_registerTool(
  'setPaintProperty',
  'Set a paint property on a layer (e.g. fill-color, line-width)',
  {
    layerId: z.string().describe('Layer ID'),
    name: z.string().describe('Paint property name (e.g. "fill-color", "line-width", "circle-radius")'),
    value: z.unknown().describe('Paint property value (color string, number, or Mapbox expression)'),
  },
  { readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: false, title: 'Set Paint Property' },
  async (params) => {
    const result = await sendToBrowser('setPaintProperty', params)
    return { content: [{ type: 'text' as const, text: JSON.stringify(result ?? { success: true }) }] }
  },
)

_registerTool(
  'setLayoutProperty',
  'Set a layout property on a layer (e.g. visibility, text-field, icon-image)',
  {
    layerId: z.string().describe('Layer ID'),
    name: z.string().describe('Layout property name (e.g. "visibility", "text-field", "icon-image")'),
    value: z.unknown().describe('Layout property value'),
  },
  { readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: false, title: 'Set Layout Property' },
  async (params) => {
    const result = await sendToBrowser('setLayoutProperty', params)
    return { content: [{ type: 'text' as const, text: JSON.stringify(result ?? { success: true }) }] }
  },
)

_registerTool(
  'setFilter',
  'Set a Mapbox expression filter on a layer',
  {
    layerId: z.string().describe('Layer ID'),
    filter: z.array(z.unknown()).describe('Mapbox expression filter array'),
  },
  { readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: false, title: 'Set Filter' },
  async (params) => {
    const result = await sendToBrowser('setFilter', params)
    return { content: [{ type: 'text' as const, text: JSON.stringify(result ?? { success: true }) }] }
  },
)

_registerTool(
  'moveLayer',
  'Move a layer to a different position in the layer stack',
  {
    id: z.string().describe('Layer ID to move'),
    beforeId: z.string().optional().describe('Move before this layer ID (omit to move to top)'),
  },
  { readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: false, title: 'Move Layer' },
  async (params) => {
    const result = await sendToBrowser('moveLayer', params)
    return { content: [{ type: 'text' as const, text: JSON.stringify(result ?? { success: true }) }] }
  },
)

// ==================== Tools: Source ====================

_registerTool(
  'addSource',
  'Add a data source to the map (geojson, vector, raster, raster-dem, image, video)',
  {
    id: z.string().describe('Unique source ID'),
    type: z.enum(['geojson', 'vector', 'raster', 'raster-dem', 'image', 'video']).describe('Source type'),
    data: z.union([z.string(), z.record(z.unknown())]).optional().describe('GeoJSON data (object or URL) — for geojson type'),
    url: z.string().optional().describe('TileJSON URL — for vector/raster sources'),
    tiles: z.array(z.string()).optional().describe('Tile URL templates — for vector/raster sources'),
    tileSize: z.number().optional().default(512).describe('Tile size in pixels'),
    maxzoom: z.number().optional().describe('Max zoom level'),
    minzoom: z.number().optional().describe('Min zoom level'),
    attribution: z.string().optional().describe('Attribution text'),
    cluster: z.boolean().optional().describe('Enable clustering — for geojson type'),
    clusterRadius: z.number().optional().default(50).describe('Cluster radius in pixels'),
    clusterMaxZoom: z.number().optional().describe('Max zoom to cluster points'),
  },
  { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: false, title: 'Add Source' },
  async (params) => {
    const result = await sendToBrowser('addSource', params)
    return { content: [{ type: 'text' as const, text: JSON.stringify(result ?? { success: true }) }] }
  },
)

_registerTool(
  'removeSource',
  'Remove a data source from the map (all layers using it must be removed first)',
  {
    id: z.string().describe('Source ID to remove'),
  },
  { readOnlyHint: false, destructiveHint: true, idempotentHint: true, openWorldHint: false, title: 'Remove Source' },
  async (params) => {
    const result = await sendToBrowser('removeSource', params)
    return { content: [{ type: 'text' as const, text: JSON.stringify(result ?? { success: true }) }] }
  },
)

_registerTool(
  'listSources',
  'List all data sources in the current map style',
  {},
  { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false, title: 'List Sources' },
  async () => {
    const result = await sendToBrowser('listSources', {})
    return { content: [{ type: 'text' as const, text: JSON.stringify(result) }] }
  },
)

_registerTool(
  'getSourceData',
  'Get the GeoJSON data of a geojson source',
  {
    id: z.string().describe('Source ID'),
  },
  { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false, title: 'Get Source Data' },
  async (params) => {
    const result = await sendToBrowser('getSourceData', params)
    return { content: [{ type: 'text' as const, text: JSON.stringify(result) }] }
  },
)

_registerTool(
  'setSourceData',
  'Update the GeoJSON data of an existing geojson source',
  {
    id: z.string().describe('Source ID'),
    data: z.union([z.string(), z.record(z.unknown())]).describe('New GeoJSON data (object or URL)'),
  },
  { readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: false, title: 'Set Source Data' },
  async (params) => {
    const result = await sendToBrowser('setSourceData', params)
    return { content: [{ type: 'text' as const, text: JSON.stringify(result ?? { success: true }) }] }
  },
)

// ==================== Tools: Marker ====================

_registerTool(
  'addMarker',
  'Add a marker at a specific location on the map',
  {
    id: z.string().optional().describe('Marker ID (auto-generated if omitted)'),
    longitude: z.number().describe('Longitude (-180 ~ 180)'),
    latitude: z.number().describe('Latitude (-90 ~ 90)'),
    color: z.string().optional().default('#3B82F6').describe('Marker color (CSS format)'),
    popup: z.string().optional().describe('Popup HTML content'),
    draggable: z.boolean().optional().default(false).describe('Whether the marker is draggable'),
  },
  { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: false, title: 'Add Marker' },
  async (params) => {
    const result = await sendToBrowser('addMarker', params)
    return { content: [{ type: 'text' as const, text: JSON.stringify(result ?? { success: true }) }] }
  },
)

_registerTool(
  'removeMarker',
  'Remove a marker from the map',
  {
    id: z.string().describe('Marker ID to remove'),
  },
  { readOnlyHint: false, destructiveHint: true, idempotentHint: true, openWorldHint: false, title: 'Remove Marker' },
  async (params) => {
    const result = await sendToBrowser('removeMarker', params)
    return { content: [{ type: 'text' as const, text: JSON.stringify(result ?? { success: true }) }] }
  },
)

_registerTool(
  'updateMarker',
  'Update a marker position, color, or popup',
  {
    id: z.string().describe('Marker ID'),
    longitude: z.number().optional().describe('New longitude'),
    latitude: z.number().optional().describe('New latitude'),
    color: z.string().optional().describe('New color (CSS format)'),
    popup: z.string().optional().describe('New popup HTML content'),
  },
  { readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: false, title: 'Update Marker' },
  async (params) => {
    const result = await sendToBrowser('updateMarker', params)
    return { content: [{ type: 'text' as const, text: JSON.stringify(result ?? { success: true }) }] }
  },
)

_registerTool(
  'listMarkers',
  'List all markers on the map',
  {},
  { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false, title: 'List Markers' },
  async () => {
    const result = await sendToBrowser('listMarkers', {})
    return { content: [{ type: 'text' as const, text: JSON.stringify(result) }] }
  },
)

// ==================== Tools: Draw ====================

_registerTool(
  'addGeoJSON',
  'Add GeoJSON data to the map as a source + layer combo (convenience tool)',
  {
    id: z.string().optional().describe('Layer/source ID (auto-generated if omitted)'),
    data: z.union([z.string(), z.record(z.unknown())]).describe('GeoJSON data (object or URL)'),
    style: z.record(z.unknown()).optional().describe('Style overrides (paint properties)'),
    cluster: z.boolean().optional().default(false).describe('Enable point clustering'),
  },
  { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: false, title: 'Add GeoJSON' },
  async (params) => {
    const result = await sendToBrowser('addGeoJSON', params)
    return { content: [{ type: 'text' as const, text: JSON.stringify(result ?? { success: true }) }] }
  },
)

_registerTool(
  'addImage',
  'Add an image to the map style (for use with symbol layers)',
  {
    id: z.string().describe('Image ID (used in icon-image)'),
    url: z.string().describe('Image URL'),
    pixelRatio: z.number().optional().default(1).describe('Pixel ratio'),
    sdf: z.boolean().optional().default(false).describe('Whether the image is an SDF icon'),
  },
  { readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: false, title: 'Add Image' },
  async (params) => {
    const result = await sendToBrowser('addImage', params)
    return { content: [{ type: 'text' as const, text: JSON.stringify(result ?? { success: true }) }] }
  },
)

_registerTool(
  'removeImage',
  'Remove an image from the map style',
  {
    id: z.string().describe('Image ID to remove'),
  },
  { readOnlyHint: false, destructiveHint: true, idempotentHint: true, openWorldHint: false, title: 'Remove Image' },
  async (params) => {
    const result = await sendToBrowser('removeImage', params)
    return { content: [{ type: 'text' as const, text: JSON.stringify(result ?? { success: true }) }] }
  },
)

// ==================== Tools: Style ====================

_registerTool(
  'setStyle',
  'Set the entire map style (Mapbox style URL or style object)',
  {
    style: z.union([z.string(), z.record(z.unknown())]).describe('Mapbox style URL (e.g. "mapbox://styles/mapbox/dark-v11") or style JSON object'),
  },
  { readOnlyHint: false, destructiveHint: true, idempotentHint: true, openWorldHint: false, title: 'Set Style' },
  async (params) => {
    const result = await sendToBrowser('setStyle', params)
    return { content: [{ type: 'text' as const, text: JSON.stringify(result ?? { success: true }) }] }
  },
)

_registerTool(
  'getStyle',
  'Get the current map style as a JSON object',
  {},
  { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false, title: 'Get Style' },
  async () => {
    const result = await sendToBrowser('getStyle', {})
    return { content: [{ type: 'text' as const, text: JSON.stringify(result) }] }
  },
)

_registerTool(
  'setFog',
  'Set fog/atmosphere effect on the map',
  {
    color: z.string().optional().describe('Fog color (CSS)'),
    horizonBlend: z.number().optional().describe('Horizon blend (0~1)'),
    range: z.array(z.number()).optional().describe('Fog range [min, max] in projection units'),
    highColor: z.string().optional().describe('Color at top of fog'),
    spaceColor: z.string().optional().describe('Color of space above fog'),
    starIntensity: z.number().optional().describe('Star intensity (0~1)'),
  },
  { readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: false, title: 'Set Fog' },
  async (params) => {
    const result = await sendToBrowser('setFog', params)
    return { content: [{ type: 'text' as const, text: JSON.stringify(result ?? { success: true }) }] }
  },
)

_registerTool(
  'setLight',
  'Set the global light source for the map (affects 3D extrusions)',
  {
    anchor: z.enum(['map', 'viewport']).optional().describe('Light anchor'),
    color: z.string().optional().describe('Light color'),
    intensity: z.number().optional().describe('Light intensity (0~1)'),
    position: z.array(z.number()).optional().describe('Light position [radial, azimuthal, polar]'),
  },
  { readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: false, title: 'Set Light' },
  async (params) => {
    const result = await sendToBrowser('setLight', params)
    return { content: [{ type: 'text' as const, text: JSON.stringify(result ?? { success: true }) }] }
  },
)

_registerTool(
  'setTerrain',
  'Enable or disable 3D terrain',
  {
    source: z.string().optional().describe('Terrain raster-dem source ID (omit to disable terrain)'),
    exaggeration: z.number().optional().default(1).describe('Terrain exaggeration factor'),
  },
  { readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: false, title: 'Set Terrain' },
  async (params) => {
    const result = await sendToBrowser('setTerrain', params)
    return { content: [{ type: 'text' as const, text: JSON.stringify(result ?? { success: true }) }] }
  },
)

_registerTool(
  'setSky',
  'Configure the sky layer (gradient or atmosphere)',
  {
    skyType: z.enum(['gradient', 'atmosphere']).optional().default('atmosphere').describe('Sky type'),
    skyAtmosphereSun: z.array(z.number()).optional().describe('Sun position [azimuth, altitude]'),
    skyAtmosphereSunIntensity: z.number().optional().describe('Sun intensity'),
    skyGradient: z.array(z.unknown()).optional().describe('Sky gradient expression'),
  },
  { readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: false, title: 'Set Sky' },
  async (params) => {
    const result = await sendToBrowser('setSky', params)
    return { content: [{ type: 'text' as const, text: JSON.stringify(result ?? { success: true }) }] }
  },
)

// ==================== Tools: Interaction ====================

_registerTool(
  'screenshot',
  'Capture the current map view (returns base64 PNG)',
  {},
  { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false, title: 'Screenshot' },
  async () => {
    const result = await sendToBrowser('screenshot', {})
    const data = result as { dataUrl?: string } | null
    if (data?.dataUrl) {
      return { content: [{ type: 'image' as const, data: data.dataUrl.replace(/^data:image\/\w+;base64,/, ''), mimeType: 'image/png' }] }
    }
    return { content: [{ type: 'text' as const, text: JSON.stringify(result ?? { success: true }) }] }
  },
)

_registerTool(
  'queryRenderedFeatures',
  'Query features rendered at a point or within a bounding box on the map',
  {
    point: z.array(z.number()).optional().describe('Query point [x, y] in pixels'),
    bbox: z.array(z.array(z.number())).optional().describe('Query bounding box [[x1,y1],[x2,y2]] in pixels'),
    layers: z.array(z.string()).optional().describe('Restrict query to these layer IDs'),
    filter: z.array(z.unknown()).optional().describe('Mapbox expression filter'),
  },
  { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false, title: 'Query Rendered Features' },
  async (params) => {
    const result = await sendToBrowser('queryRenderedFeatures', params)
    return { content: [{ type: 'text' as const, text: JSON.stringify(result) }] }
  },
)

_registerTool(
  'querySourceFeatures',
  'Query features from a source (vector or GeoJSON), optionally filtering',
  {
    sourceId: z.string().describe('Source ID'),
    sourceLayer: z.string().optional().describe('Source layer name (for vector sources)'),
    filter: z.array(z.unknown()).optional().describe('Mapbox expression filter'),
  },
  { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false, title: 'Query Source Features' },
  async (params) => {
    const result = await sendToBrowser('querySourceFeatures', params)
    return { content: [{ type: 'text' as const, text: JSON.stringify(result) }] }
  },
)

// ==================== Tools: 3D ====================

_registerTool(
  'addFillExtrusion',
  'Add a 3D fill-extrusion layer (buildings, terrain extrusions)',
  {
    id: z.string().describe('Layer ID'),
    source: z.union([z.string(), z.record(z.unknown())]).describe('Source ID or inline source'),
    sourceLayer: z.string().optional().describe('Source layer (for vector tiles)'),
    height: z.union([z.number(), z.array(z.unknown())]).optional().describe('Extrusion height (number or expression)'),
    base: z.union([z.number(), z.array(z.unknown())]).optional().describe('Extrusion base height'),
    color: z.union([z.string(), z.array(z.unknown())]).optional().default('#3B82F6').describe('Fill color (CSS or expression)'),
    opacity: z.number().optional().default(0.8).describe('Opacity (0~1)'),
  },
  { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: false, title: 'Add Fill Extrusion' },
  async (params) => {
    const result = await sendToBrowser('addFillExtrusion', params)
    return { content: [{ type: 'text' as const, text: JSON.stringify(result ?? { success: true }) }] }
  },
)

_registerTool(
  'add3DModel',
  'Add a 3D model to the map using custom layers (experimental)',
  {
    id: z.string().describe('Layer ID'),
    url: z.string().describe('glTF/GLB model URL'),
    longitude: z.number().describe('Model longitude'),
    latitude: z.number().describe('Model latitude'),
    altitude: z.number().optional().default(0).describe('Model altitude (meters)'),
    rotateX: z.number().optional().default(0).describe('X rotation (degrees)'),
    rotateY: z.number().optional().default(0).describe('Y rotation (degrees)'),
    rotateZ: z.number().optional().default(0).describe('Z rotation (degrees)'),
    scale: z.number().optional().default(1).describe('Model scale'),
  },
  { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: false, title: 'Add 3D Model' },
  async (params) => {
    const result = await sendToBrowser('add3DModel', params)
    return { content: [{ type: 'text' as const, text: JSON.stringify(result ?? { success: true }) }] }
  },
)

// ==================== Tools: Geolocation ====================

let _lastGeocodeTime = 0

_registerTool(
  'geocode',
  'Convert address/place name to coordinates using OpenStreetMap Nominatim (free, no API key needed)',
  {
    address: z.string().min(1).describe('Address, landmark or place name'),
    countryCode: z.string().length(2).optional().describe('Two-letter ISO country code to limit search (e.g. "CN", "US")'),
  },
  { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: true, title: 'Geocode Address' },
  async ({ address, countryCode }) => {
    const now = Date.now()
    const wait = 1100 - (now - _lastGeocodeTime)
    if (wait > 0) await new Promise(r => setTimeout(r, wait))
    _lastGeocodeTime = Date.now()

    const params = new URLSearchParams({ q: address, format: 'json', addressdetails: '1', limit: '1' })
    if (countryCode) params.set('countrycodes', countryCode)

    const ua = process.env.OSM_USER_AGENT || 'mapbox-mcp-runtime/1.0'
    const resp = await fetch(`https://nominatim.openstreetmap.org/search?${params}`, {
      headers: { 'User-Agent': ua },
    })

    if (!resp.ok) {
      return { content: [{ type: 'text' as const, text: JSON.stringify({ success: false, message: `Nominatim API error: ${resp.status}` }) }], isError: true }
    }

    const data = await resp.json() as Array<{
      lat: string; lon: string; display_name: string;
      boundingbox?: [string, string, string, string];
    }>

    if (!data.length) {
      return { content: [{ type: 'text' as const, text: JSON.stringify({ success: false, message: `No results found for: ${address}` }) }] }
    }

    const item = data[0]!
    const result = {
      success: true,
      longitude: parseFloat(item.lon),
      latitude: parseFloat(item.lat),
      displayName: item.display_name,
      boundingBox: item.boundingbox ? {
        south: parseFloat(item.boundingbox[0]),
        north: parseFloat(item.boundingbox[1]),
        west: parseFloat(item.boundingbox[2]),
        east: parseFloat(item.boundingbox[3]),
      } : undefined,
    }
    return { content: [{ type: 'text' as const, text: JSON.stringify(result) }] }
  },
)

// ==================== Meta-tools (Dynamic Discovery) ====================

if (!_allMode) {
  server.tool(
    'list_toolsets',
    'List all available tool groups and their enabled status',
    {},
    { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false, title: 'List Toolsets' },
    async () => {
      const groups = Object.entries(TOOLSETS).map(([name, tools]) => ({
        name,
        description: TOOLSET_DESCRIPTIONS[name] ?? '',
        tools: tools.length,
        enabled: _enabledSets.has(name),
        toolNames: tools,
      }))
      return { content: [{ type: 'text' as const, text: JSON.stringify(groups, null, 2) }] }
    },
  )

  server.tool(
    'enable_toolset',
    'Enable a tool group to make its tools available. Call list_toolsets first to see available groups.',
    {
      toolset: z.string().describe('Name of the toolset to enable (e.g. "style", "3d", "draw")'),
    },
    { readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: false, title: 'Enable Toolset' },
    async ({ toolset }) => {
      if (!(toolset in TOOLSETS)) {
        return {
          content: [{ type: 'text' as const, text: `Unknown toolset "${toolset}". Available: ${Object.keys(TOOLSETS).join(', ')}` }],
          isError: true,
        }
      }
      if (_enabledSets.has(toolset)) {
        return { content: [{ type: 'text' as const, text: `Toolset "${toolset}" is already enabled.` }] }
      }
      const added = _enableToolset(toolset)
      server.sendToolListChanged?.()
      return {
        content: [{
          type: 'text' as const,
          text: `Enabled toolset "${toolset}" — ${added.length} new tools available: ${added.join(', ')}`,
        }],
      }
    },
  )
}

// ==================== Prompts ====================

server.prompt(
  'mapbox-quickstart',
  'Quick reference for using Mapbox MCP tools',
  async () => ({
    messages: [{
      role: 'user' as const,
      content: {
        type: 'text' as const,
        text: `Mapbox MCP Quick Start Guide:

1. **View**: flyTo(lng, lat) to navigate, easeTo for smooth transitions, fitBounds for bounding box
2. **Layers**: addLayer with source/paint/layout, setPaintProperty to change appearance
3. **Sources**: addSource for data (GeoJSON, vector tiles, raster), setSourceData to update
4. **Markers**: addMarker for simple annotations with popups
5. **Style**: setStyle to change base map, setFog/setLight/setTerrain for 3D effects
6. **Interaction**: screenshot to capture view, queryRenderedFeatures for click queries
7. **Discovery**: list_toolsets to see available tool groups, enable_toolset to activate more

All operations return IDs for subsequent updates or removal.`,
      },
    }],
  }),
)

// ==================== Export ====================

export function createSandboxServer() {
  for (const setName of Object.keys(TOOLSETS)) {
    if (!_enabledSets.has(setName)) _enableToolset(setName)
  }
  return server
}

// ==================== Start ====================

export async function main() {
  await startServer()

  const transport = new StdioServerTransport()
  await server.connect(transport)
  const metaCount = _allMode ? 0 : 2
  console.error(`[mapbox-mcp-runtime] MCP Server running (stdio), ${_enabledTools.size + metaCount} tools registered (toolsets: ${[..._enabledSets].join(', ')})`)
  if (_relayPort > 0) {
    console.error(`[mapbox-mcp-runtime] Relay mode active -> commands forwarded to port ${_relayPort}`)
  }
}
