import { useEffect, useState, useRef } from 'react'
import { invoke, isTauri } from '@tauri-apps/api/core'
import { hydrateLaunchPreferences, launchLanguages, saveLaunchPreferences, useLaunchPreferences } from './launchPreferences'
import { launchText, accelerationText } from './launchTranslations'
import { recordMetric } from '../diagnostics/performance'
type Adapter = { name: string; vendor: string; backend: string; deviceType: string; software: boolean; driver: string; gpuUploadHeap?: { supported?: boolean } }
type Capabilities = { hardware: { adapters: Adapter[]; recommendedNativeBackend: string; discoveryMs: number; nvidiaLibraries?: { runtimePackaged: boolean; nvjpegPackaged: boolean } } }
let inspection: Promise<Capabilities> | undefined
export function LaunchHardwareSettings({ onInteract, compact, onHardwareStatus }: { onInteract?: () => void; compact?: boolean; onHardwareStatus?: (status: 'checking'|'ready'|'failed'|'preview') => void }) {
  const preferences = useLaunchPreferences(), t = launchText[preferences.language], a = accelerationText[preferences.language]
  const [capabilities, setCapabilities] = useState<Capabilities>()
  const warmRevision = useRef(0)
  const warmTasks = useRef<Promise<void>>(Promise.resolve())
  const [warm, setWarm] = useState<'warming' | 'ready' | 'failed'>()
  const [failed, setFailed] = useState(false), [saveFailed, setSaveFailed] = useState(false)
  useEffect(()=>{onHardwareStatus?.(!isTauri()?'preview':failed?'failed':capabilities?'ready':'checking')},[capabilities,failed,onHardwareStatus])
  useEffect(() => {
    let live = true
    void hydrateLaunchPreferences().catch(() => { if (live) setSaveFailed(true) })
    if (isTauri()) {
      inspection ||= invoke<Capabilities>('inspect_engine_capabilities')
      void inspection.then(result => {
        if (!live) return
        setCapabilities(result)
        recordMetric('engine.launch-hardware', { adapters: result.hardware.adapters.length, recommended: result.hardware.recommendedNativeBackend, discoveryMs: result.hardware.discoveryMs })
      }).catch(() => { if (live) setFailed(true) })
    }
    return () => { live = false }
  }, [])
  const update = (p: typeof preferences) => {
    onInteract?.(); setSaveFailed(false)
    const changed = p.nativeBackend !== preferences.nativeBackend || p.preparationAcceleration !== preferences.preparationAcceleration
    const revision = changed ? ++warmRevision.current : warmRevision.current
    if (changed && isTauri()) setWarm('warming')
    void saveLaunchPreferences(p).then(async () => {
      if (!changed || !isTauri()) return
      warmTasks.current = warmTasks.current.catch(() => undefined).then(async () => {
      if (revision !== warmRevision.current) return
      try {
        const result = await invoke<{ used: string; fallbackReason?: string; totalMs: number }>('prepare_image_experimental', { request: { width: 2, height: 2, rgbaBase64: '/////////////////////w==', backend: 'wgpu' } })
        const fallback = !!result.fallbackReason || (p.preparationAcceleration !== 'standard' && result.used !== p.preparationAcceleration)
        recordMetric('engine.launch-acceleration-warmup', { used: result.used, totalMs: result.totalMs, fallback })
        if (revision === warmRevision.current) setWarm(fallback ? 'failed' : 'ready')
      } catch { if (revision === warmRevision.current) setWarm('failed') }
      })
    }).catch(() => { setSaveFailed(true); if (revision === warmRevision.current) setWarm('failed') })
  }
  const adapters = capabilities?.hardware.adapters || []
  const available = (backend: string) => !isTauri() || adapters.some(a => a.backend.toLowerCase() === backend && !a.software)
  const cudaAvailable = isTauri() && capabilities?.hardware.nvidiaLibraries?.runtimePackaged && adapters.some(a => a.vendor === 'NVIDIA' && a.backend === 'Dx12' && !a.software)
  const uploadAvailable = cudaAvailable && adapters.some(a => a.vendor === 'NVIDIA' && a.backend === 'Dx12' && !a.software && a.gpuUploadHeap?.supported)
  return <section className="launch-hardware-settings" lang={preferences.language} aria-label={t.hardware}>
    {!compact && <label>{t.language}<select aria-label={t.language} value={preferences.language} onChange={e => update({ ...preferences, language: e.target.value as typeof preferences.language })}>
      {launchLanguages.map(l => <option key={l.id} value={l.id} lang={l.id}>{l.label}</option>)}
    </select></label>}
    <h2>{t.hardware}</h2>
    <div className="launch-hardware-status" role="status">
      {!isTauri() ? t.browser : failed ? t.failed : !capabilities ? t.checking : <>
        <ul aria-label={t.adapters}>{adapters.map((a, i) => <li key={`${a.backend}-${i}`}><strong>{a.name}</strong> · {a.vendor} · {a.backend} · {a.deviceType}</li>)}</ul>
        <p>{t.recommended}: <strong>{capabilities.hardware.recommendedNativeBackend.toUpperCase()}</strong></p>
      </>}
    </div>
    <label>{t.backend}<select aria-label={t.backend} value={preferences.nativeBackend} onChange={e => update({ ...preferences, nativeBackend: e.target.value as typeof preferences.nativeBackend, preparationAcceleration: e.target.value === 'vulkan' ? 'standard' : preferences.preparationAcceleration })}>
      <option value="auto">{t.auto}</option>
      <option value="dx12" disabled={!available('dx12')}>DirectX 12</option>
      <option value="vulkan" disabled={!available('vulkan')}>Vulkan</option>
    </select></label>
    <p>{t.scope}</p><p>{t.fallback}</p>
    <details><summary>{t.advanced}</summary>
      <label>{a.label}<select aria-label={a.label} value={preferences.preparationAcceleration} onChange={e => update({ ...preferences, preparationAcceleration: e.target.value as typeof preferences.preparationAcceleration, nativeBackend: e.target.value === 'standard' ? preferences.nativeBackend : 'dx12' })}>
        <option value="standard">{a.standard}</option>
        <option value="cuda-dx12" disabled={!cudaAvailable}>{a.cuda}</option>
        <option value="cuda-dx12-upload" disabled={!uploadAvailable}>{a.upload}</option>
      </select></label>
      <p>{a.retained}</p>{warm && <p role="status">{warm === 'warming' ? a.warming : warm === 'ready' ? a.ready : a.unavailable}</p>}
      <p>{capabilities?.hardware.nvidiaLibraries?.nvjpegPackaged ? a.jpeg : a.missing}</p>
      <p>{t.amd}</p>
    </details>
    <small>{t.translation}</small>
    {saveFailed && <p role="alert">{t.saveError}</p>}
  </section>
}
