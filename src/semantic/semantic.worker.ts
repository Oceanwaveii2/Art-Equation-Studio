/// <reference lib="webworker" />
import { AutoProcessor, AutoTokenizer, CLIPTextModelWithProjection, CLIPVisionModelWithProjection, RawImage, env } from '@huggingface/transformers'

const MODEL_ID = 'Xenova/clip-vit-base-patch16'
const MODEL_REVISION = '342fdf2f67aded64d138ff074745fb4a5d2bba5f'

type Request =
  | { type: 'initialize'; preferGpu: boolean }
  | { type: 'embed-images'; items: Array<{ recordId: string; url: string }> }
  | { type: 'embed-text'; query: string }
  | { type: 'cancel' }

let processor: Awaited<ReturnType<typeof AutoProcessor.from_pretrained>> | null = null
let visionModel: Awaited<ReturnType<typeof CLIPVisionModelWithProjection.from_pretrained>> | null = null
let tokenizer: Awaited<ReturnType<typeof AutoTokenizer.from_pretrained>> | null = null
let textModel: Awaited<ReturnType<typeof CLIPTextModelWithProjection.from_pretrained>> | null = null
let cancelled = false
let device: 'webgpu' | 'wasm' = 'wasm'

env.allowRemoteModels = true
env.allowLocalModels = true

function emit(message: unknown) { self.postMessage(message) }

function normalize(input: Float32Array | number[]) {
  let magnitude = 0
  for (const value of input) magnitude += value * value
  magnitude = Math.sqrt(magnitude) || 1
  return Array.from(input, (value) => value / magnitude)
}

async function load(preferGpu: boolean) {
  if (processor && visionModel) return
  const requestedDevice: 'webgpu' | 'wasm' = preferGpu && 'gpu' in navigator ? 'webgpu' : 'wasm'
  const progress_callback = (progress: unknown) => emit({ type: 'model-progress', progress })
  processor = await AutoProcessor.from_pretrained(MODEL_ID, { revision: MODEL_REVISION, progress_callback })
  try {
    visionModel = await CLIPVisionModelWithProjection.from_pretrained(MODEL_ID, { revision: MODEL_REVISION, device: requestedDevice, dtype: 'q8', progress_callback })
    device = requestedDevice
  } catch (error) {
    if (requestedDevice === 'wasm') throw error
    emit({ type: 'fallback', reason: String(error) })
    visionModel = await CLIPVisionModelWithProjection.from_pretrained(MODEL_ID, { revision: MODEL_REVISION, device: 'wasm', dtype: 'q8', progress_callback })
    device = 'wasm'
  }
  emit({ type: 'ready', modelId: MODEL_ID, modelRevision: MODEL_REVISION, device })
}

async function loadText(preferGpu: boolean) {
  if (tokenizer && textModel) return
  const requestedDevice: 'webgpu' | 'wasm' = preferGpu && 'gpu' in navigator ? 'webgpu' : 'wasm'
  const progress_callback = (progress: unknown) => emit({ type: 'model-progress', progress })
  tokenizer = await AutoTokenizer.from_pretrained(MODEL_ID, { revision: MODEL_REVISION, progress_callback })
  try {
    textModel = await CLIPTextModelWithProjection.from_pretrained(MODEL_ID, { revision: MODEL_REVISION, device: requestedDevice, dtype: 'q8', progress_callback })
    device = requestedDevice
  } catch (error) {
    if (requestedDevice === 'wasm') throw error
    emit({ type: 'fallback', reason: String(error) })
    textModel = await CLIPTextModelWithProjection.from_pretrained(MODEL_ID, { revision: MODEL_REVISION, device: 'wasm', dtype: 'q8', progress_callback })
    device = 'wasm'
  }
}

self.onmessage = async (event: MessageEvent<Request>) => {
  const request = event.data
  if (request.type === 'cancel') { cancelled = true; return }
  try {
    if (request.type === 'initialize') { await load(request.preferGpu); return }
    if (request.type === 'embed-text') {
      await loadText(true)
      const inputs = tokenizer!([request.query], { padding: true, truncation: true })
      const output = await textModel!(inputs)
      emit({ type: 'text-complete', vector: normalize(output.text_embeds.data as Float32Array), modelId: MODEL_ID, modelRevision: MODEL_REVISION, device })
      return
    }
    if (request.type === 'embed-images') {
      cancelled = false
      await load(true)
      const embeddings: Array<{ recordId: string; vector: number[] }> = []
      for (let index = 0; index < request.items.length; index += 1) {
        if (cancelled) { emit({ type: 'cancelled', completed: embeddings.length }); return }
        const item = request.items[index]
        try {
          const image = await RawImage.read(item.url)
          const inputs = await processor!(image)
          const output = await visionModel!(inputs)
          embeddings.push({ recordId: item.recordId, vector: normalize(output.image_embeds.data as Float32Array) })
          emit({ type: 'item-progress', completed: index + 1, total: request.items.length, recordId: item.recordId })
        } catch (error) {
          emit({ type: 'item-error', recordId: item.recordId, error: String(error) })
        }
      }
      emit({ type: 'complete', embeddings, modelId: MODEL_ID, modelRevision: MODEL_REVISION, device })
    }
  } catch (error) {
    emit({ type: 'error', error: String(error) })
  }
}
