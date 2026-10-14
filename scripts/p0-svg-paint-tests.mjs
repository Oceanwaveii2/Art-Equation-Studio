import assert from 'node:assert/strict'
import {readFile,writeFile} from 'node:fs/promises'
import {createHash} from 'node:crypto'
import {createRequire} from 'node:module'
import {pathToFileURL} from 'node:url'
import ts from 'typescript'
const require=createRequire(new URL('../package.json',import.meta.url)),bound=new Map()
async function load(file){if(bound.has(file.href))return bound.get(file.href);let code=ts.transpileModule(await readFile(file,'utf8'),{compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.ESNext}}).outputText;for(const match of [...code.matchAll(/from ['"](\.[^'"]+)['"]/g)]){const target=new URL(match[1].endsWith('.ts')?match[1]:match[1]+'.ts',file);code=code.replace(match[0],`from '${await load(target)}'`)}code=code.replace(/from ['"]paper['"]/g,`from '${pathToFileURL(require.resolve('paper')).href}'`);const result='data:text/javascript;base64,'+Buffer.from(code).toString('base64');bound.set(file.href,result);return result}
const {svgPathCommands}=await import(await load(new URL('../src/project-b/p0-surface/svgPaint.ts',import.meta.url))),checks=[],check=(name,body)=>{body();checks.push(name)},near=(a,b,tolerance=1e-6)=>assert(Math.abs(a-b)<tolerance,`${a} differs from ${b}`)
check('actual SVG parser preserves absolute/implicit/relative moveto and axis line semantics',()=>{
  assert.deepEqual(svgPathCommands('M10 20 30 40 h5 v-10 l-2 4'),[['M',10,20],['L',30,40],['L',35,40],['L',35,30],['L',33,34]])
  assert.deepEqual(svgPathCommands('m10 20 30 40 H5 V8'),[['M',10,20],['L',40,60],['L',5,60],['L',5,8]])
})
check('actual cubic smooth reflection resets after non-cubic segments and handles relative controls',()=>{
  assert.deepEqual(svgPathCommands('M0 0 C10 0 20 10 30 10 s20 10 30 0 L70 20 S80 30 90 20'),[['M',0,0],['C',10,0,20,10,30,10],['C',40,10,50,20,60,10],['L',70,20],['C',70,20,80,30,90,20]])
})
check('actual quadratic and smooth quadratic conversion matches exact Bezier control identities',()=>{
  const result=svgPathCommands('M0 0 Q30 30 60 0 T120 0');assert.deepEqual(result,[['M',0,0],['C',20,20,40,20,60,0],['C',80,-20,100,-20,120,0]])
  assert.deepEqual(svgPathCommands('M0 0 l10 10 t30 30'),[['M',0,0],['L',10,10],['C',10,10,20,20,40,40]])
})
check('close resets relative origin without inventing closure points or erasing subpaths',()=>{
  assert.deepEqual(svgPathCommands('M10 20 L30 40 z m5 7 l3 2'),[['M',10,20],['L',30,40],['Z'],['M',15,27],['L',18,29]])
})
check('scientific notation and compact sign/decimal tokens preserve actual canonical coordinates',()=>{
  assert.deepEqual(svgPathCommands('M1e2-2e1L.5.75'),[['M',100,-20],['L',.5,.75]])
})
check('unsupported arcs/malformed/nonfinite/resource-heavy paths refuse before incomplete ownership',()=>{
  for(const source of['M0 0 A5 5 0 0 0 10 10','L0 0','M0','M0 0 C2 3','M0 0 LInfinity 2','M0 0 ? 2','M1e9 0'])assert.throws(()=>svgPathCommands(source),/SVG_PAINT_UNSUPPORTED/)
  assert.throws(()=>svgPathCommands(' '.repeat(1_000_001)),/path source limit/)
})
const mounted=JSON.parse(await readFile(new URL('../../docs/engine-p0/2026-10-03/artwork-coverage/MOUNTED_SVG_MATRICES.json',import.meta.url),'utf8'))
check('actual mounted ellipse root CTM contains viewBox anisotropy and article rotation once',()=>{
  const record=mounted.records.find(value=>value.class==='node-shape-ellipse'),[a,b,c,d]=record.userSpaceTransform,angle=17*Math.PI/180
  near(a,2.2*Math.cos(angle));near(b,2.2*Math.sin(angle));near(c,-1.3*Math.sin(angle));near(d,1.3*Math.cos(angle));assert.equal(record.rootOpacityOwned,true)
  assert.equal(record.texts[0].weight,'600');assert.equal(record.texts[0].anchor,'middle');assert.equal(record.texts[0].baseline,'middle');near(record.texts[0].first.x+record.texts[0].advance/2,50,1e-5)
})
check('actual mounted reverse-arrow CTM reflects y only once and preserves article rotation',()=>{
  const record=mounted.records.find(value=>value.class.startsWith('node-vector-shape reverse')),[a,b,c,d]=record.userSpaceTransform,angle=-11*Math.PI/180
  near(a,2*Math.cos(angle));near(b,2*Math.sin(angle));near(c,1.05*Math.sin(angle));near(d,-1.05*Math.cos(angle));assert(a*d-b*c<0)
})
check('actual mounted diagram captions keep independent nested transforms and measured multiline anchors',()=>{
  const record=mounted.records.find(value=>value.class==='diagram-caption-svg'),texts=record.texts;assert.equal(texts.length,2);assert(texts[0].ctm.a!==record.userSpaceTransform[0]);assert.deepEqual(texts[0].ctm,texts[1].ctm)
  for(const text of texts){near(text.first.x+text.advance/2,100,1e-5);assert.equal(text.anchor,'middle');assert.equal(text.baseline,'middle');assert.equal(text.weight,'400')}
  near(texts[1].first.y-texts[0].first.y,16.8,1e-5)
})
check('missing diagnostic SVG paint refuses entire card and returns no partial operations',()=>{
  for(const result of mounted.results){assert.equal(result.complete,false);assert.equal(result.operations,0);assert(result.blockers.includes('SVG_DIAGNOSTIC_NOT_PAINT_OWNERSHIP'))}
})
const sourceFiles=['src/project-b/p0-surface/svgPaint.ts','src/project-b/p0-surface/cardProviders.ts','src/board/completeMeasuredCardPaint.ts','src/board/measuredCardPaint.ts','src/App.tsx'],sourceHashes=Object.fromEntries(await Promise.all(sourceFiles.map(async file=>[file,createHash('sha256').update(await readFile(new URL('../'+file,import.meta.url))).digest('hex')])))
const receipt={schema:'art-equation.p0-svg-artwork-tests',timestamp:new Date().toISOString(),checks,checkCount:checks.length,sourceHashes,limits:['Parser and real DOM CTM/anchor qualification; complete glyph/marker/effects backend pixel gates are separate','Mounted diagnostics explicitly refuse paint ownership','No native app launch or production data mutation']}
await writeFile(new URL('../../docs/engine-p0/2026-10-03/artwork-coverage/SVG_ARTWORK_ACCEPTANCE.json',import.meta.url),JSON.stringify(receipt,null,2)+'\n');console.log(JSON.stringify(receipt,null,2))
