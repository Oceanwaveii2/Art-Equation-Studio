import assert from 'node:assert/strict'
import {ProjectAutosave,restoreProjectViews,onlyViewsChanged} from '../src/storage/projectAutosave.ts'
const board={id:'b',viewport:{x:0,y:0,scale:1},nodes:[],connectors:[]}
const original={id:'p',updatedAt:'base',title:'Project',boards:[board],assets:[],documents:[]}
const pan={...original,updatedAt:'pan',boards:[{...board,viewport:{x:100,y:50,scale:2}}]}
assert.equal(onlyViewsChanged(original,pan),true)
assert.equal(onlyViewsChanged(original,{...pan,title:'Changed'}),false)
assert.equal(onlyViewsChanged(original,{...pan,boards:[{...pan.boards[0],nodes:[{id:'new'}]}]}),false)
const store=new ProjectAutosave(),calls=[];store.remember(original)
const full=async project=>calls.push(['full',project]),views=async state=>calls.push(['views',state])
await store.enqueue(pan,full,views)
assert.equal(calls[0][0],'views');assert.equal(calls[0][1].baseUpdatedAt,'base')
assert.deepEqual(restoreProjectViews(original,calls[0][1]).boards[0].viewport,pan.boards[0].viewport)
assert.equal(restoreProjectViews({...original,updatedAt:'newer'},calls[0][1]).boards[0],board,'Stale sidecar cannot overwrite newer content')
assert.equal(restoreProjectViews(original,{...calls[0][1],viewports:{b:{x:0,y:0,scale:NaN}}}).boards[0],board)
const edit={...pan,updatedAt:'edit',title:'Edited'}
await store.enqueue(edit,full,views);assert.equal(calls.at(-1)[0],'full')
await store.enqueue({...edit,updatedAt:'forced'},full,views,true);assert.equal(calls.at(-1)[0],'full')
let release;const held=new Promise(resolve=>release=resolve)
const first=store.enqueue({...edit,updatedAt:'slow'},async p=>{await held;calls.push(['slow',p])},views,true)
const second=store.enqueue({...edit,updatedAt:'after'},full,views)
release();await Promise.all([first,second]);assert.equal(calls.at(-2)[0],'slow');assert.equal(calls.at(-1)[0],'views')
await assert.rejects(store.enqueue({...edit,title:'failed',updatedAt:'failed'},async()=>{throw Error('disk failed')},views))
await store.enqueue({...edit,updatedAt:'recovered'},full,views);assert.equal(calls.at(-1)[0],'views','Failed write must not advance content baseline')
console.log('Project autosave: PASS (camera-only payload, full edits, explicit saves, reload, stale sidecars, ordered writes and failure recovery)')
