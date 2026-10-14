import { Container, Graphics, ImageSource, Sprite, Texture, CanvasSource, Mesh, MeshGeometry } from 'pixi.js'
import { retainedImageGeometry } from './retainedImageGeometry'
import type { CanvasSceneObject, CanvasSceneSnapshot, CanvasViewport } from '../canvas-engine/contracts'
import type { RetainedMode } from './retainedMode'
import { canvasResourceBudget, type CanvasResourceLease } from '../canvas-engine/resourceBudget'

type Entry = { element: HTMLElement; object: CanvasSceneObject; container: Container; key: string; skinKey: string; imageKey?: string; geometryKey?: string; kind: string }
type SharedImage = { texture: Texture; bytes: number; users: number; lease: CanvasResourceLease }
type ConnectionEntry = { element: SVGElement; sprite: Sprite; texture: Texture; key: string; bytes: number; lease: CanvasResourceLease }
type Candidate = { element: HTMLElement; object: CanvasSceneObject; style: CSSStyleDeclaration; image?: HTMLImageElement; body?: HTMLElement; ellipse?: SVGElement; kind: string }
const MAX_SKIN_EDGE = 4096
const PADDING = 48

/** Retained paint only. DOM owns focus, hit testing, text, controls and media.
 * This host bridge reads layout on content/visibility changes, never raw input.
 * The engine scene and saved project do not contain DOM or Pixi resources. */
export class RetainedBoardContent {
  readonly layer = new Container()
  readonly metrics = { objects: 0, connections: 0, images: 0, skins: 0, geometries: 0, bytes: 0, builds: 0, uploads: 0, disposed: 0, syncs: 0, fallbacks: {} as Record<string, number> }
  private entries = new Map<string, Entry>()
  private images = new Map<string, SharedImage>()
  private skins = new Map<string, SharedImage>()
  private geometries = new Map<string, { geometry: MeshGeometry; users: number; bytes: number; lease: CanvasResourceLease }>()
  private connections = new Map<string, ConnectionEntry>()
  private pngStatus = new Map<string, boolean>()
  private probes = new Map<string, AbortController>()
  private stopped = false
  private failed = new Set<string>()
  private lastKey = ''
  private sourceRevision = 0
  private sceneId = ''
  private root: HTMLElement
  private wake: () => void
  private maxTextureEdge: number
  private resourceOwner = {}

  constructor(root: HTMLElement, wake: () => void, maxTextureEdge: number) {
    this.root = root; this.wake = wake; this.maxTextureEdge = maxTextureEdge
    this.layer.eventMode = 'none'
    root.addEventListener('load', this.resourceChanged, true)
    root.addEventListener('error', this.resourceChanged, true)
  }

  private resourceChanged = (event: Event) => {
    if (!(event.target instanceof HTMLImageElement) || !event.target.closest('.board-world')) return
    this.sourceRevision++; this.wake()
  }

  reveal() {
    for (const entry of this.entries.values()) delete entry.element.dataset.retainedPaint
    for (const entry of this.connections.values()) delete entry.element.dataset.retainedConnection
  }
  publish() {
    for (const entry of this.entries.values()) entry.element.dataset.retainedPaint = entry.kind
    for (const entry of this.connections.values()) entry.element.dataset.retainedConnection = 'true'
  }
  invalidate() { this.lastKey = ''; this.reveal() }

  sync(scene: CanvasSceneSnapshot, viewport: CanvasViewport, mode: RetainedMode, uiKey: string) {
    if (scene.id !== this.sceneId) { if (this.sceneId) this.clearSceneResources(); this.failed.clear(); this.sceneId = scene.id }
    const density = Math.max(1, 2 ** Math.ceil(Math.log2(viewport.scale * Math.max(1, window.devicePixelRatio || 1))))
    // Non-scaling SVG strokes must be refreshed even within a texture LOD bucket.
    const key = `${scene.id}/${scene.revision}/${mode}/${uiKey}/${density}/${mode === 'retained' ? viewport.scale : ''}/${this.sourceRevision}`
    if (key === this.lastKey) return false
    this.lastKey = key
    this.metrics.syncs++
    this.metrics.fallbacks = {}
    this.reveal()
    const nodes = new Map(scene.objects.map((object) => [object.id, object]))
    const elements = [...this.root.querySelectorAll<HTMLElement>('.board-world > .board-node')]
    const liveSources = new Set(elements.map((element) => element.querySelector<HTMLImageElement>('.format-image-preview > img')?.currentSrc).filter(Boolean))
    for (const [url, probe] of this.probes) if (!liveSources.has(url)) { probe.abort(); this.probes.delete(url) }
    for (const url of this.pngStatus.keys()) if (!liveSources.has(url)) this.pngStatus.delete(url)
    const candidates = new Map<string, Candidate>()
    const fallback = (reason: string) => { this.metrics.fallbacks[reason] = (this.metrics.fallbacks[reason] || 0) + 1 }
    if (mode !== 'dom') for (const element of elements) {
      const object = nodes.get(element.dataset.nodeId || '')
      if (!object?.localBounds) continue
      const image = element.querySelector<HTMLImageElement>('.format-image-preview > img') || undefined
      const body = element.querySelector<HTMLElement>('.transformed-image') || undefined
      if (element.matches('.selected,.marquee-preview,.connector-source') || object.appearance.opacity !== 1) { fallback('active-or-translucent'); continue }
      if (this.failed.has(object.id)) { fallback('render-failed'); continue }
      if (mode === 'raster' && (!image || !body)) { fallback('outside-raster-pilot'); continue }
      const style = getComputedStyle(element)
      if (style.backgroundImage !== 'none') { fallback('cover-or-gradient'); continue }
      if (element.querySelector('.node-vector-shape')) { fallback('complex-vector'); continue }
      if (element.querySelector('.tiled-image-preview')) { fallback('tiled-image'); continue }
      const ellipse = element.querySelector<SVGElement>('.node-shape-ellipse > ellipse:not(.shape-hit-area)') || undefined
      let kind = ellipse ? 'ellipse' : 'skin'
      if (image && body) {
        const imageStyle = getComputedStyle(image)
        const format = element.querySelector<HTMLElement>('.format-image-preview')?.dataset.imageExtension || ''
        if (!image.complete || !image.naturalWidth) { fallback('image-loading'); continue }
        if (imageStyle.filter !== 'none' || !['normal', ''].includes(imageStyle.mixBlendMode)) { fallback('image-effect'); continue }
        if (!this.staticImage(image.currentSrc, format)) { fallback('animated-or-unverified'); continue }
        if (image.naturalWidth > this.maxTextureEdge || image.naturalHeight > this.maxTextureEdge) { fallback('texture-dimensions'); continue }
        kind = 'image'
      } else if (object.kind === 'raster' && mode === 'raster') { fallback('image-unavailable'); continue }
      candidates.set(object.id, { element, object, style, image: kind === 'image' ? image : undefined, body, ellipse, kind })
    }
    // Split DOM/GPU compositing is safe only for disjoint peers or a child fully
    // inside a migrated container's body. Never silently invert overlapping cards.
    const visible = elements.map((element) => nodes.get(element.dataset.nodeId || '')).filter((object): object is CanvasSceneObject => !!object)
    const rejected = new Set<string>()
    for (const [id, candidate] of candidates) {
      for (const other of visible) {
        if (other.id === id || !intersects(candidate.object.bounds, other.bounds)) continue
        const parent = candidate.object.parentId === other.id ? candidates.get(other.id) : undefined
        const child = other.parentId === id ? candidates.get(id) : undefined
        if (parent && insideBody(candidate.object, parent)) continue
        if (child && insideBody(other, child)) continue
        rejected.add(id); break
      }
    }
    for (const id of rejected) { candidates.delete(id); fallback('overlap') }
    // A parent rejected by a peer must not leave GPU children under its DOM fill.
    const domChildren: string[] = []
    for (const [id, candidate] of candidates) {
      let parentId = candidate.object.parentId
      const visited = new Set([id])
      while (parentId && visible.some((object) => object.id === parentId)) {
        if (visited.has(parentId) || !candidates.has(parentId)) { domChildren.push(id); break }
        visited.add(parentId); parentId = candidates.get(parentId)!.object.parentId
      }
    }
    for (const id of domChildren) { candidates.delete(id); fallback('dom-parent') }
    for (const [id, entry] of this.entries) if (!candidates.has(id)) this.remove(id, entry)
    for (const [id, candidate] of candidates) {
      const { element, object, style, image, body, ellipse, kind } = candidate
      const box = object.localBounds!
      const imageStyle = image ? getComputedStyle(image) : undefined
      const imageKey = image?.currentSrc
      const signature = JSON.stringify([box.width, box.height, style.backgroundColor, style.borderRadius, style.boxShadow, density, ellipse ? viewport.scale : null, kind, imageKey, image?.naturalWidth, image?.naturalHeight, imageStyle?.transform, imageStyle?.opacity, body?.offsetLeft, body?.offsetTop, body?.clientWidth, body?.clientHeight, ellipse?.outerHTML])
      let entry = this.entries.get(id)
      if (entry?.key !== signature) {
        if (entry) this.remove(id, entry)
        const pixelWidth = Math.ceil((box.width + PADDING * 2) * density), pixelHeight = Math.ceil((box.height + PADDING * 2) * density)
        const skinKey = JSON.stringify([box.width, box.height, style.backgroundColor, style.borderRadius, style.boxShadow, density, ellipse?.outerHTML, ellipse ? viewport.scale : null])
        const skinBytes = this.skins.has(skinKey) ? 0 : pixelWidth * pixelHeight * 4
        const imageBytes = image && !this.images.has(imageKey!) ? image.naturalWidth * image.naturalHeight * 4 : 0
        if (Math.max(pixelWidth, pixelHeight) > Math.min(MAX_SKIN_EDGE, this.maxTextureEdge)) { fallback('texture-budget'); continue }
        let pendingContainer: Container | undefined, acquiredSkin: string | undefined, acquiredImage: string | undefined, acquiredGeometry: string | undefined
        try {
          let sharedSkin = this.skins.get(skinKey)
          const radius = Math.min(parseFloat(style.borderRadius) || 0, box.width / 2, box.height / 2)
          if (!sharedSkin) {
            const lease = this.reserve(`skin:${skinKey}`, skinBytes, 20, () => this.evictSkin(skinKey))
            try {
              const canvas = document.createElement('canvas'); canvas.width = pixelWidth; canvas.height = pixelHeight
              const context = canvas.getContext('2d')!
              context.scale(density, density); context.translate(PADDING, PADDING)
              drawSkin(context, box.width, box.height, radius, style.backgroundColor, style.boxShadow, density)
              if (ellipse) {
                context.beginPath(); context.ellipse(box.width / 2, box.height / 2, box.width * .49, box.height * .49, 0, 0, Math.PI * 2)
                context.fillStyle = ellipse.getAttribute('fill') || '#56748e'; context.globalAlpha = Number(ellipse.getAttribute('fill-opacity') || 1); context.fill(); context.globalAlpha = 1
                context.strokeStyle = ellipse.getAttribute('stroke') || '#b9d4e7'; context.lineWidth = Number(ellipse.getAttribute('stroke-width') || 2) / viewport.scale; context.stroke()
              }
              sharedSkin = { texture: new Texture({ source: new CanvasSource({ resource: canvas, resolution: density }) }), bytes: skinBytes, users: 0, lease }
              this.skins.set(skinKey, sharedSkin); this.metrics.bytes += skinBytes; this.metrics.builds++
            } catch (error) { lease.release(); throw error }
          }
          sharedSkin.users++; sharedSkin.lease.setPinned(true); sharedSkin.lease.touch(); acquiredSkin = skinKey
          const container = new Container(); const background = new Sprite(sharedSkin.texture); background.position.set(-PADDING, -PADDING); container.addChild(background)
          pendingContainer = container
          if (image && body) {
            let shared = this.images.get(imageKey!)
            if (!shared) {
              const lease = this.reserve(`image:${imageKey}`, imageBytes, 30, () => this.evictImage(imageKey!))
              try {
                shared = { texture: new Texture({ source: new ImageSource({ resource: image }) }), bytes: imageBytes, users: 0, lease }
                this.images.set(imageKey!, shared); this.metrics.bytes += shared.bytes; this.metrics.uploads++
              } catch (error) { lease.release(); throw error }
            }
            shared.users++; shared.lease.setPinned(true); shared.lease.touch()
            acquiredImage = imageKey
            const left = element.clientLeft + body.offsetLeft, top = element.clientTop + body.offsetTop
            const width = body.clientWidth, height = body.clientHeight
            const imageLayer = new Container()
            const matte = new Graphics().roundRect(left, top, width, height, Math.max(0, radius - element.clientLeft)).rect(left, top, width, height / 2).fill('#101116')
            const transform = new DOMMatrix(imageStyle?.transform === 'none' ? undefined : imageStyle?.transform)
            const geometryKey = JSON.stringify([left, top, width, height, image.naturalWidth, image.naturalHeight, radius, density, transform.a, transform.b, transform.c, transform.d])
            let sharedGeometry = this.geometries.get(geometryKey)
            if (!sharedGeometry) {
              const data = retainedImageGeometry({ left, top, width, height, imageWidth: image.naturalWidth, imageHeight: image.naturalHeight, radius: Math.max(0, radius - element.clientLeft), density, transform })
              const bytes = data.positions.byteLength + data.uvs.byteLength + data.indices.byteLength
              const lease = this.reserve(`geometry:${geometryKey}`, bytes, 10, () => this.evictGeometry(geometryKey))
              try {
                sharedGeometry = { geometry: new MeshGeometry(data), bytes, users: 0, lease }
                this.geometries.set(geometryKey, sharedGeometry); this.metrics.bytes += bytes
              } catch (error) { lease.release(); throw error }
            }
            sharedGeometry.users++; sharedGeometry.lease.setPinned(true); sharedGeometry.lease.touch(); acquiredGeometry = geometryKey
            const mesh = new Mesh({ geometry: sharedGeometry.geometry, texture: shared.texture }); mesh.alpha = Number(imageStyle?.opacity || 1)
            imageLayer.addChild(matte, mesh); container.addChild(imageLayer)
          }
          this.layer.addChild(container)
          entry = { element, object, container, key: signature, skinKey, imageKey, geometryKey: acquiredGeometry, kind }
          this.entries.set(id, entry)
        } catch (error) {
          pendingContainer?.destroy({ children: true })
          if (acquiredSkin) this.releaseSkin(acquiredSkin)
          if (acquiredImage) this.releaseImage(acquiredImage)
          if (acquiredGeometry) this.releaseGeometry(acquiredGeometry)
          if (String(error).includes('texture-budget')) fallback('texture-budget')
          else { this.failed.add(id); fallback('render-failed') }
          continue
        }
      }
      if (entry) {
        entry.element = element; entry.object = object
        entry.container.pivot.set(box.width / 2, box.height / 2)
        entry.container.position.set(box.x + box.width / 2, box.y + box.height / 2)
        entry.container.rotation = object.appearance.rotation * Math.PI / 180
        entry.container.zIndex = Number(style.zIndex) || 0
      }
    }
    this.layer.sortableChildren = true
    this.metrics.objects = this.entries.size; this.metrics.images = this.images.size; this.metrics.skins = this.skins.size; this.metrics.geometries = this.geometries.size
    this.syncConnections(scene, viewport, mode, visible, fallback)
    return true
  }

  private syncConnections(scene: CanvasSceneSnapshot, viewport: CanvasViewport, mode: RetainedMode, visible: CanvasSceneObject[], fallback: (reason: string) => void) {
    const keep = new Set<string>()
    const dpr = Math.max(1, window.devicePixelRatio || 1)
    const density = viewport.scale * dpr
    if (mode === 'retained') for (const connection of scene.connections) {
      const element = this.root.querySelector<SVGElement>(`[data-connector-id="${CSS.escape(connection.id)}"]`)
      const path = element?.querySelector<SVGPathElement>('.connector-path')
      // Animated/dashed/labelled/arrowed connections retain exact SVG semantics.
      if (!element || !path || connection.animated || connection.dashed || connection.startArrow || connection.endArrow || element.matches('.selected,.draft') || element.querySelector('.connector-label')) { fallback('dynamic-or-complex-connection'); continue }
      const bounds = path.getBBox(), padding = 12 / viewport.scale
      const envelope = { x: bounds.x - padding, y: bounds.y - padding, width: bounds.width + padding * 2, height: bounds.height + padding * 2 }
      // The backdrop is beneath DOM: a line crossing any card must stay in SVG.
      if (visible.some((object) => intersects(envelope, object.bounds))) { fallback('connection-overlap'); continue }
      const width = Math.max(1, Math.ceil(envelope.width * density)), height = Math.max(1, Math.ceil(envelope.height * density))
      const bytes = width * height * 4
      const data = path.getAttribute('d') || ''
      const key = JSON.stringify([data, connection.color, connection.width, viewport.scale, dpr])
      const old = this.connections.get(connection.id)
      if (old?.key === key) { old.element = element; keep.add(connection.id); continue }
      if (old) this.removeConnection(connection.id, old)
      if (Math.max(width, height) > Math.min(MAX_SKIN_EDGE, this.maxTextureEdge)) { fallback('connection-budget'); continue }
      const lease = canvasResourceBudget.acquire({ owner: this.resourceOwner, key: `connection:${connection.id}`, pool: 'retained', bytes, pinned: true, priority: 15 })
      if (!lease) { fallback('connection-budget'); continue }
      const canvas = document.createElement('canvas'); canvas.width = width; canvas.height = height
      const context = canvas.getContext('2d')!
      context.scale(density, density); context.translate(-envelope.x, -envelope.y)
      context.strokeStyle = connection.color; context.lineWidth = connection.width / viewport.scale; context.globalAlpha = .9
      context.shadowColor = '#0009'; context.shadowOffsetY = 2 * dpr; context.shadowBlur = 3 * dpr
      context.stroke(new Path2D(data))
      try {
        const texture = new Texture({ source: new CanvasSource({ resource: canvas, resolution: density }) })
        const sprite = new Sprite(texture); sprite.position.set(envelope.x, envelope.y); sprite.zIndex = 4
        this.layer.addChild(sprite)
        this.connections.set(connection.id, { element, sprite, texture, key, bytes, lease }); keep.add(connection.id)
        this.metrics.bytes += bytes; this.metrics.builds++
      } catch { lease.release(); fallback('render-failed') }
    }
    for (const [id, entry] of this.connections) if (!keep.has(id)) this.removeConnection(id, entry)
    this.metrics.connections = this.connections.size
  }

  private removeConnection(id: string, entry: ConnectionEntry) {
    delete entry.element.dataset.retainedConnection
    entry.sprite.destroy(); entry.texture.destroy(true); entry.lease.release(); this.metrics.bytes -= entry.bytes
    this.connections.delete(id); this.metrics.disposed++
  }

  private releaseImage(key: string) {
    const shared = this.images.get(key)
    if (shared && --shared.users === 0) shared.lease.setPinned(false)
  }

  private releaseSkin(key: string) {
    const shared = this.skins.get(key)
    if (shared && --shared.users === 0) shared.lease.setPinned(false)
  }

  private releaseGeometry(key: string) {
    const shared = this.geometries.get(key)
    if (shared && --shared.users === 0) shared.lease.setPinned(false)
  }

  private reserve(key: string, bytes: number, priority: number, evict: () => void) {
    const lease = canvasResourceBudget.acquire({ owner: this.resourceOwner, key, pool: 'retained', bytes, pinned: true, priority, evict })
    if (!lease) throw new Error('texture-budget')
    return lease
  }

  private evictImage(key: string, force = false) {
    const shared = this.images.get(key); if (!shared || shared.users > 0 && !force) return
    shared.lease.release(); shared.texture.destroy(true); this.metrics.bytes -= shared.bytes; this.images.delete(key)
  }

  private evictSkin(key: string, force = false) {
    const shared = this.skins.get(key); if (!shared || shared.users > 0 && !force) return
    shared.lease.release(); shared.texture.destroy(true); this.metrics.bytes -= shared.bytes; this.skins.delete(key)
  }

  private evictGeometry(key: string, force = false) {
    const shared = this.geometries.get(key); if (!shared || shared.users > 0 && !force) return
    shared.lease.release(); shared.geometry.destroy(true); this.metrics.bytes -= shared.bytes; this.geometries.delete(key)
  }

  private clearSceneResources() {
    for (const [id, entry] of [...this.entries]) this.remove(id, entry)
    for (const [id, entry] of [...this.connections]) this.removeConnection(id, entry)
    for (const key of [...this.images.keys()]) this.evictImage(key, true)
    for (const key of [...this.skins.keys()]) this.evictSkin(key, true)
    for (const key of [...this.geometries.keys()]) this.evictGeometry(key, true)
  }

  private staticImage(url: string, extension: string) {
    if (['jpg', 'jpeg', 'bmp'].includes(extension)) return true
    // SVG may animate through CSS or reference external content, including when
    // base64 encoded. Keep its live DOM rendering until that path is qualified.
    if (url.startsWith('data:image/svg+xml')) return false
    if (extension !== 'png') return false // GIF, animated WebP/AVIF and format decoders stay live in DOM.
    if (this.pngStatus.has(url)) return this.pngStatus.get(url)!
    if (this.probes.size >= 4 || this.pngStatus.size >= 256) return false
    if (!this.probes.has(url)) {
      const controller = new AbortController(); this.probes.set(url, controller)
      void staticPng(url, controller.signal).then((isStatic) => {
        if (this.stopped || controller.signal.aborted) return
        this.pngStatus.set(url, isStatic)
      }).catch(() => { if (!this.stopped && !controller.signal.aborted) this.pngStatus.set(url, false) }).finally(() => {
        if (this.probes.get(url) === controller) this.probes.delete(url)
        if (!this.stopped) { this.sourceRevision++; this.wake() }
      })
    }
    return false
  }

  private remove(id: string, entry: Entry) {
    delete entry.element.dataset.retainedPaint
    entry.container.destroy({ children: true })
    this.releaseSkin(entry.skinKey)
    if (entry.imageKey) this.releaseImage(entry.imageKey)
    if (entry.geometryKey) this.releaseGeometry(entry.geometryKey)
    this.entries.delete(id); this.metrics.disposed++
  }

  dispose() {
    this.stopped = true; this.reveal()
    this.root.removeEventListener('load', this.resourceChanged, true); this.root.removeEventListener('error', this.resourceChanged, true)
    for (const probe of this.probes.values()) probe.abort()
    this.probes.clear(); this.pngStatus.clear()
    this.clearSceneResources()
    canvasResourceBudget.releaseOwner(this.resourceOwner)
    this.layer.destroy({ children: true })
  }
}

function intersects(a: CanvasSceneObject['bounds'], b: CanvasSceneObject['bounds']) { return a.x < b.x + b.width && b.x < a.x + a.width && a.y < b.y + b.height && b.y < a.y + a.height }
function insideBody(child: CanvasSceneObject, parent: Candidate) {
  if (parent.object.kind !== 'container' || parent.object.appearance.rotation || child.appearance.rotation) return false
  const outer = parent.object.localBounds!, inner = child.bounds
  const header = parent.element.querySelector<HTMLElement>(':scope > header')?.offsetHeight || 0
  return inner.x >= outer.x + 3 && inner.y >= outer.y + header + 3 && inner.x + inner.width <= outer.x + outer.width - 3 && inner.y + inner.height <= outer.y + outer.height - 3
}
function splitCss(value: string) { return value.split(/,(?![^()]*\))/).map((part) => part.trim()) }
function drawSkin(context: CanvasRenderingContext2D, width: number, height: number, radius: number, color: string, shadows: string, density: number) {
  const path = () => { context.beginPath(); context.roundRect(0, 0, width, height, radius) }
  const parsed = shadows === 'none' ? [] : splitCss(shadows).map((shadow) => ({ color: shadow.match(/(?:rgba?|color)\([^)]+\)/)?.[0] || '#0000', numbers: [...shadow.matchAll(/(-?[\d.]+)px/g)].map((match) => Number(match[1])), inset: shadow.includes('inset') }))
  for (const shadow of [...parsed].reverse()) {
    if (shadow.inset) continue
    context.save()
    context.shadowColor = shadow.color; context.shadowOffsetX = (shadow.numbers[0] || 0) * density; context.shadowOffsetY = (shadow.numbers[1] || 0) * density; context.shadowBlur = (shadow.numbers[2] || 0) * density
    path(); context.fillStyle = '#000'; context.fill(); context.restore()
  }
  // CSS outer shadows never darken the background inside the border box.
  context.save(); context.globalCompositeOperation = 'destination-out'; path(); context.fillStyle = '#000'; context.fill(); context.restore()
  path(); context.fillStyle = color; context.fill()
  for (const shadow of parsed) if (shadow.inset && !(shadow.numbers[2] > 0)) {
    context.save(); path(); context.clip(); context.fillStyle = shadow.color
    if (shadow.numbers[1] > 0) context.fillRect(0, 0, width, shadow.numbers[1])
    if (shadow.numbers[3] > 0) { path(); context.strokeStyle = shadow.color; context.lineWidth = shadow.numbers[3] * 2; context.stroke() }
    context.restore()
  }
}

/** Read only PNG headers, then cancel the stream before image payload decode.
 * acTL precedes IDAT in APNG. Unknown or oversized headers keep the DOM path. */
async function staticPng(url: string, signal: AbortSignal) {
  const response = await fetch(url, { signal }); if (!response.ok || !response.body) return false
  const reader = response.body.getReader(); let bytes = new Uint8Array(0)
  try {
    while (bytes.length < 65536) {
      const chunk = await reader.read(); if (chunk.done) return false
      const next = new Uint8Array(Math.min(65536, bytes.length + chunk.value.length)); next.set(bytes); next.set(chunk.value.subarray(0, next.length - bytes.length), bytes.length); bytes = next
      if (bytes.length < 8) continue
      if (bytes[0] !== 137 || String.fromCharCode(...bytes.subarray(1, 4)) !== 'PNG') return false
      let offset = 8
      while (offset + 8 <= bytes.length) {
        const length = new DataView(bytes.buffer).getUint32(offset); const type = String.fromCharCode(...bytes.subarray(offset + 4, offset + 8))
        if (type === 'acTL') return false
        if (type === 'IDAT') return true
        offset += length + 12
      }
    }
    return false
  } finally { await reader.cancel().catch(() => undefined) }
}
