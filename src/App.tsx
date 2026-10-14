import {readLaunchTheme,saveLaunchTheme,type LaunchLayout,readCanvasUiPersonality,saveCanvasUiPersonality,type CanvasUiPersonality} from './ui/launchPreferences'
import { MilanoteToolRail } from './ui/MilanoteToolRail'
import { VirtualList } from './ui/VirtualList'
import { createToolStore, useStoreField, useControllerEvent, useBoardSelectionStore, useDocumentController } from './state/controllerStores'
import { modelEqual } from './state/modelEquality'
import { appInputClock, requestAppFrame, cancelAppFrame } from './canvas-engine/appFrameClock'
import { BoardPreview } from './board/BoardPreview'
import { StrokePreview } from './board/StrokePreview'
import { subboardPresentation, subboardSummary } from './board/subboardPresentation'
import { BoardActionsMenu } from './ui/BoardActionsMenu'
import {CanvasToolbar} from './ui/CanvasToolbar'
import { GraphColumnEditor } from './board/GraphColumnEditor'
import { GraphColumnSurface } from './board/GraphColumnSurface'
import { solveLayoutSnap } from './board/layoutSnap'
import { createGraphColumnItem, GraphColumnRuntime, bindGraphColumnInputs, projectGraphColumns, editGraphColumn } from './board/graphColumnV2'
import { graphColumnSvg } from './board/graphColumnSvg'
import { GraphPortInteraction } from './board/GraphPortInteraction'
import { safeFrameEdit } from './board/boundedFrames'
import { exportDiagnostics, recordMetric, canvasInputsFor } from './diagnostics/performance'
import { lazy, Suspense, useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, useSyncExternalStore, type ReactNode } from 'react'
import { open, save } from '@tauri-apps/plugin-dialog'
import { createPortal } from 'react-dom'
import { ProjectIdentity } from './ProjectIdentity'
import { PrototypeAssetShelf } from './ui/PrototypeAssetShelf'
import { Prototype25Shell } from './ui/Prototype25Shell'
import './ui/PrototypeCanvasLayout.css'
import { ProductionStudio } from './ui/ProductionStudio'
import { PrototypeDocumentTabs, documentPanelId, documentTabId } from './ui/PrototypeDocumentTabs'
import { ThemeIcon } from './ui/ThemeIcon'
import { CodexBridgePanel, useCodexBridge } from './codex/CodexBridgePanel'
import { GeminiBridgePanel } from './gemini/GeminiBridgePanel'
import { readRuntimeDiagnostics } from './codex/runtimeDiagnostics'
import { SettingsDialog } from './ui/SettingsDialog'
import { EngineCacheSettings } from './ui/EngineCacheSettings'
import { useNativeWindowChrome } from './ui/useNativeWindowChrome'
import { SaveSettingsPanel } from './ui/SaveSettingsPanel'
import { defaultSavePolicy,validSavePolicy,configureProjectStorage,hasPendingProjectContent,type SavePolicy } from './storage/workspace'
import type { AppInspectionContext } from './codex/appInspection'
import { appAlert, appConfirm, AppDialogHost } from './ui/AppDialogs'
import { useModalFocus } from './ui/useModalFocus'
import { BoardRendererDiagnostics } from './board/BoardRendererDiagnostics'
import { NodeGraphControls } from './board/NodeGraphControls'
import { convertFileSrc, invoke } from '@tauri-apps/api/core'
import { getCurrentWebview } from '@tauri-apps/api/webview'
import { getCurrentWindow } from '@tauri-apps/api/window'
import { WebviewWindow } from '@tauri-apps/api/webviewWindow'


import { CanvasInteractionOverlay } from './board/CanvasInteractionOverlay'
import { BootLoader } from './BootLoader'
import { recordNativeCommand, redoNativeCommand, undoNativeCommand, type NativeBoardCommand } from './board/nativeCommandJournal'



type TextPromptOptions = { title: string; label: string; initialValue?: string; helpText?: string; confirmLabel?: string }
type PendingTextPrompt = TextPromptOptions & { resolve: (value: string | null) => void }
import { revealItemInDir } from '@tauri-apps/plugin-opener'
import {
  ensureProjectWorkspace,
  ensureManagedBoardFolders,
  auditProjectAssets,
  getWorkspaceInfo,
  importProjectAsset,
  importModelBundle,
  readTextAsset,
  materializeProjectAsset,
  previewManagedAssets,
  collectProject,
  repairModelBundle,
  rollbackManagedAssets,
  listProjects,
  listTrashedProjects,
  loadProject,
  loadWorkspaceSettings,
  listRecoveryEntries,
  openAssetWith,
  saveProject,
  saveProjectAutosave,
  saveProjectJournal,
  saveWorkspaceSettings,
  restoreTrashedProject,
  saveGeneratedImage,
  exportBinary,
  trashProject,
  listProjectTrash,
  recordTrashEntry,
  removeTrashEntry,
  type ViewMode,
  type WorkspaceInfo,
  type ProjectNavigation,
  type ProjectSummary,
} from './storage/workspace'
import {
  createBlankProject,
  createProject,
  isDeletableDocument,
  DEMO_PROJECT_ID,
  type AssetKind,
  type BoardModel,
  type BoardViewport,
  type CoverFraming,
  type BoardNode,
  type BoardConnector,
  type BoardPoint,
  type VectorPathPoint,
  type VectorPath,
  type VectorBooleanOperation,
  type ConnectorPort,
  type ShapeType,
  type ImageTransform,
  type CapturedContent,
  type ProjectAsset,
  type ProjectDocument,
  type ProjectModel,
  type DiagramTemplate,
  type ProjectStatus,
  type VisualRecipe,
  DEFAULT_DOCUMENT_CONTENT,
  DEFAULT_DOCUMENT_LAYOUT,
  DEFAULT_BOARD,
  DEFAULT_QUESTIONNAIRE,
  QUESTIONNAIRE_DOCUMENT_ID,
  managedAsset,
  managedBoardFolderPath,
  withRequiredBoardFolderLinks,
  normalizeBoardConnector,
  normalizeVectorPath,
  normalizeProjectAsset,
} from './model/project'
import { applyCanvasSelectionTrash, applyNodeRestore, applyBoardRestore, applyBoardTrash, applyDocumentTrash, applyDocumentRestore, applyAssetTrash, applyAssetRestore, type TrashEntry } from './model/trash'
import { duplicateBoardSubtree } from './board/boardTransactions'
import { moveContainerWithDescendants, reparentContainerNodes, visibleDiagramNodeIds, diagramState } from './board/diagramStructureCore'
import { validateBoardMutation, patchBoardNode, dissolveBoardContainer } from './board/boardMutationSafety'
import { containerPaintOrder } from './board/containerPaintOrder'
import { changeDrawingLayerOrder, projectDrawingLayers } from './board/drawingLayers'
import './App.css'
import {
  COLUMN_PADDING,
  columnInsertionY,
  computeFlatColumnCoordinates,
  findColumnDropTargetResult,
  insertNodesIntoColumnResult,
  layoutBoardColumns,
  layoutBoardColumnsForNodesResult,
  releaseNodesFromColumnsResult,
  setColumnImageSizingResult,
  type ColumnDropTarget,
} from './board/columns'
import { connectorGeometry, connectorSvgMarkup, nearestPort, withConnectorEndpoint, resolveConnectorEndpoint, connectorLabelPoint, projectConnectorLabelPosition, connectorDashArray, connectorLinePattern, applyConnectorRelationshipStyle, CONNECTOR_RELATIONSHIP_STYLES } from './board/connectors'
import { connectNodeGraphPortsResult, createNodeColumnResult, hasConnectedNodeGraphEdges, isNodeColumn, isNodeGraphConnector, nodeGraphOwner, nodeGraphPort, nodeGraphPortPosition, nodeGraphPorts, nodeGraphRole, reconnectNodeGraphPortResult, retainPastedNodeGraphConnectors, setNodeGraphRoleResult, validateNodeGraphPortConnection, type NodeGraphRole } from './board/nodeColumnCommands'
import { diagramCaptionSvgMarkup, vectorNodeSvgMarkup } from './board/vectorSvg'
import { VectorPaintDefs } from './board/VectorPaintDefs'
import { VectorStrokePaint } from './board/VectorStrokePaint'
import { GradientHandles } from './board/GradientHandles'
import { paintId, paintAlpha, transformVectorPaint } from './board/vectorPaint'
import { resolveVectorBooleanGeometry } from './model/vectorBooleanGeometry'
import { composeVectorPaths } from './model/vectorComposition'
import { LayoutResearchPanel, PersistentGuideLayer } from './board/LayoutResearchPanel'
import { SvgDrawingPanel } from './board/SvgDrawingPanel'
import { reconcileLayoutGuides, organizeSemanticClusters } from './board/layoutResearch'
import { alignBoardNodes, boardNodeVisualBounds, distributeBoardNodes, packBoardNodes } from './board/arrangement'
import { prepareBoardVisualExport } from './board/boardVisualExport'
import { prepareResearchExport } from './board/researchExport'
import { ProjectSearch } from './search/ProjectSearch'
import { transferBoardSelection } from './board/boardTransfer'
import { BoardTransferDialog } from './board/BoardTransferDialog'

import { DiagramPalette } from './board/DiagramPalette'
import { createDiagramNodeResult, createConnectedSuccessorResult, insertDiagramNodeOnConnectorResult, type DiagramShapeId } from './board/diagramPaletteCommands'
import { DiagramStructurePanel } from './board/DiagramStructurePanel'
import { validateDiagramTemplate } from './board/diagramWorkflow'
import { DailyWorksheets } from './planning/DailyWorksheets'
import { RecipeLibrary } from './recipes/RecipeLibrary'
import { PromptGenerator } from './prompt/PromptGenerator'
import { ReferenceLibraryPanel } from './reference/ReferenceLibrary'
import { MediaHealthReview } from './media/MediaHealthReview'
import { ArtworkFramingReview } from './media/ArtworkFramingReview'
import { insertVectorPathPoint, removeVectorPathPoint, setVectorPointMode, vectorPathBounds, vectorPathData, vectorTransformData, nearestVectorSegment, reshapeVectorSegment, vectorBoardToLocal, vectorBoardDeltaToLocal, resizeVectorNodeFrame, synchronizeVectorStroke } from './model/vector'
import { createPencilPath, eraseVectorNode } from './model/vectorDrawing'
import { eraseRectangleAppearance, isRectangleErasure, rectangleErasureState, resizeRectangleErasureFrame } from './model/rectangleErasure'
import { captureRectangleErasureCssClip } from './board/rectangleErasurePaint'
import { vectorDirectSelectionPolicy, vectorEditorControls, vectorEraserScope, vectorEditBlockReason } from './model/vectorEditing'
import { imageDrawRect, normalizeImageFraming } from './model/imageFraming'
import { prepareRasterExportSource } from './board/rasterExportSource'
import { fitNaturalImageBounds, planTightImageBounds, assetIntrinsicSize } from './model/naturalImageBounds'
import { readImageDimensions } from './board/imageDimensions'
import type { ColorTarget } from './color/ColorPanel'
import { createArtEquationCanvasScene } from './board/artEquationCanvasAdapter'
import { createCanonicalVectorPicker } from './board/canonicalVectorPicking'
import { CANVAS_THEME_COLORS, MILANOTE_CANVAS_THEME_COLORS, DEFAULT_CANVAS_GRID_OPACITY, readableForeground as canvasReadableForeground } from './canvasTheme'
import { UniformGridSpatialIndex } from './canvas-engine/spatialIndex'
import { useGestureBoard } from './board/useGestureBoard'
import { guardColumnRowPosition } from './board/columnRowPosition'
import { columnRowActionState, moveColumnRowsResult, detachColumnRowsResult, moveColumnRowsToSiblingColumnResult, moveSelectionToAncestorResult } from './board/columnRowCommands'
import { GesturePresenter } from './board/GesturePresenter'
import { OverlayPresenter, useOverlayContext, usePresentationValue } from './board/OverlayPresenter'
import { FrameScheduler } from './canvas-engine/frameScheduler'
import { LiveCamera } from './canvas-engine/liveCamera'
import { LiveCanvasScene } from './canvas-engine/liveScene'
import { presentCamera } from './board/presentCamera'
import { createInputMetrics, scheduledPointerGesture, type PointerSample } from './board/scheduledPointerGesture'
import { TiledImagePreview } from './board/TiledImagePreview'
import { useImagePreparation } from './board/useImagePreparation'
import { validPyramid } from './canvas-engine/imagePyramid'
import { canvasResourceBudget } from './canvas-engine/resourceBudget'
import { IncrementalPenPath, vectorGeometryCache } from './canvas-engine/vectorGeometryCache'
import { boardAncestors, boardChildren, insertNestedBoard, normalizeBoardHierarchy, normalizeBoardPortalBounds, withoutLegacyChildTiles } from './board/boardHierarchy'
import { recentTileIcons, rememberTileIcon, searchTileIcons, TILE_ICON_CATEGORIES, type TileIconCategory } from './board/tileIcons'
import spectrumNode from './assets/spectrum-workflow/S2_Icon_DirectSelect_20_N.svg?url'
import spectrumType from './assets/spectrum-workflow/S2_Icon_TextParagraph_20_N.svg?url'
import spectrumPen from './assets/spectrum-workflow/S2_Icon_VectorDraw_20_N.svg?url'
import spectrumRectangle from './assets/spectrum-workflow/S2_Icon_RectangleHoriz_20_N.svg?url'
import spectrumEllipse from './assets/spectrum-workflow/S2_Icon_Circle_20_N.svg?url'
import spectrumLine from './assets/spectrum-workflow/S2_Icon_Line_20_N.svg?url'
import spectrumConnector from './assets/spectrum-workflow/S2_Icon_Link_20_N.svg?url'
import spectrumFrame from './assets/spectrum-workflow/S2_Icon_Artboard_20_N.svg?url'
import spectrumImport from './assets/spectrum-workflow/S2_Icon_Import_20_N.svg?url'
import spectrumExport from './assets/spectrum-workflow/S2_Icon_Export_20_N.svg?url'
import spectrumHand from './assets/spectrum-workflow/S2_Icon_Hand_20_N.svg?url'
import spectrumZoom from './assets/spectrum-workflow/S2_Icon_ZoomIn_20_N.svg?url'
import spectrumUndo from './assets/spectrum-workflow/S2_Icon_Undo_20_N.svg?url'
import spectrumRedo from './assets/spectrum-workflow/S2_Icon_Redo_20_N.svg?url'
import spectrumGrid from './assets/spectrum-workflow/S2_Icon_GridsAndRulers_20_N.svg?url'
import spectrumFit from './assets/spectrum-workflow/S2_Icon_FullScreen_20_N.svg?url'
import spectrumAssets from './assets/spectrum-workflow/S2_Icon_Image_20_N.svg?url'
import spectrumSettings from './assets/spectrum-workflow/S2_Icon_Settings_20_N.svg?url'

const RichDocument = lazy(() => import('./document/RichDocument').then((module) => ({ default: module.RichDocument })))
const ProcessDocumentView = lazy(() => import('./document/ProcessDocumentView').then((module) => ({ default: module.ProcessDocumentView })))
import type { ProcessDocument } from './model/processDocument'
import { createDefaultProductionPipeline } from './model/processDocument'
import type { DocumentWorkspaceControls, DocumentWorkspaceViewSnapshot } from './document/RichDocument'
import './document/documentSessions.css'

type DocumentHistoryOwner = 'document' | 'canvas' | 'none'
export type SearchOriginSnapshot = {
  projectId: string
  mode: ViewMode
  activeBoardId: string
  activeDocumentId: string
  activeNavigatorItem: string
  activeEditor: 'document' | 'canvas'
  historyOwner: DocumentHistoryOwner
  showNavigatorPanel: boolean
  showInspectorPanel: boolean
  canvasSelection?: { boardId: string; ids: string[] } | null
  documentView?: DocumentWorkspaceViewSnapshot
  originTitle: string
}
type DocumentFocusWritingOrigin = {
  sessionKey: string; sessionRevision: number; projectId: string; documentId: string; controlKey: string
  mode: ViewMode; compactSplit: boolean; activeEditor: 'document' | 'canvas'; historyOwner: DocumentHistoryOwner
  showNavigatorPanel: boolean; showInspectorPanel: boolean; showInspectorDrawer: boolean
  navigatorWidth: number; inspectorWidth: number; split: number
  opener: HTMLElement | null; controls: React.RefObject<DocumentWorkspaceControls | null>
}
type DocumentPublicationContext = { projectId: string; workspaceRoot?: string; permissionRevision: number; sessionRevision: number; documentRevision: number }
const ProjectQuestionnaire = lazy(() => import('./document/ProjectQuestionnaire').then((module) => ({ default: module.ProjectQuestionnaire })))
const VelloBoardBackdrop = lazy(() => import('./board/VelloBoardBackdrop').then((module) => ({ default: module.VelloBoardBackdrop })))
const BoardRichText = lazy(() => import('./board/BoardRichText').then((module) => ({ default: module.BoardRichText })))
const CapturedContentCard = lazy(() => import('./board/CapturedContent').then((module) => ({ default: module.CapturedContentCard })))
const CaptureEditorDialog = lazy(() => import('./board/CapturedContent').then((module) => ({ default: module.CaptureEditorDialog })))
const ModelViewer = lazy(() => import('./board/ModelViewer').then((module) => ({ default: module.ModelViewer })))
const VideoReview = lazy(() => import('./board/VideoReview').then((module) => ({ default: module.VideoReview })))
const AssetManager = lazy(() => import('./media/AssetManager').then((module) => ({ default: module.AssetManager })))
const ColorPanel = lazy(() => import('./color/ColorPanel').then((module) => ({ default: module.ColorPanel })))
const BoardMinimap = lazy(() => import('./board/BoardMinimap').then((module) => ({ default: module.BoardMinimap })))
const PdfPreview = lazy(() => import('./board/PdfPreview').then((module) => ({ default: module.PdfPreview })))
const PsdPreview = lazy(() => import('./board/PsdPreview').then((module) => ({ default: module.PsdPreview })))
const FormatImagePreview = lazy(() => import('./board/FormatImagePreview').then((module) => ({ default: module.FormatImagePreview })))

const MODE_LABELS: Record<ViewMode, string> = {
  document: 'Document',
  split: 'Split',
  canvas: 'Canvas',
}

type ResizeHandle = 'nw' | 'n' | 'ne' | 'e' | 'se' | 's' | 'sw' | 'w'


const canvasSelectionByBoard = new Map<string, string[]>()
const NUDGE_STEP = 1
// Keep click selection stationary at every zoom before starting a node-body drag.
const NODE_DRAG_ACTIVATION_PX = 4
const SHIFT_NUDGE_STEP = 10
const DARK_BOARD_BACKGROUND = CANVAS_THEME_COLORS.dark.background
const LIGHT_BOARD_BACKGROUND = CANVAS_THEME_COLORS.light.background
const DARK_GRID_COLOR = CANVAS_THEME_COLORS.dark.grid
const LIGHT_GRID_COLOR = CANVAS_THEME_COLORS.light.grid
const MIN_CANVAS_ZOOM = .18
const MAX_CANVAS_ZOOM = 3
const CANVAS_ZOOM_STEPS = [.18, .25, .33, .5, .67, .8, 1, 1.25, 1.5, 2, 2.5, 3]

type StressProfile = 'mixed' | 'raster' | 'vector'
const STRESS_BOARD_SIZES = new Set([100, 1_000, 5_000, 20_000])

/** Deterministic development-only workloads used by the Generation 0 benchmark. */
function createStressBoardNodes(count: number, profile: StressProfile): BoardNode[] {
  return Array.from({ length: count }, (_, index) => {
    const column = index % 100
    const row = Math.floor(index / 100)
    const base = {
      id: `stress-${profile}-${index}`,
      x: column * 300,
      y: row * 230,
      width: 260,
      height: 190,
      title: `${profile} reference ${index + 1}`,
      color: index % 2 ? '#56748e' : '#c56c65',
    }
    if (profile === 'raster') return { ...base, kind: 'image' as const }
    if (profile === 'vector' || index % 4 === 0) {
      return {
        ...base,
        kind: 'shape' as const,
        shapeType: 'path' as const,
        strokeColor: '#e8c18b',
        strokeWidth: 2,
        vectorPath: {
          version: 1 as const,
          closed: index % 3 === 0,
          points: [
            { x: 8, y: 92, handleOut: { x: 38, y: -72 } },
            { x: 126, y: 38, handleIn: { x: -42, y: 44 }, handleOut: { x: 38, y: 54 } },
            { x: 250, y: 112, handleIn: { x: -46, y: -58 } },
          ],
        },
      }
    }
    if (index % 4 === 1) return { ...base, kind: 'image' as const }
    if (index % 4 === 2) return { ...base, kind: 'note' as const, body: 'Generation 0 mixed-workload note' }
    return { ...base, kind: 'text' as const, body: 'Generation 0 text object' }
  })
}

function nodeColorTargets(node: BoardNode): ColorTarget[] {
  if (node.kind === 'shape') {
    if (node.shapeType === 'line' || node.shapeType === 'arrow' || (node.shapeType === 'path' && node.vectorPath && !node.vectorPath.closed)) return ['stroke']
    return node.body ? ['fill', 'stroke', 'text'] : ['fill', 'stroke']
  }
  if (node.graphColumn || node.kind === 'column') return ['fill', 'columnBody', 'text']
  if (node.kind === 'text') return ['text']
  if (node.kind === 'note') return ['fill', 'text']
  if (node.kind === 'group' || node.kind === 'board-link') return ['fill', 'text']
  return ['fill']
}

function sharedColorTargets(nodes: BoardNode[]): ColorTarget[] {
  if (!nodes.length) return []
  return nodeColorTargets(nodes[0]).filter((target) => nodes.every((node) => nodeColorTargets(node).includes(target)))
}

type AssetManagerLaunch = { projectId: string; boardId: string; projectTitle: string }

function nativeDragClientPositions(position: { x: number; y: number }, scaleFactor: number, physicalSize?: { width: number; height: number }) {
  const safeScale = Number.isFinite(scaleFactor) && scaleFactor > 0 ? scaleFactor : 1
  // WebView2 normally reports physical coordinates, but some Windows runtime
  // and display combinations already return client-logical coordinates. Keep
  // the raw point as a final fallback so a valid canvas drop is never silently
  // discarded merely because the runtime changed coordinate convention.
  const candidates = [
    { x: position.x / safeScale, y: position.y / safeScale },
    { x: position.x / safeScale - window.screenX, y: position.y / safeScale - window.screenY },
    ...(physicalSize?.width && physicalSize?.height ? [{ x: position.x * window.innerWidth / physicalSize.width, y: position.y * window.innerHeight / physicalSize.height }] : []),
    { x: position.x, y: position.y },
  ]
  return candidates.filter((candidate, index) => candidates.findIndex((entry) => Math.abs(entry.x - candidate.x) < .5 && Math.abs(entry.y - candidate.y) < .5) === index)
}

function positionInside(rect: DOMRect, point: { x: number; y: number }) {
  return point.x >= rect.left && point.x <= rect.right && point.y >= rect.top && point.y <= rect.bottom
}

function readableForeground(background: string, light = '#f4f0e8', dark = '#211d18') {
  return canvasReadableForeground(background, light, dark)
}

function isFrameNode(node: BoardNode) {
  return node.kind === 'group' && (node.containerRole === 'frame' || /\bframe\b/i.test(node.title))
}

function translateVectorPath(path: VectorPath, dx: number, dy: number): VectorPath {
  return { ...path, points: path.points.map((point) => ({ ...point, x: point.x + dx, y: point.y + dy })) }
}

function hasNonIdentityVectorTransform(node: BoardNode) {
  const transform = node.vectorTransform
  return Boolean(node.rotation || (transform && (
    (transform.translateX || 0) !== 0 || (transform.translateY || 0) !== 0 ||
    (transform.scaleX ?? 1) !== 1 || (transform.scaleY ?? 1) !== 1 ||
    (transform.skewX || 0) !== 0 || (transform.skewY || 0) !== 0
  )))
}

// A plain editable path stores local point coordinates. Reframe it after an
// anchor edit so its node rectangle describes the actual Bézier geometry,
// rather than the rectangle that existed when the Pen path was first created.
function fitEditableVectorPathNode(node: BoardNode, pathChanged = false): BoardNode {
  if(pathChanged) node=synchronizeVectorStroke(node)
  if (node.kind !== 'shape' || node.shapeType !== 'path' || !node.vectorPath || node.vectorBoolean || hasNonIdentityVectorTransform(node)) return node
  const bounds = vectorPathBounds(node.vectorPath)
  if (![bounds.left, bounds.top, bounds.right, bounds.bottom].every(Number.isFinite)) return node
  const left = Math.floor(bounds.left), top = Math.floor(bounds.top)
  const right = Math.ceil(bounds.right), bottom = Math.ceil(bounds.bottom)
  const width = Math.max(12, right - left), height = Math.max(12, bottom - top)
  const angle = (node.rotation || 0) * Math.PI / 180
  const centerDelta = { x: left + (width - node.width) / 2, y: top + (height - node.height) / 2 }
  return {
    ...node,
    x: node.x + (node.width - width) / 2 + centerDelta.x * Math.cos(angle) - centerDelta.y * Math.sin(angle),
    y: node.y + (node.height - height) / 2 + centerDelta.x * Math.sin(angle) + centerDelta.y * Math.cos(angle),
    width,
    height,
    ...transformVectorPaint(node,[1,0,0,1,-left,-top]),
    vectorPath: translateVectorPath(node.vectorPath, -left, -top),
  }
}

function directSelectionPath(node: BoardNode): VectorPath | undefined {
  if (node.vectorPath) return node.vectorPath
  if (node.kind === 'shape' && (node.shapeType === 'line' || node.shapeType === 'arrow')) {
    return { version: 1, closed: false, points: [{ x: 0, y: 0 }, { x: node.width, y: node.height }] }
  }
  return undefined
}

type LiveShapeAnchor = 'nw' | 'ne' | 'se' | 'sw' | 'n' | 'e' | 's' | 'w'

/** Linked column headers derive a tonal step from the body color: slightly
 * lighter for dark bodies, slightly darker for light bodies. */
function deriveLinkedHeader(body: string) {
  const parsed = /^#([0-9a-f]{6})$/i.exec(body.trim())
  if (!parsed) return body
  const value = parseInt(parsed[1], 16)
  const channels = [(value >> 16) & 255, (value >> 8) & 255, value & 255]
  const luminance = .2126 * channels[0] + .7152 * channels[1] + .0722 * channels[2]
  const mix = (channel: number) => Math.round(luminance < 128 ? channel + (255 - channel) * .22 : channel * .8)
  return '#' + channels.map(mix).map((channel) => channel.toString(16).padStart(2, '0')).join('')
}

/* Direct-selection editing math must run in the node's local coordinate
 * space. Cards render with `rotate(θ)` about the box center, so a screen
 * delta has to be rotated back before it is applied to anchor/handle
 * coordinates, and a world point has to be un-transformed before it can be
 * compared with local path points. Fisheye zoom scales the same frame. */
function worldToLocalDelta(node: BoardNode, delta: BoardPoint, fisheye = 1): BoardPoint {
  const theta = (node.rotation || 0) * Math.PI / 180
  const scale = fisheye || 1
  if (!theta && scale === 1) return delta
  const cos = Math.cos(-theta), sin = Math.sin(-theta)
  const x = delta.x * cos - delta.y * sin
  const y = delta.x * sin + delta.y * cos
  return { x: x / scale, y: y / scale }
}

function isLiveShapeDirectSelectable(node: BoardNode) {
  return node.kind === 'shape' && !node.vectorPath && (node.shapeType === 'rectangle' || node.shapeType === 'ellipse')
}

export function hitTestBoardNode(node: BoardNode, worldPoint: BoardPoint, zoomScale = 1): boolean {
  if (node.hidden) return false
  if (node.kind === 'shape' && (isRectangleErasure(node) || node.shapeType === 'line' || node.shapeType === 'ellipse' || (node.shapeType === 'path' && node.vectorPath))) {
    // Compatibility callers have no host lifecycle. The normal canvas click
    // path below reuses its own picker and the exact indexed scene geometry.
    const picker = createCanonicalVectorPicker()
    try {
      if (node.shapeType === 'path' || picker.nodeStatus(node) !== 'unsupported') return picker.hitNode(node, worldPoint, zoomScale)
    }
    finally { picker.dispose() }
  }

  const cx = node.x + node.width / 2
  const cy = node.y + node.height / 2
  const theta = (node.rotation || 0) * Math.PI / 180
  const cos = Math.cos(-theta), sin = Math.sin(-theta)
  const dx = worldPoint.x - cx
  const dy = worldPoint.y - cy
  const localX = dx * cos - dy * sin
  const localY = dx * sin + dy * cos

  if (node.shapeType === 'ellipse') {
    const rx = node.width / 2
    const ry = node.height / 2
    return (localX * localX) / Math.max(1, rx * rx) + (localY * localY) / Math.max(1, ry * ry) <= 1
  }

  return Math.abs(localX) <= node.width / 2 && Math.abs(localY) <= node.height / 2
}

function VectorPathShape({ node, viewportScale, editing = false, selectedSegments = [], previewSegments = [], onSelectSegment, onDragSegment, onPaintChange }: { node: BoardNode; viewportScale: number; editing?: boolean; selectedSegments?: number[]; previewSegments?: number[]; onSelectSegment?: (index: number, additive: boolean) => void; onDragSegment?: (event: React.PointerEvent<SVGPathElement>, index: number) => void;onPaintChange?:(gradient:NonNullable<BoardNode['vectorFillGradient']>)=>void }) {
  const primary = node.vectorPath
  if (!primary) return null
  const paintPrefix=`canvas:${node.id}`
  const stroke = node.vectorStrokeGradient ? `url(#${paintId(paintPrefix,'stroke')})` : node.strokeColor || '#b9d4e7'
  const fill = node.vectorFillGradient ? `url(#${paintId(paintPrefix,'fill')})` : node.color || 'transparent'
  const boolean = node.vectorBoolean
  const geometry = vectorGeometryCache.get(primary, viewportScale, editing || Boolean(node.vectorBoolean))
  const primaryData = editing ? geometry.canonicalData : geometry.renderData
  const operands = boolean?.operands || [primary]
  const resolved = boolean ? boolean.resolvedPaths ?? resolveVectorBooleanGeometry(boolean.operation, operands, boolean.fillRules ?? operands.map(() => node.vectorFillRule ?? 'nonzero')) : undefined
  // Boolean operands stay exact because changing their topology would change
  // the visual result. Ordinary paths use disposable screen-space LOD data.
  const compoundData = resolved ? resolved.map(vectorPathData).join(' ') : boolean ? operands.map(vectorPathData).join(' ') : primaryData
  const id = `vector-boolean-${node.id}`
  const fillRule = resolved ? 'nonzero' : boolean?.operation === 'exclude' ? 'evenodd' : node.vectorFillRule || 'nonzero'
  const common = { fill, fillOpacity: primary.closed ? paintAlpha(node.fillOpacity) : 0, fillRule, clipRule: fillRule, stroke:node.vectorStrokeGeometry?'none':stroke, strokeOpacity:paintAlpha(node.strokeOpacity), strokeWidth: node.strokeWidth ?? 2, strokeLinejoin: node.vectorStrokeJoin || 'miter', strokeLinecap: node.vectorStrokeCap || 'butt', pointerEvents: 'none' as const }
  const segmentCount = primary.closed ? primary.points.length : Math.max(0, primary.points.length - 1)
  return <svg className="node-vector-shape" data-vector-lod={geometry.band} data-vector-cache-bytes={geometry.estimatedBytes} viewBox={`0 0 ${node.width} ${node.height}`} preserveAspectRatio="none">
    <g transform={vectorTransformData(node)}>
      <VectorPaintDefs node={node} prefix={paintPrefix}/>
      <path className="shape-hit-area" data-vector-hit-proxy="cached" d={resolved ? compoundData : boolean?.operation === 'subtract' || boolean?.operation === 'intersect' ? primaryData : boolean ? compoundData : geometry.hitData} fill={primary.closed ? 'transparent' : 'none'} stroke="transparent" strokeWidth={Math.max(16, (node.strokeWidth ?? 2) * 4)} strokeLinejoin={node.vectorStrokeJoin || 'miter'} strokeLinecap={node.vectorStrokeCap || 'butt'} vectorEffect="non-scaling-stroke" pointerEvents="all" />
      {onSelectSegment && !boolean && Array.from({ length: segmentCount }, (_, index) => <path key={`segment-hit-${index}`} className="vector-segment-hit" data-segment-index={index} d={geometry.segmentHitData[index]} fill="none" stroke="#ffffff" strokeOpacity=".001" strokeWidth={Math.max(16, (node.strokeWidth ?? 2) * 4)} vectorEffect="non-scaling-stroke" onPointerDown={(event) => { event.preventDefault(); event.stopPropagation(); onSelectSegment(index, event.shiftKey); if (!event.shiftKey) onDragSegment?.(event, index) }} />)}
      {[...new Set([...previewSegments, ...selectedSegments])].map((index) => <path key={`segment-selected-${index}`} data-segment-index={index} className={`vector-segment-selected ${previewSegments.includes(index) && !selectedSegments.includes(index) ? 'preview' : ''}`} d={geometry.segmentData[index]} fill="none" stroke="#f8d39c" strokeWidth={(node.strokeWidth ?? 2) + 3} strokeLinecap="round" vectorEffect="non-scaling-stroke" pointerEvents="none" />)}
      {!resolved && boolean?.operation === 'subtract' && <><defs><mask id={id} maskUnits="userSpaceOnUse" x={-16} y={-16} width={node.width + 32} height={node.height + 32}><rect x={-16} y={-16} width={node.width + 32} height={node.height + 32} fill="white" />{operands.slice(1).map((path, index) => <path key={index} d={vectorPathData(path)} fill="black" fillRule={fillRule} />)}</mask></defs><path d={primaryData} {...common} mask={`url(#${id})`} /></>}
      {!resolved && boolean?.operation === 'intersect' && <><defs><clipPath id={id}><path d={primaryData} fillRule={fillRule} /></clipPath></defs><path d={vectorPathData(operands[1])} clipPath={`url(#${id})`} {...common} /></>}
      {node.vectorTexture ? <><defs><clipPath id={`${id}-texture`}><path d={compoundData} clipRule={fillRule}/></clipPath></defs><g clipPath={`url(#${id}-texture)`}><image href={node.vectorTexture.href} width={node.vectorTexture.width} height={node.vectorTexture.height} transform={`matrix(${node.vectorTexture.transform.join(' ')})`} preserveAspectRatio="none" opacity={paintAlpha(node.fillOpacity)} pointerEvents="none"/></g></> : (resolved || !boolean || boolean.operation === 'union' || boolean.operation === 'exclude') && <path data-vector-result-paint={resolved ? 'resolved' : undefined} d={compoundData} {...common} />}
      <VectorStrokePaint node={node} id={id} stroke={stroke}/>
      {onPaintChange&&node.vectorFillGradient&&<GradientHandles node={node} scale={viewportScale} onChange={onPaintChange}/>}
    </g>
  </svg>
}

type CanvasToolIconName = 'select' | 'node' | 'type' | 'pen' | 'rectangle' | 'ellipse' | 'line' | 'arrow' | 'connector' | 'column' | 'frame' | 'import' | 'export' | 'hand' | 'zoom' | 'fisheye' | 'undo' | 'redo' | 'grid' | 'monochrome' | 'boards' | 'more' | 'paste' | 'present' | 'assets' | 'appearance' | 'pack' | 'normalize' | 'unsorted' | 'status' | 'fit' | 'miner'

/** Milanote-style appearance picker for subboard tiles: a searchable icon
 * library and an image mode sharing one popover. Icon changes preview live;
 * removing the image restores the last selected icon. */
function TileAppearancePopover({ board, coverUrl, position, onUpdate, onChooseImage, onClose }: { board: BoardModel; coverUrl: string | undefined; position: { x: number; y: number }; onUpdate: (update: Pick<BoardModel, 'tileAccentColor' | 'tileIcon' | 'coverAssetId' | 'coverFraming'>) => void; onChooseImage: () => void; onClose: () => void }) {
  const [mode, setMode] = useState<'icons' | 'image'>(coverUrl ? 'image' : 'icons')
  const [query, setQuery] = useState('')
  const [category, setCategory] = useState<TileIconCategory | 'All'>('Recommended')
  const [recents] = useState(recentTileIcons)
  const popoverRef = useRef<HTMLDivElement>(null)
  useEffect(() => {
    const dismiss = (event: PointerEvent) => { if (!(event.target as Element).closest('.tile-appearance-picker')) onClose() }
    const escape = (event: KeyboardEvent) => { if (event.key === 'Escape') onClose() }
    window.addEventListener('pointerdown', dismiss)
    window.addEventListener('keydown', escape)
    return () => { window.removeEventListener('pointerdown', dismiss); window.removeEventListener('keydown', escape) }
  }, [onClose])
  const results = searchTileIcons(query, category)
  const left = Math.min(position.x, window.innerWidth - 340)
  const top = Math.min(position.y, window.innerHeight - 420)
  return <div className="tile-appearance-picker" role="dialog" aria-label={`Tile appearance for ${board.title}`} style={{ left, top }} ref={popoverRef}>
    <header>
      <div className="tile-appearance-tabs" role="tablist">
        <button type="button" role="tab" aria-selected={mode === 'icons'} className={mode === 'icons' ? 'active' : ''} onClick={() => setMode('icons')}>Icons</button>
        <button type="button" role="tab" aria-selected={mode === 'image'} className={mode === 'image' ? 'active' : ''} onClick={() => setMode('image')}>Image</button>
      </div>
      <button type="button" className="tile-appearance-close" aria-label="Close tile appearance picker" onClick={onClose}>✕</button>
    </header>
    {mode === 'icons' ? <>
      <div className="tile-appearance-search">
        <input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Search icons…" aria-label="Search tile icons" />
        <select value={category} onChange={(event) => setCategory(event.target.value as TileIconCategory | 'All')} aria-label="Icon category">
          <option value="Recommended">Recommended</option>
          <option value="All">All categories</option>
          {TILE_ICON_CATEGORIES.filter((entry) => entry !== 'Recommended').map((entry) => <option key={entry} value={entry}>{entry}</option>)}
        </select>
      </div>
      {!query && category === 'Recommended' && recents.length > 0 && <div className="tile-appearance-recents"><span>Recent</span><div className="tile-appearance-grid compact">{recents.map((glyph) => <button key={`recent-${glyph}`} type="button" className={(board.tileIcon || '▦') === glyph ? 'selected' : ''} title={glyph} aria-label={`Recent icon ${glyph}`} onClick={() => { rememberTileIcon(glyph); onUpdate({ tileIcon: glyph }) }}>{glyph}</button>)}</div></div>}
      <div className="tile-appearance-grid" role="listbox" aria-label="Icon choices">
        {results.map((icon) => <button key={`${icon.category}-${icon.name}`} type="button" role="option" aria-selected={(board.tileIcon || '▦') === icon.glyph} className={(board.tileIcon || '▦') === icon.glyph ? 'selected' : ''} title={`${icon.name} · ${icon.category}`} onClick={() => { rememberTileIcon(icon.glyph); onUpdate({ tileIcon: icon.glyph }) }}><span>{icon.glyph}</span><small>{icon.name}</small></button>)}
        {!results.length && <p className="tile-appearance-empty">No icons match “{query}”.</p>}
      </div>
      <footer><button type="button" className="quiet-button compact" onClick={() => onUpdate({ tileIcon: undefined })}>Reset to default</button><small>Selection previews on the tile immediately.</small></footer>
    </> : <>
      <div className="tile-appearance-image">
        <div className="tile-appearance-preview" style={{ '--node-accent': board.tileAccentColor || '#6ba39b', '--node-icon-foreground': readableForeground(board.tileAccentColor || '#6ba39b'), ...coverImageStyle(coverUrl, board.coverFraming) } as React.CSSProperties}>{coverUrl ? '' : (board.tileIcon || '▦')}</div>
        <div>
          <strong>{coverUrl ? 'Custom image active' : 'No image chosen'}</strong>
          <small>{coverUrl ? 'The image covers the tile; the icon returns when it is removed.' : 'Use a square image for the sharpest tiles. Icons stay available on the other tab.'}</small>
          <div className="tile-appearance-actions">
            <button type="button" className="primary-button" onClick={() => { onChooseImage(); onClose() }}>{coverUrl ? 'Replace image…' : 'Choose image…'}</button>
            {coverUrl && <button type="button" className="quiet-button" onClick={() => onUpdate({ coverAssetId: undefined, coverFraming: undefined })}>Remove image</button>}
          </div>
        </div>
      </div>
      <footer><small>Accent color is set from the tile color control in the subboard menu.</small></footer>
    </>}
  </div>
}

function CanvasToolIcon({ name }: { name: CanvasToolIconName }) {
  if (name === 'select') return <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M5 2v17l4-5 4 7 3-1-4-7 7-1Z" fill="currentColor" stroke="var(--surface-overlay)" strokeWidth="1.3" strokeLinejoin="round" /></svg>
  const spectrum: Partial<Record<CanvasToolIconName, string>> = {
    node: spectrumNode, type: spectrumType, pen: spectrumPen,
    rectangle: spectrumRectangle, ellipse: spectrumEllipse, line: spectrumLine, connector: spectrumConnector,
    frame: spectrumFrame, import: spectrumImport, export: spectrumExport, hand: spectrumHand,
    zoom: spectrumZoom, undo: spectrumUndo, redo: spectrumRedo, grid: spectrumGrid,
    fit: spectrumFit, assets: spectrumAssets, appearance: spectrumSettings,
  }
  if (spectrum[name]) return <span className="spectrum-workflow-icon" style={{ '--spectrum-icon': `url("${spectrum[name]}")` } as React.CSSProperties} aria-hidden="true" />
  const content: Record<CanvasToolIconName, React.ReactNode> = {
    select: <path d="M5 3.5 18 13l-6 .7 3.4 6.1-2.8 1.5-3.3-6.1L5 19Z" />,
    node: <><path d="M5 3.5 17.5 13l-5.8.7-2.8 5.1Z" /><rect x="15.5" y="4" width="4" height="4" rx=".5" /></>,
    type: <><path d="M5 5h14M12 5v15M8.5 20h7" /></>,
    pen: <><path d="m4 20 3.1-7.7L14 5.4l4.6 4.6-6.9 6.9Z" /><circle cx="10.6" cy="13.4" r="1.5" /><path d="m14 5.4 1.4-1.4 4.6 4.6-1.4 1.4" /></>,
    rectangle: <rect x="4" y="5" width="16" height="14" rx="1" />,
    ellipse: <ellipse cx="12" cy="12" rx="8" ry="6.5" />,
    line: <path d="m5 19 14-14" />,
    arrow: <><path d="m5 19 14-14M12 5h7v7" /></>,
    connector: <><rect x="3.5" y="5" width="6" height="5" rx="1" /><rect x="14.5" y="14" width="6" height="5" rx="1" /><path d="M9.5 7.5h3a4 4 0 0 1 4 4V14" /></>,
    column: <><rect x="4" y="3.5" width="16" height="17" rx="1.5" /><path d="M4 8h16M7 11h10M7 14h10M7 17h7" /></>,
    frame: <><path d="M4 9V4h5M15 4h5v5M20 15v5h-5M9 20H4v-5" /><path d="M8 8h8v8H8z" /></>,
    import: <><path d="M12 3v11M8 10l4 4 4-4" /><path d="M5 16v4h14v-4" /></>,
    export: <><path d="M12 21V10M8 14l4-4 4 4" /><path d="M5 8V4h14v4" /></>,
    hand: <path d="M7.5 11V6.5a1.5 1.5 0 0 1 3 0V10m0-4.5a1.5 1.5 0 0 1 3 0V10m0-3a1.5 1.5 0 0 1 3 0v4m0-2a1.5 1.5 0 0 1 3 0v4.2c0 4.3-2.8 7.3-7.2 7.3-2.2 0-3.8-.8-5.1-2.4L4 14.3a1.7 1.7 0 0 1 2.5-2.2l2 2.1" />,
    zoom: <><circle cx="10.5" cy="10.5" r="6.5" /><path d="m15.5 15.5 4.5 4.5M10.5 7.5v6M7.5 10.5h6" /></>,
    fisheye: <><circle cx="12" cy="12" r="8" /><path d="M6.5 12c1.6-3.2 3.4-4.8 5.5-4.8s3.9 1.6 5.5 4.8c-1.6 3.2-3.4 4.8-5.5 4.8S8.1 15.2 6.5 12Z" /><circle cx="12" cy="12" r="2.2" /></>,
    undo: <><path d="m9 7-5 5 5 5" /><path d="M5 12h8a6 6 0 0 1 6 6" /></>,
    redo: <><path d="m15 7 5 5-5 5" /><path d="M19 12h-8a6 6 0 0 0-6 6" /></>,
    grid: <><rect x="4" y="4" width="16" height="16" rx="1.5" /><path d="M12 4v16M4 12h16" /></>,
    monochrome: <><circle cx="12" cy="12" r="8" /><path d="M12 4a8 8 0 0 0 0 16Z" /></>,
    boards: <><rect x="4" y="5" width="7" height="6" rx="1" /><rect x="13" y="5" width="7" height="6" rx="1" /><rect x="4" y="13" width="7" height="6" rx="1" /><rect x="13" y="13" width="7" height="6" rx="1" /></>,
    more: <><circle cx="5" cy="12" r="1" /><circle cx="12" cy="12" r="1" /><circle cx="19" cy="12" r="1" /></>,
    paste: <><path d="M9 5h6M9 5a2 2 0 1 0 0 4h6a2 2 0 1 0 0-4" /><path d="M7 8H5v12h14V8h-2" /></>,
    present: <><rect x="4" y="4" width="16" height="12" rx="1" /><path d="M9 20h6M12 16v4" /></>,
    miner: <><path d="M4 7h9M4 12h13M4 17h9" /><path d="m17 14 3 3-3 3" /></>,
    assets: <><rect x="4" y="5" width="16" height="14" rx="1.5" /><circle cx="9" cy="10" r="1.5" /><path d="m5 17 4.5-4 3 2.5 2.5-3 4 4.5" /></>,
    appearance: <><path d="M4 7h16M4 12h16M4 17h16" /><circle cx="9" cy="7" r="2" /><circle cx="15" cy="12" r="2" /><circle cx="11" cy="17" r="2" /></>,
    pack: <><rect x="4" y="4" width="6" height="6" rx="1" /><rect x="14" y="4" width="6" height="6" rx="1" /><rect x="4" y="14" width="6" height="6" rx="1" /><path d="M14 17h6M17 14v6" /></>,
    normalize: <><path d="M5 7h14M5 17h14M8 4v6M16 14v6" /><path d="m8 4-2 2m2-2 2 2m8 8-2 2m2-2-2-2" /></>,
    unsorted: <><path d="M4 7h9M4 12h13M4 17h9" /><circle cx="18" cy="7" r="1" /><circle cx="18" cy="17" r="1" /></>,
    status: <><circle cx="12" cy="12" r="8" /><path d="M12 7v5l3 2" /></>,
    fit: <><path d="M9 4H4v5M15 4h5v5M20 15v5h-5M4 15v5h5" /><path d="M8 8h8v8H8z" /></>,
  }
  return <svg viewBox="0 0 24 24" aria-hidden="true">{content[name]}</svg>
}

type CanvasContextCommand = {
  label: string
  onSelect: () => void
  disabled?: boolean
  danger?: boolean
  title?: string
}

function CanvasContextMenuCommand({ command }: { command: CanvasContextCommand }) {
  return <button type="button" disabled={command.disabled} title={command.title} className={command.danger ? 'context-danger' : undefined} onClick={command.onSelect}>{command.label}</button>
}

function CanvasContextMenuSurface({ x, y, onClose, children }: { x: number; y: number; onClose: () => void; children: ReactNode }) {
  const menuRef = useRef<HTMLDivElement>(null)
  const returnFocusRef = useRef<HTMLElement | null>(document.activeElement instanceof HTMLElement ? document.activeElement : null)
  const onCloseRef = useRef(onClose)
  const [position, setPosition] = useState({ left: x, top: y, ready: false })

  useLayoutEffect(() => { onCloseRef.current = onClose }, [onClose])

  useLayoutEffect(() => {
    const menu = menuRef.current
    if (!menu) return
    const gutter = 10
    const bounds = menu.getBoundingClientRect()
    setPosition({ left: Math.max(gutter, Math.min(x, window.innerWidth - bounds.width - gutter)), top: Math.max(gutter, Math.min(y, window.innerHeight - bounds.height - gutter)), ready: true })
    menu.querySelectorAll('button').forEach((button) => { if (!button.hasAttribute('role')) button.setAttribute('role', 'menuitem') })
    menu.querySelector<HTMLButtonElement>('button:not(:disabled)')?.focus()
  }, [x, y])

  useEffect(() => {
    const returnFocus = returnFocusRef.current
    const closeFromOutside = (event: PointerEvent) => {
      if (!menuRef.current?.contains(event.target as Node)) onCloseRef.current()
    }
    window.addEventListener('pointerdown', closeFromOutside)
    return () => {
      window.removeEventListener('pointerdown', closeFromOutside)
      returnFocus?.focus()
    }
  }, [])

  const navigate = (event: React.KeyboardEvent<HTMLDivElement>) => {
    if (event.key === 'Escape') { event.preventDefault(); onClose(); return }
    if (!['ArrowDown', 'ArrowUp', 'Home', 'End'].includes(event.key)) return
    const items = [...(menuRef.current?.querySelectorAll<HTMLButtonElement>('button:not(:disabled)') || [])]
    if (!items.length) return
    event.preventDefault()
    const current = Math.max(0, items.indexOf(document.activeElement as HTMLButtonElement))
    const next = event.key === 'Home' ? 0 : event.key === 'End' ? items.length - 1 : event.key === 'ArrowDown' ? (current + 1) % items.length : (current - 1 + items.length) % items.length
    items[next].focus()
  }

  return <div ref={menuRef} className={`canvas-context-menu ${position.ready ? 'positioned' : ''}`} role="menu" aria-label="Canvas context menu" style={{ left: position.left, top: position.top }} onKeyDown={navigate} onPointerDown={(event) => event.stopPropagation()}>{children}</div>
}

function escapeHtml(value: string) {
  return value.replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;').replaceAll('"', '&quot;')
}

let sharedMeasureCtx: CanvasRenderingContext2D | null = null
function measureRun(text: string, family: string, size: number, weight: string): number {
  if (!text) return 0
  if (typeof document !== 'undefined') {
    if (!sharedMeasureCtx) {
      try {
        const c = document.createElement('canvas')
        sharedMeasureCtx = c.getContext('2d')
      } catch {}
    }
    if (sharedMeasureCtx) {
      sharedMeasureCtx.font = `${weight} ${size}px ${family}`
      return sharedMeasureCtx.measureText(text).width
    }
  }
  const weightFactor = weight === 'bold' || Number(weight) >= 700 ? 0.56 : 0.50
  return text.length * size * weightFactor
}

type InlineStyle = {
  family: string
  size: number
  weight: string
  italic: boolean
  color: string
  tracking?: string
  lineHeight: number
  align: 'left' | 'center' | 'right'
  uppercase: boolean
}

type InlineToken = {
  isBreak?: boolean
  word?: string
  spaceBefore?: boolean
  style: InlineStyle
}

function parseInlineStyles(element: Element, parent: InlineStyle): InlineStyle {
  const styleAttr = element.getAttribute('style') || ''
  const tag = element.tagName.toLowerCase()

  let family = /font-family\s*:\s*([^;]+)/i.exec(styleAttr)?.[1]?.trim() || parent.family
  family = family.replace(/^['"]|['"]$/g, '')

  let size = parent.size
  const sizeMatch = /font-size\s*:\s*([\d.]+)px/i.exec(styleAttr)
  if (sizeMatch) size = Number(sizeMatch[1])
  else if (tag === 'h1') size = 26
  else if (tag === 'h2') size = 20
  else if (tag === 'h3') size = 16
  else if (tag === 'h4') size = 14
  else if (tag === 'small') size = parent.size * 0.85

  let weight = /font-weight\s*:\s*([^;]+)/i.exec(styleAttr)?.[1]?.trim() || parent.weight
  if (['h1', 'h2', 'h3', 'h4', 'strong', 'b'].includes(tag) && weight === '400') weight = '700'

  const italic = parent.italic || ['em', 'i'].includes(tag) || /font-style\s*:\s*italic/i.test(styleAttr)
  let color = /(?:^|;)\s*color\s*:\s*([^;]+)/i.exec(styleAttr)?.[1]?.trim() || parent.color
  if (/^#[0-9a-f]{8}$/i.test(color) && color.slice(7).toLowerCase() === 'ff') color = color.slice(0, 7)

  const tracking = /letter-spacing\s*:\s*([^;]+)/i.exec(styleAttr)?.[1]?.trim() || parent.tracking
  const lineHeightMatch = /line-height\s*:\s*([\d.]+)/i.exec(styleAttr)
  const lineHeight = lineHeightMatch ? Number(lineHeightMatch[1]) : parent.lineHeight

  const alignMatch = /text-align\s*:\s*(left|center|right|justify)/i.exec(styleAttr)
  const align = alignMatch ? (alignMatch[1].toLowerCase() === 'center' ? 'center' : alignMatch[1].toLowerCase() === 'right' ? 'right' : 'left') : parent.align

  const uppercase = parent.uppercase || /text-transform\s*:\s*uppercase/i.test(styleAttr)

  return { family, size, weight, italic, color, tracking, lineHeight, align, uppercase }
}

function collectTokens(node: Node, currentStyle: InlineStyle, outTokens: InlineToken[]) {
  if (node.nodeType === Node.TEXT_NODE) {
    let text = node.nodeValue || ''
    if (currentStyle.uppercase) text = text.toUpperCase()
    const normalized = text.replaceAll('\u00A0', ' ')
    const parts = normalized.split(/(\s+)/)
    for (let i = 0; i < parts.length; i++) {
      const part = parts[i]
      if (!part) continue
      if (!/^\s+$/.test(part)) {
        const hasSpaceBefore = i > 0 && /^\s+$/.test(parts[i - 1])
        outTokens.push({
          word: part,
          spaceBefore: hasSpaceBefore,
          style: currentStyle,
        })
      }
    }
  } else if (node.nodeType === Node.ELEMENT_NODE) {
    const el = node as Element
    const tag = el.tagName.toLowerCase()
    if (tag === 'br') {
      outTokens.push({ isBreak: true, style: currentStyle })
      return
    }
    const nextStyle = parseInlineStyles(el, currentStyle)
    for (let child = el.firstChild; child; child = child.nextSibling) {
      collectTokens(child, nextStyle, outTokens)
    }
  }
}

function textSvgMarkup(
  html: string,
  x: number,
  y: number,
  width: number,
  defaults: { color: string; family: string; size: number; weight?: string },
  opacity = 1,
  height?: number,
  clipId?: string
) {
  if (!html) return ''
  const parsed = new DOMParser().parseFromString(html, 'text/html')
  const rootStyle: InlineStyle = {
    family: defaults.family || 'Arial, sans-serif',
    size: defaults.size || 14,
    weight: defaults.weight || '400',
    italic: false,
    color: defaults.color || '#ffffff',
    lineHeight: 1.25,
    align: 'left',
    uppercase: false,
  }

  const blockNodes = [...parsed.body.querySelectorAll('h1,h2,h3,h4,h5,h6,p,li,blockquote,div')]
  const topBlocks = blockNodes.filter(b => !b.parentElement?.closest('h1,h2,h3,h4,h5,h6,p,li,blockquote,div'))
  const blocks = topBlocks.length ? topBlocks : [parsed.body]

  const svgElements: string[] = []
  let currentY = y

  for (let blockIndex = 0; blockIndex < blocks.length; blockIndex++) {
    const blockEl = blocks[blockIndex]
    const blockStyle = parseInlineStyles(blockEl, rootStyle)
    const tokens: InlineToken[] = []
    for (let child = blockEl.firstChild; child; child = child.nextSibling) {
      collectTokens(child, blockStyle, tokens)
    }

    if (!tokens.length) {
      currentY += blockStyle.size * blockStyle.lineHeight
      continue
    }

    type LineItem = { text: string; style: InlineStyle; width: number; spaceBefore: boolean }
    const lines: Array<{ items: LineItem[]; align: 'left' | 'center' | 'right' }> = []
    let currentLine: LineItem[] = []
    let currentLineWidth = 0

    for (const token of tokens) {
      if (token.isBreak) {
        lines.push({ items: currentLine, align: blockStyle.align })
        currentLine = []
        currentLineWidth = 0
        continue
      }
      if (!token.word) continue

      const wordWidth = measureRun(token.word, token.style.family, token.style.size, token.style.weight)
      const spaceWidth = token.spaceBefore && currentLine.length > 0
        ? measureRun(' ', token.style.family, token.style.size, token.style.weight)
        : 0

      if (currentLine.length > 0 && currentLineWidth + spaceWidth + wordWidth > width) {
        lines.push({ items: currentLine, align: blockStyle.align })
        currentLine = [{ text: token.word, style: token.style, width: wordWidth, spaceBefore: false }]
        currentLineWidth = wordWidth
      } else {
        currentLine.push({ text: token.word, style: token.style, width: wordWidth, spaceBefore: Boolean(token.spaceBefore && currentLine.length > 0) })
        currentLineWidth += spaceWidth + wordWidth
      }
    }
    if (currentLine.length > 0) {
      lines.push({ items: currentLine, align: blockStyle.align })
    }

    for (let lineIndex = 0; lineIndex < lines.length; lineIndex++) {
      const line = lines[lineIndex]
      const maxFontSize = line.items.length ? Math.max(...line.items.map(i => i.style.size)) : blockStyle.size
      const maxLineHeight = line.items.length ? Math.max(...line.items.map(i => i.style.lineHeight)) : blockStyle.lineHeight
      const lineSpacing = maxFontSize * maxLineHeight

      currentY += (blockIndex === 0 && lineIndex === 0) ? maxFontSize * 0.95 : lineSpacing

      if (!line.items.length) continue

      let lineContentWidth = 0
      for (let i = 0; i < line.items.length; i++) {
        const item = line.items[i]
        const spaceW = item.spaceBefore ? measureRun(' ', item.style.family, item.style.size, item.style.weight) : 0
        lineContentWidth += spaceW + item.width
      }

      let curX = x
      if (line.align === 'center') curX = x + Math.max(0, (width - lineContentWidth) / 2)
      else if (line.align === 'right') curX = x + Math.max(0, width - lineContentWidth)

      for (let i = 0; i < line.items.length; i++) {
        const item = line.items[i]
        if (item.spaceBefore) {
          curX += measureRun(' ', item.style.family, item.style.size, item.style.weight)
        }
        const trackingAttr = item.style.tracking ? ` letter-spacing="${escapeHtml(item.style.tracking)}"` : ''
        const italicAttr = item.style.italic ? ' font-style="italic"' : ''
        svgElements.push(
          `<text x="${curX.toFixed(2)}" y="${currentY.toFixed(2)}" fill="${escapeHtml(item.style.color)}" font-family="${escapeHtml(item.style.family)}" font-size="${item.style.size.toFixed(2)}" font-weight="${escapeHtml(item.style.weight)}"${italicAttr}${trackingAttr} opacity="${opacity}">${escapeHtml(item.text)}</text>`
        )
        curX += item.width
      }
    }

    if (blockIndex < blocks.length - 1) {
      currentY += Math.max(3, blockStyle.size * 0.35)
    }
  }

  const innerSvg = svgElements.join('')
  if (clipId && typeof height === 'number' && height > 0) {
    return `<defs><clipPath id="${clipId}"><rect x="${x}" y="${y}" width="${width}" height="${height}" /></clipPath></defs><g clip-path="url(#${clipId})">${innerSvg}</g>`
  }
  return innerSvg
}

function textAssetHtml(extension: string, source: string) {
  if (extension === 'html' || extension === 'htm') {
    const parsed = new DOMParser().parseFromString(source, 'text/html')
    parsed.querySelectorAll('script,style,iframe,object,embed,form,input,button,link,meta').forEach((element) => element.remove())
    parsed.querySelectorAll('*').forEach((element) => [...element.attributes].forEach((attribute) => {
      if (attribute.name.startsWith('on') || ['srcset', 'action', 'formaction'].includes(attribute.name)) element.removeAttribute(attribute.name)
    }))
    return parsed.body.innerHTML || '<p>Empty HTML document</p>'
  }
  const lines = source.replaceAll('\r\n', '\n').split('\n')
  if (extension === 'md' || extension === 'markdown') return lines.map((line) => {
    const safe = escapeHtml(line.replace(/^\s*(?:[-*+] |\d+[.)]\s+)/, ''))
    if (/^###\s+/.test(line)) return `<h3>${escapeHtml(line.replace(/^###\s+/, ''))}</h3>`
    if (/^##\s+/.test(line)) return `<h2>${escapeHtml(line.replace(/^##\s+/, ''))}</h2>`
    if (/^#\s+/.test(line)) return `<h1>${escapeHtml(line.replace(/^#\s+/, ''))}</h1>`
    if (/^>\s?/.test(line)) return `<blockquote><p>${escapeHtml(line.replace(/^>\s?/, ''))}</p></blockquote>`
    if (/^\s*[-*+]\s+/.test(line)) return `<ul><li>${safe}</li></ul>`
    return safe ? `<p>${safe}</p>` : '<p></p>'
  }).join('')
  return source.split(/\r?\n\s*\r?\n/).map((paragraph) => `<p>${escapeHtml(paragraph).replaceAll(/\r?\n/g, '<br>')}</p>`).join('')
}

function emptyCapture(kind: CapturedContent['kind'] = 'social-post'): CapturedContent {
  return { kind, sourceUrl: '', sourceLabel: '', author: '', publishedAt: '', capturedAt: new Date().toISOString(), articleHtml: '<p></p>', commentsHtml: '<p></p>', transcriptHtml: '<p></p>' }
}

function migrationStepLabels(fromSchema: number) {
  return [
    [1, '1→2: split legacy document content into the document collection'],
    [2, '2→3: convert the legacy single board into per-project boards'],
    [3, '3→4: initialize the asset catalog, questionnaire, and color library'],
    [4, '4→5: normalize page layouts, connectors, and asset metadata'],
    [5, '5→6: initialize unified project shell metadata'],
    [6, '6→7: normalize versioned SVG-style vector paths and Bézier points'],
    [7, '7→8: lock the system questionnaire and add object lock/trash lifecycle fields'],
    [8, '8→9: add explicit nested-board ownership while preserving existing links as shortcuts'],
  ].filter(([version]) => fromSchema <= Number(version)).map(([, label]) => String(label))
}

function normalizeBoardVectorPaths(board: BoardModel): BoardModel {
  const finite = (value: unknown, fallback: number) => typeof value === 'number' && Number.isFinite(value) ? value : fallback
  return {
    ...board,
    nodes: (board.nodes || []).map((node) => {
      const vectorPath = normalizeVectorPath(node.vectorPath)
      const vectorBoolean = node.vectorBoolean ? {
        ...node.vectorBoolean,
        operands: (node.vectorBoolean.operands || []).map((operand) => normalizeVectorPath(operand)).filter((operand): operand is VectorPath => Boolean(operand)),
        fillRules: node.vectorBoolean.fillRules?.map((rule) => rule === 'evenodd' ? 'evenodd' as const : 'nonzero' as const),
        resolvedPaths: node.vectorBoolean.resolvedPaths?.map((path) => normalizeVectorPath(path)).filter((path): path is VectorPath => Boolean(path)),
      } : undefined
      const vectorTransform = node.vectorTransform ? {
        translateX: finite(node.vectorTransform.translateX, 0), translateY: finite(node.vectorTransform.translateY, 0),
        scaleX: finite(node.vectorTransform.scaleX, 1), scaleY: finite(node.vectorTransform.scaleY, 1),
        skewX: Math.max(-89, Math.min(89, finite(node.vectorTransform.skewX, 0))), skewY: Math.max(-89, Math.min(89, finite(node.vectorTransform.skewY, 0))),
      } : undefined
      return {
        ...node,
        ...(vectorPath ? { vectorPath } : {}),
        ...(vectorBoolean?.operands.length ? { vectorBoolean } : {}),
        vectorFillRule: node.vectorFillRule === 'evenodd' ? 'evenodd' : node.vectorFillRule === 'nonzero' ? 'nonzero' : undefined,
        vectorStrokeJoin: ['miter', 'round', 'bevel'].includes(node.vectorStrokeJoin || '') ? node.vectorStrokeJoin : undefined,
        vectorStrokeCap: ['butt', 'round', 'square'].includes(node.vectorStrokeCap || '') ? node.vectorStrokeCap : undefined,
        vectorTransform,
      }
    }),
  }
}

function migrateProjectData(storedProject: ProjectModel): ProjectModel {
  const migrated = structuredClone(storedProject) as unknown as Record<string, unknown>
  let version = Math.max(1, Number(migrated.schemaVersion) || 1)
  while (version < 9) {
    if (version === 1) {
      if (!Array.isArray(migrated.documents)) migrated.documents = [{ id: 'project-brief', title: 'Project questionnaire', content: migrated.documentContent || structuredClone(DEFAULT_DOCUMENT_CONTENT), layout: structuredClone(DEFAULT_DOCUMENT_LAYOUT) }]
      version = 2
    } else if (version === 2) {
      if (!Array.isArray(migrated.boards)) migrated.boards = [migrated.board || structuredClone(DEFAULT_BOARD)]
      version = 3
    } else if (version === 3) {
      if (!Array.isArray(migrated.assets)) migrated.assets = []
      if (!migrated.questionnaire) migrated.questionnaire = structuredClone(DEFAULT_QUESTIONNAIRE)
      if (!Array.isArray(migrated.colorSwatches)) migrated.colorSwatches = createProject().colorSwatches
      version = 4
    } else if (version === 4) {
      const documents = Array.isArray(migrated.documents) ? migrated.documents as ProjectDocument[] : []
      migrated.documents = documents.map((document) => ({ ...document, layout: { ...DEFAULT_DOCUMENT_LAYOUT, ...document.layout } }))
      const boards = Array.isArray(migrated.boards) ? migrated.boards as BoardModel[] : []
      migrated.boards = boards.map((board) => ({ ...board, connectors: (board.connectors || []).map(normalizeBoardConnector) }))
      const assets = Array.isArray(migrated.assets) ? migrated.assets as ProjectAsset[] : []
      migrated.assets = assets.map(normalizeProjectAsset)
      version = 5
    } else if (version === 5) {
      if (!migrated.status) migrated.status = 'planning'
      version = 6
    } else if (version === 6) {
      const boards = Array.isArray(migrated.boards) ? migrated.boards as BoardModel[] : []
      migrated.boards = boards.map(normalizeBoardVectorPaths)
      version = 7
    } else if (version === 7) {
      const documents = Array.isArray(migrated.documents) ? migrated.documents as ProjectDocument[] : []
      migrated.documents = documents.map((document) => document.id === QUESTIONNAIRE_DOCUMENT_ID ? { ...document, locked: true, system: true } : document)
      version = 8
    } else if (version === 8) {
      const boards = Array.isArray(migrated.boards) ? migrated.boards as BoardModel[] : []
      migrated.boards = normalizeBoardHierarchy(boards.map((board) => ({ ...board, nodes: (board.nodes || []).map((node) => node.kind === 'board-link' && !node.boardLinkRole ? { ...node, boardLinkRole: 'shortcut' as const } : node) }))).boards
      version = 9
    }
    migrated.schemaVersion = version
  }
  return migrated as unknown as ProjectModel
}

function restoreProject(storedProject: ProjectModel): ProjectModel {
  storedProject = migrateProjectData(storedProject)
  const storedDocuments = storedProject.documents?.length
    ? storedProject.documents.map((document) => ({ ...document, layout: { ...DEFAULT_DOCUMENT_LAYOUT, ...document.layout }, ...(document.id === QUESTIONNAIRE_DOCUMENT_ID ? (document.title === 'Project brief' ? { title: 'Project questionnaire', locked: true, system: true } : { locked: true, system: true }) : {}) }))
    : []
  const requiredDocuments = storedDocuments.some((document) => document.id === QUESTIONNAIRE_DOCUMENT_ID)
    ? storedDocuments
    : [{ id: QUESTIONNAIRE_DOCUMENT_ID, title: 'Project questionnaire', content: storedProject.documentContent || structuredClone(DEFAULT_DOCUMENT_CONTENT), layout: structuredClone(DEFAULT_DOCUMENT_LAYOUT), locked: true, system: true }, ...storedDocuments]
  const restored: ProjectModel = {
    ...storedProject,
    schemaVersion: 9,
    status: storedProject.status || 'planning',
    questionnaire: { ...DEFAULT_QUESTIONNAIRE, ...storedProject.questionnaire },
    documents: requiredDocuments,
    boards: withoutLegacyChildTiles(normalizeBoardPortalBounds(normalizeBoardHierarchy((storedProject.boards?.length ? storedProject.boards : [storedProject.board || structuredClone(DEFAULT_BOARD), { id: 'character-development', title: 'Character development', viewport: { x: 28, y: 28, scale: .82 }, nodes: [], connectors: [] }])
      .map((board) => normalizeBoardVectorPaths(layoutBoardColumns({ ...board, connectors: (board.connectors || []).map(normalizeBoardConnector) })))).boards)),
    assets: (storedProject.assets || []).map(normalizeProjectAsset),
    colorSwatches: storedProject.colorSwatches || createProject().colorSwatches,
  }
  delete restored.documentContent
  delete restored.board
  return withRequiredBoardFolderLinks(restored)
}

function defaultNavigation(project: ProjectModel): ProjectNavigation {
  return {
    activeBoardId: project.boards[0].id,
    activeDocumentId: project.documents[0].id,
    activeNavigatorItem: `document:${project.documents[0].id}`,
    viewMode: 'split',
    splitRatio: 54,
    documentScrollTop: {},
  }
}

function projectCoverAssetId(project: ProjectModel) {
  return project.assets.some(asset => asset.id === project.projectCoverAssetId && asset.kind === 'image' && asset.status !== 'missing') ? project.projectCoverAssetId : undefined
}

function projectCoverRelativePath(project: ProjectModel) {
  const assetId = projectCoverAssetId(project)
  const asset = project.assets.find((entry) => entry.id === assetId)
  return assetCoverPath(asset)
}

function projectCoverFraming(project: ProjectModel): CoverFraming | undefined {
  return project.projectCoverFraming
}

function workspaceAssetUrl(workspaceRoot: string | undefined, relativePath: string | undefined) {
  if (!workspaceRoot || !relativePath) return undefined
  if (/^[a-zA-Z]:[\\/]/.test(relativePath)) return convertFileSrc(relativePath)
  return convertFileSrc(`${workspaceRoot.replace(/[\\/]+$/, '')}\\${relativePath.replaceAll('/', '\\')}`)
}

function assetPreviewPath(asset: ProjectAsset | undefined) {
  if (!asset) return undefined
  const sourcePath = asset.status === 'moved' ? asset.managedRelativePath || asset.relativePath : asset.relativePath
  return asset.thumbnailRelativePath || sourcePath
}

function boardDiskPath(workspaceRoot: string | undefined, link: string | undefined): string | undefined {
  if (!link) return undefined
  return /^[a-zA-Z]:[\\/]/.test(link) || link.startsWith('\\\\') ? link : workspaceRoot ? `${workspaceRoot.replace(/[\\/]+$/, '')}\\${link.replaceAll('/', '\\')}` : link
}

const DEFAULT_COVER_FRAMING: CoverFraming = { x: 50, y: 50, zoom: 1, aspect: 1 }

function coverImageStyle(url: string | undefined, framing?: CoverFraming): React.CSSProperties | undefined {
  if (!url) return undefined
  const { x, y, zoom, aspect } = framing || DEFAULT_COVER_FRAMING
  const scale = Math.max(1, Math.min(3, zoom || 1)) * 100
  return { backgroundImage: `url(${url})`, backgroundPosition: `${x}% ${y}%`, backgroundSize: scale === 100 ? 'cover' : aspect >= 1 ? `auto ${scale}%` : `${scale}% auto` }
}

function CoverArtworkPicker({ title, assets, workspaceRoot, selectedId, framing, onApply, onImport, onReset, onClose }: {
  title: string; assets: ProjectAsset[]; workspaceRoot?: string; selectedId?: string; framing?: CoverFraming
  onApply: (assetId: string, framing: CoverFraming) => void; onImport: () => void; onReset: () => void; onClose: () => void
}) {
  const [draftId, setDraftId] = useState(selectedId || '')
  const [draft, setDraft] = useState<CoverFraming>(framing || DEFAULT_COVER_FRAMING)
  const dialogRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        event.stopPropagation()
        onClose()
      }
    }
    const handlePointerDown = (event: PointerEvent) => {
      const target = event.target as Element | null
      if (dialogRef.current && !dialogRef.current.contains(event.target as Node)) {
        if (!target?.closest?.('.project-cover-actions, .board-actions-trigger, .project-appearance-trigger')) {
          onClose()
        }
      }
    }
    window.addEventListener('keydown', handleKeyDown)
    window.addEventListener('pointerdown', handlePointerDown)
    return () => {
      window.removeEventListener('keydown', handleKeyDown)
      window.removeEventListener('pointerdown', handlePointerDown)
    }
  }, [onClose])

  const selected = assets.find((asset) => asset.id === draftId)
  const source = workspaceAssetUrl(workspaceRoot, assetCoverPath(selected))
  return <div ref={dialogRef} className="cover-artwork-picker" role="dialog" aria-label={title}>
    <header><strong>{title}</strong><button type="button" aria-label="Close image chooser" onClick={onClose}>×</button></header>
    {source && <div className="cover-artwork-preview" style={coverImageStyle(source, draft)} role="img" aria-label={`Square preview of ${selected?.displayName}`}><img src={source} alt="" onLoad={(event) => { const aspect = event.currentTarget.naturalWidth / Math.max(1, event.currentTarget.naturalHeight); if (Math.abs(aspect - draft.aspect) > .01) setDraft((current) => ({ ...current, aspect })) }} /></div>}
    <div className="cover-artwork-choices" aria-label="Project images">{assets.map((asset) => {
      const url = workspaceAssetUrl(workspaceRoot, assetCoverPath(asset))
      return <button type="button" key={asset.id} aria-pressed={draftId === asset.id} title={asset.displayName} onClick={() => { setDraftId(asset.id); setDraft(asset.id === selectedId ? framing || DEFAULT_COVER_FRAMING : DEFAULT_COVER_FRAMING) }}><span style={coverImageStyle(url)} /><small>{asset.displayName}</small></button>
    })}</div>
    {selected && <div className="cover-artwork-controls"><label>Horizontal crop <input type="range" min="0" max="100" value={draft.x} onChange={(event) => setDraft((current) => ({ ...current, x: Number(event.target.value) }))} /></label><label>Vertical crop <input type="range" min="0" max="100" value={draft.y} onChange={(event) => setDraft((current) => ({ ...current, y: Number(event.target.value) }))} /></label><label>Zoom <input type="range" min="100" max="300" value={Math.round(draft.zoom * 100)} onChange={(event) => setDraft((current) => ({ ...current, zoom: Number(event.target.value) / 100 }))} /></label><small>Crop settings affect the displayed cover only; the original image is unchanged.</small></div>}
    <footer><button type="button" onClick={onImport}>{selectedId ? 'Replace / import image…' : 'Import image…'}</button><button type="button" onClick={onReset}>Remove image</button><button type="button" disabled={!draftId} onClick={() => draftId && onApply(draftId, draft)}>Use image</button></footer>
  </div>
}

function assetCoverPath(asset: ProjectAsset | undefined) {
  if (!asset) return undefined
  if(asset.thumbnailRelativePath || asset.imagePyramid?.posterRelativePath)return asset.thumbnailRelativePath || asset.imagePyramid?.posterRelativePath
  const sourcePath = asset.status === 'moved' ? asset.managedRelativePath || asset.relativePath : asset.relativePath
  const extension = String(asset.extension || '').toLowerCase().replace(/^\./, '')
  return !asset.requiresTiledPreview && ['avif', 'gif', 'jpeg', 'jpg', 'png', 'webp'].includes(extension)
    ? sourcePath
    : assetPreviewPath(asset)
}

function boardCoverAssetId(project: ProjectModel, board: BoardModel) {
  return project.assets.some(asset => asset.id === board.coverAssetId && asset.kind === 'image' && asset.status !== 'missing') ? board.coverAssetId : undefined
}

function boardCoverAsset(project: ProjectModel, board: BoardModel) {
  const assetId = boardCoverAssetId(project, board)
  return assetId ? project.assets.find((asset) => asset.id === assetId) : undefined
}

function canRestoreTrashEntry(project: ProjectModel, entry: TrashEntry): boolean {
  if (entry.kind === 'board') return Boolean(entry.board
    && !(entry.boards?.length ? entry.boards : [entry.board]).some((board) => project.boards.some((current) => current.id === board.id))
    && !(entry.boardLinks || []).some((link) => {
      const target = project.boards.find((board) => board.id === link.boardId)
      return !target || link.nodes.some((node) => target.nodes.some((current) => current.id === node.id)) || link.connectors.some((connector) => target.connectors.some((current) => current.id === connector.id))
    }))
  if (entry.kind === 'document') return Boolean(entry.document && !project.documents.some((document) => document.id === entry.document?.id))
  if (entry.kind === 'canvas-node') return Boolean(entry.node && project.boards.some((board) => board.id === entry.boardId && !board.nodes.some((node) => node.id === entry.node?.id)))
  if (!entry.asset || project.assets.some((asset) => asset.id === entry.asset?.id)) return false
  if ((entry.placements || []).some((placement) => !project.boards.some((board) => board.id === placement.boardId) || project.boards.some((board) => board.nodes.some((node) => node.id === placement.node.id)))) return false
  if ((entry.coverReferences?.boardIds || []).some((id) => !project.boards.some((board) => board.id === id))) return false
  return !(entry.coverReferences?.nodeIds || []).some((item) => !project.boards.some((board) => board.id === item.boardId && board.nodes.some((node) => node.id === item.nodeId)))
}

/** Keep every visual cover relationship intact when an imported asset is relinked. */
function remapProjectAssetReferences(project: ProjectModel, replacements: Map<string, string>): ProjectModel {
  const remap = (assetId: string | undefined) => assetId ? replacements.get(assetId) || assetId : undefined
  return {
    ...project,
    projectCoverAssetId: remap(project.projectCoverAssetId),
    inspectorImageAssetId: remap(project.inspectorImageAssetId),
    boards: project.boards.map((board) => ({
      ...board,
      coverAssetId: remap(board.coverAssetId),
      nodes: board.nodes.map((node) => ({ ...node, assetId: remap(node.assetId), coverAssetId: remap(node.coverAssetId) })),
    })),
  }
}

function App() {
  const [, setAppDialogOpen] = useState(false)
  const [textPrompt, setTextPrompt] = useState<PendingTextPrompt | null>(null)
  function requestText(options: TextPromptOptions): Promise<string | null> {
    return new Promise((resolve) => setTextPrompt({ ...options, resolve }))
  }
  function resolveTextPrompt(value: string | null) {
    const pending = textPrompt
    setTextPrompt(null)
    pending?.resolve(value)
  }
  const route = new URLSearchParams(window.location.search)
  const viewBoardId = route.get('view-board')
  // A Mini Bridge runs as its own OS process and reuses the same disk-backed
  // project file. Its launch context (project/board ids) is handed over by the
  // Rust layer from this process's environment, not by window labels.
  const [miniBridgeLaunch, setMiniBridgeLaunch] = useState<AssetManagerLaunch | null>(null)
  const assetManagerProjectId = miniBridgeLaunch?.projectId || null
  const assetManagerBoardId = miniBridgeLaunch?.boardId || null
  const isMiniBridgeWindow = Boolean(assetManagerProjectId)
  const [mode, setMode] = useState<ViewMode>(() => {
    if (new URLSearchParams(window.location.search).has('view-board')) return 'canvas'
    const saved = localStorage.getItem('art-equation.view-mode')
    return saved === 'document' || saved === 'canvas' || saved === 'split' ? saved : 'split'
  })
  const [activeEditor, setActiveEditor] = useState<'document' | 'canvas'>(() => mode === 'canvas' ? 'canvas' : 'document')
  const [historyOwner, setHistoryOwner] = useState<DocumentHistoryOwner>(() => mode === 'canvas' ? 'canvas' : 'document')
  const [historyCapability, setHistoryCapability] = useState({ undo: false, redo: false })
  const [split, setSplit] = useState(() => Number(localStorage.getItem('art-equation.split')) || 54)
  const [showNavigatorPanel, setShowNavigatorPanel] = useState(() => localStorage.getItem('art-equation.navigator') !== '0')
  const [showInspectorPanel, setShowInspectorPanel] = useState(() => localStorage.getItem('art-equation.inspector') !== '0')
  const [navigatorWidth, setNavigatorWidth] = useState(() => Math.min(360, Math.max(176, Number(localStorage.getItem('art-equation.navigator-width')) || 228)))
  const [inspectorWidth, setInspectorWidth] = useState(() => Math.min(420, Math.max(240, Number(localStorage.getItem('art-equation.inspector-width')) || 246)))
  const [showProjectBoardStrip, setShowProjectBoardStrip] = useState(() => localStorage.getItem('art-equation.project-board-strip') !== '0')
  const [showCanvasFilmstrip, setShowCanvasFilmstrip] = useState(() => localStorage.getItem('art-equation.canvas-filmstrip') === '1')
  const [showBoardCoverPicker, setShowBoardCoverPicker] = useState(false)
  const [showProjectCoverPicker, setShowProjectCoverPicker] = useState(false)
  const [projectThumbMenu, setProjectThumbMenu] = useState<{ id: string; x: number; y: number } | null>(null)
  const [showBoardActions, setShowBoardActions] = useState(false)
  const boardActionsTriggerRef = useRef<HTMLButtonElement>(null)
  const navigatorTabRef = useRef<HTMLButtonElement>(null)
  const inspectorTabRef = useRef<HTMLButtonElement>(null)
  const navigatorEdgeRef = useRef<HTMLButtonElement>(null)
  const inspectorEdgeRef = useRef<HTMLButtonElement>(null)
  const [canvasSelection, setCanvasSelection] = useState<{ boardId: string; ids: string[] } | null>(null)
  const receiveCanvasSelection = useCallback((boardId: string, ids: string[]) => {
    setCanvasSelection((current) => current?.boardId === boardId && current.ids.length === ids.length && current.ids.every((id, index) => id === ids[index]) ? current : { boardId, ids })
  }, [])
  const [minimalNavigation, setMinimalNavigation] = useState(() => localStorage.getItem('art-equation.minimal-navigation') === '1')
  const [navigatorMenu, setNavigatorMenu] = useState<{ kind: 'document' | 'board'; id: string; x: number; y: number } | null>(null)
  const navigatorMenuRef = useRef<HTMLDivElement>(null)
  const navigatorMenuOriginRef = useRef<HTMLElement | null>(null)
  const openNavigatorItemMenu = (kind: 'document' | 'board', id: string, x: number, y: number) => {
    navigatorMenuOriginRef.current = document.activeElement instanceof HTMLElement ? document.activeElement : null
    setNavigatorMenu({ kind, id, x: Math.max(8, Math.min(x, window.innerWidth - 218)), y: Math.max(8, Math.min(y, window.innerHeight - (kind === 'board' ? 340 : 205))) })
  }
  useEffect(() => {
    if (!navigatorMenu) return
    requestAppFrame(() => {
      const menu = navigatorMenuRef.current
      if (!menu) return
      const rect = menu.getBoundingClientRect()
      menu.style.left = `${Math.max(8, Math.min(navigatorMenu.x, window.innerWidth - rect.width - 8))}px`
      menu.style.top = `${Math.max(8, Math.min(navigatorMenu.y, window.innerHeight - rect.height - 8))}px`
      menu.querySelector<HTMLButtonElement>('button:not(:disabled)')?.focus()
    })
    const dismiss = (event: PointerEvent) => { if (!(event.target as Element).closest('.navigator-item-menu')) setNavigatorMenu(null) }
    const escape = (event: KeyboardEvent) => { if (event.key === 'Escape') { setNavigatorMenu(null); navigatorMenuOriginRef.current?.focus() } }
    window.addEventListener('pointerdown', dismiss)
    window.addEventListener('keydown', escape)
    return () => { window.removeEventListener('pointerdown', dismiss); window.removeEventListener('keydown', escape) }
  }, [navigatorMenu])
  
  
  
  
  
  
  const [bootComplete, setBootComplete] = useState(false)
  const completeBoot = useCallback(() => setBootComplete(true), [])
  const [showSettings, setShowSettings] = useState(false)
  const settingsToggleRef = useRef<HTMLButtonElement>(null)
  useEffect(() => {
    if (!showSettings) return
    const escape = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        setShowSettings(false)
        settingsToggleRef.current?.focus()
      }
    }
    const dismiss = (event: PointerEvent) => {
      if (event.target instanceof Element && !event.target.closest('.settings-panel, .settings-toggle')) {
        setShowSettings(false)
      }
    }
    window.addEventListener('keydown', escape)
    window.addEventListener('pointerdown', dismiss)
    return () => {
      window.removeEventListener('keydown', escape)
      window.removeEventListener('pointerdown', dismiss)
    }
  }, [showSettings])
  const [previewAssetId, setPreviewAssetId] = useState<string | null>(null)
  const [previewZoomed, setPreviewZoomed] = useState(false)
  const [previewZoom, setPreviewZoom] = useState(1)
  const [previewPan, setPreviewPan] = useState({ x: 0, y: 0 })
  const previewDragRef = useRef(false)
  const [showTrashViewer, setShowTrashViewer] = useState(false)
  const trashButtonRef = useRef<HTMLButtonElement>(null)
  const trashCloseRef = useRef<HTMLButtonElement>(null)
  const [trashPlacement, setTrashPlacement] = useState({ left: 12, bottom: 36, width: 500, maxHeight: 480 })
  const positionTrashViewer = useCallback(() => {
    const rect = trashButtonRef.current?.getBoundingClientRect()
    if (!rect) return
    const sideRoom = window.innerWidth - rect.right - 24
    const beside = sideRoom >= 320
    const width = beside ? Math.min(560, sideRoom) : Math.min(560, window.innerWidth - 24)
    const bottom = beside ? Math.max(12, window.innerHeight - rect.bottom) : Math.max(12, window.innerHeight - rect.top + 8)
    setTrashPlacement({
      left: beside ? rect.right + 12 : 12,
      bottom,
      width,
      maxHeight: Math.max(100, Math.min(620, window.innerHeight - bottom - 12)),
    })
  }, [])
  useLayoutEffect(() => {
    if (!showTrashViewer) return
    positionTrashViewer()
    const focusFrame = requestAppFrame(() => trashCloseRef.current?.focus())
    const escape = (event: KeyboardEvent) => {
      if (event.key === 'Escape') { setShowTrashViewer(false); trashButtonRef.current?.focus() }
    }
    const dismiss = (event: PointerEvent) => {
      if (event.target instanceof Element && !event.target.closest('.trash-viewer,.trash-summary-button')) setShowTrashViewer(false)
    }
    const sizeObserver = new ResizeObserver(positionTrashViewer)
    if (trashButtonRef.current) sizeObserver.observe(trashButtonRef.current)
    if (trashButtonRef.current?.parentElement) sizeObserver.observe(trashButtonRef.current.parentElement)
    window.addEventListener('resize', positionTrashViewer)
    window.addEventListener('scroll', positionTrashViewer, true)
    window.addEventListener('keydown', escape)
    window.addEventListener('pointerdown', dismiss)
    return () => {
      cancelAppFrame(focusFrame)
      sizeObserver.disconnect()
      window.removeEventListener('resize', positionTrashViewer)
      window.removeEventListener('scroll', positionTrashViewer, true)
      window.removeEventListener('keydown', escape)
      window.removeEventListener('pointerdown', dismiss)
    }
  }, [showTrashViewer, positionTrashViewer])
  const [workspace, setWorkspace] = useState<WorkspaceInfo | null>(null)
  const inspectorPermissionRef = useRef({ readOnly: Boolean(workspace?.readOnly || viewBoardId), workspaceRoot: workspace?.root, revision: 0 })
  const previousInspectorPermission = inspectorPermissionRef.current
  const inspectorPermission = {
    readOnly: Boolean(workspace?.readOnly || viewBoardId),
    workspaceRoot: workspace?.root,
    revision: previousInspectorPermission.revision + (previousInspectorPermission.readOnly !== Boolean(workspace?.readOnly || viewBoardId) || previousInspectorPermission.workspaceRoot !== workspace?.root ? 1 : 0),
  }
  // Update before project state queues run so a queued edit sees the new permission.
  inspectorPermissionRef.current = inspectorPermission
  const [projectSummaries, setProjectSummaries] = useState<ProjectSummary[]>([])
  const [projectQuery, setProjectQuery] = useState('')
  const [projectSort, setProjectSort] = useState<'updated' | 'name' | 'date'>('updated')
  const [archivedProjectIds, setArchivedProjectIds] = useState<string[]>([])
  const [showArchivedProjects, setShowArchivedProjects] = useState(false)
  const [trashedProjects, setTrashedProjects] = useState<ProjectSummary[]>([])
  const [projectTrash, setProjectTrash] = useState<TrashEntry[]>([])
  const [theme, setThemeState] = useState<'navy' | 'dark' | 'light'>(()=>readLaunchTheme()||'navy')
  const setTheme=useCallback((value:'navy'|'dark'|'light')=>{saveLaunchTheme(value);setThemeState(value)},[])
  const [canvasUiPersonality, setCanvasUiPersonalityState] = useState<CanvasUiPersonality>(() => readCanvasUiPersonality())
  const setCanvasUiPersonality = useCallback((value: CanvasUiPersonality) => {
    saveCanvasUiPersonality(value)
    setCanvasUiPersonalityState(value)
  }, [])
  useNativeWindowChrome(theme)
  const [glassStrength, setGlassStrength] = useState(0)
  const [savePolicy,setSavePolicy]=useState<SavePolicy>(defaultSavePolicy)
  const [savePending,setSavePending]=useState(false)
  const nextIntervalSave=useRef(new Map<string,number>())
  const [projectReady, setProjectReady] = useState(false)
  const [switchingProject, setSwitchingProject] = useState(false)
  const [closingProject, setClosingProject] = useState(false)
  const documentStore = useDocumentController(() => {
    const initial = createProject()
    const preview = new URLSearchParams(window.location.search)
    const localBenchmark = import.meta.env.DEV || window.location.hostname === '127.0.0.1'
    if (localBenchmark && preview.get('catalog') === 'demo') {
      initial.assets = [
        { id: 'catalog-image-1', relativePath: 'projects/demo/assets/originals/a.png', originalName: 'IMG_4471-final_FINAL.png', byteLength: 48_200_000, extension: 'png', deduplicated: false, kind: 'image', importedAt: new Date().toISOString(), displayName: 'Rainee silhouette reference', virtualFolder: 'Characters / Rainee', aliases: ['turn sheet'], status: 'available' },
        { id: 'catalog-image-2', relativePath: 'projects/demo/assets/originals/b.tif', originalName: 'scan_00042.tif', byteLength: 830_000_000, extension: 'tif', deduplicated: false, kind: 'image', importedAt: new Date().toISOString(), displayName: 'Club material scan', virtualFolder: 'Environment / Materials', aliases: [], status: 'preview-pending' },
        { id: 'catalog-video-1', relativePath: 'projects/demo/assets/originals/c.mp4', originalName: 'C0032_proxy_edit.mp4', byteLength: 2_480_000_000, extension: 'mp4', deduplicated: false, kind: 'video', importedAt: new Date().toISOString(), displayName: 'Camera walkthrough', virtualFolder: 'Environment / Motion', aliases: [], status: 'available' },
        { id: 'catalog-pdf-1', relativePath: 'projects/demo/assets/originals/d.pdf', originalName: 'production-notes-v7.pdf', byteLength: 12_400_000, extension: 'pdf', deduplicated: false, kind: 'document', importedAt: new Date().toISOString(), displayName: 'Production design notes', virtualFolder: 'Documents', aliases: [], status: 'missing' },
        { id: 'catalog-model-1', relativePath: 'projects/demo/assets/originals/e.glb', originalName: 'club-blockout.glb', byteLength: 24_800_000, extension: 'glb', deduplicated: false, kind: 'model', importedAt: new Date().toISOString(), displayName: 'Club blockout', virtualFolder: 'Environment / 3D', aliases: [], status: 'available' },
      ]
      initial.boards[0].nodes = [...initial.boards[0].nodes,
        { id: 'demo-node-image', kind: 'image', x: 80, y: 760, width: 260, height: 190, title: 'Rainee silhouette reference', assetId: 'catalog-image-1' },
        { id: 'demo-node-video', kind: 'video', x: 380, y: 760, width: 320, height: 200, title: 'Camera walkthrough', assetId: 'catalog-video-1' },
        { id: 'demo-node-model', kind: 'model', x: 740, y: 760, width: 260, height: 210, title: 'Club blockout', assetId: 'catalog-model-1' },
      ]
    }
    const requestedStressSize = Number(preview.get('stress'))
    const requestedStressProfile = preview.get('stress-profile')
    if (localBenchmark && preview.get('benchmark') === 'generation-0' && STRESS_BOARD_SIZES.has(requestedStressSize)) {
      const profile: StressProfile = requestedStressProfile === 'raster' || requestedStressProfile === 'vector' ? requestedStressProfile : 'mixed'
      initial.boards[0].nodes = createStressBoardNodes(requestedStressSize, profile)
      initial.boards[0].connectors = []
    }
    return initial
  })
  const [project, setProject] = useStoreField(documentStore, 'project')
  const [settingsHydrated, setSettingsHydrated] = useState(false)
  const [bootStorageFailed, setBootStorageFailed] = useState(false)
  const [openWith, setOpenWith] = useState<Record<string, string>>({})
  const [projectSearch, setProjectSearch] = useState('')
  const [searchOrigin, setSearchOrigin] = useState<SearchOriginSnapshot | null>(null)
  const searchOriginProjectRef = useRef(project.id)
  if (searchOriginProjectRef.current !== project.id) {
    searchOriginProjectRef.current = project.id
    if (searchOrigin) setSearchOrigin(null)
  }
  const [revealRequest, setRevealRequest] = useState<{ boardId: string; nodeId: string; token: string } | null>(null)
  const projectRef = useRef(project)
  projectRef.current = project
  const inspectorProjectScopeRef = useRef({ projectId: project.id, revision: 0 })
  if (inspectorProjectScopeRef.current.projectId !== project.id) {
    inspectorProjectScopeRef.current = { projectId: project.id, revision: inspectorProjectScopeRef.current.revision + 1 }
  }
  const inspectorMutationContext = {
    projectId: project.id,
    projectRevision: inspectorProjectScopeRef.current.revision,
    workspaceRoot: inspectorPermission.workspaceRoot,
    permissionRevision: inspectorPermission.revision,
  }
  function canMutateInspectorProject(context = inspectorMutationContext) {
    const permission = inspectorPermissionRef.current
    return !permission.readOnly
      && permission.workspaceRoot === context.workspaceRoot
      && permission.revision === context.permissionRevision
      && projectRef.current.id === context.projectId
      && inspectorProjectScopeRef.current.revision === context.projectRevision
  }
  useEffect(() => {
    if (!workspace?.readOnly && !viewBoardId) return
    setShowProjectCoverPicker(false)
    setProjectThumbMenu(null)
  }, [workspace?.readOnly, viewBoardId])
  const [showRecovery, setShowRecovery] = useState(false)
  const [recoveryEntries, setRecoveryEntries] = useState<Awaited<ReturnType<typeof listRecoveryEntries>>>([])
  const [showAssetManager, setShowAssetManager] = useState(Boolean(assetManagerProjectId))
  const [activeDocumentId, setActiveDocumentId] = useStoreField(documentStore, 'activeDocumentId')
  const [openDocumentTabIds, setOpenDocumentTabIds] = useState<string[]>(['project-brief'])
  const [documentTabsVisible, setDocumentTabsVisible] = useState(true)
  const documentTabsScopeRef = useRef('')
  const [documentSessionRevision, setDocumentSessionRevision] = useState(0)
  const documentSessionRevisionRef = useRef(0)
  const documentReplacementRequestRef = useRef(0)
  const projectCreationRequest = documentReplacementRequestRef.current
  const documentControlsRef = useRef(new Map<string, React.RefObject<DocumentWorkspaceControls | null>>())
  const [documentFocusWriting, setDocumentFocusWriting] = useState<DocumentFocusWritingOrigin | null>(null)
  const documentFocusWritingRef = useRef<DocumentFocusWritingOrigin | null>(null)
  const documentFocusFrameRef = useRef(0)
  const documentFocusGenerationRef = useRef(0)
  const documentRevisionsRef = useRef(new Map<string, number>())
  const visitedDocumentsRef = useRef({ scope: '', ids: new Set<string>() })
  const [activeBoardId, setActiveBoardId] = useStoreField(documentStore, 'activeBoardId')
  const activeBoardIdRef = useRef(activeBoardId)
  activeBoardIdRef.current = activeBoardId
  const [activeNavigatorItem, setActiveNavigatorItem] = useState('document:project-brief')
  const [showNewItemMenu, setShowNewItemMenu] = useState(false)
  const [status, setStatus] = useState('Foundation workspace')
  const imagePreparation = useImagePreparation(project.id, setProject)
  const [managedRollback, setManagedRollback] = useState<Array<{ id: string; currentRelativePath: string; previousRelativePath?: string }> | null>(null)
  const [showWorksheets, setShowWorksheets] = useState(false)
  const [showRecipes, setShowRecipes] = useState(false)
  const [recipes, setRecipes] = useState<VisualRecipe[]>([])
  const [showPromptGenerator, setShowPromptGenerator] = useState(false)
  const [showReferenceLibrary, setShowReferenceLibrary] = useState(false)
  const [showMediaHealth, setShowMediaHealth] = useState(false)
  const [showFramingReview, setShowFramingReview] = useState(false)
  const [showProjectTools, setShowProjectTools] = useState(false)
  const projectToolsToggleRef = useRef<HTMLButtonElement>(null)
  useEffect(() => {
    if (!showProjectTools) return
    const dismiss = (event: PointerEvent) => {
      if (event.target instanceof Element && !event.target.closest('.project-tools-menu, .project-tools-toggle')) {
        setShowProjectTools(false)
      }
    }
    const escape = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        setShowProjectTools(false)
        projectToolsToggleRef.current?.focus()
      }
    }
    window.addEventListener('pointerdown', dismiss)
    window.addEventListener('keydown', escape)
    return () => {
      window.removeEventListener('pointerdown', dismiss)
      window.removeEventListener('keydown', escape)
    }
  }, [showProjectTools])
  const [showInspectorDrawer, setShowInspectorDrawer] = useState(false)
  const appHeaderRef = useRef<HTMLElement>(null)

  const inspectorToggleRef = useRef<HTMLButtonElement>(null)
  useEffect(() => {
    if (!showInspectorDrawer) return
    const focusFrame = requestAppFrame(() => { if (!documentFocusWritingRef.current) document.querySelector<HTMLButtonElement>('.project-inspector.drawer-open .inspector-drawer-close')?.focus() })
    const close = (event: KeyboardEvent) => {
      if (documentFocusWritingRef.current || event.key !== 'Escape') return
      event.stopPropagation()
      setShowInspectorDrawer(false)
      inspectorToggleRef.current?.focus()
    }
    window.addEventListener('keydown', close)
    return () => { cancelAppFrame(focusFrame); window.removeEventListener('keydown', close) }
  }, [showInspectorDrawer])
  const [navigationRevision, setNavigationRevision] = useState(0)
  const workbenchRef = useRef<HTMLDivElement>(null)
  const [workbenchWidth, setWorkbenchWidth] = useState(0)
  const navigationRef = useRef<Record<string, ProjectNavigation>>({})
  const scrollSaveTimerRef = useRef<number | null>(null)
  const boardUndoRef = useRef<NativeBoardCommand[]>([])
  const graphHistoryRef = useRef(new WeakMap<NativeBoardCommand, { before: BoardModel[]; after: BoardModel[]; templates?: { before: DiagramTemplate[] | undefined; after: DiagramTemplate[] | undefined } }>())
  const canvasTrashBusyRef = useRef(false)
  const boardRedoRef = useRef<NativeBoardCommand[]>([])
  const boardBackRef = useRef<string[]>([])
  const boardForwardRef = useRef<string[]>([])
  const activeDocument = project.documents.find((document) => document.id === activeDocumentId) || project.documents[0]
  const activeBoard = project.boards.find((board) => board.id === activeBoardId) || project.boards[0]
  const openProjectRef = useRef<((id: string) => Promise<void>) | null>(null)
  const inspectionContext = useRef<AppInspectionContext>({ project, ui: {} })
  const inspectionRevision = useRef({ project, revision: 0 })
  if (inspectionRevision.current.project !== project) inspectionRevision.current = { project, revision: inspectionRevision.current.revision + 1 }
  inspectionContext.current = {
    project,
    diagnostics: () => readRuntimeDiagnostics(inspectionContext.current.project),
    onMutateProject: (updater) => setProject(updater),
    onDispatchAction: (action, payload) => {
      if (action === 'setActiveBoard' && payload && typeof (payload as { boardId?: string }).boardId === 'string') {
        setActiveBoardId((payload as { boardId: string }).boardId)
      } else if (action === 'openProject' && payload && typeof (payload as { projectId?: string }).projectId === 'string') {
        void openProjectRef.current?.((payload as { projectId: string }).projectId)
      } else if (action === 'setTheme' && payload && ['navy', 'dark', 'light'].includes((payload as { theme?: string }).theme || '')) {
        setTheme((payload as { theme: 'navy' | 'dark' | 'light' }).theme)
      } else if (action === 'setStatus' && payload && typeof (payload as { status?: string }).status === 'string') {
        setStatus((payload as { status: string }).status)
      }
      return { handled: true, action }
    },
    ui: {
      modelRevision: inspectionRevision.current.revision,
      theme,
      mode,
      splitRatio: split,
      activeEditor,
      activeBoardId: activeBoard.id,
      activeDocumentId: activeDocument.id,
      activeNavigatorItem,
      navigation: navigationRef.current[project.id],
      selection: canvasSelection,
      status,
      readOnly: Boolean(workspace?.readOnly || viewBoardId),
      workspace,
      minimalNavigation,
      glassStrength,
      savePolicy,
      savePending
    }
  }
  const readInspectionContext = useCallback(() => inspectionContext.current, [])
  const codexBridge = useCodexBridge(readInspectionContext)
  const compactSplit = mode === 'split' && workbenchWidth > 0 && workbenchWidth < 940
  const documentSessionKey = JSON.stringify([workspace?.root || '', project.id, documentSessionRevision])
  const currentDocumentTabIds = documentTabsScopeRef.current === documentSessionKey
    ? openDocumentTabIds.filter(id => project.documents.some(document => document.id === id))
    : [activeDocument.id]
  const activeDocumentTabOpen = documentTabsScopeRef.current !== documentSessionKey
    || documentTabsVisible && currentDocumentTabIds.includes(activeDocument.id)
  useEffect(() => {
    if (documentTabsScopeRef.current !== documentSessionKey) {
      documentTabsScopeRef.current = documentSessionKey
      setOpenDocumentTabIds([activeDocument.id])
      setDocumentTabsVisible(true)
    } else {
      setOpenDocumentTabIds(previous => {
        const remaining = previous.filter(id => project.documents.some(document => document.id === id))
        return remaining.length === previous.length ? previous : remaining
      })
    }
  }, [documentSessionKey, project.documents])
  useEffect(() => {
    // Navigation may come from creation, search or a process document as well as the sidebar.
    setOpenDocumentTabIds(previous => previous.includes(activeDocument.id) ? previous : [...previous, activeDocument.id])
    setDocumentTabsVisible(true)
  }, [documentSessionKey, activeDocument.id])
  const shellFocusWriting = Boolean(documentFocusWriting && documentFocusWriting.sessionKey === documentSessionKey
    && documentFocusWriting.controlKey === documentControlKey(activeDocument.id) && documentFocusWriting.documentId === activeDocument.id
    && documentFocusWriting.mode === mode)
  useEffect(() => {
    const header = appHeaderRef.current
    if (!header || shellFocusWriting) return
    const shell = header.closest<HTMLElement>('.studio-shell')
    const measure = () => { const height = header.getBoundingClientRect().height; if (height > 0) shell?.style.setProperty('--shell-header-h', height + 'px') }
    measure()
    const observer = new ResizeObserver(measure)
    observer.observe(header)
    return () => observer.disconnect()
  }, [projectReady, workspace?.root, shellFocusWriting])
  const documentRegionVisible = shellFocusWriting || (mode !== 'canvas' && !(compactSplit && activeEditor === 'canvas'))
  const documentVisible = documentRegionVisible && activeDocumentTabOpen
  const canvasVisible = !shellFocusWriting && mode !== 'document' && !(compactSplit && activeEditor === 'document')
  const documentFocusViewRef = useRef({ sessionKey: documentSessionKey, sessionRevision: documentSessionRevision,
    projectId: project.id, documentId: activeDocument.id, controlKey: documentControlKey(activeDocument.id), mode,
    compactSplit, activeEditor, historyOwner, showNavigatorPanel, showInspectorPanel, showInspectorDrawer, navigatorWidth, inspectorWidth, split })

  const documentViewOwnerRef = useRef({ sessionKey: documentSessionKey, documentId: activeDocument.id, visible: documentVisible })
  documentViewOwnerRef.current = { sessionKey: documentSessionKey, documentId: activeDocument.id, visible: documentVisible }
  if (visitedDocumentsRef.current.scope !== documentSessionKey) {
    visitedDocumentsRef.current = { scope: documentSessionKey, ids: new Set() }
    documentControlsRef.current.clear()
    documentRevisionsRef.current.clear()
  }
  if ((shellFocusWriting || mode !== 'canvas') && activeDocument?.id !== QUESTIONNAIRE_DOCUMENT_ID) visitedDocumentsRef.current.ids.add(activeDocument.id)
  for (const id of visitedDocumentsRef.current.ids) {
    if (!project.documents.some((document) => document.id === id)) forgetDocumentSession(id)
  }
  documentFocusViewRef.current = { sessionKey: documentSessionKey, sessionRevision: documentSessionRevision,
    projectId: project.id, documentId: activeDocument.id, controlKey: documentControlKey(activeDocument.id), mode,
    compactSplit, activeEditor, historyOwner, showNavigatorPanel, showInspectorPanel, showInspectorDrawer, navigatorWidth, inspectorWidth, split }
  const visitedDocuments = project.documents.filter((document) => document.id !== QUESTIONNAIRE_DOCUMENT_ID && visitedDocumentsRef.current.ids.has(document.id))
  const effectiveHistoryOwner: DocumentHistoryOwner = shellFocusWriting ? 'document' : historyOwner === 'document' && documentVisible && activeDocument?.id !== QUESTIONNAIRE_DOCUMENT_ID
    ? 'document' : historyOwner === 'canvas' && canvasVisible ? 'canvas' : 'none'
  function documentControlKey(id: string) { return JSON.stringify([documentSessionKey, id, documentRevisionsRef.current.get(id) || 0]) }
  function controlsForDocument(id: string) {
    const key = documentControlKey(id)
    let ref = documentControlsRef.current.get(key)
    if (!ref) { ref = { current: null }; documentControlsRef.current.set(key, ref) }
    return ref
  }
  function isDocumentFocusOwnerCurrent(origin: DocumentFocusWritingOrigin) {
    const view = documentFocusViewRef.current
    return documentSessionRevisionRef.current === origin.sessionRevision && projectRef.current.id === origin.projectId
      && view.sessionKey === origin.sessionKey && view.documentId === origin.documentId
      && view.controlKey === origin.controlKey && view.mode === origin.mode
  }
  function cancelPendingDocumentFocus() {
    if (!documentFocusFrameRef.current) return
    cancelAppFrame(documentFocusFrameRef.current)
    documentFocusFrameRef.current = 0
    documentFocusGenerationRef.current += 1
  }
  function clearDocumentFocusWriting(restoreFocus: boolean) {
    cancelPendingDocumentFocus()
    const origin = documentFocusWritingRef.current
    if (!origin) return
    documentFocusWritingRef.current = null
    setDocumentFocusWriting(null)
    const generation = ++documentFocusGenerationRef.current
    // Clear the shell owner before the component emits its synchronous exit callback.
    if (origin.controls.current?.captureView().focusMode) origin.controls.current.toggleFocusWriting()
    if (!restoreFocus || !isDocumentFocusOwnerCurrent(origin)) return
    documentFocusFrameRef.current = requestAppFrame(() => {
      if (documentFocusGenerationRef.current !== generation) return
      documentFocusFrameRef.current = 0
      if (documentFocusWritingRef.current || !isDocumentFocusOwnerCurrent(origin)) return
      const opener = origin.opener
      if (opener?.isConnected && !opener.closest('[hidden],[inert]') && opener.getClientRects().length > 0 && getComputedStyle(opener).visibility !== 'hidden') {
        opener.focus({ preventScroll: true })
      } else origin.controls.current?.focusEditor()
    })
  }
  function receiveDocumentFocusWriting(sessionKey: string, documentId: string, controlKey: string,
    controls: React.RefObject<DocumentWorkspaceControls | null>, focused: boolean) {
    const origin = documentFocusWritingRef.current
    if (!focused) {
      if (origin?.sessionKey === sessionKey && origin.controlKey === controlKey && origin.documentId === documentId) clearDocumentFocusWriting(true)
      return
    }
    const view = documentFocusViewRef.current
    if (documentId === QUESTIONNAIRE_DOCUMENT_ID || view.sessionKey !== sessionKey || view.documentId !== documentId
      || view.controlKey !== controlKey || documentSessionRevisionRef.current !== view.sessionRevision || projectRef.current.id !== view.projectId) {
      // A retained inactive or replaced editor must not leave an orphaned internal focus mode.
      if (controls.current?.captureView().focusMode) controls.current.toggleFocusWriting()
      return
    }
    if (origin?.controlKey === controlKey && origin.sessionKey === sessionKey) return
    clearDocumentFocusWriting(false)
    const next: DocumentFocusWritingOrigin = { ...view, controls,
      opener: document.activeElement instanceof HTMLElement ? document.activeElement : null }
    documentFocusWritingRef.current = next
    setDocumentFocusWriting(next)
    cancelPendingDocumentFocus()
    const generation = ++documentFocusGenerationRef.current
    documentFocusFrameRef.current = requestAppFrame(() => {
      if (documentFocusGenerationRef.current !== generation) return
      documentFocusFrameRef.current = 0
      if (documentFocusWritingRef.current === next && isDocumentFocusOwnerCurrent(next)) controls.current?.focusEditor()
    })
  }
  useEffect(() => {
    const origin = documentFocusWritingRef.current
    if (origin && !isDocumentFocusOwnerCurrent(origin)) clearDocumentFocusWriting(false)
  }, [documentSessionKey, activeDocument.id, mode, shellFocusWriting])
  useEffect(() => {
    // New user intent wins over a delayed enter/exit focus request. Capture runs before the click helper schedules its own frame.
    window.addEventListener('pointerdown', cancelPendingDocumentFocus, true)
    window.addEventListener('keydown', cancelPendingDocumentFocus, true)
    return () => {
      window.removeEventListener('pointerdown', cancelPendingDocumentFocus, true)
      window.removeEventListener('keydown', cancelPendingDocumentFocus, true)
      cancelPendingDocumentFocus()
    }
  }, [])
  function forgetDocumentSession(id: string) {
    documentControlsRef.current.delete(documentControlKey(id))
    visitedDocumentsRef.current.ids.delete(id)
    documentRevisionsRef.current.set(id, (documentRevisionsRef.current.get(id) || 0) + 1)
  }
  function replaceDocumentProject(next: ProjectModel) {
    clearDocumentFocusWriting(false)
    documentSessionRevisionRef.current += 1
    setDocumentSessionRevision(documentSessionRevisionRef.current)
    setHistoryCapability({ undo: false, redo: false })
    setProject(next)
  }
  function documentContext(id: string): DocumentPublicationContext {
    return { projectId: project.id, workspaceRoot: inspectorPermission.workspaceRoot, permissionRevision: inspectorPermission.revision,
      sessionRevision: documentSessionRevision, documentRevision: documentRevisionsRef.current.get(id) || 0 }
  }
  function canPublishDocument(context: DocumentPublicationContext, id: string) {
    const permission = inspectorPermissionRef.current
    return !permission.readOnly && permission.workspaceRoot === context.workspaceRoot && permission.revision === context.permissionRevision
      && projectRef.current.id === context.projectId && documentSessionRevisionRef.current === context.sessionRevision
      && (documentRevisionsRef.current.get(id) || 0) === context.documentRevision
  }
  function publishDocumentPatch(context: DocumentPublicationContext, id: string, patch: Partial<Pick<ProjectDocument, 'content' | 'layout'>>) {
    if (!canPublishDocument(context, id)) return
    setProject((current) => {
      if (!canPublishDocument(context, id) || current.id !== context.projectId) return current
      const document = current.documents.find((entry) => entry.id === id)
      if (!document || id === QUESTIONNAIRE_DOCUMENT_ID) return current
      return { ...current, documents: current.documents.map((entry) => entry.id === id ? { ...entry, ...patch } : entry) }
    })
  }
  function rememberEditorOwner(target: HTMLElement) {
    if (shellFocusWriting) return
    if (target.closest('.questionnaire-pane')) { setActiveEditor('document'); setHistoryOwner('none') }
    else if (target.closest('.document-pane')) { setActiveEditor('document'); setHistoryOwner('document') }
    else if (target.closest('.prototype-document-workspace')) { setActiveEditor('document'); setHistoryOwner(documentVisible && activeDocument.id !== QUESTIONNAIRE_DOCUMENT_ID ? 'document' : 'none') }
    else if (target.closest('.canvas-pane,.inspector-selection')) { setActiveEditor('canvas'); setHistoryOwner('canvas') }
    else if (target.closest('.project-inspector') || target.matches('input,textarea,select,[contenteditable="true"]')) setHistoryOwner('none')
  }
  useEffect(() => {
    const frame = requestAppFrame(() => {
      const view = effectiveHistoryOwner === 'document' ? controlsForDocument(activeDocument.id).current?.captureView() : undefined
      const next = { undo: !inspectorPermissionRef.current.readOnly && (effectiveHistoryOwner === 'document' ? !!view?.canUndo : effectiveHistoryOwner === 'canvas' && boardUndoRef.current.length > 0),
        redo: !inspectorPermissionRef.current.readOnly && (effectiveHistoryOwner === 'document' ? !!view?.canRedo : effectiveHistoryOwner === 'canvas' && boardRedoRef.current.length > 0) }
      setHistoryCapability((previous) => previous.undo === next.undo && previous.redo === next.redo ? previous : next)
    })
    return () => cancelAppFrame(frame)
  }, [project, activeDocumentId, mode, activeEditor, compactSplit, effectiveHistoryOwner, documentSessionRevision, inspectorPermission.readOnly])
  const effectiveSplit = mode === 'split' && workbenchWidth >= 940
    ? Math.max(460 / workbenchWidth * 100, Math.min(split, (1 - 380 / workbenchWidth) * 100))
    : split
  const activeBoardTrail = useMemo(() => [...boardAncestors(project.boards, activeBoard.id), activeBoard], [activeBoard, project.boards])
  useEffect(() => {
    if (!showBoardCoverPicker) return
    const dismiss = (event: PointerEvent) => { if (!(event.target as Element).closest('.board-cover-picker, .board-actions-trigger')) setShowBoardCoverPicker(false) }
    const escape = (event: KeyboardEvent) => { if (event.key === 'Escape') setShowBoardCoverPicker(false) }
    window.addEventListener('pointerdown', dismiss)
    window.addEventListener('keydown', escape)
    return () => { window.removeEventListener('pointerdown', dismiss); window.removeEventListener('keydown', escape) }
  }, [showBoardCoverPicker])
  useEffect(() => {
    if (!showProjectCoverPicker && !projectThumbMenu) return
    const dismiss = (event: PointerEvent) => {
      const target = event.target as Element
      if (!target.closest('.project-cover-picker-anchor, .project-cover-assignment, .project-thumb-menu, .project-appearance-trigger')) { setShowProjectCoverPicker(false); setProjectThumbMenu(null) }
    }
    const escape = (event: KeyboardEvent) => { if (event.key === 'Escape') { setShowProjectCoverPicker(false); setProjectThumbMenu(null) } }
    window.addEventListener('pointerdown', dismiss)
    window.addEventListener('keydown', escape)
    return () => { window.removeEventListener('pointerdown', dismiss); window.removeEventListener('keydown', escape) }
  }, [showProjectCoverPicker, projectThumbMenu])
  useEffect(() => {
    if (!showBoardActions) return
    const dismiss = (event: PointerEvent) => { if (event.target instanceof Element && !event.target.closest('.board-actions-menu, .board-actions-trigger')) setShowBoardActions(false) }
    const escape = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        setShowBoardActions(false)
        boardActionsTriggerRef.current?.focus()
      }
    }
    window.addEventListener('pointerdown', dismiss)
    window.addEventListener('keydown', escape)
    return () => { window.removeEventListener('pointerdown', dismiss); window.removeEventListener('keydown', escape) }
  }, [showBoardActions])
  useEffect(() => { setShowBoardActions(false); setShowBoardCoverPicker(false) }, [activeBoardId])
  const boardTreeRows = useMemo(() => {
    const rows: Array<{ board: BoardModel; depth: number }> = []
    const visited = new Set<string>()
    const append = (board: BoardModel, depth: number) => {
      if (visited.has(board.id)) return
      visited.add(board.id)
      rows.push({ board, depth })
      boardChildren(project.boards, board.id).forEach((child) => append(child, depth + 1))
    }
    project.boards.filter((board) => !board.parentBoardId).forEach((board) => append(board, 0))
    project.boards.forEach((board) => append(board, 0))
    return rows
  }, [project.boards])

  useEffect(() => {
    if (viewBoardId && project.boards.some((board) => board.id === viewBoardId) && activeBoardId !== viewBoardId) setActiveBoardId(viewBoardId)
  }, [activeBoardId, project.boards, viewBoardId])

  useEffect(() => {
    if (!miniBridgeLaunch || !('__TAURI_INTERNALS__' in window) || !project.title) return
    // The bridge process reuses the standard window; give it a Mini Bridge title.
    void getCurrentWindow().setTitle(`Mini Bridge — ${project.title}`).catch(() => undefined)
  }, [miniBridgeLaunch, project.title])

  useEffect(() => {
    const request = ++documentReplacementRequestRef.current
    getWorkspaceInfo()
      .then(async (info) => {
        if (request !== documentReplacementRequestRef.current) return
        setWorkspace(info)
        // A Mini Bridge process receives its project/board from the Rust
        // layer; probe it before selecting which project to load.
        let launch: AssetManagerLaunch | null = null
        if ('__TAURI_INTERNALS__' in window) {
          try {
            const handed = await invoke<[string, string] | null>('mini_bridge_launch')
            if (handed && Array.isArray(handed) && handed.length === 2) launch = { projectId: handed[0], boardId: handed[1], projectTitle: '' }
          } catch {
            launch = null
          }
        }
        setMiniBridgeLaunch(launch)
        setShowAssetManager(Boolean(launch))
        const [saved, discovered] = await Promise.all([
          loadWorkspaceSettings(),
          listProjects(),
        ])
        if (saved) {
          setMode(saved.viewMode)
          setSplit(Math.min(76, Math.max(28, saved.splitRatio)))
          navigationRef.current = saved.projectNavigation || {}
          setOpenWith(saved.openWith || {})
          setTheme(readLaunchTheme() || (saved.theme === 'light' || saved.theme === 'dark' ? saved.theme : 'navy'))
          setGlassStrength(Math.min(100, Math.max(0, Number(saved.glassStrength) || 0)))
          setMinimalNavigation(Boolean(saved.minimalNavigation))
          setArchivedProjectIds(saved.archivedProjectIds || [])
          setRecipes(saved.recipes || [])
          setSavePolicy(validSavePolicy(saved.savePolicy))
        }
        let available = discovered
        if (available.length === 0 && !info.readOnly) {
          const seed = createProject()
          await ensureProjectWorkspace(seed.id)
          await saveProject(seed)
          available = [{ id: seed.id, title: seed.title, updatedAt: seed.updatedAt, boardCount: seed.boards.length, assetCount: seed.assets.length, status: seed.status }]
        }
        const selectedId = launch && available.some((entry) => entry.id === launch.projectId)
          ? launch.projectId
          : available.some((entry) => entry.id === saved?.activeProjectId)
          ? saved!.activeProjectId!
          : available.some((entry) => entry.id === 'p1-v2-studies')
          ? 'p1-v2-studies'
          : available.some((entry) => entry.id === DEMO_PROJECT_ID) ? DEMO_PROJECT_ID : available[0]?.id
        const storedProject = selectedId ? await loadProject(selectedId) : null
        if (request !== documentReplacementRequestRef.current) return
        if (storedProject) {
          const previousSchema = Number(storedProject.schemaVersion || 1)
          const restored = restoreProject(storedProject)
          if (!info.readOnly) await ensureManagedBoardFolders(restored)
          if (launch) setMiniBridgeLaunch({ ...launch, projectTitle: restored.title })
          if (previousSchema < 9 && !info.readOnly) {
            await saveProject(restored)
            await saveProjectJournal(restored.id, `migration-${previousSchema}-to-9`, {
              migratedAt: new Date().toISOString(), fromSchema: previousSchema, toSchema: 9,
              backup: 'project.json.backup', projectId: restored.id, projectTitle: restored.title, steps: migrationStepLabels(previousSchema),
            })
            setStatus(`Migrated project schema ${previousSchema} → 9 with recovery backup`)
          }
          if (request !== documentReplacementRequestRef.current) return
          replaceDocumentProject(restored)
          const navigation = navigationRef.current[restored.id] || defaultNavigation(restored)
          setActiveBoardId(launch && restored.boards.some((board) => board.id === launch.boardId)
            ? launch.boardId
            : restored.boards.some((board) => board.id === navigation.activeBoardId) ? navigation.activeBoardId : restored.boards[0].id)
          setActiveDocumentId(restored.documents.some((document) => document.id === navigation.activeDocumentId) ? navigation.activeDocumentId : restored.documents[0].id)
          setActiveNavigatorItem(navigation.activeNavigatorItem)
          setMode(navigation.viewMode || saved?.viewMode || 'split')
          setSplit(Math.min(76, Math.max(28, navigation.splitRatio || saved?.splitRatio || 54)))
          if (restored.assets.length) {
            const auditSessionRevision = documentSessionRevisionRef.current
            void auditProjectAssets(restored.assets).then((audits) => {
              if (request !== documentReplacementRequestRef.current) return
              const statusById = new Map(audits.map((audit) => [audit.id, audit.status]))
              setProject((current) => current.id !== restored.id || auditSessionRevision !== documentSessionRevisionRef.current ? current : ({ ...current, assets: current.assets.map((asset) => {
                const audited = statusById.get(asset.id) || asset.status
                return { ...asset, status: audited === 'available' && asset.kind === 'image' && !asset.thumbnailRelativePath ? 'preview-pending' : audited }
              }) }))
            }).catch(() => setStatus('Asset audit could not complete'))
          }
        }
        setProjectSummaries(available)
        setTrashedProjects(await listTrashedProjects().catch(() => []))
        setProjectReady(Boolean(storedProject))
        setSettingsHydrated(true)
        setStatus(info.readOnly ? 'Workspace open read-only' : 'Portable workspace ready')
      })
      .catch(() => {
        if (request !== documentReplacementRequestRef.current) return
        setSettingsHydrated(true)
        setBootStorageFailed(true)
        setStatus('Browser preview — desktop storage connects in the native window')
      })
  }, [])

  useEffect(() => {
    if (!projectReady) return
    void listProjectTrash(project.id).then((stored) => setProjectTrash(stored as unknown as TrashEntry[])).catch(() => setProjectTrash([]))
  }, [project.id, projectReady])

  useEffect(() => {
    localStorage.setItem('art-equation.view-mode', mode)
    localStorage.setItem('art-equation.split', String(split))
    localStorage.setItem('art-equation.minimal-navigation', minimalNavigation ? '1' : '0')
    localStorage.removeItem('art-equation.canvas-engine')
    if (closingProject || assetManagerProjectId || !settingsHydrated || !workspace || workspace.readOnly) return
    const timer = window.setTimeout(() => {
      const projectNavigation = {
        ...navigationRef.current,
        [project.id]: { ...navigationRef.current[project.id], activeBoardId, activeDocumentId, activeNavigatorItem, viewMode: mode, splitRatio: split },
      }
      navigationRef.current = projectNavigation
      saveWorkspaceSettings({ schemaVersion: 5, viewMode: mode, splitRatio: split, activeProjectId: project.id, projectNavigation, openWith, theme, glassStrength, minimalNavigation,  archivedProjectIds, recipes, savePolicy })
        .then(() => setStatus('Workspace layout saved'))
        .catch((error) => setStatus(`Could not save workspace layout: ${String(error)}`))
    }, 250)
    return () => window.clearTimeout(timer)
  }, [closingProject, activeBoardId, activeDocumentId, activeNavigatorItem, assetManagerProjectId, mode, navigationRevision, openWith, theme, glassStrength, minimalNavigation, savePolicy, archivedProjectIds, project.id, recipes, settingsHydrated, split, workspace])

  useEffect(()=>{
    nextIntervalSave.current.clear()
  },[savePolicy.mode,savePolicy.intervalMinutes])
  useEffect(()=>{
    if(!projectReady||!settingsHydrated||workspace?.storageSchema!==2||workspace.readOnly||viewBoardId)return
    void configureProjectStorage(project.id,savePolicy.intervalMinutes).catch(e=>setStatus(`Recovery scheduling failed: ${String(e)}`))
  },[project.id,projectReady,settingsHydrated,workspace,savePolicy.intervalMinutes,viewBoardId])
  useEffect(() => {
    if (closingProject || !settingsHydrated || !projectReady || switchingProject || !workspace || workspace.readOnly) return
    const pending=hasPendingProjectContent(project)
    setSavePending(pending)
    const interval=savePolicy.intervalMinutes*60_000
    if(!nextIntervalSave.current.has(project.id))nextIntervalSave.current.set(project.id,Date.now()+interval)
    const delay=savePolicy.mode==='continuous'?900:Math.max(0,nextIntervalSave.current.get(project.id)!-Date.now())
    if(pending&&savePolicy.mode==='interval')setStatus(`Edits pending — automatic save every ${savePolicy.intervalMinutes} minutes`)
    const timer = window.setTimeout(() => {
      const source=project
      const snapshot = { ...project, updatedAt: new Date().toISOString() }
      const save=savePolicy.mode==='interval'?saveProject(snapshot):saveProjectAutosave(snapshot)
      save
        .then(() => {
          nextIntervalSave.current.set(snapshot.id,Date.now()+interval)
          if(projectRef.current===source)setSavePending(false)
          setProjectSummaries((current) => current.map((entry) => entry.id === snapshot.id ? { ...entry, title: snapshot.title, updatedAt: snapshot.updatedAt, boardCount: snapshot.boards.length, assetCount: snapshot.assets.length, status: snapshot.status, coverRelativePath: projectCoverRelativePath(snapshot), coverFraming: snapshot.projectCoverFraming, tags: snapshot.questionnaire.tags, date: snapshot.questionnaire.date } : entry))
          setStatus('Project autosaved')
        })
        .catch((error) => setStatus(`Autosave failed: ${String(error)}`))
    }, delay)
    return () => window.clearTimeout(timer)
  }, [closingProject, project, projectReady, settingsHydrated, switchingProject, workspace,savePolicy])

  // Register once, but read the latest committed editor/project state. Replacing
  // the listener on every keystroke would leave a gap in close protection.
  const closeContextRef = useRef({ workspace, projectReady, settingsHydrated, switchingProject, assetManagerProjectId, viewBoardId,
    settings: { schemaVersion: 5 as const, viewMode: mode, splitRatio: split, activeProjectId: project.id, projectNavigation: navigationRef.current, openWith, theme, glassStrength, minimalNavigation, archivedProjectIds, recipes, savePolicy } })
  closeContextRef.current = { workspace, projectReady, settingsHydrated, switchingProject, assetManagerProjectId, viewBoardId,
    settings: { schemaVersion: 5, viewMode: mode, splitRatio: split, activeProjectId: project.id, projectNavigation: { ...navigationRef.current, [project.id]: { ...navigationRef.current[project.id], activeBoardId, activeDocumentId, activeNavigatorItem, viewMode: mode, splitRatio: split } }, openWith, theme, glassStrength, minimalNavigation, archivedProjectIds, recipes, savePolicy } }
  useEffect(() => {
    if (!('__TAURI_INTERNALS__' in window)) return
    let disposed = false
    let unlisten: (() => void) | undefined
    let busy = false
    let closeAttempts = 0
    let lastCloseAttempt = 0

    void getCurrentWindow().onCloseRequested(async (event) => {
      const now = Date.now()
      if (now - lastCloseAttempt < 3500) {
        closeAttempts++
      } else {
        closeAttempts = 1
      }
      lastCloseAttempt = now

      // Emergency escape hatch: if user clicks close repeatedly (2nd time within 3.5s), destroy window immediately.
      if (closeAttempts >= 2) {
        console.warn('Repeated close requested: force closing window immediately')
        try {
          await getCurrentWindow().destroy()
        } catch {
          window.close()
        }
        return
      }

      if (busy) {
        event.preventDefault()
        setStatus('Application is saving... Click close again to force exit.')
        return
      }

      const context = closeContextRef.current
      if (!context.workspace || context.workspace.readOnly || context.viewBoardId) return
      if (!context.projectReady || !context.settingsHydrated || context.switchingProject) {
        event.preventDefault()
        setStatus('Finalizing workspace operations... Click close again to force exit.')
        return
      }

      busy = true
      event.preventDefault()
      setClosingProject(true)
      try {
        // Let the final input and the inert state commit before taking a snapshot.
        await new Promise<void>((resolve) => window.setTimeout(resolve, 0))
        
        const saveOperation = async () => {
          let saved: ProjectModel
          let iterations = 0
          do {
            iterations++
            if (iterations > 3) break
            saved = projectRef.current
            const latest = closeContextRef.current
            if (latest.workspace?.readOnly || latest.workspace?.root !== context.workspace?.root || latest.switchingProject) {
              break
            }
            await saveProject({ ...saved, updatedAt: new Date().toISOString() })
            if (!latest.assetManagerProjectId) await saveWorkspaceSettings(latest.settings)
          } while (projectRef.current !== saved)
        }

        // Bounded save with 1500ms timeout so disk lag never blocks window closing forever
        await Promise.race([
          saveOperation(),
          new Promise((_, reject) => window.setTimeout(() => reject(new Error('Save timeout (1500ms)')), 1500))
        ])

        await getCurrentWindow().destroy()
      } catch (error) {
        console.warn('Close save caught error:', error)
        setStatus(`Close save warning: ${String(error)}. Click close again to force exit.`)
        try {
          await getCurrentWindow().destroy()
        } catch {
          window.close()
        }
      } finally {
        busy = false
        if (!disposed) setClosingProject(false)
      }
    }).then((stop) => { if (disposed) stop(); else unlisten = stop }).catch((error) => setStatus(`Close protection unavailable: ${String(error)}`))
    return () => { disposed = true; unlisten?.() }
  }, [])

  useEffect(() => {
    if (!documentVisible) return
    const workbench = workbenchRef.current
    if (!workbench) return
    let stage: HTMLElement | null = null
    let frame = 0
    const ownerSession = documentSessionKey
    const ownerDocument = activeDocument.id
    const ownerRevision = documentSessionRevisionRef.current
    const isCurrent = () => documentSessionRevisionRef.current === ownerRevision && projectRef.current.id === project.id
      && documentViewOwnerRef.current.sessionKey === ownerSession && documentViewOwnerRef.current.documentId === ownerDocument && documentViewOwnerRef.current.visible
    const rememberScroll = () => {
      if (!stage || !isCurrent()) return
      const current = navigationRef.current[project.id] || defaultNavigation(project)
      navigationRef.current = {
        ...navigationRef.current,
        [project.id]: { ...current, documentScrollTop: { ...(current.documentScrollTop || {}), [ownerDocument]: stage.scrollTop } },
      }
      if (scrollSaveTimerRef.current) window.clearTimeout(scrollSaveTimerRef.current)
      scrollSaveTimerRef.current = window.setTimeout(() => setNavigationRevision((revision) => revision + 1), 220)
    }
    const attach = () => {
      const candidate = workbench.querySelector<HTMLElement>(`[data-document-session="${CSS.escape(ownerSession)}"][data-document-id="${CSS.escape(ownerDocument)}"] .document-stage`)
      if (!candidate || candidate === stage) return Boolean(stage)
      stage?.removeEventListener('scroll', rememberScroll)
      stage = candidate
      const remembered = navigationRef.current[project.id]?.documentScrollTop?.[ownerDocument] || 0
      frame = requestAppFrame(() => { if (stage && isCurrent()) stage.scrollTop = remembered })
      stage.addEventListener('scroll', rememberScroll, { passive: true })
      return true
    }
    const observer = new MutationObserver(() => { if (attach()) observer.disconnect() })
    if (!attach()) observer.observe(workbench, { childList: true, subtree: true })
    return () => {
      cancelAppFrame(frame)
      observer.disconnect()
      stage?.removeEventListener('scroll', rememberScroll)
    }
  }, [activeDocument.id, documentVisible, documentSessionKey, mode, project.id])

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.defaultPrevented || !(event.ctrlKey || event.metaKey) || event.altKey) return
      const target = event.target instanceof HTMLElement ? event.target : null
      if (event.key.toLowerCase() === 'z' || event.key.toLowerCase() === 'y') {
        if (target?.closest('input,textarea,select,.questionnaire-pane') || (target?.isContentEditable && !target.closest('.document-editor'))) return
        const editor = target?.closest('.canvas-pane') ? 'canvas' : target?.closest('.document-pane') ? 'document' : null
        if (!editor) return
        event.preventDefault()
        const command = event.key.toLowerCase() === 'y' || (event.key.toLowerCase() === 'z' && event.shiftKey) ? 'redo' : 'undo'
        if (editor === 'canvas') command === 'redo' ? redoBoard() : undoBoard()
        else { const controls = controlsForDocument(activeDocument.id).current; if (command === 'redo') controls?.redo(); else controls?.undo() }
        return
      }
      const nextMode = event.key === '1' ? 'document' : event.key === '2' ? 'split' : event.key === '3' ? 'canvas' : null
      if (!nextMode) return
      event.preventDefault()
      changeMode(nextMode)
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  })

  openProjectRef.current = openProject
  async function openProject(projectId: string) {
    if (projectId === project.id || switchingProject) return
    const request = ++documentReplacementRequestRef.current
    const permission = inspectorPermissionRef.current
    setSwitchingProject(true)
    setProjectReady(false)
    try {
      if (workspace && !workspace.readOnly) {
        const snapshot = { ...project, updatedAt: new Date().toISOString() }
        await saveProject(snapshot)
      }
      const stored = await loadProject(projectId)
      if (!stored) throw new Error('The project file is missing or unreadable')
      const previousSchema = Number(stored.schemaVersion || 1)
      const restored = restoreProject(stored)
      if (workspace && !workspace.readOnly) await ensureManagedBoardFolders(restored)
      if (previousSchema < 9 && workspace && !workspace.readOnly) {
        await saveProject(restored)
        await saveProjectJournal(restored.id, `migration-${previousSchema}-to-9`, {
          migratedAt: new Date().toISOString(), fromSchema: previousSchema, toSchema: 9,
          backup: 'project.json.backup', projectId: restored.id, projectTitle: restored.title, steps: migrationStepLabels(previousSchema),
        })
      }
      const fallback = defaultNavigation(restored)
      const remembered = navigationRef.current[restored.id] || fallback
      const activeBoard = restored.boards.some((board) => board.id === remembered.activeBoardId) ? remembered.activeBoardId : fallback.activeBoardId
      const activeDocument = restored.documents.some((document) => document.id === remembered.activeDocumentId) ? remembered.activeDocumentId : fallback.activeDocumentId
      const navigatorItem = remembered.activeNavigatorItem.startsWith('board:') && restored.boards.some((board) => `board:${board.id}` === remembered.activeNavigatorItem)
        || remembered.activeNavigatorItem.startsWith('document:') && restored.documents.some((document) => `document:${document.id}` === remembered.activeNavigatorItem)
        ? remembered.activeNavigatorItem
        : `document:${activeDocument}`
      if (request !== documentReplacementRequestRef.current || inspectorPermissionRef.current.revision !== permission.revision) {
        if (request === documentReplacementRequestRef.current) { setProjectReady(true); setStatus('The workspace changed while opening the project; the previous project remains open') }
        return
      }
      replaceDocumentProject(restored)
      setActiveBoardId(activeBoard)
      setActiveDocumentId(activeDocument)
      setActiveNavigatorItem(navigatorItem)
      setMode(remembered.viewMode || 'split')
      setSplit(Math.min(76, Math.max(28, remembered.splitRatio || 54)))
      boardUndoRef.current = []
      boardRedoRef.current = []
      setShowAssetManager(false)
      setStatus(previousSchema < 9 ? `Opened ${restored.title} · migrated schema ${previousSchema} → 9 with backup` : `Opened ${restored.title}`)
      if (restored.assets.length) {
        const auditSessionRevision = documentSessionRevisionRef.current
        void auditProjectAssets(restored.assets).then((audits) => {
          if (request !== documentReplacementRequestRef.current) return
          const statusById = new Map(audits.map((audit) => [audit.id, audit.status]))
          setProject((current) => current.id !== restored.id || auditSessionRevision !== documentSessionRevisionRef.current ? current : ({ ...current, assets: current.assets.map((asset) => ({ ...asset, status: statusById.get(asset.id) || asset.status })) }))
        }).catch(() => setStatus('Asset audit could not complete'))
      }
      setProjectReady(true)
    } catch (error) {
      if (request === documentReplacementRequestRef.current) { setProjectReady(true); setStatus(`Could not open project: ${String(error)}`) }
    } finally {
      if (request === documentReplacementRequestRef.current) setSwitchingProject(false)
    }
  }

  async function persistProjectWhileCurrent(value: ProjectModel, isCurrent: () => boolean) {
    const linked = withRequiredBoardFolderLinks(value)
    if (!isCurrent()) return { project: linked, phase: 'none' as const, current: false }
    await ensureManagedBoardFolders(linked)
    if (!isCurrent()) return { project: linked, phase: 'folders' as const, current: false }
    await saveProject(linked)
    return { project: linked, phase: 'saved' as const, current: isCurrent() }
  }

  async function newProject() {
    const context = inspectorMutationContext
    const sessionRevision = documentSessionRevision
    const before = projectRef.current
    let request = projectCreationRequest
    const isCurrent = () => canMutateInspectorProject(context) && documentSessionRevisionRef.current === sessionRevision
      && documentReplacementRequestRef.current === request && projectRef.current === before
    if (!workspace || switchingProject || !isCurrent()) return setStatus('Creating a project requires the current writable workspace')
    let started = false
    let completed = ''
    const stopped = () => {
      if (request !== documentReplacementRequestRef.current) return
      setProjectReady(true)
      setStatus(`${completed ? completed + ' ' : ''}Creation stopped because the project or workspace permissions changed; completed files were kept and this request did not open the new project`)
    }
    try {
      const title = (await requestText({ title: 'New project', label: 'Project name', initialValue: 'Untitled project' }))?.trim()
      if (!title) return
      if (!isCurrent()) return stopped()
      request = ++documentReplacementRequestRef.current
      started = true
      const created = withRequiredBoardFolderLinks(createBlankProject(title))
      setSwitchingProject(true)
      setProjectReady(false)
      if (!isCurrent()) return stopped()
      const previousSave = await persistProjectWhileCurrent({ ...before, updatedAt: new Date().toISOString() }, isCurrent)
      if (previousSave.phase === 'saved') completed = 'The previous project was saved.'
      else if (previousSave.phase === 'folders') completed = 'Folder preparation completed for the previous project.'
      if (!previousSave.current || !isCurrent()) return stopped()
      await ensureProjectWorkspace(created.id)
      completed = 'The new project folders were prepared.'
      if (!isCurrent()) return stopped()
      const createdSave = await persistProjectWhileCurrent(created, isCurrent)
      if (createdSave.phase === 'saved') completed = 'The new project was saved.'
      if (!createdSave.current || !isCurrent()) return stopped()
      const saved = createdSave.project
      const navigation = defaultNavigation(saved)
      if (!isCurrent()) return stopped()
      const committedSessionRevision = documentSessionRevisionRef.current + 1
      const isPublishedOwnerCurrent = () => {
        const permission = inspectorPermissionRef.current
        return !permission.readOnly && permission.workspaceRoot === context.workspaceRoot && permission.revision === context.permissionRevision
          && documentReplacementRequestRef.current === request && documentSessionRevisionRef.current === committedSessionRevision
          && (projectRef.current === before || projectRef.current.id === saved.id)
      }
      navigationRef.current = { ...navigationRef.current, [saved.id]: navigation }
      replaceDocumentProject(saved)
      setActiveBoardId((current) => isPublishedOwnerCurrent() ? navigation.activeBoardId : current)
      setActiveDocumentId((current) => isPublishedOwnerCurrent() ? navigation.activeDocumentId : current)
      setActiveNavigatorItem((current) => isPublishedOwnerCurrent() ? navigation.activeNavigatorItem : current)
      setMode((current) => isPublishedOwnerCurrent() ? 'split' : current)
      setProjectSummaries((current) => isPublishedOwnerCurrent() ? [{ id: saved.id, title: saved.title, updatedAt: saved.updatedAt, boardCount: saved.boards.length, assetCount: 0, status: saved.status }, ...current] : current)
      boardUndoRef.current = []
      boardRedoRef.current = []
      setProjectReady(true)
      setStatus(`Created ${saved.title}`)
    } catch (error) {
      if (request === documentReplacementRequestRef.current) { setProjectReady(true); setStatus(`Could not create project: ${String(error)}${completed ? ' ' + completed + ' Completed files were kept.' : ''}`) }
    } finally {
      if (started && request === documentReplacementRequestRef.current) setSwitchingProject(false)
    }
  }

  function changeMode(nextMode: ViewMode) {
    clearDocumentFocusWriting(false)
    setMode(nextMode)
    if (nextMode === 'document') { setActiveEditor('document'); setHistoryOwner(activeDocument.id === QUESTIONNAIRE_DOCUMENT_ID ? 'none' : 'document') }
    if (nextMode === 'canvas') { setActiveEditor('canvas'); setHistoryOwner('canvas') }
    setStatus(`${MODE_LABELS[nextMode]} view`)
  }

  async function duplicateProject(sourceProjectId = project.id) {
    const context = inspectorMutationContext
    const sessionRevision = documentSessionRevision
    const before = projectRef.current
    let request = projectCreationRequest
    const isCurrent = () => canMutateInspectorProject(context) && documentSessionRevisionRef.current === sessionRevision
      && documentReplacementRequestRef.current === request && projectRef.current === before
    if (!workspace || switchingProject || !isCurrent()) return setStatus('Duplicating requires the current writable workspace')
    let completed = ''
    const stopped = () => {
      if (request === documentReplacementRequestRef.current) setStatus(`${completed ? completed + ' ' : ''}Duplication stopped because the project or workspace permissions changed; completed files were kept`)
    }
    try {
      let source = before
      if (sourceProjectId !== before.id) {
        const stored = await loadProject(sourceProjectId)
        if (!isCurrent()) return stopped()
        if (!stored) return setStatus('The source project is missing or unreadable; duplication was not started')
        source = restoreProject(stored)
        if (source.id !== sourceProjectId) return setStatus('The source project identity does not match; duplication was not started')
      }
      const title = (await requestText({ title: 'Duplicate project', label: 'Name for project duplicate', initialValue: `${source.title} copy` }))?.trim()
      if (!title) return
      if (!isCurrent()) return stopped()
      request = ++documentReplacementRequestRef.current
      const copy = createBlankProject(title)
      const duplicated: ProjectModel = withRequiredBoardFolderLinks({ ...copy, ...structuredClone(source), id: copy.id, title, updatedAt: new Date().toISOString(), boards: source.boards.map((board) => ({ ...structuredClone(board), linkedFolderPath: board.parentBoardId ? board.linkedFolderPath : undefined })) })
      if (!isCurrent()) return stopped()
      await ensureProjectWorkspace(duplicated.id)
      completed = 'The duplicate project folders were prepared.'
      if (!isCurrent()) return stopped()
      const duplicateSave = await persistProjectWhileCurrent(duplicated, isCurrent)
      if (duplicateSave.phase === 'saved') completed = 'The duplicate project was saved.'
      if (!duplicateSave.current || !isCurrent()) return stopped()
      const saved = duplicateSave.project
      setProjectSummaries((current) => isCurrent() ? [{ id: saved.id, title, updatedAt: saved.updatedAt, boardCount: saved.boards.length, assetCount: saved.assets.length, tags: saved.questionnaire.tags, date: saved.questionnaire.date, status: saved.status, coverRelativePath: projectCoverRelativePath(saved), coverFraming: saved.projectCoverFraming }, ...current] : current)
      if (isCurrent()) setStatus(`Duplicated ${source.title}`)
    } catch (error) {
      if (request === documentReplacementRequestRef.current) setStatus(`Could not duplicate project: ${String(error)}${completed ? ' ' + completed + ' Completed files were kept.' : ''}`)
    }
  }

  function toggleProjectArchive(id: string) {
    setArchivedProjectIds((current) => current.includes(id) ? current.filter((entry) => entry !== id) : [...current, id])
  }

  async function removeNavigatorDocument(documentId: string) {
    const before = projectRef.current
    const document = before.documents.find((entry) => entry.id === documentId)
    if (!document) return
    if (!isDeletableDocument(document)) return setStatus('The project questionnaire is locked and cannot be removed')
    const context = documentContext(documentId)
    if (!canPublishDocument(context, documentId)) return setStatus('This workspace is read-only')
    if (!await appConfirm(`Move “${document.title}” to Trash? You can restore it later.`, { title: 'Move document to Trash', confirmLabel: 'Move to Trash' })) return
    if (!canPublishDocument(context, documentId) || projectRef.current.id !== before.id) {
      return setStatus('Document removal cancelled because the workspace permissions or project changed')
    }
    const currentProject = projectRef.current
    const currentDoc = currentProject.documents.find((entry) => entry.id === documentId)
    if (!currentDoc) return
    const result = applyDocumentTrash(currentProject, documentId)
    if (!result) return
    try {
      await recordTrashEntry(currentProject.id, result.entry)
      if (!canPublishDocument(context, documentId) || projectRef.current.id !== currentProject.id) {
        await removeTrashEntry(currentProject.id, result.entry.id)
        setStatus('The document or project changed while Trash was saving. Nothing was moved; try again.')
        return
      }
      try {
        setProjectTrash(await listProjectTrash(currentProject.id) as unknown as TrashEntry[])
      } catch {}
    } catch (error) {
      setStatus(`Document was not moved: Trash could not save its restore copy (${String(error)})`)
      return
    }
    const remaining = result.project.documents
    const fallback = remaining[0]?.id || QUESTIONNAIRE_DOCUMENT_ID
    setProject((current) => {
      if (!canPublishDocument(context, documentId) || current.id !== currentProject.id) return current
      return { ...current, documents: current.documents.filter((entry) => entry.id !== documentId) }
    })
    if (projectRef.current.id === currentProject.id && (activeDocumentId === documentId || activeNavigatorItem === `document:${documentId}`)) {
      setActiveDocumentId(fallback)
      setActiveNavigatorItem(`document:${fallback}`)
    }
    setStatus(`Moved “${document.title}” to Trash`)
  }

  async function trashCanvasSelection(boardId: string, nodeIds: string[]): Promise<boolean> {
    if (canvasTrashBusyRef.current || !nodeIds.length) return false
    const context = inspectorMutationContext
    if (!canMutateInspectorProject(context)) { setStatus('This workspace is read-only, so the selection cannot be moved to Trash'); return false }
    const before = projectRef.current
    const board = before.boards.find((entry) => entry.id === boardId)
    if (!board) return false
    const result = applyCanvasSelectionTrash(before, boardId, nodeIds)
    if (!result) { setStatus('The selection cannot be moved safely; locked objects and invalid board ownership are unchanged'); return false }
    canvasTrashBusyRef.current = true
    try {
      if (result.entry.boards?.length && !await appConfirm(`Move this selection and ${result.entry.boards.length} owned subboard(s), including their contents, to Trash? Linked disk files remain untouched.`, { title: 'Move selection to Trash', confirmLabel: 'Move to Trash' })) return false
      if (!canMutateInspectorProject(context) || projectRef.current.id !== before.id || projectRef.current.boards !== before.boards) {
        setStatus('The board or permissions changed. Nothing was moved; try again.')
        return false
      }
      await recordTrashEntry(before.id, result.entry)
      if (!canMutateInspectorProject(context) || projectRef.current.id !== before.id || projectRef.current.boards !== before.boards) {
        await removeTrashEntry(before.id, result.entry.id)
        setStatus('The board changed while Trash was saving. Nothing was moved; try again.')
        return false
      }
      const oldBoard = before.boards.find((entry) => entry.id === boardId)!
      const newBoard = result.project.boards.find((entry) => entry.id === boardId)!
      recordNativeCommand(boardUndoRef.current, boardRedoRef.current, oldBoard, newBoard)
      graphHistoryRef.current.set(boardUndoRef.current.at(-1)!, { before: before.boards, after: result.project.boards })
      setProject((current) => {
        if (!canMutateInspectorProject(context) || current.id !== before.id || current.boards !== before.boards) return current
        return { ...current, boards: result.project.boards }
      })
      try {
        setProjectTrash(await listProjectTrash(before.id) as unknown as TrashEntry[])
      } catch {}
      setStatus(`Moved “${result.entry.title}” to Trash as one recovery record · Ctrl+Z to undo`)
      return true
    } catch (error) {
      setStatus(`Trash could not complete safely (${String(error)}). The recovery record is retained if it was saved.`)
      return false
    } finally { canvasTrashBusyRef.current = false }
  }

  async function restoreCanvasNode(entry: TrashEntry) {
    const before = projectRef.current
    const context = documentContext(activeDocument.id)
    const restored = entry.kind === 'board' ? applyBoardRestore(before, entry) : entry.kind === 'document' ? applyDocumentRestore(before, entry) : entry.kind === 'asset' ? applyAssetRestore(before, entry) : applyNodeRestore(before, entry)
    if (!restored) return setStatus('Recovery was not applied: an owner, endpoint, asset or original ID is missing/conflicting. The recovery record remains in Trash.')
    const linked = withRequiredBoardFolderLinks(restored)
    try {
      if (entry.kind === 'board' || entry.boards?.length) await ensureManagedBoardFolders(linked)
      if (projectRef.current !== before) return setStatus('The project changed during recovery. The record remains in Trash; try again.')
      // Commit the restored project before removing its only durable recovery copy.
      await saveProject(linked)
      if (projectRef.current !== before || !canPublishDocument(context, activeDocument.id)) return setStatus('Recovery save completed for the previous view; its model was not applied and the recovery record remains available')
      if (entry.kind === 'document') {
        for (const restoredDocument of linked.documents) if (!before.documents.some((document) => document.id === restoredDocument.id)) forgetDocumentSession(restoredDocument.id)
      }
      setProject(linked)
      await removeTrashEntry(before.id, entry.id)
      setProjectTrash(await listProjectTrash(before.id) as unknown as TrashEntry[])
      setStatus(`Restored “${entry.title}”`)
    } catch (error) { setStatus(`Recovery could not finish (${String(error)}). Its record remains available unless already cleared after a successful project save.`) }
  }

  async function deleteTrashEntryForever(entry: TrashEntry) {
    if (!await appConfirm(`Remove the recovery record for “${entry.title}”? This cannot be undone. Original files on disk are not deleted.`, { title: 'Remove recovery record', confirmLabel: 'Remove record' })) return
    void removeTrashEntry(project.id, entry.id)
      .then(() => listProjectTrash(project.id))
      .then((stored) => setProjectTrash(stored as unknown as TrashEntry[]))
      .then(() => setStatus(`Removed the recovery record for “${entry.title}”; disk files were not deleted`))
      .catch((error) => setStatus(`Could not delete the trash entry: ${String(error)}`))
  }

  async function deleteNavigatorBoard(boardId: string) {
    const board = project.boards.find((entry) => entry.id === boardId)
    if (!board) return
    if (workspace?.readOnly) return setStatus('This workspace is read-only')
    const result = applyBoardTrash(project, boardId)
    if (!result) return
    if (!result.project.boards.length) return setStatus('At least one root board must remain in the project')
    const childCount = (result.entry.boards?.length || 1) - 1
    const linkCount = result.entry.boardLinks?.reduce((count, link) => count + link.nodes.length, 0) || 0
    if (!await appConfirm(`Move “${board.title}”${childCount ? ` and ${childCount} nested board${childCount === 1 ? '' : 's'}` : ''} to Trash?${linkCount ? ` ${linkCount} board link${linkCount === 1 ? '' : 's'} will be removed and restored with it.` : ''} Linked disk folders and their files will remain untouched.`, { title: 'Move board to Trash', confirmLabel: 'Move to Trash' })) return
    const remaining = result.project.boards
    try {
      await recordTrashEntry(project.id, result.entry)
      setProjectTrash(await listProjectTrash(project.id) as unknown as TrashEntry[])
      setProject(result.project)
      if (result.entry.boards?.some((entry) => entry.id === activeBoard.id)) switchBoard(remaining[0].id)
      setStatus(`Moved “${board.title}” to Trash with its nested boards and links`)
    } catch (error) { setStatus(`Board was not moved: Trash could not save its restore copy (${String(error)})`) }
  }

  async function trashProjectAsset(assetId: string) {
    if (workspace?.readOnly) return setStatus('This workspace is read-only')
    const result = applyAssetTrash(project, assetId)
    if (!result) return setStatus('That asset cannot be moved to Trash')
    const count = result.entry.placements?.length || 0
    if (!await appConfirm(`Move “${result.entry.title}” from the catalog to Trash? ${count} board placement${count === 1 ? '' : 's'} will also move. The original file remains on disk.`, { title: 'Move asset to Trash', confirmLabel: 'Move to Trash' })) return
    try {
      await recordTrashEntry(project.id, result.entry)
      setProjectTrash(await listProjectTrash(project.id) as unknown as TrashEntry[])
      setProject(result.project)
      setStatus(`Moved “${result.entry.title}” and ${count} placement${count === 1 ? '' : 's'} to Trash`)
    } catch (error) { setStatus(`Asset was not moved: Trash could not save its restore copy (${String(error)})`) }
  }

  useEffect(() => {
    localStorage.setItem('art-equation.navigator', showNavigatorPanel ? '1' : '0')
    localStorage.setItem('art-equation.inspector', showInspectorPanel ? '1' : '0')
  }, [showNavigatorPanel, showInspectorPanel])
  useEffect(() => {
    localStorage.setItem('art-equation.navigator-width', String(navigatorWidth))
    localStorage.setItem('art-equation.inspector-width', String(inspectorWidth))
    localStorage.setItem('art-equation.project-board-strip', showProjectBoardStrip ? '1' : '0')
  }, [navigatorWidth, inspectorWidth, showProjectBoardStrip])

  useLayoutEffect(() => {
    const workbench = workbenchRef.current
    if (!workbench) return
    const measure = () => {
      const width = Math.round(workbench.getBoundingClientRect().width)
      setWorkbenchWidth((current) => current === width ? current : width)
    }
    measure()
    const observer = new ResizeObserver(measure)
    observer.observe(workbench)
    return () => observer.disconnect()
  }, [projectReady])

  useEffect(() => {
    if (!previewAssetId) return
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setPreviewAssetId(null)
      if (event.key === 'ArrowRight' || event.key === 'ArrowLeft') {
        const list = activeBoard.nodes.filter((node) => (node.kind === 'image' || node.kind === 'video' || node.kind === 'model') && node.assetId).map((node) => node.assetId!).filter((id, index, all) => all.indexOf(id) === index)
        const current = list.indexOf(previewAssetId)
        if (current === -1) return
        const next = event.key === 'ArrowRight' ? (current + 1) % list.length : (current - 1 + list.length) % list.length
        setPreviewZoomed(false)
        setPreviewAssetId(list[next])
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [previewAssetId, activeBoard])

  useEffect(() => { setPreviewZoom(1); setPreviewPan({ x: 0, y: 0 }); previewDragRef.current = false }, [previewAssetId])

  function startPanelEdgeDrag(which: 'navigator' | 'inspector') {
    return (event: React.PointerEvent<HTMLButtonElement>) => {
      if (event.button !== 0) return
      const startX = event.clientX
      const startWidth = which === 'navigator' ? navigatorWidth : inspectorWidth
      let moved = false
      const move = (pointerEvent: PointerEvent) => {
        const delta = pointerEvent.clientX - startX
        if (Math.abs(delta) < 4) return
        moved = true
        if (which === 'navigator') setNavigatorWidth(Math.min(360, Math.max(176, startWidth + delta)))
        else setInspectorWidth(Math.min(420, Math.max(240, startWidth - delta)))
      }
      const finish = () => {
        window.removeEventListener('pointermove', move)
        window.removeEventListener('pointerup', finish)
        if (moved) {
          panelDragSuppressClickRef.current = true
          window.setTimeout(() => { panelDragSuppressClickRef.current = false }, 0)
        }
      }
      window.addEventListener('pointermove', move)
      window.addEventListener('pointerup', finish, { once: true })
    }
  }
  const panelDragSuppressClickRef = useRef(false)
  function onPanelEdgeClick(which: 'navigator' | 'inspector') {
    if (panelDragSuppressClickRef.current) { panelDragSuppressClickRef.current = false; return }
    if (which === 'navigator') setShowNavigatorPanel(false)
    else setShowInspectorPanel(false)
    requestAppFrame(() => (which === 'navigator' ? navigatorTabRef : inspectorTabRef).current?.focus())
  }
  function restorePanel(which: 'navigator' | 'inspector') {
    if (which === 'navigator') setShowNavigatorPanel(true)
    else setShowInspectorPanel(true)
    requestAppFrame(() => (which === 'navigator' ? navigatorEdgeRef : inspectorEdgeRef).current?.focus())
  }
  function onPanelEdgeKeyDown(event: React.KeyboardEvent<HTMLButtonElement>, which: 'navigator' | 'inspector') {
    const delta = event.key === 'ArrowRight' ? 12 : event.key === 'ArrowLeft' ? -12 : 0
    if (event.key === 'Home') {
      event.preventDefault()
      onPanelEdgeClick(which)
    } else if (delta) {
      event.preventDefault()
      if (which === 'navigator') setNavigatorWidth((width) => Math.min(360, Math.max(176, width + delta)))
      else setInspectorWidth((width) => Math.min(420, Math.max(240, width - delta)))
    }
  }

  function previewUrl(asset: ProjectAsset) {
    if (!workspace) return import.meta.env.DEV || window.location.hostname === '127.0.0.1' ? asset.relativePath : undefined
    if (asset.requiresTiledPreview) return workspaceAssetUrl(workspace.root, asset.thumbnailRelativePath)
    const sourcePath = asset.status === 'moved' ? asset.managedRelativePath || asset.relativePath : asset.relativePath
    return convertFileSrc(`${workspace.root.replace(/[\\/]+$/, '')}\\${sourcePath.replaceAll('/', '\\')}`)
  }

  async function renamePreviewAsset(asset: ProjectAsset) {
    const title = (await requestText({ title: 'Rename catalog entry', label: 'File name', initialValue: asset.displayName || asset.originalName }))?.trim()
    if (!title || title === asset.displayName) return
    setProject((current) => ({ ...current, assets: current.assets.map((entry) => entry.id === asset.id ? { ...entry, displayName: title } : entry) }))
    setStatus(`Renamed to “${title}”`)
  }

  function openPreviewWith(asset: ProjectAsset) {
    const app = openWith[asset.extension.toLowerCase()]
    if (!app) return setStatus(`No application is set for .${asset.extension.toLowerCase()} files — choose one in Mini Bridge`)
    void launchAsset(asset, app)
  }

  async function downloadPreviewAsset(asset: ProjectAsset) {
    const url = previewUrl(asset)
    if (!url) return setStatus('Saving a copy is available in the native desktop window')
    const destination = await save({ defaultPath: asset.originalName || `image.${asset.extension.toLowerCase()}` })
    if (!destination) return
    try {
      const bytes = new Uint8Array(await (await fetch(url)).arrayBuffer())
      await exportBinary(destination, bytes)
      setStatus(`Saved a copy to ${destination}`)
    } catch (error) {
      setStatus(`Could not save a copy: ${String(error)}`)
    }
  }

  async function moveProjectToTrash() {
    if (!workspace || workspace.readOnly || projectSummaries.length <= 1) return setStatus('Keep at least one project in the workspace')
    if (!await appConfirm(`Move “${project.title}” to recovery trash? It can be restored later.`, { title: 'Move project to Trash', confirmLabel: 'Move to Trash' })) return
    try { await saveProject({ ...project, updatedAt: new Date().toISOString() }); await trashProject(project.id); const remaining = projectSummaries.filter((entry) => entry.id !== project.id); setProjectSummaries(remaining); setTrashedProjects(await listTrashedProjects()); await openProject(remaining[0].id) } catch (error) { setStatus(`Project was not deleted: ${String(error)}`) }
  }

  async function restoreProjectFromTrash(id: string) {
    try { await restoreTrashedProject(id); setTrashedProjects(await listTrashedProjects()); setProjectSummaries(await listProjects()); setStatus('Project restored from recovery trash') } catch (error) { setStatus(`Could not restore project: ${String(error)}`) }
  }

  function boardMutationContextIsCurrent() {
    const permission = inspectorPermissionRef.current
    return activeBoardIdRef.current === activeBoardId
      && projectRef.current.id === inspectorMutationContext.projectId
      && inspectorProjectScopeRef.current.revision === inspectorMutationContext.projectRevision
      && permission.workspaceRoot === inspectorMutationContext.workspaceRoot
      && permission.revision === inspectorMutationContext.permissionRevision
  }

  function applyBoardChange(nextBoard: BoardModel, historyBase?: BoardModel | null, mergeKey?: string) {
    if (!boardMutationContextIsCurrent()) { setStatus('The board or workspace changed; retry the command.'); return false }
    const currentBoard = projectRef.current.boards.find((board) => board.id === activeBoardId) || projectRef.current.boards[0]
    nextBoard = reconcileLayoutGuides(currentBoard, nextBoard)
    const contained = safeFrameEdit(currentBoard, nextBoard)
    if (!contained.ok) { setStatus(contained.message); return false }
    nextBoard = contained.board
    const result = validateBoardMutation(currentBoard, nextBoard, inspectorPermissionRef.current.readOnly)
    if (!result.ok || nextBoard.id !== currentBoard.id) { setStatus(!result.ok ? result.issues[0]?.detail || 'The board command was cancelled.' : 'The active board changed; retry the command.'); return false }
    // React can replay state updater functions. Record the command once at the
    // event boundary so two distinct field edits require exactly two Undos.
    if (historyBase !== null) recordNativeCommand(boardUndoRef.current, boardRedoRef.current, historyBase || currentBoard, nextBoard, mergeKey)
    setProject((current) => {
      return { ...current, boards: current.boards.map((board) => board.id === activeBoardId ? nextBoard : board) }
    })
    return true
  }

  function updateInspectedNode(nodeId: string, patch: Partial<BoardNode>) {
    if (viewBoardId || !canMutateInspectorProject() || !boardMutationContextIsCurrent()) return false
    const before = projectRef.current.boards.find((entry) => entry.id === activeBoardId)
    if (!before) return false
    let result = patchBoardNode(before, nodeId, patch, inspectorPermissionRef.current.readOnly, fitEditableVectorPathNode)
    if (result.ok && patch.width !== undefined && ['responsive', 'minimum-height'].includes(result.value.nodes.find((entry) => entry.id === nodeId)?.columnImageSizing || '')) {
      result = layoutBoardColumnsForNodesResult(result.value, [nodeId])
    }
    if (!result.ok) { setStatus(result.issues[0]?.detail || 'The edit was cancelled.'); return false }
    return applyBoardChange(result.value)
  }

  function setColumnImageSizing(nodeId: string, sizing: NonNullable<BoardNode['columnImageSizing']>) {
    if (viewBoardId || !canMutateInspectorProject() || !boardMutationContextIsCurrent()) return false
    const before = projectRef.current.boards.find((entry) => entry.id === activeBoardId)
    if (!before) return false
    const result = setColumnImageSizingResult(before, nodeId, sizing, inspectorPermissionRef.current.readOnly)
    if (!result.ok) { setStatus(result.issues[0]?.detail || 'Column layout could not be changed.'); return false }
    if (result.value === before) return true
    if (!applyBoardChange(result.value)) return false
    setStatus(`Column image sizing: ${sizing === 'responsive' ? 'Responsive' : 'Minimum height'}. Ctrl+Z restores its previous layout.`)
    return true
  }

  async function fitImageBounds(nodeId: string) {
    const before = projectRef.current.boards.find((entry) => entry.id === activeBoardId)
    const node = before?.nodes.find((entry) => entry.id === nodeId)
    if (!before || !node || viewBoardId || !canMutateInspectorProject() || !boardMutationContextIsCurrent()) return
    const block = vectorEditBlockReason(before.nodes, nodeId)
    if (block) return setStatus(block)
    const asset = projectRef.current.assets.find((entry) => entry.id === node.assetId)
    const sourcePath = asset?.status === 'moved' ? asset.managedRelativePath || asset.relativePath : asset?.relativePath
    const source = asset ? workspaceAssetUrl(workspace?.root, sourcePath) : node.body?.startsWith('data:image/') ? node.body : undefined
    try {
      const dimensions = await readImageDimensions(asset, source)
      if (!canMutateInspectorProject() || !boardMutationContextIsCurrent()
        || projectRef.current.boards.find((entry) => entry.id === before.id) !== before
        || (asset && projectRef.current.assets.find((entry) => entry.id === asset.id) !== asset)) {
        return setStatus('The image or board changed; retry fitting its bounds.')
      }
      const result = planTightImageBounds(node, dimensions)
      if (!result.ok) return setStatus(result.detail)
      if (node.parentColumnId) return setStatus('Move the image out of its column before fitting bounds; the column controls its layout.')
      if ((['x', 'y', 'width', 'height'] as const).every((key) => Math.abs(node[key] - result.bounds[key]) < 1e-8)) return setStatus('Image bounds already match the artwork.')
      const patched = patchBoardNode(before, nodeId, result.bounds)
      if (!patched.ok) return setStatus(patched.issues[0]?.detail || 'The image bounds could not be changed.')
      if (applyBoardChange(patched.value)) setStatus('Image bounds fitted around the artwork. Ctrl+Z restores the previous frame.')
    } catch (error) { setStatus('Could not read image dimensions: ' + String(error)) }
  }

  function addGeneratedAssetToBoard(asset: ProjectAsset, node: BoardNode) {
    if (viewBoardId || !canMutateInspectorProject() || !boardMutationContextIsCurrent()) return false
    const before = projectRef.current.boards.find((entry) => entry.id === activeBoardId)
    if (!before || !applyBoardChange({ ...before, nodes: [...before.nodes, node] })) return false
    setProject((current) => ({ ...current, assets: current.assets.some((entry) => entry.id === asset.id) ? current.assets : [...current.assets, asset] }))
    return true
  }

  function moveBoardSelection(sourceId: string, destinationId: string, ids: string[]) {
    if (!boardMutationContextIsCurrent()) { setStatus('The board or workspace changed; retry the move.'); return false }
    const before = projectRef.current
    if (sourceId !== activeBoardId) { setStatus('The active board changed; retry the move.'); return false }
    const result = transferBoardSelection(before, sourceId, destinationId, ids, { readOnly: inspectorPermissionRef.current.readOnly })
    if (!result.ok) { setStatus(result.issues[0]?.detail || 'The move was cancelled.'); return false }
    const oldBoard = before.boards.find((board) => board.id === sourceId)!, newBoard = result.value.project.boards.find((board) => board.id === sourceId)!
    recordNativeCommand(boardUndoRef.current, boardRedoRef.current, oldBoard, newBoard)
    graphHistoryRef.current.set(boardUndoRef.current.at(-1)!, { before: before.boards, after: result.value.project.boards })
    setProject(result.value.project)
    setStatus('Moved ' + result.value.movedIds.length + ' objects to ' + before.boards.find((board) => board.id === destinationId)!.title + '; ' + result.value.detachedConnectorIds.length + ' boundary connections remain here. Undo restores the complete move.')
    return true
  }

  function saveDiagramTemplate(template: DiagramTemplate) {
    if (workspace?.readOnly || viewBoardId || !validateDiagramTemplate(template)) { setStatus('The template could not be saved in this workspace.'); return false }
    const before = projectRef.current, templates = before.diagramTemplates || []
    if (templates.some((entry) => entry.id === template.id)) { setStatus('A template with this identity already exists.'); return false }
    const after = [...templates, structuredClone(template)], board = before.boards.find((entry) => entry.id === activeBoardId)!
    recordNativeCommand(boardUndoRef.current, boardRedoRef.current, board, board)
    graphHistoryRef.current.set(boardUndoRef.current.at(-1)!, { before: before.boards, after: before.boards, templates: { before: before.diagramTemplates, after } })
    setProject({ ...before, diagramTemplates: after }); setStatus('Saved local diagram template ' + template.title); return true
  }

  function undoBoard() {
    if (!boardMutationContextIsCurrent()) { setStatus('The board or workspace changed; retry the history command.'); return false }
    if (inspectorPermissionRef.current.readOnly) return setStatus('This workspace is read-only')
    const graph = graphHistoryRef.current.get(boardUndoRef.current.at(-1)!)
    const previous = undoNativeCommand(boardUndoRef.current, boardRedoRef.current)
    if (!previous) return setStatus('Nothing to undo on the board')
    setProject((current) => {
      return { ...current, boards: graph ? graph.before : current.boards.map((board) => board.id === activeBoardId ? previous : board), ...(graph?.templates ? { diagramTemplates: graph.templates.before } : {}) }
    })
    setStatus('Board change undone')
  }

  function redoBoard() {
    if (!boardMutationContextIsCurrent()) { setStatus('The board or workspace changed; retry the history command.'); return false }
    if (inspectorPermissionRef.current.readOnly) return setStatus('This workspace is read-only')
    const graph = graphHistoryRef.current.get(boardRedoRef.current.at(-1)!)
    const next = redoNativeCommand(boardUndoRef.current, boardRedoRef.current)
    if (!next) return setStatus('Nothing to redo on the board')
    setProject((current) => {
      return { ...current, boards: graph ? graph.after : current.boards.map((board) => board.id === activeBoardId ? next : board), ...(graph?.templates ? { diagramTemplates: graph.templates.after } : {}) }
    })
    setStatus('Board change restored')
  }

  function undoActiveEditor() {
    if (inspectorPermissionRef.current.readOnly) return
    if (effectiveHistoryOwner === 'canvas') undoBoard()
    else if (effectiveHistoryOwner === 'document') controlsForDocument(activeDocument.id).current?.undo()
  }

  function redoActiveEditor() {
    if (inspectorPermissionRef.current.readOnly) return
    if (effectiveHistoryOwner === 'canvas') redoBoard()
    else if (effectiveHistoryOwner === 'document') controlsForDocument(activeDocument.id).current?.redo()
  }

  useEffect(() => {
    if (mode === 'document') { setActiveEditor('document'); setHistoryOwner(activeDocument.id === QUESTIONNAIRE_DOCUMENT_ID ? 'none' : 'document') }
    if (mode === 'canvas') { setActiveEditor('canvas'); setHistoryOwner('canvas') }
  }, [mode, activeDocument.id, documentSessionRevision])

  function startDividerDrag(event: React.PointerEvent<HTMLButtonElement>) {
    const workbench = workbenchRef.current
    if (!workbench) return
    event.currentTarget.setPointerCapture(event.pointerId)
    const move = (pointerEvent: PointerEvent) => {
      const bounds = workbench.getBoundingClientRect()
      const next = ((pointerEvent.clientX - bounds.left) / bounds.width) * 100
      if (next <= 8) return changeMode('canvas')
      if (next >= 92) return changeMode('document')
      const minimum = 460 / bounds.width * 100
      const maximum = (1 - 380 / bounds.width) * 100
      setSplit(Math.max(minimum, Math.min(maximum, next)))
    }
    const finish = () => {
      window.removeEventListener('pointermove', move)
      window.removeEventListener('pointerup', finish)
    }
    window.addEventListener('pointermove', move)
    window.addEventListener('pointerup', finish, { once: true })
  }

  function adjustDividerWithKeyboard(event: React.KeyboardEvent<HTMLButtonElement>) {
    if (event.key !== 'ArrowLeft' && event.key !== 'ArrowRight') return
    event.preventDefault()
    const width = workbenchRef.current?.getBoundingClientRect().width || workbenchWidth
    if (width < 940) return
    const minimum = 460 / width * 100
    const maximum = (1 - 380 / width) * 100
    setSplit(Math.max(minimum, Math.min(maximum, effectiveSplit + (event.key === 'ArrowRight' ? 5 : -5))))
  }

  async function importAssets(kind: AssetKind) {
    if (!workspace) {
      setStatus('Asset import is available in the native desktop window')
      return
    }
    if (workspace.readOnly) {
      setStatus('This portable workspace is read-only')
      return
    }
    const filters = kind === 'image'
      ? [{ name: 'Images', extensions: ['avif', 'bmp', 'gif', 'heic', 'jpeg', 'jpg', 'png', 'svg', 'tif', 'tiff', 'webp'] }]
      : kind === 'video'
        ? [{ name: 'Video', extensions: ['avi', 'm4v', 'mkv', 'mov', 'mp4', 'mpeg', 'mpg', 'webm'] }]
        : kind === 'model'
          ? [{ name: '3D models', extensions: ['blend', 'glb', 'gltf', 'obj', 'ztl', 'zpr'] }]
        : [{ name: 'Documents', extensions: ['ai', 'doc', 'docx', 'epub', 'htm', 'html', 'markdown', 'md', 'odt', 'pdf', 'psd', 'rtf', 'txt'] }]
    try {
      const selection = await open({ multiple: true, directory: false, filters })
      const paths = selection ? (Array.isArray(selection) ? selection : [selection]) : []
      if (!paths.length) return
      await importAssetPaths(paths)
    } catch (error) {
      setStatus(`Import failed: ${String(error)}`)
    }
  }

  async function importAssetPaths(paths: string[], placement?: { x: number; y: number }) {
    if (!workspace) return setStatus('Drop import is available in the native desktop window')
    if (workspace.readOnly) return setStatus('This portable workspace is read-only')
    const imported: Array<Awaited<ReturnType<typeof importProjectAsset>> & { dependencies?: ProjectAsset['dependencies'] }> = []
    const failures: string[] = []
    const targetBoard = activeBoard
    const importingProject = projectRef.current
    try {
      // Import sequentially so a large batch does not make multiple multi-gigabyte
      // files compete for disk bandwidth at once. Rust streams each file in 64 KB chunks.
      for (const [index, sourcePath] of paths.entries()) {
        setStatus(`Importing ${index + 1} of ${paths.length} from disk…`)
        try {
          const extension = sourcePath.split('.').at(-1)?.toLowerCase()
          if (extension && ['glb', 'gltf', 'obj'].includes(extension)) {
            const bundle = await importModelBundle(project.id, sourcePath)
            const record = bundle.asset as Awaited<ReturnType<typeof importProjectAsset>> & { dependencies?: ProjectAsset['dependencies'] }
            record.dependencies = [...bundle.dependencies.map((uri) => ({ uri, status: 'available' as const })), ...bundle.missingDependencies.map((uri) => ({ uri, status: 'missing' as const }))]
            imported.push(record)
          } else imported.push(await importProjectAsset(project.id, sourcePath))
        } catch (error) {
          failures.push(`${sourcePath}: ${String(error)}`)
        }
      }
      if (!imported.length) throw new Error(failures[0] || 'No files could be imported')
      const assets: ProjectAsset[] = imported.map((asset) => ({ ...managedAsset(asset), dependencies: asset.dependencies }))
      const byId = new Map(project.assets.map((asset) => [asset.id, asset]))
      assets.forEach((asset) => byId.set(asset.id, asset))
      const editableText = new Map<string, string>()
      for (const asset of assets) {
        if (asset.kind === 'document' && ['htm', 'html', 'md', 'markdown', 'txt'].includes(asset.extension)) {
          try {
            editableText.set(asset.id, textAssetHtml(asset.extension, await readTextAsset(project.id, asset.relativePath)))
          } catch (error) {
            failures.push(`${asset.originalName}: editable preview unavailable (${String(error)})`)
          }
        }
      }
      let cursorX = placement?.x ?? 820 + (targetBoard.nodes.length % 3) * 315
      let cursorY = placement?.y ?? 90 + Math.floor(targetBoard.nodes.length / 3) * 250
      let rowHeight = 0
      const imageSizes = new Map<string, { width: number; height: number }>()
      for (const asset of assets.filter((entry) => entry.kind === 'image')) {
        try {
          const dimensions = await readImageDimensions(asset, workspaceAssetUrl(workspace.root, asset.relativePath))
          const fitted = fitNaturalImageBounds(dimensions, { width: 280, height: 220 })
          if (fitted) imageSizes.set(asset.id, fitted)
          else failures.push(`${asset.originalName}: original dimensions unavailable; kept in Mini Bridge without an incorrect canvas frame`)
        } catch (error) { failures.push(`${asset.originalName}: ${String(error)}; kept in Mini Bridge`) }
      }
      if (!canMutateInspectorProject() || !boardMutationContextIsCurrent() || projectRef.current !== importingProject) throw new Error('The project changed during import. Original copies remain on disk; no stale board placements were applied.')
      const newNodes = assets.filter((asset) => asset.kind !== 'image' || imageSizes.has(asset.id)).map((asset, index) => {
        const isEditableCapture = editableText.has(asset.id)
        const width = imageSizes.get(asset.id)?.width ?? (isEditableCapture ? 420 : asset.kind === 'model' ? 360 : asset.kind === 'document' ? 260 : 280)
        const height = imageSizes.get(asset.id)?.height ?? (isEditableCapture ? 430 : asset.kind === 'model' ? 300 : asset.kind === 'video' ? 220 : asset.extension === 'pdf' ? 360 : 82)
        if (index > 0 && index % 3 === 0) {
          cursorX = placement?.x ?? 820
          cursorY += rowHeight + 24
          rowHeight = 0
        }
        const node = {
          id: `asset-${crypto.randomUUID()}`,
          kind: isEditableCapture ? 'clip' as const : asset.kind === 'other' || asset.kind === 'font' ? 'document' as const : asset.kind,
          x: Math.round(cursorX - (placement ? width / 2 : 0)),
          y: Math.round(cursorY - (placement ? 28 : 0)),
          width,
          height,
          title: asset.displayName,
          body: `${formatBytes(asset.byteLength)} · Portable original`,
          assetId: asset.id,
          ...(asset.kind === 'image' ? { imagePresentation: 'artwork' as const } : {}),
          ...(isEditableCapture ? { captured: { ...emptyCapture('local-document'), sourceLabel: 'Local document', articleHtml: editableText.get(asset.id)! } } : {}),
        }
        cursorX += 304
        rowHeight = Math.max(rowHeight, height)
        return node
      })
      const boardWithNodes = { ...targetBoard, nodes: [...targetBoard.nodes, ...newNodes] }
      const droppedIds = newNodes.map((node) => node.id)
      const dropTarget = placement ? findColumnDropTargetResult(boardWithNodes, placement.x, placement.y, new Set(droppedIds)) : { ok: true as const, value: null }
      const arrangement = dropTarget.ok && dropTarget.value ? insertNodesIntoColumnResult(boardWithNodes, droppedIds, dropTarget.value) : dropTarget.ok ? { ok: true as const, value: boardWithNodes } : dropTarget
      if (!arrangement.ok) {
        // Already imported source copies remain discoverable in Mini Bridge.
        const catalogProject = { ...project, assets: [...byId.values()], updatedAt: new Date().toISOString() }
        await saveProject(catalogProject)
        if (!canMutateInspectorProject() || !boardMutationContextIsCurrent() || projectRef.current !== importingProject) return setStatus('Imports saved to their project catalog; the current workspace changed during saving.')
        setProject(catalogProject)
        setStatus(`Imported to Mini Bridge. ${arrangement.issues[0]?.detail || 'The board drop was cancelled.'}`)
        return
      }
      const arrangedBoard = arrangement.value
      const nextProject = {
        ...project,
        assets: [...byId.values()],
        boards: project.boards.map((board) => board.id === targetBoard.id ? arrangedBoard : board),
        updatedAt: new Date().toISOString(),
      }
      await saveProject(nextProject)
      if (!canMutateInspectorProject() || !boardMutationContextIsCurrent() || projectRef.current !== importingProject) return setStatus('Imports saved to their project; the current view changed during saving.')
      if (newNodes.length) recordNativeCommand(boardUndoRef.current, boardRedoRef.current, targetBoard, arrangedBoard)
      setProject(nextProject)
      const duplicateCount = imported.filter((asset) => asset.deduplicated).length
      setStatus(`${newNodes.length} file${newNodes.length === 1 ? '' : 's'} placed on ${targetBoard.title}${duplicateCount ? ` · ${duplicateCount} already stored` : ''}${failures.length ? ` · ${failures.length} issues; remaining imports kept in Mini Bridge` : ''}`)
    } catch (error) {
      setStatus(`Import failed: ${String(error)}`)
    }
  }

  async function importInspectorImagePaths(paths: string[], context = inspectorMutationContext) {
    if (!context.workspaceRoot) return setStatus('Inspector image import is available in the native desktop window')
    if (!canMutateInspectorProject(context)) return setStatus('This portable workspace is read-only or the project changed')
    const sourcePath = paths.find((path) => /\.(avif|bmp|gif|heic|jpe?g|png|svg|tiff?|webp)$/i.test(path))
    if (!sourcePath) return setStatus('Drop an image file into the inspector image slot')
    try {
      setStatus('Importing inspector image from disk…')
      const record = await importProjectAsset(context.projectId, sourcePath)
      if (!canMutateInspectorProject(context)) return setStatus('Inspector image import cancelled because the project or workspace permissions changed')
      const image = managedAsset(record)
      if (image.kind !== 'image') throw new Error('The selected file is not a supported image')
      setProject((current) => {
        if (!canMutateInspectorProject(context) || current.id !== context.projectId) return current
        const assets = current.assets.some((asset) => asset.id === image.id)
          ? current.assets.map((asset) => asset.id === image.id ? image : asset)
          : [...current.assets, image]
        return { ...current, assets, inspectorImageAssetId: image.id, updatedAt: new Date().toISOString() }
      })
      setStatus(image.displayName + ' added to the inspector')
    } catch (error) {
      if (!canMutateInspectorProject(context)) return setStatus('Inspector image import cancelled because the project or workspace permissions changed')
      setStatus('Inspector image import failed: ' + String(error))
    }
  }

  async function browseInspectorImage() {
    const context = inspectorMutationContext
    if (!context.workspaceRoot) return setStatus('Inspector image import is available in the native desktop window')
    if (!canMutateInspectorProject(context)) return setStatus('This portable workspace is read-only or the project changed')
    try {
      const selection = await open({
        multiple: false,
        directory: false,
        filters: [{ name: 'Images', extensions: ['avif', 'bmp', 'gif', 'heic', 'jpeg', 'jpg', 'png', 'svg', 'tif', 'tiff', 'webp'] }],
      })
      if (!canMutateInspectorProject(context)) return setStatus('Inspector image selection cancelled because the project or workspace permissions changed')
      if (typeof selection === 'string') await importInspectorImagePaths([selection], context)
    } catch (error) {
      if (!canMutateInspectorProject(context)) return setStatus('Inspector image selection cancelled because the project or workspace permissions changed')
      setStatus('Inspector image selection failed: ' + String(error))
    }
  }

  async function saveNow() {
    if (!workspace || workspace.readOnly) return setStatus('Nothing saved — workspace is unavailable or read-only')
    try {
      await saveProject({ ...project, updatedAt: new Date().toISOString() })
      if(projectRef.current===project)setSavePending(false)
      setStatus('Project saved with recovery backup')
    } catch (error) {
      setStatus(`Save failed: ${String(error)}`)
    }
  }

  

  

  

  async function relinkAsset(asset: ProjectAsset) {
    if (!workspace || workspace.readOnly) return setStatus('Relinking requires a writable native workspace')
    const selection = await open({
      multiple: false,
      directory: false,
      filters: [{ name: `${asset.kind} replacement`, extensions: [asset.extension] }],
    })
    if (!selection || Array.isArray(selection)) return
    try {
      setStatus(`Relinking ${asset.displayName}…`)
      const imported = managedAsset(await importProjectAsset(project.id, selection))
      const replacement: ProjectAsset = {
        ...imported,
        displayName: asset.displayName,
        virtualFolder: asset.virtualFolder,
        aliases: [...new Set([...asset.aliases, asset.originalName])],
      }
      const nextProject = {
        ...remapProjectAssetReferences(project, new Map([[asset.id, replacement.id]])),
        assets: project.assets.map((entry) => entry.id === asset.id ? replacement : entry),
        updatedAt: new Date().toISOString(),
      }
      await saveProject(nextProject)
      setProject(nextProject)
      setStatus(`Relinked ${asset.displayName}`)
    } catch (error) {
      setStatus(`Relink failed: ${String(error)}`)
    }
  }

  async function relinkAssets(assets: ProjectAsset[]) {
    if (!workspace || workspace.readOnly || !assets.length) return setStatus('Batch relinking requires selected missing files in a writable workspace')
    const selection = await open({ multiple: true, directory: false })
    const paths = selection ? (Array.isArray(selection) ? selection : [selection]) : []
    if (!paths.length) return
    const chosenByName = new Map(paths.map((path) => [path.replace(/^.*[\\/]/, '').toLocaleLowerCase(), path]))
    const replacements = new Map<string, ProjectAsset>()
    const unmatched: string[] = []
    setStatus(`Relinking ${assets.length} selected assets…`)
    try {
      for (const asset of assets) {
        const sourcePath = chosenByName.get(asset.originalName.toLocaleLowerCase())
        if (!sourcePath) {
          unmatched.push(asset.displayName)
          continue
        }
        const imported = managedAsset(await importProjectAsset(project.id, sourcePath))
        replacements.set(asset.id, { ...imported, displayName: asset.displayName, virtualFolder: asset.virtualFolder, aliases: [...new Set([...asset.aliases, asset.originalName])] })
      }
      if (!replacements.size) return setStatus('No replacement filenames matched the selected missing assets')
      const nextProject: ProjectModel = {
        ...remapProjectAssetReferences(project, new Map([...replacements.entries()].map(([assetId, replacement]) => [assetId, replacement.id]))),
        assets: project.assets.map((asset) => replacements.get(asset.id) || asset),
        updatedAt: new Date().toISOString(),
      }
      await saveProject(nextProject)
      setProject(nextProject)
      setStatus(`Relinked ${replacements.size} asset${replacements.size === 1 ? '' : 's'}${unmatched.length ? ` · ${unmatched.length} unmatched` : ''}`)
    } catch (error) {
      setStatus(`Batch relink failed safely: ${String(error)}`)
    }
  }

  async function revealAsset(asset: ProjectAsset) {
    if (!workspace) return setStatus('Reveal is available in the native desktop window')
    const revealPath = asset.managedRelativePath || asset.relativePath
    const absolute = `${workspace.root.replace(/[\\/]+$/, '')}\\${revealPath.replaceAll('/', '\\')}`
    try {
      await revealItemInDir(absolute)
      setStatus(`Revealed ${asset.displayName}`)
    } catch (error) {
      setStatus(`Could not reveal file: ${String(error)}`)
    }
  }

  async function launchAsset(asset: ProjectAsset, applicationPath: string) {
    if (!workspace) return setStatus('Launch is available in the native desktop window')
    const relativePath = asset.managedRelativePath || asset.relativePath
    const absolute = `${workspace.root.replace(/[\\/]+$/, '')}\\${relativePath.replaceAll('/', '\\')}`
    try {
      await openAssetWith(applicationPath, absolute)
      setStatus(`Opened ${asset.displayName}`)
    } catch (error) { setStatus(`Could not open file: ${String(error)}`) }
  }

  async function openRecovery() {
    setShowRecovery(true)
    try { setRecoveryEntries(await listRecoveryEntries(project.id)) } catch (error) { setStatus(`Recovery index unavailable: ${String(error)}`) }
  }

  async function materializeAssets(assets: ProjectAsset[]) {
    if (!workspace || workspace.readOnly) {
      setStatus('Syncing disk names requires a writable native workspace')
      return
    }
    const applied: Awaited<ReturnType<typeof materializeProjectAsset>>[] = []
    try {
      const previewEntries = await previewManagedAssets(project.id, assets)
      const preview = previewEntries.map((entry) => {
        const asset = assets.find((candidate) => candidate.id === entry.id)
        const current = asset?.managedRelativePath
        return `${current || '(new managed link)'}  →  ${entry.managedRelativePath}`
      }).join('\n')
      if (!await appConfirm(`Sync ${assets.length} managed disk name${assets.length === 1 ? '' : 's'}?\n\n${preview}\n\nCollisions have already been resolved in this preview. Immutable originals will not be renamed.`, { title: 'Sync managed disk names', confirmLabel: 'Sync names' })) return
      setStatus(`Syncing ${assets.length} managed disk name${assets.length === 1 ? '' : 's'}…`)
      for (const asset of assets) applied.push(await materializeProjectAsset(project.id, asset))
      const paths = new Map(applied.map((entry) => [entry.id, entry.managedRelativePath]))
      const rollback = applied.map((entry) => ({ id: entry.id, currentRelativePath: entry.managedRelativePath, previousRelativePath: assets.find((asset) => asset.id === entry.id)?.managedRelativePath }))
      await saveProjectJournal(project.id, 'managed-names-latest', {
        transactionId: crypto.randomUUID(), createdAt: new Date().toISOString(), status: 'applied', entries: rollback,
      })
      setManagedRollback(rollback)
      setProject((current) => ({ ...current, assets: current.assets.map((asset) => paths.has(asset.id) ? { ...asset, managedRelativePath: paths.get(asset.id) } : asset) }))
      setStatus(`${assets.length} zero-copy disk name${assets.length === 1 ? '' : 's'} synced`)
    } catch (error) {
      if (applied.length) {
        const rollback = applied.map((entry) => ({ id: entry.id, currentRelativePath: entry.managedRelativePath, previousRelativePath: assets.find((asset) => asset.id === entry.id)?.managedRelativePath }))
        try {
          await rollbackManagedAssets(project.id, rollback)
          await saveProjectJournal(project.id, 'managed-names-latest', { failedAt: new Date().toISOString(), status: 'failed-and-rolled-back', error: String(error), entries: rollback })
          setStatus(`Disk-name sync failed and was rolled back: ${String(error)}`)
        } catch (rollbackError) { setStatus(`Disk-name sync failed; rollback needs attention: ${String(rollbackError)}`) }
      } else setStatus(`Disk-name sync failed: ${String(error)}`)
    }
  }

  async function undoManagedSync() {
    if (!managedRollback?.length) return
    try {
      await rollbackManagedAssets(project.id, managedRollback)
      await saveProjectJournal(project.id, 'managed-names-latest', {
        rolledBackAt: new Date().toISOString(), status: 'rolled-back', entries: managedRollback,
      })
      const previous = new Map(managedRollback.map((entry) => [entry.id, entry.previousRelativePath]))
      setProject((current) => ({ ...current, assets: current.assets.map((asset) => previous.has(asset.id) ? { ...asset, managedRelativePath: previous.get(asset.id) } : asset) }))
      setManagedRollback(null)
      setStatus('Managed disk-name sync rolled back')
    } catch (error) { setStatus(`Rollback stopped safely: ${String(error)}`) }
  }

  async function collectActiveProject() {
    if (!workspace || workspace.readOnly) return setStatus('Project collection requires a writable native workspace')
    const destination = await open({ multiple: false, directory: true })
    if (!destination || Array.isArray(destination)) return
    try {
      await saveProject({ ...project, updatedAt: new Date().toISOString() })
      setStatus('Collecting complete project…')
      const result = await collectProject(project.id, destination)
      setStatus(`Collected project to ${result.relativePath}`)
    } catch (error) {
      setStatus(`Project collection failed safely: ${String(error)}`)
    }
  }

  async function repairDependencies(asset: ProjectAsset) {
    const missing = asset.dependencies?.filter((dependency) => dependency.status === 'missing').map((dependency) => dependency.uri) || []
    if (!workspace || !missing.length) return
    const folder = await open({ multiple: false, directory: true })
    if (!folder || Array.isArray(folder)) return
    try {
      const remaining = await repairModelBundle(project.id, asset.relativePath, folder, missing)
      const remainingSet = new Set(remaining)
      setProject((current) => ({ ...current, assets: current.assets.map((entry) => entry.id === asset.id ? { ...entry, dependencies: entry.dependencies?.map((dependency) => remainingSet.has(dependency.uri) ? dependency : { ...dependency, status: 'available' }) } : entry) }))
      setStatus(remaining.length ? `Repaired ${missing.length - remaining.length}; ${remaining.length} dependencies still missing` : `All dependencies repaired for ${asset.displayName}`)
    } catch (error) { setStatus(`Dependency repair failed safely: ${String(error)}`) }
  }

  async function createNavigatorItem(kind: 'document' | 'board') {
    const context = inspectorMutationContext
    const sessionRevision = documentSessionRevision
    const canCreate = (current = projectRef.current) => canMutateInspectorProject(context)
      && documentSessionRevisionRef.current === sessionRevision && current.id === context.projectId
    if (!canCreate()) return setStatus('Creation is unavailable because the project or workspace permissions changed')
    const before = projectRef.current
    const id = `${kind}-${crypto.randomUUID()}`
    const title = `Untitled ${kind} ${(kind === 'document' ? before.documents.length : before.boards.length) + 1}`
    if (kind === 'document') {
      const document: ProjectDocument = { id, title, layout: structuredClone(DEFAULT_DOCUMENT_LAYOUT), content: { type: 'doc', content: [{ type: 'heading', attrs: { level: 1 }, content: [{ type: 'text', text: title }] }, { type: 'paragraph', content: [{ type: 'text', text: 'Start writing here…' }] }] } }
      setProject((current) => canCreate(current) ? { ...current, documents: [...current.documents, document] } : current)
      setActiveDocumentId((current) => canCreate() ? id : current)
      setActiveNavigatorItem((current) => canCreate() ? `document:${id}` : current)
      clearDocumentFocusWriting(false)
      setMode((current) => canCreate() ? 'document' : current)
      setActiveEditor((current) => canCreate() ? 'document' : current)
      setHistoryOwner((current) => canCreate() ? 'document' : current)
    } else {
      const board: BoardModel = { id, title, linkedFolderPath: managedBoardFolderPath(context.projectId, id), viewport: { x: 28, y: 28, scale: .82 }, nodes: [], connectors: [] }
      try { if ('__TAURI_INTERNALS__' in window) await ensureManagedBoardFolders({ ...before, boards: [...before.boards, board] }) }
      catch (error) { return setStatus(`Could not create the board disk folder: ${String(error)}`) }
      if (!canCreate()) return setStatus('Board creation cancelled because the project or workspace permissions changed; its prepared folder was not applied to this view')
      setProject((current) => canCreate(current) ? { ...current, boards: [...current.boards, board] } : current)
      setActiveBoardId((current) => canCreate() ? id : current)
      setActiveNavigatorItem((current) => canCreate() ? `board:${id}` : current)
      boardUndoRef.current = []
      boardRedoRef.current = []
      clearDocumentFocusWriting(false)
      setMode((current) => canCreate() ? 'split' : current)
      setActiveEditor((current) => canCreate() ? 'canvas' : current)
      setHistoryOwner((current) => canCreate() ? 'canvas' : current)
    }
    setShowNewItemMenu((current) => canCreate() ? false : current)
  }

  async function renameNavigatorItem(kind: 'document' | 'board', id: string, currentTitle: string) {
    const context = inspectorMutationContext
    const sessionRevision = documentSessionRevision
    const target = kind === 'document' ? project.documents.find((document) => document.id === id) : project.boards.find((board) => board.id === id)
    const canRename = (current = projectRef.current) => Boolean(target && target.title === currentTitle
      && canMutateInspectorProject(context) && documentSessionRevisionRef.current === sessionRevision && current.id === context.projectId
      && (kind === 'document' ? current.documents.find((document) => document.id === id) : current.boards.find((board) => board.id === id)) === target)
    if (!canRename()) return setStatus('Rename is unavailable because the project, item, or workspace permissions changed')
    const title = (await requestText({ title: `Rename ${kind}`, label: `${kind === 'document' ? 'Document' : 'Board'} title`, initialValue: currentTitle }))?.trim()
    if (!title || title === currentTitle) return
    if (!canRename()) return setStatus('Rename cancelled because the project, item, or workspace permissions changed')
    setProject((current) => {
      if (!canRename(current)) return current
      return kind === 'document'
        ? { ...current, documents: current.documents.map((document) => document.id === id ? { ...document, title } : document) }
        : { ...current, boards: current.boards.map((board) => board.id === id ? { ...board, title } : board) }
    })
    setStatus(`${kind === 'document' ? 'Document' : 'Board'} renamed`)
  }

  async function renameProject() {
    const context = inspectorMutationContext
    const sessionRevision = documentSessionRevision
    const currentTitle = project.title
    const canRename = () => canMutateInspectorProject(context) && documentSessionRevisionRef.current === sessionRevision
    if (!canRename()) return setStatus('Rename is unavailable because the project or workspace permissions changed')
    const title = (await requestText({ title: 'Rename project', label: 'Project title', initialValue: currentTitle }))?.trim()
    if (!title || title === currentTitle) return
    if (!canRename() || projectRef.current.title !== currentTitle) return setStatus('Rename cancelled because the project title or workspace permissions changed')
    setProject((current) => canRename() && current.id === context.projectId && current.title === currentTitle ? { ...current, title } : current)
    setProjectSummaries((current) => canRename() && (projectRef.current.title === currentTitle || projectRef.current.title === title)
      ? current.map((entry) => entry.id === context.projectId ? { ...entry, title } : entry) : current)
    setStatus(`Renamed project to ${title}`)
  }

  function switchBoard(boardId: string, recordVisit = true) {
    if (boardId === activeBoardId) return
    if (recordVisit) {
      boardBackRef.current.push(activeBoardId)
      boardForwardRef.current = []
    }
    setActiveBoardId(boardId)
    setActiveNavigatorItem(`board:${boardId}`)
    boardUndoRef.current = []
    boardRedoRef.current = []
    setStatus(`Opened ${project.boards.find((board) => board.id === boardId)?.title || 'board'}`)
  }

  function navigateBoardHistory(direction: 'back' | 'forward') {
    const source = direction === 'back' ? boardBackRef.current : boardForwardRef.current
    const destination = direction === 'back' ? boardForwardRef.current : boardBackRef.current
    let boardId = source.pop()
    while (boardId && !project.boards.some((board) => board.id === boardId)) boardId = source.pop()
    if (!boardId) return
    destination.push(activeBoardId)
    switchBoard(boardId, false)
  }

  async function createNestedBoardInActive(position?: { x: number; y: number }) {
    const context = inspectorMutationContext
    const sessionRevision = documentSessionRevision
    const parent = activeBoard
    const canCreate = (current = projectRef.current) => canMutateInspectorProject(context)
      && documentSessionRevisionRef.current === sessionRevision && current.id === context.projectId
      && current.boards.find((board) => board.id === parent.id) === parent
    if (!canCreate()) return setStatus('Subboard creation is unavailable because the parent board or workspace permissions changed')
    const title = (await requestText({ title: 'Create subboard', label: 'Subboard title', initialValue: `Untitled board ${projectRef.current.boards.length + 1}` }))?.trim()
    if (!title) return
    if (!canCreate()) return setStatus('Subboard creation cancelled because the project, parent board, or workspace permissions changed')
    const before = projectRef.current
    const result = insertNestedBoard(before, parent.id, title, position)
    if (!result) return
    setProject((current) => canCreate(current) && current === before ? result.project : current)
    setStatus(`Created ${title} on ${parent.title}. Double-click its tile to open it.`)
  }

  async function duplicateBoard(boardId: string) {
    if (workspace?.readOnly) return
    const before = projectRef.current
    const result = duplicateBoardSubtree(before, boardId)
    if (!result) return setStatus('That board could not be duplicated safely')
    try { await ensureManagedBoardFolders(result.project) }
    catch (error) { return setStatus(`Could not create the duplicate's managed folders: ${String(error)}`) }
    if (projectRef.current !== before) return setStatus('The project changed while creating folders; retry duplication. Existing boards are unchanged.')
    setProject(result.project)
    switchBoard(result.boardId)
    setStatus(`Duplicated the board and ${result.boardIds.size - 1} owned subboard(s); disk source links were not reused`)
  }

  function updateBoardTile(boardId: string, update: Pick<BoardModel, 'tileAccentColor' | 'tileIcon' | 'coverAssetId' | 'coverFraming'>) {
    setProject((current) => ({ ...current, boards: current.boards.map((board) => board.id === boardId ? { ...board, ...update } : board) }))
  }

  async function importCoverArtwork(target: 'project' | 'board') {
    const context = inspectorMutationContext
    const targetBoardId = activeBoard.id
    if (!context.workspaceRoot || !canMutateInspectorProject(context)) return setStatus('A writable native workspace is required to import cover artwork')
    try {
      const selected = await open({ multiple: false, directory: false, filters: [{ name: 'Images', extensions: ['avif', 'bmp', 'gif', 'heic', 'jpeg', 'jpg', 'png', 'svg', 'tif', 'tiff', 'webp'] }] })
      if (!canMutateInspectorProject(context)) return setStatus('Cover import cancelled because the project or workspace permissions changed')
      if (!selected || Array.isArray(selected)) return
      setStatus('Importing cover artwork…')
      const record = await importProjectAsset(context.projectId, selected)
      if (!canMutateInspectorProject(context)) return setStatus('Cover import cancelled because the project or workspace permissions changed')
      if (target === 'board' && !projectRef.current.boards.some((board) => board.id === targetBoardId)) return setStatus('Cover import cancelled because the target board was removed')
      const asset = managedAsset(record)
      if (asset.kind !== 'image') return setStatus('The selected file is not a supported image')
      setProject((current) => {
        if (!canMutateInspectorProject(context) || current.id !== context.projectId || (target === 'board' && !current.boards.some((board) => board.id === targetBoardId))) return current
        return { ...current,
          assets: current.assets.some((entry) => entry.id === asset.id) ? current.assets : [...current.assets, asset],
          ...(target === 'project' ? { projectCoverAssetId: asset.id, projectCoverFraming: DEFAULT_COVER_FRAMING } : {
            boards: current.boards.map((board) => board.id === targetBoardId ? { ...board, coverAssetId: asset.id, coverFraming: DEFAULT_COVER_FRAMING } : board),
          }),
        }
      })
      if (target === 'board' && activeBoardIdRef.current === targetBoardId) setShowBoardCoverPicker(true)
      setStatus((target === 'project' ? 'Project' : 'Board') + ' artwork imported without adding a canvas card')
    } catch (error) {
      if (!canMutateInspectorProject(context)) return setStatus('Cover import cancelled because the project or workspace permissions changed')
      setStatus('Could not import cover artwork: ' + String(error))
    }
  }

  function duplicateActiveBoard() { duplicateBoard(activeBoard.id) }

  function duplicateDocument(documentId: string) {
    if (workspace?.readOnly) return
    const source = project.documents.find((entry) => entry.id === documentId)
    if (!source || !isDeletableDocument(source)) return
    const copy = { ...structuredClone(source), id: `document-${crypto.randomUUID()}`, title: `${source.title} copy` }
    setProject((current) => ({ ...current, documents: [...current.documents, copy] }))
    setStatus(`Duplicated “${source.title}”`)
  }

  async function linkBoardFolder(boardId: string) {
    if (workspace?.readOnly) return
    const path = await open({ multiple: false, directory: true })
    if (!path || Array.isArray(path)) return
    setProject((current) => ({ ...current, boards: current.boards.map((board) => board.id === boardId ? { ...board, linkedFolderPath: path } : board) }))
    setStatus('Linked folder for navigation only; no disk files were moved')
  }

  function deleteActiveBoard() {
    void deleteNavigatorBoard(activeBoard.id)
  }

  function reorderBoards(boardIds: string[]) {
    setProject((current) => {
      const byId = new Map(current.boards.map((board) => [board.id, board]))
      const reordered = boardIds.map((id) => byId.get(id)).filter((board): board is BoardModel => Boolean(board))
      return reordered.length === current.boards.length ? { ...current, boards: reordered } : current
    })
    setStatus('Board filmstrip reordered')
  }

  function setBoardCover(assetId?: string, framing?: CoverFraming) {
    setProject((current) => ({ ...current, boards: current.boards.map((board) => board.id === activeBoard.id ? { ...board, coverAssetId: assetId, coverFraming: framing } : board) }))
    setStatus(assetId ? 'Board cover updated' : 'Board image removed; choose an image to assign a new cover')
  }

  function applySemanticClusters(clusters: Array<{ title: string; assetIds: string[] }>, target: 'groups' | 'columns') {
    const proposal = organizeSemanticClusters(activeBoard, clusters, target, project.assets)
    if (!proposal.moved) { setStatus(proposal.warnings[0] || 'No movable references in the selected clusters.'); return }
    if (applyBoardChange(proposal.board)) { changeMode('split'); setStatus('Visual references organized. Sizes and ownership preserved. ' + proposal.warnings.length + ' protected references retained.') }
  }

  async function placeShelfAsset(asset: ProjectAsset) {
    if (viewBoardId || !canMutateInspectorProject() || !boardMutationContextIsCurrent()) return
    if (asset.kind === 'font' || asset.kind === 'other') return setStatus('Open this asset through the asset catalog.')
    const context = inspectorMutationContext
    let bounds = asset.kind === 'image' ? fitNaturalImageBounds(assetIntrinsicSize(asset), {width:320,height:240}) : {width:320,height:asset.kind==='video'?180:240}
    if (asset.kind === 'image' && !bounds) {
      const url = workspaceAssetUrl(workspace?.root, asset.relativePath)
      if (!url) return setStatus('The original image is unavailable for placement.')
      try { bounds = fitNaturalImageBounds(await readImageDimensions(asset, url), {width:320,height:240}) }
      catch(error) { return setStatus('Could not read image dimensions: '+String(error)) }
    }
    if (!bounds || !canMutateInspectorProject(context) || !boardMutationContextIsCurrent()) return
    const target=projectRef.current.boards.find(entry=>entry.id===activeBoardId)
    if(!target)return
    const node:BoardNode={id:'shelf-'+crypto.randomUUID(),kind:asset.kind,assetId:asset.id,title:asset.displayName,
      x:(180-target.viewport.x)/target.viewport.scale,y:(180-target.viewport.y)/target.viewport.scale,...bounds,
      ...(asset.kind==='image'?{imagePresentation:'artwork' as const}:{})}
    if(addGeneratedAssetToBoard(asset,node)){changeMode('split');setStatus(asset.displayName+' added to the canvas. Ctrl+Z removes the placement.')}
  }

  function acceptGeneratedAsset(asset: ProjectAsset, addToBoard: boolean) {
    if (viewBoardId || !canMutateInspectorProject()) return setStatus('The workspace or project changed; generated originals remain on disk.')
    const fitted = fitNaturalImageBounds(assetIntrinsicSize(asset), { width: 280, height: 220 })
    const target = projectRef.current.boards.find((entry) => entry.id === activeBoardId)
    if (addToBoard && fitted && target && boardMutationContextIsCurrent()) {
      const generatedIndex = target.nodes.filter((node) => node.id.startsWith('generated-card-')).length
      const node: BoardNode = {
        id: `generated-card-${crypto.randomUUID()}`, kind: 'image', imagePresentation: 'artwork', assetId: asset.id,
        x: 110 + (generatedIndex % 4) * 304, y: 820 + Math.floor(generatedIndex / 4) * 250,
        ...fitted, title: asset.displayName,
        body: asset.generated?.engine === 'Swin2SR-q4' ? 'Local super-resolution output · disk-backed' : 'APISR FP16 generated output · disk-backed',
        color: '#6ba39b',
      }
      if (addGeneratedAssetToBoard(asset, node)) return setStatus(`${asset.displayName} added with natural image bounds. Ctrl+Z removes the placement.`)
    }
    setProject((current) => current.id !== inspectorMutationContext.projectId || !canMutateInspectorProject() ? current : {
      ...current, assets: current.assets.some((entry) => entry.id === asset.id)
        ? current.assets.map((entry) => entry.id === asset.id ? asset : entry) : [...current.assets, asset],
    })
    setStatus(`${asset.displayName} tracked in Mini Bridge${addToBoard ? ' · board placement unavailable in the current view' : ''}`)
  }

  function openProjectModule(module: 'worksheets' | 'recipes' | 'prompts' | 'references' | 'assets') {
    setActiveNavigatorItem(`module:${module}`)
    if (module === 'worksheets') setShowWorksheets(true)
    if (module === 'recipes') setShowRecipes(true)
    if (module === 'prompts') setShowPromptGenerator(true)
    if (module === 'references') setShowReferenceLibrary(true)
    if (module === 'assets') setShowAssetManager(true)
  }

  async function openAssetManagerWindow() {
    if (!('__TAURI_INTERNALS__' in window)) {
      setStatus('Pop out is only available in the desktop app')
      return
    }
    try {
      await invoke('spawn_mini_bridge', { projectId: project.id, boardId: activeBoard.id })
      setStatus(`Mini Bridge opened for ${activeBoard.title} — it runs in its own process and can be moved to any monitor`)
    } catch (error) {
      void invoke('record_frontend_diagnostic', { message: `mini-bridge.spawn failed: ${String(error)}` }).catch(() => undefined)
      setStatus(`Mini Bridge could not open: ${String(error)}`)
    }
  }

  function closeAssetManager() {
    if (assetManagerProjectId && '__TAURI_INTERNALS__' in window) {
      void getCurrentWindow().close()
      return
    }
    setShowAssetManager(false)
  }

  function openDocumentInProject(documentId: string, nextMode: ViewMode = 'document') {
    setOpenDocumentTabIds(previous => previous.includes(documentId) ? previous : [...previous, documentId])
    setDocumentTabsVisible(true)
    setActiveDocumentId(documentId)
    setActiveNavigatorItem(`document:${documentId}`)
    setActiveEditor('document')
    setHistoryOwner(documentId === QUESTIONNAIRE_DOCUMENT_ID ? 'none' : 'document')
    changeMode(nextMode)
  }

  function closeDocumentTab(documentId: string) {
    const index = currentDocumentTabIds.indexOf(documentId)
    const remaining = currentDocumentTabIds.filter(id => id !== documentId)
    setOpenDocumentTabIds(remaining)
    clearDocumentFocusWriting(false)
    if (!remaining.length) {
      // Keep every retained editor mounted; closing the last view does not delete a document.
      setDocumentTabsVisible(false)
      setHistoryOwner('none')
      return
    }
    if (documentId === activeDocument.id) {
      const nextId = remaining[Math.min(Math.max(index, 0), remaining.length - 1)]
      setActiveDocumentId(nextId)
      setActiveNavigatorItem(`document:${nextId}`)
      setActiveEditor('document')
      setHistoryOwner(nextId === QUESTIONNAIRE_DOCUMENT_ID ? 'none' : 'document')
    }
  }

  function openBoardInProject(boardId: string, nextMode: ViewMode = 'split') {
    switchBoard(boardId)
    setActiveEditor('canvas')
    setHistoryOwner('canvas')
    changeMode(nextMode)
  }

  function captureSearchOrigin(): SearchOriginSnapshot {
    let originTitle = 'Workspace'
    if (mode === 'document') {
      originTitle = activeDocument?.title || 'Document'
    } else if (mode === 'canvas') {
      originTitle = activeBoard?.title || 'Board'
    } else {
      originTitle = activeEditor === 'document' ? (activeDocument?.title || 'Document') : (activeBoard?.title || 'Board')
    }
    let documentView: DocumentWorkspaceViewSnapshot | undefined
    const activeControls = documentControlsRef.current.get(activeDocumentId)
    if (activeControls?.current?.captureView) {
      try {
        documentView = activeControls.current.captureView()
      } catch {
        // Safe capture fallback
      }
    }
    return {
      projectId: project.id,
      mode,
      activeBoardId,
      activeDocumentId,
      activeNavigatorItem,
      activeEditor,
      historyOwner,
      showNavigatorPanel,
      showInspectorPanel,
      canvasSelection: canvasSelection ? { boardId: canvasSelection.boardId, ids: [...canvasSelection.ids] } : null,
      documentView,
      originTitle,
    }
  }

  function returnFromSearch() {
    if (!searchOrigin) return
    const snapshot = searchOrigin
    if (snapshot.projectId !== project.id) {
      setSearchOrigin(null)
      return
    }

    const targetBoard = project.boards.find((b) => b.id === snapshot.activeBoardId)
    const targetDoc = project.documents.find((d) => d.id === snapshot.activeDocumentId)

    if (snapshot.mode === 'canvas' && !targetBoard) {
      setSearchOrigin(null)
      setStatus(`Cannot return: "${snapshot.originTitle}" board is no longer available`)
      return
    }
    if (snapshot.mode === 'document' && !targetDoc) {
      setSearchOrigin(null)
      setStatus(`Cannot return: "${snapshot.originTitle}" document is no longer available`)
      return
    }
    if (snapshot.mode === 'split' && !targetBoard && !targetDoc) {
      setSearchOrigin(null)
      setStatus('Cannot return: origin workspace targets are no longer available')
      return
    }

    if (targetBoard) {
      switchBoard(snapshot.activeBoardId)
      if (snapshot.canvasSelection && snapshot.canvasSelection.boardId === snapshot.activeBoardId) {
        const validIds = snapshot.canvasSelection.ids.filter((id) => targetBoard.nodes.some((node) => node.id === id))
        canvasSelectionByBoard.set(`${project.id}/${snapshot.activeBoardId}`, validIds)
        setCanvasSelection({ boardId: snapshot.activeBoardId, ids: validIds })
      }
    }

    if (targetDoc) {
      setActiveDocumentId(snapshot.activeDocumentId)
      if (snapshot.documentView) {
        const controls = documentControlsRef.current.get(snapshot.activeDocumentId)
        try {
          controls?.current?.restoreView(snapshot.documentView)
        } catch {
          // Safe dismissal if control is in transitional state
        }
      }
    }

    changeMode(snapshot.mode)
    setActiveEditor(snapshot.activeEditor)
    setHistoryOwner(snapshot.historyOwner)
    setShowNavigatorPanel(snapshot.showNavigatorPanel)
    setShowInspectorPanel(snapshot.showInspectorPanel)

    if (snapshot.activeNavigatorItem.startsWith('board:') && targetBoard) {
      setActiveNavigatorItem(snapshot.activeNavigatorItem)
    } else if (snapshot.activeNavigatorItem.startsWith('document:') && targetDoc) {
      setActiveNavigatorItem(snapshot.activeNavigatorItem)
    }

    setSearchOrigin(null)
    setStatus(`Returned to ${snapshot.originTitle}`)
  }

  function updateProjectStatus(nextStatus: ProjectStatus) {
    const context = inspectorMutationContext
    if (!canMutateInspectorProject(context)) return setStatus('This workspace is read-only or the project changed')
    setProject((current) => canMutateInspectorProject(context) && current.id === context.projectId ? { ...current, status: nextStatus } : current)
    setProjectSummaries((current) => canMutateInspectorProject(context) ? current.map((entry) => entry.id === context.projectId ? { ...entry, status: nextStatus } : entry) : current)
    setStatus('Project status set to ' + nextStatus.replace('-', ' '))
  }

  function updateTodayTask(taskId: string, completed: boolean) {
    const context = inspectorMutationContext
    if (!canMutateInspectorProject(context)) return setStatus('This workspace is read-only or the project changed')
    const today = new Date(Date.now() - new Date().getTimezoneOffset() * 60_000).toISOString().slice(0, 10)
    setProject((current) => canMutateInspectorProject(context) && current.id === context.projectId ? {
      ...current,
      worksheets: (current.worksheets || []).map((worksheet) => worksheet.date === today
        ? { ...worksheet, updatedAt: new Date().toISOString(), tasks: worksheet.tasks.map((task) => task.id === taskId ? { ...task, completed } : task) }
        : worksheet),
    } : current)
  }

  function useActiveBoardAsProjectCover() {
    const context = inspectorMutationContext
    if (!canMutateInspectorProject(context)) return setStatus('This workspace is read-only or the project changed')
    const currentProject = projectRef.current
    const board = currentProject.boards.find((entry) => entry.id === activeBoard.id)
    const assetId = board && boardCoverAssetId(currentProject, board)
    if (!assetId) return setStatus('Add an image or set a board cover first')
    setProject((current) => canMutateInspectorProject(context) && current.id === context.projectId ? { ...current, projectCoverAssetId: assetId, projectCoverFraming: board?.coverFraming } : current)
    setStatus('Project cover now follows the active board image')
  }

  function setProjectCover(assetId?: string, framing?: CoverFraming) {
    const context = inspectorMutationContext
    if (!canMutateInspectorProject(context)) return setStatus('This workspace is read-only or the project changed')
    setProject((current) => canMutateInspectorProject(context) && current.id === context.projectId ? { ...current, projectCoverAssetId: assetId, projectCoverFraming: framing } : current)
    setStatus(assetId ? 'Project cover updated' : 'Project cover set to automatic')
  }

  function setInspectorImage(assetId?: string) {
    const context = inspectorMutationContext
    if (!canMutateInspectorProject(context)) return setStatus('This workspace is read-only or the project changed')
    setProject((current) => canMutateInspectorProject(context) && current.id === context.projectId ? { ...current, inspectorImageAssetId: assetId } : current)
    setStatus(assetId ? 'Inspector image updated' : 'Inspector image cleared')
  }

  const assetCounts = project.assets.reduce((counts, asset) => {
    counts[asset.kind] = (counts[asset.kind] || 0) + 1
    return counts
  }, {} as Record<AssetKind, number>)
  const assetUsage = project.boards.reduce<Record<string, number>>((usage, board) => {
    const references = [board.coverAssetId, ...board.nodes.flatMap((node) => [node.assetId, node.coverAssetId])]
    references.forEach((assetId) => { if (assetId) usage[assetId] = (usage[assetId] || 0) + 1 })
    return usage
  }, { ...(project.projectCoverAssetId ? { [project.projectCoverAssetId]: 1 } : {}) })
  const assetIssueCount = project.assets.filter((asset) => asset.status !== 'available').length
  const visibleProjects = projectSummaries.filter((entry) => (showArchivedProjects || !archivedProjectIds.includes(entry.id)) && (!projectQuery.trim() || [entry.title, entry.tags || '', entry.date || ''].some((value) => value.toLowerCase().includes(projectQuery.trim().toLowerCase())))).sort((a, b) => projectSort === 'name' ? a.title.localeCompare(b.title) : projectSort === 'date' ? (b.date || '').localeCompare(a.date || '') : b.updatedAt.localeCompare(a.updatedAt))

  const miniBridgeProjectMissing = isMiniBridgeWindow && Boolean(assetManagerProjectId) && projectReady && project.id !== assetManagerProjectId
  
  const miniBridgeBoardMissing = isMiniBridgeWindow && Boolean(assetManagerBoardId) && projectReady && !miniBridgeProjectMissing && !project.boards.some((board) => board.id === assetManagerBoardId)
  if (isMiniBridgeWindow && (bootStorageFailed || miniBridgeProjectMissing || miniBridgeBoardMissing)) {
    const reason = bootStorageFailed
      ? 'The portable workspace could not be opened from this window. Close it and reopen the Mini Bridge from inside the app.'
      : miniBridgeProjectMissing
        ? 'The project this Mini Bridge window belongs to is no longer in the workspace. It may have been renamed, deleted, or restored from a backup.'
        : 'The board this Mini Bridge window belongs to no longer exists in this project.'
    return (
      <section role="alert" aria-label="Mini Bridge cannot open" style={{ boxSizing: 'border-box', width: '100%', minHeight: '100vh', display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: 16, padding: 32, background: '#15171b', color: '#f4f0e8', fontFamily: 'inherit' }}>
        <span style={{ fontSize: 28 }} aria-hidden>◇</span>
        <h1 style={{ margin: 0, fontSize: 20 }}>Mini Bridge cannot open</h1>
        <p style={{ margin: 0, maxWidth: 460, textAlign: 'center', lineHeight: 1.5, color: '#b8b2a8' }}>{reason}</p>
        <button type="button" onClick={() => { void getCurrentWindow().close() }} style={{ padding: '8px 18px', border: '1px solid #4b5563', borderRadius: 6, background: '#232830', color: '#f4f0e8', cursor: 'pointer' }}>Close window</button>
      </section>
    )
  }
  return (
<Prototype25Shell theme={theme} projectTitle={project.title} navigationWidth={navigatorWidth} projectDetailsOpen={showInspectorDrawer} onProjectDetailsOpenChange={setShowInspectorDrawer}
rootProps={{inert: closingProject || undefined,
className: `studio-shell approved-layout-port p1-v2-shell${glassStrength > 0 ? ' p1-glass-enabled' : ''} workspace-${theme}${shellFocusWriting ? ' document-focus-shell' : ''}${minimalNavigation ? ' minimal-navigation' : ''}${viewBoardId ? ' view-only-shell' : ''}${assetManagerProjectId ? ' asset-manager-window' : ''}`,
style: { '--p1-glass-alpha': `${100 - glassStrength * .25}%`, '--p1-glass-blur': `${glassStrength * .2}px` } as React.CSSProperties,
onFocusCapture: (event) => rememberEditorOwner(event.target as HTMLElement),
onPointerDownCapture: (event) => rememberEditorOwner(event.target as HTMLElement)}}
slots={{
workspaceNotice: workspace?.readOnly ? <aside className="workspace-writer-notice" role="alert"><div><strong>Another Art Equation window is editing this workspace.</strong><span>This window is read-only. Close the other window, then reopen this EXE to enable drawing, moving objects and saving.</span></div><button type="button" onClick={() => { void getCurrentWindow().close() }}>Close read-only window</button></aside> : undefined,
workspaceHeading: <>
<button type="button" aria-label="Toggle project navigation" onClick={() => { if(showNavigatorPanel)setShowNavigatorPanel(false);else restorePanel('navigator') }}>☷</button>
<nav className="p25-workspace-crumb" aria-label="Workspace breadcrumb"><span>Project</span><span aria-hidden="true">›</span><strong>{mode === 'canvas' ? activeBoard.title : documentRegionVisible ? activeDocument.title : 'Documents'}</strong></nav>
<button type="button" onClick={() => {setShowNavigatorPanel(true);setNavigatorWidth(228);setShowInspectorDrawer(false);setSplit(54);window.dispatchEvent(new Event('art-equation:reset-studio-layout'))}}>Reset workspace</button>
</>,
header: <>
<header ref={appHeaderRef} className="app-bar aquarium-app-bar" hidden={shellFocusWriting} inert={shellFocusWriting} aria-hidden={shellFocusWriting}>
        <ProjectIdentity active={!shellFocusWriting} />
        <div className="project-heading">
          <span className="eyebrow">Active project</span>
          <strong title="Double-click to rename project" onDoubleClick={renameProject}>{project.title}</strong>
        </div>
        <div className="app-header-actions">
        <ProjectSearch
          project={project}
          query={projectSearch}
          onQueryChange={setProjectSearch}
          searchOriginTitle={searchOrigin?.originTitle}
          onReturn={returnFromSearch}
          onNavigate={(kind, id, nodeId) => {
            if (!searchOrigin) {
              setSearchOrigin(captureSearchOrigin())
            }
            if (kind === 'board') {
              if (nodeId) { canvasSelectionByBoard.set(project.id + '/' + id, [nodeId]); setRevealRequest({ boardId: id, nodeId, token: crypto.randomUUID() }) }
              openBoardInProject(id)
            }
            else if (kind === 'document') openDocumentInProject(id)
            else openProjectModule(kind)
            setProjectSearch('')
          }}
        />
        <button className="quiet-button" type="button" aria-label="Toggle project navigation" aria-pressed={showNavigatorPanel} onClick={() => { if (showNavigatorPanel) setShowNavigatorPanel(false); else restorePanel('navigator') }}>Projects</button>
<div className="mode-switch" role="group" aria-label="Workspace view">
          {(Object.keys(MODE_LABELS) as ViewMode[]).map((entry) => (
            <button className={mode === entry ? 'active' : ''} key={entry} title={`Show ${MODE_LABELS[entry].toLowerCase()} workspace · Ctrl+${entry === 'document' ? '1' : entry === 'split' ? '2' : '3'}`} aria-pressed={mode === entry} onClick={() => changeMode(entry)} type="button">
              {MODE_LABELS[entry]}
            </button>
          ))}
        </div>
        <button className="quiet-button undo-button" type="button" disabled={inspectorPermission.readOnly || !historyCapability.undo} aria-label={effectiveHistoryOwner === 'none' ? 'Undo unavailable for this control' : `Undo the last ${effectiveHistoryOwner} change`} title={effectiveHistoryOwner === 'none' ? 'This control has no editor history' : `Undo the last ${effectiveHistoryOwner} change · Ctrl+Z`} onClick={undoActiveEditor}>Undo</button>
        <button className="quiet-button redo-button" type="button" disabled={inspectorPermission.readOnly || !historyCapability.redo} aria-label={effectiveHistoryOwner === 'none' ? 'Redo unavailable for this control' : `Redo the last ${effectiveHistoryOwner} change`} title={effectiveHistoryOwner === 'none' ? 'This control has no editor history' : `Restore the last undone ${effectiveHistoryOwner} change · Ctrl+Shift+Z`} onClick={redoActiveEditor}>Redo</button>
        <div className="project-tools-cluster">
          <button ref={projectToolsToggleRef} className={`quiet-button project-tools-toggle ${showProjectTools ? 'active' : ''}`} type="button" aria-label="Project tools" aria-expanded={showProjectTools} aria-haspopup="menu" title="Calendar, recipes, prompts, references, recovery, and local processing" onClick={() => setShowProjectTools((visible) => !visible)}>Project tools <span>⌄</span></button>
          {showProjectTools && <div className="project-tools-menu" role="menu" aria-label="Project tools menu" onKeyDown={(event) => {
            if (event.key === 'Escape') {
              event.preventDefault()
              setShowProjectTools(false)
              projectToolsToggleRef.current?.focus()
            }
          }}>
            <button type="button" role="menuitem" onClick={() => { setShowWorksheets(true); setShowProjectTools(false) }}><span>◫</span><strong>Calendar</strong><small>Daily worksheets and tasks</small></button>
            <button type="button" role="menuitem" onClick={() => { setShowRecipes(true); setShowProjectTools(false) }}><span>✦</span><strong>Recipes</strong><small>Reusable project workflows</small></button>
            <button type="button" role="menuitem" onClick={() => { window.dispatchEvent(new Event('art-equation:add-research-capture')); setShowProjectTools(false) }}><span>●</span><strong>Web capture</strong><small>Save an article, social post, comments, or transcript</small></button>
            <button type="button" role="menuitem" onClick={() => { setShowPromptGenerator(true); setShowProjectTools(false) }}><span>⌁</span><strong>Prompt generator</strong><small>Local template workspace</small></button>
            <button type="button" role="menuitem" onClick={() => { setShowReferenceLibrary(true); setShowProjectTools(false) }}><span>◉</span><strong>References</strong><small>Libraries, crops, and reader</small></button>
            <button type="button" role="menuitem" onClick={() => { setShowMediaHealth(true); setShowProjectTools(false) }}><span>♥</span><strong>Media health</strong><small>Audit originals, previews, and relinks</small></button>
            <button type="button" role="menuitem" onClick={() => { setShowFramingReview(true); setShowProjectTools(false) }}><span>◱</span><strong>Framing review</strong><small>Visual crop and coordinate check</small></button>
            <button type="button" role="menuitem" onClick={() => {
              const pipelineId = `process-pipeline-${crypto.randomUUID()}`
              const pipeline = createDefaultProductionPipeline(project.id)
              pipeline.id = pipelineId
              const processDoc: ProjectDocument = {
                id: pipelineId,
                title: 'Creative Production Pipeline',
                content: pipeline as unknown as Record<string, unknown>,
                layout: structuredClone(DEFAULT_DOCUMENT_LAYOUT),
              }
              setProject((current) => ({ ...current, documents: [...current.documents, processDoc] }))
              setActiveDocumentId(pipelineId)
              setActiveNavigatorItem(`document:${pipelineId}`)
              setMode('document')
              setActiveEditor('document')
              setHistoryOwner('document')
              setShowProjectTools(false)
              setStatus('Opened Creative Production Pipeline (Hybrid Spine & Map Topology)')
            }}><span>🌲</span><strong>Process pipeline</strong><small>Hybrid spine & map topology</small></button>
            <i />
            <button type="button" role="menuitem" disabled={!workspace} title={!workspace ? 'Recovery unavailable without an active workspace' : 'Inspect project backups and journals'} onClick={() => { void openRecovery(); setShowProjectTools(false) }}><span>↺</span><strong>Recovery</strong><small>Backups and journals</small></button>
          </div>}
        </div>
        {minimalNavigation && <button className="quiet-button exit-minimal-navigation" type="button" onClick={() => setMinimalNavigation(false)}>Exit minimal view</button>}
        <button ref={inspectorToggleRef} className={`quiet-button inspector-toggle ${showInspectorDrawer ? 'active' : ''}`} type="button" aria-label="Toggle project inspector" aria-expanded={showInspectorDrawer} title="Show project inspector" onClick={() => setShowInspectorDrawer((visible) => !visible)}>Project details</button>
        <button className="quiet-button" type="button" title="Save local diagnostics to logs/performance.jsonl (Ctrl+Shift+D)" onClick={() => { void exportDiagnostics().then(() => setStatus('Diagnostics saved locally')).catch(() => setStatus('Could not save diagnostics')) }}>Record issue</button>
        <button ref={settingsToggleRef} className={`quiet-button settings-toggle ${showSettings ? 'active' : ''}`} type="button" aria-label="Open application settings" aria-expanded={showSettings} title="Appearance, canvas, navigation, input, and performance settings" onClick={() => setShowSettings((visible) => !visible)}>⚙ Settings</button>
        <div className="workspace-theme-choices" role="group" aria-label="Workspace theme">
          {(['navy', 'dark', 'light'] as const).map(choice => <button className={`theme-choice theme-choice-${choice}${theme === choice ? ' active' : ''}`} key={choice} type="button" aria-label={`Use ${choice} theme`} aria-pressed={theme === choice} title={`${choice[0].toUpperCase() + choice.slice(1)} theme`} onClick={() => setTheme(choice)}><ThemeIcon theme={choice} /></button>)}
        </div>
        <button className="primary-button" type="button" disabled={inspectorPermission.readOnly} title="Save project data and a recovery backup · Ctrl+S" onClick={saveNow}>Save</button>
        </div>
      </header>
</>,
navigator: showNavigatorPanel && !minimalNavigation && !viewBoardId ? (<aside className="navigator" aria-label="Project navigator">
          <section className="project-library" aria-label="Project library">
            <div className="project-library-heading"><span className="eyebrow">Projects</span><button type="button" title="Create a separate project with its own documents and boards" disabled={switchingProject || workspace?.readOnly} onClick={newProject}>＋ Project</button></div>
            <div className="project-library-tools"><input value={projectQuery} onChange={(event) => setProjectQuery(event.target.value)} placeholder="Search projects" aria-label="Search projects" /><select value={projectSort} onChange={(event) => setProjectSort(event.target.value as typeof projectSort)} aria-label="Sort projects"><option value="updated">Recent</option><option value="name">Name</option><option value="date">Project date</option></select><button type="button" onClick={() => setShowArchivedProjects((visible) => !visible)}>{showArchivedProjects ? 'Hide archived' : 'Show archived'}</button></div>
            <div className="project-library-list">
              {visibleProjects.map((entry) => {
                const coverPath = entry.id === project.id ? projectCoverRelativePath(project) : entry.coverRelativePath
                const coverUrl = workspaceAssetUrl(workspace?.root, coverPath)
                return <div className={`project-library-item ${entry.id === project.id ? 'active' : ''}`} key={entry.id}>
                  <button className="project-library-cover cover-assignment project-cover-assignment" type="button" disabled={entry.id !== project.id || Boolean(workspace?.readOnly || viewBoardId)} aria-label={`${coverUrl ? 'Change' : 'Assign'} image for project ${entry.title}`} title={entry.id === project.id ? 'Assign a project image' : 'Open this project to assign its image'} style={coverImageStyle(coverUrl, entry.id === project.id ? projectCoverFraming(project) : entry.coverFraming)} onClick={() => { setProjectThumbMenu(null); setShowProjectCoverPicker(true) }}>{!coverUrl && <span className="cover-assignment-empty"><span aria-hidden="true">＋</span><small>Image</small></span>}</button>
                  <button className="project-library-row" type="button" disabled={switchingProject} aria-current={entry.id === project.id ? 'page' : undefined} onClick={() => void openProject(entry.id)}>
                    <span className="project-library-copy"><strong>{entry.title}</strong><small>{entry.boardCount} board{entry.boardCount === 1 ? '' : 's'} · {entry.assetCount} asset{entry.assetCount === 1 ? '' : 's'}</small><em>{(entry.status || 'planning').replace('-', ' ')} · {entry.date || 'No date'}</em></span>
                  </button>
                  <button className="project-row-action" type="button" title="Duplicate this project" onClick={() => void duplicateProject(entry.id)}>⧉</button>
                  <button className="project-row-action" type="button" title="Archive or restore project" onClick={() => toggleProjectArchive(entry.id)}>{archivedProjectIds.includes(entry.id) ? '↶' : '⌁'}</button>
                  <button className="project-row-action project-appearance-trigger" type="button" title={`Thumbnail and appearance for ${entry.title}`} aria-label={`Thumbnail and appearance for ${entry.title}`} aria-haspopup="menu" onClick={(event) => { const rect = event.currentTarget.getBoundingClientRect(); setProjectThumbMenu({ id: entry.id, x: Math.min(rect.left, window.innerWidth - 220), y: rect.bottom + 4 }) }}>⋯</button>
                </div>
              })}
            </div>
            {showArchivedProjects && trashedProjects.length > 0 && <div className="trashed-projects"><strong>Recovery trash</strong>{trashedProjects.map((entry) => <button type="button" key={entry.id} onClick={() => void restoreProjectFromTrash(entry.id)}>↶ Restore {entry.title}</button>)}</div>}
            {projectThumbMenu && (() => { const isActive = projectThumbMenu.id === project.id; return <div className="project-thumb-menu" role="menu" aria-label={`Appearance for project`} style={{ position: 'fixed', left: projectThumbMenu.x, top: projectThumbMenu.y }}>
              <button type="button" role="menuitem" disabled={!isActive || Boolean(workspace?.readOnly || viewBoardId)} title={isActive ? 'Choose, crop, import, or remove the project thumbnail' : 'Open the project first, then change its thumbnail'} onClick={() => { setProjectThumbMenu(null); setShowProjectCoverPicker(true) }}>Set thumbnail…</button>
              <button type="button" role="menuitem" disabled={!isActive || Boolean(workspace?.readOnly || viewBoardId) || !project.projectCoverAssetId} onClick={() => { setProjectCover(); setProjectThumbMenu(null) }}>Remove thumbnail</button>
              <button type="button" role="menuitem" disabled={!isActive || Boolean(workspace?.readOnly || viewBoardId)} onClick={() => { useActiveBoardAsProjectCover(); setProjectThumbMenu(null) }}>Use active board image</button>
            </div> })()}
            {!workspace?.readOnly && !viewBoardId && showProjectCoverPicker && <div className="project-cover-picker-anchor"><CoverArtworkPicker key={`project-${project.id}-${project.projectCoverAssetId || 'automatic'}`} title={`Project thumbnail · ${project.title}`} assets={project.assets.filter((asset) => asset.kind === 'image' && asset.status !== 'missing')} workspaceRoot={workspace?.root} selectedId={project.projectCoverAssetId} framing={project.projectCoverFraming} onApply={(assetId, framing) => { setProjectCover(assetId, framing); setShowProjectCoverPicker(false) }} onImport={() => void importCoverArtwork('project')} onReset={() => { setProjectCover(); setShowProjectCoverPicker(false) }} onClose={() => setShowProjectCoverPicker(false)} /></div>}
            {project.id === (projectSummaries.find((entry) => entry.id === project.id)?.id) && <div className="project-controls"><button type="button" onClick={() => void duplicateProject()}>Duplicate active</button><button type="button" onClick={moveProjectToTrash}>Move active to trash</button></div>}
          </section>
          <div className="navigator-heading"><span className="eyebrow">Workspace</span><button type="button" title="Add a document or board" aria-label="Add a document or board" aria-expanded={showNewItemMenu} onClick={() => setShowNewItemMenu((visible) => !visible)}>＋</button></div>
          {showNewItemMenu && <div className="new-item-menu" role="menu" aria-label="New project item"><button type="button" disabled={inspectorPermission.readOnly} onClick={() => createNavigatorItem('document')}>¶ New document</button><button type="button" disabled={inspectorPermission.readOnly} onClick={() => createNavigatorItem('board')}>▧ New board</button></div>}
          <nav>
            <button className="tree-row open" type="button" title="Double-click to rename project" onDoubleClick={renameProject}><span>⌄</span><span className="navigator-item-title" title={project.title}>{project.title}</span></button>
            <div className="p25-tree-section"><span className="tree-section-label">Boards &amp; sub-boards</span><small>{project.boards.length} boards</small></div>
            <VirtualList items={boardTreeRows} itemKey={({ board }) => board.id} label="Boards and subboards" renderItem={({ board, depth }) => { const image = workspaceAssetUrl(workspace?.root, assetCoverPath(boardCoverAsset(project, board))); return <div className="tree-row-wrap" key={board.id} onContextMenu={(event) => { event.preventDefault(); openNavigatorItemMenu("board", board.id, event.clientX, event.clientY) }} style={{ '--board-depth': depth, '--board-accent': board.tileAccentColor || 'transparent' } as React.CSSProperties}><button className={`tree-row child board-tree-row ${activeNavigatorItem === `board:${board.id}` ? 'selected' : ''}`} type="button" title={`${board.linkedFolderPath ? `Disk folder: ${boardDiskPath(workspace?.root, board.linkedFolderPath)} · ` : 'Virtual subboard · '}Open board · double-click to rename`} aria-current={activeNavigatorItem === `board:${board.id}` ? 'page' : undefined} onDoubleClick={() => renameNavigatorItem('board', board.id, board.title)} onClick={() => openBoardInProject(board.id)}><span className={image ? 'tree-board-image' : undefined} style={coverImageStyle(image, board.coverFraming)}>{image ? '' : depth ? '↳' : '▧'}</span><span className="navigator-item-title" title={board.title}>{board.title}</span></button><button className="project-row-action" type="button" title={`Actions for ${board.title}`} aria-label={`Actions for ${board.title}`} aria-haspopup="menu" onClick={(event) => { const rect = event.currentTarget.getBoundingClientRect(); openNavigatorItemMenu("board", board.id, rect.right, rect.bottom) }}>⋯</button></div> }} />
            <div className="p25-tree-section"><span className="tree-section-label">Documents &amp; notes</span><small>{project.documents.length} documents</small></div>
            <VirtualList items={project.documents} itemKey={document => document.id} label="Documents and notes" renderItem={(document) => <div className="tree-row-wrap" key={document.id} onContextMenu={(event) => { event.preventDefault(); openNavigatorItemMenu("document", document.id, event.clientX, event.clientY) }}><button className={`tree-row child ${activeNavigatorItem === `document:${document.id}` ? 'selected' : ''}`} type="button" title="Double-click to rename" aria-current={activeNavigatorItem === `document:${document.id}` ? 'page' : undefined} onDoubleClick={() => renameNavigatorItem('document', document.id, document.title)} onClick={() => openDocumentInProject(document.id)}><span>{document.id === 'project-brief' ? '◇' : '¶'}</span><span className="navigator-item-title" title={document.title}>{document.title}</span></button><button className="project-row-action" type="button" title={`Actions for ${document.title}`} aria-label={`Actions for ${document.title}`} aria-haspopup="menu" onClick={(event) => { const rect = event.currentTarget.getBoundingClientRect(); openNavigatorItemMenu("document", document.id, rect.right, rect.bottom) }}>⋯</button></div>} />
            <PrototypeAssetShelf assets={project.assets} board={activeBoard} readOnly={inspectorPermission.readOnly} preview={asset => workspaceAssetUrl(workspace?.root, assetPreviewPath(asset))} onCover={setBoardCover} onIcon={() => window.dispatchEvent(new Event('art-equation:board-tile-appearance'))} onPlace={placeShelfAsset} onManage={() => openProjectModule('assets')} />
<span className="tree-section-label">Project system</span>
            <button className={`tree-row child ${activeNavigatorItem === 'module:worksheets' ? 'selected' : ''}`} type="button" onClick={() => openProjectModule('worksheets')}><span>◫</span> Daily worksheets</button>
            <button className={`tree-row child ${activeNavigatorItem === 'module:references' ? 'selected' : ''}`} type="button" onClick={() => openProjectModule('references')}><span>◉</span> References & crops</button>
            <button className={`tree-row child ${activeNavigatorItem === 'module:recipes' ? 'selected' : ''}`} type="button" onClick={() => openProjectModule('recipes')}><span>✦</span> Attached recipes</button>
            <button className={`tree-row child ${activeNavigatorItem === 'module:prompts' ? 'selected' : ''}`} type="button" onClick={() => openProjectModule('prompts')}><span>⌁</span> Prompt history</button>
            <button className={`tree-row child ${activeNavigatorItem === 'module:assets' ? 'selected' : ''}`} type="button" onClick={() => openProjectModule('assets')}><span>▦</span> Asset catalog</button>
            <button className="tree-row child muted" type="button" title="Add another document or visual board to this project" onClick={() => setShowNewItemMenu(true)}><span>＋</span> New document or board</button>
          </nav>
          {navigatorMenu && (() => {
            const item = navigatorMenu.kind === 'board' ? project.boards.find((board) => board.id === navigatorMenu.id) : project.documents.find((document) => document.id === navigatorMenu.id)
            if (!item) return null
            const close = () => setNavigatorMenu(null)
            return createPortal(<div ref={navigatorMenuRef} className="navigator-item-menu" role="menu" aria-label={`Actions for ${item.title}`} style={{ left: navigatorMenu.x, top: navigatorMenu.y }} onKeyDown={(event) => {
              if (!['ArrowDown', 'ArrowUp', 'Home', 'End'].includes(event.key)) return
              event.preventDefault()
              const options = Array.from(event.currentTarget.querySelectorAll<HTMLButtonElement>('button[role="menuitem"]:not(:disabled)'))
              const index = options.indexOf(document.activeElement as HTMLButtonElement)
              const next = event.key === 'Home' ? 0 : event.key === 'End' ? options.length - 1 : (index + (event.key === 'ArrowDown' ? 1 : -1) + options.length) % options.length
              options[next]?.focus()
            }}>
              <strong>{item.title}</strong>
              <button type="button" role="menuitem" onClick={() => { navigatorMenu.kind === 'board' ? openBoardInProject(item.id) : openDocumentInProject(item.id); close() }}>Open</button>
              <button type="button" role="menuitem" disabled={inspectorPermission.readOnly} onClick={() => { close(); renameNavigatorItem(navigatorMenu.kind, item.id, item.title) }}>Rename…</button>
              {navigatorMenu.kind === 'board' && <button type="button" role="menuitem" disabled={Boolean(workspace?.readOnly)} onClick={() => { close(); duplicateBoard(item.id) }}>Duplicate board</button>}
              {navigatorMenu.kind === 'document' && isDeletableDocument(item as ProjectDocument) && <button type="button" role="menuitem" disabled={Boolean(workspace?.readOnly)} onClick={() => { close(); duplicateDocument(item.id) }}>Duplicate document</button>}
              {navigatorMenu.kind === 'board' && <><button type="button" role="menuitem" onClick={() => { close(); openBoardInProject(item.id); setShowBoardCoverPicker(true) }}>Board image and crop…</button><button type="button" role="menuitem" disabled={Boolean(workspace?.readOnly)} onClick={() => { close(); void linkBoardFolder(item.id) }}>{(item as BoardModel).linkedFolderPath ? 'Change linked folder…' : 'Link disk folder…'}</button>{(item as BoardModel).parentBoardId ? (item as BoardModel).linkedFolderPath && <button type="button" role="menuitem" disabled={Boolean(workspace?.readOnly)} onClick={() => { setProject((current) => ({ ...current, boards: current.boards.map((board) => board.id === item.id ? { ...board, linkedFolderPath: undefined } : board) })); close() }}>Unlink folder (keep virtual)</button> : (item as BoardModel).linkedFolderPath !== managedBoardFolderPath(project.id, item.id) && <button type="button" role="menuitem" disabled={Boolean(workspace?.readOnly)} onClick={() => { setProject((current) => ({ ...current, boards: current.boards.map((board) => board.id === item.id ? { ...board, linkedFolderPath: managedBoardFolderPath(current.id, board.id) } : board) })); close() }}>Return to managed board folder</button>}</>}
              {navigatorMenu.kind === 'board' ? <button className="danger" type="button" role="menuitem" disabled={Boolean(workspace?.readOnly) || !applyBoardTrash(project, item.id)?.project.boards.length} title={project.boards.length <= 1 ? 'Every project needs at least one board' : undefined} onClick={() => { close(); void deleteNavigatorBoard(item.id) }}>Move to Trash…</button> : isDeletableDocument(item as ProjectModel['documents'][number]) && <button className="danger" type="button" role="menuitem" disabled={Boolean(workspace?.readOnly)} onClick={() => { close(); void removeNavigatorDocument(item.id) }}>Move to Trash…</button>}
            </div>, document.querySelector('.studio-shell') || document.body)
          })()}
          <div className="asset-summary">
            <button ref={trashButtonRef} type="button" className="trash-summary-button" data-testid="trash-button" aria-label={`Open project trash (${projectTrash.length} item${projectTrash.length === 1 ? '' : 's'})`} aria-expanded={showTrashViewer} aria-controls="project-trash-viewer" title="Open the project trash viewer" onClick={() => setShowTrashViewer((visible) => !visible)}>
              <svg width="38" height="38" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M3 6h18M8 6V4h8v2M6 6l1 14h10l1-14M10 11v6M14 11v6" /></svg>
              <span>Trash</span>
              <span className={`trash-count-badge ${projectTrash.length ? '' : 'empty'}`}>{projectTrash.length}</span>
            </button>
            <div className="asset-summary-heading"><span className="eyebrow">Assets</span><button type="button" title="Open the disk-backed file catalog" onClick={() => setShowAssetManager(true)}>Manage files</button></div>
            <div><strong>{assetCounts.image || 0}</strong><span>Images</span></div><div><strong>{assetCounts.video || 0}</strong><span>Videos</span></div><div><strong>{assetCounts.model || 0}</strong><span>3D models</span></div><div><strong>{assetCounts.document || 0}</strong><span>Documents</span></div>
            <p className={assetIssueCount ? 'asset-problem' : 'asset-ok'}>● {assetIssueCount ? `${assetIssueCount} file${assetIssueCount === 1 ? '' : 's'} need attention` : 'All files available'}</p>
          </div>
        <button ref={navigatorEdgeRef} className="p25-navigation-resize" type="button" data-testid="navigator-panel-handle" aria-label="Resize projects panel; press Home to hide" title="Drag or use arrow keys to resize · Home hides" onPointerDown={startPanelEdgeDrag('navigator')} onKeyDown={(event) => onPanelEdgeKeyDown(event, 'navigator')} onClick={() => onPanelEdgeClick('navigator')}><span aria-hidden="true">Projects</span></button>
</aside>) : null,
boardNavigation: null,
workspace: <>
<main id="workspace-surface" ref={workbenchRef} className={`workbench mode-${shellFocusWriting ? 'document' : mode}${compactSplit && !shellFocusWriting ? ` compact-split compact-${activeEditor}` : ''}`} style={{ '--document-width': `${effectiveSplit}%` } as React.CSSProperties}>
          {compactSplit && <div className="compact-split-tabs" role="group" aria-label="Split workspace pane">
            <button type="button" className={activeEditor === 'document' ? 'active' : ''} aria-pressed={activeEditor === 'document'} onClick={() => { setActiveEditor('document'); setHistoryOwner(activeDocument.id === QUESTIONNAIRE_DOCUMENT_ID ? 'none' : 'document') }}>Document</button>
            <button type="button" className={activeEditor === 'canvas' ? 'active' : ''} aria-pressed={activeEditor === 'canvas'} onClick={() => { setActiveEditor('canvas'); setHistoryOwner('canvas') }}>Canvas</button>
          </div>}
          <section className="prototype-document-workspace" aria-label="Document workspace" hidden={!documentRegionVisible}>
          {!viewBoardId && !shellFocusWriting && <PrototypeDocumentTabs documents={project.documents} openIds={currentDocumentTabIds} activeId={activeDocumentTabOpen ? activeDocument.id : ''} readOnly={Boolean(workspace?.readOnly)} onOpen={id => openDocumentInProject(id, mode === 'split' ? 'split' : 'document')} onClose={closeDocumentTab} onCreate={() => void createNavigatorItem('document')} />}
          {!activeDocumentTabOpen && <div className="p25-document-empty"><div><h2>No open documents</h2><p>Your documents remain in this project. Open a document to continue writing.</p><div className="p25-document-empty-actions"><button type="button" onClick={() => openDocumentInProject(activeDocument.id, mode === 'split' ? 'split' : 'document')}>Reopen {activeDocument.title}</button><button type="button" disabled={Boolean(workspace?.readOnly)} onClick={() => void createNavigatorItem('document')}>＋ New document</button></div></div></div>}
          <div key={documentSessionKey} id={documentPanelId(QUESTIONNAIRE_DOCUMENT_ID)} role={!viewBoardId && !shellFocusWriting ? 'tabpanel' : undefined} aria-labelledby={!viewBoardId && !shellFocusWriting ? documentTabId(QUESTIONNAIRE_DOCUMENT_ID) : undefined} className="retained-document-session" data-document-session={documentSessionKey} data-document-id={QUESTIONNAIRE_DOCUMENT_ID} hidden={!documentVisible || activeDocument.id !== QUESTIONNAIRE_DOCUMENT_ID} inert={!documentVisible || activeDocument.id !== QUESTIONNAIRE_DOCUMENT_ID} aria-hidden={!documentVisible || activeDocument.id !== QUESTIONNAIRE_DOCUMENT_ID}>
            <Suspense fallback={<div className="pane-loading">Loading questionnaire…</div>}>
            <ProjectQuestionnaire readOnly={Boolean(workspace?.readOnly || viewBoardId)} projectTitle={project.title} value={project.questionnaire} theme={theme} onProjectTitleChange={(title) => { const context = documentContext(QUESTIONNAIRE_DOCUMENT_ID); if (canPublishDocument(context, QUESTIONNAIRE_DOCUMENT_ID)) setProject((current) => canPublishDocument(context, QUESTIONNAIRE_DOCUMENT_ID) && current.id === context.projectId ? { ...current, title } : current) }} onChange={(questionnaire) => { const context = documentContext(QUESTIONNAIRE_DOCUMENT_ID); if (canPublishDocument(context, QUESTIONNAIRE_DOCUMENT_ID)) setProject((current) => canPublishDocument(context, QUESTIONNAIRE_DOCUMENT_ID) && current.id === context.projectId ? { ...current, questionnaire } : current) }} />
            </Suspense>
          </div>
          {visitedDocuments.map((document) => {
            const visible = documentVisible && activeDocument.id === document.id
            const context = documentContext(document.id)
            const focusControlKey = documentControlKey(document.id)
            const focusControls = controlsForDocument(document.id)
            return <div key={documentControlKey(document.id)} id={documentPanelId(document.id)} role={!viewBoardId && !shellFocusWriting ? 'tabpanel' : undefined} aria-labelledby={!viewBoardId && !shellFocusWriting ? documentTabId(document.id) : undefined} className="retained-document-session" data-document-session={documentSessionKey} data-document-id={document.id} hidden={!visible} inert={!visible} aria-hidden={!visible}>
              <Suspense fallback={<div className="pane-loading">Loading document engine…</div>}>
                {document.content?.kind === 'art-equation-process-document' ? (
                  <ProcessDocumentView
                    document={document.content as unknown as ProcessDocument}
                    onUpdateDocument={(updated) => publishDocumentPatch(context, document.id, { content: updated as unknown as Record<string, unknown> })}
                    onOpenDocument={(targetDocId) => {
                      if (project.documents.some((d) => d.id === targetDocId)) {
                        setActiveDocumentId(targetDocId)
                        setActiveNavigatorItem(`document:${targetDocId}`)
                      } else {
                        const newDoc: ProjectDocument = {
                          id: targetDocId,
                          title: targetDocId.replace(/^doc-/, '').replace(/-/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase()),
                          content: { type: 'doc', content: [{ type: 'heading', attrs: { level: 1 }, content: [{ type: 'text', text: targetDocId.replace(/^doc-/, '').replace(/-/g, ' ') }] }, { type: 'paragraph', content: [{ type: 'text', text: 'Document linked from process pipeline node.' }] }] },
                          layout: structuredClone(DEFAULT_DOCUMENT_LAYOUT),
                        }
                        setProject((cur) => ({ ...cur, documents: [...cur.documents, newDoc] }))
                        setActiveDocumentId(targetDocId)
                        setActiveNavigatorItem(`document:${targetDocId}`)
                      }
                    }}
                    readOnly={Boolean(workspace?.readOnly || viewBoardId)}
                    projectDocuments={project.documents}
                    projectAssets={project.assets}
                  />
                ) : (
                  <RichDocument controlsRef={focusControls} active={visible} onFocusWritingChange={(focused) => receiveDocumentFocusWriting(documentSessionKey, document.id, focusControlKey, focusControls, focused)} readOnly={Boolean(workspace?.readOnly || viewBoardId)} content={document.content} layout={document.layout || DEFAULT_DOCUMENT_LAYOUT} onChange={(content) => publishDocumentPatch(context, document.id, { content })} onLayoutChange={(layout) => publishDocumentPatch(context, document.id, { layout })} onRequestText={requestText} />
                )}
              </Suspense>
            </div>
          })}
          </section>
          {mode === 'split' && (
            <button className="split-divider" onPointerDown={startDividerDrag} onKeyDown={adjustDividerWithKeyboard} type="button" aria-label="Resize document and canvas. Drag, or use left and right arrow keys." title="Drag to resize · arrow keys adjust the split"><span /></button>
          )}
      {mode !== 'document' && activeBoard && <section className="prototype-canvas-workspace" aria-label="Canvas workspace"><CanvasPane navigation={<>
{!viewBoardId && <nav className="board-navigation" aria-label="Board navigation">
          <button type="button" aria-label="Previous board" title="Back" disabled={!boardBackRef.current.length} onClick={() => navigateBoardHistory('back')}>←</button>
          <button type="button" aria-label="Next board" title="Forward" disabled={!boardForwardRef.current.length} onClick={() => navigateBoardHistory('forward')}>→</button>
          <button type="button" aria-label="Open parent board" title="Parent board" disabled={!activeBoard.parentBoardId} onClick={() => activeBoard.parentBoardId && switchBoard(activeBoard.parentBoardId)}>↑</button>
          <div className="board-breadcrumbs" aria-label={`Project ${project.title}, ${activeBoardTrail.map((board) => board.title).join(', ')}`}><span><button type="button" title={`Project: ${project.title}`} onClick={() => { setShowNavigatorPanel(true); switchBoard(activeBoardTrail[0]?.id || activeBoard.id) }}>Project</button></span>{activeBoardTrail.map((board) => { const image = workspaceAssetUrl(workspace?.root, assetCoverPath(boardCoverAsset(project, board))); return <span key={board.id}><i aria-hidden="true">/</i><button type="button" title={board.title} aria-current={board.id === activeBoard.id ? 'page' : undefined} onClick={() => switchBoard(board.id)}><span className="board-breadcrumb-icon" aria-hidden="true" style={{ ...coverImageStyle(image, board.coverFraming), borderColor: board.tileAccentColor || undefined }}>{image ? '' : '▧'}</span>{board.title}</button></span> })}</div>
          <button ref={boardActionsTriggerRef} className="board-actions-trigger" type="button" aria-label={`Actions for ${activeBoard.title}`} title={`Actions for ${activeBoard.title}`} aria-expanded={showBoardActions} aria-haspopup="menu" onClick={() => { setShowBoardCoverPicker(false); setShowBoardActions((open) => !open) }}>⋯</button>
          {showBoardActions && <div className="board-actions-menu" role="menu" aria-label={`Actions for ${activeBoard.title}`} onKeyDown={(event) => {
            if (event.key === 'Escape') {
              event.preventDefault()
              setShowBoardActions(false)
              boardActionsTriggerRef.current?.focus()
            }
          }}>
            <strong>{activeBoard.parentBoardId ? 'Subboard' : 'Main board'} · {activeBoard.title}</strong>
            <button type="button" role="menuitem" disabled={Boolean(workspace?.readOnly)} title={workspace?.readOnly ? 'Disabled in read-only workspace' : 'Create a nested subboard inside this board'} onClick={() => { setShowBoardActions(false); createNestedBoardInActive() }}>Create subboard inside…</button>
            <button type="button" role="menuitem" disabled={Boolean(workspace?.readOnly)} title={workspace?.readOnly ? 'Disabled in read-only workspace' : 'Change board icon or image'} onClick={() => { setShowBoardActions(false); setShowBoardCoverPicker(true) }}>Change board icon or image…</button>
            {mode === 'split' && !showCanvasFilmstrip && <button type="button" role="menuitem" onClick={() => { setShowBoardActions(false); setShowProjectBoardStrip((visible) => !visible) }}>{showProjectBoardStrip ? 'Hide main-board strip' : 'Show main-board strip'}</button>}
          </div>}
          {showBoardCoverPicker && <div className="board-cover-picker" id="board-cover-picker"><CoverArtworkPicker key={`${activeBoard.id}-${activeBoard.coverAssetId || 'automatic'}`} title={`Board image · ${activeBoard.title}`} assets={project.assets.filter((asset) => asset.kind === 'image' && asset.status !== 'missing')} workspaceRoot={workspace?.root} selectedId={activeBoard.coverAssetId} framing={activeBoard.coverFraming} onApply={(assetId, framing) => { setBoardCover(assetId, framing); setShowBoardCoverPicker(false) }} onImport={() => void importCoverArtwork('board')} onReset={() => { setBoardCover(); setShowBoardCoverPicker(false) }} onClose={() => setShowBoardCoverPicker(false)} /><label className="board-tile-accent">Mini-board accent <input type="color" value={activeBoard.tileAccentColor || '#9ab4c8'} onChange={(event) => setProject((current) => ({ ...current, boards: current.boards.map((board) => board.id === activeBoard.id ? { ...board, tileAccentColor: event.target.value } : board) }))} /></label><small>Accent changes the board tile, not the canvas background.</small></div>}
        </nav>}
</>} key={project.id} onFilmstripVisibilityChange={setShowCanvasFilmstrip} onSelectionChange={receiveCanvasSelection} revealRequest={revealRequest?.boardId === activeBoard.id ? revealRequest : undefined} onMoveSelection={moveBoardSelection} diagramTemplates={project.diagramTemplates || []} onSaveDiagramTemplate={saveDiagramTemplate} theme={theme} canvasUiPersonality={canvasUiPersonality} onOpenTrash={() => setShowTrashViewer(true)} board={activeBoard} boards={project.boards} assets={project.assets} swatches={project.colorSwatches} workspaceRoot={workspace?.root} projectId={project.id} projectName={project.title} readOnly={workspace?.readOnly} openWith={{ ...openWith, ...(project.openWith || {}) }} onOpenWith={launchAsset} onReplaceAsset={relinkAsset} onPreparePyramid={imagePreparation.prepare} onFitImageBounds={fitImageBounds} onSetColumnImageSizing={setColumnImageSizing} onBoardChange={applyBoardChange} onDerivedAsset={(asset, sourceNodeId) => setProject((current) => ({ ...current, assets: [...current.assets, asset], boards: current.boards.map((entry) => entry.id === activeBoard.id ? { ...entry, nodes: entry.nodes.map((node) => node.id === sourceNodeId ? { ...node, assetId: asset.id, title: asset.displayName, imageTransform: undefined } : node) } : entry) }))} onAddGeneratedAsset={addGeneratedAssetToBoard} onImport={importAssets} onDropFiles={importAssetPaths} onSwatchesChange={(colorSwatches) => setProject((current) => ({ ...current, colorSwatches }))} onSwitchBoard={switchBoard} onCreateBoard={() => createNavigatorItem('board')} onCreateNestedBoard={createNestedBoardInActive} onTrashBoard={deleteNavigatorBoard} onUpdateBoardTile={updateBoardTile} onEditBoardImage={(boardId) => { switchBoard(boardId); setShowBoardCoverPicker(true) }} onDuplicateBoard={duplicateActiveBoard} onDeleteBoard={deleteActiveBoard} onRenameBoard={(board) => renameNavigatorItem('board', board.id, board.title)} onReorderBoards={reorderBoards} onSetCover={setBoardCover} onSetProjectThumbnail={(assetId) => setProjectCover(assetId, DEFAULT_COVER_FRAMING)} onTrashSelection={trashCanvasSelection} onPreviewImage={(assetId) => { setPreviewZoomed(false); setPreviewAssetId(assetId) }} onUndo={undoBoard} onRedo={redoBoard} onRequestText={requestText} /><>
{!viewBoardId && mode === 'split' && showProjectBoardStrip && !showCanvasFilmstrip && <ProjectBoardStrip project={project} activeBoardId={activeBoard.id} workspaceRoot={workspace?.root} onOpen={(boardId) => openBoardInProject(boardId)} onCreate={() => createNavigatorItem('board')} onDuplicate={duplicateActiveBoard} onRename={(board) => renameNavigatorItem('board', board.id, board.title)} onContextMenu={(boardId, x, y) => openNavigatorItemMenu('board', boardId, x, y)} onReorder={reorderBoards} onHide={() => setShowProjectBoardStrip(false)} />}
</></section>}
      
      
        </main>
</>,
inspector: <>
{!viewBoardId && <ProjectInspector key={project.id} expanded={showInspectorDrawer} project={project} activeBoard={activeBoard} selectedNodes={mode === 'document' || canvasSelection?.boardId !== activeBoard.id ? [] : canvasSelection.ids.map((id) => activeBoard.nodes.find((node) => node.id === id)).filter((node): node is BoardNode => Boolean(node))} activeDocumentId={activeDocument.id} workspaceRoot={workspace?.root} readOnly={Boolean(workspace?.readOnly)} onFitImageBounds={fitImageBounds} onSetColumnImageSizing={setColumnImageSizing} onUpdateNode={updateInspectedNode} statusText={status} onStatusChange={updateProjectStatus} onOpenModule={openProjectModule} onOpenBoard={(boardId) => openBoardInProject(boardId)} onOpenDocument={openDocumentInProject} onTaskChange={updateTodayTask} onUseBoardCover={useActiveBoardAsProjectCover} onSetProjectCover={setProjectCover} onImportCoverImage={() => void importCoverArtwork('project')} onSetInspectorImage={setInspectorImage} onBrowseInspectorImage={browseInspectorImage} onImportInspectorImagePaths={importInspectorImagePaths} onClose={() => { setShowInspectorDrawer(false); inspectorToggleRef.current?.focus() }} />}
</>,
boardStrip: null,
overlays: <>
{showSettings && <SettingsDialog onClose={()=>setShowSettings(false)} sections={[
        {id:'appearance',label:'Appearance',content:<><section><h2>Appearance</h2><label><span>Workspace theme</span><select value={theme} onChange={(event) => setTheme(event.target.value as 'navy' | 'dark' | 'light')}><option value="navy">Navy</option><option value="dark">Dark</option><option value="light">Light</option></select></label><label><span>Canvas layout personality</span><select value={canvasUiPersonality} onChange={(event) => setCanvasUiPersonality(event.target.value as CanvasUiPersonality)}><option value="classical">Studio Classical (Aquarium & Bottom Rail)</option><option value="milanote">Milanote Modern (Left Creation Rail & Neutral Gray Canvas)</option></select></label><label><span>Glass strength</span><input aria-label="Glass strength" type="range" min="0" max="100" value={glassStrength} onChange={(event) => setGlassStrength(Number(event.target.value))} /><output>{glassStrength}%</output></label><small>0% uses flat surfaces. Document paper has its own appearance.</small></section></>},
        {id:'canvas',label:'Canvas and input',content:<><section><h2>Canvas and grid</h2><label><span>Show grid</span><input type="checkbox" checked={activeBoard.gridVisible !== false} onChange={(event) => applyBoardChange({ ...activeBoard, gridVisible: event.target.checked })} /></label><label><span>Grid spacing</span><input type="range" min="12" max="120" step="4" value={activeBoard.gridSpacing || 44} onChange={(event) => applyBoardChange({ ...activeBoard, gridSpacing: Number(event.target.value) })} /></label><label><span>Grid opacity</span><input type="range" min="5" max="100" value={Math.round((activeBoard.gridOpacity ?? DEFAULT_CANVAS_GRID_OPACITY) * 100)} onChange={(event) => applyBoardChange({ ...activeBoard, gridOpacity: Number(event.target.value) / 100 })} /></label><button type="button" onClick={() => applyBoardChange({ ...activeBoard, backgroundColor: undefined, backgroundFollowsTheme: true, gridColor: undefined, gridOpacity: undefined, gridSpacing: undefined })}>Restore theme grid defaults</button></section><section><h2>Input</h2><label><span>Snap objects to grid</span><input type="checkbox" checked={activeBoard.snapToGrid !== false} onChange={(event) => applyBoardChange({ ...activeBoard, snapToGrid: event.target.checked })} /></label><label><span>Smart object alignment</span><input type="checkbox" checked={activeBoard.snapToObjects !== false} onChange={event => applyBoardChange({ ...activeBoard, snapToObjects: event.target.checked })} /></label><label><span>Snap to layout guides</span><input type="checkbox" checked={activeBoard.snapToGuides !== false} onChange={event => applyBoardChange({ ...activeBoard, snapToGuides: event.target.checked })} /></label></section></>},
        {id:'workspace',label:'Workspace',content:<><section><h2>Board navigation</h2><label><span>Minimal canvas interface</span><input type="checkbox" checked={minimalNavigation} onChange={(event) => setMinimalNavigation(event.target.checked)} /></label><small>Hides the permanent project and inspector panels. Breadcrumbs and Settings remain available.</small></section></>},
        {id:'saving',label:'Saving and recovery',content:<><SaveSettingsPanel project={project} enabled={workspace?.storageSchema===2} readOnly={Boolean(workspace?.readOnly||viewBoardId)} policy={savePolicy} pending={savePending} onPolicy={setSavePolicy} onFlush={async()=>{const current=projectRef.current;await saveProject({...current,updatedAt:new Date().toISOString()});if(projectRef.current===current)setSavePending(false);setStatus('Project, board files and recovery snapshot saved')}} /></>},
        {id:'engine',label:'Rendering',content:<><section><h2>Rendering engine</h2>
          <div className="settings-readout"><span>Renderer stack</span><strong>wgpu · Vello GPU / Vello CPU</strong></div><small>Vello GPU is preferred. Vello CPU provides fallback when GPU rendering is unavailable.</small>
        </section><EngineCacheSettings /></>},
        {id:'codex',label:'Codex',content:<><CodexBridgePanel bridge={codexBridge} /></>},
        {id:'gemini',label:'Gemini Live',content:<><GeminiBridgePanel activeBoardId={activeBoard.id} onInjectNote={(boardId, noteTitle, noteContent) => {
          const newNode: BoardNode = {
            id: `gemini-note-${Date.now()}`,
            kind: 'note',
            title: noteTitle,
            content: noteContent,
            x: 120,
            y: 120,
            width: 300,
            height: 180,
            color: '#1e293b',
            textColor: '#f8fafc',
          } as BoardNode
          setProject(prev => ({
            ...prev,
            updatedAt: new Date().toISOString(),
            boards: prev.boards.map(b => b.id === boardId ? { ...b, nodes: [...b.nodes, newNode] } : b)
          }))
          setStatus('Injected note from Gemini')
        }} /></>}
      ]} />}
{showAssetManager && <Suspense fallback={<div className="asset-manager-loading">Loading Mini Bridge…</div>}><AssetManager projectId={project.id} projectName={project.title} board={activeBoard} workspaceRoot={workspace?.root || ''} readOnly={Boolean(workspace?.readOnly)} onApplySemanticClusters={applySemanticClusters} assets={project.assets} assetUsage={assetUsage} collections={project.assetCollections || []} onCollectionsChange={(assetCollections) => setProject((current) => ({ ...current, assetCollections }))} openWith={{ ...openWith, ...(project.openWith || {}) }} onOpenWith={launchAsset} onOpenWithChange={(extension, path) => { setOpenWith((current) => ({ ...current, [extension]: path })); setProject((current) => ({ ...current, openWith: { ...(current.openWith || {}), [extension]: path } })) }} onChange={(assets) => setProject((current) => ({ ...current, assets }))} onClose={closeAssetManager} onPopOut={assetManagerProjectId ? undefined : openAssetManagerWindow} onImport={importAssets} onRelink={relinkAsset} onRelinkMany={relinkAssets} onReveal={revealAsset} onMaterialize={materializeAssets} onCollect={collectActiveProject} onRepairDependencies={repairDependencies} canRollbackManaged={Boolean(managedRollback?.length)} onRollbackManaged={undoManagedSync} onGenerated={acceptGeneratedAsset} onSetCover={setBoardCover} onTrashAsset={trashProjectAsset} onRequestText={requestText} /></Suspense>}
{showRecovery && <section className="recovery-panel" aria-label="Project recovery"><header><div><span className="eyebrow">Recovery center</span><h2>Backups & interrupted operations</h2><p>Inspect the latest project backups and transaction journals before restoring anything.</p></div><button type="button" onClick={() => setShowRecovery(false)}>Close</button></header><div className="recovery-list">{recoveryEntries.length ? recoveryEntries.map((entry) => <article key={entry.relativePath}><strong>{entry.kind === 'backup' ? '↺ Backup' : '▤ Journal'}</strong><span>{entry.relativePath}</span><small>{formatBytes(entry.byteLength)} · {entry.modifiedAtUnixMs ? new Date(Number(entry.modifiedAtUnixMs)).toLocaleString() : 'unknown time'}</small>{workspace && <button type="button" onClick={() => void revealItemInDir(`${workspace.root.replace(/[\\/]+$/, '')}\\${entry.relativePath.replaceAll('/', '\\')}`)}>Reveal</button>}</article>) : <p>No backups or journal entries have been recorded for this project yet.</p>}</div></section>}
{showTrashViewer && (
        <section id="project-trash-viewer" className="trash-viewer" role="dialog" aria-label="Project trash" data-testid="trash-viewer" style={{ left: trashPlacement.left, bottom: trashPlacement.bottom, width: trashPlacement.width, maxHeight: trashPlacement.maxHeight }}>
          <header>
            <strong>Trash</strong>
            <small>{projectTrash.length === 1 ? '1 deleted item' : `${projectTrash.length} deleted items`} · deleted files are never removed from disk by the viewer</small>
            <button ref={trashCloseRef} type="button" onClick={() => { setShowTrashViewer(false); trashButtonRef.current?.focus() }}>Close</button>
          </header>
          <div className="trash-list">
            {projectTrash.length ? Object.entries(projectTrash.reduce<Record<string, TrashEntry[]>>((groups, entry) => {
              const day = entry.deletedAtUnixMs ? new Date(entry.deletedAtUnixMs).toLocaleDateString(undefined, { year: 'numeric', month: 'long', day: 'numeric' }) : 'Date unknown'
              ;(groups[day] ||= []).push(entry)
              return groups
            }, {})).sort(([, a], [, b]) => (b[0]?.deletedAtUnixMs || 0) - (a[0]?.deletedAtUnixMs || 0)).map(([day, entries]) => <section className="trash-day" key={day} aria-label={`Deleted ${day}`}>
              <h3>{day} <span>{entries.length}</span></h3>
              {entries.map((entry) => {
                const origin = entry.kind === 'board' ? 'Project boards' : entry.kind === 'document' ? 'Project documents' : entry.kind === 'asset' ? 'Asset catalog' : `Board: ${project.boards.find((board) => board.id === entry.boardId)?.title || 'a deleted board'}`
                const canRestore = canRestoreTrashEntry(project, entry)
                return <article className="trash-entry" key={entry.id}>
                  <TrashEntryPreview entry={entry} project={project} workspaceRoot={workspace?.root} />
                  <div className="trash-entry-detail">
                    <strong>{entry.title}</strong>
                    <small>{entry.kind === 'canvas-node' ? 'Canvas object' : entry.kind === 'asset' ? 'Asset' : entry.kind === 'document' ? 'Document' : 'Board'} · {origin}</small>
                    {entry.kind === 'board' && (entry.boards?.length || 0) > 1 && <small>{entry.boards!.length - 1} nested board{entry.boards!.length === 2 ? '' : 's'} · {entry.boardLinks?.reduce((count, link) => count + link.nodes.length, 0) || 0} links</small>}
                    {entry.kind === 'asset' && <small>{entry.placements?.length || 0} board placement{entry.placements?.length === 1 ? '' : 's'} · {entry.asset?.originalName || 'source name unavailable'}</small>}
                    <small>Deleted {entry.deletedAtUnixMs ? new Date(entry.deletedAtUnixMs).toLocaleTimeString() : 'at an unknown time'}</small>
                    {!canRestore && <small className="trash-restore-warning">Restore is unavailable here{entry.kind === 'canvas-node' ? ' because its original board is missing or the object ID is already in use' : entry.kind === 'document' && entry.document && project.documents.some((document) => document.id === entry.document?.id) ? ' because another document has the same ID' : entry.kind === 'asset' ? ' because a required board/card is missing or an ID is already in use' : entry.kind === 'board' ? ' because a board ID is already in use' : ''}.</small>}
                  </div>
                  <div className="trash-entry-actions">
                    <button type="button" disabled={!canRestore} title={canRestore ? `Restore ${entry.title}` : 'Restore is unavailable for this item'} onClick={() => restoreCanvasNode(entry)}>↶ Restore</button>
                    <button type="button" className="danger" onClick={() => deleteTrashEntryForever(entry)}>Remove recovery record…</button>
                  </div>
                </article>
              })}
            </section>) : <p className="trash-empty">Trash is empty. Deleted documents, canvas objects and boards land here.</p>}
          </div>
        </section>
      )}
{showWorksheets && <DailyWorksheets project={project} onChange={(worksheets) => setProject((current) => ({ ...current, worksheets }))} onClose={() => setShowWorksheets(false)} />}
{(() => {
        if (!previewAssetId) return null
        const previewAsset = project.assets.find((asset) => asset.id === previewAssetId && (asset.kind === 'image' || asset.kind === 'video' || asset.kind === 'model') && asset.status !== 'missing')
        if (!previewAsset) return null
        const previewList: ProjectAsset[] = []
        for (const node of activeBoard.nodes) {
          if ((node.kind !== 'image' && node.kind !== 'video' && node.kind !== 'model') || !node.assetId || previewList.some((entry) => entry.id === node.assetId)) continue
          const asset = project.assets.find((entry) => entry.id === node.assetId && (entry.kind === 'image' || entry.kind === 'video' || entry.kind === 'model') && entry.status !== 'missing')
          if (asset) previewList.push(asset)
        }
        const previewIndex = Math.max(0, previewList.findIndex((entry) => entry.id === previewAsset.id))
        const url = previewUrl(previewAsset)
        const kindLabel = previewAsset.kind === 'video' ? 'VIDEO' : previewAsset.kind === 'model' ? '3D MODEL' : previewAsset.extension.toUpperCase()
        const zoomable = previewAsset.kind !== 'model'
        const clampZoom = (next: number) => Math.min(8, Math.max(.25, next))
        const zoomTransform = { transform: `translate(${previewPan.x}px, ${previewPan.y}px) scale(${previewZoom})` }
        return <section className="asset-preview-overlay" role="dialog" aria-label="Full-size media preview">
          <header><strong title={previewAsset.originalName}>{previewAsset.displayName || previewAsset.originalName}</strong><small>{previewList.length > 1 ? `${previewIndex + 1} / ${previewList.length} · ` : ''}{kindLabel} · double-click the board card any time to reopen</small>
            <div>
              {previewList.length > 1 && <button type="button" title="Previous media on this board" onClick={() => setPreviewAssetId(previewList[(previewIndex - 1 + previewList.length) % previewList.length].id)}>‹ Prev</button>}
              {previewList.length > 1 && <button type="button" title="Next media on this board" onClick={() => setPreviewAssetId(previewList[(previewIndex + 1) % previewList.length].id)}>Next ›</button>}
              {zoomable && <button type="button" title="Zoom out" onClick={() => setPreviewZoom((current) => clampZoom(current / 1.25))}>−</button>}
              {zoomable && <span className="preview-zoom-readout" title="Current zoom · mouse wheel over the stage zooms too">{Math.round(previewZoom * 100)}%</span>}
              {zoomable && <button type="button" title="Zoom in" onClick={() => setPreviewZoom((current) => clampZoom(current * 1.25))}>＋</button>}
              {zoomable && <button type="button" title="Reset zoom and pan to fit" onClick={() => { setPreviewZoom(1); setPreviewPan({ x: 0, y: 0 }) }}>Fit</button>}
              <button type="button" title="Rename this file in the catalog" onClick={() => renamePreviewAsset(previewAsset)}>Rename</button>
              <button type="button" title="Open with your favorite application" onClick={() => openPreviewWith(previewAsset)}>Open with…</button>
              <button type="button" title="Open the file location in Explorer" onClick={() => void revealAsset(previewAsset)}>Show in Explorer</button>
              <button type="button" title="Save a copy to a folder of your choice" onClick={() => void downloadPreviewAsset(previewAsset)}>Download</button>
              <button type="button" title="Close the preview · Esc" onClick={() => setPreviewAssetId(null)}>Close</button>
            </div>
          </header>
          <div
            className={`asset-preview-stage ${previewZoomed ? 'zoomed' : ''} kind-${previewAsset.kind} ${zoomable && previewZoom > 1 ? 'pannable' : ''}`}
            onWheel={zoomable ? (event) => { setPreviewZoom((current) => clampZoom(current * (event.deltaY < 0 ? 1.15 : 1 / 1.15))) } : undefined}
            onClick={() => { if (previewDragRef.current) return; if (previewAsset.kind === 'image') setPreviewZoomed((current) => !current) }}
            onPointerDown={zoomable && previewZoom > 1 ? (event) => {
              const startX = event.clientX
              const startY = event.clientY
              const origin = { ...previewPan }
              const move = (moveEvent: PointerEvent) => {
                const dx = moveEvent.clientX - startX
                const dy = moveEvent.clientY - startY
                if (!previewDragRef.current && Math.hypot(dx, dy) > 4) previewDragRef.current = true
                if (previewDragRef.current) setPreviewPan({ x: origin.x + dx, y: origin.y + dy })
              }
              const finish = () => {
                window.removeEventListener('pointermove', move)
                window.removeEventListener('pointerup', finish)
                window.setTimeout(() => { previewDragRef.current = false }, 0)
              }
              window.addEventListener('pointermove', move)
              window.addEventListener('pointerup', finish)
            } : undefined}
          >
            {previewAsset.kind === 'model' ? (url ? <Suspense fallback={<p>Loading 3D model…</p>}><div className="asset-preview-model"><ModelViewer source={url} extension={previewAsset.extension} title={previewAsset.displayName || previewAsset.originalName} /></div></Suspense> : <p>The 3D preview needs the native desktop window.</p>)
              : previewAsset.kind === 'video' ? (url ? <video src={url} controls playsInline preload="metadata" style={zoomTransform} /> : <p>The video preview needs the native desktop window.</p>)
              : workspace?.root && validPyramid(previewAsset.imagePyramid) ? <div className="asset-preview-zoomable" style={zoomTransform}><TiledImagePreview pyramid={previewAsset.imagePyramid} posterUrl={workspaceAssetUrl(workspace.root, previewAsset.imagePyramid.posterRelativePath)!} tilesUrl={workspaceAssetUrl(workspace.root, previewAsset.imagePyramid.tilesRelativePath)!} alt={previewAsset.displayName} viewportScale={previewZoom} nativeSize={previewZoomed} /></div>
                : url ? <img src={url} alt={previewAsset.displayName || previewAsset.originalName} draggable={false} title={previewZoomed ? 'Click to fit' : 'Click for 1:1 pixels'} style={zoomTransform} /> : <p>The full-size preview needs the native desktop window.</p>}
          </div>
        </section>
      })()}
{showRecipes && <RecipeLibrary project={project} recipes={recipes} onRecipesChange={setRecipes} onProjectSnapshotsChange={(recipeSnapshots) => setProject((current) => ({ ...current, recipeSnapshots }))} onClose={() => setShowRecipes(false)} />}
{showPromptGenerator && <PromptGenerator project={project} recipes={recipes} onRecipesChange={setRecipes} onHistoryChange={(promptHistory) => setProject((current) => ({ ...current, promptHistory }))} onClose={() => setShowPromptGenerator(false)} />}
{showReferenceLibrary && <ReferenceLibraryPanel project={project} onChange={(referenceLibraries) => setProject((current) => ({ ...current, referenceLibraries }))} onAttach={(path) => void importAssetPaths([path])} onClose={() => setShowReferenceLibrary(false)} />}
{showMediaHealth && <div className="media-health-backdrop" role="dialog" aria-modal="true" aria-label="Media health review" onClick={(e) => { if (e.target === e.currentTarget) setShowMediaHealth(false) }}>
        <div className="media-health-modal">
          <MediaHealthReview readOnly={inspectorPermission.readOnly} onClose={() => setShowMediaHealth(false)} />
        </div>
      </div>}
{showFramingReview && <div className="framing-review-backdrop" role="dialog" aria-modal="true" aria-label="Artwork framing review" onClick={(e) => { if (e.target === e.currentTarget) setShowFramingReview(false) }}>
        <div className="framing-review-modal">
          <ArtworkFramingReview readOnly={inspectorPermission.readOnly} onClose={() => setShowFramingReview(false)} />
        </div>
      </div>}
{textPrompt && <TextEntryDialog request={textPrompt} onResolve={resolveTextPrompt} />}
<AppDialogHost onActiveChange={setAppDialogOpen} />
{!bootComplete && !isMiniBridgeWindow && <BootLoader
        image="/boot-splash-art.png"
        theme={theme}
        onThemeChange={setTheme}
        title={projectReady ? project.title : 'Art Equation Studio'}
        ready={settingsHydrated && (projectReady || bootStorageFailed)}
        onComplete={(layout:LaunchLayout) => {
          changeMode(layout==='advanced-split'?'split':'canvas');
          setShowNavigatorPanel(true);
          setShowInspectorDrawer(layout==='graphing');
          setCanvasUiPersonality(readCanvasUiPersonality());
          completeBoot()
        }}
      />}
</>,
status: <>
<footer className="status-bar">
        {imagePreparation.notice}
        <span className={workspace?.readOnly ? 'warning-dot' : 'ready-dot'} /><span>{status}</span>
        <span className="status-path" title={workspace?.root}>{workspace?.root || 'Portable workspace path pending'}</span>
        <span>{mode === 'split' ? compactSplit ? `Split · ${activeEditor === 'document' ? 'Document' : 'Canvas'}` : `${Math.round(effectiveSplit)} / ${Math.round(100 - effectiveSplit)}` : MODE_LABELS[mode]}</span>
      </footer>
</>,
focusBar: <>
{shellFocusWriting && <div className="document-focus-bar" role="region" aria-label="Focus writing workspace">
        <span className="document-focus-title" title={activeDocument.title}>{activeDocument.title}</span>
        {inspectorPermission.readOnly && <span className="document-focus-readonly">Read-only</span>}
        <button type="button" className="quiet-button" onClick={() => clearDocumentFocusWriting(true)}>Exit focus writing</button>
      </div>}
</>
}} />
  )
}

function TextEntryDialog({ request, onResolve }: { request: PendingTextPrompt; onResolve: (value: string | null) => void }) {
  const [value, setValue] = useState(request.initialValue || '')
  const inputRef = useRef<HTMLInputElement>(null)
  const dialogRef = useRef<HTMLFormElement>(null)
  useModalFocus(dialogRef, inputRef)
  useEffect(() => { inputRef.current?.focus(); inputRef.current?.select() }, [])
  function submit(event: React.FormEvent) {
    event.preventDefault()
    onResolve(value)
  }
  return <div className="text-entry-backdrop" onMouseDown={(event) => { if (event.target === event.currentTarget) onResolve(null) }}>
    <form ref={dialogRef} className="text-entry-dialog" role="dialog" aria-modal="true" aria-labelledby="text-entry-title" onSubmit={submit} onKeyDown={(event) => { event.stopPropagation(); if (event.key === 'Escape') { event.preventDefault(); onResolve(null) } }}>
      <header><span>ART EQUATION</span><button type="button" aria-label="Close dialog" onClick={() => onResolve(null)}>×</button></header>
      <h2 id="text-entry-title">{request.title}</h2>
      {request.helpText && <p className="text-entry-help">{request.helpText}</p>}
      <label htmlFor="text-entry-value">{request.label}</label>
      <input ref={inputRef} id="text-entry-value" value={value} onChange={(event) => setValue(event.target.value)} />
      <footer><button className="quiet-button" type="button" onClick={() => onResolve(null)}>Cancel</button><button className="primary-button" type="submit">{request.confirmLabel || 'Save'}</button></footer>
    </form>
  </div>
}

type ProjectBoardStripProps = {
  project: ProjectModel
  activeBoardId: string
  workspaceRoot?: string
  onOpen: (boardId: string) => void
  onCreate: () => void
  onDuplicate: () => void
  onRename: (board: BoardModel) => void
  onContextMenu: (boardId: string, x: number, y: number) => void
  onReorder: (boardIds: string[]) => void
  onHide: () => void
}

function ProjectBoardStrip({ project, activeBoardId, workspaceRoot, onOpen, onCreate, onDuplicate, onRename, onContextMenu, onReorder, onHide }: ProjectBoardStripProps) {
  const [draggedId, setDraggedId] = useState<string | null>(null)
  const rootBoards = project.boards.filter((board) => !board.parentBoardId)
  const activeRootId = boardAncestors(project.boards, activeBoardId)[0]?.id || activeBoardId
  const coverUrl = (board: BoardModel) => workspaceAssetUrl(workspaceRoot, assetCoverPath(boardCoverAsset(project, board)))
  const moveBefore = (targetId: string) => {
    if (!draggedId || draggedId === targetId) return
    const ids = project.boards.map((board) => board.id).filter((id) => id !== draggedId)
    ids.splice(Math.max(0, ids.indexOf(targetId)), 0, draggedId)
    onReorder(ids)
    setDraggedId(null)
  }
  return <section className="project-board-strip" aria-label="Project boards">
    <header><div><span>Root boards</span><strong>{rootBoards.length}</strong></div><button type="button" onClick={onCreate}>＋ Board</button><button type="button" onClick={onDuplicate}>Duplicate active</button><button type="button" aria-label="Hide project board strip" onClick={onHide}>Hide strip</button></header>
    <div className="project-board-cards">
      {rootBoards.map((board, index) => {
        const image = coverUrl(board)
        return <button className={board.id === activeRootId ? 'active' : ''} style={{ borderLeftColor: board.tileAccentColor }} type="button" key={board.id} draggable onDragStart={() => setDraggedId(board.id)} onDragEnd={() => setDraggedId(null)} onDragOver={(event) => event.preventDefault()} onDrop={() => moveBefore(board.id)} onContextMenu={(event) => { event.preventDefault(); onContextMenu(board.id, event.clientX, event.clientY) }} onKeyDown={(event) => { if (event.key !== 'ContextMenu' && !(event.shiftKey && event.key === 'F10')) return; event.preventDefault(); const rect = event.currentTarget.getBoundingClientRect(); onContextMenu(board.id, rect.left + 20, rect.top + 20) }} onClick={() => onOpen(board.id)} onDoubleClick={() => onRename(board)} title="Open root board · right-click or Shift+F10 for actions · drag to reorder · double-click to rename">
          <span className="project-board-cover" style={image ? coverImageStyle(image, board.coverFraming) : undefined}>{!image && <span className="cover-assignment-empty"><span aria-hidden="true">▧</span><small>Assign image</small></span>}</span>
          <span><strong>{board.title}</strong><small>{index + 1} · {board.nodes.length} card{board.nodes.length === 1 ? '' : 's'}</small></span>
        </button>
      })}
    </div>
  </section>
}

function documentTrashExcerpt(value: unknown): string {
  const parts: string[] = []
  const visit = (node: unknown) => {
    if (!node || typeof node !== 'object' || parts.join(' ').length >= 100) return
    const record = node as { text?: unknown; content?: unknown }
    if (typeof record.text === 'string') parts.push(record.text)
    if (Array.isArray(record.content)) record.content.forEach(visit)
  }
  visit(value)
  return parts.join(' ').trim().slice(0, 100)
}

function TrashEntryPreview({ entry, project, workspaceRoot }: { entry: TrashEntry; project: ProjectModel; workspaceRoot?: string }) {
  const node = entry.kind === 'canvas-node' ? entry.node : undefined
  const board = entry.kind === 'board' ? entry.board : undefined
  const document = entry.kind === 'document' ? entry.document : undefined
  const asset = entry.asset || project.assets.find((item) => item.id === (node?.assetId || (board ? boardCoverAssetId(project, board) : undefined)))
  const image = asset?.kind === 'image' ? workspaceAssetUrl(workspaceRoot, entry.trashThumbnailPath || (board ? assetCoverPath(asset) : assetPreviewPath(asset))) : undefined

  let framingStyle: React.CSSProperties | undefined
  if (node?.kind === 'image') {
    const framing = normalizeImageFraming(node.imageTransform)
    const flipX = node.imageTransform?.flipX ? -1 : 1
    const flipY = node.imageTransform?.flipY ? -1 : 1
    const rotation = node.imageTransform?.rotation || 0
    framingStyle = {
      objectFit: framing.fit,
      objectPosition: `${framing.positionX}% ${framing.positionY}%`,
      transform: `scale(${framing.zoom}) rotate(${rotation}deg) scale(${flipX}, ${flipY})`,
      transformOrigin: `${framing.positionX}% ${framing.positionY}%`,
      filter: node.imageTransform?.grayscale ? 'grayscale(1)' : undefined,
      opacity: typeof node.imageTransform?.opacity === 'number' ? node.imageTransform.opacity : undefined,
    }
  } else if (board?.coverFraming) {
    framingStyle = {
      objectPosition: `${board.coverFraming.x}% ${board.coverFraming.y}%`,
      transform: `scale(${board.coverFraming.zoom})`,
      transformOrigin: `${board.coverFraming.x}% ${board.coverFraming.y}%`,
    }
  }

  return <div className={`trash-entry-preview ${node?.kind === 'shape' ? `shape-${node.shapeType || 'rectangle'}` : ''}`} aria-label={image ? 'Saved image preview' : board ? 'Saved board summary' : document ? 'Saved document excerpt' : node ? `Saved ${node.kind} summary` : 'Saved item summary'}>
    {image ? <img src={image} alt="" loading="lazy" style={framingStyle} /> : document ? <><span className="trash-preview-symbol" aria-hidden="true">¶</span><small className="trash-preview-excerpt">{documentTrashExcerpt(document.content) || 'Document'}</small></> : board ? <BoardPreview board={board} assets={project.assets} width={110} height={110} fallbackBackground="transparent" /> : node?.kind === 'shape' ? <BoardPreview board={{ id: `trash-${entry.id}`, title: entry.title, viewport: { x: 0, y: 0, scale: 1 }, nodes: [node], connectors: [] }} width={110} height={110} fallbackBackground="transparent" /> : <><span className="trash-preview-symbol" aria-hidden="true">{node?.kind === 'text' || node?.kind === 'note' ? '¶' : node?.kind === 'video' ? '▶' : node?.kind === 'model' ? '◇' : '▤'}</span><small>{node?.kind || entry.kind}</small></>}
  </div>
}

type ProjectInspectorProps = {
  expanded?: boolean
  project: ProjectModel
  activeBoard: BoardModel
  selectedNodes: BoardNode[]
  readOnly: boolean
  onFitImageBounds: (id: string) => Promise<void>
  onSetColumnImageSizing: (id: string, sizing: NonNullable<BoardNode['columnImageSizing']>) => boolean
  onUpdateNode: (id: string, patch: Partial<BoardNode>) => boolean
  activeDocumentId: string
  workspaceRoot?: string
  statusText: string
  onStatusChange: (status: ProjectStatus) => void
  onOpenModule: (module: 'worksheets' | 'recipes' | 'prompts' | 'references' | 'assets') => void
  onOpenBoard: (boardId: string) => void
  onOpenDocument: (documentId: string) => void
  onTaskChange: (taskId: string, completed: boolean) => void
  onUseBoardCover: () => void
  onSetProjectCover: (assetId?: string, framing?: CoverFraming) => void
  onImportCoverImage: () => void
  onSetInspectorImage: (assetId?: string) => void
  onBrowseInspectorImage: () => void
  onImportInspectorImagePaths: (paths: string[]) => void
  onClose?: () => void
}

type DockScope = 'project' | 'document' | 'selection'
type InspectorSectionId = 'status' | 'tasks' | 'recipes' | 'references' | 'contents'

function ProjectInspector({ expanded, project, activeBoard, selectedNodes, readOnly, onFitImageBounds, onSetColumnImageSizing, onUpdateNode, activeDocumentId, workspaceRoot, statusText, onStatusChange, onOpenModule, onOpenBoard, onOpenDocument, onTaskChange, onUseBoardCover, onSetProjectCover, onImportCoverImage, onSetInspectorImage, onBrowseInspectorImage, onImportInspectorImagePaths, onClose }: ProjectInspectorProps) {
  const [dockScope, setDockScope] = useState<DockScope>(() => selectedNodes.length > 0 ? 'selection' : 'project')
  const prevSelectionLengthRef = useRef(selectedNodes.length)
  useEffect(() => {
    if (selectedNodes.length > 0 && prevSelectionLengthRef.current === 0) {
      setDockScope('selection')
    }
    if (selectedNodes.length === 0 && prevSelectionLengthRef.current > 0) {
      setDockScope('project')
    }
    prevSelectionLengthRef.current = selectedNodes.length
  }, [selectedNodes.length])

  const [coverPickerOpen, setCoverPickerOpen] = useState(false)
  const [coverDropActive, setCoverDropActive] = useState(false)
  const [inspectorPickerOpen, setInspectorPickerOpen] = useState(false)
  const [inspectorDropActive, setInspectorDropActive] = useState(false)
  const inspectorSlotRef = useRef<HTMLButtonElement>(null)
  const importInspectorPathsRef = useRef(onImportInspectorImagePaths)
  const inspectorReadOnlyRef = useRef(readOnly)
  inspectorReadOnlyRef.current = readOnly
  useEffect(() => {
    if (!readOnly) return
    setCoverPickerOpen(false)
    setInspectorPickerOpen(false)
    setCoverDropActive(false)
    setInspectorDropActive(false)
  }, [readOnly])
  importInspectorPathsRef.current = onImportInspectorImagePaths
  useEffect(() => {
    if (!('__TAURI_INTERNALS__' in window)) return
    let mounted = true
    let unlisten: (() => void) | undefined
    void Promise.all([getCurrentWindow().scaleFactor(), getCurrentWindow().innerSize(), Promise.resolve(getCurrentWebview())]).then(async ([scaleFactor, physicalSize, webview]) => {
      const stop = await webview.onDragDropEvent((event) => {
        if (!mounted || inspectorReadOnlyRef.current) { if (mounted) setInspectorDropActive(false); return }
        const slot = inspectorSlotRef.current
        if (!slot) return
        if (event.payload.type === 'leave') {
          setInspectorDropActive(false)
          return
        }
        const position = 'position' in event.payload ? event.payload.position : null
        if (!position) return
        const rect = slot.getBoundingClientRect()
        const candidates = nativeDragClientPositions(position, scaleFactor, physicalSize)
        const inside = candidates[0] ? positionInside(rect, candidates[0]) : false
        setInspectorDropActive(inside)
        if (event.payload.type === 'drop') {
          setInspectorDropActive(false)
          void invoke('record_frontend_diagnostic', { message: `inspector.drop paths=${event.payload.paths.length} inside=${inside} physical=${position.x},${position.y} scale=${scaleFactor} candidates=${candidates.map((point) => `${Math.round(point.x)},${Math.round(point.y)}`).join('|')}` }).catch(() => undefined)
          if (inside && event.payload.paths.length) importInspectorPathsRef.current(event.payload.paths)
        }
      })
      if (mounted) unlisten = stop
      else stop()
    }).catch(() => setInspectorDropActive(false))
    return () => {
      mounted = false
      unlisten?.()
    }
  }, [])
  const questionnaireValues = Object.entries(project.questionnaire).filter(([key]) => key !== 'date')
  const questionnaireDone = questionnaireValues.filter(([, value]) => String(value || '').trim() && value !== 'Undecided').length
  const progress = Math.round(questionnaireDone / Math.max(1, questionnaireValues.length) * 100)
  const today = new Date(Date.now() - new Date().getTimezoneOffset() * 60_000).toISOString().slice(0, 10)
  const todayWorksheet = project.worksheets?.find((worksheet) => worksheet.date === today)
  const tasks = todayWorksheet?.tasks || []
  const doneTasks = tasks.filter((task) => task.completed).length
  const coverPath = projectCoverRelativePath(project)
  const cover = workspaceAssetUrl(workspaceRoot, coverPath)
  const coverAssets = project.assets.filter((asset) => asset.kind === 'image' && asset.status !== 'missing')
  const inspectorImage = project.assets.find((asset) => asset.id === project.inspectorImageAssetId && asset.kind === 'image' && asset.status !== 'missing')
  const inspectorImageUrl = workspaceAssetUrl(workspaceRoot, assetPreviewPath(inspectorImage))
  const references = [...(project.referenceCrops || []).map((crop) => crop.title), ...(project.referenceLibraries || []).map((library) => library.name)]
  const recipeCount = project.recipeSnapshots?.length || 0
  const [collapsedSections, setCollapsedSections] = useState<Record<InspectorSectionId, boolean>>({ status: false, tasks: false, recipes: recipeCount === 0, references: references.length === 0, contents: false })
  const toggleSection = (section: InspectorSectionId) => setCollapsedSections((current) => ({ ...current, [section]: !current[section] }))
  const sectionToggle = (section: InspectorSectionId, label: string) => <button className="inspector-section-toggle" type="button" aria-expanded={!collapsedSections[section]} aria-label={`${label}: ${collapsedSections[section] ? 'collapsed' : 'expanded'}`} onClick={() => toggleSection(section)}><span>{label}</span><i aria-hidden>{collapsedSections[section] ? '›' : '⌄'}</i></button>
  const focusedNode = selectedNodes.length === 1 ? selectedNodes[0] : null
  const focusedBlock = focusedNode ? vectorEditBlockReason(activeBoard.nodes, focusedNode.id) : undefined

  return <aside className={`project-inspector ${expanded ? 'drawer-open' : ''}`} aria-label="Project and selection inspector">
    <div className="inspector-dock-header">
      <div className="inspector-dock-scopes" role="tablist" aria-label="Inspector scope">
        {(['project', 'document', 'selection'] as const).map((scope) => (
          <button
            key={scope}
            role="tab"
            type="button"
            id={`inspector-tab-${scope}`}
            aria-controls={`inspector-panel-${scope}`}
            aria-selected={dockScope === scope}
            tabIndex={dockScope === scope ? 0 : -1}
            className={`inspector-scope-tab ${dockScope === scope ? 'active' : ''}`}
            onClick={() => setDockScope(scope)}
            onKeyDown={(event) => {
              const scopes = ['project', 'document', 'selection'] as const
              const index = scopes.indexOf(scope)
              const next = event.key === 'ArrowRight' ? (index + 1) % scopes.length
                : event.key === 'ArrowLeft' ? (index + scopes.length - 1) % scopes.length
                  : event.key === 'Home' ? 0 : event.key === 'End' ? scopes.length - 1 : undefined
              if (next === undefined) return
              event.preventDefault()
              setDockScope(scopes[next])
              const tabs = event.currentTarget.parentElement?.querySelectorAll<HTMLButtonElement>('[role="tab"]')
              tabs?.[next]?.focus()
            }}
          >
            {scope[0].toUpperCase() + scope.slice(1)}
            {scope === 'selection' && selectedNodes.length > 0 ? ` (${selectedNodes.length})` : ''}
          </button>
        ))}
      </div>
      {onClose && <button className="inspector-drawer-close" type="button" aria-label="Close project inspector" onClick={onClose}>×</button>}
    </div>

    <div id="inspector-panel-project" role="tabpanel" aria-labelledby="inspector-tab-project" className="inspector-tab-content" hidden={dockScope !== 'project'}>
      <div className={`project-inspector-cover ${coverDropActive ? 'cover-drop-active' : ''}`} style={cover ? { ...coverImageStyle(cover, projectCoverFraming(project)), backgroundImage: `linear-gradient(180deg,transparent,#101116dd),url(${cover})` } : undefined} onDragOver={(event) => { event.preventDefault(); setCoverDropActive(!inspectorReadOnlyRef.current) }} onDragLeave={() => setCoverDropActive(false)} onDrop={(event) => { event.preventDefault(); setCoverDropActive(false); if (inspectorReadOnlyRef.current) return; const assetId = event.dataTransfer.getData('application/x-art-equation-asset-id'); if (coverAssets.some((asset) => asset.id === assetId)) { onSetProjectCover(assetId); setCoverPickerOpen(false) } }}>
        <span>Project inspector</span><h2>{project.title}</h2><div className="project-cover-actions"><button type="button" disabled={readOnly} onClick={() => { if (inspectorReadOnlyRef.current) return; setCoverPickerOpen((open) => !open) }}>{cover ? 'Change cover' : 'Set cover'}</button><button type="button" disabled={readOnly} onClick={onUseBoardCover}>Use board cover</button></div>
        {!readOnly && coverPickerOpen && <div className="project-cover-picker"><CoverArtworkPicker key={project.projectCoverAssetId || 'automatic'} title="Project image" assets={coverAssets} workspaceRoot={workspaceRoot} selectedId={project.projectCoverAssetId} framing={project.projectCoverFraming} onApply={(assetId, framing) => { if (inspectorReadOnlyRef.current) return; onSetProjectCover(assetId, framing); setCoverPickerOpen(false) }} onImport={() => { if (!inspectorReadOnlyRef.current) onImportCoverImage() }} onReset={() => { if (inspectorReadOnlyRef.current) return; onSetProjectCover(); setCoverPickerOpen(false) }} onClose={() => setCoverPickerOpen(false)} /></div>}
      </div>
      <section className={`inspector-status ${collapsedSections.status ? 'collapsed' : ''}`}>
        <header>{sectionToggle('status', 'Status')}<select value={project.status} aria-label="Project status" disabled={readOnly} onChange={(event) => onStatusChange(event.target.value as ProjectStatus)}><option value="planning">Planning</option><option value="active">Active</option><option value="review">Review</option><option value="complete">Complete</option><option value="on-hold">On hold</option></select></header>
        {!collapsedSections.status && <><div><span>Project brief</span><strong>{progress}%</strong></div><i><b style={{ width: `${progress}%` }} /></i><small>{questionnaireDone} of {questionnaireValues.length} planning fields complete</small></>}
      </section>
      <section className={collapsedSections.tasks ? 'collapsed' : ''}>
        <header>{sectionToggle('tasks', 'Today’s tasks')}<button type="button" onClick={() => onOpenModule('worksheets')}>{tasks.length ? `${doneTasks}/${tasks.length}` : 'Open'}</button></header>
        {!collapsedSections.tasks && <>{tasks.slice(0, 5).map((task) => <label className={`inspector-task ${task.completed ? 'done' : ''}`} key={task.id}><input type="checkbox" checked={task.completed} disabled={readOnly} onChange={(event) => onTaskChange(task.id, event.target.checked)} /><span>{task.title}</span></label>)}{!tasks.length && <button className="inspector-empty" type="button" onClick={() => onOpenModule('worksheets')}>Create today’s worksheet</button>}</>}
      </section>
      <section className={collapsedSections.recipes ? 'collapsed' : ''}>
        <header>{sectionToggle('recipes', 'Attached recipes')}<button type="button" onClick={() => onOpenModule('recipes')}>{recipeCount}</button></header>
        {!collapsedSections.recipes && <>{(project.recipeSnapshots || []).slice(0, 3).map((recipe) => <button className="inspector-link" type="button" key={recipe.id} onClick={() => onOpenModule('recipes')}><span>✦</span><strong>{recipe.title}</strong></button>)}{!recipeCount && <button className="inspector-empty" type="button" onClick={() => onOpenModule('recipes')}>Attach a visual recipe</button>}</>}
      </section>
      <section className={collapsedSections.references ? 'collapsed' : ''}>
        <header>{sectionToggle('references', 'Linked references')}<button type="button" onClick={() => onOpenModule('references')}>{references.length}</button></header>
        {!collapsedSections.references && <>{references.slice(0, 3).map((reference, index) => <button className="inspector-link" type="button" key={`${reference}-${index}`} onClick={() => onOpenModule('references')}><span>◉</span><strong>{reference}</strong></button>)}{!references.length && <button className="inspector-empty" type="button" onClick={() => onOpenModule('references')}>Add a reference library</button>}</>}
      </section>
      <section className={collapsedSections.contents ? 'collapsed' : ''}>
        <header>{sectionToggle('contents', 'Project contents')}<button type="button" onClick={() => onOpenModule('assets')}>{project.assets.length} assets</button></header>
        {!collapsedSections.contents && <><button className="inspector-link" type="button" onClick={() => onOpenBoard(activeBoard.id)}><span>▧</span><strong>{activeBoard.title}</strong><small>{activeBoard.nodes.length}</small></button>{project.documents.slice(0, 3).map((document) => <button className={`inspector-link ${document.id === activeDocumentId ? 'active' : ''}`} type="button" key={document.id} onClick={() => onOpenDocument(document.id)}><span>¶</span><strong>{document.title}</strong></button>)}</>}
      </section>
      <footer><span>{statusText}</span><small>Saved {new Date(project.updatedAt).toLocaleString()}</small><small>{project.promptHistory?.length || 0} prompts · {project.referenceCrops?.length || 0} crops · {project.boards.length} boards</small></footer>
      <div className="project-inspector-image-slot-wrap">
        <button ref={inspectorSlotRef} className={`project-inspector-image-slot ${inspectorDropActive ? 'drop-active' : ''} ${inspectorImageUrl ? 'has-image' : ''}`} type="button" disabled={readOnly} aria-label={inspectorImageUrl ? 'Change inspector image' : 'Add inspector image'} onClick={() => { if (inspectorReadOnlyRef.current) return; setInspectorPickerOpen((open) => !open) }} onDoubleClick={(event) => { event.preventDefault(); if (inspectorReadOnlyRef.current) return; setInspectorPickerOpen(false); onBrowseInspectorImage() }} onDragOver={(event) => { event.preventDefault(); setInspectorDropActive(!inspectorReadOnlyRef.current) }} onDragLeave={() => setInspectorDropActive(false)} onDrop={(event) => { event.preventDefault(); setInspectorDropActive(false); if (inspectorReadOnlyRef.current) return; const assetId = event.dataTransfer.getData('application/x-art-equation-asset-id'); if (coverAssets.some((asset) => asset.id === assetId)) { onSetInspectorImage(assetId); setInspectorPickerOpen(false); return } const paths = Array.from(event.dataTransfer.files).map((file) => (file as File & { path?: string }).path).filter((path): path is string => Boolean(path)); if (paths.length) onImportInspectorImagePaths(paths) }}>
          {inspectorImageUrl ? <img src={inspectorImageUrl} alt="Inspector reference" draggable={false} /> : <><span className="project-inspector-image-placeholder">＋</span><strong>Empty image slot</strong><small>Double-click or drop a project image</small></>}
        </button>
        {!readOnly && inspectorPickerOpen && <div className="project-cover-picker inspector-image-picker" role="dialog" aria-label="Choose inspector image"><header><strong>Inspector image</strong><button type="button" onClick={() => setInspectorPickerOpen(false)}>×</button></header>{coverAssets.length ? <div>{coverAssets.map((asset) => { const preview = workspaceAssetUrl(workspaceRoot, assetPreviewPath(asset)); return <button type="button" key={asset.id} draggable onDragStart={(event) => event.dataTransfer.setData('application/x-art-equation-asset-id', asset.id)} onClick={() => { if (inspectorReadOnlyRef.current) return; onSetInspectorImage(asset.id); setInspectorPickerOpen(false) }} title={`Use ${asset.displayName} in the inspector image slot`}><span style={preview ? { backgroundImage: `url(${preview})` } : undefined} /><small>{asset.displayName}</small></button> })}</div> : <p>Import an image to fill this slot.</p>}{inspectorImage && <button className="inspector-image-clear" type="button" onClick={() => { if (inspectorReadOnlyRef.current) return; onSetInspectorImage(undefined); setInspectorPickerOpen(false) }}>Clear image</button>}</div>}
      </div>
    </div>

    <div id="inspector-panel-document" role="tabpanel" aria-labelledby="inspector-tab-document" className="inspector-tab-content" hidden={dockScope !== 'document'}>
      <section className="inspector-document-pane">
        <header><span>Document inspector</span><small>{activeDocumentId === 'project-brief' ? 'Questionnaire' : 'Document'}</small></header>
        <h2>{activeDocumentId === 'project-brief' ? 'Project questionnaire' : (project.documents.find((d) => d.id === activeDocumentId)?.title || 'Document')}</h2>
        {activeDocumentId === 'project-brief' ? (
          <div className="inspector-document-brief-info">
            <p>Project brief fields have no text editor history. Answers are saved automatically with the project.</p>
            <div className="inspector-brief-progress">
              <span>Planning brief</span>
              <strong>{progress}% complete</strong>
              <i><b style={{ width: `${progress}%` }} /></i>
              <small>{questionnaireDone} of {questionnaireValues.length} planning fields complete</small>
            </div>
            <button type="button" className="inspector-link" onClick={() => onOpenDocument('project-brief')}>
              <span>¶</span><strong>Open questionnaire in editor</strong>
            </button>
          </div>
        ) : (
          <div className="inspector-document-details">
            {(() => {
              const doc = project.documents.find((d) => d.id === activeDocumentId)
              const contentStr = typeof doc?.content === 'string' ? doc.content : (doc?.content ? JSON.stringify(doc.content) : '')
              const wordCount = contentStr ? contentStr.replace(/<[^>]+>/g, ' ').trim().split(/\s+/).filter(Boolean).length : 0
              return (
                <>
                  <p>Page layout settings and document outline are configured in the editor toolbar.</p>
                  <div className="inspector-doc-stats">
                    <div><span>Word count</span><strong>{wordCount} words</strong></div>
                    <div><span>Theme</span><strong>{doc?.layout?.theme || 'Default'}</strong></div>
                  </div>
                  <button type="button" className="inspector-link" onClick={() => onOpenDocument(activeDocumentId)}>
                    <span>¶</span><strong>Focus this document</strong>
                  </button>
                </>
              )
            })()}
          </div>
        )}
        <div className="inspector-document-list">
          <header><span>Project documents</span><small>{project.documents.length}</small></header>
          {project.documents.map((document) => (
            <button key={document.id} type="button" className={`inspector-link ${document.id === activeDocumentId ? 'active' : ''}`} onClick={() => onOpenDocument(document.id)}>
              <span>¶</span><strong>{document.title}</strong>
            </button>
          ))}
        </div>
      </section>
    </div>

    <div id="inspector-panel-selection" role="tabpanel" aria-labelledby="inspector-tab-selection" className="inspector-tab-content" hidden={dockScope !== 'selection'}>
      {selectedNodes.length > 0 ? (
        <section className="inspector-selection" aria-label="Canvas selection">
          <header><span>Canvas selection</span><small>{selectedNodes.length === 1 ? '1 object' : `${selectedNodes.length} objects`}</small></header>
          {focusedNode ? (
            <>
              <strong title={focusedNode.title}>{focusedNode.title || focusedNode.kind}</strong>
              <p>{focusedNode.kind === 'shape' ? `${focusedNode.shapeType || 'rectangle'} shape` : focusedNode.kind}{focusedNode.locked ? ' · locked' : ''}</p>
              <div className="inspector-geometry">{(['x', 'y', 'width', 'height'] as const).map((field) => <label key={`${focusedNode.id}-${field}`}><span>{field === 'x' ? 'X' : field === 'y' ? 'Y' : field === 'width' ? 'Width' : 'Height'}</span><input key={`${focusedNode.id}-${field}-${focusedNode[field]}`} type="number" step="any" min={field === 'width' || field === 'height' ? 1 : undefined} defaultValue={focusedNode[field]} disabled={readOnly || Boolean(focusedBlock)} aria-label={`${field} of ${focusedNode.title || focusedNode.kind}`} onBlur={(event) => { const value = Number(event.target.value); const valid = event.target.value.trim() !== '' && Number.isFinite(value) && (field === 'x' || field === 'y' || value >= 1); if (!valid || (value !== focusedNode[field] && !onUpdateNode(focusedNode.id, { [field]: value }))) event.currentTarget.value = String(focusedNode[field]) }} onKeyDown={(event) => { if (event.key === 'Enter') event.currentTarget.blur() }} /></label>)}</div>
              {focusedNode.kind === 'shape' && <div className="inspector-appearance"><label>Fill <input type="color" value={/^#[0-9a-f]{6}$/i.test(focusedNode.color || '') ? focusedNode.color : '#7895ac'} disabled={readOnly || Boolean(focusedBlock)} onChange={(event) => onUpdateNode(focusedNode.id, { color: event.target.value })} /></label><label>Stroke <input type="color" value={/^#[0-9a-f]{6}$/i.test(focusedNode.strokeColor || '') ? focusedNode.strokeColor : '#c9d8e2'} disabled={readOnly || Boolean(focusedBlock)} onChange={(event) => onUpdateNode(focusedNode.id, { strokeColor: event.target.value })} /></label></div>}
              {focusedNode.kind === 'column' && <div className="inspector-column-layout" aria-label="Column layout">
                <label><span>Image sizing</span><select aria-label="Column image sizing" value={focusedNode.columnImageSizing || ''} disabled={readOnly || Boolean(focusedBlock) || Boolean(focusedNode.collapsed)} onChange={(event) => onSetColumnImageSizing(focusedNode.id, event.target.value as NonNullable<BoardNode['columnImageSizing']>)}>
                  {!focusedNode.columnImageSizing && <option value="" disabled>Saved layout</option>}
                  <option value="responsive">Responsive</option>
                  <option value="minimum-height">Minimum height</option>
                </select></label>
                <small>{focusedNode.collapsed ? 'Expand the column to change its image sizing.' : !focusedNode.columnImageSizing ? 'Keeps the saved layout until you choose an option.' : focusedNode.columnImageSizing === 'responsive' ? 'Uncropped artwork fits the column width and keeps its proportions.' : 'Uncropped artwork rows keep a minimum height of 78 board units.'} Cards and covers keep their framing.</small>
              </div>}
              {focusedNode.kind === 'image' && (
                <div className="inspector-image-framing" aria-label="Image framing">
                  <header><span>Framing &amp; Crop</span></header>
                  <label>
                    <span>Fit</span>
                    <select
                      aria-label="Image fit"
                      value={normalizeImageFraming(focusedNode.imageTransform).fit}
                      disabled={readOnly || Boolean(focusedBlock)}
                      onChange={(event) => onUpdateNode(focusedNode.id, { imageTransform: { ...focusedNode.imageTransform, fit: event.target.value as ImageTransform['fit'] } })}
                    >
                      <option value="contain">Contain — whole image</option>
                      <option value="cover">Cover — fill and crop</option>
                      <option value="fill">Stretch — change proportions</option>
                    </select>
                  </label>
                  <label>
                    <span>Horizontal position</span>
                    <input
                      type="range"
                      aria-label="Image horizontal position"
                      min="0"
                      max="100"
                      value={normalizeImageFraming(focusedNode.imageTransform).positionX}
                      disabled={readOnly || Boolean(focusedBlock)}
                      onChange={(event) => onUpdateNode(focusedNode.id, { imageTransform: { ...focusedNode.imageTransform, positionX: Number(event.target.value) } })}
                    />
                  </label>
                  <label>
                    <span>Vertical position</span>
                    <input
                      type="range"
                      aria-label="Image vertical position"
                      min="0"
                      max="100"
                      value={normalizeImageFraming(focusedNode.imageTransform).positionY}
                      disabled={readOnly || Boolean(focusedBlock)}
                      onChange={(event) => onUpdateNode(focusedNode.id, { imageTransform: { ...focusedNode.imageTransform, positionY: Number(event.target.value) } })}
                    />
                  </label>
                  <label>
                    <span>Crop zoom</span>
                    <input
                      type="number"
                      aria-label="Image crop zoom"
                      min="1"
                      max="4"
                      step="0.1"
                      value={normalizeImageFraming(focusedNode.imageTransform).zoom}
                      disabled={readOnly || Boolean(focusedBlock)}
                      onChange={(event) => onUpdateNode(focusedNode.id, { imageTransform: { ...focusedNode.imageTransform, zoom: Math.max(1, Math.min(4, Number(event.target.value) || 1)) } })}
                    />
                  </label>
                  <div className="inspector-image-actions">
                    {focusedNode.imagePresentation === 'artwork' && <button className="quiet-button compact" type="button" disabled={readOnly || Boolean(focusedBlock) || Boolean(focusedNode.parentColumnId)} onClick={() => void onFitImageBounds(focusedNode.id)}>Fit bounds to image</button>}
                    <button
                      className="quiet-button compact"
                      type="button"
                      disabled={readOnly || Boolean(focusedBlock)}
                      onClick={() => onUpdateNode(focusedNode.id, {
                        imageTransform: {
                          ...focusedNode.imageTransform,
                          fit: undefined,
                          positionX: undefined,
                          positionY: undefined,
                          zoom: undefined,
                        }
                      })}
                    >
                      Reset framing
                    </button>
                    <button
                      className="quiet-button compact"
                      type="button"
                      disabled={readOnly || Boolean(focusedBlock)}
                      onClick={() => onUpdateNode(focusedNode.id, {
                        imageTransform: {
                          ...focusedNode.imageTransform,
                          flipX: !focusedNode.imageTransform?.flipX,
                        }
                      })}
                    >
                      Flip H
                    </button>
                    <button
                      className="quiet-button compact"
                      type="button"
                      disabled={readOnly || Boolean(focusedBlock)}
                      onClick={() => onUpdateNode(focusedNode.id, {
                        imageTransform: {
                          ...focusedNode.imageTransform,
                          flipY: !focusedNode.imageTransform?.flipY,
                        }
                      })}
                    >
                      Flip V
                    </button>
                    <button
                      className="quiet-button compact"
                      type="button"
                      disabled={readOnly || Boolean(focusedBlock)}
                      onClick={() => onUpdateNode(focusedNode.id, {
                        imageTransform: {
                          ...focusedNode.imageTransform,
                          rotation: (((focusedNode.imageTransform?.rotation || 0) + 90) % 360) as 0 | 90 | 180 | 270,
                        }
                      })}
                    >
                      Rotate 90°
                    </button>
                  </div>
                  <small>Source file preserved. Framing never modifies original pixels.</small>
                </div>
              )}
              <small>Canvas handles and these numeric fields edit the same object.</small>
            </>
          ) : (
            <>
              <strong>{selectedNodes.length} objects selected</strong>
              <p>Move or edit the selection together on the canvas.</p>
              <small>Group bounds: {Math.round(Math.min(...selectedNodes.map((node) => node.x)))}, {Math.round(Math.min(...selectedNodes.map((node) => node.y)))} · {Math.round(Math.max(...selectedNodes.map((node) => node.x + node.width)) - Math.min(...selectedNodes.map((node) => node.x)))} × {Math.round(Math.max(...selectedNodes.map((node) => node.y + node.height)) - Math.min(...selectedNodes.map((node) => node.y)))}</small>
            </>
          )}
        </section>
      ) : (
        <section className="inspector-selection inspector-selection-empty" aria-label="Canvas selection">
          <header><span>Canvas selection</span><small>No object selected</small></header>
          <p className="proto-empty">Select artwork or an object on the canvas to inspect it.</p>
          <small>Click any shape, note, image, or container on the canvas or board.</small>
        </section>
      )}
    </div>
  </aside>
}

type CanvasPaneProps = {
  theme: 'navy' | 'dark' | 'light'
  canvasUiPersonality?: CanvasUiPersonality
  onOpenTrash?: () => void
  navigation?: React.ReactNode
  onFilmstripVisibilityChange?: (visible: boolean) => void
  onSelectionChange: (boardId: string, ids: string[]) => void
  revealRequest?: { boardId: string; nodeId: string; token: string }
  onMoveSelection: (sourceId: string, destinationId: string, ids: string[]) => boolean
  diagramTemplates: DiagramTemplate[]
  onSaveDiagramTemplate: (template: DiagramTemplate) => boolean
  
  
  
  
  
  board: BoardModel
  boards: BoardModel[]
  assets: ProjectAsset[]
  swatches: string[]
  workspaceRoot?: string
  projectId: string
  projectName: string
  readOnly?: boolean
  onFitImageBounds: (id: string) => Promise<void>
  onSetColumnImageSizing: ProjectInspectorProps['onSetColumnImageSizing']
  onBoardChange: (board: BoardModel, historyBase?: BoardModel | null, mergeKey?: string) => boolean
  onDerivedAsset: (asset: ProjectAsset, sourceNodeId: string) => void
  onImport: (kind: AssetKind) => void
  onDropFiles: (paths: string[], placement: { x: number; y: number }) => void
  onSwatchesChange: (swatches: string[]) => void
  onSwitchBoard: (boardId: string) => void
  onCreateBoard: () => void
  onCreateNestedBoard: (position?: { x: number; y: number }) => void
  onTrashBoard: (boardId: string) => Promise<void>
  onUpdateBoardTile: (boardId: string, update: Pick<BoardModel, 'tileAccentColor' | 'tileIcon' | 'coverAssetId' | 'coverFraming'>) => void
  onEditBoardImage: (boardId: string) => void
  onDuplicateBoard: () => void
  onDeleteBoard: () => void
  onRenameBoard: (board: BoardModel) => void
  onReorderBoards: (boardIds: string[]) => void
  onSetCover: (assetId?: string) => void
  onSetProjectThumbnail: (assetId: string) => void
  onTrashSelection: (boardId: string, nodeIds: string[]) => Promise<boolean>
  onPreviewImage: (assetId: string) => void
  onAddGeneratedAsset: (asset: ProjectAsset, node: BoardNode) => boolean
  onUndo: () => void
  onRedo: () => void
  openWith: Record<string, string>
  onOpenWith: (asset: ProjectAsset, applicationPath: string) => void
  onReplaceAsset: (asset: ProjectAsset) => void
  onPreparePyramid: (asset: ProjectAsset) => void
  onRequestText: (options: TextPromptOptions) => Promise<string | null>
}

function CanvasPane({ theme, canvasUiPersonality = 'classical', onOpenTrash, navigation, onFilmstripVisibilityChange, onSelectionChange, revealRequest, onMoveSelection, diagramTemplates, onSaveDiagramTemplate,  board: persistedBoard, boards, assets, swatches, workspaceRoot, projectId, projectName, readOnly, openWith, onOpenWith, onReplaceAsset, onPreparePyramid, onRequestText, onBoardChange: commitBoardChange, onFitImageBounds, onSetColumnImageSizing, onDerivedAsset, onImport, onDropFiles, onSwatchesChange, onSwitchBoard, onCreateBoard, onCreateNestedBoard, onTrashBoard, onUpdateBoardTile, onEditBoardImage, onDuplicateBoard, onDeleteBoard, onRenameBoard, onReorderBoards, onSetCover, onSetProjectThumbnail, onTrashSelection, onPreviewImage, onAddGeneratedAsset, onUndo, onRedo }: CanvasPaneProps) {
  const canvasSessionKey = `${projectId}/${persistedBoard.id}`
  const renderMode = 'vello' as const
  const stageRef = useRef<HTMLDivElement>(null)
  const [engineMediaOwnership,setEngineMediaOwnership]=useState<{sceneId:string;ids:readonly string[]}>({sceneId:'',ids:[]})
  const onEngineCardOwnership=useCallback((sceneId:string,ids:readonly string[])=>{setEngineMediaOwnership(previous=>previous.sceneId===sceneId&&previous.ids.length===ids.length&&previous.ids.every((id,i)=>id===ids[i])?previous:{sceneId,ids})},[])
  const engineMediaIds=useMemo(()=>new Set(engineMediaOwnership.sceneId===persistedBoard.id?engineMediaOwnership.ids:[]),[engineMediaOwnership,persistedBoard.id])
  const canonicalVectorPickerRef = useRef<ReturnType<typeof createCanonicalVectorPicker> | null>(null)
  useLayoutEffect(() => {
    // Construct in effect setup so StrictMode cleanup cannot leave a reused,
    // permanently disposed Paper scope attached to the canvas host.
    const picker = createCanonicalVectorPicker()
    canonicalVectorPickerRef.current = picker
    return () => {
      if (canonicalVectorPickerRef.current === picker) canonicalVectorPickerRef.current = null
      picker.dispose()
    }
  }, [])
  const [forcedPreviewIds, setForcedPreviewIds] = useState<string[]>([])
  const [gesturePresenter] = useState(() => new GesturePresenter(() => stageRef.current, ids => setForcedPreviewIds(current => {
    if (!ids.length) return current.length ? [] : current
    const added = ids.filter(id => !current.includes(id))
    return added.length ? [...current, ...added] : current
  })))
  const [overlayPresenter] = useState(() => new OverlayPresenter(() => stageRef.current))
  const { board, change: changeGestureBoard, beginPreview: beginBoardPreview, endPreview: endBoardPreview } = useGestureBoard(persistedBoard, commitBoardChange, gesturePresenter)
  const [frameScheduler] = useState(() => new FrameScheduler(appInputClock))
  const [inputMetrics] = useState(createInputMetrics)
  const presentationOnly = Boolean(new URLSearchParams(window.location.search).get('view-board'))
  const viewOnly = presentationOnly || Boolean(readOnly)
  const [toolStore] = useState(createToolStore)
  const selectionStore = useBoardSelectionStore(canvasSessionKey, persistedBoard, canvasSelectionByBoard.get(canvasSessionKey) || [])
  const [selectedIds, setSelectedIds] = useStoreField(selectionStore, 'selectedIds')
  const [showColor, setShowColor] = useState(() => { try { return localStorage.getItem('art-equation.production-studio-visible.2.5') !== '0' } catch { return true } })
  const [colorTarget, setColorTarget] = useState<ColorTarget>('fill')
  const [showGridSettings, setShowGridSettings] = useState(false)
  const [gridColorTarget, setGridColorTarget] = useState<'background' | 'grid'>('background')
  const [interactionTool, setInteractionTool] = useStoreField(toolStore, 'interactionTool')
  const freehandPathRef = useRef<SVGPathElement>(null)
  const [strokePreview] = useState(() => new StrokePreview({ request: requestAppFrame, cancel: cancelAppFrame }, path => {
    freehandPathRef.current?.setAttribute('d', path)
  }))
  useLayoutEffect(() => () => strokePreview.clear(), [strokePreview])
  const [drawingNotice, setDrawingNotice] = useState('')
  function onBoardChange(next: BoardModel, historyBase?: BoardModel | null, mergeKey?: string) {
    const bounded = safeFrameEdit(historyBase || persistedBoard, next)
    if (!bounded.ok) { setDrawingNotice(bounded.message); return }
    changeGestureBoard(bounded.board, historyBase, mergeKey)
  }
  const [eraserSize, setEraserSize] = useStoreField(toolStore, 'eraserSize')
  const [viewportTool, setViewportTool] = useStoreField(toolStore, 'viewportTool')
  const [presentedViewport, setPresentedViewport] = useState(board.viewport)
  const [liveCamera] = useState(() => new LiveCamera(board.viewport))
  const canvasCommitCount = useRef(0)
  const presentedViewportRef = useRef(board.viewport)
  const previousViewportRef = useRef<BoardViewport | null>(null)
  const [hasPreviousViewport, setHasPreviousViewport] = useState(false)
  const viewportCommitTimerRef = useRef<number | null>(null)
  const spacePanRef = useRef(false)
  const [shapeKind, setShapeKind] = useStoreField(toolStore, 'shapeKind')
  const [penPoints, setPenPoints] = useState<VectorPathPoint[]>([])
  const [penCloseHover, setPenCloseHover] = useState(false)
  const [incrementalPenPath] = useState(() => new IncrementalPenPath())
  const penDraftData = incrementalPenPath.sync(penPoints)
  const [, setPenPreview] = usePresentationValue(overlayPresenter, 'penPreview', null)
  // Live Bézier feedback while dragging out a new anchor's handles: `anchor` is
  // the pending anchor position and `cursor` trails the pointer, matching the
  // handles the committed point will receive.
  const [, setPenDragOut] = usePresentationValue(overlayPresenter, 'penDragOut', null)
  // WebView pointerdown events always report detail = 0, so the browser's own
  // double-click signal never arrives. Detect double taps from timing instead.
  const lastPenTapRef = useRef<{ x: number; y: number; at: number } | null>(null)
  const lastAnchorTapRef = useRef<{ key: string; at: number } | null>(null)
  // Leaving the Pen tool with anchors on screen must not strand them as an
  // unselectable ghost overlay. Commit two or more anchors as a real path; a
  // single stray anchor is discarded. The user's chosen tool is preserved.
  useEffect(() => {
    if (interactionTool !== 'pen' && penPoints.length) {
      if (penPoints.length >= 2) finishPenPath(penPoints, false, { keepTool: true })
      else { setPenPoints([]); setPenPreview(null); setPenDragOut(null) }
    }
  }, [interactionTool])
  const [connectorSourceId, setConnectorSourceId] = useState<string | null>(null)
  const [connectorSourcePort, setConnectorSourcePort] = useState<ConnectorPort>('right')
  const [nodeSocketSource, setNodeSocketSource] = useState<{ nodeId: string; socket: string } | null>(null)
  const nodeGraphDraftPathRef = useRef<SVGPathElement>(null)
  const [selectedConnectorId, setSelectedConnectorId] = useStoreField(selectionStore, 'selectedConnectorId')
  const [objectOptions, setObjectOptions] = useState<'connection' | 'image' | null>(null)
  const objectOptionsButtonRef = useRef<HTMLButtonElement>(null)
  const objectOptionsPanelRef = useRef<HTMLElement>(null)
  useEffect(() => { setObjectOptions(null) }, [selectedConnectorId, selectedIds.join('/')])
  useEffect(() => {
    if (!objectOptions) return
    objectOptionsPanelRef.current?.querySelector<HTMLElement>('select, button, input')?.focus()
    const outside = (event: PointerEvent) => {
      const target = event.target instanceof Element ? event.target : null
      if (!target?.closest('.object-options-panel, .object-options-trigger')) setObjectOptions(null)
    }
    const escape = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') return
      event.preventDefault(); event.stopPropagation()
      setObjectOptions(null); objectOptionsButtonRef.current?.focus()
    }
    window.addEventListener('pointerdown', outside, true)
    window.addEventListener('keydown', escape, true)
    return () => { window.removeEventListener('pointerdown', outside, true); window.removeEventListener('keydown', escape, true) }
  }, [objectOptions])
  const [selectedVectorPoint, setSelectedVectorPoint] = useStoreField(selectionStore, 'selectedVectorPoint')
  const [selectedVectorAnchorIndexes, setSelectedVectorAnchorIndexes] = useStoreField(selectionStore, 'selectedVectorAnchorIndexes')
  const [selectedVectorSegmentIndexes, setSelectedVectorSegmentIndexes] = useStoreField(selectionStore, 'selectedVectorSegmentIndexes')
  const [marquee, setMarquee] = usePresentationValue(overlayPresenter, 'marquee', null)
  const [marqueePreviewIds, setMarqueePreviewIds] = usePresentationValue(overlayPresenter, 'marqueePreviewIds', [])
  const [marqueePreviewAnchors, setMarqueePreviewAnchors] = usePresentationValue(overlayPresenter, 'marqueePreviewAnchors', [])
  const [marqueePreviewSegments, setMarqueePreviewSegments] = usePresentationValue(overlayPresenter, 'marqueePreviewSegments', [])
  const [connectorPreview] = usePresentationValue(overlayPresenter, 'connectorPreview', null)
  const [connectorDraft, setConnectorDraft] = usePresentationValue(overlayPresenter, 'connectorDraft', null)
  const [showFilmstrip, setShowFilmstrip] = useState(() => localStorage.getItem('art-equation.canvas-filmstrip') !== '0')
  useEffect(() => onFilmstripVisibilityChange?.(showFilmstrip), [onFilmstripVisibilityChange, showFilmstrip])
  const [showToolRail, setShowToolRail] = useState(true)
  const [showMoreCanvasTools, setShowMoreCanvasTools] = useState(false)
  useEffect(() => {
    if (!showMoreCanvasTools) return
    const dismissOnPointer = (event: PointerEvent) => {
      const target = event.target instanceof Element ? event.target : null
      if (!target?.closest('.canvas-subtools, .tool-rail-more')) setShowMoreCanvasTools(false)
    }
    const dismissOnEscape = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') return
      const submenu = stageRef.current?.querySelector('.canvas-subtools')
      const ownsFocus = Boolean(submenu?.contains(document.activeElement))
      setShowMoreCanvasTools(false)
      if (!ownsFocus) return
      const opener = stageRef.current?.querySelector<HTMLButtonElement>('.tool-rail-more')
      if (opener?.isConnected && !opener.closest('[hidden],[inert]') && opener.getClientRects().length) opener.focus({ preventScroll: true })
    }
    window.addEventListener('pointerdown', dismissOnPointer, true)
    window.addEventListener('keydown', dismissOnEscape)
    return () => { window.removeEventListener('pointerdown', dismissOnPointer, true); window.removeEventListener('keydown', dismissOnEscape) }
  }, [showMoreCanvasTools])
  const [showUnsorted, setShowUnsorted] = useState(false)
  const [showTransferDialog, setShowTransferDialog] = useState(false)
  const [showDiagramStructure, setShowDiagramStructure] = useState(false)
  const [diagramPalette, setDiagramPalette] = useState<{ mode: 'create' | 'successor' | 'insert'; sourceId?: string; connectorId?: string; left: number; top: number } | null>(null)
  const diagramOpenerRef = useRef<HTMLButtonElement | null>(null)
  const transferButtonRef = useRef<HTMLButtonElement>(null)
  const revealedToken = useRef<string | null>(null)
  const [showHierarchy, setShowHierarchy] = useState(false)
  const [draggedBoardId, setDraggedBoardId] = useState<string | null>(null)
  const [dropFeedback, setDropFeedback] = useState<{ count: number; x: number; y: number } | null>(null)
  const [captureEditor, setCaptureEditor] = useState<{ nodeId?: string; assetId?: string; initialValue: CapturedContent } | null>(null)
  const [columnDropTarget, setColumnDropTarget] = usePresentationValue(overlayPresenter, 'columnDropTarget', null)
  const [columnDragIds, setColumnDragIds] = useState<string[]>([])
  const [grayscalePreview, setGrayscalePreview] = useState(false)
  const [rotationReadout, setRotationReadout] = usePresentationValue(overlayPresenter, 'rotationReadout', null)
  const [cornerRadiusReadout, setCornerRadiusReadout] = usePresentationValue(overlayPresenter, 'cornerRadiusReadout', null)
  const [contextMenu, setContextMenu] = useState<{ x: number; y: number; nodeId?: string } | null>(null)
  const [tileAppearance, setTileAppearance] = useState<{ boardId: string; x: number; y: number } | null>(null)
  const [showAssets, setShowAssets] = useState(false)
  const [showAppearance, setShowAppearance] = useState(false)
  const [showStudioObject, setShowStudioObject] = useState(false)
  function selectStudioTab(tab: 'color' | 'layers' | 'object' | 'workspace' | 'grid') {
    setShowColor(tab === 'color')
    setShowHierarchy(tab === 'layers')
    setShowGridSettings(tab === 'grid')
    setShowAppearance(tab === 'workspace')
    setShowStudioObject(tab === 'object')
  }
  function showStudio(visible: boolean) {
    if (visible) selectStudioTab('color')
    else { setShowColor(false); setShowHierarchy(false); setShowGridSettings(false); setShowAppearance(false); setShowStudioObject(false) }
  }
  useEffect(() => {
    const show = () => showStudio(true)
    window.addEventListener('art-equation:show-studio', show)
    return () => window.removeEventListener('art-equation:show-studio', show)
  }, [])
  useEffect(() => {
    const openBoardAppearance = () => {
      if (viewOnly) return
      const bounds = stageBoundsRef.current
      if (!bounds) return
      setTileAppearance({ boardId: board.id, x: Math.max(8, Math.min(bounds.left + 12, window.innerWidth - 340)), y: Math.max(8, Math.min(bounds.top + 12, window.innerHeight - 420)) })
    }
    window.addEventListener('art-equation:board-tile-appearance', openBoardAppearance)
    return () => window.removeEventListener('art-equation:board-tile-appearance', openBoardAppearance)
  }, [board.id, viewOnly])

  const [showLayoutResearch, setShowLayoutResearch] = useState(false)
  const [showSvgDrawing, setShowSvgDrawing] = useState(false)
  const [showBoardExport, setShowBoardExport] = useState(false)
  const [boardExportTarget, setBoardExportTarget] = useState<'viewport' | 'full' | 'selection' | 'frame'>('viewport')
  const [boardExportFormat, setBoardExportFormat] = useState<'png' | 'jpeg'>('png')
  const [boardExportScale, setBoardExportScale] = useState<.5 | 1 | 2 | 4>(1)
  const [guideLines, setGuideLines] = usePresentationValue(overlayPresenter, 'guideLines', [])
  const [stageSize, setStageSize] = useState({ width: 1200, height: 800 })
  const [showCanvasDiagnostics, setShowCanvasDiagnostics] = useState(false)
  const [showZoomMenu, setShowZoomMenu] = useState(false)
  const [showMinimap, setShowMinimap] = useState(() => localStorage.getItem('art-equation.canvas-minimap') !== '0')
  useEffect(() => {
    localStorage.setItem('art-equation.canvas-filmstrip', showFilmstrip ? '1' : '0')
    localStorage.setItem('art-equation.canvas-minimap', showMinimap ? '1' : '0')
  }, [showFilmstrip, showMinimap])
  const [canvasFrameRate, setCanvasFrameRate] = useState<number | null>(null)
  const stageBoundsRef = useRef<DOMRect | null>(null)
  const boardRef = useRef(board)
  const onDropFilesRef = useRef(onDropFiles)
  const selectionHandledOnPointerDownRef = useRef(false)
  const marqueeCancelRef = useRef<(() => void) | null>(null)
  const marqueeClickSuppressRef = useRef(false)
  const transformClickSuppressRef = useRef(false)
  const transformClickSuppressTimerRef = useRef<number | null>(null)
  const transformClickBlockerRef = useRef<((event: MouseEvent) => void) | null>(null)
  const transformClickIgnoreUntilRef = useRef(0)
  const activeGestureCancelRef = useRef<(() => void) | null>(null)
  const commitBoardChangeRef = useRef(commitBoardChange)
  useOverlayContext(overlayPresenter, { board, penPoints, selectedIds, columnDragIds, scale: liveCamera.current.scale })
  useLayoutEffect(() => { canvasSelectionByBoard.set(canvasSessionKey, selectedIds); onSelectionChange(persistedBoard.id, selectedIds) }, [canvasSessionKey, onSelectionChange, persistedBoard.id, selectedIds])
  const previousCanvasSession = useRef({ key: canvasSessionKey, board: persistedBoard, commit: commitBoardChange })
  useLayoutEffect(() => {
    const previous = previousCanvasSession.current
    if (previous.key !== canvasSessionKey) {
      const pendingCamera = presentedViewportRef.current
      if (viewportCommitTimerRef.current !== null) {
        window.clearTimeout(viewportCommitTimerRef.current); viewportCommitTimerRef.current = null
        if (previous.board.viewport.x !== pendingCamera.x || previous.board.viewport.y !== pendingCamera.y || previous.board.viewport.scale !== pendingCamera.scale)
          previous.commit({ ...previous.board, viewport: pendingCamera }, null)
      }
      activeGestureCancelRef.current?.(); marqueeCancelRef.current?.()
      frameScheduler.clear(); gesturePresenter.clear(persistedBoard); overlayPresenter.clear()
      setForcedPreviewIds([]); setColumnDragIds([]); strokePreview.clear(); setPenPoints([])
      setPenCloseHover(false); setTypeDraft(null); setGraphEditorId(null)
      setConnectorSourceId(null); setNodeSocketSource(null); setSelectedConnectorId(null)
      setSelectedVectorPoint(null); setSelectedVectorAnchorIndexes([]); setSelectedVectorSegmentIndexes([])
      setContextMenu(null); setTileAppearance(null); setCaptureEditor(null); setDiagramPalette(null)
      setDropFeedback(null); setObjectOptions(null); setShowTransferDialog(false); setShowBoardExport(false)
      setInteractionTool('select'); setViewportTool('select'); setDrawingNotice('')
      previousViewportRef.current = null; setHasPreviousViewport(false); spacePanRef.current = false
      lastPenTapRef.current = null; lastAnchorTapRef.current = null; mountedMembership.current = ''
      revealedToken.current = null; stageRef.current?.classList.remove('viewport-panning')
      if (transformClickSuppressTimerRef.current !== null) window.clearTimeout(transformClickSuppressTimerRef.current)
      transformClickSuppressTimerRef.current = null
      if (transformClickBlockerRef.current) window.removeEventListener('click', transformClickBlockerRef.current, true)
      transformClickBlockerRef.current = null; transformClickSuppressRef.current = false
      selectionHandledOnPointerDownRef.current = false; marqueeClickSuppressRef.current = false
      recordMetric('canvas.session-switch', { from: previous.board.id, to: persistedBoard.id, hostRetained: true })
    }
    previousCanvasSession.current = { key: canvasSessionKey, board: persistedBoard, commit: commitBoardChange }
  }, [canvasSessionKey, persistedBoard, commitBoardChange, frameScheduler, gesturePresenter, overlayPresenter])
  useLayoutEffect(() => { boardRef.current = board; onDropFilesRef.current = onDropFiles; commitBoardChangeRef.current = commitBoardChange }, [board, commitBoardChange, onDropFiles])
  useEffect(() => () => vectorGeometryCache.clear(), [board.id])
  const assetById = useMemo(() => new Map(assets.map((asset) => [asset.id, asset])), [assets])
  const linkedBoardById = useMemo(() => new Map(boards.map(entry => [entry.id, entry])), [boards])
  const nodeById = useMemo(() => new Map(board.nodes.map((node) => [node.id, node])), [board.nodes])
  const isMilanote = canvasUiPersonality === 'milanote'
  const activeCanvasThemeColors = isMilanote ? MILANOTE_CANVAS_THEME_COLORS : CANVAS_THEME_COLORS
  const darkCanvasBg = activeCanvasThemeColors.dark.background
  const lightCanvasBg = activeCanvasThemeColors.light.background
  const navyCanvasBg = activeCanvasThemeColors.navy.background
  const darkCanvasGrid = activeCanvasThemeColors.dark.grid
  const lightCanvasGrid = activeCanvasThemeColors.light.grid
  const navyCanvasGrid = activeCanvasThemeColors.navy.grid
  const backgroundFollowsTheme = board.backgroundFollowsTheme === true || (board.backgroundFollowsTheme !== false && (!board.backgroundColor || board.backgroundColor === DARK_BOARD_BACKGROUND || board.backgroundColor === LIGHT_BOARD_BACKGROUND || board.backgroundColor === MILANOTE_CANVAS_THEME_COLORS.dark.background || board.backgroundColor === MILANOTE_CANVAS_THEME_COLORS.light.background))
  const effectiveBoardBackground = backgroundFollowsTheme ? (theme === 'navy' ? navyCanvasBg : theme === 'light' ? lightCanvasBg : darkCanvasBg) : board.backgroundColor!
  const gridFollowsTheme = !board.gridColor || board.gridColor === DARK_GRID_COLOR || board.gridColor === LIGHT_GRID_COLOR || board.gridColor === MILANOTE_CANVAS_THEME_COLORS.dark.grid || board.gridColor === MILANOTE_CANVAS_THEME_COLORS.light.grid
  const effectiveGridColor = gridFollowsTheme ? (theme === 'navy' ? navyCanvasGrid : theme === 'light' ? lightCanvasGrid : darkCanvasGrid) : board.gridColor!
  

  



  const modelAssetSources = useMemo(() => new Map(assets.flatMap(asset => {
    const source = workspaceAssetUrl(workspaceRoot, asset.status === 'moved' ? asset.managedRelativePath || asset.relativePath : asset.relativePath)
    const tiles=asset.imagePyramid?workspaceAssetUrl(workspaceRoot,asset.imagePyramid.tilesRelativePath):undefined
    const overviewPath=asset.imagePyramid?.posterRelativePath || asset.thumbnailRelativePath
    const overview=overviewPath?workspaceAssetUrl(workspaceRoot,overviewPath):undefined
    return [...(source ? [[asset.id, source] as const] : []),...(tiles?[[asset.id+":tiles",tiles] as const]:[]),...(overview?[[asset.id+':overview',overview] as const]:[])]
  })), [assets, workspaceRoot])
  const canvasScene = useMemo(() => createArtEquationCanvasScene({
    id: board.id,
    nodes: board.nodes,
    connectors: board.connectors,
    gridVisible: board.gridVisible,
    gridOpacity: board.gridOpacity,
    gridSpacing: board.gridSpacing,
  }, assets, { background: effectiveBoardBackground, grid: effectiveGridColor }, modelAssetSources), [assets, board.connectors, board.gridOpacity, board.gridSpacing, board.gridVisible, board.id, board.nodes, effectiveBoardBackground, effectiveGridColor, modelAssetSources])
  const [liveCanvasScene] = useState(() => new LiveCanvasScene(canvasScene))
  const committedCanvasSceneRef = useRef(canvasScene)
  useLayoutEffect(() => {
    committedCanvasSceneRef.current = canvasScene
    liveCanvasScene.present(canvasScene)
  }, [canvasScene, liveCanvasScene])
  useLayoutEffect(() => gesturePresenter.subscribeBoard(preview => {
    liveCanvasScene.present(preview
      ? createArtEquationCanvasScene(preview, assets, { background: effectiveBoardBackground, grid: effectiveGridColor }, modelAssetSources)
      : committedCanvasSceneRef.current)
  }), [gesturePresenter, liveCanvasScene, assets, effectiveBoardBackground, effectiveGridColor, modelAssetSources])
  const [indexedScene, setIndexedScene] = useState(() => ({ objects: canvasScene.objects, index: new UniformGridSpatialIndex(canvasScene.objects) }))
  let spatialIndex = indexedScene.index
  if (indexedScene.objects !== canvasScene.objects) {
    spatialIndex = indexedScene.index.fork(canvasScene.objects)
    setIndexedScene({ objects: canvasScene.objects, index: spatialIndex })
  }
  // Broad-phase geometry is camera independent. SVG non-scaling strokes and
  // their semantic hit proxies need a camera-dependent query margin instead.
  const vectorQueryOutsetCssPx = useMemo(() => canvasScene.objects.reduce((outset, object) => {
    const geometry = object.preparedVectorGeometry
    return geometry?.status === 'ready' && geometry.bounds
      ? Math.max(outset, geometry.strokeOutsetCssPx, geometry.hitOutsetCssPx ?? 0) : outset
  }, 12), [canvasScene.objects])
  const selectedNode = nodeById.get(selectedIds.at(-1) || '')
  const selectedNodes = selectedIds.map((id) => nodeById.get(id)).filter((node): node is BoardNode => Boolean(node))
  const directPolicy = vectorDirectSelectionPolicy(board.nodes, selectedIds)
  const colorTargets = sharedColorTargets(selectedNodes)
  const effectiveColorTarget = colorTargets.includes(colorTarget) ? colorTarget : colorTargets[0] || colorTarget
  const colorTitle = selectedNodes.length > 1 ? `${selectedNodes.length} selected objects` : selectedNode ? nodeTitle(selectedNode) : 'Select a board object'
  const colorValue = selectedNode ? (effectiveColorTarget === 'columnBody' ? selectedNode.columnBodyColor || (selectedNode.graphColumn ? selectedNode.color || '#34546c' : '#24303f') : effectiveColorTarget === 'fill' ? selectedNode.color : effectiveColorTarget === 'stroke' ? selectedNode.strokeColor : selectedNode.textColor) || (effectiveColorTarget === 'text' ? readableForeground(selectedNode.color || '#d7a36a') : selectedNode.color) || '#d7a36a' : '#d7a36a'
  const colorContrastBackground = effectiveColorTarget === 'text' ? selectedNode?.color || effectiveBoardBackground : effectiveBoardBackground
  const hierarchyProjection = useMemo(() => (showHierarchy || showColor) ? projectDrawingLayers(board.nodes) : {ok:true as const,value:[]}, [board.nodes, showHierarchy, showColor])
  const selectedHierarchyStates=useMemo(()=>new Map(selectedIds.map(id=>{const state=diagramState(board.nodes,id);return [id,state.ok?state.value:{locked:true,hidden:true}] as const})),[board.nodes,selectedIds])
  const hierarchyRows = hierarchyProjection.ok ? hierarchyProjection.value : []
  const contextNode = contextMenu?.nodeId ? nodeById.get(contextMenu.nodeId) : undefined
  const selectedVectorPathNodes = selectedIds.map((id) => nodeById.get(id)).filter((node): node is BoardNode => Boolean(node?.shapeType === 'path' && node.vectorPath))
  const canJoinPaths = selectedVectorPathNodes.length === 2 && selectedVectorPathNodes.every((node) => !node.vectorPath?.closed)
  const canBooleanPaths = selectedVectorPathNodes.length === 2 && selectedVectorPathNodes.every((node) => Boolean(node.vectorPath?.closed))
  const selectedConnector = board.connectors.find((connector) => connector.id === selectedConnectorId)
  const visibleDiagramIds = useMemo(() => { const result = visibleDiagramNodeIds(board.nodes); return new Set(result.ok ? result.value : []) }, [board.nodes])
  const nodePaintOrder = useMemo(() => { const result = containerPaintOrder(board.nodes); return result.ok ? result.value.zIndexById : new Map<string, number>() }, [board.nodes])
  const unsortedCount = useMemo(() => board.nodes.filter((node) => node.kind !== 'column' && node.kind !== 'group' && !node.parentColumnId && !node.groupId).length, [board.nodes])
  const viewportMargin = Math.max(360, vectorQueryOutsetCssPx) / presentedViewport.scale
  const visibleWorld = {
    left: -presentedViewport.x / presentedViewport.scale - viewportMargin,
    top: -presentedViewport.y / presentedViewport.scale - viewportMargin,
    right: (stageSize.width - presentedViewport.x) / presentedViewport.scale + viewportMargin,
    bottom: (stageSize.height - presentedViewport.y) / presentedViewport.scale + viewportMargin,
  }
  const visibleSceneObjects = spatialIndex.query({ x: visibleWorld.left, y: visibleWorld.top, width: visibleWorld.right - visibleWorld.left, height: visibleWorld.bottom - visibleWorld.top })
  for (const id of [...selectedIds, ...forcedPreviewIds]) {
    const selected = spatialIndex.get(id)
    if (selected && !visibleSceneObjects.some((object) => object.id === id)) visibleSceneObjects.push(selected)
  }
  visibleSceneObjects.sort((a, b) => a.order - b.order)
  const visibleNodes = visibleSceneObjects.map((object) => nodeById.get(object.id)).filter((node): node is BoardNode => {
    if (!node) return false
    return visibleDiagramIds.has(node.id)
  })
  const visibleColumnKey=visibleNodes.filter(node=>node.kind==='column').map(node=>node.id).join('\n')
  const columnChildrenById=useMemo(()=>{
    const map=new Map<string,BoardNode[]>()
    const ids=visibleColumnKey?visibleColumnKey.split('\n'):[]
    for(const id of ids)map.set(id,[])
    for(const item of computeFlatColumnCoordinates(board,ids)){const child=nodeById.get(item.id);if(child)map.get(item.columnId)?.push(child)}
    return map
  },[board.nodes,nodeById,visibleColumnKey])
  const nodeGraphPortsById = new Map<string, ReturnType<typeof nodeGraphPorts>>()
  for (const node of visibleNodes) if (nodeGraphOwner(board, node, nodeById)) nodeGraphPortsById.set(node.id, nodeGraphPorts(board, node, nodeById))
  const visibleMediaCount = visibleNodes.filter((node) => node.kind === 'image' || node.kind === 'video' || node.kind === 'model').length
  const mountedMembership = useRef('')
  useLayoutEffect(() => {
    mountedMembership.current = visibleNodes.map(node => node.id).sort().join('\n')
    presentCamera(stageRef.current, liveCamera.current, MIN_CANVAS_ZOOM, MAX_CANVAS_ZOOM)
    if (stageRef.current) stageRef.current.dataset.reactCommits = String(++canvasCommitCount.current)
  })
  useLayoutEffect(() => {
    // The saved Boolean cutters alter the whole original CSS appearance. This
    // disposable clip preserves its border, shadow and text on the DOM path.
    // Commit before paint, including newly mounted virtualized rectangles.
    const stage = stageRef.current
    if (!stage) return
    const byId = new Map(visibleNodes.map(node => [node.id, node]))
    for (const article of stage.querySelectorAll<HTMLElement>('article.board-node[data-node-id]')) {
      const node = byId.get(article.dataset.nodeId ?? '')
      if (!node || !isRectangleErasure(node)) {
        if (article.dataset.rectangleErasureClip === 'true') {
          delete article.dataset.rectangleErasureClip
          article.style.removeProperty('clip-path')
        }
        continue
      }
      article.dataset.rectangleErasureClip = 'true'
      const captured = captureRectangleErasureCssClip(article, node)
      if (captured && article.style.clipPath !== captured.clipPath) article.style.clipPath = captured.clipPath
    }
  })
  const devicePixelRatio = Math.max(1, window.devicePixelRatio || 1)
  const renderScale = Math.max(1, Math.min(2, devicePixelRatio, Math.sqrt(16_777_216 / Math.max(1, stageSize.width * stageSize.height))))
  const estimatedRenderPixels = Math.round(stageSize.width * stageSize.height * renderScale ** 2)
  const estimatedRenderBytes = estimatedRenderPixels * 4

  useEffect(() => {
    if (!showCanvasDiagnostics) return
    let frameId = 0
    let frames = 0
    let startedAt = performance.now()
    const sample = (now: number) => {
      frames += 1
      const elapsed = now - startedAt
      if (elapsed >= 750) {
        setCanvasFrameRate(Math.round((frames * 1000) / elapsed))
        frames = 0
        startedAt = now
      }
      frameId = requestAppFrame(sample)
    }
    frameId = requestAppFrame(sample)
    return () => cancelAppFrame(frameId)
  }, [showCanvasDiagnostics])

  function capturePointer(event: React.PointerEvent | React.MouseEvent): () => void {
    cancelActiveGesture()
    frameScheduler.cancel('pen-hover')
    beginBoardPreview()
    const target = event.currentTarget as Element & { setPointerCapture?: (pointerId: number) => void; hasPointerCapture?: (pointerId: number) => boolean; releasePointerCapture?: (pointerId: number) => void }
    const pointerId = 'pointerId' in event ? event.pointerId : undefined
    if (typeof pointerId !== 'number') return () => undefined
    try { target.setPointerCapture?.(pointerId) } catch { /* the target may have been removed during a fast gesture */ }
    return () => {
      try {
        if (target.hasPointerCapture?.(pointerId)) target.releasePointerCapture?.(pointerId)
      } catch { /* pointer capture is best-effort across WebView implementations */ }
    }
  }

  function publishInputMetrics() {
    queueMicrotask(() => {
      const stage = stageRef.current
      if (!stage) return
      stage.dataset.inputMetrics = JSON.stringify({ ...inputMetrics, ...frameScheduler.metrics, phase: frameScheduler.phase,
        strokeSamples: strokePreview.metrics.samples, strokePreviewFrames: strokePreview.metrics.frames })
    })
  }

  function listenGesture(event: React.PointerEvent | React.MouseEvent, move: (sample: PointerSample) => void, finish: (sample: PointerSample) => void, cancel: () => void, options?: { preserveSamples?: boolean }) {
    const dispose = scheduledPointerGesture({
      initial: event, captureTarget: event.currentTarget, scheduler: frameScheduler, metrics: inputMetrics,
      move, finish, cancel, changed: publishInputMetrics, preserveSamples: options?.preserveSamples,
    })
    return () => {
      dispose()
      endBoardPreview()
    }
  }

  useEffect(() => {
    return () => {
      activeGestureCancelRef.current?.()
      frameScheduler.clear()
      if (viewportCommitTimerRef.current !== null) {
        window.clearTimeout(viewportCommitTimerRef.current)
        viewportCommitTimerRef.current = null
        const current = boardRef.current.viewport
        const pending = presentedViewportRef.current
        if (current.x !== pending.x || current.y !== pending.y || current.scale !== pending.scale) {
          commitBoardChangeRef.current({ ...boardRef.current, viewport: pending }, null)
        }
      }
    }
  }, [frameScheduler])

  function cancelActiveGesture() {
    frameScheduler.cancel('pen-hover')
    activeGestureCancelRef.current?.()
  }

  useLayoutEffect(() => {
    activeGestureCancelRef.current?.()
  }, [persistedBoard])

  function suppressPostTransformClick() {
    selectionHandledOnPointerDownRef.current = true
    transformClickSuppressRef.current = true
    if (transformClickSuppressTimerRef.current !== null) window.clearTimeout(transformClickSuppressTimerRef.current)
    if (transformClickBlockerRef.current) window.removeEventListener('click', transformClickBlockerRef.current, true)
    const blocker = (clickEvent: MouseEvent) => {
      clickEvent.preventDefault()
      clickEvent.stopImmediatePropagation()
      clearPostTransformClickSuppression()
    }
    transformClickBlockerRef.current = blocker
    window.addEventListener('click', blocker, true)
    // A long drag must remain protected until it finishes; arm the short
    // click window only after pointer-up.
    transformClickIgnoreUntilRef.current = Number.POSITIVE_INFINITY
  }

  function finishPostTransformClickSuppression() {
    transformClickSuppressRef.current = true
    transformClickIgnoreUntilRef.current = performance.now() + 300
    if (transformClickSuppressTimerRef.current !== null) window.clearTimeout(transformClickSuppressTimerRef.current)
    transformClickSuppressTimerRef.current = window.setTimeout(() => {
      clearPostTransformClickSuppression()
    }, 300)
  }

  function clearPostTransformClickSuppression() {
    transformClickSuppressRef.current = false
    selectionHandledOnPointerDownRef.current = false
    transformClickIgnoreUntilRef.current = 0
    if (transformClickSuppressTimerRef.current !== null) window.clearTimeout(transformClickSuppressTimerRef.current)
    transformClickSuppressTimerRef.current = null
    if (transformClickBlockerRef.current) window.removeEventListener('click', transformClickBlockerRef.current, true)
    transformClickBlockerRef.current = null
  }

  function rememberViewport(viewport: BoardViewport) {
    previousViewportRef.current = viewport
    setHasPreviousViewport(true)
  }

  function presentViewport(viewport: BoardViewport) {
    presentedViewportRef.current = viewport
    frameScheduler.beginInteraction()
    // Present the camera at input time. The renderer already coalesces its
    // preparation in rAF; queuing the camera here first adds another frame
    // of latency. React membership work still shares one scheduled frame.
    presentCamera(stageRef.current, viewport, MIN_CANVAS_ZOOM, MAX_CANVAS_ZOOM)
    liveCamera.present(viewport)
    if (stageRef.current) stageRef.current.dataset.cameraFrames = String(liveCamera.revision)
    frameScheduler.schedule('viewport', () => {
      const current = presentedViewportRef.current
      // React only mounts/unmounts changed scene membership, not camera frames.
      const margin = Math.max(360, vectorQueryOutsetCssPx) / current.scale
      const candidates = spatialIndex.query({ x: -current.x / current.scale - margin, y: -current.y / current.scale - margin, width: stageSize.width / current.scale + margin * 2, height: stageSize.height / current.scale + margin * 2 })
      const membership = new Set(candidates.filter(object => visibleDiagramIds.has(object.id)).map(object => object.id))
      for (const id of selectedIds) if (nodeById.has(id) && visibleDiagramIds.has(id)) membership.add(id)
      const key = [...membership].sort().join('\n')
      if (key !== mountedMembership.current) { mountedMembership.current = key; setPresentedViewport(current) }
      publishInputMetrics()
    })
    if (frameScheduler.processingFrame) frameScheduler.flush('viewport')
  }

  function commitViewport(viewport = presentedViewportRef.current) {
    if (viewportCommitTimerRef.current !== null) window.clearTimeout(viewportCommitTimerRef.current)
    viewportCommitTimerRef.current = null
    frameScheduler.flush('viewport')
    setPresentedViewport(viewport)
    onBoardChange({ ...boardRef.current, viewport }, null)
    frameScheduler.settle(publishInputMetrics)
  }

  function scheduleViewportCommit() {
    if (viewportCommitTimerRef.current !== null) window.clearTimeout(viewportCommitTimerRef.current)
    viewportCommitTimerRef.current = window.setTimeout(() => commitViewport(), 140)
  }

  function zoomViewportAt(clientX: number, clientY: number, multiplier: number) {
    const bounds = stageBoundsRef.current
    if (!bounds) return
    const localX = clientX - bounds.left
    const localY = clientY - bounds.top
    const current = presentedViewportRef.current
    const scale = Math.min(MAX_CANVAS_ZOOM, Math.max(MIN_CANVAS_ZOOM, current.scale * multiplier))
    if (Math.abs(scale - current.scale) < .0001) return
    const next = { x: localX - ((localX - current.x) * scale) / current.scale, y: localY - ((localY - current.y) * scale) / current.scale, scale }
    presentViewport(next)
    scheduleViewportCommit()
  }

  function setZoomLevel(scale: number) {
    const current = presentedViewportRef.current
    const nextScale = Math.min(MAX_CANVAS_ZOOM, Math.max(MIN_CANVAS_ZOOM, scale))
    if (Math.abs(nextScale - current.scale) < .0001) return
    rememberViewport(current)
    const centerX = stageSize.width / 2, centerY = stageSize.height / 2
    const viewport = { x: centerX - ((centerX - current.x) * nextScale) / current.scale, y: centerY - ((centerY - current.y) * nextScale) / current.scale, scale: nextScale }
    presentViewport(viewport)
    commitViewport(viewport)
  }

  function stepZoom(direction: -1 | 1) {
    const scale = presentedViewportRef.current.scale
    const next = direction > 0
      ? CANVAS_ZOOM_STEPS.find((value) => value > scale + .001) ?? MAX_CANVAS_ZOOM
      : [...CANVAS_ZOOM_STEPS].reverse().find((value) => value < scale - .001) ?? MIN_CANVAS_ZOOM
    setZoomLevel(next)
  }

  function startViewportPan(event: React.PointerEvent<HTMLDivElement>) {
    event.preventDefault()
    const releasePointer = capturePointer(event)
    let disposeGesture: () => void = () => undefined
    const initial = presentedViewportRef.current
    let lastX = event.clientX, lastY = event.clientY
    let cancelled = false
    // This marker affects only cursor/selection chrome. A stage class mutation
    // conservatively invalidates every measured card as inherited artwork.
    if (stageRef.current) stageRef.current.dataset.viewportPanning = 'true'
    const cleanup = () => {
      disposeGesture();
      releasePointer(); if (stageRef.current) delete stageRef.current.dataset.viewportPanning
      if (activeGestureCancelRef.current === cancel) activeGestureCancelRef.current = null
    }
    const move = (pointerEvent: PointerSample) => {
      const current = presentedViewportRef.current
      const next = { ...current, x: current.x + pointerEvent.clientX - lastX, y: current.y + pointerEvent.clientY - lastY }
      lastX = pointerEvent.clientX; lastY = pointerEvent.clientY
      if (stageRef.current && (next.x !== current.x || next.y !== current.y)) canvasInputsFor(stageRef.current).mark('pan')
      presentViewport(next)
    }
    const finish = () => { cleanup(); if (!cancelled) commitViewport() }
    const cancel = () => { cancelled = true; presentViewport(initial); cleanup() }
    activeGestureCancelRef.current = cancel
    disposeGesture = listenGesture(event, move, finish, cancel)
  }

  function selectedByMarquee(start: { x: number; y: number }, end: { x: number; y: number }) {
    const bounds = { left: Math.min(start.x, end.x), top: Math.min(start.y, end.y), right: Math.max(start.x, end.x), bottom: Math.max(start.y, end.y) }
    const crossing = end.x < start.x
    const worldStart = eventToWorld(bounds.left, bounds.top)
    const worldEnd = eventToWorld(bounds.right, bounds.bottom)
    const queryOutset = vectorQueryOutsetCssPx / presentedViewportRef.current.scale
    const candidates = spatialIndex.query({
      x: Math.min(worldStart.x, worldEnd.x) - queryOutset,
      y: Math.min(worldStart.y, worldEnd.y) - queryOutset,
      width: Math.abs(worldEnd.x - worldStart.x) + queryOutset * 2,
      height: Math.abs(worldEnd.y - worldStart.y) + queryOutset * 2,
    })
    // Engine-prepared world bounds include rotated paths and clipped captions.
    // No mounted-card geometry read is needed during each marquee update.
    const stage = stageBoundsRef.current
    if (!stage) return []
    const camera = presentedViewportRef.current
    return candidates.filter(candidate => {
      if (candidate.hidden || !visibleDiagramIds.has(candidate.id)) return false
      const geometry = candidate.preparedVectorGeometry
      if (geometry?.status === 'ready' && !geometry.bounds && !candidate.hasDiagramCaption && !candidate.hasShapeCaption) return false
      const node = nodeById.get(candidate.id)
      if (!node) return false
      const scale = fisheyeScale(node), centerX = node.x + node.width / 2, centerY = node.y + node.height / 2
      const box = candidate.bounds
      const rect = {
        left: stage.left + camera.x + (centerX + (box.x - centerX) * scale) * camera.scale,
        top: stage.top + camera.y + (centerY + (box.y - centerY) * scale) * camera.scale,
        right: stage.left + camera.x + (centerX + (box.x + box.width - centerX) * scale) * camera.scale,
        bottom: stage.top + camera.y + (centerY + (box.y + box.height - centerY) * scale) * camera.scale,
      }
      return crossing
        ? rect.left <= bounds.right && rect.right >= bounds.left && rect.top <= bounds.bottom && rect.bottom >= bounds.top
        : rect.left >= bounds.left && rect.right <= bounds.right && rect.top >= bounds.top && rect.bottom <= bounds.bottom
    }).map(candidate => candidate.id)
  }

  function vectorSelectionByMarquee(start: { x: number; y: number }, end: { x: number; y: number }) {
    if (directPolicy.state !== 'single' || !directPolicy.nodeId) return { anchors: [], segments: [] }
    const editingRoot = stageRef.current?.querySelector<HTMLElement>(`.board-node[data-node-id="${CSS.escape(directPolicy.nodeId)}"]`)
    const bounds = { left: Math.min(start.x, end.x), top: Math.min(start.y, end.y), right: Math.max(start.x, end.x), bottom: Math.max(start.y, end.y) }
    const crossing = end.x < start.x
    const intersects = (rect: DOMRect) => crossing
      ? rect.left <= bounds.right && rect.right >= bounds.left && rect.top <= bounds.bottom && rect.bottom >= bounds.top
      : rect.left >= bounds.left && rect.right <= bounds.right && rect.top >= bounds.top && rect.bottom <= bounds.bottom
    const anchors = [...(editingRoot?.querySelectorAll<HTMLElement>('.vector-anchor[data-point-index]') || [])]
      .filter((anchor) => {
        const rect = anchor.getBoundingClientRect()
        const center = new DOMRect(rect.left + rect.width / 2, rect.top + rect.height / 2, 0, 0)
        return intersects(center)
      })
      .map((anchor) => Number(anchor.dataset.pointIndex))
      .filter((index) => Number.isInteger(index))
    const segments = [...(editingRoot?.querySelectorAll<SVGPathElement>('.vector-segment-hit[data-segment-index]') || [])]
      .filter((segment) => intersects(segment.getBoundingClientRect()))
      .map((segment) => Number(segment.dataset.segmentIndex))
      .filter((index) => Number.isInteger(index))
    return { anchors: [...new Set(anchors)], segments: [...new Set(segments)] }
  }

  function startMarqueeSelection(event: React.PointerEvent<HTMLDivElement>) {
    const marqueeAnchors = interactionTool === 'node' && directPolicy.state === 'single'
    if (viewOnly || event.button !== 0 || viewportTool !== 'select' || (interactionTool !== 'select' && !marqueeAnchors)) return
    event.preventDefault()
    const releasePointer = capturePointer(event)
    let disposeGesture: () => void = () => undefined
    const stageBounds = event.currentTarget.getBoundingClientRect()
    stageBoundsRef.current = stageBounds
    const start = { x: event.clientX - stageBounds.left, y: event.clientY - stageBounds.top }
    const startClient = { x: event.clientX, y: event.clientY }
    const initialSelection = selectedIds
    const initialAnchorIndexes = selectedVectorAnchorIndexes
    const initialSegmentIndexes = selectedVectorSegmentIndexes
    const additive = event.shiftKey
    let end = start
    let cancelled = false
    setMarquee({ start, end })
    setSelectedVectorPoint(null)
    setSelectedConnectorId(null)
    const cleanup = () => {
      disposeGesture();
      releasePointer()
      setMarquee(null)
      setMarqueePreviewIds([])
      setMarqueePreviewAnchors([])
      setMarqueePreviewSegments([])
      marqueeCancelRef.current = null
      if (activeGestureCancelRef.current === cancel) activeGestureCancelRef.current = null
    }
    const move = (pointerEvent: PointerSample) => {
      end = { x: pointerEvent.clientX - stageBounds.left, y: pointerEvent.clientY - stageBounds.top }
      setMarquee({ start, end })
      if (marqueeAnchors) {
        const next = vectorSelectionByMarquee(startClient, { x: pointerEvent.clientX, y: pointerEvent.clientY })
        setMarqueePreviewAnchors(next.anchors)
        setMarqueePreviewSegments(next.segments)
      } else {
        setMarqueePreviewIds(selectedByMarquee(startClient, { x: pointerEvent.clientX, y: pointerEvent.clientY }))
      }
    }
    const finish = (pointerEvent: PointerSample) => {
      end = { x: pointerEvent.clientX - stageBounds.left, y: pointerEvent.clientY - stageBounds.top }
      cleanup()
      if (cancelled) return
      const dragDistance = Math.hypot(pointerEvent.clientX - startClient.x, pointerEvent.clientY - startClient.y)
      if (dragDistance <= 4 && !marqueeAnchors) {
        const clickViewport = presentedViewportRef.current
        const clickWorld = eventToWorld(pointerEvent.clientX, pointerEvent.clientY)
        const hitQueryRadius = vectorQueryOutsetCssPx / Math.max(0.001, clickViewport.scale)
        const hitCandidates = spatialIndex.query({
          x: clickWorld.x - hitQueryRadius,
          y: clickWorld.y - hitQueryRadius,
          width: hitQueryRadius * 2,
          height: hitQueryRadius * 2,
        })
        const candidateNodes = hitCandidates
          .filter((object) => !object.hidden)
          .map((c) => nodeById.get(c.id))
          .filter((n): n is BoardNode => n !== undefined && !n.hidden)
          .sort((a, b) => (nodePaintOrder.get(b.id) ?? 0) - (nodePaintOrder.get(a.id) ?? 0))
        const hitNode = candidateNodes.find((n) => {
          if (n.kind === 'shape' && (isRectangleErasure(n) || n.shapeType === 'line' || n.shapeType === 'ellipse' || (n.shapeType === 'path' && n.vectorPath))) {
            const picker = canonicalVectorPickerRef.current, geometry = spatialIndex.get(n.id)?.preparedVectorGeometry
            if (n.shapeType === 'path' || picker?.nodeStatus(n, geometry) !== 'unsupported') return picker?.hitNode(n, clickWorld, clickViewport.scale, geometry) ?? false
          }
          return hitTestBoardNode(n, clickWorld, clickViewport.scale)
        })
        if (hitNode) {
          selectionHandledOnPointerDownRef.current = true
          marqueeClickSuppressRef.current = true
          window.setTimeout(() => { selectionHandledOnPointerDownRef.current = false; marqueeClickSuppressRef.current = false }, 250)
          setSelectedIds(additive ? (initialSelection.includes(hitNode.id) ? initialSelection.filter((id) => id !== hitNode.id) : [...initialSelection, hitNode.id]) : [hitNode.id])
          return
        }
      }
      if (marqueeAnchors && selectedNode?.vectorPath) {
        const next = vectorSelectionByMarquee(startClient, { x: pointerEvent.clientX, y: pointerEvent.clientY })
        const indexes = additive ? [...new Set([...initialAnchorIndexes, ...next.anchors])] : next.anchors
        const segments = additive ? [...new Set([...initialSegmentIndexes, ...next.segments])] : next.segments
        setSelectedVectorAnchorIndexes(indexes)
        setSelectedVectorPoint(indexes.length ? { nodeId: selectedNode.id, index: indexes.at(-1)! } : null)
        setSelectedVectorSegmentIndexes(segments)
        return
      }
      const nextSelection = selectedByMarquee(startClient, { x: pointerEvent.clientX, y: pointerEvent.clientY })
      // A browser click is dispatched after pointerup. Consume that synthetic
      // card click so it cannot collapse this multi-selection to the item under
      // the marquee's ending pointer.
      selectionHandledOnPointerDownRef.current = true
      marqueeClickSuppressRef.current = true
      window.setTimeout(() => { selectionHandledOnPointerDownRef.current = false; marqueeClickSuppressRef.current = false }, 250)
      setSelectedIds(additive ? [...new Set([...initialSelection, ...nextSelection])] : nextSelection)
    }
    const cancel = () => {
      cancelled = true
      selectionHandledOnPointerDownRef.current = false
      marqueeClickSuppressRef.current = false
      cleanup()
    }
    marqueeCancelRef.current = cancel
    activeGestureCancelRef.current = cancel
    disposeGesture = listenGesture(event, move, finish, cancel)
  }

  function handleStagePointerDown(event: React.PointerEvent<HTMLDivElement>) {
    setContextMenu(null)
    const target = event.target instanceof Element ? event.target : null
    if (target?.closest('.canvas-tool-rail, .canvas-subtools, .canvas-tool-rail-restore, .canvas-toolbar, .board-minimap, .canvas-zoom-control, .unsorted-panel, .canvas-context-menu, .professional-color, .tile-appearance-picker')) return
    if (event.button === 1 || (event.button === 0 && (viewportTool === 'hand' || spacePanRef.current))) {
      startViewportPan(event)
      return
    }
    if (event.button === 0 && viewportTool === 'zoom') {
      event.preventDefault()
      rememberViewport(presentedViewportRef.current)
      zoomViewportAt(event.clientX, event.clientY, event.altKey ? 1 / 1.2 : 1.2)
      return
    }
    if (interactionTool !== 'select' && interactionTool !== 'node') return
    if (target?.closest('.board-node, .connector-hit, .canvas-tool-rail, .canvas-subtools, .canvas-tool-rail-restore, .canvas-toolbar, .board-minimap, .canvas-zoom-control, .unsorted-panel, .canvas-context-menu, .professional-color, .tile-appearance-picker')) return
    if (viewportTool === 'select' && (interactionTool === 'select' || (interactionTool === 'node' && selectedNode?.vectorPath))) {
      startMarqueeSelection(event)
      return
    }
    setSelectedIds([])
    setSelectedVectorPoint(null)
    setSelectedVectorAnchorIndexes([])
    setSelectedVectorSegmentIndexes([])
    setSelectedConnectorId(null)
  }

  useEffect(() => {
    const stage = stageRef.current
    if (!stage) return
    const refreshBounds = () => { stageBoundsRef.current = stage.getBoundingClientRect() }
    const observer = new ResizeObserver(() => {
      refreshBounds()
      setStageSize(previous => previous.width === stage.clientWidth && previous.height === stage.clientHeight ? previous : { width: stage.clientWidth, height: stage.clientHeight })
    })
    refreshBounds()
    observer.observe(stage)
    window.addEventListener('scroll', refreshBounds, true)
    window.addEventListener('resize', refreshBounds)
    return () => { observer.disconnect(); window.removeEventListener('scroll', refreshBounds, true); window.removeEventListener('resize', refreshBounds) }
  }, [])

  useLayoutEffect(() => {
    presentedViewportRef.current = board.viewport
    frameScheduler.cancel('viewport')
    presentCamera(stageRef.current, board.viewport, MIN_CANVAS_ZOOM, MAX_CANVAS_ZOOM)
    liveCamera.present(board.viewport)
    setPresentedViewport(board.viewport)
  }, [board.id, board.viewport, frameScheduler, liveCamera])

  const onWheel = useControllerEvent((event: WheelEvent) => {
      const stage = stageRef.current
      if (!stage) return
      event.preventDefault()
      if (!event.shiftKey) {
        if (viewportCommitTimerRef.current === null) rememberViewport(presentedViewportRef.current)
        const unit = event.deltaMode === WheelEvent.DOM_DELTA_LINE ? 16 : event.deltaMode === WheelEvent.DOM_DELTA_PAGE ? Math.max(1, stage.clientHeight) : 1
        zoomViewportAt(event.clientX, event.clientY, Math.exp(-event.deltaY * unit * .0012))
        return
      }
      const current = presentedViewportRef.current
      const next = { ...current, x: current.x - (event.deltaX || event.deltaY) }
      presentViewport(next)
      scheduleViewportCommit()
  })
  useEffect(() => {
    const stage = stageRef.current
    if (!stage) return
    stage.addEventListener('wheel', onWheel, { passive: false })
    return () => stage.removeEventListener('wheel', onWheel)
  }, [onWheel])



  useEffect(() => {
    if (!('__TAURI_INTERNALS__' in window)) return
    let cancelled = false
    let unlisten: (() => void) | undefined
    void Promise.all([getCurrentWindow().scaleFactor(), getCurrentWindow().innerSize(), Promise.resolve(getCurrentWebview())])
      .then(async ([scaleFactor, physicalSize, webview]) => {
        unlisten = await webview.onDragDropEvent((event) => {
          const stage = stageRef.current
          if (!stage) return
          if (event.payload.type === 'leave') {
            setDropFeedback(null)
            return
          }
          const bounds = stageBoundsRef.current
          if (!bounds) return
          const clientPosition = nativeDragClientPositions(event.payload.position, scaleFactor, physicalSize).find((point) => positionInside(bounds, point))
          if (!clientPosition) {
            setDropFeedback(null)
            return
          }
          const { x: clientX, y: clientY } = clientPosition
          const count = 'paths' in event.payload ? event.payload.paths.length : 0
          setDropFeedback((current) => ({ count: count || current?.count || 1, x: clientX - bounds.left, y: clientY - bounds.top }))
          if (event.payload.type !== 'drop') return
          void invoke('record_frontend_diagnostic', { message: `canvas.drop paths=${event.payload.paths.length} client=${Math.round(clientX)},${Math.round(clientY)} scale=${scaleFactor}` }).catch(() => undefined)
          const currentBoard = boardRef.current
          const worldPosition = {
            x: (clientX - bounds.left - currentBoard.viewport.x) / currentBoard.viewport.scale,
            y: (clientY - bounds.top - currentBoard.viewport.y) / currentBoard.viewport.scale,
          }
          setDropFeedback(null)
          onDropFilesRef.current(event.payload.paths, worldPosition)
        })
        if (cancelled) unlisten()
      })
      .catch(() => undefined)
    return () => {
      cancelled = true
      unlisten?.()
    }
  }, [])



  useEffect(() => {
    if (interactionTool !== 'select') setViewportTool('select')
  }, [interactionTool])

  useEffect(() => {
    const cancelMarquee = () => marqueeCancelRef.current?.()
    window.addEventListener('blur', cancelMarquee)
    return () => {
      window.removeEventListener('blur', cancelMarquee)
      cancelMarquee()
    }
  }, [])



  function updateNode(nodeId: string, update: Partial<BoardNode>, recordHistory = true, mergeKey?: string) {
    if (viewOnly) return
    let result = patchBoardNode(board, nodeId, update, viewOnly, node=>fitEditableVectorPathNode(node, Boolean(update.vectorPath)))
    if (result.ok && update.width !== undefined && ['responsive', 'minimum-height'].includes(result.value.nodes.find((entry) => entry.id === nodeId)?.columnImageSizing || '')) {
      result = layoutBoardColumnsForNodesResult(result.value, [nodeId])
    }
    if (!result.ok) { setDrawingNotice(result.issues[0]?.detail || 'The edit was cancelled.'); return }
    onBoardChange(result.value, recordHistory ? undefined : null, mergeKey)
  }

  function prepareColumnEdit(draft: BoardModel, ids: string[], baseline = board): BoardModel {
    const result = layoutBoardColumnsForNodesResult(draft, ids)
    if (!result.ok) { setDrawingNotice(result.issues[0]?.detail || 'The column edit was cancelled.'); return baseline }
    const safe = validateBoardMutation(baseline, result.value, viewOnly)
    if (!safe.ok) { setDrawingNotice(safe.issues[0]?.detail || 'The edit was cancelled.'); return baseline }
    return result.value
  }

  function finishPenPath(points = penPoints, closed = false, options?: { keepTool?: boolean }) {
    frameScheduler.cancel('pen-hover')
    setPenPreview(null); setPenDragOut(null); setPenCloseHover(false)
    if (points.length < 2 || (closed && points.length < 3)) { setPenPoints([]); if (!options?.keepTool) setInteractionTool('select'); return }
    const left = Math.min(...points.map((point) => point.x)), top = Math.min(...points.map((point) => point.y))
    const width = Math.max(12, Math.max(...points.map((point) => point.x)) - left), height = Math.max(12, Math.max(...points.map((point) => point.y)) - top)
    const node: BoardNode = { id: `path-${crypto.randomUUID()}`, kind: 'shape', shapeType: 'path', vectorPath: { version: 1, closed, points: points.map((point) => ({ x: Math.round(point.x - left), y: Math.round(point.y - top), ...(point.handleIn ? { handleIn: { ...point.handleIn } } : {}), ...(point.handleOut ? { handleOut: { ...point.handleOut } } : {}), ...(point.handleMode ? { handleMode: point.handleMode } : {}) })) }, x: Math.round(left), y: Math.round(top), width: Math.round(width), height: Math.round(height), title: closed ? 'Closed pen path' : 'Pen path', color: '#56748e', strokeColor: '#b9d4e7', textColor: '#f1f4f6', strokeWidth: 2, opacity: 1 }
    onBoardChange({ ...board, nodes: [...board.nodes, node] })
    // Build disposable settled geometry after the canonical path is committed.
    window.setTimeout(() => vectorGeometryCache.get(node.vectorPath!, presentedViewportRef.current.scale, false), 0)
    // The Pen surface overlaps text cards; an anchor placed over one can leave
    // focus inside its editor, which would swallow Delete/Escape shortcuts at
    // the exact moment the new path becomes selectable.
    if (document.activeElement instanceof HTMLElement && document.activeElement.closest('[contenteditable="true"], input, textarea')) document.activeElement.blur()
    setSelectedIds([node.id]); setPenPoints([]); setSelectedVectorPoint(null); setSelectedVectorAnchorIndexes([]); setSelectedVectorSegmentIndexes([]); if (!options?.keepTool) setInteractionTool('node')
  }

  function constrainPenPoint(point: BoardPoint, origin: BoardPoint, shiftKey: boolean) {
    if (!shiftKey) return point
    const dx = point.x - origin.x, dy = point.y - origin.y
    const angle = Math.atan2(dy, dx), snapped = Math.round(angle / (Math.PI / 4)) * Math.PI / 4
    const length = Math.hypot(dx, dy)
    return { x: Math.round(origin.x + Math.cos(snapped) * length), y: Math.round(origin.y + Math.sin(snapped) * length) }
  }

  function startPenPoint(event: React.PointerEvent<HTMLElement>) {
    if (event.button !== 0 || viewOnly) return
    setPenCloseHover(false)
    event.preventDefault()
    const previousTap = lastPenTapRef.current
    const doubleTap = Boolean(previousTap && event.timeStamp - previousTap.at <= 450 && Math.hypot(event.clientX - previousTap.x, event.clientY - previousTap.y) <= 8)
    const rawPoint = eventToWorld(event.clientX, event.clientY)
    const point = penPoints.length ? constrainPenPoint(rawPoint, penPoints.at(-1)!, event.shiftKey) : rawPoint
    const first = penPoints[0]
    const closeDistance = 12 / liveCamera.current.scale
    if (!event.altKey && first && penPoints.length >= 3 && Math.hypot(point.x - first.x, point.y - first.y) <= closeDistance) {
      finishPenPath(penPoints, true)
      return
    }
    if (doubleTap && penPoints.length >= 1) {
      // The first tap of the pair already placed the final anchor.
      finishPenPath(penPoints)
      return
    }
    const releasePointer = capturePointer(event)
    let disposeGesture: () => void = () => undefined
    let latest = point
    let dragged = false
    const move = (pointerEvent: PointerSample) => {
      latest = penPoints.length ? constrainPenPoint(eventToWorld(pointerEvent.clientX, pointerEvent.clientY), penPoints.at(-1)!, pointerEvent.shiftKey) : eventToWorld(pointerEvent.clientX, pointerEvent.clientY)
      dragged ||= Math.hypot(latest.x - point.x, latest.y - point.y) > 3 / board.viewport.scale
      setPenPreview(dragged ? null : latest)
      setPenDragOut(dragged ? { anchor: point, cursor: latest } : null)
    }
    const cleanup = () => {
      disposeGesture(); releasePointer()
      if (activeGestureCancelRef.current === cancel) activeGestureCancelRef.current = null
    }
    const finish = (pointerEvent: PointerSample) => {
      cleanup()
      const finalPoint = penPoints.length ? constrainPenPoint(eventToWorld(pointerEvent.clientX, pointerEvent.clientY), penPoints.at(-1)!, pointerEvent.shiftKey) : eventToWorld(pointerEvent.clientX, pointerEvent.clientY)
      const next: VectorPathPoint = dragged
        ? { ...point, handleIn: { x: Math.round(point.x - finalPoint.x), y: Math.round(point.y - finalPoint.y) }, handleOut: { x: Math.round(finalPoint.x - point.x), y: Math.round(finalPoint.y - point.y) }, handleMode: pointerEvent.altKey ? 'corner' : 'smooth' }
        : point
      // Only a clean click seeds the double-tap detector. A drag-out is its
      // own gesture; treating its pointerdown as a tap made the finishing
      // double tap land one tap early, spilling a stray click onto the
      // freshly created path's anchors.
      if (!dragged) lastPenTapRef.current = { x: event.clientX, y: event.clientY, at: pointerEvent.timeStamp }
      setPenPreview(null); setPenDragOut(null)
      setPenPoints((current) => [...current, next])
    }
    const cancel = () => { cleanup(); setPenPreview(null); setPenDragOut(null); lastPenTapRef.current = null }
    activeGestureCancelRef.current = cancel
    disposeGesture = listenGesture(event, move, finish, cancel)
  }

  function startFreehand(event: React.PointerEvent<HTMLElement>) {
    if (event.button !== 0 || viewOnly) return
    event.preventDefault(); event.stopPropagation()
    const initialBoard = { ...boardRef.current }
    initialBoard.viewport = displayedViewport(presentedViewportRef.current)
    const tool = interactionTool
    const scale = presentedViewportRef.current.scale
    const radius = eraserSize / (2 * scale)
    const samples = [eventToWorld(event.clientX, event.clientY)]
    const releasePointer = capturePointer(event)
    let disposeGesture: () => void = () => undefined
    let inputOverflow = false
    setDrawingNotice('')
    const previewPath = freehandPathRef.current
    previewPath?.setAttribute('stroke', tool === 'erase' ? '#f6b5a0' : '#f1c384')
    previewPath?.setAttribute('stroke-opacity', tool === 'erase' ? '.4' : '1')
    previewPath?.setAttribute('stroke-width', String(tool === 'erase' ? eraserSize / scale : 2 / scale))
    strokePreview.begin(samples[0])
    const append = (sample: PointerSample) => {
      const point = eventToWorld(sample.clientX, sample.clientY)
      if (Math.hypot(point.x - samples.at(-1)!.x, point.y - samples.at(-1)!.y) >= .75 / scale) {
        if (samples.length >= 4096) { inputOverflow = true; cancel(); return }
        samples.push(point)
        strokePreview.append(point)
      }
    }
    const cleanup = () => { disposeGesture(); releasePointer(); strokePreview.clear(); if (activeGestureCancelRef.current === cancel) activeGestureCancelRef.current = null }
    const finish = (sample: PointerSample) => {
      append(sample); cleanup()
      if (inputOverflow) return
      if (tool === 'pencil') {
        const path = createPencilPath(samples, { tolerance: 1.2 / scale, minDistance: .5 / scale, smoothing: .7 })
        if (path.points.length < 2) return
        const node = fitEditableVectorPathNode({ id: `path-${crypto.randomUUID()}`, kind: 'shape', shapeType: 'path', title: 'Pencil path', x: 0, y: 0, width: 12, height: 12, vectorPath: path, color: '#56748e', strokeColor: theme === 'light' ? '#334c62' : '#b9d4e7', strokeWidth: 2, opacity: 1 })
        onBoardChange({ ...initialBoard, nodes: [...initialBoard.nodes, node] }, initialBoard)
        setSelectedIds([node.id])
        return
      }
      const scope = vectorEraserScope(initialBoard.nodes, selectedIds)
      const targets = new Set(scope.nodeIds)
      let changed = false
      const unsupported = new Set<string>()
      scope.blocked.forEach((item) => unsupported.add(item.reason))
      const replacements = initialBoard.nodes.flatMap((node) => {
        if (!targets.has(node.id) || node.locked || node.kind !== 'shape') return [node]
        let result = rectangleErasureState(node) ? eraseRectangleAppearance(node, samples, radius) : eraseVectorNode(node, samples, radius)
        if (result.changed && isRectangleErasure(result.nodes[0])) {
          const article = stageRef.current?.querySelector<HTMLElement>(`article.board-node[data-node-id="${CSS.escape(node.id)}"]`)
          if (!article || !captureRectangleErasureCssClip(article, result.nodes[0])) {
            result = { changed: false, nodes: [node], unsupported: 'Rectangle clipping is unavailable for this appearance; artwork is preserved.' }
          }
        }
        if (result.unsupported) unsupported.add(result.unsupported)
        changed ||= result.changed
        return result.nodes
      })
      if (changed) {
        const ids = new Set(replacements.map((node) => node.id))
        onBoardChange({ ...initialBoard, nodes: replacements, connectors: initialBoard.connectors.filter((connector) => (!connector.sourceId || ids.has(connector.sourceId)) && (!connector.targetId || ids.has(connector.targetId))) }, initialBoard)
        setSelectedIds(selectedIds.filter((id) => ids.has(id)))
      }
      setDrawingNotice(unsupported.size ? `Eraser: ${[...unsupported].join('; ')}. Other supported shapes ${changed ? 'were edited' : 'were unchanged'}.` : changed ? 'Vector erasure committed. Undo restores the original geometry.' : 'No editable vector shape under the eraser. Select a shape or clear selection to erase across the board.')
    }
    const cancel = () => { cleanup(); setDrawingNotice(inputOverflow ? 'Drawing input limit reached; the gesture was cancelled and the board is unchanged.' : 'Drawing gesture cancelled; the board is unchanged.') }
    activeGestureCancelRef.current = cancel
    disposeGesture = listenGesture(event, append, finish, cancel, { preserveSamples: true })
  }

  function startVectorSegmentDrag(event: React.PointerEvent<SVGPathElement>, node: BoardNode, segmentIndex: number) {
    if (!node.vectorPath || node.vectorBoolean || node.locked || viewOnly) return
    const blocked = vectorEditBlockReason(board.nodes, node.id)
    if (blocked) return setDrawingNotice(blocked)
    event.preventDefault(); event.stopPropagation()
    const start = eventToWorld(event.clientX, event.clientY)
    const local = vectorBoardToLocal(node, start)
    if (!local) return setDrawingNotice('This path has a singular transform. Reset the transform before editing it.')
    const nearest = nearestVectorSegment(node.vectorPath, local)
    const t = nearest?.index === segmentIndex ? nearest.t : .5
    const initialBoard = { ...boardRef.current }
    const releasePointer = capturePointer(event)
    let disposeGesture: () => void = () => undefined
    let latestBoard = initialBoard
    const move = (sample: PointerSample) => {
      const world = eventToWorld(sample.clientX, sample.clientY)
      const delta = vectorBoardDeltaToLocal(node, { x: world.x - start.x, y: world.y - start.y })
      if (!delta) return
      latestBoard = { ...initialBoard, nodes: initialBoard.nodes.map((entry) => entry.id === node.id ? fitEditableVectorPathNode({ ...entry, vectorPath: reshapeVectorSegment(node.vectorPath!, segmentIndex, t, delta) }, true) : entry) }
      onBoardChange(latestBoard, null)
    }
    const cleanup = () => { disposeGesture(); releasePointer(); if (activeGestureCancelRef.current === cancel) activeGestureCancelRef.current = null }
    const finish = () => { cleanup(); if (latestBoard !== initialBoard) { suppressPostTransformClick(); onBoardChange(latestBoard, initialBoard) } }
    const cancel = () => { cleanup(); onBoardChange(initialBoard, null) }
    activeGestureCancelRef.current = cancel
    disposeGesture = listenGesture(event, move, finish, cancel)
  }

  function startVectorControlDrag(event: React.PointerEvent<HTMLButtonElement>, node: BoardNode, pointIndex: number, control: 'anchor' | 'in' | 'out') {
    if (!node.vectorPath || viewOnly) return
    const blocked = vectorEditBlockReason(board.nodes, node.id)
    if (blocked) return setDrawingNotice(blocked)
    event.preventDefault(); event.stopPropagation()
    selectionHandledOnPointerDownRef.current = true
    setSelectedVectorPoint({ nodeId: node.id, index: pointIndex })
    setSelectedVectorAnchorIndexes(event.shiftKey ? (current) => current.includes(pointIndex) ? current.filter((index) => index !== pointIndex) : [...current, pointIndex] : [pointIndex])
    setSelectedVectorSegmentIndexes([])
    // A double-click is the explicit add/remove-handles gesture. Do not start
    // a competing drag transaction for its second pointerdown. WebView
    // pointerdown events report detail = 0, so the tap is detected by timing.
    if (control === 'anchor') {
      const tapKey = `${node.id}:${pointIndex}`
      const previousTap = lastAnchorTapRef.current
      lastAnchorTapRef.current = { key: tapKey, at: event.timeStamp }
      if (previousTap && previousTap.key === tapKey && event.timeStamp - previousTap.at <= 450) return
    }
    // Alt-dragging a handle-less anchor pulls Bézier handles out of it — the
    // direct-manipulation route to curves authored with plain clicks.
    const pullOutHandles = control === 'anchor' && event.altKey && !(node.vectorPath.points[pointIndex].handleIn || node.vectorPath.points[pointIndex].handleOut)
    const editedControl = pullOutHandles ? 'out' : control
    const releasePointer = capturePointer(event)
    let disposeGesture: () => void = () => undefined
    const original = node.vectorPath
    const selectedForDrag = editedControl === 'anchor' && selectedVectorAnchorIndexes.includes(pointIndex) ? selectedVectorAnchorIndexes : [pointIndex]
    const dragStart = eventToWorld(event.clientX, event.clientY)
    let latest = original
    const move = (pointerEvent: PointerSample) => {
      const world = eventToWorld(pointerEvent.clientX, pointerEvent.clientY)
      latest = { ...original, points: original.points.map((point, index) => {
        if (editedControl === 'anchor' && selectedForDrag.includes(index)) {
          // Anchors may extend the path beyond its initial Pen rectangle. The
          // completed path is reframed below instead of clipping this gesture.
          // The screen delta is rotated into the node's local space so editing
          // a rotated path still follows the pointer.
          const local = vectorBoardDeltaToLocal(node, { x: (world.x - dragStart.x) / fisheyeScale(node), y: (world.y - dragStart.y) / fisheyeScale(node) })
          if (!local) return point
          const x = Math.round(point.x + local.x)
          const y = Math.round(point.y + local.y)
          return { ...point, x, y }
        }
        if (index !== pointIndex) return point
        const localPointer = vectorBoardToLocal(node, { x: node.x + node.width / 2 + (world.x - node.x - node.width / 2) / fisheyeScale(node), y: node.y + node.height / 2 + (world.y - node.y - node.height / 2) / fisheyeScale(node) })
        if (!localPointer) return point
        const offset = { x: Math.round(localPointer.x - point.x), y: Math.round(localPointer.y - point.y) }
        if (point.handleMode === 'smooth' && !pointerEvent.altKey) {
          const opposite = editedControl === 'in' ? point.handleOut : point.handleIn
          const length = Math.hypot(opposite?.x || 0, opposite?.y || 0) || Math.hypot(offset.x, offset.y) || 36
          const magnitude = Math.hypot(offset.x, offset.y) || 1
          const mirrored = { x: Math.round(-offset.x / magnitude * length), y: Math.round(-offset.y / magnitude * length) }
          return editedControl === 'in' ? { ...point, handleIn: offset, handleOut: mirrored } : { ...point, handleOut: offset, handleIn: mirrored }
        }
        return { ...point, [editedControl === 'in' ? 'handleIn' : 'handleOut']: offset, ...(pullOutHandles ? { handleMode: 'smooth' as const } : {}) }
      }) }
      onBoardChange({ ...board, nodes: board.nodes.map((entry) => entry.id === node.id ? fitEditableVectorPathNode({ ...entry, vectorPath: latest }, true) : entry) }, null)
    }
    const cleanup = () => { disposeGesture(); releasePointer(); if (activeGestureCancelRef.current === cancel) activeGestureCancelRef.current = null }
    const finish = () => { cleanup(); if (latest !== original) onBoardChange({ ...board, nodes: board.nodes.map((entry) => entry.id === node.id ? fitEditableVectorPathNode({ ...entry, vectorPath: latest }, true) : entry) }, board) }
    const cancel = () => { cleanup(); onBoardChange(board, null) }
    disposeGesture = listenGesture(event, move, finish, cancel)
    activeGestureCancelRef.current = cancel
  }

  function addCurveHandles(node: BoardNode, pointIndex: number) {
    window.setTimeout(() => {
    const currentNode = boardRef.current.nodes.find((entry) => entry.id === node.id) || node
    if (!currentNode.vectorPath) return
    const points = currentNode.vectorPath.points.map((point, index) => {
      if (index !== pointIndex) return point
      if (point.handleIn && point.handleOut) {
        const { handleIn: _handleIn, handleOut: _handleOut, handleMode: _handleMode, ...anchor } = point
        return anchor
      }
      const direction = point.handleOut || (point.handleIn ? { x: -point.handleIn.x, y: -point.handleIn.y } : { x: 36, y: 0 })
      const magnitude = Math.hypot(direction.x, direction.y) || 36
      const axis = { x: direction.x / magnitude, y: direction.y / magnitude }
      return { ...point, handleIn: point.handleIn || { x: Math.round(-axis.x * 36), y: Math.round(-axis.y * 36) }, handleOut: point.handleOut || { x: Math.round(axis.x * 36), y: Math.round(axis.y * 36) }, handleMode: 'smooth' as const }
    })
    onBoardChange({ ...boardRef.current, nodes: boardRef.current.nodes.map((entry) => entry.id === node.id ? fitEditableVectorPathNode({ ...entry, vectorPath: { ...currentNode.vectorPath!, points } }, true) : entry) })
    }, 0)
  }

  function toggleClosedPath(node: BoardNode) {
    if (!node.vectorPath || node.vectorPath.points.length < 3) return
    updateNode(node.id, { vectorPath: { ...node.vectorPath, closed: !node.vectorPath.closed } })
  }

  function selectedPathPoint() {
    if (!selectedNode?.vectorPath || selectedVectorPoint?.nodeId !== selectedNode.id) return undefined
    return { node: selectedNode, index: selectedVectorPoint.index, point: selectedNode.vectorPath.points[selectedVectorPoint.index] }
  }

  function setPointMode(mode: 'smooth' | 'corner') {
    const selected = selectedPathPoint()
    if (!selected?.point) return
    const { node, index } = selected
    const points = node.vectorPath!.points.map((entry, pointIndex) => pointIndex === index ? setVectorPointMode(entry, mode) : entry)
    updateNode(node.id, { vectorPath: { ...node.vectorPath!, points } })
  }

  function insertPathPoint() {
    const selected = selectedPathPoint()
    if (!selected?.point) return
    const { node, index } = selected
    const updated = insertVectorPathPoint(node.vectorPath!, index)
    if (updated === node.vectorPath) return
    updateNode(node.id, { vectorPath: updated })
    setSelectedVectorPoint({ nodeId: node.id, index: index === node.vectorPath!.points.length - 1 && node.vectorPath!.closed ? updated.points.length - 1 : index + 1 })
  }

  function deletePathPoint() {
    const selected = selectedPathPoint()
    if (!selected?.point) return
    const { node, index } = selected
    const updated = removeVectorPathPoint(node.vectorPath!, index)
    if (updated === node.vectorPath) return
    updateNode(node.id, { vectorPath: updated })
    setSelectedVectorPoint({ nodeId: node.id, index: Math.max(0, Math.min(index, updated.points.length - 1)) })
  }

  function updateVectorTransform(node: BoardNode, update: Partial<NonNullable<BoardNode['vectorTransform']>>) {
    updateNode(node.id, { vectorTransform: { ...node.vectorTransform, ...update } })
  }

  function joinSelectedPaths() {
    combineSelectedPaths('join')
  }

  function booleanSelectedPaths(operation: VectorBooleanOperation) {
    combineSelectedPaths(operation)
  }

  function combineSelectedPaths(operation: 'join' | VectorBooleanOperation) {
    if (board.nodes.some(node => selectedIds.includes(node.id) && isRectangleErasure(node))) {
      setDrawingNotice('An erased rectangle retains its original border and shadow. This path operation cannot preserve that appearance; the selection is unchanged.')
      return
    }
    const paths = selectedIds.map((id) => board.nodes.find((node) => node.id === id)).filter((node): node is BoardNode => Boolean(node?.vectorPath && node.shapeType === 'path'))
    if (viewOnly || !allowTransform(paths.map((node) => node.id))) return
    const composed = composeVectorPaths(paths, operation, operation === 'join' ? paths[0]?.id : `boolean-${crypto.randomUUID()}`)
    if (!composed.ok) { setDrawingNotice(composed.reason); return }
    const result = composed.node
    if (result.vectorBoolean) {
      const resolvedPaths = resolveVectorBooleanGeometry(result.vectorBoolean.operation, result.vectorBoolean.operands, result.vectorBoolean.fillRules)
      if (!resolvedPaths) { setDrawingNotice('The selected path geometry could not be resolved; the original paths were retained.'); return }
      result.vectorBoolean = { ...result.vectorBoolean, resolvedPaths }
    }
    const sources = new Set(composed.sourceIds)
    // Keep connection identities, labels and authored routes while redirecting
    // attached endpoints to the resulting object, within the same transaction.
    const draft = {
      ...board,
      nodes: board.nodes.flatMap((node) => node.id === composed.sourceIds[0] ? [result] : sources.has(node.id) ? [] : [node]),
      connectors: board.connectors.map((edge) => ({ ...edge,
        ...(edge.sourceId && sources.has(edge.sourceId) ? { sourceId: result.id } : {}),
        ...(edge.targetId && sources.has(edge.targetId) ? { targetId: result.id } : {}),
      })),
    }
    const validated = validateBoardMutation(board, draft, viewOnly)
    if (!validated.ok) { setDrawingNotice(validated.issues[0].detail); return }
    onBoardChange(validated.value)
    setSelectedIds([result.id])
    setSelectedVectorPoint(null)
    setDrawingNotice('')
  }

  const [typeDraft, setTypeDraft] = useState<{ x: number; y: number; width: number; height: number } | null>(null)
  function placeTypeNode(event: React.PointerEvent<HTMLDivElement>) {
    if (event.button !== 0 || viewOnly) return
    event.preventDefault()
    const point = eventToWorld(event.clientX, event.clientY)
    const baseline = boardRef.current, release = capturePointer(event)
    let rect = { ...point, width: 0, height: 0 }, dragged = false
    let dispose: () => void = () => undefined
    const cleanup = () => { dispose(); release(); setTypeDraft(null); if (activeGestureCancelRef.current === cancel) activeGestureCancelRef.current = null }
    const cancel = () => cleanup()
    const finish = () => {
      cleanup()
      const node: BoardNode = { id: `text-${crypto.randomUUID()}`, kind: 'text', x: dragged ? rect.x : point.x, y: dragged ? rect.y : point.y, width: dragged ? Math.max(24, rect.width) : 280, height: dragged ? Math.max(24, rect.height) : 48, title: 'Type', textMode: dragged ? 'area' : 'point', body: '<p><span style="font-family: Segoe UI; font-size: 32px; line-height: 1.2">Type here</span></p>', color: 'transparent', textColor: theme === 'light' ? '#111111' : '#ffffff' }
      onBoardChange({ ...baseline, nodes: [...baseline.nodes, node] }, baseline); setSelectedIds([node.id]); setInteractionTool('select')
    }
    dispose = listenGesture(event, pointer => {
      const end = eventToWorld(pointer.clientX, pointer.clientY)
      dragged ||= Math.hypot(pointer.clientX - event.clientX, pointer.clientY - event.clientY) > 6
      rect = { x: Math.min(point.x, end.x), y: Math.min(point.y, end.y), width: Math.abs(end.x - point.x), height: Math.abs(end.y - point.y) }
      if (dragged) setTypeDraft(rect)
    }, finish, cancel)
    activeGestureCancelRef.current = cancel
  }

  function addGraphColumnV2() {
    if (viewOnly) return
    const point = eventToWorld((stageBoundsRef.current?.left || 0) + 120, (stageBoundsRef.current?.top || 0) + 120)
    const node = createGraphColumnItem(`graph-v2-${crypto.randomUUID()}`, point, selectedIds)
    const next = { ...board, nodes: [...board.nodes, node] }
    try { graphColumnRuntime.evaluate(next, node.id) } catch (error) { setDrawingNotice(String(error)); return }
    onBoardChange(next); setSelectedIds([node.id]); setShowMoreCanvasTools(false)
  }

  function inspectGraphColumnV2(node: BoardNode) {
    try { appAlert(JSON.stringify(graphColumnRuntime.evaluate(board, node.id, assets), null, 2).slice(0, 12000), 'Graph Column 2 · connected data') }
    catch (error) { appAlert(String(error), 'Graph Column 2 · evaluation error') }
  }

  const [graphEditorId, setGraphEditorId] = useState<string | null>(null)
  const [graphColumnRuntime] = useState(() => new GraphColumnRuntime())
  const graphColumnProjection = useMemo(() => projectGraphColumns(board), [board.nodes])
  const graphColumnResults = useMemo(() => {
    const before = graphColumnRuntime.evaluations, started = performance.now()
    const graphs = board.nodes.filter(node => node.graphColumn)
    const results = new Map(graphs.map(node => {
      try {
        const result = graphColumnRuntime.evaluate(board, node.id, assets)
        return [node.id, result.type === 'records' ? `${result.value.length} records` : result.type === 'number' ? String(result.value) + ' records' : result.value.slice(0, 200)] as const
      } catch (error) { return [node.id, 'Input error: ' + String(error)] as const }
    }))
    if (graphs.length) recordMetric('graph.evaluate', { computed: graphColumnRuntime.evaluations - before, items: graphs.length, elapsedMs: performance.now() - started })
    return results
  }, [board.nodes, assets, graphColumnRuntime])

  function updateConnector(connectorId: string, update: Partial<BoardConnector>, recordHistory = true) {
    if (viewOnly) return
    onBoardChange({ ...board, connectors: board.connectors.map((connector) => connector.id === connectorId ? { ...connector, ...update } : connector) }, recordHistory ? undefined : null)
  }

  async function editConnectorLabel(connector: BoardConnector) {
    if (viewOnly) return
    const label = await onRequestText({ title: 'Connection label', label: 'Label text', initialValue: connector.label || '' })
    if (label !== null && label !== connector.label) updateConnector(connector.id, { label: label.slice(0, 200) })
  }

  function setConnectorAttachment(connector: BoardConnector, side: 'source' | 'target', value: string) {
    const endpoint = resolveConnectorEndpoint(connector, side, board.nodes)
    if (!endpoint || viewOnly) return
    const next = value === 'free'
      ? withConnectorEndpoint(connector, side, { attachment: 'free', point: endpoint.point })
      : endpoint.node ? withConnectorEndpoint(connector, side, { attachment: 'attached', objectId: endpoint.node.id, port: endpoint.port, portMode: value === 'adaptive' ? 'adaptive' : 'fixed' }) : connector
    updateConnector(connector.id, next)
  }

  function eventToWorld(clientX: number, clientY: number): BoardPoint {
    const bounds = stageBoundsRef.current
    const viewport = presentedViewportRef.current
    return bounds
      ? { x: (clientX - bounds.left - viewport.x) / viewport.scale, y: (clientY - bounds.top - viewport.y) / viewport.scale }
      : { x: 0, y: 0 }
  }

  // A board can be visually presented one frame ahead of its persisted viewport
  // while switching panes. Shape editing must use what is actually on screen as
  // its transaction baseline, otherwise its first commit can restore a stale
  // camera position and make the canvas appear to jump.
  function displayedViewport(fallback: BoardViewport): BoardViewport {
    const transform = stageRef.current?.querySelector<HTMLElement>('.board-world')?.style.transform || ''
    const match = /translate\(([-\d.]+)px,\s*([-\d.]+)px\)\s*scale\(([-\d.]+)\)/.exec(transform)
    if (!match) return fallback
    const [x, y, scale] = match.slice(1).map(Number)
    return Number.isFinite(x) && Number.isFinite(y) && Number.isFinite(scale) && scale > 0 ? { x, y, scale } : fallback
  }

  function snapBounds(bounds: { x: number; y: number; width: number; height: number }, ignoredIds: string[] = [], sourceBoard = boardRef.current, resizeHandle?: string, minWidth?: number, minHeight?: number) {
    return solveLayoutSnap(bounds, sourceBoard.nodes, {
      zoom: sourceBoard.viewport.scale, ignoredIds, resizeHandle, minWidth, minHeight,
      gridEnabled: sourceBoard.snapToGrid !== false,
      objectEnabled: sourceBoard.snapToObjects !== false,
      guideEnabled: sourceBoard.snapToGuides !== false,
      gridSize: Math.max(3, (sourceBoard.gridSpacing || 44) / 4), guides: sourceBoard.layoutGuides,
    })
  }

  function transformMembers(ids: string[], snapshot = boardRef.current) {
    const members = new Set(ids)
    const queue = [...members]
    for (let cursor = 0; cursor < queue.length; cursor++) {
      const owner = snapshot.nodes.find((entry) => entry.id === queue[cursor])
      if (!owner || (owner.kind !== 'group' && owner.kind !== 'column')) continue
      for (const child of snapshot.nodes) {
        if ((child.groupId === owner.id || child.parentColumnId === owner.id) && !members.has(child.id)) {
          members.add(child.id); queue.push(child.id)
        }
      }
    }
    return [...members]
  }

  function allowTransform(ids: string[]) {
    for (const id of ids) {
      const blocked = vectorEditBlockReason(boardRef.current.nodes, id)
      if (blocked) { setDrawingNotice(blocked); return false }
    }
    setDrawingNotice('')
    return true
  }

  function memberNodes(ids: string[]) {
    const members = new Set(transformMembers(ids))
    return board.nodes.filter((node) => members.has(node.id))
  }

  function startNodeDrag(event: React.PointerEvent, node: BoardNode) {
    if (viewOnly) return
    if (event.button !== 0) return
    if (interactionTool !== 'select') return
    event.preventDefault()
    event.stopPropagation()
    selectionHandledOnPointerDownRef.current = true
    setSelectedVectorPoint(null)
    setSelectedVectorAnchorIndexes([])
    setSelectedVectorSegmentIndexes([])
    if (event.shiftKey && selectedIds.includes(node.id)) {
      setSelectedIds(selectedIds.filter((id) => id !== node.id))
      return
    }
    const movingIds = selectedIds.includes(node.id) ? selectedIds : event.shiftKey ? [...selectedIds, node.id] : [node.id]
    if (!selectedIds.includes(node.id)) setSelectedIds(movingIds)
    const dragIds = transformMembers(movingIds)
    // A container transform must not carry a locked descendant along with it.
    // Refuse the whole gesture instead of breaking the container's geometry.
    if (!allowTransform(dragIds)) return
    const releasePointer = capturePointer(event)
    let disposeGesture: () => void = () => undefined
    setSelectedConnectorId(null)
    const movingCards = movingIds.filter((id) => board.nodes.find((entry) => entry.id === id)?.kind !== 'column')
    const canEnterColumn = movingCards.length === movingIds.length
    const movingSet = new Set(movingCards)
    const startX = event.clientX
    const startY = event.clientY
    const origins = new Map(board.nodes.filter((entry) => dragIds.includes(entry.id)).map((entry) => [entry.id, { x: entry.x, y: entry.y }]))
    let dragStarted = false
    let latestBoard = board
    let latestTarget: ColumnDropTarget | null = null
    let dropRefusal: string | null = null
    const move = (pointerEvent: PointerSample) => {
      if (!dragStarted) {
        if (Math.hypot(pointerEvent.clientX - startX, pointerEvent.clientY - startY) < NODE_DRAG_ACTIVATION_PX) return
        dragStarted = true
        setColumnDragIds(movingCards)
      }
      const deltaX = (pointerEvent.clientX - startX) / board.viewport.scale
      const deltaY = (pointerEvent.clientY - startY) / board.viewport.scale
      const proposed = board.nodes.map((entry) => {
        const origin = origins.get(entry.id)
        if (!origin) return entry
        const x = origin.x + deltaX
        const y = origin.y + deltaY
        return { ...entry, x, y }
      })
      const movingNodes = proposed.filter((entry) => dragIds.includes(entry.id))
      const movingBoxes = movingNodes.map(boardNodeVisualBounds)
      const movingLeft = Math.min(...movingBoxes.map(box => box.left))
      const movingTop = Math.min(...movingBoxes.map(box => box.top))
      const movingRight = Math.max(...movingBoxes.map(box => box.right))
      const movingBottom = Math.max(...movingBoxes.map(box => box.bottom))
      const snapped = pointerEvent.altKey
        ? { x: movingLeft, y: movingTop, width: movingRight - movingLeft, height: movingBottom - movingTop, guides: [] as Array<{ axis: 'x' | 'y'; value: number }> }
        : snapBounds({ x: movingLeft, y: movingTop, width: movingRight - movingLeft, height: movingBottom - movingTop }, movingIds)
      const offsetX = snapped.x - movingLeft
      const offsetY = snapped.y - movingTop
      setGuideLines(snapped.guides)
      // Nodes and their internal routed edges share one board-space delta.
      // Preview from the gesture baseline, so repeated samples never accumulate.
      const firstId = dragIds[0]
      const firstOrigin = origins.get(firstId)
      const firstProposed = proposed.find((entry) => entry.id === firstId)
      if (!firstOrigin || !firstProposed) return
      const moved = moveContainerWithDescendants(board.nodes, board.connectors, movingIds, {
        x: firstProposed.x + offsetX - firstOrigin.x,
        y: firstProposed.y + offsetY - firstOrigin.y,
      })
      if (!moved.ok) { setDrawingNotice(moved.issues[0]?.detail || 'Cannot move this container.'); return }
      latestBoard = { ...board, nodes: moved.value.nodes, connectors: moved.value.connectors }
      const stage = stageRef.current
      if (stage && canEnterColumn) {
        const bounds = stageBoundsRef.current
          if (!bounds) return
        const worldX = (pointerEvent.clientX - bounds.left - board.viewport.x) / board.viewport.scale
        const worldY = (pointerEvent.clientY - bounds.top - board.viewport.y) / board.viewport.scale
        const target = findColumnDropTargetResult(board, worldX, worldY, movingSet)
        latestTarget = target.ok ? target.value : null
        dropRefusal = target.ok ? null : target.issues[0]?.detail || 'The destination cannot accept this selection.'
      } else { latestTarget = null; dropRefusal = null }
      setColumnDropTarget(latestTarget)
      onBoardChange(latestBoard, null)
    }
    const cleanup = () => {
      disposeGesture();
      releasePointer()
      if (activeGestureCancelRef.current === cancel) activeGestureCancelRef.current = null
    }
    const finish = () => {
      cleanup()
      if (!dragStarted) {
        setColumnDropTarget(null); setColumnDragIds([]); setGuideLines([])
        return
      }
      if (dropRefusal) {
        setColumnDropTarget(null); setColumnDragIds([]); setGuideLines([])
        onBoardChange(board, null); setDrawingNotice(dropRefusal)
        return
      }
      const finalized = latestTarget && canEnterColumn
        ? insertNodesIntoColumnResult(latestBoard, movingCards, latestTarget)
        : canEnterColumn ? releaseNodesFromColumnsResult(latestBoard, movingCards) : { ok: true as const, value: latestBoard }
      setColumnDropTarget(null)
      setColumnDragIds([])
      setGuideLines([])
      if (!finalized.ok) {
        onBoardChange(board, null)
        setDrawingNotice(finalized.issues[0]?.detail || 'The column drop was cancelled.')
      } else if (latestBoard !== board) onBoardChange(finalized.value, board)
    }
    const cancel = () => {
      cleanup()
      selectionHandledOnPointerDownRef.current = false
      setColumnDropTarget(null)
      setColumnDragIds([])
      setGuideLines([])
      onBoardChange(board, null)
    }
    disposeGesture = listenGesture(event, move, finish, cancel)
    activeGestureCancelRef.current = cancel
  }

  function startLiveShapeAnchorDrag(event: React.PointerEvent<HTMLButtonElement>, node: BoardNode, anchor: LiveShapeAnchor) {
    if (viewOnly || !isLiveShapeDirectSelectable(node)) return
    event.preventDefault()
    event.stopPropagation()
    selectionHandledOnPointerDownRef.current = true
    stageRef.current?.setAttribute('data-active-transform', 'direct-select')
    suppressPostTransformClick()
    const releasePointer = capturePointer(event)
    let disposeGesture: () => void = () => undefined
    const initialBoard = { ...board }
    initialBoard.viewport = displayedViewport(initialBoard.viewport)
    let initialNode = initialBoard.nodes.find((entry) => entry.id === node.id)
    // A newly created live shape can be painted before React's persisted board
    // snapshot catches up. Keep the rendered shape in this gesture's baseline.
    if (!initialNode) {
      initialNode = node
      initialBoard.nodes = [...initialBoard.nodes, initialNode]
    }
    const start = eventToWorld(event.clientX, event.clientY)
    let latestBoard = initialBoard
    const move = (pointerEvent: PointerSample) => {
      const point = eventToWorld(pointerEvent.clientX, pointerEvent.clientY)
      // The drag runs in the shape's local space; rotated shapes resize along
      // their own edges and the box is repositioned so the opposite corner
      // stays fixed in world space.
      const d = worldToLocalDelta(initialNode, { x: point.x - start.x, y: point.y - start.y }, fisheyeScale(initialNode))
      const minWidth = 24, minHeight = 24
      let x = initialNode.x, y = initialNode.y, width = initialNode.width, height = initialNode.height
      if (anchor.includes('e')) width = Math.max(minWidth, initialNode.width + d.x)
      if (anchor.includes('s')) height = Math.max(minHeight, initialNode.height + d.y)
      if (anchor.includes('w')) { width = Math.max(minWidth, initialNode.width - d.x); x = initialNode.x + initialNode.width - width }
      if (anchor.includes('n')) { height = Math.max(minHeight, initialNode.height - d.y); y = initialNode.y + initialNode.height - height }
      if (pointerEvent.shiftKey && initialNode.shapeType === 'ellipse') {
        const diameter = Math.max(minWidth, minHeight, Math.max(width, height))
        if (anchor === 'n' || anchor === 's') width = diameter
        else height = diameter
        if (anchor === 'w') x = initialNode.x + initialNode.width - width
        if (anchor === 'n') y = initialNode.y + initialNode.height - height
      }
      const theta = (initialNode.rotation || 0) * Math.PI / 180
      if (theta) {
        // Rotation is about the box center; recompute x/y so the corner
        // opposite the dragged anchor holds its world position.
        const fixedNew = { x: anchor.includes('w') ? width : 0, y: anchor.includes('n') ? height : 0 }
        const fixedOld = { x: anchor.includes('w') ? initialNode.width : 0, y: anchor.includes('n') ? initialNode.height : 0 }
        const cos = Math.cos(theta), sin = Math.sin(theta)
        const rotate = (p: BoardPoint) => ({ x: p.x * cos - p.y * sin, y: p.x * sin + p.y * cos })
        const centerOld = { x: initialNode.width / 2, y: initialNode.height / 2 }
        const centerNew = { x: width / 2, y: height / 2 }
        const fixedWorld = { x: initialNode.x + rotate({ x: fixedOld.x - centerOld.x, y: fixedOld.y - centerOld.y }).x, y: initialNode.y + rotate({ x: fixedOld.x - centerOld.x, y: fixedOld.y - centerOld.y }).y }
        const compensation = rotate({ x: fixedNew.x - centerNew.x, y: fixedNew.y - centerNew.y })
        x = fixedWorld.x - compensation.x
        y = fixedWorld.y - compensation.y
      }
      const snapped = theta || pointerEvent.altKey || pointerEvent.shiftKey ? { x, y, width, height, guides: [] } : snapBounds({ x, y, width, height }, [initialNode.id], initialBoard, anchor, minWidth, minHeight)
      setGuideLines(snapped.guides)
      latestBoard = { ...initialBoard, nodes: initialBoard.nodes.map((entry) => entry.id === initialNode.id
        ? isRectangleErasure(initialNode) ? resizeRectangleErasureFrame(initialNode, snapped) : { ...entry, x: snapped.x, y: snapped.y, width: snapped.width, height: snapped.height }
        : entry) }
      onBoardChange(latestBoard, null)
    }
    const cleanup = () => {
      disposeGesture()
      releasePointer()
      stageRef.current?.removeAttribute('data-active-transform')
      if (activeGestureCancelRef.current === cancel) activeGestureCancelRef.current = null
    }
    const finish = () => {
      cleanup()
      finishPostTransformClickSuppression()
      setGuideLines([])
      if (latestBoard !== initialBoard) onBoardChange(latestBoard, initialBoard)
    }
    const cancel = () => {
      cleanup()
      clearPostTransformClickSuppression()
      setGuideLines([])
      onBoardChange(initialBoard, null)
    }
    disposeGesture = listenGesture(event, move, finish, cancel)
    activeGestureCancelRef.current = cancel
  }

  function startNodeResize(event: React.PointerEvent | React.MouseEvent, node: BoardNode, handle: ResizeHandle) {
    if (viewOnly) return
    event.preventDefault()
    event.stopPropagation()
    if (!allowTransform(transformMembers([node.id]))) return
    stageRef.current?.setAttribute('data-active-transform', 'resize')
    // The browser emits a click after pointer-up. A transform handle can be
    // released above a different card, so keep that synthetic click from
    // replacing the active selection.
    suppressPostTransformClick()
    const releasePointer = capturePointer(event)
    let disposeGesture: () => void = () => undefined
    // A transform can receive several transient board updates before pointer-up.
    // Keep one immutable baseline so its history entry cannot be replaced by a
    // rerender from an earlier transform gesture.
    const initialBoard = { ...boardRef.current }
    const initialNode = initialBoard.nodes.find((entry) => entry.id === node.id) || node
    const startX = event.clientX
    const startY = event.clientY
    let latestBoard = initialBoard
    const move = (pointerEvent: PointerSample) => {
      const angle = (initialNode.rotation || 0) * Math.PI / 180
      const worldDx = (pointerEvent.clientX - startX) / initialBoard.viewport.scale
      const worldDy = (pointerEvent.clientY - startY) / initialBoard.viewport.scale
      const dx = worldDx * Math.cos(angle) + worldDy * Math.sin(angle)
      const dy = -worldDx * Math.sin(angle) + worldDy * Math.cos(angle)
      const minWidth = initialNode.kind === 'column' ? 230 : initialNode.kind === 'shape' ? 8 : 120
      const minHeight = initialNode.kind === 'shape' ? 8 : initialNode.kind === 'document' ? 68 : 80
      let x = initialNode.x, y = initialNode.y, width = initialNode.width, height = initialNode.height
      if (handle.includes('e')) width = Math.max(minWidth, initialNode.width + dx)
      if (handle.includes('s')) height = Math.max(minHeight, initialNode.height + dy)
      if (handle.includes('w')) { width = Math.max(minWidth, initialNode.width - dx); x = initialNode.x + initialNode.width - width }
      if (handle.includes('n')) { height = Math.max(minHeight, initialNode.height - dy); y = initialNode.y + initialNode.height - height }
      if (pointerEvent.shiftKey && (handle.length === 2)) {
        const ratio = Math.max(.1, initialNode.width / Math.max(1, initialNode.height))
        if (Math.abs(dx) > Math.abs(dy)) height = Math.max(minHeight, width / ratio)
        else width = Math.max(minWidth, height * ratio)
        if (handle.includes('w')) x = initialNode.x + initialNode.width - width
        if (handle.includes('n')) y = initialNode.y + initialNode.height - height
      }
      if (pointerEvent.altKey) {
        const centerX = initialNode.x + initialNode.width / 2, centerY = initialNode.y + initialNode.height / 2
        x = centerX - width / 2; y = centerY - height / 2
      }
      if (angle) {
        const centerDx = x - initialNode.x + (width - initialNode.width) / 2
        const centerDy = y - initialNode.y + (height - initialNode.height) / 2
        x = initialNode.x + (initialNode.width - width) / 2 + centerDx * Math.cos(angle) - centerDy * Math.sin(angle)
        y = initialNode.y + (initialNode.height - height) / 2 + centerDx * Math.sin(angle) + centerDy * Math.cos(angle)
      }
      const snapped = angle || pointerEvent.altKey || pointerEvent.shiftKey ? { x, y, width, height, guides: [] } : snapBounds({ x, y, width, height }, [initialNode.id], initialBoard, handle, minWidth, minHeight)
      setGuideLines(snapped.guides)
      latestBoard = prepareColumnEdit({
        ...initialBoard,
        nodes: initialBoard.nodes.map((entry) => {
          if (entry.id !== initialNode.id) return entry
          // SVG paths use local coordinates. Updating only the element's
          // rectangle makes resize handles grow while the actual Pen drawing
          // stays at its old size. Scale canonical points (and Bézier handles)
          // from the immutable gesture baseline on every frame instead.
          const resizePath = initialNode.shapeType === 'path' && initialNode.vectorPath
          if (isRectangleErasure(initialNode)) return resizeRectangleErasureFrame(initialNode, snapped)
          if (resizePath) return resizeVectorNodeFrame(initialNode, snapped)
          return {
            ...entry,
            x: snapped.x,
            y: snapped.y,
            width: snapped.width,
            height: snapped.height,
            ...(entry.parentColumnId ? { freeWidth: snapped.width, freeHeight: snapped.height } : {}),
          }
        }),
      }, [initialNode.id], initialBoard)
      onBoardChange(latestBoard, null)
    }
    const cleanup = () => {
      disposeGesture();
      releasePointer()
      stageRef.current?.removeAttribute('data-active-transform')
      if (activeGestureCancelRef.current === cancel) activeGestureCancelRef.current = null
    }
    const finish = () => {
      cleanup()
      finishPostTransformClickSuppression()
      setGuideLines([])
      if (latestBoard !== initialBoard) onBoardChange(latestBoard, initialBoard)
    }
    const cancel = () => {
      cleanup()
      clearPostTransformClickSuppression()
      setGuideLines([])
      onBoardChange(initialBoard, null)
    }
    disposeGesture = listenGesture(event, move, finish, cancel)
    activeGestureCancelRef.current = cancel
  }

  function startNodeRotate(event: React.PointerEvent | React.MouseEvent, node: BoardNode) {
    if (viewOnly) return
    event.preventDefault()
    event.stopPropagation()
    if (!allowTransform(transformMembers([node.id]))) return
    stageRef.current?.setAttribute('data-active-transform', 'rotate')
    suppressPostTransformClick()
    const releasePointer = capturePointer(event)
    let disposeGesture: () => void = () => undefined
    const initialBoard = { ...boardRef.current }
    const initialNode = initialBoard.nodes.find((entry) => entry.id === node.id) || node
    const center = { x: initialNode.x + initialNode.width / 2, y: initialNode.y + initialNode.height / 2 }
    const startPoint = eventToWorld(event.clientX, event.clientY)
    const startAngle = Math.atan2(startPoint.y - center.y, startPoint.x - center.x)
    const originalRotation = initialNode.rotation || 0
    setRotationReadout(Math.round(originalRotation))
    let latestBoard = initialBoard
    const move = (pointerEvent: PointerSample) => {
      const point = eventToWorld(pointerEvent.clientX, pointerEvent.clientY)
      let rotation = originalRotation + (Math.atan2(point.y - center.y, point.x - center.x) - startAngle) * 180 / Math.PI
      if (pointerEvent.shiftKey) rotation = Math.round(rotation / 15) * 15
      const normalized = Math.round((rotation % 360 + 360) % 360)
      setRotationReadout(normalized)
      latestBoard = { ...initialBoard, nodes: initialBoard.nodes.map((entry) => entry.id === initialNode.id ? { ...entry, rotation: normalized } : entry) }
      onBoardChange(latestBoard, null)
    }
    const cleanup = () => {
      disposeGesture();
      releasePointer()
      stageRef.current?.removeAttribute('data-active-transform')
      if (activeGestureCancelRef.current === cancel) activeGestureCancelRef.current = null
    }
    const finish = () => {
      cleanup()
      finishPostTransformClickSuppression()
      setRotationReadout(null)
      if (latestBoard !== initialBoard) onBoardChange(latestBoard, initialBoard)
    }
    const cancel = () => {
      cleanup()
      clearPostTransformClickSuppression()
      setRotationReadout(null)
      onBoardChange(initialBoard, null)
    }
    disposeGesture = listenGesture(event, move, finish, cancel)
    activeGestureCancelRef.current = cancel
  }

  function startNodeRadius(event: React.PointerEvent | React.MouseEvent, node: BoardNode) {
    if (viewOnly || node.kind !== 'shape' || (node.shapeType || 'rectangle') !== 'rectangle') return
    event.preventDefault()
    if (!allowTransform([node.id])) return
    event.stopPropagation()
    stageRef.current?.setAttribute('data-active-transform', 'radius')
    suppressPostTransformClick()
    const releasePointer = capturePointer(event)
    let disposeGesture: () => void = () => undefined
    const initialBoard = { ...boardRef.current }
    const initialNode = initialBoard.nodes.find((entry) => entry.id === node.id) || node
    const startX = event.clientX
    const originalRadius = Math.max(0, initialNode.cornerRadius || 0)
    const maxRadius = Math.min(initialNode.width, initialNode.height) / 2
    setCornerRadiusReadout(Math.round(Math.min(originalRadius, maxRadius)))
    let latestBoard = initialBoard
    const move = (pointerEvent: PointerSample) => {
      const radius = Math.round(Math.min(maxRadius, Math.max(0, originalRadius + (pointerEvent.clientX - startX) / initialBoard.viewport.scale)))
      setCornerRadiusReadout(radius)
      latestBoard = { ...initialBoard, nodes: initialBoard.nodes.map((entry) => entry.id === initialNode.id ? { ...entry, cornerRadius: radius } : entry) }
      onBoardChange(latestBoard, null)
    }
    const cleanup = () => {
      disposeGesture();
      releasePointer()
      stageRef.current?.removeAttribute('data-active-transform')
      if (activeGestureCancelRef.current === cancel) activeGestureCancelRef.current = null
    }
    const finish = () => {
      cleanup()
      finishPostTransformClickSuppression()
      setCornerRadiusReadout(null)
      if (latestBoard !== initialBoard) onBoardChange(latestBoard, initialBoard)
    }
    const cancel = () => {
      cleanup()
      clearPostTransformClickSuppression()
      setCornerRadiusReadout(null)
      onBoardChange(initialBoard, null)
    }
    disposeGesture = listenGesture(event, move, finish, cancel)
    activeGestureCancelRef.current = cancel
  }

  async function deleteSelected() {
    if (await onTrashSelection(board.id, selectedIds)) setSelectedIds([])
  }

  function duplicateSelected() {
    if (viewOnly) return
    const selected = new Set(selectedIds)
    const sourceNodes = memberNodes(selectedIds)
    const idMap = new Map(sourceNodes.map((node) => [node.id, `${node.kind}-${crypto.randomUUID()}`]))
    const duplicates = sourceNodes.map((node) => ({
      ...structuredClone(node),
      boardLinkRole: node.kind === 'board-link' && node.boardLinkRole === 'child' ? 'shortcut' as const : node.boardLinkRole,
      boardPortal: undefined,
      id: idMap.get(node.id)!,
      ...(node.graphColumn ? { graphColumn: { ...structuredClone(node.graphColumn), inputs: node.graphColumn.inputs.map(input => ({ ...input, sourceId: idMap.get(input.sourceId) || input.sourceId })) } } : {}),
      title: selected.has(node.id) || node.kind === 'column' ? `${node.title} copy` : node.title,
      x: node.x + 28,
      y: node.y + 28,
      parentColumnId: node.parentColumnId && idMap.has(node.parentColumnId) ? idMap.get(node.parentColumnId) : node.parentColumnId,
      groupId: node.groupId && idMap.has(node.groupId) ? idMap.get(node.groupId) : node.groupId,
      columnOrder: node.parentColumnId && !idMap.has(node.parentColumnId) ? (node.columnOrder ?? 0) + .5 : node.columnOrder,
    }))
    const connections = copyInternalConnectors(board.connectors, idMap, 28, 28)
    onBoardChange(prepareColumnEdit({ ...board, nodes: [...board.nodes, ...duplicates], connectors: [...board.connectors, ...connections] }, duplicates.map((node) => node.id)))
    setSelectedIds(selectedIds.map((id) => idMap.get(id)).filter((id): id is string => Boolean(id)))
  }

  function runColumnRowCommand(command: 'earlier' | 'later' | 'previous' | 'next' | 'detach' | 'ancestor') {
    const baseline = boardRef.current
    const result = command === 'detach'
      ? detachColumnRowsResult(baseline, selectedIds, { readOnly: viewOnly })
      : command === 'earlier' || command === 'later'
      ? moveColumnRowsResult(baseline, selectedIds, command, { readOnly: viewOnly })
      : command === 'previous' || command === 'next'
      ? moveColumnRowsToSiblingColumnResult(baseline, selectedIds, command, { readOnly: viewOnly })
      : moveSelectionToAncestorResult(baseline, selectedIds, { readOnly: viewOnly })
    if (!result.ok) { setDrawingNotice(result.issues[0]?.detail || 'The column command was cancelled.'); return false }
    if (result.value === baseline) return true
    return publishDiagramBoard(result.value, selectedIds)
  }

  function openColumnRowActions(event: React.MouseEvent<HTMLButtonElement>) {
    const bounds = event.currentTarget.getBoundingClientRect()
    setContextMenu({ x: bounds.left, y: bounds.bottom + 4, nodeId: selectedIds[0] })
  }

  function alignSelected(axis: 'left' | 'right' | 'center' | 'top' | 'middle' | 'bottom') {
    onBoardChange({ ...board, nodes: alignBoardNodes(board.nodes, selectedIds, axis) })
  }

  function distributeSelected(axis: 'horizontal' | 'vertical', mode: 'centers' | 'gaps' = 'centers') {
    onBoardChange({ ...board, nodes: distributeBoardNodes(board.nodes, selectedIds, axis, mode) })
  }

  function packSelected(rows?: number) {
    onBoardChange({ ...board, nodes: packBoardNodes(board.nodes, selectedIds, { gap: 24, rows }) })
  }

  function changeLayer(delta: number) {
    if (viewOnly || !selectedIds.length || !allowTransform(selectedIds)) return
    const result = changeDrawingLayerOrder(board.nodes, selectedIds, delta > 0 ? 'front' : 'back')
    if (!result.ok) { setDrawingNotice(result.issues[0]?.detail || 'Layer ordering was cancelled.'); return }
    if (result.value !== board.nodes) onBoardChange({ ...board, nodes: result.value })
  }

  function downloadSelectedAssets() {
    selectedIds.map((id) => board.nodes.find((node) => node.id === id)?.assetId).filter(Boolean).forEach((assetId) => { const node = board.nodes.find((entry) => entry.assetId === assetId); const url = node ? assetUrl(node) : undefined; const asset = assetId ? assetById.get(assetId) : undefined; if (!url || !asset) return; const link = document.createElement('a'); link.href = url; link.download = asset.originalName; link.click() })
  }

  function fitBoard() {
    if (!board.nodes.length) return
    const minX = Math.min(...board.nodes.map((node) => node.x))
    const minY = Math.min(...board.nodes.map((node) => node.y))
    const maxX = Math.max(...board.nodes.map((node) => node.x + node.width))
    const maxY = Math.max(...board.nodes.map((node) => node.y + node.height))
    const padX = 80, padY = 72
    const scale = Math.min(1.4, Math.max(.18, Math.min((stageSize.width - padX * 2) / Math.max(1, maxX - minX), (stageSize.height - padY * 2) / Math.max(1, maxY - minY))))
    rememberViewport(presentedViewportRef.current)
    const viewport = { x: (stageSize.width - (maxX - minX) * scale) / 2 - minX * scale, y: (stageSize.height - (maxY - minY) * scale) / 2 - minY * scale, scale }
    presentViewport(viewport)
    commitViewport(viewport)
  }

  function fitSelection() {
    const nodes = board.nodes.filter((node) => selectedIds.includes(node.id))
    if (!nodes.length) return
    const minX = Math.min(...nodes.map((node) => node.x)), minY = Math.min(...nodes.map((node) => node.y))
    const maxX = Math.max(...nodes.map((node) => node.x + node.width)), maxY = Math.max(...nodes.map((node) => node.y + node.height))
    const padding = 70
    const scale = Math.min(2, Math.max(.18, Math.min((stageSize.width - padding * 2) / Math.max(1, maxX - minX), (stageSize.height - padding * 2) / Math.max(1, maxY - minY))))
    rememberViewport(presentedViewportRef.current)
    const viewport = { x: (stageSize.width - (maxX - minX) * scale) / 2 - minX * scale, y: (stageSize.height - (maxY - minY) * scale) / 2 - minY * scale, scale }
    presentViewport(viewport)
    commitViewport(viewport)
  }

  function setZoom100() {
    const current = presentedViewportRef.current
    rememberViewport(current)
    const worldCenterX = (stageSize.width / 2 - current.x) / current.scale
    const worldCenterY = (stageSize.height / 2 - current.y) / current.scale
    const viewport = { x: stageSize.width / 2 - worldCenterX, y: stageSize.height / 2 - worldCenterY, scale: 1 }
    presentViewport(viewport)
    commitViewport(viewport)
  }

  function restorePreviousZoom() {
    const previous = previousViewportRef.current
    if (!previous) return
    rememberViewport(presentedViewportRef.current)
    presentViewport(previous)
    commitViewport(previous)
  }

  function addNestedBoardPortal() {
    const center = eventToWorld((stageBoundsRef.current?.left || 0) + stageSize.width / 2, (stageBoundsRef.current?.top || 0) + stageSize.height / 2)
    onCreateNestedBoard({ x: center.x - 90, y: center.y - 92 })
  }

  async function addBoardLink() {
    const targets = boards.filter((entry) => entry.id !== board.id)
    if (!targets.length) return
    const menu = targets.map((entry, index) => `${index + 1}. ${entry.title}`).join('\n')
    const answer = (await onRequestText({ title: 'Create board shortcut', label: 'Enter a board number or exact name', initialValue: '1', helpText: menu }))?.trim()
    if (!answer) return
    const numericIndex = Number(answer) - 1
    const target = Number.isInteger(numericIndex) && targets[numericIndex]
      ? targets[numericIndex]
      : targets.find((entry) => entry.title.toLocaleLowerCase() === answer.toLocaleLowerCase())
    if (!target) return
    const center = eventToWorld((stageBoundsRef.current?.left || 0) + stageSize.width / 2, (stageBoundsRef.current?.top || 0) + stageSize.height / 2)
    const node: BoardNode = { id: `board-link-${crypto.randomUUID()}`, kind: 'board-link', boardLinkRole: 'shortcut', targetBoardId: target.id, x: Math.round(center.x - 110), y: Math.round(center.y - 70), width: 220, height: 140, title: target.title, body: 'Open linked board', color: '#6ba39b' }
    onBoardChange({ ...board, nodes: [...board.nodes, node] })
    setSelectedIds([node.id])
  }

  function compactPack() {
    onBoardChange({ ...board, nodes: packBoardNodes(board.nodes, board.nodes.map((node) => node.id), { gap: 24 }) })
  }

  function normalizeImageSizes() {
    const selected = board.nodes.filter((node) => selectedIds.includes(node.id) && node.kind === 'image')
    const images = selected.length > 1 ? selected : board.nodes.filter((node) => node.kind === 'image' && !node.parentColumnId)
    if (images.length < 2) return
    const targetWidth = Math.min(...images.map((node) => node.width))
    const ids = new Set(images.map((node) => node.id))
    onBoardChange(prepareColumnEdit({ ...board, nodes: board.nodes.map((node) => ids.has(node.id) ? { ...node, width: targetWidth, height: Math.max(80, Math.round(node.height * targetWidth / node.width)) } : node) }, [...ids]))
  }

  useEffect(() => {
    if (!revealRequest || revealedToken.current === revealRequest.token) return
    const node = board.nodes.find((entry) => entry.id === revealRequest.nodeId)
    if (!node) return
    revealedToken.current = revealRequest.token
    if (!visibleDiagramIds.has(node.id)) { setDrawingNotice('The search match is hidden or inside a collapsed owner. Show it from Layers or expand its owner first.'); return }
    rememberViewport(presentedViewportRef.current)
    const bounds = stageBoundsRef.current, width = bounds?.width || stageSize.width, height = bounds?.height || stageSize.height
    const scale = Math.max(MIN_CANVAS_ZOOM, Math.min(presentedViewportRef.current.scale, width / (node.width + 80), height / (node.height + 80)))
    const viewport = { scale, x: width / 2 - (node.x + node.width / 2) * scale, y: height / 2 - (node.y + node.height / 2) * scale }
    presentViewport(viewport); commitViewport(viewport); setSelectedIds([node.id]); setSelectedConnectorId(null)
    stageRef.current?.focus({ preventScroll: true })
  }, [revealRequest?.token, board.id])

  function restoreDiagramFocus() {
    const opener = diagramOpenerRef.current
    const target = opener?.isConnected ? opener : stageRef.current?.querySelector<HTMLButtonElement>('[aria-label="More canvas tools"]')
    ;(target || stageRef.current)?.focus({ preventScroll: true })
  }

  function openDiagramPalette(event: React.MouseEvent<HTMLButtonElement>, mode: 'create' | 'successor' | 'insert') {
    cancelActiveGesture(); const rect = event.currentTarget.getBoundingClientRect(); diagramOpenerRef.current = event.currentTarget
    setShowMoreCanvasTools(false); setShowDiagramStructure(false); setShowBoardExport(false)
    setDiagramPalette({ mode, sourceId: selectedNode?.id, connectorId: selectedConnector?.id, left: Math.max(12, Math.min(rect.right + 8, window.innerWidth - 352)), top: Math.max(12, Math.min(rect.top, window.innerHeight - 420)) })
  }

  function publishDiagramBoard(next: BoardModel, ids: string[]) {
    const checked = validateBoardMutation(boardRef.current, next, viewOnly)
    if (!checked.ok) { setDrawingNotice(checked.issues[0]?.detail || 'The diagram command was cancelled.'); return false }
    if (commitBoardChange(next, boardRef.current) === false) return false
    boardRef.current = next; setSelectedIds(ids); setSelectedConnectorId(null); return true
  }

  function chooseDiagramShape(shape: DiagramShapeId) {
    if (!diagramPalette) return false
    const center = { x: (stageSize.width / 2 - presentedViewportRef.current.x) / presentedViewportRef.current.scale, y: (stageSize.height / 2 - presentedViewportRef.current.y) / presentedViewportRef.current.scale }
    const node = { shape, id: 'diagram-shape-' + crypto.randomUUID(), ...(shape === 'text' ? { textColor: theme === 'light' ? '#202734' : '#e7eef5' } : {}), ...(shape === 'line' || shape === 'arrow' ? { strokeColor: readableForeground(effectiveBoardBackground) } : {}) }
    const result = diagramPalette.mode === 'successor' && diagramPalette.sourceId
      ? createConnectedSuccessorResult(boardRef.current, { sourceId: diagramPalette.sourceId, node, connectorId: 'connector-' + crypto.randomUUID() }, { readOnly: viewOnly })
      : diagramPalette.mode === 'insert' && diagramPalette.connectorId
        ? insertDiagramNodeOnConnectorResult(boardRef.current, { connectorId: diagramPalette.connectorId, node, downstreamConnectorId: 'connector-' + crypto.randomUUID() }, { readOnly: viewOnly })
        : createDiagramNodeResult(boardRef.current, { ...node, center }, { readOnly: viewOnly })
    if (!result.ok) { setDrawingNotice(result.issues[0]?.detail || 'The diagram command was cancelled.'); return false }
    return publishDiagramBoard(result.value.board, [result.value.nodeId])
  }

  function focusUnsortedNode(node: BoardNode) {
    onBoardChange({ ...board, viewport: { ...board.viewport, x: stageSize.width / 2 - (node.x + node.width / 2) * board.viewport.scale, y: stageSize.height / 2 - (node.y + node.height / 2) * board.viewport.scale } }, null)
    setSelectedIds([node.id])
    setSelectedConnectorId(null)
    setShowUnsorted(false)
  }

  function fisheyeScale(_node: BoardNode) { return 1 }

  function addTextNode() {
    const count = board.nodes.length
    const node: BoardNode = {
      id: `text-${crypto.randomUUID()}`,
      kind: 'text',
      x: Math.round((100 - board.viewport.x) / board.viewport.scale + (count % 4) * 28),
      y: Math.round((100 - board.viewport.y) / board.viewport.scale + (count % 4) * 28),
      width: 260,
      height: 120,
      title: 'New text',
      body: 'Double-click and use the document pane for long-form writing.',
      color: '#d7a36a',
    }
    onBoardChange({ ...board, nodes: [...board.nodes, node] })
    setSelectedIds([node.id])
  }

  function addNoteNode() {
    const count = board.nodes.length
    const node: BoardNode = {
      id: `note-${crypto.randomUUID()}`,
      kind: 'note',
      x: Math.round((100 - board.viewport.x) / board.viewport.scale + (count % 4) * 28),
      y: Math.round((100 - board.viewport.y) / board.viewport.scale + (count % 4) * 28),
      width: 260,
      height: 150,
      title: 'New note',
      body: 'Write a note…',
      color: '#d7a36a',
    }
    onBoardChange({ ...board, nodes: [...board.nodes, node] })
    setSelectedIds([node.id])
  }

  function addTodoNode() {
    const center = eventToWorld((stageBoundsRef.current?.left || 0) + stageSize.width / 2, (stageBoundsRef.current?.top || 0) + stageSize.height / 2)
    const node: BoardNode = {
      id: `todo-${crypto.randomUUID()}`,
      kind: 'note',
      x: Math.round(center.x - 130),
      y: Math.round(center.y - 80),
      width: 260,
      height: 160,
      title: 'To-do List',
      body: '☐ First task\n☐ Second task\n☐ Third task',
      color: '#4e877e',
    }
    onBoardChange({ ...board, nodes: [...board.nodes, node] })
    setSelectedIds([node.id])
  }

  function addCommentNode() {
    const center = eventToWorld((stageBoundsRef.current?.left || 0) + stageSize.width / 2, (stageBoundsRef.current?.top || 0) + stageSize.height / 2)
    const node: BoardNode = {
      id: `comment-${crypto.randomUUID()}`,
      kind: 'note',
      x: Math.round(center.x - 110),
      y: Math.round(center.y - 60),
      width: 220,
      height: 120,
      title: 'Comment',
      body: 'Add your comment here…',
      color: '#e07a5f',
    }
    onBoardChange({ ...board, nodes: [...board.nodes, node] })
    setSelectedIds([node.id])
  }

  function toggleMilanoteLine() {
    if (interactionTool === 'connect') {
      setInteractionTool('select')
    } else {
      setShapeKind('line')
      setInteractionTool('draw')
    }
  }

  function toggleMilanoteDraw() {
    if (interactionTool === 'pencil') {
      setInteractionTool('select')
    } else {
      setViewportTool('select')
      setInteractionTool('pencil')
    }
  }

  useEffect(() => {
    const openWebCapture = () => {
      const attached = selectedNode && (selectedNode.kind === 'image' || selectedNode.kind === 'video') ? selectedNode : undefined
      setCaptureEditor({ assetId: attached?.assetId, initialValue: emptyCapture('social-post') })
    }
    window.addEventListener('art-equation:add-research-capture', openWebCapture)
    return () => window.removeEventListener('art-equation:add-research-capture', openWebCapture)
  }, [selectedNode])

  function editCaptureNode(node: BoardNode) {
    setCaptureEditor({ nodeId: node.id, assetId: node.assetId, initialValue: node.captured || emptyCapture('article') })
  }

  function saveCapture(content: CapturedContent, title: string) {
    if (!captureEditor) return
    if (captureEditor.nodeId) {
      updateNode(captureEditor.nodeId, { title, captured: content })
      setSelectedIds([captureEditor.nodeId])
    } else {
      const center = eventToWorld((stageBoundsRef.current?.left || 0) + stageSize.width / 2, (stageBoundsRef.current?.top || 0) + stageSize.height / 2)
      const node: BoardNode = {
        id: `clip-${crypto.randomUUID()}`,
        kind: 'clip',
        x: Math.round(center.x - 260),
        y: Math.round(center.y - 250),
        width: 520,
        height: 500,
        title,
        assetId: captureEditor.assetId,
        captured: content,
        color: '#c7945e',
      }
      onBoardChange({ ...board, nodes: [...board.nodes, node] })
      setSelectedIds([node.id])
    }
    setCaptureEditor(null)
  }

  function startShapeDraw(event: React.PointerEvent<HTMLElement>) {
    if (event.button !== 0 || interactionTool !== 'draw') return
    event.preventDefault()
    const releasePointer = capturePointer(event)
    let disposeGesture: () => void = () => undefined
    // Drawing must be independent of whatever card happens to be underneath the
    // initial pointer. Keep the board snapshot that existed when this gesture
    // began, then commit one shape transaction on pointer-up.
    const initialBoard = { ...boardRef.current }
    const source = eventToWorld(event.clientX, event.clientY)
    let target = source
    const previewId = `shape-preview-${crypto.randomUUID()}`
    const updatePreview = () => {
      const constrained = constrainShapePoint(source, target, shapeKind, event.shiftKey)
      const shape = drawnShapeNode(previewId, shapeKind, source, constrained)
      onBoardChange({ ...initialBoard, nodes: [...initialBoard.nodes.filter((node) => node.id !== previewId), shape] }, null)
    }
    const move = (pointerEvent: PointerSample) => {
      target = eventToWorld(pointerEvent.clientX, pointerEvent.clientY)
      const raw = constrainShapePoint(source, target, shapeKind, pointerEvent.shiftKey)
      const snapped = snapBounds({ x: Math.min(source.x, raw.x), y: Math.min(source.y, raw.y), width: Math.abs(raw.x - source.x), height: Math.abs(raw.y - source.y) }, [])
      setGuideLines(snapped.guides)
      const constrained = { x: raw.x >= source.x ? snapped.x + snapped.width : snapped.x, y: raw.y >= source.y ? snapped.y + snapped.height : snapped.y }
      const shape = drawnShapeNode(previewId, shapeKind, source, constrained)
      onBoardChange({ ...initialBoard, nodes: [...initialBoard.nodes.filter((node) => node.id !== previewId), shape] }, null)
    }
    const cleanup = () => {
      disposeGesture();
      releasePointer()
      setGuideLines([])
      if (activeGestureCancelRef.current === cancel) activeGestureCancelRef.current = null
    }
    const finish = (pointerEvent: PointerSample) => {
      cleanup()
      target = eventToWorld(pointerEvent.clientX, pointerEvent.clientY)
      const constrained = constrainShapePoint(source, target, shapeKind, pointerEvent.shiftKey)
      const shape = drawnShapeNode(`shape-${crypto.randomUUID()}`, shapeKind, source, constrained)
      if (shape.width > 5 || shape.height > 5) {
        onBoardChange({ ...initialBoard, nodes: [...initialBoard.nodes.filter((node) => node.id !== previewId), shape] }, initialBoard)
        setSelectedIds([shape.id])
      } else onBoardChange({ ...initialBoard, nodes: initialBoard.nodes.filter((node) => node.id !== previewId) }, null)
    }
    const cancel = () => {
      cleanup()
      onBoardChange({ ...boardRef.current, nodes: boardRef.current.nodes.filter((node) => node.id !== previewId) }, null)
    }
    updatePreview()
    disposeGesture = listenGesture(event, move, finish, cancel)
    activeGestureCancelRef.current = cancel
  }

  function groupSelected(preset?: { title: string; width: number; height: number; drawing?: boolean }) {
    if (viewOnly) return
    const members = board.nodes.filter((node) => selectedIds.includes(node.id) && node.kind !== 'column' && node.kind !== 'group')
    if (!members.length && !preset) return
    if (hasConnectedNodeGraphEdges(board, members.map((node) => node.id))) {
      setDrawingNotice('Disconnect typed edges before moving these cards out of their Node Column.')
      return
    }
    if (!allowTransform(transformMembers(members.map((node) => node.id)))) return
    const left = members.length ? Math.min(...members.map((node) => node.x)) - 22 : eventToWorld((stageBoundsRef.current?.left || 0) + stageSize.width / 2, (stageBoundsRef.current?.top || 0) + stageSize.height / 2).x
    const top = members.length ? Math.min(...members.map((node) => node.y)) - 50 : eventToWorld((stageBoundsRef.current?.left || 0) + stageSize.width / 2, (stageBoundsRef.current?.top || 0) + stageSize.height / 2).y
    const right = members.length ? Math.max(...members.map((node) => node.x + node.width)) + 22 : left + preset!.width
    const bottom = members.length ? Math.max(...members.map((node) => node.y + node.height)) + 22 : top + preset!.height
    const coverAssetId = members.find((node) => node.kind === 'image' && node.assetId)?.assetId
    const group: BoardNode = { id: `group-${crypto.randomUUID()}`, kind: 'group', containerRole: preset ? 'frame' : 'group', ...(preset ? { boundedCanvas: preset.drawing ? 'drawing' as const : 'frame' as const } : {}), x: Math.round(left), y: Math.round(top), width: members.length ? Math.round(right - left) : preset!.width, height: members.length ? Math.round(bottom - top) : preset!.height, title: preset?.title || 'Group', color: preset?.drawing ? '#ffffff' : '#56748e', strokeColor: '#8fb0c8', opacity: 1, cornerRadius: 0, zIndex: 0, coverAssetId }
    const reparented = reparentContainerNodes([...board.nodes, group], members.map((node) => node.id), { kind: 'group', id: group.id })
    if (!reparented.ok) { setDrawingNotice(reparented.issues[0]?.detail || 'Cannot group these objects.'); return }
    onBoardChange({ ...board, nodes: reparented.value })
    setSelectedIds([group.id])
  }

  function ungroupSelected() {
    if (viewOnly || !allowTransform(transformMembers(selectedIds))) return
    const groups = new Set(board.nodes.filter((node) => selectedIds.includes(node.id) && node.kind === 'group').map((node) => node.id))
    if (!groups.size) return
    onBoardChange({ ...board, nodes: board.nodes.filter((node) => !groups.has(node.id)).map((node) => groups.has(node.groupId || '') ? { ...node, groupId: undefined } : node) })
    setSelectedIds(board.nodes.filter((node) => groups.has(node.groupId || '')).map((node) => node.id))
  }

  async function saveClipboardImage(blob: Blob, suggestedName = 'pasted-image.png') {
    if (readOnly) return
    const initialBoard = boardRef.current
    const extension = blob.type.split('/')[1]?.replace('jpeg', 'jpg') || 'png'
    const record = await saveGeneratedImage(new Uint8Array(await blob.arrayBuffer()), {
      projectId,
      projectName,
      boardName: board.title,
      fileName: suggestedName.replace(/\.[^.]+$/, `.${extension}`),
    })
    const asset: ProjectAsset = { ...managedAsset(record), displayName: suggestedName.replace(/\.[^.]+$/, ''), virtualFolder: 'Pasted images', history: [{ at: new Date().toISOString(), action: 'Pasted from system clipboard' }] }
    const dimensions = await readImageDimensions(asset, workspaceAssetUrl(workspaceRoot, asset.relativePath))
    const fitted = fitNaturalImageBounds(dimensions, { width: 320, height: 240 })
    if (!fitted) throw new Error('Clipboard image dimensions are unavailable; its original is still stored on disk.')
    if (boardRef.current !== initialBoard) throw new Error('The board changed while the clipboard image was being imported; retry the paste.')
    const center = eventToWorld((stageBoundsRef.current?.left || 0) + stageSize.width / 2, (stageBoundsRef.current?.top || 0) + stageSize.height / 2)
    const node: BoardNode = { id: `image-${crypto.randomUUID()}`, kind: 'image', imagePresentation: 'artwork', assetId: asset.id, x: center.x - fitted.width / 2, y: center.y - fitted.height / 2, ...fitted, title: asset.displayName, body: 'Pasted from clipboard', color: '#6b8297' }
    if (onAddGeneratedAsset(asset, node)) setSelectedIds([node.id])
  }

  async function pasteSystemClipboard() {
    try {
      const clipboard = await navigator.clipboard.read()
      for (const item of clipboard) {
        const type = item.types.find((entry) => entry.startsWith('image/'))
        if (type) {
          try { await saveClipboardImage(await item.getType(type)) }
          catch (error) { setDrawingNotice('Could not paste the image: ' + String(error)) }
          return
        }
      }
      pasteClipboard()
    } catch {
      pasteClipboard()
    }
  }

  async function exportBytes(fileName: string, bytes: Uint8Array, extensions: string[]) {
    if (!('__TAURI_INTERNALS__' in window)) {
      const url = URL.createObjectURL(new Blob([bytes.slice().buffer])); const link = document.createElement('a'); link.href = url; link.download = fileName; link.click(); window.setTimeout(() => URL.revokeObjectURL(url), 30000); return
    }
    const destination = await save({ defaultPath: fileName, filters: [{ name: 'Export', extensions }] })
    if (!destination) return
    await exportBinary(destination, bytes)
  }

  async function saveSelectedOriginal(node = selectedNode) {
    if (!node?.assetId) return
    const asset = assetById.get(node.assetId)
    const source = asset ? workspaceAssetUrl(workspaceRoot, asset.relativePath) || assetUrl(node) : undefined
    if (!asset || !source) return
    const response = await fetch(source)
    if (!response.ok) throw new Error('The original file is unavailable')
    await exportBytes(asset.originalName, new Uint8Array(await response.arrayBuffer()), [asset.extension])
  }

  async function renderImageBlob(node = selectedNode) {
    if (!node || node.kind !== 'image') throw new Error('Select an image card')
    const source = imageUrl(node)
    if (!source) throw new Error('The source image is unavailable')
    const image = await loadImage(source)
    const width = Math.max(1, Math.min(8192, Math.round(node.width)))
    const height = Math.max(1, Math.min(8192, Math.round(node.height)))
    const canvas = document.createElement('canvas')
    canvas.width = width; canvas.height = height
    const context = canvas.getContext('2d')
    if (!context) throw new Error('Canvas is unavailable')
    const transform = node.imageTransform
    if (node.imagePresentation !== 'artwork') {
      context.fillStyle = node.color || '#15171b'
      context.fillRect(0, 0, width, height)
    }
    context.save()
    context.globalAlpha = transform?.opacity ?? 1
    context.globalCompositeOperation = transform?.blendMode || 'source-over'
    if (transform?.grayscale) context.filter = 'grayscale(1)'
    context.translate(width / 2, height / 2)
    context.rotate((transform?.rotation || 0) * Math.PI / 180)
    context.scale(transform?.flipX ? -1 : 1, transform?.flipY ? -1 : 1)
    const framed = imageDrawRect({ width: image.naturalWidth, height: image.naturalHeight }, { width, height }, transform)
    if (!framed) throw new Error('Image dimensions are invalid')
    context.drawImage(image, framed.x - width / 2, framed.y - height / 2, framed.width, framed.height)
    context.restore()
    drawCompositionOverlay(context, transform?.overlay, width, height)
    const output = document.createElement('canvas')
    output.width = width; output.height = height
    const outputContext = output.getContext('2d')
    if (!outputContext) throw new Error('Canvas is unavailable')
    outputContext.globalAlpha = Math.max(0, Math.min(1, node.opacity ?? 1))
    outputContext.drawImage(canvas, 0, 0)
    return await new Promise<Blob>((resolve, reject) => output.toBlob((value) => value ? resolve(value) : reject(new Error('Could not encode image')), 'image/png'))
  }

  async function exportSelectedAppearance(node = selectedNode) {
    const blob = await renderImageBlob(node)
    if (!node) return
    await exportBytes(`${node.title?.replace(/[^a-z0-9]+/gi, '-').replace(/^-|-$/g, '') || 'board-image'}-export.png`, new Uint8Array(await blob.arrayBuffer()), ['png'])
  }

  async function copySelectedImage(node = selectedNode) {
    const blob = await renderImageBlob(node)
    if (!navigator.clipboard?.write || typeof ClipboardItem === 'undefined') throw new Error('Image clipboard is unavailable; use Export rendered image instead')
    await navigator.clipboard.write([new ClipboardItem({ 'image/png': blob })])
  }

  async function selectionSvg() {
    if (!selectedIds.length) throw new Error('Select at least one object to export')
    return (await boardExportSvg('selection')).svg
  }

  async function exportSelectionSvg() {
    const svg = await selectionSvg()
    await exportBytes(`${board.title.replace(/[^a-z0-9]+/gi, '-').replace(/^-|-$/g, '') || 'board'}-selection.svg`, new TextEncoder().encode(svg), ['svg'])
  }

  async function copySelectedSvg() {
    if (!navigator.clipboard?.writeText) throw new Error('Text clipboard is unavailable')
    await navigator.clipboard.writeText(await selectionSvg())
  }

  async function selectedPngBlob() {
    const { svg } = await boardExportSvg('selection', 1)
    const image = await loadImage(`data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`)
    const width = Math.max(1, Math.min(8192, Math.round(image.naturalWidth || image.width)))
    const height = Math.max(1, Math.min(8192, Math.round(image.naturalHeight || image.height)))
    const canvas = document.createElement('canvas')
    canvas.width = width; canvas.height = height
    const context = canvas.getContext('2d')
    if (!context) throw new Error('Canvas is unavailable')
    context.drawImage(image, 0, 0, width, height)
    return await new Promise<Blob>((resolve, reject) => canvas.toBlob((value) => value ? resolve(value) : reject(new Error('Could not encode selection')), 'image/png'))
  }

  async function copySelectedPng() {
    const blob = await selectedPngBlob()
    if (!navigator.clipboard?.write || typeof ClipboardItem === 'undefined') throw new Error('Image clipboard is unavailable')
    await navigator.clipboard.write([new ClipboardItem({ 'image/png': blob })])
  }

  async function exportSelectedPng() {
    const blob = await selectedPngBlob()
    await exportBytes(`${board.title.replace(/[^a-z0-9]+/gi, '-').replace(/^-|-$/g, '') || 'board'}-selection.png`, new Uint8Array(await blob.arrayBuffer()), ['png'])
  }

  const boardExportReview = useMemo(() => {
    if (!showBoardExport) return null
    const projection = prepareBoardVisualExport(board, { target: boardExportTarget, selectedIds, viewportSize: stageSize })
    if (!projection.ok) return { error: projection.issues[0]?.detail || 'The export region is invalid.', warnings: [] as string[] }
    const inventory = prepareResearchExport({ id: projectId, boards, assets }, board.id, 'board')
    if (!inventory.ok) return { error: inventory.issues[0]?.detail || 'The export source is invalid.', warnings: [] as string[] }
    const ids = new Set(projection.value.nodes.map((node) => node.id))
    return { error: '', warnings: inventory.value.warnings.filter((warning) => warning.nodeId ? ids.has(warning.nodeId) : warning.code !== 'originals-not-packaged').map((warning) => warning.detail) }
  }, [showBoardExport, board, boardExportTarget, selectedIds, stageSize, projectId, boards, assets])

  async function sourceAsDataUrl(source: string) {
    if (source.startsWith('data:')) return source
    const response = await fetch(source)
    if (!response.ok) throw new Error(`Could not embed an image source (HTTP ${response.status}); originals are unchanged`)
    const blob = await response.blob()
    return await new Promise<string>((resolve, reject) => {
      const reader = new FileReader()
      reader.onload = () => typeof reader.result === 'string' ? resolve(reader.result) : reject(new Error('Could not embed the image source'))
      reader.onerror = () => reject(new Error('Could not read the image source for export'))
      reader.readAsDataURL(blob)
    })
  }

  async function boardExportSvg(target: typeof boardExportTarget, rasterScale?: number) {
    const exportBoard = boardRef.current
    const prepared = prepareBoardVisualExport(exportBoard, { target, selectedIds, viewportSize: stageSize })
    if (!prepared.ok) throw new Error(prepared.issues[0]?.detail || 'The export region is invalid.')
    const { nodes, connectors: exportConnectors, bounds } = prepared.value
    const imageSources = new Map<string, string>()
    const imageDimensions = new Map<string, { width: number; height: number }>()
    const scale = rasterScale === undefined ? undefined : Math.min(rasterScale, 8192 / Math.max(bounds.width, bounds.height))
    // One source bitmap at a time. Raster exports embed pixels at final output
    // density; vector exports retain the complete original source bytes.
    for (const node of nodes) {
      if (node.kind === 'image') {
        const source = imageUrl(node)
        if (!source) continue
        if (scale !== undefined) {
          const prepared = await prepareRasterExportSource(source, node, node.imageTransform, scale)
          imageSources.set(node.id, prepared.data); imageDimensions.set(node.id, prepared.dimensions)
          recordMetric('export.image-prepared', { id: node.id, width: prepared.output.width, height: prepared.output.height, bytes: prepared.bytes, scale })
        } else {
          const data = await sourceAsDataUrl(source)
          const image = await loadImage(data)
          imageSources.set(node.id, data); imageDimensions.set(node.id, { width: image.naturalWidth, height: image.naturalHeight })
          image.src = ''
        }
      } else if (node.kind === 'group' || node.kind === 'column') {
        const coverId = node.coverAssetId || containerCoverAsset(node)
        const cover = coverId ? assetById.get(coverId) : undefined
        const source = workspaceAssetUrl(workspaceRoot, assetPreviewPath(cover))
        if (source) imageSources.set(`cover:${node.id}`, scale === undefined ? await sourceAsDataUrl(source) : (await prepareRasterExportSource(source, node, { fit: 'cover' }, scale)).data)
      }
    }
    const safe = (value: string | number) => escapeHtml(String(value))
    const nodeMarkup = nodes.map((node) => {
      if (node.graphColumn) return graphColumnSvg(exportBoard, node)
      const fill = safe(node.color || '#313742')
      const stroke = safe(node.strokeColor || '#a8b1bd')
      const opacity = Math.max(0, Math.min(1, node.opacity ?? 1))
      const title = safe(nodeTitle(node))
      const cx = node.x + node.width / 2, cy = node.y + node.height / 2
      const rotation = node.rotation || 0
      const flipX = node.imageTransform?.flipX ? -1 : 1, flipY = node.imageTransform?.flipY ? -1 : 1
      const transform = rotation ? ` transform="rotate(${safe(rotation)} ${safe(cx)} ${safe(cy)})"` : ''
      const object = (markup: string) => `<g${transform} opacity="${safe(opacity)}">${markup}</g>`
      if (node.boundedCanvas) return node.boundedCanvas === 'drawing' ? object(`<rect x="${safe(node.x)}" y="${safe(node.y)}" width="${safe(node.width)}" height="${safe(node.height)}" fill="${fill}"/>`) : ''
      if (node.kind === 'image') {
        const source = imageSources.get(node.id)
        if (!source) throw new Error(`The image source for “${nodeTitle(node)}” is unavailable; no incomplete export was saved`)
        const framed = imageDrawRect(imageDimensions.get(node.id)!, { width: node.width, height: node.height }, node.imageTransform)
        if (!framed) throw new Error('Image dimensions are invalid; the original is unchanged')
        const clipId = `board-image-${[...node.id].map((character) => character.codePointAt(0)!.toString(16)).join('-')}`
        const imageTransform = `translate(${safe(cx)} ${safe(cy)}) rotate(${safe(node.imageTransform?.rotation || 0)}) scale(${flipX} ${flipY}) translate(${safe(-cx)} ${safe(-cy)})`
        return object(`<defs><clipPath id="${clipId}"><rect x="${safe(node.x)}" y="${safe(node.y)}" width="${safe(node.width)}" height="${safe(node.height)}" rx="${safe(node.cornerRadius ?? 8)}"/></clipPath></defs><g clip-path="url(#${clipId})"><image href="${safe(source)}" x="${safe(node.x + framed.x)}" y="${safe(node.y + framed.y)}" width="${safe(framed.width)}" height="${safe(framed.height)}" preserveAspectRatio="none" opacity="${safe(Math.max(0, Math.min(1, node.imageTransform?.opacity ?? 1)))}" transform="${imageTransform}"${node.imageTransform?.grayscale ? ' filter="url(#grayscale)"' : ''}/></g>`)
      }
      if (node.kind === 'shape') {
        if (node.shapeType === 'line' || node.shapeType === 'arrow') {
          const path = directSelectionPath(node)!
          const start = path.points[0], end = path.points.at(-1)!
          const markerId = `board-shape-arrow-${[...node.id].map((character) => character.codePointAt(0)!.toString(16)).join('-')}`
          return object(`<defs><marker id="${markerId}" markerWidth="8" markerHeight="8" refX="7" refY="4" orient="auto"><path d="M 0 0 L 8 4 L 0 8 z" fill="${stroke}"/></marker></defs><line x1="${safe(node.x + start.x)}" y1="${safe(node.y + start.y)}" x2="${safe(node.x + end.x)}" y2="${safe(node.y + end.y)}" stroke="${stroke}" stroke-width="${safe(node.strokeWidth ?? 2)}"${node.shapeType === 'arrow' ? ` marker-end="url(#${markerId})"` : ''}/>`)
        }
        if (node.shapeType === 'path' && node.vectorPath) return vectorNodeSvgMarkup(node, node.x, node.y, 'board')
        return object(node.shapeType === 'ellipse' ? `<ellipse cx="${safe(cx)}" cy="${safe(cy)}" rx="${safe(node.width * .49)}" ry="${safe(node.height * .49)}" fill="${fill}" stroke="${stroke}" stroke-width="${safe(node.strokeWidth ?? 2)}"/>` : `<rect x="${safe(node.x)}" y="${safe(node.y)}" width="${safe(node.width)}" height="${safe(node.height)}" rx="${safe(node.cornerRadius ?? 8)}" fill="${fill}" stroke="${stroke}" stroke-width="${safe(node.strokeWidth ?? 2)}"/>`)
      }
      if (node.kind === 'text') {
        const clipId = `board-type-${[...node.id].map((character) => character.codePointAt(0)!.toString(16)).join('-')}`
        return object(textSvgMarkup(
          node.body || `<p>${escapeHtml(node.title)}</p>`,
          node.x,
          node.y,
          Math.max(1, node.width),
          { color: node.textColor || '#ffffff', family: 'Arial, sans-serif', size: 14, weight: '400' },
          1,
          node.height,
          clipId
        ))
      }
      const body = safe((node.body || '').replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 180))
      const container = node.kind === 'group' || node.kind === 'column'
      const coverSource = container ? imageSources.get(`cover:${node.id}`) : undefined
      const radius = safe(node.cornerRadius || (container ? 12 : 8))
      const coverMarkup = coverSource ? `<image href="${safe(coverSource)}" x="${safe(node.x)}" y="${safe(node.y)}" width="${safe(node.width)}" height="${safe(node.height)}" preserveAspectRatio="xMidYMid slice" opacity="1"/><rect x="${safe(node.x)}" y="${safe(node.y)}" width="${safe(node.width)}" height="${safe(node.height)}" rx="${radius}" fill="#101419" fill-opacity=".42"/>` : ''
      const clipId = 'board-card-' + [...node.id].map((character) => character.codePointAt(0)!.toString(16)).join('-')
      return object(`<defs><clipPath id="${clipId}"><rect x="${safe(node.x)}" y="${safe(node.y)}" width="${safe(node.width)}" height="${safe(node.height)}" rx="${radius}"/></clipPath></defs><g clip-path="url(#${clipId})"><rect x="${safe(node.x)}" y="${safe(node.y)}" width="${safe(node.width)}" height="${safe(node.height)}" rx="${radius}" fill="${fill}" stroke="${stroke}" stroke-width="1"/>${coverMarkup}<text x="${safe(node.x + 12)}" y="${safe(node.y + 24)}" fill="${safe(node.textColor || '#ffffff')}" font-family="sans-serif" font-size="12" font-weight="600">${title}</text>${body ? `<text x="${safe(node.x + 12)}" y="${safe(node.y + 44)}" fill="#e8ebef" font-family="sans-serif" font-size="10">${body}</text>` : ''}</g>`)
    }).join('')
    const connectors = exportConnectors.map((connector) => connectorSvgMarkup(connector, exportBoard.nodes, 'board')).join('')
    const backdrop = target === 'selection' ? '' : `<rect x="${safe(bounds.left)}" y="${safe(bounds.top)}" width="${safe(bounds.width)}" height="${safe(bounds.height)}" fill="${safe(effectiveBoardBackground)}"/>`
    return { svg: `<svg xmlns="http://www.w3.org/2000/svg" width="${safe(Math.ceil(bounds.width))}" height="${safe(Math.ceil(bounds.height))}" viewBox="${safe(bounds.left)} ${safe(bounds.top)} ${safe(bounds.width)} ${safe(bounds.height)}"><defs><filter id="grayscale"><feColorMatrix type="saturate" values="0"/></filter></defs>${backdrop}${connectors}${nodeMarkup}</svg>`, bounds }
  }

  async function exportBoardImage() {
    try {
      const { svg, bounds } = await boardExportSvg(boardExportTarget, boardExportScale)
      const source = URL.createObjectURL(new Blob([svg], { type: 'image/svg+xml' }))
      try {
        const image = await loadImage(source)
        const maxDimension = 8192
        const scale = Math.min(boardExportScale, maxDimension / Math.max(bounds.width, bounds.height))
        const canvas = document.createElement('canvas')
        canvas.width = Math.max(1, Math.round(bounds.width * scale)); canvas.height = Math.max(1, Math.round(bounds.height * scale))
        const context = canvas.getContext('2d')
        if (!context) throw new Error('Canvas is unavailable')
        context.drawImage(image, 0, 0, canvas.width, canvas.height)
        const mime = boardExportFormat === 'jpeg' ? 'image/jpeg' : 'image/png'
        const blob = await new Promise<Blob>((resolve, reject) => canvas.toBlob((value) => value ? resolve(value) : reject(new Error('Could not encode board export')), mime, .92))
        const suffix = `${boardExportTarget}-${boardExportScale}x.${boardExportFormat === 'jpeg' ? 'jpg' : 'png'}`
        await exportBytes(`${board.title.replace(/[^a-z0-9]+/gi, '-').replace(/^-|-$/g, '') || 'board'}-${suffix}`, new Uint8Array(await blob.arrayBuffer()), [boardExportFormat === 'jpeg' ? 'jpg' : 'png'])
        setShowBoardExport(false)
      } finally { URL.revokeObjectURL(source) }
    } catch (error) { appAlert(`Could not export board: ${String(error)}`) }
  }

  function copySelected() {
    const selected = memberNodes(selectedIds)
    if (!selected.length) return
    const ids = new Set(selected.map((node) => node.id))
    const connectors = board.connectors.filter((connector) => (connector.sourceId && ids.has(connector.sourceId) || connector.targetId && ids.has(connector.targetId)) && (!connector.sourceId || ids.has(connector.sourceId)) && (!connector.targetId || ids.has(connector.targetId)))
    localStorage.setItem('art-equation-board-clipboard', JSON.stringify({ nodes: selected, connectors, sourceBoardId: board.id }))
  }

  function copyInternalConnectors(connectors: BoardConnector[], ids: Map<string, string>, dx: number, dy: number) {
    return connectors.filter((connector) => (connector.sourceId && ids.has(connector.sourceId) || connector.targetId && ids.has(connector.targetId)) && (!connector.sourceId || ids.has(connector.sourceId)) && (!connector.targetId || ids.has(connector.targetId))).map((connector) => ({
      ...structuredClone(connector), id: `connector-${crypto.randomUUID()}`,
      sourceId: connector.sourceId ? ids.get(connector.sourceId) : undefined,
      targetId: connector.targetId ? ids.get(connector.targetId) : undefined,
      sourcePoint: connector.sourcePoint ? { x: connector.sourcePoint.x + dx, y: connector.sourcePoint.y + dy } : undefined,
      targetPoint: connector.targetPoint ? { x: connector.targetPoint.x + dx, y: connector.targetPoint.y + dy } : undefined,
      bendPoints: connector.bendPoints?.map((point) => ({ ...point, x: point.x + dx, y: point.y + dy })),
    }))
  }

  function pasteClipboard() {
    if (viewOnly) return
    try {
      const clip = JSON.parse(localStorage.getItem('art-equation-board-clipboard') || '{}') as { nodes?: BoardNode[]; connectors?: BoardConnector[] }
      if (!Array.isArray(clip.nodes) || !clip.nodes.length || clip.nodes.length > 10000 || new Set(clip.nodes.map((node) => node?.id)).size !== clip.nodes.length || clip.nodes.some((node) => !node || ![node.x, node.y, node.width, node.height].every(Number.isFinite))) return
      const ids = new Map(clip.nodes.map((node) => [node.id, `${node.kind}-${crypto.randomUUID()}`]))
      const center = eventToWorld((stageBoundsRef.current?.left || 0) + stageSize.width / 2, (stageBoundsRef.current?.top || 0) + stageSize.height / 2)
      const minX = Math.min(...clip.nodes.map((node) => node.x)), minY = Math.min(...clip.nodes.map((node) => node.y))
      const normalized = normalizeBoardVectorPaths({ ...board, nodes: clip.nodes, connectors: [] }).nodes
      const dx = Math.round(center.x - minX), dy = Math.round(center.y - minY)
      const copied = normalized.map((node) => ({ ...structuredClone(node), id: ids.get(node.id)!, groupId: node.groupId ? ids.get(node.groupId) : undefined, parentColumnId: node.parentColumnId ? ids.get(node.parentColumnId) : undefined, boardLinkRole: node.boardLinkRole === 'child' ? 'shortcut' as const : node.boardLinkRole, boardPortal: undefined, x: node.x + dx, y: node.y + dy }))
      const mappedConnectors = copyInternalConnectors(Array.isArray(clip.connectors) ? clip.connectors : [], ids, dx, dy)
      const connectors = retainPastedNodeGraphConnectors({ ...board, nodes: [...board.nodes, ...copied] }, mappedConnectors)
      if (connectors.length !== mappedConnectors.length) setDrawingNotice('Copied cards left their Node Column, so typed connections were not pasted.')
      onBoardChange(prepareColumnEdit({ ...board, nodes: [...board.nodes, ...copied], connectors: [...board.connectors, ...connectors] }, copied.map((node) => node.id)))
      setSelectedIds(copied.map((node) => node.id))
    } catch { /* malformed clipboard is safely ignored */ }
  }

  function openViewOnlyBoard() {
    // A separate native webview keeps the board focused as a presentation surface.
    // The project is already persisted by the normal autosave path; the route marker
    // also lets a future dedicated presenter keep its state isolated.
    try { new WebviewWindow(`board-view-${board.id}`, { url: `/?view-board=${encodeURIComponent(board.id)}`, title: `${board.title} — View only`, width: 1280, height: 800 }) } catch { window.open(`/?view-board=${encodeURIComponent(board.id)}`, '_blank', 'noopener') }
  }

  async function flattenSelected() {
    if (!selectedIds.length) return
    const initialBoard = boardRef.current
    try {
      const { svg, bounds } = await boardExportSvg('selection')
      if (boardRef.current !== initialBoard) throw new Error('The board changed during export; retry on the current selection')
      const node: BoardNode = { id: `flattened-${crypto.randomUUID()}`, kind: 'image', imagePresentation: 'artwork', x: bounds.left, y: bounds.top, width: bounds.width, height: bounds.height, title: 'Flattened selection', body: `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`, color: '#6b8297' }
      onBoardChange({ ...initialBoard, nodes: [...initialBoard.nodes, node] })
      setSelectedIds([node.id])
    } catch (error) { setDrawingNotice(`Could not flatten selection: ${String(error)}`) }
  }

  function updateImageTransform(update: Partial<ImageTransform>, node = selectedNode) {
    if (node?.kind !== 'image' || viewOnly || !allowTransform([node.id])) return
    updateNode(node.id, { imageTransform: { ...node.imageTransform, ...update } })
  }

  function editContextNode(node: BoardNode) {
    setContextMenu(null)
    setSelectedIds([node.id])
    if (node.vectorPath) {
      setInteractionTool('node')
      return
    }
    setInteractionTool('select')
    if (node.kind === 'text') window.setTimeout(() => stageRef.current?.querySelector<HTMLElement>(`article[aria-label^="text card:"] [contenteditable="true"]`)?.focus(), 0)
  }

  async function bakeImageTransform() {
    if (!selectedNode || selectedNode.kind !== 'image' || !selectedNode.assetId || !selectedNode.imageTransform || viewOnly || !allowTransform([selectedNode.id])) return
    const initialBoard = boardRef.current
    const sourceAsset = assetById.get(selectedNode.assetId)
    const source = imageUrl(selectedNode)
    if (!sourceAsset || !source) return
    try {
      const image = await loadImage(source)
      const transform = selectedNode.imageTransform
      const width = Math.max(1, Math.min(8192, Math.round(selectedNode.width)))
      const height = Math.max(1, Math.min(8192, Math.round(selectedNode.height)))
      const blob = await renderImageBlob(selectedNode)
      if (boardRef.current !== initialBoard) throw new Error('The board changed while rendering; retry on the current selection')
      const record = await saveGeneratedImage(new Uint8Array(await blob.arrayBuffer()), { projectId, projectName, boardName: board.title, fileName: `${sourceAsset.displayName.replace(/[^a-z0-9]+/gi, '-').replace(/^-|-$/g, '')}-transformed.png` })
      const derived: ProjectAsset = { ...managedAsset(record), displayName: `${sourceAsset.displayName} — transformed`, virtualFolder: 'Derived / Transformations', history: [{ at: new Date().toISOString(), action: 'Baked transform', detail: JSON.stringify(transform) }], generated: { engine: 'board-transform', sourceAssetId: sourceAsset.id, sourceRelativePath: sourceAsset.relativePath, boardId: board.id, operation: 'bake-transform', sourceWidth: image.naturalWidth, sourceHeight: image.naturalHeight, outputWidth: width, outputHeight: height, generatedAt: new Date().toISOString() } }
      onDerivedAsset(derived, selectedNode.id)
    } catch (error) { appAlert(`Could not bake the transform: ${String(error)}`) }
  }

  function addColumnNode() {
    const count = board.nodes.filter((node) => node.kind === 'column').length
    const node: BoardNode = {
      id: `column-${crypto.randomUUID()}`,
      kind: 'column',
      x: Math.round((120 - board.viewport.x) / board.viewport.scale + (count % 5) * 34),
      y: Math.round((110 - board.viewport.y) / board.viewport.scale + (count % 5) * 24),
      width: 290,
      height: 150,
      title: 'New column',
      columnImageSizing: 'responsive',
      color: swatches[count % swatches.length] || '#d7a36a',
    }
    onBoardChange(prepareColumnEdit({ ...board, nodes: [...board.nodes, node] }, [node.id]))
    setSelectedIds([node.id])
  }

  function addNodeColumnNode() {
    const count = board.nodes.filter(isNodeColumn).length
    const node: BoardNode = {
      id: `node-column-${crypto.randomUUID()}`, kind: 'column',
      x: Math.round((150 - board.viewport.x) / board.viewport.scale + (count % 5) * 34),
      y: Math.round((130 - board.viewport.y) / board.viewport.scale + (count % 5) * 24),
      width: 290, height: 150, title: 'New Node Column',
      columnImageSizing: 'responsive',
      color: swatches[count % swatches.length] || '#6ba39b',
    }
    const result = createNodeColumnResult(board, node, viewOnly)
    if (!result.ok) { setDrawingNotice(result.issues[0]?.detail || 'Could not create Node Column.'); return }
    onBoardChange(result.value)
    setSelectedIds([node.id])
    setSelectedConnectorId(null)
  }

  function changeNodeGraphRole(node: BoardNode, role: NodeGraphRole) {
    const result = setNodeGraphRoleResult(board, node.id, role, viewOnly)
    if (!result.ok) { setDrawingNotice(result.issues[0]?.detail || 'Could not change the graph role.'); return }
    if (result.value !== board) onBoardChange(result.value)
  }

  async function renameColumn(node: BoardNode) {
    const title = (await onRequestText({ title: 'Rename column', label: 'Column title', initialValue: node.title }))?.trim()
    if (title && title !== node.title) updateNode(node.id, { title })
  }

  function toggleColumn(node: BoardNode) {
    onBoardChange(prepareColumnEdit({ ...board, nodes: board.nodes.map((entry) => entry.id === node.id ? { ...entry, collapsed: !entry.collapsed } : entry) }, [node.id]))
  }

  async function renameContainer(node: BoardNode) {
    const title = (await onRequestText({ title: `Rename ${node.kind === 'group' ? 'group' : 'column'}`, label: `${node.kind === 'group' ? 'Group' : 'Column'} title`, initialValue: node.title }))?.trim()
    if (title && title !== node.title) updateNode(node.id, { title })
  }

  function toggleContainer(node: BoardNode) {
    if (node.kind === 'column') toggleColumn(node)
    else updateNode(node.id, { collapsed: !node.collapsed })
  }

  function containerCoverAsset(node: BoardNode) {
    if (node.coverAssetId && assetById.has(node.coverAssetId)) return node.coverAssetId
    return board.nodes.find((entry) => (node.kind === 'column' ? entry.parentColumnId === node.id : entry.groupId === node.id) && entry.kind === 'image' && entry.assetId)?.assetId
  }

  function toggleContainerCover(node: BoardNode) {
    const current = node.coverAssetId
    const candidate = current ? undefined : containerCoverAsset(node)
    if (!candidate && !current) return
    updateNode(node.id, { coverAssetId: candidate })
  }

  function setContainerCover(node: BoardNode, assetId?: string) {
    updateNode(node.id, { coverAssetId: assetId })
  }

  function parentContainer(node: BoardNode) {
    const containerId = node.groupId || node.parentColumnId
    return containerId ? board.nodes.find((entry) => entry.id === containerId && (entry.kind === 'group' || entry.kind === 'column')) : undefined
  }

  function dissolveContainer(node: BoardNode) {
    if (isNodeColumn(node) && board.connectors.some((edge) => isNodeGraphConnector(edge)
      && [edge.sourceId, edge.targetId].some((id) => nodeGraphOwner(board, board.nodes.find((entry) => entry.id === id))?.id === node.id))) {
      setDrawingNotice('Disconnect typed edges before dissolving this Node Column.')
      return
    }
    const result = dissolveBoardContainer(board, node.id, viewOnly)
    if (!result.ok) { setDrawingNotice(result.issues[0]?.detail || 'Cannot dissolve this container.'); return }
    onBoardChange(result.value)
    setSelectedIds(board.nodes.filter((entry) => entry.groupId === node.id || entry.parentColumnId === node.id).map((entry) => entry.id))
  }

  function connectNodeSockets(source: { nodeId: string; socket: string }, target: { nodeId: string; socket: string }) {
    const initial = boardRef.current
    const result = connectNodeGraphPortsResult(initial, {
      id: `connector-${crypto.randomUUID()}`, sourceId: source.nodeId, sourceSocket: source.socket,
      targetId: target.nodeId, targetSocket: target.socket,
    }, viewOnly)
    if (!result.ok) { setDrawingNotice(result.issues[0]?.detail || 'These graph sockets cannot connect.'); return }
    const edge = result.value.connectors.at(-1)!
    onBoardChange(result.value, initial)
    setSelectedConnectorId(edge.id)
    setSelectedIds([])
    setNodeSocketSource(null)
    setInteractionTool('select')
  }

  function activateNodeSocket(nodeId: string, socket: string) {
    if (interactionTool !== 'select') setInteractionTool('select')
    const source = nodeSocketSource
    if (!source) { setNodeSocketSource({ nodeId, socket }); setSelectedIds([nodeId]); return }
    if (source.nodeId === nodeId && source.socket === socket) { setNodeSocketSource(null); return }
    connectNodeSockets(source, { nodeId, socket })
  }

  function startNodeSocketDrag(event: React.PointerEvent<HTMLButtonElement>, nodeId: string, socket: string) {
    if (event.button !== 0 || viewOnly) return
    event.preventDefault(); event.stopPropagation()
    if (interactionTool !== 'select') setInteractionTool('select')
    // A selected source also supports two-click operation; drag is the direct
    // path and updates one SVG proxy rather than rerendering the entire board.
    if (nodeSocketSource) { activateNodeSocket(nodeId, socket); return }
    const initial = boardRef.current
    const anchor = nodeGraphPortPosition(initial, nodeId, socket)
    if (!anchor) return
    const releasePointer = capturePointer(event)
    const startClient = { x: event.clientX, y: event.clientY }
    let moved = false
    let disposeGesture: () => void = () => undefined
    const preview = (sample: PointerSample) => {
      if (Math.hypot(sample.clientX - startClient.x, sample.clientY - startClient.y) > 4) moved = true
      if (!moved) return
      const point = eventToWorld(sample.clientX, sample.clientY)
      const bend = Math.min(180, Math.max(40, Math.abs(point.x - anchor.x) * .45))
      nodeGraphDraftPathRef.current?.setAttribute('d', `M ${anchor.x} ${anchor.y} C ${anchor.x + bend} ${anchor.y}, ${point.x - bend} ${point.y}, ${point.x} ${point.y}`)
    }
    const cleanup = () => {
      disposeGesture(); releasePointer()
      nodeGraphDraftPathRef.current?.setAttribute('d', '')
      if (activeGestureCancelRef.current === cancel) activeGestureCancelRef.current = null
    }
    const finish = (sample: PointerSample) => {
      const element = document.elementFromPoint(sample.clientX, sample.clientY)?.closest<HTMLElement>('[data-node-graph-node-id][data-node-graph-port-key]')
      let target = element ? { nodeId: element.dataset.nodeGraphNodeId || '', socket: element.dataset.nodeGraphPortKey || '' } : undefined
      // An existing connector can cross a socket and win DOM hit-testing.
      // Resolve the nearest visible socket within a fixed screen-space radius.
      if (!target && moved) {
        const point = eventToWorld(sample.clientX, sample.clientY)
        const radius = 24 / Math.max(.1, presentedViewportRef.current.scale)
        const nearby = visibleNodes.flatMap((node) => (nodeGraphPortsById.get(node.id) || []).map((port) => {
          const position = nodeGraphPortPosition(initial, node.id, port.key)!
          return { nodeId: node.id, socket: port.key, distance: Math.hypot(position.x - point.x, position.y - point.y) }
        })).filter((entry) => entry.distance <= radius).sort((a, b) => a.distance - b.distance)[0]
        if (nearby) target = { nodeId: nearby.nodeId, socket: nearby.socket }
      }
      cleanup()
      if (moved && target?.nodeId && target.socket && (target.nodeId !== nodeId || target.socket !== socket)) connectNodeSockets({ nodeId, socket }, target)
      else if (moved) setDrawingNotice('Drop the connection on a Node Column socket.')
      else { setNodeSocketSource({ nodeId, socket }); setSelectedIds([nodeId]); setSelectedConnectorId(null) }
    }
    const cancel = () => cleanup()
    disposeGesture = listenGesture(event, preview, finish, cancel)
    activeGestureCancelRef.current = cancel
  }

  function selectOrConnectNode(event: React.MouseEvent, node: BoardNode) {
    if (viewOnly) return
    if (performance.now() < transformClickIgnoreUntilRef.current) {
      event.preventDefault()
      event.stopPropagation()
      clearPostTransformClickSuppression()
      return
    }
    if (interactionTool === 'connect') {
      event.stopPropagation()
      const clickPoint = eventToWorld(event.clientX, event.clientY)
      if (!connectorSourceId) {
        setConnectorSourceId(node.id)
        setConnectorSourcePort(nearestPort(node, clickPoint))
        setSelectedIds([node.id])
        setSelectedConnectorId(null)
        return
      }
      if (connectorSourceId === node.id) {
        setConnectorSourceId(null)
        return
      }
      const connector: BoardConnector = {
        id: `connector-${crypto.randomUUID()}`,
        sourceId: connectorSourceId,
        targetId: node.id,
        sourcePort: connectorSourcePort,
        targetPort: nearestPort(node, clickPoint),
        style: 'curve',
        color: '#58c8c1',
        width: 2,
        dashed: false,
        startArrow: false,
        endArrow: true,
        animated: true,
      }
      const duplicate = board.connectors.some((entry) => entry.sourceId === connectorSourceId && entry.targetId === node.id)
      if (!duplicate) {
        onBoardChange({ ...board, connectors: [...board.connectors, connector] })
        setSelectedConnectorId(connector.id)
      }
      setSelectedIds([])
      setConnectorSourceId(null)
      setInteractionTool('select')
      return
    }
    if (marqueeClickSuppressRef.current) {
      marqueeClickSuppressRef.current = false
      selectionHandledOnPointerDownRef.current = false
      return
    }
    if (selectionHandledOnPointerDownRef.current) {
      selectionHandledOnPointerDownRef.current = false
      return
    }
    if (interactionTool === 'node') {
      const editablePath = directSelectionPath(node)
      if (editablePath || isLiveShapeDirectSelectable(node)) {
        if (!node.vectorPath) {
          if (editablePath) {
            const currentBoard = boardRef.current
            onBoardChange({ ...currentBoard, nodes: currentBoard.nodes.map((entry) => entry.id === node.id ? { ...entry, vectorPath: editablePath } : entry) }, currentBoard)
          }
        }
        setSelectedIds([node.id])
        setSelectedVectorPoint(null)
        setSelectedVectorAnchorIndexes([])
        setSelectedVectorSegmentIndexes([])
      }
      return
    }
    setSelectedConnectorId(null)
    setNodeSocketSource(null)
    setSelectedIds((current) => event.shiftKey ? (current.includes(node.id) ? current.filter((id) => id !== node.id) : [...current, node.id]) : [node.id])
  }

  function startConnectorEdit(event: React.PointerEvent<SVGElement>, connector: BoardConnector, preview: (point: BoardPoint) => BoardConnector, settle = preview) {
    if (event.button !== 0 || viewOnly) return
    event.preventDefault()
    event.stopPropagation()
    const startBoard = boardRef.current
    if (!startBoard.connectors.some((entry) => entry.id === connector.id)) return
    const startClient = { x: event.clientX, y: event.clientY }
    const releasePointer = capturePointer(event)
    let disposeGesture: () => void = () => undefined
    let point = eventToWorld(event.clientX, event.clientY)
    let moved = false
    const move = (pointerEvent: PointerSample) => {
      moved ||= Math.hypot(pointerEvent.clientX - startClient.x, pointerEvent.clientY - startClient.y) > 2
      if (!moved || boardRef.current !== startBoard) return
      point = eventToWorld(pointerEvent.clientX, pointerEvent.clientY)
      onBoardChange({ ...startBoard, connectors: startBoard.connectors.map((entry) => entry.id === connector.id ? preview(point) : entry) }, null)
    }
    const cleanup = () => {
      disposeGesture();
      releasePointer()
      if (activeGestureCancelRef.current === cancel) activeGestureCancelRef.current = null
    }
    const finish = () => {
      cleanup()
      if (!moved || boardRef.current !== startBoard) return
      const next = settle(point)
      if (!modelEqual(next, connector)) onBoardChange({ ...startBoard, connectors: startBoard.connectors.map((entry) => entry.id === connector.id ? next : entry) }, startBoard)
    }
    const cancel = () => {
      cleanup()
    }
    disposeGesture = listenGesture(event, move, finish, cancel)
    activeGestureCancelRef.current = cancel
  }

  function startConnectorEndpointDrag(event: React.PointerEvent<SVGCircleElement>, connector: BoardConnector, end: 'source' | 'target') {
    const snapshot = boardRef.current
    if (isNodeGraphConnector(connector)) {
      startConnectorEdit(event, connector, (point) => withConnectorEndpoint(connector, end, { attachment: 'free', point }), (point) => {
        const targetNode = [...snapshot.nodes].reverse().find((node) => nodeGraphOwner(snapshot, node)
          && point.x >= node.x - 16 && point.x <= node.x + node.width + 16
          && point.y >= node.y - 16 && point.y <= node.y + node.height + 16)
        const otherId = end === 'source' ? connector.targetId : connector.sourceId
        const otherSocket = end === 'source' ? connector.nodeGraph.targetSocket : connector.nodeGraph.sourceSocket
        const other = otherId ? nodeGraphPort(snapshot, otherId, otherSocket) : undefined
        if (!targetNode || !other) { setDrawingNotice('Drop the typed endpoint on a Node Column or one of its cards.'); return connector }
        const candidate = nodeGraphPorts(snapshot, targetNode).filter((port) => end === 'source'
          ? validateNodeGraphPortConnection(port, other).valid : validateNodeGraphPortConnection(other, port).valid)
          .sort((a, b) => {
            const ap = nodeGraphPortPosition(snapshot, targetNode.id, a.key)!, bp = nodeGraphPortPosition(snapshot, targetNode.id, b.key)!
            return Math.hypot(ap.x - point.x, ap.y - point.y) - Math.hypot(bp.x - point.x, bp.y - point.y)
          })[0]
        if (!candidate) { setDrawingNotice('No compatible socket is available on that card.'); return connector }
        const result = reconnectNodeGraphPortResult(snapshot, connector.id, end, targetNode.id, candidate.key, viewOnly)
        if (!result.ok) { setDrawingNotice(result.issues[0]?.detail || 'Could not reconnect this graph edge.'); return connector }
        return result.value.connectors.find((entry) => entry.id === connector.id) || connector
      })
      return
    }
    startConnectorEdit(event, connector, (point) => withConnectorEndpoint(connector, end, { attachment: 'free', point }), (point) => {
      const targetNode = [...snapshot.nodes].reverse().find((node) => {
        const dx = point.x - node.x - node.width / 2, dy = point.y - node.y - node.height / 2
        const angle = -(node.rotation || 0) * Math.PI / 180
        const x = dx * Math.cos(angle) - dy * Math.sin(angle), y = dx * Math.sin(angle) + dy * Math.cos(angle)
        return Math.abs(x) <= node.width / 2 && Math.abs(y) <= node.height / 2
      })
      return withConnectorEndpoint(connector, end, targetNode
        ? { attachment: 'attached', objectId: targetNode.id, port: nearestPort(targetNode, point), portMode: 'fixed' }
        : { attachment: 'free', point })
    })
  }

  function startConnectorBendDrag(event: React.PointerEvent<SVGCircleElement>, connector: BoardConnector, index: number) {
    startConnectorEdit(event, connector, (point) => ({ ...connector, bendPoints: (connector.bendPoints || []).map((bend, i) => i === index ? point : bend) }))
  }

  function startConnectorLabelDrag(event: React.PointerEvent<SVGGElement>, connector: BoardConnector) {
    const geometry = connectorGeometry(connector, boardRef.current.nodes)
    if (!geometry) return
    const start = eventToWorld(event.clientX, event.clientY), label = connectorLabelPoint(connector, geometry)
    startConnectorEdit(event, connector, (point) => ({ ...connector, labelPosition: projectConnectorLabelPosition(geometry, { x: label.x + point.x - start.x, y: label.y + point.y - start.y }) }))
  }

  function addConnectorBend(event: React.MouseEvent<SVGPathElement>, connector: BoardConnector) {
    if (viewOnly || connector.style !== 'elbow' || (connector.bendPoints?.length || 0) >= 32) return
    event.preventDefault(); event.stopPropagation()
    const geometry = connectorGeometry(connector, board.nodes)
    if (!geometry) return
    const point = eventToWorld(event.clientX, event.clientY)
    const t = projectConnectorLabelPosition(geometry, point).t
    const bends = [...(connector.bendPoints || [])]
    const index = bends.findIndex((bend) => projectConnectorLabelPosition(geometry, bend).t > t)
    bends.splice(index < 0 ? bends.length : index, 0, point)
    updateConnector(connector.id, { bendPoints: bends })
  }

  function startFreeConnector(event: React.PointerEvent<HTMLDivElement>) {
    if (event.button !== 0 || interactionTool !== 'connect' || connectorSourceId) return
    event.preventDefault()
    const releasePointer = capturePointer(event)
    let disposeGesture: () => void = () => undefined
    const source = eventToWorld(event.clientX, event.clientY)
    let target = source
    setConnectorDraft({ source, target })
    const move = (pointerEvent: PointerSample) => {
      target = eventToWorld(pointerEvent.clientX, pointerEvent.clientY)
      setConnectorDraft({ source, target })
    }
    const cleanup = () => {
      disposeGesture();
      releasePointer()
      if (activeGestureCancelRef.current === cancel) activeGestureCancelRef.current = null
    }
    const finish = () => {
      cleanup()
      if (Math.hypot(target.x - source.x, target.y - source.y) > 8) {
        const connector: BoardConnector = {
          id: `connector-${crypto.randomUUID()}`,
          sourcePoint: source,
          targetPoint: target,
          sourcePort: 'right',
          targetPort: 'left',
          style: 'curve',
          color: '#58c8c1',
          width: 2,
          dashed: false,
          startArrow: false,
          endArrow: true,
          animated: true,
        }
        onBoardChange({ ...board, connectors: [...board.connectors, connector] })
        setSelectedConnectorId(connector.id)
        setSelectedIds([])
        setInteractionTool('select')
      }
      setConnectorDraft(null)
    }
    const cancel = () => {
      cleanup()
      setConnectorDraft(null)
    }
    disposeGesture = listenGesture(event, move, finish, cancel)
    activeGestureCancelRef.current = cancel
  }

  function assetUrl(node: BoardNode) {
    const asset = node.assetId ? assetById.get(node.assetId) : undefined
    if (!asset || !workspaceRoot) return undefined
    const sourcePath = asset.status === 'moved' ? asset.managedRelativePath || asset.relativePath : asset.relativePath
    const absolute = `${workspaceRoot.replace(/[\\/]+$/, '')}\\${sourcePath.replaceAll('/', '\\')}`
    return convertFileSrc(absolute)
  }

  function imageUrl(node: BoardNode) { return assetUrl(node) || (node.kind === 'image' && node.body?.startsWith('data:image/') ? node.body : undefined) }

  function imagePreviewUrl(node: BoardNode) {
    const asset = node.assetId ? assetById.get(node.assetId) : undefined
    if (!asset?.thumbnailRelativePath || !workspaceRoot || asset.extension === 'gif') return undefined
    return workspaceAssetUrl(workspaceRoot, asset.thumbnailRelativePath)
  }

  function containerCoverUrl(node: BoardNode) {
    const assetId = node.coverAssetId || containerCoverAsset(node)
    const asset = assetId ? assetById.get(assetId) : undefined
    return workspaceAssetUrl(workspaceRoot, assetCoverPath(asset))
  }

  function coverUrl(entry: BoardModel) {
    const asset = entry.coverAssetId ? assetById.get(entry.coverAssetId) : undefined
    return asset?.kind === 'image' && asset.status !== 'missing' ? workspaceAssetUrl(workspaceRoot, assetPreviewPath(asset)) : undefined
  }

  function switchFilmstripBoard(boardId: string) {
    setSelectedIds([])
    setSelectedConnectorId(null)
    setConnectorSourceId(null)
    setInteractionTool('select')
    onSwitchBoard(boardId)
  }

  function dropFilmstripBoard(targetId: string) {
    if (!draggedBoardId || draggedBoardId === targetId) return setDraggedBoardId(null)
    const ids = boards.map((entry) => entry.id)
    const sourceIndex = ids.indexOf(draggedBoardId)
    const targetIndex = ids.indexOf(targetId)
    if (sourceIndex < 0 || targetIndex < 0) return setDraggedBoardId(null)
    ids.splice(targetIndex, 0, ids.splice(sourceIndex, 1)[0])
    onReorderBoards(ids)
    setDraggedBoardId(null)
  }

  function nodeTitle(node: BoardNode) {
    return node.assetId ? assetById.get(node.assetId)?.displayName || node.title : node.title
  }

  useEffect(() => {
    const onVectorDoubleClick = (event: MouseEvent) => {
      const target = event.target instanceof Element ? event.target.closest('.vector-anchor') : null
      const editor = target?.closest('.vector-node-editor')
      if (!target || !editor || !selectedNode?.vectorPath) return
      const anchors = [...editor.querySelectorAll('.vector-anchor')]
      const index = anchors.indexOf(target)
      if (index < 0) return
      event.preventDefault()
      event.stopPropagation()
      setSelectedVectorPoint({ nodeId: selectedNode.id, index })
      addCurveHandles(selectedNode, index)
    }
    document.addEventListener('dblclick', onVectorDoubleClick, true)
    return () => document.removeEventListener('dblclick', onVectorDoubleClick, true)
  })

  useEffect(() => {
    const onPaste = (event: ClipboardEvent) => {
      const target = event.target instanceof HTMLElement ? event.target : null
      if (event.defaultPrevented) return
      const canvasPane = stageRef.current?.closest('.canvas-pane')
      if (!canvasPane?.getClientRects().length) return
      if (target?.closest('[contenteditable="true"], input, textarea, select, video, iframe, [role="dialog"], [role="alertdialog"], [role="menu"], .diagram-structure-panel, .document-pane, .questionnaire-pane, .project-inspector')) return
      const item = [...(event.clipboardData?.items || [])].find((entry) => entry.type.startsWith('image/'))
      if (!item) {
        event.preventDefault()
        pasteClipboard()
        return
      }
      const file = item.getAsFile()
      if (!file) return
      event.preventDefault()
      void saveClipboardImage(file, file.name || 'pasted-image.png').catch((error) => appAlert(`Could not paste image: ${String(error)}`))
    }
    window.addEventListener('paste', onPaste)
    return () => window.removeEventListener('paste', onPaste)
  })

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      const target = event.target instanceof HTMLElement ? event.target : null
      if (event.defaultPrevented) return
      const canvasPane = stageRef.current?.closest('.canvas-pane')
      if (!canvasPane?.getClientRects().length) return
      if (target?.closest('[contenteditable="true"], input, textarea, select, video, iframe, [role="dialog"], [role="alertdialog"], [role="menu"], .diagram-structure-panel, .document-pane, .questionnaire-pane, .project-inspector')) return
      // Native activation belongs to the focused control, including its SVG children.
      // Keep letter shortcuts available to Canvas controls and Space-pan on the stage.
      if ((event.code === 'Space' || event.key === 'Enter') && event.target instanceof Element && event.target.closest('button, a[href], [role="button"]')) return
      if (!event.defaultPrevented && !viewOnly && event.altKey && !event.ctrlKey && !event.metaKey) {
        const rowActions = columnRowActionState(board, selectedIds, { readOnly: viewOnly })
        const hasContainer = rowActions.visible || selectedIds.some((id) => Boolean(board.nodes.find((n) => n.id === id)?.groupId))
        if (rowActions.visible && !event.shiftKey && ['ArrowUp', 'ArrowDown'].includes(event.key)) {
          event.preventDefault()
          runColumnRowCommand(event.key === 'ArrowUp' ? 'earlier' : 'later')
          return
        }
        if (rowActions.visible && !event.shiftKey && ['ArrowLeft', 'ArrowRight'].includes(event.key)) {
          event.preventDefault()
          runColumnRowCommand(event.key === 'ArrowLeft' ? 'previous' : 'next')
          return
        }
        if (event.shiftKey && event.key === 'ArrowUp' && hasContainer) {
          event.preventDefault()
          runColumnRowCommand('ancestor')
          return
        }
      }
      if ((event.ctrlKey || event.metaKey) && event.shiftKey && event.key.toLowerCase() === 'm' && selectedIds.length && !viewOnly) { event.preventDefault(); setShowTransferDialog(true); return }
      if (event.code === 'Space' && !event.repeat) {
        event.preventDefault()
        spacePanRef.current = true
        stageRef.current?.classList.add('viewport-panning')
      }
      if (event.key === 'Backspace' && interactionTool === 'pen' && penPoints.length) {
        // While drafting a Pen path, Backspace walks back the last anchor. The
        // replacement click must not read as the second half of a double tap.
        event.preventDefault()
        lastPenTapRef.current = null
        setPenPoints((current) => current.slice(0, -1))
      } else if ((event.key === 'Delete' || event.key === 'Backspace') && interactionTool === 'node' && selectedVectorPoint) {
        event.preventDefault()
        deletePathPoint()
      } else if ((event.key === 'Delete' || event.key === 'Backspace') && selectedConnectorId) {
        event.preventDefault()
        onBoardChange({ ...board, connectors: board.connectors.filter((connector) => connector.id !== selectedConnectorId) })
        setSelectedConnectorId(null)
      } else if ((event.key === 'Delete' || event.key === 'Backspace') && selectedIds.length) {
        event.preventDefault()
        deleteSelected()
      }
      if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'd' && selectedIds.length) {
        event.preventDefault()
        duplicateSelected()
      }
      if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'c' && selectedIds.length) {
        event.preventDefault()
        copySelected()
      }
      if ((event.ctrlKey || event.metaKey) && !event.altKey) {
        if (event.key === '0') { event.preventDefault(); fitBoard(); return }
        if (event.key === '1') { event.preventDefault(); setZoom100(); return }
        if (event.key === '2' && selectedIds.length) { event.preventDefault(); fitSelection(); return }
        if (event.key === '=' || event.key === '+') { event.preventDefault(); stepZoom(1); return }
        if (event.key === '-') { event.preventDefault(); stepZoom(-1); return }
      }
      if (event.shiftKey && !event.ctrlKey && !event.metaKey && !event.altKey) {
        if (event.key === '1') { event.preventDefault(); fitBoard(); return }
        if (event.key === '2' && selectedIds.length) { event.preventDefault(); fitSelection(); return }
        if (event.key === '0') { event.preventDefault(); setZoom100(); return }
      }
      if (!event.ctrlKey && !event.metaKey && !event.altKey) {
        const shortcut = event.key.toLowerCase()
        if (viewOnly && ['n', 'e', 'r', 'o', 'l', 'a', 'p', 't'].includes(shortcut)) return
        if (shortcut === 'v') { event.preventDefault(); setViewportTool('select'); setInteractionTool('select'); setSelectedConnectorId(null) }
        if (shortcut === 'n') { event.preventDefault(); setViewportTool('select'); setInteractionTool('pencil'); setSelectedConnectorId(null) }
        if (shortcut === 'e' && event.shiftKey) { event.preventDefault(); setViewportTool('select'); setInteractionTool('erase'); setSelectedConnectorId(null) }
        if (shortcut === 'h') { event.preventDefault(); setViewportTool('hand'); setInteractionTool('select'); setSelectedConnectorId(null) }
        if (shortcut === 'z') { event.preventDefault(); setViewportTool('zoom'); setInteractionTool('select'); setSelectedConnectorId(null) }
        if (shortcut === 'r') { event.preventDefault(); setViewportTool('select'); setShapeKind('rectangle'); setInteractionTool('draw'); setSelectedConnectorId(null) }
        if (shortcut === 'o') { event.preventDefault(); setViewportTool('select'); setShapeKind('ellipse'); setInteractionTool('draw'); setSelectedConnectorId(null) }
        if (shortcut === 'l') { event.preventDefault(); setViewportTool('select'); setShapeKind('line'); setInteractionTool('draw'); setSelectedConnectorId(null) }
        if (shortcut === 'a' && event.shiftKey) { event.preventDefault(); setViewportTool('select'); setShapeKind('arrow'); setInteractionTool('draw'); setSelectedConnectorId(null) }
        if (shortcut === 'p') { event.preventDefault(); setViewportTool('select'); setPenPoints([]); setPenPreview(null); setInteractionTool('pen'); setSelectedConnectorId(null) }
        if (shortcut === 'a' && !event.shiftKey) { event.preventDefault(); setViewportTool('select'); setInteractionTool('node'); setSelectedConnectorId(null) }
        if (shortcut === 't') { event.preventDefault(); setViewportTool('select'); setInteractionTool('type'); setSelectedConnectorId(null) }
      }
      if (event.key === 'Escape') {
        event.preventDefault()
        cancelActiveGesture()
        setViewportTool('select')
        // While a Pen draft is active, Escape abandons the draft but stays in
        // the Pen tool; a second Escape returns to the Select tool.
        if (!(interactionTool === 'pen' && penPoints.length)) setInteractionTool('select')
        setPenPoints([])
        setPenPreview(null)
        setConnectorSourceId(null)
        setNodeSocketSource(null)
        setConnectorDraft(null)
        overlayPresenter.set('connectorPreview', null)
        setColumnDropTarget(null)
        setColumnDragIds([])
        setSelectedConnectorId(null)
        setSelectedVectorAnchorIndexes([])
        setSelectedVectorSegmentIndexes([])
        setSelectedIds([])
        setContextMenu(null)
        setShowGridSettings(false)
        setShowAppearance(false)
      }
      if (event.key === 'Enter' && interactionTool === 'pen') {
        event.preventDefault()
        finishPenPath(penPoints)
      }
      if (['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown'].includes(event.key) && selectedIds.length) {
        event.preventDefault()
        if (viewOnly || !allowTransform(transformMembers(selectedIds))) return
        const position = guardColumnRowPosition(board, selectedIds)
        if (!position.ok) { setDrawingNotice(position.issues[0]?.detail || 'Detach from column to position freely.'); return }
        const distance = event.shiftKey ? SHIFT_NUDGE_STEP : NUDGE_STEP
        const dx = event.key === 'ArrowLeft' ? -distance : event.key === 'ArrowRight' ? distance : 0
        const dy = event.key === 'ArrowUp' ? -distance : event.key === 'ArrowDown' ? distance : 0
        const moved = moveContainerWithDescendants(board.nodes, board.connectors, selectedIds, { x: dx, y: dy })
        if (!moved.ok) { setDrawingNotice(moved.issues[0]?.detail || 'Cannot move these objects.'); return }
        onBoardChange({ ...board, nodes: moved.value.nodes, connectors: moved.value.connectors })
      }
    }
    const onKeyUp = (event: KeyboardEvent) => {
      if (event.code !== 'Space') return
      spacePanRef.current = false
      if (!activeGestureCancelRef.current) stageRef.current?.classList.remove('viewport-panning')
    }
    window.addEventListener('keydown', onKeyDown)
    window.addEventListener('keyup', onKeyUp)
    return () => { window.removeEventListener('keydown', onKeyDown); window.removeEventListener('keyup', onKeyUp) }
  })

  return (
    <section className={`canvas-pane ${showFilmstrip ? 'filmstrip-open' : ''} ${viewOnly ? 'view-only' : ''} ${viewOnly && !presentationOnly ? 'read-only' : ''}`} aria-label="Visual board">
      {diagramPalette && <DiagramPalette mode={diagramPalette.mode} onChoose={chooseDiagramShape} onClose={(reason) => { setDiagramPalette(null); if (reason !== 'outside') restoreDiagramFocus() }} disabled={viewOnly} disabledReason={viewOnly ? 'This workspace is read-only.' : undefined} style={{ left: diagramPalette.left, top: diagramPalette.top }} />}
      {showTransferDialog && <BoardTransferDialog board={board} boards={boards} selectedIds={selectedIds} onClose={() => { setShowTransferDialog(false); transferButtonRef.current?.focus() }} onMove={(destinationId) => { const moved = onMoveSelection(board.id, destinationId, selectedIds); if (moved) { setSelectedIds([]); setSelectedConnectorId(null) }; return moved }} />}
      <div className="pane-toolbar canvas-toolbar" role="toolbar" aria-label="Canvas controls">
        <div className="canvas-navigation-row">{navigation || <strong className="canvas-board-title" title={board.title}>{board.title}</strong>}</div>
        <div className="canvas-object-controls" role="group" aria-label="Object and canvas actions">
        <div className="canvas-context-controls">
        
        {viewOnly ? <><span className="canvas-readonly-notice" role="status">Read-only workspace · editing disabled</span><span className="toolbar-spacer" /></> : selectedConnector ? <>
          <button className="tool-button active" type="button" title="Finish editing connection" aria-label="Finish editing connection" onClick={() => setSelectedConnectorId(null)}>✓</button>
          <strong className="connector-toolbar-title">{isNodeGraphConnector(selectedConnector) ? 'Node connection' : 'Connection'}</strong>
          <button className="quiet-button compact" type="button" aria-label="Insert diagram shape on connection" disabled={viewOnly} onClick={(event) => openDiagramPalette(event, 'insert')}>Insert shape…</button>
          <select aria-label="Connection line style" title="Connection path shape" value={selectedConnector.style} onChange={(event) => updateConnector(selectedConnector.id, { style: event.target.value as BoardConnector['style'] })}><option value="curve">Curve</option><option value="straight">Straight</option><option value="elbow">Elbow</option></select>
          <label className="connector-color-control" title="Connection color"><input type="color" value={selectedConnector.color} onChange={(event) => updateConnector(selectedConnector.id, { color: event.target.value })} /></label>
          <select aria-label="Connection weight" title="Connection line thickness" value={selectedConnector.width} onChange={(event) => updateConnector(selectedConnector.id, { width: Number(event.target.value) })}><option value="1">Thin</option><option value="2">Regular</option><option value="4">Bold</option><option value="7">Heavy</option></select>
          <button className="quiet-button compact connector-label-button" type="button" aria-label="Edit connection label" disabled={viewOnly} onClick={() => editConnectorLabel(selectedConnector)}>{selectedConnector.label || 'Add label'}</button>
          <button ref={objectOptionsButtonRef} className="quiet-button compact object-options-trigger" type="button" aria-label="Connection options" aria-expanded={objectOptions === 'connection'} onClick={() => setObjectOptions((value) => value === 'connection' ? null : 'connection')}>Options ▾</button>
          <button className="tool-button danger-tool" type="button" title="Remove connection (Undo restores it)" aria-label="Delete connection" disabled={viewOnly} onClick={() => { onBoardChange({ ...board, connectors: board.connectors.filter((connector) => connector.id !== selectedConnector.id) }); setSelectedConnectorId(null) }}>⌫</button>
          <span className="toolbar-spacer" /><span className="connector-hint">Drag either endpoint to reconnect it</span>
        </> : <>
          <button className={`tool-button ${interactionTool === 'select' ? 'active' : ''}`} type="button" title="Select and move cards" aria-label="Select and move cards" onClick={() => { setInteractionTool('select'); setConnectorSourceId(null) }}>↖</button><button className="tool-button" type="button" title="Add a scrollable rich-text card" aria-label="Add rich-text card" onClick={addTextNode}>T</button>{selectedNode?.kind === 'clip' && <button className="quiet-button compact" type="button" title="Edit source information, article text, comments, and transcript" onClick={() => editCaptureNode(selectedNode)}>Edit capture</button>}<button className={`tool-button ${interactionTool === 'draw' ? 'active' : ''}`} type="button" title="Drag to draw a shape; Shift constrains it" aria-label="Draw shape" onClick={() => { setInteractionTool(interactionTool === 'draw' ? 'select' : 'draw'); setSelectedConnectorId(null) }}>◇</button>{interactionTool === 'draw' && <select aria-label="Shape type" value={shapeKind} onChange={(event) => setShapeKind(event.target.value as ShapeType)}><option value="rectangle">Rectangle</option><option value="ellipse">Ellipse</option><option value="line">Line</option><option value="arrow">Arrow</option></select>}<button className="tool-button column-tool" type="button" title="Add an ordered card column" aria-label="Add card column" onClick={addColumnNode}>▥</button><button className="tool-button node-column-tool" type="button" title="Add a Node Column with typed graph sockets" aria-label="Add Node Column" onClick={addNodeColumnNode}>◇▥</button><button className="tool-button" type="button" title="Import images from disk" aria-label="Import images" onClick={() => onImport('image')}>▧</button><button className="tool-button" type="button" title="Import videos from disk" aria-label="Import videos" onClick={() => onImport('video')}>▶</button><button className="tool-button model-tool" type="button" title="Import GLB, GLTF, or OBJ for an orbitable 3D canvas card" aria-label="Import 3D model" onClick={() => onImport('model')}>◈</button><button className="tool-button" type="button" title="Import documents from disk" aria-label="Import documents" onClick={() => onImport('document')}>¶</button><button className="tool-button" type="button" title="Create a card that opens another board in this project" aria-label="Link to another board" disabled={boards.length <= 1} onClick={addBoardLink}>↗</button><button className={`tool-button ${interactionTool === 'connect' ? 'active' : ''}`} type="button" title="Draw connections between cards or directly on the grid" aria-label="Draw connections" aria-pressed={interactionTool === 'connect'} onClick={() => { setInteractionTool((current) => current === 'connect' ? 'select' : 'connect'); setConnectorSourceId(null); setSelectedConnectorId(null) }}>⌁</button>
          {selectedNode?.kind === 'shape' && <>
            <label className="connector-color-control" title="Shape stroke color"><input aria-label="Shape stroke color" type="color" value={selectedNode.strokeColor || '#b9d4e7'} onChange={(event) => updateNode(selectedNode.id, { strokeColor: event.target.value })} /></label>
            <select aria-label="Shape stroke width" title="Stroke width" value={selectedNode.strokeWidth || 2} onChange={(event) => updateNode(selectedNode.id, { strokeWidth: Number(event.target.value) })}>
              <option value="1">1 px</option><option value="2">2 px</option><option value="3">3 px</option><option value="4">4 px</option><option value="6">6 px</option><option value="8">8 px</option><option value="12">12 px</option>
            </select>
            <label className="connector-color-control" title="Shape fill color"><input aria-label="Shape fill color" type="color" value={selectedNode.color === 'transparent' ? '#000000' : selectedNode.color || '#56748e'} onChange={(event) => updateNode(selectedNode.id, { color: event.target.value })} /></label>
            <button className={`quiet-button compact ${selectedNode.color === 'transparent' ? 'active' : ''}`} type="button" title="Toggle transparent shape fill" onClick={() => updateNode(selectedNode.id, { color: selectedNode.color === 'transparent' ? '#56748e' : 'transparent' })}>
              {selectedNode.color === 'transparent' ? 'Transparent' : 'Filled'}
            </button>
            <input className="shape-radius" aria-label="Corner radius" title="Corner radius (px)" type="number" min="0" max="80" value={selectedNode.cornerRadius || 0} onChange={(event) => updateNode(selectedNode.id, { cornerRadius: Number(event.target.value) })} />
          </>}
          {selectedNode?.kind === 'text' && <span className="text-node-bottom-inspector" aria-label="Text formatting">
            <button className={`quiet-button compact ${selectedNode.color === 'transparent' ? 'active' : ''}`} type="button" title={selectedNode.color === 'transparent' ? 'Transparent text (click to make card)' : 'Card background (click to make transparent)'} onClick={() => updateNode(selectedNode.id, { color: selectedNode.color === 'transparent' ? '#20242a' : 'transparent' })}>
              {selectedNode.color === 'transparent' ? 'Transparent' : 'Card'}
            </button>
            <button className={`quiet-button compact ${selectedNode.textMode === 'area' ? 'active' : ''}`} type="button" title={selectedNode.textMode === 'area' ? 'Area text (fixed width wrap)' : 'Point text (auto-width single line)'} onClick={() => updateNode(selectedNode.id, { textMode: selectedNode.textMode === 'area' ? 'point' : 'area' })}>
              {selectedNode.textMode === 'area' ? 'Area' : 'Point'}
            </button>
            <label className="connector-color-control" title="Text color"><input aria-label="Text color" type="color" value={selectedNode.textColor || '#ffffff'} onChange={(event) => updateNode(selectedNode.id, { textColor: event.target.value })} /></label>
            <label title="Text opacity" style={{ display: 'flex', alignItems: 'center', gap: 4, fontSize: 11 }}>
              <span>α</span>
              <input aria-label="Text opacity" type="range" min="0" max="100" value={Math.round((selectedNode.opacity ?? 1) * 100)} onChange={(event) => updateNode(selectedNode.id, { opacity: Number(event.target.value) / 100 })} />
            </label>
          </span>}
          {selectedNode?.shapeType === 'path' && selectedNode.vectorPath && <><button className="quiet-button compact" type="button" aria-label="Toggle path closure" aria-pressed={selectedNode.vectorPath.closed} title={selectedNode.vectorPath.closed ? 'Open this closed path' : 'Close this path; clicking the first Pen anchor also closes it'} disabled={selectedNode.vectorPath.points.length < 3} onClick={() => toggleClosedPath(selectedNode)}>{selectedNode.vectorPath.closed ? 'Open path' : 'Close path'}</button><select aria-label="Path fill rule" value={selectedNode.vectorFillRule || 'nonzero'} onChange={(event) => updateNode(selectedNode.id, { vectorFillRule: event.target.value as NonNullable<BoardNode['vectorFillRule']> })}><option value="nonzero">Nonzero</option><option value="evenodd">Even–odd</option></select><select aria-label="Path stroke join" value={selectedNode.vectorStrokeJoin || 'miter'} onChange={(event) => updateNode(selectedNode.id, { vectorStrokeJoin: event.target.value as NonNullable<BoardNode['vectorStrokeJoin']> })}><option value="miter">Miter join</option><option value="round">Round join</option><option value="bevel">Bevel join</option></select><select aria-label="Path stroke cap" value={selectedNode.vectorStrokeCap || 'butt'} onChange={(event) => updateNode(selectedNode.id, { vectorStrokeCap: event.target.value as NonNullable<BoardNode['vectorStrokeCap']> })}><option value="butt">Butt cap</option><option value="round">Round cap</option><option value="square">Square cap</option></select><button className="quiet-button compact" type="button" aria-label="Flip path horizontally" onClick={() => updateVectorTransform(selectedNode, { scaleX: -(selectedNode.vectorTransform?.scaleX ?? 1) })}>Flip X</button><button className="quiet-button compact" type="button" aria-label="Flip path vertically" onClick={() => updateVectorTransform(selectedNode, { scaleY: -(selectedNode.vectorTransform?.scaleY ?? 1) })}>Flip Y</button><label className="vector-transform-field">Skew X<input aria-label="Path horizontal skew" type="number" min="-89" max="89" value={selectedNode.vectorTransform?.skewX || 0} onChange={(event) => updateVectorTransform(selectedNode, { skewX: Math.max(-89, Math.min(89, Number(event.target.value) || 0)) })} /></label><label className="vector-transform-field">Y<input aria-label="Path vertical skew" type="number" min="-89" max="89" value={selectedNode.vectorTransform?.skewY || 0} onChange={(event) => updateVectorTransform(selectedNode, { skewY: Math.max(-89, Math.min(89, Number(event.target.value) || 0)) })} /></label><button className="quiet-button compact" type="button" aria-label="Reset path transform" disabled={!selectedNode.vectorTransform} onClick={() => updateNode(selectedNode.id, { vectorTransform: undefined })}>Reset</button>{interactionTool === 'node' && selectedVectorPoint?.nodeId === selectedNode.id && <><button className="quiet-button compact" type="button" aria-label="Make selected point smooth" onClick={() => setPointMode('smooth')}>Smooth</button><button className="quiet-button compact" type="button" aria-label="Make selected point a corner" onClick={() => setPointMode('corner')}>Corner</button><button className="quiet-button compact" type="button" aria-label="Join selected point handles" onClick={() => setPointMode('smooth')}>Join handles</button><button className="quiet-button compact" type="button" aria-label="Break selected point handles" onClick={() => setPointMode('corner')}>Break handles</button><button className="quiet-button compact" type="button" aria-label="Insert point after selected point" disabled={!selectedNode.vectorPath.closed && selectedVectorPoint.index === selectedNode.vectorPath.points.length - 1} onClick={insertPathPoint}>Insert point</button><button className="quiet-button compact" type="button" aria-label="Delete selected point" disabled={selectedNode.vectorPath.points.length <= (selectedNode.vectorPath.closed ? 3 : 2)} onClick={deletePathPoint}>Delete point</button></>}<span className="vector-help">Node tool: select an anchor; drag handles. Alt-drag breaks a smooth pair.</span></>}
          {selectedNode?.shapeType === 'arrow' && <><button className={`quiet-button compact ${selectedNode.arrowMotion?.enabled !== false ? 'active' : ''}`} type="button" aria-label="Toggle arrow motion" aria-pressed={selectedNode.arrowMotion?.enabled !== false} onClick={() => updateNode(selectedNode.id, { arrowMotion: { enabled: selectedNode.arrowMotion?.enabled === false, speed: selectedNode.arrowMotion?.speed || 'normal', direction: selectedNode.arrowMotion?.direction || 'forward', style: 'flow' } })}>Motion</button><select aria-label="Arrow motion speed" value={selectedNode.arrowMotion?.speed || 'normal'} onChange={(event) => updateNode(selectedNode.id, { arrowMotion: { enabled: selectedNode.arrowMotion?.enabled !== false, speed: event.target.value as 'slow' | 'normal' | 'fast', direction: selectedNode.arrowMotion?.direction || 'forward', style: 'flow' } })}><option value="slow">Slow flow</option><option value="normal">Normal flow</option><option value="fast">Fast flow</option></select><button className="quiet-button compact" type="button" aria-label="Reverse arrow motion" onClick={() => updateNode(selectedNode.id, { arrowMotion: { enabled: selectedNode.arrowMotion?.enabled !== false, speed: selectedNode.arrowMotion?.speed || 'normal', direction: selectedNode.arrowMotion?.direction === 'reverse' ? 'forward' : 'reverse', style: 'flow' } })}>Reverse flow</button></>}
          {selectedNode?.kind === 'column' && <select className="column-presentation-select" aria-label="Column presentation" title="Column presentation" value={selectedNode.columnPresentation || 'header'} onChange={(event) => updateNode(selectedNode.id, { columnPresentation: event.target.value as BoardNode['columnPresentation'] })}><option value="background">Background</option><option value="top-strip">Top strip</option><option value="header">Header</option><option value="black-turquoise">Black + turquoise</option></select>}
          {selectedNode?.kind === 'image' && <button ref={objectOptionsButtonRef} className="quiet-button compact object-options-trigger" type="button" aria-label="Image framing options" aria-expanded={objectOptions === 'image'} onClick={() => setObjectOptions((value) => value === 'image' ? null : 'image')}>Framing ▾</button>}
          {selectedNode && !selectedNode.parentColumnId && <span className="geometry-fields" aria-label="Selected object geometry"><label>X<input type="number" value={Math.round(selectedNode.x)} onChange={(event) => updateNode(selectedNode.id, { x: Number(event.target.value) })} /></label><label>Y<input type="number" value={Math.round(selectedNode.y)} onChange={(event) => updateNode(selectedNode.id, { y: Number(event.target.value) })} /></label><label>W<input type="number" min="1" value={Math.round(selectedNode.width)} onChange={(event) => updateNode(selectedNode.id, { width: Math.max(1, Number(event.target.value)) })} /></label><label>H<input type="number" min="1" value={Math.round(selectedNode.height)} onChange={(event) => updateNode(selectedNode.id, { height: Math.max(1, Number(event.target.value)) })} /></label><label>°<input type="number" value={Math.round(selectedNode.rotation || 0)} onChange={(event) => updateNode(selectedNode.id, { rotation: Number(event.target.value) || 0 })} /></label></span>}
          {selectedNode?.kind === 'image' && <><label className="image-opacity" title="Card opacity"><span>α</span><input aria-label="Image opacity" type="range" min="0" max="100" value={Math.round((selectedNode.imageTransform?.opacity ?? 1) * 100)} onChange={(event) => updateImageTransform({ opacity: Number(event.target.value) / 100 })} /></label><select aria-label="Image blend mode" value={selectedNode.imageTransform?.blendMode || 'source-over'} onChange={(event) => updateImageTransform({ blendMode: event.target.value as GlobalCompositeOperation })}><option value="source-over">Normal</option><option value="multiply">Multiply</option><option value="screen">Screen</option><option value="overlay">Overlay</option><option value="darken">Darken</option><option value="lighten">Lighten</option></select><select aria-label="Composition overlay" value={selectedNode.imageTransform?.overlay || ''} onChange={(event) => updateImageTransform({ overlay: (event.target.value || undefined) as ImageTransform['overlay'] })}><option value="">Overlay…</option><option value="thirds">Rule of thirds</option><option value="golden">Golden ratio</option><option value="center">Center cross</option><option value="diagonals">Diagonals</option></select><button className="quiet-button compact" type="button" title="Create a derived PNG and clear this card's render-time edits" disabled={!selectedNode.imageTransform || readOnly} onClick={bakeImageTransform}>Bake</button></>}
          {selectedVectorPathNodes.length === 2 && <><button className="quiet-button compact" type="button" title={canJoinPaths ? 'Join two open vector paths' : 'Join requires two open vector paths'} disabled={!canJoinPaths} onClick={joinSelectedPaths}>Join paths</button><button className="quiet-button compact" type="button" title={canBooleanPaths ? 'Create an editable union of two closed vector paths' : 'Boolean operations require two closed vector paths'} disabled={!canBooleanPaths} onClick={() => booleanSelectedPaths('union')}>Union</button><button className="quiet-button compact" type="button" title={canBooleanPaths ? 'Create an editable subtraction of two closed vector paths' : 'Boolean operations require two closed vector paths'} disabled={!canBooleanPaths} onClick={() => booleanSelectedPaths('subtract')}>Subtract</button><button className="quiet-button compact" type="button" title={canBooleanPaths ? 'Create an editable intersection of two closed vector paths' : 'Boolean operations require two closed vector paths'} disabled={!canBooleanPaths} onClick={() => booleanSelectedPaths('intersect')}>Intersect</button><button className="quiet-button compact" type="button" title={canBooleanPaths ? 'Create an editable exclusive-area path from two closed vector paths' : 'Boolean operations require two closed vector paths'} disabled={!canBooleanPaths} onClick={() => booleanSelectedPaths('exclude')}>Exclude</button></>}
          {selectedIds.length === 1 && <button className="quiet-button compact" type="button" aria-label="Add connected diagram shape" disabled={viewOnly} onClick={(event) => openDiagramPalette(event, 'successor')}>Connected shape…</button>}
          {selectedNode && nodeGraphOwner(board, selectedNode) && <label className="node-graph-role-control">Graph role <select aria-label="Node graph role" value={nodeGraphRole(selectedNode)} disabled={viewOnly} onChange={(event) => changeNodeGraphRole(selectedNode, event.target.value as NodeGraphRole)}><option value="reference">Reference</option><option value="continuity">Continuity</option><option value="branch">Branch</option><option value="identity">Identity</option><option value="evidence">Evidence</option><option value="transform">Transform</option><option value="video">Video</option><option value="general">General</option></select></label>}
          {columnRowActionState(board, selectedIds, { readOnly: viewOnly }).visible && <button className="quiet-button compact" type="button" aria-label="Column row actions" aria-haspopup="menu" aria-expanded={Boolean(contextMenu)} onClick={openColumnRowActions}>Column rows…</button>}
          {selectedIds.length > 0 && <button ref={transferButtonRef} className="quiet-button compact" type="button" aria-label="Move selected objects to board" title="Move to board · Ctrl+Shift+M" disabled={viewOnly || boards.length < 2} onClick={() => setShowTransferDialog(true)}>Move to board…</button>}
          <span className="toolbar-spacer" />
          {interactionTool === 'connect' && <span className="connector-hint">{connectorSourceId ? 'Choose destination' : 'Click cards or drag on empty grid'}</span>}
          {interactionTool === 'draw' && <span className="connector-hint">Drag to draw · Shift constrains</span>}
          <button className="quiet-button compact toolbar-icon-button" type="button" title="Show board assets" aria-label="Show board assets" onClick={() => setShowAssets((visible) => !visible)}><CanvasToolIcon name="assets" />Assets</button>
          {board.nodes.length > 50 && <span className="render-count">{visibleNodes.length}/{board.nodes.length} visible</span>}
        </>}
        </div>
        <div className="canvas-primary-actions">
          <button className={`quiet-button compact toolbar-icon-button ${showColor || showGridSettings || showHierarchy || showAppearance || showStudioObject ? 'active' : ''}`} type="button" title="Open the floating Color and Layers utility" aria-label="Show Color and Layers" aria-expanded={showColor || showGridSettings || showHierarchy || showAppearance || showStudioObject} onClick={() => selectStudioTab('color')}><CanvasToolIcon name="appearance" />Color &amp; Layers</button>
          <button className={`quiet-button compact toolbar-icon-button ${showBoardExport ? 'active' : ''}`} type="button" aria-label="Open board export" aria-expanded={showBoardExport} onClick={() => { setBoardExportTarget(selectedNode && isFrameNode(selectedNode) ? 'frame' : selectedIds.length ? 'selection' : 'viewport'); setShowDiagramStructure(false); setShowBoardExport((visible) => !visible); setShowAppearance(false); setShowMoreCanvasTools(false) }}><CanvasToolIcon name="export" />Export</button>
        </div>
      </div>
      </div>
      {objectOptions === 'connection' && selectedConnector && <aside ref={objectOptionsPanelRef} className="appearance-panel object-options-panel" aria-label="Connection options">
        <header><strong>Connection</strong><button type="button" aria-label="Close connection options" onClick={() => { setObjectOptions(null); objectOptionsButtonRef.current?.focus() }}>×</button></header>
        {isNodeGraphConnector(selectedConnector) && <p>Typed {selectedConnector.nodeGraph.kind} connection · {selectedConnector.nodeGraph.sourceSocket} → {selectedConnector.nodeGraph.targetSocket}. Drag either endpoint to a compatible Node Column socket.</p>}
        <fieldset disabled={viewOnly}>
          <label>Relationship<select aria-label="Connection relationship preset" value={selectedConnector.relationshipStyle || ''} onChange={(event) => { if (event.target.value) updateConnector(selectedConnector.id, applyConnectorRelationshipStyle(selectedConnector, event.target.value)) }}><option value="">Custom</option>{CONNECTOR_RELATIONSHIP_STYLES.map((preset) => <option key={preset.id} value={preset.id}>{preset.name}</option>)}</select></label>
          <label>Pattern<select aria-label="Connection line pattern" value={connectorLinePattern(selectedConnector)} onChange={(event) => updateConnector(selectedConnector.id, { linePattern: event.target.value as BoardConnector['linePattern'], dashed: event.target.value !== 'solid', relationshipStyle: undefined })}><option value="solid">Solid</option><option value="dash">Dash</option><option value="dot">Dot</option><option value="dash-dot">Dash–dot</option></select></label>
          <div className="appearance-control-grid">
            <button className={`quiet-button compact ${selectedConnector.animated ? 'active' : ''}`} type="button" aria-pressed={selectedConnector.animated} onClick={() => updateConnector(selectedConnector.id, { animated: !selectedConnector.animated })}>Flow</button>
            <button className={`quiet-button compact ${selectedConnector.startArrow ? 'active' : ''}`} type="button" aria-label="Toggle start arrow" aria-pressed={selectedConnector.startArrow} onClick={() => updateConnector(selectedConnector.id, { startArrow: !selectedConnector.startArrow })}>← Start arrow</button>
            <button className={`quiet-button compact ${selectedConnector.endArrow ? 'active' : ''}`} type="button" aria-label="Toggle end arrow" aria-pressed={selectedConnector.endArrow} onClick={() => updateConnector(selectedConnector.id, { endArrow: !selectedConnector.endArrow })}>End arrow →</button>
          </div>
          {(['source', 'target'] as const).map((side) => <label key={side}>{side === 'source' ? 'Start' : 'End'} attachment<select aria-label={`Connection ${side} attachment`} disabled={isNodeGraphConnector(selectedConnector)} value={selectedConnector[side === 'source' ? 'sourceId' : 'targetId'] ? selectedConnector[side === 'source' ? 'sourcePortMode' : 'targetPortMode'] || 'fixed' : 'free'} onChange={(event) => setConnectorAttachment(selectedConnector, side, event.target.value)}><option value="free">Free endpoint</option><option value="fixed" disabled={!selectedConnector[side === 'source' ? 'sourceId' : 'targetId']}>Fixed object port</option><option value="adaptive" disabled={!selectedConnector[side === 'source' ? 'sourceId' : 'targetId']}>Adaptive object port</option></select></label>)}
          <div className="appearance-control-grid">
            <button className="quiet-button compact" type="button" disabled={!selectedConnector.labelPosition} onClick={() => updateConnector(selectedConnector.id, { labelPosition: undefined })}>Reset label position</button>
            <button className="quiet-button compact" type="button" disabled={!selectedConnector.bendPoints?.length} onClick={() => updateConnector(selectedConnector.id, { bendPoints: undefined })}>Reset route</button>
          </div>
        </fieldset>
        <p>Drag an endpoint to reconnect or detach it. Drag a label to reposition it. On an elbow line, double-click to add a waypoint; double-click its handle to remove it. Undo restores each finished gesture.</p>
      </aside>}
      {objectOptions === 'image' && selectedNode?.kind === 'image' && <aside ref={objectOptionsPanelRef} className="appearance-panel object-options-panel" aria-label="Image framing options">
        <header><strong>Image framing</strong><button type="button" aria-label="Close image framing options" onClick={() => { setObjectOptions(null); objectOptionsButtonRef.current?.focus() }}>×</button></header>
        <fieldset disabled={viewOnly || Boolean(vectorEditBlockReason(board.nodes, selectedNode.id))}>
          <label>Fit<select aria-label="Image fit" value={normalizeImageFraming(selectedNode.imageTransform).fit} onChange={(event) => updateImageTransform({ fit: event.target.value as ImageTransform['fit'] })}><option value="contain">Contain — whole image</option><option value="cover">Cover — fill and crop</option><option value="fill">Stretch — change proportions</option></select></label>
          <label>Horizontal position<input type="range" aria-label="Image horizontal position" min="0" max="100" value={normalizeImageFraming(selectedNode.imageTransform).positionX} onChange={(event) => updateImageTransform({ positionX: Number(event.target.value) })} /></label>
          <label>Vertical position<input type="range" aria-label="Image vertical position" min="0" max="100" value={normalizeImageFraming(selectedNode.imageTransform).positionY} onChange={(event) => updateImageTransform({ positionY: Number(event.target.value) })} /></label>
          <label>Crop zoom<input type="number" aria-label="Image crop zoom" min="1" max="4" step="0.1" value={normalizeImageFraming(selectedNode.imageTransform).zoom} onChange={(event) => updateImageTransform({ zoom: Math.max(1, Math.min(4, Number(event.target.value) || 1)) })} /></label>
          <button className="quiet-button compact" type="button" onClick={() => updateImageTransform({ fit: undefined, positionX: undefined, positionY: undefined, zoom: undefined })}>Reset framing</button>
        </fieldset>
        <p>The source file is preserved. Contain and Cover keep its proportions. Stretch is explicitly distortion. Crop zoom and position are editable and undoable.</p>
      </aside>}
      {showLayoutResearch && <LayoutResearchPanel board={board} boards={boards} selectedIds={selectedIds} onChange={onBoardChange} onNavigate={onSwitchBoard} onClose={() => setShowLayoutResearch(false)} />}
      {showSvgDrawing && <SvgDrawingPanel readOnly={viewOnly} board={board} onChange={onBoardChange} selectedIds={selectedIds} onSelect={id=>setSelectedIds(id?[id]:[])} onPaint={(id,patch)=>updateNode(id,patch)} onClose={() => setShowSvgDrawing(false)} />}
      {showBoardExport && <aside className="board-export-popover" role="dialog" aria-label="Export board">
        <header><strong>{selectedIds.length ? 'Export selected object or region' : 'Export board'}</strong><button type="button" aria-label="Close board export" onClick={() => setShowBoardExport(false)}>×</button></header>
        {selectedNode?.assetId && <button type="button" onClick={() => void saveSelectedOriginal().catch(error => appAlert(`Could not export original: ${String(error)}`))}>Export original {selectedNode.kind} file…</button>}
        {selectedNode && isFrameNode(selectedNode) && <button type="button" onClick={() => setBoardExportTarget('frame')}>Export this frame region</button>}
        <p className="board-export-contract">Current board · visible artwork. Subboards require separate exports. PNG/JPEG exports the selected region up to 8192 pixels on its longest edge. Export original file preserves media bytes.</p>
        {boardExportReview?.error && <p className="board-export-error" role="alert">{boardExportReview.error}</p>}
        {Boolean(boardExportReview?.warnings.length) && <div className="board-export-warnings" aria-label="Export details"><strong>Export details</strong><ul>{boardExportReview!.warnings.map((warning, index) => <li key={index}>{warning}</li>)}</ul></div>}
        <label>Source<select aria-label="Board export source" value={boardExportTarget} onChange={(event) => setBoardExportTarget(event.target.value as typeof boardExportTarget)}><option value="viewport">Viewport</option><option value="full">Full board</option><option value="selection">Selection</option><option value="frame">Frame</option></select></label>
        <label>Format<select aria-label="Board export format" value={boardExportFormat} onChange={(event) => setBoardExportFormat(event.target.value as typeof boardExportFormat)}><option value="png">PNG</option><option value="jpeg">JPEG</option></select></label>
        <label>Scale<select aria-label="Board export scale" value={boardExportScale} onChange={(event) => setBoardExportScale(Number(event.target.value) as typeof boardExportScale)}><option value="0.5">0.5×</option><option value="1">1×</option><option value="2">2×</option><option value="4">4× · high resolution</option></select></label>
        <small>{boardExportTarget === 'frame' ? 'Uses the selected frame, or the first frame on the board.' : boardExportTarget === 'selection' ? (selectedIds.length ? `${selectedIds.length} selected object${selectedIds.length === 1 ? '' : 's'}` : 'Select cards first.') : boardExportTarget === 'viewport' ? 'Exports the visible canvas area.' : 'Exports all visible board artwork.'}</small>
        <button className="primary-button" type="button" disabled={Boolean(boardExportReview?.error)} onClick={() => void exportBoardImage()}>Export {boardExportFormat.toUpperCase()}</button>
      </aside>}
      {showDiagramStructure && <DiagramStructurePanel board={board} selectedIds={selectedIds} templates={diagramTemplates} origin={{ x: (stageSize.width / 2 - presentedViewport.x) / presentedViewport.scale, y: (stageSize.height / 2 - presentedViewport.y) / presentedViewport.scale }} readOnly={viewOnly} onPublish={publishDiagramBoard} onSaveTemplate={onSaveDiagramTemplate} onSelect={(ids) => { setSelectedIds(ids); setSelectedConnectorId(null) }} onClose={() => { setShowDiagramStructure(false); restoreDiagramFocus() }} />}
      <div className={`canvas-stage engine-vello tool-${interactionTool} viewport-${viewportTool} ${marquee ? 'marquee-active' : ''} ${grayscalePreview ? 'grayscale-preview' : ''} ${isMilanote ? 'milanote-canvas-active' : ''}`} data-canvas-engine="vello" data-canvas-renderer={renderMode} data-gesture-preview={board !== persistedBoard} data-persisted-node-count={persistedBoard.nodes.length} data-engine-scene-revision={canvasScene.revision} data-spatial-index-size={spatialIndex.size} data-spatial-cell-count={spatialIndex.cellCount} data-spatial-visible-candidates={visibleSceneObjects.length} data-total-nodes={board.nodes.length} data-visible-nodes={visibleNodes.length} data-visible-media={visibleMediaCount} tabIndex={0} style={{ backgroundColor: effectiveBoardBackground }} ref={stageRef} onPointerDownCapture={(event) => {
        if (!(event.button === 1 || event.button === 0 && (viewportTool === 'hand' || spacePanRef.current))) return
        const target = event.target instanceof Element ? event.target : null
        if (target?.closest('.canvas-tool-rail, .canvas-subtools, .canvas-tool-rail-restore, .canvas-toolbar, .ocean-toolbar, .board-minimap, .canvas-zoom-control, .unsorted-panel, .canvas-context-menu, .professional-color, .production-studio, .tile-appearance-picker')) return
        // Hand/Space/middle gestures take priority over card drag handlers,
        // including image bodies and portal buttons. They never edit objects.
        event.stopPropagation()
        handleStagePointerDown(event)
      }} onPointerDown={handleStagePointerDown} onClickCapture={(event) => { if (!transformClickSuppressRef.current) return; event.preventDefault(); event.stopPropagation(); clearPostTransformClickSuppression() }} onContextMenu={(event) => { event.preventDefault(); event.currentTarget.focus(); marqueeCancelRef.current?.(); setSelectedIds([]); setSelectedConnectorId(null); setContextMenu({ x: event.clientX, y: event.clientY }) }}>
        
        {!presentationOnly && (showToolRail ? (isMilanote ? (
          <MilanoteToolRail
            interactionTool={interactionTool}
            viewportTool={viewportTool}
            shapeKind={shapeKind}
            viewOnly={viewOnly}
            onAddNote={addNoteNode}
            onAddLink={addBoardLink}
            onAddTodo={addTodoNode}
            onToggleLine={toggleMilanoteLine}
            onAddSubboard={addNestedBoardPortal}
            onAddColumn={addColumnNode}
            onAddComment={addCommentNode}
            onAddTable={addColumnNode}
            onImportImage={() => onImport('image')}
            onImport3DModel={() => onImport('model')}
            onToggleDraw={toggleMilanoteDraw}
            onOpenTrash={() => onOpenTrash ? onOpenTrash() : void deleteSelected()}
          />
        ) : (<><CanvasToolbar>
          <button className="tool-rail-hide" type="button" aria-label="Hide canvas tool rail" title="Hide canvas tools" onClick={() => setShowToolRail(false)}>‹</button>
          <button className={interactionTool === 'select' && viewportTool === 'select' ? 'active' : ''} type="button" title="Select and move · V" aria-label="Select and move" data-shortcut="V" aria-pressed={interactionTool === 'select' && viewportTool === 'select'} onClick={() => { setViewportTool('select'); setInteractionTool('select'); setConnectorSourceId(null) }}><CanvasToolIcon name="select" /></button>
          <button className={interactionTool === 'node' ? 'active' : ''} type="button" title="Node / direct select · A — edit anchors and path segments" aria-label="Node tool" data-shortcut="A" disabled={viewOnly} aria-pressed={interactionTool === 'node'} onClick={() => { setViewportTool('select'); setInteractionTool('node'); setSelectedConnectorId(null) }}><CanvasToolIcon name="node" /></button>
          <button className={interactionTool === 'pen' ? 'active' : ''} type="button" title="Pen · P — click anchors, double-click to finish" aria-label="Pen tool" data-shortcut="P" disabled={viewOnly} aria-pressed={interactionTool === 'pen'} onClick={() => { setPenPoints([]); setInteractionTool('pen') }}><CanvasToolIcon name="pen" /></button>
          <button className={interactionTool === 'pencil' ? 'active' : ''} type="button" title="Pencil · N — draw editable smooth vector stroke" aria-label="Pencil tool" data-shortcut="N" disabled={viewOnly} aria-pressed={interactionTool === 'pencil'} onClick={() => { setViewportTool('select'); setInteractionTool('pencil') }}><CanvasToolIcon name="pen" /></button>
          <button className={interactionTool === 'erase' ? 'active' : ''} type="button" title="Vector Eraser · V / Shift+E" aria-label="Vector Eraser" data-shortcut="V" disabled={viewOnly} aria-pressed={interactionTool === 'erase'} onClick={() => { setViewportTool('select'); setInteractionTool('erase') }}>⌫</button>
          <button className={interactionTool === 'draw' && shapeKind === 'line' ? 'active' : ''} type="button" title="Draw line · L" aria-label="Draw line" data-shortcut="L" disabled={viewOnly} aria-pressed={interactionTool === 'draw' && shapeKind === 'line'} onClick={() => { setShapeKind('line'); setInteractionTool('draw') }}><CanvasToolIcon name="line" /></button>
          <button className={interactionTool === 'draw' && shapeKind === 'arrow' ? 'active' : ''} type="button" title="Draw arrow · A" aria-label="Draw arrow" data-shortcut="A" disabled={viewOnly} aria-pressed={interactionTool === 'draw' && shapeKind === 'arrow'} onClick={() => { setShapeKind('arrow'); setInteractionTool('draw') }}><CanvasToolIcon name="arrow" /></button>
          <button className={interactionTool === 'connect' ? 'active' : ''} type="button" title="Draw connector · C" aria-label="Draw connector" data-shortcut="C" disabled={viewOnly} aria-pressed={interactionTool === 'connect'} onClick={() => { setViewportTool('select'); setInteractionTool((current) => current === 'connect' ? 'select' : 'connect') }}><CanvasToolIcon name="connector" /></button>
          <button className={interactionTool === 'draw' && shapeKind === 'rectangle' ? 'active' : ''} type="button" title="Draw rectangle · R" aria-label="Draw rectangle" data-shortcut="R" disabled={viewOnly} aria-pressed={interactionTool === 'draw' && shapeKind === 'rectangle'} onClick={() => { setShapeKind('rectangle'); setInteractionTool('draw') }}><CanvasToolIcon name="rectangle" /></button>
          <button className={interactionTool === 'draw' && shapeKind === 'ellipse' ? 'active' : ''} type="button" title="Draw ellipse · E" aria-label="Draw ellipse" data-shortcut="E" disabled={viewOnly} aria-pressed={interactionTool === 'draw' && shapeKind === 'ellipse'} onClick={() => { setShapeKind('ellipse'); setInteractionTool('draw') }}><CanvasToolIcon name="ellipse" /></button>
          <button className={interactionTool === 'type' ? 'active' : ''} type="button" title="Type · T — click for point text; drag for area text" aria-label="Type tool" data-shortcut="T" disabled={viewOnly} aria-pressed={interactionTool === 'type'} onClick={() => setInteractionTool('type')}><CanvasToolIcon name="type" /></button>
          <button className="tool-rail-subboard" type="button" title="Create a subboard tile on this board · S" aria-label="Create subboard" data-shortcut="S" disabled={viewOnly} onClick={addNestedBoardPortal}><CanvasToolIcon name="boards" /></button>
          <button type="button" title="Add card column · K" aria-label="Add card column" data-shortcut="K" disabled={viewOnly} onClick={addColumnNode}><CanvasToolIcon name="column" /></button>
          <button type="button" title="Add Node Column · N" aria-label="Add Node Column" data-shortcut="N" disabled={viewOnly} onClick={addNodeColumnNode}>◇▥</button>
          <button type="button" title="Create Graph Column · G" aria-label="Create Graph Column" data-shortcut="G" disabled={viewOnly} onClick={addGraphColumnV2}>◇</button>
          <button type="button" title="Insert image / asset · I" aria-label="Insert image" data-shortcut="I" disabled={viewOnly} onClick={() => onImport('image')}><CanvasToolIcon name="import" /></button>
          <button type="button" title="Diagram shapes palette" aria-label="Diagram shapes" data-shortcut=">" disabled={viewOnly} onClick={(event) => openDiagramPalette(event, 'create')}>◇ Shapes</button>
          <button type="button" title="Drawing canvas container · D" aria-label="Drawing canvas" data-shortcut="D" disabled={viewOnly} onClick={() => { setSelectedIds([]); const point = eventToWorld((stageBoundsRef.current?.left || 0) + stageSize.width / 2, (stageBoundsRef.current?.top || 0) + stageSize.height / 2); const canvas: BoardNode = { id: `drawing-canvas-${crypto.randomUUID()}`, kind: 'group', containerRole: 'frame', boundedCanvas: 'drawing', title: 'Drawing Canvas', x: point.x - 320, y: point.y - 240, width: 640, height: 480, color: '#ffffff', zIndex: 0 }; onBoardChange({ ...board, nodes: [...board.nodes, canvas] }); setSelectedIds([canvas.id]) }}>▧ Canvas</button>
          <button type="button" title={selectedIds.length > 1 ? 'Group selected cards' : 'Presentation frame · Shift+F'} aria-label="Group or frame" data-shortcut="F" disabled={viewOnly} onClick={() => groupSelected({ title: 'Frame', width: 640, height: 360 })}><CanvasToolIcon name="frame" /></button>
          <button className={viewportTool === 'hand' ? 'active' : ''} type="button" title="Hand · H — pan canvas" aria-label="Hand tool" data-shortcut="H" aria-pressed={viewportTool === 'hand'} onClick={() => { setViewportTool(viewportTool === 'hand' ? 'select' : 'hand'); setInteractionTool('select'); setConnectorSourceId(null) }}><CanvasToolIcon name="hand" /></button>
          <button className={viewportTool === 'zoom' ? 'active' : ''} type="button" title="Zoom · Z — click to zoom in" aria-label="Zoom tool" data-shortcut="Z" aria-pressed={viewportTool === 'zoom'} onClick={() => { setViewportTool(viewportTool === 'zoom' ? 'select' : 'zoom'); setInteractionTool('select'); setConnectorSourceId(null) }}><CanvasToolIcon name="zoom" /></button>
          <button type="button" title="Fit every object on board" aria-label="Fit board" data-shortcut="0" onClick={fitBoard}><CanvasToolIcon name="fit" /></button>
          <button type="button" title="Actual size / 100%" aria-label="Actual size 1:1" data-shortcut="1" onClick={setZoom100}>1:1</button>
          <button type="button" title="Fit selected objects" aria-label="Fit selection" data-shortcut="." disabled={!selectedIds.length} onClick={fitSelection}>⌗</button>
          <button type="button" title="Previous zoom" aria-label="Previous zoom" data-shortcut="," disabled={!hasPreviousViewport} onClick={restorePreviousZoom}>↶</button>
          <button type="button" title="Toggle board minimap" aria-label="Minimap" aria-pressed={showMinimap} onClick={() => setShowMinimap((m) => !m)}>🗺</button>
          <button type="button" title="Diagram structure & mind maps" aria-label="Show diagram structure" data-shortcut="S" aria-expanded={showDiagramStructure} onClick={(event) => { cancelActiveGesture(); diagramOpenerRef.current = event.currentTarget; setShowBoardExport(false); setShowDiagramStructure(true); setDiagramPalette(null) }}>▤</button>
          <button className={`tool-rail-more ${showMoreCanvasTools ? 'active' : ''}`} type="button" title="More canvas tools" aria-label="More canvas tools" aria-expanded={showMoreCanvasTools} aria-controls="canvas-subtools" onClick={() => setShowMoreCanvasTools((visible) => !visible)}><CanvasToolIcon name="more" /></button>
          <button type="button" title="Undo last board change · Ctrl+Z" aria-label="Undo board change" disabled={viewOnly} onClick={onUndo}><CanvasToolIcon name="undo" /></button>
          <button type="button" title="Redo board change · Ctrl+Shift+Z" aria-label="Redo board change" disabled={viewOnly} onClick={onRedo}><CanvasToolIcon name="redo" /></button>
          <button type="button" aria-label="Show grid" aria-pressed={board.gridVisible !== false} disabled={viewOnly} onClick={() => onBoardChange({ ...board, gridVisible: board.gridVisible === false })}><CanvasToolIcon name="grid" /></button>
          <button type="button" aria-label="Snap to grid" aria-pressed={board.snapToGrid !== false} disabled={viewOnly} onClick={() => onBoardChange({ ...board, snapToGrid: board.snapToGrid === false })}><CanvasToolIcon name="grid" /></button>
          <button type="button" aria-label="Canvas board information" onClick={() => selectStudioTab('workspace')}><CanvasToolIcon name="appearance" /></button>
          <button type="button" aria-label="Import canvas assets" disabled={viewOnly} onClick={() => onImport('image')}><CanvasToolIcon name="import" /></button>
          <button type="button" aria-label="Export canvas artwork" onClick={() => { setBoardExportTarget(selectedNode && isFrameNode(selectedNode) ? 'frame' : selectedIds.length ? 'selection' : 'viewport'); setShowDiagramStructure(false); setShowBoardExport((visible) => !visible); setShowAppearance(false); setShowMoreCanvasTools(false) }}><CanvasToolIcon name="export" /></button>
        </CanvasToolbar>
        {showMoreCanvasTools && <div id="canvas-subtools" className="canvas-subtools" role="group" aria-label="Additional tool choices">
              <button className={interactionTool === 'pencil' ? 'active' : ''} type="button" title="Pencil · N — draw editable smooth stroke" aria-label="Pencil tool" disabled={viewOnly} aria-pressed={interactionTool === 'pencil'} onClick={() => { setViewportTool('select'); setInteractionTool('pencil'); setShowMoreCanvasTools(false) }}><CanvasToolIcon name="pen" /><span>Pencil</span></button>
              <button className={interactionTool === 'erase' ? 'active' : ''} type="button" title="Vector Eraser · Shift+E" aria-label="Vector Eraser" disabled={viewOnly} aria-pressed={interactionTool === 'erase'} onClick={() => { setViewportTool('select'); setInteractionTool('erase'); setShowMoreCanvasTools(false) }}>⌫<span>Vector Eraser</span></button>
              <button className={interactionTool === 'draw' && shapeKind === 'line' ? 'active' : ''} type="button" title="Line · L" aria-label="Draw line" disabled={viewOnly} aria-pressed={interactionTool === 'draw' && shapeKind === 'line'} onClick={() => { setShapeKind('line'); setInteractionTool('draw'); setShowMoreCanvasTools(false) }}><CanvasToolIcon name="line" /><span>Line</span></button>
              <button className={interactionTool === 'draw' && shapeKind === 'arrow' ? 'active' : ''} type="button" title="Arrow · Shift+A" aria-label="Draw arrow" disabled={viewOnly} aria-pressed={interactionTool === 'draw' && shapeKind === 'arrow'} onClick={() => { setShapeKind('arrow'); setInteractionTool('draw'); setShowMoreCanvasTools(false) }}><CanvasToolIcon name="arrow" /><span>Arrow</span></button>
              <button className={interactionTool === 'connect' ? 'active' : ''} type="button" title="Connector · C" aria-label="Draw connector" disabled={viewOnly} aria-pressed={interactionTool === 'connect'} onClick={() => { setViewportTool('select'); setInteractionTool((current) => current === 'connect' ? 'select' : 'connect'); setShowMoreCanvasTools(false) }}><CanvasToolIcon name="connector" /><span>Connector</span></button>
              <button type="button" title={selectedIds.length > 1 ? 'Group selected cards' : 'Frame · Shift+F'} aria-label="Group or frame" disabled={viewOnly} onClick={() => { groupSelected({ title: 'Frame', width: 640, height: 360 }); setShowMoreCanvasTools(false) }}><CanvasToolIcon name="frame" /><span>Group or frame</span></button>
              <button type="button" aria-label="Create Graph Column" disabled={viewOnly} onClick={() => { addGraphColumnV2(); setShowMoreCanvasTools(false) }}>◇<span>Graph Column</span></button>
              <button type="button" aria-label="Create drawing Canvas Object" disabled={viewOnly} onClick={() => { setSelectedIds([]); const point = eventToWorld((stageBoundsRef.current?.left || 0) + stageSize.width / 2, (stageBoundsRef.current?.top || 0) + stageSize.height / 2); const canvas: BoardNode = { id: `drawing-canvas-${crypto.randomUUID()}`, kind: 'group', containerRole: 'frame', boundedCanvas: 'drawing', title: 'Drawing Canvas', x: point.x - 320, y: point.y - 240, width: 640, height: 480, color: '#ffffff', zIndex: 0 }; onBoardChange({ ...board, nodes: [...board.nodes, canvas] }); setSelectedIds([canvas.id]); setShowMoreCanvasTools(false) }}>▧<span>Drawing Canvas</span></button>
              <button type="button" title="Search common editable diagram shapes" aria-label="Diagram shapes" disabled={viewOnly} onClick={(event) => { openDiagramPalette(event, 'create'); setShowMoreCanvasTools(false) }}>◇<span>Diagram Shapes</span></button>
              <button type="button" title="Mind maps, layers, swimlanes and templates" aria-label="Show diagram structure" aria-expanded={showDiagramStructure} onClick={(event) => { cancelActiveGesture(); diagramOpenerRef.current = event.currentTarget; setShowBoardExport(false); setShowDiagramStructure(true); setDiagramPalette(null); setShowMoreCanvasTools(false) }}>▤<span>Structure</span></button>
              <button type="button" title="Import assets from disk · Ctrl+I" aria-label="Import assets" disabled={viewOnly} onClick={() => { onImport('image'); setShowMoreCanvasTools(false) }}><CanvasToolIcon name="import" /><span>Import</span></button>
              <button type="button" title="Actual pixels / 100%" aria-label="Zoom to 100 percent" onClick={() => { setZoom100(); setShowMoreCanvasTools(false) }}>1:1<span>Actual Size (100%)</span></button>
              <button type="button" title="Fit selected objects" aria-label="Fit selection" disabled={!selectedIds.length} onClick={() => { fitSelection(); setShowMoreCanvasTools(false) }}>⌗<span>Fit Selection</span></button>
              <button type="button" title="Return to previous zoom" aria-label="Previous zoom" disabled={!hasPreviousViewport} onClick={() => { restorePreviousZoom(); setShowMoreCanvasTools(false) }}>↶<span>Previous Zoom</span></button>
        </div>}</>)) : <button className="canvas-tool-rail-restore" type="button" aria-label="Show canvas tool rail" onClick={() => setShowToolRail(true)}>Tools ›</button>)}
        {graphEditorId && <GraphColumnEditor board={board} id={graphEditorId} readOnly={viewOnly} onChange={onBoardChange} onClose={() => setGraphEditorId(null)} />}
        {<Suspense fallback={null}><VelloBoardBackdrop onCardOwnership={onEngineCardOwnership} camera={liveCamera} scene={canvasScene} sceneSource={liveCanvasScene} viewport={presentedViewport} selectedIds={selectedIds} visibleObjectIdsKey={visibleSceneObjects.map(object => object.id).join("\n")} /></Suspense>}
        {interactionTool === 'connect' && !connectorSourceId && <div className="connector-draw-surface" aria-label="Draw a free connection" onPointerDown={startFreeConnector} />}
        {interactionTool === 'draw' && <div className="connector-draw-surface" aria-label="Drag to draw a shape" onPointerDown={startShapeDraw} />}
        {(interactionTool === 'pencil' || interactionTool === 'erase') && <div className="connector-draw-surface freehand-draw-surface" aria-label={interactionTool === 'pencil' ? 'Draw editable Pencil path' : 'Erase vector shapes'} onPointerDown={startFreehand} />}
        {interactionTool === 'erase' && <label className="eraser-size-control">Eraser <input type="range" aria-label="Vector eraser size" min="4" max="120" step="2" value={eraserSize} onChange={(event) => setEraserSize(Number(event.target.value))} />{eraserSize}px</label>}
        {interactionTool === 'pen'
          ? <output className="drawing-notice" aria-live="polite">{penCloseHover ? 'Click the first anchor to close the path' : 'Pen: click for corners · drag for curves · Enter finishes open · click first anchor closes · Escape cancels'}</output>
          : interactionTool === 'node' && directPolicy.message && !(selectedIds.length === 1 && selectedNode && isLiveShapeDirectSelectable(selectedNode))
          ? <output className="drawing-notice" aria-live="polite">{directPolicy.message}</output>
          : drawingNotice && <output className="drawing-notice" aria-live="polite">{drawingNotice}</output>}
        {interactionTool === 'pen' && <div className="connector-draw-surface pen-draw-surface" style={{ cursor: penCloseHover ? 'cell' : 'crosshair' }} aria-label="Place pen path anchors" onPointerDown={startPenPoint} onPointerMove={(event) => {
          if (activeGestureCancelRef.current) return
          const { clientX, clientY, shiftKey } = event
          frameScheduler.schedule('pen-hover', () => {
            const point = eventToWorld(clientX, clientY)
            const closing = !event.altKey && penPoints.length >= 3 && Math.hypot(point.x - penPoints[0].x, point.y - penPoints[0].y) * liveCamera.current.scale <= 12
            setPenCloseHover(closing)
            setPenPreview(closing ? penPoints[0] : penPoints.length ? constrainPenPoint(point, penPoints.at(-1)!, shiftKey) : point)
          })
        }} onPointerLeave={() => { frameScheduler.cancel('pen-hover'); setPenCloseHover(false); if (!activeGestureCancelRef.current) setPenPreview(null) }} />}
        {interactionTool === 'type' && <div className="connector-draw-surface type-draw-surface" aria-label="Place text; click for point text or drag for area text" onPointerDown={placeTypeNode} />}
        {typeDraft && <div className="type-frame-draft" style={{ left: typeDraft.x * board.viewport.scale + board.viewport.x, top: typeDraft.y * board.viewport.scale + board.viewport.y, width: typeDraft.width * board.viewport.scale, height: typeDraft.height * board.viewport.scale }} />}
        {dropFeedback && <div className="canvas-drop-overlay" aria-live="polite"><span style={{ left: dropFeedback.x, top: dropFeedback.y }}>＋</span><strong>Drop to add {dropFeedback.count} file{dropFeedback.count === 1 ? '' : 's'}</strong><small>Originals stream into this portable project and cards land here.</small></div>}
        {marquee && <i className={`canvas-marquee ${marquee.end.x < marquee.start.x ? 'crossing' : 'containing'}`} aria-hidden="true" style={{ left: Math.min(marquee.start.x, marquee.end.x), top: Math.min(marquee.start.y, marquee.end.y), width: Math.abs(marquee.end.x - marquee.start.x), height: Math.abs(marquee.end.y - marquee.start.y) }} />}
        <div className={`board-world ${interactionTool === 'connect' ? 'connecting' : ''}`} style={{ transform: `translate(${presentedViewport.x}px, ${presentedViewport.y}px) scale(${presentedViewport.scale})` }}>
          <PersistentGuideLayer board={board} />
          <svg className="pen-draft freehand-draft" aria-hidden="true"><path ref={freehandPathRef} fill="none" strokeLinecap="round" strokeLinejoin="round" /></svg>
          <ConnectorLayer board={board} selectedId={selectedConnectorId} preview={connectorPreview} draft={connectorDraft} readOnly={viewOnly} onSelect={(id) => { setSelectedConnectorId(id); setSelectedIds([]); setInteractionTool('select'); setConnectorSourceId(null) }} onEndpointPointerDown={startConnectorEndpointDrag} onBendPointerDown={startConnectorBendDrag} onLabelPointerDown={startConnectorLabelDrag} onAddBend={addConnectorBend} onRemoveBend={(connector, index) => updateConnector(connector.id, { bendPoints: connector.bendPoints?.filter((_, i) => i !== index) })} />
          {graphColumnProjection.connections.length > 0 && <ConnectorLayer board={{ ...board, connectors: graphColumnProjection.connections }} selectedId={null} preview={null} draft={null} readOnly onSelect={() => undefined} onEndpointPointerDown={() => undefined} onBendPointerDown={() => undefined} onLabelPointerDown={() => undefined} onAddBend={() => undefined} onRemoveBend={() => undefined} />}
          <svg className="graph-v2-port-overlay" aria-hidden="true">{board.nodes.filter(node => node.graphColumn).map(node => <g key={node.id} data-node-id={node.id}>{graphColumnProjection.ports.filter(port => !port.hidden && port.groupId === node.id).map(port => <circle key={port.id} cx={port.x + 4} cy={port.y + 4} r="4" fill="#67d5cd" />)}</g>)}</svg>
          {graphColumnProjection.ports.length>0&&<GraphPortInteraction board={board} readOnly={viewOnly} onChange={onBoardChange} onError={setDrawingNotice} onEdit={setGraphEditorId}/>}
          <svg className="node-graph-draft-layer" aria-hidden="true" overflow="visible"><path ref={nodeGraphDraftPathRef} fill="none" stroke="#7ddbd5" strokeWidth="2.5" strokeDasharray="7 5" /></svg>
          {penPoints.length > 0 && <svg className="pen-draft" data-pen-preview="incremental" data-pen-preview-appends={incrementalPenPath.snapshot().appends} aria-hidden="true"><path d={penDraftData} fill="none" stroke="#f1c384" strokeWidth="2" vectorEffect="non-scaling-stroke" />{penPoints.map((point, index) => <circle key={index} cx={point.x} cy={point.y} r={index === 0 && penCloseHover ? 6 / liveCamera.current.scale : 4 / liveCamera.current.scale} fill={index === 0 && penCloseHover ? '#f1c384' : '#1c2229'} stroke="#f1c384" strokeWidth="2" vectorEffect="non-scaling-stroke" />)}</svg>}
          {guideLines.map((guide, index) => <i className={`smart-guide ${guide.axis}`} key={`${guide.axis}-${index}`} style={guide.axis === 'x' ? { left: guide.value } : { top: guide.value }} />)}
          {columnDropTarget && (() => { const column = board.nodes.find((node) => node.id === columnDropTarget.columnId); return column ? <div className="column-drop-indicator" style={{ left: column.x + COLUMN_PADDING, top: columnInsertionY(board, columnDropTarget, new Set(columnDragIds)), width: column.width - COLUMN_PADDING * 2 }}><span>Drop here</span></div> : null })()}
          <div className="board-object-layer" style={{ position: 'absolute', inset: 0, zIndex: 3, pointerEvents: 'none' }}>
          {visibleNodes.map((node) => { const children = node.kind === 'column' ? (columnChildrenById.get(node.id) || []) : []; const fileCount = children.filter((child) => Boolean(child.assetId)).length; const attachedAsset = node.assetId ? assetById.get(node.assetId) : undefined; return (
            <article
              className={`board-node ${node.graphColumn ? 'node-graph-v2' : ''} node-${node.kind} ${node.textMode ? 'node-type node-type-' + node.textMode : ''} ${node.kind === 'text' && node.color === 'transparent' ? 'node-artwork-text' : ''} ${node.drawingLayer ? 'node-drawing-layer' : ''} ${node.kind === 'image' && node.imagePresentation === 'artwork' ? 'node-artwork' : ''} ${node.kind === 'board-link' && node.boardPortal ? 'node-child-board' : ''} ${isFrameNode(node) ? `node-frame ${node.boundedCanvas === 'drawing' ? 'node-drawing-canvas' : ''}` : ''} ${node.kind === 'column' ? `column-presentation-${node.columnPresentation || 'header'}` : ''} ${isNodeColumn(node) ? 'node-graph-column' : ''} ${node.kind === 'column' && node.columnBodyColor ? 'has-body-color' : ''} ${node.parentColumnId ? 'column-child' : ''} ${selectedIds.includes(node.id) ? 'selected' : ''} ${marqueePreviewIds.includes(node.id) ? 'marquee-preview' : ''} ${connectorSourceId === node.id ? 'connector-source' : ''}`}
              key={node.id}
              data-node-id={node.id}
              aria-label={`${isNodeColumn(node) ? 'Node Column' : node.kind} card: ${nodeTitle(node)}`}
              onPointerDown={(event) => {
                const target = event.target instanceof Element ? event.target : null
                // A shape tool draws over existing cards too. Let the card
                // relay its pointer-down into the drawing transaction instead
                // of swallowing the gesture before the canvas can see it.
                if (interactionTool === 'draw') startShapeDraw(event)
                // The Pen tool places anchors across cards the same way it
                // does across empty canvas; without this relay the card would
                // silently swallow the anchor placement.
                if (interactionTool === 'pen') startPenPoint(event)
                if (interactionTool === 'select' && !target?.closest('button, input, textarea, select, [contenteditable="true"], video, iframe, .node-drag-handle, .vector-node-editor')) startNodeDrag(event, node)
                if (interactionTool === 'node' && node.vectorPath && target?.closest('.node-vector-shape') && !target.closest('.vector-segment-hit')) {
                  event.preventDefault()
                  event.stopPropagation()
                  setSelectedIds([node.id])
                  setSelectedConnectorId(null)
                  setSelectedVectorPoint(null)
                  setSelectedVectorAnchorIndexes([])
                  setSelectedVectorSegmentIndexes([])
                }
              }}
              onClick={(event) => selectOrConnectNode(event, node)}
              onDoubleClick={(event) => { if (node.graphColumn) { event.preventDefault(); event.stopPropagation(); setGraphEditorId(node.id); return } if ((node.kind === 'image' || node.kind === 'video' || node.kind === 'model') && node.assetId) { event.preventDefault(); event.stopPropagation(); onPreviewImage(node.assetId) } }}
              tabIndex={0}
              onContextMenu={(event) => { event.preventDefault(); event.stopPropagation(); event.currentTarget.focus(); setSelectedIds((current) => current.includes(node.id) ? current : [node.id]); setSelectedConnectorId(null); setContextMenu({ x: event.clientX, y: event.clientY, nodeId: node.id }) }}
style={{ left: node.x, top: node.y, width: node.width, height: node.height, opacity: isFrameNode(node) ? 1 : node.opacity ?? 1, '--node-accent': node.color || '#d7a36a', '--node-stroke': node.strokeColor || '#484d58', '--node-text': node.textColor || (node.kind === 'text' && node.imagePresentation !== 'artwork' ? 'var(--text)' : readableForeground(node.color || '#d7a36a')), '--shape-stroke': `${node.strokeWidth ?? 2}px`, '--shape-radius': `${node.cornerRadius ?? 14}px`, '--node-body': node.kind === 'column' ? node.columnBodyColor : undefined, backgroundImage: node.kind === 'column' && node.columnBodyColor && !containerCoverUrl(node) ? 'none' : (node.kind === 'group' || node.kind === 'column') && containerCoverUrl(node) ? `linear-gradient(180deg, color-mix(in srgb, ${node.color || '#d7a36a'} 44%, transparent), color-mix(in srgb, ${node.color || '#d7a36a'} 78%, #101419)), url(${containerCoverUrl(node)})` : undefined, backgroundColor: (node.color === 'transparent' || (node.kind === 'text' && node.color === 'transparent')) ? 'transparent' : node.boundedCanvas === 'drawing' ? node.color || '#ffffff' : node.kind === 'column' && node.columnBodyColor ? node.columnBodyColor : isFrameNode(node) && !containerCoverUrl(node) ? 'transparent' : node.kind === 'group' || node.kind === 'column' ? `color-mix(in srgb, ${node.color || '#d7a36a'} 20%, #20242a)` : undefined, backgroundSize: node.kind === 'group' || node.kind === 'column' ? 'cover' : undefined, backgroundPosition: node.kind === 'group' || node.kind === 'column' ? 'center' : undefined, transform: `rotate(${node.rotation || 0}deg) scale(${fisheyeScale(node)})`, zIndex: fisheyeScale(node) > 1.04 ? board.nodes.length + 1 : nodePaintOrder.get(node.id) ?? 0 } as React.CSSProperties}
            >
              {node.kind === 'column'
                ? <header className="node-drag-handle column-header" onPointerDown={(event) => startNodeDrag(event, node)} onDoubleClick={() => renameColumn(node)}><div className="column-header-copy"><strong>{nodeTitle(node)}</strong><small>{isNodeColumn(node) ? 'Node Column · ' : ''}{children.length} card{children.length === 1 ? '' : 's'}{fileCount ? `, ${fileCount} file${fileCount === 1 ? '' : 's'}` : ''}</small></div><button className="column-collapse-control" type="button" aria-label={node.collapsed ? `Expand ${node.title}` : `Collapse ${node.title}`} title={node.collapsed ? 'Expand column' : 'Collapse column'} onPointerDown={(event) => event.stopPropagation()} onClick={(event) => { event.stopPropagation(); toggleColumn(node) }}>{node.collapsed ? '＋' : '−'}</button></header>
                : node.kind !== 'shape' && !node.textMode && !node.graphColumn && <header className="node-drag-handle" onPointerDown={(event) => startNodeDrag(event, node)}><strong>{nodeTitle(node)}</strong><span>{isFrameNode(node) ? 'FRAME' : node.kind.toUpperCase()}</span></header>}
              <NodeGraphControls node={node} ports={nodeGraphPortsById.get(node.id) || []} selectedSocket={nodeSocketSource?.nodeId === node.id ? nodeSocketSource.socket : undefined} readOnly={viewOnly} viewportScale={presentedViewport.scale} onPointerDown={startNodeSocketDrag} onKeyboardActivate={activateNodeSocket} />
              {node.kind === 'image' && (imageUrl(node) ? <div className="transformed-image" data-engine-media-host><Suspense fallback={<div className="format-image-status">Loading image…</div>}>{engineMediaIds.has(node.id)?<div data-engine-media-proxy role="img" aria-label={nodeTitle(node)} />:attachedAsset && attachedAsset.status !== 'modified' && workspaceRoot && validPyramid(attachedAsset.imagePyramid) ? <TiledImagePreview framing={node.imageTransform} pyramid={attachedAsset.imagePyramid} posterUrl={workspaceAssetUrl(workspaceRoot, attachedAsset.imagePyramid.posterRelativePath)!} tilesUrl={workspaceAssetUrl(workspaceRoot, attachedAsset.imagePyramid.tilesRelativePath)!} alt={nodeTitle(node)} viewportScale={presentedViewport.scale * fisheyeScale(node)} rotation={(node.rotation || 0) + (node.imageTransform?.rotation || 0)} flipX={node.imageTransform?.flipX} flipY={node.imageTransform?.flipY} viewKey={`${presentedViewport.x}/${presentedViewport.y}`} style={{ opacity: node.imageTransform?.opacity ?? 1, filter: node.imageTransform?.grayscale ? 'grayscale(1)' : undefined, mixBlendMode: cssBlendMode(node.imageTransform?.blendMode), transform: `rotate(${node.imageTransform?.rotation || 0}deg) scale(${node.imageTransform?.flipX ? -1 : 1},${node.imageTransform?.flipY ? -1 : 1})` }} /> : <FormatImagePreview framing={node.imageTransform} proxyOnly={attachedAsset?.requiresTiledPreview} source={imageUrl(node)!} previewSource={imagePreviewUrl(node)} extension={attachedAsset?.extension || 'png'} alt={nodeTitle(node)} viewportScale={presentedViewport.scale} devicePixelRatio={window.devicePixelRatio || 1} showStatus={selectedIds.includes(node.id)} style={{ opacity: node.imageTransform?.opacity ?? 1, filter: node.imageTransform?.grayscale ? 'grayscale(1)' : undefined, mixBlendMode: cssBlendMode(node.imageTransform?.blendMode), transform: `rotate(${node.imageTransform?.rotation || 0}deg) scale(${node.imageTransform?.flipX ? -1 : 1},${node.imageTransform?.flipY ? -1 : 1})` }} />}</Suspense><CompositionOverlay overlay={node.imageTransform?.overlay} /></div> : <div className="node-image-placeholder"><span>IMAGE</span></div>)}
              {node.kind === 'video' && (assetUrl(node) ? <Suspense fallback={<div className="node-video-placeholder"><span>Loading video…</span></div>}><VideoReview key={assetUrl(node)} source={assetUrl(node)!} title={nodeTitle(node)} annotations={node.videoAnnotations || []} frameRate={node.videoFrameRate || 24} onChange={(update) => updateNode(node.id, update, false)} /></Suspense> : <div className="node-video-placeholder"><span>▶</span></div>)}
              {node.kind === 'model' && (attachedAsset && ['ztl', 'zpr'].includes(attachedAsset.extension.toLowerCase())
                ? <div className="zbrush-companion-card"><span>ZB</span><strong>{attachedAsset.extension.toUpperCase()} companion package</strong><p>Original plus same-stem ZBrush materials and textures are retained in this portable project. Use Open with… to launch ZBrush.</p><small>{attachedAsset.dependencies?.length || 0} companion file{attachedAsset.dependencies?.length === 1 ? '' : 's'} tracked</small></div>
                : assetUrl(node) ? <Suspense fallback={<div className="node-model-placeholder"><span>Loading 3D…</span></div>}><ModelViewer source={assetUrl(node)!} extension={attachedAsset?.extension || ''} title={nodeTitle(node)} /></Suspense> : <div className="node-model-placeholder"><span>3D MODEL</span></div>)}
              {node.kind === 'document' && (node.assetId && assetById.get(node.assetId)?.extension === 'pdf' && assetUrl(node)
                ? <Suspense fallback={<div className="node-document"><span>PDF</span><p>Loading reader…</p></div>}><PdfPreview source={assetUrl(node)!} title={nodeTitle(node)} /></Suspense>
                : node.assetId && assetById.get(node.assetId)?.extension === 'psd' && assetUrl(node)
                  ? <Suspense fallback={<div className="node-document"><span>PSD</span><p>Reading composite…</p></div>}><PsdPreview source={assetUrl(node)!} title={nodeTitle(node)} /></Suspense>
                : <div className="node-document"><span>{node.assetId ? assetById.get(node.assetId)?.extension.toUpperCase() : 'PDF'}</span><p>{node.body}</p></div>)}
              {node.kind === 'note' && <div className="node-copy"><p>{node.body}</p></div>}
              {node.graphColumn && <GraphColumnSurface node={node} sources={board.nodes} result={graphColumnResults.get(node.id) || ''} />}
              {node.kind === 'text' && <Suspense fallback={<div className="node-copy"><p>Loading rich text…</p></div>}><BoardRichText typeText={Boolean(node.textMode)} areaText={node.textMode === "area"} html={node.body || '<p>New text</p>'} selected={selectedIds.includes(node.id)} onLayout={node.textMode === 'point' ? (size, session) => { if (size.width > 0 && size.height > 0 && (Math.abs(node.width - size.width) > .5 || Math.abs(node.height - size.height) > .5)) updateNode(node.id, { width: size.width, height: size.height }, Boolean(session), session ? 'text-' + node.id + '-' + session : undefined) } : undefined} onChange={(body, session) => updateNode(node.id, { body }, true, session ? 'text-' + node.id + '-' + session : undefined)} onRequestText={onRequestText} /></Suspense>}
              {node.kind === 'clip' && <Suspense fallback={<div className="node-copy"><p>Loading captured content…</p></div>}><CapturedContentCard content={node.captured || emptyCapture('article')} mediaUrl={assetUrl(node)} mediaKind={attachedAsset?.kind === 'image' || attachedAsset?.kind === 'video' ? attachedAsset.kind : undefined} onChange={(captured) => updateNode(node.id, { captured }, false)} onEdit={() => editCaptureNode(node)} onRequestText={onRequestText} /></Suspense>}
{node.diagramShape && node.vectorPath && <svg className="diagram-caption-svg" viewBox={'0 0 ' + node.width + ' ' + node.height} preserveAspectRatio="none" aria-hidden="true"><g transform={vectorTransformData(node)} dangerouslySetInnerHTML={{ __html: diagramCaptionSvgMarkup(node) }} /></svg>}
{node.kind === 'shape' && (node.shapeType === 'line' || node.shapeType === 'arrow' ? (() => { const path = directSelectionPath(node)!; const start = path.points[0]; const end = path.points.at(-1)!; const x1 = start.x / node.width * 100; const y1 = start.y / node.height * 100; const x2 = end.x / node.width * 100; const y2 = end.y / node.height * 100; return <svg className={`node-vector-shape ${node.body === 'reverse' ? 'reverse' : ''} ${node.shapeType === 'arrow' && node.arrowMotion?.enabled !== false ? `animated-arrow motion-${node.arrowMotion?.speed || 'normal'} direction-${node.arrowMotion?.direction || 'forward'}` : ''}`} viewBox="0 0 100 100" preserveAspectRatio="none" aria-label={node.shapeType === 'arrow' ? 'Animated arrow' : 'Line'}><defs><marker id={`shape-arrow-${node.id}`} markerWidth="8" markerHeight="8" refX="7" refY="4" orient="auto"><path d="M 0 0 L 8 4 L 0 8 z" fill={node.strokeColor || '#b9d4e7'} /></marker></defs><line className="shape-hit-area" x1={x1} y1={y1} x2={x2} y2={y2} stroke="transparent" strokeWidth={Math.max(16, (node.strokeWidth ?? 2) * 4)} vectorEffect="non-scaling-stroke" /><line className="shape-arrow-base" x1={x1} y1={y1} x2={x2} y2={y2} stroke={node.strokeColor || '#b9d4e7'} strokeWidth={(node.strokeWidth ?? 2) * .65} vectorEffect="non-scaling-stroke" pointerEvents="none" markerEnd={node.shapeType === 'arrow' ? `url(#shape-arrow-${node.id})` : undefined} />{node.shapeType === 'arrow' && node.arrowMotion?.enabled !== false && <line className="shape-arrow-flow" x1={x1} y1={y1} x2={x2} y2={y2} stroke="#fff" strokeWidth={Math.max(1, (node.strokeWidth ?? 2) * .42)} strokeDasharray="2 12" vectorEffect="non-scaling-stroke" pointerEvents="none" />}</svg> })() : node.shapeType === 'path' && node.vectorPath ? <VectorPathShape node={node} onPaintChange={showSvgDrawing && selectedIds[0]===node.id && !viewOnly ? gradient=>updateNode(node.id,{vectorFillGradient:gradient}) : undefined} viewportScale={presentedViewport.scale} editing={interactionTool === 'node' && directPolicy.nodeId === node.id} selectedSegments={selectedIds[0] === node.id ? selectedVectorSegmentIndexes : []} previewSegments={selectedIds[0] === node.id ? marqueePreviewSegments : []} onDragSegment={interactionTool === 'node' && directPolicy.nodeId === node.id ? (event, index) => startVectorSegmentDrag(event, node, index) : undefined} onSelectSegment={interactionTool === 'node' && directPolicy.nodeId === node.id ? (index, additive) => { setSelectedVectorSegmentIndexes((current) => additive ? current.includes(index) ? current.filter((value) => value !== index) : [...current, index] : [index]); setSelectedVectorAnchorIndexes([]); setSelectedVectorPoint(null) } : undefined} /> : node.shapeType === 'ellipse' ? <svg className="node-shape-ellipse" viewBox="0 0 100 100" preserveAspectRatio="none" aria-label="Ellipse"><ellipse className="shape-hit-area" cx="50" cy="50" rx="49" ry="49" fill="transparent" stroke="transparent" strokeWidth={Math.max(16, (node.strokeWidth ?? 2) * 4)} vectorEffect="non-scaling-stroke" /><ellipse cx="50" cy="50" rx="49" ry="49" fill={node.color || '#56748e'} fillOpacity="1" stroke={node.strokeColor || '#b9d4e7'} strokeWidth={node.strokeWidth ?? 2} vectorEffect="non-scaling-stroke" pointerEvents="none" /><text x="50" y="52" textAnchor="middle" dominantBaseline="middle" fill={node.textColor || readableForeground(node.color || '#56748e')} fontSize="8" pointerEvents="none">{node.body}</text></svg> : <div className="node-shape-label rectangle"><strong>{node.body}</strong></div>)}
              {interactionTool === 'node' && directPolicy.nodeId === node.id && node.vectorPath && (() => {
                const controls = vectorEditorControls(node)
                return <div className="vector-node-editor">
                  <svg className="vector-handle-lines" viewBox={`0 0 ${node.width} ${node.height}`} preserveAspectRatio="none" aria-hidden="true">
                    {controls.flatMap(({ index, anchor, handleIn, handleOut }) => [
                      handleIn && <line key={`in-${index}`} x1={anchor.x} y1={anchor.y} x2={handleIn.x} y2={handleIn.y} />,
                      handleOut && <line key={`out-${index}`} x1={anchor.x} y1={anchor.y} x2={handleOut.x} y2={handleOut.y} />,
                    ])}
                  </svg>
                  {controls.map(({ index, anchor, handleIn, handleOut }) => {
                    const endpoint = !node.vectorPath!.closed && (index === 0 || index === controls.length - 1)
                    return <span key={index}>
                      <button className={`vector-anchor ${selectedVectorAnchorIndexes.includes(index) ? 'selected' : ''} ${marqueePreviewAnchors.includes(index) ? 'marquee-preview' : ''} ${endpoint ? 'endpoint' : ''}`} data-point-index={index} type="button" aria-label={`${endpoint ? 'Edit open endpoint' : 'Move anchor'} ${index + 1}`} title={`${endpoint ? 'Open endpoint' : `Anchor ${index + 1}`}; double-click to ${handleIn || handleOut ? 'remove' : 'add'} Bézier handles`} style={{ left: `${anchor.x / node.width * 100}%`, top: `${anchor.y / node.height * 100}%` }} onPointerDown={(event) => startVectorControlDrag(event, node, index, 'anchor')} onDoubleClick={(event) => { event.preventDefault(); event.stopPropagation(); setSelectedVectorPoint({ nodeId: node.id, index }); setSelectedVectorAnchorIndexes([index]); addCurveHandles(node, index) }} />
                      {handleIn && <button className="vector-handle in" type="button" aria-label={`Adjust incoming curve handle ${index + 1}`} style={{ left: `${handleIn.x / node.width * 100}%`, top: `${handleIn.y / node.height * 100}%` }} onPointerDown={(event) => startVectorControlDrag(event, node, index, 'in')} />}
                      {handleOut && <button className="vector-handle out" type="button" aria-label={`Adjust outgoing curve handle ${index + 1}`} style={{ left: `${handleOut.x / node.width * 100}%`, top: `${handleOut.y / node.height * 100}%` }} onPointerDown={(event) => startVectorControlDrag(event, node, index, 'out')} />}
                    </span>
                  })}
                </div>
              })()}
{node.kind === 'board-link' && (() => { const linkedBoard = linkedBoardById.get(node.targetBoardId || ''); const portal = node.boardLinkRole === 'child' && node.boardPortal; const image = linkedBoard && (!portal || linkedBoard.coverAssetId) ? coverUrl(linkedBoard) : ''; const summary = linkedBoard && portal ? subboardSummary(linkedBoard) : undefined; const owner = node.parentColumnId ? nodeById.get(node.parentColumnId) : undefined; const rowInk = owner ? readableForeground(owner.columnBodyColor || owner.color || effectiveBoardBackground) : undefined; return <button className={`board-link-card ${portal ? 'child-board-card subboard-' + subboardPresentation(node) : ''}`} style={{ '--subboard-label-color': rowInk, '--subboard-icon-size': Math.max(16, Math.min(96, node.width - 12, node.height - (subboardPresentation(node) === 'row' ? 12 : 51), subboardPresentation(node) === 'row' ? 48 : 96)) + 'px', '--node-accent': linkedBoard?.tileAccentColor || node.color || '#6ba39b', '--node-icon-foreground': readableForeground(linkedBoard?.tileAccentColor || node.color || '#6ba39b') } as React.CSSProperties} type="button" disabled={!linkedBoard} onKeyDown={(event) => { if (portal && node.targetBoardId && event.key === 'Enter') { event.preventDefault(); event.stopPropagation(); switchFilmstripBoard(node.targetBoardId) } }} title={portal ? 'Click to select; double-click or press Enter to open subboard' : 'Open board shortcut'} onPointerDown={(event) => { event.stopPropagation(); if (portal && interactionTool === 'select') startNodeDrag(event, node) }} onClick={(event) => { event.stopPropagation(); if (portal) setSelectedIds([node.id]); else if (node.targetBoardId) switchFilmstripBoard(node.targetBoardId) }} onDoubleClick={(event) => { if (!portal || !node.targetBoardId) return; event.preventDefault(); event.stopPropagation(); switchFilmstripBoard(node.targetBoardId) }}><span className={image ? 'board-link-cover' : 'board-link-icon'} style={coverImageStyle(image, linkedBoard?.coverFraming)}>{image ? '' : linkedBoard?.tileIcon || (portal ? '▦' : '↗')}</span><strong>{linkedBoard?.title || 'Missing board'}</strong>{summary && <small className="subboard-counts">{summary.label}</small>}{!portal && <small>Board shortcut · open</small>}</button> })()}
            </article>
          )})}
          </div>
          <CanvasInteractionOverlay
            board={board}
            selectedIds={selectedIds}
            selectedNode={selectedNode}
            visibleNodes={visibleNodes}
            interactionTool={interactionTool}
            directPolicy={directPolicy}
            selectedVectorAnchorIndexes={selectedVectorAnchorIndexes}
            marqueePreviewAnchors={marqueePreviewAnchors}
            rotationReadout={rotationReadout}
            cornerRadiusReadout={cornerRadiusReadout}
            viewOnly={viewOnly}
            fisheyeScale={fisheyeScale}
            nodeTitle={nodeTitle}
            stageRef={stageRef}
            startNodeDrag={startNodeDrag}
            startNodeResize={startNodeResize}
            startNodeRotate={startNodeRotate}
            startNodeRadius={startNodeRadius}
            startLiveShapeAnchorDrag={startLiveShapeAnchorDrag}
            startVectorControlDrag={startVectorControlDrag}
            addCurveHandles={addCurveHandles}
            setSelectedVectorPoint={setSelectedVectorPoint}
            setSelectedVectorAnchorIndexes={setSelectedVectorAnchorIndexes}
            toggleColumn={toggleColumn}
          />
        </div>
        <ProductionStudio stageRef={stageRef} visible={!presentationOnly && (showColor || showGridSettings || showHierarchy || showAppearance || showStudioObject)} activeTab={showGridSettings ? 'grid' : showAppearance ? 'workspace' : showHierarchy ? 'layers' : showStudioObject ? 'object' : 'color'} onVisibleChange={showStudio} onTabChange={selectStudioTab} onStroke={() => { if(colorTargets.includes('stroke'))setColorTarget('stroke') }} strokeAvailable={colorTargets.includes('stroke')} context={selectedNode ? nodeTitle(selectedNode) : board.title} selectionCount={selectedIds.length} gridVisible={board.gridVisible !== false}
          color={<fieldset disabled={viewOnly || selectedNodes.some(node => selectedHierarchyStates.get(node.id)?.locked || selectedHierarchyStates.get(node.id)?.hidden)} style={{border:0,padding:0,margin:0,minWidth:0}}><Suspense fallback={null}><ColorPanel embedded
          contextIdentity={JSON.stringify([board.id, 'objects', [...selectedIds].sort()])}
          value={colorValue}
          opacity={selectedNode?.opacity ?? 1}
          swatches={swatches}
          title={colorTitle}
          target={effectiveColorTarget}
          targets={colorTargets}
          targetLabels={selectedNode?.graphColumn || selectedNode?.kind === 'column' ? { fill: 'Header', columnBody: 'Body', text: 'Text' } : selectedNode?.kind === 'group' ? { fill: 'Accent', text: 'Label' } : undefined}
          contrastBackground={colorContrastBackground}
          onTargetChange={(target) => (target === 'fill' || target === 'stroke' || target === 'text' || target === 'columnBody') && setColorTarget(target)}
          onChange={(value, opacity) => { if (!viewOnly && !selectedNodes.some(node => selectedHierarchyStates.get(node.id)?.locked || selectedHierarchyStates.get(node.id)?.hidden) && colorTargets.includes(effectiveColorTarget) && selectedNodes.length) onBoardChange({ ...board, nodes: board.nodes.map((node) => selectedIds.includes(node.id) ? { ...node, ...(effectiveColorTarget === 'columnBody' ? { columnBodyColor: value, ...(node.columnLinkHeader ? { color: deriveLinkedHeader(value) } : {}) } : effectiveColorTarget === 'fill' ? { color: value, columnLinkHeader: undefined } : effectiveColorTarget === 'stroke' ? { strokeColor: value } : { textColor: value }), opacity } : node) }) }}
          onSwatchesChange={(values) => { if (!viewOnly) onSwatchesChange(values) }}
          onClose={() => showStudio(false)}
        /></Suspense></fieldset>}
          grid={<fieldset disabled={viewOnly} style={{border:0,padding:0,margin:0,minWidth:0}}><Suspense fallback={null}><ColorPanel embedded
          contextIdentity={JSON.stringify([board.id, 'canvas'])}
          className="grid-color-panel"
          value={gridColorTarget === 'background' ? effectiveBoardBackground : effectiveGridColor}
          opacity={gridColorTarget === 'grid' ? board.gridOpacity ?? DEFAULT_CANVAS_GRID_OPACITY : 1}
          swatches={swatches}
          title="Grid & canvas"
          target={gridColorTarget}
          targets={['background', 'grid']}
          contrastBackground={gridColorTarget === 'grid' ? effectiveBoardBackground : readableForeground(effectiveBoardBackground)}
          controls={<div className="grid-settings-controls">
            <label><input type="checkbox" checked={board.gridVisible !== false} onChange={(event) => onBoardChange({ ...board, gridVisible: event.target.checked })} /><span>Show grid</span></label>
            <label><input type="checkbox" checked={board.snapToGrid !== false} onChange={(event) => onBoardChange({ ...board, snapToGrid: event.target.checked })} /><span>Snap to grid</span></label><label><input type="checkbox" checked={board.snapToObjects !== false} onChange={(event) => onBoardChange({ ...board, snapToObjects: event.target.checked })} /><span>Smart object alignment</span></label><label><input type="checkbox" checked={board.snapToGuides !== false} onChange={(event) => onBoardChange({ ...board, snapToGuides: event.target.checked })} /><span>Snap to layout guides</span></label>
            <label><input type="checkbox" checked={backgroundFollowsTheme} onChange={(event) => onBoardChange({ ...board, backgroundFollowsTheme: event.target.checked, backgroundColor: event.target.checked ? undefined : effectiveBoardBackground })} /><span>Canvas follows app theme</span></label>
            <label className="grid-spacing-control"><span>Spacing</span><input aria-label="Grid spacing" type="range" min="12" max="120" step="4" value={board.gridSpacing || 44} onChange={(event) => onBoardChange({ ...board, gridSpacing: Number(event.target.value) })} /><output>{board.gridSpacing || 44}px</output></label>
            <button type="button" onClick={() => onBoardChange({ ...board, backgroundColor: undefined, backgroundFollowsTheme: true, gridColor: undefined, gridOpacity: undefined, gridSpacing: undefined })}>Reset theme defaults</button>
          </div>}
          onTargetChange={(target) => (target === 'background' || target === 'grid') && setGridColorTarget(target)}
          onChange={(value, opacity) => !viewOnly && onBoardChange(gridColorTarget === 'background' ? { ...board, backgroundColor: value, backgroundFollowsTheme: false } : { ...board, gridColor: value, gridOpacity: opacity })}
          onSwatchesChange={(values) => { if (!viewOnly) onSwatchesChange(values) }}
          onClose={() => selectStudioTab('color')}
        /></Suspense></fieldset>}
          layers={<section>
          <header className="production-layer-heading"><strong>Layers</strong><small>{board.nodes.length} objects · {board.title}</small></header>
          <div className="production-layer-actions"><button type="button" disabled={viewOnly || !selectedIds.length} onClick={() => changeLayer(1)}>Bring to front</button><button type="button" disabled={viewOnly || !selectedIds.length} onClick={() => changeLayer(-1)}>Send to back</button><button type="button" disabled={viewOnly || !selectedIds.length} onClick={() => groupSelected()}>Group</button><button type="button" disabled={viewOnly || !selectedIds.some(id => board.nodes.find(node => node.id === id)?.kind === 'group')} onClick={ungroupSelected}>Ungroup</button></div>
          {!hierarchyProjection.ok ? <p role="status">{hierarchyProjection.issues[0]?.detail || 'Board hierarchy could not be projected.'}</p> : hierarchyRows.length ? <div className="production-layer-tree"><VirtualList tree items={hierarchyRows} itemKey={row => row.node.id} label="Board objects" renderItem={({ node, depth, locked, hidden }) => <div className={`hierarchy-row ${selectedIds.includes(node.id) ? 'selected' : ''}`} data-hidden={hidden} role="treeitem" aria-level={depth + 1} aria-selected={selectedIds.includes(node.id)} key={node.id} style={{ '--hierarchy-depth': depth } as React.CSSProperties}>
            <button className="hierarchy-select" type="button" title={nodeTitle(node)} onClick={(event) => { setSelectedIds(event.shiftKey ? selectedIds.includes(node.id) ? selectedIds.filter(id => id !== node.id) : [...selectedIds, node.id] : [node.id]); setSelectedConnectorId(null) }} onDoubleClick={() => focusUnsortedNode(node)}><span>{node.kind === 'group' ? '▱' : node.kind === 'column' ? '▥' : node.kind === 'image' ? '▧' : node.kind === 'video' ? '▶' : node.kind === 'model' ? '◈' : node.kind === 'document' ? '¶' : node.kind === 'board-link' ? '↗' : node.kind === 'clip' ? '✦' : node.kind === 'shape' ? '◇' : '•'}</span><strong>{nodeTitle(node)}</strong><small>{node.kind}</small></button>
            <button className={`hierarchy-lock ${locked ? 'active' : ''}`} type="button" disabled={viewOnly || (locked && !node.locked) || (hidden && !node.hidden)} title={locked && !node.locked ? 'Locked by an owner' : undefined} aria-label={`${node.locked ? 'Unlock' : 'Lock'} ${nodeTitle(node)}`} aria-pressed={locked} onClick={() => updateNode(node.id, { locked: !node.locked })}>{locked ? '●' : '○'}</button>
            <button className="hierarchy-visibility" type="button" disabled={viewOnly || locked || (hidden && !node.hidden)} title={hidden && !node.hidden ? 'Hidden by an owner' : undefined} aria-label={`${node.hidden ? 'Show' : 'Hide'} ${nodeTitle(node)}`} aria-pressed={!hidden} onClick={() => updateNode(node.id, { hidden: !node.hidden })}>{hidden ? '◌' : '◉'}</button>
          </div>} /></div> : <p>No objects on this board.</p>}
        </section>}
          object={<section className="production-studio-object">
          {selectedIds.length === 1 && selectedNode ? <><h3>{nodeTitle(selectedNode)}</h3><small>{selectedNode.kind} · {selectedHierarchyStates.get(selectedNode.id)?.locked ? 'Locked' : 'Editable'}</small><fieldset disabled={viewOnly || Boolean(selectedHierarchyStates.get(selectedNode.id)?.locked || selectedHierarchyStates.get(selectedNode.id)?.hidden)}>
            <label>Name<input aria-label="Object name" value={selectedNode.title || ''} onChange={event => updateNode(selectedNode.id, { title: event.target.value })}/></label>
            {(['x','y','width','height','rotation'] as const).map(key => <label key={key}>{key === 'rotation' ? 'Rotation' : key[0].toUpperCase()+key.slice(1)}<input aria-label={`Object ${key}`} type="number" step="0.1" min={key === 'width' || key === 'height' ? 1 : undefined} value={selectedNode[key] || 0} onChange={event => { const value=Number(event.target.value); if(Number.isFinite(value))updateNode(selectedNode.id, {[key]: key==='width'||key==='height'?Math.max(1,value):value}) }}/></label>)}
            {selectedNode.kind === 'shape' && <label>Stroke width<input aria-label="Object stroke width" type="number" min="0" value={selectedNode.strokeWidth ?? 2} onChange={event => updateNode(selectedNode.id, {strokeWidth:Math.max(0,Number(event.target.value))})}/></label>}
            <label>Opacity<input aria-label="Object opacity" type="range" min="0" max="100" value={Math.round((selectedNode.opacity ?? 1)*100)} onChange={event => updateNode(selectedNode.id,{opacity:Number(event.target.value)/100})}/></label>
          </fieldset><button type="button" onClick={() => {setSelectedIds([]);setSelectedConnectorId(null)}}>Clear selection</button></> : <><h3>{selectedIds.length ? `${selectedIds.length} selected objects` : board.title}</h3><p>{selectedIds.length ? 'Use Color & Layers for shared paint, grouping and ordering. Select one object to inspect its geometry.' : `${board.nodes.length} objects · ${board.connectors.length} connections`}</p><button type="button" onClick={() => selectStudioTab('layers')}>Open Layers</button><button type="button" onClick={() => selectStudioTab('grid')}>Grid & canvas settings</button></>}
        </section>}
          workspace={<>
        <section><h3>Canvas</h3><div className="appearance-control-grid">
          <button className={`quiet-button compact toolbar-icon-button ${showGridSettings ? 'active' : ''}`} type="button" aria-label="Grid and canvas settings" disabled={viewOnly} aria-expanded={showGridSettings} onClick={() => { selectStudioTab('grid') }}><CanvasToolIcon name="grid" />Grid settings</button>
          <button className={`quiet-button compact toolbar-icon-button ${grayscalePreview ? 'active' : ''}`} type="button" aria-label="Toggle black and white preview" aria-pressed={grayscalePreview} onClick={() => setGrayscalePreview((enabled) => !enabled)}><CanvasToolIcon name="monochrome" />B&amp;W preview</button>
        </div></section>
        <section><h3>Boards</h3><div className="appearance-control-grid">
          <button className={`quiet-button compact toolbar-icon-button ${showFilmstrip ? 'active' : ''}`} type="button" aria-label="Toggle board filmstrip" disabled={viewOnly} aria-expanded={showFilmstrip} onClick={() => { setShowFilmstrip((visible) => !visible); selectStudioTab('color') }}><CanvasToolIcon name="boards" />Boards {boards.length}</button>
          <button className="quiet-button compact toolbar-icon-button" type="button" aria-label="Paste copied cards on this board" disabled={viewOnly} onClick={pasteClipboard}><CanvasToolIcon name="paste" />Paste</button>
          <label className="appearance-select-control"><span><CanvasToolIcon name="frame" />Frame</span><select aria-label="Create named presentation frame" disabled={viewOnly} defaultValue="" onChange={(event) => { const [title, width, height] = event.target.value.split('|'); if (title) groupSelected({ title, width: Number(width), height: Number(height) }); event.currentTarget.value = '' }}><option value="">Choose size…</option><option value="16:9 frame|640|360">16:9</option><option value="4:3 frame|640|480">4:3</option><option value="Square frame|480|480">Square</option><option value="Letter frame|612|792">Letter</option><option value="A4 frame|595|842">A4</option><option value="Desktop frame|1440|900">Desktop</option><option value="Tablet frame|834|1112">Tablet</option><option value="Mobile frame|390|844">Mobile</option></select></label>
          <button className="quiet-button compact toolbar-icon-button" type="button" aria-label="Open a floating presentation window" onClick={openViewOnlyBoard}><CanvasToolIcon name="present" />Present</button>
        </div></section>
        <section><h3>Arrange</h3><div className="appearance-control-grid">
          <button type="button" disabled={viewOnly} onClick={() => { setShowLayoutResearch(true); selectStudioTab('color') }}>Layout tools: guides and preview</button>
          <button type="button" disabled={viewOnly} onClick={() => { setShowSvgDrawing(true); selectStudioTab('color') }}>Drawing tools: editable SVG study</button>
          <button className="quiet-button compact toolbar-icon-button" type="button" aria-label="Arrange free cards into a compact grid" disabled={viewOnly} onClick={compactPack}><CanvasToolIcon name="pack" />Pack into grid</button>
          <button className="quiet-button compact toolbar-icon-button" type="button" aria-label="Match image widths without enlarging any image" disabled={viewOnly} onClick={normalizeImageSizes}><CanvasToolIcon name="normalize" />Match image widths</button>
          <button className={`quiet-button compact toolbar-icon-button ${showUnsorted ? 'active' : ''}`} type="button" aria-label="Show freeform items" aria-expanded={showUnsorted} onClick={() => { setShowUnsorted((visible) => !visible); selectStudioTab('color') }}><CanvasToolIcon name="unsorted" />{unsortedCount} Freeform</button>
        </div></section>
        <section><h3>View</h3><div className="appearance-control-grid">
          <button className={`quiet-button compact toolbar-icon-button ${showHierarchy ? 'active' : ''}`} type="button" aria-label="Show board hierarchy" aria-expanded={showHierarchy} onClick={() => { setShowUnsorted(false); selectStudioTab('layers') }}><CanvasToolIcon name="boards" />Hierarchy</button>
          <button className={`quiet-button compact toolbar-icon-button ${showCanvasDiagnostics ? 'active' : ''}`} type="button" aria-label="Show canvas diagnostics" aria-expanded={showCanvasDiagnostics} onClick={() => setShowCanvasDiagnostics((visible) => !visible)}><CanvasToolIcon name="status" />Status</button>
          <button className="quiet-button compact toolbar-icon-button" type="button" aria-label="Fit board" onClick={fitBoard}><CanvasToolIcon name="fit" />Fit board</button>
          <output className="appearance-zoom" aria-label="Canvas zoom">{Math.round(board.viewport.scale * 100)}%</output>
        </div></section>
          </>}
        />
        {showUnsorted && <aside className="unsorted-panel" aria-label="Freeform items"><p className="organization-filter-help">Top-level items outside groups, frames and columns. Items may already be deliberately placed.</p><header><strong>Freeform items</strong><button type="button" aria-label="Close freeform items" onClick={() => setShowUnsorted(false)}>×</button></header>{board.nodes.filter((node) => node.kind !== 'column' && node.kind !== 'group' && !node.parentColumnId && !node.groupId).length ? <div>{board.nodes.filter((node) => node.kind !== 'column' && node.kind !== 'group' && !node.parentColumnId && !node.groupId).map((node) => <button type="button" key={node.id} onClick={() => focusUnsortedNode(node)}><span>{node.kind === 'board-link' ? '↗' : node.kind === 'clip' ? '✦' : node.kind === 'image' ? '▧' : node.kind === 'video' ? '▶' : node.kind === 'model' ? '◈' : node.kind === 'document' ? '¶' : '•'}</span><strong>{nodeTitle(node)}</strong><small>{node.kind}</small></button>)}</div> : <p>Every card belongs to a group, frame or column.</p>}</aside>}
        {showAssets && <aside className="unsorted-panel asset-explorer" aria-label="Board asset folder explorer"><header><strong>Board assets</strong><button type="button" aria-label="Close board assets" onClick={() => setShowAssets(false)}>×</button></header><div>{board.nodes.filter((node) => node.assetId).map((node) => <button type="button" key={node.id} onClick={() => focusUnsortedNode(node)}><span>{node.kind === 'image' ? '▧' : node.kind === 'video' ? '▶' : node.kind === 'model' ? '◈' : '¶'}</span><strong>{nodeTitle(node)}</strong><small>{assetById.get(node.assetId || '')?.virtualFolder || node.kind}</small></button>)}{!board.nodes.some((node) => node.assetId) && <p>No imported assets on this board.</p>}</div></aside>}
        {showMinimap && <Suspense fallback={null}><BoardMinimap nodes={board.nodes} assetSources={modelAssetSources} camera={liveCamera} scene={canvasScene} viewport={presentedViewport} stageWidth={stageSize.width} stageHeight={stageSize.height} onViewportChange={(viewport) => { rememberViewport(presentedViewportRef.current); presentViewport(viewport); commitViewport(viewport) }} /></Suspense>}
        {!viewOnly && <div className="canvas-zoom-control" role="group" aria-label="Canvas zoom controls">
          <button type="button" className={showMinimap ? 'active' : ''} aria-label={showMinimap ? 'Hide canvas minimap' : 'Show canvas minimap'} aria-pressed={showMinimap} title="Toggle minimap" onClick={() => setShowMinimap((visible) => !visible)}>▣</button>
          <button type="button" aria-label="Zoom out" title="Zoom out" disabled={presentedViewport.scale <= MIN_CANVAS_ZOOM + .001} onClick={() => stepZoom(-1)}>−</button>
          <button type="button" className="canvas-zoom-percentage" aria-label={`Canvas zoom ${Math.round(presentedViewport.scale * 100)} percent. Open zoom options`} aria-expanded={showZoomMenu} onClick={() => setShowZoomMenu((visible) => !visible)}>{Math.round(presentedViewport.scale * 100)}%</button>
          <button type="button" aria-label="Zoom in" title="Zoom in" disabled={presentedViewport.scale >= MAX_CANVAS_ZOOM - .001} onClick={() => stepZoom(1)}>＋</button>
          {showZoomMenu && <div className="canvas-zoom-menu" role="menu" aria-label="Zoom options">
            {[.25, .5, 1, 2].map((scale) => <button type="button" role="menuitemradio" aria-checked={Math.abs(presentedViewport.scale - scale) < .001} key={scale} onClick={() => { setZoomLevel(scale); setShowZoomMenu(false) }}>{Math.round(scale * 100)}%</button>)}
            <span />
            <button type="button" role="menuitem" onClick={() => { setZoom100(); setShowZoomMenu(false) }}>100% · Actual size</button>
            <button type="button" role="menuitem" onClick={() => { fitBoard(); setShowZoomMenu(false) }}>Fit board</button>
            <button type="button" role="menuitem" disabled={!selectedIds.length} onClick={() => { fitSelection(); setShowZoomMenu(false) }}>Fit selection</button>
            <button type="button" role="menuitem" disabled={!hasPreviousViewport} onClick={() => { restorePreviousZoom(); setShowZoomMenu(false) }}>Previous zoom</button>
          </div>}
        </div>}
        {showCanvasDiagnostics && <aside className="canvas-diagnostics" aria-label="Canvas diagnostics">
          <header><strong>Canvas status</strong><button type="button" aria-label="Close canvas diagnostics" onClick={() => setShowCanvasDiagnostics(false)}>×</button></header>
          <dl>
            <BoardRendererDiagnostics stageRef={stageRef} configuredRenderer={'wgpu · Vello GPU / Vello CPU'} />
            <div><dt>Display scale</dt><dd>{devicePixelRatio.toFixed(2)}× DPR</dd></div>
            <div><dt>Render scale</dt><dd>{renderScale.toFixed(2)}× (capped)</dd></div>
            <div><dt>Canvas backing store</dt><dd>≈ {Math.round(estimatedRenderPixels / 1_000_000 * 10) / 10} MP</dd></div>
            <div><dt>Render target</dt><dd>≈ {formatBytes(estimatedRenderBytes)}</dd></div>
            <CanvasResourceDiagnostics />
            <div><dt>Visible nodes</dt><dd>{visibleNodes.length} / {board.nodes.length}</dd></div>
            <div><dt>Visible media</dt><dd>{visibleMediaCount}</dd></div>
            <div><dt>Frame sample</dt><dd>{canvasFrameRate === null ? 'Sampling…' : `${canvasFrameRate} fps`}</dd></div>
            <div><dt>Exact GPU memory</dt><dd>Unavailable</dd></div>
          </dl>
          <p>Render target is an estimate. Browser APIs cannot reliably report live VRAM.</p>
        </aside>}
        {contextMenu && <CanvasContextMenuSurface x={contextMenu.x} y={contextMenu.y} onClose={() => setContextMenu(null)}>
          {contextMenu.nodeId && contextNode?.kind === 'board-link' && (() => { const linkedBoard = boards.find((entry) => entry.id === contextNode.targetBoardId); const portal = contextNode.boardLinkRole === 'child' && contextNode.boardPortal; return <><span className="context-section">{portal ? 'Subboard' : 'Board shortcut'}</span>{linkedBoard && <><button type="button" onClick={() => { setContextMenu(null); onSwitchBoard(linkedBoard.id) }}>Open board</button><button type="button" onClick={() => { setContextMenu(null); onRenameBoard(linkedBoard) }}>Rename board…</button>{portal && <><label className="context-board-setting">Tile color <input type="color" aria-label="Subboard tile color" value={linkedBoard.tileAccentColor || '#5778c9'} onChange={(event) => onUpdateBoardTile(linkedBoard.id, { tileAccentColor: event.target.value })} /></label><button type="button" onClick={() => { setContextMenu(null); setTileAppearance({ boardId: linkedBoard.id, x: contextMenu.x, y: contextMenu.y }) }}>Tile appearance…</button><button type="button" className="context-danger" onClick={() => { setContextMenu(null); void onTrashBoard(linkedBoard.id) }}>Move board and contents to Trash…</button></>}</>}{linkedBoard && !portal && <small className="context-hint">Moving this shortcut to Trash does not delete the linked board.</small>}</> })()}
          {contextNode?.textMode && <><span className="context-section">Type</span><button type="button" disabled={viewOnly} onClick={() => { updateNode(contextNode.id, { textMode: contextNode.textMode === 'point' ? 'area' : 'point' }); setContextMenu(null) }}>{contextNode.textMode === 'point' ? 'Convert to area text' : 'Convert to point text'}</button></>}
          {(contextNode?.kind === 'column' || contextNode?.kind === 'group') && <>
            {contextNode?.graphColumn && <><span className="context-section">Graph Column 2</span><button type="button" onClick={() => { setGraphEditorId(contextNode.id); setContextMenu(null) }}>Edit graph connections</button><button type="button" onClick={() => { setContextMenu(null); inspectGraphColumnV2(contextNode) }}>Inspect connected data</button><button type="button" disabled={viewOnly || selectedIds.length < 2} onClick={() => { try { onBoardChange(bindGraphColumnInputs(board, contextNode.id, selectedIds.filter(id => id !== contextNode.id))); setContextMenu(null) } catch (error) { setDrawingNotice(String(error)) } }}>Connect selected objects as inputs</button><button type="button" disabled={viewOnly} onClick={() => { try { onBoardChange(editGraphColumn(board, contextNode.id, { operation: contextNode.graphColumn!.operation === 'count' ? 'collect' : 'count' })); setContextMenu(null) } catch (e) { setDrawingNotice(String(e)) } }}>Toggle collect / count</button></>}
            <span className="context-section">Container</span>
            <button type="button" onClick={() => { setContextMenu(null); renameContainer(contextNode) }}>Rename</button>
            <button type="button" onClick={() => { setContextMenu(null); setSelectedIds([contextNode.id]); setColorTarget('fill'); setShowColor(true) }}>Color mode…</button>
            {contextNode.kind === 'column' && <>
              <span className="context-section">Image sizing</span>
              <button type="button" role="menuitemradio" aria-label="Responsive" aria-checked={contextNode.columnImageSizing === 'responsive'} disabled={viewOnly || Boolean(vectorEditBlockReason(board.nodes, contextNode.id)) || Boolean(contextNode.collapsed)} onClick={() => { setContextMenu(null); onSetColumnImageSizing(contextNode.id, 'responsive') }}>Responsive</button>
              <button type="button" role="menuitemradio" aria-label="Minimum height" aria-checked={contextNode.columnImageSizing === 'minimum-height'} disabled={viewOnly || Boolean(vectorEditBlockReason(board.nodes, contextNode.id)) || Boolean(contextNode.collapsed)} onClick={() => { setContextMenu(null); onSetColumnImageSizing(contextNode.id, 'minimum-height') }}>Minimum height</button>

              <label className="context-board-setting">Body color <input type="color" aria-label="Column body color" value={contextNode.columnBodyColor || '#24303f'} onChange={(event) => updateNode(contextNode.id, { columnBodyColor: event.target.value, ...(contextNode.columnLinkHeader ? { color: deriveLinkedHeader(event.target.value) } : {}) })} /></label>
              <label className="context-board-setting">Link header to body <input type="checkbox" aria-label="Link the column header color to the body color" checked={Boolean(contextNode.columnLinkHeader)} onChange={(event) => updateNode(contextNode.id, { columnLinkHeader: event.target.checked || undefined, ...(event.target.checked && contextNode.columnBodyColor ? { color: deriveLinkedHeader(contextNode.columnBodyColor) } : {}) })} /></label>
              {contextNode.columnBodyColor && <button type="button" onClick={() => { setContextMenu(null); updateNode(contextNode.id, { columnBodyColor: undefined, columnLinkHeader: undefined }) }}>Clear body color</button>}
            </>}
            <button type="button" onClick={() => { setContextMenu(null); toggleContainerCover(contextNode) }}>{contextNode.coverAssetId ? 'Remove cover' : 'Set cover'}</button>
            <button type="button" onClick={() => { setContextMenu(null); toggleContainer(contextNode) }}>{contextNode.collapsed ? 'Expand' : 'Collapse'}</button>
            <button type="button" onClick={() => { setContextMenu(null); duplicateSelected() }}>Duplicate</button>
            {contextNode.kind === 'group' && <button type="button" onClick={() => { setContextMenu(null); ungroupSelected() }}>Ungroup</button>}
            <button type="button" className="context-danger" onClick={() => { setContextMenu(null); dissolveContainer(contextNode) }}>Dissolve</button>
          </>}
          {contextNode?.kind === 'image' && (() => { const asset = contextNode.assetId ? assetById.get(contextNode.assetId) : undefined; const applicationPath = asset ? openWith[asset.extension.toLowerCase()] : undefined; const container = parentContainer(contextNode); return <>
            <span className="context-section">Asset</span>
            {asset && <button type="button" onClick={() => { setContextMenu(null); void saveSelectedOriginal(contextNode).catch((error) => appAlert(`Could not save original: ${String(error)}`)) }}>Save original as…</button>}
            <button type="button" onClick={() => { setContextMenu(null); void exportSelectedAppearance(contextNode).catch((error) => appAlert(`Could not export image: ${String(error)}`)) }}>Export rendered image…</button>
            <button type="button" onClick={() => { setContextMenu(null); void copySelectedImage(contextNode).catch((error) => appAlert(`Could not copy image: ${String(error)}`)) }}>Copy image</button>
            {asset && applicationPath ? <button type="button" onClick={() => { setContextMenu(null); onOpenWith(asset, applicationPath) }}>Open with…</button> : <button type="button" disabled title="Assign an application in the Asset Catalog">Open with…</button>}
            {asset && <button type="button" onClick={() => { setContextMenu(null); onReplaceAsset(asset) }}>Replace image…</button>}
            {asset && workspaceRoot && !readOnly && ['png', 'jpg', 'jpeg', 'tif', 'tiff', 'bmp'].includes(asset.extension.toLowerCase()) && <button type="button" onClick={() => { setContextMenu(null); onPreparePyramid(asset) }}>{asset.imagePyramid ? 'Verify / repair tiled image…' : 'Prepare tiled image…'}</button>}
            {asset && <button type="button" onClick={() => { setContextMenu(null); onSetCover(asset.id) }}>Set cover</button>}
            {asset && <button type="button" onClick={() => { setContextMenu(null); onSetProjectThumbnail(asset.id) }}>Use as project thumbnail</button>}
            {asset && container && <button type="button" onClick={() => { setContextMenu(null); setContainerCover(container, asset.id) }}>Set {container.kind} cover</button>}
            <span className="context-section">Transform</span>
            {contextNode.imagePresentation === 'artwork' && <button type="button" disabled={viewOnly || Boolean(vectorEditBlockReason(board.nodes, contextNode.id)) || Boolean(contextNode.parentColumnId)} onClick={() => { setContextMenu(null); void onFitImageBounds(contextNode.id) }}>Fit bounds to image</button>}
            <button type="button" onClick={() => { updateImageTransform({ flipX: !contextNode.imageTransform?.flipX }, contextNode); setContextMenu(null) }}>Flip horizontal</button>
            <button type="button" onClick={() => { updateImageTransform({ flipY: !contextNode.imageTransform?.flipY }, contextNode); setContextMenu(null) }}>Flip vertical</button>
            <button type="button" onClick={() => { updateImageTransform({ rotation: (((contextNode.imageTransform?.rotation || 0) + 90) % 360) as 0 | 90 | 180 | 270 }, contextNode); setContextMenu(null) }}>Rotate 90°</button>
            <button type="button" onClick={() => { updateImageTransform({ grayscale: !contextNode.imageTransform?.grayscale }, contextNode); setContextMenu(null) }}>{contextNode.imageTransform?.grayscale ? 'Remove grayscale' : 'Grayscale'}</button>
            <button type="button" onClick={() => { setContextMenu(null); copySelected() }}>Copy card</button>
            <button type="button" onClick={() => { setContextMenu(null); duplicateSelected() }}>Duplicate</button>
            <span className="context-section">Order</span>
            <button type="button" onClick={() => { setContextMenu(null); changeLayer(1) }}>Bring to front</button>
            <button type="button" onClick={() => { setContextMenu(null); changeLayer(-1) }}>Send to back</button>
          </> })()}
          {(() => {
            const actions = columnRowActionState(board, selectedIds, { readOnly: viewOnly })
            return actions.visible ? <>
              <span className="context-section">Column rows</span>
              <CanvasContextMenuCommand command={{ label: 'Move earlier in column', disabled: !actions.earlier, title: actions.reason || 'Alt+Up · move one row earlier', onSelect: () => { setContextMenu(null); runColumnRowCommand('earlier') } }} />
              <CanvasContextMenuCommand command={{ label: 'Move later in column', disabled: !actions.later, title: actions.reason || 'Alt+Down · move one row later', onSelect: () => { setContextMenu(null); runColumnRowCommand('later') } }} />
              <CanvasContextMenuCommand command={{ label: 'Move to previous column', disabled: !actions.previousColumn, title: actions.reason || 'Alt+Left · move to previous sibling column', onSelect: () => { setContextMenu(null); runColumnRowCommand('previous') } }} />
              <CanvasContextMenuCommand command={{ label: 'Move to next column', disabled: !actions.nextColumn, title: actions.reason || 'Alt+Right · move to next sibling column', onSelect: () => { setContextMenu(null); runColumnRowCommand('next') } }} />
              <CanvasContextMenuCommand command={{ label: 'Move to ancestor container', disabled: !actions.ancestor, title: actions.reason || 'Alt+Shift+Up · move to enclosing container or board canvas', onSelect: () => { setContextMenu(null); runColumnRowCommand('ancestor') } }} />
              <CanvasContextMenuCommand command={{ label: 'Detach from column', disabled: !actions.detach, title: actions.reason || 'Keep this row in place as a free object', onSelect: () => { setContextMenu(null); runColumnRowCommand('detach') } }} />
            </> : null
          })()}
          {(() => {
            const inContainer = !columnRowActionState(board, selectedIds, { readOnly: viewOnly }).visible && selectedIds.some((id) => Boolean(board.nodes.find((n) => n.id === id)?.groupId))
            return inContainer ? <>
              <span className="context-section">Container</span>
              <CanvasContextMenuCommand command={{ label: 'Move to ancestor container', disabled: viewOnly, title: 'Alt+Shift+Up · move to enclosing container or board canvas', onSelect: () => { setContextMenu(null); runColumnRowCommand('ancestor') } }} />
            </> : null
          })()}
          {contextNode && contextNode.kind !== 'image' && <>
            <span className="context-section">Object</span>
            {(contextNode.kind === 'shape' || contextNode.kind === 'text') && <><button type="button" onClick={() => editContextNode(contextNode)}>Edit</button><button type="button" onClick={() => { setContextMenu(null); void copySelectedSvg().catch((error) => appAlert(`Could not copy SVG: ${String(error)}`)) }}>Copy SVG</button><button type="button" onClick={() => { setContextMenu(null); void copySelectedPng().catch((error) => appAlert(`Could not copy PNG: ${String(error)}`)) }}>Copy PNG</button></>}
            <button type="button" onClick={() => { setContextMenu(null); copySelected() }}>Copy</button><button type="button" onClick={() => { setContextMenu(null); duplicateSelected() }}>Duplicate</button><button type="button" onClick={() => { setContextMenu(null); void exportSelectionSvg().catch((error) => appAlert(`Could not export selection: ${String(error)}`)) }}>{contextNode.kind === 'shape' || contextNode.kind === 'text' ? 'Export vector SVG…' : 'Export selection as SVG…'}</button>{contextNode.assetId && <button type="button" onClick={() => { setContextMenu(null); void saveSelectedOriginal(contextNode).catch(error => appAlert(`Could not export original: ${String(error)}`)) }}>Export original {contextNode.kind} file…</button>}{isFrameNode(contextNode) && <button type="button" onClick={() => { setContextMenu(null); setBoardExportTarget('frame'); setShowDiagramStructure(false); setShowBoardExport(true) }}>Export frame as high-resolution image…</button>}
            {(contextNode.kind === 'shape' || contextNode.kind === 'text') && <><span className="context-section">Layer</span><button type="button" onClick={() => { setContextMenu(null); changeLayer(1) }}>Bring to front</button><button type="button" onClick={() => { setContextMenu(null); changeLayer(-1) }}>Send to back</button></>}
          </>}
          {selectedIds.length > 1 && <>
            <span className="context-section">Group</span><button type="button" onClick={() => { setContextMenu(null); groupSelected() }}>Group selected</button><button type="button" onClick={() => { setContextMenu(null); flattenSelected() }}>Flatten selected</button>
            <span className="context-section">Arrange</span><button type="button" onClick={() => { setContextMenu(null); packSelected() }}>Pack selection into grid</button><button type="button" onClick={() => { setContextMenu(null); normalizeImageSizes() }}>Match image widths</button>
            <span className="context-section">Align</span><button type="button" onClick={() => { setContextMenu(null); alignSelected('left') }}>Align left</button><button type="button" onClick={() => { setContextMenu(null); alignSelected('center') }}>Align horizontal center</button><button type="button" onClick={() => { setContextMenu(null); alignSelected('right') }}>Align right</button><button type="button" onClick={() => { setContextMenu(null); alignSelected('top') }}>Align top</button><button type="button" onClick={() => { setContextMenu(null); alignSelected('middle') }}>Align vertical middle</button><button type="button" onClick={() => { setContextMenu(null); alignSelected('bottom') }}>Align bottom</button><button type="button" onClick={() => { setContextMenu(null); distributeSelected('horizontal') }}>Distribute horizontally</button><button type="button" onClick={() => { setContextMenu(null); distributeSelected('vertical') }}>Distribute vertically</button><button type="button" onClick={() => { setContextMenu(null); distributeSelected('horizontal', 'gaps') }}>Equal horizontal gaps</button><button type="button" onClick={() => { setContextMenu(null); distributeSelected('vertical', 'gaps') }}>Equal vertical gaps</button><button type="button" onClick={() => { setContextMenu(null); packSelected(2) }}>Pack into two rows</button>
            <span className="context-section">Export</span><button type="button" onClick={() => { setContextMenu(null); void exportSelectionSvg().catch((error) => appAlert(`Could not export selection: ${String(error)}`)) }}>Export selection SVG…</button><button type="button" onClick={() => { setContextMenu(null); void exportSelectedPng().catch((error) => appAlert(`Could not export selection: ${String(error)}`)) }}>Export selection PNG…</button><button type="button" onClick={() => { setContextMenu(null); downloadSelectedAssets() }}>Download source assets</button><button type="button" className="context-danger" onClick={() => { setContextMenu(null); deleteSelected() }}>Move selection to Trash</button>
          </>}
          {!contextMenu.nodeId && <>
            <span className="context-section">Canvas</span>
            <button type="button" onClick={() => { setContextMenu(null); void pasteSystemClipboard() }}>Paste</button>
            <button type="button" onClick={() => { setContextMenu(null); onImport('image') }}>Import image…</button>
            <button type="button" onClick={() => { setContextMenu(null); onImport('video') }}>Import video…</button>
            <button type="button" onClick={() => { setContextMenu(null); onImport('model') }}>Import 3D model…</button>
            <button type="button" onClick={() => { setContextMenu(null); onImport('document') }}>Import document…</button>
            <span className="context-section">Create</span>
            <button type="button" onClick={() => { setContextMenu(null); addNoteNode() }}>Add note</button>
            <button type="button" onClick={() => { setContextMenu(null); addTextNode() }}>Add text</button>
            <button type="button" onClick={() => { setContextMenu(null); groupSelected({ title: 'Frame', width: 640, height: 360 }) }}>Add frame</button>
            <button type="button" onClick={() => { setContextMenu(null); addColumnNode() }}>Add column</button>
            <button type="button" onClick={() => { setContextMenu(null); addNodeColumnNode() }}>Add Node Column</button>
            <span className="context-section">View</span>
            <button type="button" onClick={() => { setContextMenu(null); setShowColor(false); setShowGridSettings(true) }}>Grid & canvas settings…</button>
            <button type="button" onClick={() => { setContextMenu(null); setShowDiagramStructure(false); setShowBoardExport(true) }}>Export board…</button><button type="button" onClick={() => { setContextMenu(null); fitBoard() }}>Fit board</button><button type="button" onClick={() => { setContextMenu(null); setGrayscalePreview((enabled) => !enabled) }}>Toggle grayscale</button>
            <span className="context-section">Arrange</span>
            <CanvasContextMenuCommand command={{ label: 'Pack into grid', onSelect: () => { setContextMenu(null); compactPack() } }} />
          </>}
          {contextMenu.nodeId && selectedIds.length <= 1 && !(contextNode?.kind === 'board-link' && contextNode.boardPortal) && <CanvasContextMenuCommand command={{ label: contextNode?.kind === 'board-link' ? 'Move shortcut to Trash' : 'Move to Trash', danger: true, onSelect: () => { setContextMenu(null); void deleteSelected() } }} />}
        </CanvasContextMenuSurface>}
        {tileAppearance && (() => { const appearanceBoard = boards.find((entry) => entry.id === tileAppearance.boardId); if (!appearanceBoard) return null; return <TileAppearancePopover board={appearanceBoard} coverUrl={coverUrl(appearanceBoard)} position={{ x: tileAppearance.x, y: tileAppearance.y }} onUpdate={(update) => onUpdateBoardTile(appearanceBoard.id, update)} onChooseImage={() => onEditBoardImage(appearanceBoard.id)} onClose={() => setTileAppearance(null)} /> })()}
      </div>
      {showFilmstrip && <section className="board-filmstrip" aria-label="Board filmstrip">
        <header><div className="filmstrip-heading"><strong>Root boards</strong><span>{boards.filter((entry) => !entry.parentBoardId).length} in this project</span></div>
          <BoardActionsMenu>
            <button type="button" disabled={viewOnly} onClick={onCreateBoard}>＋ Root board</button>
            <button type="button" disabled={viewOnly} onClick={addNestedBoardPortal}>＋ Board inside</button>
            <button type="button" disabled={viewOnly} onClick={onDuplicateBoard}>Duplicate</button>
            <button type="button" disabled={viewOnly} onClick={() => onEditBoardImage(board.id)}>Assign image</button>
            {board.coverAssetId && <button type="button" disabled={viewOnly} onClick={() => onSetCover(undefined)}>Remove image</button>}
            <button className="danger" type="button" disabled={viewOnly || boards.length <= 1} onClick={onDeleteBoard}>Delete board</button>
          </BoardActionsMenu>
        </header>
        <div className="filmstrip-track">{boards.filter((entry) => !entry.parentBoardId).map((entry) => {
          const preview = coverUrl(entry)
          return <article className={`filmstrip-board ${entry.id === board.id ? 'active' : ''} ${draggedBoardId === entry.id ? 'dragging' : ''}`} style={{ borderLeftColor: entry.tileAccentColor }} key={entry.id} draggable onDragStart={() => setDraggedBoardId(entry.id)} onDragEnd={() => setDraggedBoardId(null)} onDragOver={(event) => event.preventDefault()} onDrop={() => dropFilmstripBoard(entry.id)}>
            <button className="filmstrip-cover cover-assignment" type="button" disabled={viewOnly} aria-label={`${preview ? 'Change' : 'Assign'} image for board ${entry.title}`} title="Assign a board cover image" onClick={() => onEditBoardImage(entry.id)}>{preview ? <img src={preview} alt="" draggable={false} onError={event => { const coverAsset=assetById.get(entry.coverAssetId || ''); const original = workspaceAssetUrl(workspaceRoot, coverAsset?.status==='moved'?coverAsset.managedRelativePath || coverAsset.relativePath:coverAsset?.relativePath); if (original && event.currentTarget.src !== original) event.currentTarget.src = original }} style={{ objectPosition: `${entry.coverFraming?.x ?? 50}% ${entry.coverFraming?.y ?? 50}%`, transform: `scale(${entry.coverFraming?.zoom || 1})`, transformOrigin: `${entry.coverFraming?.x ?? 50}% ${entry.coverFraming?.y ?? 50}%` }} /> : <span className="cover-assignment-empty"><span aria-hidden="true">＋</span><small>Assign image</small></span>}</button>
            <button className="filmstrip-open-board" type="button" aria-label={`Open board ${entry.title}`} onClick={() => switchFilmstripBoard(entry.id)} onDoubleClick={() => onRenameBoard(entry)}>
              <span className="filmstrip-caption"><strong>{entry.title}</strong><small>{entry.nodes.length} cards · {entry.connectors.length} links</small></span>
            </button>
          </article>
        })}<button className="filmstrip-add" type="button" aria-label="Create new board from filmstrip" disabled={viewOnly} onClick={onCreateBoard}><span>＋</span><small>New board</small></button></div>
      </section>}
      {captureEditor && <Suspense fallback={null}><CaptureEditorDialog initialValue={captureEditor.initialValue} mediaLabel={captureEditor.assetId ? assetById.get(captureEditor.assetId)?.displayName : undefined} onSave={saveCapture} onClose={() => setCaptureEditor(null)} onRequestText={onRequestText} /></Suspense>}
    </section>
  )
}

function constrainShapePoint(source: BoardPoint, target: BoardPoint, kind: ShapeType, constrained: boolean): BoardPoint {
  if (!constrained) return target
  const dx = target.x - source.x
  const dy = target.y - source.y
  if (kind === 'rectangle' || kind === 'ellipse') {
    const size = Math.max(Math.abs(dx), Math.abs(dy))
    return { x: source.x + Math.sign(dx || 1) * size, y: source.y + Math.sign(dy || 1) * size }
  }
  const angle = Math.atan2(dy, dx)
  const snapped = Math.round(angle / (Math.PI / 4)) * (Math.PI / 4)
  const distance = Math.hypot(dx, dy)
  return { x: source.x + Math.cos(snapped) * distance, y: source.y + Math.sin(snapped) * distance }
}

function drawnShapeNode(id: string, shapeType: ShapeType, source: BoardPoint, target: BoardPoint): BoardNode {
  const x = Math.min(source.x, target.x)
  const y = Math.min(source.y, target.y)
  const width = Math.max(2, Math.abs(target.x - source.x))
  const height = Math.max(2, Math.abs(target.y - source.y))
  return { id, kind: 'shape', shapeType, ...(shapeType === 'arrow' ? { arrowMotion: { enabled: true, speed: 'normal' as const, direction: 'forward' as const, style: 'flow' as const } } : {}), x: Math.round(x), y: Math.round(y), width: Math.round(width), height: Math.round(height), title: shapeType === 'arrow' ? 'Animated arrow' : shapeType === 'line' ? 'Line' : shapeType === 'ellipse' ? 'Ellipse' : 'Rectangle', body: (shapeType === 'line' || shapeType === 'arrow') && (target.x - source.x) * (target.y - source.y) < 0 ? 'reverse' : '', color: '#7896b0', strokeColor: '#d4ebff', textColor: '#f1f4f6', strokeWidth: 3, cornerRadius: 12, opacity: 1 }
}

function loadImage(source: string) {
  return new Promise<HTMLImageElement>((resolve, reject) => {
    const image = new Image()
    image.onload = () => resolve(image)
    image.onerror = () => reject(new Error('Could not read the original image'))
    image.src = source
  })
}

function drawCompositionOverlay(context: CanvasRenderingContext2D, overlay: ImageTransform['overlay'], width: number, height: number) {
  if (!overlay) return
  context.save()
  context.strokeStyle = '#ffffffbb'; context.lineWidth = Math.max(1, Math.round(Math.min(width, height) / 700)); context.setLineDash([7, 5])
  if (overlay === 'thirds') { [1 / 3, 2 / 3].forEach((value) => { context.beginPath(); context.moveTo(width * value, 0); context.lineTo(width * value, height); context.moveTo(0, height * value); context.lineTo(width, height * value); context.stroke() }) }
  if (overlay === 'center') { context.beginPath(); context.moveTo(width / 2, 0); context.lineTo(width / 2, height); context.moveTo(0, height / 2); context.lineTo(width, height / 2); context.stroke() }
  if (overlay === 'diagonals') { context.beginPath(); context.moveTo(0, 0); context.lineTo(width, height); context.moveTo(width, 0); context.lineTo(0, height); context.stroke() }
  if (overlay === 'golden') { const ratio = .618; context.beginPath(); context.moveTo(width * ratio, 0); context.lineTo(width * ratio, height); context.moveTo(0, height * ratio); context.lineTo(width, height * ratio); context.stroke() }
  context.restore()
}

function cssBlendMode(mode: GlobalCompositeOperation | undefined): React.CSSProperties['mixBlendMode'] {
  return mode === 'source-over' || !mode ? 'normal' : mode as React.CSSProperties['mixBlendMode']
}

function CompositionOverlay({ overlay }: { overlay?: ImageTransform['overlay'] }) {
  if (!overlay) return null
  return <svg className={`composition-overlay overlay-${overlay}`} viewBox="0 0 100 100" preserveAspectRatio="none" aria-label={`${overlay} composition overlay`}>
    {overlay === 'thirds' && <><path d="M33.333 0V100M66.667 0V100M0 33.333H100M0 66.667H100" /></>}
    {overlay === 'golden' && <><path d="M61.8 0V100M0 61.8H100" /><rect x="0" y="0" width="61.8" height="61.8" rx="30.9" /></>}
    {overlay === 'center' && <path d="M50 0V100M0 50H100" />}
    {overlay === 'diagonals' && <path d="M0 0L100 100M100 0L0 100" />}
  </svg>
}

function CanvasResourceDiagnostics() {
  useSyncExternalStore(listener => canvasResourceBudget.subscribe(listener), () => canvasResourceBudget.snapshot().version)
  const resources = canvasResourceBudget.snapshot()
  const vectors = vectorGeometryCache.snapshot()
  return <>
    <div><dt>Managed resources</dt><dd>≈ {formatBytes(resources.bytes)} / {formatBytes(resources.limit)}</dd></div>
    <div><dt>Tile atlases</dt><dd>≈ {formatBytes(resources.pools['tile-atlas'].bytes)} / {formatBytes(resources.pools['tile-atlas'].limit)}</dd></div>
    <div><dt>Tile surfaces</dt><dd>≈ {formatBytes(resources.pools['tile-surface'].bytes)} / {formatBytes(resources.pools['tile-surface'].limit)}</dd></div>
    <div><dt>Retained cache</dt><dd>≈ {formatBytes(resources.pools.retained.bytes)} / {formatBytes(resources.pools.retained.limit)}</dd></div>
    <div><dt>Vector geometry</dt><dd>≈ {formatBytes(vectors.bytes)} / {formatBytes(vectors.limit)} · {vectors.entries} LOD entr{vectors.entries === 1 ? 'y' : 'ies'}</dd></div>
    <div><dt>Cache pressure</dt><dd>{resources.evictions} evicted · {resources.denied} denied</dd></div>
  </>
}

function formatBytes(bytes: number) {
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
}

type ConnectorLayerProps = {
  board: BoardModel
  selectedId: string | null
  preview: { id: string; end: 'source' | 'target'; point: BoardPoint } | null
  draft: { source: BoardPoint; target: BoardPoint } | null
  onSelect: (id: string) => void
  onEndpointPointerDown: (event: React.PointerEvent<SVGCircleElement>, connector: BoardConnector, end: 'source' | 'target') => void
  onBendPointerDown: (event: React.PointerEvent<SVGCircleElement>, connector: BoardConnector, index: number) => void
  onLabelPointerDown: (event: React.PointerEvent<SVGGElement>, connector: BoardConnector) => void
  onAddBend: (event: React.MouseEvent<SVGPathElement>, connector: BoardConnector) => void
  onRemoveBend: (connector: BoardConnector, index: number) => void
  readOnly: boolean
}

function ConnectorLayer({ board, selectedId, preview, draft, readOnly, onSelect, onEndpointPointerDown, onBendPointerDown, onLabelPointerDown, onAddBend, onRemoveBend }: ConnectorLayerProps) {
  const connectorLayerRef = useRef<SVGSVGElement>(null)
  const visibleConnections = useMemo(() => {
    const result = visibleDiagramNodeIds(board.nodes), ids = new Set(result.ok ? result.value : [])
    return board.connectors.filter((edge) => (!edge.sourceId || ids.has(edge.sourceId)) && (!edge.targetId || ids.has(edge.targetId)))
  }, [board.nodes, board.connectors])
  // The active connection's handles must win hit testing over overlapping
  // routes. SVG paint order also determines pointer targeting.
  const orderedConnectors = useMemo(() => selectedId
    ? [...visibleConnections.filter((connector) => connector.id !== selectedId), ...visibleConnections.filter((connector) => connector.id === selectedId)]
    : visibleConnections, [visibleConnections, selectedId])
  const geometries = useMemo(() => {
    const nodes = new Map(board.nodes.map((node) => [node.id, node]))
    return new Map(board.connectors.map((connector) => {
      const endpoints = [nodes.get(connector.sourceId || ''), nodes.get(connector.targetId || '')].filter((node): node is BoardNode => !!node)
      return [connector.id, connectorGeometry(connector, endpoints)]
    }))
  }, [board.nodes, board.connectors])
  useLayoutEffect(() => {
    const layer = connectorLayerRef.current
    if (layer) layer.dataset.geometryBuilds = String(Number(layer.dataset.geometryBuilds || 0) + 1)
  }, [geometries])
  const draftConnector: BoardConnector | null = draft ? {
    id: 'draft',
    sourcePoint: draft.source,
    targetPoint: draft.target,
    sourcePort: 'right',
    targetPort: 'left',
    style: 'curve',
    color: '#58c8c1',
    width: 2,
    dashed: false,
    startArrow: false,
    endArrow: true,
    animated: true,
  } : null
  return <svg className="connector-layer" ref={connectorLayerRef} aria-label="Board connections" overflow="visible">
    <defs>
      {board.connectors.map((connector) => <marker key={connector.id} id={`arrow-${connector.id}`} markerWidth="8" markerHeight="8" refX="7" refY="4" orient="auto-start-reverse" markerUnits="strokeWidth"><path d="M 0 0 L 8 4 L 0 8 z" fill={connector.color} /></marker>)}
      <marker id="arrow-draft" markerWidth="8" markerHeight="8" refX="7" refY="4" orient="auto" markerUnits="strokeWidth"><path d="M 0 0 L 8 4 L 0 8 z" fill="#58c8c1" /></marker>
    </defs>
    {orderedConnectors.map((connector) => {
      const geometry = preview?.id === connector.id ? connectorGeometry(
        connector,
        board.nodes,
        preview?.id === connector.id && preview.end === 'source' ? preview.point : undefined,
        preview?.id === connector.id && preview.end === 'target' ? preview.point : undefined,
      ) : geometries.get(connector.id)
      if (!geometry) return null
      const selected = selectedId === connector.id
      const labelPoint = connectorLabelPoint(connector, geometry)
      const hitWidth = Math.min(64, Math.max(14, connector.width + 12) / Math.max(0.2, board.viewport.scale))
      const visualStrokeWidth = Math.max(connector.width, 0.75 / board.viewport.scale)
      const endpointRadius = Math.min(20, Math.max(3.5, 7 / board.viewport.scale))
      const bendRadius = Math.min(16, Math.max(3, 6 / board.viewport.scale))
      return <g key={connector.id} data-connector-id={connector.id} data-node-id={connector.relationshipStyle === 'graph-v2' ? connector.id : undefined} data-connector-scale={board.viewport.scale} className={`connector-group ${selected ? 'selected' : ''}`}>
        <path className="connector-hit" d={geometry.path} fill="none" stroke="transparent" strokeWidth={hitWidth} onPointerDown={(event) => { event.preventDefault(); event.stopPropagation(); onSelect(connector.id) }} onDoubleClick={(event) => onAddBend(event, connector)} />
        <path className="connector-path" d={geometry.path} fill="none" stroke={connector.color} strokeWidth={visualStrokeWidth} strokeDasharray={connectorDashArray(connector)} strokeLinecap={connectorLinePattern(connector) === 'dot' ? 'round' : undefined} markerStart={connector.startArrow ? `url(#arrow-${connector.id})` : undefined} markerEnd={connector.endArrow ? `url(#arrow-${connector.id})` : undefined} />
        {connector.animated && <path className="connector-flow" d={geometry.path} fill="none" stroke="#ffffff" strokeWidth={Math.max(1, visualStrokeWidth * .7)} strokeDasharray="2 14" />}
        {connector.label && <g className={`connector-label ${selected && !readOnly ? 'editable' : ''}`} transform={`translate(${labelPoint.x} ${labelPoint.y})`} onPointerDown={(event) => { if (selected && !readOnly) onLabelPointerDown(event, connector); else { event.stopPropagation(); onSelect(connector.id) } }}><rect x={-Math.max(30, connector.label.length * 4.2)} y="-12" width={Math.max(60, connector.label.length * 8.4)} height="24" rx="7" /><text textAnchor="middle" dominantBaseline="central">{connector.label}</text></g>}
        {selected && !readOnly && <>
          <circle className="connector-endpoint" data-endpoint="source" cx={geometry.source.x} cy={geometry.source.y} r={endpointRadius} onPointerDown={(event) => onEndpointPointerDown(event, connector, 'source')} />
          <circle className="connector-endpoint" data-endpoint="target" cx={geometry.target.x} cy={geometry.target.y} r={endpointRadius} onPointerDown={(event) => onEndpointPointerDown(event, connector, 'target')} />
          {connector.style === 'elbow' && connector.bendPoints?.map((point, index) => <circle key={index} className="connector-bend" data-bend-index={index} cx={point.x} cy={point.y} r={bendRadius} onPointerDown={(event) => onBendPointerDown(event, connector, index)} onDoubleClick={(event) => { event.preventDefault(); event.stopPropagation(); onRemoveBend(connector, index) }}><title>Drag waypoint; double-click to remove</title></circle>)}
        </>}
      </g>
    })}
    {draftConnector && (() => { const geometry = connectorGeometry(draftConnector, []); return geometry ? <g className="connector-group draft"><path className="connector-path" d={geometry.path} fill="none" stroke={draftConnector.color} strokeWidth="2" markerEnd="url(#arrow-draft)" /><path className="connector-flow" d={geometry.path} fill="none" stroke="#fff" strokeWidth="1.4" strokeDasharray="2 14" /></g> : null })()}
  </svg>
}

export default App

