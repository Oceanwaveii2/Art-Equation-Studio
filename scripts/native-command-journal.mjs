import assert from 'node:assert/strict'
import { recordNativeCommand, redoNativeCommand, undoNativeCommand } from '../src/board/nativeCommandJournal.ts'

const board = (nodes) => ({ id:'board', title:'QA', nodes, connectors:[], viewport:{x:0,y:0,scale:1} })
const initial = board([{id:'a',x:0,y:0},{id:'b',x:20,y:20}])
const moved = board([{id:'a',x:15,y:8},{id:'b',x:20,y:20}])
const multiMoved = board([{id:'a',x:25,y:18},{id:'b',x:30,y:30}])
const rectangle = board([...multiMoved.nodes,{id:'rect',kind:'shape',x:40,y:40,width:80,height:60}])
const undo = [], redo = []

recordNativeCommand(undo,redo,initial,moved)
recordNativeCommand(undo,redo,moved,multiMoved)
recordNativeCommand(undo,redo,multiMoved,rectangle)
assert.equal(undo.length,3,'one completed gesture must create one command')
assert.deepEqual(undoNativeCommand(undo,redo),multiMoved)
assert.deepEqual(undoNativeCommand(undo,redo),moved)
assert.deepEqual(undoNativeCommand(undo,redo),initial)
assert.deepEqual(redoNativeCommand(undo,redo),moved)
assert.deepEqual(redoNativeCommand(undo,redo),multiMoved)
assert.deepEqual(redoNativeCommand(undo,redo),rectangle)
recordNativeCommand(undo,redo,rectangle,moved)
assert.equal(redo.length,0,'a new command must invalidate redo')
const textUndo = [], textRedo = []
recordNativeCommand(textUndo,textRedo,initial,moved,'typing-a')
recordNativeCommand(textUndo,textRedo,moved,multiMoved,'typing-a')
assert.equal(textUndo.length,1,'a continuous focused text session is one command')
assert.equal(undoNativeCommand(textUndo,textRedo),initial,'undo retains exact original markup/model')
assert.equal(redoNativeCommand(textUndo,textRedo),multiMoved,'redo restores the completed session')
recordNativeCommand(textUndo,textRedo,multiMoved,rectangle)
recordNativeCommand(textUndo,textRedo,rectangle,moved,'typing-a')
assert.equal(textUndo.length,3,'typing cannot merge across a separate canvas command')
recordNativeCommand(textUndo,textRedo,moved,multiMoved,'typing-b')
assert.equal(textUndo.length,4,'a later focus session is an independent command')
console.log('native command journal: PASS')
