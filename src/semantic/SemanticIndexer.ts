import { convertFileSrc } from '@tauri-apps/api/core'
import { commitSemanticEmbeddings, listSemanticSources, prepareSemanticIndex, type SemanticIndexStatus } from '../storage/workspace'

export type SemanticIndexProgress = {
  phase: 'preparing' | 'loading-model' | 'embedding' | 'saving' | 'complete' | 'cancelled' | 'failed'
  completed: number
  total: number
  detail?: string
}

export class SemanticIndexer {
  private worker: Worker | null = null

  cancel() { this.worker?.postMessage({ type: 'cancel' }) }

  async run(projectId: string, workspaceRoot: string, onProgress: (progress: SemanticIndexProgress) => void): Promise<SemanticIndexStatus> {
    onProgress({ phase: 'preparing', completed: 0, total: 0 })
    const prepared = await prepareSemanticIndex(projectId)
    const sources = (await listSemanticSources(projectId)).filter((source) => source.active && source.embeddingState !== 'ready')
    if (!sources.length) { onProgress({ phase: 'complete', completed: prepared.indexedCount, total: prepared.sourceCount, detail: 'All current images already have local embeddings' }); return prepared }
    const items = sources.map((source) => ({
      recordId: source.recordId,
      url: /^[a-zA-Z]:[\\/]/.test(source.relativePath) ? convertFileSrc(source.relativePath) : convertFileSrc(`${workspaceRoot.replace(/[\\/]$/, '')}/${source.relativePath.replace(/^[\\/]/, '')}`),
    }))
    this.worker = new Worker(new URL('./semantic.worker.ts', import.meta.url), { type: 'module' })
    return new Promise<SemanticIndexStatus>((resolve, reject) => {
      const fail = (error: unknown) => {
        onProgress({ phase: 'failed', completed: 0, total: items.length, detail: String(error) })
        this.worker?.terminate(); this.worker = null; reject(error)
      }
      this.worker!.onerror = (event) => fail(event.message)
      this.worker!.onmessage = (event: MessageEvent<Record<string, unknown>>) => {
        const message = event.data
        if (message.type === 'model-progress') onProgress({ phase: 'loading-model', completed: 0, total: items.length })
        else if (message.type === 'fallback') onProgress({ phase: 'loading-model', completed: 0, total: items.length, detail: 'GPU unavailable; using CPU' })
        else if (message.type === 'item-progress') onProgress({ phase: 'embedding', completed: Number(message.completed), total: Number(message.total) })
        else if (message.type === 'item-error') onProgress({ phase: 'embedding', completed: 0, total: items.length, detail: `Skipped ${String(message.recordId)}` })
        else if (message.type === 'cancelled') {
          onProgress({ phase: 'cancelled', completed: Number(message.completed), total: items.length })
          this.worker?.terminate(); this.worker = null; reject(new Error('Semantic indexing cancelled'))
        }
        else if (message.type === 'error') fail(message.error)
        else if (message.type === 'complete') {
          const embeddings = message.embeddings as Array<{ recordId: string; vector: number[] }>
          const dimension = embeddings[0]?.vector.length || 512
          onProgress({ phase: 'saving', completed: embeddings.length, total: items.length })
          void commitSemanticEmbeddings(projectId, String(message.modelId), String(message.modelRevision), dimension, embeddings)
            .then((status) => { onProgress({ phase: 'complete', completed: embeddings.length, total: items.length }); this.worker?.terminate(); this.worker = null; resolve(status) })
            .catch(fail)
        }
      }
      this.worker!.postMessage({ type: 'embed-images', items })
    })
  }
}
