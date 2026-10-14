/**
 * ViewportCamera Mathematical Model (Standardized Canvas Camera)
 *
 * Provides sub-pixel accurate world-to-screen transforms, screen-to-world unprojection,
 * and zero-cost frustum / AABB culling shared across Vello and Bevy engines.
 */

import type { CanvasRect, CanvasViewport } from './contracts'

export type BoundingBoxAABB = readonly [number, number, number, number] // [minX, minY, maxX, maxY]

export class ViewportCamera {
  /** Canvas center in world coordinates [cx, cy] */
  readonly position: readonly [number, number]
  /** Camera zoom scale (1.0 = 100%, 0.5 = Zoomed in, 2.0 = Zoomed out) */
  readonly zoom: number
  /** Screen / viewport dimension in physical pixels [width, height] */
  readonly viewportSize: readonly [number, number]

  constructor(
    position: readonly [number, number] = [0, 0],
    zoom = 1.0,
    viewportSize: readonly [number, number] = [1920, 1080]
  ) {
    if (!Number.isFinite(zoom) || zoom <= 0) {
      throw new Error(`ViewportCamera zoom must be a positive finite number, got: ${zoom}`)
    }
    if (!Number.isFinite(position[0]) || !Number.isFinite(position[1])) {
      throw new Error(`ViewportCamera position coordinates must be finite: [${position[0]}, ${position[1]}]`)
    }
    if (viewportSize[0] < 0 || viewportSize[1] < 0) {
      throw new Error(`ViewportCamera viewport size must be non-negative: [${viewportSize[0]}, ${viewportSize[1]}]`)
    }
    this.position = [position[0], position[1]]
    this.zoom = zoom
    this.viewportSize = [viewportSize[0], viewportSize[1]]
  }

  /**
   * Generates world-space AABB [minX, minY, maxX, maxY] for zero-cost frustum culling.
   */
  visibleWorldBounds(): BoundingBoxAABB {
    const halfW = (this.viewportSize[0] * this.zoom) / 2.0
    const halfH = (this.viewportSize[1] * this.zoom) / 2.0
    return [
      this.position[0] - halfW,
      this.position[1] - halfH,
      this.position[0] + halfW,
      this.position[1] + halfH,
    ]
  }

  /**
   * Converts world coordinates to Vello 2D affine matrix [sx, kx, ky, sy, tx, ty].
   * Translates world center to viewport center and scales by (1.0 / zoom).
   */
  toVelloAffine(): readonly [number, number, number, number, number, number] {
    const invZoom = 1.0 / this.zoom
    const tx = -this.position[0] * invZoom + this.viewportSize[0] / 2.0
    const ty = -this.position[1] * invZoom + this.viewportSize[1] / 2.0
    return [invZoom, 0, 0, invZoom, tx, ty]
  }

  /**
   * Evaluates if an entity's world bounding box [minX, minY, maxX, maxY]
   * intersects the camera's visible frustum.
   */
  intersectsFrustum(aabb: BoundingBoxAABB): boolean {
    const cam = this.visibleWorldBounds()
    return !(
      aabb[2] < cam[0] || // right < left
      aabb[0] > cam[2] || // left > right
      aabb[3] < cam[1] || // bottom < top
      aabb[1] > cam[3]    // top > bottom
    )
  }

  /**
   * Evaluates if a CanvasRect intersects the camera's visible frustum.
   */
  intersectsRect(rect: CanvasRect): boolean {
    const aabb: BoundingBoxAABB = [
      rect.x,
      rect.y,
      rect.x + rect.width,
      rect.y + rect.height,
    ]
    return this.intersectsFrustum(aabb)
  }

  /**
   * Unprojects a screen-space point to canvas world-space coordinates.
   */
  screenToWorld(screenPt: readonly [number, number]): readonly [number, number] {
    return [
      this.position[0] + (screenPt[0] - this.viewportSize[0] / 2.0) * this.zoom,
      this.position[1] + (screenPt[1] - this.viewportSize[1] / 2.0) * this.zoom,
    ]
  }

  /**
   * Projects a canvas world-space point to screen-space pixel coordinates.
   */
  worldToScreen(worldPt: readonly [number, number]): readonly [number, number] {
    const invZoom = 1.0 / this.zoom
    return [
      (worldPt[0] - this.position[0]) * invZoom + this.viewportSize[0] / 2.0,
      (worldPt[1] - this.position[1]) * invZoom + this.viewportSize[1] / 2.0,
    ]
  }

  /**
   * Constructs a ViewportCamera from legacy CanvasViewport {x, y, scale}.
   * Note: in legacy CanvasViewport, x, y represent pan offset and scale is 1/zoom.
   */
  static fromViewport(
    viewport: CanvasViewport,
    viewportSize: readonly [number, number] = [1920, 1080]
  ): ViewportCamera {
    const zoom = viewport.scale > 0 ? 1.0 / viewport.scale : 1.0
    // World position from pan offset:
    const position: [number, number] = [
      (viewportSize[0] / 2.0 - viewport.x) * zoom,
      (viewportSize[1] / 2.0 - viewport.y) * zoom,
    ]
    return new ViewportCamera(position, zoom, viewportSize)
  }

  /**
   * Converts to legacy CanvasViewport representation.
   */
  toViewport(): CanvasViewport {
    const scale = 1.0 / this.zoom
    const x = this.viewportSize[0] / 2.0 - this.position[0] * scale
    const y = this.viewportSize[1] / 2.0 - this.position[1] * scale
    return { x, y, scale }
  }

  /**
   * Computes Sparse Virtual Texturing (SVT) Mip/LOD level based on camera zoom.
   * Zoom = 1.0 -> LOD 0 (full resolution)
   * Zoom = 2.0 (zoomed out 0.5x) -> LOD 1 (half resolution)
   * Zoom = 4.0 (zoomed out 0.25x) -> LOD 2 (quarter resolution)
   */
  computeTileLOD(maxLod = 5): number {
    if (this.zoom <= 1.0 || !Number.isFinite(this.zoom)) return 0
    const lod = Math.floor(Math.log2(this.zoom))
    return Math.min(Math.max(0, lod), maxLod)
  }

  /**
   * Fast hierarchical spatial culling against a SpatialQuadtree.
   * Discards entire off-screen spatial branches in O(log N) time, bypassing flat O(N) linear scans.
   */
  cullQuadtree(quadtree: SpatialQuadtree): SpatialQuadtreeItem[] {
    return quadtree.queryFrustum(this)
  }
}

export interface SpatialQuadtreeItem {
  readonly id: string | number
  readonly bounds: BoundingBoxAABB
}

/**
 * 2D Loose Quadtree Spatial Index for high-density infinite canvas boards (10,000+ entities).
 * Eliminates linear O(N) frustum culling overhead by pruning off-screen quadrants in O(log N) time.
 */
export class SpatialQuadtree {
  readonly bounds: BoundingBoxAABB
  readonly maxItems: number
  readonly maxDepth: number
  readonly depth: number
  private items: SpatialQuadtreeItem[] = []
  private children: [SpatialQuadtree, SpatialQuadtree, SpatialQuadtree, SpatialQuadtree] | null = null

  constructor(
    bounds: BoundingBoxAABB = [-100000, -100000, 100000, 100000],
    maxItems = 32,
    maxDepth = 8,
    depth = 0
  ) {
    this.bounds = bounds
    this.maxItems = maxItems
    this.maxDepth = maxDepth
    this.depth = depth
  }

  insert(item: SpatialQuadtreeItem): boolean {
    const [minX, minY, maxX, maxY] = this.bounds
    const [iMinX, iMinY, iMaxX, iMaxY] = item.bounds

    // Check if item intersects node bounds
    if (iMaxX < minX || iMinX > maxX || iMaxY < minY || iMinY > maxY) {
      return false
    }

    if (this.children) {
      let inserted = false
      for (let i = 0; i < 4; i++) {
        if (this.children[i].insert(item)) {
          inserted = true
        }
      }
      return inserted
    }

    this.items.push(item)

    if (this.items.length > this.maxItems && this.depth < this.maxDepth) {
      this.subdivide()
    }
    return true
  }

  private subdivide(): void {
    const [minX, minY, maxX, maxY] = this.bounds
    const midX = (minX + maxX) / 2
    const midY = (minY + maxY) / 2
    const nextDepth = this.depth + 1

    this.children = [
      new SpatialQuadtree([minX, minY, midX, midY], this.maxItems, this.maxDepth, nextDepth),
      new SpatialQuadtree([midX, minY, maxX, midY], this.maxItems, this.maxDepth, nextDepth),
      new SpatialQuadtree([minX, midY, midX, maxY], this.maxItems, this.maxDepth, nextDepth),
      new SpatialQuadtree([midX, midY, maxX, maxY], this.maxItems, this.maxDepth, nextDepth),
    ]

    const existing = this.items
    this.items = []
    for (const item of existing) {
      for (let i = 0; i < 4; i++) {
        this.children[i].insert(item)
      }
    }
  }

  /**
   * Queries visible items intersecting the camera view frustum in O(log N) time.
   */
  queryFrustum(
    camera: ViewportCamera,
    visitedSet = new Set<string | number>(),
    out: SpatialQuadtreeItem[] = []
  ): SpatialQuadtreeItem[] {
    if (!camera.intersectsFrustum(this.bounds)) {
      return out
    }

    for (let i = 0; i < this.items.length; i++) {
      const item = this.items[i]
      if (!visitedSet.has(item.id)) {
        visitedSet.add(item.id)
        if (camera.intersectsFrustum(item.bounds)) {
          out.push(item)
        }
      }
    }

    if (this.children) {
      for (let i = 0; i < 4; i++) {
        this.children[i].queryFrustum(camera, visitedSet, out)
      }
    }

    return out
  }

  clear(): void {
    this.items.length = 0
    this.children = null
  }
}
