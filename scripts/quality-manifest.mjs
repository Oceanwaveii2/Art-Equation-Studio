import fs from 'node:fs/promises'
import path from 'node:path'
import {sha256} from './quality-evidence.mjs'
const args=process.argv.slice(2),arg=name=>args[args.indexOf(name)+1]
const records=[]
async function collect(root,prefix){
 for(const item of (await fs.readdir(root,{withFileTypes:true})).sort((a,b)=>a.name.localeCompare(b.name))){
  const file=path.join(root,item.name),name=prefix+'/'+item.name
  if(item.isDirectory())await collect(file,name)
  else if(item.isFile()){const bytes=await fs.readFile(file);records.push({path:name.replaceAll('\\','/'),absolutePath:path.resolve(file),bytes:bytes.length,sha256:sha256(bytes)})}
 }
}
await collect('src','src');await collect('engine/vello-surface/rust/src','rust-renderer')
await collect('src-tauri/src','native-source');await collect('dist','production-bundle')
await collect('scripts','quality-tools')
await collect('../evidence/retina-history','retina-reference')
for(const name of ['AGENTS.md','index.html','engine/vello-surface/build-receipt.json','engine/vello-surface/rust/Cargo.toml','engine/vello-surface/rust/Cargo.lock','package.json','package-lock.json','src-tauri/Cargo.toml','src-tauri/Cargo.lock','src-tauri/tauri.conf.json','scripts/quality-policy.json']){
 const bytes=await fs.readFile(name);records.push({path:name,absolutePath:path.resolve(name),bytes:bytes.length,sha256:sha256(bytes)})
}
const fixtureRoot=path.resolve(args.includes('--fixture-root')?arg('--fixture-root'):'../fixtures/workspace')
const projectPath=path.join(fixtureRoot,'projects/p1-v2-studies/project.json'),projectBytes=await fs.readFile(projectPath),project=JSON.parse(projectBytes)
records.push({path:'fixture/project.json',absolutePath:projectPath,bytes:projectBytes.length,sha256:sha256(projectBytes)})
await collect(path.join(fixtureRoot,'projects/p1-v2-studies/assets'),'fixture/assets')
let executable=null
if(args.includes('--exe')){const file=path.resolve(arg('--exe')),bytes=await fs.readFile(file);executable={path:file,bytes:bytes.length,sha256:sha256(bytes)}}
const manifest={schema:1,createdAt:new Date().toISOString(),kind:'candidate-provenance-not-acceptance',executable,files:records,
 fixtures:project.boards.filter(b=>!b.parentBoardId).map(b=>({id:b.id,nodes:b.nodes.length,connectors:b.connectors.length,sha256:sha256(JSON.stringify(b))})),
 environment:{platform:process.platform,node:process.version},qualification:executable?'native evidence still required':'NO NATIVE EXE: cannot qualify release'}
const output=path.resolve(args.includes('--output')?arg('--output'):'../output/playwright/candidate-manifest.json')
const uiRoot=path.resolve('../../../archive/older-2026-10-08/desktop-app/prototypes/ui-workspace-2026-09-30')
manifest.uiReferences=[]
for(const reference of ['output/final-review/final-workspace.jpg','output/selection-review/contextual-inspector.jpg','output/family-review/layers-groups-frames.jpg','output/lifecycle-review/recursive-board-navigation.jpg','output/shell-review/navy-split-1280.jpg','output/shell-review/light-split-1440.jpg','output/shell-review/dark-split-1280.jpg','output/shell-review/toolbar-bottom-center.jpg']){
 const file=path.join(uiRoot,reference),bytes=await fs.readFile(file),record={path:'p1-reference/'+reference,absolutePath:file,bytes:bytes.length,sha256:sha256(bytes)}
 records.push(record);manifest.uiReferences.push({reference,sha256:record.sha256})
}
await fs.mkdir(path.dirname(output),{recursive:true});const text=JSON.stringify(manifest,null,2);await fs.writeFile(output,text)
console.log(JSON.stringify({output,sha256:sha256(text),files:records.length,qualification:manifest.qualification}))
