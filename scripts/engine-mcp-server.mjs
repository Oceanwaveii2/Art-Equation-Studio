#!/usr/bin/env node
/**
 * Art Equation Canvas Engine - Model Context Protocol (MCP) Server
 *
 * Stdio JSON-RPC 2.0 MCP server providing programmatic access to the canvas engine:
 *  - engine_get_status
 *  - engine_shape_freeform_text
 *  - engine_query_image_registry
 *  - engine_register_image
 *  - engine_calculate_connector
 *  - engine_validate_display_list
 *  - engine_render_snapshot
 */

import readline from 'node:readline'
import { EngineMcpBridge, MCP_TOOLS_MANIFEST } from './engine-mcp/engineMcpCore.ts'

const PROTOCOL_VERSION = '2024-11-05'
const SERVER_INFO = {
  name: 'art-equation-engine',
  version: '1.0.0'
}

const bridge = new EngineMcpBridge()

function formatToolResponse(result, isError = false) {
  return {
    content: [
      {
        type: 'text',
        text: JSON.stringify(result, null, 2)
      }
    ],
    isError
  }
}

async function handleRequest(request) {
  const { id, method, params = {} } = request

  if (method === 'initialize') {
    await bridge.initialize()
    return {
      jsonrpc: '2.0',
      id,
      result: {
        protocolVersion: PROTOCOL_VERSION,
        capabilities: {
          tools: {}
        },
        serverInfo: SERVER_INFO
      }
    }
  }

  if (method === 'notifications/initialized') {
    return null
  }

  if (method === 'ping') {
    return {
      jsonrpc: '2.0',
      id,
      result: {}
    }
  }

  if (method === 'tools/list') {
    return {
      jsonrpc: '2.0',
      id,
      result: {
        tools: MCP_TOOLS_MANIFEST
      }
    }
  }

  if (method === 'tools/call') {
    const toolName = params.name
    const toolArgs = params.arguments || {}

    try {
      const output = await bridge.executeTool(toolName, toolArgs)
      return {
        jsonrpc: '2.0',
        id,
        result: formatToolResponse(output, false)
      }
    } catch (err) {
      const errorPayload = {
        ok: false,
        error: err instanceof Error ? err.message : String(err)
      }
      return {
        jsonrpc: '2.0',
        id,
        result: formatToolResponse(errorPayload, true)
      }
    }
  }

  if (id !== undefined) {
    return {
      jsonrpc: '2.0',
      id,
      error: {
        code: -32601,
        message: `Method not found: ${method}`
      }
    }
  }

  return null
}

async function main() {
  process.stderr.write('[engine-mcp] Art Equation Canvas Engine MCP Server starting...\n')

  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout,
    terminal: false
  })

  for await (const line of rl) {
    const trimmed = line.trim()
    if (!trimmed) continue

    let request
    try {
      request = JSON.parse(trimmed)
    } catch (parseErr) {
      process.stderr.write(`[engine-mcp] Failed to parse JSON: ${trimmed}\n`)
      continue
    }

    try {
      const response = await handleRequest(request)
      if (response !== null) {
        process.stdout.write(JSON.stringify(response) + '\n')
      }
    } catch (handlerErr) {
      process.stderr.write(`[engine-mcp] Uncaught error in handler: ${handlerErr}\n`)
      if (request.id !== undefined) {
        process.stdout.write(JSON.stringify({
          jsonrpc: '2.0',
          id: request.id,
          error: {
            code: -32603,
            message: handlerErr instanceof Error ? handlerErr.message : String(handlerErr)
          }
        }) + '\n')
      }
    }
  }

  process.stderr.write('[engine-mcp] Server closed.\n')
}

main().catch((err) => {
  process.stderr.write(`[engine-mcp] Fatal: ${err}\n`)
  process.exit(1)
})
