import { requestAppFrame, cancelAppFrame } from '../canvas-engine/appFrameClock'
import { useEffect, useLayoutEffect, useRef } from 'react'
import { Application, Container, Graphics } from 'pixi.js'
import type { CanvasEnvironment, CanvasSceneSnapshot, CanvasViewport } from '../canvas-engine/contracts'
import { BackdropInvalidation } from '../canvas-engine/renderInvalidation'
import { RetainedBoardContent } from './RetainedBoardContent'
import type { RetainedMode } from './retainedMode'
import type { LiveCamera } from '../canvas-engine/liveCamera'
import { canvasResourceBudget } from '../canvas-engine/resourceBudget'
import './RetainedBoardContent.css'

type GpuBoardBackdropProps = {
  camera?: LiveCamera
  scene: CanvasSceneSnapshot
  viewport: CanvasViewport
  tool?: 'select' | 'hand' | 'zoom'
  mode?: RetainedMode
  uiKey?: string
}

export function GpuBoardBackdrop({ scene, viewport, camera, tool = 'select', mode = 'dom', uiKey = '' }: GpuBoardBackdropProps) {
  const hostRef = useRef<HTMLDivElement>(null)
  const inputRef = useRef({ scene, viewport, mode, uiKey })
  const renderRef = useRef<(() => void) | null>(null)

  // Commit the Pixi transform before paint alongside React's DOM transform.
  useLayoutEffect(() => {
    inputRef.current = { scene, viewport: camera?.current || viewport, mode, uiKey }
    renderRef.current?.()
  }, [scene, viewport, camera, mode, uiKey])
  useLayoutEffect(() => camera?.subscribe(current => {
    inputRef.current = { ...inputRef.current, viewport: current }
    renderRef.current?.()
  }), [camera])

  useEffect(() => {
    const host = hostRef.current
    if (!host) return
    let disposed = false
    let app: Application | null = null
    let resizeObserver: ResizeObserver | null = null
    let stopDprWatch: (() => void) | null = null
    let cleanupEvents: (() => void) | null = null
    let pendingFrame: number | null = null
    let content: RetainedBoardContent | null = null
    const invalidation = new BackdropInvalidation()
    const metrics = { renders: 0, gridBuilds: 0, structureBuilds: 0, contextRecoveries: 0 }

    async function mount() {
      const nextApp = new Application()
      try {
        await nextApp.init({ antialias: true, backgroundAlpha: 0, preference: 'webgl', autoStart: false, sharedTicker: false, resolution: renderResolution(host!.clientWidth, host!.clientHeight), autoDensity: true })
      } catch (error) {
        if (!disposed) { host!.dataset.renderError = String(error); console.error('Canvas backdrop initialization failed', error) }
        return
      }
      if (disposed) { nextApp.destroy(true); return }
      app = nextApp
      nextApp.stop()
      nextApp.canvas.className = 'gpu-board-canvas'
      host!.appendChild(nextApp.canvas)
      const world = new Container()
      const grid = new Graphics()
      const structure = new Graphics()
      world.addChild(grid, structure)
      nextApp.stage.addChild(world)
      let sizeDirty = true
      let contextLost = false
      let previewActive = false
      const render = () => {
        if (disposed || contextLost || document.hidden) return
        const { scene: currentScene, viewport: currentViewport, mode: currentMode, uiKey: currentUiKey } = inputRef.current
        const dirty = invalidation.consume(currentScene, currentViewport)
        if (dirty.grid) {
          drawGrid(grid, currentScene.environment)
          grid.visible = currentScene.environment.grid.visible
          metrics.gridBuilds++
        }
        if (dirty.structure) { drawBoardStructure(structure, currentScene); metrics.structureBuilds++ }
        if (dirty.viewport) applyViewport(world, currentViewport)
        let contentDirty = false
        try {
          const stage = host!.parentElement
          const preview = stage?.dataset.gesturePreview === 'true' || stage?.dataset.transientOverlay === 'true'
          if (preview !== previewActive) {
            previewActive = preview; sizeDirty = true
            content?.invalidate()
          }
          structure.visible = !preview
          if (content) content.layer.visible = !preview
          contentDirty = !preview && (content?.sync(currentScene, currentViewport, currentMode, currentUiKey) || false)
          if (dirty.grid || dirty.structure || dirty.viewport || sizeDirty || contentDirty) nextApp.render()
          // Camera-only frames do not change DOM/GPU ownership. Rewriting every
          // card's data attribute here would invalidate style on every pan.
          if (contentDirty) content?.publish()
          if (content) host!.dataset.retainedMetrics = JSON.stringify(content.metrics)
        } catch (error) {
          // No lost cards: reveal semantic DOM before dropping an unqualified GPU path.
          content?.dispose(); content = null
          host!.dataset.retainedFallback = String(error)
          nextApp.render()
        }
        if (dirty.grid || dirty.structure || dirty.viewport || sizeDirty || contentDirty) {
          metrics.renders++
          sizeDirty = false
        }
        host!.dataset.renderMetrics = JSON.stringify(metrics)
        host!.dataset.resourceBudget = JSON.stringify(canvasResourceBudget.snapshot())
        host!.dataset.renderState = 'idle'
        host!.dataset.tickerRunning = String(nextApp.ticker.started)
      }
      const scheduleRender = () => {
        if (pendingFrame !== null || disposed) return
        host!.dataset.renderState = 'scheduled'
        pendingFrame = requestAppFrame(() => { pendingFrame = null; render() })
      }
      if (inputRef.current.mode !== 'dom' && host!.parentElement) {
        const gl = nextApp.canvas.getContext('webgl2') || nextApp.canvas.getContext('webgl')
        const maxEdge = gl ? gl.getParameter(gl.MAX_TEXTURE_SIZE) as number : 4096
        content = new RetainedBoardContent(host!.parentElement, scheduleRender, maxEdge)
        world.addChild(content.layer)
      }
      renderRef.current = render
      const resize = () => {
        const width = Math.max(1, host!.clientWidth), height = Math.max(1, host!.clientHeight)
        const resolution = renderResolution(width, height)
        if (nextApp.renderer.width !== width * resolution || nextApp.renderer.height !== height * resolution || nextApp.renderer.resolution !== resolution) {
          nextApp.renderer.resize(width, height, resolution)
          sizeDirty = true
        }
        host!.dataset.devicePixelRatio = String(window.devicePixelRatio || 1)
        host!.dataset.renderScale = resolution.toFixed(3)
        host!.dataset.renderPixels = String(Math.round(width * height * resolution * resolution))
        scheduleRender()
      }
      const lost = (event: Event) => { event.preventDefault(); contextLost = true; content?.invalidate(); host!.dataset.renderState = 'context-lost' }
      const restored = () => {
        contextLost = false
        metrics.contextRecoveries++
        invalidation.reset()
        sizeDirty = true
        scheduleRender()
      }
      const visibility = () => {
        if (document.hidden) {
          if (pendingFrame !== null) cancelAppFrame(pendingFrame)
          pendingFrame = null
        } else { sizeDirty = true; scheduleRender() }
      }
      nextApp.canvas.addEventListener('webglcontextlost', lost)
      nextApp.canvas.addEventListener('webglcontextrestored', restored)
      document.addEventListener('visibilitychange', visibility)
      const gesture = () => { sizeDirty = true; render() }
      host!.parentElement?.addEventListener('canvas-gesture-presented', gesture)
      cleanupEvents = () => {
        host!.parentElement?.removeEventListener('canvas-gesture-presented', gesture)
        nextApp.canvas.removeEventListener('webglcontextlost', lost)
        nextApp.canvas.removeEventListener('webglcontextrestored', restored)
        document.removeEventListener('visibilitychange', visibility)
      }
      resizeObserver = new ResizeObserver(resize)
      resizeObserver.observe(host!)
      resize()
      stopDprWatch = watchDevicePixelRatio(resize)
      render()
    }

    void mount()
    return () => {
      disposed = true
      if (pendingFrame !== null) cancelAppFrame(pendingFrame)
      resizeObserver?.disconnect()
      stopDprWatch?.()
      cleanupEvents?.()
      content?.dispose()
      renderRef.current = null
      app?.destroy(true, { children: true })
    }
  }, [])

  return <div className={`gpu-board gpu-board-${tool}`} data-scene-id={scene.id} data-scene-revision={scene.revision} ref={hostRef} aria-hidden="true" />
}

/**
 * Preserve a physically sharp 4K-class board while protecting the renderer from
 * allocating an unbounded backing store on a very large/high-DPI display.
 */
function renderResolution(width: number, height: number) {
  const requested = Math.min(2, Math.max(1, window.devicePixelRatio || 1))
  const maxRenderPixels = 16_777_216 // 4K × 2:1-ish budget; never represents source-image detail.
  const budgeted = Math.sqrt(maxRenderPixels / Math.max(1, width * height))
  return Math.max(1, Math.min(requested, budgeted))
}

function watchDevicePixelRatio(onChange: () => void) {
  let media: MediaQueryList | undefined
  const refresh = () => {
    media?.removeEventListener('change', refresh)
    media = window.matchMedia(`(resolution: ${window.devicePixelRatio || 1}dppx)`)
    media.addEventListener('change', refresh, { once: true })
    onChange()
  }
  window.addEventListener('resize', refresh)
  refresh()
  return () => {
    window.removeEventListener('resize', refresh)
    media?.removeEventListener('change', refresh)
  }
}

function applyViewport(world: Container, viewport: CanvasViewport) {
  world.position.set(viewport.x, viewport.y)
  world.scale.set(viewport.scale)
}

function drawBoardStructure(graphics: Graphics, scene: CanvasSceneSnapshot) {
  graphics.clear()
  for (const object of scene.objects) {
    if (object.role !== 'column') continue
    graphics.roundRect(object.bounds.x, object.bounds.y, object.bounds.width, object.bounds.height, 14).stroke({ color: 0x59606d, width: 1, alpha: 0.45 })
  }
}

function drawGrid(graphics: Graphics, environment: CanvasEnvironment) {
  graphics.clear()
  const { spacing } = environment.grid
  const majorEvery = 4
  for (let coordinate = -6000; coordinate <= 8000; coordinate += spacing) {
    if (Math.round(coordinate / spacing) % majorEvery === 0) continue
    graphics.moveTo(coordinate, -6000).lineTo(coordinate, 8000)
    graphics.moveTo(-6000, coordinate).lineTo(8000, coordinate)
  }
  const major = parseColor(environment.grid.color, 0x3a3f49)
  const minor = major === 0x3a3f49 ? 0x292d35 : mixColor(parseColor(environment.background, 0x181a1f), major, .55)
  graphics.stroke({ color: minor, width: 1, alpha: Math.min(.72, environment.grid.opacity * .78) })
  for (let coordinate = -6000; coordinate <= 8000; coordinate += spacing * majorEvery) {
    graphics.moveTo(coordinate, -6000).lineTo(coordinate, 8000)
    graphics.moveTo(-6000, coordinate).lineTo(8000, coordinate)
  }
  graphics.stroke({ color: major, width: 1, alpha: Math.min(1, environment.grid.opacity * 1.18) })
}

function mixColor(from: number, to: number, amount: number) {
  const channel = (shift: number) => Math.round(((from >> shift) & 0xff) * (1 - amount) + ((to >> shift) & 0xff) * amount)
  return (channel(16) << 16) | (channel(8) << 8) | channel(0)
}

function parseColor(value: string | undefined, fallback: number) {
  if (!value || !/^#[\da-f]{6}$/i.test(value)) return fallback
  return Number.parseInt(value.slice(1), 16)
}
