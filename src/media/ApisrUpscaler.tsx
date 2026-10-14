import { useEffect, useMemo, useRef, useState } from 'react'
import { convertFileSrc } from '@tauri-apps/api/core'
import { saveGeneratedImage } from '../storage/workspace'
import { managedAsset, type BoardModel, type ProjectAsset } from '../model/project'
import './ApisrUpscaler.css'

// The former custom FP16 APISR conversion cannot initialize in ONNX Runtime. This
// maintained Transformers.js conversion is loaded through its supported pipeline API.
const MODEL_ID = 'Xenova/swin2SR-classical-sr-x2-64'
const MODEL_LABEL = 'Swin2SR 2× local super-resolution'
const MODEL_LICENSE = 'Apache-2.0 model conversion · cached locally after first use'
const SCALE = 2
const MAX_GPU_SOURCE_PIXELS = 2_250_000
const MAX_WASM_SOURCE_PIXELS = 900_000

type JobState = 'queued' | 'working' | 'done' | 'error' | 'cancelled'
type JobRow = { id: string; state: JobState; detail: string; output?: string }
type RawImageResult = { data: Uint8Array | Uint8ClampedArray; width: number; height: number; channels: number }
type ImagePipeline = ((input: Blob) => Promise<RawImageResult>) & { dispose?: () => Promise<void> }
type Runtime = 'webgpu' | 'wasm'

type ApisrUpscalerProps = {
  assets: ProjectAsset[]
  board: BoardModel
  projectId: string
  projectName: string
  workspaceRoot: string
  readOnly: boolean
  embedded?: boolean
  initialSelectedIds?: string[]
  onGenerated: (asset: ProjectAsset, addToBoard: boolean) => void
  onClose: () => void
}

export function ApisrUpscaler({ assets, board, projectId, projectName, workspaceRoot, readOnly, embedded = false, initialSelectedIds, onGenerated, onClose }: ApisrUpscalerProps) {
  const images = useMemo(() => assets.filter((asset) => asset.kind === 'image' && asset.status !== 'missing'), [assets])
  const boardImageIds = useMemo(() => new Set(board.nodes.filter((node) => node.kind === 'image' && node.assetId).map((node) => node.assetId!)), [board.nodes])
  const [selectedIds, setSelectedIds] = useState<string[]>(() => initialSelectedIds?.length ? images.filter((asset) => initialSelectedIds.includes(asset.id)).map((asset) => asset.id) : images.filter((asset) => boardImageIds.has(asset.id)).map((asset) => asset.id))
  const [operation, setOperation] = useState<'upscale-2x' | 'upscale-4x' | 'enhance-resize'>('upscale-2x')
  const [targetPercent, setTargetPercent] = useState(50)
  const [format, setFormat] = useState<'png' | 'jpeg' | 'webp'>('png')
  const [quality, setQuality] = useState(94)
  const [nameTemplate, setNameTemplate] = useState('{name}_SR_{scale}')
  const [addToBoard, setAddToBoard] = useState(true)
  const [running, setRunning] = useState(false)
  const [provider, setProvider] = useState('Not prepared')
  const [modelError, setModelError] = useState('')
  const [rows, setRows] = useState<JobRow[]>([])
  const [overall, setOverall] = useState({ done: 0, total: 0 })
  const pipelineRef = useRef<ImagePipeline | null>(null)
  const runtimeRef = useRef<Runtime | null>(null)
  const cancelledRef = useRef(false)

  useEffect(() => () => { void pipelineRef.current?.dispose?.() }, [])

  function updateRow(id: string, update: Partial<JobRow>) {
    setRows((current) => current.map((row) => row.id === id ? { ...row, ...update } : row))
  }

  async function createPipeline(runtime: Runtime) {
    const { env, pipeline } = await import('@huggingface/transformers')
    env.allowRemoteModels = true
    env.allowLocalModels = false
    env.useBrowserCache = true
    return await pipeline('image-to-image', MODEL_ID, { dtype: 'q4', device: runtime }) as unknown as ImagePipeline
  }

  async function ensurePipeline(preferred: Runtime | null = null) {
    if (pipelineRef.current && (!preferred || runtimeRef.current === preferred)) return pipelineRef.current
    if (pipelineRef.current) {
      await pipelineRef.current.dispose?.()
      pipelineRef.current = null
      runtimeRef.current = null
    }
    setModelError('')
    const candidates: Runtime[] = preferred ? [preferred] : navigator.gpu ? ['webgpu', 'wasm'] : ['wasm']
    let lastError: unknown
    for (const runtime of candidates) {
      try {
        setProvider(runtime === 'webgpu' ? 'Preparing WebGPU model…' : 'Preparing CPU / WASM model…')
        const instance = await createPipeline(runtime)
        pipelineRef.current = instance
        runtimeRef.current = runtime
        setProvider(runtime === 'webgpu' ? 'WebGPU · model ready' : 'CPU / WASM · model ready')
        return instance
      } catch (error) {
        lastError = error
      }
    }
    setProvider('Unavailable')
    throw new Error(`Could not prepare the local super-resolution model. ${String(lastError)}`)
  }

  async function prepareModel() {
    try { await ensurePipeline() } catch (error) { setModelError(String(error)) }
  }

  async function runImage(asset: ProjectAsset, source: Blob, passCount: number) {
    let pipeline = await ensurePipeline()
    let result: RawImageResult
    try {
      updateRow(asset.id, { state: 'working', detail: `${runtimeRef.current === 'webgpu' ? 'GPU' : 'CPU'} pass 1/${passCount}…` })
      result = await pipeline(source)
    } catch (error) {
      if (runtimeRef.current !== 'webgpu') throw error
      // A driver or GPU-memory failure should not make the tool unusable.
      updateRow(asset.id, { state: 'working', detail: 'GPU unavailable; retrying on CPU / WASM…' })
      pipeline = await ensurePipeline('wasm')
      result = await pipeline(source)
    }
    for (let pass = 2; pass <= passCount; pass += 1) {
      if (cancelledRef.current) throw new DOMException('Cancelled', 'AbortError')
      updateRow(asset.id, { state: 'working', detail: `${runtimeRef.current === 'webgpu' ? 'GPU' : 'CPU'} pass ${pass}/${passCount}…` })
      result = await pipeline(await rawToPngBlob(result))
    }
    return rawToCanvas(result)
  }

  async function runBatch() {
    const selected = images.filter((asset) => selectedIds.includes(asset.id))
    if (!selected.length || running) return
    cancelledRef.current = false
    setRunning(true)
    setOverall({ done: 0, total: selected.length })
    setRows(selected.map((asset) => ({ id: asset.id, state: 'queued', detail: 'Queued' })))
    try {
      await ensurePipeline()
      for (const [index, asset] of selected.entries()) {
        if (cancelledRef.current) {
          updateRow(asset.id, { state: 'cancelled', detail: 'Cancelled before processing' })
          continue
        }
        try {
          updateRow(asset.id, { state: 'working', detail: 'Reading original from disk…' })
          const source = await loadAsset(asset, workspaceRoot)
          const passCount = operation === 'upscale-4x' ? 2 : 1
          const inferredWidth = source.width * SCALE ** passCount
          const inferredHeight = source.height * SCALE ** passCount
          const sourceLimit = runtimeRef.current === 'webgpu' ? MAX_GPU_SOURCE_PIXELS : MAX_WASM_SOURCE_PIXELS
          if (source.width * source.height > sourceLimit) throw new Error(`${source.width} × ${source.height} exceeds the ${runtimeRef.current === 'webgpu' ? 'GPU' : 'CPU'} safety limit. Reduce it first, or use a GPU-enabled system.`)
          validateCanvasSize(inferredWidth, inferredHeight)
          const enhanced = await runImage(asset, source.blob, passCount)
          if (cancelledRef.current) throw new DOMException('Cancelled', 'AbortError')
          const outputWidth = operation === 'enhance-resize' ? Math.max(1, Math.round(source.width * targetPercent / 100)) : inferredWidth
          const outputHeight = operation === 'enhance-resize' ? Math.max(1, Math.round(source.height * targetPercent / 100)) : inferredHeight
          validateCanvasSize(outputWidth, outputHeight)
          const output = enhanced.width === outputWidth && enhanced.height === outputHeight ? enhanced : progressiveResize(enhanced, outputWidth, outputHeight)
          updateRow(asset.id, { state: 'working', detail: 'Encoding output…' })
          const blob = await canvasBlob(output, format, quality / 100)
          const extension = format === 'jpeg' ? 'jpg' : format
          const scaleLabel = operation === 'enhance-resize' ? `${targetPercent}pct` : operation === 'upscale-4x' ? '4x' : '2x'
          const sourceStem = asset.displayName.replace(/\.[^.]+$/, '')
          const fileName = `${renderName(nameTemplate, { name: sourceStem, project: projectName, board: board.title, scale: scaleLabel, n: String(index + 1).padStart(String(selected.length).length, '0') })}.${extension}`
          const record = await saveGeneratedImage(new Uint8Array(await blob.arrayBuffer()), { projectId, projectName, boardName: board.title, fileName })
          const generated: ProjectAsset = {
            ...managedAsset(record), displayName: record.originalName.replace(/\.[^.]+$/, ''), virtualFolder: `Generated / Super-resolution / ${board.title}`, managedRelativePath: record.relativePath, status: 'available',
            generated: { engine: 'Swin2SR-q4', modelSha256: MODEL_ID, sourceAssetId: asset.id, sourceRelativePath: asset.relativePath, boardId: board.id, operation, targetPercent: operation === 'enhance-resize' ? targetPercent : undefined, sourceWidth: source.width, sourceHeight: source.height, outputWidth, outputHeight, generatedAt: new Date().toISOString() },
          }
          onGenerated(generated, addToBoard)
          updateRow(asset.id, { state: 'done', detail: `${outputWidth} × ${outputHeight} · saved to disk`, output: record.originalName })
        } catch (error) {
          const cancelled = error instanceof DOMException && error.name === 'AbortError'
          updateRow(asset.id, { state: cancelled ? 'cancelled' : 'error', detail: cancelled ? 'Cancelled' : String(error) })
        }
        setOverall({ done: index + 1, total: selected.length })
      }
    } catch (error) { setModelError(String(error)) } finally { setRunning(false) }
  }

  return <div className={`upscaler-overlay ${embedded ? 'upscaler-embedded' : ''}`} role="presentation">
    <section className="upscaler-panel" aria-label="Local super-resolution batch processor">
      <header><div><span className="eyebrow">Mini Bridge · Local AI processing</span><h2>Local super-resolution</h2><p>Original → local 2× model → optional second pass or high-quality reduction. Outputs remain separate files on disk.</p></div><button type="button" disabled={running} onClick={onClose}>{embedded ? 'Back to assets' : '×'}</button></header>
      <div className="upscaler-model"><span className={provider.includes('ready') ? 'verified' : 'missing'}>●</span><div><strong>{MODEL_LABEL}</strong><small>{MODEL_LICENSE} · {provider}</small>{modelError && <em>{modelError}</em>}</div><button type="button" disabled={running || readOnly} onClick={() => void prepareModel()}>{provider.includes('ready') ? 'Reload model' : 'Prepare offline cache'}</button></div>
      <div className="upscaler-body"><aside className="upscaler-settings">
        <label>Operation<select value={operation} disabled={running} onChange={(event) => setOperation(event.target.value as typeof operation)}><option value="upscale-2x">Local 2× output</option><option value="upscale-4x">Local 4× output (two passes)</option><option value="enhance-resize">Enhance then resize</option></select></label>
        {operation === 'enhance-resize' && <label>Final size (% of original)<input type="number" min="5" max="400" value={targetPercent} disabled={running} onChange={(event) => setTargetPercent(Math.min(400, Math.max(5, Number(event.target.value) || 5)))} /></label>}
        <label>Output format<select value={format} disabled={running} onChange={(event) => setFormat(event.target.value as typeof format)}><option value="png">PNG · lossless</option><option value="jpeg">JPEG</option><option value="webp">WebP</option></select></label>
        {format !== 'png' && <label>Quality<input type="range" min="70" max="100" value={quality} disabled={running} onChange={(event) => setQuality(Number(event.target.value))} /><span>{quality}</span></label>}
        <label>File naming<input value={nameTemplate} disabled={running} onChange={(event) => setNameTemplate(event.target.value)} /><small>{'{name} {project} {board} {scale} {n}'}</small></label>
        <label className="upscaler-check"><input type="checkbox" checked={addToBoard} disabled={running} onChange={(event) => setAddToBoard(event.target.checked)} /> Place outputs on this board</label>
        <div className="output-path"><span>Disk output</span><code>projects/{projectId}/outputs/{projectName}/{board.title}/Super-resolution/</code></div>
      </aside><main className="upscaler-files"><div className="upscaler-file-tools"><strong>{selectedIds.length} of {images.length} images selected</strong><button type="button" disabled={running} onClick={() => setSelectedIds(images.filter((asset) => boardImageIds.has(asset.id)).map((asset) => asset.id))}>This board</button><button type="button" disabled={running} onClick={() => setSelectedIds(images.map((asset) => asset.id))}>All project images</button><button type="button" disabled={running} onClick={() => setSelectedIds([])}>Clear</button></div>
        <div className="upscaler-file-list">{images.length ? images.map((asset) => { const row = rows.find((entry) => entry.id === asset.id); return <label className={`upscaler-file ${row?.state || ''}`} key={asset.id}><input type="checkbox" checked={selectedIds.includes(asset.id)} disabled={running} onChange={(event) => setSelectedIds((current) => event.target.checked ? [...current, asset.id] : current.filter((id) => id !== asset.id))} /><span><strong>{asset.displayName}</strong><small>{asset.originalName} · {formatBytes(asset.byteLength)}</small>{row && <em>{row.detail}{row.output ? ` · ${row.output}` : ''}</em>}</span></label> }) : <div className="upscaler-empty">Import images into this project before starting a batch.</div>}</div>
      </main></div>
      <footer><progress max={Math.max(1, overall.total)} value={overall.done} /><span>{overall.total ? `${overall.done}/${overall.total}` : 'Ready'}</span><button type="button" disabled={!running} onClick={() => { cancelledRef.current = true }}>Stop after current image</button><button className="primary-button" type="button" disabled={running || readOnly || !selectedIds.length} onClick={() => void runBatch()}>{running ? 'Processing…' : `Process ${selectedIds.length} image${selectedIds.length === 1 ? '' : 's'}`}</button></footer>
    </section>
  </div>
}

async function loadAsset(asset: ProjectAsset, workspaceRoot: string) {
  const path = `${workspaceRoot.replace(/[\\/]+$/, '')}\\${asset.relativePath.replaceAll('/', '\\')}`
  const response = await fetch(convertFileSrc(path))
  if (!response.ok) throw new Error(`Could not read ${asset.displayName}`)
  const blob = await response.blob()
  const bitmap = await createImageBitmap(blob)
  const result = { blob, width: bitmap.width, height: bitmap.height }
  bitmap.close()
  return result
}

function rawToCanvas(raw: RawImageResult) {
  const canvas = document.createElement('canvas')
  canvas.width = raw.width
  canvas.height = raw.height
  const context = canvas.getContext('2d', { alpha: false })!
  const image = context.createImageData(raw.width, raw.height)
  const pixels = raw.width * raw.height
  for (let index = 0; index < pixels; index += 1) {
    const source = index * raw.channels
    const target = index * 4
    image.data[target] = raw.data[source]
    image.data[target + 1] = raw.data[source + Math.min(1, raw.channels - 1)]
    image.data[target + 2] = raw.data[source + Math.min(2, raw.channels - 1)]
    image.data[target + 3] = raw.channels === 4 ? raw.data[source + 3] : 255
  }
  context.putImageData(image, 0, 0)
  return canvas
}

async function rawToPngBlob(raw: RawImageResult) { return canvasBlob(rawToCanvas(raw), 'png', 1) }

function progressiveResize(source: HTMLCanvasElement, width: number, height: number) {
  let current = source
  while (current.width / 2 > width && current.height / 2 > height) {
    const next = document.createElement('canvas')
    next.width = Math.max(width, Math.round(current.width / 2)); next.height = Math.max(height, Math.round(current.height / 2))
    const context = next.getContext('2d', { alpha: false })!; context.imageSmoothingEnabled = true; context.imageSmoothingQuality = 'high'; context.drawImage(current, 0, 0, next.width, next.height); current = next
  }
  if (current.width === width && current.height === height) return current
  const final = document.createElement('canvas'); final.width = width; final.height = height
  const context = final.getContext('2d', { alpha: false })!; context.imageSmoothingEnabled = true; context.imageSmoothingQuality = 'high'; context.drawImage(current, 0, 0, width, height)
  return final
}

function validateCanvasSize(width: number, height: number) {
  if (width > 32767 || height > 32767 || width * height > 180_000_000) throw new Error(`Requested output ${width} × ${height} exceeds the safe canvas limit. Use Enhance then resize for this source.`)
}

function canvasBlob(canvas: HTMLCanvasElement, format: 'png' | 'jpeg' | 'webp', quality: number) {
  return new Promise<Blob>((resolve, reject) => canvas.toBlob((blob) => blob ? resolve(blob) : reject(new Error(`Could not encode ${format.toUpperCase()} output`)), `image/${format}`, quality))
}

function renderName(template: string, values: Record<string, string>) {
  let rendered = template.trim() || '{name}_SR_{scale}'
  Object.entries(values).forEach(([token, value]) => { rendered = rendered.replaceAll(`{${token}}`, value) })
  return rendered.replace(/[\\/:*?"<>|]+/g, '-').replace(/\s+/g, ' ').trim().slice(0, 120) || 'super-resolution-output'
}

function formatBytes(bytes: number) {
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`
  return `${(bytes / (1024 * 1024)).toFixed(bytes >= 1024 * 1024 * 1024 ? 0 : 1)} MB`
}
