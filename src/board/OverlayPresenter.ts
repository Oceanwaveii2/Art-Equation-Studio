import { useCallback, useLayoutEffect, useRef } from 'react'
import type { BoardConnector, BoardModel, BoardPoint, VectorPathPoint } from '../model/project'
import { COLUMN_PADDING, columnInsertionY, type ColumnDropTarget } from './columns'
import { connectorGeometry, connectorLabelPoint, normalizeConnector } from './connectors'
import { segmentData, svgElement } from './GesturePresenter'

type Values = {
  penPreview: BoardPoint | null
  penDragOut: { anchor: BoardPoint; cursor: BoardPoint } | null
  marquee: { start: BoardPoint; end: BoardPoint } | null
  marqueePreviewIds: string[]
  marqueePreviewAnchors: number[]
  marqueePreviewSegments: number[]
  connectorPreview: { id: string; end: 'source' | 'target'; point: BoardPoint } | null
  connectorDraft: { source: BoardPoint; target: BoardPoint } | null
  columnDropTarget: ColumnDropTarget | null
  rotationReadout: number | null
  cornerRadiusReadout: number | null
  guideLines: Array<{ axis: 'x' | 'y'; value: number }>
}
type Context = { board: BoardModel; penPoints: VectorPathPoint[]; selectedIds: string[]; columnDragIds: string[]; scale: number }

/** The returned sentinel keeps React from also owning these transient elements. */
export function usePresentationValue<K extends keyof Values>(presenter: OverlayPresenter, key: K, initial: Values[K]) {
  const initialRef = useRef(initial)
  const set = useCallback((value: Values[K]) => presenter.set(key, value), [presenter, key])
  return [initialRef.current, set] as const
}

export function useOverlayContext(presenter: OverlayPresenter, context: Context) {
  useLayoutEffect(() => { presenter.context = context; presenter.repaint() })
  useLayoutEffect(() => () => presenter.clear(), [presenter])
}

export class OverlayPresenter {
  context?: Context
  private values: Partial<Values> = {}
  private owned = new Map<keyof Values, Element[]>()
  private previousConnector?: string
  private root: () => HTMLElement | null
  constructor(root: () => HTMLElement | null) { this.root = root }
  set<K extends keyof Values>(key: K, value: Values[K]) { this.values[key] = value; this.paint(key); this.publish() }
  repaint() { for (const key of Object.keys(this.values) as Array<keyof Values>) this.paint(key); this.publish() }
  clear() { for (const elements of this.owned.values()) elements.forEach(element => element.remove()); this.owned.clear(); this.values = {}; this.repaint() }
  private publish() {
    const root = this.root(); if (!root) return
    root.dataset.transientOverlay = String(Object.values(this.values).some(value => Array.isArray(value) ? value.length > 0 : value !== null))
    root.dispatchEvent(new CustomEvent('canvas-gesture-presented'))
  }
  private paint(key: keyof Values) {
    const root = this.root(), context = this.context, world = root?.querySelector('.board-world')
    if (!root || !context || !world) return
    this.owned.get(key)?.forEach(element => element.remove())
    const owned: Element[] = []; this.owned.set(key, owned)
    const append = (parent: Element | null | undefined, element: Element) => { if (parent) { parent.append(element); owned.push(element) } }
    const html = (name: string, cls: string, style: Partial<CSSStyleDeclaration> = {}) => { const element = document.createElement(name); element.className = cls; Object.assign(element.style, style); return element }
    const selected = root.querySelector<HTMLElement>(`[data-node-id="${CSS.escape(context.selectedIds[0] || '')}"]`)
    const values = this.values
    if (key === 'marquee') {
      const box = values.marquee; root.classList.toggle('marquee-active', !!box)
      if (box) append(root, html('i', `canvas-marquee ${box.end.x < box.start.x ? 'crossing' : 'containing'}`, { left: `${Math.min(box.start.x, box.end.x)}px`, top: `${Math.min(box.start.y, box.end.y)}px`, width: `${Math.abs(box.end.x - box.start.x)}px`, height: `${Math.abs(box.end.y - box.start.y)}px` }))
    } else if (key === 'guideLines') {
      for (const guide of values.guideLines || []) append(world, html('i', `smart-guide ${guide.axis}`, guide.axis === 'x' ? { left: `${guide.value}px` } : { top: `${guide.value}px` }))
    } else if (key === 'columnDropTarget') {
      const target = values.columnDropTarget, column = context.board.nodes.find(node => node.id === target?.columnId)
      if (target && column) { const indicator = html('div', 'column-drop-indicator', { left: `${column.x + COLUMN_PADDING}px`, top: `${columnInsertionY(context.board, target, new Set(context.columnDragIds))}px`, width: `${column.width - COLUMN_PADDING * 2}px` }); const label = document.createElement('span'); label.textContent = 'Drop here'; indicator.append(label); append(world, indicator) }
    } else if (key === 'rotationReadout' || key === 'cornerRadiusReadout') {
      const value = values[key]
      if (value !== null && value !== undefined) { const output = html('output', key === 'rotationReadout' ? 'rotation-readout' : 'corner-radius-readout', { fontSize: `${10 / context.scale}px`, padding: `${4 / context.scale}px ${7 / context.scale}px` }); output.textContent = `${value}${key === 'rotationReadout' ? '°' : 'px'}`; output.setAttribute('aria-live', 'polite'); append(root.querySelector(`[data-transform-controls="${CSS.escape(context.selectedIds[0] || '')}"]`) || selected?.querySelector('.node-transform-box'), output) }
    } else if (key === 'penPreview') {
      const start = context.penPoints.at(-1), end = values.penPreview
      // Preview the forming segment as the curve it will become, bending from
      // the previous anchor's outgoing handle, instead of a straight chord.
      if (start && end) append(world.querySelector('.pen-draft'), svgElement('path', { d: `M ${start.x} ${start.y} C ${start.x + (start.handleOut?.x || 0)} ${start.y + (start.handleOut?.y || 0)} ${end.x} ${end.y} ${end.x} ${end.y}`, fill: 'none', stroke: '#f1c384', 'stroke-width': 1.5, 'stroke-dasharray': '5 4', 'vector-effect': 'non-scaling-stroke' }))
    } else if (key === 'penDragOut') {
      const drag = values.penDragOut
      if (drag) {
        // The draft svg only exists once an anchor has committed; create a
        // transient one so the very first anchor's drag-out still previews.
        let draft = world.querySelector('.pen-draft')
        if (!draft) { draft = svgElement('svg', { class: 'pen-draft' }); world.append(draft); owned.push(draft) }
        const previous = context.penPoints.at(-1)
        const handleOut = { x: drag.cursor.x - drag.anchor.x, y: drag.cursor.y - drag.anchor.y }
        if (previous) append(draft, svgElement('path', { d: `M ${previous.x} ${previous.y} C ${previous.x + (previous.handleOut?.x || 0)} ${previous.y + (previous.handleOut?.y || 0)} ${drag.anchor.x - handleOut.x} ${drag.anchor.y - handleOut.y} ${drag.anchor.x} ${drag.anchor.y}`, fill: 'none', stroke: '#f1c384', 'stroke-width': 2, 'vector-effect': 'non-scaling-stroke' }))
        append(draft, svgElement('line', { x1: drag.anchor.x, y1: drag.anchor.y, x2: drag.cursor.x, y2: drag.cursor.y, stroke: '#f1c384', 'stroke-width': 1.25, 'stroke-dasharray': '3 3', 'vector-effect': 'non-scaling-stroke' }))
        append(draft, svgElement('circle', { cx: drag.anchor.x, cy: drag.anchor.y, r: 4, fill: '#1c2229', stroke: '#f1c384', 'stroke-width': 2, 'vector-effect': 'non-scaling-stroke' }))
      }
    } else if (key === 'marqueePreviewIds') {
      const ids = new Set(values.marqueePreviewIds || [])
      root.querySelectorAll<HTMLElement>('.board-node').forEach(element => element.classList.toggle('marquee-preview', ids.has(element.dataset.nodeId || '')))
    } else if (key === 'marqueePreviewAnchors') {
      const indices = new Set(values.marqueePreviewAnchors || [])
      root.querySelectorAll<HTMLElement>('.vector-anchor').forEach(element => element.classList.toggle('marquee-preview', indices.has(Number(element.dataset.pointIndex))))
    } else if (key === 'marqueePreviewSegments') {
      const node = context.board.nodes.find(node => node.id === context.selectedIds[0])
      if (node?.vectorPath) for (const index of values.marqueePreviewSegments || []) append(selected?.querySelector('.node-vector-shape > g'), svgElement('path', { class: 'vector-segment-selected preview', d: segmentData(node.vectorPath, index), fill: 'none', stroke: '#f8d39c', 'stroke-width': (node.strokeWidth || 2) + 3, 'stroke-linecap': 'round', 'vector-effect': 'non-scaling-stroke', 'pointer-events': 'none' }))
    } else if (key === 'connectorPreview') {
      const preview = values.connectorPreview, id = preview?.id || this.previousConnector
      const connector = context.board.connectors.find(connector => connector.id === id)
      const geometry = connector && connectorGeometry(connector, context.board.nodes, preview?.end === 'source' ? preview.point : undefined, preview?.end === 'target' ? preview.point : undefined)
      const group = id && root.querySelector(`[data-connector-id="${CSS.escape(id)}"]`)
      if (group && geometry && connector) {
        group.querySelectorAll(':scope > path').forEach(path => path.setAttribute('d', geometry.path))
        const label = connectorLabelPoint(connector, geometry)
        group.querySelector('.connector-label')?.setAttribute('transform', `translate(${label.x} ${label.y})`)
        const scale = Number.isFinite(context.scale) && context.scale > 0 ? context.scale : 1
        group.setAttribute('data-connector-scale', String(scale))
        group.querySelectorAll('.connector-endpoint').forEach((circle, index) => {
          const side = circle.getAttribute('data-endpoint') || (index ? 'target' : 'source')
          const point = side === 'target' ? geometry.target : geometry.source
          circle.setAttribute('cx', String(point.x)); circle.setAttribute('cy', String(point.y)); circle.setAttribute('r', String(7 / scale))
        })
        const bends = connector.style === 'elbow' ? normalizeConnector(connector).bendPoints || [] : []
        group.querySelectorAll('.connector-bend[data-bend-index]').forEach(circle => {
          const index = Number(circle.getAttribute('data-bend-index'))
          const point = Number.isInteger(index) && index >= 0 ? bends[index] : undefined
          circle.setAttribute('visibility', point ? 'visible' : 'hidden')
          if (point) { circle.setAttribute('cx', String(point.x)); circle.setAttribute('cy', String(point.y)); circle.setAttribute('r', String(7 / scale)) }
        })
      }
      this.previousConnector = preview?.id
    } else if (key === 'connectorDraft' && values.connectorDraft) {
      const draft = values.connectorDraft
      const connector: BoardConnector = { id: 'draft', sourcePoint: draft.source, targetPoint: draft.target, sourcePort: 'right', targetPort: 'left', style: 'curve', color: '#58c8c1', width: 2, dashed: false, startArrow: false, endArrow: true, animated: true }
      const geometry = connectorGeometry(connector, [])
      if (geometry) { const group = svgElement('g', { class: 'connector-group draft' }); group.append(svgElement('path', { class: 'connector-path', d: geometry.path, fill: 'none', stroke: connector.color, 'stroke-width': 2, 'marker-end': 'url(#arrow-draft)' }), svgElement('path', { class: 'connector-flow', d: geometry.path, fill: 'none', stroke: '#fff', 'stroke-width': 1.4, 'stroke-dasharray': '2 14' })); append(world.querySelector('.connector-layer'), group) }
    }
  }
}
