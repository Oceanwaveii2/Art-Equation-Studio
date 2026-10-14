let worker: Worker | undefined
let nextId = 1
const requests = new Map<number, { resolve: (value: ImageData) => void; reject: (reason: unknown) => void }>()

function persistentWorker() {
  if (worker) return worker
  worker = new Worker(new URL('./productionWorker.ts', import.meta.url), { type: 'module' })
  worker.onmessage = (event: MessageEvent<{ id: number; ok: boolean; width: number; height: number; pixels?: Uint8Array; error?: string }>) => {
    const request = requests.get(event.data.id)
    if (!request) return
    requests.delete(event.data.id)
    if (!event.data.ok || !event.data.pixels) request.reject(new Error(event.data.error || 'Vello render failed'))
    else request.resolve(new ImageData(new Uint8ClampedArray(event.data.pixels), event.data.width, event.data.height))
  }
  worker.onerror = (event) => {
    for (const request of requests.values()) request.reject(new Error(event.message))
    requests.clear(); worker?.terminate(); worker = undefined
  }
  return worker
}

export function renderVelloScene(input: { width: number; height: number; snapshot: string; scale: number; panX: number; panY: number }) {
  const id = nextId++
  return new Promise<ImageData>((resolve, reject) => {
    requests.set(id, { resolve, reject })
    persistentWorker().postMessage({ id, ...input })
  })
}
