type Vertex = { x: number; y: number; u: number; v: number }
export type ImageGeometryInput = { left: number; top: number; width: number; height: number; imageWidth: number; imageHeight: number; radius: number; density: number; transform: { a: number; b: number; c: number; d: number } }

/** Clip a transformed contain-image against its rounded-bottom body. UVs are
 * interpolated at intersections, so the original image remains one texture.
 * Convex triangles batch with sprites without per-card stencil passes. */
export function retainedImageGeometry(input: ImageGeometryInput) {
  const { left, top, width, height, imageWidth, imageHeight, transform: m } = input
  const fit = Math.min(width / imageWidth, height / imageHeight)
  const cx = left + width / 2, cy = top + height / 2
  let polygon: Vertex[] = [[0, 0], [1, 0], [1, 1], [0, 1]].map(([u, v]) => {
    const x = (u - .5) * imageWidth * fit, y = (v - .5) * imageHeight * fit
    return { x: cx + m.a * x + m.c * y, y: cy + m.b * x + m.d * y, u, v }
  })
  const radius = Math.max(0, Math.min(input.radius, width / 2, height / 2))
  const physicalRadius = radius * input.density
  const segments = Math.max(1, Math.ceil(Math.PI / 2 / (2 * Math.acos(Math.max(-1, 1 - .2 / Math.max(.2, physicalRadius))))))
  const edge: { x: number; y: number }[] = [{ x: left, y: top }, { x: left + width, y: top }]
  for (const [x, angle] of [[left + width - radius, 0], [left + radius, Math.PI / 2]]) {
    for (let i = 0; i <= segments; i++) {
      const theta = angle + Math.PI / 2 * i / segments
      edge.push({ x: x + radius * Math.cos(theta), y: top + height - radius + radius * Math.sin(theta) })
    }
  }
  for (let i = 0; i < edge.length && polygon.length; i++) {
    const a = edge[i], b = edge[(i + 1) % edge.length]
    const distance = (p: Vertex) => (b.x - a.x) * (p.y - a.y) - (b.y - a.y) * (p.x - a.x)
    const output: Vertex[] = []
    for (let j = 0; j < polygon.length; j++) {
      const current = polygon[j], previous = polygon[(j + polygon.length - 1) % polygon.length]
      const d0 = distance(previous), d1 = distance(current)
      if ((d0 >= 0) !== (d1 >= 0)) {
        const t = d0 / (d0 - d1)
        output.push({ x: previous.x + t * (current.x - previous.x), y: previous.y + t * (current.y - previous.y), u: previous.u + t * (current.u - previous.u), v: previous.v + t * (current.v - previous.v) })
      }
      if (d1 >= 0) output.push(current)
    }
    polygon = output
  }
  const indices = []
  for (let i = 1; i + 1 < polygon.length; i++) indices.push(0, i, i + 1)
  return { positions: new Float32Array(polygon.flatMap(p => [p.x, p.y])), uvs: new Float32Array(polygon.flatMap(p => [p.u, p.v])), indices: new Uint32Array(indices) }
}
