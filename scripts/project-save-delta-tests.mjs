import assert from 'node:assert/strict'
import fs from 'node:fs'
import {projectSaveDelta} from '../src/storage/projectSaveDelta.ts'
import {validSavePolicy} from '../src/storage/savePolicy.ts'
const project=JSON.parse(fs.readFileSync('../fixtures/workspace/projects/p1-v2-studies/project.json','utf8'))
const b=project.boards.find(b=>b.id==='test-2-nodes'),node=b.nodes.find(n=>n.kind!=='column')||b.nodes[0]
const next={...project,updatedAt:'edited',boards:project.boards.map(board=>board!==b?board:{...board,nodes:board.nodes.map(n=>n!==node?n:{...n,x:n.x+1})})}
const delta=projectSaveDelta(project,next,7)
assert.equal(delta.baseRevision,7)
assert.equal(delta.puts.filter(r=>r.kind==='node').length,1)
assert.equal(delta.puts.filter(r=>r.kind==='asset').length,0)
assert.equal(delta.puts.filter(r=>r.kind==='board').length,0)
assert.equal(delta.deletes.length,0)
assert.ok(JSON.stringify(delta).length<JSON.stringify(project).length/10,'Actual node-column edit must not resend entire fixture')
const removed={...next,boards:next.boards.filter(board=>board.id!==b.id)}
const removal=projectSaveDelta(next,removed,8)
assert.ok(removal.deletes.some(r=>r.kind==='board'&&r.id===b.id))
assert.equal(removal.deletes.filter(r=>r.scope===b.id&&r.kind==='node').length,b.nodes.length)
assert.throws(()=>projectSaveDelta(project,{...project,boards:[b,b]},7),/Duplicate/)
for(const n of [5,10,30,17])assert.equal(validSavePolicy({mode:'interval',intervalMinutes:n}).intervalMinutes,n)
assert.deepEqual(validSavePolicy({mode:'invalid',intervalMinutes:0}),{mode:'continuous',intervalMinutes:10})
console.log(JSON.stringify({decision:'PASS',fixtureBytes:fs.statSync('../fixtures/workspace/projects/p1-v2-studies/project.json').size,singleNodePayloadBytes:JSON.stringify(delta).length,changedRecords:delta.puts.length,scope:'Real fixture incremental payload correctness; not rendering or integrated performance'}))

