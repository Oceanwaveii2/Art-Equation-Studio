import type { CanvasViewport } from '../canvas-engine/contracts'

/** The host owns these presentation attributes between React document commits. */
export function presentCamera(stage: HTMLElement | null, camera: CanvasViewport, minimum: number, maximum: number) {
  if (!stage) return
  const world = stage.querySelector<HTMLElement>('.board-world')
  if (world) world.style.transform = `translate(${camera.x}px, ${camera.y}px) scale(${camera.scale})`
  stage.dataset.liveCamera = JSON.stringify(camera)
  const zoom = stage.querySelector<HTMLButtonElement>('.canvas-zoom-percentage')
  if (zoom) { zoom.textContent = `${Math.round(camera.scale * 100)}%`; zoom.setAttribute('aria-label', `Canvas zoom ${Math.round(camera.scale * 100)} percent. Open zoom options`) }
  const decrease = stage.querySelector<HTMLButtonElement>('[aria-label="Zoom out"]'), increase = stage.querySelector<HTMLButtonElement>('[aria-label="Zoom in"]')
  if (decrease) decrease.disabled = camera.scale <= minimum + .001
  if (increase) increase.disabled = camera.scale >= maximum - .001
  for (const box of stage.querySelectorAll<HTMLElement>('.node-transform-box')) {
    box.style.setProperty('--handle-size', `${12 / camera.scale}px`)
    box.style.setProperty('--handle-offset', `${7 / camera.scale}px`)
    box.style.setProperty('--rotate-gap', `${29 / camera.scale}px`)
  }
  // Media LOD controllers consume this without reconciling the board tree.
  stage.dispatchEvent(new CustomEvent('canvas-camera-presented', { detail: camera }))
}
