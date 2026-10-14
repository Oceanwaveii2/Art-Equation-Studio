import fs from 'node:fs/promises'
import path from 'node:path'
const retired=[['d','x','12'].join(''),['generation','2'].join('-'),['Direct X','12 version'].join(' '),['art-equation','contract-v1'].join('-')]
const files=[]
async function collect(dir){for(const item of await fs.readdir(dir,{withFileTypes:true})){const name=path.join(dir,item.name);if(item.isDirectory())await collect(name);else if(/\.(tsx?|css|rs|toml|json)$/.test(name))files.push(name)}}
await collect('src');await collect('src-tauri/src')
files.push('src-tauri/Cargo.toml','src-tauri/tauri.conf.json','package.json')
const failures=[]
// Owner-authorized native preparation additions use wgpu's current DX12 backend.
// This is not permission to reactivate the retired custom Generation 2 renderer.
const nativePreparationDx12 = new Set(['src/ui/ExperimentalPreparationSettings.tsx','src/ui/LaunchHardwareSettings.tsx','src/ui/launchPreferences.ts','src/ui/launchTranslations.ts','src-tauri/src/engine_capabilities.rs','src-tauri/src/experimental_compute.rs','src-tauri/src/experimental_compute/nvidia.rs','src-tauri/src/hardware_discovery.rs','src-tauri/src/launch_preferences.rs','src-tauri/Cargo.toml'])
for(const file of files){const source=(await fs.readFile(file,'utf8')).toLowerCase();for(const token of retired){
 if(token===retired[0]&&nativePreparationDx12.has(file.replaceAll('\\','/')))continue
 if(source.includes(token.toLowerCase()))failures.push({file,token})
}}
const packageJson=JSON.parse(await fs.readFile('package.json','utf8'))
const app=await fs.readFile('src/App.tsx','utf8')
if(!app.includes("const renderMode = 'vello' as const"))failures.push({file:'src/App.tsx',token:'Unfixed renderer selection'})
if(!packageJson.scripts['build:v2'].includes('renderer-contract-check'))failures.push({file:'package.json',token:'Build guard absent'})
if(failures.length){console.error(failures);process.exit(1)}
console.log(`Renderer contract: PASS (${files.length} source/config files; Vello GPU and CPU; retired runtime absent)`)
