import React, { useRef } from 'react'
import './MilanoteToolRail.css'

export type MilanoteToolRailProps = {
  interactionTool: string
  viewportTool: string
  shapeKind?: string
  viewOnly?: boolean
  onAddNote: () => void
  onAddLink: () => void
  onAddTodo: () => void
  onToggleLine: () => void
  onAddSubboard: () => void
  onAddColumn: () => void
  onAddComment: () => void
  onAddTable?: () => void
  onImportImage: () => void
  onImport3DModel: () => void
  onToggleDraw: () => void
  onOpenTrash: () => void
}

export function MilanoteToolRail({
  interactionTool,
  viewportTool: _viewportTool,
  shapeKind,
  viewOnly,
  onAddNote,
  onAddLink,
  onAddTodo,
  onToggleLine,
  onAddSubboard,
  onAddColumn,
  onAddComment,
  onAddTable,
  onImportImage,
  onImport3DModel,
  onToggleDraw,
  onOpenTrash,
}: MilanoteToolRailProps) {
  const railRef = useRef<HTMLElement>(null)

  const handleKeyDown = (event: React.KeyboardEvent<HTMLElement>) => {
    if (!['ArrowUp', 'ArrowDown', 'Home', 'End'].includes(event.key)) return
    const buttons = [...(railRef.current?.querySelectorAll<HTMLButtonElement>('button:not(:disabled)') || [])]
    const index = buttons.indexOf(document.activeElement as HTMLButtonElement)
    if (index < 0) return
    event.preventDefault()
    event.stopPropagation()
    const target =
      event.key === 'Home'
        ? buttons[0]
        : event.key === 'End'
        ? buttons[buttons.length - 1]
        : buttons[(index + (event.key === 'ArrowDown' ? 1 : -1) + buttons.length) % buttons.length]
    target?.focus()
  }

  const handleDragStart = (kind: string) => (event: React.DragEvent<HTMLButtonElement>) => {
    if (viewOnly) return
    event.dataTransfer.setData('text/plain', `milanote:${kind}`)
    event.dataTransfer.effectAllowed = 'copy'
  }

  const isLineActive = interactionTool === 'connect' || (interactionTool === 'draw' && shapeKind === 'line')
  const isDrawActive = interactionTool === 'pencil' || interactionTool === 'pen'

  return (
    <aside
      ref={railRef}
      className="canvas-tool-rail milanote-tool-rail"
      aria-label="Milanote creation tool rail"
      onKeyDown={handleKeyDown}
    >
      {/* Top drag/brand handle */}
      <div className="milanote-rail-header" aria-hidden="true" title="Milanote Tool Rail">
        <span className="milanote-rail-grip" />
      </div>

      <div className="milanote-tool-group" role="group" aria-label="Creation tools">
        {/* Note */}
        <button
          type="button"
          className="milanote-tool-btn"
          title="Note · Rich text note card (click or drag to canvas)"
          aria-label="Add note card"
          disabled={viewOnly}
          draggable={!viewOnly}
          onDragStart={handleDragStart('note')}
          onClick={onAddNote}
        >
          <svg viewBox="0 0 24 24" aria-hidden="true" className="milanote-icon">
            <path d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" strokeWidth="2" stroke="currentColor" fill="none" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
          <span className="milanote-label">Note</span>
        </button>

        {/* Link */}
        <button
          type="button"
          className="milanote-tool-btn"
          title="Link · Card linking to board or web address"
          aria-label="Add link card"
          disabled={viewOnly}
          draggable={!viewOnly}
          onDragStart={handleDragStart('link')}
          onClick={onAddLink}
        >
          <svg viewBox="0 0 24 24" aria-hidden="true" className="milanote-icon">
            <path d="M13.828 10.172a4 4 0 00-5.656 0l-4 4a4 4 0 105.656 5.656l1.102-1.101m-.758-4.899a4 4 0 005.656 0l4-4a4 4 0 00-5.656-5.656l-1.1 1.1" strokeWidth="2" stroke="currentColor" fill="none" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
          <span className="milanote-label">Link</span>
        </button>

        {/* To-do */}
        <button
          type="button"
          className="milanote-tool-btn"
          title="To-do · Checklist task card (click or drag to canvas)"
          aria-label="Add to-do list card"
          disabled={viewOnly}
          draggable={!viewOnly}
          onDragStart={handleDragStart('todo')}
          onClick={onAddTodo}
        >
          <svg viewBox="0 0 24 24" aria-hidden="true" className="milanote-icon">
            <path d="M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2m-6 9l2 2 4-4" strokeWidth="2" stroke="currentColor" fill="none" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
          <span className="milanote-label">To-do</span>
        </button>

        {/* Line / Connection */}
        <button
          type="button"
          className={`milanote-tool-btn ${isLineActive ? 'active' : ''}`}
          title="Line · Connect cards and draw lines"
          aria-label="Draw line connector"
          aria-pressed={isLineActive}
          disabled={viewOnly}
          onClick={onToggleLine}
        >
          <svg viewBox="0 0 24 24" aria-hidden="true" className="milanote-icon">
            <path d="M17 8l4 4m0 0l-4 4m4-4H3" strokeWidth="2" stroke="currentColor" fill="none" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
          <span className="milanote-label">Line</span>
        </button>

        {/* Board - Distinctive Milanote Royal Blue Rounded Square Badge */}
        <button
          type="button"
          className="milanote-tool-btn milanote-board-tool"
          title="Board · Create nested sub-board tile (click or drag to canvas)"
          aria-label="Add sub-board"
          disabled={viewOnly}
          draggable={!viewOnly}
          onDragStart={handleDragStart('board')}
          onClick={onAddSubboard}
        >
          <span className="milanote-board-badge" aria-hidden="true">
            <svg viewBox="0 0 24 24" className="milanote-icon">
              <path d="M3 7v10a2 2 0 002 2h14a2 2 0 002-2V9a2 2 0 00-2-2h-6l-2-2H5a2 2 0 00-2 2z" strokeWidth="2" stroke="currentColor" fill="none" strokeLinecap="round" strokeLinejoin="round" />
            </svg>
          </span>
          <span className="milanote-label">Board</span>
        </button>

        {/* Column */}
        <button
          type="button"
          className="milanote-tool-btn"
          title="Column · Add ordered vertical card stack (click or drag to canvas)"
          aria-label="Add card column"
          disabled={viewOnly}
          draggable={!viewOnly}
          onDragStart={handleDragStart('column')}
          onClick={onAddColumn}
        >
          <svg viewBox="0 0 24 24" aria-hidden="true" className="milanote-icon">
            <path d="M9 17V7m0 10a2 2 0 01-2 2H5a2 2 0 01-2-2V7a2 2 0 012-2h2a2 2 0 012 2m0 10a2 2 0 002 2h2a2 2 0 002-2V7a2 2 0 00-2-2h-2a2 2 0 00-2 2m0 10V7m0 10a2 2 0 002 2h2a2 2 0 002-2V7a2 2 0 00-2-2h-2a2 2 0 00-2 2" strokeWidth="2" stroke="currentColor" fill="none" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
          <span className="milanote-label">Column</span>
        </button>

        {/* Comment */}
        <button
          type="button"
          className="milanote-tool-btn"
          title="Comment · Add note or feedback"
          aria-label="Add comment card"
          disabled={viewOnly}
          draggable={!viewOnly}
          onDragStart={handleDragStart('comment')}
          onClick={onAddComment}
        >
          <svg viewBox="0 0 24 24" aria-hidden="true" className="milanote-icon">
            <path d="M8 12h.01M12 12h.01M16 12h.01M21 12c0 4.418-4.03 8-9 8a9.863 9.863 0 01-4.255-.949L3 20l1.395-3.72C3.512 15.042 3 13.574 3 12c0-4.418 4.03-8 9-8s9 3.582 9 8z" strokeWidth="2" stroke="currentColor" fill="none" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
          <span className="milanote-label">Comment</span>
        </button>

        {/* Table */}
        {onAddTable && (
          <button
            type="button"
            className="milanote-tool-btn"
            title="Table · Structured tabular data card"
            aria-label="Add table card"
            disabled={viewOnly}
            draggable={!viewOnly}
            onDragStart={handleDragStart('table')}
            onClick={onAddTable}
          >
            <svg viewBox="0 0 24 24" aria-hidden="true" className="milanote-icon">
              <path d="M3 10h18M3 14h18m-9-10v16M4 4h16a1 1 0 011 1v14a1 1 0 01-1 1H4a1 1 0 01-1-1V5a1 1 0 011-1z" strokeWidth="2" stroke="currentColor" fill="none" strokeLinecap="round" strokeLinejoin="round" />
            </svg>
            <span className="milanote-label">Table</span>
          </button>
        )}
      </div>

      <div className="milanote-tool-separator" role="separator" />

      {/* Media & 3D DCC tools */}
      <div className="milanote-tool-group" role="group" aria-label="Media and DCC tools">
        {/* Add Image */}
        <button
          type="button"
          className="milanote-tool-btn"
          title="Add Image · Insert picture or reference"
          aria-label="Add image card"
          disabled={viewOnly}
          draggable={!viewOnly}
          onDragStart={handleDragStart('image')}
          onClick={onImportImage}
        >
          <svg viewBox="0 0 24 24" aria-hidden="true" className="milanote-icon">
            <path d="M4 16l4.586-4.586a2 2 0 012.828 0L16 16m-2-2l1.586-1.586a2 2 0 012.828 0L20 14m-6-6h.01M6 20h12a2 2 0 002-2V6a2 2 0 00-2-2H6a2 2 0 00-2 2v12a2 2 0 002 2z" strokeWidth="2" stroke="currentColor" fill="none" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
          <span className="milanote-label">Add Image</span>
        </button>

        {/* 3D DCC Tool */}
        <button
          type="button"
          className="milanote-tool-btn milanote-dcc-btn"
          title="3D DCC · Orbitable 3D mesh viewer (GLB, GLTF, OBJ)"
          aria-label="Add 3D DCC object card"
          disabled={viewOnly}
          draggable={!viewOnly}
          onDragStart={handleDragStart('dcc')}
          onClick={onImport3DModel}
        >
          <svg viewBox="0 0 24 24" aria-hidden="true" className="milanote-icon">
            <path d="M20 7l-8-4-8 4m16 0l-8 4m8-4v10l-8 4m0-10L4 7m8 4v10M4 7v10l8 4" strokeWidth="2" stroke="currentColor" fill="none" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
          <span className="milanote-label">3D DCC</span>
        </button>

        {/* Draw Tool */}
        <button
          type="button"
          className={`milanote-tool-btn ${isDrawActive ? 'active' : ''}`}
          title="Draw · Vector drawing and sketching"
          aria-label="Toggle drawing tool"
          aria-pressed={isDrawActive}
          disabled={viewOnly}
          onClick={onToggleDraw}
        >
          <svg viewBox="0 0 24 24" aria-hidden="true" className="milanote-icon">
            <path d="M15.232 5.232l3.536 3.536m-2.036-5.036a2.5 2.5 0 113.536 3.536L6.5 21.036H3v-3.572L16.732 3.732z" strokeWidth="2" stroke="currentColor" fill="none" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
          <span className="milanote-label">Draw</span>
        </button>
      </div>

      {/* Bottom Trash Anchor */}
      <div className="milanote-tool-bottom">
        <button
          type="button"
          className="milanote-tool-btn milanote-trash-btn"
          title="Trash · Open deleted cards and restore archives"
          aria-label="Open trash and archives"
          onClick={onOpenTrash}
        >
          <svg viewBox="0 0 24 24" aria-hidden="true" className="milanote-icon">
            <path d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" strokeWidth="2" stroke="currentColor" fill="none" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
          <span className="milanote-label">Trash</span>
        </button>
      </div>
    </aside>
  )
}
