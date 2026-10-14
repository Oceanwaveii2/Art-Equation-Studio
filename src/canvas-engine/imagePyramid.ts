/** Portable derived-image contract. No browser, renderer or native handles. */
export type ImagePyramid = {
  schemaVersion: number; generator: string; sourceSha256: string
  width: number; height: number; tileSize: number; overlap: number; maxLevel: number
  format: string; tilesRelativePath: string; posterRelativePath: string; manifestRelativePath: string
  tileCount: number; generatedBytes: number; displayColorSpace: string
}
export type TileRect = { x: number; y: number; width: number; height: number }
export type PyramidTile = TileRect & { key: string; level: number; col: number; row: number; pixelWidth: number; pixelHeight: number; left: number; top: number; coreWidth: number; coreHeight: number }
export const TILE_ATLAS_EDGE = 4096
export const TILE_SLOT_EDGE = 514
export const TILE_CAPACITY = 49

export function requiredPyramidLevel(p: ImagePyramid, density: number) {
  return Math.max(0, Math.min(p.maxLevel, p.maxLevel + Math.ceil(Math.log2(Math.max(1e-9, density)))))
}

/** Sharpness must reflect visible residency, mip and actual backing allocation. */
export function pyramidDetailState(wanted: number, ready: number, failed: number, level: number, requiredLevel: number, actualDensity: number, requiredDensity: number) {
  if (failed > 0) return 'error'
  if (wanted < 1 || ready < wanted) return 'refining'
  if (level < requiredLevel || actualDensity + 1e-6 < requiredDensity) return 'budget-limited'
  return 'ready'
}

/** Visible tiles stay pinned and ahead of this bounded directional lookahead. */
export function planDirectionalPrefetch(p: ImagePyramid, visible: readonly PyramidTile[], view: TileRect, previous?: TileRect, limit = 2) {
  if (!visible.length || visible.length >= TILE_CAPACITY || limit < 1) return []
  const factor = 2 ** (p.maxLevel - visible[0].level), margin = factor * 512
  const candidates = planPyramid(p, { x: view.x - margin, y: view.y - margin, width: view.width + margin * 2, height: view.height + margin * 2 }, 1 / factor, 10000)
    .filter(tile => !visible.some(item => item.key === tile.key))
  const cx = view.x + view.width / 2, cy = view.y + view.height / 2
  const dx = previous ? cx - previous.x - previous.width / 2 : 0, dy = previous ? cy - previous.y - previous.height / 2 : 0, length = Math.hypot(dx,dy)
  const score = (tile: PyramidTile) => {
    const x = tile.x + tile.width / 2 - cx, y = tile.y + tile.height / 2 - cy
    return (length > 1e-6 ? (x * dx + y * dy) / length : 0) - Math.hypot(x,y)
  }
  return candidates.sort((a,b)=>score(b)-score(a)||a.key.localeCompare(b.key)).slice(0,Math.min(limit,TILE_CAPACITY-visible.length))
}

export function validPyramid(p: ImagePyramid | undefined): p is ImagePyramid {
  if (!p || p.schemaVersion !== 1 || p.tileSize !== 512 || p.overlap !== 1 || p.format !== 'png') return false
  if (![p.width, p.height, p.maxLevel].every(Number.isSafeInteger) || p.width < 1 || p.height < 1 || Math.max(p.width, p.height) > 262144 || p.width * p.height > 1e9 || p.maxLevel !== Math.ceil(Math.log2(Math.max(p.width, p.height)))) return false
  return [p.tilesRelativePath, p.posterRelativePath, p.manifestRelativePath].every(path => typeof path === 'string' && /^projects\/[^/]+\/assets\/pyramids\//.test(path) && path.split('/').every(part => part !== '..' && part !== '.' && !part.includes('\\') && !part.includes(':')))
}

/** Visible source rectangle -> physical-pixel mip, coarsened to fit pinned slots.
 * Half-open edges avoid requesting a spurious tile at exact boundaries. */
export function planPyramid(p: ImagePyramid, view: TileRect, pixelsPerSourcePixel: number, capacity = TILE_CAPACITY): PyramidTile[] {
  const x0 = Math.max(0, view.x), y0 = Math.max(0, view.y)
  const x1 = Math.min(p.width, view.x + view.width), y1 = Math.min(p.height, view.y + view.height)
  if (x1 <= x0 || y1 <= y0 || !Number.isFinite(pixelsPerSourcePixel) || capacity < 1) return []
  let level = requiredPyramidLevel(p, pixelsPerSourcePixel)
  for (;;) {
    const factor = 2 ** (p.maxLevel - level), w = Math.ceil(p.width / factor), h = Math.ceil(p.height / factor)
    const firstCol = Math.floor(x0 / factor / 512), firstRow = Math.floor(y0 / factor / 512)
    const lastCol = Math.min(Math.ceil(w / 512) - 1, Math.ceil(x1 / factor / 512) - 1)
    const lastRow = Math.min(Math.ceil(h / 512) - 1, Math.ceil(y1 / factor / 512) - 1)
    if ((lastCol - firstCol + 1) * (lastRow - firstRow + 1) > capacity && level > 0) { level--; continue }
    const tiles: PyramidTile[] = []
    for (let row = firstRow; row <= lastRow; row++) for (let col = firstCol; col <= lastCol; col++) {
      const coreWidth = Math.min(512, w - col * 512), coreHeight = Math.min(512, h - row * 512)
      const left = col > 0 ? 1 : 0, top = row > 0 ? 1 : 0
      tiles.push({ key: `${level}/${col}_${row}.png`, level, col, row, x: col * 512 * factor, y: row * 512 * factor, width: Math.min(coreWidth * factor, p.width - col * 512 * factor), height: Math.min(coreHeight * factor, p.height - row * 512 * factor), pixelWidth: coreWidth + left + Number((col + 1) * 512 < w), pixelHeight: coreHeight + top + Number((row + 1) * 512 < h), left, top, coreWidth, coreHeight })
    }
    const cx = (x0 + x1) / 2, cy = (y0 + y1) / 2
    return tiles.sort((a, b) => Math.hypot(a.x + a.width / 2 - cx, a.y + a.height / 2 - cy) - Math.hypot(b.x + b.width / 2 - cx, b.y + b.height / 2 - cy))
  }
}
