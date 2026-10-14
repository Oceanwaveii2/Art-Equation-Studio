import { requestAppFrame, cancelAppFrame } from '../canvas-engine/appFrameClock'
import {appendAssetPathUrl} from '../canvas-engine/assetPathUrl'
import { TILE_ATLAS_EDGE as EDGE, TILE_SLOT_EDGE as SLOT, TILE_CAPACITY, type PyramidTile, type TileRect } from '../canvas-engine/imagePyramid'
import { canvasResourceBudget, type CanvasResourceLease } from '../canvas-engine/resourceBudget'

type Resident = { slot: number; used: number }
type Ready = { tile: PyramidTile; bitmap: ImageBitmap }
async function boundedTileBlob(response: Response) {
  if (!response.body) throw new Error('Tile response is empty')
  const reader = response.body.getReader(), chunks: BlobPart[] = []
  let bytes = 0
  try {
    for (;;) {
      const { value, done } = await reader.read()
      if (done) break
      bytes += value.byteLength
      if (bytes > 4 * 1024 * 1024) { await reader.cancel(); throw new Error('Tile exceeds the transfer budget') }
      chunks.push(new Uint8Array(value))
    }
  } finally { reader.releaseLock() }
  return new Blob(chunks, { type: 'image/png' })
}
export type TileView = { tiles: PyramidTile[]; prefetch: PyramidTile[]; crop: TileRect; fit: TileRect; sourceWidth: number; sourceHeight: number; density: number }
const owners = new Map<object, CanvasResourceLease>()
const waiting = new Set<() => void>()
/** Four 64 MiB atlases at most. Posters remain usable when slots are occupied. */
export function acquireTileContext(owner: object, wake: () => void) {
  if (owners.has(owner)) { owners.get(owner)!.touch(); return true }
  const lease = canvasResourceBudget.acquire({ owner, key: 'tile-atlas', pool: 'tile-atlas', bytes: EDGE * EDGE * 4, pinned: true, priority: 100 })
  if (!lease) { waiting.add(wake); return false }
  waiting.delete(wake); owners.set(owner, lease); return true
}
export function releaseTileContext(owner: object, wake: () => void) {
  waiting.delete(wake)
  const lease = owners.get(owner)
  if (lease) { owners.delete(owner); lease.release(); for (const notify of [...waiting]) notify() }
}

/** Bounded tile atlas. Drawing and tile delivery do not set React state.
 * Poster and detail occupy disjoint quads, preserving translucent image alpha. */
export class WebGLTileSurface {
  private gl: WebGLRenderingContext
  private program: WebGLProgram
  private buffer: WebGLBuffer
  private atlas: WebGLTexture
  private poster: WebGLTexture
  private residents = new Map<string, Resident>()
  private inflight = new Map<string, AbortController>()
  private ready: Ready[] = []
  private failed = new Set<string>()
  private view?: TileView
  private stopped = false
  private raf = 0
  private serial = 0
  private bytesUploaded = 0
  private evictions = 0
  private uploads = 0
  private canvas: HTMLCanvasElement
  private baseUrl: string
  private changed: (error?: string) => void
  private surfaceLease?: CanvasResourceLease

  constructor(canvas: HTMLCanvasElement, baseUrl: string, posterImage: HTMLImageElement, changed: (error?: string) => void) {
    this.canvas = canvas; this.baseUrl = baseUrl; this.changed = changed
    const gl = canvas.getContext('webgl', { alpha: true, premultipliedAlpha: true, antialias: false, depth: false, stencil: false, preserveDrawingBuffer: false })
    if (!gl || gl.getParameter(gl.MAX_TEXTURE_SIZE) < EDGE) throw new Error('Tile rendering needs a 4096-pixel WebGL texture')
    this.gl = gl
    const compile = (type: number, source: string) => {
      const shader = gl.createShader(type)!
      gl.shaderSource(shader, source); gl.compileShader(shader)
      if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) { const message = gl.getShaderInfoLog(shader) || 'Tile shader compilation failed'; gl.deleteShader(shader); throw new Error(message) }
      return shader
    }
    const vertex = compile(gl.VERTEX_SHADER, 'attribute vec2 a; attribute vec2 u; varying vec2 uv; void main(){ gl_Position=vec4(a,0.,1.); uv=u; }')
    const fragment = compile(gl.FRAGMENT_SHADER, 'precision highp float; varying vec2 uv; uniform sampler2D tex; uniform vec4 bounds; void main(){gl_FragColor=texture2D(tex,clamp(uv,bounds.xy,bounds.zw));}')
    const program = gl.createProgram()!
    gl.attachShader(program, vertex); gl.attachShader(program, fragment); gl.linkProgram(program)
    gl.deleteShader(vertex); gl.deleteShader(fragment)
    if (!gl.getProgramParameter(program, gl.LINK_STATUS)) throw new Error('Tile shader linking failed')
    this.program = program; gl.useProgram(program)
    this.buffer = gl.createBuffer()!; gl.bindBuffer(gl.ARRAY_BUFFER, this.buffer)
    for (const [name, offset] of [['a', 0], ['u', 8]] as const) { const location = gl.getAttribLocation(program, name); gl.enableVertexAttribArray(location); gl.vertexAttribPointer(location, 2, gl.FLOAT, false, 16, offset) }
    const texture = () => { const t = gl.createTexture()!; gl.bindTexture(gl.TEXTURE_2D, t); gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR); gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR); gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE); gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE); return t }
    this.atlas = texture(); gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, EDGE, EDGE, 0, gl.RGBA, gl.UNSIGNED_BYTE, null)
    this.poster = texture(); gl.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, true)
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, posterImage)
    if (gl.getError() !== gl.NO_ERROR) { this.dispose(); throw new Error('Could not allocate the tile display budget') }
    const surfaceLease = canvasResourceBudget.acquire({ owner: this, key: 'tile-surface', pool: 'tile-surface', bytes: 4, pinned: true, priority: 90 })
    if (!surfaceLease) { this.dispose(); throw new Error('Tile display budget is unavailable') }
    this.surfaceLease = surfaceLease
    gl.disable(gl.BLEND); gl.clearColor(0, 0, 0, 0)
    canvas.addEventListener('webglcontextlost', this.lost)
  }

  private lost = (event: Event) => { event.preventDefault(); this.changed('Graphics context lost. Showing image preview.'); this.dispose() }
  update(view: TileView) {
    if (this.stopped) return
    this.view = view
    const wanted = new Set([...view.tiles, ...view.prefetch].map(t => t.key))
    for (const [key, request] of this.inflight) if (!wanted.has(key)) request.abort()
    this.ready = this.ready.filter(entry => { if (wanted.has(entry.tile.key)) return true; entry.bitmap.close(); return false })
    for (const key of this.failed) if (!wanted.has(key)) this.failed.delete(key)
    for (const tile of view.tiles) { const resident = this.residents.get(tile.key); if (resident) { resident.used = ++this.serial; this.residents.delete(tile.key); this.residents.set(tile.key, resident) } }
    this.schedule(); this.pump()
  }
  retry() { this.failed.clear(); this.pump(); this.schedule() }
  private schedule = () => { if (!this.stopped && !this.raf) this.raf = requestAppFrame(this.draw) }
  private pump() {
    if (this.stopped || !this.view) return
    for (const tile of [...this.view.tiles, ...this.view.prefetch]) {
      if (this.inflight.size + this.ready.length >= 4) break
      if (this.residents.has(tile.key) || this.inflight.has(tile.key) || this.failed.has(tile.key) || this.ready.some(r => r.tile.key === tile.key)) continue
      const controller = new AbortController(); this.inflight.set(tile.key, controller)
      void fetch(appendAssetPathUrl(this.baseUrl,tile.key), { signal: controller.signal }).then(async response => {
        if (!response.ok) throw new Error('Missing image tile')
        const blob = await boundedTileBlob(response)
        // Validate PNG dimensions BEFORE handing untrusted bytes to the decoder.
        const header = new DataView(await blob.slice(0, 24).arrayBuffer())
        if (header.byteLength < 24 || header.getUint32(0) !== 0x89504e47 || header.getUint32(4) !== 0x0d0a1a0a || header.getUint32(16) !== tile.pixelWidth || header.getUint32(20) !== tile.pixelHeight) throw new Error('Invalid tile dimensions')
        if (controller.signal.aborted || this.stopped) return
        const bitmap = await createImageBitmap(blob, { premultiplyAlpha: 'premultiply', colorSpaceConversion: 'default' })
        if (this.stopped || controller.signal.aborted || !this.view || ![...this.view.tiles, ...this.view.prefetch].some(t => t.key === tile.key)) bitmap.close()
        else this.ready.push({ tile, bitmap })
      }).catch(error => { if (!controller.signal.aborted && !this.stopped) { this.failed.add(tile.key); if (this.view?.tiles.some(t => t.key === tile.key)) this.changed(String(error)) } }).finally(() => { this.inflight.delete(tile.key); this.schedule(); this.pump() })
    }
  }
  private draw = () => {
    this.raf = 0
    if (this.stopped || !this.view) return
    const gl = this.gl, view = this.view, pinned = new Set(view.tiles.map(t => t.key))
    for (let count = 0; count < 2 && this.ready.length; count++) {
      const entry = this.ready.shift()!
      let slot: number
      if (this.residents.size < TILE_CAPACITY) {
        const used = new Set([...this.residents.values()].map(r => r.slot)); slot = 0; while (used.has(slot)) slot++
      } else {
        // Map insertion order is LRU order; fixed-size slots cannot fragment.
        const victim = [...this.residents].find(([key]) => !pinned.has(key))
        if (!victim) { entry.bitmap.close(); continue }
        slot = victim[1].slot; this.residents.delete(victim[0]); this.evictions++
      }
      gl.bindTexture(gl.TEXTURE_2D, this.atlas)
      gl.texSubImage2D(gl.TEXTURE_2D, 0, slot % 7 * SLOT, Math.floor(slot / 7) * SLOT, gl.RGBA, gl.UNSIGNED_BYTE, entry.bitmap)
      entry.bitmap.close(); this.bytesUploaded += entry.tile.pixelWidth * entry.tile.pixelHeight * 4; this.uploads++
      this.residents.set(entry.tile.key, { slot, used: ++this.serial })
    }
    const { crop, fit, sourceWidth: sw, sourceHeight: sh } = view
    // Cropped backing stores cap display allocation independently of source size.
    const density = Math.min(view.density, 4096 / Math.max(1, crop.width), 4096 / Math.max(1, crop.height), Math.sqrt(8_388_608 / Math.max(1, crop.width * crop.height)))
    let width = Math.max(1, Math.min(4096, Math.ceil(crop.width * density))), height = Math.max(1, Math.min(4096, Math.floor(8_388_608 / width), Math.ceil(crop.height * density)))
    // If other active canvases own the shared surface pool, reduce this backing
    // store rather than stealing pinned resources or losing the poster fallback.
    while (!this.surfaceLease!.resize(width * height * 4) && (width > 1 || height > 1)) { width = Math.max(1, Math.floor(width / 2)); height = Math.max(1, Math.floor(height / 2)) }
    if (this.canvas.width !== width || this.canvas.height !== height) { this.canvas.width = width; this.canvas.height = height }
    Object.assign(this.canvas.style, { left: `${crop.x}px`, top: `${crop.y}px`, width: `${crop.width}px`, height: `${crop.height}px` })
    gl.viewport(0, 0, width, height); gl.clear(gl.COLOR_BUFFER_BIT)
    for (const tile of view.tiles) {
      const resident = this.residents.get(tile.key)
      const x0 = ((fit.x + tile.x / sw * fit.width - crop.x) / crop.width) * 2 - 1
      const x1 = ((fit.x + (tile.x + tile.width) / sw * fit.width - crop.x) / crop.width) * 2 - 1
      const y0 = 1 - ((fit.y + tile.y / sh * fit.height - crop.y) / crop.height) * 2
      const y1 = 1 - ((fit.y + (tile.y + tile.height) / sh * fit.height - crop.y) / crop.height) * 2
      let u0: number, v0: number, u1: number, v1: number
      if (resident) {
        const sx = resident.slot % 7 * SLOT + tile.left, sy = Math.floor(resident.slot / 7) * SLOT + tile.top
        u0 = sx / EDGE; v0 = sy / EDGE; u1 = (sx + tile.coreWidth) / EDGE; v1 = (sy + tile.coreHeight) / EDGE
        gl.bindTexture(gl.TEXTURE_2D, this.atlas)
        // Clamp to this tile's texel centers, including its overlap. This keeps
        // outer image edges from sampling an unrelated neighboring atlas slot.
        const ax = resident.slot % 7 * SLOT, ay = Math.floor(resident.slot / 7) * SLOT
        gl.uniform4f(gl.getUniformLocation(this.program, 'bounds'), (ax + .5) / EDGE, (ay + .5) / EDGE, (ax + tile.pixelWidth - .5) / EDGE, (ay + tile.pixelHeight - .5) / EDGE)
      } else { u0 = tile.x / sw; v0 = tile.y / sh; u1 = (tile.x + tile.width) / sw; v1 = (tile.y + tile.height) / sh; gl.bindTexture(gl.TEXTURE_2D, this.poster); gl.uniform4f(gl.getUniformLocation(this.program, 'bounds'), 0, 0, 1, 1) }
      gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([x0,y0,u0,v0, x1,y0,u1,v0, x0,y1,u0,v1, x0,y1,u0,v1, x1,y0,u1,v0, x1,y1,u1,v1]), gl.STREAM_DRAW)
      gl.drawArrays(gl.TRIANGLES, 0, 6)
    }
    const budget = canvasResourceBudget.snapshot()
    Object.assign(this.canvas.dataset, { level: String(view.tiles[0]?.level ?? 0), wanted: String(view.tiles.length), visibleReady: String(view.tiles.filter(t => this.residents.has(t.key)).length), actualDensity: String(Math.min(width / crop.width, height / crop.height)), requiredDensity: String(view.density), prefetch: String(view.prefetch.length), resident: String(this.residents.size), pending: String(this.inflight.size + this.ready.length), failed: String(view.tiles.filter(t => this.failed.has(t.key)).length), atlasBytes: String(EDGE * EDGE * 4), surfaceBytes: String(width * height * 4), uploads: String(this.uploads), uploadedBytes: String(this.bytesUploaded), evictions: String(this.evictions), contexts: String(owners.size), resourceBytes: String(budget.bytes), resourceLimit: String(budget.limit), resourceDenied: String(budget.denied) })
    this.changed()
    if (this.ready.length) this.schedule()
    this.pump()
  }
  dispose() {
    if (this.stopped) return
    this.stopped = true; cancelAppFrame(this.raf)
    for (const request of this.inflight.values()) request.abort()
    for (const entry of this.ready) entry.bitmap.close()
    this.ready = []; this.residents.clear(); this.canvas.removeEventListener('webglcontextlost', this.lost)
    const gl = this.gl
    gl.deleteBuffer(this.buffer); gl.deleteTexture(this.atlas); gl.deleteTexture(this.poster); gl.deleteProgram(this.program)
    this.surfaceLease?.release()
    gl.getExtension('WEBGL_lose_context')?.loseContext()
    this.canvas.width = this.canvas.height = 1
  }
}
