import { converter, formatHex } from 'culori'
import { useRef, useState } from 'react'
import type { CSSProperties, PointerEvent as ReactPointerEvent, ReactNode } from 'react'
import './ColorPanel.css'

export type ColorTarget = 'fill' | 'stroke' | 'text' | 'columnBody' | 'background' | 'grid'

type ColorPanelProps = {
  contextIdentity: string
  value: string
  opacity: number
  swatches: string[]
  title?: string
  target: ColorTarget
  targets?: ColorTarget[]
  targetLabels?: Partial<Record<ColorTarget, string>>
  contrastBackground?: string
  className?: string
  embedded?: boolean
  controls?: ReactNode
  onTargetChange: (target: ColorTarget) => void
  onChange: (value: string, opacity: number) => void
  onSwatchesChange: (swatches: string[]) => void
  onClose: () => void
}

const toRgb = converter('rgb')
const toHsl = converter('hsl')
const toOklch = converter('oklch')
const FULL_PALETTE = [
  '#17191f', '#3a3f48', '#6f7884', '#dfe3e8', '#fffaf3', '#f4d7c6',
  '#e7a08e', '#c95755', '#8f2f3b', '#f0bb72', '#d68b3d', '#a66e36',
  '#f2df7d', '#c5b44c', '#78985d', '#3f7659', '#65bcb0', '#277b77',
  '#6ca5c5', '#35658c', '#5867a5', '#8d72b0', '#b35f95', '#6e4569',
]

function HexColorInput({ value, opacity, onChange }: Pick<ColorPanelProps, 'value' | 'opacity' | 'onChange'>) {
  const [draft, setDraft] = useState(() => value.toUpperCase())
  const cancelBlur = useRef(false)
  return <input aria-label="Hex color" spellCheck={false} value={draft}
    onChange={(event) => { cancelBlur.current = false; setDraft(event.target.value) }}
    onBlur={() => {
      const next = draft.trim()
      if (!cancelBlur.current && /^#[0-9a-f]{6}$/i.test(next) && next.toLowerCase() !== value.toLowerCase()) onChange(next.toLowerCase(), opacity)
      cancelBlur.current = false
      setDraft(value.toUpperCase())
    }}
    onKeyDown={(event) => {
      if (event.key === 'Enter') { event.preventDefault(); event.stopPropagation(); event.currentTarget.blur() }
      else if (event.key === 'Escape') { event.preventDefault(); event.stopPropagation(); cancelBlur.current = true; setDraft(value.toUpperCase()) }
    }}
  />
}

export function ColorPanel({ contextIdentity, value, opacity, swatches, title, target, targets = ['fill', 'stroke', 'text'], targetLabels, contrastBackground = '#15171b', className, embedded = false, controls, onTargetChange, onChange, onSwatchesChange, onClose }: ColorPanelProps) {
  const [recentSwatches, setRecentSwatches] = useState<string[]>(() => swatches.slice(0, 8))
  const rgb = toRgb(value) || { mode: 'rgb' as const, r: 0.84, g: 0.64, b: 0.42 }
  const hsl = toHsl(value) || { mode: 'hsl' as const, h: 32, s: 0.52, l: 0.63 }
  const oklch = toOklch(value) || { mode: 'oklch' as const, l: 0.74, c: 0.1, h: 60 }
  const hsv = rgbToHsv(rgb.r, rgb.g, rgb.b)
  const contrast = contrastRatio(value, contrastBackground)

  function setColor(color: Parameters<typeof formatHex>[0]) {
    const formatted = formatHex(color)
    if (formatted) {
      onChange(formatted, opacity)
      setRecentSwatches((current) => [formatted, ...current.filter((entry) => entry !== formatted)].slice(0, 8))
    }
  }

  function setHue(event: ReactPointerEvent<HTMLDivElement>) {
    const bounds = event.currentTarget.getBoundingClientRect()
    const angle = Math.atan2(event.clientY - (bounds.top + bounds.height / 2), event.clientX - (bounds.left + bounds.width / 2)) * 180 / Math.PI
    const hue = (angle + 90 + 360) % 360
    setColor(hsvToRgb(hue, hsv.s, hsv.v))
  }

  function setSaturationValue(event: ReactPointerEvent<HTMLDivElement>) {
    const bounds = event.currentTarget.getBoundingClientRect()
    const saturation = clamp((event.clientX - bounds.left) / bounds.width)
    const brightness = clamp(1 - (event.clientY - bounds.top) / bounds.height)
    setColor(hsvToRgb(hsv.h, saturation, brightness))
  }

  return (
    <aside className={`professional-color ${className || ''}`} aria-label="Color controls">
      {!embedded && <header><div><strong>Color</strong>{title && <small>{title}</small>}</div><button type="button" aria-label="Close color controls" onClick={onClose}>×</button></header>}
      {targets.length ? <div className="color-targets" style={{ gridTemplateColumns: `repeat(${targets.length},1fr)` }} role="group" aria-label="Color target">{targets.map((entry) => <button className={target === entry ? 'active' : ''} type="button" key={entry} onClick={() => onTargetChange(entry)}>{targetLabels?.[entry] || entry[0].toUpperCase() + entry.slice(1)}</button>)}</div> : <div className="color-empty-state">Select an object to edit its colors.</div>}
      <fieldset className="color-editor-fields" disabled={!targets.length}>
      {controls}
      <div className="hue-ring" onPointerDown={(event) => { event.currentTarget.setPointerCapture(event.pointerId); setHue(event) }} onPointerMove={(event) => event.buttons === 1 && setHue(event)} style={{ '--hue': hsv.h } as CSSProperties}>
        <div className="sv-field" onPointerDown={(event) => { event.stopPropagation(); event.currentTarget.setPointerCapture(event.pointerId); setSaturationValue(event) }} onPointerMove={(event) => { if (event.buttons === 1) { event.stopPropagation(); setSaturationValue(event) } }}>
          <i style={{ left: `${hsv.s * 100}%`, top: `${(1 - hsv.v) * 100}%` }} />
        </div>
      </div>
      <div className="color-hex-row"><span style={{ background: value }} /><HexColorInput key={JSON.stringify([contextIdentity, target, value, opacity])} value={value} opacity={opacity} onChange={onChange} /><strong>{Math.round(opacity * 100)}%</strong></div>
      <div className="color-values"><label>R<input type="number" min="0" max="255" value={Math.round(rgb.r * 255)} onChange={(event) => setColor({ ...rgb, r: Number(event.target.value) / 255 })} /></label><label>G<input type="number" min="0" max="255" value={Math.round(rgb.g * 255)} onChange={(event) => setColor({ ...rgb, g: Number(event.target.value) / 255 })} /></label><label>B<input type="number" min="0" max="255" value={Math.round(rgb.b * 255)} onChange={(event) => setColor({ ...rgb, b: Number(event.target.value) / 255 })} /></label></div>
      <div className="color-values"><label>H<input type="number" value={Math.round(hsl.h || 0)} onChange={(event) => setColor({ ...hsl, h: Number(event.target.value) })} /></label><label>S<input type="number" value={Math.round((hsl.s || 0) * 100)} onChange={(event) => setColor({ ...hsl, s: Number(event.target.value) / 100 })} /></label><label>L<input type="number" value={Math.round((hsl.l || 0) * 100)} onChange={(event) => setColor({ ...hsl, l: Number(event.target.value) / 100 })} /></label></div>
      <div className="color-values oklch-values"><label>L<input type="number" step=".01" value={(oklch.l || 0).toFixed(2)} onChange={(event) => setColor({ ...oklch, l: Number(event.target.value) })} /></label><label>C<input type="number" step=".01" value={(oklch.c || 0).toFixed(2)} onChange={(event) => setColor({ ...oklch, c: Number(event.target.value) })} /></label><label>H<input type="number" value={Math.round(oklch.h || 0)} onChange={(event) => setColor({ ...oklch, h: Number(event.target.value) })} /></label></div>
      <label className="opacity-control"><span>Opacity</span><input aria-label="Color opacity" type="range" min="0" max="100" value={Math.round(opacity * 100)} onChange={(event) => onChange(value, Number(event.target.value) / 100)} /></label>
      <div className="contrast-readout"><span>Contrast on canvas</span><strong>{contrast.toFixed(2)}:1</strong><em>{contrast >= 4.5 ? 'AA text' : contrast >= 3 ? 'AA large' : 'Decorative only'}</em></div>
      <section className="color-palette" aria-label="Full color palette"><header><strong>Palette</strong><label className="custom-color"><input type="color" aria-label="Custom color" value={value} onChange={(event) => setColor(event.target.value)} /><span>Custom</span></label></header><div className="palette-grid">{FULL_PALETTE.map((color) => <button key={color} type="button" style={{ background: color }} title={color} aria-label={`Use palette color ${color}`} onClick={() => setColor(color)} />)}</div></section>
      {recentSwatches.length > 0 && <section className="swatch-section" aria-label="Recent colors"><header><strong>Recent</strong><small>{recentSwatches.length}</small></header><div className="managed-swatches">{recentSwatches.map((color) => <button key={color} type="button" style={{ background: color }} title={color} aria-label={`Use recent swatch ${color}`} onClick={() => setColor(color)} />)}</div></section>}
      <section className="swatch-section" aria-label="Project swatches"><header><strong>Project</strong><small>{swatches.length}</small></header><div className="managed-swatches">{swatches.map((color) => <button key={color} type="button" style={{ background: color }} title={color} aria-label={`Use project swatch ${color}`} onClick={() => setColor(color)} />)}<button className="add-swatch" type="button" aria-label="Save current swatch" onClick={() => !swatches.includes(value) && onSwatchesChange([...swatches, value])}>＋</button></div></section>
      </fieldset>
    </aside>
  )
}

function clamp(value: number) { return Math.min(1, Math.max(0, value)) }

function rgbToHsv(r: number, g: number, b: number) {
  const max = Math.max(r, g, b), min = Math.min(r, g, b), delta = max - min
  let h = 0
  if (delta) {
    if (max === r) h = 60 * (((g - b) / delta) % 6)
    else if (max === g) h = 60 * ((b - r) / delta + 2)
    else h = 60 * ((r - g) / delta + 4)
  }
  return { h: (h + 360) % 360, s: max ? delta / max : 0, v: max }
}

function hsvToRgb(h: number, s: number, v: number) {
  const c = v * s, x = c * (1 - Math.abs(((h / 60) % 2) - 1)), m = v - c
  const [r, g, b] = h < 60 ? [c, x, 0] : h < 120 ? [x, c, 0] : h < 180 ? [0, c, x] : h < 240 ? [0, x, c] : h < 300 ? [x, 0, c] : [c, 0, x]
  return { mode: 'rgb' as const, r: r + m, g: g + m, b: b + m }
}

function contrastRatio(foreground: string, background: string) {
  const luminance = (hex: string) => {
    const color = toRgb(hex) || { r: 0, g: 0, b: 0 }
    const channel = (value: number) => value <= .03928 ? value / 12.92 : ((value + .055) / 1.055) ** 2.4
    return .2126 * channel(color.r) + .7152 * channel(color.g) + .0722 * channel(color.b)
  }
  const a = luminance(foreground), b = luminance(background)
  return (Math.max(a, b) + .05) / (Math.min(a, b) + .05)
}
