import type { CanvasSceneObject, CanvasSceneSnapshot } from '../canvas-engine/contracts'

type Rect = CanvasSceneObject['bounds']
const CELL_SIZE = 256, MAX_CELLS = 64
// App.css .studio-shell .board-node.selected uses 0 14px 34px. These lengths are transformed
// with .board-world, so they are board units, not CSS pixels / camera scale.
// 96 units exceed the active skin's 14 + 2*34 shadow extent plus border/handles.
// The current App fisheyeScale returns 1; an enabled magnification skin will
// need an explicit layout/paint contract rather than this temporary guard.
const DOM_PAINT_OUTSET_WORLD = 96

function intersects(a: Rect, b: Rect) {
  if (a.width <= 0 || a.height <= 0 || b.width <= 0 || b.height <= 0) return false
  return a.x < b.x + b.width && a.x + a.width > b.x && a.y < b.y + b.height && a.y + a.height > b.y
}

function paintBounds(object: CanvasSceneObject, scale: number): Rect | undefined {
  // App.css places frame headers at (-1, -29), with height 27, min-width
  // 130 and width:max-content. The DTO has no measured title/header width.
  // Until canonical layout supplies it, no finite guessed frame envelope can
  // certify DOM/GPU interleaving. Keep this mixed batch closed for frames.
  if (object.kind === 'container' && object.role === 'frame') return undefined
  // Ellipse captions use overflow:visible and arbitrary unwrapped SVG text.
  // Their saved frame cannot bound glyph paint. Until measured text layout is
  // shared, keep the mixed background batch closed just as for frame headers.
  if (object.hasShapeCaption) return undefined
  const geometry = object.preparedVectorGeometry
  // A refused line can have authored endpoints outside its saved frame. No
  // guessed card envelope may certify interleaving with that DOM base stroke.
  if (object.kind === 'vector' && object.shapeType === 'line' && geometry && geometry.status !== 'ready') return undefined
  // A captioned path's ready geometry describes its path, not its DOM text.
  // The adapter bounds union the rotated caption viewport with that geometry.
  // Without this compiled union, a saved box cannot certify a caption blocker.
  if ((object.hasDiagramCaption || object.hasShapeCaption) && geometry?.status !== 'ready') return undefined
  if (object.kind === 'vector' && geometry?.status === 'ready' && !object.hasDiagramCaption && !object.hasShapeCaption) {
    // The model adapter already flattened the authored affine/Boolean geometry.
    // Layout bounds alone do not enclose skewed or translated inner paths.
    if (!geometry.bounds) return { x: 0, y: 0, width: 0, height: 0 }
    const padding = geometry.strokeOutsetCssPx / scale
    const { x, y, width, height } = geometry.bounds
    const rect = { x: x - padding, y: y - padding, width: width + padding * 2, height: height + padding * 2 }
    if (![rect.x, rect.y, rect.width, rect.height, rect.x + rect.width, rect.y + rect.height].every(Number.isFinite)) return undefined
    return rect
  }
  // An uncompiled inner transform cannot be bounded by the node's layout box.
  // Fail the background batch closed rather than changing DOM/GPU layer order.
  if ((object.vectorTransform || object.vectorBoolean) && geometry?.status !== 'ready') return undefined
  const { x, y, width, height } = object.bounds
  if (![x, y, width, height, x + width, y + height].every(Number.isFinite) || width < 0 || height < 0) return undefined
  // SVG paths have a non-scaling stroke; include a conservative default-miter
  // envelope. DOM cards also retain borders/shadows outside their layout box.
  const stroke = object.appearance.strokeWidth ?? 2
  if (!Number.isFinite(stroke) || stroke < 0) return undefined
  // Pre-compiler flat path DTOs also use the transparent SVG path skin in
  // App.css (.node-shape:has(.node-vector-shape)), not the DOM card shadow.
  const legacyPathSkin = object.kind === 'vector' && !geometry && object.vectorPath
    && !object.vectorBoolean && !object.vectorTransform && !object.appearance.rotation
    && !object.hasDiagramCaption && !object.hasShapeCaption && (!object.shapeType || object.shapeType === 'path')
  const padding = legacyPathSkin ? Math.max(stroke * 2 + 1, 16) / scale
    : object.kind === 'vector' ? Math.max((stroke * 2 + 1) / scale, DOM_PAINT_OUTSET_WORLD)
    : DOM_PAINT_OUTSET_WORLD
  const rect = { x: x - padding, y: y - padding, width: width + padding * 2, height: height + padding * 2 }
  if (![rect.x, rect.y, rect.width, rect.height, rect.x + rect.width, rect.y + rect.height].every(Number.isFinite)) return undefined
  return rect
}

function cells(rect: Rect): string[] | undefined {
  const x0 = Math.floor(rect.x / CELL_SIZE), x1 = Math.floor((rect.x + rect.width) / CELL_SIZE)
  const y0 = Math.floor(rect.y / CELL_SIZE), y1 = Math.floor((rect.y + rect.height) / CELL_SIZE)
  if (![x0, x1, y0, y1].every(Number.isSafeInteger)) return undefined
  if ((x1 - x0 + 1) * (y1 - y0 + 1) > MAX_CELLS) return undefined
  const result: string[] = []
  for (let x = x0; x <= x1; x++) for (let y = y0; y <= y1; y++) result.push(`${x},${y}`)
  return result
}

/** The background batch cannot interleave with overlapping DOM artwork.
 * Exclude unsupported vectors and unbridged edits as well as cards; propagate
 * exclusion through overlapping paths so fallback never changes layer order.
 * This guarded batch is deliberately smaller than a complete scene backend. */
export function eligibleVelloObjects(scene: CanvasSceneSnapshot, selectedIds: readonly string[], cameraScale = 1, liveEdits = false): readonly CanvasSceneObject[] {
  if (!Number.isFinite(cameraScale) || cameraScale <= 0) return []
  const selected = new Set(liveEdits ? [] : selectedIds), bounds = new Map<string, Rect>()
  const candidates = new Set<string>(), blockers: CanvasSceneObject[] = []
  const buckets = new Map<string, string[]>(), overflow: string[] = []
  for (const object of scene.objects) {
    if (object.hidden) continue
    const rect = paintBounds(object, cameraScale)
    // An invalid visible envelope prevents a truthful overlap decision.
    if (!rect || bounds.has(object.id)) return []
    bounds.set(object.id, rect)
    // Locks constrain mutations, not rendering. A live scene source forwards
    // editing transactions; callers without it keep synchronous selected paint.
    const prepared = object.preparedVectorGeometry?.status === 'ready'
    const legacyFlat = !object.preparedVectorGeometry && object.parentId === undefined
      && Boolean(object.vectorPath?.points.length) && !object.vectorBoolean && !object.vectorTransform
      && !object.appearance.rotation
    const approximation = object.preparedVectorGeometry?.status === 'ready' ? object.preparedVectorGeometry.approximation : undefined
    const scaleSupported = !approximation || cameraScale >= approximation.minCssScale && cameraScale <= approximation.maxCssScale
    const supported = object.kind === 'vector' && !object.hasDiagramCaption && !object.hasShapeCaption && object.parentId === undefined && (prepared || legacyFlat) && scaleSupported && !selected.has(object.id)
    if (!supported) { blockers.push(object); continue }
    candidates.add(object.id)
    const keys = cells(rect)
    if (!keys) overflow.push(object.id)
    else for (const key of keys) {
      const bucket = buckets.get(key)
      if (bucket) bucket.push(object.id)
      else buckets.set(key, [object.id])
    }
  }
  const byId = new Map(scene.objects.map(object => [object.id, object]))
  for (let cursor = 0; cursor < blockers.length && candidates.size; cursor++) {
    const blocker = bounds.get(blockers[cursor].id)!
    const keys = cells(blocker)
    const possible = keys ? new Set([...overflow, ...keys.flatMap(key => buckets.get(key) ?? [])]) : candidates
    for (const id of possible) {
      if (candidates.has(id) && intersects(bounds.get(id)!, blocker)) {
        candidates.delete(id)
        // A rejected path returns to DOM ownership and becomes a blocker too.
        blockers.push(byId.get(id)!)
      }
    }
  }
  return scene.objects.filter(object => candidates.has(object.id))
}

/** A complete contribution participates at its canonical object order. Any
 * overlapping uncompiled DOM paint excludes its connected engine batch: one
 * background surface cannot cross the remaining semantic DOM layers. */
export function eligibleCompleteVelloPaint(scene:CanvasSceneSnapshot, completeBounds:ReadonlyMap<string,Rect>, cameraScale:number):ReadonlySet<string> {
  if(!Number.isFinite(cameraScale)||cameraScale<=0)return new Set()
  const candidates=new Set(completeBounds.keys()),bounds=new Map<string,Rect>(),blockers:string[]=[]
  const buckets=new Map<string,string[]>(),overflow:string[]=[]
  for(const object of scene.objects) {
    if(object.hidden)continue
    const rect=completeBounds.get(object.id)??paintBounds(object,cameraScale)
    if(!rect||bounds.has(object.id)||rect.width<0||rect.height<0||![rect.x,rect.y,rect.width,rect.height,rect.x+rect.width,rect.y+rect.height].every(Number.isFinite))return new Set()
    bounds.set(object.id,rect)
    if(!candidates.has(object.id)){blockers.push(object.id);continue}
    const keys=cells(rect)
    if(!keys)overflow.push(object.id)
    else for(const key of keys){const bucket=buckets.get(key);if(bucket)bucket.push(object.id);else buckets.set(key,[object.id])}
  }
  for(let cursor=0;cursor<blockers.length&&candidates.size;cursor++) {
    const blocker=bounds.get(blockers[cursor])!,keys=cells(blocker)
    const possible=keys?new Set([...overflow,...keys.flatMap(key=>buckets.get(key)??[])]):candidates
    for(const id of possible)if(candidates.has(id)&&intersects(bounds.get(id)!,blocker)){candidates.delete(id);blockers.push(id)}
  }
  return candidates
}
