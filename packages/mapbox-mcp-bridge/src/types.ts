export interface BridgeCommand {
  action: string
  params: Record<string, unknown>
}

export interface BridgeResult {
  success: boolean
  data?: unknown
  error?: string
}

// View
export interface FlyToParams {
  center: [number, number]
  zoom?: number
  bearing?: number
  pitch?: number
  duration?: number
  curve?: number
  essential?: boolean
}

export interface EaseToParams {
  center: [number, number]
  zoom?: number
  bearing?: number
  pitch?: number
  duration?: number
}

export interface JumpToParams {
  center: [number, number]
  zoom?: number
  bearing?: number
  pitch?: number
}

export interface FitBoundsParams {
  bounds: [[number, number], [number, number]]
  padding?: number
  duration?: number
  maxZoom?: number
}

export interface ViewState {
  center: [number, number]
  zoom: number
  bearing: number
  pitch: number
  bounds?: [[number, number], [number, number]]
}

// Layer
export interface AddLayerParams {
  id: string
  type: string
  source: string | Record<string, unknown>
  sourceLayer?: string
  paint?: Record<string, unknown>
  layout?: Record<string, unknown>
  filter?: unknown[]
  minzoom?: number
  maxzoom?: number
  beforeId?: string
}

// Source
export interface AddSourceParams {
  id: string
  type: string
  data?: string | Record<string, unknown>
  url?: string
  tiles?: string[]
  tileSize?: number
  maxzoom?: number
  minzoom?: number
  attribution?: string
  cluster?: boolean
  clusterRadius?: number
  clusterMaxZoom?: number
}

// Marker
export interface AddMarkerParams {
  id?: string
  longitude: number
  latitude: number
  color?: string
  popup?: string
  draggable?: boolean
}

export interface UpdateMarkerParams {
  id: string
  longitude?: number
  latitude?: number
  color?: string
  popup?: string
}

// Properties
export interface SetPaintPropertyParams {
  layerId: string
  name: string
  value: unknown
}

export interface SetLayoutPropertyParams {
  layerId: string
  name: string
  value: unknown
}

export interface SetFilterParams {
  layerId: string
  filter: unknown[]
}

// Draw
export interface AddGeoJSONParams {
  id?: string
  data: string | Record<string, unknown>
  style?: Record<string, unknown>
  cluster?: boolean
}

// Interaction
export interface ScreenshotResult {
  dataUrl: string
}

export interface QueryRenderedFeaturesParams {
  point?: [number, number]
  bbox?: [[number, number], [number, number]]
  layers?: string[]
  filter?: unknown[]
}

export interface QuerySourceFeaturesParams {
  sourceId: string
  sourceLayer?: string
  filter?: unknown[]
}

// Style
export interface SetFogParams {
  color?: string
  horizonBlend?: number
  range?: number[]
  highColor?: string
  spaceColor?: string
  starIntensity?: number
}

export interface SetLightParams {
  anchor?: 'map' | 'viewport'
  color?: string
  intensity?: number
  position?: number[]
}

export interface SetTerrainParams {
  source?: string
  exaggeration?: number
}

export interface SetSkyParams {
  skyType?: 'gradient' | 'atmosphere'
  skyAtmosphereSun?: number[]
  skyAtmosphereSunIntensity?: number
  skyGradient?: unknown[]
}

// 3D
export interface AddFillExtrusionParams {
  id: string
  source: string | Record<string, unknown>
  sourceLayer?: string
  height?: number | unknown[]
  base?: number | unknown[]
  color?: string | unknown[]
  opacity?: number
}

export interface Add3DModelParams {
  id: string
  url: string
  longitude: number
  latitude: number
  altitude?: number
  rotateX?: number
  rotateY?: number
  rotateZ?: number
  scale?: number
}
