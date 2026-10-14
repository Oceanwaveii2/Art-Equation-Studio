import {canvasResourceBudget,type CanvasResourceBudget,type CanvasResourceLease} from './resourceBudget'
export type ResolvedTextFont = Readonly<{
  key: string; revision: string; faceIndex: number; contentHash: string; bytes: Uint8Array
  requestedFamily: string; resolvedFamily: string; resolvedWeight: number; resolvedStyle: string
  synthesisRequired: boolean; axes: readonly unknown[]
}>
export type TextFontDescriptor = Readonly<{ family: string; weight: number; italic: boolean }>
export type TextFallbackDescriptor = Readonly<{ families: readonly string[]; text: string; weight: number; italic: boolean; locale?: string }>
export type TextFontResolver = ((request: TextFontDescriptor) => Promise<ResolvedTextFont>) & { fallbacks?: (request: TextFallbackDescriptor) => Promise<readonly ResolvedTextFont[]> }
export type ManagedTextFontResolver = TextFontResolver & { dispose(): void; stats(): Readonly<{ entries: number; bytes: number; disposed: boolean }> }

/** The native command resolves only installed families, not caller file paths. */
export function createNativeTextFontResolver(invoke: (command: string, args: unknown) => Promise<unknown>, budget: CanvasResourceBudget = canvasResourceBudget): ManagedTextFontResolver {
  const pending = new Map<string, Promise<ResolvedTextFont>>()
  const fallbackPending = new Map<string, Promise<readonly ResolvedTextFont[]>>()
  const owner = {}, leases = new Map<string, CanvasResourceLease>(), payloads = new Map<string, Uint8Array>()
  let retainedBytes = 0, disposed = false
  const resolve: TextFontResolver = async request => {
    if (disposed) throw new Error('FONT_RESOLVER_DISPOSED')
    const identity = JSON.stringify(request)
    const existing = pending.get(identity); if (existing) return existing
    if (pending.size >= 128) throw new Error('FONT_RESOURCE_LIMIT: native resolver cache entries')
    const result = invoke('resolve_system_font', { request }).then(raw => {
      if (disposed) throw new Error('FONT_RESOLVER_DISPOSED')
      const face = raw as { bytesBase64?: string; contentHash?: string; faceIndex?: number; requestedFamily?: string; resolvedFamily?: string; resolvedWeight?: number; resolvedStyle?: string; synthesisRequired?: boolean; axes?: unknown[] }
      const encoded = face.bytesBase64
      if (typeof encoded !== 'string' || encoded.length === 0 || encoded.length > Math.ceil(32 * 1024 * 1024 / 3) * 4 || encoded.length % 4 !== 0 || !/^[A-Za-z0-9+/]*={0,2}$/.test(encoded) || !/^[a-f0-9]{64}$/.test(face.contentHash ?? '') || !Number.isInteger(face.faceIndex) || face.faceIndex! < 0 || face.faceIndex! > 4096 || face.requestedFamily !== request.family || !face.resolvedFamily || face.resolvedFamily.length > 256 || !Number.isFinite(face.resolvedWeight) || face.resolvedWeight! < 1 || face.resolvedWeight! > 1000 || typeof face.resolvedStyle !== 'string' || face.resolvedStyle.length > 64 || !Array.isArray(face.axes) || typeof face.synthesisRequired !== 'boolean') {
        throw new Error('FONT_INVALID: native face receipt')
      }
      const key = `${face.contentHash}:${face.faceIndex}`, length = encoded.length / 4 * 3 - (encoded.endsWith('==') ? 2 : encoded.endsWith('=') ? 1 : 0)
      if (length <= 0 || length > 32 * 1024 * 1024) throw new Error('FONT_RESOURCE_LIMIT: native payload bytes')
      let bytes = payloads.get(key)
      if (!bytes) {
        if (retainedBytes + length > 128 * 1024 * 1024) throw new Error('FONT_RESOURCE_LIMIT: native resolver cache bytes')
        // Account the bounded IPC string and decode copies separately from the
        // retained binary. Native/Chromium transport allocations remain estimates.
        const transient = budget.acquire({ owner, key: `font-decode:${key}`, pool: 'tile-surface', bytes: encoded.length * 2 + length * 2, pinned: true })
        if (!transient) throw new Error('FONT_RESOURCE_LIMIT: native transport budget')
        try {
          const binary = atob(encoded); if (binary.length !== length) throw new Error('FONT_INVALID: base64 byte count')
          const lease = budget.acquire({ owner, key: `font-bytes:${key}`, pool: 'retained', bytes: length, pinned: true })
          if (!lease) throw new Error('FONT_RESOURCE_LIMIT: native retained budget')
          try { bytes = Uint8Array.from(binary, char => char.charCodeAt(0)); payloads.set(key, bytes); leases.set(key, lease); retainedBytes += length }
          catch (error) { lease.release(); throw error }
        } finally { transient.release() }
      }
      return {
        key, revision: face.contentHash!, faceIndex: face.faceIndex!,
        contentHash: face.contentHash!, bytes, requestedFamily: face.requestedFamily!,
        resolvedFamily: face.resolvedFamily, resolvedWeight: face.resolvedWeight!, resolvedStyle: face.resolvedStyle!,
        synthesisRequired: face.synthesisRequired === true, axes: face.axes ?? [],
      }
    }).catch(error => { pending.delete(identity); throw error })
    pending.set(identity, result); return result
  }
  const fallbacks = async (request: TextFallbackDescriptor): Promise<readonly ResolvedTextFont[]> => {
    if (disposed) throw new Error('FONT_RESOLVER_DISPOSED')
    const key = JSON.stringify(request), existing = fallbackPending.get(key); if (existing) return existing
    if (fallbackPending.size >= 128) throw new Error('FONT_RESOURCE_LIMIT: fallback cache entries')
    const result = invoke('resolve_system_font_fallbacks', { request }).then(async raw => {
      const receipt = raw as { families?: string[]; uncoveredCodePoints?: number[]; method?: string }
      if (!Array.isArray(receipt.families) || receipt.families.length > 16 || receipt.families.some(family => typeof family !== 'string' || !family || family.length > 256) || !Array.isArray(receipt.uncoveredCodePoints) || receipt.uncoveredCodePoints.some(point => !Number.isInteger(point) || point < 0 || point > 0x10ffff) || receipt.method !== 'fontique-native-script-locale-fallback-with-actual-face-coverage') throw new Error('FONT_INVALID: native fallback receipt')
      if (receipt.uncoveredCodePoints.length) throw new Error(`FONT_GLYPH_MISSING: native fallback ${receipt.uncoveredCodePoints.map(point => point.toString(16)).join(',')}`)
      const faces: ResolvedTextFont[] = []
      for (const family of receipt.families) faces.push(await resolve({ family, weight: request.weight, italic: request.italic }))
      return faces
    }).catch(error => { fallbackPending.delete(key); throw error })
    fallbackPending.set(key, result); return result
  }
  return Object.assign(resolve, { fallbacks, dispose() { disposed = true; pending.clear(); fallbackPending.clear(); payloads.clear(); leases.clear(); retainedBytes = 0; budget.releaseOwner(owner) }, stats: () => ({ entries: pending.size + fallbackPending.size, bytes: retainedBytes, disposed }) })
}
