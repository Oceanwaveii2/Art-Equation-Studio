import assert from 'node:assert/strict'
import { inspectApp } from '../src/codex/appInspection.ts'
const project = { id:'p',title:'Current unsaved project',updatedAt:'revision-1',questionnaire:{summary:'Unsaved text'},
  boards:[{id:'b',title:'Board',viewport:{scale:.1,x:0,y:0},nodes:[{id:'n',kind:'image',dataUrl:'data:image/png;base64,SECRET',width:90,height:50},{id:'n2',kind:'text',content:'Live text'}],connectors:[{id:'c',from:'n',to:'n2'}]}],
  documents:[{id:'d',title:'Document',content:{text:'Current document '.repeat(1000)}}],assets:[{id:'a',displayName:'Image',relativePath:'assets/reference.webp'}],openWith:{webp:'PRIVATE EXECUTABLE'} }
const context = {project,ui:{selection:{boardId:'b',ids:['n']},theme:'navy'}}
const before=JSON.stringify(context)
const read=args=>inspectApp(context,'art_app_read',args)
assert.equal(inspectApp(context,'art_app_status',{}).title,project.title)
assert.equal(inspectApp(context,'art_app_status',{}).telemetry.available,false)
const telemetry={rows:Array.from({length:200},(_,i)=>({kind:'input.commit',t:i})),dropped:4,historyDropped:9,transportFailures:2}
const status=inspectApp(context,'art_app_status',{},telemetry)
assert.equal(status.telemetry.dropped,4);assert.equal(status.telemetry.truncated,true);assert.equal(JSON.parse(status.telemetry.recentJson).length,60)
assert.equal(read({domain:'boards'}).records[0].nodes,2)
assert.equal(read({domain:'nodes',boardId:'b',limit:1}).nextOffset,1)
assert.equal(read({domain:'nodes',boardId:'b',offset:1}).records[0].id,'n2')
assert.equal(read({domain:'connectors',boardId:'b'}).records[0].id,'c')
assert.equal(read({domain:'assets'}).records[0].title,'Image')
assert.ok(read({domain:'project'}).jsonText.includes('PRIVATE EXECUTABLE'),'Application assignments are model metadata requested for troubleshooting')
assert.ok(read({domain:'nodes',boardId:'b',id:'n'}).jsonText.includes('SECRET'),'Explicit record reads expose all authored model fields, including embedded media data')
assert.ok(!read({domain:'boards',id:'b'}).jsonText.includes('"nodes"'))
let offset=0,text='';do{const page=read({domain:'documents',id:'d',offset,limit:150});text+=page.jsonText;offset=page.nextOffset}while(offset!==null)
assert.deepEqual(JSON.parse(text),project.documents[0]);assert.equal(read({domain:'documents',id:'d'}).revision,'revision-1')
for(const args of [null,[],{domain:'disk'},{domain:'boards',path:'../../auth.json'},{domain:'nodes'},{domain:'nodes',boardId:'missing'},{domain:'documents',id:'missing'},{domain:'boards',offset:-1},{domain:'boards',offset:NaN},{domain:'boards',limit:0},{domain:'boards',limit:8001},{domain:'boards',id:2},{domain:'project',id:'other'},{domain:'documents',id:'d',offset:99999999}]) assert.throws(()=>read(args))
assert.throws(()=>inspectApp(context,'run_shell',{}));assert.throws(()=>inspectApp(context,'art_app_status',{extra:true}))
assert.equal(JSON.stringify(context),before,'Inspection must not mutate project, selection or view')
project.boards[0].nodes[1].content='Fresh edits';project.updatedAt='revision-2'
assert.ok(read({domain:'nodes',boardId:'b',id:'n2'}).jsonText.includes('Fresh edits'))
assert.equal(read({domain:'nodes',boardId:'b',id:'n2'}).revision,'revision-2')
let telemetryText='',telemetryOffset=0,telemetryId
do { const page=inspectApp(context,'art_app_read',{domain:'telemetry',id:telemetryId,offset:telemetryOffset,limit:100},telemetry);telemetryText+=page.jsonText;telemetryOffset=page.nextOffset;telemetryId=page.id }while(telemetryOffset!==null)
assert.deepEqual(JSON.parse(telemetryText),telemetry,'Every retained telemetry row is available, without the status-summary limit')
assert.throws(()=>read({domain:'telemetry'}),'Missing telemetry must not be presented as an empty success')
assert.throws(()=>read({domain:'telemetry',id:'unknown'}))
assert.throws(()=>inspectApp(context,'art_app_read',{domain:'telemetry',offset:1},telemetry))
telemetry.rows.push({kind:'changed'})
assert.equal(inspectApp(context,'art_app_read',{domain:'telemetry',id:telemetryId,limit:8000}).total,telemetryText.length,'Paged telemetry stays frozen while live history changes')
let boardText='',boardOffset=0,boardSnapshotId,boardRevision
const frozenBoard=JSON.parse(JSON.stringify(project.boards[0]))
do { const page=read({domain:'boardSnapshot',boardId:'b',id:boardSnapshotId,offset:boardOffset,limit:100});boardText+=page.jsonText;boardOffset=page.nextOffset;boardSnapshotId=page.id;boardRevision??=page.revision;assert.equal(page.revision,boardRevision);assert.equal(page.frozen,true);project.boards[0].nodes[1].content='Changed during read' } while(boardOffset!==null)
assert.deepEqual(JSON.parse(boardText),frozenBoard)
assert.throws(()=>read({domain:'boardSnapshot',boardId:'missing',id:boardSnapshotId}))
assert.throws(()=>read({domain:'boardSnapshot',boardId:'b',offset:1}))
assert.throws(()=>inspectApp({project:{...project,id:'other'},ui:{}},'art_app_read',{domain:'boardSnapshot',boardId:'b',id:boardSnapshotId}))
const oldNow=Date.now;Date.now=()=>oldNow()+300001
assert.throws(()=>read({domain:'boardSnapshot',boardId:'b',id:boardSnapshotId}))
Date.now=oldNow
let diagnosticReads=0
context.diagnostics=()=>({counter:++diagnosticReads,payload:'detail '.repeat(100)})
let diagnosticText='',diagnosticOffset=0,diagnosticId
 do {const page=read({domain:'diagnostics',id:diagnosticId,offset:diagnosticOffset,limit:100});diagnosticText+=page.jsonText;diagnosticOffset=page.nextOffset;diagnosticId=page.id}while(diagnosticOffset!==null)
assert.equal(JSON.parse(diagnosticText).counter,1);assert.equal(diagnosticReads,1,'Continuations must not rebuild runtime snapshots')
assert.throws(()=>read({domain:'diagnostics',offset:1}))
assert.throws(()=>read({domain:'diagnostics',id:'unknown'}))
console.log('Codex app inspection PASS: complete live model reads, pagination, frozen telemetry, revisions, bounds, unknown IDs/tools and no mutations')
