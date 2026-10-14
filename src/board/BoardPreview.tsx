import { memo, useEffect, useMemo, useRef, useState } from 'react'
import type { BoardModel, ProjectAsset } from '../model/project'
import { createArtEquationCanvasScene } from './artEquationCanvasAdapter'
import { minimapBounds, minimapSceneSvg } from './minimapGeometry'
import { recordMetric } from '../diagnostics/performance'

/** Automatic previews share path/Boolean/transform geometry with the minimap. */
const EMPTY_ASSETS: readonly ProjectAsset[] = []
export const BoardPreview = memo(function BoardPreview({ board, assets = EMPTY_ASSETS, width = 160, height = 110, fallbackBackground = '#1b1f25' }: { board: BoardModel; assets?: readonly ProjectAsset[]; width?: number; height?: number; fallbackBackground?: string }) {
  const image = useRef<HTMLImageElement>(null), retained = useRef<{ identity: unknown[]; source: string } | undefined>(undefined)
  const [visible, setVisible] = useState(false)
  const [foreground, setForeground] = useState(!document.hidden)
  useEffect(() => {
    const node = image.current
    if (!node) return
    const onVisibility = () => setForeground(!document.hidden)
    document.addEventListener('visibilitychange', onVisibility)
    const observer = new IntersectionObserver(entries => setVisible(entries.some(entry => entry.isIntersecting)), { rootMargin: '0px' })
    observer.observe(node)
    return () => { observer.disconnect(); document.removeEventListener('visibilitychange', onVisibility) }
  }, [])
  const source = useMemo(() => {
    if (!visible || !foreground) return retained.current?.source
    const identity = [board.id, board.nodes, board.connectors, board.backgroundColor, board.backgroundFollowsTheme, assets, width, height, fallbackBackground]
    if (retained.current?.identity.every((value, index) => value === identity[index])) return retained.current.source
    const start = performance.now()
    const scene = createArtEquationCanvasScene(board, assets, { background: board.backgroundFollowsTheme ? fallbackBackground : board.backgroundColor || fallbackBackground, grid: '#64748b' })
    const bounds = minimapBounds(scene.objects, width, height, board.nodes)
    const result = `data:image/svg+xml;charset=utf-8,${encodeURIComponent(minimapSceneSvg(scene, board.nodes, bounds, width, height))}`
    retained.current = { identity, source: result }
    recordMetric('board.preview-built', { boardId: board.id, objects: scene.objects.length, durationMs: performance.now() - start })
    return result
  }, [visible, foreground, board.id, board.nodes, board.connectors, board.backgroundColor, board.backgroundFollowsTheme, assets, width, height, fallbackBackground])
  return <img ref={image} className="automatic-board-preview" data-preview-board={board.id} data-preview-demand={visible && foreground ? 'visible' : 'idle'} src={source} alt="" width={width} height={height} loading="lazy" draggable={false} />
})
