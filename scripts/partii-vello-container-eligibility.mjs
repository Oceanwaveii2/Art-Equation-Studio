import { geometryModuleUrl } from './p0-test-module-loader.mjs'
import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { readFile, mkdir, writeFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import ts from 'typescript'

// In-memory actual projection/eligibility. No project/native app or GPU runs.
const files = ['src/board/velloEligibility.ts', 'src/board/artEquationCanvasAdapter.ts', 'src/board/diagramStructureCore.ts', 'src/canvasTheme.ts']
const texts = await Promise.all(files.map(file => readFile(file, 'utf8')))
const hashes = Object.fromEntries(files.map((file, i) => [file, createHash('sha256').update(texts[i]).digest('hex')]))
const code = file => ts.transpileModule(texts[files.indexOf(file)], { fileName: file, compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ESNext } }).outputText
const url = source => `data:text/javascript;base64,${Buffer.from(source).toString('base64')}`
const coreUrl = url(code('src/board/diagramStructureCore.ts')), themeUrl = url(code('src/canvasTheme.ts'))
const { createArtEquationCanvasScene } = await import(url(code('src/board/artEquationCanvasAdapter.ts').replace("from './velloVectorGeometry'", `from '${geometryModuleUrl}'`).replace("from './diagramStructureCore'", `from '${coreUrl}'`).replace("from '../canvasTheme'", `from '${themeUrl}'`)))
const { eligibleVelloObjects } = await import(url(code('src/board/velloEligibility.ts')))
const timestamp = new Date().toISOString(), output = resolve('output/partii-vello-container-eligibility', timestamp.replace(/[:.]/g, '-'))
await mkdir(output, { recursive: true })
const report = { generatedAt: timestamp, passed: false, sourceHashes: hashes, checks: [], limitations: ['Production projection and runtime eligibility only; container/native opacity pixels, painting order and final EXE remain root acceptance.'] }
const check = (name, passed, detail) => { report.checks.push({ name, passed: Boolean(passed), ...(detail === undefined ? {} : { detail }) }); assert(passed, `${name}: ${JSON.stringify(detail)}`) }
const shape = (id, extra = {}) => ({ id, kind: 'shape', shapeType: 'path', x: 100, y: 100, width: 60, height: 60, title: id, vectorPath: { version: 1, closed: true, points: [{ x: 0, y: 0 }, { x: 60, y: 0 }, { x: 60, y: 60 }] }, ...extra })
const container = (id, extra = {}) => ({ id, kind: 'group', x: 80, y: 80, width: 200, height: 200, title: id, ...extra })
const project = nodes => createArtEquationCanvasScene({ id: 'disposable-ownership', nodes, connectors: [] }, [], { background: '#111111', grid: '#444444' })

try {
  const rootScene = project([shape('root', { locked: true })]), root = rootScene.objects[0]
  check('locked unowned root remains eligible', eligibleVelloObjects(rootScene, []).map(node => node.id).join() === 'root')
  check('selected root remains DOM-owned', eligibleVelloObjects(rootScene, ['root']).length === 0)
  check('unlocked root shares the engine paint backend', eligibleVelloObjects(project([shape('unlocked')]), []).map(node => node.id).join() === 'unlocked')
  for (const kind of ['group', 'column']) for (const inherited of [false, true]) {
    const nodes = [container('owner', { kind, locked: inherited, color: '#ffffff', opacity: 1 }), shape('child', { locked: !inherited, ...(kind === 'group' ? { groupId: 'owner' } : { parentColumnId: 'owner' }) })]
    const before = JSON.stringify(nodes), scene = project(nodes), child = scene.objects.find(node => node.id === 'child')
    check(`${kind}/${inherited ? 'inherited' : 'own'}: lock is projected`, child.locked === true)
    check(`${kind}/${inherited ? 'inherited' : 'own'}: direct ownership is projected`, child.parentId === 'owner')
    check(`${kind}/${inherited ? 'inherited' : 'own'}: owned path stays DOM-owned`, eligibleVelloObjects(scene, []).every(node => node.id !== 'child'))
    check(`${kind}/${inherited ? 'inherited' : 'own'}: original records unchanged`, JSON.stringify(nodes) === before)
  }
  const nested = [container('outer', { locked: true }), container('inner', { groupId: 'outer' }), container('column', { kind: 'column', groupId: 'inner' }), shape('leaf', { parentColumnId: 'column' })]
  const nestedBefore = JSON.stringify(nested), nestedScene = project(nested)
  check('three-level inherited-lock path is locked without stored child flag', nestedScene.objects.find(node => node.id === 'leaf').locked && !nested.find(node => node.id === 'leaf').locked)
  check('three-level owned path remains DOM-owned', eligibleVelloObjects(nestedScene, []).length === 0)
  check('nested ownership source remains unchanged', nestedBefore === JSON.stringify(nested))
  // Sparse render snapshots may not carry the owner itself. The path still
  // cannot be moved into a background layer without its compositing contract.
  for (const parentId of ['owner-not-in-snapshot', '', null]) check(`parent metadata ${JSON.stringify(parentId)} refuses standalone GPU paint`, eligibleVelloObjects({ ...rootScene, objects: [{ ...root, parentId }] }, []).length === 0)
  const variants = [
    { name: 'hidden', object: { ...root, hidden: true } },
    { name: 'rotated', object: { ...root, appearance: { ...root.appearance, rotation: 30 } } },
    { name: 'Boolean', object: { ...root, vectorBoolean: { operation: 'subtract', operands: [root.vectorPath, root.vectorPath] } } },
    { name: 'inner transform', object: { ...root, vectorTransform: { skewX: 15 } } },
  ]
  for (const variant of variants) check(`${variant.name} without compiled geometry remains guarded`, eligibleVelloObjects({ ...rootScene, objects: [{ ...variant.object, preparedVectorGeometry: undefined }] }, []).length === 0)
  const blocker = { ...root, id: 'card', kind: 'text', locked: false }
  check('overlapping visible DOM blocker refuses root GPU paint', eligibleVelloObjects({ ...rootScene, objects: [root, blocker] }, []).length === 0)
  check('hidden blocker does not suppress unowned root', eligibleVelloObjects({ ...rootScene, objects: [root, { ...blocker, hidden: true }] }, []).some(node => node.id === 'root'))
  const after = Object.fromEntries(await Promise.all(files.map(async file => [file, createHash('sha256').update(await readFile(file)).digest('hex')])))
  check('source fingerprints stable', JSON.stringify(after) === JSON.stringify(hashes))
  report.passed = true
  console.log(JSON.stringify({ passed: true, checks: report.checks.length, report: resolve(output, 'report.json') }, null, 2))
} catch (error) {
  report.failure = String(error); console.error(report.failure); process.exitCode = 1
} finally {
  await writeFile(resolve(output, 'report.json'), JSON.stringify(report, null, 2) + '\n')
}
