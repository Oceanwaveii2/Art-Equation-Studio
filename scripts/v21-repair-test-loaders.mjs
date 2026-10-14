import fs from 'node:fs/promises'
import ts from 'typescript'
for(const file of ['p0-vector-geometry-tests.mjs','p0-live-scene-tests.mjs','p0-connector-gesture-tests.mjs','p0-line-gesture-tests.mjs']){
 let text=await fs.readFile('scripts/'+file,'utf8')
 const ast=ts.createSourceFile(file,text,ts.ScriptTarget.Latest,true,ts.ScriptKind.JS),edits=[]
 const replacement={vectorUrl:'sharedVectorUrl',geometryUrl:'sharedGeometryUrl',booleanUrl:'sharedBooleanUrl'}
 function visit(node){if(ts.isVariableDeclaration(node)&&node.initializer&&replacement[node.name.getText(ast)])edits.push({start:node.initializer.getStart(ast),end:node.initializer.getEnd(),value:replacement[node.name.getText(ast)]});ts.forEachChild(node,visit)}
 visit(ast)
 for(const e of edits.sort((a,b)=>b.start-a.start))text=text.slice(0,e.start)+e.value+text.slice(e.end)
 text="import { vectorModuleUrl as sharedVectorUrl, geometryModuleUrl as sharedGeometryUrl, booleanModuleUrl as sharedBooleanUrl } from './p0-test-module-loader.mjs'\n"+text
 await fs.writeFile('scripts/'+file,text)
}
console.log('Restored current model dependency loading; assertions unchanged')

