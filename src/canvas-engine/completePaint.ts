import type {CanvasRect} from './contracts'
import type {PaintOperation,DecodedImageUpload} from './paintDisplayList'
/** Whole-object paint receipt shared by model providers and compatibility oracles. */
export type CompleteCardPaintResult = Readonly<{
  objectId: string; objectRevision: number; order: number; layoutRevision: number; sourceFingerprint: string
  status: 'ready' | 'unsupported' | 'stale'; completePaint: boolean; operations: readonly PaintOperation[]
  uploads: readonly DecodedImageUpload[]; visualBounds: CanvasRect | null; blockers: readonly string[]
}>

