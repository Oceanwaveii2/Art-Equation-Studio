import { useEffect } from 'react'
import { observeCanvasPerformance } from './canvasPerformance'
import type { CSSProperties, MouseEvent, PointerEvent } from 'react'
import type { BoardModel, BoardNode, ShapeType } from '../model/project'
import { vectorEditorControls } from '../model/vectorEditing'

export type ResizeHandle = 'nw' | 'n' | 'ne' | 'e' | 'se' | 's' | 'sw' | 'w'
export const RESIZE_HANDLES: ResizeHandle[] = ['nw', 'n', 'ne', 'e', 'se', 's', 'sw', 'w']
export type LiveShapeAnchor = 'nw' | 'ne' | 'se' | 'sw' | 'n' | 'e' | 's' | 'w'

export function isLiveShapeDirectSelectable(node: BoardNode) {
  return node.kind === 'shape' && (node.shapeType === 'rectangle' || node.shapeType === 'ellipse') && !node.vectorPath
}

export function liveShapeAnchors(shapeType: ShapeType | undefined): LiveShapeAnchor[] {
  return shapeType === 'ellipse' ? ['n', 'e', 's', 'w'] : ['nw', 'ne', 'se', 'sw']
}

export type CanvasInteractionOverlayProps = {
  board: BoardModel
  selectedIds: readonly string[]
  selectedNode?: BoardNode
  visibleNodes: readonly BoardNode[]
  interactionTool: string
  directPolicy: { nodeId?: string }
  selectedVectorAnchorIndexes: readonly number[]
  marqueePreviewAnchors: readonly number[]
  rotationReadout: number | null
  cornerRadiusReadout: number | null
  viewOnly: boolean
  fisheyeScale: (node: BoardNode) => number
  nodeTitle: (node: BoardNode) => string
  stageRef: React.RefObject<HTMLDivElement | null>
  startNodeDrag: (event: PointerEvent, node: BoardNode) => void
  startNodeResize: (event: PointerEvent<HTMLButtonElement> | MouseEvent<HTMLButtonElement>, node: BoardNode, handle: ResizeHandle) => void
  startNodeRotate: (event: PointerEvent<HTMLButtonElement> | MouseEvent<HTMLButtonElement>, node: BoardNode) => void
  startNodeRadius: (event: PointerEvent<HTMLButtonElement> | MouseEvent<HTMLButtonElement>, node: BoardNode) => void
  startLiveShapeAnchorDrag: (event: PointerEvent<HTMLButtonElement>, node: BoardNode, anchor: LiveShapeAnchor) => void
  startVectorControlDrag: (event: PointerEvent<HTMLButtonElement>, node: BoardNode, index: number, part: 'anchor' | 'in' | 'out') => void
  addCurveHandles: (node: BoardNode, index: number) => void
  setSelectedVectorPoint: (point: { nodeId: string; index: number } | null) => void
  setSelectedVectorAnchorIndexes: (indexes: number[] | ((current: number[]) => number[])) => void
  toggleColumn: (column: BoardNode) => void
}

/**
 * Screen-Space Transient Interaction Overlay
 * Centralizes all selection bounding boxes, Bézier anchor/tangent handles,
 * live shape direct-select controls, and column controls in a dedicated
 * interaction layer positioned above the canvas stage.
 */
export function CanvasInteractionOverlay({
  board,
  selectedIds,
  selectedNode,
  visibleNodes,
  interactionTool,
  directPolicy,
  selectedVectorAnchorIndexes,
  marqueePreviewAnchors,
  rotationReadout,
  cornerRadiusReadout,
  viewOnly,
  fisheyeScale,
  nodeTitle,
  stageRef,
  startNodeDrag,
  startNodeResize,
  startNodeRotate,
  startNodeRadius,
  startLiveShapeAnchorDrag,
  startVectorControlDrag,
  addCurveHandles,
  setSelectedVectorPoint,
  setSelectedVectorAnchorIndexes,
  toggleColumn,
}: CanvasInteractionOverlayProps) {
  useEffect(() => stageRef.current ? observeCanvasPerformance(stageRef.current) : undefined, [stageRef, board.id])
  return (
    <div className="canvas-interaction-overlay" data-canvas-paint-chrome="interaction" style={{ pointerEvents: 'none', position: 'absolute', inset: 0, zIndex: 10 }}>
      {/* 1. Transform Bounding Box & Resize/Rotate/Radius Handles */}
      {!viewOnly && interactionTool !== 'node' && selectedIds.length === 1 && selectedNode && visibleNodes.some((node) => node.id === selectedNode.id) && !selectedNode.parentColumnId && !(selectedNode.kind === 'board-link' && selectedNode.boardPortal) && (() => {
        const node = selectedNode
        return (
          <div
            className="node-transform-box"
            data-transform-controls={node.id}
            onPointerDown={(event) => { if (event.target === event.currentTarget) startNodeDrag(event, node) }}
            style={{
              // The frame must not cover card editors, media, or other live
              // controls. Its handles opt into hit testing individually.
              pointerEvents: 'none',
              left: node.x,
              top: node.y,
              right: 'auto',
              bottom: 'auto',
              width: node.width,
              height: node.height,
              zIndex: 10,
              transform: `rotate(${node.rotation || 0}deg) scale(${fisheyeScale(node)})`,
              transformOrigin: 'center center',
              '--handle-size': `${12 / board.viewport.scale}px`,
              '--handle-offset': `${7 / board.viewport.scale}px`,
              '--rotate-gap': `${29 / board.viewport.scale}px`,
            } as CSSProperties}
          >
            {RESIZE_HANDLES.map((handle) => (
              <button
                className={`node-resize-handle handle-${handle}`}
                type="button"
                key={handle}
                aria-label={`Resize ${nodeTitle(node)} from ${handle}`}
                onPointerDown={(event) => startNodeResize(event, node, handle)}
                onMouseDown={(event) => {
                  if (!stageRef.current?.dataset.activeTransform) startNodeResize(event, node, handle)
                }}
              />
            ))}
            {node.kind === 'shape' && (node.shapeType || 'rectangle') === 'rectangle' && (
              <>
                <button
                  className="node-radius-handle"
                  type="button"
                  aria-label={`Adjust corner radius of ${nodeTitle(node)}`}
                  onPointerDown={(event) => startNodeRadius(event, node)}
                  onMouseDown={(event) => {
                    if (!stageRef.current?.dataset.activeTransform) startNodeRadius(event, node)
                  }}
                />
                {cornerRadiusReadout !== null && (
                  <output className="corner-radius-readout" aria-live="polite">
                    {cornerRadiusReadout}px
                  </output>
                )}
              </>
            )}
            <button
              className="node-rotate-handle"
              type="button"
              aria-label={`Rotate ${nodeTitle(node)}`}
              onPointerDown={(event) => startNodeRotate(event, node)}
              onMouseDown={(event) => {
                if (!stageRef.current?.dataset.activeTransform) startNodeRotate(event, node)
              }}
            />
            {rotationReadout !== null && (
              <output
                className="rotation-readout"
                aria-live="polite"
                style={{
                  fontSize: `${10 / board.viewport.scale}px`,
                  padding: `${4 / board.viewport.scale}px ${7 / board.viewport.scale}px`,
                }}
              >
                {rotationReadout}°
              </output>
            )}
          </div>
        )
      })()}

      {/* 2. Direct Selection Handles for Bézier Vector Curves */}
      {interactionTool === 'node' && directPolicy.nodeId && selectedNode && selectedNode.id === directPolicy.nodeId && selectedNode.vectorPath && (() => {
        const node = selectedNode
        const controls = vectorEditorControls(node)
        return (
          <div
            className="vector-node-editor"
            style={{
              pointerEvents: 'auto',
              position: 'absolute',
              left: node.x,
              top: node.y,
              width: node.width,
              height: node.height,
              transform: `rotate(${node.rotation || 0}deg) scale(${fisheyeScale(node)})`,
              transformOrigin: 'top left',
              zIndex: 11,
            }}
          >
            <svg className="vector-handle-lines" viewBox={`0 0 ${node.width} ${node.height}`} preserveAspectRatio="none" aria-hidden="true">
              {controls.flatMap(({ index, anchor, handleIn, handleOut }) => [
                handleIn && <line key={`in-${index}`} x1={anchor.x} y1={anchor.y} x2={handleIn.x} y2={handleIn.y} />,
                handleOut && <line key={`out-${index}`} x1={anchor.x} y1={anchor.y} x2={handleOut.x} y2={handleOut.y} />,
              ])}
            </svg>
            {controls.map(({ index, anchor, handleIn, handleOut }) => {
              const endpoint = !node.vectorPath!.closed && (index === 0 || index === controls.length - 1)
              return (
                <span key={index}>
                  <button
                    className={`vector-anchor ${selectedVectorAnchorIndexes.includes(index) ? 'selected' : ''} ${marqueePreviewAnchors.includes(index) ? 'marquee-preview' : ''} ${endpoint ? 'endpoint' : ''}`}
                    data-point-index={index}
                    type="button"
                    aria-label={`${endpoint ? 'Edit open endpoint' : 'Move anchor'} ${index + 1}`}
                    title={`${endpoint ? 'Open endpoint' : `Anchor ${index + 1}`}; double-click to ${handleIn || handleOut ? 'remove' : 'add'} Bézier handles`}
                    style={{ left: `${(anchor.x / node.width) * 100}%`, top: `${(anchor.y / node.height) * 100}%` }}
                    onPointerDown={(event) => startVectorControlDrag(event, node, index, 'anchor')}
                    onDoubleClick={(event) => {
                      event.preventDefault()
                      event.stopPropagation()
                      setSelectedVectorPoint({ nodeId: node.id, index })
                      setSelectedVectorAnchorIndexes([index])
                      addCurveHandles(node, index)
                    }}
                  />
                  {handleIn && (
                    <button
                      className="vector-handle in"
                      type="button"
                      aria-label={`Adjust incoming curve handle ${index + 1}`}
                      style={{ left: `${(handleIn.x / node.width) * 100}%`, top: `${(handleIn.y / node.height) * 100}%` }}
                      onPointerDown={(event) => startVectorControlDrag(event, node, index, 'in')}
                    />
                  )}
                  {handleOut && (
                    <button
                      className="vector-handle out"
                      type="button"
                      aria-label={`Adjust outgoing curve handle ${index + 1}`}
                      style={{ left: `${(handleOut.x / node.width) * 100}%`, top: `${(handleOut.y / node.height) * 100}%` }}
                      onPointerDown={(event) => startVectorControlDrag(event, node, index, 'out')}
                    />
                  )}
                </span>
              )
            })}
          </div>
        )
      })()}

      {/* 3. Live Shape Direct Selection Anchors (Rectangle / Ellipse) */}
      {interactionTool === 'node' && selectedIds.length === 1 && selectedNode && isLiveShapeDirectSelectable(selectedNode) && (
        <div
          className={`vector-node-editor live-shape-node-editor live-shape-direct-overlay ${selectedNode.shapeType || 'rectangle'}`}
          style={{
            pointerEvents: 'auto',
            position: 'absolute',
            left: selectedNode.x,
            top: selectedNode.y,
            width: selectedNode.width,
            height: selectedNode.height,
            transform: `rotate(${selectedNode.rotation || 0}deg) scale(${fisheyeScale(selectedNode)})`,
            transformOrigin: 'top left',
            zIndex: 11,
          }}
        >
          {liveShapeAnchors(selectedNode.shapeType).map((anchor) => (
            <button
              key={anchor}
              className={`vector-anchor live-shape-anchor anchor-${anchor}`}
              type="button"
              aria-label={`Resize ${selectedNode.shapeType} from ${anchor}`}
              title={`Drag ${anchor.toUpperCase()} anchor${selectedNode.shapeType === 'ellipse' ? '; Shift constrains to a circle' : ''}`}
              onPointerDown={(event) => startLiveShapeAnchorDrag(event, selectedNode, anchor)}
            />
          ))}
        </div>
      )}

      {/* 4. Column Header Collapse/Expand Overlay */}
      {!viewOnly && visibleNodes.filter((node) => node.kind === 'column').map((column) => (
        <div
          key={`column-controls-${column.id}`}
          data-column-controls={column.id}
          className="column-header-controls-overlay"
          style={{
            pointerEvents: 'auto',
            position: 'absolute',
            left: column.x + 9,
            top: column.y + 9,
            width: Math.max(48, column.width - 18),
            transform: `rotate(${column.rotation || 0}deg) scale(${fisheyeScale(column)})`,
            transformOrigin: 'top left',
            zIndex: 10,
          } as CSSProperties}
        >
          <button
            className="column-collapse-control"
            type="button"
            aria-label={column.collapsed ? `Expand ${column.title}` : `Collapse ${column.title}`}
            title={column.collapsed ? 'Expand column' : 'Collapse column'}
            onPointerDown={(event) => event.stopPropagation()}
            onClick={(event) => {
              event.stopPropagation()
              toggleColumn(column)
            }}
          >
            {column.collapsed ? '＋' : '−'}
          </button>
        </div>
      ))}
    </div>
  )
}
