import { useEffect, useState } from 'react'
import { invoke, isTauri } from '@tauri-apps/api/core'
import { recordMetric } from '../diagnostics/performance'
type Result = { requested: string; used: string; width: number; height: number; rgbaBase64: string; exactPixels: boolean; backendSucceeded: boolean; fallbackReason?: string; details: { device?: string; workers?: number; setupMs?: number; transferComputeReadbackMs?: number; adapterBackend?: string; backendFallbacks?: string[]; buffersCreated?: boolean; retainedBufferBytes?: number; luidMatched?: boolean; maxChannelDelta?: number; hardwareBackendAvailable?: boolean }; backendEndToEndMs: number; isolatedRoundTripMs: number }
export function ExperimentalPreparationSettings() {
  const [session, setSession] = useState<{ phase: string; ready: boolean; warmup?: { warmupMs: number } }>()
  useEffect(() => {
    if (!isTauri()) return
    let stopped = false, timer: ReturnType<typeof setTimeout> | undefined
    const refresh = async () => {
      try { const result = await invoke<NonNullable<typeof session>>('inspect_preparation_session'); if (stopped) return; setSession(result); if (result.phase === 'warming') timer = setTimeout(() => void refresh(), 500); else recordMetric('engine.compute-session', { phase: result.phase, warmupMs: result.warmup?.warmupMs || 0 }) }
      catch { if (!stopped) setSession({ phase: 'unavailable', ready: false }) }
    }
    void refresh()
    return () => { stopped = true; clearTimeout(timer) }
  }, [])
  const [busy, setBusy] = useState(false), [rows, setRows] = useState<Array<{ label: string; result?: Omit<Result, 'rgbaBase64'>; error?: string }>>([])
  const [message, setMessage] = useState('')
  const compare = async () => {
    if (busy) return
    setBusy(true); setRows([]); setMessage('Comparing a small image preparation job…')
    const width = 512, height = 513, bytes = new Uint8Array(width * height * 4)
    for (let index = 0; index < bytes.length; index++) bytes[index] = index % 251
    let binary = ''
    for (let offset = 0; offset < bytes.length; offset += 16384) binary += String.fromCharCode(...bytes.subarray(offset, offset + 16384))
    const rgbaBase64 = btoa(binary)
    let baseline: string | undefined
    try {
      for (const [backend, workers] of [['cpu', 1], ['cpu', 2], ['cpu', 4], ['wgpu', undefined], ['dx12', undefined], ['vulkan', undefined], ['opencl', undefined], ['cuda-dx12', undefined], ['cuda-dx12-upload', undefined]] as const) {
        const label = backend === 'cpu' ? `CPU · ${workers} workers requested` : backend === 'wgpu' ? 'Automatic native compute' : `${backend.toUpperCase()} compute`
        try {
          const result = await invoke<Result>('prepare_image_experimental', { request: { width, height, rgbaBase64, backend, workers } })
          baseline ??= result.rgbaBase64
          if (!result.exactPixels || result.rgbaBase64 !== baseline || result.width !== 256 || result.height !== 257) throw new Error('Prepared pixels differ from the CPU reference')
          const { rgbaBase64: _pixels, ...summary } = result
          setRows(previous => [...previous, { label, result: summary }])
          recordMetric('engine.experimental-preparation', { requested: backend, used: result.used, workers: result.details.workers || 0, backendSucceeded: result.backendSucceeded, backendMs: result.backendEndToEndMs, roundTripMs: result.isolatedRoundTripMs, setupMs: result.details.setupMs || 0, transferComputeReadbackMs: result.details.transferComputeReadbackMs || 0 })
        } catch (error) { setRows(previous => [...previous, { label, error: String(error).slice(0, 500) }]); recordMetric('engine.experimental-preparation-error', { requested: backend }) }
      }
      setMessage('Comparison finished. Canvas rendering and project files are unchanged.')
    } finally { setBusy(false) }
  }
  const compareJpeg = async () => {
    if (busy) return
    setBusy(true); setMessage('Comparing bounded JPEG decoding…')
    try {
      const canvas = document.createElement('canvas'); canvas.width = 513; canvas.height = 257
      const context = canvas.getContext('2d'); if (!context) throw new Error('JPEG fixture creation unavailable')
      const image = context.createImageData(513, 257)
      for (let p = 0; p < image.data.length; p += 4) { const v = (p / 4) % 251; image.data[p] = v; image.data[p + 1] = v; image.data[p + 2] = v; image.data[p + 3] = 255 }
      context.putImageData(image, 0, 0)
      const jpegBase64 = canvas.toDataURL('image/jpeg', 0.9).split(',')[1]
      const result = await invoke<Result>('prepare_jpeg_experimental', { request: { jpegBase64 } })
      const { rgbaBase64: _pixels, ...summary } = result
      setRows(previous => [...previous.filter(row => row.label !== 'nvJPEG decode'), { label: 'nvJPEG decode', result: summary }])
      recordMetric('engine.experimental-jpeg', { used: result.used, backendMs: result.backendEndToEndMs, maxChannelDelta: result.details.maxChannelDelta || 0, hardwareBackendAvailable: result.details.hardwareBackendAvailable || false })
      setMessage('JPEG comparison finished. Decoder rounding and fallback are reported separately.')
    } catch (error) { setMessage(String(error).slice(0, 500)) } finally { setBusy(false) }
  }
  return <section><h3>Experimental image preparation</h3><p>Compare CPU workers, automatic native compute, DX12, Vulkan, OpenCL and CUDA/DX12 sharing on the same small, alpha-aware image reduction. Each accelerator must match the CPU pixels.</p>
    <small>Compute session: {session?.phase || 'unavailable'}{session?.warmup ? ` · startup preparation ${session.warmup.warmupMs.toFixed(1)} ms` : ''}</small>
    <button type="button" disabled={!isTauri() || busy || !session?.ready} onClick={() => void compare()}>{busy ? 'Comparing…' : 'Compare image preparation'}</button>
    <button type="button" disabled={!isTauri() || busy || !session?.ready} onClick={() => void compareJpeg()}>Compare JPEG decoding</button>
    <small>Devices and shaders prepare in the background at launch and stay ready in an isolated helper. Startup cost is shown separately; each job includes transfers and helper communication. This does not qualify canvas or 4K performance.</small>
    {rows.map(row => <div key={row.label}><strong>{row.label}</strong>{row.result ? <><p>{row.result.used} · {row.result.details.device || 'CPU fallback'}{row.result.details.workers ? ` · ${row.result.details.workers} active workers` : ''} · {row.result.isolatedRoundTripMs.toFixed(1)} ms total</p><small>Backend preparation {row.result.backendEndToEndMs.toFixed(1)} ms{row.result.details.setupMs !== undefined ? ` · setup ${row.result.details.setupMs.toFixed(1)} ms · copy/compute/readback ${row.result.details.transferComputeReadbackMs?.toFixed(1)} ms` : ''} · {row.result.exactPixels ? 'exact pixels' : `JPEG rounding delta ${row.result.details.maxChannelDelta}/255`}{row.result.details.buffersCreated !== undefined ? ` · ${row.result.details.buffersCreated ? 'buffers allocated' : 'buffers reused'}` : ''}</small>{row.result.details.backendFallbacks?.map(reason => <p key={reason}>{reason}</p>)}{row.result.fallbackReason && <p>{row.result.fallbackReason}</p>}</> : <p>{row.error}</p>}</div>)}
    <small role="status">{message}</small></section>
}
