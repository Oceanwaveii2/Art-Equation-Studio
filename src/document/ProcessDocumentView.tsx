import React, { useState, useMemo, useRef, useCallback } from 'react'
import type {
  ProcessDocument,
  ProcessNode,
  ProcessSemanticRelation,
} from '../model/processDocument'
import {
  RELATION_METADATA,
  STATUS_LABELS,
  computeHybridLayout,
  computeMapTopologyLayout,
  getLinearEditorialOrder,
  exportToJsonCanvas,
  importFromJsonCanvas,
  addProcessNode,
  removeProcessNode,
  addProcessEdge,
  toggleNodeCollapsed,
  createProcessNode,
  createProcessEdge,
  setProcessViewMode,
  selectProcessNode,
} from '../model/processDocument'
import type { ProjectDocument, ProjectAsset } from '../model/project'
import './processDocument.css'

export interface ProcessDocumentViewProps {
  document: ProcessDocument
  onUpdateDocument: (doc: ProcessDocument) => void
  onOpenDocument: (documentId: string) => void
  readOnly?: boolean
  projectDocuments?: ProjectDocument[]
  projectAssets?: ProjectAsset[]
}

export const ProcessDocumentView: React.FC<ProcessDocumentViewProps> = ({
  document: doc,
  onUpdateDocument,
  onOpenDocument,
  readOnly = false,
  projectDocuments = [],
  projectAssets = [],
}) => {
  const [selectedNodeId, setSelectedNodeId] = useState<string | null>(doc.selectedNodeId)
  const fileInputRef = useRef<HTMLInputElement>(null)

  const viewMode = doc.viewMode || 'hybrid'

  // Look up document titles
  const docTitles = useMemo(() => {
    const map: Record<string, string> = {}
    projectDocuments.forEach((d) => {
      map[d.id] = d.title
    })
    return map
  }, [projectDocuments])

  // Look up asset details (PRC-09)
  const assetMap = useMemo(() => {
    const map = new Map<string, ProjectAsset>()
    projectAssets.forEach((a) => map.set(a.id, a))
    return map
  }, [projectAssets])

  const selectedNode = useMemo(() => {
    return doc.nodes.find((n) => n.id === selectedNodeId) || null
  }, [doc.nodes, selectedNodeId])

  // Handle Mode Change
  const handleSetMode = (mode: 'hybrid' | 'document' | 'map') => {
    onUpdateDocument(setProcessViewMode(doc, mode))
  }

  // Handle Selection
  const handleSelectNode = (id: string | null) => {
    setSelectedNodeId(id)
    onUpdateDocument(selectProcessNode(doc, id))
  }

  // Auto-Layout trigger (PRC-08)
  const handleAutoLayout = () => {
    if (viewMode === 'map') {
      onUpdateDocument(computeMapTopologyLayout(doc))
    } else {
      onUpdateDocument(computeHybridLayout(doc))
    }
  }

  // Add Spine Step
  const handleAddSpineStep = () => {
    if (readOnly) return
    const spineNodes = doc.nodes.filter((n) => n.role === 'spine')
    const nextOrder = spineNodes.length
    const newNodeId = `step-${Date.now().toString(36)}`
    const newDocId = `doc-${newNodeId}`

    const newNode = createProcessNode({
      id: newNodeId,
      title: `Step ${nextOrder + 1}: New Milestone`,
      documentId: newDocId,
      role: 'spine',
      order: nextOrder,
      status: 'draft',
      summary: 'Define deliverables, constraints, and instructions for this production phase.',
    })

    let updated = addProcessNode(doc, newNode)

    // Connect sequentially from previous spine step if exists
    if (spineNodes.length > 0) {
      const prevSpine = spineNodes[spineNodes.length - 1]
      updated = addProcessEdge(
        updated,
        createProcessEdge({
          id: `edge-${prevSpine.id}-${newNode.id}`,
          fromNodeId: prevSpine.id,
          toNodeId: newNode.id,
          relation: 'next',
        })
      )
    }

    onUpdateDocument(computeHybridLayout(updated))
    handleSelectNode(newNodeId)
  }

  // Add Branch Node (Support or Output)
  const handleAddBranch = (role: 'support' | 'output') => {
    if (readOnly) return
    const targetSpine = selectedNode?.role === 'spine' ? selectedNode : doc.nodes.find((n) => n.role === 'spine')
    if (!targetSpine) {
      handleAddSpineStep()
      return
    }

    const newNodeId = `${role}-${Date.now().toString(36)}`
    const newDocId = `doc-${newNodeId}`
    const isOutput = role === 'output'

    const newNode = createProcessNode({
      id: newNodeId,
      title: isOutput ? 'Output Deliverable' : 'Supporting Reference',
      documentId: newDocId,
      role,
      branchSide: isOutput ? 'right' : 'left',
      status: 'draft',
      summary: isOutput
        ? 'Exported deliverable, master file, or intermediate production artifact.'
        : 'Background context, style references, research notes, or input data.',
    })

    let updated = addProcessNode(doc, newNode)

    // Link edge to target spine
    const relation: ProcessSemanticRelation = isOutput ? 'produces' : 'supports'
    const edge = createProcessEdge({
      id: `edge-${isOutput ? targetSpine.id : newNode.id}-${isOutput ? newNode.id : targetSpine.id}`,
      fromNodeId: isOutput ? targetSpine.id : newNode.id,
      toNodeId: isOutput ? newNode.id : targetSpine.id,
      relation,
    })

    updated = addProcessEdge(updated, edge)
    onUpdateDocument(computeHybridLayout(updated))
    handleSelectNode(newNodeId)
  }

  // Toggle Collapse
  const handleToggleCollapse = (nodeId: string, e: React.MouseEvent) => {
    e.stopPropagation()
    onUpdateDocument(toggleNodeCollapsed(doc, nodeId))
  }

  // Delete Selected Node
  const handleDeleteSelected = () => {
    if (readOnly || !selectedNodeId) return
    onUpdateDocument(removeProcessNode(doc, selectedNodeId))
    setSelectedNodeId(null)
  }

  // Export JSON Canvas 1.0 (PRC-11)
  const handleExportJsonCanvas = () => {
    const canvasData = exportToJsonCanvas(doc)
    const jsonStr = JSON.stringify(canvasData, null, 2)
    const blob = new Blob([jsonStr], { type: 'application/json' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = `${doc.title.toLowerCase().replace(/[^a-z0-9]+/g, '-')}.canvas`
    a.click()
    URL.revokeObjectURL(url)
  }

  // Import JSON Canvas 1.0 (PRC-11)
  const handleImportFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    if (!file) return
    const reader = new FileReader()
    reader.onload = (event) => {
      try {
        const text = event.target?.result as string
        const parsed = JSON.parse(text)
        if (parsed.nodes && Array.isArray(parsed.nodes)) {
          const imported = importFromJsonCanvas(parsed, doc.projectId, `${doc.title} (Imported)`)
          onUpdateDocument(computeHybridLayout(imported))
        }
      } catch (err) {
        console.error('Failed to import JSON Canvas file:', err)
      }
    }
    reader.readAsText(file)
  }

  // Keyboard Navigation (PRC-10)
  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      if (!selectedNodeId) {
        if (e.key === 'ArrowDown' || e.key === 'ArrowRight') {
          const first = doc.nodes[0]
          if (first) handleSelectNode(first.id)
        }
        return
      }

      const spineNodes = doc.nodes.filter((n) => n.role === 'spine').sort((a, b) => a.order - b.order)
      const current = doc.nodes.find((n) => n.id === selectedNodeId)
      if (!current) return

      if (e.key === 'ArrowDown') {
        e.preventDefault()
        if (current.role === 'spine') {
          const idx = spineNodes.findIndex((n) => n.id === current.id)
          if (idx < spineNodes.length - 1) handleSelectNode(spineNodes[idx + 1].id)
        }
      } else if (e.key === 'ArrowUp') {
        e.preventDefault()
        if (current.role === 'spine') {
          const idx = spineNodes.findIndex((n) => n.id === current.id)
          if (idx > 0) handleSelectNode(spineNodes[idx - 1].id)
        }
      } else if (e.key === 'Enter') {
        e.preventDefault()
        onOpenDocument(current.documentId)
      } else if (e.key === ' ' && !e.repeat) {
        e.preventDefault()
        onUpdateDocument(toggleNodeCollapsed(doc, current.id))
      } else if (e.key === 'Delete' || e.key === 'Backspace') {
        if (!readOnly) {
          e.preventDefault()
          handleDeleteSelected()
        }
      }
    },
    [doc, selectedNodeId, readOnly, onOpenDocument, onUpdateDocument]
  )

  // Derived Geometry for Hybrid Connectors
  const hybridConnectors = useMemo(() => {
    const spineNodes = doc.nodes.filter((n) => n.role === 'spine').sort((a, b) => a.order - b.order)
    const nodeMap = new Map<string, ProcessNode>(doc.nodes.map((n) => [n.id, n]))

    // Central spine line from first to last spine node
    let spineLine: { x: number; y1: number; y2: number } | null = null
    if (spineNodes.length > 1) {
      const first = spineNodes[0]
      const last = spineNodes[spineNodes.length - 1]
      spineLine = {
        x: first.position.x + first.size.width / 2,
        y1: first.position.y + first.size.height,
        y2: last.position.y,
      }
    }

    // Branch connection lines
    const lines: Array<{
      id: string
      path: string
      color: string
      dashArray: string
      arrowEnd: boolean
      relation: ProcessSemanticRelation
    }> = []

    doc.edges.forEach((edge) => {
      const from = nodeMap.get(edge.fromNodeId)
      const to = nodeMap.get(edge.toNodeId)
      if (!from || !to) return

      const meta = RELATION_METADATA[edge.relation]

      // Determine attachment points
      let startX = from.position.x + from.size.width / 2
      let startY = from.position.y + from.size.height / 2
      let endX = to.position.x + to.size.width / 2
      let endY = to.position.y + to.size.height / 2

      // Orthogonal elbow routing
      if (from.role === 'spine' && to.role !== 'spine') {
        // Spine to Branch
        startX = to.position.x > from.position.x ? from.position.x + from.size.width : from.position.x
        startY = from.position.y + from.size.height / 2
        endX = to.position.x > from.position.x ? to.position.x : to.position.x + to.size.width
        endY = to.position.y + to.size.height / 2
      } else if (from.role !== 'spine' && to.role === 'spine') {
        // Branch to Spine
        startX = from.position.x > to.position.x ? from.position.x : from.position.x + from.size.width
        startY = from.position.y + from.size.height / 2
        endX = from.position.x > to.position.x ? to.position.x + to.size.width : to.position.x
        endY = to.position.y + to.size.height / 2
      } else if (from.role === 'spine' && to.role === 'spine') {
        // Spine sequential progression
        startX = from.position.x + from.size.width / 2
        startY = from.position.y + from.size.height
        endX = to.position.x + to.size.width / 2
        endY = to.position.y
      }

      // Generate SVG path: smooth cubic bezier
      const midX = (startX + endX) / 2
      const path = `M ${startX} ${startY} C ${midX} ${startY}, ${midX} ${endY}, ${endX} ${endY}`

      lines.push({
        id: edge.id,
        path,
        color: edge.customStyle?.stroke || meta.color,
        dashArray: edge.customStyle?.dashArray || meta.dashArray,
        arrowEnd: meta.arrowEnd,
        relation: edge.relation,
      })
    })

    return { spineLine, lines }
  }, [doc.nodes, doc.edges])

  // Linear Editorial Flow for Document View (PRC-06)
  const editorialNodes = useMemo(() => {
    return getLinearEditorialOrder(doc)
  }, [doc])

  return (
    <div
      className="process-document-container"
      tabIndex={0}
      onKeyDown={handleKeyDown}
      role="region"
      aria-label="Process Document Studio"
    >
      {/* Header Bar */}
      <header className="process-document-header">
        <div className="process-header-title-group">
          <h2 className="process-header-title">{doc.title}</h2>
          <span className="process-kind-badge">
            {viewMode === 'hybrid' ? 'Hybrid Spine' : viewMode === 'document' ? 'Editorial Doc' : 'Map Topology'}
          </span>
          <span style={{ fontSize: 11, color: '#64748b' }}>
            {doc.nodes.length} nodes · {doc.edges.length} relationships
          </span>
        </div>

        {/* View Mode Switcher */}
        <div className="process-view-mode-tabs" role="tablist">
          <button
            type="button"
            role="tab"
            aria-selected={viewMode === 'hybrid'}
            className={`process-view-tab ${viewMode === 'hybrid' ? 'active' : ''}`}
            onClick={() => handleSetMode('hybrid')}
          >
            Hybrid View
          </button>
          <button
            type="button"
            role="tab"
            aria-selected={viewMode === 'document'}
            className={`process-view-tab ${viewMode === 'document' ? 'active' : ''}`}
            onClick={() => handleSetMode('document')}
          >
            Document View
          </button>
          <button
            type="button"
            role="tab"
            aria-selected={viewMode === 'map'}
            className={`process-view-tab ${viewMode === 'map' ? 'active' : ''}`}
            onClick={() => handleSetMode('map')}
          >
            Map View
          </button>
        </div>

        {/* Action Controls */}
        <div className="process-header-actions">
          <button
            type="button"
            className="process-action-btn"
            onClick={handleAutoLayout}
            title="Auto-organize layout deterministically"
          >
            Auto-Layout
          </button>
          {!readOnly && (
            <>
              <button
                type="button"
                className="process-action-btn primary"
                onClick={handleAddSpineStep}
                title="Add a new milestone step along the production spine"
              >
                + Step
              </button>
              <button
                type="button"
                className="process-action-btn"
                onClick={() => handleAddBranch('support')}
                title="Add a supporting research / reference branch"
              >
                + Support
              </button>
              <button
                type="button"
                className="process-action-btn"
                onClick={() => handleAddBranch('output')}
                title="Add an output deliverable artifact branch"
              >
                + Output
              </button>
            </>
          )}
          <button
            type="button"
            className="process-action-btn"
            onClick={handleExportJsonCanvas}
            title="Export as JSON Canvas 1.0 (.canvas)"
          >
            Export Canvas
          </button>
          {!readOnly && (
            <>
              <button
                type="button"
                className="process-action-btn"
                onClick={() => fileInputRef.current?.click()}
                title="Import JSON Canvas 1.0 file"
              >
                Import Canvas
              </button>
              <input
                ref={fileInputRef}
                type="file"
                accept=".canvas,.json"
                style={{ display: 'none' }}
                onChange={handleImportFileChange}
              />
            </>
          )}
        </div>
      </header>

      {/* Main View Area */}
      {viewMode === 'hybrid' && (
        <main className="process-hybrid-viewport">
          <div className="process-hybrid-canvas">
            {/* SVG Connecting Rails & Elbows */}
            <svg className="process-hybrid-svg-layer">
              <defs>
                {Object.entries(RELATION_METADATA).map(([rel, meta]) => (
                  <marker
                    key={rel}
                    id={`arrow-${rel}`}
                    viewBox="0 0 10 10"
                    refX="9"
                    refY="5"
                    markerWidth="6"
                    markerHeight="6"
                    orient="auto-start-reverse"
                  >
                    <path d="M 0 1 L 10 5 L 0 9 z" fill={meta.color} />
                  </marker>
                ))}
              </defs>

              {/* Vertical Spine Backbone */}
              {hybridConnectors.spineLine && (
                <line
                  className="process-spine-backbone"
                  x1={hybridConnectors.spineLine.x}
                  y1={hybridConnectors.spineLine.y1}
                  x2={hybridConnectors.spineLine.x}
                  y2={hybridConnectors.spineLine.y2}
                />
              )}

              {/* Branch Connecting Arms */}
              {hybridConnectors.lines.map((l) => (
                <path
                  key={l.id}
                  className="process-hybrid-connector-line"
                  d={l.path}
                  stroke={l.color}
                  strokeDasharray={l.dashArray === 'none' ? undefined : l.dashArray}
                  markerEnd={l.arrowEnd ? `url(#arrow-${l.relation})` : undefined}
                />
              ))}
            </svg>

            {/* Process Node Cards */}
            {doc.nodes.map((node) => {
              const isSelected = node.id === selectedNodeId
              const statusCfg = STATUS_LABELS[node.status] || STATUS_LABELS.draft
              const docTitle = docTitles[node.documentId] || `Document #${node.documentId}`

              return (
                <article
                  key={node.id}
                  className={`process-node-card role-${node.role} ${isSelected ? 'selected' : ''}`}
                  style={{
                    left: `${node.position.x}px`,
                    top: `${node.position.y}px`,
                    width: `${node.size.width}px`,
                    minHeight: node.collapsed ? 'auto' : `${node.size.height}px`,
                  }}
                  onClick={() => handleSelectNode(node.id)}
                  tabIndex={0}
                  aria-selected={isSelected}
                >
                  {/* Card Header */}
                  <div className="process-card-header">
                    <div className="process-card-badges">
                      {node.role === 'spine' && (
                        <span className="process-order-tag">{node.order + 1}</span>
                      )}
                      <span className={`process-role-pill ${node.role}`}>{node.role}</span>
                      <span
                        className="process-status-pill"
                        style={{ color: statusCfg.color, background: statusCfg.bg }}
                      >
                        {statusCfg.label}
                      </span>
                    </div>

                    <div className="process-card-controls">
                      <button
                        type="button"
                        className="process-card-toggle-btn"
                        onClick={(e) => handleToggleCollapse(node.id, e)}
                        title={node.collapsed ? 'Expand details' : 'Collapse details'}
                        aria-expanded={!node.collapsed}
                      >
                        {node.collapsed ? '▼' : '▲'}
                      </button>
                    </div>
                  </div>

                  {/* Title */}
                  <h3 className="process-card-title">{node.title}</h3>

                  {/* Collapsible Body */}
                  {!node.collapsed && (
                    <>
                      {node.summary && (
                        <p className="process-card-summary" title={node.summary}>
                          {node.summary}
                        </p>
                      )}

                      {/* Card Footer (Tools, Assets & Open Document Link) */}
                      <footer className="process-card-footer">
                        <div className="process-card-tools">
                          {node.tools.slice(0, 2).map((tool) => (
                            <span key={tool} className="process-tool-chip">
                              {tool}
                            </span>
                          ))}
                          {node.assetIds.length > 0 && (
                            <span
                              className="process-asset-counter"
                              title={node.assetIds.map((id) => assetMap.get(id)?.displayName || id).join(', ')}
                            >
                              📎 {node.assetIds.length}
                            </span>
                          )}
                        </div>

                        <button
                          type="button"
                          className="process-open-doc-btn"
                          onClick={(e) => {
                            e.stopPropagation()
                            onOpenDocument(node.documentId)
                          }}
                          title={`Open canonical document: ${docTitle}`}
                        >
                          Open Doc →
                        </button>
                      </footer>
                    </>
                  )}
                </article>
              )
            })}
          </div>
        </main>
      )}

      {/* Document View: Linear Editorial Flow (PRC-06) */}
      {viewMode === 'document' && (
        <main className="process-document-editorial-viewport">
          <article className="process-editorial-paper">
            <header className="process-editorial-header">
              <h1 className="process-editorial-title">{doc.title}</h1>
              {doc.description && <p className="process-editorial-desc">{doc.description}</p>}
              <div className="process-editorial-meta">
                <span>{editorialNodes.length} Structured Nodes</span>
                <span>{doc.edges.length} Semantic Connections</span>
                <span>Updated: {new Date(doc.updatedAt).toLocaleDateString()}</span>
              </div>
            </header>

            <section className="process-editorial-body">
              {editorialNodes.map((node, index) => {
                const statusCfg = STATUS_LABELS[node.status] || STATUS_LABELS.draft
                const docTitle = docTitles[node.documentId] || `Document #${node.documentId}`
                const outgoing = doc.edges.filter((e) => e.fromNodeId === node.id)

                return (
                  <div key={node.id} className={`process-editorial-section ${node.role}`}>
                    <div className="process-editorial-node-marker" />
                    <div className="process-editorial-node-title-row">
                      <h3 className="process-editorial-node-title">
                        {node.role === 'spine' ? `${node.order + 1}. ` : `${index + 1}. `}
                        {node.title}
                      </h3>
                      <div style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
                        <span className={`process-role-pill ${node.role}`}>{node.role}</span>
                        <span
                          className="process-status-pill"
                          style={{ color: statusCfg.color, background: statusCfg.bg }}
                        >
                          {statusCfg.label}
                        </span>
                      </div>
                    </div>

                    {node.tools.length > 0 && (
                      <div style={{ display: 'flex', gap: 6, marginBottom: 8 }}>
                        <span style={{ fontSize: 11, color: '#64748b' }}>Tools:</span>
                        {node.tools.map((t) => (
                          <span key={t} className="process-tool-chip">
                            {t}
                          </span>
                        ))}
                      </div>
                    )}

                    {node.summary && <div className="process-editorial-summary">{node.summary}</div>}

                    {outgoing.length > 0 && (
                      <div style={{ fontSize: 11.5, color: '#94a3b8', margin: '8px 0' }}>
                        <strong style={{ color: '#cbd5e1' }}>Direct Relationships: </strong>
                        {outgoing.map((e, idx) => {
                          const target = doc.nodes.find((n) => n.id === e.toNodeId)
                          const meta = RELATION_METADATA[e.relation]
                          return (
                            <span key={e.id}>
                              {idx > 0 && ' · '}
                              <span style={{ color: meta.color }}>{meta.displayName}</span> →{' '}
                              <strong>{target ? target.title : e.toNodeId}</strong>
                            </span>
                          )
                        })}
                      </div>
                    )}

                    <button
                      type="button"
                      className="process-editorial-doc-link"
                      onClick={() => onOpenDocument(node.documentId)}
                    >
                      📄 Open Canonical Document: {docTitle}
                    </button>
                  </div>
                )
              })}
            </section>
          </article>
        </main>
      )}

      {/* Map View: Topology Graph (PRC-07) */}
      {viewMode === 'map' && (
        <main className="process-map-viewport">
          <div className="process-map-canvas">
            <svg className="process-map-svg-layer">
              <defs>
                {Object.entries(RELATION_METADATA).map(([rel, meta]) => (
                  <marker
                    key={rel}
                    id={`map-arrow-${rel}`}
                    viewBox="0 0 10 10"
                    refX="9"
                    refY="5"
                    markerWidth="7"
                    markerHeight="7"
                    orient="auto-start-reverse"
                  >
                    <path d="M 0 1 L 10 5 L 0 9 z" fill={meta.color} />
                  </marker>
                ))}
              </defs>

              {doc.edges.map((edge) => {
                const from = doc.nodes.find((n) => n.id === edge.fromNodeId)
                const to = doc.nodes.find((n) => n.id === edge.toNodeId)
                if (!from || !to) return null

                const meta = RELATION_METADATA[edge.relation]
                const startX = from.position.x + from.size.width / 2
                const startY = from.position.y + from.size.height / 2
                const endX = to.position.x + to.size.width / 2
                const endY = to.position.y + to.size.height / 2

                const midX = (startX + endX) / 2
                const midY = (startY + endY) / 2

                const path = `M ${startX} ${startY} Q ${midX} ${midY - 20}, ${endX} ${endY}`

                return (
                  <g key={edge.id}>
                    <path
                      className="process-map-edge"
                      d={path}
                      stroke={meta.color}
                      strokeDasharray={meta.dashArray === 'none' ? undefined : meta.dashArray}
                      markerEnd={meta.arrowEnd ? `url(#map-arrow-${edge.relation})` : undefined}
                    />
                    {edge.label && (
                      <g transform={`translate(${midX}, ${midY - 10})`}>
                        <rect
                          className="process-map-edge-label-bg"
                          x={-edge.label.length * 3.5 - 6}
                          y={-10}
                          width={edge.label.length * 7 + 12}
                          height={20}
                        />
                        <text className="process-map-edge-label">{edge.label}</text>
                      </g>
                    )}
                  </g>
                )
              })}
            </svg>

            {doc.nodes.map((node) => {
              const isSelected = node.id === selectedNodeId
              const statusCfg = STATUS_LABELS[node.status] || STATUS_LABELS.draft
              return (
                <div
                  key={node.id}
                  className={`process-node-card role-${node.role} ${isSelected ? 'selected' : ''}`}
                  style={{
                    left: `${node.position.x}px`,
                    top: `${node.position.y}px`,
                    width: `${node.size.width}px`,
                  }}
                  onClick={() => handleSelectNode(node.id)}
                >
                  <div className="process-card-header">
                    <span className={`process-role-pill ${node.role}`}>{node.role}</span>
                    <span
                      className="process-status-pill"
                      style={{ color: statusCfg.color, background: statusCfg.bg }}
                    >
                      {statusCfg.label}
                    </span>
                  </div>
                  <h4 className="process-card-title">{node.title}</h4>
                  <p className="process-card-summary">{node.summary}</p>
                  <footer className="process-card-footer">
                    <span style={{ fontSize: 10, color: '#64748b' }}>
                      {node.tools.join(', ') || 'No tools'}
                    </span>
                    <button
                      type="button"
                      className="process-open-doc-btn"
                      onClick={(e) => {
                        e.stopPropagation()
                        onOpenDocument(node.documentId)
                      }}
                    >
                      Open →
                    </button>
                  </footer>
                </div>
              )
            })}
          </div>
        </main>
      )}
    </div>
  )
}
export default ProcessDocumentView
