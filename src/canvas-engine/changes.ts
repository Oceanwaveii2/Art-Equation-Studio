import type { CanvasSceneChangeSet, CanvasSceneConnection, CanvasSceneObject, CanvasSceneSnapshot } from './contracts'

function changed<T extends { id: string; revision: number }>(previous: readonly T[], next: readonly T[]) {
  const previousById = new Map(previous.map((entry) => [entry.id, entry]))
  const nextIds = new Set(next.map((entry) => entry.id))
  return {
    upsert: next.filter((entry) => previousById.get(entry.id)?.revision !== entry.revision),
    remove: previous.filter((entry) => !nextIds.has(entry.id)).map((entry) => entry.id),
  }
}

/** Creates the renderer-facing delta while keeping application history out of the engine. */
export function diffCanvasScenes(previous: CanvasSceneSnapshot, next: CanvasSceneSnapshot): CanvasSceneChangeSet {
  if (previous.id !== next.id) throw new Error('Canvas scenes must have the same id to produce a change set')
  const objects = changed<CanvasSceneObject>(previous.objects, next.objects)
  const connections = changed<CanvasSceneConnection>(previous.connections, next.connections)
  return {
    sceneId: next.id,
    fromRevision: previous.revision,
    toRevision: next.revision,
    upsertObjects: objects.upsert,
    removeObjectIds: objects.remove,
    upsertConnections: connections.upsert,
    removeConnectionIds: connections.remove,
    ...(previous.environment === next.environment ? {} : { environment: next.environment }),
  }
}
