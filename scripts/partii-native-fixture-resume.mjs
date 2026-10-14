import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import { createHash } from 'node:crypto'
import ts from 'typescript'

// Prepares an explicitly separate workspace for the named native candidate.
// No project import, command bridge, user media, or production workspace access.
const destination = resolve(process.argv[2] || 'builds/previews/partii-safety-2026-09-30/native-workspace')
await mkdir(destination, { recursive: false }) // Refuse to replace any workspace.
const code = ts.transpileModule(await readFile('src/model/project.ts', 'utf8'), { compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 } }).outputText
const { createBlankProject, DEFAULT_DOCUMENT_LAYOUT } = await import(`data:text/javascript;base64,${Buffer.from(code).toString('base64')}`)
const project = createBlankProject('Part II native disposable acceptance')
project.id = 'partii-native-safety-resume'
const root = `projects/${project.id}`
await mkdir(resolve(destination, root, 'assets/originals'), { recursive: true })
const sourceHashes = {}, colors = ['#40c477', '#e2a549', '#8fa7d7', '#f18fa8', '#65bccc']
project.assets = []
for (let i = 0; i < 5; i++) {
  const width = [120, 200, 180, 100, 210][i], height = [180, 120, 180, 210, 100][i]
  const relativePath = `${root}/assets/originals/reference-${i}.svg`
  const image = `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}"><rect width="${width}" height="${height}" fill="${colors[i]}"/><circle cx="${width / 2}" cy="${height / 2}" r="${Math.min(width, height) / 3}" fill="#172c3d"/><text x="10" y="24" fill="white" font-size="18">Fixture ${i + 1}</text></svg>`
  await writeFile(resolve(destination, relativePath), image)
  sourceHashes[relativePath] = createHash('sha256').update(image).digest('hex')
  project.assets.push({ id: `reference-${i}`, kind: 'image', extension: 'svg', originalName: `reference-${i}.svg`, displayName: `Fixture ${i + 1}`, relativePath, byteLength: Buffer.byteLength(image), width, height, status: 'available', importedAt: new Date().toISOString() })
}
const node = (id, kind, x, y, width, height, extra = {}) => ({ id, kind, title: id, x, y, width, height, color: '#56748e', strokeColor: '#c9d8e2', strokeWidth: 2, opacity: 1, ...extra })
const edge = (id, sourceId, targetId, extra = {}) => ({ id, sourceId, targetId, sourcePort: 'right', targetPort: 'left', style: 'elbow', color: '#e7a353', width: 2, startArrow: false, endArrow: true, dashed: false, animated: false, ...extra })
const board = (id, title, nodes, connectors = [], extra = {}) => ({ id, title, nodes, connectors, viewport: { x: 18, y: 18, scale: .7 }, linkedFolderPath: `${root}/boards/${id}`, gridVisible: true, backgroundFollowsTheme: true, ...extra })
project.boards = [
  board('native-root', 'F0 and F2 · recovery and drawing', [
    node('House frame', 'group', 110, 110, 520, 440, { containerRole: 'frame', color: '#72867a' }),
    node('Wall', 'shape', 210, 280, 230, 200, { groupId: 'House frame', shapeType: 'rectangle', color: '#cc9360' }),
    node('Roof', 'shape', 180, 155, 290, 155, { groupId: 'House frame', shapeType: 'path', color: '#b34642', vectorPath: { version: 1, closed: true, points: [{ x: 0, y: 155 }, { x: 145, y: 0 }, { x: 290, y: 155 }] } }),
    node('Closing curve', 'shape', 690, 140, 260, 210, { shapeType: 'path', color: '#51bbaa', locked: true, strokeWidth: 0, vectorFillRule: 'evenodd', vectorPath: { version: 1, closed: true, points: [{ x: 0, y: 0, handleIn: { x: -35, y: 70 } }, { x: 210, y: 0 }, { x: 210, y: 170, handleOut: { x: -15, y: 75 } }] } }),
    node('Editable curve', 'shape', 690, 390, 240, 130, { shapeType: 'path', color: '#edb861', vectorStrokeJoin: 'round', vectorStrokeCap: 'round', vectorPath: { version: 1, closed: false, points: [{ x: 0, y: 70, handleOut: { x: 60, y: -100 } }, { x: 240, y: 70, handleIn: { x: -60, y: 100 } }] } }),
    node('References', 'column', 1040, 120, 260, 510),
    node('Portrait source', 'image', 1050, 188, 240, 320, { parentColumnId: 'References', columnOrder: 0, freeWidth: 120, freeHeight: 160, assetId: 'reference-0', imagePresentation: 'artwork' }),
    node('Child portal', 'board-link', 160, 600, 150, 150, { targetBoardId: 'native-child', boardLinkRole: 'child', boardPortal: true }),
  ], [edge('house-link', 'Wall', 'References', { label: 'reference', bendPoints: [{ x: 560, y: 350 }, { x: 980, y: 350 }] })]),
  board('native-child', 'F0 · owned child', [node('Child note', 'note', 150, 150, 300, 180, { body: '<p>Disposable child content retained across restart.</p>' }), node('Grandchild portal', 'board-link', 520, 150, 150, 150, { targetBoardId: 'native-grandchild', boardLinkRole: 'child', boardPortal: true })], [], { parentBoardId: 'native-root' }),
  board('native-grandchild', 'F0 · owned grandchild', [node('Grandchild source', 'image', 150, 150, 300, 200, { assetId: 'reference-1' })], [], { parentBoardId: 'native-child' }),
  board('native-collage', 'F3 · 50 mixed-aspect images', Array.from({ length: 50 }, (_, i) => node(`Collage ${i + 1}`, 'image', 80 + (i % 25) * 136, 90 + Math.floor(i / 25) * 245, 120, 210, { assetId: `reference-${i % 5}`, imagePresentation: 'artwork', imageTransform: { fit: 'contain', positionX: 50, positionY: 50, zoom: 1 } })), [], { viewport: { x: 16, y: 16, scale: .32 } }),
  board('native-map', 'F4 · 24 images and 30 relationships', Array.from({ length: 24 }, (_, i) => node(`Map image ${i + 1}`, 'image', 80 + (i % 6) * 220, 90 + Math.floor(i / 6) * 220, 160, 160, { assetId: `reference-${i % 5}` })), Array.from({ length: 30 }, (_, i) => edge(`Relationship ${i + 1}`, `Map image ${i % 24 + 1}`, `Map image ${(i * 7 + 3) % 24 + 1}`, { style: i % 4 === 0 ? 'curve' : 'elbow', label: `Relationship ${i + 1}`, color: colors[i % 4], dashed: i % 4 === 1, startArrow: i % 4 === 2, ...(i % 4 === 3 ? { bendPoints: [{ x: 540, y: 80 + i * 10 }], labelPosition: { t: .55, offsetX: 6, offsetY: -14 } } : {}) }))),
]
const primaryContour = { version: 1, closed: true, points: [{ x: 0, y: 0 }, { x: 180, y: 0 }, { x: 180, y: 140 }, { x: 0, y: 140 }] }
const reversedCutter = { version: 1, closed: true, points: [{ x: 90, y: 40 }, { x: 90, y: 180 }, { x: 260, y: 180 }, { x: 260, y: 40 }] }
project.boards.push(board('native-booleans', 'F2 · native Boolean boundaries', ['union', 'subtract', 'intersect', 'exclude'].map((operation, i) => node(`Native ${operation}`, 'shape', 80 + (i % 2) * 400, 100 + Math.floor(i / 2) * 280, 260, 180, {
  shapeType: 'path', color: ['#cf714c', '#55b6a8', '#af99d3', '#e0b35e'][i], strokeColor: '#121519', strokeWidth: 4,
  vectorPath: primaryContour, vectorBoolean: { operation, operands: [primaryContour, reversedCutter] },
})), [], { viewport: { x: 20, y: 20, scale: 1 }, gridVisible: false }))
project.documents = [{ id: 'native-document', title: 'F1 · rich native document', layout: DEFAULT_DOCUMENT_LAYOUT, content: { type: 'doc', content: [{ type: 'heading', attrs: { level: 1 }, content: [{ type: 'text', text: 'Native Part II acceptance' }] }, ...Array.from({ length: 14 }, (_, i) => ({ type: 'paragraph', content: [{ type: 'text', text: `Acceptance section ${i + 1}. This disposable document exercises Split layout and formatting without loading a production project.` }] }))] } }]
for (const entry of project.boards) await mkdir(resolve(destination, entry.linkedFolderPath), { recursive: true })
await writeFile(resolve(destination, root, 'project.json'), JSON.stringify(project, null, 2))
await writeFile(resolve(destination, 'settings.json'), JSON.stringify({ schemaVersion: 5, theme: 'dark', viewMode: 'canvas', splitRatio: 50, activeProjectId: project.id, canvasEnginePreference: 'generation-1', projectNavigation: { [project.id]: { activeBoardId: 'native-root', activeDocumentId: 'native-document', activeNavigatorItem: 'board:native-root', viewMode: 'canvas' } } }, null, 2))
await writeFile(resolve(destination, 'fixture-baseline.json'), JSON.stringify({ generatedAt: new Date().toISOString(), root: destination, project, sourceHashes, limitation: 'Prepared fixtures are setup only; native UI, persistence, pixels and performance require separate observed acceptance.' }, null, 2))
console.log(JSON.stringify({ workspace: destination, projectId: project.id, boards: project.boards.length, imageSources: project.assets.length, collageObjects: 50, mapObjects: 24, mapRelationships: 30 }))
