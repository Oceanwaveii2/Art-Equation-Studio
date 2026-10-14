// Mirror Rust's ordered shelf packing before allocating GPU pages.
export const ATLAS_EDGE = 4096
export const ATLAS_PAGE_RESERVE = 3 * ATLAS_EDGE * ATLAS_EDGE * 4
export function plannedAtlasPages(images: readonly { width: number; height: number }[]): number {
  if (!images.length) return 0
  let pages = 1, x = 0, y = 0, row = 0
  for (const image of images) {
    const width = image.width + 2, height = image.height + 2
    if (!Number.isInteger(width) || !Number.isInteger(height) || width < 3 || height < 3 || width > ATLAS_EDGE || height > ATLAS_EDGE)
      throw new Error('GPU_IMAGE_ATLAS_FULL: image exceeds fixed native page')
    if (x + width > ATLAS_EDGE) { x = 0; y += row; row = 0 }
    if (y + height > ATLAS_EDGE) {
      if (++pages > 4) throw new Error('GPU_IMAGE_ATLAS_FULL: native page budget exceeded')
      x = 0; y = 0; row = 0
    }
    x += width
    row = Math.max(row, height)
  }
  return pages
}
