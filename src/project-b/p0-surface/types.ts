export type VelloBackend = 'gpu' | 'cpu'
export type VelloFrame = {
  generation: number
  snapshot: string
  displayList?: import('../../canvas-engine/paintDisplayList').PreparedPaintDisplayList
  width: number
  height: number
  scale: number
  panX: number
  panY: number
  /** Immutable canonical premultiplied sRGB pixels; never GPU readback. */
  images?: readonly DecodedImageUpload[]
}
export type FrameMetadata = Record<string, unknown> & { width: number; height: number }
export type GpuSession = {
  canvas: HTMLCanvasElement
  prepare(frame: VelloFrame): Promise<FrameMetadata>
  present(): FrameMetadata
  discard(): void
  dispose(): void
  destroyForTest?(): void
  checkHealth?(): void
}
export type CpuSession = {
  render(frame: VelloFrame): Promise<{ pixels: Uint8Array<ArrayBuffer>; metadata: FrameMetadata; release?():void }>
  dispose(): void
  reusableSurfaceBytes?(): number
}
export type PresenterCallbacks = {
  accepted(result: { generation: number; backend: VelloBackend; canvas: HTMLCanvasElement; metadata: FrameMetadata; frame: VelloFrame }): void
  error(result: { generation: number; backend: VelloBackend; error: string }): void
  state?(result: { backend: VelloBackend; state: 'loading' | 'ready' | 'fallback' | 'paused' | 'error'; reason?: string }): void
  /** Includes recovery/health retries of a previously accepted frame. */
  preparing?(generation:number):void
  /** Snapshot/image pins may retire only when neither an active transport nor
   * queued fallback/recovery attempt still owns this generation. */
  settled?(generation:number):void
}
export type PresenterDependencies = {
  createCanvas(): HTMLCanvasElement
  createGpu(canvas: HTMLCanvasElement): Promise<GpuSession>
  createCpu(): CpuSession
  hidden(): boolean
  watchHealth(check: () => void): () => void
}
import type { DecodedImageUpload } from '../../canvas-engine/paintDisplayList'
