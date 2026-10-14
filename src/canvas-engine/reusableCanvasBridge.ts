import type {
  CanvasHostCommand,
  CanvasSceneChangeSet,
  CanvasSceneSnapshot,
  CanvasTelemetryEvent,
  CanvasViewport,
} from './contracts'

/** Host-neutral identifier. Consumers map it to their own project/document IDs. */
export type CanvasDocumentAddress = Readonly<{
  projectId: string
  documentId: string
  sceneId: string
}>

/** The bridge reserves spatial placement without requiring a 3D renderer now. */
export type CanvasPlacement =
  | Readonly<{ kind: 'plane-2d'; x: number; y: number; rotation: number }>
  | Readonly<{ kind: 'plane-3d'; matrix: readonly [number, number, number, number, number, number, number, number, number, number, number, number, number, number, number, number] }>

export type CanvasBridgeCapabilities = Readonly<{
  renderer: 'vello-gpu' | 'vello-cpu'
  dimensions: readonly ('2d' | '3d')[]
  transientCamera: boolean
  nestedScenes: boolean
  incrementalChanges: boolean
}>

export type CanvasBridgeState = Readonly<{
  address: CanvasDocumentAddress
  viewport: CanvasViewport
  placement: CanvasPlacement
  selection: readonly string[]
}>

/** Implemented by Art Equation, Eclipse Documentation Hub, or Nana Banana.
 * The reusable canvas never imports a consumer's React stores or persistence. */
export interface CanvasBridgeHost {
  loadScene(address: CanvasDocumentAddress, signal: AbortSignal): Promise<CanvasSceneSnapshot>
  commit(command: CanvasHostCommand): void
  resolveAsset(assetId: string, revision: number, signal: AbortSignal): Promise<string>
  saveNavigation(state: CanvasBridgeState): void
  recordTelemetry(event: CanvasTelemetryEvent): void
}

/** Implemented by a canvas runtime. Vello GPU and Vello CPU share this contract without changing consumer adapters. */
export interface ReusableCanvasRuntime {
  readonly capabilities: CanvasBridgeCapabilities
  open(host: CanvasBridgeHost, initial: CanvasBridgeState, signal: AbortSignal): Promise<CanvasSceneSnapshot>
  applyChanges(changes: CanvasSceneChangeSet): void
  setViewport(viewport: CanvasViewport, transient: boolean): void
  setPlacement(placement: CanvasPlacement): void
  setSelection(objectIds: readonly string[]): void
  close(): void
}

/** Small stateful coordinator shared by host adapters. It contains no rendering,
 * storage, board, document, or application-specific policy. */
export class ReusableCanvasBridge {
  #runtime: ReusableCanvasRuntime
  #host: CanvasBridgeHost
  #state: CanvasBridgeState | null = null

  constructor(runtime: ReusableCanvasRuntime, host: CanvasBridgeHost) {
    this.#runtime = runtime
    this.#host = host
  }

  get capabilities() { return this.#runtime.capabilities }
  get state() { return this.#state }

  async open(initial: CanvasBridgeState, signal: AbortSignal) {
    const scene = await this.#runtime.open(this.#host, initial, signal)
    this.#state = initial
    return scene
  }

  updateNavigation(update: Partial<Pick<CanvasBridgeState, 'viewport' | 'placement' | 'selection'>>, transient = false) {
    if (!this.#state) return
    this.#state = { ...this.#state, ...update }
    if (update.viewport) this.#runtime.setViewport(update.viewport, transient)
    if (update.placement) this.#runtime.setPlacement(update.placement)
    if (update.selection) this.#runtime.setSelection(update.selection)
    if (!transient) this.#host.saveNavigation(this.#state)
  }

  applyChanges(changes: CanvasSceneChangeSet) {
    this.#runtime.applyChanges(changes)
  }

  close() {
    this.#runtime.close()
    this.#state = null
  }
}
