/**
 * Art Equation Canvas Engine - Model Context Protocol (MCP) Core
 *
 * Exposes the complete internal engine capabilities and semantic board commands
 * to AI pair programmers, agents, and IDE workflows (Codex, Claude, Antigravity):
 *
 * Core WASM & Telemetry Tools:
 *  1. engine_get_status: WASM renderer health, font registration, memory budget
 *  2. engine_shape_freeform_text: FreeformTextTool layout, HarfBuzz shaping, ports
 *  3. engine_query_image_registry: Active textures, memory consumption vs 64 MiB
 *  4. engine_register_image: Canonical sRGB premultiplied texture registration
 *  5. engine_calculate_connector: Straight, elbow, and cubic Bézier route generation
 *  6. engine_validate_display_list: Display List v2 format & paint payload verification
 *  7. engine_render_snapshot: Native Vello CPU WASM snapshot rendering & benchmarking
 *
 * Semantic AI Board Commands (matching AI_TOOL_CONTRACTS.json):
 *  8.  engine_create_card: Create card entity with typed ports & frame binding
 *  9.  engine_import_media: Register media asset with intrinsic aspect metadata
 *  10. engine_set_media_fit: Uniform aspect-ratio fit mode (contain/cover/crop/native)
 *  11. engine_add_port: Add typed socket handle to card (reference, continuity, branch)
 *  12. engine_connect_ports: Validate and commit typed semantic edge
 *  13. engine_create_frame: Create collapsible scope container enclosing cards
 *  14. engine_layout_selection: Semantic layout (row, column, grid, continuity)
 *  15. engine_align: Screen-space alignment (start, center, end)
 *  16. engine_distribute: Equal-gap distribution along axis
 *  17. engine_create_branch: Create alternative continuity branch with connector
 *  18. engine_attach_video_range: Annotate video card with clip timestamp range
 *  19. engine_convert_text_to_board: Deterministic document tree to board converter
 *  20. engine_trace_provenance: Graph traversal tracing causal lineage of a node
 *  21. engine_snapshot_board: Transactional named snapshot of board state
 *  22. engine_export_region: High-resolution rasterization using original assets
 */

import { readFile, writeFile } from 'node:fs/promises'
import { URL } from 'node:url'
import { execFileSync } from 'node:child_process'
import { layoutFreeformText } from '../../src/board/freeformTextTool.ts'
import { calculateMediaFit } from '../../src/board/mediaEngine.ts'
import type { MediaAsset, MediaPlacement } from '../../src/board/mediaEngine.ts'
import {
  computePortPosition,
  validatePortConnection,
  createStandardCardPorts
} from '../../src/board/cardPorts.ts'
import type { CardPort } from '../../src/board/cardPorts.ts'
import {
  computeEdgeRoute,
  createEdgeRenderOps
} from '../../src/board/graphConnectors.ts'
import type { GraphEdge } from '../../src/board/graphConnectors.ts'
import { ScreenSpaceSnapManager } from '../../src/board/snapManager.ts'
import type { Rect } from '../../src/board/snapManager.ts'
import { fitFrameToChildren, createFrameRenderOps } from '../../src/board/frameScopes.ts'
import type { BoardFrame } from '../../src/board/frameScopes.ts'
import { formatTimestamp } from '../../src/board/videoCards.ts'
import type { VideoTimeRange } from '../../src/board/videoCards.ts'

export const MAX_IMAGE_BYTES = 64 * 1024 * 1024 // 64 MiB strict engine ceiling

export interface RegisteredImageMeta {
  id: string
  width: number
  height: number
  bytes: number
  epoch: number
}

export interface BoardCardEntity {
  id: string
  type: 'card' | 'text' | 'image' | 'video' | 'cluster'
  title: string
  content: any
  frameId: string | null
  bounds: Rect
  ports: CardPort[]
  mediaPlacement?: MediaPlacement
  videoMetadata?: any
  timeRanges?: VideoTimeRange[]
}

export interface EngineMcpState {
  wasmInitialized: boolean
  renderer: any | null
  textEngine: any | null
  registeredImages: Map<string, RegisteredImageMeta>
  totalImageBytes: number
  activeEpoch: number
  fonts: string[]
  // Semantic Board Store
  cards: Map<string, BoardCardEntity>
  mediaAssets: Map<string, MediaAsset>
  ports: Map<string, CardPort>
  edges: Map<string, GraphEdge>
  frames: Map<string, BoardFrame>
  snapshots: Map<string, any>
  snapManager: ScreenSpaceSnapManager
}

import { normalizeColor8 } from '../../src/board/colorUtils.ts'
export { normalizeColor8 }

export function normalizeDisplayListOp(op: any, index: number): any {
  if (!op || typeof op !== 'object') {
    throw new Error(`Operation at index ${index} must be an object`)
  }

  if (op.fill !== undefined || op.stroke !== undefined) {
    throw new Error(`Operation at index ${index} places paint properties at root level instead of payload`)
  }

  // Already a canonical Display List v2 operation
  if (
    op.type === 'vector' ||
    op.type === 'image' ||
    op.type === 'gradient' ||
    op.type === 'blurredRoundedRect' ||
    op.type === 'pushClip' ||
    op.type === 'pushComposite' ||
    op.type === 'pop'
  ) {
    return op
  }

  // Shorthand draw_rect
  if (op.op === 'draw_rect') {
    const { x = 0, y = 0, width = 0, height = 0, fill = '#00000000', stroke = '#00000000', strokeWidth = 0, opacity = 1.0 } = op.payload || {}
    const commands = [
      ['M', x, y],
      ['L', x + width, y],
      ['L', x + width, y + height],
      ['L', x, y + height],
      ['Z']
    ]
    return {
      type: 'vector',
      object: {
        id: `rect-${index}`,
        kind: 'vector',
        bounds: { x, y, width, height },
        visible: true,
        opacity,
        blendMode: 'normal',
        payload: {
          commands,
          fill: normalizeColor8(fill),
          stroke: normalizeColor8(stroke),
          strokeWidth,
          vectorFillRule: 'nonzero'
        },
        transform: [1, 0, 0, 1, 0, 0]
      }
    }
  }

  // Shorthand draw_rounded_rect
  if (op.op === 'draw_rounded_rect') {
    const { x = 0, y = 0, width = 0, height = 0, radius = 8, fill = '#00000000', stroke = '#00000000', strokeWidth = 0, opacity = 1.0 } = op.payload || {}
    const r = Math.min(radius, width / 2, height / 2)
    const commands = [
      ['M', x + r, y],
      ['L', x + width - r, y],
      ['C', x + width - r * 0.45, y, x + width, y + r * 0.45, x + width, y + r],
      ['L', x + width, y + height - r],
      ['C', x + width, y + height - r * 0.45, x + width - r * 0.45, y + height, x + width - r, y + height],
      ['L', x + r, y + height],
      ['C', x + r * 0.45, y + height, x, y + height - r * 0.45, x, y + height - r],
      ['L', x, y + r],
      ['C', x, y + r * 0.45, x + r * 0.45, y, x + r, y],
      ['Z']
    ]
    return {
      type: 'vector',
      object: {
        id: `rrect-${index}`,
        kind: 'vector',
        bounds: { x, y, width, height },
        visible: true,
        opacity,
        blendMode: 'normal',
        payload: {
          commands,
          fill: normalizeColor8(fill),
          stroke: normalizeColor8(stroke),
          strokeWidth,
          vectorFillRule: 'nonzero'
        },
        transform: [1, 0, 0, 1, 0, 0]
      }
    }
  }

  // Shorthand draw_circle
  if (op.op === 'draw_circle') {
    const { cx = 0, cy = 0, radius = 0, fill = '#00000000', stroke = '#00000000', strokeWidth = 0, opacity = 1.0 } = op.payload || {}
    const k = 0.5522847498 * radius
    const commands = [
      ['M', cx, cy - radius],
      ['C', cx + k, cy - radius, cx + radius, cy - k, cx + radius, cy],
      ['C', cx + radius, cy + k, cx + k, cy + radius, cx, cy + radius],
      ['C', cx - k, cy + radius, cx - radius, cy + k, cx - radius, cy],
      ['C', cx - radius, cy - k, cx - k, cy - radius, cx, cy - radius],
      ['Z']
    ]
    return {
      type: 'vector',
      object: {
        id: `circle-${index}`,
        kind: 'vector',
        bounds: { x: cx - radius, y: cy - radius, width: radius * 2, height: radius * 2 },
        visible: true,
        opacity,
        blendMode: 'normal',
        payload: {
          commands,
          fill: normalizeColor8(fill),
          stroke: normalizeColor8(stroke),
          strokeWidth,
          vectorFillRule: 'nonzero'
        },
        transform: [1, 0, 0, 1, 0, 0]
      }
    }
  }

  // Shorthand draw_path
  if (op.op === 'draw_path') {
    const { commands = [], path, fill = '#00000000', stroke = '#00000000', strokeWidth = 0, opacity = 1.0, bounds = { x: 0, y: 0, width: 100, height: 100 } } = op.payload || {}
    return {
      type: 'vector',
      object: {
        id: `path-${index}`,
        kind: 'vector',
        bounds,
        visible: true,
        opacity,
        blendMode: 'normal',
        payload: {
          commands,
          path,
          fill: normalizeColor8(fill),
          stroke: normalizeColor8(stroke),
          strokeWidth,
          vectorFillRule: 'nonzero'
        },
        transform: [1, 0, 0, 1, 0, 0]
      }
    }
  }

  throw new Error(`Unsupported operation format at index ${index}`)
}

export const MCP_TOOLS_MANIFEST = [
  // --- Low-Level Engine Tools ---
  {
    name: 'engine_get_status',
    description: 'Inspect Canvas Engine status, Vello CPU WASM pipeline state, HarfBuzz text shaping, and 64 MiB texture memory telemetry.',
    inputSchema: { type: 'object', properties: {}, required: [] }
  },
  {
    name: 'engine_shape_freeform_text',
    description: 'Shape, wrap, and layout freeform floating text at arbitrary world coordinates. Computes HarfBuzz-accurate line metrics, outer bounds, connector ports, and Display List v2 operations.',
    inputSchema: {
      type: 'object',
      properties: {
        id: { type: 'string', description: 'Unique identifier for the text node' },
        text: { type: 'string', description: 'The text content to layout and shape' },
        x: { type: 'number', description: 'X coordinate on the infinite canvas' },
        y: { type: 'number', description: 'Y coordinate on the infinite canvas' },
        maxWidth: { type: 'number', description: 'Optional maximum width before soft wrapping lines' },
        style: { type: 'object' },
        backdrop: { type: 'object' },
        includeOperations: { type: 'boolean' }
      },
      required: ['text', 'x', 'y']
    }
  },
  {
    name: 'engine_query_image_registry',
    description: 'Query the canvas engine decoded texture registry: active textures, memory breakdown, and headroom against the strict 64 MiB limit.',
    inputSchema: { type: 'object', properties: {}, required: [] }
  },
  {
    name: 'engine_register_image',
    description: 'Register a raw RGBA8 texture into the native B4CpuRenderer image registry with canonical sRGB premultiplied alpha verification.',
    inputSchema: {
      type: 'object',
      properties: {
        id: { type: 'string', description: 'Image resource identifier (e.g. image__16_)' },
        width: { type: 'number', description: 'Width of the image in pixels' },
        height: { type: 'number', description: 'Height of the image in pixels' },
        rgbaBase64: { type: 'string', description: 'Base64-encoded raw RGBA8 pixel bytes' },
        filePath: { type: 'string', description: 'Alternative: absolute file path to a raw .rgba binary file' },
        epoch: { type: 'number', description: 'Resource epoch (default 1)' }
      },
      required: ['id', 'width', 'height']
    }
  },
  {
    name: 'engine_calculate_connector',
    description: 'Compute vector connector geometry between two nodes or points with support for straight lines, orthogonal elbows, and fluid cubic Bézier curves.',
    inputSchema: {
      type: 'object',
      properties: {
        source: { type: 'object', properties: { x: { type: 'number' }, y: { type: 'number' } }, required: ['x', 'y'] },
        target: { type: 'object', properties: { x: { type: 'number' }, y: { type: 'number' } }, required: ['x', 'y'] },
        style: { type: 'string', enum: ['straight', 'elbow', 'bezier'] },
        color: { type: 'string' },
        width: { type: 'number' },
        arrow: { type: 'boolean' }
      },
      required: ['source', 'target']
    }
  },
  {
    name: 'engine_validate_display_list',
    description: 'Validate a JSON Display List v2 payload against schema rules and memory constraints before submission to the native renderer.',
    inputSchema: {
      type: 'object',
      properties: {
        displayList: { type: 'array', description: 'Array of Display List v2 operations' }
      },
      required: ['displayList']
    }
  },
  {
    name: 'engine_render_snapshot',
    description: 'Render a Display List v2 payload directly into an RGBA8 frame buffer using the native Vello CPU WASM engine and optionally save to PNG.',
    inputSchema: {
      type: 'object',
      properties: {
        width: { type: 'number', description: 'Target viewport width' },
        height: { type: 'number', description: 'Target viewport height' },
        displayList: { type: 'array', description: 'Array of Display List v2 operations' },
        scale: { type: 'number', description: 'Canvas zoom factor (default 1.0)' },
        panX: { type: 'number', description: 'Horizontal pan offset' },
        panY: { type: 'number', description: 'Vertical pan offset' },
        exportPngPath: { type: 'string', description: 'Optional absolute path to write the rendered image as PNG' }
      },
      required: ['width', 'height', 'displayList']
    }
  },

  // --- Semantic AI Board Commands (AI_TOOL_CONTRACTS.json) ---
  {
    name: 'engine_create_card',
    description: 'Semantic AI Command: Create a card entity with typed ports, role, dimensions, and optional frame container binding.',
    inputSchema: {
      type: 'object',
      properties: {
        id: { type: 'string' },
        type: { type: 'string', enum: ['continuity', 'branch', 'reference', 'identity', 'video', 'general'] },
        title: { type: 'string' },
        content: { type: 'object' },
        frameId: { type: ['string', 'null'] },
        position: { type: 'object', properties: { x: { type: 'number' }, y: { type: 'number' } }, required: ['x', 'y'] },
        size: { type: 'object', properties: { width: { type: 'number' }, height: { type: 'number' } } }
      },
      required: ['type', 'title', 'position']
    }
  },
  {
    name: 'engine_import_media',
    description: 'Semantic AI Command: Register media asset with intrinsic width/height, original URI, and proxy ladder.',
    inputSchema: {
      type: 'object',
      properties: {
        assetId: { type: 'string' },
        uri: { type: 'string' },
        intrinsicWidth: { type: 'number' },
        intrinsicHeight: { type: 'number' },
        metadata: { type: 'object' }
      },
      required: ['uri', 'intrinsicWidth', 'intrinsicHeight']
    }
  },
  {
    name: 'engine_set_media_fit',
    description: 'Semantic AI Command: Assign uniform aspect-preserving fit mode (contain, cover, crop, native) to a card, guaranteeing zero distortion.',
    inputSchema: {
      type: 'object',
      properties: {
        cardId: { type: 'string' },
        assetId: { type: 'string' },
        mode: { type: 'string', enum: ['contain', 'cover', 'crop', 'native'] },
        cropRect: { type: ['object', 'null'] }
      },
      required: ['cardId', 'mode']
    }
  },
  {
    name: 'engine_add_port',
    description: 'Semantic AI Command: Add a typed socket handle to a card (reference, identity, continuity-in, continuity-out, branch-out, video-time-range).',
    inputSchema: {
      type: 'object',
      properties: {
        cardId: { type: 'string' },
        semanticType: { type: 'string' },
        side: { type: 'string', enum: ['left', 'right', 'top', 'bottom', 'auto'] },
        normalizedOffset: { type: 'number' },
        direction: { type: 'string', enum: ['source', 'target', 'both'] },
        label: { type: 'string' }
      },
      required: ['cardId', 'semanticType']
    }
  },
  {
    name: 'engine_connect_ports',
    description: 'Semantic AI Command: Validate and commit a typed semantic edge between source and target ports.',
    inputSchema: {
      type: 'object',
      properties: {
        sourcePortId: { type: 'string' },
        targetPortId: { type: 'string' },
        edgeKind: { type: 'string', enum: ['continuity', 'branch', 'reference', 'identity', 'evidence', 'transform'] },
        label: { type: ['string', 'null'] },
        routeMode: { type: 'string', enum: ['straight', 'bezier', 'orthogonal', 'manual'] },
        confidence: { type: 'number' }
      },
      required: ['sourcePortId', 'targetPortId']
    }
  },
  {
    name: 'engine_create_frame',
    description: 'Semantic AI Command: Create a collapsible scope container enclosing a set of cards with automatic bounds fitting.',
    inputSchema: {
      type: 'object',
      properties: {
        frameId: { type: 'string' },
        title: { type: 'string' },
        childIds: { type: 'array', items: { type: 'string' } },
        style: { type: 'object' }
      },
      required: ['title']
    }
  },
  {
    name: 'engine_layout_selection',
    description: 'Semantic AI Command: Automatically arrange cards using row, column, grid, or continuity constraints.',
    inputSchema: {
      type: 'object',
      properties: {
        ids: { type: 'array', items: { type: 'string' } },
        preset: { type: 'string', enum: ['row', 'column', 'grid', 'continuity'] },
        spacing: { type: 'number' }
      },
      required: ['ids', 'preset']
    }
  },
  {
    name: 'engine_align',
    description: 'Semantic AI Command: Align cards along an axis (x, y) with mode (start, center, end).',
    inputSchema: {
      type: 'object',
      properties: {
        ids: { type: 'array', items: { type: 'string' } },
        axis: { type: 'string', enum: ['x', 'y'] },
        mode: { type: 'string', enum: ['start', 'center', 'end'] }
      },
      required: ['ids', 'axis', 'mode']
    }
  },
  {
    name: 'engine_distribute',
    description: 'Semantic AI Command: Evenly space cards along an axis with equal gaps.',
    inputSchema: {
      type: 'object',
      properties: {
        ids: { type: 'array', items: { type: 'string' } },
        axis: { type: 'string', enum: ['x', 'y'] },
        gap: { type: ['number', 'null'] }
      },
      required: ['ids', 'axis']
    }
  },
  {
    name: 'engine_create_branch',
    description: 'Semantic AI Command: Create an alternative continuity branch container and connector linked from a parent card.',
    inputSchema: {
      type: 'object',
      properties: {
        fromCardId: { type: 'string' },
        label: { type: 'string' },
        kind: { type: 'string', enum: ['alternative', 'conditional', 'variant'] },
        branchCardTitle: { type: 'string' }
      },
      required: ['fromCardId', 'label']
    }
  },
  {
    name: 'engine_attach_video_range',
    description: 'Semantic AI Command: Attach a specific video clip time range (e.g. videoId@00:15.0-00:19.2) to a card.',
    inputSchema: {
      type: 'object',
      properties: {
        cardId: { type: 'string' },
        assetId: { type: 'string' },
        startSec: { type: 'number' },
        endSec: { type: 'number' },
        label: { type: ['string', 'null'] }
      },
      required: ['cardId', 'assetId', 'startSec', 'endSec']
    }
  },
  {
    name: 'engine_convert_text_to_board',
    description: 'Semantic AI Command: Parse a structured text document into hierarchical frames, cards, and proposed semantic edges.',
    inputSchema: {
      type: 'object',
      properties: {
        text: { type: 'string' },
        origin: { type: 'object', properties: { x: { type: 'number' }, y: { type: 'number' } } },
        preview: { type: 'boolean' }
      },
      required: ['text']
    }
  },
  {
    name: 'engine_trace_provenance',
    description: 'Semantic AI Command: Trace upstream and downstream causal graph slices from a card.',
    inputSchema: {
      type: 'object',
      properties: {
        cardId: { type: 'string' },
        depth: { type: 'number' },
        edgeKinds: { type: ['array', 'null'], items: { type: 'string' } }
      },
      required: ['cardId']
    }
  },
  {
    name: 'engine_snapshot_board',
    description: 'Semantic AI Command: Take a named transactional snapshot of the current board state.',
    inputSchema: {
      type: 'object',
      properties: {
        name: { type: 'string' },
        scope: { type: 'string', enum: ['board', 'selection', 'frame'] },
        ids: { type: ['array', 'null'], items: { type: 'string' } }
      },
      required: ['name']
    }
  },
  {
    name: 'engine_export_region',
    description: 'Semantic AI Command: Export a frame or board region to high-resolution PNG using original assets.',
    inputSchema: {
      type: 'object',
      properties: {
        frameId: { type: ['string', 'null'] },
        selectionIds: { type: ['array', 'null'], items: { type: 'string' } },
        format: { type: 'string', enum: ['png', 'pdf', 'svg'] },
        scale: { type: 'number' },
        exportPath: { type: 'string' }
      },
      required: ['exportPath']
    }
  }
]

export class EngineMcpCore {
  private state: EngineMcpState

  constructor() {
    this.state = {
      wasmInitialized: false,
      renderer: null,
      textEngine: null,
      registeredImages: new Map(),
      totalImageBytes: 0,
      activeEpoch: 1,
      fonts: [],
      cards: new Map(),
      mediaAssets: new Map(),
      ports: new Map(),
      edges: new Map(),
      frames: new Map(),
      snapshots: new Map(),
      snapManager: new ScreenSpaceSnapManager(6, 24)
    }
  }

  async initialize(): Promise<void> {
    if (this.state.wasmInitialized) return

    const wasmModulePath = new URL('../../src/project-b/p0-surface/generated/p0_engine_wasm.js', import.meta.url)
    const wasmBinaryPath = new URL('../../src/project-b/p0-surface/generated/p0_engine_wasm_bg.wasm', import.meta.url)

    const engineModule = await import(wasmModulePath.href)
    await engineModule.default({ module_or_path: await readFile(wasmBinaryPath) })

    this.state.renderer = new engineModule.B4CpuRenderer()
    this.state.textEngine = new engineModule.TextEngine(`mcp-epoch-${Date.now()}`)

    try {
      const arialData = await readFile('C:/Windows/Fonts/arial.ttf')
      this.state.textEngine.register_font('arial', '1', 0, arialData)
      this.state.fonts.push('Arial')
    } catch (_) {}

    try {
      const segoeData = await readFile('C:/Windows/Fonts/segoeui.ttf')
      this.state.textEngine.register_font('segoe', '1', 0, segoeData)
      this.state.fonts.push('Segoe UI')
    } catch (_) {}

    this.state.wasmInitialized = true
  }

  async executeTool(name: string, args: Record<string, any>): Promise<any> {
    await this.initialize()

    switch (name) {
      // WASM / Low-level tools
      case 'engine_get_status':
        return this.getStatus()
      case 'engine_shape_freeform_text':
        return this.shapeFreeformText(args)
      case 'engine_query_image_registry':
        return this.queryImageRegistry()
      case 'engine_register_image':
        return this.registerImage(args)
      case 'engine_calculate_connector':
        return this.calculateConnector(args)
      case 'engine_validate_display_list':
        return this.validateDisplayList(args)
      case 'engine_render_snapshot':
        return this.renderSnapshot(args)

      // Semantic AI Board Commands
      case 'engine_create_card':
        return this.createCard(args)
      case 'engine_import_media':
        return this.importMedia(args)
      case 'engine_set_media_fit':
        return this.setMediaFit(args)
      case 'engine_add_port':
        return this.addPort(args)
      case 'engine_connect_ports':
        return this.connectPorts(args)
      case 'engine_create_frame':
        return this.createFrame(args)
      case 'engine_layout_selection':
        return this.layoutSelection(args)
      case 'engine_align':
        return this.alignSelection(args)
      case 'engine_distribute':
        return this.distributeSelection(args)
      case 'engine_create_branch':
        return this.createBranch(args)
      case 'engine_attach_video_range':
        return this.attachVideoRange(args)
      case 'engine_convert_text_to_board':
        return this.convertTextToBoard(args)
      case 'engine_trace_provenance':
        return this.traceProvenance(args)
      case 'engine_snapshot_board':
        return this.snapshotBoard(args)
      case 'engine_export_region':
        return this.exportRegion(args)

      default:
        throw new Error(`Unknown canvas engine tool: ${name}`)
    }
  }

  private getStatus(): any {
    return {
      status: 'ready',
      engine: 'Art Equation Studio Canvas Engine (p0_engine_wasm)',
      backend: 'Vello CPU Sparse Strips WASM',
      textEngine: 'HarfBuzz / Parley Typography Subsystem',
      registeredFonts: this.state.fonts,
      activeEpoch: this.state.activeEpoch,
      imageRegistry: {
        activeTextures: this.state.registeredImages.size,
        totalBytesUsed: this.state.totalImageBytes,
        totalBytesMax: MAX_IMAGE_BYTES,
        memoryUsagePercent: ((this.state.totalImageBytes / MAX_IMAGE_BYTES) * 100).toFixed(2) + '%',
        remainingBytes: MAX_IMAGE_BYTES - this.state.totalImageBytes
      },
      boardStore: {
        cardsCount: this.state.cards.size,
        portsCount: this.state.ports.size,
        edgesCount: this.state.edges.size,
        framesCount: this.state.frames.size,
        mediaAssetsCount: this.state.mediaAssets.size
      },
      capabilities: [
        'vello_cpu_sparse_strips',
        'display_list_v2',
        'harfbuzz_typography',
        'freeform_floating_text',
        'canonical_premultiplied_rgba8',
        'typed_card_ports',
        'uniform_aspect_safe_media',
        'screen_space_snapping',
        'nested_frame_scopes',
        'video_time_range_annotations',
        'semantic_ai_board_commands'
      ]
    }
  }

  private shapeFreeformText(args: Record<string, any>): any {
    const { id = 'mcp-text-node', text, x, y, maxWidth, style, backdrop, includeOperations = true } = args
    const layout = layoutFreeformText({ id, text, x, y, maxWidth, style, backdrop })
    return {
      id: layout.id,
      bounds: layout.bounds,
      contentBounds: layout.contentBounds,
      ports: layout.ports,
      lines: layout.lines,
      lineCount: layout.lines.length,
      operationsCount: layout.operations.length,
      operations: includeOperations ? layout.operations : undefined
    }
  }

  private queryImageRegistry(): any {
    const items = Array.from(this.state.registeredImages.values())
    return {
      activeTexturesCount: items.length,
      totalBytesUsed: this.state.totalImageBytes,
      maxBudgetBytes: MAX_IMAGE_BYTES,
      remainingBudgetBytes: MAX_IMAGE_BYTES - this.state.totalImageBytes,
      activeEpoch: this.state.activeEpoch,
      textures: items
    }
  }

  private async registerImage(args: Record<string, any>): Promise<any> {
    const { id, width, height, rgbaBase64, filePath, epoch = this.state.activeEpoch } = args

    let buffer: Uint8Array
    if (filePath) {
      buffer = new Uint8Array(await readFile(filePath))
    } else if (rgbaBase64) {
      buffer = new Uint8Array(Buffer.from(rgbaBase64, 'base64'))
    } else {
      throw new Error('Either filePath or rgbaBase64 must be provided')
    }

    const expectedBytes = width * height * 4
    if (buffer.length !== expectedBytes) {
      throw new Error(`Buffer size mismatch: expected ${expectedBytes} bytes (${width}x${height}x4), got ${buffer.length}`)
    }

    // Verify canonical premultiplied RGBA8
    for (let i = 0; i < buffer.length; i += 4) {
      const r = buffer[i]
      const g = buffer[i + 1]
      const b = buffer[i + 2]
      const a = buffer[i + 3]
      if (r > a || g > a || b > a) {
        throw new Error(`Non-premultiplied pixel detected at offset ${i}: R=${r}, G=${g}, B=${b}, A=${a}. Canonical sRGB premultiplied RGBA8 required.`)
      }
    }

    const existing = this.state.registeredImages.get(id)
    const newTotal = this.state.totalImageBytes - (existing ? existing.bytes : 0) + buffer.length
    if (newTotal > MAX_IMAGE_BYTES) {
      throw new Error(`RESOURCE_BUDGET_EXCEEDED: Registration of ${buffer.length} bytes would exceed 64 MiB ceiling (${newTotal} > ${MAX_IMAGE_BYTES})`)
    }

    const ref = {
      key: id,
      revision: 1,
      epoch,
      width,
      height
    }

    this.state.renderer.register_image(JSON.stringify(ref), buffer)
    const meta: RegisteredImageMeta = { id, width, height, bytes: buffer.length, epoch }
    this.state.registeredImages.set(id, meta)
    this.state.totalImageBytes = newTotal

    return {
      ok: true,
      id,
      width,
      height,
      bytes: buffer.length,
      totalRegistryBytes: this.state.totalImageBytes,
      budgetRemainingBytes: MAX_IMAGE_BYTES - this.state.totalImageBytes
    }
  }

  private calculateConnector(args: Record<string, any>): any {
    const { source, target, style = 'bezier', color = '#3b82f6ff', width = 2, arrow = true } = args
    const routeMode = style === 'elbow' ? 'orthogonal' : style
    const route = computeEdgeRoute(source.x, source.y, target.x, target.y, routeMode)

    let pathString = ''
    for (const cmd of route.pathCommands) {
      pathString += (pathString ? ' ' : '') + cmd.join(' ')
    }

    const dummyEdge: any = {
      id: `calc-${Date.now()}`,
      kind: 'reference',
      route: { mode: routeMode },
      style: { stroke: color, strokeWidth: width, showArrow: arrow }
    }
    let opCounter = 1
    const operations = createEdgeRenderOps(dummyEdge, source, target, () => opCounter++)

    return {
      source: { x: source.x, y: source.y },
      target: { x: target.x, y: target.y },
      style,
      path: pathString,
      midpoint: route.midpoint,
      bounds: route.bounds,
      operations
    }
  }

  private validateDisplayList(args: Record<string, any>): any {
    const { displayList } = args
    if (!Array.isArray(displayList)) {
      return { valid: false, opCount: 0, errors: ['displayList must be a JSON array of operations'] }
    }

    const errors: string[] = []
    for (let i = 0; i < displayList.length; i++) {
      const op = displayList[i]
      if (!op || typeof op !== 'object') {
        errors.push(`Operation at index ${i} is not an object`)
        continue
      }
      try {
        normalizeDisplayListOp(op, i)
      } catch (err: any) {
        errors.push(err.message)
      }
    }

    return { valid: errors.length === 0, opCount: displayList.length, errors }
  }

  private async renderSnapshot(args: Record<string, any>): Promise<any> {
    const { width, height, displayList, scale = 1.0, panX = 0.0, panY = 0.0, exportPngPath } = args

    if (typeof width !== 'number' || width <= 0 || typeof height !== 'number' || height <= 0) {
      throw new Error(`Invalid render dimensions: ${width}x${height}`)
    }

    const ops = Array.isArray(displayList) ? displayList : (displayList?.operations || [])
    const normalizedOps = ops.map((op: any, i: number) => normalizeDisplayListOp(op, i))

    const payload = Array.isArray(displayList)
      ? {
          schema: 'art-equation.display-list',
          schemaVersion: 2,
          sceneId: args.sceneId || 'mcp-snapshot-scene',
          revision: '1',
          environment: {
            background: normalizeColor8(args.background || '#181818ff'),
            colorSpace: 'srgb'
          },
          resources: Array.from(this.state.registeredImages.values()).map((meta) => ({
            key: meta.id,
            revision: 1,
            epoch: meta.epoch,
            width: meta.width,
            height: meta.height
          })),
          operations: normalizedOps
        }
      : {
          ...displayList,
          operations: normalizedOps
        }

    const jsonStr = JSON.stringify(payload)
    const t0 = performance.now()
    const buffer = this.state.renderer.render_snapshot(width, height, jsonStr, scale, panX, panY)
    const durationMs = performance.now() - t0

    let nonZeroCount = 0
    for (let i = 0; i < buffer.length; i += 4) {
      if (buffer[i] > 0 || buffer[i + 1] > 0 || buffer[i + 2] > 0 || buffer[i + 3] > 0) {
        nonZeroCount++
      }
    }

    let savedPath: string | undefined = undefined
    if (exportPngPath) {
      const rawTmp = `${exportPngPath}.tmp.rgba`
      await writeFile(rawTmp, Buffer.from(buffer))

      const pyConvert = `
import sys
from PIL import Image

raw_path = sys.argv[1]
png_path = sys.argv[2]
w = int(sys.argv[3])
h = int(sys.argv[4])

with open(raw_path, 'rb') as f:
    raw_data = f.read()

im = Image.frombytes('RGBA', (w, h), raw_data)
im.save(png_path, 'PNG', optimize=True)
`
      const scriptTmp = `${exportPngPath}.convert.py`
      await writeFile(scriptTmp, pyConvert, 'utf8')
      execFileSync('python', [scriptTmp, rawTmp, exportPngPath, String(width), String(height)])
      savedPath = exportPngPath
    }

    return {
      width,
      height,
      durationMs: parseFloat(durationMs.toFixed(2)),
      bufferBytes: buffer.length,
      totalPixels: width * height,
      nonZeroPixels: nonZeroCount,
      nonZeroPercent: ((nonZeroCount / (width * height)) * 100).toFixed(2) + '%',
      exportPngPath: savedPath
    }
  }

  // --- Semantic AI Board Commands Implementation ---

  private createCard(args: Record<string, any>): any {
    const { id = `card-${Date.now()}-${Math.floor(Math.random() * 1000)}`, type, title, content = {}, frameId = null, position, size = { width: 220, height: 160 } } = args
    const bounds: Rect = { x: position.x, y: position.y, width: size.width || 220, height: size.height || 160 }
    const ports = createStandardCardPorts(id, type)

    const card: BoardCardEntity = {
      id,
      type: type || 'general',
      title,
      content,
      frameId,
      bounds,
      ports
    }

    this.state.cards.set(id, card)
    for (const p of ports) {
      this.state.ports.set(p.id, p)
    }

    if (frameId && this.state.frames.has(frameId)) {
      const frame = this.state.frames.get(frameId)!
      if (!frame.childIds.includes(id)) {
        frame.childIds.push(id)
      }
    }

    return { cardId: id, ports: ports.map((p) => ({ id: p.id, type: p.semanticType, side: p.side })) }
  }

  private importMedia(args: Record<string, any>): any {
    const { assetId = `asset-${Date.now()}`, uri, intrinsicWidth, intrinsicHeight, metadata = {} } = args
    const asset: MediaAsset = {
      assetId,
      originalUri: uri,
      intrinsicWidth,
      intrinsicHeight,
      proxyUris: metadata.proxyUris,
      video: metadata.video
    }
    this.state.mediaAssets.set(assetId, asset)
    return { assetId, intrinsicWidth, intrinsicHeight, aspect: intrinsicWidth / intrinsicHeight }
  }

  private setMediaFit(args: Record<string, any>): any {
    const { cardId, assetId, mode = 'contain', cropRect = null } = args
    const card = this.state.cards.get(cardId)
    if (!card) throw new Error(`Card not found: ${cardId}`)

    const actualAssetId = assetId || card.mediaPlacement?.assetId
    const asset = actualAssetId ? this.state.mediaAssets.get(actualAssetId) : null
    if (!asset) throw new Error(`Asset not found: ${actualAssetId}`)

    const placement: MediaPlacement = {
      cardId,
      assetId: actualAssetId!,
      frameRect: card.bounds,
      fitMode: mode,
      cropRectNormalized: cropRect
    }

    const computedFit = calculateMediaFit(asset, placement)
    card.mediaPlacement = placement

    return { cardId, assetId: actualAssetId, fitMode: mode, computedFit }
  }

  private addPort(args: Record<string, any>): any {
    const { cardId, semanticType, side = 'auto', normalizedOffset = 0.5, direction = 'both', label } = args
    const card = this.state.cards.get(cardId)
    if (!card) throw new Error(`Card not found: ${cardId}`)

    const portId = `${cardId}-port-${Date.now()}`
    const port: CardPort = {
      id: portId,
      cardId,
      semanticType,
      side: side === 'auto' ? 'right' : side,
      normalizedOffset,
      direction,
      label
    }

    card.ports.push(port)
    this.state.ports.set(portId, port)
    const position = computePortPosition(port, card.bounds)

    return { portId, position, semanticType, direction }
  }

  private connectPorts(args: Record<string, any>): any {
    const { sourcePortId, targetPortId, edgeKind = 'reference', label = null, routeMode = 'bezier', confidence = 1.0 } = args
    const sourcePort = this.state.ports.get(sourcePortId)
    const targetPort = this.state.ports.get(targetPortId)

    if (!sourcePort) throw new Error(`Source port not found: ${sourcePortId}`)
    if (!targetPort) throw new Error(`Target port not found: ${targetPortId}`)

    const validation = validatePortConnection(sourcePort, targetPort)
    if (!validation.valid) {
      throw new Error(`CONNECTION_INVALID: ${validation.reason}`)
    }

    const edgeId = `edge-${Date.now()}-${Math.floor(Math.random() * 1000)}`
    const edge: GraphEdge = {
      id: edgeId,
      source: { cardId: sourcePort.cardId, portId: sourcePortId },
      target: { cardId: targetPort.cardId, portId: targetPortId },
      kind: edgeKind,
      direction: 'forward',
      label: label || undefined,
      confidence,
      provenance: { createdBy: 'AI' },
      route: { mode: routeMode }
    }

    this.state.edges.set(edgeId, edge)
    return { edgeId, valid: true, kind: edgeKind, sourceCardId: sourcePort.cardId, targetCardId: targetPort.cardId }
  }

  private createFrame(args: Record<string, any>): any {
    const { frameId = `frame-${Date.now()}`, title, childIds = [], style = {} } = args
    const childCards = childIds.map((cid: string) => this.state.cards.get(cid)).filter(Boolean)
    const childBounds = childCards.map((c: any) => c.bounds)
    const bounds = fitFrameToChildren(childBounds)

    const frame: BoardFrame = {
      id: frameId,
      title,
      childIds,
      bounds,
      collapsed: false,
      style
    }

    this.state.frames.set(frameId, frame)
    for (const c of childCards) {
      c.frameId = frameId
    }

    return { frameId, bounds, childrenCount: childIds.length }
  }

  private layoutSelection(args: Record<string, any>): any {
    const { ids, preset, spacing = 32 } = args
    const cards = ids.map((id: string) => this.state.cards.get(id)).filter(Boolean)
    if (cards.length === 0) return { changedIds: [] }

    let currentX = cards[0].bounds.x
    let currentY = cards[0].bounds.y

    for (let i = 0; i < cards.length; i++) {
      const card = cards[i]
      if (preset === 'row' || preset === 'continuity') {
        card.bounds.x = currentX
        card.bounds.y = currentY
        currentX += card.bounds.width + spacing
      } else if (preset === 'column') {
        card.bounds.x = currentX
        card.bounds.y = currentY
        currentY += card.bounds.height + spacing
      } else if (preset === 'grid') {
        const cols = Math.ceil(Math.sqrt(cards.length))
        const col = i % cols
        const row = Math.floor(i / cols)
        card.bounds.x = currentX + col * (card.bounds.width + spacing)
        card.bounds.y = currentY + row * (card.bounds.height + spacing)
      }
    }

    return { changedIds: cards.map((c: any) => c.id) }
  }

  private alignSelection(args: Record<string, any>): any {
    const { ids, axis, mode } = args
    const cards = ids.map((id: string) => this.state.cards.get(id)).filter(Boolean)
    const boxes = cards.map((c: any) => c.bounds)
    const aligned = this.state.snapManager.align(boxes, axis, mode)

    for (let i = 0; i < cards.length; i++) {
      cards[i].bounds.x = aligned[i].x
      cards[i].bounds.y = aligned[i].y
    }

    return { changedIds: cards.map((c: any) => c.id) }
  }

  private distributeSelection(args: Record<string, any>): any {
    const { ids, axis, gap } = args
    const cards = ids.map((id: string) => this.state.cards.get(id)).filter(Boolean)
    const boxes = cards.map((c: any) => c.bounds)
    const distributed = this.state.snapManager.distribute(boxes, axis, typeof gap === 'number' ? gap : undefined)

    for (let i = 0; i < cards.length; i++) {
      cards[i].bounds.x = distributed[i].x
      cards[i].bounds.y = distributed[i].y
    }

    return { changedIds: cards.map((c: any) => c.id) }
  }

  private createBranch(args: Record<string, any>): any {
    const { fromCardId, label, branchCardTitle = 'Alternative event' } = args
    const parentCard = this.state.cards.get(fromCardId)
    if (!parentCard) throw new Error(`Parent card not found: ${fromCardId}`)

    // Create branch card offset to the right and down
    const branchCardId = `card-branch-${Date.now()}`
    const branchCardPos = {
      x: parentCard.bounds.x + parentCard.bounds.width + 60,
      y: parentCard.bounds.y + 180
    }

    const { cardId: createdBranchId } = this.createCard({
      id: branchCardId,
      type: 'branch',
      title: branchCardTitle,
      position: branchCardPos
    })

    // Find branch-out port on parent card, or create one
    let srcPort = parentCard.ports.find((p) => p.semanticType === 'branch-out' || p.semanticType === 'continuity-out')
    if (!srcPort) {
      const added = this.addPort({ cardId: fromCardId, semanticType: 'branch-out', side: 'bottom', direction: 'source' })
      srcPort = this.state.ports.get(added.portId)
    }

    const branchCard = this.state.cards.get(createdBranchId)!
    let tgtPort = branchCard.ports.find((p) => p.semanticType === 'branch-in' || p.semanticType === 'continuity-in')
    if (!tgtPort) {
      const added = this.addPort({ cardId: createdBranchId, semanticType: 'branch-in', side: 'top', direction: 'target' })
      tgtPort = this.state.ports.get(added.portId)
    }

    const { edgeId } = this.connectPorts({
      sourcePortId: srcPort!.id,
      targetPortId: tgtPort!.id,
      edgeKind: 'branch',
      label,
      routeMode: 'bezier'
    })

    const { frameId } = this.createFrame({
      title: `Branch: ${label}`,
      childIds: [createdBranchId]
    })

    return { frameId, branchCardId: createdBranchId, edgeId }
  }

  private attachVideoRange(args: Record<string, any>): any {
    const { cardId, assetId, startSec, endSec, label = null } = args
    const card = this.state.cards.get(cardId)
    if (!card) throw new Error(`Card not found: ${cardId}`)

    const rangeId = `vrange-${Date.now()}`
    const range: VideoTimeRange = {
      id: rangeId,
      startSec,
      endSec,
      label: label || `${formatTimestamp(startSec)} - ${formatTimestamp(endSec)}`
    }

    if (!card.timeRanges) card.timeRanges = []
    card.timeRanges.push(range)

    return {
      mediaAnnotationId: rangeId,
      cardId,
      assetId,
      startSec,
      endSec,
      formattedTime: range.label
    }
  }

  private convertTextToBoard(args: Record<string, any>): any {
    const { text, origin = { x: 100, y: 100 }, preview = false } = args
    const lines = text.split(/\r?\n/)
    const createdCards: string[] = []
    const createdFrames: string[] = []
    const createdEdges: string[] = []

    let curFrameId: string | null = null
    let curFrameChildren: string[] = []
    let curX = origin.x
    let curY = origin.y
    let lastCardId: string | null = null

    for (let i = 0; i < lines.length; i++) {
      const line = lines[i].trim()
      if (!line) continue

      if (line.startsWith('# ')) {
        // H1 -> Commit previous frame if exists and start new frame
        if (curFrameId && curFrameChildren.length > 0 && !preview) {
          this.createFrame({ frameId: curFrameId, title: curFrameId, childIds: curFrameChildren })
        }
        curFrameId = line.slice(2).trim()
        curFrameChildren = []
        curY += 240
        curX = origin.x
      } else if (line.startsWith('## ')) {
        // H2 -> Event card
        const title = line.slice(3).trim()
        const cid = `card-${Date.now()}-${i}`
        if (!preview) {
          this.createCard({
            id: cid,
            type: 'continuity',
            title,
            position: { x: curX, y: curY }
          })
          if (curFrameId) curFrameChildren.push(cid)
          if (lastCardId) {
            const p1 = this.state.cards.get(lastCardId)!.ports.find((p) => p.semanticType === 'continuity-out')
            const p2 = this.state.cards.get(cid)!.ports.find((p) => p.semanticType === 'continuity-in')
            if (p1 && p2) {
              const { edgeId } = this.connectPorts({ sourcePortId: p1.id, targetPortId: p2.id, edgeKind: 'continuity' })
              createdEdges.push(edgeId)
            }
          }
        }
        createdCards.push(cid)
        lastCardId = cid
        curX += 260
      } else if (line.startsWith('- ')) {
        // Bullet item -> Child note card
        const title = line.slice(2).trim()
        const cid = `card-note-${Date.now()}-${i}`
        if (!preview) {
          this.createCard({
            id: cid,
            type: 'reference',
            title,
            position: { x: curX, y: curY + 180 }
          })
          if (curFrameId) curFrameChildren.push(cid)
          if (lastCardId) {
            const parentPorts = this.state.cards.get(lastCardId)!.ports
            const p1 = parentPorts.find((p) => p.semanticType === 'reference' && p.direction !== 'target')
              ?? this.state.ports.get(this.addPort({ cardId: lastCardId, semanticType: 'reference', side: 'bottom', direction: 'source' }).portId)
            const p2 = this.state.cards.get(cid)!.ports.find((p) => p.semanticType === 'reference' && p.direction !== 'source')
            if (p1 && p2) {
              const { edgeId } = this.connectPorts({ sourcePortId: p1.id, targetPortId: p2.id, edgeKind: 'reference' })
              createdEdges.push(edgeId)
            }
          }
        }
        createdCards.push(cid)
        curX += 240
      }
    }

    if (curFrameId && curFrameChildren.length > 0 && !preview) {
      const { frameId } = this.createFrame({ frameId: `frame-${Date.now()}`, title: curFrameId, childIds: curFrameChildren })
      createdFrames.push(frameId)
    }

    return {
      boardPlanId: `plan-${Date.now()}`,
      preview,
      createdCardsCount: createdCards.length,
      createdCards,
      createdFrames,
      createdEdges
    }
  }

  private traceProvenance(args: Record<string, any>): any {
    const { cardId } = args
    const card = this.state.cards.get(cardId)
    if (!card) throw new Error(`Card not found: ${cardId}`)

    const upstreamCards = new Set<string>()
    const downstreamCards = new Set<string>()
    const traversedEdges = new Set<string>()

    // Traverse upstream (incoming edges)
    for (const edge of this.state.edges.values()) {
      if (edge.target.cardId === cardId) {
        upstreamCards.add(edge.source.cardId)
        traversedEdges.add(edge.id)
      }
      if (edge.source.cardId === cardId) {
        downstreamCards.add(edge.target.cardId)
        traversedEdges.add(edge.id)
      }
    }

    return {
      cardId,
      title: card.title,
      type: card.type,
      upstreamCards: Array.from(upstreamCards),
      downstreamCards: Array.from(downstreamCards),
      associatedEdges: Array.from(traversedEdges).map((eid) => this.state.edges.get(eid))
    }
  }

  private snapshotBoard(args: Record<string, any>): any {
    const { name, scope = 'board' } = args
    const snapshotId = `snapshot-${Date.now()}-${name}`

    const snapshotData = {
      name,
      scope,
      timestamp: Date.now(),
      cards: Array.from(this.state.cards.values()),
      edges: Array.from(this.state.edges.values()),
      frames: Array.from(this.state.frames.values()),
      mediaAssets: Array.from(this.state.mediaAssets.values())
    }

    this.state.snapshots.set(snapshotId, snapshotData)
    return {
      snapshotId,
      name,
      cardsCount: snapshotData.cards.length,
      edgesCount: snapshotData.edges.length,
      framesCount: snapshotData.frames.length
    }
  }

  private async exportRegion(args: Record<string, any>): Promise<any> {
    const { frameId, format = 'png', scale = 1.0, exportPath } = args
    let exportBounds: Rect = { x: 0, y: 0, width: 1920, height: 1080 }

    if (frameId && this.state.frames.has(frameId)) {
      exportBounds = this.state.frames.get(frameId)!.bounds
    }

    const ops: any[] = []
    let nextId = 1

    // Render cards and frames
    for (const frame of this.state.frames.values()) {
      ops.push(...createFrameRenderOps(frame, () => nextId++))
    }

    for (const card of this.state.cards.values()) {
      const { x, y, width, height } = card.bounds
      ops.push({
        type: 'vector',
        object: {
          id: `card-bg-${card.id}-${nextId++}`,
          kind: 'vector',
          bounds: { x, y, width, height },
          visible: true,
          opacity: 1,
          blendMode: 'normal',
          payload: {
            commands: [
              ['M', x + 8, y],
              ['L', x + width - 8, y],
              ['C', x + width, y, x + width, y, x + width, y + 8],
              ['L', x + width, y + height - 8],
              ['C', x + width, y + height, x + width, y + height, x + width - 8, y + height],
              ['L', x + 8, y + height],
              ['C', x, y + height, x, y + height, x, y + height - 8],
              ['L', x, y + 8],
              ['C', x, y, x, y, x + 8, y],
              ['Z']
            ],
            fill: '#1e242eff',
            stroke: '#3b82f6ff',
            strokeWidth: 1.5,
            vectorFillRule: 'nonzero'
          },
          transform: [1, 0, 0, 1, 0, 0]
        }
      })
    }

    // Render edges
    for (const edge of this.state.edges.values()) {
      const srcPort = this.state.ports.get(edge.source.portId)
      const tgtPort = this.state.ports.get(edge.target.portId)
      if (srcPort && tgtPort) {
        const srcCard = this.state.cards.get(srcPort.cardId)
        const tgtCard = this.state.cards.get(tgtPort.cardId)
        if (srcCard && tgtCard) {
          const sp = computePortPosition(srcPort, srcCard.bounds)
          const tp = computePortPosition(tgtPort, tgtCard.bounds)
          ops.push(...createEdgeRenderOps(edge, sp, tp, () => nextId++))
        }
      }
    }

    const renderResult = await this.renderSnapshot({
      width: Math.max(800, Math.round(exportBounds.width * scale)),
      height: Math.max(600, Math.round(exportBounds.height * scale)),
      displayList: ops,
      scale,
      exportPngPath: exportPath
    })

    return {
      artifactPath: exportPath,
      format,
      width: renderResult.width,
      height: renderResult.height,
      durationMs: renderResult.durationMs,
      nonZeroPixels: renderResult.nonZeroPixels
    }
  }
}

export { EngineMcpCore as EngineMcpBridge }
