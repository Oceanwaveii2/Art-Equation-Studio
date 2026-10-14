export type VectorGradient = {
  version: 1
  kind: 'linear' | 'radial'
  /** Gradient-space to local path-space affine; retained for elliptical gradients. */
  transform: [number, number, number, number, number, number]
  start: { x: number; y: number }
  end: { x: number; y: number }
  radius?: number
  focalRadius?: number
  spread: 'pad' | 'reflect' | 'repeat'
  stops: { offset: number; color: string; opacity: number }[]
}
export type VectorTexture = {
  version: 1
  /** Embedded PNG/JPEG only; no executable or external resources. */
  href: string
  width: number
  height: number
  transform: [number, number, number, number, number, number]
}
export type AssetKind = 'image' | 'video' | 'model' | 'document' | 'font' | 'other'

export type AssetRecord = {
  /** Orientation-correct source pixels, read from the image header at import. */
  imageDimensions?: { width: number; height: number }
  requiresTiledPreview?: boolean
  imagePyramid?: import('../canvas-engine/imagePyramid').ImagePyramid
  id: string
  relativePath: string
  originalName: string
  byteLength: number
  extension: string
  deduplicated: boolean
  thumbnailRelativePath?: string
}

export type AssetStatus = 'available' | 'missing' | 'modified' | 'moved' | 'preview-pending'

export type GeneratedAssetLineage = {
  engine: 'APISR-GRL-GAN-FP16' | 'Swin2SR-q4' | 'board-transform'
  modelSha256?: string
  sourceAssetId: string
  sourceRelativePath: string
  boardId: string
  operation: 'upscale-2x' | 'upscale-4x' | 'enhance-resize' | 'bake-transform' | 'convert'
  targetPercent?: number
  sourceWidth: number
  sourceHeight: number
  outputWidth: number
  outputHeight: number
  generatedAt: string
}

export type CompositionOverlay = 'thirds' | 'golden' | 'center' | 'diagonals'
export type ImageTransform = {
  /** Source-safe framing; absent preserves contain, centered, unzoomed. */
  fit?: 'contain' | 'cover' | 'fill'
  positionX?: number
  positionY?: number
  zoom?: number
  flipX?: boolean
  flipY?: boolean
  rotation?: 0 | 90 | 180 | 270
  grayscale?: boolean
  opacity?: number
  blendMode?: GlobalCompositeOperation
  overlay?: CompositionOverlay
}

export type ProjectAsset = AssetRecord & {
  kind: AssetKind
  importedAt: string
  displayName: string
  virtualFolder: string
  aliases: string[]
  tags?: string[]
  /** Local CLIP proposals. They are reviewed before becoming tags or names. */
  semanticSuggestions?: Array<{ tag: string; score: number; decision: 'pending' | 'accepted' | 'rejected'; generatedAt: string }>
  /** A catalog-name proposal only; disk names change through the explicit sync command. */
  semanticFilenameSuggestion?: string
  favorite?: boolean
  collectionIds?: string[]
  history?: { at: string; action: string; detail?: string }[]
  status: AssetStatus
  managedRelativePath?: string
  generated?: GeneratedAssetLineage
  dependencies?: { uri: string; status: 'available' | 'missing' }[]
  /** Locked assets cannot be deleted or moved to the project trash. */
  locked?: boolean
}

export type AssetCollection = { id: string; name: string; color?: string }

export type CapturedContentKind = 'article' | 'social-post' | 'transcript' | 'script' | 'local-document'

export type CapturedContent = {
  kind: CapturedContentKind
  sourceUrl: string
  sourceLabel: string
  author: string
  publishedAt: string
  capturedAt: string
  articleHtml: string
  commentsHtml: string
  transcriptHtml: string
}

export type VideoAnnotation = {
  id: string
  time: number
  text: string
  color?: string
}

export type BoardNodeKind = 'column' | 'group' | 'image' | 'video' | 'model' | 'document' | 'note' | 'text' | 'clip' | 'shape' | 'board-link'
export type ShapeType = 'rectangle' | 'ellipse' | 'line' | 'arrow' | 'path'

export type ArrowMotion = {
  enabled: boolean
  speed: 'slow' | 'normal' | 'fast'
  direction: 'forward' | 'reverse'
  style: 'flow'
}
/** A cubic Bézier control offset from its anchor, stored in portable board units. */
export type VectorPathPoint = BoardPoint & {
  handleIn?: BoardPoint
  handleOut?: BoardPoint
  /** Smooth points keep handles collinear; corner points let each handle move independently. */
  handleMode?: 'smooth' | 'corner'
}
/** Portable local coordinates for a pen-created vector path. Version 1 is the
 * SVG-style command model: points are implicit M/L/C segments and handles are
 * relative offsets, which keeps paths editable without storing SVG strings. */
export type VectorPath = { version: 1; closed: boolean; points: VectorPathPoint[] }
export type VectorBooleanOperation = 'union' | 'subtract' | 'intersect' | 'exclude'
/** Source contours are retained inside the resulting object so a boolean remains editable. */
export type VectorBoolean = {
  operation: VectorBooleanOperation
  operands: VectorPath[]
  /** Fill semantics of each retained operand, before the operation. */
  fillRules?: VectorFillRule[]
  /** Exact derived boundaries; source contours remain available in operands. */
  resolvedPaths?: VectorPath[]
}
export type VectorFillRule = 'nonzero' | 'evenodd'
export type VectorStrokeJoin = 'miter' | 'round' | 'bevel'
export type VectorStrokeCap = 'butt' | 'round' | 'square'
/** Non-destructive local transform applied after path geometry. */
export type VectorTransform = { translateX?: number; translateY?: number; scaleX?: number; scaleY?: number; skewX?: number; skewY?: number }

export type MindMapMembership = { version: 1; treeId: string; parentId?: string; order: number; collapsed?: boolean }
export type DiagramTemplate = { version: 1; id: string; title: string; nodes: BoardNode[]; connectors: BoardConnector[] }

export type BoardNode = {
  id: string
  kind: BoardNodeKind
  x: number
  y: number
  width: number
  height: number
  title: string
  body?: string
  videoAnnotations?: VideoAnnotation[]
  videoFrameRate?: 24 | 25 | 30 | 60
  captured?: CapturedContent
  assetId?: string
  targetBoardId?: string
  /** Child is the owning portal; shortcut is only an alias. */
  boardLinkRole?: 'shortcut' | 'child'
  /** Distinguishes intentional portal tiles from pre-2026 legacy child tiles. */
  boardPortal?: true
  color?: string
  strokeColor?: string
  textColor?: string
  opacity?: number
  parentColumnId?: string
  columnOrder?: number
  freeWidth?: number
  freeHeight?: number
  collapsed?: boolean
  /** Presentation treatment for Milanote-style columns. */
  columnPreserveCardSizes?: boolean
  /** Explicit artwork row sizing. Missing keeps the saved legacy column layout. */
  columnImageSizing?: 'responsive' | 'minimum-height'
  /** Imported fixed layouts retain authored positions until an explicit reflow. */
  columnFixedLayout?: boolean
  columnPresentation?: 'background' | 'top-strip' | 'header' | 'black-turquoise'
  /** Full-column body fill (Milanote colored column). Header color stays independent. */
  columnBodyColor?: string
  /** When true, the header color derives from columnBodyColor automatically. */
  columnLinkHeader?: boolean
  zIndex?: number
  /** Freeform groups intentionally do not use column membership. */
  groupId?: string
  /** Frames share the freeform container geometry, but remain visually and semantically distinct from groups. */
  containerRole?: 'group' | 'frame'
  /** Opt-in bounded region; drawing accepts only shapes/text. Legacy frames remain unchanged. */
  boundedCanvas?: 'frame' | 'drawing'
  /** Organizational drawing layers have no card background or title over artwork. */
  drawingLayer?: true
  /** Semantic lane/frame identity; members remain unclipped world-space objects. */
  diagramRole?: 'swimlane' | 'lane'
  diagramShape?: 'process' | 'decision' | 'start-end' | 'document'
  hidden?: boolean
  mindMap?: MindMapMembership
  shapeType?: ShapeType
  /** Non-destructive board presentation for arrow shapes. Geometry remains static/editable. */
  arrowMotion?: ArrowMotion
  vectorPath?: VectorPath
  vectorBoolean?: VectorBoolean
  vectorFillRule?: VectorFillRule
  vectorFillGradient?: VectorGradient
  vectorStrokeGradient?: VectorGradient
  vectorTexture?: VectorTexture
  /** Original stroke centerlines and affine, independent of baked fill geometry. */
  vectorStrokeGeometry?: { paths: VectorPath[]; transform: VectorGradient['transform'] }
  vectorClipPaths?: VectorPath[][]
  fillOpacity?: number
  strokeOpacity?: number
  vectorStrokeJoin?: VectorStrokeJoin
  vectorStrokeCap?: VectorStrokeCap
  vectorTransform?: VectorTransform
  strokeWidth?: number
  cornerRadius?: number
  /** Object rotation in degrees. This is independent from image pixel transforms. */
  rotation?: number
  coverAssetId?: string
  /** Render-time only edits. Originals remain immutable until explicitly baked. */
  imageTransform?: ImageTransform
  /** Legacy placements without this flag retain cards. New images use artwork
   * bounds with no header/body inset; explicit card presentation is preserved. */
  imagePresentation?: 'card' | 'artwork'
  /** Point/area typography is artwork; Notes retain card presentation. */
  textMode?: 'point' | 'area'
  /** Intentional decorative backgrounds do not attract object snapping. */
  layoutBackground?: boolean
  /** Graph evaluation is independent of the item's scene geometry and editor. */
  graphColumn?: { version: 2; operation: 'collect' | 'count' | 'text'; inputs: Array<{ id: string; sourceId: string }> }
  /** Locked objects cannot be deleted, dragged to trash, or removed by cleanup actions. */
  locked?: boolean
}

/** Normalize legacy path records written before the versioned path contract. */
export function normalizeVectorPath(path: Partial<VectorPath> | null | undefined): VectorPath | undefined {
  if (!path || !Array.isArray(path.points)) return undefined
  const finite = (value: unknown, fallback = 0) => typeof value === 'number' && Number.isFinite(value) ? value : fallback
  const points = path.points.map((point) => ({
    x: finite(point?.x),
    y: finite(point?.y),
    ...(point?.handleIn ? { handleIn: { x: finite(point.handleIn.x), y: finite(point.handleIn.y) } } : {}),
    ...(point?.handleOut ? { handleOut: { x: finite(point.handleOut.x), y: finite(point.handleOut.y) } } : {}),
    ...(point?.handleMode === 'corner' ? { handleMode: 'corner' as const } : point?.handleMode === 'smooth' ? { handleMode: 'smooth' as const } : {}),
  }))
  return { version: 1, closed: Boolean(path.closed), points }
}

export type ConnectorPort = 'top' | 'right' | 'bottom' | 'left'
export type ConnectorStyle = 'curve' | 'straight' | 'elbow'
export type ConnectorPortMode = 'fixed' | 'adaptive'
export type ConnectorLinePattern = 'solid' | 'dash' | 'dot' | 'dash-dot'
export type BoardPoint = { x: number; y: number }
export type ConnectorLabelPosition = { t: number; offsetX: number; offsetY: number; [key: string]: unknown }

export type BoardConnector = {
  id: string
  sourceId?: string
  targetId?: string
  sourcePoint?: BoardPoint
  targetPoint?: BoardPoint
  sourcePort: ConnectorPort
  targetPort: ConnectorPort
  /** Missing means fixed-side. Adaptive selects the nearest rotated side midpoint. */
  sourcePortMode?: ConnectorPortMode
  targetPortMode?: ConnectorPortMode
  style: ConnectorStyle
  color: string
  width: number
  dashed: boolean
  startArrow: boolean
  endArrow: boolean
  animated: boolean
  label?: string
  /** Elbow-only waypoints in board coordinates, fixed-world when endpoints move.
   * Other routes retain this metadata but do not apply it. Empty resets automatic. */
  bendPoints?: BoardPoint[]
  /** Fraction of route length plus board-space offset. Missing preserves legacy placement. */
  labelPosition?: ConnectorLabelPosition
  /** Stable local style identifier; no semantic/shared junction is implied. */
  relationshipStyle?: string
  mindMap?: { version: 1; treeId: string; childId: string }
  /** Missing uses legacy dashed. Patterns distinguish relationships without color. */
  linePattern?: ConnectorLinePattern
}

export type BoardViewport = { x: number; y: number; scale: number }
export type CoverFraming = { x: number; y: number; zoom: number; aspect: number }

/** Portable disk location for a top-level board. Nested boards stay virtual unless linked. */
export function managedBoardFolderPath(projectId: string, boardId: string): string {
  return `projects/${projectId}/boards/${boardId}`
}

export type BoardModel = {
  id: string
  title: string
  /** Canonical board ownership. Missing means project root. */
  parentBoardId?: string
  coverAssetId?: string
  coverFraming?: CoverFraming
  /** Board-tile accent, independent of the canvas background. */
  tileAccentColor?: string
  tileIcon?: string
  /** Root boards always have a managed or external disk link; nested links are optional. */
  linkedFolderPath?: string
  /** Prior automatic child cards are retained here when removed from the parent canvas. */
  legacyHiddenChildTiles?: { nodes: BoardNode[]; connectors: BoardConnector[] }
  viewport: BoardViewport
  nodes: BoardNode[]
  connectors: BoardConnector[]
  layoutGuides?: import('../board/layoutResearch').PersistentLayoutGuide[]
  gridVisible?: boolean
  snapToGrid?: boolean
  snapToObjects?: boolean
  snapToGuides?: boolean
  backgroundColor?: string
  /** Missing colors follow the current application theme for backward compatibility. */
  backgroundFollowsTheme?: boolean
  gridColor?: string
  gridOpacity?: number
  gridSpacing?: number
}

/** Existing projects gain managed links without changing their board IDs or content. */
export function withRequiredBoardFolderLinks(project: ProjectModel): ProjectModel {
  return { ...project, boards: project.boards.map((board) => !board.parentBoardId && !board.linkedFolderPath
    ? { ...board, linkedFolderPath: managedBoardFolderPath(project.id, board.id) }
    : board) }
}

export type ProjectDocument = {
  id: string
  title: string
  content: Record<string, unknown>
  layout?: DocumentLayout
  /** Locked documents (the questionnaire) can be edited but never deleted or duplicated. */
  locked?: boolean
  /** System documents are structural and hidden from normal document flows. */
  system?: boolean
}

/** The per-project questionnaire document. Writable, but never deletable. */
export const QUESTIONNAIRE_DOCUMENT_ID = 'project-brief'

export function isDeletableDocument(document: ProjectDocument): boolean {
  return !document.locked && !document.system
}

export function isDeletableNode(node: BoardNode): boolean {
  return !node.locked
}

export function isDeletableAsset(asset: ProjectAsset): boolean {
  return !asset.locked
}

export type DocumentLayout = {
  pageSize: 'letter' | 'a4' | 'screen'
  orientation: 'portrait' | 'landscape'
  margins: 'compact' | 'standard' | 'wide'
  columns: 1 | 2
  theme: 'paper' | 'night'
  headerText?: string
  footerText?: string
  showPageNumber?: boolean
}

export const DEFAULT_DOCUMENT_LAYOUT: DocumentLayout = {
  pageSize: 'letter',
  orientation: 'portrait',
  margins: 'standard',
  columns: 1,
  theme: 'paper',
  headerText: 'ART EQUATION / PROJECT BRIEF',
  footerText: 'Art Equation Studio',
  showPageNumber: true,
}

export type ProjectQuestionnaire = {
  date: string
  summary: string
  tags: string
  count: string
  time: string
  difficulty: 'Undecided' | 'Low' | 'Medium' | 'High' | 'Experimental'
  deliverables: string
  purpose: string
  audience: string
  challenges: string
  solution: string
  tools: string
  narrative: string
  references: string
  stage1: string
  stage2: string
  stage3: string
}

export type WorksheetLink = { kind: 'board' | 'document' | 'asset'; id: string; label: string }
export type DailyTask = { id: string; title: string; completed: boolean; links: WorksheetLink[]; carriedFrom?: string }
export type DailyWorksheet = { date: string; tasks: DailyTask[]; notesHtml: string; updatedAt: string }

export type VisualRecipe = {
  id: string
  title: string
  category: string
  problem: string
  procedure: string
  applications: string[]
  tools: string[]
  aiModels: string[]
  thumbnail?: string
  favorite?: boolean
  variationOf?: string
  usedByProjectIds?: string[]
  updatedAt: string
}

export type PromptMode = 'generate' | 'edit' | 'restyle' | 'unify'
export type PromptDraft = {
  id: string; createdAt: string; mode: PromptMode; targetModel: string; referenceAssetId?: string
  subject: string; composition: string; camera: string; materials: string; lighting: string; consistency: string; negative: string; prompt: string
}

export type ReferenceLibrary = { id: string; name: string; path: string; kind: 'folder' | 'cbz' | 'cbr' | 'pdf'; lastOpenedAt?: string; missing?: boolean }
export type ReferenceCrop = { id: string; title: string; assetId?: string; sourcePath: string; tags: string[]; createdAt: string }
export type ProjectStatus = 'planning' | 'active' | 'review' | 'complete' | 'on-hold'

export type ProjectModel = {
  schemaVersion: 9
  id: string
  title: string
  status: ProjectStatus
  projectCoverAssetId?: string
  projectCoverFraming?: CoverFraming
  /** Optional second inspector image displayed in the lower reference slot. */
  inspectorImageAssetId?: string
  questionnaire: ProjectQuestionnaire
  documents: ProjectDocument[]
  boards: BoardModel[]
  documentContent?: Record<string, unknown>
  board?: BoardModel
  assets: ProjectAsset[]
  assetCollections?: AssetCollection[]
  openWith?: Record<string, string>
  colorSwatches: string[]
  worksheets?: DailyWorksheet[]
  /** Frozen copies of global recipes used by this portable project. */
  recipeSnapshots?: VisualRecipe[]
  promptHistory?: PromptDraft[]
  referenceLibraries?: ReferenceLibrary[]
  referenceCrops?: ReferenceCrop[]
  /** Local reusable snapshots; instantiation allocates fresh object identities. */
  diagramTemplates?: DiagramTemplate[]
  updatedAt: string
}

export const DEMO_PROJECT_ID = 'rainee-redesign'

function localDateStamp() {
  const now = new Date()
  const offset = now.getTimezoneOffset() * 60_000
  return new Date(now.getTime() - offset).toISOString().slice(0, 10)
}

export const DEFAULT_QUESTIONNAIRE: ProjectQuestionnaire = {
  date: localDateStamp(),
  summary: '',
  tags: '',
  count: '',
  time: '',
  difficulty: 'Undecided',
  deliverables: '',
  purpose: '',
  audience: '',
  challenges: '',
  solution: '',
  tools: '',
  narrative: '',
  references: '',
  stage1: '',
  stage2: '',
  stage3: '',
}

const text = (value: string, marks?: Array<Record<string, unknown>>) => ({ type: 'text', text: value, ...(marks ? { marks } : {}) })
const paragraph = (value: string) => ({ type: 'paragraph', content: [text(value)] })

export const DEFAULT_DOCUMENT_CONTENT: Record<string, unknown> = {
  type: 'doc',
  content: [
    paragraph('Visual development study'),
    { type: 'heading', attrs: { level: 1 }, content: [text('Rainee Transforms — Strip Club Redesign')] },
    paragraph('Build the visual logic before the image becomes expensive to fix. This brief connects narrative intent, spatial references, character construction, and production decisions.'),
    { type: 'horizontalRule' },
    { type: 'heading', attrs: { level: 2 }, content: [text('01 / What are we making?')] },
    paragraph('A coordinated set of screenshot redraws, turn sheets, and environment studies for a Fifth Element–inspired club redesign.'),
    { type: 'blockquote', content: [{ type: 'paragraph', content: [text('Working principle', [{ type: 'bold' }]), { type: 'hardBreak' }, text('Use AI where it gives leverage; use drawing and 3D where spatial consistency matters.')] }] },
    { type: 'heading', attrs: { level: 2 }, content: [text('02 / Solve geometry first.')] },
    paragraph('Accurate turn sheets and a coherent environment are the expensive failure points. Establish the camera, floor plan, silhouettes, and reusable costume details before rendering.'),
    { type: 'heading', attrs: { level: 3 }, content: [text('Reference direction')] },
    paragraph('Lighting, material, silhouette, and camera studies remain linked to the visual board.'),
  ],
}

export const DEFAULT_BOARD: BoardModel = {
  id: 'master-reference-board',
  title: 'Master reference board',
  viewport: { x: 0, y: 0, scale: 0.82 },
  nodes: [
    { id: 'character-column', kind: 'column', x: 70, y: 70, width: 290, height: 520, title: 'Character direction', color: '#d7a36a' },
    { id: 'character-image', kind: 'image', x: 80, y: 138, width: 270, height: 205, freeWidth: 250, freeHeight: 190, parentColumnId: 'character-column', columnOrder: 0, title: 'Silhouette reference', color: '#c87562' },
    { id: 'silhouette-note', kind: 'note', x: 80, y: 353, width: 270, height: 140, freeWidth: 250, freeHeight: 140, parentColumnId: 'character-column', columnOrder: 1, title: 'Silhouette requirements', body: 'Preserve the tall graphic read and separate costume layers before adding surface detail.' },
    { id: 'environment-column', kind: 'column', x: 440, y: 70, width: 290, height: 520, title: 'Environment', color: '#62a7a4' },
    { id: 'environment-image', kind: 'image', x: 450, y: 138, width: 270, height: 205, freeWidth: 250, freeHeight: 190, parentColumnId: 'environment-column', columnOrder: 0, title: 'Lighting and material', color: '#477b86' },
    { id: 'walkthrough-video', kind: 'video', x: 450, y: 353, width: 270, height: 178, freeWidth: 250, freeHeight: 165, parentColumnId: 'environment-column', columnOrder: 1, title: 'Camera walkthrough.mp4', body: '02:18 · Local original' },
    { id: 'production-notes', kind: 'document', x: 810, y: 70, width: 270, height: 140, title: 'Production design notes', body: '12 pages · preview available' },
  ],
  connectors: [
    { id: 'character-to-environment', sourceId: 'character-column', targetId: 'environment-column', sourcePort: 'right', targetPort: 'left', style: 'curve', color: '#58c8c1', width: 2, dashed: false, startArrow: false, endArrow: true, animated: true },
  ],
}

export function createProject(): ProjectModel {
  return {
    schemaVersion: 9,
    id: DEMO_PROJECT_ID,
    title: 'Rainee Transforms — Strip Club Redesign',
    status: 'active',
    questionnaire: {
      ...DEFAULT_QUESTIONNAIRE,
      summary: 'A set of screenshot redraws and a Quagmire replacement for a Fifth Element–style strip club redesign.',
      count: 'Shot list + turn sheets',
      time: 'Estimate after references',
      difficulty: 'High',
      deliverables: 'Shot lists, final images, turn sheets, screenshot redraws, and a Quagmire replacement.',
      challenges: 'Accurate turn sheets and geometrically correct backgrounds.',
      solution: 'Use image-to-3D for the club blockout and each character turnaround, then correct the construction manually.',
      narrative: 'Stripperella. Yuri with multiple harems.',
    },
    documents: [{ id: QUESTIONNAIRE_DOCUMENT_ID, title: 'Project questionnaire', content: structuredClone(DEFAULT_DOCUMENT_CONTENT), layout: structuredClone(DEFAULT_DOCUMENT_LAYOUT), locked: true, system: true }],
    boards: [
      structuredClone(DEFAULT_BOARD),
      { id: 'character-development', title: 'Character development', viewport: { x: 28, y: 28, scale: .82 }, nodes: [], connectors: [] },
    ],
    assets: [],
    assetCollections: [],
    colorSwatches: ['#c56c65', '#d7a36a', '#d5c889', '#6ba39b', '#56748e', '#8b6c8f'],
    updatedAt: new Date().toISOString(),
  }
}

export function createBlankProject(title = 'Untitled project'): ProjectModel {
  const id = `project-${crypto.randomUUID()}`
  return {
    schemaVersion: 9,
    id,
    title,
    status: 'planning',
    questionnaire: { ...DEFAULT_QUESTIONNAIRE, date: localDateStamp() },
    documents: [{ id: QUESTIONNAIRE_DOCUMENT_ID, title: 'Project questionnaire', content: structuredClone(DEFAULT_DOCUMENT_CONTENT), layout: structuredClone(DEFAULT_DOCUMENT_LAYOUT), locked: true, system: true }],
    boards: [{ id: `board-${crypto.randomUUID()}`, title: 'Master reference board', viewport: { x: 28, y: 28, scale: .82 }, nodes: [], connectors: [] }],
    assets: [],
    assetCollections: [],
    colorSwatches: ['#c56c65', '#d7a36a', '#d5c889', '#6ba39b', '#56748e', '#8b6c8f'],
    updatedAt: new Date().toISOString(),
  }
}

export function classifyAsset(extension: string): AssetKind {
  const value = extension.toLowerCase()
  if (['avif', 'bmp', 'gif', 'heic', 'jpeg', 'jpg', 'png', 'svg', 'tif', 'tiff', 'webp'].includes(value)) return 'image'
  if (['avi', 'm4v', 'mkv', 'mov', 'mp4', 'mpeg', 'mpg', 'webm'].includes(value)) return 'video'
  if (['blend', 'glb', 'gltf', 'obj', 'ztl', 'zpr'].includes(value)) return 'model'
  if (['doc', 'docx', 'epub', 'htm', 'html', 'markdown', 'md', 'odt', 'pdf', 'psd', 'rtf', 'txt'].includes(value)) return 'document'
  if (['otf', 'ttc', 'ttf', 'woff', 'woff2'].includes(value)) return 'font'
  return 'other'
}

export function managedAsset(record: AssetRecord, importedAt = new Date().toISOString()): ProjectAsset {
  const kind = classifyAsset(record.extension)
  return {
    ...record,
    kind,
    importedAt,
    displayName: record.originalName.replace(/[_-]+/g, ' ').replace(/\s+/g, ' ').trim(),
    virtualFolder: kind === 'image' ? 'Images' : kind === 'video' ? 'Videos' : kind === 'model' ? '3D' : kind === 'document' ? 'Documents' : kind === 'font' ? 'Fonts' : 'Other',
    aliases: [],
    tags: [],
    favorite: false,
    collectionIds: [],
    history: [{ at: importedAt, action: 'Imported', detail: record.originalName }],
    status: record.thumbnailRelativePath || kind !== 'image' ? 'available' : 'preview-pending',
  }
}

export function normalizeProjectAsset(asset: ProjectAsset): ProjectAsset {
  return {
    ...asset,
    displayName: asset.displayName || asset.originalName,
    virtualFolder: asset.virtualFolder || (asset.kind === 'image' ? 'Images' : asset.kind === 'video' ? 'Videos' : asset.kind === 'model' ? '3D' : asset.kind === 'document' ? 'Documents' : 'Other'),
    aliases: asset.aliases || [],
    tags: asset.tags || [],
    semanticSuggestions: asset.semanticSuggestions || [],
    favorite: asset.favorite || false,
    collectionIds: asset.collectionIds || [],
    history: asset.history || [],
    status: asset.status || 'available',
  }
}

export function normalizeBoardConnector(connector: Partial<BoardConnector> & Pick<BoardConnector, 'id' | 'color'>): BoardConnector {
  return {
    // Loading supplies legacy defaults; it must not discard newer routing,
    // label, relationship, or extension metadata from a saved connection.
    // Geometry validates optional numeric fields at its consumption boundary.
    ...connector,
    id: connector.id,
    sourceId: connector.sourceId,
    targetId: connector.targetId,
    sourcePoint: connector.sourcePoint,
    targetPoint: connector.targetPoint,
    sourcePort: connector.sourcePort || 'right',
    targetPort: connector.targetPort || 'left',
    style: connector.style || 'curve',
    color: connector.color || '#58c8c1',
    width: connector.width || 2,
    dashed: connector.dashed || false,
    startArrow: connector.startArrow || false,
    endArrow: connector.endArrow ?? true,
    animated: connector.animated ?? true,
    label: connector.label,
  }
}
