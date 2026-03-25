#!/usr/bin/env node
import { main } from './index.js'

main().catch((err) => {
  console.error('[mapbox-mcp-runtime] Fatal:', err)
  process.exit(1)
})
