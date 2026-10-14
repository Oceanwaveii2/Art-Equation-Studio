/** Read-only MCP adapter to the running native app; stdout is protocol only. */
import fs from 'node:fs/promises'
import path from 'node:path'
import readline from 'node:readline'
const discoveryPath=process.env.ART_EQUATION_BRIDGE_DISCOVERY||path.join(process.env.LOCALAPPDATA||'', 'studio.artequation.p1v21','codex-live-discovery.json')
const packageVersion=JSON.parse(await fs.readFile(path.join(import.meta.dirname,'..','package.json'),'utf8')).version
const schema=properties=>({type:'object',properties,additionalProperties:false})
const pagination={offset:{type:'integer',minimum:0},limit:{type:'integer',minimum:1,maximum:8000}}
const tools=[
  {name:"art_app_handshake",description:"Identify the exact app instance, workspace, embedded build and telemetry capabilities.",inputSchema:schema({})},
  {name:"art_app_events",description:"Read bounded native durable telemetry batches by resumable cursor, including loss counters. Expired log cursors fail explicitly; no UI callback.",inputSchema:schema({cursor:{type:"string",maxLength:1024},sessionId:{type:"string",maxLength:128},limit:{type:"integer",minimum:1,maximum:200}})},
  {name:'art_app_runtime',description:'Read app-owned process memory and cumulative CPU time plus bridge queue, latency and payload counters. Not GPU VRAM, private memory or release qualification.',inputSchema:schema({})},
  {name:'art_app_status',description:'Read live Art Equation project/UI state, renderer identity and recent telemetry summary. Not a release certificate.',inputSchema:schema({})},
  {name:'art_app_read',description:'Read all open project/board/node/connector/document/asset/UI data and full retained telemetry. Lists and record JSON are paginated. Use stable IDs, matching revisions and nextOffset; inspection never mutates the app.',inputSchema:{...schema({domain:{type:'string',enum:['project','boards','nodes','connectors','documents','assets','ui','telemetry','boardSnapshot','diagnostics','gemini']},id:{type:'string'},boardId:{type:'string'},...pagination}),required:['domain']}},
  {name:'art_app_architecture',description:'Read embedded build architecture/module flows, native commands, dependency/import graph and source manifest. section=source reads allowlisted source file text with hashes and Unicode-scalar pagination.',inputSchema:schema({section:{type:'string',enum:['overview','files','source']},path:{type:'string'},...pagination})},
  {name:'art_app_logs',description:'List all native app logs and durable telemetry, or read a returned ID by byte offset. rawBytesBase64 supports exact reconstruction across UTF-8 byte chunks.',inputSchema:schema({id:{type:'string'},...pagination})},
  {name:'gemini_app_track_bug',description:'File, update, or track bugs/issues in real time in the running Art Equation instance for live bug tracking and remediation.',inputSchema:{...schema({title:{type:'string'},description:{type:'string'},component:{type:'string'},severity:{type:'string',enum:['low','medium','high','critical']},reproductionSteps:{type:'array',items:{type:'string'}},suggestedFix:{type:'string'},status:{type:'string',enum:['open','investigating','resolved']}}),required:['title']}},
  {name:'gemini_app_feedback',description:'Post real-time feedback, diagnostic findings, or suggested actions to the running Art Equation instance live feed.',inputSchema:{...schema({message:{type:'string'},level:{type:'string',enum:['info','warning','error','success']},suggestedAction:{type:'string'}}),required:['message']}},
  {name:'gemini_app_alter',description:'Alter live board or node properties (position, size, styling, title, etc.) in the active Art Equation session in real time.',inputSchema:schema({boardId:{type:'string'},nodeId:{type:'string'},changes:{type:'object'},boardChanges:{type:'object'}})},
  {name:'gemini_app_send_data',description:'Send data in/out of the running app (e.g., inject note cards or graphics onto a canvas board).',inputSchema:{...schema({boardId:{type:'string'},target:{type:'string',enum:['board']},cards:{type:'array',items:{type:'object'}}}),required:['cards']}},
  {name:'gemini_app_execute',description:'Execute an application shell action (e.g. switch tool, toggle panel, trigger command) with live feedback.',inputSchema:{...schema({action:{type:'string'},payload:{type:'object'}}),required:['action']}}
].map(tool=>({...tool,annotations:{readOnlyHint:tool.name.startsWith('art_app_'),destructiveHint:false,idempotentHint:tool.name.startsWith('art_app_'),openWorldHint:false}}))
async function call(name,args){
  if(!tools.some(tool=>tool.name===name))throw Error('Unknown tool: '+name)
  if(!args||typeof args!=='object'||Array.isArray(args))throw Error('Arguments must be an object')
  let selected=discoveryPath
  if(!process.env.ART_EQUATION_BRIDGE_DISCOVERY){
    const dir=path.join(path.dirname(discoveryPath),'codex-live-instances'),candidates=[]
    for(const name of (await fs.readdir(dir).catch(()=>[])).slice(0,32)){
      if(!/^\d+\.json$/.test(name))continue
      const file=path.join(dir,name)
      try {
        const d=JSON.parse(await fs.readFile(file,'utf8'))
        if(!Number.isInteger(d.port)||d.port<1||d.port>65535||!/^[a-f0-9]{64}$/.test(d.token))continue
        const r=await fetch(`http://127.0.0.1:${d.port}/inspect`,{method:'POST',headers:{'Authorization':`Bearer ${d.token}`,'Content-Type':'application/json'},body:JSON.stringify({tool:'art_app_handshake',arguments:{}}),signal:AbortSignal.timeout(300)})
        const v=await r.json();if(v.ok&&v.data?.pid===d.pid)candidates.push(file)
      }catch{}
    }
    if(candidates.length>1)throw Error('Multiple Art Equation instances: set ART_EQUATION_BRIDGE_DISCOVERY to the intended per-instance discovery file')
    if(candidates.length===1)selected=candidates[0]
  }
  const discovery=JSON.parse(await fs.readFile(selected,'utf8').catch(()=>{throw Error('Launch the current Art Equation desktop app first. Live bridge discovery is unavailable.')}))
  if(!Number.isInteger(discovery.port)||discovery.port<1||discovery.port>65535||!/^[a-f0-9]{64}$/.test(discovery.token))throw Error('Invalid local bridge discovery')
  const request=JSON.stringify({tool:name,arguments:args});if(Buffer.byteLength(request)>65536)throw Error('Inspection request exceeds size limit')
  const response=await fetch(`http://127.0.0.1:${discovery.port}/inspect`,{method:'POST',headers:{'Content-Type':'application/json','Authorization':`Bearer ${discovery.token}`},body:request,signal:AbortSignal.timeout(25000)})
  const reader=response.body.getReader();let chunks=[],size=0
  while(true){const {done,value}=await reader.read();if(done)break;size+=value.byteLength;if(size>260000){await reader.cancel();throw Error('Inspection response exceeds size limit')}chunks.push(value)}
  const value=JSON.parse(Buffer.concat(chunks).toString('utf8'));if(!value.ok)throw Error(value.error||'Inspection unavailable')
  if(value.data?.error)throw Error(value.data.error)
  return {content:[{type:'text',text:JSON.stringify(value.data)}]}
}
async function handle(message){
  const {id,method,params}=message;if(id===undefined)return
  try{
    let result
    if(method==='initialize')result={protocolVersion:'2024-11-05',capabilities:{tools:{listChanged:false}},serverInfo:{name:'art-equation-live-app',version:packageVersion}}
    else if(method==='ping')result={}
    else if(method==='tools/list')result={tools}
    else if(method==='tools/call')result=await call(params?.name,params?.arguments||{})
    else{process.stdout.write(JSON.stringify({jsonrpc:'2.0',id,error:{code:-32601,message:'Tool method unavailable'}})+'\n');return}
    process.stdout.write(JSON.stringify({jsonrpc:'2.0',id,result})+'\n')
  }catch(problem){process.stdout.write(JSON.stringify({jsonrpc:'2.0',id,result:{isError:true,content:[{type:'text',text:problem instanceof Error?problem.message:'App inspection failed'}]}})+'\n')}
}
const input=readline.createInterface({input:process.stdin,crlfDelay:Infinity});let active=0
input.on('line',line=>{
  if(Buffer.byteLength(line)>70000)return
  let message;try{message=JSON.parse(line)}catch{return}
  if(active>=16){if(message.id!==undefined)process.stdout.write(JSON.stringify({jsonrpc:'2.0',id:message.id,error:{code:-32000,message:'Inspection queue is full'}})+'\n');return}
  active++;void handle(message).finally(()=>active--)
})
