import { findSimilarSemantic, searchSemanticIndex, type SemanticSearchResult } from '../storage/workspace'

export class SemanticSearchClient {
  private worker: Worker | null = null
  private pending: { resolve: (vector: number[]) => void; reject: (error: Error) => void; onStatus: (status: string) => void } | null = null

  private ensureWorker() {
    if (this.worker) return this.worker
    this.worker = new Worker(new URL('./semantic.worker.ts', import.meta.url), { type: 'module' })
    this.worker.onmessage = (event: MessageEvent<Record<string, unknown>>) => {
      if (!this.pending) return
      if (event.data.type === 'model-progress') this.pending.onStatus('Loading local text model…')
      else if (event.data.type === 'fallback') this.pending.onStatus('GPU unavailable; searching on CPU…')
      else if (event.data.type === 'text-complete') {
        const pending = this.pending; this.pending = null
        pending.resolve(event.data.vector as number[])
      } else if (event.data.type === 'error') {
        const pending = this.pending; this.pending = null
        pending.reject(new Error(String(event.data.error)))
      }
    }
    this.worker.onerror = (event) => {
      const pending = this.pending; this.pending = null
      pending?.reject(new Error(event.message))
    }
    return this.worker
  }

  async search(projectId: string, query: string, onStatus: (status: string) => void): Promise<SemanticSearchResult[]> {
    if (this.pending) throw new Error('A semantic search is already running')
    const vector = await new Promise<number[]>((resolve, reject) => {
      this.pending = { resolve, reject, onStatus }
      this.ensureWorker().postMessage({ type: 'embed-text', query })
    })
    onStatus('Comparing project references…')
    return searchSemanticIndex(projectId, vector)
  }

  findSimilar(projectId: string, assetId: string) {
    return findSimilarSemantic(projectId, `asset:${assetId}`)
  }

  dispose() { this.worker?.terminate(); this.worker = null; this.pending = null }
}
