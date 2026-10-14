/** Reserve UI/input capacity. This is admission policy, not a speed claim. */
export function preparationPolicy(logicalCores: number, memoryMiB = 4096) {
  const cores = Number.isFinite(logicalCores) ? Math.max(1, Math.floor(logicalCores)) : 1
  const reserved = cores >= 4 ? 2 : 1
  const memoryWorkers = Math.max(1, Math.floor(Math.max(128, Number.isFinite(memoryMiB) ? memoryMiB : 512) / 512))
  return { workers: Math.max(1, Math.min(4, cores - reserved, memoryWorkers)), reservedCores: reserved,
    queued: 16, workingBytes: 256 * 1024 * 1024, taskBytes: 128 * 1024 * 1024 }
}
