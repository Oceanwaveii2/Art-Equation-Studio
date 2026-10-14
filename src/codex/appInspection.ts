import type { ProjectModel, BoardNode } from '../model/project'
import { geminiStore } from '../gemini/geminiStore.ts'

export type AppInspectionContext = {
  project: ProjectModel
  ui: Record<string, unknown>
  diagnostics?: () => unknown
  onMutateProject?: (updater: (prev: ProjectModel) => ProjectModel) => void
  onDispatchAction?: (action: string, payload?: unknown) => unknown
}

const domains = ['project', 'boards', 'nodes', 'connectors', 'documents', 'assets', 'ui', 'telemetry', 'boardSnapshot', 'diagnostics', 'gemini']
const telemetrySnapshots = new Map<string, { text: string; created: number }>()
const boardSnapshots = new Map<string, { text: string; created: number; projectId: string; boardId: string; revision: string }>()
const runtimeSnapshots = new Map<string, { text: string; created: number; projectId: string }>()

const integer = (value: unknown, fallback: number, max: number) => {
  if (value === undefined) return fallback
  if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < 0 || value > max) throw new Error('Invalid pagination')
  return value
}

// Full authored model fields are available only through explicit paginated reads.
// Referenced media files are identified by their asset records; no bulk export occurs.
function safeJson(value: unknown) {
  return JSON.stringify(value)
}

type Telemetry = { rows: unknown[]; dropped: number; historyDropped: number; transportFailures: number }

export function inspectApp(context: AppInspectionContext, tool: string, raw: unknown, telemetry?: Telemetry): unknown {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) throw new Error('Tool arguments must be an object')
  const args = raw as Record<string, unknown>
  const project = context.project

  // 1. Read-only Status
  if (tool === 'art_app_status') {
    if (Object.keys(args).length) throw new Error('Status has no arguments')
    const snapshot = telemetry || { rows: [], dropped: 0, historyDropped: 0, transportFailures: 0 }
    // Keep evidence explicitly bounded; this is a recent diagnostic slice, not a performance certificate.
    const recent = snapshot.rows.slice(-60)
    const text = safeJson(recent)
    const latestRendererState = (snapshot.rows as Array<{ kind: string; data?: Record<string, unknown> }>)
      .slice().reverse().find(r => r.kind === 'renderer.state')
    const activeRenderer = latestRendererState?.data?.backend ? `Vello ${String(latestRendererState.data.backend).toUpperCase()}` : 'wgpu / Vello GPU and Vello CPU'
    return {
      projectId: project.id,
      title: project.title,
      updatedAt: project.updatedAt,
      boards: project.boards.length,
      documents: project.documents.length,
      assets: project.assets.length,
      ui: context.ui,
      renderer: activeRenderer,
      telemetry: {
        available: Boolean(telemetry),
        scope: 'Bounded recent local telemetry; not release qualification',
        totalRetainedRows: snapshot.rows.length,
        dropped: snapshot.dropped,
        historyDropped: snapshot.historyDropped,
        transportFailures: snapshot.transportFailures,
        recentJson: text.slice(0, 24_000),
        truncated: snapshot.rows.length > recent.length || text.length > 24_000,
      },
      geminiBridge: {
        active: true,
        trackedBugsCount: geminiStore.getBugs().length,
        recentFeedbackCount: geminiStore.getFeedbackLog().length,
      }
    }
  }

  // 2. Gemini Live Bug & Issue Tracking
  if (tool === 'gemini_app_track_bug') {
    const title = String(args.title || 'Untitled issue')
    const description = String(args.description || '')
    const component = String(args.component || 'general')
    const severity = (['low', 'medium', 'high', 'critical'].includes(String(args.severity)) ? args.severity : 'medium') as 'low' | 'medium' | 'high' | 'critical'
    const reproductionSteps = Array.isArray(args.reproductionSteps) ? args.reproductionSteps.map(String) : []
    const suggestedFix = args.suggestedFix ? String(args.suggestedFix) : undefined
    const status = args.status === 'resolved' || args.status === 'investigating' ? args.status : 'open'

    const issue = geminiStore.trackBug({
      title,
      description,
      component,
      severity,
      reproductionSteps,
      suggestedFix,
      status,
    })
    return { ok: true, issueId: issue.id, issue, totalTracked: geminiStore.getBugs().length }
  }

  // 3. Gemini Live Real-time Feedback Stream
  if (tool === 'gemini_app_feedback') {
    const message = String(args.message || '')
    const level = (['info', 'warning', 'error', 'success'].includes(String(args.level)) ? args.level : 'info') as 'info' | 'warning' | 'error' | 'success'
    const suggestedAction = args.suggestedAction ? String(args.suggestedAction) : undefined

    const feedback = geminiStore.addFeedback({ message, level, suggestedAction })
    return { ok: true, feedback, totalFeedback: geminiStore.getFeedbackLog().length }
  }

  // 4. Gemini Live App Alteration (Nodes, Connectors, Properties)
  if (tool === 'gemini_app_alter') {
    const boardId = (args.boardId as string) || (context.ui.activeBoardId as string) || project.boards[0]?.id
    if (!boardId) throw new Error('No open board available to alter')
    const board = project.boards.find(b => b.id === boardId)
    if (!board) throw new Error(`Board '${boardId}' not found`)

    const nodeId = args.nodeId as string | undefined
    const changes = (args.changes as Record<string, unknown>) || {}

    if (nodeId) {
      const nodeIndex = board.nodes.findIndex(n => n.id === nodeId)
      if (nodeIndex === -1) throw new Error(`Node '${nodeId}' not found on board '${boardId}'`)

      const updater = (prev: ProjectModel): ProjectModel => {
        return {
          ...prev,
          updatedAt: new Date().toISOString(),
          boards: prev.boards.map(b => {
            if (b.id !== boardId) return b
            return {
              ...b,
              nodes: b.nodes.map(n => {
                if (n.id !== nodeId) return n
                return { ...n, ...changes } as BoardNode
              })
            }
          })
        }
      }

      if (context.onMutateProject) {
        context.onMutateProject(updater)
      } else {
        board.nodes[nodeIndex] = { ...board.nodes[nodeIndex], ...changes } as BoardNode
        project.updatedAt = new Date().toISOString()
      }

      geminiStore.addFeedback({
        message: `Gemini altered node '${nodeId}' on board '${boardId}'`,
        level: 'info'
      })

      return { ok: true, mutated: true, domain: 'node', boardId, nodeId, changes, revision: revision(context) }
    }

    // Board-level properties alter
    const boardChanges = (args.boardChanges as Record<string, unknown>) || changes
    const updater = (prev: ProjectModel): ProjectModel => ({
      ...prev,
      updatedAt: new Date().toISOString(),
      boards: prev.boards.map(b => b.id === boardId ? { ...b, ...boardChanges } : b)
    })

    if (context.onMutateProject) context.onMutateProject(updater)
    else { Object.assign(board, boardChanges); project.updatedAt = new Date().toISOString() }

    geminiStore.addFeedback({
      message: `Gemini altered board properties on '${boardId}'`,
      level: 'info'
    })

    return { ok: true, mutated: true, domain: 'board', boardId, changes: boardChanges, revision: revision(context) }
  }

  // 5. Gemini Send Data In/Out (Inject Cards, Notes, JSON)
  if (tool === 'gemini_app_send_data') {
    const boardId = (args.boardId as string) || (context.ui.activeBoardId as string) || project.boards[0]?.id
    const target = (args.target as string) || 'board'
    const cards = (args.cards as Array<Record<string, unknown>>) || []

    if (target === 'board' && cards.length > 0) {
      const newNodes: BoardNode[] = cards.map((c, idx) => ({
        id: (c.id as string) || `gemini-node-${Date.now()}-${idx}`,
        kind: (c.kind as BoardNode['kind']) || 'note',
        title: (c.title as string) || 'Gemini Generated Note',
        content: (c.content as string) || '',
        x: typeof c.x === 'number' ? c.x : 100 + idx * 40,
        y: typeof c.y === 'number' ? c.y : 100 + idx * 40,
        width: typeof c.width === 'number' ? c.width : 280,
        height: typeof c.height === 'number' ? c.height : 180,
        color: (c.color as string) || '#2a3b4c',
        textColor: '#e8f0f8',
      } as BoardNode))

      const updater = (prev: ProjectModel): ProjectModel => ({
        ...prev,
        updatedAt: new Date().toISOString(),
        boards: prev.boards.map(b => {
          if (b.id !== boardId) return b
          return { ...b, nodes: [...b.nodes, ...newNodes] }
        })
      })

      if (context.onMutateProject) context.onMutateProject(updater)
      else {
        const board = project.boards.find(b => b.id === boardId)
        if (board) board.nodes.push(...newNodes)
        project.updatedAt = new Date().toISOString()
      }

      geminiStore.addFeedback({
        message: `Gemini sent ${newNodes.length} card(s) to board '${boardId}'`,
        level: 'success'
      })

      return { ok: true, addedCount: newNodes.length, nodeIds: newNodes.map(n => n.id), boardId }
    }

    return { ok: true, message: 'Data received', target }
  }

  // 6. Gemini Live Action Dispatcher
  if (tool === 'gemini_app_execute') {
    const action = String(args.action || '')
    if (!action) throw new Error('Action name is required')

    let dispatchResult: unknown = null
    if (context.onDispatchAction) {
      dispatchResult = context.onDispatchAction(action, args.payload)
    }

    geminiStore.addFeedback({
      message: `Gemini executed action '${action}'`,
      level: 'info'
    })

    return { ok: true, action, executed: Boolean(context.onDispatchAction), result: dispatchResult }
  }

  // 7. Read-only App Data
  if (tool !== 'art_app_read') throw new Error('Unknown inspection tool')
  if (Object.keys(args).some(key => !['domain', 'id', 'boardId', 'offset', 'limit'].includes(key))) throw new Error('Unsupported argument')
  if (typeof args.domain !== 'string' || !domains.includes(args.domain)) throw new Error('Unknown domain')
  for (const key of ['id', 'boardId']) if (args[key] !== undefined && (typeof args[key] !== 'string' || (args[key] as string).length > 256)) throw new Error('Invalid ID')
  const offset = integer(args.offset, 0, 100_000_000)
  const limit = integer(args.limit, args.id || args.domain === 'project' || args.domain === 'gemini' ? 4000 : 30, 8000)
  if (!limit) throw new Error('Limit must be positive')
  const domain = args.domain

  if (domain === 'diagnostics') {
    for (const [key, value] of runtimeSnapshots) if (Date.now() - value.created > 300_000) runtimeSnapshots.delete(key)
    let id = args.id as string | undefined
    if (!id) {
      if (offset !== 0 || args.boardId) throw new Error('Start diagnostics at offset zero; continue with its snapshot ID')
      if (!context.diagnostics) throw new Error('Runtime diagnostics are unavailable')
      const text = safeJson(context.diagnostics())
      if (text.length > 2 * 1024 * 1024) throw new Error('Diagnostics snapshot exceeds bounds')
      id = crypto.randomUUID()
      while (runtimeSnapshots.size >= 2) runtimeSnapshots.delete(runtimeSnapshots.keys().next().value!)
      runtimeSnapshots.set(id, { text, created: Date.now(), projectId: project.id })
    }
    const snapshot = runtimeSnapshots.get(id)
    if (!snapshot || snapshot.projectId !== project.id) throw new Error('Diagnostics snapshot expired, evicted or belongs to another project')
    if (offset > snapshot.text.length) throw new Error('Offset exceeds diagnostics snapshot length')
    return {
      id,
      revision: id,
      frozen: true,
      expiresAfterSeconds: 300,
      paginationUnit: 'UTF-16 code units',
      total: snapshot.text.length,
      offset,
      nextOffset: offset + limit < snapshot.text.length ? offset + limit : null,
      jsonText: snapshot.text.slice(offset, offset + limit),
    }
  }

  if (domain === 'boardSnapshot') {
    if (!args.boardId) throw new Error('boardId is required')
    for (const [key, value] of boardSnapshots) if (Date.now() - value.created > 300_000) boardSnapshots.delete(key)
    let id = args.id as string | undefined
    if (!id) {
      if (offset !== 0) throw new Error('Continue board snapshot reads using the snapshot ID from the first page')
      const board = project.boards.find(row => row.id === args.boardId)
      if (!board) throw new Error('Board ID is not open')
      const text = safeJson(board)
      if (text.length > 16 * 1024 * 1024) throw new Error('Board snapshot exceeds bounds; use individual record reads')
      id = crypto.randomUUID()
      while (boardSnapshots.size >= 2) boardSnapshots.delete(boardSnapshots.keys().next().value!)
      boardSnapshots.set(id, { text, created: Date.now(), projectId: project.id, boardId: board.id, revision: revision(context) })
    }
    const snapshot = boardSnapshots.get(id)
    if (!snapshot || snapshot.projectId !== project.id || snapshot.boardId !== args.boardId) throw new Error('Board snapshot expired, evicted or belongs to another board/project')
    if (offset > snapshot.text.length) throw new Error('Offset exceeds board snapshot length')
    return {
      id,
      boardId: snapshot.boardId,
      revision: snapshot.revision,
      frozen: true,
      expiresAfterSeconds: 300,
      paginationUnit: 'UTF-16 code units',
      total: snapshot.text.length,
      offset,
      nextOffset: offset + limit < snapshot.text.length ? offset + limit : null,
      jsonText: snapshot.text.slice(offset, offset + limit),
    }
  }

  if (domain === 'telemetry') {
    for (const [key, value] of telemetrySnapshots) if (Date.now() - value.created > 300_000) telemetrySnapshots.delete(key)
    let id = args.id as string | undefined
    if (!id) {
      if (!telemetry) throw new Error('Telemetry is not available')
      if (offset !== 0 || args.boardId) throw new Error('Start telemetry reads at offset zero; continue with its snapshot ID')
      const text = safeJson(telemetry)
      if (text.length > 16 * 1024 * 1024) throw new Error('Telemetry snapshot exceeds bounds')
      id = crypto.randomUUID()
      while (telemetrySnapshots.size >= 2) telemetrySnapshots.delete(telemetrySnapshots.keys().next().value!)
      telemetrySnapshots.set(id, { text, created: Date.now() })
    }
    const snapshot = telemetrySnapshots.get(id)
    if (!snapshot) throw new Error('Telemetry snapshot expired or evicted')
    if (offset > snapshot.text.length) throw new Error('Offset exceeds telemetry snapshot length')
    const rows = ((telemetry?.rows || []) as Array<{ kind?: string; data?: Record<string, unknown> }>).slice(offset, offset + limit)
    const records = rows.map(r => ({
      event: r.kind || 'sample',
      durationMs: typeof r.data?.ms === 'number' ? r.data.ms : (typeof r.data?.durationMs === 'number' ? r.data.durationMs : 0),
      ...r.data
    }))
    return {
      id,
      revision: id,
      domain: 'telemetry',
      frozen: true,
      expiresAfterSeconds: 300,
      paginationUnit: 'UTF-16 code units',
      total: snapshot.text.length,
      offset,
      nextOffset: offset + limit < snapshot.text.length ? offset + limit : null,
      jsonText: snapshot.text.slice(offset, offset + limit),
      records,
    }
  }

  if (domain === 'project') {
    if (args.id !== undefined && args.id !== project.id) throw new Error('Record ID is not present')
    const value = Object.fromEntries(Object.entries(project).filter(([key]) => !['boards', 'documents', 'assets'].includes(key)))
    return chunk(value, offset, limit, project.id, revision(context))
  }
  if (domain === 'ui') return chunk(context.ui, offset, limit, project.id, revision(context))
  if (domain === 'gemini') {
    const data = {
      status: geminiStore.getStatus(),
      bugs: geminiStore.getBugs(),
      feedback: geminiStore.getFeedbackLog(),
    }
    return chunk(data, offset, limit, 'gemini-state', revision(context))
  }

  let rows: { id: string }[]
  if (domain === 'nodes' || domain === 'connectors') {
    if (!args.boardId) throw new Error('boardId is required')
    const board = project.boards.find(row => row.id === args.boardId)
    if (!board) throw new Error('Board ID is not open')
    rows = domain === 'nodes' ? board.nodes : board.connectors
  } else rows = domain === 'boards' ? project.boards : domain === 'documents' ? project.documents : project.assets

  if (args.id) {
    const record = rows.find(row => row.id === args.id)
    if (!record) throw new Error('Record ID is not present')
    // Board records expose settings separately; large node/connector arrays have their own domain.
    const value = domain === 'boards' ? Object.fromEntries(Object.entries(record).filter(([key]) => !['nodes', 'connectors'].includes(key))) : record
    return chunk(value, offset, limit, record.id, revision(context))
  }

  const pageSize = Math.min(limit, 100)
  const page = rows.slice(offset, offset + pageSize).map(row => {
    const value = row as unknown as Record<string, unknown>
    return {
      id: row.id,
      title: value.title ?? value.displayName ?? value.label ?? '',
      kind: value.kind ?? domain,
      ...(domain === 'boards' ? { nodes: (value.nodes as unknown[]).length, connectors: (value.connectors as unknown[]).length, parentBoardId: value.parentBoardId } : {})
    }
  })
  return { projectId: project.id, domain, total: rows.length, offset, nextOffset: offset + page.length < rows.length ? offset + page.length : null, records: page }
}

function chunk(value: unknown, offset: number, limit: number, id: string, revision: string) {
  const text = safeJson(value)
  if (offset > text.length) throw new Error('Offset exceeds record length')
  // Each request reads the latest committed UI model. Do not concatenate across revisions.
  return {
    id,
    revision,
    paginationUnit: 'UTF-16 code units',
    total: text.length,
    offset,
    nextOffset: offset + limit < text.length ? offset + limit : null,
    jsonText: text.slice(offset, offset + limit),
  }
}

function revision(context: AppInspectionContext) {
  return context.ui.modelRevision === undefined ? context.project.updatedAt : `${context.project.updatedAt}/${context.ui.modelRevision}`
}
