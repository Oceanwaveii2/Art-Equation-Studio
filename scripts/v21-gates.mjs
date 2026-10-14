import fs from 'node:fs/promises'
import path from 'node:path'
import {spawnSync} from 'node:child_process'
const out=path.resolve('../output/playwright/gates');await fs.mkdir(out,{recursive:true})
const names=['node-column-tests','p0-display-list-tests','p0-image-resources-tests','p0-shaped-text-tests','p0-svg-paint-tests','p0-world-bounds-tests','p0-vector-geometry-tests','p0-live-scene-tests','p0-spatial-index-tests','p0-card-layout-tests','p0-complete-card-paint-tests','measured-background-paint-tests','live-video-provider-tests','natural-image-bounds-tests','p0-connector-gesture-tests','p0-drawing-layer-tests','p0-plain-line-tests','p0-ellipse-tests','p0-freehand-gesture-tests','p0-canonical-vector-picking-tests','partii-vello-container-eligibility','native-command-journal','board-portal-trash','layout-research.test','svg-drawing.test']
const results=[]
for(const name of names){
 const file='scripts/'+name+'.mjs'
 try{await fs.access(file)}catch{results.push({name,status:'missing'});continue}
 const run=spawnSync(process.execPath,[file],{encoding:'utf8',timeout:60000,maxBuffer:8*1024*1024})
 await fs.writeFile(path.join(out,name+'.log'),(run.stdout||'')+'\n'+(run.stderr||''))
 const status=run.status===0?'pass':run.error?.code==='ETIMEDOUT'?'timeout':'fail'
 results.push({name,status,exit:run.status,reason:run.error?.message||(run.stderr||'').replace(/data:text\/javascript;base64,[A-Za-z0-9+/=]+/g,'[transpiled module]').slice(0,450)})
 console.log(name,status)
}
await fs.writeFile(path.join(out,'gate-results.json'),JSON.stringify({at:new Date().toISOString(),scope:'Current integrated source and actual WASM where script loads it. Does not certify native GPU pixels.',results},null,2))
if (results.some(result => result.status !== 'pass')) process.exitCode = 1

