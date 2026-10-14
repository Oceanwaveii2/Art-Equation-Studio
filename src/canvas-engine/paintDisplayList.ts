import type { CanvasVectorCommand } from './contracts'

export type PaintMatrix = readonly [number, number, number, number, number, number]
export type DecodedImageReference = Readonly<{ key: string; revision: number; epoch: number; width: number; height: number }>
export type DecodedImageUpload = Readonly<{ reference: DecodedImageReference; pixels: Uint8Array<ArrayBuffer> }>
export type GradientPaint = Readonly<{
  stops:readonly Readonly<{offset:number;color:string}>[];interpolation:'srgb';alphaInterpolation:'premultiplied'
}> & (Readonly<{kind:'linear';start:readonly [number,number];end:readonly [number,number]}>
  | Readonly<{kind:'radial';center:readonly [number,number];radius:number}>)
export type VectorPaintRecord = Readonly<Record<string, unknown>> & { readonly id: string; readonly kind: 'vector'; readonly order?: number }
export type IsolatedPaintScope = {
  readonly scopeId: string
  readonly commands: readonly CanvasVectorCommand[]
  readonly transform: PaintMatrix
  readonly fillRule: 'nonzero' | 'evenodd'
  /** Explicit isolation: blends inside see this scope's local backdrop. */
  readonly isolation: 'isolated'
}
export type PaintOperation =
  | Readonly<{ type: 'vector'; object: VectorPaintRecord }>
  | Readonly<{ type: 'image'; id: string; resource: DecodedImageReference;
      sourceRect: Readonly<{ x: number; y: number; width: number; height: number }>;
      transform: PaintMatrix; opacity: number; sampling: 'nearest' | 'bilinear' }>
  | Readonly<{type:'gradient';id:string;commands:readonly CanvasVectorCommand[];transform:PaintMatrix;brushTransform:PaintMatrix;fillRule:'nonzero'|'evenodd';gradient:GradientPaint}>
  | Readonly<{type:'blurredRoundedRect';id:string;rect:Readonly<{x:number;y:number;width:number;height:number}>;radius:number;stdDeviation:number;color:string;transform:PaintMatrix}>
  | Readonly<IsolatedPaintScope & { type: 'pushClip' }>
  | Readonly<IsolatedPaintScope & { type: 'pushComposite'; opacity: number; blendMode: 'normal' | 'multiply' | 'screen' | 'destination-out' }>
  | Readonly<{ type: 'pop'; scopeId: string }>
export type PreparedPaintDisplayList = Readonly<{
  schema: 'art-equation.display-list'
  schemaVersion: 2
  sceneId: string
  revision: string
  environment: Readonly<{ background: string; colorSpace: 'srgb' }>
  operations: readonly PaintOperation[]
  resources: readonly DecodedImageReference[]
}>

/** Compile the existing fully guarded vector batch into explicit paint order.
 * Existing identities/project/history remain authoritative. Shared Rust
 * preparation validates every scope, matrix and paint before either backend.
 * Parent ownership is never interpreted as a clip, opacity or extra transform. */
export function compileVectorPaintList(scene: {
  sceneId: string; revision: string; objects: readonly VectorPaintRecord[]
}): PreparedPaintDisplayList {
  const ids = new Set<string>()
  for (const object of scene.objects) {
    if (!object.id || ids.has(object.id) || object.kind !== 'vector' || !Number.isFinite(object.order ?? 0)) {
      throw new Error('DISPLAY_LIST_INVALID: vector identities/order must be valid before compilation')
    }
    ids.add(object.id)
  }
  const ordered = scene.objects.map((object, index) => ({ object, index }))
    .sort((a, b) => (a.object.order ?? 0) - (b.object.order ?? 0) || a.index - b.index)
  return {
    schema: 'art-equation.display-list', schemaVersion: 2, sceneId: scene.sceneId, revision: scene.revision,
    environment: { background: '#00000000', colorSpace: 'srgb' }, resources: [],
    operations: ordered.map(({ object }) => ({ type: 'vector', object })),
  }
}
