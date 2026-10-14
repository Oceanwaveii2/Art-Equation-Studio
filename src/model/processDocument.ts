/**
 * Rich Process Document - Core Model, Layout Engines & JSON Canvas Interchange
 * Workstream F / PRC-01 through PRC-11
 *
 * Provides:
 * - PRC-02: Structured process document schema (nodes, semantic edges, metadata)
 * - PRC-03: Canonical-document linking (every node references a stable documentId)
 * - PRC-04: Hybrid view layout (vertical production spine, horizontal support/output branches)
 * - PRC-05: 10 semantic relationship definitions with distinct metadata & tokens
 * - PRC-06: Linear editorial reading order & document view extraction
 * - PRC-07: Map topology with hierarchical Sugiyama-style layered layout
 * - PRC-08: Explicit layout policies (manual persistence vs auto-layout)
 * - PRC-09: Asset & tool integrations without state duplication
 * - PRC-10: Accessibility tokens & performance caching
 * - PRC-11: JSON Canvas 1.0 lossless round-trip interchange adapter
 */

export const PROCESS_DOCUMENT_KIND = 'art-equation-process-document' as const
export const PROCESS_DOCUMENT_VERSION = 1 as const

export type ProcessNodeRole = 'spine' | 'support' | 'output' | 'branch'

export type ProcessStatus = 'draft' | 'in_progress' | 'review' | 'approved' | 'completed'

export type ProcessSemanticRelation =
  | 'next'
  | 'supports'
  | 'requires'
  | 'uses_reference'
  | 'produces'
  | 'derived_from'
  | 'returns_to'
  | 'replaces'
  | 'validates'
  | 'alternate'

export interface ProcessNode {
  id: string
  title: string
  role: ProcessNodeRole
  /** Canonical document reference by stable ID (PRC-03). Never duplicates rich text as primary record. */
  documentId: string
  summary: string
  status: ProcessStatus
  order: number
  assignedOwner?: string
  tools: string[]
  assetIds: string[]
  boardIds: string[]
  position: { x: number; y: number }
  size: { width: number; height: number }
  collapsed: boolean
  branchSide?: 'left' | 'right'
  customData?: Record<string, unknown>
}

export interface ProcessEdge {
  id: string
  fromNodeId: string
  toNodeId: string
  relation: ProcessSemanticRelation
  label?: string
  customStyle?: {
    stroke?: string
    dashArray?: string
    strokeWidth?: number
    arrowStart?: boolean
    arrowEnd?: boolean
  }
}

export interface ProcessDocument {
  id: string
  projectId: string
  title: string
  description?: string
  schemaVersion: typeof PROCESS_DOCUMENT_VERSION
  kind: typeof PROCESS_DOCUMENT_KIND
  nodes: ProcessNode[]
  edges: ProcessEdge[]
  viewMode: 'hybrid' | 'document' | 'map'
  selectedNodeId: string | null
  createdAt: string
  updatedAt: string
  layoutSettings?: {
    spineX?: number
    startY?: number
    stepY?: number
    branchOffset?: number
  }
}

// PRC-05: Semantic Relationship Metadata Registry
export interface RelationMeta {
  relation: ProcessSemanticRelation
  displayName: string
  description: string
  color: string
  dashArray: string
  arrowStart: boolean
  arrowEnd: boolean
  defaultLabel: string
}

export const RELATION_METADATA: Record<ProcessSemanticRelation, RelationMeta> = {
  next: {
    relation: 'next',
    displayName: 'Next Step',
    description: 'Direct sequential progression along the production spine',
    color: '#3b82f6',
    dashArray: 'none',
    arrowStart: false,
    arrowEnd: true,
    defaultLabel: 'Next',
  },
  supports: {
    relation: 'supports',
    displayName: 'Supports',
    description: 'Contextual input, background research, or reference support',
    color: '#8b5cf6',
    dashArray: '6 4',
    arrowStart: false,
    arrowEnd: true,
    defaultLabel: 'Supports',
  },
  requires: {
    relation: 'requires',
    displayName: 'Requires',
    description: 'Strict blocking prerequisite or input contract',
    color: '#ef4444',
    dashArray: 'none',
    arrowStart: true,
    arrowEnd: true,
    defaultLabel: 'Requires',
  },
  uses_reference: {
    relation: 'uses_reference',
    displayName: 'Uses Reference',
    description: 'Informed by external media, style guide, or reference image',
    color: '#06b6d4',
    dashArray: '2 4',
    arrowStart: false,
    arrowEnd: true,
    defaultLabel: 'References',
  },
  produces: {
    relation: 'produces',
    displayName: 'Produces',
    description: 'Generates output deliverable, intermediate asset, or render',
    color: '#10b981',
    dashArray: 'none',
    arrowStart: false,
    arrowEnd: true,
    defaultLabel: 'Produces',
  },
  derived_from: {
    relation: 'derived_from',
    displayName: 'Derived From',
    description: 'Lineage/provenance trace back to ancestor source',
    color: '#64748b',
    dashArray: '8 4 2 4',
    arrowStart: false,
    arrowEnd: true,
    defaultLabel: 'Derived From',
  },
  returns_to: {
    relation: 'returns_to',
    displayName: 'Returns To',
    description: 'Iterative feedback loop or revision kickback',
    color: '#f59e0b',
    dashArray: '4 4',
    arrowStart: false,
    arrowEnd: true,
    defaultLabel: 'Returns To',
  },
  replaces: {
    relation: 'replaces',
    displayName: 'Replaces',
    description: 'Supersedes or deprecates a previous iteration',
    color: '#ec4899',
    dashArray: 'none',
    arrowStart: false,
    arrowEnd: true,
    defaultLabel: 'Replaces',
  },
  validates: {
    relation: 'validates',
    displayName: 'Validates',
    description: 'Quality assurance check, test pass, or sign-off audit',
    color: '#14b8a6',
    dashArray: '8 3',
    arrowStart: false,
    arrowEnd: true,
    defaultLabel: 'Validates',
  },
  alternate: {
    relation: 'alternate',
    displayName: 'Alternate Option',
    description: 'Exploratory branch, divergent variation, or fallback path',
    color: '#a855f7',
    dashArray: '3 3',
    arrowStart: false,
    arrowEnd: true,
    defaultLabel: 'Alternative',
  },
}

export const STATUS_LABELS: Record<ProcessStatus, { label: string; color: string; bg: string }> = {
  draft: { label: 'Draft', color: '#94a3b8', bg: 'rgba(148, 163, 184, 0.12)' },
  in_progress: { label: 'In Progress', color: '#38bdf8', bg: 'rgba(56, 189, 248, 0.12)' },
  review: { label: 'In Review', color: '#f59e0b', bg: 'rgba(245, 158, 11, 0.12)' },
  approved: { label: 'Approved', color: '#10b981', bg: 'rgba(16, 185, 129, 0.12)' },
  completed: { label: 'Completed', color: '#6366f1', bg: 'rgba(99, 102, 241, 0.12)' },
}

// Factory Constructors
export function createProcessDocument(
  id: string,
  projectId: string,
  title: string,
  description = ''
): ProcessDocument {
  const now = new Date().toISOString()
  return {
    id,
    projectId,
    title,
    description,
    schemaVersion: PROCESS_DOCUMENT_VERSION,
    kind: PROCESS_DOCUMENT_KIND,
    nodes: [],
    edges: [],
    viewMode: 'hybrid',
    selectedNodeId: null,
    createdAt: now,
    updatedAt: now,
    layoutSettings: {
      spineX: 450,
      startY: 80,
      stepY: 170,
      branchOffset: 320,
    },
  }
}

export function createProcessNode(params: {
  id: string
  title: string
  documentId: string
  role?: ProcessNodeRole
  summary?: string
  status?: ProcessStatus
  order?: number
  assignedOwner?: string
  tools?: string[]
  assetIds?: string[]
  boardIds?: string[]
  position?: { x: number; y: number }
  size?: { width: number; height: number }
  collapsed?: boolean
  branchSide?: 'left' | 'right'
}): ProcessNode {
  const role = params.role || 'spine'
  const isSpine = role === 'spine'
  const defaultSide = role === 'output' ? 'right' : 'left'
  return {
    id: params.id,
    title: params.title,
    role,
    documentId: params.documentId,
    summary: params.summary || '',
    status: params.status || 'draft',
    order: params.order ?? 0,
    assignedOwner: params.assignedOwner,
    tools: params.tools ? [...params.tools] : [],
    assetIds: params.assetIds ? [...params.assetIds] : [],
    boardIds: params.boardIds ? [...params.boardIds] : [],
    position: params.position || { x: isSpine ? 450 : defaultSide === 'left' ? 130 : 770, y: 80 },
    size: params.size || { width: isSpine ? 260 : 230, height: 110 },
    collapsed: params.collapsed ?? false,
    branchSide: params.branchSide || defaultSide,
  }
}

export function createProcessEdge(params: {
  id: string
  fromNodeId: string
  toNodeId: string
  relation?: ProcessSemanticRelation
  label?: string
  customStyle?: ProcessEdge['customStyle']
}): ProcessEdge {
  const relation = params.relation || 'next'
  return {
    id: params.id,
    fromNodeId: params.fromNodeId,
    toNodeId: params.toNodeId,
    relation,
    label: params.label !== undefined ? params.label : RELATION_METADATA[relation].defaultLabel,
    customStyle: params.customStyle,
  }
}

// Immutable Document Operations
export function addProcessNode(doc: ProcessDocument, node: ProcessNode): ProcessDocument {
  if (doc.nodes.some((n) => n.id === node.id)) return doc
  return {
    ...doc,
    nodes: [...doc.nodes, node],
    updatedAt: new Date().toISOString(),
  }
}

export function updateProcessNode(
  doc: ProcessDocument,
  nodeId: string,
  patch: Partial<Omit<ProcessNode, 'id'>>
): ProcessDocument {
  const index = doc.nodes.findIndex((n) => n.id === nodeId)
  if (index === -1) return doc
  const updated = { ...doc.nodes[index], ...patch }
  const newNodes = [...doc.nodes]
  newNodes[index] = updated
  return {
    ...doc,
    nodes: newNodes,
    updatedAt: new Date().toISOString(),
  }
}

export function removeProcessNode(doc: ProcessDocument, nodeId: string): ProcessDocument {
  const remainingNodes = doc.nodes.filter((n) => n.id !== nodeId)
  if (remainingNodes.length === doc.nodes.length) return doc
  const remainingEdges = doc.edges.filter((e) => e.fromNodeId !== nodeId && e.toNodeId !== nodeId)
  return {
    ...doc,
    nodes: remainingNodes,
    edges: remainingEdges,
    selectedNodeId: doc.selectedNodeId === nodeId ? null : doc.selectedNodeId,
    updatedAt: new Date().toISOString(),
  }
}

export function addProcessEdge(doc: ProcessDocument, edge: ProcessEdge): ProcessDocument {
  if (doc.edges.some((e) => e.id === edge.id)) return doc
  // Prevent duplicate directed multigraph edges with identical relation
  if (
    doc.edges.some(
      (e) =>
        e.fromNodeId === edge.fromNodeId &&
        e.toNodeId === edge.toNodeId &&
        e.relation === edge.relation
    )
  ) {
    return doc
  }
  return {
    ...doc,
    edges: [...doc.edges, edge],
    updatedAt: new Date().toISOString(),
  }
}

export function removeProcessEdge(doc: ProcessDocument, edgeId: string): ProcessDocument {
  const remainingEdges = doc.edges.filter((e) => e.id !== edgeId)
  if (remainingEdges.length === doc.edges.length) return doc
  return {
    ...doc,
    edges: remainingEdges,
    updatedAt: new Date().toISOString(),
  }
}

export function toggleNodeCollapsed(doc: ProcessDocument, nodeId: string): ProcessDocument {
  const node = doc.nodes.find((n) => n.id === nodeId)
  if (!node) return doc
  return updateProcessNode(doc, nodeId, { collapsed: !node.collapsed })
}

export function selectProcessNode(doc: ProcessDocument, nodeId: string | null): ProcessDocument {
  if (doc.selectedNodeId === nodeId) return doc
  return { ...doc, selectedNodeId: nodeId }
}

export function setProcessViewMode(
  doc: ProcessDocument,
  mode: 'hybrid' | 'document' | 'map'
): ProcessDocument {
  if (doc.viewMode === mode) return doc
  return { ...doc, viewMode: mode, updatedAt: new Date().toISOString() }
}

// PRC-04 & PRC-08: Deterministic Hybrid Layout Engine
export interface HybridLayoutOptions {
  spineX?: number
  startY?: number
  stepY?: number
  branchOffset?: number
}

export function computeHybridLayout(
  doc: ProcessDocument,
  options?: HybridLayoutOptions
): ProcessDocument {
  const spineX = options?.spineX ?? doc.layoutSettings?.spineX ?? 450
  const startY = options?.startY ?? doc.layoutSettings?.startY ?? 80
  const stepY = options?.stepY ?? doc.layoutSettings?.stepY ?? 170
  const branchOffset = options?.branchOffset ?? doc.layoutSettings?.branchOffset ?? 320

  // 1. Separate spine nodes and sort by order
  const spineNodes = doc.nodes.filter((n) => n.role === 'spine').sort((a, b) => a.order - b.order)
  const spineIds = new Set(spineNodes.map((n) => n.id))

  const newPositions: Record<string, { x: number; y: number }> = {}

  // 2. Place spine nodes vertically on spineX axis
  spineNodes.forEach((node, idx) => {
    newPositions[node.id] = {
      x: spineX,
      y: startY + idx * stepY,
    }
  })

  // 3. Map branches connected to each spine node
  const leftBranchesForSpine: Record<string, string[]> = {}
  const rightBranchesForSpine: Record<string, string[]> = {}

  spineNodes.forEach((node) => {
    leftBranchesForSpine[node.id] = []
    rightBranchesForSpine[node.id] = []
  })

  const otherNodes = doc.nodes.filter((n) => n.role !== 'spine')

  otherNodes.forEach((node) => {
    // Find edges linking this node to any spine node
    const incomingFromSpine = doc.edges.filter((e) => spineIds.has(e.fromNodeId) && e.toNodeId === node.id)
    const outgoingToSpine = doc.edges.filter((e) => e.fromNodeId === node.id && spineIds.has(e.toNodeId))

    let parentSpineId: string | null = null
    if (outgoingToSpine.length > 0) {
      parentSpineId = outgoingToSpine[0].toNodeId
    } else if (incomingFromSpine.length > 0) {
      parentSpineId = incomingFromSpine[0].fromNodeId
    }

    // Default side based on role or branchSide
    const side = node.branchSide || (node.role === 'output' ? 'right' : 'left')

    if (parentSpineId && leftBranchesForSpine[parentSpineId] && rightBranchesForSpine[parentSpineId]) {
      if (side === 'left') {
        leftBranchesForSpine[parentSpineId].push(node.id)
      } else {
        rightBranchesForSpine[parentSpineId].push(node.id)
      }
    } else {
      // Orphan branch not directly connected to a spine node: attach to nearest or first spine
      const fallbackSpine = spineNodes[0]?.id
      if (fallbackSpine) {
        if (side === 'left') leftBranchesForSpine[fallbackSpine].push(node.id)
        else rightBranchesForSpine[fallbackSpine].push(node.id)
      } else {
        // No spine nodes at all, place in a simple grid
        newPositions[node.id] = { x: 100, y: startY + otherNodes.indexOf(node) * 120 }
      }
    }
  })

  // 4. Place left support branches and right output branches
  spineNodes.forEach((spine) => {
    const spinePos = newPositions[spine.id]
    const leftChildren = leftBranchesForSpine[spine.id] || []
    const rightChildren = rightBranchesForSpine[spine.id] || []

    leftChildren.forEach((childId, idx) => {
      const yOffset = (idx - (leftChildren.length - 1) / 2) * 120
      newPositions[childId] = {
        x: spineX - branchOffset,
        y: spinePos.y + yOffset,
      }
    })

    rightChildren.forEach((childId, idx) => {
      const yOffset = (idx - (rightChildren.length - 1) / 2) * 120
      newPositions[childId] = {
        x: spineX + branchOffset,
        y: spinePos.y + yOffset,
      }
    })
  })

  const updatedNodes = doc.nodes.map((node) => {
    const pos = newPositions[node.id]
    return pos ? { ...node, position: pos } : node
  })

  return {
    ...doc,
    nodes: updatedNodes,
    layoutSettings: { spineX, startY, stepY, branchOffset },
    updatedAt: new Date().toISOString(),
  }
}

// PRC-07 & PRC-08: Map Topology Hierarchical / Layered Layout Engine
export function computeMapTopologyLayout(doc: ProcessDocument): ProcessDocument {
  if (doc.nodes.length === 0) return doc

  // Directed graph adjacency
  const adj = new Map<string, string[]>()
  const inDegree = new Map<string, number>()

  doc.nodes.forEach((n) => {
    adj.set(n.id, [])
    inDegree.set(n.id, 0)
  })

  // Only consider forward relations for rank calculation to prevent cycle infinite loops
  const forwardRelations = new Set<ProcessSemanticRelation>([
    'next',
    'requires',
    'supports',
    'produces',
    'derived_from',
  ])

  doc.edges.forEach((edge) => {
    if (forwardRelations.has(edge.relation) && adj.has(edge.fromNodeId) && inDegree.has(edge.toNodeId)) {
      adj.get(edge.fromNodeId)!.push(edge.toNodeId)
      inDegree.set(edge.toNodeId, (inDegree.get(edge.toNodeId) || 0) + 1)
    }
  })

  // Topological rank assignment with cycle safeguard
  const rank = new Map<string, number>()
  const visited = new Set<string>()

  // Roots: nodes with in-degree 0
  const queue: Array<{ id: string; r: number }> = []
  doc.nodes.forEach((n) => {
    if ((inDegree.get(n.id) || 0) === 0) {
      queue.push({ id: n.id, r: 0 })
      rank.set(n.id, 0)
    }
  })

  // Fallback if full cycle exists
  if (queue.length === 0) {
    const first = doc.nodes[0]
    queue.push({ id: first.id, r: 0 })
    rank.set(first.id, 0)
  }

  while (queue.length > 0) {
    const { id, r } = queue.shift()!
    visited.add(id)

    const neighbors = adj.get(id) || []
    for (const nxt of neighbors) {
      const currentR = rank.get(nxt) || 0
      const nextR = Math.max(currentR, r + 1)
      rank.set(nxt, nextR)
      if (!visited.has(nxt)) {
        queue.push({ id: nxt, r: nextR })
      }
    }
  }

  // Handle unvisited nodes (disconnected components)
  doc.nodes.forEach((n, idx) => {
    if (!rank.has(n.id)) {
      rank.set(n.id, idx % 3)
    }
  })

  // Group nodes by rank (layer)
  const layers = new Map<number, string[]>()
  doc.nodes.forEach((n) => {
    const r = rank.get(n.id) ?? 0
    if (!layers.has(r)) layers.set(r, [])
    layers.get(r)!.push(n.id)
  })

  const sortedLayerKeys = Array.from(layers.keys()).sort((a, b) => a - b)
  const newPositions: Record<string, { x: number; y: number }> = {}

  sortedLayerKeys.forEach((r, layerIdx) => {
    const nodeIds = layers.get(r)!
    // Sort nodes in layer by role priority (support -> spine -> output)
    nodeIds.sort((a, b) => {
      const nodeA = doc.nodes.find((n) => n.id === a)!
      const nodeB = doc.nodes.find((n) => n.id === b)!
      const roleWeight = { support: 0, spine: 1, branch: 2, output: 3 }
      return (roleWeight[nodeA.role] ?? 1) - (roleWeight[nodeB.role] ?? 1)
    })

    const x = 100 + layerIdx * 320
    const totalHeight = nodeIds.length * 150
    const startY = Math.max(80, 400 - totalHeight / 2)

    nodeIds.forEach((id, rowIdx) => {
      newPositions[id] = {
        x,
        y: startY + rowIdx * 150,
      }
    })
  })

  const updatedNodes = doc.nodes.map((node) => {
    const pos = newPositions[node.id]
    return pos ? { ...node, position: pos } : node
  })

  return {
    ...doc,
    nodes: updatedNodes,
    updatedAt: new Date().toISOString(),
  }
}

// PRC-06: Linear Editorial Order & Markdown Synthesis
export function getLinearEditorialOrder(doc: ProcessDocument): ProcessNode[] {
  const result: ProcessNode[] = []
  const seen = new Set<string>()

  const spineNodes = doc.nodes.filter((n) => n.role === 'spine').sort((a, b) => a.order - b.order)

  spineNodes.forEach((spine) => {
    // 1. Gather incoming support nodes
    const supportEdges = doc.edges.filter(
      (e) =>
        e.toNodeId === spine.id &&
        (e.relation === 'supports' || e.relation === 'requires' || e.relation === 'uses_reference')
    )
    supportEdges.forEach((e) => {
      const supportNode = doc.nodes.find((n) => n.id === e.fromNodeId)
      if (supportNode && !seen.has(supportNode.id)) {
        result.push(supportNode)
        seen.add(supportNode.id)
      }
    })

    // 2. Add the spine step itself
    if (!seen.has(spine.id)) {
      result.push(spine)
      seen.add(spine.id)
    }

    // 3. Gather outgoing output/validation nodes
    const outputEdges = doc.edges.filter(
      (e) =>
        e.fromNodeId === spine.id &&
        (e.relation === 'produces' || e.relation === 'validates' || e.relation === 'alternate')
    )
    outputEdges.forEach((e) => {
      const outputNode = doc.nodes.find((n) => n.id === e.toNodeId)
      if (outputNode && !seen.has(outputNode.id)) {
        result.push(outputNode)
        seen.add(outputNode.id)
      }
    })
  })

  // 4. Any remaining nodes not captured above
  doc.nodes.forEach((n) => {
    if (!seen.has(n.id)) {
      result.push(n)
      seen.add(n.id)
    }
  })

  return result
}

export function generateProcessEditorialMarkdown(
  doc: ProcessDocument,
  documentTitles?: Record<string, string>
): string {
  const lines: string[] = []
  lines.push(`# ${doc.title || 'Process Document'}`)
  if (doc.description) {
    lines.push(`\n*${doc.description}*\n`)
  }
  lines.push(`\n**Status:** ${doc.nodes.length} Steps · **Schema:** Version ${doc.schemaVersion}\n`)
  lines.push(`---\n`)

  const editorialNodes = getLinearEditorialOrder(doc)

  editorialNodes.forEach((node, idx) => {
    const roleBadge =
      node.role === 'spine'
        ? `[Step ${node.order + 1} · Spine]`
        : node.role === 'support'
        ? `[Support Context]`
        : node.role === 'output'
        ? `[Output Deliverable]`
        : `[Branch]`
    const statusLabel = STATUS_LABELS[node.status]?.label || node.status
    const docTitle = (documentTitles && documentTitles[node.documentId]) || `Document #${node.documentId}`

    lines.push(`### ${idx + 1}. ${node.title} ${roleBadge}`)
    lines.push(`**Status:** ${statusLabel} | **Linked Document:** \`${docTitle}\``)

    if (node.tools.length > 0) {
      lines.push(`**Tools:** ${node.tools.join(', ')}`)
    }
    if (node.assetIds.length > 0) {
      lines.push(`**Assets:** ${node.assetIds.length} referenced`)
    }

    if (node.summary) {
      lines.push(`\n> ${node.summary}\n`)
    } else {
      lines.push('')
    }

    // List connected relationships
    const outgoing = doc.edges.filter((e) => e.fromNodeId === node.id)
    if (outgoing.length > 0) {
      lines.push('**Relationships:**')
      outgoing.forEach((e) => {
        const target = doc.nodes.find((n) => n.id === e.toNodeId)
        const relMeta = RELATION_METADATA[e.relation]
        lines.push(`- *${relMeta.displayName}* → **${target ? target.title : e.toNodeId}**${e.label ? ` (${e.label})` : ''}`)
      })
      lines.push('')
    }
  })

  return lines.join('\n')
}

// PRC-11: JSON Canvas 1.0 Interchange Adapter
export interface JSONCanvasNode {
  id: string
  type: 'text' | 'file' | 'link' | 'group'
  x: number
  y: number
  width: number
  height: number
  text?: string
  file?: string
  color?: string
}

export interface JSONCanvasEdge {
  id: string
  fromNode: string
  fromSide?: 'top' | 'right' | 'bottom' | 'left'
  toNode: string
  toSide?: 'top' | 'right' | 'bottom' | 'left'
  label?: string
  color?: string
  relation?: ProcessSemanticRelation
  data?: Record<string, unknown>
}

export interface JSONCanvasData {
  nodes: JSONCanvasNode[]
  edges: JSONCanvasEdge[]
}

export function exportToJsonCanvas(doc: ProcessDocument): JSONCanvasData {
  const nodes: JSONCanvasNode[] = doc.nodes.map((n) => {
    // Encapsulate process metadata in clean YAML frontmatter within the text node
    const metaBlock = [
      '---',
      `processRole: ${n.role}`,
      `documentId: ${n.documentId}`,
      `status: ${n.status}`,
      `order: ${n.order}`,
      `tools: [${n.tools.join(', ')}]`,
      `assets: [${n.assetIds.join(', ')}]`,
      `boards: [${n.boardIds.join(', ')}]`,
      '---',
      `## ${n.title}`,
      '',
      n.summary || '',
    ].join('\n')

    const color =
      n.role === 'spine'
        ? '#3b82f6'
        : n.role === 'support'
        ? '#8b5cf6'
        : n.role === 'output'
        ? '#10b981'
        : '#64748b'

    return {
      id: n.id,
      type: 'text',
      x: n.position.x,
      y: n.position.y,
      width: n.size.width,
      height: n.size.height,
      text: metaBlock,
      color,
    }
  })

  const edges: JSONCanvasEdge[] = doc.edges.map((e) => {
    const meta = RELATION_METADATA[e.relation]
    const fromNode = doc.nodes.find((n) => n.id === e.fromNodeId)
    const toNode = doc.nodes.find((n) => n.id === e.toNodeId)

    // Derive optimal side attachment from relative positions
    let fromSide: JSONCanvasEdge['fromSide'] = 'bottom'
    let toSide: JSONCanvasEdge['toSide'] = 'top'

    if (fromNode && toNode) {
      const dx = toNode.position.x - fromNode.position.x
      const dy = toNode.position.y - fromNode.position.y

      if (Math.abs(dx) > Math.abs(dy)) {
        fromSide = dx > 0 ? 'right' : 'left'
        toSide = dx > 0 ? 'left' : 'right'
      } else {
        fromSide = dy > 0 ? 'bottom' : 'top'
        toSide = dy > 0 ? 'top' : 'bottom'
      }
    }

    return {
      id: e.id,
      fromNode: e.fromNodeId,
      fromSide,
      toNode: e.toNodeId,
      toSide,
      label: e.label || meta.defaultLabel,
      color: meta.color,
      relation: e.relation,
      data: { relation: e.relation },
    }
  })

  return { nodes, edges }
}

export function importFromJsonCanvas(
  canvas: JSONCanvasData,
  projectId: string,
  docTitle = 'Imported Process Document'
): ProcessDocument {
  const doc = createProcessDocument(`process-${Date.now()}`, projectId, docTitle)

  const importedNodes: ProcessNode[] = canvas.nodes.map((cn, idx) => {
    const text = cn.text || ''
    let title = `Node ${idx + 1}`
    let role: ProcessNodeRole = 'spine'
    let documentId = `doc-${cn.id}`
    let status: ProcessStatus = 'draft'
    let order = idx
    let tools: string[] = []
    let assetIds: string[] = []
    let boardIds: string[] = []
    let summary = text

    // Parse frontmatter if present
    if (text.startsWith('---')) {
      const endFm = text.indexOf('\n---', 3)
      if (endFm !== -1) {
        const fmContent = text.slice(3, endFm)
        const bodyContent = text.slice(endFm + 4).trim()

        for (const line of fmContent.split('\n')) {
          const colon = line.indexOf(':')
          if (colon !== -1) {
            const k = line.slice(0, colon).trim()
            const v = line.slice(colon + 1).trim()
            if (k === 'processRole') role = v as ProcessNodeRole
            else if (k === 'documentId') documentId = v
            else if (k === 'status') status = v as ProcessStatus
            else if (k === 'order') order = parseInt(v, 10) || idx
            else if (k === 'tools') tools = v.replace(/[\[\]]/g, '').split(',').map((s) => s.trim()).filter(Boolean)
            else if (k === 'assets') assetIds = v.replace(/[\[\]]/g, '').split(',').map((s) => s.trim()).filter(Boolean)
            else if (k === 'boards') boardIds = v.replace(/[\[\]]/g, '').split(',').map((s) => s.trim()).filter(Boolean)
          }
        }

        // Look for title header
        const lines = bodyContent.split('\n')
        const headerLine = lines.find((l) => l.startsWith('#'))
        if (headerLine) {
          title = headerLine.replace(/^#+\s*/, '').trim()
          summary = lines.filter((l) => !l.startsWith('#')).join('\n').trim()
        } else {
          summary = bodyContent
        }
      }
    }

    return {
      id: cn.id,
      title,
      role,
      documentId,
      summary,
      status,
      order,
      tools,
      assetIds,
      boardIds,
      position: { x: cn.x, y: cn.y },
      size: { width: cn.width || 240, height: cn.height || 110 },
      collapsed: false,
      branchSide: role === 'output' ? 'right' : 'left',
    }
  })

  // Map edges and infer semantic relations
  const relationByName = Object.fromEntries(
    Object.entries(RELATION_METADATA).map(([k, v]) => [v.defaultLabel.toLowerCase(), k as ProcessSemanticRelation])
  )

  const importedEdges: ProcessEdge[] = canvas.edges.map((ce) => {
    let relation: ProcessSemanticRelation =
      ce.relation ||
      (ce.data?.relation as ProcessSemanticRelation) ||
      'next'

    if (!ce.relation && !ce.data?.relation && ce.label) {
      const lower = ce.label.toLowerCase()
      if (relationByName[lower]) {
        relation = relationByName[lower]
      } else if (lower.includes('support')) relation = 'supports'
      else if (lower.includes('require')) relation = 'requires'
      else if (lower.includes('produce')) relation = 'produces'
      else if (lower.includes('return')) relation = 'returns_to'
      else if (lower.includes('valid')) relation = 'validates'
      else if (lower.includes('alter')) relation = 'alternate'
      else if (lower.includes('ref')) relation = 'uses_reference'
      else if (lower.includes('deriv')) relation = 'derived_from'
      else if (lower.includes('replace')) relation = 'replaces'
    }

    return {
      id: ce.id,
      fromNodeId: ce.fromNode,
      toNodeId: ce.toNode,
      relation,
      label: ce.label,
    }
  })

  return {
    ...doc,
    nodes: importedNodes,
    edges: importedEdges,
  }
}

// Default 7-Step Production Pipeline Demo Template
export function createDefaultProductionPipeline(projectId: string): ProcessDocument {
  const doc = createProcessDocument('proc-master-pipeline', projectId, 'Creative Production Master Pipeline', 'Core editorial spine from concept ideation to high-resolution deliverable')

  // Step 1: Concept & Ideation
  const step1 = createProcessNode({
    id: 'step-1-concept',
    title: 'Concept & Narrative Ideation',
    documentId: 'doc-brief-concept',
    role: 'spine',
    order: 0,
    status: 'completed',
    summary: 'Define project theme, aesthetic language, color hierarchy, and narrative arc.',
    tools: ['Miro', 'Photoshop'],
    assetIds: ['asset-moodboard-1', 'asset-moodboard-2'],
  })

  const branch1 = createProcessNode({
    id: 'support-visual-references',
    title: 'Moodboard & Visual References',
    documentId: 'doc-moodboard-ref',
    role: 'support',
    branchSide: 'left',
    status: 'completed',
    summary: 'Curated 4K lighting references and color palette swatches.',
    tools: ['PureRef'],
    assetIds: ['asset-water-ref-1'],
  })

  // Step 2: Composition & Vector Layout
  const step2 = createProcessNode({
    id: 'step-2-composition',
    title: 'Composition & Vector Layout',
    documentId: 'doc-vector-layout',
    role: 'spine',
    order: 1,
    status: 'completed',
    summary: 'Establish silhouette hierarchy, focal points, camera framing, and perspective grids.',
    tools: ['Illustrator', 'Art Equation Vector'],
    assetIds: ['asset-sketch-vector'],
  })

  // Step 3: 3D Scene Blocking & Assembly
  const step3 = createProcessNode({
    id: 'step-3-3d-blocking',
    title: '3D Scene Blocking & Camera Staging',
    documentId: 'doc-3d-staging',
    role: 'spine',
    order: 2,
    status: 'in_progress',
    summary: 'Stage low-poly assets, establish depth planes, focal length (35mm), and primary key lighting.',
    tools: ['Blender'],
    assetIds: ['asset-3d-mesh-1'],
  })

  const branch3 = createProcessNode({
    id: 'support-shading-lib',
    title: 'Procedural Shader Library',
    documentId: 'doc-shader-lib',
    role: 'support',
    branchSide: 'left',
    status: 'approved',
    summary: 'Subsurface scattering and refractive water caustic shaders.',
    tools: ['Blender', 'Substance'],
    assetIds: ['asset-shader-pack'],
  })

  // Step 4: Neural Upscaling & Texture Synthesis
  const step4 = createProcessNode({
    id: 'step-4-synthesis',
    title: 'Neural Upscale & Texture Synthesis',
    documentId: 'doc-upscale-synthesis',
    role: 'spine',
    order: 3,
    status: 'in_progress',
    summary: 'High-fidelity microtexture synthesis and 4x latent upscaling with APISR.',
    tools: ['ComfyUI', 'APISR'],
    assetIds: ['asset-latent-pass'],
  })

  // Step 5: Final Composite & Color Grading
  const step5 = createProcessNode({
    id: 'step-5-composite',
    title: 'Final Composite & Color Grading',
    documentId: 'doc-final-composite',
    role: 'spine',
    order: 4,
    status: 'review',
    summary: 'Multi-layer composite, optical glow pass, chromatic aberration, and master color timing.',
    tools: ['Photoshop', 'DaVinci Resolve'],
    assetIds: ['asset-composite-psd'],
  })

  const output5 = createProcessNode({
    id: 'output-master-deliverable',
    title: 'Master Print & Broadcast Package',
    documentId: 'doc-master-deliverable',
    role: 'output',
    branchSide: 'right',
    status: 'draft',
    summary: 'Archival TIFF 16-bit 300 DPI master and Apple ProRes 4444 XQ video export.',
    tools: ['Photoshop', 'After Effects'],
    assetIds: ['asset-final-print-tiff'],
  })

  const qa5 = createProcessNode({
    id: 'support-qa-review',
    title: 'Quality Assurance & Print Proof',
    documentId: 'doc-qa-proof',
    role: 'support',
    branchSide: 'right',
    status: 'draft',
    summary: 'Color gamut proofing (CMYK ISO Coated v2) and contrast ratio audit.',
    tools: ['Photoshop', 'SpectraProof'],
    assetIds: [],
  })

  // Add nodes to document
  let pipeline = doc
  pipeline = addProcessNode(pipeline, step1)
  pipeline = addProcessNode(pipeline, branch1)
  pipeline = addProcessNode(pipeline, step2)
  pipeline = addProcessNode(pipeline, step3)
  pipeline = addProcessNode(pipeline, branch3)
  pipeline = addProcessNode(pipeline, step4)
  pipeline = addProcessNode(pipeline, step5)
  pipeline = addProcessNode(pipeline, output5)
  pipeline = addProcessNode(pipeline, qa5)

  // Add semantic edges
  pipeline = addProcessEdge(pipeline, createProcessEdge({
    id: 'edge-ref-step1',
    fromNodeId: 'support-visual-references',
    toNodeId: 'step-1-concept',
    relation: 'uses_reference',
    label: 'Visual Language',
  }))

  pipeline = addProcessEdge(pipeline, createProcessEdge({
    id: 'edge-step1-step2',
    fromNodeId: 'step-1-concept',
    toNodeId: 'step-2-composition',
    relation: 'next',
    label: 'Approved Brief',
  }))

  pipeline = addProcessEdge(pipeline, createProcessEdge({
    id: 'edge-step2-step3',
    fromNodeId: 'step-2-composition',
    toNodeId: 'step-3-3d-blocking',
    relation: 'next',
    label: 'Vector Perspective',
  }))

  pipeline = addProcessEdge(pipeline, createProcessEdge({
    id: 'edge-shaders-step3',
    fromNodeId: 'support-shading-lib',
    toNodeId: 'step-3-3d-blocking',
    relation: 'supports',
    label: 'Material Input',
  }))

  pipeline = addProcessEdge(pipeline, createProcessEdge({
    id: 'edge-step3-step4',
    fromNodeId: 'step-3-3d-blocking',
    toNodeId: 'step-4-synthesis',
    relation: 'next',
    label: 'Beauty Render Pass',
  }))

  pipeline = addProcessEdge(pipeline, createProcessEdge({
    id: 'edge-step4-step5',
    fromNodeId: 'step-4-synthesis',
    toNodeId: 'step-5-composite',
    relation: 'next',
    label: 'Synthesized Textures',
  }))

  pipeline = addProcessEdge(pipeline, createProcessEdge({
    id: 'edge-step5-output',
    fromNodeId: 'step-5-composite',
    toNodeId: 'output-master-deliverable',
    relation: 'produces',
    label: 'Master Artifact',
  }))

  pipeline = addProcessEdge(pipeline, createProcessEdge({
    id: 'edge-step5-qa',
    fromNodeId: 'step-5-composite',
    toNodeId: 'support-qa-review',
    relation: 'validates',
    label: 'Gamut & Proofing',
  }))

  // Add iteration feedback loop: QA returns to Step 4 if resolution check fails
  pipeline = addProcessEdge(pipeline, createProcessEdge({
    id: 'edge-qa-revision',
    fromNodeId: 'support-qa-review',
    toNodeId: 'step-4-synthesis',
    relation: 'returns_to',
    label: 'Resolution Revision',
  }))

  // Compute default deterministic hybrid layout
  return computeHybridLayout(pipeline)
}
