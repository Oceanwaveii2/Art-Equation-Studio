#!/usr/bin/env node
/**
 * Art Equation - Gemini Live MCP Server
 *
 * Dedicated MCP server connecting Gemini directly to the running Art Equation instance:
 *  - gemini_app_track_bug: Real-time bug filing, status updates, and tracking
 *  - gemini_app_feedback: Real-time diagnostic stream and remediation feedback
 *  - gemini_app_alter: Live modification of boards, nodes, layout, and visual properties
 *  - gemini_app_send_data: Injecting notes, cards, media, and structural data
 *  - gemini_app_execute: Dispatching application shell actions
 *  - art_app_status: Reading project status, renderer health, and telemetry summary
 *  - art_app_read: Full paginated reads of project, boards, nodes, connectors, assets, and Gemini logs
 */

import fs from 'node:fs/promises'
import path from 'node:path'
import readline from 'node:readline'

const discoveryPath = process.env.ART_EQUATION_BRIDGE_DISCOVERY || path.join(
  process.env.LOCALAPPDATA || '',
  'studio.artequation.p1v21',
  'codex-live-discovery.json'
)

const packageVersion = JSON.parse(
  await fs.readFile(path.join(import.meta.dirname, '..', 'package.json'), 'utf8')
).version

const schema = properties => ({ type: 'object', properties, additionalProperties: false })
const pagination = { offset: { type: 'integer', minimum: 0 }, limit: { type: 'integer', minimum: 1, maximum: 8000 } }

const tools = [
  {
    name: 'art_app_handshake',
    description: 'Identify the exact app instance, workspace, embedded build and telemetry capabilities.',
    inputSchema: schema({})
  },
  {
    name: 'art_app_status',
    description: 'Read live Art Equation project/UI state, renderer identity, and recent telemetry summary.',
    inputSchema: schema({})
  },
  {
    name: 'art_app_read',
    description: 'Read open project, boards, nodes, connectors, documents, assets, ui, or gemini issue/feedback state.',
    inputSchema: {
      ...schema({
        domain: {
          type: 'string',
          enum: ['project', 'boards', 'nodes', 'connectors', 'documents', 'assets', 'ui', 'telemetry', 'boardSnapshot', 'diagnostics', 'gemini']
        },
        id: { type: 'string' },
        boardId: { type: 'string' },
        ...pagination
      }),
      required: ['domain']
    }
  },
  {
    name: 'gemini_app_track_bug',
    description: 'File, update, or track bugs/issues in real time in the running Art Equation instance.',
    inputSchema: {
      ...schema({
        title: { type: 'string', description: 'Brief summary of the issue' },
        description: { type: 'string', description: 'Detailed issue description' },
        component: { type: 'string', description: 'Affected component' },
        severity: { type: 'string', enum: ['low', 'medium', 'high', 'critical'] },
        reproductionSteps: { type: 'array', items: { type: 'string' } },
        suggestedFix: { type: 'string' },
        status: { type: 'string', enum: ['open', 'investigating', 'resolved'] }
      }),
      required: ['title']
    }
  },
  {
    name: 'gemini_app_feedback',
    description: 'Post real-time feedback, findings, or suggested actions to the running Art Equation live feed.',
    inputSchema: {
      ...schema({
        message: { type: 'string' },
        level: { type: 'string', enum: ['info', 'warning', 'error', 'success'] },
        suggestedAction: { type: 'string' }
      }),
      required: ['message']
    }
  },
  {
    name: 'gemini_app_alter',
    description: 'Alter live board or node properties (position, size, styling, title, etc.) in real time.',
    inputSchema: schema({
      boardId: { type: 'string' },
      nodeId: { type: 'string' },
      changes: { type: 'object' },
      boardChanges: { type: 'object' }
    })
  },
  {
    name: 'gemini_app_send_data',
    description: 'Send data into the running app (e.g., inject note cards or graphics onto a canvas board).',
    inputSchema: {
      ...schema({
        boardId: { type: 'string' },
        target: { type: 'string', enum: ['board'] },
        cards: { type: 'array', items: { type: 'object' } }
      }),
      required: ['cards']
    }
  },
  {
    name: 'gemini_app_execute',
    description: 'Execute an application shell action (e.g. switch tool, toggle panel, trigger command) with live feedback.',
    inputSchema: {
      ...schema({
        action: { type: 'string' },
        payload: { type: 'object' }
      }),
      required: ['action']
    }
  }
]

async function resolveDiscovery() {
  if (process.env.ART_EQUATION_BRIDGE_DISCOVERY) {
    return process.env.ART_EQUATION_BRIDGE_DISCOVERY
  }
  const dir = path.join(path.dirname(discoveryPath), 'codex-live-instances')
  const candidates = []
  for (const name of (await fs.readdir(dir).catch(() => [])).slice(0, 32)) {
    if (!/^\d+\.json$/.test(name)) continue
    const file = path.join(dir, name)
    try {
      const d = JSON.parse(await fs.readFile(file, 'utf8'))
      if (!Number.isInteger(d.port) || d.port < 1 || d.port > 65535 || !/^[a-f0-9]{64}$/.test(d.token)) continue
      const r = await fetch(`http://127.0.0.1:${d.port}/inspect`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${d.token}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ tool: 'art_app_handshake', arguments: {} }),
        signal: AbortSignal.timeout(300)
      })
      const v = await r.json()
      if (v.ok && v.data?.pid === d.pid) candidates.push(file)
    } catch {}
  }
  if (candidates.length > 1) {
    throw Error('Multiple Art Equation instances: set ART_EQUATION_BRIDGE_DISCOVERY to the target instance discovery file')
  }
  if (candidates.length === 1) return candidates[0]
  return discoveryPath
}

async function callTool(name, args) {
  if (!tools.some(t => t.name === name)) throw Error(`Unknown tool: ${name}`)
  if (!args || typeof args !== 'object' || Array.isArray(args)) throw Error('Arguments must be an object')

  const targetFile = await resolveDiscovery()
  const discovery = JSON.parse(
    await fs.readFile(targetFile, 'utf8').catch(() => {
      throw Error('Art Equation desktop instance is not currently running. Please launch the app first.')
    })
  )

  if (!Number.isInteger(discovery.port) || discovery.port < 1 || discovery.port > 65535 || !/^[a-f0-9]{64}$/.test(discovery.token)) {
    throw Error('Invalid local bridge discovery metadata')
  }

  const payload = JSON.stringify({ tool: name, arguments: args })
  if (Buffer.byteLength(payload) > 65536) throw Error('Request payload exceeds size limit (64KB)')

  const res = await fetch(`http://127.0.0.1:${discovery.port}/inspect`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${discovery.token}` },
    body: payload,
    signal: AbortSignal.timeout(25000)
  })

  const reader = res.body.getReader()
  let chunks = [], size = 0
  while (true) {
    const { done, value } = await reader.read()
    if (done) break
    size += value.byteLength
    if (size > 260000) {
      await reader.cancel()
      throw Error('Response payload exceeds size limit (256KB)')
    }
    chunks.push(value)
  }

  const result = JSON.parse(Buffer.concat(chunks).toString('utf8'))
  if (!result.ok) throw Error(result.error || 'Inspection invocation failed')
  if (result.data?.error) throw Error(result.data.error)

  return {
    content: [{ type: 'text', text: JSON.stringify(result.data, null, 2) }]
  }
}

async function handleMessage(message) {
  const { id, method, params } = message
  if (id === undefined) return
  try {
    let result
    if (method === 'initialize') {
      result = {
        protocolVersion: '2024-11-05',
        capabilities: { tools: { listChanged: false } },
        serverInfo: { name: 'art-equation-gemini-live', version: packageVersion }
      }
    } else if (method === 'ping') {
      result = {}
    } else if (method === 'tools/list') {
      result = { tools }
    } else if (method === 'tools/call') {
      result = await callTool(params?.name, params?.arguments || {})
    } else {
      process.stdout.write(JSON.stringify({ jsonrpc: '2.0', id, error: { code: -32601, message: 'Method unavailable' } }) + '\n')
      return
    }
    process.stdout.write(JSON.stringify({ jsonrpc: '2.0', id, result }) + '\n')
  } catch (err) {
    process.stdout.write(
      JSON.stringify({
        jsonrpc: '2.0',
        id,
        result: { isError: true, content: [{ type: 'text', text: err instanceof Error ? err.message : 'Tool execution failed' }] }
      }) + '\n'
    )
  }
}

const rl = readline.createInterface({ input: process.stdin, crlfDelay: Infinity })
let activeCount = 0

rl.on('line', line => {
  if (Buffer.byteLength(line) > 70000) return
  let msg
  try { msg = JSON.parse(line) } catch { return }
  if (activeCount >= 16) {
    if (msg.id !== undefined) {
      process.stdout.write(JSON.stringify({ jsonrpc: '2.0', id: msg.id, error: { code: -32000, message: 'Queue full' } }) + '\n')
    }
    return
  }
  activeCount++
  void handleMessage(msg).finally(() => activeCount--)
})
