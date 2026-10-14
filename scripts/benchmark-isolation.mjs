import {execFile} from 'node:child_process'

const inventoryLimit=4096
const browserNames=new Set(['chrome.exe','msedge.exe','chromium.exe','chrome','msedge','chromium','chromium-browser'])
const runnerNames=new Set(['integration-quality.mjs','ui-four-pass-review.mjs','caption-baseline-provider-review.mjs','caption-layout-review.mjs','canvas-performance-baseline.mjs','retained-performance.mjs','inset-outline-pixel-review.mjs','p0-svg-text-browser-tests.mjs','p0-text-layout-browser-tests.mjs','webgpu-adapter-probe.mjs','ui-contrast-audit.mjs','directional-browser-proof.mjs'])
const basename=value=>String(value).replaceAll('\\','/').split('/').at(-1).toLowerCase()

// Windows CommandLine is not an argv array. Preserve quoted paths and the
// backslash-before-quote rules so an incidental script name in node -e code
// cannot masquerade as the executable entry point.
export function splitWindowsCommandLine(command){
 if(typeof command!=='string'||command.length>32768)throw new Error('Invalid process command line')
 const args=[];let cursor=0
 while(cursor<command.length){
  while(/\s/.test(command[cursor]||'')&&cursor<command.length)cursor++
  if(cursor===command.length)break
  let token='',quoted=false
  while(cursor<command.length&&(quoted||!(/\s/.test(command[cursor])))){
   let slashes=0
   while(command[cursor]==='\\'){slashes++;cursor++}
   if(command[cursor]==='"'){
    token+='\\'.repeat(Math.floor(slashes/2))
    if(slashes%2)token+='"'
    else if(quoted&&command[cursor+1]==='"'){token+='"';cursor++}
    else quoted=!quoted
    cursor++
   }else{
    token+='\\'.repeat(slashes)
    if(cursor<command.length&&(quoted||!(/\s/.test(command[cursor]))))token+=command[cursor++]
   }
  }
  args.push(token)
 }
 return args
}

function nodeEntry(args){
 const valueOptions=new Set(['-r','--require','--import','--loader','--experimental-loader','--inspect-port','--conditions','--icu-data-dir','--openssl-config','--title'])
 for(let index=1;index<args.length;index++){
  const argument=args[index]
  if(['-e','--eval','-p','--print'].includes(argument)||argument.startsWith('--eval=')||argument.startsWith('--print='))return null
  if(argument==='--')return args[index+1]||null
  if(valueOptions.has(argument)){index++;continue}
  if(argument.startsWith('-'))continue
  return argument
 }
 return null
}

export function parseWindowsProcessInventory(json){
 const parsed=typeof json==='string'?JSON.parse(json.replace(/^\uFEFF/,'')):json
 if(parsed?.schema!==1||!Array.isArray(parsed.rows)||parsed.rows.length===0||parsed.rows.length>inventoryLimit||parsed.truncated!==false)throw new Error('Incomplete or truncated Windows process inventory')
 const ids=new Set()
 return parsed.rows.map(row=>{
  if(!Number.isSafeInteger(row.ProcessId)||row.ProcessId<0||!Number.isSafeInteger(row.ParentProcessId)||row.ParentProcessId<0||typeof row.Name!=='string'||!row.Name||row.Name.length>256||!(row.CommandLine===null||typeof row.CommandLine==='string')||row.CommandLine?.length>32768||ids.has(row.ProcessId))throw new Error('Malformed Windows process inventory row')
  ids.add(row.ProcessId)
  return {pid:row.ProcessId,parentPid:row.ParentProcessId,name:row.Name,argv:row.CommandLine===null?[]:splitWindowsCommandLine(row.CommandLine)}
 })
}

export function analyzeBenchmarkProcesses(rows,selfPid){
 const byPid=new Map(rows.map(row=>[row.pid,row]))
 if(!Number.isSafeInteger(selfPid)||!byPid.has(selfPid))throw new Error('Current benchmark process missing from inventory')
 const ancestors=new Set();let next=selfPid
 while(byPid.has(next)&&!ancestors.has(next)){ancestors.add(next);next=byPid.get(next).parentPid}
 const children=new Map()
 for(const row of rows){const values=children.get(row.parentPid)||[];values.push(row);children.set(row.parentPid,values)}
 const descendants=pid=>{
  const found=[],seen=new Set([pid]),pending=[pid]
  while(pending.length){for(const row of children.get(pending.shift())||[]){if(seen.has(row.pid))continue;seen.add(row.pid);found.push(row);pending.push(row.pid)}}
  return found
 }
 const roots=[]
 for(const row of rows){
  if(ancestors.has(row.pid))continue
  const name=row.name.toLowerCase(),entry=['node.exe','node'].includes(name)?nodeEntry(row.argv):null
  const normalizedEntry=entry?.replaceAll('\\','/').toLowerCase()||'',entryName=basename(normalizedEntry)
  if(entryName==='clidaemon.js'&&normalizedEntry.includes('playwright'))roots.push({row,category:'playwright-cli-daemon',entry:entryName})
  else if(runnerNames.has(entryName))roots.push({row,category:'art-equation-browser-or-gpu-runner',entry:entryName})
  else if(browserNames.has(name)&&!row.argv.some(arg=>arg==='--type'||arg.startsWith('--type='))&&row.argv.includes('--remote-debugging-pipe')&&row.argv.some(arg=>/^--user-data-dir=.*(?:playwright_chromiumdev_profile-|playwright[-_])/i.test(arg)))roots.push({row,category:'playwright-managed-browser',entry:name})
 }
 const rootIds=new Set(roots.map(root=>root.row.pid))
 const blockers=roots.filter(root=>{
  let pid=root.row.parentPid,rootAncestor=false;const seen=new Set([root.row.pid])
  while(byPid.has(pid)){
   if(seen.has(pid))throw new Error('Ambiguous cyclic process lineage')
   if(rootIds.has(pid))rootAncestor=true
   seen.add(pid);const parent=byPid.get(pid).parentPid
   if(pid===0&&parent===0)break
   pid=parent
  }
  return !rootAncestor
 }).map(({row,category,entry})=>{
  const related=descendants(row.pid)
  // Do not persist command lines, URLs, environment values or user profile
  // paths. IDs and executable names suffice to review the process relation.
  return {pid:row.pid,parentPid:row.parentPid,name:row.name,category,entry,browserDescendants:related.filter(child=>browserNames.has(child.name.toLowerCase())).map(child=>({pid:child.pid,parentPid:child.parentPid,name:child.name})),relatedProcessCount:related.length}
 })
 return {processesChecked:rows.length,excludedSelfAndAncestorCount:ancestors.size,blockers}
}

const inventoryScript="$ErrorActionPreference='Stop'; [Console]::OutputEncoding=[System.Text.Encoding]::UTF8; $rows=@(Get-CimInstance -ClassName Win32_Process -OperationTimeoutSec 5 | Select-Object -First 4097 ProcessId,ParentProcessId,Name,CommandLine); [pscustomobject]@{schema=1;rows=$rows;truncated=($rows.Count -gt 4096)} | ConvertTo-Json -Depth 4 -Compress"
async function windowsInventory(){
 return new Promise((resolve,reject)=>execFile('powershell.exe',['-NoLogo','-NoProfile','-NonInteractive','-Command',inventoryScript],{timeout:8000,maxBuffer:4*1024*1024,windowsHide:true,encoding:'utf8'},(error,stdout)=>error?reject(new Error('Windows process inventory command failed')):resolve(stdout)))
}

export async function collectBenchmarkIsolation({phase='preflight',platform=process.platform,selfPid=process.pid,inventoryProvider=windowsInventory}={}){
 const receipt={schema:1,checkedAt:new Date().toISOString(),phase,platform,available:false,status:'UNAVAILABLE',processesChecked:0,blockers:[],failures:[],scope:'Read-only Windows process snapshots outside browser timing; known audit runners and Playwright automation only.',limitations:['Snapshots cannot detect a process that starts and exits between checks.','Ordinary user browsers, native applications and unrelated GPU activity are not classified; this is not system-wide GPU isolation.','Process command-line access may be restricted. Unknown or inaccessible automation cannot be identified from its name alone.']}
 if(platform!=='win32'){receipt.failures.push('Windows process inventory unavailable on this platform');return receipt}
 try{
  const analysis=analyzeBenchmarkProcesses(parseWindowsProcessInventory(await inventoryProvider()),selfPid)
  Object.assign(receipt,analysis,{available:true,status:analysis.blockers.length?'BLOCKED':'CLEAR_SNAPSHOT'})
  if(analysis.blockers.length)receipt.failures.push('Competing Playwright automation or Art Equation browser/GPU audit runner detected')
 }catch(error){receipt.failures.push(error.message==='Windows process inventory command failed'?error.message:'Windows process inventory unavailable or invalid')}
 return receipt
}

export function benchmarkIsolationFailures(receipt,{requireInventory=false}={}){
 if(!receipt||receipt.schema!==1||receipt.available!==true)return requireInventory?['Benchmark process isolation inventory unavailable; exact-4K diagnostic timing is invalid']:[]
 if(receipt.status!=='CLEAR_SNAPSHOT'||!Array.isArray(receipt.blockers)||receipt.blockers.length)return ['Competing automation detected outside timing; diagnostic process isolation failed']
 return []
}
