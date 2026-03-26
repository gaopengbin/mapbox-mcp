<div align="center">

  <h1>Mapbox MCP</h1>

  <p><strong>通过 Model Context Protocol 实现 AI 驱动的 2D/3D 地图控制</strong></p>

  <p>将任意 MCP 兼容的 AI 代理连接到 <a href="https://www.mapbox.com/mapbox-gljs">Mapbox GL JS</a> —— 相机、图层、标记、数据源、3D 地形，全部通过自然语言完成。</p>

  <p>
    <a href="https://www.npmjs.com/package/mapbox-mcp-runtime"><img src="https://img.shields.io/npm/v/mapbox-mcp-runtime.svg" alt="npm version"></a>
    <a href="LICENSE"><img src="https://img.shields.io/badge/License-MIT-blue.svg" alt="License: MIT"></a>
    <a href="https://github.com/gaopengbin/mapbox-mcp"><img src="https://img.shields.io/github/stars/gaopengbin/mapbox-mcp?style=flat" alt="GitHub stars"></a>
  </p>

  <p>
    <a href="README.md">English</a>
  </p>
</div>

---

## 架构

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

## 组件

| 包名 | 说明 |
|------|------|
| [mapbox-mcp-runtime](packages/mapbox-mcp-runtime/) | MCP 服务端 (stdio) — 40+ 工具，8 个工具集，WebSocket 桥接浏览器 |
| [mapbox-mcp-bridge](packages/mapbox-mcp-bridge/) | 浏览器 SDK — 通过 WebSocket 接收指令并控制 Mapbox GL JS 地图 |

## 快速开始

### 1. 安装 & 构建

```bash
git clone https://github.com/gaopengbin/mapbox-mcp.git
cd mapbox-mcp
npm install
npm run build
```

### 2. 启动 MCP Runtime

```bash
npx mapbox-mcp-runtime
# => HTTP + WebSocket 在 http://localhost:9200
# => MCP Server 运行中 (stdio), 30+ 工具已注册
```

### 3. 连接浏览器

在浏览器中打开 `examples/minimal/index.html`，输入你的 [Mapbox Access Token](https://account.mapbox.com/access-tokens/)。Bridge 会自动连接到 `ws://localhost:9200`。

或在你的项目中集成 Bridge：

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

### 4. 连接 AI Agent

在 MCP 客户端配置中添加（Claude Desktop、Cursor 等）：

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

然后对 AI 说：*"飞到埃菲尔铁塔，在周围添加一个 GeoJSON 多边形"*

## 使用示例

- "飞到东京，缩放到 14 级"
- "添加一个 3D 建筑挤出图层"
- "在地图上显示这个 GeoJSON 数据"
- "设置雾效和 3D 地形"
- "截取当前地图视图"
- "查询鼠标位置下的要素"

## 40+ 可用工具

工具按 **8 个工具集** 组织。默认启用 5 个核心工具集（约 30 个工具），使用 `list_toolsets` 和 `enable_toolset` 动态激活更多。

| 工具集 | 工具 | 默认启用 |
|--------|------|----------|
| **view** | `flyTo`, `easeTo`, `jumpTo`, `getView`, `fitBounds`, `resetNorth`, `zoomIn`, `zoomOut` | 是 |
| **layer** | `addLayer`, `removeLayer`, `listLayers`, `setLayerVisibility`, `setPaintProperty`, `setLayoutProperty`, `setFilter`, `moveLayer` | 是 |
| **source** | `addSource`, `removeSource`, `listSources`, `getSourceData`, `setSourceData` | 是 |
| **marker** | `addMarker`, `removeMarker`, `updateMarker`, `listMarkers` | 是 |
| **interaction** | `screenshot`, `queryRenderedFeatures`, `querySourceFeatures` | 是 |
| **draw** | `addGeoJSON`, `addImage`, `removeImage` | 否 |
| **style** | `setStyle`, `getStyle`, `setFog`, `setLight`, `setTerrain`, `setSky` | 否 |
| **3d** | `addFillExtrusion`, `add3DModel` | 否 |
| **geolocation** | `geocode` | 否 |

### Meta 工具（始终可用）

| 工具 | 说明 |
|------|------|
| `list_toolsets` | 列出所有工具集及其启用状态 |
| `enable_toolset` | 启用一个工具集以注册其工具 |

## 环境变量

| 变量 | 默认值 | 说明 |
|------|--------|------|
| `MAPBOX_MCP_PORT` | `9200` | WebSocket 服务端口 |
| `MAPBOX_TOOLSETS` | `view,layer,source,marker,interaction` | 默认启用的工具集 |

## 相关项目

- [cesium-mcp](https://github.com/gaopengbin/cesium-mcp) — AI 控制 CesiumJS 3D 地球
- [openlayers-mcp](https://github.com/gaopengbin/openlayers-mcp) — AI 控制 OpenLayers

## 许可证

MIT
