import type mapboxgl from 'mapbox-gl'
import type {
  BridgeCommand,
  BridgeResult,
  FlyToParams,
  EaseToParams,
  JumpToParams,
  FitBoundsParams,
  ViewState,
  AddLayerParams,
  AddSourceParams,
  AddMarkerParams,
  UpdateMarkerParams,
  SetPaintPropertyParams,
  SetLayoutPropertyParams,
  SetFilterParams,
  AddGeoJSONParams,
  QueryRenderedFeaturesParams,
  QuerySourceFeaturesParams,
  SetFogParams,
  SetLightParams,
  SetTerrainParams,
  SetSkyParams,
  AddFillExtrusionParams,
} from './types'

/**
 * MapboxBridge — AI Agent 操控 Mapbox GL JS 的统一执行层
 *
 * 所有 Mapbox 操作通过此类暴露，支持两种调用方式：
 * 1. 类型安全的方法调用：bridge.flyTo({...})
 * 2. 命令分发（兼容 MCP/WebSocket）：bridge.execute({ action: 'flyTo', params: {...} })
 */
export class MapboxBridge {
  private _map: mapboxgl.Map
  private _ws: WebSocket | null = null
  private _markers = new Map<string, mapboxgl.Marker>()
  private _markerIdCounter = 0

  constructor(map: mapboxgl.Map) {
    this._map = map
  }

  get map(): mapboxgl.Map {
    return this._map
  }

  // ==================== WebSocket ====================

  connect(url: string, sessionId = 'default') {
    const wsUrl = `${url}?session=${sessionId}`
    this._ws = new WebSocket(wsUrl)

    this._ws.onopen = () => {
      console.log('[mapbox-mcp-bridge] WebSocket connected')
    }

    this._ws.onmessage = async (event) => {
      try {
        const msg = JSON.parse(event.data as string)
        if (msg.jsonrpc === '2.0' && msg.method) {
          const result = await this.execute({ action: msg.method, params: msg.params ?? {} })
          this._ws?.send(JSON.stringify({
            jsonrpc: '2.0',
            id: msg.id,
            result,
          }))
        }
      } catch (err) {
        console.error('[mapbox-mcp-bridge] Error handling message:', err)
      }
    }

    this._ws.onclose = () => {
      console.log('[mapbox-mcp-bridge] WebSocket disconnected')
    }
  }

  disconnect() {
    this._ws?.close()
    this._ws = null
  }

  // ==================== Command dispatch ====================

  async execute(command: BridgeCommand): Promise<BridgeResult> {
    const handler = this._handlers[command.action]
    if (!handler) {
      return { success: false, error: `Unknown action: ${command.action}` }
    }
    try {
      const data = await handler(command.params)
      return { success: true, data }
    } catch (err) {
      return { success: false, error: err instanceof Error ? err.message : String(err) }
    }
  }

  private _handlers: Record<string, (params: Record<string, unknown>) => Promise<unknown> | unknown> = {
    // View
    flyTo: (p) => this.flyTo(p as unknown as FlyToParams),
    easeTo: (p) => this.easeTo(p as unknown as EaseToParams),
    jumpTo: (p) => this.jumpTo(p as unknown as JumpToParams),
    getView: () => this.getView(),
    fitBounds: (p) => this.fitBounds(p as unknown as FitBoundsParams),
    resetNorth: (p) => this.resetNorth(p as { duration?: number }),
    zoomIn: (p) => this.zoomIn(p as { duration?: number }),
    zoomOut: (p) => this.zoomOut(p as { duration?: number }),

    // Layer
    addLayer: (p) => this.addLayer(p as unknown as AddLayerParams),
    removeLayer: (p) => this.removeLayer(p as { id: string }),
    listLayers: () => this.listLayers(),
    setLayerVisibility: (p) => this.setLayerVisibility(p as { id: string; visible: boolean }),
    setPaintProperty: (p) => this.setPaintProperty(p as unknown as SetPaintPropertyParams),
    setLayoutProperty: (p) => this.setLayoutProperty(p as unknown as SetLayoutPropertyParams),
    setFilter: (p) => this.setFilter(p as unknown as SetFilterParams),
    moveLayer: (p) => this.moveLayer(p as { id: string; beforeId?: string }),

    // Source
    addSource: (p) => this.addSource(p as unknown as AddSourceParams),
    removeSource: (p) => this.removeSource(p as { id: string }),
    listSources: () => this.listSources(),
    getSourceData: (p) => this.getSourceData(p as { id: string }),
    setSourceData: (p) => this.setSourceData(p as { id: string; data: string | Record<string, unknown> }),

    // Marker
    addMarker: (p) => this.addMarker(p as unknown as AddMarkerParams),
    removeMarker: (p) => this.removeMarker(p as { id: string }),
    updateMarker: (p) => this.updateMarker(p as unknown as UpdateMarkerParams),
    listMarkers: () => this.listMarkers(),

    // Draw
    addGeoJSON: (p) => this.addGeoJSON(p as unknown as AddGeoJSONParams),
    addImage: (p) => this.addImage(p as { id: string; url: string; pixelRatio?: number; sdf?: boolean }),
    removeImage: (p) => this.removeImage(p as { id: string }),

    // Style
    setStyle: (p) => this.setStyle(p as { style: string | Record<string, unknown> }),
    getStyle: () => this.getStyle(),
    setFog: (p) => this.setFog(p as unknown as SetFogParams),
    setLight: (p) => this.setLight(p as unknown as SetLightParams),
    setTerrain: (p) => this.setTerrain(p as unknown as SetTerrainParams),
    setSky: (p) => this.setSky(p as unknown as SetSkyParams),

    // Interaction
    screenshot: () => this.screenshot(),
    queryRenderedFeatures: (p) => this.queryRenderedFeatures(p as unknown as QueryRenderedFeaturesParams),
    querySourceFeatures: (p) => this.querySourceFeatures(p as unknown as QuerySourceFeaturesParams),

    // 3D
    addFillExtrusion: (p) => this.addFillExtrusion(p as unknown as AddFillExtrusionParams),
  }

  // ==================== View ====================

  flyTo(params: FlyToParams) {
    this._map.flyTo({
      center: params.center,
      zoom: params.zoom,
      bearing: params.bearing,
      pitch: params.pitch,
      duration: params.duration,
      curve: params.curve,
      essential: params.essential,
    })
    return { success: true }
  }

  easeTo(params: EaseToParams) {
    this._map.easeTo({
      center: params.center,
      zoom: params.zoom,
      bearing: params.bearing,
      pitch: params.pitch,
      duration: params.duration,
    })
    return { success: true }
  }

  jumpTo(params: JumpToParams) {
    this._map.jumpTo({
      center: params.center,
      zoom: params.zoom,
      bearing: params.bearing,
      pitch: params.pitch,
    })
    return { success: true }
  }

  getView(): ViewState {
    const center = this._map.getCenter()
    const bounds = this._map.getBounds()
    return {
      center: [center.lng, center.lat],
      zoom: this._map.getZoom(),
      bearing: this._map.getBearing(),
      pitch: this._map.getPitch(),
      bounds: bounds
        ? [[bounds.getWest(), bounds.getSouth()], [bounds.getEast(), bounds.getNorth()]]
        : undefined,
    }
  }

  fitBounds(params: FitBoundsParams) {
    this._map.fitBounds(params.bounds, {
      padding: params.padding,
      duration: params.duration,
      maxZoom: params.maxZoom,
    })
    return { success: true }
  }

  resetNorth(params: { duration?: number }) {
    this._map.resetNorth({ duration: params.duration })
    return { success: true }
  }

  zoomIn(params: { duration?: number }) {
    this._map.zoomIn({ duration: params.duration })
    return { success: true }
  }

  zoomOut(params: { duration?: number }) {
    this._map.zoomOut({ duration: params.duration })
    return { success: true }
  }

  // ==================== Layer ====================

  addLayer(params: AddLayerParams) {
    const layerSpec: Record<string, unknown> = {
      id: params.id,
      type: params.type,
      source: params.source,
    }
    if (params.sourceLayer) layerSpec['source-layer'] = params.sourceLayer
    if (params.paint) layerSpec.paint = params.paint
    if (params.layout) layerSpec.layout = params.layout
    if (params.filter) layerSpec.filter = params.filter
    if (params.minzoom !== undefined) layerSpec.minzoom = params.minzoom
    if (params.maxzoom !== undefined) layerSpec.maxzoom = params.maxzoom

    this._map.addLayer(layerSpec as mapboxgl.LayerSpecification, params.beforeId)
    return { success: true, layerId: params.id }
  }

  removeLayer(params: { id: string }) {
    if (this._map.getLayer(params.id)) {
      this._map.removeLayer(params.id)
    }
    return { success: true }
  }

  listLayers() {
    const style = this._map.getStyle()
    return (style?.layers ?? []).map((l: { id: string; type: string; source?: string; visibility?: string }) => ({
      id: l.id,
      type: l.type,
      source: l.source,
      visible: l.visibility !== 'none',
    }))
  }

  setLayerVisibility(params: { id: string; visible: boolean }) {
    this._map.setLayoutProperty(params.id, 'visibility', params.visible ? 'visible' : 'none')
    return { success: true }
  }

  setPaintProperty(params: SetPaintPropertyParams) {
    this._map.setPaintProperty(params.layerId, params.name as any, params.value)
    return { success: true }
  }

  setLayoutProperty(params: SetLayoutPropertyParams) {
    this._map.setLayoutProperty(params.layerId, params.name as any, params.value)
    return { success: true }
  }

  setFilter(params: SetFilterParams) {
    this._map.setFilter(params.layerId, params.filter as mapboxgl.FilterSpecification)
    return { success: true }
  }

  moveLayer(params: { id: string; beforeId?: string }) {
    this._map.moveLayer(params.id, params.beforeId)
    return { success: true }
  }

  // ==================== Source ====================

  addSource(params: AddSourceParams) {
    const sourceSpec: Record<string, unknown> = { type: params.type }
    if (params.data !== undefined) sourceSpec.data = params.data
    if (params.url) sourceSpec.url = params.url
    if (params.tiles) sourceSpec.tiles = params.tiles
    if (params.tileSize !== undefined) sourceSpec.tileSize = params.tileSize
    if (params.maxzoom !== undefined) sourceSpec.maxzoom = params.maxzoom
    if (params.minzoom !== undefined) sourceSpec.minzoom = params.minzoom
    if (params.attribution) sourceSpec.attribution = params.attribution
    if (params.cluster !== undefined) sourceSpec.cluster = params.cluster
    if (params.clusterRadius !== undefined) sourceSpec.clusterRadius = params.clusterRadius
    if (params.clusterMaxZoom !== undefined) sourceSpec.clusterMaxZoom = params.clusterMaxZoom

    this._map.addSource(params.id, sourceSpec as mapboxgl.SourceSpecification)
    return { success: true, sourceId: params.id }
  }

  removeSource(params: { id: string }) {
    if (this._map.getSource(params.id)) {
      this._map.removeSource(params.id)
    }
    return { success: true }
  }

  listSources() {
    const style = this._map.getStyle()
    if (!style?.sources) return []
    return Object.entries(style.sources).map(([id, spec]) => ({
      id,
      type: (spec as { type: string }).type,
    }))
  }

  getSourceData(params: { id: string }) {
    const source = this._map.getSource(params.id) as mapboxgl.GeoJSONSource | undefined
    if (!source) return { error: `Source not found: ${params.id}` }
    // GeoJSON source stores _data internally
    return { sourceId: params.id, type: 'geojson' }
  }

  setSourceData(params: { id: string; data: string | Record<string, unknown> }) {
    const source = this._map.getSource(params.id) as mapboxgl.GeoJSONSource | undefined
    if (!source) return { error: `Source not found: ${params.id}` }
    source.setData(params.data as unknown as GeoJSON.GeoJSON)
    return { success: true }
  }

  // ==================== Marker ====================

  addMarker(params: AddMarkerParams) {
    const id = params.id ?? `marker_${++this._markerIdCounter}`
    // Dynamic import not possible here; we assume mapboxgl is available as a global or from the same module
    const mapboxgl = (globalThis as Record<string, unknown>).mapboxgl as typeof import('mapbox-gl')
    const marker = new mapboxgl.Marker({ color: params.color, draggable: params.draggable })
      .setLngLat([params.longitude, params.latitude])

    if (params.popup) {
      const popup = new mapboxgl.Popup().setHTML(params.popup)
      marker.setPopup(popup)
    }

    marker.addTo(this._map)
    this._markers.set(id, marker)
    return { success: true, markerId: id }
  }

  removeMarker(params: { id: string }) {
    const marker = this._markers.get(params.id)
    if (marker) {
      marker.remove()
      this._markers.delete(params.id)
    }
    return { success: true }
  }

  updateMarker(params: UpdateMarkerParams) {
    const marker = this._markers.get(params.id)
    if (!marker) return { success: false, error: `Marker not found: ${params.id}` }

    if (params.longitude !== undefined && params.latitude !== undefined) {
      marker.setLngLat([params.longitude, params.latitude])
    }
    if (params.popup !== undefined) {
      const mapboxgl = (globalThis as Record<string, unknown>).mapboxgl as typeof import('mapbox-gl')
      marker.setPopup(new mapboxgl.Popup().setHTML(params.popup))
    }
    return { success: true }
  }

  listMarkers() {
    return Array.from(this._markers.entries()).map(([id, marker]) => {
      const lngLat = marker.getLngLat()
      return { id, longitude: lngLat.lng, latitude: lngLat.lat }
    })
  }

  // ==================== Draw ====================

  addGeoJSON(params: AddGeoJSONParams) {
    const id = params.id ?? `geojson_${Date.now()}`
    const sourceId = `${id}-source`

    this._map.addSource(sourceId, {
      type: 'geojson',
      data: params.data as unknown as GeoJSON.GeoJSON,
      cluster: params.cluster,
    } as mapboxgl.GeoJSONSourceSpecification)

    // Auto-detect geometry type and add appropriate layer
    const data = typeof params.data === 'object' ? params.data as Record<string, unknown> : null
    const features = (data?.features ?? []) as Array<{ geometry?: { type?: string } }>
    const geomType = features[0]?.geometry?.type ?? 'Point'

    if (geomType === 'Point' || geomType === 'MultiPoint') {
      this._map.addLayer({
        id,
        type: 'circle',
        source: sourceId,
        paint: {
          'circle-radius': 6,
          'circle-color': '#3B82F6',
          ...params.style,
        },
      } as mapboxgl.LayerSpecification)
    } else if (geomType === 'LineString' || geomType === 'MultiLineString') {
      this._map.addLayer({
        id,
        type: 'line',
        source: sourceId,
        paint: {
          'line-width': 2,
          'line-color': '#3B82F6',
          ...params.style,
        },
      } as mapboxgl.LayerSpecification)
    } else {
      this._map.addLayer({
        id,
        type: 'fill',
        source: sourceId,
        paint: {
          'fill-color': '#3B82F6',
          'fill-opacity': 0.5,
          ...params.style,
        },
      } as mapboxgl.LayerSpecification)
    }

    return { success: true, layerId: id, sourceId }
  }

  async addImage(params: { id: string; url: string; pixelRatio?: number; sdf?: boolean }) {
    return new Promise<{ success: boolean }>((resolve, reject) => {
      this._map.loadImage(params.url, ((err: Error | null, image: ImageBitmap | HTMLImageElement | ImageData | undefined) => {
        if (err) { reject(err); return }
        if (!image) { reject(new Error('Failed to load image')); return }
        this._map.addImage(params.id, image, { pixelRatio: params.pixelRatio ?? 1, sdf: params.sdf ?? false })
        resolve({ success: true })
      }) as any)
    })
  }

  removeImage(params: { id: string }) {
    if (this._map.hasImage(params.id)) {
      this._map.removeImage(params.id)
    }
    return { success: true }
  }

  // ==================== Style ====================

  setStyle(params: { style: string | Record<string, unknown> }) {
    this._map.setStyle(params.style as string | mapboxgl.StyleSpecification)
    return { success: true }
  }

  getStyle() {
    return this._map.getStyle()
  }

  setFog(params: SetFogParams) {
    this._map.setFog(params as mapboxgl.FogSpecification)
    return { success: true }
  }

  setLight(params: SetLightParams) {
    this._map.setLight(params as mapboxgl.LightSpecification)
    return { success: true }
  }

  setTerrain(params: SetTerrainParams) {
    if (params.source) {
      this._map.setTerrain({ source: params.source, exaggeration: params.exaggeration ?? 1 })
    } else {
      this._map.setTerrain(null)
    }
    return { success: true }
  }

  setSky(params: SetSkyParams) {
    // Sky is implemented as a sky-type layer in Mapbox GL JS v3
    const existingSky = this._map.getLayer('sky-layer')
    if (existingSky) this._map.removeLayer('sky-layer')

    this._map.addLayer({
      id: 'sky-layer',
      type: 'sky',
      paint: {
        'sky-type': params.skyType ?? 'atmosphere',
        ...(params.skyAtmosphereSun ? { 'sky-atmosphere-sun': params.skyAtmosphereSun } : {}),
        ...(params.skyAtmosphereSunIntensity ? { 'sky-atmosphere-sun-intensity': params.skyAtmosphereSunIntensity } : {}),
      },
    } as mapboxgl.LayerSpecification)
    return { success: true }
  }

  // ==================== Interaction ====================

  screenshot() {
    const canvas = this._map.getCanvas()
    const dataUrl = canvas.toDataURL('image/png')
    return { dataUrl }
  }

  queryRenderedFeatures(params: QueryRenderedFeaturesParams) {
    const options: Record<string, unknown> = {}
    if (params.layers) options.layers = params.layers
    if (params.filter) options.filter = params.filter

    let features: mapboxgl.GeoJSONFeature[]
    if (params.point) {
      features = this._map.queryRenderedFeatures(params.point as [number, number], options as any)
    } else if (params.bbox) {
      features = this._map.queryRenderedFeatures(params.bbox as [[number, number], [number, number]], options as any)
    } else {
      features = this._map.queryRenderedFeatures(options as any)
    }

    return features.map(f => ({
      id: f.id,
      layer: f.layer?.id,
      source: f.source,
      sourceLayer: f.sourceLayer,
      geometry: f.geometry,
      properties: f.properties,
    }))
  }

  querySourceFeatures(params: QuerySourceFeaturesParams) {
    const features = this._map.querySourceFeatures(params.sourceId, {
      sourceLayer: params.sourceLayer,
      filter: params.filter as mapboxgl.FilterSpecification,
    })

    return features.map(f => ({
      id: f.id,
      geometry: f.geometry,
      properties: f.properties,
    }))
  }

  // ==================== 3D ====================

  addFillExtrusion(params: AddFillExtrusionParams) {
    this._map.addLayer({
      id: params.id,
      type: 'fill-extrusion',
      source: params.source,
      ...(params.sourceLayer ? { 'source-layer': params.sourceLayer } : {}),
      paint: {
        'fill-extrusion-color': params.color ?? '#3B82F6',
        'fill-extrusion-height': params.height ?? 0,
        'fill-extrusion-base': params.base ?? 0,
        'fill-extrusion-opacity': params.opacity ?? 0.8,
      },
    } as mapboxgl.LayerSpecification)
    return { success: true, layerId: params.id }
  }
}
