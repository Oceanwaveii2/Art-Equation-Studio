import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { createHash } from 'node:crypto'
import ts from 'typescript'
import { geometryModuleUrl, p0GeometrySourceHashes } from './p0-test-module-loader.mjs'

// Actual source projection, spatial index and mixed DOM/Vello eligibility.
// No browser/native launch, model persistence or renderer pixel claims.
const files = ['src/board/artEquationCanvasAdapter.ts', 'src/board/diagramStructureCore.ts',
  'src/canvasTheme.ts', 'src/canvas-engine/spatialIndex.ts', 'src/board/velloEligibility.ts']
const texts = new Map(await Promise.all(files.map(async file => [file, await readFile(file, 'utf8')])))
const sourceHashes = { ...p0GeometrySourceHashes, ...Object.fromEntries([...texts].map(([file, text]) =>
  [file, createHash('sha256').update(text).digest('hex')])) }
const compile = file => ts.transpileModule(texts.get(file), { fileName: file,
  compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ESNext } }).outputText
const url = code => `data:text/javascript;base64,${Buffer.from(code).toString('base64')}`
const coreUrl = url(compile('src/board/diagramStructureCore.ts')), themeUrl = url(compile('src/canvasTheme.ts'))
const { createArtEquationCanvasScene: project } = await import(url(compile('src/board/artEquationCanvasAdapter.ts')
  .replace(/from ['"]\.\/velloVectorGeometry['"]/g, `from '${geometryModuleUrl}'`)
  .replace(/from ['"]\.\/diagramStructureCore['"]/g, `from '${coreUrl}'`)
  .replace(/from ['"]\.\.\/canvasTheme['"]/g, `from '${themeUrl}'`)))
const { UniformGridSpatialIndex } = await import(url(compile('src/canvas-engine/spatialIndex.ts')))
const { eligibleVelloObjects } = await import(url(compile('src/board/velloEligibility.ts')))
const checks = []
const check = (name, value) => { assert(value, name); checks.push(name) }
const rect = (x, y, width, height) => ({ version: 1, closed: true,
  points: [{ x, y }, { x: x + width, y }, { x: x + width, y: y + height }, { x, y: y + height }] })
const path = (id, extra = {}) => ({ id, kind: 'shape', shapeType: 'path', title: id,
  x: 0, y: 0, width: 100, height: 100, color: '#ff6600', strokeWidth: 2,
  vectorPath: rect(0, 0, 100, 100), ...extra })
const board = nodes => ({ id: 'disposable-world-bounds', nodes, connectors: [] })
const scene = nodes => project(board(nodes), [], { background: '#111111', grid: '#444444' })
const viewport = { x: -360, y: -360, width: 1000, height: 1000 }
// Reproduce the product broad-phase -> saved semantic record -> visibility ->
// paint-order sequence. Testing only geometry math would miss the mounted hit proxy.
const visibleNodes = (snapshot, nodes, index = new UniformGridSpatialIndex(snapshot.objects)) => {
  const byId = new Map(nodes.map(node => [node.id, node]))
  const visible = new Set(snapshot.objects.filter(object => !object.hidden).map(object => object.id))
  return index.query(viewport).sort((a, b) => a.order - b.order)
    .map(object => byId.get(object.id)).filter(node => node && visible.has(node.id))
}

const movedIntoView = path('translated-visible', { x: -10000, y: -10000,
  vectorTransform: { translateX: 10000, translateY: 10000 } })
const before = JSON.stringify(movedIntoView), movedScene = scene([movedIntoView]), movedObject = movedScene.objects[0]
check('translated world bounds match visible prepared paint', movedObject.bounds.x === 0 && movedObject.bounds.y === 0
  && movedObject.bounds.width === 100 && movedObject.bounds.height === 100)
check('saved editing frame remains unchanged', movedObject.localBounds.x === -10000 && movedObject.localBounds.y === -10000
  && movedObject.localBounds.width === 100 && JSON.stringify(movedIntoView) === before)
check('actual viewport query retains the visible semantic/hit proxy', visibleNodes(movedScene, [movedIntoView])[0] === movedIntoView)
check('old saved-frame index demonstrates the missing hit proxy', new UniformGridSpatialIndex([
  { ...movedObject, bounds: movedObject.localBounds }]).query(viewport).length === 0)
check('canonical prepared bounds retain immutable identity', movedObject.bounds === movedObject.preparedVectorGeometry.bounds
  && Object.isFrozen(movedObject.bounds))
const movedOut = path('translated-offscreen', { vectorTransform: { translateX: 10000, translateY: 10000 } })
check('visible saved frame does not mount distant transformed paint', visibleNodes(scene([movedOut]), [movedOut]).length === 0)

const reflected = path('reflected', { x: 2000, y: 2000, vectorTransform: { scaleX: -2, scaleY: .5,
  translateX: -2000, translateY: -2000 } })
const reflectedObject = scene([reflected]).objects[0]
check('reflected nonuniform bounds follow commands rather than saved frame', reflectedObject.bounds.x === -50
  && reflectedObject.bounds.y === 25 && reflectedObject.bounds.width === 200 && reflectedObject.bounds.height === 50)
check('reflected paint receives its mounted proxy', visibleNodes(scene([reflected]), [reflected])[0] === reflected)
const skew = path('skew', { x: 2000, y: 2000, vectorTransform: { skewX: 45,
  translateX: -2000, translateY: -2000 } })
const skewObject = scene([skew]).objects[0]
check('skewed canonical bounds include outer world extent', Math.abs(skewObject.bounds.x + 50) < 1e-9
  && Math.abs(skewObject.bounds.width - 200) < 1e-9)
const curve = path('outside-controls', { x: 2000, vectorPath: { version: 1, closed: false,
  points: [{ x: 0, y: 0, handleOut: { x: -2200, y: 0 } }, { x: 100, y: 100, handleIn: { x: -2200, y: 0 } }] } })
const curveObject = scene([curve]).objects[0]
check('authored controls beyond the saved frame remain in canonical envelope', curveObject.bounds.x === -200
  && curveObject.bounds.x + curveObject.bounds.width === 2100)
check('outside control envelope is queried by actual index', visibleNodes(scene([curve]), [curve])[0] === curve)
const horizontal = path('thin', { vectorPath: { version: 1, closed: false, points: [{ x: 0, y: 0 }, { x: 100, y: 0 }] } })
check('zero-height world geometry keeps its line proxy through inclusive query', visibleNodes(scene([horizontal]), [horizontal])[0] === horizontal)

const empty = path('empty', { x: 5000, y: 6000, vectorBoolean: { operation: 'intersect',
  operands: [rect(0, 0, 100, 100), rect(200, 0, 100, 100)], resolvedPaths: [] } })
const emptyObject = scene([empty]).objects[0]
check('empty Boolean retains authoritative empty commands and null geometry bounds', emptyObject.preparedVectorGeometry.commands.length === 0
  && emptyObject.preparedVectorGeometry.bounds === null)
check('empty paint gets zero broad-phase extent at its saved origin', emptyObject.bounds.x === 5000 && emptyObject.bounds.y === 6000
  && emptyObject.bounds.width === 0 && emptyObject.bounds.height === 0 && emptyObject.localBounds.width === 100)
check('empty distant Boolean cannot resurrect a proxy at the board origin', visibleNodes(scene([empty]), [empty]).length === 0)

const group = { id: 'owner', kind: 'group', title: 'Group', x: -5000, y: -5000, width: 100, height: 100 }
const child = { ...movedIntoView, id: 'owned-visible', groupId: group.id }
const nested = scene([child, group])
check('transformed child visibility never adds parent translation', nested.objects.find(object => object.id === child.id).bounds.x === 0
  && visibleNodes(nested, [child, group])[0] === child)
check('hidden ownership still suppresses queried semantic nodes', visibleNodes(scene([child, { ...group, hidden: true }]), [child, group]).length === 0)
const second = path('second', { x: 10, y: 10, zIndex: 0 }), first = { ...movedIntoView, zIndex: -1 }
check('query results retain canonical paint order during virtualization', visibleNodes(scene([second, first]), [second, first]).map(node => node.id).join() === `${first.id},second`)
const previous = new UniformGridSpatialIndex(movedScene.objects), nextScene = scene([{ ...movedIntoView,
  vectorTransform: { translateX: 0, translateY: 0 } }]), next = previous.fork(nextScene.objects)
check('committed world geometry changes move index cells', next.query(viewport).length === 0 && previous.query(viewport)[0] === movedObject)
check('abandoned next index cannot mutate the accepted snapshot', previous.get(movedObject.id) === movedObject
  && next.get(movedObject.id) === nextScene.objects[0])

const candidate = path('candidate', { x: 110, y: 100, width: 10, height: 10, vectorPath: rect(0, 0, 10, 10) })
const card = { id: 'card', kind: 'text', title: 'Card', x: 200, y: 100, width: 40, height: 40 }
for (const scale of [.2, 1, 4]) {
  check(`DOM shadow uses board-unit envelope at zoom ${scale}`, eligibleVelloObjects(scene([candidate, card]), [], scale).length === 0)
  check(`distant card preserves independent GPU paint at zoom ${scale}`, eligibleVelloObjects(scene([
    { ...candidate, x: -200 }, card]), [], scale).some(object => object.id === candidate.id))
}
const unsupportedRectangle = { ...card, id: 'rectangle', kind: 'shape', shapeType: 'rectangle' }
check('unsupported rectangle DOM shadow is guarded too', eligibleVelloObjects(scene([candidate, unsupportedRectangle]), [], 4).length === 0)
const legacyScene = scene([path('legacy-selected'), path('legacy-independent', { x: 200 })])
const legacyObjects = legacyScene.objects.map(object => ({ ...object, preparedVectorGeometry: undefined }))
check('legacy transparent SVG paths avoid a fictitious card shadow', eligibleVelloObjects({ ...legacyScene, objects: legacyObjects }, ['legacy-selected'])
  .map(object => object.id).join() === 'legacy-independent')
check('legacy caption/basic vector skins retain the conservative card envelope', eligibleVelloObjects({ ...legacyScene, objects: [
  { ...legacyObjects[0], hasDiagramCaption: true }, legacyObjects[1]] }, ['legacy-selected']).length === 0)
const explicitFrame = { ...group, id: 'explicit-frame', containerRole: 'frame', title: 'Empty' }
const legacyFrame = { ...group, id: 'legacy-frame', title: 'My Frame 4' }
check('explicit frame role matches App regardless of title', scene([explicitFrame]).objects[0].role === 'frame')
check('legacy whole-word Frame title matches actual App skin', scene([legacyFrame]).objects[0].role === 'frame')
check('framework title remains a regular group', scene([{ ...group, title: 'Framework' }]).objects[0].role === 'group')
for (const frame of [explicitFrame, legacyFrame]) {
  check(`unknown max-content header keeps mixed batch closed: ${frame.id}`, eligibleVelloObjects(scene([candidate, frame]), []).length === 0)
  check(`hidden header does not prevent GPU paint: ${frame.id}`, eligibleVelloObjects(scene([candidate, { ...frame, hidden: true }]), []).some(object => object.id === candidate.id))
}
const validScene = scene([candidate, card])
check('invalid overflowed DOM envelope fails closed', eligibleVelloObjects({ ...validScene, objects: [validScene.objects[0],
  { ...validScene.objects[1], bounds: { x: 1e308, y: 100, width: 1e308, height: 10 } }] }, []).length === 0)

const captioned = { ...movedIntoView, id: 'captioned-visible', diagramShape: 'process', body: 'Caption' }
const captionBefore = JSON.stringify(captioned), captionScene = scene([captioned]), captionObject = captionScene.objects[0]
check('captioned transformed path retains exact ready semantic geometry', captionObject.hasDiagramCaption
  && captionObject.preparedVectorGeometry.status === 'ready' && captionObject.preparedVectorGeometry.bounds.x === 0)
check('caption broad-phase union retains both saved caption viewport and transformed path', captionObject.bounds.x === -10000
  && captionObject.bounds.y === -10000 && captionObject.bounds.width === 10100 && captionObject.bounds.height === 10100)
check('caption path query survives distant saved frame and oversized index envelope', visibleNodes(captionScene, [captioned])[0] === captioned)
check('caption local frame and all authored metadata remain unchanged', captionObject.localBounds.x === -10000
  && captionObject.vectorTransform === captioned.vectorTransform && JSON.stringify(captioned) === captionBefore)
check('ready caption semantic geometry never transfers text paint to Vello', eligibleVelloObjects(captionScene, [], 1, true).length === 0)
const skewCaption = { ...skew, id: 'skew-caption', diagramShape: 'decision', rotation: 37 }
const skewCaptionObject = scene([skewCaption]).objects[0]
const contains = (outer, inner) => outer.x <= inner.x && outer.y <= inner.y
  && outer.x + outer.width >= inner.x + inner.width && outer.y + outer.height >= inner.y + inner.height
const frameOnly = scene([{ ...skewCaption, kind: 'text', diagramShape: undefined, vectorPath: undefined,
  vectorTransform: undefined }]).objects[0].bounds
check('rotated skew caption union encloses the actual path control envelope', contains(skewCaptionObject.bounds, skewCaptionObject.preparedVectorGeometry.bounds))
check('rotated caption viewport remains inside the semantic envelope', contains(skewCaptionObject.bounds, frameOnly))
const tinyRotationCaption = path('large-caption-tiny-rotation', { width: 1e6, height: 1e6,
  diagramShape: 'process', rotation: .001 })
const tinyRotationBounds = scene([tinyRotationCaption]).objects[0].bounds
check('tiny rotations do not discard substantial large-caption viewport extent', tinyRotationBounds.x < -8
  && tinyRotationBounds.x + tinyRotationBounds.width > 1e6 + 8)
const bulgedCaption = { ...curve, id: 'bulged-caption', diagramShape: 'process', vectorPath: { ...curve.vectorPath,
  closed: true, points: [...curve.vectorPath.points, { x: 100, y: 0 }] } }
check('caption metadata cannot discard outside cubic controls', scene([bulgedCaption]).objects[0].preparedVectorGeometry.bounds.x === -200
  && visibleNodes(scene([bulgedCaption]), [bulgedCaption])[0] === bulgedCaption)
const emptyCaption = { ...empty, id: 'empty-caption', diagramShape: 'process', body: 'Still captioned' }
const emptyCaptionObject = scene([emptyCaption]).objects[0]
check('empty Boolean caption keeps empty exact geometry without a primary-path proxy', emptyCaptionObject.preparedVectorGeometry.commands.length === 0
  && emptyCaptionObject.preparedVectorGeometry.bounds === null)
check('empty Boolean caption still indexes its saved DOM viewport', emptyCaptionObject.bounds.x === 5000
  && emptyCaptionObject.bounds.y === 6000 && emptyCaptionObject.bounds.width === 100 && emptyCaptionObject.bounds.height === 100)
const indexAtCaption = new UniformGridSpatialIndex([emptyCaptionObject]).query({ x: 5040, y: 6040, width: 1, height: 1 })
check('empty path does not cause caption viewport virtualization loss', indexAtCaption[0] === emptyCaptionObject)
const splitCaption = path('split-caption', { x: 1000, y: 1000, diagramShape: 'process', body: 'Caption',
  vectorTransform: { translateX: -1000, translateY: -1000 } })
const nearCurve = path('near-caption-curve', { x: 110, y: 10, width: 10, height: 10, vectorPath: rect(0, 0, 10, 10) })
const nearFrame = { ...nearCurve, id: 'near-caption-frame', x: 1110, y: 1010 }
const independent = { ...nearCurve, id: 'caption-independent', x: 1500, y: 1500 }
for (const scale of [.2, 1, 4]) {
  const eligible = eligibleVelloObjects(scene([splitCaption, nearCurve, nearFrame, independent]), [], scale, true).map(object => object.id)
  check(`caption DOM blocker includes its exact path and caption viewport at zoom ${scale}`, !eligible.includes(nearCurve.id)
    && !eligible.includes(nearFrame.id) && !eligible.includes(splitCaption.id))
  check(`bounded caption blocker preserves independent Vello paint at zoom ${scale}`, eligible.includes(independent.id))
}
check('uncompiled caption blocker fails closed instead of guessing transformed text bounds', eligibleVelloObjects({ ...captionScene,
  objects: [{ ...captionObject, preparedVectorGeometry: undefined }, scene([independent]).objects[0]] }, []).length === 0)
const captionGroup = { ...group, id: 'caption-owner', hidden: true }
const hiddenCaption = { ...captioned, groupId: captionGroup.id }
check('caption derivative still respects inherited hidden ownership', visibleNodes(scene([hiddenCaption, captionGroup]), [hiddenCaption, captionGroup]).length === 0)
const css = await readFile('src/App.css', 'utf8'), captionRule = css.match(/\.diagram-caption-svg\s*\{([^}]*)\}/)
check('current caption viewport CSS preserves SVG UA overflow clipping', captionRule && !/overflow\s*:\s*visible/.test(captionRule[1]))
sourceHashes['src/App.css'] = createHash('sha256').update(css).digest('hex')
console.log(JSON.stringify({ passed: true, checks: checks.length, sourceHashes, limitations: [
  'Model projection, actual spatial-index virtualization and conservative mixed-layer eligibility only; no renderer/native pixels.',
  'Frames intentionally keep the mixed batch closed until canonical measured header layout exists.',
  'DOM shadow guard is conservative for the current active CSS skin; dynamic effects and full scene compositing remain separate P0 work.',
  'Caption text remains DOM-owned; broad-phase union uses the current clipped SVG caption viewport, not guessed glyph measurements.',
] }, null, 2))
