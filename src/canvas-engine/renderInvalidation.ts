import type { CanvasSceneSnapshot, CanvasViewport } from './contracts'

/** Tracks only fields consumed by the backdrop. Selection, media and connector
 * changes do not invalidate grid or column geometry. */
export class BackdropInvalidation {
  private gridKey = ''
  private structureKey = ''
  private sceneId: string | undefined
  private objects: CanvasSceneSnapshot['objects'] | undefined
  private viewportKey = ''
  private force = true

  reset() { this.force = true }

  consume(scene: CanvasSceneSnapshot, viewport: CanvasViewport) {
    const force = this.force || this.sceneId !== scene.id
    const grid = scene.environment.grid
    const gridKey = `${grid.visible}/${grid.color}/${grid.opacity}/${grid.spacing}`
    let structureKey = this.structureKey
    if (force || scene.objects !== this.objects) {
      structureKey = JSON.stringify(scene.objects.filter((object) => object.role === 'column').map((object) => [object.id, object.bounds]))
    }
    const viewportKey = `${viewport.x}/${viewport.y}/${viewport.scale}`
    const dirty = { grid: force || gridKey !== this.gridKey, structure: force || structureKey !== this.structureKey, viewport: force || viewportKey !== this.viewportKey }
    this.force = false
    this.sceneId = scene.id
    this.objects = scene.objects
    this.gridKey = gridKey
    this.structureKey = structureKey
    this.viewportKey = viewportKey
    return dirty
  }
}
