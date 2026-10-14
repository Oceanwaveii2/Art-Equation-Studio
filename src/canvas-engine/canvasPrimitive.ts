/**
 * CanvasPrimitive Segregation (Dual-Engine Preparation)
 *
 * Enforces strict separation between vector primitives (handled by Vello GPU/CPU)
 * and raster images (staged for Bevy 2D instanced quad / hardware TMU presentation).
 * Images NEVER touch vello::Scene::draw_image().
 */

import type { CanvasVectorCommand } from './contracts'

export type CanvasTransform = Readonly<{
  translation: readonly [number, number]
  scale: number
  rotation: number
}>

export type RasterImageDescriptor = Readonly<{
  assetId: string | number
  bounds: readonly [number, number, number, number] // [minX, minY, maxX, maxY] in world space
  transform: CanvasTransform
  opacity: number
  /** Sparse Virtual Texturing (SVT) / Tier 2 Tiled Resources streaming parameters */
  sparseTiling?: Readonly<{
    lod: number
    tileSize: number
    resident: boolean
  }>
}>

export type Direct3D12PipelineProfile = Readonly<{
  backend: 'wgpu-direct3d12'
  tiledResourcesTier2: boolean
  waveIntrinsics: boolean
  directStorageGDeflate: boolean
  videoDecoderInterop: boolean
  openclDeprecated: true
  qualification: string
}>

export type VectorPrimitiveDescriptor = Readonly<{
  id: string
  commands: readonly CanvasVectorCommand[]
  strokeWidth: number
  strokeColor: string
  fillColor?: string
  transform: readonly [number, number, number, number, number, number]
  fillRule?: 'nonzero' | 'evenodd'
}>

export type RichTextDescriptor = Readonly<{
  textLayoutId: string | number
  text: string
  transform: readonly [number, number, number, number, number, number]
}>

export type CanvasPrimitive =
  | Readonly<{ kind: 'vectorPath'; vector: VectorPrimitiveDescriptor }>
  | Readonly<{ kind: 'richText'; text: RichTextDescriptor }>
  | Readonly<{ kind: 'rasterImage'; image: RasterImageDescriptor }>

export class CanvasFrameDrawList {
  readonly vectorPrimitives: VectorPrimitiveDescriptor[] = []
  readonly richTextPrimitives: RichTextDescriptor[] = []
  readonly rasterImages: RasterImageDescriptor[] = []

  /**
   * Pushes a primitive into the appropriate segregated collector.
   * Guarantees raster images are NEVER passed to the vector renderer.
   */
  push(primitive: CanvasPrimitive): void {
    switch (primitive.kind) {
      case 'vectorPath':
        this.vectorPrimitives.push(primitive.vector)
        break
      case 'richText':
        this.richTextPrimitives.push(primitive.text)
        break
      case 'rasterImage':
        this.rasterImages.push(primitive.image)
        break
    }
  }

  /**
   * Segregates an array of generic canvas items or primitives into
   * dedicated vector vs. raster collections.
   */
  static segregate(primitives: readonly CanvasPrimitive[]): CanvasFrameDrawList {
    const list = new CanvasFrameDrawList()
    for (const prim of primitives) {
      list.push(prim)
    }
    return list
  }

  clear(): void {
    this.vectorPrimitives.length = 0
    this.richTextPrimitives.length = 0
    this.rasterImages.length = 0
  }

  get totalCount(): number {
    return this.vectorPrimitives.length + this.richTextPrimitives.length + this.rasterImages.length
  }
}

/**
 * Binary packed card buffer for high-throughput zero-copy serialization of 10,000+ cards.
 * Layout per card (32 bytes / 8 x 32-bit words):
 * [0..3]: bounds [minX, minY, maxX, maxY] (f32)
 * [4]: opacity (f32)
 * [5]: lod (u8), flags (u8), resident (u8), _pad (u8)
 * [6]: scale (f32)
 * [7]: assetId numeric hash (u32)
 */
export class PackedCardBuffer {
  static readonly BYTES_PER_CARD = 32
  readonly buffer: ArrayBuffer
  readonly f32: Float32Array
  readonly u32: Uint32Array
  readonly u8: Uint8Array
  private count = 0

  constructor(capacity = 10000) {
    this.buffer = new ArrayBuffer(capacity * PackedCardBuffer.BYTES_PER_CARD)
    this.f32 = new Float32Array(this.buffer)
    this.u32 = new Uint32Array(this.buffer)
    this.u8 = new Uint8Array(this.buffer)
  }

  get cardCount(): number {
    return this.count
  }

  writeCard(
    minX: number,
    minY: number,
    maxX: number,
    maxY: number,
    opacity = 1.0,
    lod = 0,
    assetIdHash = 0
  ): void {
    const offset = this.count * 8
    this.f32[offset + 0] = minX
    this.f32[offset + 1] = minY
    this.f32[offset + 2] = maxX
    this.f32[offset + 3] = maxY
    this.f32[offset + 4] = opacity
    this.u8[(offset + 5) * 4 + 0] = lod & 0xff
    this.u8[(offset + 5) * 4 + 1] = 1 // resident flag
    this.f32[offset + 6] = 1.0 // scale
    this.u32[offset + 7] = assetIdHash
    this.count++
  }

  reset(): void {
    this.count = 0
  }

  getByteView(): Uint8Array {
    return new Uint8Array(this.buffer, 0, this.count * PackedCardBuffer.BYTES_PER_CARD)
  }
}

export type AtlasBatch = Readonly<{
  atlasId: string | number
  count: number
  images: readonly RasterImageDescriptor[]
}>

/**
 * Groups raster image primitives by texture atlas to collapse draw calls.
 */
export function batchRasterImagesByAtlas(
  images: readonly RasterImageDescriptor[]
): AtlasBatch[] {
  const map = new Map<string | number, RasterImageDescriptor[]>()
  for (let i = 0; i < images.length; i++) {
    const img = images[i]
    const key = img.assetId
    let group = map.get(key)
    if (!group) {
      group = []
      map.set(key, group)
    }
    group.push(img)
  }
  const batches: AtlasBatch[] = []
  for (const [atlasId, list] of map.entries()) {
    batches.push({ atlasId, count: list.length, images: list })
  }
  return batches
}

