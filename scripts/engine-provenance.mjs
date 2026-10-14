import fs from 'node:fs'
import path from 'node:path'
import crypto from 'node:crypto'
import { spawnSync } from 'node:child_process'
const root=path.resolve(import.meta.dirname,'..'), receipt=path.join(root,'engine/vello-surface/build-receipt.json')
if(process.argv.includes('--record')){
  // A receipt may only be refreshed by actually rebuilding and regenerating
  // both binding copies. Hashing an old binary beside new source cannot bless it.
  const target=process.env.AE21_ENGINE_TARGET||'D:/0/AE21EngineTarget'
  const bin=path.join(process.env.USERPROFILE,'.cargo/bin')
  const run=(exe,args)=>{const result=spawnSync(path.join(bin,exe),args,{cwd:root,stdio:'inherit',env:{...process.env,CARGO_TARGET_DIR:target,CARGO_TARGET_WASM32_UNKNOWN_UNKNOWN_RUSTFLAGS:'-C link-arg=--max-memory=268435456'}});if(result.status!==0)throw new Error(`Engine rebuild failed: ${exe} (${result.error?.message||result.status})`)}
  const features=process.env.AE_ENGINE_FEATURES||''
  if(features && features!=='browser-hybrid')throw new Error('Unsupported engine build feature')
  run('cargo.exe',['build','--manifest-path','engine/vello-surface/rust/Cargo.toml','--target','wasm32-unknown-unknown','--release','--offline','--locked',...(features?['--features',features]:[])])
  run('wasm-bindgen.exe',[path.join(target,'wasm32-unknown-unknown/release/art_equation_p0_app_surface.wasm'),'--target','web','--out-dir','engine/vello-surface/generated','--out-name','p0_engine_wasm'])
  for(const name of ['p0_engine_wasm.js','p0_engine_wasm.d.ts','p0_engine_wasm_bg.wasm','p0_engine_wasm_bg.wasm.d.ts'])fs.copyFileSync(path.join(root,'engine/vello-surface/generated',name),path.join(root,'src/project-b/p0-surface/generated',name))
}
const hash=file=>crypto.createHash('sha256').update(fs.readFileSync(path.join(root,file))).digest('hex')
function walk(dir){return fs.readdirSync(path.join(root,dir),{withFileTypes:true}).flatMap(e=>e.isDirectory()?walk(`${dir}/${e.name}`):[`${dir}/${e.name}`])}
const files=[...walk('engine/vello-surface/rust/src'),'engine/vello-surface/rust/Cargo.toml','engine/vello-surface/rust/Cargo.lock',...walk('engine/vello-surface/rust/vendor'),...walk('engine/vello-surface/generated'),...walk('src/project-b/p0-surface/generated')].sort()
const hashes=Object.fromEntries(files.map(f=>[f,hash(f)]))
if(process.argv.includes('--record')){
  fs.writeFileSync(receipt,JSON.stringify({schema:1,command:'cargo build --target wasm32-unknown-unknown --release --offline --locked; wasm-bindgen --target web --out-name p0_engine_wasm',features:process.env.AE_ENGINE_FEATURES||'',wasmBindgen:'0.2.114',maxLinearMemoryBytes:268435456,files:hashes},null,2)+'\n')
  console.log('Engine build receipt recorded; this is provenance, not product qualification')
}else{
  const recorded=JSON.parse(fs.readFileSync(receipt,'utf8'))
  if(JSON.stringify(recorded.files)!==JSON.stringify(hashes))throw new Error('ENGINE_SOURCE_BINARY_MISMATCH: rebuild WASM and record its build receipt before packaging')
  for(const file of walk('engine/vello-surface/generated')){
    const copy=`src/project-b/p0-surface/generated/${path.basename(file)}`
    if(hashes[file]!==hashes[copy])throw new Error(`ENGINE_BINDINGS_MISMATCH: ${copy}`)
  }
  console.log(`Engine source and consumed bindings: PASS (${files.length} hashes; not product qualification)`)
}
