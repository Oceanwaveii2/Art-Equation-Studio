import { modelEqual } from '../state/modelEquality'
import type { BoardConnector, BoardModel, BoardNode, BoardPoint, VectorPath } from '../model/project'
import { vectorPathData, vectorTransformData } from '../model/vector'
import { connectorDashArray, connectorGeometry, connectorLabelPoint, connectorLinePattern, normalizeConnector } from './connectors'
import { readableForeground } from '../canvasTheme'

const SVG = 'http://www.w3.org/2000/svg'
export function svgElement(name: string, attributes: Record<string, string | number> = {}) {
  const element = document.createElementNS(SVG, name)
  for (const [key, value] of Object.entries(attributes)) element.setAttribute(key, String(value))
  return element
}
export function segmentData(path: VectorPath, index: number) {
  const a = path.points[index], b = path.points[(index + 1) % path.points.length]
  if (!a || !b) return ''
  return vectorPathData({ ...path, closed: false, points: [a, b] })
}
type Projection = {
  attributes: Map<Element, Map<string, string>>
  styles: Map<HTMLElement, Map<string, string>>
  classes: Map<Element, Map<string, boolean>>
  text: Map<Element, string>
}

/** Paint a transaction over committed DOM. No HTML replacement, event-handler
 * replacement, React state or persisted mutation. Restore only owned properties. */
export class GesturePresenter {
  private undoAttributes = new Map<Element, Map<string, string | null>>()
  private undoStyles = new Map<HTMLElement, Map<string, string>>()
  private writtenAttributes = new Map<Element, Map<string, string>>()
  private writtenStyles = new Map<HTMLElement, Map<string, string>>()
  private undoClassTokens = new Map<Element, Map<string, boolean>>()
  private writtenClassTokens = new Map<Element, Map<string, boolean>>()
  private undoText = new Map<Element, string | null>()
  private writtenText = new Map<Element, string>()
  private drafts = new Map<string, HTMLElement>()
  private base?: BoardModel
  private last?: BoardModel
  private boardListeners = new Set<(board: Readonly<BoardModel> | undefined) => void>()
  private pathComparisons = new WeakMap<VectorPath, { original: VectorPath; same: boolean }>()
  private connectorComparisons = new WeakMap<BoardConnector, { original: BoardConnector; same: boolean }>()
  private projection?: Projection
  private root: () => HTMLElement | null
  private ensureVisible: (ids: string[]) => void
  frames = 0
  constructor(root: () => HTMLElement | null, ensureVisible: (ids: string[]) => void) { this.root = root; this.ensureVisible = ensureVisible }
  /** Live paint projection only. Late subscribers immediately receive the
   * current preview (or undefined); they never own persistence or history. */
  subscribeBoard(listener: (board: Readonly<BoardModel> | undefined) => void) {
    this.boardListeners.add(listener)
    listener(this.last)
    return () => { this.boardListeners.delete(listener) }
  }
  private publishBoard() {
    for (const listener of [...this.boardListeners]) listener(this.last)
  }
  private samePath(original?: VectorPath, next?: VectorPath) {
    if (original === next) return true
    if (!original || !next) return false
    const cached = this.pathComparisons.get(next)
    if (cached?.original === original) return cached.same
    // Transform handlers clone the transaction baseline. Cloned but unchanged
    // paths must not force every offscreen vector into the mounted DOM.
    const same = modelEqual(original, next)
    this.pathComparisons.set(next, { original, same }); return same
  }
  private sameConnector(original: BoardConnector | undefined, next: BoardConnector) {
    if (original === next) return true
    if (!original) return false
    const cached = this.connectorComparisons.get(next)
    if (cached?.original === original) return cached.same
    // Connector-only endpoint, route, label and paint transactions must update
    // even when both connected object records stay unchanged.
    const same = modelEqual(original, next)
    this.connectorComparisons.set(next, { original, same }); return same
  }
  private sameResolved(original?: readonly VectorPath[], next?: readonly VectorPath[]) {
    return original === next || !!original && !!next && original.length === next.length && original.every((path, index) => this.samePath(path, next[index]))
  }
  private text(element: Element | null | undefined, value: string) {
    if (!element) return
    if (this.projection) { this.projection.text.set(element, value); return }
    if (!this.undoText.has(element)) this.undoText.set(element, element.textContent)
    element.textContent = value; this.writtenText.set(element, value)
  }
  private attribute(element: Element | null | undefined, name: string, value: string | number) {
    if (!element) return
    if (this.projection) {
      if (!this.projection.attributes.has(element)) this.projection.attributes.set(element, new Map())
      this.projection.attributes.get(element)!.set(name, String(value)); return
    }
    let saved = this.undoAttributes.get(element)
    if (!saved) { saved = new Map(); this.undoAttributes.set(element, saved) }
    if (!saved.has(name)) saved.set(name, element.getAttribute(name))
    element.setAttribute(name, String(value))
    if (!this.writtenAttributes.has(element)) this.writtenAttributes.set(element, new Map())
    this.writtenAttributes.get(element)!.set(name, String(value))
  }
  private style(element: HTMLElement, name: string, value: string) {
    if (this.projection) {
      if (!this.projection.styles.has(element)) this.projection.styles.set(element, new Map())
      this.projection.styles.get(element)!.set(name, value); return
    }
    let saved = this.undoStyles.get(element)
    if (!saved) { saved = new Map(); this.undoStyles.set(element, saved) }
    if (!saved.has(name)) saved.set(name, element.style.getPropertyValue(name))
    element.style.setProperty(name, value)
    if (!this.writtenStyles.has(element)) this.writtenStyles.set(element, new Map())
    this.writtenStyles.get(element)!.set(name, element.style.getPropertyValue(name))
  }
  private classToken(element: Element | null | undefined, name: string, enabled: boolean) {
    if (!element) return
    if (this.projection) {
      if (!this.projection.classes.has(element)) this.projection.classes.set(element, new Map())
      this.projection.classes.get(element)!.set(name, enabled); return
    }
    const current = element.classList.contains(name)
    if (current === enabled && !this.undoClassTokens.get(element)?.has(name)) return
    let saved = this.undoClassTokens.get(element)
    if (!saved) { saved = new Map(); this.undoClassTokens.set(element, saved) }
    if (!saved.has(name)) saved.set(name, current)
    element.classList.toggle(name, enabled)
    if (!this.writtenClassTokens.has(element)) this.writtenClassTokens.set(element, new Map())
    this.writtenClassTokens.get(element)!.set(name, enabled)
  }
  present(base: BoardModel, next: BoardModel) {
    const previous = this.last
    this.base = base; this.last = next
    const root = this.root(), world = root?.querySelector<HTMLElement>('.board-world')
    if (!root || !world) { this.publishBoard(); return }
    const missing = this.paintBoard(base, next, previous, root, world)
    if (missing.length) this.ensureVisible(missing)
    root.dataset.gesturePreview = 'true'; root.dataset.gestureFrames = String(++this.frames)
    root.dispatchEvent(new CustomEvent('canvas-gesture-presented'))
    this.publishBoard()
  }
  private paintBoard(base: BoardModel, next: BoardModel, previous: BoardModel | undefined, root: HTMLElement, world: HTMLElement) {
    const previousNodes = new Map((previous?.nodes || base.nodes).map(node => [node.id, node]))
    const previousConnectors = new Map((previous?.connectors || base.connectors).map(connector => [connector.id, connector]))
    const originals = new Map(base.nodes.map(node => [node.id, node]))
    const changed = new Set<string>(), missing: string[] = []
    for (const node of next.nodes) {
      const original = originals.get(node.id)
      const previous = previousNodes.get(node.id)
      const straightShape = node.kind === 'shape' && (node.shapeType === 'line' || node.shapeType === 'arrow')
      const ellipseShape = node.kind === 'shape' && node.shapeType === 'ellipse'
      const sameGeometry = (candidate: BoardNode | undefined) => candidate === node || candidate && candidate.kind === node.kind && candidate.shapeType === node.shapeType && candidate.x === node.x && candidate.y === node.y && candidate.width === node.width && candidate.height === node.height && candidate.rotation === node.rotation && candidate.cornerRadius === node.cornerRadius && this.samePath(candidate.vectorPath, node.vectorPath) && this.sameResolved(candidate.vectorBoolean?.resolvedPaths, node.vectorBoolean?.resolvedPaths)
        && (!(straightShape || ellipseShape) || candidate.body === node.body && candidate.strokeWidth === node.strokeWidth && candidate.strokeColor === node.strokeColor && candidate.opacity === node.opacity)
        && (node.shapeType !== 'arrow' || candidate.arrowMotion?.enabled === node.arrowMotion?.enabled && candidate.arrowMotion?.speed === node.arrowMotion?.speed && candidate.arrowMotion?.direction === node.arrowMotion?.direction)
        && (!ellipseShape || candidate.color === node.color && candidate.textColor === node.textColor)
      if (sameGeometry(original) && sameGeometry(previous)) continue
      changed.add(node.id)
      let element = root.querySelector<HTMLElement>(`[data-node-id="${CSS.escape(node.id)}"]`)
      if (!this.projection && !element && !original && node.kind === 'shape') {
        element = this.createDraft(node); world.append(element); this.drafts.set(node.id, element)
      }
      if (!element) { missing.push(node.id); continue }
      this.style(element, 'left', `${node.x}px`); this.style(element, 'top', `${node.y}px`)
      this.style(element, 'width', `${node.width}px`); this.style(element, 'height', `${node.height}px`)
      const scale = element.style.transform.match(/scale\([^)]+\)/)?.[0] || 'scale(1)'
      this.style(element, 'transform', `rotate(${node.rotation || 0}deg) ${scale}`)
      this.style(element, '--shape-radius', `${node.cornerRadius ?? 14}px`)
      if (this.projection) {
        // These belong to the keyed article across child/kind replacement.
        // A committed frame keeps its generic App opacity at one.
        const frame = node.kind === 'group' && (node.containerRole === 'frame' || /\bframe\b/i.test(node.title))
        this.style(element, 'opacity', String(frame ? 1 : node.opacity ?? 1))
        this.style(element, '--shape-stroke', `${node.strokeWidth ?? 2}px`)
      }
      const controls = root.querySelector<HTMLElement>(`[data-column-controls="${CSS.escape(node.id)}"]`)
      if (controls) {
        this.style(controls, 'left', `${node.x + 9}px`); this.style(controls, 'top', `${node.y + 9}px`)
        this.style(controls, 'width', `${Math.max(48, node.width - 18)}px`)
        this.style(controls, 'transform', `rotate(${node.rotation || 0}deg) ${scale}`)
      }
      const transformControls = root.querySelector<HTMLElement>(`[data-transform-controls="${CSS.escape(node.id)}"]`)
      if (transformControls) {
        this.style(transformControls, 'left', `${node.x}px`); this.style(transformControls, 'top', `${node.y}px`)
        this.style(transformControls, 'width', `${node.width}px`); this.style(transformControls, 'height', `${node.height}px`)
        this.style(transformControls, 'transform', `rotate(${node.rotation || 0}deg) ${scale}`)
      }
      if (ellipseShape) this.paintEllipse(element, node)
      else if (node.vectorPath || straightShape) this.paintVector(element, node)
      if (!this.projection && !original) this.paintDraft(element, node)
    }
    const originalConnectors = new Map(base.connectors.map(connector => [connector.id, connector]))
    for (const connector of next.connectors) {
      if (this.sameConnector(originalConnectors.get(connector.id), connector) && this.sameConnector(previousConnectors.get(connector.id), connector) && !changed.has(connector.sourceId || '') && !changed.has(connector.targetId || '')) continue
      const geometry = connectorGeometry(connector, next.nodes)
      const group = root.querySelector(`[data-connector-id="${CSS.escape(connector.id)}"]`)
      if (!geometry || !group) continue
      for (const path of group.querySelectorAll(':scope > path')) this.attribute(path, 'd', geometry.path)
      const suppliedScale = Number(group.getAttribute('data-connector-scale'))
      const scale = Number.isFinite(suppliedScale) && suppliedScale > 0 ? suppliedScale : next.viewport.scale > 0 && Number.isFinite(next.viewport.scale) ? next.viewport.scale : 1
      const visiblePath = group.querySelector('.connector-path'), dash = connectorDashArray(connector)
      this.attribute(visiblePath, 'stroke', connector.color)
      const visualStrokeWidth = Math.max(connector.width, .75 / scale)
      this.attribute(visiblePath, 'stroke-width', visualStrokeWidth)
      this.attribute(visiblePath, 'stroke-dasharray', dash || 'none')
      this.attribute(visiblePath, 'stroke-linecap', connectorLinePattern(connector) === 'dot' ? 'round' : 'butt')
      this.attribute(visiblePath, 'marker-start', connector.startArrow ? `url(#arrow-${connector.id})` : 'none')
      this.attribute(visiblePath, 'marker-end', connector.endArrow ? `url(#arrow-${connector.id})` : 'none')
      this.attribute(group.querySelector('.connector-hit'), 'stroke-width', Math.min(64, Math.max(14, connector.width + 12) / Math.max(.2, scale)))
      this.attribute(group.querySelector('.connector-flow'), 'stroke-width', Math.max(1, visualStrokeWidth * .7))
      this.attribute(group.querySelector('.connector-flow'), 'visibility', connector.animated ? 'visible' : 'hidden')
      this.attribute(root.querySelector(`.connector-layer marker[id="${CSS.escape(`arrow-${connector.id}`)}"] > path`), 'fill', connector.color)
      const label = group.querySelector('.connector-label'), labelPoint = connectorLabelPoint(connector, geometry)
      this.attribute(label, 'transform', `translate(${labelPoint.x} ${labelPoint.y})`)
      this.attribute(label, 'visibility', connector.label ? 'visible' : 'hidden')
      this.text(label?.querySelector('text'), connector.label || '')
      const labelWidth = Math.max(60, (connector.label?.length || 0) * 8.4)
      this.attribute(label?.querySelector('rect'), 'x', -labelWidth / 2)
      this.attribute(label?.querySelector('rect'), 'width', labelWidth)
      group.querySelectorAll('.connector-endpoint').forEach((circle, index) => {
        const side = circle.getAttribute('data-endpoint') || (index ? 'target' : 'source')
        const point = side === 'target' ? geometry.target : geometry.source
        this.attribute(circle, 'cx', point.x); this.attribute(circle, 'cy', point.y); this.attribute(circle, 'r', Math.min(20, Math.max(3.5, 7 / scale)))
      })
      const bends = connector.style === 'elbow' ? normalizeConnector(connector).bendPoints || [] : []
      group.querySelectorAll('.connector-bend[data-bend-index]').forEach(circle => {
        const index = Number(circle.getAttribute('data-bend-index'))
        const point = Number.isInteger(index) && index >= 0 ? bends[index] : undefined
        this.attribute(circle, 'visibility', point ? 'visible' : 'hidden')
        if (point) { this.attribute(circle, 'cx', point.x); this.attribute(circle, 'cy', point.y); this.attribute(circle, 'r', Math.min(16, Math.max(3, 6 / scale))) }
      })
    }
    return missing
  }
  repaint() { if (this.base && this.last) this.present(this.base, this.last) }
  clear(committed?: BoardModel) {
    // React may commit the same value as a preview, or skip an unchanged prop
    // that the preview mutated. Equality with the last write cannot distinguish
    // those cases. Project the new model without DOM writes, then retire only
    // owned properties that still carry our write. Ordinary cancel uses the
    // saved baseline, and unrelated external DOM changes remain untouched.
    let desired: Projection | undefined
    const root = this.root(), world = root?.querySelector<HTMLElement>('.board-world')
    if (committed && this.base && this.last && root && world) {
      desired = { attributes: new Map(), styles: new Map(), classes: new Map(), text: new Map() }
      this.projection = desired
      try { this.paintBoard(this.base, committed, this.last, root, world) }
      finally { this.projection = undefined }
    }
    for (const [element, attributes] of this.undoAttributes) for (const [name, baseline] of attributes) {
      if (element.getAttribute(name) !== this.writtenAttributes.get(element)?.get(name)) continue
      const value = desired?.attributes.get(element)?.get(name) ?? baseline
      if (value === null) element.removeAttribute(name); else element.setAttribute(name, value)
    }
    for (const [element, styles] of this.undoStyles) for (const [name, baseline] of styles) {
      if (element.style.getPropertyValue(name) !== this.writtenStyles.get(element)?.get(name)) continue
      const value = desired?.styles.get(element)?.get(name) ?? baseline
      if (value) element.style.setProperty(name, value); else element.style.removeProperty(name)
    }
    for (const [element, tokens] of this.undoClassTokens) for (const [name, baseline] of tokens) {
      if (element.classList.contains(name) === this.writtenClassTokens.get(element)?.get(name)) element.classList.toggle(name, desired?.classes.get(element)?.get(name) ?? baseline)
    }
    for (const [element, baseline] of this.undoText) if (element.textContent === this.writtenText.get(element)) element.textContent = desired?.text.get(element) ?? baseline
    for (const draft of this.drafts.values()) draft.remove()
    this.undoAttributes.clear(); this.undoStyles.clear(); this.drafts.clear(); this.base = this.last = undefined
    this.writtenAttributes.clear(); this.writtenStyles.clear()
    this.undoClassTokens.clear(); this.writtenClassTokens.clear()
    this.undoText.clear(); this.writtenText.clear()
    if (root) { root.dataset.gesturePreview = 'false'; root.dispatchEvent(new CustomEvent('canvas-gesture-presented')) }
    this.ensureVisible([])
    this.publishBoard()
  }
  private paintVector(element: HTMLElement, node: BoardNode) {
    const path = node.vectorPath, svg = element.querySelector('.node-vector-shape')
    if (node.kind === 'shape' && (node.shapeType === 'line' || node.shapeType === 'arrow')) this.paintLine(element, node)
    else if (path) {
      this.attribute(svg, 'viewBox', `0 0 ${node.width} ${node.height}`)
      this.attribute(svg?.querySelector(':scope > g'), 'transform', vectorTransformData(node) || '')
      const compound = (node.vectorBoolean?.operands || [path]).map(vectorPathData).join(' ')
      if (node.vectorBoolean?.resolvedPaths) {
        const result = node.vectorBoolean.resolvedPaths.map(vectorPathData).join(' ')
        this.attribute(svg?.querySelector('[data-vector-result-paint]'), 'd', result)
        this.attribute(svg?.querySelector('.shape-hit-area'), 'd', result)
      }
      for (const shape of node.vectorBoolean ? [] : svg?.querySelectorAll<SVGPathElement>(':scope > g > path') || []) {
        const segment = shape.getAttribute('data-segment-index')
        if (segment !== null) this.attribute(shape, 'd', segmentData(path, Number(segment)))
        else if (!shape.classList.contains('vector-segment-selected')) this.attribute(shape, 'd', node.vectorBoolean ? (shape.classList.contains('shape-hit-area') ? compound : vectorPathData(path)) : compound)
      }
    }
    if (!path) return
    const editor = element.querySelector('.vector-node-editor')
    this.attribute(editor?.querySelector('svg'), 'viewBox', `0 0 ${node.width} ${node.height}`)
    const lines = [...(editor?.querySelectorAll('svg line') || [])]; let lineIndex = 0
    path.points.forEach((point, index) => {
      const anchor = editor?.querySelector<HTMLElement>(`[data-point-index="${index}"]`)
      const position = (target: HTMLElement | null | undefined, p: BoardPoint) => { if (target) { this.style(target, 'left', `${p.x / node.width * 100}%`); this.style(target, 'top', `${p.y / node.height * 100}%`) } }
      position(anchor, point)
      for (const [kind, handle] of [['in', point.handleIn], ['out', point.handleOut]] as const) if (handle) {
        const end = { x: point.x + handle.x, y: point.y + handle.y }
        position(anchor?.parentElement?.querySelector<HTMLElement>(`.vector-handle.${kind}`), end)
        const line = lines[lineIndex++]; this.attribute(line, 'x1', point.x); this.attribute(line, 'y1', point.y); this.attribute(line, 'x2', end.x); this.attribute(line, 'y2', end.y)
      }
    })
  }
  private paintLine(element: HTMLElement, node: BoardNode) {
    const svg = element.querySelector('.node-vector-shape')
    if (!svg || ![node.width, node.height].every(value => Number.isFinite(value) && value > 0)) return
    const path = node.vectorPath
    const first = path ? path.points?.[0] : { x: 0, y: 0 }
    const last = path ? path.points?.at(-1) : { x: node.width, y: node.height }
    if (!first || !last) return
    const coordinates = [first.x / node.width * 100, first.y / node.height * 100,
      last.x / node.width * 100, last.y / node.height * 100]
    if (!coordinates.every(Number.isFinite)) return
    // App's line branch normalizes first/last anchors into a fixed100 viewBox.
    // Changing the viewBox alone shrinks the authored line and leaves its hit
    // target behind. Intermediate points/handles are intentionally not painted.
    this.attribute(svg, 'viewBox', '0 0 100 100')
    this.classToken(svg, 'reverse', node.body === 'reverse')
    const base = svg.querySelector('.shape-arrow-base'), hit = svg.querySelector('.shape-hit-area')
    const flow = svg.querySelector('.shape-arrow-flow')
    for (const line of [base, hit, flow]) {
      this.attribute(line, 'x1', coordinates[0]); this.attribute(line, 'y1', coordinates[1])
      this.attribute(line, 'x2', coordinates[2]); this.attribute(line, 'y2', coordinates[3])
    }
    const savedWidth = node.strokeWidth ?? 2, stroke = node.strokeColor || '#b9d4e7'
    this.attribute(base, 'stroke', stroke); this.attribute(base, 'stroke-width', savedWidth * .65)
    this.attribute(hit, 'stroke-width', Math.max(16, savedWidth * 4))
    this.attribute(flow, 'stroke-width', Math.max(1, savedWidth * .42))
    if (node.shapeType === 'arrow') for (const marker of svg.querySelectorAll('marker > path')) this.attribute(marker, 'fill', stroke)
    if (!this.projection && element.dataset.liveDraft && node.shapeType === 'arrow') {
      const animated = node.arrowMotion?.enabled !== false
      this.classToken(svg, 'animated-arrow', animated)
      for (const speed of ['slow', 'normal', 'fast']) this.classToken(svg, `motion-${speed}`, animated && (node.arrowMotion?.speed || 'normal') === speed)
      for (const direction of ['forward', 'reverse']) this.classToken(svg, `direction-${direction}`, animated && (node.arrowMotion?.direction || 'forward') === direction)
      // Draft children are privately owned and reused. Keeping a hidden flow
      // avoids retaining detached replacement paths during motion toggles.
      this.attribute(flow, 'visibility', animated ? 'visible' : 'hidden')
    }
    this.style(element, '--shape-stroke', `${savedWidth}px`)
    this.style(element, 'opacity', String(node.opacity ?? 1))
  }
  private createDraft(node: BoardNode) {
    const element = document.createElement('article'); element.className = 'board-node node-shape'; element.dataset.nodeId = node.id; element.dataset.liveDraft = 'true'
    element.style.pointerEvents = 'none'; element.style.setProperty('--node-accent', node.color || '#56748e'); element.style.setProperty('--node-stroke', node.strokeColor || '#b9d4e7'); element.style.setProperty('--shape-stroke', `${node.strokeWidth ?? 2}px`)
    if (node.shapeType === 'rectangle') { const label = document.createElement('div'); label.className = 'node-shape-label rectangle'; element.append(label) }
    else { const svg = svgElement('svg', { class: node.shapeType === 'ellipse' ? 'node-shape-ellipse' : 'node-vector-shape', viewBox: '0 0 100 100', preserveAspectRatio: 'none' }); element.append(svg) }
    return element
  }
  private paintDraft(element: HTMLElement, node: BoardNode) {
    const svg = element.querySelector('svg'); if (!svg) return
    const stroke = node.strokeColor || '#b9d4e7'
    if (node.shapeType === 'ellipse') { this.paintEllipse(element, node); return }
    if (node.shapeType === 'line' || node.shapeType === 'arrow') {
      // Reuse draft children between frames. Ownership/proxy listeners and the
      // undo maps must not accumulate detached replacement lines during a drag.
      if (!svg.querySelector('.shape-arrow-base')) {
        const hit = svgElement('line', { class: 'shape-hit-area', stroke: 'transparent', 'vector-effect': 'non-scaling-stroke', 'pointer-events': 'all' })
        const line = svgElement('line', { class: 'shape-arrow-base', stroke, 'vector-effect': 'non-scaling-stroke', 'pointer-events': 'none' })
        svg.replaceChildren(hit, line)
        if (node.shapeType === 'arrow') {
          const defs = svgElement('defs'), marker = svgElement('marker', { id: `live-arrow-${node.id}`, markerWidth: 8, markerHeight: 8, refX: 7, refY: 4, orient: 'auto' })
          marker.append(svgElement('path', { d: 'M 0 0 L 8 4 L 0 8 z', fill: stroke })); defs.append(marker); svg.append(defs); line.setAttribute('marker-end', `url(#live-arrow-${node.id})`)
          svg.append(svgElement('line', { class: 'shape-arrow-flow', stroke: '#fff', 'stroke-dasharray': '2 12', 'vector-effect': 'non-scaling-stroke', 'pointer-events': 'none' }))
        }
      }
      this.paintLine(element, node)
      return
    }
    {
      svg.classList.toggle('reverse', node.body === 'reverse')
      const line = svgElement('line', { x1: 0, y1: 0, x2: 100, y2: 100, stroke, 'stroke-width': (node.strokeWidth || 2) * .65, 'vector-effect': 'non-scaling-stroke' })
      svg.replaceChildren(line)
    }
  }
  private paintEllipse(element: HTMLElement, node: BoardNode) {
    const svg = element.querySelector('.node-shape-ellipse')
    if (!svg) return
    if (!this.projection && element.dataset.liveDraft && !svg.querySelector('ellipse')) {
      const hit = svgElement('ellipse', { class: 'shape-hit-area', fill: 'transparent', stroke: 'transparent', 'vector-effect': 'non-scaling-stroke' })
      const base = svgElement('ellipse', { 'fill-opacity': 1, 'vector-effect': 'non-scaling-stroke', 'pointer-events': 'none' })
      const caption = svgElement('text', { x: 50, y: 52, 'text-anchor': 'middle', 'dominant-baseline': 'middle', 'font-size': 8, 'pointer-events': 'none' })
      svg.append(hit, base, caption)
    }
    const hit = svg.querySelector('.shape-hit-area'), base = svg.querySelector('ellipse:not(.shape-hit-area)')
    this.attribute(svg, 'viewBox', '0 0 100 100')
    for (const shape of [hit, base]) {
      this.attribute(shape, 'cx', 50); this.attribute(shape, 'cy', 50)
      this.attribute(shape, 'rx', 49); this.attribute(shape, 'ry', 49)
    }
    this.attribute(hit, 'stroke-width', Math.max(16, (node.strokeWidth ?? 2) * 4))
    this.attribute(base, 'fill', node.color || '#56748e')
    this.attribute(base, 'stroke', node.strokeColor || '#b9d4e7')
    this.attribute(base, 'stroke-width', node.strokeWidth ?? 2)
    this.style(element, 'opacity', String(node.opacity ?? 1))
    this.style(element, '--shape-stroke', `${node.strokeWidth ?? 2}px`)
    // Caption layout remains React/SVG-owned. Preserve current text instead of
    // granting complete-object Vello ownership while its body is nonempty.
    this.text(svg.querySelector('text'), node.body || '')
    this.attribute(svg.querySelector('text'), 'fill', node.textColor || readableForeground(node.color || '#56748e'))
  }
}
