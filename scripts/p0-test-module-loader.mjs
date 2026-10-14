import { readFile } from 'node:fs/promises'
import { createHash } from 'node:crypto'
import { createRequire } from 'node:module'
import { pathToFileURL } from 'node:url'
import ts from 'typescript'

// Model tests use actual TypeScript modules without launching a browser.
// Keep the adapter's new geometry dependency and real Boolean resolver intact.
const sourceFiles = ['model/vector.ts', 'model/vectorBooleanGeometry.ts', 'board/velloVectorGeometry.ts']
const texts = await Promise.all(sourceFiles.map(file => readFile(new URL(`../src/${file}`, import.meta.url), 'utf8')))
export const p0GeometrySourceHashes = Object.fromEntries(sourceFiles.map((file, index) =>
  [`src/${file}`, createHash('sha256').update(texts[index]).digest('hex')]))
const url = code => `data:text/javascript;base64,${Buffer.from(code).toString('base64')}`
const compile = index => ts.transpileModule(texts[index], { fileName: sourceFiles[index],
  compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ESNext } }).outputText
const require = createRequire(new URL('../package.json', import.meta.url))
const paintText = await readFile(new URL('../src/board/vectorPaint.ts', import.meta.url), 'utf8')
const paintUrl = url(ts.transpileModule(paintText, { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ESNext } }).outputText)
p0GeometrySourceHashes['src/board/vectorPaint.ts'] = createHash('sha256').update(paintText).digest('hex')
const vectorUrl = url(compile(0).replace(/from ['"]\.\.\/board\/vectorPaint(?:\.ts)?['"]/g, `from '${paintUrl}'`))
const booleanUrl = url(compile(1).replace(/from ['"]paper['"]/g, `from '${pathToFileURL(require.resolve('paper')).href}'`))
export const vectorModuleUrl = vectorUrl
export const booleanModuleUrl = booleanUrl
const svgText = await readFile(new URL('../src/board/vectorSvg.ts', import.meta.url), 'utf8')
p0GeometrySourceHashes['src/board/vectorSvg.ts'] = createHash('sha256').update(svgText).digest('hex')
export const vectorSvgModuleUrl = url(ts.transpileModule(svgText, { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ESNext } }).outputText
  .replace(/from ['"]\.\/vectorPaint['"]/g, `from '${paintUrl}'`)
  .replace(/from ['"]\.\.\/model\/vector['"]/g, `from '${vectorUrl}'`)
  .replace(/from ['"]\.\.\/model\/vectorBooleanGeometry['"]/g, `from '${booleanUrl}'`))
export const geometryModuleUrl = url(compile(2)
  .replace(/from ['"]\.\/vectorPaint['"]/g, `from '${paintUrl}'`)
  .replace(/from ['"]\.\.\/model\/vector['"]/g, `from '${vectorUrl}'`)
  .replace(/from ['"]\.\.\/model\/vectorBooleanGeometry['"]/g, `from '${booleanUrl}'`))
export function bindP0Geometry(code) {
  return code.replace(/from ['"]\.\/velloVectorGeometry['"]/g, `from '${geometryModuleUrl}'`)
    .replace(/from ['"]\.\.\/model\/rectangleErasure['"]/g, `from '${new URL('../src/model/rectangleErasure.ts', import.meta.url).href}'`)
    .replace(/from ['"]\.\/rectangleErasurePaint['"]/g, `from '${new URL('../src/board/rectangleErasurePaint.ts', import.meta.url).href}'`)
}
