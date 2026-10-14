import { useEffect, useId, useLayoutEffect, useRef, useState } from 'react'
import type { KeyboardEvent, PointerEvent, ReactNode, RefObject } from 'react'
import { createPortal } from 'react-dom'
import { appUpdateClock } from '../canvas-engine/appFrameClock'
import './ProductionStudio.css'

export type ProductionStudioTab = 'color' | 'layers' | 'object' | 'workspace' | 'grid'
type Dock = 'left' | 'right' | null
type Position = { x: number; y: number }
type Size = { width: number; height: number }
const MIN_WIDTH = 282, MIN_HEIGHT = 280
const KEY = 'art-equation.production-studio-layout.2.5'
const VISIBLE_KEY = 'art-equation.production-studio-visible.2.5'

export function productionStudioInitiallyVisible() {
  try { return localStorage.getItem(VISIBLE_KEY) !== '0' } catch { return true }
}

function storedLayout(): { dock: Dock; position: Position; size: Size } {
  try {
    const value = JSON.parse(localStorage.getItem(KEY) || '{}')
    return {
      dock: null,
      position: Number.isFinite(value.x) && Number.isFinite(value.y) ? value : { x: Math.max(8, window.innerWidth - 330), y: 180 },
      size: { width: Math.max(MIN_WIDTH, Math.min(560, Number(value.width) || 306)), height: Math.max(MIN_HEIGHT, Math.min(1000, Number(value.height) || 560)) },
    }
  } catch { return { dock: null, position: { x: Math.max(8, window.innerWidth - 330), y: 180 }, size: { width: 306, height: 560 } } }
}

type Props = {
  stageRef: RefObject<HTMLDivElement | null>
  visible: boolean
  activeTab: ProductionStudioTab
  onVisibleChange: (visible: boolean) => void
  onTabChange: (tab: ProductionStudioTab) => void
  onStroke: () => void
  strokeAvailable: boolean
  context: string
  selectionCount: number
  gridVisible: boolean
  color: ReactNode
  layers: ReactNode
  object: ReactNode
  grid: ReactNode
  workspace: ReactNode
}

/** Screen-space utility; all supplied controls use the canonical engine model. */
export function ProductionStudio({ stageRef, visible, activeTab, onVisibleChange, onTabChange, onStroke, strokeAvailable, context, selectionCount, gridVisible, color, layers, object, grid, workspace }: Props) {
  const [initial] = useState(storedLayout)
  const [dock, setDock] = useState<Dock>(initial.dock)
  const [position, setPosition] = useState<Position>(initial.position)
  const [size, setSize] = useState<Size>(initial.size)
  const [resizing, setResizing] = useState(false)
  const [host, setHost] = useState<HTMLElement | null>(null)
  const [target, setTarget] = useState<Dock>(null)
  const [dragging, setDragging] = useState(false)
  const [paintView, setPaintView] = useState<'color' | 'swatches' | 'stroke'>('color')
  const panelRef = useRef<HTMLElement>(null)
  const resize = useRef<{ pointer: number; origin: Size; start: number; initial: number; axis: 'width' | 'height'; capture: HTMLElement } | null>(null)
  const resizeFrame = useRef<number | undefined>(undefined)
  const pendingSize = useRef<Size | null>(null)
  const drag = useRef<{ pointer: number; origin: Position; dock: Dock; dx: number; dy: number; capture: HTMLElement } | null>(null)
  const id = useId().replace(/:/g, '')
  const tabId = `${id}-studio-tab`, panelId = `${id}-studio-panel`
  const bodyBounds = () => host?.querySelector('.app-body')?.getBoundingClientRect()
  const centerBounds = () => host?.querySelector('.project-center')?.getBoundingClientRect()
  const floatingBottom = (x: number, width: number) => {
    const stage = host?.querySelector('.canvas-stage')?.getBoundingClientRect()
    const rail = host?.querySelector('.canvas-tool-rail')?.getBoundingClientRect()
    const zoom = host?.querySelector('.canvas-zoom-control')?.getBoundingClientRect()
    const overlapsRail = rail?.height && x < rail.right && x + width > rail.left
    const railBottom = overlapsRail ? rail.top - 8 : (bodyBounds()?.bottom || stage?.bottom || window.innerHeight - 28) - 8
    // Only reserve zoom's vertical space when the utility overlaps it horizontally.
    return zoom?.height && x < zoom.right && x + width > zoom.left ? Math.min(railBottom, zoom.top - 8) : railBottom
  }
  const clamp = (next: Position) => {
    const area = bodyBounds(), bounds = panelRef.current?.getBoundingClientRect()
    const width = bounds?.width || 306, height = bounds?.height || 560
    const stage = host?.querySelector('.canvas-stage')?.getBoundingClientRect()
    const top = Math.max(8, stage?.top || area?.top || 8, (host?.querySelector('.p25-workspace-heading')?.getBoundingClientRect().bottom || 0) + 8)
    const zoom = host?.querySelector('.canvas-zoom-control')?.getBoundingClientRect()
    // This is a floating workspace utility, not a canvas-bound object. Allow
    // free workspace placement so short Split panes retain a usable layer area.
    const left = 8
    const right = window.innerWidth
    let x = Math.max(left, Math.min(right - width - 8, next.x))
    // In short windows, move alongside zoom rather than over its buttons.
    if (floatingBottom(x,width)-top<MIN_HEIGHT) {
      const rail = host?.querySelector('.canvas-tool-rail')?.getBoundingClientRect()
      const candidates = [rail ? rail.left-width-8 : x, stage ? stage.left-width-8 : x, zoom ? zoom.left-width-8 : x, rail ? rail.right+8 : x, left]
      const available = candidates.find(candidate => candidate >= left && candidate+width <= right-8 && floatingBottom(candidate,width)-top >= MIN_HEIGHT)
      if (available !== undefined) x = available
    }
    const bottom = floatingBottom(x,width)
    return {
      x,
      y: Math.max(top, Math.min(bottom - Math.min(height, Math.max(140, bottom - top)), next.y)),
    }
  }

  // Ancestor refs may be attached after this child's layout effect. Resolve the
  // portal host after commit, when the real stage ref is definitely available.
  useEffect(() => { setHost(stageRef.current?.closest<HTMLElement>('.studio-shell') || null) }, [stageRef])
  useLayoutEffect(() => {
    if (!host) return
    host.dataset.productionStudioDock = visible ? dock || 'floating' : 'hidden'
    return () => { delete host.dataset.productionStudioDock }
  }, [host, dock, visible])
  useEffect(() => { try { localStorage.setItem(VISIBLE_KEY, visible ? '1' : '0') } catch { /* UI storage may be disabled. */ } }, [visible])
  useEffect(() => {
    if (dragging || resizing) return
    try { localStorage.setItem(KEY, JSON.stringify({ ...position, ...size, dock })) } catch { /* Keep the open utility usable. */ }
  }, [position, size, dock, dragging, resizing])
  useLayoutEffect(() => {
    if (!host || !visible) return
    const update = () => {
      if (dock) {
        const center = centerBounds(), area = bodyBounds(), width = panelRef.current?.getBoundingClientRect().width || 306
        if (center && area) setPosition(current => {
          const next = { x: dock === 'left' ? center.left : center.right - width, y: area.top }
          return next.x === current.x && next.y === current.y ? current : next
        })
      } else setPosition(current => { const next=clamp(current); return next.x===current.x&&next.y===current.y?current:next })
    }
    update()
    // Publish outside the observer delivery cycle; the toolbar can change size
    // as the pane crosses a breakpoint. Coalesce that work on the app clock.
    let resizeFrame: number | undefined
    const scheduleUpdate = () => {
      if (resizeFrame === undefined) resizeFrame = appUpdateClock.request(() => { resizeFrame = undefined; update() })
    }
    const observer = new ResizeObserver(scheduleUpdate)
    const body = host.querySelector('.app-body'), center = host.querySelector('.project-center')
    if (body) observer.observe(body)
    if (center) observer.observe(center)
    // Toolbar row changes and pane switches can move the reserved controls
    // without changing the outer shell. Keep the floating utility clear of them.
    for (const element of host.querySelectorAll('.canvas-stage,.canvas-tool-rail,.canvas-zoom-control')) observer.observe(element)
    window.addEventListener('resize', scheduleUpdate)
    return () => {
      observer.disconnect(); window.removeEventListener('resize', scheduleUpdate)
      if (resizeFrame !== undefined) appUpdateClock.cancel(resizeFrame)
    }
  }, [host, dock, visible, size.width])

  function reset() {
    setDock(null)
    setPosition(clamp({ x: window.innerWidth - 330, y: (bodyBounds()?.top || 160) + 14 }))
    onVisibleChange(true)
  }
  useEffect(() => {
    const resetLayout = () => reset()
    window.addEventListener('art-equation:reset-studio-layout', resetLayout)
    return () => window.removeEventListener('art-equation:reset-studio-layout', resetLayout)
  })

  function cancelDrag() {
    const current = drag.current
    if (!current) return
    setPosition(current.origin); setDock(current.dock)
    if (current.capture.hasPointerCapture(current.pointer)) current.capture.releasePointerCapture(current.pointer)
    drag.current = null; setDragging(false); setTarget(null)
  }
  useEffect(() => {
    const escape = (event: globalThis.KeyboardEvent) => {
      if (event.key === 'Escape' && drag.current) { event.preventDefault(); event.stopPropagation(); cancelDrag() }
      if (event.key === 'Escape' && resize.current) { event.preventDefault(); event.stopPropagation(); cancelResize() }
    }
    window.addEventListener('keydown', escape, true)
    return () => { window.removeEventListener('keydown', escape, true); if (resizeFrame.current !== undefined) appUpdateClock.cancel(resizeFrame.current) }
  }, [])
  function startResize(event: PointerEvent<HTMLElement>, axis: 'width' | 'height') {
    if (event.button !== 0) return
    event.preventDefault(); event.stopPropagation()
    const bounds = panelRef.current!.getBoundingClientRect()
    resize.current = { pointer: event.pointerId, origin: size, start: axis === 'width' ? event.clientX : event.clientY, initial: bounds[axis], axis, capture: event.currentTarget }
    event.currentTarget.setPointerCapture(event.pointerId); setResizing(true)
  }
  function resizeSize(axis: 'width' | 'height', value: number, base: Size): Size {
    const maximum = axis === 'width' ? Math.min(560, window.innerWidth - position.x - 8) : Math.max(MIN_HEIGHT, floatingBottom(position.x, base.width) - position.y)
    return { ...base, [axis]: Math.round(Math.max(axis === 'width' ? MIN_WIDTH : MIN_HEIGHT, Math.min(maximum, value))) }
  }
  function moveResize(event: PointerEvent<HTMLElement>) {
    const current = resize.current
    if (!current) return
    pendingSize.current = resizeSize(current.axis, current.initial + (current.axis === 'width' ? event.clientX : event.clientY) - current.start, current.origin)
    if (resizeFrame.current === undefined) resizeFrame.current = appUpdateClock.request(() => { resizeFrame.current = undefined; if (pendingSize.current) setSize(pendingSize.current) })
  }
  function finishResize(event: PointerEvent<HTMLElement>) {
    if (!resize.current) return
    moveResize(event)
    if (resizeFrame.current !== undefined) { appUpdateClock.cancel(resizeFrame.current); resizeFrame.current = undefined }
    if (pendingSize.current) setSize(pendingSize.current)
    if (event.currentTarget.hasPointerCapture(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId)
    pendingSize.current = null; resize.current = null; setResizing(false)
  }
  function cancelResize() {
    const current = resize.current
    if (!current) return
    if (resizeFrame.current !== undefined) { appUpdateClock.cancel(resizeFrame.current); resizeFrame.current = undefined }
    if (current.capture.hasPointerCapture(current.pointer)) current.capture.releasePointerCapture(current.pointer)
    setSize(current.origin); resize.current = null; pendingSize.current = null; setResizing(false)
  }
  function resizeKey(event: KeyboardEvent<HTMLElement>, axis: 'width' | 'height') {
    const directions = axis === 'height' ? ['ArrowUp', 'ArrowDown'] : ['ArrowLeft', 'ArrowRight']
    if (!directions.includes(event.key)) return
    event.preventDefault(); event.stopPropagation()
    const actual = panelRef.current?.getBoundingClientRect()[axis] || size[axis]
    setSize(current => resizeSize(axis, Math.min(actual, current[axis]) + (event.key === directions[0] ? -1 : 1) * (event.shiftKey ? 48 : 16), current))
  }
  function start(event: PointerEvent<HTMLElement>) {
    if (event.button !== 0 || (event.target as HTMLElement).closest('button,select')) return
    const bounds = panelRef.current!.getBoundingClientRect()
    drag.current = { pointer: event.pointerId, origin: position, dock, dx: event.clientX - bounds.x, dy: event.clientY - bounds.y, capture: event.currentTarget }
    event.currentTarget.setPointerCapture(event.pointerId)
    setPosition({ x: bounds.x, y: bounds.y }); setDock(null); setDragging(true)
  }
  function move(event: PointerEvent<HTMLElement>) {
    const current = drag.current
    if (!current) return
    setPosition(clamp({ x: event.clientX - current.dx, y: event.clientY - current.dy }))
    setTarget(null)
  }
  function finish(event: PointerEvent<HTMLElement>) {
    if (!drag.current) return
    if (event.currentTarget.hasPointerCapture(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId)
    drag.current = null; if (target) setDock(target)
    setDragging(false); setTarget(null)
  }
  function titleKey(event: KeyboardEvent<HTMLElement>) {
    if (event.target !== event.currentTarget) return
    if (event.key === 'Home') { event.preventDefault(); event.stopPropagation(); reset(); return }
    const step = event.shiftKey ? 24 : 8
    const change = { ArrowLeft: [-step, 0], ArrowRight: [step, 0], ArrowUp: [0, -step], ArrowDown: [0, step] }[event.key]
    if (!change) return
    event.preventDefault(); event.stopPropagation()
    setDock(null); setPosition(current => clamp({ x: current.x + change[0], y: current.y + change[1] }))
  }
  function tabKey(event: KeyboardEvent<HTMLDivElement>) {
    const keys = ['ArrowLeft', 'ArrowRight', 'Home', 'End']
    if (!keys.includes(event.key)) return
    const tabs = Array.from(event.currentTarget.querySelectorAll<HTMLButtonElement>('[role=tab]'))
    const index = tabs.indexOf(document.activeElement as HTMLButtonElement)
    const next = event.key === 'Home' ? 0 : event.key === 'End' ? tabs.length - 1 : (index + (event.key === 'ArrowRight' ? 1 : tabs.length - 1)) % tabs.length
    event.preventDefault(); event.stopPropagation(); tabs[next]?.click(); tabs[next]?.focus()
  }

  if (!host || !visible) return null
  const selectedTab = activeTab
  return createPortal(<>

    <aside id={`${panelId}-utility`} ref={panelRef} className={`production-studio ${dock ? `docked docked-${dock}` : 'floating'}${dragging ? ' dragging' : ''}${resizing ? ' resizing' : ''}`} aria-label="Color and Layers utility" onPointerDown={event => event.stopPropagation()} onClick={event => event.stopPropagation()} onDoubleClick={event => event.stopPropagation()} onContextMenu={event => event.stopPropagation()} style={{ left: position.x, top: position.y, width: size.width, height: size.height, maxHeight: Math.max(140, (dock ? (bodyBounds()?.bottom || window.innerHeight - 28) : floatingBottom(position.x,size.width)) - position.y), ...(dock ? { height: Math.max(180, (bodyBounds()?.bottom || window.innerHeight - 28) - position.y) } : {}) }}>
      <header className="production-studio-title" tabIndex={0} aria-label="Move Color and Layers; arrow keys move, Home resets position" onPointerDown={start} onPointerMove={move} onPointerUp={finish} onPointerCancel={cancelDrag} onKeyDown={titleKey}>
        <span aria-hidden="true">⠿</span><strong>Color &amp; Layers</strong>
        <span className="production-studio-mode">Floating</span>
        <button type="button" aria-label="Hide Color and Layers" onClick={() => onVisibleChange(false)}>×</button>
      </header>
      <div className="production-studio-tabs" role="tablist" aria-label="Studio controls" onKeyDown={tabKey}>
        {([['color', 'Color & Layers'], ['layers', 'Layers'], ['object', 'Object'], ['workspace', 'Effects']] as const).map(([tab, title]) => <button key={tab} id={`${tabId}-${tab}`} type="button" role="tab" tabIndex={selectedTab === tab ? 0 : -1} aria-selected={selectedTab === tab} aria-controls={`${panelId}-${tab}`} onClick={() => onTabChange(tab)}>{title}</button>)}
      </div>
      <section className="production-studio-context" aria-label="Inspector context"><small>{selectionCount ? `${selectionCount} selected` : 'Board & project'}</small><strong title={context}>{context}</strong></section>
      {(selectedTab === 'color') && <section className="production-studio-color-layers" id={`${panelId}-color`} role="tabpanel" aria-labelledby={`${tabId}-color`}>
        <div className="production-paint-tabs" role="group" aria-label="Paint controls">
          {(['color', 'swatches', 'stroke'] as const).map(view => <button type="button" key={view} disabled={view === 'stroke' && !strokeAvailable} aria-pressed={paintView === view} onClick={() => { setPaintView(view); if (view === 'stroke') onStroke() }}>{view[0].toUpperCase() + view.slice(1)}</button>)}
          <button type="button" aria-pressed={false} onClick={() => onTabChange('workspace')}>Appearance</button>
        </div>
        <section className="production-studio-paint" data-paint-view={paintView} aria-label="Selected object paint" tabIndex={0}>{color}</section>
        <section className="production-studio-layers" aria-label="Layers">{layers}</section>
      </section>}
      {selectedTab === 'layers' && <section className="production-studio-layers production-studio-layers-focus" id={`${panelId}-layers`} role="tabpanel" aria-labelledby={`${tabId}-layers`}>{layers}</section>}
      {selectedTab === 'object' && <section className="production-studio-scroll" id={`${panelId}-object`} role="tabpanel" aria-labelledby={`${tabId}-object`}>{object}</section>}
      {selectedTab === 'workspace' && <section className="production-studio-scroll" id={`${panelId}-workspace`} role="tabpanel" aria-labelledby={`${tabId}-workspace`}>{workspace}</section>}
      {selectedTab === 'grid' && <section className="production-studio-scroll" id={`${panelId}-grid`} aria-label="Grid and canvas settings">{grid}</section>}
      <footer className="production-studio-footer"><button type="button" aria-pressed={selectedTab === 'grid'} onClick={() => onTabChange(selectedTab === 'grid' ? 'color' : 'grid')}>▦ Grid settings</button><button type="button" onClick={reset}>Reset position</button><small>Drag title to move · drag edges to resize · Grid {gridVisible ? 'on' : 'off'}</small></footer>
      {(['height', 'width'] as const).map(axis => <div key={axis} className={`production-studio-resize production-studio-resize-${axis}`} role="separator" tabIndex={0} aria-label={`Resize Color and Layers ${axis}`} aria-orientation={axis === 'height' ? 'horizontal' : 'vertical'} aria-controls={`${panelId}-utility`} aria-valuemin={axis === 'height' ? MIN_HEIGHT : MIN_WIDTH} aria-valuemax={axis === 'height' ? 1000 : 560} aria-valuenow={size[axis]} onPointerDown={event => startResize(event, axis)} onPointerMove={moveResize} onPointerUp={finishResize} onPointerCancel={cancelResize} onKeyDown={event => resizeKey(event, axis)} />)}
    </aside>
  </>, host)
}
