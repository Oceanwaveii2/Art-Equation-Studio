/**
 * Engine MCP Integration Test Suite
 *
 * Verifies end-to-end stdio JSON-RPC 2.0 communication with the
 * Art Equation Canvas Engine MCP Server.
 */

import assert from 'node:assert/strict'
import { spawn } from 'node:child_process'
import readline from 'node:readline'
import { URL, fileURLToPath } from 'node:url'

console.log('=== Step 1: Spawning Canvas Engine MCP Server Process ===')

const serverScript = fileURLToPath(new URL('engine-mcp-server.mjs', import.meta.url))
const serverProcess = spawn('node', [serverScript], {
  stdio: ['pipe', 'pipe', 'pipe']
})

serverProcess.stderr.on('data', (chunk) => {
  process.stderr.write(chunk)
})

const rl = readline.createInterface({
  input: serverProcess.stdout,
  terminal: false
})

let nextReqId = 1
const pendingRequests = new Map()

rl.on('line', (line) => {
  const trimmed = line.trim()
  if (!trimmed) return
  const msg = JSON.parse(trimmed)
  if (msg.id && pendingRequests.has(msg.id)) {
    const { resolve, reject } = pendingRequests.get(msg.id)
    pendingRequests.delete(msg.id)
    if (msg.error) {
      reject(new Error(`MCP error ${msg.error.code}: ${msg.error.message}`))
    } else {
      resolve(msg.result)
    }
  }
})

function sendRpc(method, params = {}) {
  const id = nextReqId++
  return new Promise((resolve, reject) => {
    pendingRequests.set(id, { resolve, reject })
    const payload = JSON.stringify({
      jsonrpc: '2.0',
      id,
      method,
      params
    })
    serverProcess.stdin.write(payload + '\n')
  })
}

function sendNotification(method, params = {}) {
  const payload = JSON.stringify({
    jsonrpc: '2.0',
    method,
    params
  })
  serverProcess.stdin.write(payload + '\n')
}

// -----------------------------------------------------------------
// Test Execution
// -----------------------------------------------------------------
try {
  // Test 1: Initialize
  console.log('\n=== Step 2: Testing MCP Initialize Handshake ===')
  const initResult = await sendRpc('initialize')
  assert.equal(initResult.protocolVersion, '2024-11-05')
  assert.equal(initResult.serverInfo.name, 'art-equation-engine')
  assert.ok(initResult.capabilities.tools)
  console.log('✔ Handshake verified:', initResult.serverInfo)

  sendNotification('notifications/initialized')

  // Test 2: Tools List
  console.log('\n=== Step 3: Testing tools/list ===')
  const listResult = await sendRpc('tools/list')
  assert.ok(Array.isArray(listResult.tools))
  const toolNames = listResult.tools.map((t) => t.name)
  console.log(`✔ Found ${toolNames.length} MCP tools:`, toolNames.join(', '))
  assert.ok(toolNames.includes('engine_get_status'))
  assert.ok(toolNames.includes('engine_shape_freeform_text'))
  assert.ok(toolNames.includes('engine_query_image_registry'))
  assert.ok(toolNames.includes('engine_register_image'))
  assert.ok(toolNames.includes('engine_calculate_connector'))
  assert.ok(toolNames.includes('engine_validate_display_list'))
  assert.ok(toolNames.includes('engine_render_snapshot'))

  // Test 3: engine_get_status
  console.log('\n=== Step 4: Testing engine_get_status ===')
  const statusCall = await sendRpc('tools/call', {
    name: 'engine_get_status',
    arguments: {}
  })
  const statusData = JSON.parse(statusCall.content[0].text)
  assert.equal(statusData.status, 'ready')
  assert.ok(statusData.backend.includes('Vello CPU'))
  assert.equal(statusData.imageRegistry.totalBytesMax, 64 * 1024 * 1024)
  console.log('✔ engine_get_status verified:', {
    backend: statusData.backend,
    maxBudget: statusData.imageRegistry.totalBytesMax,
    registeredFonts: statusData.registeredFonts
  })

  // Test 4: engine_shape_freeform_text
  console.log('\n=== Step 5: Testing engine_shape_freeform_text ===')
  const textCall = await sendRpc('tools/call', {
    name: 'engine_shape_freeform_text',
    arguments: {
      text: 'Supporting characters\nThe Tom in this not Rainee but One of her sister',
      x: 100,
      y: 200,
      maxWidth: 250,
      style: {
        fontSize: 14,
        lineHeight: 1.4,
        color: '#ffffff'
      },
      backdrop: {
        fill: '#1a1a1aff',
        stroke: '#404040ff',
        strokeWidth: 1,
        cornerRadius: 6,
        padding: { top: 8, right: 12, bottom: 8, left: 12 }
      }
    }
  })
  const textData = JSON.parse(textCall.content[0].text)
  assert.ok(textData.bounds.width > 100)
  assert.ok(textData.bounds.height > 20)
  assert.equal(textData.ports.top.x, textData.bounds.x + textData.bounds.width / 2)
  assert.ok(textData.lineCount >= 2)
  console.log('✔ engine_shape_freeform_text verified:', {
    lineCount: textData.lineCount,
    bounds: textData.bounds,
    ports: Object.keys(textData.ports)
  })

  // Test 5: engine_calculate_connector
  console.log('\n=== Step 6: Testing engine_calculate_connector ===')
  const connCall = await sendRpc('tools/call', {
    name: 'engine_calculate_connector',
    arguments: {
      source: { x: 100, y: 100 },
      target: { x: 300, y: 250 },
      style: 'bezier',
      color: '#ef4444ff',
      width: 3
    }
  })
  const connData = JSON.parse(connCall.content[0].text)
  assert.ok(connData.path.startsWith('M 100 100 C'))
  assert.ok(connData.operations.length >= 2)
  console.log('✔ engine_calculate_connector verified cubic Bézier path:', connData.path)

  // Test 6: engine_register_image (Synthetic 2x2 premultiplied RGBA)
  console.log('\n=== Step 7: Testing engine_register_image ===')
  // 2x2 = 4 pixels, 16 bytes: Red (255, 0, 0, 255), Green (0, 255, 0, 255), Blue (0, 0, 255, 255), Half White (128, 128, 128, 128)
  const syntheticPixels = new Uint8Array([
    255, 0, 0, 255,
    0, 255, 0, 255,
    0, 0, 255, 255,
    128, 128, 128, 128
  ])
  const b64 = Buffer.from(syntheticPixels).toString('base64')
  const regCall = await sendRpc('tools/call', {
    name: 'engine_register_image',
    arguments: {
      id: 'mcp_test_texture_01',
      width: 2,
      height: 2,
      rgbaBase64: b64,
      epoch: 1
    }
  })
  const regData = JSON.parse(regCall.content[0].text)
  assert.equal(regData.ok, true)
  assert.equal(regData.bytes, 16)
  console.log('✔ engine_register_image verified:', regData)

  // Test 7: engine_query_image_registry
  console.log('\n=== Step 8: Testing engine_query_image_registry ===')
  const queryCall = await sendRpc('tools/call', {
    name: 'engine_query_image_registry',
    arguments: {}
  })
  const queryData = JSON.parse(queryCall.content[0].text)
  assert.equal(queryData.activeTexturesCount, 1)
  assert.equal(queryData.totalBytesUsed, 16)
  assert.ok(queryData.remainingBudgetBytes > 60 * 1024 * 1024)
  console.log('✔ engine_query_image_registry verified:', {
    activeTexturesCount: queryData.activeTexturesCount,
    totalBytesUsed: queryData.totalBytesUsed
  })

  // Test 8: engine_validate_display_list
  console.log('\n=== Step 9: Testing engine_validate_display_list ===')
  const validListCall = await sendRpc('tools/call', {
    name: 'engine_validate_display_list',
    arguments: {
      displayList: [
        { op: 'draw_rect', payload: { x: 0, y: 0, width: 50, height: 50, fill: '#ff0000ff' } }
      ]
    }
  })
  const validListData = JSON.parse(validListCall.content[0].text)
  assert.equal(validListData.valid, true)

  const invalidListCall = await sendRpc('tools/call', {
    name: 'engine_validate_display_list',
    arguments: {
      displayList: [
        { op: 'invalid_op', payload: {} },
        { op: 'draw_rect', fill: '#ff0000ff', payload: { x: 0, y: 0, width: 10, height: 10 } }
      ]
    }
  })
  const invalidListData = JSON.parse(invalidListCall.content[0].text)
  assert.equal(invalidListData.valid, false)
  assert.equal(invalidListData.errors.length, 2)
  console.log('✔ engine_validate_display_list verified valid and invalid cases')

  // Test 9: engine_render_snapshot
  console.log('\n=== Step 10: Testing engine_render_snapshot ===')
  const renderCall = await sendRpc('tools/call', {
    name: 'engine_render_snapshot',
    arguments: {
      width: 128,
      height: 128,
      displayList: [
        { op: 'draw_rect', payload: { x: 0, y: 0, width: 128, height: 128, fill: '#181818ff' } },
        { op: 'draw_rect', payload: { x: 16, y: 16, width: 96, height: 96, fill: '#3b82f6ff' } }
      ],
      scale: 1.0,
      panX: 0.0,
      panY: 0.0
    }
  })
  const renderData = JSON.parse(renderCall.content[0].text)
  assert.equal(renderData.width, 128)
  assert.equal(renderData.height, 128)
  assert.ok(renderData.durationMs > 0)
  assert.ok(renderData.nonZeroPixels > 0)
  console.log('✔ engine_render_snapshot verified:', {
    durationMs: renderData.durationMs,
    bufferBytes: renderData.bufferBytes,
    nonZeroPixels: renderData.nonZeroPixels,
    nonZeroPercent: renderData.nonZeroPercent
  })

  console.log('\n=== ALL CANVAS ENGINE MCP SERVER TESTS PASSED (100%) ===')
} finally {
  serverProcess.stdin.end()
  serverProcess.kill()
}
