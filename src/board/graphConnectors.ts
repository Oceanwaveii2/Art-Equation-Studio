/**
 * Art Equation Canvas Engine - Structured Graph Edge & Routing System
 *
 * Implements first-class edge data structures with semantic kinds,
 * typed port bindings, confidence, provenance, and routing modes:
 * - Straight lines
 * - Smooth cubic Béziers with tension
 * - Orthogonal stepped routing (authored waypoints control obstacle clearance)
 * - Waypoint-guided paths
 * - Directional arrows & optional mid-line semantic labels
 */

import { normalizeColor8 } from './colorUtils.ts'

export type EdgeKind = 'continuity' | 'reference' | 'identity' | 'branch' | 'evidence' | 'transform'
export type EdgeDirection = 'forward' | 'backward' | 'bidirectional'
export type RouteMode = 'straight' | 'bezier' | 'orthogonal' | 'manual'

export interface GraphEdge {
  id: string
  source: { cardId: string; portId: string }
  target: { cardId: string; portId: string }
  kind: EdgeKind
  direction: EdgeDirection
  label?: string
  confidence?: number
  provenance?: {
    createdBy: 'user' | 'AI' | 'import'
    sourceIds?: string[]
  }
  route: {
    mode: RouteMode
    waypoints?: { x: number; y: number }[]
    /** Optional authored Bézier controls; endpoints remain resolved card ports. */
    controls?: [{ x: number; y: number }, { x: number; y: number }]
  }
  style?: {
    stroke?: string
    strokeWidth?: number
    dash?: number[]
    showArrow?: boolean
  }
}

export interface ComputedRoute {
  pathCommands: any[]
  bounds: { x: number; y: number; width: number; height: number }
  midpoint: { x: number; y: number }
  tipPoint: { x: number; y: number }
  tipAngle: number
}

export const EDGE_KIND_COLORS: Record<EdgeKind, string> = {
  continuity: '#f59e0b', // Amber/gold
  branch: '#ef4444',     // Crimson/red
  reference: '#3b82f6',  // Blue
  identity: '#a855f7',   // Purple
  evidence: '#10b981',   // Emerald
  transform: '#ec4899'   // Magenta
}

/**
 * Computes exact route geometry from source coordinates to target coordinates.
 */
export function computeEdgeRoute(
  sx: number,
  sy: number,
  tx: number,
  ty: number,
  mode: RouteMode = 'bezier',
  waypoints: { x: number; y: number }[] = [],
  controls?: [{ x: number; y: number }, { x: number; y: number }]
): ComputedRoute {
  if (!['straight', 'bezier', 'orthogonal', 'manual'].includes(mode)) throw new Error(`Unsupported edge route mode: ${mode}`)
  if (![sx, sy, tx, ty].every(Number.isFinite)) throw new Error('Edge endpoints must be finite.')
  if (!Array.isArray(waypoints) || waypoints.length > 4096) throw new Error('Edge waypoints must be a bounded array.')
  for (const point of waypoints) {
    if (!point || ![point.x, point.y].every(Number.isFinite)) throw new Error('Edge waypoints must be finite.')
  }
  if (controls !== undefined) {
    if (mode !== 'bezier' || waypoints.length || !Array.isArray(controls) || controls.length !== 2
      || controls.some(point => !point || ![point.x, point.y].every(Number.isFinite))) {
      throw new Error('Authored controls require a Bézier route with two finite controls and no waypoints.')
    }
  }
  const dx = tx - sx
  const dy = ty - sy
  let commands: any[] = []
  let midpoint = { x: (sx + tx) / 2, y: (sy + ty) / 2 }
  let tipAngle = Math.atan2(dy, dx)

  if (waypoints && waypoints.length > 0) {
    commands = [['M', sx, sy]]
    for (const pt of waypoints) {
      commands.push(['L', pt.x, pt.y])
    }
    commands.push(['L', tx, ty])
    const lastPt = waypoints[waypoints.length - 1]
    tipAngle = Math.atan2(ty - lastPt.y, tx - lastPt.x)
  } else if (mode === 'straight' || mode === 'manual') {
    commands = [['M', sx, sy], ['L', tx, ty]]
    midpoint = { x: (sx + tx) / 2, y: (sy + ty) / 2 }
  } else if (mode === 'orthogonal') {
    const midX = sx + dx * 0.5
    commands = [
      ['M', sx, sy],
      ['L', midX, sy],
      ['L', midX, ty],
      ['L', tx, ty]
    ]
    midpoint = { x: midX, y: (sy + ty) / 2 }
    tipAngle = Math.atan2(0, tx - midX)
  } else if (mode === 'bezier') {
    // Smooth Bézier curve with tension
    const dist = Math.hypot(dx, dy)
    const tension = Math.min(Math.max(dist * 0.45, 40), 320)
    
    // Choose control offsets based on relative positions
    const cp1x = controls?.[0].x ?? sx + (Math.abs(dx) > Math.abs(dy) ? (dx > 0 ? tension : -tension * 0.3) : 0)
    const cp1y = controls?.[0].y ?? sy + (Math.abs(dy) >= Math.abs(dx) ? (dy > 0 ? tension : -tension * 0.3) : 0)
    const cp2x = controls?.[1].x ?? tx - (Math.abs(dx) > Math.abs(dy) ? (dx > 0 ? tension : -tension * 0.3) : 0)
    const cp2y = controls?.[1].y ?? ty - (Math.abs(dy) >= Math.abs(dx) ? (dy > 0 ? tension : -tension * 0.3) : 0)

    commands = [['M', sx, sy], ['C', cp1x, cp1y, cp2x, cp2y, tx, ty]]
    
    // Midpoint along cubic Bézier at t=0.5
    const t = 0.5
    const mt = 1 - t
    const mx = mt * mt * mt * sx + 3 * mt * mt * t * cp1x + 3 * mt * t * t * cp2x + t * t * t * tx
    const my = mt * mt * mt * sy + 3 * mt * mt * t * cp1y + 3 * mt * t * t * cp2y + t * t * t * ty
    midpoint = { x: mx, y: my }

    // Derivative at t=1.0 for tip angle
    const dtx = 3 * (tx - cp2x)
    const dty = 3 * (ty - cp2y)
    tipAngle = Math.atan2(dty, dtx)
  }

  // The control-point hull conservatively contains cubic curves as well as
  // authored routes. Reuse these coordinates for the terminal tangent so
  // zero-length final segments/control derivatives cannot turn arrows sideways.
  const points: Array<{ x: number; y: number }> = []
  for (const command of commands) {
    for (let i = 1; i < command.length; i += 2) {
      const point = { x: command[i], y: command[i + 1] }
      if (![point.x, point.y].every(Number.isFinite)) throw new Error('Edge route exceeds finite geometry.')
      points.push(point)
    }
  }
  for (let i = points.length - 2; i >= 0; i--) {
    const terminalDx = tx - points[i].x
    const terminalDy = ty - points[i].y
    if (Math.hypot(terminalDx, terminalDy) > 1e-9) {
      tipAngle = Math.atan2(terminalDy, terminalDx)
      break
    }
  }
  const minX = Math.min(...points.map(point => point.x)) - 10
  const minY = Math.min(...points.map(point => point.y)) - 10
  const maxX = Math.max(...points.map(point => point.x)) + 10
  const maxY = Math.max(...points.map(point => point.y)) + 10
  if (![minX, minY, maxX, maxY, maxX - minX, maxY - minY, midpoint.x, midpoint.y, tipAngle].every(Number.isFinite)) {
    throw new Error('Edge route exceeds finite geometry.')
  }

  return {
    pathCommands: commands,
    bounds: { x: minX, y: minY, width: Math.max(20, maxX - minX), height: Math.max(20, maxY - minY) },
    midpoint,
    tipPoint: { x: tx, y: ty },
    tipAngle
  }
}

/**
 * Generates Display List v2 operations representing a rendered edge.
 */
export function createEdgeRenderOps(
  edge: GraphEdge,
  sourcePos: { x: number; y: number },
  targetPos: { x: number; y: number },
  nextOpId: () => number
): any[] {
  const color = edge.style?.stroke || EDGE_KIND_COLORS[edge.kind] || '#3b82f6'
  const strokeColor = normalizeColor8(color)
  const strokeWidth = edge.style?.strokeWidth ?? 2.5
  if (!Number.isFinite(strokeWidth) || strokeWidth < 0) throw new Error('Edge stroke width must be finite and nonnegative.')
  const showArrow = edge.style?.showArrow !== false

  const route = computeEdgeRoute(
    sourcePos.x,
    sourcePos.y,
    targetPos.x,
    targetPos.y,
    edge.route.mode,
    edge.route.waypoints,
    edge.route.controls
  )

  const extraStrokeOutset = Math.max(0, strokeWidth / 2 - 10)
  const paintBounds = { x: route.bounds.x - extraStrokeOutset, y: route.bounds.y - extraStrokeOutset,
    width: route.bounds.width + extraStrokeOutset * 2, height: route.bounds.height + extraStrokeOutset * 2 }
  if (!Object.values(paintBounds).every(Number.isFinite)) throw new Error('Edge stroke exceeds finite geometry.')

  const ops: any[] = [
    {
      type: 'vector',
      object: {
        id: `edge-${edge.id}-${nextOpId()}`,
        kind: 'vector',
        bounds: paintBounds,
        visible: true,
        opacity: 1,
        blendMode: 'normal',
        payload: {
          commands: route.pathCommands,
          fill: '#00000000',
          stroke: strokeColor,
          strokeWidth,
          vectorFillRule: 'nonzero'
        },
        transform: [1, 0, 0, 1, 0, 0]
      }
    }
  ]

  // Render arrowhead if requested
  if (showArrow) {
    const headLen = 10
    const arrowAngle = Math.PI / 6
    const { x: tx, y: ty } = route.tipPoint
    const angle = route.tipAngle

    const p1x = tx - headLen * Math.cos(angle - arrowAngle)
    const p1y = ty - headLen * Math.sin(angle - arrowAngle)
    const p2x = tx - headLen * Math.cos(angle + arrowAngle)
    const p2y = ty - headLen * Math.sin(angle + arrowAngle)

    ops.push({
      type: 'vector',
      object: {
        id: `edge-head-${edge.id}-${nextOpId()}`,
        kind: 'vector',
        bounds: {
          x: Math.min(tx, p1x, p2x) - 0.5,
          y: Math.min(ty, p1y, p2y) - 0.5,
          width: Math.max(tx, p1x, p2x) - Math.min(tx, p1x, p2x) + 1,
          height: Math.max(ty, p1y, p2y) - Math.min(ty, p1y, p2y) + 1
        },
        visible: true,
        opacity: 1,
        blendMode: 'normal',
        payload: {
          commands: [
            ['M', tx, ty],
            ['L', p1x, p1y],
            ['L', p2x, p2y],
            ['Z']
          ],
          fill: strokeColor,
          stroke: strokeColor,
          strokeWidth: 1,
          vectorFillRule: 'nonzero'
        },
        transform: [1, 0, 0, 1, 0, 0]
      }
    })
  }

  // Render socket anchor dots at endpoints
  const dotR = 3.5
  ops.push(
    {
      type: 'vector',
      object: {
        id: `edge-src-dot-${edge.id}-${nextOpId()}`,
        kind: 'vector',
        bounds: { x: sourcePos.x - dotR - 0.5, y: sourcePos.y - dotR - 0.5, width: dotR * 2 + 1, height: dotR * 2 + 1 },
        visible: true,
        opacity: 0.9,
        blendMode: 'normal',
        payload: {
          commands: [
            ['M', sourcePos.x - dotR, sourcePos.y],
            ['C', sourcePos.x - dotR, sourcePos.y - dotR * 0.55, sourcePos.x - dotR * 0.55, sourcePos.y - dotR, sourcePos.x, sourcePos.y - dotR],
            ['C', sourcePos.x + dotR * 0.55, sourcePos.y - dotR, sourcePos.x + dotR, sourcePos.y - dotR * 0.55, sourcePos.x + dotR, sourcePos.y],
            ['C', sourcePos.x + dotR, sourcePos.y + dotR * 0.55, sourcePos.x + dotR * 0.55, sourcePos.y + dotR, sourcePos.x, sourcePos.y + dotR],
            ['C', sourcePos.x - dotR * 0.55, sourcePos.y + dotR, sourcePos.x - dotR, sourcePos.y + dotR * 0.55, sourcePos.x - dotR, sourcePos.y],
            ['Z']
          ],
          fill: strokeColor,
          stroke: '#ffffffff',
          strokeWidth: 1,
          vectorFillRule: 'nonzero'
        },
        transform: [1, 0, 0, 1, 0, 0]
      }
    }
  )

  return ops
}
