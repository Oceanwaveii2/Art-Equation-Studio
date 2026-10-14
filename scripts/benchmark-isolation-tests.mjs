import assert from 'node:assert/strict'
import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import {fork} from 'node:child_process'
import {once} from 'node:events'
import {splitWindowsCommandLine,parseWindowsProcessInventory,analyzeBenchmarkProcesses,collectBenchmarkIsolation,benchmarkIsolationFailures} from './benchmark-isolation.mjs'

let checks=0
const current={ProcessId:400,ParentProcessId:300,Name:'node.exe',CommandLine:'"C:\\node.exe" scripts/integration-quality.mjs'}
const shell={ProcessId:300,ParentProcessId:0,Name:'pwsh.exe',CommandLine:'pwsh -Command "Get-CimInstance | Where CommandLine -match integration-quality.mjs"'}
const userBrowser={ProcessId:500,ParentProcessId:1,Name:'msedge.exe',CommandLine:'"C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe" --profile-directory=Default https://example.com'}
const cli={ProcessId:600,ParentProcessId:1,Name:'node.exe',CommandLine:'"C:\\Program Files\\nodejs\\node.exe" "C:\\Users\\User\\AppData\\Local\\npm-cache\\_npx\\31e32ef8478fbf80\\node_modules\\playwright-core\\lib\\entry\\cliDaemon.js" ae21 --headed'}
const managedBrowser={ProcessId:601,ParentProcessId:600,Name:'chrome.exe',CommandLine:'"C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe" --user-data-dir=C:\\Users\\User\\AppData\\Local\\Temp\\playwright_chromiumdev_profile-XX --remote-debugging-pipe'}
const gpuChild={ProcessId:602,ParentProcessId:601,Name:'chrome.exe',CommandLine:'chrome.exe --type=gpu-process --user-data-dir=C:\\Temp\\playwright_chromiumdev_profile-XX'}
const analyze=rows=>analyzeBenchmarkProcesses(parseWindowsProcessInventory(JSON.stringify({schema:1,rows:[current,shell,userBrowser,...rows],truncated:false})),400)

assert.deepEqual(splitWindowsCommandLine(cli.CommandLine),['C:\\Program Files\\nodejs\\node.exe','C:\\Users\\User\\AppData\\Local\\npm-cache\\_npx\\31e32ef8478fbf80\\node_modules\\playwright-core\\lib\\entry\\cliDaemon.js','ae21','--headed']);checks++
assert.deepEqual(splitWindowsCommandLine('node.exe "" "a\\\"b" "two words"'),['node.exe','','a"b','two words']);checks++
assert.equal(analyze([]).blockers.length,0);checks++
let result=analyze([cli,managedBrowser,gpuChild])
assert.equal(result.blockers.length,1);assert.equal(result.blockers[0].category,'playwright-cli-daemon');assert.equal(result.blockers[0].relatedProcessCount,2);assert.deepEqual(result.blockers[0].browserDescendants.map(row=>row.pid),[601,602]);checks++
assert.equal(analyze([cli]).blockers.length,1);checks++ // An idle retained daemon may create a browser during timing.
result=analyze([{...managedBrowser,parentProcessId:1,ParentProcessId:1}])
assert.equal(result.blockers[0].category,'playwright-managed-browser');checks++ // Orphaned browser survives its automation parent.
assert.equal(analyze([{...managedBrowser,CommandLine:'msedge.exe --remote-debugging-port=9222 --user-data-dir=C:\\UserProfile'}]).blockers.length,0);checks++ // User's ordinary browser/debugging profile is not rejected.
assert.equal(analyze([{...cli,CommandLine:'node.exe unrelated/cliDaemon.js ae21 --headed'}]).blockers.length,0);checks++
assert.equal(analyze([{...cli,CommandLine:'node.exe -e "console.log(\'scripts/integration-quality.mjs\')"'}]).blockers.length,0);checks++ // Text inside shell/eval is not a running audit entry.
assert.equal(analyze([{...cli,CommandLine:'node.exe scripts/integration-quality-provenance-tests.mjs'}]).blockers.length,0);checks++
assert.equal(analyze([{...cli,CommandLine:'node.exe --enable-source-maps --require hook.cjs "C:\\Art Equation\\scripts\\ui-four-pass-review.mjs"'}]).blockers[0].entry,'ui-four-pass-review.mjs');checks++
assert.equal(analyze([{...cli,CommandLine:'node.exe scripts/webgpu-adapter-probe.mjs'}]).blockers.length,1);checks++
assert.equal(analyze([{...cli,CommandLine:null}]).blockers.length,0);checks++ // Missing command lines are disclosed as a limitation, not guessed.
result=analyze([cli,managedBrowser,gpuChild,{...cli,ProcessId:700,ParentProcessId:400,CommandLine:'node.exe scripts/retained-performance.mjs'}])
assert.equal(result.blockers.length,2);checks++ // Another runner in this process tree is not hidden with the benchmark's own ancestors.
assert.ok(!JSON.stringify(result).includes('npm-cache'));assert.ok(!JSON.stringify(result).includes('example.com'));assert.ok(!JSON.stringify(result).includes('UserProfile'));checks++
assert.throws(()=>analyze([{...cli,ParentProcessId:601},managedBrowser]));checks++ // Cyclic stale parent IDs cannot hide competing roots or loop forever.
for(const inventory of [{schema:1,rows:[],truncated:false},{schema:1,rows:[current,current],truncated:false},{schema:1,rows:[current],truncated:true},{schema:1,rows:[{...current,ProcessId:NaN}],truncated:false},{schema:1,rows:[{...current,CommandLine:'x'.repeat(32769)}],truncated:false}])assert.throws(()=>parseWindowsProcessInventory(inventory));checks++
assert.throws(()=>analyzeBenchmarkProcesses(parseWindowsProcessInventory({schema:1,rows:[shell],truncated:false}),400));checks++
const blocked=await collectBenchmarkIsolation({platform:'win32',selfPid:400,inventoryProvider:async()=>JSON.stringify({schema:1,rows:[current,shell,cli,managedBrowser],truncated:false})})
assert.equal(blocked.status,'BLOCKED');assert.equal(benchmarkIsolationFailures(blocked,{requireInventory:false}).length,1);checks++
const unavailable=await collectBenchmarkIsolation({platform:'linux',inventoryProvider:async()=>{throw new Error('must not query Windows on Linux')}})
assert.equal(unavailable.available,false);assert.equal(benchmarkIsolationFailures(unavailable,{requireInventory:true}).length,1);assert.deepEqual(benchmarkIsolationFailures(unavailable),[]);checks++
const failed=await collectBenchmarkIsolation({platform:'win32',inventoryProvider:async()=>{throw new Error('sensitive command-line value')}})
assert.equal(failed.status,'UNAVAILABLE');assert.ok(!JSON.stringify(failed).includes('sensitive'));checks++

let live=null
if(process.platform==='win32'){
 // Launch only a harmless Node IPC child with an actual Windows command line.
 // No browser/GPU starts. It exits cooperatively when this test sends "done".
 const root=await fs.mkdtemp(path.join(os.tmpdir(),'playwright-isolation-test-'))
 const entry=path.join(root,'cliDaemon.js')
 await fs.writeFile(entry,"process.send('ready'); process.on('message', message => { if (message === 'done') process.disconnect() });\n")
 const child=fork(entry,[],{stdio:['ignore','ignore','ignore','ipc'],windowsHide:true})
 const closed=once(child,'close')
 try{
  await once(child,'message')
  live=await collectBenchmarkIsolation()
  assert.equal(live.available,true,'Actual Windows inventory must be available for this platform check')
  assert.ok(live.blockers.some(row=>row.pid===child.pid&&row.category==='playwright-cli-daemon'),'Actual CIM inventory must identify the controlled IPC process by its entry argv');checks++
 }finally{
  if(child.connected)child.send('done')
  await closed
  await fs.unlink(entry);await fs.rmdir(root)
 }
 const clean=await collectBenchmarkIsolation()
 assert.equal(clean.available,true);assert.ok(!clean.blockers.some(row=>row.pid===child.pid));checks++
}
console.log(JSON.stringify({checks,decision:'PASS',liveWindowsInventory:!!live,scope:'Known automation inventory/parser/process-relation checks with a cooperative Node IPC child; no browser/GPU or acceptance'}))
