import { useEffect, useState } from 'react'
import { initializeCanvas, readPsd, type Layer } from 'ag-psd'
import './PsdPreview.css'

type Props = { source: string; title: string }
type Info = { width: number; height: number; depth?: number; mode?: string; layers: Array<{ name: string; hidden: boolean; opacity?: number; blend?: string; group: boolean }> }
let canvasReady = false
function initCanvas() { if (!canvasReady) { initializeCanvas((width, height) => { const canvas = document.createElement('canvas'); canvas.width = width; canvas.height = height; return canvas }); canvasReady = true } }
function flatten(layers: Layer[] | undefined, output: Info['layers'] = []): Info['layers'] { for (const layer of layers || []) { output.push({ name: layer.name || 'Untitled layer', hidden: Boolean(layer.hidden), opacity: layer.opacity, blend: layer.blendMode, group: Boolean(layer.children?.length) }); flatten(layer.children, output) } return output }

export function PsdPreview({ source, title }: Props) {
  const [preview, setPreview] = useState<string>(); const [info, setInfo] = useState<Info>(); const [error, setError] = useState<string>(); const [showLayers, setShowLayers] = useState(false)
  useEffect(() => {
    let cancelled = false; setPreview(undefined); setInfo(undefined); setError(undefined)
    void fetch(source).then((response) => { if (!response.ok) throw new Error('PSD file is unavailable'); return response.arrayBuffer() }).then((buffer) => { initCanvas(); const psd = readPsd(buffer, { skipLayerImageData: true, logMissingFeatures: false }); if (cancelled) return; setInfo({ width: psd.width, height: psd.height, depth: psd.bitsPerChannel, mode: psd.colorMode ? String(psd.colorMode) : undefined, layers: flatten(psd.children) }); setPreview(psd.canvas?.toDataURL('image/png')) }).catch((reason) => !cancelled && setError(String(reason))).catch(() => undefined)
    return () => { cancelled = true }
  }, [source])
  return <section className="psd-preview" aria-label={`PSD preview: ${title}`}>{preview ? <img src={preview} alt={`${title} flattened composite`}/> : <div className="psd-preview-empty">{error ? <><strong>Preview unavailable</strong><span>{error}</span></> : 'Reading PSD composite…'}</div>}{info && <div className="psd-preview-meta"><span>{info.width} × {info.height}</span><span>{info.depth || '?'} bit · {info.mode || 'unknown'}</span><button type="button" onClick={() => setShowLayers((visible) => !visible)}>{info.layers.length} layers</button></div>}{showLayers && info && <aside className="psd-layer-list">{info.layers.map((layer, index) => <div key={`${layer.name}-${index}`}><span>{layer.group ? '▾' : '•'}</span><strong>{layer.name}</strong><small>{layer.hidden ? 'hidden' : `${Math.round((layer.opacity ?? 255) / 255 * 100)}%`} · {layer.blend || 'normal'}</small></div>)}</aside>}</section>
}
