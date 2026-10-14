export type CanvasPoint = Readonly<{ x: number; y: number }>
export type CanvasSize = Readonly<{ width: number; height: number }>
export type CanvasRect = Readonly<CanvasPoint & CanvasSize>
export type CanvasViewport = Readonly<{ x: number; y: number; scale: number }>

export type CanvasObjectKind = 'container' | 'raster' | 'video' | 'model' | 'document' | 'text' | 'vector' | 'capture' | 'link'
export type CanvasContainerRole = 'column' | 'group' | 'frame'

export type CanvasVectorPoint = Readonly<{
  x: number
  y: number
  handleIn?: CanvasPoint
  handleOut?: CanvasPoint
  handleMode?: 'smooth' | 'corner'
}>

export type CanvasVectorPath = Readonly<{
  version: 1
  closed: boolean
  points: readonly CanvasVectorPoint[]
}>

export type CanvasVectorTransform = Readonly<{
  translateX?: number
  translateY?: number
  scaleX?: number
  scaleY?: number
  skewX?: number
  skewY?: number
}>

export type CanvasVectorBoolean = Readonly<{
  operation: 'union' | 'subtract' | 'intersect' | 'exclude'
  operands: readonly CanvasVectorPath[]
  fillRules?: readonly ('nonzero' | 'evenodd')[]
  resolvedPaths?: readonly CanvasVectorPath[]
}>

/** Exact vector paint derivative; no renderer, camera or editing policy. */
export type CanvasVectorCommand = readonly ['M' | 'L', number, number]
  | readonly ['C', number, number, number, number, number, number]
  | readonly ['Z']

export type CanvasPreparedVectorGeometry =
  | Readonly<{ status: 'ready'; commands: readonly CanvasVectorCommand[]; bounds: CanvasRect | null;
    fillRule: 'nonzero' | 'evenodd'; hasFill: boolean; strokeOutsetCssPx: number;
    /** Plain SVG lines have butt endpoints and a wider transparent hit stroke. */
    primitive?: 'plain-line' | 'ellipse'; hitOutsetCssPx?: number;
    /** Ellipse cubics carry a bounded centerline error, not an exact analytic arc. */
    approximation?: Readonly<{ worldError: number; maxCssScale: number; maxBackingResolution: number; minCssScale: number }>;
    /** Disposable resolved base paint; saved editing styles remain unchanged. */
    effectivePaint?: Readonly<{ fill: string; stroke: string; strokeWidth: number;
      vectorStrokeJoin: 'miter'; vectorStrokeCap: 'butt' }> }>
  | Readonly<{ status: 'unsupported' | 'invalid'; reason: string }>

export type CanvasAppearance = Readonly<{
  fill?: string
  stroke?: string
  text?: string
  opacity: number
  strokeWidth?: number
  strokeScaling?: 'scene' | 'screen'
  vectorFillRule?: 'nonzero' | 'evenodd'
  vectorStrokeJoin?: 'miter' | 'round' | 'bevel'
  vectorStrokeCap?: 'butt' | 'round' | 'square'
  cornerRadius?: number
  rotation: number
}>

export type CanvasAssetHandle = Readonly<{
  id: string
  kind: 'image' | 'video' | 'model' | 'document' | 'other'
  revision: number
}>

export type CanvasSceneObject = Readonly<{
  id: string
  revision: number
  order: number
  kind: CanvasObjectKind
  role?: CanvasContainerRole
  bounds: CanvasRect
  /** Unrotated local box; bounds remains the broad-phase world envelope. */
  localBounds?: CanvasRect
  zIndex: number
  parentId?: string
  locked: boolean
  hidden: boolean
  appearance: CanvasAppearance
  /** Host-authored card layout. Renderer compiles glyphs/vectors without DOM measurement. */
  modelPorts?: readonly Readonly<CanvasPoint & {color:string}>[]
  structuredCard?: Readonly<{
    title: string; rows: readonly string[]; result: string; fill: string; headerFill?: string; text: string
    ports: readonly CanvasPoint[]
  }>
  /** Passive artwork is authored data. The active editor may still use IME DOM;
   * no CSSOM, Range or element bounds are part of this painting contract. */
  modelArtwork?: Readonly<
    { kind: 'image'; sourceDimensions?: Readonly<{width:number;height:number}>; pyramid?: import('./imagePyramid').ImagePyramid; tilesSource?: string; source: string; sourceRevision: number; extension?: string; header?: {title:string;fill:string;color:string;height:number}; framing?: {fit?: 'contain'|'cover'|'fill';positionX?:number;positionY?:number;zoom?:number;flipX?:boolean;flipY?:boolean;rotation?:number;grayscale?:boolean;opacity?:number;blendMode?:string;overlay?:string} } |
    { kind: 'type'; text: string; wrap: boolean; inset: number; top?: number; background?: string; header?: { title: string; fill: string; color: string; height: number }; blocks?: readonly { start: number; end: number; alignment: 'left'|'center'|'right'|'justify'; before: number; after: number; indent: number }[]; spans: readonly Readonly<{
      start: number; end: number; family: string; size: number; weight: number;
      italic: boolean; lineHeight: number; spacing: number; color: string;
      underline: boolean; strike: boolean; highlight?: string
    }>[] }
  >
  vectorPath?: CanvasVectorPath
  shapeType?: 'rectangle' | 'ellipse' | 'line' | 'arrow' | 'path'
  hasDiagramCaption?: boolean
  hasShapeCaption?: boolean
  /** Immutable board-space path geometry shared by indexing and picking.
   * Readiness alone does not transfer ownership of caption or other object paint. */
  preparedVectorGeometry?: CanvasPreparedVectorGeometry
  /** Preserve semantic complexity so a backend can choose a truthful fallback. */
  vectorBoolean?: CanvasVectorBoolean
  vectorTransform?: CanvasVectorTransform
  asset?: CanvasAssetHandle
}>

export type CanvasSceneConnection = Readonly<{
  id: string
  revision: number
  sourceId?: string
  targetId?: string
  sourcePoint?: CanvasPoint
  targetPoint?: CanvasPoint
  sourcePort: 'top' | 'right' | 'bottom' | 'left'
  targetPort: 'top' | 'right' | 'bottom' | 'left'
  sourcePortMode?: 'fixed' | 'adaptive'
  targetPortMode?: 'fixed' | 'adaptive'
  style: 'curve' | 'straight' | 'elbow'
  color: string
  width: number
  dashed: boolean
  startArrow: boolean
  endArrow: boolean
  animated: boolean
  label?: string
  bendPoints?: readonly CanvasPoint[]
  labelPosition?: Readonly<{ t: number; offsetX: number; offsetY: number; [key: string]: unknown }>
  relationshipStyle?: string
  linePattern?: 'solid' | 'dash' | 'dot' | 'dash-dot'
}>

export type CanvasEnvironment = Readonly<{
  background: string
  grid: Readonly<{
    visible: boolean
    color: string
    opacity: number
    spacing: number
  }>
}>

export type CanvasSceneSnapshot = Readonly<{
  id: string
  revision: number
  objects: readonly CanvasSceneObject[]
  connections: readonly CanvasSceneConnection[]
  environment: CanvasEnvironment
}>

export type CanvasSceneChangeSet = Readonly<{
  sceneId: string
  fromRevision: number
  toRevision: number
  upsertObjects: readonly CanvasSceneObject[]
  removeObjectIds: readonly string[]
  upsertConnections: readonly CanvasSceneConnection[]
  removeConnectionIds: readonly string[]
  environment?: CanvasEnvironment
}>

export type CanvasSurface =
  | Readonly<{ kind: 'dom'; element: HTMLElement; size: CanvasSize; devicePixelRatio: number }>
  | Readonly<{ kind: 'native'; surfaceId: string; size: CanvasSize; devicePixelRatio: number }>

export type CanvasFrameContext = Readonly<{
  timestamp: number
  viewport: CanvasViewport
  quality: 'idle' | 'interaction' | 'settle'
}>

export type CanvasRenderStatistics = Readonly<{
  cpuMs: number
  visibleObjects: number
  drawSubmissions?: number
  estimatedGpuBytes?: number
}>

export type CanvasBackend = {
  readonly id: string
  initialize(surface: CanvasSurface, scene: CanvasSceneSnapshot): Promise<void>
  applyChanges(changes: CanvasSceneChangeSet): void
  setViewport(viewport: CanvasViewport): void
  render(frame: CanvasFrameContext): CanvasRenderStatistics
  recoverDevice(): Promise<void>
  dispose(): void
}

export type CanvasHostCommand =
  | Readonly<{ type: 'select'; objectIds: readonly string[] }>
  | Readonly<{ type: 'transform'; objectIds: readonly string[]; dx: number; dy: number }>
  | Readonly<{ type: 'set-viewport'; viewport: CanvasViewport; transient: boolean }>

export type CanvasTelemetryEvent = Readonly<{
  name: string
  timestamp: number
  values: Readonly<Record<string, number | string | boolean>>
}>

export type CanvasHost = {
  resolveAsset(handle: CanvasAssetHandle, signal: AbortSignal): Promise<string>
  dispatch(command: CanvasHostCommand): void
  recordTelemetry(event: CanvasTelemetryEvent): void
}

export { CanvasFrameDrawList } from './canvasPrimitive'
export type { CanvasPrimitive, CanvasTransform, RasterImageDescriptor, VectorPrimitiveDescriptor, RichTextDescriptor, Direct3D12PipelineProfile } from './canvasPrimitive'
export { ViewportCamera } from './viewportCamera'
export type { BoundingBoxAABB } from './viewportCamera'
export { InkingScratchpad } from './inkingScratchpad'
export type { InkingStrokeStyle, CommittedStroke } from './inkingScratchpad'

