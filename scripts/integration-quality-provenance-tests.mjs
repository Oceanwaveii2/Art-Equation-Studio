import assert from 'node:assert/strict'
import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import {sha256} from './quality-evidence.mjs'
import {verifyDiagnosticManifest,applyDiagnosticProvenance} from './integration-quality.mjs'

// Importing the runner must not launch a browser. These checks mutate only
// disposable files and exercise rejection using real byte hashes.
const root=await fs.mkdtemp(path.join(os.tmpdir(),'ae-diagnostic-provenance-'))
const source=path.join(root,'source.bin'),asset=path.join(root,'asset.bin'),file=path.join(root,'manifest.json')
let checks=0
const record=(name,absolutePath,bytes)=>({path:name,absolutePath,bytes:bytes.length,sha256:sha256(bytes)})
const originalSource=Buffer.from('source-A'),originalAsset=Buffer.from('asset-A')
const manifest={schema:1,kind:'candidate-provenance-not-acceptance',executable:null,files:[record('src/source.bin',source,originalSource),record('fixture/assets/asset.bin',asset,originalAsset)]}
const manifestBytes=Buffer.from(JSON.stringify(manifest)),snapshot={file,sha256:sha256(manifestBytes),manifest}
const smoke={decision:'SMOKE_ONLY',failures:[],scope:'Synthetic screen for validator test only'}
try{
 await fs.writeFile(source,originalSource);await fs.writeFile(asset,originalAsset);await fs.writeFile(file,manifestBytes)
 let verification=await verifyDiagnosticManifest(snapshot)
 assert.equal(verification.unchanged,true);assert.equal(verification.filesChecked,2);checks++
 assert.equal(applyDiagnosticProvenance(smoke,verification).decision,'SMOKE_ONLY');checks++

 await fs.writeFile(source,'source-B') // same length, different content
 verification=await verifyDiagnosticManifest(snapshot)
 assert.equal(verification.unchanged,false);assert.ok(verification.failures.some(f=>f==='Changed diagnostic artifact: src/source.bin'));checks++
 const combined=applyDiagnosticProvenance({...smoke,decision:'REJECT',failures:['Existing render failure']},verification,['Readiness timeout'])
 assert.equal(combined.decision,'REJECT');assert.ok(combined.failures.includes('Existing render failure'));assert.ok(combined.failures.includes('Diagnostic runner failed: Readiness timeout'));assert.ok(combined.failures.includes('Changed diagnostic artifact: src/source.bin'));assert.equal(verification.failures.length,1);checks++
 await fs.writeFile(source,originalSource)

 await fs.unlink(asset)
 verification=await verifyDiagnosticManifest(snapshot)
 assert.equal(verification.unchanged,false);assert.ok(verification.failures.includes('Diagnostic artifact unavailable: fixture/assets/asset.bin'));checks++
 await fs.writeFile(asset,originalAsset)

 await fs.appendFile(file,'\n')
 verification=await verifyDiagnosticManifest(snapshot)
 assert.equal(verification.unchanged,false);assert.ok(verification.failures.includes('Diagnostic provenance manifest changed after preflight'));checks++
 await fs.writeFile(file,manifestBytes)
 await fs.unlink(file)
 verification=await verifyDiagnosticManifest(snapshot)
 assert.equal(verification.unchanged,false);assert.ok(verification.failures.includes('Diagnostic provenance manifest unavailable after preflight'));checks++
 await fs.writeFile(file,manifestBytes)

 for(const invalid of [undefined,{...snapshot,manifest:{schema:1,files:[]}},{...snapshot,manifest:{schema:2,files:manifest.files}}])assert.equal((await verifyDiagnosticManifest(invalid)).unchanged,false)
 checks++
 for(const malformed of [{...manifest.files[0],sha256:'bad'},{...manifest.files[0],bytes:-1},{...manifest.files[0],absolutePath:'relative.bin'}]){
  verification=await verifyDiagnosticManifest({...snapshot,manifest:{schema:1,files:[malformed]}})
  assert.equal(verification.unchanged,false);assert.ok(verification.failures.some(f=>f.startsWith('Malformed tracked diagnostic artifact:')))
 }
 checks++
 assert.equal(applyDiagnosticProvenance(smoke,undefined).decision,'REJECT');assert.equal(applyDiagnosticProvenance(smoke,{unchanged:false,failures:[]}).decision,'REJECT');checks++
 assert.equal(applyDiagnosticProvenance(smoke,{unchanged:true,failures:[]},['Navigation failed']).decision,'REJECT');checks++
 console.log(JSON.stringify({checks,decision:'PASS',scope:'Offline diagnostic provenance rejection checks; no browser, GPU or release acceptance'}))
}finally{
 for(const item of [source,asset,file])await fs.unlink(item).catch(error=>{if(error.code!=='ENOENT')throw error})
 await fs.rmdir(root)
}
