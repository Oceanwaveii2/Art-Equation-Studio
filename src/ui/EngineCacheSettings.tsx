import { useEffect, useState } from 'react'
import { ExperimentalPreparationSettings } from './ExperimentalPreparationSettings'
import { clearDerivedCache, derivedCacheStatus } from '../board/derivedDiskCache'
import { preparationWorkerSnapshot } from '../board/preparationWorkers'
import { invoke, isTauri } from '@tauri-apps/api/core'
import { recordMetric } from '../diagnostics/performance'
import { LaunchHardwareSettings } from './LaunchHardwareSettings'
export function EngineCacheSettings() {
  const [cache, setCache] = useState<Awaited<ReturnType<typeof derivedCacheStatus>>>()
  const [message, setMessage] = useState('')
  const [capabilities, setCapabilities] = useState<{ dpiPerMonitorV2?: boolean; preparationWorkers: number; opencl: { available: boolean; enabled: boolean; devices: { name: string; driver: string }[] } }>()
  const refresh = () => { void derivedCacheStatus().then(setCache) }
  useEffect(refresh, [])
  const workers = preparationWorkerSnapshot()
  return <section><h3>Prepared image cache</h3><p>Decoded TIFF previews use a disposable local disk cache. Prepared image pyramids remain in their project folder. Originals and saved boards stay separate.</p>
    <div className="settings-readout"><span>Preview cache</span><strong>{cache?.available ? `${(cache.bytes / 1048576).toFixed(1)} / 256 MiB · ${cache.entries} previews` : 'Unavailable · decoding still works'}</strong></div>
    <div className="settings-readout"><span>Background preparation</span><strong>{workers.workers} workers · {workers.queued} queued</strong></div>
    <button type="button" onClick={() => { void clearDerivedCache().then(() => { refresh(); setMessage('Prepared previews cleared. Originals and saves are unchanged.') }).catch(() => setMessage('The cache could not be cleared.')) }}>Clear prepared previews</button>
    {isTauri() && <button type="button" onClick={() => { void invoke<NonNullable<typeof capabilities>>('inspect_engine_capabilities').then(result => {
      setCapabilities(result); recordMetric('engine.capabilities', { dpiPerMonitorV2: Boolean(result.dpiPerMonitorV2), preparationWorkers: result.preparationWorkers, openclAvailable: result.opencl.available, openclEnabled: result.opencl.enabled })
      for (const device of result.opencl.devices) recordMetric('engine.compute-device', { name: device.name.slice(0,160), driver: device.driver.slice(0,160), enabled: false })
    }).catch(() => setMessage('Native capability inspection is unavailable.')) }}>Inspect engine capabilities</button>}
    {capabilities && <small>Native preparation: {capabilities.preparationWorkers} workers · Per-Monitor V2: {capabilities.dpiPerMonitorV2 ? 'active' : 'unverified'} · OpenCL: {capabilities.opencl.available ? 'available for an explicit comparison' : 'unavailable'}</small>}
    <small role="status">{message}</small><LaunchHardwareSettings /><ExperimentalPreparationSettings /></section>
}
