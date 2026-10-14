import type { ProjectModel } from '../model/project'
import { canvasResourceBudget } from '../canvas-engine/resourceBudget'
import { preparationWorkerSnapshot } from '../board/preparationWorkers'

/** Explicit inspection only. Reads existing counters/attributes without layout
 * measurement, media decoding or activating an inactive board. */
export function readRuntimeDiagnostics(project: ProjectModel) {
  const surfaces = Array.from(document.querySelectorAll<HTMLElement>('.canvas-stage, .vello-board')).slice(0, 8).map(element => ({
    surface: element.className, truncatedCounters: Object.entries(element.dataset).filter(([, value]) => (value?.length || 0) > 24000).map(([key, value]) => ({ key, totalCharacters: value?.length })), counters: Object.fromEntries(Object.entries(element.dataset).map(([key, value]) => [key, value?.slice(0, 24000)])),
  }))
  const memory = (performance as Performance & { memory?: { usedJSHeapSize: number; totalJSHeapSize: number; jsHeapSizeLimit: number } }).memory
  return {
    schema: 'art-equation.frontend-diagnostics', version: 1, at: new Date().toISOString(),
    scope: 'Existing renderer counters and budget estimates. Heap data is browser-reported when available; neither this nor resource estimates measure GPU VRAM or physical scanout.',
    viewport: { width: innerWidth, height: innerHeight, devicePixelRatio, visibility: document.visibilityState },
    resources: canvasResourceBudget.snapshot(), preparation: preparationWorkerSnapshot(),
    browserHeap: memory ? { usedBytes: memory.usedJSHeapSize, totalBytes: memory.totalJSHeapSize, limitBytes: memory.jsHeapSizeLimit } : null,
    surfaces,
    inventory: {
      projectId: project.id, boards: project.boards.map(board => ({ id: board.id, title: board.title, nodes: board.nodes.length, connectors: board.connectors.length, parentBoardId: board.parentBoardId })),
      documents: project.documents.length, assets: project.assets.length,
      missingAssets: project.assets.filter(asset => asset.status === 'missing').map(asset => ({ id: asset.id, name: asset.displayName, relativePath: asset.relativePath })),
    },
  }
}
