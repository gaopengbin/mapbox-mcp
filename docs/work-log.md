# Mapbox MCP 工作日志

## 2026-03-26 项目初始化

### 完成内容

1. **项目脚手架搭建**
   - 参照 cesium-mcp 架构，创建 monorepo 结构（npm workspaces）
   - 两个包：mapbox-mcp-runtime（MCP Server）、mapbox-mcp-bridge（浏览器 SDK）
   - 构建工具：tsup（ESM/CJS/DTS），tsx（dev 模式），TypeScript 5.3+

2. **核心功能实现**
   - MCP Server：30 个默认工具，8 个工具集（view, layer, source, marker, interaction, draw, style, 3d, geolocation）
   - WebSocket 桥接：JSON-RPC 2.0 协议，端口 9200
   - 浏览器 Bridge SDK：MapboxBridge 类，接收 WebSocket 命令操控 Mapbox GL JS

3. **构建问题修复**
   - 11 个 TypeScript 类型错误：bounds null check、paint/layout 属性类型转换、GeoJSON 断言、loadImage 回调、queryRenderedFeatures 重载
   - `__VERSION__` ReferenceError：tsup 构建时注入的常量在 dev 模式下不存在，添加运行时 fallback
   - types.ts 中 bounds 改为 optional

4. **Demo 页面**
   - 创建 examples/minimal/index.html（~500 行）
   - 功能：Token 输入、视图控制（8 城市）、GeoJSON 图层、3D Buildings、Markers、地图样式切换、自定义 JSON 命令、活动日志、截图预览
   - 修复：fill-color 8 位 hex 不支持，改用 fill-opacity 分离

5. **全功能测试通过**
   - 地图加载、WebSocket 连接、GeoJSON 点图层、3D 建筑、航线线图层、随机多边形、城市标记、卫星样式、获取视图、截图、自定义 flyTo 命令

6. **GitHub 发布**
   - 丰富 README（架构图、工具表格、快速上手、环境变量、MCP 配置示例）
   - 创建 GitHub 仓库：https://github.com/gaopengbin/mapbox-mcp
   - Push Protection 拦截后移除内嵌 Mapbox token
   - 16 个文件首次提交推送至 master

### 技术架构

```
AI Agent <-> MCP Server (stdio) <-> WebSocket (port 9200) <-> Browser (MapboxBridge) <-> Mapbox GL JS
```

### 已知事项
- demo 页面中 token 已清空，用户需自行输入
- 未配置 CI/CD

## 2026-03-26 项目加速

### 完成内容

1. **npm 发布**
   - mapbox-mcp-bridge@0.1.0
   - mapbox-mcp-runtime@0.1.2 (0.1.0/0.1.1 的 bin 路径被 npm 移除，0.1.2 修复)
   - bin 修复：`./dist/cli.js` -> `dist/cli.js`（npm pkg fix），去掉 `./` 前缀
   - shebang 修复：移除 cli.ts 源码 shebang，使用 tsup banner 注入

2. **GitHub 完善**
   - 添加 11 个 topics (mapbox, mcp, model-context-protocol, ai, gis, map, mapbox-gl-js, typescript, webgis, mcp-server, geospatial)
   - LICENSE 文件 (MIT)
   - Chinese README (README.zh-CN.md)
   - Stars badge + npm version badge
   - Related Projects 交叉链接 (cesium-mcp, openlayers-mcp)

3. **生态矩阵**
   - 与 cesium-mcp (22 stars) 和 openlayers-mcp (新建) 形成三角交叉引用闭环
   - 统一架构模式, 统一端口分配 (9100/9200/9300)
