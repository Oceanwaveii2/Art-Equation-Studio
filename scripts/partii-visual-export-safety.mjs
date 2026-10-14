import assert from 'node:assert/strict'
import { readFile, mkdir, writeFile } from 'node:fs/promises'
import { resolve, dirname } from 'node:path'
import { createHash } from 'node:crypto'
import ts from 'typescript'

const cache = new Map(), fingerprints = {}
async function moduleUrl(file) {
  file = resolve(file)
  if (cache.has(file)) return cache.get(file)
  const source = await readFile(file, 'utf8')
  fingerprints[file] = createHash('sha256').update(source).digest('hex')
  let code = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 } }).outputText
  for (const match of [...code.matchAll(/from ['"](.+?)['"]/g)]) {
    if (match[1].startsWith('.')) code = code.replace(match[0], "from '" + await moduleUrl(resolve(dirname(file), match[1] + '.ts')) + "'")
  }
  const url = 'data:text/javascript;base64,' + Buffer.from(code).toString('base64')
  cache.set(file, url)
  return url
}
const { prepareBoardVisualExport, connectorVisualExportBounds } = await import(await moduleUrl('src/board/boardVisualExport.ts'))
const { connectorGeometry, connectorLabelPoint, connectorSvgMarkup } = await import(await moduleUrl('src/board/connectors.ts'))
const { createMindMapTemplate } = await import(await moduleUrl('src/board/diagramStructureCore.ts'))
const node = (id, kind = 'note', extra = {}) => ({ id, kind, title: id, x: 10, y: 20, width: 100, height: 80, ...extra })
const edge = (id, extra = {}) => ({ id, sourcePort: 'right', targetPort: 'left', style: 'elbow', color: '#ee942f', width: 2, startArrow: true, endArrow: true, dashed: false, animated: false, label: id, ...extra })
const board = (nodes = [], connectors = []) => ({ id: 'export', title: 'Export fixture', viewport: { x: -20, y: 30, scale: .5 }, nodes, connectors })
const options = (target = 'full', selectedIds = []) => ({ target, selectedIds, viewportSize: { width: 800, height: 600 } })
const prepared = (fixture, target = 'full', ids = []) => {
  const result = prepareBoardVisualExport(fixture, options(target, ids))
  assert(result.ok, result.ok ? '' : JSON.stringify(result.issues))
  return result.value
}
const check = (name, run) => { run(); checks.push(name) }
const checks = []
const contains = (box, point, margin = 0) => point.x >= box.left - margin && point.x <= (box.right ?? box.left + box.width) + margin && point.y >= box.top - margin && point.y <= (box.bottom ?? box.top + box.height) + margin
const hierarchy = () => board([
  node('deep', 'image', { groupId: 'inner', zIndex: -999, assetId: 'immutable-source' }),
  node('outside', 'note', { x: 900, zIndex: 6 }),
  node('frame', 'group', { containerRole: 'frame', x: 0, y: 0, width: 300, height: 200, zIndex: 90 }),
  node('inner', 'group', { groupId: 'frame', zIndex: 2 }),
  node('column', 'column', { groupId: 'inner', zIndex: -10 }),
  node('member', 'shape', { parentColumnId: 'column', zIndex: -1000, x: 360, y: -50 }),
])
check('Ownership paint order overrides child negative layer and keeps complete sibling subtrees', () => {
  const fixture = hierarchy(), before = JSON.stringify(fixture), result = prepared(fixture)
  assert.deepEqual(result.nodes.map((item) => item.id), ['outside', 'frame', 'inner', 'deep', 'column', 'member'])
  assert.equal(result.nodes.find((item) => item.id === 'deep'), fixture.nodes[0])
  assert.equal(JSON.stringify(fixture), before)
})
check('Selection/frame expands nested ownership once, preserves world placement and non-clipping members', () => {
  const fixture = hierarchy()
  for (const target of ['selection', 'frame']) {
    const result = prepared(fixture, target, ['frame', 'inner', 'deep'])
    assert.deepEqual(result.nodes.map((item) => item.id), ['frame', 'inner', 'deep', 'column', 'member'])
    assert(result.bounds.left + result.bounds.width > 460 && result.bounds.top < -50)
    assert.equal(result.nodes.find((item) => item.id === 'member').x, 360)
    assert.equal(result.nodes.find((item) => item.id === 'deep').assetId, 'immutable-source')
    if (target === 'frame') assert.equal(result.frameId, 'frame')
  }
})
check('Legacy titled frames and explicit selected containers follow existing region priority', () => {
  const fixture = board([node('plain', 'group'), node('legacy', 'group', { title: 'Storyboard frame' }), node('selected-frame', 'group', { containerRole: 'frame' })])
  assert.equal(prepared(fixture, 'frame', ['selected-frame']).frameId, 'selected-frame')
  assert.equal(prepared(fixture, 'frame', ['plain']).frameId, 'legacy')
  assert.equal(prepared(board([node('plain', 'group')]), 'frame', ['plain']).frameId, 'plain')
  assert(!prepareBoardVisualExport(board([node('ordinary')]), options('frame')).ok)
})
check('Hidden and collapsed mixed ancestors suppress descendants and attached routes while locks remain visible', () => {
  const fixture = hierarchy()
  fixture.nodes.find((item) => item.id === 'inner').collapsed = true
  fixture.nodes.find((item) => item.id === 'outside').locked = true
  fixture.connectors.push(edge('hidden-attached', { sourceId: 'deep', targetId: 'outside' }), edge('free-visible', { sourcePoint: { x: 1000, y: 1000 }, targetPoint: { x: 1200, y: 1000 } }))
  for (const target of ['full', 'viewport']) {
    const result = prepared(fixture, target)
    assert.deepEqual(result.nodes.map((item) => item.id), ['outside', 'frame', 'inner'])
    assert.deepEqual(result.connectors.map((item) => item.id), ['free-visible'])
  }
  fixture.nodes.find((item) => item.id === 'frame').hidden = true
  assert.deepEqual(prepared(fixture).nodes.map((item) => item.id), ['outside'])
  assert(!prepareBoardVisualExport(fixture, options('selection', ['frame'])).ok)
})
check('Mind-map collapse projects semantic descendants and their edges across separate containers', () => {
  const template = createMindMapTemplate('export-tree', { x: 100, y: 200 })
  assert(template.ok)
  const fixture = board(template.value.nodes, template.value.connectors)
  fixture.nodes[0].mindMap.collapsed = true
  const collapsed = prepared(fixture)
  assert.deepEqual(collapsed.nodes.map((item) => item.id), [fixture.nodes[0].id])
  assert.equal(collapsed.connectors.length, 0)
  fixture.nodes[0].mindMap.collapsed = false
  assert.equal(prepared(fixture).nodes.length, 20)
  assert.equal(prepared(fixture).connectors.length, 19)
})
check('Selection retains internal and tethered free routes, excludes boundaries and unrelated detached routes', () => {
  const fixture = board([node('a'), node('b', 'note', { x: 200 }), node('outside', 'note', { x: 400 })], [
    edge('internal', { sourceId: 'a', targetId: 'b' }),
    edge('tethered', { sourceId: 'a', targetPoint: { x: -900, y: 1200 } }),
    edge('boundary', { sourceId: 'a', targetId: 'outside' }),
    edge('unrelated-free', { sourcePoint: { x: 2000, y: 2000 }, targetPoint: { x: 2100, y: 2200 } }),
  ])
  const result = prepared(fixture, 'selection', ['a', 'b'])
  assert.deepEqual(result.connectors.map((item) => item.id), ['internal', 'tethered'])
  assert(contains(result.bounds, { x: -918, y: 1218 }))
  assert(!contains(result.bounds, { x: 2000, y: 2000 }))
})
check('Remote elbow bends and a long offset escaped label extend full and selection bounds', () => {
  const connection = edge('remote-elbow', { sourceId: 'a', targetId: 'b', bendPoints: [{ x: -800, y: -1000 }, { x: 1200, y: 1400 }], label: '<approved> & watched', labelPosition: { t: .6, offsetX: 1700, offsetY: -1500 } })
  const fixture = board([node('a'), node('b', 'note', { x: 300 })], [connection])
  const geometry = connectorGeometry(connection, fixture.nodes), label = connectorLabelPoint(connection, geometry)
  const markup = connectorSvgMarkup(connection, fixture.nodes)
  assert(markup.includes('&lt;approved&gt; &amp; watched'))
  assert(markup.includes('marker-start=') && markup.includes('marker-end='))
  for (const target of ['full', 'selection']) {
    const result = prepared(fixture, target, ['a', 'b'])
    for (const point of geometry.points) assert(contains(result.bounds, point))
    assert(contains(result.bounds, { x: label.x + connection.label.length * 12, y: label.y - 24 }))
    assert(contains(result.bounds, { x: label.x - connection.label.length * 12, y: label.y + 12 }))
  }
})
check('Curved route bounds cover independently evaluated cubic extrema without sample dependence', () => {
  const connection = edge('curve', { sourcePoint: { x: 100, y: 100 }, targetPoint: { x: 120, y: 105 }, sourcePort: 'top', targetPort: 'bottom', style: 'curve', width: 7, label: '' })
  const fixture = board([], [connection]), result = prepared(fixture), box = connectorVisualExportBounds(connection, fixture.nodes)
  const [move, cubic] = connectorGeometry(connection, fixture.nodes).commands
  for (let index = 0; index <= 2000; index++) {
    const t = index / 2000, mt = 1 - t
    const point = { x: mt ** 3 * move[1] + 3 * mt ** 2 * t * cubic[1] + 3 * mt * t ** 2 * cubic[3] + t ** 3 * cubic[5], y: mt ** 3 * move[2] + 3 * mt ** 2 * t * cubic[2] + 3 * mt * t ** 2 * cubic[4] + t ** 3 * cubic[6] }
    assert(contains(box, point)); assert(contains(result.bounds, point))
  }
  assert(contains(box, { x: 100 - 63, y: 100 - 63 }))
  assert(contains(box, { x: 120 + 63, y: 105 + 63 }))
})
check('Edge-only and empty full exports are usable; viewport is exact fixed camera crop', () => {
  const fixture = board([], [edge('free', { sourcePoint: { x: -2500, y: 2700 }, targetPoint: { x: -3000, y: 2900 }, label: 'Outside camera' })])
  assert.equal(prepared(fixture).connectors.length, 1)
  assert(contains(prepared(fixture).bounds, { x: -3000, y: 2900 }))
  assert.deepEqual(prepared(fixture, 'viewport').bounds, { left: 40, top: -60, width: 1600, height: 1200 })
  assert.deepEqual(prepared(board()).bounds, { left: 0, top: 0, width: 1600, height: 1200 })
})
check('Rotated card and inner affine vector stroke envelopes are inside export bounds', () => {
  const fixture = board([node('rotated', 'note', { x: 500, y: 600, width: 200, height: 40, rotation: 90 }), node('affine', 'shape', { x: 0, y: 0, width: 100, height: 100, shapeType: 'path', strokeWidth: 20, vectorTransform: { scaleX: 8, scaleY: 4 }, vectorPath: { version: 1, closed: false, points: [{ x: 0, y: 0 }, { x: 100, y: 100 }] } })])
  const result = prepared(fixture)
  assert(contains(result.bounds, { x: 580, y: 520 }))
  assert(contains(result.bounds, { x: 620, y: 720 }))
  assert(result.bounds.left < -350 && result.bounds.left + result.bounds.width > 450)
})
check('Invalid ownership or mind-map graph refuses all targets including unrelated selection', () => {
  const fixtures = [
    board([node('a', 'group', { groupId: 'b' }), node('b', 'group', { groupId: 'a' }), node('outside')]),
    board([node('a', 'note', { groupId: 'absent' }), node('outside')]),
    board([node('a'), node('a'), node('outside')]),
    board([node('a', 'note', { mindMap: { version: 1, treeId: 'tree', order: 0, parentId: 'a' } }), node('outside')]),
  ]
  for (const fixture of fixtures) for (const target of ['full', 'viewport', 'selection', 'frame']) {
    const before = JSON.stringify(fixture)
    assert(!prepareBoardVisualExport(fixture, options(target, ['outside'])).ok)
    assert.equal(JSON.stringify(fixture), before)
  }
  const template = createMindMapTemplate('invalid-edge', { x: 0, y: 0 }); assert(template.ok)
  assert(!prepareBoardVisualExport(board(template.value.nodes, template.value.connectors.slice(1)), options()).ok)
  assert(!prepareBoardVisualExport(board([node('outside')], [edge('unknown-tree', { sourceId: 'outside', targetPoint: { x: 10, y: 10 }, mindMap: { version: 1, treeId: 'absent', childId: 'outside' } })]), options()).ok)
})
check('Invalid hidden geometry, routes, identities, labels and camera fail closed without normalization', () => {
  const fixtures = [
    board([node('hidden-invalid', 'note', { hidden: true, x: Infinity })]),
    board([node('a')], [edge('missing', { sourceId: 'absent', sourcePoint: { x: 0, y: 0 }, targetId: 'a' })]),
    board([node('a')], [edge('no-anchor', { sourceId: 'a' })]),
    board([], [edge('bad-route', { sourcePoint: { x: 0, y: 0 }, targetPoint: { x: 10, y: 10 }, bendPoints: [{ x: NaN, y: 5 }] })]),
    board([], [edge('duplicate', { sourcePoint: { x: 0, y: 0 }, targetPoint: { x: 10, y: 10 } }), edge('duplicate', { sourcePoint: { x: 0, y: 0 }, targetPoint: { x: 10, y: 10 } })]),
    board([], [edge('bad-label', { sourcePoint: { x: 0, y: 0 }, targetPoint: { x: 10, y: 10 }, labelPosition: { t: .5, offsetX: Infinity, offsetY: 0 } })]),
  ]
  for (const fixture of fixtures) {
    const before = structuredClone(fixture)
    assert(!prepareBoardVisualExport(fixture, options()).ok); assert.deepEqual(fixture, before)
  }
  assert(!prepareBoardVisualExport(board(), { ...options(), viewportSize: { width: 0, height: 600 } }).ok)
  assert(!prepareBoardVisualExport({ ...board(), viewport: { x: 0, y: 0, scale: 0 } }, options()).ok)
  assert(!prepareBoardVisualExport(board([node('a')]), options('selection', ['missing'])).ok)
})

for (const [file, hash] of Object.entries(fingerprints)) assert.equal(createHash('sha256').update(await readFile(file)).digest('hex'), hash, 'Source changed during regression: ' + file)
const output = resolve('output/partii-visual-export-safety/' + new Date().toISOString().replaceAll(':', '-').replaceAll('.', '-'))
await mkdir(output, { recursive: true })
const report = { createdAt: new Date().toISOString(), status: 'passed', passedGroups: checks.length, assertions: checks, sourceFingerprints: fingerprints, scope: 'Pure canonical production export projection and existing connector serializer. Root App integration/artifact pixels/native dialogs and disk remain separate.' }
await writeFile(resolve(output, 'report.json'), JSON.stringify(report, null, 2) + '\n', { flag: 'wx' })
console.log(JSON.stringify({ status: 'passed', groups: checks.length, output }))
