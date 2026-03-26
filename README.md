<div align="center">

  <h1>Mapbox MCP</h1>

  <p><strong>AI-Powered 2D/3D Map Control via Model Context Protocol</strong></p>

  <p>Connect any MCP-compatible AI agent to <a href="https://www.mapbox.com/mapbox-gljs">Mapbox GL JS</a> — camera, layers, markers, sources, 3D terrain, all through natural language.</p>

  <p>
    <a href="https://www.npmjs.com/package/mapbox-mcp-runtime"><img src="https://img.shields.io/npm/v/mapbox-mcp-runtime.svg" alt="npm version"></a>
    <a href="LICENSE"><img src="https://img.shields.io/badge/License-MIT-blue.svg" alt="License: MIT"></a>
    <a href="https://github.com/gaopengbin/mapbox-mcp"><img src="https://img.shields.io/github/stars/gaopengbin/mapbox-mcp?style=flat" alt="GitHub stars"></a>
  </p>

  <p>
    <a href="README.zh-CN.md">中文文档</a>
  </p>
</div>

---

## Architecture

```
+----------------+   stdio    +--------------------+  WebSocket  +--------------------+
|   AI Agent     | <--------> |  mapbox-mcp-       | <---------> |  mapbox-mcp-       |
|   (Claude,     |    MCP     |  runtime           |   JSON-RPC  |  bridge            |
|    Cursor...)  |            |  (Node.js)         |    2.0      |  (Browser)         |
+----------------+            +--------------------+             +--------------------+
                                                                         |
                                                                  +------v------+
                                                                  |  Mapbox GL  |
                                                                  |  JS Map     |
                                                                  +-------------+
```

## Packages

| Package | Description |
|---------|-------------|
| [mapbox-mcp-runtime](packages/mapbox-mcp-runtime/) | MCP Server (stdio) -- 40+ tools across 8 toolsets, WebSocket bridge to browser |
| [mapbox-mcp-bridge](packages/mapbox-mcp-bridge/) | Browser SDK -- receives commands via WebSocket and controls Mapbox GL JS |

## Quick Start

### 1. Install & Build

```bash
git clone https://github.com/gaopengbin/mapbox-mcp.git
cd mapbox-mcp
npm install
npm run build
```

### 2. Start the MCP Runtime

```bash
npx mapbox-mcp-runtime
# => HTTP + WebSocket server on http://localhost:9200
# => MCP Server running (stdio), 30 tools registered
```

### 3. Connect Browser

Open `examples/minimal/index.html` in a browser, enter your [Mapbox access token](https://account.mapbox.com/access-tokens/). The bridge auto-connects to `ws://localhost:9200`.

Or integrate the bridge in your own app:

```typescript
import { MapboxBridge } from 'mapbox-mcp-bridge'

const map = new mapboxgl.Map({
  container: 'map',
  style: 'mapbox://styles/mapbox/dark-v11',
  accessToken: 'YOUR_TOKEN'
})
const bridge = new MapboxBridge(map)
bridge.connect('ws://localhost:9200')
```

### 4. Connect AI Agent

Add to your MCP client config (Claude Desktop, Cursor, etc.):

```json
{
  "mcpServers": {
    "mapbox": {
      "command": "npx",
      "args": ["-y", "mapbox-mcp-runtime"]
    }
  }
}
```

Now ask your AI: *"Fly to the Eiffel Tower and add a GeoJSON polygon around it"*

## 40+ Available Tools

Tools are organized into **8 toolsets**. Default mode enables 5 core toolsets (~30 tools). Use `list_toolsets` and `enable_toolset` to dynamically activate more.

| Toolset | Tools | Default |
|---------|-------|---------|
| **view** | `flyTo`, `easeTo`, `jumpTo`, `getView`, `fitBounds`, `resetNorth`, `zoomIn`, `zoomOut` | Yes |
| **layer** | `addLayer`, `removeLayer`, `listLayers`, `setLayerVisibility`, `setPaintProperty`, `setLayoutProperty`, `setFilter`, `moveLayer` | Yes |
| **source** | `addSource`, `removeSource`, `listSources`, `getSourceData`, `setSourceData` | Yes |
| **marker** | `addMarker`, `removeMarker`, `updateMarker`, `listMarkers` | Yes |
| **interaction** | `screenshot`, `queryRenderedFeatures`, `querySourceFeatures` | Yes |
| **draw** | `addGeoJSON`, `addImage`, `removeImage` | No |
| **style** | `setStyle`, `getStyle`, `setFog`, `setLight`, `setTerrain`, `setSky` | No |
| **3d** | `addFillExtrusion`, `add3DModel` | No |
| **geolocation** | `geocode` | No |

### Meta Tools (always available)

| Tool | Description |
|------|-------------|
| `list_toolsets` | List all available toolsets and their enabled status |
| `enable_toolset` | Enable a toolset to register its tools |

## Environment Variables

| Variable | Default | Description |
|----------|---------|-------------|
| `MAPBOX_MCP_PORT` | `9200` | WebSocket server port |
| `MAPBOX_TOOLSETS` | `view,layer,source,marker,interaction` | Comma-separated default toolsets |

## Development

```bash
# Dev mode (auto-restart)
cd packages/mapbox-mcp-runtime
npm run dev

# Build all packages
npm run build
```

## Inspired By

This project follows the architecture of [cesium-mcp](https://github.com/gaopengbin/cesium-mcp), adapted for the Mapbox GL JS ecosystem.

## Related Projects

- [cesium-mcp](https://github.com/gaopengbin/cesium-mcp) — AI control for CesiumJS 3D globe
- [openlayers-mcp](https://github.com/gaopengbin/openlayers-mcp) — AI control for OpenLayers

## License

MIT
