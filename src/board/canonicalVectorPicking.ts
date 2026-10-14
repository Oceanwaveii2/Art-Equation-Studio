import paper from 'paper'
import type { BoardNode, BoardPoint } from '../model/project'
import type { CanvasPreparedVectorGeometry, CanvasVectorCommand } from '../canvas-engine/contracts'
import { prepareVelloVectorGeometry } from './velloVectorGeometry'
import { isRectangleErasure } from '../model/rectangleErasure'
import { prepareRectangleErasurePick } from './rectangleErasurePaint'

type ReadyGeometry = Extract<CanvasPreparedVectorGeometry, { status: 'ready' }>
export type CanonicalVectorPickOptions = Readonly<{
  zoomScale?: number
  strokeWidth?: number
  /** Closed semantic SVG hit proxies include their interior even with transparent paint. */
  includeFill?: boolean
  /** Optional explicit UI proximity radius; measured in CSS pixels after all transforms. */
  hitRadiusCssPx?: number
}>

const finitePoint = (point: BoardPoint) => Number.isFinite(point.x) && Number.isFinite(point.y)
const coordinatesFinite = (command: CanvasVectorCommand) => command.slice(1).every(Number.isFinite)

/** Geometry-only semantic picking. It consumes the same immutable prepared
 * world commands as Vello, never local sampling, paint bounds as geometry,
 * editable copies or display pixels. Paper's private 1px view has updates
 * disabled; picking only calls geometry methods, with no draw or readback.
 * The default stroke policy
 * is nearest-curve proximity matching the SVG proxy's half width (round tube);
 * this does not promise exact SVG butt/square-cap or miter-join pixel coverage.
 * Own one picker per canvas/document host and dispose it with that host. */
export function createCanonicalVectorPicker() {
  let scope: paper.PaperScope | undefined
  let project: paper.Project | undefined
  let cache = new WeakMap<ReadyGeometry, paper.PathItem | null>()
  let disposed = false
  const releaseScope = () => {
    const ownedScope = scope
    scope = undefined; project = undefined
    if (!ownedScope) return
    // Also cover a Project constructor that registered itself before failing.
    // This scope is private to the picker; no production Paper project is removed.
    try {
      for (const ownedProject of [...ownedScope.projects]) {
        try { ownedProject.remove() }
        catch {
          // A faulty project remover must not prevent its view and scope from
          // being retired. projects is Paper's public per-scope membership list.
          try { ownedProject.view?.remove() } catch { /* continue scope cleanup */ }
          const index = ownedScope.projects.indexOf(ownedProject)
          if (index >= 0) ownedScope.projects.splice(index, 1)
        }
      }
    } finally {
      // Paper0.12.18 implements this public method but omits it from its d.ts.
      ;(ownedScope as paper.PaperScope & { remove(): void }).remove()
    }
  }

  const compile = (geometry: ReadyGeometry): paper.PathItem | null => {
    if (disposed) return null
    if (cache.has(geometry)) return cache.get(geometry) ?? null
    const immutable = Object.isFrozen(geometry) && Object.isFrozen(geometry.commands)
      && Object.isFrozen(geometry.bounds) && geometry.commands.every(Object.isFrozen)
    try {
      if (!scope) {
        scope = new paper.PaperScope()
        project = new scope.Project(undefined!)
        if (project.view) { project.view.autoUpdate = false; project.view.pause() }
      }
      scope.activate()
    } catch {
      // The private Paper1px view can fail to initialize. Picking must fail
      // closed without retaining a partially initialized global scope/project.
      releaseScope()
      return null
    }
    let compound: paper.CompoundPath | undefined
    let current: paper.Path | undefined
    try {
      compound = new scope.CompoundPath({ insert: false, fillRule: geometry.fillRule })
      for (const command of geometry.commands) {
        if (!coordinatesFinite(command)) throw new Error('Nonfinite prepared command')
        if (command[0] === 'M' && command.length === 3) {
          current = new scope.Path({ insert: false })
          compound.addChild(current)
          current.moveTo(new scope.Point(command[1], command[2]))
        } else if (command[0] === 'L' && command.length === 3 && current) {
          current.lineTo(new scope.Point(command[1], command[2]))
        } else if (command[0] === 'C' && command.length === 7 && current) {
          current.cubicCurveTo(new scope.Point(command[1], command[2]),
            new scope.Point(command[3], command[4]), new scope.Point(command[5], command[6]))
        } else if (command[0] === 'Z' && command.length === 1 && current) {
          current.closePath()
          current = undefined
        } else throw new Error('Malformed prepared command sequence')
      }
      if (immutable) cache.set(geometry, compound)
      return compound
    } catch {
      compound?.remove()
      if (immutable) cache.set(geometry, null)
      return null
    }
  }

  const hit = (geometry: CanvasPreparedVectorGeometry, point: BoardPoint, options: CanonicalVectorPickOptions = {}) => {
    if (disposed || geometry.status !== 'ready' || !geometry.bounds || !geometry.commands.length || !finitePoint(point)) return false
    const zoom = options.zoomScale ?? 1, strokeWidth = options.strokeWidth ?? 2
    const cssRadius = options.hitRadiusCssPx ?? geometry.hitOutsetCssPx ?? Math.max(8, strokeWidth * 2)
    if (!Number.isFinite(zoom) || zoom <= 0 || !Number.isFinite(strokeWidth) || strokeWidth < 0
      || !Number.isFinite(cssRadius) || cssRadius < 0) return false
    if (geometry.approximation && (zoom < geometry.approximation.minCssScale || zoom > geometry.approximation.maxCssScale)) return false
    const radius = cssRadius / zoom, { x, y, width, height } = geometry.bounds
    if (![radius, x, y, width, height, x + width, y + height].every(Number.isFinite) || width < 0 || height < 0) return false
    if (geometry.primitive === 'plain-line') {
      // Match the semantic SVG line's butt-capped rectangular stroke, rather
      // than Paper's rounded nearest-curve tube. Coincident endpoints have no
      // proxy area; zero painted width still retains the separate hit stroke.
      const [a, b] = geometry.commands
      if (geometry.commands.length !== 2 || a?.[0] !== 'M' || a.length !== 3 || b?.[0] !== 'L' || b.length !== 3
        || !coordinatesFinite(a) || !coordinatesFinite(b)) return false
      const hitRadius = (options.hitRadiusCssPx ?? geometry.hitOutsetCssPx ?? cssRadius) / zoom
      if (!Number.isFinite(hitRadius) || hitRadius < 0) return false
      const dx = b[1] - a[1], dy = b[2] - a[2], lengthSquared = dx * dx + dy * dy
      if (!Number.isFinite(lengthSquared) || lengthSquared <= 0) return false
      const t = ((point.x - a[1]) * dx + (point.y - a[2]) * dy) / lengthSquared
      if (!Number.isFinite(t) || t < 0 || t > 1) return false
      const distance = Math.abs((point.x - a[1]) * dy - (point.y - a[2]) * dx) / Math.sqrt(lengthSquared)
      return Number.isFinite(distance) && distance <= hitRadius
    }
    if (point.x < x - radius || point.x > x + width + radius || point.y < y - radius || point.y > y + height + radius) return false
    const item = compile(geometry)
    if (!item || !scope) return false
    try {
      const query = new scope.Point(point.x, point.y)
      if ((options.includeFill ?? geometry.hasFill) && geometry.hasFill && item.contains(query)) return true
      const nearest = item.getNearestLocation(query)
      return Boolean(nearest && Number.isFinite(nearest.distance) && nearest.distance <= radius)
    } catch { return false }
    finally {
      // Mutable hand-authored input is never retained. Prepared model geometry
      // is deeply frozen and cached weakly; detached paths do not populate a project.
      if (!cache.has(geometry)) item.remove()
    }
  }

  return {
    hit,
    /** Unsupported paint derivatives retain the caller's prior DOM fallback. */
    nodeStatus(node: BoardNode, geometry?: CanvasPreparedVectorGeometry): CanvasPreparedVectorGeometry['status'] {
      if (disposed || node.hidden || node.kind !== 'shape') return 'invalid'
      if (isRectangleErasure(node)) return prepareRectangleErasurePick(node).status
      return (geometry ?? prepareVelloVectorGeometry(node.diagramShape ? { ...node, diagramShape: undefined } : node)).status
    },
    /** Optional prepared argument lets App's indexed candidate reuse the exact
     * accepted/live scene derivative without recompiling Boolean geometry. */
    hitNode(node: BoardNode, point: BoardPoint, zoomScale = 1, geometry?: CanvasPreparedVectorGeometry) {
      if (!disposed && !node.hidden && node.kind === 'shape' && isRectangleErasure(node)) {
        return hit(prepareRectangleErasurePick(node), point, { zoomScale, includeFill: true, hitRadiusCssPx: 0 })
      }
      if (disposed || node.hidden || node.kind !== 'shape'
        || (node.shapeType !== 'ellipse' && node.shapeType !== 'line' && (node.shapeType !== 'path' || !node.vectorPath))) return false
      // Caption metadata excludes paint takeover, not this authored SVG path's
      // semantic geometry. App renders the same VectorPathShape for this case.
      const prepared = geometry?.status === 'unsupported' && geometry.reason === 'diagram-caption' || !geometry
        ? prepareVelloVectorGeometry(node.diagramShape ? { ...node, diagramShape: undefined } : node) : geometry
      return hit(prepared, point, { zoomScale, strokeWidth: node.strokeWidth ?? 2 })
    },
    dispose() {
      if (disposed) return
      disposed = true
      cache = new WeakMap()
      releaseScope()
    },
  }
}
