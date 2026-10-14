import fs from 'node:fs/promises'
import path from 'node:path'
import {createHash,randomUUID} from 'node:crypto'
const base='D:/0/ArtEquation-Tests/2026-10-11-reference-reconstruction',out=base+'/builds/2026-10-11-launch-layout-alpha',old=base+'/builds/2026-10-11-boot-splash-alpha',reports=base+'/reports/launch-layout'
await fs.mkdir(out,{recursive:true});await fs.mkdir(reports,{recursive:true})
async function copyTree(a,b){await fs.mkdir(b,{recursive:true});for(const e of await fs.readdir(a,{withFileTypes:true})){const source=path.join(a,e.name),target=path.join(b,e.name);if(e.isDirectory())await copyTree(source,target);else if(/\.(json|toml|txt|log)$/i.test(e.name))await fs.copyFile(source,target);else try{await fs.link(source,target)}catch(err){if(err.code!=='EEXIST')throw err}}}
await copyTree(old+'/projects',out+'/projects');await copyTree(old+'/tools',out+'/tools')
await fs.writeFile(out+'/workspace.json',JSON.stringify({schemaVersion:1,workspaceId:randomUUID(),name:'Launch layout alpha',createdAtUnixMs:Date.now()},null,2))
await fs.copyFile(old+'/settings.json',out+'/settings.json')
await fs.copyFile('src-tauri/target/release/art-equation-prototype-25.exe',out+'/Art-Equation-alpha.exe')
const latest=(await fs.readdir('output/playwright')).filter(n=>n.startsWith('boot-splash-four-pass-')).sort().at(-1)
await fs.copyFile('output/playwright/'+latest+'/report.json',reports+'/four-pass.json');await fs.copyFile('output/playwright/'+latest+'/layout-reference-open.png',reports+'/launch-preview.png')
await fs.copyFile('output/playwright/ui-four-passes-1791771041325/review.json',reports+'/workspace-review.json')
const hash=createHash('sha256').update(await fs.readFile(out+'/Art-Equation-alpha.exe')).digest('hex'),architecture=JSON.parse(await fs.readFile('src-tauri/bridge-architecture.json','utf8')).identity
await fs.writeFile(out+'/BUILD-INFO.json',JSON.stringify({status:'UI_SMOKE_VERIFIED; NATIVE_STARTUP_PENDING; NOT_RELEASE_QUALIFIED',createdAt:new Date().toISOString(),exeSha256:hash,architecture,review:reports+'/four-pass.json',workspaceReview:reports+'/workspace-review.json',preview:reports+'/launch-preview.png',changes:['Reference-matched cream workspace preset list, mint selection, turquoise focus, mauve Enter and brown footer.','Milinotes: canvas with navigation; Graphing: canvas with inspector; Advanced Split: document and canvas. No authored graph or board mutations.','Navy/Dark/Light remain available in hardware/settings popup.','Artwork preserved from supplied TIFF.'],baselineExe:'Previous boot-splash-alpha package remains untouched.'},null,2));console.log(JSON.stringify({out,reports,hash}))
