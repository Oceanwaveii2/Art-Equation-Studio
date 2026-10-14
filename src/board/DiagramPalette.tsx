import { useEffect, useId, useRef, useState, type CSSProperties, type KeyboardEvent } from 'react'
import { filterDiagramShapes, type DiagramShapeId } from './diagramPaletteCommands'
import './DiagramPalette.css'

export type DiagramPaletteCloseReason = 'escape' | 'outside' | 'cancel' | 'choose'
export type DiagramPaletteProps = {
  mode?: 'create' | 'successor' | 'insert'
  onChoose: (shape: DiagramShapeId) => boolean | void
  onClose: (reason: DiagramPaletteCloseReason) => void
  disabled?: boolean
  disabledReason?: string
  style?: CSSProperties
}
function ShapeIcon({ shape }: { shape: DiagramShapeId }) {
  return <svg viewBox="0 0 40 32" aria-hidden="true" focusable="false">
    {shape === 'process' ? <rect x="3" y="5" width="34" height="22" rx="1" />
      : shape === 'decision' ? <path d="M20 2 38 16 20 30 2 16Z" />
        : shape === 'start-end' ? <rect x="3" y="6" width="34" height="20" rx="10" />
          : shape === 'document' ? <path d="M4 3H36V25C26 31 16 19 4 25Z" />
            : shape === 'text' ? <path d="M8 6H32M20 6V27M14 27H26M8 6V10M32 6V10" />
              : <><path d="M4 16H35" />{shape === 'arrow' && <path d="M27 9 35 16 27 23" />}</>}
  </svg>
}

/** Nonmodal flyout. The caller owns placement and restoring trigger focus;
 * outside dismissal deliberately lets the clicked control keep its focus. */
export function DiagramPalette({ mode = 'create', onChoose, onClose, disabled = false, disabledReason, style }: DiagramPaletteProps) {
  const [query, setQuery] = useState(''), [active, setActive] = useState(0)
  const root = useRef<HTMLDivElement>(null), input = useRef<HTMLInputElement>(null), buttons = useRef<(HTMLButtonElement | null)[]>([])
  const headingId = useId(), hintId = useId(), shapes = filterDiagramShapes(query)
  useEffect(() => { input.current?.focus() }, [])
  useEffect(() => {
    const dismiss = (event: PointerEvent) => { if (event.target instanceof Node && !root.current?.contains(event.target)) onClose('outside') }
    document.addEventListener('pointerdown', dismiss)
    return () => document.removeEventListener('pointerdown', dismiss)
  }, [onClose])
  const choose = (shape: DiagramShapeId) => { if (!disabled && onChoose(shape) !== false) onClose('choose') }
  const focusButton = (index: number) => { if (!shapes.length || disabled) return; const next = (index + shapes.length) % shapes.length; setActive(next); buttons.current[next]?.focus() }
  const onButtonKey = (event: KeyboardEvent, index: number) => {
    const offset = event.key === 'ArrowRight' ? 1 : event.key === 'ArrowLeft' ? -1 : event.key === 'ArrowDown' ? 2 : event.key === 'ArrowUp' ? -2 : 0
    if (offset || event.key === 'Home' || event.key === 'End') { event.preventDefault(); focusButton(event.key === 'Home' ? 0 : event.key === 'End' ? shapes.length - 1 : index + offset) }
  }
  const title = mode === 'successor' ? 'Add a connected shape' : mode === 'insert' ? 'Insert a shape' : 'Diagram shapes'
  const viewportStyle = { ...style, ...(typeof style?.top === 'number' && style.maxHeight === undefined ? { maxHeight: `calc(100vh - ${Math.max(12, style.top)}px - 12px)` } : {}) }
  return <div ref={root} className="diagram-palette" style={viewportStyle} role="dialog" aria-label="Diagram shapes" aria-labelledby={headingId} aria-describedby={mode === 'insert' || disabledReason ? hintId : undefined} aria-modal="false" onKeyDown={(event) => { if (event.key === 'Escape') { event.preventDefault(); event.stopPropagation(); onClose('escape') } }}>
    <header><h2 id={headingId}>{title}</h2><button type="button" aria-label="Close diagram shapes" onClick={() => onClose('cancel')}>×</button></header>
    <label className="diagram-palette-search"><span>Find a shape</span><input ref={input} type="search" aria-label="Find a diagram shape" value={query} onChange={(event) => { setQuery(event.target.value); setActive(0) }} onKeyDown={(event) => { if (event.key === 'ArrowDown' || event.key === 'ArrowUp') { event.preventDefault(); focusButton(event.key === 'ArrowDown' ? 0 : shapes.length - 1) } }} /></label>
    {(mode === 'insert' || disabledReason) && <p id={hintId} className="diagram-palette-hint" role={disabledReason ? 'status' : undefined}>{disabledReason || 'The original label stays with the incoming relationship.'}</p>}
    <div className="diagram-palette-options" aria-label="Available diagram shapes">
      {shapes.map((shape, index) => <button ref={(button) => { buttons.current[index] = button }} key={shape.id} type="button" disabled={disabled} tabIndex={index === Math.min(active, shapes.length - 1) ? 0 : -1} aria-label={shape.label} title={shape.description} onFocus={() => setActive(index)} onKeyDown={(event) => onButtonKey(event, index)} onClick={() => choose(shape.id)}><ShapeIcon shape={shape.id} /><span>{shape.label}<small>{shape.description}</small></span></button>)}
    </div>
    {!shapes.length && <p className="diagram-palette-empty" role="status">No matching shapes. Try another name.</p>}
  </div>
}
