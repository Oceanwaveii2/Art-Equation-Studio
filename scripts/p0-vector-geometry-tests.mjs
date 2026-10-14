import { vectorModuleUrl as sharedVectorUrl, geometryModuleUrl as sharedGeometryUrl, booleanModuleUrl as sharedBooleanUrl } from './p0-test-module-loader.mjs'
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import { pathToFileURL } from 'node:url'
import { createRequire } from 'node:module'
import { createHash } from 'node:crypto'
import ts from 'typescript'

// Run the real geometry resolver and scene adapter. No DOM, native app,
// projects or media are opened. Renderer pixels are a separate acceptance.
const files = ['src/board/velloVectorGeometry.ts', 'src/model/vector.ts', 'src/model/vectorBooleanGeometry.ts',
  'src/board/artEquationCanvasAdapter.ts', 'src/board/diagramStructureCore.ts', 'src/canvasTheme.ts']
const texts = new Map(await Promise.all(files.map(async file => [file, await readFile(resolve(file), 'utf8')])))
const sourceHashes = Object.fromEntries([...texts].map(([file, text]) => [file, createHash('sha256').update(text).digest('hex')]))
const url = text => `data:text/javascript;base64,${Buffer.from(text).toString('base64')}`
const compile = file => ts.transpileModule(texts.get(file), { fileName: file,
  compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ESNext } }).outputText
const require = createRequire(resolve('package.json'))
const vectorUrl = sharedVectorUrl
const booleanUrl = sharedBooleanUrl
const geometryUrl = sharedGeometryUrl
const coreUrl = url(compile('src/board/diagramStructureCore.ts'))
const themeUrl = url(compile('src/canvasTheme.ts'))
const adapterUrl = url(compile('src/board/artEquationCanvasAdapter.ts')
  .replace(/from ['"]\.\/velloVectorGeometry['"]/g, `from '${geometryUrl}'`)
  .replace(/from ['"]\.\/diagramStructureCore['"]/g, `from '${coreUrl}'`)
  .replace(/from ['"]\.\.\/canvasTheme['"]/g, `from '${themeUrl}'`))
const { prepareVelloVectorGeometry: prepare } = await import(geometryUrl)
const { createArtEquationCanvasScene: project } = await import(adapterUrl)
const { resolveVectorBooleanGeometry: resolveBoolean } = await import(booleanUrl)
const checks = []
const check = (name, value) => { checks.push({ name, passed: Boolean(value) }); assert(value, name) }
const close = (actual, expected) => actual.length === expected.length && actual.every((value, index) =>
  typeof value === 'number' ? Math.abs(value - expected[index]) < 1e-9 : value === expected[index])
const rectangle = (x, y, width, height) => ({ version: 1, closed: true,
  points: [{ x, y }, { x: x + width, y }, { x: x + width, y: y + height }, { x, y: y + height }] })
const pathNode = (extra = {}) => ({ id: 'path', kind: 'shape', shapeType: 'path', x: 0, y: 0, width: 100, height: 100,
  title: 'Path', color: '#ff6633', strokeWidth: 2, vectorPath: rectangle(0, 0, 100, 100), ...extra })
const scene = nodes => project({ id: 'fixture', nodes, connectors: [] }, [], { background: '#111111', grid: '#555555' })

const zero = prepare(pathNode())
check('board origin zero remains zero', zero.status === 'ready' && close(zero.commands[0], ['M', 0, 0]))
check('raw frame and derivative envelope are independent', zero.status === 'ready' && zero.bounds.x === 0 && zero.bounds.width === 100)
check('derivative and nested commands/bounds are immutable', Object.isFrozen(zero) && Object.isFrozen(zero.commands)
  && Object.isFrozen(zero.commands[0]) && Object.isFrozen(zero.bounds))

const rotated = prepare(pathNode({ x: 10, y: 20, width: 100, height: 80, rotation: 90,
  vectorPath: rectangle(0, 0, 100, 80) }))
check('ninety-degree rotation is around the model frame centre', rotated.status === 'ready'
  && close(rotated.commands[0], ['M', 100, 10]) && close(rotated.commands[1], ['L', 100, 110]))

const reflected = prepare(pathNode({ x: 10, y: 20, width: 100, height: 80,
  vectorPath: rectangle(0, 0, 100, 80), vectorTransform: { scaleX: -2, scaleY: .5, translateX: 7, translateY: -3 } }))
check('reflection and nonuniform scale flatten into world coordinates', reflected.status === 'ready'
  && close(reflected.commands[0], ['M', 167, 37]) && close(reflected.commands[1], ['L', -33, 37]))
check('nonuniform transforms preserve screen-space stroke extent', reflected.status === 'ready'
  && reflected.strokeOutsetCssPx === zero.strokeOutsetCssPx)

const skewed = prepare(pathNode({ x: 10, y: 20, width: 100, height: 80,
  vectorPath: rectangle(0, 0, 100, 80), vectorTransform: { skewX: 45, skewY: 45, scaleX: 2, scaleY: 3 } }))
check('skewX then skewY then scale uses the canonical SVG order', skewed.status === 'ready'
  && close(skewed.commands[0], ['M', -260, -160]) && close(skewed.commands[1], ['L', 140, 40]))
check('skew cannot multiply the canonical stroke width', skewed.status === 'ready' && skewed.strokeOutsetCssPx === 5)

const closing = prepare(pathNode({ x: 5, y: 7, vectorPath: { version: 1, closed: true,
  points: [{ x: 0, y: 0, handleIn: { x: -4, y: 1 } }, { x: 40, y: 0 }, { x: 40, y: 40, handleOut: { x: 3, y: -2 } }] } }))
check('authored closing curve survives before closePath', closing.status === 'ready'
  && close(closing.commands.at(-2), ['C', 48, 45, 1, 8, 5, 7]) && close(closing.commands.at(-1), ['Z']))
check('control-point envelope includes closing controls', closing.status === 'ready' && closing.bounds.x <= 1
  && closing.bounds.x + closing.bounds.width >= 48 && closing.bounds.y + closing.bounds.height >= 47)
const rotatedClosing = prepare(pathNode({ x: 5, y: 7, rotation: 90, vectorPath: { version: 1, closed: true,
  points: [{ x: 0, y: 0, handleIn: { x: -4, y: 1 } }, { x: 40, y: 0 }, { x: 40, y: 40, handleOut: { x: 3, y: -2 } }] } }))
check('closing curve controls receive the same rotation as anchors', rotatedClosing.status === 'ready'
  && close(rotatedClosing.commands.at(-2), ['C', 67, 50, 104, 3, 105, 7]))
const open = prepare(pathNode({ vectorPath: { version: 1, closed: false, points: [{ x: 0, y: 0 }, { x: 10, y: 10 }] } }))
check('open paths do not gain closing commands or fills', open.status === 'ready' && !open.hasFill && open.commands.length === 2)

const outer = rectangle(0, 0, 100, 100), inner = rectangle(25, 25, 50, 50)
const holeNode = pathNode({ vectorBoolean: { operation: 'subtract', operands: [outer, inner], fillRules: ['nonzero', 'nonzero'] } })
const before = JSON.stringify(holeNode), hole = prepare(holeNode)
check('shared Boolean resolver creates an outer and a hole contour', hole.status === 'ready'
  && hole.fillRule === 'nonzero' && hole.commands.filter(command => command[0] === 'M').length === 2)
function polygonArea(commands) {
  const contours = []; let current
  for (const command of commands) {
    if (command[0] === 'M') { current = []; contours.push(current); current.push([command[1], command[2]]) }
    else if (command[0] === 'L') current.push([command[1], command[2]])
  }
  return contours.map(points => points.reduce((sum, p, i) => { const q = points[(i + 1) % points.length]; return sum + p[0] * q[1] - p[1] * q[0] }, 0) / 2)
}
const areas = polygonArea(hole.commands)
check('nonzero hole winding opposes the outer contour', areas.length === 2 && areas[0] * areas[1] < 0)
const reflectedHole = prepare({ ...holeNode, vectorTransform: { scaleX: -2, scaleY: .5 } })
const reflectedAreas = polygonArea(reflectedHole.commands)
check('reflection preserves opposed outer/hole winding', reflectedHole.status === 'ready'
  && reflectedAreas.length === 2 && reflectedAreas[0] * reflectedAreas[1] < 0)
check('Boolean source operands and semantics are unchanged', JSON.stringify(holeNode) === before)
const empty = prepare(pathNode({ vectorBoolean: { operation: 'intersect', operands: [outer, rectangle(150, 0, 20, 20)] } }))
check('resolved empty sets never resurrect the primary path', empty.status === 'ready' && empty.commands.length === 0 && empty.bounds === null)
const preset = prepare(pathNode({ vectorBoolean: { operation: 'subtract', operands: [outer, inner], resolvedPaths: [] } }))
check('explicit empty resolvedPaths remain authoritative', preset.status === 'ready' && preset.commands.length === 0)
const doubleWinding = { version: 1, closed: true, points: [...outer.points, ...outer.points] }
const perRuleNode = pathNode({ vectorBoolean: { operation: 'subtract', operands: [doubleWinding, inner], fillRules: ['evenodd', 'nonzero'] } })
const perRule = prepare(perRuleNode), reference = resolveBoolean('subtract', perRuleNode.vectorBoolean.operands, ['evenodd', 'nonzero'])
check('operand fill rules reach the actual resolver', reference !== undefined && perRule.status === 'ready'
  && perRule.commands.filter(command => command[0] === 'M').length === reference.length)
const nonzero = prepare({ ...perRuleNode, vectorBoolean: { ...perRuleNode.vectorBoolean, fillRules: ['nonzero', 'nonzero'] } })
check('resolved Boolean contours use nonzero output independent of retained operand rules', perRule.status === 'ready'
  && nonzero.status === 'ready' && perRule.fillRule === 'nonzero' && nonzero.fillRule === 'nonzero')

const parent = { id: 'group', kind: 'group', x: 500, y: 700, width: 400, height: 300, title: 'Group', locked: true, zIndex: 8 }
const child = pathNode({ id: 'child', x: 510, y: 730, groupId: 'group', zIndex: -99 })
const inherited = scene([child, parent]), childObject = inherited.objects.find(object => object.id === 'child')
check('ownership ordering still puts a child after its parent subtree', inherited.objects.map(object => object.id).join() === 'group,child')
check('inherited lock remains canonical projection rather than geometry policy', childObject.locked && !child.locked && childObject.preparedVectorGeometry.status === 'ready')
check('child board position never receives parent translation twice', close(childObject.preparedVectorGeometry.commands[0], ['M', 510, 730]))
const invisible = scene([child, { ...parent, hidden: true }]).objects.find(object => object.id === 'child')
check('hidden ancestors retain geometry but project hidden descendants', invisible.hidden && invisible.preparedVectorGeometry.status === 'ready')
const collapsed = scene([child, { ...parent, collapsed: true }]).objects.find(object => object.id === 'child')
check('collapsed ownership still uses the existing derived visibility', collapsed.hidden)
const invalidHierarchy = scene([child]).objects[0]
check('invalid ownership fails closed through canonical projection', invalidHierarchy.hidden && invalidHierarchy.locked)
check('lock state never changes the disposable geometry', JSON.stringify(prepare(pathNode({ locked: true }))) === JSON.stringify(prepare(pathNode({ locked: false }))))
const projected = scene([holeNode]).objects[0]
check('raw Boolean operands and fill rules survive alongside derived paint', projected.vectorBoolean === holeNode.vectorBoolean
  && projected.vectorBoolean.fillRules === holeNode.vectorBoolean.fillRules && projected.shapeType === 'path')

const invalidCases = [
  ['nonfinite frame', { x: Infinity }], ['negative frame', { width: -1 }], ['nonfinite rotation', { rotation: NaN }],
  ['nonfinite inner transform', { vectorTransform: { skewX: Infinity } }], ['null inner transform', { vectorTransform: null }],
  ['invalid primary path', { vectorPath: { version: 1, closed: true, points: [{ x: 0, y: 0 }] } }],
  ['nonfinite handle', { vectorPath: { ...outer, points: [{ ...outer.points[0], handleOut: { x: NaN, y: 1 } }, ...outer.points.slice(1)] } }],
  ['negative stroke', { strokeWidth: -2 }], ['nonfinite stroke', { strokeWidth: Infinity }], ['invalid opacity', { opacity: NaN }],
  ['invalid Boolean operation', { vectorBoolean: { operation: 'nonsense', operands: [outer, inner] } }],
  ['malformed Boolean operand', { vectorBoolean: { operation: 'union', operands: [outer, { ...inner, closed: false }] } }],
  ['invalid operand fill rule', { vectorBoolean: { operation: 'union', operands: [outer, inner], fillRules: ['bad'] } }],
  ['invalid resolved contours', { vectorBoolean: { operation: 'union', operands: [outer, inner], resolvedPaths: [null] } }],
  ['overflowing transformed geometry', { x: 1e308, vectorTransform: { scaleX: 1e308 } }],
]
for (const [name, extra] of invalidCases) check(`${name} fails closed`, prepare(pathNode(extra)).status === 'invalid')
for (const shapeType of ['rectangle', 'ellipse', 'arrow', undefined]) check(`${shapeType} is not guessed from its bounds`, prepare(pathNode({ shapeType })).status === 'unsupported')
const ordinaryLine = prepare(pathNode({ shapeType: 'line' }))
check('ordinary line compiles authored endpoints rather than a filled frame', ordinaryLine.status === 'ready'
  && ordinaryLine.primitive === 'plain-line' && ordinaryLine.commands.length === 2 && !ordinaryLine.hasFill)
check('caption shapes stay unsupported even when paths exist', prepare(pathNode({ diagramShape: 'process', body: 'Caption' })).status === 'unsupported')
check('singular transforms retain explicit unsupported status', prepare(pathNode({ vectorTransform: { scaleX: 0 } })).status === 'unsupported')
check('zero-width stroke is preserved without substitution', prepare(pathNode({ strokeWidth: 0 })).strokeOutsetCssPx === 1)
console.log(JSON.stringify({ passed: true, checks: checks.length, sourceHashes, limitations: [
  'Exact path projection and shared Boolean geometry only; GPU/CPU pixels require renderer acceptance.',
  'Hierarchy visibility/order are preserved; container skins, clipping, styled text, images, connectors and native acceptance remain separate work.',
] }, null, 2))
